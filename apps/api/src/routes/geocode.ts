import { normalizeVi } from '@mapslibvn/core';
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { geocode } from '../geocode';
import { clampInt, parseLatLngPair } from '../params';
import { quotaMiddleware } from '../quota';

export const geocodeRoute = new Hono<AppEnv>();

/**
 * Parse + validate MỘT lần cho mỗi request, nhớ kết quả trên context. Preflight của quota gọi nó
 * trước khi giữ lượt, handler gọi lại và nhận đúng object cũ — spec 14.4: tái dùng parser, không
 * parse hai lần. Thông điệp lỗi phải giữ nguyên vì preflight áp cho cả tenant legacy.
 */
function geocodeParams(c: import('hono').Context<AppEnv>) {
  const cached = c.get('params') as ReturnType<typeof parse> | undefined;
  if (cached) return cached;
  const parsed = parse();
  c.set('params', parsed);
  return parsed;

  function parse() {
    const query = (c.req.query('q') ?? '').trim();
    if (query.length < 2 || !normalizeVi(query))
      throw new ApiError(400, 'invalid_request', 'q phải có ít nhất 2 ký tự tra cứu được');
    return {
      query,
      near: parseLatLngPair(c.req.query('near'), 'near'),
      limit: clampInt(c.req.query('limit'), 1, 5, 5, 'limit'),
    };
  }
}

geocodeRoute.get(
  '/v1/geocode',
  requireAuth('places:read', { deferRevocation: true }),
  quotaMiddleware('places', geocodeParams),
  async (c) => {
    const { query, near, limit } = geocodeParams(c);
    const sql = getSql(c.env);
    try {
      return c.json({ items: await geocode(sql, query, near, limit) });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('geocode', error);
      throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  },
);
