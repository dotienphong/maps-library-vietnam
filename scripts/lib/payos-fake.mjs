// PayOS giả cho harness itest/E2E. KHÔNG dùng cho production.
//
// Vì sao tồn tại: PayOS không cung cấp môi trường sandbox (tài liệu chính thức nói thẳng), nên đây
// là nơi duy nhất kiểm được đường "tạo link → khách trả → webhook → cấp gói" mà không mất tiền
// thật. Ký bằng ĐÚNG thuật toán của SDK chính thức (cùng vector với
// apps/api/test/commerce-chu-ky.test.ts) để chữ ký phía API được kiểm thật chứ không kiểm với một
// bản giả dễ tính.
//
// Ngoài API của PayOS, bản giả có thêm một đường mô phỏng: POST /__fake/pay/:orderCode đánh dấu đã
// trả và trả về thân webhook đã ký; kèm { webhookUrl } thì tự bắn webhook tới đó.
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

export const PAYOS_FAKE_PORT = 8791;
export const FAKE_CLIENT_ID = 'fake-client-id';
export const FAKE_API_KEY = 'fake-api-key';
export const FAKE_CHECKSUM = 'fake-checksum-key-itest';

/** @param {unknown} gia @returns {Record<string, unknown>} */
const sapXep = (gia) => {
  const o = /** @type {Record<string, unknown>} */ (gia ?? {});
  return Object.keys(o)
    .sort()
    .reduce((a, k) => {
      a[k] = o[k];
      return a;
    }, /** @type {Record<string, unknown>} */ ({}));
};

/** Đúng convertObjToQueryStr(sortObjDataByKey(data)) của @payos/node@2.0.5.
 * @param {Record<string, unknown>} data @returns {string} */
export function chuoiKyDuLieu(data) {
  return Object.keys(data)
    .sort()
    .filter((k) => data[k] !== undefined)
    .map((k) => {
      let v = /** @type {unknown} */ (data[k]);
      if (Array.isArray(v)) v = JSON.stringify(v.map((x) => sapXep(x)));
      if (v === null || v === undefined || v === 'undefined' || v === 'null') v = '';
      return `${k}=${String(v)}`;
    })
    .join('&');
}

/** @param {Record<string, unknown>} data @param {string} khoa @returns {string} */
export const kyDuLieu = (data, khoa) =>
  createHmac('sha256', khoa).update(chuoiKyDuLieu(data)).digest('hex');

/** @param {{amount:number,cancelUrl:string,description:string,orderCode:number,returnUrl:string}} i
 *  @param {string} khoa @returns {string} */
export const kyTaoLink = (i, khoa) =>
  createHmac('sha256', khoa)
    .update(
      `amount=${i.amount}&cancelUrl=${i.cancelUrl}&description=${i.description}` +
        `&orderCode=${i.orderCode}&returnUrl=${i.returnUrl}`,
    )
    .digest('hex');

/** Thân webhook như PayOS gửi, ký bằng `khoa`.
 * @param {{orderCode:number,amount:number,reference:string,code?:string,paymentLinkId?:string}} g
 * @param {string} khoa */
export function dungWebhook(g, khoa) {
  const data = {
    orderCode: g.orderCode,
    amount: g.amount,
    description: `MLV${g.orderCode}`,
    accountNumber: '0123456789',
    reference: g.reference,
    transactionDateTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
    currency: 'VND',
    paymentLinkId: g.paymentLinkId ?? `fake-${g.orderCode}`,
    code: g.code ?? '00',
    desc: g.code && g.code !== '00' ? 'Thất bại' : 'Thành công',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: null,
    counterAccountNumber: null,
    virtualAccountName: '',
    virtualAccountNumber: '',
  };
  return { code: '00', desc: 'success', success: true, data, signature: kyDuLieu(data, khoa) };
}

/** @param {import('node:http').IncomingMessage} req @returns {Promise<Record<string, any>>} */
const docThan = (req) =>
  new Promise((resolve) => {
    let t = '';
    req.on('data', (c) => {
      t += c;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(t || '{}'));
      } catch {
        resolve({});
      }
    });
  });

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} body */
const traJson = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** @param {import('node:http').ServerResponse} res @param {Record<string, unknown>} data
 *  @param {string} khoa */
const traKy = (res, data, khoa) =>
  traJson(res, 200, { code: '00', desc: 'success', data, signature: kyDuLieu(data, khoa) });

/**
 * @param {number} [port] @param {string} [khoa]
 * @returns {Promise<import('node:http').Server>}
 */
export function startPayosFake(port = PAYOS_FAKE_PORT, khoa = FAKE_CHECKSUM) {
  /** @type {Map<number, {id:string,orderCode:number,amount:number,amountPaid:number,status:string,transactions:object[],createdAt:string}>} */
  const links = new Map();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const p = url.pathname;
    if (p === '/healthz') return traJson(res, 200, { ok: true });

    // Mô phỏng khách chuyển khoản — đường này KHÔNG có ở PayOS thật.
    const tra = p.match(/^\/__fake\/pay\/(\d+)$/);
    if (tra && req.method === 'POST') {
      const orderCode = Number(tra[1]);
      const than = await docThan(req);
      const link = links.get(orderCode);
      const amount = Number(than.amount ?? link?.amount ?? 0);
      const reference = String(than.reference ?? `FT${Date.now()}`);
      if (link) {
        link.amountPaid += amount;
        link.status = link.amountPaid >= link.amount ? 'PAID' : 'PENDING';
        link.transactions.push({
          reference,
          amount,
          transactionDateTime: new Date().toISOString(),
        });
      }
      const webhook = dungWebhook(
        {
          orderCode,
          amount,
          reference,
          ...(link ? { paymentLinkId: link.id } : {}),
          ...(than.code ? { code: String(than.code) } : {}),
        },
        khoa,
      );
      if (than.webhookUrl) {
        const r = await fetch(String(than.webhookUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(webhook),
        });
        return traJson(res, 200, {
          webhookStatus: r.status,
          webhookBody: await r.json().catch(() => null),
          webhook,
        });
      }
      return traJson(res, 200, { webhook });
    }

    // Từ đây là API của PayOS thật — kiểm header y như thật.
    if (req.headers['x-client-id'] !== FAKE_CLIENT_ID || req.headers['x-api-key'] !== FAKE_API_KEY) {
      return traJson(res, 401, { code: '401', desc: 'Unauthorized' });
    }

    if (p === '/v2/payment-requests' && req.method === 'POST') {
      const b = await docThan(req);
      const kyDung = kyTaoLink(
        {
          amount: b.amount,
          cancelUrl: b.cancelUrl,
          description: b.description,
          orderCode: b.orderCode,
          returnUrl: b.returnUrl,
        },
        khoa,
      );
      if (b.signature !== kyDung) {
        return traJson(res, 200, {
          code: '20',
          desc: 'Mã kiểm tra(signature) không hợp lệ',
          data: null,
        });
      }
      if (String(b.description ?? '').length > 9) {
        return traJson(res, 200, { code: '21', desc: 'description tối đa 9 ký tự', data: null });
      }
      if (links.has(b.orderCode)) {
        return traJson(res, 200, { code: '231', desc: 'Đơn thanh toán đã tồn tại', data: null });
      }
      const id = `fake-${b.orderCode}`;
      links.set(b.orderCode, {
        id,
        orderCode: b.orderCode,
        amount: b.amount,
        amountPaid: 0,
        status: 'PENDING',
        transactions: [],
        createdAt: new Date().toISOString(),
      });
      return traKy(
        res,
        {
          bin: '970422',
          accountNumber: '0123456789',
          accountName: 'FAKE PAYOS',
          amount: b.amount,
          description: b.description,
          orderCode: b.orderCode,
          currency: 'VND',
          paymentLinkId: id,
          status: 'PENDING',
          checkoutUrl: `http://127.0.0.1:${port}/web/${id}`,
          qrCode: `000201FAKEQR${b.orderCode}`,
        },
        khoa,
      );
    }

    const m = p.match(/^\/v2\/payment-requests\/([^/]+?)(\/cancel)?$/);
    if (m) {
      const link = [...links.values()].find((l) => String(l.orderCode) === m[1] || l.id === m[1]);
      if (!link) {
        return traJson(res, 200, { code: '101', desc: 'Mã thanh toán không tồn tại', data: null });
      }
      if (m[2] && req.method === 'POST') {
        const b = await docThan(req);
        link.status = 'CANCELLED';
        return traKy(
          res,
          {
            id: link.id,
            orderCode: link.orderCode,
            amount: link.amount,
            amountPaid: link.amountPaid,
            amountRemaining: link.amount - link.amountPaid,
            status: link.status,
            createdAt: link.createdAt,
            canceledAt: new Date().toISOString(),
            cancellationReason: String(b.cancellationReason ?? ''),
            transactions: link.transactions,
          },
          khoa,
        );
      }
      return traKy(
        res,
        {
          id: link.id,
          orderCode: link.orderCode,
          amount: link.amount,
          amountPaid: link.amountPaid,
          amountRemaining: link.amount - link.amountPaid,
          status: link.status,
          createdAt: link.createdAt,
          transactions: link.transactions,
        },
        khoa,
      );
    }

    traJson(res, 404, { code: '404', desc: 'not found' });
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// Tiến trình RIÊNG như access-fake: harness chạy vitest bằng spawnSync và chặn event loop của nó,
// nên một server nằm cùng tiến trình sẽ không trả lời được.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await startPayosFake();
  console.log(`payos-fake: http://127.0.0.1:${PAYOS_FAKE_PORT}`);
}
