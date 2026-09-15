import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { QuotaObject } from '../src/billing/quota-object';
import type { EntitlementCommand } from '../src/billing/types';

const tenantId = () => crypto.randomUUID();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();
const base = (tenant: string, operationId = crypto.randomUUID()) => ({
  operationId,
  tenantId: tenant,
  actor: 'billing-admin@test.invalid',
  reason: 'billing object test',
  expectedRevision: 0,
});
const trial = (tenant: string, operationId = crypto.randomUUID()): EntitlementCommand => ({
  ...base(tenant, operationId),
  kind: 'activateTrial',
  startsAt: day(-1),
});
const paid = (
  tenant: string,
  overrides: Partial<Extract<EntitlementCommand, { kind: 'grantPeriod' }>> = {},
): Extract<EntitlementCommand, { kind: 'grantPeriod' }> => ({
  ...base(tenant),
  kind: 'grantPeriod',
  periodId: crypto.randomUUID(),
  tier: 'starter',
  startsAt: day(-1),
  endsAt: day(29),
  paymentReference: `pay-${crypto.randomUUID()}`,
  lineItemId: 'line-1',
  ...overrides,
});
const objectFor = (tenant: string) => env.QUOTA.get(env.QUOTA.idFromName(tenant));
async function commandError(
  object: DurableObjectStub<QuotaObject>,
  command: EntitlementCommand,
): Promise<string> {
  return runInDurableObject(object, async (instance: QuotaObject) => {
    try {
      await instance.applyCommand(command);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}

describe('QuotaObject entitlement storage', () => {
  it('starts with no entitlement and activates a trial only once', async () => {
    const tenant = tenantId();
    const object = objectFor(tenant);
    expect(await object.readUsage()).toMatchObject({
      tenantId: '',
      status: 'none',
      tier: null,
      revision: 0,
    });
    const command = trial(tenant);
    const first = await object.applyCommand(command);
    expect(await object.applyCommand(command)).toEqual(first);
    expect(await object.readUsage()).toMatchObject({
      status: 'active',
      tier: 'trial',
      revision: 1,
      trialUsedOnce: true,
      places: { limit: 2_000, used: 0 },
      directions: { limit: 200, used: 0 },
    });
    expect(await commandError(object, { ...trial(tenant), expectedRevision: 1 })).toBe(
      'trial_already_used',
    );
  });

  it('rejects operation replay with a different payload and stale revisions', async () => {
    const tenant = tenantId();
    const object = objectFor(tenant);
    const command = trial(tenant);
    await object.applyCommand(command);
    expect(await commandError(object, { ...command, reason: 'changed' })).toBe(
      'operation_conflict',
    );
    expect(
      await commandError(object, {
        ...paid(tenant),
        expectedRevision: 0,
      }),
    ).toBe('revision_conflict');
  });

  it('deduplicates a business line across operation IDs and rejects changed financial payload', async () => {
    const tenant = tenantId();
    const object = objectFor(tenant);
    const firstCommand = paid(tenant);
    const first = await object.applyCommand(firstCommand);
    const replay = await object.applyCommand({
      ...firstCommand,
      operationId: crypto.randomUUID(),
      expectedRevision: 1,
    });
    expect(replay).toEqual(first);
    expect(
      await commandError(object, {
        ...firstCommand,
        operationId: crypto.randomUUID(),
        expectedRevision: 1,
        tier: 'professional',
      }),
    ).toBe('business_identity_conflict');
    expect((await object.readUsage()).revision).toBe(1);
  });

  it('rejects overlapping periods while a future period does not replace the current one', async () => {
    const tenant = tenantId();
    const object = objectFor(tenant);
    await object.applyCommand(paid(tenant));
    expect(
      await commandError(
        object,
        paid(tenant, {
          expectedRevision: 1,
          startsAt: day(10),
          endsAt: day(40),
        }),
      ),
    ).toBe('period_overlap');
    await object.applyCommand(
      paid(tenant, {
        expectedRevision: 1,
        startsAt: day(29),
        endsAt: day(59),
      }),
    );
    expect(await object.readUsage()).toMatchObject({
      tier: 'starter',
      periodId: expect.any(String),
      revision: 2,
    });
  });

  it('keeps an existing reservation when trial becomes paid', async () => {
    const tenant = tenantId();
    const object = objectFor(tenant);
    await object.applyCommand(trial(tenant));
    expect((await object.reserve('held', 'places')).allowed).toBe(true);
    await object.applyCommand(
      paid(tenant, {
        expectedRevision: 1,
        startsAt: day(1),
        endsAt: day(31),
      }),
    );
    await runInDurableObject(object, async (_instance: QuotaObject, state) => {
      expect(
        state.storage.sql.exec("SELECT state FROM reservation WHERE request_id='held'").one(),
      ).toEqual({ state: 'reserved' });
    });
  });

  it('rejects invalid numbers, timestamps, oversized and client-derived amounts', async () => {
    const tenant = tenantId();
    const object = objectFor(tenant);
    expect(await commandError(object, paid(tenant, { endsAt: 'bad-date' }))).toBe(
      'invalid_command',
    );
    expect(
      await commandError(object, {
        ...paid(tenant),
        packs: -1,
      } as never),
    ).toBe('invalid_command');
    expect(
      await commandError(object, {
        ...paid(tenant),
        amountCents: -1,
      } as never),
    ).toBe('invalid_command');
    expect(
      await commandError(object, {
        ...trial(tenant),
        reason: 'x'.repeat(17_000),
      }),
    ).toBe('payload_too_large');
  });

  it('derives add-on units from the catalog and rejects invalid pack counts', async () => {
    const tenant = tenantId();
    const object = objectFor(tenant);
    await object.applyCommand(paid(tenant));
    const usage = await object.readUsage();
    const credit = {
      ...base(tenant),
      expectedRevision: usage.revision,
      kind: 'addCredits' as const,
      periodId: String(usage.periodId),
      group: 'directions' as const,
      packs: 2,
      paymentReference: `pay-${crypto.randomUUID()}`,
      lineItemId: 'direction-credit',
    };
    await object.applyCommand(credit);
    expect((await object.readUsage()).directions.credits).toBe(2_000);
    expect(
      await commandError(object, {
        ...credit,
        operationId: crypto.randomUUID(),
        expectedRevision: 2,
        packs: 0.5,
      }),
    ).toBe('invalid_command');
    expect(
      await commandError(object, {
        ...credit,
        operationId: crypto.randomUUID(),
        expectedRevision: 2,
        packs: -1,
      }),
    ).toBe('invalid_command');
    expect(
      await commandError(object, {
        ...credit,
        operationId: crypto.randomUUID(),
        expectedRevision: 2,
        packs: Math.floor(Number.MAX_SAFE_INTEGER / 1_000) + 1,
      }),
    ).toBe('invalid_command');
  });

  it('persists entitlement when a new stub addresses the same tenant', async () => {
    const tenant = tenantId();
    await objectFor(tenant).applyCommand(trial(tenant));
    expect(await objectFor(tenant).readUsage()).toMatchObject({ revision: 1, tier: 'trial' });
  });

  it('persists key revocation and replays the audited operation', async () => {
    const tenant = tenantId();
    const object = objectFor(tenant);
    const keyHash = 'a'.repeat(64);
    const first = await object.setKeyRevoked(
      keyHash,
      true,
      'revoke-operation',
      'billing@test.local',
      'customer request',
    );
    expect(
      await object.setKeyRevoked(
        keyHash,
        true,
        'revoke-operation',
        'billing@test.local',
        'customer request',
      ),
    ).toEqual(first);
    expect(await objectFor(tenant).isKeyRevoked(keyHash)).toBe(true);
  });

  it('derives expired and suspended snapshots from durable state', async () => {
    const expiredTenant = tenantId();
    await objectFor(expiredTenant).applyCommand(
      paid(expiredTenant, {
        startsAt: '2025-01-01T00:00:00.000Z',
        endsAt: '2025-02-01T00:00:00.000Z',
      }),
    );
    expect(await objectFor(expiredTenant).readUsage()).toMatchObject({
      status: 'expired',
      tier: null,
    });

    const suspendedTenant = tenantId();
    const object = objectFor(suspendedTenant);
    await object.applyCommand(paid(suspendedTenant));
    await object.applyCommand({
      ...base(suspendedTenant),
      kind: 'suspend',
      expectedRevision: 1,
    });
    expect(await object.readUsage()).toMatchObject({
      status: 'suspended',
      tier: 'starter',
      revision: 2,
    });
  });
});
