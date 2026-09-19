import type { Context } from 'hono';
import { endSql, getSql } from './db';
import type { AppEnv } from './env';
import { moTaLoi } from './errors';

/**
 * Chỉ những gì sống sót qua `JSON.stringify`. Khai hẹp thay vì `unknown` để chỗ gọi không lỡ
 * nhét vào một Map/BigInt/hàm rồi phát hiện mất dữ liệu lúc đọc nhật ký — nơi không sửa lại được.
 */
type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  detail?: JsonObject;
}

type Sql = ReturnType<typeof getSql>;

/**
 * Ghi một dòng nhật ký. Lỗi ở đây KHÔNG được làm hỏng thao tác chính: nhật ký là bằng chứng,
 * không phải điều kiện. Ném ra ngoài sẽ biến một lần duyệt đã thành công thành 503 cho người dùng.
 */
export async function writeAudit(sql: Sql, entry: AuditEntry): Promise<void> {
  try {
    // Phải dùng sql.json(): truyền chuỗi đã JSON.stringify kèm cast ::jsonb khiến porsager
    // stringify lần nữa, và cột jsonb nhận về một *chuỗi* JSON — `detail->>'label'` rỗng, còn
    // người đọc nhật ký thấy một khối escape. Cùng bẫy mà edits.ts đã vấp với `changes`.
    await sql`INSERT INTO admin_audit (actor, action, target, detail)
      VALUES (${entry.actor}, ${entry.action}, ${entry.target ?? null},
              ${entry.detail ? sql.json(entry.detail) : null})`;
  } catch (error) {
    console.error(`admin_audit: ${moTaLoi(error)}`, error);
  }
}

/**
 * Actor của một dòng nhật ký. Người quản trị (email do Cloudflare Access xác thực) đứng trước;
 * khách đã đăng nhập ở cổng tự phục vụ ghi dưới dạng `customer:<email>`, để đọc nhật ký phân biệt
 * được hai loại người và một khách không bao giờ trông như một tài khoản có quyền Access.
 *
 * Sự cố phát hiện 19/09/2026: bản cũ chỉ đọc `reviewer`, mà không route nào của cổng khách hàng
 * đặt biến đó — nên mọi dòng `customer.*` VÀ `email.sent` của pha 2 rơi vào im lặng, và ngân sách
 * 100 thư/ngày của Resend (đếm bằng chính `email.sent`) chưa từng được tính.
 */
export function chonActor(bien: {
  reviewer?: string | undefined;
  customer?: { email: string } | undefined;
}): string {
  if (bien.reviewer) return bien.reviewer;
  if (bien.customer?.email) return `customer:${bien.customer.email}`;
  return '';
}

/**
 * Ghi nhật ký cho một request đang xử lý. Chạy trong `waitUntil` nên không cộng độ trễ vào phản
 * hồi; mở client riêng vì client của nhánh chính có thể đã bị `endSql` đóng trước khi tới đây.
 */
export function audit(
  c: Context<AppEnv>,
  action: string,
  target?: string,
  detail?: AuditEntry['detail'],
): void {
  const actor = chonActor({ reviewer: c.get('reviewer'), customer: c.get('customer') });
  if (!actor) return;
  try {
    const sql = getSql(c.env);
    c.executionCtx.waitUntil(
      writeAudit(sql, {
        actor,
        action,
        ...(target === undefined ? {} : { target }),
        ...(detail === undefined ? {} : { detail }),
      }).finally(() => {
        endSql(c.executionCtx, sql);
      }),
    );
  } catch (error) {
    // `c.executionCtx` NÉM khi ngữ cảnh không có nó — cùng lớp lỗi với việc mở client hỏng. Để nó
    // bay ra ngoài là biến một thao tác ĐÃ THÀNH CÔNG (khoá đã thu hồi, gói đã cấp) thành 503 cho
    // người gọi, đúng thứ hàm này tự nhận là không được làm. Mất một dòng nhật ký rẻ hơn nhiều.
    console.error(`admin_audit: ${moTaLoi(error)}`, error);
  }
}
