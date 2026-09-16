import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { EntitlementCommand, PeriodHistory } from '../src/billing/types';

const NGAY = 86_400_000;

const so = () => env.QUOTA.get(env.QUOTA.idFromName(crypto.randomUUID()));

const capKy = (
  tenantId: string,
  expectedRevision: number,
  startsAt: number,
  endsAt: number,
  tier: 'starter' | 'professional' = 'starter',
): EntitlementCommand => ({
  kind: 'grantPeriod',
  operationId: crypto.randomUUID(),
  tenantId,
  actor: 'test',
  reason: 'test cấp kỳ',
  expectedRevision,
  periodId: crypto.randomUUID(),
  tier,
  startsAt: new Date(startsAt).toISOString(),
  endsAt: new Date(endsAt).toISOString(),
  paymentReference: crypto.randomUUID(),
  lineItemId: 'period',
});

describe('QuotaObject.readPeriods', () => {
  it('sổ trắng → hai danh sách rỗng, không ném', async () => {
    const history = (await so().readPeriods()) as PeriodHistory;
    expect(history).toEqual({ periods: [], credits: [] });
  });

  it('trả các kỳ mới nhất trước, kèm hạn mức và số đã dùng của từng nhóm', async () => {
    const object = so();
    const tenantId = crypto.randomUUID();
    const now = Date.now();
    await object.applyCommand(capKy(tenantId, 0, now - 40 * NGAY, now - 10 * NGAY));
    await object.applyCommand(capKy(tenantId, 1, now - 1000, now + 30 * NGAY, 'professional'));

    // Tiêu một lượt places trong kỳ đang chạy để `reserved` khác 0 một cách có thật.
    const reserve = await object.reserve('req-1', 'places');
    expect(reserve.allowed).toBe(true);

    const history = (await object.readPeriods()) as PeriodHistory;
    expect(history.periods).toHaveLength(2);
    expect(history.periods[0]?.tier).toBe('professional');
    expect(history.periods[0]?.places).toMatchObject({ limit: 100_000, reserved: 1, used: 0 });
    expect(history.periods[0]?.directions.limit).toBe(10_000);
    // Kỳ cũ vẫn còn trong sổ và không lẫn số của kỳ mới.
    expect(history.periods[1]?.tier).toBe('starter');
    expect(history.periods[1]?.places).toMatchObject({ limit: 30_000, used: 0, reserved: 0 });
    // Mốc thời gian trả về dạng ISO để giao diện không phải đoán đơn vị.
    expect(Number.isFinite(Date.parse(String(history.periods[0]?.startsAt)))).toBe(true);
  });

  it('liệt kê gói credit đã cộng, kèm số còn lại của từng gói', async () => {
    const object = so();
    const tenantId = crypto.randomUUID();
    const now = Date.now();
    const period = capKy(tenantId, 0, now - 1000, now + 30 * NGAY);
    await object.applyCommand(period);
    await object.applyCommand({
      kind: 'addCredits',
      operationId: crypto.randomUUID(),
      tenantId,
      actor: 'test',
      reason: 'khách mua thêm',
      expectedRevision: 1,
      periodId: (period as { periodId: string }).periodId,
      group: 'places',
      packs: 3,
      paymentReference: 'CK-1',
      lineItemId: 'credits-1',
    });

    const history = (await object.readPeriods()) as PeriodHistory;
    expect(history.credits).toHaveLength(1);
    expect(history.credits[0]).toMatchObject({
      group: 'places',
      units: 3_000,
      used: 0,
      reserved: 0,
      paymentReference: 'CK-1',
      lineItemId: 'credits-1',
    });
  });

  it('chỉ đọc: gọi hai lần không đổi revision của sổ', async () => {
    const object = so();
    const tenantId = crypto.randomUUID();
    await object.applyCommand(capKy(tenantId, 0, Date.now() - 1000, Date.now() + NGAY));
    const truoc = (await object.readUsage()).revision;
    await object.readPeriods();
    await object.readPeriods();
    expect((await object.readUsage()).revision).toBe(truoc);
  });
});
