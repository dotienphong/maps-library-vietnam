import { type Context, Hono } from 'hono';
import { audit } from '../audit';
import { quotaObject } from '../billing/object';
import type { EntitlementCommand, JournalEntry, SnapshotPage } from '../billing/types';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';
import { moTaLoi } from '../errors';
import { setKeyRevokedForTenant } from '../tenant-keys';
import { billingRead } from './billing-read';

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
/** Một trang snapshot trần 256 KiB (spec 14.6) cộng phần bọc JSON của lệnh phục hồi. */
const MAX_RESTORE_BYTES = 512 * 1024;

/**
 * Mã lỗi của nhóm sao lưu/phục hồi → HTTP status. Mọi mã "chặn vì trạng thái sai" đều là 409:
 * đây là thao tác vận hành, người gọi cần biết chính xác cổng nào đã chặn để xử lý, chứ không
 * phải một 400 chung chung rồi tự đoán.
 */
const BACKUP_STATUS = new Map<string, 400 | 404 | 409 | 413>([
  ['invalid_snapshot', 400],
  ['invalid_journal', 400],
  ['invalid_checkpoint', 400],
  ['invalid_restore', 400],
  ['invalid_maintenance', 400],
  ['snapshot_not_found', 404],
  ['checksum_mismatch', 409],
  ['snapshot_stale', 409],
  ['checkpoint_stale', 409],
  ['not_in_maintenance', 409],
  ['traffic_active', 409],
  ['journal_gap', 409],
  ['operation_conflict', 409],
  ['snapshot_too_large', 413],
]);

/**
 * Phần mặt của Durable Object mà nhóm route sao lưu dùng tới. Khai báo hẹp để test tiêm được
 * bản giả: lỗi ném qua ranh giới RPC thật làm vitest-pool-workers hỏng isolated storage, nên
 * nhánh lỗi phải kiểm được mà không cần đi qua RPC.
 */
interface QuotaBackupPort {
  beginSnapshot(operationId: string, actor: string): Promise<unknown>;
  readSnapshotPage(snapshotId: string, index: number): Promise<unknown>;
  readJournal(afterSequence: number, limit: number): Promise<unknown>;
  advanceCheckpoint(operationId: string, snapshotId: string, checksum: string): Promise<unknown>;
  setMaintenance(
    operationId: string,
    actor: string,
    reason: string,
    enabled: boolean,
  ): Promise<unknown>;
  restoreSnapshotPage(
    operationId: string,
    snapshotId: string,
    page: SnapshotPage,
  ): Promise<unknown>;
  restoreJournal(operationId: string, entries: JournalEntry[]): Promise<unknown>;
}

type AuditDetail = Record<string, string | number | boolean | null>;

interface BillingAdminDependencies {
  tenantExists?: (tenantId: string, env: Env) => Promise<boolean>;
  applyCommand?: (tenantId: string, command: EntitlementCommand, env: Env) => Promise<unknown>;
  quotaBackup?: (tenantId: string, env: Env) => QuotaBackupPort;
  /**
   * Cổng ghi nhật ký, tiêm được để test kiểm nội dung dòng audit mà không cần Postgres.
   * Mặc định là `audit()` thật (chạy trong waitUntil, tự mở và đóng client riêng).
   */
  writeAuditEntry?: (entry: { action: string; target?: string; detail?: AuditDetail }) => void;
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
    endSql(executionCtx, sql);
  }
}

export function billingAdmin(dependencies: BillingAdminDependencies = {}) {
  const routes = new Hono<AppEnv>();

  const ghiAudit = (c: Context<AppEnv>, action: string, target: string, detail: AuditDetail) => {
    if (dependencies.writeAuditEntry) {
      dependencies.writeAuditEntry({ action, target, detail });
      return;
    }
    audit(c, action, target, detail);
  };

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
      console.error(`billing tenant lookup: ${moTaLoi(error)}`, error);
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
    const object = quotaObject(c.env, tenantId);
    const usage = await object.readUsage();
    return c.json(usage, 200, { 'cache-control': 'private, no-store' });
  });

  // Mount SAU hai middleware ở trên để nhóm đọc cũng qua cổng kiểm tenant tồn tại; mount trước
  // chúng thì `/periods` của một uuid không có thật sẽ trả 200 với sổ rỗng thay vì 404.
  routes.route('/', billingRead);

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
        : await quotaObject(c.env, tenantId).applyCommand(command);
      // Vết kiểm toán ghi SAU khi sổ đã nhận lệnh: nhật ký là bằng chứng việc đã xảy ra, không
      // phải dự định. Chỉ những trường đủ để tra lại, không chép mã thanh toán của khách vào đây.
      const thanhPhan = receipt as { revision?: number; status?: string; tier?: string | null };
      ghiAudit(c, 'billing.command', tenantId, {
        kind: String(input.kind ?? ''),
        operation_id: String(input.operationId ?? ''),
        revision: thanhPhan.revision ?? null,
        status: thanhPhan.status ?? null,
        tier: thanhPhan.tier ?? null,
      });
      return c.json(receipt, 200, { 'cache-control': 'private, no-store' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Khớp theo MÃ chứ không theo `instanceof`: lỗi ném trong Durable Object đi qua RPC về đây
      // dưới dạng Error thường, mất hẳn class BillingCommandError.
      const status = ADMIN_COMMAND_STATUS.get(message);
      if (status) return c.json({ error: { code: message } }, status);
      console.error(`billing command: ${moTaLoi(error)}`, error);
      return c.json({ error: { code: 'upstream_unavailable' } }, 503);
    }
  });

  /**
   * Mở sớm khoá `ack_required`. Cửa sổ trượt 24 giờ tự mở, nhưng khi nguyên nhân đã rõ và đã sửa
   * — ví dụ một công cụ vận hành gọi API rồi quên ACK — bắt tenant chờ hết 24 giờ là phạt nhầm
   * người. Có operationId nên gọi lại không mở hai lần, và có audit ai mở vì lý do gì.
   */
  routes.post('/v1/admin/billing/:tenantId/missing-acks/unlock', async (c) => {
    const body = await readSmallJson(c.req.raw);
    if (!body || typeof body.operationId !== 'string' || typeof body.reason !== 'string') {
      return c.json({ error: { code: 'invalid_unlock' } }, 400);
    }
    const tenantId = c.req.param('tenantId') as string;
    const object = quotaObject(c.env, tenantId);
    try {
      const receipt = await object.unlockMissingAcks(
        body.operationId,
        c.get('reviewer') ?? '',
        body.reason,
      );
      // Khác lệnh billing: ở đây GIỮ `reason` trong nhật ký. Lý do mở khoá sớm do người quản trị
      // tự gõ chính là nội dung cần kiểm toán, không phải dữ liệu tài chính của khách.
      ghiAudit(c, 'billing.unlock_acks', tenantId, {
        operation_id: body.operationId,
        reason: body.reason,
        unlocked: receipt.unlocked,
      });
      return c.json(receipt, 200, { 'cache-control': 'private, no-store' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'invalid_unlock') return c.json({ error: { code: message } }, 400);
      if (message === 'operation_conflict') return c.json({ error: { code: message } }, 409);
      console.error(`billing unlock: ${moTaLoi(error)}`, error);
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
      audit(c, 'tenant.quota_mode', tenantId, { mode: String(body.mode) });
      return c.json({ tenantId, mode: body.mode }, 200, { 'cache-control': 'private, no-store' });
    } catch (error) {
      console.error(`billing mode: ${moTaLoi(error)}`, error);
      return c.json({ error: { code: 'upstream_unavailable' } }, 503);
    } finally {
      endSql(c.executionCtx, sql);
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
      // Thứ tự fail-closed (thu hồi chạm sổ quota trước, khôi phục chạm Postgres trước) và việc
      // xoá cache auth nằm trong `tenant-keys.ts`, dùng chung với cổng khách hàng.
      const receipt = await setKeyRevokedForTenant(sql, c.env, {
        tenantId,
        keyHash,
        revoked,
        operationId,
        actor: c.get('reviewer') ?? '',
        reason,
      });
      if (receipt === null) return c.json({ error: { code: 'key_not_found' } }, 404);

      // Nhật ký kiểm toán là bằng chứng "ai tắt khoá của khách lúc mấy giờ" — receipt của Durable
      // Object nằm trong sổ quota, không phải nơi người quản trị tra cứu. Không ghi khoá rõ: chỉ
      // key_hash, đúng như spec mục 10.
      audit(c, revoked ? 'tenant.key_revoke' : 'tenant.key_restore', keyHash, {
        tenant_id: tenantId,
        reason,
        operation_id: operationId,
      });
      return c.json(receipt, 200, { 'cache-control': 'private, no-store' });
    } catch (error) {
      console.error(`billing key revocation: ${moTaLoi(error)}`, error);
      return c.json({ error: { code: 'upstream_unavailable' } }, 503);
    } finally {
      endSql(c.executionCtx, sql);
    }
  });

  const quota = (c: Context<AppEnv>): QuotaBackupPort => {
    const tenantId = c.req.param('tenantId') as string;
    return dependencies.quotaBackup?.(tenantId, c.env) ?? quotaObject(c.env, tenantId);
  };

  // Sao lưu/phục hồi nằm dưới tiền tố riêng để CHỈ MỘT middleware canh được cả nhóm; thêm route
  // mới vào đây không thể quên gắn quyền.
  routes.use('/v1/admin/billing/:tenantId/backup/*', async (c, next) => {
    const email = (c.get('reviewer') ?? '').trim().toLowerCase();
    const allowed = (c.env.BILLING_BACKUP_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (!email || !allowed.includes(email)) {
      return c.json({ error: { code: 'billing_backup_forbidden' } }, 403);
    }
    await next();
  });

  routes.post('/v1/admin/billing/:tenantId/backup/snapshot', async (c) => {
    const body = await readSmallJson(c.req.raw);
    if (!body || typeof body.operationId !== 'string') {
      return c.json({ error: { code: 'invalid_snapshot' } }, 400);
    }
    return backup(c, quota(c), (object, actor) =>
      object.beginSnapshot(body.operationId as string, actor),
    );
  });

  routes.get('/v1/admin/billing/:tenantId/backup/snapshot/:snapshotId/:index', async (c) => {
    const index = Number(c.req.param('index'));
    return backup(c, quota(c), (object) =>
      object.readSnapshotPage(c.req.param('snapshotId'), index),
    );
  });

  routes.get('/v1/admin/billing/:tenantId/backup/journal', async (c) => {
    const after = Number(c.req.query('after') ?? '0');
    const limit = Number(c.req.query('limit') ?? '100');
    return backup(c, quota(c), (object) => object.readJournal(after, limit));
  });

  routes.post('/v1/admin/billing/:tenantId/backup/checkpoint', async (c) => {
    const body = await readSmallJson(c.req.raw);
    if (
      !body ||
      typeof body.operationId !== 'string' ||
      typeof body.snapshotId !== 'string' ||
      typeof body.checksum !== 'string'
    ) {
      return c.json({ error: { code: 'invalid_checkpoint' } }, 400);
    }
    return backup(c, quota(c), (object) =>
      object.advanceCheckpoint(
        body.operationId as string,
        body.snapshotId as string,
        body.checksum as string,
      ),
    );
  });

  routes.post('/v1/admin/billing/:tenantId/backup/maintenance', async (c) => {
    const body = await readSmallJson(c.req.raw);
    if (
      !body ||
      typeof body.operationId !== 'string' ||
      typeof body.reason !== 'string' ||
      typeof body.enabled !== 'boolean'
    ) {
      return c.json({ error: { code: 'invalid_maintenance' } }, 400);
    }
    return backup(c, quota(c), (object, actor) =>
      object.setMaintenance(
        body.operationId as string,
        actor,
        body.reason as string,
        body.enabled as boolean,
      ),
    );
  });

  routes.post('/v1/admin/billing/:tenantId/backup/restore', async (c) => {
    const body = await readSmallJson(c.req.raw, MAX_RESTORE_BYTES);
    if (!body || typeof body.operationId !== 'string') {
      return c.json({ error: { code: 'invalid_restore' } }, 400);
    }
    if (body.page) {
      const page = body.page as SnapshotPage;
      return backup(c, quota(c), (object) =>
        object.restoreSnapshotPage(body.operationId as string, page.snapshotId, page),
      );
    }
    if (Array.isArray(body.entries)) {
      const entries = body.entries as JournalEntry[];
      return backup(c, quota(c), (object) =>
        object.restoreJournal(body.operationId as string, entries),
      );
    }
    return c.json({ error: { code: 'invalid_restore' } }, 400);
  });

  return routes;
}

/**
 * Gọi một RPC sao lưu rồi dịch lỗi. Lỗi ném trong Durable Object về đây dưới dạng Error thường
 * (mất class gốc qua RPC), nên khớp theo MÃ chứ không theo `instanceof`.
 */
async function backup(
  c: Context<AppEnv>,
  port: QuotaBackupPort,
  call: (object: QuotaBackupPort, actor: string) => Promise<unknown>,
): Promise<Response> {
  try {
    const result = await call(port, c.get('reviewer') ?? '');
    return c.json(result as Record<string, unknown>, 200, { 'cache-control': 'private, no-store' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = BACKUP_STATUS.get(message);
    if (status) return c.json({ error: { code: message } }, status);
    console.error(`billing backup: ${moTaLoi(error)}`, error);
    return c.json({ error: { code: 'upstream_unavailable' } }, 503);
  }
}

async function readSmallJson(
  request: Request,
  limit = MAX_BODY_BYTES,
): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
