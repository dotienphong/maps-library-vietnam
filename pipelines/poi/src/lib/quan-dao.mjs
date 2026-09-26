// Hai quần đảo Hoàng Sa / Trường Sa (PHONG chốt 26/09/2026, plan 2026-09-26-quan-dao-truong-sa-hoang-sa).
// Vùng đọc từ data/quan-dao.geojson MỖI lần chạy và truyền vào SQL dạng GeoJSON — cố ý KHÔNG nằm trong
// vn_boundary: bảng đó chỉ nạp một lần (sửa không tới được production), và bootstrapMissingProvince dùng nó
// để dựng Khánh Hòa, nên nới nó sẽ kéo relation hành chính của nước khác trong vùng vào tỉnh.
import { readFileSync } from 'node:fs';
import { QUAN_DAO } from './env.mjs';

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
