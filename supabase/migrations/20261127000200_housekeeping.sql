-- Housekeeping: scheduled purges and the metrics repair function.
--
-- The release crank and the blocklist refresh are NOT scheduled here. They
-- need the chain and third-party HTTP, so they run in the agent service on
-- its own Cron Triggers. pg_cron only does work that is pure SQL.

create extension if not exists pg_cron with schema pg_catalog;

-- `rollup_metrics` filters `holds` by day.
create index if not exists holds_created_at on public.holds (created_at);
create index if not exists holds_settled_at on public.holds (settled_at) where settled_at is not null;

-- Recomputes one UTC day of `metrics_daily` from `holds` and returns the row.
-- The webhook keeps the counters current as events arrive; this repairs a day
-- after rows were written some other way (a backfill, a manual fix), using
-- the same definitions as `ingest_hold_events`.
create or replace function public.rollup_metrics(p_day date) returns public.metrics_daily
language sql
set search_path = public
as $$
  with bounds as (
    select p_day::timestamp at time zone 'utc'       as lo,
           (p_day + 1)::timestamp at time zone 'utc' as hi
  ),
  created as (
    select count(*) as holds, coalesce(sum(h.amount_usd), 0) as usd
    from holds h, bounds b
    where h.created_at >= b.lo and h.created_at < b.hi
  ),
  settled as (
    select count(*) filter (where h.status = 2)                        as reclaimed,
           count(*) filter (where h.status = 1)                        as released,
           coalesce(sum(h.amount_usd) filter (where h.status = 2), 0)  as reclaimed_usd
    from holds h, bounds b
    where h.settled_at >= b.lo and h.settled_at < b.hi
  )
  insert into metrics_daily as m
    (day, holds_created, holds_reclaimed, holds_released, value_protected_usd, value_reclaimed_usd)
  select p_day, created.holds, settled.reclaimed, settled.released, created.usd, settled.reclaimed_usd
  from created, settled
  on conflict (day) do update set
    holds_created       = excluded.holds_created,
    holds_reclaimed     = excluded.holds_reclaimed,
    holds_released      = excluded.holds_released,
    value_protected_usd = excluded.value_protected_usd,
    value_reclaimed_usd = excluded.value_reclaimed_usd
  returning m.*
$$;

-- Deletes cached evidence that has expired. Returns the number of rows removed.
create or replace function public.purge_evidence_cache() returns integer
language sql
set search_path = public
as $$
  with gone as (
    delete from evidence_cache where expires_at < now() returning 1
  )
  select count(*)::integer from gone
$$;

-- Deletes finished deposit-box login challenges: abandoned ones a day after
-- they expired, completed ones after 30 days. Completed rows are kept that
-- long because `signature` is unique: while a row exists, the transfer that
-- completed it cannot be presented again for another challenge.
create or replace function public.purge_relay_challenges() returns integer
language sql
set search_path = public
as $$
  with gone as (
    delete from relay_challenges
    where (completed_at is null and expires_at < now() - interval '1 day')
       or (completed_at is not null and completed_at < now() - interval '30 days')
    returning 1
  )
  select count(*)::integer from gone
$$;

revoke execute on function public.rollup_metrics(date)      from public, anon, authenticated;
revoke execute on function public.purge_evidence_cache()    from public, anon, authenticated;
revoke execute on function public.purge_relay_challenges()  from public, anon, authenticated;
grant execute on function public.rollup_metrics(date)       to service_role;
grant execute on function public.purge_evidence_cache()     to service_role;
grant execute on function public.purge_relay_challenges()   to service_role;

-- Schedules (UTC). `cron.schedule` with a job name replaces a job of the same
-- name, so re-running this migration does not create duplicates.
select cron.schedule('holdback-purge-evidence-cache', '7 * * * *',
  $$select public.purge_evidence_cache()$$);
select cron.schedule('holdback-purge-relay-challenges', '23 3 * * *',
  $$select public.purge_relay_challenges()$$);
