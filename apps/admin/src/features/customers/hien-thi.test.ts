import { describe, expect, it } from 'vitest';
import { rutGonUA } from './hien-thi';

describe('rutGonUA', () => {
  it('nhận ra trình duyệt và hệ điều hành phổ biến', () => {
    expect(
      rutGonUA(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari · iPhone');
    expect(
      rutGonUA(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      ),
    ).toBe('Edge · Windows');
    expect(
      rutGonUA(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome · Android');
    expect(
      rutGonUA(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome · macOS');
    expect(
      rutGonUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'),
    ).toBe('Firefox · Windows');
  });

  it('không nhận ra thì trả 40 ký tự đầu; null thành "không rõ"', () => {
    expect(rutGonUA(null)).toBe('không rõ');
    expect(rutGonUA('curl/8.4.0')).toBe('curl/8.4.0');
    expect(rutGonUA('x'.repeat(60))).toBe(`${'x'.repeat(40)}…`);
    // Nhận ra trình duyệt (Chrome/) nhưng hệ điều hành lạ (Chrome OS) — không ghép được cặp nên
    // vẫn rơi về cắt thô 40 ký tự đầu, không đoán bừa hệ điều hành.
    const uaChromeOs =
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    expect(rutGonUA(uaChromeOs)).toBe(`${uaChromeOs.slice(0, 40)}…`);
  });
});
