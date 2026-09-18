import { describe, expect, it } from 'vitest';
import { COMPARISON, comparisonAgeDays, savingsPercent } from './comparison';
import { PLAN_CATALOG } from './plans';

describe('COMPARISON', () => {
  it('ba dòng workload đúng thứ tự Starter → Professional → Business', () => {
    expect(COMPARISON.rows.map((row) => row.tier)).toEqual(['starter', 'professional', 'business']);
  });

  it('giá MapsLibVN trong bảng khớp PLAN_CATALOG — không có bản chép tay thứ hai', () => {
    for (const row of COMPARISON.rows) {
      const plan = PLAN_CATALOG[row.tier];
      expect(row.mapslibvnUsd).toBe(plan.priceCents / 100);
      expect(row.mapslibvnVnd).toBe(plan.priceVnd);
      expect(row.places).toBe(plan.places);
      expect(row.directions).toBe(plan.directions);
    }
  });

  it('số đối thủ đúng bản đối chiếu 14/09/2026', () => {
    expect(COMPARISON.rows[0]).toMatchObject({ googleUsd: 39.62, vietmapUsd: 63.46 });
    expect(COMPARISON.rows[1]).toMatchObject({ googleUsd: 248.1, vietmapUsd: 211.54 });
    expect(COMPARISON.rows[2]).toMatchObject({ googleUsd: 1254.1, vietmapUsd: 846.15 });
    expect(COMPARISON.rows[0]).toMatchObject({ googleVnd: 1_030_120, vietmapVnd: 1_650_000 });
    expect(COMPARISON.rows[1]).toMatchObject({ googleVnd: 6_450_600, vietmapVnd: 5_500_000 });
    expect(COMPARISON.rows[2]).toMatchObject({ googleVnd: 32_606_600, vietmapVnd: 22_000_000 });
  });

  it('có ngày đối chiếu hợp lệ, ba nguồn và lời dặn không quảng cáo cho mọi workload', () => {
    expect(COMPARISON.checkedAt).toBe('2026-09-14');
    expect(Number.isNaN(Date.parse(COMPARISON.checkedAt))).toBe(false);
    expect(COMPARISON.sources).toHaveLength(3);
    for (const url of COMPARISON.sources) expect(url).toMatch(/^https:\/\//);
    expect(COMPARISON.disclaimer).toMatch(/mọi workload/);
    expect(COMPARISON.assumptions.length).toBeGreaterThanOrEqual(3);
  });
});

describe('savingsPercent', () => {
  it('cho ra đúng sáu con số của tài liệu nghiên cứu (làm tròn hai chữ số)', () => {
    const [s, p, b] = COMPARISON.rows;
    expect(savingsPercent(s.mapslibvnUsd, s.googleUsd)).toBe(36.9);
    expect(savingsPercent(s.mapslibvnUsd, s.vietmapUsd)).toBe(60.61);
    expect(savingsPercent(p.mapslibvnUsd, p.googleUsd)).toBe(59.69);
    expect(savingsPercent(p.mapslibvnUsd, p.vietmapUsd)).toBe(52.73);
    expect(savingsPercent(b.mapslibvnUsd, b.googleUsd)).toBe(68.1);
    expect(savingsPercent(b.mapslibvnUsd, b.vietmapUsd)).toBe(52.73);
  });

  it('không chia cho 0', () => {
    expect(() => savingsPercent(1, 0)).toThrow(RangeError);
  });
});

describe('comparisonAgeDays', () => {
  it('đếm số ngày từ ngày đối chiếu tới hôm nay', () => {
    expect(comparisonAgeDays(new Date('2026-09-14T00:00:00Z'))).toBe(0);
    expect(comparisonAgeDays(new Date('2026-09-18T12:00:00Z'))).toBe(4);
    expect(comparisonAgeDays(new Date('2027-03-13T00:00:00Z'))).toBe(180);
  });
});
