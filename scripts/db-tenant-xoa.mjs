#!/usr/bin/env node
// Xoá VĨNH VIỄN đúng MỘT tenant theo tên, cùng mọi thứ móc vào nó.
//
// Khác `db-tenant-reset.mjs`: cái kia xoá sạch mọi tenant rồi tạo lại một cái, dùng khi dọn nền.
// Cái này chỉ đụng đúng một tenant, dùng khi bỏ một tổ chức thử.
//
// Mặc định là DRY-RUN: chỉ in kiểm kê và danh sách việc sẽ làm. Muốn xoá thật phải có đủ
// `--apply` VÀ `--confirm XOA-MOT-TENANT`. Hai cổng chứ không phải một: `--apply` gõ nhầm trong
// lịch sử shell là chuyện có thật, còn chuỗi xác nhận thì không ai gõ nhầm được.
//
//   node scripts/db-tenant-xoa.mjs --name "Phong Company Test"
//   node scripts/db-tenant-xoa.mjs --name "Phong Company Test" --apply --confirm XOA-MOT-TENANT
//
// Tenant còn đóng góp POI thì thêm `--xoa-dong-gop`; còn đơn hàng thì thêm `--xoa-don-hang`.
// Hai cờ riêng vì hai loại dữ liệu khác nhau, xem ghi chú ở `quyetDinh`.
//
// Chạy trên DB máy chủ qua `pnpm server:tenant-xoa` (container pipeline, superuser).
import 'dotenv/config';
import postgres from 'postgres';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

export const CONFIRM_PHRASE = 'XOA-MOT-TENANT';

/**
 * Bảng được phép còn khoá ngoại tới `tenant`, kèm cách dọn.
 *
 * `poi_edit` KHÔNG nằm ở đây một cách vô điều kiện: đóng góp POI là dữ liệu bản đồ dùng chung,
 * xoá nhầm là mất công sức của người thật. Nếu tenant có đóng góp thì script DỪNG và bắt người
 * vận hành quyết định bằng `--xoa-dong-gop`.
 *
 * `customer_order` (migration 0023) cũng vậy, vì một lý do khác: đơn hàng là hồ sơ tài chính,
 * không phải trạng thái ứng dụng. Cờ riêng `--xoa-don-hang`, không dùng chung với đóng góp POI.
 *
 * Danh sách này là NGUỒN DUY NHẤT cho câu hỏi "đường xoá tenant đã biết hết quan hệ chưa":
 * `db/console-grant.dbtest.mjs` đối chiếu nó với khoá ngoại thật trong schema, nên một migration
 * sau này thêm quan hệ mới sẽ làm bài đó ĐỎ thay vì làm hỏng lặng lẽ nút "Xoá tổ chức".
 */
export const BANG_DA_BIET = [
  'api_key',
  'poi_edit',
  'tenant_member',
  'customer_account',
  'customer_order',
];

/** @param {string[]} argv */
export function parseXoaArgs(argv) {
  /** @param {string} ten */
  const value = (ten) => {
    const i = argv.indexOf(ten);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const name = value('--name');
  const apply = argv.includes('--apply');
  const confirm = value('--confirm');
  const xoaDongGop = argv.includes('--xoa-dong-gop');
  const xoaDonHang = argv.includes('--xoa-don-hang');

  if (!name || name.startsWith('--')) {
    throw new Error('Thiếu --name <tên tenant cần xoá>');
  }
  if (apply && confirm !== CONFIRM_PHRASE) {
    throw new Error(`--apply phải đi kèm --confirm ${CONFIRM_PHRASE}`);
  }
  return { name, apply, xoaDongGop, xoaDonHang };
}

/** @param {{table_name: string}[]} rows */
export function bangLa(rows) {
  return rows.map((r) => r.table_name).filter((ten) => !BANG_DA_BIET.includes(ten));
}

/**
 * Câu trả lời cho "có được xoá không", tách riêng để kiểm được mà không cần DB.
 *
 * Hai chốt độc lập, mỗi chốt một cờ: `--xoa-dong-gop` KHÔNG mở khoá cho đơn hàng và ngược lại.
 * Gộp chúng lại là để người vận hành gõ một cờ rồi xoá mất thứ mình không định xoá.
 * @param {{ tenant: unknown, edits: number, xoaDongGop: boolean,
 *           orders?: number, xoaDonHang?: boolean }} tinhHinh
 */
export function quyetDinh({ tenant, edits, xoaDongGop, orders = 0, xoaDonHang = false }) {
  if (!tenant) return { xoaDuoc: false, vi: 'khong-thay-tenant' };
  if (edits > 0 && !xoaDongGop) return { xoaDuoc: false, vi: 'con-dong-gop' };
  if (orders > 0 && !xoaDonHang) return { xoaDuoc: false, vi: 'con-don-hang' };
  return { xoaDuoc: true, vi: '' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { name, apply, xoaDongGop, xoaDonHang } = parseXoaArgs(process.argv.slice(2));
  const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
  try {
    // 1. Khoá ngoại tới `tenant` — đọc từ schema thật, không tin trí nhớ. Một migration sau này
    //    thêm quan hệ mới mà script chưa biết dọn thì phải DỪNG, không được xoá bừa.
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

    // 2. Kiểm kê đúng tenant này.
    const [t] = await sql`
      SELECT t.id, t.name, t.plan,
        coalesce(to_jsonb(t) ->> 'quota_mode', 'legacy') AS quota_mode,
        (SELECT count(*) FROM api_key k WHERE k.tenant_id = t.id)::int        AS keys,
        (SELECT count(*) FROM poi_edit e WHERE e.tenant_id = t.id)::int       AS edits,
        (SELECT count(*) FROM tenant_member m WHERE m.tenant_id = t.id)::int  AS members,
        (SELECT count(*) FROM customer_account a WHERE a.trial_tenant_id = t.id)::int AS accounts,
        (SELECT count(*) FROM customer_order o WHERE o.tenant_id = t.id)::int AS orders
      FROM tenant t WHERE t.name = ${name}`;

    const edits = t ? Number(t.edits) : 0;
    const orders = t ? Number(t.orders) : 0;
    const { xoaDuoc, vi } = quyetDinh({ tenant: t, edits, xoaDongGop, orders, xoaDonHang });

    if (vi === 'khong-thay-tenant') {
      console.error(`✗ Không có tenant nào tên "${name}". Dừng lại.`);
      const co = await sql`SELECT name FROM tenant ORDER BY name`;
      console.error('Tenant đang có:', co.map((r) => r.name).join(', ') || '(không có)');
      process.exit(1);
    }

    // `quyetDinh` đã chặn trường hợp không có tenant ở ngay trên; dòng này để TypeScript thu hẹp
    // kiểu, vì nó không suy ra được điều đó qua một hàm khác.
    if (!t) throw new Error('không thể xảy ra: đã kiểm tenant ở trên');

    console.table([
      {
        id: t.id,
        name: t.name,
        plan: t.plan,
        quota_mode: t.quota_mode,
        api_key: Number(t.keys),
        poi_edit: edits,
        tenant_member: Number(t.members),
        customer_order: orders,
        tai_khoan_tro_toi: Number(t.accounts),
      },
    ]);

    if (vi === 'con-dong-gop') {
      console.error(
        `✗ Tenant này có ${edits} đóng góp POI. Đó là dữ liệu bản đồ dùng chung, không xoá kèm\n` +
          '  theo quán tính. Muốn xoá cả chúng thì thêm --xoa-dong-gop.',
      );
      process.exit(1);
    }

    if (vi === 'con-don-hang') {
      console.error(
        `✗ Tenant này có ${orders} đơn hàng. Đơn là HỒ SƠ TÀI CHÍNH: giá và nội dung chốt lúc\n` +
          '  tạo, và cả role `api` lẫn nút "Xoá tổ chức" ở trang Admin đều cố ý không xoá được\n' +
          '  chúng. Nếu đây là tổ chức THỬ thì thêm --xoa-don-hang; nếu là khách thật thì đừng\n' +
          '  xoá tenant, hãy để đó.',
      );
      process.exit(1);
    }

    console.log(
      `Sẽ xoá: ${Number(t.keys)} api_key, ${Number(t.members)} tenant_member, ` +
        `${edits} poi_edit, ${xoaDonHang ? orders : 0} customer_order (kèm payment_event của ` +
        'chúng), 1 tenant.\n' +
        `Sẽ đặt trial_tenant_id = NULL cho ${Number(t.accounts)} tài khoản khách — GIỮ tài khoản\n` +
        'lại để khách còn đăng nhập được và tạo tổ chức mới.',
    );
    console.log(
      '\nLƯU Ý sổ quota: hạn mức của tenant nằm trong một Durable Object, KHÔNG nằm trong\n' +
        'Postgres. Xoá tenant ở đây không xoá sổ đó; nó thành sổ mồ côi, không ai đọc và không\n' +
        'tốn gì đáng kể. Đừng đi tìm nó trong DB.',
    );

    if (!apply) {
      console.log(`\nDRY-RUN — chưa xoá gì. Chạy lại kèm: --apply --confirm ${CONFIRM_PHRASE}`);
      process.exit(0);
    }

    // 3. Một transaction: nửa chừng mà hỏng thì DB quay về nguyên trạng, không để lại tenant đã
    //    mất khoá nhưng vẫn còn bản ghi.
    await sql.begin(async (tx) => {
      await tx`UPDATE customer_account SET trial_tenant_id = NULL WHERE trial_tenant_id = ${t.id}::uuid`;
      await tx`DELETE FROM tenant_member WHERE tenant_id = ${t.id}::uuid`;
      await tx`DELETE FROM api_key WHERE tenant_id = ${t.id}::uuid`;
      if (xoaDongGop) await tx`DELETE FROM poi_edit WHERE tenant_id = ${t.id}::uuid`;
      if (xoaDonHang) {
        // `payment_event.order_id` trỏ tới `customer_order`, nên nhật ký tiền vào phải đi trước
        // đơn. Đổi thứ tự hai câu này là 23503 ngay, cùng lớp lỗi mà cả file này đang vá.
        await tx`DELETE FROM payment_event WHERE order_id IN
          (SELECT id FROM customer_order WHERE tenant_id = ${t.id}::uuid)`;
        await tx`DELETE FROM customer_order WHERE tenant_id = ${t.id}::uuid`;
      }
      await tx`DELETE FROM tenant WHERE id = ${t.id}::uuid`;
    });

    const [conLai] = await sql`SELECT count(*)::int AS n FROM tenant WHERE name = ${name}`;
    if (!conLai || Number(conLai.n) !== 0) {
      console.error('✗ Xoá xong mà tenant vẫn còn. Kiểm tra lại trước khi làm gì tiếp.');
      process.exit(1);
    }
    const con = await sql`SELECT name, plan FROM tenant ORDER BY name`;
    console.log(`✔ Đã xoá tenant "${name}".`);
    console.table(con.map((r) => ({ name: r.name, plan: r.plan })));
    console.log(
      'Khoá API của tenant vừa xoá còn sống thêm tối đa 5 phút vì cache KV của tầng xác thực.',
    );
    if (!xoaDuoc) process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
