import { describe, expect, it, vi } from 'vitest';
import { ackReceipt, getAndAck, receiptFrom } from './receipt-ack.mjs';

const withReceipt = (body = {}) =>
  new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'x-mapslibvn-receipt-id': 'req-1',
      'x-mapslibvn-receipt-token': 'tok-1',
    },
  });

describe('receiptFrom', () => {
  it('đủ cả hai header → receipt; thiếu một → null (tenant legacy)', () => {
    expect(receiptFrom(withReceipt())).toEqual({ id: 'req-1', token: 'tok-1' });
    expect(receiptFrom(new Response('{}'))).toBeNull();
    expect(
      receiptFrom(new Response('{}', { headers: { 'x-mapslibvn-receipt-id': 'req-1' } })),
    ).toBeNull();
  });
});

describe('ackReceipt', () => {
  it('POST đúng đường dẫn và body token; 404 (legacy) vẫn coi là xong; lỗi mạng → false', async () => {
    /** @type {{ url: string, init: RequestInit & { headers: Record<string, string> } }[]} */
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    });
    expect(
      await ackReceipt(
        'https://api.test',
        'mlv_live_x',
        { id: 'req 1', token: 'tok-1' },
        {
          fetchImpl,
        },
      ),
    ).toBe(true);
    const first = calls[0];
    if (!first) throw new Error('không có lời gọi nào');
    expect(first.url).toBe('https://api.test/v1/quota/receipts/req%201/ack');
    expect(first.init.method).toBe('POST');
    expect(JSON.parse(String(first.init.body))).toEqual({ token: 'tok-1' });
    expect(first.init.headers['X-Api-Key']).toBe('mlv_live_x');

    const notFound = vi.fn(async () => new Response('{}', { status: 404 }));
    expect(
      await ackReceipt('https://api.test', 'k', { id: 'r', token: 't' }, { fetchImpl: notFound }),
    ).toBe(true);

    const boom = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(
      await ackReceipt('https://api.test', 'k', { id: 'r', token: 't' }, { fetchImpl: boom }),
    ).toBe(false);
    expect(boom).toHaveBeenCalledTimes(2); // thử lại một lần

    // Trượt lần đầu rồi thành công: phải trả true, không được tính là receipt treo.
    let lan = 0;
    const chapChon = vi.fn(async () => {
      lan += 1;
      return lan === 1 ? new Response('', { status: 503 }) : new Response('{}', { status: 200 });
    });
    expect(
      await ackReceipt('https://api.test', 'k', { id: 'r', token: 't' }, { fetchImpl: chapChon }),
    ).toBe(true);
    expect(chapChon).toHaveBeenCalledTimes(2);

    // 403 (token sai) là lỗi thật: KHÔNG thử lại, tốn thêm một vòng vô ích.
    const tokenSai = vi.fn(async () => new Response('{}', { status: 403 }));
    expect(
      await ackReceipt('https://api.test', 'k', { id: 'r', token: 't' }, { fetchImpl: tokenSai }),
    ).toBe(false);
    expect(tokenSai).toHaveBeenCalledTimes(1);

    // Không có receipt thì không gọi mạng.
    const never = vi.fn();
    expect(await ackReceipt('https://api.test', 'k', null, { fetchImpl: never })).toBe(true);
    expect(never).not.toHaveBeenCalled();
  });
});

describe('getAndAck', () => {
  it('trả body và status, ACK ngay receipt; ms đo TRƯỚC vòng ACK', async () => {
    /** @type {string[]} */
    const urls = [];
    const fetchImpl = vi.fn(async (url) => {
      urls.push(String(url));
      return String(url).includes('/ack')
        ? new Response('{}', { status: 200 })
        : withReceipt({ mode: 'motorbike' });
    });
    const r = await getAndAck('https://api.test/v1/matrix?x=1', 'https://api.test', 'k', {
      fetchImpl,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ mode: 'motorbike' });
    expect(r.ackFailed).toBe(false);
    expect(urls).toEqual([
      'https://api.test/v1/matrix?x=1',
      'https://api.test/v1/quota/receipts/req-1/ack',
    ]);
  });

  it('lỗi 4xx vẫn đọc code và vẫn ACK nếu có receipt', async () => {
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes('/ack')
        ? new Response('{}', { status: 200 })
        : new Response(JSON.stringify({ error: { code: 'invalid_request' } }), { status: 400 }),
    );
    const r = await getAndAck('https://api.test/v1/matrix', 'https://api.test', 'k', { fetchImpl });
    expect(r.status).toBe(400);
    expect(r.code).toBe('invalid_request');
  });

  it('lỗi mạng → status 0, code là thông điệp lỗi', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const r = await getAndAck('https://api.test/v1/matrix', 'https://api.test', 'k', { fetchImpl });
    expect(r.status).toBe(0);
    expect(r.code).toMatch(/ECONNREFUSED/);
  });
});
