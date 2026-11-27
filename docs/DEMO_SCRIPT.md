# Demo script

Four cuts. Every number spoken or shown comes from `eval/results.json`; read it from the
README table on the day of recording, never from memory. Record against devnet with the
deployed program. Lines in quotes are voice-over.

## Before recording

- Two phones or one phone and an emulator: sender (Seeker, Mobile Wallet Adapter) and a
  second wallet as the trusted friend.
- A flagged recipient for the demo: an address that the Guardian rates FLAGGED on the day
  (check with `/v1/assess` first; do not stage a verdict the agent does not give).
- Devnet USDC in the sender wallet, app language set to Hindi, English subtitles on.
- Explorer tab open on the program; receipt page open in a browser.

## Main video (target 2:45, hard limit 3:00)

| Time      | On screen                                                                                                                                                                                                                                           | Voice-over / sound                                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:12 | Black. A message bubble: "Sir, this is customs. Pay the clearance fee now or your parcel is seized." A finger taps Send in a normal wallet. "Confirmed" in under a second.                                                                          | "On Solana a payment is final in under a second. That is exactly what a scammer needs."                                                                                                                               |
| 0:12–0:25 | The figures from the README problem table, one at a time, with their sources in small print.                                                                                                                                                        | "Indians reported losing over twenty-two thousand crore rupees to cyber fraud in 2024. Where a payment can still be stopped, money comes back. On-chain, it cannot be. Until now."                                    |
| 0:25–0:50 | HOLDBACK app, Send screen. Paste the flagged address, type 25 USDC, type the reason "customs fee, they said urgent". The verdict card fills in: FLAGGED, 24-hour window, top three evidence items with links, and "25 USDC will leave your wallet". | "HOLDBACK checks the recipient before you sign: on-chain reputation, blocklists, reports on the web that mention this exact address, and the pressure in the words you were told."                                    |
| 0:50–1:10 | The sender signs with Mobile Wallet Adapter. Hold screen: a ring starts draining from 24 hours. The voice note plays in Hindi; English subtitles.                                                                                                   | The Guardian's own Hindi explanation, unedited. "hold placed" sound.                                                                                                                                                  |
| 1:10–1:30 | Tap "Talk to Guardian". Ask in Hindi: "Should I be worried?" The agent answers and offers to undo. Tap Undo, sign.                                                                                                                                  | "Money returned" sound. "One tap. The program sends the money back to the only place it can go before the window ends: the sender."                                                                                   |
| 1:30–1:45 | Explorer: the `reclaim` transaction, confirmed; the sender's USDC balance restored.                                                                                                                                                                 | "This is not a support ticket. It is an instruction in a Solana program."                                                                                                                                             |
| 1:45–2:00 | Send 5 USDC to the trusted friend. No ring: it arrives at once on the second phone.                                                                                                                                                                 | "People you trust get no wait at all."                                                                                                                                                                                |
| 2:00–2:20 | Receipt page for the first hold. Click "Verify hash": the browser recomputes the sha256 of the evidence and it matches the hash on-chain.                                                                                                           | "Every window is tied to its evidence. Anyone can recompute the hash and compare it with the chain. The model never decides the window; a published policy does."                                                     |
| 2:20–2:35 | The results table from the README, then the line about fresh wallets.                                                                                                                                                                               | Read the held-out recall, false-positive rate and value-recovered figures from the table. Then: "Where it fails: a brand-new scam wallet with no history. That is why even an unknown recipient gets thirty minutes." |
| 2:35–2:45 | Quick flashes: Seeker badge, Pollar login, a Scam Dojo round, the Blink in a browser. End card: program id, repository, "devnet, unaudited".                                                                                                        | "HOLDBACK. Every payment gets an undo window."                                                                                                                                                                        |

## Pollar cut (limit 2:00)

| Time      | On screen                                                                                                                                                           | Voice-over                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Onboarding: choose Pollar, log in with email. A wallet appears with no seed phrase.                                                                                 | "A Pollar wallet needs no seed phrase. It can do one thing on-chain: send."                                                                                       |
| 0:15–0:40 | "Prove it is you": the app asks for an exact small amount; the user sends it; the session unlocks. Show the deposit box address.                                    | "So login is a transfer. You send an exact amount to your own deposit box, and the chain proves the wallet is yours."                                             |
| 0:40–1:10 | Send 20 USDC to a suspicious recipient: the payment goes into the box, the hold opens, the ring starts. Show the hold on Explorer: sender is the user's own wallet. | "The relayer opens the hold for you. The program takes the sender from your box, never from the request, and never accepts a window shorter than the default."    |
| 1:10–1:35 | Tap Undo. Funds return to the Pollar wallet.                                                                                                                        | "Undo goes back to your own wallet. The relayer has no other destination: it cannot pay itself and it cannot release early."                                      |
| 1:35–2:00 | The threat-model table for the relayer; then the app line "refunds can only ever return to your own wallet".                                                        | "The idea: bring undo to wallets that cannot sign programs. The flow: pay into your box, hold, undo. The integration: Pollar login, sendPayment, sponsored fees." |

## Byte clip (60 s)

| Time      | On screen                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:10 | The game page on Byte with the HOLDBACK Scam Dojo card. Start a run.                                                                                                                                                                                    |
| 0:10–0:40 | Byte plays three rounds at speed: a "digital arrest" call (it checks the address, the real Guardian answers, it refuses), a landlord's rent request (it verifies and pays), an unclear one (it pays with a hold). The watch page shows score and lives. |
| 0:40–0:52 | Final round, result screen: score, declared bets met or missed.                                                                                                                                                                                         |
| 0:52–0:60 | The devnet memo signature from the result, opened on Explorer.                                                                                                                                                                                          |

Record one full, unedited Byte run separately and link it; the clip is a cut of that run.

## Seeker clip (60 s)

| Time      | On screen                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:10 | Install the APK on a Seeker (or an Android phone with a wallet). Open, choose Mobile Wallet Adapter, connect. "Verified Seeker owner" badge appears on a Seeker.    |
| 0:10–0:35 | Send to a new address: verdict card, sign in the wallet sheet, ring starts. Lock the phone: the push "Hold placed. Tap to undo" arrives; tap it; it opens the hold. |
| 0:35–0:50 | Undo, sign in the wallet sheet, confirmed.                                                                                                                          |
| 0:50–0:60 | Scam Dojo tab, one round played offline.                                                                                                                            |

## Rules for all cuts

- Show only what happens. If a step fails on the day, re-record; do not cut around it.
- State "devnet" on screen whenever a transaction is shown.
- The same numbers in every cut, the README and the submission form.
