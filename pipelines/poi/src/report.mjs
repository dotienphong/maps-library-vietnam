#!/usr/bin/env node
// Báo cáo số liệu kho POI → out/poi-report-<YYYYMMDD>.json + bảng console. Dùng: node report.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT, vnDate } from './lib/env.mjs';
import { connect } from './pg.mjs';

const sql = connect();
try {
  const poi = /** @type {any} */ (
    (
      await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'closed')::int AS closed,
      round(avg(quality_score))::int AS avg_quality, count(*) FILTER (WHERE quality_score >= 60)::int AS q60,
      count(*) FILTER (WHERE category = 'other' OR category LIKE '%\\_other')::int AS other FROM poi`
    )[0]
  );
  const bySource =
    await sql`SELECT primary_source AS source, count(*)::int AS n FROM poi GROUP BY 1 ORDER BY 2 DESC`;
  const byGroup =
    await sql`SELECT c.group_code, count(*)::int AS n FROM poi p JOIN category c ON c.code = p.category GROUP BY 1 ORDER BY 2 DESC`;
  const links = /** @type {any} */ (
    (
      await sql`SELECT count(*)::int AS links, count(DISTINCT poi_id)::int AS pois,
      count(*) FILTER (WHERE role = 'secondary')::int AS secondary FROM poi_source_link`
    )[0]
  );
  const multi = /** @type {any} */ (
    (
      await sql`SELECT count(*)::int AS n FROM (SELECT poi_id FROM poi_source_link GROUP BY 1 HAVING count(DISTINCT source) >= 2) x`
    )[0]
  );
  const geo = /** @type {any} */ (
    (
      await sql`SELECT (SELECT count(*)::int FROM address_anchor) AS anchors, (SELECT count(*)::int FROM street) AS streets,
      (SELECT count(*)::int FROM alley) AS alleys, (SELECT count(*)::int FROM admin_area) AS admin_areas`
    )[0]
  );
  if (!poi || !links || !multi || !geo) throw new Error('Thiếu số liệu báo cáo');
  const report = {
    date: vnDate(),
    poi,
    bySource,
    byGroup,
    links: {
      ...links,
      multiSourcePois: multi.n,
      multiSourcePct: Number(((100 * multi.n) / Math.max(1, poi.total)).toFixed(1)),
    },
    geocode: geo,
  };
  mkdirSync(OUT, { recursive: true });
  const file = resolve(OUT, `poi-report-${vnDate().replace(/-/g, '')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.table({
    total: poi.total,
    active: poi.active,
    closed: poi.closed,
    avg_quality: poi.avg_quality,
    other_pct: ((100 * poi.other) / Math.max(1, poi.total)).toFixed(1),
    multi_source_pct: report.links.multiSourcePct,
    anchors: geo.anchors,
    streets: geo.streets,
    alleys: geo.alleys,
  });
  console.log(`✓ ${file}`);
} finally {
  await sql.end();
}
