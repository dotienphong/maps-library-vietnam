import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path) => fetch(base + path, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });

const MOC = '2026-09-14T03:00:00.000Z';
const NGUOI = 'itest-audit@access-fake.local';

beforeAll(async () => {
  await sql`DELETE FROM admin_audit WHERE actor = ${NGUOI}`;
  // Mốc thời gian cố định và cách nhau đúng một giờ: lọc theo khoảng chỉ kiểm được khi biết chính
  // xác dòng nào nằm trong, dòng nào nằm ngoài.
  for (let i = 0; i < 5; i += 1) {
    await sql`INSERT INTO admin_audit (actor, action, target, detail, created_at)
      VALUES (${NGUOI}, ${i % 2 === 0 ? 'edit.approve' : 'edit.reject'}, ${`t-${i}`},
              ${sql.json({ thu_tu: i })}, ${MOC}::text::timestamptz + (${i} * interval '1 hour'))`;
  }
});

describe('GET /v1/admin/audit — Nhật ký kiểm toán', () => {
  it('mới nhất lên trước, kèm detail đã giải mã jsonb chứ không phải chuỗi escape', async () => {
    const body = await (
      await adminFetch(`/v1/admin/audit?actor=${encodeURIComponent(NGUOI)}`)
    ).json();
    expect(body.items).toHaveLength(5);
    expect(body.items[0].target).toBe('t-4');
    expect(body.items[4].target).toBe('t-0');
    // `sql.json()` lúc ghi và jsonb lúc đọc: sai một trong hai thì đây là chuỗi, không phải object.
    expect(body.items[0].detail).toEqual({ thu_tu: 4 });
  });

  it('phân trang con trỏ: không trùng, không sót, và id giữ nguyên dạng chuỗi', async () => {
    const q = `actor=${encodeURIComponent(NGUOI)}&limit=2`;
    const p1 = await (await adminFetch(`/v1/admin/audit?${q}`)).json();
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTypeOf('string');

    const p2 = await (await adminFetch(`/v1/admin/audit?${q}&cursor=${p1.nextCursor}`)).json();
    const p3 = await (await adminFetch(`/v1/admin/audit?${q}&cursor=${p2.nextCursor}`)).json();

    const ids = [...p1.items, ...p2.items, ...p3.items].map((r) => r.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(p3.nextCursor).toBeNull();
  });

  it('lọc theo loại việc', async () => {
    const body = await (
      await adminFetch(`/v1/admin/audit?actor=${encodeURIComponent(NGUOI)}&action=edit.reject`)
    ).json();
    expect(body.items).toHaveLength(2);
    expect(body.items.every((r) => r.action === 'edit.reject')).toBe(true);
  });

  it('khoảng thời gian là nửa khoảng: from tính vào, to không', async () => {
    // Hai ngày liền kề dùng chung một mốc thì đóng cả hai đầu sẽ đếm trùng đúng dòng ở ranh giới.
    const q = `actor=${encodeURIComponent(NGUOI)}`;
    const tu = '2026-09-14T04:00:00.000Z'; // = dòng thứ 1
    const den = '2026-09-14T06:00:00.000Z'; // = dòng thứ 3, KHÔNG được tính
    const body = await (await adminFetch(`/v1/admin/audit?${q}&from=${tu}&to=${den}`)).json();
    expect(body.items.map((r) => r.target).sort()).toEqual(['t-1', 't-2']);
  });

  it('from sau to → 400 chứ không phải danh sách rỗng', async () => {
    const response = await adminFetch(
      '/v1/admin/audit?from=2026-09-20T00:00:00Z&to=2026-09-01T00:00:00Z',
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
  });
});
