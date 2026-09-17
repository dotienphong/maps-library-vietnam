import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type QuotaReceipt } from './client';

const HET_HAN = () => new Date(Date.now() + 120_000).toISOString();

const headerReceipt = (id: string) => ({
  'x-mapslibvn-receipt-id': id,
  'x-mapslibvn-receipt-token': `token-${id}`,
  'x-mapslibvn-receipt-version': '1',
  'x-mapslibvn-receipt-expires-at': HET_HAN(),
});

function listStore(initial: QuotaReceipt[] = []) {
  let list = [...initial];
  return {
    load: async () => [...list],
    save: async (receipt: QuotaReceipt) => {
      list = [...list.filter((item) => item.id !== receipt.id), receipt];
    },
    remove: async (receiptId: string) => {
      list = list.filter((item) => item.id !== receiptId);
    },
    hienCo: () => list.map((item) => item.id),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('ACK sống sót khi người dùng bỏ đi giữa chừng', () => {
  it('request ACK gửi kèm keepalive để không chết theo tab đang đóng', async () => {
    // `void flushPending()` bắn đi rồi không chờ. Không có keepalive thì trình duyệt huỷ luôn
    // request ACK khi tab đóng, và receipt đó thành một dòng missed_ack sau 120 giây.
    const inits: RequestInit[] = [];
    const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/ack')) {
        inits.push(init ?? {});
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: headerReceipt('r-1'),
      });
    });

    const client = createClient({
      apiKey: 'mlv_live_aaaaaaaaaaaaaaaaaaaaaaaa',
      baseUrl: 'https://api.test',
      fetch: fetch as unknown as typeof globalThis.fetch,
      receiptStore: listStore(),
    });
    await client.autocomplete('ben thanh');
    await vi.waitFor(() => expect(inits).toHaveLength(1));
    expect(inits[0]?.keepalive).toBe(true);
  });

  it('body hỏng giữa chừng (request bị huỷ khi gõ tiếp) vẫn ACK được receipt đã nhận', async () => {
    // usePlaces abort request cũ mỗi khi gõ thêm ký tự. Máy chủ đã trả 2xx và đã phát receipt;
    // nếu client chỉ đăng ký receipt SAU khi đọc xong body thì receipt đó không bao giờ được ACK.
    const acked: string[] = [];
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/ack')) {
        acked.push(url.pathname.split('/').at(-2) as string);
        return new Response('{}', { status: 200 });
      }
      // Header đã về đủ, nhưng body không đọc được — đúng hình dạng một request bị huỷ nửa chừng.
      return new Response('{ khong-phai-json', { status: 200, headers: headerReceipt('r-2') });
    });

    const client = createClient({
      apiKey: 'mlv_live_aaaaaaaaaaaaaaaaaaaaaaaa',
      baseUrl: 'https://api.test',
      fetch: fetch as unknown as typeof globalThis.fetch,
      receiptStore: listStore(),
    });

    await expect(client.autocomplete('ben thanh')).rejects.toThrow();
    await vi.waitFor(() => expect(acked).toEqual(['r-2']));
  });

  it('trang bị ẩn hoặc đóng → flush ngay những receipt còn chờ', async () => {
    // Nguồn rò rỉ thứ hai: đóng tab ngay sau khi thấy kết quả. Không có móc nào thì ACK cuối cùng
    // của mỗi phiên chết theo trang, và ba phiên là chạm ngưỡng khoá.
    const handlers = new Map<string, () => void>();
    vi.stubGlobal('addEventListener', (ten: string, fn: () => void) => handlers.set(ten, fn));
    vi.stubGlobal('removeEventListener', (ten: string) => handlers.delete(ten));

    const acked: string[] = [];
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/ack')) {
        acked.push(url.pathname.split('/').at(-2) as string);
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });

    const client = createClient({
      apiKey: 'mlv_live_aaaaaaaaaaaaaaaaaaaaaaaa',
      baseUrl: 'https://api.test',
      fetch: fetch as unknown as typeof globalThis.fetch,
      // Receipt còn sót từ phiên trước, đúng như localStorage giữ lại.
      receiptStore: listStore([
        { id: 'r-cu', token: 'token-r-cu', version: '1', expiresAt: HET_HAN() },
      ]),
    });
    expect(client.flushReceipts).toBeTypeOf('function');

    handlers.get('pagehide')?.();
    await vi.waitFor(() => expect(acked).toEqual(['r-cu']));
  });

  it('gọi flushReceipts thủ công cũng ACK (React Native dùng khi app vào nền)', async () => {
    const acked: string[] = [];
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/ack')) {
        acked.push(url.pathname.split('/').at(-2) as string);
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    const client = createClient({
      apiKey: 'mlv_live_aaaaaaaaaaaaaaaaaaaaaaaa',
      baseUrl: 'https://api.test',
      fetch: fetch as unknown as typeof globalThis.fetch,
      receiptStore: listStore([
        { id: 'r-nen', token: 'token-r-nen', version: '1', expiresAt: HET_HAN() },
      ]),
    });

    await client.flushReceipts();
    expect(acked).toEqual(['r-nen']);
  });
});
