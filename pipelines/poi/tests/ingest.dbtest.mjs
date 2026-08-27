// Chạy trong image: PIPE pipeline pnpm test:db  (cần osmium, duckdb, Postgres host `postgres`)
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
const node = (/** @type {string[]} */ ...args) =>
  execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const duckCount = (/** @type {string} */ file) =>
  Number(
    execFileSync(
      'duckdb',
      ['-csv', '-noheader', '-c', `SELECT count(*) FROM read_parquet('${file}')`],
      {
        encoding: 'utf8',
      },
    ).trim(),
  );

beforeAll(() => {
  node('scripts/db-migrate.mjs');
  node('pipelines/poi/src/ingest/osm.mjs', '--fixture');
  node('pipelines/poi/src/ingest/overture.mjs', '--fixture');
  node('pipelines/poi/src/ingest/fsq.mjs', '--fixture');
});
afterAll(() => sql.end());

describe('ingest fixture Quận 1', () => {
  it('src_overture_place và src_fsq_place khớp số dòng parquet (Quận 1 nằm trọn trong VN)', async () => {
    const [[o], [f]] = await Promise.all([
      sql`SELECT count(*)::int AS n FROM src_overture_place`,
      sql`SELECT count(*)::int AS n FROM src_fsq_place`,
    ]);
    expect(o.n).toBe(duckCount('pipelines/poi/fixtures/overture-q1.parquet'));
    expect(f.n).toBe(duckCount('pipelines/poi/fixtures/fsq-q1.parquet'));
    expect(o.n).toBeGreaterThan(1000);
  });
  it('src_osm_place có Chợ Bến Thành, có POI dạng vùng (way) và có names jsonb', async () => {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM src_osm_place`;
    expect(n).toBeGreaterThan(500);
    const [bt] =
      await sql`SELECT osm_type, names FROM src_osm_place WHERE name ILIKE '%Bến Thành%' AND tags ? 'amenity' LIMIT 1`;
    expect(bt).toBeDefined();
    const [{ ways }] =
      await sql`SELECT count(*)::int AS ways FROM src_osm_place WHERE osm_type = 'w'`;
    expect(ways).toBeGreaterThan(50);
  });
  it('geometry hợp lệ, SRID 4326; Overture/FSQ nằm trong bbox Quận 1, OSM trong VN (fixture -s smart giữ trọn relation)', async () => {
    const [{ bad }] = await sql`SELECT count(*)::int AS bad FROM (
      SELECT geom FROM src_overture_place UNION ALL SELECT geom FROM src_fsq_place) g
      WHERE ST_SRID(geom) <> 4326 OR NOT ST_Within(geom, ST_MakeEnvelope(106.67, 10.75, 106.73, 10.81, 4326))`;
    expect(bad).toBe(0);
    const [{ badOsm }] = await sql`SELECT count(*)::int AS "badOsm" FROM src_osm_place
      WHERE ST_SRID(geom) <> 4326 OR NOT ST_Within(geom, ST_MakeEnvelope(102, 8, 110, 24, 4326))`;
    expect(badOsm).toBe(0);
    const [{ inQ1 }] =
      await sql`SELECT count(*)::int AS "inQ1" FROM src_osm_place WHERE ST_Within(geom, ST_MakeEnvelope(106.67, 10.75, 106.73, 10.81, 4326))`;
    expect(inQ1).toBeGreaterThan(500);
  });
  it('chạy lại idempotent: số dòng không đổi, không còn bảng _new', async () => {
    const before = (await sql`SELECT count(*)::int AS n FROM src_fsq_place`)[0].n;
    node('pipelines/poi/src/ingest/fsq.mjs', '--fixture');
    expect((await sql`SELECT count(*)::int AS n FROM src_fsq_place`)[0].n).toBe(before);
    expect(
      (
        await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE '%\\_new'`
      )[0].n,
    ).toBe(0);
  });
});
