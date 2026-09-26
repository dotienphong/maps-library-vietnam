// Luật cho POI sinh từ khoá OSM mở rộng 26/09/2026 (place, natural, waterway, landuse, man_made,
// barrier, highway, junction) — plan docs/superpowers/plans/2026-09-26-lam-giau-poi-lam-ngay.md Task 4.
// Đo trên OSM 25/09/2026: 37.586 ứng viên có tên → ~26 nghìn sau các luật dưới đây.
import { normalizeVi } from '@mapslibvn/core';

/** Mã category chỉ sinh ra từ khoá mở rộng. */
export const EXTENDED_CODES = new Set([
  'hamlet',
  'neighbourhood',
  'locality',
  'residential_area',
  'industrial_zone',
  'commercial_area',
  'place_other',
  'square',
  'island',
  'mountain',
  'lake',
  'river',
  'cave',
  'waterfall',
  'lighthouse',
  'border_gate',
  'rest_area',
  'junction',
]);

/**
 * Gom bản ghi OSM cùng tên + cùng mã trong 1 km (records.mjs): trạm thu phí vẽ mỗi làn một node
 * (818 node, ~350 trạm), hồ/sông/đảo vẽ nhiều polygon cùng tên.
 */
export const SAME_NAME_DEDUPE_CODES = [
  'toll_booth',
  'border_gate',
  'rest_area',
  'lake',
  'river',
  'island',
  'mountain',
  'junction',
];

/** Không vẽ lên POI tiles: bản đồ nền đã có nhãn nơi chốn/mặt nước; nút giao chỉ để tìm kiếm. */
export const TILE_EXCLUDED_GROUPS = ['place'];
export const TILE_EXCLUDED_CODES = ['lake', 'river', 'island', 'junction'];

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
/** "Thôn 3", "Khu phố 4", "Ấp 2", "Tổ dân phố 5", "KP 3", "Tổ 7A": vô nghĩa khi không kèm xã. */
const NUMBERED_PLACE =
  /^(thon|xom|ap|to|to dan pho|tdp|khu pho|kp|khu|ban|buon|lang|doi|cum|khoi|phum|soc|khom|plei|bon)\s*\d+[a-z]?$/;
/** Tên nút giao người Việt hay dùng để chỉ đường. */
const JUNCTION_NAME =
  /^(nga (ba|tu|nam|sau|bay)|nga\s|vong xoay|vong xuyen|bung binh|nut giao|cong truong)/;
const ADMIN_PREFIX = /^(tinh|thanh pho|tp|quan|huyen|thi xa|phuong|xa|thi tran|dac khu)\s+/;

/** Tên hành chính đã bỏ tiền tố cấp. @param {string} value */
export function adminCore(value) {
  return normalizeVi(value).replace(ADMIN_PREFIX, '');
}

/**
 * Luật chặn cho bản ghi mà loại suy ra từ khoá mở rộng (`ext`); bản ghi khác đi luật cũ.
 * @param {{ tags: Record<string, unknown>, name: string, cat: { code: string, group: string },
 *   ext: boolean, adminCores?: Set<string> | undefined, inCommune?: boolean | undefined }} input
 *   `adminCores`: tên (đã bỏ tiền tố) các xã/phường chứa đối tượng; `inCommune`: có nằm trong một
 *   xã/phường hiện hành không (undefined khi chưa có bảng hành chính).
 */
export function extendedAllowed({ tags, name, cat, ext, adminCores, inCommune }) {
  if (!ext) return true;
  // Luật Đo đạc và Bản đồ 2018: không công bố đối tượng quân sự.
  if (tags.landuse === 'military' || tags.military !== undefined) return false;
  // Vùng đệm 2 km của deleteOutsideVn còn làng/núi bên kia biên giới (338 ứng viên, đo 26/09).
  if (inCommune === false) return false;
  if (CJK.test(name)) return false;
  const norm = normalizeVi(name);
  if (cat.code === 'junction') return JUNCTION_NAME.test(norm);
  if (cat.group === 'place') {
    if (NUMBERED_PLACE.test(norm)) return false;
    if (adminCores?.has(adminCore(name))) return false;
  }
  return true;
}

/** Khoá POI trước 26/09/2026: đối tượng mang một khoá này thì loại không đến từ khoá mở rộng. */
export const LEGACY_POI_KEYS = [
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
];
const LEGACY_KEYS = [...LEGACY_POI_KEYS, 'addr:housenumber'];

/** Loại của đối tượng chỉ có thể đến từ khoá mở rộng. @param {Record<string, unknown>} tags */
export function fromExtendedKey(tags) {
  return !LEGACY_POI_KEYS.some((k) => tags[k] !== undefined);
}

/**
 * Ao hồ, khu dân cư, nghĩa trang… vô danh có hàng trăm nghìn đối tượng: chỉ giữ đối tượng mang
 * khoá mở rộng khi có ít nhất một tag tên (name, name:*), vì records.mjs không nhận chúng nếu không tên.
 * @param {Record<string, unknown>} tags
 */
export function keepSourceFeature(tags) {
  if (LEGACY_KEYS.some((k) => tags[k] !== undefined)) return true;
  return Object.keys(tags).some((k) => k === 'name' || k.startsWith('name:'));
}
