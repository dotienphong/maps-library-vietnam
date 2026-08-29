#!/usr/bin/env node
// poi active → GeoJSONSeq → tippecanoe → out/<release>.pmtiles (spec 5.8). Dùng: node export-tiles.mjs [--release poi-YYYYMMDD]
import { createWriteStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { run } from '../../../scripts/lib/run.mjs';
import { releaseName } from '../../tiles/src/lib/dates.mjs';
import { OUT, POI_WORK, arg } from './lib/env.mjs';
import { connect } from './pg.mjs';

export const LOW_ZOOM_GROUPS = [
  'education',
  'health',
  'transport',
  'public_admin',
  'culture_tourism',
];

/** Bộ lọc tippecanoe theo zoom: z10–11 nhóm công cộng q ≥ 7; z12–14 mọi nhóm q ≥ 6; z15–16 tất cả (spec 5.8). */
export function tippecanoeFilter() {
  return {
    poi: [
      'any',
      ['>=', '$zoom', 15],
      ['all', ['>=', '$zoom', 12], ['<=', '$zoom', 14], ['>=', 'q', 6]],
      ['all', ['<=', '$zoom', 11], ['>=', 'q', 7], ['in', 'grp', ...LOW_ZOOM_GROUPS]],
    ],
  };
}

/** @param {{ id: string, name: string, cat: string, grp: string, quality_score: number | null, lon: number, lat: number }} r */
export function featureLine(r) {
  const q = Math.max(0, Math.min(9, Math.floor((r.quality_score ?? 0) / 10)));
  return `${JSON.stringify({
    type: 'Feature',
    properties: { id: r.id, name: r.name, cat: r.cat, grp: r.grp, q },
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
  })}\n`;
}

if (process.argv[1]?.endsWith('export-tiles.mjs')) {
  const release = arg('--release', undefined) ?? releaseName('poi');
  mkdirSync(POI_WORK, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const seq = resolve(POI_WORK, 'poi.geojsonseq');
  const filterFile = resolve(POI_WORK, 'poi-filter.json');
  const output = resolve(OUT, `${release}.pmtiles`);
  const sql = connect();
  let n = 0;
  try {
    async function* lines() {
      for await (const rows of sql`SELECT p.id, p.name, p.category AS cat, c.group_code AS grp, p.quality_score, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat
          FROM poi p JOIN category c ON c.code = p.category WHERE p.status = 'active'`.cursor(
        5000,
      )) {
        for (const r of rows) {
          n++;
          yield featureLine(/** @type {any} */ (r));
        }
      }
    }
    await pipeline(Readable.from(lines()), createWriteStream(seq));
  } finally {
    await sql.end();
  }
  writeFileSync(filterFile, JSON.stringify(tippecanoeFilter()));
  // Không dùng --extend-zooms-if-still-dropping: nó có thể đẩy maxzoom > 16 làm smoke/inspect lệch với spec 5.8.
  run('tippecanoe', [
    '-o',
    output,
    '--force',
    '-l',
    'poi',
    '-Z10',
    '-z16',
    '-r1',
    '--drop-densest-as-needed',
    '-J',
    filterFile,
    '-P',
    '-y',
    'id',
    '-y',
    'name',
    '-y',
    'cat',
    '-y',
    'grp',
    '-y',
    'q',
    seq,
  ]);
  const mb = statSync(output).size / 2 ** 20;
  console.log(`✓ ${output}: ${n} POI, ${mb.toFixed(1)} MB`);
  if (mb > 400) {
    console.error(
      'Vượt 400 MB — thêm --maximum-tile-bytes=300000 hoặc nâng ngưỡng q ở z12–14; xem spec 5.8 (mục tiêu ≤ 300 MB)',
    );
    process.exit(4);
  }
  if (mb > 300)
    console.warn('⚠ vượt mục tiêu 300 MB (spec 5.8) — ghi DEVLOG, cân nhắc siết bộ lọc');
}
