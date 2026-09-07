import 'dotenv/config';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { buildOldAdmin } from '../src/geocode/admin-overlay.mjs';
import { bootstrapMissingProvince } from '../src/geocode/raw-tables.mjs';
import { createNewTable, publishNew, withAdvisoryLock } from '../src/pg.mjs';

const databaseUrl = databaseUrlFromEnv(process.env);
if (new URL(databaseUrl).pathname !== '/mapslibvn_task8_test') {
  throw new Error('admin-old.dbtest chỉ được chạy trên database mapslibvn_task8_test');
}
const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} });
const currentIds = Array.from({ length: 40 }, (_, index) => 8_800_000 + index);
const oldIds = Array.from({ length: 20 }, (_, index) => 9_800_000 + index);

beforeAll(async () => {
  await import('../../../scripts/db-migrate.mjs');
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS osm_admin_raw(
    osm_relation_id bigint PRIMARY KEY,level smallint NOT NULL,name text NOT NULL,
    name_norm text NOT NULL,tags jsonb NOT NULL DEFAULT '{}',
    geom geometry(MultiPolygon,4326) NOT NULL
  )`);
  await sql`INSERT INTO admin_area(id,level,name,name_norm,osm_relation_id,geom) VALUES
    (${currentIds[0]},4,'Tỉnh Alpha','alpha',${currentIds[0]},ST_Multi(ST_MakeEnvelope(100,10,110,12,4326))),
    (${currentIds[1]},4,'Tỉnh Beta','beta',${currentIds[1]},ST_Multi(ST_MakeEnvelope(111,10,121,12,4326)))`;
  await sql`INSERT INTO admin_area(id,level,name,name_norm,parent_id,osm_relation_id,geom) VALUES
    (${currentIds[2]},8,'Phường Một','mot',${currentIds[0]},${currentIds[2]},ST_Multi(ST_MakeEnvelope(100,10,101,10.1,4326))),
    (${currentIds[3]},8,'Phường Trái','trai',${currentIds[0]},${currentIds[3]},ST_Multi(ST_MakeEnvelope(100,10.2,100.6,10.3,4326))),
    (${currentIds[4]},8,'Phường Phải','phai',${currentIds[0]},${currentIds[4]},ST_Multi(ST_MakeEnvelope(100.6,10.2,101,10.3,4326))),
    (${currentIds[5]},8,'Phường Chính','chinh',${currentIds[0]},${currentIds[5]},ST_Multi(ST_MakeEnvelope(100,10.4,100.96,10.5,4326))),
    (${currentIds[6]},8,'Phường Mảnh','manh',${currentIds[0]},${currentIds[6]},ST_Multi(ST_MakeEnvelope(100.96,10.4,101,10.5,4326))),
    (${currentIds[7]},8,'Phường Thiếu','thieu',${currentIds[0]},${currentIds[7]},ST_Multi(ST_MakeEnvelope(100,10.6,100.6,10.7,4326))),
    (${currentIds[8]},8,'Phường Chồng A','chong a',${currentIds[0]},${currentIds[8]},ST_Multi(ST_MakeEnvelope(100,10.8,101,10.9,4326))),
    (${currentIds[9]},8,'Phường Chồng B','chong b',${currentIds[0]},${currentIds[9]},ST_Multi(ST_MakeEnvelope(100,10.8,101,10.9,4326))),
    (${currentIds[10]},8,'Phường Trùng Alpha','trung alpha',${currentIds[0]},${currentIds[10]},ST_Multi(ST_MakeEnvelope(102,10,103,10.1,4326))),
    (${currentIds[11]},8,'Phường Trùng Beta','trung beta',${currentIds[1]},${currentIds[11]},ST_Multi(ST_MakeEnvelope(112,10,113,10.1,4326))),
    (${currentIds[37]},8,'Xã Đích Một','dich mot',${currentIds[0]},${currentIds[37]},ST_Multi(ST_MakeEnvelope(104,10,104.5,10.1,4326))),
    (${currentIds[38]},8,'Xã Đích Hai','dich hai',${currentIds[0]},${currentIds[38]},ST_Multi(ST_MakeEnvelope(104.5,10,105,10.1,4326))),
    (${currentIds[39]},8,'Xã Đích Gộp','dich gop',${currentIds[0]},${currentIds[39]},ST_Multi(ST_MakeEnvelope(106,10,107,10.1,4326)))`;
  await sql`INSERT INTO osm_admin_raw(osm_relation_id,level,name,name_norm,tags,geom) VALUES
    (${currentIds[10]},8,'Phường Trùng Alpha','trung alpha','{"old_name":"Phường Chung"}',ST_Multi(ST_MakeEnvelope(102,10,103,10.1,4326))),
    (${currentIds[11]},8,'Phường Trùng Beta','trung beta','{"old_name":"Phường Chung"}',ST_Multi(ST_MakeEnvelope(112,10,113,10.1,4326)))`;
  const districtChildren = Array.from({ length: 25 }, (_, index) => {
    const left = 100 + index * 0.04;
    const right = left + 0.04;
    return [
      currentIds[12 + index],
      8,
      `Xã Con ${index + 1}`,
      `con ${index + 1}`,
      currentIds[0],
      currentIds[12 + index],
      `SRID=4326;MULTIPOLYGON(((${left} 11.2,${right} 11.2,${right} 11.3,${left} 11.3,${left} 11.2)))`,
    ];
  });
  for (const row of districtChildren)
    await sql`INSERT INTO admin_area(id,level,name,name_norm,parent_id,osm_relation_id,geom)
      VALUES (${row[0]},${row[1]},${row[2]},${row[3]},${row[4]},${row[5]},ST_GeomFromEWKT(${row[6]}))`;
  await sql.unsafe(`DROP TABLE IF EXISTS osm_admin_old_raw;
    CREATE TABLE osm_admin_old_raw(
      osm_relation_id bigint PRIMARY KEY,level smallint NOT NULL,name text NOT NULL,
      name_norm text NOT NULL,tags jsonb NOT NULL DEFAULT '{}',snapshot date NOT NULL,
      geom geometry(MultiPolygon,4326) NOT NULL
    )`);
  await sql`INSERT INTO osm_admin_old_raw(osm_relation_id,level,name,name_norm,snapshot,geom) VALUES
    (${oldIds[0]},4,'Tỉnh Alpha','alpha','2025-01-02',ST_Multi(ST_MakeEnvelope(100,10,110,12,4326))),
    (${oldIds[1]},4,'Tỉnh Beta','beta','2025-01-02',ST_Multi(ST_MakeEnvelope(111,10,121,12,4326))),
    (${oldIds[2]},8,'Phường Một Cũ','mot cu','2025-01-02',ST_Multi(ST_MakeEnvelope(100,10,101,10.1,4326))),
    (${oldIds[3]},8,'Phường Chia','chia','2025-01-02',ST_Multi(ST_MakeEnvelope(100,10.2,101,10.3,4326))),
    (${oldIds[4]},8,'Phường Có Mảnh','co manh','2025-01-02',ST_Multi(ST_MakeEnvelope(100,10.4,101,10.5,4326))),
    (${oldIds[5]},8,'Phường Thiếu Phủ','thieu phu','2025-01-02',ST_Multi(ST_MakeEnvelope(100,10.6,101,10.7,4326))),
    (${oldIds[6]},8,'Phường Chồng','chong','2025-01-02',ST_Multi(ST_MakeEnvelope(100,10.8,101,10.9,4326))),
    (${oldIds[7]},8,'Phường Trùng','trung','2025-01-02',ST_Multi(ST_MakeEnvelope(102,10,103,10.1,4326))),
    (${oldIds[8]},8,'Phường Trùng','trung','2025-01-02',ST_Multi(ST_MakeEnvelope(112,10,113,10.1,4326))),
    (${oldIds[9]},6,'Huyện Rộng','rong','2025-01-02',ST_Multi(ST_MakeEnvelope(100,11.2,101,11.3,4326))),
    (${oldIds[10]},8,'Xã Song Thành','song thanh','2025-01-02',ST_Multi(ST_MakeEnvelope(104,10,104.5,10.1,4326))),
    (${oldIds[11]},8,'Xã Song Thạnh','song thanh','2025-01-02',ST_Multi(ST_MakeEnvelope(104.5,10,105,10.1,4326))),
    (${oldIds[12]},8,'Xã Gộp Thành','gop thanh','2025-01-02',ST_Multi(ST_MakeEnvelope(106,10,106.5,10.1,4326))),
    (${oldIds[13]},8,'Xã Gộp Thạnh','gop thanh','2025-01-02',ST_Multi(ST_MakeEnvelope(106.5,10,107,10.1,4326)))`;
});

afterAll(async () => {
  await sql.unsafe(`DROP TABLE IF EXISTS admin_area_old_new,admin_alias_new,admin_overlap_work;
    DELETE FROM admin_area WHERE id BETWEEN 8800000 AND 8800039;
    DELETE FROM osm_admin_raw WHERE osm_relation_id BETWEEN 8800000 AND 8800039;
    DROP TABLE IF EXISTS osm_admin_old_raw`);
  await sql.end();
});

describe('overlay ranh giới hành chính cũ', () => {
  it('giữ coverage thô, lọc sliver, phát hiện gap/overlap và không rơi huyện nhiều con', async () => {
    const report = await buildOldAdmin(sql, { currentTable: 'admin_area', fixture: true });
    const byId = new Map(report.coverage.map((row) => [Number(row.id), row]));
    expect(byId.get(oldIds[2]).rawCoverage).toBeCloseTo(1, 5);
    expect(byId.get(oldIds[2]).targets).toBe(1);
    expect(byId.get(oldIds[3]).rawCoverage).toBeCloseTo(1, 4);
    expect(byId.get(oldIds[3]).rawMax).toBeCloseTo(0.6, 4);
    const splitAliases = await sql`SELECT share FROM admin_alias_new
      WHERE old_area_id=${oldIds[3]} AND alias_norm='phuong chia alpha' ORDER BY share DESC`;
    expect(splitAliases.map((row) => row.share)).toEqual([
      expect.closeTo(0.6, 4),
      expect.closeTo(0.4, 4),
    ]);
    expect(splitAliases.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 5);
    expect(byId.get(oldIds[4]).discardedShare).toBeCloseTo(0.04, 4);
    expect(byId.get(oldIds[4]).keptCoverage).toBeCloseTo(0.96, 4);
    expect(byId.get(oldIds[5]).rawCoverage).toBeCloseTo(0.6, 4);
    expect(byId.get(oldIds[6]).rawCoverage).toBeCloseTo(2, 5);
    expect(report.overlapErrors.map((row) => Number(row.id))).toContain(oldIds[6]);
    expect(byId.get(oldIds[9]).targets).toBe(25);
    const [{ districtEdges }] = await sql`SELECT count(*)::int AS "districtEdges"
      FROM admin_alias_new WHERE old_area_id=${oldIds[9]} AND alias_norm='huyen rong alpha'`;
    expect(districtEdges).toBe(25);
    const [{ shortDuplicates }] = await sql`SELECT count(*)::int AS "shortDuplicates"
      FROM admin_alias_new WHERE alias_norm IN ('phuong trung','trung')`;
    expect(shortDuplicates).toBe(0);
    const [{ qualified }] = await sql`SELECT count(*)::int AS qualified FROM admin_alias_new
      WHERE alias_norm IN ('phuong trung alpha','phuong trung beta')`;
    expect(qualified).toBe(2);
    expect(report.ambiguousKeys).toContain('8:chung');
    expect(report.seedMisses.length).toBeGreaterThan(0);
    const [{ ambiguousTags }] = await sql`SELECT count(*)::int AS "ambiguousTags"
      FROM admin_alias_new WHERE source='osm_tag' AND alias_norm='chung'`;
    expect(ambiguousTags).toBe(0);
    const [{ overlaySurvivedSeedMiss }] =
      await sql`SELECT count(*)::int AS "overlaySurvivedSeedMiss"
      FROM admin_alias_new WHERE source='overlay' AND old_area_id=${oldIds[2]}`;
    expect(overlaySurvivedSeedMiss).toBeGreaterThan(0);
    expect(report.osmTagSource.available).toBe(true);
  });

  // Quyết định PHONG 07/09/2026 (A): cổng chấp nhận gap ven biển khi phần KHÔNG được phủ không có
  // dấu hiệu là đất. Overlay phải cung cấp số đo đó cho evaluator — mật độ POI trong phần không phủ
  // và trong phần được phủ của chính vùng đó. `oldIds[5]` (Phường Thiếu Phủ) có rawCoverage 0,6.
  it('dòng coverage thiếu phủ mang theo mật độ POI của phần trống và phần được phủ', async () => {
    // Phần được phủ là env(100, 10.6, 100.6, 10.7); phần trống là env(100.6, 10.6, 101, 10.7).
    await sql`INSERT INTO poi(id,name,name_norm,geom,status,created_by) VALUES
      ('t8-poi-1','Quán Phủ 1','quan phu 1',ST_SetSRID(ST_MakePoint(100.2,10.65),4326),'active','pipeline'),
      ('t8-poi-2','Quán Phủ 2','quan phu 2',ST_SetSRID(ST_MakePoint(100.3,10.65),4326),'active','pipeline'),
      ('t8-poi-3','Quán Phủ 3','quan phu 3',ST_SetSRID(ST_MakePoint(100.4,10.65),4326),'active','pipeline')`;
    try {
      const report = await buildOldAdmin(sql, { currentTable: 'admin_area', fixture: true });
      const row = report.coverage.find((r) => Number(r.id) === oldIds[5]);
      expect(row.rawCoverage).toBeCloseTo(0.6, 4);
      expect(row.uncoveredKm2).toBeGreaterThan(0);
      // Không có POI nào trong phần trống, ba POI trong phần được phủ.
      expect(row.uncoveredPoiDensity).toBe(0);
      expect(row.coveredPoiDensity).toBeGreaterThan(0);
      // Vùng phủ đủ thì không cần đo — không tốn truy vấn cho 4.900 vùng.
      expect(
        report.coverage.find((r) => Number(r.id) === oldIds[2]).uncoveredPoiDensity,
      ).toBeUndefined();
    } finally {
      await sql`DELETE FROM poi WHERE id LIKE 't8-poi-%'`;
    }
  });

  // Nếu bảng poi rỗng thì mật độ 0 là vô nghĩa và sẽ khiến evaluator chấp nhận MỌI gap. Thà không
  // đo còn hơn đo sai: bỏ trống số liệu để cổng giữ nguyên failure.
  it('poi rỗng thì không gắn số đo mật độ nào', async () => {
    const [{ n }] = await sql`SELECT count(*)::int n FROM poi`;
    expect(n).toBe(0);
    const report = await buildOldAdmin(sql, { currentTable: 'admin_area', fixture: true });
    const row = report.coverage.find((r) => Number(r.id) === oldIds[5]);
    expect(row.rawCoverage).toBeCloseTo(0.6, 4);
    expect(row.uncoveredPoiDensity).toBeUndefined();
    expect(row.coveredPoiDensity).toBeUndefined();
  });

  // Production 07/09 mất alias của 8 vùng cũ đất liền: bốn cặp chỉ khác nhau ở dấu nên `name_norm`
  // trùng khít **kể cả ở khoá đầy đủ nhất** (Đông Thạnh/Đông Thành, Sa Pa/Sa Pả, Phú Thành/Phú
  // Thạnh, Lộc Thạnh/Lộc Thành). Bộ lọc `keyOwners.size === 1` bỏ luôn mọi khoá của cả hai chủ nên
  // không vùng nào còn alias — trái quyết định #3 của plan ("không gộp mất provenance old_area_id").
  // Khoá NGẮN vẫn phải bị bỏ khi nhập nhằng; chỉ khoá đầy đủ nhất được giữ, vì bỏ nó thì vùng cũ
  // không còn đường nào tra ra được.
  it('admin_area_old_new.name_key và admin_alias_new.alias_key khớp searchKeys của core', async () => {
    await buildOldAdmin(sql, { currentTable: 'admin_area', fixture: true });
    const { searchKeys } = await import('@mapslibvn/core');
    const olds = await sql`SELECT name_norm, name_key FROM admin_area_old_new`;
    expect(olds.length).toBeGreaterThan(0);
    for (const r of olds)
      expect(r.name_key, r.name_norm).toBe(searchKeys(r.name_norm, null).nameKey);
    const aliases = await sql`SELECT alias_norm, alias_key FROM admin_alias_new`;
    expect(aliases.length).toBeGreaterThan(0);
    for (const r of aliases)
      expect(r.alias_key, r.alias_norm).toBe(searchKeys(r.alias_norm, null).nameKey);
    // Alias seed được chèn SAU vòng dựng nên phải kiểm riêng, không để lọt dòng NULL.
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM admin_alias_new
      WHERE source = 'seed' AND alias_key IS NULL`;
    expect(n).toBe(0);
  });

  it('khoá đầy đủ nhất trùng khít ở hai vùng cũ: giữ cả hai khi khác đích, bỏ khoá ngắn', async () => {
    await buildOldAdmin(sql, { currentTable: 'admin_area', fixture: true });

    const distinctTargets = await sql`SELECT old_area_id::text old_id, admin_area_id::text new_id
      FROM admin_alias_new WHERE alias_norm='xa song thanh alpha' ORDER BY old_area_id`;
    expect(distinctTargets.map((row) => [row.old_id, row.new_id])).toEqual([
      [String(oldIds[10]), String(currentIds[37])],
      [String(oldIds[11]), String(currentIds[38])],
    ]);

    const [{ shortAmbiguous }] = await sql`SELECT count(*)::int AS "shortAmbiguous"
      FROM admin_alias_new WHERE alias_norm IN ('song thanh','xa song thanh')`;
    expect(shortAmbiguous).toBe(0);

    // Cùng đích thì PK ba cột (alias_norm, level, admin_area_id) chỉ cho đúng một dòng; giữ một
    // dòng xác định được (old_area_id nhỏ nhất) thay vì bỏ cả hai.
    const sameTarget = await sql`SELECT old_area_id::text old_id, admin_area_id::text new_id
      FROM admin_alias_new WHERE alias_norm='xa gop thanh alpha'`;
    expect(sameTarget.map((row) => [row.old_id, row.new_id])).toEqual([
      [String(oldIds[12]), String(currentIds[39])],
    ]);
  });

  // Giữ khoá đầy đủ nhập nhằng là đánh đổi: tra một tên ra nhiều vùng, và khi trùng đích thì PK
  // ăn mất provenance của một vùng cũ. QA phải thấy được cả hai, không để nó xảy ra lặng lẽ.
  it('ghi khoá đầy đủ nhập nhằng vào report kèm số dòng thực sự giữ được', async () => {
    const report = await buildOldAdmin(sql, { currentTable: 'admin_area', fixture: true });
    const byKey = new Map(report.ambiguousPrimaryKept.map((row) => [row.key, row]));

    // Khác đích: cả hai vùng cũ giữ được provenance riêng.
    expect(byKey.get('8:xa song thanh alpha')).toEqual({
      key: '8:xa song thanh alpha',
      owners: [String(oldIds[10]), String(oldIds[11])],
      rowsKept: 2,
    });
    // Trùng đích: PK ba cột chỉ cho một dòng, tức mất provenance của vùng cũ còn lại.
    expect(byKey.get('8:xa gop thanh alpha')).toEqual({
      key: '8:xa gop thanh alpha',
      owners: [String(oldIds[12]), String(oldIds[13])],
      rowsKept: 1,
    });
  });

  // Cổng 6.5 phát hiện: DB production không có bảng raw nào (`osm_admin_raw` chỉ tồn tại sau khi
  // nhánh ingest OSM hiện hành chạy), nên `admin-old.mjs` chạy độc lập chết với 42P01. Thiếu raw
  // phải bỏ nguồn osm_tag và ghi rõ vào report — không nổ, cũng không bỏ lặng lẽ.
  it('thiếu osm_admin_raw thì bỏ nguồn osm_tag và ghi rõ vào report', async () => {
    await sql.unsafe('ALTER TABLE osm_admin_raw RENAME TO osm_admin_raw_hidden');
    try {
      const report = await buildOldAdmin(sql, { currentTable: 'admin_area', fixture: true });
      expect(report.osmTagSource.available).toBe(false);
      expect(report.osmTagSource.reason).toMatch(/osm_admin_raw/);
      const [{ tagAliases }] = await sql`SELECT count(*)::int AS "tagAliases"
        FROM admin_alias_new WHERE source='osm_tag'`;
      expect(tagAliases).toBe(0);
      // Nguồn overlay vẫn phải chạy đủ: thiếu osm_tag không được làm rỗng alias.
      const [{ overlayAliases }] = await sql`SELECT count(*)::int AS "overlayAliases"
        FROM admin_alias_new WHERE source='overlay'`;
      expect(overlayAliases).toBeGreaterThan(0);
    } finally {
      await sql.unsafe('ALTER TABLE osm_admin_raw_hidden RENAME TO osm_admin_raw');
    }
  });

  // Việc 2 (07/09/2026): OSM không có relation cấp tỉnh cho Khánh Hòa, cả ở snapshot 01/2025 lẫn
  // OSM hiện tại, nên 8 quận/huyện cũ của tỉnh này (Nha Trang, Cam Ranh, Cam Lâm, Diên Khánh,
  // Khánh Sơn, Khánh Vĩnh, Vạn Ninh, Ninh Hòa) bị loại vì không nằm trong L4 nào. Dựng L4 bằng hợp
  // các đơn vị con mồ côi **nằm trong VN** — chỉ làm khi đúng một tỉnh trong provinces.json thiếu,
  // để không gộp nhầm relation nước ngoài hay hai tỉnh vào một.
  describe('bootstrap tỉnh thiếu relation cấp tỉnh', () => {
    const RAW = 'admin_bootstrap_raw';
    // Bảng ranh giới RIÊNG: chèn vào `vn_boundary` thật sẽ làm `ensureVnBoundary()` bỏ nạp ranh
    // giới VN (nó return sớm khi bảng đã có dòng), rồi `deleteOutsideVn()` xoá sạch POI Quận 1 của
    // các test khác dùng chung DB cô lập — đúng thứ đã làm DB tests đỏ ở 93fc7e2.
    const BOUNDARY = 'admin_bootstrap_boundary';
    const child = (id, name, left) =>
      sql.unsafe(`INSERT INTO ${RAW}(osm_relation_id,level,name,name_norm,geom) VALUES
        (${id},6,'${name}','${name.toLowerCase()}',
         ST_Multi(ST_MakeEnvelope(${left},20,${left + 0.2},20.2,4326)))`);

    beforeAll(async () => {
      await sql.unsafe(`DROP TABLE IF EXISTS ${RAW};
        CREATE TABLE ${RAW}(osm_relation_id bigint PRIMARY KEY, level smallint NOT NULL,
          name text NOT NULL, name_norm text NOT NULL, tags jsonb NOT NULL DEFAULT '{}',
          geom geometry(MultiPolygon,4326) NOT NULL);
        CREATE INDEX ${RAW}_geom_idx ON ${RAW} USING gist(geom)`);
      await sql.unsafe(`DROP TABLE IF EXISTS ${BOUNDARY};
        CREATE TABLE ${BOUNDARY}(id serial PRIMARY KEY, geom geometry(Polygon,4326) NOT NULL);
        CREATE INDEX ${BOUNDARY}_geom_idx ON ${BOUNDARY} USING gist(geom)`);
      // "VN" cho test: hộp phủ hai con mồ côi đầu, KHÔNG phủ con thứ ba.
      await sql.unsafe(`INSERT INTO ${BOUNDARY}(geom)
        VALUES (ST_MakeEnvelope(100,19.9,100.5,20.3,4326))`);
    });

    afterAll(() => sql.unsafe(`DROP TABLE IF EXISTS ${RAW},${BOUNDARY}`));

    it('thiếu hơn một tỉnh thì KHÔNG dựng, và nói rõ lý do', async () => {
      const result = await bootstrapMissingProvince(sql, {
        rawTable: RAW,
        boundaryTable: BOUNDARY,
      });
      expect(result.applied).toBe(false);
      expect(result.reason).toMatch(/không đúng một tỉnh|nhiều tỉnh/i);
    });

    it('đúng một tỉnh thiếu thì dựng L4 từ hợp con mồ côi trong VN', async () => {
      // Nạp đủ 33/34 tỉnh để chỉ còn Khánh Hòa thiếu.
      const canon = [
        'ha noi',
        'hue',
        'lai chau',
        'dien bien',
        'son la',
        'lang son',
        'quang ninh',
        'thanh hoa',
        'nghe an',
        'ha tinh',
        'cao bang',
        'tuyen quang',
        'lao cai',
        'thai nguyen',
        'phu tho',
        'bac ninh',
        'hung yen',
        'hai phong',
        'ninh binh',
        'quang tri',
        'da nang',
        'quang ngai',
        'gia lai',
        'lam dong',
        'dak lak',
        'ho chi minh',
        'dong nai',
        'tay ninh',
        'can tho',
        'vinh long',
        'dong thap',
        'ca mau',
        'an giang',
      ];
      for (const [index, norm] of canon.entries()) {
        await sql.unsafe(`INSERT INTO ${RAW}(osm_relation_id,level,name,name_norm,geom) VALUES
          (${9_100_000 + index},4,'T ${norm}','${norm}',
           ST_Multi(ST_MakeEnvelope(${50 + index * 0.5},10,${50.4 + index * 0.5},10.4,4326)))`);
      }
      await child(9_200_001, 'Nha Trang', 100.0);
      await child(9_200_002, 'Cam Ranh', 100.25);
      await child(9_200_003, 'Ngoai VN', 120.0);

      const result = await bootstrapMissingProvince(sql, {
        rawTable: RAW,
        boundaryTable: BOUNDARY,
      });
      expect(result.applied).toBe(true);
      expect(result.province).toBe('Khánh Hòa');
      // Chỉ hai con trong vn_boundary được gộp; con thứ ba ngoài VN bị loại.
      expect(result.children).toBe(2);

      const [row] = await sql.unsafe(`SELECT name, name_norm, tags,
          ST_XMin(geom) AS xmin, ST_XMax(geom) AS xmax
        FROM ${RAW} WHERE level=4 AND name_norm='khanh hoa'`);
      expect(row.name).toBe('Khánh Hòa');
      expect(row.tags['mapslibvn:derived']).toBe('union-of-orphan-children');
      expect(Number(row.xmin)).toBeCloseTo(100.0, 5);
      expect(Number(row.xmax)).toBeCloseTo(100.45, 5);
    });
  });

  // Publish khi cổng QA đỏ phải là quyết định **tường minh có ghi lý do**, không phải lách gate:
  // 07/09/2026 PHONG duyệt publish với 2 ca đảo chưa có đích, và lý do đó phải nằm trong report.
  it('không có lý do thì cổng QA vẫn ném; có lý do thì ghi vào report', async () => {
    await expect(
      buildOldAdmin(sql, { currentTable: 'admin_area', fixture: false }),
    ).rejects.toThrow(/QA alias hành chính đỏ/);
    const report = await buildOldAdmin(sql, {
      currentTable: 'admin_area',
      fixture: false,
      acceptQaReason: 'PHONG duyệt 07/09: 2 ca đảo chưa có đích',
    });
    expect(report.acceptedQa).toMatchObject({
      reason: 'PHONG duyệt 07/09: 2 ca đảo chưa có đích',
    });
    expect(report.acceptedQa.failure).toMatch(/unmatched/);
  });

  it('publish lỗi giữ nguyên đồng thời cả ba bảng', async () => {
    const [before] = await sql`SELECT
      (SELECT count(*)::int FROM admin_area) areas,
      (SELECT count(*)::int FROM admin_area_old) old_areas,
      (SELECT count(*)::int FROM admin_alias) aliases`;
    for (const table of ['admin_area', 'admin_area_old', 'admin_alias']) {
      await createNewTable(sql, table);
      await sql.unsafe(`INSERT INTO ${table}_new SELECT * FROM ${table}`);
    }
    await sql.unsafe(`CREATE OR REPLACE FUNCTION task4_reject_alias() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'task4 intentional publish failure'; END $$;
      CREATE TRIGGER task4_reject_alias BEFORE INSERT ON admin_alias
      FOR EACH STATEMENT EXECUTE FUNCTION task4_reject_alias()`);
    await expect(publishNew(sql, ['admin_area', 'admin_area_old', 'admin_alias'])).rejects.toThrow(
      'task4 intentional publish failure',
    );
    expect(
      await sql`SELECT
        (SELECT count(*)::int FROM admin_area) areas,
        (SELECT count(*)::int FROM admin_area_old) old_areas,
        (SELECT count(*)::int FROM admin_alias) aliases`,
    ).toEqual([before]);
    await sql.unsafe(`DROP TRIGGER task4_reject_alias ON admin_alias;
      DROP FUNCTION task4_reject_alias();
      DROP TABLE IF EXISTS admin_area_new,admin_area_old_new,admin_alias_new`);
  });

  it('advisory lock giữ trên cùng connection và chặn runner thứ hai', async () => {
    await withAdvisoryLock(sql, 'mapslibvn-admin-publish-test', async () => {
      const other = await sql.reserve();
      try {
        const [row] =
          await other`SELECT pg_try_advisory_lock(hashtext('mapslibvn-admin-publish-test')) acquired`;
        expect(row.acquired).toBe(false);
      } finally {
        other.release();
      }
    });
    const [row] =
      await sql`SELECT pg_try_advisory_lock(hashtext('mapslibvn-admin-publish-test')) acquired`;
    expect(row.acquired).toBe(true);
    await sql`SELECT pg_advisory_unlock(hashtext('mapslibvn-admin-publish-test'))`;
  });
});
