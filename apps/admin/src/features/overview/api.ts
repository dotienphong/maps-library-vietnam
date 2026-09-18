import { apiFetch } from '@/lib/fetcher';

export interface MucDungNhom {
  used: number;
  limit: number;
}

export interface DongQuota {
  tenant_id: string;
  name: string;
  quota_mode: 'legacy' | 'commercial';
  places: MucDungNhom;
  directions: MucDungNhom;
  /** Nhóm dùng nhiều hơn trong hai nhóm, đã cắt ở 100 và làm tròn. */
  pct: number;
}

export interface QuotaSummary {
  computed_at: string;
  truncated: boolean;
  tenants: DongQuota[];
  /** Số tenant từ 80% trở lên. */
  above: number;
}

export const getQuotaSummary = (): Promise<QuotaSummary> =>
  apiFetch<QuotaSummary>('/v1/admin/quota-summary');
