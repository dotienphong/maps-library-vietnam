import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { endSql, getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError, moTaLoi } from '../errors';
import { INTEGER_HOUSE_NUMBER_PATTERN } from '../geocode';
import { parseSources } from '../params';
import { type PlaceRow, placeColumns, toPlace } from '../place';
import { poiSourceFilter } from '../poi-sources';
import { quotaMiddleware } from '../quota';

export const reverse = new Hono<AppEnv>();

/**
 * Parse + validate MỘT lần mỗi request, nhớ trên context: preflight quota gọi trước khi giữ lượt,
 * handler gọi lại nhận đúng object cũ — spec 14.4 cấm parse hai lần.
 */
function reverseParams(c: import('hono').Context<AppEnv>) {
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
    return { lat, lng, sources: parseSources(c.req.query('sources')) };
  }
}

reverse.get(
  '/v1/reverse',
  requireAuth('places:read', { deferRevocation: true }),
  quotaMiddleware('places', reverseParams),
  async (c) => {
    const { lat, lng, sources } = reverseParams(c);
    const sql = getSql(c.env);
    try {
      const point = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;
      const [street] = await sql<{ name: string; name_norm: string }[]>`
      SELECT name, name_norm
      FROM street
      WHERE ST_DWithin(geom::geography, ${point}::geography, 150)
      ORDER BY ST_Distance(geom::geography, ${point}::geography) ASC
      LIMIT 1`;

      let approximateHouseNumber: string | undefined;
      if (street) {
        const anchors = await sql<{ hn: number }[]>`
        SELECT CASE
          WHEN housenumber ~ ${INTEGER_HOUSE_NUMBER_PATTERN} THEN housenumber::int
        END AS hn
        FROM address_anchor
        WHERE street_norm = ${street.name_norm}
          AND housenumber ~ ${INTEGER_HOUSE_NUMBER_PATTERN}
          AND ST_DWithin(geom::geography, ${point}::geography, 300)
        ORDER BY ST_DistanceSphere(geom, ${point}) ASC
        LIMIT 2`;
        const [first, second] = anchors;
        if (first && second) {
          const lower = Math.min(first.hn, second.hn);
          const upper = Math.max(first.hn, second.hn);
          approximateHouseNumber = lower === upper ? `≈ ${lower}` : `≈ ${lower}–${upper}`;
        } else if (first) {
          approximateHouseNumber = `≈ ${first.hn}`;
        }
      }

      // Đặc khu Hoàng Sa/Trường Sa: hình L4 của Đà Nẵng/Khánh Hòa cố ý không nới ra biển (pipeline admin.mjs),
      // nên khi không L4 nào chứa điểm thì tỉnh lấy theo cha của đơn vị cấp 8.
      const admins = await sql<{ name: string; level: number; parent_province: string | null }[]>`
      SELECT a.name, a.level, p.name AS parent_province
      FROM admin_area a LEFT JOIN admin_area p ON p.id = a.parent_id AND p.level = 4
      WHERE ST_Contains(a.geom, ${point}) AND a.level IN (4, 8)
      ORDER BY a.level DESC`;
      const wardRow = admins.find((admin) => admin.level === 8);
      const ward = wardRow?.name;
      const province =
        admins.find((admin) => admin.level === 4)?.name ?? wardRow?.parent_province ?? undefined;

      const [poiRow] = await sql<PlaceRow[]>`
      SELECT ${placeColumns(sql)}
      FROM poi p LEFT JOIN category c ON c.code = p.category
      WHERE p.status = 'active'
        AND ${poiSourceFilter(sql, sources)}
        AND ST_DWithin(p.geom::geography, ${point}::geography, 100)
      ORDER BY ST_DistanceSphere(p.geom, ${point}) ASC
      LIMIT 1`;
      const nearestPoi = poiRow ? toPlace(poiRow) : null;

      const displayName = [
        approximateHouseNumber && street
          ? `${approximateHouseNumber} ${street.name}`
          : street?.name,
        !street && nearestPoi ? `gần ${nearestPoi.name}` : undefined,
        ward,
        province,
      ]
        .filter(Boolean)
        .join(', ');

      return c.json({
        address: {
          ...(approximateHouseNumber ? { approx_housenumber: approximateHouseNumber } : {}),
          ...(street ? { street: street.name } : {}),
          ...(ward ? { ward } : {}),
          ...(province ? { province } : {}),
          display_name: displayName,
        },
        nearest_poi: nearestPoi,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error(`reverse: ${moTaLoi(error)}`, error);
      throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
    } finally {
      endSql(c.executionCtx, sql);
    }
  },
);
