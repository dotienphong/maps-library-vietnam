import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const FREE_KEY = 'mlv_live_edit00000000000000000000';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: { 'Cf-Access-Jwt-Assertion': jwt, ...(init.headers ?? {}) },
  });

const createPending = async (name) => {
  const response = await fetch(`${base}/v1/edits`, {
    method: 'POST',
    headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'create',
      changes: { name, lat: 10.774, lng: 106.698, category: 'cafe' },
      end_user_token: `admin-itest-${name}`,
    }),
  });
  return response.json();
};

describe('/v1/admin — duyệt qua HTTP với Access giả lập', () => {
  it('không JWT → 401; JWT sai aud → 401', async () => {
    expect((await fetch(`${base}/v1/admin/edits`)).status).toBe(401);
    const wrongAud = signAccessJwt({ aud: 'aud-khac' });
    const response = await fetch(`${base}/v1/admin/edits`, {
      headers: { 'Cf-Access-Jwt-Assertion': wrongAud },
    });
    expect(response.status).toBe(401);
  });

  it('pending list chứa edit mới; approve → POI active, reviewer = email JWT', async () => {
    const created = await createPending('Quán Admin Duyệt');
    expect(created.status).toBe('pending');

    const list = await (await adminFetch('/v1/admin/edits?status=pending')).json();
    const found = list.items.find((item) => item.id === created.edit_id);
    expect(found).toBeTruthy();
    expect(found.kind).toBe('create');
    expect(found.poi_name).toBe('Quán Admin Duyệt');

    const approve = await adminFetch(`/v1/admin/edits/${created.edit_id}/approve`, {
      method: 'POST',
    });
    expect(approve.status).toBe(200);
    expect((await approve.json()).poi_id).toBe(created.poi_id);

    const [edit] = await sql`SELECT status, reviewer FROM poi_edit WHERE id = ${created.edit_id}`;
    expect(edit.status).toBe('approved');
    expect(edit.reviewer).toBe('phong@access-fake.local');
    const [poi] = await sql`SELECT status FROM poi WHERE id = ${created.poi_id}`;
    expect(poi.status).toBe('active');

    // approve lần 2 → 404 (không còn pending)
    const again = await adminFetch(`/v1/admin/edits/${created.edit_id}/approve`, {
      method: 'POST',
    });
    expect(again.status).toBe(404);
  });

  it('reject → edit rejected, POI pending → rejected', async () => {
    const created = await createPending('Quán Admin Từ Chối');
    const reject = await adminFetch(`/v1/admin/edits/${created.edit_id}/reject`, {
      method: 'POST',
    });
    expect(reject.status).toBe(200);

    const [edit] = await sql`SELECT status, reviewer FROM poi_edit WHERE id = ${created.edit_id}`;
    expect(edit.status).toBe('rejected');
    expect(edit.reviewer).toBe('phong@access-fake.local');
    const [poi] = await sql`SELECT status FROM poi WHERE id = ${created.poi_id}`;
    expect(poi.status).toBe('rejected');
  });

  it('list theo status khác nhau; status lạ → 400', async () => {
    const approved = await (await adminFetch('/v1/admin/edits?status=approved')).json();
    expect(Array.isArray(approved.items)).toBe(true);
    expect(approved.items.every((item) => item.status === 'approved')).toBe(true);
    expect((await adminFetch('/v1/admin/edits?status=hacked')).status).toBe(400);
  });
});

describe('GET /v1/admin/me', () => {
  it('trả email từ JWT và danh sách quyền đầy đủ', async () => {
    const response = await adminFetch('/v1/admin/me');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.email).toBe('phong@access-fake.local');
    expect(body.permissions).toContain('edits.write');
  });

  it('không JWT → 401', async () => {
    expect((await fetch(`${base}/v1/admin/me`)).status).toBe(401);
  });
});
