import { describe, expect, it } from 'vitest';
import { PLAN_CATALOG } from '../src/billing/catalog';
import {
  available,
  isBillableStatus,
  periodBoundary,
  trialEndsAt,
  vnBillingDay,
} from '../src/billing/policy';

describe('billing catalog', () => {
  it('uses the approved plans, integer cents and support policy', () => {
    expect(PLAN_CATALOG.trial).toMatchObject({
      priceCents: 0,
      places: 2_000,
      directions: 200,
      dailyPlaces: 200,
      dailyDirections: 20,
    });
    expect(PLAN_CATALOG.starter).toMatchObject({
      priceCents: 2_500,
      places: 30_000,
      directions: 3_000,
      onlineSupport: false,
    });
    expect(PLAN_CATALOG.professional).toMatchObject({
      priceCents: 10_000,
      places: 100_000,
      directions: 10_000,
      onlineSupport: true,
    });
    expect(PLAN_CATALOG.business).toMatchObject({
      priceCents: 40_000,
      places: 400_000,
      directions: 40_000,
      onlineSupport: true,
    });
  });

  it('uses approved integer add-on packs', () => {
    expect(PLAN_CATALOG.addOns.places).toEqual({ units: 1_000, priceCents: 100 });
    expect(PLAN_CATALOG.addOns.directions).toEqual({ units: 1_000, priceCents: 300 });
  });
});

describe('billing policy', () => {
  it('charges only 2xx responses', () => {
    for (const status of [200, 201, 204, 206, 299]) expect(isBillableStatus(status)).toBe(true);
    for (const status of [0, 199, 300, 400, 429, 500, 503]) {
      expect(isBillableStatus(status)).toBe(false);
    }
  });

  it('computes available units with safe integer validation', () => {
    expect(available(100, 98, 2)).toBe(0);
    expect(available(100, 10, 5)).toBe(85);
    expect(() => available(-1, 0, 0)).toThrow(RangeError);
    expect(() => available(Number.MAX_SAFE_INTEGER, 0, -1)).toThrow(RangeError);
  });

  it('ends trial at the exclusive instant exactly 30 days later', () => {
    const start = new Date('2026-01-31T17:00:00.000Z');
    expect(trialEndsAt(start).toISOString()).toBe('2026-03-02T17:00:00.000Z');
    expect(start.toISOString()).toBe('2026-01-31T17:00:00.000Z');
  });

  it('keeps the original calendar anchor across short months', () => {
    const anchor = new Date('2024-01-31T08:15:30.000Z');
    expect(periodBoundary(anchor, 1).toISOString()).toBe('2024-02-29T08:15:30.000Z');
    expect(periodBoundary(anchor, 2).toISOString()).toBe('2024-03-31T08:15:30.000Z');
    expect(periodBoundary(anchor, 13).toISOString()).toBe('2025-02-28T08:15:30.000Z');
  });

  it('handles negative month offsets without drifting the anchor', () => {
    expect(periodBoundary(new Date('2026-03-31T00:00:00.000Z'), -1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('rejects invalid dates and offsets', () => {
    expect(() => trialEndsAt(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => periodBoundary(new Date(), 1.5)).toThrow(RangeError);
  });

  it('resets the billing day at midnight Vietnam time', () => {
    expect(vnBillingDay(new Date('2026-09-15T16:59:59.999Z'))).toBe('2026-09-15');
    expect(vnBillingDay(new Date('2026-09-15T17:00:00.000Z'))).toBe('2026-09-16');
  });
});
