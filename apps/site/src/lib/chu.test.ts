import { describe, expect, it } from 'vitest';
import { laAscii } from './chu';

describe('laAscii', () => {
  it('chuỗi ASCII in được → true (an toàn cho JetBrains Mono)', () => {
    expect(laAscii('SDK')).toBe(true);
    expect(laAscii('$ npm i @mapslibvn/web')).toBe(true);
    expect(laAscii('37-68%')).toBe(true);
  });

  it('có dấu tiếng Việt hoặc ký hiệu ngoài ASCII → false', () => {
    expect(laAscii('TÍNH NĂNG')).toBe(false);
    // Gạch ngang dài U+2013 không có trong subset latin của font mono.
    expect(laAscii('37–68%')).toBe(false);
    expect(laAscii('Đ')).toBe(false);
  });

  it('rỗng → false', () => {
    expect(laAscii('')).toBe(false);
  });
});
