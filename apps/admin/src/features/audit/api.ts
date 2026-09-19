import { apiFetch } from '@/lib/fetcher';

export interface AuditEntry {
  /** `bigserial` giữ nguyên dạng chuỗi — ép sang number là hẹn giờ mất chính xác ở 2^53. */
  id: string;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

export interface AuditFilter {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

/**
 * Danh sách những loại việc hiện có trong mã. Chỉ dùng để GỢI Ý trong ô nhập (datalist), không
 * dùng làm `<select>` đóng: thêm một `audit(...)` mới ở API mà quên sửa danh sách này thì một
 * select đóng sẽ giấu luôn loại việc đó khỏi người trực, còn gợi ý thì không giấu gì cả.
 */
export const LOAI_VIEC = [
  'edit.approve',
  'edit.reject',
  'edits.bulk_approve',
  'edits.bulk_reject',
  'tenant.key_issue',
  'tenant.key_revoke',
  'tenant.key_restore',
  'tenant.quota_mode',
  'billing.command',
  'billing.unlock_acks',
  'admin.order.fulfil',
  'admin.order.confirm_manual',
  'admin.order.cancel',
  'admin.order.refund',
  'admin.customer.disable',
  'admin.customer.enable',
] as const;

export function listAudit(filter: AuditFilter, limit = 25): Promise<AuditPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  for (const [ten, gia] of Object.entries(filter)) {
    if (gia) params.set(ten, gia);
  }
  return apiFetch<AuditPage>(`/v1/admin/audit?${params.toString()}`);
}
