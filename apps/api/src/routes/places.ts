import { attributionHtml, attributionText } from '@mapslibvn/core';
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { type PlaceRow, placeColumns, toPlace } from '../place';
import { quotaMiddleware } from '../quota';

export const places = new Hono<AppEnv>();

places.get('/v1/places/:id', requireAuth(), quotaMiddleware('places'), async (c) => {
  const id = c.req.param('id');
  if (!id) throw new ApiError(400, 'invalid_request', 'id POI bắt buộc');
  const cacheUrl = `https://cache.mapslibvn/place?id=${encodeURIComponent(id)}`;
  return cachedJson(c.executionCtx, cacheUrl, 3600, 7200, async () => {
    const sql = getSql(c.env);
    try {
      const [row] = await sql<PlaceRow[]>`
        SELECT ${placeColumns(sql)}
        FROM poi p LEFT JOIN category c ON c.code = p.category
        WHERE p.id = ${id} AND p.status IN ('active', 'closed')`;
      if (!row) throw new ApiError(404, 'not_found', 'Không có POI này');

      const sources = await sql<{ source: string; source_id: string; role: string }[]>`
        SELECT source, source_id, role
        FROM poi_source_link
        WHERE poi_id = ${id}
        ORDER BY role, source, source_id`;
      return {
        ...toPlace(row),
        sources,
        attribution: { text: attributionText(), html: attributionHtml() },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('places/:id', error);
      throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  });
});
