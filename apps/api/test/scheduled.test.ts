import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

/**
 * Binding Hyperdrive của tầng test trỏ vào một cổng đóng, nên bài này chạy đúng cảnh xấu nhất:
 * cron chạy lúc DB không trả lời. Yêu cầu là Worker vẫn sống và không việc nào ném ra ngoài.
 */
describe('scheduled()', () => {
  it('cron 5 phút: hai việc nền (đơn hàng + sức khoẻ), DB không nối được vẫn KHÔNG ném', async () => {
    const viecNen: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => viecNen.push(p),
      passThroughOnException: () => {},
    };
    expect(() =>
      worker.scheduled(
        { cron: '*/5 * * * *', scheduledTime: Date.now(), noRetry: () => {} } as never,
        { ...env, PAYOS_CLIENT_ID: 'x', PAYOS_API_KEY: 'x', PAYOS_CHECKSUM_KEY: 'x' } as never,
        ctx as never,
      ),
    ).not.toThrow();
    // Việc sức khoẻ được xếp nhưng kết thúc `thieu-cau-hinh`: tầng test không có ALERT_EMAIL, nên
    // không có lượt đo nào chạy (và không phải chờ 15 s đo lại).
    expect(viecNen).toHaveLength(2);
    await expect(Promise.all(viecNen)).resolves.toBeDefined();
  });

  it('cron hằng ngày: chỉ việc đơn hàng, không đo sức khoẻ', () => {
    const viecNen: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => void viecNen.push(p.catch(() => {})),
      passThroughOnException: () => {},
    };
    worker.scheduled(
      { cron: '0 2 * * *', scheduledTime: Date.now(), noRetry: () => {} } as never,
      { ...env, PAYOS_CLIENT_ID: 'x', PAYOS_API_KEY: 'x', PAYOS_CHECKSUM_KEY: 'x' } as never,
      ctx as never,
    );
    expect(viecNen).toHaveLength(1);
  });

  it('vẫn phục vụ HTTP như trước khi có scheduled', async () => {
    const res = await worker.fetch(
      new Request('https://api/healthz'),
      env as never,
      {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as never,
    );
    expect(res.status).toBe(200);
  });
});
