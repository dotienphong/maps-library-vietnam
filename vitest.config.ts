import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/**/*.test.mjs',
      'packages/*/src/**/*.test.ts',
      'pipelines/*/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/**'],
  },
});
