// Toàn chuỗi trên fixture Quận 1 → poi hợp lý, poi.pmtiles sinh ra và qua QA. Chạy trong image.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';

const OUT = process.env.MAPSLIBVN_OUT ?? resolve('out');
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
const node = (/** @type {string[]} */ ...args) =>
  execFileSync(process.execPath, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

beforeAll(() => {
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
    node(`pipelines/poi/src/geocode/${stage}.mjs`);
  }
  node('pipelines/poi/src/export-tiles.mjs', '--release', 'poi-fixture');
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
