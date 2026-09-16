// Chạy trên DB fixture cô lập trong container pipeline (pnpm test:db). Không cần ingest: tự dựng admin_area + poi tổng hợp.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { fillPoiAdmin } from '../src/geocode/poi-admin.mjs';

const databaseUrl = databaseUrlFromEnv(process.env);
if (new URL(databaseUrl).pathname !== '/mapslibvn_task8_test') {
  throw new Error('poi-admin.dbtest chỉ được chạy trên database mapslibvn_task8_test');
}
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const IDS = [
  'PADM0000000000000000000001',
  'PADM0000000000000000000002',
  'PADM0000000000000000000003',
  'PADM0000000000000000000004',
];
const AREA_NORMS = ['tinh thu', 'phuong thu', 'phuong khac'];

beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/db-migrate.mjs'], { stdio: 'inherit' });
  await sql`DELETE FROM poi WHERE id = ANY(${IDS})`;
  await sql`DELETE FROM admin_area WHERE name_norm = ANY(${AREA_NORMS})`;
  // Tỉnh thử: ô 150–151 E, 60–61 N. Phường thử: nửa tây; Phường khác: nửa đông.
  //
  // Ô này nằm NGOÀI lãnh thổ Việt Nam là cố ý. Bản trước dùng 106–107 E / 10–11 N, trùng ranh
  // giới thật của Thành phố Hồ Chí Minh mà geocode.dbtest publish; `fillPoiAdmin` lấy vùng chứa
  // có id nhỏ nhất, nên khi file đó chạy trước thì POI ở nửa đông nhận "Thành phố Hồ Chí Minh"
  // thay vì "Tỉnh Thử". Thứ tự file do vitest tự sắp nên lỗi chỉ lộ ở một số lần chạy — 16/09/2026
  // nó làm workflow DB tests đỏ, và bộ test này chỉ dọn đúng ba admin_area của chính nó.
  await sql`INSERT INTO admin_area (level, name, name_norm, geom) VALUES
    (4, 'Tỉnh Thử', 'tinh thu', ST_Multi(ST_MakeEnvelope(150, 60, 151, 61, 4326))),
    (8, 'Phường Thử', 'phuong thu', ST_Multi(ST_MakeEnvelope(150, 60, 150.5, 61, 4326))),
    (8, 'Phường Khác', 'phuong khac', ST_Multi(ST_MakeEnvelope(150.5, 60, 151, 61, 4326)))`;
  await sql`INSERT INTO poi (id, name, name_norm, geom, ward, province, status, locked_fields, created_by, admin_ward, admin_province) VALUES
    (${IDS[0]}, 'Trong phường thử', 'trong phuong thu', ST_SetSRID(ST_MakePoint(150.25, 60.5), 4326), 'Ho Chi Minh City', NULL, 'active', '{}', 'pipeline', NULL, NULL),
    (${IDS[1]}, 'Trong phường khác', 'trong phuong khac', ST_SetSRID(ST_MakePoint(150.75, 60.5), 4326), NULL, NULL, 'active', '{}', 'user', 'Phường Cũ Sai', 'Tỉnh Cũ Sai'),
    (${IDS[2]}, 'Ngoài mọi ranh giới', 'ngoai moi ranh gioi', ST_SetSRID(ST_MakePoint(120, 20), 4326), 'Phường nguồn', 'Tỉnh nguồn', 'active', '{}', 'pipeline', 'Phường Cũ', 'Tỉnh Cũ'),
    (${IDS[3]}, 'Đã đúng sẵn', 'da dung san', ST_SetSRID(ST_MakePoint(150.25, 60.75), 4326), NULL, NULL, 'closed', '{}', 'pipeline', 'Phường Thử', 'Tỉnh Thử')`;
});

afterAll(async () => {
  await sql`DELETE FROM poi WHERE id = ANY(${IDS})`;
  await sql`DELETE FROM admin_area WHERE name_norm = ANY(${AREA_NORMS})`;
  await sql.end({ timeout: 5 });
});

describe('fillPoiAdmin — phường/tỉnh hiện hành suy từ toạ độ', () => {
  it('điền theo ST_Contains, ghi đè giá trị cũ sai, xoá khi ra ngoài ranh giới, bỏ qua dòng đã đúng', async () => {
    const stats = await fillPoiAdmin(sql);
    const rows =
      await sql`SELECT id, ward, province, admin_ward, admin_province FROM poi WHERE id = ANY(${IDS}) ORDER BY id`;
    expect(rows).toEqual([
      {
        id: IDS[0],
        ward: 'Ho Chi Minh City',
        province: null,
        admin_ward: 'Phường Thử',
        admin_province: 'Tỉnh Thử',
      },
      {
        id: IDS[1],
        ward: null,
        province: null,
        admin_ward: 'Phường Khác',
        admin_province: 'Tỉnh Thử',
      },
      {
        id: IDS[2],
        ward: 'Phường nguồn',
        province: 'Tỉnh nguồn',
        admin_ward: null,
        admin_province: null,
      },
      {
        id: IDS[3],
        ward: null,
        province: null,
        admin_ward: 'Phường Thử',
        admin_province: 'Tỉnh Thử',
      },
    ]);
    // Cột nguồn ward/province KHÔNG bị đụng (dòng 1 vẫn giữ "Ho Chi Minh City"); dòng 4 đã đúng → không ghi.
    expect(stats.updated).toBe(3);
    expect(stats.total).toBeGreaterThanOrEqual(4);
  });

  it('chạy lần hai không ghi gì (idempotent)', async () => {
    const stats = await fillPoiAdmin(sql);
    expect(stats.updated).toBe(0);
  });
});
