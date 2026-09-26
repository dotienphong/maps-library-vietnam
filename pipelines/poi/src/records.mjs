#!/usr/bin/env node
// Bước 1 gộp: quét src_osm_place / src_fsq_place → poi_work_record. Idempotent (dựng lại toàn bộ).
import { filterNameAlt, nameCore, normalizeVi, parseAddress, searchKeys } from '@mapslibvn/core';
import { domainsOf, phonesOf } from './lib/contacts.mjs';
import { ewkt, pgArray, pgJson } from './lib/copy-format.mjs';
import { vnDate } from './lib/env.mjs';
import { fsqFlagDecision } from './lib/fsq-flags.mjs';
import {
  adminCore,
  extendedAllowed,
  fromExtendedKey,
  LEGACY_POI_KEYS,
  SAME_NAME_DEDUPE_CODES,
} from './lib/osm-extended.mjs';
import { osmEmails, osmNameAlt, resolveOsmName } from './lib/osm-names.mjs';
import { quanDaoGeoJson } from './lib/quan-dao.mjs';
import { connect, copyInto, countRows } from './pg.mjs';
import { categoryFor, loadCategories, loadCategoryMaps, refineSchool } from './taxonomy.mjs';

/** @typedef {import('postgres').Sql} Sql */

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
  'name_key',
  'name_alt_norm',
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
  'closed_reported',
  'ext',
  'geom',
];

/** @param {{ source: string, sourceId: string, name: string, nameAlt: string[], cat: { code: string, group: string }, confidence: number,
 *   phones: unknown[], websites: unknown[], facebook: string | null, emails?: string[], hours: Record<string, unknown> | null, address: string | null,
 *   updatedAt: unknown, closed: boolean, closedReported?: boolean, ext?: boolean, lon: number, lat: number }} r */
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
  const nameNorm = normalizeVi(r.name);
  // Mảng gốc phải lọc bằng CÙNG luật sinh name_alt_norm, nếu không hai cột lệch chỉ số và
  // `matched_alt` của API trả sai phần tử.
  const nameAlt = filterNameAlt(nameNorm, r.nameAlt);
  const keys = searchKeys(nameNorm, nameAlt);
  return [
    r.source,
    r.sourceId,
    r.name,
    nameNorm,
    nameCore(r.name),
    nameAlt.length ? pgArray(nameAlt) : null,
    keys.nameKey,
    keys.nameAltNorm,
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
    // `email` chỉ khi có, để JSON contact của POI khác giữ nguyên ba khoá cũ.
    pgJson({
      phone: e164,
      website: websites,
      facebook: r.facebook,
      ...(r.emails?.length ? { email: r.emails } : {}),
    }),
    r.hours ? pgJson(r.hours) : null,
    f.phone,
    f.website,
    f.hours,
    f.hn,
    f.cat,
    completeness,
    dateStr(r.updatedAt),
    r.closed,
    r.closedReported ?? false,
    r.ext ?? false,
    ewkt(r.lon, r.lat),
  ];
}

/**
 * Với mỗi đối tượng mà loại chỉ có thể đến từ khoá mở rộng (theo `<osm_type><osm_id>`): có nằm trong
 * một xã/phường hiện hành không, và tên (đã bỏ tiền tố) các xã/phường hiện hành + cũ chứa nó. Bảng
 * hành chính là của lần build trước; DB mới (admin_area rỗng) thì bỏ qua hai luật này.
 * @param {Sql} sql
 * @returns {Promise<Map<string, { inCommune: boolean, cores: Set<string> }>>}
 */
export async function loadExtendedAdmin(sql) {
  // Kiểm DỮ LIỆU chứ không kiểm bảng: migration 0004/0008 tạo sẵn hai bảng rỗng, và trong
  // data-update records chạy TRƯỚC admin.mjs — DB mới mà coi là "đã có" thì mọi đối tượng thành
  // "ngoài xã" và toàn bộ POI khoá mở rộng bị bỏ lặng lẽ.
  const [ready] = await sql`SELECT EXISTS (SELECT 1 FROM admin_area WHERE level = 8) AS ok`;
  if (!ready?.ok) {
    console.warn('! admin_area chưa có xã/phường — bỏ qua luật phạm vi xã và trùng tên xã');
    return new Map();
  }
  const legacy = LEGACY_POI_KEYS.map((k) => `'${k}'`).join(',');
  // Vùng hai quần đảo tính như "trong xã": admin_area của lần build trước chưa có hai đặc khu (OSM không
  // dựng được relation) nên không miễn thì mọi đảo khoá mở rộng bị loại ở lần chạy đầu (PHONG 26/09/2026).
  const rows = await sql.unsafe(
    `SELECT s.osm_type, s.osm_id,
      (EXISTS (SELECT 1 FROM admin_area a WHERE a.level = 8 AND ST_Covers(a.geom, s.geom))
        OR ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), s.geom)) AS in_commune,
      (SELECT array_agg(DISTINCT x.name_norm) FROM (
         SELECT name_norm, geom FROM admin_area WHERE level >= 6
         UNION ALL SELECT name_norm, geom FROM admin_area_old WHERE level >= 6) x
       WHERE ST_Covers(x.geom, s.geom)) AS names
    FROM src_osm_place s
    WHERE NOT (s.tags ?| ARRAY[${legacy}])`,
    [quanDaoGeoJson()],
  );
  return new Map(
    rows.map((r) => [
      `${r.osm_type}${r.osm_id}`,
      {
        inCommune: Boolean(r.in_commune),
        cores: new Set(/** @type {string[]} */ (r.names ?? []).map(adminCore)),
      },
    ]),
  );
}

/**
 * Gom bản ghi OSM cùng `name_norm` + cùng mã trong 1 km (plan 2026-09-26 Task 4). DELETE … USING so
 * với trạng thái đầu câu lệnh, nên một chuỗi bản ghi liền nhau (< 1 km giữa từng cặp) dồn về bản rid
 * nhỏ nhất dù bản đó có thể xa hơn 1 km — chấp nhận: đo 26/09 chỉ 46 bản (hồ rác "Industry pond").
 * @param {Sql} sql
 * @param {string} [table]
 * @returns {Promise<number>} số bản ghi bị xoá
 */
export async function dedupeSameName(sql, table = 'poi_work_record') {
  const codes = SAME_NAME_DEDUPE_CODES.map((c) => `'${c}'`).join(',');
  // Lọc thô bằng độ (≈ 1,1 km) để dùng index geometry, rồi mới đo geography chính xác.
  const near = `ST_DWithin(r.geom, o.geom, 0.012) AND ST_DWithin(r.geom::geography, o.geom::geography, 1000)`;
  const sameCode = await sql.unsafe(`DELETE FROM ${table} r USING ${table} o
    WHERE r.source = 'osm' AND o.source = 'osm' AND r.category = o.category
      AND r.category IN (${codes}) AND r.name_norm = o.name_norm AND r.rid > o.rid AND ${near}`);
  // Bản ghi từ khoá mở rộng nhường POI OSM cũ cùng tên: polygon landuse=religious "Chùa X" trùng
  // node chùa nằm trong nó (442 bản ghi, đo 26/09). Trừ khi POI cũ là trạm giao thông: bến xe buýt,
  // ga đặt tên theo chính địa danh ("Ngã tư Thủ Đức", "KCN Tân Thới Hiệp", 182 ca) — nhường thì
  // nút giao/KCN/thôn mất hẳn, chỉ còn điểm dừng xe buýt.
  const yielded = await sql.unsafe(`DELETE FROM ${table} r USING ${table} o
    WHERE r.source = 'osm' AND o.source = 'osm' AND r.ext AND NOT o.ext
      AND o.group_code <> 'transport' AND r.name_norm = o.name_norm AND ${near}`);
  return sameCode.count + yielded.count;
}

/** @param {Sql} sql @param {Map<string, { inCommune: boolean, cores: Set<string> }>} [adminInfo] */
async function* osmRows(sql, adminInfo = new Map()) {
  // rid là tie-break của ghép tham lam, nên thứ tự COPY phải ổn định giữa các lần dựng.
  for await (const rows of sql`SELECT osm_type, osm_id, name, tags, ST_X(geom) AS lon, ST_Y(geom) AS lat, release FROM src_osm_place ORDER BY osm_type, osm_id`.cursor(
    2000,
  )) {
    for (const raw of rows) {
      const r = /** @type {any} */ (raw);
      const t = /** @type {Record<string, string>} */ (r.tags);
      const cat0 = categoryFor(maps, 'osm', t);
      if (!cat0) continue;
      const resolved = resolveOsmName(t, cat0, (code) => catVi.get(code) ?? code);
      if (!resolved) continue;
      const { name, extraAlt } = resolved;
      const cat = { code: refineSchool(cat0.code, name), group: cat0.group };
      const key = `${r.osm_type}${r.osm_id}`;
      const ext = fromExtendedKey(t);
      const admin = adminInfo.get(key);
      const allowed = extendedAllowed({
        tags: t,
        name,
        cat,
        ext,
        adminCores: admin?.cores,
        inCommune: admin?.inCommune,
      });
      if (!allowed) continue;
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
        sourceId: key,
        name,
        nameAlt: osmNameAlt(t, name, extraAlt),
        cat,
        confidence: 1,
        phones: [t.phone, t['contact:phone'], t.mobile, t['contact:mobile']],
        websites: [t.website, t['contact:website'], t.url],
        facebook: t['contact:facebook'] ?? null,
        emails: osmEmails(t),
        hours: t.opening_hours ? { osm: t.opening_hours } : null,
        address,
        updatedAt: r.release,
        closed: t.disused === 'yes' || 'disused:amenity' in t || 'disused:shop' in t,
        ext,
        lon: r.lon,
        lat: r.lat,
      });
    }
  }
}

/** @param {Sql} sql */
async function* fsqRows(sql) {
  for await (const rows of sql`SELECT fsq_place_id, name, categories, address, locality, region, tel, website, date_closed, unresolved_flags, ST_X(geom) AS lon, ST_Y(geom) AS lat, release FROM src_fsq_place WHERE name IS NOT NULL ORDER BY fsq_place_id`.cursor(
    2000,
  )) {
    for (const raw of rows) {
      const r = /** @type {any} */ (raw);
      const flags = fsqFlagDecision(r.unresolved_flags);
      if (flags.drop) continue;
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
        closedReported: flags.closed,
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
      name_alt text[], name_key text NOT NULL, name_alt_norm text, group_code text NOT NULL, category text NOT NULL, confidence real NOT NULL, phones text[] NOT NULL, domains text[] NOT NULL,
      housenumber text, street text, street_norm text, ward text, ward_norm text, province text, province_norm text, address_text text,
      contact jsonb, hours jsonb, has_phone boolean, has_website boolean, has_hours boolean, has_housenumber boolean, has_category boolean,
      completeness real NOT NULL, updated_at date NOT NULL, closed boolean NOT NULL, closed_reported boolean NOT NULL DEFAULT false,
      ext boolean NOT NULL DEFAULT false, geom geometry(Point, 4326) NOT NULL, UNIQUE (source, source_id))`);
    const adminInfo = await loadExtendedAdmin(sql);
    let n = await copyInto(sql, 'poi_work_record', RECORD_COLUMNS, osmRows(sql, adminInfo));
    n += await copyInto(sql, 'poi_work_record', RECORD_COLUMNS, fsqRows(sql));
    await sql.unsafe('CREATE INDEX poi_work_record_geom_idx ON poi_work_record USING gist (geom)');
    const merged = await dedupeSameName(sql);
    console.log(
      `  gom ${merged} bản ghi OSM cùng tên trong 1 km (${SAME_NAME_DEDUPE_CODES.join(', ')})`,
    );
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
