import { describe, expect, it } from 'vitest';
import { overlapMetrics, selectOverlaps } from '../src/geocode/admin-overlay.mjs';

describe('selectOverlaps', () => {
  it('giữ 60/40 và chuẩn hóa tổng bằng 1', () => {
    expect(selectOverlaps([{ raw_share: 0.6 }, { raw_share: 0.4 }], 8).map((r) => r.share)).toEqual(
      [0.6, 0.4],
    );
  });
  it('loại sliver dưới 5% ở L8', () => {
    expect(selectOverlaps([{ raw_share: 0.96 }, { raw_share: 0.04 }], 8)).toEqual([
      { raw_share: 0.96, share: 1 },
    ]);
    expect(overlapMetrics([{ raw_share: 0.96 }, { raw_share: 0.04 }], 8)).toMatchObject({
      rawCoverage: 1,
      keptCoverage: 0.96,
      discardedShare: expect.closeTo(0.04, 10),
      rawMax: 0.96,
    });
  });

  it('không dùng share đã chuẩn hóa để che coverage thiếu hoặc overlap gấp đôi', () => {
    const gap = overlapMetrics([{ raw_share: 0.6 }], 8);
    expect(gap.rawCoverage).toBe(0.6);
    expect(gap.selected[0].share).toBe(1);
    expect(overlapMetrics([{ raw_share: 1 }, { raw_share: 1 }], 8).rawCoverage).toBe(2);
  });
  it('L6 không loại từng phường nhỏ hơn 5%', () => {
    const rows = selectOverlaps(
      Array.from({ length: 25 }, () => ({ raw_share: 0.04 })),
      6,
    );
    expect(rows).toHaveLength(25);
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
  });
});
