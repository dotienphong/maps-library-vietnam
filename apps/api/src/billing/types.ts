export type QuotaGroup = 'places' | 'directions';
export type Tier = 'trial' | 'starter' | 'professional' | 'business';
export type PaidTier = Exclude<Tier, 'trial'>;
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

export interface UsageSnapshot {
  tenantId: string;
  status: EntitlementStatus;
  tier: Tier | null;
  revision: number;
  periodId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  trialUsedOnce: boolean;
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
        | 'concurrency_limit';
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
