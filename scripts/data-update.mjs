#!/usr/bin/env node
// Một lệnh cập nhật dữ liệu (spec 5.9). Ngoài container: tự chạy lại trong image pipeline (compose dev).
// Trong container: dò 2 nguồn (OSM, FSQ) → so state R2 → build tiles/POI có điều kiện → QA → upload → manifest
// → routing graph (máy chủ) → manifest → state.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { POI_SOURCE_PROFILES } from '../pipelines/poi/src/lib/poi-filter.mjs';
import { poiReleaseSet, releaseName } from '../pipelines/tiles/src/lib/dates.mjs';
import { hasListedFile } from '../pipelines/tiles/src/lib/manifest-state.mjs';
import { run } from './lib/run.mjs';
import { detectSources } from './lib/sources.mjs';
import { openDatabaseTunnel } from './lib/tunnel.mjs';
import {
  canPatchLai,
  decideWork,
  missingLiveEnv,
  nextState,
  poiReleaseSteps,
  routingStep,
  runPoiReleaseSteps,
  runTileReleaseSteps,
  tileReleaseSteps,
} from './lib/update-plan.mjs';

const argv = process.argv.slice(2);
const flags = {
  force: argv.includes('--force'),
  onlyTiles: argv.includes('--tiles'),
  onlyPoi: argv.includes('--poi'),
  dryRun: argv.includes('--dry-run'),
  skipRouting: argv.includes('--skip-routing'),
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
const GRAPH_DIR = process.env.MAPSLIBVN_VALHALLA ?? '/app/valhalla';
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

const versions = await detectSources();
const state = readState();
const work = decideWork(state, versions, flags);
log(`Phiên bản: OSM md5 ${versions.osm.md5} · FSQ ${versions.fsq.release}`);
log(`Kế hoạch: ${JSON.stringify(work)}`);
if (flags.dryRun || (!work.tiles && !work.poi)) {
  console.log(flags.dryRun ? '(dry-run) dừng.' : 'Không có gì mới. Dừng.');
  process.exit(0);
}

const patched = `${WORK}/vietnam-patched.osm.pbf`;
const PATCH_SCRIPT = 'pipelines/tiles/python/patch_sovereignty.py';
// Patch đọc chung dữ liệu chính sách quần đảo với POI (plan 2026-09-26-quan-dao) → đổi file nào cũng patch lại.
const PATCH_INPUTS = [
  PATCH_SCRIPT,
  'pipelines/poi/data/quan-dao-dao.csv',
  'pipelines/poi/data/quan-dao-ta-giu.json',
];
const patchMark = `${patched}.patch-sha256`;
const ensurePatchedPbf = () => {
  const hash = createHash('sha256');
  for (const file of PATCH_INPUTS) hash.update(readFileSync(file));
  const dauMoi = `${hash.digest('hex')} ${versions.osm.md5}`;
  const dauCu = existsSync(patchMark) ? readFileSync(patchMark, 'utf8').trim() : '';
  if (!canPatchLai({ coFile: existsSync(patched), dauCu, dauMoi })) return;
  // Xoá dấu TRƯỚC khi patch và ghi ra file tạm rồi mới đổi tên: patch chết giữa chừng (OOM, đầy đĩa) không
  // được để lại một PBF cụt đi kèm dấu còn khớp.
  rmSync(patchMark, { force: true });
  run('node', ['pipelines/tiles/src/download.mjs']);
  const tam = `${WORK}/vietnam-patched.part.osm.pbf`;
  run('python', [PATCH_SCRIPT, `${WORK}/data/sources/vietnam.osm.pbf`, tam]);
  renameSync(tam, patched);
  writeFileSync(patchMark, `${dauMoi}\n`);
};

/** @type {{ vn?: string, poi?: string, poiOsm?: string, poiProfiles?: Record<string, string> }} */
const built = {};
const routing = routingStep({
  tiles: work.tiles,
  graphDirExists: existsSync(GRAPH_DIR),
  skipRouting: flags.skipRouting,
});
if (work.tiles) {
  ensurePatchedPbf();
  const release = releaseName('vn');
  runTileReleaseSteps(tileReleaseSteps({ release, routing, out: OUT }), (step) => {
    run(step.command, step.args);
    if (step.id === 'routing-prepare') {
      log('✓ routing graph: đã yêu cầu build lại (docker compose … logs -f valhalla để theo dõi)');
    }
  });
  if (!routing.run) log(`bỏ qua routing graph: ${routing.reason}`);
  built.vn = release;
  log(`✓ tiles ${release}`);
}
if (!work.tiles) {
  log(`bỏ qua routing graph: ${routing.reason}`);
}
if (work.poi) {
  const closeTunnel = await openDatabaseTunnel(log);
  try {
    ensurePatchedPbf();
    // Không migrate ở đây: trên máy chủ role pipeline không phải superuser; server:setup/update quản lý migration.
    run('node', ['pipelines/poi/src/ingest/osm.mjs']);
    run('node', ['pipelines/poi/src/ingest/fsq.mjs', '--release', versions.fsq.release]);
    run('node', ['pipelines/poi/src/taxonomy.mjs', 'load']);
    run('node', ['pipelines/poi/src/records.mjs']);
    run('node', ['pipelines/poi/src/conflate.mjs']);
    run('node', ['pipelines/poi/src/publish.mjs', ...(flags.force ? ['--force'] : [])]);
    run('node', ['pipelines/poi/src/geocode/osm-roads.mjs']);
    run('node', ['pipelines/poi/src/geocode/admin.mjs']);
    run('node', ['pipelines/poi/src/geocode/poi-admin.mjs']);
    run('node', ['pipelines/poi/src/geocode/streets.mjs']);
    run('node', ['pipelines/poi/src/geocode/alleys.mjs']);
    run('node', ['pipelines/poi/src/geocode/anchors.mjs']);
    const profiles = Object.keys(POI_SOURCE_PROFILES);
    const poiReleases = poiReleaseSet(profiles);
    const release = poiReleases.releases.all;
    if (!release) throw new Error('Không tạo được release POI profile all');
    const snapshot = `${WORK}/poi/snapshot-${poiReleases.buildId}.jsonl`;
    run('node', ['pipelines/poi/src/export-snapshot.mjs', '--build-id', poiReleases.buildId]);
    // Manifest là bước commit cuối: mọi export/QA/upload/smoke phải xanh cho mọi profile registry.
    runPoiReleaseSteps(
      poiReleaseSteps({
        releases: poiReleases.releases,
        buildId: poiReleases.buildId,
        snapshot,
        out: OUT,
      }),
      (step) => run(step.command, step.args),
    );
    run('node', ['pipelines/poi/src/report.mjs']);
    run('rclone', ['copy', OUT, `r2:${bucket}/state/reports/`, '--include', 'poi-report-*.json']);
    built.poi = release;
    built.poiProfiles = Object.fromEntries(
      Object.entries(poiReleases.releases).filter(([profile]) => profile !== 'all'),
    );
    if (built.poiProfiles.osm) built.poiOsm = built.poiProfiles.osm;
    log(`✓ POI ${Object.values(poiReleases.releases).join(' + ')}`);
  } finally {
    closeTunnel();
  }
}
writeState(nextState(state, versions, built));
log(
  `✓ data:update xong ${JSON.stringify(built)} — ${Math.round((Date.now() - startedAt) / 60000)} phút`,
);
