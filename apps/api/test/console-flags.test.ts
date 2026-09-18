import { describe, expect, it } from 'vitest';
import { selfServeOpen } from '../src/console/flags';

describe('selfServeOpen', () => {
  it("chỉ mở khi SELF_SERVE đúng bằng '1'", () => {
    expect(selfServeOpen({ SELF_SERVE: '1' })).toBe(true);
  });

  it("đóng với '0', thiếu biến, hay bất kỳ chuỗi nào khác — fail closed", () => {
    expect(selfServeOpen({ SELF_SERVE: '0' })).toBe(false);
    expect(selfServeOpen({})).toBe(false);
    expect(selfServeOpen({ SELF_SERVE: 'true' })).toBe(false);
    expect(selfServeOpen({ SELF_SERVE: ' 1' })).toBe(false);
  });
});
