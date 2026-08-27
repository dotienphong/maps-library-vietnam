#!/usr/bin/env node
// pnpm image:build | pnpm image:smoke — build và kiểm tra image pipeline
import { run } from './lib/run.mjs';

const IMAGE = process.env.PIPELINE_IMAGE ?? 'mapslibvn/pipeline:local';
const SMOKE = [
  'planetiler --help | head -1',
  'tippecanoe -v 2>&1 | head -1',
  'duckdb --version',
  'osmium --version | head -1',
  "python -c \"from importlib.metadata import version; print('pyosmium', version('osmium'))\"",
  'rclone version | head -1',
  'pg_dump --version',
  'zstd --version | head -1',
  'cloudflared --version',
  'node --version',
  'pnpm --version',
].join(' && ');

const command = process.argv[2];
if (command === 'build') {
  run('docker', ['build', '-f', 'pipelines/Dockerfile', '-t', IMAGE, '.']);
} else if (command === 'smoke') {
  run('docker', ['run', '--rm', IMAGE, 'sh', '-c', SMOKE]);
  console.log(`\n✔ Image ${IMAGE} có đủ công cụ.`);
} else {
  console.error('Dùng: node scripts/image.mjs build|smoke');
  process.exit(2);
}
