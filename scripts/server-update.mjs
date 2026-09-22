#!/usr/bin/env node
// Cập nhật máy chủ: mã mới, image mới, compose up, migration (spec 11.1 pnpm server:update)
import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { resolve } from 'node:path';
import { run } from './lib/run.mjs';
import { canhBaoSharedBuffers, parseEnv, pullPlan } from './lib/server-env.mjs';

const dir = resolve('infra/server');
const env = parseEnv(readFileSync(resolve(dir, '.env'), 'utf8'));
const compose = ['compose', '--env-file', resolve(dir, '.env'), '-f', resolve(dir, 'compose.yml')];

// `.env` hay được sinh ở máy khác rồi mang sang máy chủ; kiểm mỗi lần cập nhật để một cấu hình quá
// cỡ không âm thầm làm cả máy swap (sự cố 22/09/2026 — xem canhBaoSharedBuffers).
const canhBao = canhBaoSharedBuffers(env.PG_SHARED_BUFFERS ?? '', totalmem());
if (canhBao) console.warn(`[server:update] CẢNH BÁO: ${canhBao}`);

run('git', ['pull', '--ff-only']);
const { services, skipPipeline } = pullPlan(env.PIPELINE_IMAGE);
if (skipPipeline) {
  console.log(`[server:update] Bỏ qua pull ${env.PIPELINE_IMAGE} — image dựng tại máy.`);
  console.log('              Cần bản mới thì chạy `pnpm image:build` trước khi chạy lệnh này.');
}
run('docker', [...compose, 'pull', ...services]);
run('docker', [...compose, 'up', '-d', '--remove-orphans']);
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
console.log('✔ server:update xong');
