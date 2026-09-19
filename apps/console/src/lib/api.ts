import type { PaidTier, PeriodMonths, QuotaGroup } from '@mapslibvn/catalog';
import { apiFetch, postJson } from './fetcher';

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

export type TrangThaiDon =
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'paid_unfulfilled'
  | 'underpaid'
  | 'expired'
  | 'cancelled'
  | 'refunded';

export interface DonHang {
  id: string;
  orderCode: number;
  noiDungChuyenKhoan: string;
  kind: 'plan' | 'addon';
  tier: PaidTier | null;
  months: PeriodMonths | null;
  quotaGroup: QuotaGroup | null;
  packs: number | null;
  moTa: string;
  amountVnd: number;
  amountUsdCents: number;
  status: TrangThaiDon;
  checkoutUrl: string | null;
  qrCode: string | null;
  linkExpiresAt: string | null;
  paidAt: string | null;
  paidAmountVnd: number | null;
  fulfilledAt: string | null;
  fulfilError: string | null;
  createdAt: string;
}

export interface BaoGia {
  amountVnd: number;
  amountUsdCents: number;
  /** null với đơn mua thêm lượt: chúng cộng vào kỳ hiện tại, không mở kỳ mới. */
  hieuLucTu: string | null;
  hetHanLuc: string | null;
}

export type NoiDungDon =
  | { kind: 'plan'; tier: PaidTier; months: PeriodMonths }
  | { kind: 'addon'; group: QuotaGroup; packs: number };

/** Nội dung đơn dựng lại từ một đơn đã có — để "Tạo lại link" gửi đúng thứ khách đã chọn. */
export function noiDungTuDon(don: DonHang): NoiDungDon | null {
  if (don.kind === 'plan' && don.tier && don.months) {
    return { kind: 'plan', tier: don.tier, months: don.months };
  }
  if (don.kind === 'addon' && don.quotaGroup && don.packs) {
    return { kind: 'addon', group: don.quotaGroup, packs: don.packs };
  }
  return null;
}

const thamSo = (d: NoiDungDon) =>
  new URLSearchParams(
    d.kind === 'plan'
      ? { kind: 'plan', tier: d.tier, months: String(d.months) }
      : { kind: 'addon', group: d.group, packs: String(d.packs) },
  ).toString();

export const layBaoGia = (d: NoiDungDon) =>
  apiFetch<BaoGia>(`/v1/console/orders/quote?${thamSo(d)}`);
export const taoDon = (d: NoiDungDon) =>
  postJson<{ order: DonHang }>('/v1/console/orders', d).then((r) => r.order);
export const layDonHang = () =>
  apiFetch<{ orders: DonHang[] }>('/v1/console/orders').then((r) => r.orders);
export const layDon = (id: string) =>
  apiFetch<{ order: DonHang }>(`/v1/console/orders/${id}`).then((r) => r.order);
export const huyDon = (id: string) =>
  postJson<{ order: DonHang }>(`/v1/console/orders/${id}/cancel`, {}).then((r) => r.order);
