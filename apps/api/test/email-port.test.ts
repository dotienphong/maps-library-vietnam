import { describe, expect, it, vi } from 'vitest';
import { chonEmailPort } from '../src/email/port';
import { resendPort } from '../src/email/resend';

const ENV_CO_KEY = {
  ENVIRONMENT: 'production',
  RESEND_API_KEY: 'khoa-gia',
  EMAIL_FROM: 'no-reply@vidu.vn',
  SUPPORT_EMAIL: 'ho-tro@vidu.vn',
};

describe('chonEmailPort', () => {
  it('có RESEND_API_KEY thì dùng Resend', () => {
    expect(chonEmailPort(ENV_CO_KEY).ten).toBe('resend');
  });

  it('ngoài production mà thiếu key thì dùng bản ghi log, không chặn phát triển', () => {
    expect(chonEmailPort({ ENVIRONMENT: 'dev' }).ten).toBe('debug');
  });

  it('production mà thiếu key thì KHÔNG âm thầm nuốt thư', async () => {
    const port = chonEmailPort({ ENVIRONMENT: 'production' });
    expect(port.ten).toBe('thieu-cau-hinh');
    await expect(port.send({ to: 'a@b.vn', subject: 's', html: 'h', text: 't' })).rejects.toThrow(
      'email_not_configured',
    );
  });
});

describe('resendPort', () => {
  it('gọi đúng endpoint, kèm Bearer, from và reply-to', async () => {
    const fetchGia = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'thu-1' }), { status: 200 }));
    const port = resendPort(ENV_CO_KEY, fetchGia as unknown as typeof fetch);
    const ketQua = await port.send({
      to: 'khach@vidu.vn',
      subject: 'Mã đăng nhập',
      html: '<p>123456</p>',
      text: '123456',
    });

    expect(ketQua.id).toBe('thu-1');
    const [url, init] = fetchGia.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer khoa-gia');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.from).toBe('no-reply@vidu.vn');
    expect(body.reply_to).toBe('ho-tro@vidu.vn');
    expect(body.to).toEqual(['khach@vidu.vn']);
    // Luôn gửi CẢ hai dạng: một số ứng dụng thư chỉ hiện bản chữ, và thiếu nó làm điểm spam xấu đi.
    expect(body.html).toBe('<p>123456</p>');
    expect(body.text).toBe('123456');
  });

  it('Resend trả lỗi thì ném, không nuốt', async () => {
    const fetchGia = vi.fn().mockResolvedValue(new Response('sai khoá', { status: 401 }));
    const port = resendPort(ENV_CO_KEY, fetchGia as unknown as typeof fetch);
    await expect(port.send({ to: 'a@b.vn', subject: 's', html: 'h', text: 't' })).rejects.toThrow(
      /email_send_failed/,
    );
  });

  it('thông điệp lỗi KHÔNG chứa nội dung phản hồi — nó có thể mang địa chỉ khách', async () => {
    const fetchGia = vi
      .fn()
      .mockResolvedValue(new Response('khach@vidu.vn bị chặn', { status: 422 }));
    const port = resendPort(ENV_CO_KEY, fetchGia as unknown as typeof fetch);
    await expect(
      port.send({ to: 'khach@vidu.vn', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow(/^email_send_failed_422$/);
  });
});
