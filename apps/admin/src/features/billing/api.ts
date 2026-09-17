import { apiFetch } from '@/lib/fetcher';

export type QuotaGroup = 'places' | 'directions';
export type Tier = 'trial' | 'starter' | 'professional' | 'business';
export type PaidTier = Exclude<Tier, 'trial'>;
export type EntitlementStatus = 'none' | 'active' | 'suspended' | 'expired';

export interface GroupUsage {
  limit: number;
  used: number;
  reserved: number;
  credits: number;
  /** = max(0, limit - used - reserved) + credits. Máy chủ tính, giao diện không tính lại. */
  available: number;
}

/** Cửa sổ trượt của khoá `ack_required`. Ngưỡng do máy chủ trả về, giao diện không chép hằng số. */
export interface MissingAcks {
  count: number;
  limit: number;
  locked: boolean;
  /** ISO — lúc khoá tự mở vì dòng cũ trôi khỏi cửa sổ. `null` khi không bị khoá. */
  opensAt: string | null;
}

export interface UsageSnapshot {
  tenantId: string;
  status: EntitlementStatus;
  tier: Tier | null;
  revision: number;
  periodId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  trialUsedOnce: boolean;
  /** Sổ đang bị đóng để phục hồi: mọi request của khách bị từ chối, không phải vì hết lượt. */
  maintenance: boolean;
  missingAcks: MissingAcks;
  places: GroupUsage;
  directions: GroupUsage;
}

export interface PeriodGroupUsage {
  limit: number;
  used: number;
  reserved: number;
}

export interface PeriodSummary {
  periodId: string;
  tier: Tier;
  startsAt: string;
  endsAt: string;
  paymentReference: string | null;
  lineItemId: string | null;
  places: PeriodGroupUsage;
  directions: PeriodGroupUsage;
}

export interface CreditSummary {
  grantId: string;
  periodId: string;
  group: QuotaGroup;
  units: number;
  used: number;
  reserved: number;
  expiresAt: string;
  paymentReference: string;
  lineItemId: string;
}

export interface PeriodHistory {
  periods: PeriodSummary[];
  credits: CreditSummary[];
}

export interface LegacyKeyUsage {
  keyPrefix: string;
  label: string | null;
  places: { used: number; limit: number };
  directions: { used: number; limit: number };
}

export interface LegacyUsage {
  /** Ngày theo giờ VN mà bộ đếm đang tính. */
  day: string;
  quotaEnabled: boolean;
  plan: string;
  /** false với tenant internal: bộ đếm cố ý không chạy, số 0 là thiết kế. */
  counted: boolean;
  /** Bộ đếm là xấp xỉ nên chỉ chặn ở bội số này của hạn mức. */
  blockAtMultiple: number;
  keys: LegacyKeyUsage[];
  total: { places: { used: number; limit: number }; directions: { used: number; limit: number } };
}

export interface PlanCatalog {
  tiers: {
    tier: Tier;
    priceCents: number;
    places: number;
    directions: number;
    dailyPlaces: number | null;
    dailyDirections: number | null;
    onlineSupport: boolean;
  }[];
  addOns: { group: QuotaGroup; units: number; priceCents: number }[];
  legacyDefaults: { places: number; directions: number; blockAtMultiple: number };
}

export interface CommandReceipt {
  operationId: string;
  revision: number;
  status: EntitlementStatus;
  tier: Tier | null;
  appliedAt: string;
}

interface Chung {
  operationId: string;
  reason: string;
  expectedRevision: number;
}

/**
 * Hợp đồng lệnh. Máy chủ kiểm bằng allowlist ĐÓNG: thừa một trường là `invalid_command` 400, nên
 * kiểu ở đây cố tình không có chỗ cho trường phụ. `tenantId` và `actor` do máy chủ tự điền — gửi
 * kèm cũng vô ích và dễ gây hiểu nhầm là giao diện được phép chọn người thực hiện.
 */
export type Command =
  | (Chung & { kind: 'activateTrial'; startsAt: string })
  | (Chung & {
      kind: 'grantPeriod';
      periodId: string;
      tier: PaidTier;
      startsAt: string;
      endsAt: string;
      paymentReference: string;
      lineItemId: string;
    })
  | (Chung & {
      kind: 'addCredits';
      periodId: string;
      group: QuotaGroup;
      packs: number;
      paymentReference: string;
      lineItemId: string;
    })
  | (Chung & { kind: 'suspend' | 'resume' });

export const getUsage = (tenantId: string): Promise<UsageSnapshot> =>
  apiFetch<UsageSnapshot>(`/v1/admin/billing/${tenantId}/usage`);

export const getPeriods = (tenantId: string): Promise<PeriodHistory> =>
  apiFetch<PeriodHistory>(`/v1/admin/billing/${tenantId}/periods`);

export const getLegacyUsage = (tenantId: string): Promise<LegacyUsage> =>
  apiFetch<LegacyUsage>(`/v1/admin/billing/${tenantId}/legacy-usage`);

export const getCatalog = (): Promise<PlanCatalog> =>
  apiFetch<PlanCatalog>('/v1/admin/plan-catalog');

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const sendCommand = (tenantId: string, command: Command): Promise<CommandReceipt> =>
  postJson<CommandReceipt>(`/v1/admin/billing/${tenantId}/commands`, command);

export const unlockAcks = (
  tenantId: string,
  operationId: string,
  reason: string,
): Promise<{ unlocked: number }> =>
  postJson<{ unlocked: number }>(`/v1/admin/billing/${tenantId}/missing-acks/unlock`, {
    operationId,
    reason,
  });
