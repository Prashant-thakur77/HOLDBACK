/**
 * Config plugin: sign the release variant with the HOLDBACK release keystore.
 *
 * `expo prebuild` regenerates `android/`, and its default release build type
 * is signed with the debug key. This plugin re-applies the signing block on
 * every prebuild. The keystore path and passwords never enter the repository:
 * they come from `~/.gradle/gradle.properties` (or `-P` flags) or from the
 * environment. When they are absent the release variant is left unsigned
 * instead of silently falling back to the debug key.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING_CONFIG = `
        holdbackRelease {
            def keystorePath = findProperty("HOLDBACK_KEYSTORE_PATH") ?: System.getenv("HOLDBACK_KEYSTORE_PATH")
            if (keystorePath) {
                storeFile file(keystorePath)
                storePassword findProperty("HOLDBACK_KEYSTORE_PASSWORD") ?: System.getenv("HOLDBACK_KEYSTORE_PASSWORD")
                keyAlias findProperty("HOLDBACK_KEY_ALIAS") ?: System.getenv("HOLDBACK_KEY_ALIAS") ?: "holdback"
                keyPassword findProperty("HOLDBACK_KEY_PASSWORD") ?: System.getenv("HOLDBACK_KEY_PASSWORD")
            }
        }`;

function applySigning(contents) {
  if (contents.includes('holdbackRelease')) return contents;

  const withConfig = contents.replace(
    /signingConfigs\s*\{/,
    (match) => `${match}${SIGNING_CONFIG}`,
  );
  if (withConfig === contents) {
    throw new Error('withReleaseSigning: no signingConfigs block in android/app/build.gradle');
  }

  // Only the release build type may change; the debug one keeps the debug key.
  const releaseBlock =
    /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
  if (!releaseBlock.test(withConfig)) {
    throw new Error('withReleaseSigning: release build type has no signingConfig line to replace');
  }
  return withConfig.replace(releaseBlock, '$1signingConfig signingConfigs.holdbackRelease');
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: expected a Groovy android/app/build.gradle');
    }
    gradle.modResults.contents = applySigning(gradle.modResults.contents);
    return gradle;
  });
};

module.exports.applySigning = applySigning;
