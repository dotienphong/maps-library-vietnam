import { DOCS_URL, SITE_URL } from '@mapslibvn/catalog';

/** Cùng `@id` với `ORG_ID` của website (apps/site/src/lib/seo.ts): máy gộp hai tên miền làm một
 *  chủ. Google không sang tên miền khác để tra `@id`, nên docs lặp lại nút Organization rút gọn. */
export const ORG_ID = `${SITE_URL}/#organization`;
export const DOCS_WEBSITE_ID = `${DOCS_URL}/#website`;
/** Ảnh OG của mọi trang docs, sinh bằng `node scripts/site-images.mjs --og=tai-lieu`. */
export const OG_DOCS = `${DOCS_URL}/og/tai-lieu-v1.png`;
const LOGO = `${SITE_URL}/logo-512.png`;
/** Trang không cho lập chỉ mục: phần lớn là văn bản giấy phép MIT/Apache có ở khắp nơi. */
export const KHONG_INDEX: readonly string[] = ['thong-bao-ben-thu-ba'];

export interface TrangDocs {
  /** Slug Starlight; trang chủ là chuỗi rỗng. */
  id: string;
  title: string;
  description: string;
  /** URL tuyệt đối của trang, trùng canonical. */
  url: string;
  dateModified?: string | undefined;
  datePublished?: string | undefined;
}

export type NutJsonLd = Record<string, unknown> & { '@type': string };

export interface JsonLdDocs {
  '@context': 'https://schema.org';
  '@graph': NutJsonLd[];
}

export interface TheHead {
  tag: 'meta' | 'script';
  attrs: Record<string, string>;
  content?: string;
}

export function jsonLdDocs(trang: TrangDocs): JsonLdDocs {
  const graph: NutJsonLd[] = [
    { '@type': 'Organization', '@id': ORG_ID, name: 'MapsLibVN', url: `${SITE_URL}/`, logo: LOGO },
    {
      '@type': 'WebSite',
      '@id': DOCS_WEBSITE_ID,
      name: 'Tài liệu MapsLibVN',
      url: `${DOCS_URL}/`,
      inLanguage: 'vi',
      publisher: { '@id': ORG_ID },
    },
  ];
  if (trang.id !== '') {
    graph.push(
      {
        '@type': 'TechArticle',
        headline: trang.title,
        description: trang.description,
        url: trang.url,
        inLanguage: 'vi',
        image: OG_DOCS,
        ...(trang.datePublished ? { datePublished: trang.datePublished } : {}),
        ...(trang.dateModified ? { dateModified: trang.dateModified } : {}),
        isPartOf: { '@id': DOCS_WEBSITE_ID },
        author: { '@id': ORG_ID },
        publisher: { '@id': ORG_ID },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Tài liệu', item: `${DOCS_URL}/` },
          { '@type': 'ListItem', position: 2, name: trang.title, item: trang.url },
        ],
      },
    );
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Các thẻ middleware đẩy vào `<head>` của một trang docs (spec SEO-AI mục 6.2). */
export function theHeadDocs(trang: TrangDocs): TheHead[] {
  const the: TheHead[] = [
    { tag: 'meta', attrs: { property: 'og:image', content: OG_DOCS } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    { tag: 'meta', attrs: { property: 'og:image:alt', content: trang.title } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: OG_DOCS } },
  ];
  if (KHONG_INDEX.includes(trang.id)) {
    the.push({ tag: 'meta', attrs: { name: 'robots', content: 'noindex' } });
  }
  // `<` thoát thành <: description có chữ như `<mapslibvn-autocomplete>`, và một chuỗi
  // `</script>` lọt vào là cắt đứt khối JSON-LD giữa chừng.
  the.push({
    tag: 'script',
    attrs: { type: 'application/ld+json' },
    content: JSON.stringify(jsonLdDocs(trang)).replace(/</g, '\\u003c'),
  });
  return the;
}
