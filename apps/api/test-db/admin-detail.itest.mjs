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

const submit = (body) =>
  fetch(`${base}/v1/edits`, {
    method: 'POST',
    headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((response) => response.json());

describe('GET /v1/admin/edits/:id', () => {
  it('create → có nearby và KHÔNG có distance_m', async () => {
    const created = await submit({
      kind: 'create',
      changes: {
        name: `Chi Tiết Tạo ${Date.now()}`,
        lat: 10.7769,
        lng: 106.7009,
        category: 'cafe',
      },
      end_user_token: 'detail-create',
    });
    const body = await (await adminFetch(`/v1/admin/edits/${created.edit_id}`)).json();
    expect(body.edit.kind).toBe('create');
    // POST /v1/edits dựng sẵn POI ở trạng thái pending, nên `create` VẪN có poi_hien_tai — nó
    // nằm đúng toạ độ đề xuất. Vì vậy khoảng cách phải là null chứ không phải 0: "dời 0 m" là
    // một nhãn gây hiểu nhầm cho thứ chưa từng dời.
    expect(body.poi_hien_tai.status).toBe('pending');
    expect(body.distance_m).toBeNull();
    expect(Array.isArray(body.nearby)).toBe(true);
  });

  it('update đổi toạ độ → distance_m là số dương, poi_hien_tai có toạ độ cũ', async () => {
    const created = await submit({
      kind: 'create',
      changes: { name: `Chi Tiết Sửa ${Date.now()}`, lat: 10.77, lng: 106.7, category: 'cafe' },
      end_user_token: 'detail-seed',
    });
    await adminFetch(`/v1/admin/edits/${created.edit_id}/approve`, { method: 'POST' });

    const moved = await submit({
      kind: 'update',
      poi_id: created.poi_id,
      changes: { lat: 10.773, lng: 106.703 },
      end_user_token: 'detail-move',
    });
    const body = await (await adminFetch(`/v1/admin/edits/${moved.edit_id}`)).json();
    expect(body.poi_hien_tai.lat).toBeCloseTo(10.77, 3);
    expect(body.distance_m).toBeGreaterThan(100);
    expect(body.nearby).toEqual([]);
  });

  it('không lộ ip_hash và end_user_hash của người gửi', async () => {
    const created = await submit({
      kind: 'create',
      changes: {
        name: `Chi Tiết Riêng Tư ${Date.now()}`,
        lat: 10.78,
        lng: 106.71,
        category: 'cafe',
      },
      end_user_token: 'detail-privacy',
    });
    const body = await (await adminFetch(`/v1/admin/edits/${created.edit_id}`)).json();
    expect(body.edit.ip_hash).toBeUndefined();
    expect(body.edit.end_user_hash).toBeUndefined();
  });

  it('id không tồn tại → 404', async () => {
    expect((await adminFetch('/v1/admin/edits/99999999')).status).toBe(404);
  });

  it('không JWT → 401', async () => {
    expect((await fetch(`${base}/v1/admin/edits/1`)).status).toBe(401);
  });
});
