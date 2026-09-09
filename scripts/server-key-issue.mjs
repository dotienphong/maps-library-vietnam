#!/usr/bin/env node
// Cấp API key trên DB MÁY CHỦ (superuser, trong image pipeline). Tham số y như scripts/api-key-issue.mjs:
//   node scripts/server-key-issue.mjs --tenant <uuid> --label "..." --kind web|mobile|server \
//     [--origins http://a,https://*.b] [--scopes places:read,edits:write]
// Khoá in đúng một lần — lưu vào password manager. DB chỉ giữ sha256 + tiền tố.
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
  'scripts/api-key-issue.mjs',
  ...process.argv.slice(2),
]);
