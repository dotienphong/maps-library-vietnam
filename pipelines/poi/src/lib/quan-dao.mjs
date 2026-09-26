// Hai quần đảo Hoàng Sa / Trường Sa (PHONG chốt 26/09/2026, plan 2026-09-26-quan-dao-truong-sa-hoang-sa).
// Vùng đọc từ data/quan-dao.geojson MỖI lần chạy và truyền vào SQL dạng GeoJSON — cố ý KHÔNG nằm trong
// vn_boundary: bảng đó chỉ nạp một lần (sửa không tới được production), và bootstrapMissingProvince dùng nó
// để dựng Khánh Hòa, nên nới nó sẽ kéo relation hành chính của nước khác trong vùng vào tỉnh.
import { readFileSync } from 'node:fs';
import { copyInto } from '../pg.mjs';
import { ewkt, pgJson } from './copy-format.mjs';
import { QUAN_DAO, QUAN_DAO_DAO, QUAN_DAO_OSM, QUAN_DAO_TA_GIU } from './env.mjs';

/**
 * Chữ Hán/Kana/Hangul, kể cả chữ tương thích (U+F900–FAFF) và mặt phẳng mở rộng (Ext-B…). Viết bằng mã
 * escape: ký tự tương thích dán thẳng vào nguồn bị chuẩn hoá NFC thành chữ khác, làm lệch dải.
 */
export const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\u{20000}-\u{3134f}]/u;
/** Có dấu tiếng Việt (hoặc đ) — tên không dấu ("An Bang", "Cay") không phân biệt được với tên nước ngoài. */
const CO_DAU = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/iu;
const PHU_AM_DAU = [
  'ngh',
  'ch',
  'gh',
  'gi',
  'kh',
  'ng',
  'nh',
  'ph',
  'qu',
  'th',
  'tr',
  'b',
  'c',
  'd',
  'đ',
  'g',
  'h',
  'k',
  'l',
  'm',
  'n',
  'p',
  'r',
  's',
  't',
  'v',
  'x',
  '',
];
/** Vần chính của tiếng Việt (đã bỏ dấu thanh, giữ ă â ê ô ơ ư), dài trước ngắn sau. */
const VAN = [
  'uyê',
  'uyu',
  'uya',
  'iêu',
  'yêu',
  'oai',
  'oay',
  'oao',
  'oeo',
  'uây',
  'uôi',
  'ươi',
  'ươu',
  'ai',
  'ao',
  'au',
  'ay',
  'âu',
  'ây',
  'eo',
  'êu',
  'ia',
  'iê',
  'iu',
  'oa',
  'oă',
  'oe',
  'oi',
  'ôi',
  'ơi',
  'ua',
  'uâ',
  'uê',
  'ui',
  'uô',
  'uơ',
  'uy',
  'ưa',
  'ưi',
  'ươ',
  'ưu',
  'yê',
  'a',
  'ă',
  'â',
  'e',
  'ê',
  'i',
  'o',
  'ô',
  'ơ',
  'u',
  'ư',
  'y',
];
const PHU_AM_CUOI = ['ch', 'ng', 'nh', 'c', 'm', 'n', 'p', 't', ''];

/** Bỏ dấu thanh (huyền, sắc, ngã, hỏi, nặng), giữ ă â ê ô ơ ư đ. @param {string} s */
const boDauThanh = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300\u0301\u0303\u0309\u0323]/g, '')
    .normalize('NFC');

/** Một âm tiết tiếng Việt: phụ âm đầu + vần + phụ âm cuối. @param {string} tu */
function laAmTiet(tu) {
  const w = boDauThanh(tu.toLowerCase());
  return PHU_AM_DAU.some((dau) => {
    if (!w.startsWith(dau)) return false;
    const con = w.slice(dau.length);
    if (dau === 'gi' && con === '') return true; // "gì"
    return VAN.some((van) => con.startsWith(van) && PHU_AM_CUOI.includes(con.slice(van.length)));
  });
}

/** Dấu thanh riêng của pinyin (ā ǎ ē ě ī ǐ ō ǒ ū ǔ ü ǖ ǘ ǚ ǜ): có là tên phiên âm tiếng Trung. */
const PINYIN = /[āǎēěīǐōǒūǔüǖǘǚǜ]/iu;

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
 * Tên tiếng Việt: MỌI từ là âm tiết tiếng Việt (hoặc số, chữ viết tắt in hoa), có ít nhất một dấu, không chữ
 * Hán/Kana/Hangul, không dấu pinyin. Dấu sắc/huyền dùng chung với pinyin và tiếng Pháp nên dấu thôi không đủ:
 * "Parola", "Pag-asa", "Layang", "Récif", "Tàipíng" rơi ở luật âm tiết; "Chùa Vinh Phúc", "Hòn Tháp" qua.
 * Tên không dấu ("An Bang") không nhận — nơi gọi dùng name:vi hoặc danh sách duyệt.
 * @param {string | null | undefined} ten
 */
export function laTenViet(ten) {
  if (!tenAnToan(ten) || !CO_DAU.test(String(ten))) return false;
  const tu = String(ten)
    .split(/[\s\-–—(),./:;"'“”]+/u)
    .filter(Boolean);
  // Mọi từ là âm tiết tiếng Việt, số, hoặc chữ viết tắt/ký hiệu in hoa (UBND, VNCH, "Đá Tây A").
  return (
    tu.length > 0 && tu.every((w) => /^\d+$/.test(w) || /^[A-ZĐ]{1,6}$/u.test(w) || laAmTiet(w))
  );
}

/**
 * Không chữ Hán/Kana/Hangul, không dấu pinyin. Dùng cho tên trong danh sách duyệt: tên người duyệt ghi có thể
 * hợp lệ mà thiếu chữ riêng tiếng Việt ("Hòn Tháp"), nên chỉ chặn chữ nước ngoài.
 * @param {string | null | undefined} ten
 */
export function tenAnToan(ten) {
  return Boolean(ten) && !CJK.test(String(ten)) && !PINYIN.test(String(ten));
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

/** @param {{ lon: number, lat: number }} f @param {NguCanh} ctx */
const trongVongTaGiu = (f, ctx) =>
  ctx.taGiu.some((c) => khoangCachM(f.lon, f.lat, c.lon, c.lat) <= c.banKinhM);

/** Tag quân sự, hoặc do quân đội vận hành (Luật Đo đạc và Bản đồ 2018: không công bố đối tượng quân sự). */
const laQuanSu = (/** @type {Record<string, string>} */ t) =>
  t.military !== undefined ||
  t.landuse === 'military' ||
  /army|navy|military|quân đội|hải quân|quân chủng|bộ quốc phòng|bộ đội/i.test(t.operator ?? '');

/** Hòn đảo/bãi/rạn: chỉ giữ place/natural loại đảo và tên — không một tag cơ sở nào (sân bay, cơ quan…). */
function tenDao(/** @type {Record<string, string>} */ t, /** @type {DaoDuyet} */ duyet) {
  const loai = LA_DAO(t)
    ? Object.fromEntries(Object.entries(t).filter(([k]) => k === 'place' || k === 'natural'))
    : { place: 'island' };
  return datTen(loai, duyet.ten, duyet.tenKhac);
}

/**
 * Chính sách PHONG chốt 26/09/2026. Đảo/bãi/rạn: chỉ khi có trong danh sách duyệt, tên Việt ghi đè
 * (name:vi ở Hoàng Sa và đá nước khác chiếm phần lớn là phiên âm tên TQ), chỉ giữ tag loại đảo. Cơ sở:
 * chỉ trong vòng ta giữ ở Trường Sa, tên tiếng Việt, không quân sự; Hoàng Sa và đá nước khác chiếm không
 * nhận cơ sở nào. Hàng duyệt có `ten` rỗng = loại trừ.
 * @param {DoiTuong} f @param {NguCanh} ctx
 * @returns {{ tags: Record<string, string> } | null}
 */
export function chinhSach(f, ctx) {
  const vung = vungCua(f.lon, f.lat);
  if (!vung) return null;
  const t = f.tags;
  const duyet = ctx.dao.get(`${f.osmType}${f.osmId}`);
  if (duyet) {
    if (!duyet.ten) return null;
    // Đảo trong danh sách nhận TÊN ĐẢO kể cả khi nước chiếm giữ gắn căn cứ lên đó (Đá Xu Bi, Đá Công Đo).
    // Vùng chỉ có landuse (Sinh Tồn: OSM chỉ vẽ landuse=residential) là hình của chính hòn đảo.
    if (LA_DAO(t) || !Object.keys(t).some((k) => KHOA_CO_SO.has(k)))
      return { tags: tenDao(t, duyet) };
    // Cơ sở được duyệt đích danh (sửa tên, hoặc giữ dù do quân đội vận hành): chỉ trên đảo ta giữ.
    if (duyet.nuocGiu !== 'VN' || vung === 'hoang_sa' || !trongVongTaGiu(f, ctx)) return null;
    return { tags: datTen(t, duyet.ten, duyet.tenKhac) };
  }
  if (LA_DAO(t) || vung === 'hoang_sa') return null;
  if (laQuanSu(t)) return null;
  // Vùng chỉ có landuse (landuse=residential "Đảo Nam Yết") là hình của chính hòn đảo → trùng tên đảo.
  if (!Object.keys(t).some((k) => KHOA_CO_SO.has(k))) return null;
  if (!trongVongTaGiu(f, ctx)) return null;
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

/** Cột COPY vào src_osm_place — cùng thứ tự với dòng dongQuanDao. */
const COT_SRC_OSM = ['osm_type', 'osm_id', 'name', 'names', 'tags', 'geom', 'release'];

/**
 * Nạp hai quần đảo vào bảng dàn src_osm_place_new: bỏ MỌI dòng PBF trong vùng (extract VN thiếu nửa Trường
 * Sa, patch tiles đổi tên theo luật riêng), rồi chèn ảnh chụp đã lọc. Gọi SAU deleteOutsideVn — ranh giới
 * Natural Earth dừng ở 109,47°E. Ảnh chụp rỗng thì dừng: không lặng lẽ phát hành bản không có hai quần đảo.
 * @param {import('postgres').Sql} sql @param {string} table @param {string} release @param {DongAnhChup[]} [anhChup]
 */
export async function napQuanDao(sql, table, release, anhChup = docAnhChup()) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`tên bảng không hợp lệ: ${table}`);
  await sql.unsafe(
    `DELETE FROM ${table} WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))`,
    [quanDaoGeoJson()],
  );
  const n = await copyInto(sql, table, COT_SRC_OSM, dongQuanDao(release, anhChup));
  if (n === 0) {
    throw new Error(
      'Ảnh chụp quần đảo (data/quan-dao-osm.json) không cho dòng nào — dừng, không phát hành thiếu hai quần đảo',
    );
  }
  return n;
}
