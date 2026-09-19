import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

/**
 * Binding Hyperdrive của tầng test trỏ vào một cổng đóng, nên bài này chạy đúng cảnh xấu nhất:
 * cron chạy lúc DB không trả lời. Yêu cầu là Worker vẫn sống và không việc nào ném ra ngoài.
 */
describe('scheduled()', () => {
  it('DB không nối được → mọi việc báo lỗi, KHÔNG ném, Worker vẫn sống', async () => {
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
    expect(viecNen).toHaveLength(1);
    await expect(Promise.all(viecNen)).resolves.toBeDefined();
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
