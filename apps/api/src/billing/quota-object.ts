import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { PLAN_CATALOG } from './catalog';
import { BillingCommandError, businessHash, commandHash, validateCommand } from './commands';
import { initializeLedger } from './ledger';
import { trialEndsAt, vnBillingDay } from './policy';
import type {
  CommandReceipt,
  EntitlementCommand,
  EntitlementStatus,
  GroupUsage,
  QuotaGroup,
  ReserveResult,
  SettlementReceipt,
  Tier,
  UsageSnapshot,
} from './types';

/** Lease của receipt ĐANG CHỜ CLIENT ACK. Client cần một vòng mạng nữa nên để rộng. */
const LEASE_MS = 120_000;
/**
 * Hạn của reservation khi handler CÒN ĐANG CHẠY. Middleware giết handler ở 30 giây
 * (`COMMERCIAL_HANDLER_TIMEOUT_MS`), cộng biên cho vòng RPC `prepare` — không để 120 giây như
 * lease ACK, vì request bị client huỷ (SDK huỷ autocomplete cũ mỗi lần gõ phím) sẽ giữ chỗ
 * suốt chừng đó.
 */
const PROCESSING_DEADLINE_MS = 45_000;
const MISSING_ACK_WINDOW_MS = 86_400_000;
const MAX_MISSING_ACK = 3;
const CLOSED_RETENTION_MS = 35 * 86_400_000;
/**
 * Trần request ĐỒNG THỜI của một tenant, lấy từ ramp đo lại ngày 15/09/2026
 * (`docs/evidence/capacity/2026-09-15-inflight-ramp.md`), tiêu chí dừng p95 ≤ 5 s:
 * - places 50 (p95 4.390 ms); mức 75 p95 6.046 ms nên trượt.
 * - directions 32 (p95 1.171 ms); KHÔNG tìm thấy điểm gãy độ trễ — mức 48 bị chính rate limit
 *   biên chặn (4/48 trả 429) chứ không phải Valhalla đuối, nên 32 là mức sạch cao nhất.
 * Đây là trần CỨNG để một tenant không kéo sập origin, không phải mục tiêu vận hành: ở mức 50,
 * p95 autocomplete đã là 4,4 s. Muốn p95 ≤ 2 s thì đặt places ≈ 25 (xem bảng trong evidence).
 * Là trần theo TỪNG tenant trong khi origin dùng chung → đo lại trước khi có tenant thứ hai.
 * Chỉnh nhanh bằng var `MAX_INFLIGHT_PLACES`/`MAX_INFLIGHT_DIRECTIONS`, không cần sửa code.
 */
const MAX_INFLIGHT_DEFAULT: Record<QuotaGroup, number> = { places: 50, directions: 32 };

type EntitlementRow = {
  tenant_id: string;
  status: EntitlementStatus;
  tier: Tier | null;
  revision: number;
  trial_used_once: number;
};
type PeriodRow = {
  period_id: string;
  tier: Tier;
  starts_at: number;
  ends_at: number;
  places_limit: number;
  directions_limit: number;
};
type ReservationRow = {
  request_id: string;
  group_name: QuotaGroup;
  state: SettlementReceipt['state'];
  source_kind: 'period' | 'credit';
  source_id: string;
  day_key: string;
  token_hash: string | null;
  deadline: number;
};

export class QuotaObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeLedger(ctx.storage);
  }

  async applyCommand(command: EntitlementCommand): Promise<CommandReceipt> {
    validateCommand(command);
    const payloadHash = await commandHash(command);
    const financialHash = await businessHash(command);
    const sql = this.ctx.storage.sql;
    const prior = sql
      .exec(
        'SELECT payload_hash, receipt_json FROM entitlement_event WHERE operation_id = ?',
        command.operationId,
      )
      .toArray()[0] as { payload_hash: string; receipt_json: string } | undefined;
    if (prior) {
      if (prior.payload_hash !== payloadHash) throw new BillingCommandError('operation_conflict');
      return JSON.parse(prior.receipt_json) as CommandReceipt;
    }
    if (financialHash && (command.kind === 'grantPeriod' || command.kind === 'addCredits')) {
      const business = sql
        .exec(
          'SELECT payload_hash, receipt_json FROM business_identity WHERE payment_reference = ? AND line_item_id = ?',
          command.paymentReference,
          command.lineItemId,
        )
        .toArray()[0] as { payload_hash: string; receipt_json: string } | undefined;
      if (business) {
        if (business.payload_hash !== financialHash) {
          throw new BillingCommandError('business_identity_conflict');
        }
        return JSON.parse(business.receipt_json) as CommandReceipt;
      }
    }

    const now = Date.now();
    const entitlement = this.entitlement();
    if (entitlement && entitlement.tenant_id !== command.tenantId) {
      throw new BillingCommandError('tenant_conflict');
    }
    const revision = entitlement?.revision ?? 0;
    if (command.expectedRevision !== revision) throw new BillingCommandError('revision_conflict');
    if (command.kind === 'activateTrial' && entitlement?.trial_used_once) {
      throw new BillingCommandError('trial_already_used');
    }

    const nextRevision = revision + 1;
    const receipt: CommandReceipt = {
      operationId: command.operationId,
      revision: nextRevision,
      status: entitlement?.status ?? 'none',
      tier: entitlement?.tier ?? null,
      appliedAt: new Date(now).toISOString(),
    };

    this.ctx.storage.transactionSync(() => {
      if (command.kind === 'activateTrial') {
        const startsAt = Date.parse(command.startsAt);
        const endsAt = trialEndsAt(new Date(startsAt)).getTime();
        const periodId = `trial:${command.operationId}`;
        sql.exec(
          'INSERT INTO period(period_id,tier,starts_at,ends_at,places_limit,directions_limit) VALUES (?,?,?,?,?,?)',
          periodId,
          'trial',
          startsAt,
          endsAt,
          PLAN_CATALOG.trial.places,
          PLAN_CATALOG.trial.directions,
        );
        sql.exec(
          `INSERT INTO entitlement(id,tenant_id,status,tier,revision,trial_started_at,trial_ends_at,trial_used_once)
           VALUES(1,?,'active','trial',?,?,?,1)
           ON CONFLICT(id) DO UPDATE SET status='active',tier='trial',revision=excluded.revision,
             trial_started_at=excluded.trial_started_at,trial_ends_at=excluded.trial_ends_at,trial_used_once=1`,
          command.tenantId,
          nextRevision,
          startsAt,
          endsAt,
        );
        Object.assign(receipt, { status: 'active', tier: 'trial' });
      } else if (command.kind === 'grantPeriod') {
        const startsAt = Date.parse(command.startsAt);
        const endsAt = Date.parse(command.endsAt);
        const overlap = sql
          .exec(
            'SELECT period_id,tier,starts_at FROM period WHERE starts_at < ? AND ends_at > ? LIMIT 1',
            endsAt,
            startsAt,
          )
          .toArray()[0] as { period_id: string; tier: Tier; starts_at: number } | undefined;
        if (overlap) {
          if (
            overlap.tier !== 'trial' ||
            entitlement?.tier !== 'trial' ||
            startsAt <= overlap.starts_at
          ) {
            throw new BillingCommandError('period_overlap');
          }
          // Chuyển trial sang paid kết thúc quyền trial tại đúng thời điểm kỳ trả phí bắt đầu.
          // Reservation đã giữ vẫn trỏ period trial cũ và được settle vào nguồn ban đầu.
          sql.exec('UPDATE period SET ends_at=? WHERE period_id=?', startsAt, overlap.period_id);
        }
        const plan = PLAN_CATALOG[command.tier];
        sql.exec(
          `INSERT INTO period(period_id,tier,starts_at,ends_at,places_limit,directions_limit,payment_reference,line_item_id)
           VALUES(?,?,?,?,?,?,?,?)`,
          command.periodId,
          command.tier,
          startsAt,
          endsAt,
          plan.places,
          plan.directions,
          command.paymentReference,
          command.lineItemId,
        );
        const current = startsAt <= now && now < endsAt;
        const status = current ? 'active' : (entitlement?.status ?? 'expired');
        const tier = current ? command.tier : (entitlement?.tier ?? null);
        sql.exec(
          `INSERT INTO entitlement(id,tenant_id,status,tier,revision,trial_used_once)
           VALUES(1,?,?,?,?,0)
           ON CONFLICT(id) DO UPDATE SET status=excluded.status,tier=excluded.tier,revision=excluded.revision`,
          command.tenantId,
          status,
          tier,
          nextRevision,
        );
        Object.assign(receipt, { status, tier });
      } else if (command.kind === 'addCredits') {
        if (!entitlement || entitlement.status !== 'active' || entitlement.tier === 'trial') {
          throw new BillingCommandError('credits_require_paid_active');
        }
        const period = this.currentPeriod(now);
        if (!period || period.period_id !== command.periodId) {
          throw new BillingCommandError('period_not_active');
        }
        const units = command.packs * PLAN_CATALOG.addOns[command.group].units;
        if (!Number.isSafeInteger(units)) throw new BillingCommandError('invalid_command');
        sql.exec(
          `INSERT INTO credit_grant(grant_id,period_id,group_name,units,expires_at,payment_reference,line_item_id)
           VALUES(?,?,?,?,?,?,?)`,
          `credit:${command.operationId}`,
          command.periodId,
          command.group,
          units,
          period.ends_at,
          command.paymentReference,
          command.lineItemId,
        );
        sql.exec('UPDATE entitlement SET revision = ? WHERE id = 1', nextRevision);
        Object.assign(receipt, { status: entitlement.status, tier: entitlement.tier });
      } else {
        if (!entitlement) throw new BillingCommandError('no_entitlement');
        if (command.kind === 'suspend') {
          this.releaseAllPending(now, 'tenant_suspended');
          sql.exec(
            "UPDATE entitlement SET status='suspended', revision=? WHERE id=1",
            nextRevision,
          );
          Object.assign(receipt, { status: 'suspended', tier: entitlement.tier });
        } else {
          const current = this.currentPeriod(now);
          const status = current ? 'active' : 'expired';
          sql.exec(
            'UPDATE entitlement SET status=?, tier=?, revision=? WHERE id=1',
            status,
            current?.tier ?? null,
            nextRevision,
          );
          Object.assign(receipt, { status, tier: current?.tier ?? null });
        }
      }

      const receiptJson = JSON.stringify(receipt);
      sql.exec(
        `INSERT INTO entitlement_event(operation_id,payload_hash,revision,actor,reason,receipt_json,created_at)
         VALUES(?,?,?,?,?,?,?)`,
        command.operationId,
        payloadHash,
        nextRevision,
        command.actor,
        command.reason,
        receiptJson,
        now,
      );
      if (financialHash && (command.kind === 'grantPeriod' || command.kind === 'addCredits')) {
        sql.exec(
          `INSERT INTO business_identity(payment_reference,line_item_id,payload_hash,operation_id,receipt_json)
           VALUES(?,?,?,?,?)`,
          command.paymentReference,
          command.lineItemId,
          financialHash,
          command.operationId,
          receiptJson,
        );
      }
    });
    if (command.kind === 'suspend') await this.scheduleNextAlarm();
    return receipt;
  }

  async readUsage(): Promise<UsageSnapshot> {
    const entitlement = this.entitlement();
    if (!entitlement) return emptyUsage();
    const now = Date.now();
    const period = this.currentPeriod(now);
    const status = entitlement.status === 'suspended' ? 'suspended' : period ? 'active' : 'expired';
    const tier = period?.tier ?? (status === 'suspended' ? entitlement.tier : null);
    return {
      tenantId: entitlement.tenant_id,
      status,
      tier,
      revision: entitlement.revision,
      periodId: period?.period_id ?? null,
      startsAt: period ? new Date(period.starts_at).toISOString() : null,
      endsAt: period ? new Date(period.ends_at).toISOString() : null,
      trialUsedOnce: entitlement.trial_used_once === 1,
      places: this.groupUsage(period, 'places'),
      directions: this.groupUsage(period, 'directions'),
    };
  }

  async reserve(requestId: string, group: QuotaGroup, keyHash?: string): Promise<ReserveResult> {
    if (
      !validId(requestId) ||
      !['places', 'directions'].includes(group) ||
      (keyHash !== undefined && !/^[a-f0-9]{64}$/.test(keyHash))
    ) {
      throw new BillingCommandError('invalid_reservation');
    }
    const now = Date.now();
    let result!: ReserveResult;
    this.ctx.storage.transactionSync(() => {
      this.cleanupExpired(now, 32);
      const existing = this.reservation(requestId);
      if (existing) {
        if (existing.group_name !== group) throw new BillingCommandError('request_conflict');
        if (existing.state === 'reserved') {
          result = {
            allowed: true,
            requestId,
            deadline: new Date(existing.deadline).toISOString(),
          };
          return;
        }
        throw new BillingCommandError('request_closed');
      }

      const entitlement = this.entitlement();
      if (!entitlement) {
        result = denied(group, 'no_entitlement');
        return;
      }
      if (entitlement.status === 'suspended') {
        result = denied(group, 'suspended');
        return;
      }
      const period = this.currentPeriod(now);
      if (!period) {
        result = denied(
          group,
          entitlement.tier === 'trial' ? 'trial_expired' : 'subscription_expired',
        );
        return;
      }
      const missed = this.ctx.storage.sql
        .exec(
          'SELECT count(*) AS count FROM missed_ack WHERE expired_at > ?',
          now - MISSING_ACK_WINDOW_MS,
        )
        .one() as { count: number };
      if (missed.count >= MAX_MISSING_ACK) {
        result = denied(group, 'ack_required');
        return;
      }
      // CHỈ đếm 'reserved' — tức handler đang thật sự chạy và chiếm tài nguyên origin.
      // 'awaiting_ack' là handler đã xong, response đã gửi, chỉ còn chờ client ACK: không tải
      // origin chút nào, đếm vào đây là tự chặn mình.
      const inflight = this.ctx.storage.sql
        .exec(
          "SELECT count(*) AS count FROM reservation WHERE group_name=? AND state='reserved'",
          group,
        )
        .one() as { count: number };
      if (inflight.count >= this.maxInflight(group)) {
        result = denied(group, 'concurrency_limit');
        return;
      }

      const dayKey = period.tier === 'trial' ? vnBillingDay(new Date(now)) : '';
      const limit = group === 'places' ? period.places_limit : period.directions_limit;
      const total = this.ctx.storage.sql
        .exec(
          'SELECT coalesce(sum(used+reserved),0) AS total FROM counter WHERE source_id=? AND group_name=?',
          period.period_id,
          group,
        )
        .one() as { total: number };
      if (total.total < limit) {
        if (period.tier === 'trial') {
          const daily = this.ctx.storage.sql
            .exec(
              'SELECT coalesce(used+reserved,0) AS total FROM counter WHERE source_id=? AND group_name=? AND day_key=?',
              period.period_id,
              group,
              dayKey,
            )
            .toArray()[0] as { total: number } | undefined;
          const dailyLimit =
            group === 'places'
              ? PLAN_CATALOG.trial.dailyPlaces
              : PLAN_CATALOG.trial.dailyDirections;
          if (dailyLimit === null) throw new BillingCommandError('invalid_catalog');
          if ((daily?.total ?? 0) >= dailyLimit) {
            result = { allowed: false, reason: 'daily', group, resetAt: nextVnDay(now) };
            return;
          }
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO counter(source_id,group_name,day_key,reserved) VALUES(?,?,?,1)
           ON CONFLICT(source_id,group_name,day_key) DO UPDATE SET reserved=reserved+1`,
          period.period_id,
          group,
          dayKey,
        );
        this.insertReservation(requestId, group, 'period', period.period_id, dayKey, now, keyHash);
        result = {
          allowed: true,
          requestId,
          deadline: new Date(now + PROCESSING_DEADLINE_MS).toISOString(),
        };
        return;
      }

      const credit = this.ctx.storage.sql
        .exec(
          `SELECT grant_id FROM credit_grant
         WHERE period_id=? AND group_name=? AND expires_at>? AND used+reserved<units
         ORDER BY expires_at,grant_id LIMIT 1`,
          period.period_id,
          group,
          now,
        )
        .toArray()[0] as { grant_id: string } | undefined;
      if (!credit) {
        // Trial hết TỔNG là vĩnh viễn, khác hết hạn mức kỳ trả phí — spec mục 9 tách hai lý do.
        result = denied(group, period.tier === 'trial' ? 'trial_total' : 'period');
        return;
      }
      this.ctx.storage.sql.exec(
        'UPDATE credit_grant SET reserved=reserved+1 WHERE grant_id=?',
        credit.grant_id,
      );
      this.insertReservation(requestId, group, 'credit', credit.grant_id, '', now, keyHash);
      result = {
        allowed: true,
        requestId,
        deadline: new Date(now + PROCESSING_DEADLINE_MS).toISOString(),
      };
    });
    await this.scheduleNextAlarm();
    return result;
  }

  async prepare(requestId: string, tokenHash: string): Promise<SettlementReceipt> {
    if (!validId(requestId) || !validHash(tokenHash))
      throw new BillingCommandError('invalid_prepare');
    const now = Date.now();
    let receipt!: SettlementReceipt;
    this.ctx.storage.transactionSync(() => {
      this.cleanupExpired(now, 32);
      const row = this.requiredReservation(requestId);
      if (row.state === 'awaiting_ack' && row.token_hash === tokenHash) {
        receipt = settlement(row);
        return;
      }
      if (row.state !== 'reserved') throw new BillingCommandError('receipt_closed');
      this.ctx.storage.sql.exec(
        "UPDATE reservation SET state='awaiting_ack',token_hash=?,deadline=?,updated_at=? WHERE request_id=?",
        tokenHash,
        now + LEASE_MS,
        now,
        requestId,
      );
      receipt = {
        requestId,
        state: 'awaiting_ack',
        charged: false,
        expiresAt: new Date(now + LEASE_MS).toISOString(),
      };
    });
    await this.scheduleNextAlarm();
    return receipt;
  }

  async ack(requestId: string, token: string): Promise<SettlementReceipt> {
    if (!validId(requestId) || typeof token !== 'string' || token.length > 512) {
      throw new BillingCommandError('invalid_ack');
    }
    const tokenHash = await sha256(token);
    const now = Date.now();
    let receipt!: SettlementReceipt;
    this.ctx.storage.transactionSync(() => {
      this.cleanupExpired(now, 32);
      const row = this.requiredReservation(requestId);
      if (row.state === 'committed') {
        if (row.token_hash !== tokenHash) throw new BillingCommandError('invalid_receipt_token');
        receipt = settlement(row);
        return;
      }
      if (row.state !== 'awaiting_ack') throw new BillingCommandError('receipt_closed');
      if (row.token_hash !== tokenHash) throw new BillingCommandError('invalid_receipt_token');
      this.moveReserved(row, -1);
      this.moveUsed(row, 1);
      this.ctx.storage.sql.exec(
        "UPDATE reservation SET state='committed',updated_at=? WHERE request_id=?",
        now,
        requestId,
      );
      receipt = {
        requestId,
        state: 'committed',
        charged: true,
        expiresAt: new Date(row.deadline).toISOString(),
      };
    });
    await this.scheduleNextAlarm();
    return receipt;
  }

  async release(requestId: string, reason: string): Promise<SettlementReceipt> {
    if (!validId(requestId) || !validReason(reason))
      throw new BillingCommandError('invalid_release');
    const now = Date.now();
    let receipt!: SettlementReceipt;
    this.ctx.storage.transactionSync(() => {
      this.cleanupExpired(now, 32);
      const row = this.requiredReservation(requestId);
      if (row.state === 'released') {
        receipt = settlement(row);
        return;
      }
      if (row.state !== 'reserved' && row.state !== 'awaiting_ack') {
        throw new BillingCommandError('receipt_closed');
      }
      this.moveReserved(row, -1);
      this.ctx.storage.sql.exec(
        "UPDATE reservation SET state='released',close_reason=?,updated_at=? WHERE request_id=?",
        reason,
        now,
        requestId,
      );
      receipt = {
        requestId,
        state: 'released',
        charged: false,
        expiresAt: new Date(row.deadline).toISOString(),
      };
    });
    await this.scheduleNextAlarm();
    return receipt;
  }

  async readReceipt(requestId: string): Promise<SettlementReceipt | null> {
    if (!validId(requestId)) throw new BillingCommandError('invalid_reservation');
    const row = this.reservation(requestId);
    return row ? settlement(row) : null;
  }

  async compensate(
    requestId: string,
    operationId: string,
    reason: string,
  ): Promise<SettlementReceipt> {
    if (!validId(requestId) || !validId(operationId) || !validReason(reason)) {
      throw new BillingCommandError('invalid_compensation');
    }
    const payload = JSON.stringify({ kind: 'compensate', requestId, reason });
    const prior = this.operationalReceipt(operationId, payload);
    if (prior) return prior;
    const now = Date.now();
    let receipt!: SettlementReceipt;
    this.ctx.storage.transactionSync(() => {
      const row = this.requiredReservation(requestId);
      if (row.state !== 'committed') throw new BillingCommandError('not_committed');
      this.moveUsed(row, -1);
      this.ctx.storage.sql.exec(
        "UPDATE reservation SET state='compensated',close_reason=?,updated_at=? WHERE request_id=?",
        reason,
        now,
        requestId,
      );
      receipt = {
        requestId,
        state: 'compensated',
        charged: false,
        expiresAt: new Date(row.deadline).toISOString(),
      };
      this.saveOperational(operationId, payload, receipt, now);
    });
    return receipt;
  }

  async unlockMissingAcks(
    operationId: string,
    actor: string,
    reason: string,
  ): Promise<{ unlocked: number }> {
    if (!validId(operationId) || !validReason(actor) || !validReason(reason)) {
      throw new BillingCommandError('invalid_unlock');
    }
    const payload = JSON.stringify({ kind: 'unlockMissingAcks', actor, reason });
    const prior = this.operationalJson<{ unlocked: number }>(operationId, payload);
    if (prior) return prior;
    const now = Date.now();
    let receipt!: { unlocked: number };
    this.ctx.storage.transactionSync(() => {
      const count = this.ctx.storage.sql.exec('SELECT count(*) AS count FROM missed_ack').one() as {
        count: number;
      };
      this.ctx.storage.sql.exec('DELETE FROM missed_ack');
      receipt = { unlocked: count.count };
      this.saveOperational(operationId, payload, receipt, now);
    });
    return receipt;
  }

  async setKeyRevoked(
    keyHash: string,
    revoked: boolean,
    operationId: string,
    actor: string,
    reason: string,
  ): Promise<{ keyHash: string; revoked: boolean }> {
    if (
      !/^[a-f0-9]{64}$/.test(keyHash) ||
      !validId(operationId) ||
      !validReason(actor) ||
      !validReason(reason)
    ) {
      throw new BillingCommandError('invalid_key_command');
    }
    const payload = JSON.stringify({ kind: 'setKeyRevoked', keyHash, revoked, actor, reason });
    const prior = this.operationalJson<{ keyHash: string; revoked: boolean }>(operationId, payload);
    if (prior) return prior;
    const receipt = { keyHash, revoked };
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      if (revoked) {
        this.ctx.storage.sql.exec(
          `INSERT INTO revoked_key(key_hash,revoked_at,actor,reason) VALUES(?,?,?,?)
           ON CONFLICT(key_hash) DO UPDATE SET revoked_at=excluded.revoked_at,actor=excluded.actor,reason=excluded.reason`,
          keyHash,
          now,
          actor,
          reason,
        );
        this.releaseKeyPending(keyHash, now, 'key_revoked');
      } else {
        this.ctx.storage.sql.exec('DELETE FROM revoked_key WHERE key_hash=?', keyHash);
      }
      this.saveOperational(operationId, payload, receipt, now);
    });
    if (revoked) await this.scheduleNextAlarm();
    return receipt;
  }

  async isKeyRevoked(keyHash: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(keyHash)) return true;
    return (
      this.ctx.storage.sql
        .exec('SELECT 1 AS revoked FROM revoked_key WHERE key_hash=?', keyHash)
        .toArray().length > 0
    );
  }

  async alarm(): Promise<void> {
    this.ctx.storage.transactionSync(() => this.cleanupExpired(Date.now(), 100));
    await this.scheduleNextAlarm();
  }

  private reservation(requestId: string): ReservationRow | undefined {
    return this.ctx.storage.sql
      .exec(
        `SELECT request_id,group_name,state,source_kind,source_id,day_key,token_hash,deadline
       FROM reservation WHERE request_id=?`,
        requestId,
      )
      .toArray()[0] as ReservationRow | undefined;
  }

  private requiredReservation(requestId: string): ReservationRow {
    const row = this.reservation(requestId);
    if (!row) throw new BillingCommandError('reservation_not_found');
    return row;
  }

  private maxInflight(group: QuotaGroup): number {
    const raw =
      group === 'places' ? this.env.MAX_INFLIGHT_PLACES : this.env.MAX_INFLIGHT_DIRECTIONS;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : MAX_INFLIGHT_DEFAULT[group];
  }

  private insertReservation(
    requestId: string,
    group: QuotaGroup,
    sourceKind: 'period' | 'credit',
    sourceId: string,
    dayKey: string,
    now: number,
    keyHash?: string,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO reservation(request_id,group_name,key_hash,state,source_kind,source_id,day_key,deadline,created_at,updated_at)
       VALUES(?,?,?,'reserved',?,?,?,?,?,?)`,
      requestId,
      group,
      keyHash ?? null,
      sourceKind,
      sourceId,
      dayKey,
      now + PROCESSING_DEADLINE_MS,
      now,
      now,
    );
  }

  private moveReserved(row: ReservationRow, delta: number): void {
    if (row.source_kind === 'period') {
      this.ctx.storage.sql.exec(
        'UPDATE counter SET reserved=reserved+? WHERE source_id=? AND group_name=? AND day_key=?',
        delta,
        row.source_id,
        row.group_name,
        row.day_key,
      );
    } else {
      this.ctx.storage.sql.exec(
        'UPDATE credit_grant SET reserved=reserved+? WHERE grant_id=?',
        delta,
        row.source_id,
      );
    }
  }

  private moveUsed(row: ReservationRow, delta: number): void {
    if (row.source_kind === 'period') {
      this.ctx.storage.sql.exec(
        'UPDATE counter SET used=used+? WHERE source_id=? AND group_name=? AND day_key=?',
        delta,
        row.source_id,
        row.group_name,
        row.day_key,
      );
    } else {
      this.ctx.storage.sql.exec(
        'UPDATE credit_grant SET used=used+? WHERE grant_id=?',
        delta,
        row.source_id,
      );
    }
  }

  private cleanupExpired(now: number, limit: number): void {
    const expired = this.ctx.storage.sql
      .exec(
        `SELECT request_id,group_name,state,source_kind,source_id,day_key,token_hash,deadline
       FROM reservation WHERE state IN ('reserved','awaiting_ack') AND deadline<=?
       ORDER BY deadline LIMIT ?`,
        now,
        limit,
      )
      .toArray() as ReservationRow[];
    for (const row of expired) {
      this.moveReserved(row, -1);
      this.ctx.storage.sql.exec(
        "UPDATE reservation SET state='expired',close_reason='lease_expired',updated_at=? WHERE request_id=?",
        now,
        row.request_id,
      );
      if (row.state === 'awaiting_ack') {
        this.ctx.storage.sql.exec(
          'INSERT OR IGNORE INTO missed_ack(request_id,expired_at) VALUES(?,?)',
          row.request_id,
          now,
        );
      }
    }
    const retention = now - CLOSED_RETENTION_MS;
    this.ctx.storage.sql.exec(
      `DELETE FROM reservation WHERE request_id IN (
         SELECT request_id FROM reservation
         WHERE state IN ('released','expired','compensated') AND updated_at<?
         ORDER BY updated_at LIMIT ?
       )`,
      retention,
      limit,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM missed_ack WHERE request_id IN (
         SELECT request_id FROM missed_ack WHERE expired_at<=? ORDER BY expired_at LIMIT ?
       )`,
      now - MISSING_ACK_WINDOW_MS,
      limit,
    );
  }

  private releaseAllPending(now: number, reason: string): void {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT request_id,group_name,state,source_kind,source_id,day_key,token_hash,deadline
       FROM reservation WHERE state IN ('reserved','awaiting_ack')`,
      )
      .toArray() as ReservationRow[];
    this.releasePendingRows(rows, now, reason);
  }

  private releaseKeyPending(keyHash: string, now: number, reason: string): void {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT request_id,group_name,state,source_kind,source_id,day_key,token_hash,deadline
       FROM reservation WHERE key_hash=? AND state IN ('reserved','awaiting_ack')`,
        keyHash,
      )
      .toArray() as ReservationRow[];
    this.releasePendingRows(rows, now, reason);
  }

  private releasePendingRows(rows: ReservationRow[], now: number, reason: string): void {
    for (const row of rows) {
      this.moveReserved(row, -1);
      this.ctx.storage.sql.exec(
        "UPDATE reservation SET state='released',close_reason=?,updated_at=? WHERE request_id=?",
        reason,
        now,
        row.request_id,
      );
    }
  }

  private async scheduleNextAlarm(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec(
        "SELECT min(deadline) AS deadline FROM reservation WHERE state IN ('reserved','awaiting_ack')",
      )
      .one() as { deadline: number | null };
    const current = await this.ctx.storage.getAlarm();
    if (next.deadline === null) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
    } else if (current !== next.deadline) {
      await this.ctx.storage.setAlarm(next.deadline);
    }
  }

  private operationalJson<T>(operationId: string, payload: string): T | undefined {
    const row = this.ctx.storage.sql
      .exec(
        'SELECT payload,receipt_json FROM operational_command WHERE operation_id=?',
        operationId,
      )
      .toArray()[0] as { payload: string; receipt_json: string } | undefined;
    if (!row) return undefined;
    if (row.payload !== payload) throw new BillingCommandError('operation_conflict');
    return JSON.parse(row.receipt_json) as T;
  }

  private operationalReceipt(operationId: string, payload: string): SettlementReceipt | undefined {
    return this.operationalJson<SettlementReceipt>(operationId, payload);
  }

  private saveOperational(
    operationId: string,
    payload: string,
    receipt: unknown,
    now: number,
  ): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO operational_command(operation_id,payload,receipt_json,created_at) VALUES(?,?,?,?)',
      operationId,
      payload,
      JSON.stringify(receipt),
      now,
    );
  }

  private entitlement(): EntitlementRow | undefined {
    return this.ctx.storage.sql
      .exec('SELECT tenant_id,status,tier,revision,trial_used_once FROM entitlement WHERE id=1')
      .toArray()[0] as EntitlementRow | undefined;
  }

  private currentPeriod(now: number): PeriodRow | undefined {
    return this.ctx.storage.sql
      .exec(
        'SELECT period_id,tier,starts_at,ends_at,places_limit,directions_limit FROM period WHERE starts_at <= ? AND ends_at > ? ORDER BY starts_at DESC LIMIT 1',
        now,
        now,
      )
      .toArray()[0] as PeriodRow | undefined;
  }

  private groupUsage(period: PeriodRow | undefined, group: 'places' | 'directions'): GroupUsage {
    if (!period) return { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 };
    const aggregate = this.ctx.storage.sql
      .exec(
        'SELECT coalesce(sum(used),0) AS used, coalesce(sum(reserved),0) AS reserved FROM counter WHERE source_id=? AND group_name=?',
        period.period_id,
        group,
      )
      .one() as { used: number; reserved: number };
    const credits = this.ctx.storage.sql
      .exec(
        'SELECT coalesce(sum(units-used-reserved),0) AS credits FROM credit_grant WHERE period_id=? AND group_name=? AND expires_at>?',
        period.period_id,
        group,
        Date.now(),
      )
      .one() as { credits: number };
    const limit = group === 'places' ? period.places_limit : period.directions_limit;
    return {
      limit,
      used: aggregate.used,
      reserved: aggregate.reserved,
      credits: credits.credits,
      available: Math.max(0, limit - aggregate.used - aggregate.reserved) + credits.credits,
    };
  }
}

function emptyUsage(): UsageSnapshot {
  const group = { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 };
  return {
    tenantId: '',
    status: 'none',
    tier: null,
    revision: 0,
    periodId: null,
    startsAt: null,
    endsAt: null,
    trialUsedOnce: false,
    places: { ...group },
    directions: { ...group },
  };
}

function settlement(row: ReservationRow): SettlementReceipt {
  return {
    requestId: row.request_id,
    state: row.state,
    charged: row.state === 'committed',
    expiresAt: new Date(row.deadline).toISOString(),
  };
}

function denied(
  group: QuotaGroup,
  reason: Extract<ReserveResult, { allowed: false }>['reason'],
): ReserveResult {
  return { allowed: false, reason, group, resetAt: null };
}

function validId(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function validReason(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 500;
}

function validHash(value: string): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function nextVnDay(now: number): string {
  const day = vnBillingDay(new Date(now));
  return new Date(Date.parse(`${day}T17:00:00.000Z`)).toISOString();
}
