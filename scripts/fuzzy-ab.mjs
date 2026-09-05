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
  // Lỗi gõ trên TỪ NGẮN: word_similarity tụt dưới mọi ngưỡng hợp lý nên "chỉ<%" trượt;
  // chính bốn ca này buộc phải giữ lại toán tử % (đo production 05/09).
  { q: 'higland', target: 'highland', why: 'thiếu 1 ký tự, từ ngắn' },
  { q: 'cirlce k', target: 'circle k', why: 'đảo 2 ký tự, từ ngắn' },
  { q: 'winmrt', target: 'winmart', why: 'thiếu 1 ký tự, từ ngắn' },
  { q: 'nguyne hue', target: 'nguyen hue', why: 'đảo 2 ký tự' },
];

const LIMIT = 20;
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });

/**
 * Hạng của POI đích trong danh sách ứng viên.
 * @param {string} q @param {string} target
 * @param {'cu' | 'chi_moi' | 'ca_hai'} bien_the
 *   cu      = mã trước 05/09: name_norm % q
 *   chi_moi = chỉ word_similarity: q <% name_norm
 *   ca_hai  = mã hiện tại: cả hai toán tử
 */
async function rankOf(q, target, bien_the) {
  const like = `${q}%`;
  const where =
    bien_the === 'cu'
      ? sql`(name_norm % ${q} OR name_norm LIKE ${like})`
      : bien_the === 'chi_moi'
        ? sql`(${q} <% name_norm OR name_norm LIKE ${like})`
        : sql`(${q} <% name_norm OR name_norm % ${q} OR name_norm LIKE ${like})`;
  const order =
    bien_the === 'cu'
      ? sql`similarity(name_norm, ${q}) DESC`
      : sql`greatest(word_similarity(${q}, name_norm), similarity(name_norm, ${q})) DESC`;
  const rows = await sql`SELECT min(rn) AS rn FROM (
      SELECT row_number() OVER (ORDER BY ${order}) AS rn, name_norm
      FROM poi WHERE status = 'active' AND ${where}
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
  console.log('  cũ  chỉ<%  cả hai  truy vấn');
  for (const { q, target, why } of CASES) {
    const old = await rankOf(q, target, 'cu');
    const onlyNew = await rankOf(q, target, 'chi_moi');
    const both = await rankOf(q, target, 'ca_hai');
    if (!inTop(old) && inTop(both)) better++;
    if (inTop(old) && !inTop(both)) worse++;
    const mark = !inTop(old) && inTop(both) ? '✓' : inTop(old) && !inTop(both) ? '✗' : ' ';
    console.log(`${mark} ${show(old)}   ${show(onlyNew)}    ${show(both)}   ${q}  — ${why}`);
  }
  console.log(
    `\nSo với mã cũ, bản đang dùng (cả hai toán tử) cứu ${better} ca, làm hỏng ${worse} ca.`,
  );
  console.log(
    'Cột "chỉ<%" cho thấy vì sao phải giữ toán tử %: bỏ nó thì lỗi gõ trên từ ngắn trượt.',
  );
  if (worse > 0) process.exitCode = 1;
} finally {
  await sql.end();
}
