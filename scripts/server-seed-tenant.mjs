#!/usr/bin/env node
// Nạp seed tenant lên DB MÁY CHỦ (superuser, trong image pipeline):
//   node scripts/server-seed-tenant.mjs db/seed/tenant_quota_probe.sql
//
// Khác scripts/db-seed-tenant.mjs ở chỗ nó chạy trên DB production qua container `pipeline`,
// và mount db/ của working tree vào để seed vừa viết xong cũng dùng được ngay.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { phaiDungTrenMayChu } from './lib/dung-may-chu.mjs';
import { run } from './lib/run.mjs';
import { parseEnv } from './lib/server-env.mjs';
import { serverSeedRun } from './lib/server-seed.mjs';

phaiDungTrenMayChu('pnpm server:seed-tenant');

const envFile = resolve('infra/server', '.env');
if (!existsSync(envFile)) {
  console.error(`Thiếu ${envFile} — chạy pnpm server:setup trên máy chủ trước.`);
  process.exit(1);
}

const { command, args, env } = serverSeedRun(
  parseEnv(readFileSync(envFile, 'utf8')),
  process.argv.slice(2),
);
run(command, args, { env });
console.log('✔ server:seed-tenant xong');
