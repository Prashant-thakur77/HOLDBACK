# HOLDBACK

Every Solana payment gets an undo window enforced by an on-chain program. A risk agent sizes
that window from live, cited scam evidence: no wait for people you trust, up to 24 hours for a
flagged wallet. When the recipient looks dangerous, a voice in your language explains why, and
one tap brings the money back before a scammer can claim it.

> Status: under active development. Sections below fill in as each part lands; every number in
> this file is generated from `eval/results.json`.

## Repository layout

| Path | What it is |
| --- | --- |
| `programs/holdback` | The Anchor program: holds, undo, release, trust, deposit boxes, flags |
| `programs/holdback/tests` | LiteSVM tests with clock warping and the invariant property test |
| `tests/` | Localnet integration tests (ts-mocha) |
| `sdk/` | `@holdback/sdk`: PDAs, instruction builders, decoders, event parser |
| `services/agent/` | `@holdback/guardian`: risk agent, oracle signer, relayer, cranker |
| `mcp/` | `@holdback/mcp`: Model Context Protocol server so AI agents pay through HOLDBACK |
| `apps/mobile/` | Seeker app (Expo, Mobile Wallet Adapter) |
| `apps/web/` | Landing, dashboard, public hold receipts, Solana Action, Dojo watch page |
| `dojo/` | `@holdback/dojo`: Scam Dojo game engine |
| `supabase/` | Migrations, row-level security, edge function, seed |
| `eval/`, `bench/` | Dataset builder, metrics, baseline, replay, latency benches |
| `docs/` | Architecture, threat model, decisions, demo script |

## Quick start

```bash
npm install
anchor build && npm run idl:sync
npm run program:test        # Rust tests + 2,000-case property test
npm run program:fuzz        # 100,000-case property test, writes eval/program_invariants.json
```

## License

MIT
