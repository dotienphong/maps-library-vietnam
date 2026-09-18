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
export const layKhoa = () => apiFetch<{ keys: KhoaApi[]; toiDa: number }>('/v1/console/keys');
