// Nhánh production-only của ingest/osm.mjs (fixture Quận 1 bỏ qua): bỏ mọi dòng PBF trong vùng hai quần đảo
// rồi nạp ảnh chụp đã lọc. Bảng tạm che bảng thật — không đụng dữ liệu các dbtest khác.
import 'dotenv/config';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { docAnhChup, napQuanDao } from '../src/lib/quan-dao.mjs';

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

describe('napQuanDao', () => {
  it('thay dòng PBF trong vùng bằng ảnh chụp, giữ dòng đất liền, tên đã qua chính sách', async () => {
    await sql.unsafe('CREATE TEMP TABLE src_osm_place_new (LIKE src_osm_place INCLUDING ALL)');
    try {
      await sql.unsafe(`INSERT INTO src_osm_place_new (osm_type, osm_id, name, names, tags, geom, release) VALUES
        ('n', 9454367472, 'Parola Lighthouse', '{"name":"Parola Lighthouse"}',
          '{"man_made":"lighthouse","name":"Parola Lighthouse"}', ST_SetSRID(ST_MakePoint(114.354, 11.452), 4326), '2026-09-26'),
        ('n', 1, 'Chợ Bến Thành', '{"name":"Chợ Bến Thành"}', '{"amenity":"marketplace","name":"Chợ Bến Thành"}',
          ST_SetSRID(ST_MakePoint(106.698, 10.772), 4326), '2026-09-26')`);
      const n = await napQuanDao(sql, 'src_osm_place_new', '2026-09-26');
      expect(n).toBe(docAnhChup().length);
      const [parola] =
        await sql`SELECT count(*)::int AS n FROM src_osm_place_new WHERE osm_id = 9454367472`;
      expect(parola?.n).toBe(0);
      const [ben] = await sql`SELECT count(*)::int AS n FROM src_osm_place_new WHERE osm_id = 1`;
      expect(ben?.n).toBe(1);
      const [song] = await sql`SELECT name, tags->>'name:vi' AS vi FROM src_osm_place_new
        WHERE osm_type = 'w' AND osm_id = 238275873`;
      expect(song).toEqual({ name: 'Đảo Song Tử Tây', vi: 'Đảo Song Tử Tây' });
      const [cjk] =
        await sql`SELECT count(*)::int AS n FROM src_osm_place_new WHERE tags::text ~ '[一-鿿]'`;
      expect(cjk?.n).toBe(0);
    } finally {
      await sql.unsafe('DROP TABLE IF EXISTS pg_temp.src_osm_place_new');
    }
  });

  it('ảnh chụp rỗng thì dừng — không lặng lẽ phát hành bản không có hai quần đảo', async () => {
    await sql.unsafe('CREATE TEMP TABLE src_osm_place_new (LIKE src_osm_place INCLUDING ALL)');
    try {
      await expect(napQuanDao(sql, 'src_osm_place_new', '2026-09-26', [])).rejects.toThrow(
        /quần đảo/,
      );
    } finally {
      await sql.unsafe('DROP TABLE IF EXISTS pg_temp.src_osm_place_new');
    }
  });
});
