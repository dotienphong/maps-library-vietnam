import type { CandidateQueryInput, CandidateRow } from './autocomplete-sql';
import type { getSql } from './db';

type Sql = ReturnType<typeof getSql>;

const point = (sql: Sql, near: CandidateQueryInput['near']) =>
  near ? sql`ST_SetSRID(ST_MakePoint(${near.lng},${near.lat}),4326)` : null;

/**
 * Gợi ý vùng hiện hành và vùng lịch sử; grouping diễn ra trong DB trước LIMIT 20.
 * `fuzzy=false` là bậc 1 (chỉ tiền tố), `fuzzy=true` là bậc 2 (thêm `<%`) — xem `areaCandidates`.
 */
function areaQuery(sql: Sql, input: CandidateQueryInput, fuzzy: boolean): Promise<CandidateRow[]> {
  const { queryNorm, queryCore, prefixPattern, near } = input;
  const aliasLevel = input.parsed.ward
    ? 8
    : input.parsed.district
      ? 6
      : input.parsed.province
        ? 4
        : null;
  const currentPrefix = `${queryCore.replace(/[\\%_]/g, '\\$&')}%`;
  const nearPoint = point(sql, near);
  const distance = nearPoint
    ? sql`ST_DistanceSphere(ST_PointOnSurface(candidate_geom),${nearPoint})`
    : sql`NULL::float8`;
  // Bậc 1 bỏ `<%`: trên 36.456 alias toàn quốc, word_similarity bắt mọi alias chứa từ hành chính
  // phổ biến ("quan", "thanh pho"), nên `quan 10` khớp 11.072 dòng thay vì 18 dòng của tiền tố.
  const currentMatch = fuzzy
    ? sql`(${queryCore} <% a.name_norm OR a.name_norm LIKE ${currentPrefix})`
    : sql`a.name_norm LIKE ${currentPrefix}`;
  const aliasMatch = fuzzy
    ? sql`(${queryNorm} <% aa.alias_norm OR aa.alias_norm LIKE ${prefixPattern})`
    : sql`aa.alias_norm LIKE ${prefixPattern}`;

  return sql<CandidateRow[]>`WITH current_hits AS (
      SELECT concat('current:',a.id) dedup_key,1 source_order,a.name,
        CASE WHEN a.level=4 THEN '' ELSE coalesce(parent.name,'') END secondary,
        CASE WHEN a.level=4 THEN 'province' ELSE 'ward' END AS precision,
        greatest(word_similarity(${queryCore},a.name_norm),similarity(a.name_norm,${queryCore})) sim,
        starts_with(a.name_norm,${queryCore}) prefix,a.geom candidate_geom
      FROM admin_area a
      LEFT JOIN admin_area parent ON parent.id=a.parent_id
      WHERE ${currentMatch}
        ${aliasLevel ? sql`AND a.level=${aliasLevel}` : sql``}
    ), alias_edges AS (
      SELECT coalesce('old:'||aa.old_area_id,'alias:'||aa.level||':'||aa.alias_norm) group_key,
        aa.old_area_id,aa.level,aa.alias_norm,current.id current_id,current.name current_name,
        greatest(word_similarity(${queryNorm},aa.alias_norm),similarity(aa.alias_norm,${queryNorm})) sim,
        starts_with(aa.alias_norm,${queryNorm}) prefix
      FROM admin_alias aa
      JOIN admin_area current ON current.id=aa.admin_area_id
      WHERE aa.source IN ('overlay','seed')
        ${aliasLevel ? sql`AND aa.level=${aliasLevel}` : sql``}
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
      SELECT * FROM current_hits
      UNION ALL
      SELECT * FROM alias_hits
    ), deduped AS (
      SELECT *,row_number() OVER (
        PARTITION BY dedup_key ORDER BY source_order,sim DESC,prefix DESC,name
      ) position
      FROM unioned
    )
    SELECT 'area' type,NULL::text id,name,secondary,
      ST_Y(ST_PointOnSurface(candidate_geom)) lat,
      ST_X(ST_PointOnSurface(candidate_geom)) lng,precision,sim,prefix,0 AS pop,
      ${distance} d,
      json_build_array(ST_XMin(candidate_geom),ST_YMin(candidate_geom),
        ST_XMax(candidate_geom),ST_YMax(candidate_geom)) bbox
    FROM deduped
    WHERE position=1 AND candidate_geom IS NOT NULL
    ORDER BY sim DESC,prefix DESC,name,dedup_key
    LIMIT ${20}`;
}

/**
 * Bậc 1 chỉ dùng tiền tố; chỉ khi bậc 1 **không có kết quả nào** mới leo lên bậc 2 có `<%`.
 *
 * Cổng 6.5 đo trên 36.456 alias toàn quốc cho thấy gộp `<%` vào bậc 1 tốn 61–79 ms vì alias_norm
 * chứa sẵn từ hành chính và tên tỉnh, nên word_similarity kém chọn lọc: `quan 10` → 11.072 dòng,
 * `tan thanh` → 6.383 dòng. Bậc 1 tiền tố cho đúng 18 và 10 dòng (0,09 và 0,06 ms).
 *
 * Không leo lên bậc 2 khi bậc 1 *ít* kết quả (chỉ khi rỗng): `quan 10` chỉ có 18 dòng tiền tố
 * nhưng leo lên sẽ trả về 11.072 dòng gần như toàn rác có sim thấp — vừa chậm vừa vô ích.
 * `<%` vẫn cần thiết vì nó là thứ duy nhất cứu lỗi gõ: `quna 10` cho 0 hit tiền tố, 12 hit fuzzy.
 */
export async function areaCandidates(
  sql: Sql,
  input: CandidateQueryInput,
): Promise<CandidateRow[]> {
  const prefixHits = await areaQuery(sql, input, false);
  if (prefixHits.length > 0) return prefixHits;
  return areaQuery(sql, input, true);
}
