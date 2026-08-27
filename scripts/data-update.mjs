#!/usr/bin/env node
// Một lệnh cập nhật dữ liệu. Ngoài container, tự chạy lại trong image pipeline.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { releaseName } from '../pipelines/tiles/src/lib/dates.mjs';
import { hasListedFile } from '../pipelines/tiles/src/lib/manifest-state.mjs';
import { run } from './lib/run.mjs';
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
if (flags.onlyPoi) {
  throw new Error('Pipeline POI chưa có ở M1; --poi sẽ được bổ sung ở M2');
}

const missingEnv = missingLiveEnv(process.env, flags);
if (missingEnv.length > 0) {
  throw new Error(
    `Thiếu credentials cho lần chạy live: ${missingEnv.join(', ')}. Điền trực tiếp vào .env; không gửi secret qua chat.`,
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

const bucket = process.env.R2_BUCKET ?? 'mapslibvn-tiles';
const stateKey = `r2:${bucket}/state/releases.json`;
/** @param {string[]} args */
const rcloneText = (args) =>
  execFileSync('rclone', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
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

const pbfUrl = 'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf';
const head = await fetch(pbfUrl, { method: 'HEAD' });
if (!head.ok) throw new Error(`HEAD Geofabrik thất bại: HTTP ${head.status}`);
const md5Response = await fetch(`${pbfUrl}.md5`);
if (!md5Response.ok) {
  throw new Error(`MD5 Geofabrik thất bại: HTTP ${md5Response.status}`);
}
const md5 = (await md5Response.text()).trim().split(/\s+/, 1)[0] ?? '';
if (!/^[a-f\d]{32}$/i.test(md5)) throw new Error(`MD5 Geofabrik không hợp lệ: ${md5}`);

const versions = {
  osm: {
    lastModified: head.headers.get('last-modified') ?? '',
    md5,
  },
};
const state = readState();
const work = decideWork(state, versions, flags);
console.log('Kế hoạch:', JSON.stringify(work));
if (flags.dryRun || (!work.tiles && !work.poi)) {
  console.log(flags.dryRun ? '(dry-run) dừng.' : 'Không có gì mới. Dừng.');
  process.exit(0);
}

const built = {};
if (work.tiles) {
  run('node', ['pipelines/tiles/src/download.mjs']);
  run('python', [
    'pipelines/tiles/python/patch_sovereignty.py',
    '/app/work/data/sources/vietnam.osm.pbf',
    '/app/work/vietnam-patched.osm.pbf',
  ]);
  const release = releaseName('vn');
  run('node', ['pipelines/tiles/src/build.mjs', '--release', release]);
  run('node', ['pipelines/tiles/src/qa.mjs', `/app/out/${release}.pmtiles`]);
  run('node', ['pipelines/tiles/src/upload.mjs', release]);
  run('node', ['pipelines/tiles/src/smoke.mjs', release]);
  run('node', ['pipelines/tiles/src/manifest.mjs', 'set', '--vn', release]);
  built.vn = release;
}
if (work.poi) {
  console.log('POI: chưa có pipeline ở M1 — bỏ qua (thêm ở M2).');
}

writeState(nextState(state, versions, built));
console.log('✓ data:update xong', JSON.stringify(built));
