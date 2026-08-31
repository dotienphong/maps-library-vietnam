#!/usr/bin/env node
// Bước 1 gộp: quét src_osm_place / src_overture_place / src_fsq_place → poi_work_record. Idempotent (dựng lại toàn bộ).
import { nameCore, normalizeVi, parseAddress } from '@mapslibvn/core';
import { domainsOf, phonesOf } from './lib/contacts.mjs';
import { ewkt, pgArray, pgJson } from './lib/copy-format.mjs';
import { vnDate } from './lib/env.mjs';
import { connect, copyInto, countRows } from './pg.mjs';
import { categoryFor, loadCategories, loadCategoryMaps, refineSchool } from './taxonomy.mjs';

/** @typedef {import('postgres').Sql} Sql */

const UNNAMED_OK = new Set([
  'transport',
  'public_admin',
  'health',
  'education',
  'religion_community',
]);
const maps = loadCategoryMaps();
const catVi = new Map(loadCategories().map((c) => [c.code, c.vi]));
const today = vnDate();
const dateStr = (/** @type {unknown} */ v) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : today;

export const RECORD_COLUMNS = [
  'source',
  'source_id',
  'name',
  'name_norm',
  'name_core',
  'name_alt',
  'group_code',
  'category',
  'confidence',
  'phones',
  'domains',
  'housenumber',
  'street',
  'street_norm',
  'ward',
  'ward_norm',
  'province',
  'province_norm',
  'address_text',
  'contact',
  'hours',
  'has_phone',
  'has_website',
  'has_hours',
  'has_housenumber',
  'has_category',
  'completeness',
  'updated_at',
  'closed',
  'geom',
];

/** @param {{ source: string, sourceId: string, name: string, nameAlt: string[], cat: { code: string, group: string }, confidence: number,
 *   phones: unknown[], websites: unknown[], facebook: string | null, hours: Record<string, unknown> | null, address: string | null,
 *   updatedAt: unknown, closed: boolean, lon: number, lat: number }} r */
export function buildRow(r) {
  const addr = r.address ? parseAddress(r.address) : { alleyChain: [], confidence: 0 };
  const e164 = phonesOf(/** @type {string[]} */ (r.phones));
  const domains = domainsOf(/** @type {string[]} */ (r.websites));
  const websites = r.websites.filter(Boolean).map(String);
  const f = {
    phone: e164.length > 0,
    website: websites.length > 0,
    hours: r.hours !== null,
    hn: Boolean(addr.housenumber),
    cat: r.cat.code !== 'other',
  };
  const completeness =
    3 * Number(f.phone) +
    3 * Number(f.website) +
    2 * Number(f.hours) +
    2 * Number(f.hn) +
    Number(f.cat) +
    2 * r.confidence;
  return [
    r.source,
    r.sourceId,
    r.name,
    normalizeVi(r.name),
    nameCore(r.name),
    r.nameAlt.length ? pgArray(r.nameAlt) : null,
    r.cat.group,
    r.cat.code,
    r.confidence,
    pgArray(e164),
    pgArray(domains),
    addr.housenumber ?? null,
    addr.street ?? null,
    addr.streetNorm ?? null,
    addr.ward ?? null,
    addr.ward ? normalizeVi(addr.ward) : null,
    addr.province ?? null,
    addr.province ? normalizeVi(addr.province) : null,
    r.address,
    pgJson({ phone: e164, website: websites, facebook: r.facebook }),
    r.hours ? pgJson(r.hours) : null,
    f.phone,
    f.website,
    f.hours,
    f.hn,
    f.cat,
    completeness,
    dateStr(r.updatedAt),
    r.closed,
    ewkt(r.lon, r.lat),
  ];
}

/** @param {Sql} sql */
async function* osmRows(sql) {
  // rid là tie-break của ghép tham lam, nên thứ tự COPY phải ổn định giữa các lần dựng.
  for await (const rows of sql`SELECT osm_type, osm_id, name, tags, ST_X(geom) AS lon, ST_Y(geom) AS lat, release FROM src_osm_place ORDER BY osm_type, osm_id`.cursor(
    2000,
  )) {
    for (const raw of rows) {
      const r = /** @type {any} */ (raw);
      const t = /** @type {Record<string, string>} */ (r.tags);
      const cat0 = categoryFor(maps, 'osm', t);
      if (!cat0) continue;
      let name = r.name;
      if (!name) {
        if (!UNNAMED_OK.has(cat0.group)) continue;
        name = catVi.get(cat0.code) ?? cat0.code;
      }
      const cat = { code: refineSchool(cat0.code, name), group: cat0.group };
      const line1 = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
      const address = line1
        ? [
            line1,
            t['addr:suburb'] ?? t['addr:quarter'],
            t['addr:district'],
            t['addr:city'] ?? t['addr:province'],
          ]
            .filter(Boolean)
            .join(', ')
        : null;
      yield buildRow({
        source: 'osm',
        sourceId: `${r.osm_type}${r.osm_id}`,
        name,
        nameAlt: /** @type {string[]} */ (
          [t['name:en'], t.alt_name, t.old_name, t.official_name].filter(
            (x) => typeof x === 'string' && x !== name,
          )
        ),
        cat,
        confidence: 1,
        phones: [t.phone, t['contact:phone'], t.mobile, t['contact:mobile']],
        websites: [t.website, t['contact:website'], t.url],
        facebook: t['contact:facebook'] ?? null,
        hours: t.opening_hours ? { osm: t.opening_hours } : null,
        address,
        updatedAt: r.release,
        closed: t.disused === 'yes' || 'disused:amenity' in t || 'disused:shop' in t,
        lon: r.lon,
        lat: r.lat,
      });
    }
  }
}

/** @param {Sql} sql */
async function* overtureRows(sql) {
  for await (const rows of sql`SELECT id, name, names, category, categories, confidence, addresses, websites, phones, sources, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM src_overture_place WHERE name IS NOT NULL ORDER BY id`.cursor(
    2000,
  )) {
    for (const raw of rows) {
      const r = /** @type {any} */ (raw);
      const alt = /** @type {string[]} */ (r.categories?.alternate ?? []);
      const cat = categoryFor(maps, 'overture', [r.category, ...alt]) ?? {
        code: 'other',
        group: 'other',
      };
      const a = r.addresses?.[0] ?? {};
      const meta = (r.sources ?? []).find((/** @type {any} */ s) => s?.dataset === 'meta');
      const extra =
        (r.sources ?? []).find((/** @type {any} */ s) => s?.dataset === '_overture_extra') ?? {};
      const fb =
        (extra.socials ?? []).find((/** @type {any} */ u) =>
          /facebook\.com|fb\.com/.test(String(u)),
        ) ?? (meta?.record_id ? `https://www.facebook.com/${meta.record_id}` : null);
      const common = r.names?.common ? Object.values(r.names.common) : [];
      yield buildRow({
        source: 'overture',
        sourceId: r.id,
        name: r.name,
        nameAlt: /** @type {string[]} */ (
          common.filter((x) => typeof x === 'string' && x !== r.name)
        ),
        cat: { code: refineSchool(cat.code, r.name), group: cat.group },
        confidence: r.confidence ?? 0.5,
        phones: r.phones ?? [],
        websites: r.websites ?? [],
        facebook: fb,
        hours: null,
        address: [a.freeform, a.locality, a.region].filter(Boolean).join(', ') || null,
        updatedAt: r.sources?.[0]?.update_time ?? today,
        closed:
          extra.operating_status !== null &&
          extra.operating_status !== undefined &&
          extra.operating_status !== 'open',
        lon: r.lon,
        lat: r.lat,
      });
    }
  }
}

/** @param {Sql} sql */
async function* fsqRows(sql) {
  for await (const rows of sql`SELECT fsq_place_id, name, categories, address, locality, region, tel, website, date_closed, ST_X(geom) AS lon, ST_Y(geom) AS lat, release FROM src_fsq_place WHERE name IS NOT NULL ORDER BY fsq_place_id`.cursor(
    2000,
  )) {
    for (const raw of rows) {
      const r = /** @type {any} */ (raw);
      const cat = categoryFor(maps, 'fsq', r.categories ?? []) ?? { code: 'other', group: 'other' };
      yield buildRow({
        source: 'fsq',
        sourceId: r.fsq_place_id,
        name: r.name,
        nameAlt: [],
        cat: { code: refineSchool(cat.code, r.name), group: cat.group },
        confidence: 0.8,
        phones: [r.tel],
        websites: [r.website],
        facebook: null,
        hours: null,
        address: [r.address, r.locality, r.region].filter(Boolean).join(', ') || null,
        updatedAt: r.release,
        closed: r.date_closed !== null,
        lon: r.lon,
        lat: r.lat,
      });
    }
  }
}

if (process.argv[1]?.endsWith('records.mjs')) {
  const sql = connect();
  try {
    await sql.unsafe(
      'DROP TABLE IF EXISTS poi_work_pair, poi_work_cluster_meta, poi_work_cluster, poi_work_record',
    );
    await sql.unsafe(`CREATE TABLE poi_work_record (
      rid serial PRIMARY KEY, source text NOT NULL, source_id text NOT NULL, name text NOT NULL, name_norm text NOT NULL, name_core text NOT NULL,
      name_alt text[], group_code text NOT NULL, category text NOT NULL, confidence real NOT NULL, phones text[] NOT NULL, domains text[] NOT NULL,
      housenumber text, street text, street_norm text, ward text, ward_norm text, province text, province_norm text, address_text text,
      contact jsonb, hours jsonb, has_phone boolean, has_website boolean, has_hours boolean, has_housenumber boolean, has_category boolean,
      completeness real NOT NULL, updated_at date NOT NULL, closed boolean NOT NULL, geom geometry(Point, 4326) NOT NULL, UNIQUE (source, source_id))`);
    let n = 0;
    for (const gen of [osmRows, overtureRows, fsqRows])
      n += await copyInto(sql, 'poi_work_record', RECORD_COLUMNS, gen(sql));
    await sql.unsafe('CREATE INDEX poi_work_record_geom_idx ON poi_work_record USING gist (geom)');
    await sql.unsafe('CREATE INDEX poi_work_record_source_idx ON poi_work_record (source)');
    await sql.unsafe('ANALYZE poi_work_record');
    const by =
      await sql`SELECT source, count(*)::int AS n FROM poi_work_record GROUP BY 1 ORDER BY 1`;
    console.log(
      `✓ poi_work_record: ${await countRows(sql, 'poi_work_record')} dòng (COPY ${n}) — ${by.map((b) => `${b.source}=${b.n}`).join(', ')}`,
    );
  } finally {
    // Không để một COPY/cursor lỗi qua Tunnel giữ teardown vô hạn và che mất lỗi gốc.
    await sql.end({ timeout: 5 });
  }
}
