const VN_OFFSET_MS = 7 * 3600 * 1000;

/**
 * Thời điểm chạy kế tiếp theo giờ Việt Nam (UTC+7, không DST).
 * @param {Date} now
 * @param {{ hour: number, minute: number, weekday?: number }} at weekday: 0=CN … 6=Thứ Bảy (theo giờ VN)
 */
export function nextRun(now, at) {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const candidate = new Date(
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate(), at.hour, at.minute, 0, 0),
  );
  if (candidate.getTime() <= vn.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
  if (at.weekday !== undefined) {
    while (candidate.getUTCDay() !== at.weekday) candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return new Date(candidate.getTime() - VN_OFFSET_MS);
}

/**
 * Job sớm nhất kế tiếp trong danh sách (cron nhiều job của container `pipeline`).
 * @template {{ name: string, schedule: { hour: number, minute: number, weekday?: number } }} J
 * @param {Date} now
 * @param {J[]} jobs
 * @returns {{ job: J, at: Date }}
 */
export function nextJob(now, jobs) {
  /** @type {{ job: J, at: Date } | undefined} */
  let best;
  for (const job of jobs) {
    const at = nextRun(now, job.schedule);
    if (!best || at.getTime() < best.at.getTime()) best = { job, at };
  }
  if (!best) throw new Error('nextJob: danh sách job rỗng');
  return best;
}

/**
 * Chờ tới mốc `at` theo giờ THẬT. Một `setTimeout` dài không đáng tin: đêm 09→10/09/2026 máy chủ
 * (Mac) ngủ nhiều lần, đồng hồ đơn điệu của VM đứng lại nên timer không nổ đúng 03:00 và backup trượt.
 * Ngủ từng bước ≤ `stepMs` rồi đọc lại Date.now(): máy vừa thức thì lần kiểm kế tiếp nhận ra đã quá
 * mốc và trả về ngay.
 * @param {Date} at
 * @param {{ now?: () => number, sleep?: (ms: number) => Promise<void>, stepMs?: number }} [deps]
 */
export async function waitUntil(at, deps = {}) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const stepMs = deps.stepMs ?? 60_000;
  for (;;) {
    const remaining = at.getTime() - now();
    if (remaining <= 0) return;
    await sleep(Math.min(stepMs, remaining));
  }
}
