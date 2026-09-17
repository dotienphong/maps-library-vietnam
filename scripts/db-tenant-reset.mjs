#!/usr/bin/env node
// Xoá TOÀN BỘ tenant + khoá API + đóng góp POI, rồi tạo lại đúng MỘT tenant.
//
// Mặc định là DRY-RUN: chỉ in kiểm kê và danh sách việc sẽ làm. Muốn xoá thật phải có đủ
// `--apply` VÀ `--confirm XOA-TOAN-BO-TENANT`. Hai cổng chứ không phải một: `--apply` gõ nhầm
// trong lịch sử shell là chuyện có thật, còn chuỗi xác nhận thì không ai gõ nhầm được.
//
//   node scripts/db-tenant-reset.mjs --name Phong_Admin
//   node scripts/db-tenant-reset.mjs --name Phong_Admin --apply --confirm XOA-TOAN-BO-TENANT
//
// Chạy trên DB máy chủ qua `pnpm server:tenant-reset` (container pipeline, superuser).
import 'dotenv/config';
import postgres from 'postgres';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

export const CONFIRM_PHRASE = 'XOA-TOAN-BO-TENANT';

/** Bảng được phép còn khoá ngoại tới `tenant`. Xuất hiện bảng ngoài danh sách này thì DỪNG:
 *  nghĩa là schema đã thêm quan hệ mới mà script chưa biết cách dọn, và xoá tiếp sẽ hoặc vỡ vì
 *  khoá ngoại, hoặc bỏ sót dữ liệu mồ côi. */
export const BANG_DA_BIET = ['api_key', 'poi_edit'];

/** @param {string[]} argv */
export function parseResetArgs(argv) {
  /** @param {string} ten */
  const value = (ten) => {
    const i = argv.indexOf(ten);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const name = value('--name');
  const plan = value('--plan') ?? 'free';
  const apply = argv.includes('--apply');
  const confirm = value('--confirm');

  if (!name || name.startsWith('--')) {
    throw new Error('Thiếu --name <tên tenant mới>');
  }
  if (!['internal', 'free', 'paid'].includes(plan)) {
    throw new Error(`--plan phải là internal|free|paid, nhận: ${plan}`);
  }
  if (apply && confirm !== CONFIRM_PHRASE) {
    throw new Error(`--apply phải đi kèm --confirm ${CONFIRM_PHRASE}`);
  }
  return { name, plan, apply };
}

/** @param {{table_name: string}[]} rows */
export function bangLa(rows) {
  return rows.map((r) => r.table_name).filter((ten) => !BANG_DA_BIET.includes(ten));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { name, plan, apply } = parseResetArgs(process.argv.slice(2));
  const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
  try {
    // 1. Khoá ngoại tới `tenant` — đọc từ schema thật, không tin trí nhớ.
    const fks = /** @type {{ table_name: string }[]} */ (
      await sql`
      SELECT DISTINCT src.relname AS table_name
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_class dst ON dst.oid = c.confrelid
      WHERE c.contype = 'f' AND dst.relname = 'tenant'
      ORDER BY src.relname`
    );
    console.log(
      'Bảng có khoá ngoại tới tenant:',
      fks.map((r) => r.table_name).join(', ') || '(không có)',
    );
    const la = bangLa(fks);
    if (la.length > 0) {
      console.error(`✗ Schema có quan hệ script chưa biết dọn: ${la.join(', ')}. Dừng lại.`);
      process.exit(1);
    }

    // 2. Kiểm kê trước.
    const truoc = await sql`
      SELECT t.id, t.name, t.plan,
        coalesce(to_jsonb(t) ->> 'quota_mode', 'legacy') AS quota_mode,
        count(DISTINCT k.key_hash) AS keys,
        count(DISTINCT e.id) AS edits
      FROM tenant t
      LEFT JOIN api_key k ON k.tenant_id = t.id
      LEFT JOIN poi_edit e ON e.tenant_id = t.id
      GROUP BY t.id, t.name, t.plan, to_jsonb(t) ->> 'quota_mode'
      ORDER BY t.name`;
    console.table(
      truoc.map((r) => ({
        id: r.id,
        name: r.name,
        plan: r.plan,
        quota_mode: r.quota_mode,
        keys: Number(r.keys),
        edits: Number(r.edits),
      })),
    );
    const [tong] =
      /** @type {{ tenant: number, api_key: number, poi_edit: number, poi: number }[]} */ (
        await sql`SELECT
        (SELECT count(*) FROM tenant)::int   AS tenant,
        (SELECT count(*) FROM api_key)::int  AS api_key,
        (SELECT count(*) FROM poi_edit)::int AS poi_edit,
        (SELECT count(*) FROM poi)::int      AS poi`
      );
    if (!tong)
      throw new Error('Không đếm được số dòng hiện có — dừng trước khi xoá bất cứ thứ gì.');
    console.log(
      `Sẽ xoá: ${tong.poi_edit} poi_edit, ${tong.api_key} api_key, ${tong.tenant} tenant.\n` +
        `KHÔNG đụng tới ${tong.poi} POI trong bảng poi (chúng không gắn tenant).`,
    );

    if (!apply) {
      console.log(`\nDRY-RUN — chưa xoá gì. Chạy lại kèm: --apply --confirm ${CONFIRM_PHRASE}`);
      process.exit(0);
    }

    // 3. Xoá và tạo lại trong MỘT transaction: nửa chừng mà hỏng thì DB quay về nguyên trạng,
    //    chứ không để lại một hệ thống không còn tenant nào.
    const id = crypto.randomUUID();
    await sql.begin(async (tx) => {
      await tx`DELETE FROM poi_edit`;
      await tx`DELETE FROM api_key`;
      await tx`DELETE FROM tenant`;
      // quota_mode để DEFAULT ('legacy'): tenant commercial mà chưa cấp gói thì mọi request trả
      // 403. Bật thương mại là bước RIÊNG, làm sau khi đã cấp gói và đối chiếu usage.
      await tx`INSERT INTO tenant (id, name, plan) VALUES (${id}::uuid, ${name}, ${plan})`;
    });

    const sau = await sql`
      SELECT t.id, t.name, t.plan,
        coalesce(to_jsonb(t) ->> 'quota_mode', 'legacy') AS quota_mode
      FROM tenant t ORDER BY t.name`;
    console.table(
      sau.map((r) => ({ id: r.id, name: r.name, plan: r.plan, quota_mode: r.quota_mode })),
    );
    const [conLai] = /** @type {{ tenant: number, api_key: number, poi_edit: number }[]} */ (
      await sql`SELECT
        (SELECT count(*) FROM tenant)::int   AS tenant,
        (SELECT count(*) FROM api_key)::int  AS api_key,
        (SELECT count(*) FROM poi_edit)::int AS poi_edit`
    );
    console.log(
      `Còn lại: ${conLai?.tenant} tenant, ${conLai?.api_key} api_key, ${conLai?.poi_edit} poi_edit.`,
    );
    console.log(`\n✔ Tenant mới: ${id} (${name}, plan ${plan}, quota_mode legacy)`);
    console.log('Bước tiếp theo — làm ĐÚNG thứ tự này để không có khoảng chết:');
    console.log('  1. Cấp khoá trên trang Admin /admin/tenants (khoá hiện đúng một lần)');
    console.log('  2. Cấp gói ở /admin/billing, đối chiếu usage thấy active + đúng bậc');
    console.log('  3. Cuối cùng mới bấm "Chuyển sang thương mại"');
  } finally {
    await sql.end({ timeout: 5 });
  }
}
