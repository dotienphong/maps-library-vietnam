import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { errorResponse } from '../src/errors';
import { quotaReceipts } from '../src/routes/quota-receipts';
import { seedKey } from './helpers/seed-key';

/**
 * Cổng admission chặn traffic thương mại MỚI. Nó KHÔNG được chặn ACK: receipt đã phát ra mà không
 * chốt được sẽ hết lease và bị ghi `missed_ack`; tenant nào đang có ≥3 receipt trong không trung
 * lúc đóng cổng sẽ bị khoá `ack_required` tới 24 giờ sau khi mở lại — kill switch tự gây sự cố.
 */
describe('cổng admission không được biến thành sự cố', () => {
  it('vẫn cho ACK receipt đã phát khi cổng đang đóng', async () => {
    const key = 'mlv_live_GATEGATEGATEGATEGATEGATE';
    const tenantId = crypto.randomUUID();
    await seedKey(key, { tenantId, plan: 'paid', quotaMode: 'commercial' });
    const object = env.QUOTA.get(env.QUOTA.idFromName(tenantId));
    await object.applyCommand({
      kind: 'grantPeriod',
      operationId: crypto.randomUUID(),
      tenantId,
      actor: 't',
      reason: 'scratch',
      expectedRevision: 0,
      periodId: crypto.randomUUID(),
      tier: 'starter',
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      paymentReference: crypto.randomUUID(),
      lineItemId: 'period',
    } as never);

    // Một receipt đã phát ra cho khách TRƯỚC khi đóng cổng.
    const token = 'tok';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    await object.reserve('r1', 'places');
    await object.prepare('r1', hash);

    const app = new Hono<AppEnv>();
    app.onError((e, c) => errorResponse(c, e));
    app.route('/', quotaReceipts);
    const response = await app.request(
      'https://api.test/v1/quota/receipts/r1/ack',
      {
        method: 'POST',
        headers: { 'X-Api-Key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      },
      { ...env, COMMERCIAL_ADMISSION: '0' },
    );
    expect(response.status).toBe(200);
    // Lượt được chốt bình thường, không rơi vào diện thiếu ACK.
    expect((await object.readUsage()).places).toMatchObject({ used: 1, reserved: 0 });
  });
});
