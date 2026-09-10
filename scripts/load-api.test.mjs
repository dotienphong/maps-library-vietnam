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

    const result = await runRamp('https://api.test', 'key', [2, 4, 8], { fetchImpl });
    expect(result.levels).toHaveLength(2);
    expect(result.stopped).toBe(true);
    expect(result.levels[1]?.errors).toBe(1);
    expect(result.levels[1]?.serverErrors).toBe(1);
    expect(result.levels[1]?.timeouts).toBe(0);
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
    });
    expect(result.stopped).toBe(true);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.clientErrors).toBe(2);
  });
});
