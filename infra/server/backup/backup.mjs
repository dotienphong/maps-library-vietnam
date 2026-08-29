#!/usr/bin/env node
// pg_dump -Fc | zstd → R2 backups/daily (giữ 7) và backups/weekly vào Chủ nhật (giữ 4). Dùng: --once | --daemon
import 'dotenv/config';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { backupName, retentionPlan } from '../../../scripts/lib/backup-plan.mjs';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { run, sleep } from '../../../scripts/lib/run.mjs';
import { nextRun } from '../../../scripts/lib/schedule.mjs';

const bucket = process.env.R2_BUCKET ?? 'mapslibvn-tiles';
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
  mkdirSync(work, { recursive: true });
  const name = backupName(now);
  const file = resolve(work, name);
  const dump = spawnSync(
    'sh',
    [
      '-c',
      `pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL" | zstd -T0 -3 -q -f -o "${file}"`,
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: databaseUrlFromEnv(process.env) },
    },
  );
  if (dump.status !== 0) throw new Error(`pg_dump/zstd thoát mã ${dump.status}`);
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
