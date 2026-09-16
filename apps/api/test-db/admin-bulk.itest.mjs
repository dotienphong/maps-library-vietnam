import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const FREE_KEY = 'mlv_live_edit00000000000000000000';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const EMAIL = 'phong@access-fake.local';
const jwt = signAccessJwt({ email: EMAIL });
const adminFetch = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

const createPending = async (name) =>
  (
    await fetch(`${base}/v1/edits`, {
      method: 'POST',
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'create',
        changes: { name, lat: 10.778, lng: 106.701, category: 'cafe' },
        end_user_token: `bulk-${name}`,
      }),
    })
  ).json();

describe('POST /v1/admin/edits/bulk', () => {
  it('duyệt một lô: mọi id chuyển khỏi pending, nhật ký ghi đúng người', async () => {
    const a = await createPending(`Lô A ${Date.now()}`);
    const b = await createPending(`Lô B ${Date.now()}`);

    const response = await adminFetch('/v1/admin/edits/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: [a.edit_id, b.edit_id], action: 'approve' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toHaveLength(2);

    const rows = await sql`SELECT status FROM poi_edit WHERE id IN (${a.edit_id}, ${b.edit_id})`;
    expect(rows.every((row) => row.status === 'approved')).toBe(true);

    // Nhật ký ghi trong waitUntil nên có độ trễ nhỏ.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const audit = await sql`SELECT actor, action FROM admin_audit
      WHERE action = 'edits.bulk_approve' ORDER BY id DESC LIMIT 1`;
    expect(audit[0]?.actor).toBe(EMAIL);
  });

  it('id không còn pending nằm ở danh sách failed, phần còn lại vẫn chạy', async () => {
    const a = await createPending(`Lô C ${Date.now()}`);
    await adminFetch(`/v1/admin/edits/${a.edit_id}/approve`, { method: 'POST' });
    const b = await createPending(`Lô D ${Date.now()}`);

    const body = await (
      await adminFetch('/v1/admin/edits/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids: [a.edit_id, b.edit_id], action: 'approve' }),
      })
    ).json();
    expect(body.failed).toContain(a.edit_id);
    expect(body.ok).toContain(b.edit_id);
  });

  it('quá 50 id → 400', async () => {
    const response = await adminFetch('/v1/admin/edits/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: Array.from({ length: 51 }, (_, i) => i + 1), action: 'approve' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('nhật ký kiểm toán cho duyệt lẻ', () => {
  it('approve ghi một dòng edit.approve với actor là email từ JWT', async () => {
    const created = await createPending(`Nhật Ký ${Date.now()}`);
    await adminFetch(`/v1/admin/edits/${created.edit_id}/approve`, { method: 'POST' });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const rows = await sql`SELECT actor, action, target FROM admin_audit
      WHERE action = 'edit.approve' AND target = ${String(created.edit_id)}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(EMAIL);
  });
});
