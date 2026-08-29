import { describe, expect, it } from 'vitest';
import { nextRun } from './schedule.mjs';

describe('nextRun (giờ VN, UTC+7)', () => {
  it('hằng ngày 03:00 VN: từ 26/08 01:00 VN → 26/08 03:00 VN', () => {
    const now = new Date('2026-08-25T18:00:00Z'); // 26/08 01:00 VN
    expect(nextRun(now, { hour: 3, minute: 0 }).toISOString()).toBe('2026-08-25T20:00:00.000Z');
  });
  it('hằng ngày 03:00 VN: từ 26/08 03:00:01 VN → 27/08 03:00 VN', () => {
    const now = new Date('2026-08-25T20:00:01Z');
    expect(nextRun(now, { hour: 3, minute: 0 }).toISOString()).toBe('2026-08-26T20:00:00.000Z');
  });
  it('thứ Hai 02:00 VN: từ thứ Tư 26/08/2026 → thứ Hai 31/08 02:00 VN = 30/08 19:00Z', () => {
    const now = new Date('2026-08-26T05:00:00Z');
    expect(nextRun(now, { hour: 2, minute: 0, weekday: 1 }).toISOString()).toBe(
      '2026-08-30T19:00:00.000Z',
    );
  });
  it('đúng thời điểm chạy → lần kế tiếp là tuần sau', () => {
    const now = new Date('2026-08-30T19:00:00Z');
    expect(nextRun(now, { hour: 2, minute: 0, weekday: 1 }).toISOString()).toBe(
      '2026-09-06T19:00:00.000Z',
    );
  });
});
