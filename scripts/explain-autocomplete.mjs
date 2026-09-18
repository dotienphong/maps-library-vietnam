#!/usr/bin/env node
/**
 * Chẩn đoán độ trễ `/v1/autocomplete` bằng EXPLAIN (ANALYZE, BUFFERS) trên **DB máy chủ**.
 *
 * Vì sao cần: đo qua HTTP chỉ cho biết TỔNG (18/09/2026: cache-hit 123 ms, cache-miss p50 2.849 ms
 * — xem `docs/evidence/perf/2026-09-18-autocomplete-cold.md`). Tổng không nói được thời gian nằm ở
 * nhánh nào, nên vá theo tổng là đoán. Script này chạy từng nhánh RIÊNG và bỏ bớt từng thành phần
 * để **quy** thời gian cho chúng, thay vì đọc một con số rồi suy diễn.
 *
 * Cách dùng (cần .env ở gốc repo có DB_TUNNEL_HOSTNAME + PIPELINE_DATABASE_URL + CF_ACCESS_*,
 * và `pnpm build` đã chạy vì script dùng `packages/core/dist` để rút gọn truy vấn đúng như API):
 *   pnpm explain:autocomplete
 *   pnpm explain:autocomplete -- --q "ben thanh" --q cafe --repeat 5 --sweep --plan
 *
 * Cờ: `--q` (lặp lại được) · `--repeat N` số lần chạy mỗi biến thể, lấy trung vị (mặc định 3) ·
 * `--threshold X` ngưỡng `<%` ép cho phiên đo (mặc định 0,6 = giá trị production đang chạy) ·
 * `--sweep` quét ngưỡng 0,5–0,8 · `--plan` in kế hoạch đầy đủ.
 *
 * Script TỰ mở Cloudflare Tunnel (như `data:update`), không cần mở terminal thứ hai, không cần psql.
 *
 * CHỈ ĐỌC: không ghi, không ALTER, không tạo chỉ số. An toàn chạy trên production — nhưng nó DÙNG
 * CPU của Postgres đang phục vụ thật, nên đừng chạy song song với pipeline dữ liệu.
 */
import { readFileSync } from 'node:fs';
import 'dotenv/config';
import postgres from 'postgres';
import {
  applyToponymAlias,
  nameCore,
  normalizeVi,
  parseAddress,
  viKey,
} from '../packages/core/dist/index.js';
import { openDatabaseTunnel } from './lib/tunnel.mjs';
import { parseQueryFixture } from './perf-autocomplete.mjs';

/** Truy vấn mặc định: 2 ký tự (nghi chậm nhất), cụm ngắn, và cụm dài — ba chế độ chi phí khác nhau. */
const DEFAULT_QUERIES = ['qu', 'cafe', 'ben thanh', 'truong tieu hoc'];
/** `SIMILARITY_MAX_QUERY_LENGTH` của apps/api/src/autocomplete-sql.ts — giữ hai nơi bằng nhau. */
const SIMILARITY_MAX_QUERY_LENGTH = 12;
/** Bộ nguồn mặc định của API (profile `all`). */
const SOURCES = "ARRAY['osm','fsq']::text[]";
const SOURCE_FILTER = `(p.primary_source = ANY(${SOURCES}) OR p.created_by = 'user')`;
/** `near` mặc định của các phép đo perf, để số đo so được với `perf-autocomplete`. */
const NEAR = 'ST_SetSRID(ST_MakePoint(106.700, 10.776), 4326)';

/** @param {string} raw */
const lit = (raw) => `'${raw.replace(/'/g, "''")}'`;

/** Bản sao của `tsQueryFor` trong apps/api/src/stages.ts (TS, không import được từ .mjs). */
function tsQueryFor(/** @type {string} */ queryNorm) {
  const tokens = queryNorm
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));
  return tokens.length < 2 ? null : tokens.map((t) => `${t}:*`).join(' & ');
}

/**
 * Như `tsQueryFor` nhưng **nhận cả truy vấn một token**. Bản trong `stages.ts` trả null khi < 2
 * token với lý do "một token thì bậc 1 đã lo xong" — đúng khi bậc 1 rẻ, nhưng bậc 1 chính là thứ
 * tốn 1,3–3,5 s. Nếu muốn dùng tsvector làm bậc nhanh thì nó phải phục vụ được `cafe` và `qu`.
 */
function tsQueryAnyToken(/** @type {string} */ queryNorm) {
  const tokens = queryNorm
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));
  return tokens.length === 0 ? null : tokens.map((t) => `${t}:*`).join(' & ');
}

/**
 * Hình dạng ỨNG VIÊN cho bậc nhanh: lọc bằng một điều kiện rẻ, cắt lấy 200 dòng phổ biến nhất,
 * RỒI mới tính `sim`. Mấu chốt là `sim` không còn nằm trong ORDER BY của bước quét — câu hiện tại
 * tính 4 hàm trigram cho mọi dòng khớp (12.817–28.754 dòng) chỉ để lấy ra 20.
 *
 * @param {string} q @param {string} dieu_kien mệnh đề lọc, dùng alias `p`
 */
function bacNhanh(q, dieu_kien) {
  const qs = lit(q);
  return `
    WITH ung_vien AS (
      SELECT id, name, street, admin_ward, ward, admin_province, province, geom,
             name_norm, name_alt_norm, popularity
      FROM poi p
      WHERE status = 'active'
        AND ${SOURCE_FILTER}
        AND ${dieu_kien}
      ORDER BY coalesce(popularity, 0) DESC
      LIMIT 200
    )
    SELECT 'poi' AS type, id, name,
      concat_ws(', ', street, coalesce(admin_ward, ward), coalesce(admin_province, province)) AS secondary,
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      greatest(
        word_similarity(${qs}, name_norm),
        similarity(name_norm, ${qs}),
        word_similarity(${qs}, coalesce(name_alt_norm, ''))
      ) AS sim,
      starts_with(name_norm, ${qs}) AS prefix,
      coalesce(popularity, 0) AS pop,
      ST_DistanceSphere(geom, ${NEAR}) AS d,
      NULL AS matched_alt
    FROM ung_vien
    ORDER BY sim DESC, pop DESC
    LIMIT 20`;
}

/**
 * Dựng ĐÚNG câu bậc 1 của `poiCandidates()` cho một truy vấn đã rút gọn, với một thành phần bị bỏ.
 *
 * Chỉ nhận truy vấn mà `queryNorm === queryCore === queryAlias`: khi đó mọi nhánh điều kiện của
 * builder (aliasBranch, aliasSim, aliasPrefix, coreBranches) rỗng và câu dưới đây là bản sao chính
 * xác, không phải bản "gần giống". Truy vấn nào không rút gọn được thì `buildCases()` từ chối —
 * thà không đo còn hơn đo một câu khác với câu production đang chạy.
 *
 * @param {string} q đã chuẩn hoá
 * @param {'full'|'no_matched_alt'|'no_distance'|'no_like'|'no_percent'|'chi_wordsim'
 *   |'chi_percent'|'chi_like'} bien_the
 */
function poiStage1(q, bien_the) {
  const fuzzy = q.length <= SIMILARITY_MAX_QUERY_LENGTH;
  const qs = lit(q);
  const prefix = lit(`${q.replace(/[\\%_]/g, '\\$&')}%`);
  const matchedAlt =
    bien_the === 'no_matched_alt'
      ? 'NULL'
      : `(SELECT a.orig FROM unnest(name_alt, string_to_array(name_alt_norm, ' | ')) AS a(orig, norm)
         WHERE ${qs} <% a.norm ORDER BY word_similarity(${qs}, a.norm) DESC LIMIT 1)`;
  const distance = bien_the === 'no_distance' ? 'NULL::float8' : `ST_DistanceSphere(geom, ${NEAR})`;

  // Ba biến thể "chỉ một nhánh" không phải để đề xuất dùng — chúng đo GIÁ RIÊNG và SỐ DÒNG RIÊNG
  // của từng nhánh, thứ mà mệnh đề OR gộp lại thì không tách ra được.
  /** @type {string[]} */
  let where;
  if (bien_the === 'chi_wordsim') where = [`${qs} <% name_norm`];
  else if (bien_the === 'chi_percent') where = [`name_norm % ${qs}`];
  else if (bien_the === 'chi_like') where = [`name_norm LIKE ${prefix}`];
  else {
    where = [`${qs} <% name_norm`];
    if (fuzzy && bien_the !== 'no_percent') where.push(`name_norm % ${qs}`);
    where.push(`${qs} <% name_alt_norm`);
    if (bien_the !== 'no_like') where.push(`name_norm LIKE ${prefix}`);
  }

  return `
    SELECT 'poi' AS type, id, name,
      concat_ws(', ', street, coalesce(admin_ward, ward), coalesce(admin_province, province)) AS secondary,
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      greatest(
        word_similarity(${qs}, name_norm),
        word_similarity(${qs}, name_norm),
        similarity(name_norm, ${qs}),
        word_similarity(${qs}, coalesce(name_alt_norm, ''))
      ) AS sim,
      starts_with(name_norm, ${qs}) AS prefix,
      coalesce(popularity, 0) AS pop,
      ${distance} AS d,
      ${matchedAlt} AS matched_alt
    FROM poi p
    WHERE status = 'active'
      AND ${SOURCE_FILTER}
      AND (${where.join('\n        OR ')})
    ORDER BY sim DESC, pop DESC
    LIMIT 20`;
}

/** Bậc 2 (tsvector) và bậc 3 (khoá ngữ âm) chạy SONG SONG với bậc 1 trên cùng một Postgres. */
function poiStage2(/** @type {string} */ tsQuery, /** @type {string} */ q) {
  return `
    SELECT 'poi' AS type, id, name, word_similarity(${lit(q)}, name_norm) AS sim,
      coalesce(popularity, 0) AS pop, ST_DistanceSphere(geom, ${NEAR}) AS d
    FROM poi p
    WHERE status = 'active' AND ${SOURCE_FILTER}
      AND name_tsv @@ to_tsquery('simple', ${lit(tsQuery)})
    ORDER BY sim DESC, pop DESC LIMIT 20`;
}

/**
 * Bậc 1 của `streetCandidates()`. Bảng `street` không có `status` lẫn bộ lọc nguồn, và ở dạng rút
 * gọn thì nhánh alias rỗng — nên bản này là bản sao chính xác.
 */
function streetStage1(/** @type {string} */ q) {
  const qs = lit(q);
  const prefix = lit(`${q.replace(/[\\%_]/g, '\\$&')}%`);
  const simNorm = q.length <= SIMILARITY_MAX_QUERY_LENGTH ? `\n      OR name_norm % ${qs}` : '';
  return `
    SELECT 'street' AS type, NULL AS id, name,
      coalesce(province_norm, '') AS secondary,
      ST_Y(ST_PointOnSurface(geom)) AS lat,
      ST_X(ST_PointOnSurface(geom)) AS lng,
      NULL AS precision,
      greatest(
        word_similarity(${qs}, name_norm),
        similarity(name_norm, ${qs}),
        word_similarity(${qs}, coalesce(name_alt_norm, ''))
      ) AS sim,
      starts_with(name_norm, ${qs}) AS prefix,
      0 AS pop,
      ST_DistanceSphere(geom, ${NEAR}) AS d,
      (SELECT a.orig FROM unnest(name_alt, string_to_array(name_alt_norm, ' | ')) AS a(orig, norm)
        WHERE ${qs} <% a.norm ORDER BY word_similarity(${qs}, a.norm) DESC LIMIT 1) AS matched_alt
    FROM street
    WHERE ${qs} <% name_norm${simNorm}
      OR ${qs} <% name_alt_norm
      OR name_norm LIKE ${prefix}
    ORDER BY sim DESC
    LIMIT 20`;
}

/**
 * Biến thể của bậc 1 street, mỗi biến thể bỏ một thứ, để quy chi phí.
 *
 * `street` KHÔNG có cột `popularity`, nên khuôn "cắt 200 theo popularity" của POI không áp thẳng
 * được — phải biết chi phí nằm ở đâu trước khi chọn tiêu chí cắt. Ba nghi can, theo thứ tự nghi
 * ngờ: (1) `sim` gồm 3 hàm trigram tính cho MỌI dòng khớp vì nó nằm trong ORDER BY — đúng bệnh đã
 * chẩn ra ở POI; (2) `ST_PointOnSurface(geom)` gọi HAI lần mỗi dòng (lat và lng) trên
 * MultiLineString; (3) subquery `matched_alt`.
 *
 * @param {string} q
 * @param {'full'|'no_geom'|'no_matched_alt'|'no_sim'} bien_the
 */
function streetVariant(q, bien_the) {
  const qs = lit(q);
  const prefix = lit(`${q.replace(/[\\%_]/g, '\\$&')}%`);
  const simNorm = q.length <= SIMILARITY_MAX_QUERY_LENGTH ? `\n      OR name_norm % ${qs}` : '';
  const toaDo =
    bien_the === 'no_geom'
      ? 'NULL::float8 AS lat, NULL::float8 AS lng, NULL::float8 AS d'
      : `ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng,
         ST_DistanceSphere(geom, ${NEAR}) AS d`;
  const sim =
    bien_the === 'no_sim'
      ? '0::float8 AS sim'
      : `greatest(
        word_similarity(${qs}, name_norm),
        similarity(name_norm, ${qs}),
        word_similarity(${qs}, coalesce(name_alt_norm, ''))
      ) AS sim`;
  const matchedAlt =
    bien_the === 'no_matched_alt'
      ? 'NULL'
      : `(SELECT a.orig FROM unnest(name_alt, string_to_array(name_alt_norm, ' | ')) AS a(orig, norm)
        WHERE ${qs} <% a.norm ORDER BY word_similarity(${qs}, a.norm) DESC LIMIT 1)`;
  return `
    SELECT 'street' AS type, NULL AS id, name,
      coalesce(province_norm, '') AS secondary,
      ${toaDo},
      NULL AS precision,
      ${sim},
      starts_with(name_norm, ${qs}) AS prefix,
      0 AS pop,
      ${matchedAlt} AS matched_alt
    FROM street
    WHERE ${qs} <% name_norm${simNorm}
      OR ${qs} <% name_alt_norm
      OR name_norm LIKE ${prefix}
    ORDER BY sim DESC
    LIMIT 20`;
}

/**
 * Ứng viên "bậc nhanh" cho street: lọc bằng `name_tsv`, cắt 200 dòng GẦN NHẤT rồi mới tính `sim`.
 *
 * Không có `popularity` thì tiêu chí cắt hợp lý duy nhất là khoảng cách — người gõ tên đường gần
 * như luôn muốn con đường gần mình. Dùng `geom <-> điểm` (toán tử KNN của GiST) chứ không dùng
 * `ST_DistanceSphere`: `<->` rẻ hơn hẳn và có thể đi qua chỉ số `street_geom_idx`.
 *
 * @param {string} q @param {string} tsQuery
 */
function streetNhanh(q, tsQuery) {
  const qs = lit(q);
  return `
    WITH ung_vien AS (
      SELECT id, name, province_norm, geom, name_norm, name_alt_norm
      FROM street
      WHERE name_tsv @@ to_tsquery('simple', ${lit(tsQuery)})
      ORDER BY geom <-> ${NEAR}
      LIMIT 200
    )
    SELECT 'street' AS type, NULL AS id, name,
      coalesce(province_norm, '') AS secondary,
      ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng,
      NULL AS precision,
      greatest(
        word_similarity(${qs}, name_norm),
        similarity(name_norm, ${qs}),
        word_similarity(${qs}, coalesce(name_alt_norm, ''))
      ) AS sim,
      starts_with(name_norm, ${qs}) AS prefix,
      0 AS pop,
      ST_DistanceSphere(geom, ${NEAR}) AS d,
      NULL AS matched_alt
    FROM ung_vien
    ORDER BY sim DESC
    LIMIT 20`;
}

/**
 * `areaQuery()` của area-candidates.ts. Chỉ đúng khi `parseAddress` không tách được ward/district/
 * province — lúc đó `aliasLevel` là null và `currentKey === queryCore === q`; `buildCases()` chặn
 * mọi truy vấn khác.
 *
 * Hai pha là CỐ Ý và đã có trong mã: `areaCandidates` chạy pha tiền tố trước, **chỉ khi rỗng** mới
 * chạy pha fuzzy. Đo riêng từng pha vì truy vấn POI thường (`cafe`) không khớp vùng nào, nên nó
 * luôn phải trả giá cả hai vòng.
 *
 * @param {string} q @param {boolean} fuzzy @param {string} queryKey
 */
function areaQuery(q, fuzzy, queryKey) {
  const qs = lit(q);
  const prefix = lit(`${q.replace(/[\\%_]/g, '\\$&')}%`);
  const keyBranch = fuzzy && queryKey ? lit(queryKey) : null;
  const currentMatch = fuzzy
    ? `(${qs} <% a.name_norm OR a.name_norm LIKE ${prefix}
        ${keyBranch ? `OR ${keyBranch} <% a.name_key` : ''})`
    : `a.name_norm LIKE ${prefix}`;
  const aliasMatch = fuzzy
    ? `(${qs} <% aa.alias_norm OR aa.alias_norm LIKE ${prefix}
        ${keyBranch ? `OR ${keyBranch} <% aa.alias_key` : ''})`
    : `aa.alias_norm LIKE ${prefix}`;
  return `WITH current_hits AS (
      SELECT concat('current:',a.id) dedup_key,1 source_order,a.name,
        CASE WHEN a.level=4 THEN '' ELSE coalesce(parent.name,'') END secondary,
        CASE WHEN a.level=4 THEN 'province' ELSE 'ward' END AS precision,
        greatest(word_similarity(${qs},a.name_norm),similarity(a.name_norm,${qs})) sim,
        starts_with(a.name_norm,${qs}) prefix,a.geom candidate_geom
      FROM admin_area a
      LEFT JOIN admin_area parent ON parent.id=a.parent_id
      WHERE ${currentMatch}
    ), alias_edges AS (
      SELECT coalesce('old:'||aa.old_area_id,'alias:'||aa.level||':'||aa.alias_norm) group_key,
        aa.old_area_id,aa.level,aa.alias_norm,current.id current_id,current.name current_name,
        greatest(word_similarity(${qs},aa.alias_norm),similarity(aa.alias_norm,${qs})) sim,
        starts_with(aa.alias_norm,${qs}) prefix
      FROM admin_alias aa
      JOIN admin_area current ON current.id=aa.admin_area_id
      WHERE aa.source IN ('overlay','seed')
        AND ${aliasMatch}
    ), alias_grouped AS (
      SELECT group_key,old_area_id,level,min(alias_norm) alias_norm,
        min(current_id) representative_id,
        array_agg(DISTINCT current_name ORDER BY current_name) target_names,
        count(DISTINCT current_id)::int target_count,max(sim) sim,bool_or(prefix) prefix
      FROM alias_edges
      GROUP BY group_key,old_area_id,level
    ), alias_hits AS (
      SELECT
        CASE WHEN g.old_area_id IS NULL OR g.level=4 OR (g.level=8 AND g.target_count=1)
          THEN concat('current:',representative.id) ELSE g.group_key END dedup_key,
        0 source_order,
        CASE WHEN g.old_area_id IS NULL OR g.level=4 OR (g.level=8 AND g.target_count=1)
          THEN representative.name ELSE old.name END name,
        CASE WHEN g.old_area_id IS NULL THEN g.alias_norm
          WHEN g.level=4 OR (g.level=8 AND g.target_count=1) THEN old.name
          ELSE array_to_string(g.target_names[1:3],', ') ||
            CASE WHEN g.target_count>3 THEN ', …' ELSE '' END END secondary,
        CASE WHEN g.old_area_id IS NULL THEN CASE WHEN representative.level=4 THEN 'province' ELSE 'ward' END
          WHEN g.level=4 THEN 'province' WHEN g.level=6 THEN 'district' ELSE 'ward' END AS precision,
        g.sim,g.prefix,
        CASE WHEN g.old_area_id IS NULL OR g.level=4 OR (g.level=8 AND g.target_count=1)
          THEN representative.geom ELSE old.geom END candidate_geom
      FROM alias_grouped g
      JOIN admin_area representative ON representative.id=g.representative_id
      LEFT JOIN admin_area_old old ON old.id=g.old_area_id
    ), unioned AS (
      SELECT * FROM current_hits UNION ALL SELECT * FROM alias_hits
    ), deduped AS (
      SELECT *,row_number() OVER (
        PARTITION BY dedup_key ORDER BY source_order,sim DESC,prefix DESC,name
      ) position
      FROM unioned
    )
    SELECT 'area' type,NULL::text id,name,secondary,
      ST_Y(ST_PointOnSurface(candidate_geom)) lat,
      ST_X(ST_PointOnSurface(candidate_geom)) lng,precision,sim,prefix,0 AS pop,
      ST_DistanceSphere(ST_PointOnSurface(candidate_geom),${NEAR}) d,
      json_build_array(ST_XMin(candidate_geom),ST_YMin(candidate_geom),
        ST_XMax(candidate_geom),ST_YMax(candidate_geom)) bbox
    FROM deduped
    WHERE position=1 AND candidate_geom IS NOT NULL
    ORDER BY sim DESC,prefix DESC,name,dedup_key
    LIMIT 20`;
}

function poiStage3(/** @type {string} */ queryKey) {
  return `
    SELECT 'poi' AS type, id, name, word_similarity(${lit(queryKey)}, name_key) AS sim,
      coalesce(popularity, 0) AS pop, ST_DistanceSphere(geom, ${NEAR}) AS d
    FROM poi p
    WHERE status = 'active' AND ${SOURCE_FILTER}
      AND ${lit(queryKey)} <% name_key
    ORDER BY sim DESC, pop DESC LIMIT 20`;
}

/**
 * Rút gọn truy vấn người dùng về dạng builder dùng, và TỪ CHỐI truy vấn không rút gọn được.
 * @param {string[]} raw
 */
export function buildCases(raw) {
  /** @type {{ q: string, sql: Record<string, string> }[]} */
  const cases = [];
  for (const input of raw) {
    const q = normalizeVi(input);
    const core = nameCore(input);
    const alias = applyToponymAlias(q);
    if (q !== core || q !== alias) {
      throw new Error(
        `"${input}" không rút gọn được (norm="${q}" core="${core}" alias="${alias}") — ` +
          'câu dựng ở đây sẽ KHÁC câu production, nên không đo. Chọn truy vấn khác.',
      );
    }
    // Nhánh `area` đổi hình dạng khi parseAddress tách được đơn vị hành chính (aliasLevel, và
    // currentKey lấy theo ward/district thay vì queryCore); nhánh `address` chỉ chạy khi có số nhà.
    const parsed = parseAddress(input);
    if (parsed.ward || parsed.district || parsed.province || parsed.housenumber) {
      throw new Error(
        `"${input}" có phần hành chính/số nhà (ward=${parsed.ward} district=${parsed.district} ` +
          `province=${parsed.province} hn=${parsed.housenumber}) — câu area/address dựng ở đây sẽ ` +
          'KHÁC câu production, nên không đo. Chọn truy vấn khác.',
      );
    }
    const tsQuery = tsQueryFor(q);
    const key = viKey(alias);
    cases.push({
      q,
      sql: {
        full: poiStage1(q, 'full'),
        no_matched_alt: poiStage1(q, 'no_matched_alt'),
        no_distance: poiStage1(q, 'no_distance'),
        no_like: poiStage1(q, 'no_like'),
        no_percent: poiStage1(q, 'no_percent'),
        chi_wordsim: poiStage1(q, 'chi_wordsim'),
        chi_percent: poiStage1(q, 'chi_percent'),
        chi_like: poiStage1(q, 'chi_like'),
        // Bậc 2/3 chạy SONG SONG với bậc 1 trên cùng một Postgres: khi máy rảnh chúng không cộng
        // vào thời gian tường, nhưng khi máy bận chúng cộng vào TẢI CPU — phải biết giá của chúng.
        ...(tsQuery ? { bac2_tsvector: poiStage2(tsQuery, q) } : {}),
        ...(key ? { bac3_name_key: poiStage3(key) } : {}),
        // Hai loại còn lại của bậc 1, cũng chạy song song. Thời gian tường của route là max() của
        // tất cả, nên một loại chậm hơn poi thì chính nó mới là thứ quyết định.
        street: streetStage1(q),
        street_no_geom: streetVariant(q, 'no_geom'),
        street_no_matched_alt: streetVariant(q, 'no_matched_alt'),
        street_no_sim: streetVariant(q, 'no_sim'),
        ...(tsQueryAnyToken(q) ? { street_nhanh: streetNhanh(q, tsQueryAnyToken(q) ?? '') } : {}),
        area_prefix: areaQuery(q, false, key),
        area_fuzzy: areaQuery(q, true, key),
        // ——— Ứng viên cho "bậc nhanh". Đo hình dạng TRƯỚC khi viết mã sản phẩm.
        // `nhanh_like` là ý tưởng tiền tố thuần: RẺ nhưng SAI NGỮ NGHĨA với tên tiếng Việt —
        // `ben thanh` không khớp "Chợ Bến Thành" vì tên đó bắt đầu bằng "cho". Đo để có số đối
        // chứng, không phải để dùng.
        nhanh_like: bacNhanh(q, `name_norm LIKE ${lit(`${q.replace(/[\\%_]/g, '\\$&')}%`)}`),
        // `nhanh_tsv` khớp theo TỪ: mọi token là tiền tố của một từ bất kỳ trong tên, không kể vị
        // trí — đúng ngữ nghĩa mà `<%` đang lo, và đã có chỉ số `poi_name_tsv_idx`.
        ...(tsQueryAnyToken(q)
          ? {
              nhanh_tsv: bacNhanh(
                q,
                `name_tsv @@ to_tsquery('simple', ${lit(tsQueryAnyToken(q) ?? '')})`,
              ),
            }
          : {}),
      },
    });
  }
  return cases;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {string[]} */
  const queries = [];
  let plan = false;
  let repeat = 3;
  /** Ngưỡng `<%` ép cho phiên đo. Mặc định 0,6 = giá trị production ĐANG chạy, xem chú thích dưới. */
  let threshold = 0.6;
  let sweep = false;
  let rank = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--plan') plan = true;
    else if (flag === '--sweep') sweep = true;
    else if (flag === '--rank') rank = true;
    else if (flag === '--q' || flag === '--repeat' || flag === '--threshold') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${flag} thiếu giá trị`);
      if (flag === '--q') queries.push(value);
      else if (flag === '--repeat') {
        repeat = Number(value);
        if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat phải ≥ 1');
      } else {
        threshold = Number(value);
        if (!(threshold > 0 && threshold <= 1)) throw new Error('--threshold phải trong (0, 1]');
      }
      i++;
    }
  }
  return {
    queries: queries.length > 0 ? queries : DEFAULT_QUERIES,
    plan,
    repeat,
    threshold,
    sweep,
    rank,
  };
}

/** Lấy `Execution Time` và `Planning Time` (ms) từ EXPLAIN dạng JSON. */
export function timesOf(/** @type {any} */ plan) {
  const root = Array.isArray(plan) ? plan[0] : plan;
  return {
    exec: Number(root?.['Execution Time'] ?? 0),
    plan: Number(root?.['Planning Time'] ?? 0),
    rows: Number(root?.Plan?.['Actual Rows'] ?? 0),
  };
}

/**
 * Chỗ RỘNG NHẤT của kế hoạch: nút có nhiều dòng thực tế nhất, và tên nút đó.
 *
 * Đây mới là con số trả lời được câu hỏi trung tâm. `LIMIT 20` làm nút gốc luôn trả 20 dòng, nên
 * nhìn nút gốc thì truy vấn nào cũng "nhẹ". Nhưng `sim` nằm trong `ORDER BY`, nên Postgres phải
 * tính 4 hàm trigram cho MỌI dòng qua được `WHERE` rồi mới sắp xếp — chi phí tỷ lệ với chỗ rộng
 * nhất, không phải với 20.
 *
 * @param {any} plan kế hoạch EXPLAIN FORMAT JSON
 * @returns {{ node: string, rows: number }}
 */
export function widestNode(plan) {
  const root = Array.isArray(plan) ? plan[0] : plan;
  let best = { node: '-', rows: 0 };
  /** @param {any} node */
  const walk = (node) => {
    if (!node) return;
    const rows = Number(node['Actual Rows'] ?? 0) * Number(node['Actual Loops'] ?? 1);
    if (rows > best.rows) best = { node: String(node['Node Type'] ?? '?'), rows };
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(root?.Plan);
  return best;
}

/** Bỏ dấu + lowercase để so đích, cùng luật với `perf-autocomplete`. */
const fold = (/** @type {string} */ value) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/**
 * Hạng (1-based) của đích trong danh sách trả về, hoặc 0 nếu không có mặt.
 *
 * Đây là thứ `EXPLAIN` KHÔNG trả lời được. Số dòng và thời gian không nói được kết quả đúng đến
 * từ nhánh nào — mà đó chính là câu hỏi quyết định một cổng xếp tầng có an toàn hay không. Ca
 * `bhx` hỏng đúng vì tôi đoán thay vì đo chỗ này.
 *
 * @param {{ name: string }[]} rows @param {string[]} expects
 */
export function rankOf(rows, expects) {
  if (expects.length === 0) return 0;
  const muon = expects.map(fold);
  const at = rows.findIndex((row) => muon.some((want) => fold(row.name ?? '').includes(want)));
  return at + 1;
}

/** Trung vị — chống nhiễu tốt hơn trung bình khi một lần chạy lẻ bị máy chủ giành CPU. */
export function median(/** @type {number[]} */ values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const {
    queries,
    plan: inPlan,
    repeat,
    threshold,
    sweep,
    rank,
  } = parseArgs(process.argv.slice(2));
  const closeTunnel = await openDatabaseTunnel();
  const url = process.env.PIPELINE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu PIPELINE_DATABASE_URL (hoặc DATABASE_URL)');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    // Nạp pg_trgm TRƯỚC khi đọc GUC: `current_setting(…, true)` trả NULL khi thư viện của extension
    // chưa được nạp vào phiên, và lần chạy 18/09 đã báo `null` đúng vì lý do đó chứ không phải vì
    // migration 0007 chưa áp. Đọc xong giá trị thật rồi mới ÉP ngưỡng của phiên đo.
    await sql`SELECT show_trgm('mapslibvn')`;
    const [tong] = await sql`SELECT count(*)::int AS count FROM poi WHERE status = 'active'`;
    const [migration] = await sql`SELECT max(name) AS name FROM schema_migrations`;
    const [guc] =
      await sql`SELECT current_setting('pg_trgm.word_similarity_threshold', true) AS wst,
      current_setting('jit', true) AS jit, current_database() AS db, version() AS version`;
    console.log(
      `db=${guc?.db} · migration=${migration?.name} · poi active=${Number(tong?.count ?? 0).toLocaleString('vi-VN')}`,
    );
    console.log(
      `word_similarity_threshold của DB=${guc?.wst} · phiên đo ép về ${threshold} · jit=${guc?.jit}`,
    );
    console.log(`${String(guc?.version).split(' ').slice(0, 2).join(' ')} · repeat=${repeat}\n`);
    // Vì sao ép: `/healthz/db` trả 0,6 trong khi `pg_db_role_setting` là 0,5 — Hyperdrive tái dùng
    // kết nối cũ nên production ĐANG chạy 0,6 (DEVLOG 05/09, "Bẫy Hyperdrive"). Đo ở 0,5 rồi kết
    // luận cho production là so hai thứ khác nhau: ngưỡng thấp hơn = khớp nhiều dòng hơn = chậm hơn.
    await sql.unsafe(`SET pg_trgm.word_similarity_threshold = ${threshold}`);

    if (rank) await doRank();
    else await doExplain();

    /** Chế độ NỘI DUNG */
    async function doRank() {
      // Chế độ NỘI DUNG: chạy thật rồi đối chiếu với đích trong fixture, thay vì đo thời gian.
      // Trả lời đúng một câu: bỏ nhánh `%` đi thì ca nào MẤT kết quả đúng?
      const fixture = parseQueryFixture(
        readFileSync('scripts/fixtures/fuzzy-queries.txt', 'utf8'),
      ).filter((entry) => entry.expect.length > 0);
      console.log('q                     | full | no_% | chi_<% | đích');
      console.log('----------------------|------|------|--------|----------------');
      let hongNeuBoPhanTram = 0;
      let boQua = 0;
      for (const entry of fixture) {
        /** @type {{ q: string, sql: Record<string, string> }[]} */
        let cases;
        try {
          cases = buildCases([entry.q]);
        } catch {
          // Truy vấn có nameCore/alias/hành chính khác — câu dựng ở đây sẽ khác câu production.
          boQua++;
          continue;
        }
        const variants = cases[0]?.sql ?? {};
        /** @param {string | undefined} text */
        const hangCua = async (text) => {
          if (!text) return '-';
          const rows = /** @type {{ name: string }[]} */ (await sql.unsafe(text));
          const hang = rankOf(rows, entry.expect);
          return hang === 0 ? '-' : String(hang);
        };
        const [hFull, hNoPercent, hWordsim] = await Promise.all([
          hangCua(variants.full),
          hangCua(variants.no_percent),
          hangCua(variants.chi_wordsim),
        ]);
        // Chỉ đếm ca mà `full` TÌM ĐƯỢC còn `no_%` thì KHÔNG — đó là thiệt hại thật của việc bỏ
        // nhánh `%`. Ca `full` vốn đã trượt thì không tính vào đây.
        const hong = hFull !== '-' && hNoPercent === '-';
        if (hong) hongNeuBoPhanTram++;
        console.log(
          `${entry.q.padEnd(21)} | ${hFull.padStart(4)} | ${hNoPercent.padStart(4)} | ` +
            `${hWordsim.padStart(6)} | ${entry.expect.join(';')}${hong ? '   ← MẤT' : ''}`,
        );
      }
      console.log(
        `\nBỏ nhánh % làm MẤT kết quả ở ${hongNeuBoPhanTram} ca` +
          (boQua ? ` · bỏ qua ${boQua} ca không dựng được câu giống production` : ''),
      );
    }

    /** Chế độ THỜI GIAN */
    async function doExplain() {
      for (const { q, sql: variants } of buildCases(queries)) {
        console.log(`━━━ q=${JSON.stringify(q)} (${q.length} ký tự) ━━━`);
        /** @type {Record<string, number>} */
        const exec = {};
        /** Chạy `repeat` lần, lấy trung vị; in cả dải để thấy nhiễu thay vì giấu nó. */
        const doRun = async (/** @type {string} */ label, /** @type {string} */ text) => {
          /** @type {number[]} */
          const runs = [];
          let widest = { node: '-', rows: 0 };
          let traVe = 0;
          for (let i = 0; i < repeat; i++) {
            const [row] = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`);
            runs.push(timesOf(row?.['QUERY PLAN']).exec);
            if (i === 0) {
              widest = widestNode(row?.['QUERY PLAN']);
              // Số dòng CUỐI CÙNG (đã qua LIMIT). Đây là con số quyết định một cổng xếp tầng có leo
              // bậc hay không — `rộng nhất` chỉ nói chi phí, không nói cổng mở hay đóng. Bài học từ
              // ca `bhx`: cổng đóng vì bậc trước lấp đủ chỗ, và cái đúng không bao giờ được tìm.
              traVe = timesOf(row?.['QUERY PLAN']).rows;
            }
          }
          exec[label] = median(runs);
          console.log(
            `  ${label.padEnd(15)} trung vị=${Math.round(median(runs)).toString().padStart(6)} ms` +
              `  (${Math.round(Math.min(...runs))}–${Math.round(Math.max(...runs))})` +
              `  trả ${String(traVe).padStart(3)} dòng` +
              `  rộng nhất: ${widest.rows.toLocaleString('vi-VN')} dòng @ ${widest.node}`,
          );
        };
        for (const [label, text] of Object.entries(variants)) await doRun(label, text);
        // JIT bật mặc định; với truy vấn ~1,5 s thì thời gian biên dịch không hiển nhiên là nhỏ.
        await sql.unsafe('SET jit = off');
        await doRun('full_jit_off', variants.full ?? '');
        await sql.unsafe('SET jit = on');

        const base = exec.full ?? 0;
        console.log('  — quy chi phí (trung vị, so với full):');
        for (const label of [
          'no_matched_alt',
          'no_distance',
          'no_like',
          'no_percent',
          'chi_wordsim',
          'chi_percent',
          'chi_like',
          'full_jit_off',
        ]) {
          if (exec[label] === undefined) continue;
          const saved = base - exec[label];
          const pctSaved = base > 0 ? Math.round((saved / base) * 100) : 0;
          console.log(
            `      bỏ ${label.padEnd(15)} tiết kiệm ${Math.round(saved)} ms (${pctSaved} %)`,
          );
        }

        if (sweep) {
          /**
           * Hai toán tử, HAI núm khác nhau — vòng đo 18/09 đã quét nhầm một lần:
           * `<%` (word_similarity) dùng `word_similarity_threshold`, còn `%` (similarity) dùng
           * `similarity_threshold`. Nút rộng nhất là nhánh `%`, nên núm đáng quét là núm thứ hai.
           */
          for (const [guc, mucs, mac_dinh] of /** @type {[string, number[], number][]} */ ([
            ['pg_trgm.similarity_threshold', [0.3, 0.35, 0.4, 0.45], 0.3],
            ['pg_trgm.word_similarity_threshold', [0.5, 0.6, 0.7], threshold],
          ])) {
            console.log(`  — quét ${guc} (câu full):`);
            for (const muc of mucs) {
              await sql.unsafe(`SET ${guc} = ${muc}`);
              const [row] = await sql.unsafe(
                `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${variants.full}`,
              );
              const t = timesOf(row?.['QUERY PLAN']);
              const w = widestNode(row?.['QUERY PLAN']);
              console.log(
                `      ngưỡng ${muc}: ${Math.round(t.exec).toString().padStart(6)} ms · rộng nhất ${w.rows.toLocaleString('vi-VN')} dòng`,
              );
            }
            await sql.unsafe(`SET ${guc} = ${mac_dinh}`);
          }
        }

        if (inPlan) {
          // In kế hoạch của `full` VÀ của biến thể chậm nhất. Thời gian tường của route là max() các
          // truy vấn chạy song song, nên nếu `street` hay `area_fuzzy` chậm hơn `poi` thì chính nó
          // mới là thứ cần nhìn — mà điều đó chỉ biết sau khi đo xong.
          const slowest = Object.entries(exec).sort(([, a], [, b]) => b - a)[0]?.[0];
          for (const label of slowest && slowest !== 'full' ? ['full', slowest] : ['full']) {
            const text = label === 'full_jit_off' ? variants.full : variants[label];
            if (!text) continue;
            const rows = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${text}`);
            console.log(`\n  — kế hoạch (${label}):`);
            for (const row of rows) console.log(`    ${row['QUERY PLAN']}`);
          }
        }
        console.log();
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
    closeTunnel();
  }
}
