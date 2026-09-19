import { apiFetch } from './fetcher';

export interface CauHinh {
  selfServe: boolean;
  turnstileSiteKey: string;
  googleEnabled: boolean;
  supportEmail: string;
}

export interface Toi {
  email: string;
  name: string | null;
  onboarded: boolean;
  tenant: { id: string; name: string | null } | null;
}

/**
 * Tổ chức, đầy đủ cả bốn trường biên nhận. `Toi.tenant` cố ý chỉ có id và tên vì `/v1/console/me`
 * dựng câu trả lời từ dữ liệu phiên, không chạm DB. Trang Cài đặt cần đủ nên đi đường riêng.
 */
export interface TenantDayDu {
  id: string;
  name: string | null;
  plan: string;
  quota_mode: string;
  billing_name: string | null;
  billing_tax_code: string | null;
  billing_address: string | null;
  billing_email: string | null;
}

export interface NhomQuota {
  limit: number;
  used: number;
  reserved: number;
  credits: number;
  available: number;
}

export interface MucDung {
  status: 'none' | 'active' | 'suspended' | 'expired';
  tier: 'trial' | 'starter' | 'professional' | 'business' | null;
  periodId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  maintenance: boolean;
  missingAcks: { count: number; limit: number; locked: boolean; opensAt: string | null };
  places: NhomQuota;
  directions: NhomQuota;
}

export interface KhoaApi {
  keyHash: string;
  keyPrefix: string;
  label: string | null;
  kind: string;
  allowedOrigins: string[];
  active: boolean;
  createdAt: string;
  revokedAt: string | null;
}

export const layCauHinh = () => apiFetch<CauHinh>('/v1/console/config');
export const layToi = () => apiFetch<Toi>('/v1/console/me');
export const layMucDung = () => apiFetch<MucDung>('/v1/console/usage');
export const layTenant = () =>
  apiFetch<{ tenant: TenantDayDu }>('/v1/console/tenant').then((r) => r.tenant);
export const layKhoa = () => apiFetch<{ keys: KhoaApi[]; toiDa: number }>('/v1/console/keys');
