import { describe, expect, it } from 'vitest';
import { laTenViet, vungCua, vungQuanDao } from '../src/lib/quan-dao.mjs';

describe('vungCua — vùng hai quần đảo (PHONG chốt 26/09/2026)', () => {
  it.each([
    ['Song Tử Tây', 114.331, 11.429, 'truong_sa'],
    ['Trường Sa Lớn', 111.92, 8.645, 'truong_sa'],
    ['An Bang', 112.921, 7.892, 'truong_sa'],
    ['Hoa Lau (nước khác giữ, vẫn là Trường Sa)', 113.821, 7.375, 'truong_sa'],
    ['Vành Khăn', 115.539, 9.916, 'truong_sa'],
    ['Phú Lâm', 112.341, 16.834, 'hoang_sa'],
    ['Tri Tôn', 111.203, 15.785, 'hoang_sa'],
    ['Linh Côn', 112.73, 16.667, 'hoang_sa'],
  ])('%s nằm trong vùng', (_ten, lon, lat, vung) => {
    expect(vungCua(lon, lat)).toBe(vung);
  });

  // Đa giác Trường Sa khoét đất Sabah/Palawan: dùng thẳng bbox của patch tiles thì reverse geocode
  // và poi-admin sẽ gắn "Đặc khu Trường Sa, Khánh Hòa" cho đất Malaysia/Philippines.
  it.each([
    ['Kudat (Sabah)', 116.85, 6.88],
    ['Kota Belud (Sabah)', 116.43, 6.35],
    ['Banggi (Sabah)', 117.1, 7.25],
    ['Balabac (Palawan)', 117.05, 7.98],
    ['Quezon (Palawan)', 117.99, 9.23],
    ['Sanya (Hải Nam)', 109.5, 18.25],
    ['Lý Sơn (đảo ven bờ, không thuộc hai quần đảo)', 109.12, 15.38],
    ['Hà Nội', 105.85, 21.03],
  ])('%s nằm ngoài', (_ten, lon, lat) => {
    expect(vungCua(lon, lat)).toBeNull();
  });

  it('mỗi vùng mang tên đặc khu và tỉnh để dựng admin_area', () => {
    expect(vungQuanDao().map((v) => [v.region, v.ten, v.tinh])).toEqual([
      ['hoang_sa', 'Đặc khu Hoàng Sa', 'Đà Nẵng'],
      ['truong_sa', 'Đặc khu Trường Sa', 'Khánh Hòa'],
    ]);
  });
});

describe('laTenViet — tên tiếng Việt, không chữ Hán, không tên Latin nước ngoài', () => {
  it.each(['Đảo Song Tử Tây', 'Hải đăng Đá Lát', 'Chùa Trường Sa Lớn', 'Đá Chữ Thập'])(
    '%s là tên Việt',
    (ten) => {
      expect(laTenViet(ten)).toBe(true);
    },
  );

  it.each([
    'Parola Lighthouse',
    'Pag-asa Island',
    // Không dấu thì không phân biệt được với tên Latin nước ngoài → không nhận, trừ khi có name:vi.
    'An Bang',
    '永兴岛',
    'Đảo 永兴',
    '',
  ])('%s không phải tên Việt', (ten) => {
    expect(laTenViet(ten)).toBe(false);
  });
});
