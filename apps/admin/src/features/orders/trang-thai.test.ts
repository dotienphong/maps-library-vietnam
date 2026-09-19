import { describe, expect, it } from 'vitest';
import { NHAN_TRANG_THAI, TAT_CA_TRANG_THAI, tuoi } from './trang-thai';

describe('trạng thái đơn (admin)', () => {
  it('đủ tám trạng thái của máy trạng thái', () => {
    expect(TAT_CA_TRANG_THAI).toHaveLength(8);
    expect(Object.keys(NHAN_TRANG_THAI)).toContain('paid_unfulfilled');
  });

  it('"tiền vào gói chưa vào" tô đỏ — đó là việc phải xử lý ngay', () => {
    expect(NHAN_TRANG_THAI.paid_unfulfilled.tone).toBe('danger');
  });

  it('tuổi đơn: phút, giờ, ngày', () => {
    const now = Date.parse('2026-09-19T03:00:00Z');
    expect(tuoi('2026-09-19T02:58:00Z', now)).toBe('2 phút');
    expect(tuoi('2026-09-19T00:00:00Z', now)).toBe('3 giờ');
    expect(tuoi('2026-09-16T03:00:00Z', now)).toBe('3 ngày');
    // Đồng hồ lệch không được cho ra số âm.
    expect(tuoi('2026-09-19T03:05:00Z', now)).toBe('0 phút');
  });
});
