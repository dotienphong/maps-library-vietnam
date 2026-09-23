import { ApiError } from '../errors';

/**
 * Nhịp theo **khoá thuần**, không kèm IP: mục tiêu là giữ tải tổng lên engine, không phải chống spam
 * từ một địa chỉ. Áp cho CẢ khoá `server`, khác trần 100/phút của directions (vốn chỉ nhắm khoá công
 * khai `web`/`mobile`). Thiếu binding (dev, test chưa cấu hình) thì bỏ qua — cùng cách mọi limiter
 * khác trong mã này làm.
 *
 * Dùng cho `/v1/matrix` + `/v1/optimized-route` (`MATRIX_RATE_LIMITER`, 6/phút — spec 22/09/2026 mục
 * 6.3) và `/v1/fleet-plan` (`FLEET_RATE_LIMITER`, 2/phút — spec 23/09/2026 mục 4.7).
 */
export async function apDungNhip(
  limiter: RateLimit | undefined,
  keyHash: string,
  thongDiep: string,
): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key: keyHash });
  if (!success) throw new ApiError(429, 'rate_limit_exceeded', thongDiep, 60);
}

/**
 * Nhịp riêng cho ma trận và tối ưu thứ tự. Máy chủ 2 nhân, engine 1 luồng — đo 22/09 cho thấy năm
 * ma trận cỡ tối đa chạy song song đẩy p95 của `/v1/directions` lên 2,7–5,3 s cho mọi khách khác; với
 * burst 20/phút dùng chung, một khoá duy nhất đủ gây ra chuyện đó.
 */
export function apDungNhipMaTran(limiter: RateLimit | undefined, keyHash: string): Promise<void> {
  return apDungNhip(
    limiter,
    keyHash,
    'Gửi quá nhiều request ma trận / tối ưu thứ tự trong một phút',
  );
}
