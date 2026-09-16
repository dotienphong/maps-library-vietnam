import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { billingAdmin } from '../src/routes/billing-admin';

const tenantId = '00000000-0000-4000-8000-0000000000c1';

function appFor(
  options: {
    email?: string;
    exists?: boolean;
    conflict?: boolean;
    failWith?: string;
    backupFailsWith?: string;
  } = {},
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
    ...(options.backupFailsWith
      ? {
          quotaBackup: () =>
            new Proxy({} as never, {
              get: () => async () => {
                throw new Error(options.backupFailsWith);
              },
            }),
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

  it('keeps ledger backup behind its own allowlist, separate from subscription admin', async () => {
    const billing = appFor({ email: 'billing@test.local' });
    const denied = await request(billing, `/v1/admin/billing/${tenantId}/backup/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: crypto.randomUUID() }),
    });
    // Quản trị thuê bao KHÔNG kéo theo quyền ghi đè sổ tiêu thụ.
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: 'billing_backup_forbidden' } });
  });

  it('exports a checksummed snapshot page and refuses a checkpoint on the wrong bytes', async () => {
    const app = appFor({ email: 'backup@test.local' });
    const operationId = crypto.randomUUID();
    const started = await request(app, `/v1/admin/billing/${tenantId}/backup/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId }),
    });
    expect(started.status).toBe(200);
    const manifest = (await started.json()) as {
      snapshotId: string;
      pages: number;
      checksum: string;
    };
    expect(manifest.pages).toBeGreaterThan(0);
    expect(started.headers.get('cache-control')).toBe('private, no-store');

    const pageResponse = await request(
      app,
      `/v1/admin/billing/${tenantId}/backup/snapshot/${manifest.snapshotId}/0`,
    );
    expect(pageResponse.status).toBe(200);
    const page = (await pageResponse.json()) as { records: string; checksum: string };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(page.records));
    expect([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')).toBe(
      page.checksum,
    );

    // Checkpoint chỉ nhích khi checksum khớp; nhánh từ chối kiểm ở billing-backup.test.ts (mức
    // Durable Object) và ở ca ánh xạ mã lỗi bên dưới — cho lỗi bay qua RPC thật trong test route
    // sẽ làm vitest-pool-workers hỏng isolated storage.
    const ok = await request(app, `/v1/admin/billing/${tenantId}/backup/checkpoint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        snapshotId: manifest.snapshotId,
        checksum: manifest.checksum,
      }),
    });
    expect(ok.status).toBe(200);
  });

  it('maps ledger backup failures to the right status after RPC strips the error class', async () => {
    const cases: [string, number][] = [
      ['not_in_maintenance', 409],
      ['traffic_active', 409],
      ['snapshot_stale', 409],
      ['journal_gap', 409],
      ['snapshot_not_found', 404],
      ['snapshot_too_large', 413],
      ['something_unmapped', 503],
    ];
    for (const [code, status] of cases) {
      const app = appFor({ email: 'backup@test.local', backupFailsWith: code });
      const response = await request(app, `/v1/admin/billing/${tenantId}/backup/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          page: {
            snapshotId: crypto.randomUUID(),
            index: 0,
            pages: 1,
            sequence: 0,
            records: '[]',
            checksum: 'f'.repeat(64),
          },
        }),
      });
      expect([code, response.status]).toEqual([code, status]);
    }
  });

  it('mở sớm khoá ack_required, và chỉ người có quyền quản trị thuê bao mới mở được', async () => {
    const anonymous = await request(appFor(), `/v1/admin/billing/${tenantId}/missing-acks/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: crypto.randomUUID(), reason: 'cong cu quen ACK' }),
    });
    expect(anonymous.status).toBe(401);

    const app = appFor({ email: 'billing@test.local' });
    const response = await request(app, `/v1/admin/billing/${tenantId}/missing-acks/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: crypto.randomUUID(), reason: 'cong cu quen ACK' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('unlocked');

    const malformed = await request(app, `/v1/admin/billing/${tenantId}/missing-acks/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'thiếu operationId' }),
    });
    expect(malformed.status).toBe(400);
  });
});

describe('nhật ký kiểm toán cho lệnh billing', () => {
  /** Tầng này không có Postgres, nên `billingAdmin` nhận một cổng ghi audit tiêm được. */
  function appGhiAudit(
    ghi: { action: string; target?: string; detail?: Record<string, unknown> }[],
    options: { failWith?: string } = {},
  ) {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('reviewer', 'phong@test.local');
      await next();
    });
    app.route(
      '/',
      billingAdmin({
        tenantExists: async () => true,
        applyCommand: async () => {
          if (options.failWith) throw new Error(options.failWith);
          return {
            operationId: 'op-1',
            revision: 4,
            status: 'active',
            tier: 'starter',
            appliedAt: new Date().toISOString(),
          };
        },
        writeAuditEntry: (entry) => ghi.push(entry),
      }),
    );
    return app;
  }

  const lenhCapKy = {
    kind: 'grantPeriod',
    operationId: 'op-1',
    reason: 'khách chuyển khoản CK-8821',
    expectedRevision: 3,
    periodId: 'p-1',
    tier: 'starter',
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-11-01T00:00:00.000Z',
    paymentReference: 'CK-8821',
    lineItemId: 'period-1',
  };

  it('lệnh thành công ghi đúng một dòng audit, có actor và KHÔNG có mã thanh toán', async () => {
    const ghi: { action: string; target?: string; detail?: Record<string, unknown> }[] = [];
    const response = await request(appGhiAudit(ghi), `/v1/admin/billing/${tenantId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(lenhCapKy),
    });

    expect(response.status).toBe(200);
    expect(ghi).toHaveLength(1);
    expect(ghi[0]?.action).toBe('billing.command');
    expect(ghi[0]?.target).toBe(tenantId);
    expect(ghi[0]?.detail).toMatchObject({
      kind: 'grantPeriod',
      operation_id: 'op-1',
      revision: 4,
      tier: 'starter',
    });
    // Mã thanh toán là dữ liệu tài chính của khách; nhật ký kiểm toán chỉ cần biết ai làm gì.
    expect(JSON.stringify(ghi[0]?.detail)).not.toContain('CK-8821');
  });

  it('lệnh thất bại KHÔNG ghi audit — nhật ký là vết của việc đã xảy ra', async () => {
    const ghi: { action: string; target?: string; detail?: Record<string, unknown> }[] = [];
    const app = appGhiAudit(ghi, { failWith: 'revision_conflict' });
    const response = await request(app, `/v1/admin/billing/${tenantId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(lenhCapKy),
    });
    expect(response.status).toBe(409);
    expect(ghi).toHaveLength(0);
  });

  it('lệnh mở khoá ack ghi audit KÈM lý do — lý do chính là thứ cần kiểm toán ở đây', async () => {
    const ghi: { action: string; target?: string; detail?: Record<string, unknown> }[] = [];
    const response = await request(
      appGhiAudit(ghi),
      `/v1/admin/billing/${tenantId}/missing-acks/unlock`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: 'op-unlock', reason: 'công cụ khách quên ACK' }),
      },
    );
    expect(response.status).toBe(200);
    expect(ghi).toHaveLength(1);
    expect(ghi[0]?.action).toBe('billing.unlock_acks');
    expect(ghi[0]?.detail).toMatchObject({
      operation_id: 'op-unlock',
      reason: 'công cụ khách quên ACK',
    });
  });
});
