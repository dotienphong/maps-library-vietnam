import { defineConfig } from 'vite';

export default defineConfig({
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
