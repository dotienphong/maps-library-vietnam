import type { ParsedAddress, PoiSource } from '@mapslibvn/core';
import { areaCandidates } from './area-candidates';
import type { getSql } from './db';
import type { LatLng } from './params';
import { poiSourceFilter } from './poi-sources';
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
  bbox?: [number, number, number, number];
}

export interface CandidateQueryInput {
  queryNorm: string;
  queryCore: string;
  /** `queryNorm` đã escape `\ % _`, kèm `%` cuối — dùng cho LIKE tiền tố. */
  prefixPattern: string;
  near: LatLng | null;
  parsed: ParsedAddress;
  /** Tập nguồn POI (spec 07/09); chỉ nhánh `poi` dùng. */
  sources: readonly PoiSource[];
}

/**
 * Truy vấn dài bao nhiêu thì THÔI dùng thêm toán tử `%`.
 *
 * `%` (similarity toàn chuỗi, ngưỡng 0,3) cần cho lỗi gõ trên từ ngắn, nhưng chi phí của nó tăng
 * theo số trigram của truy vấn. Đo trên production 1,5 triệu POI ngày 05/09 (EXPLAIN ANALYZE,
 * mệnh đề đủ ba nhánh):
 *
 * | truy vấn | độ dài | thời gian |
 * |---|---:|---:|
 * | `cirlce k` | 8 | 37 ms |
 * | `higland` | 7 | 120 ms |
 * | `phuc long coffee` | 16 | 1355 ms |
 * | `nguyen tieu hoc truong` | 22 | 2381 ms |
 *
 * Truy vấn dài không cần `%`: `<%` vốn xử lý tốt cụm dài, đảo từ và thiếu từ đệm. Nên chặn ở 12
 * ký tự — đủ phủ mọi ca lỗi gõ từ ngắn trong `scripts/fixtures/fuzzy-queries.txt`
 * (`winmrt` 6, `higland` 7, `cho rya` 7, `cirlce k` 8, `phuc lonh` 9, `nguyne hue` 10).
 */
export const SIMILARITY_MAX_QUERY_LENGTH = 12;

/** Truy vấn đủ ngắn để thêm nhánh `%` mà không trả giá độ trễ. */
export const useSimilarityBranch = (queryNorm: string): boolean =>
  queryNorm.length <= SIMILARITY_MAX_QUERY_LENGTH;

const nearPoint = (sql: Sql, near: LatLng | null) =>
  near ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)` : null;

const distance = (sql: Sql, near: LatLng | null, geometry: string) => {
  const point = nearPoint(sql, near);
  return point ? sql`ST_DistanceSphere(${sql.unsafe(geometry)}, ${point})` : sql`NULL::float8`;
};

/**
 * Spec 05/09 mục 5.3, có sửa sau khi đo thật ngày 05/09: dùng **cả hai** toán tử trigram.
 *
 * - `q <% name_norm` (word_similarity, ngưỡng 0,5 từ migration 0007) đo trên đoạn từ liên tục của
 *   tên, nên bắt được cụm nằm giữa tên rất dài và đảo thứ tự từ — hai thứ `%` bỏ sót
 *   (`skincode` và `laptop nhap my` trước đây rơi ngoài LIMIT 20).
 * - `name_norm % q` (similarity toàn chuỗi, ngưỡng 0,3) vẫn cần cho **lỗi gõ trên từ ngắn**, nơi
 *   word_similarity tụt dưới mọi ngưỡng hợp lý: đo trên production 05/09 cho
 *   `higland`↔`highlands` 0,455 và `cirlce k`↔`circle k` 0,385. Bỏ nhánh này làm hit@3 của bộ 40
 *   truy vấn tụt từ 38 xuống 35.
 *
 * Cả hai nhánh đều chạy trên chỉ số GIN `poi_name_norm_trgm_idx` (BitmapOr), không nhánh nào quét
 * bảng. ORDER BY thêm pop để 20 ứng viên đầu không ngẫu nhiên khi sim hoà (truy vấn 2–3 ký tự).
 */
export function poiCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, queryCore, prefixPattern, near, sources } = input;
  const fuzzy = useSimilarityBranch(queryNorm);
  const simNorm = fuzzy ? sql`OR name_norm % ${queryNorm}` : sql``;
  // Phần lớn truy vấn có nameCore trùng normalizeVi; khi đó nhánh core chỉ là việc thừa.
  const coreBranches =
    queryCore === queryNorm
      ? sql``
      : fuzzy
        ? sql`OR ${queryCore} <% name_norm OR name_norm % ${queryCore}`
        : sql`OR ${queryCore} <% name_norm`;
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
    FROM poi p
    WHERE status = 'active'
      AND ${poiSourceFilter(sql, sources)}
      AND (
        ${queryNorm} <% name_norm
        ${simNorm}
        ${coreBranches}
        OR name_norm LIKE ${prefixPattern}
      )
    ORDER BY sim DESC, pop DESC
    LIMIT 20`;
}

export function streetCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, prefixPattern, near } = input;
  const simNorm = useSimilarityBranch(queryNorm) ? sql`OR name_norm % ${queryNorm}` : sql``;
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
    WHERE ${queryNorm} <% name_norm
      ${simNorm}
      OR name_norm LIKE ${prefixPattern}
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
  const simStreet = useSimilarityBranch(streetNorm) ? sql`OR street_norm % ${streetNorm}` : sql``;
  return sql<CandidateRow[]>`
    SELECT 'address' AS type, NULL AS id,
      ${`${housenumber} ${parsed.street ?? ''}`.trim()} AS name,
      concat_ws(', ', ward_norm, province_norm) AS secondary,
      ST_Y(geom) AS lat, ST_X(geom) AS lng, 'rooftop' AS precision,
      greatest(word_similarity(${streetNorm}, street_norm), similarity(street_norm, ${streetNorm})) AS sim,
      false AS prefix, 0 AS pop,
      ${distance(sql, near, 'geom')} AS d
    FROM address_anchor
    WHERE housenumber = ${housenumber}
      AND (${streetNorm} <% street_norm ${simStreet})
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
  if (types.has('area')) queries.push(areaCandidates(sql, input));
  const { housenumber, streetNorm } = input.parsed;
  if (types.has('address') && housenumber && streetNorm) {
    queries.push(addressCandidates(sql, input, housenumber, streetNorm));
  }
  const results = await Promise.all(queries);
  return results.flat();
}
