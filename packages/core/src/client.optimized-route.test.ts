import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function stubClient(body: unknown) {
  const fetch = vi.fn(async () => jsonResponse(body));
  const client = createClient({
    apiKey: 'mlv_live_test00000000000000000000',
    baseUrl: 'https://api.test/',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const calledUrl = () => new URL((fetch.mock.calls[0] as unknown[])[0] as string | URL);
  return { client, calledUrl };
}

const EMPTY = {
  routes: [],
  waypoints: [],
  attribution: '© OpenStreetMap contributors',
  order: [] as number[],
};

describe('client.optimizedRoute', () => {
  it('from + stops nối ";"; không có to thì KHÔNG gửi tham số to (máy chủ hiểu là quay về from)', async () => {
    const { client, calledUrl } = stubClient(EMPTY);
    await client.optimizedRoute({
      from: [10.7798, 106.699],
      stops: [
        [10.7716, 106.7043],
        [10.7769, 106.7032],
      ],
    });
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/optimized-route');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '10.7798,106.699',
      stops: '10.7716,106.7043;10.7769,106.7032',
    });
  });

  it('to/mode/lang truyền thẳng; trả nguyên response kèm order', async () => {
    const body = { ...EMPTY, order: [1, 0] };
    const { client, calledUrl } = stubClient(body);
    const result = await client.optimizedRoute({
      from: [10.7798, 106.699],
      stops: [
        [10.7716, 106.7043],
        [10.7769, 106.7032],
      ],
      to: [10.7725, 106.698],
      mode: 'car',
      lang: 'en',
    });
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({
      from: '10.7798,106.699',
      stops: '10.7716,106.7043;10.7769,106.7032',
      to: '10.7725,106.698',
      mode: 'car',
      lang: 'en',
    });
    expect(result.order).toEqual([1, 0]);
  });
});
