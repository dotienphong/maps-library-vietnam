#!/usr/bin/env node
// Điền poi.admin_ward / admin_province = đơn vị hành chính HIỆN HÀNH chứa toạ độ (admin_area cấp 8 và 4).
// Chạy SAU geocode/admin.mjs (admin_area vừa publish) — publish.mjs chạy trước admin nên không làm ở đó.
// Quét TOÀN bảng (kể cả created_by='user', mọi status) nhưng chỉ ghi dòng có giá trị đổi → idempotent, ít bloat.
// KHÔNG đụng ward/province của nguồn (records.mjs) và không bump updated_at: đây là cột dẫn xuất.
import { pathToFileURL } from 'node:url';
import { connect } from '../pg.mjs';

/** @typedef {import('postgres').Sql} Sql */

/** @param {Sql} sql */
export async function fillPoiAdmin(sql) {
  const updated = await sql.unsafe(`
    UPDATE poi p SET admin_ward = a.ward, admin_province = a.province
    FROM (
      SELECT p2.id,
        (SELECT w.name FROM admin_area w WHERE w.level = 8 AND ST_Contains(w.geom, p2.geom) ORDER BY w.id LIMIT 1) AS ward,
        (SELECT pr.name FROM admin_area pr WHERE pr.level = 4 AND ST_Contains(pr.geom, p2.geom) ORDER BY pr.id LIMIT 1) AS province
      FROM poi p2
    ) a
    WHERE a.id = p.id AND (p.admin_ward, p.admin_province) IS DISTINCT FROM (a.ward, a.province)`);
  const [row] = await sql`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE admin_ward IS NULL)::int AS ward_null,
      count(*) FILTER (WHERE admin_province IS NULL)::int AS province_null
    FROM poi`;
  const stats = /** @type {{ total: number, ward_null: number, province_null: number }} */ (
    /** @type {unknown} */ (row)
  );
  return {
    updated: updated.count,
    total: stats.total,
    wardNull: stats.ward_null,
    provinceNull: stats.province_null,
  };
}

async function main() {
  const sql = connect();
  try {
    const s = await fillPoiAdmin(sql);
    await sql.unsafe('ANALYZE poi');
    const pct = (/** @type {number} */ n) => ((100 * n) / Math.max(1, s.total)).toFixed(2);
    console.log(
      `✓ poi admin: ghi ${s.updated}/${s.total}; thiếu phường ${s.wardNull} (${pct(s.wardNull)} %), thiếu tỉnh ${s.provinceNull} (${pct(s.provinceNull)} %)`,
    );
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
