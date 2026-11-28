# Threat model

What HOLDBACK protects, from whom, and what it does not protect. Every claim about the program
below is enforced by account constraints and checked by tests; the test that covers it is
named in brackets.

## What is being protected

A sender's payment during its undo window. The promise is narrow and absolute:

> Until `release_at`, the funds in a hold can only go back to the sender. From `release_at`,
> they can only go to the recipient. Nobody else can ever receive them.

## Parties and what each can do

| Party                     | Can                                                                                                                                                      | Cannot                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Sender                    | Create a hold, undo it before `release_at`, release it early, trust or untrust a recipient                                                               | Redirect a refund to another account, undo after `release_at`                                                   |
| Recipient                 | Receive after `release_at` (anyone can crank it for them)                                                                                                | Receive earlier unless the sender signs, change the window                                                      |
| Anyone (cranker)          | Release a hold whose window is over, close a settled hold                                                                                                | Choose where funds or rent go: both destinations are fixed by the hold                                          |
| Risk oracle (service key) | Lengthen a running window up to `created_at + max`, raise the tier                                                                                       | Move funds, shorten a window, extend after the window ended, lower a tier                                       |
| Relayer (service key)     | For a deposit box: return funds to the owner, open a hold whose sender is the owner with at least the default window, undo such a hold back to the owner | Pay itself or a third party directly, open a hold with a short window, release early, touch wallet-origin holds |
| Admin (upgrade authority) | Rotate service keys, change window limits within the 30-day cap, pause new holds                                                                         | Move funds: there is no admin instruction that touches a vault. Pausing never blocks undo, release or close     |

## Invariants

These are checked after every instruction of a property test that drives random sequences of
operations from honest and hostile signers against a reference model
(`programs/holdback/tests/invariants.rs`; counts in `eval/results.json`).

| #   | Invariant                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------- |
| I1  | Funds leave a vault only to the hold's sender or the hold's recipient                                         |
| I2  | Nothing reaches the recipient before `release_at`, unless the sender signs an early release                   |
| I3  | The oracle never moves funds and never reduces `release_at`                                                   |
| I4  | The relayer can only route funds to the box owner, or to a recipient through a hold whose sender is the owner |
| I5  | Conservation: wallets + boxes + vaults always add up to the initial supply                                    |
| I6  | Every settled hold can be closed, and its rent returns to the account that paid it                            |

## Attacks considered

### Stolen oracle key

The attacker can delay releases of pending holds, up to `max_window_secs` after each hold was
created (72 hours as configured). They cannot take funds, cannot block undo, and cannot touch
a hold whose window already ended. Recovery: the admin rotates `risk_oracle`.
[`oracle_extends_but_never_shortens_and_never_beyond_max`,
`only_the_oracle_extends_and_only_while_the_window_runs`, `extending_moves_no_funds`]

### Stolen relayer key

Applies only to deposit-box users. The attacker can open a hold from a box to an address of
their choice, but never with less than the default window (30 minutes), cannot release it
early, and cannot withdraw to themselves. During that window the owner can undo (the owner's
own signature works; so does the rotated relayer) and the admin rotates `relayer`, after
which the old key can do nothing. Residual risk: an owner whose wallet cannot sign program
instructions depends on the service to undo within the window. This is why the app shows
"refunds can only ever return to your own wallet" and why deposit boxes are meant to hold
only what is about to be sent.
[`relayer_opens_a_hold_whose_sender_is_the_box_owner`,
`withdrawals_from_a_box_only_reach_the_owner`, `a_rotated_relayer_key_loses_all_powers`]

### Front-running `initialize_config`

Whoever initializes the config installs the service keys. The instruction requires the signer
to be the program's upgrade authority, read from the ProgramData account.
[`config_can_only_be_initialized_by_the_upgrade_authority`]

### Redirected refunds, payouts and rent

The refund token account must be owned by `hold.sender`; the payout account is the
recipient's associated token account; SOL destinations must equal the stored addresses; vault
and hold rent go to the stored `rent_payer`. A caller supplies accounts but cannot choose
them. [`nobody_else_can_reclaim_and_refunds_only_reach_the_sender`,
`release_cannot_pay_anyone_but_the_recipient`,
`closing_refunds_every_lamport_of_rent_to_the_rent_payer`]

### Boundary races

At `release_at - 1` the sender can still undo and nobody can release; at `release_at` the
reverse holds. There is no second in which both or neither are possible.
[`sender_reclaims_until_the_last_second_of_the_window`,
`reclaim_fails_from_the_release_second_onwards`,
`anyone_releases_from_the_release_second_and_not_before`]

### Double settlement and replay

Settling closes the vault and changes the status in the same instruction; any second attempt
fails. A nonce cannot be reused while its hold account exists. After `close_hold` the same
sender could reuse a nonce, which creates a new, independent hold: there is nothing left of
the old one to confuse it with. [`a_settled_hold_cannot_be_settled_again`]

### Token edge cases

Fee-on-transfer mints are refused at deposit (the vault must hold exactly `amount`), because
withheld fees would stop the vault from closing. Transfer-hook mints fail at deposit because
no extra accounts are forwarded. A hold's mint is fixed; settling with another mint fails.
SOL holds below the rent-exempt minimum are refused so that a release to a brand-new account
cannot fail. [`a_hold_cannot_be_settled_with_a_different_mint`, `sol_hold_reclaim_and_release`]

### Forged events

The indexer and the SDK accept event data only when it is logged while the HOLDBACK program
is the executing program, so another program cannot make the off-chain mirror believe in a
hold. The chain remains the source of truth for money in every client.

### A dishonest or wrong risk agent

The agent chooses nothing the sender does not sign. A too-short window is a missed warning,
not a loss of control: the sender still has the window they signed. A too-long window delays
an honest recipient by at most the configured maximum, and the sender can release early at
any time. The evidence behind every window is stored, hashed and published; the hash is
on-chain, so the agent cannot later change what it claimed (see "evidence hash" in
`ARCHITECTURE.md`). The language model never decides a tier or a window.

### Sender abuse ("pay, receive the goods, undo")

HOLDBACK is deliberately sender-protective inside the window. A recipient sees the hold, its
release time and its tier before treating the payment as final, exactly as a merchant treats
a pending card payment. Senders who undo often accumulate `holds_reclaimed_against` on their
counterparties' stats, not their own; a sender-side reputation is on the roadmap.

### Reputation farming against an honest recipient

`SubjectStats.flags` and `holds_reclaimed_against` can be inflated with throwaway wallets:
one flag per reporter, and a hold that is created and undone costs only fees. The program
records these counters but never acts on them; only the risk agent reads them, and its policy
treats them as one signal among eight. The resulting harm is a longer window for that
recipient, which the sender can end with an early release. Not yet built: weighting flags by
the reporter's own age and history, and counting reclaims only from senders with prior
released holds.

## Out of scope

- A sender who waits out the window and only then discovers the fraud. The window buys time
  and a warning; it is not insurance.
- Compromise of the sender's own wallet key.
- Tokens whose issuer can freeze or seize balances: a frozen vault cannot be settled until it
  is thawed.
- Denial of service against the off-chain services. Undo, release and close never depend on
  them for wallets that can sign.
- The program is unaudited and deployed on devnet.
