import type { Env } from '../env';
import { khopChuKy, kyTaoLink } from './chu-ky';

/**
 * Cổng PayOS. Ba lời gọi REST, và mỗi lời gọi kiểm chữ ký trên `data` của phản hồi như SDK chính
 * thức làm — TLS hỏng hay một proxy "tốt bụng" sửa thân phản hồi thì lộ ngay, chứ không âm thầm
 * lưu một checkoutUrl lạ vào đơn của khách.
 *
 * PayOS KHÔNG có môi trường sandbox (tài liệu chính thức nói thẳng), nên bản giả trong
 * scripts/lib/payos-fake.mjs là nơi duy nhất kiểm được đường này mà không mất tiền thật.
 */

export type PayosEnv = Pick<
  Env,
  | 'ENVIRONMENT'
  | 'PAYOS_CLIENT_ID'
  | 'PAYOS_API_KEY'
  | 'PAYOS_CHECKSUM_KEY'
  | 'PAYOS_BASE'
  | 'PAYOS_CHECKOUT_BASE'
>;

export const PAYOS_BASE_MAC_DINH = 'https://api-merchant.payos.vn';
export const PAYOS_CHECKOUT_MAC_DINH = 'https://pay.payos.vn';
/** PayOS chậm hơn mức này thì coi như không tới: khách đang chờ mã QR trên màn hình. */
const TIMEOUT_MS = 10_000;

/** Mã nằm ở `code` để route khớp; `message` KHÔNG bao giờ chứa khoá hay dữ liệu của khách. */
export class PayosError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PayosError';
  }
}

export interface TaoLinkInput {
  orderCode: number;
  amount: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  expiredAt: Date;
  buyerEmail: string;
  buyerName: string | null;
  buyerCompanyName: string | null;
  buyerTaxCode: string | null;
  buyerAddress: string | null;
  itemName: string;
}

export interface LinkThanhToan {
  paymentLinkId: string;
  checkoutUrl: string;
  /** Chuỗi VietQR (EMVCo). null khi PayOS không trả — giao diện chỉ còn nút mở trang thanh toán. */
  qrCode: string | null;
}

export interface GiaoDichPayos {
  reference: string;
  amount: number;
  transactionDateTime: string;
}

export interface ThongTinLink {
  paymentLinkId: string;
  orderCode: number;
  amount: number;
  amountPaid: number;
  amountRemaining: number;
  /** PENDING | PAID | CANCELLED | EXPIRED — giữ string vì PayOS có thể thêm giá trị. */
  status: string;
  transactions: GiaoDichPayos[];
}

export interface PayosPort {
  ten: 'payos' | 'thieu-cau-hinh';
  taoLink(input: TaoLinkInput): Promise<LinkThanhToan>;
  /** null khi PayOS nói mã thanh toán không tồn tại; lỗi khác thì ném. */
  docLink(orderCode: number): Promise<ThongTinLink | null>;
  huyLink(orderCode: number, lyDo: string): Promise<void>;
  checkoutUrlTuId(paymentLinkId: string): string;
}

interface ThanPayos {
  code?: string;
  desc?: string;
  data?: Record<string, unknown> | null;
  signature?: string;
}

/** Mã ổn định suy từ `desc` vì PayOS không tài liệu hoá mã số; hai câu này lấy nguyên văn từ docs. */
function maTuDesc(than: ThanPayos): string {
  const desc = (than.desc ?? '').toLowerCase();
  if (desc.includes('đã tồn tại')) return 'payos_order_exists';
  if (desc.includes('không tồn tại')) return 'payos_not_found';
  return `payos_${than.code ?? 'unknown'}`;
}

const soNguyen = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;

function docGiaoDich(raw: unknown): GiaoDichPayos[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      reference: String(t.reference ?? ''),
      amount: soNguyen(t.amount),
      transactionDateTime: String(t.transactionDateTime ?? ''),
    }))
    .filter((t) => t.reference !== '');
}

export function chonPayosPort(env: PayosEnv, fetchImpl: typeof fetch = fetch): PayosPort {
  const checkoutBase = (env.PAYOS_CHECKOUT_BASE ?? PAYOS_CHECKOUT_MAC_DINH).replace(/\/+$/, '');
  const checkoutUrlTuId = (id: string) => `${checkoutBase}/web/${encodeURIComponent(id)}`;

  const clientId = env.PAYOS_CLIENT_ID;
  const apiKey = env.PAYOS_API_KEY;
  const checksumKey = env.PAYOS_CHECKSUM_KEY;
  if (!clientId || !apiKey || !checksumKey) {
    // Fail closed: thiếu khoá thì KHÔNG có nhánh nào chạy tiếp, kể cả nhánh kiểm chữ ký webhook.
    const tuChoi = () =>
      Promise.reject(
        new PayosError('payment_provider_not_configured', 'Chưa cấu hình PayOS trên máy chủ'),
      );
    return {
      ten: 'thieu-cau-hinh',
      taoLink: tuChoi,
      docLink: tuChoi,
      huyLink: tuChoi,
      checkoutUrlTuId,
    };
  }

  const base = (env.PAYOS_BASE ?? PAYOS_BASE_MAC_DINH).replace(/\/+$/, '');

  async function goi(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ThanPayos> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          'x-client-id': clientId as string,
          'x-api-key': apiKey as string,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // KHÔNG nhét message của fetch vào đây: nó có thể mang cả URL kèm tham số vào log.
      throw new PayosError('payos_unreachable', `Không gọi được PayOS (${method} ${path})`);
    }
    let than: ThanPayos;
    try {
      than = (await res.json()) as ThanPayos;
    } catch {
      throw new PayosError('payos_bad_response', `PayOS trả ${res.status} không phải JSON`);
    }
    if (!res.ok && !than.code) {
      throw new PayosError(`payos_http_${res.status}`, `PayOS trả HTTP ${res.status}`);
    }
    return than;
  }

  /** Mọi `data` của PayOS đều có chữ ký; sai là dừng, không dùng một trường nào trong đó. */
  async function duLieuDaKiem(than: ThanPayos): Promise<Record<string, unknown>> {
    if (than.code !== '00' || !than.data) {
      throw new PayosError(maTuDesc(than), than.desc ?? 'PayOS từ chối');
    }
    if (!(await khopChuKy(than.data, than.signature ?? '', checksumKey as string))) {
      throw new PayosError('payos_response_signature', 'Chữ ký phản hồi PayOS không khớp');
    }
    return than.data;
  }

  return {
    ten: 'payos',
    checkoutUrlTuId,

    async taoLink(input) {
      const signature = await kyTaoLink(
        {
          amount: input.amount,
          cancelUrl: input.cancelUrl,
          description: input.description,
          orderCode: input.orderCode,
          returnUrl: input.returnUrl,
        },
        checksumKey as string,
      );
      const than = await goi('POST', '/v2/payment-requests', {
        orderCode: input.orderCode,
        amount: input.amount,
        description: input.description,
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        expiredAt: Math.floor(input.expiredAt.getTime() / 1000),
        buyerEmail: input.buyerEmail,
        // Bốn trường dưới chỉ gửi khi CÓ giá trị: PayOS đưa chúng vào hoá đơn điện tử, và một
        // chuỗi rỗng ở đó là một dòng trống trên chứng từ của khách.
        ...(input.buyerName ? { buyerName: input.buyerName } : {}),
        ...(input.buyerCompanyName ? { buyerCompanyName: input.buyerCompanyName } : {}),
        ...(input.buyerTaxCode ? { buyerTaxCode: input.buyerTaxCode } : {}),
        ...(input.buyerAddress ? { buyerAddress: input.buyerAddress } : {}),
        items: [{ name: input.itemName, quantity: 1, price: input.amount }],
        signature,
      });
      const data = await duLieuDaKiem(than);
      const paymentLinkId = String(data.paymentLinkId ?? '');
      return {
        paymentLinkId,
        checkoutUrl:
          typeof data.checkoutUrl === 'string' && data.checkoutUrl
            ? data.checkoutUrl
            : checkoutUrlTuId(paymentLinkId),
        qrCode: typeof data.qrCode === 'string' && data.qrCode ? data.qrCode : null,
      };
    },

    async docLink(orderCode) {
      const than = await goi('GET', `/v2/payment-requests/${orderCode}`);
      if (than.code !== '00' && maTuDesc(than) === 'payos_not_found') return null;
      const data = await duLieuDaKiem(than);
      return {
        paymentLinkId: String(data.id ?? ''),
        orderCode: soNguyen(data.orderCode),
        amount: soNguyen(data.amount),
        amountPaid: soNguyen(data.amountPaid),
        amountRemaining: soNguyen(data.amountRemaining),
        status: String(data.status ?? ''),
        transactions: docGiaoDich(data.transactions),
      };
    },

    async huyLink(orderCode, lyDo) {
      const than = await goi('POST', `/v2/payment-requests/${orderCode}/cancel`, {
        cancellationReason: lyDo,
      });
      // Huỷ một link không còn tồn tại là thành công: kết quả mong muốn đã đạt.
      if (than.code !== '00' && maTuDesc(than) === 'payos_not_found') return;
      await duLieuDaKiem(than);
    },
  };
}
