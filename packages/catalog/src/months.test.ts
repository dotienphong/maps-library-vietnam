import { describe, expect, it } from 'vitest';
import { addMonths } from './months';

describe('addMonths', () => {
  it('cộng đúng một tháng và giữ nguyên giờ phút giây', () => {
    // 10:00 ngày 15/03 giờ VN = 03:00Z
    expect(addMonths(new Date('2026-03-15T03:00:00.000Z'), 1).toISOString()).toBe(
      '2026-04-15T03:00:00.000Z',
    );
  });

  it('31/01 + 1 tháng lùi về ngày cuối tháng 02 (28)', () => {
    expect(addMonths(new Date('2026-01-31T03:00:00.000Z'), 1).toISOString()).toBe(
      '2026-02-28T03:00:00.000Z',
    );
  });

  it('năm nhuận: 31/01/2024 + 1 tháng → 29/02/2024', () => {
    expect(addMonths(new Date('2024-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });

  it('tính theo ngày Việt Nam, không theo UTC: 17:30Z 30/11 là 00:30 ngày 01/12 giờ VN', () => {
    // Nếu tính theo UTC sẽ ra 28/02/2027 17:30Z (30/11 + 3 → 28/02). Theo VN: 01/12 + 3 → 01/03.
    expect(addMonths(new Date('2026-11-30T17:30:00.000Z'), 3).toISOString()).toBe(
      '2027-02-28T17:30:00.000Z',
    );
  });

  it('12 tháng là cùng ngày năm sau', () => {
    expect(addMonths(new Date('2026-09-18T05:00:00.000Z'), 12).toISOString()).toBe(
      '2027-09-18T05:00:00.000Z',
    );
  });

  it('không nhận số tháng không phải nguyên dương', () => {
    expect(() => addMonths(new Date(), 0)).toThrow(RangeError);
    expect(() => addMonths(new Date(), 1.5)).toThrow(RangeError);
    expect(() => addMonths(new Date(), -1)).toThrow(RangeError);
  });
});
