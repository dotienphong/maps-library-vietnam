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
// Ngược lại, khoá SAI ĐỊNH DẠNG thì dừng hẳn: nó tạo ra 401 mà không ai đoán được nguồn.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const MOC = '__MAPSLIBVN_DEMO_KEY__';
export const BIEN = 'PUBLIC_MAPSLIBVN_DEMO_KEY';
export const DANG_KHOA = /^mlv_live_[0-9A-Za-z]{24}$/;

/**
 * Đọc một biến từ file .env. Astro tự nạp .env cho `import.meta.env`, nhưng script `postbuild`
 * chạy bằng `node` thì KHÔNG — thiếu bước này, playground lặng lẽ không có khoá trong khi trang
 * React demo thì có, và không ai hiểu vì sao hai chỗ lệch nhau.
 *
 * Bóc cả nháy đơn lẫn nháy kép: `KEY='mlv_live_…'` là cách viết hợp lệ trong .env và dotenv cũng
 * bóc như vậy, nên script này phải hiểu giống hệt.
 *
 * @param {string} duong đường dẫn file .env
 * @param {string} ten tên biến
 */
export function docBienEnv(duong, ten) {
  if (!existsSync(duong)) return '';
  for (const dong of readFileSync(duong, 'utf8').split('\n')) {
    const sach = dong.trim();
    if (!sach || sach.startsWith('#') || !sach.startsWith(`${ten}=`)) continue;
    const gia = sach.slice(ten.length + 1).trim();
    const coNhay =
      gia.length >= 2 &&
      ((gia.startsWith("'") && gia.endsWith("'")) || (gia.startsWith('"') && gia.endsWith('"')));
    return coNhay ? gia.slice(1, -1) : gia;
  }
  return '';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dich = resolve('dist/playground-lib.js');
  const key = (process.env[BIEN] ?? docBienEnv(resolve('.env'), BIEN)).trim();

  if (!existsSync(dich)) {
    console.warn(`⚠ Không thấy ${dich} — bỏ qua bước chèn khoá demo.`);
  } else if (!key) {
    console.warn(`⚠ Thiếu ${BIEN} (apps/docs/.env) — playground sẽ để trống ô Khoá API.`);
  } else if (!DANG_KHOA.test(key)) {
    console.error(`✗ ${BIEN} sai định dạng khoá: ${key.slice(0, 13)}…`);
    process.exit(1);
  } else {
    const truoc = readFileSync(dich, 'utf8');
    if (!truoc.includes(MOC)) {
      console.warn(`⚠ Không thấy chuỗi mốc ${MOC} trong dist/playground-lib.js — bỏ qua.`);
    } else {
      writeFileSync(dich, truoc.replaceAll(MOC, key));
      console.log(`✔ Đã chèn khoá demo ${key.slice(0, 13)}… vào dist/playground-lib.js`);
    }
  }
}
