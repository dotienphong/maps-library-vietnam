import { endSql, getSql } from '../db';
import type { Env } from '../env';

type Sql = ReturnType<typeof getSql>;

/** Gói miễn phí của Resend: 100 thư mỗi ngày cho cả tài khoản. */
export const TRAN_NGAY = 100;
/** Chừa cho mã đăng nhập; việc gửi hàng loạt dừng khi phần còn lại thấp hơn mức này. */
export const CHUA_CHO_OTP = 20;

/**
 * Đếm thư đã gửi trong ngày. Nguồn là `admin_audit` chứ không phải KV hay Rate Limiting binding:
 * Workers Free chỉ cho 1.000 lượt ghi KV mỗi ngày, còn binding Rate Limiting chỉ có chu kỳ 10
 * hoặc 60 giây. Một câu đếm trên bảng đã có chỉ mục `created_at` là rẻ nhất.
 *
 * Resend tính ngày theo UTC, nên mốc cũng phải là 00:00 UTC — dùng mốc giờ Việt Nam sẽ cho ra
 * con số lệch bảy tiếng đúng lúc gần chạm trần.
 */
export async function daGuiHomNay(
  env: Env,
  executionCtx: { waitUntil(promise: Promise<unknown>): void },
): Promise<number> {
  const sql = getSql(env);
  try {
    return await daGuiHomNayVoiSql(sql);
  } finally {
    endSql(executionCtx, sql);
  }
}

/** Đếm bằng client đang mở — cho webhook và cron, nơi đã có `sql` trong tay. */
export async function daGuiHomNayVoiSql(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM admin_audit
    WHERE action = 'email.sent'
      AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`;
  return rows[0]?.n ?? 0;
}

/** Còn chỗ để gửi một thư giao dịch (mã đăng nhập, chào mừng, biên nhận) không. */
export const conCho = (daGui: number): boolean => daGui < TRAN_NGAY;

/** Còn chỗ để gửi thư hàng loạt (nhắc hết hạn) không — phải chừa phần cho mã đăng nhập. */
export const conChoHangLoat = (daGui: number): boolean => daGui < TRAN_NGAY - CHUA_CHO_OTP;
