import { COMPARISON } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import { CHUA_CO, doiDauGoogle, doiDauVietmap } from './doi-dau';

const NHOM_NGHIN = new Intl.NumberFormat('vi-VN');

describe('bảng đối đầu', () => {
  for (const [ten, bang] of [
    ['Google', doiDauGoogle()],
    ['VIETMAP', doiDauVietmap()],
  ] as const) {
    describe(ten, () => {
      it('ba hàng đầu là chi phí, lấy thẳng từ COMPARISON', () => {
        for (const [i, row] of COMPARISON.rows.entries()) {
          const hang = bang[i];
          expect(hang?.tieuChi).toContain(NHOM_NGHIN.format(row.places));
          expect(hang?.thang).toBe('ta');
        }
      });

      it('mọi hàng có đủ ba cột và một giá trị thắng hợp lệ', () => {
        for (const h of bang) {
          expect(h.tieuChi.length).toBeGreaterThan(2);
          expect(h.ta.length).toBeGreaterThan(0);
          expect(h.ho.length).toBeGreaterThan(0);
          expect(['ta', 'ho', 'hoa']).toContain(h.thang);
        }
      });

      it('có ít nhất hai hàng ĐỐI THỦ thắng — trang này không được giấu', () => {
        expect(bang.filter((h) => h.thang === 'ho').length).toBeGreaterThanOrEqual(2);
      });

      it('không hàng nào nhận "ta thắng" ở thứ MapsLibVN chưa làm', () => {
        for (const h of bang.filter((x) => x.thang === 'ta')) {
          for (const chua of CHUA_CO) {
            expect(h.tieuChi.toLowerCase(), h.tieuChi).not.toContain(chua.toLowerCase());
          }
        }
      });
    });
  }

  it('CHUA_CO không còn ma trận và tối ưu một xe, nhưng vẫn giữ đội xe nhiều xe (spec 22/09/2026)', () => {
    expect(CHUA_CO).toEqual([
      'tối ưu đội xe nhiều xe',
      'giao thông thời gian thực',
      'Street View',
      'ảnh vệ tinh',
    ]);
  });

  it('Google: một hàng HOÀ về ma trận/tối ưu thứ tự nêu đúng trần, một hàng ĐỐI THỦ thắng về đội xe', () => {
    const hoa = doiDauGoogle().find(
      (h) => h.tieuChi === 'Ma trận khoảng cách và tối ưu thứ tự điểm dừng',
    );
    expect(hoa?.thang).toBe('hoa');
    expect(hoa?.ta).toMatch(/50 cặp/);
    expect(hoa?.ta).toMatch(/8 điểm dừng/);
    const doiXe = doiDauGoogle().find((h) => h.tieuChi === 'Tối ưu đội xe nhiều xe');
    expect(doiXe?.thang).toBe('ho');
    expect(doiXe?.ta).toBe('Chưa có');
  });

  it('VIETMAP: hàng vận tải vẫn đối thủ thắng nhưng nói rõ đã có ma trận và tối ưu một xe', () => {
    const hang = doiDauVietmap().find(
      (h) => h.tieuChi === 'Bài toán vận tải và theo dõi phương tiện',
    );
    expect(hang?.thang).toBe('ho');
    expect(hang?.ta).toMatch(/ma trận khoảng cách/i);
    expect(hang?.ta).toMatch(/chưa có đội xe nhiều xe/);
  });
});
