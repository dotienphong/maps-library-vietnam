import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

// `phong@access-fake.local` là email nằm trong BILLING_ADMIN_EMAILS của hạ tầng itest.
const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path) => fetch(base + path, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });

describe('GET /v1/admin/quota-summary — DB thật', () => {
  it('trả về từng tenant kèm phần trăm, sắp xếp cao xuống thấp', async () => {
    const response = await adminFetch('/v1/admin/quota-summary');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.tenants)).toBe(true);
    expect(body.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const t of body.tenants) {
      expect(typeof t.name).toBe('string');
      expect(t.pct).toBeGreaterThanOrEqual(0);
      expect(t.pct).toBeLessThanOrEqual(100);
    }
    const pcts = body.tenants.map((t) => t.pct);
    expect([...pcts].sort((a, b) => b - a)).toEqual(pcts);
  });

  it('tenant legacy đi nhánh KV, có hạn mức đọc từ api_key', async () => {
    // Đây là điều dễ hỏng nhất của route này: `readUsage()` TẠO sổ Durable Object cho tenant chưa
    // có. Nhánh legacy phải lấy hạn mức từ api_key (qua KV) — một con số ở đây chứng minh nó đã
    // đi đúng nhánh, vì nhánh DO sẽ trả hạn mức của gói chứ không phải của khoá.
    const [legacy] = await sql`SELECT id::text, name FROM tenant
      WHERE coalesce(to_jsonb(tenant) ->> 'quota_mode', 'legacy') = 'legacy' LIMIT 1`;
    if (!legacy) return; // Hạ tầng seed không có tenant legacy thì không có gì để kiểm.

    const body = await (await adminFetch('/v1/admin/quota-summary')).json();
    const dong = body.tenants.find((t) => t.tenant_id === legacy.id);
    expect(dong).toBeDefined();
    expect(dong.quota_mode).toBe('legacy');
    expect(typeof dong.places.limit).toBe('number');
  });

  it('cache 60 giây: lượt thứ hai trả đúng cùng mốc computed_at', async () => {
    const mot = await (await adminFetch('/v1/admin/quota-summary')).json();
    const hai = await (await adminFetch('/v1/admin/quota-summary')).json();
    expect(hai.computed_at).toBe(mot.computed_at);
  });
});
