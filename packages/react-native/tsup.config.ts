import { defineConfig } from 'tsup';

// Đóng gói @mapslibvn/core vào dist để app cài được bằng MỘT tarball (spec M6 4.1).
// Entry thứ hai `src/expo/index.ts` → dist/expo/index.js: chỗ duy nhất import Expo (external),
// Metro chỉ resolve khi app import '@mapslibvn/react-native/expo' (spec C 6.4).
export default defineConfig({
  entry: ['src/index.ts', 'src/expo/index.ts'],
  format: ['esm'],
  // `noExternal` gộp JS; `dts.resolve` gộp luôn .d.ts của core (core nằm ở devDependencies
  // để tarball KHÔNG đòi cài @mapslibvn/core chưa publish) — dist tự chứa cả code lẫn type.
  dts: { resolve: ['@mapslibvn/core'] },
  clean: true,
  target: 'es2020',
  external: [
    'react',
    'react/jsx-runtime',
    'react-native',
    '@maplibre/maplibre-react-native',
    'expo-location',
    'expo-task-manager',
    'expo-speech',
    'expo-audio',
    'expo-keep-awake',
  ],
  noExternal: ['@mapslibvn/core'],
});
