#!/usr/bin/env node
// Nạp fixture Quận 1 vào R2 local + manifest vào KV local cho wrangler dev / E2E
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOCAL_STYLE_OBJECTS } from './seed-local-assets.mjs';

const fixture = resolve('../../pipelines/tiles/fixtures/q1.pmtiles');
const release = 'q1-fixture';
const poiFixture = process.env.MAPSLIBVN_POI_FIXTURE;
const poiRelease = poiFixture ? 'poi-local-candidate' : (process.env.MAPSLIBVN_POI_RELEASE ?? null);
const vnRelease = process.env.MAPSLIBVN_VN_RELEASE ?? release;
const resolvedPoiFixture = poiFixture ? resolve(poiFixture) : null;
if (resolvedPoiFixture && !existsSync(resolvedPoiFixture)) {
  throw new Error(`Không tìm thấy MAPSLIBVN_POI_FIXTURE: ${resolvedPoiFixture}`);
}
const w = (args) => execFileSync('pnpm', ['exec', 'wrangler', ...args], { stdio: 'inherit' });
if (!process.env.MAPSLIBVN_VN_RELEASE) {
  w([
    'r2',
    'object',
    'put',
    `mapslibvn-tiles/tiles/${release}.pmtiles`,
    '--file',
    fixture,
    '--local',
  ]);
}
for (const key of LOCAL_STYLE_OBJECTS) {
  w([
    'r2',
    'object',
    'put',
    `mapslibvn-tiles/${key}`,
    '--file',
    resolve(`../../packages/style/${key}`),
    '--local',
  ]);
}
if (resolvedPoiFixture) {
  w([
    'r2',
    'object',
    'put',
    `mapslibvn-tiles/tiles/${poiRelease}.pmtiles`,
    '--file',
    resolvedPoiFixture,
    '--local',
  ]);
}
w([
  'kv',
  'key',
  'put',
  'release:current',
  JSON.stringify({ vn: vnRelease, poi: poiRelease }),
  '--binding',
  'META',
  '--local',
]);
console.log(`✓ seed local: vn=${vnRelease}, poi=${poiRelease ?? 'none'}`);
