import { Hono } from 'hono';
import { khopChuKy } from '../commerce/chu-ky';
import { docDonTheoOrderCode, ghiSuKienThanhToan } from '../commerce/db';
import { apDungThanhToan, type FulfilDeps } from '../commerce/fulfil';
import { type ThongBaoDeps, thongBaoSauApDung } from '../commerce/thong-bao';
import { endSql, getSql } from '../db';
import { sha256Hex } from '../edits/hash';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const MAX_BODY = 16 * 1024;

export interface PayWebhookDeps extends FulfilDeps, ThongBaoDeps {
  sql?: (env: Env) => ReturnType<typeof getSql>;
}

interface TruongWebhook {
  orderCode: number | null;
  amount: number | null;
  reference: string | null;
  code: string;
}

/** Đọc bốn trường cần dùng, mỗi trường kiểm kiểu: payload là dữ liệu bên ngoài dù chữ ký đúng. */
function docTruong(data: Record<string, unknown>): TruongWebhook {
  const orderCode =
    typeof data.orderCode === 'number' && Number.isSafeInteger(data.orderCode) && data.orderCode > 0
      ? data.orderCode
      : null;
  const amount =
    typeof data.amount === 'number' && Number.isSafeInteger(data.amount) && data.amount >= 0
      ? data.amount
      : null;
  const reference =
    typeof data.reference === 'string' && data.reference.trim().length > 0
      ? data.reference.trim().slice(0, 128)
      : null;
  return { orderCode, amount, reference, code: String(data.code ?? '') };
}

/**
 * Webhook PayOS (spec 9.2). Không Access, không CSRF, không cookie: server-to-server, và chữ ký
 * HMAC là cổng DUY NHẤT — nên nó được kiểm trước khi đọc bất kỳ trường nào, và không nhánh nào
 * chạy tiếp khi sai. Mọi đường hợp lệ đều trả 200 kể cả khi cấp gói hỏng: tiền đã nhận là sự thật,
 * cấp gói là việc của ta (cron thử lại). Chỉ lỗi Postgres mới thành 503 để PayOS gửi lại.
 */
export function payWebhookWith(deps: PayWebhookDeps = {}) {
  const routes = new Hono<AppEnv>();

  routes.post('/v1/pay/payos/webhook', async (c) => {
    const key = c.env.PAYOS_CHECKSUM_KEY;
    // Fail closed: thiếu khoá thì không có cách nào phân biệt webhook thật với webhook giả.
    if (!key) throw new ApiError(503, 'payment_provider_not_configured', 'Chưa cấu hình PayOS');

    const text = await c.req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY) {
      throw new ApiError(413, 'payload_too_large', 'Webhook quá lớn');
    }
    let than: { data?: unknown; signature?: unknown };
    try {
      than = JSON.parse(text) as { data?: unknown; signature?: unknown };
    } catch {
      throw new ApiError(400, 'invalid_webhook', 'Webhook không phải JSON');
    }
    const data = than?.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new ApiError(400, 'invalid_webhook', 'Webhook thiếu data');
    }
    const duLieu = data as Record<string, unknown>;
    const hopLe = await khopChuKy(
      duLieu,
      typeof than.signature === 'string' ? than.signature : '',
      key,
    );

    const sql = (deps.sql ?? getSql)(c.env);
    try {
      if (!hopLe) {
        await ghiSaiChuKy(c.env, c.req.raw, sql, text, duLieu);
        throw new ApiError(400, 'invalid_signature', 'Chữ ký webhook không hợp lệ');
      }

      const truong = docTruong(duLieu);
      if (!truong.reference) throw new ApiError(400, 'invalid_webhook', 'Webhook thiếu reference');

      const don =
        truong.orderCode === null ? null : await docDonTheoOrderCode(sql, truong.orderCode);
      const tienVao = truong.code === '00' && truong.amount !== null && truong.amount > 0;
      const moi = await ghiSuKienThanhToan(sql, {
        orderId: don?.id ?? null,
        provider: 'payos',
        reference: truong.reference,
        orderCode: truong.orderCode,
        amountVnd: tienVao ? truong.amount : null,
        signatureValid: true,
        payload: duLieu,
      });

      // Webhook thử của PayOS lúc đăng ký URL rơi vào đúng nhánh này: lưu lại, trả 200, và admin
      // thấy nó ở mục "Giao dịch không khớp đơn".
      if (!don) return c.json({ received: true, matched: false, duplicate: !moi }, 200, NO_STORE);
      if (!tienVao) {
        return c.json(
          { received: true, matched: true, applied: false, duplicate: !moi },
          200,
          NO_STORE,
        );
      }

      // Trùng reference vẫn áp dụng lại: lần nhận trước có thể đã ghi được sự kiện rồi đổ ở bước
      // cấp gói. `apDungThanhToan` idempotent nên gọi thừa không hại.
      const kq = await apDungThanhToan(sql, c.env, don.id, deps);
      thongBaoSauApDung(
        c.env,
        c.executionCtx,
        kq,
        { origin: new URL(c.req.url).origin, suKienMoi: moi },
        deps,
      );
      return c.json(
        { received: true, matched: true, duplicate: !moi, status: kq.don.status },
        200,
        NO_STORE,
      );
    } finally {
      endSql(c.executionCtx, sql);
    }
  });

  return routes;
}

/**
 * Ghi lại webhook sai chữ ký để admin thấy có ai đang gõ cửa — nhưng có trần: tối đa 20 dòng mỗi
 * phút mỗi IP, và `reference = invalid:<sha256 thân>` nên cùng một thân chỉ chiếm một dòng.
 * KHÔNG lưu payload nguyên văn: nó không đáng tin, và chỉ vài trường là đủ để nhận dạng.
 */
async function ghiSaiChuKy(
  env: Env,
  req: Request,
  sql: ReturnType<typeof getSql>,
  text: string,
  data: Record<string, unknown>,
): Promise<void> {
  console.warn('[pay] webhook sai chữ ký');
  const limiter = env.PAYOS_WEBHOOK_RATE_LIMITER;
  if (limiter) {
    const ip = req.headers.get('CF-Connecting-IP') ?? 'khong-ro';
    const { success } = await limiter.limit({ key: await sha256Hex(ip) });
    if (!success) return;
  }
  await ghiSuKienThanhToan(sql, {
    orderId: null,
    provider: 'payos',
    reference: `invalid:${await sha256Hex(text)}`,
    orderCode: typeof data.orderCode === 'number' ? data.orderCode : null,
    amountVnd: null,
    signatureValid: false,
    payload: {
      code: data.code ?? null,
      orderCode: data.orderCode ?? null,
      amount: data.amount ?? null,
      kich_thuoc: text.length,
    },
  });
}

export const payWebhook = payWebhookWith();
