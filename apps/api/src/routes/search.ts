import { normalizeVi } from '@mapslibvn/core';
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { clampInt, parseBbox, parseLatLngPair } from '../params';
import { type PlaceRow, placeColumns, toPlace } from '../place';

export const search = new Hono<AppEnv>();

search.get('/v1/search', requireAuth(), async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  const category = c.req.query('category');
  const near = parseLatLngPair(c.req.query('near'), 'near');
  const bbox = parseBbox(c.req.query('bbox'));
  if (!query && !category && !near && !bbox) {
    throw new ApiError(400, 'invalid_request', 'Cần ít nhất một trong q, category, near, bbox');
  }
  const radius = clampInt(c.req.query('radius'), 1, 50_000, 5_000, 'radius');
  const limit = clampInt(c.req.query('limit'), 1, 50, 20, 'limit');
  const offset = clampInt(c.req.query('offset'), 0, 500, 0, 'offset');
  const queryNorm = query ? normalizeVi(query) : '';
  if (query && !queryNorm) {
    throw new ApiError(400, 'invalid_request', 'q không có ký tự tra cứu được');
  }

  const sql = getSql(c.env);
  try {
    const nearPoint = near ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)` : null;
    const rows = await sql<PlaceRow[]>`
      SELECT ${placeColumns(sql)}, count(*) OVER() AS total
        ${nearPoint ? sql`, ST_DistanceSphere(p.geom, ${nearPoint}) AS d` : sql``}
      FROM poi p LEFT JOIN category c ON c.code = p.category
      WHERE p.status = 'active'
        ${queryNorm ? sql`AND (p.name_norm % ${queryNorm} OR starts_with(p.name_norm, ${queryNorm}))` : sql``}
        ${category ? sql`AND p.category = ${category}` : sql``}
        ${nearPoint ? sql`AND ST_DWithin(p.geom::geography, ${nearPoint}::geography, ${radius})` : sql``}
        ${bbox ? sql`AND p.geom && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)` : sql``}
      ORDER BY ${queryNorm ? sql`similarity(p.name_norm, ${queryNorm}) DESC` : nearPoint ? sql`d ASC` : sql`p.updated_at DESC`}
      LIMIT ${limit} OFFSET ${offset}`;
    return c.json({ items: rows.map(toPlace), total: rows[0]?.total ? Number(rows[0].total) : 0 });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('search', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});
