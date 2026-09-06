import { describe, expect, it } from 'vitest';
import { measureAutocomplete, parseQueryFixture } from './perf-autocomplete.mjs';

describe('measureAutocomplete', () => {
  // Plan 8.5: phải so được default mới với bộ loại cũ để tách chi phí của `area`.
  it('không truyền types thì URL không có tham số types; truyền thì có', async () => {
    /** @type {string[]} */
    const urls = [];
    const fetchImpl = async (/** @type {string | URL | Request} */ url) => {
      urls.push(String(url));
      return new Response('{}');
    };
    const clock = () => 0;
    await measureAutocomplete('https://api.test', 'mlv_live_test', {
      count: 1,
      fetchImpl,
      now: clock,
    });
    expect(urls[0]).not.toContain('types=');
    await measureAutocomplete('https://api.test', 'mlv_live_test', {
      count: 1,
      fetchImpl,
      now: clock,
      types: 'poi,street,address',
    });
    expect(urls[1]).toContain('types=poi%2Cstreet%2Caddress');
  });

  it('đo percentile từ response thành công và gửi đúng auth/near', async () => {
    /** @type {{ url: string | URL | Request, init: RequestInit | undefined }[]} */
    const calls = [];
    const ticks = [0, 10, 20, 40, 50, 80, 90, 130];
    const result = await measureAutocomplete('https://api.test/', 'mlv_live_test', {
      count: 4,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response('{}');
      },
      now: () => {
        const tick = ticks.shift();
        if (tick === undefined) throw new Error('test clock hết tick');
        return tick;
      },
    });

    expect(result).toEqual({
      n: 4,
      p50: 20,
      p95: 40,
      p99: 40,
      slowest: [
        { index: 4, query: 'truong tieu hoc', ms: 40, cache: 'miss', colo: '' },
        { index: 3, query: 'cafe', ms: 30, cache: 'miss', colo: '' },
        { index: 2, query: 'pho co', ms: 20, cache: 'miss', colo: '' },
        { index: 1, query: 'highlands', ms: 10, cache: 'miss', colo: '' },
      ],
    });
    expect(calls[0]).toEqual({
      url: 'https://api.test/v1/autocomplete?q=highlands&near=10.776,106.700',
      init: { headers: { 'X-Api-Key': 'mlv_live_test' } },
    });
  });

  it('không báo percentile hợp lệ khi API trả HTTP lỗi', async () => {
    await expect(
      measureAutocomplete('https://api.test', 'mlv_live_test', {
        count: 1,
        fetchImpl: async () => new Response('unavailable', { status: 503 }),
        now: () => 0,
      }),
    ).rejects.toThrow('HTTP 503');
  });
});

describe('measureAutocomplete với bộ truy vấn có đích', () => {
  it('tính hit@3: đích khớp (không dấu, lowercase) trong 3 item đầu', async () => {
    const queries = [
      { q: 'higland', expect: 'highlands' },
      { q: 'cho rya', expect: 'cho ray' },
    ];
    const result = await measureAutocomplete('https://api.test', 'k', {
      count: 2,
      queries,
      fetchImpl: async (url) =>
        new Response(
          JSON.stringify({
            items: String(url).includes('higland')
              ? [{ name: 'Phở Hoà' }, { name: 'Highlands Coffee Nguyễn Huệ' }, { name: 'X' }]
              : [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'Bệnh viện Chợ Rẫy' }],
          }),
        ),
      now: (() => {
        let t = 0;
        return () => {
          t += 5;
          return t;
        };
      })(),
    });
    expect(result.hit3).toEqual({ hit: 1, total: 2, misses: ['cho rya'] });
  });

  it('đọc fixture q|đích, bỏ dòng # và dòng rỗng', () => {
    expect(
      parseQueryFixture('# chú thích\nhigland|highlands\n\ncoffee highlands|highlands\n'),
    ).toEqual([
      { q: 'higland', expect: 'highlands' },
      { q: 'coffee highlands', expect: 'highlands' },
    ]);
  });
});
