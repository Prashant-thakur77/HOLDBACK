# Evaluation and benchmarks. Every number in the README comes from these targets.
#
#   make eval        dataset -> baseline -> Guardian run -> bench -> merge -> README table
#   make eval-test   unit tests of the eval and of the README script
#
# Keys are read from the environment, the repo-root .env and services/agent/.dev.vars.
# A missing key makes its source "unavailable" in the results; nothing is filled in.

PYTHON ?= python3

.PHONY: eval eval-data eval-baseline eval-run bench eval-merge readme eval-test

eval: eval-data eval-baseline eval-run bench eval-merge readme

# Fetch the public lists, sample mainnet wallets, write eval/data/*.csv.
eval-data:
	$(PYTHON) eval/build_dataset.py

# Static blocklist as published before the cut-off.
eval-baseline:
	$(PYTHON) eval/baseline.py

# Assess every address with the Guardian (GUARDIAN_URL, or a local Node process).
eval-run:
	$(PYTHON) eval/run_eval.py

# /v1/assess latency and create_hold / reclaim confirmation times on devnet.
bench:
	npx tsx bench/src/run.ts

# eval/results.json and eval/RESULTS.md.
eval-merge:
	$(PYTHON) eval/merge_results.py

# README.md results block, from eval/results.json.
readme:
	npm run readme:numbers

eval-test:
	$(PYTHON) -m pytest eval -q
	node --import tsx --test bench/test/*.test.ts
