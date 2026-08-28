#!/usr/bin/env node
// Bước 3 gộp: poi_work_* → poi_new → gộp vào poi (UPDATE pipeline-POI, INSERT mới, xoá/đóng POI biến mất; không đụng created_by='user').
// Sanity: số poi active mới không giảm > 10 % so hiện tại, trừ --force (spec 5.9). Thoát mã 3 nếu vi phạm.
import { connect, countRows, createNewTable } from './pg.mjs';

const force = process.argv.includes('--force');
const sql = connect();
try {
  await createNewTable(sql, 'poi');
  await sql.unsafe(`INSERT INTO poi_new (id, name, name_norm, name_alt, category, geom, housenumber, street, ward, province, address_text, contact, hours,
      primary_source, primary_source_id, quality_score, popularity, status, locked_fields, created_by, created_at, updated_at)
    SELECT m.poi_id, r.name, r.name_norm, r.name_alt, r.category,
           COALESCE(osm.geom, r.geom),
           r.housenumber, r.street, r.ward, r.province, r.address_text, r.contact, r.hours,
           r.source, r.source_id, m.quality_score, m.popularity, m.status, '{}', 'pipeline', now(), now()
    FROM poi_work_cluster_meta m
    JOIN poi_work_record r ON r.rid = m.primary_rid
    LEFT JOIN LATERAL (SELECT r2.geom FROM poi_work_cluster c2 JOIN poi_work_record r2 ON r2.rid = c2.rid
                       WHERE c2.cluster_no = m.cluster_no AND r2.source = 'osm' ORDER BY c2.role LIMIT 1) osm ON true`);

  const before = Number(
    /** @type {any} */ (
      (
        await sql`SELECT count(*)::int AS n FROM poi WHERE status = 'active' AND created_by = 'pipeline'`
      )[0]
    )?.n ?? 0,
  );
  const after = Number(
    /** @type {any} */ (
      (await sql`SELECT count(*)::int AS n FROM poi_new WHERE status = 'active'`)[0]
    )?.n ?? 0,
  );
  if (before > 0 && after < before * 0.9 && !force) {
    console.error(
      `SANITY: poi active giảm ${before} → ${after} (> 10 %). Dừng, không đổi gì. Dùng --force nếu cố ý.`,
    );
    process.exit(3);
  }

  await sql.begin(async (tx) => {
    await tx.unsafe(`DELETE FROM poi p WHERE p.created_by = 'pipeline' AND NOT EXISTS (SELECT 1 FROM poi_new n WHERE n.id = p.id)
                      AND NOT EXISTS (SELECT 1 FROM poi_edit e WHERE e.poi_id = p.id)`);
    await tx.unsafe(`UPDATE poi p SET status = 'closed', updated_at = now() WHERE p.created_by = 'pipeline' AND p.status <> 'closed'
                      AND NOT EXISTS (SELECT 1 FROM poi_new n WHERE n.id = p.id)`);
    await tx.unsafe(`UPDATE poi p SET name = n.name, name_norm = n.name_norm, name_alt = n.name_alt, category = n.category, geom = n.geom,
        housenumber = n.housenumber, street = n.street, ward = n.ward, province = n.province, address_text = n.address_text,
        contact = n.contact, hours = n.hours, primary_source = n.primary_source, primary_source_id = n.primary_source_id,
        quality_score = n.quality_score, popularity = n.popularity, status = n.status, updated_at = now()
      FROM poi_new n WHERE n.id = p.id AND p.created_by = 'pipeline'
        AND (p.name, p.category, p.address_text, p.contact::text, p.hours::text, p.primary_source, p.primary_source_id, p.quality_score, p.status, ST_AsText(p.geom))
            IS DISTINCT FROM (n.name, n.category, n.address_text, n.contact::text, n.hours::text, n.primary_source, n.primary_source_id, n.quality_score, n.status, ST_AsText(n.geom))`);
    await tx.unsafe(
      'INSERT INTO poi SELECT n.* FROM poi_new n WHERE NOT EXISTS (SELECT 1 FROM poi p WHERE p.id = n.id)',
    );
    await tx.unsafe(
      `DELETE FROM poi_source_link l USING poi p WHERE l.poi_id = p.id AND p.created_by = 'pipeline'`,
    );
    await tx.unsafe(`INSERT INTO poi_source_link (poi_id, source, source_id, confidence, role)
      SELECT m.poi_id, r.source, r.source_id, r.confidence, c.role
      FROM poi_work_cluster c JOIN poi_work_record r ON r.rid = c.rid JOIN poi_work_cluster_meta m ON m.cluster_no = c.cluster_no
      ON CONFLICT (source, source_id) DO UPDATE SET poi_id = EXCLUDED.poi_id, role = EXCLUDED.role, confidence = EXCLUDED.confidence`);
    await tx.unsafe('DROP TABLE poi_new');
  });
  await sql.unsafe('ANALYZE poi; ANALYZE poi_source_link');
  const s = /** @type {any} */ (
    (
      await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active,
      count(*) FILTER (WHERE category = 'other' OR category LIKE '%\\_other')::int AS other FROM poi`
    )[0]
  );
  if (!s) throw new Error('Thiếu số liệu sau publish');
  console.log(
    `✓ poi: ${s.total} (active ${s.active}, trước đó ${before}); other ${((100 * s.other) / Math.max(1, s.total)).toFixed(1)} %; links ${await countRows(sql, 'poi_source_link')}`,
  );
} finally {
  await sql.end();
}
