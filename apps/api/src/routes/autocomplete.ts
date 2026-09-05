import { nameCore, normalizeVi, parseAddress } from '@mapslibvn/core';
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { collectCandidates } from '../autocomplete-sql';
import { cachedJson } from '../cache';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { clampInt, parseLatLngPair, parseTypes } from '../params';
import { quotaMiddleware } from '../quota';
import { gridKey, rankScore } from '../ranking';

export const autocomplete = new Hono<AppEnv>();

autocomplete.get('/v1/autocomplete', requireAuth(), quotaMiddleware('places'), async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  if (query.length < 2) {
    throw new ApiError(400, 'invalid_request', 'q phải có ít nhất 2 ký tự');
  }
  const near = parseLatLngPair(c.req.query('near'), 'near');
  const limit = clampInt(c.req.query('limit'), 1, 10, 10, 'limit');
  const types = parseTypes(c.req.query('types'));
  const queryNorm = normalizeVi(query);
  const queryCore = nameCore(query) || queryNorm;
  const queryStartsWithDigit = /^\d/.test(queryNorm);
  if (!queryNorm) {
    throw new ApiError(400, 'invalid_request', 'q không có ký tự tra cứu được');
  }
  // LIKE tận dụng gin_trgm_ops; escape wildcard để giữ đúng nghĩa tiền tố.
  const prefixPattern = `${queryNorm.replace(/[\\%_]/g, '\\$&')}%`;

  // Cache 10 phút theo (q_norm, lưới near, types, limit); stale-if-error 1 giờ.
  const grid = near ? gridKey(near.lat, near.lng) : '-';
  const typeKey = [...types].sort().join('_');
  const cacheUrl = `https://cache.mapslibvn/autocomplete?qn=${encodeURIComponent(queryNorm)}&g=${grid}&t=${typeKey}&l=${limit}`;

  const response = await cachedJson(c.executionCtx, cacheUrl, 600, 3600, async () => {
    const sql = getSql(c.env);
    try {
      const rows = await collectCandidates(
        sql,
        { queryNorm, queryCore, prefixPattern, near, parsed: parseAddress(query) },
        types,
      );
      const items = rows
        .map((row) => ({
          type: row.type,
          ...(row.id ? { id: row.id } : {}),
          name: row.name,
          secondary: row.secondary ?? '',
          lat: row.lat,
          lng: row.lng,
          ...(row.precision ? { precision: row.precision } : {}),
          score:
            Math.round(
              rankScore({
                sim: Number(row.sim),
                prefix: row.prefix,
                dMeters: row.d === null ? null : Number(row.d),
                pop: Number(row.pop),
                type: row.type,
                qStartsWithDigit: queryStartsWithDigit,
              }) * 1000,
            ) / 1000,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return { items };
    } catch (error) {
      console.error('autocomplete', error);
      throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  });
  return response;
});
