export type QuotaGroup = 'places' | 'directions';
export type Tier = 'trial' | 'starter' | 'professional' | 'business';
export type PaidTier = Exclude<Tier, 'trial'>;

export interface PlanDefinition {
  /** USD cent theo quyết định 14/09/2026 — chỉ để hiện tham chiếu và cho báo cáo. */
  priceCents: number;
  /**
   * VND — đồng tiền THU thật (PHONG chốt 18/09/2026). Là số cố định, không suy từ `priceCents`
   * lúc chạy: đổi tỷ giá là một quyết định giá, phải đi qua commit.
   */
  priceVnd: number;
  places: number;
  directions: number;
  dailyPlaces: number | null;
  dailyDirections: number | null;
  onlineSupport: boolean;
}

export interface AddOnDefinition {
  units: number;
  priceCents: number;
  priceVnd: number;
}

export const TIERS: readonly Tier[] = ['trial', 'starter', 'professional', 'business'];
export const PAID_TIERS: readonly PaidTier[] = ['starter', 'professional', 'business'];
export const QUOTA_GROUPS: readonly QuotaGroup[] = ['places', 'directions'];

/** Tỷ giá THAM CHIẾU đã chốt 14/09/2026, chỉ để hiện USD mờ cạnh giá VND. */
export const USD_REFERENCE_RATE = 26_000;

/** Kỳ mua được phép, giá nhân đơn, không chiết khấu (PHONG chốt 18/09/2026). */
export const PERIOD_MONTHS = [1, 3, 6, 12] as const;
export type PeriodMonths = (typeof PERIOD_MONTHS)[number];

export const PLAN_CATALOG: Readonly<
  Record<Tier, Readonly<PlanDefinition>> & {
    addOns: Readonly<Record<QuotaGroup, Readonly<AddOnDefinition>>>;
  }
> = {
  trial: {
    priceCents: 0,
    priceVnd: 0,
    places: 2_000,
    directions: 200,
    dailyPlaces: 200,
    dailyDirections: 20,
    onlineSupport: false,
  },
  starter: {
    priceCents: 2_500,
    priceVnd: 650_000,
    places: 30_000,
    directions: 3_000,
    dailyPlaces: null,
    dailyDirections: null,
    onlineSupport: false,
  },
  professional: {
    priceCents: 10_000,
    priceVnd: 2_600_000,
    places: 100_000,
    directions: 10_000,
    dailyPlaces: null,
    dailyDirections: null,
    onlineSupport: true,
  },
  business: {
    priceCents: 40_000,
    priceVnd: 10_400_000,
    places: 400_000,
    directions: 40_000,
    dailyPlaces: null,
    dailyDirections: null,
    onlineSupport: true,
  },
  addOns: {
    places: { units: 1_000, priceCents: 100, priceVnd: 26_000 },
    directions: { units: 1_000, priceCents: 300, priceVnd: 78_000 },
  },
};
