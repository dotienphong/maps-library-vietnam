import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function stubClient(body: unknown) {
  const fetch = vi.fn(async () => jsonResponse(body));
  const client = createClient({
    apiKey: 'mlv_live_test00000000000000000000',
    baseUrl: 'https://api.test',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const calledInit = () => (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
  return { client, calledInit };
}

describe('client autocomplete — signal huỷ request', () => {
  it('KHÔNG truyền signal xuống RequestInit — huỷ fetch là mất receipt', async () => {
    // Hợp đồng đảo lại ngày 17/09/2026. Bản đầu đưa thẳng signal xuống fetch, nhưng lệnh huỷ
    // không bao giờ đuổi kịp máy chủ: nó đã phục vụ xong và đã phát receipt. Huỷ fetch chỉ vứt
    // mất header receipt, và receipt mồ côi khoá cả tenant bằng 429 `ack_required` sau ba lần.
    // Caller vẫn được huỷ — nhưng huỷ ở lớp promise, không phải ở lớp mạng; xem
    // `client.receipt-ack.test.ts`.
    const controller = new AbortController();
    const { client, calledInit } = stubClient({ items: [] });
    await client.autocomplete('highlands', { signal: controller.signal });
    expect(calledInit().signal).toBeUndefined();
  });

  it('signal đã huỷ sẵn → không gửi request nào', async () => {
    // Nhánh này tồn tại vì giờ signal không còn xuống tới fetch nữa: không chặn ở đây thì một
    // signal huỷ sẵn vẫn tiêu một lượt places của khách để rồi vứt kết quả đi.
    const fetch = vi.fn(async () => jsonResponse({ items: [] }));
    const client = createClient({
      apiKey: 'mlv_live_test00000000000000000000',
      baseUrl: 'https://api.test',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(client.autocomplete('highlands', { signal: controller.signal })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('không truyền signal thì RequestInit không có signal', async () => {
    const { client, calledInit } = stubClient({ items: [] });
    await client.autocomplete('highlands');
    expect(calledInit().signal).toBeUndefined();
  });
});
