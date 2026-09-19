import { type Context, Hono } from 'hono';
import { audit } from '../audit';
import {
  chuTenant,
  type DonHang,
  daCoSuKien,
  danhSachDonAdmin,
  docDon,
  ghiSuKienThanhToan,
  suKienCuaDon,
  suKienKhongKhop,
  type TrangThaiDon,
  tomTatDon,
  tongTienDaNhan,
} from '../commerce/db';
import { apDungThanhToan, type FulfilDeps, type KetQuaApDung } from '../commerce/fulfil';
import { type ThongBaoDeps, thongBaoSauApDung } from '../commerce/thong-bao';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';
import { parseLimit } from './admin-list-params';
import { donJson } from './console-orders';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const TRANG_THAI = new Set<string>([
  'pending',
  'paid',
  'fulfilled',
  'paid_unfulfilled',
  'underpaid',
  'expired',
  'cancelled',
  'refunded',
]);
/** operationId do trang Admin sinh; nó thành `reference = manual:<id>` nên phải an toàn làm khoá. */
const OPERATION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BODY = 16 * 1024;

type ChiTietAudit = Record<string, string | number | boolean | null>;

export interface AdminOrdersDeps extends FulfilDeps, ThongBaoDeps {
  sql?: (env: Env) => ReturnType<typeof getSql>;
  /**
   * Cổng ghi nhật ký, tiêm được để test đọc nội dung dòng audit. Mặc định là `audit()` thật, và
   * hàm đó cố ý mở client Postgres RIÊNG chạy trong waitUntil — client của request đã bị `endSql`
   * đóng trước đó. Cùng khuôn với `writeAuditEntry` của billing-admin.ts.
   */
  writeAuditEntry?: (entry: { action: string; target: string; detail: ChiTietAudit }) => void;
}

/** Hình dạng cho admin: mọi trường của khách cộng phần vận hành. */
function donJsonAdmin(don: DonHang & { tenant_name?: string }) {
  return {
    ...donJson(don),
    // Admin thấy checkoutUrl ở MỌI trạng thái để đối chiếu với PayOS; khách thì chỉ khi pending.
    checkoutUrl: don.checkout_url,
    tenantId: don.tenant_id,
    tenantName: don.tenant_name ?? null,
    accountId: don.account_id,
    paymentLinkId: don.payment_link_id,
    fulfilAttempts: don.fulfil_attempts,
    entitlementReceipt: don.entitlement_receipt,
    note: don.note,
    updatedAt: new Date(don.updated_at).toISOString(),
  };
}

const suKienJson = (s: Awaited<ReturnType<typeof suKienCuaDon>>[number]) => ({
  id: s.id,
  orderId: s.order_id,
  provider: s.provider,
  reference: s.reference,
  orderCode: s.order_code,
  amountVnd: s.amount_vnd,
  signatureValid: s.signature_valid,
  tomTat: s.tom_tat,
  receivedAt: new Date(s.received_at).toISOString(),
});

async function docJson(request: Request): Promise<Record<string, unknown>> {
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

const orderId = (raw: string): string => {
  if (!UUID.test(raw)) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
  return raw;
};

/**
 * Nhóm admin tối thiểu của pha 3: danh sách, chi tiết, "Thử cấp lại", "Xác nhận đã nhận tiền" và
 * "Giao dịch không khớp đơn" (spec 13). Mount ở index.ts SAU requireSameSiteGhi +
 * requireBillingAccess cho cả `/v1/admin/orders*` và `/v1/admin/payment-events/*`: mọi đường
 * chạm dữ liệu tiền đều sau cổng billing, kể cả đường chỉ đọc.
 */
export function adminOrdersWith(deps: AdminOrdersDeps = {}) {
  const routes = new Hono<AppEnv>();
  const now = () => (deps.now ?? (() => new Date()))();

  const ghiAudit = (c: Context<AppEnv>, action: string, target: string, detail: ChiTietAudit) => {
    if (deps.writeAuditEntry) {
      deps.writeAuditEntry({ action, target, detail });
      return;
    }
    audit(c, action, target, detail);
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

  // Hai đường tĩnh khai TRƯỚC `:id`, nếu không `:id` nuốt mất chúng.
  routes.get('/v1/admin/orders/summary', async (c) =>
    c.json(await voiSqlCua(c, (sql) => tomTatDon(sql, now())), 200, NO_STORE),
  );

  routes.get('/v1/admin/payment-events/unmatched', async (c) => {
    const limit = parseLimit(new URL(c.req.url).searchParams);
    const items = await voiSqlCua(c, (sql) => suKienKhongKhop(sql, limit));
    return c.json({ items: items.map(suKienJson) }, 200, NO_STORE);
  });

  routes.get('/v1/admin/orders', async (c) => {
    const q = new URL(c.req.url).searchParams;
    const statusRaw = q.get('status');
    if (statusRaw !== null && !TRANG_THAI.has(statusRaw)) {
      throw new ApiError(400, 'invalid_request', 'status không hợp lệ');
    }
    const status = (statusRaw as TrangThaiDon | null) ?? null;
    const limit = parseLimit(q);
    let cursor: { createdAt: string; id: string } | null = null;
    const raw = q.get('cursor');
    if (raw !== null) {
      const [createdAt, id] = raw.split('|');
      if (!createdAt || !id || !CURSOR_TIME.test(createdAt) || !UUID.test(id)) {
        throw new ApiError(400, 'invalid_request', 'cursor phải có dạng <thời điểm ISO>|<uuid>');
      }
      cursor = { createdAt, id };
    }
    const rows = await voiSqlCua(c, (sql) =>
      danhSachDonAdmin(sql, { status, tenantId: null, from: null, to: null, limit, cursor }),
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return c.json(
      {
        items: page.map(({ cursor_at: _cursorAt, ...don }) => donJsonAdmin(don)),
        nextCursor: hasMore && last ? `${last.cursor_at}|${last.id}` : null,
      },
      200,
      NO_STORE,
    );
  });

  routes.get('/v1/admin/orders/:id', async (c) => {
    const id = orderId(c.req.param('id'));
    const kq = await voiSqlCua(c, async (sql) => {
      const don = await docDon(sql, id);
      if (!don) return null;
      const [events, owner] = await Promise.all([
        suKienCuaDon(sql, id),
        chuTenant(sql, don.tenant_id),
      ]);
      return { don, events, owner };
    });
    if (!kq) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    return c.json(
      {
        order: donJsonAdmin({
          ...kq.don,
          ...(kq.owner ? { tenant_name: kq.owner.tenantName } : {}),
        }),
        events: kq.events.map(suKienJson),
        owner: kq.owner ? { email: kq.owner.email, billingEmail: kq.owner.billingEmail } : null,
      },
      200,
      NO_STORE,
    );
  });

  /** "Thử cấp lại": idempotent, kết quả hiện ngay. Đi qua apDungThanhToan như mọi đường khác. */
  routes.post('/v1/admin/orders/:id/fulfil', async (c) => {
    const id = orderId(c.req.param('id'));
    const kq = await voiSqlCua(c, async (sql) => {
      const don = await docDon(sql, id);
      if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
      if (don.status !== 'paid' && don.status !== 'paid_unfulfilled') {
        throw new ApiError(
          409,
          'order_not_fulfillable',
          'Chỉ cấp lại đơn đã có tiền mà chưa vào sổ',
        );
      }
      return await apDungThanhToan(sql, c.env, id, { ...deps, now });
    });
    thongBaoSauApDung(
      c.env,
      c.executionCtx,
      kq,
      { origin: new URL(c.req.url).origin, suKienMoi: false },
      deps,
    );
    ghiAudit(c, 'admin.order.fulfil', id, {
      order_code: kq.don.order_code,
      ket_qua: kq.trangThai,
      loi:
        kq.trangThai === 'paid_unfulfilled' && kq.cap.status === 'paid_unfulfilled'
          ? kq.cap.error
          : null,
    });
    return c.json({ order: donJsonAdmin(kq.don), ketQua: kq.trangThai }, 200, NO_STORE);
  });

  /**
   * Xác nhận đã nhận tiền bằng tay (spec 13). Dựng một sự kiện `provider = 'manual'` với
   * `reference = manual:<operationId>` — UNIQUE sẵn có làm lệnh này idempotent — rồi đi qua ĐÚNG
   * `apDungThanhToan` như webhook. Lý do và mã tham chiếu ngân hàng nằm cả trong payload lẫn audit,
   * vì đây là lần duy nhất một con người tự khẳng định tiền đã về.
   */
  routes.post('/v1/admin/orders/:id/confirm-manual', async (c) => {
    const id = orderId(c.req.param('id'));
    const body = await docJson(c.req.raw);
    const operationId =
      typeof body.operationId === 'string' && OPERATION_ID.test(body.operationId)
        ? body.operationId
        : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const bankReference =
      typeof body.bankReference === 'string' ? body.bankReference.trim().slice(0, 64) : '';
    if (!operationId || !reason || !bankReference) {
      throw new ApiError(
        400,
        'invalid_confirm',
        'Cần operationId, lý do và mã tham chiếu ngân hàng',
      );
    }
    const soTienNhap = body.amountVnd === undefined ? null : Number(body.amountVnd);
    if (soTienNhap !== null && (!Number.isSafeInteger(soTienNhap) || soTienNhap <= 0)) {
      throw new ApiError(400, 'invalid_confirm', 'amountVnd phải là số nguyên dương');
    }
    const reference = `manual:${operationId}`;

    const { kq, moi } = await voiSqlCua(c, async (sql) => {
      const don = await docDon(sql, id);
      if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');

      if (!['pending', 'underpaid', 'expired'].includes(don.status)) {
        // Cùng operationId gọi lại sau khi đã xong (bấm hai lần, mạng chập): trả trạng thái hiện
        // tại, không lỗi. Một operationId LẠ trên đơn đã xong mới là 409.
        if (await daCoSuKien(sql, 'manual', reference)) {
          return { kq: { trangThai: 'khong_doi' as const, don }, moi: false };
        }
        throw new ApiError(
          409,
          'order_not_confirmable',
          'Chỉ xác nhận tay cho đơn pending, underpaid hoặc expired',
        );
      }

      const daCo = await tongTienDaNhan(sql, don.id);
      const conThieu = Math.max(0, don.amount_vnd - daCo.tong);
      const amountVnd = soTienNhap ?? conThieu;
      if (amountVnd <= 0) throw new ApiError(409, 'order_not_confirmable', 'Đơn đã đủ tiền');

      const moi = await ghiSuKienThanhToan(sql, {
        orderId: don.id,
        provider: 'manual',
        reference,
        orderCode: don.order_code,
        amountVnd,
        signatureValid: true,
        payload: { reason, bankReference, actor: c.get('reviewer') ?? '', amount: amountVnd },
      });
      const kq = await apDungThanhToan(sql, c.env, don.id, { ...deps, now });
      return { kq: kq as KetQuaApDung, moi };
    });

    thongBaoSauApDung(
      c.env,
      c.executionCtx,
      kq,
      { origin: new URL(c.req.url).origin, suKienMoi: moi },
      deps,
    );
    ghiAudit(c, 'admin.order.confirm_manual', id, {
      order_code: kq.don.order_code,
      operation_id: operationId,
      reason,
      bank_reference: bankReference,
      ket_qua: kq.trangThai,
      moi,
    });
    return c.json({ order: donJsonAdmin(kq.don), ketQua: kq.trangThai, moi }, 200, NO_STORE);
  });

  return routes;
}

export const adminOrders = adminOrdersWith();
