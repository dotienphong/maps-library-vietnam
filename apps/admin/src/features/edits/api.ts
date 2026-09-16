import { apiFetch } from '@/lib/fetcher';

export type EditStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved';
export type EditKind = 'create' | 'update' | 'close' | 'reopen' | 'report';

export interface AdminEdit {
  id: number;
  poi_id: string | null;
  poi_name: string | null;
  poi_status: string | null;
  poi_ward: string | null;
  poi_province: string | null;
  kind: EditKind;
  changes: Record<string, unknown> | null;
  photo_url: string | null;
  note: string | null;
  status: EditStatus;
  reviewer: string | null;
  created_at: string;
  tenant_id: string;
  /** Chỉ có khi changes đổi toạ độ; tính bằng PostGIS để khớp số trong màn chi tiết. */
  distance_m: number | null;
}

export interface EditListPage {
  items: AdminEdit[];
  nextCursor: number | null;
}

export interface PoiSnapshot {
  id: string;
  name: string | null;
  category: string | null;
  status: string;
  housenumber: string | null;
  street: string | null;
  ward: string | null;
  province: string | null;
  address_text: string | null;
  contact: Record<string, unknown> | null;
  hours: Record<string, unknown> | null;
  lat: number;
  lng: number;
}

export interface NearbyPoi {
  id: string;
  name: string | null;
  category: string | null;
  lat: number;
  lng: number;
  distance_m: number;
}

export interface EditDetail {
  edit: AdminEdit;
  poi_hien_tai: PoiSnapshot | null;
  distance_m: number | null;
  nearby: NearbyPoi[];
}

export interface EditListFilter {
  status: EditStatus;
  kind?: EditKind;
  q?: string;
  cursor?: number;
}

export function listEdits(filter: EditListFilter): Promise<EditListPage> {
  const params = new URLSearchParams({ status: filter.status, limit: '25' });
  if (filter.kind) params.set('kind', filter.kind);
  if (filter.q) params.set('q', filter.q);
  if (filter.cursor) params.set('cursor', String(filter.cursor));
  return apiFetch<EditListPage>(`/v1/admin/edits?${params.toString()}`);
}

export function getEdit(id: number): Promise<EditDetail> {
  return apiFetch<EditDetail>(`/v1/admin/edits/${id}`);
}

export function countPending(): Promise<{ pending: number }> {
  return apiFetch<{ pending: number }>('/v1/admin/edits/count');
}

export function reviewEdit(id: number, action: 'approve' | 'reject'): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/v1/admin/edits/${id}/${action}`, { method: 'POST' });
}

export function reviewBulk(
  ids: number[],
  action: 'approve' | 'reject',
): Promise<{ ok: number[]; failed: number[] }> {
  return apiFetch<{ ok: number[]; failed: number[] }>('/v1/admin/edits/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids, action }),
  });
}
