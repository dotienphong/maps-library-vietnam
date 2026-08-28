#!/usr/bin/env node
// Bước 2 gộp (spec 5.4): poi_work_record → poi_work_pair (PostGIS) → 2 lượt ghép tham lam → poi_work_cluster + poi_work_cluster_meta.
import { createClusterer, pairAllowed } from './lib/greedy.mjs';
import { stableId } from './lib/stable-id.mjs';
import { connect, copyInto, countRows } from './pg.mjs';
import { pickPrimary, popularity, qualityScore } from './score.mjs';

const SOURCES = ['osm', 'overture', 'fsq'];
const sql = connect();
try {
  await sql.unsafe('DROP TABLE IF EXISTS poi_work_pair, poi_work_cluster, poi_work_cluster_meta');
  console.log('Tạo poi_work_pair …');
  await sql.unsafe(`CREATE TABLE poi_work_pair AS
    SELECT a.rid AS a, b.rid AS b, a.source AS sa, b.source AS sb, a.group_code AS ga, b.group_code AS gb,
           ST_Distance(a.geom::geography, b.geom::geography) AS dist_m, similarity(a.name_core, b.name_core) AS sim,
           a.phones AS pa, b.phones AS pb, a.domains AS da, b.domains AS db,
           a.housenumber AS ha, b.housenumber AS hb, a.street_norm AS sta, b.street_norm AS stb
    FROM poi_work_record a JOIN poi_work_record b
      ON a.rid < b.rid AND ST_DWithin(a.geom, b.geom, 0.0015)
     AND (a.group_code = b.group_code OR a.group_code = 'other' OR b.group_code = 'other')
    WHERE ST_Distance(a.geom::geography, b.geom::geography) <= 150 AND similarity(a.name_core, b.name_core) >= 0.4`);
  await sql.unsafe(
    'ALTER TABLE poi_work_pair ADD COLUMN score real; UPDATE poi_work_pair SET score = 0.6 * sim + 0.4 * (1 - LEAST(dist_m, 75) / 75)',
  );
  console.log(`  ${await countRows(sql, 'poi_work_pair')} cặp`);

  const maxRow = /** @type {any} */ (
    (await sql`SELECT max(rid)::int AS max FROM poi_work_record`)[0]
  );
  const maxRid = Number(maxRow?.max ?? 0);
  const src = new Uint8Array(maxRid + 1);
  const completeness = new Float32Array(maxRid + 1);
  const conf = new Float32Array(maxRid + 1);
  const flags = new Uint8Array(maxRid + 1);
  const months = new Uint16Array(maxRid + 1);
  const sourceIds = /** @type {string[]} */ (new Array(maxRid + 1));
  for await (const rows of sql`SELECT rid, source, source_id, completeness, confidence, has_phone, has_website, has_hours, has_housenumber, closed,
      GREATEST(0, (EXTRACT(YEAR FROM age(now(), updated_at)) * 12 + EXTRACT(MONTH FROM age(now(), updated_at))))::int AS months FROM poi_work_record`.cursor(
    5000,
  )) {
    for (const raw of rows) {
      const r = /** @type {any} */ (raw);
      src[r.rid] = SOURCES.indexOf(r.source) + 1;
      completeness[r.rid] = r.completeness;
      conf[r.rid] = r.confidence;
      flags[r.rid] =
        Number(r.has_phone) |
        (Number(r.has_website) << 1) |
        (Number(r.has_hours) << 2) |
        (Number(r.has_housenumber) << 3) |
        (Number(r.closed) << 4);
      months[r.rid] = Math.min(65535, r.months);
      sourceIds[r.rid] = r.source_id;
    }
  }
  const sourceOf = (/** @type {number} */ rid) => SOURCES[(src[rid] ?? 0) - 1] ?? 'other';

  const dup = createClusterer(maxRid, { sourceOf, onePerSource: false, maxSize: 10 });
  // Điểm bằng nhau phải có thứ tự toàn phần: ghép tham lam đổi cụm theo thứ tự cặp.
  for await (const rows of sql`SELECT * FROM poi_work_pair WHERE sa = sb ORDER BY score DESC, a, b`.cursor(
    5000,
  ))
    for (const raw of rows) {
      const p = /** @type {any} */ (raw);
      if (pairAllowed(p)) dup.consider(p.a, p.b);
    }
  const dupRes = dup.result();
  const repOf = new Int32Array(maxRid + 1);
  for (const m of dupRes.members.values()) {
    const primary = pickPrimary(
      m.map((rid) => ({ rid, source: sourceOf(rid), completeness: completeness[rid] ?? 0 })),
    );
    if (!primary) continue;
    const rep = primary.rid;
    for (const rid of m) if (rid !== rep) repOf[rid] = rep;
  }

  const cross = createClusterer(maxRid, { sourceOf, onePerSource: true, maxSize: 3 });
  for await (const rows of sql`SELECT * FROM poi_work_pair WHERE sa <> sb ORDER BY score DESC, a, b`.cursor(
    5000,
  )) {
    for (const raw of rows) {
      const p = /** @type {any} */ (raw);
      if (!repOf[p.a] && !repOf[p.b] && pairAllowed(p)) cross.consider(p.a, p.b);
    }
  }
  const { members } = cross.result();

  /** @type {Map<number, number[]>} */
  const finalMembers = new Map();
  const finalOf = new Int32Array(maxRid + 1);
  let nextId = 1;
  for (const m of members.values()) {
    const cid = nextId++;
    for (const rid of m) finalOf[rid] = cid;
    finalMembers.set(cid, [...m]);
  }
  for (let rid = 1; rid <= maxRid; rid++) {
    if (!(src[rid] ?? 0) || (repOf[rid] ?? 0) || (finalOf[rid] ?? 0)) continue;
    const cid = nextId++;
    finalOf[rid] = cid;
    finalMembers.set(cid, [rid]);
  }
  for (let rid = 1; rid <= maxRid; rid++) {
    const representative = repOf[rid] ?? 0;
    if (!representative) continue;
    const cid = finalOf[representative] ?? 0;
    finalOf[rid] = cid;
    finalMembers.get(cid)?.push(rid);
  }

  await sql.unsafe(
    'CREATE TABLE poi_work_cluster (cluster_no int NOT NULL, rid int NOT NULL PRIMARY KEY, role text NOT NULL)',
  );
  await sql.unsafe(`CREATE TABLE poi_work_cluster_meta (cluster_no int PRIMARY KEY, primary_rid int NOT NULL, stable_id text NOT NULL, poi_id text,
    quality_score smallint NOT NULL, popularity real NOT NULL, status text NOT NULL, source_count smallint NOT NULL)`);
  function* clusterRows() {
    for (const [cid, m] of finalMembers) {
      const reps = m.filter((rid) => !repOf[rid]);
      const primary = pickPrimary(
        reps.map((rid) => ({ rid, source: sourceOf(rid), completeness: completeness[rid] ?? 0 })),
      );
      if (!primary) continue;
      for (const rid of m) yield [cid, rid, rid === primary.rid ? 'primary' : 'secondary'];
    }
  }
  function* metaRows() {
    for (const [cid, m] of finalMembers) {
      const reps = m.filter((rid) => !repOf[rid]);
      const primary = pickPrimary(
        reps.map((rid) => ({ rid, source: sourceOf(rid), completeness: completeness[rid] ?? 0 })),
      );
      if (!primary) continue;
      const primaryRid = primary.rid;
      const srcs = new Set(m.map(sourceOf));
      const f = flags[primaryRid] ?? 0;
      const c = conf[primaryRid] ?? 0;
      if (srcs.size === 1 && sourceOf(primaryRid) === 'overture' && c < 0.4) continue;
      const closed = m.some((rid) => ((flags[rid] ?? 0) >> 4) & 1);
      yield [
        cid,
        primaryRid,
        stableId(sourceOf(primaryRid), sourceIds[primaryRid] ?? ''),
        null,
        qualityScore({
          hasPhone: !!(f & 1),
          hasWebsite: !!(f & 2),
          hasHours: !!(f & 4),
          hasHousenumber: !!(f & 8),
          sourceCount: srcs.size,
          confidence: c,
          monthsOld: months[primaryRid] ?? 0,
        }),
        popularity({ sourceCount: srcs.size, hasFsq: srcs.has('fsq') }),
        closed ? 'closed' : 'active',
        srcs.size,
      ];
    }
  }
  await copyInto(sql, 'poi_work_cluster', ['cluster_no', 'rid', 'role'], clusterRows());
  await copyInto(
    sql,
    'poi_work_cluster_meta',
    [
      'cluster_no',
      'primary_rid',
      'stable_id',
      'poi_id',
      'quality_score',
      'popularity',
      'status',
      'source_count',
    ],
    metaRows(),
  );
  await sql.unsafe('CREATE INDEX poi_work_cluster_cluster_idx ON poi_work_cluster (cluster_no)');

  await sql.unsafe(`UPDATE poi_work_cluster_meta m SET poi_id = x.poi_id FROM (
      SELECT DISTINCT ON (c.cluster_no) c.cluster_no, l.poi_id, (c.role = 'primary') AS by_primary
      FROM poi_work_cluster c JOIN poi_work_record r ON r.rid = c.rid JOIN poi_source_link l ON (l.source, l.source_id) = (r.source, r.source_id)
      ORDER BY c.cluster_no, (c.role = 'primary') DESC) x WHERE x.cluster_no = m.cluster_no`);
  await sql.unsafe(`WITH conflicts AS (
      SELECT m.cluster_no, row_number() OVER (
        PARTITION BY m.poi_id
        ORDER BY EXISTS (
          SELECT 1 FROM poi p JOIN poi_work_record r ON r.rid = m.primary_rid
          WHERE p.id = m.poi_id AND p.primary_source = r.source AND p.primary_source_id = r.source_id
        ) DESC, m.cluster_no
      ) AS keep_rank
      FROM poi_work_cluster_meta m WHERE m.poi_id IS NOT NULL
    )
    UPDATE poi_work_cluster_meta m SET poi_id = NULL FROM conflicts c
    WHERE c.cluster_no = m.cluster_no AND c.keep_rank > 1`);
  await sql.unsafe('UPDATE poi_work_cluster_meta SET poi_id = stable_id WHERE poi_id IS NULL');
  // Một ID cũ có thể bằng stable_id của cụm khác sau khi cụm cũ tách. Ưu tiên ID ổn định
  // của chính cụm để POI mới luôn có khoá duy nhất; cụm còn lại nhận stable_id riêng của nó.
  await sql.unsafe(`WITH final_conflicts AS (
      SELECT m.cluster_no, row_number() OVER (
        PARTITION BY m.poi_id
        ORDER BY (m.poi_id = m.stable_id) DESC, m.cluster_no
      ) AS keep_rank
      FROM poi_work_cluster_meta m
    )
    UPDATE poi_work_cluster_meta m SET poi_id = m.stable_id FROM final_conflicts c
    WHERE c.cluster_no = m.cluster_no AND c.keep_rank > 1`);
  await sql.unsafe('ANALYZE poi_work_cluster; ANALYZE poi_work_cluster_meta');

  const s = /** @type {any} */ (
    (
      await sql`SELECT count(*)::int AS clusters, count(*) FILTER (WHERE source_count >= 2)::int AS multi,
      count(*) FILTER (WHERE poi_id <> stable_id)::int AS reused FROM poi_work_cluster_meta`
    )[0]
  );
  const d = /** @type {any} */ (
    (await sql`SELECT count(*)::int AS dups FROM poi_work_cluster WHERE role = 'secondary'`)[0]
  );
  if (!s || !d) throw new Error('Thiếu số liệu sau gộp');
  console.log(
    `✓ gộp: ${s.clusters} cụm (${s.multi} đa nguồn = ${((100 * s.multi) / Math.max(1, s.clusters)).toFixed(1)} %), ${d.dups} bản ghi phụ, ${s.reused} ID dùng lại`,
  );
} finally {
  await sql.end();
}
