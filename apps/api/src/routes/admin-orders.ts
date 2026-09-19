import { type Context, Hono } from 'hono';
import { audit } from '../audit';
import {
  chuTenant,
  type DonHang,
  daCoSuKien,
  danhDauHoanTien,
  danhSachDonAdmin,
  docDon,
  ghiSuKienThanhToan,
  huyDonAdmin,
  suKienCuaDon,
  suKienKhongKhop,
  type TrangThaiDon,
  tomTatDon,
  tongTienDaNhan,
} from '../commerce/db';
import { apDungThanhToan, type FulfilDeps, type KetQuaApDung } from '../commerce/fulfil';
import { chonPayosPort, type PayosPort } from '../commerce/payos';
import { type ThongBaoDeps, thongBaoSauApDung } from '../commerce/thong-bao';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';
import { ApiError, moTaLoi } from '../errors';
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
const NGAY = /^\d{4}-\d{2}-\d{2}$/;
const MOT_NGAY_MS = 86_400_000;
/** Trạng thái đánh dấu hoàn tiền được — giống hệt điều kiện trong `danhDauHoanTien`, xem lý do ở đó. */
const CO_THE_HOAN_TIEN = new Set<TrangThaiDon>(['fulfilled', 'paid_unfulfilled', 'underpaid']);

type ChiTietAudit = Record<string, string | number | boolean | null>;

/**
 * `from`/`to` nhận "YYYY-MM-DD" hoặc ISO đầy đủ. Ngày-chỉ-có-ngày hiểu theo giờ Việt Nam (người
 * vận hành ngồi ở +07:00), và `to` dạng ngày là BAO GỒM cả ngày đó: ta trả ranh giới 00:00 ngày
 * kế tiếp để SQL dùng `<`. Mốc ISO đầy đủ giữ nguyên.
 */
function docMoc(raw: string | null, laMocCuoi: boolean): Date | null {
  if (raw === null || raw === '') return null;
  const chiNgay = NGAY.test(raw);
  const ms = Date.parse(chiNgay ? `${raw}T00:00:00+07:00` : raw);
  if (!Number.isFinite(ms)) {
    throw new ApiError(400, 'invalid_request', 'from/to phải là ngày YYYY-MM-DD hoặc mốc ISO');
  }
  return new Date(chiNgay && laMocCuoi ? ms + MOT_NGAY_MS : ms);
}

function docLyDo(body: Record<string, unknown>): string {
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!reason) throw new ApiError(400, 'invalid_reason', 'Cần lý do');
  return reason;
}

function docOperationId(body: Record<string, unknown>): string {
  const v = body.operationId;
  if (typeof v !== 'string' || !OPERATION_ID.test(v)) {
    throw new ApiError(400, 'invalid_request', 'operationId phải có 8–64 ký tự [A-Za-z0-9_-]');
  }
  return v;
}

export interface AdminOrdersDeps extends FulfilDeps, ThongBaoDeps {
  sql?: (env: Env) => ReturnType<typeof getSql>;
  /** Cổng PayOS, tiêm được: "Huỷ đơn" phải huỷ link ở PayOS trước khi đánh dấu. */
  payos?: (env: Env) => PayosPort;
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
  const payos = (env: Env) => (deps.payos ?? chonPayosPort)(env);

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
    const tenantRaw = q.get('tenant');
    if (tenantRaw !== null && tenantRaw !== '' && !UUID.test(tenantRaw)) {
      throw new ApiError(400, 'invalid_request', 'tenant phải là uuid');
    }
    const tenantId = tenantRaw ? tenantRaw : null;
    const from = docMoc(q.get('from'), false);
    const to = docMoc(q.get('to'), true);
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
      danhSachDonAdmin(sql, { status, tenantId, from, to, limit, cursor }),
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

  /**
   * Huỷ đơn (spec 13). Thứ tự bắt buộc: PayOS huỷ link TRƯỚC, DB đánh dấu SAU — cùng lý do với
   * `console-orders.ts`: link còn sống mà ta bảo "đã huỷ" là nói sai, và tiền vào sau đó vẫn phải
   * được cấp (bất biến 5.3 — `datDaTra` đã nhận `cancelled`). Gọi lại trên đơn đã cancelled là
   * thành công.
   */
  routes.post('/v1/admin/orders/:id/cancel', async (c) => {
    const id = orderId(c.req.param('id'));
    const body = await docJson(c.req.raw);
    const operationId = docOperationId(body);
    const reason = docLyDo(body);

    const don = await voiSqlCua(c, (sql) => docDon(sql, id));
    if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    if (don.status === 'cancelled') {
      return c.json({ order: donJsonAdmin(don), moi: false }, 200, NO_STORE);
    }
    if (don.status !== 'pending') {
      throw new ApiError(409, 'order_not_cancellable', 'Chỉ huỷ được đơn đang chờ thanh toán');
    }

    // Gọi PayOS NGOÀI phạm vi client Postgres: một lời gọi mạng có thể mất mười giây.
    if (don.payment_link_id) {
      try {
        await payos(c.env).huyLink(don.order_code, `Admin huỷ: ${reason}`.slice(0, 255));
      } catch (error) {
        console.error(`[commerce] admin huỷ link đơn ${don.order_code} lỗi: ${moTaLoi(error)}`);
        throw new ApiError(
          503,
          'payment_provider_unavailable',
          'Cổng thanh toán đang bận, chưa huỷ; hãy thử lại',
        );
      }
    }

    const daHuy = await voiSqlCua(c, (sql) => huyDonAdmin(sql, id, reason));
    if (!daHuy) throw new ApiError(409, 'order_not_cancellable', 'Đơn vừa đổi trạng thái');
    ghiAudit(c, 'admin.order.cancel', id, {
      order_code: don.order_code,
      tenant_id: don.tenant_id,
      operation_id: operationId,
      reason,
      payos_link: don.payment_link_id !== null,
    });
    return c.json(
      { order: donJsonAdmin({ ...don, status: 'cancelled', note: reason }), moi: true },
      200,
      NO_STORE,
    );
  });

  /**
   * Đánh dấu hoàn tiền (spec 9.5, 13). Chỉ ghi nhận: tiền trả lại khách đi ngoài hệ thống, và sổ
   * quota KHÔNG bị đụng — thu hồi quyền dùng là lệnh `suspend` riêng ở màn Gói cước, do người
   * quyết định. Gọi lại trên đơn đã refunded là thành công.
   */
  routes.post('/v1/admin/orders/:id/refund', async (c) => {
    const id = orderId(c.req.param('id'));
    const body = await docJson(c.req.raw);
    const operationId = docOperationId(body);
    const reason = docLyDo(body);

    const kq = await voiSqlCua(c, async (sql) => {
      const don = await docDon(sql, id);
      if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
      if (don.status === 'refunded') return { don, moi: false };
      if (!CO_THE_HOAN_TIEN.has(don.status)) {
        throw new ApiError(
          409,
          'order_not_refundable',
          'Chỉ đánh dấu hoàn tiền cho đơn đã có tiền vào (đã cấp gói, tiền vào chưa cấp, hoặc thiếu tiền)',
        );
      }
      const doi = await danhDauHoanTien(sql, id, reason);
      if (!doi) throw new ApiError(409, 'order_not_refundable', 'Đơn vừa đổi trạng thái');
      return { don: { ...don, status: 'refunded' as const, note: reason }, moi: true };
    });

    if (kq.moi) {
      ghiAudit(c, 'admin.order.refund', id, {
        order_code: kq.don.order_code,
        tenant_id: kq.don.tenant_id,
        operation_id: operationId,
        reason,
        paid_amount_vnd: kq.don.paid_amount_vnd,
      });
    }
    return c.json({ order: donJsonAdmin(kq.don), moi: kq.moi }, 200, NO_STORE);
  });

  return routes;
}

export const adminOrders = adminOrdersWith();
