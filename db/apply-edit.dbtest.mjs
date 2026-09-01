// Chạy: pnpm test:db (cần Postgres dev: pnpm db:up && pnpm db:migrate).
// Kiểm 3 hàm SECURITY DEFINER của 0006: stage_poi_create, apply_poi_edit, reject_poi_edit.
import 'dotenv/config';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../scripts/lib/migrations.mjs';

const url = databaseUrlFromEnv(process.env);
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
  throw new Error(`dbtest chỉ chạy trên DB local, không phải ${host}`);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const TENANT = '00000000-0000-4000-8000-000000000411';
const POI_UPD = '01M4TEST000000000000UPD001';
const POI_NEW1 = '01M4TEST000000000000NEW001';
const POI_NEW2 = '01M4TEST000000000000NEW002';

const cleanup = async () => {
  await sql`DELETE FROM address_anchor WHERE source = 'user'
    AND source_id IN (SELECT 'edit-' || id FROM poi_edit WHERE note LIKE 'm4test%')`;
  await sql`DELETE FROM poi_edit WHERE note LIKE 'm4test%'`;
  await sql`DELETE FROM poi WHERE id LIKE '01M4TEST%'`;
  await sql`DELETE FROM category WHERE code = 'm4test_cafe'`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT}`;
};

/** @param {Record<string, unknown>} row */
const insertEdit = async (row) => {
  const [r] = await sql`INSERT INTO poi_edit ${sql({
    tenant_id: TENANT,
    end_user_hash: 'm4test-user-1',
    status: 'pending',
    note: 'm4test',
    ...row,
  })} RETURNING id::int AS id`;
  return Number(/** @type {any} */ (r).id);
};

beforeAll(async () => {
  await cleanup();
  // poi_edit.tenant_id có FK tới tenant (0005_tenant.sql) — phải có tenant trước khi ghi edit.
  await sql`INSERT INTO tenant (id, name, plan) VALUES (${TENANT}, 'M4 dbtest', 'free')
    ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO category (code, group_code, name_vi, name_en, icon, rank)
    VALUES ('m4test_cafe', 'food_drink', 'Cà phê test', 'Cafe test', 'cafe', 3)
    ON CONFLICT (code) DO NOTHING`;
  await sql`INSERT INTO poi (id, name, name_norm, category, geom, quality_score, popularity,
      status, locked_fields, created_by)
    VALUES (${POI_UPD}, 'Quán Cà Phê Gốc', 'quan ca phe goc', 'm4test_cafe',
      ST_SetSRID(ST_MakePoint(106.700, 10.776), 4326), 70, 0.5, 'active', '{}', 'pipeline')`;
});
afterAll(async () => {
  await cleanup();
  await sql.end({ timeout: 5 });
});

describe('0006 — apply_poi_edit', () => {
  it('update hours: đổi poi.hours, khoá hours, đánh dấu edit + phiếu trùng', async () => {
    const changes = { hours: { osm: 'Mo-Su 07:00-22:00' } };
    const id = await insertEdit({
      poi_id: POI_UPD,
      kind: 'update',
      changes: sql.json(changes),
    });
    const dupId = await insertEdit({
      poi_id: POI_UPD,
      kind: 'update',
      changes: sql.json(changes),
      end_user_hash: 'm4test-user-2',
    });
    const [applied] =
      await sql`SELECT apply_poi_edit(${id}::bigint, 'tester', 'auto_approved') AS poi_id`;
    expect(/** @type {any} */ (applied).poi_id).toBe(POI_UPD);

    const [poi] = await sql`SELECT hours, locked_fields, status FROM poi WHERE id = ${POI_UPD}`;
    expect(/** @type {any} */ (poi).hours).toEqual({ osm: 'Mo-Su 07:00-22:00' });
    expect(/** @type {any} */ (poi).locked_fields).toContain('hours');
    const [edit] = await sql`SELECT status, reviewer FROM poi_edit WHERE id = ${id}`;
    expect(/** @type {any} */ (edit).status).toBe('auto_approved');
    expect(/** @type {any} */ (edit).reviewer).toBe('tester');
    const [dup] = await sql`SELECT status, reviewer FROM poi_edit WHERE id = ${dupId}`;
    expect(/** @type {any} */ (dup).status).toBe('auto_approved');
    expect(/** @type {any} */ (dup).reviewer).toBe('auto:consensus');
  });

  it('edit không còn pending → trả NULL, không đổi gì', async () => {
    const [row] =
      await sql`SELECT apply_poi_edit(${999_999_999}::bigint, 'tester', 'approved') AS poi_id`;
    expect(/** @type {any} */ (row).poi_id).toBeNull();
  });

  it('create: stage tạo POI pending, apply chuyển active + khoá trường + tạo anchor', async () => {
    const changes = {
      name: 'Cà Phê M4 Test',
      name_norm: 'ca phe m4 test',
      category: 'm4test_cafe',
      lat: 10.777,
      lng: 106.701,
      housenumber: '15',
      street: 'Thi Sách',
      street_norm: 'thi sach',
      ward: 'Bến Nghé',
      ward_norm: 'ben nghe',
      province: 'Thành phố Hồ Chí Minh',
      province_norm: 'ho chi minh',
    };
    const id = await insertEdit({
      kind: 'create',
      changes: sql.json(changes),
      new_poi_id: POI_NEW1,
    });

    const [staged] = await sql`SELECT stage_poi_create(${id}::bigint) AS poi_id`;
    expect(/** @type {any} */ (staged).poi_id).toBe(POI_NEW1);
    const [pending] = await sql`SELECT status, created_by, name FROM poi WHERE id = ${POI_NEW1}`;
    expect(/** @type {any} */ (pending).status).toBe('pending');
    expect(/** @type {any} */ (pending).created_by).toBe('user');
    // stage lần 2 không nhân đôi
    const [again] = await sql`SELECT stage_poi_create(${id}::bigint) AS poi_id`;
    expect(/** @type {any} */ (again).poi_id).toBeNull();

    const [applied] =
      await sql`SELECT apply_poi_edit(${id}::bigint, 'phong@test', 'approved') AS poi_id`;
    expect(/** @type {any} */ (applied).poi_id).toBe(POI_NEW1);
    const [poi] = await sql`SELECT status, locked_fields FROM poi WHERE id = ${POI_NEW1}`;
    expect(/** @type {any} */ (poi).status).toBe('active');
    expect(/** @type {any} */ (poi).locked_fields).toEqual(
      expect.arrayContaining(['name', 'geom', 'housenumber', 'street']),
    );
    const [anchor] = await sql`SELECT housenumber, street_norm, confidence FROM address_anchor
      WHERE source = 'user' AND source_id = ${`edit-${id}`}`;
    expect(anchor).toMatchObject({ housenumber: '15', street_norm: 'thi sach', confidence: 0.95 });
  });

  it('close rồi reopen: đổi status và khoá status', async () => {
    const closeId = await insertEdit({ poi_id: POI_UPD, kind: 'close', changes: sql.json({}) });
    await sql`SELECT apply_poi_edit(${closeId}::bigint, 'tester', 'approved')`;
    let [poi] = await sql`SELECT status, locked_fields FROM poi WHERE id = ${POI_UPD}`;
    expect(/** @type {any} */ (poi).status).toBe('closed');
    expect(/** @type {any} */ (poi).locked_fields).toContain('status');
    const reopenId = await insertEdit({ poi_id: POI_UPD, kind: 'reopen', changes: sql.json({}) });
    await sql`SELECT apply_poi_edit(${reopenId}::bigint, 'tester', 'approved')`;
    [poi] = await sql`SELECT status FROM poi WHERE id = ${POI_UPD}`;
    expect(/** @type {any} */ (poi).status).toBe('active');
  });

  it('reject create: poi pending → rejected, edit → rejected', async () => {
    const id = await insertEdit({
      kind: 'create',
      new_poi_id: POI_NEW2,
      changes: sql.json({
        name: 'POI bị từ chối',
        name_norm: 'poi bi tu choi',
        lat: 10.78,
        lng: 106.7,
      }),
    });
    await sql`SELECT stage_poi_create(${id}::bigint)`;
    const [ok] = await sql`SELECT reject_poi_edit(${id}::bigint, 'phong@test') AS ok`;
    expect(/** @type {any} */ (ok).ok).toBe(true);
    const [poi] = await sql`SELECT status FROM poi WHERE id = ${POI_NEW2}`;
    expect(/** @type {any} */ (poi).status).toBe('rejected');
    const [edit] = await sql`SELECT status FROM poi_edit WHERE id = ${id}`;
    expect(/** @type {any} */ (edit).status).toBe('rejected');
    const [again] = await sql`SELECT reject_poi_edit(${id}::bigint, 'phong@test') AS ok`;
    expect(/** @type {any} */ (again).ok).toBe(false);
  });

  it('quyền: user api EXECUTE được 3 hàm nhưng không UPDATE poi trực tiếp', async () => {
    const grants = await sql`SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('stage_poi_create', 'apply_poi_edit', 'reject_poi_edit')
        AND has_function_privilege('api', p.oid, 'EXECUTE')`;
    expect(grants.map((g) => g.proname).sort()).toEqual([
      'apply_poi_edit',
      'reject_poi_edit',
      'stage_poi_create',
    ]);
    const [priv] = await sql`SELECT has_table_privilege('api', 'poi', 'UPDATE') AS can_update`;
    expect(/** @type {any} */ (priv).can_update).toBe(false);
    // Hàm SECURITY DEFINER phải thuộc pipeline, không phải superuser migration.
    const owners = await sql`SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('stage_poi_create', 'apply_poi_edit', 'reject_poi_edit')`;
    expect(owners).toHaveLength(3);
    for (const fn of owners) {
      expect(/** @type {any} */ (fn).owner).toBe('pipeline');
      expect(/** @type {any} */ (fn).prosecdef).toBe(true);
    }
    // PUBLIC không được EXECUTE (SECURITY DEFINER mặc định mở cho PUBLIC).
    const [pub] =
      await sql`SELECT has_function_privilege('public', 'apply_poi_edit(bigint, text, text)', 'EXECUTE') AS can`;
    expect(/** @type {any} */ (pub).can).toBe(false);
  });
});
