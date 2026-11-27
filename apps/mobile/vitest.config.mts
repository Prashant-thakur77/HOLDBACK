import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Unit tests cover the logic in `src/lib` and `src/i18n`, which has no React Native imports. */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
