import { describe, expect, it } from 'vitest';
import { measureAutocomplete } from './perf-autocomplete.mjs';

describe('measureAutocomplete', () => {
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
