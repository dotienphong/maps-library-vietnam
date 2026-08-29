#!/usr/bin/env node
// Lịch trong container `pipeline` trên máy chủ: thứ Hai 02:00 giờ VN chạy data:update. Khoá file tránh chạy chồng.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run, sleep } from './lib/run.mjs';
import { nextRun } from './lib/schedule.mjs';

const lock = resolve(process.env.MAPSLIBVN_WORK ?? 'work', 'data-update.lock');
const schedule = { hour: 2, minute: 0, weekday: 1 };
if (existsSync(lock)) {
  console.warn(`[cron] xoá khoá cũ ${lock} (container vừa khởi động lại)`);
  rmSync(lock, { force: true });
}
for (;;) {
  const at = nextRun(new Date(), schedule);
  console.log(`[cron] data:update kế tiếp ${at.toISOString()} (thứ Hai 02:00 VN)`);
  await sleep(at.getTime() - Date.now());
  writeFileSync(lock, String(process.pid));
  try {
    run(process.execPath, ['scripts/data-update.mjs']);
  } catch (e) {
    console.error('[cron] data:update LỖI', e);
  } finally {
    rmSync(lock, { force: true });
  }
}
