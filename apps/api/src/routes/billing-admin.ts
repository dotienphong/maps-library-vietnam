import { Hono } from 'hono';
import type { EntitlementCommand } from '../billing/types';
import { getSql } from '../db';
import type { AppEnv, Env } from '../env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Mã lệnh quản trị → HTTP status. Sai định dạng là lỗi người gửi (400/413), đụng trạng thái là
 * xung đột (409); mã lạ hoặc `invalid_catalog` là lỗi máy chủ nên rơi xuống 503 và có log.
 */
const ADMIN_COMMAND_STATUS = new Map<string, 400 | 409 | 413>([
  ['payload_too_large', 413],
  ['invalid_command', 400],
  ['operation_conflict', 409],
  ['revision_conflict', 409],
  ['business_identity_conflict', 409],
  ['tenant_conflict', 409],
  ['period_overlap', 409],
  ['period_not_active', 409],
  ['trial_already_used', 409],
  ['credits_require_paid_active', 409],
  ['no_entitlement', 409],
]);
const MAX_BODY_BYTES = 16 * 1024;

interface BillingAdminDependencies {
  tenantExists?: (tenantId: string, env: Env) => Promise<boolean>;
  applyCommand?: (tenantId: string, command: EntitlementCommand, env: Env) => Promise<unknown>;
}

async function tenantExists(
  tenantId: string,
  env: Env,
  executionCtx: { waitUntil(promise: Promise<unknown>): void },
) {
  const sql = getSql(env);
  try {
    const rows = await sql<{ exists: boolean }[]>`SELECT EXISTS(
      SELECT 1 FROM tenant WHERE id = ${tenantId}::uuid
    ) AS exists`;
    return rows[0]?.exists === true;
  } finally {
    executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
}

export function billingAdmin(dependencies: BillingAdminDependencies = {}) {
  const routes = new Hono<AppEnv>();

  routes.use('/v1/admin/billing/:tenantId/*', async (c, next) => {
    const tenantId = c.req.param('tenantId');
    if (!UUID.test(tenantId)) return c.json({ error: { code: 'invalid_tenant' } }, 400);
    try {
      const found = dependencies.tenantExists
        ? await dependencies.tenantExists(tenantId, c.env)
        : await tenantExists(tenantId, c.env, c.executionCtx);
      if (!found) {
        return c.json({ error: { code: 'tenant_not_found' } }, 404);
      }
    } catch (error) {
      console.error('billing tenant lookup', error);
      return c.json({ error: { code: 'upstream_unavailable' } }, 503);
    }
    await next();
  });

  routes.use('/v1/admin/billing/:tenantId/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.env.BILLING_ADMIN_ORIGIN) {
      if (c.req.header('Origin') !== c.env.BILLING_ADMIN_ORIGIN) {
        return c.json({ error: { code: 'invalid_admin_origin' } }, 403);
      }
    }
    await next();
  });

  routes.get('/v1/admin/billing/:tenantId/usage', async (c) => {
    const tenantId = c.req.param('tenantId');
    const object = c.env.QUOTA.get(c.env.QUOTA.idFromName(tenantId));
    const usage = await object.readUsage();
    return c.json(usage, 200, { 'cache-control': 'private, no-store' });
  });

  routes.post('/v1/admin/billing/:tenantId/commands', async (c) => {
    const tenantId = c.req.param('tenantId');
    const text = await c.req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return c.json({ error: { code: 'payload_too_large' } }, 413);
    }
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return c.json({ error: { code: 'invalid_command' } }, 400);
    }
    const command = {
      ...input,
      tenantId,
      actor: c.get('reviewer'),
    } as EntitlementCommand;
    try {
      const receipt = dependencies.applyCommand
        ? await dependencies.applyCommand(tenantId, command, c.env)
        : await c.env.QUOTA.get(c.env.QUOTA.idFromName(tenantId)).applyCommand(command);
      return c.json(receipt, 200, { 'cache-control': 'private, no-store' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Khớp theo MÃ chứ không theo `instanceof`: lỗi ném trong Durable Object đi qua RPC về đây
      // dưới dạng Error thường, mất hẳn class BillingCommandError.
      const status = ADMIN_COMMAND_STATUS.get(message);
      if (status) return c.json({ error: { code: message } }, status);
      console.error('billing command', error);
      return c.json({ error: { code: 'upstream_unavailable' } }, 503);
    }
  });

  routes.post('/v1/admin/billing/:tenantId/mode', async (c) => {
    const tenantId = c.req.param('tenantId');
    const body = await readSmallJson(c.req.raw);
    if (!body || !['legacy', 'commercial'].includes(String(body.mode))) {
      return c.json({ error: { code: 'invalid_quota_mode' } }, 400);
    }
    const sql = getSql(c.env);
    try {
      const keys = await sql<
        { key_hash: string }[]
      >`SELECT key_hash FROM api_key WHERE tenant_id=${tenantId}::uuid`;
      await sql`UPDATE tenant SET quota_mode=${String(body.mode)} WHERE id=${tenantId}::uuid`;
      await Promise.all(keys.map(({ key_hash }) => c.env.META.delete(`apikey:${key_hash}`)));
      return c.json({ tenantId, mode: body.mode }, 200, { 'cache-control': 'private, no-store' });
    } catch (error) {
      console.error('billing mode', error);
      return c.json({ error: { code: 'upstream_unavailable' } }, 503);
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  });

  routes.post('/v1/admin/billing/:tenantId/keys/:keyHash/revocation', async (c) => {
    const tenantId = c.req.param('tenantId');
    const keyHash = c.req.param('keyHash');
    const body = await readSmallJson(c.req.raw);
    if (
      !/^[a-f0-9]{64}$/.test(keyHash) ||
      !body ||
      typeof body.revoked !== 'boolean' ||
      typeof body.operationId !== 'string' ||
      typeof body.reason !== 'string'
    ) {
      return c.json({ error: { code: 'invalid_key_command' } }, 400);
    }
    const revoked = body.revoked;
    const operationId = body.operationId;
    const reason = body.reason;
    const sql = getSql(c.env);
    try {
      const existing = await sql<{ key_hash: string }[]>`SELECT key_hash FROM api_key
        WHERE tenant_id=${tenantId}::uuid AND key_hash=${keyHash}`;
      if (existing.length === 0) return c.json({ error: { code: 'key_not_found' } }, 404);
      const object = c.env.QUOTA.get(c.env.QUOTA.idFromName(tenantId));
      const applyToObject = () =>
        object.setKeyRevoked(keyHash, revoked, operationId, c.get('reviewer') ?? '', reason);
      const updateDatabase = async () => {
        const rows = await sql<{ key_hash: string }[]>`UPDATE api_key
          SET active=${!revoked}, revoked_at=${revoked ? new Date() : null}
          WHERE tenant_id=${tenantId}::uuid AND key_hash=${keyHash}
          RETURNING key_hash`;
        if (rows.length === 0) return false;
        return true;
      };

      // Fail closed across partial failures: revocation reaches the hot-path DO first;
      // restoration reaches durable PostgreSQL first and remains denied until DO succeeds.
      let receipt: Awaited<ReturnType<typeof applyToObject>>;
      if (revoked) {
        receipt = await applyToObject();
        if (!(await updateDatabase())) throw new Error('key_disappeared_during_revocation');
      } else {
        if (!(await updateDatabase())) throw new Error('key_disappeared_during_restoration');
        receipt = await applyToObject();
      }
      await c.env.META.delete(`apikey:${keyHash}`);
      return c.json(receipt, 200, { 'cache-control': 'private, no-store' });
    } catch (error) {
      await c.env.META.delete(`apikey:${keyHash}`);
      console.error('billing key revocation', error);
      return c.json({ error: { code: 'upstream_unavailable' } }, 503);
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  });

  return routes;
}

async function readSmallJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
