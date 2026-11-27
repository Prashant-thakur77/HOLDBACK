# HOLDBACK evaluation

This directory measures what HOLDBACK does, with scripts anyone can run again. The rule for
everything here: a number is published only if a script produced it and it is stored in
`eval/results.json`. A source or key that is missing makes the run smaller, and the results
say which parts were missing. Nothing is filled in.

Results of the latest run: [`RESULTS.md`](RESULTS.md) (generated; it lists the limits of that
run before any number).

## Reproduce

```sh
pip install -r eval/requirements.txt   # pytest only; the pipeline uses the standard library
npm install                            # for the Guardian, the bench and the README script
make eval
```

`make eval` runs these steps in order; each can be run alone.

| Target               | Script                      | Writes                                                          |
| -------------------- | --------------------------- | --------------------------------------------------------------- |
| `make eval-data`     | `eval/build_dataset.py`     | `eval/data/dataset.csv`, `sources.csv`, `blocklist_history.csv` |
| `make eval-baseline` | `eval/baseline.py`          | `eval/data/baseline_predictions.csv`, `baseline_metrics.json`   |
| `make eval-run`      | `eval/run_eval.py`          | `eval/data/assessments.csv`, `eval_metrics.json`                |
| `make bench`         | `bench/src/run.ts`          | `bench/results.json`                                            |
| `make eval-merge`    | `eval/merge_results.py`     | `eval/results.json`, `eval/RESULTS.md`                          |
| `make readme`        | `scripts/readme_numbers.ts` | the block between the results markers in `README.md`            |
| `make eval-test`     | pytest and the Node test    | nothing                                                         |

Keys are read from the environment, then the repo-root `.env`, then (for the Guardian and the
bench) `services/agent/.dev.vars`. Adding a key and running `make eval` again is all it takes
to include what that key unlocks.

| Setting                                     | Effect when set                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GUARDIAN_URL`                              | Evaluate and benchmark a deployed Guardian instead of a local one                                                  |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Guardian: `blocklist` and `baseline` collectors (run `npm run blocklists:refresh --workspace services/agent` once) |
| `HELIUS_API_KEY`                            | Guardian: wallet age and behaviour heuristics. Dataset: faster mainnet sampling                                    |
| `CHAINABUSE_API_KEY`                        | Dataset: dated scam reports. Guardian: abuse-report lookup. The free quota is a few calls per month                |
| `CHAINABUSE_DATASET_PAGES`                  | Pages of reports the dataset builder may request (default 2; each page is one call)                                |
| `FIRECRAWL_API_KEY`                         | Guardian: web reports that name the address                                                                        |
| `MAINNET_RPC_URL`                           | Mainnet RPC for sampling (default: the public endpoint)                                                            |
| `GITHUB_TOKEN`                              | Higher rate limit when reading the history of the public lists                                                     |
| `BENCH_ASSESS_N`, `BENCH_CHAIN_N`           | Requests per phase and hold/undo round trips in the bench                                                          |

Without `GUARDIAN_URL`, `run_eval.py` starts the real service under Node
(`bench/src/guardian-server.ts` wraps the service's own `createApp()` in `node:http`). No
collector is replaced or imitated; one without its key answers "unavailable", and the results
record that per assessment.

## Dataset

`build_dataset.py` downloads every source at run time, keeps the raw files in
`eval/data/raw/` (not committed), and writes one row per address with its source URL and
retrieval date.

**Scam set**

- The OFAC sanctioned-address mirror, Solana file
  (`0xB10C/ofac-sanctioned-digital-currency-addresses`, branch `lists`).
- The ScamSniffer address list (`scamsniffer/scam-database`), filtered to strings that are
  valid Solana addresses (base58, exactly 32 bytes). `sources.csv` records how many passed.
- Chainabuse reports for Solana, when `CHAINABUSE_API_KEY` is set, with the report date and
  the loss in USD when the report states one. The report format could not be checked without
  a key; the parser reads the address, the date and three possible spellings of the loss
  field, and leaves the amount empty otherwise.
- Other public lists: Phantom's NFT blocklist was examined and left out, because it lists
  mints of spam NFTs, not wallets that receive payments (its size is recorded in
  `dataset_meta.json`). No other public, machine-readable list of labelled Solana scam or
  drainer wallets was found. Addresses published only inside articles and reports were not
  transcribed.

**Report date.** For a list kept in git, the report date of an address is the day of the first
commit of the list file that contains it, found by bisection over the file's history. It is
the day the address became available to anyone downloading the list, which is what the
baseline needs. It can be later than the day the authority acted.

**Legit set**

- Program ids from the Solana Explorer's program registry
  (`solana-foundation/explorer`, `app/utils/programs.ts`), kept only when the registry marks
  them as deployed on mainnet and the account is executable on mainnet at build time.
- Wallets sampled from mainnet: fee payers of successful non-vote transactions in recent
  blocks, kept when a transaction at least `MIN_LEGIT_AGE_DAYS` old is found in their history
  and they are on none of the scam lists.
- Exchange and hot-wallet labels: none. No public, machine-readable, citable list for Solana
  was found, and labels from explorers' web pages were not scraped.

**Fresh set** (the negative result)

- New mainnet wallets from the same walk: the whole history fits in one small request and is
  younger than `FRESH_MAX_AGE_HOURS`.
- Generated keypairs that have never been used, checked against mainnet at build time. Their
  secret keys are derived from a public seed, so they must never be funded.

Neither kind is a known scam. They show what the Guardian says about a wallet that new,
which is what it would say about a scammer's brand-new wallet.

**Sampling.** A finalized anchor slot is recorded on the first run. Blocks are chosen at
seeded offsets behind it and candidates are examined in a seeded order, so the same cache
gives the same dataset. Ages are measured against the anchor block's time. Reading a wallet's
age means paging its signatures backwards, which is slow on a public endpoint, so a wallet
whose recent rate of activity would need more than a few thousand signatures to reach back a
year is skipped. The sample therefore leans towards wallets with low or moderate activity.
`dataset_meta.json` records how many candidates were examined and why each was rejected.

**De-duplication.** One row per address. Scam sources for the same address are merged
(earliest date kept). An address on a scam list is never kept as legit or fresh.

**Split.** `CUTOFF_DATE` in `config.py` is fixed. A scam row first published before it is
`dev`; on or after it, `heldout`; without a date, `undated`. The three are always reported
separately. The cut-off was chosen from the publication dates alone, before any assessment was
run, and nothing in the Guardian was tuned on any split. Legit rows have no date and are
shared by all splits.

## Baseline

`baseline.py` flags an address when a static list had published it before the cut-off. That is
what a wallet with a downloaded blocklist can do. Lists as they are today would contain the
held-out addresses; using them would be hindsight.

## Metrics

A recipient is **caught** when its tier is `SUSPICIOUS` or higher (`DETECTION_TIER`).

- **Recall**: caught scam addresses over scam addresses, per split.
- **False-positive rate**: caught legit addresses over all legit addresses.
- **Precision**: caught scam over everything caught. It depends on the scam-to-legit ratio of
  this dataset and does not describe real traffic.
- Each is reported as `k/n` with a Wilson 95% interval. An empty set is reported as `n = 0`,
  not as a rate.
- **Independent recall**: the same, after dropping the evidence of the collector that reads
  the very list the label came from (`LABEL_COLLECTOR`). Catching a sanctioned address by
  looking it up on the sanctions list repeats the label; this figure shows what is left.
- **Value still reclaimable in replay**: a hold is all-or-nothing, and the program accepts an
  undo only while `now < release_at`. A scam payment with window `w` is recovered in full when
  the sender presses Undo after a delay `d < w`, else not at all. No distribution of delays is
  assumed: the table gives the share for each delay in `REPLAY_DELAYS_SECS`. A plain transfer
  is 0% at every delay. Amounts are the stated loss when the source has one; otherwise
  `ASSUMED_AMOUNT_USD`, which is an assumption and is labelled so in the results. While no row
  has a stated amount the shares do not depend on that value.
- **Time to verdict**: client-side time of the first `/v1/assess` call for each address, one
  request at a time, with an untimed pause between requests so that a public RPC endpoint's
  rate limit is not what gets measured.
- **Latency** (`bench/`): `/v1/assess` p50 and p95, cold (recipients never seen) and warm (the
  same again); `create_hold` and `reclaim` from send to `confirmed` on devnet, using the SDK
  and a throwaway keypair funded from `keys/deployer.json` with a fixed small amount that is
  returned at the end.
- **Program invariants**: copied from `eval/program_invariants.json`, which the program's
  property test writes.

## Threats to validity

- **Small scam set.** Public, labelled Solana scam wallets are scarce. With a handful of
  rows the intervals are wide and no rate should be quoted without them.
- **Labels and one collector share a source.** The `blocklist` collector reads the lists the
  labels come from. Once it is configured, recall on those rows is close to a lookup.
  `independent_recall` is the figure to read then.
- **The baseline's held-out recall is zero by construction** for list-sourced rows: they were
  published after the cut-off. The comparison becomes informative with dated reports from a
  different source (Chainabuse).
- **Legit wallets are presumed, not verified.** Old and unlisted is not proof of honesty, and
  the sample excludes very active wallets.
- **Programs are not payment recipients.** They test that well-known addresses are not
  flagged, which is a weaker claim than a low false-positive rate on real payees.
- **No sender note.** The dataset has addresses, not conversations, so the cues HOLDBACK reads
  from the sender's own words are not exercised. Scams that are caught only that way are
  missing from both sides of the comparison.
- **The replay assumes the victim presses Undo.** It measures what is still possible at each
  delay, not what victims would do.
- **Unavailable collectors.** A run without some keys measures that configuration only.
  `results.json.environment` lists what answered.

## Files

```
config.py          cut-off, seed, tiers, delays, the assumed amount
addresses.py       base58, address validation, ed25519 public keys
net.py             cached HTTP and RPC with retries
sources.py         the public sources and their parsers
chain_sample.py    seeded sampling of mainnet wallets
dataset.py         rows, merge, de-duplication, split
splits.py          the time split
metrics.py         Wilson intervals, recall / FPR / precision, percentiles
replay.py          replay arithmetic
evaluate.py        metrics per split, independent recall, the fresh-wallet case
build_dataset.py   step 1
baseline.py        step 2
run_eval.py        step 3
merge_results.py   step 5
tests/             pytest
```
