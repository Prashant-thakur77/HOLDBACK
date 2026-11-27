import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applySigning } = require('../plugins/withReleaseSigning.js') as {
  applySigning(contents: string): string;
};

/** The relevant part of the `android/app/build.gradle` that `expo prebuild` generates. */
const GENERATED = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('release signing plugin', () => {
  const patched = applySigning(GENERATED);

  it('adds the release signing config next to the debug one', () => {
    expect(patched).toContain('holdbackRelease {');
    expect(patched).toContain("storeFile file('debug.keystore')");
  });

  it('switches only the release build type away from the debug key', () => {
    const debugType = patched.slice(patched.indexOf('buildTypes'), patched.indexOf('release {'));
    const releaseType = patched.slice(patched.indexOf('release {'));
    expect(debugType).toContain('signingConfig signingConfigs.debug');
    expect(releaseType).toContain('signingConfig signingConfigs.holdbackRelease');
    expect(releaseType).not.toContain('signingConfigs.debug');
    expect(releaseType).toContain('minifyEnabled enableMinifyInReleaseBuilds');
  });

  it('never writes a keystore path or password into the build file', () => {
    expect(patched).not.toMatch(/storePassword\s+["'][^"']+["']\s*$/m);
    expect(patched).toContain('findProperty("HOLDBACK_KEYSTORE_PATH")');
  });

  it('is idempotent', () => {
    expect(applySigning(patched)).toBe(patched);
  });

  it('fails loudly when the generated file changes shape', () => {
    expect(() => applySigning('android { }')).toThrow(/signingConfigs/);
  });
});
