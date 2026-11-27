-- HOLDBACK off-chain schema.
--
-- The chain is the source of truth for money. These tables mirror it for
-- fast reads and Realtime, and store what cannot live on-chain: the evidence
-- documents behind each window, caches, profiles and game runs.
--
-- Access model: every write goes through the service role (the agent and the
-- webhook). Anonymous clients can read evidence and receipts by hash/PDA and
-- the public counters. A signed-in wallet (JWT claim `wallet`) can read its
-- own holds and profile.

create extension if not exists pgcrypto;

-- The wallet in the caller's JWT, or null for anonymous callers.
create or replace function public.jwt_wallet() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'wallet', '')
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- profiles --------------------------------------------------------------------

create table public.profiles (
  wallet          text primary key,
  lang            text not null default 'en' check (lang in ('en', 'hi', 'es', 'pt')),
  push_token      text,
  phone           text,
  phone_verified  boolean not null default false,
  pollar_user_id  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- evidence ----------------------------------------------------------------------

-- One row per assessment. `hash` is sha256(canonical JSON of `document`), the
-- same 32 bytes stored in Hold.evidence_hash on-chain.
create table public.evidence (
  hash        text primary key check (hash ~ '^[0-9a-f]{64}$'),
  document    jsonb not null,
  spoken      jsonb not null default '{}'::jsonb,   -- { "en": "...", "hi": "..." }
  created_at  timestamptz not null default now()
);

create table public.evidence_cache (
  key         text primary key,                      -- "<source>:<subject>"
  source      text not null,
  json        jsonb not null,
  expires_at  timestamptz not null
);
create index evidence_cache_expires on public.evidence_cache (expires_at);

-- Static blocklists, refreshed by cron.
create table public.blocklist_entries (
  list   text not null,                               -- phantom | scamsniffer | metamask | ofac
  kind   text not null check (kind in ('address', 'domain')),
  value  text not null,
  primary key (kind, value, list)
);

create table public.blocklist_meta (
  list          text primary key,
  entries       integer not null default 0,
  refreshed_at  timestamptz not null default now(),
  source_url    text not null
);

-- holds -------------------------------------------------------------------------

create table public.holds (
  pda               text primary key,
  sender            text not null,
  recipient         text not null,
  mint              text,                             -- null = native SOL
  amount            numeric(20, 0) not null check (amount >= 0),
  tier              smallint not null check (tier between 0 and 4),
  origin            smallint not null check (origin in (0, 1)),
  status            smallint not null default 0 check (status in (0, 1, 2)),
  nonce             numeric(20, 0),
  created_at        timestamptz not null,
  release_at        timestamptz not null,
  settled_at        timestamptz,
  evidence_hash     text not null,
  create_signature  text,
  settle_signature  text,
  extend_signatures text[] not null default '{}',
  amount_usd        numeric(18, 2),
  updated_at        timestamptz not null default now()
);
create index holds_sender on public.holds (sender, created_at desc);
create index holds_recipient on public.holds (recipient, created_at desc);
create index holds_due on public.holds (release_at) where status = 0;
create trigger holds_touch before update on public.holds
  for each row execute function public.touch_updated_at();

-- Instant (zero-window) transfers, for history and the behavioural baseline.
create table public.instant_transfers (
  signature   text primary key,
  sender      text not null,
  recipient   text not null,
  mint        text,
  amount      numeric(20, 0) not null,
  created_at  timestamptz not null
);
create index instant_sender on public.instant_transfers (sender, created_at desc);

-- flags -------------------------------------------------------------------------

create table public.flags_offchain (
  id                 uuid primary key default gen_random_uuid(),
  subject            text not null,
  reporter           text,
  reason             smallint not null check (reason between 0 and 7),
  note               text check (char_length(note) <= 500),
  evidence_hash      text,
  onchain_signature  text,
  created_at         timestamptz not null default now()
);
create index flags_subject on public.flags_offchain (subject);

-- relay (deposit-box) sessions ----------------------------------------------------

-- Proof-by-transfer login: the owner proves control of a transfer-only wallet
-- by sending an exact, randomly chosen amount to their own deposit box.
create table public.relay_challenges (
  id            uuid primary key default gen_random_uuid(),
  owner         text not null,
  mint          text not null,
  amount        numeric(20, 0) not null,
  secret_hash   text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  completed_at  timestamptz,
  signature     text unique
);
create index relay_challenges_owner on public.relay_challenges (owner, created_at desc);

-- dojo --------------------------------------------------------------------------

create table public.dojo_runs (
  run_id          uuid primary key default gen_random_uuid(),
  player          text,
  state           jsonb not null,
  score           integer not null default 0,
  done            boolean not null default false,
  result          text,
  memo_signature  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger dojo_runs_touch before update on public.dojo_runs
  for each row execute function public.touch_updated_at();

-- eval and metrics ------------------------------------------------------------------

create table public.eval_runs (
  id          uuid primary key default gen_random_uuid(),
  git_commit  text,
  results     jsonb not null,
  created_at  timestamptz not null default now()
);

create table public.metrics_daily (
  day                  date primary key,
  holds_created        integer not null default 0,
  holds_reclaimed      integer not null default 0,
  holds_released       integer not null default 0,
  value_protected_usd  numeric(18, 2) not null default 0,
  value_reclaimed_usd  numeric(18, 2) not null default 0
);

-- Public counters for the landing page.
create or replace view public.live_stats with (security_invoker = false) as
  select
    coalesce(sum(holds_created), 0)::bigint        as holds_created,
    coalesce(sum(holds_reclaimed), 0)::bigint      as holds_reclaimed,
    coalesce(sum(holds_released), 0)::bigint       as holds_released,
    coalesce(sum(value_protected_usd), 0)::numeric as value_protected_usd,
    coalesce(sum(value_reclaimed_usd), 0)::numeric as value_reclaimed_usd,
    now()                                          as updated_at
  from public.metrics_daily;

-- A public receipt: one hold by PDA with its evidence. Runs as the owner so
-- anonymous callers can fetch a single known hold without listing the table.
create or replace function public.hold_receipt(p_pda text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'hold', to_jsonb(h),
    'document', e.document,
    'spoken', coalesce(e.spoken, '{}'::jsonb)
  )
  from holds h
  left join evidence e on e.hash = h.evidence_hash
  where h.pda = p_pda
$$;

-- row-level security ----------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.evidence          enable row level security;
alter table public.evidence_cache    enable row level security;
alter table public.blocklist_entries enable row level security;
alter table public.blocklist_meta    enable row level security;
alter table public.holds             enable row level security;
alter table public.instant_transfers enable row level security;
alter table public.flags_offchain    enable row level security;
alter table public.relay_challenges  enable row level security;
alter table public.dojo_runs         enable row level security;
alter table public.eval_runs         enable row level security;
alter table public.metrics_daily     enable row level security;

-- No insert/update/delete policies exist: only the service role, which
-- bypasses RLS, can write.

create policy profiles_read_own on public.profiles
  for select using (wallet = public.jwt_wallet());

create policy evidence_read_all on public.evidence
  for select using (true);

create policy blocklist_meta_read_all on public.blocklist_meta
  for select using (true);

create policy holds_read_own on public.holds
  for select using (public.jwt_wallet() in (sender, recipient));

create policy instant_read_own on public.instant_transfers
  for select using (public.jwt_wallet() in (sender, recipient));

create policy dojo_runs_read_all on public.dojo_runs
  for select using (true);

create policy eval_runs_read_all on public.eval_runs
  for select using (true);

create policy metrics_read_all on public.metrics_daily
  for select using (true);

grant select on public.live_stats to anon, authenticated;
grant execute on function public.hold_receipt(text) to anon, authenticated;
revoke all on public.evidence_cache, public.relay_challenges, public.flags_offchain from anon, authenticated;

-- realtime ----------------------------------------------------------------------------

alter publication supabase_realtime add table public.holds;
alter table public.holds replica identity full;
