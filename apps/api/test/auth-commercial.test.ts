import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedKey } from './helpers/seed-key';

const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('commercial auth cutover', () => {
  it('rejects a cached key when the tenant DO marks it revoked', async () => {
    const key = 'mlv_live_RRRRRRRRRRRRRRRRRRRRRRRR';
    const tenantId = crypto.randomUUID();
    const keyHash = await seedKey(key, { tenantId, plan: 'paid', quotaMode: 'commercial' });
    await env.QUOTA.get(env.QUOTA.idFromName(tenantId)).setKeyRevoked(
      keyHash,
      true,
      'revoke-auth-test',
      'billing@test.local',
      'test revocation',
    );
    const response = await SELF.fetch('https://api/v1/autocomplete?q=cafe', {
      headers: { 'X-Api-Key': key },
    });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('invalid_key');
  });

  it('fails closed for an invalid commercial plus internal configuration', async () => {
    const key = 'mlv_live_IIIIIIIIIIIIIIIIIIIIIIII';
    await seedKey(key, { plan: 'internal', quotaMode: 'commercial' });
    const response = await SELF.fetch('https://api/v1/autocomplete?q=cafe', {
      headers: { 'X-Api-Key': key },
    });
    expect(response.status).toBe(503);
    expect(await code(response)).toBe('billing_configuration_error');
  });

  it('fails closed at auth time while the admission gate is shut, before touching the ledger', async () => {
    const key = 'mlv_live_CCCCCCCCCCCCCCCCCCCCCCCC';
    const tenantId = crypto.randomUUID();
    await seedKey(key, { tenantId, plan: 'paid', quotaMode: 'commercial' });
    // Cấp kỳ để DO có sẵn lược đồ: nếu cổng hở, reserve sẽ ghi được hàng và test thấy ngay.
    const object = env.QUOTA.get(env.QUOTA.idFromName(tenantId));
    await object.applyCommand({
      kind: 'grantPeriod',
      operationId: crypto.randomUUID(),
      tenantId,
      actor: 'test',
      reason: 'admission gate test',
      expectedRevision: 0,
      periodId: crypto.randomUUID(),
      tier: 'starter',
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      paymentReference: crypto.randomUUID(),
      lineItemId: 'period',
    });
    const app = (await import('../src/index')).default;
    const response = await app.request(
      'https://api.test/v1/autocomplete?q=cafe',
      { headers: { 'X-Api-Key': key } },
      { ...env, COMMERCIAL_ADMISSION: '0' },
    );
    expect(response.status).toBe(503);
    // Mã phải là quota_unavailable như docs mô tả, KHÔNG phải upstream_unavailable — nếu không,
    // lúc rollback vận hành sẽ đi truy DB thay vì nhìn ra cổng admission đang đóng.
    expect(await code(response)).toBe('quota_unavailable');
    // Và chưa hề chạm sổ quota: không có reservation nào được ghi.
    expect((await object.readUsage()).places).toMatchObject({ used: 0, reserved: 0 });
    await runInDurableObject(object, (_instance, state) => {
      expect(state.storage.sql.exec('SELECT count(*) AS count FROM reservation').one()).toEqual({
        count: 0,
      });
    });
  });

  it('does not trust a positive cache entry after its absolute expiry', async () => {
    const key = 'mlv_live_EEEEEEEEEEEEEEEEEEEEEEEE';
    await seedKey(key, { cacheExpiresAt: Date.now() - 1 });
    const response = await SELF.fetch('https://api/v1/autocomplete?q=cafe', {
      headers: { 'X-Api-Key': key },
    });
    expect(response.status).toBe(503);
    expect(await code(response)).toBe('upstream_unavailable');
  });
});
