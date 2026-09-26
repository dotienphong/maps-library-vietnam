import { type GeocodeItem, normalizeVi, type ParsedAddress, parseAddress } from '@mapslibvn/core';
import { type AdminScope, resolveAdminScope } from './admin-scope';
import { useSimilarityBranch } from './autocomplete-sql';
import type { getSql } from './db';
import type { LatLng } from './params';

type Sql = ReturnType<typeof getSql>;

/** Giới hạn trước khi ép `housenumber::int`; dữ liệu nguồn có thể chứa SĐT/ID dài. */
export const INTEGER_HOUSE_NUMBER_PATTERN = '^[0-9]{1,9}$';

interface GeocodeContext {
  sql: Sql;
  parsed: ParsedAddress;
  near: LatLng | null;
  limit: number;
  scope: AdminScope;
}

const nearPoint = (sql: Sql, near: LatLng | null) =>
  near ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)` : null;

const displayName = (parts: (string | undefined | null)[]) => parts.filter(Boolean).join(', ');

/**
 * Mảng text an toàn cho cả `postgres` (Node) lẫn `postgres/cf` (Workers): bản cf nối mảng JS thành
 * "a,b,c" nên bind mảng rồi cast `::text[]` sẽ ném `malformed array literal` trên production mà
 * unit test không DB không thấy. Đi qua JSON là idiom đã chứng minh chạy đúng.
 */
export const textArray = (sql: Sql, values: string[]) =>
  sql`ARRAY(SELECT json_array_elements_text(${JSON.stringify(values)}::text::json))`;

/**
 * "Duong"/"pho" gõ không dấu mơ hồ giữa tiền tố và tên riêng (Đường/Dương, Phố/Phổ). Chỉ khi tên gốc
 * không có trong bảng street mà tên bỏ tiền tố có thì mới đổi — "Duong Ba Trac" vẫn là Dương Bá Trạc.
 */
async function pickStreetReading(sql: Sql, parsed: ParsedAddress): Promise<ParsedAddress> {
  if (!parsed.streetNorm || !parsed.streetAlt || !parsed.streetNormAlt) return parsed;
  const [row] = await sql<{ primary_ok: boolean; alt_ok: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM street WHERE name_norm = ${parsed.streetNorm}) AS primary_ok,
           EXISTS (SELECT 1 FROM street WHERE name_norm = ${parsed.streetNormAlt}) AS alt_ok`;
  if (row?.primary_ok || !row?.alt_ok) return parsed;
  return { ...parsed, street: parsed.streetAlt, streetNorm: parsed.streetNormAlt };
}

/** Thang 5 bước spec 6.3 — dừng ở bước đầu tiên có kết quả. */
export async function geocode(
  sql: Sql,
  query: string,
  near: LatLng | null,
  limit: number,
): Promise<GeocodeItem[]> {
  const parsed = await pickStreetReading(sql, parseAddress(query));
  const scope = await resolveAdminScope(sql, parsed);
  const context: GeocodeContext = { sql, parsed, near, limit, scope };

  if (parsed.streetNorm && parsed.housenumber) {
    const anchors = await stepAnchor(context);
    if (anchors.length) return anchors;

    if (parsed.alleyChain.length) {
      const alleys = await stepAlley(context);
      if (alleys.length) return alleys;
    }

    const interpolated = await stepInterpolate(context);
    if (interpolated.length) return interpolated;
  }

  if (parsed.streetNorm) {
    const streets = await stepStreet(context);
    if (streets.length) return streets;
  }

  return stepAdmin(context, query);
}

/** Bước 1 — mốc trùng số nhà + đường: rooftop 0.9, hoặc 0.95 với nguồn user. */
async function stepAnchor({
  sql,
  parsed,
  near,
  limit,
  scope,
}: GeocodeContext): Promise<GeocodeItem[]> {
  const point = nearPoint(sql, near);
  const rows = await sql<
    {
      lat: number;
      lng: number;
      ward_norm: string | null;
      province_norm: string | null;
      source: string;
    }[]
  >`SELECT ST_Y(geom) AS lat, ST_X(geom) AS lng, ward_norm, province_norm, source
    FROM address_anchor
    WHERE housenumber = ${parsed.housenumber as string}
      AND street_norm = ${parsed.streetNorm as string}
      ${scope.wardNorms.length ? sql`AND (ward_norm = ANY(${textArray(sql, scope.wardNorms)}) OR ward_norm IS NULL)` : sql``}
      ${scope.provinceNorm ? sql`AND province_norm = ${scope.provinceNorm}` : sql``}
      ${scope.oldArea ? sql`AND EXISTS (SELECT 1 FROM admin_area_old old WHERE old.id=${scope.oldArea.id} AND old.geom&&address_anchor.geom AND ST_Covers(old.geom,address_anchor.geom))` : sql``}
    ORDER BY ${point ? sql`ST_DistanceSphere(geom, ${point}) ASC` : sql`id ASC`}
    LIMIT ${limit}`;

  return rows.map((row) => ({
    lat: row.lat,
    lng: row.lng,
    precision: 'rooftop',
    confidence: row.source === 'user' ? 0.95 : 0.9,
    matched: {
      housenumber: parsed.housenumber as string,
      ...(parsed.street ? { street: parsed.street } : {}),
      ...(row.ward_norm ? { ward: currentWardName(scope, row.ward_norm) } : {}),
      ...(row.province_norm ? { province: row.province_norm } : {}),
      ...(scope.former ? { former: scope.former } : {}),
    },
    display_name: displayName([
      `${parsed.housenumber} ${parsed.street ?? ''}`.trim(),
      row.ward_norm ? currentWardName(scope, row.ward_norm) : scope.wardNames?.join(' / '),
      row.province_norm,
    ]),
  }));
}

/** Bước 2 — đi từ entrance vào hẻm 6 m cho mỗi số nhà: alley 0.7. */
async function stepAlley({
  sql,
  parsed,
  near,
  limit,
  scope,
}: GeocodeContext): Promise<GeocodeItem[]> {
  const point = nearPoint(sql, near);
  const houseNumber = Number.parseInt(parsed.houseInAlley ?? '0', 10) || 0;
  const rows = await sql<{ lat: number; lng: number }[]>`
    SELECT ST_Y(pt) AS lat, ST_X(pt) AS lng FROM (
      SELECT CASE
        WHEN a.entrance IS NULL THEN ST_LineInterpolatePoint(a.geom, 0)
        ELSE ST_LineInterpolatePoint(a.geom, greatest(0, least(1,
          CASE WHEN ST_LineLocatePoint(a.geom, a.entrance) < 0.5
            THEN ST_LineLocatePoint(a.geom, a.entrance)
              + ${6 * houseNumber} / NULLIF(ST_Length(a.geom::geography), 0)
            ELSE ST_LineLocatePoint(a.geom, a.entrance)
              - ${6 * houseNumber} / NULLIF(ST_Length(a.geom::geography), 0)
          END)))
      END AS pt
      FROM alley a JOIN street s ON s.id = a.parent_street_id
      WHERE a.number = ${parsed.alleyChain[0] as string}
        AND s.name_norm = ${parsed.streetNorm as string}
        ${scope.wardNorms.length ? sql`AND (s.ward_norm&&${textArray(sql, scope.wardNorms)} OR cardinality(s.ward_norm)=0)` : sql``}
        ${scope.provinceNorm ? sql`AND s.province_norm=${scope.provinceNorm}` : sql``}
        ${scope.oldArea ? sql`AND EXISTS (SELECT 1 FROM admin_area_old old WHERE old.id=${scope.oldArea.id} AND old.geom&&a.geom AND ST_Intersects(old.geom,a.geom))` : sql``}
      ORDER BY ${point ? sql`ST_DistanceSphere(a.geom, ${point}) ASC` : sql`a.id ASC`}
      LIMIT ${limit}
    ) candidates
    ${scope.oldArea ? sql`WHERE EXISTS (SELECT 1 FROM admin_area_old old WHERE old.id=${scope.oldArea.id} AND old.geom&&candidates.pt AND ST_Covers(old.geom,candidates.pt))` : sql``}`;

  return rows.map((row) => ({
    lat: row.lat,
    lng: row.lng,
    precision: 'alley',
    confidence: 0.7,
    matched: {
      housenumber: parsed.housenumber as string,
      ...(parsed.street ? { street: parsed.street } : {}),
      ...(scope.wardNames?.length ? { ward: scope.wardNames.join(' / ') } : {}),
      ...(scope.provinceName ? { province: scope.provinceName } : {}),
      ...(scope.former ? { former: scope.former } : {}),
    },
    display_name: displayName([
      `${parsed.housenumber} ${parsed.street ?? ''}`.trim(),
      scope.wardNames?.join(' / ') ?? parsed.ward,
      scope.provinceName ?? parsed.province,
    ]),
  }));
}

/** Bước 3 — nội suy giữa hai mốc cùng chẵn/lẻ, cách nhau tối đa 400 m: 0.6. */
async function stepInterpolate({
  sql,
  parsed,
  near,
  scope,
}: GeocodeContext): Promise<GeocodeItem[]> {
  const number = Number.parseInt(parsed.housenumber as string, 10);
  if (!Number.isFinite(number)) return [];

  const point = nearPoint(sql, near);
  const [row] = await sql<
    {
      lo_hn: number;
      hi_hn: number;
      gap: number;
      lo_lat: number;
      lo_lng: number;
      hi_lat: number;
      hi_lng: number;
      ward_norm: string | null;
      province_norm: string | null;
    }[]
  >`WITH numeric_candidates AS (
      SELECT geom,
        CASE WHEN housenumber ~ ${INTEGER_HOUSE_NUMBER_PATTERN} THEN housenumber::int END AS hn,
        ward_norm, province_norm
      FROM address_anchor
      WHERE street_norm = ${parsed.streetNorm as string}
        ${scope.wardNorms.length ? sql`AND (ward_norm = ANY(${textArray(sql, scope.wardNorms)}) OR ward_norm IS NULL)` : sql``}
        ${scope.provinceNorm ? sql`AND province_norm=${scope.provinceNorm}` : sql``}
        ${scope.oldArea ? sql`AND EXISTS (SELECT 1 FROM admin_area_old old WHERE old.id=${scope.oldArea.id} AND old.geom&&address_anchor.geom AND ST_Covers(old.geom,address_anchor.geom))` : sql``}
    ),
    candidates AS (
      SELECT * FROM numeric_candidates
      WHERE hn IS NOT NULL AND hn % 2 = ${((number % 2) + 2) % 2}
    ),
    lo AS (
      SELECT * FROM candidates WHERE hn < ${number}
      ORDER BY ${point ? sql`ST_DistanceSphere(geom, ${point}) ASC, hn DESC` : sql`hn DESC`}
      LIMIT 1
    ),
    hi AS (
      SELECT * FROM candidates WHERE hn > ${number}
      ORDER BY ${point ? sql`ST_DistanceSphere(geom, ${point}) ASC, hn ASC` : sql`hn ASC`}
      LIMIT 1
    )
    SELECT lo.hn AS lo_hn, hi.hn AS hi_hn,
      ST_DistanceSphere(lo.geom, hi.geom) AS gap,
      ST_Y(lo.geom) AS lo_lat, ST_X(lo.geom) AS lo_lng,
      ST_Y(hi.geom) AS hi_lat, ST_X(hi.geom) AS hi_lng,
      lo.ward_norm, lo.province_norm
    FROM lo, hi`;

  if (!row || Number(row.gap) > 400) return [];

  const ratio = (number - row.lo_hn) / (row.hi_hn - row.lo_hn);
  let lat = row.lo_lat + (row.hi_lat - row.lo_lat) * ratio;
  let lng = row.lo_lng + (row.hi_lng - row.lo_lng) * ratio;
  const [projected] = await sql<{ lat: number; lng: number }[]>`
    SELECT ST_Y(pt) AS lat, ST_X(pt) AS lng FROM (
      SELECT ST_LineInterpolatePoint(line, f_lo + (f_hi - f_lo) * ${ratio}) AS pt FROM (
        SELECT ST_LineMerge(geom) AS line,
          ST_LineLocatePoint(ST_LineMerge(geom), ST_SetSRID(ST_MakePoint(${row.lo_lng}, ${row.lo_lat}), 4326)) AS f_lo,
          ST_LineLocatePoint(ST_LineMerge(geom), ST_SetSRID(ST_MakePoint(${row.hi_lng}, ${row.hi_lat}), 4326)) AS f_hi
        FROM street
        WHERE name_norm = ${parsed.streetNorm as string}
          ${scope.wardNorms.length ? sql`AND (ward_norm&&${textArray(sql, scope.wardNorms)} OR cardinality(ward_norm)=0)` : sql``}
          ${scope.provinceNorm ? sql`AND province_norm=${scope.provinceNorm}` : sql``}
          ${scope.oldArea ? sql`AND EXISTS (SELECT 1 FROM admin_area_old old WHERE old.id=${scope.oldArea.id} AND old.geom&&street.geom AND ST_Intersects(old.geom,street.geom))` : sql``}
          AND GeometryType(ST_LineMerge(geom)) = 'LINESTRING'
          AND ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(${row.lo_lng}, ${row.lo_lat}), 4326)::geography,
            100
          )
        LIMIT 1
      ) street_line
    ) projected_point`;
  if (projected) {
    lat = projected.lat;
    lng = projected.lng;
  }

  return [
    {
      lat,
      lng,
      precision: 'interpolated',
      confidence: 0.6,
      matched: {
        housenumber: parsed.housenumber as string,
        ...(parsed.street ? { street: parsed.street } : {}),
        ...(row.ward_norm ? { ward: currentWardName(scope, row.ward_norm) } : {}),
        ...(row.province_norm ? { province: row.province_norm } : {}),
        ...(scope.former ? { former: scope.former } : {}),
      },
      display_name: displayName([
        `${parsed.housenumber} ${parsed.street ?? ''}`.trim(),
        row.ward_norm ? currentWardName(scope, row.ward_norm) : scope.wardNames?.join(' / '),
        row.province_norm,
      ]),
    },
  ];
}

/** Bước 4 — khớp đường (đúng tên, rồi word_similarity spec 05/09), ưu tiên hành chính trong câu rồi khoảng cách near: 0.4. */
async function stepStreet({
  sql,
  parsed,
  near,
  limit,
  scope,
}: GeocodeContext): Promise<GeocodeItem[]> {
  const point = nearPoint(sql, near);
  const query = (exact: boolean) =>
    sql<
      {
        name: string;
        province_norm: string | null;
        lat: number;
        lng: number;
        xmin: number;
        ymin: number;
        xmax: number;
        ymax: number;
      }[]
    >`SELECT name, province_norm,
        ST_Y(mid) AS lat, ST_X(mid) AS lng,
        ST_XMin(env) AS xmin, ST_YMin(env) AS ymin,
        ST_XMax(env) AS xmax, ST_YMax(env) AS ymax
      FROM (
        SELECT *, ST_Envelope(geom) AS env,
          CASE WHEN GeometryType(ST_LineMerge(geom)) = 'LINESTRING'
            THEN ST_LineInterpolatePoint(ST_LineMerge(geom), 0.5)
            ELSE ST_PointOnSurface(geom)
          END AS mid
        FROM street
        WHERE ${
          exact
            ? sql`name_norm = ${parsed.streetNorm as string}`
            : sql`(${parsed.streetNorm as string} <% name_norm
                ${useSimilarityBranch(parsed.streetNorm as string) ? sql`OR name_norm % ${parsed.streetNorm as string}` : sql``}
                OR ${parsed.streetNorm as string} <% name_alt_norm)`
        }
          ${scope.wardNorms.length ? sql`AND ward_norm&&${textArray(sql, scope.wardNorms)}` : sql``}
          ${scope.provinceNorm ? sql`AND province_norm = ${scope.provinceNorm}` : sql``}
          ${scope.oldArea ? sql`AND EXISTS (SELECT 1 FROM admin_area_old old WHERE old.id=${scope.oldArea.id} AND old.geom&&street.geom AND ST_Intersects(old.geom,street.geom))` : sql``}
      ) candidates
      ORDER BY ${point ? sql`ST_DistanceSphere(candidates.geom, ${point}) ASC` : sql`candidates.id ASC`}
      LIMIT ${limit}`;

  let rows = await query(true);
  if (rows.length === 0 && scope.wardNorms.length === 0 && scope.provinceNorm === null)
    rows = await query(false);
  return rows.map((row) => ({
    lat: row.lat,
    lng: row.lng,
    precision: 'street',
    confidence: 0.4,
    matched: {
      street: row.name,
      ...(row.province_norm ? { province: row.province_norm } : {}),
      ...(scope.wardNames?.length ? { ward: scope.wardNames.join(' / ') } : {}),
      ...(scope.former ? { former: scope.former } : {}),
    },
    display_name: displayName([
      row.name,
      scope.wardNames?.join(' / ') ?? parsed.ward,
      row.province_norm,
    ]),
    bbox: [row.xmin, row.ymin, row.xmax, row.ymax],
  }));
}

/** Bước 5 — khớp vùng hành chính hoặc alias: ward/province 0.2. */
async function stepAdmin(
  { sql, parsed, limit, scope }: GeocodeContext,
  query: string,
): Promise<GeocodeItem[]> {
  const queryNorm = normalizeVi(parsed.ward ?? parsed.district ?? parsed.province ?? query).replace(
    /^(?:tinh|thanh pho|quan|huyen|thi xa|phuong|xa|thi tran)\s+/,
    '',
  );
  if (!queryNorm) return [];

  const rows = await sql<
    {
      name: string;
      level: number;
      lat: number;
      lng: number;
      xmin: number;
      ymin: number;
      xmax: number;
      ymax: number;
    }[]
  >`SELECT DISTINCT ON (a.id) a.name, a.level,
      ST_Y(ST_PointOnSurface(a.geom)) AS lat,
      ST_X(ST_PointOnSurface(a.geom)) AS lng,
      ST_XMin(a.geom) AS xmin, ST_YMin(a.geom) AS ymin,
      ST_XMax(a.geom) AS xmax, ST_YMax(a.geom) AS ymax
    FROM admin_area a
    WHERE a.name_norm = ${queryNorm}
    ORDER BY a.id, a.level DESC
    LIMIT ${limit}`;
  rows.sort((left, right) => right.level - left.level);

  if (rows.length === 0 && scope.oldArea && scope.oldArea.level >= 6) {
    const old = scope.oldArea;
    return [
      {
        lat: old.lat,
        lng: old.lng,
        precision: old.level === 6 ? 'district' : 'ward',
        confidence: 0.2,
        matched: {
          ...(scope.former ?? (old.level === 6 ? { district: old.name } : { ward: old.name })),
          ...(scope.former ? { former: scope.former } : {}),
        },
        display_name: `${old.name} (trước 07/2025)`,
        bbox: old.bbox,
      },
    ];
  }

  return rows.map((row) => ({
    lat: row.lat,
    lng: row.lng,
    precision: row.level >= 6 ? 'ward' : 'province',
    confidence: 0.2,
    matched: row.level >= 6 ? { ward: row.name } : { province: row.name },
    display_name: row.name,
    bbox: [row.xmin, row.ymin, row.xmax, row.ymax],
  }));
}

function currentWardName(scope: AdminScope, wardNorm: string): string {
  const index = scope.wardNorms.indexOf(wardNorm);
  return scope.wardNames?.[index] ?? wardNorm;
}
