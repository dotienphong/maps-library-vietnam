import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

interface PublicCatalog {
  currency: string;
  usdReferenceRate: number;
  periodMonths: number[];
  tiers: { tier: string; priceVnd: number; priceCents: number; places: number }[];
  addOns: { group: string; units: number; priceVnd: number; priceCents: number }[];
}

describe('GET /v1/catalog', () => {
  it('không cần khoá API lẫn Access, cache công khai một giờ', async () => {
    const response = await SELF.fetch('https://api/v1/catalog');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('trả đúng bảng giá VND chính, USD tham chiếu và kỳ mua', async () => {
    const body = (await (await SELF.fetch('https://api/v1/catalog')).json()) as PublicCatalog;
    expect(body.currency).toBe('VND');
    expect(body.usdReferenceRate).toBe(26_000);
    expect(body.periodMonths).toEqual([1, 3, 6, 12]);
    expect(body.tiers.map((t) => t.tier)).toEqual(['trial', 'starter', 'professional', 'business']);
    expect(body.tiers[1]).toMatchObject({ priceVnd: 650_000, priceCents: 2_500, places: 30_000 });
    expect(body.addOns).toEqual([
      { group: 'places', units: 1_000, priceCents: 100, priceVnd: 26_000 },
      { group: 'directions', units: 1_000, priceCents: 300, priceVnd: 78_000 },
    ]);
  });

  it('KHÔNG lộ legacyDefaults — chuyện nội bộ của tenant chưa vào sổ thương mại', async () => {
    const body = (await (await SELF.fetch('https://api/v1/catalog')).json()) as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('legacyDefaults');
  });
});
