#!/usr/bin/env node
// Dựng máy chủ nội bộ 24/7 bằng một lệnh (spec 11.1). Chạy trên máy chủ, từ gốc repo đã clone.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { resolve } from 'node:path';
import { capture, run, sleep } from './lib/run.mjs';
import {
  generatePassword,
  parseEnv,
  renderServerEnv,
  sharedBuffersFor,
} from './lib/server-env.mjs';
import {
  checkNodeVersion,
  isPostgresReady,
  parseDockerVersion,
  waitPlan,
} from './lib/setup-checks.mjs';

const dir = resolve('infra/server');
const envPath = resolve(dir, '.env');
const compose = ['compose', '--env-file', envPath, '-f', resolve(dir, 'compose.yml')];
const CERTS_VOLUME = 'mapslibvn-server_pgcerts';
const step = (/** @type {string} */ msg) => console.log(`\n▶ ${msg}`);

step('Kiểm tra Node và Docker');
if (!checkNodeVersion(process.version).ok) {
  console.error(`Cần Node ≥ 22, đang có ${process.version}`);
  process.exit(1);
}
if (
  !parseDockerVersion(capture('docker', ['--version'])) ||
  !capture('docker', ['info', '--format', '{{.ServerVersion}}'])
) {
  console.error('Docker chưa cài hoặc daemon chưa chạy.');
  process.exit(1);
}

step('Tạo infra/server/.env');
if (!existsSync(envPath)) {
  writeFileSync(
    envPath,
    renderServerEnv({
      superPassword: generatePassword(32),
      apiPassword: generatePassword(32),
      pipelinePassword: generatePassword(32),
      sharedBuffers: sharedBuffersFor(totalmem()),
      tunnelToken: '',
      pipelineImage: process.env.PIPELINE_IMAGE ?? 'ghcr.io/dotienphong/mapslibvn-pipeline:latest',
      backupPassphrase: generatePassword(48),
    }),
  );
  console.log(
    `Đã sinh ${envPath} với mật khẩu ngẫu nhiên — SAO LƯU file này vào password manager.`,
  );
} else {
  console.log('.env đã có — giữ nguyên.');
}
const env = parseEnv(readFileSync(envPath, 'utf8'));

step('Chứng chỉ TLS tự ký cho Postgres (volume pgcerts, 10 năm)');
if (
  !capture('docker', [
    'run',
    '--rm',
    '-v',
    `${CERTS_VOLUME}:/certs`,
    'alpine:3.20',
    'sh',
    '-c',
    'ls /certs/server.key 2>/dev/null',
  ])
) {
  run('docker', [
    'run',
    '--rm',
    '-v',
    `${CERTS_VOLUME}:/certs`,
    'alpine:3.20',
    'sh',
    '-c',
    'apk add --no-cache openssl >/dev/null && openssl req -x509 -newkey rsa:4096 -nodes -days 3650 -subj /CN=maps-db.mapslibvn.local -keyout /certs/server.key -out /certs/server.crt && chown 999:999 /certs/server.key /certs/server.crt && chmod 600 /certs/server.key',
  ]);
  console.log('Đã sinh server.crt / server.key.');
} else {
  console.log('Chứng chỉ đã có.');
}

// `parseEnv` trả Record<string, string> nhưng tsconfig bật noUncheckedIndexedAccess → cần mặc định tường minh.
const pipelineImage = env.PIPELINE_IMAGE || 'ghcr.io/dotienphong/mapslibvn-pipeline:latest';
step(`Image ${pipelineImage}`);
// Kéo bản mới nếu registry có; image chỉ có local (mapslibvn/pipeline:local khi thử trên máy dev) thì bỏ qua pull.
const pulled = spawnSync('docker', ['pull', pipelineImage], { stdio: 'inherit' }).status === 0;
if (!pulled && !capture('docker', ['image', 'inspect', '--format', '{{.Id}}', pipelineImage])) {
  console.error(
    `Không kéo được và không có sẵn image ${pipelineImage}. Đăng nhập GHCR (README) hoặc đặt PIPELINE_IMAGE trong infra/server/.env.`,
  );
  process.exit(1);
}

step('Khởi động dịch vụ');
const services = ['postgres', 'backup', 'pipeline'];
if (env.TUNNEL_TOKEN) services.push('cloudflared');
else {
  console.warn(
    'TUNNEL_TOKEN trống → chưa chạy cloudflared. Điền token vào infra/server/.env rồi chạy lại pnpm server:setup.',
  );
}
run('docker', [...compose, 'up', '-d', ...services]);

step('Chờ Postgres sẵn sàng');
const plan = waitPlan(120_000, 3_000);
let ready = false;
for (let i = 0; i < plan.attempts && !ready; i++) {
  ready = isPostgresReady(
    capture('docker', [...compose, 'exec', '-T', 'postgres', 'cat', '/proc/1/comm']),
    capture('docker', [...compose, 'exec', '-T', 'postgres', 'pg_isready', '-U', 'mapslibvn']),
  );
  if (!ready) await sleep(plan.intervalMs);
}
if (!ready) {
  console.error(
    'Postgres không sẵn sàng sau 120 giây. Xem: docker compose -f infra/server/compose.yml logs postgres',
  );
  process.exit(1);
}

step('Migration (superuser, trong image pipeline)');
run('docker', [
  ...compose,
  'run',
  '--rm',
  '-e',
  'POSTGRES_USER=mapslibvn',
  '-e',
  `POSTGRES_PASSWORD=${env.POSTGRES_SUPER_PASSWORD}`,
  'pipeline',
  'node',
  'scripts/db-migrate.mjs',
]);

step('Đồng bộ mật khẩu role api / pipeline (idempotent)');
run('docker', [
  ...compose,
  'exec',
  '-T',
  '-e',
  `API_PASSWORD=${env.API_PASSWORD}`,
  '-e',
  `PIPELINE_PASSWORD=${env.PIPELINE_PASSWORD}`,
  'postgres',
  'sh',
  '/docker-entrypoint-initdb.d/10-roles.sh',
]);

step('Kiểm tra TLS');
console.log(
  capture('docker', [
    ...compose,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'mapslibvn',
    '-d',
    'mapslibvn',
    '-tAc',
    'SHOW ssl',
  ]) === 'on'
    ? 'ssl = on'
    : 'CẢNH BÁO: ssl chưa bật',
);

console.log(`
✔ Máy chủ đã dựng (${services.join(', ')}).

Việc tay trên Cloudflare — chi tiết từng màn hình trong infra/server/README.md:
  1. Zero Trust → Networks → Tunnels → Create tunnel "mapslibvn-db" → copy token → TUNNEL_TOKEN trong infra/server/.env → chạy lại pnpm server:setup.
  2. Tunnel → Public Hostname: maps-db.<domain> → Service: tcp://postgres:5432.
  3. Zero Trust → Access → Service Auth → Service Token "hyperdrive" (lưu Client ID/Secret).
  4. Access → Applications → Self-hosted "mapslibvn-db", domain maps-db.<domain>, Policy "Service Auth" chọn token trên.
  5. Workers & Pages → Hyperdrive → Create: name mapslibvn-db, host maps-db.<domain>, port 5432, database mapslibvn,
     user api, password = API_PASSWORD, bật "Connect via Cloudflare Access" với Client ID/Secret → copy Hyperdrive ID vào apps/api/wrangler.toml.
`);
