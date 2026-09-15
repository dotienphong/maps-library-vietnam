import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { clampInt, parseSources } from '../params';
import { type PlaceRow, placeColumns, toPlace } from '../place';
import { poiSourceFilter } from '../poi-sources';
import { quotaMiddleware } from '../quota';

export const nearby = new Hono<AppEnv>();

/**
 * Parse + validate MỘT lần mỗi request, nhớ trên context: preflight quota gọi trước khi giữ lượt,
 * handler gọi lại nhận đúng object cũ — spec 14.4 cấm parse hai lần.
 */
function nearbyParams(c: import('hono').Context<AppEnv>) {
  const cached = c.get('params') as ReturnType<typeof parse> | undefined;
  if (cached) return cached;
  const parsed = parse();
  c.set('params', parsed);
  return parsed;

  function parse() {
    const latRaw = c.req.query('lat')?.trim();
    const lngRaw = c.req.query('lng')?.trim();
    const lat = latRaw ? Number(latRaw) : Number.NaN;
    const lng = lngRaw ? Number(lngRaw) : Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      throw new ApiError(400, 'invalid_request', 'lat, lng bắt buộc và phải hợp lệ');
    return {
      lat,
      lng,
      radius: clampInt(c.req.query('radius'), 1, 5_000, 500, 'radius'),
      limit: clampInt(c.req.query('limit'), 1, 100, 20, 'limit'),
      sources: parseSources(c.req.query('sources')),
    };
  }
}

nearby.get(
  '/v1/nearby',
  requireAuth('places:read', { deferRevocation: true }),
  quotaMiddleware('places', nearbyParams),
  async (c) => {
    const { lat, lng, radius, limit, sources } = nearbyParams(c);
    const category = c.req.query('category');
    const sql = getSql(c.env);
    try {
      const point = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;
      const rows = await sql<PlaceRow[]>`
      SELECT ${placeColumns(sql)}, ST_DistanceSphere(p.geom, ${point}) AS d
      FROM poi p LEFT JOIN category c ON c.code = p.category
      WHERE p.status = 'active'
        AND ${poiSourceFilter(sql, sources)}
        AND ST_DWithin(p.geom::geography, ${point}::geography, ${radius})
        ${category ? sql`AND p.category = ${category}` : sql``}
      ORDER BY d ASC
      LIMIT ${limit}`;
      return c.json({ items: rows.map(toPlace) });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('nearby', error);
      throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  },
);
