import { describe, expect, it } from 'vitest';
import { denNgay, tuNgay } from './khoang-ngay';

describe('quy đổi khoảng ngày của bộ lọc nhật ký', () => {
  it('rỗng → không lọc', () => {
    expect(tuNgay('')).toBeUndefined();
    expect(denNgay('')).toBeUndefined();
  });

  it('mốc đầu là nửa đêm GIỜ MÁY, không phải nửa đêm UTC', () => {
    // Gửi thẳng '2026-09-14' cho API là ngầm hiểu UTC; ở UTC+7 thì mọi việc làm từ 00:00 tới 07:00
    // giờ Việt Nam rơi sang ngày hôm trước và người trực không thấy việc mình vừa làm sáng nay.
    expect(tuNgay('2026-09-14')).toBe(new Date('2026-09-14T00:00:00').toISOString());
  });

  it('mốc cuối lùi sang nửa đêm hôm sau vì `to` không tính vào', () => {
    expect(denNgay('2026-09-14')).toBe(new Date('2026-09-15T00:00:00').toISOString());
  });

  it('một ngày duy nhất vẫn là một khoảng có bề rộng đúng 24 giờ', () => {
    const tu = tuNgay('2026-09-14') as string;
    const den = denNgay('2026-09-14') as string;
    expect(Date.parse(den) - Date.parse(tu)).toBe(86_400_000);
  });

  it('ngày rác không làm hỏng bộ lọc, chỉ là không lọc', () => {
    expect(tuNgay('khong-phai-ngay')).toBeUndefined();
    expect(denNgay('2026-13-45')).toBeUndefined();
  });
});
