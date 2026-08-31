import { nameCore, normalizeVi, parseAddress } from '@mapslibvn/core';
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { clampInt, parseLatLngPair, parseTypes } from '../params';
import { type ItemType, gridKey, rankScore } from '../ranking';

interface CandidateRow {
  type: ItemType;
  id: string | null;
  name: string;
  secondary: string | null;
  lat: number;
  lng: number;
  precision: string | null;
  sim: number;
  prefix: boolean;
  pop: number;
  d: number | null;
}

export const autocomplete = new Hono<AppEnv>();

autocomplete.get('/v1/autocomplete', requireAuth(), async (c) => {
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

  // Cache 10 phút theo (q_norm, lưới near, types, limit); stale-if-error 1 giờ.
  const grid = near ? gridKey(near.lat, near.lng) : '-';
  const typeKey = [...types].sort().join('_');
  const cacheUrl = `https://cache.mapslibvn/autocomplete?qn=${encodeURIComponent(queryNorm)}&g=${grid}&t=${typeKey}&l=${limit}`;

  const response = await cachedJson(c.executionCtx, cacheUrl, 600, 3600, async () => {
    const sql = getSql(c.env);
    try {
      const nearPoint = near ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)` : null;
      const distance = (geometry: string) =>
        nearPoint
          ? sql`ST_DistanceSphere(${sql.unsafe(geometry)}, ${nearPoint})`
          : sql`NULL::float8`;
      const rows: CandidateRow[] = [];

      if (types.has('poi')) {
        rows.push(
          ...(await sql<CandidateRow[]>`
            SELECT 'poi' AS type, id, name,
              concat_ws(', ', street, ward, province) AS secondary,
              ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
              greatest(
                similarity(name_norm, ${queryNorm}),
                similarity(name_norm, ${queryCore})
              ) AS sim,
              starts_with(name_norm, ${queryNorm}) AS prefix,
              coalesce(popularity, 0) AS pop,
              ${distance('geom')} AS d
            FROM poi
            WHERE status = 'active'
              AND (
                name_norm % ${queryNorm}
                OR name_norm % ${queryCore}
                OR starts_with(name_norm, ${queryNorm})
              )
            ORDER BY sim DESC
            LIMIT 20`),
        );
      }

      if (types.has('street')) {
        rows.push(
          ...(await sql<CandidateRow[]>`
            SELECT 'street' AS type, NULL AS id, name,
              coalesce(province_norm, '') AS secondary,
              ST_Y(ST_PointOnSurface(geom)) AS lat,
              ST_X(ST_PointOnSurface(geom)) AS lng,
              NULL AS precision,
              similarity(name_norm, ${queryNorm}) AS sim,
              starts_with(name_norm, ${queryNorm}) AS prefix,
              0 AS pop,
              ${distance('geom')} AS d
            FROM street
            WHERE name_norm % ${queryNorm} OR starts_with(name_norm, ${queryNorm})
            ORDER BY sim DESC
            LIMIT 20`),
        );
      }

      const parsed = parseAddress(query);
      if (types.has('address') && parsed.housenumber && parsed.streetNorm) {
        rows.push(
          ...(await sql<CandidateRow[]>`
            SELECT 'address' AS type, NULL AS id,
              ${`${parsed.housenumber} ${parsed.street ?? ''}`.trim()} AS name,
              concat_ws(', ', ward_norm, province_norm) AS secondary,
              ST_Y(geom) AS lat, ST_X(geom) AS lng, 'rooftop' AS precision,
              similarity(street_norm, ${parsed.streetNorm}) AS sim,
              false AS prefix, 0 AS pop,
              ${distance('geom')} AS d
            FROM address_anchor
            WHERE housenumber = ${parsed.housenumber} AND street_norm % ${parsed.streetNorm}
            ORDER BY sim DESC
            LIMIT 10`),
        );
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
