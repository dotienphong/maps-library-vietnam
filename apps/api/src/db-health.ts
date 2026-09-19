import { endSql, getSql } from './db';
import type { Env } from './env';
import { ApiError, moTaLoi } from './errors';

/** Đúng kiểu `endSql` nhận: `c.executionCtx` của Hono không khớp ExecutionContext toàn cục. */
type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

export interface DbHealth {
  ok: boolean;
  user: string | undefined;
  version: string | undefined;
  word_similarity_threshold: number | null;
  schema_migration: string | null;
}

/**
 * Trạng thái DB cho `/healthz/db` (công khai) và `/v1/admin/health` (sau Access). Một hàm chứ
 * không hai: hai nơi đọc "DB có sống không" mà trả lời khác nhau là cách để một sự cố trông như
 * hai sự cố.
 */
export async function dbHealth(env: Env, ctx: WaitUntil): Promise<DbHealth> {
  const sql = getSql(env);
  try {
    // current_setting(…, true) trả NULL thay vì ném khi GUC chưa có: API deploy được trước khi
    // migration 0007 áp lên máy chủ mà /healthz/db không rơi xuống 503.
    const [row] = await sql<
      { ok: number; user: string; version: string; wst: string | null }[]
    >`SELECT 1 AS ok, current_user AS "user", version() AS version,
        current_setting('pg_trgm.word_similarity_threshold', true) AS wst`;
    // Phiên bản schema để phát hiện lệch giữa Worker đã deploy và DB. 06/09/2026: Worker mang code
    // đọc admin_area_old/admin_alias.old_area_id được deploy trước migration 0008, làm
    // /v1/autocomplete mặc định 503 suốt nhiều giờ mà /healthz/db vẫn 200. Postgres phân giải quan
    // hệ ngay lúc parse nên không lồng được vào câu trên: phải truy vấn riêng và nuốt lỗi.
    let schemaMigration: string | null = null;
    try {
      const [migration] = await sql<{ name: string | null }[]>`
        SELECT max(name) AS name FROM schema_migrations`;
      schemaMigration = migration?.name ?? null;
    } catch {
      schemaMigration = null;
    }
    return {
      ok: row?.ok === 1,
      user: row?.user,
      version: row?.version.split(' ').slice(0, 2).join(' '),
      word_similarity_threshold: row?.wst == null ? null : Number(row.wst),
      schema_migration: schemaMigration,
    };
  } catch (err) {
    console.error(`healthz/db: ${moTaLoi(err)}`, err);
    throw new ApiError(503, 'upstream_unavailable', 'Không nối được DB');
  } finally {
    endSql(ctx, sql);
  }
}
