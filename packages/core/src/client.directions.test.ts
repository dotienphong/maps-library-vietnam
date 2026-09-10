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

const EMPTY = { routes: [], waypoints: [], attribution: '© OpenStreetMap contributors' };

describe('client.directions', () => {
  it('ghép from/to dạng lat,lng, bỏ tham số undefined', async () => {
    const { client, calledUrl } = stubClient(EMPTY);
    await client.directions({ from: [10.7798, 106.699], to: [10.7725, 106.698] });
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/directions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '10.7798,106.699',
      to: '10.7725,106.698',
    });
  });

  it('via nối bằng ";", mode/lang truyền thẳng, alternatives true → 1', async () => {
    const { client, calledUrl } = stubClient(EMPTY);
    await client.directions({
      from: [10.7798, 106.699],
      to: [10.7725, 106.698],
      via: [
        [10.776, 106.698],
        [10.775, 106.699],
      ],
      mode: 'car',
      lang: 'en',
      alternatives: true,
    });
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({
      from: '10.7798,106.699',
      to: '10.7725,106.698',
      via: '10.776,106.698;10.775,106.699',
      mode: 'car',
      lang: 'en',
      alternatives: '1',
    });
  });

  it('alternatives false → 0; via rỗng không gửi', async () => {
    const { client, calledUrl } = stubClient(EMPTY);
    await client.directions({ from: [10, 106], to: [11, 107], via: [], alternatives: false });
    const params = Object.fromEntries(calledUrl().searchParams);
    expect(params.alternatives).toBe('0');
    expect(params.via).toBeUndefined();
  });

  it('trả nguyên response', async () => {
    const body = { ...EMPTY, engine: { name: 'valhalla', graph: '2026-09-15' } };
    const { client } = stubClient(body);
    expect(await client.directions({ from: [10, 106], to: [11, 107] })).toEqual(body);
  });
});
