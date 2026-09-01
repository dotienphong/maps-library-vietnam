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

geocodeRoute.get('/v1/geocode', requireAuth(), quotaMiddleware('places'), async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  if (query.length < 2 || !normalizeVi(query)) {
    throw new ApiError(400, 'invalid_request', 'q phải có ít nhất 2 ký tự tra cứu được');
  }
  const near = parseLatLngPair(c.req.query('near'), 'near');
  const limit = clampInt(c.req.query('limit'), 1, 5, 5, 'limit');
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
});
