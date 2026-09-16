#!/usr/bin/env node
// Chèn khoá demo vào bản build của playground.
//
// `public/` được Astro chép nguyên trạng sang `dist/`, không qua Vite, nên `import.meta.env` không
// dùng được ở đó. Bước này chạy SAU `astro build` và thay chuỗi mốc trong dist bằng
// `PUBLIC_MAPSLIBVN_DEMO_KEY`. Nhờ vậy khoá không nằm trong git và lần xoay khoá sau chỉ cần đổi
// .env rồi build lại.
//
// Thiếu biến thì KHÔNG làm build đỏ: trang vẫn dựng được, ô Khoá API chỉ để trống và người xem tự
// dán khoá của họ. Một trang tài liệu thiếu khoá demo vẫn đọc được; một build đỏ thì không.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MOC = '__MAPSLIBVN_DEMO_KEY__';
const dich = resolve('dist/playground-lib.js');
const key = (process.env.PUBLIC_MAPSLIBVN_DEMO_KEY ?? '').trim();

if (!existsSync(dich)) {
  console.warn(`⚠ Không thấy ${dich} — bỏ qua bước chèn khoá demo.`);
  process.exit(0);
}
if (!key) {
  console.warn(
    '⚠ Thiếu PUBLIC_MAPSLIBVN_DEMO_KEY (apps/docs/.env) — playground sẽ để trống ô Khoá API.',
  );
  process.exit(0);
}
if (!/^mlv_live_[0-9A-Za-z]{24}$/.test(key)) {
  // Chèn một chuỗi sai định dạng vào bản phát hành là tạo ra lỗi 401 mà không ai đoán được nguồn.
  console.error(`✗ PUBLIC_MAPSLIBVN_DEMO_KEY sai định dạng khoá: ${key.slice(0, 13)}…`);
  process.exit(1);
}

const truoc = readFileSync(dich, 'utf8');
if (!truoc.includes(MOC)) {
  console.warn(`⚠ Không thấy chuỗi mốc ${MOC} trong dist/playground-lib.js — bỏ qua.`);
  process.exit(0);
}
writeFileSync(dich, truoc.replaceAll(MOC, key));
console.log(`✔ Đã chèn khoá demo ${key.slice(0, 13)}… vào dist/playground-lib.js`);
