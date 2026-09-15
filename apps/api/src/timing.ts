import type { Context } from 'hono';
import type { AppEnv } from './env';

/**
 * Đo từng vòng gọi Durable Object rồi phát ra `Server-Timing`.
 *
 * Vì sao cần: đo A/B trên production 15/09/2026 cho thấy tenant thương mại chậm hơn tenant legacy
 * **677 ms p50** trên đường cache-hit, trong khi Task 0 đo cả ba vòng RPC ở staging chỉ 37 ms p95.
 * Từ số tổng không thể biết thời gian nằm ở đâu — chia đều ba vòng (object đặt xa Worker) hay dồn
 * vào một vòng (vấn đề khác hẳn, cách sửa khác hẳn). Đoán rồi tối ưu nhầm chỗ thì tốn một vòng
 * deploy và một lượt đo nữa.
 *
 * Đây là thời gian của CHÍNH request người gọi gửi, không phải số liệu nội bộ của khách khác.
 */
export async function timed<T>(
  c: Context<AppEnv>,
  name: string,
  call: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await call();
  } finally {
    // Ghi cả khi ném: một vòng gọi hỏng sau 2 giây cũng là thông tin cần thấy.
    c.set('quotaTimings', [...(c.get('quotaTimings') ?? []), { name, ms: Date.now() - started }]);
  }
}

/** Chuỗi `Server-Timing` theo chuẩn, hoặc null nếu request này không chạm Durable Object. */
export function serverTiming(c: Context<AppEnv>): string | null {
  const timings = c.get('quotaTimings');
  if (!timings || timings.length === 0) return null;
  return timings.map(({ name, ms }) => `${name};dur=${ms}`).join(', ');
}
