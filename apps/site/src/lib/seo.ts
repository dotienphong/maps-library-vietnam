import { PAID_TIERS, PLAN_CATALOG } from '@mapslibvn/catalog';
import {
  BRAND,
  DOCS_URL,
  SAME_AS,
  SITE_URL,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
} from '../../site.config.mjs';
import { TRANG, type TrangMeta } from './trang';

const OG_MAC_DINH = '/og/mac-dinh-v3.png';
/** Mọi ảnh OG do scripts/site-images.mjs sinh đều 1200×630. */
const OG_RONG = 1200;
const OG_CAO = 630;

/**
 * `@id` cố định của các thực thể trong JSON-LD. Tài liệu (`apps/docs/src/lib/seo-docs.ts`) dùng
 * lại ĐÚNG `ORG_ID`, nên máy hiểu website và tài liệu — hai tên miền — là cùng một chủ.
 */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const SOFTWARE_ID = `${SITE_URL}/#software`;

/** Logo vuông sinh từ favicon.svg (`node scripts/site-images.mjs --logo`). Không dùng ảnh OG
 *  1200×630: Google cắt logo về khung vuông. */
export const LOGO = { url: `${SITE_URL}/logo-512.png`, width: 512, height: 512 } as const;

/** URL tuyệt đối, luôn có dấu gạch cuối. Hai URL cho cùng một trang là tự chia điểm SEO. */
export function canonicalUrl(path: string): string {
  const sach = path.startsWith('/') ? path : `/${path}`;
  const duoi = sach.endsWith('/') ? sach : `${sach}/`;
  return `${SITE_URL}${duoi}`;
}

export interface SeoTuyChon {
  type?: 'website' | 'article';
  publishedAt?: string;
}

export function seoMeta(trang: TrangMeta, tuyChon: SeoTuyChon = {}) {
  const canonical = canonicalUrl(trang.path);
  const image = `${SITE_URL}${trang.og ?? OG_MAC_DINH}`;
  return {
    title: trang.title,
    description: trang.description,
    canonical,
    og: {
      title: trang.title,
      description: trang.description,
      url: canonical,
      image,
      imageWidth: OG_RONG,
      imageHeight: OG_CAO,
      imageAlt: trang.title,
      type: tuyChon.type ?? 'website',
      locale: 'vi_VN',
      siteName: BRAND,
      ...(tuyChon.publishedAt ? { publishedTime: tuyChon.publishedAt } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: trang.title,
      description: trang.description,
      image,
    },
  };
}

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORG_ID,
    name: BRAND,
    url: canonicalUrl('/'),
    logo: { '@type': 'ImageObject', ...LOGO },
    description: 'Nền tảng bản đồ và địa điểm Việt Nam dựng trên dữ liệu mở.',
    sameAs: [...SAME_AS],
    contactPoint: {
      '@type': 'ContactPoint',
      email: SUPPORT_EMAIL,
      telephone: SUPPORT_PHONE,
      contactType: 'customer support',
      availableLanguage: ['vi', 'en'],
    },
  } as const;
}

/** Chỉ đặt ở trang chủ. Không có `SearchAction`: website không có ô tìm kiếm. */
export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: BRAND,
    url: canonicalUrl('/'),
    inLanguage: 'vi',
    publisher: { '@id': ORG_ID },
  } as const;
}

const TEN_GOI: Record<string, string> = {
  trial: 'Bản dùng thử',
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};

export function softwareApplicationJsonLd() {
  const offers = (['trial', ...PAID_TIERS] as const).map((tier) => ({
    '@type': 'Offer' as const,
    name: `${BRAND} ${TEN_GOI[tier]}`,
    price: String(PLAN_CATALOG[tier].priceVnd),
    priceCurrency: 'VND',
    url: canonicalUrl('/bang-gia/'),
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: BRAND,
    description: TRANG.trangChu.description,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web, iOS, Android',
    url: canonicalUrl('/'),
    publisher: { '@id': ORG_ID },
    softwareHelp: { '@type': 'CreativeWork', url: `${DOCS_URL}/` },
    offers,
  } as const;
}

export function faqJsonLd(items: readonly { hoi: string; dap: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question' as const,
      name: item.hoi,
      acceptedAnswer: { '@type': 'Answer' as const, text: item.dap },
    })),
  } as const;
}

export function articleJsonLd(input: {
  title: string;
  description: string;
  path: string;
  publishedAt: string;
  updatedAt?: string;
  /** URL tuyệt đối ảnh của bài; thiếu thì ảnh OG mặc định của site. */
  image?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    mainEntityOfPage: canonicalUrl(input.path),
    image: input.image ?? `${SITE_URL}${OG_MAC_DINH}`,
    inLanguage: 'vi',
    datePublished: input.publishedAt,
    dateModified: input.updatedAt ?? input.publishedAt,
    author: { '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
  } as const;
}

export function breadcrumbJsonLd(items: readonly { ten: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem' as const,
      position: index + 1,
      name: item.ten,
      item: canonicalUrl(item.path),
    })),
  } as const;
}
