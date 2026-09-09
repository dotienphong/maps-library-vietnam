#!/usr/bin/env node
// Chỉ áp migration lên DB máy chủ (superuser, trong image pipeline) — KHÔNG pull/up như server:update,
// nên không chạm tới container postgres đang phục vụ. Dùng khi migration phải đi TRƯỚC deploy Worker.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './lib/run.mjs';
import { parseEnv } from './lib/server-env.mjs';

const dir = resolve('infra/server');
const env = parseEnv(readFileSync(resolve(dir, '.env'), 'utf8'));
const compose = ['compose', '--env-file', resolve(dir, '.env'), '-f', resolve(dir, 'compose.yml')];
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
console.log('✔ server:migrate xong');
