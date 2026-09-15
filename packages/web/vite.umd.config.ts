import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// CHỦ Ý GIỮ vite 6 cho gói này (apps/admin và apps/docs đã ở vite 8).
// Vite 8 dùng rolldown, và khi xuất UMD nó thay `import.meta` bằng `{}`. MapLibre 6 suy URL
// worker từ `import.meta.url` (hàm nội bộ đọc `import.meta.url` rồi kiểm `^https?:`), nên với
// vite 8 bản UMD mất khả năng tự tìm `maplibre-gl-worker.mjs`: đo thật ngày 16/09/2026 thì e2e
// docs rớt từ 44 pass/1 fail xuống 2 pass, playground kẹt ở trạng thái `loading` — đúng lớp sự cố
// 404 worker/shared đã ghi trong DEVLOG 09/09.
// Muốn lên vite 8 thì phải bỏ phụ thuộc vào `import.meta` trước, ví dụ đặt worker URL tường minh
// từ `document.currentScript.src` trong src/umd.ts, rồi nghiệm thu lại bằng e2e docs.

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
