#!/usr/bin/env node
// Nạp fixture Quận 1 vào R2 local + manifest vào KV local cho wrangler dev / E2E
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const fixture = resolve('../../pipelines/tiles/fixtures/q1.pmtiles');
const release = 'q1-fixture';
const w = (args) => execFileSync('pnpm', ['exec', 'wrangler', ...args], { stdio: 'inherit' });
w([
  'r2',
  'object',
  'put',
  `mapslibvn-tiles/tiles/${release}.pmtiles`,
  '--file',
  fixture,
  '--local',
]);
w([
  'kv',
  'key',
  'put',
  'release:current',
  JSON.stringify({ vn: release, poi: null }),
  '--binding',
  'META',
  '--local',
]);
console.log('✓ seed local: R2 + KV');
