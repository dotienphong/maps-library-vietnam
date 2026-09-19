import type { Env } from '../env';
import { moTaLoi } from '../errors';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Kiểm token Turnstile. Ba quy tắc, đều có bài test:
 *
 *  - Vắng secret ở **production** thì TỪ CHỐI. Quên cấu hình không được phép biến thành "tắt chống
 *    bot", vì đó là kiểu hỏng im lặng và chỉ lộ ra khi đã có ai đó đăng ký hàng nghìn tài khoản.
 *  - Vắng secret ngoài production thì cho qua kèm cảnh báo, để chạy ở máy không cần khoá thật.
 *  - Mọi lỗi mạng đều tính là KHÔNG qua. Cổng chống lạm dụng mà "lỗi thì cho qua" là cổng không tồn tại.
 */
export async function kiemTurnstile(
  env: Pick<Env, 'ENVIRONMENT' | 'TURNSTILE_SECRET'>,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) {
    if (env.ENVIRONMENT === 'production') return false;
    console.warn(
      '[turnstile] thiếu TURNSTILE_SECRET — bỏ qua kiểm, chỉ chấp nhận ngoài production',
    );
    return true;
  }
  if (!token) return false;

  try {
    const res = await fetchImpl(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }).toString(),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch (error) {
    console.error(`[turnstile] siteverify lỗi: ${moTaLoi(error)}`, error);
    return false;
  }
}
