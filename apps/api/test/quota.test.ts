import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';
import { seedKey, sha256Hex } from './helpers/seed-key';

const FREE_KEY = 'mlv_live_freetest0000000000000000';
// Bộ đếm quota KV khoá theo sha256(khoá) — không ghi khoá plaintext vào tên key KV.
const quotaKey = async (key: string) => `quota:${await sha256Hex(key)}:${vnDay()}:places`;
const seedFree = (quota: number | null) =>
  seedKey(FREE_KEY, {
    tenantId: '00000000-0000-4000-8000-0000000000bb',
    plan: 'free',
    quotaPlacesPerDay: quota,
  });
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
    await env.META.put(await quotaKey(FREE_KEY), '19');
    expect((await call()).status).toBe(503);
  });

  it('đếm đạt 2× quota → 429 quota_exceeded + Retry-After', async () => {
    await seedFree(10);
    await env.META.put(await quotaKey(FREE_KEY), '20');
    const res = await call();
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('quota_exceeded');
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('plan internal không bị đếm/chặn dù counter cao', async () => {
    const key = 'mlv_live_test00000000000000000000';
    await seedKey(key, { tenantId: 't', quotaPlacesPerDay: 1 });
    await env.META.put(await quotaKey(key), '999999');
    const res = await SELF.fetch('https://api/v1/autocomplete?q=highlands', {
      headers: { 'X-Api-Key': key },
    });
    expect(res.status).toBe(503);
  });
});
