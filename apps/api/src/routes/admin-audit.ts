import { Hono } from 'hono';
import { endSql, getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { parseAuditListParams } from './admin-audit-params';

/**
 * Nhóm route Nhật ký kiểm toán (pha 4). KHÔNG khai middleware ở đây: router này mount vào app
 * `admin`, nên nó nằm sau đúng một chỗ khai quyền (`/v1/admin/*`: chống CSRF rồi `requireAccess()`).
 *
 * Chỉ ĐỌC. Phần ghi đã chạy từ pha 0 (`src/audit.ts`), nên bảng đã có sẵn lịch sử của mọi việc làm
 * qua trang Admin từ 16/09/2026 — đó là lý do thiết kế xếp việc ghi ở pha 0 chứ không phải ở đây.
 */
export const adminAudit = new Hono<AppEnv>();

adminAudit.get('/v1/admin/audit', async (c) => {
  const params = parseAuditListParams(new URL(c.req.url).searchParams);
  const sql = getSql(c.env);
  try {
    // Lấy dư một dòng để biết còn trang sau, giống `/v1/admin/edits` — đếm tổng một bảng chỉ có
    // thêm vào là quét toàn phần để trả lời một câu hỏi không ai hỏi.
    const rows = await sql`
      SELECT a.id::text AS id, a.actor, a.action, a.target, a.detail, a.created_at
      FROM admin_audit a
      WHERE (${params.actor}::text IS NULL OR a.actor = ${params.actor})
        AND (${params.action}::text IS NULL OR a.action = ${params.action})
        -- ::text::timestamptz chứ không bind thẳng Date: bind timestamp qua Hyperdrive rụng mất
        -- micro giây, và một dòng nhật ký ghi đúng mốc lọc sẽ lọt hoặc lặp.
        AND (${params.from}::text IS NULL OR a.created_at >= ${params.from}::text::timestamptz)
        AND (${params.to}::text IS NULL OR a.created_at < ${params.to}::text::timestamptz)
        AND (${params.cursor}::text IS NULL OR a.id < ${params.cursor}::text::bigint)
      ORDER BY a.id DESC
      LIMIT ${params.limit + 1}`;

    const hasMore = rows.length > params.limit;
    const items = hasMore ? rows.slice(0, params.limit) : rows;
    const last = items.at(-1);
    return c.json({ items, nextCursor: hasMore && last ? String(last.id) : null }, 200, {
      'cache-control': 'private, no-store',
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/audit', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
  } finally {
    endSql(c.executionCtx, sql);
  }
});
