// Hai đặc khu Hoàng Sa (Đà Nẵng) / Trường Sa (Khánh Hòa) trong admin_area (PHONG chốt 26/09/2026). OSM
// không dựng được relation nào của hai đặc khu (Trường Sa 8/22 way trong extract, Hoàng Sa không có), nên
// admin.mjs dựng từ data/quan-dao.geojson. Chạy trong transaction rồi ROLLBACK, bảng raw/poi là bảng tạm
// che bảng thật — không đụng dữ liệu các dbtest khác dùng chung DB cô lập.
import 'dotenv/config';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { buildCurrentAdmin } from '../src/geocode/admin.mjs';
import { fillPoiAdmin } from '../src/geocode/poi-admin.mjs';

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
const ROLLBACK = new Error('rollback');

afterAll(() => sql.end({ timeout: 5 }));

/** Chạy fn trong transaction rồi luôn ROLLBACK. @param {(tx: import('postgres').TransactionSql) => Promise<void>} fn */
async function thuRoiBo(fn) {
  await sql
    .begin(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    })
    .catch((error) => {
      if (error !== ROLLBACK) throw error;
    });
}

/** @param {number} w @param {number} s @param {number} e @param {number} n */
const khung = (w, s, e, n) => `ST_Multi(ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326))`;

describe('buildCurrentAdmin — hai đặc khu', () => {
  it('dựng 2 hàng L8 nối sau, cha là Khánh Hòa/Đà Nẵng; bỏ mọi relation raw trong vùng quần đảo', async () => {
    await thuRoiBo(async (tx) => {
      await tx.unsafe(`CREATE TEMP TABLE osm_admin_raw (osm_relation_id bigint PRIMARY KEY,
        level smallint NOT NULL, name text NOT NULL, name_norm text NOT NULL,
        tags jsonb NOT NULL DEFAULT '{}', geom geometry(MultiPolygon, 4326) NOT NULL)`);
      // Khánh Hòa như khi extract dựng được TRỌN relation r1887959 (gồm cả Trường Sa) — ca xấu nhất:
      // relation TQ "Quận Nam Sa" và "Đặc khu Trường Sa" dở dang của OSM đều nằm trong tỉnh.
      await tx.unsafe(`INSERT INTO osm_admin_raw (osm_relation_id, level, name, name_norm, geom) VALUES
        (1887959, 4, 'Tỉnh Khánh Hòa', 'khanh hoa', ${khung(108.5, 6.5, 115, 13)}),
        (1891418, 4, 'Thành phố Đà Nẵng', 'da nang', ${khung(107.2, 14.9, 109.0, 16.3)}),
        (100, 6, 'Phường Nha Trang', 'phuong nha trang', ${khung(109.1, 12.2, 109.25, 12.3)}),
        (101, 6, 'Phường Hải Châu', 'phuong hai chau', ${khung(108.2, 16.0, 108.25, 16.1)}),
        (3479413, 6, 'Đặc khu Trường Sa', 'dac khu truong sa', ${khung(114.2, 11.3, 114.5, 11.5)}),
        (6753263, 6, 'Quận Nam Sa', 'quan nam sa', ${khung(112.8, 9.4, 113.0, 9.7)})`);
      await buildCurrentAdmin(tx);
      const rows =
        await tx`SELECT a.id, a.level, a.name, a.name_norm, a.osm_relation_id, p.name AS cha
        FROM admin_area_new a LEFT JOIN admin_area_new p ON p.id = a.parent_id ORDER BY a.id`;
      const seed = rows.filter((r) => Number(r.osm_relation_id) < -8000);
      expect(
        seed.map((r) => [r.level, r.name, r.name_norm, Number(r.osm_relation_id), r.cha]),
      ).toEqual([
        [8, 'Đặc khu Hoàng Sa', 'dac khu hoang sa', -8001, 'Thành phố Đà Nẵng'],
        [8, 'Đặc khu Trường Sa', 'dac khu truong sa', -8002, 'Tỉnh Khánh Hòa'],
      ]);
      // Nối SAU mọi hàng khác: không xê dịch id của các L8 đang có.
      const maxKhac = Math.max(...rows.filter((r) => !seed.includes(r)).map((r) => Number(r.id)));
      expect(Math.min(...seed.map((r) => Number(r.id)))).toBeGreaterThan(maxKhac);
      const ten = rows.map((r) => r.name);
      expect(ten).toContain('Phường Nha Trang');
      expect(ten).not.toContain('Quận Nam Sa');
      // Không có hai "Đặc khu Trường Sa": relation dở dang của OSM bị bỏ, hàng dựng từ file thắng.
      expect(ten.filter((n) => n === 'Đặc khu Trường Sa')).toHaveLength(1);
    });
  });
});

describe('fillPoiAdmin — tỉnh theo cha của đặc khu khi không L4 nào chứa POI', () => {
  it('POI trên Song Tử Tây: ward Đặc khu Trường Sa, province Khánh Hòa', async () => {
    await thuRoiBo(async (tx) => {
      await tx.unsafe(`CREATE TEMP TABLE admin_area (id bigint, level smallint, name text,
        parent_id bigint, geom geometry)`);
      await tx.unsafe(
        `CREATE TEMP TABLE poi (id text, geom geometry, admin_ward text, admin_province text)`,
      );
      await tx.unsafe(`INSERT INTO admin_area VALUES
        (1, 4, 'Khánh Hòa', NULL, ${khung(108.5, 11.5, 109.5, 13)}),
        (2, 8, 'Đặc khu Trường Sa', 1, ${khung(111.4, 6.5, 116.3, 12.1)}),
        (3, 8, 'Phường Nha Trang', 1, ${khung(109.1, 12.2, 109.25, 12.3)})`);
      await tx.unsafe(`INSERT INTO poi VALUES
        ('dao', ST_SetSRID(ST_MakePoint(114.331, 11.429), 4326), NULL, NULL),
        ('bo', ST_SetSRID(ST_MakePoint(109.19, 12.25), 4326), NULL, NULL)`);
      await fillPoiAdmin(tx);
      const rows = await tx`SELECT id, admin_ward, admin_province FROM poi ORDER BY id`;
      expect(rows.map((r) => [r.id, r.admin_ward, r.admin_province])).toEqual([
        ['bo', 'Phường Nha Trang', 'Khánh Hòa'],
        ['dao', 'Đặc khu Trường Sa', 'Khánh Hòa'],
      ]);
    });
  });
});
