# Decisions

Where the build differs from the original plan, and why. Newest last.

## D1. Anchor 1.x instead of 0.32
The installed toolchain is Anchor CLI 1.0.2 with Agave 3.1. The program uses `anchor-lang` and
`anchor-spl` 1.x and the TypeScript client is `@anchor-lang/core`. CPI contexts take a program
id rather than an account info; nothing else about the design changed.

## D2. The zero-window path is its own instruction
The plan put "window 0 for trusted recipients" inside `create_hold`. A hold account and a vault
would then be created (and rent paid) for a payment that never waits. `instant_transfer` and
`instant_transfer_sol` do the direct transfer instead and require the `Trust` PDA through their
account constraints. `create_hold` always has a window of at least one second. The SDK's
`buildCreateHoldTx` picks the right instruction from `windowSecs`.

## D3. Native SOL has parallel instructions
`create_hold_sol`, `reclaim_sol`, `release_sol`, `release_early_sol`. Token and SOL paths need
different accounts; separate instructions keep every account struct free of optional accounts,
which makes the constraints easier to audit. The lamports sit in the hold PDA above its rent.

## D4. Fee-on-transfer mints are refused
After the deposit the program requires the vault to hold exactly `amount`. A Token-2022
transfer-fee mint would leave the vault short and its withheld fees would block closing the
vault. Refusing at creation is safer than a hold that cannot settle. Mints with transfer hooks
fail for the same reason (no extra accounts are forwarded).

## D5. The oracle is tighter than planned
`extend_window` also refuses once the window is over (the recipient is owed the money at that
point) and refuses to lower the tier. The oracle's only writable account is the hold.

## D6. Relayer-opened holds have a floor
Holds opened from a deposit box must use at least `default_window_secs`. If the relayer key is
stolen, the thief cannot pay anyone in less than that time, the owner can still undo, and the
admin can rotate the key. `release_early` never accepts the relayer.

## D7. `initialize_config` is gated on the upgrade authority
Whoever initializes the config chooses the oracle and relayer. The instruction checks the
program's ProgramData account so only the deployer can do it.

## D8. `SubjectStats` uses `init_if_needed`
Every other state account uses `init`. The reputation counter has to exist before the first
hold to a recipient and before the first flag about a subject, whichever comes first, so those
two instructions create it on demand. Its seeds are fixed, it holds only counters, and its
identity fields are written once, so re-initialization cannot change anything. Recipient token
accounts also use `init_if_needed`, as planned.

## D9. SOL holds have a minimum amount
A SOL payout below the rent-exempt minimum fails when the recipient is a new account.
`create_hold_sol` requires `amount >= rent_exempt_minimum(0)` so a release can never be stuck.

## D10. Cloudflare instead of Vercel/Fly
The agent is a Hono app on Cloudflare Workers with Cron Triggers for the crank and the list
refresh. The web app runs on Workers through OpenNext, which lets us set the
`frame-ancestors` header the Dojo watch page needs. One platform, one CLI.

## D11. One Chainabuse key, cached hard
The free tier allows very few requests per month. We use a single key, cache every answer in
`evidence_cache`, and treat the source as "unavailable" when the quota is spent. We do not
rotate free accounts to get around the limit.

## D12. Pollar wallets go through the deposit box only
A Pollar embedded Solana wallet can send SOL or tokens to an address and nothing else: it
cannot sign program instructions or messages. Pollar users therefore pay into their own
`DepositBox` and the relayer opens, undoes and withdraws for them under the on-chain limits
in D6. The box's token account is created by `init_deposit_box`, so the payment itself never
needs to create an account.

## D13. Scam Dojo follows the Byte game spec where it differs from the plan
- **Ending.** The spec decides endings by a field value, so the state carries
  `status: playing | won | lost`. Winning means surviving 8 rounds with at least 900 points.
  A wrong final decision costs a life, except a scam paid through a hold.
- **Deal.** Each run has 3 or 4 legitimate requests rather than independent draws, so
  "always refuse" and "always report" run out of lives every time.
- **Scoring.** A legitimate request paid through a hold earns 80%; reporting a scam adds a
  bonus; the score never decreases, which the declared bets rely on.
- **Secrets.** `dojo_runs` is publicly readable, so the seed and the play token are derived
  with an HMAC from a server secret and never stored. Moves need the token because the watch
  URL exposes the run id.
- **Rejections.** An illegal move, a wrong turn or a finished run returns HTTP 200 with an
  `error` and the full state, so an agent can recover.
- **Memo.** The hash covers `turn|round|move|outcome|points` lines. If the write fails the
  result says so and it can be retried.

## D14. The webhook writes through one SQL function
`ingest_hold_events(jsonb)` applies a whole webhook delivery in one transaction and moves the
daily counters only together with the row change, so a retried delivery cannot count twice.
A settlement or extension that arrives before its hold is answered with 503 so the sender
retries. Raw webhooks are recommended: enhanced payloads carry no logs, and the function then
has to fetch each transaction. USD values are recorded at par for known stablecoins only;
SOL and other mints stay null. `pg_cron` does SQL housekeeping only; the crank and the list
refresh run on the agent's Cron Trigger.

## D15. Evidence and Dojo runs are fetched, not listed
Anonymous clients get one evidence document by hash and one receipt by PDA through definer
functions. Neither table can be listed, and Dojo runs (which contain a run in progress) are
served only by the web app.

## D16. The MCP server fails closed
`send_protected_payment` refuses to pay when the Guardian cannot be reached, refuses
sanctioned recipients, and falls back to the default window when a recipient is rated trusted
but has no on-chain `Trust` account. Irreversible tools (`release_early`,
`trust_recipient`) need an explicit acknowledgement argument. Amounts are in display units.

## D17. Web: server-side reads need a private RPC
The public Solana RPC endpoints answer 403 to requests coming from Cloudflare Workers. Server
reads and the Solana Action therefore use `SOLANA_RPC_URL` (a Helius devnet URL); browsers
keep using the public endpoint.

## D18. The Solana Action refuses rather than guesses
- If the risk agent cannot be reached, `POST /api/actions/pay` returns 503 and builds nothing.
- A sanctioned recipient gets a disabled action and a 403: a Blink cannot collect the typed
  confirmation the app requires.
- When the agent rates a recipient trusted but the payer has no on-chain `Trust` account, the
  payment is a hold with the default window, not an instant transfer.
- The metadata request has no payer, so its verdict is computed for an anonymous sender.
- `/pay` is the shareable page that `actions.json` maps to the API, and the fallback for
  clients without Blink support.

## D19. The Dojo watch page has its own content-security policy
`/dojo/watch/*` sends exactly `frame-ancestors https://app.bytearena.fun`. Every other route
sends the full policy with `frame-ancestors 'none'`.
