# Submission text

One block per track. `LIVE_URL`, `APK_URL`, `VIDEO_URL` and `BYTE_GAME_URL` are filled in at
submission time; every figure is copied from the README results table (generated from
`eval/results.json`) and must be identical everywhere.

## One line

Every Solana payment gets an undo window enforced by an on-chain program, sized by a risk
agent from cited scam evidence, explained by voice in your language, and reversed with one
tap before a scammer can claim it.

## Best App Overall

Payments on Solana are final in under a second, which is what scammers rely on. HOLDBACK puts
each payment in a per-payment vault. Until the window ends only the sender can move the
funds, and only back to the sender; after it, anyone can release them to the recipient. A
risk agent runs eight evidence collectors and a deterministic policy to choose the window:
none for people you trust, 30 minutes for an unknown address, up to 24 hours for a flagged
one. The evidence is hashed and the hash is stored in the hold, so anyone can verify why a
window was set. A voice agent explains the warning in Hindi, English, Spanish or Portuguese
and can trigger the undo. It ships as a Seeker app, a web dashboard with public receipts, a
Blink, an MCP server for AI agents and a game that teaches scam recognition. The program is
covered by 30 Rust tests, 13 localnet scenarios and a 100,000-case property test with zero
invariant violations. Devnet, unaudited.

## Agentic

The agent's decisions are checkable. Eight collectors gather evidence; a published,
deterministic policy maps it to a tier and a window; the language model only extracts quotes
from web pages and writes the spoken explanation, and both outputs are schema-validated. The
complete evidence document is hashed with sha256 over canonical JSON and the hash is written
into the on-chain hold. The receipt page recomputes it in the browser. The agent also acts
on-chain within hard limits: its oracle key can lengthen a running window when new evidence
appears and can do nothing else, which the program enforces. An MCP server lets other AI
agents pay through holds instead of irreversible transfers, and it refuses to pay when no
risk verdict is available.

## DeFi

HOLDBACK is a payment primitive: escrow with a time lock whose only early exit is back to
the payer. It works with SPL Token, Token-2022 and native SOL, costs one account and one
vault per payment (rent is returned), and settles without any party's cooperation because
release is permissionless. It produces a new on-chain signal as a by-product:
`holds_reclaimed_against`, the number of times senders pulled money back from an address,
which protocols can read to price counterparty risk. Wallets and payment apps can embed it
through the SDK or the Solana Action.

## Pollar

Idea: bring undo to seedless wallets that can only make transfers. Flow: the user logs in with
Pollar, proves control of the wallet by sending an exact amount to their own on-chain deposit
box, then pays into the box; a relayer opens the hold, and undo or withdraw can only return
funds to the user's own wallet. Integration: `@pollar/react-native` login and `sendPayment`
with sponsored fees; an on-chain `DepositBox` whose constraints stop the relayer from paying
anyone but the owner, from using a window shorter than the default, and from releasing early.
The roadmap is Pix and UPI ramps, so a first-time user in Brazil or India can pay a stranger
on-chain with the same safety net their bank transfer has.

## Byte

Scam Dojo is an eight-round game. Each round is a realistic message or call transcript with a
payment request; about 40% are legitimate, so refusing everything loses. Moves: ask a
question, verify identity, check the address (which calls the real HOLDBACK agent), pay, pay
with a hold, refuse, report. Paying a scam through a hold recovers half the points, which is
the product's lesson in one rule. The engine is deterministic, every response is the full
JSON state, moves are idempotent by turn, and the final score is written to devnet as a memo.
Game: `BYTE_GAME_URL`.

## Solana Mobile (Seeker)

A native Android app built from the official Solana Mobile template. Holds, undo, early
release, trust and scam reports are signed through Mobile Wallet Adapter. Push notifications
deep-link into the hold with "Tap to undo". A server-side Seeker Genesis Token check shows a
"Verified Seeker owner" badge. The Scam Dojo runs offline in its own tab. APK: `APK_URL`.

## ElevenLabs

The "Holdback Guardian" voice agent speaks Hindi, English, Spanish and Portuguese. At session
start it receives the hold's evidence; its tools read the hold, explain a piece of evidence,
undo the payment, extend the window through the oracle, and mark a recipient trusted. Its
guardrails: it never tells the user to send money, never asks for or repeats seed phrases or
one-time codes, and steers to undo when the user mentions police or arrest calls,
remote-access apps or "verification payments". Suspicious and flagged holds also get a
generated voice note, so the warning reaches people who do not read English.

## Firecrawl

Firecrawl is the evidence collector for the open web. For each recipient it searches for
reports that name the address, scrapes the results to markdown, and a model extracts the
claim, a short quote, the URL and the date. A source counts only if the page text contains
the exact address, checked in code. Cited sources appear on the verdict card and in the
hashed evidence document. The same search-and-scrape pipeline collects public scam reports
for the Scam Dojo scenario corpus.

## Supabase

Postgres stores the evidence documents by hash, a mirror of holds fed by a Helius webhook
through an Edge Function, caches for the collectors, profiles and game runs. Row-level
security lets a wallet read only its own holds; evidence and receipts are fetched by hash or
address through definer functions and cannot be listed; only the service role writes.
Realtime on `holds` drives the countdown rings in the app. Ingest is idempotent: a retried
webhook cannot double-count.

## India

India's own numbers make the case: Rs 22,845.73 crore reported lost to cyber fraud in 2024,
and more than Rs 11,158 crore saved since 2021 by stopping transfers after a prompt report.
Reversibility saves money where it exists. HOLDBACK brings it to on-chain payments, with
warnings spoken in Hindi and a context check tuned to the scripts used here: "digital arrest"
calls, customs and KYC threats, remote-access apps and "verification transfers".

## Links

- Repository: https://github.com/Prashant-thakur77/HOLDBACK
- Program (devnet): `26Tx1zAiL26RfxqTAVDaFaD2TTVku4Hm2vy3LBw8unom`
- Live site: `LIVE_URL`
- APK: `APK_URL`
- Video: `VIDEO_URL`
