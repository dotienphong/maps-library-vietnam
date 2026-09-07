// Kiểm publish.mjs tôn trọng locked_fields và giữ POI người dùng (M4 Task 9, spec 6.5).
// CẢNH BÁO: publish.mjs ghi thật vào bảng poi của DB đang trỏ tới — nó đóng/xoá mọi POI
// created_by='pipeline' không có trong poi_new. Chỉ chạy trên dev DB (pnpm test:db), như
// pipeline-fixture.dbtest.mjs. Nạp lại dữ liệu dev bằng pnpm db:fixture nếu cần.
import 'dotenv/config';
import { execFile } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DBTEST_CHILD_TIMEOUT_MS } from '../../../scripts/lib/db-test.mjs';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
const node = (/** @type {string[]} */ ...args) =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      { encoding: 'utf8', timeout: DBTEST_CHILD_TIMEOUT_MS, env: process.env },
      (error, stdout, stderr) =>
        error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout),
    );
  });

const POI_ID = '01M4LOCK00000000000000EDIT';
const USER_POI_ID = '01M4LOCK000000000000000USR';
const cleanup = async () => {
  await sql`DROP TABLE IF EXISTS poi_work_record, poi_work_cluster, poi_work_cluster_meta, poi_work_pair, poi_new`;
  await sql`DELETE FROM poi_source_link WHERE poi_id IN (${POI_ID}, ${USER_POI_ID})`;
  await sql`DELETE FROM poi_edit WHERE note = 'm4lock'`;
  await sql`DELETE FROM poi WHERE id IN (${POI_ID}, ${USER_POI_ID})`;
  await sql`DELETE FROM address_anchor WHERE source = 'user' AND source_id = 'edit-m4lock-test'`;
  await sql`DELETE FROM category WHERE code = 'm4lock_cafe'`;
  await sql`DELETE FROM tenant WHERE id = '00000000-0000-4000-8000-000000000911'`;
};

beforeAll(async () => {
  await cleanup();
  await sql`INSERT INTO tenant (id, name, plan)
    VALUES ('00000000-0000-4000-8000-000000000911', 'M4 lock dbtest', 'free')
    ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO category (code, group_code, name_vi, name_en, icon, rank)
    VALUES ('m4lock_cafe', 'food_drink', 'Cafe khoá', 'Cafe lock', 'cafe', 3)`;
  // POI pipeline hiện có với hours do người dùng sửa (đã khoá) + POI người dùng tạo.
  await sql`INSERT INTO poi (id, name, name_norm, category, geom, hours, quality_score, popularity,
      status, locked_fields, created_by)
    VALUES
    (${POI_ID}, 'Quán Bị Khoá Giờ', 'quan bi khoa gio', 'm4lock_cafe',
      ST_SetSRID(ST_MakePoint(106.7, 10.77), 4326), '{"osm":"Mo-Su 06:00-23:00"}'::jsonb,
      70, 0.5, 'active', '{hours}', 'pipeline'),
    (${USER_POI_ID}, 'Quán Người Dùng', 'quan nguoi dung', 'm4lock_cafe',
      ST_SetSRID(ST_MakePoint(106.71, 10.78), 4326), NULL, 60, 0.2, 'active', '{name,geom}', 'user')`;
  await sql`INSERT INTO poi_edit (poi_id, tenant_id, end_user_hash, kind, changes, status, note)
    VALUES (${POI_ID}, '00000000-0000-4000-8000-000000000911', 'm4lock-u1', 'update',
            '{"hours":{"osm":"Mo-Su 06:00-23:00"}}'::jsonb, 'auto_approved', 'm4lock')`;

  // Bảng work tối thiểu để publish.mjs dựng poi_new: cùng poi_id nhưng name/hours khác nguồn.
  // Cột phải đủ cho mọi tham chiếu r.* trong publish.mjs — gồm cả r.confidence (poi_source_link).
  await sql`CREATE TABLE poi_work_record (
      rid int PRIMARY KEY, source text, source_id text, confidence real,
      name text, name_norm text, name_alt text[], name_key text, name_alt_norm text,
      category text, geom geometry(Point,4326),
      housenumber text, street text, ward text, province text, address_text text,
      contact jsonb, hours jsonb)`;
  // Liệt kê cột TƯỜNG MINH: bản trước dùng VALUES theo vị trí, nên thêm một cột vào publish.mjs là
  // test vỡ ở CI với `column r.name_key does not exist` mà máy dev không thấy.
  await sql`INSERT INTO poi_work_record
      (rid, source, source_id, confidence, name, name_norm, name_alt, name_key, name_alt_norm,
       category, geom, hours)
    VALUES
    (1, 'osm', 'm4lock-osm-1', 1, 'Quán Tên Mới Từ Nguồn', 'quan ten moi tu nguon', NULL,
     'quantenmoitunguon', NULL, 'm4lock_cafe',
     ST_SetSRID(ST_MakePoint(106.7001, 10.7701), 4326),
     '{"osm":"Mo-Su 08:00-20:00"}'::jsonb)`;
  await sql`CREATE TABLE poi_work_cluster (cluster_no int, rid int, role text)`;
  await sql`INSERT INTO poi_work_cluster VALUES (1, 1, 'primary')`;
  await sql`CREATE TABLE poi_work_cluster_meta (cluster_no int, poi_id text, primary_rid int,
      quality_score smallint, popularity real, status text)`;
  await sql`INSERT INTO poi_work_cluster_meta VALUES (1, ${POI_ID}, 1, 75, 0.6, 'active')`;
});
afterAll(async () => {
  await cleanup();
  await sql.end({ timeout: 5 });
});

describe('publish.mjs với locked_fields', () => {
  it('không ghi đè hours bị khoá nhưng vẫn cập nhật name; giữ nguyên POI người dùng', async () => {
    await node('pipelines/poi/src/publish.mjs', '--force');

    const [locked] = await sql`SELECT name, hours, locked_fields FROM poi WHERE id = ${POI_ID}`;
    expect(locked.name).toBe('Quán Tên Mới Từ Nguồn'); // trường không khoá: theo nguồn
    expect(locked.hours).toEqual({ osm: 'Mo-Su 06:00-23:00' }); // trường khoá: giữ của người dùng
    expect(locked.locked_fields).toEqual(['hours']);

    // POI created_by='user' không bị đóng/xoá dù không có trong poi_new.
    const [user] = await sql`SELECT name, status FROM poi WHERE id = ${USER_POI_ID}`;
    expect(user).toMatchObject({ name: 'Quán Người Dùng', status: 'active' });
  });

  it('POI pipeline có status bị khoá thì không bị đóng khi biến mất khỏi nguồn', async () => {
    await sql`UPDATE poi SET locked_fields = '{hours,status}' WHERE id = ${POI_ID}`;
    // Lần chạy này poi_new rỗng → mọi POI pipeline "biến mất khỏi nguồn".
    await sql`DELETE FROM poi_work_cluster_meta`;
    await node('pipelines/poi/src/publish.mjs', '--force');

    const [row] = await sql`SELECT status FROM poi WHERE id = ${POI_ID}`;
    expect(row.status).toBe('active'); // status bị khoá → pipeline không đóng
  });
});

describe('anchors giữ mốc người dùng', () => {
  it('câu SQL chép source=user sang address_anchor_new hoạt động', async () => {
    await sql`INSERT INTO address_anchor (housenumber, street_norm, ward_norm, province_norm, geom, source, source_id, confidence)
      VALUES ('88/9', 'nguyen lam m4lock', 'dien hong', 'ho chi minh',
              ST_SetSRID(ST_MakePoint(106.663, 10.7647), 4326), 'user', 'edit-m4lock-test', 0.95)`;
    await sql`DROP TABLE IF EXISTS address_anchor_new`;
    await sql`CREATE TABLE address_anchor_new (LIKE address_anchor INCLUDING ALL)`;
    // Đúng câu SQL đã thêm vào anchors.mjs.
    await sql.unsafe(`INSERT INTO address_anchor_new
        (housenumber, alley_chain, house_in_alley, street_norm, ward_norm, province_norm,
         geom, source, source_id, confidence, release)
      SELECT housenumber, alley_chain, house_in_alley, street_norm, ward_norm, province_norm,
             geom, source, source_id, confidence, release
      FROM address_anchor WHERE source = 'user'`);
    const [copied] = await sql`SELECT housenumber, confidence FROM address_anchor_new
      WHERE source = 'user' AND source_id = 'edit-m4lock-test'`;
    expect(copied).toMatchObject({ housenumber: '88/9', confidence: 0.95 });
    await sql`DROP TABLE address_anchor_new`;
  });
});
