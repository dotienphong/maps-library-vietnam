import {
  applyToponymAlias,
  nameCore,
  normalizeVi,
  parseAddress,
  poiSourcesKey,
  viKey,
} from '@mapslibvn/core';
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { collectCandidates } from '../autocomplete-sql';
import { cachedJson } from '../cache';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { clampInt, parseLatLngPair, parseSources, parseTypes } from '../params';
import { quotaMiddleware } from '../quota';
import { gridKey, isAdminOnlyQuery, rankScore, withAreaSlot } from '../ranking';
import { telexFallback, tsQueryFor } from '../stages';

export const autocomplete = new Hono<AppEnv>();

export const autocompleteCacheUrl = (input: {
  queryNorm: string;
  grid: string;
  typeKey: string;
  sourceKey: string;
  limit: number;
}) =>
  `https://cache.mapslibvn/autocomplete?v=alt1&qn=${encodeURIComponent(input.queryNorm)}&g=${input.grid}&t=${input.typeKey}&s=${input.sourceKey}&l=${input.limit}`;

autocomplete.get('/v1/autocomplete', requireAuth(), quotaMiddleware('places'), async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  if (query.length < 2) {
    throw new ApiError(400, 'invalid_request', 'q phải có ít nhất 2 ký tự');
  }
  const near = parseLatLngPair(c.req.query('near'), 'near');
  const limit = clampInt(c.req.query('limit'), 1, 10, 10, 'limit');
  const types = parseTypes(c.req.query('types'));
  const sources = parseSources(c.req.query('sources'));
  const queryNorm = normalizeVi(query);
  const queryCore = nameCore(query) || queryNorm;
  // Biến thể địa danh áp NGAY trên truy vấn (spec 6.1), nên không phải chờ pipeline điền name_key.
  const queryAlias = applyToponymAlias(queryNorm);
  // Bậc 2 và 3 chỉ chạy khi bậc 1 thiếu; tính sẵn ở đây vì cả hai là hàm thuần của truy vấn.
  const tsQuery = tsQueryFor(queryNorm);
  const queryKey = viKey(queryAlias);
  const queryStartsWithDigit = /^\d/.test(queryNorm);
  if (!queryNorm) {
    throw new ApiError(400, 'invalid_request', 'q không có ký tự tra cứu được');
  }
  // LIKE tận dụng gin_trgm_ops; escape wildcard để giữ đúng nghĩa tiền tố.
  const prefixPattern = `${queryNorm.replace(/[\\%_]/g, '\\$&')}%`;

  // Cache 10 phút theo (q_norm, lưới near, types, sources, limit); stale-if-error 1 giờ.
  const grid = near ? gridKey(near.lat, near.lng) : '-';
  const typeKey = [...types].sort().join('_');
  const sourceKey = poiSourcesKey(sources).replace(/,/g, '_');
  const cacheUrl = autocompleteCacheUrl({ queryNorm, grid, typeKey, sourceKey, limit });

  const response = await cachedJson(c.executionCtx, cacheUrl, 600, 3600, async () => {
    const sql = getSql(c.env);
    try {
      const parsed = parseAddress(query);
      const rows = await collectCandidates(
        sql,
        {
          queryNorm,
          queryCore,
          queryAlias,
          prefixPattern,
          near,
          parsed,
          sources,
          tsQuery,
          queryKey,
        },
        types,
      );
      // Bậc 3b (spec 5.6): chỉ khi cờ bật VÀ mọi bậc trước rỗng. Chuỗi đã gập là một queryNorm
      // khác nên không đụng cache của chuỗi gốc.
      const folded = telexFallback({
        enabled: c.env.AUTOCOMPLETE_TELEX === '1',
        have: rows.length,
        queryNorm,
      });
      if (folded) {
        const foldedAlias = applyToponymAlias(folded);
        const retry = await collectCandidates(
          sql,
          {
            queryNorm: folded,
            queryCore: nameCore(folded) || folded,
            queryAlias: foldedAlias,
            prefixPattern: `${folded.replace(/[\\%_]/g, '\\$&')}%`,
            near,
            parsed,
            sources,
            tsQuery: tsQueryFor(folded),
            queryKey: viKey(foldedAlias),
          },
          types,
        );
        rows.push(...retry.map((row) => ({ ...row, stage: 3 as const })));
      }
      const items = rows
        .map((row) => ({
          type: row.type,
          ...(row.id ? { id: row.id } : {}),
          name: row.name,
          secondary: row.secondary ?? '',
          lat: row.lat,
          lng: row.lng,
          ...(row.precision ? { precision: row.precision } : {}),
          ...(row.bbox ? { bbox: row.bbox.map(Number) } : {}),
          ...(row.matched_alt ? { matched_alt: row.matched_alt } : {}),
          score:
            Math.round(
              rankScore({
                sim: Number(row.sim),
                prefix: row.prefix,
                dMeters: row.d === null ? null : Number(row.d),
                pop: Number(row.pop),
                type: row.type,
                qStartsWithDigit: queryStartsWithDigit,
                stage: row.stage ?? 1,
              }) * 1000,
            ) / 1000,
        }))
        .sort((a, b) => b.score - a.score);
      // 0 = không có kết quả nào; phân biệt với -1 (route khác) trong analytics.
      c.set('stageHit', rows.length ? Math.max(...rows.map((row) => row.stage ?? 1)) : 0);
      return { items: withAreaSlot(items, limit, isAdminOnlyQuery(parsed)) };
    } catch (error) {
      console.error('autocomplete', error);
      throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  });
  // cachedJson bỏ qua callback khi trúng cache, nên stageHit chưa được đặt. Phải phân biệt ba
  // trạng thái, nếu không thì tỷ lệ truy vấn rỗng (thứ quyết định có bật Telex hay không) sai:
  // -1 route khác, -2 trúng cache (không chạy bậc nào), 0 chạy mà rỗng, 1..3 bậc cho kết quả.
  if (c.get('stageHit') === undefined) c.set('stageHit', -2);
  return response;
});
