import { describe, expect, it } from 'vitest';
import { SOURCE_ORDER, pickPrimary, popularity, qualityScore } from '../src/score.mjs';

describe('qualityScore (spec 5.5)', () => {
  it('đủ mọi trường, 2 nguồn, mới → 100', () => {
    expect(
      qualityScore({
        hasPhone: true,
        hasWebsite: true,
        hasHours: true,
        hasHousenumber: true,
        sourceCount: 2,
        confidence: 1,
        monthsOld: 3,
      }),
    ).toBe(100);
  });
  it('1 nguồn confidence 0,5, không trường, 30 tháng → 10 (conf) + 10 (độ mới)', () => {
    expect(
      qualityScore({
        hasPhone: false,
        hasWebsite: false,
        hasHours: false,
        hasHousenumber: false,
        sourceCount: 1,
        confidence: 0.5,
        monthsOld: 30,
      }),
    ).toBe(20);
  });
  it('độ mới: ≤ 12 tháng = 20, ≥ 48 tháng = 0; 1 nguồn confidence ≥ 0,7 được 10 đồng thuận', () => {
    expect(
      qualityScore({
        hasPhone: true,
        hasWebsite: false,
        hasHours: false,
        hasHousenumber: false,
        sourceCount: 1,
        confidence: 0.7,
        monthsOld: 60,
      }),
    ).toBe(10 + 10 + 14);
  });
});

describe('popularity', () => {
  it('log2(1+nguồn) + 0,5 nếu có FSQ + 0,2/đóng góp (tối đa 1)', () => {
    expect(popularity({ sourceCount: 1, hasFsq: false })).toBe(1);
    expect(popularity({ sourceCount: 3, hasFsq: true })).toBe(2.5);
    expect(popularity({ sourceCount: 1, hasFsq: false, approvedEdits: 10 })).toBe(2);
  });
});

describe('pickPrimary', () => {
  it('điểm đầy đủ cao nhất; hoà → OSM > FSQ', () => {
    expect(SOURCE_ORDER).toEqual({ osm: 0, fsq: 1 });
    expect(
      pickPrimary([
        { rid: 1, source: 'osm', completeness: 8 },
        { rid: 2, source: 'fsq', completeness: 9 },
      ]).rid,
    ).toBe(2);
    expect(
      pickPrimary([
        { rid: 1, source: 'fsq', completeness: 8 },
        { rid: 2, source: 'osm', completeness: 8 },
      ]).rid,
    ).toBe(2);
  });
  it('cùng điểm và cùng nguồn → rid thấp hơn, không phụ thuộc thứ tự mảng', () => {
    expect(
      pickPrimary([
        { rid: 9, source: 'fsq', completeness: 8 },
        { rid: 4, source: 'fsq', completeness: 8 },
      ]).rid,
    ).toBe(4);
  });
});
