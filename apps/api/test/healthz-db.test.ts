import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Binding Hyperdrive trong tầng test này trỏ vào cổng đóng (xem vitest.config.ts):
// đường đi thật tới Postgres được nghiệm thu bằng `wrangler dev --remote` ở Task 1 Step 10.
describe('GET /healthz/db', () => {
  it('DB không nối được → 503 upstream_unavailable, không phải 500', async () => {
    const res = await SELF.fetch('https://api/healthz/db');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; request_id: string } };
    expect(body.error.code).toBe('upstream_unavailable');
    expect(body.error.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
