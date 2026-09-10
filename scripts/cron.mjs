#!/usr/bin/env node
// Lịch trong container `pipeline` trên máy chủ (giờ VN). Khoá file theo từng job, tránh chạy chồng.
//   thứ Hai 02:00  data:update    (spec 11.1)
//   thứ Hai 08:00  báo cáo tuần   (spec 11.3 — Analytics Engine → email)
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './lib/run.mjs';
import { nextJob, waitUntil } from './lib/schedule.mjs';

const work = process.env.MAPSLIBVN_WORK ?? 'work';
const JOBS = [
  {
    name: 'data:update',
    schedule: { hour: 2, minute: 0, weekday: 1 },
    script: 'scripts/data-update.mjs',
  },
  {
    name: 'report:weekly',
    schedule: { hour: 8, minute: 0, weekday: 1 },
    script: 'scripts/weekly-report.mjs',
  },
];

/** @param {string} name */
const lockFor = (name) => resolve(work, `${name.replace(':', '-')}.lock`);

for (const job of JOBS) {
  const lock = lockFor(job.name);
  if (existsSync(lock)) {
    console.warn(`[cron] xoá khoá cũ ${lock} (container vừa khởi động lại)`);
    rmSync(lock, { force: true });
  }
}

for (;;) {
  const { job, at } = nextJob(new Date(), JOBS);
  const hhmm = `${String(job.schedule.hour).padStart(2, '0')}:${String(job.schedule.minute).padStart(2, '0')}`;
  console.log(`[cron] ${job.name} kế tiếp ${at.toISOString()} (thứ Hai ${hhmm} VN)`);
  await waitUntil(at); // kiểm giờ thật mỗi phút — máy ngủ không làm trượt mốc
  const lock = lockFor(job.name);
  writeFileSync(lock, String(process.pid));
  try {
    run(process.execPath, [job.script]);
  } catch (e) {
    console.error(`[cron] ${job.name} LỖI`, e);
  } finally {
    rmSync(lock, { force: true });
  }
}
