/**
 * `<input type="date">` trả `YYYY-MM-DD` không mang múi giờ. Đưa thẳng chuỗi đó cho API là ngầm
 * hiểu theo UTC: ở Việt Nam (UTC+7) mọi việc làm từ 00:00 tới 07:00 sẽ rơi sang ngày hôm trước, và
 * người trực lọc "hôm nay" sẽ không thấy việc mình vừa làm lúc sáng sớm.
 *
 * Nên quy đổi theo giờ MÁY của người dùng: `new Date('2026-09-14T00:00:00')` (không có `Z`) là nửa
 * đêm giờ địa phương.
 */
export function tuNgay(ngay: string): string | undefined {
  if (!ngay) return undefined;
  const moc = new Date(`${ngay}T00:00:00`);
  return Number.isFinite(moc.getTime()) ? moc.toISOString() : undefined;
}

/**
 * Đầu `to` là KHÔNG tính vào, nên "tới ngày 14" phải thành nửa đêm ngày 15 — nếu không, mọi việc
 * làm trong chính ngày 14 đều bị cắt mất.
 */
export function denNgay(ngay: string): string | undefined {
  if (!ngay) return undefined;
  const moc = new Date(`${ngay}T00:00:00`);
  if (!Number.isFinite(moc.getTime())) return undefined;
  moc.setDate(moc.getDate() + 1);
  return moc.toISOString();
}
