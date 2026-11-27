#!/usr/bin/env bash
# Runs the TypeScript integration tests against a throwaway local validator
# with the program loaded as upgradeable (keys/deployer.json is the upgrade
# authority, as on devnet).
set -euo pipefail
cd "$(dirname "$0")/.."

WALLET="${ANCHOR_WALLET:-keys/deployer.json}"
PROGRAM_ID=$(solana-keygen pubkey target/deploy/holdback-keypair.json)
LEDGER=$(mktemp -d)
PORT=8899

[ -f "$WALLET" ] || solana-keygen new --no-bip39-passphrase --silent -o "$WALLET"

solana-test-validator --reset --quiet --ledger "$LEDGER" --rpc-port "$PORT" \
  --mint "$(solana-keygen pubkey "$WALLET")" \
  --upgradeable-program "$PROGRAM_ID" target/deploy/holdback.so "$WALLET" &
VALIDATOR=$!
trap 'kill "$VALIDATOR" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  solana cluster-version --url "http://127.0.0.1:$PORT" >/dev/null 2>&1 && break
  sleep 1
done

ANCHOR_PROVIDER_URL="http://127.0.0.1:$PORT" ANCHOR_WALLET="$WALLET" \
  npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.ts'
