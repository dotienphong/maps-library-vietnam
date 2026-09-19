import { apiFetch } from '@/lib/fetcher';

export type TenantPlan = 'internal' | 'free' | 'paid';
export type QuotaMode = 'legacy' | 'commercial';
export type KeyKind = 'web' | 'mobile' | 'server';

export interface Tenant {
  id: string;
  name: string;
  plan: TenantPlan;
  quota_mode: QuotaMode;
  created_at: string;
  active_keys: number;
}

export interface ApiKey {
  key_hash: string;
  key_prefix: string;
  label: string | null;
  kind: KeyKind;
  scopes: string[];
  allowed_origins: string[];
  allowed_bundle_ids: string[];
  quota_places_per_day: number | null;
  quota_directions_per_day: number | null;
  active: boolean;
  created_at: string;
  revoked_at: string | null;
}

export interface TenantListPage {
  items: Tenant[];
  /** Chuỗi `<thời điểm ISO>|<uuid>`; null là hết. */
  nextCursor: string | null;
}

export interface TenantDetail {
  tenant: Tenant;
  keys: ApiKey[];
}

export interface NewKeyInput {
  label: string;
  kind: KeyKind;
  allowed_origins?: string[];
  allowed_bundle_ids?: string[];
  scopes?: string[];
  quota_directions_per_day?: number;
}

export interface NewKeyResult {
  /** Khoá dạng rõ. Máy chủ trả đúng MỘT lần; DB chỉ giữ sha256. Không lưu lại ở bất kỳ đâu. */
  key: string;
  key_prefix: string;
  key_hash: string;
  tenant_id: string;
}

export function listTenants(filter: { q?: string; cursor?: string }): Promise<TenantListPage> {
  const params = new URLSearchParams({ limit: '25' });
  if (filter.q) params.set('q', filter.q);
  if (filter.cursor) params.set('cursor', filter.cursor);
  return apiFetch<TenantListPage>(`/v1/admin/tenants?${params.toString()}`);
}

export function getTenant(id: string): Promise<TenantDetail> {
  return apiFetch<TenantDetail>(`/v1/admin/tenants/${id}`);
}

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export function issueKey(tenantId: string, input: NewKeyInput): Promise<NewKeyResult> {
  return postJson<NewKeyResult>(`/v1/admin/tenants/${tenantId}/keys`, input);
}

/**
 * Thu hồi/khôi phục và đổi gói dùng LẠI nhóm route billing có từ trước: chúng ghi Durable Object
 * quota và Postgres theo đúng thứ tự fail-closed (thu hồi chạm DO trước, khôi phục chạm DB trước),
 * viết route thứ hai là chép lại đúng phần khó nhất.
 *
 * Hai route này đứng sau `requireBillingAccess()`, nên tài khoản ngoài BILLING_ADMIN_EMAILS nhận
 * 403 `billing_admin_forbidden` — giao diện phải nói thẳng điều đó thay vì "không tải được".
 */
export function setKeyRevoked(
  tenantId: string,
  keyHash: string,
  revoked: boolean,
  reason: string,
  operationId: string,
): Promise<unknown> {
  return postJson(`/v1/admin/billing/${tenantId}/keys/${keyHash}/revocation`, {
    revoked,
    reason,
    operationId,
  });
}

export interface XoaTenantKetQua {
  deleted: true;
  name: string;
  keys_deleted: number;
  accounts_unlinked: number;
}

/**
 * Xoá vĩnh viễn một tenant. `confirmName` phải khớp đúng tên; máy chủ trả 400
 * `confirm_name_mismatch` nếu lệch, 409 `tenant_has_edits` nếu tenant còn đóng góp POI, và 409
 * `tenant_has_orders` nếu còn đơn hàng. Ba lỗi đó là chốt an toàn, không phải sự cố — giao diện
 * phải nói đúng chúng, nên `XoaTenantDialog` hiện nguyên văn thông điệp máy chủ.
 */
export function xoaTenant(tenantId: string, confirmName: string): Promise<XoaTenantKetQua> {
  return apiFetch<XoaTenantKetQua>(`/v1/admin/tenants/${tenantId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm_name: confirmName }),
  });
}

export function setQuotaMode(tenantId: string, mode: QuotaMode): Promise<{ mode: QuotaMode }> {
  return postJson<{ mode: QuotaMode }>(`/v1/admin/billing/${tenantId}/mode`, { mode });
}
