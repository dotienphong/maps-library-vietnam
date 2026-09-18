import { PLAN_CATALOG } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import {
  articleJsonLd,
  breadcrumbJsonLd,
  canonicalUrl,
  faqJsonLd,
  organizationJsonLd,
  seoMeta,
  softwareApplicationJsonLd,
} from './seo';
import { TRANG } from './trang';

describe('canonicalUrl', () => {
  it('ghép đúng gốc site, không nhân đôi dấu gạch', () => {
    expect(canonicalUrl('/')).toBe('https://mapslibvn-site.pages.dev/');
    expect(canonicalUrl('/bang-gia/')).toBe('https://mapslibvn-site.pages.dev/bang-gia/');
  });

  it('luôn có dấu gạch cuối — hai URL khác nhau cho cùng một trang là tự chia điểm SEO', () => {
    expect(canonicalUrl('/bang-gia')).toBe('https://mapslibvn-site.pages.dev/bang-gia/');
  });
});

describe('seoMeta', () => {
  it('mang đủ canonical, og và twitter cho một trang thường', () => {
    const meta = seoMeta(TRANG.bangGia);
    expect(meta.canonical).toBe('https://mapslibvn-site.pages.dev/bang-gia/');
    expect(meta.og.title).toBe(TRANG.bangGia.title);
    expect(meta.og.type).toBe('website');
    expect(meta.og.url).toBe(meta.canonical);
    expect(meta.og.image).toBe('https://mapslibvn-site.pages.dev/og/bang-gia.png');
    expect(meta.og.locale).toBe('vi_VN');
    expect(meta.twitter.card).toBe('summary_large_image');
  });

  it('trang không khai ảnh OG thì dùng ảnh mặc định', () => {
    expect(seoMeta(TRANG.tinhNang).og.image).toBe(
      'https://mapslibvn-site.pages.dev/og/mac-dinh.png',
    );
  });

  it('bài viết khai type article và ngày đăng', () => {
    const meta = seoMeta(TRANG.baiViet, { type: 'article', publishedAt: '2026-09-18' });
    expect(meta.og.type).toBe('article');
    expect(meta.og.publishedTime).toBe('2026-09-18');
  });
});

describe('JSON-LD', () => {
  it('Organization có tên, URL, email và số điện thoại liên hệ', () => {
    const ld = organizationJsonLd();
    expect(ld['@type']).toBe('Organization');
    expect(ld.name).toBe('MapsLibVN');
    expect(ld.url).toBe('https://mapslibvn-site.pages.dev/');
    expect(ld.contactPoint.email).toBe('dotienphong1993@gmail.com');
    // Dạng E.164, không khoảng trắng: đây là số máy đọc, khác dạng hiển thị cho người.
    expect(ld.contactPoint.telephone).toBe('+84983450456');
  });

  it('SoftwareApplication mang đúng bốn gói với giá VND lấy từ catalog', () => {
    const ld = softwareApplicationJsonLd();
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.offers).toHaveLength(4);
    const starter = ld.offers.find((offer) => offer.name.includes('Starter'));
    expect(starter?.price).toBe(String(PLAN_CATALOG.starter.priceVnd));
    expect(starter?.priceCurrency).toBe('VND');
    const trial = ld.offers.find((offer) => offer.name.includes('thử'));
    expect(trial?.price).toBe('0');
  });

  it('FAQPage sinh đúng số câu và giữ nguyên nội dung', () => {
    const ld = faqJsonLd([{ hoi: 'Tính lượt thế nào?', dap: 'Chỉ trừ request thành công.' }]);
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity).toHaveLength(1);
    expect(ld.mainEntity[0]?.name).toBe('Tính lượt thế nào?');
    expect(ld.mainEntity[0]?.acceptedAnswer.text).toBe('Chỉ trừ request thành công.');
  });

  it('Article và BreadcrumbList dựng đúng URL tuyệt đối', () => {
    const article = articleJsonLd({
      title: 'Chi phí Google Maps API',
      description: 'Mô tả',
      path: '/bai-viet/chi-phi-google/',
      publishedAt: '2026-09-18',
    });
    expect(article.mainEntityOfPage).toBe(
      'https://mapslibvn-site.pages.dev/bai-viet/chi-phi-google/',
    );
    expect(article.datePublished).toBe('2026-09-18');

    const bread = breadcrumbJsonLd([
      { ten: 'Trang chủ', path: '/' },
      { ten: 'Bài viết', path: '/bai-viet/' },
    ]);
    expect(bread.itemListElement).toHaveLength(2);
    expect(bread.itemListElement[1]?.position).toBe(2);
    expect(bread.itemListElement[1]?.item).toBe('https://mapslibvn-site.pages.dev/bai-viet/');
  });

  it('mọi khối JSON-LD serialize được và có @context', () => {
    for (const ld of [organizationJsonLd(), softwareApplicationJsonLd(), faqJsonLd([])]) {
      expect(ld['@context']).toBe('https://schema.org');
      expect(() => JSON.parse(JSON.stringify(ld))).not.toThrow();
    }
  });
});
