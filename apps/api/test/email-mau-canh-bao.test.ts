import { describe, expect, it } from 'vitest';
import { mauCanhBaoSucKhoe } from '../src/email/mau-canh-bao';

const LUC = '2026-09-20T03:05:12.000Z'; // 10:05 giờ Việt Nam
const ADMIN = 'https://api.test/admin/health';

describe('mauCanhBaoSucKhoe', () => {
  it('một thành phần hỏng: tiêu đề nói tên, thân nói lỗi nguyên văn, có cả html và text', () => {
    const thu = mauCanhBaoSucKhoe({
      hong: [{ ten: 'Định tuyến', loi: 'Dịch vụ chỉ đường không phản hồi' }],
      phucHoi: [],
      luc: LUC,
      adminUrl: ADMIN,
    });
    expect(thu.subject).toBe('[MapsLibVN] HỎNG: Định tuyến');
    expect(thu.text).toContain('Dịch vụ chỉ đường không phản hồi');
    expect(thu.text).toContain('10:05 20/09/2026');
    expect(thu.text).toContain(ADMIN);
    expect(thu.html).toContain('Dịch vụ chỉ đường không phản hồi');
    expect(thu.html).toContain(`href="${ADMIN}"`);
  });

  it('phục hồi một thành phần: tiêu đề có thời gian hỏng', () => {
    const thu = mauCanhBaoSucKhoe({
      hong: [],
      phucHoi: [{ ten: 'Định tuyến', hongPhut: 23 }],
      luc: LUC,
      adminUrl: ADMIN,
    });
    expect(thu.subject).toBe('[MapsLibVN] PHỤC HỒI: Định tuyến (hỏng 23 phút)');
    expect(thu.text).toContain('phục hồi sau 23 phút hỏng');
  });

  it('gộp nhiều thay đổi trong một thư, tiêu đề liệt kê hết', () => {
    const thu = mauCanhBaoSucKhoe({
      hong: [
        { ten: 'Cơ sở dữ liệu', loi: 'Không nối được DB' },
        { ten: 'Định tuyến', loi: 'Dịch vụ chỉ đường không phản hồi' },
      ],
      phucHoi: [{ ten: 'Dữ liệu', hongPhut: 5 }],
      luc: LUC,
      adminUrl: null,
    });
    expect(thu.subject).toBe('[MapsLibVN] HỎNG: Cơ sở dữ liệu, Định tuyến · PHỤC HỒI: Dữ liệu');
    expect(thu.text).not.toContain('http');
  });

  it('thông điệp lỗi có ký tự HTML thì được escape trong bản html', () => {
    const thu = mauCanhBaoSucKhoe({
      hong: [{ ten: 'Dữ liệu', loi: 'Thiếu <vn> & poi' }],
      phucHoi: [],
      luc: LUC,
      adminUrl: null,
    });
    expect(thu.html).toContain('Thiếu &lt;vn&gt; &amp; poi');
    expect(thu.text).toContain('Thiếu <vn> & poi');
  });
});
