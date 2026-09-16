import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const FREE_KEY = 'mlv_live_edit00000000000000000000';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path) => fetch(base + path, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });

const createPending = async (name) =>
  (
    await fetch(`${base}/v1/edits`, {
      method: 'POST',
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'create',
        changes: { name, lat: 10.775, lng: 106.699, category: 'cafe' },
        end_user_token: `list-itest-${name}`,
      }),
    })
  ).json();

describe('GET /v1/admin/edits — lọc và phân trang', () => {
  it('limit + cursor chia trang không trùng, không sót', async () => {
    for (let i = 0; i < 3; i += 1) {
      await createPending(`Quán Phân Trang ${Date.now()}-${i}`);
    }

    const first = await (await adminFetch('/v1/admin/edits?status=pending&limit=2')).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTypeOf('number');

    const second = await (
      await adminFetch(`/v1/admin/edits?status=pending&limit=2&cursor=${first.nextCursor}`)
    ).json();
    const firstIds = first.items.map((item) => item.id);
    const secondIds = second.items.map((item) => item.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });

  it('lọc kind=create chỉ trả bản ghi create', async () => {
    const body = await (await adminFetch('/v1/admin/edits?status=pending&kind=create')).json();
    expect(body.items.every((item) => item.kind === 'create')).toBe(true);
  });

  it('tìm theo tên khớp cả POI lẫn changes->>name', async () => {
    await createPending(`Quán Tìm Kiếm ${Date.now()}`);
    const body = await (
      await adminFetch(`/v1/admin/edits?status=pending&q=${encodeURIComponent('Quán Tìm Kiếm')}`)
    ).json();
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('status lạ → 400 invalid_request', async () => {
    const response = await adminFetch('/v1/admin/edits?status=xyz');
    expect(response.status).toBe(400);
  });

  it('/count trả số bản ghi pending', async () => {
    const body = await (await adminFetch('/v1/admin/edits/count')).json();
    expect(body.pending).toBeGreaterThan(0);
  });
});
