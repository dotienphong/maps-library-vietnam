import type { EmailPort, ThuGui } from './port';

/** Dùng khi phát triển: in tiêu đề ra log, KHÔNG in nội dung vì mã đăng nhập nằm trong đó. */
export function debugPort(): EmailPort {
  return {
    ten: 'debug',
    send(thu: ThuGui) {
      console.log(`[email:debug] tới ${thu.to} — ${thu.subject}`);
      return Promise.resolve({ id: `debug-${crypto.randomUUID()}` });
    },
  };
}
