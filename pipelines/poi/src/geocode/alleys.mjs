#!/usr/bin/env node
// Hẻm có số → đường mẹ theo tên hoặc điểm đầu/cuối; entrance nằm trên đường mẹ.
import { connect, publishNew } from '../pg.mjs';

const sql = connect();
try {
  await sql.unsafe('DROP TABLE IF EXISTS alley_new');
  await sql.unsafe('CREATE TABLE alley_new (LIKE alley INCLUDING ALL)');
  await sql.unsafe(`INSERT INTO alley_new (osm_way_id, number, name, geom)
    SELECT osm_way_id, alley_number, name, geom
    FROM osm_road_raw WHERE alley_number IS NOT NULL`);
  await sql.unsafe(`UPDATE alley_new alley SET parent_street_id = (
    SELECT street.id FROM street_new street
    WHERE street.name_norm = road.parent_norm
      AND ST_DWithin(street.geom, alley.geom, 0.003)
      AND ST_DWithin(street.geom::geography, alley.geom::geography, 300)
    ORDER BY ST_Distance(street.geom::geography, alley.geom::geography) LIMIT 1
  ) FROM osm_road_raw road
    WHERE road.osm_way_id = alley.osm_way_id AND road.parent_norm IS NOT NULL`);
  await sql.unsafe(`UPDATE alley_new alley SET parent_street_id = (
    SELECT street.id FROM street_new street
    WHERE (
      ST_DWithin(street.geom, ST_StartPoint(alley.geom), 0.00015)
      AND ST_DWithin(street.geom::geography, ST_StartPoint(alley.geom)::geography, 15)
    ) OR (
      ST_DWithin(street.geom, ST_EndPoint(alley.geom), 0.00015)
      AND ST_DWithin(street.geom::geography, ST_EndPoint(alley.geom)::geography, 15)
    )
    ORDER BY LEAST(
      ST_Distance(street.geom::geography, ST_StartPoint(alley.geom)::geography),
      ST_Distance(street.geom::geography, ST_EndPoint(alley.geom)::geography)
    ) LIMIT 1
  ) WHERE alley.parent_street_id IS NULL`);
  await sql.unsafe(`UPDATE alley_new alley SET entrance = ST_ClosestPoint(street.geom,
    CASE
      WHEN ST_Distance(street.geom, ST_StartPoint(alley.geom)) <=
        ST_Distance(street.geom, ST_EndPoint(alley.geom))
      THEN ST_StartPoint(alley.geom)
      ELSE ST_EndPoint(alley.geom)
    END)
    FROM street_new street WHERE street.id = alley.parent_street_id`);
  await publishNew(sql, ['street', 'alley']);
  const [summary] = await sql`SELECT count(*)::int AS n,
    count(parent_street_id)::int AS with_parent, count(entrance)::int AS with_entrance
    FROM alley`;
  if (!summary) throw new Error('Thiếu số liệu alley sau publish');
  const [streetSummary] = await sql`SELECT count(*)::int AS n FROM street`;
  if (!streetSummary) throw new Error('Thiếu số liệu street sau publish');
  console.log(
    `✓ street ${streetSummary.n} tuyến; alley ${summary.n} (có đường mẹ ${summary.with_parent}, có entrance ${summary.with_entrance})`,
  );
} finally {
  await sql.end();
}
