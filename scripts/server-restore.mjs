#!/usr/bin/env node
// Dựng stack server trên máy mới, phục hồi backup production mới nhất và nghiệm thu DB.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './lib/run.mjs';
import { parseEnv } from './lib/server-env.mjs';
import {
  docKetQuaPsql,
  kiemRestoreHong,
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
const nghiemThu = spawnSync(
  'docker',
  [
    ...compose,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'mapslibvn',
    '-d',
    'mapslibvn',
    '-At',
    '-F',
    '|',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    verifyRestoredDatabaseSql(),
  ],
  { encoding: 'utf8' },
);
const result = nghiemThu.stdout?.trim() ?? '';
if (nghiemThu.status !== 0 || !result) {
  // Câu kiểm không chạy (container tắt, thiếu bảng/hàm…): in lỗi thật, đừng báo "11 nhóm hỏng".
  console.error(nghiemThu.stderr?.trim() || nghiemThu.error?.message || '(psql không trả gì)');
  throw new Error('Câu nghiệm thu DB không chạy được — xem lỗi psql ở trên');
}
const hong = kiemRestoreHong(docKetQuaPsql(result));
if (hong.length > 0) {
  console.error(result);
  console.error(`✗ Nghiệm thu DB thất bại: ${hong.join(', ')}.`);
  console.error(
    '  DB phục hồi ĐÃ được đổi vào `mapslibvn` và có thể đang phục vụ (tunnel bật nếu có TUNNEL_TOKEN).',
  );
  console.error(
    '  Quyền/thiết lập do scripts/lib/db-permissions.mjs dựng lại; image pipeline lệch repo là nguyên nhân',
  );
  console.error(
    '  hay gặp nhất (26/09/2026). Có image đúng rồi chạy lại `pnpm server:restore` (chốt image ở server:setup).',
  );
  throw new Error(`Nghiệm thu DB thất bại: ${hong.join(', ')}`);
}
console.log(result);
console.log('✓ Máy mới đã có stack server và dữ liệu production mới nhất.');
