import { describe, expect, it } from 'vitest';
import { ngayVn, sapTheoNgayMoi } from './bai-viet';

describe('bai-viet', () => {
  it('sắp bài mới nhất lên đầu', () => {
    const xs = [{ publishedAt: '2026-09-01' }, { publishedAt: '2026-09-18' }];
    expect(sapTheoNgayMoi(xs)[0]?.publishedAt).toBe('2026-09-18');
  });

  it('không sửa mảng gốc', () => {
    const xs = [{ publishedAt: '2026-09-01' }, { publishedAt: '2026-09-18' }];
    sapTheoNgayMoi(xs);
    expect(xs[0]?.publishedAt).toBe('2026-09-01');
  });

  it('ngày hiển thị kiểu Việt', () => {
    expect(ngayVn('2026-09-18')).toBe('18/09/2026');
    expect(ngayVn('2026-01-05')).toBe('05/01/2026');
  });
});
