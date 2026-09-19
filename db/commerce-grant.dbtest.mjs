// Chạy: pnpm exec vitest run --config vitest.db.config.ts db/commerce-grant.dbtest.mjs
// (cần Postgres dev: pnpm db:up && pnpm db:migrate). Chỉ chạy trên DB local.
//
// Cùng lý do với console-grant.dbtest.mjs: `pnpm test:api-db` nối DB bằng role CHỦ SỞ HỮU, nên
// thiếu một dòng GRANT vẫn xanh ở máy rồi đỏ trên production. Mỗi câu dưới đây là câu MÃ THẬT gửi
// đi (chép từ apps/api/src/commerce/db.ts), chạy dưới `SET ROLE api`, cộng những câu PHẢI bị từ chối.
import 'dotenv/config';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../scripts/lib/migrations.mjs';

const url = databaseUrlFromEnv(process.env);
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
  throw new Error(`dbtest chỉ chạy trên DB local, không phải ${host}`);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });

const TENANT = 'Kiểm GRANT đơn hàng';
const EMAIL = 'kiem-grant-don-hang@vidu.vn';
/** @type {string} */ let tenantId;
/** @type {string} */ let accountId;
/** @type {string} */ let orderId;

/** @param {() => Promise<unknown>} fn */
async function duoiRoleApi(fn) {
  await sql.unsafe('SET ROLE api');
  try {
    return await fn();
  } finally {
    await sql.unsafe('RESET ROLE');
  }
}

const COT_DON = `id, order_code::int AS order_code, tenant_id, account_id, kind, tier, months,
  quota_group, packs, amount_vnd::int AS amount_vnd, amount_usd_cents, status, provider,
  payment_link_id, checkout_url, qr_code, link_expires_at, paid_at,
  paid_amount_vnd::int AS paid_amount_vnd, fulfilled_at, fulfil_attempts, fulfil_error,
  entitlement_receipt, note, created_at, updated_at`;

async function don() {
  await sql`DELETE FROM payment_event WHERE reference LIKE 'kiem-grant:%'`;
  await sql`DELETE FROM payment_event WHERE order_id IN (
    SELECT id FROM customer_order WHERE tenant_id IN (SELECT id FROM tenant WHERE name = ${TENANT}))`;
  await sql`DELETE FROM customer_order WHERE tenant_id IN (SELECT id FROM tenant WHERE name = ${TENANT})`;
  await sql`DELETE FROM tenant_member WHERE tenant_id IN (SELECT id FROM tenant WHERE name = ${TENANT})`;
  await sql`DELETE FROM customer_account WHERE email = ${EMAIL}`;
  await sql`DELETE FROM tenant WHERE name = ${TENANT}`;
}

describe('GRANT của migration 0023 dưới role api', () => {
  beforeAll(async () => {
    await don();
    [{ id: tenantId }] = await sql`
      INSERT INTO tenant (name, plan, quota_mode) VALUES (${TENANT}, 'free', 'commercial')
      RETURNING id`;
    [{ id: accountId }] = await sql`
      INSERT INTO customer_account (email) VALUES (${EMAIL}) RETURNING id`;
    await sql`INSERT INTO tenant_member (tenant_id, account_id, role)
      VALUES (${tenantId}::uuid, ${accountId}::uuid, 'owner')`;
  });

  afterAll(async () => {
    await don();
    await sql.end({ timeout: 5 });
  });

  it('taoDon: INSERT … RETURNING chạy được, order_code bắt đầu từ 100001 và về dạng SỐ', async () => {
    const [moi] = await duoiRoleApi(() =>
      sql.unsafe(
        `INSERT INTO customer_order
           (tenant_id, account_id, kind, tier, months, quota_group, packs, amount_vnd, amount_usd_cents, status)
         VALUES ($1::uuid, $2::uuid, 'plan', 'starter', 3, NULL, NULL, 1950000, 7500, 'pending')
         RETURNING ${COT_DON}`,
        [tenantId, accountId],
      ),
    );
    orderId = moi.id;
    expect(moi.order_code).toBeGreaterThanOrEqual(100001);
    // bigint qua postgres.js là CHUỖI nếu quên ::int; đơn 124.800.000đ vẫn nằm gọn trong int4.
    expect(typeof moi.order_code).toBe('number');
    expect(moi.amount_vnd).toBe(1950000);
  });

  it('mọi câu ĐỌC của khách, cron và admin chạy được dưới role api', async () => {
    await duoiRoleApi(async () => {
      expect(
        await sql.unsafe(
          `SELECT ${COT_DON} FROM customer_order WHERE tenant_id = $1::uuid AND id = $2::uuid`,
          [tenantId, orderId],
        ),
      ).toHaveLength(1);
      expect(
        await sql`SELECT count(*)::int AS n FROM customer_order
          WHERE tenant_id = ${tenantId}::uuid AND status = 'pending'`,
      ).toEqual([{ n: 1 }]);
      await sql.unsafe(`SELECT ${COT_DON} FROM customer_order
        WHERE status IN ('paid', 'paid_unfulfilled') AND fulfil_attempts < 20
        ORDER BY updated_at ASC LIMIT 20`);
      await sql.unsafe(`SELECT ${COT_DON} FROM customer_order
        WHERE status = 'pending' AND payment_link_id IS NOT NULL
          AND created_at < now() - interval '10 minutes' AND link_expires_at > now()
        ORDER BY created_at ASC LIMIT 30`);
      await sql.unsafe(`SELECT ${COT_DON} FROM customer_order
        WHERE status = 'pending'
          AND ((link_expires_at IS NOT NULL AND link_expires_at + interval '1 hour' < now())
            OR (link_expires_at IS NULL AND created_at + interval '24 hours' < now()))
        ORDER BY created_at ASC LIMIT 100`);
      // from/to bind Date THẬT (không phải null) — repo đã trả giá hai lần vì bind qua Postgres
      // trên Workers không giống bind ở máy dev (mảng SQL, timestamp mất micro giây); vế con trỏ
      // cũng có mặt cho khớp đúng câu mã thật, dù giá trị null.
      const tuNgay = new Date('2020-01-01T00:00:00.000Z');
      const denNgay = new Date('2100-01-01T00:00:00.000Z');
      expect(
        await sql`SELECT o.id,
          to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
          t.name AS tenant_name
        FROM customer_order o JOIN tenant t ON t.id = o.tenant_id
        WHERE (${null}::text IS NULL OR o.status = ${null})
          AND (${tenantId}::uuid IS NULL OR o.tenant_id = ${tenantId}::uuid)
          AND (${tuNgay}::timestamptz IS NULL OR o.created_at >= ${tuNgay}::timestamptz)
          AND (${denNgay}::timestamptz IS NULL OR o.created_at < ${denNgay}::timestamptz)
          AND (${null}::text IS NULL
               OR (o.created_at, o.id) < (${null}::text::timestamptz, ${null}::uuid))
        ORDER BY o.created_at DESC, o.id DESC LIMIT 26`,
      ).toHaveLength(1);
      await sql`SELECT
        (SELECT count(*)::int FROM customer_order WHERE status IN ('paid_unfulfilled', 'underpaid')) AS cho_xu_ly,
        (SELECT coalesce(sum(paid_amount_vnd), 0)::int FROM customer_order
          WHERE status = 'fulfilled' AND paid_at >= now() - interval '30 days') AS doanh_thu,
        (SELECT count(*)::int FROM payment_event WHERE order_id IS NULL) AS khong_khop`;
      await sql`SELECT a.email, t.billing_email, t.name, a.id AS account_id
        FROM tenant t
        JOIN tenant_member m ON m.tenant_id = t.id AND m.role = 'owner'
        JOIN customer_account a ON a.id = m.account_id
        WHERE t.id = ${tenantId}::uuid ORDER BY m.created_at LIMIT 1`;
      await sql`SELECT t.id, t.name, a.email
        FROM tenant t
        JOIN tenant_member m ON m.tenant_id = t.id AND m.role = 'owner'
        JOIN customer_account a ON a.id = m.account_id AND a.disabled_at IS NULL
        WHERE t.quota_mode = 'commercial' ORDER BY t.created_at LIMIT 200`;
      await sql`SELECT EXISTS(SELECT 1 FROM admin_audit
        WHERE action = 'email.reminder' AND target = 'x') AS co`;
    });
  });

  it('mọi UPDATE của máy trạng thái chạy được, theo đúng thứ tự pending → paid → fulfilled', async () => {
    await duoiRoleApi(async () => {
      await sql`UPDATE customer_order
        SET payment_link_id = 'l', checkout_url = 'u', qr_code = NULL,
            link_expires_at = now() + interval '1 day', updated_at = now()
        WHERE id = ${orderId}::uuid AND status = 'pending'`;
      expect(
        await sql`UPDATE customer_order
          SET status = 'paid', paid_amount_vnd = 1950000, paid_at = now(), updated_at = now()
          WHERE id = ${orderId}::uuid AND status IN ('pending', 'underpaid', 'expired', 'cancelled')
          RETURNING id`,
      ).toHaveLength(1);
      await sql`UPDATE customer_order
        SET status = 'paid_unfulfilled', fulfil_attempts = fulfil_attempts + 1,
            fulfil_error = 'thu', updated_at = now()
        WHERE id = ${orderId}::uuid AND status IN ('paid', 'paid_unfulfilled')`;
      expect(
        await sql`UPDATE customer_order
          SET status = 'fulfilled', fulfilled_at = now(),
              entitlement_receipt = ${sql.json({ revision: 1 })}, fulfil_error = NULL, updated_at = now()
          WHERE id = ${orderId}::uuid AND status IN ('paid', 'paid_unfulfilled')
          RETURNING id`,
      ).toHaveLength(1);
      // Ba câu còn lại không đổi dòng nào (trạng thái không khớp) nhưng phải KHÔNG bị từ chối quyền.
      await sql`UPDATE customer_order SET status = 'underpaid', paid_amount_vnd = 1, updated_at = now()
        WHERE id = ${orderId}::uuid AND status IN ('pending', 'underpaid') RETURNING id`;
      await sql`UPDATE customer_order SET status = 'expired', updated_at = now()
        WHERE id = ${orderId}::uuid AND status = 'pending' RETURNING id`;
      await sql`UPDATE customer_order SET status = 'cancelled', updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ${orderId}::uuid AND status = 'pending'
        RETURNING id`;
      // Hai lệnh admin của pha 4. Đơn đang fulfilled: huỷ không đổi dòng nào (đúng), hoàn tiền
      // đổi đúng một dòng. Cả hai phải KHÔNG bị từ chối quyền (status, note, updated_at đã GRANT).
      // RETURNING id, updated_at khớp NGUYÊN VĂN câu thật của huyDonAdmin/danhDauHoanTien: route
      // dựng phản hồi từ updated_at trả về đây, không đọc lại — thiếu GRANT SELECT trên cột đó chỉ
      // lộ ở đây, không lộ ở test giả lập (fake-sql không kiểm quyền).
      expect(
        await sql`UPDATE customer_order SET status = 'cancelled', note = 'kiem-grant', updated_at = now()
          WHERE id = ${orderId}::uuid AND status = 'pending' RETURNING id, updated_at`,
      ).toHaveLength(0);
      expect(
        await sql`UPDATE customer_order SET status = 'refunded', note = 'kiem-grant', updated_at = now()
          WHERE id = ${orderId}::uuid AND status = 'fulfilled' RETURNING id, updated_at`,
      ).toHaveLength(1);
    });
  });

  it('payment_event: ON CONFLICT DO NOTHING trả rỗng lần hai; sum, exists và tóm tắt chạy được', async () => {
    await duoiRoleApi(async () => {
      const chen = () => sql`
        INSERT INTO payment_event
          (order_id, provider, reference, order_code, amount_vnd, signature_valid, payload)
        VALUES (${orderId}::uuid, 'payos', 'kiem-grant:FT1', 100001, 1950000, true,
                ${sql.json({ code: '00' })})
        ON CONFLICT (provider, reference) DO NOTHING RETURNING id`;
      expect(await chen()).toHaveLength(1);
      expect(await chen()).toHaveLength(0);

      const [tong] = await sql`SELECT coalesce(sum(amount_vnd), 0)::int AS tong,
          (array_agg(reference ORDER BY id))[1] AS tham_chieu, min(received_at) AS luc
        FROM payment_event
        WHERE order_id = ${orderId}::uuid AND signature_valid AND amount_vnd IS NOT NULL`;
      expect(tong.tong).toBe(1950000);
      expect(tong.tham_chieu).toBe('kiem-grant:FT1');

      await sql`SELECT EXISTS(SELECT 1 FROM payment_event
        WHERE order_id = ${orderId}::uuid AND signature_valid AND amount_vnd IS NOT NULL) AS co`;
      await sql`SELECT EXISTS(SELECT 1 FROM payment_event
        WHERE provider = 'manual' AND reference = 'manual:x') AS co`;
      await sql`SELECT id::int AS id, order_id, provider, reference, order_code::int AS order_code,
          amount_vnd::int AS amount_vnd, signature_valid,
          jsonb_build_object('code', payload->'code', 'desc', payload->'desc') AS tom_tat, received_at
        FROM payment_event WHERE order_id IS NULL ORDER BY received_at DESC LIMIT 50`;
    });
  });

  it('cột GIÁ và nội dung đơn KHÔNG sửa được; không xoá được đơn hay sự kiện', async () => {
    // Đây là vế thứ hai của phân quyền: cửa hẹp mở được, cửa rộng phải vẫn khoá.
    await duoiRoleApi(async () => {
      for (const cau of [
        sql`UPDATE customer_order SET amount_vnd = 1 WHERE id = ${orderId}::uuid`,
        sql`UPDATE customer_order SET tenant_id = ${tenantId}::uuid WHERE id = ${orderId}::uuid`,
        sql`UPDATE customer_order SET tier = 'business' WHERE id = ${orderId}::uuid`,
        sql`UPDATE customer_order SET order_code = 1 WHERE id = ${orderId}::uuid`,
        sql`DELETE FROM customer_order WHERE id = ${orderId}::uuid`,
        sql`UPDATE payment_event SET amount_vnd = 1 WHERE reference = 'kiem-grant:FT1'`,
        sql`DELETE FROM payment_event WHERE reference = 'kiem-grant:FT1'`,
      ]) {
        await expect(cau).rejects.toMatchObject({ code: '42501' });
      }
    });
  });
});
