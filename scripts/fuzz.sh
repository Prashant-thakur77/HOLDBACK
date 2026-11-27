#!/usr/bin/env bash
# Runs the invariant property test at full scale and records the counts in
# eval/program_invariants.json, which eval/ merges into eval/results.json.
set -euo pipefail
cd "$(dirname "$0")/.."

CASES="${HOLDBACK_FUZZ_CASES:-100000}"
mkdir -p eval

anchor build
HOLDBACK_FUZZ_CASES="$CASES" \
HOLDBACK_FUZZ_REPORT="$PWD/eval/program_invariants.json" \
  cargo test --release -p holdback --test invariants -- --nocapture

cat eval/program_invariants.json
