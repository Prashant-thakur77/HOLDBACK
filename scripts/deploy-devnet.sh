#!/usr/bin/env bash
# Builds and deploys the program to devnet, then initializes the config.
#
# Needs keys/deployer.json (upgrade authority and admin) funded with ~5 SOL,
# plus keys/oracle.json, keys/relayer.json and keys/holdback-program.json.
# Set HELIUS_DEVNET_RPC in .env to use a private RPC; the public one works too.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && set -a && source .env && set +a
RPC="${HELIUS_DEVNET_RPC:-https://api.devnet.solana.com}"
WALLET="keys/deployer.json"
PROGRAM_KEYPAIR="keys/holdback-program.json"
ADMIN=$(solana-keygen pubkey "$WALLET")

echo "Deployer: $ADMIN"
BALANCE=$(solana balance "$ADMIN" --url "$RPC" | awk '{print $1}')
echo "Balance:  $BALANCE SOL"
if awk "BEGIN{exit !($BALANCE < 5)}"; then
  echo "Requesting an airdrop..."
  solana airdrop 5 "$ADMIN" --url "$RPC" || {
    echo "Airdrop failed. Fund $ADMIN at https://faucet.solana.com (devnet) and run again."
    exit 1
  }
fi

mkdir -p target/deploy
cp "$PROGRAM_KEYPAIR" target/deploy/holdback-keypair.json
anchor keys sync
anchor build
node scripts/sync-idl.mjs

solana program deploy target/deploy/holdback.so \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$WALLET" \
  --url "$RPC"

solana program show "$(solana-keygen pubkey "$PROGRAM_KEYPAIR")" --url "$RPC" --keypair "$WALLET"

ANCHOR_PROVIDER_URL="$RPC" ANCHOR_WALLET="$WALLET" npx tsx scripts/init-config.ts
