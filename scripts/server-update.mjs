#!/usr/bin/env node
// Cập nhật máy chủ: mã mới, image mới, compose up, migration (spec 11.1 pnpm server:update)
import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { resolve } from 'node:path';
import { phaiKhopRepo } from './lib/image-khop-repo.mjs';
import { run } from './lib/run.mjs';
import { canhBaoSharedBuffers, parseEnv, pullPlan } from './lib/server-env.mjs';
import { serverMigrateRun } from './lib/server-migrate.mjs';

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
// Trước `up -d`: image lệch HEAD thì dừng khi chưa dựng lại container nào và chưa đụng DB.
phaiKhopRepo(env.PIPELINE_IMAGE || 'ghcr.io/dotienphong/mapslibvn-pipeline:latest');
run('docker', [...compose, 'up', '-d', '--remove-orphans']);
// serverMigrateRun: mật khẩu superuser đi qua env chứ không nằm trên argv (run() in argv khi lỗi);
// migration lấy từ image đã xác nhận khớp HEAD, không mount db/ của cây làm việc.
const migrate = serverMigrateRun(env, [], { mountDb: false });
run(migrate.command, migrate.args, { env: migrate.env });
console.log('✔ server:update xong');
