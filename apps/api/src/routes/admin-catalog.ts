import { PLAN_CATALOG, QUOTA_GROUPS, TIERS } from '@mapslibvn/catalog';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { FREE_DIRECTIONS_PER_DAY, FREE_PLACES_PER_DAY } from '../quota';

/**
 * Bảng giá và hạn mức, phục vụ form cấp gói của trang Admin. Đặt ở `/v1/admin/plan-catalog` chứ
 * KHÔNG phải `/v1/admin/billing/catalog`: middleware `/v1/admin/billing/:tenantId/*` của nhóm
 * billing khớp luôn đường dẫn đó với `tenantId = "catalog"` và trả 400 invalid_tenant.
 *
 * Mount vào app `admin` nên đã có sẵn cổng chống CSRF + requireAccess. Không đòi quyền billing:
 * đây là bảng giá công khai trong tài liệu bán hàng, không phải dữ liệu của một khách nào.
 */
export const adminCatalog = new Hono<AppEnv>();

adminCatalog.get('/v1/admin/plan-catalog', (c) =>
  c.json(
    {
      tiers: TIERS.map((tier) => ({ tier, ...PLAN_CATALOG[tier] })),
      addOns: QUOTA_GROUPS.map((group) => ({ group, ...PLAN_CATALOG.addOns[group] })),
      legacyDefaults: {
        places: FREE_PLACES_PER_DAY,
        directions: FREE_DIRECTIONS_PER_DAY,
        // Bộ đếm KV là số xấp xỉ nên chỉ chặn ở 2× hạn mức (quota.ts). Giao diện phải nói đúng con
        // số này, nếu không người vận hành sẽ tưởng khách bị chặn ngay khi chạm 100 %.
        blockAtMultiple: 2,
      },
    },
    200,
    { 'cache-control': 'private, no-store' },
  ),
);
