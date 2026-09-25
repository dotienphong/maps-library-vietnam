import { DOCS, DOCS_LLMS, PLAN_CATALOG } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import { CONSOLE_URL, SUPPORT_EMAIL } from '../../site.config.mjs';
import { dinhDangSo, dinhDangVnd } from './gia';
import { noiDungLlms } from './llms';
import { canonicalUrl } from './seo';
import { TRANG } from './trang';

const BAI = [
  { slug: 'bai-cu', title: 'Bài cũ', description: 'Mô tả bài cũ', publishedAt: '2026-09-01' },
  { slug: 'bai-moi', title: 'Bài mới', description: 'Mô tả bài mới', publishedAt: '2026-09-20' },
];

describe('noiDungLlms', () => {
  const txt = noiDungLlms(BAI);

  it('mở đầu đúng khuôn llmstxt.org: H1 rồi blockquote là nguyên văn mô tả trang chủ', () => {
    const [dau, trong, tomTat] = txt.split('\n');
    expect(dau).toBe('# MapsLibVN');
    expect(trong).toBe('');
    expect(tomTat).toBe(`> ${TRANG.trangChu.description}`);
  });

  it('liệt kê mọi trang chính kèm mô tả, trừ trang chủ và 404', () => {
    for (const trang of Object.values(TRANG)) {
      if (trang.path === TRANG.trangChu.path || trang.path === TRANG.khong404.path) continue;
      expect(txt).toContain(`- [${trang.h1}](${canonicalUrl(trang.path)}): ${trang.description}`);
    }
    expect(txt).not.toContain(canonicalUrl(TRANG.khong404.path));
  });

  it('giá và hạn mức từng gói lấy thẳng từ catalog', () => {
    for (const tier of ['starter', 'professional', 'business'] as const) {
      const goi = PLAN_CATALOG[tier];
      expect(txt).toContain(
        `${dinhDangVnd(goi.priceVnd)} mỗi tháng, ${dinhDangSo(goi.places)} lượt Places, ${dinhDangSo(goi.directions)} lượt tính tuyến`,
      );
    }
    expect(txt).toContain(
      `Dùng thử: miễn phí 30 ngày, ${dinhDangSo(PLAN_CATALOG.trial.places)} lượt Places`,
    );
  });

  it('bài viết mới nhất đứng trước, link tuyệt đối có gạch cuối', () => {
    expect(txt.indexOf('[Bài mới]')).toBeLessThan(txt.indexOf('[Bài cũ]'));
    expect(txt).toContain(`- [Bài mới](${canonicalUrl('/bai-viet/bai-moi/')}): Mô tả bài mới`);
  });

  it('không có bài nào thì bỏ hẳn mục Bài viết', () => {
    expect(noiDungLlms([])).not.toContain('## Bài viết');
  });

  it('trỏ sang mục lục tài liệu cho LLM, trang đăng ký và liên hệ', () => {
    expect(txt).toContain(DOCS_LLMS);
    expect(txt).toContain(DOCS.batDau);
    expect(txt).toContain(DOCS.khoaApi);
    expect(txt).toContain(DOCS.api);
    expect(txt).toContain(CONSOLE_URL);
    expect(txt).toContain(SUPPORT_EMAIL);
  });

  it('không lộ khoá, không mời tự host, không dẫn về repo', () => {
    expect(txt).not.toMatch(/mlv_live_[0-9A-Za-z]{24}/);
    expect(txt).not.toMatch(/tự host|self-host/i);
    expect(txt).not.toContain('github.com');
  });

  it('kết thúc bằng đúng một dấu xuống dòng', () => {
    expect(txt.endsWith('\n')).toBe(true);
    expect(txt.endsWith('\n\n')).toBe(false);
  });
});
