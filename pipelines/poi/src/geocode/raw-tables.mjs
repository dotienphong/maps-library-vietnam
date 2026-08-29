import { copyInto } from '../pg.mjs';

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
      name_norm text NOT NULL, geom geometry(MultiPolygon, 4326) NOT NULL)`);
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
      ['osm_relation_id', 'level', 'name', 'name_norm', 'geom'],
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
