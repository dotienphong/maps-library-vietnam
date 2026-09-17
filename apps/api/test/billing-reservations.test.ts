import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { vnBillingDay } from '../src/billing/policy';
import type { QuotaObject } from '../src/billing/quota-object';
import type { EntitlementCommand, QuotaGroup } from '../src/billing/types';

const objectFor = (tenant: string) => env.QUOTA.get(env.QUOTA.idFromName(tenant));
const common = (tenantId: string, expectedRevision: number) => ({
  operationId: crypto.randomUUID(),
  tenantId,
  actor: 'reservation-test@test.invalid',
  reason: 'test',
  expectedRevision,
});
const activePeriod = (tenantId: string): EntitlementCommand => ({
  ...common(tenantId, 0),
  kind: 'grantPeriod',
  periodId: crypto.randomUUID(),
  tier: 'starter',
  startsAt: new Date(Date.now() - 86_400_000).toISOString(),
  endsAt: new Date(Date.now() + 86_400_000).toISOString(),
  paymentReference: `pay-${crypto.randomUUID()}`,
  lineItemId: 'period',
});
async function provision(limit?: number) {
  const tenant = crypto.randomUUID();
  const object = objectFor(tenant);
  await object.applyCommand(activePeriod(tenant));
  if (limit !== undefined) {
    await runInDurableObject(object, (_instance: QuotaObject, state) => {
      state.storage.sql.exec('UPDATE period SET places_limit=?', limit);
    });
  }
  return { tenant, object };
}
const tokenHash = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
async function commit(object: DurableObjectStub<QuotaObject>, id: string, group: QuotaGroup) {
  const token = crypto.randomUUID();
  expect((await object.reserve(id, group)).allowed).toBe(true);
  expect(await object.prepare(id, await tokenHash(token))).toMatchObject({
    state: 'awaiting_ack',
    charged: false,
  });
  expect(await object.ack(id, token)).toMatchObject({ state: 'committed', charged: true });
}
async function objectError(
  object: DurableObjectStub<QuotaObject>,
  action: (instance: QuotaObject) => Promise<unknown>,
): Promise<string> {
  return runInDurableObject(object, async (instance: QuotaObject) => {
    try {
      await action(instance);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}

describe('QuotaObject reservations', () => {
  it('atomically grants only the final unit to one of 50 concurrent requests', async () => {
    const { object } = await provision(1);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) => object.reserve(`last-unit-${index}`, 'places')),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect((await object.readUsage()).places).toMatchObject({ used: 0, reserved: 1, available: 0 });
  });

  it('makes request IDs idempotent and binds them to one group', async () => {
    const { object } = await provision();
    const first = await object.reserve('same-id', 'places');
    expect(await object.reserve('same-id', 'places')).toEqual(first);
    expect(await objectError(object, (instance) => instance.reserve('same-id', 'directions'))).toBe(
      'request_conflict',
    );
  });

  it('charges only after a valid ACK and never charges twice', async () => {
    const { object } = await provision();
    const token = 'receipt-secret';
    await object.reserve('receipt', 'places');
    await object.prepare('receipt', await tokenHash(token));
    expect((await object.readUsage()).places).toMatchObject({ used: 0, reserved: 1 });
    expect(await objectError(object, (instance) => instance.ack('receipt', 'wrong'))).toBe(
      'invalid_receipt_token',
    );
    const first = await object.ack('receipt', token);
    expect(await object.ack('receipt', token)).toEqual(first);
    expect((await object.readUsage()).places).toMatchObject({ used: 1, reserved: 0 });
  });

  it('releases handler failures without charging and refuses late ACK', async () => {
    const { object } = await provision();
    const token = 'failed-response';
    await object.reserve('failed', 'places');
    await object.prepare('failed', await tokenHash(token));
    expect(await object.release('failed', 'handler_503')).toMatchObject({
      state: 'released',
      charged: false,
    });
    expect((await object.readUsage()).places).toMatchObject({ used: 0, reserved: 0 });
    expect(await objectError(object, (instance) => instance.ack('failed', 'anything'))).toBe(
      'receipt_closed',
    );
    await runInDurableObject(object, (_instance: QuotaObject, state) => {
      expect(state.storage.sql.exec('SELECT count(*) AS count FROM missed_ack').one()).toEqual({
        count: 0,
      });
    });
  });

  it('uses included quota before the earliest-expiring credit grant', async () => {
    const { tenant, object } = await provision(1);
    const usage = await object.readUsage();
    await object.applyCommand({
      ...common(tenant, usage.revision),
      kind: 'addCredits',
      periodId: String(usage.periodId),
      group: 'places',
      packs: 1,
      paymentReference: `pay-${crypto.randomUUID()}`,
      lineItemId: 'credits',
    });
    await commit(object, 'base', 'places');
    const creditReservation = await object.reserve('credit', 'places');
    expect(creditReservation.allowed).toBe(true);
    await runInDurableObject(object, (_instance: QuotaObject, state) => {
      expect(
        state.storage.sql.exec("SELECT source_kind FROM reservation WHERE request_id='base'").one(),
      ).toEqual({ source_kind: 'period' });
      expect(
        state.storage.sql
          .exec("SELECT source_kind FROM reservation WHERE request_id='credit'")
          .one(),
      ).toEqual({ source_kind: 'credit' });
    });
  });

  it('admits the measured concurrency ceiling and only counts handlers still running', async () => {
    const tenant = crypto.randomUUID();
    const object = objectFor(tenant);
    await object.applyCommand({
      ...common(tenant, 0),
      kind: 'grantPeriod',
      periodId: crypto.randomUUID(),
      tier: 'business',
      startsAt: new Date(Date.now() - 1_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      paymentReference: crypto.randomUUID(),
      lineItemId: 'period',
    });
    // 50 request Places đồng thời là mốc đã đo thật trên origin, phải qua hết.
    const wave = await Promise.all(
      Array.from({ length: 50 }, (_, i) => object.reserve(`wave-${i}`, 'places')),
    );
    expect(wave.filter((r) => r.allowed)).toHaveLength(50);
    expect(await object.reserve('wave-over', 'places')).toMatchObject({
      allowed: false,
      reason: 'concurrency_limit',
    });

    // Chuyển hết sang awaiting_ack: handler đã xong, không còn chiếm tài nguyên origin,
    // nên chỗ phải được trả lại dù client chưa ACK.
    for (let i = 0; i < 50; i += 1) await object.prepare(`wave-${i}`, 'a'.repeat(64));
    expect(await object.reserve('after-prepare', 'places')).toMatchObject({ allowed: true });
  });

  it('frees an abandoned reservation at the processing deadline, not the ACK lease', async () => {
    const tenant = crypto.randomUUID();
    const object = objectFor(tenant);
    await object.applyCommand({
      ...common(tenant, 0),
      kind: 'grantPeriod',
      periodId: crypto.randomUUID(),
      tier: 'starter',
      startsAt: new Date(Date.now() - 1_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      paymentReference: crypto.randomUUID(),
      lineItemId: 'period',
    });
    const reserved = await object.reserve('abandoned', 'places');
    expect(reserved.allowed).toBe(true);
    const deadline = Date.parse((reserved as { deadline: string }).deadline) - Date.now();
    // Client huỷ request (SDK huỷ autocomplete cũ mỗi phím gõ) không được giữ chỗ 120 giây.
    expect(deadline).toBeLessThanOrEqual(45_000);
    expect(deadline).toBeGreaterThan(30_000);
  });

  it('enforces both trial daily and total limits with Vietnam day keys', async () => {
    const tenant = crypto.randomUUID();
    const object = objectFor(tenant);
    await object.applyCommand({
      ...common(tenant, 0),
      kind: 'activateTrial',
      startsAt: new Date(Date.now() - 1_000).toISOString(),
    });
    await runInDurableObject(object, (_instance: QuotaObject, state) => {
      state.storage.sql.exec('UPDATE period SET places_limit=2');
    });
    await commit(object, 'trial-1', 'places');
    await commit(object, 'trial-2', 'places');
    // Trial hết TỔNG là vĩnh viễn nên tách khỏi 'period' của kỳ trả phí (spec mục 9).
    expect(await object.reserve('trial-3', 'places')).toMatchObject({
      allowed: false,
      reason: 'trial_total',
      resetAt: null,
    });

    const dailyTenant = crypto.randomUUID();
    const dailyObject = objectFor(dailyTenant);
    await dailyObject.applyCommand({
      ...common(dailyTenant, 0),
      kind: 'activateTrial',
      startsAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const dailyUsage = await dailyObject.readUsage();
    await runInDurableObject(dailyObject, (_instance: QuotaObject, state) => {
      state.storage.sql.exec(
        'INSERT INTO counter(source_id,group_name,day_key,used) VALUES(?,?,?,200)',
        dailyUsage.periodId,
        'places',
        vnBillingDay(new Date()),
      );
    });
    expect(await dailyObject.reserve('daily-full', 'places')).toMatchObject({
      allowed: false,
      reason: 'daily',
      resetAt: expect.any(String),
    });
  });

  it('ACK bắc qua giao ngày commit vào sổ CŨ, không trừ sổ của ngày mới', async () => {
    const tenant = crypto.randomUUID();
    const object = objectFor(tenant);
    await object.applyCommand({
      ...common(tenant, 0),
      kind: 'activateTrial',
      startsAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const usage = await object.readUsage();
    const today = vnBillingDay(new Date());
    const yesterday = vnBillingDay(new Date(Date.now() - 86_400_000));

    await object.reserve('qua-giao-ngay', 'places');
    // Giả lập request đặt chỗ TRƯỚC nửa đêm rồi mới ACK sau: dời đúng dòng reservation và dòng
    // counter của nó sang ngày hôm qua. Không thể đẩy đồng hồ của Durable Object từ phía test
    // (spec 14.8), nên đây là cách duy nhất tái hiện tình huống.
    await runInDurableObject(object, (_instance: QuotaObject, state) => {
      state.storage.sql.exec(
        'UPDATE reservation SET day_key=? WHERE request_id=?',
        yesterday,
        'qua-giao-ngay',
      );
      state.storage.sql.exec('UPDATE counter SET day_key=? WHERE day_key=?', yesterday, today);
    });

    const token = 'token-qua-giao-ngay';
    await object.prepare('qua-giao-ngay', await tokenHash(token));
    expect(await object.ack('qua-giao-ngay', token)).toMatchObject({ charged: true });

    const rows = await runInDurableObject(object, (_instance: QuotaObject, state) =>
      state.storage.sql
        .exec(
          'SELECT day_key, used FROM counter WHERE source_id=? AND group_name=? ORDER BY day_key',
          usage.periodId,
          'places',
        )
        .toArray(),
    );
    // Lượt phải rơi vào sổ của NGÀY ĐẶT CHỖ. Nếu `ack` tính theo đồng hồ lúc ACK thay vì theo
    // `day_key` đã ghi trong reservation, dòng của hôm nay sẽ mọc ra với used=1 và khách bị trừ
    // nhầm vào hạn mức ngày mới — trong khi chỗ giữ của ngày cũ không bao giờ được nhả.
    expect(rows).toEqual([{ day_key: yesterday, used: 1 }]);
  });

  it('compensates a committed receipt once and audits the operation', async () => {
    const { object } = await provision();
    await commit(object, 'charged', 'places');
    const first = await object.compensate('charged', 'compensate-1', 'response delivery failed');
    expect(first).toMatchObject({ state: 'compensated', charged: false });
    expect(await object.compensate('charged', 'compensate-1', 'response delivery failed')).toEqual(
      first,
    );
    expect((await object.readUsage()).places.used).toBe(0);
    expect(await object.readReceipt('unknown')).toBeNull();
  });

  it('expires awaiting ACK without charging and locks after three misses in 24 hours', async () => {
    const { object } = await provision();
    for (let index = 0; index < 3; index += 1) {
      const id = `missing-${index}`;
      const token = crypto.randomUUID();
      await object.reserve(id, 'places');
      await object.prepare(id, await tokenHash(token));
      await runInDurableObject(object, (_instance: QuotaObject, state) => {
        state.storage.sql.exec(
          'UPDATE reservation SET deadline=? WHERE request_id=?',
          Date.now() - 1,
          id,
        );
      });
      expect(await runDurableObjectAlarm(object)).toBe(true);
      expect(await object.readReceipt(id)).toMatchObject({ state: 'expired', charged: false });
    }
    expect(await object.reserve('locked', 'places')).toMatchObject({
      allowed: false,
      reason: 'ack_required',
    });
    expect((await object.readUsage()).places.used).toBe(0);
    await runInDurableObject(object, async (_instance: QuotaObject, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
      expect(state.storage.sql.exec('SELECT count(*) AS count FROM missed_ack').one()).toEqual({
        count: 3,
      });
    });
  });

  it('stamps a missed ACK at its lease deadline, not at cleanup time', async () => {
    // `expired_at` phải là lúc lease THẬT SỰ hết hạn. Đóng dấu bằng `Date.now()` của lần dọn thì
    // một tenant nghỉ qua đêm sẽ bị tính lại từ đầu: ba receipt mồ côi của hôm kia được chuyển
    // thành missed_ack ngay trên request đầu tiên của hôm nay, mang dấu HÔM NAY, và cửa sổ trượt
    // 24 giờ khởi động lại thay vì trôi đi — khoá `ack_required` thành ra vĩnh viễn.
    const { object } = await provision();
    const quaLau = Date.now() - 25 * 3_600_000;
    for (let index = 0; index < 3; index += 1) {
      const id = `cu-${index}`;
      await object.reserve(id, 'places');
      await object.prepare(id, await tokenHash(crypto.randomUUID()));
      await runInDurableObject(object, (_instance: QuotaObject, state) => {
        state.storage.sql.exec(
          'UPDATE reservation SET deadline=? WHERE request_id=?',
          quaLau + index,
          id,
        );
      });
    }

    // Request đầu tiên sau đêm nghỉ: chính nó kéo `cleanupExpired` chạy. Ba dòng kia đã quá cửa
    // sổ từ lâu nên phải bị dọn luôn trong cùng lượt, không được chặn ai cả.
    expect(await object.reserve('moi', 'places')).toMatchObject({ allowed: true });
    await runInDurableObject(object, (_instance: QuotaObject, state) => {
      expect(state.storage.sql.exec('SELECT count(*) AS count FROM missed_ack').one()).toEqual({
        count: 0,
      });
    });
  });

  it('reports the missing-ACK window so the admin screen can explain the lock', async () => {
    // Không có con số này thì `/admin/billing` chỉ có mỗi cái nút "Mở khoá receipt": người trực
    // không biết đang có mấy dòng, cũng không biết bao giờ nó tự mở, nên phải đoán. Sự cố
    // 16–17/09/2026 đoán hai lần.
    const { object } = await provision();
    expect((await object.readUsage()).missingAcks).toEqual({
      count: 0,
      limit: 3,
      locked: false,
      opensAt: null,
    });

    const cuNhat = Date.now() - 2 * 3_600_000;
    await runInDurableObject(object, (_instance: QuotaObject, state) => {
      for (let index = 0; index < 4; index += 1) {
        state.storage.sql.exec(
          'INSERT INTO missed_ack(request_id,expired_at) VALUES(?,?)',
          `m-${index}`,
          cuNhat + index * 60_000,
        );
      }
    });

    // 4 dòng / ngưỡng 3: khoá mở khi cửa sổ tụt xuống 2, tức khi dòng thứ HAI trôi ra — không
    // phải dòng cũ nhất. Lấy min() ở đây là hứa sớm hơn sự thật đúng một phút.
    expect((await object.readUsage()).missingAcks).toEqual({
      count: 4,
      limit: 3,
      locked: true,
      opensAt: new Date(cuNhat + 60_000 + 86_400_000).toISOString(),
    });
  });

  it('unlocks missing ACKs with an audited idempotent operation', async () => {
    const { object } = await provision();
    await runInDurableObject(object, (_instance: QuotaObject, state) => {
      const now = Date.now();
      for (let index = 0; index < 3; index += 1) {
        state.storage.sql.exec(
          'INSERT INTO missed_ack(request_id,expired_at) VALUES(?,?)',
          `m-${index}`,
          now,
        );
      }
    });
    const first = await object.unlockMissingAcks(
      'unlock-1',
      'admin@test.invalid',
      'verified SDK issue',
    );
    expect(
      await object.unlockMissingAcks('unlock-1', 'admin@test.invalid', 'verified SDK issue'),
    ).toEqual(first);
    expect((await object.reserve('after-unlock', 'places')).allowed).toBe(true);
  });

  it('keeps tenants and quota groups independent', async () => {
    const first = await provision(1);
    const second = await provision(1);
    expect((await first.object.reserve('p1', 'places')).allowed).toBe(true);
    expect((await first.object.reserve('p2', 'places')).allowed).toBe(false);
    expect((await first.object.reserve('d1', 'directions')).allowed).toBe(true);
    expect((await second.object.reserve('p2', 'places')).allowed).toBe(true);
  });

  it('từ chối ngay trong reserve khi khoá đã thu hồi, trước cả câu hỏi hạn mức', async () => {
    const tenant = crypto.randomUUID();
    const object = env.QUOTA.get(env.QUOTA.idFromName(tenant));
    const keyHash = 'c'.repeat(64);
    await object.setKeyRevoked(keyHash, true, crypto.randomUUID(), 'billing@test.local', 'lộ khoá');

    // Tenant này chưa có quyền sử dụng nào. Nếu phép kiểm thu hồi đặt sau phép kiểm quyền thì
    // kết quả sẽ là `no_entitlement` (403) — sai bản chất: đây là câu hỏi danh tính, không phải
    // câu hỏi hạn mức, và người gọi phải nhận 401 như mọi bề mặt khác.
    expect(await object.reserve(crypto.randomUUID(), 'places', keyHash)).toMatchObject({
      allowed: false,
      reason: 'key_revoked',
    });

    // Khoá khác của cùng tenant không bị vạ lây.
    expect(await object.reserve(crypto.randomUUID(), 'places', 'd'.repeat(64))).toMatchObject({
      allowed: false,
      reason: 'no_entitlement',
    });
  });

  it('releases pending receipts on key revocation without recording a missing ACK', async () => {
    const { object } = await provision();
    const keyHash = 'b'.repeat(64);
    const token = 'pending-token';
    await object.reserve('revoked-pending', 'places', keyHash);
    await object.prepare('revoked-pending', await tokenHash(token));
    await object.setKeyRevoked(
      keyHash,
      true,
      'revoke-pending',
      'billing@test.local',
      'key compromised',
    );
    expect(await object.readReceipt('revoked-pending')).toMatchObject({
      state: 'released',
      charged: false,
    });
    // `key_revoked` chứ không phải `receipt_closed` chung chung: từ 15/09/2026 `ack` tự kiểm khoá
    // thu hồi, vì `auth.ts` không còn gọi `isKeyRevoked` cho route dữ liệu (một vòng mạng ~126 ms).
    // Người gọi nhận 401 `invalid_key` ở đây, giống hệt mọi bề mặt khác, thay vì 409 mơ hồ.
    expect(await objectError(object, (instance) => instance.ack('revoked-pending', token))).toBe(
      'key_revoked',
    );
    await runInDurableObject(object, (_instance, state) => {
      expect(state.storage.sql.exec('SELECT count(*) AS count FROM missed_ack').one()).toEqual({
        count: 0,
      });
    });
  });
});
