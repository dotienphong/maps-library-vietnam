import { describe, expect, it } from 'vitest';
import { backupName, retentionPlan } from './backup-plan.mjs';

describe('backupName', () => {
  it('tên theo giờ VN', () => {
    expect(backupName(new Date('2026-08-25T20:00:00Z'))).toBe('mapslibvn-20260826-0300.dump.zst');
  });
});

describe('retentionPlan', () => {
  const daily = Array.from(
    { length: 10 },
    (_, i) => `mapslibvn-202608${String(10 + i).padStart(2, '0')}-0300.dump.zst`,
  );
  it('giữ 7 bản ngày mới nhất, xoá phần còn lại', () => {
    const plan = retentionPlan({ daily, weekly: [] }, { keepDaily: 7, keepWeekly: 4 });
    expect(plan.deleteDaily).toEqual(daily.slice(0, 3));
    expect(plan.deleteWeekly).toEqual([]);
  });
  it('weekly giữ 4', () => {
    const weekly = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((w) => `mapslibvn-2026${w}.dump.zst`);
    const plan = retentionPlan({ daily: [], weekly }, { keepDaily: 7, keepWeekly: 4 });
    expect(plan.deleteWeekly).toEqual(weekly.slice(0, 2));
  });
  it('tên sắp theo chuỗi nên bản mới nhất ở cuối', () => {
    const plan = retentionPlan(
      { daily: ['b', 'a', 'c'], weekly: [] },
      { keepDaily: 2, keepWeekly: 1 },
    );
    expect(plan.deleteDaily).toEqual(['a']);
  });
});
