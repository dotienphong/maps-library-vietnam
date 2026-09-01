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

export interface ValidatedEdit {
  kind: EditKind;
  poiId: string | null;
  /** Đã whitelist + thêm dẫn xuất name_norm/street_norm/ward_norm/province_norm (quyết định 4). */
  changes: Record<string, unknown>;
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

const stringArray = (value: unknown, name: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 5 ||
    value.some((v) => typeof v !== 'string' || v.length > 200)
  )
    bad(`${name} phải là mảng ≤ 5 chuỗi`);
  return value as string[];
};

function validateChanges(kind: EditKind, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
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
    const clean: Record<string, unknown> = {};
    const phone = stringArray(contact.phone, 'contact.phone');
    const website = stringArray(contact.website, 'contact.website');
    const facebook = optionalString(contact.facebook, 'contact.facebook', 200);
    if (phone) clean.phone = phone;
    if (website) clean.website = website;
    if (facebook) clean.facebook = facebook;
    if (Object.keys(clean).length === 0) bad('changes.contact rỗng');
    out.contact = clean;
  }
  if (raw.hours !== undefined) {
    if (typeof raw.hours === 'string') {
      out.hours = { osm: optionalString(raw.hours, 'changes.hours', 200) };
    } else {
      const hours = asRecord(raw.hours, 'changes.hours');
      out.hours = {
        osm:
          optionalString(hours.osm, 'changes.hours.osm', 200) ?? bad('changes.hours.osm bắt buộc'),
      };
    }
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
