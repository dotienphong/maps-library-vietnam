import { Hono } from 'hono';
import { audit } from '../audit';
import { normalizeTextArray } from '../auth';
import { quotaObject } from '../billing/object';
import {
  capNhatTenant,
  daDungThu,
  demKhoaDangHoatDong,
  khoaCuaTenant,
  taoTenantChoKhach,
  voiSql,
} from '../console/db';
import { selfServeOpen } from '../console/flags';
import { requireCustomer } from '../console/require-customer';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';
import { issueKeyForTenant, type LoaiKhoa, setKeyRevokedForTenant } from '../tenant-keys';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const MAX_BODY = 4 * 1024;
const TEN_TOI_DA = 120;
/** Trần khoá đang hoạt động mỗi tổ chức. Đủ để tách môi trường, không đủ để biến thành kho khoá. */
const KHOA_TOI_DA = 10;

export interface ConsoleDeps {
  /** Sổ quota tiêm được: test của apps/api không có Durable Object thật để gọi. */
  quota?: (
    env: Env,
    tenantId: string,
  ) => {
    applyCommand(command: unknown): Promise<unknown>;
    readUsage(): Promise<unknown>;
    readPeriods(limit: number): Promise<unknown>;
  };
}

async function docJsonNho(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const chuoiHoacNull = (gia: unknown, toiDa = 250): string | null => {
  if (typeof gia !== 'string') return null;
  const cat = gia.trim();
  return cat ? cat.slice(0, toiDa) : null;
};

export function consoleRoutesWith(deps: ConsoleDeps = {}) {
  const routes = new Hono<AppEnv>();
  const so = (env: Env, tenantId: string) =>
    deps.quota ? deps.quota(env, tenantId) : quotaObject(env, tenantId);

  /**
   * Cấu hình công khai cho SPA. KHÔNG nằm sau cổng `selfServeOpen`: đóng cổng mà cũng chặn luôn
   * route này thì SPA không biết vì sao mình không dùng được, và chỉ còn cách hiện một form đăng
   * nhập vô dụng rồi báo lỗi sau khi khách gõ xong email.
   */
  routes.get('/v1/console/config', (c) =>
    c.json(
      {
        selfServe: selfServeOpen(c.env),
        turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? '',
        googleEnabled: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
        supportEmail: c.env.SUPPORT_EMAIL ?? '',
      },
      200,
      NO_STORE,
    ),
  );

  // Mọi route còn lại đòi đăng nhập VÀ đòi cổng đang mở.
  routes.use('/v1/console/me', requireCustomer());
  routes.use('/v1/console/tenant', requireCustomer());
  routes.use('/v1/console/usage', requireCustomer());
  routes.use('/v1/console/periods', requireCustomer());
  routes.use('/v1/console/keys', requireCustomer());
  routes.use('/v1/console/keys/*', requireCustomer());

  routes.get('/v1/console/me', (c) => {
    const khach = c.get('customer');
    if (!khach) throw new ApiError(401, 'not_signed_in', 'Chưa đăng nhập');
    return c.json(
      {
        email: khach.email,
        name: khach.name,
        onboarded: khach.tenantId !== null,
        tenant: khach.tenantId ? { id: khach.tenantId, name: khach.tenantName } : null,
      },
      200,
      NO_STORE,
    );
  });

  routes.post('/v1/console/tenant', async (c) => {
    if (!selfServeOpen(c.env)) {
      throw new ApiError(503, 'self_serve_closed', 'Cổng tự phục vụ chưa mở');
    }
    const khach = c.get('customer');
    if (!khach) throw new ApiError(401, 'not_signed_in', 'Chưa đăng nhập');
    if (khach.tenantId) {
      throw new ApiError(409, 'tenant_already_exists', 'Tài khoản đã có tổ chức');
    }

    const body = await docJsonNho(c.req.raw);
    const ten = chuoiHoacNull(body?.name, TEN_TOI_DA);
    if (!ten) throw new ApiError(400, 'invalid_tenant_name', 'Tên tổ chức không hợp lệ');

    const tenant = await voiSql(c.env, c.executionCtx, async (sql) => {
      // Mỗi tài khoản một bản dùng thử. Kiểm ở đây chứ không chỉ dựa vào sổ quota: sổ chỉ biết
      // trong phạm vi MỘT tenant, nên nó không ngăn được việc tạo tenant thứ hai để xin trial mới.
      if (await daDungThu(sql, khach.accountId)) {
        throw new ApiError(409, 'trial_already_used', 'Tài khoản đã dùng bản dùng thử');
      }
      return await taoTenantChoKhach(sql, { accountId: khach.accountId, ten });
    });

    audit(c, 'customer.tenant_create', tenant.id, { email: khach.email, ten });

    try {
      await so(c.env, tenant.id).applyCommand({
        kind: 'activateTrial',
        // operationId CỐ ĐỊNH theo tenant: gọi lại sau một lần lỗi giữa chừng sẽ nhận lại đúng
        // biên lai cũ thay vì tạo bản dùng thử thứ hai.
        operationId: `trial:${tenant.id}`,
        tenantId: tenant.id,
        actor: `customer:${khach.email}`,
        reason: 'Tự đăng ký qua cổng khách hàng',
        expectedRevision: 0,
        startsAt: new Date().toISOString(),
      });
    } catch (error) {
      // Khớp theo MÃ chứ không `instanceof`: lỗi ném trong Durable Object đi qua RPC về đây dưới
      // dạng Error thường và mất hẳn class gốc.
      const ma = error instanceof Error ? error.message : String(error);
      if (ma !== 'operation_conflict' && ma !== 'trial_already_used') {
        console.error('[console] kích hoạt bản dùng thử lỗi', error);
        // Tenant đã tồn tại và vẫn dùng được; nói thật để giao diện mời thử lại, đừng giả vờ xong.
        throw new ApiError(
          503,
          'trial_activation_failed',
          'Đã tạo tổ chức nhưng chưa kích hoạt được bản dùng thử, hãy thử lại',
        );
      }
    }

    return c.json({ tenant: { id: tenant.id, name: tenant.name } }, 201, NO_STORE);
  });

  routes.patch('/v1/console/tenant', async (c) => {
    const khach = c.get('customer');
    if (!khach?.tenantId) throw new ApiError(409, 'chua_co_tenant', 'Tài khoản chưa có tổ chức');
    const body = await docJsonNho(c.req.raw);
    const ten = chuoiHoacNull(body?.name, TEN_TOI_DA);
    if (!ten) throw new ApiError(400, 'invalid_tenant_name', 'Tên tổ chức không hợp lệ');

    const tenant = await voiSql(c.env, c.executionCtx, (sql) =>
      capNhatTenant(sql, khach.tenantId as string, {
        ten,
        billingName: chuoiHoacNull(body?.billingName),
        billingTaxCode: chuoiHoacNull(body?.billingTaxCode, 20),
        billingAddress: chuoiHoacNull(body?.billingAddress, 500),
        billingEmail: chuoiHoacNull(body?.billingEmail),
      }),
    );
    if (!tenant) throw new ApiError(404, 'not_found', 'Không có tổ chức này');
    audit(c, 'customer.tenant_update', tenant.id, { email: khach.email });
    return c.json({ tenant }, 200, NO_STORE);
  });

  routes.get('/v1/console/usage', async (c) => {
    const khach = c.get('customer');
    if (!khach?.tenantId) throw new ApiError(409, 'chua_co_tenant', 'Tài khoản chưa có tổ chức');
    const usage = await so(c.env, khach.tenantId).readUsage();
    return c.json(usage, 200, NO_STORE);
  });

  routes.get('/v1/console/periods', async (c) => {
    const khach = c.get('customer');
    if (!khach?.tenantId) throw new ApiError(409, 'chua_co_tenant', 'Tài khoản chưa có tổ chức');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '12') || 12, 1), 24);
    const history = await so(c.env, khach.tenantId).readPeriods(limit);
    return c.json(history, 200, NO_STORE);
  });

  routes.get('/v1/console/keys', async (c) => {
    const khach = c.get('customer');
    if (!khach?.tenantId) throw new ApiError(409, 'chua_co_tenant', 'Tài khoản chưa có tổ chức');
    const khoa = await voiSql(c.env, c.executionCtx, (sql) =>
      khoaCuaTenant(sql, khach.tenantId as string),
    );
    return c.json(
      {
        // Hyperdrive chạy `fetch_types: false` nên text[] có thể về dưới dạng chuỗi `{a,b}`.
        // Chỉ lộ ra trên DB thật; test không DB không bao giờ thấy.
        keys: khoa.map((k) => ({
          keyHash: k.key_hash,
          keyPrefix: k.key_prefix,
          label: k.label,
          kind: k.kind,
          allowedOrigins: normalizeTextArray(k.allowed_origins),
          active: k.active && k.revoked_at === null,
          createdAt: k.created_at,
          revokedAt: k.revoked_at,
        })),
        toiDa: KHOA_TOI_DA,
      },
      200,
      NO_STORE,
    );
  });

  routes.post('/v1/console/keys', async (c) => {
    if (!selfServeOpen(c.env)) {
      throw new ApiError(503, 'self_serve_closed', 'Cổng tự phục vụ chưa mở');
    }
    const khach = c.get('customer');
    if (!khach?.tenantId) throw new ApiError(409, 'chua_co_tenant', 'Tài khoản chưa có tổ chức');

    const body = await docJsonNho(c.req.raw);
    const label = chuoiHoacNull(body?.label, 80) ?? 'Khoá mới';
    const kind: LoaiKhoa = body?.kind === 'mobile' || body?.kind === 'server' ? body.kind : 'web';
    const origins = Array.isArray(body?.allowedOrigins)
      ? body.allowedOrigins.filter((o): o is string => typeof o === 'string').slice(0, 20)
      : [];
    const bundles = Array.isArray(body?.allowedBundleIds)
      ? body.allowedBundleIds.filter((b): b is string => typeof b === 'string').slice(0, 20)
      : [];

    const ketQua = await voiSql(c.env, c.executionCtx, async (sql) => {
      const dangCo = await demKhoaDangHoatDong(sql, khach.tenantId as string);
      if (dangCo >= KHOA_TOI_DA) {
        throw new ApiError(
          409,
          'too_many_keys',
          `Mỗi tổ chức tối đa ${KHOA_TOI_DA} khoá đang hoạt động`,
        );
      }
      return await issueKeyForTenant(sql, c.env, {
        tenantId: khach.tenantId as string,
        label,
        kind,
        allowedOrigins: origins,
        allowedBundleIds: bundles,
        // Scope ÉP cứng: khách tự cấp khoá chỉ được đọc Places. Quyền ghi đóng góp (`edits:write`)
        // phải đi qua người thật, vì nó ghi vào dữ liệu bản đồ dùng chung.
        scopes: ['places:read'],
        quotaDirectionsPerDay: null,
      });
    });

    audit(c, 'customer.key_issue', ketQua.keyHash, {
      tenant_id: khach.tenantId,
      key_prefix: ketQua.keyPrefix,
      kind,
      email: khach.email,
    });

    // Khoá dạng rõ trả đúng MỘT lần. DB chỉ giữ sha256; mất là phải cấp khoá mới.
    return c.json(
      { key: ketQua.key, keyPrefix: ketQua.keyPrefix, keyHash: ketQua.keyHash },
      201,
      NO_STORE,
    );
  });

  routes.post('/v1/console/keys/:hash/revoke', async (c) => {
    const khach = c.get('customer');
    if (!khach?.tenantId) throw new ApiError(409, 'chua_co_tenant', 'Tài khoản chưa có tổ chức');
    const keyHash = c.req.param('hash');
    const body = await docJsonNho(c.req.raw);
    const operationId = chuoiHoacNull(body?.operationId, 64);
    if (!/^[a-f0-9]{64}$/.test(keyHash) || !operationId) {
      throw new ApiError(400, 'invalid_key_command', 'Yêu cầu thu hồi không hợp lệ');
    }

    const receipt = await voiSql(c.env, c.executionCtx, (sql) =>
      setKeyRevokedForTenant(sql, c.env, {
        // Điều kiện tenant nằm TRONG câu SQL của hàm dùng chung, nên một khách gửi lên hash khoá
        // của tenant khác chỉ nhận 404 chứ không chạm được vào nó.
        tenantId: khach.tenantId as string,
        keyHash,
        revoked: true,
        operationId,
        actor: `customer:${khach.email}`,
        reason: 'Khách tự thu hồi qua cổng khách hàng',
      }),
    );
    if (receipt === null) throw new ApiError(404, 'key_not_found', 'Không có khoá này');

    audit(c, 'customer.key_revoke', keyHash, {
      tenant_id: khach.tenantId,
      email: khach.email,
      operation_id: operationId,
    });
    return c.json(receipt, 200, NO_STORE);
  });

  return routes;
}

export const consoleRoutes = consoleRoutesWith();
