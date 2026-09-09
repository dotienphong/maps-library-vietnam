#!/usr/bin/env node
// Publish một hoặc nhiều archive profile nguồn POI từ dữ liệu đã có trong Postgres.
// Chỉ ĐỌC bảng poi; không ingest, không đụng archive `all`. Dùng khi thêm profile mới giữa hai
// lần `pnpm data:update --poi`.
// Dùng: pnpm poi:profile --profile osm [--release poi-osm-YYYYMMDD] [--dry-run]
//   hoặc pnpm poi:profile --profiles osm-fsq,overture-fsq [--dry-run]
// Ngoài container: tự chạy lại trong image pipeline (cần tippecanoe, rclone, cloudflared).
import 'dotenv/config';
import { poiReleasePrefix } from '../pipelines/poi/src/lib/poi-filter.mjs';
import { poiReleaseSet } from '../pipelines/tiles/src/lib/dates.mjs';
import {
  missingProfileEnv,
  profileBatchSteps,
  profilePublishSteps,
  runProfileBatchSteps,
} from './lib/poi-profile.mjs';
import { run } from './lib/run.mjs';
import { openDatabaseTunnel } from './lib/tunnel.mjs';

const argv = process.argv.slice(2);
/** @param {string} flag */
const arg = (flag) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
};
const profile = arg('--profile');
const profilesRaw = arg('--profiles');
const dryRun = argv.includes('--dry-run');
if (Boolean(profile) === Boolean(profilesRaw)) {
  throw new Error('Dùng đúng một trong --profile <name> hoặc --profiles <name,name>');
}
const profiles = profilesRaw
  ?.split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const compose = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infra/dev/compose.yml',
  '--profile',
  'pipeline',
];
if (process.env.MAPSLIBVN_IN_CONTAINER !== '1' && !dryRun) {
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
const WORK = process.env.MAPSLIBVN_WORK ?? '/app/work';
const releaseSet = poiReleaseSet(profiles ?? [/** @type {string} */ (profile)]);
const singleProfile = profile;
const singleRelease = singleProfile
  ? (arg('--release') ?? releaseSet.releases[singleProfile])
  : undefined;
if (singleProfile && !singleRelease) throw new Error(`Không tạo được release cho ${singleProfile}`);
const snapshot = `${WORK}/poi/snapshot-${releaseSet.buildId}.jsonl`;
const batchSteps = profiles
  ? profileBatchSteps({
      profiles,
      releases: releaseSet.releases,
      buildId: releaseSet.buildId,
      snapshot,
      out: OUT,
    })
  : null;
const singleSteps = singleProfile
  ? profilePublishSteps(
      /** @type {string} */ (singleProfile),
      /** @type {string} */ (singleRelease),
      OUT,
    )
  : null;

const missing = missingProfileEnv(process.env);
if (missing.length > 0 && !dryRun) {
  throw new Error(`Thiếu credentials: ${missing.join(', ')}`);
}

const startedAt = Date.now();
const log = (/** @type {string} */ message) =>
  console.log(`[${Math.round((Date.now() - startedAt) / 1000)}s] ${message}`);
log(
  profiles
    ? `profiles ${profiles.join(',')} → build ${releaseSet.buildId}`
    : `profile ${singleProfile} → ${singleRelease}`,
);
if (dryRun) {
  if (profiles) console.log(`  snapshot: ${snapshot}`);
  for (const step of batchSteps ?? singleSteps ?? [])
    console.log(`  ${'id' in step ? step.id : step.label}: node ${step.args.join(' ')}`);
  process.exit(0);
}

const closeTunnel = await openDatabaseTunnel(log);
try {
  if (batchSteps) {
    run('node', ['pipelines/poi/src/export-snapshot.mjs', '--build-id', releaseSet.buildId]);
    runProfileBatchSteps(batchSteps, (step) => {
      log(`▶ ${step.id}`);
      run(step.command, step.args);
    });
  } else if (singleSteps) {
    for (const step of singleSteps) {
      log(`▶ ${step.label}`);
      run('node', step.args);
    }
  }
} finally {
  closeTunnel();
}
log(`✓ publish ${profiles?.join(',') ?? singleRelease} xong`);
