// Hai quần đảo Hoàng Sa / Trường Sa (PHONG chốt 26/09/2026, plan 2026-09-26-quan-dao-truong-sa-hoang-sa).
// Vùng đọc từ data/quan-dao.geojson MỖI lần chạy và truyền vào SQL dạng GeoJSON — cố ý KHÔNG nằm trong
// vn_boundary: bảng đó chỉ nạp một lần (sửa không tới được production), và bootstrapMissingProvince dùng nó
// để dựng Khánh Hòa, nên nới nó sẽ kéo relation hành chính của nước khác trong vùng vào tỉnh.
import { readFileSync } from 'node:fs';
import { ewkt, pgJson } from './copy-format.mjs';
import { QUAN_DAO, QUAN_DAO_DAO, QUAN_DAO_OSM, QUAN_DAO_TA_GIU } from './env.mjs';

/** Chữ Hán/Kana/Hangul — cùng dải với luật CJK của osm-extended.mjs và patch_sovereignty.py. */
export const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
/** Chữ cái riêng của tiếng Việt: đ, ă/â/ê/ô/ơ/ư và nguyên âm mang dấu thanh. */
const CHU_VIET = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i;

/**
 * @typedef {{ region: 'hoang_sa' | 'truong_sa', ten: string, tinh: string,
 *   ring: [number, number][] }} VungQuanDao
 */

/** @type {VungQuanDao[] | undefined} */
let cache;

/** @returns {VungQuanDao[]} */
export function vungQuanDao() {
  cache ??= JSON.parse(readFileSync(QUAN_DAO, 'utf8')).features.map((/** @type {any} */ f) => ({
    region: f.properties.region,
    ten: f.properties.ten,
    tinh: f.properties.tinh,
    ring: f.geometry.coordinates[0],
  }));
  return /** @type {VungQuanDao[]} */ (cache);
}

/** MultiPolygon GeoJSON của cả hai vùng, để truyền vào SQL (`ST_GeomFromGeoJSON`). */
export function quanDaoGeoJson() {
  return JSON.stringify({
    type: 'MultiPolygon',
    coordinates: vungQuanDao().map((v) => [v.ring]),
  });
}

/** @param {number} lon @param {number} lat @param {[number, number][]} ring */
function trongVong(lon, lat, ring) {
  let trong = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = /** @type {[number, number]} */ (ring[i]);
    const [xj, yj] = /** @type {[number, number]} */ (ring[j]);
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) trong = !trong;
  }
  return trong;
}

/**
 * @param {number} lon @param {number} lat
 * @returns {'hoang_sa' | 'truong_sa' | null}
 */
export function vungCua(lon, lat) {
  return vungQuanDao().find((v) => trongVong(lon, lat, v.ring))?.region ?? null;
}

/**
 * Tên tiếng Việt: có chữ cái riêng của tiếng Việt và không có chữ Hán/Kana/Hangul. Tên không dấu
 * ("An Bang") không phân biệt được với tên Latin nước ngoài ("Parola") nên không nhận — trừ khi có
 * name:vi, việc đó do nơi gọi quyết định.
 * @param {string | null | undefined} ten
 */
export function laTenViet(ten) {
  return (
    Boolean(ten) &&
    CHU_VIET.test(/** @type {string} */ (ten)) &&
    !CJK.test(/** @type {string} */ (ten))
  );
}

/**
 * @typedef {{ ten: string, tenKhac: string, nuocGiu: 'VN' | 'CN' | 'PH' | 'TW' | 'MY' }} DaoDuyet
 * @typedef {{ ten: string, lon: number, lat: number, banKinhM: number }} CumTaGiu
 * @typedef {{ dao: Map<string, DaoDuyet>, taGiu: CumTaGiu[] }} NguCanh
 * @typedef {{ osmType: string, osmId: string, lon: number, lat: number,
 *   tags: Record<string, string> }} DoiTuong
 */

/** data/quan-dao-dao.csv: `osm,ten,ten_khac,nuoc_giu,ghi_chu` (ghi_chu được có dấu phẩy). @returns {Map<string, DaoDuyet>} */
export function docDao(text = readFileSync(QUAN_DAO_DAO, 'utf8')) {
  const [header, ...lines] = text.trim().split('\n');
  if (header !== 'osm,ten,ten_khac,nuoc_giu,ghi_chu')
    throw new Error(`quan-dao-dao.csv: header lạ "${header}"`);
  return new Map(
    lines
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => {
        const [osm = '', ten = '', tenKhac = '', nuocGiu = ''] = line.split(',');
        return [osm, { ten, tenKhac, nuocGiu: /** @type {DaoDuyet['nuocGiu']} */ (nuocGiu) }];
      }),
  );
}

/** @returns {CumTaGiu[]} */
export function docTaGiu() {
  return JSON.parse(readFileSync(QUAN_DAO_TA_GIU, 'utf8')).cum;
}

/** @param {number} lon1 @param {number} lat1 @param {number} lon2 @param {number} lat2 → mét */
export function khoangCachM(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180;
  const x = (lon2 - lon1) * r * Math.cos(((lat1 + lat2) / 2) * r);
  const y = (lat2 - lat1) * r;
  return Math.hypot(x, y) * 6_371_000;
}

/**
 * Chỉ giữ tag pipeline thật sự dùng (loại, liên hệ, giờ, địa chỉ). Danh sách trắng chứ không đen:
 * note/is_in/operator/source/wikipedia/inscription ở vùng này hay mang tên hoặc chủ thể nước ngoài
 * ("administered by the Philippines", bia chủ quyền chữ Hán) mà không tag nào trong số đó cần cho POI.
 */
const TAG_GIU =
  /^(amenity|shop|tourism|leisure|office|craft|healthcare|historic|public_transport|aeroway|railway|natural|waterway|place|landuse|man_made|barrier|highway|junction|religion|denomination|cuisine|sport|opening_hours|phone|website|contact:(phone|website|email)|addr:(housenumber|street))$/;
/** Khoá xác định một cơ sở/địa điểm (không tính landuse: ở đảo nó là hình của chính hòn đảo). */
const KHOA_CO_SO = new Set([
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
  'man_made',
  'place',
  'natural',
  'waterway',
  'barrier',
]);
/** place/natural của chính hòn đảo, bãi, rạn — chỉ nhận khi có trong danh sách duyệt. */
const LA_DAO = (/** @type {Record<string, string>} */ t) =>
  ['island', 'islet'].includes(t.place ?? '') ||
  ['reef', 'shoal', 'bare_rock'].includes(t.natural ?? '');

/** @param {Record<string, string>} tags @param {string} ten @param {string} [tenKhac] */
function datTen(tags, ten, tenKhac) {
  const giu = Object.fromEntries(
    Object.entries(tags).filter(
      ([k, v]) => TAG_GIU.test(k) && !(k === 'landuse' && v === 'military'),
    ),
  );
  return { ...giu, name: ten, 'name:vi': ten, ...(tenKhac ? { alt_name: tenKhac } : {}) };
}

/**
 * Chính sách PHONG chốt 26/09/2026. Đảo/bãi/rạn: chỉ khi có trong danh sách duyệt, tên Việt ghi đè
 * (name:vi ở Hoàng Sa và đá nước khác chiếm phần lớn là phiên âm tên TQ). Cơ sở: chỉ trong vòng ta
 * giữ ở Trường Sa, tên tiếng Việt, không gắn quân sự; Hoàng Sa không nhận cơ sở nào.
 * @param {DoiTuong} f @param {NguCanh} ctx
 * @returns {{ tags: Record<string, string> } | null}
 */
export function chinhSach(f, ctx) {
  const vung = vungCua(f.lon, f.lat);
  if (!vung) return null;
  const t = f.tags;
  // Đảo trong danh sách duyệt nhận TÊN ĐẢO kể cả khi nước chiếm giữ gắn căn cứ lên đó (Đá Xu Bi, Đá Công
  // Đo); datTen bỏ tag quân sự. Luật quân sự (Luật Đo đạc 2018) áp cho cơ sở ở dưới.
  const duyet = ctx.dao.get(`${f.osmType}${f.osmId}`);
  if (duyet) return { tags: datTen(t, duyet.ten, duyet.tenKhac) };
  if (LA_DAO(t) || vung === 'hoang_sa') return null;
  if (t.military !== undefined || t.landuse === 'military') return null;
  // Vùng chỉ có landuse (landuse=residential "Đảo Nam Yết") là hình của chính hòn đảo → trùng tên đảo.
  if (!Object.keys(t).some((k) => KHOA_CO_SO.has(k))) return null;
  if (!ctx.taGiu.some((c) => khoangCachM(f.lon, f.lat, c.lon, c.lat) <= c.banKinhM)) return null;
  const ten = [t['name:vi'], t.name].find((x) => laTenViet(x));
  return ten ? { tags: datTen(t, ten) } : null;
}

/**
 * @typedef {{ osm_type: string, osm_id: string, lon: number, lat: number,
 *   tags: Record<string, string> }} DongAnhChup
 */

/** @returns {DongAnhChup[]} */
export function docAnhChup() {
  return JSON.parse(readFileSync(QUAN_DAO_OSM, 'utf8')).doi_tuong;
}

/**
 * Dòng COPY vào src_osm_place (cùng cột với rows() của ingest/osm.mjs) từ ảnh chụp hai quần đảo. Chạy lại
 * chinhSach: ảnh chụp đã lọc lúc dựng, nhưng file commit có thể bị sửa tay — phòng thủ ở đúng chỗ nạp.
 * @param {string} release @param {DongAnhChup[]} [anhChup] @param {NguCanh} [ctx]
 */
export function* dongQuanDao(
  release,
  anhChup = docAnhChup(),
  ctx = { dao: docDao(), taGiu: docTaGiu() },
) {
  for (const d of anhChup) {
    const out = chinhSach(
      { osmType: d.osm_type, osmId: d.osm_id, lon: d.lon, lat: d.lat, tags: d.tags },
      ctx,
    );
    if (!out) continue;
    const names = Object.fromEntries(
      Object.entries(out.tags).filter(([k]) => k === 'name' || k.startsWith('name:')),
    );
    yield [
      d.osm_type,
      d.osm_id,
      out.tags.name ?? null,
      pgJson(names),
      pgJson(out.tags),
      ewkt(d.lon, d.lat),
      release,
    ];
  }
}
