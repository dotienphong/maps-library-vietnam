import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const INTERNAL_KEY = 'mlv_live_test00000000000000000000';
const FREE_KEY = 'mlv_live_edit00000000000000000000';
const FREE_TENANT = '00000000-0000-4000-8000-0000000000cc';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const post = async (key, body) => {
  const response = await fetch(`${base}/v1/edits`, {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const getPlace = async (key, id) => {
  const response = await fetch(`${base}/v1/places/${id}`, { headers: { 'X-Api-Key': key } });
  return { status: response.status, body: await response.json() };
};

describe('POST /v1/edits với DB thật', () => {
  it('internal sửa hours (quality 80) → auto_approved, thấy ngay qua GET /v1/places', async () => {
    const { status, body } = await post(INTERNAL_KEY, {
      poi_id: '01M3TEST0000000000000SCH01',
      kind: 'update',
      changes: { hours: 'Mo-Fr 07:00-17:00' },
      end_user_token: 'itest-user-1',
    });
    expect(status).toBe(200);
    expect(body.status).toBe('auto_approved');

    const place = await getPlace(INTERNAL_KEY, '01M3TEST0000000000000SCH01');
    expect(place.status).toBe(200);
    expect(place.body.hours).toEqual({ osm: 'Mo-Fr 07:00-17:00' });
    const [poi] = await sql`SELECT locked_fields FROM poi WHERE id = '01M3TEST0000000000000SCH01'`;
    expect(poi.locked_fields).toContain('hours');
  });

  it('tenant free tạo POI → pending; chỉ tenant tạo thấy; duyệt qua SQL → active', async () => {
    const { status, body } = await post(FREE_KEY, {
      kind: 'create',
      changes: {
        name: 'Bánh Mì M4',
        lat: 10.7735,
        lng: 106.699,
        category: 'cafe',
        ward: 'Bến Thành',
      },
      end_user_token: 'itest-user-2',
    });
    expect(status).toBe(200);
    expect(body.status).toBe('pending');
    expect(body.poi_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const mine = await getPlace(FREE_KEY, body.poi_id);
    expect(mine.status).toBe(200);
    expect(mine.body.status).toBe('pending');
    const others = await getPlace(INTERNAL_KEY, body.poi_id);
    expect(others.status).toBe(404);

    // pending không lộ qua search
    const search = await fetch(`${base}/v1/search?q=${encodeURIComponent('Bánh Mì M4')}`, {
      headers: { 'X-Api-Key': FREE_KEY },
    });
    expect((await search.json()).total).toBe(0);

    await sql`SELECT apply_poi_edit(${body.edit_id}::bigint, 'itest', 'approved')`;
    const approved = await getPlace(INTERNAL_KEY, body.poi_id);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('active');
  });

  it('tenant free sửa name → pending (không auto)', async () => {
    const { status, body } = await post(FREE_KEY, {
      poi_id: '01M3TEST0000000000000CAF01',
      kind: 'update',
      changes: { name: 'Highlands Coffee Đổi Tên' },
      end_user_token: 'itest-user-3',
    });
    expect(status).toBe(200);
    expect(body.status).toBe('pending');
  });

  it('2 end-user khác nhau cùng thay đổi → phiếu thứ hai auto_approved kéo theo phiếu đầu', async () => {
    const changes = { hours: 'Mo-Su 09:00-18:00' };
    const first = await post(FREE_KEY, {
      poi_id: '01M4TEST0000000000000CON01',
      kind: 'update',
      changes,
      end_user_token: 'voter-1',
    });
    expect(first.body.status).toBe('pending'); // quality 40 < 60 → không auto theo luật quality
    const second = await post(FREE_KEY, {
      poi_id: '01M4TEST0000000000000CON01',
      kind: 'update',
      changes,
      end_user_token: 'voter-2',
    });
    expect(second.body.status).toBe('auto_approved');

    const [firstRow] =
      await sql`SELECT status, reviewer FROM poi_edit WHERE id = ${first.body.edit_id}`;
    expect(firstRow.status).toBe('auto_approved');
    expect(firstRow.reviewer).toBe('auto:consensus');
    const [poi] = await sql`SELECT hours FROM poi WHERE id = '01M4TEST0000000000000CON01'`;
    expect(poi.hours).toEqual({ osm: 'Mo-Su 09:00-18:00' });
  });

  it('vượt 20 edit/ngày/end-user → 429 quota_exceeded', async () => {
    const token = 'itest-heavy-user';
    const hash = createHash('sha256').update(`${FREE_TENANT}:${token}`).digest('hex');
    await sql`INSERT INTO poi_edit (poi_id, tenant_id, end_user_hash, kind, changes, status, api_key)
      SELECT '01M3TEST0000000000000CAF01', ${FREE_TENANT}, ${hash}, 'report', '{}'::jsonb, 'pending', ${FREE_KEY}
      FROM generate_series(1, 20)`;
    const { status, body } = await post(FREE_KEY, {
      poi_id: '01M3TEST0000000000000CAF01',
      kind: 'report',
      note: 'spam thử',
      end_user_token: token,
    });
    expect(status).toBe(429);
    expect(body.error.code).toBe('quota_exceeded');
  });

  // Scope 403 đã được phủ ở tầng workers (edits-route.test.ts) với KV giả; ở đây không kiểm
  // được dứt khoát vì auth cache KV 5 phút nên đổi scopes trong DB chưa có hiệu lực ngay.
  it('POI lạ → 404; POI đã closed thì update → 400', async () => {
    const notFound = await post(INTERNAL_KEY, {
      poi_id: '01KHONGTONTAI0000000000000',
      kind: 'close',
      end_user_token: 'itest-user-4',
    });
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('not_found');

    await sql`UPDATE poi SET status = 'closed' WHERE id = '01M3TEST0000000000000SCH03'`;
    const closed = await post(INTERNAL_KEY, {
      poi_id: '01M3TEST0000000000000SCH03',
      kind: 'update',
      changes: { hours: 'Mo-Su 08:00-20:00' },
      end_user_token: 'itest-user-5',
    });
    expect(closed.status).toBe(400);
    expect(closed.body.error.code).toBe('invalid_request');

    // reopen POI đã closed thì được nhận (internal → auto_approved → active lại)
    const reopen = await post(INTERNAL_KEY, {
      poi_id: '01M3TEST0000000000000SCH03',
      kind: 'reopen',
      end_user_token: 'itest-user-5',
    });
    expect(reopen.status).toBe(200);
    expect(reopen.body.status).toBe('auto_approved');
    const [poi] = await sql`SELECT status FROM poi WHERE id = '01M3TEST0000000000000SCH03'`;
    expect(poi.status).toBe('active');
  });
});
