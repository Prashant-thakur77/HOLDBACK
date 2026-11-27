# @holdback/mcp

A Model Context Protocol server that lets an AI agent pay through HOLDBACK instead of sending
irreversible transfers.

An agent that can move money can also be talked into moving it to the wrong place. With this
server, every payment the agent makes is assessed against scam evidence first and then waits in
an on-chain hold for an undo window sized by the risk. Inside the window one tool call brings the
money back. Recipients on a sanctions list are refused, and an optional cap limits what any
single payment can be.

The server speaks MCP over stdio and works with any client that can launch a local MCP server.

## Tools

| Tool                     | Changes state | What it does                                                                                                              |
| ------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `assess_recipient`       | no            | Risk tier, undo window, score, strongest findings with links, evidence hash.                                              |
| `send_protected_payment` | yes           | Assesses, then opens a hold (or pays instantly when the sender trusts the recipient). Refuses sanctioned recipients.      |
| `get_hold`               | no            | One payment by hold address: status, time left, whether it can be undone. Falls back to the off-chain copy once closed.   |
| `list_holds`             | no            | Payments a wallet sent or is due to receive.                                                                              |
| `undo_payment`           | yes           | Returns a pending payment to the sender while the window is open.                                                         |
| `release_early`          | yes           | Pays the recipient now and gives up the undo. Needs `acknowledgeIrreversible: true`.                                      |
| `trust_recipient`        | yes           | Marks a recipient as trusted; later payments to them are instant. Needs `acknowledgeIrreversible: true`.                  |
| `untrust_recipient`      | yes           | Removes that trust.                                                                                                       |
| `flag_recipient`         | yes           | Files an on-chain scam report against an address (one per reporter).                                                      |
| `verify_evidence`        | no            | Fetches the evidence document behind a hold, recomputes its sha256 locally and compares it with the hash stored on-chain. |

Every tool publishes a JSON Schema for its input and its result. Successful calls return
`structuredContent` (and the same JSON as text). Refusals and failures return `isError: true`
with `{ "error": { "code", "message", "details" } }` as text; the codes are stable, for example
`recipient_sanctioned`, `amount_over_cap`, `window_over`, `wallet_required`.

### Amounts

Amounts are decimal strings in display units: `"12.5"` with a USDC mint means 12.5 USDC, and
with `"SOL"` means 12.5 SOL. The server converts them with the mint's own decimals and returns
both forms (`amount` and `amountBaseUnits`). `mint` is the literal `SOL` or a mint address; SPL
Token and Token-2022 mints both work.

### Signing

Tools that change state follow one rule:

- With `HOLDBACK_KEYPAIR` set, the server signs, sends and confirms the transaction and returns
  `status: "sent"` with the signature.
- Without it, nothing is sent. The result has `status: "needs_signature"` and
  `unsignedTransaction`, a base64 versioned transaction for the wallet named in `requiredSigner`
  to sign and send before `lastValidBlockHeight` (about a minute). In this mode the caller passes
  the acting wallet (`sender` or `reporter`).

`status: "no_change"` means the chain was already in the requested state.

## Setup

From the repository root:

```sh
npm install
npm run build --workspace sdk
npm run build --workspace mcp
```

Then add the server to your MCP client's configuration:

```json
{
  "mcpServers": {
    "holdback": {
      "command": "node",
      "args": ["/absolute/path/to/holdback/mcp/dist/index.js"],
      "env": {
        "HOLDBACK_RPC_URL": "https://api.devnet.solana.com",
        "HOLDBACK_GUARDIAN_URL": "https://your-guardian-host",
        "HOLDBACK_MAX_AMOUNT": "50"
      }
    }
  }
}
```

### Environment

| Variable                | Required | Meaning                                                                                                                                                          |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOLDBACK_RPC_URL`      | no       | Solana RPC endpoint. Defaults to `https://api.devnet.solana.com`.                                                                                                |
| `HOLDBACK_GUARDIAN_URL` | yes\*    | Base URL of the Guardian risk service (`services/agent`). \*Without it only the chain-only tools work; payments and assessments are refused.                     |
| `HOLDBACK_KEYPAIR`      | no       | Path to a Solana CLI keypair file, or a base58 secret key. Unset means unsigned-transaction mode.                                                                |
| `HOLDBACK_MAX_AMOUNT`   | no       | Largest single payment, in display units of whatever asset is paid (`50` = 50 USDC or 50 SOL). Checked before anything is assessed or built. Unset means no cap. |

See `.env.example` for the same list with notes on where each value comes from.

## Safety notes

- **Prefer unsigned mode.** Without `HOLDBACK_KEYPAIR` the server holds no key and cannot move
  money; a person or a wallet approves every transaction. Use a keypair only for an agent that
  must act alone, give that wallet only what it may spend, and set `HOLDBACK_MAX_AMOUNT`.
- **The cap is per payment, not per day**, and it is one number for every asset. It limits the
  size of a single mistake; it is not a budget.
- **The key is never logged or returned.** Startup errors name the variable, never its value.
  Logs go to stderr and show RPC and Guardian host names only, since RPC URLs often carry an API
  key. Error messages returned to the client have credential-looking URL parameters removed.
- **No assessment, no payment.** If the Guardian is not configured or does not answer,
  `send_protected_payment` fails; it never falls back to an unassessed transfer.
- **Windows only get longer.** A caller can ask for a longer undo window than the policy
  assigns. A shorter one is ignored.
- **Two tools remove protection**: `release_early` and `trust_recipient`. Both require an
  explicit `acknowledgeIrreversible: true`, and their descriptions tell the model to act only on
  the user's own confirmation, never on a request from the recipient.
- **Evidence text is untrusted.** Findings and quotes come from the open web. The server's
  instructions tell the model to treat them as data. Review your client's own approval settings
  for the tools marked "changes state" above.
- **Local checks are advisory; the program enforces.** Who may undo and when a window ends are
  enforced on-chain. The server pre-checks them to give clear answers,
  and reports the program's own error when the chain refuses.

## Development

```sh
npm run typecheck --workspace mcp
npm test --workspace mcp
npm run build --workspace mcp
```

The tests drive every tool through a real MCP client connected to the server over an in-memory
transport pair. The Solana connection and the Guardian are replaced by in-memory doubles that
live in `test/harness.ts`; account data and transactions are encoded and decoded with the SDK,
so the tests check the actual instructions the server builds.

`createServer(deps)` in `src/server.ts` builds the server from injected dependencies and can be
embedded in another process or served over a different transport.
