#!/usr/bin/env bash
# Builds a signed release APK into build/holdback-release.apk.
#
# Signing values come from a properties file OUTSIDE the repository
# (default ~/.keystores/holdback.properties) with these keys:
#   HOLDBACK_KEYSTORE_PATH, HOLDBACK_KEYSTORE_PASSWORD, HOLDBACK_KEY_ALIAS, HOLDBACK_KEY_PASSWORD
# or from the environment. Without them the build stops instead of producing
# an APK signed with the debug key.
set -euo pipefail
cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
if [ ! -d "$ANDROID_HOME/platforms" ]; then
  echo "Android SDK not found at $ANDROID_HOME (set ANDROID_HOME)." >&2
  exit 1
fi

SIGNING_FILE="${HOLDBACK_SIGNING_PROPERTIES:-$HOME/.keystores/holdback.properties}"
if [ -f "$SIGNING_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$SIGNING_FILE"
  set +a
fi
if [ -z "${HOLDBACK_KEYSTORE_PATH:-}" ] || [ ! -f "${HOLDBACK_KEYSTORE_PATH}" ]; then
  echo "No release keystore. Create one (see README, 'Sign') and point $SIGNING_FILE at it." >&2
  exit 1
fi

# arm64-v8a is what the Seeker and every current Android phone run. Add x86_64 to also run on an
# emulator: HOLDBACK_ABIS=arm64-v8a,x86_64
ABIS="${HOLDBACK_ABIS:-arm64-v8a}"

# The native compile starts one compiler per core. On a machine short of memory, cap it:
# HOLDBACK_BUILD_CORES=4
LIMIT=()
WORKERS=()
if [ -n "${HOLDBACK_BUILD_CORES:-}" ]; then
  LIMIT=(taskset -c "0-$((HOLDBACK_BUILD_CORES - 1))")
  WORKERS=(--max-workers="$HOLDBACK_BUILD_CORES")
fi

npx expo prebuild --platform android --no-install
(cd android && "${LIMIT[@]}" ./gradlew :app:assembleRelease -PreactNativeArchitectures="$ABIS" "${WORKERS[@]}")

mkdir -p build
cp android/app/build/outputs/apk/release/app-release.apk build/holdback-release.apk

APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)apksigner"
CERTS="$("$APKSIGNER" verify --print-certs build/holdback-release.apk)"
echo "$CERTS" | grep -E 'certificate DN|SHA-256 digest'
if echo "$CERTS" | grep -q 'CN=Android Debug'; then
  echo "The APK is signed with the debug key; the signing config did not apply." >&2
  exit 1
fi
echo "Built build/holdback-release.apk ($(du -h build/holdback-release.apk | cut -f1))"
