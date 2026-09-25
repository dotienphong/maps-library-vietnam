import { describe, expect, it } from 'vitest';
import { robotsTxt } from './bot';

describe('robotsTxt', () => {
  it('cho mọi bot và trỏ sitemap tuyệt đối — đúng từng dòng', () => {
    expect(robotsTxt('https://mapslibvn.pages.dev')).toBe(
      [
        'User-agent: *',
        'Allow: /',
        '',
        'Sitemap: https://mapslibvn.pages.dev/sitemap-index.xml',
        '',
      ].join('\n'),
    );
  });

  it('chỉ dùng chỉ thị Lighthouse hiểu — thêm `Content-Signal` là SEO tụt 100 → 92', () => {
    // Đo 25/09/2026 trên production: Lighthouse báo "robots.txt is not valid — Unknown directive"
    // cho dòng Content-Signal ở cả website lẫn tài liệu. PHONG chốt bỏ dòng đó.
    for (const dong of robotsTxt('https://mapslibvn.pages.dev').split('\n')) {
      if (dong === '') continue;
      expect(dong).toMatch(/^(User-agent|Allow|Disallow|Sitemap): /);
    }
  });

  it('không nhân đôi gạch chéo khi gốc lỡ có gạch cuối', () => {
    expect(robotsTxt('https://mapslibvn-docs.pages.dev/')).toContain(
      'Sitemap: https://mapslibvn-docs.pages.dev/sitemap-index.xml',
    );
  });

  it('không chặn đường dẫn nào', () => {
    expect(robotsTxt('https://mapslibvn.pages.dev')).not.toContain('Disallow');
  });
});
