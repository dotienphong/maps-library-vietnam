#!/usr/bin/env node
// poi active → GeoJSONSeq → tippecanoe → out/<release>.pmtiles (spec 5.8).
// Dùng: node export-tiles.mjs [--release poi-YYYYMMDD] [--sources osm|all]
import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { run } from '../../../scripts/lib/run.mjs';
import { assertPoiArchiveSize } from '../../tiles/src/lib/archive-guard.mjs';
import { poiReleasePair } from '../../tiles/src/lib/dates.mjs';
import { displayFields, priorityOrderSql } from './display-priority.mjs';
import { createDisplaySelector } from './display-selector.mjs';
import { OUT, POI_WORK, arg } from './lib/env.mjs';
import { activePoiWhereSql, poiReleasePrefix } from './lib/poi-filter.mjs';
import { connect } from './pg.mjs';

/**
 * @param {{ id: string, name: string, cat: string, grp: string, lon: number, lat: number }} r
 * @param {{ q: number, r: number, d: number }} display
 * @param {number} minZoom
 */
export function featureLine(r, display, minZoom) {
  return `${JSON.stringify({
    type: 'Feature',
    tippecanoe: { minzoom: minZoom },
    properties: {
      id: r.id,
      name: r.name,
      cat: r.cat,
      grp: r.grp,
      q: display.q,
      r: display.r,
      d: display.d,
    },
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
  })}\n`;
}

if (process.argv[1]?.endsWith('export-tiles.mjs')) {
  const profile = arg('--sources', 'all') ?? 'all';
  const generated = poiReleasePair();
  const prefix = poiReleasePrefix(profile);
  const release =
    arg('--release', undefined) ?? (prefix === 'poi' ? generated.poi : generated.poiOsm);
  mkdirSync(POI_WORK, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  // Mỗi release một file seq: hai profile export liền nhau không ghi đè nhau.
  const seq = resolve(POI_WORK, `${release}.geojsonseq`);
  const output = resolve(OUT, `${release}.pmtiles`);
  const sql = connect();
  const selector = createDisplaySelector();
  let activeRead = 0;
  let rankFallback = 0;
  let invalidCoordinates = 0;
  try {
    async function* lines() {
      const query = `SELECT p.id, p.name, p.category AS cat, c.group_code AS grp,
          c.rank, p.popularity, p.quality_score,
          ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat
        FROM poi p
        JOIN category c ON c.code = p.category
        WHERE ${activePoiWhereSql(profile)}
        ORDER BY ${priorityOrderSql}`;
      for await (const rows of sql.unsafe(query).cursor(5000)) {
        for (const r of rows) {
          activeRead++;
          const row = /** @type {any} */ (r);
          const display = displayFields({
            id: row.id,
            rank: row.rank,
            popularity: row.popularity,
            qualityScore: row.quality_score,
          });
          if (display.rankFallback) rankFallback++;
          let minZoom;
          const lon = Number(row.lon);
          const lat = Number(row.lat);
          try {
            minZoom = selector.select({ lon, lat, earliestZoom: display.earliestZoom });
          } catch (error) {
            invalidCoordinates++;
            console.error(
              `POI ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
            continue;
          }
          if (minZoom !== null) yield featureLine({ ...row, lon, lat }, display, minZoom);
        }
      }
    }
    await pipeline(Readable.from(lines()), createWriteStream(seq));
  } finally {
    await sql.end();
  }
  const selection = selector.snapshot();
  console.log(
    JSON.stringify({
      sources: profile,
      activeRead,
      selected: selection.selected,
      thinned: selection.thinned,
      byMinZoom: selection.byMinZoom,
      rankFallback,
      invalidCoordinates,
    }),
  );
  if (invalidCoordinates > 0) {
    throw new Error(`${invalidCoordinates} POI có toạ độ không hợp lệ; không tạo archive`);
  }
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
    '-y',
    'r',
    '-y',
    'd',
    seq,
  ]);
  const bytes = statSync(output).size;
  const mb = bytes / 2 ** 20;
  console.log(`✓ ${output}: ${selection.selected} POI, ${mb.toFixed(1)} MB`);
  assertPoiArchiveSize(release, bytes);
}
