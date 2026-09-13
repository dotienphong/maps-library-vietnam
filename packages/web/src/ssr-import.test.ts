import { describe, expect, it } from 'vitest';

/**
 * File này PHẢI chạy ở môi trường Node trần — tuyệt đối không đặt docblock chọn jsdom ở đầu file,
 * và cũng không viết chuỗi chỉ định môi trường đó ở bất cứ đâu trong file: vitest quét toàn bộ nội
 * dung file để tìm chuỗi ấy, nên chỉ cần nhắc tới nó trong một câu chú thích là cả file lặng lẽ
 * chuyển sang jsdom và bài test mất sạch ý nghĩa (đã dính đúng bẫy này khi viết).
 *
 * Node trần là đúng tình huống host dựng trang phía máy chủ (Next.js, Remix, Astro) hoặc chạy test
 * ở môi trường node. Trước 13/09/2026 `class MapsLibVNAutocomplete extends HTMLElement` được đánh
 * giá ngay lúc nạp module, nên `import '@mapslibvn/web'` — và `@mapslibvn/react` vì react import
 * web — ném `ReferenceError: HTMLElement is not defined` trước khi bất kỳ component nào kịp render.
 *
 * Test nhắm THẲNG vào `./autocomplete-element`, không đi qua `./index`: Vite nạp lười các lệnh xuất
 * lại trong barrel nên import barrel ở tầng nguồn không tái hiện lỗi, trong khi bản `dist` tsup gói
 * thành một file thì ném thật. Mô đun này mới là chỗ bất biến cần ghim.
 */
describe('nạp module trong môi trường không có DOM', () => {
  it('môi trường test này thật sự không có DOM', () => {
    expect(typeof HTMLElement).toBe('undefined');
    expect(typeof customElements).toBe('undefined');
  });

  it('autocomplete-element import được và vẫn phơi đủ API', async () => {
    const mod = await import('./autocomplete-element');
    expect(typeof mod.defineAutocomplete).toBe('function');
    expect(typeof mod.MapsLibVNAutocomplete).toBe('function');
  });

  it('defineAutocomplete() là no-op, không ném khi thiếu customElements', async () => {
    const { defineAutocomplete } = await import('./autocomplete-element');
    expect(() => defineAutocomplete()).not.toThrow();
  });

  it('barrel cũng import được và phơi đủ API', async () => {
    const mod = await import('./index');
    expect(typeof mod.createMap).toBe('function');
    expect(typeof mod.defineAutocomplete).toBe('function');
  });
});
