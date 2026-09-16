import { SELF } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { adminCatalog } from '../src/routes/admin-catalog';

interface Catalog {
  tiers: {
    tier: string;
    priceCents: number;
    places: number;
    directions: number;
    dailyPlaces: number | null;
    dailyDirections: number | null;
    onlineSupport: boolean;
  }[];
  addOns: { group: string; units: number; priceCents: number }[];
  legacyDefaults: { places: number; directions: number; blockAtMultiple: number };
}

describe('GET /v1/admin/plan-catalog', () => {
  it('trả đủ bốn bậc theo đúng thứ tự tăng dần và hai gói cộng thêm', async () => {
    const app = new Hono<AppEnv>();
    app.route('/', adminCatalog);
    const response = await app.request('https://api/v1/admin/plan-catalog');
    expect(response.status).toBe(200);
    // Hạn mức là dữ liệu riêng của từng tenant — không được vào cache dùng chung.
    expect(response.headers.get('cache-control')).toBe('private, no-store');

    const body = (await response.json()) as Catalog;
    expect(body.tiers.map((item) => item.tier)).toEqual([
      'trial',
      'starter',
      'professional',
      'business',
    ]);
    // Số phải khớp PLAN_CATALOG chứ không phải một bản chép tay trong route.
    expect(body.tiers[0]).toMatchObject({ tier: 'trial', places: 2_000, dailyPlaces: 200 });
    expect(body.tiers[1]).toMatchObject({ tier: 'starter', places: 30_000, dailyPlaces: null });
    expect(body.addOns).toEqual([
      { group: 'places', units: 1_000, priceCents: 100 },
      { group: 'directions', units: 1_000, priceCents: 300 },
    ]);
    // Hạn mức mặc định của tenant chưa vào sổ thương mại, và bội số mà bộ đếm KV mới chặn thật.
    expect(body.legacyDefaults).toEqual({
      places: 20_000,
      directions: 2_000,
      blockAtMultiple: 2,
    });
  });

  it('không có JWT Access → 401, y như mọi route /v1/admin khác', async () => {
    const response = await SELF.fetch('https://api/v1/admin/plan-catalog');
    expect(response.status).toBe(401);
  });

  it('KHÔNG nằm dưới /v1/admin/billing/: đường dẫn đó bị middleware :tenantId/* nuốt', async () => {
    // Đo ngày 16/09/2026: Hono khớp `/v1/admin/billing/:tenantId/*` với cả
    // `/v1/admin/billing/catalog` (tenantId = "catalog", phần * rỗng), nên bảng giá đặt ở đó sẽ
    // nhận 400 invalid_tenant trước khi tới handler. Ca này khoá lại quyết định đường dẫn.
    const response = await SELF.fetch('https://api/v1/admin/billing/catalog');
    expect(response.status).not.toBe(200);
  });
});
