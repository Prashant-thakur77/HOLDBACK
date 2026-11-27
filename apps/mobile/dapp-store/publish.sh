#!/usr/bin/env bash
# Publishes a version of HOLDBACK to the Solana dApp Store.
#
# The listing itself (texts and images from listing.json and media/) is
# created once in the publisher portal, which also mints the App NFT. This
# script submits an APK as a new version of that listing.
#
#   DAPP_STORE_API_KEY   portal API key (Dashboard > Settings > API keys)
#   PUBLISHER_KEYPAIR    path to the publisher keypair file, kept outside the repo
#
# Usage: dapp-store/publish.sh ["What changed in this version"]
set -euo pipefail
cd "$(dirname "$0")/.."

APK="build/holdback-release.apk"
NOTES="${1:-$(node -p "require('./dapp-store/listing.json').whatsNew")}"

[ -f "$APK" ] || { echo "Build the APK first: npm run build:apk" >&2; exit 1; }
[ -n "${DAPP_STORE_API_KEY:-}" ] || { echo "Set DAPP_STORE_API_KEY." >&2; exit 1; }
[ -f "${PUBLISHER_KEYPAIR:-}" ] || { echo "Set PUBLISHER_KEYPAIR to the publisher keypair file." >&2; exit 1; }

npx --yes @solana-mobile/dapp-store-cli@latest \
  --apk-file "$APK" \
  --keypair "$PUBLISHER_KEYPAIR" \
  --whats-new "$NOTES" \
  --verbose
