# HOLDBACK evaluation results

Generated 2026-11-27T18:35:21+00:00 at commit `2b17d2576a47d71b4d8d7fd044a41b3366eb0e24` with uncommitted changes by `eval/merge_results.py`. Do not edit: every number here is copied from `eval/results.json`.

## Read this first: limits of this run

- Collector `baseline` was unavailable in 3 of 102 assessments.
- Collector `blocklist` was unavailable in 6 of 102 assessments.
- Collector `chainabuse` was unavailable in 101 of 102 assessments.
- Collector `helius` was unavailable in 8 of 102 assessments.
- Collector `onchain_reputation` was unavailable in 4 of 102 assessments.
- Collector `sns` was unavailable in 4 of 102 assessments.
- Collector `web_reports` was unavailable in 45 of 102 assessments.
- The held-out scam set has n = 3. Intervals this wide support no claim about a rate.
- No sender note is sent, so social-engineering cues, the signal HOLDBACK reads from the sender's own words, are not exercised.
- Dataset source `chainabuse` was unavailable (api.chainabuse.com: HTTP 400); its rows are absent, not estimated.
- Scam labels come from the same public lists the `blocklist` collector reads. When that collector is available, catching a listed address repeats the label; `independent_recall` excludes it.
- The baseline's held-out recall on list-sourced rows is zero by construction: those addresses were published after the cut-off. It becomes informative only with dated reports from another source.
- Sampled legit wallets are presumed legitimate (a transaction over a year old, on no list); they are not verified. Very active wallets are excluded because their age cannot be read cheaply.
- Fresh wallets are unlabelled new wallets and generated keypairs, not known scams.
- Exchange wallets: none: no public, machine-readable list of labelled Solana exchange wallets was found.

## Dataset

Cut-off date: 2026-07-01 (before = dev, on or after = held-out).

| Label / split / source          | Rows |
| ------------------------------- | ---- |
| fresh / fresh / generated       | 30   |
| fresh / fresh / mainnet_sample  | 14   |
| legit / all / explorer_programs | 51   |
| legit / all / mainnet_sample    | 3    |
| scam / dev / ofac               | 1    |
| scam / heldout / ofac           | 3    |

| Source              | Status      | Solana rows | Retrieved  | Note                                                                   |
| ------------------- | ----------- | ----------- | ---------- | ---------------------------------------------------------------------- |
| `ofac`              | ok          | 4           | 2026-11-27 |                                                                        |
| `scamsniffer`       | ok          | 0           | 2026-11-27 | the list holds no Solana address                                       |
| `chainabuse`        | unavailable |             |            | api.chainabuse.com: HTTP 400                                           |
| `explorer_programs` | ok          | 51          | 2026-11-27 | kept when the account is executable on mainnet                         |
| `mainnet_sample`    | ok          | 17          | 2026-11-27 | seed 20261127, anchor slot 474598777; stopped: candidate budget spent  |
| `generated`         | ok          | 30          |            | seeded keypairs; 30 verified to have no mainnet history, 0 not checked |

Examined and left out: `phantom_nft_blocklist` (3054 addresses): mints of spam NFTs, not wallets that receive payments.

## Detection

A recipient counts as caught when its tier is SUSPICIOUS or higher.

| Split    | Method                              | Recall                               | False-positive rate              | Precision                            |
| -------- | ----------------------------------- | ------------------------------------ | -------------------------------- | ------------------------------------ |
| Held-out | Static blocklist                    | 0/3 (0.0%, 95% CI 0.0% to 56.1%)     | 0/54 (0.0%, 95% CI 0.0% to 6.6%) | no rows (n = 0)                      |
| Held-out | HOLDBACK                            | 3/3 (100.0%, 95% CI 43.9% to 100.0%) | 1/54 (1.9%, 95% CI 0.3% to 9.8%) | 3/4 (75.0%, 95% CI 30.1% to 95.4%)   |
| Held-out | HOLDBACK, label's own list excluded | 0/3 (0.0%, 95% CI 0.0% to 56.1%)     |                                  |                                      |
| Dev      | Static blocklist                    | 1/1 (100.0%, 95% CI 20.7% to 100.0%) | 0/54 (0.0%, 95% CI 0.0% to 6.6%) | 1/1 (100.0%, 95% CI 20.7% to 100.0%) |
| Dev      | HOLDBACK                            | 0/1 (0.0%, 95% CI 0.0% to 79.3%)     | 1/54 (1.9%, 95% CI 0.3% to 9.8%) | 0/1 (0.0%, 95% CI 0.0% to 79.3%)     |
| Dev      | HOLDBACK, label's own list excluded | 0/1 (0.0%, 95% CI 0.0% to 79.3%)     |                                  |                                      |
| Undated  | Static blocklist                    | no rows (n = 0)                      | 0/54 (0.0%, 95% CI 0.0% to 6.6%) | no rows (n = 0)                      |
| Undated  | HOLDBACK                            | no rows (n = 0)                      | 1/54 (1.9%, 95% CI 0.3% to 9.8%) | 0/1 (0.0%, 95% CI 0.0% to 79.3%)     |
| Undated  | HOLDBACK, label's own list excluded | no rows (n = 0)                      |                                  |                                      |

## Value still reclaimable in replay

Share of scam-payment value the sender could still pull back if they pressed Undo after the given delay, under the window the Guardian assigned. A plain transfer is 0% at every delay; the blocklist row is the share of payments it flags and so blocks, which does not depend on the delay. No delay distribution is assumed. Payments without a stated amount use an assumed 1,000 USD each (an assumption, not a measurement).

| Split    | Method           | Payments | Amounts stated | Undo after 10 min | Undo after 1 h | Undo after 6 h | Undo after 24 h |
| -------- | ---------------- | -------- | -------------- | ----------------- | -------------- | -------------- | --------------- |
| Held-out | HOLDBACK         | 3        | 0              | 100.0%            | 100.0%         | 100.0%         | 100.0%          |
| Held-out | Static blocklist | 3        |                | 0.0%              | 0.0%           | 0.0%           | 0.0%            |
| Dev      | HOLDBACK         | 1        | 0              | 100.0%            | 0.0%           | 0.0%           | 0.0%            |
| Dev      | Static blocklist | 1        |                | 100.0%            | 100.0%         | 100.0%         | 100.0%          |
| Undated  | HOLDBACK         | 0        | 0              | n/a               | n/a            | n/a            | n/a             |
| Undated  | Static blocklist | 0        |                | n/a               | n/a            | n/a            | n/a             |

## Time to verdict

Median 8,834 ms, p95 14,032 ms over n = 102 first-time assessments (client-side, one request at a time).

## Negative result: wallets less than a day old

Caught: 4/44 (9.1%, 95% CI 3.6% to 21.2%). Windows assigned (seconds): [1800, 21600, 86400].

| Group              | Caught                              | Tiers                               |
| ------------------ | ----------------------------------- | ----------------------------------- |
| generated_keypair  | 0/30 (0.0%, 95% CI 0.0% to 11.4%)   | UNKNOWN 30                          |
| sampled_new_wallet | 4/14 (28.6%, 95% CI 11.7% to 54.6%) | UNKNOWN 10, SUSPICIOUS 3, FLAGGED 1 |

| Undo after | Payments still reclaimable | Share  |
| ---------- | -------------------------- | ------ |
| 10 min     | 44/44                      | 100.0% |
| 1 h        | 4/44                       | 9.1%   |
| 6 h        | 1/44                       | 2.3%   |
| 24 h       | 0/44                       | 0.0%   |

## Latency

| Measurement                         | n   | p50      | p95       |
| ----------------------------------- | --- | -------- | --------- |
| `/v1/assess` (cold)                 | 30  | 4,020 ms | 13,474 ms |
| `/v1/assess` (warm)                 | 30  | 2,292 ms | 9,780 ms  |
| `create_hold` to confirmed (devnet) | 5   | 1,046 ms | 2,108 ms  |
| `reclaim` to confirmed (devnet)     | 5   | 2,500 ms | 2,589 ms  |

## Program invariants

100,000 property-test cases, 609,726 instructions executed, 101,379 holds opened, 0 violations.
