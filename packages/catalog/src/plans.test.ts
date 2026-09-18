import { describe, expect, it } from 'vitest';
import {
  PAID_TIERS,
  PERIOD_MONTHS,
  PLAN_CATALOG,
  QUOTA_GROUPS,
  TIERS,
  USD_REFERENCE_RATE,
} from './plans';

describe('PLAN_CATALOG', () => {
  it('giữ đúng bốn bậc theo thứ tự tăng dần và hai nhóm quota', () => {
    expect(TIERS).toEqual(['trial', 'starter', 'professional', 'business']);
    expect(PAID_TIERS).toEqual(['starter', 'professional', 'business']);
    expect(QUOTA_GROUPS).toEqual(['places', 'directions']);
  });

  it('giá USD cent khớp quyết định 14/09/2026', () => {
    expect(PLAN_CATALOG.trial.priceCents).toBe(0);
    expect(PLAN_CATALOG.starter.priceCents).toBe(2_500);
    expect(PLAN_CATALOG.professional.priceCents).toBe(10_000);
    expect(PLAN_CATALOG.business.priceCents).toBe(40_000);
    expect(PLAN_CATALOG.addOns.places.priceCents).toBe(100);
    expect(PLAN_CATALOG.addOns.directions.priceCents).toBe(300);
  });

  it('giá VND là số cố định đã chốt, KHÔNG suy từ USD lúc chạy', () => {
    expect(PLAN_CATALOG.trial.priceVnd).toBe(0);
    expect(PLAN_CATALOG.starter.priceVnd).toBe(650_000);
    expect(PLAN_CATALOG.professional.priceVnd).toBe(2_600_000);
    expect(PLAN_CATALOG.business.priceVnd).toBe(10_400_000);
    expect(PLAN_CATALOG.addOns.places.priceVnd).toBe(26_000);
    expect(PLAN_CATALOG.addOns.directions.priceVnd).toBe(78_000);
  });

  it('VND và USD nhất quán theo tỷ giá tham chiếu 26.000 (khoá lại để ai đổi một bên phải đổi cả hai)', () => {
    expect(USD_REFERENCE_RATE).toBe(26_000);
    for (const tier of PAID_TIERS) {
      const plan = PLAN_CATALOG[tier];
      expect(plan.priceVnd).toBe((plan.priceCents / 100) * USD_REFERENCE_RATE);
    }
    for (const group of QUOTA_GROUPS) {
      const addOn = PLAN_CATALOG.addOns[group];
      expect(addOn.priceVnd).toBe((addOn.priceCents / 100) * USD_REFERENCE_RATE);
    }
  });

  it('hạn mức và trần ngày y như bản đang chạy production', () => {
    expect(PLAN_CATALOG.trial).toMatchObject({
      places: 2_000,
      directions: 200,
      dailyPlaces: 200,
      dailyDirections: 20,
      onlineSupport: false,
    });
    expect(PLAN_CATALOG.starter).toMatchObject({
      places: 30_000,
      directions: 3_000,
      dailyPlaces: null,
      dailyDirections: null,
      onlineSupport: false,
    });
    expect(PLAN_CATALOG.professional).toMatchObject({
      places: 100_000,
      directions: 10_000,
      onlineSupport: true,
    });
    expect(PLAN_CATALOG.business).toMatchObject({
      places: 400_000,
      directions: 40_000,
      onlineSupport: true,
    });
    expect(PLAN_CATALOG.addOns.places.units).toBe(1_000);
    expect(PLAN_CATALOG.addOns.directions.units).toBe(1_000);
  });

  it('kỳ mua là 1, 3, 6, 12 tháng', () => {
    expect([...PERIOD_MONTHS]).toEqual([1, 3, 6, 12]);
  });
});
