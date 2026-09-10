import type { Context } from 'hono';

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 429 | 503,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function errorResponse(c: Context, err: unknown) {
  const requestId = crypto.randomUUID();
  const e =
    err instanceof ApiError ? err : new ApiError(503, 'upstream_unavailable', 'Lỗi không xác định');
  if (!(err instanceof ApiError)) console.error(requestId, err);
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (e.status === 429) headers['retry-after'] = String(e.retryAfter ?? 3600);
  if (e.status === 503) headers['retry-after'] = '30';
  return c.body(
    JSON.stringify({ error: { code: e.code, message: e.message, request_id: requestId } }),
    e.status,
    headers,
  );
}
