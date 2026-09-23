import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { formatIsoAt, parseIsoWithOffset } from '../src/routing/fleet-time';

const T = '2026-09-24T08:00:00+07:00';
const T_UNIX = Date.parse(T) / 1000;

const expect400 = (fn: () => unknown, re: RegExp) => {
  try {
    fn();
    throw new Error('phải ném');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toMatch(re);
  }
};

describe('parseIsoWithOffset', () => {
  it('+07:00 → unix và lệch 420 phút; Z → 0; -05:30 → -330; giây tuỳ chọn', () => {
    expect(parseIsoWithOffset(T, 'x')).toEqual({ unix: T_UNIX, offsetMin: 420 });
    expect(parseIsoWithOffset('2026-09-24T01:00Z', 'x')).toEqual({ unix: T_UNIX, offsetMin: 0 });
    expect(parseIsoWithOffset('2026-09-23T19:30:00-05:30', 'x').offsetMin).toBe(-330);
    expect(parseIsoWithOffset('2026-09-23T19:30:00-05:30', 'x').unix).toBe(T_UNIX);
  });

  it('thiếu múi giờ, không phải chuỗi, ngày vô lý → 400 nêu tên trường', () => {
    expect400(
      () => parseIsoWithOffset('2026-09-24T08:00:00', 'vehicles[0].time_window[0]'),
      /múi giờ/,
    );
    expect400(() => parseIsoWithOffset('2026-09-24 08:00+07:00', 'x'), /ISO 8601/);
    expect400(() => parseIsoWithOffset(1790000000, 'jobs[2].time_windows[0][1]'), /jobs\[2\]/);
    expect400(() => parseIsoWithOffset('2026-13-40T08:00:00+07:00', 'x'), /không phải thời điểm/);
    expect400(() => parseIsoWithOffset('2026-02-30T08:00:00+07:00', 'x'), /không phải thời điểm/);
  });
});

describe('formatIsoAt', () => {
  it('đi và về cùng múi giờ; Z khi lệch 0; không mili giây', () => {
    expect(formatIsoAt(T_UNIX, 420)).toBe(T);
    expect(formatIsoAt(T_UNIX, 0)).toBe('2026-09-24T01:00:00Z');
    expect(formatIsoAt(T_UNIX, -330)).toBe('2026-09-23T19:30:00-05:30');
    expect(formatIsoAt(T_UNIX + 754, 420)).toBe('2026-09-24T08:12:34+07:00');
  });
});
