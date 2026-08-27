#!/usr/bin/env node
// QA tiles (spec 4.3 tầng 3). Dùng: node qa.mjs <file.pmtiles> [--skip-islands]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { openPmtiles } from './lib/node-source.mjs';
import {
  geometryIntersectsBbox,
  hasIslandFeature,
  lonLatToTile,
  nameViolations,
  tileRange,
} from './lib/qa-rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(resolve(here, '../qa.config.json'), 'utf8'));
const [file, ...flags] = process.argv.slice(2);
if (!file) throw new Error('Dùng: node qa.mjs <file.pmtiles> [--skip-islands]');
const skipIslands = flags.includes('--skip-islands');

const { pmtiles, close } = await openPmtiles(file);
/** @type {string[]} */
const violations = [];
let decoded = 0;

/** @param {number} z @param {number} x @param {number} y */
async function features(z, x, y) {
  const tile = await pmtiles.getZxy(z, x, y);
  if (!tile?.data) return [];
  decoded++;
  const vt = new VectorTile(new Pbf(new Uint8Array(tile.data)));
  /** @type {{ layer: string, props: Record<string, unknown>, geometry: { type: string, coordinates: unknown } }[]} */
  const out = [];
  for (const [layer, l] of Object.entries(vt.layers)) {
    for (let i = 0; i < l.length; i++) {
      const feature = l.feature(i);
      const geometry = /** @type {{ type: string, coordinates: unknown }} */ (
        feature.toGeoJSON(x, y, z).geometry
      );
      out.push({ layer, props: feature.properties, geometry });
    }
  }
  return out;
}

for (const { name, bbox, requireIslands = true, note } of cfg.bboxes) {
  const [zFrom, zTo] = cfg.fullScanZooms;
  let islandSeen = false;
  /** @param {number} z @param {number} x @param {number} y */
  const check = async (z, x, y) => {
    // Chỉ xét đối tượng có hình học giao bbox — tile z4–z7 giao bbox trải tới đất liền và phần đệm nước láng giềng
    const fs = (await features(z, x, y)).filter((f) => geometryIntersectsBbox(f.geometry, bbox));
    for (const f of fs) {
      for (const v of nameViolations(f.props, cfg.forbiddenWords)) {
        violations.push(`${name} z${z}/${x}/${y} ${f.layer}: ${v}`);
      }
    }
    if (z >= 8 && z <= 10 && hasIslandFeature(fs, cfg.islandClasses)) islandSeen = true;
  };
  for (let z = zFrom; z <= zTo; z++) {
    const r = tileRange(bbox, z);
    for (let x = r.xMin; x <= r.xMax; x++)
      for (let y = r.yMin; y <= r.yMax; y++) await check(z, x, y);
  }
  const [pFrom, pTo] = cfg.pointScanZooms;
  for (const [lon, lat] of cfg.islandPoints) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    for (let z = pFrom; z <= pTo; z++) {
      const { x, y } = lonLatToTile(lon, lat, z);
      await check(z, x, y);
    }
  }
  if (!skipIslands && !islandSeen) {
    const msg = `${name}: không thấy đảo có tên tiếng Việt trong lớp place ở z8–10`;
    if (requireIslands) violations.push(msg);
    else console.warn(`CẢNH BÁO (không chặn) — ${msg}. ${note ?? ''}`);
  }
}
await close();

// Kiểm style template có lớp chủ quyền
for (const theme of ['light', 'dark']) {
  const tpl = JSON.parse(
    readFileSync(
      resolve(here, `../../../packages/style/dist/mapslibvn-${theme}.template.json`),
      'utf8',
    ),
  );
  const sov = tpl.layers.find((/** @type {{ id: string }} */ l) => l.id === 'sovereignty-label');
  if (!sov || sov.minzoom !== 4)
    violations.push(`style ${theme}: thiếu lớp sovereignty-label minzoom 4`);
  if (tpl.sources?.sovereignty?.data?.features?.length !== 2) {
    violations.push(`style ${theme}: nguồn sovereignty phải có 2 nhãn`);
  }
}

console.log(`QA: giải mã ${decoded} tile`);
if (violations.length) {
  console.error(`QA THẤT BẠI — ${violations.length} vi phạm:`);
  for (const v of violations) console.error(' -', v);
  process.exit(1);
}
console.log('✓ QA chủ quyền và style đạt');
