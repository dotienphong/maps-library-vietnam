import { applyToponymAlias, normalizeVi } from '@mapslibvn/core';
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { useSimilarityBranch } from '../autocomplete-sql';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { clampInt, parseBbox, parseLatLngPair, parseSources } from '../params';
import { type PlaceRow, placeColumns, toPlace } from '../place';
import { poiSourceFilter } from '../poi-sources';
import { quotaMiddleware } from '../quota';

export const search = new Hono<AppEnv>();

/**
 * Parse + validate MỘT lần mỗi request, nhớ trên context: preflight quota gọi trước khi giữ lượt,
 * handler gọi lại nhận đúng object cũ — spec 14.4 cấm parse hai lần.
 */
function searchParams(c: import('hono').Context<AppEnv>) {
  const cached = c.get('params') as ReturnType<typeof parse> | undefined;
  if (cached) return cached;
  const parsed = parse();
  c.set('params', parsed);
  return parsed;

  function parse() {
    const query = (c.req.query('q') ?? '').trim();
    const category = c.req.query('category');
    const near = parseLatLngPair(c.req.query('near'), 'near');
    const bbox = parseBbox(c.req.query('bbox'));
    if (!query && !category && !near && !bbox)
      throw new ApiError(400, 'invalid_request', 'Cần ít nhất một trong q, category, near, bbox');
    const queryNorm = query ? normalizeVi(query) : '';
    if (query && !queryNorm)
      throw new ApiError(400, 'invalid_request', 'q không có ký tự tra cứu được');
    return {
      query,
      category,
      near,
      bbox,
      queryNorm,
      radius: clampInt(c.req.query('radius'), 1, 50_000, 5_000, 'radius'),
      limit: clampInt(c.req.query('limit'), 1, 50, 20, 'limit'),
      offset: clampInt(c.req.query('offset'), 0, 500, 0, 'offset'),
      sources: parseSources(c.req.query('sources')),
    };
  }
}

search.get(
  '/v1/search',
  requireAuth('places:read', { deferRevocation: true }),
  quotaMiddleware('places', searchParams),
  async (c) => {
    const { query, category, near, bbox, queryNorm, radius, limit, offset, sources } =
      searchParams(c);
    // LIKE tận dụng gin_trgm_ops; starts_with trong OR buộc quét cả bảng (xem 72f78a2).
    const prefixPattern = `${queryNorm.replace(/[\\%_]/g, '\\$&')}%`;
    const fuzzy = useSimilarityBranch(queryNorm);
    const queryAlias = applyToponymAlias(queryNorm);

    const sql = getSql(c.env);
    try {
      const nearPoint = near ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)` : null;
      const rows = await sql<PlaceRow[]>`
      SELECT ${placeColumns(sql)}, count(*) OVER() AS total
        ${nearPoint ? sql`, ST_DistanceSphere(p.geom, ${nearPoint}) AS d` : sql``}
      FROM poi p LEFT JOIN category c ON c.code = p.category
      WHERE p.status = 'active'
        AND ${poiSourceFilter(sql, sources)}
        ${
          queryNorm
            ? sql`AND (${queryNorm} <% p.name_norm
                ${fuzzy ? sql`OR p.name_norm % ${queryNorm}` : sql``}
                ${queryAlias !== queryNorm ? sql`OR ${queryAlias} <% p.name_norm` : sql``}
                OR ${queryNorm} <% p.name_alt_norm
                OR p.name_norm LIKE ${prefixPattern})`
            : sql``
        }
        ${category ? sql`AND p.category = ${category}` : sql``}
        ${nearPoint ? sql`AND ST_DWithin(p.geom::geography, ${nearPoint}::geography, ${radius})` : sql``}
        ${bbox ? sql`AND p.geom && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)` : sql``}
      ORDER BY ${
        queryNorm
          ? sql`greatest(word_similarity(${queryNorm}, p.name_norm), similarity(p.name_norm, ${queryNorm})) DESC, p.popularity DESC NULLS LAST`
          : nearPoint
            ? sql`d ASC`
            : sql`p.updated_at DESC`
      }
      LIMIT ${limit} OFFSET ${offset}`;
      return c.json({
        items: rows.map(toPlace),
        total: rows[0]?.total ? Number(rows[0].total) : 0,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('search', error);
      throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  },
);
