import type { Context } from 'hono';

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * Một dòng đọc được cho log, từ một lỗi bất kỳ.
 *
 * Vì sao cần: Workers Observability nhận một `Error` thì chỉ giữ lại stack, nên mọi sự cố 503
 * trong log chỉ hiện "at <hàm> (index.js:…)" — biết hỏng ở đâu nhưng không biết hỏng vì gì. Ngày
 * 19/09/2026 mất hai lần truy vết dài chỉ để biết hai con số đáng lẽ nằm sẵn trong log:
 * `401` của Resend và `permission denied` của Postgres.
 *
 * Lấy `message` cộng với `code` và `constraint` mà driver Postgres gắn vào lỗi — cả ba đều là mô
 * tả về lược đồ, không phải dữ liệu của khách. KHÔNG lấy `detail`: Postgres nhét nguyên nội dung
 * dòng vi phạm vào đó, tức là email và khoá băm của người thật sẽ chảy thẳng vào log.
 */
export function moTaLoi(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const them = err as { code?: unknown; constraint_name?: unknown; table_name?: unknown };
  const phan = [err.message];
  if (typeof them.code === 'string') phan.push(`code=${them.code}`);
  if (typeof them.table_name === 'string') phan.push(`bảng=${them.table_name}`);
  if (typeof them.constraint_name === 'string') phan.push(`ràng buộc=${them.constraint_name}`);
  return phan.join(' | ');
}

export function errorResponse(c: Context, err: unknown) {
  const requestId = crypto.randomUUID();
  const e =
    err instanceof ApiError ? err : new ApiError(503, 'upstream_unavailable', 'Lỗi không xác định');
  if (!(err instanceof ApiError)) console.error(requestId, moTaLoi(err), err);
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (e.status === 429 && e.retryAfter !== undefined) headers['retry-after'] = String(e.retryAfter);
  if (e.status === 503) headers['retry-after'] = '30';
  return c.body(
    JSON.stringify({
      error: {
        code: e.code,
        message: e.message,
        request_id: requestId,
        ...(e.details ? { details: e.details } : {}),
      },
    }),
    e.status,
    headers,
  );
}
