#!/usr/bin/env node
// Dùng: node smoke.mjs <release> — đọc 20 tile qua đúng URL HTTP của client.
import { FetchSource, PMTiles } from 'pmtiles';
import { requireEnv } from './lib/env.mjs';
import { lonLatToTile } from './lib/qa-rules.mjs';

const release = process.argv[2];
if (!release) throw new Error('Dùng: node smoke.mjs <release>');

const base = requireEnv('TILES_BASE').replace(/\/$/, '');
const url = `${base}/tiles/${release}.pmtiles`;
const archive = new PMTiles(new FetchSource(url));
const header = await archive.getHeader();
if (header.maxZoom !== 14) throw new Error(`maxZoom lạ: ${header.maxZoom}`);

/** @type {[number, number][]} */
const centers = [
  [106.7, 10.77],
  [105.85, 21.03],
  [108.2, 16.05],
  [106.35, 9.99],
  [109.19, 12.24],
];
let ok = 0;
for (const [lon, lat] of centers) {
  for (const z of [10, 12, 13, 14]) {
    const { x, y } = lonLatToTile(lon, lat, z);
    const tile = await archive.getZxy(z, x, y);
    if (!tile?.data?.byteLength) {
      throw new Error(`tile trống z${z}/${x}/${y} tại ${lon},${lat}`);
    }
    ok++;
  }
}

console.log(`✓ smoke ${ok} tile từ ${url}`);
