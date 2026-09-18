import { PAID_TIERS, PLAN_CATALOG } from '@mapslibvn/catalog';
import { BRAND, SITE_URL, SUPPORT_EMAIL, SUPPORT_PHONE } from '../../site.config.mjs';
import type { TrangMeta } from './trang';

const OG_MAC_DINH = '/og/mac-dinh.png';

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
    name: BRAND,
    url: canonicalUrl('/'),
    logo: `${SITE_URL}${OG_MAC_DINH}`,
    description: 'Nền tảng bản đồ và địa điểm Việt Nam dựng trên dữ liệu mở.',
    contactPoint: {
      '@type': 'ContactPoint',
      email: SUPPORT_EMAIL,
      telephone: SUPPORT_PHONE,
      contactType: 'customer support',
      availableLanguage: ['vi', 'en'],
    },
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
    name: BRAND,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web, iOS, Android',
    url: canonicalUrl('/'),
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
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    mainEntityOfPage: canonicalUrl(input.path),
    datePublished: input.publishedAt,
    dateModified: input.updatedAt ?? input.publishedAt,
    author: { '@type': 'Organization' as const, name: BRAND, url: canonicalUrl('/') },
    publisher: { '@type': 'Organization' as const, name: BRAND, url: canonicalUrl('/') },
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
