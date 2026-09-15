// TypeScript 6 thêm TS2882: import side-effect phải có type declaration. `umd.ts` nạp CSS của
// MapLibre để bản UMD tự mang style (xem vite.umd.config.ts) — Vite xử lý import này, TS chỉ cần
// biết nó tồn tại.
declare module '*.css';
