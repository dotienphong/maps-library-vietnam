import { describe, expect, it } from 'vitest';
import {
  DOCS_WEBSITE_ID,
  type JsonLdDocs,
  jsonLdDocs,
  KHONG_INDEX,
  OG_DOCS,
  ORG_ID,
  theHeadDocs,
} from './seo-docs';

const TRANG = {
  id: 'api',
  title: 'REST API bản đồ, geocode và dẫn đường',
  description: 'Mô tả trang',
  url: 'https://mapslibvn-docs.pages.dev/api/',
  dateModified: '2026-09-24T14:24:50.000Z',
  datePublished: '2026-09-04T09:57:10+07:00',
};

const nut = (ld: JsonLdDocs, loai: string) => ld['@graph'].filter((n) => n['@type'] === loai);
const loaiNut = (ld: JsonLdDocs) => ld['@graph'].map((n) => n['@type']).sort();

describe('jsonLdDocs', () => {
  it('trang thường có đủ Organization, WebSite, TechArticle, BreadcrumbList', () => {
    const ld = jsonLdDocs(TRANG);
    expect(ld['@context']).toBe('https://schema.org');
    expect(loaiNut(ld)).toEqual(['BreadcrumbList', 'Organization', 'TechArticle', 'WebSite']);
  });

  it('Organization dùng ĐÚNG @id của website để hai tên miền là một chủ', () => {
    const [org] = nut(jsonLdDocs(TRANG), 'Organization');
    expect(ORG_ID).toBe('https://mapslibvn.pages.dev/#organization');
    expect(org?.['@id']).toBe(ORG_ID);
    expect(org?.logo).toBe('https://mapslibvn.pages.dev/logo-512.png');
  });

  it('TechArticle mang ngày, ảnh, ngôn ngữ và trỏ về tổ chức', () => {
    const [bai] = nut(jsonLdDocs(TRANG), 'TechArticle');
    expect(bai?.headline).toBe(TRANG.title);
    expect(bai?.url).toBe(TRANG.url);
    expect(bai?.dateModified).toBe(TRANG.dateModified);
    expect(bai?.datePublished).toBe(TRANG.datePublished);
    expect(bai?.image).toBe(OG_DOCS);
    expect(bai?.inLanguage).toBe('vi');
    expect(bai?.author).toEqual({ '@id': ORG_ID });
    expect(bai?.publisher).toEqual({ '@id': ORG_ID });
    expect(bai?.isPartOf).toEqual({ '@id': DOCS_WEBSITE_ID });
  });

  it('thiếu ngày thì bỏ hẳn trường, không ghi undefined hay chuỗi rỗng', () => {
    const [bai] = nut(
      jsonLdDocs({ ...TRANG, dateModified: undefined, datePublished: undefined }),
      'TechArticle',
    );
    expect(bai).not.toHaveProperty('dateModified');
    expect(bai).not.toHaveProperty('datePublished');
  });

  it('trang chủ docs chỉ có Organization và WebSite', () => {
    const ld = jsonLdDocs({ ...TRANG, id: '', url: 'https://mapslibvn-docs.pages.dev/' });
    expect(loaiNut(ld)).toEqual(['Organization', 'WebSite']);
  });

  it('BreadcrumbList hai bậc: Tài liệu → trang', () => {
    const [bc] = nut(jsonLdDocs(TRANG), 'BreadcrumbList');
    expect(bc?.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Tài liệu',
        item: 'https://mapslibvn-docs.pages.dev/',
      },
      { '@type': 'ListItem', position: 2, name: TRANG.title, item: TRANG.url },
    ]);
  });
});

describe('theHeadDocs', () => {
  const the = theHeadDocs(TRANG);
  const meta = (khoa: string, giaTri: string) =>
    the.find((t) => t.tag === 'meta' && t.attrs[khoa] === giaTri)?.attrs.content;

  it('thêm og:image tuyệt đối kèm kích thước, alt và twitter:image', () => {
    expect(meta('property', 'og:image')).toBe(
      'https://mapslibvn-docs.pages.dev/og/tai-lieu-v1.png',
    );
    expect(meta('property', 'og:image:width')).toBe('1200');
    expect(meta('property', 'og:image:height')).toBe('630');
    expect(meta('property', 'og:image:alt')).toBe(TRANG.title);
    expect(meta('name', 'twitter:image')).toBe(OG_DOCS);
  });

  it('JSON-LD nằm trong một thẻ script, parse được, không có "<" trần', () => {
    const coNgoac = theHeadDocs({
      ...TRANG,
      description: 'Web component <mapslibvn-autocomplete>',
    });
    const script = coNgoac.find((t) => t.tag === 'script');
    expect(script?.attrs.type).toBe('application/ld+json');
    expect(script?.content).not.toContain('<');
    expect(JSON.parse(script?.content ?? '{}')['@context']).toBe('https://schema.org');
  });

  it('noindex đúng các trang trong KHONG_INDEX, trang khác không có thẻ robots', () => {
    expect(KHONG_INDEX).toEqual(['thong-bao-ben-thu-ba']);
    const robots = (id: string) =>
      theHeadDocs({ ...TRANG, id }).find((t) => t.attrs.name === 'robots');
    expect(robots('thong-bao-ben-thu-ba')?.attrs.content).toBe('noindex');
    expect(robots('api')).toBeUndefined();
  });
});
