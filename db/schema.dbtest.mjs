// Chạy: pnpm test:db (cần Postgres dev: pnpm db:up). Chỉ chạy trên DB local.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../scripts/lib/migrations.mjs';

const url = databaseUrlFromEnv(process.env);
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
  throw new Error(`dbtest chỉ chạy trên DB local, không phải ${host}`);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const migrate = (/** @type {string[]} */ ...args) =>
  execFileSync(process.execPath, ['scripts/db-migrate.mjs', ...args], {
    encoding: 'utf8',
    env: process.env,
  });

// Bỏ bảng của PostGIS (spatial_ref_sys) và bảng làm việc do pipeline tạo lúc chạy (không thuộc migration)
const tables = async () =>
  (
    await sql`SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE 'poi\\_work\\_%'
        AND table_name NOT IN ('spatial_ref_sys', 'vn_boundary', 'osm_road_raw', 'osm_admin_raw', 'address_anchor_raw')
      ORDER BY 1`
  ).map((r) => r.table_name);

const ALL_TABLES = [
  'address_anchor',
  'admin_alias',
  'admin_area',
  'alley',
  'api_key',
  'category',
  'category_map',
  'poi',
  'poi_edit',
  'poi_source_link',
  'schema_migrations',
  'src_fsq_place',
  'src_osm_place',
  'src_overture_place',
  'street',
  'tenant',
];

beforeAll(() => {
  migrate();
});
afterAll(() => sql.end());

describe('lược đồ spec 5.2', () => {
  it('đủ 16 bảng', async () => {
    expect(await tables()).toEqual(expect.arrayContaining(ALL_TABLES));
  });

  it('kiểu geometry và SRID đúng', async () => {
    const rows =
      await sql`SELECT f_table_name AS t, f_geometry_column AS c, type, srid FROM geometry_columns ORDER BY 1, 2`;
    const byTable = Object.fromEntries(rows.map((r) => [`${r.t}.${r.c}`, `${r.type}:${r.srid}`]));
    expect(byTable['poi.geom']).toBe('POINT:4326');
    expect(byTable['street.geom']).toBe('MULTILINESTRING:4326');
    expect(byTable['alley.geom']).toBe('LINESTRING:4326');
    expect(byTable['alley.entrance']).toBe('POINT:4326');
    expect(byTable['admin_area.geom']).toBe('MULTIPOLYGON:4326');
    expect(byTable['address_anchor.geom']).toBe('POINT:4326');
  });

  it('index GIST/GIN/B-tree theo spec (so theo định nghĩa, không theo tên)', async () => {
    const defs = (await sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'`).map((r) =>
      String(r.indexdef),
    );
    const has = (/** @type {RegExp} */ re) => defs.some((d) => re.test(d));
    expect(has(/ON public\.poi USING gist \(geom\)/)).toBe(true);
    expect(has(/ON public\.poi USING gin \(name_norm gin_trgm_ops\)/)).toBe(true);
    expect(has(/ON public\.street USING gin \(name_norm gin_trgm_ops\)/)).toBe(true);
    expect(has(/ON public\.address_anchor USING gin \(street_norm gin_trgm_ops\)/)).toBe(true);
    expect(has(/ON public\.address_anchor USING btree \(street_norm, ward_norm\)/)).toBe(true);
    expect(has(/ON public\.poi USING btree \(status, category\)/)).toBe(true);
    for (const t of [
      'src_osm_place',
      'src_overture_place',
      'src_fsq_place',
      'admin_area',
      'street',
      'alley',
      'address_anchor',
    ]) {
      expect(has(new RegExp(`ON public\\.${t} USING gist \\(geom\\)`)), t).toBe(true);
    }
  });

  it('ràng buộc: status, created_by, plan, api_key format', async () => {
    await expect(
      sql`INSERT INTO poi (id, name, name_norm, geom, status, created_by)
          VALUES ('x', 'A', 'a', ST_SetSRID(ST_MakePoint(106.7, 10.77), 4326), 'weird', 'pipeline')`,
    ).rejects.toThrow(/poi_status_check/);
    await expect(sql`INSERT INTO tenant (name, plan) VALUES ('t', 'gold')`).rejects.toThrow(
      /tenant_plan_check/,
    );
    const [t] = await sql`INSERT INTO tenant (name, plan) VALUES ('t', 'internal') RETURNING id`;
    await expect(
      sql`INSERT INTO api_key (key, tenant_id, kind) VALUES ('bad', ${t.id}, 'web')`,
    ).rejects.toThrow(/api_key_key_check/);
    await sql`DELETE FROM tenant WHERE id = ${t.id}`;
  });

  it('quyền: api chỉ SELECT (+ INSERT poi_edit), pipeline sở hữu bảng dữ liệu', async () => {
    const grants =
      await sql`SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
      WHERE grantee IN ('api', 'pipeline') AND table_schema = 'public'`;
    const api = grants.filter((g) => g.grantee === 'api');
    expect(api.some((g) => g.table_name === 'poi' && g.privilege_type === 'SELECT')).toBe(true);
    expect(api.some((g) => g.table_name === 'poi' && g.privilege_type !== 'SELECT')).toBe(false);
    expect(api.some((g) => g.table_name === 'poi_edit' && g.privilege_type === 'INSERT')).toBe(
      true,
    );
    const [owner] = await sql`SELECT tableowner FROM pg_tables WHERE tablename = 'poi'`;
    expect(owner.tableowner).toBe('pipeline');
  });

  it('--down revert từng migration rồi migrate lại về đủ bảng', async () => {
    // 0002…0006: năm migration sau 0001 (0006 chỉ thêm cột/hàm, không thêm bảng).
    for (let i = 0; i < 5; i++) migrate('--down');
    expect(await tables()).toEqual(['schema_migrations']);
    expect((await sql`SELECT name FROM schema_migrations`).map((r) => r.name)).toEqual([
      '0001_extensions.sql',
    ]);
    migrate();
    expect((await tables()).length).toBe(16);
  });
});
