import { apiFetch } from '@/lib/fetcher';

export interface TenantCuaKhach {
  id: string;
  name: string;
  quotaMode: 'legacy' | 'commercial';
}

export interface TaiKhoanKhach {
  id: string;
  email: string;
  name: string | null;
  googleLinked: boolean;
  lastLoginAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  tenant: TenantCuaKhach | null;
}

/** Máy chủ cố ý KHÔNG trả token_hash lẫn ip_hash; kiểu này không có chỗ cho chúng. */
export interface PhienKhach {
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

export interface TrangKhach {
  items: TaiKhoanKhach[];
  nextCursor: string | null;
}

export interface ChiTietKhach {
  account: TaiKhoanKhach;
  sessions: PhienKhach[];
}

export function listCustomers(f: { q?: string; cursor?: string }): Promise<TrangKhach> {
  const p = new URLSearchParams({ limit: '25' });
  if (f.q) p.set('q', f.q);
  if (f.cursor) p.set('cursor', f.cursor);
  return apiFetch<TrangKhach>(`/v1/admin/customers?${p.toString()}`);
}

export const getCustomer = (id: string) => apiFetch<ChiTietKhach>(`/v1/admin/customers/${id}`);

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export interface LenhTaiKhoan {
  operationId: string;
  reason: string;
}

export const disableCustomer = (id: string, body: LenhTaiKhoan) =>
  postJson<{ account: TaiKhoanKhach; moi: boolean; sessionsDeleted: number }>(
    `/v1/admin/customers/${id}/disable`,
    body,
  );

export const enableCustomer = (id: string, body: LenhTaiKhoan) =>
  postJson<{ account: TaiKhoanKhach; moi: boolean }>(`/v1/admin/customers/${id}/enable`, body);
