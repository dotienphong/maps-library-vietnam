import { describe, expect, it } from 'vitest';
import { foldTelex, looksLikeTelex } from '../src/telex';

describe('looksLikeTelex', () => {
  it('nhận mẫu telex/VNI còn sót', () => {
    for (const q of [
      'saif gonf',
      'ddoongf khowir',
      'ha noij',
      'quan 1 ddaof',
      'tan binh1',
      'hueex',
    ]) {
      expect(looksLikeTelex(q), q).toBe(true);
    }
  });

  it('không nhận chuỗi thường', () => {
    for (const q of ['sai gon', 'highlands', 'quan 10', 'circle k', '88/9 nguyen lam', 'bun bo']) {
      expect(looksLikeTelex(q), q).toBe(false);
    }
  });
});

describe('foldTelex', () => {
  it('gộp nguyên âm đôi và dd', () => {
    // Telex thật của "Đồng Khởi": dd→đ, oo→ô, f là dấu huyền, ow→ơ, r là dấu hỏi.
    expect(foldTelex('ddoongf khowir')).toBe('dong khoi');
    expect(foldTelex('saif gonf')).toBe('sai gon');
  });

  // Mở rộng so với spec 5.6, xem JSDoc của foldTelex: dấu telex đứng sau PHỤ ÂM CUỐI cũng phải bỏ,
  // nếu không thì âm tiết đóng (dongf, viets) không gập được và bậc 3b gần như vô dụng.
  it('bỏ dấu telex sau phụ âm cuối hợp lệ, nhưng KHÔNG cắt tên nước ngoài', () => {
    expect(foldTelex('dongf')).toBe('dong');
    expect(foldTelex('viets nam')).toBe('viet nam');
    expect(foldTelex('highlands')).toBe('highlands');
    expect(foldTelex('starbucks')).toBe('starbucks');
    expect(foldTelex('circle k')).toBe('circle k');
  });

  it('bỏ s f r x j đứng cuối từ sau nguyên âm', () => {
    expect(foldTelex('ha noij')).toBe('ha noi');
    expect(foldTelex('hueex')).toBe('hue');
  });

  it('bỏ chữ số 1–9 dính cuối từ (VNI) nhưng giữ số đứng riêng', () => {
    expect(foldTelex('tan binh1')).toBe('tan binh');
    expect(foldTelex('quan 10')).toBe('quan 10');
  });

  it('không đổi chuỗi thường', () => {
    for (const q of ['bach hoa xanh', 'sai gon', 'highlands']) {
      expect(foldTelex(q), q).toBe(q);
    }
  });

  it('không bỏ phụ âm cuối hợp lệ đứng sau phụ âm', () => {
    // `xanh` kết thúc bằng `nh`, `h` không phải dấu telex; `thanh` cũng vậy.
    expect(foldTelex('binh thanh')).toBe('binh thanh');
  });
});
