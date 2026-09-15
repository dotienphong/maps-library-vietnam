#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { normalizeVi } from '@mapslibvn/core';
import { ADMIN_OLD_FIXTURE_PBF, ADMIN_OLD_MANIFEST, ADMIN_OLD_PBF, FIXTURE } from '../lib/env.mjs';
import { fillSearchKeys } from '../lib/search-keys.mjs';
import { connect, countRows, createNewTable, publishNew, withAdvisoryLock } from '../pg.mjs';
import { downloadVerified, loadOldAdminRaw } from './admin-old-source.mjs';
/** @typedef {import('postgres').Sql} Sql */
import { buildOldAdmin } from './admin-overlay.mjs';
import { bootstrapMissingProvince } from './raw-tables.mjs';

const provinceNorms = () =>
  Object.keys(JSON.parse(readFileSync('packages/core/src/provinces.json', 'utf8'))).map((name) =>
    normalizeVi(name).replace(/^(?:tinh|thanh pho)\s+/, ''),
  );

/** @param {Sql} sql */
export async function buildCurrentAdmin(sql) {
  // OSM thiếu relation cấp tỉnh của Khánh Hòa, mà mọi L6/L8 chỉ được giữ khi nằm trong một L4 —
  // không dựng bù thì cả tỉnh biến mất khỏi dữ liệu hiện hành.
  const bootstrap = await bootstrapMissingProvince(sql, { rawTable: 'osm_admin_raw' });
  console.log(
    bootstrap.applied
      ? `✓ dựng L4 ${bootstrap.province} từ ${bootstrap.children} đơn vị con mồ côi`
      : `· không dựng L4 bù: ${bootstrap.reason}`,
  );
  await createNewTable(sql, 'admin_area');
  await sql`INSERT INTO admin_area_new (id,level,name,name_norm,osm_relation_id,geom)
    WITH retained_province AS (SELECT * FROM osm_admin_raw WHERE level=4
      AND name_norm !~ ' cu$' AND name_norm=ANY(${provinceNorms()}))
    SELECT row_number() OVER (ORDER BY semantic_level,osm_relation_id),semantic_level,
      name,name_norm,osm_relation_id,geom FROM (
      SELECT raw.*,CASE WHEN raw.level=6 AND raw.name ~* '^(Phường|Xã|Thị trấn|Đặc khu) '
        THEN 8 ELSE raw.level END semantic_level FROM osm_admin_raw raw
      WHERE (raw.level=4 AND EXISTS (SELECT 1 FROM retained_province p WHERE p.osm_relation_id=raw.osm_relation_id))
        OR (raw.level=6 AND raw.name ~* '^(Phường|Xã|Thị trấn|Đặc khu|Quận|Huyện|Thành phố|Thị xã) '
          AND EXISTS (SELECT 1 FROM retained_province p WHERE ST_Contains(p.geom,ST_PointOnSurface(raw.geom))))
        OR (raw.level=8 AND raw.name ~* '^(Phường|Xã|Thị trấn|Đặc khu) '
          AND EXISTS (SELECT 1 FROM retained_province p WHERE ST_Contains(p.geom,ST_PointOnSurface(raw.geom)))
          AND NOT EXISTS (SELECT 1 FROM osm_admin_raw w WHERE w.level=6
            AND w.name ~* '^(Phường|Xã|Thị trấn|Đặc khu) '
            AND ST_Contains(w.geom,ST_PointOnSurface(raw.geom))))
    ) classified`;
  await sql.unsafe(`UPDATE admin_area_new child SET parent_id=(SELECT candidate.id
    FROM admin_area_new candidate WHERE candidate.level<child.level
      AND ST_Contains(candidate.geom,ST_PointOnSurface(child.geom))
    ORDER BY candidate.level DESC LIMIT 1) WHERE child.level>4; ANALYZE admin_area_new`);
  await fillSearchKeys(sql, 'admin_area_new', {
    joinColumns: ['id'],
    nameNormColumn: 'name_norm',
    altColumn: null,
    altNormColumn: null,
    tsvColumn: null,
  });
}

async function main() {
  const sql = connect();
  try {
    await withAdvisoryLock(sql, 'mapslibvn-admin-publish', async (connection) => {
      try {
        const manifest = JSON.parse(readFileSync(ADMIN_OLD_MANIFEST, 'utf8'));
        const oldPbf = FIXTURE ? ADMIN_OLD_FIXTURE_PBF : ADMIN_OLD_PBF;
        if (!FIXTURE) await downloadVerified({ ...manifest, target: oldPbf });
        const sourceStats = await loadOldAdminRaw(connection, { pbfPath: oldPbf });
        await buildCurrentAdmin(connection);
        // `--accept-qa "<lý do>"`: publish dù cổng QA đỏ. Chỉ dùng khi có quyết định của người
        // chịu trách nhiệm; lý do được ghi vào report để còn truy được về sau.
        const acceptIndex = process.argv.indexOf('--accept-qa');
        const acceptQaReason = acceptIndex >= 0 ? process.argv[acceptIndex + 1] : undefined;
        if (acceptIndex >= 0 && !acceptQaReason?.trim()) {
          throw new Error('--accept-qa cần kèm lý do, ví dụ: --accept-qa "PHONG duyệt 07/09: …"');
        }
        const report = await buildOldAdmin(connection, {
          currentTable: 'admin_area_new',
          sourceStats,
          ...(acceptQaReason ? { acceptQaReason } : {}),
        });
        const publishStarted = performance.now();
        await publishNew(connection, ['admin_area', 'admin_area_old', 'admin_alias']);
        const publishMs = Math.round(performance.now() - publishStarted);
        const levels =
          await connection`SELECT level,count(*)::int n FROM admin_area GROUP BY 1 ORDER BY 1`;
        console.log(
          `✓ admin_area ${await countRows(connection, 'admin_area')} (${levels.map((r) => `L${r.level}=${r.n}`).join(', ')}); admin_area_old ${report.oldCount}; admin_alias ${report.aliasCount}; publish ${publishMs} ms`,
        );
      } finally {
        await connection.unsafe(
          'DROP TABLE IF EXISTS admin_area_new,admin_area_old_new,admin_alias_new,admin_overlap_work',
        );
      }
    });
  } finally {
    await sql.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
