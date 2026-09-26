import { describe, expect, it } from 'vitest';
import { nestCoverage } from '../src/lib/coverage.mjs';

describe('nestCoverage — POI active theo tỉnh × nhóm × nguồn', () => {
  const rows = [
    { province: 'Lai Châu', group_code: 'place', source: 'osm', n: 5 },
    { province: 'Lai Châu', group_code: 'food_drink', source: 'fsq', n: 2 },
    { province: 'Thành phố Hồ Chí Minh', group_code: 'food_drink', source: 'fsq', n: 90 },
    { province: 'Thành phố Hồ Chí Minh', group_code: 'food_drink', source: 'osm', n: 10 },
    { province: null, group_code: 'other', source: 'user', n: 1 },
  ];

  it('gộp tổng, theo nguồn, theo nhóm; tỉnh null gom vào "(không rõ)"', () => {
    const out = nestCoverage(rows);
    expect(out['Thành phố Hồ Chí Minh']).toEqual({
      total: 100,
      bySource: { fsq: 90, osm: 10 },
      byGroup: { food_drink: 100 },
    });
    expect(out['Lai Châu']).toEqual({
      total: 7,
      bySource: { osm: 5, fsq: 2 },
      byGroup: { place: 5, food_drink: 2 },
    });
    expect(out['(không rõ)']?.total).toBe(1);
  });

  it('thứ tự khoá theo tổng POI giảm dần', () => {
    expect(Object.keys(nestCoverage(rows))).toEqual([
      'Thành phố Hồ Chí Minh',
      'Lai Châu',
      '(không rõ)',
    ]);
  });
});
