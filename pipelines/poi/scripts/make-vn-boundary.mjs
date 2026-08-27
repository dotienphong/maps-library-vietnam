#!/usr/bin/env node
// Tải Natural Earth 10m admin_0 countries (public domain), lấy Việt Nam, đơn giản hoá 0,002° → data/vn-boundary.geojson (commit).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { POI_WORK, VN_BOUNDARY } from '../src/lib/env.mjs';

mkdirSync(POI_WORK, { recursive: true });
const zip = resolve(POI_WORK, 'ne_10m_admin_0_countries.zip');
const out = resolve(POI_WORK, 'vn-ne.json');
run('curl', [
  '-fsSL',
  '--retry',
  '5',
  '-o',
  zip,
  'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip',
]);
run('duckdb', [
  '-c',
  `INSTALL spatial; LOAD spatial;
COPY (SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.002)) AS geometry
      FROM ST_Read('/vsizip/${zip}/ne_10m_admin_0_countries.shp') WHERE ADM0_A3 = 'VNM') TO '${out}' (FORMAT json);`,
]);
const first = readFileSync(out, 'utf8')
  .split('\n')
  .find((l) => l.trim());
if (!first) throw new Error('Không thấy Việt Nam trong Natural Earth');
// DuckDB ≥ 1.5: ST_AsGeoJSON trả kiểu JSON (object); bản cũ trả chuỗi
const raw = JSON.parse(first).geometry;
const geometry = typeof raw === 'string' ? JSON.parse(raw) : raw;
writeFileSync(
  VN_BOUNDARY,
  JSON.stringify({
    type: 'Feature',
    properties: {
      source: 'Natural Earth 10m admin_0_countries (public domain)',
      simplify_deg: 0.002,
    },
    geometry,
  }),
);
console.log(`✓ ${VN_BOUNDARY} (${geometry.type}, ${JSON.stringify(geometry).length} byte)`);
