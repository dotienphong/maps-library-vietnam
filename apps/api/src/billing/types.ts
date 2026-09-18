import type { PaidTier, QuotaGroup, Tier } from '@mapslibvn/catalog';

export type { PaidTier, QuotaGroup, Tier };
export type EntitlementStatus = 'none' | 'active' | 'suspended' | 'expired';
export type ReservationState =
  | 'reserved'
  | 'awaiting_ack'
  | 'committed'
  | 'released'
  | 'expired'
  | 'compensated';

export interface GroupUsage {
  limit: number;
  used: number;
  reserved: number;
  credits: number;
  available: number;
}

/** Cửa sổ trượt của khoá `ack_required`, đủ để màn quản trị giải thích vì sao tenant bị chặn. */
export interface MissingAcks {
  /** Số receipt bỏ lỡ còn nằm trong cửa sổ 24 giờ. */
  count: number;
  /** Ngưỡng khoá. Để máy chủ trả về thay vì giao diện chép hằng số. */
  limit: number;
  locked: boolean;
  /** ISO — lúc khoá TỰ mở vì dòng cũ đủ trôi ra. `null` khi không bị khoá. */
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
  /** Sổ đang bị đóng để phục hồi: reserve bị từ chối, không phải hết lượt. */
  maintenance: boolean;
  /** Khoá `ack_required` — độc lập với hạn mức, nên để riêng khỏi `places`/`directions`. */
  missingAcks: MissingAcks;
  places: GroupUsage;
  directions: GroupUsage;
}

export type ReserveResult =
  | { allowed: true; requestId: string; deadline: string }
  | {
      allowed: false;
      reason:
        | 'no_entitlement'
        | 'suspended'
        | 'trial_expired'
        | 'subscription_expired'
        | 'daily'
        | 'period'
        | 'trial_total'
        | 'ack_required'
        | 'concurrency_limit'
        | 'maintenance'
        | 'key_revoked';
      group: QuotaGroup;
      resetAt: string | null;
    };

export interface SettlementReceipt {
  requestId: string;
  state: ReservationState;
  charged: boolean;
  /** ISO UTC. Client dùng để bỏ receipt đã hết hạn mà không tốn một vòng mạng hỏi server. */
  expiresAt: string;
}

interface CommandBase {
  operationId: string;
  tenantId: string;
  actor: string;
  reason: string;
  expectedRevision: number;
}

export type EntitlementCommand =
  | (CommandBase & { kind: 'activateTrial'; startsAt: string })
  | (CommandBase & {
      kind: 'grantPeriod';
      periodId: string;
      tier: PaidTier;
      startsAt: string;
      endsAt: string;
      paymentReference: string;
      lineItemId: string;
    })
  | (CommandBase & {
      kind: 'addCredits';
      periodId: string;
      group: QuotaGroup;
      packs: number;
      paymentReference: string;
      lineItemId: string;
    })
  | (CommandBase & { kind: 'suspend' | 'resume' });

export interface CommandReceipt {
  operationId: string;
  revision: number;
  status: EntitlementStatus;
  tier: Tier | null;
  appliedAt: string;
}

/** Số của một nhóm quota trong MỘT kỳ. Khác `GroupUsage`: không có credit, vì credit đứng riêng. */
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
  /** null với kỳ dùng thử — nó không đi kèm giao dịch nào. */
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

/** Lịch sử chỉ-đọc của một sổ quota: các kỳ đã cấp và các gói credit đã cộng. */
export interface PeriodHistory {
  periods: PeriodSummary[];
  credits: CreditSummary[];
}

/**
 * Bản sao lưu = manifest + các trang snapshot + đuôi journal sau `sequence`.
 * `sequence` là số thứ tự journal tại thời điểm đóng băng snapshot; mọi thay đổi có số lớn hơn
 * nằm trong journal chứ không nằm trong snapshot.
 */
export interface SnapshotManifest {
  snapshotId: string;
  tenantId: string;
  schemaVersion: number;
  sequence: number;
  pages: number;
  records: number;
  /** sha256 của chuỗi checksum từng trang — đổi một byte ở bất kỳ trang nào cũng lộ. */
  checksum: string;
  takenAt: string;
}

export interface SnapshotPage {
  snapshotId: string;
  index: number;
  pages: number;
  sequence: number;
  /** JSON thô ĐÚNG chuỗi byte đã băm; parse rồi stringify lại có thể ra byte khác. */
  records: string;
  checksum: string;
}

export interface JournalEntry {
  seq: number;
  kind: 'command' | 'commit' | 'compensate' | 'keyRevocation' | 'unlockAcks';
  ref: string;
  payload: string;
  createdAt: string;
}

export interface JournalPage {
  entries: JournalEntry[];
  nextSequence: number;
  /** Số bản ghi journal còn lại chưa được sao lưu — mốc theo dõi để backup không bị bỏ quên. */
  pending: number;
}

export interface CheckpointReceipt {
  sequence: number;
  checksum: string;
  exportedAt: string;
  prunedEntries: number;
}

export interface RestoreReceipt {
  applied: number;
  skipped: number;
  sequence: number;
}
