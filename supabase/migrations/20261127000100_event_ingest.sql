-- Event ingestion for the `helius-webhook` Edge function.
--
-- The webhook decodes the program's events and passes them here as one JSON
-- array. Everything a delivery changes (holds, instant transfers and the
-- daily counters) is written in a single transaction, and every step is
-- guarded by the state it changes, so a delivery that Helius retries or
-- sends twice leaves the tables and the counters exactly as they were.

-- Adds to one day's counters. The day is the UTC date of `p_at`.
create or replace function public.bump_metrics(
  p_at             timestamptz,
  p_created        integer,
  p_reclaimed      integer,
  p_released       integer,
  p_protected_usd  numeric,
  p_reclaimed_usd  numeric
) returns void
language sql
set search_path = public
as $$
  insert into metrics_daily as m
    (day, holds_created, holds_reclaimed, holds_released, value_protected_usd, value_reclaimed_usd)
  values
    ((p_at at time zone 'utc')::date, p_created, p_reclaimed, p_released, p_protected_usd, p_reclaimed_usd)
  on conflict (day) do update set
    holds_created       = m.holds_created       + excluded.holds_created,
    holds_reclaimed     = m.holds_reclaimed     + excluded.holds_reclaimed,
    holds_released      = m.holds_released      + excluded.holds_released,
    value_protected_usd = m.value_protected_usd + excluded.value_protected_usd,
    value_reclaimed_usd = m.value_reclaimed_usd + excluded.value_reclaimed_usd
$$;

-- Applies decoded program events, in array order, and reports what happened
-- to each one:
--
--   applied       the mirror changed
--   duplicate     this event was already applied (a replayed delivery)
--   unknown_hold  an extension or settlement of a hold that is not stored
--                 yet; nothing was written, the caller should retry later
--
-- Row shapes, by `kind` (times are unix seconds, amounts decimal strings):
--
--   hold_created      signature, pda, sender, recipient, mint (null = SOL),
--                     amount, tier, origin, nonce, created_at, release_at,
--                     evidence_hash, amount_usd (null = no USD value)
--   window_extended   signature, pda, release_at, tier, evidence_hash
--   hold_settled      signature, pda, status (1 released, 2 reclaimed), settled_at
--   instant_transfer  signature, sender, recipient, mint, amount, created_at
--
-- Counters move only together with the row change that justifies them:
-- `holds_created` and `value_protected_usd` on the day a hold was created,
-- `holds_released`, `holds_reclaimed` and `value_reclaimed_usd` on the day it
-- settled. `rollup_metrics(day)` recomputes the same numbers from `holds`.
create or replace function public.ingest_hold_events(p_events jsonb) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  e          jsonb;
  v_kind     text;
  v_pda      text;
  v_sig      text;
  v_at       timestamptz;
  v_status   smallint;
  v_usd      numeric(18, 2);
  v_outcome  text;
  v_results  jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'p_events must be a JSON array';
  end if;

  for e in select value from jsonb_array_elements(p_events) loop
    v_kind := e ->> 'kind';
    v_pda  := e ->> 'pda';
    v_sig  := e ->> 'signature';
    if v_sig is null then
      raise exception 'event without a signature: %', e;
    end if;

    if v_kind = 'hold_created' then
      v_at  := to_timestamp((e ->> 'created_at')::double precision);
      v_usd := (e ->> 'amount_usd')::numeric;
      insert into holds
        (pda, sender, recipient, mint, amount, tier, origin, nonce,
         created_at, release_at, evidence_hash, create_signature, amount_usd)
      values
        (v_pda, e ->> 'sender', e ->> 'recipient', e ->> 'mint', (e ->> 'amount')::numeric,
         (e ->> 'tier')::smallint, (e ->> 'origin')::smallint, (e ->> 'nonce')::numeric,
         v_at, to_timestamp((e ->> 'release_at')::double precision),
         e ->> 'evidence_hash', v_sig, v_usd)
      on conflict (pda) do nothing;
      if found then
        perform bump_metrics(v_at, 1, 0, 0, coalesce(v_usd, 0), 0);
        v_outcome := 'applied';
      else
        v_outcome := 'duplicate';
      end if;

    elsif v_kind = 'window_extended' then
      -- The program only ever moves `release_at` later and never lowers the
      -- tier, so the extension with the latest release time is the current
      -- one even when two of them arrive out of order.
      v_at := to_timestamp((e ->> 'release_at')::double precision);
      update holds h set
        release_at        = greatest(h.release_at, v_at),
        tier              = case when v_at >= h.release_at then (e ->> 'tier')::smallint else h.tier end,
        evidence_hash     = case when v_at >= h.release_at then e ->> 'evidence_hash' else h.evidence_hash end,
        extend_signatures = array_append(h.extend_signatures, v_sig)
      where h.pda = v_pda and not (v_sig = any (h.extend_signatures));
      if found then
        v_outcome := 'applied';
      elsif exists (select 1 from holds where pda = v_pda) then
        v_outcome := 'duplicate';
      else
        v_outcome := 'unknown_hold';
      end if;

    elsif v_kind = 'hold_settled' then
      v_status := (e ->> 'status')::smallint;
      if v_status not in (1, 2) then
        raise exception 'hold_settled needs status 1 or 2, got %', e ->> 'status';
      end if;
      v_at := to_timestamp((e ->> 'settled_at')::double precision);
      -- `status = 0` is the guard: a hold settles once, so a replay (or a
      -- concurrent copy of this delivery, which waits on the row lock and
      -- then re-checks) updates nothing and counts nothing.
      update holds h set
        status           = v_status,
        settled_at       = v_at,
        settle_signature = v_sig
      where h.pda = v_pda and h.status = 0
      returning h.amount_usd into v_usd;
      if found then
        if v_status = 2 then
          perform bump_metrics(v_at, 0, 1, 0, 0, coalesce(v_usd, 0));
        else
          perform bump_metrics(v_at, 0, 0, 1, 0, 0);
        end if;
        v_outcome := 'applied';
      elsif exists (select 1 from holds where pda = v_pda) then
        v_outcome := 'duplicate';
      else
        v_outcome := 'unknown_hold';
      end if;

    elsif v_kind = 'instant_transfer' then
      insert into instant_transfers (signature, sender, recipient, mint, amount, created_at)
      values
        (v_sig, e ->> 'sender', e ->> 'recipient', e ->> 'mint', (e ->> 'amount')::numeric,
         to_timestamp((e ->> 'created_at')::double precision))
      on conflict (signature) do nothing;
      v_outcome := case when found then 'applied' else 'duplicate' end;

    else
      raise exception 'unknown event kind: %', coalesce(v_kind, 'null');
    end if;

    v_results := v_results || jsonb_build_object(
      'kind', v_kind,
      'ref', coalesce(v_pda, v_sig),
      'outcome', v_outcome
    );
  end loop;

  return v_results;
end
$$;

-- Functions in `public` are callable through the Data API by default. These
-- two write, so only the service role may run them.
revoke execute on function public.bump_metrics(timestamptz, integer, integer, integer, numeric, numeric)
  from public, anon, authenticated;
revoke execute on function public.ingest_hold_events(jsonb)
  from public, anon, authenticated;
grant execute on function public.bump_metrics(timestamptz, integer, integer, integer, numeric, numeric)
  to service_role;
grant execute on function public.ingest_hold_events(jsonb)
  to service_role;
