import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminAliasKeys, normalizeVi } from '@mapslibvn/core';
import { FIXTURE, OUT } from '../lib/env.mjs';
import { copyInto, countRows, createNewTable } from '../pg.mjs';

/** @typedef {import('postgres').Sql} Sql */
/** @typedef {{raw_share:number|string,admin_area_id?:number|string,[key:string]:unknown}} Overlap */

const CURRENT_TABLES = new Set(['admin_area', 'admin_area_new']);
/** @param {string} name */
const stripPrefix = (name) =>
  normalizeVi(name).replace(/^(?:tinh|thanh pho|quan|huyen|thi xa|phuong|xa|thi tran)\s+/, '');

/** @param {Overlap[]} overlaps @param {number} level */
export function selectOverlaps(overlaps, level) {
  return overlapMetrics(overlaps, level).selected;
}

/** @param {Overlap[]} overlaps @param {number} level */
export function overlapMetrics(overlaps, level) {
  const rawCoverage = overlaps.reduce((total, row) => total + Number(row.raw_share), 0);
  const kept = overlaps.filter((row) => Number(row.raw_share) >= (level === 8 ? 0.05 : 0.000001));
  const keptCoverage = kept.reduce((total, row) => total + Number(row.raw_share), 0);
  return {
    rawCoverage,
    keptCoverage,
    discardedShare: rawCoverage - keptCoverage,
    rawMax: overlaps.reduce((max, row) => Math.max(max, Number(row.raw_share)), 0),
    selected: keptCoverage
      ? kept.map((row) => ({ ...row, share: Number(row.raw_share) / keptCoverage }))
      : [],
  };
}

const seedRows = () =>
  readFileSync(resolve('db/seed/admin_alias_2025.csv'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [
        alias = '',
        level = '',
        currentName = '',
        province = '',
        share = '',
        sourceUrl = '',
        sourceClause = '',
      ] = line.split(',').map((v) => v.trim());
      return {
        alias,
        level: Number(level),
        currentName,
        province,
        share: share ? Number(share) : null,
        sourceUrl,
        sourceClause,
      };
    });

/** @param {Sql} sql @param {{currentTable:'admin_area'|'admin_area_new',fixture?:boolean,sourceStats?:{invalidGeometries?:{repaired?:number,discarded?:number}}}} options */
export async function buildOldAdmin(sql, { currentTable, fixture = FIXTURE, sourceStats = {} }) {
  if (!CURRENT_TABLES.has(currentTable))
    throw new Error(`currentTable không hợp lệ: ${currentTable}`);
  await createNewTable(sql, 'admin_area_old');
  await createNewTable(sql, 'admin_alias');
  await sql.unsafe(`INSERT INTO admin_area_old_new
    (id,level,name,name_norm,parent_norm,province_norm,osm_relation_id,snapshot,valid_until,geom)
    SELECT r.osm_relation_id,r.level,r.name,r.name_norm,
      CASE WHEN r.level=8 THEN (SELECT p.name_norm FROM osm_admin_old_raw p WHERE p.level=6
        AND p.geom&&r.geom AND ST_Covers(p.geom,ST_PointOnSurface(r.geom)) ORDER BY ST_Area(p.geom) LIMIT 1) END,
      CASE WHEN r.level=4 THEN r.name_norm ELSE (SELECT p.name_norm FROM osm_admin_old_raw p WHERE p.level=4
        AND p.geom&&r.geom AND ST_Covers(p.geom,ST_PointOnSurface(r.geom)) ORDER BY ST_Area(p.geom) LIMIT 1) END,
      r.osm_relation_id,r.snapshot,'2025-06-30',r.geom FROM osm_admin_old_raw r
    WHERE r.level IN (4,6,8) AND (r.level=4 OR EXISTS (SELECT 1 FROM osm_admin_old_raw p
      WHERE p.level=4 AND p.geom&&r.geom AND ST_Covers(p.geom,ST_PointOnSurface(r.geom))))`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS admin_area_old_new_geom_work_idx ON admin_area_old_new USING gist(geom);
    ANALYZE admin_area_old_new; DROP TABLE IF EXISTS admin_overlap_work;
    CREATE TABLE admin_overlap_work AS SELECT o.id old_area_id,o.level,n.id admin_area_id,
      ST_Area(ST_Intersection(o.geom,n.geom)::geography)/NULLIF(ST_Area(o.geom::geography),0) raw_share
    FROM admin_area_old_new o JOIN ${currentTable} n
      ON n.level=CASE WHEN o.level=4 THEN 4 ELSE 8 END AND o.geom&&n.geom AND ST_Intersects(o.geom,n.geom)
    WHERE NOT ST_IsEmpty(ST_Intersection(o.geom,n.geom));
    CREATE INDEX admin_overlap_work_old_idx ON admin_overlap_work(old_area_id)`);
  const oldRows = /** @type {any[]} */ (
    await sql.unsafe(`SELECT o.*,
    (SELECT p.name FROM admin_area_old_new p WHERE p.level=6 AND p.name_norm=o.parent_norm
      AND p.province_norm=o.province_norm ORDER BY p.id LIMIT 1) parent_name,
    (SELECT p.name FROM admin_area_old_new p WHERE p.level=4 AND p.name_norm=o.province_norm
      ORDER BY p.id LIMIT 1) province_name FROM admin_area_old_new o ORDER BY o.level,o.id`)
  );
  const overlapRows = /** @type {any[]} */ (
    await sql`SELECT * FROM admin_overlap_work ORDER BY old_area_id,raw_share DESC`
  );
  /** @type {Map<string, any[]>} */
  const byOld = new Map();
  for (const row of overlapRows) {
    const key = String(row.old_area_id);
    byOld.set(key, [...(byOld.get(key) ?? []), row]);
  }
  /** @type {any[]} */
  const provisional = [];
  /** @type {any[]} */
  const coverage = [];
  for (const old of oldRows) {
    const raw = byOld.get(String(old.id)) ?? [];
    const metrics = overlapMetrics(raw, Number(old.level));
    const selected = metrics.selected;
    coverage.push({
      id: String(old.id),
      level: Number(old.level),
      rawCoverage: metrics.rawCoverage,
      keptCoverage: metrics.keptCoverage,
      discardedShare: metrics.discardedShare,
      rawMax: metrics.rawMax,
      targets: selected.length,
    });
    const input =
      old.level === 8
        ? {
            ward: old.name_norm,
            district: old.parent_norm,
            province: old.province_norm,
            adminOriginal: {
              ward: old.name,
              district: old.parent_name,
              province: old.province_name,
            },
          }
        : old.level === 6
          ? {
              district: old.name_norm,
              province: old.province_norm,
              adminOriginal: { district: old.name, province: old.province_name },
            }
          : { province: old.name_norm, adminOriginal: { province: old.name } };
    for (const key of adminAliasKeys(input))
      for (const target of selected)
        provisional.push({
          key,
          level: Number(old.level),
          target: target.admin_area_id,
          share: target.share,
          oldId: old.id,
        });
  }
  /** @type {Map<string, Set<string>>} */
  const keyOwners = new Map();
  for (const row of provisional) {
    const group = `${row.level}:${row.key}`;
    if (!keyOwners.has(group)) keyOwners.set(group, new Set());
    keyOwners.get(group)?.add(String(row.oldId));
  }
  const aliases = provisional.filter((row) => keyOwners.get(`${row.level}:${row.key}`)?.size === 1);
  await copyInto(
    sql,
    'admin_alias_new',
    ['alias_norm', 'level', 'admin_area_id', 'valid_until', 'share', 'source', 'old_area_id'],
    aliases.map((r) => [r.key, r.level, r.target, '2025-06-30', r.share, 'overlay', r.oldId]),
  );
  // Tag hiện hành là alias bổ sung, không mặc định là tên đã hết hiệu lực.
  const tagRows = await sql.unsafe(`SELECT a.id,r.level,r.tags FROM ${currentTable} a
    JOIN osm_admin_raw r ON r.osm_relation_id=a.osm_relation_id`);
  /** @type {Map<string,Set<string>>} */
  const tagCandidates = new Map();
  for (const row of tagRows)
    for (const field of ['old_name', 'alt_name', 'official_name'])
      for (const value of String(row.tags?.[field] ?? '')
        .split(';')
        .filter(Boolean)) {
        const key = stripPrefix(value);
        if (!key) continue;
        const group = `${row.level}:${key}`;
        if (!tagCandidates.has(group)) tagCandidates.set(group, new Set());
        tagCandidates.get(group)?.add(String(row.id));
      }
  const ambiguousTagKeys = [];
  for (const [group, targets] of tagCandidates) {
    if (targets.size !== 1) {
      ambiguousTagKeys.push(group);
      continue;
    }
    const separator = group.indexOf(':');
    const level = Number(group.slice(0, separator));
    const key = group.slice(separator + 1);
    const [adminAreaId] = targets;
    await sql`INSERT INTO admin_alias_new(alias_norm,level,admin_area_id,share,source)
      VALUES (${key},${level},${adminAreaId},1,'osm_tag') ON CONFLICT DO NOTHING`;
  }
  /** @type {any[]} */
  const seedMisses = [];
  /** @type {Map<string, any[]>} */
  const seedGroups = new Map();
  for (const seed of seedRows()) {
    const key = `${seed.level}:${normalizeVi(seed.alias)}`;
    seedGroups.set(key, [...(seedGroups.get(key) ?? []), seed]);
  }
  for (const [group, seeds] of seedGroups) {
    /** @type {{seed:any,target:any}[]} */
    const resolved = [];
    for (const seed of seeds) {
      const name = stripPrefix(seed.currentName);
      const province = seed.province ? stripPrefix(seed.province) : null;
      const targets = await sql.unsafe(
        `SELECT a.id FROM ${currentTable} a
        LEFT JOIN ${currentTable} p ON p.id=a.parent_id LEFT JOIN ${currentTable} gp ON gp.id=p.parent_id
        WHERE a.level=$1 AND a.name_norm=$2 AND ($3::text IS NULL OR COALESCE(
          CASE WHEN p.level=4 THEN p.name_norm END,CASE WHEN gp.level=4 THEN gp.name_norm END,
          CASE WHEN a.level=4 THEN a.name_norm END)=$3)
        ORDER BY a.id`,
        [seed.level, name, province],
      );
      if (targets.length !== 1) {
        seedMisses.push({ ...seed, matches: targets.length });
        continue;
      }
      resolved.push({ seed, target: targets[0] });
    }
    // Một dòng sai không được xóa tập cạnh overlay/tag đang hợp lệ của cả nhóm.
    if (resolved.length !== seeds.length) continue;
    const aliasNorm = group.slice(group.indexOf(':') + 1);
    const level = Number(group.slice(0, group.indexOf(':')));
    const explicitShares = resolved.filter((row) => row.seed.share !== null);
    if (
      explicitShares.length > 0 &&
      (explicitShares.length !== resolved.length ||
        explicitShares.some((row) => !(row.seed.share > 0)))
    ) {
      seedMisses.push({ group, reason: 'share phải có ở mọi dòng trong nhóm và lớn hơn 0' });
      continue;
    }
    /** @type {Map<string,{target:any,rawShare:number}>} */
    const uniqueTargets = new Map();
    for (const row of resolved) {
      const id = String(row.target.id);
      const previous = uniqueTargets.get(id);
      uniqueTargets.set(id, {
        target: row.target,
        rawShare: (previous?.rawShare ?? 0) + (row.seed.share ?? 0),
      });
    }
    const edges = [...uniqueTargets.values()];
    const explicitTotal = edges.reduce((sum, edge) => sum + edge.rawShare, 0);
    const shares = edges.map((edge) =>
      explicitTotal > 0 ? edge.rawShare / explicitTotal : 1 / edges.length,
    );
    const owners = keyOwners.get(group);
    const oldAreaId = owners?.size === 1 ? [...owners][0] : null;
    await sql`DELETE FROM admin_alias_new WHERE alias_norm=${aliasNorm} AND level=${level}`;
    for (const [index, edge] of edges.entries())
      await sql`INSERT INTO admin_alias_new
        (alias_norm,level,admin_area_id,valid_until,share,source,old_area_id)
        VALUES (${aliasNorm},${level},${edge.target.id},'2025-06-30',${shares[index]},'seed',${oldAreaId})`;
  }
  const levelCounts =
    await sql`SELECT level,count(*)::int count FROM admin_area_old_new GROUP BY 1 ORDER BY 1`;
  const sourceCounts =
    await sql`SELECT source,count(*)::int count FROM admin_alias_new GROUP BY 1 ORDER BY 1`;
  const invalidRows = await sql`SELECT count(*)::int AS "invalidGeometries"
    FROM osm_admin_old_raw WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom) OR ST_Area(geom)=0`;
  const invalidGeometries = {
    repaired: Number(sourceStats.invalidGeometries?.repaired ?? 0),
    discarded: Number(sourceStats.invalidGeometries?.discarded ?? 0),
    remaining: Number(invalidRows[0]?.invalidGeometries ?? 0),
  };
  const unmatched = coverage.filter((row) => row.targets === 0);
  const coverageGaps = coverage.filter((row) => row.rawCoverage < 0.95);
  const overlapErrors = coverage.filter((row) => row.rawCoverage > 1.01);
  const report = {
    generatedAt: new Date().toISOString(),
    oldCount: await countRows(sql, 'admin_area_old_new'),
    aliasCount: await countRows(sql, 'admin_alias_new'),
    countsByLevel: Object.fromEntries(levelCounts.map((row) => [`L${row.level}`, row.count])),
    countsBySource: Object.fromEntries(sourceCounts.map((row) => [row.source, row.count])),
    coverage,
    unmatched,
    coverageGaps,
    overlapErrors,
    splits: coverage.filter((row) => row.targets > 1 && row.rawMax < 0.9),
    seedMisses,
    ambiguousKeys: [
      ...[...keyOwners].filter(([, owners]) => owners.size > 1).map(([key]) => key),
      ...ambiguousTagKeys,
    ],
    invalidGeometries,
  };
  mkdirSync(resolve(OUT, 'admin-alias'), { recursive: true });
  writeFileSync(resolve(OUT, 'admin-alias/report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await sql.unsafe('DROP TABLE admin_overlap_work');
  if (
    !fixture &&
    (invalidGeometries.discarded > 0 ||
      invalidGeometries.remaining > 0 ||
      unmatched.length > 0 ||
      overlapErrors.length > 0 ||
      seedMisses.length > 0)
  ) {
    throw new Error(
      `QA alias hành chính đỏ: invalid=${invalidGeometries.discarded + invalidGeometries.remaining}, unmatched=${unmatched.length}, overlap=${overlapErrors.length}, seed_miss=${seedMisses.length}`,
    );
  }
  return report;
}
