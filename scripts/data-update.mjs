#!/usr/bin/env node
// Một lệnh cập nhật dữ liệu (spec 5.9). Ngoài container: tự chạy lại trong image pipeline (compose dev).
// Trong container: dò 3 nguồn → so state R2 → build tiles/POI có điều kiện → QA → upload → manifest → state.
import 'dotenv/config';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { releaseName } from '../pipelines/tiles/src/lib/dates.mjs';
import { hasListedFile } from '../pipelines/tiles/src/lib/manifest-state.mjs';
import { run, sleep } from './lib/run.mjs';
import { detectSources } from './lib/sources.mjs';
import { decideWork, missingLiveEnv, nextState } from './lib/update-plan.mjs';

const argv = process.argv.slice(2);
const flags = {
  force: argv.includes('--force'),
  onlyTiles: argv.includes('--tiles'),
  onlyPoi: argv.includes('--poi'),
  dryRun: argv.includes('--dry-run'),
};
if (flags.onlyTiles && flags.onlyPoi) {
  throw new Error('Chỉ dùng một trong --tiles hoặc --poi');
}
const missingEnv = missingLiveEnv(process.env, flags);
if (missingEnv.length > 0) {
  throw new Error(
    `Thiếu credentials cho lần chạy live: ${missingEnv.join(', ')}. Điền vào .env / infra/server/.env; không gửi secret qua chat.`,
  );
}
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
    'scripts/data-update.mjs',
    ...argv,
  ]);
  process.exit(0);
}

const startedAt = Date.now();
const log = (/** @type {string} */ message) =>
  console.log(`[${Math.round((Date.now() - startedAt) / 1000)}s] ${message}`);
const WORK = process.env.MAPSLIBVN_WORK ?? '/app/work';
const OUT = process.env.MAPSLIBVN_OUT ?? '/app/out';
const bucket = process.env.R2_BUCKET ?? 'mapslibvn-tiles';
const stateKey = `r2:${bucket}/state/releases.json`;
/** @param {string[]} args */
const rcloneText = (args) =>
  execFileSync('rclone', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
// Không nuốt lỗi rclone: credential sai phải dừng, không được coi state là rỗng rồi rebuild toàn bộ.
const readState = () => {
  const listed = rcloneText(['lsf', `r2:${bucket}/state`, '--files-only']);
  if (!hasListedFile(listed, 'releases.json')) return {};
  return JSON.parse(rcloneText(['cat', stateKey]));
};
/** @param {unknown} state */
const writeState = (state) =>
  execFileSync('rclone', ['rcat', stateKey], {
    input: JSON.stringify(state, null, 2),
  });

// DB qua Cloudflare Tunnel khi chạy ngoài máy chủ (spec 5.9 "cloudflared access tcp").
if (process.env.DB_TUNNEL_HOSTNAME && process.env.PIPELINE_DATABASE_URL) {
  const child = spawn(
    'cloudflared',
    [
      'access',
      'tcp',
      '--hostname',
      process.env.DB_TUNNEL_HOSTNAME,
      '--url',
      '127.0.0.1:5433',
      '--service-token-id',
      process.env.CF_ACCESS_CLIENT_ID ?? '',
      '--service-token-secret',
      process.env.CF_ACCESS_CLIENT_SECRET ?? '',
    ],
    { stdio: 'inherit' },
  );
  child.unref();
  for (let attempt = 0; attempt < 30; attempt++) {
    const ok = await new Promise((resolveReady) => {
      const socket = createConnection(5433, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        resolveReady(true);
      });
      socket.once('error', () => resolveReady(false));
    });
    if (ok) break;
    await sleep(1000);
  }
  process.env.DATABASE_URL = process.env.PIPELINE_DATABASE_URL;
  log(`DB qua Tunnel ${process.env.DB_TUNNEL_HOSTNAME}`);
}

const versions = await detectSources();
const state = readState();
const work = decideWork(state, versions, flags);
log(
  `Phiên bản: OSM md5 ${versions.osm.md5} · Overture ${versions.overture.release} · FSQ ${versions.fsq.release}`,
);
log(`Kế hoạch: ${JSON.stringify(work)}`);
if (flags.dryRun || (!work.tiles && !work.poi)) {
  console.log(flags.dryRun ? '(dry-run) dừng.' : 'Không có gì mới. Dừng.');
  process.exit(0);
}

const osmChanged = !state.osm || state.osm.md5 !== versions.osm.md5;
const patched = `${WORK}/vietnam-patched.osm.pbf`;
const ensurePatchedPbf = () => {
  if (existsSync(patched) && !osmChanged) return;
  run('node', ['pipelines/tiles/src/download.mjs']);
  run('python', [
    'pipelines/tiles/python/patch_sovereignty.py',
    `${WORK}/data/sources/vietnam.osm.pbf`,
    patched,
  ]);
};

/** @type {{ vn?: string, poi?: string }} */
const built = {};
if (work.tiles) {
  ensurePatchedPbf();
  const release = releaseName('vn');
  run('node', ['pipelines/tiles/src/build.mjs', '--release', release]);
  run('node', ['pipelines/tiles/src/qa.mjs', `${OUT}/${release}.pmtiles`]);
  run('node', ['pipelines/tiles/src/upload.mjs', release]);
  run('node', ['pipelines/tiles/src/smoke.mjs', release]);
  run('node', ['pipelines/tiles/src/manifest.mjs', 'set', '--vn', release]);
  built.vn = release;
  log(`✓ tiles ${release}`);
}
if (work.poi) {
  ensurePatchedPbf();
  // Không migrate ở đây: trên máy chủ role pipeline không phải superuser; server:setup/update quản lý migration.
  run('node', ['pipelines/poi/src/ingest/osm.mjs']);
  run('node', ['pipelines/poi/src/ingest/overture.mjs', '--release', versions.overture.release]);
  run('node', ['pipelines/poi/src/ingest/fsq.mjs', '--release', versions.fsq.release]);
  run('node', ['pipelines/poi/src/taxonomy.mjs', 'load']);
  run('node', ['pipelines/poi/src/records.mjs']);
  run('node', ['pipelines/poi/src/conflate.mjs']);
  run('node', ['pipelines/poi/src/publish.mjs', ...(flags.force ? ['--force'] : [])]);
  run('node', ['pipelines/poi/src/geocode/osm-roads.mjs']);
  run('node', ['pipelines/poi/src/geocode/admin.mjs']);
  run('node', ['pipelines/poi/src/geocode/streets.mjs']);
  run('node', ['pipelines/poi/src/geocode/alleys.mjs']);
  run('node', ['pipelines/poi/src/geocode/anchors.mjs']);
  const release = releaseName('poi');
  run('node', ['pipelines/poi/src/export-tiles.mjs', '--release', release]);
  run('node', ['pipelines/tiles/src/qa.mjs', `${OUT}/${release}.pmtiles`, '--skip-islands']);
  run('node', ['pipelines/tiles/src/upload.mjs', release]);
  run('node', ['pipelines/tiles/src/smoke.mjs', release, '--set', 'poi']);
  run('node', ['pipelines/tiles/src/manifest.mjs', 'set', '--poi', release]);
  run('node', ['pipelines/poi/src/report.mjs']);
  run('rclone', ['copy', OUT, `r2:${bucket}/state/reports/`, '--include', 'poi-report-*.json']);
  built.poi = release;
  log(`✓ POI ${release}`);
}
writeState(nextState(state, versions, built));
log(
  `✓ data:update xong ${JSON.stringify(built)} — ${Math.round((Date.now() - startedAt) / 60000)} phút`,
);
