// Chạy trên DB fixture cô lập: DATABASE_URL=postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn_task8_test pnpm test:db
import 'dotenv/config';
import { execFile } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DBTEST_CHILD_TIMEOUT_MS } from '../../../scripts/lib/db-test.mjs';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { buildAnchors } from '../src/geocode/anchors.mjs';
import { replaceRawTables } from '../src/geocode/raw-tables.mjs';

const databaseUrl = databaseUrlFromEnv(process.env);
if (new URL(databaseUrl).pathname !== '/mapslibvn_task8_test') {
  throw new Error('geocode.dbtest chỉ được chạy trên database mapslibvn_task8_test');
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
let adminOutput = '';
/** @type {Map<import('node:child_process').ChildProcess, { controller: AbortController, closed: Promise<void> }>} */
const activeChildren = new Map();

const node = (/** @type {string[]} */ ...args) =>
  new Promise((resolve, reject) => {
    const controller = new AbortController();
    const child = execFile(
      process.execPath,
      args,
      {
        encoding: 'utf8',
        signal: controller.signal,
        timeout: DBTEST_CHILD_TIMEOUT_MS,
      },
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

beforeAll(async () => {
  await node('scripts/db-migrate.mjs');
  for (const source of ['osm', 'overture', 'fsq']) {
    await node(`pipelines/poi/src/ingest/${source}.mjs`, '--fixture');
  }
  await node('pipelines/poi/src/taxonomy.mjs', 'load');
  await sql`INSERT INTO src_osm_place (osm_type, osm_id, name, names, tags, geom, release)
    VALUES ('n', 990000000001, 'Exact Priority OSM', '{"name":"Exact Priority OSM"}',
      '{"amenity":"cafe","addr:housenumber":"9002","addr:street":"Boundary Priority"}',
      ST_SetSRID(ST_MakePoint(106.6, 10.6), 4326), current_date)`;
  await sql`INSERT INTO src_overture_place
      (id, name, names, category, categories, confidence, addresses, websites, phones, sources, geom, release)
    VALUES
      ('task8-exact-priority', 'Exact Priority Overture', '{"primary":"Exact Priority Overture"}',
        'coffee_shop', '{"primary":"coffee_shop"}', 0.8,
        '[{"freeform":"9002 Boundary Priority"}]', '{}', '{}', '[]',
        ST_Project(ST_SetSRID(ST_MakePoint(106.6, 10.6), 4326)::geography, 29.9, radians(90))::geometry,
        'task8-fixture'),
      ('task8-exact-over-1', 'Exact Over One', '{"primary":"Exact Over One"}',
        'coffee_shop', '{"primary":"coffee_shop"}', 0.8,
        '[{"freeform":"9001 Boundary Exact"}]', '{}', '{}', '[]',
        ST_SetSRID(ST_MakePoint(106.55, 10.55), 4326), 'task8-fixture'),
      ('task8-exact-over-2', 'Exact Over Two', '{"primary":"Exact Over Two"}',
        'coffee_shop', '{"primary":"coffee_shop"}', 0.8,
        '[{"freeform":"9001 Boundary Exact"}]', '{}', '{}', '[]',
        ST_Project(ST_SetSRID(ST_MakePoint(106.55, 10.55), 4326)::geography, 30.1, radians(90))::geometry,
        'task8-fixture')`;
  await node('pipelines/poi/src/records.mjs');
  await node('pipelines/poi/src/geocode/osm-roads.mjs', '--fixture');
  await sql`INSERT INTO osm_admin_raw (osm_relation_id, level, name, name_norm, geom)
    VALUES
      (999999999999, 4, 'Hòa Bình', 'hoa binh',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(104, 22), 4326), 0.1))),
      (999999999998, 8, 'Phường Bến Thành cũ', 'ben thanh cu',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.698, 10.772), 4326), 0.0001))),
      (999999999997, 6, 'Đặc khu Test', 'dac khu test',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.699, 10.773), 4326), 0.00005))),
      (999999999996, 6, 'Xã Sa Mouay', 'sa mouay',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.4, 10.4), 4326), 0.001)))`;
  adminOutput = /** @type {string} */ (await node('pipelines/poi/src/geocode/admin.mjs'));
  await sql`WITH base AS (
      SELECT ST_SetSRID(ST_MakePoint(106.4, 10.5), 4326) AS named_base,
        ST_SetSRID(ST_MakePoint(106.5, 10.5), 4326) AS touch_base
    ), points AS (
      SELECT *,
        ST_Project(named_base::geography, 299, radians(0))::geometry AS named_299,
        ST_Project(named_base::geography, 301, radians(0))::geometry AS named_301,
        ST_Project(touch_base::geography, 14.9, radians(0))::geometry AS touch_149,
        ST_Project(touch_base::geography, 15.1, radians(0))::geometry AS touch_151
      FROM base
    )
    INSERT INTO osm_road_raw
      (osm_way_id, name, name_norm, highway, alley_keyword, alley_number, parent_norm, geom)
    SELECT 990000000011, 'Boundary Named Parent', 'boundary named parent', 'residential', NULL, NULL, NULL,
      ST_MakeLine(named_base, ST_Project(named_base::geography, 50, radians(90))::geometry) FROM points
    UNION ALL SELECT 990000000012, 'Hẻm 299 Boundary Named Parent', 'hem 299 boundary named parent',
      'service', 'hem', '299', 'boundary named parent',
      ST_MakeLine(named_299, ST_Project(named_299::geography, 5, radians(90))::geometry) FROM points
    UNION ALL SELECT 990000000013, 'Hẻm 301 Boundary Named Parent', 'hem 301 boundary named parent',
      'service', 'hem', '301', 'boundary named parent',
      ST_MakeLine(named_301, ST_Project(named_301::geography, 5, radians(90))::geometry) FROM points
    UNION ALL SELECT 990000000014, 'Boundary Touch Parent', 'boundary touch parent',
      'residential', NULL, NULL, NULL,
      ST_MakeLine(touch_base, ST_Project(touch_base::geography, 50, radians(90))::geometry) FROM points
    UNION ALL SELECT 990000000015, 'Hẻm 149', 'hem 149', 'service', 'hem', '149', NULL,
      ST_MakeLine(touch_149, ST_Project(touch_149::geography, 5, radians(90))::geometry) FROM points
    UNION ALL SELECT 990000000016, 'Hẻm 151', 'hem 151', 'service', 'hem', '151', NULL,
      ST_MakeLine(touch_151, ST_Project(touch_151::geography, 5, radians(90))::geometry) FROM points`;
  await node('pipelines/poi/src/geocode/streets.mjs');
  await node('pipelines/poi/src/geocode/alleys.mjs');
  await node('pipelines/poi/src/geocode/anchors.mjs');
}, 120_000);

afterEach(async () => {
  await abortActiveChildren();
});

afterAll(async () => {
  await abortActiveChildren();
  await sql.end();
});

describe('geocode tables trên fixture Quận 1', () => {
  it('admin_area có cấp 8 chứa Chợ Bến Thành và cấp 4 là Thành phố Hồ Chí Minh', async () => {
    const [ward] = await sql`SELECT name, name_norm, parent_id FROM admin_area
      WHERE level = 8 AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(106.698, 10.772), 4326)) LIMIT 1`;
    expect(ward).toBeDefined();
    const [province] = await sql`SELECT name_norm FROM admin_area
      WHERE level = 4 AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(106.698, 10.772), 4326))`;
    expect(province?.name_norm).toBe('ho chi minh');
    const [{ retired }] =
      await sql`SELECT count(*)::int AS retired FROM admin_area WHERE name_norm = 'hoa binh'`;
    expect(retired).toBe(0);
    const [{ legacyWard }] =
      await sql`SELECT count(*)::int AS "legacyWard" FROM admin_area WHERE name_norm = 'ben thanh cu'`;
    expect(legacyWard).toBe(0);
    const [specialZone] = await sql`SELECT level FROM admin_area WHERE name_norm = 'dac khu test'`;
    expect(specialZone?.level).toBe(8);
    const [{ foreignArea }] =
      await sql`SELECT count(*)::int AS "foreignArea" FROM admin_area WHERE name_norm = 'sa mouay'`;
    expect(foreignArea).toBe(0);
    const [{ aliasCount }] = await sql`SELECT count(*)::int AS "aliasCount" FROM admin_alias`;
    expect(adminOutput).toContain(`admin_alias ${aliasCount} dòng`);
  });

  it('street: Lê Lợi là một tuyến MultiLineString, có ward_norm, không có hẻm trong street', async () => {
    const rows = await sql`SELECT name, ward_norm, GeometryType(geom) AS t,
      array_length(osm_way_ids, 1) AS ways FROM street WHERE name_norm = 'le loi'`;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].t).toBe('MULTILINESTRING');
    expect(rows[0].ways).toBeGreaterThanOrEqual(1);
    expect(rows.some((row) => row.ward_norm.length > 0)).toBe(true);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM street
      WHERE name ~* '^(hẻm|ngõ|ngách|kiệt) [0-9]'`;
    expect(n).toBe(0);
  });

  it('alley: mọi hẻm có number; ≥ 60 % có đường mẹ và entrance nằm trên đường mẹ (≤ 1 m)', async () => {
    const [summary] = await sql`SELECT count(*)::int AS n,
      count(parent_street_id)::int AS wp, count(entrance)::int AS we FROM alley`;
    expect(summary.n).toBeGreaterThan(0);
    expect(summary.wp / summary.n).toBeGreaterThanOrEqual(0.6);
    expect(summary.we).toBe(summary.wp);
    const [{ far }] = await sql`SELECT count(*)::int AS far FROM alley a
      JOIN street s ON s.id = a.parent_street_id
      WHERE ST_Distance(a.entrance::geography, s.geom::geography) > 1`;
    expect(far).toBe(0);
    const boundaries = await sql`SELECT osm_way_id, parent_street_id FROM alley
      WHERE osm_way_id BETWEEN 990000000012 AND 990000000016 ORDER BY osm_way_id`;
    expect(
      boundaries.map((row) => [Number(row.osm_way_id), row.parent_street_id !== null]),
    ).toEqual([
      [990000000012, true],
      [990000000013, false],
      [990000000015, true],
      [990000000016, false],
    ]);
  });

  it('address_anchor: có mốc Lê Lợi, không trùng (số nhà, đường) trong 30 m, ward/province điền', async () => {
    const [{ n }] =
      await sql`SELECT count(*)::int AS n FROM address_anchor WHERE street_norm = 'le loi'`;
    expect(n).toBeGreaterThanOrEqual(3);
    const [{ dup }] = await sql`SELECT count(*)::int AS dup FROM address_anchor a
      JOIN address_anchor b ON a.id < b.id AND a.housenumber = b.housenumber
        AND a.street_norm = b.street_norm
        AND ST_DWithin(a.geom::geography, b.geom::geography, 30)`;
    expect(dup).toBe(0);
    const [{ wardFilled, provinceFilled, total }] = await sql`SELECT
      count(ward_norm)::int AS "wardFilled", count(province_norm)::int AS "provinceFilled",
      count(*)::int AS total FROM address_anchor`;
    expect(wardFilled / total).toBeGreaterThan(0.95);
    expect(provinceFilled / total).toBeGreaterThan(0.95);
    const overThirty = await sql`SELECT source FROM address_anchor
      WHERE housenumber = '9001' AND street_norm = 'boundary exact' ORDER BY id`;
    expect(overThirty).toHaveLength(2);
    const priority = await sql`SELECT source FROM address_anchor
      WHERE housenumber = '9002' AND street_norm = 'boundary priority'`;
    expect(priority).toEqual([{ source: 'osm' }]);
  });

  it('chạy lại idempotent (không còn _new, số dòng không đổi)', async () => {
    const before = (await sql`SELECT count(*)::int AS n FROM street`)[0].n;
    await node('pipelines/poi/src/geocode/streets.mjs');
    await node('pipelines/poi/src/geocode/alleys.mjs');
    expect((await sql`SELECT count(*)::int AS n FROM street`)[0].n).toBe(before);
    expect(
      (
        await sql`SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_name LIKE '%\\_new'`
      )[0].n,
    ).toBe(0);
  }, 120_000);

  it('raw swap thất bại giữ nguyên cả hai bảng cũ và cleanup staging', async () => {
    const before = await sql`SELECT
      (SELECT count(*)::int FROM osm_road_raw) AS roads,
      (SELECT count(*)::int FROM osm_admin_raw) AS admins`;
    async function* brokenRoads() {
      yield [
        990000000099,
        'Broken staging',
        'broken staging',
        'service',
        null,
        null,
        null,
        'SRID=4326;LINESTRING(106.6 10.6,106.6001 10.6001)',
      ];
      throw new Error('task8 intentional raw staging failure');
    }
    await expect(replaceRawTables(sql, { roadRows: brokenRoads(), adminRows: [] })).rejects.toThrow(
      'task8 intentional raw staging failure',
    );
    expect(
      await sql`SELECT
      (SELECT count(*)::int FROM osm_road_raw) AS roads,
      (SELECT count(*)::int FROM osm_admin_raw) AS admins`,
    ).toEqual(before);
    const [{ staging }] = await sql`SELECT count(*)::int AS staging
      FROM information_schema.tables
      WHERE table_name IN ('osm_road_raw_new', 'osm_admin_raw_new')`;
    expect(staging).toBe(0);
  });

  it('anchor build thất bại giữ bảng published và cleanup raw/new staging', async () => {
    const [{ before }] = await sql`SELECT count(*)::int AS before FROM address_anchor`;
    await expect(
      buildAnchors({
        afterRaw: () => {
          throw new Error('task8 intentional anchor staging failure');
        },
      }),
    ).rejects.toThrow('task8 intentional anchor staging failure');
    expect((await sql`SELECT count(*)::int AS n FROM address_anchor`)[0].n).toBe(before);
    const [{ staging }] = await sql`SELECT count(*)::int AS staging
      FROM information_schema.tables
      WHERE table_name IN (
        'address_anchor_raw', 'address_anchor_edge', 'address_anchor_merge', 'address_anchor_new'
      )`;
    expect(staging).toBe(0);
  }, 120_000);

  it('alleys từ chối street_new chưa ready và giữ nguyên published tables', async () => {
    const [before] = await sql`SELECT
      (SELECT count(*)::int FROM street) AS streets,
      (SELECT count(*)::int FROM alley) AS alleys`;
    await sql.unsafe(`DROP TABLE IF EXISTS street_new;
      CREATE TABLE street_new (LIKE street INCLUDING ALL)`);
    await expect(node('pipelines/poi/src/geocode/alleys.mjs')).rejects.toThrow(
      /street_new chưa sẵn sàng/,
    );
    expect(
      await sql`SELECT
        (SELECT count(*)::int FROM street) AS streets,
        (SELECT count(*)::int FROM alley) AS alleys`,
    ).toEqual([before]);
    const [{ staging }] = await sql`SELECT count(*)::int AS staging
      FROM information_schema.tables WHERE table_name IN ('street_new', 'alley_new')`;
    expect(staging).toBe(0);
  });
});
