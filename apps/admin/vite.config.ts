import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base /admin/ + outDir dist/admin: Worker assets directory = apps/admin/dist
// → URL /admin/ trỏ file dist/admin/index.html.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: { outDir: 'dist/admin', emptyOutDir: true },
});
