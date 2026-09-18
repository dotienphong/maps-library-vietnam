/** Việt Nam là UTC+7, không có giờ mùa hè — một hằng số là đủ. */
const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * Cộng `months` tháng theo lịch, tính trên ngày giờ Việt Nam và giữ nguyên giờ phút giây.
 * Ngày vượt quá độ dài tháng đích thì lùi về ngày cuối tháng: 31/01 + 1 → 28/02 (29/02 năm nhuận).
 *
 * Kỳ thuê bao của khách bắt đầu và kết thúc theo ngày Việt Nam, nên phải dịch sang UTC+7 trước khi
 * làm toán lịch rồi dịch ngược; làm thẳng trên UTC sẽ sai một ngày cho mọi mốc từ 17:00Z trở đi.
 */
export function addMonths(startsAt: Date, months: number): Date {
  if (!Number.isInteger(months) || months <= 0) {
    throw new RangeError('months phải là số nguyên dương');
  }
  const vn = new Date(startsAt.getTime() + VN_OFFSET_MS);
  const day = vn.getUTCDate();
  const target = new Date(
    Date.UTC(
      vn.getUTCFullYear(),
      vn.getUTCMonth() + months,
      1,
      vn.getUTCHours(),
      vn.getUTCMinutes(),
      vn.getUTCSeconds(),
      vn.getUTCMilliseconds(),
    ),
  );
  // Ngày 0 của tháng kế tiếp = ngày cuối của tháng đích.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return new Date(target.getTime() - VN_OFFSET_MS);
}
