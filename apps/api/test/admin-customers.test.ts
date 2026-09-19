import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { TaiKhoanAdmin } from '../src/console/admin-db';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { adminCustomersWith } from '../src/routes/admin-customers';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const TENANT = '00000000-0000-4000-8000-0000000000c1';
const NOW = new Date('2026-09-20T03:00:00Z');
const moi = { ...env, ENVIRONMENT: 'test' } as unknown as Env;

// `google_sub` KHÔNG có trong `TaiKhoanAdmin` (đúng vậy: cột đó không được đọc ra bằng SQL thật).
// Fixture vẫn cố tình gắn thêm khoá này để mô phỏng một hàng dữ liệu LỠ mang theo nó — nếu
// `taiKhoanJson` một ngày nào đó đổi từ liệt kê từng trường sang một `...a` bất cẩn, khoá này sẽ
// lọt ra ngoài và bài kiểm bên dưới bắt được ngay, thay vì im lặng xanh vì fixture chưa từng có nó.
type Dong = TaiKhoanAdmin & { cursor_at?: string; google_sub?: string };
const taiKhoan = (them: Partial<Dong> = {}): Dong => ({
  id: ACCOUNT,
  email: 'khach@vidu.vn',
  name: 'Khách Thử',
  google_linked: false,
  last_login_at: NOW,
  disabled_at: null,
  created_at: NOW,
  tenant_id: TENANT,
  tenant_name: 'Công ty Thử',
  tenant_quota_mode: 'commercial',
  cursor_at: '2026-09-20T03:00:00.000000Z',
  google_sub: 'sub-123',
  ...them,
});

interface DongAudit {
  action: string;
  target: string;
  detail: Record<string, unknown>;
}

function kho(tuyChon: { danhSach?: Dong[]; tk?: Dong | null; phien?: number } = {}) {
  let hienTai = tuyChon.tk === undefined ? taiKhoan() : tuyChon.tk;
  const audit: DongAudit[] = [];
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('LEFT JOIN LATERAL') && q.text.includes('LIMIT $'))
      return tuyChon.danhSach ?? [];
    if (q.text.includes('WHERE a.id = $')) return hienTai ? [hienTai] : [];
    // Phải đứng TRƯỚC nhánh `FROM customer_session` chung: câu DELETE cũng chứa chuỗi con đó, nên
    // để nhánh chung lên trước sẽ nuốt mất câu DELETE và trả nhầm số phiên còn hạn thay vì số bị xoá.
    if (q.text.includes('DELETE FROM customer_session'))
      return [{ token_hash: 'a' }, { token_hash: 'b' }];
    if (q.text.includes('FROM customer_session')) {
      return Array.from({ length: tuyChon.phien ?? 1 }, (_, i) => ({
        created_at: NOW,
        last_seen_at: NOW,
        expires_at: NOW,
        user_agent: `UA ${i}`,
      }));
    }
    if (q.text.includes('SET disabled_at = now()')) {
      if (!hienTai || hienTai.disabled_at) return [];
      hienTai = { ...hienTai, disabled_at: NOW };
      return [{ id: ACCOUNT }];
    }
    if (q.text.includes('SET disabled_at = NULL')) {
      if (!hienTai?.disabled_at) return [];
      hienTai = { ...hienTai, disabled_at: null };
      return [{ id: ACCOUNT }];
    }
    return [];
  });
  return { sql, calls, audit, doc: () => hienTai };
}

const boiCanh = () =>
  ({
    waitUntil: (p: Promise<unknown>) => void p.catch(() => {}),
    passThroughOnException: () => {},
  }) as unknown as ExecutionContext;

function app(k: ReturnType<typeof kho>, email: string | null = 'admin@test.local') {
  const a = new Hono<AppEnv>();
  a.onError((err, c) => errorResponse(c, err));
  a.use('*', async (c, next) => {
    if (!email) return c.json({ error: { code: 'missing_access_jwt' } }, 401);
    c.set('reviewer', email);
    await next();
  });
  a.route(
    '/',
    adminCustomersWith({
      sql: () => k.sql,
      writeAuditEntry: (e) => k.audit.push(e as DongAudit),
    }),
  );
  return a;
}

const get = (a: Hono<AppEnv>, d: string) => a.request(`https://api${d}`, {}, moi, boiCanh());
const post = (a: Hono<AppEnv>, d: string, body: unknown) =>
  a.request(
    `https://api${d}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    moi,
    boiCanh(),
  );
const than = { operationId: 'op-khach-0001', reason: 'Lạm dụng mã OTP' };

describe('GET /v1/admin/customers', () => {
  it('không reviewer → 401', async () => {
    expect((await get(app(kho(), null), '/v1/admin/customers')).status).toBe(401);
  });

  it('danh sách: googleLinked, tenant lồng, nextCursor khi dư một dòng; q vào SQL', async () => {
    const ds = Array.from({ length: 26 }, (_, i) =>
      taiKhoan({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}` }),
    );
    const k = kho({ danhSach: ds });
    const res = await get(app(k), '/v1/admin/customers?q=vidu&limit=25');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(25);
    expect(body.items[0]).toMatchObject({
      email: 'khach@vidu.vn',
      googleLinked: false,
      disabledAt: null,
      tenant: { id: TENANT, name: 'Công ty Thử', quotaMode: 'commercial' },
    });
    expect(body.items[0]).not.toHaveProperty('cursorAt');
    expect(body.items[0]).not.toHaveProperty('googleSub');
    expect(body.nextCursor).toMatch(/\|/);
    expect(k.calls[0]?.params).toContain('vidu');
  });

  it('tài khoản chưa có tổ chức → tenant: null', async () => {
    const k = kho({
      danhSach: [taiKhoan({ tenant_id: null, tenant_name: null, tenant_quota_mode: null })],
    });
    const body = (await (await get(app(k), '/v1/admin/customers')).json()) as {
      items: { tenant: unknown }[];
    };
    expect(body.items[0]?.tenant).toBeNull();
  });

  it('cursor rác → 400', async () => {
    expect((await get(app(kho()), '/v1/admin/customers?cursor=rac')).status).toBe(400);
  });
});

describe('GET /v1/admin/customers/:id', () => {
  it('tài khoản + phiên (không token_hash, không ip_hash); 404 khi không có; id rác → 404', async () => {
    const k = kho({ phien: 2 });
    const res = await get(app(k), `/v1/admin/customers/${ACCOUNT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      account: { id: string };
      sessions: Record<string, unknown>[];
    };
    expect(body.account.id).toBe(ACCOUNT);
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0]).toEqual({
      createdAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      expiresAt: NOW.toISOString(),
      userAgent: 'UA 0',
    });
    expect(JSON.stringify(body)).not.toMatch(/token_hash|ip_hash|tokenHash|ipHash/);
    // Fixture MANG `google_sub` (xem ghi chú ở khai báo `taiKhoan()`) — nếu `taiKhoanJson` một
    // ngày nào đó gộp bằng `...a` thay vì liệt kê từng trường, dòng này đỏ ngay.
    expect(JSON.stringify(body)).not.toMatch(/google_sub|sub-123/);
    // Câu đọc phiên phải mang ĐÚNG id tài khoản đang hỏi, không phải một hằng số hay tham số khác.
    expect(k.calls.find((q) => q.text.includes('FROM customer_session'))?.params).toContain(
      ACCOUNT,
    );
    expect((await get(app(kho({ tk: null })), `/v1/admin/customers/${ACCOUNT}`)).status).toBe(404);
    expect((await get(app(kho()), '/v1/admin/customers/rac')).status).toBe(404);
  });
});

describe('POST /v1/admin/customers/:id/disable', () => {
  it('đang hoạt động → disabledAt đặt, phiên bị xoá, audit giữ lý do', async () => {
    const k = kho();
    const res = await post(app(k), `/v1/admin/customers/${ACCOUNT}/disable`, than);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      account: { disabledAt: NOW.toISOString() },
      moi: true,
      sessionsDeleted: 2,
    });
    expect(k.audit.find((d) => d.action === 'admin.customer.disable')?.detail).toMatchObject({
      email: 'khach@vidu.vn',
      reason: 'Lạm dụng mã OTP',
      operation_id: 'op-khach-0001',
      sessions_deleted: 2,
    });
  });

  it('đã bị khoá → 200 moi:false, KHÔNG ghi audit lần hai', async () => {
    const k = kho({ tk: taiKhoan({ disabled_at: NOW }) });
    const res = await post(app(k), `/v1/admin/customers/${ACCOUNT}/disable`, than);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ moi: false });
    expect(k.audit).toHaveLength(0);
  });

  it('thiếu lý do → 400 invalid_reason; operationId sai → 400; không có tài khoản → 404', async () => {
    const a = app(kho());
    expect(
      (await post(a, `/v1/admin/customers/${ACCOUNT}/disable`, { ...than, reason: '' })).status,
    ).toBe(400);
    expect(
      (await post(a, `/v1/admin/customers/${ACCOUNT}/disable`, { ...than, operationId: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (await post(app(kho({ tk: null })), `/v1/admin/customers/${ACCOUNT}/disable`, than)).status,
    ).toBe(404);
  });
});

describe('POST /v1/admin/customers/:id/enable', () => {
  it('đang bị khoá → disabledAt về null, audit admin.customer.enable', async () => {
    const k = kho({ tk: taiKhoan({ disabled_at: NOW }) });
    const res = await post(app(k), `/v1/admin/customers/${ACCOUNT}/enable`, than);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ account: { disabledAt: null }, moi: true });
    expect(k.audit.map((d) => d.action)).toEqual(['admin.customer.enable']);
  });

  it('đang hoạt động → 200 moi:false', async () => {
    const res = await post(app(kho()), `/v1/admin/customers/${ACCOUNT}/enable`, than);
    expect(await res.json()).toMatchObject({ moi: false });
  });
});
