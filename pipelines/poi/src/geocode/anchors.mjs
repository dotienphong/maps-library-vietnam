#!/usr/bin/env node
// Mốc địa chỉ từ OSM và record FSQ; gộp cùng số + đường trong 30 m.
import { parseAddress } from '@mapslibvn/core';
import { ewkt, pgArray } from '../lib/copy-format.mjs';
import { vnDate } from '../lib/env.mjs';
import { connect, copyInto, countRows, createNewTable, publishNew } from '../pg.mjs';
import { streetNameNorm } from './alley-name.mjs';

const release = vnDate();
/**
 * @param {{ afterRaw?: () => void | Promise<void> }} [hooks]
 */
export async function buildAnchors({ afterRaw = () => {} } = {}) {
  const sql = connect();
  try {
    await sql.unsafe(`DROP TABLE IF EXISTS address_anchor_raw, address_anchor_edge, address_anchor_new;
    CREATE TABLE address_anchor_raw (
      id bigserial PRIMARY KEY,
      housenumber text NOT NULL, alley_chain text[] NOT NULL, house_in_alley text,
      street_norm text NOT NULL, geom geometry(Point, 4326) NOT NULL,
      source text NOT NULL, source_id text, confidence real NOT NULL
    )`);
    const columns = [
      'housenumber',
      'alley_chain',
      'house_in_alley',
      'street_norm',
      'geom',
      'source',
      'source_id',
      'confidence',
    ];

    async function* osmRows() {
      for await (const rows of sql`SELECT osm_type, osm_id,
      tags->>'addr:housenumber' AS housenumber, tags->>'addr:street' AS street,
      ST_X(geom) AS lon, ST_Y(geom) AS lat
      FROM src_osm_place
      WHERE tags ? 'addr:housenumber' AND tags ? 'addr:street'`.cursor(5000)) {
        for (const row of rows) {
          const parsed = parseAddress(`${row.housenumber} ${row.street}`);
          if (!parsed.housenumber) continue;
          yield [
            parsed.housenumber,
            pgArray(parsed.alleyChain),
            parsed.houseInAlley ?? null,
            streetNameNorm(row.street),
            ewkt(row.lon, row.lat),
            'osm',
            `${row.osm_type}${row.osm_id}`,
            0.8,
          ];
        }
      }
    }

    async function* recordRows() {
      for await (const rows of sql`SELECT source, source_id, housenumber, street,
      ST_X(geom) AS lon, ST_Y(geom) AS lat FROM poi_work_record
      WHERE source <> 'osm' AND housenumber IS NOT NULL AND street IS NOT NULL`.cursor(5000)) {
        for (const row of rows) {
          const parsed = parseAddress(`${row.housenumber} ${row.street}`);
          if (!parsed.housenumber || parsed.confidence < 0.5) continue;
          yield [
            parsed.housenumber,
            pgArray(parsed.alleyChain),
            parsed.houseInAlley ?? null,
            streetNameNorm(row.street),
            ewkt(row.lon, row.lat),
            row.source,
            row.source_id,
            row.source === 'fsq' ? 0.7 : 0.6,
          ];
        }
      }
    }

    const osmCount = await copyInto(sql, 'address_anchor_raw', columns, osmRows());
    const recordCount = await copyInto(sql, 'address_anchor_raw', columns, recordRows());
    await sql.unsafe(`CREATE INDEX address_anchor_raw_geom_idx
      ON address_anchor_raw USING gist (geom);
    CREATE INDEX address_anchor_raw_address_idx
      ON address_anchor_raw (housenumber, street_norm);
    ANALYZE address_anchor_raw`);
    await afterRaw();
    const exactClusterInto = async (/** @type {string} */ input, /** @type {string} */ output) => {
      if (!['address_anchor_raw', 'address_anchor_new'].includes(input)) {
        throw new Error(`Bảng input anchor không hợp lệ: ${input}`);
      }
      if (!['address_anchor_new', 'address_anchor_merge'].includes(output)) {
        throw new Error(`Bảng output anchor không hợp lệ: ${output}`);
      }
      await sql.unsafe(`DROP TABLE IF EXISTS address_anchor_edge;
        CREATE TABLE address_anchor_edge (a bigint NOT NULL, b bigint NOT NULL);
        WITH exact_pair AS MATERIALIZED (
          SELECT left_anchor.id AS a, right_anchor.id AS b
          FROM ${input} left_anchor
          JOIN ${input} right_anchor
            ON left_anchor.id < right_anchor.id
           AND left_anchor.housenumber = right_anchor.housenumber
           AND left_anchor.street_norm = right_anchor.street_norm
           -- Geometry dùng GiST làm prefilter; geography là ngưỡng quyết định chính xác.
           AND ST_DWithin(left_anchor.geom, right_anchor.geom, 0.0003)
           AND ST_DWithin(left_anchor.geom::geography, right_anchor.geom::geography, 30)
        )
        INSERT INTO address_anchor_edge (a, b)
        SELECT a, b FROM exact_pair UNION ALL SELECT b, a FROM exact_pair;
        CREATE INDEX address_anchor_edge_a_idx ON address_anchor_edge (a);
        ANALYZE address_anchor_edge;
        INSERT INTO ${output} (
          housenumber, alley_chain, house_in_alley, street_norm, geom,
          source, source_id, confidence, release
        )
        WITH RECURSIVE connected(start_id, node_id) AS (
          SELECT a, a FROM address_anchor_edge
          UNION
          SELECT connected.start_id, edge.b
          FROM connected
          JOIN address_anchor_edge edge ON edge.a = connected.node_id
        ), component AS (
          SELECT node_id, min(start_id) AS cluster_id FROM connected GROUP BY node_id
        ), clustered AS (
          SELECT anchor.*, COALESCE(component.cluster_id, anchor.id) AS cluster_id
          FROM ${input} anchor
          LEFT JOIN component ON component.node_id = anchor.id
        )
        SELECT housenumber,
          (array_agg(alley_chain::text ORDER BY confidence DESC, source, source_id))[1]::text[],
          (array_agg(house_in_alley ORDER BY confidence DESC, source, source_id))[1], street_norm,
          ST_GeometricMedian(ST_Multi(ST_Collect(geom))),
          (array_agg(source ORDER BY confidence DESC, source, source_id))[1],
          (array_agg(source_id ORDER BY confidence DESC, source, source_id))[1],
          max(confidence), '${release}'
        FROM clustered
        GROUP BY housenumber, street_norm, cluster_id`);
    };

    await createNewTable(sql, 'address_anchor');
    await exactClusterInto('address_anchor_raw', 'address_anchor_new');
    let duplicateCount = 0;
    for (let pass = 1; pass <= 8; pass++) {
      const [duplicates] = await sql`SELECT count(*)::int AS n
        FROM address_anchor_new a
        JOIN address_anchor_new b
          ON a.id < b.id AND a.housenumber = b.housenumber
         AND a.street_norm = b.street_norm
         AND ST_DWithin(a.geom, b.geom, 0.0003)
         AND ST_DWithin(a.geom::geography, b.geom::geography, 30)`;
      duplicateCount = Number(duplicates?.n ?? 0);
      if (duplicateCount === 0) break;
      await sql.unsafe(`DROP TABLE IF EXISTS address_anchor_merge;
        CREATE TABLE address_anchor_merge (LIKE address_anchor INCLUDING ALL)`);
      await exactClusterInto('address_anchor_new', 'address_anchor_merge');
      await sql.unsafe(`TRUNCATE address_anchor_new;
        INSERT INTO address_anchor_new SELECT * FROM address_anchor_merge;
        DROP TABLE address_anchor_merge`);
    }
    if (duplicateCount !== 0) {
      const [duplicates] = await sql`SELECT count(*)::int AS n
        FROM address_anchor_new a
        JOIN address_anchor_new b
          ON a.id < b.id AND a.housenumber = b.housenumber
         AND a.street_norm = b.street_norm
         AND ST_DWithin(a.geom, b.geom, 0.0003)
         AND ST_DWithin(a.geom::geography, b.geom::geography, 30)`;
      duplicateCount = Number(duplicates?.n ?? 0);
    }
    if (duplicateCount !== 0) {
      throw new Error(`Anchor exact 30 m không hội tụ sau 8 pass: còn ${duplicateCount} cặp`);
    }
    await sql.unsafe(`UPDATE address_anchor_new anchor SET ward_norm = ward.name_norm
    FROM admin_area ward
    WHERE ward.level = 8 AND ST_Contains(ward.geom, anchor.geom)`);
    await sql.unsafe(`UPDATE address_anchor_new anchor SET province_norm = province.name_norm
    FROM admin_area province
    WHERE province.level = 4 AND ST_Contains(province.geom, anchor.geom)`);
    // M4 (spec 5.7): mốc từ đóng góp đã duyệt (source='user', confidence 0,95) không tái sinh
    // từ nguồn — chép sang bảng mới trước khi hoán đổi, nếu không sẽ mất sau mỗi lần chạy.
    // Chạy sau bước gán ward/province để giữ nguyên giá trị người dùng đã cung cấp.
    await sql.unsafe(`INSERT INTO address_anchor_new
        (housenumber, alley_chain, house_in_alley, street_norm, ward_norm, province_norm,
         geom, source, source_id, confidence, release)
      SELECT housenumber, alley_chain, house_in_alley, street_norm, ward_norm, province_norm,
             geom, source, source_id, confidence, release
      FROM address_anchor WHERE source = 'user'`);
    await publishNew(sql, ['address_anchor']);
    await sql.unsafe('ANALYZE address_anchor');
    const [nguyenLam] =
      await sql`SELECT count(*)::int AS n FROM address_anchor WHERE street_norm = 'nguyen lam'`;
    if (!nguyenLam) throw new Error('Thiếu số liệu Nguyễn Lâm sau publish');
    console.log(
      `✓ address_anchor ${await countRows(sql, 'address_anchor')} mốc (thô OSM ${osmCount} + POI ${recordCount}); Nguyễn Lâm: ${nguyenLam.n}`,
    );
  } finally {
    await sql.unsafe(
      'DROP TABLE IF EXISTS address_anchor_raw, address_anchor_edge, address_anchor_merge, address_anchor_new',
    );
    await sql.end();
  }
}

if (process.argv[1]?.endsWith('anchors.mjs')) await buildAnchors();
