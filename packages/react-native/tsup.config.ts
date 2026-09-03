import { defineConfig } from 'tsup';

// Đóng gói @mapslibvn/core vào dist để app cài được bằng MỘT tarball (spec M6 4.1).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // `noExternal` chỉ gộp JS; `dts.resolve` gộp luôn .d.ts của core để tarball tự chứa cả type.
  // `noExternal` gộp JS; `dts.resolve` gộp luôn .d.ts của core (core nằm ở devDependencies
  // để tarball KHÔNG đòi cài @mapslibvn/core chưa publish) — dist tự chứa cả code lẫn type.
  dts: { resolve: ['@mapslibvn/core'] },
  clean: true,
  target: 'es2020',
  external: ['react', 'react/jsx-runtime', 'react-native', '@maplibre/maplibre-react-native'],
  noExternal: ['@mapslibvn/core'],
});
