import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { PLAN_CATALOG } from './catalog';
import { BillingCommandError, businessHash, commandHash, validateCommand } from './commands';
import { initializeLedger, SNAPSHOT_TABLES, type SnapshotTable } from './ledger';
import { trialEndsAt, vnBillingDay } from './policy';
import type {
  CheckpointReceipt,
  CommandReceipt,
  EntitlementCommand,
  EntitlementStatus,
  GroupUsage,
  JournalEntry,
  JournalPage,
  MissingAcks,
  PeriodGroupUsage,
  PeriodHistory,
  QuotaGroup,
  ReserveResult,
  RestoreReceipt,
  SettlementReceipt,
  SnapshotManifest,
  SnapshotPage,
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
/** Đổi số này khi hình dạng bản ghi sao lưu đổi; bản cũ hơn bị từ chối nạp lại. */
const LEDGER_SCHEMA_VERSION = 1;
const SNAPSHOT_MAX_RECORDS = 100;
const SNAPSHOT_MAX_BYTES = 256 * 1024;
/**
 * Trần cho TOÀN BỘ snapshot. Snapshot được dựng trong MỘT transaction để nhất quán, nên nó nằm
 * trọn trong RAM một lúc: thà từ chối và bắt dọn retention còn hơn giết object lúc đang phục hồi.
 */
const SNAPSHOT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
/**
 * Reservation đã đóng trong cửa sổ này vẫn đi vào snapshot: ACK/replay đến muộn phải gặp lại
 * dòng cũ để bị từ chối, thay vì thấy "không có receipt" rồi bị tính thành lượt mới.
 */
const SNAPSHOT_RESERVATION_WINDOW_MS = 4 * LEASE_MS;
/**
 * Khoảng lặng bắt buộc trước khi ghi đè sổ. Không phải lời hứa của người vận hành mà là BẰNG
 * CHỨNG: object tự nhìn reservation gần nhất của chính nó để biết traffic đã thật sự dừng chưa.
 */
const RESTORE_QUIET_MS = 60_000;
/** Trần dòng journal cắt trong một lần chốt checkpoint; phần dư để alarm dọn nốt. */
const JOURNAL_PRUNE_BATCH = 1_000;

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
  key_hash?: string | null;
  state: SettlementReceipt['state'];
  source_kind: 'period' | 'credit';
  source_id: string;
  day_key: string;
  token_hash: string | null;
  deadline: number;
};

export class QuotaObject extends DurableObject<Env> {
  /**
   * Khác null khi đang phát lại journal: dòng journal sinh ra phải giữ NGUYÊN số thứ tự cũ thay
   * vì xin số mới, nếu không bản phục hồi sẽ đánh số lệch bản gốc. Chỉ có hiệu lực trong bảo
   * trì, nơi `reserve` đã bị chặn và mọi chỗ giữ đã được nhả.
   */
  private replaySequence: number | null = null;

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
        if (entitlement?.status !== 'active' || entitlement.tier === 'trial') {
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
      this.appendJournal('command', command.operationId, { command }, now);
    });
    if (command.kind === 'suspend') await this.scheduleNextAlarm();
    return receipt;
  }

  /**
   * Vòng gọi RPC KHÔNG chạm storage. Chỉ để chẩn đoán, bật bằng var `QUOTA_PROBE`.
   *
   * Tách bạch hai nguyên nhân mà số tổng không phân biệt được: nếu `ping` cũng tốn ~250 ms thì
   * chi phí nằm ở đường mạng tới object; nếu `ping` vài mili-giây mà `reserve`/`prepare` vẫn
   * ~250 ms thì chi phí nằm ở việc chờ ghi bền vững, và đổi vị trí object sẽ không cứu được.
   */
  async ping(): Promise<number> {
    return Date.now();
  }

  async readUsage(): Promise<UsageSnapshot> {
    const now = Date.now();
    // Đọc TRƯỚC nhánh `!entitlement`: một tenant chưa có gói vẫn có thể đang mang khoá
    // `ack_required` từ trước, và đó đúng là lúc người trực cần thấy nó nhất.
    const missingAcks = this.missingAcks(now);
    const entitlement = this.entitlement();
    if (!entitlement) return { ...emptyUsage(), maintenance: this.maintenance(), missingAcks };
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
      maintenance: this.maintenance(),
      missingAcks,
      places: this.groupUsage(period, 'places'),
      directions: this.groupUsage(period, 'directions'),
    };
  }

  /**
   * Cửa sổ trượt của khoá `ack_required`. CHỈ ĐỌC, và chỉ `readUsage()` (route admin) gọi — không
   * nằm trên đường nóng của request khách, nên một COUNT có index là giá chấp nhận được.
   */
  private missingAcks(now: number): MissingAcks {
    const tuLuc = now - MISSING_ACK_WINDOW_MS;
    const { count } = this.ctx.storage.sql
      .exec('SELECT count(*) AS count FROM missed_ack WHERE expired_at > ?', tuLuc)
      .one() as { count: number };
    if (count < MAX_MISSING_ACK) {
      return { count, limit: MAX_MISSING_ACK, locked: false, opensAt: null };
    }
    // Khoá mở khi cửa sổ tụt xuống DƯỚI ngưỡng, tức khi dòng thứ `count - limit + 1` tính từ cũ
    // nhất trôi ra. Đang dư hơn ngưỡng mà lấy `min(expired_at)` là hứa sớm hơn sự thật.
    const row = this.ctx.storage.sql
      .exec(
        'SELECT expired_at FROM missed_ack WHERE expired_at > ? ORDER BY expired_at LIMIT 1 OFFSET ?',
        tuLuc,
        count - MAX_MISSING_ACK,
      )
      .one() as { expired_at: number };
    return {
      count,
      limit: MAX_MISSING_ACK,
      locked: true,
      opensAt: new Date(row.expired_at + MISSING_ACK_WINDOW_MS).toISOString(),
    };
  }

  /**
   * Lịch sử kỳ và credit cho màn Gói cước & hạn mức. CHỈ ĐỌC: không mở transaction, không ghi
   * journal, không đụng alarm — gọi bao nhiêu lần cũng không đổi revision.
   *
   * Không gộp vào `readUsage()`: hai màn khác nhau, và quét cả bảng `period`/`credit_grant` cho
   * mỗi lần mở màn Gói cước là việc thừa. (`readUsage()` KHÔNG nằm trên đường nóng của request
   * khách — chỉ route `/v1/admin/billing/:tenantId/usage` gọi nó.)
   */
  async readPeriods(limit = 24): Promise<PeriodHistory> {
    const gioiHan = Math.min(Math.max(Math.trunc(Number(limit)) || 24, 1), 60);
    const sql = this.ctx.storage.sql;

    const periods = sql
      .exec(
        `SELECT period_id, tier, starts_at, ends_at, places_limit, directions_limit,
                payment_reference, line_item_id
           FROM period ORDER BY starts_at DESC LIMIT ?`,
        gioiHan,
      )
      .toArray() as unknown as {
      period_id: string;
      tier: Tier;
      starts_at: number;
      ends_at: number;
      places_limit: number;
      directions_limit: number;
      payment_reference: string | null;
      line_item_id: string | null;
    }[];

    // Gộp một lần cho cả bảng rồi ghép trong bộ nhớ: `counter` có thêm chiều ngày cho kỳ dùng thử
    // (day_key), nên phải SUM chứ không đọc thẳng một dòng — đọc thẳng sẽ chỉ ra số của một ngày.
    const dem = sql
      .exec(
        `SELECT source_id, group_name, coalesce(sum(used),0) AS used,
                coalesce(sum(reserved),0) AS reserved
           FROM counter GROUP BY source_id, group_name`,
      )
      .toArray() as unknown as {
      source_id: string;
      group_name: string;
      used: number;
      reserved: number;
    }[];

    const tra = (periodId: string, group: QuotaGroup, limitValue: number): PeriodGroupUsage => {
      const row = dem.find((item) => item.source_id === periodId && item.group_name === group);
      return { limit: limitValue, used: row?.used ?? 0, reserved: row?.reserved ?? 0 };
    };

    const credits = sql
      .exec(
        `SELECT grant_id, period_id, group_name, units, used, reserved, expires_at,
                payment_reference, line_item_id
           FROM credit_grant ORDER BY expires_at DESC LIMIT ?`,
        gioiHan * 4,
      )
      .toArray() as unknown as {
      grant_id: string;
      period_id: string;
      group_name: QuotaGroup;
      units: number;
      used: number;
      reserved: number;
      expires_at: number;
      payment_reference: string;
      line_item_id: string;
    }[];

    return {
      periods: periods.map((row) => ({
        periodId: row.period_id,
        tier: row.tier,
        startsAt: new Date(row.starts_at).toISOString(),
        endsAt: new Date(row.ends_at).toISOString(),
        paymentReference: row.payment_reference,
        lineItemId: row.line_item_id,
        places: tra(row.period_id, 'places', row.places_limit),
        directions: tra(row.period_id, 'directions', row.directions_limit),
      })),
      credits: credits.map((row) => ({
        grantId: row.grant_id,
        periodId: row.period_id,
        group: row.group_name,
        units: row.units,
        used: row.used,
        reserved: row.reserved,
        expiresAt: new Date(row.expires_at).toISOString(),
        paymentReference: row.payment_reference,
        lineItemId: row.line_item_id,
      })),
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
      // Khoá bị thu hồi đứng ĐẦU TIÊN: đây là câu hỏi về danh tính người gọi, cơ bản hơn mọi câu
      // hỏi về hạn mức. Trước 15/09/2026 phép kiểm này là một vòng gọi RPC riêng trong `auth.ts`;
      // đo trên production cho thấy nó tốn ~126 ms — đúng bằng một vòng mạng tới object — nên gộp
      // vào đây, nơi transaction đã mở sẵn và không tốn thêm vòng nào.
      if (keyHash !== undefined && this.keyRevoked(keyHash)) {
        result = denied(group, 'key_revoked');
        return;
      }
      // Bảo trì đứng TRƯỚC cả reservation đang có: lúc sổ đang được ghi đè thì không lượt nào
      // được cấp thêm, kể cả lượt retry cùng requestId của một request đang dở.
      if (this.maintenance()) {
        result = denied(group, 'maintenance');
        return;
      }
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
      // Khoá bị thu hồi giữa lúc receipt còn treo: spec mục 6 chọn cho receipt hết hạn và KHÔNG
      // tính tiền. Kiểm ở đây vì `auth.ts` không còn gọi `isKeyRevoked` cho route dữ liệu nữa.
      if (row.key_hash && this.keyRevoked(row.key_hash)) {
        throw new BillingCommandError('key_revoked');
      }
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
      // Đây là dòng journal DUY NHẤT nằm trên đường nóng, và nó đi kèm đúng lúc lượt được tính
      // tiền. reserve/prepare/release không ghi journal: chúng chỉ động tới `reserved`, mà
      // `reserved` không được phục hồi — sau khôi phục mọi chỗ đang giữ đều nhả về cho khách.
      this.appendJournal(
        'commit',
        requestId,
        {
          group: row.group_name,
          sourceKind: row.source_kind,
          sourceId: row.source_id,
          dayKey: row.day_key,
          deadline: row.deadline,
        },
        now,
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
      this.appendJournal(
        'compensate',
        requestId,
        {
          operationId,
          reason,
          group: row.group_name,
          sourceKind: row.source_kind,
          sourceId: row.source_id,
          dayKey: row.day_key,
        },
        now,
      );
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
      this.appendJournal('unlockAcks', operationId, { actor, reason }, now);
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
      this.appendJournal('keyRevocation', operationId, { keyHash, revoked, actor, reason }, now);
      this.saveOperational(operationId, payload, receipt, now);
    });
    if (revoked) await this.scheduleNextAlarm();
    return receipt;
  }

  /**
   * Giữ lại cho công cụ vận hành và test. Đường nóng KHÔNG dùng: mỗi lời gọi là một vòng mạng
   * tới object, đo được ~126 ms trên production — `reserve` và `ack` tự kiểm bằng `keyRevoked`.
   */
  async isKeyRevoked(keyHash: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(keyHash)) return true;
    return this.keyRevoked(keyHash);
  }

  /** Bản đồng bộ, gọi được bên trong transaction. */
  private keyRevoked(keyHash: string): boolean {
    return (
      this.ctx.storage.sql
        .exec('SELECT 1 AS revoked FROM revoked_key WHERE key_hash=?', keyHash)
        .toArray().length > 0
    );
  }

  /**
   * Đóng/mở sổ để phục hồi. Đây là cổng DUY NHẤT cho phép ghi đè ledger: không có nó thì
   * `restore*` luôn từ chối, nên không ai lỡ tay nạp backup lên một object đang bán hàng.
   */
  async setMaintenance(
    operationId: string,
    actor: string,
    reason: string,
    enabled: boolean,
  ): Promise<{ maintenance: boolean }> {
    if (
      !validId(operationId) ||
      !validReason(actor) ||
      !validReason(reason) ||
      typeof enabled !== 'boolean'
    ) {
      throw new BillingCommandError('invalid_maintenance');
    }
    const payload = JSON.stringify({ kind: 'setMaintenance', enabled, actor, reason });
    const prior = this.operationalJson<{ maintenance: boolean }>(operationId, payload);
    if (prior) return prior;
    const now = Date.now();
    const receipt = { maintenance: enabled };
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO ledger_meta(id,last_sequence,schema_version,maintenance) VALUES(1,0,?,?)
         ON CONFLICT(id) DO UPDATE SET maintenance=excluded.maintenance`,
        LEDGER_SCHEMA_VERSION,
        enabled ? 1 : 0,
      );
      // Vào bảo trì thì nhả hết chỗ đang giữ. Receipt còn treo mà sổ bị ghi đè sẽ thành khoản
      // không đối soát được; nhả ra là sai số nghiêng về phía khách, đúng quyết định mục 6.
      if (enabled) this.releaseAllPending(now, 'maintenance');
      this.saveOperational(operationId, payload, receipt, now);
    });
    await this.scheduleNextAlarm();
    return receipt;
  }

  /**
   * Đóng băng một snapshot nhất quán rồi cắt thành trang. Toàn bộ việc đọc nằm trong MỘT
   * transaction: xuất từng bảng bằng nhiều lần đọc rời sẽ cho ra bản sao chắp vá, nơi `counter`
   * đã cộng một lượt mà `reservation` thì chưa — nạp lại bản đó là tính tiền sai.
   */
  async beginSnapshot(operationId: string, actor: string): Promise<SnapshotManifest> {
    if (!validId(operationId) || !validReason(actor))
      throw new BillingCommandError('invalid_snapshot');
    const existing = this.manifestRow(operationId);
    if (existing?.checksum) {
      return {
        snapshotId: operationId,
        tenantId: existing.tenant_id,
        schemaVersion: existing.schema_version,
        sequence: existing.sequence,
        pages: existing.pages,
        records: existing.records,
        checksum: existing.checksum,
        takenAt: new Date(existing.taken_at).toISOString(),
      };
    }

    const now = Date.now();
    let pages: string[] = [];
    let records = 0;
    let sequence = 0;
    let tenantId = '';
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM snapshot_page WHERE snapshot_id=?', operationId);
      this.ctx.storage.sql.exec('DELETE FROM snapshot_manifest WHERE snapshot_id=?', operationId);
      const collected = this.collectRecords(now);
      records = collected.length;
      pages = paginate(collected);
      sequence = this.lastSequence();
      tenantId = this.entitlement()?.tenant_id ?? '';
      pages.forEach((text, index) => {
        this.ctx.storage.sql.exec(
          'INSERT INTO snapshot_page(snapshot_id,page_index,records) VALUES(?,?,?)',
          operationId,
          index,
          text,
        );
      });
      this.ctx.storage.sql.exec(
        `INSERT INTO snapshot_manifest(snapshot_id,tenant_id,schema_version,sequence,pages,records,actor,taken_at)
         VALUES(?,?,?,?,?,?,?,?)`,
        operationId,
        tenantId,
        LEDGER_SCHEMA_VERSION,
        sequence,
        pages.length,
        records,
        actor,
        now,
      );
    });

    // Băm NGOÀI transaction vì WebCrypto là async còn `transactionSync` thì không chờ được.
    // Trang đã đóng băng trong bảng nên băm sau vẫn đúng chuỗi byte sẽ giao cho người gọi.
    const checksums: string[] = [];
    for (const [index, text] of pages.entries()) {
      const checksum = await sha256(text);
      checksums.push(checksum);
      this.ctx.storage.sql.exec(
        'UPDATE snapshot_page SET checksum=? WHERE snapshot_id=? AND page_index=?',
        checksum,
        operationId,
        index,
      );
    }
    const checksum = await sha256(
      JSON.stringify({
        schemaVersion: LEDGER_SCHEMA_VERSION,
        tenantId,
        sequence,
        records,
        pages: checksums,
      }),
    );
    this.ctx.storage.sql.exec(
      'UPDATE snapshot_manifest SET checksum=? WHERE snapshot_id=?',
      checksum,
      operationId,
    );
    return {
      snapshotId: operationId,
      tenantId,
      schemaVersion: LEDGER_SCHEMA_VERSION,
      sequence,
      pages: pages.length,
      records,
      checksum,
      takenAt: new Date(now).toISOString(),
    };
  }

  async readSnapshotPage(snapshotId: string, index: number): Promise<SnapshotPage> {
    if (!validId(snapshotId) || !Number.isSafeInteger(index) || index < 0) {
      throw new BillingCommandError('invalid_snapshot');
    }
    const manifest = this.manifestRow(snapshotId);
    if (!manifest) throw new BillingCommandError('snapshot_not_found');
    const row = this.ctx.storage.sql
      .exec(
        'SELECT records,checksum FROM snapshot_page WHERE snapshot_id=? AND page_index=?',
        snapshotId,
        index,
      )
      .toArray()[0] as { records: string; checksum: string | null } | undefined;
    if (!row || row.checksum === null) throw new BillingCommandError('snapshot_not_found');
    return {
      snapshotId,
      index,
      pages: manifest.pages,
      sequence: manifest.sequence,
      records: row.records,
      checksum: row.checksum,
    };
  }

  /** Đuôi ghi sau snapshot. `pending` cho biết còn bao nhiêu khoản CHƯA có bản sao lưu nào. */
  async readJournal(afterSequence: number, limit: number): Promise<JournalPage> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new BillingCommandError('invalid_journal');
    }
    const size =
      Number.isSafeInteger(limit) && limit > 0
        ? Math.min(limit, SNAPSHOT_MAX_RECORDS)
        : SNAPSHOT_MAX_RECORDS;
    const rows = this.ctx.storage.sql
      .exec(
        'SELECT seq,kind,ref,payload,created_at FROM journal WHERE seq>? ORDER BY seq LIMIT ?',
        afterSequence,
        size,
      )
      .toArray() as {
      seq: number;
      kind: JournalEntry['kind'];
      ref: string;
      payload: string;
      created_at: number;
    }[];
    const entries: JournalEntry[] = rows.map((row) => ({
      seq: row.seq,
      kind: row.kind,
      ref: row.ref,
      payload: row.payload,
      createdAt: new Date(row.created_at).toISOString(),
    }));
    const nextSequence = entries.at(-1)?.seq ?? afterSequence;
    const pending = this.ctx.storage.sql
      .exec('SELECT count(*) AS count FROM journal WHERE seq>?', nextSequence)
      .one() as { count: number };
    return { entries, nextSequence, pending: pending.count };
  }

  /**
   * Chốt rằng mọi khoản tới `sequence` đã nằm trong một bản sao lưu bền vững, rồi mới cắt đuôi
   * journal. Người gọi phải đưa lại checksum của chính chuỗi byte đã ghi: chốt trước khi R2 nhận
   * xong là cách chắc chắn nhất để mất đúng phần vừa xoá.
   */
  async advanceCheckpoint(
    operationId: string,
    snapshotId: string,
    checksum: string,
  ): Promise<CheckpointReceipt> {
    if (!validId(operationId) || !validId(snapshotId) || !validHash(checksum)) {
      throw new BillingCommandError('invalid_checkpoint');
    }
    const payload = JSON.stringify({ kind: 'advanceCheckpoint', snapshotId, checksum });
    const prior = this.operationalJson<CheckpointReceipt>(operationId, payload);
    if (prior) return prior;
    const manifest = this.manifestRow(snapshotId);
    if (!manifest || manifest.checksum === null)
      throw new BillingCommandError('snapshot_not_found');
    if (manifest.checksum !== checksum) throw new BillingCommandError('checksum_mismatch');
    const now = Date.now();
    let receipt!: CheckpointReceipt;
    this.ctx.storage.transactionSync(() => {
      const current = this.ctx.storage.sql
        .exec('SELECT sequence FROM export_checkpoint WHERE id=1')
        .toArray()[0] as { sequence: number } | undefined;
      if ((current?.sequence ?? 0) > manifest.sequence) {
        throw new BillingCommandError('checkpoint_stale');
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO export_checkpoint(id,sequence,checksum,exported_at) VALUES(1,?,?,?)
         ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence,checksum=excluded.checksum,exported_at=excluded.exported_at`,
        manifest.sequence,
        checksum,
        now,
      );
      // Cắt journal theo LÔ CÓ TRẦN. Một ngày lưu lượng gói Business là hàng chục nghìn dòng;
      // `DELETE` không giới hạn ở đây là một câu lệnh khổng lồ trong transaction, đúng kiểu
      // "quét cả lịch sử" mà spec 14.7 cấm. Phần dư do alarm dọn nốt.
      const pruned = this.pruneJournal(manifest.sequence, JOURNAL_PRUNE_BATCH);
      this.ctx.storage.sql.exec('DELETE FROM snapshot_page WHERE snapshot_id=?', snapshotId);
      this.ctx.storage.sql.exec('DELETE FROM snapshot_manifest WHERE snapshot_id=?', snapshotId);
      receipt = {
        sequence: manifest.sequence,
        checksum,
        exportedAt: new Date(now).toISOString(),
        prunedEntries: pruned,
      };
      this.saveOperational(operationId, payload, receipt, now);
    });
    return receipt;
  }

  async restoreSnapshotPage(
    operationId: string,
    snapshotId: string,
    page: SnapshotPage,
  ): Promise<RestoreReceipt> {
    if (!validId(operationId) || !validId(snapshotId) || !page || page.snapshotId !== snapshotId) {
      throw new BillingCommandError('invalid_restore');
    }
    const payload = JSON.stringify({
      kind: 'restoreSnapshotPage',
      snapshotId,
      index: page.index,
      checksum: page.checksum,
    });
    const prior = this.operationalJson<RestoreReceipt>(operationId, payload);
    if (prior) return prior;
    this.requireMaintenance();
    this.requireFreshSnapshot(page.sequence);
    this.requireQuiet();
    if (!validHash(page.checksum) || (await sha256(page.records)) !== page.checksum) {
      throw new BillingCommandError('checksum_mismatch');
    }
    let parsed: { table: string; data: Record<string, string | number | null> }[];
    try {
      parsed = JSON.parse(page.records);
    } catch {
      throw new BillingCommandError('invalid_restore');
    }
    if (!Array.isArray(parsed)) throw new BillingCommandError('invalid_restore');
    const now = Date.now();
    let receipt!: RestoreReceipt;
    this.ctx.storage.transactionSync(() => {
      this.requireMaintenance();
      this.requireFreshSnapshot(page.sequence);
      for (const record of parsed) {
        if (!SNAPSHOT_TABLES.includes(record.table as SnapshotTable)) {
          throw new BillingCommandError('invalid_restore');
        }
        const columns = Object.keys(record.data ?? {});
        if (columns.length === 0 || columns.some((column) => !/^[a-z_]{1,40}$/.test(column))) {
          throw new BillingCommandError('invalid_restore');
        }
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO ${record.table}(${columns.join(',')})
           VALUES(${columns.map(() => '?').join(',')})`,
          ...columns.map((column) => record.data[column] ?? null),
        );
      }
      this.bumpSequence(page.sequence);
      receipt = { applied: parsed.length, skipped: 0, sequence: this.lastSequence() };
      this.saveOperational(operationId, payload, receipt, now);
    });
    return receipt;
  }

  /**
   * Phát lại đuôi journal lên trên snapshot. Kiểm liên tục số thứ tự TRƯỚC khi áp dòng nào:
   * thiếu một số nghĩa là thiếu một khoản đã tính tiền, và coi khoản thiếu đó bằng 0 chính là
   * kiểu hỏng mà mục 14.6 cấm. Thà dừng trong bảo trì để đối soát tay.
   */
  async restoreJournal(operationId: string, entries: JournalEntry[]): Promise<RestoreReceipt> {
    if (!validId(operationId) || !Array.isArray(entries) || entries.length > SNAPSHOT_MAX_RECORDS) {
      throw new BillingCommandError('invalid_restore');
    }
    const payload = JSON.stringify({
      kind: 'restoreJournal',
      from: entries[0]?.seq ?? null,
      to: entries.at(-1)?.seq ?? null,
    });
    const prior = this.operationalJson<RestoreReceipt>(operationId, payload);
    if (prior) return prior;
    this.requireMaintenance();
    const current = this.lastSequence();
    const first = entries[0];
    if (first) {
      if (!Number.isSafeInteger(first.seq) || first.seq < 1 || first.seq > current + 1) {
        throw new BillingCommandError('journal_gap');
      }
      for (let index = 1; index < entries.length; index += 1) {
        if (entries[index]?.seq !== (entries[index - 1]?.seq ?? 0) + 1) {
          throw new BillingCommandError('journal_gap');
        }
      }
    }
    let applied = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (await this.replayEntry(entry)) applied += 1;
      else skipped += 1;
    }
    const receipt: RestoreReceipt = { applied, skipped, sequence: this.lastSequence() };
    this.ctx.storage.transactionSync(() =>
      this.saveOperational(operationId, payload, receipt, Date.now()),
    );
    return receipt;
  }

  async alarm(): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.cleanupExpired(Date.now(), 100);
      // Dọn nốt phần journal đã có bản sao lưu. Không đặt ở `reserve`: đường nóng không nên gánh
      // thêm một DELETE cho việc mà alarm làm được.
      const checkpoint = this.ctx.storage.sql
        .exec('SELECT sequence FROM export_checkpoint WHERE id=1')
        .toArray()[0] as { sequence: number } | undefined;
      if (checkpoint) this.pruneJournal(checkpoint.sequence, 100);
    });
    await this.scheduleNextAlarm();
  }

  private reservation(requestId: string): ReservationRow | undefined {
    return this.ctx.storage.sql
      .exec(
        `SELECT request_id,group_name,key_hash,state,source_kind,source_id,day_key,token_hash,deadline
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

  /**
   * Một dòng sổ ghi thêm. Số thứ tự lấy trong CÙNG transaction với thay đổi nó mô tả, nên
   * transaction bị rollback thì số cũng không bị tiêu — đuôi journal luôn liền mạch, và một lỗ
   * thủng luôn có nghĩa là mất dữ liệu thật chứ không phải chuyện bình thường.
   */
  private appendJournal(kind: JournalEntry['kind'], ref: string, payload: unknown, now: number) {
    const text = JSON.stringify(payload);
    if (this.replaySequence !== null) {
      const seq = this.replaySequence;
      this.ctx.storage.sql.exec(
        'INSERT OR IGNORE INTO journal(seq,kind,ref,payload,created_at) VALUES(?,?,?,?,?)',
        seq,
        kind,
        ref,
        text,
        now,
      );
      this.bumpSequence(seq);
      return seq;
    }
    const row = this.ctx.storage.sql
      .exec(
        `INSERT INTO ledger_meta(id,last_sequence,schema_version) VALUES(1,1,?)
         ON CONFLICT(id) DO UPDATE SET last_sequence=ledger_meta.last_sequence+1
         RETURNING last_sequence`,
        LEDGER_SCHEMA_VERSION,
      )
      .one() as { last_sequence: number };
    this.ctx.storage.sql.exec(
      'INSERT INTO journal(seq,kind,ref,payload,created_at) VALUES(?,?,?,?,?)',
      row.last_sequence,
      kind,
      ref,
      text,
      now,
    );
    return row.last_sequence;
  }

  /** Trả true nếu dòng journal thật sự được áp, false nếu sổ đã có sẵn khoản đó. */
  private async replayEntry(entry: JournalEntry): Promise<boolean> {
    if (!validId(entry?.ref) || typeof entry.payload !== 'string') {
      throw new BillingCommandError('invalid_restore');
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(entry.payload) as Record<string, unknown>;
    } catch {
      throw new BillingCommandError('invalid_restore');
    }
    const now = Date.parse(entry.createdAt);
    const at = Number.isFinite(now) ? now : Date.now();
    this.replaySequence = entry.seq;
    try {
      if (entry.kind === 'command') {
        const seen = this.eventSeen(entry.ref);
        await this.applyCommand(payload.command as EntitlementCommand);
        return !seen;
      }
      if (entry.kind === 'keyRevocation') {
        const seen = this.operationSeen(entry.ref);
        await this.setKeyRevoked(
          String(payload.keyHash),
          payload.revoked === true,
          entry.ref,
          String(payload.actor),
          String(payload.reason),
        );
        return !seen;
      }
      if (entry.kind === 'unlockAcks') {
        const seen = this.operationSeen(entry.ref);
        await this.unlockMissingAcks(entry.ref, String(payload.actor), String(payload.reason));
        return !seen;
      }
      if (entry.kind !== 'commit' && entry.kind !== 'compensate') {
        throw new BillingCommandError('invalid_restore');
      }
      let changed = false;
      this.ctx.storage.transactionSync(() => {
        changed = this.replaySettlement(entry, payload, at);
      });
      return changed;
    } finally {
      this.replaySequence = null;
    }
  }

  private replaySettlement(
    entry: JournalEntry,
    payload: Record<string, unknown>,
    at: number,
  ): boolean {
    const target: ReservationRow = {
      request_id: entry.ref,
      group_name: payload.group as QuotaGroup,
      state: entry.kind === 'commit' ? 'committed' : 'compensated',
      source_kind: payload.sourceKind as 'period' | 'credit',
      source_id: String(payload.sourceId),
      day_key: String(payload.dayKey ?? ''),
      token_hash: null,
      deadline: Number(payload.deadline ?? at),
    };
    if (!['places', 'directions'].includes(target.group_name)) {
      throw new BillingCommandError('invalid_restore');
    }
    if (!['period', 'credit'].includes(target.source_kind)) {
      throw new BillingCommandError('invalid_restore');
    }
    const row = this.reservation(entry.ref);
    if (row?.state === target.state) return false;
    if (entry.kind === 'compensate' && row?.state !== 'committed') {
      throw new BillingCommandError('invalid_restore');
    }
    // Receipt còn treo trong snapshot đang giữ chỗ: trả chỗ trước rồi mới chuyển thành đã tính.
    if (row?.state === 'reserved' || row?.state === 'awaiting_ack') this.moveReserved(row, -1);
    this.ctx.storage.sql.exec(
      `INSERT INTO reservation(request_id,group_name,key_hash,state,source_kind,source_id,day_key,deadline,created_at,updated_at)
       VALUES(?,?,NULL,?,?,?,?,?,?,?)
       ON CONFLICT(request_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`,
      target.request_id,
      target.group_name,
      target.state,
      target.source_kind,
      target.source_id,
      target.day_key,
      target.deadline,
      at,
      at,
    );
    this.applyUsed(row ?? target, entry.kind === 'commit' ? 1 : -1);
    this.appendJournal(entry.kind, entry.ref, payload, at);
    return true;
  }

  /**
   * Như `moveUsed` nhưng tạo dòng counter nếu chưa có. Lượt được tính SAU khi snapshot đóng băng
   * có thể rơi vào một ngày/kỳ chưa từng xuất hiện trong bản sao lưu; `UPDATE` trơn sẽ lặng lẽ
   * không ghi gì và làm mất đúng khoản đó.
   */
  private applyUsed(row: ReservationRow, delta: number): void {
    if (row.source_kind === 'period') {
      this.ctx.storage.sql.exec(
        `INSERT INTO counter(source_id,group_name,day_key,used) VALUES(?,?,?,?)
         ON CONFLICT(source_id,group_name,day_key) DO UPDATE SET used=counter.used+excluded.used`,
        row.source_id,
        row.group_name,
        row.day_key,
        delta,
      );
    } else {
      this.ctx.storage.sql.exec(
        'UPDATE credit_grant SET used=used+? WHERE grant_id=?',
        delta,
        row.source_id,
      );
    }
  }

  private collectRecords(now: number): { table: SnapshotTable; data: unknown }[] {
    const out: { table: SnapshotTable; data: unknown }[] = [];
    for (const table of SNAPSHOT_TABLES) {
      const rows =
        table === 'reservation'
          ? // `key_hash` cố tình KHÔNG có trong danh sách cột: bản sao lưu không cần nó để dựng
            // lại số dư, nên không mang băm khoá của khách ra khỏi object.
            this.ctx.storage.sql
              .exec(
                `SELECT request_id,group_name,state,source_kind,source_id,day_key,token_hash,deadline,created_at,updated_at,close_reason
                 FROM reservation WHERE state IN ('reserved','awaiting_ack') OR updated_at>?
                 ORDER BY request_id`,
                now - SNAPSHOT_RESERVATION_WINDOW_MS,
              )
              .toArray()
          : this.ctx.storage.sql.exec(`SELECT * FROM ${table}`).toArray();
      for (const row of rows) out.push({ table, data: row });
    }
    return out;
  }

  private manifestRow(snapshotId: string) {
    return this.ctx.storage.sql
      .exec(
        'SELECT tenant_id,schema_version,sequence,pages,records,checksum,taken_at FROM snapshot_manifest WHERE snapshot_id=?',
        snapshotId,
      )
      .toArray()[0] as
      | {
          tenant_id: string;
          schema_version: number;
          sequence: number;
          pages: number;
          records: number;
          checksum: string | null;
          taken_at: number;
        }
      | undefined;
  }

  /**
   * Xoá tối đa `limit` dòng journal đã nằm trong một bản sao lưu bền vững. Trả số dòng đã xoá.
   * Chỉ cắt tới `sequence` của checkpoint — cắt xa hơn là vứt đi khoản chưa ai sao lưu.
   */
  private pruneJournal(sequence: number, limit: number): number {
    const rows = this.ctx.storage.sql
      .exec('SELECT seq FROM journal WHERE seq<=? ORDER BY seq LIMIT ?', sequence, limit)
      .toArray() as { seq: number }[];
    const last = rows.at(-1)?.seq;
    if (last === undefined) return 0;
    this.ctx.storage.sql.exec('DELETE FROM journal WHERE seq<=?', last);
    return rows.length;
  }

  private maintenance(): boolean {
    const row = this.ctx.storage.sql
      .exec('SELECT maintenance FROM ledger_meta WHERE id=1')
      .toArray()[0] as { maintenance: number } | undefined;
    return row?.maintenance === 1;
  }

  private lastSequence(): number {
    const row = this.ctx.storage.sql
      .exec('SELECT last_sequence FROM ledger_meta WHERE id=1')
      .toArray()[0] as { last_sequence: number } | undefined;
    return row?.last_sequence ?? 0;
  }

  private bumpSequence(sequence: number): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO ledger_meta(id,last_sequence,schema_version) VALUES(1,?,?)
       ON CONFLICT(id) DO UPDATE SET last_sequence=max(ledger_meta.last_sequence,excluded.last_sequence)`,
      sequence,
      LEDGER_SCHEMA_VERSION,
    );
  }

  private eventSeen(operationId: string): boolean {
    return (
      this.ctx.storage.sql
        .exec('SELECT 1 AS seen FROM entitlement_event WHERE operation_id=?', operationId)
        .toArray().length > 0
    );
  }

  private operationSeen(operationId: string): boolean {
    return (
      this.ctx.storage.sql
        .exec('SELECT 1 AS seen FROM operational_command WHERE operation_id=?', operationId)
        .toArray().length > 0
    );
  }

  private requireMaintenance(): void {
    if (!this.maintenance()) throw new BillingCommandError('not_in_maintenance');
  }

  private requireFreshSnapshot(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new BillingCommandError('invalid_restore');
    }
    // Sổ đã đi xa hơn bản sao lưu: nạp vào là xoá sạch mọi lượt tính giữa hai mốc.
    if (sequence < this.lastSequence()) throw new BillingCommandError('snapshot_stale');
  }

  /**
   * Bằng chứng traffic đã dừng, không phải lời hứa: object tự nhìn reservation gần nhất của
   * chính nó. Cổng admission đóng ở tầng ngoài vẫn có thể còn request dở đang bay tới.
   */
  private requireQuiet(): void {
    const row = this.ctx.storage.sql
      .exec('SELECT coalesce(max(created_at),0) AS last FROM reservation')
      .one() as { last: number };
    if (row.last > Date.now() - RESTORE_QUIET_MS) throw new BillingCommandError('traffic_active');
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
        // Đóng dấu bằng `row.deadline` — lúc lease THẬT SỰ hết — chứ không phải `now` của lần dọn
        // này. Tenant nghỉ qua đêm thì receipt mồ côi hôm kia chỉ được dọn ở request đầu tiên của
        // hôm nay; lấy `now` là cửa sổ trượt 24 giờ khởi động lại thay vì trôi đi, và khoá
        // `ack_required` không bao giờ tự mở.
        this.ctx.storage.sql.exec(
          'INSERT OR IGNORE INTO missed_ack(request_id,expired_at) VALUES(?,?)',
          row.request_id,
          row.deadline,
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

/**
 * Cắt bản ghi thành trang JSON theo trần 100 bản ghi / 256 KiB, trả CHUỖI đã nối sẵn. Chuỗi này
 * mới là thứ được băm và giao đi: parse rồi stringify lại có thể ra byte khác mà checksum không
 * còn khớp, nên không bao giờ dựng lại nó từ object đã parse.
 */
function paginate(records: { table: SnapshotTable; data: unknown }[]): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  let bytes = 2;
  let total = 0;
  const flush = () => {
    pages.push(`[${current.join(',')}]`);
    current = [];
    bytes = 2;
  };
  for (const record of records) {
    const text = JSON.stringify(record);
    total += text.length + 1;
    if (total > SNAPSHOT_MAX_TOTAL_BYTES) throw new BillingCommandError('snapshot_too_large');
    if (
      current.length >= SNAPSHOT_MAX_RECORDS ||
      (current.length > 0 && bytes + text.length + 1 > SNAPSHOT_MAX_BYTES)
    ) {
      flush();
    }
    current.push(text);
    bytes += text.length + 1;
  }
  // Luôn có ít nhất một trang, kể cả sổ rỗng: người gọi không phải xử lý riêng trường hợp 0 trang.
  flush();
  return pages;
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
    maintenance: false,
    missingAcks: { count: 0, limit: MAX_MISSING_ACK, locked: false, opensAt: null },
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
