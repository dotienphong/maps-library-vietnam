import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'mapslibvn-copy-maplibre-worker',
      closeBundle() {
        for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
          copyFileSync(
            new URL(`node_modules/maplibre-gl/dist/${file}`, import.meta.url),
            new URL(`dist/${file}`, import.meta.url),
          );
        }
      },
    },
  ],
  build: {
    lib: {
      entry: 'src/umd.ts',
      name: 'MapsLibVN',
      formats: ['umd'],
      fileName: () => 'mapslibvn.umd.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: { output: { assetFileNames: 'mapslibvn[extname]' } },
  },
});
