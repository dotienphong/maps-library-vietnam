import { describe, expect, it } from 'vitest';
import { runLevel, runRamp } from './load-api.mjs';

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
});
