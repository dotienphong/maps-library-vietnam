// Chạy: pnpm exec vitest run --config vitest.db.config.ts db/console-grant.dbtest.mjs
// (cần Postgres dev: pnpm db:up && pnpm db:migrate). Chỉ chạy trên DB local.
//
// Vì sao có file này: `pnpm test:api-db` nối DB bằng role CHỦ SỞ HỮU, nên thiếu một dòng GRANT
// vẫn xanh ở máy rồi đỏ trên production — đúng cách migration 0016 ra đời. Bài dưới đây chạy
// mọi câu mà mã thật sẽ chạy, nhưng dưới role `api` mà Worker dùng, và khẳng định thêm rằng một
// cột KHÔNG được cấp thì bị từ chối.
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
const EMAIL = 'kiem-grant@vidu.vn';
/** Email riêng cho bài ON CONFLICT: bài đó chạy câu lệnh hai lần nên cần một dòng của riêng nó. */
const EMAIL_ONCONFLICT = 'kiem-grant-onconflict@vidu.vn';
const TENANT = 'Kiểm GRANT console';
const TOKEN = 'b'.repeat(64);

/** Chạy một hàm dưới role `api` rồi luôn trả role về, kể cả khi hàm ném. */
async function duoiRoleApi(fn) {
  await sql.unsafe('SET ROLE api');
  try {
    return await fn();
  } finally {
    await sql.unsafe('RESET ROLE');
  }
}

describe('GRANT của migration 0020 dưới role api', () => {
  beforeAll(async () => {
    await sql`DELETE FROM customer_session WHERE token_hash = ${TOKEN}`;
    await sql`DELETE FROM tenant_member WHERE tenant_id IN (SELECT id FROM tenant WHERE name = ${TENANT})`;
    await sql`DELETE FROM customer_login_code WHERE email = ${EMAIL}`;
    await sql`DELETE FROM customer_account WHERE email IN (${EMAIL}, ${EMAIL_ONCONFLICT})`;
    await sql`DELETE FROM tenant WHERE name = ${TENANT}`;
  });

  afterAll(async () => {
    await sql`DELETE FROM customer_session WHERE token_hash = ${TOKEN}`;
    await sql`DELETE FROM tenant_member WHERE tenant_id IN (SELECT id FROM tenant WHERE name = ${TENANT})`;
    await sql`DELETE FROM customer_login_code WHERE email = ${EMAIL}`;
    await sql`DELETE FROM customer_account WHERE email IN (${EMAIL}, ${EMAIL_ONCONFLICT})`;
    await sql`DELETE FROM tenant WHERE name = ${TENANT}`;
    await sql.end({ timeout: 5 });
  });

  it('taoHoacLayTaiKhoan chạy được nguyên văn, kể cả nhánh ON CONFLICT', async () => {
    // Bài này dựng lại ĐÚNG câu mà `taoHoacLayTaiKhoan` gửi đi, không phải một câu tương đương.
    // Bản cũ viết `DO UPDATE SET email = EXCLUDED.email`, mà `email` không nằm trong GRANT UPDATE
    // của migration 0020. Postgres kiểm quyền theo câu lệnh chứ không đợi có xung đột thật, nên
    // nó hỏng ngay lần đăng nhập đầu tiên trên production — trong khi bài kiểm cũ chỉ chạy
    // `INSERT` trơn nên không thấy gì, và e2e cũng không thấy vì harness nối DB bằng role chủ
    // sở hữu. Sự cố 19/09/2026.
    const chay = () => sql`
      INSERT INTO customer_account (email) VALUES (${EMAIL_ONCONFLICT})
      ON CONFLICT (email) DO UPDATE SET name = customer_account.name
      RETURNING id, email, name, google_sub, trial_tenant_id, disabled_at`;

    await duoiRoleApi(async () => {
      const lanDau = await chay();
      expect(lanDau).toHaveLength(1);
      expect(lanDau[0].email).toBe(EMAIL_ONCONFLICT);

      // Lần hai đi vào nhánh ON CONFLICT và vẫn phải trả về đúng một dòng: cả luồng mã một lần
      // lẫn luồng Google đều dựa vào `RETURNING` này để biết tài khoản nào vừa đăng nhập.
      const lanHai = await chay();
      expect(lanHai).toHaveLength(1);
      expect(lanHai[0].id).toBe(lanDau[0].id);
    });
  });

  it('api KHÔNG được sửa cột email — đổi email người khác là chiếm tài khoản', async () => {
    await duoiRoleApi(async () => {
      await expect(
        sql`UPDATE customer_account SET email = 'ke-gia-mao@vidu.vn' WHERE email = ${EMAIL_ONCONFLICT}`,
      ).rejects.toThrow(/permission denied|quyền/i);
    });
  });

  it('chạy được mọi câu mà nhóm route console thật sự dùng', async () => {
    await duoiRoleApi(async () => {
      await sql`SELECT count(*) FROM customer_account`;
      await sql`INSERT INTO customer_account (email) VALUES (${EMAIL})`;
      await sql`UPDATE customer_account SET last_login_at = now() WHERE email = ${EMAIL}`;
      await sql`UPDATE customer_account SET name = 'Khách thử' WHERE email = ${EMAIL}`;
      await sql`UPDATE customer_account SET google_sub = 'sub-thu' WHERE email = ${EMAIL}`;

      await sql`INSERT INTO tenant (name, plan, quota_mode) VALUES (${TENANT}, 'free', 'commercial')`;
      await sql`UPDATE customer_account SET trial_tenant_id = (SELECT id FROM tenant WHERE name = ${TENANT}) WHERE email = ${EMAIL}`;
      await sql`INSERT INTO tenant_member (tenant_id, account_id, role)
        SELECT t.id, a.id, 'owner' FROM tenant t, customer_account a
        WHERE t.name = ${TENANT} AND a.email = ${EMAIL}`;
      await sql`SELECT count(*) FROM tenant_member`;

      await sql`INSERT INTO customer_login_code (email, code_hash, expires_at)
        VALUES (${EMAIL}, ${'a'.repeat(64)}, now() + interval '10 minutes')`;
      await sql`UPDATE customer_login_code SET attempts = attempts + 1 WHERE email = ${EMAIL}`;
      await sql`UPDATE customer_login_code SET consumed_at = now() WHERE email = ${EMAIL}`;
      await sql`DELETE FROM customer_login_code WHERE email = ${EMAIL}`;

      await sql`INSERT INTO customer_session (token_hash, account_id, expires_at)
        SELECT ${TOKEN}, id, now() + interval '30 days' FROM customer_account WHERE email = ${EMAIL}`;
      await sql`UPDATE customer_session SET last_seen_at = now() WHERE token_hash = ${TOKEN}`;
      await sql`UPDATE customer_session SET expires_at = now() + interval '30 days' WHERE token_hash = ${TOKEN}`;
      await sql`SELECT account_id FROM customer_session WHERE token_hash = ${TOKEN}`;
      await sql`DELETE FROM customer_session WHERE token_hash = ${TOKEN}`;

      await sql`UPDATE tenant SET billing_name = 'Công ty Thử', billing_tax_code = '0100000000',
        billing_address = 'Hà Nội', billing_email = ${EMAIL} WHERE name = ${TENANT}`;
      await sql`UPDATE tenant SET name = ${TENANT} WHERE name = ${TENANT}`;
    });
  });

  it('KHÔNG đổi được cột ngoài phạm vi đã cấp — quyền theo cột phải có hiệu lực thật', async () => {
    // `plan` quyết định khách thuộc nhóm nào; console không có lý do gì đụng vào, và migration
    // 0020 cố ý không cấp. Bài này xanh nghĩa là cấp quyền theo CỘT thật sự có hiệu lực, chứ
    // không phải mình tưởng thế.
    await expect(
      duoiRoleApi(() => sql`UPDATE tenant SET plan = 'paid' WHERE name = ${TENANT}`),
    ).rejects.toThrow(/permission denied/i);

    // Xoá tài khoản khách không được cấp: console chỉ vô hiệu hoá bằng `disabled_at`, và giữ
    // bản ghi là điều kiện để đối soát về sau.
    await expect(
      duoiRoleApi(() => sql`DELETE FROM customer_account WHERE email = ${EMAIL}`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('quota_mode VẪN đổi được — quyền cũ của trang Admin, chặn nằm ở tầng route', async () => {
    // Migration 0015 đã cấp `UPDATE (quota_mode)` cho role `api` để trang Admin đổi chế độ tenant.
    // Console dùng CHUNG role đó, nên Postgres không phân biệt được hai ứng dụng. Điều ngăn console
    // đổi chế độ là ở chỗ nó không có route nào làm thế, chứ không phải ở quyền database.
    //
    // Ghi lại bằng một bài test thay vì để người sau tự phát hiện: ngày nào tách được role riêng
    // cho console thì bài này đỏ, và đó đúng là lúc cần xem lại.
    await duoiRoleApi(
      () => sql`UPDATE tenant SET quota_mode = 'commercial' WHERE name = ${TENANT}`,
    );
  });
});
