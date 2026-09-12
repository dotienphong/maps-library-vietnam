import type { GeoFix, HeadingFix } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_USER_ACCURACY_M,
  accuracyRadiusExpression,
  metersPerPixel,
  userLocationFeature,
} from './feature';

const fix: GeoFix = { lng: 106.7, lat: 10.78, accuracy_m: 12, timestamp: 1 };
const heading: HeadingFix = { heading: 90, accuracy: 'high', timestamp: 1, source: 'fused' };

describe('userLocationFeature', () => {
  it('một Point có bearing/hasHeading/hasReliableHeading/accuracy_m', () => {
    const fc = userLocationFeature(fix, heading);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [106.7, 10.78] });
    expect(fc.features[0]?.properties).toEqual({
      kind: 'user',
      bearing: 90,
      hasHeading: true,
      hasReliableHeading: true,
      accuracy_m: 12,
    });
  });
  it('không heading → bearing 0, hasHeading false; unreliable → hasReliableHeading false; thiếu sai số → mặc định', () => {
    const a = userLocationFeature({ lng: 1, lat: 2, timestamp: 1 }, null);
    expect(a.features[0]?.properties).toMatchObject({
      bearing: 0,
      hasHeading: false,
      hasReliableHeading: false,
      accuracy_m: DEFAULT_USER_ACCURACY_M,
    });
    const b = userLocationFeature(fix, { ...heading, accuracy: 'unreliable' });
    expect(b.features[0]?.properties).toMatchObject({
      hasHeading: true,
      hasReliableHeading: false,
    });
  });
});

describe('metersPerPixel / accuracyRadiusExpression', () => {
  it('Web Mercator tile 512: 78271,517 m/px ở xích đạo zoom 0; giảm nửa mỗi zoom; theo cos(vĩ độ)', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 2);
    expect(metersPerPixel(0, 1)).toBeCloseTo(39135.758, 2);
    expect(metersPerPixel(10.8, 16)).toBeCloseTo(1.1732, 3);
    expect(metersPerPixel(21, 16)).toBeCloseTo(1.115, 3);
  });
  it('expression interpolate exponential base 2 từ zoom 0 tới 24, bán kính px = m / (m/px)', () => {
    const e = accuracyRadiusExpression(50, 10.8) as unknown[];
    expect(e.slice(0, 3)).toEqual(['interpolate', ['exponential', 2], ['zoom']]);
    expect(e[3]).toBe(0);
    expect(e[4]).toBeCloseTo(50 / metersPerPixel(10.8, 0), 9);
    expect(e[5]).toBe(24);
    expect(e[6]).toBeCloseTo(50 / metersPerPixel(10.8, 24), 6);
    expect((e[6] as number) / (e[4] as number)).toBeCloseTo(2 ** 24, 3);
  });
});
