# Progress

Checked items are built, tested and committed.

## Phase 0: understand, then clean
- [x] Inventory of the workspace (internal)
- [x] Remove unrelated code; single `holdback` program and workspace layout
- [x] New program keypair, `anchor keys sync`
- [x] README skeleton, npm workspaces

## Phase 1: program
- [x] Accounts, instructions, events, errors (SOL, SPL Token, Token-2022)
- [x] Rust tests with clock warping (LiteSVM)
- [x] Property test for invariants I1–I6
- [x] 100,000-case run recorded in `eval/program_invariants.json` (609,726 instructions, 0 violations)
- [x] Localnet TypeScript integration tests (13 scenarios)
- [ ] Devnet deploy, program ID recorded (waiting for devnet SOL)
- [ ] Verified build attempt

## Phase 2: SDK
- [x] PDAs, builders, decoders, event parser, `explain`, evidence hashing, API client, vitest (27 tests)

## Phase 3: Supabase
- [x] Schema migration with RLS and Realtime
- [ ] `helius-webhook`, housekeeping cron, seed

## Phase 4: risk agent
- [ ] Collectors, policy, evidence hash, LLM extraction, oracle, relayer, crank

## Phase 5: voice
- [ ] Guardian agent (hi, en, es, pt), TTS notes, outbound call, SFX

## Phase 6: Seeker app
- [ ] MWA flow, Pollar deposit box, 8 screens, push, Seeker badge, APK

## Phase 7: web
- [ ] Landing, dashboard, receipts, Action/Blink, Dojo watch page

## Phase 8: Scam Dojo
- [ ] Engine, scenarios, API, memo, `BYTE_GAME.md`

## Phase 9: eval and bench
- [ ] Dataset, baseline, metrics, replay, latency, negative result

## Phase 10: docs and submission
- [ ] README, architecture, threat model, demo script, submission text
