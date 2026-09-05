import type { ParsedAddress } from '@mapslibvn/core';
import type { getSql } from './db';
import type { LatLng } from './params';
import type { ItemType } from './ranking';

type Sql = ReturnType<typeof getSql>;

export interface CandidateRow {
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

export interface CandidateQueryInput {
  queryNorm: string;
  queryCore: string;
  /** `queryNorm` đã escape `\ % _`, kèm `%` cuối — dùng cho LIKE tiền tố. */
  prefixPattern: string;
  near: LatLng | null;
  parsed: ParsedAddress;
}

const nearPoint = (sql: Sql, near: LatLng | null) =>
  near ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)` : null;

const distance = (sql: Sql, near: LatLng | null, geometry: string) => {
  const point = nearPoint(sql, near);
  return point ? sql`ST_DistanceSphere(${sql.unsafe(geometry)}, ${point})` : sql`NULL::float8`;
};

/**
 * Spec 05/09 mục 5.3: `q <% name_norm` (word_similarity, GIN trgm hỗ trợ) thay `name_norm % q`.
 * word_similarity đo trên đoạn từ liên tục của tên nên truy vấn ngắn hơn tên, đảo từ và lỗi gõ
 * 1–2 ký tự vẫn qua ngưỡng (GUC pg_trgm.word_similarity_threshold, migration 0007).
 * ORDER BY thêm pop để 20 ứng viên đầu không ngẫu nhiên khi sim hoà (truy vấn 2–3 ký tự).
 */
export function poiCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, queryCore, prefixPattern, near } = input;
  return sql<CandidateRow[]>`
    SELECT 'poi' AS type, id, name,
      concat_ws(', ', street, ward, province) AS secondary,
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      greatest(
        word_similarity(${queryNorm}, name_norm),
        word_similarity(${queryCore}, name_norm),
        similarity(name_norm, ${queryNorm})
      ) AS sim,
      starts_with(name_norm, ${queryNorm}) AS prefix,
      coalesce(popularity, 0) AS pop,
      ${distance(sql, near, 'geom')} AS d
    FROM poi
    WHERE status = 'active'
      AND (
        ${queryNorm} <% name_norm
        OR ${queryCore} <% name_norm
        OR name_norm LIKE ${prefixPattern}
      )
    ORDER BY sim DESC, pop DESC
    LIMIT 20`;
}

export function streetCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, prefixPattern, near } = input;
  return sql<CandidateRow[]>`
    SELECT 'street' AS type, NULL AS id, name,
      coalesce(province_norm, '') AS secondary,
      ST_Y(ST_PointOnSurface(geom)) AS lat,
      ST_X(ST_PointOnSurface(geom)) AS lng,
      NULL AS precision,
      greatest(word_similarity(${queryNorm}, name_norm), similarity(name_norm, ${queryNorm})) AS sim,
      starts_with(name_norm, ${queryNorm}) AS prefix,
      0 AS pop,
      ${distance(sql, near, 'geom')} AS d
    FROM street
    WHERE ${queryNorm} <% name_norm OR name_norm LIKE ${prefixPattern}
    ORDER BY sim DESC
    LIMIT 20`;
}

/** Chỉ gọi khi `parsed.housenumber` và `parsed.streetNorm` có giá trị. */
export function addressCandidates(
  sql: Sql,
  input: CandidateQueryInput,
  housenumber: string,
  streetNorm: string,
) {
  const { parsed, near } = input;
  return sql<CandidateRow[]>`
    SELECT 'address' AS type, NULL AS id,
      ${`${housenumber} ${parsed.street ?? ''}`.trim()} AS name,
      concat_ws(', ', ward_norm, province_norm) AS secondary,
      ST_Y(geom) AS lat, ST_X(geom) AS lng, 'rooftop' AS precision,
      greatest(word_similarity(${streetNorm}, street_norm), similarity(street_norm, ${streetNorm})) AS sim,
      false AS prefix, 0 AS pop,
      ${distance(sql, near, 'geom')} AS d
    FROM address_anchor
    WHERE housenumber = ${housenumber} AND ${streetNorm} <% street_norm
    ORDER BY sim DESC
    LIMIT 10`;
}

/** Chạy song song mọi loại được chọn (spec 5.7); trước đây tuần tự là phần lớn độ trễ khi cache lạnh. */
export async function collectCandidates(
  sql: Sql,
  input: CandidateQueryInput,
  types: Set<ItemType>,
): Promise<CandidateRow[]> {
  const queries: Promise<CandidateRow[]>[] = [];
  if (types.has('poi')) queries.push(poiCandidates(sql, input));
  if (types.has('street')) queries.push(streetCandidates(sql, input));
  const { housenumber, streetNorm } = input.parsed;
  if (types.has('address') && housenumber && streetNorm) {
    queries.push(addressCandidates(sql, input, housenumber, streetNorm));
  }
  const results = await Promise.all(queries);
  return results.flat();
}
