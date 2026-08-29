#!/usr/bin/env node
// Mốc địa chỉ từ OSM và record Overture/FSQ; gộp cùng số + đường trong 30 m.
import { parseAddress } from '@mapslibvn/core';
import { ewkt, pgArray } from '../lib/copy-format.mjs';
import { vnDate } from '../lib/env.mjs';
import { connect, copyInto, countRows, createNewTable, publishNew } from '../pg.mjs';
import { streetNameNorm } from './alley-name.mjs';

const release = vnDate();
const sql = connect();
try {
  await sql.unsafe(`DROP TABLE IF EXISTS address_anchor_raw;
    CREATE TABLE address_anchor_raw (
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
    ANALYZE address_anchor_raw`);
  await createNewTable(sql, 'address_anchor');
  await sql.unsafe(`INSERT INTO address_anchor_new (
      housenumber, alley_chain, house_in_alley, street_norm, geom,
      source, source_id, confidence, release
    )
    WITH first_pass AS (
      SELECT housenumber,
        (array_agg(alley_chain::text ORDER BY confidence DESC, source, source_id))[1]::text[] AS alley_chain,
        (array_agg(house_in_alley ORDER BY confidence DESC, source, source_id))[1] AS house_in_alley,
        street_norm, ST_GeometricMedian(ST_Multi(ST_Collect(geom))) AS geom,
        (array_agg(source ORDER BY confidence DESC, source, source_id))[1] AS source,
        (array_agg(source_id ORDER BY confidence DESC, source, source_id))[1] AS source_id,
        max(confidence) AS confidence
      FROM (
        SELECT *, ST_ClusterDBSCAN(geom, eps := 0.0003, minpoints := 1)
          OVER (PARTITION BY housenumber, street_norm) AS cluster_id
        FROM address_anchor_raw
      ) raw_clusters
      GROUP BY housenumber, street_norm, cluster_id
    ), second_pass AS (
      SELECT *, ST_ClusterDBSCAN(ST_Transform(geom, 32648), eps := 30.5, minpoints := 1)
        OVER (PARTITION BY housenumber, street_norm) AS cluster_id
      FROM first_pass
    )
    SELECT housenumber,
      (array_agg(alley_chain::text ORDER BY confidence DESC, source, source_id))[1]::text[],
      (array_agg(house_in_alley ORDER BY confidence DESC, source, source_id))[1], street_norm,
      ST_GeometricMedian(ST_Multi(ST_Collect(geom))),
      (array_agg(source ORDER BY confidence DESC, source, source_id))[1],
      (array_agg(source_id ORDER BY confidence DESC, source, source_id))[1],
      max(confidence), '${release}'
    FROM second_pass
    GROUP BY housenumber, street_norm, cluster_id`);
  await sql.unsafe(`UPDATE address_anchor_new anchor SET ward_norm = ward.name_norm
    FROM admin_area ward
    WHERE ward.level = 8 AND ST_Contains(ward.geom, anchor.geom)`);
  await sql.unsafe(`UPDATE address_anchor_new anchor SET province_norm = province.name_norm
    FROM admin_area province
    WHERE province.level = 4 AND ST_Contains(province.geom, anchor.geom)`);
  await publishNew(sql, ['address_anchor']);
  await sql.unsafe('DROP TABLE address_anchor_raw; ANALYZE address_anchor');
  const [nguyenLam] =
    await sql`SELECT count(*)::int AS n FROM address_anchor WHERE street_norm = 'nguyen lam'`;
  if (!nguyenLam) throw new Error('Thiếu số liệu Nguyễn Lâm sau publish');
  console.log(
    `✓ address_anchor ${await countRows(sql, 'address_anchor')} mốc (thô OSM ${osmCount} + POI ${recordCount}); Nguyễn Lâm: ${nguyenLam.n}`,
  );
} finally {
  await sql.end();
}
