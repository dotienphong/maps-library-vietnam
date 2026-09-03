import { defineConfig } from 'tsup';

// Đóng gói @mapslibvn/core vào dist để app cài được bằng MỘT tarball (spec M6 4.1).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2020',
  external: ['react', 'react/jsx-runtime', 'react-native', '@maplibre/maplibre-react-native'],
  noExternal: ['@mapslibvn/core'],
});
