#!/usr/bin/env node
// Chỉ áp migration lên DB máy chủ (superuser, trong image pipeline) — KHÔNG pull/up như server:update,
// và `--no-deps` để compose không chạm tới container postgres đang phục vụ. Dùng khi migration phải
// đi TRƯỚC deploy Worker.
// Mount db/ của working tree vào container: image có thể cũ hơn repo (09/09: 0011 vừa viết chưa có
// trong image nên `run` báo "Không có migration mới").
// Tham số được chuyển tiếp cho db-migrate: `pnpm server:migrate -- --down` revert một migration.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './lib/run.mjs';
import { parseEnv } from './lib/server-env.mjs';
import { serverMigrateRun } from './lib/server-migrate.mjs';

const envFile = resolve('infra/server', '.env');
if (!existsSync(envFile)) {
  console.error(`Thiếu ${envFile} — chạy pnpm server:setup trên máy chủ trước.`);
  process.exit(1);
}

const { command, args, env } = serverMigrateRun(
  parseEnv(readFileSync(envFile, 'utf8')),
  process.argv.slice(2),
);
run(command, args, { env });
console.log('✔ server:migrate xong');
