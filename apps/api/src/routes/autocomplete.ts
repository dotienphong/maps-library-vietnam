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

/**
 * Parse + validate MỘT lần mỗi request, nhớ trên context: preflight quota gọi trước khi giữ lượt,
 * handler gọi lại nhận đúng object cũ — spec 14.4 cấm parse hai lần. Thông điệp lỗi phải giữ
 * nguyên vì preflight áp cho cả tenant legacy đang chạy.
 */
function autocompleteParams(c: import('hono').Context<AppEnv>) {
  const cached = c.get('params') as ReturnType<typeof parse> | undefined;
  if (cached) return cached;
  const parsed = parse();
  c.set('params', parsed);
  return parsed;

  function parse() {
    const query = (c.req.query('q') ?? '').trim();
    if (query.length < 2) throw new ApiError(400, 'invalid_request', 'q phải có ít nhất 2 ký tự');
    const queryNorm = normalizeVi(query);
    if (!queryNorm) throw new ApiError(400, 'invalid_request', 'q không có ký tự tra cứu được');
    return {
      query,
      queryNorm,
      near: parseLatLngPair(c.req.query('near'), 'near'),
      limit: clampInt(c.req.query('limit'), 1, 10, 10, 'limit'),
      types: parseTypes(c.req.query('types')),
      sources: parseSources(c.req.query('sources')),
    };
  }
}

export const autocompleteCacheUrl = (input: {
  queryNorm: string;
  grid: string;
  typeKey: string;
  sourceKey: string;
  limit: number;
}) =>
  `https://cache.mapslibvn/autocomplete?v=alt1&qn=${encodeURIComponent(input.queryNorm)}&g=${input.grid}&t=${input.typeKey}&s=${input.sourceKey}&l=${input.limit}`;

autocomplete.get(
  '/v1/autocomplete',
  requireAuth('places:read', { deferRevocation: true }),
  quotaMiddleware('places', autocompleteParams),
  async (c) => {
    const { query, queryNorm, near, limit, types, sources } = autocompleteParams(c);
    const queryCore = nameCore(query) || queryNorm;
    // Biến thể địa danh áp NGAY trên truy vấn (spec 6.1), nên không phải chờ pipeline điền name_key.
    const queryAlias = applyToponymAlias(queryNorm);
    // Bậc 2 và 3 chỉ chạy khi bậc 1 thiếu; tính sẵn ở đây vì cả hai là hàm thuần của truy vấn.
    const tsQuery = tsQueryFor(queryNorm);
    const queryKey = viKey(queryAlias);
    const queryStartsWithDigit = /^\d/.test(queryNorm);
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
  },
);
