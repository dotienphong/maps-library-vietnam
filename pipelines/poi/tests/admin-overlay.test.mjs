import { describe, expect, it } from 'vitest';
import {
  overlapMetrics,
  selectOverlaps,
  unmatchedAfterSeed,
} from '../src/geocode/admin-overlay.mjs';

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

describe('unmatchedAfterSeed', () => {
  // Điều tra Cô Tô 13/09/2026: overlay hình học thô (targets=0) không còn là "chưa có alias" nếu
  // seed đã trỏ đúng đích — nếu không, cổng QA đỏ lại mỗi lần chạy dù đã có seed override đúng.
  const coverage = [
    { id: '1', level: 8, targets: 0 },
    { id: '2', level: 8, targets: 0 },
    { id: '3', level: 8, targets: 2 },
  ];

  it('loại đơn vị có ít nhất một khoá khớp seed đã áp thành công', () => {
    const keysByOldId = new Map([
      ['1', ['xa thanh lan huyen co to quang ninh', 'thanh lan']],
      ['2', ['xa khac chua co seed']],
    ]);
    const seedResolvedGroups = new Set(['8:xa thanh lan huyen co to quang ninh']);
    expect(unmatchedAfterSeed(coverage, keysByOldId, seedResolvedGroups)).toEqual([
      { id: '2', level: 8, targets: 0 },
    ]);
  });

  it('không seed nào khớp thì vẫn coi là unmatched (không nới lỏng oan)', () => {
    const keysByOldId = new Map([
      ['1', ['xa thanh lan huyen co to quang ninh']],
      ['2', ['xa khac']],
    ]);
    expect(unmatchedAfterSeed(coverage, keysByOldId, new Set())).toEqual(
      coverage.filter((row) => row.targets === 0),
    );
  });

  it('không đụng vào đơn vị đã có targets > 0, kể cả khi trùng khoá seed', () => {
    const keysByOldId = new Map([['3', ['co to']]]);
    const seedResolvedGroups = new Set(['8:co to']);
    const result = unmatchedAfterSeed(coverage, keysByOldId, seedResolvedGroups);
    expect(result.find((row) => row.id === '3')).toBeUndefined();
  });

  it('khoá seed đúng chữ nhưng khác level (4 so với 8) thì không loại trừ', () => {
    const keysByOldId = new Map([['1', ['co to']]]);
    const seedResolvedGroups = new Set(['4:co to']);
    expect(unmatchedAfterSeed(coverage, keysByOldId, seedResolvedGroups)).toEqual(
      coverage.filter((row) => row.targets === 0),
    );
  });
});
