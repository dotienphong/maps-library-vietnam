#!/usr/bin/env node
// Test tích hợp chỉ đường (spec dẫn đường A mục 7.3): Valhalla trên fixture Quận 1 → wrangler dev với
// ROUTING_BASE trỏ container → khoá test trong KV local → vitest apps/api/test-routing/*.rtest.mjs.
//   pnpm test:routing              máy dev: tự dựng container (compose dev, profile routing); giữ container
//                                  sau khi chạy để lần sau nhanh; thêm --down để dừng.
//   node scripts/routing-test.mjs --no-compose     CI: VALHALLA_BASE trỏ container đã chạy.
//   node scripts/routing-test.mjs --capture        ghi ba fixture q1-motorbike.json, q1-matrix.json, q1-optimized.json
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import crossSpawn from 'cross-spawn';
import {
  assertPortAvailable,
  createProcessStopper,
  createRoutingCleanup,
  parseRoutingTestArgs,
  shouldStopAttemptedValhalla,
  TEST_KEY,
  testAuthInfo,
  waitForOk,
  waitForProcessOk,
} from './lib/routing-test.mjs';
import { run } from './lib/run.mjs';

const opts = parseRoutingTestArgs(process.argv.slice(2), process.env);
const FIXTURE_PBF = resolve('pipelines/poi/fixtures/q1.osm.pbf');
const DEV_DIR = resolve(process.env.MAPSLIBVN_VALHALLA_DEV ?? 'work/valhalla-dev');
const compose = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infra/dev/compose.yml',
  '--profile',
  'routing',
];
const log = (/** @type {string} */ message) => console.log(`[routing-test] ${message}`);
const runEnvironment = `routing-test-${randomUUID()}`;

const detached = process.platform !== 'win32';
let valhallaStartAttempted = false;
let stopWrangler = async () => {};
const cleanup = createRoutingCleanup({
  stopWrangler: () => stopWrangler(),
  stopValhalla: async () => {
    if (shouldStopAttemptedValhalla(opts, valhallaStartAttempted)) {
      run('docker', [...compose, 'stop', 'valhalla']);
    }
  },
});
let terminating = false;
const terminate = (/** @type {number} */ status) => {
  if (terminating) return;
  terminating = true;
  void cleanup()
    .catch(/** @param {unknown} error */ (error) => console.error(error))
    .finally(() => process.exit(status));
};
process.once('SIGINT', () => terminate(130));
process.once('SIGTERM', () => terminate(143));

let status = 1;
/** @type {unknown} */
let runError;
/** @type {unknown} */
let cleanupFailure;
try {
  if (opts.compose) {
    mkdirSync(DEV_DIR, { recursive: true });
    if (!existsSync(resolve(DEV_DIR, 'valhalla_tiles.tar'))) {
      copyFileSync(FIXTURE_PBF, resolve(DEV_DIR, 'q1.osm.pbf'));
      log(`chép fixture Quận 1 vào ${DEV_DIR} — lần đầu Valhalla build graph vài phút`);
    }
    valhallaStartAttempted = true;
    run('docker', [...compose, 'up', '-d', 'valhalla'], {
      env: { ...process.env, MAPSLIBVN_VALHALLA_DEV: DEV_DIR },
    });
  }
  await waitForOk(`${opts.valhallaBase}/status`, 15 * 60_000, {
    onTick: (ms) => log(`chờ Valhalla /status… ${Math.round(ms / 1000)}s`),
  });
  log(`Valhalla sẵn sàng tại ${opts.valhallaBase}`);

  if (opts.capture) {
    const point = (/** @type {number} */ lat, /** @type {number} */ lon) => ({ lat, lon });
    const stop = (/** @type {number} */ lat, /** @type {number} */ lon) => ({
      lat,
      lon,
      type: 'break',
    });
    const options = { language: 'vi-VN', units: 'kilometers' };
    // Bốn điểm Quận 1: Nhà thờ Đức Bà, Bến Thành, Nhà hát TP, Bitexco.
    const captures = [
      {
        path: '/route',
        file: 'q1-motorbike.json',
        body: {
          locations: [stop(10.7798, 106.699), stop(10.7725, 106.698)],
          costing: 'motor_scooter',
          directions_options: options,
          id: 'capture-q1-motorbike',
        },
      },
      {
        path: '/sources_to_targets',
        file: 'q1-matrix.json',
        body: {
          sources: [point(10.7798, 106.699), point(10.7725, 106.698)],
          targets: [point(10.7769, 106.7032), point(10.7716, 106.7043)],
          costing: 'motor_scooter',
          units: 'kilometers',
          id: 'capture-q1-matrix',
        },
      },
      {
        path: '/optimized_route',
        file: 'q1-optimized.json',
        body: {
          locations: [
            stop(10.7798, 106.699),
            stop(10.7716, 106.7043),
            stop(10.7769, 106.7032),
            stop(10.7725, 106.698),
          ],
          costing: 'motor_scooter',
          directions_options: options,
          id: 'capture-q1-optimized',
        },
      },
    ];
    for (const { path, file, body } of captures) {
      const response = await fetch(`${opts.valhallaBase}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`capture ${path}: Valhalla trả ${response.status}`);
      const target = resolve(`apps/api/test/fixtures/valhalla/${file}`);
      writeFileSync(target, `${JSON.stringify(await response.json(), null, 2)}\n`);
      log(`đã ghi ${target}`);
    }
  }

  // wrangler.toml khai báo [assets] trỏ apps/admin/dist — thiếu thì wrangler dev không lên.
  if (!existsSync('apps/admin/dist/admin/index.html')) {
    run('pnpm', ['--filter', '@mapslibvn/admin', 'build']);
  }
  // Cache local của wrangler sống qua nhiều phiên (bài học api-db-test 07/09/2026): xoá để tuyến không
  // bị trả từ bản cache của lần chạy trước.
  rmSync('apps/api/.wrangler/state/v3/cache', { recursive: true, force: true });
  const keyHash = createHash('sha256').update(TEST_KEY, 'utf8').digest('hex');
  run('pnpm', [
    '--filter',
    '@mapslibvn/api',
    'exec',
    'wrangler',
    'kv',
    'key',
    'put',
    `apikey:${keyHash}`,
    JSON.stringify(testAuthInfo(keyHash)),
    '--binding',
    'META',
    '--local',
  ]);

  await assertPortAvailable(opts.apiPort);
  const wrangler = crossSpawn(
    'pnpm',
    [
      '--filter',
      '@mapslibvn/api',
      'exec',
      'wrangler',
      'dev',
      '--port',
      String(opts.apiPort),
      '--var',
      `ROUTING_BASE:${opts.valhallaBase}`,
      '--var',
      `ENVIRONMENT:${runEnvironment}`,
    ],
    { stdio: 'inherit', detached },
  );
  stopWrangler = createProcessStopper(wrangler);
  /** @type {Error | undefined} */
  let spawnError;
  wrangler.once('error', (/** @type {Error} */ error) => {
    spawnError = error;
  });
  await waitForProcessOk(`http://127.0.0.1:${opts.apiPort}/healthz`, wrangler, 90_000, {
    expectedEnvironment: runEnvironment,
    getError: () => spawnError,
  });
  const result = crossSpawn.sync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'apps/api/vitest.routing.config.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        ROUTING_API_BASE: `http://127.0.0.1:${opts.apiPort}`,
        ROUTING_API_KEY: TEST_KEY,
      },
    },
  );
  status = result.status ?? 1;
} catch (error) {
  runError = error;
  throw error;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    if (runError) console.error('routing cleanup failed after test failure', cleanupError);
    else cleanupFailure = cleanupError;
  }
}
if (cleanupFailure) throw cleanupFailure;
process.exitCode = status;
