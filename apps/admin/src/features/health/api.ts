import { apiFetch } from '@/lib/fetcher';

export const CUA_SO = ['1h', '24h', '7d'] as const;
export type CuaSo = (typeof CUA_SO)[number];
export const NHAN_CUA_SO: Readonly<Record<CuaSo, string>> = {
  '1h': '1 giờ',
  '24h': '24 giờ',
  '7d': '7 ngày',
};

/** Một phép đo: hoặc đo được (`ok: true` kèm số liệu), hoặc hỏng (`ok: false` kèm lý do). */
export type PhepDo<T> = ({ ok: true; ms: number } & T) | { ok: false; ms: number; error: string };

export interface Health {
  checked_at: string;
  db: PhepDo<{
    user?: string;
    version?: string;
    word_similarity_threshold: number | null;
    schema_migration: string | null;
  }>;
  routing: PhepDo<{ distance_km: number; phut: number }>;
  data: PhepDo<{ tiles: string | null; poi: string | null; updated_at: string | null }>;
  /** Cron cảnh báo: `null` khi chưa chạy lần nào. `gui_trong_ngay` đếm theo ngày UTC. */
  watcher: { kiem_luc: string; gui_trong_ngay: number } | null;
}

export interface DongRoute {
  route: string;
  requests: number;
  errors_5xx: number;
  quota_429: number;
  p95_ms: number;
}

export interface DongTenant extends Omit<DongRoute, 'route'> {
  tenant_id: string;
  ten: string | null;
}

export interface Metrics {
  computed_at: string;
  routes: DongRoute[];
  tenants: DongTenant[];
}

export const getHealth = (): Promise<Health> => apiFetch<Health>('/v1/admin/health');

export const getMetrics = (window: CuaSo): Promise<Metrics> =>
  apiFetch<Metrics>(`/v1/admin/metrics?window=${window}`);
