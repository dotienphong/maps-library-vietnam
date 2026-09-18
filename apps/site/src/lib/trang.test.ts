import { describe, expect, it } from 'vitest';
import { NAV, TRANG, type TrangKey, trangTheoDuongDan } from './trang';

const KEYS = Object.keys(TRANG) as TrangKey[];

describe('TRANG', () => {
  it('phủ đủ các trang của spec mục 11.2', () => {
    expect(KEYS.sort()).toEqual(
      [
        'baiViet',
        'bangGia',
        'khong404',
        'lienHe',
        'soSanhGoogle',
        'soSanhVietmap',
        'tinhNang',
        'trangChu',
      ].sort(),
    );
  });

  it('title ≤ 60 ký tự — dài hơn thì Google cắt giữa chừng', () => {
    for (const key of KEYS) {
      expect(TRANG[key].title.length, `${key}: "${TRANG[key].title}"`).toBeLessThanOrEqual(60);
      expect(TRANG[key].title.length).toBeGreaterThan(10);
    }
  });

  it('description 120–160 ký tự — ngắn hơn thì Google tự viết lại, dài hơn thì bị cắt', () => {
    for (const key of KEYS) {
      const n = TRANG[key].description.length;
      expect(n, `${key}: ${n} ký tự`).toBeGreaterThanOrEqual(120);
      expect(n, `${key}: ${n} ký tự`).toBeLessThanOrEqual(160);
    }
  });

  it('đường dẫn duy nhất, bắt đầu và kết thúc bằng /', () => {
    const paths = KEYS.map((key) => TRANG[key].path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true);
      expect(path.endsWith('/')).toBe(true);
    }
  });

  it('mỗi trang có đúng một h1 khai trong bảng, khác title để không lặp từ khoá', () => {
    for (const key of KEYS) {
      expect(TRANG[key].h1.length).toBeGreaterThan(5);
    }
  });

  it('điều hướng chỉ trỏ tới trang có thật và không có 404', () => {
    for (const muc of NAV) {
      expect(KEYS).toContain(muc);
      expect(muc).not.toBe('khong404');
    }
  });

  it('trangTheoDuongDan tra ngược được, trả undefined cho đường lạ', () => {
    expect(trangTheoDuongDan('/bang-gia/')?.title).toBe(TRANG.bangGia.title);
    expect(trangTheoDuongDan('/khong-co-that/')).toBeUndefined();
  });
});
