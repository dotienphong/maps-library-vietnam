#!/usr/bin/env node
// Test tích hợp chỉ đường (spec dẫn đường A mục 7.3): Valhalla trên fixture Quận 1 → wrangler dev với
// ROUTING_BASE trỏ container → khoá test trong KV local → vitest apps/api/test-routing/*.rtest.mjs.
//   pnpm test:routing              máy dev: tự dựng container (compose dev, profile routing); giữ container
//                                  sau khi chạy để lần sau nhanh; thêm --down để dừng.
//   node scripts/routing-test.mjs --no-compose     CI: VALHALLA_BASE trỏ container đã chạy.
//   node scripts/routing-test.mjs --capture        ghi JSON Valhalla thô → apps/api/test/fixtures/valhalla/q1-motorbike.json
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEST_KEY, parseRoutingTestArgs, testAuthInfo, waitForOk } from './lib/routing-test.mjs';
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

if (opts.compose) {
  mkdirSync(DEV_DIR, { recursive: true });
  if (!existsSync(resolve(DEV_DIR, 'valhalla_tiles.tar'))) {
    copyFileSync(FIXTURE_PBF, resolve(DEV_DIR, 'q1.osm.pbf'));
    log(`chép fixture Quận 1 vào ${DEV_DIR} — lần đầu Valhalla build graph vài phút`);
  }
  run('docker', [...compose, 'up', '-d', 'valhalla'], {
    env: { ...process.env, MAPSLIBVN_VALHALLA_DEV: DEV_DIR },
  });
}
await waitForOk(`${opts.valhallaBase}/status`, 15 * 60_000, {
  onTick: (ms) => log(`chờ Valhalla /status… ${Math.round(ms / 1000)}s`),
});
log(`Valhalla sẵn sàng tại ${opts.valhallaBase}`);

if (opts.capture) {
  const body = {
    locations: [
      { lat: 10.7798, lon: 106.699, type: 'break' },
      { lat: 10.7725, lon: 106.698, type: 'break' },
    ],
    costing: 'motor_scooter',
    directions_options: { language: 'vi-VN', units: 'kilometers' },
    id: 'capture-q1-motorbike',
  };
  const response = await fetch(`${opts.valhallaBase}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`capture: Valhalla trả ${response.status}`);
  const target = resolve('apps/api/test/fixtures/valhalla/q1-motorbike.json');
  writeFileSync(target, `${JSON.stringify(await response.json(), null, 2)}\n`);
  log(`đã ghi ${target}`);
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

const detached = process.platform !== 'win32';
const wrangler = spawn(
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
  ],
  { stdio: 'inherit', detached },
);
const stopWrangler = () => {
  try {
    if (detached && wrangler.pid) process.kill(-wrangler.pid, 'SIGTERM');
    else wrangler.kill('SIGTERM');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error;
  }
};
process.once('exit', stopWrangler);
process.once('SIGINT', () => {
  stopWrangler();
  process.exit(130);
});

let status = 1;
try {
  await waitForOk(`http://127.0.0.1:${opts.apiPort}/healthz`, 90_000, { intervalMs: 1_000 });
  const result = spawnSync(
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
} finally {
  stopWrangler();
  if (opts.compose && opts.down) run('docker', [...compose, 'stop', 'valhalla']);
}
process.exit(status);
