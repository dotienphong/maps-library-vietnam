#!/usr/bin/env node
// Publish MỘT archive profile nguồn POI từ dữ liệu đã có trong Postgres (spec 07/09 mục 5).
// Chỉ ĐỌC bảng poi; không ingest, không đụng archive `all`. Dùng khi thêm profile mới giữa hai
// lần `pnpm data:update --poi`.
// Dùng: pnpm poi:profile --profile osm [--release poi-osm-YYYYMMDD] [--dry-run]
// Ngoài container: tự chạy lại trong image pipeline (cần tippecanoe, rclone, cloudflared).
import 'dotenv/config';
import { poiReleasePrefix } from '../pipelines/poi/src/lib/poi-filter.mjs';
import { poiReleasePair } from '../pipelines/tiles/src/lib/dates.mjs';
import { profilePublishSteps } from './lib/poi-profile.mjs';
import { run } from './lib/run.mjs';
import { openDatabaseTunnel } from './lib/tunnel.mjs';

const argv = process.argv.slice(2);
/** @param {string} flag */
const arg = (flag) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
};
const profile = arg('--profile');
const dryRun = argv.includes('--dry-run');
if (!profile) throw new Error('Dùng: poi-profile-publish.mjs --profile <osm> [--release <name>]');

const compose = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infra/dev/compose.yml',
  '--profile',
  'pipeline',
];
if (process.env.MAPSLIBVN_IN_CONTAINER !== '1') {
  run('docker', [...compose, 'build', 'pipeline']);
  run('docker', [
    ...compose,
    'run',
    '--rm',
    'pipeline',
    'node',
    'scripts/poi-profile-publish.mjs',
    ...argv,
  ]);
  process.exit(0);
}

const OUT = process.env.MAPSLIBVN_OUT ?? '/app/out';
const generated = poiReleasePair();
const prefix = poiReleasePrefix(profile);
const release = arg('--release') ?? (prefix === 'poi' ? generated.poi : generated.poiOsm);
const steps = profilePublishSteps(profile, release, OUT);

const missing = ['TILES_BASE', 'R2_BUCKET', 'KV_NAMESPACE_ID_META', 'CLOUDFLARE_API_TOKEN'].filter(
  (name) => !process.env[name]?.trim(),
);
if (missing.length > 0 && !dryRun) {
  throw new Error(`Thiếu credentials: ${missing.join(', ')}`);
}

const startedAt = Date.now();
const log = (/** @type {string} */ message) =>
  console.log(`[${Math.round((Date.now() - startedAt) / 1000)}s] ${message}`);
log(`profile ${profile} → ${release}`);
if (dryRun) {
  for (const step of steps) console.log(`  ${step.label}: node ${step.args.join(' ')}`);
  process.exit(0);
}

const closeTunnel = await openDatabaseTunnel(log);
try {
  for (const step of steps) {
    log(`▶ ${step.label}`);
    run('node', step.args);
  }
} finally {
  closeTunnel();
}
log(`✓ publish ${release} xong`);
