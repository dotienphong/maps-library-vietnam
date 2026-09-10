#!/usr/bin/env node
// Dựng stack server trên máy mới, phục hồi backup production mới nhất và nghiệm thu DB.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { capture, run } from './lib/run.mjs';
import { parseEnv } from './lib/server-env.mjs';
import {
  requiredServerRestoreEnv,
  serverRestoreRun,
  verifyRestoredDatabaseSql,
} from './lib/server-restore.mjs';

const envPath = resolve('infra/server/.env');
if (!existsSync(envPath)) {
  console.error(
    'Thiếu infra/server/.env. Hãy chép file máy chủ cũ từ password manager; không thể giải mã backup nếu mất BACKUP_PASSPHRASE.',
  );
  process.exit(2);
}

const serverEnv = parseEnv(readFileSync(envPath, 'utf8'));
const missing = requiredServerRestoreEnv(serverEnv);
if (missing.length > 0) {
  console.error(`Thiếu biến bắt buộc trong infra/server/.env: ${missing.join(', ')}`);
  process.exit(2);
}

console.log('▶ Dựng/cập nhật stack server');
run(process.execPath, ['scripts/server-setup.mjs']);

console.log('▶ Phục hồi backup production mới nhất từ R2');
const restore = serverRestoreRun(serverEnv);
run(restore.command, restore.args, { env: restore.env });

console.log('▶ Nghiệm thu database đã phục hồi');
const compose = [
  'compose',
  '--env-file',
  'infra/server/.env',
  '-f',
  resolve('infra/server/compose.yml'),
];
const result = capture('docker', [
  ...compose,
  'exec',
  '-T',
  'postgres',
  'psql',
  '-U',
  'mapslibvn',
  '-d',
  'mapslibvn',
  '-P',
  'pager=off',
  '-c',
  verifyRestoredDatabaseSql(),
]);
if (!result || !/\bt\s*\|\s*t\s*\|\s*t\s*\|\s*t\b/.test(result)) {
  console.error(result);
  throw new Error('Nghiệm thu DB thất bại: owner hoặc quyền api không đúng');
}
console.log(result);
console.log('✓ Máy mới đã có stack server và dữ liệu production mới nhất.');
