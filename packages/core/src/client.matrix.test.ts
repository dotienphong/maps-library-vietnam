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
  mode: 'motorbike',
  sources: [],
  targets: [],
  durations_s: [],
  distances_m: [],
  attribution: '© OpenStreetMap contributors',
};

describe('client.matrix', () => {
  it('ghép sources/targets dạng lat,lng nối ";", bỏ mode khi không truyền', async () => {
    const { client, calledUrl } = stubClient(EMPTY);
    await client.matrix({
      sources: [
        [10.7798, 106.699],
        [10.7725, 106.698],
      ],
      targets: [[10.8153, 106.6633]],
    });
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/matrix');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sources: '10.7798,106.699;10.7725,106.698',
      targets: '10.8153,106.6633',
    });
  });

  it('mode truyền thẳng; trả nguyên response', async () => {
    const body = { ...EMPTY, mode: 'car', engine: { name: 'valhalla', graph: '2026-09-15' } };
    const { client, calledUrl } = stubClient(body);
    const result = await client.matrix({ sources: [[10, 106]], targets: [[11, 107]], mode: 'car' });
    expect(Object.fromEntries(calledUrl().searchParams).mode).toBe('car');
    expect(result).toEqual(body);
  });
});
