#!/usr/bin/env node
// Dựng môi trường dev một lệnh. Chạy giống nhau trên macOS / Windows (PowerShell hoặc WSL) / Linux.
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { personalGitIdentityCommands } from './lib/git-identity.mjs';
import { capture, run, sleep } from './lib/run.mjs';
import {
  checkNodeVersion,
  isPostgresReady,
  parseDockerVersion,
  waitPlan,
} from './lib/setup-checks.mjs';

const startedAt = Date.now();
const compose = ['compose', '--env-file', '.env', '-f', 'infra/dev/compose.yml'];
const step = (/** @type {string} */ message) => console.log(`\n▶ ${message}`);

step('Kiểm tra Node');
const node = checkNodeVersion(process.version);
if (!node.ok) {
  console.error(
    `Cần Node ≥ 22, đang có ${process.version}. Cài fnm: https://github.com/Schniz/fnm rồi "fnm install 22".`,
  );
  process.exit(1);
}
console.log(`Node ${process.version} OK`);

step('Kiểm tra Docker');
const dockerVersion = parseDockerVersion(capture('docker', ['--version']));
if (!dockerVersion) {
  console.error(
    'Không thấy Docker. Cài Docker Desktop (macOS/Windows, bật WSL2 trên Windows) hoặc Docker Engine (Linux).',
  );
  process.exit(1);
}
if (!capture('docker', ['info', '--format', '{{.ServerVersion}}'])) {
  console.error('Docker daemon chưa chạy. Mở Docker Desktop rồi chạy lại "pnpm run setup".');
  process.exit(1);
}
console.log(`Docker ${dockerVersion.major}.${dockerVersion.minor} OK`);

step('Tạo .env nếu chưa có');
if (!existsSync(resolve('.env'))) {
  copyFileSync(resolve('.env.example'), resolve('.env'));
  console.log('Đã tạo .env từ .env.example (giá trị dev mặc định).');
} else {
  console.log('.env đã tồn tại — giữ nguyên.');
}

step('Khởi động Postgres/PostGIS (Docker)');
run('docker', [...compose, 'up', '-d', 'postgres']);

step('Chờ Postgres sẵn sàng');
const plan = waitPlan(90_000, 2_000);
let ready = false;
for (let index = 0; index < plan.attempts && !ready; index++) {
  const pidOneCommand = capture('docker', [
    ...compose,
    'exec',
    '-T',
    'postgres',
    'cat',
    '/proc/1/comm',
  ]);
  const pgIsReadyOutput = capture('docker', [
    ...compose,
    'exec',
    '-T',
    'postgres',
    'pg_isready',
    '-U',
    'mapslibvn',
  ]);
  ready = isPostgresReady(pidOneCommand, pgIsReadyOutput);
  if (!ready) await sleep(plan.intervalMs);
}
if (!ready) {
  console.error(
    'Postgres không sẵn sàng sau 90 giây. Xem log: docker compose -f infra/dev/compose.yml logs postgres',
  );
  process.exit(1);
}
console.log('Postgres OK');

step('Chạy migration');
run(process.execPath, ['scripts/db-migrate.mjs']);

step('Cấu hình Git local, hook và kiểm tra danh tính GitHub');
for (const args of personalGitIdentityCommands()) run('git', args);
run('git', ['config', 'core.hooksPath', '.githooks']);
run(process.execPath, ['scripts/check-git-identity.mjs']);

const seconds = Math.round((Date.now() - startedAt) / 1000);
console.log(`
✔ Môi trường sẵn sàng sau ${seconds}s.

Tiếp theo:
  pnpm dev          # chạy các app (khi đã có)
  pnpm test         # chạy test
  pnpm db:fixture   # nạp kho POI Quận 1 (~3 phút, cần image pipeline)
  docs/DEVLOG.md    # xem đang ở đâu, bước kế tiếp là gì
`);
