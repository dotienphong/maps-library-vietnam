#!/usr/bin/env node
// Cập nhật máy chủ: mã mới, image mới, compose up, migration (spec 11.1 pnpm server:update)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './lib/run.mjs';
import { parseEnv } from './lib/server-env.mjs';

const dir = resolve('infra/server');
const env = parseEnv(readFileSync(resolve(dir, '.env'), 'utf8'));
const compose = ['compose', '--env-file', resolve(dir, '.env'), '-f', resolve(dir, 'compose.yml')];

run('git', ['pull', '--ff-only']);
run('docker', [...compose, 'pull']);
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
