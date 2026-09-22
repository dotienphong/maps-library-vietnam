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
});
