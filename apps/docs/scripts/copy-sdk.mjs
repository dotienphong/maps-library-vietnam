#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('../../packages/web/dist');
const dst = resolve('public/sdk');
mkdirSync(dst, { recursive: true });
for (const f of [
  'mapslibvn.umd.js',
  'mapslibvn.umd.js.map',
  'mapslibvn.css',
  'maplibre-gl-worker.mjs',
  'maplibre-gl-shared.mjs',
]) {
  if (!existsSync(resolve(src, f)))
    throw new Error(`Thiếu ${f} — chạy pnpm --filter @mapslibvn/web build trước`);
  copyFileSync(resolve(src, f), resolve(dst, f));
}
// Fixture tuyến Quận 1 cho demo dẫn đường và E2E (spec B mục 7.0) — một nguồn, không chép tay.
const fixtureSrc = resolve('../../packages/core/tests/fixtures/directions-q1.json');
const fixtureDst = resolve('public/fixtures');
if (!existsSync(fixtureSrc))
  throw new Error('Thiếu directions-q1.json — chạy test apps/api routing-fixture-sync trước');
mkdirSync(fixtureDst, { recursive: true });
copyFileSync(fixtureSrc, resolve(fixtureDst, 'directions-q1.json'));

console.log('✓ copy SDK vào public/sdk');
