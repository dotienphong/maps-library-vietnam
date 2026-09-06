// Sinh SQL EXPLAIN cho cổng 6.5, bám đúng apps/api/src/area-candidates.ts.
// Dùng PREPARE/EXECUTE để giữ bind parameter giống postgres.js, không inline literal.
// Đường dẫn tương đối vì file này nằm ngoài workspace package; cần `pnpm --filter @mapslibvn/core build` trước.
import { nameCore, normalizeVi, parseAddress } from '../../../packages/core/dist/index.js';

const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;

function paramsFor(query) {
  const queryNorm = normalizeVi(query);
  const queryCore = nameCore(query) || queryNorm;
  const prefixPattern = `${queryNorm.replace(/[\\%_]/g, '\\$&')}%`;
  const currentPrefix = `${queryCore.replace(/[\\%_]/g, '\\$&')}%`;
  const parsed = parseAddress(query);
  const aliasLevel = parsed.ward ? 8 : parsed.district ? 6 : parsed.province ? 4 : null;
  return { query, queryNorm, queryCore, prefixPattern, currentPrefix, aliasLevel };
}

// $1 queryCore, $2 queryNorm, $3 currentPrefix, $4 prefixPattern, $5 aliasLevel
const currentMatch = () =>
  fuzzy ? '($1 <% a.name_norm OR a.name_norm LIKE $3)' : 'a.name_norm LIKE $3';
const aliasMatch = () =>
  fuzzy ? '($2 <% aa.alias_norm OR aa.alias_norm LIKE $4)' : 'aa.alias_norm LIKE $4';

const currentHits = (aliasLevel) => `SELECT concat('current:',a.id) dedup_key,1 source_order,a.name,
        CASE WHEN a.level=4 THEN '' ELSE coalesce(parent.name,'') END secondary,
        CASE WHEN a.level=4 THEN 'province' ELSE 'ward' END AS precision,
        greatest(word_similarity($1,a.name_norm),similarity(a.name_norm,$1)) sim,
        starts_with(a.name_norm,$1) prefix,a.geom candidate_geom
      FROM admin_area a
      LEFT JOIN admin_area parent ON parent.id=a.parent_id
      WHERE ${currentMatch()}
        ${aliasLevel ? 'AND a.level=$5' : ''}`;

const aliasEdges = (
  aliasLevel,
) => `SELECT coalesce('old:'||aa.old_area_id,'alias:'||aa.level||':'||aa.alias_norm) group_key,
        aa.old_area_id,aa.level,aa.alias_norm,current.id current_id,current.name current_name,
        greatest(word_similarity($2,aa.alias_norm),similarity(aa.alias_norm,$2)) sim,
        starts_with(aa.alias_norm,$2) prefix
      FROM admin_alias aa
      JOIN admin_area current ON current.id=aa.admin_area_id
      WHERE aa.source IN ('overlay','seed')
        ${aliasLevel ? 'AND aa.level=$5' : ''}
        AND ${aliasMatch()}`;

const aliasGrouped = `SELECT group_key,old_area_id,level,min(alias_norm) alias_norm,
        min(current_id) representative_id,
        array_agg(DISTINCT current_name ORDER BY current_name) target_names,
        count(DISTINCT current_id)::int target_count,max(sim) sim,bool_or(prefix) prefix
      FROM alias_edges
      GROUP BY group_key,old_area_id,level`;

const fullQuery = (aliasLevel) => `WITH current_hits AS (
      ${currentHits(aliasLevel)}
    ), alias_edges AS (
      ${aliasEdges(aliasLevel)}
    ), alias_grouped AS (
      ${aliasGrouped}
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
      NULL::float8 d,
      json_build_array(ST_XMin(candidate_geom),ST_YMin(candidate_geom),
        ST_XMax(candidate_geom),ST_YMax(candidate_geom)) bbox
    FROM deduped
    WHERE position=1 AND candidate_geom IS NOT NULL
    ORDER BY sim DESC,prefix DESC,name,dedup_key
    LIMIT 20`;

const branches = (aliasLevel) => ({
  full: fullQuery(aliasLevel),
  current: currentHits(aliasLevel),
  alias: aliasEdges(aliasLevel),
  grouping: `WITH alias_edges AS (${aliasEdges(aliasLevel)}) ${aliasGrouped}`,
});

// --tier1: chỉ tiền tố (bậc 1 sau bản sửa selectivity). Không có cờ: bậc 2, có `<%`.
const fuzzy = !process.argv.includes('--tier1');
const lines = [];
lines.push('\\pset pager off');
lines.push('\\timing off');
const rawQueries = process.argv.slice(2).filter((value) => value !== '--tier1');
for (const [index, rawQuery] of rawQueries.entries()) {
  const p = paramsFor(rawQuery);
  const signature = p.aliasLevel ? '(text,text,text,text,int)' : '(text,text,text,text)';
  const args = [p.queryCore, p.queryNorm, p.currentPrefix, p.prefixPattern];
  if (p.aliasLevel) args.push(String(p.aliasLevel));
  const argList = args
    .map((value, position) => (p.aliasLevel && position === 4 ? value : lit(value)))
    .join(',');
  for (const [branch, sql] of Object.entries(branches(p.aliasLevel))) {
    const name = `q${index}_${branch}`;
    lines.push(
      `\\echo '===== QUERY ${JSON.stringify(rawQuery)} | BRANCH ${branch} | tier=${fuzzy ? 2 : 1} | queryNorm=${p.queryNorm} queryCore=${p.queryCore} aliasLevel=${p.aliasLevel ?? 'null'} ====='`,
    );
    lines.push(`PREPARE ${name}${signature} AS ${sql};`);
    // Chạy trước một lần cho ấm cache rồi mới đo, để số liệu không lẫn chi phí đọc đĩa lần đầu.
    lines.push(`EXPLAIN (ANALYZE, BUFFERS) EXECUTE ${name}(${argList});`);
    lines.push(`\\echo '----- lần đo thứ hai (cache ấm) -----'`);
    lines.push(`EXPLAIN (ANALYZE, BUFFERS) EXECUTE ${name}(${argList});`);
    lines.push(`DEALLOCATE ${name};`);
    lines.push('');
  }
}
console.log(lines.join('\n'));
