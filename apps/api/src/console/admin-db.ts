import type postgres from 'postgres';
import type { getSql } from '../db';

/**
 * Câu SQL về tài khoản khách hàng dành cho TRANG ADMIN. Cố ý tách khỏi `console/db.ts`: mọi câu
 * bên đó mang điều kiện theo tài khoản/tenant của phiên, còn bên này KHÔNG có điều kiện đó — admin
 * đọc mọi tài khoản. Để chung một file là mời một ngày nào đó route khách hàng import nhầm câu
 * không giới hạn. Chỉ `routes/admin-customers.ts` được import file này.
 */

type Sql = ReturnType<typeof getSql>;
/**
 * `docTaiKhoanAdmin` được gọi cả với client thường LẪN với `tx` bên trong `sql.begin()` (đọc lại
 * trong cùng transaction — xem `voHieuHoaTaiKhoan`/`kichHoatLaiTaiKhoan`). `postgres.TransactionSql`
 * không tự gán được vào `Sql`: hai interface khác nhau dù cùng có tagged-template call và
 * `.unsafe`, nên phải khai rộng kiểu tham số ra hợp của cả hai.
 */
type SqlHoacTx = Sql | postgres.TransactionSql;

export interface TaiKhoanAdmin {
  id: string;
  email: string;
  name: string | null;
  google_linked: boolean;
  last_login_at: Date | null;
  disabled_at: Date | null;
  created_at: Date;
  /** Tenant đầu tiên mà tài khoản là owner; null khi chưa tạo tổ chức. */
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_quota_mode: string | null;
}

export interface TaiKhoanAdminDong extends TaiKhoanAdmin {
  cursor_at: string;
}

/**
 * Cột chung. `google_sub` KHÔNG trả ra — admin chỉ cần biết "đã liên kết Google hay chưa", còn
 * định danh Google của khách không có việc gì ở giao diện. Tenant lấy qua LATERAL ... LIMIT 1 vì
 * `tenant_member` cho phép nhiều dòng; một JOIN thường sẽ nhân đôi tài khoản trong danh sách.
 */
const COT = `a.id, a.email, a.name, (a.google_sub IS NOT NULL) AS google_linked,
  a.last_login_at, a.disabled_at, a.created_at,
  t.tenant_id, t.tenant_name, t.tenant_quota_mode`;

const TU_TENANT = `FROM customer_account a
  LEFT JOIN LATERAL (
    SELECT m.tenant_id, tn.name AS tenant_name, tn.quota_mode AS tenant_quota_mode
    FROM tenant_member m JOIN tenant tn ON tn.id = m.tenant_id
    WHERE m.account_id = a.id AND m.role = 'owner'
    ORDER BY m.created_at, m.tenant_id LIMIT 1) t ON true`;

/**
 * Danh sách tài khoản, phân trang bằng con trỏ. `p.limit` KHÔNG bị kẹp ở đây — tầng gọi (route)
 * phải tự kẹp trước khi truyền vào, nếu không một request tuỳ ý có thể đòi `LIMIT` lớn tuỳ ý.
 */
export async function danhSachTaiKhoanAdmin(
  sql: Sql,
  p: { q: string | null; limit: number; cursor: { createdAt: string; id: string } | null },
): Promise<TaiKhoanAdminDong[]> {
  const createdAt = p.cursor?.createdAt ?? null;
  const cursorId = p.cursor?.id ?? null;
  // Lấy dư một dòng để biết còn trang sau. Con trỏ giữ micro giây qua to_char và bind lại bằng
  // ::text::timestamptz — cùng khuôn với /v1/admin/tenants, cùng lý do (Date cắt còn mili giây).
  return await sql<TaiKhoanAdminDong[]>`
    SELECT ${sql.unsafe(COT)},
           to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    ${sql.unsafe(TU_TENANT)}
    WHERE (${p.q}::text IS NULL OR a.email ILIKE '%' || ${p.q} || '%'
           OR a.name ILIKE '%' || ${p.q} || '%')
      AND (${createdAt}::text IS NULL
           OR (a.created_at, a.id) < (${createdAt}::text::timestamptz, ${cursorId}::uuid))
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${p.limit + 1}`;
}

export async function docTaiKhoanAdmin(sql: SqlHoacTx, id: string): Promise<TaiKhoanAdmin | null> {
  const rows = await sql<TaiKhoanAdmin[]>`
    SELECT ${sql.unsafe(COT)} ${sql.unsafe(TU_TENANT)} WHERE a.id = ${id}::uuid`;
  return rows[0] ?? null;
}

export interface PhienAdmin {
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  user_agent: string | null;
}

/** Phiên còn hạn. KHÔNG có token_hash (bí mật) và KHÔNG có ip_hash (checklist pháp lý A7). */
export async function phienCuaTaiKhoan(sql: Sql, accountId: string): Promise<PhienAdmin[]> {
  return await sql<PhienAdmin[]>`
    SELECT created_at, last_seen_at, expires_at, user_agent
    FROM customer_session
    WHERE account_id = ${accountId}::uuid AND expires_at > now()
    ORDER BY last_seen_at DESC LIMIT 20`;
}

/**
 * Vô hiệu hoá = đặt `disabled_at` + xoá MỌI phiên, trong một transaction. Xoá phiên là phần có
 * hiệu lực tức thì (request kế tiếp của khách nhận 401); `disabled_at` là phần giữ hiệu lực khi
 * khách đăng nhập lại (console-auth trả 403 account_disabled). Gọi lại trên tài khoản đã khoá thì
 * `doi = false` nhưng phiên vẫn được quét — phòng phiên mới sinh giữa hai lần bấm.
 *
 * Đọc lại dòng tài khoản NGAY TRONG `tx`, cùng lúc với ghi — không phải một câu SELECT rời ngoài
 * transaction sau khi commit. Hai admin bấm disable/enable ngược nhau cùng lúc thì bản đọc rời đó
 * có thể trả một dòng đã bị lệnh kia ghi đè, khiến phản hồi nói sai trạng thái thật (`moi: true`
 * kèm `disabledAt: null`) trong khi audit lại ghi đã khoá. Đọc trong cùng `tx` loại bỏ đường đua
 * đó, và bớt luôn một lượt round-trip Hyperdrive.
 */
export async function voHieuHoaTaiKhoan(
  sql: Sql,
  accountId: string,
): Promise<{ doi: boolean; phienXoa: number; tk: TaiKhoanAdmin | null }> {
  return await sql.begin(async (tx) => {
    const doi = await tx<{ id: string }[]>`
      UPDATE customer_account SET disabled_at = now()
      WHERE id = ${accountId}::uuid AND disabled_at IS NULL RETURNING id`;
    // RETURNING account_id chứ không phải token_hash — chỉ cần đếm số dòng xoá được, không có lý
    // do gì kéo băm phiên vào bộ nhớ Worker rồi có thể lọt vào một stack dump nào đó sau này.
    const phien = await tx<{ account_id: string }[]>`
      DELETE FROM customer_session WHERE account_id = ${accountId}::uuid RETURNING account_id`;
    const tk = await docTaiKhoanAdmin(tx, accountId);
    return { doi: doi.length > 0, phienXoa: phien.length, tk };
  });
}

/** Cùng lý do đọc-trong-tx với `voHieuHoaTaiKhoan` ở trên: ghi và đọc lại phải chung một `tx`. */
export async function kichHoatLaiTaiKhoan(
  sql: Sql,
  accountId: string,
): Promise<{ doi: boolean; tk: TaiKhoanAdmin | null }> {
  return await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      UPDATE customer_account SET disabled_at = NULL
      WHERE id = ${accountId}::uuid AND disabled_at IS NOT NULL RETURNING id`;
    const tk = await docTaiKhoanAdmin(tx, accountId);
    return { doi: rows.length > 0, tk };
  });
}
