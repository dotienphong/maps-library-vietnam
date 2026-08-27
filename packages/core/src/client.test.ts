import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';
import type { MapsLibVNError } from './errors';

const okFetch = (body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );

describe('createClient', () => {
  it('gọi /v1/attribution với header X-Api-Key và baseUrl không có dấu / cuối', async () => {
    const fetch = okFetch({ text: 't', html: 'h', links: [] });
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.example.test/',
      fetch,
    });
    const result = await client.attribution();
    expect(result.text).toBe('t');
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.example.test/v1/attribution');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('mlv_live_abc');
  });

  it('styleUrl mang theme và key', () => {
    const client = createClient({
      apiKey: 'k 1',
      baseUrl: 'https://api.example.test',
      fetch: okFetch({}),
    });
    expect(client.styleUrl('dark')).toBe('https://api.example.test/v1/styles/dark.json?key=k%201');
  });

  it('ném MapsLibVNError với code/request_id từ body lỗi', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'missing_key', message: 'Thiếu key', request_id: 'r1' },
          }),
          { status: 401 },
        ),
    );
    const client = createClient({
      apiKey: '',
      baseUrl: 'https://api.example.test',
      fetch,
    });
    await expect(client.attribution()).rejects.toMatchObject({
      status: 401,
      code: 'missing_key',
      requestId: 'r1',
    } satisfies Partial<MapsLibVNError>);
  });
});
