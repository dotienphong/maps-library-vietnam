import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/**/*.test.mjs',
      'packages/*/src/**/*.test.{ts,tsx,mjs}',
      'packages/*/tests/**/*.test.ts',
      'pipelines/*/src/**/*.test.{ts,mjs}',
      'pipelines/*/tests/**/*.test.mjs',
      'apps/docs/scripts/**/*.test.mjs',
      'apps/docs/src/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/**/node_modules/**',
      'apps/**/dist/**',
      'apps/**/e2e/**',
      '**/*.dbtest.mjs',
    ],
  },
});
