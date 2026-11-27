# HOLDBACK Guardian

The risk agent behind HOLDBACK. For every payment it gathers evidence about the recipient, applies a fixed policy to turn that evidence into a tier and an undo window, hashes the evidence so the window can be verified on-chain, and explains the result in the user's language. It also holds the three service keys: the oracle that can lengthen a window, the relayer for transfer-only wallets, and the crank that releases holds when their window ends.

It is a Hono app on Cloudflare Workers, with Cron Triggers for scheduled work.

## How an assessment works

`POST /v1/assess` runs eight collectors in parallel. Each has its own time budget and fails soft: a source that is slow, down, out of quota or not configured is listed in `unavailable` and adds no points. A collector that misses its budget keeps running in the background so its answer is cached for the next assessment of the same recipient.

The collected signals go to `src/policy.ts`, which is pure: no clock, no network, no model. It returns the score, tier, window, findings and scored evidence. Those form the `EvidenceDocument`, whose sha256 (the SDK's `hashEvidence`) is returned as `evidenceHash` and written into the hold on-chain. `GET /v1/evidence/:hash` returns the document so anyone can recompute the hash.

A language model is used for three things only: to label social-engineering cues in the sender's note, to extract quotes from web pages, and to word the spoken explanation. Each answer is validated against a strict schema, and each has a deterministic fallback (cue patterns, a keyword extractor, per-language templates), so the service gives complete answers with no model configured. The model never sees a choice of tier or window and cannot change either.

### Collectors

| Collector            | Time budget | Cached for |
| -------------------- | ----------- | ---------- |
| `onchain_reputation` | 3.5 s       | not cached |
| `helius`             | 7 s         | 15 min     |
| `blocklist`          | 3 s         | 10 min     |
| `chainabuse`         | 6 s         | 48 h       |
| `web_reports`        | 12 s        | 6 h        |
| `sns`                | 4 s         | 6 h        |
| `context`            | 6 s         | not cached |
| `baseline`           | 3 s         | not cached |

| Collector            | What it reads                                                                                                                                                                                    | Needs                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `onchain_reputation` | The program's `SubjectStats` for the recipient (flags, holds received, undone, completed), the sender's `Trust` account, and reports stored by `POST /v1/flags`                                  | `SOLANA_RPC_URL`       |
| `helius`             | Mainnet history of the recipient: age, transaction count, first funder, four behaviour heuristics, counterparties on a list, earlier transfers from the sender                                   | `HELIUS_API_KEY`       |
| `blocklist`          | OFAC sanctioned addresses and the ScamSniffer address list (exact match); Phantom, ScamSniffer and MetaMask phishing domains for sites named in the sender's note (exact or parent-suffix match) | Supabase, lists loaded |
| `chainabuse`         | Scam reports for the address                                                                                                                                                                     | `CHAINABUSE_API_KEY`   |
| `web_reports`        | Firecrawl search for the exact address (and its primary .sol name) with scam terms, pages as markdown; DeFiLlama token data through Firecrawl when the recipient is a token mint                 | `FIRECRAWL_API_KEY`    |
| `sns`                | The recipient's .sol names, checked for imitation of well-known names                                                                                                                            | none                   |
| `context`            | The sender's answer to "why are you sending this?": cue patterns in English, Hindi, Spanish and Portuguese, plus the model classifier                                                            | none (model optional)  |
| `baseline`           | The sender's own HOLDBACK history: typical amount, time of day, earlier payments to this recipient                                                                                               | Supabase               |

Limits worth knowing:

- **Chainabuse** has one key. Answers are cached for the time in the table and a monthly call budget (`CHAINABUSE_MONTHLY_BUDGET`) is tracked; when it is spent, or the API says the quota is gone, the source is `unavailable` until the next month. Keys are never pooled.
- **Web reports** count a page only if its text contains the exact address or name. That is checked in code by string search before and after the model runs; a quote the model returns must also appear on the page. Explorer sites are excluded from the search because they show every address.
- **Blocklists** are refreshed hourly. Addresses are stored as rows and matched exactly. The domain lists are large, so they are stored as sorted 64-bit hashes in shards; a domain lookup reads one shard per candidate. If the sanctions list has never been loaded the collector reports `unavailable` rather than "not listed".
- **The sender's note** is read once and never stored. Only cue ids leave the collector (and the domain of a listed phishing site, if the note names one). On re-assessment the cue ids are carried over from the earlier evidence document.
- **Helius** looks at mainnet, where long-lived scam wallets are, even though the program runs on devnet. An address is the same key on both.

### Thresholds

| Signal                                  | Fires when                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onchain_reputation.reclaimed_majority` | at least 3 holds received and 50% or more of them undone                                                                                                                                  |
| `onchain_reputation.reclaimed_often`    | at least 3 holds received and 25% or more of them undone                                                                                                                                  |
| `onchain_reputation.clean_releases`     | at least 5 completed payments, none undone, no flags                                                                                                                                      |
| `helius (window)`                       | the last 100 parsed transactions; wallet age from up to 3000 signatures                                                                                                                   |
| `helius.wallet_new_1d`                  | first transaction less than 1 day ago                                                                                                                                                     |
| `helius.wallet_new_7d`                  | first transaction less than 7 days ago                                                                                                                                                    |
| `helius.wallet_established`             | at least 50 transactions, first one at least 180 days ago, no other Helius warning                                                                                                        |
| `helius.sweep_pattern`                  | at least 5 different senders pay in, and 80% or more of at least 3 outgoing transfers go to the same 2 wallets or fewer                                                                   |
| `helius.instant_drain`                  | of at least 3 deposits (each 0.05 SOL or 1 token or more), 60% or more are followed within 10 minutes by outgoing transfers of the same asset worth 90% of the deposit                    |
| `helius.dust_sprayer`                   | at least 20 outgoing transfers of 0.001 SOL or less, to at least 15 different wallets                                                                                                     |
| `helius.burst_activity`                 | younger than 3 days with at least 50 transactions, or younger than 30 days with at least 60 transactions inside one hour                                                                  |
| `helius.prior_history_with_sender`      | at least 2 earlier transfers from the sender in the window                                                                                                                                |
| `chainabuse.confirmed_reports`          | any report marked trusted or checked, or at least 3 reports; at most 10 calls per month by default                                                                                        |
| `web_reports.scam_report`               | one search of 5 results, up to 3 extra scrapes; a page counts only if its text contains the exact address or name; quotes of at most 20 words that appear on the page                     |
| `sns.lookalike_name`                    | same shape after replacing look-alike characters, a well-known name wrapped in a word like "support", or within 1 edit of a well-known name of 5 letters or more (2 edits from 9 letters) |
| `context.*`                             | notes up to 1000 characters; a cue found only by the classifier needs confidence 0.7 or more                                                                                              |
| `baseline.amount_above_typical`         | 5 times the median of at least 5 earlier payments in the same token (20 times for "far above")                                                                                            |
| `baseline.unusual_hour`                 | at least 20 earlier payments and under 2% of them within an hour of this time of day (UTC)                                                                                                |

## Policy

Policy version: `holdback-policy/1.0.0`. The version is part of the hashed document; any change to a rule, weight or threshold must change it.

| Tier       | On-chain value | Window                                     |
| ---------- | -------------- | ------------------------------------------ |
| TRUSTED    | 0              | 0 s with a Trust account, 1 s from history |
| UNKNOWN    | 1              | 1800 s                                     |
| SUSPICIOUS | 2              | 21600 s                                    |
| FLAGGED    | 3              | 86400 s                                    |
| SANCTIONED | 4              | 259200 s                                   |

The tier is decided in this order:

1. An OFAC hit: **SANCTIONED**. `requiresConfirmation` is true and the app must make the user type a confirmation phrase.
2. The sender has a `Trust` account for the recipient: **TRUSTED**, no window.
3. A confirmed scam report, or a score of 60 or more: **FLAGGED**.
4. A score of 30 to 59: **SUSPICIOUS**.
5. At least 3 completed payments from this sender to this recipient, with on-chain flags and reports both known to be zero: **TRUSTED**. The program's zero-window instruction needs the `Trust` account, so this case gets the shortest real hold (1 s) and the crank completes it within a minute.
6. Otherwise: **UNKNOWN**.

The score is the sum of the points below, kept within 0 to 100. A rule counts once unless it says "each". One source has a ceiling of its own, so a long note cannot outweigh everything else: `context`: at most 60 points in total. A signal that is not in this table is ignored.

| Rule                                    | Meaning                                                         | Points               | Sets tier                                                         |
| --------------------------------------- | --------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| `onchain_reputation.trust_account`      | You marked this recipient as trusted                            | 0                    | TRUSTED                                                           |
| `onchain_reputation.onchain_flags`      | Other HOLDBACK users flagged this address on-chain              | +15 each, at most 45 |                                                                   |
| `onchain_reputation.reclaimed_majority` | Most payments to this address were pulled back by their senders | +30                  |                                                                   |
| `onchain_reputation.reclaimed_often`    | Senders have often pulled payments back from this address       | +15                  |                                                                   |
| `onchain_reputation.clean_releases`     | Several payments to this address completed without an undo      | -10                  |                                                                   |
| `onchain_reputation.no_onchain_flags`   | No on-chain flags                                               | 0                    |                                                                   |
| `onchain_reputation.offchain_flags`     | This address was reported to HOLDBACK                           | +10 each, at most 30 |                                                                   |
| `onchain_reputation.no_offchain_flags`  | No reports to HOLDBACK                                          | 0                    |                                                                   |
| `helius.wallet_new_1d`                  | This wallet was created in the last day                         | +15                  |                                                                   |
| `helius.wallet_new_7d`                  | This wallet is less than a week old                             | +8                   |                                                                   |
| `helius.wallet_established`             | Long-lived wallet with steady activity                          | -10                  |                                                                   |
| `helius.no_history`                     | This address has never been used on mainnet                     | +5                   |                                                                   |
| `helius.sweep_pattern`                  | Collects from many senders and forwards to one or two wallets   | +25                  |                                                                   |
| `helius.instant_drain`                  | Incoming funds are moved out within minutes                     | +25                  |                                                                   |
| `helius.dust_sprayer`                   | Sends tiny amounts to many wallets                              | +20                  |                                                                   |
| `helius.burst_activity`                 | Unusual burst of activity for a new wallet                      | +15                  |                                                                   |
| `helius.known_bad_counterparty`         | Transacted with an address on a scam or sanctions list          | +20                  |                                                                   |
| `helius.funded_by_known_bad`            | First funded by an address on a scam or sanctions list          | +25                  |                                                                   |
| `helius.prior_history_with_sender`      | You have paid this wallet before on mainnet                     | -10                  |                                                                   |
| `blocklist.ofac_sanctioned`             | This address is on the OFAC sanctions list                      | +100                 | SANCTIONED                                                        |
| `blocklist.scam_list_address`           | This address is on a published scam list                        | +70                  | FLAGGED (confirmed scam report)                                   |
| `blocklist.phishing_domain_in_context`  | Your note mentions a known phishing site                        | +40                  |                                                                   |
| `blocklist.not_listed`                  | Not on any scam or sanctions list                               | 0                    |                                                                   |
| `chainabuse.confirmed_reports`          | Confirmed scam reports on Chainabuse                            | +60                  | FLAGGED (confirmed scam report)                                   |
| `chainabuse.unconfirmed_reports`        | Unverified scam reports on Chainabuse                           | +25 each, at most 50 |                                                                   |
| `chainabuse.no_reports`                 | No reports on Chainabuse                                        | 0                    |                                                                   |
| `web_reports.scam_report`               | Web pages describe this exact address as a scam                 | +20 each, at most 40 |                                                                   |
| `web_reports.recipient_is_token_mint`   | This address is a token mint, not a wallet                      | +10                  |                                                                   |
| `web_reports.recipient_is_program`      | This address is a program, not a wallet                         | +10                  |                                                                   |
| `web_reports.no_reports`                | No scam reports found on the web                                | 0                    |                                                                   |
| `sns.lookalike_name`                    | Its .sol name imitates a well-known name                        | +30                  |                                                                   |
| `sns.sol_name`                          | Has a .sol name                                                 | 0                    |                                                                   |
| `context.remote_access`                 | A remote-access or screen-sharing app is involved               | +30                  |                                                                   |
| `context.secret_request`                | Someone asked for an OTP, PIN or seed phrase                    | +30                  |                                                                   |
| `context.authority`                     | Someone claims to be police, an official or support staff       | +25                  |                                                                   |
| `context.verification_transfer`         | The payment is described as a verification or test transfer     | +25                  |                                                                   |
| `context.advance_fee`                   | A fee is demanded before money is released                      | +20                  |                                                                   |
| `context.guaranteed_returns`            | Guaranteed or unusually high returns are promised               | +20                  |                                                                   |
| `context.account_unlock`                | The payment is meant to unlock an account or pass KYC           | +20                  |                                                                   |
| `context.gift_cards`                    | Gift cards or voucher codes are involved                        | +20                  |                                                                   |
| `context.secrecy`                       | You were told to keep this secret                               | +15                  |                                                                   |
| `context.urgency`                       | You are being rushed                                            | +10                  |                                                                   |
| `baseline.released_to_recipient`        | You have completed payments to this recipient before            | 0                    | TRUSTED from 3 completed payments, if no flags and score below 30 |
| `baseline.prior_reclaim_from_recipient` | You have undone a payment to this recipient before              | +15                  |                                                                   |
| `baseline.amount_far_above_typical`     | Far larger than your usual payment                              | +15                  |                                                                   |
| `baseline.amount_above_typical`         | Larger than your usual payment                                  | +10                  |                                                                   |
| `baseline.unusual_hour`                 | Unusual time of day for you                                     | +5                   |                                                                   |
| `baseline.first_payment_to_recipient`   | First payment to this recipient through HOLDBACK                | 0                    |                                                                   |

## Endpoints

Errors are always `{ "error": { "code", "message" } }`. CORS is open. Types are in `@holdback/sdk` (`sdk/src/api.ts`).

| Method and path                                                  | Purpose                                                                                                       | Auth                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `POST /v1/assess`                                                | Assess a payment                                                                                              | none                                                         |
| `POST /v1/holds/:pda/reassess`                                   | Re-run collectors for a pending hold; the oracle extends if the tier rose                                     | none (once a minute per hold)                                |
| `GET /v1/holds/:pda`                                             | Receipt: hold, evidence document, spoken text, voice-note link                                                | none                                                         |
| `GET /v1/holds?wallet=&role=`                                    | Holds sent by or addressed to a wallet                                                                        | none                                                         |
| `GET /v1/evidence/:hash`                                         | The hashed evidence document                                                                                  | none                                                         |
| `GET /v1/stats`                                                  | Public counters                                                                                               | none                                                         |
| `POST /v1/flags`                                                 | Report an address (Cloudflare Turnstile token required)                                                       | captcha                                                      |
| `POST /v1/push/register`                                         | Register an Expo push token for a wallet                                                                      | none for a first device; session to replace one              |
| `GET /v1/names/:name`                                            | Resolve a .sol name and say whether it imitates a well-known one                                              | none                                                         |
| `GET /v1/seeker/:wallet`                                         | "Verified Seeker owner" (Seeker Genesis Token on mainnet), SKR balance in base units, primary .skr name       | none                                                         |
| `POST /v1/auth/challenge`, `POST /v1/auth/session`               | Sign-in by signed message; returns a JWT with the claim `wallet` that Supabase accepts                        | signature                                                    |
| `POST /v1/relay/auth/start`, `POST /v1/relay/auth/complete`      | Sign-in for transfer-only wallets by proof-by-transfer                                                        | transfer                                                     |
| `POST /v1/relay/open`, `/v1/relay/reclaim`, `/v1/relay/withdraw` | Open, undo or withdraw through the deposit box                                                                | session                                                      |
| `GET /v1/voice/note/:hash?lang=`                                 | The spoken explanation as MP3                                                                                 | none                                                         |
| `POST /v1/voice/session`                                         | Signed URL and conversation token for the Guardian voice agent, with the hold's evidence as dynamic variables | none, or the sender's session with `VOICE_REQUIRE_AUTH=true` |
| `POST /v1/voice/extend`                                          | Add hours to the caller's own pending hold                                                                    | the sender's session                                         |
| `POST /v1/crank`                                                 | Run the every-minute job now                                                                                  | header `x-crank-secret`                                      |
| `POST /v1/dojo/memo`                                             | Write `holdback-dojo:<run_id>:<score>:<historyHash>` as a memo                                                | `Authorization: Bearer <DOJO_SECRET>`                        |

Sign-in details:

- **Wallets that can sign.** `POST /v1/auth/challenge { wallet }` returns `{ message, challenge, expiresAt }`. The wallet signs `message` (UTF-8) and sends `POST /v1/auth/session { wallet, challenge, signature }` with the signature in base58 or base64. The answer is `{ token, wallet, expiresAt }`; the token is an HS256 JWT with exactly `{ role: "authenticated", wallet, exp }`, signed with the Supabase JWT secret.
- **Transfer-only wallets.** `POST /v1/relay/auth/start { owner, mint }` creates the owner's deposit box if needed and names a random amount. The owner sends exactly that amount from their own token account to the box, then calls `POST /v1/relay/auth/complete { challengeId, secret, signature }`. The service checks on-chain that the transaction succeeded inside the challenge window, that the owner signed it, and that it moved exactly that amount, by the owner's authority, from a token account the owner owns into the box. Each challenge and each transaction works once.

## The three keys

Each key is a secret, accepted as base58 or as the JSON byte array `solana-keygen` writes. None is ever logged; error messages name the variable, not its value.

| Key               | Signs                                                                       | What the program lets it do                                                                                                                                                                         | If it leaks                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORACLE_KEYPAIR`  | `extend_window`                                                             | Move a pending hold's release time later, up to `created_at + max_window_secs`, and raise its tier. Its only writable account is the hold. It cannot shorten a window, lower a tier, or move money. | Holds can be delayed up to the maximum window. No funds can be taken. Rotate with `update_config`.                                                                                                      |
| `RELAYER_KEYPAIR` | `init_deposit_box`, `open_hold_from_deposit`, `reclaim`, `withdraw_deposit` | Open a hold from a deposit box with the box owner as sender and at least the default window; undo a deposit-box hold back to the owner; withdraw from a box to the owner.                           | Money in deposit boxes could be put on hold toward an address of the thief's choosing, but never for less than the default window, during which the owner can undo it and the admin can rotate the key. |
| `CRANK_KEYPAIR`   | `release`, `close_hold`, the Dojo memo, the optional on-chain flag          | Nothing privileged: release and close are open to anyone once a hold is due or settled. It pays fees and the rent of a recipient's token account.                                                   | Its SOL balance. One on-chain flag per address could be added.                                                                                                                                          |

The service adds its own limits on top. The relayer creates a deposit box only for a wallet that already holds enough of the token to make the proving transfer, never opens a hold below the policy window, and refuses to relay a payment to a sanctioned address. The oracle extends only when the policy's tier rose, or when the sender asks through `/v1/voice/extend`. A voice note is synthesised only for evidence that a mirrored hold carries.

## Scheduled work

| Schedule         | Work                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every minute     | Release due holds (from the mirror, or from `getProgramAccounts` when the mirror has none), close settled holds, send pushes: hold placed, 5 minutes before release, released, reclaimed |
| every 10 minutes | Re-assess pending holds; extend those whose tier rose and send the "risk rose" push                                                                                                      |
| hourly           | Refresh the blocklists                                                                                                                                                                   |

Pushes go through Expo. While a hold can still be undone the body ends with "Tap to undo" (translated), and the notification carries the deep link `holdback://hold/<pda>`. For a FLAGGED hold above `OUTBOUND_CALL_MIN_USD`, a sender who verified a phone number also gets one call from the voice agent.

The mirror tables (`holds`, `instant_transfers`, the daily counters) are written only through the database function `ingest_hold_events`, with the same records the chain webhook sends, so both writers are idempotent.

## Voice

- `npm run voice:setup` creates or updates the "Holdback Guardian" agent in ElevenLabs from `src/voice/agent-config.ts`: the prompt, the per-language greetings (Hindi, English, Spanish, Portuguese), language detection, and five client tools (`get_hold_status`, `explain_evidence`, `undo_hold`, `extend_hold`, `mark_trusted`). It prints the agent id for `ELEVENLABS_AGENT_ID`.
- The app starts a session with `POST /v1/voice/session` and passes the returned `dynamicVariables` to the ElevenLabs SDK at session start. Client tools run in the app; `extend_hold` calls `POST /v1/voice/extend`.
- `GET /v1/voice/note/:hash` speaks the explanation with the model in `ELEVENLABS_TTS_MODEL` and caches the MP3 in R2 (binding `VOICE_BUCKET`) or, without it, in the Supabase Storage bucket `voice-notes`.
- `npm run voice:sfx` generates the three interface sounds into `assets/sfx/`.

## Run it

All commands are run from the repository root.

```sh
npm install
cp services/agent/.dev.vars.example services/agent/.dev.vars   # fill in what you have
npm run dev --workspace services/agent                          # wrangler dev on http://localhost:8787
```

```sh
curl -s -X POST http://localhost:8787/v1/assess \
  -H 'content-type: application/json' \
  -d '{"sender":"<address>","recipient":"<address>","mint":null,"amount":"10000000","lang":"en"}'
```

With an empty `.dev.vars` the service still answers: every collector that needs a key or the database is listed in `unavailable`, the tier is UNKNOWN and the window is the default.

Solana's public RPC endpoints refuse requests from the Workers runtime, including the local one `wrangler dev` runs. Set `SOLANA_RPC_URL` (and `MAINNET_RPC_URL`, unless `HELIUS_API_KEY` is set) to a private RPC to use anything that reads or writes the chain. This is required when deployed.

```sh
npm run typecheck --workspace services/agent
npm test --workspace services/agent
npm run blocklists:refresh --workspace services/agent           # load the lists once, from your machine
npm run smoke:devnet --workspace services/agent -- <funded-keypair.json>
```

`smoke:devnet` runs the API in-process against the deployed program: assess, open a hold, let the oracle extend it, extend it again through the voice endpoint, release and close a second hold with the crank, undo the first, and write a Dojo memo. It prints every signature.

## Deploy

```sh
cd services/agent
npx wrangler login
npx wrangler deploy
# once per secret (see .dev.vars.example for the full list and where each comes from)
npx wrangler secret put SOLANA_RPC_URL
npx wrangler secret put ORACLE_KEYPAIR
npx wrangler secret put RELAYER_KEYPAIR
npx wrangler secret put CRANK_KEYPAIR
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_JWT_SECRET
npx wrangler secret put SESSION_JWT_SECRET
npx wrangler secret put CRANK_SECRET
npx wrangler secret put DOJO_SECRET
```

`SOLANA_RPC_URL` is set as a secret because a private RPC URL contains its API key; remove the default from `[vars]` in `wrangler.toml` when you do. The Cron Triggers are declared in `wrangler.toml` and start with the first deploy. The hourly list refresh parses several megabytes of JSON, which needs the Workers Paid CPU limit; on the free plan run `npm run blocklists:refresh` from a machine on a schedule instead. To cache voice notes in R2, create a bucket and uncomment the `r2_buckets` block in `wrangler.toml`.

## Layout

```
src/
  index.ts, app.ts, cron.ts      Worker entry, HTTP app, scheduled jobs
  assess.ts, policy.ts           one assessment; the deterministic policy
  collectors/                    the eight collectors and their pure helpers
  llm/                           model client, spoken explanation, per-language copy
  chain/                         oracle, relayer, crank, proof-by-transfer, memo
  routes/                        HTTP routes
  db/, lib/                      Supabase access; HTTP, cache, JWT, keys, Solana helpers
  push/, voice/, seeker.ts       Expo pushes, ElevenLabs, Seeker checks
scripts/                         voice agent setup, sound effects, list refresh, devnet smoke test
test/                            vitest suites (network access is replaced inside tests only)
```
