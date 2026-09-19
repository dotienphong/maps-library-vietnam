import type { OrderInput, PaidTier, PeriodMonths, Quote, QuotaGroup } from '@mapslibvn/catalog';
import type { getSql } from '../db';

/**
 * Mọi câu SQL của nhóm đơn hàng nằm đúng ở đây, cùng lý do với console/db.ts: câu của khách phải
 * mang `tenant_id` của phiên, câu đổi trạng thái phải mang điều kiện trạng thái cũ, và rải chúng
 * khắp các route là cách chắc chắn để một ngày nào đó quên mất một điều kiện.
 *
 * Cột `bigint` (order_code, amount_vnd, paid_amount_vnd) đọc qua `::int`: postgres.js với
 * `fetch_types: false` trả bigint dưới dạng CHUỖI, và 124.800.000 — đơn lớn nhất của catalog —
 * nằm gọn trong int4.
 */

type Sql = ReturnType<typeof getSql>;

export type TrangThaiDon =
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'paid_unfulfilled'
  | 'underpaid'
  | 'expired'
  | 'cancelled'
  | 'refunded';

export interface DonHang {
  id: string;
  order_code: number;
  tenant_id: string;
  account_id: string;
  kind: 'plan' | 'addon';
  tier: PaidTier | null;
  months: PeriodMonths | null;
  quota_group: QuotaGroup | null;
  packs: number | null;
  amount_vnd: number;
  amount_usd_cents: number;
  status: TrangThaiDon;
  provider: string;
  payment_link_id: string | null;
  checkout_url: string | null;
  qr_code: string | null;
  link_expires_at: Date | null;
  paid_at: Date | null;
  paid_amount_vnd: number | null;
  fulfilled_at: Date | null;
  fulfil_attempts: number;
  fulfil_error: string | null;
  entitlement_receipt: unknown;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

const COT_DON = `id, order_code::int AS order_code, tenant_id, account_id, kind, tier, months,
  quota_group, packs, amount_vnd::int AS amount_vnd, amount_usd_cents, status, provider,
  payment_link_id, checkout_url, qr_code, link_expires_at, paid_at,
  paid_amount_vnd::int AS paid_amount_vnd, fulfilled_at, fulfil_attempts, fulfil_error,
  entitlement_receipt, note, created_at, updated_at`;

/** Cùng danh sách cột, thêm tiền tố `o.` cho câu admin có JOIN với tenant. */
const COT_DON_O = `o.id, o.order_code::int AS order_code, o.tenant_id, o.account_id, o.kind, o.tier,
  o.months, o.quota_group, o.packs, o.amount_vnd::int AS amount_vnd, o.amount_usd_cents, o.status,
  o.provider, o.payment_link_id, o.checkout_url, o.qr_code, o.link_expires_at, o.paid_at,
  o.paid_amount_vnd::int AS paid_amount_vnd, o.fulfilled_at, o.fulfil_attempts, o.fulfil_error,
  o.entitlement_receipt, o.note, o.created_at, o.updated_at`;

/**
 * `sql.json()` khai kiểu `JSONValue` của postgres.js, còn dữ liệu ở đây tới từ `JSON.parse` nên
 * TypeScript chỉ biết `unknown`. Ép kiểu đúng MỘT chỗ kèm lý do, thay vì rải `as never` khắp nơi.
 * Bắt buộc phải đi qua `sql.json`: truyền chuỗi đã `JSON.stringify` kèm `::jsonb` khiến postgres.js
 * stringify lần nữa và cột giữ một *chuỗi* JSON — cùng bẫy mà audit.ts và edits.ts đã vấp.
 */
const jsonb = (sql: Sql, gia: unknown) => sql.json(gia as never);

/** Nội dung chuyển khoản: 'MLV' + orderCode, đúng 9 ký tự — trần của PayOS (spec 5.2). */
export const noiDungChuyenKhoan = (orderCode: number): string => `MLV${orderCode}`;

export async function taoDon(
  sql: Sql,
  input: { tenantId: string; accountId: string; don: OrderInput; gia: Quote },
): Promise<DonHang> {
  const d = input.don;
  const tier = d.kind === 'plan' ? d.tier : null;
  const months = d.kind === 'plan' ? d.months : null;
  const group = d.kind === 'addon' ? d.group : null;
  const packs = d.kind === 'addon' ? d.packs : null;
  const rows = await sql<DonHang[]>`
    INSERT INTO customer_order
      (tenant_id, account_id, kind, tier, months, quota_group, packs, amount_vnd, amount_usd_cents, status)
    VALUES (${input.tenantId}::uuid, ${input.accountId}::uuid, ${d.kind}, ${tier}, ${months},
            ${group}, ${packs}, ${input.gia.amountVnd}, ${input.gia.amountUsdCents}, 'pending')
    RETURNING ${sql.unsafe(COT_DON)}`;
  return rows[0] as DonHang;
}

/**
 * Đơn pending cùng nội dung mà PayOS chưa cấp link (lần trước PayOS lỗi). Khách bấm lại thì dùng
 * lại đơn đó thay vì đẻ thêm đơn — spec 9.1 bước 4.
 */
export async function timDonPendingChuaCoLink(
  sql: Sql,
  tenantId: string,
  don: OrderInput,
): Promise<DonHang | null> {
  const tier = don.kind === 'plan' ? don.tier : null;
  const months = don.kind === 'plan' ? don.months : null;
  const group = don.kind === 'addon' ? don.group : null;
  const packs = don.kind === 'addon' ? don.packs : null;
  const rows = await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE tenant_id = ${tenantId}::uuid AND status = 'pending' AND payment_link_id IS NULL
      AND kind = ${don.kind} AND tier IS NOT DISTINCT FROM ${tier}
      AND months IS NOT DISTINCT FROM ${months}
      AND quota_group IS NOT DISTINCT FROM ${group} AND packs IS NOT DISTINCT FROM ${packs}
    ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ?? null;
}

export async function luuLinkThanhToan(
  sql: Sql,
  orderId: string,
  link: { paymentLinkId: string; checkoutUrl: string; qrCode: string | null; linkExpiresAt: Date },
): Promise<void> {
  await sql`
    UPDATE customer_order
    SET payment_link_id = ${link.paymentLinkId}, checkout_url = ${link.checkoutUrl},
        qr_code = ${link.qrCode}, link_expires_at = ${link.linkExpiresAt}, updated_at = now()
    WHERE id = ${orderId}::uuid AND status = 'pending'`;
}

export async function docDonCuaTenant(
  sql: Sql,
  tenantId: string,
  orderId: string,
): Promise<DonHang | null> {
  const rows = await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE tenant_id = ${tenantId}::uuid AND id = ${orderId}::uuid`;
  return rows[0] ?? null;
}

export async function danhSachDonCuaTenant(
  sql: Sql,
  tenantId: string,
  limit = 50,
): Promise<DonHang[]> {
  return await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE tenant_id = ${tenantId}::uuid
    ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
}

export async function demDonPending(sql: Sql, tenantId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM customer_order
    WHERE tenant_id = ${tenantId}::uuid AND status = 'pending'`;
  return rows[0]?.n ?? 0;
}

/** Đọc đơn KHÔNG theo tenant — chỉ cho webhook, cron và admin, không bao giờ cho route của khách. */
export async function docDon(sql: Sql, orderId: string): Promise<DonHang | null> {
  const rows = await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order WHERE id = ${orderId}::uuid`;
  return rows[0] ?? null;
}

export async function docDonTheoOrderCode(sql: Sql, orderCode: number): Promise<DonHang | null> {
  const rows = await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order WHERE order_code = ${orderCode}`;
  return rows[0] ?? null;
}

export interface SuKienMoi {
  orderId: string | null;
  provider: string;
  reference: string;
  orderCode: number | null;
  /** null khi sự kiện không phải "tiền vào" hợp lệ; tổng tiền chỉ cộng cột này. */
  amountVnd: number | null;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}

/** true nếu là sự kiện MỚI; false nếu `(provider, reference)` đã có — PayOS gửi lại. */
export async function ghiSuKienThanhToan(sql: Sql, ev: SuKienMoi): Promise<boolean> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO payment_event
      (order_id, provider, reference, order_code, amount_vnd, signature_valid, payload)
    VALUES (${ev.orderId}::uuid, ${ev.provider}, ${ev.reference}, ${ev.orderCode},
            ${ev.amountVnd}, ${ev.signatureValid}, ${jsonb(sql, ev.payload)})
    ON CONFLICT (provider, reference) DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

/**
 * Tổng tiền đã nhận của một đơn và mã tham chiếu ĐẦU TIÊN — mã đó là `paymentReference` gửi sang
 * sổ quota, và phải ổn định qua mọi lần gọi lại để `business_identity` nhận ra cùng một đơn.
 */
export async function tongTienDaNhan(
  sql: Sql,
  orderId: string,
): Promise<{ tong: number; thamChieu: string | null; luc: Date | null }> {
  const rows = await sql<{ tong: number; tham_chieu: string | null; luc: Date | null }[]>`
    SELECT coalesce(sum(amount_vnd), 0)::int AS tong,
           (array_agg(reference ORDER BY id))[1] AS tham_chieu,
           min(received_at) AS luc
    FROM payment_event
    WHERE order_id = ${orderId}::uuid AND signature_valid AND amount_vnd IS NOT NULL`;
  const r = rows[0];
  return { tong: r?.tong ?? 0, thamChieu: r?.tham_chieu ?? null, luc: r?.luc ?? null };
}

/** Một sự kiện với khoá (provider, reference) đã tồn tại chưa — cho lệnh admin gọi lại. */
export async function daCoSuKien(sql: Sql, provider: string, reference: string): Promise<boolean> {
  const rows = await sql<{ co: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM payment_event
      WHERE provider = ${provider} AND reference = ${reference}) AS co`;
  return rows[0]?.co === true;
}

/** Tiền vào cho đơn đã expired/cancelled vẫn chuyển paid: tiền đã rời tài khoản khách. */
export async function datDaTra(
  sql: Sql,
  orderId: string,
  paidAmountVnd: number,
  paidAt: Date,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order
    SET status = 'paid', paid_amount_vnd = ${paidAmountVnd}, paid_at = ${paidAt}, updated_at = now()
    WHERE id = ${orderId}::uuid AND status IN ('pending', 'underpaid', 'expired', 'cancelled')
    RETURNING id`;
  return rows.length > 0;
}

export async function datThieuTien(
  sql: Sql,
  orderId: string,
  paidAmountVnd: number,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order
    SET status = 'underpaid', paid_amount_vnd = ${paidAmountVnd}, updated_at = now()
    WHERE id = ${orderId}::uuid AND status IN ('pending', 'underpaid')
    RETURNING id`;
  return rows.length > 0;
}

/** Chỉ gọi SAU khi sổ quota đã trả biên lai — `fulfilled` không bao giờ đặt trước rồi hy vọng. */
export async function datDaCap(sql: Sql, orderId: string, receipt: unknown): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order
    SET status = 'fulfilled', fulfilled_at = now(),
        entitlement_receipt = ${jsonb(sql, receipt)},
        fulfil_error = NULL, updated_at = now()
    WHERE id = ${orderId}::uuid AND status IN ('paid', 'paid_unfulfilled')
    RETURNING id`;
  return rows.length > 0;
}

export async function datCapHong(sql: Sql, orderId: string, maLoi: string): Promise<void> {
  await sql`
    UPDATE customer_order
    SET status = 'paid_unfulfilled', fulfil_attempts = fulfil_attempts + 1,
        fulfil_error = ${maLoi.slice(0, 200)}, updated_at = now()
    WHERE id = ${orderId}::uuid AND status IN ('paid', 'paid_unfulfilled')`;
}

export async function datHetHan(sql: Sql, orderId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order SET status = 'expired', updated_at = now()
    WHERE id = ${orderId}::uuid AND status = 'pending' RETURNING id`;
  return rows.length > 0;
}

export async function huyDonCuaTenant(
  sql: Sql,
  tenantId: string,
  orderId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order SET status = 'cancelled', updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid AND id = ${orderId}::uuid AND status = 'pending'
    RETURNING id`;
  return rows.length > 0;
}

// ---- cron ----

export async function donCanCapLai(sql: Sql, tranThu: number, limit = 20): Promise<DonHang[]> {
  return await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE status IN ('paid', 'paid_unfulfilled') AND fulfil_attempts < ${tranThu}
    ORDER BY updated_at ASC LIMIT ${limit}`;
}

/** Pending có link, tạo quá 10 phút, link chưa hết hạn — ứng viên hỏi PayOS phòng webhook rơi. */
export async function donPendingCanDoiSoat(
  sql: Sql,
  now: Date,
  limit = 30,
): Promise<DonHang[]> {
  return await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE status = 'pending' AND payment_link_id IS NOT NULL
      AND created_at < ${now}::timestamptz - interval '10 minutes'
      AND link_expires_at > ${now}::timestamptz
    ORDER BY created_at ASC LIMIT ${limit}`;
}

/** Pending quá `link_expires_at` + 1 giờ, hoặc chưa từng có link mà đã quá 24 giờ. */
export async function donPendingQuaHan(sql: Sql, now: Date, limit = 100): Promise<DonHang[]> {
  return await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE status = 'pending'
      AND ((link_expires_at IS NOT NULL AND link_expires_at + interval '1 hour' < ${now}::timestamptz)
        OR (link_expires_at IS NULL AND created_at + interval '24 hours' < ${now}::timestamptz))
    ORDER BY created_at ASC LIMIT ${limit}`;
}

export async function coSuKienHopLe(sql: Sql, orderId: string): Promise<boolean> {
  const rows = await sql<{ co: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM payment_event
      WHERE order_id = ${orderId}::uuid AND signature_valid AND amount_vnd IS NOT NULL) AS co`;
  return rows[0]?.co === true;
}

export interface ChuTenant {
  email: string;
  billingEmail: string | null;
  tenantName: string;
}

export async function chuTenant(sql: Sql, tenantId: string): Promise<ChuTenant | null> {
  const rows = await sql<{ email: string; billing_email: string | null; name: string }[]>`
    SELECT a.email, t.billing_email, t.name
    FROM tenant t
    JOIN tenant_member m ON m.tenant_id = t.id AND m.role = 'owner'
    JOIN customer_account a ON a.id = m.account_id
    WHERE t.id = ${tenantId}::uuid
    ORDER BY m.created_at LIMIT 1`;
  const r = rows[0];
  return r ? { email: r.email, billingEmail: r.billing_email, tenantName: r.name } : null;
}

/** Tenant thương mại có chủ sở hữu còn hoạt động — ứng viên nhận thư nhắc hạn. */
export async function tenantThuongMaiCoChu(
  sql: Sql,
  limit = 200,
): Promise<{ id: string; name: string; email: string }[]> {
  return await sql<{ id: string; name: string; email: string }[]>`
    SELECT t.id, t.name, a.email
    FROM tenant t
    JOIN tenant_member m ON m.tenant_id = t.id AND m.role = 'owner'
    JOIN customer_account a ON a.id = m.account_id AND a.disabled_at IS NULL
    WHERE t.quota_mode = 'commercial'
    ORDER BY t.created_at LIMIT ${limit}`;
}

/** Chống gửi hai thư nhắc cho cùng (tenant, kỳ, loại) — không cần cột mới, spec 9.4. */
export async function daNhacRoi(sql: Sql, target: string): Promise<boolean> {
  const rows = await sql<{ co: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM admin_audit
      WHERE action = 'email.reminder' AND target = ${target}) AS co`;
  return rows[0]?.co === true;
}

export async function donDepPhienVaMa(
  sql: Sql,
  now: Date,
): Promise<{ ma: number; phien: number }> {
  const ma = await sql<{ id: number }[]>`
    DELETE FROM customer_login_code WHERE expires_at < ${now}::timestamptz RETURNING id`;
  const phien = await sql<{ token_hash: string }[]>`
    DELETE FROM customer_session WHERE expires_at < ${now}::timestamptz RETURNING token_hash`;
  return { ma: ma.length, phien: phien.length };
}

// ---- admin ----

export interface DonHangAdmin extends DonHang {
  tenant_name: string;
  cursor_at: string;
}

export async function danhSachDonAdmin(
  sql: Sql,
  p: {
    status: TrangThaiDon | null;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  },
): Promise<DonHangAdmin[]> {
  const createdAt = p.cursor?.createdAt ?? null;
  const cursorId = p.cursor?.id ?? null;
  // Lấy dư một dòng để biết còn trang sau; to_char giữ micro giây cho con trỏ, và bind lại bằng
  // ::text::timestamptz — đi qua Date của JavaScript sẽ cắt mất ba chữ số cuối.
  return await sql<DonHangAdmin[]>`
    SELECT ${sql.unsafe(COT_DON_O)},
           t.name AS tenant_name,
           to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    FROM customer_order o
    JOIN tenant t ON t.id = o.tenant_id
    WHERE (${p.status}::text IS NULL OR o.status = ${p.status})
      AND (${createdAt}::text IS NULL
           OR (o.created_at, o.id) < (${createdAt}::text::timestamptz, ${cursorId}::uuid))
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ${p.limit + 1}`;
}

export interface SuKien {
  id: number;
  order_id: string | null;
  provider: string;
  reference: string;
  order_code: number | null;
  amount_vnd: number | null;
  signature_valid: boolean;
  /** Thu gọn: không trả nguyên payload ra giao diện — nó có số tài khoản đối ứng của người trả. */
  tom_tat: Record<string, unknown>;
  received_at: Date;
}

const COT_SU_KIEN = `id::int AS id, order_id, provider, reference, order_code::int AS order_code,
  amount_vnd::int AS amount_vnd, signature_valid,
  jsonb_build_object('code', payload->'code', 'desc', payload->'desc',
    'orderCode', payload->'orderCode', 'amount', payload->'amount',
    'transactionDateTime', payload->'transactionDateTime', 'reason', payload->'reason',
    'bankReference', payload->'bankReference', 'nguon', payload->'nguon') AS tom_tat,
  received_at`;

export async function suKienCuaDon(sql: Sql, orderId: string): Promise<SuKien[]> {
  return await sql<SuKien[]>`
    SELECT ${sql.unsafe(COT_SU_KIEN)} FROM payment_event
    WHERE order_id = ${orderId}::uuid ORDER BY id`;
}

export async function suKienKhongKhop(sql: Sql, limit = 50): Promise<SuKien[]> {
  return await sql<SuKien[]>`
    SELECT ${sql.unsafe(COT_SU_KIEN)} FROM payment_event
    WHERE order_id IS NULL ORDER BY received_at DESC LIMIT ${limit}`;
}

export interface TomTatDon {
  choXuLy: number;
  doanhThu30Ngay: number;
  pendingQua1Gio: number;
  khongKhop: number;
}

export async function tomTatDon(sql: Sql, now: Date): Promise<TomTatDon> {
  const rows = await sql<
    { cho_xu_ly: number; doanh_thu: number; pending_qua: number; khong_khop: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM customer_order
        WHERE status IN ('paid_unfulfilled', 'underpaid')) AS cho_xu_ly,
      (SELECT coalesce(sum(paid_amount_vnd), 0)::int FROM customer_order
        WHERE status = 'fulfilled' AND paid_at >= ${now}::timestamptz - interval '30 days') AS doanh_thu,
      (SELECT count(*)::int FROM customer_order
        WHERE status = 'pending' AND created_at < ${now}::timestamptz - interval '1 hour') AS pending_qua,
      (SELECT count(*)::int FROM payment_event WHERE order_id IS NULL) AS khong_khop`;
  const r = rows[0];
  return {
    choXuLy: r?.cho_xu_ly ?? 0,
    doanhThu30Ngay: r?.doanh_thu ?? 0,
    pendingQua1Gio: r?.pending_qua ?? 0,
    khongKhop: r?.khong_khop ?? 0,
  };
}
