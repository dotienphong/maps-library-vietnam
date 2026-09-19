#!/usr/bin/env node
// Inventory tenant/mode trên DB MÁY CHỦ (chỉ đọc, trong image pipeline):
//   node scripts/server-tenant-inventory.mjs
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { phaiDungTrenMayChu } from './lib/dung-may-chu.mjs';
import { run } from './lib/run.mjs';
import { parseEnv } from './lib/server-env.mjs';
import { serverNodeRun } from './lib/server-seed.mjs';

phaiDungTrenMayChu('pnpm server:tenants');

const envFile = resolve('infra/server', '.env');
if (!existsSync(envFile)) {
  console.error(`Thiếu ${envFile} — chạy pnpm server:setup trên máy chủ trước.`);
  process.exit(1);
}
const { command, args, env } = serverNodeRun(
  parseEnv(readFileSync(envFile, 'utf8')),
  'scripts/db-tenant-inventory.mjs',
);
run(command, args, { env });
