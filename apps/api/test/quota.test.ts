import { env, SELF } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { ApiError, errorResponse } from '../src/errors';
import {
  burstLimiterFor,
  dailyLimit,
  enforceBurstLimit,
  FREE_DIRECTIONS_PER_DAY,
  FREE_PLACES_PER_DAY,
  keyCapLimiterFor,
  quotaMiddleware,
  rateLimitActor,
  vnDay,
} from '../src/quota';
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

  it('HEAD trả 405 và KHÔNG tính lượt cho tenant legacy', async () => {
    await seedFree(10);
    const key = await quotaKey(FREE_KEY);
    await env.META.put(key, '3');
    const response = await SELF.fetch('https://api/v1/autocomplete?q=highlands', {
      method: 'HEAD',
      headers: { 'X-Api-Key': FREE_KEY },
    });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    // Trước đây HEAD chạy trọn handler GET rồi tăng bộ đếm — tức bị tính lượt, trái spec mục 6.
    expect(await env.META.get(key)).toBe('3');
  });

  it('HEAD bị chặn trước cả validate tham số: sai method thì không bàn tới tham số', async () => {
    await seedFree(10);
    const response = await SELF.fetch('https://api/v1/autocomplete?q=x', {
      method: 'HEAD',
      headers: { 'X-Api-Key': FREE_KEY },
    });
    expect(response.status).toBe(405);
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

  it('burst limit cho qua khi binding success và ném 429/60 giây khi binding deny', async () => {
    await expect(
      enforceBurstLimit({ limit: async () => ({ success: true }) }, 'hash-allow'),
    ).resolves.toBeUndefined();
    await expect(
      enforceBurstLimit({ limit: async () => ({ success: false }) }, 'hash-deny'),
    ).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit_exceeded',
      retryAfter: 60,
    });
  });

  it('burst actor tách theo key + IP nhưng không chứa IP thô', async () => {
    const first = await rateLimitActor('key-hash', '203.0.113.8');
    const same = await rateLimitActor('key-hash', '203.0.113.8');
    const otherIp = await rateLimitActor('key-hash', '203.0.113.9');
    expect(first).toBe(same);
    expect(first).not.toBe(otherIp);
    expect(first).not.toContain('203.0.113.8');
  });

  const base = {
    keyHash: 'h',
    keyPrefix: 'mlv_live_x',
    tenantId: 't',
    plan: 'free' as const,
    kind: 'server' as const,
    scopes: ['places:read'],
    allowedOrigins: [],
    quotaPlacesPerDay: null,
    quotaDirectionsPerDay: null,
  };

  it('dailyLimit: nhóm directions dùng cột riêng và mặc định 2.000 (spec A mục 5.5)', () => {
    expect(dailyLimit(base, 'places')).toBe(FREE_PLACES_PER_DAY);
    expect(dailyLimit({ ...base, quotaPlacesPerDay: 5 }, 'directions')).toBe(
      FREE_DIRECTIONS_PER_DAY,
    );
    expect(
      dailyLimit({ ...base, quotaPlacesPerDay: 5, quotaDirectionsPerDay: 7 }, 'directions'),
    ).toBe(7);
    expect(FREE_DIRECTIONS_PER_DAY).toBe(2_000);
  });

  it('burst theo khoá+IP: directions có binding riêng; trần theo khoá chỉ áp cho khoá web/mobile ở directions', () => {
    const places = { limit: async () => ({ success: true }) };
    const directions = { limit: async () => ({ success: true }) };
    const cap = { limit: async () => ({ success: true }) };
    const env = {
      PLACES_RATE_LIMITER: places,
      DIRECTIONS_RATE_LIMITER: directions,
      DIRECTIONS_KEY_RATE_LIMITER: cap,
    };
    expect(burstLimiterFor(env, 'places')).toBe(places);
    expect(burstLimiterFor(env, 'directions')).toBe(directions);
    expect(burstLimiterFor({ PLACES_RATE_LIMITER: places }, 'directions')).toBeUndefined();
    expect(keyCapLimiterFor(env, { ...base, kind: 'web' }, 'directions')).toBe(cap);
    expect(keyCapLimiterFor(env, { ...base, kind: 'mobile', plan: 'internal' }, 'directions')).toBe(
      cap,
    );
    expect(
      keyCapLimiterFor(env, { ...base, kind: 'server', plan: 'internal' }, 'directions'),
    ).toBeUndefined();
    expect(keyCapLimiterFor(env, { ...base, kind: 'web' }, 'places')).toBeUndefined();
  });
});

describe('quotaMiddleware preflight bất đồng bộ (fleet-plan)', () => {
  it('await preflight: 400 từ preflight async trả về TRƯỚC handler, handler không chạy', async () => {
    const app = new Hono<AppEnv>();
    let handlerChay = false;
    app.post(
      '/x',
      async (c, next) => {
        c.set('auth', {
          keyHash: 'h',
          keyPrefix: 'mlv_live_x',
          tenantId: '00000000-0000-4000-8000-0000000000aa',
          plan: 'internal',
          kind: 'server',
          scopes: ['places:read'],
          allowedOrigins: [],
          quotaPlacesPerDay: null,
          quotaDirectionsPerDay: null,
        });
        await next();
      },
      quotaMiddleware('directions', async (c) => {
        const body = (await c.req.json()) as { ok?: boolean };
        if (!body.ok) throw new ApiError(400, 'invalid_request', 'body sai');
        c.set('params', body);
      }),
      (c) => {
        handlerChay = true;
        return c.json(c.get('params') as object);
      },
    );
    app.onError((err, c) => errorResponse(c, err));
    const sai = await app.request('/x', { method: 'POST', body: '{}' }, env);
    expect(sai.status).toBe(400);
    expect(handlerChay).toBe(false);
    const dung = await app.request('/x', { method: 'POST', body: '{"ok":true}' }, env);
    expect(dung.status).toBe(200);
    expect(await dung.json()).toEqual({ ok: true });
  });
});
