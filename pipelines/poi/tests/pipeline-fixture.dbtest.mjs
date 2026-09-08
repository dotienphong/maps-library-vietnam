// Toàn chuỗi trên fixture Quận 1 → poi hợp lý, poi.pmtiles sinh ra và qua QA. Chạy trong image.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { lonLatToTile } from '../../tiles/src/lib/qa-rules.mjs';
import { CELL_PX_BY_ZOOM, globalCellKey } from '../src/display-selector.mjs';

const OUT = process.env.MAPSLIBVN_OUT ?? resolve('out');
const WORK = process.env.MAPSLIBVN_WORK ?? resolve('work');
const LATE_USER_POI_ID = 'USERPOI0000000000000000002';
const THIN_ALL_WINNER_ID = 'THINOVERTURE000000000000001';
const THIN_OSM_WINNER_ID = 'THINOSM00000000000000000001';
const THIN_USER_ID = 'THINUSER0000000000000000001';
const SNAPSHOT_BUILD_ID = `fixture-${process.pid}`;
const NEXT_SNAPSHOT_BUILD_ID = `${SNAPSHOT_BUILD_ID}-next`;
const snapshotFile = (/** @type {string} */ buildId) =>
  resolve(WORK, 'poi', `snapshot-${buildId}.jsonl`);
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
const node = (/** @type {string[]} */ ...args) =>
  execFileSync(process.execPath, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

beforeAll(async () => {
  node('scripts/db-migrate.mjs');
  for (const source of ['osm', 'overture', 'fsq']) {
    node(`pipelines/poi/src/ingest/${source}.mjs`, '--fixture');
  }
  node('pipelines/poi/src/taxonomy.mjs', 'load');
  node('pipelines/poi/src/records.mjs');
  node('pipelines/poi/src/conflate.mjs');
  node('pipelines/poi/src/publish.mjs', '--force');
  node('pipelines/poi/src/geocode/osm-roads.mjs', '--fixture');
  for (const stage of ['admin', 'streets', 'alleys', 'anchors']) {
    node(`pipelines/poi/src/geocode/${stage}.mjs`, ...(stage === 'admin' ? ['--fixture'] : []));
  }
  // POI người dùng: primary_source NULL, phải có mặt ở MỌI profile (spec 07/09 mục 4). Chèn sau
  // publish vì publish gộp poi_new và chỉ chừa lại created_by='user'.
  // Toạ độ CỐ Ý đặt xa fixture Quận 1: lưới progressive chỉ giữ một POI mỗi ô, nên đặt trong vùng
  // dày đặc thì POI này bị thinning và test không còn nói được gì về bộ lọc nguồn.
  await sql`INSERT INTO poi (id, name, name_norm, category, geom, quality_score, popularity, status, locked_fields, created_by)
    VALUES ('USERPOI0000000000000000001', 'Quán thử người dùng', 'quan thu nguoi dung', 'cafe',
            ST_SetSRID(ST_MakePoint(108.5, 13.5), 4326), 60, 0.2, 'active', '{}', 'user')
    ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO poi (id, name, name_norm, category, geom, quality_score, popularity, status,
                            locked_fields, created_by, primary_source, primary_source_id)
    VALUES
      (${THIN_ALL_WINNER_ID}, 'POI Overture thắng all', 'poi overture thang all', 'cafe',
       ST_SetSRID(ST_MakePoint(108.6, 13.6), 4326), 99, 0.99, 'active', '{}', 'pipeline', 'overture', 'thin-overture'),
      (${THIN_OSM_WINNER_ID}, 'POI OSM phục hồi', 'poi osm phuc hoi', 'cafe',
       ST_SetSRID(ST_MakePoint(108.6, 13.6), 4326), 70, 0.50, 'active', '{}', 'pipeline', 'osm', 'thin-osm'),
      (${THIN_USER_ID}, 'POI user cạnh tranh', 'poi user canh tranh', 'cafe',
       ST_SetSRID(ST_MakePoint(108.6, 13.6), 4326), 60, 0.10, 'active', '{}', 'user', NULL, NULL)`;
  node('pipelines/poi/src/export-snapshot.mjs', '--build-id', SNAPSHOT_BUILD_ID);
  await sql`INSERT INTO poi (id, name, name_norm, category, geom, quality_score, popularity, status, locked_fields, created_by)
    VALUES (${LATE_USER_POI_ID}, 'Quán thêm sau snapshot', 'quan them sau snapshot', 'cafe',
            ST_SetSRID(ST_MakePoint(109, 14), 4326), 60, 0.2, 'active', '{}', 'user')`;
  node(
    'pipelines/poi/src/export-tiles.mjs',
    '--release',
    'poi-fixture',
    '--snapshot',
    snapshotFile(SNAPSHOT_BUILD_ID),
    '--build-id',
    SNAPSHOT_BUILD_ID,
  );
  node(
    'pipelines/poi/src/export-tiles.mjs',
    '--release',
    'poi-osm-fixture',
    '--sources',
    'osm',
    '--snapshot',
    snapshotFile(SNAPSHOT_BUILD_ID),
    '--build-id',
    SNAPSHOT_BUILD_ID,
  );
  node('pipelines/poi/src/export-snapshot.mjs', '--build-id', NEXT_SNAPSHOT_BUILD_ID);
  for (const [release, profile] of [
    ['poi-fixture-next', 'all'],
    ['poi-osm-fixture-next', 'osm'],
  ]) {
    node(
      'pipelines/poi/src/export-tiles.mjs',
      '--release',
      release,
      '--sources',
      profile,
      '--snapshot',
      snapshotFile(NEXT_SNAPSHOT_BUILD_ID),
      '--build-id',
      NEXT_SNAPSHOT_BUILD_ID,
    );
  }
  node('pipelines/poi/src/report.mjs');
});
afterAll(() => sql.end());

describe('pipeline POI trọn vòng trên fixture', () => {
  it('số POI active hợp lý so với record nguồn, ≥ 90 % không rơi vào bare other', async () => {
    const [summary] = await sql`SELECT count(*)::int AS n,
        count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (WHERE status = 'active' AND category <> 'other')::int AS mapped,
        (SELECT sum(n)::int FROM (
          SELECT count(*)::int AS n FROM src_osm_place
          UNION ALL SELECT count(*)::int FROM src_overture_place
          UNION ALL SELECT count(*)::int FROM src_fsq_place
        ) source_counts) AS source_records
      FROM poi`;
    expect(summary.active).toBeGreaterThanOrEqual(3000);
    expect(summary.active).toBeLessThanOrEqual(summary.source_records);
    expect(summary.active / summary.source_records).toBeGreaterThan(0.5);
    expect(summary.mapped / summary.active).toBeGreaterThan(0.9);
  });

  it('poi-fixture.pmtiles sinh ra, ≤ 20 MB, zoom 10–16, layer poi, qua QA chủ quyền', () => {
    const file = resolve(OUT, 'poi-fixture.pmtiles');
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(20 * 2 ** 20);
    const info = JSON.parse(node('pipelines/tiles/src/inspect.mjs', file));
    expect(info.zoom).toEqual([10, 16]);
    expect(info.layers).toEqual(['poi']);
    expect(() => node('pipelines/tiles/src/qa.mjs', file, '--skip-islands')).not.toThrow();
  });

  it('GeoJSON và PMTiles giữ contract progressive display mà không sửa POI bị thinning', async () => {
    const features = readFileSync(resolve(WORK, 'poi', 'poi-fixture.geojsonseq'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(features.length).toBeGreaterThan(0);
    const occupied = new Set();
    for (const feature of features) {
      const minZoom = feature.tippecanoe.minzoom;
      expect(minZoom).toBeGreaterThanOrEqual(10);
      expect(minZoom).toBeLessThanOrEqual(16);
      expect(feature.properties.r).toBeGreaterThanOrEqual(1);
      expect(feature.properties.r).toBeLessThanOrEqual(5);
      expect(Number.isInteger(feature.properties.d)).toBe(true);
      expect(feature.properties.popularity).toBeUndefined();
      const [lon, lat] = feature.geometry.coordinates;
      for (let zoom = minZoom; zoom <= 16; zoom++) {
        const cell = globalCellKey(lon, lat, zoom, CELL_PX_BY_ZOOM[zoom]);
        expect(occupied.has(cell), `trùng display cell ${cell}`).toBe(false);
        occupied.add(cell);
      }
    }

    const active = await sql`SELECT id, status FROM poi WHERE status = 'active' ORDER BY id`;
    expect(features.length).toBeLessThan(active.length);
    const exportedIds = new Set(features.map((feature) => feature.properties.id));
    const omitted = active.find((row) => !exportedIds.has(row.id));
    expect(omitted).toBeDefined();
    const [unchanged] = await sql`SELECT status FROM poi WHERE id = ${omitted.id}`;
    expect(unchanged.status).toBe('active');

    const sample = features[0];
    const zoom = sample.tippecanoe.minzoom;
    const { x, y } = lonLatToTile(
      sample.geometry.coordinates[0],
      sample.geometry.coordinates[1],
      zoom,
    );
    const decoded = JSON.parse(
      execFileSync(
        'tippecanoe-decode',
        [resolve(OUT, 'poi-fixture.pmtiles'), String(zoom), String(x), String(y)],
        { encoding: 'utf8' },
      ),
    );
    const decodedFeatures = decoded.features.flatMap((item) =>
      item.type === 'FeatureCollection' ? item.features : [item],
    );
    const actual = decodedFeatures.find((item) => item.properties?.id === sample.properties.id);
    expect(actual?.properties).toMatchObject({
      r: sample.properties.r,
      d: sample.properties.d,
    });
  });

  it('profile osm: mọi POI xuất ra thuộc tập DB đủ điều kiện, không giả định tập con sau thinning', async () => {
    const readIds = (/** @type {string} */ release) =>
      new Set(
        readFileSync(resolve(WORK, 'poi', `${release}.geojsonseq`), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line).properties.id),
      );
    const osmIds = readIds('poi-osm-fixture');
    const allIds = readIds('poi-fixture');
    expect(osmIds.size).toBeGreaterThan(0);

    const allowed = await sql`SELECT id FROM poi p
      WHERE p.status = 'active' AND (p.primary_source = 'osm' OR p.created_by = 'user')`;
    const allowedIds = new Set(allowed.map((row) => row.id));
    for (const id of osmIds) expect(allowedIds.has(id), `POI ${id} không phải osm/user`).toBe(true);

    expect(osmIds.has('USERPOI0000000000000000001')).toBe(true);
    expect(allIds.has('USERPOI0000000000000000001')).toBe(true);

    const [other] = await sql`SELECT count(*)::int AS n FROM poi
      WHERE status = 'active' AND primary_source IN ('overture', 'fsq')`;
    expect(other.n).toBeGreaterThan(0);

    const file = resolve(OUT, 'poi-osm-fixture.pmtiles');
    expect(existsSync(file)).toBe(true);
    expect(() => node('pipelines/tiles/src/qa.mjs', file, '--skip-islands')).not.toThrow();
  });

  it('thinning độc lập: Overture thắng all, OSM được phục hồi ở osm, user vẫn chịu thinning', () => {
    const readFeatures = (/** @type {string} */ release) =>
      readFileSync(resolve(WORK, 'poi', `${release}.geojsonseq`), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    const all = readFeatures('poi-fixture');
    const osm = readFeatures('poi-osm-fixture');
    const allIds = new Set(all.map((feature) => feature.properties.id));
    const osmIds = new Set(osm.map((feature) => feature.properties.id));

    expect(allIds.has(THIN_ALL_WINNER_ID)).toBe(true);
    expect(allIds.has(THIN_OSM_WINNER_ID)).toBe(false);
    expect(osmIds.has(THIN_OSM_WINNER_ID)).toBe(true);
    expect(osmIds.has(THIN_ALL_WINNER_ID)).toBe(false);
    expect(allIds.has(THIN_USER_ID)).toBe(false);
    expect(osmIds.has(THIN_USER_ID)).toBe(false);

    for (const [release, features, id] of [
      ['poi-fixture', all, THIN_ALL_WINNER_ID],
      ['poi-osm-fixture', osm, THIN_OSM_WINNER_ID],
    ]) {
      const feature = features.find((item) => item.properties.id === id);
      const zoom = feature.tippecanoe.minzoom;
      const { x, y } = lonLatToTile(108.6, 13.6, zoom);
      const decoded = JSON.parse(
        execFileSync(
          'tippecanoe-decode',
          [resolve(OUT, `${release}.pmtiles`), String(zoom), String(x), String(y)],
          { encoding: 'utf8' },
        ),
      );
      const decodedIds = decoded.features
        .flatMap((item) => (item.type === 'FeatureCollection' ? item.features : [item]))
        .map((item) => item.properties?.id);
      expect(decodedIds).toContain(id);
    }
  });

  it('hai profile giữ nguyên snapshot DB và chỉ nhận bản ghi mới ở build kế tiếp', () => {
    const readIds = (/** @type {string} */ release) =>
      new Set(
        readFileSync(resolve(WORK, 'poi', `${release}.geojsonseq`), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line).properties.id),
      );

    expect(readIds('poi-fixture').has(LATE_USER_POI_ID)).toBe(false);
    expect(readIds('poi-osm-fixture').has(LATE_USER_POI_ID)).toBe(false);
    expect(readIds('poi-fixture-next').has(LATE_USER_POI_ID)).toBe(true);
    expect(readIds('poi-osm-fixture-next').has(LATE_USER_POI_ID)).toBe(true);
  });

  it('báo cáo ghi ra out/poi-report-*.json với các khối poi/links/geocode', () => {
    const files = execFileSync('sh', ['-c', `ls ${OUT}/poi-report-*.json | tail -1`], {
      encoding: 'utf8',
    }).trim();
    const report = JSON.parse(execFileSync('cat', [files], { encoding: 'utf8' }));
    expect(report.poi.total).toBeGreaterThan(0);
    expect(report.links.links).toBeGreaterThan(0);
    expect(report.geocode.streets).toBeGreaterThan(0);
  });
});
