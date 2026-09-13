#!/usr/bin/env node
// Đo độ phủ ánh xạ trên src_* (dữ liệu thật). Phân biệt hai loại rơi vào `*_other`:
//   (a) THIẾU  — không có dòng nào trong CSV khớp (kể cả wildcard "khoá=*") → phải bằng 0, thoát mã 1 nếu ≥ 2%
//   (b) CHỦ ĐÍCH — có dòng CSV trỏ thẳng tới `<nhóm>_other` (ví dụ FSQ `Business and Professional Services` → `services_other`,
//       là nhóm cha chung chung của nguồn, không thể chi tiết hơn) → chỉ báo cáo.
// Dùng: node pipelines/poi/scripts/category-coverage.mjs [--top 200]
import { arg } from '../src/lib/env.mjs';
import { connect } from '../src/pg.mjs';
import { OSM_DROP, OSM_KEYS, loadCategoryMaps, mapCategory } from '../src/taxonomy.mjs';

const top = Number(arg('--top', '200'));
const maps = loadCategoryMaps();
const isOther = (/** @type {string} */ code) => code === 'other' || code.endsWith('_other');

/** Giá trị có dòng CSV riêng cho nó (không tính wildcard) không? @param {'osm'|'fsq'} source @param {string} value */
function hasExplicitRule(source, value) {
  const m = maps[source];
  if (m.has(value)) return true;
  if (source === 'fsq') {
    const parts = value.split('>').map((s) => s.trim());
    return parts.some((leaf, i) => m.has(leaf) || m.has(parts.slice(0, i + 1).join(' > ')));
  }
  return false;
}

const sql = connect();
try {
  const osm = await sql.unsafe(
    `SELECT k || '=' || v AS value, count(*)::int AS n FROM src_osm_place, jsonb_each_text(tags) AS t(k, v)
     WHERE k = ANY($1) GROUP BY 1 ORDER BY 2 DESC LIMIT ${top}`,
    [OSM_KEYS],
  );
  const fsq = await sql.unsafe(
    `SELECT label AS value, count(*)::int AS n FROM src_fsq_place, jsonb_array_elements_text(categories) AS label GROUP BY 1 ORDER BY 2 DESC LIMIT ${top}`,
  );

  let exit = 0;
  for (const [source, rows] of /** @type {const} */ ([
    ['osm', osm],
    ['fsq', fsq],
  ])) {
    let total = 0;
    let missing = 0;
    let deliberate = 0;
    /** @type {string[]} */
    const missingList = [];
    /** @type {string[]} */
    const deliberateList = [];
    for (const r of rows) {
      if (source === 'osm' && OSM_DROP.has(r.value)) continue;
      total += r.n;
      const { code } = mapCategory(maps, source, r.value);
      if (!isOther(code)) continue;
      if (hasExplicitRule(source, r.value)) {
        deliberate += r.n;
        deliberateList.push(`${r.value} → ${code} (${r.n})`);
      } else {
        missing += r.n;
        missingList.push(`${r.value} (${r.n})`);
      }
    }
    const pct = (/** @type {number} */ x) => (total ? ((100 * x) / total).toFixed(1) : '0');
    console.log(`\n== ${source}: top-${rows.length} giá trị, ${total} bản ghi`);
    console.log(`   THIẾU ánh xạ: ${pct(missing)}% (${missingList.length} giá trị)`);
    for (const u of missingList.slice(0, 25)) console.log('     -', u);
    console.log(
      `   → *_other chủ đích: ${pct(deliberate)}% (${deliberateList.length} giá trị, nhóm cha chung của nguồn)`,
    );
    for (const u of deliberateList.slice(0, 8)) console.log('     ·', u);
    if (Number(pct(missing)) >= 2) exit = 1;
  }
  process.exit(exit);
} finally {
  await sql.end();
}
