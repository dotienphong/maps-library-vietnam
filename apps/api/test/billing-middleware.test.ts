import { env, runInDurableObject } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AuthInfo } from '../src/auth';
import type { EntitlementCommand, QuotaGroup } from '../src/billing/types';
import type { AppEnv } from '../src/env';
import { ApiError, errorResponse } from '../src/errors';
import { quotaMiddleware } from '../src/quota';
import { quotaReceipts } from '../src/routes/quota-receipts';
import { seedKey } from './helpers/seed-key';

const authFor = (tenantId: string): AuthInfo => ({
  keyHash: 'a'.repeat(64),
  keyPrefix: 'mlv_live_aaaaaaaa',
  tenantId,
  plan: 'paid',
  kind: 'server',
  scopes: ['places:read'],
  allowedOrigins: [],
  quotaPlacesPerDay: null,
  quotaDirectionsPerDay: null,
  quotaMode: 'commercial',
});
const grant = (tenantId: string): EntitlementCommand => ({
  kind: 'grantPeriod',
  operationId: crypto.randomUUID(),
  tenantId,
  actor: 'test',
  reason: 'test period',
  expectedRevision: 0,
  periodId: crypto.randomUUID(),
  tier: 'starter',
  startsAt: new Date(Date.now() - 1000).toISOString(),
  endsAt: new Date(Date.now() + 86_400_000).toISOString(),
  paymentReference: crypto.randomUUID(),
  lineItemId: 'period',
});

async function fixture(status: number, group: QuotaGroup = 'places') {
  const tenantId = crypto.randomUUID();
  const object = env.QUOTA.get(env.QUOTA.idFromName(tenantId));
  await object.applyCommand(grant(tenantId));
  const app = new Hono<AppEnv>();
  let calls = 0;
  app.onError((error, c) => errorResponse(c, error));
  app.use('*', async (c, next) => {
    c.set('auth', authFor(tenantId));
    await next();
  });
  app.get('/fixture', quotaMiddleware(group), (c) => {
    calls += 1;
    return c.json({ items: [] }, status as 200);
  });
  return { app, object, tenantId, calls: () => calls };
}

describe('commercial quota middleware', () => {
  it('validates cheap request parameters before writing a reservation', async () => {
    const key = 'mlv_live_VVVVVVVVVVVVVVVVVVVVVVVV';
    const tenantId = crypto.randomUUID();
    await seedKey(key, { tenantId, plan: 'paid', quotaMode: 'commercial' });
    const object = env.QUOTA.get(env.QUOTA.idFromName(tenantId));
    await object.applyCommand(grant(tenantId));
    const response = await (await import('../src/index')).default.request(
      'https://api.test/v1/autocomplete?q=x',
      { headers: { 'X-Api-Key': key } },
      env,
    );
    expect(response.status).toBe(400);
    await runInDurableObject(object, (_instance, state) => {
      expect(state.storage.sql.exec('SELECT count(*) AS count FROM reservation').one()).toEqual({
        count: 0,
      });
    });
  });

  it('ACK endpoint binds the receipt to the authenticated tenant', async () => {
    const key = 'mlv_live_AAAAAAAAAAAAAAAAAAAAAAAA';
    const tenantId = crypto.randomUUID();
    await seedKey(key, { tenantId, plan: 'paid', quotaMode: 'commercial' });
    const object = env.QUOTA.get(env.QUOTA.idFromName(tenantId));
    await object.applyCommand(grant(tenantId));
    const token = 'ack-token';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    await object.reserve('receipt-endpoint', 'places');
    await object.prepare('receipt-endpoint', hash);
    const app = new Hono<AppEnv>();
    app.onError((error, c) => errorResponse(c, error));
    app.route('/', quotaReceipts);
    const response = await app.request(
      'https://api.test/v1/quota/receipts/receipt-endpoint/ack',
      {
        method: 'POST',
        headers: { 'X-Api-Key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect((await object.readUsage()).places.used).toBe(1);
  });

  it('prepares a receipt for an empty 2xx and charges only after client ACK', async () => {
    const { app, object } = await fixture(200);
    const response = await app.request('https://api.test/fixture', {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const id = response.headers.get('x-mapslibvn-receipt-id');
    const token = response.headers.get('x-mapslibvn-receipt-token');
    expect(id).toBeTruthy();
    expect(token).toBeTruthy();
    // Hạn dùng do DO cấp, nằm trong cửa sổ lease ACK 120 giây kể từ lúc prepare.
    const expiresAt = Date.parse(String(response.headers.get('x-mapslibvn-receipt-expires-at')));
    expect(Number.isFinite(expiresAt)).toBe(true);
    expect(expiresAt - Date.now()).toBeGreaterThan(60_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(120_000);
    expect((await object.readUsage()).places).toMatchObject({ used: 0, reserved: 1 });
    await object.ack(String(id), String(token));
    expect((await object.readUsage()).places).toMatchObject({ used: 1, reserved: 0 });
  });

  it('releases 4xx/5xx without charging', async () => {
    for (const status of [400, 404, 503]) {
      const { app, object } = await fixture(status);
      const response = await app.request('https://api.test/fixture', {}, env);
      expect(response.status).toBe(status);
      expect(response.headers.get('x-mapslibvn-receipt-id')).toBeNull();
      expect((await object.readUsage()).places).toMatchObject({ used: 0, reserved: 0 });
    }
  });

  it('returns 405 for HEAD before invoking the GET handler', async () => {
    const { app, calls } = await fixture(200);
    const response = await app.request('https://api.test/fixture', { method: 'HEAD' }, env);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(calls()).toBe(0);
  });

  it('keeps commercial accounting when the legacy KV counter is switched off', async () => {
    const { app, object } = await fixture(200);
    const response = await app.request(
      'https://api.test/fixture',
      {},
      { ...env, QUOTA_ENABLED: '0' },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-mapslibvn-receipt-id')).toBeTruthy();
    expect((await object.readUsage()).places).toMatchObject({ used: 0, reserved: 1 });
  });

  it('never lets a handler cache-control leak a receipt into shared caches', async () => {
    const tenantId = crypto.randomUUID();
    const object = env.QUOTA.get(env.QUOTA.idFromName(tenantId));
    await object.applyCommand(grant(tenantId));
    const app = new Hono<AppEnv>();
    app.onError((error, c) => errorResponse(c, error));
    app.use('*', async (c, next) => {
      c.set('auth', authFor(tenantId));
      await next();
    });
    // Đúng như cachedJson đặt cho autocomplete/search/directions.
    app.get('/fixture', quotaMiddleware('places'), (c) =>
      c.json({ items: [] }, 200, { 'cache-control': 'public, max-age=3600' }),
    );
    const response = await app.request('https://api.test/fixture', {}, env);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-mapslibvn-receipt-token')).toBeTruthy();
  });

  it('keeps the handler status when the ledger cannot record the release', async () => {
    const tenantId = crypto.randomUUID();
    const object = env.QUOTA.get(env.QUOTA.idFromName(tenantId));
    await object.applyCommand(grant(tenantId));
    const app = new Hono<AppEnv>();
    app.onError((error, c) => errorResponse(c, error));
    app.use('*', async (c, next) => {
      c.set('auth', authFor(tenantId));
      // Sổ quota chết đúng lúc release: reserve/prepare vẫn đi tới DO thật.
      const broken = {
        ...env,
        QUOTA: {
          idFromName: (name: string) => env.QUOTA.idFromName(name),
          get: (id: DurableObjectId) => {
            const real = env.QUOTA.get(id);
            return {
              reserve: (requestId: string, group: QuotaGroup, keyHash?: string) =>
                real.reserve(requestId, group, keyHash),
              prepare: (requestId: string, tokenHash: string) => real.prepare(requestId, tokenHash),
              release: () => Promise.reject(new Error('durable object unreachable')),
            };
          },
        },
      } as unknown as typeof env;
      Object.assign(c, { env: broken });
      await next();
    });
    app.get('/fixture', quotaMiddleware('places'), () => {
      throw new ApiError(400, 'invalid_request', 'q không hợp lệ');
    });
    const response = await app.request('https://api.test/fixture', {}, env);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'invalid_request',
    );
  });

  it('denies exhausted quota with actionable group details', async () => {
    const { app, object } = await fixture(200, 'directions');
    // Vét đúng hạn mức kỳ. Trước đây ca này giữ một reservation rồi tưởng là hết quota — thật ra
    // nó chạm trần đồng thời, và chỉ vì hai lý do cùng trả `quota_exceeded` nên không ai thấy.
    await runInDurableObject(object, (_instance, state) => {
      state.storage.sql.exec('UPDATE period SET directions_limit=0');
    });
    const response = await app.request('https://api.test/fixture', {}, env);
    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      error: { code: string; details: { group: string; actions: string[] } };
    };
    expect(body.error).toMatchObject({
      code: 'quota_exceeded',
      details: { group: 'directions', actions: ['upgrade', 'buy_more'] },
    });
  });

  it('separates a temporary concurrency cap from running out of quota', async () => {
    const { app, object } = await fixture(200, 'directions');
    // Lấp đủ trần đồng thời directions (32 — mốc đo lại 15/09) bằng các reservation ĐANG CHẠY.
    for (let i = 0; i < 32; i += 1) await object.reserve(`held-${i}`, 'directions');
    const response = await app.request('https://api.test/fixture', {}, env);
    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      error: { code: string; details: { actions: string[]; resetAt: string | null } };
    };
    expect(body.error.code).toBe('concurrency_limit');
    // Tuyệt đối không mời khách mua thêm lượt khi họ vẫn còn nguyên hạn mức (spec 14.4).
    expect(body.error.details.actions).not.toContain('buy_more');
    expect(body.error.details.resetAt).toBeNull();
    expect(response.headers.get('retry-after')).toBe('5');
  });

  it('refuses an expired subscription with 403 instead of offering more quota', async () => {
    const { app, object } = await fixture(200);
    await runInDurableObject(object, (_instance, state) => {
      state.storage.sql.exec('UPDATE period SET ends_at=?', Date.now() - 1000);
    });
    const response = await app.request('https://api.test/fixture', {}, env);
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      error: { code: string; details: { reason: string; actions: string[] } };
    };
    expect(body.error.code).toBe('subscription_expired');
    expect(body.error.details.actions).not.toContain('buy_more');
  });

  it('phát Server-Timing cho từng vòng gọi sổ quota', async () => {
    const { app } = await fixture(200);
    const response = await app.request('https://api.test/fixture', {}, env);
    expect(response.status).toBe(200);
    const timing = response.headers.get('server-timing') ?? '';
    // Không có dòng này thì "thương mại chậm hơn legacy 677 ms" là con số không hành động được:
    // không biết nên bỏ bớt vòng gọi hay xử lý vị trí object.
    expect(timing).toMatch(/reserve;dur=\d+/);
    expect(timing).toMatch(/prepare;dur=\d+/);
  });

  it('không phát Server-Timing khi request lỗi không chạm tới prepare', async () => {
    const { app } = await fixture(404);
    const response = await app.request('https://api.test/fixture', {}, env);
    expect(response.status).toBe(404);
    expect(response.headers.get('server-timing')).toBeNull();
  });
});
