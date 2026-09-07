#!/usr/bin/env node
// Đường không phải hẻm → cụm street_new theo tên và tỉnh; alleys.mjs phát hành cùng alley.
import { fillSearchKeys } from '../lib/search-keys.mjs';
import { connect, countRows, createNewTable } from '../pg.mjs';

const STREET_STAGE_MARKER = 'mapslibvn:street-ready:v1';
const sql = connect();
let completed = false;
try {
  await sql.unsafe(`UPDATE osm_road_raw road SET province_norm = province.name_norm
    FROM admin_area province
    WHERE province.level = 4
      AND ST_Contains(province.geom, ST_LineInterpolatePoint(road.geom, 0.5))
      AND road.province_norm IS NULL`);
  await createNewTable(sql, 'street');
  await sql.unsafe(`INSERT INTO street_new (osm_way_ids, name, name_norm, province_norm, geom)
    SELECT array_agg(osm_way_id ORDER BY osm_way_id),
      (array_agg(name ORDER BY length(name) DESC, name))[1], name_norm, province_norm,
      ST_Multi(ST_LineMerge(ST_Collect(geom)))
    FROM (
      SELECT *, ST_ClusterDBSCAN(geom, eps := 0.001, minpoints := 1)
        OVER (PARTITION BY name_norm, province_norm) AS cluster_id
      FROM osm_road_raw WHERE alley_number IS NULL
    ) ways
    GROUP BY name_norm, province_norm, cluster_id`);
  await sql.unsafe(`UPDATE street_new street SET ward_norm = COALESCE((
    SELECT array_agg(DISTINCT ward.name_norm)
    FROM admin_area ward WHERE ward.level = 8 AND ST_Intersects(ward.geom, street.geom)
  ), '{}')`);
  // Tên thay thế: hợp mảng của các way cùng tuyến, bỏ trùng và bỏ tên chính (spec 05/09 mục 6.3).
  await sql.unsafe(`UPDATE street_new s SET name_alt = COALESCE((
      SELECT array_agg(DISTINCT alt ORDER BY alt)
      FROM osm_road_raw r, unnest(r.name_alt) alt
      WHERE r.osm_way_id = ANY(s.osm_way_ids) AND alt <> s.name
    ), '{}')`);
  // rewriteAlt mặc định bật vì có altColumn: name_alt được ghi lại bằng mảng ĐÃ LỌC để thẳng hàng
  // với name_alt_norm — đúng hợp đồng matched_alt của API.
  const filled = await fillSearchKeys(sql, 'street_new', {
    joinColumns: ['id'],
    nameNormColumn: 'name_norm',
    altColumn: 'name_alt',
  });
  console.log(`✓ street_new name_key/name_alt_norm/name_tsv: ${filled.updated} dòng`);
  await sql.unsafe(`ANALYZE street_new;
    COMMENT ON TABLE street_new IS '${STREET_STAGE_MARKER}'`);
  console.log(
    `✓ street_new ${await countRows(sql, 'street_new')} tuyến (chưa phát hành — alleys.mjs phát hành cùng)`,
  );
  completed = true;
} finally {
  try {
    if (!completed) await sql.unsafe('DROP TABLE IF EXISTS street_new');
  } finally {
    await sql.end();
  }
}
