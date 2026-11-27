# HOLDBACK on Supabase

The chain is the source of truth for money. Supabase mirrors it for fast reads and live
updates, and stores what cannot live on-chain: the evidence documents behind each undo window,
caches, profiles and game runs.

```
supabase/
  config.toml                              CLI configuration (webhook function has verify_jwt = false)
  migrations/
    20261127000000_init.sql                tables, row-level security, Realtime on holds
    20261127000100_event_ingest.sql        ingest_hold_events(): idempotent writes + daily counters
    20261127000200_housekeeping.sql        pg_cron purges, rollup_metrics(day)
  seed.sql                                 rows a fresh project needs; no sample data
  functions/
    helius-webhook/index.ts                Edge function: binds the handler to the runtime
    _shared/                               decoder, payload parsing, handler, IDL copy
    .env.example                           the function's secrets
  tests/                                   vitest for the function's modules, SQL test for the database functions
```

## Setup

The commands use the Supabase CLI through `npx` (checked against CLI 3.4.0); run them from the
repository root.

```bash
npx supabase login
npx supabase link --project-ref <project-ref>

# Schema, policies, functions and cron jobs. --include-seed also runs seed.sql.
# CLI 3 pushes to the local stack unless --remote is given; on CLI 2 use --linked instead.
npx supabase db push --remote --include-seed

# Secrets of the Edge function.
cp supabase/functions/.env.example supabase/functions/.env   # then fill it in
npx supabase secrets set --env-file supabase/functions/.env

npx supabase functions deploy helius-webhook
```

The function is then served at `https://<project-ref>.supabase.co/functions/v1/helius-webhook`.

| Secret                  | Required           | Purpose                                                                                               |
| ----------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `HELIUS_WEBHOOK_SECRET` | yes                | Shared secret Helius sends in the `Authorization` header. Generate with `openssl rand -hex 32`.       |
| `HELIUS_RPC_URL`        | enhanced webhooks  | RPC endpoint of the same cluster; used to fetch logs, which enhanced payloads do not carry.           |
| `HOLDBACK_PROGRAM_ID`   | no                 | Defaults to the address in `functions/_shared/holdback.idl.json`.                                     |
| `USD_STABLECOIN_MINTS`  | no                 | Extra `mint:decimals` pairs counted at par in the USD counters. Devnet and mainnet USDC are built in. |
| `SERVICE_ROLE_KEY`      | see `.env.example` | Only where the platform does not inject `SUPABASE_SERVICE_ROLE_KEY`.                                  |

`SUPABASE_URL` and the service role key are provided by the platform. While
`HELIUS_WEBHOOK_SECRET` is unset the function refuses every request.

For local work, `npx supabase start` applies the migrations and the seed, and
`npx supabase functions serve helius-webhook` runs the function with `supabase/functions/.env`.

## The Helius webhook

Create one webhook that watches the program address, in the Helius dashboard
(Webhooks > New Webhook) or through its API:

| Field             | Value                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| Network / type    | devnet, **raw** (`rawDevnet` in the API; `raw` on mainnet)               |
| Webhook URL       | `https://<project-ref>.supabase.co/functions/v1/helius-webhook`          |
| Account addresses | the program id, `26Tx1zAiL26RfxqTAVDaFaD2TTVku4Hm2vy3LBw8unom` on devnet |
| Auth header       | the value of `HELIUS_WEBHOOK_SECRET`, exactly                            |

```bash
curl -X POST "https://api.helius.xyz/v0/webhooks?api-key=$HELIUS_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "webhookURL": "https://<project-ref>.supabase.co/functions/v1/helius-webhook",
    "webhookType": "rawDevnet",
    "transactionTypes": ["ANY"],
    "accountAddresses": ["26Tx1zAiL26RfxqTAVDaFaD2TTVku4Hm2vy3LBw8unom"],
    "authHeader": "'"$HELIUS_WEBHOOK_SECRET"'"
  }'
```

(The field names are from Helius' API reference; confirm the endpoint host there before
relying on the `curl` form.)

Raw is the recommended type: its payload is the `getTransaction` result, which already
contains the log messages the events are decoded from. Enhanced webhooks also work, but their
payload has no logs, so the function makes one `getTransaction` call per transaction and needs
`HELIUS_RPC_URL`.

### What the function does with a delivery

1. Compares the `Authorization` header with the secret in constant time.
2. Skips failed transactions. A failed transaction changed nothing, whatever it logged.
3. Reads `Program data:` log lines, but only those written while HOLDBACK is the executing
   program according to the runtime's own `invoke` / `success` lines. Another program logging
   the same bytes is ignored.
4. Decodes the events with the IDL and passes them to `ingest_hold_events` in one call:

| Event                            | Effect                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `HoldCreated`                    | insert into `holds`; `holds_created` and `value_protected_usd` for that day               |
| `WindowExtended`                 | later `release_at`, new `tier` and `evidence_hash`, signature appended                    |
| `HoldReclaimed` / `HoldReleased` | `status`, `settled_at`, `settle_signature`; `holds_reclaimed` (+ USD) or `holds_released` |
| `InstantTransfer`                | insert into `instant_transfers`                                                           |

`amount_usd` is filled only for listed USD stablecoins, counted at par. Every other asset,
SOL included, has no USD value and adds nothing to the USD counters.

### Retries and repair

Helius may deliver a transaction more than once. Each write is guarded by the state it
changes (a hold is inserted once, settles once, and records each extension by signature), and
the counters move in the same database transaction as the row. A replay is answered with
`200` and `duplicates` in the body, and changes nothing.

If a settlement or an extension arrives before its hold's creation, or the RPC node does not
know an enhanced transaction yet, the function stores everything else and answers `503` so
the delivery is sent again. Within one delivery, transactions are applied in slot order.

Deliveries that are lost for good (the function was down for longer than Helius retries) can
be replayed by hand: POST the `getTransaction` JSON of the missed signatures, as an array, to
the function with the secret. That is exactly the raw payload shape. If rows were written some
other way, `select rollup_metrics('2026-11-27');` recomputes that day's counters from `holds`.

## Access model

Every write goes through the service role (the agent service and this function). There are
no insert, update or delete policies.

| Table / object                                          | anon                       | wallet JWT (`authenticated`)         | service role |
| ------------------------------------------------------- | -------------------------- | ------------------------------------ | ------------ |
| `holds`                                                 | none                       | rows where it is sender or recipient | all          |
| `instant_transfers`                                     | none                       | rows where it is sender or recipient | all          |
| `profiles`                                              | none                       | its own row                          | all          |
| `hold_receipt(pda)`                                     | one hold with its evidence | same                                 | all          |
| `evidence`                                              | read                       | read                                 | all          |
| `metrics_daily`, `live_stats`                           | read                       | read                                 | all          |
| `blocklist_meta`, `dojo_runs`, `eval_runs`              | read                       | read                                 | all          |
| `blocklist_entries`                                     | none                       | none                                 | all          |
| `evidence_cache`, `relay_challenges`, `flags_offchain`  | none                       | none                                 | all          |
| `ingest_hold_events`, `rollup_metrics`, purge functions | no execute                 | no execute                           | execute      |

## Realtime on `holds`

`holds` is in the `supabase_realtime` publication with full replica identity, so the apps
get every insert and update for countdowns and status changes. Realtime checks each change
against the subscriber's policies, which means a client only ever receives holds it is a
party to.

HOLDBACK has no Supabase Auth users. A wallet proves itself to the agent service, which
answers with a short-lived JWT signed with the project's JWT secret:

```json
{ "role": "authenticated", "wallet": "<base58 address>", "exp": 1795003600 }
```

The policies read the `wallet` claim through `jwt_wallet()`. The client passes the token to
both the REST and the Realtime connection:

```ts
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${walletJwt}` } },
});
supabase.realtime.setAuth(walletJwt);

supabase
  .channel('my-holds')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'holds' }, (change) => {
    render(change.new); // sent only for holds this wallet sent or receives
  })
  .subscribe();
```

No filter is needed for privacy; add `filter: 'sender=eq.<address>'` only to separate
outgoing from incoming holds. When the token is renewed, call `setAuth` again.

## Scheduled jobs

`pg_cron` runs the work that is pure SQL (times are UTC):

| Job                               | Schedule       | What it does                                                                     |
| --------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| `holdback-purge-evidence-cache`   | hourly, at :07 | deletes `evidence_cache` rows past `expires_at`                                  |
| `holdback-purge-relay-challenges` | daily, 03:23   | deletes abandoned challenges 1 day after expiry and completed ones after 30 days |

The release crank is **not** scheduled here. Releasing a hold needs a signed transaction, so
the agent service runs it, and the blocklist refresh, on its own Cron Triggers on Cloudflare.

## Tests

```bash
# Decoder, payload parsing, row mapping and the handler (Node, vitest). The fixtures are
# encoded with the SDK's codec, so run `npm install` at the repository root first.
cd supabase/tests && npm install && npm test && npm run typecheck

# Type-check the function the way the Edge runtime sees it.
deno check --no-lock --config supabase/functions/helius-webhook/deno.json \
  supabase/functions/helius-webhook/index.ts

# The database functions, against any database with the migrations applied
# (`npx supabase status` prints the local DB URL). Runs in a transaction and rolls back.
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sql/ingest.test.sql
```

`functions/_shared/holdback.idl.json` is a copy of the SDK's IDL, written by
`npm run idl:sync`; a test fails if the two differ.
