import type { ParsedAddress, PoiSource } from '@mapslibvn/core';
import { areaCandidates } from './area-candidates';
import type { getSql } from './db';
import type { LatLng } from './params';
import { poiSourceFilter } from './poi-sources';
import type { ItemType } from './ranking';
import { type FastGate, planStages } from './stages';

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
/**
 * Nhóm nhánh khớp nào được bật trong một lần gọi `poiCandidates`.
 *
 * `undefined` = tất cả, giữ nguyên hành vi cũ. Hai giá trị kia để **tách** truy vấn làm đôi, và
 * đó là cả điểm của vòng 3: đo trên production 18/09 cho thấy tổng chi phí hai nhánh chạy riêng
 * luôn NHỎ HƠN một truy vấn `OR` gộp — `phuc lonh` 128 + 704 = 832 ms so với 1.561 ms, `cho rya`
 * 17 + 215 = 232 so với 394, `vincon` 69 + 165 = 234 so với 390.
 *
 * Lý do nằm trong kế hoạch truy vấn: `OR` buộc MỘT Bitmap Heap Scan quét hợp của các bitmap rồi
 * recheck toàn bộ biểu thức OR trên từng dòng (`phuc lonh`: 36.285 dòng vào, 20 dòng ra). Tách ra
 * thì mỗi truy vấn chỉ recheck điều kiện của chính nó và có `LIMIT 20` riêng.
 *
 * TÁCH chứ không BỎ. Chế độ `--rank` của `explain-autocomplete` chạy thật trên production và
 * chứng minh bỏ hẳn nhánh `%` làm mất kết quả đúng ở `cirlce k` và `winmrt`, đồng thời đẩy
 * `nguyne hue` từ hạng 1 xuống hạng 7. Hai nhánh cộng lại phủ đúng tập dòng như bản gộp.
 */
export type PoiMatchBranches = 'no-percent' | 'only-percent';

export function poiCandidates(sql: Sql, input: CandidateQueryInput, branches?: PoiMatchBranches) {
  const { queryNorm, queryCore, queryAlias, prefixPattern, near, sources } = input;
  const fuzzy = useSimilarityBranch(queryNorm);
  const coPhanTram = branches !== 'no-percent';
  const coNhanhKhac = branches !== 'only-percent';
  // Biến thể địa danh (spec 6.1): chỉ thêm nhánh khi từ điển thật sự đổi được chuỗi.
  const aliasBranch =
    queryAlias === queryNorm || !coNhanhKhac ? sql`` : sql`OR ${queryAlias} <% name_norm`;
  // Và phải CHẤM ĐIỂM theo dạng chuẩn nữa, không chỉ tìm theo nó. Đo trên production 08/09: POI
  // "Quy Nhơn" cho word_similarity 0,636 với 'qui nhon' nhưng 1,000 với 'quy nhon'. Vì ORDER BY
  // dùng chính `sim` này, thiếu vế alias thì dòng đúng vừa bị xếp thấp vừa bị `LIMIT 20` cắt
  // trước khi tới được bước xếp hạng của route.
  const aliasSim =
    queryAlias === queryNorm ? sql`` : sql`, word_similarity(${queryAlias}, name_norm)`;
  const aliasPrefix =
    queryAlias === queryNorm ? sql`` : sql`OR starts_with(name_norm, ${queryAlias})`;
  const matchedAlt = matchedAltExpr(sql, queryNorm);
  const simNorm = fuzzy && coPhanTram ? sql`OR name_norm % ${queryNorm}` : sql``;
  // Phần lớn truy vấn có nameCore trùng normalizeVi; khi đó nhánh core chỉ là việc thừa.
  // Nhánh core mang CẢ `<%` lẫn `%`, nên lúc tách phải chia đôi nó theo đúng nhóm.
  const coreBranches =
    queryCore === queryNorm
      ? sql``
      : !coNhanhKhac
        ? fuzzy
          ? sql`OR name_norm % ${queryCore}`
          : sql``
        : fuzzy && coPhanTram
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
        ${coNhanhKhac ? sql`${queryNorm} <% name_norm` : sql`false`}
        ${simNorm}
        ${coreBranches}
        ${aliasBranch}
        ${coNhanhKhac ? sql`OR ${queryNorm} <% name_alt_norm` : sql``}
        ${coNhanhKhac ? sql`OR name_norm LIKE ${prefixPattern}` : sql``}
      )
    ORDER BY sim DESC, pop DESC
    LIMIT 20`;
}

/**
 * Số ứng viên lấy ra trước khi tính `sim`.
 *
 * 200 chứ không phải `limit`: `sim` mới quyết định thứ hạng cuối, nên cắt đúng 20 theo
 * `popularity` sẽ vứt mất POI khớp tốt mà ít phổ biến. 200 đủ rộng để xếp hạng còn nghĩa, đủ hẹp
 * để 4 hàm trigram chạy trên nó là miễn phí.
 *
 * Con số này chọn theo lý lẽ, CHƯA theo số đo. Nghi ngờ đầu tiên khi hit@3 tụt: `popularity` là
 * `real` NULL-able nên nhiều dòng hoà 0 và thứ tự trong nhóm hoà là tuỳ ý.
 */
export const FAST_CANDIDATE_POOL = 200;

/**
 * Bậc nhanh (18/09/2026): khớp **tiền tố theo TỪ** bằng `name_tsv`, cắt bể ứng viên theo
 * `popularity`, rồi mới tính `sim` trên bể đó.
 *
 * Vì sao `name_tsv` chứ không phải `name_norm LIKE 'q%'`: tên POI tiếng Việt hầu hết mở đầu bằng
 * từ loại (Chợ, Trường, Bệnh viện, Quán), nên khớp tiền tố của CẢ CHUỖI là hỏng recall —
 * `ben thanh` sẽ không tìm ra "Chợ Bến Thành". `to_tsquery('simple','ben:* & thanh:*')` khớp mọi
 * tên có một từ bắt đầu bằng `ben` VÀ một từ bắt đầu bằng `thanh`, không kể vị trí: đúng cái `<%`
 * đang lo, mà không phải tính trigram lúc quét.
 *
 * Vì sao nhanh (đo production 18/09, poi active 376.468): `qu` vẫn quét đúng 29.107 dòng như câu
 * cũ nhưng tốn 183 ms thay vì 1.361 ms. Chi phí nằm ở việc tính 4 hàm trigram cho MỌI dòng qua
 * được WHERE — vì `sim` nằm trong `ORDER BY` — chứ không ở việc quét chỉ số (149 ms) hay đọc đĩa
 * (0 lần đọc). Cắt 200 dòng trước là bỏ hẳn khoản đó.
 *
 * KHÔNG trả `matched_alt`: nó cần `unnest` hai mảng song song, mà bậc nhanh không khớp theo
 * `name_alt_norm` nên không có tên thay thế nào để khoe. Đường dự phòng vẫn trả như cũ.
 */
export function poiFastCandidates(sql: Sql, input: CandidateQueryInput, tsQuery: string) {
  const { queryNorm, queryCore, near, sources } = input;
  // Chấm điểm theo CẢ dạng lõi, y như bậc 1. Nghiệm thu 18/09 trượt vì thiếu đúng vế này:
  // `nameCore('bhx')` = 'bach hoa xanh', tìm ra đúng POI nhưng `sim` tính theo 'bhx' nên nó rơi
  // ngoài top 3. Chỉ thêm khi thật sự khác — phần lớn truy vấn có core trùng norm.
  const coreSim = queryCore === queryNorm ? sql`` : sql`, word_similarity(${queryCore}, name_norm)`;
  return sql<CandidateRow[]>`
    WITH ung_vien AS (
      SELECT id, name, street, admin_ward, ward, admin_province, province, geom,
             name_norm, name_alt_norm, popularity
      FROM poi p
      WHERE status = 'active'
        AND ${poiSourceFilter(sql, sources)}
        AND name_tsv @@ to_tsquery('simple', ${tsQuery})
      -- Tên bắt đầu bằng đúng truy vấn vào bể TRƯỚC: cắt thuần theo popularity thì POI trùng tên
      -- chính xác nhưng một nguồn (OSM 1,0 < FSQ 1,5) bị hàng trăm tên chứa cùng từ đẩy ra ngoài
      -- ("hồ tây" không ra Hồ Tây, đo toàn quốc 26/09/2026). starts_with là so chuỗi, không phải
      -- hàm trigram, nên bể vẫn cắt rẻ như trước.
      ORDER BY starts_with(name_norm, ${queryNorm}) DESC, coalesce(popularity, 0) DESC
      LIMIT ${FAST_CANDIDATE_POOL}
    )
    SELECT 'poi' AS type, id, name,
      ${poiSecondary(sql)},
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      greatest(
        word_similarity(${queryNorm}, name_norm),
        similarity(name_norm, ${queryNorm}),
        word_similarity(${queryNorm}, coalesce(name_alt_norm, ''))
        ${coreSim}
      ) AS sim,
      starts_with(name_norm, ${queryNorm}) AS prefix,
      coalesce(popularity, 0) AS pop,
      ${distance(sql, near, 'geom')} AS d,
      NULL AS matched_alt
    FROM ung_vien
    ORDER BY sim DESC, prefix DESC, pop DESC
    LIMIT 20`;
}

/**
 * Bậc nhanh cho `street`, cùng bệnh và cùng thuốc với POI: `sim` nằm trong `ORDER BY` nên 3 hàm
 * trigram chạy cho MỌI dòng khớp. Đo production 18/09 trên `street`: thay `sim` bằng hằng số làm
 * `qu` tụt 287→54 ms và `ben thanh` 336→33 ms, và nút rộng nhất tụt từ 4.507/9.245 dòng xuống
 * **20 dòng @ Limit** — Postgres thôi hiện thực hoá mọi dòng khớp. Hai nghi can khác vô can: bỏ
 * `ST_PointOnSurface` chỉ được 0–20 %, bỏ `matched_alt` gần 0 %.
 *
 * Tiêu chí cắt là KHOẢNG CÁCH, không phải `popularity` như POI — bảng `street` không có cột đó, và
 * người gõ tên đường gần như luôn muốn con đường gần mình. Dùng `geom <-> điểm` (toán tử KNN của
 * GiST) chứ không `ST_DistanceSphere`: rẻ hơn hẳn và đi được qua `street_geom_idx`.
 *
 * **Chỉ gọi khi có `near`** — không có điểm thì không có tiêu chí cắt, và cắt 200 dòng tuỳ ý còn
 * tệ hơn chậm. `collectCandidates` lo điều kiện đó.
 */
export function streetFastCandidates(sql: Sql, input: CandidateQueryInput, tsQuery: string) {
  const { queryNorm, near } = input;
  const point = nearPoint(sql, near);
  return sql<CandidateRow[]>`
    WITH ung_vien AS (
      SELECT id, name, province_norm, geom, name_norm, name_alt_norm
      FROM street
      WHERE name_tsv @@ to_tsquery('simple', ${tsQuery})
      ORDER BY geom <-> ${point}
      LIMIT ${FAST_CANDIDATE_POOL}
    )
    SELECT 'street' AS type, NULL AS id, name,
      coalesce(province_norm, '') AS secondary,
      ST_Y(ST_PointOnSurface(geom)) AS lat,
      ST_X(ST_PointOnSurface(geom)) AS lng,
      NULL AS precision,
      greatest(
        word_similarity(${queryNorm}, name_norm),
        similarity(name_norm, ${queryNorm}),
        word_similarity(${queryNorm}, coalesce(name_alt_norm, ''))
      ) AS sim,
      starts_with(name_norm, ${queryNorm}) AS prefix,
      0 AS pop,
      ${distance(sql, near, 'geom')} AS d,
      NULL AS matched_alt
    FROM ung_vien
    ORDER BY sim DESC
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
  fast?: FastGate,
): Promise<CandidateRow[]> {
  /** Mọi truy vấn của mọi bậc, kèm bậc của nó. Phát đi hết TRƯỚC khi chờ bất cứ cái nào. */
  const jobs: { stage: 1 | 2 | 3; rows: Promise<CandidateRow[]> }[] = [];
  const add = (stage: 1 | 2 | 3, rows: Promise<CandidateRow[]>) => {
    // Gắn handler NGAY lúc phát, không đợi `Promise.all` cuối hàm.
    //
    // Từ khi có bậc nhanh, giữa lúc phát và lúc chờ có một `await`. Job nào hỏng trong khoảng đó
    // sẽ bị runtime gắn nhãn "unhandled rejection" ngay cuối lượt vi tác vụ ấy — handler attach
    // sau đó không gỡ nhãn được nữa. Đo thật: bật cờ ở dev vars làm bộ test API từ 0 lỗi nhảy lên
    // 4 unhandled rejection, tất cả từ `areaQuery`, dù 446 test vẫn xanh.
    //
    // `.catch()` ở đây CHỈ để nhận nhãn, không nuốt lỗi: `rows` vẫn reject nguyên vẹn cho nhánh
    // await thật ở dưới, nên route vẫn bắt được và trả 503.
    rows.catch(() => {});
    jobs.push({ stage, rows });
  };

  // `area`/`address` chạy y như nhau dù đi đường nào, nên bắn TRƯỚC, không chờ bậc nhanh.
  if (types.has('area')) add(1, areaCandidates(sql, input));
  const { housenumber, streetNorm } = input.parsed;
  if (types.has('address') && housenumber && streetNorm) {
    add(1, addressCandidates(sql, input, housenumber, streetNorm));
  }

  // Hai bậc nhanh bắn SONG SONG rồi mới chờ: nối tiếp chúng là cộng 161 + 83 ms thay vì max().
  // Phải chờ xong mới biết có cần nhánh trigram không — không bắn trigram song song rồi bỏ kết
  // quả, vì chi phí nằm ở CPU của origin, không ở thời gian chờ của Worker.
  //
  // Cả khối nằm trong `if`: cờ tắt thì KHÔNG có `await` nào ở đây, nên đường đi giống hệt bản
  // trước bậc nhanh — kể cả về thứ tự phát truy vấn, thứ mà test "mọi bậc phát đi trước khi chờ"
  // khoá lại. Một `await Promise.all([null, null])` cũng đủ hoãn mọi lời gọi sang microtask sau.
  let poiFast: CandidateRow[] | null = null;
  let streetFast: CandidateRow[] | null = null;
  if (fast?.tsQuery) {
    const tsQuery = fast.tsQuery;
    // `allSettled` chứ KHÔNG phải `all`: `all` chỉ xử lý lời từ chối đầu tiên, cái còn lại thành
    // unhandled rejection. Khi DB sập thì CẢ HAI truy vấn cùng reject — đo được ngay khi bật cờ ở
    // dev vars: bộ test API từ 0 lỗi nhảy lên 4 lỗi, dù 446 test vẫn xanh. Route vẫn trả 503 đúng,
    // nhưng mỗi request lúc DB sập lại ném thêm một rejection không ai bắt.
    const [ketQuaPoi, ketQuaStreet] = await Promise.allSettled([
      types.has('poi') ? poiFastCandidates(sql, input, tsQuery) : null,
      // Bậc nhanh street cắt theo khoảng cách, nên không có `near` thì không có tiêu chí cắt.
      types.has('street') && input.near ? streetFastCandidates(sql, input, tsQuery) : null,
    ]);
    // Ném lại lỗi thật để route bắt và trả 503 — `allSettled` chỉ đổi cách CHỜ, không nuốt lỗi.
    if (ketQuaPoi.status === 'rejected') throw ketQuaPoi.reason;
    if (ketQuaStreet.status === 'rejected') throw ketQuaStreet.reason;
    poiFast = ketQuaPoi.value;
    streetFast = ketQuaStreet.value;
  }

  // Cổng của poi là `>= limit`: bậc nhanh phải lấp đủ chỗ thì mới bỏ được nhánh trigram.
  const fastRows = poiFast && poiFast.length >= (fast?.limit ?? 0) ? poiFast : null;
  if (fastRows) add(1, Promise.resolve(fastRows));
  else if (types.has('poi')) {
    // Đường dự phòng: tách nhánh `%` ra truy vấn riêng chạy song song. Tổng chi phí hai nhánh
    // riêng nhỏ hơn hẳn một truy vấn `OR` gộp (đo 18/09: `phuc lonh` 832 so với 1.561 ms), vì
    // `OR` buộc một Bitmap Heap Scan recheck toàn bộ biểu thức trên từng dòng của hợp bitmap.
    //
    // Truy vấn dài hơn `SIMILARITY_MAX_QUERY_LENGTH` vốn không có nhánh `%`, nên tách sẽ tạo ra
    // một truy vấn `WHERE false` vô ích — giữ nguyên một lời gọi cho nhóm đó.
    if (useSimilarityBranch(input.queryNorm)) {
      add(1, poiCandidates(sql, input, 'no-percent'));
      add(1, poiCandidates(sql, input, 'only-percent'));
    } else {
      add(1, poiCandidates(sql, input));
    }
  }

  // Cổng của street là `> 0`, KHÁC poi: đường hiếm khi có đủ 10 kết quả tốt, mà khớp theo từ của
  // tsvector lại chính xác hơn trigram. Rỗng thì phải lui — đo 18/09: `cafe` cho tsvector 0 dòng
  // (tên đường không chứa từ nào bắt đầu bằng "cafe") trong khi trigram cho 8.914 dòng.
  if (types.has('street')) {
    if (streetFast && streetFast.length > 0) add(1, Promise.resolve(streetFast));
    else add(1, streetCandidates(sql, input));
  }

  // Bậc 2/3 chỉ để thêm recall khi bậc 1 yếu. Đường nhanh đã đủ `limit` kết quả khớp theo từ thì
  // chúng chỉ còn là chi phí — đo production 18/09: bậc 3 tốn 247–432 ms với truy vấn ngắn.
  if (!fastRows) {
    for (const stage of planStages({ tsQuery: input.tsQuery, queryKey: input.queryKey })) {
      if (types.has('poi')) {
        add(stage, stage === 2 ? poiTokenCandidates(sql, input) : poiKeyCandidates(sql, input));
      }
      if (types.has('street')) {
        add(
          stage,
          stage === 2 ? streetTokenCandidates(sql, input) : streetKeyCandidates(sql, input),
        );
      }
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
