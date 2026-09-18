import type { Context, Next } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { docPhien, giaHanPhien, voiSql, xoaPhienCuaTaiKhoan } from './db';
import {
  bamToken,
  docCookiePhien,
  dungCookiePhien,
  dungCookieXoa,
  hanPhienMoi,
  nenGiaHan,
} from './session';

/**
 * Cổng cho mọi route `/v1/console/*` cần đăng nhập. Ba điều đáng nói:
 *
 * 1. Kiểm `disabled_at` ở MỖI request và không cache. Vô hiệu hoá một tài khoản phải có hiệu lực
 *    ngay, không phải sau khi phiên tự hết hạn ba mươi ngày nữa.
 * 2. Trả 401 dạng JSON, không chuyển hướng. SPA đọc mã lỗi rồi tự đưa về màn đăng nhập kèm
 *    `?next=`; một chuyển hướng ở đây sẽ biến lời gọi API thành một trang HTML mà client không
 *    parse được — đúng lỗi mà trang Admin từng gặp với Cloudflare Access.
 * 3. Gia hạn trượt chỉ ghi DB khi phiên đã đi quá nửa đời, để mỗi request không kéo theo một
 *    lượt ghi.
 */
export function requireCustomer() {
  return async (c: Context<AppEnv>, next: Next) => {
    const pepper = c.env.SESSION_PEPPER;
    if (!pepper) {
      // Cùng cách IP_HASH_PEPPER đã làm cho /v1/edits: thiếu bí mật thì dừng hẳn, không băm yếu.
      throw new ApiError(503, 'server_misconfigured', 'Thiếu SESSION_PEPPER');
    }

    const token = docCookiePhien(c.req.header('Cookie') ?? null);
    if (!token) throw new ApiError(401, 'not_signed_in', 'Chưa đăng nhập');

    const tokenHash = await bamToken(token, pepper);
    const phien = await voiSql(c.env, c.executionCtx, (sql) => docPhien(sql, tokenHash));
    if (!phien) throw new ApiError(401, 'not_signed_in', 'Phiên đã hết hạn hoặc không tồn tại');

    if (phien.disabledAt) {
      // Xoá sạch phiên của tài khoản bị khoá ngay tại đây: để lại chúng nghĩa là mỗi lần khách
      // thử lại hệ thống phải tra DB thêm một lượt cho một tài khoản không bao giờ vào được.
      c.executionCtx.waitUntil(
        voiSql(c.env, c.executionCtx, (sql) => xoaPhienCuaTaiKhoan(sql, phien.accountId)),
      );
      c.header('Set-Cookie', dungCookieXoa());
      throw new ApiError(403, 'account_disabled', 'Tài khoản đã bị vô hiệu hoá');
    }

    if (nenGiaHan(phien.expiresAt)) {
      const han = hanPhienMoi();
      c.executionCtx.waitUntil(
        voiSql(c.env, c.executionCtx, (sql) => giaHanPhien(sql, tokenHash, han)),
      );
      c.header('Set-Cookie', dungCookiePhien(token));
    }

    c.set('customer', {
      accountId: phien.accountId,
      email: phien.email,
      name: phien.name,
      tenantId: phien.tenantId,
      tenantName: phien.tenantName,
      tokenHash,
    });
    await next();
  };
}
