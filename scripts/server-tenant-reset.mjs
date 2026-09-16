#!/usr/bin/env node
// Xoá toàn bộ tenant trên DB MÁY CHỦ rồi tạo lại một tenant (superuser, trong image pipeline):
//   pnpm server:tenant-reset --name Phong_Admin
//   pnpm server:tenant-reset --name Phong_Admin --apply --confirm XOA-TOAN-BO-TENANT
//
// Không có --apply thì chỉ in kiểm kê. Xem scripts/db-tenant-reset.mjs cho phần chạy thật.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './lib/run.mjs';
import { parseEnv } from './lib/server-env.mjs';
import { serverNodeRun } from './lib/server-seed.mjs';

const envFile = resolve('infra/server', '.env');
if (!existsSync(envFile)) {
  console.error(`Thiếu ${envFile} — chạy pnpm server:setup trên máy chủ trước.`);
  process.exit(1);
}
const { command, args, env } = serverNodeRun(
  parseEnv(readFileSync(envFile, 'utf8')),
  'scripts/db-tenant-reset.mjs',
  process.argv.slice(2),
);
run(command, args, { env });
