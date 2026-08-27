#!/usr/bin/env node
// Build tiles Việt Nam bằng Planetiler. Dùng: node build.mjs [--release vn-YYYYMMDD].
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { releaseName } from './lib/dates.mjs';
import { OUT, PATCHED_PBF, WORK } from './lib/env.mjs';

const args = process.argv.slice(2);
const releaseIndex = args.indexOf('--release');
const release = releaseIndex >= 0 ? args[releaseIndex + 1] : releaseName('vn');
if (!release) throw new Error('Thiếu giá trị sau --release');
if (!/^vn-\d{8}$/.test(release)) throw new Error(`Tên release không hợp lệ: ${release}`);
if (!existsSync(PATCHED_PBF)) {
  throw new Error(`Thiếu ${PATCHED_PBF} — chạy download.mjs và patch_sovereignty.py trước`);
}

mkdirSync(OUT, { recursive: true });
const output = resolve(OUT, `${release}.pmtiles`);

run(
  'planetiler',
  [
    `--osm-path=${PATCHED_PBF}`,
    '--download',
    '--area=vietnam',
    '--bounds=-180,-85.0511,180,85.0511',
    '--languages=vi,en',
    '--maxzoom=14',
    '--nodemap-type=sparsearray',
    '--storage=mmap',
    '--compress-temp',
    '--force',
    `--output=${output}`,
  ],
  {
    cwd: WORK,
    env: { ...process.env, JAVA_OPTS: process.env.JAVA_OPTS ?? '-Xmx4g' },
  },
);

console.log(`✓ ${output}`);
