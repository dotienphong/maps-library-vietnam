import type { CandidateQueryInput, CandidateRow } from './autocomplete-sql';
import type { getSql } from './db';

type Sql = ReturnType<typeof getSql>;

const point = (sql: Sql, near: CandidateQueryInput['near']) =>
  near ? sql`ST_SetSRID(ST_MakePoint(${near.lng},${near.lat}),4326)` : null;

/** Gợi ý vùng hiện hành và vùng lịch sử; grouping diễn ra trong DB trước LIMIT 20. */
export function areaCandidates(sql: Sql, input: CandidateQueryInput): Promise<CandidateRow[]> {
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

  return sql<CandidateRow[]>`WITH current_hits AS (
      SELECT concat('current:',a.id) dedup_key,1 source_order,a.name,
        CASE WHEN a.level=4 THEN '' ELSE coalesce(parent.name,'') END secondary,
        CASE WHEN a.level=4 THEN 'province' ELSE 'ward' END AS precision,
        greatest(word_similarity(${queryCore},a.name_norm),similarity(a.name_norm,${queryCore})) sim,
        starts_with(a.name_norm,${queryCore}) prefix,a.geom candidate_geom
      FROM admin_area a
      LEFT JOIN admin_area parent ON parent.id=a.parent_id
      WHERE (${queryCore} <% a.name_norm OR a.name_norm LIKE ${currentPrefix})
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
        AND (${queryNorm} <% aa.alias_norm OR aa.alias_norm LIKE ${prefixPattern})
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
