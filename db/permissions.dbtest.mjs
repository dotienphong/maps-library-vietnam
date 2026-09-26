// Chạy: pnpm test:db (cần Postgres dev: pnpm db:up). Chỉ chạy trên DB local.
//
// Vì sao có file này: backup là pg_dump --no-owner, restore chạy bằng superuser, nên SAU RESTORE mọi
// bảng thuộc superuser cho tới khi PERMISSIONS_SQL trả lại cho `pipeline`. Bảng làm việc tạm của
// pipeline (poi_work_*, *_new, *_keys_stage, …) không có trong migration nhưng vẫn nằm trong backup;
// nếu bị bỏ sót, bước DROP đầu tiên của records.mjs chết "must be owner of table poi_work_pair" trên
// máy chủ vừa phục hồi (sự cố 26/09/2026, trước đó 13/09 với osm_road_raw). Test dựng đúng trạng
// thái đó rồi chạy các câu DROP của mã thật dưới role `pipeline`.
import { execFileSync } from 'node:child_process';
import 'dotenv/config';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS_SQL } from '../scripts/lib/db-permissions.mjs';
import { databaseUrlFromEnv } from '../scripts/lib/migrations.mjs';

const url = databaseUrlFromEnv(process.env);
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
  throw new Error(`dbtest chỉ chạy trên DB local, không phải ${host}`);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

/** Bảng tạm mà pipeline tự tạo rồi tự DROP ở lần chạy sau (records, conflate, publish, geocode). */
const BANG_TAM = [
  'poi_work_record',
  'poi_work_pair',
  'poi_work_cluster',
  'poi_work_cluster_meta',
  'poi_new',
  'admin_area_new',
  'osm_road_raw_new',
  'street_keys_stage',
  'admin_overlap_work',
  'address_anchor_raw',
  'address_anchor_edge',
  'address_anchor_merge',
];

/** Bảng pipeline tạo ngoài migration mà PERMISSIONS_SQL gọi đích danh; DB production phục hồi luôn có. */
const BANG_PIPELINE = ['osm_road_raw', 'osm_admin_raw', 'osm_admin_old_raw', 'vn_boundary'];
/** @type {string[]} */
let taoThem = [];

beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/db-migrate.mjs'], { stdio: 'inherit' });
  const coSan = (
    await sql`SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ANY (${BANG_PIPELINE})`
  ).map((r) => r.tablename);
  taoThem = BANG_PIPELINE.filter((bang) => !coSan.includes(bang));
  for (const bang of taoThem) await sql.unsafe(`CREATE TABLE ${bang} (id serial PRIMARY KEY)`);
  await sql.unsafe(`DROP TABLE IF EXISTS ${BANG_TAM.join(', ')}`);
  // Như sau pg_restore --no-owner: bảng thuộc role đang restore (superuser), không phải pipeline.
  await sql.unsafe('CREATE TABLE poi_work_record (rid serial PRIMARY KEY)');
  for (const bang of BANG_TAM.slice(1)) await sql.unsafe(`CREATE TABLE ${bang} (id int)`);
  await sql.unsafe(PERMISSIONS_SQL);
});

afterAll(async () => {
  await sql.unsafe(`DROP TABLE IF EXISTS ${[...BANG_TAM, ...taoThem].join(', ')}`);
  await sql.end({ timeout: 5 });
});

describe('PERMISSIONS_SQL sau restore', () => {
  it('trả bảng làm việc tạm của pipeline về pipeline để lần chạy sau DROP được', async () => {
    await sql.unsafe('SET ROLE pipeline');
    try {
      // Nguyên văn câu mở đầu của records.mjs và conflate.mjs.
      await sql.unsafe(
        'DROP TABLE IF EXISTS poi_work_pair, poi_work_cluster_meta, poi_work_cluster, poi_work_record',
      );
      await sql.unsafe(
        'DROP TABLE IF EXISTS poi_new, admin_area_new, osm_road_raw_new, street_keys_stage',
      );
      await sql.unsafe(
        'DROP TABLE IF EXISTS admin_overlap_work, address_anchor_raw, address_anchor_edge, address_anchor_merge',
      );
    } finally {
      await sql.unsafe('RESET ROLE');
    }
    const conLai = await sql`SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ANY (${BANG_TAM})`;
    expect(conLai).toEqual([]);
  });

  it('không kéo bảng migration của superuser (tenant, api_key, poi_edit) về pipeline', async () => {
    const owners = await sql`SELECT tablename, tableowner FROM pg_tables
      WHERE schemaname = 'public' AND tablename IN ('tenant', 'api_key', 'poi_edit')
      ORDER BY tablename`;
    expect(owners.map((r) => r.tableowner)).not.toContain('pipeline');
    expect(owners).toHaveLength(3);
  });
});
