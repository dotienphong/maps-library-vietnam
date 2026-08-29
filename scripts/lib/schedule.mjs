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
