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
        AND table_name NOT IN (
          'spatial_ref_sys','vn_boundary','osm_road_raw','osm_admin_raw','osm_admin_old_raw','address_anchor_raw'
        )
      ORDER BY 1`
  ).map((r) => r.table_name);

const ALL_TABLES = [
  'address_anchor',
  'admin_alias',
  'admin_area',
  'admin_area_old',
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
    expect(byTable['admin_area_old.geom']).toBe('MULTIPOLYGON:4326');
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
      'src_fsq_place',
      'admin_area',
      'admin_area_old',
      'street',
      'alley',
      'address_anchor',
    ]) {
      expect(has(new RegExp(`ON public\\.${t} USING gist \\(geom\\)`)), t).toBe(true);
    }
  });

  it('ràng buộc: status, created_by, plan, api_key hash format', async () => {
    await expect(
      sql`INSERT INTO poi (id, name, name_norm, geom, status, created_by)
          VALUES ('x', 'A', 'a', ST_SetSRID(ST_MakePoint(106.7, 10.77), 4326), 'weird', 'pipeline')`,
    ).rejects.toThrow(/poi_status_check/);
    await expect(sql`INSERT INTO tenant (name, plan) VALUES ('t', 'gold')`).rejects.toThrow(
      /tenant_plan_check/,
    );
    const [t] = await sql`INSERT INTO tenant (name, plan) VALUES ('t', 'internal') RETURNING id`;
    await expect(
      sql`INSERT INTO api_key (key_hash, key_prefix, tenant_id, kind)
          VALUES ('bad', 'mlv_live_12345678', ${t.id}, 'web')`,
    ).rejects.toThrow(/api_key_key_hash_chk/);
    const columns = (
      await sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'api_key'`
    ).map((row) => row.column_name);
    expect(columns).not.toContain('key');
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

  it('0007: pg_trgm.word_similarity_threshold = 0.5 ở cấp database, phiên mới đọc được', async () => {
    const [setting] = await sql`SELECT setconfig FROM pg_db_role_setting
      WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND setrole = 0`;
    expect(setting?.setconfig).toContain('pg_trgm.word_similarity_threshold=0.5');
    // Phiên hiện tại mở trước migration nên còn giá trị cũ; mở phiên mới để kiểm giá trị hiệu lực.
    // Giá trị cấp database vào phiên mới dưới dạng placeholder; chỉ khi thư viện pg_trgm được nạp
    // (gọi bất kỳ hàm nào của nó, đúng như route autocomplete làm) thì GUC mới thành thật và được
    // kiểm kiểu. Vì vậy phải nạp trước rồi mới đọc — đọc trước khi nạp thì similarity_threshold
    // báo "unrecognized configuration parameter".
    const fresh = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await fresh`SELECT show_trgm('x')`;
      const [row] = await fresh`SELECT current_setting('pg_trgm.word_similarity_threshold') AS v,
        current_setting('pg_trgm.similarity_threshold') AS s`;
      expect(row?.v).toBe('0.5');
      expect(row?.s).toBe('0.3');
      // Ngưỡng thật sự chi phối toán tử <%: 'cho ray' khớp mờ, chuỗi rời rạc thì không.
      const [op] = await fresh`SELECT ('cho ray' <% 'benh vien cho ray tphcm') AS gan,
        ('cho ray' <% 'quan an ngon bat dan') AS xa`;
      expect(op?.gan).toBe(true);
      expect(op?.xa).toBe(false);
    } finally {
      await fresh.end();
    }
  });

  it('0009: cột dẫn xuất tìm kiếm và chỉ số GIN (quyết định 1: name_tsv là cột THƯỜNG)', async () => {
    const cols = async (/** @type {string} */ table) =>
      (
        await sql`SELECT column_name, is_generated FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table}`
      ).map((r) => `${r.column_name}:${r.is_generated}`);
    expect(await cols('poi')).toEqual(
      expect.arrayContaining(['name_key:NEVER', 'name_alt_norm:NEVER', 'name_tsv:NEVER']),
    );
    expect(await cols('street')).toEqual(
      expect.arrayContaining([
        'name_alt:NEVER',
        'name_key:NEVER',
        'name_alt_norm:NEVER',
        'name_tsv:NEVER',
      ]),
    );
    expect(await cols('admin_area')).toEqual(expect.arrayContaining(['name_key:NEVER']));
    expect(await cols('admin_area_old')).toEqual(expect.arrayContaining(['name_key:NEVER']));
    expect(await cols('admin_alias')).toEqual(expect.arrayContaining(['alias_key:NEVER']));

    const defs = (await sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'`).map(
      (r) => r.indexdef,
    );
    for (const needle of [
      'poi_name_key_trgm_idx ON public.poi USING gin (name_key gin_trgm_ops)',
      'poi_name_alt_norm_trgm_idx ON public.poi USING gin (name_alt_norm gin_trgm_ops)',
      'poi_name_tsv_idx ON public.poi USING gin (name_tsv)',
      'street_name_key_trgm_idx ON public.street USING gin (name_key gin_trgm_ops)',
      'street_name_alt_norm_trgm_idx ON public.street USING gin (name_alt_norm gin_trgm_ops)',
      'street_name_tsv_idx ON public.street USING gin (name_tsv)',
      'admin_area_name_key_trgm_idx ON public.admin_area USING gin (name_key gin_trgm_ops)',
      'admin_area_old_name_key_trgm_idx ON public.admin_area_old USING gin (name_key gin_trgm_ops)',
      'admin_alias_alias_key_trgm_idx ON public.admin_alias USING gin (alias_key gin_trgm_ops)',
    ]) {
      expect(
        defs.some((d) => d.includes(needle)),
        needle,
      ).toBe(true);
    }
  });

  it('0009: name_tsv điền được bằng SQL thuần (migration backfill bằng đúng câu này)', async () => {
    await sql`INSERT INTO street (osm_way_ids, name, name_norm, geom)
      VALUES ('{990009}', 'Đường 0009 Test', 'duong 0009 test',
        ST_Multi(ST_GeomFromText('LINESTRING(106.7 10.77,106.71 10.77)', 4326)))`;
    await sql`UPDATE street SET name_tsv = to_tsvector('simple', name_norm) WHERE name_tsv IS NULL`;
    const [row] =
      await sql`SELECT name_tsv::text AS tsv FROM street WHERE name_norm = 'duong 0009 test'`;
    expect(row?.tsv).toContain("'duong':1");
    await sql`DELETE FROM street WHERE name_norm = 'duong 0009 test'`;
  });

  it('--down revert từng migration rồi migrate lại về đủ bảng', async () => {
    // 0008 chỉ down khi dữ liệu alias còn 1–1.
    // Các file DB chạy tuần tự nhưng dùng chung DB; geocode có thể đã publish cạnh 1–n hợp lệ.
    // Test từ chối mất dữ liệu 1–n nằm ở admin-old.dbtest, còn test vòng đời này cần fixture 1–1.
    await sql.unsafe(`WITH ranked AS (
      SELECT ctid,row_number() OVER (
        PARTITION BY alias_norm,level ORDER BY share DESC,admin_area_id
      ) position FROM admin_alias
    ) DELETE FROM admin_alias target USING ranked
      WHERE target.ctid=ranked.ctid AND ranked.position>1`);
    const applied =
      await sql`SELECT name FROM schema_migrations WHERE name <> '0001_extensions.sql'`;
    for (const _migration of applied) migrate('--down');
    expect(await tables()).toEqual(['schema_migrations']);
    expect((await sql`SELECT name FROM schema_migrations`).map((r) => r.name)).toEqual([
      '0001_extensions.sql',
    ]);
    migrate();
    expect((await tables()).length).toBe(16);
  });
});
