#!/usr/bin/env node
// Phục hồi DB từ backup R2. Dùng: pnpm db:restore --latest | --file <tên.dump.zst> [--yes].
// Ngoài container: tự chạy trong image (pg_restore, zstd, rclone). Chỉ DB local nếu không có --yes.
import 'dotenv/config';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  backupBucket,
  decryptCommand,
  plainName,
  requireBackupPassphrase,
} from './lib/backup-plan.mjs';
import { databaseUrlFromEnv } from './lib/migrations.mjs';
import { run } from './lib/run.mjs';

const argv = process.argv.slice(2);
const compose = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infra/dev/compose.yml',
  '--profile',
  'pipeline',
];
if (process.env.MAPSLIBVN_IN_CONTAINER !== '1') {
  run('docker', [...compose, 'run', '--rm', 'pipeline', 'node', 'scripts/db-restore.mjs', ...argv]);
  process.exit(0);
}

const { bucket } = backupBucket(process.env);
const url = databaseUrlFromEnv(process.env);
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host) && !argv.includes('--yes')) {
  console.error(
    `Từ chối: DB ${host} không phải local. Thêm --yes nếu cố ý (ghi đè toàn bộ dữ liệu).`,
  );
  process.exit(2);
}

let name = argv[argv.indexOf('--file') + 1];
if (argv.includes('--latest') || !argv.includes('--file')) {
  const list = /** @type {{ Name?: string }[]} */ (
    JSON.parse(
      execFileSync('rclone', ['lsjson', `r2:${bucket}/backups/daily`], {
        encoding: 'utf8',
      }),
    )
  );
  name = list
    .map((entry) => entry.Name)
    .filter((entryName) => typeof entryName === 'string')
    .sort()
    .at(-1);
  if (!name) throw new Error('Không có backup nào trong backups/daily');
}
if (!name || name !== basename(name) || !/\.dump\.zst(\.enc)?$/.test(name)) {
  throw new Error(`Tên backup không hợp lệ: ${name}`);
}

const work = resolve(process.env.MAPSLIBVN_WORK ?? 'work', 'restore');
mkdirSync(work, { recursive: true });
const downloaded = resolve(work, name);
const zst = resolve(work, plainName(name));
const dump = zst.replace(/\.zst$/, '');
console.log(`Tải ${name} …`);
run('rclone', ['copyto', `r2:${bucket}/backups/daily/${name}`, downloaded]);
if (name.endsWith('.enc')) {
  // Backup từ 09/09/2026 là AES-256; passphrase nằm trong infra/server/.env (BACKUP_PASSPHRASE).
  const passphrase = requireBackupPassphrase(process.env);
  const dec = spawnSync('sh', ['-c', decryptCommand(downloaded, zst)], {
    stdio: 'inherit',
    env: { ...process.env, BACKUP_PASSPHRASE: passphrase },
  });
  if (dec.status !== 0)
    throw new Error(`openssl giải mã thoát mã ${dec.status} — sai BACKUP_PASSPHRASE?`);
}
run('zstd', ['-d', '-f', '-q', zst, '-o', dump]);

// Restore vào DB mới rồi đổi tên: DB đang phục vụ không bị bỏ trống nếu restore lỗi giữa chừng.
const target = new URL(url);
const dbName = target.pathname.slice(1);
if (!/^[a-z_][a-z0-9_]*$/i.test(dbName)) {
  throw new Error(`Tên database không an toàn cho restore: ${dbName}`);
}
const restoreName = `${dbName}_restore`;
const oldName = `${dbName}_old`;
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const psql = (/** @type {string} */ command) =>
  run('psql', ['-v', 'ON_ERROR_STOP=1', '-d', adminUrl.href, '-c', command]);

psql(`DROP DATABASE IF EXISTS ${restoreName}`);
psql(`CREATE DATABASE ${restoreName} TEMPLATE template0`);
const restoreUrl = new URL(url);
restoreUrl.pathname = `/${restoreName}`;
console.log('pg_restore vào DB tạm …');
run('pg_restore', ['--no-owner', '--no-privileges', '-d', restoreUrl.href, dump]);
const tables = execFileSync(
  'psql',
  [
    '-tAc',
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
    '-d',
    restoreUrl.href,
  ],
  { encoding: 'utf8' },
).trim();
if (Number(tables) < 16) throw new Error(`Restore thiếu bảng (${tables} < 16) — không đổi DB`);

// Hoàn thiện DB tạm trước khi swap: migration/quyền lỗi thì DB đang phục vụ vẫn nguyên vẹn.
const restoreEnv = { ...process.env, DATABASE_URL: restoreUrl.href };
run(process.execPath, ['scripts/db-migrate.mjs'], { env: restoreEnv });
run(process.execPath, ['scripts/db-permissions.mjs'], { env: restoreEnv });

console.log(`Đổi ${restoreName} → ${dbName} (ngắt kết nối đang mở) …`);
psql(
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${dbName}', '${restoreName}') AND pid <> pg_backend_pid()`,
);
psql(`DROP DATABASE IF EXISTS ${oldName}`);
psql(`ALTER DATABASE ${dbName} RENAME TO ${oldName}`);
psql(`ALTER DATABASE ${restoreName} RENAME TO ${dbName}`);
psql(`DROP DATABASE ${oldName}`);
rmSync(work, { recursive: true, force: true });
console.log(`✓ đã phục hồi ${name} vào ${host}`);
