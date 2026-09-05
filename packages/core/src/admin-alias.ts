import type { ParsedAddress } from './address';
import { normalizeVi } from './normalize';

export type AdminAliasKeyInput = Pick<
  ParsedAddress,
  'ward' | 'district' | 'province' | 'adminOriginal'
>;

const PREFIX = /^(?:tinh|thanh pho|tp|quan|huyen|thi xa|phuong|xa|thi tran)\s+/;
const prefixOf = (value: string | undefined, fallback: string) => {
  const normalized = normalizeVi(value ?? '');
  const match = /^(tinh|thanh pho|quan|huyen|thi xa|phuong|xa|thi tran)\s+/.exec(normalized);
  return match?.[1] ?? fallback;
};
const coreOf = (value: string | undefined) => normalizeVi(value ?? '').replace(PREFIX, '');

/** Sinh khóa alias từ cụ thể đến rộng; pipeline quyết định khóa ngắn nào đủ duy nhất để publish. */
export function adminAliasKeys(input: AdminAliasKeyInput): string[] {
  const original = input.adminOriginal ?? {};
  const ward = coreOf(input.ward ?? original.ward);
  const district = coreOf(input.district ?? original.district);
  const canonicalProvince = coreOf(input.province);
  const originalProvince = coreOf(original.province);
  const province = ['hcm', 'tphcm'].includes(originalProvince)
    ? canonicalProvince
    : originalProvince || canonicalProvince;
  const wardPart = ward ? `${prefixOf(original.ward, 'phuong')} ${ward}` : '';
  const districtPart = district ? `${prefixOf(original.district, 'quan')} ${district}` : '';
  const keys: string[] = [];
  const add = (...parts: string[]) => {
    const key = parts.filter(Boolean).join(' ');
    if (key && !keys.includes(key)) keys.push(key);
  };

  if (wardPart && districtPart && province) add(wardPart, districtPart, province);
  if (wardPart && districtPart) add(wardPart, districtPart);
  if (wardPart && province) add(wardPart, province);
  if (wardPart) add(wardPart);
  if (ward && !/^\d+$/.test(ward)) add(ward);
  if (districtPart && province) add(districtPart, province);
  if (districtPart) add(districtPart);
  if (district && !/^\d+$/.test(district)) add(district);
  if (originalProvince) add(originalProvince);
  if (canonicalProvince) add(canonicalProvince);
  return keys;
}
