import { Hono } from 'hono';
import { quotaObject } from '../billing/object';
import type { AppEnv } from '../env';

/**
 * Hai route CHỈ ĐỌC của nhóm billing. Tách khỏi `billing-admin.ts` (nơi giữ các lệnh ghi) để file
 * đó không phình thêm, nhưng vẫn được mount BÊN TRONG `billingAdmin()`: chúng phải hưởng đúng
 * middleware kiểm tenant tồn tại đã khai ở đó, và ở index.ts cả tiền tố đã nằm sau
 * requireSameSitePost() + requireBillingAccess().
 */
export const billingRead = new Hono<AppEnv>();

const NO_STORE = { 'cache-control': 'private, no-store' } as const;

billingRead.get('/v1/admin/billing/:tenantId/periods', async (c) => {
  const limit = Number(c.req.query('limit') ?? '24');
  const history = await quotaObject(c.env, c.req.param('tenantId')).readPeriods(limit);
  return c.json(history, 200, NO_STORE);
});
