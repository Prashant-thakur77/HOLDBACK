-- Integration test for the SQL the webhook relies on: `ingest_hold_events`,
-- `rollup_metrics`, the purge functions and their privileges.
--
-- Run it against a database that has every migration applied:
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sql/ingest.test.sql
--
-- It works inside one transaction that is rolled back at the end, and uses
-- dates in the year 2100, so it neither leaves rows behind nor collides with
-- real counters. A failed `assert` aborts the script with a non-zero exit.
-- Progress is printed as TAP lines (`ok 1 - ...`), one per block.

\echo 1..3

begin;

do $$
declare
  -- 2100-01-01 00:00:00 UTC and the day after.
  t0       constant bigint := 4102444800;
  day1     constant date := date '2100-01-01';
  day2     constant date := date '2100-01-02';
  usdc     constant text := '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  hash_a   constant text := repeat('aa', 32);
  hash_b   constant text := repeat('bb', 32);
  created  jsonb;
  sol      jsonb;
  r        jsonb;
  h        holds;
  m        metrics_daily;
  failed   boolean;
begin
  created := jsonb_build_object(
    'kind', 'hold_created', 'signature', 'test-sig-create', 'pda', 'test-hold-usdc',
    'sender', 'test-alice', 'recipient', 'test-bob', 'mint', usdc, 'amount', '25000000',
    'tier', 2, 'origin', 0, 'nonce', '18446744073709551615',
    'created_at', t0 + 3600, 'release_at', t0 + 3600 + 21600,
    'evidence_hash', hash_a, 'amount_usd', '25.00');

  -- A hold is stored once and counted once.
  r := ingest_hold_events(jsonb_build_array(created));
  assert r = '[{"kind":"hold_created","ref":"test-hold-usdc","outcome":"applied"}]'::jsonb, r::text;
  select * into h from holds where pda = 'test-hold-usdc';
  assert h.sender = 'test-alice' and h.recipient = 'test-bob' and h.mint = usdc;
  assert h.amount = 25000000 and h.nonce = 18446744073709551615 and h.amount_usd = 25.00;
  assert h.tier = 2 and h.origin = 0 and h.status = 0 and h.evidence_hash = hash_a;
  assert h.created_at = to_timestamp(t0 + 3600) and h.release_at = to_timestamp(t0 + 25200);
  assert h.create_signature = 'test-sig-create' and h.settled_at is null;
  select * into m from metrics_daily where day = day1;
  assert m.holds_created = 1 and m.value_protected_usd = 25.00;
  assert m.holds_reclaimed = 0 and m.holds_released = 0 and m.value_reclaimed_usd = 0;

  -- A replayed delivery changes nothing.
  r := ingest_hold_events(jsonb_build_array(created));
  assert r -> 0 ->> 'outcome' = 'duplicate', r::text;
  select * into m from metrics_daily where day = day1;
  assert m.holds_created = 1 and m.value_protected_usd = 25.00, 'replay counted twice';

  -- An extension moves the release time, tier and evidence hash, once.
  r := ingest_hold_events(jsonb_build_array(jsonb_build_object(
    'kind', 'window_extended', 'signature', 'test-sig-extend-2', 'pda', 'test-hold-usdc',
    'release_at', t0 + 90000, 'tier', 3, 'evidence_hash', hash_b)));
  assert r -> 0 ->> 'outcome' = 'applied', r::text;
  r := ingest_hold_events(jsonb_build_array(jsonb_build_object(
    'kind', 'window_extended', 'signature', 'test-sig-extend-2', 'pda', 'test-hold-usdc',
    'release_at', t0 + 90000, 'tier', 3, 'evidence_hash', hash_b)));
  assert r -> 0 ->> 'outcome' = 'duplicate', r::text;
  select * into h from holds where pda = 'test-hold-usdc';
  assert h.release_at = to_timestamp(t0 + 90000) and h.tier = 3 and h.evidence_hash = hash_b;
  assert h.extend_signatures = array['test-sig-extend-2'];

  -- An older extension that arrives late is recorded but cannot move the
  -- release time back or lower the tier.
  r := ingest_hold_events(jsonb_build_array(jsonb_build_object(
    'kind', 'window_extended', 'signature', 'test-sig-extend-1', 'pda', 'test-hold-usdc',
    'release_at', t0 + 50000, 'tier', 2, 'evidence_hash', hash_a)));
  assert r -> 0 ->> 'outcome' = 'applied', r::text;
  select * into h from holds where pda = 'test-hold-usdc';
  assert h.release_at = to_timestamp(t0 + 90000) and h.tier = 3 and h.evidence_hash = hash_b;
  assert h.extend_signatures = array['test-sig-extend-2', 'test-sig-extend-1'];

  -- Events for a hold that is not stored are reported, not written.
  r := ingest_hold_events(jsonb_build_array(
    jsonb_build_object('kind', 'hold_settled', 'signature', 'test-sig-x', 'pda', 'test-hold-missing',
                       'status', 1, 'settled_at', t0 + 100),
    jsonb_build_object('kind', 'window_extended', 'signature', 'test-sig-y', 'pda', 'test-hold-missing',
                       'release_at', t0 + 100, 'tier', 3, 'evidence_hash', hash_b)));
  assert r -> 0 ->> 'outcome' = 'unknown_hold' and r -> 1 ->> 'outcome' = 'unknown_hold', r::text;
  assert not exists (select 1 from holds where pda = 'test-hold-missing');

  -- A reclaim settles the hold and is counted on the day it happened.
  r := ingest_hold_events(jsonb_build_array(jsonb_build_object(
    'kind', 'hold_settled', 'signature', 'test-sig-reclaim', 'pda', 'test-hold-usdc',
    'status', 2, 'settled_at', t0 + 86400 + 60)));
  assert r -> 0 ->> 'outcome' = 'applied', r::text;
  select * into h from holds where pda = 'test-hold-usdc';
  assert h.status = 2 and h.settled_at = to_timestamp(t0 + 86460);
  assert h.settle_signature = 'test-sig-reclaim';
  select * into m from metrics_daily where day = day2;
  assert m.holds_reclaimed = 1 and m.value_reclaimed_usd = 25.00;
  assert m.holds_created = 0 and m.holds_released = 0 and m.value_protected_usd = 0;

  -- A hold settles once: neither a replay nor a different settlement counts.
  r := ingest_hold_events(jsonb_build_array(
    jsonb_build_object('kind', 'hold_settled', 'signature', 'test-sig-reclaim', 'pda', 'test-hold-usdc',
                       'status', 2, 'settled_at', t0 + 86460),
    jsonb_build_object('kind', 'hold_settled', 'signature', 'test-sig-release', 'pda', 'test-hold-usdc',
                       'status', 1, 'settled_at', t0 + 86500)));
  assert r -> 0 ->> 'outcome' = 'duplicate' and r -> 1 ->> 'outcome' = 'duplicate', r::text;
  select * into h from holds where pda = 'test-hold-usdc';
  assert h.status = 2 and h.settle_signature = 'test-sig-reclaim';
  select * into m from metrics_daily where day = day2;
  assert m.holds_reclaimed = 1 and m.holds_released = 0 and m.value_reclaimed_usd = 25.00;

  -- A SOL hold has no mint and no USD value; it still counts as a hold.
  sol := created || jsonb_build_object(
    'signature', 'test-sig-create-sol', 'pda', 'test-hold-sol', 'mint', null,
    'amount', '2000000000', 'amount_usd', null);
  r := ingest_hold_events(jsonb_build_array(
    sol,
    jsonb_build_object('kind', 'hold_settled', 'signature', 'test-sig-release-sol',
                       'pda', 'test-hold-sol', 'status', 1, 'settled_at', t0 + 7200)));
  assert r -> 0 ->> 'outcome' = 'applied' and r -> 1 ->> 'outcome' = 'applied', r::text;
  select * into h from holds where pda = 'test-hold-sol';
  assert h.mint is null and h.amount_usd is null and h.status = 1;
  select * into m from metrics_daily where day = day1;
  assert m.holds_created = 2 and m.value_protected_usd = 25.00 and m.holds_released = 1;

  -- Instant transfers are stored by signature and do not touch the counters.
  r := ingest_hold_events(jsonb_build_array(jsonb_build_object(
    'kind', 'instant_transfer', 'signature', 'test-sig-instant', 'sender', 'test-alice',
    'recipient', 'test-carol', 'mint', usdc, 'amount', '5000000', 'created_at', t0 + 10)));
  assert r = '[{"kind":"instant_transfer","ref":"test-sig-instant","outcome":"applied"}]'::jsonb, r::text;
  r := ingest_hold_events(jsonb_build_array(jsonb_build_object(
    'kind', 'instant_transfer', 'signature', 'test-sig-instant', 'sender', 'test-alice',
    'recipient', 'test-carol', 'mint', usdc, 'amount', '5000000', 'created_at', t0 + 10)));
  assert r -> 0 ->> 'outcome' = 'duplicate', r::text;
  assert (select count(*) from instant_transfers where signature = 'test-sig-instant') = 1;
  select * into m from metrics_daily where day = day1;
  assert m.holds_created = 2 and m.value_protected_usd = 25.00;

  -- A delivery is all or nothing: one bad row stores none of them.
  failed := false;
  begin
    perform ingest_hold_events(jsonb_build_array(
      created || jsonb_build_object('pda', 'test-hold-atomic', 'signature', 'test-sig-atomic'),
      jsonb_build_object('kind', 'no_such_kind', 'signature', 'test-sig-bad')));
  exception when others then
    failed := true;
  end;
  assert failed, 'an unknown kind must raise';
  assert not exists (select 1 from holds where pda = 'test-hold-atomic');
  select * into m from metrics_daily where day = day1;
  assert m.holds_created = 2, 'a failed delivery moved the counters';

  -- The rollup computes the same numbers the webhook counted.
  select * into m from metrics_daily where day = day1;
  assert rollup_metrics(day1) = m, 'rollup disagrees with the counters for day 1';
  select * into m from metrics_daily where day = day2;
  assert rollup_metrics(day2) = m, 'rollup disagrees with the counters for day 2';

  -- ... and repairs a row that drifted.
  update metrics_daily set holds_created = 99, holds_released = 99, value_protected_usd = 1
  where day = day1;
  m := rollup_metrics(day1);
  assert m.holds_created = 2 and m.holds_released = 1 and m.holds_reclaimed = 0;
  assert m.value_protected_usd = 25.00 and m.value_reclaimed_usd = 0;

  -- A day without holds rolls up to zeros.
  m := rollup_metrics(date '2100-06-01');
  assert m.holds_created = 0 and m.holds_reclaimed = 0 and m.holds_released = 0;
  assert m.value_protected_usd = 0 and m.value_reclaimed_usd = 0;
end
$$;
\echo ok 1 - events are applied once and counted once

do $$
declare
  done_old  uuid;
  done_new  uuid;
  open_old  uuid;
  open_new  uuid;
begin
  -- Expired cache rows go, live ones stay.
  insert into evidence_cache (key, source, json, expires_at) values
    ('test:expired', 'test', '{}', now() - interval '1 minute'),
    ('test:live',    'test', '{}', now() + interval '1 hour');
  assert purge_evidence_cache() >= 1;
  assert not exists (select 1 from evidence_cache where key = 'test:expired');
  assert exists (select 1 from evidence_cache where key = 'test:live');

  -- Abandoned challenges go a day after expiry, completed ones after 30 days.
  insert into relay_challenges (owner, mint, amount, secret_hash, created_at, expires_at, completed_at, signature)
  values ('test-owner', 'test-mint', 1, 'h', now() - interval '40 days', now() - interval '40 days',
          now() - interval '31 days', 'test-sig-challenge-old')
  returning id into done_old;
  insert into relay_challenges (owner, mint, amount, secret_hash, created_at, expires_at, completed_at, signature)
  values ('test-owner', 'test-mint', 1, 'h', now() - interval '10 days', now() - interval '10 days',
          now() - interval '10 days', 'test-sig-challenge-new')
  returning id into done_new;
  insert into relay_challenges (owner, mint, amount, secret_hash, created_at, expires_at)
  values ('test-owner', 'test-mint', 1, 'h', now() - interval '3 days', now() - interval '2 days')
  returning id into open_old;
  insert into relay_challenges (owner, mint, amount, secret_hash, created_at, expires_at)
  values ('test-owner', 'test-mint', 1, 'h', now(), now() + interval '10 minutes')
  returning id into open_new;

  assert purge_relay_challenges() >= 2;
  assert not exists (select 1 from relay_challenges where id in (done_old, open_old));
  assert (select count(*) from relay_challenges where id in (done_new, open_new)) = 2;
end
$$;
\echo ok 2 - purges remove only what has expired

do $$
declare
  fn text;
begin
  -- The writing functions are closed to the roles the Data API hands out.
  foreach fn in array array[
    'public.ingest_hold_events(jsonb)',
    'public.bump_metrics(timestamptz, integer, integer, integer, numeric, numeric)',
    'public.rollup_metrics(date)',
    'public.purge_evidence_cache()',
    'public.purge_relay_challenges()'
  ] loop
    assert not has_function_privilege('anon', fn, 'execute'), fn || ' is open to anon';
    assert not has_function_privilege('authenticated', fn, 'execute'), fn || ' is open to authenticated';
    assert has_function_privilege('service_role', fn, 'execute'), fn || ' is closed to service_role';
  end loop;
end
$$;
\echo ok 3 - writing functions are closed to anon and authenticated

rollback;

