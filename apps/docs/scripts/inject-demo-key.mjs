#!/usr/bin/env node
// Chèn khoá demo vào bản build của playground.
//
// `public/` được Astro chép nguyên trạng sang `dist/`, không qua Vite, nên `import.meta.env` không
// dùng được ở đó. Bước này chạy SAU `astro build` và thay chuỗi mốc trong dist bằng
// `PUBLIC_MAPSLIBVN_DEMO_KEY`. Nhờ vậy khoá không nằm trong git và lần xoay khoá sau chỉ cần đổi
// .env rồi build lại.
//
// Ở máy dev, thiếu biến thì KHÔNG làm build đỏ: trang vẫn dựng được, ô Khoá API chỉ để trống. Trên
// CI (biến `CI` có mặt) thì thiếu biến là LỖI: bản build đó sẽ được deploy lên production, và một
// playground trống khoá trả 401 cho mọi khách — đúng sự cố lặp lại tới 23/09/2026 khi workflow Deploy
// Docs không truyền secret `PUBLIC_MAPSLIBVN_DEMO_KEY`. Khoá SAI ĐỊNH DẠNG thì dừng ở mọi nơi.
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

/**
 * @typedef {'chen' | 'thieu-file-canh-bao' | 'thieu-file-loi' | 'thieu-khoa-canh-bao'
 *   | 'thieu-khoa-loi' | 'sai-dinh-dang'} QuyetDinh
 * @param {{ key: string, coFileDich: boolean, laCI: boolean }} input
 * @returns {QuyetDinh}
 */
export function quyetDinhChen({ key, coFileDich, laCI }) {
  if (!coFileDich) return laCI ? 'thieu-file-loi' : 'thieu-file-canh-bao';
  if (!key) return laCI ? 'thieu-khoa-loi' : 'thieu-khoa-canh-bao';
  if (!DANG_KHOA.test(key)) return 'sai-dinh-dang';
  return 'chen';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dich = resolve('dist/playground-lib.js');
  const key = (process.env[BIEN] || docBienEnv(resolve('.env'), BIEN)).trim();
  const quyetDinh = quyetDinhChen({
    key,
    coFileDich: existsSync(dich),
    laCI: Boolean(process.env.CI),
  });

  if (quyetDinh === 'thieu-file-canh-bao') {
    console.warn(`⚠ Không thấy ${dich} — bỏ qua bước chèn khoá demo.`);
  } else if (quyetDinh === 'thieu-file-loi') {
    console.error(`✗ Không thấy ${dich} trên CI — build docs hỏng, không deploy.`);
    process.exit(1);
  } else if (quyetDinh === 'thieu-khoa-canh-bao') {
    console.warn(`⚠ Thiếu ${BIEN} (apps/docs/.env) — playground sẽ để trống ô Khoá API.`);
  } else if (quyetDinh === 'thieu-khoa-loi') {
    console.error(
      `✗ Thiếu ${BIEN} trên CI — truyền secret cùng tên vào bước build (deploy-docs.yml), nếu không playground production trả 401.`,
    );
    process.exit(1);
  } else if (quyetDinh === 'sai-dinh-dang') {
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
