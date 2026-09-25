import { describe, expect, it } from 'vitest';
import { noiDungRobots } from './robots';

describe('robots.txt', () => {
  it('cho phép mọi bot và trỏ sitemap tuyệt đối', () => {
    const txt = noiDungRobots();
    expect(txt).toContain('User-agent: *');
    expect(txt).toContain('Allow: /');
    expect(txt).toContain('Sitemap: https://mapslibvn.pages.dev/sitemap-index.xml');
  });

  it('không chặn gì — website này không có khu vực riêng tư', () => {
    expect(noiDungRobots()).not.toContain('Disallow: /');
  });

  it('không có Content-Signal — Lighthouse coi là chỉ thị lạ và hạ SEO xuống 92', () => {
    expect(noiDungRobots()).not.toContain('Content-Signal');
  });

  it('kết thúc bằng dòng trống, đúng quy ước tệp văn bản', () => {
    expect(noiDungRobots().endsWith('\n')).toBe(true);
  });
});
