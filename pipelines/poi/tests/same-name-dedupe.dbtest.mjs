// Gom bản ghi OSM cùng tên + cùng mã trong 1 km (plan 2026-09-26 Task 4): trạm thu phí vẽ mỗi làn
// một node, hồ/đảo vẽ nhiều polygon cùng tên. Dùng bảng riêng để không va với dbtest khác.
import 'dotenv/config';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { dedupeSameName } from '../src/records.mjs';

const TABLE = 'dedupe_dbtest_record';
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });

beforeAll(async () => {
  await sql.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
  await sql.unsafe(`CREATE TABLE ${TABLE} (rid serial PRIMARY KEY, source text NOT NULL,
    source_id text NOT NULL, name_norm text NOT NULL, category text NOT NULL,
    ext boolean NOT NULL DEFAULT false, geom geometry(Point, 4326) NOT NULL)`);
  // 3 node cùng trạm thu phí cách nhau ~50–400 m; 1 trạm cùng tên ở tỉnh khác (xa > 1 km);
  // 1 FSQ cùng tên sát bên; 1 quán cà phê OSM cùng tên cùng chỗ (mã khác, không gom).
  await sql.unsafe(`INSERT INTO ${TABLE} (source, source_id, name_norm, category, geom) VALUES
    ('osm', 'n1', 'tram thu phi dai yen', 'toll_booth', ST_SetSRID(ST_MakePoint(105.9000, 20.9000), 4326)),
    ('osm', 'n2', 'tram thu phi dai yen', 'toll_booth', ST_SetSRID(ST_MakePoint(105.9005, 20.9000), 4326)),
    ('osm', 'n3', 'tram thu phi dai yen', 'toll_booth', ST_SetSRID(ST_MakePoint(105.9040, 20.9000), 4326)),
    ('osm', 'n4', 'tram thu phi dai yen', 'toll_booth', ST_SetSRID(ST_MakePoint(106.5000, 20.9000), 4326)),
    ('fsq', 'f1', 'tram thu phi dai yen', 'toll_booth', ST_SetSRID(ST_MakePoint(105.9001, 20.9000), 4326)),
    ('osm', 'n5', 'tram thu phi dai yen', 'cafe', ST_SetSRID(ST_MakePoint(105.9000, 20.9000), 4326)),
    ('osm', 'n6', 'ho tay', 'lake', ST_SetSRID(ST_MakePoint(105.8200, 21.0550), 4326)),
    ('osm', 'n7', 'ho tay', 'lake', ST_SetSRID(ST_MakePoint(105.8230, 21.0560), 4326))`);
  // Bản ghi từ khoá mở rộng (ext) nhường POI OSM cũ cùng tên trong 1 km: polygon landuse=religious
  // "Chùa Phước Hải" trùng node chùa nằm trong nó. Cùng tên nhưng xa > 1 km thì giữ.
  await sql.unsafe(`INSERT INTO ${TABLE} (source, source_id, name_norm, category, ext, geom) VALUES
    ('osm', 'n9', 'chua phuoc hai', 'pagoda', false, ST_SetSRID(ST_MakePoint(107.1000, 10.4000), 4326)),
    ('osm', 'n8', 'chua phuoc hai', 'religion_community_other', true, ST_SetSRID(ST_MakePoint(107.1020, 10.4000), 4326)),
    ('osm', 'n10', 'chua phuoc hai', 'religion_community_other', true, ST_SetSRID(ST_MakePoint(107.2000, 10.4000), 4326))`);
});
afterAll(async () => {
  await sql.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
  await sql.end({ timeout: 5 });
});

describe('dedupeSameName', () => {
  it('gom cùng tên + cùng mã trong 1 km; bản ghi mở rộng nhường POI OSM cũ cùng tên', async () => {
    const removed = await dedupeSameName(sql, TABLE);
    expect(removed).toBe(4);
    const left = await sql.unsafe(`SELECT source_id FROM ${TABLE} ORDER BY source_id`);
    expect(left.map((r) => r.source_id)).toEqual(['f1', 'n1', 'n10', 'n4', 'n5', 'n6', 'n9']);
  });
});
