// Tên và liên hệ lấy từ tag OSM (plan 2026-09-26, Task 3). Đo 26/09/2026 trên OSM 25/09/2026:
// 37.428 POI bị bỏ vì thiếu `name`; tên dự phòng gỡ được ~6,7–7,7 nghìn; thêm name:vi/short_name/
// loc_name/int_name vào tên thay thế làm 1.556 POI tìm được thêm.
import { normalizeVi } from '@mapslibvn/core';
import { loadCategories } from '../taxonomy.mjs';
import { atmName } from './vn-banks.mjs';

/** Chữ Hán/Kana/Hangul: không nhận làm tên (rủi ro tên nước ngoài ở vùng biên, chủ quyền). */
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;

/** Giá trị nhiều phần của OSM ngăn bằng ";". @param {unknown} value @returns {string[]} */
export function splitNames(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Tên hiển thị: phần đầu của `name`; phần sau ";" (32 POI) thành tên thay thế thay vì bị
 * normalizeVi gộp thành một chuỗi không khớp truy vấn nào.
 * @param {Record<string, unknown>} tags
 */
export function osmDisplayName(tags) {
  const [name = null, ...extraAlt] = splitNames(tags.name);
  return { name, extraAlt };
}

const ALT_KEYS = [
  'name:en',
  'alt_name',
  'old_name',
  'official_name',
  'name:vi',
  'short_name',
  'loc_name',
  'int_name',
];

/**
 * @param {Record<string, unknown>} tags
 * @param {string} name tên hiển thị
 * @param {string[]} [extra] phần sau ";" của name
 */
export function osmNameAlt(tags, name, extra = []) {
  /** @type {string[]} */
  const out = [];
  for (const value of [...extra, ...ALT_KEYS.flatMap((k) => splitNames(tags[k]))]) {
    if (value === name || CJK.test(value) || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

// ---- tên dự phòng ----

const GENERIC_WORDS =
  'atm|pos|may pos|industry pond|industrial pond|fish pond|toll plaza|toll booth|toll gate|tram thu phi|lake|pond|river|mountain|hill|island|cave|waterfall|beach|ao|song|suoi|nui|doi|dao|hon|thac|hang|bai bien|bank|cash machine|fuel|fuel station|gas station|petrol station|petrol|gas|xang|xang dau|tram xang|cay xang|cua hang xang dau|hotel|hostel|guest house|guesthouse|homestay|motel|resort|villa|apartment|apartments|restaurant|cafe|coffee|coffee shop|coffee bar|ca phe|quan cafe|quan ca phe|tea|tra sua|milk tea|juice|bakery|food|local food|street food|fast food|noodle|noodles|pho|bun|com|banh mi|seafood|vegetarian|bbq|hotpot|lau|quan nhau|quan an|nha hang|beer|bia|bia hoi|bar|pub|karaoke|spa|massage|beauty salon|salon|hair salon|barber|barber shop|nail|nails|laundry|car wash|rua xe|repair|car repair|motorbike repair|bike repair|sua xe|mechanic|mobile shop|phone shop|clothes|clothing|clothing store|fashion|shoes|shoe shop|grocery|convenience|convenience store|tap hoa|cua hang|shop|store|market|cho|supermarket|mini mart|minimart|mini market|sieu thi|mall|shopping mall|tailor|kids shop|parking|car parking|car park|bike parking|motorbike parking|bai do xe|bai giu xe|giu xe|toilet|toilets|wc|public toilet|restroom|nha ve sinh|temple|pagoda|church|chua|den|mieu|dinh|nha tho|shrine|cemetery|nghia trang|monument|memorial|statue|tomb|ruins|museum|park|garden|playground|swimming pool|pool|gate|entrance|information|tourist information|ticket|ticket office|tour|travel agency|rental|bike rental|motorbike rental|camp site|campsite|picnic site|gym|fitness|stadium|pitch|football|football field|san bong|school|kindergarten|hospital|clinic|pharmacy|drugstore|nha thuoc|hieu thuoc|dentist|doctor|police|post office|office|company|factory|warehouse|viewpoint|view point|attraction|khach san|nha nghi|unnamed|no name|noname|none|khong ten|test';
const GENERIC = new Set([
  ...GENERIC_WORDS.split('|'),
  ...loadCategories().flatMap((c) => [normalizeVi(c.vi), normalizeVi(c.en)]),
]);

/** Tên chỉ là loại địa điểm (kể cả kèm số: "Parking 3", "ATM 2"). @param {string} value */
export function isGeneric(value) {
  const n = normalizeVi(value);
  if (n.length < 2 || GENERIC.has(n)) return true;
  const stripped = n
    .replace(/[0-9/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length < 2 || GENERIC.has(stripped);
}

/** name:en dạng mô tả: dài, có dấu câu kết câu, hoặc ≥ 7 từ. @param {string} value */
const isDescription = (value) =>
  value.length > 40 ||
  /[!?]/.test(value) ||
  /\.\s+\S/.test(value) ||
  value.trim().split(/\s+/).length >= 7;

/** Nhóm được dùng nhãn loại làm tên khi thiếu tên — cũng không lấy brand/operator làm tên. */
export const UNNAMED_OK = new Set([
  'transport',
  'public_admin',
  'health',
  'education',
  'religion_community',
]);
/** Loại mà tên đơn vị vận hành chính là tên địa điểm. */
const OPERATOR_AS_NAME = new Set(['fuel', 'bank']);

/** @param {unknown} value @param {{ en?: boolean }} [opts] @returns {string | null} */
function usable(value, opts = {}) {
  const first = splitNames(value)[0];
  if (!first || CJK.test(first) || isGeneric(first)) return null;
  if (opts.en && isDescription(first)) return null;
  return first;
}

/**
 * Tên cho POI OSM thiếu tag `name`, hoặc null. Thứ tự name:vi → name:en → brand → operator; không
 * dùng tên ngoại ngữ khác (name:zh, name:ru…).
 * @param {Record<string, unknown>} tags
 * @param {string} category mã category đã ánh xạ
 * @param {string} [group] nhóm của category
 */
export function osmFallbackName(tags, category, group = '') {
  if (category === 'atm') return atmName(/** @type {Record<string, string>} */ (tags));
  const byName = usable(tags['name:vi']) ?? usable(tags['name:en'], { en: true });
  if (byName || UNNAMED_OK.has(group)) return byName;
  return (
    usable(tags.brand) ?? (OPERATOR_AS_NAME.has(category) ? usable(tags.operator) : null) ?? null
  );
}

/**
 * Tên cho một POI OSM: `name` (phần đầu nếu có ";") → tên dự phòng → nhãn loại (chỉ nhóm
 * UNNAMED_OK và chỉ loại cụ thể). Loại `*_other` không có tên thì bỏ: nhãn "Tôn giáo, cộng đồng
 * khác" không phải tên, và đúng lối này 1.000 node rác `office=religion` (Quảng Ngãi, 10/2025)
 * thành 1.000 POI.
 * @param {Record<string, unknown>} tags
 * @param {{ code: string, group: string }} cat
 * @param {(code: string) => string} labelFor nhãn tiếng Việt của mã category
 * @returns {{ name: string, extraAlt: string[] } | null}
 */
export function resolveOsmName(tags, cat, labelFor) {
  const shown = osmDisplayName(tags);
  const name = shown.name ?? osmFallbackName(tags, cat.code, cat.group);
  if (name) return { name, extraAlt: shown.extraAlt };
  if (!UNNAMED_OK.has(cat.group) || cat.code.endsWith('_other')) return null;
  return { name: labelFor(cat.code), extraAlt: [] };
}

// ---- email ----

/** Hộp thư miễn phí: nhiều khả năng là hộp thư cá nhân (Luật 91/2025/QH15) — không phát hành. */
const FREE_MAIL =
  /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|mail|yandex|qq|163|126|proton|protonmail|gmx)\.[a-z.]+$/;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** @param {Record<string, unknown>} tags @returns {string[]} */
export function osmEmails(tags) {
  /** @type {string[]} */
  const out = [];
  for (const raw of [...splitNames(tags.email), ...splitNames(tags['contact:email'])]) {
    const email = raw.toLowerCase();
    if (!EMAIL.test(email) || FREE_MAIL.test(email) || out.includes(email)) continue;
    out.push(email);
  }
  return out;
}
