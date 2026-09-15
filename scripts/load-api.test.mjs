import { describe, expect, it } from 'vitest';
import { runComparison, runLevel, runMixed, runRamp } from './load-api.mjs';

const ok =
  (delayMs = 0) =>
  async () => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return new Response('{}', { status: 200 });
  };

describe('load API', () => {
  it('chạy đúng số request đồng thời và tính thống kê', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return new Response('{}', { status: 200 });
    };

    const result = await runLevel('https://api.test', 'key', 10, { fetchImpl });
    expect(result.requests).toBe(10);
    expect(result.ok).toBe(10);
    expect(result.errors).toBe(0);
    expect(result.rateLimited).toBe(0);
    expect(maxActive).toBe(10);
    expect(result.rps).toBeGreaterThan(0);
  });

  it('dừng ramp khi có 5xx hoặc timeout', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls === 3 ? new Response('{}', { status: 503 }) : ok()();
    };

    const result = await runRamp('https://api.test', 'key', [2, 4, 8], {
      fetchImpl,
      cooldownMs: 0,
    });
    expect(result.levels).toHaveLength(2);
    expect(result.stopped).toBe(true);
    expect(result.levels[1]?.errors).toBe(1);
    expect(result.levels[1]?.serverErrors).toBe(1);
    expect(result.levels[1]?.timeouts).toBe(0);
    expect(result.stopReason).toBe('errors');
  });

  it('dừng khi p95 vượt ngưỡng dù server vẫn trả 200 hết', async () => {
    // Đúng kịch bản đã gặp: 0 lỗi, 0 rate limit, nhưng chậm tới mức không phục vụ được.
    const result = await runRamp('https://api.test', 'key', [2, 4], {
      fetchImpl: ok(40),
      cooldownMs: 0,
      maxP95Ms: 20,
    });
    expect(result.stopped).toBe(true);
    expect(result.stopReason).toBe('latency');
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.errors).toBe(0);
    expect(result.levels[0]?.ok).toBe(2);
  });

  it('dừng khi dính 429 vì số đo đã mất nghĩa', async () => {
    const result = await runRamp('https://api.test', 'key', [2, 4], {
      fetchImpl: async () => new Response('{}', { status: 429 }),
      cooldownMs: 0,
    });
    expect(result.stopped).toBe(true);
    expect(result.stopReason).toBe('rate_limited');
    expect(result.levels).toHaveLength(1);
  });

  it('nghỉ giữa các mức để burst limit không làm bẩn số đo', async () => {
    /** @type {number[]} */
    const waits = [];
    await runRamp('https://api.test', 'key', [2, 4, 8], {
      fetchImpl: ok(),
      cooldownMs: 65_000,
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
    });
    // Nghỉ giữa các mức, không nghỉ trước mức đầu.
    expect(waits).toEqual([65_000, 65_000]);
  });

  it('đo directions bằng endpoint chỉ đường, không phải autocomplete', async () => {
    /** @type {string[]} */
    const urls = [];
    await runLevel('https://api.test', 'key', 2, {
      group: 'directions',
      fetchImpl: async (url) => {
        urls.push(String(url));
        return new Response('{}', { status: 200 });
      },
    });
    expect(urls.every((url) => url.includes('/v1/directions?from='))).toBe(true);
    expect(new Set(urls).size).toBe(2);
  });

  it('ghi riêng 429 thay vì coi là lỗi hạ tầng', async () => {
    const result = await runLevel('https://api.test', 'key', 3, {
      fetchImpl: async () => new Response('{}', { status: 429 }),
    });
    expect(result.rateLimited).toBe(3);
    expect(result.errors).toBe(0);
  });

  it('dừng ramp nếu khoá hoặc request sai thay vì báo nhầm là chịu tải được', async () => {
    const result = await runRamp('https://api.test', 'key', [2, 4], {
      fetchImpl: async () => new Response('{}', { status: 401 }),
      cooldownMs: 0,
    });
    expect(result.stopped).toBe(true);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.clientErrors).toBe(2);
  });

  it('chế độ warm cho mọi VU dùng cùng một URL để đo đường cache', async () => {
    /** @type {string[]} */
    const urls = [];
    const record = async (/** @type {any} */ url) => {
      urls.push(String(url));
      return new Response('{}', { status: 200 });
    };
    await runLevel('https://api.test', 'key', 4, { cache: 'warm', fetchImpl: record });
    expect(new Set(urls).size).toBe(1);

    urls.length = 0;
    await runLevel('https://api.test', 'key', 4, { cache: 'cold', fetchImpl: record });
    expect(new Set(urls).size).toBe(4);
  });
});

describe('A/B chi phí quota', () => {
  it('chạy hai nhánh trên ĐÚNG cùng bộ URL và báo chênh lệch p95', async () => {
    /** @type {Record<string, string[]>} */
    const byKey = { legacy: [], commercial: [] };
    const fetchImpl = async (/** @type {any} */ url, /** @type {any} */ init) => {
      const key = init.headers['X-Api-Key'];
      byKey[key]?.push(String(url));
      // Nhánh thương mại chậm hơn một chút — đúng hình dạng chi phí sổ quota.
      await new Promise((resolve) => setTimeout(resolve, key === 'commercial' ? 25 : 5));
      return new Response('{}', { status: 200 });
    };
    const result = await runComparison(
      'https://api.test',
      [
        { label: 'legacy', key: 'legacy' },
        { label: 'commercial', key: 'commercial' },
      ],
      3,
      { fetchImpl, cooldownMs: 0 },
    );
    expect(byKey.legacy).toEqual(byKey.commercial);
    expect(result.arms.map((arm) => arm.label)).toEqual(['legacy', 'commercial']);
    expect(result.overhead[0]?.against).toBe('legacy');
    expect(result.overhead[0]?.p95).toBeGreaterThan(0);
  });

  it('nghỉ hết cửa sổ burst giữa hai nhánh, không nghỉ trước nhánh đầu', async () => {
    /** @type {number[]} */
    const waits = [];
    await runComparison(
      'https://api.test',
      [
        { label: 'a', key: 'a' },
        { label: 'b', key: 'b' },
      ],
      2,
      {
        fetchImpl: ok(),
        cooldownMs: 65_000,
        sleepImpl: async (ms) => {
          waits.push(ms);
        },
      },
    );
    expect(waits).toEqual([65_000]);
  });

  it('mồi cache trước mỗi nhánh khi đo warm, nếu không nhánh đầu gánh hết chi phí nạp', async () => {
    let calls = 0;
    await runComparison(
      'https://api.test',
      [
        { label: 'a', key: 'a' },
        { label: 'b', key: 'b' },
      ],
      3,
      {
        cache: 'warm',
        cooldownMs: 0,
        fetchImpl: async () => {
          calls += 1;
          return new Response('{}', { status: 200 });
        },
      },
    );
    // 2 nhánh × (1 lượt mồi + 3 lượt đo)
    expect(calls).toBe(8);
  });
});

describe('nhiều tenant cùng lúc', () => {
  it('cho mỗi tenant một dải URL riêng và báo số của từng tenant', async () => {
    /** @type {string[]} */
    const urls = [];
    const result = await runMixed(
      'https://api.test',
      [
        { label: 't1', key: 'k1' },
        { label: 't2', key: 'k2' },
      ],
      2,
      {
        fetchImpl: async (/** @type {any} */ url) => {
          urls.push(String(url));
          return new Response('{}', { status: 200 });
        },
      },
    );
    expect(result.totalRequests).toBe(4);
    expect(new Set(urls).size).toBe(4);
    expect(result.arms.map((arm) => arm.label)).toEqual(['t1', 't2']);
    expect(Number.isFinite(result.worstP95)).toBe(true);
  });
});
