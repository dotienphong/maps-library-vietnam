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
  it('truyền signal xuống RequestInit khi có', async () => {
    const controller = new AbortController();
    const { client, calledInit } = stubClient({ items: [] });
    await client.autocomplete('highlands', { signal: controller.signal });
    expect(calledInit().signal).toBe(controller.signal);
  });

  it('không truyền signal thì RequestInit không có signal', async () => {
    const { client, calledInit } = stubClient({ items: [] });
    await client.autocomplete('highlands');
    expect(calledInit().signal).toBeUndefined();
  });
});
