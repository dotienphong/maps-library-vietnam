import { describe, expect, it } from 'vitest';
import { fsqFlagDecision } from '../src/lib/fsq-flags.mjs';

describe('fsqFlagDecision (unresolved_flags của FSQ OS Places)', () => {
  it('không cờ → giữ, không đóng', () => {
    expect(fsqFlagDecision(null)).toEqual({ drop: false, closed: false });
    expect(fsqFlagDecision(undefined)).toEqual({ drop: false, closed: false });
    expect(fsqFlagDecision([])).toEqual({ drop: false, closed: false });
  });

  it('doesnt_exist / delete / inappropriate / privatevenue → bỏ', () => {
    for (const flag of ['doesnt_exist', 'delete', 'inappropriate', 'privatevenue'])
      expect(fsqFlagDecision([flag]).drop, flag).toBe(true);
  });

  it('closed → đóng; duplicate chỉ là tín hiệu phụ, không đổi gì', () => {
    expect(fsqFlagDecision(['closed'])).toEqual({ drop: false, closed: true });
    expect(fsqFlagDecision(['duplicate'])).toEqual({ drop: false, closed: false });
    expect(fsqFlagDecision(['duplicate', 'closed'])).toEqual({ drop: false, closed: true });
  });

  it('nhận cả chuỗi mảng Postgres lẫn mảng JS', () => {
    expect(fsqFlagDecision('{closed,duplicate}')).toEqual({ drop: false, closed: true });
    expect(fsqFlagDecision('{}')).toEqual({ drop: false, closed: false });
  });
});
