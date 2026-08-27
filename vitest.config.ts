import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/**/*.test.mjs',
      'packages/*/src/**/*.test.{ts,mjs}',
      'pipelines/*/src/**/*.test.{ts,mjs}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/**'],
  },
});
