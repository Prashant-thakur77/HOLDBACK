# HOLDBACK for Solana Seeker

The Android app. Every payment you send gets an on-chain undo window, sized by the Guardian risk
agent from scam evidence. Native Android only (Expo development build, React Native new
architecture); there is no web or PWA target.

- Package `xyz.holdback.app`, deep-link scheme `holdback://`
- Wallets: Mobile Wallet Adapter (Seed Vault, Phantom, Solflare) or Pollar email login
- Languages: English, Hindi, Spanish, Portuguese (switches at once, no restart)

## What is where

```
app/                    expo-router screens
  onboarding.tsx          1 language, wallet choice, optional phone for calls
  (tabs)/index.tsx        2 Home: balances, active holds with countdown rings, incoming
  send.tsx                3 Send: recipient, amount, reason, verdict, window, simulation, sign
  hold/[pda].tsx          4 Hold: countdown, evidence, undo, release, voice, report
  (tabs)/inbox.tsx        5 Inbox: payments on their way to you
  trusted.tsx             6 Trusted people
  (tabs)/dojo.tsx         7 Scam Dojo (offline, on the @holdback/dojo engine)
  (tabs)/settings.tsx     8 Settings: language, notifications, phone, export
src/
  theme/tokens.ts         the design system: colour, type, spacing, motion
  ui/                     components built on the tokens (CountdownRing, Button, Sheet, TabBar…)
  lib/                    logic with no React Native imports; everything here is unit tested
  i18n/                   en, hi, es, pt and the translator
  wallet/                 one useWallet() over Mobile Wallet Adapter and Pollar
  data/                   agent client, React Query hooks, Supabase Realtime
  features/               screen parts (send verdict, evidence list, QR scanner, dojo)
  voice/                  "Talk to Guardian" (ElevenLabs) and its client tools
  push/                   expo-notifications registration and deep-link routing
plugins/                  config plugin that signs the release build
dapp-store/               listing text, media and the publish script
scripts/                  build-apk.sh, render-assets.py
test/                     vitest unit tests
```

The app depends on two packages of this repository through `file:` links: `@holdback/sdk`
(instructions, PDAs, the agent client) and `@holdback/dojo` (the game engine). Build them first.
`metro.config.js` makes their imports resolve from this project, so the bundle has one copy of
`@solana/web3.js`.

## Configure

```bash
cp .env.example .env     # then fill it in
```

Everything named `EXPO_PUBLIC_*` is compiled into the app and is public. Do not put a secret in
`.env`. The app works with an empty file: it then reads holds straight from the chain, signs with
your wallet on devnet, and shows the agent-backed features (verdict, voice, names, push, Pollar)
as unavailable.

| Key                                                         | What it is                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `EXPO_PUBLIC_AGENT_URL`                                     | Base URL of the risk agent (`services/agent`).                        |
| `EXPO_PUBLIC_RPC_URL`, `EXPO_PUBLIC_SOLANA_CHAIN`           | RPC endpoint and the chain the wallet authorizes (`solana:devnet`).   |
| `EXPO_PUBLIC_USDC_MINT`                                     | Payment token. Empty means Circle's devnet USDC.                      |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Enables live updates of holds. Without them the app polls every 15 s. |
| `EXPO_PUBLIC_POLLAR_KEY`                                    | Pollar publishable key. Without it the email login is hidden.         |
| `GOOGLE_SERVICES_JSON`, `EAS_PROJECT_ID`                    | Build-time only, both needed for push (see below).                    |

## Run (development build)

Needs Node 20 or newer, Java 17 and the Android SDK (platform 37, build-tools 37.0.0,
NDK 27.1.12297006, CMake 3.22.1). Expo Go cannot run this app: it uses native modules.

```bash
npm run build --workspace sdk --workspace dojo   # from the repository root, once
cd apps/mobile
npm install
export ANDROID_HOME=$HOME/Android/Sdk
npx expo run:android          # builds the debug app, installs it and starts Metro
```

Later, `npm start` is enough while the installed development build is unchanged.

## Check

```bash
npm run typecheck      # tsc --noEmit, strict
npm test               # vitest: window floor, amounts, countdown, deep links, i18n, Pollar flow…
npm run lint
npm run doctor         # expo-doctor
npm run prebuild       # expo prebuild --platform android
```

## Build a release APK

```bash
npm run build:apk      # -> build/holdback-release.apk
```

The script runs `expo prebuild`, then `./gradlew :app:assembleRelease` for `arm64-v8a` (the Seeker
and every current Android phone), copies the APK to `build/` and prints its signing certificate.

- `HOLDBACK_ABIS=arm64-v8a,x86_64 npm run build:apk` also includes the emulator architecture.
- `HOLDBACK_BUILD_CORES=4 npm run build:apk` caps the native compile at four cores. Use it on a
  machine with little free memory; the full-speed build starts one compiler per core.

Code shrinking (R8) is switched off in `app.config.ts`: wallet, WebRTC and crypto modules are
looked up by name at runtime, and a shrunk build has to be exercised on a device before it ships.

`eas build --platform android --profile dapp-store --local` produces the same kind of APK if you
prefer EAS; the profile is in `eas.json`.

## Sign

`android/` is generated, so the signing setup lives in `plugins/withReleaseSigning.js` and is
re-applied on every prebuild. It reads four values from Gradle properties or the environment and
never from the repository:

```
HOLDBACK_KEYSTORE_PATH=/absolute/path/outside/the/repo/holdback.keystore
HOLDBACK_KEYSTORE_PASSWORD=…
HOLDBACK_KEY_ALIAS=holdback
HOLDBACK_KEY_PASSWORD=…
```

`scripts/build-apk.sh` loads them from `~/.keystores/holdback.properties` (override the location
with `HOLDBACK_SIGNING_PROPERTIES`). To create a keystore:

```bash
mkdir -p ~/.keystores && chmod 700 ~/.keystores
keytool -genkeypair -v -keystore ~/.keystores/holdback.keystore -alias holdback \
  -keyalg RSA -keysize 2048 -validity 10000
```

Keep the keystore and its passwords somewhere safe and backed up. Every update in the dApp Store
must be signed with the same key; a lost key cannot be replaced. If the values are missing the
release variant is left unsigned and the build script stops, so a debug-signed APK can never be
shipped by accident.

Verify any APK before sharing it:

```bash
$ANDROID_HOME/build-tools/37.0.0/apksigner verify --print-certs build/holdback-release.apk
```

## Install

```bash
adb install -r build/holdback-release.apk
```

Or copy the APK to the phone and open it (allow "install unknown apps" for the file manager).

## Test with the Fake Wallet

The Fake Wallet is Solana Mobile's test wallet for Mobile Wallet Adapter. It approves requests
with a throwaway key, so it is for emulators and test devices only.

```bash
npx solana-mobile@latest doctor                         # checks the toolchain
npx solana-mobile@latest emu create local_phone --device pixel_9 --start --tune
npx solana-mobile@latest device install fakewallet
HOLDBACK_ABIS=arm64-v8a,x86_64 npm run build:apk          # an emulator needs x86_64
adb install -r build/holdback-release.apk
```

1. Open HOLDBACK, pick a language, choose **Use my wallet**. The Fake Wallet opens; authorize.
2. Fund the wallet address shown in Settings with devnet SOL and devnet USDC.
3. **Send**: enter another devnet address and an amount. Check the verdict card and the simulated
   balance change, then sign. The Fake Wallet opens again; approve. You land on the hold with its
   countdown ring.
4. **Undo payment** on the hold, approve in the wallet, and the money is back.
5. Dismiss the wallet instead of approving once: the app says you cancelled and nothing was sent.

`adb logcat | grep SolanaMobileWalletAdapter` shows the wallet handshake when something is stuck.
Deep links can be tried with
`adb shell am start -a android.intent.action.VIEW -d "holdback://hold/<hold address>"`.

## Push notifications

The agent sends through the Expo push service, which delivers over FCM. A build needs both:

1. `EAS_PROJECT_ID`: the id of an Expo project (expo.dev), with the FCM v1 service-account key
   uploaded to it (`eas credentials`).
2. `GOOGLE_SERVICES_JSON`: path to the Firebase `google-services.json` for package
   `xyz.holdback.app`. Keep the file outside the repository.

Without them the app builds and runs; Settings shows push as not set up. Notifications deep-link
to `holdback://hold/<address>`.

## Voice

"Talk to Guardian" uses the ElevenLabs React Native SDK over WebRTC. The app asks the agent for a
session (`POST /v1/voice/session`) and never holds an ElevenLabs key. The agent in the ElevenLabs
dashboard must define these client tools, each set to wait for its response: `get_hold_status`,
`explain_evidence` (parameter `source`), `undo_hold`, `extend_hold` (parameter `hours`),
`mark_trusted`. Undo and trust always ask for a tap on the phone before anything is signed.

## Publish to the Solana dApp Store

The store takes an APK signed with your own release key (never the debug key, never an `.aab`).

One time:

1. Create the publisher keypair yourself and keep it outside the repository:
   `solana-keygen new --silent --outfile ~/.config/solana/publisher.json`. Back it up.
2. Import that key into a wallet, open the publisher portal at publish.solanamobile.com, register
   as a publisher and create the app listing with the text in `dapp-store/listing.json` and the
   images in `dapp-store/media/` (512 px icon, 1200x600 banner, four 1080x1920 previews). Fill in
   the website, privacy policy and terms links there; they are empty in `listing.json` on purpose.
   Make sure the portal has minted the App NFT.
3. Create an API key in the portal (Dashboard > Settings > API keys).

The preview images in `dapp-store/media/` are brand cards drawn by `scripts/render-assets.py`.
Replace them with screenshots from a device before submitting:
`adb exec-out screencap -p > dapp-store/media/preview-1.png`.

Every release:

```bash
# bump `version` and `android.versionCode` in app.config.ts first
npm run build:apk
export DAPP_STORE_API_KEY=…                      # from the portal
export PUBLISHER_KEYPAIR=~/.config/solana/publisher.json
dapp-store/publish.sh "What changed in this version"
```

The script calls `@solana-mobile/dapp-store-cli` (1.0.1 or newer) with `--apk-file`, `--keypair`
and `--whats-new`. The portal matches the APK to the listing by its package name. The publisher
wallet needs a little SOL for the transaction. Review by the store takes a few business days.

## Brand images

`npm run assets` (Python 3 with Pillow) redraws the launcher icon, adaptive icon layers, splash
mark, notification icon and store graphics from the same geometry as `src/ui/BrandMark.tsx`.
