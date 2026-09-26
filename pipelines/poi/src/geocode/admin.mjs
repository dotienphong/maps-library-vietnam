#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { normalizeVi } from '@mapslibvn/core';
import { ADMIN_OLD_FIXTURE_PBF, ADMIN_OLD_MANIFEST, ADMIN_OLD_PBF, FIXTURE } from '../lib/env.mjs';
import { quanDaoGeoJson, vungQuanDao } from '../lib/quan-dao.mjs';
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
  // Mọi relation raw cấp 6/8 có điểm nằm trong vùng hai quần đảo bị bỏ: nếu một extract sau này dựng được
  // trọn Khánh Hòa (r1887959 gồm cả Trường Sa) thì "Quận Nam Sa"/"Tam Sa" của TQ và bản "Đặc khu Trường Sa"
  // dở dang của OSM sẽ lọt vào tỉnh. Hai đặc khu dựng từ data/quan-dao.geojson ngay dưới (PHONG 26/09/2026).
  await sql`INSERT INTO admin_area_new (id,level,name,name_norm,osm_relation_id,geom)
    WITH quan_dao AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${quanDaoGeoJson()}),4326) g),
    retained_province AS (SELECT * FROM osm_admin_raw WHERE level=4
      AND name_norm !~ ' cu$' AND name_norm=ANY(${provinceNorms()}))
    SELECT row_number() OVER (ORDER BY semantic_level,osm_relation_id),semantic_level,
      name,name_norm,osm_relation_id,geom FROM (
      SELECT raw.*,CASE WHEN raw.level=6 AND raw.name ~* '^(Phường|Xã|Thị trấn|Đặc khu) '
        THEN 8 ELSE raw.level END semantic_level FROM osm_admin_raw raw
      WHERE (raw.level=4 AND EXISTS (SELECT 1 FROM retained_province p WHERE p.osm_relation_id=raw.osm_relation_id))
        OR (raw.level=6
          AND NOT EXISTS (SELECT 1 FROM quan_dao q WHERE ST_Intersects(q.g,ST_PointOnSurface(raw.geom)))
          AND raw.name ~* '^(Phường|Xã|Thị trấn|Đặc khu|Quận|Huyện|Thành phố|Thị xã) '
          AND EXISTS (SELECT 1 FROM retained_province p WHERE ST_Contains(p.geom,ST_PointOnSurface(raw.geom))))
        OR (raw.level=8
          AND NOT EXISTS (SELECT 1 FROM quan_dao q WHERE ST_Intersects(q.g,ST_PointOnSurface(raw.geom)))
          AND raw.name ~* '^(Phường|Xã|Thị trấn|Đặc khu) '
          AND EXISTS (SELECT 1 FROM retained_province p WHERE ST_Contains(p.geom,ST_PointOnSurface(raw.geom)))
          AND NOT EXISTS (SELECT 1 FROM osm_admin_raw w WHERE w.level=6
            AND w.name ~* '^(Phường|Xã|Thị trấn|Đặc khu) '
            AND ST_Contains(w.geom,ST_PointOnSurface(raw.geom))))
    ) classified`;
  await sql.unsafe(`UPDATE admin_area_new child SET parent_id=(SELECT candidate.id
    FROM admin_area_new candidate WHERE candidate.level<child.level
      AND ST_Contains(candidate.geom,ST_PointOnSurface(child.geom))
    ORDER BY candidate.level DESC LIMIT 1) WHERE child.level>4`);
  // Hai đặc khu: id nối SAU mọi hàng (không xê dịch id L8 đang có), osm_relation_id tổng hợp âm như L4 Khánh
  // Hòa dựng bù (−4). Cha đặt theo tên tỉnh, không theo chứa-điểm: hình L4 của Khánh Hòa/Đà Nẵng cố ý không
  // nới ra biển (bbox của kết quả "Đà Nẵng" sẽ kéo tới 113°E).
  const dacKhu = vungQuanDao().map((v, i) => ({
    osm: -9001 - i,
    ten: v.ten,
    norm: normalizeVi(v.ten),
    tinh: normalizeVi(v.tinh),
    geom: JSON.stringify({ type: 'Polygon', coordinates: [v.ring] }),
  }));
  await sql`INSERT INTO admin_area_new (id,level,name,name_norm,osm_relation_id,geom)
    SELECT (SELECT coalesce(max(id),0) FROM admin_area_new) + row_number() OVER (ORDER BY d.osm DESC),
      8, d.ten, d.norm, d.osm, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(d.geom),4326))
    FROM jsonb_to_recordset(${sql.json(dacKhu)}) AS d(osm bigint, ten text, norm text, tinh text, geom text)`;
  await sql`UPDATE admin_area_new a SET parent_id=(SELECT p.id FROM admin_area_new p
      WHERE p.level=4 AND p.name_norm=d.tinh ORDER BY p.id LIMIT 1)
    FROM jsonb_to_recordset(${sql.json(dacKhu)}) AS d(osm bigint, tinh text) WHERE a.osm_relation_id=d.osm`;
  // Không có tỉnh cha thì poi-admin/reverse mất tỉnh của MỌI POI hai quần đảo mà bước vẫn in ✓ — dừng
  // (fixture Quận 1 không có Khánh Hòa/Đà Nẵng nên chỉ cảnh báo).
  const moCoi = await sql`SELECT name FROM admin_area_new
    WHERE osm_relation_id = ANY(${dacKhu.map((d) => d.osm)}) AND parent_id IS NULL ORDER BY name`;
  if (moCoi.length > 0) {
    const msg = `${moCoi.map((r) => r.name).join(', ')} không tìm được tỉnh cha (L4 Khánh Hòa/Đà Nẵng vắng)`;
    if (!FIXTURE) throw new Error(msg);
    console.warn(`! ${msg} — fixture`);
  }
  await sql.unsafe('ANALYZE admin_area_new');
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
