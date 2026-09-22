import { ApiError } from '../errors';

/**
 * Nhịp riêng cho `/v1/matrix` và `/v1/optimized-route` (spec 22/09/2026 mục 6.3).
 *
 * Đếm theo **khoá thuần**, không kèm IP: mục tiêu là giữ tải tổng lên Valhalla, không phải chống spam
 * từ một địa chỉ. Máy chủ 2 nhân, engine 1 luồng — đo 22/09 cho thấy năm ma trận cỡ tối đa chạy song
 * song đẩy p95 của `/v1/directions` lên 2,7–5,3 s cho mọi khách khác; với burst 20/phút dùng chung,
 * một khoá duy nhất đủ gây ra chuyện đó. Áp cho CẢ khoá `server`, khác trần 100/phút của directions
 * (vốn chỉ nhắm khoá công khai `web`/`mobile`).
 *
 * Thiếu binding (dev, test chưa cấu hình) thì bỏ qua — cùng cách mọi limiter khác trong mã này làm.
 */
export async function apDungNhipMaTran(
  limiter: RateLimit | undefined,
  keyHash: string,
): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key: keyHash });
  if (!success) {
    throw new ApiError(
      429,
      'rate_limit_exceeded',
      'Gửi quá nhiều request ma trận / tối ưu thứ tự trong một phút',
      60,
    );
  }
}
