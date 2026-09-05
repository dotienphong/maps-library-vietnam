#!/usr/bin/env node
// So sánh điều kiện khớp CŨ (name_norm % q) và MỚI (q <% name_norm) trên DB dev có dữ liệu.
// Dùng: pnpm db:up && node scripts/fuzzy-ab.mjs
// In hạng của POI đích trong danh sách ứng viên của mỗi cách; "-" là không tìm thấy.
// Ngưỡng cắt thật của route autocomplete là LIMIT 20, nên hạng > 20 coi như trượt.
import 'dotenv/config';
import postgres from 'postgres';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

/** Ca thử: q là chuỗi người dùng gõ (đã chuẩn hoá), target là chuỗi con của name_norm đích. */
const CASES = [
  { q: 'cho rya', target: 'cho ray', why: 'lỗi gõ đảo hai ký tự' },
  { q: 'skincode', target: 'skincode', why: 'từ nằm giữa tên rất dài' },
  { q: 'nguyen thi minh khai cienco', target: 'cienco', why: 'đảo từ, tên dài' },
  { q: 'laptop nhap my', target: 'laptop nhap my', why: 'cụm giữa tên dài' },
  { q: 'bespoke leather shoes', target: 'bespoke leather', why: 'cụm giữa tên dài' },
  { q: 'nong nghiep moi truong', target: 'nong nghiep va moi truong', why: 'thiếu từ đệm giữa' },
  { q: 'truong can bo dinh tien hoang', target: 'truong can bo', why: 'thừa phần địa chỉ' },
  { q: 'sieu thi decor noi that', target: 'sieu thi decor', why: 'thừa từ mô tả' },
  { q: 'hoa tuoi quan 1', target: 'hoa tuoi', why: 'đối chứng — cũ đã tốt' },
  { q: 'green valley can ho', target: 'green valley', why: 'đối chứng — cũ đã tốt' },
];

const LIMIT = 20;
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });

/** @param {string} q @param {string} target @param {boolean} nuevo */
async function rankOf(q, target, nuevo) {
  const rows = nuevo
    ? await sql`SELECT min(rn) AS rn FROM (
        SELECT row_number() OVER (
          ORDER BY greatest(word_similarity(${q}, name_norm), similarity(name_norm, ${q})) DESC
        ) AS rn, name_norm
        FROM poi WHERE status = 'active'
          AND (${q} <% name_norm OR name_norm LIKE ${`${q}%`})
      ) ranked WHERE name_norm LIKE ${`%${target}%`}`
    : await sql`SELECT min(rn) AS rn FROM (
        SELECT row_number() OVER (ORDER BY similarity(name_norm, ${q}) DESC) AS rn, name_norm
        FROM poi WHERE status = 'active'
          AND (name_norm % ${q} OR name_norm LIKE ${`${q}%`})
      ) ranked WHERE name_norm LIKE ${`%${target}%`}`;
  const rank = rows[0]?.rn;
  return rank === null || rank === undefined ? null : Number(rank);
}

try {
  await sql`SELECT show_trgm('x')`; // nạp pg_trgm để GUC được nhận diện trong phiên này
  await sql.unsafe('SET pg_trgm.word_similarity_threshold = 0.5');
  await sql.unsafe('SET pg_trgm.similarity_threshold = 0.3');
  const show = (/** @type {number | null} */ rank) =>
    rank === null ? '  -' : String(rank).padStart(3);
  const inTop = (/** @type {number | null} */ rank) => rank !== null && rank <= LIMIT;
  let better = 0;
  let worse = 0;
  console.log(`hạng POI đích trong ứng viên (LIMIT ${LIMIT} là ngưỡng cắt thật)\n`);
  console.log('  cũ  mới  truy vấn');
  for (const { q, target, why } of CASES) {
    const [old, fresh] = [await rankOf(q, target, false), await rankOf(q, target, true)];
    if (!inTop(old) && inTop(fresh)) better++;
    if (inTop(old) && !inTop(fresh)) worse++;
    const mark = !inTop(old) && inTop(fresh) ? '✓' : inTop(old) && !inTop(fresh) ? '✗' : ' ';
    console.log(`${mark} ${show(old)} ${show(fresh)}  ${q}  — ${why}`);
  }
  console.log(
    `\nMới cứu được ${better} ca cũ trượt khỏi LIMIT ${LIMIT}; làm hỏng ${worse} ca cũ đang đạt.`,
  );
  if (worse > 0) process.exitCode = 1;
} finally {
  await sql.end();
}
