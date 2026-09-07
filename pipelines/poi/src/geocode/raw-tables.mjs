import { readFileSync } from 'node:fs';
import { normalizeVi } from '@mapslibvn/core';
import { copyInto } from '../pg.mjs';

/**
 * Tỷ lệ diện tích tối thiểu nằm trong `vn_boundary` để một đơn vị con được coi là của Việt Nam.
 * 0,9 tách sạch theo số đo trên snapshot 01/2025: Lào/Trung Quốc ≤0,362, Khánh Hòa ≥0,987.
 */
const INSIDE_VN_MIN_RATIO = 0.9;

/** Tên tỉnh hiện hành theo `provinces.json`, kèm dạng đã bỏ tiền tố cấp. */
const canonicalProvinces = () =>
  Object.keys(JSON.parse(readFileSync('packages/core/src/provinces.json', 'utf8'))).map((name) => ({
    name,
    norm: normalizeVi(name).replace(/^(?:tinh|thanh pho)\s+/, ''),
  }));

/**
 * Dựng L4 cho tỉnh **duy nhất** thiếu relation cấp tỉnh, bằng hợp các đơn vị con mồ côi nằm trong
 * ranh giới VN.
 *
 * Vì sao cần: OSM không có relation `admin_level=4` cho Khánh Hòa — cả ở snapshot 01/2025 (62/63
 * tỉnh cũ) lẫn OSM hiện tại (Overpass truy vấn theo tên trả rỗng, 07/09/2026). `admin.mjs` chỉ giữ
 * L6/L8 nằm trong một L4, nên 8 quận/huyện cũ của tỉnh này (Nha Trang, Cam Ranh, Cam Lâm, Diên
 * Khánh, Khánh Sơn, Khánh Vĩnh, Vạn Ninh, Ninh Hòa) và các phường mới (Nha Trang, Bắc/Nam/Tây Nha
 * Trang) bị loại sạch. Hợp các đơn vị cấu thành **đúng bằng** tỉnh theo định nghĩa hành chính, và
 * dữ liệu vẫn là ODbL của chính OSM — không vẽ thêm gì.
 *
 * Hai chốt an toàn: chỉ chạy khi **đúng một** tỉnh trong `provinces.json` thiếu (nhiều hơn thì
 * không phân biệt được con nào của tỉnh nào), và chỉ gộp con có **≥90% diện tích nằm trong VN**.
 * Ngưỡng theo số đo thật trên snapshot 01/2025: `Sa Mouay` (Lào) chỉ 0,362 còn 8 huyện Khánh Hòa
 * đạt 0,987–1,000. Kiểm bằng point-on-surface là **không đủ**: `vn_boundary` đệm 2 km nên
 * Sa Mouay vẫn lọt và bị hút vào polygon tỉnh.
 *
 * @param {import('postgres').Sql} sql
 * @param {{rawTable:string, childLevel?:number}} options
 * @returns {Promise<{applied:boolean, province?:string, children?:number, reason?:string}>}
 */
export async function bootstrapMissingProvince(sql, { rawTable, childLevel = 6 }) {
  const canonical = canonicalProvinces();
  const existing = await sql.unsafe(`SELECT name_norm FROM ${rawTable} WHERE level=4`);
  const have = new Set(existing.map((row) => String(row.name_norm)));
  const missing = canonical.filter((province) => !have.has(province.norm));
  if (missing.length !== 1) {
    return {
      applied: false,
      reason: `không đúng một tỉnh thiếu relation cấp tỉnh (thiếu ${missing.length}) — không phân biệt được đơn vị con thuộc tỉnh nào`,
    };
  }
  const [boundary] = await sql`SELECT to_regclass('vn_boundary') AS present`;
  if (boundary?.present == null) {
    return { applied: false, reason: 'thiếu bảng vn_boundary nên không giới hạn được trong VN' };
  }
  const target = missing[0];
  if (!target) return { applied: false, reason: 'không xác định được tỉnh thiếu' };

  const orphanFilter = `r.level=$1
      AND NOT EXISTS (SELECT 1 FROM ${rawTable} p WHERE p.level=4
        AND p.geom&&r.geom AND ST_Covers(p.geom,ST_PointOnSurface(r.geom)))
      AND (SELECT coalesce(sum(ST_Area(ST_Intersection(r.geom,b.geom)::geography)),0)
           FROM vn_boundary b WHERE b.geom&&r.geom)
          >= ${INSIDE_VN_MIN_RATIO} * NULLIF(ST_Area(r.geom::geography),0)`;
  const [counted] = await sql.unsafe(
    `SELECT count(*)::int AS n FROM ${rawTable} r WHERE ${orphanFilter}`,
    [childLevel],
  );
  const children = Number(counted?.n ?? 0);
  if (children === 0) {
    return { applied: false, reason: 'không có đơn vị con mồ côi nào nằm trong VN' };
  }

  // Bảng raw của nhánh old có cột `snapshot NOT NULL`; nhánh current thì không.
  const [snapshotColumn] = await sql`SELECT 1 AS present FROM information_schema.columns
    WHERE table_name=${rawTable} AND column_name='snapshot'`;
  const columns = snapshotColumn ? ',snapshot' : '';
  const snapshotValue = snapshotColumn ? `,(SELECT max(snapshot) FROM ${rawTable})` : '';
  await sql.unsafe(
    `INSERT INTO ${rawTable}(osm_relation_id,level,name,name_norm,tags,geom${columns})
     SELECT -4,4,$2,$3,
       jsonb_build_object('mapslibvn:derived','union-of-orphan-children','mapslibvn:children',$4::int),
       ST_Multi(ST_Union(r.geom))${snapshotValue}
     FROM ${rawTable} r WHERE ${orphanFilter}`,
    [childLevel, target.name, target.norm, children],
  );
  return { applied: true, province: target.name, children };
}

/**
 * Dựng hai bảng raw song song rồi hoán đổi cùng một transaction. Nếu COPY/index/validate/swap
 * lỗi, hai bảng published cũ còn nguyên và mọi staging table được dọn.
 * @param {import('postgres').Sql} sql
 * @param {{ roadRows: AsyncIterable<unknown[]> | Iterable<unknown[]>, adminRows: AsyncIterable<unknown[]> | Iterable<unknown[]> }} rows
 */
export async function replaceRawTables(sql, { roadRows, adminRows }) {
  let published = false;
  try {
    await sql.unsafe('DROP TABLE IF EXISTS osm_road_raw_new, osm_admin_raw_new');
    await sql.unsafe(`CREATE TABLE osm_road_raw_new (
      osm_way_id bigint PRIMARY KEY, name text NOT NULL, name_norm text NOT NULL,
      highway text NOT NULL, alley_keyword text, alley_number text, parent_norm text,
      geom geometry(LineString, 4326) NOT NULL, province_norm text)`);
    await sql.unsafe(`CREATE TABLE osm_admin_raw_new (
      osm_relation_id bigint PRIMARY KEY, level smallint NOT NULL, name text NOT NULL,
      name_norm text NOT NULL, tags jsonb NOT NULL DEFAULT '{}',
      geom geometry(MultiPolygon, 4326) NOT NULL)`);
    const roads = await copyInto(
      sql,
      'osm_road_raw_new',
      [
        'osm_way_id',
        'name',
        'name_norm',
        'highway',
        'alley_keyword',
        'alley_number',
        'parent_norm',
        'geom',
      ],
      roadRows,
    );
    const admins = await copyInto(
      sql,
      'osm_admin_raw_new',
      ['osm_relation_id', 'level', 'name', 'name_norm', 'tags', 'geom'],
      adminRows,
    );
    await sql.unsafe(`CREATE INDEX osm_road_raw_new_geom_idx
        ON osm_road_raw_new USING gist (geom);
      CREATE INDEX osm_admin_raw_new_geom_idx
        ON osm_admin_raw_new USING gist (geom);
      UPDATE osm_admin_raw_new
        SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
        WHERE NOT ST_IsValid(geom);
      ANALYZE osm_road_raw_new;
      ANALYZE osm_admin_raw_new`);
    await sql.begin(async (tx) => {
      await tx.unsafe('DROP TABLE IF EXISTS osm_road_raw, osm_admin_raw');
      await tx.unsafe(`ALTER TABLE osm_road_raw_new RENAME TO osm_road_raw;
        ALTER TABLE osm_admin_raw_new RENAME TO osm_admin_raw;
        ALTER INDEX osm_road_raw_new_geom_idx RENAME TO osm_road_raw_geom_idx;
        ALTER INDEX osm_admin_raw_new_geom_idx RENAME TO osm_admin_raw_geom_idx`);
    });
    published = true;
    return { roads, admins };
  } finally {
    if (!published) {
      await sql.unsafe('DROP TABLE IF EXISTS osm_road_raw_new, osm_admin_raw_new');
    }
  }
}
