#!/usr/bin/env node
// pg_dump -Fc | zstd | openssl enc → R2 <BACKUP_BUCKET>/backups/daily (giữ 7) và backups/weekly vào
// Chủ nhật (giữ 4). Dùng: --once | --daemon
// Audit 09/09/2026: dump plaintext nằm trong bucket tiles (custom domain công khai) tải được không cần
// xác thực → từ nay (1) object luôn mã hoá AES-256 bằng BACKUP_PASSPHRASE, (2) ghi vào bucket riêng
// BACKUP_BUCKET không gắn domain. Thiếu passphrase thì dừng, không upload dump trần.
import 'dotenv/config';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  backupBucket,
  backupName,
  dumpCommand,
  encryptedName,
  localTempName,
  RETRY_HOURS_VN,
  requireBackupPassphrase,
  retentionPlan,
  staleTemps,
  UPLOAD_TIMEOUT_MS,
  uploadArgs,
} from '../../../scripts/lib/backup-plan.mjs';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { run } from '../../../scripts/lib/run.mjs';
import { nextRun, waitUntil } from '../../../scripts/lib/schedule.mjs';

const { bucket, shared } = backupBucket(process.env);
if (shared) {
  console.warn(
    `[backup] CẢNH BÁO: BACKUP_BUCKET chưa đặt — backup ghi vào ${bucket} (bucket tiles có custom domain). Chỉ tạm chấp nhận vì object đã mã hoá; tạo bucket riêng + token S3 có quyền trên nó rồi đặt BACKUP_BUCKET.`,
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

/** Dump + mã hoá ra file tạm. Trả thông tin để upload (có thể upload lại nhiều lần). */
function dumpOnce(now = new Date()) {
  const passphrase = requireBackupPassphrase(process.env);
  mkdirSync(work, { recursive: true });
  const name = encryptedName(backupName(now));
  const tmp = localTempName(name, process.pid);
  const file = resolve(work, tmp);
  // File tạm của các lần upload hỏng trước (mỗi file 463 MB) — không dọn thì đĩa đầy dần.
  for (const old of staleTemps(readdirSync(work), tmp)) {
    console.warn(`[backup] xoá file tạm cũ ${old}`);
    rmSync(resolve(work, old), { force: true });
  }
  const dump = spawnSync('sh', ['-c', dumpCommand(file)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrlFromEnv(process.env),
      BACKUP_PASSPHRASE: passphrase,
    },
  });
  if (dump.status !== 0) {
    rmSync(file, { force: true });
    throw new Error(`pg_dump/zstd/openssl thoát mã ${dump.status}`);
  }
  const vnWeekday = new Date(now.getTime() + 7 * 3600 * 1000).getUTCDay();
  return { name, file, weekly: vnWeekday === 0 };
}

/**
 * Upload + dọn bản cũ trên R2. Ném lỗi nếu upload hỏng; file tạm GIỮ lại để thử lại.
 * @param {{ name: string, file: string, weekly: boolean }} b
 */
function uploadOnce(b) {
  const mb = (statSync(b.file).size / 2 ** 20).toFixed(1);
  run('rclone', uploadArgs(b.file, `r2:${bucket}/backups/daily/${b.name}`, process.env), {
    timeout: UPLOAD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  if (b.weekly)
    run('rclone', uploadArgs(b.file, `r2:${bucket}/backups/weekly/${b.name}`, process.env), {
      timeout: UPLOAD_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
  rmSync(b.file, { force: true });
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
    `✓ backup ${b.name} (${mb} MB) → r2:${bucket}/backups/daily — xoá ${plan.deleteDaily.length + plan.deleteWeekly.length} bản cũ`,
  );
}

const mode = process.argv[2] ?? '--once';
if (mode === '--once') {
  uploadOnce(dumpOnce());
} else if (mode === '--daemon') {
  for (;;) {
    const at = nextRun(new Date(), { hour: 3, minute: 0 });
    console.log(`[backup] lần kế tiếp ${at.toISOString()} (03:00 giờ VN)`);
    await waitUntil(at); // kiểm giờ thật mỗi phút — máy ngủ không làm trượt mốc
    /** @type {{ name: string, file: string, weekly: boolean } | undefined} */
    let b;
    try {
      b = dumpOnce();
      uploadOnce(b);
      continue;
    } catch (e) {
      console.error('[backup] LỖI', e);
    }
    if (!b) continue; // dump hỏng: không có gì để upload lại
    // Upload hỏng (thường vì mạng yếu lúc đêm — sự cố 25/09/2026): thử lại ban ngày cùng file.
    let ok = false;
    for (const hour of RETRY_HOURS_VN) {
      const retryAt = nextRun(new Date(), { hour, minute: 0 });
      console.log(
        `[backup] thử upload lại ${b.name} lúc ${retryAt.toISOString()} (${hour}:00 giờ VN)`,
      );
      await waitUntil(retryAt);
      try {
        uploadOnce(b);
        ok = true;
        break;
      } catch (e) {
        console.error('[backup] thử lại LỖI', e);
      }
    }
    if (!ok) {
      console.error(`[backup] BỎ bản ${b.name} sau ${RETRY_HOURS_VN.length} lần thử lại`);
      rmSync(b.file, { force: true });
    }
  }
} else {
  console.error('Dùng: node infra/server/backup/backup.mjs --once | --daemon');
  process.exit(2);
}
