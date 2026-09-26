#!/usr/bin/env node
// Taxonomy spec 5.6: đọc db/seed/category.json + 2 CSV ánh xạ (OSM, FSQ); mapCategory(); lệnh `load` upsert vào Postgres.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SEED = resolve('db/seed');
export const GROUPS = [
  'food_drink',
  'shopping',
  'services',
  'health',
  'education',
  'finance',
  'lodging',
  'entertainment_sport',
  'culture_tourism',
  'transport',
  'public_admin',
  'religion_community',
  'place',
];
/** Thứ tự ưu tiên khoá OSM khi một đối tượng có nhiều tag (spec 5.6: amenity=cafe → cafe). */
export const OSM_KEYS = [
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'office',
  'craft',
  'healthcare',
  'historic',
  'public_transport',
  'aeroway',
  'railway',
  // Khoá mở rộng 26/09/2026 — sau khoá cũ để POI đang có giữ nguyên loại; natural trước place để
  // bãi biển gắn kèm place=locality vẫn là beach.
  'natural',
  'waterway',
  'place',
  'landuse',
  'man_made',
  'barrier',
  'highway',
  'junction',
];
/**
 * Khoá chỉ thành POI khi đúng giá trị có trong category_map_osm.csv: giá trị lạ (place=town,
 * landuse=military, natural=tree…) không được rơi về `other` như khoá POI cũ.
 */
export const STRICT_OSM_KEYS = new Set([
  'natural',
  'waterway',
  'place',
  'landuse',
  'man_made',
  'barrier',
  'highway',
  'junction',
]);
/** Tag phụ làm rõ loại: ứng viên "khoá=giá trị/phụ" được thử TRƯỚC "khoá=giá trị". */
const OSM_QUALIFIER = /** @type {Record<string, string[]>} */ ({
  'amenity=place_of_worship': ['religion'],
  'leisure=pitch': ['sport'],
  'railway=station': ['station'],
  'public_transport=station': ['station'],
  'natural=water': ['water'],
});
/** Đối tượng OSM không phải địa điểm để tìm kiếm — không tạo poi. */
export const OSM_DROP = new Set([
  'amenity=bench',
  'amenity=waste_basket',
  'amenity=vending_machine',
  'amenity=bicycle_parking',
  'amenity=shelter',
  'amenity=drinking_water',
  'amenity=fountain',
  'amenity=recycling',
  'amenity=waste_disposal',
  'amenity=parking_entrance',
  'amenity=parking_space',
  'amenity=telephone',
  'amenity=post_box',
  'amenity=bbq',
  'amenity=hunting_stand',
  'amenity=loading_dock',
  'amenity=grit_bin',
  'amenity=clock',
  'public_transport=stop_position',
  'leisure=picnic_table',
  'leisure=slipway',
  'leisure=track',
  'leisure=common',
  'leisure=firepit',
  'leisure=outdoor_seating',
  'leisure=swimming_area',
  // Hạ tầng đường sắt/sân bay: không phải địa điểm để tìm kiếm (đo trên dữ liệu VN, Task 6)
  'railway=level_crossing',
  'railway=crossing',
  'railway=switch',
  'railway=signal',
  'railway=platform',
  'railway=stop',
  'railway=subway_entrance',
  'railway=buffer_stop',
  'railway=milestone',
  'aeroway=gate',
  'aeroway=holding_position',
  'aeroway=parking_position',
  'aeroway=taxiway',
  'aeroway=runway',
  'amenity=house',
  'amenity=shower',
  'amenity=watering_place',
  'amenity=water_point',
  'amenity=bicycle_repair_station',
  'amenity=smoking_area',
  'amenity=lounger',
  'amenity=trolley_bay',
]);

/** @returns {{ code: string, group: string, vi: string, en: string, icon: string, rank: number }[]} */
export function loadCategories() {
  return JSON.parse(readFileSync(resolve(SEED, 'category.json'), 'utf8'));
}

/** CSV `source_value,code`: tách ở dấu phẩy CUỐI (nhãn FSQ có dấu phẩy), bỏ dấu nháy bao ngoài, bỏ dòng #/trống. @param {string} text */
export function parseMapCsv(text) {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cut = line.lastIndexOf(',');
    if (cut < 0) continue;
    const value = line
      .slice(0, cut)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .trim();
    const code = line.slice(cut + 1).trim();
    if (value && code) m.set(value, code);
  }
  return m;
}

export function loadCategoryMaps() {
  const read = (/** @type {string} */ f) => parseMapCsv(readFileSync(resolve(SEED, f), 'utf8'));
  return {
    osm: read('category_map_osm.csv'),
    fsq: read('category_map_fsq.csv'),
  };
}

const GROUP_OF = new Map(loadCategories().map((c) => [c.code, c.group]));
const OTHER = { code: 'other', group: 'other' };
/** @param {string} code */
const withGroup = (code) => ({ code, group: GROUP_OF.get(code) ?? 'other' });

/**
 * @param {{ osm: Map<string, string>, fsq: Map<string, string> }} maps
 * @param {'osm' | 'fsq'} source
 * @param {string} value osm: "amenity=cafe"; fsq: "A > B > C"
 */
export function mapCategory(maps, source, value) {
  const m = maps[source];
  const direct = m.get(value);
  if (direct) return withGroup(direct);
  if (source === 'osm') {
    const key = value.split('=')[0];
    const wildcard = m.get(`${key}=*`);
    return wildcard ? withGroup(wildcard) : OTHER;
  }
  if (source === 'fsq') {
    const parts = value.split('>').map((s) => s.trim());
    for (let depth = parts.length; depth >= 1; depth--) {
      const leaf = parts[depth - 1];
      const path = parts.slice(0, depth).join(' > ');
      const hit = (leaf && m.get(leaf)) || m.get(path);
      if (hit) return withGroup(hit);
    }
  }
  return OTHER;
}

/** Danh sách "khoá=giá trị" POI của một đối tượng OSM theo ưu tiên OSM_KEYS (kèm biến thể tag phụ). @param {Record<string, string>} tags */
export function osmCandidates(tags) {
  /** @type {string[]} */
  const out = [];
  for (const k of OSM_KEYS) {
    if (tags[k] === undefined) continue;
    const kv = `${k}=${tags[k]}`;
    for (const q of OSM_QUALIFIER[kv] ?? []) if (tags[q]) out.push(`${kv}/${tags[q]}`);
    out.push(kv);
  }
  return out;
}

/** Tách cấp trường theo tên tiếng Việt khi loại chỉ là `school`. @param {string} code @param {string | null | undefined} name */
export function refineSchool(code, name) {
  if (code !== 'school' || !name) return code;
  const n = name.toLowerCase();
  if (/mầm non|mẫu giáo|mam non|mau giao|kindergarten|preschool/.test(n)) return 'kindergarten';
  if (/tiểu học|tieu hoc|primary|elementary/.test(n)) return 'primary_school';
  if (/thpt|trung học phổ thông|trung hoc pho thong|high school/.test(n)) return 'high_school';
  if (/thcs|trung học cơ sở|trung hoc co so|secondary|middle school/.test(n))
    return 'secondary_school';
  return code;
}

/**
 * Chọn loại cho một bản ghi: lấy ứng viên đầu tiên ánh xạ được (không phải *_other/other); nếu không có ứng viên nào → theo ứng viên đầu.
 * @param {{ osm: Map<string, string>, fsq: Map<string, string> }} maps
 * @param {'osm' | 'fsq'} source
 * @param {Record<string, string> | (string | null | undefined)[]} input tags OSM, hoặc mảng nhãn FSQ (`fsq_category_labels`, thử lần lượt)
 * @returns {{ code: string, group: string } | null} null khi đối tượng OSM không có tag POI nào
 */
export function categoryFor(maps, source, input) {
  const values = Array.isArray(input)
    ? input.filter((v) => typeof v === 'string' && v)
    : osmCandidates(input).filter(
        (v) => !OSM_DROP.has(v) && (!STRICT_OSM_KEYS.has(v.split('=')[0] ?? '') || maps.osm.has(v)),
      );
  if (values.length === 0) return source === 'osm' ? null : OTHER;
  let fallback = null;
  for (const v of values) {
    const r = mapCategory(maps, source, /** @type {string} */ (v));
    if (r.code !== 'other' && !r.code.endsWith('_other')) return r;
    fallback ??= r;
  }
  return fallback ?? OTHER;
}

// ---- CLI: node pipelines/poi/src/taxonomy.mjs load  (upsert category + category_map vào Postgres) ----
if (process.argv[1]?.endsWith('taxonomy.mjs') && process.argv[2] === 'load') {
  const { connect } = await import('./pg.mjs');
  const sql = connect();
  try {
    const cats = loadCategories();
    const maps = loadCategoryMaps();
    await sql.begin(async (tx) => {
      for (const c of cats) {
        await tx`INSERT INTO category (code, group_code, name_vi, name_en, icon, rank) VALUES (${c.code}, ${c.group}, ${c.vi}, ${c.en}, ${c.icon}, ${c.rank})
          ON CONFLICT (code) DO UPDATE SET group_code = EXCLUDED.group_code, name_vi = EXCLUDED.name_vi, name_en = EXCLUDED.name_en, icon = EXCLUDED.icon, rank = EXCLUDED.rank`;
      }
      await tx`DELETE FROM category_map`;
      for (const [source, m] of Object.entries(maps)) {
        for (const [value, code] of m)
          await tx`INSERT INTO category_map (source, source_value, code) VALUES (${source}, ${value}, ${code})`;
      }
    });
    const [row] = await sql`SELECT count(*)::int AS n FROM category`;
    console.log(`✓ category ${row?.n ?? 0} mã; category_map ${maps.osm.size + maps.fsq.size} dòng`);
  } finally {
    await sql.end();
  }
}
