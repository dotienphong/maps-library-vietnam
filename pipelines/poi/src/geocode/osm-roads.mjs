#!/usr/bin/env node
// PBF OSM đã patch → hai bảng thô đường có tên và ranh giới hành chính.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeVi } from '@mapslibvn/core';
import { run } from '../../../../scripts/lib/run.mjs';
import { OSM_PBF, POI_WORK } from '../lib/env.mjs';
import { parseOsmiumId } from '../lib/osmium-id.mjs';
import { connect, countRows, readJsonl } from '../pg.mjs';
import { parseAlleyName, streetNameNorm } from './alley-name.mjs';
import { replaceRawTables } from './raw-tables.mjs';

const ROAD_TYPES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'pedestrian',
  'road',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
  'track',
  'path',
  'footway',
]);

mkdirSync(POI_WORK, { recursive: true });
const roadsPbf = resolve(POI_WORK, 'roads.osm.pbf');
const adminPbf = resolve(POI_WORK, 'admin.osm.pbf');
const roadsSeq = resolve(POI_WORK, 'roads.geojsonseq');
const adminSeq = resolve(POI_WORK, 'admin.geojsonseq');

run('osmium', ['tags-filter', '--overwrite', '-o', roadsPbf, OSM_PBF, 'w/highway']);
run('osmium', [
  'export',
  '--overwrite',
  '-f',
  'geojsonseq',
  '-x',
  'print_record_separator=false',
  '--add-unique-id=type_id',
  '--geometry-types=linestring',
  '-o',
  roadsSeq,
  roadsPbf,
]);
run('osmium', ['tags-filter', '--overwrite', '-o', adminPbf, OSM_PBF, 'r/boundary=administrative']);
run('osmium', [
  'export',
  '--overwrite',
  '-f',
  'geojsonseq',
  '-x',
  'print_record_separator=false',
  '--add-unique-id=type_id',
  '--geometry-types=polygon',
  '-o',
  adminSeq,
  adminPbf,
]);

/** GeoJSON geometry → EWKT. @param {{ type: string, coordinates: unknown }} geometry */
function ewktOf(geometry) {
  const point = (/** @type {number[]} */ coordinates) => `${coordinates[0]} ${coordinates[1]}`;
  const ring = (/** @type {number[][]} */ coordinates) => `(${coordinates.map(point).join(',')})`;
  if (geometry.type === 'LineString') {
    return `SRID=4326;LINESTRING(${
      /** @type {number[][]} */ (geometry.coordinates)
        .map(point)
        .join(',')
    })`;
  }
  if (geometry.type === 'Polygon') {
    return `SRID=4326;MULTIPOLYGON((${
      /** @type {number[][][]} */ (geometry.coordinates)
        .map(ring)
        .join(',')
    }))`;
  }
  if (geometry.type === 'MultiPolygon') {
    return `SRID=4326;MULTIPOLYGON(${
      /** @type {number[][][][]} */ (geometry.coordinates)
        .map((polygon) => `(${polygon.map(ring).join(',')})`)
        .join(',')
    })`;
  }
  return null;
}

async function* roadRows() {
  for await (const feature of readJsonl(roadsSeq)) {
    const properties = feature.properties ?? {};
    const id = parseOsmiumId(feature.id ?? properties.id);
    if (
      !id ||
      id.type !== 'w' ||
      !properties.name ||
      !ROAD_TYPES.has(properties.highway) ||
      feature.geometry?.type !== 'LineString'
    ) {
      continue;
    }
    const alley = parseAlleyName(properties.name);
    yield [
      id.id,
      properties.name,
      streetNameNorm(properties.name),
      properties.highway,
      alley?.keyword ?? null,
      alley?.number ?? null,
      alley?.parentNorm ?? null,
      ewktOf(feature.geometry),
    ];
  }
}

async function* adminRows() {
  for await (const feature of readJsonl(adminSeq)) {
    const properties = feature.properties ?? {};
    const id = parseOsmiumId(feature.id ?? properties.id);
    const level = Number(properties.admin_level);
    const name = properties['name:vi'] ?? properties.name;
    if (!id || id.type !== 'r' || !Number.isInteger(level) || !name || !feature.geometry) {
      continue;
    }
    const wkt = ewktOf(feature.geometry);
    if (!wkt) continue;
    yield [
      id.id,
      level,
      name,
      normalizeVi(name).replace(/^(?:tinh|thanh pho|quan|huyen|thi xa|phuong|xa|thi tran)\s+/, ''),
      wkt,
    ];
  }
}

const sql = connect();
try {
  const { roads, admins } = await replaceRawTables(sql, {
    roadRows: roadRows(),
    adminRows: adminRows(),
  });
  const levels =
    await sql`SELECT level, count(*)::int AS n FROM osm_admin_raw GROUP BY 1 ORDER BY 1`;
  console.log(
    `✓ osm_road_raw ${roads} đường có tên (${await countRows(sql, 'osm_road_raw')}), osm_admin_raw ${admins} ranh giới — admin_level: ${levels.map((level) => `${level.level}=${level.n}`).join(', ')}`,
  );
} finally {
  await sql.end();
}
