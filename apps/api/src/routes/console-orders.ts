import { addMonths, CatalogError, type OrderInput, quoteOrder } from '@mapslibvn/catalog';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { audit } from '../audit';
import { quotaObject } from '../billing/object';
import {
  danhSachDonCuaTenant,
  demDonPending,
  docDonCuaTenant,
  type DonHang,
  huyDonCuaTenant,
  luuLinkThanhToan,
  noiDungChuyenKhoan,
  taoDon,
  timDonPendingChuaCoLink,
} from '../commerce/db';
import type { CongSo, FulfilDeps } from '../commerce/fulfil';
import { tinhStartsAt } from '../commerce/ky-han';
import { chonPayosPort, PayosError, type PayosPort } from '../commerce/payos';
import { docTenant } from '../console/db';
import { selfServeOpen } from '../console/flags';
import { requireCustomer } from '../console/require-customer';
import { endSql, getSql } from '../db';
import { moTaDon } from '../email/mau-don-hang';
import type { AppEnv, Env } from '../env';
import { ApiError, moTaLoi } from '../errors';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const MAX_BODY = 4 * 1024;
/** Quá số này thì khách đang tạo đơn để chơi; 409 kèm gợi ý huỷ bớt (spec 9.1). */
const DON_PENDING_TOI_DA = 3;
const LINK_SONG_MS = 24 * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ConsoleOrdersDeps extends FulfilDeps {
  sql?: (env: Env) => ReturnType<typeof getSql>;
  payos?: (env: Env) => PayosPort;
  /** Test thay cổng phiên bằng middleware đặt sẵn `customer`; production dùng requireCustomer(). */
  xacThuc?: MiddlewareHandler<AppEnv>;
}

/**
 * Đọc nội dung đơn từ dữ liệu ngoài (query hoặc body). CHỈ nhận các trường định danh gói; số tiền
 * không có chỗ ở đây — `quoteOrder()` tính, và mọi số client gửi lên đều bị bỏ.
 */
function docOrderInput(raw: Record<string, unknown>): OrderInput {
  if (raw.kind === 'plan') {
    return {
      kind: 'plan',
      tier: String(raw.tier ?? '') as never,
      months: Number(raw.months) as never,
    };
  }
  if (raw.kind === 'addon') {
    return { kind: 'addon', group: String(raw.group ?? '') as never, packs: Number(raw.packs) };
  }
  throw new ApiError(400, 'invalid_kind', 'kind phải là plan hoặc addon');
}

function baoGia(input: OrderInput) {
  try {
    return quoteOrder(input);
  } catch (error) {
    // CatalogError mang mã ở cả `code` lẫn `message`, nên khớp được mà không cần instanceof qua RPC.
    if (error instanceof CatalogError) {
      throw new ApiError(400, error.code, 'Nội dung đơn không hợp lệ');
    }
    throw error;
  }
}

async function docJsonNho(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) {
    throw new ApiError(413, 'payload_too_large', 'Thân yêu cầu quá lớn');
  }
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Hình dạng đơn trả cho khách. `qrCode` và `checkoutUrl` chỉ khi còn pending. */
export function donJson(don: DonHang) {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    id: don.id,
    orderCode: don.order_code,
    noiDungChuyenKhoan: noiDungChuyenKhoan(don.order_code),
    kind: don.kind,
    tier: don.tier,
    months: don.months,
    quotaGroup: don.quota_group,
    packs: don.packs,
    moTa: moTaDon(don),
    amountVnd: don.amount_vnd,
    amountUsdCents: don.amount_usd_cents,
    status: don.status,
    checkoutUrl: don.status === 'pending' ? don.checkout_url : null,
    qrCode: don.status === 'pending' ? don.qr_code : null,
    linkExpiresAt: iso(don.link_expires_at),
    paidAt: iso(don.paid_at),
    paidAmountVnd: don.paid_amount_vnd,
    fulfilledAt: iso(don.fulfilled_at),
    fulfilError: don.fulfil_error,
    createdAt: iso(don.created_at),
  };
}

export function consoleOrdersWith(deps: ConsoleOrdersDeps = {}) {
  const routes = new Hono<AppEnv>();
  const cong = deps.xacThuc ?? requireCustomer();
  const so = (env: Env, tenantId: string): CongSo => (deps.so ?? quotaObject)(env, tenantId);
  const payos = (env: Env) => (deps.payos ?? chonPayosPort)(env);
  const now = () => (deps.now ?? (() => new Date()))();

  routes.use('/v1/console/orders', cong);
  routes.use('/v1/console/orders/*', cong);

  const khachCoTenant = (c: Context<AppEnv>) => {
    const khach = c.get('customer');
    if (!khach) throw new ApiError(401, 'not_signed_in', 'Chưa đăng nhập');
    if (!khach.tenantId) throw new ApiError(409, 'chua_co_tenant', 'Tài khoản chưa có tổ chức');
    return { ...khach, tenantId: khach.tenantId };
  };

  async function voiSqlCua<T>(
    c: Context<AppEnv>,
    fn: (sql: ReturnType<typeof getSql>) => Promise<T>,
  ): Promise<T> {
    const sql = (deps.sql ?? getSql)(c.env);
    try {
      return await fn(sql);
    } finally {
      endSql(c.executionCtx, sql);
    }
  }

  /** Chỉ mua thêm lượt được khi đang có thuê bao trả phí đang chạy — cùng luật với sổ quota. */
  async function chanMuaLuotKhiChuaTraPhi(c: Context<AppEnv>, tenantId: string) {
    const usage = await so(c.env, tenantId).readUsage();
    if (usage.status !== 'active' || usage.tier === 'trial') {
      throw new ApiError(
        409,
        'credits_require_paid_active',
        'Chỉ mua thêm lượt khi có thuê bao trả phí đang hoạt động',
      );
    }
  }

  // `quote` PHẢI khai TRƯỚC `:id`, nếu không `:id` nuốt mất đường này.
  routes.get('/v1/console/orders/quote', async (c) => {
    const khach = khachCoTenant(c);
    const input = docOrderInput(Object.fromEntries(new URL(c.req.url).searchParams.entries()));
    const gia = baoGia(input);
    if (input.kind === 'addon') {
      await chanMuaLuotKhiChuaTraPhi(c, khach.tenantId);
      return c.json({ ...gia, hieuLucTu: null, hetHanLuc: null }, 200, NO_STORE);
    }
    const history = await so(c.env, khach.tenantId).readPeriods(60);
    const hieuLucTu = tinhStartsAt(history, now());
    return c.json(
      {
        ...gia,
        hieuLucTu: hieuLucTu.toISOString(),
        hetHanLuc: addMonths(hieuLucTu, input.months).toISOString(),
      },
      200,
      NO_STORE,
    );
  });

  routes.get('/v1/console/orders', async (c) => {
    const khach = khachCoTenant(c);
    const ds = await voiSqlCua(c, (sql) => danhSachDonCuaTenant(sql, khach.tenantId));
    return c.json({ orders: ds.map(donJson) }, 200, NO_STORE);
  });

  routes.post('/v1/console/orders', async (c) => {
    if (!selfServeOpen(c.env)) {
      throw new ApiError(503, 'self_serve_closed', 'Cổng tự phục vụ chưa mở');
    }
    const khach = khachCoTenant(c);
    const input = docOrderInput(await docJsonNho(c.req.raw));
    const gia = baoGia(input);
    if (input.kind === 'addon') await chanMuaLuotKhiChuaTraPhi(c, khach.tenantId);

    const { don, tenant } = await voiSqlCua(c, async (sql) => {
      const tenant = await docTenant(sql, khach.tenantId);
      if (!tenant) throw new ApiError(404, 'not_found', 'Không có tổ chức này');
      if (tenant.quota_mode !== 'commercial') {
        throw new ApiError(409, 'tenant_not_commercial', 'Tổ chức chưa ở chế độ thương mại');
      }
      // Đơn pending cùng nội dung mà PayOS chưa cấp link: dùng lại, không đẻ thêm đơn.
      const cu = await timDonPendingChuaCoLink(sql, khach.tenantId, input);
      if (cu) return { don: cu, tenant };
      if ((await demDonPending(sql, khach.tenantId)) >= DON_PENDING_TOI_DA) {
        throw new ApiError(
          409,
          'too_many_pending_orders',
          'Đang có quá nhiều đơn chờ thanh toán, hãy huỷ bớt',
        );
      }
      const moi = await taoDon(sql, {
        tenantId: khach.tenantId,
        accountId: khach.accountId,
        don: input,
        gia,
      });
      audit(c, 'customer.order_create', moi.id, {
        order_code: moi.order_code,
        tenant_id: khach.tenantId,
        kind: input.kind,
        amount_vnd: moi.amount_vnd,
      });
      return { don: moi, tenant };
    });

    // Gọi PayOS NGOÀI phạm vi client Postgres ở trên: một lời gọi mạng có thể mất mười giây.
    const origin = new URL(c.req.url).origin;
    const cong = payos(c.env);
    const hetHan = new Date(now().getTime() + LINK_SONG_MS);
    let link: { paymentLinkId: string; checkoutUrl: string; qrCode: string | null };
    try {
      link = await cong.taoLink({
        orderCode: don.order_code,
        amount: don.amount_vnd,
        description: noiDungChuyenKhoan(don.order_code),
        returnUrl: `${origin}/console/don-hang/${don.id}?ket-qua=thanh-cong`,
        cancelUrl: `${origin}/console/don-hang/${don.id}?ket-qua=huy`,
        expiredAt: hetHan,
        buyerEmail: tenant.billing_email ?? khach.email,
        buyerName: khach.name,
        buyerCompanyName: tenant.billing_name,
        buyerTaxCode: tenant.billing_tax_code,
        buyerAddress: tenant.billing_address,
        itemName: moTaDon(don),
      });
    } catch (error) {
      if (error instanceof PayosError && error.code === 'payos_order_exists') {
        // Lần trước PayOS đã tạo link mà ta không lưu được: đọc lại, dựng checkoutUrl từ id.
        const co = await cong.docLink(don.order_code).catch(() => null);
        if (!co) {
          throw new ApiError(
            503,
            'payment_provider_unavailable',
            'Không tạo được link thanh toán',
            undefined,
            { orderId: don.id },
          );
        }
        link = {
          paymentLinkId: co.paymentLinkId,
          checkoutUrl: cong.checkoutUrlTuId(co.paymentLinkId),
          qrCode: null,
        };
      } else {
        console.error(`[commerce] PayOS tạo link đơn ${don.order_code} lỗi: ${moTaLoi(error)}`);
        // Đơn vẫn pending không link; khách bấm lại thì `timDonPendingChuaCoLink` dùng lại nó.
        throw new ApiError(
          503,
          'payment_provider_unavailable',
          'Cổng thanh toán đang bận, hãy thử lại',
          undefined,
          { orderId: don.id },
        );
      }
    }

    await voiSqlCua(c, (sql) => luuLinkThanhToan(sql, don.id, { ...link, linkExpiresAt: hetHan }));
    return c.json(
      {
        order: donJson({
          ...don,
          payment_link_id: link.paymentLinkId,
          checkout_url: link.checkoutUrl,
          qr_code: link.qrCode,
          link_expires_at: hetHan,
        }),
      },
      201,
      NO_STORE,
    );
  });

  routes.get('/v1/console/orders/:id', async (c) => {
    const khach = khachCoTenant(c);
    const id = c.req.param('id');
    if (!UUID.test(id)) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    const don = await voiSqlCua(c, (sql) => docDonCuaTenant(sql, khach.tenantId, id));
    if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    return c.json({ order: donJson(don) }, 200, NO_STORE);
  });

  routes.post('/v1/console/orders/:id/cancel', async (c) => {
    const khach = khachCoTenant(c);
    const id = c.req.param('id');
    if (!UUID.test(id)) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    const don = await voiSqlCua(c, (sql) => docDonCuaTenant(sql, khach.tenantId, id));
    if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    if (don.status !== 'pending') {
      throw new ApiError(409, 'order_not_cancellable', 'Chỉ huỷ được đơn đang chờ thanh toán');
    }
    if (don.payment_link_id) {
      try {
        await payos(c.env).huyLink(don.order_code, 'Khách huỷ ở cổng khách hàng');
      } catch (error) {
        // KHÔNG đánh dấu huỷ khi PayOS chưa xác nhận: link còn sống mà ta bảo "đã huỷ" là nói sai,
        // và khách có thể vẫn quét mã đó rồi chuyển tiền cho một đơn ta coi là đã đóng.
        console.error(`[commerce] PayOS huỷ link đơn ${don.order_code} lỗi: ${moTaLoi(error)}`);
        throw new ApiError(
          503,
          'payment_provider_unavailable',
          'Cổng thanh toán đang bận, hãy thử lại',
        );
      }
    }
    const daHuy = await voiSqlCua(c, (sql) => huyDonCuaTenant(sql, khach.tenantId, id));
    if (!daHuy) throw new ApiError(409, 'order_not_cancellable', 'Đơn vừa đổi trạng thái');
    audit(c, 'customer.order_cancel', id, {
      order_code: don.order_code,
      tenant_id: khach.tenantId,
    });
    return c.json({ order: donJson({ ...don, status: 'cancelled' }) }, 200, NO_STORE);
  });

  return routes;
}

export const consoleOrders = consoleOrdersWith();
