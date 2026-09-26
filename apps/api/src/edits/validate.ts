import { normalizeVi } from '@mapslibvn/core';
import { ApiError } from '../errors';

export type EditKind = 'create' | 'update' | 'close' | 'reopen' | 'report';
const KINDS: readonly EditKind[] = ['create', 'update', 'close', 'reopen', 'report'];

/** Bbox VN nới rộng (gồm đảo): chặn toạ độ rác, không thay kiểm định địa lý. */
const LAT_RANGE = [7.8, 23.6] as const;
const LNG_RANGE = [101.8, 117.4] as const;

/** Trường changes người dùng được gửi (cột poi, trừ trường hệ thống). */
const TEXT_FIELDS = [
  'name',
  'category',
  'housenumber',
  'street',
  'ward',
  'province',
  'address_text',
] as const;

/** Giá trị JSON hợp lệ trong changes — khớp JSONValue của porsager để `sql.json()` nhận được. */
export type EditChangeValue =
  | string
  | number
  | boolean
  | null
  | EditChangeValue[]
  | { [key: string]: EditChangeValue };
export type EditChanges = { [key: string]: EditChangeValue };

export interface ValidatedEdit {
  kind: EditKind;
  poiId: string | null;
  /** Đã whitelist + thêm dẫn xuất name_norm/street_norm/ward_norm/province_norm (quyết định 4). */
  changes: EditChanges;
  photoUrl: string | null;
  note: string | null;
  endUserToken: string;
}

const bad = (message: string): never => {
  throw new ApiError(400, 'invalid_request', message);
};

const asRecord = (value: unknown, name: string): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : bad(`${name} phải là object`);

const optionalString = (value: unknown, name: string, max: number): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '' || value.length > max)
    bad(`${name} phải là chuỗi 1..${max} ký tự`);
  return (value as string).trim();
};

const stringArray = (
  value: unknown,
  name: string,
  item?: { ok: (value: string) => boolean; reason: string },
): string[] | undefined => {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 5 ||
    value.some((v) => typeof v !== 'string' || v.length > 200)
  )
    bad(`${name} phải là mảng ≤ 5 chuỗi`);
  const items = value as string[];
  if (item && !items.every(item.ok)) bad(`${name} ${item.reason}`);
  return items;
};

/**
 * `contact` được trả nguyên văn qua `Place.contact` cho app nhúng. Tenant internal (khoá server)
 * vẫn tự duyệt contact, và admin duyệt tay cũng không làm sạch giá trị, nên scheme thực thi được
 * (`javascript:`, `data:`, `vbscript:`) lọt vào đây là XSS lưu trữ xuyên tenant ngay trong app
 * của khách. Chỉ nhận URL tuyệt đối http/https.
 */
const isHttpUrl = (value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
};

/**
 * `hours` là trường duy nhất có đường tự duyệt (edits/rules.ts) và được trả nguyên văn cho app
 * nhúng, nên không được chở chữ tự do: SĐT, URL hay lời nhắn "đã chuyển chỗ" đội lốt giờ mở cửa.
 * Nhận đúng tập con opening_hours thường gặp — mỗi token (tách theo khoảng trắng , ;) là các
 * nguyên tử nối bằng `-`: thứ, tháng, PH/SH, HH:MM (có thể kèm `+`), ngày 1–31, năm 1900–2100,
 * off/closed/open/unknown, sunrise/sunset/dawn/dusk, 24/7.
 */
const HOURS_ATOM =
  /^(?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\[-?[1-5](?:,-?[1-5])*\])?|PH|SH|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|(?:[01]\d|2[0-4]):[0-5]\d\+?|[1-9]|[12]\d|3[01]|19\d\d|20\d\d|2100|off|closed|open|unknown|sunrise|sunset|dawn|dusk)$/;
export function isOpeningHours(value: string): boolean {
  const tokens = value
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.every((t) => t === '24/7' || t.split('-').every((atom) => HOURS_ATOM.test(atom)))
  );
}

/** Cùng luật với osmEmails() của pipeline: phần cục bộ và tên miền chỉ ký tự email thông dụng. */
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** Facebook lưu được cả handle trần (`xvn`) lẫn URL đầy đủ — chặn mọi thứ còn lại. */
const FACEBOOK_HANDLE = /^[A-Za-z0-9._-]{1,100}$/;
/** Chữ số, dấu cách và các ký tự định dạng số điện thoại. Không chữ, không dấu hai chấm. */
const PHONE = /^[+0-9 ().-]{6,20}$/;

function validateChanges(kind: EditKind, raw: Record<string, unknown>): EditChanges {
  const out: EditChanges = {};
  for (const field of TEXT_FIELDS) {
    const v = optionalString(raw[field], `changes.${field}`, 500);
    if (v !== undefined) out[field] = v;
  }
  if ((raw.lat === undefined) !== (raw.lng === undefined)) bad('lat và lng phải đi cùng nhau');
  if (raw.lat !== undefined) {
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) bad('lat/lng phải là số');
    if (lat < LAT_RANGE[0] || lat > LAT_RANGE[1] || lng < LNG_RANGE[0] || lng > LNG_RANGE[1])
      bad('lat/lng ngoài phạm vi Việt Nam');
    out.lat = lat;
    out.lng = lng;
  }
  if (raw.contact !== undefined) {
    const contact = asRecord(raw.contact, 'changes.contact');
    const clean: EditChanges = {};
    const phone = stringArray(contact.phone, 'contact.phone', {
      ok: (value) => PHONE.test(value),
      reason: 'chỉ nhận chữ số và ký tự + ( ) . - khoảng trắng, dài 6..20',
    });
    const website = stringArray(contact.website, 'contact.website', {
      ok: isHttpUrl,
      reason: 'phải là URL tuyệt đối http/https',
    });
    const facebook = optionalString(contact.facebook, 'contact.facebook', 200);
    if (facebook !== undefined && !FACEBOOK_HANDLE.test(facebook) && !isHttpUrl(facebook))
      bad('contact.facebook phải là handle hoặc URL http/https');
    // Pipeline ghi contact.email từ OSM (26/09/2026); duyệt một sửa contact THAY nguyên contact, nên
    // khách đọc–sửa–ghi phải gửi lại được email, không thì email mất vĩnh viễn.
    const email = stringArray(contact.email, 'contact.email', {
      ok: (value) => EMAIL.test(value.toLowerCase()),
      reason: 'phải là địa chỉ email hợp lệ',
    });
    if (phone) clean.phone = phone;
    if (website) clean.website = website;
    if (facebook) clean.facebook = facebook;
    if (email) clean.email = email.map((value) => value.toLowerCase());
    if (Object.keys(clean).length === 0) bad('changes.contact rỗng');
    out.contact = clean;
  }
  if (raw.hours !== undefined) {
    const osm =
      typeof raw.hours === 'string'
        ? (optionalString(raw.hours, 'changes.hours', 200) ?? bad('changes.hours rỗng'))
        : (optionalString(asRecord(raw.hours, 'changes.hours').osm, 'changes.hours.osm', 200) ??
          bad('changes.hours.osm bắt buộc'));
    if (!isOpeningHours(osm)) bad('changes.hours phải theo cú pháp opening_hours của OSM');
    out.hours = { osm };
  }
  // Dẫn xuất *_norm để hàm SQL áp dụng không cần chuẩn hoá tiếng Việt (quyết định 4).
  if (typeof out.name === 'string') out.name_norm = normalizeVi(out.name);
  if (typeof out.street === 'string') out.street_norm = normalizeVi(out.street);
  if (typeof out.ward === 'string') out.ward_norm = normalizeVi(out.ward);
  if (typeof out.province === 'string') out.province_norm = normalizeVi(out.province);

  if (kind === 'create' && (out.name === undefined || out.lat === undefined))
    bad('create cần changes.name và changes.lat/lng');
  if (kind === 'update' && Object.keys(out).length === 0)
    bad('update cần ít nhất một trường trong changes');
  return out;
}

export function validateEditBody(body: unknown): ValidatedEdit {
  const raw = asRecord(body, 'body');
  const kind = raw.kind as EditKind;
  if (!KINDS.includes(kind)) bad(`kind phải là một trong: ${KINDS.join(', ')}`);
  const endUserToken =
    optionalString(raw.end_user_token, 'end_user_token', 128) ?? bad('end_user_token bắt buộc');
  const poiId = optionalString(raw.poi_id, 'poi_id', 40) ?? null;
  if (kind === 'create' && poiId) bad('create không được kèm poi_id');
  if (kind !== 'create' && !poiId) bad(`${kind} cần poi_id`);

  const photoUrl = optionalString(raw.photo_url, 'photo_url', 512) ?? null;
  if (photoUrl && !photoUrl.startsWith('https://')) bad('photo_url phải là URL https');
  const note = optionalString(raw.note, 'note', 500) ?? null;
  if (kind === 'report' && !note) bad('report cần note lý do');

  const rawChanges = raw.changes === undefined ? {} : asRecord(raw.changes, 'changes');
  if (
    (kind === 'close' || kind === 'reopen' || kind === 'report') &&
    Object.keys(rawChanges).length > 0
  )
    bad(`${kind} không nhận changes`);
  const changes = kind === 'create' || kind === 'update' ? validateChanges(kind, rawChanges) : {};

  return { kind, poiId, changes, photoUrl, note, endUserToken };
}
