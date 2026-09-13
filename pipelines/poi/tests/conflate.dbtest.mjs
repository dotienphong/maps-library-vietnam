// Chạy trong image: PIPE pipeline pnpm test:db — cần ingest fixture (ingest.dbtest chạy trước theo thứ tự tên file? KHÔNG — tự chạy lại ở đây)
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DBTEST_CHILD_TIMEOUT_MS } from '../../../scripts/lib/db-test.mjs';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { OUT, vnDate } from '../src/lib/env.mjs';
import {
  applyApprovedEditPopularity,
  assignHistoricalPoiIds,
  resolveHistoricalPoiIdConflicts,
  resolvePoiIds,
} from '../src/lib/poi-ids.mjs';

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
const EDIT_NOTE = 'task7-popularity-cap-test';
/** @type {Map<import('node:child_process').ChildProcess, { controller: AbortController, closed: Promise<void> }>} */
const activeChildren = new Map();
const node = (/** @type {string[]} */ ...args) =>
  new Promise((resolve, reject) => {
    const controller = new AbortController();
    const child = execFile(
      process.execPath,
      args,
      { encoding: 'utf8', signal: controller.signal, timeout: DBTEST_CHILD_TIMEOUT_MS },
      (error, stdout, stderr) => {
        activeChildren.delete(child);
        if (error) {
          error.message = `node ${args.join(' ')} thất bại: ${error.message}${stderr ? `\n${stderr}` : ''}`;
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
    const closed = new Promise((done) => child.once('close', () => done()));
    activeChildren.set(child, { controller, closed });
  });
const abortActiveChildren = async () => {
  const running = [...activeChildren.values()];
  for (const { controller } of running) controller.abort();
  await Promise.allSettled(running.map(({ closed }) => closed));
};
const runAll = async () => {
  await node('pipelines/poi/src/records.mjs');
  await node('pipelines/poi/src/conflate.mjs');
  await node('pipelines/poi/src/publish.mjs', '--force');
};

beforeAll(async () => {
  await node('scripts/db-migrate.mjs');
  for (const s of ['osm', 'fsq']) await node(`pipelines/poi/src/ingest/${s}.mjs`, '--fixture');
  await node('pipelines/poi/src/taxonomy.mjs', 'load');
  await sql`DELETE FROM src_fsq_place WHERE fsq_place_id LIKE 'test-%'`;
  await sql`DELETE FROM src_osm_place WHERE osm_type = 'n' AND osm_id >= 900000000000`;
  await sql`INSERT INTO src_osm_place (osm_type, osm_id, name, names, tags, geom, release) VALUES
    ('n', 900000000001, 'Cà phê Cộng', '{"name":"Cà phê Cộng"}', '{"amenity":"cafe","name":"Cà phê Cộng"}', ST_SetSRID(ST_MakePoint(106.7000, 10.7760), 4326), current_date),
    ('n', 900000000002, 'Highlands Coffee Nguyễn Huệ', '{"name":"Highlands Coffee Nguyễn Huệ"}', '{"amenity":"cafe","name":"Highlands Coffee Nguyễn Huệ","addr:housenumber":"18","addr:street":"Nguyễn Huệ"}', ST_SetSRID(ST_MakePoint(106.7040, 10.7740), 4326), current_date)`;
  // Cột theo db/migrations/0002_sources.sql: categories jsonb (mảng nhãn FSQ), date_closed date, release date.
  await sql`INSERT INTO src_fsq_place (fsq_place_id, name, categories, address, locality, region, tel, website, date_closed, geom, release) VALUES
    ('test-cong', 'Cong Caphe', '["Dining and Drinking > Cafe, Coffee, and Tea House > Coffee Shop"]', NULL, 'Quận 1', 'Hồ Chí Minh', NULL, NULL, NULL, ST_SetSRID(ST_MakePoint(106.7002, 10.7761), 4326), current_date),
    ('test-hl-1', 'Highlands Nguyen Hue', '["Dining and Drinking > Cafe, Coffee, and Tea House > Coffee Shop"]', '18 Nguyễn Huệ', 'Quận 1', 'Hồ Chí Minh', NULL, NULL, NULL, ST_SetSRID(ST_MakePoint(106.7041, 10.7741), 4326), current_date),
    ('test-hl-2', 'Highlands Coffee', '["Dining and Drinking > Cafe, Coffee, and Tea House > Coffee Shop"]', '76 Nguyễn Huệ', 'Quận 1', 'Hồ Chí Minh', NULL, NULL, NULL, ST_SetSRID(ST_MakePoint(106.7044, 10.7745), 4326), current_date)`;
  await sql`DELETE FROM poi_edit WHERE note = ${EDIT_NOTE}`;
  await runAll();
});
afterEach(abortActiveChildren);
afterAll(async () => {
  await abortActiveChildren();
  await sql`DELETE FROM poi_edit WHERE note = ${EDIT_NOTE}`;
  await sql.end();
});

const poiOf = async (/** @type {string} */ source, /** @type {string} */ id) =>
  (
    await sql`SELECT p.* FROM poi_source_link l JOIN poi p ON p.id = l.poi_id WHERE l.source = ${source} AND l.source_id = ${id}`
  )[0];

describe('gộp trên fixture Quận 1', () => {
  it('"Cà phê Cộng" ~ "Cong Caphe" gộp một poi, toạ độ lấy OSM, nguồn chính có 2 liên kết', async () => {
    const a = await poiOf('osm', 'n900000000001');
    const b = await poiOf('fsq', 'test-cong');
    expect(a.id).toBe(b.id);
    const [{ x }] = await sql`SELECT ST_X(geom) AS x FROM poi WHERE id = ${a.id}`;
    expect(Number(x)).toBeCloseTo(106.7, 4);
  });
  it('"Highlands Coffee Nguyễn Huệ" ~ "Highlands Nguyen Hue" (cùng số 18) gộp; "Highlands Coffee" số 76 cách 60 m KHÔNG gộp', async () => {
    const osm = await poiOf('osm', 'n900000000002');
    expect((await poiOf('fsq', 'test-hl-1')).id).toBe(osm.id);
    expect((await poiOf('fsq', 'test-hl-2')).id).not.toBe(osm.id);
  });
  it('report tách bare other, mapped *_other, và combined other', async () => {
    await node('pipelines/poi/src/report.mjs');
    const report = JSON.parse(
      readFileSync(resolve(OUT, `poi-report-${vnDate().replace(/-/g, '')}.json`), 'utf8'),
    );
    expect(report.poi).toMatchObject({
      bare_other: expect.any(Number),
      mapped_other: expect.any(Number),
      combined_other: expect.any(Number),
    });
    expect(report.poi).not.toHaveProperty('other');
    expect(report.poi.combined_other).toBe(report.poi.bare_other + report.poi.mapped_other);
  });
  it('popularity nhận approved/auto_approved edits một lần theo POI lịch sử, có cap', async () => {
    const before = await poiOf('osm', 'n900000000001');
    for (const status of ['approved', 'auto_approved', 'rejected', 'pending'])
      await sql`INSERT INTO poi_edit (poi_id, kind, status, note) VALUES (${before.id}, 'update', ${status}, ${EDIT_NOTE})`;
    await runAll();
    const belowCap = await poiOf('osm', 'n900000000001');
    expect(belowCap.id).toBe(before.id);
    expect(Number(belowCap.popularity)).toBeCloseTo(Number(before.popularity) + 0.4);

    for (const status of ['approved', 'approved', 'approved', 'auto_approved'])
      await sql`INSERT INTO poi_edit (poi_id, kind, status, note) VALUES (${before.id}, 'update', ${status}, ${EDIT_NOTE})`;
    await runAll();
    const after = await poiOf('osm', 'n900000000001');
    expect(after.id).toBe(before.id);
    expect(Number(after.popularity)).toBeCloseTo(Number(before.popularity) + 1);

    await runAll();
    const rerun = await poiOf('osm', 'n900000000001');
    expect(rerun.id).toBe(before.id);
    expect(Number(rerun.popularity)).toBeCloseTo(Number(after.popularity));
  });
  it('publish cập nhật mọi trường pipeline khi chỉ name_norm/name_alt/địa chỉ/popularity thay đổi', async () => {
    const before = await poiOf('fsq', 'test-hl-2');
    await sql`UPDATE poi_work_record SET name_norm = 'highlands changed', name_alt = ARRAY['alias changed'],
      housenumber = '99', street = 'Đường đổi', ward = 'Phường đổi', province = 'Tỉnh đổi'
      WHERE source = 'fsq' AND source_id = 'test-hl-2'`;
    await sql`UPDATE poi_work_cluster_meta SET popularity = 9.25 WHERE poi_id = ${before.id}`;
    await node('pipelines/poi/src/publish.mjs', '--force');
    const after = await poiOf('fsq', 'test-hl-2');
    expect(after.name_norm).toBe('highlands changed');
    expect(after.name_alt).toEqual(['alias changed']);
    expect(after.housenumber).toBe('99');
    expect(after.street).toBe('Đường đổi');
    expect(after.ward).toBe('Phường đổi');
    expect(after.province).toBe('Tỉnh đổi');
    expect(Number(after.popularity)).toBeCloseTo(9.25);
  }, 120_000);
  it('POI published có link, category, geom; bare other chưa ánh xạ < 10 %', async () => {
    const [{ n }] =
      await sql`SELECT count(*)::int AS n FROM poi p WHERE NOT EXISTS (SELECT 1 FROM poi_source_link l WHERE l.poi_id = p.id)`;
    expect(n).toBe(0);
    const [s] =
      await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE category = 'other')::int AS bare_other,
        count(*) FILTER (WHERE category = 'other' OR category LIKE '%\\_other')::int AS combined_other,
        count(*) FILTER (WHERE category IS NULL OR geom IS NULL)::int AS bad FROM poi`;
    expect(s.total).toBeGreaterThan(2000);
    expect(s.bad).toBe(0);
    expect(s.bare_other / s.total).toBeLessThan(0.1);
    console.log(
      `fixture combined other + *_other: ${((100 * s.combined_other) / s.total).toFixed(1)} %`,
    );
  });
  it('mọi work record eligible trong cluster có meta liên kết đúng final poi_id và role', async () => {
    const [{ bad }] = await sql`SELECT count(*)::int AS bad
      FROM poi_work_cluster c
      JOIN poi_work_cluster_meta m ON m.cluster_no = c.cluster_no
      JOIN poi_work_record r ON r.rid = c.rid
      LEFT JOIN poi_source_link l ON (l.source, l.source_id) = (r.source, r.source_id)
      WHERE l.poi_id IS DISTINCT FROM m.poi_id OR l.role IS DISTINCT FROM c.role`;
    expect(bad).toBe(0);
  });
  it('ID ổn định khi chạy lại; khi nguồn chính biến mất, ID giữ và primary_source đổi', async () => {
    const before = await poiOf('osm', 'n900000000001');
    const beforeAll =
      await sql`SELECT l.source, l.source_id, l.poi_id FROM poi_source_link l ORDER BY l.source, l.source_id`;
    await runAll();
    const again = await poiOf('osm', 'n900000000001');
    expect(again.id).toBe(before.id);
    expect(again.primary_source).toBe('osm');
    const afterAll =
      await sql`SELECT l.source, l.source_id, l.poi_id FROM poi_source_link l ORDER BY l.source, l.source_id`;
    expect(afterAll).toEqual(beforeAll);
    await sql`DELETE FROM src_osm_place WHERE osm_type = 'n' AND osm_id = 900000000001`;
    await runAll();
    const moved = await poiOf('fsq', 'test-cong');
    expect(moved.id).toBe(before.id);
    expect(moved.primary_source).toBe('fsq');
  });
  it('merge/split giữ lịch sử theo previous primary dù record đó là secondary hiện tại', async () => {
    const historicalPrimary = await poiOf('fsq', 'test-cong');
    const competingHistorical = await poiOf('fsq', 'test-hl-2');
    const [primaryRecord] =
      await sql`SELECT rid FROM poi_work_record WHERE source = 'fsq' AND source_id = 'test-cong'`;
    const [linkedSecondary] =
      await sql`SELECT rid FROM poi_work_record WHERE source = 'fsq' AND source_id = 'test-hl-2'`;
    const [outsidePrimary] =
      await sql`SELECT rid, source, source_id FROM poi_work_record WHERE rid NOT IN (${primaryRecord.rid}, ${linkedSecondary.rid}) ORDER BY rid LIMIT 1`;
    const [target] =
      await sql`SELECT cluster_no FROM poi_work_cluster WHERE rid = ${primaryRecord.rid}`;
    const [split] =
      await sql`SELECT cluster_no FROM poi_work_cluster WHERE rid = ${outsidePrimary.rid}`;
    await sql`UPDATE poi SET primary_source = ${outsidePrimary.source}, primary_source_id = ${outsidePrimary.source_id} WHERE id = ${competingHistorical.id}`;
    await sql`UPDATE poi_work_cluster SET cluster_no = ${target.cluster_no}, role = CASE WHEN rid = ${primaryRecord.rid} THEN 'secondary' ELSE 'primary' END
      WHERE rid IN (${primaryRecord.rid}, ${linkedSecondary.rid})`;
    await sql`UPDATE poi_work_cluster_meta SET poi_id = NULL WHERE cluster_no IN (${target.cluster_no}, ${split.cluster_no})`;
    await assignHistoricalPoiIds(sql);
    expect(
      (
        await sql`SELECT poi_id FROM poi_work_cluster_meta WHERE cluster_no = ${target.cluster_no}`
      )[0].poi_id,
    ).toBe(historicalPrimary.id);
    await sql`UPDATE poi_work_cluster_meta SET poi_id = ${historicalPrimary.id} WHERE cluster_no IN (${target.cluster_no}, ${split.cluster_no})`;
    await resolveHistoricalPoiIdConflicts(sql);
    expect(
      (
        await sql`SELECT poi_id FROM poi_work_cluster_meta WHERE cluster_no = ${target.cluster_no}`
      )[0].poi_id,
    ).toBe(historicalPrimary.id);
    expect(
      (
        await sql`SELECT poi_id FROM poi_work_cluster_meta WHERE cluster_no = ${split.cluster_no}`
      )[0].poi_id,
    ).toBeNull();
    await sql`UPDATE poi_work_cluster_meta SET poi_id = stable_id WHERE cluster_no = ${split.cluster_no}`;
  });
  it('chuỗi va chạm nhiều hop trả về poi_id duy nhất trước publish', async () => {
    const rows =
      await sql`SELECT cluster_no FROM poi_work_cluster_meta ORDER BY cluster_no LIMIT 3`;
    expect(rows).toHaveLength(3);
    const [a, b, c] = rows;
    const historical = await poiOf('fsq', 'test-cong');
    await sql`UPDATE poi_work_cluster_meta SET stable_id = ${historical.id}, poi_id = ${historical.id}, popularity = 0 WHERE cluster_no = ${a.cluster_no}`;
    await sql`UPDATE poi_work_cluster_meta SET stable_id = 'stable-b', poi_id = ${historical.id}, popularity = 0 WHERE cluster_no = ${b.cluster_no}`;
    await sql`UPDATE poi_work_cluster_meta SET stable_id = 'stable-c', poi_id = 'stable-b', popularity = 0 WHERE cluster_no = ${c.cluster_no}`;
    await resolvePoiIds(sql);
    await applyApprovedEditPopularity(sql);
    const resolved =
      await sql`SELECT cluster_no, poi_id FROM poi_work_cluster_meta WHERE cluster_no IN (${a.cluster_no}, ${b.cluster_no}, ${c.cluster_no}) ORDER BY cluster_no`;
    expect(resolved.map((r) => r.poi_id)).toEqual([historical.id, 'stable-b', 'stable-c']);
    const popularity =
      await sql`SELECT cluster_no, popularity FROM poi_work_cluster_meta WHERE cluster_no IN (${a.cluster_no}, ${b.cluster_no}, ${c.cluster_no}) ORDER BY cluster_no`;
    expect(Number(popularity[0].popularity)).toBeCloseTo(1);
    expect(Number(popularity[1].popularity)).toBe(0);
    expect(Number(popularity[2].popularity)).toBe(0);
    const [{ total, distinct_ids }] =
      await sql`SELECT count(*)::int AS total, count(DISTINCT poi_id)::int AS distinct_ids FROM poi_work_cluster_meta`;
    expect(distinct_ids).toBe(total);
  });
});
