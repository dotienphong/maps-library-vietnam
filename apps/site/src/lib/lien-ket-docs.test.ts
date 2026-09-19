import { DOCS, DOCS_URL } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import { DOCS_URL as DOCS_URL_SITE } from '../../site.config.mjs';

describe('địa chỉ tài liệu', () => {
  it('website và gói dùng chung phải ghi CÙNG một địa chỉ', () => {
    // Website là tệp `.mjs` thuần cho Astro nên không import được gói TypeScript ở thời điểm cấu
    // hình; hai nơi cùng ghi một URL là hai nơi có thể lệch khi đổi tên miền. Bài này là thứ duy
    // nhất nối chúng lại.
    expect(DOCS_URL_SITE).toBe(DOCS_URL);
  });

  it('mọi đường dẫn tài liệu đều tuyệt đối và kết thúc bằng dấu gạch chéo', () => {
    for (const [ten, url] of Object.entries(DOCS)) {
      expect(url, ten).toMatch(/^https:\/\//);
      // Thiếu gạch chéo cuối thì Starlight chuyển hướng, tốn một vòng cho mỗi cú bấm.
      expect(url, ten).toMatch(/\/$/);
      expect(url, ten).toContain(DOCS_URL);
    }
  });
});
