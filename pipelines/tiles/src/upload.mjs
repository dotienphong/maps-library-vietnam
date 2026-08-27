#!/usr/bin/env node
// Dùng: node upload.mjs <release> — đẩy PMTiles và assets bất biến lên R2.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { OUT, requireEnv } from './lib/env.mjs';

const release = process.argv[2];
if (!release) throw new Error('Dùng: node upload.mjs <release>');

const bucket = requireEnv('R2_BUCKET');
requireEnv('RCLONE_CONFIG_R2_ACCESS_KEY_ID');
requireEnv('RCLONE_CONFIG_R2_SECRET_ACCESS_KEY');
requireEnv('RCLONE_CONFIG_R2_ENDPOINT');
requireEnv('RCLONE_CONFIG_R2_NO_CHECK_BUCKET');

const file = resolve(OUT, `${release}.pmtiles`);
if (!existsSync(file)) throw new Error(`Không thấy ${file}`);

run('rclone', [
  'copyto',
  file,
  `r2:${bucket}/tiles/${release}.pmtiles`,
  '--s3-chunk-size',
  '64M',
  '--s3-upload-concurrency',
  '8',
  '--progress',
]);

const assets = resolve('packages/style/assets');
if (!existsSync(resolve(assets, 'fonts/Noto Sans Regular/0-255.pbf'))) {
  run('node', ['packages/style/scripts/vendor.mjs', 'fonts']);
}
run('rclone', [
  'copy',
  assets,
  `r2:${bucket}/assets`,
  '--checksum',
  '--header-upload',
  'Cache-Control: public, max-age=31536000, immutable',
]);

console.log(`✓ upload ${release} + assets`);
