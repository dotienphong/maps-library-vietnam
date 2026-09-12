import { describe, expect, it } from 'vitest';
import { PUCK_SIZE, tweenDuration, unwrapTo } from './puck-math';

describe('unwrapTo', () => {
  it('đi đường ngắn qua mốc 0/360 trên trục góc liên tục (Animated không biết vòng tròn)', () => {
    expect(unwrapTo(350, 10)).toBe(370); // 350 → 10 là +20, không phải −340
    expect(unwrapTo(370, 350)).toBe(350);
    expect(unwrapTo(10, 350)).toBe(-10);
    expect(unwrapTo(725, 0)).toBe(720); // 725 ≡ 5 → 0 là −5
    expect(unwrapTo(0, 180)).toBe(180); // đúng 180 → đi chiều dương
  });
});

describe('tweenDuration', () => {
  it('bằng khoảng cách hai lần phát, kẹp [16, 250] ms — nội suy tuyến tính vừa đúng tới lần phát kế', () => {
    expect(tweenDuration(33)).toBe(33);
    expect(tweenDuration(5)).toBe(16);
    expect(tweenDuration(1000)).toBe(250);
    expect(tweenDuration(Number.NaN)).toBe(16);
  });
  it('kích cỡ puck cố định để MarkerView đo được trước khi gắn vào map', () => {
    expect(PUCK_SIZE).toBeGreaterThan(0);
  });
});
