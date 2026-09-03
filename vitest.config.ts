import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/**/*.test.mjs',
      'packages/*/src/**/*.test.{ts,tsx,mjs}',
      'packages/*/tests/**/*.test.ts',
      'pipelines/*/src/**/*.test.{ts,mjs}',
      'pipelines/*/tests/**/*.test.mjs',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/**', '**/*.dbtest.mjs'],
  },
});
