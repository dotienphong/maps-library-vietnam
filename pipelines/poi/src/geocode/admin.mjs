#!/usr/bin/env node
// osm_admin_raw → admin_area + alias tên hành chính trước sắp xếp năm 2025.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeVi } from '@mapslibvn/core';
import { connect, countRows, createNewTable, publishNew } from '../pg.mjs';

const seedLines = readFileSync(resolve('db/seed/admin_alias_2025.csv'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const seedRows = seedLines.map((line) => {
  const [alias, levelString, currentName, province] = line.split(',').map((field) => field.trim());
  return { alias, level: Number(levelString), currentName, province, line };
});
const provinceCurrentNorms = [
  ...new Set(
    seedRows
      .filter((row) => row.level === 4)
      .map((row) => normalizeVi(row.currentName ?? '').replace(/^(?:tinh|thanh pho)\s+/, '')),
  ),
];
const provinceRetiredNorms = [
  ...new Set(
    seedRows
      .filter((row) => row.level === 4)
      .map((row) => normalizeVi(row.alias ?? ''))
      .filter((alias) => !provinceCurrentNorms.includes(alias)),
  ),
];

const sql = connect();
try {
  await createNewTable(sql, 'admin_area');
  await createNewTable(sql, 'admin_alias');
  await sql`INSERT INTO admin_area_new (id, level, name, name_norm, osm_relation_id, geom)
    SELECT row_number() OVER (ORDER BY semantic_level, osm_relation_id),
      semantic_level, name, name_norm, osm_relation_id, geom
    FROM (
      SELECT raw.*,
      CASE
        WHEN raw.level = 6 AND raw.name ~* '^(Phường|Xã|Thị trấn|Đặc khu) ' THEN 8
        ELSE raw.level
      END AS semantic_level
      FROM osm_admin_raw raw
      WHERE (
        raw.level = 4 AND raw.name_norm !~ ' cu$'
          AND (raw.name_norm = ANY(${provinceCurrentNorms})
            OR NOT (raw.name_norm = ANY(${provinceRetiredNorms})))
      ) OR (
        raw.level = 6
        AND (
          raw.name ~* '^(Phường|Xã|Thị trấn|Đặc khu) '
          OR (
            raw.name ~* '^(Quận|Huyện|Thành phố|Thị xã) '
            AND EXISTS (
              SELECT 1 FROM osm_admin_raw province
              WHERE province.level = 4 AND province.name_norm !~ ' cu$'
                AND (province.name_norm = ANY(${provinceCurrentNorms})
                  OR NOT (province.name_norm = ANY(${provinceRetiredNorms})))
                AND ST_Contains(province.geom, ST_PointOnSurface(raw.geom))
            )
          )
        )
      ) OR (
        raw.level = 8
        AND raw.name ~* '^(Phường|Xã|Thị trấn|Đặc khu) '
        AND NOT EXISTS (
          SELECT 1 FROM osm_admin_raw current_ward
          WHERE current_ward.level = 6
            AND current_ward.name ~* '^(Phường|Xã|Thị trấn|Đặc khu) '
            AND ST_Contains(current_ward.geom, ST_PointOnSurface(raw.geom))
        )
      )
    ) classified`;
  await sql.unsafe(`UPDATE admin_area_new child SET parent_id = (
    SELECT candidate.id FROM admin_area_new candidate
    WHERE candidate.level < child.level
      AND ST_Contains(candidate.geom, ST_PointOnSurface(child.geom))
    ORDER BY candidate.level DESC LIMIT 1
  ) WHERE child.level > 4`);

  let inserted = 0;
  const missing = [];
  for (const { alias, level, currentName, province, line } of seedRows) {
    const nameNorm = normalizeVi(currentName ?? '').replace(
      /^(?:tinh|thanh pho|quan|huyen|thi xa|phuong|xa|thi tran)\s+/,
      '',
    );
    const provinceNorm = province
      ? normalizeVi(province).replace(/^(?:tinh|thanh pho)\s+/, '')
      : null;
    const [area] = await sql`SELECT area.id FROM admin_area_new area
      LEFT JOIN admin_area_new direct_parent ON direct_parent.id = area.parent_id
      LEFT JOIN admin_area_new grand_parent ON grand_parent.id = direct_parent.parent_id
      WHERE area.level = ${level} AND area.name_norm = ${nameNorm}
        AND (${provinceNorm}::text IS NULL
          OR COALESCE(
            CASE WHEN direct_parent.level = 4 THEN direct_parent.name_norm END,
            CASE WHEN grand_parent.level = 4 THEN grand_parent.name_norm END
          ) = ${provinceNorm})
      ORDER BY area.id LIMIT 1`;
    if (!area) {
      missing.push(line);
      continue;
    }
    const result =
      await sql`INSERT INTO admin_alias_new (alias_norm, level, admin_area_id, valid_until)
      VALUES (${normalizeVi(alias ?? '')}, ${level}, ${area.id}, '2025-06-30')
      ON CONFLICT DO NOTHING`;
    inserted += result.count;
  }
  await publishNew(sql, ['admin_area', 'admin_alias']);
  const levels = await sql`SELECT level, count(*)::int AS n FROM admin_area GROUP BY 1 ORDER BY 1`;
  console.log(
    `✓ admin_area ${await countRows(sql, 'admin_area')} (${levels.map((level) => `L${level.level}=${level.n}`).join(', ')}); admin_alias ${inserted} dòng, không khớp ${missing.length}${missing.length ? `: ${missing.slice(0, 5).join(' | ')}` : ''}`,
  );
} finally {
  await sql.end();
}
