import { describe, expect, it } from 'vitest';
import { mauChaoMung, mauMaDangNhap } from '../src/email/mau';

describe('mauMaDangNhap', () => {
  const thu = mauMaDangNhap('123456', 10);

  it('mã có trong cả bản HTML lẫn bản chữ', () => {
    expect(thu.html).toContain('123456');
    expect(thu.text).toContain('123456');
  });

  it('mã KHÔNG nằm trong tiêu đề — tiêu đề hiện ở màn hình khoá, ai cầm máy cũng đọc được', () => {
    expect(thu.subject).not.toContain('123456');
  });

  it('tiêu đề ngắn dưới 78 ký tự để ứng dụng thư không cắt', () => {
    expect(thu.subject.length).toBeLessThan(78);
    expect(thu.subject.length).toBeGreaterThan(5);
  });

  it('nói rõ thời hạn và cách xử lý khi không phải mình xin', () => {
    expect(thu.text).toContain('10 phút');
    expect(thu.text.toLowerCase()).toContain('bỏ qua');
  });

  it('bản chữ không lẫn thẻ HTML', () => {
    expect(thu.text).not.toMatch(/<[a-z]/i);
  });
});

describe('mauChaoMung', () => {
  const thu = mauChaoMung('Công ty Thử', 'https://vidu.vn/console/', 'https://docs.vidu.vn');

  it('xưng đúng tên tổ chức và dẫn tới cả cổng lẫn tài liệu', () => {
    expect(thu.html).toContain('Công ty Thử');
    expect(thu.html).toContain('https://vidu.vn/console/');
    expect(thu.html).toContain('https://docs.vidu.vn');
    expect(thu.text).toContain('Công ty Thử');
  });

  it('KHÔNG chứa khoá API — khoá chỉ hiện đúng một lần trên màn hình, không đi qua thư', () => {
    expect(`${thu.html}${thu.text}`).not.toMatch(/mlv_live_/);
  });

  it('tiêu đề ngắn và không có từ ngữ kiểu thư rác', () => {
    expect(thu.subject.length).toBeLessThan(78);
    expect(thu.subject.toLowerCase()).not.toMatch(/miễn phí 100%|khuyến mãi|trúng thưởng|!!!/);
  });
});

describe('ngân sách thư ngày', () => {
  it('trần 100 và phần chừa cho mã đăng nhập nhỏ hơn hẳn', async () => {
    const { CHUA_CHO_OTP, TRAN_NGAY, conCho, conChoHangLoat } = await import(
      '../src/email/ngan-sach'
    );
    expect(TRAN_NGAY).toBe(100);
    expect(CHUA_CHO_OTP).toBeLessThan(TRAN_NGAY / 2);

    expect(conCho(99)).toBe(true);
    expect(conCho(100)).toBe(false);
    // Thư hàng loạt dừng SỚM hơn để mã đăng nhập luôn còn chỗ.
    expect(conChoHangLoat(79)).toBe(true);
    expect(conChoHangLoat(80)).toBe(false);
  });
});
