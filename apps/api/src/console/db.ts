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
  const rows = await sql<TaiKhoan[]>`
    INSERT INTO customer_account (email) VALUES (${email})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
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
