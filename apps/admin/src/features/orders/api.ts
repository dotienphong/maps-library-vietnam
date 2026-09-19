import { apiFetch } from '@/lib/fetcher';

export type TrangThaiDon =
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'paid_unfulfilled'
  | 'underpaid'
  | 'expired'
  | 'cancelled'
  | 'refunded';

export interface DonHangAdmin {
  id: string;
  orderCode: number;
  noiDungChuyenKhoan: string;
  kind: 'plan' | 'addon';
  tier: string | null;
  months: number | null;
  quotaGroup: string | null;
  packs: number | null;
  moTa: string;
  amountVnd: number;
  amountUsdCents: number;
  status: TrangThaiDon;
  checkoutUrl: string | null;
  linkExpiresAt: string | null;
  paidAt: string | null;
  paidAmountVnd: number | null;
  fulfilledAt: string | null;
  fulfilError: string | null;
  fulfilAttempts: number;
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  tenantName: string | null;
  accountId: string;
  paymentLinkId: string | null;
  entitlementReceipt: unknown;
  note: string | null;
}

export interface SuKien {
  id: number;
  orderId: string | null;
  provider: string;
  reference: string;
  orderCode: number | null;
  amountVnd: number | null;
  signatureValid: boolean;
  /** Thu gọn từ payload: máy chủ cố ý KHÔNG trả nguyên văn (có số tài khoản đối ứng của người trả). */
  tomTat: Record<string, unknown>;
  receivedAt: string;
}

export interface TomTatDon {
  choXuLy: number;
  doanhThu30Ngay: number;
  pendingQua1Gio: number;
  khongKhop: number;
}

export interface TrangDon {
  items: DonHangAdmin[];
  nextCursor: string | null;
}

export interface ChiTietDon {
  order: DonHangAdmin;
  events: SuKien[];
  owner: { email: string; billingEmail: string | null } | null;
}

export function listOrders(f: { status?: TrangThaiDon; cursor?: string }): Promise<TrangDon> {
  const p = new URLSearchParams({ limit: '25' });
  if (f.status) p.set('status', f.status);
  if (f.cursor) p.set('cursor', f.cursor);
  return apiFetch<TrangDon>(`/v1/admin/orders?${p.toString()}`);
}

export const getOrder = (id: string) => apiFetch<ChiTietDon>(`/v1/admin/orders/${id}`);
export const getSummary = () => apiFetch<TomTatDon>('/v1/admin/orders/summary');
export const getUnmatched = () => apiFetch<{ items: SuKien[] }>('/v1/admin/payment-events/unmatched');

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const fulfilOrder = (id: string) =>
  postJson<{ order: DonHangAdmin; ketQua: string }>(`/v1/admin/orders/${id}/fulfil`, {});

export interface XacNhanTay {
  operationId: string;
  reason: string;
  bankReference: string;
  amountVnd?: number;
}

export const confirmManual = (id: string, body: XacNhanTay) =>
  postJson<{ order: DonHangAdmin; ketQua: string; moi: boolean }>(
    `/v1/admin/orders/${id}/confirm-manual`,
    body,
  );
