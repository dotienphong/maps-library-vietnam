// Bảng ngân hàng Việt Nam để đặt tên ATM OSM thiếu tag name (plan 2026-09-26, Task 3). So trên
// normalizeVi(brand | operator | name:en | name:vi). Đo 26/09/2026 trên OSM 25/09/2026: 1.879 ATM
// không tên gỡ được từ brand/operator, trong đó 10 % mang ngân hàng đã sáp nhập hoặc chuyển giao,
// 46 là máy POS, 177 không có dấu hiệu ngân hàng.
import { normalizeVi } from '@mapslibvn/core';

/**
 * Không đặt tên: thương hiệu đã biến mất (sáp nhập, rút khỏi), hoặc ngân hàng bị chuyển giao bắt
 * buộc 2024–2025 mà thương hiệu ATM tại điểm đó không còn chắc chắn.
 */
const GONE = [
  /\bhabu ?bank\b|nha ha noi/, // Habubank → SHB (2012)
  /\bmhb\b|nha dong bang song cuu long|mekong housing/, // MHB → BIDV (2015)
  /souther?n? ?bank|ngan hang phuong nam/, // Southern Bank → Sacombank (2015)
  /ficom ?bank|\bficom\b|ngan hang de nhat/, // Ficombank → SCB (2011)
  /tin ?nghia/, // TinNghiaBank → SCB (2011)
  /western ?bank|ngan hang phuong tay/, // Western Bank → PVcomBank (2013)
  /mekong development|\bmdb\b|phat trien me ?kong/, // MDB → Maritime Bank (2015)
  /trust ?bank|dai tin/, // TrustBank/Đại Tín → CB (2015)
  /dai ?a ?bank|ngan hang dai a/, // Đại Á → HDBank (2013)
  /\banz\b/, // ANZ bán mảng bán lẻ (2017)
  /\bciti ?bank\b|\bciti\b/, // Citibank bán mảng bán lẻ (2022–2023)
  /dong ?a ?bank|\bdonga\b|\beab\b|ngan hang dong a|\bdong a\b/, // DongA/EAB → chuyển giao (2025)
  /ocean ?bank|ngan hang dai duong/, // OceanBank → chuyển giao MB (2024–2025)
  /\bvncb\b|\bcb ?bank\b|\bcb\b|ngan hang xay dung|construction bank/, // CB → chuyển giao (2024)
  /\bgp ?bank\b|dau khi toan cau|global petro/, // GPBank → chuyển giao (2025)
];

/** [tên hiển thị, mẫu]. Ngân hàng đổi thương hiệu vẫn hoạt động được ghi dưới tên mới. */
const ACTIVE = /** @type {const} */ ([
  ['MSB', /\bmsb\b|maritime|ngan hang hang hai|hang hai viet nam/],
  ['LPBank', /\blp ?bank\b|lien ?viet|buu dien lien viet/],
  ['NCB', /\bncb\b|navi ?bank|ngan hang nam viet|quoc dan/],
  ['BVBank', /\bbv ?bank\b|viet ?capital|ngan hang ban viet/],
  ['Vietcombank', /vietcombank|\bvcb\b|ngoai thuong/],
  ['BIDV', /\bbidv\b|dau tu va phat trien/],
  ['Agribank', /agribank|nong nghiep va phat trien nong thon/],
  ['VietinBank', /vietin ?bank|\bvietin\b|cong thuong viet nam/],
  ['Techcombank', /techcombank|\btcb\b|ky thuong/],
  ['ACB', /\bacb\b|a chau/],
  ['Sacombank', /sacombank|sai gon thuong tin/],
  ['MB', /\bmb ?bank\b|\bmb\b|ngan hang quan doi/],
  ['VPBank', /\bvp ?bank\b|viet nam thinh vuong/],
  ['TPBank', /\btp ?bank\b|tien phong/],
  ['SHB', /\bshb\b|sai gon ?- ?ha noi/],
  ['HDBank', /\bhd ?bank\b|phat trien thanh pho ho chi minh/],
  ['VIB', /\bvib\b|quoc te viet nam/],
  ['Eximbank', /exim ?bank|xuat nhap khau/],
  ['OCB', /\bocb\b|phuong dong/],
  ['SeABank', /sea ?bank|dong nam a/],
  ['ABBank', /\bab ?bank\b|an binh/],
  ['Nam A Bank', /nam ?a ?bank|ngan hang nam a/],
  ['Bac A Bank', /bac ?a ?bank|ngan hang bac a/],
  ['PVcomBank', /pv ?com ?bank|dai chung/],
  ['Saigonbank', /saigon ?bank|sai gon cong thuong/],
  ['SCB', /\bscb\b|ngan hang (tmcp )?sai gon(?! ?(thuong tin|cong thuong|-))/],
  ['KienlongBank', /kien ?long/],
  ['Viet A Bank', /viet ?a ?bank|ngan hang viet a/],
  ['Vietbank', /\bvietbank\b|viet nam thuong tin/],
  ['BaoVietBank', /bao ?viet ?bank|ngan hang bao viet/],
  ['PGBank', /\bpg ?bank\b|thinh vuong va phat trien/],
  ['HSBC', /\bhsbc\b/],
  ['Standard Chartered', /standard chartered/],
  ['Shinhan Bank', /shinhan/],
  ['Woori Bank', /\bwoori\b/],
  ['UOB', /\buob\b/],
  ['Public Bank', /public bank/],
  ['CIMB', /\bcimb\b/],
  ['Indovina Bank', /indovina|\bivb\b/],
  ['Hong Leong Bank', /hong leong/],
  ['VRB', /\bvrb\b|viet nga/],
  ['Vikki Bank', /\bvikki\b/],
  ['MBV', /\bmbv\b/],
  ['Co-opBank', /co ?op ?bank|hop tac xa viet nam/],
]);

/**
 * Tên ATM từ tag, hoặc null khi không chắc là ATM của một ngân hàng còn hoạt động.
 * @param {Record<string, string | undefined>} tags
 * @returns {string | null}
 */
export function atmName(tags) {
  const text = normalizeVi(
    [tags.brand, tags.operator, tags['name:en'], tags['name:vi']].filter(Boolean).join(' | '),
  );
  if (!text) return null;
  if (/\bpos\b/.test(text)) return null; // máy POS gắn nhầm amenity=atm
  if (GONE.some((re) => re.test(text))) return null;
  const hit = ACTIVE.find(([, re]) => re.test(text));
  return hit ? `ATM ${hit[0]}` : null;
}
