import type { Context } from 'hono';
import { endSql, getSql } from './db';
import type { AppEnv } from './env';

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  detail?: Record<string, unknown>;
}

type Sql = ReturnType<typeof getSql>;

/**
 * Ghi một dòng nhật ký. Lỗi ở đây KHÔNG được làm hỏng thao tác chính: nhật ký là bằng chứng,
 * không phải điều kiện. Ném ra ngoài sẽ biến một lần duyệt đã thành công thành 503 cho người dùng.
 */
export async function writeAudit(sql: Sql, entry: AuditEntry): Promise<void> {
  try {
    await sql`INSERT INTO admin_audit (actor, action, target, detail)
      VALUES (${entry.actor}, ${entry.action}, ${entry.target ?? null},
              ${entry.detail ? JSON.stringify(entry.detail) : null}::jsonb)`;
  } catch (error) {
    console.error('admin_audit', error);
  }
}

/**
 * Ghi nhật ký cho một request đang xử lý. Chạy trong `waitUntil` nên không cộng độ trễ vào phản
 * hồi; mở client riêng vì client của nhánh chính có thể đã bị `endSql` đóng trước khi tới đây.
 */
export function audit(
  c: Context<AppEnv>,
  action: string,
  target?: string,
  detail?: Record<string, unknown>,
): void {
  const actor = c.get('reviewer') ?? '';
  if (!actor) return;
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
}
