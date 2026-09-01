import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';

const FREE_KEY = 'mlv_live_freetest0000000000000000';
const seedFree = (quota: number | null) =>
  env.META.put(
    `apikey:${FREE_KEY}`,
    JSON.stringify({
      key: FREE_KEY,
      tenantId: '00000000-0000-4000-8000-0000000000bb',
      plan: 'free',
      kind: 'server',
      scopes: ['places:read'],
      allowedOrigins: [],
      quotaPlacesPerDay: quota,
    }),
  );
const call = () =>
  SELF.fetch('https://api/v1/autocomplete?q=highlands', {
    headers: { 'X-Api-Key': FREE_KEY },
  });

describe('quota (QUOTA_ENABLED=1 trong vitest.config)', () => {
  it('vnDay trả YYYY-MM-DD theo giờ VN (+7)', () => {
    expect(vnDay(new Date('2026-08-31T18:00:00Z'))).toBe('2026-09-01');
    expect(vnDay(new Date('2026-08-31T16:59:00Z'))).toBe('2026-08-31');
  });

  it('đếm dưới 2× quota → cho qua (chết ở DB đóng = 503, không phải 429)', async () => {
    await seedFree(10);
    await env.META.put(`quota:${FREE_KEY}:${vnDay()}:places`, '19');
    expect((await call()).status).toBe(503);
  });

  it('đếm đạt 2× quota → 429 quota_exceeded + Retry-After', async () => {
    await seedFree(10);
    await env.META.put(`quota:${FREE_KEY}:${vnDay()}:places`, '20');
    const res = await call();
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('quota_exceeded');
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('plan internal không bị đếm/chặn dù counter cao', async () => {
    const key = 'mlv_live_test00000000000000000000';
    await env.META.put(
      `apikey:${key}`,
      JSON.stringify({
        key,
        tenantId: 't',
        plan: 'internal',
        kind: 'server',
        scopes: ['places:read'],
        allowedOrigins: [],
        quotaPlacesPerDay: 1,
      }),
    );
    await env.META.put(`quota:${key}:${vnDay()}:places`, '999999');
    const res = await SELF.fetch('https://api/v1/autocomplete?q=highlands', {
      headers: { 'X-Api-Key': key },
    });
    expect(res.status).toBe(503);
  });
});
