import { type Context, Hono } from 'hono';
import { audit } from '../audit';
import {
  danhSachTaiKhoanAdmin,
  docTaiKhoanAdmin,
  kichHoatLaiTaiKhoan,
  type PhienAdmin,
  phienCuaTaiKhoan,
  type TaiKhoanAdmin,
  voHieuHoaTaiKhoan,
} from '../console/admin-db';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';
import { docJson, docLenh, NO_STORE, UUID } from './admin-lenh';
import { encodeTenantCursor, parseTenantListParams } from './admin-tenant-params';

type ChiTietAudit = Record<string, string | number | boolean | null>;

export interface AdminCustomersDeps {
  sql?: (env: Env) => ReturnType<typeof getSql>;
  /** Tiêm được để test đọc dòng audit; mặc định `audit()` thật chạy trong waitUntil với client riêng. */
  writeAuditEntry?: (entry: { action: string; target: string; detail: ChiTietAudit }) => void;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/** Hình dạng tài khoản cho admin. Không có google_sub, không có gì để đăng nhập thay khách. */
export function taiKhoanJson(a: TaiKhoanAdmin) {
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    googleLinked: a.google_linked,
    lastLoginAt: iso(a.last_login_at),
    disabledAt: iso(a.disabled_at),
    createdAt: iso(a.created_at),
    tenant: a.tenant_id
      ? { id: a.tenant_id, name: a.tenant_name, quotaMode: a.tenant_quota_mode }
      : null,
  };
}

const phienJson = (p: PhienAdmin) => ({
  createdAt: iso(p.created_at),
  lastSeenAt: iso(p.last_seen_at),
  expiresAt: iso(p.expires_at),
  userAgent: p.user_agent,
});

const accountId = (raw: string): string => {
  if (!UUID.test(raw)) throw new ApiError(404, 'customer_not_found', 'Không có tài khoản này');
  return raw;
};

/**
 * Nhóm admin tài khoản khách hàng (spec 13, 14). Mount TRONG app `admin` nên đứng sau
 * `requireSameSiteGhi()` + `requireAccess()`; không cần `requireBillingAccess()` vì ở đây không
 * có dữ liệu tiền — đơn hàng của khách giao diện lấy qua `/v1/admin/orders?tenant=…` và chịu
 * cổng billing ở đó.
 */
export function adminCustomersWith(deps: AdminCustomersDeps = {}) {
  const routes = new Hono<AppEnv>();

  const ghiAudit = (c: Context<AppEnv>, action: string, target: string, detail: ChiTietAudit) => {
    if (deps.writeAuditEntry) {
      deps.writeAuditEntry({ action, target, detail });
      return;
    }
    audit(c, action, target, detail);
  };

  async function voiSqlCua<T>(
    c: Context<AppEnv>,
    fn: (sql: ReturnType<typeof getSql>) => Promise<T>,
  ): Promise<T> {
    const sql = (deps.sql ?? getSql)(c.env);
    try {
      return await fn(sql);
    } finally {
      endSql(c.executionCtx, sql);
    }
  }

  routes.get('/v1/admin/customers', async (c) => {
    // Cùng luật q/limit/cursor với danh sách tenant: một cách tìm, một cách phân trang.
    const p = parseTenantListParams(new URL(c.req.url).searchParams);
    const rows = await voiSqlCua(c, (sql) => danhSachTaiKhoanAdmin(sql, p));
    const hasMore = rows.length > p.limit;
    const page = hasMore ? rows.slice(0, p.limit) : rows;
    const last = page.at(-1);
    return c.json(
      {
        items: page.map(({ cursor_at: _cursorAt, ...tk }) => taiKhoanJson(tk)),
        nextCursor: hasMore && last ? encodeTenantCursor(last.cursor_at, last.id) : null,
      },
      200,
      NO_STORE,
    );
  });

  routes.get('/v1/admin/customers/:id', async (c) => {
    const id = accountId(c.req.param('id'));
    const kq = await voiSqlCua(c, async (sql) => {
      const tk = await docTaiKhoanAdmin(sql, id);
      if (!tk) return null;
      return { tk, phien: await phienCuaTaiKhoan(sql, id) };
    });
    if (!kq) throw new ApiError(404, 'customer_not_found', 'Không có tài khoản này');
    return c.json(
      { account: taiKhoanJson(kq.tk), sessions: kq.phien.map(phienJson) },
      200,
      NO_STORE,
    );
  });

  /**
   * Vô hiệu hoá. Hiệu lực tức thì vì phiên bị xoá trong cùng transaction (tiêu chí 20.11). Gọi
   * lại trên tài khoản đã khoá trả 200 `moi: false` — bấm hai lần không phải sự cố.
   */
  routes.post('/v1/admin/customers/:id/disable', async (c) => {
    const id = accountId(c.req.param('id'));
    const { reason, operationId } = docLenh(await docJson(c.req.raw));
    const kq = await voiSqlCua(c, async (sql) => {
      const tk = await docTaiKhoanAdmin(sql, id);
      if (!tk) throw new ApiError(404, 'customer_not_found', 'Không có tài khoản này');
      const { doi, phienXoa, tk: sau } = await voHieuHoaTaiKhoan(sql, id);
      return { tk: sau ?? tk, doi, phienXoa };
    });
    if (kq.doi) {
      ghiAudit(c, 'admin.customer.disable', id, {
        email: kq.tk.email,
        operation_id: operationId,
        reason,
        sessions_deleted: kq.phienXoa,
      });
    }
    return c.json(
      { account: taiKhoanJson(kq.tk), moi: kq.doi, sessionsDeleted: kq.phienXoa },
      200,
      NO_STORE,
    );
  });

  routes.post('/v1/admin/customers/:id/enable', async (c) => {
    const id = accountId(c.req.param('id'));
    const { reason, operationId } = docLenh(await docJson(c.req.raw));
    const kq = await voiSqlCua(c, async (sql) => {
      const tk = await docTaiKhoanAdmin(sql, id);
      if (!tk) throw new ApiError(404, 'customer_not_found', 'Không có tài khoản này');
      const { doi, tk: sau } = await kichHoatLaiTaiKhoan(sql, id);
      return { tk: sau ?? tk, doi };
    });
    if (kq.doi) {
      ghiAudit(c, 'admin.customer.enable', id, {
        email: kq.tk.email,
        operation_id: operationId,
        reason,
      });
    }
    return c.json({ account: taiKhoanJson(kq.tk), moi: kq.doi }, 200, NO_STORE);
  });

  return routes;
}

export const adminCustomers = adminCustomersWith();
