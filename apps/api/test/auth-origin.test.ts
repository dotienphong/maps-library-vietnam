import { describe, expect, it } from 'vitest';
import { originAllowed } from '../src/auth';

describe('originAllowed', () => {
  const allowed = ['http://localhost', 'https://docs.example.com', 'https://*.pages.dev'];

  it('khớp hostname bất kể port', () => {
    expect(originAllowed('http://localhost:4321', allowed)).toBe(true);
    expect(originAllowed('http://localhost:8787', allowed)).toBe(true);
  });

  it('khớp đúng domain, đúng protocol', () => {
    expect(originAllowed('https://docs.example.com', allowed)).toBe(true);
    expect(originAllowed('http://docs.example.com', allowed)).toBe(false);
  });

  it('wildcard subdomain khớp mọi cấp con và cả gốc', () => {
    expect(originAllowed('https://mapslibvn.pages.dev', allowed)).toBe(true);
    expect(originAllowed('https://deep.a.pages.dev', allowed)).toBe(true);
    expect(originAllowed('https://pages.dev', allowed)).toBe(true);
  });

  it('không khớp domain lạ hoặc origin hỏng', () => {
    expect(originAllowed('https://evil.test', allowed)).toBe(false);
    expect(originAllowed('not-a-url', allowed)).toBe(false);
    expect(originAllowed('https://xpages.dev', allowed)).toBe(false);
  });

  it('danh sách rỗng = cho phép tất cả (khoá server/mobile lưu {})', () => {
    expect(originAllowed('https://anything.test', [])).toBe(true);
  });
});
