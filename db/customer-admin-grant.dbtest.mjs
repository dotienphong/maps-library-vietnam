// Chạy: pnpm exec vitest run --config vitest.db.config.ts db/customer-admin-grant.dbtest.mjs
// (cần Postgres dev: pnpm db:up && pnpm db:migrate). Chỉ chạy trên DB local.
//
// Cùng lý do với console-grant và commerce-grant: `pnpm test:api-db` nối DB bằng role CHỦ SỞ HỮU,
// nên thiếu GRANT vẫn xanh ở máy rồi đỏ trên production. Mỗi câu dưới đây là câu MÃ THẬT của
// apps/api/src/console/admin-db.ts (pha 4), chạy dưới `SET ROLE api`, cộng hai câu PHẢI bị từ chối.
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

const EMAIL = 'kiem-grant-admin-khach@vidu.vn';
const TENANT = 'Kiểm GRANT admin khách';
/** Tenant thứ hai, cùng chủ sở hữu — để bắt trường hợp LATERAL nhân dòng nếu thiếu LIMIT 1. */
const TENANT2 = 'Kiểm GRANT admin khách 2';
const TOKEN = 'c'.repeat(64);
/** @type {string} */ let accountId;
/** @type {string} */ let tenantId;

/** @param {() => Promise<unknown>} fn */
async function duoiRoleApi(fn) {
  await sql.unsafe('SET ROLE api');
  try {
    return await fn();
  } finally {
    await sql.unsafe('RESET ROLE');
  }
}

async function don() {
  await sql`DELETE FROM customer_session WHERE token_hash = ${TOKEN}`;
  await sql`DELETE FROM tenant_member WHERE tenant_id IN (SELECT id FROM tenant WHERE name IN (${TENANT}, ${TENANT2}))`;
  await sql`UPDATE customer_account SET trial_tenant_id = NULL WHERE email = ${EMAIL}`;
  await sql`DELETE FROM tenant WHERE name IN (${TENANT}, ${TENANT2})`;
  await sql`DELETE FROM customer_account WHERE email = ${EMAIL}`;
}

const COT = `a.id, a.email, a.name, (a.google_sub IS NOT NULL) AS google_linked,
  a.last_login_at, a.disabled_at, a.created_at,
  t.tenant_id, t.tenant_name, t.tenant_quota_mode`;
const TU_TENANT = `FROM customer_account a
  LEFT JOIN LATERAL (
    SELECT m.tenant_id, tn.name AS tenant_name, tn.quota_mode AS tenant_quota_mode
    FROM tenant_member m JOIN tenant tn ON tn.id = m.tenant_id
    WHERE m.account_id = a.id AND m.role = 'owner'
    ORDER BY m.created_at, m.tenant_id LIMIT 1) t ON true`;

describe('GRANT cho admin tài khoản khách (pha 4) dưới role api', () => {
  beforeAll(async () => {
    await don();
    [{ id: accountId }] = await sql`
      INSERT INTO customer_account (email, name) VALUES (${EMAIL}, 'Kiểm Grant') RETURNING id`;
    [{ id: tenantId }] = await sql`
      INSERT INTO tenant (name, plan, quota_mode) VALUES (${TENANT}, 'free', 'commercial') RETURNING id`;
    await sql`INSERT INTO tenant_member (tenant_id, account_id, role)
      VALUES (${tenantId}::uuid, ${accountId}::uuid, 'owner')`;
    // Tenant thứ hai, cùng chủ sở hữu, tạo trong cùng lần beforeAll nên created_at có thể trùng
    // giây với tenant đầu — đúng kịch bản mà thiếu tie-breaker (m.tenant_id) sẽ làm LATERAL trả
    // ngẫu nhiên giữa hai lần chạy.
    const [{ id: tenantId2 }] = await sql`
      INSERT INTO tenant (name, plan, quota_mode) VALUES (${TENANT2}, 'free', 'commercial') RETURNING id`;
    await sql`INSERT INTO tenant_member (tenant_id, account_id, role)
      VALUES (${tenantId2}::uuid, ${accountId}::uuid, 'owner')`;
    await sql`INSERT INTO customer_session (token_hash, account_id, expires_at, user_agent)
      VALUES (${TOKEN}, ${accountId}::uuid, now() + interval '1 day', 'kiem-grant')`;
  });

  afterAll(async () => {
    await don();
    await sql.end({ timeout: 5 });
  });

  it('danh sách có LATERAL tenant, chi tiết và phiên đều đọc được', async () => {
    await duoiRoleApi(async () => {
      const ds = await sql.unsafe(
        `SELECT ${COT},
           to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
         ${TU_TENANT}
         WHERE ($1::text IS NULL OR a.email ILIKE '%' || $1 || '%' OR a.name ILIKE '%' || $1 || '%')
           AND ($2::text IS NULL OR (a.created_at, a.id) < ($2::text::timestamptz, $3::uuid))
         ORDER BY a.created_at DESC, a.id DESC LIMIT 26`,
        ['kiem-grant-admin', null, null],
      );
      expect(ds.map((d) => d.email)).toContain(EMAIL);
      // Tài khoản là owner của HAI tenant nhưng phải chỉ hiện đúng MỘT dòng trong danh sách —
      // đây là điều mà LIMIT 1 trong LATERAL đảm bảo; thiếu nó thì dòng bị nhân đôi.
      expect(ds.filter((d) => d.email === EMAIL)).toHaveLength(1);
      expect(ds.find((d) => d.email === EMAIL).google_linked).toBe(false);

      const [chiTiet] = await sql.unsafe(`SELECT ${COT} ${TU_TENANT} WHERE a.id = $1::uuid`, [
        accountId,
      ]);
      expect(chiTiet.email).toBe(EMAIL);

      const phien = await sql`SELECT created_at, last_seen_at, expires_at, user_agent
        FROM customer_session WHERE account_id = ${accountId}::uuid AND expires_at > now()
        ORDER BY last_seen_at DESC LIMIT 20`;
      expect(phien).toHaveLength(1);
      expect(phien[0].user_agent).toBe('kiem-grant');
    });
  });

  it('vô hiệu hoá: UPDATE disabled_at + DELETE phiên trong transaction; kích hoạt lại', async () => {
    await duoiRoleApi(async () => {
      const kq = await sql.begin(async (tx) => {
        const doi = await tx`UPDATE customer_account SET disabled_at = now()
          WHERE id = ${accountId}::uuid AND disabled_at IS NULL RETURNING id`;
        const phien = await tx`DELETE FROM customer_session
          WHERE account_id = ${accountId}::uuid RETURNING account_id`;
        return { doi: doi.length, phienXoa: phien.length };
      });
      expect(kq).toEqual({ doi: 1, phienXoa: 1 });
      expect(
        await sql`UPDATE customer_account SET disabled_at = NULL
          WHERE id = ${accountId}::uuid AND disabled_at IS NOT NULL RETURNING id`,
      ).toHaveLength(1);
    });
  });

  it('email KHÔNG sửa được và tài khoản KHÔNG xoá được — cửa rộng vẫn khoá', async () => {
    await duoiRoleApi(async () => {
      for (const cau of [
        sql`UPDATE customer_account SET email = 'khac@vidu.vn' WHERE id = ${accountId}::uuid`,
        sql`DELETE FROM customer_account WHERE id = ${accountId}::uuid`,
        sql`UPDATE customer_session SET user_agent = 'x' WHERE account_id = ${accountId}::uuid`,
      ]) {
        await expect(cau).rejects.toMatchObject({ code: '42501' });
      }
    });
  });
});
