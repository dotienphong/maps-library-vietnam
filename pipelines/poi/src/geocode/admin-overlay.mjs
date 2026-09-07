import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminAliasKeys, normalizeVi } from '@mapslibvn/core';
import { FIXTURE, OUT } from '../lib/env.mjs';
import { copyInto, countRows, createNewTable } from '../pg.mjs';
import { bootstrapMissingProvince } from './raw-tables.mjs';

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

/**
 * Cổng độ phủ chấp nhận gap ven biển khi phần KHÔNG được phủ không có dấu hiệu là đất (quyết định
 * PHONG 07/09/2026). Biển không có POI, nên đo mật độ POI ở phần trống và ở phần được phủ của chính
 * vùng đó. Chỉ đo cho vùng thiếu phủ — 4.900 vùng thì quá tốn. `ST_Subdivide` để phần trống của
 * Vân Đồn (1.311 km², nhiều đảo) không thành một polygon khổng lồ làm chỉ số GiST vô dụng.
 *
 * Bảng `poi` rỗng thì **không trả số nào**: mật độ 0 khi chưa có POI sẽ khiến evaluator chấp nhận
 * mọi gap. Thà không đo còn hơn đo sai.
 *
 * @param {import('postgres').Sql<{}>} sql
 * @param {'admin_area'|'admin_area_new'} currentTable
 * @param {{id:string, level:number}[]} gaps
 * @returns {Promise<Map<string, {uncoveredKm2:number, uncoveredPoiDensity:number,
 *   coveredPoiDensity:number}>>}
 */
async function measureGapPoiDensity(sql, currentTable, gaps) {
  /** @type {Map<string, any>} */
  const out = new Map();
  if (gaps.length === 0) return out;
  const [poiRows] = await sql`SELECT count(*)::int AS n FROM poi`;
  if (Number(poiRows?.n ?? 0) === 0) {
    console.warn(
      '⚠ bảng poi rỗng — bỏ phép đo mật độ POI cho vùng thiếu phủ, cổng giữ nguyên failure',
    );
    return out;
  }
  for (const gap of gaps) {
    const [row] = await sql.unsafe(
      `WITH o AS (SELECT id, geom FROM admin_area_old_new WHERE id = $1),
        cov AS (SELECT ST_Union(ST_Intersection(o.geom, n.geom)) g FROM o
          JOIN ${currentTable} n ON n.level = CASE WHEN $2::int = 4 THEN 4 ELSE 8 END
            AND o.geom && n.geom AND ST_Intersects(o.geom, n.geom)),
        part AS (SELECT
            coalesce(cov.g, ST_GeomFromText('POLYGON EMPTY', 4326)) covered,
            ST_Difference(o.geom, coalesce(cov.g, ST_GeomFromText('POLYGON EMPTY', 4326))) uncovered
          FROM o, cov),
        u AS (SELECT ST_Subdivide(uncovered, 128) g FROM part),
        c AS (SELECT ST_Subdivide(covered, 128) g FROM part)
      SELECT
        ST_Area((SELECT uncovered FROM part)::geography) / 1e6 uncovered_km2,
        ST_Area((SELECT covered FROM part)::geography) / 1e6 covered_km2,
        (SELECT count(*)::int FROM u JOIN poi p ON p.geom && u.g AND ST_Intersects(p.geom, u.g)) poi_uncovered,
        (SELECT count(*)::int FROM c JOIN poi p ON p.geom && c.g AND ST_Intersects(p.geom, c.g)) poi_covered`,
      [gap.id, gap.level],
    );
    if (!row) continue;
    const uncoveredKm2 = Number(row.uncovered_km2 ?? 0);
    const coveredKm2 = Number(row.covered_km2 ?? 0);
    if (!(uncoveredKm2 > 0)) continue;
    out.set(String(gap.id), {
      uncoveredKm2: Number(uncoveredKm2.toFixed(4)),
      uncoveredPoiDensity: Number((Number(row.poi_uncovered) / uncoveredKm2).toFixed(4)),
      coveredPoiDensity:
        coveredKm2 > 0 ? Number((Number(row.poi_covered) / coveredKm2).toFixed(4)) : 0,
    });
  }
  return out;
}

/**
 * @param {Sql} sql
 * @param {{currentTable:'admin_area'|'admin_area_new',fixture?:boolean,
 *   sourceStats?:{invalidGeometries?:{repaired?:number,discarded?:number}},
 *   acceptQaReason?:string}} options
 *   `acceptQaReason` — publish **dù cổng QA đỏ**, chỉ dùng khi có quyết định của người chịu trách
 *   nhiệm. Lý do được ghi vào `report.acceptedQa` để lần sau còn truy được ai chấp nhận cái gì;
 *   không truyền thì cổng ném như cũ.
 */
export async function buildOldAdmin(
  sql,
  { currentTable, fixture = FIXTURE, sourceStats = {}, acceptQaReason },
) {
  if (!CURRENT_TABLES.has(currentTable))
    throw new Error(`currentTable không hợp lệ: ${currentTable}`);
  // Cùng lý do như nhánh current: snapshot 01/2025 chỉ có 62/63 tỉnh cũ, thiếu Khánh Hòa, nên 8
  // quận/huyện của tỉnh đó bị loại vì không nằm trong L4 nào.
  const bootstrap = await bootstrapMissingProvince(sql, { rawTable: 'osm_admin_old_raw' });
  console.log(
    bootstrap.applied
      ? `✓ dựng L4 cũ ${bootstrap.province} từ ${bootstrap.children} đơn vị con mồ côi`
      : `· không dựng L4 cũ bù: ${bootstrap.reason}`,
  );
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
    // `adminAliasKeys` trả khoá đầy đủ nhất ở vị trí 0 (phường+quận+tỉnh), rồi ngắn dần.
    const keys = adminAliasKeys(input);
    for (const [keyIndex, key] of keys.entries())
      for (const target of selected)
        provisional.push({
          key,
          primary: keyIndex === 0,
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
  // Khoá NGẮN nhập nhằng phải bị bỏ (quyết định #3: "chỉ giữ khóa không tỉnh khi duy nhất ở đúng
  // cấp") — "Phường Trùng" trần không được tự chọn một trong hai tỉnh. Nhưng khoá **đầy đủ nhất**
  // thì không được bỏ: khi hai vùng cũ chỉ khác nhau ở dấu thì `name_norm` trùng khít kể cả ở khoá
  // đầy đủ, bỏ nó là cả hai vùng mất sạch đường tra (production 07/09: 8 vùng đất liền, trong đó
  // Lộc Thạnh→846 và Lộc Thành→848 là hai đích khác nhau nằm vừa PK). PK ba cột
  // (alias_norm, level, admin_area_id) tự lo trường hợp trùng đích, nên phải dedupe trước COPY;
  // chọn `old_area_id` nhỏ nhất để kết quả xác định được, không phụ thuộc thứ tự dòng của DB.
  const ordered = [...provisional].sort((a, b) => (BigInt(a.oldId) < BigInt(b.oldId) ? -1 : 1));
  /** @type {Set<string>} */
  const seenPk = new Set();
  const aliases = [];
  /** @type {Map<string, number>} */
  const keptByGroup = new Map();
  for (const row of ordered) {
    const group = `${row.level}:${row.key}`;
    if (!row.primary && keyOwners.get(group)?.size !== 1) continue;
    const pk = `${row.key}\u0000${row.level}\u0000${row.target}`;
    if (seenPk.has(pk)) continue;
    seenPk.add(pk);
    aliases.push(row);
    keptByGroup.set(group, (keptByGroup.get(group) ?? 0) + 1);
  }
  // Khoá đầy đủ nhập nhằng được giữ là đánh đổi phải công bố: `rowsKept` nhỏ hơn số chủ nghĩa là
  // PK ba cột đã ăn mất provenance của vùng cũ còn lại (trùng đích).
  const ambiguousPrimaryKept = [...keyOwners]
    .filter(([group, owners]) => owners.size > 1 && keptByGroup.has(group))
    .map(([group, owners]) => ({
      key: group,
      owners: [...owners].sort(),
      rowsKept: keptByGroup.get(group) ?? 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  await copyInto(
    sql,
    'admin_alias_new',
    ['alias_norm', 'level', 'admin_area_id', 'valid_until', 'share', 'source', 'old_area_id'],
    aliases.map((r) => [r.key, r.level, r.target, '2025-06-30', r.share, 'overlay', r.oldId]),
  );
  // Tag hiện hành là alias bổ sung, không mặc định là tên đã hết hiệu lực.
  // `osm_admin_raw` chỉ tồn tại sau khi nhánh ingest OSM hiện hành chạy (`replaceRawTables`).
  // Chạy `admin-old.mjs` độc lập trên DB chỉ có bảng đã publish thì không có bảng này — bỏ nguồn
  // osm_tag và ghi vào report, không để nổ 42P01 (cổng 6.5 gặp đúng lỗi này trên DB production)
  // và cũng không bỏ lặng lẽ.
  const [rawTable] = await sql`SELECT to_regclass('osm_admin_raw') AS present`;
  const osmTagSource =
    rawTable?.present == null
      ? {
          available: false,
          reason:
            'bảng osm_admin_raw không tồn tại — chạy nhánh ingest OSM hiện hành trước nếu cần alias source=osm_tag',
        }
      : { available: true };
  if (!osmTagSource.available) console.warn(`⚠ bỏ nguồn osm_tag: ${osmTagSource.reason}`);
  const tagRows = osmTagSource.available
    ? await sql.unsafe(`SELECT a.id,r.level,r.tags FROM ${currentTable} a
        JOIN osm_admin_raw r ON r.osm_relation_id=a.osm_relation_id`)
    : [];
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
  // Số đo cho quyết định A: chỉ vùng thiếu phủ, gắn ngay vào dòng coverage để evaluator dùng.
  const gapRows = coverage.filter((row) => row.rawCoverage < 0.95);
  const density = await measureGapPoiDensity(sql, currentTable, gapRows);
  for (const row of gapRows) Object.assign(row, density.get(String(row.id)) ?? {});

  const unmatched = coverage.filter((row) => row.targets === 0);
  const coverageGaps = coverage.filter((row) => row.rawCoverage < 0.95);
  const overlapErrors = coverage.filter((row) => row.rawCoverage > 1.01);
  /** @type {Record<string, any>} */
  const report = {
    generatedAt: new Date().toISOString(),
    oldCount: await countRows(sql, 'admin_area_old_new'),
    aliasCount: await countRows(sql, 'admin_alias_new'),
    countsByLevel: Object.fromEntries(levelCounts.map((row) => [`L${row.level}`, row.count])),
    countsBySource: Object.fromEntries(sourceCounts.map((row) => [row.source, row.count])),
    osmTagSource,
    coverage,
    unmatched,
    coverageGaps,
    overlapErrors,
    splits: coverage.filter((row) => row.targets > 1 && row.rawMax < 0.9),
    seedMisses,
    ambiguousPrimaryKept,
    ambiguousKeys: [
      ...[...keyOwners].filter(([, owners]) => owners.size > 1).map(([key]) => key),
      ...ambiguousTagKeys,
    ],
    invalidGeometries,
  };
  mkdirSync(resolve(OUT, 'admin-alias'), { recursive: true });
  writeFileSync(resolve(OUT, 'admin-alias/report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await sql.unsafe('DROP TABLE admin_overlap_work');
  const qaRed =
    !fixture &&
    (invalidGeometries.discarded > 0 ||
      invalidGeometries.remaining > 0 ||
      unmatched.length > 0 ||
      overlapErrors.length > 0 ||
      seedMisses.length > 0);
  if (qaRed) {
    const message = `QA alias hành chính đỏ: invalid=${invalidGeometries.discarded + invalidGeometries.remaining}, unmatched=${unmatched.length}, overlap=${overlapErrors.length}, seed_miss=${seedMisses.length}`;
    if (!acceptQaReason) throw new Error(message);
    report.acceptedQa = { reason: acceptQaReason, failure: message, at: new Date().toISOString() };
    writeFileSync(resolve(OUT, 'admin-alias/report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.warn(`⚠ publish dù cổng QA đỏ — lý do: ${acceptQaReason}\n  ${message}`);
  }
  return report;
}
