import {
  PERIOD_MONTHS,
  PLAN_CATALOG,
  QUOTA_GROUPS,
  TIERS,
  USD_REFERENCE_RATE,
} from '@mapslibvn/catalog';
import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Bảng giá công khai cho console và cho ai muốn đọc bằng máy. Không cần khoá, không cần Access:
 * đây là đúng con số in trên website. Khác `/v1/admin/plan-catalog` ở hai điểm: không có
 * `legacyDefaults` (chuyện nội bộ của tenant chưa vào sổ thương mại) và cache công khai một giờ.
 */
export const catalogRoute = new Hono<AppEnv>();

catalogRoute.get('/v1/catalog', (c) =>
  c.json(
    {
      currency: 'VND',
      usdReferenceRate: USD_REFERENCE_RATE,
      periodMonths: [...PERIOD_MONTHS],
      tiers: TIERS.map((tier) => ({ tier, ...PLAN_CATALOG[tier] })),
      addOns: QUOTA_GROUPS.map((group) => ({ group, ...PLAN_CATALOG.addOns[group] })),
    },
    200,
    { 'cache-control': 'public, max-age=3600' },
  ),
);
