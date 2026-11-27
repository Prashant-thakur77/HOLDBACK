import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The SDK is a linked CommonJS package, so Node loads it (and the
 * `@solana/web3.js` it requires) natively. The app's own imports of
 * `@solana/web3.js` are pointed at that very file, so tests run with a single
 * copy of the library, as the bundled app does.
 */
const sdkEntry = fs.realpathSync(
  path.resolve(__dirname, 'node_modules/@holdback/sdk/package.json'),
);
const web3Entry = createRequire(sdkEntry).resolve('@solana/web3.js');

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // `server-only` throws outside a React server build; tests import server modules directly.
      'server-only': path.resolve(__dirname, 'test/stubs/server-only.ts'),
      '@solana/web3.js': web3Entry,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    server: { deps: { external: [/\/(sdk|dojo)\/dist\//] } },
  },
});
