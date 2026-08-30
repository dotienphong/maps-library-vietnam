import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Binding Hyperdrive trong test dùng localConnectionString → Postgres dev (pnpm db:up).
describe('GET /healthz/db', () => {
  it('nối được DB qua binding Hyperdrive và trả user + phiên bản Postgres', async () => {
    const res = await SELF.fetch('https://api/healthz/db');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; user: string; version: string };
    expect(body.ok).toBe(true);
    expect(body.user).toBe('mapslibvn');
    expect(body.version).toMatch(/^PostgreSQL 16\./);
  });
});
