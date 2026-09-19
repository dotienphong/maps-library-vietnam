import { describe, expect, it } from 'vitest';
import { chuKyPoll, giayConLai, NHAN_TRANG_THAI } from './trang-thai';

describe('trạng thái đơn', () => {
  it('đủ nhãn cho cả tám trạng thái của máy trạng thái', () => {
    expect(Object.keys(NHAN_TRANG_THAI).sort()).toEqual([
      'cancelled',
      'expired',
      'fulfilled',
      'paid',
      'paid_unfulfilled',
      'pending',
      'refunded',
      'underpaid',
    ]);
  });

  it('poll 3 giây khi chờ trả, 5 giây khi đã trả chưa cấp, DỪNG khi xong', () => {
    expect(chuKyPoll('pending')).toBe(3000);
    expect(chuKyPoll('paid')).toBe(5000);
    expect(chuKyPoll('paid_unfulfilled')).toBe(5000);
    expect(chuKyPoll('fulfilled')).toBe(false);
    expect(chuKyPoll('underpaid')).toBe(false);
    expect(chuKyPoll('cancelled')).toBe(false);
    expect(chuKyPoll(undefined)).toBe(false);
  });

  it('đếm ngược không âm; null khi không có hạn hoặc hạn không đọc được', () => {
    const now = Date.parse('2026-09-19T03:00:00Z');
    expect(giayConLai('2026-09-19T03:10:00Z', now)).toBe(600);
    expect(giayConLai('2026-09-19T02:00:00Z', now)).toBe(0);
    expect(giayConLai(null, now)).toBeNull();
    expect(giayConLai('khong-phai-ngay', now)).toBeNull();
  });
});
