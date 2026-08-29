// Chạy trên DB fixture cô lập: DATABASE_URL=postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn_task8_test pnpm test:db
import 'dotenv/config';
import { execFile } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';

const databaseUrl = databaseUrlFromEnv(process.env);
if (new URL(databaseUrl).pathname !== '/mapslibvn_task8_test') {
  throw new Error('geocode.dbtest chỉ được chạy trên database mapslibvn_task8_test');
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const CHILD_TIMEOUT_MS = 110_000;
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
        timeout: CHILD_TIMEOUT_MS,
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
  await node('pipelines/poi/src/records.mjs');
  await node('pipelines/poi/src/geocode/osm-roads.mjs', '--fixture');
  await sql`INSERT INTO osm_admin_raw (osm_relation_id, level, name, name_norm, geom)
    VALUES
      (999999999999, 4, 'Hòa Bình', 'hoa binh',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(104, 22), 4326), 0.1))),
      (999999999998, 8, 'Phường Bến Thành cũ', 'ben thanh cu',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.698, 10.772), 4326), 0.0001))),
      (999999999997, 6, 'Đặc khu Test', 'dac khu test',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.5, 10.5), 4326), 0.001))),
      (999999999996, 6, 'Sa Mouay', 'sa mouay',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.4, 10.4), 4326), 0.001)))`;
  adminOutput = /** @type {string} */ (await node('pipelines/poi/src/geocode/admin.mjs'));
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
    const [{ filled, total }] = await sql`SELECT count(province_norm)::int AS filled,
      count(*)::int AS total FROM address_anchor`;
    expect(filled / total).toBeGreaterThan(0.95);
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
});
