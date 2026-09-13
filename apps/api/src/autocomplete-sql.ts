import type { ParsedAddress, PoiSource } from '@mapslibvn/core';
import { areaCandidates } from './area-candidates';
import type { getSql } from './db';
import type { LatLng } from './params';
import { poiSourceFilter } from './poi-sources';
import type { ItemType } from './ranking';
import { planStages } from './stages';

type Sql = ReturnType<typeof getSql>;

/**
 * Dòng phụ của POI: phường/tỉnh HIỆN HÀNH suy từ toạ độ (pipelines/poi/src/geocode/poi-admin.mjs), fallback
 * cột nguồn khi chưa backfill hoặc POI người dùng vừa tạo. Cột nguồn `ward` hay lệch ("Ho Chi Minh City" của
 * Foursquare) và theo hệ hành chính cũ — chẩn đoán 13/09/2026 trên production với truy vấn "Phan Đăng Lưu".
 */
const poiSecondary = (sql: Sql) =>
  sql`concat_ws(', ', street, coalesce(admin_ward, ward), coalesce(admin_province, province)) AS secondary`;

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
  /** Tên thay thế GỐC (còn dấu) đã khớp truy vấn, nếu kết quả đến từ `name_alt_norm`. */
  matched_alt?: string | null;
  /** Bậc đã cho ra dòng này (1 tiền tố+trigram, 2 tsvector, 3 khoá ngữ âm). */
  stage?: 1 | 2 | 3;
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
  /** `applyToponymAlias(queryNorm)`; bằng `queryNorm` khi không có biến thể. Bậc 1 thêm nhánh khi khác. */
  queryAlias: string;
  /** `tsQueryFor(queryNorm)` — null khi < 2 token; bậc 2. */
  tsQuery: string | null;
  /** `viKey(queryAlias)` — bậc 3. */
  queryKey: string;
}

/**
 * Tên thay thế OSM (spec 6.3): khớp `name_alt_norm` và trả lại tên GỐC đã khớp. Làm được vì
 * pipeline ghi `name_alt` và `name_alt_norm` THẲNG HÀNG theo chỉ số (xem `filterNameAlt` của core),
 * nên `unnest` hai mảng song song ghép đúng cặp.
 *
 * NULL-safe theo thiết kế: `name_alt_norm` NULL → `string_to_array` NULL → `unnest` không ra dòng
 * nào → subquery trả NULL. Task 13 chứng minh bằng DB thật, không chỉ khẳng định.
 */
const matchedAltExpr = (sql: Sql, queryNorm: string) =>
  sql`(SELECT a.orig FROM unnest(name_alt, string_to_array(name_alt_norm, ' | ')) AS a(orig, norm)
      WHERE ${queryNorm} <% a.norm ORDER BY word_similarity(${queryNorm}, a.norm) DESC LIMIT 1)`;

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
  const { queryNorm, queryCore, queryAlias, prefixPattern, near, sources } = input;
  const fuzzy = useSimilarityBranch(queryNorm);
  // Biến thể địa danh (spec 6.1): chỉ thêm nhánh khi từ điển thật sự đổi được chuỗi.
  const aliasBranch = queryAlias === queryNorm ? sql`` : sql`OR ${queryAlias} <% name_norm`;
  // Và phải CHẤM ĐIỂM theo dạng chuẩn nữa, không chỉ tìm theo nó. Đo trên production 08/09: POI
  // "Quy Nhơn" cho word_similarity 0,636 với 'qui nhon' nhưng 1,000 với 'quy nhon'. Vì ORDER BY
  // dùng chính `sim` này, thiếu vế alias thì dòng đúng vừa bị xếp thấp vừa bị `LIMIT 20` cắt
  // trước khi tới được bước xếp hạng của route.
  const aliasSim =
    queryAlias === queryNorm ? sql`` : sql`, word_similarity(${queryAlias}, name_norm)`;
  const aliasPrefix =
    queryAlias === queryNorm ? sql`` : sql`OR starts_with(name_norm, ${queryAlias})`;
  const matchedAlt = matchedAltExpr(sql, queryNorm);
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
      ${poiSecondary(sql)},
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      greatest(
        word_similarity(${queryNorm}, name_norm),
        word_similarity(${queryCore}, name_norm),
        similarity(name_norm, ${queryNorm}),
        word_similarity(${queryNorm}, coalesce(name_alt_norm, ''))
        ${aliasSim}
      ) AS sim,
      (starts_with(name_norm, ${queryNorm}) ${aliasPrefix}) AS prefix,
      coalesce(popularity, 0) AS pop,
      ${distance(sql, near, 'geom')} AS d,
      ${matchedAlt} AS matched_alt
    FROM poi p
    WHERE status = 'active'
      AND ${poiSourceFilter(sql, sources)}
      AND (
        ${queryNorm} <% name_norm
        ${simNorm}
        ${coreBranches}
        ${aliasBranch}
        OR ${queryNorm} <% name_alt_norm
        OR name_norm LIKE ${prefixPattern}
      )
    ORDER BY sim DESC, pop DESC
    LIMIT 20`;
}

export function streetCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, queryAlias, prefixPattern, near } = input;
  const simNorm = useSimilarityBranch(queryNorm) ? sql`OR name_norm % ${queryNorm}` : sql``;
  const aliasBranch = queryAlias === queryNorm ? sql`` : sql`OR ${queryAlias} <% name_norm`;
  const aliasSim =
    queryAlias === queryNorm ? sql`` : sql`, word_similarity(${queryAlias}, name_norm)`;
  const aliasPrefix =
    queryAlias === queryNorm ? sql`` : sql`OR starts_with(name_norm, ${queryAlias})`;
  const matchedAlt = matchedAltExpr(sql, queryNorm);
  return sql<CandidateRow[]>`
    SELECT 'street' AS type, NULL AS id, name,
      coalesce(province_norm, '') AS secondary,
      ST_Y(ST_PointOnSurface(geom)) AS lat,
      ST_X(ST_PointOnSurface(geom)) AS lng,
      NULL AS precision,
      greatest(
        word_similarity(${queryNorm}, name_norm),
        similarity(name_norm, ${queryNorm}),
        word_similarity(${queryNorm}, coalesce(name_alt_norm, ''))
        ${aliasSim}
      ) AS sim,
      (starts_with(name_norm, ${queryNorm}) ${aliasPrefix}) AS prefix,
      0 AS pop,
      ${distance(sql, near, 'geom')} AS d,
      ${matchedAlt} AS matched_alt
    FROM street
    WHERE ${queryNorm} <% name_norm
      ${simNorm}
      ${aliasBranch}
      OR ${queryNorm} <% name_alt_norm
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

/** Bậc 2 (spec 5.4): mọi token khớp tiền tố, không kể thứ tự; sim cùng thang bậc 1 (word_similarity). */
export function poiTokenCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, tsQuery, near, sources } = input;
  return sql<CandidateRow[]>`
    SELECT 'poi' AS type, id, name, ${poiSecondary(sql)},
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      word_similarity(${queryNorm}, name_norm) AS sim, false AS prefix,
      coalesce(popularity, 0) AS pop, ${distance(sql, near, 'geom')} AS d, NULL AS matched_alt
    FROM poi p
    WHERE status = 'active' AND ${poiSourceFilter(sql, sources)}
      AND name_tsv @@ to_tsquery('simple', ${tsQuery})
    ORDER BY sim DESC, pop DESC LIMIT 20`;
}

export function streetTokenCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, tsQuery, near } = input;
  return sql<CandidateRow[]>`
    SELECT 'street' AS type, NULL AS id, name, coalesce(province_norm, '') AS secondary,
      ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng, NULL AS precision,
      word_similarity(${queryNorm}, name_norm) AS sim, false AS prefix, 0 AS pop,
      ${distance(sql, near, 'geom')} AS d, NULL AS matched_alt
    FROM street
    WHERE name_tsv @@ to_tsquery('simple', ${tsQuery})
    ORDER BY sim DESC LIMIT 20`;
}

/**
 * Bậc 3 (spec 5.5/6.2): khoá ngữ âm. `name_key` nối từ không khoảng trắng nên gộp được dính/tách
 * từ trong CÙNG một tên (`nha trang` ↔ `nhatrang`), nhưng KHÔNG phải mọi cách viết dính đều gộp —
 * `nhatrang` và `nhac trang` cho khoá khác nhau.
 */
export function poiKeyCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryKey, near, sources } = input;
  return sql<CandidateRow[]>`
    SELECT 'poi' AS type, id, name, ${poiSecondary(sql)},
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      word_similarity(${queryKey}, name_key) AS sim, false AS prefix,
      coalesce(popularity, 0) AS pop, ${distance(sql, near, 'geom')} AS d, NULL AS matched_alt
    FROM poi p
    WHERE status = 'active' AND ${poiSourceFilter(sql, sources)}
      AND ${queryKey} <% name_key
    ORDER BY sim DESC, pop DESC LIMIT 20`;
}

export function streetKeyCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryKey, near } = input;
  return sql<CandidateRow[]>`
    SELECT 'street' AS type, NULL AS id, name, coalesce(province_norm, '') AS secondary,
      ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng, NULL AS precision,
      word_similarity(${queryKey}, name_key) AS sim, false AS prefix, 0 AS pop,
      ${distance(sql, near, 'geom')} AS d, NULL AS matched_alt
    FROM street
    WHERE ${queryKey} <% name_key
    ORDER BY sim DESC LIMIT 20`;
}

/**
 * Chạy song song mọi loại được chọn (spec 5.7) VÀ mọi bậc: mọi truy vấn được phát đi trước khi chờ
 * bất cứ cái nào, nên phần thêm vào thời gian tường là max() chứ không phải tổng.
 *
 * Không nhận `limit`: từ 08/09/2026 số kết quả của bậc 1 không còn quyết định bậc 2/3 có chạy hay
 * không (xem `planStages`). Việc cắt xuống `limit` là của route, sau khi đã xếp hạng bằng
 * `rankScore` có `STAGE_PENALTY`.
 */
export async function collectCandidates(
  sql: Sql,
  input: CandidateQueryInput,
  types: Set<ItemType>,
): Promise<CandidateRow[]> {
  /** Mọi truy vấn của mọi bậc, kèm bậc của nó. Phát đi hết TRƯỚC khi chờ bất cứ cái nào. */
  const jobs: { stage: 1 | 2 | 3; rows: Promise<CandidateRow[]> }[] = [];
  const add = (stage: 1 | 2 | 3, rows: Promise<CandidateRow[]>) => jobs.push({ stage, rows });

  if (types.has('poi')) add(1, poiCandidates(sql, input));
  if (types.has('street')) add(1, streetCandidates(sql, input));
  if (types.has('area')) add(1, areaCandidates(sql, input));
  const { housenumber, streetNorm } = input.parsed;
  if (types.has('address') && housenumber && streetNorm) {
    add(1, addressCandidates(sql, input, housenumber, streetNorm));
  }
  for (const stage of planStages({ tsQuery: input.tsQuery, queryKey: input.queryKey })) {
    if (types.has('poi')) {
      add(stage, stage === 2 ? poiTokenCandidates(sql, input) : poiKeyCandidates(sql, input));
    }
    if (types.has('street')) {
      add(stage, stage === 2 ? streetTokenCandidates(sql, input) : streetKeyCandidates(sql, input));
    }
  }

  const settled = await Promise.all(jobs.map((job) => job.rows));
  // street/address không có id, nên khoá dedup phải lùi về (tên, phụ đề).
  const keyOf = (row: CandidateRow) =>
    `${row.type}:${row.id ?? `${row.name}|${row.secondary ?? ''}`}`;
  const seen = new Set<string>();
  const rows: CandidateRow[] = [];
  // Duyệt theo thứ tự bậc tăng dần để dòng của bậc SỚM hơn thắng dedup: cùng một đối tượng thì giữ
  // bản có `sim` đo ở bậc chính xác hơn và không bị STAGE_PENALTY trừ điểm.
  for (const stage of [1, 2, 3] as const) {
    for (const [index, job] of jobs.entries()) {
      if (job.stage !== stage) continue;
      for (const row of settled[index] ?? []) {
        const key = keyOf(row);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ ...row, stage });
      }
    }
  }
  return rows;
}
