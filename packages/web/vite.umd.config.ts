import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Bản build này CỐ TÌNH không dựa vào cách bundler xử lý `import.meta`.
// Rolldown (vite 8) thay `import.meta` bằng `{}` khi xuất UMD, nên cảnh báo `EMPTY_IMPORT_META`
// lúc build là BÌNH THƯỜNG: nó nói về mã nội bộ của MapLibre 6, chỗ vốn suy URL worker từ
// `import.meta.url`. Rollup (vite 6) từng che chuyện đó bằng shim `document.currentScript`; khi
// đổi sang vite 8 mà còn dựa vào shim ấy thì worker không tải được và e2e docs rớt từ 44 pass
// xuống 2 pass (đo 16/09/2026) — đúng lớp sự cố 404 worker/shared trong DEVLOG 09/09.
// `src/umd.ts` nay tự đặt worker URL từ `document.currentScript.src`, nên ĐỪNG bỏ đoạn đó đi.

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
