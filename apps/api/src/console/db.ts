import { endSql, getSql } from '../db';
import type { Env } from '../env';

/**
 * Mọi truy vấn Postgres của nhóm console nằm đúng ở đây. Lý do gom một chỗ: mỗi câu đều phải có
 * điều kiện giới hạn theo tài khoản hoặc tenant của phiên, và rải chúng khắp các route là cách
 * chắc chắn để một ngày nào đó quên mất một điều kiện.
 */

type Sql = ReturnType<typeof getSql>;
type Ctx = { waitUntil(promise: Promise<unknown>): void };

export interface TaiKhoan {
  id: string;
  email: string;
  name: string | null;
  google_sub: string | null;
  trial_tenant_id: string | null;
  disabled_at: Date | null;
}

export interface PhienDayDu {
  accountId: string;
  email: string;
  name: string | null;
  disabledAt: Date | null;
  expiresAt: Date;
  tenantId: string | null;
  tenantName: string | null;
}

/** Chạy một việc với client Postgres riêng rồi đóng đúng cách qua executionCtx. */
export async function voiSql<T>(env: Env, ctx: Ctx, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = getSql(env);
  try {
    return await fn(sql);
  } finally {
    endSql(ctx, sql);
  }
}

export async function timTaiKhoanTheoEmail(sql: Sql, email: string): Promise<TaiKhoan | null> {
  const rows = await sql<TaiKhoan[]>`
    SELECT id, email, name, google_sub, trial_tenant_id, disabled_at
    FROM customer_account WHERE email = ${email}`;
  return rows[0] ?? null;
}

/**
 * Tạo tài khoản nếu chưa có, trả về bản ghi dù mới hay cũ. `ON CONFLICT DO UPDATE` thay vì
 * `DO NOTHING` để câu luôn trả về một dòng — `DO NOTHING` trả rỗng khi đã tồn tại, và chỗ gọi
 * lại phải truy vấn lần hai.
 */
export async function taoHoacLayTaiKhoan(sql: Sql, email: string): Promise<TaiKhoan> {
  // `DO UPDATE` là cách lấy được dòng cũ qua `RETURNING` khi email đã tồn tại; `DO NOTHING` trả
  // về rỗng. Nhưng cột đặt trong `SET` phải là cột mà role `api` được cấp quyền UPDATE, và `email`
  // KHÔNG nằm trong danh sách đó — Postgres kiểm quyền theo câu lệnh chứ không đợi có xung đột
  // thật, nên bản cũ (`SET email = EXCLUDED.email`) hỏng ngay từ lần đăng nhập đầu tiên trên
  // production. Gán `name` về chính nó là phép không đổi dữ liệu, và `name` thì api có quyền.
  // Không dùng `EXCLUDED.name`: giá trị đó là NULL và sẽ xoá mất tên đã lưu.
  // Sự cố 19/09/2026 — chỉ lộ trên production vì harness nối DB bằng role chủ sở hữu.
  const rows = await sql<TaiKhoan[]>`
    INSERT INTO customer_account (email) VALUES (${email})
    ON CONFLICT (email) DO UPDATE SET name = customer_account.name
    RETURNING id, email, name, google_sub, trial_tenant_id, disabled_at`;
  return rows[0] as TaiKhoan;
}

export async function ghiNhanDangNhap(sql: Sql, accountId: string): Promise<void> {
  await sql`UPDATE customer_account SET last_login_at = now() WHERE id = ${accountId}::uuid`;
}

export async function ganGoogleSub(sql: Sql, accountId: string, sub: string): Promise<void> {
  await sql`UPDATE customer_account SET google_sub = ${sub} WHERE id = ${accountId}::uuid`;
}

export async function taoPhien(
  sql: Sql,
  input: {
    tokenHash: string;
    accountId: string;
    expiresAt: Date;
    userAgent: string | null;
    ipHash: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO customer_session (token_hash, account_id, expires_at, user_agent, ip_hash)
    VALUES (${input.tokenHash}, ${input.accountId}::uuid, ${input.expiresAt},
            ${input.userAgent}, ${input.ipHash})`;
}

/**
 * Đọc phiên kèm tài khoản và tenant trong MỘT câu.
 *
 * Hai điều kiện sống còn nằm ngay trong SQL chứ không ở JavaScript, để không có nhánh nào quên:
 * phiên phải chưa hết hạn, và tài khoản phải chưa bị vô hiệu hoá thì mới coi là đăng nhập được.
 * `disabled_at` vẫn được trả ra để route phân biệt "không có phiên" với "tài khoản bị khoá".
 */
export async function docPhien(sql: Sql, tokenHash: string): Promise<PhienDayDu | null> {
  const rows = await sql<
    {
      account_id: string;
      email: string;
      name: string | null;
      disabled_at: Date | null;
      expires_at: Date;
      tenant_id: string | null;
      tenant_name: string | null;
    }[]
  >`
    SELECT s.account_id, a.email, a.name, a.disabled_at, s.expires_at,
           m.tenant_id, t.name AS tenant_name
    FROM customer_session s
    JOIN customer_account a ON a.id = s.account_id
    LEFT JOIN tenant_member m ON m.account_id = a.id AND m.role = 'owner'
    LEFT JOIN tenant t ON t.id = m.tenant_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()
    ORDER BY m.created_at
    LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  return {
    accountId: row.account_id,
    email: row.email,
    name: row.name,
    disabledAt: row.disabled_at,
    expiresAt: row.expires_at,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
  };
}

export async function giaHanPhien(sql: Sql, tokenHash: string, hetHan: Date): Promise<void> {
  await sql`UPDATE customer_session SET last_seen_at = now(), expires_at = ${hetHan}
    WHERE token_hash = ${tokenHash}`;
}

export async function xoaPhien(sql: Sql, tokenHash: string): Promise<void> {
  await sql`DELETE FROM customer_session WHERE token_hash = ${tokenHash}`;
}

/** Đăng xuất mọi thiết bị KHÁC; phiên đang dùng được giữ lại để khách không tự đá mình ra. */
export async function xoaPhienKhac(
  sql: Sql,
  accountId: string,
  giuTokenHash: string,
): Promise<number> {
  const rows = await sql<{ token_hash: string }[]>`
    DELETE FROM customer_session
    WHERE account_id = ${accountId}::uuid AND token_hash <> ${giuTokenHash}
    RETURNING token_hash`;
  return rows.length;
}

export async function xoaPhienCuaTaiKhoan(sql: Sql, accountId: string): Promise<void> {
  await sql`DELETE FROM customer_session WHERE account_id = ${accountId}::uuid`;
}

export interface TenantCuaKhach {
  id: string;
  name: string;
  plan: string;
  quota_mode: string;
  billing_name: string | null;
  billing_tax_code: string | null;
  billing_address: string | null;
  billing_email: string | null;
}

/**
 * Tạo tenant, gắn chủ sở hữu và ghi nhận tenant dùng thử trong MỘT transaction.
 *
 * Postgres trước, sổ quota sau — và thứ tự đó là cố ý. Ngược lại thì một sổ quota ra đời cho một
 * tenant chưa tồn tại, không có đường nào tìm lại, và trang Admin đã có sáu sổ mồ côi kiểu đó từ
 * một lỗi khác. Bước gọi sổ thất bại thì tenant vẫn còn, trạng thái `none`, và lần mở console kế
 * tiếp gọi lại đúng `operationId` nên không sinh bản thứ hai.
 */
export async function taoTenantChoKhach(
  sql: Sql,
  input: { accountId: string; ten: string },
): Promise<TenantCuaKhach> {
  return await sql.begin(async (tx) => {
    const rows = await tx<TenantCuaKhach[]>`
      INSERT INTO tenant (name, plan, quota_mode) VALUES (${input.ten}, 'free', 'commercial')
      RETURNING id, name, plan, quota_mode, billing_name, billing_tax_code, billing_address, billing_email`;
    const tenant = rows[0] as TenantCuaKhach;
    await tx`INSERT INTO tenant_member (tenant_id, account_id, role)
      VALUES (${tenant.id}::uuid, ${input.accountId}::uuid, 'owner')`;
    await tx`UPDATE customer_account SET trial_tenant_id = ${tenant.id}::uuid
      WHERE id = ${input.accountId}::uuid`;
    return tenant;
  });
}

export async function docTenant(sql: Sql, tenantId: string): Promise<TenantCuaKhach | null> {
  const rows = await sql<TenantCuaKhach[]>`
    SELECT id, name, plan, quota_mode, billing_name, billing_tax_code, billing_address, billing_email
    FROM tenant WHERE id = ${tenantId}::uuid`;
  return rows[0] ?? null;
}

/**
 * Cập nhật thông tin do khách tự sửa. Danh sách cột viết cứng ở đây chứ không dựng động từ body:
 * `plan` và `quota_mode` quyết định khách được dùng bao nhiêu, và chúng không bao giờ được phép
 * đi qua đường này dù client có gửi lên.
 */
export async function capNhatTenant(
  sql: Sql,
  tenantId: string,
  input: {
    ten: string;
    billingName: string | null;
    billingTaxCode: string | null;
    billingAddress: string | null;
    billingEmail: string | null;
  },
): Promise<TenantCuaKhach | null> {
  const rows = await sql<TenantCuaKhach[]>`
    UPDATE tenant SET name = ${input.ten}, billing_name = ${input.billingName},
      billing_tax_code = ${input.billingTaxCode}, billing_address = ${input.billingAddress},
      billing_email = ${input.billingEmail}
    WHERE id = ${tenantId}::uuid
    RETURNING id, name, plan, quota_mode, billing_name, billing_tax_code, billing_address, billing_email`;
  return rows[0] ?? null;
}

/** Tài khoản đã dùng bản dùng thử ở đâu đó chưa — mỗi tài khoản chỉ được một lần. */
export async function daDungThu(sql: Sql, accountId: string): Promise<boolean> {
  const rows = await sql<{ trial_tenant_id: string | null }[]>`
    SELECT trial_tenant_id FROM customer_account WHERE id = ${accountId}::uuid`;
  return rows[0]?.trial_tenant_id != null;
}

export interface KhoaCuaKhach {
  key_hash: string;
  key_prefix: string;
  label: string | null;
  kind: string;
  allowed_origins: string[] | string;
  active: boolean;
  created_at: Date;
  revoked_at: Date | null;
}

/** Khoá của MỘT tenant. Điều kiện tenant_id là thứ ngăn khách này thấy khoá của khách khác. */
export async function khoaCuaTenant(sql: Sql, tenantId: string): Promise<KhoaCuaKhach[]> {
  return await sql<KhoaCuaKhach[]>`
    SELECT key_hash, key_prefix, label, kind, allowed_origins, active, created_at, revoked_at
    FROM api_key WHERE tenant_id = ${tenantId}::uuid
    ORDER BY created_at DESC, key_hash`;
}

export async function demKhoaDangHoatDong(sql: Sql, tenantId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM api_key
    WHERE tenant_id = ${tenantId}::uuid AND active AND revoked_at IS NULL`;
  return rows[0]?.n ?? 0;
}
