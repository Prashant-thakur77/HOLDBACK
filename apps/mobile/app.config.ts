import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

const INK = '#0B0D10';

/**
 * Push needs the Firebase file for this package. It is a per-developer
 * credential, so it is read from outside the repository when present and the
 * app still builds (with push switched off at runtime) when it is not.
 */
function googleServicesFile(): string | undefined {
  const candidate = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  const absolute = resolve(__dirname, candidate);
  return existsSync(absolute) ? absolute : undefined;
}

/** Mobile Wallet Adapter classes that must survive if code shrinking is ever switched on. */
const MWA_KEEP_RULES = [
  '-keep class com.solana.mobilewalletadapter.** { *; }',
  '-keep class com.solanamobile.** { *; }',
].join('\n');

/** A local agent over http:// (emulator to host) needs cleartext; an https agent must not allow it. */
const agentIsCleartext = (process.env.EXPO_PUBLIC_AGENT_URL ?? '').startsWith('http://');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'HOLDBACK',
  slug: 'holdback',
  scheme: 'holdback',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  backgroundColor: INK,
  icon: './assets/images/icon.png',
  platforms: ['android'],
  android: {
    package: 'xyz.holdback.app',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-foreground.png',
      monochromeImage: './assets/images/adaptive-monochrome.png',
      backgroundColor: INK,
    },
    googleServicesFile: googleServicesFile(),
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE',
    ],
    blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
    intentFilters: [
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'holdback' }],
      },
    ],
  },
  plugins: [
    ['expo-dev-client', { launchMode: 'most-recent' }],
    'expo-router',
    'expo-font',
    'expo-secure-store',
    'expo-localization',
    'expo-sharing',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        backgroundColor: INK,
        image: './assets/images/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
      },
    ],
    [
      'expo-notifications',
      { icon: './assets/images/notification-icon.png', color: '#C6F36B', defaultChannel: 'holds' },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'HOLDBACK uses the camera to scan a payment QR code.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission:
          'HOLDBACK uses the microphone when you talk to Guardian or dictate a payment note.',
      },
    ],
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'HOLDBACK uses the microphone to turn your spoken note into text.',
        speechRecognitionPermission:
          'HOLDBACK uses speech recognition to turn your spoken note into text.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
      },
    ],
    '@livekit/react-native-expo-plugin',
    '@config-plugins/react-native-webrtc',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: agentIsCleartext,
          // Wallet, WebRTC and crypto modules are looked up by name at runtime. Shrinking stays off
          // until a release build has been exercised on a device with these rules in place.
          enableMinifyInReleaseBuilds: false,
          extraProguardRules: MWA_KEEP_RULES,
        },
      },
    ],
    './plugins/withReleaseSigning',
  ],
  experiments: { typedRoutes: true },
  extra: {
    router: {},
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : {},
  },
});
