import { describe, expect, it } from 'vitest';
import { CONTENT_SIGNAL, robotsTxt } from './bot';

describe('robotsTxt', () => {
  it('cho mọi bot, khai Content-Signal và trỏ sitemap tuyệt đối — đúng từng dòng', () => {
    expect(robotsTxt('https://mapslibvn.pages.dev')).toBe(
      [
        'User-agent: *',
        'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
        'Allow: /',
        '',
        'Sitemap: https://mapslibvn.pages.dev/sitemap-index.xml',
        '',
      ].join('\n'),
    );
  });

  it('PHONG chốt 25/09/2026: cho cả tìm kiếm, trả lời AI lẫn huấn luyện', () => {
    expect(CONTENT_SIGNAL).toBe('search=yes, ai-input=yes, ai-train=yes');
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
