import type { QuotaGroup, Tier } from './types';

interface PlanDefinition {
  priceCents: number;
  places: number;
  directions: number;
  dailyPlaces: number | null;
  dailyDirections: number | null;
  onlineSupport: boolean;
}

export const PLAN_CATALOG: Readonly<
  Record<Tier, Readonly<PlanDefinition>> & {
    addOns: Readonly<Record<QuotaGroup, Readonly<{ units: number; priceCents: number }>>>;
  }
> = {
  trial: {
    priceCents: 0,
    places: 2_000,
    directions: 200,
    dailyPlaces: 200,
    dailyDirections: 20,
    onlineSupport: false,
  },
  starter: {
    priceCents: 2_500,
    places: 30_000,
    directions: 3_000,
    dailyPlaces: null,
    dailyDirections: null,
    onlineSupport: false,
  },
  professional: {
    priceCents: 10_000,
    places: 100_000,
    directions: 10_000,
    dailyPlaces: null,
    dailyDirections: null,
    onlineSupport: true,
  },
  business: {
    priceCents: 40_000,
    places: 400_000,
    directions: 40_000,
    dailyPlaces: null,
    dailyDirections: null,
    onlineSupport: true,
  },
  addOns: {
    places: { units: 1_000, priceCents: 100 },
    directions: { units: 1_000, priceCents: 300 },
  },
};
