import {
  PAID_TIERS,
  type PaidTier,
  PERIOD_MONTHS,
  type PeriodMonths,
  PLAN_CATALOG,
  QUOTA_GROUPS,
  type QuotaGroup,
} from './plans';

export type OrderInput =
  | { kind: 'plan'; tier: PaidTier; months: PeriodMonths }
  | { kind: 'addon'; group: QuotaGroup; packs: number };

export interface Quote {
  amountVnd: number;
  amountUsdCents: number;
}

/** Trần số khối một đơn — khớp CHECK (packs <= 1000) của bảng customer_order (spec 5.2). */
export const MAX_PACKS = 1_000;

export type CatalogErrorCode =
  | 'invalid_kind'
  | 'invalid_tier'
  | 'invalid_months'
  | 'invalid_group'
  | 'invalid_packs';

/** Mã nằm ở cả `code` lẫn `message`: route API khớp theo message được ngay, không cần instanceof. */
export class CatalogError extends Error {
  constructor(readonly code: CatalogErrorCode) {
    super(code);
    this.name = 'CatalogError';
  }
}

/**
 * Tính tiền một đơn. Input tới từ JSON của client nên kiểm lại từng trường lúc chạy — kiểu
 * TypeScript không bảo vệ được biên giới mạng. Máy chủ luôn gọi hàm này và bỏ mọi số tiền client gửi.
 */
export function quoteOrder(input: OrderInput): Quote {
  if (input.kind === 'plan') {
    if (!(PAID_TIERS as readonly string[]).includes(input.tier)) {
      throw new CatalogError('invalid_tier');
    }
    if (!(PERIOD_MONTHS as readonly number[]).includes(input.months)) {
      throw new CatalogError('invalid_months');
    }
    const plan = PLAN_CATALOG[input.tier];
    return {
      amountVnd: plan.priceVnd * input.months,
      amountUsdCents: plan.priceCents * input.months,
    };
  }
  if (input.kind === 'addon') {
    if (!(QUOTA_GROUPS as readonly string[]).includes(input.group)) {
      throw new CatalogError('invalid_group');
    }
    if (!Number.isInteger(input.packs) || input.packs < 1 || input.packs > MAX_PACKS) {
      throw new CatalogError('invalid_packs');
    }
    const addOn = PLAN_CATALOG.addOns[input.group];
    return {
      amountVnd: addOn.priceVnd * input.packs,
      amountUsdCents: addOn.priceCents * input.packs,
    };
  }
  throw new CatalogError('invalid_kind');
}
