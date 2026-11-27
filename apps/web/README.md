# HOLDBACK web

The web app for HOLDBACK: the dashboard's data layer, public hold receipts, the Solana Action
("pay me" links that become protected payments) and the Scam Dojo API. It is a Next.js 15 App
Router project that runs on Cloudflare Workers through OpenNext.

This package is standalone. It is not part of the repository's npm workspaces and has its own
`node_modules`. It links two packages from the repository:

- `@holdback/sdk` from `../../sdk`
- `@holdback/dojo` from `../../dojo`

Both are consumed from their `dist` folders, so build them first:

```sh
# from the repository root
npm install
npm run build --workspace sdk --workspace dojo
```

## Environment

Copy `.env.example` to `.env.local`. Every value is optional; a missing one switches that
integration off and the app reports it as unavailable. `GET /api/health` shows what is configured.

| Variable                        | Scope  | What it is                                                                |
| ------------------------------- | ------ | ------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | public | Canonical origin of the site. Used for metadata, robots.txt, the sitemap  |
| `NEXT_PUBLIC_AGENT_URL`         | public | Base URL of the risk agent Worker (`services/agent`)                      |
| `NEXT_PUBLIC_SOLANA_CLUSTER`    | public | `devnet` (default), `testnet`, `mainnet-beta` or `localnet`               |
| `NEXT_PUBLIC_SOLANA_RPC_URL`    | public | RPC the browser uses. Empty means the cluster's public endpoint           |
| `NEXT_PUBLIC_SUPABASE_URL`      | public | Supabase project URL                                                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Supabase anon key (row-level security applies)                            |
| `SOLANA_RPC_URL`                | secret | RPC for server reads and the Action; a keyed URL is fine here             |
| `AGENT_URL`                     | secret | Agent URL for server-to-server calls, if different from the public one    |
| `SUPABASE_SERVICE_ROLE_KEY`     | secret | Stores Scam Dojo runs. Without it runs live in memory only                |
| `DOJO_SECRET`                   | secret | Shared with the agent (`DOJO_SECRET` there); derives run seeds and tokens |

Public values are compiled into the browser bundle by `next build`, so they must be set when the
build runs. Secrets are read per request on the server and never reach the browser; the modules
that read them import `server-only`, which fails the build if a client component pulls them in.

A malformed value (a URL without a scheme, an unknown cluster) fails the build with the name of
the variable. Values are never printed.

## Develop

```sh
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
npm run typecheck
npm test
```

## Build and preview

```sh
npm run build          # next build
npm run cf:build       # next build + the Worker bundle in .open-next/
cp .dev.vars.example .dev.vars
npm run preview        # builds, then serves the Worker locally on http://localhost:8787
```

`npm run preview` runs the real Workers runtime (workerd), so it is the place to check headers and
anything that depends on the platform. Secrets for the preview go in `.dev.vars`.

## Deploy to Cloudflare

```sh
npx wrangler login

# Secrets, once per Worker (each command prompts for the value):
npx wrangler secret put SOLANA_RPC_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put DOJO_SECRET

# Public values are read at build time: put them in .env.production
# (or export them in the shell), then:
npm run deploy
```

Set `SOLANA_RPC_URL` before relying on a deployment. The public Solana endpoints
(`api.devnet.solana.com` and the others) answer 403 to any request that carries the `CF-Worker`
header, and Cloudflare adds that header to every request a Worker makes. Without a private RPC the
Action cannot build transactions and receipts fall back to the agent's copy of a hold. The browser
is not affected. `GET /api/health` reports this as `integrations.customRpc`.

`npm run deploy` builds with OpenNext and uploads the Worker named `holdback-web` (see
`wrangler.jsonc`). The first deploy prints a `*.workers.dev` URL. Set `NEXT_PUBLIC_SITE_URL` to the
final origin and deploy again so metadata, the sitemap and robots.txt point at it.

Custom domain: the zone has to be on the same Cloudflare account. Uncomment `routes` in
`wrangler.jsonc`, set the hostname (`"custom_domain": true` creates the DNS record and the
certificate), set `NEXT_PUBLIC_SITE_URL` to `https://<hostname>` and run `npm run deploy`.

Things to check after a deploy:

```sh
curl -s https://<host>/api/health
curl -s https://<host>/actions.json
curl -s "https://<host>/api/actions/pay?to=<address>&amount=1"
curl -sI https://<host>/dojo/watch/<run id> | grep -i content-security-policy
```

## HTTP surface

| Route                                    | What it does                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/health`                        | Build info and which integrations are configured (booleans only)        |
| `GET /actions.json`                      | Solana Actions rules: `/pay` and `/api/actions/**`                      |
| `GET /api/actions/pay?to=&amount=&mint=` | Action metadata with the recipient's current verdict                    |
| `POST /api/actions/pay?to=&amount=`      | Body `{"account": "<payer>"}`; returns the unsigned payment transaction |
| `OPTIONS` on both                        | CORS preflight with the Action headers                                  |
| `/api/dojo/*`                            | The Scam Dojo engine's handler (`@holdback/dojo`)                       |
| `/action-icon.svg`                       | Icon shown on Action cards                                              |

Action parameters: `to` is the recipient address. `amount` is in whole units of the asset
(`12.5`); when it is missing the Action asks the payer for it. `mint` is a mint address, `SOL`
(default) or, on devnet, `USDC`. `lang` is `en`, `hi`, `es` or `pt`.

How the payment is sized: the agent assesses the payer, recipient and amount. A positive window
becomes `create_hold` or `create_hold_sol` with that window, tier and evidence hash. A zero window
becomes `instant_transfer` only if the payer's `Trust` account for the recipient exists on-chain;
otherwise it becomes a hold with the standard window for an unknown recipient (`WINDOW_SECS_BY_TIER` in the SDK). A sanctioned recipient is
refused with 403. If the agent cannot be reached no transaction is built (503).

Response headers: every route gets `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy` and a Content-Security-Policy that forbids framing and limits network access
to the configured agent, RPC and Supabase origins. `/dojo/watch/*` alone gets
`Content-Security-Policy: frame-ancestors https://app.bytearena.fun` instead, because the arena
embeds that page. The rules live in `src/lib/security-headers.ts`.

## Pages and design

The design system is written down in `.design/DESIGN.md` (tokens, type, motion, art, sitemap) on
top of the taste profile in `.design/taste.md`. Styles are plain CSS in `src/styles` (tokens, base,
art, chrome, home, pages, app), fonts are self-hosted in `public/fonts`, and all art is SVG drawn
in code (`src/components/art`). Nothing loads from another origin; if that changes, add the origin
to the policy in `src/lib/security-headers.ts`, or the browser will block it.

| Route                 | File                                             | What it is                                                           |
| --------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `/`                   | `src/app/page.tsx`, `src/components/home/*`      | The claim, the bowl demo, live counters, the whole story in teasers  |
| `/how-it-works`       | `src/app/how-it-works/page.tsx`                  | One payment in five stages, tiers, deposit boxes, limits             |
| `/evidence`           | `src/app/evidence/page.tsx`                      | Evidence hash, collectors, what each key can do, invariants          |
| `/results`            | `src/app/results/page.tsx`, `src/lib/results.ts` | Printed from `eval/results.json` and `eval/program_invariants.json`  |
| `/integrations`       | `src/app/integrations/page.tsx`                  | What each integration does here                                      |
| `/dojo`               | `src/app/dojo/page.tsx`, `src/components/dojo/*` | Scam Dojo, played in the browser against `/api/dojo`                 |
| `/docs`               | `src/app/docs/page.tsx`                          | Commands, addresses, accounts, routes, questions                     |
| `/app`                | `src/app/app/page.tsx`, `src/components/app/*`   | Dashboard: connect, send with verdict and pre-sign slip, holds       |
| `/h/[holdPda]`        | `src/app/h/[holdPda]/*`                          | Public receipt with the in-browser hash check                        |
| `/pay`                | `src/app/pay/page.tsx`                           | Payment request slip (the Action's fallback page)                    |
| `/dojo/watch/[runId]` | `src/app/dojo/watch/[runId]/*`                   | Spectator page; rendered without the site shell because it is framed |
| not found, errors     | `not-found.tsx`, `error.tsx`, `global-error.tsx` | Designed dead ends                                                   |

The shell (header, contents sheet, footer, scroll reveals, page turn) is `src/components/site`.

Motion comes in two layers. The first is CSS and works everywhere: reveals, drawings that draw
themselves, the opening ticket, the page turn. The second is for the story pages only
(`src/components/motion`): GSAP (ScrollTrigger, SplitText) and Lenis are imported inside effects,
after the page is interactive, for split headings, counting figures, leaning buttons, smooth
scroll and the scroll story on `/how-it-works`. `isStoryRoute` in `src/lib/site.ts` keeps all of
it off `/app`, `/h/*`, `/pay` and the spectator page, and with reduced motion none of it loads.

Things a visitor can do: lift the bowl and drag its clock (`home/BowlDemo.tsx`), mark three real
Dojo scenarios (`home/SpotTheScam.tsx`), recompute any hold's evidence hash in the browser
(`site/VerifyAny.tsx`), punch an hour in the footer (`site/PunchRow.tsx`), and turn on the
synthesised punch, stamp and gong sounds (`src/lib/sound.ts`; off by default, no audio files).
Interface copy in the four languages is `src/lib/i18n.ts`; the server renders English and the
reader's saved choice is applied after hydration.

`next.config.ts` reads `eval/program_invariants.json` and `eval/results.json` when the build
starts and compiles their text in, because the Workers runtime has no file system. A missing file
becomes an explicit "not run" state on the results page. Rebuild after `make eval` to publish new
numbers.

`public/action-icon.svg` is the mark shown on Action cards; `src/app/icon.svg` is the favicon and
`public/og.png` the share image.

### Wallet

`WalletProviders` (`src/components/WalletProviders.tsx`) is a client component with no interface.
It is mounted in `src/app/app/layout.tsx`; mount it around any other page that signs. Wallets are
detected through the Wallet Standard. Read them from `useWallet()` (`wallets`, `select`, `connect`,
`disconnect`, `publicKey`) and build the connect controls from that. All hooks marked "wallet"
below must be rendered inside it.

### Hooks (`src/hooks`)

| Hook                                                    | Needs  | Returns                                                                                                                            |
| ------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `useWalletSession()`                                    | wallet | `session`, `status`, `signIn()`, `signOut()`. Signing a message turns on live updates                                              |
| `useHolds(wallet, role)`                                | none   | `holds`, `status`, `mode` (`realtime` or `polling`), `error`, `refresh()`                                                          |
| `useAssessment(recipient, amount, mint, context, lang)` | wallet | `assessment`, `status`, `error`. Debounced; `amount` is base units                                                                 |
| `useSendProtected()`                                    | wallet | `stage`, `prepared`, `signature`, `error`, `prepare(input)`, `send(options)`, `reset()`                                            |
| `useHoldActions(hold)`                                  | wallet | `reclaim`, `releaseEarly`, `release`, `setTrust`, `removeTrust`, `flag`, `close`, `permissions()`, `pending`, `error`, `signature` |
| `useCountdown(releaseAt)`                               | none   | `remainingSecs`, `expired`, `label`                                                                                                |
| `useLiveStats(initial?)`                                | none   | `result` (`stats` and `source`), `status`                                                                                          |
| `useVerifyReceipt({ pda, evidenceHash, document })`     | none   | `status`, `result` (`recomputedHash`, `onChainHash`, `matches`, sources), `verify()`                                               |
| `useDojoWatch(runId, initial?)`                         | none   | `run`, `status`, `error`                                                                                                           |

Notes for the send flow:

- `useSendProtected().prepare()` runs assess, build and simulate and stops at stage `ready`. Show
  the pre-sign card from `prepared` (`assessment`, `plan`, `hold`, `preview.changes`), then call
  `send()`. Stages: `assessing`, `building`, `previewing`, `ready`, `signing`, `confirming`, `done`,
  `error`.
- When `prepared.assessment.requiresConfirmation` is true (a sanctioned recipient), `send()` refuses
  unless called with `{ acknowledgeSanctioned: true }`. Set it only after the user has typed the
  confirmation phrase.
- Errors are `TxError` objects (`src/lib/tx.ts`): switch on `kind`; `program` holds the decoded
  program error when there is one.
- `useHolds` uses Realtime only after `useWalletSession().signIn()` has succeeded. Never call
  `signIn()` without a click.

### Server loaders and pure functions (`src/lib`)

| Function                                                                             | File                   | Use                                                            |
| ------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------- |
| `loadReceipt(pda)`                                                                   | `receipt/load.ts`      | Receipt page data; chain and agent merged, says which answered |
| `verifyReceipt(document, onChainHashBytes)`                                          | `receipt/verify.ts`    | Pure hash check, runs in the browser                           |
| `loadLiveStats()`                                                                    | `stats.server.ts`      | Counters for server rendering                                  |
| `loadDojoWatch(runId)`                                                               | `dojo/watch.server.ts` | First render of the spectator page                             |
| `describePayAction(url, deps)`                                                       | `actions/pay.ts`       | Title, description and label of a pay link                     |
| `holdPermissions(record, wallet, now)`                                               | `holds.ts`             | Which actions to show for a hold                               |
| `explainRecord(record)`                                                              | `format.ts`            | One sentence about a hold (from the SDK's `explain`)           |
| `formatTokenAmount`, `formatAmount`, `formatDuration`, `parseAmount`, `shortAddress` | `format.ts`            | Display helpers                                                |
| `knownMints()`, `mintMeta(address)`, `resolveMint(connection, address)`              | `mints.ts`             | SOL and devnet USDC metadata; decimals for any other mint      |
| `explorerUrl(kind, id)`                                                              | `cluster.ts`           | Explorer links for the configured cluster                      |

## Tests

```sh
npm test
```

The suite covers the Action handlers (validation, verdict text, the decoded instruction for token,
SOL and trusted payments, the sanctioned refusal), `verifyReceipt`, the receipt loader with each
source missing or down, the Dojo routes on the memory store, the header rules and environment
parsing. The agent and the RPC are replaced by fixtures inside `test/` only.
