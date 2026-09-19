import { describe, expect, it } from 'vitest';
import { dinhDangSo, dinhDangUsd, dinhDangVnd, TEN_GOI } from './tien';

describe('định dạng tiền', () => {
  it('chấm ngăn hàng nghìn, hậu tố đ liền — đúng kiểu website đang in', () => {
    expect(dinhDangVnd(1_950_000)).toBe('1.950.000đ');
    expect(dinhDangVnd(26_000)).toBe('26.000đ');
    expect(dinhDangVnd(0)).toBe('0đ');
    expect(dinhDangSo(2_000)).toBe('2.000');
    expect(dinhDangSo(124_800_000)).toBe('124.800.000');
  });

  it('USD tham chiếu: tròn thì không lẻ, lẻ thì hai chữ số với dấu phẩy', () => {
    expect(dinhDangUsd(7_500)).toBe('$75');
    expect(dinhDangUsd(2_550)).toBe('$25,50');
  });

  it('tên gói đủ bốn bậc', () => {
    expect(TEN_GOI.trial).toBe('Dùng thử');
    expect(TEN_GOI.business).toBe('Business');
  });
});
