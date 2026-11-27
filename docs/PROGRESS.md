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
- [x] Devnet deploy: program `26Tx1zAiL26RfxqTAVDaFaD2TTVku4Hm2vy3LBw8unom`, config `Cz9e3k72qaDnQJNo6deUXVdE823HcFrhkV36Zj92s9tw`
  - deploy tx `4Zw6PJByZcYV5MwWdpnCVJfdqZ8ABXW5wc7Fa7Aasyv4vDbfFriXgc9fGZU5kcBB4H26PfoktKeTzYgk3VrwNVX1`
  - config tx `prJ7uUMMnmhL5qtrkDC2NBN7J945m5QVxrPQL5m1w9HGRrdYKFchhj6u6DXpNX5qfxfjLLbptKUC4XTpomvarF8`
- [x] Reproducible build: Docker-built binary deployed, on-chain hash `37786c06…f22f5` matches
  - upgrade tx `2smysEgNrDVYgyfeYYrR43PooHW5s9Qu32B1Sksv2LUFBHTgkXbWdzUx9AUL6Rsyrdt2xA8siM5HjWDmZHAgpudg`

## Phase 2: SDK

- [x] PDAs, builders, decoders, event parser, `explain`, evidence hashing, API client, vitest (27 tests)

## Phase 3: Supabase

- [x] Schema migration with RLS and Realtime
- [x] `helius-webhook`, housekeeping cron, seed (tested against a local Postgres; no hosted project yet)

## Phase 4: risk agent

- [x] Collectors, policy, evidence hash, LLM extraction, oracle, relayer, crank (221 tests; devnet run under Node)

## Phase 5: voice

- [ ] Guardian agent (hi, en, es, pt), TTS notes, outbound call, SFX: code complete, never run (needs an ElevenLabs key)

## Phase 6: Seeker app

- [x] MWA flow, Pollar deposit box, 8 screens, push, Seeker badge, signed APK (137 tests)
- [ ] Run on a device or emulator

## Phase 7: web

- [x] Functional layer: Action/Blink, Dojo API, receipt verification, hooks (88 tests)
- [x] Designed site: home, how it works, evidence, results, integrations, Scam Dojo, docs, 404; dashboard, receipts, `/pay`, watch page (Lighthouse mobile home 98/100/100/100)

## Phase 8: Scam Dojo

- [x] Engine, 65 scenarios, API, memo, `BYTE_GAME.md` (101 tests)
- [ ] Upload to Byte and one recorded run

## Phase 9: eval and bench

- [x] Dataset, baseline, metrics, replay, latency, negative result (`make eval`; limited by missing keys, stated in the results)

## Continuous integration
- [x] CI green: secret scan, program (build, Rust tests, property test, localnet), packages, web, eval

## Phase 10: docs and submission

- [x] README, architecture, threat model, references, demo script, submission text
- [ ] Deploy (needs a private RPC and a Supabase project), release with APK, videos
