import { describe, expect, it, vi } from 'vitest';
import { kyDuLieu, kyTaoLink } from '../src/commerce/chu-ky';
import { chonPayosPort, PayosError, type PayosEnv } from '../src/commerce/payos';

const KHOA = 'kiem-thu-checksum-key';
const env = {
  ENVIRONMENT: 'test',
  PAYOS_CLIENT_ID: 'client-1',
  PAYOS_API_KEY: 'api-key-1',
  PAYOS_CHECKSUM_KEY: KHOA,
  PAYOS_BASE: 'https://payos.test',
} as PayosEnv;

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const input = {
  orderCode: 100001,
  amount: 1_950_000,
  description: 'MLV100001',
  returnUrl: `https://api.test/console/don-hang/${ORDER_ID}?ket-qua=thanh-cong`,
  cancelUrl: `https://api.test/console/don-hang/${ORDER_ID}?ket-qua=huy`,
  expiredAt: new Date('2026-09-20T10:00:00Z'),
  buyerEmail: 'khach@vidu.vn',
  buyerName: null,
  buyerCompanyName: 'Công ty Thử',
  buyerTaxCode: null,
  buyerAddress: null,
  itemName: 'Starter 3 tháng',
};

/** Phản hồi PayOS hợp lệ: thân JSON kèm chữ ký ĐÚNG trên `data`. */
const phanHoi = async (data: Record<string, unknown>, code = '00') =>
  new Response(
    JSON.stringify({
      code,
      desc: code === '00' ? 'success' : 'lỗi',
      data,
      signature: await kyDuLieu(data, KHOA),
    }),
    { headers: { 'content-type': 'application/json' } },
  );

const dataTao = {
  bin: '970422',
  accountNumber: '0123456789',
  accountName: 'DO TIEN PHONG',
  amount: 1_950_000,
  description: 'MLV100001',
  orderCode: 100001,
  currency: 'VND',
  paymentLinkId: 'link-abc',
  status: 'PENDING',
  checkoutUrl: 'https://pay.payos.vn/web/link-abc',
  qrCode: '000201...',
};

type FetchGia = ReturnType<typeof vi.fn>;

/**
 * Repo bật `exactOptionalPropertyTypes`, nên không gán thẳng `undefined` vào một prop tuỳ chọn
 * được. Dùng `Record<string, unknown>` cho phần ghi đè rồi ép kiểu MỘT lần ở cuối — cùng lối viết
 * với console-auth.test.ts.
 */
const moiTruong = (them: Record<string, unknown> = {}) =>
  ({ ...env, ...them }) as unknown as PayosEnv;
const cong = (fetchImpl: FetchGia, them: Record<string, unknown> = {}) =>
  chonPayosPort(moiTruong(them), fetchImpl as unknown as typeof fetch);

describe('chonPayosPort', () => {
  it('thiếu một trong ba khoá → bản thieu-cau-hinh, mọi lời gọi ném payment_provider_not_configured', async () => {
    const port = chonPayosPort(moiTruong({ PAYOS_API_KEY: undefined }));
    expect(port.ten).toBe('thieu-cau-hinh');
    await expect(port.taoLink(input)).rejects.toMatchObject({
      code: 'payment_provider_not_configured',
    });
    await expect(port.docLink(100001)).rejects.toBeInstanceOf(PayosError);
    await expect(port.huyLink(100001, 'x')).rejects.toBeInstanceOf(PayosError);
  });

  it('đủ khoá → bản thật; gốc checkout mặc định khi không đặt PAYOS_CHECKOUT_BASE', () => {
    const port = chonPayosPort(moiTruong({ PAYOS_BASE: undefined }));
    expect(port.ten).toBe('payos');
    expect(port.checkoutUrlTuId('abc')).toBe('https://pay.payos.vn/web/abc');
  });
});

describe('taoLink', () => {
  it('gửi đúng header, đúng thân, chữ ký đúng, expiredAt là giây', async () => {
    const fetchImpl = vi.fn(async () => phanHoi(dataTao));
    const link = await cong(fetchImpl).taoLink(input);

    expect(link).toEqual({
      paymentLinkId: 'link-abc',
      checkoutUrl: 'https://pay.payos.vn/web/link-abc',
      qrCode: '000201...',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://payos.test/v2/payment-requests');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-client-id']).toBe('client-1');
    expect(headers['x-api-key']).toBe('api-key-1');

    const than = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(than.orderCode).toBe(100001);
    expect(than.amount).toBe(1_950_000);
    expect(than.description).toBe('MLV100001');
    expect(than.expiredAt).toBe(Math.floor(input.expiredAt.getTime() / 1000));
    expect(than.buyerEmail).toBe('khach@vidu.vn');
    expect(than.buyerCompanyName).toBe('Công ty Thử');
    // Trường rỗng bị BỎ HẲN chứ không gửi null: PayOS đưa chúng vào hoá đơn điện tử.
    expect(than).not.toHaveProperty('buyerName');
    expect(than).not.toHaveProperty('buyerTaxCode');
    expect(than.items).toEqual([{ name: 'Starter 3 tháng', quantity: 1, price: 1_950_000 }]);
    expect(than.signature).toBe(
      await kyTaoLink(
        {
          amount: 1_950_000,
          cancelUrl: input.cancelUrl,
          description: 'MLV100001',
          orderCode: 100001,
          returnUrl: input.returnUrl,
        },
        KHOA,
      ),
    );
  });

  it('chữ ký phản hồi SAI → PayosError payos_response_signature, KHÔNG trả link', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: '00', desc: 'success', data: dataTao, signature: 'f'.repeat(64) }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(cong(fetchImpl).taoLink(input)).rejects.toMatchObject({
      code: 'payos_response_signature',
    });
  });

  it('desc "Đơn thanh toán đã tồn tại" → mã payos_order_exists để route rơi về GET', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: '231', desc: 'Đơn thanh toán đã tồn tại', data: null }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(cong(fetchImpl).taoLink(input)).rejects.toMatchObject({
      code: 'payos_order_exists',
    });
  });

  it('mạng hỏng → payos_unreachable, thông điệp KHÔNG chứa khoá', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    let loi: Error | null = null;
    try {
      await cong(fetchImpl).taoLink(input);
    } catch (error) {
      loi = error as Error;
    }
    expect(loi).toMatchObject({ code: 'payos_unreachable' });
    // Khoá không được lọt vào message, vì message đi thẳng vào log Workers.
    expect(loi?.message).not.toContain('api-key-1');
    expect(loi?.message).not.toContain(KHOA);
  });

  it('phản hồi không phải JSON → payos_bad_response', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    await expect(cong(fetchImpl).taoLink(input)).rejects.toMatchObject({
      code: 'payos_bad_response',
    });
  });
});

describe('docLink', () => {
  it('trả trạng thái và giao dịch; transactions không phải mảng thì thành []', async () => {
    const data = {
      id: 'link-abc',
      orderCode: 100001,
      amount: 1_950_000,
      amountPaid: 1_950_000,
      amountRemaining: 0,
      status: 'PAID',
      createdAt: '2026-09-19T10:00:00.000Z',
      transactions: [
        { reference: 'FT1', amount: 1_950_000, transactionDateTime: '2026-09-19 17:01:00' },
      ],
    };
    const fetchImpl = vi.fn(async () => phanHoi(data));
    const thongTin = await cong(fetchImpl).docLink(100001);
    expect(thongTin).toMatchObject({
      paymentLinkId: 'link-abc',
      status: 'PAID',
      amountPaid: 1_950_000,
      amountRemaining: 0,
    });
    expect(thongTin?.transactions).toEqual([
      { reference: 'FT1', amount: 1_950_000, transactionDateTime: '2026-09-19 17:01:00' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://payos.test/v2/payment-requests/100001');
    expect(init.method).toBe('GET');

    const khongMang = vi.fn(async () => phanHoi({ ...data, transactions: {} }));
    expect((await cong(khongMang).docLink(100001))?.transactions).toEqual([]);
  });

  it('"Mã thanh toán không tồn tại" → null; lỗi khác → ném', async () => {
    const khongCo = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: '101', desc: 'Mã thanh toán không tồn tại', data: null }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    expect(await cong(khongCo).docLink(1)).toBeNull();

    const loiKhac = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(cong(loiKhac).docLink(1)).rejects.toMatchObject({ code: 'payos_bad_response' });
  });
});

describe('huyLink', () => {
  it('POST /cancel kèm lý do', async () => {
    const fetchImpl = vi.fn(async () =>
      phanHoi({ id: 'link-abc', orderCode: 100001, status: 'CANCELLED', transactions: [] }),
    );
    await cong(fetchImpl).huyLink(100001, 'Khách huỷ');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://payos.test/v2/payment-requests/100001/cancel');
    expect(JSON.parse(String(init.body))).toEqual({ cancellationReason: 'Khách huỷ' });
  });

  it('link không tồn tại cũng coi là xong — huỷ một thứ không có là thành công', async () => {
    const khongCo = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: '101', desc: 'Mã thanh toán không tồn tại', data: null }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(cong(khongCo).huyLink(1, 'x')).resolves.toBeUndefined();
  });
});
