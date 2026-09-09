#!/usr/bin/env node
// pg_dump -Fc | zstd | openssl enc → R2 <BACKUP_BUCKET>/backups/daily (giữ 7) và backups/weekly vào
// Chủ nhật (giữ 4). Dùng: --once | --daemon
// Audit 09/09/2026: dump plaintext nằm trong bucket tiles (custom domain công khai) tải được không cần
// xác thực → từ nay (1) object luôn mã hoá AES-256 bằng BACKUP_PASSPHRASE, (2) ghi vào bucket riêng
// BACKUP_BUCKET không gắn domain. Thiếu passphrase thì dừng, không upload dump trần.
import 'dotenv/config';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  backupBucket,
  backupName,
  dumpCommand,
  encryptedName,
  requireBackupPassphrase,
  retentionPlan,
} from '../../../scripts/lib/backup-plan.mjs';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { run, sleep } from '../../../scripts/lib/run.mjs';
import { nextRun } from '../../../scripts/lib/schedule.mjs';

const { bucket, shared } = backupBucket(process.env);
if (shared) {
  console.warn(
    `[backup] CẢNH BÁO: BACKUP_BUCKET chưa đặt — backup ghi vào ${bucket} (bucket tiles có custom domain). ` +
      'Chỉ tạm chấp nhận vì object đã mã hoá; tạo bucket riêng + token S3 có quyền trên nó rồi đặt BACKUP_BUCKET.',
  );
}
const work = process.env.MAPSLIBVN_WORK ?? resolve('work');

/** @param {string} prefix */
function listNames(prefix) {
  try {
    const json = execFileSync('rclone', ['lsjson', `r2:${bucket}/${prefix}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /** @type {{ Name: string }[]} */ (JSON.parse(json)).map((e) => e.Name);
  } catch {
    return [];
  }
}

async function backupOnce(now = new Date()) {
  const passphrase = requireBackupPassphrase(process.env);
  mkdirSync(work, { recursive: true });
  const name = encryptedName(backupName(now));
  const file = resolve(work, name);
  const dump = spawnSync('sh', ['-c', dumpCommand(file)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrlFromEnv(process.env),
      BACKUP_PASSPHRASE: passphrase,
    },
  });
  if (dump.status !== 0) throw new Error(`pg_dump/zstd/openssl thoát mã ${dump.status}`);
  const mb = (statSync(file).size / 2 ** 20).toFixed(1);
  run('rclone', ['copyto', file, `r2:${bucket}/backups/daily/${name}`]);
  const vnWeekday = new Date(now.getTime() + 7 * 3600 * 1000).getUTCDay();
  if (vnWeekday === 0) run('rclone', ['copyto', file, `r2:${bucket}/backups/weekly/${name}`]);
  rmSync(file, { force: true });
  const plan = retentionPlan(
    { daily: listNames('backups/daily'), weekly: listNames('backups/weekly') },
    { keepDaily: 7, keepWeekly: 4 },
  );
  for (const n of plan.deleteDaily)
    run('rclone', ['deletefile', `r2:${bucket}/backups/daily/${n}`]);
  for (const n of plan.deleteWeekly) {
    run('rclone', ['deletefile', `r2:${bucket}/backups/weekly/${n}`]);
  }
  console.log(
    `✓ backup ${name} (${mb} MB) → r2:${bucket}/backups/daily — xoá ${plan.deleteDaily.length + plan.deleteWeekly.length} bản cũ`,
  );
}

const mode = process.argv[2] ?? '--once';
if (mode === '--once') {
  await backupOnce();
} else if (mode === '--daemon') {
  for (;;) {
    const at = nextRun(new Date(), { hour: 3, minute: 0 });
    console.log(`[backup] lần kế tiếp ${at.toISOString()} (03:00 giờ VN)`);
    await sleep(at.getTime() - Date.now());
    try {
      await backupOnce();
    } catch (e) {
      console.error('[backup] LỖI', e);
    }
  }
} else {
  console.error('Dùng: node infra/server/backup/backup.mjs --once | --daemon');
  process.exit(2);
}
