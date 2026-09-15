import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { billingAdmin } from '../src/routes/billing-admin';

const tenantId = '00000000-0000-4000-8000-0000000000c1';

function appFor(
  options: { email?: string; exists?: boolean; conflict?: boolean; failWith?: string } = {},
) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    if (!options.email) return c.json({ error: { code: 'missing_access_jwt' } }, 401);
    c.set('reviewer', options.email);
    await next();
  });
  const failWith = options.failWith ?? (options.conflict ? 'revision_conflict' : undefined);
  const dependencies = {
    tenantExists: async (id: string) => options.exists !== false && id === tenantId,
    ...(failWith
      ? {
          applyCommand: async () => {
            // Đúng hình dạng lỗi đi qua RPC của Durable Object: Error thường, mất class gốc.
            throw new Error(failWith);
          },
        }
      : {}),
  };
  app.route('/', billingAdmin(dependencies));
  return app;
}

const request = (app: Hono<AppEnv>, path: string, init?: RequestInit) =>
  app.request(`https://api.test${path}`, init, env);

describe('billing admin routes', () => {
  it('requires Access authentication before billing operations', async () => {
    expect((await request(appFor(), `/v1/admin/billing/${tenantId}/usage`)).status).toBe(401);
  });

  it('rejects malformed and unknown tenant IDs before creating a Durable Object', async () => {
    const app = appFor({ email: 'billing@test.local', exists: false });
    expect((await request(app, '/v1/admin/billing/not-a-uuid/usage')).status).toBe(400);
    expect((await request(app, `/v1/admin/billing/${tenantId}/usage`)).status).toBe(404);
  });

  it('derives tenant and actor server-side, then replays commands idempotently', async () => {
    const app = appFor({ email: 'billing@test.local' });
    const command = {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'approved trial',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
      tenantId: '00000000-0000-4000-8000-000000000099',
      actor: 'forged@test.local',
    };
    const first = await request(app, `/v1/admin/billing/${tenantId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    expect(first.status).toBe(200);
    const receipt = await first.json();
    const replay = await request(app, `/v1/admin/billing/${tenantId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    expect(await replay.json()).toEqual(receipt);
    expect(await request(app, `/v1/admin/billing/${tenantId}/usage`)).toHaveProperty('status', 200);
  });

  it('maps command failures to the right status even after RPC strips the error class', async () => {
    const cases: [string, number][] = [
      ['invalid_command', 400],
      ['payload_too_large', 413],
      ['revision_conflict', 409],
      ['trial_already_used', 409],
      ['invalid_catalog', 503],
    ];
    for (const [code, status] of cases) {
      const response = await request(
        appFor({ email: 'billing@test.local', failWith: code }),
        `/v1/admin/billing/${tenantId}/commands`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'suspend',
            operationId: crypto.randomUUID(),
            reason: 'mapping',
            expectedRevision: 0,
          }),
        },
      );
      expect([code, response.status]).toEqual([code, status]);
    }
  });

  it('caps command bodies at 16 KiB and maps revision conflicts to 409', async () => {
    const app = appFor({ email: 'billing@test.local', conflict: true });
    const oversized = await request(app, `/v1/admin/billing/${tenantId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x'.repeat(17_000) }),
    });
    expect(oversized.status).toBe(413);

    const stale = await request(app, `/v1/admin/billing/${tenantId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'suspend',
        operationId: crypto.randomUUID(),
        reason: 'stale',
        expectedRevision: 99,
      }),
    });
    expect(stale.status).toBe(409);
  });
});
