import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Console build vào THƯ MỤC CON của `apps/admin/dist`, vì binding `[assets]` của Worker chỉ nhận
 * đúng một thư mục và nó đang trỏ `../admin/dist`. Gộp hai SPA vào một cây tệp là cách rẻ nhất để
 * cả hai cùng được phục vụ mà không phải thêm bước chép hay đổi wrangler.toml.
 *
 * `emptyOutDir` phải TẮT: bật lên thì lần build console xoá sạch bản admin nằm cùng thư mục cha.
 * Vì vậy CI cũng phải build admin TRƯỚC console.
 */
export default defineConfig({
  base: '/console/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // @mapslibvn/ui là source trong workspace; bảo đảm nó và console dùng CÙNG một bản React,
    // nếu không hook trong component dùng chung sẽ ném "Invalid hook call".
    dedupe: ['react', 'react-dom'],
  },
  build: { outDir: '../admin/dist/console', emptyOutDir: false },
});
