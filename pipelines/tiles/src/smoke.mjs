#!/usr/bin/env node
// Dùng: node smoke.mjs <release> [--set vn|poi] — đọc 20 tile qua đúng URL HTTP của client.
import { FetchSource, PMTiles } from 'pmtiles';
import { requireEnv } from './lib/env.mjs';
import { lonLatToTile } from './lib/qa-rules.mjs';

const argv = process.argv.slice(2);
const release = argv[0];
if (!release) throw new Error('Dùng: node smoke.mjs <release> [--set vn|poi]');
const set = argv.includes('--set') ? argv[argv.indexOf('--set') + 1] : 'vn';
const expectMaxZoom = set === 'poi' ? 16 : 14;
const zooms = set === 'poi' ? [12, 14, 15, 16] : [10, 12, 13, 14];

const base = requireEnv('TILES_BASE').replace(/\/$/, '');
const url = `${base}/tiles/${release}.pmtiles`;
const archive = new PMTiles(new FetchSource(url));
const header = await archive.getHeader();
if (header.maxZoom !== expectMaxZoom) {
  throw new Error(`maxZoom lạ: ${header.maxZoom} (mong ${expectMaxZoom})`);
}

/** @type {[number, number][]} */
const centers = [
  [106.7, 10.77],
  [105.85, 21.03],
  [108.2, 16.05],
  [106.35, 9.99],
  [109.19, 12.24],
];
let ok = 0;
let empty = 0;
for (const [lon, lat] of centers) {
  for (const z of zooms) {
    const { x, y } = lonLatToTile(lon, lat, z);
    const tile = await archive.getZxy(z, x, y);
    if (!tile?.data?.byteLength) {
      // Tiles nền phải phủ kín; POI thưa theo luật mật độ 5.8 nên cho phép tile trống.
      if (set === 'vn') throw new Error(`tile trống z${z}/${x}/${y} tại ${lon},${lat}`);
      empty++;
      continue;
    }
    ok++;
  }
}
if (set === 'poi' && ok < 15) {
  throw new Error(`POI tiles: chỉ ${ok}/20 tile có dữ liệu tại trung tâm 5 thành phố`);
}

console.log(`✓ smoke ${ok} tile (${empty} trống) từ ${url}`);
