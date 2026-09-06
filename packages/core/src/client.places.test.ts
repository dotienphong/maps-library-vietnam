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
  const calledUrl = () => new URL((fetch.mock.calls[0] as unknown[])[0] as string | URL);
  const calledInit = () => (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
  return { client, fetch, calledUrl, calledInit };
}

describe('client Places methods', () => {
  it('autocomplete truyền q, near, limit, types và X-Api-Key', async () => {
    const { client, calledInit, calledUrl } = stubClient({ items: [] });
    await client.autocomplete('highlands', {
      near: [10.77, 106.7],
      limit: 5,
      types: ['poi', 'street'],
    });
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/autocomplete');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'highlands',
      near: '10.77,106.7',
      limit: '5',
      types: 'poi,street',
    });
    expect((calledInit().headers as Record<string, string>)['X-Api-Key']).toMatch(/^mlv_live_/);
  });

  it('autocomplete giữ nguyên item area kèm bbox và precision district', async () => {
    const area = {
      type: 'area',
      id: null,
      name: 'Quận 10',
      secondary: 'Diên Hồng, Hòa Hưng, Vườn Lài, …',
      lat: 10.77,
      lng: 106.67,
      precision: 'district',
      score: 0.6,
      bbox: [106.65, 10.75, 106.68, 10.79],
    };
    const { client } = stubClient({ items: [area] });
    const { items } = await client.autocomplete('quan 10', { types: ['area'] });
    expect(items).toEqual([area]);
    expect(items[0]?.bbox).toEqual([106.65, 10.75, 106.68, 10.79]);
    expect(items[0]?.precision).toBe('district');
  });

  it('search truyền đủ filter và phân trang', async () => {
    const { client, calledUrl } = stubClient({ items: [], total: 0 });
    await client.search('pho', {
      category: 'cafe',
      near: [10.7, 106.7],
      radius: 1000,
      bbox: [106.6, 10.6, 106.8, 10.8],
      limit: 12,
      offset: 24,
    });
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'pho',
      category: 'cafe',
      near: '10.7,106.7',
      radius: '1000',
      bbox: '106.6,10.6,106.8,10.8',
      limit: '12',
      offset: '24',
    });
  });

  it('nearby truyền tâm, bán kính, category và limit', async () => {
    const { client, calledUrl } = stubClient({ items: [] });
    await client.nearby({ lat: 10.7, lng: 106.7, radius: 300, category: 'cafe', limit: 8 });
    expect(calledUrl().pathname).toBe('/v1/nearby');
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({
      lat: '10.7',
      lng: '106.7',
      radius: '300',
      category: 'cafe',
      limit: '8',
    });
  });

  it('geocode và reverse truyền đúng path/tham số', async () => {
    const { client, calledUrl, fetch } = stubClient({ items: [] });
    await client.geocode('88/9 Nguyễn Lâm', { near: [10.76, 106.66], limit: 3 });
    expect(calledUrl().pathname).toBe('/v1/geocode');
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({
      q: '88/9 Nguyễn Lâm',
      near: '10.76,106.66',
      limit: '3',
    });

    fetch.mockClear();
    await client.reverse(10.7647, 106.6631);
    expect(calledUrl().pathname).toBe('/v1/reverse');
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({
      lat: '10.7647',
      lng: '106.6631',
    });
  });

  it('getPlace encode id trước khi ghép path', async () => {
    const { client, calledUrl } = stubClient({});
    await client.getPlace('id/with space');
    expect(calledUrl().pathname).toBe('/v1/places/id%2Fwith%20space');
  });
});
