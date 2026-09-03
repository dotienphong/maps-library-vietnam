import type { Env } from '../env';
import { ApiError } from '../errors';

// Băm định danh cho đóng góp (spec 6.4/6.5): không lưu token/IP thô.
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `pepper` là bí mật phía máy chủ (`IP_HASH_PEPPER`): không có nó, dải IPv4 chỉ ~4 tỉ giá trị nên
 * ai lấy được bảng `poi_edit` là dò ngược ra IP trong vài phút. Xoay pepper làm hash cũ vô dụng.
 */
export const endUserHash = (tenantId: string, token: string, pepper: string) =>
  sha256Hex(`${pepper}:${tenantId}:${token}`);

/** ip_hash = sha256(pepper + ip + ngày VN) — salt xoay theo ngày, không liên kết được giữa các ngày. */
export const ipHash = (ip: string, day: string, pepper: string) =>
  sha256Hex(`${pepper}:${ip}:${day}`);

/** Từ chối ghi còn hơn ghi hash yếu: thiếu secret là lỗi cấu hình, không phải mặc định hợp lệ. */
export function requirePepper(env: Env): string {
  if (!env.IP_HASH_PEPPER)
    throw new ApiError(503, 'server_misconfigured', 'Máy chủ chưa cấu hình IP_HASH_PEPPER');
  return env.IP_HASH_PEPPER;
}
