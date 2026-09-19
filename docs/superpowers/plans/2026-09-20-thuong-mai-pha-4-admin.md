# Thương mại tự phục vụ — Pha 4: admin Khách hàng, Đơn hàng & giao dịch đầy đủ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người vận hành **đối soát được từng đơn và từng khách** trên trang Admin: tìm khách theo email, thấy phiên đang mở và tenant của họ, vô hiệu hoá/kích hoạt lại tài khoản; lọc đơn theo tenant và khoảng ngày; huỷ đơn `pending` (kèm huỷ link PayOS), đánh dấu `refunded` cho đơn đã cấp; chi tiết tenant hiện chủ sở hữu và 5 đơn gần nhất; Tổng quan có hai ô tiền.

**Architecture:** Không có migration — mọi bảng và GRANT đã có từ `0020` và `0023`. Phía API thêm một route mới `admin-customers.ts` (mount **trong** app `admin`, chỉ cần `requireAccess()` như spec 13) với lớp SQL riêng `console/admin-db.ts` (câu KHÔNG theo tenant, chỉ admin import), và mở rộng `admin-orders.ts` (bộ lọc + hai lệnh tiền mới, vẫn sau `requireBillingAccess()`). Hai lệnh mới **không đụng sổ quota**: huỷ đơn chỉ gọi PayOS rồi đổi trạng thái; hoàn tiền chỉ ghi nhận. Phía Admin thêm feature `customers/`, mở rộng `orders/`, `tenants/`, `overview/`, và một form lý do dùng chung.

**Tech Stack:** Hono trên Workers, Postgres qua Hyperdrive, React 19 + TanStack Query + `@mapslibvn/ui`, Vitest (fake-sql, jsdom), Playwright, harness `scripts/api-db-test.mjs` (Postgres cô lập + PayOS giả).

Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 5.3 (máy trạng thái), 9.5 (hoàn tiền), **13** (admin mở rộng — nguồn chính), 14 (API), 17, 19, 20 (tiêu chí 1, 10, 11).
Pha 0–3 đã lên production và pha 3 đã chạy tiền thật (đơn `100002`, `100003`).

---

## Bối cảnh bắt buộc đọc trước khi làm

**Sáu bất biến của pha này:**

1. **Không đụng sổ quota.** Huỷ đơn và đánh dấu hoàn tiền chỉ đổi `customer_order.status` + `note`. Muốn thu hồi quyền dùng thì admin dùng `suspend` sẵn có ở màn Gói cước — giao diện phải nói rõ điều đó, không tự làm hộ.
2. **Mọi UPDATE trạng thái mang điều kiện trạng thái cũ ngay trong SQL** (`WHERE status = 'pending'`, `WHERE status = 'fulfilled'`), như toàn bộ `commerce/db.ts`. Không kiểm ở JS rồi UPDATE mù.
3. **Huỷ đơn chỉ đánh dấu SAU khi PayOS xác nhận huỷ link** (giống `console-orders.ts`): link còn sống mà ta bảo "đã huỷ" là nói sai, và tiền vào sau đó vẫn phải được cấp (bất biến 5.3 — `datDaTra` đã nhận `cancelled`).
4. **Vô hiệu hoá tài khoản = đặt `disabled_at` + xoá MỌI phiên trong một transaction.** `requireCustomer()` đã kiểm `disabled_at` từng request và `console-auth.ts` đã từ chối đăng nhập tài khoản bị khoá (403 `account_disabled`) — pha này không sửa hai chỗ đó, chỉ chứng minh bằng itest (tiêu chí 20.11).
5. **Không lộ `ip_hash`, `token_hash`, `payload` PayOS ra giao diện.** Phiên chỉ trả `user_agent`, `created_at`, `last_seen_at`, `expires_at`.
6. **Mọi lệnh ghi có `operationId` từ client và `reason` bắt buộc, audit `admin.order.*` / `admin.customer.*` giữ lý do.** Lệnh gọi lại trên đơn/tài khoản đã ở trạng thái đích trả 200 `moi: false`, không lỗi (khuôn của `confirm-manual`).

**Bẫy của repo, đã trả giá ít nhất một lần:**

- `pnpm typecheck` chạy `tsc -p tsconfig.scripts.json` **trước** turbo, bật `checkJs` cho `scripts/**/*.mjs` và `db/**/*.mjs`. Chạy thiếu là ở máy xanh mà CI đỏ.
- Thiếu một dòng `GRANT` chỉ lộ trên production: `test:api-db` nối DB bằng role **chủ sở hữu**. Câu mới của pha này chạy trong bài `*.dbtest.mjs` dưới `SET ROLE api` **nguyên văn**. Không có migration nên `db/schema.dbtest.mjs` **không** cần sửa.
- `postgres.js` với `fetch_types: false` trả `bigint` dưới dạng **chuỗi**: cột `bigint` đọc ra phải `::int`.
- Cột thời gian cho con trỏ phân trang đi qua `to_char(...)` và bind lại bằng `::text::timestamptz`. Bộ lọc `from`/`to` KHÔNG phải con trỏ nên bind `Date` thẳng là đủ.
- `exactOptionalPropertyTypes` bật: không truyền `undefined` vào prop tuỳ chọn; dùng spread có điều kiện `{...(x ? { k: x } : {})}`.
- Test React của `tenants/page.test.tsx` và `tenants/detail.test.tsx` **không** bọc `MemoryRouter`. Thêm `useSearchParams` hay `<Link>` vào hai màn đó thì phải bọc test — Task 9 làm việc đó, đừng ngạc nhiên khi đỏ.
- Stub `fetch` trong test admin trả **cùng một thân** cho mọi URL; một hook mới gọi thêm `/v1/admin/me` sẽ nhận thân lạ. Vì thế Task 6 làm `can()` chịu được `permissions` không phải mảng, và test mới so khớp **theo đường dẫn** (bài học `routes.test.tsx`: `'/v1/admin/metrics'.includes('/v1/admin/me')` là TRUE).
- Ngăn chi tiết là Radix Dialog **modal**: sau `schedule()` của `useDelayedAction` phải `onClose()` ngay, nếu không toast đếm ngược bị `aria-hidden` và nút Huỷ không bấm được.
- Hai form cùng `aria-label="Lý do"` mở cùng lúc làm e2e `getByLabel('Lý do')` mơ hồ → ngăn chi tiết đơn giữ **một** state `lenhMo`, mở lệnh này là đóng lệnh kia.
- Nhóm sidebar đã có tiêu đề **"Khách hàng"**; đặt mục con cùng chữ làm `getByText('Khách hàng')` trong `sidebar-nav.test.tsx` thấy hai phần tử. Mục con tên **"Tài khoản khách hàng"**.
- `/v1/admin/orders/summary` và `/payment-events/unmatched` phải khai **trước** `/orders/:id` — đã đúng, giữ nguyên thứ tự khi thêm route.
- `audit()` chạy trong `waitUntil`; test route tiêm `writeAuditEntry` để đọc nội dung dòng audit (khuôn `admin-orders.test.ts`), itest thì `doiAudit()` chờ tối đa 6 giây.

**Cổng:** danh sách và lệnh khách hàng đứng sau `requireSameSiteGhi()` + `requireAccess()` của app `admin` (mount trong `admin.ts`). Mọi đường `/v1/admin/orders*` vẫn sau `requireBillingAccess()` — **không** thay đổi `index.ts`. Giao diện: tenant detail và customer detail chỉ gọi `/v1/admin/orders?tenant=…` khi `can(me, 'orders.read')`, và hook đó `retry: false` để một 403 không thử ba lần.

Mọi commit kết thúc bằng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
Không push cho tới Task 11, và Task 11 chỉ push sau khi PHONG duyệt.

## Cấu trúc file

**Tạo mới**

```
apps/api/src/console/admin-db.ts            câu SQL tài khoản khách KHÔNG theo tenant — chỉ route admin import
apps/api/src/routes/admin-customers.ts      GET danh sách/chi tiết, POST disable/enable
apps/api/test/console-admin-db.test.ts
apps/api/test/admin-customers.test.ts
apps/api/test-db/admin-customers.itest.mjs  đăng ký → tìm → vô hiệu hoá → 401 trong một request → 403 khi đăng nhập lại → kích hoạt lại
apps/api/test-db/admin-orders.itest.mjs     huỷ đơn (PayOS giả thấy CANCELLED), hoàn tiền (sổ không đổi), bộ lọc tenant/ngày, owner của tenant
db/customer-admin-grant.dbtest.mjs          mọi câu của admin-db.ts dưới SET ROLE api; email/xoá tài khoản bị từ chối

apps/admin/src/features/lenh/form-ly-do.tsx (+ .test.tsx)     form một ô Lý do dùng chung cho huỷ/hoàn tiền/vô hiệu hoá
apps/admin/src/features/customers/api.ts, hooks.ts, hien-thi.ts (+ .test.ts),
  page.tsx (+ .test.tsx), chi-tiet.tsx (+ .test.tsx)
apps/admin/e2e/khach-hang.spec.ts

docs/evidence/commerce/2026-09-20-pha-4-admin.md
```

**Sửa**

```
apps/api/src/commerce/db.ts                 BoLocDonAdmin (tenantId/from/to), huyDonAdmin, danhDauHoanTien, chuTenant.accountId
apps/api/src/routes/admin-orders.ts         bộ lọc tenant/from/to; POST :id/cancel, :id/refund; deps.payos
apps/api/src/routes/admin.ts                ALL_PERMISSIONS + customers.read; mount adminCustomers
apps/api/src/routes/admin-tenants.ts        GET :id trả owner
apps/api/test/commerce-db.test.ts, admin-orders.test.ts
db/commerce-grant.dbtest.mjs                thêm ba câu mới của commerce/db.ts

apps/admin/src/lib/permissions.ts           customers.read; can() chịu me hỏng
apps/admin/src/layout/sidebar-nav.tsx (+ .test.tsx)   mục "Tài khoản khách hàng"
apps/admin/src/routes.tsx (+ .test.tsx)     /customers
apps/admin/src/features/billing/error-vi.ts  mã lỗi mới
apps/admin/src/features/audit/api.ts        LOAI_VIEC + admin.order.*, admin.customer.*
apps/admin/src/features/orders/api.ts, hooks.ts, page.tsx (+ .test.tsx), chi-tiet.tsx (+ .test.tsx)
apps/admin/src/features/tenants/api.ts, detail.tsx (+ .test.tsx), page.tsx (+ .test.tsx)
apps/admin/src/features/overview/page.tsx (+ .test.tsx)
apps/admin/e2e/don-hang.spec.ts             thêm bài huỷ đơn
README.md (mục Thanh toán), docs/DEVLOG.md (mục 26)
docs/superpowers/plans/2026-09-20-thuong-mai-pha-4-admin.md  biển trạng thái khi đóng
```

---

### Task 0: Nhánh làm việc

- [ ] **Step 1: Tạo nhánh từ `main` sạch**

```bash
cd /Users/dtphong/Desktop/software_business/mapsLibVN
git status --short          # phải rỗng
git checkout -b feat/thuong-mai-pha-4
```

Expected: `Switched to a new branch 'feat/thuong-mai-pha-4'`.

---

### Task 1: Lớp SQL đơn hàng — bộ lọc admin, hai lệnh mới, chủ tổ chức có `accountId`

**Files:**
- Modify: `apps/api/src/commerce/db.ts` (hàm `danhSachDonAdmin`, `chuTenant`, thêm `huyDonAdmin`, `danhDauHoanTien`)
- Test: `apps/api/test/commerce-db.test.ts`
- Modify: `db/commerce-grant.dbtest.mjs`

- [ ] **Step 1: Viết test đỏ trong `apps/api/test/commerce-db.test.ts`**

Thêm vào danh sách import ở đầu file: `danhDauHoanTien`, `danhSachDonAdmin`, `huyDonAdmin`, và `type RecordedQuery` từ `./helpers/fake-sql`. Thêm cuối file:

```ts
describe('danhSachDonAdmin — bộ lọc pha 4', () => {
  it('tenant, from, to đều là điều kiện "NULL hoặc khớp" NGAY TRONG SQL', async () => {
    const { sql, calls } = fakeSql([]);
    const from = new Date('2026-08-31T17:00:00.000Z');
    const to = new Date('2026-09-19T17:00:00.000Z');
    await danhSachDonAdmin(sql, {
      status: null,
      tenantId: TENANT,
      from,
      to,
      limit: 25,
      cursor: null,
    });
    const q = calls[0] as RecordedQuery;
    expect(q.text).toContain('o.tenant_id = $');
    expect(q.text).toContain('o.created_at >= $');
    expect(q.text).toContain('o.created_at < $');
    expect(q.params).toEqual(expect.arrayContaining([TENANT, from, to]));
  });

  it('không lọc gì thì mọi tham số lọc là null và LIMIT vẫn dư một dòng', async () => {
    const { sql, calls } = fakeSql([]);
    await danhSachDonAdmin(sql, {
      status: null,
      tenantId: null,
      from: null,
      to: null,
      limit: 25,
      cursor: null,
    });
    const q = calls[0] as RecordedQuery;
    expect(q.params.filter((p) => p === null)).toHaveLength(6);
    expect(q.params).toContain(26);
  });
});

describe('hai lệnh admin của pha 4 mang điều kiện trạng thái cũ NGAY TRONG SQL', () => {
  it('huyDonAdmin chỉ đụng đơn pending, ghi note', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    expect(await huyDonAdmin(sql, ORDER, 'Khách đổi ý')).toBe(true);
    const q = calls[0] as RecordedQuery;
    expect(q.text).toContain("SET status = 'cancelled', note = $");
    expect(q.text).toContain("AND status = 'pending' RETURNING id");
    expect(q.params).toEqual(['Khách đổi ý', ORDER]);
  });

  it('danhDauHoanTien nhận fulfilled, paid_unfulfilled, underpaid — KHÔNG nhận pending hay paid', async () => {
    const { sql, calls } = fakeSql([]);
    expect(await danhDauHoanTien(sql, ORDER, 'Hoàn theo yêu cầu')).toBe(false);
    const q = calls[0] as RecordedQuery;
    expect(q.text).toContain("SET status = 'refunded', note = $");
    expect(q.text).toContain("AND status IN ('fulfilled', 'paid_unfulfilled', 'underpaid') RETURNING id");
    // `paid` đứng ngoài có chủ đích: nó là trạng thái đi ngang vài giây, đánh dấu vào đó là đua
    // với datDaCap. Khẳng định tường minh để lần sau ai thêm nó vào phải đọc lý do trước.
    expect(q.text).not.toContain("'paid',");
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-db.test.ts`
Expected: FAIL — `huyDonAdmin is not a function` / thiếu `tenantId` trong kiểu tham số.

- [ ] **Step 3: Sửa `apps/api/src/commerce/db.ts`**

Thay toàn bộ hàm `danhSachDonAdmin` (và thêm interface ngay trên nó):

```ts
export interface BoLocDonAdmin {
  status: TrangThaiDon | null;
  tenantId: string | null;
  /** Mốc bao gồm (`>=`). Route đã đổi "ngày-chỉ-có-ngày" sang 00:00 giờ Việt Nam. */
  from: Date | null;
  /** Mốc LOẠI TRỪ (`<`). Với "đến ngày D" route truyền 00:00 giờ VN của ngày D+1. */
  to: Date | null;
  limit: number;
  cursor: { createdAt: string; id: string } | null;
}

export async function danhSachDonAdmin(sql: Sql, p: BoLocDonAdmin): Promise<DonHangAdmin[]> {
  const createdAt = p.cursor?.createdAt ?? null;
  const cursorId = p.cursor?.id ?? null;
  // Lấy dư một dòng để biết còn trang sau; to_char giữ micro giây cho con trỏ, và bind lại bằng
  // ::text::timestamptz — đi qua Date của JavaScript sẽ cắt mất ba chữ số cuối. Hai mốc from/to
  // KHÔNG phải con trỏ nên bind Date thẳng là đủ: lệch một mili giây ở ranh giới ngày không sao.
  return await sql<DonHangAdmin[]>`
    SELECT ${sql.unsafe(COT_DON_O)},
           t.name AS tenant_name,
           to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    FROM customer_order o
    JOIN tenant t ON t.id = o.tenant_id
    WHERE (${p.status}::text IS NULL OR o.status = ${p.status})
      AND (${p.tenantId}::uuid IS NULL OR o.tenant_id = ${p.tenantId}::uuid)
      AND (${p.from}::timestamptz IS NULL OR o.created_at >= ${p.from}::timestamptz)
      AND (${p.to}::timestamptz IS NULL OR o.created_at < ${p.to}::timestamptz)
      AND (${createdAt}::text IS NULL
           OR (o.created_at, o.id) < (${createdAt}::text::timestamptz, ${cursorId}::uuid))
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ${p.limit + 1}`;
}

/**
 * Admin huỷ đơn — chỉ SAU khi PayOS đã xác nhận huỷ link (route lo việc đó). `note` giữ lý do để
 * người đọc chi tiết đơn sau này không phải mở nhật ký. Không có tenant_id trong điều kiện vì
 * admin đọc mọi tenant; điều kiện `status = 'pending'` mới là thứ ngăn huỷ nhầm đơn đã có tiền.
 */
export async function huyDonAdmin(sql: Sql, orderId: string, note: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order SET status = 'cancelled', note = ${note}, updated_at = now()
    WHERE id = ${orderId}::uuid AND status = 'pending' RETURNING id`;
  return rows.length > 0;
}

/**
 * Chỉ ghi nhận (spec 9.5): hoàn tiền làm ngoài hệ thống, sổ quota không bị đụng.
 *
 * Nhận ba trạng thái chứ không riêng `fulfilled` như hình vẽ ở spec 5.3 — mục 9.5 không giới hạn
 * trạng thái nguồn, và ca hoàn tiền hay gặp nhất lại là `paid_unfulfilled`: tiền đã vào, cấp gói
 * hỏng, PHONG chuyển trả khách. Nếu chỉ nhận `fulfilled` thì đơn đó kẹt vĩnh viễn ở ô "Đơn chờ
 * xử lý" và cron vẫn cố cấp gói cho một đơn đã hoàn tiền. `paid` cố ý ĐỨNG NGOÀI: nó là trạng
 * thái đi ngang vài giây giữa webhook và sổ, đánh dấu vào đó chỉ tạo một cuộc đua vô ích với
 * `datDaCap`; chờ nó lắng về `fulfilled` hoặc `paid_unfulfilled` rồi hãy đánh dấu.
 */
export async function danhDauHoanTien(sql: Sql, orderId: string, note: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order SET status = 'refunded', note = ${note}, updated_at = now()
    WHERE id = ${orderId}::uuid
      AND status IN ('fulfilled', 'paid_unfulfilled', 'underpaid') RETURNING id`;
  return rows.length > 0;
}
```

Sửa `ChuTenant` và `chuTenant` để trả thêm `accountId` (trang Admin cần nó để link sang màn Khách hàng):

```ts
export interface ChuTenant {
  email: string;
  billingEmail: string | null;
  tenantName: string;
  /** null chỉ trong test có bản giả cũ; DB thật luôn có vì JOIN customer_account. */
  accountId: string | null;
}

export async function chuTenant(sql: Sql, tenantId: string): Promise<ChuTenant | null> {
  const rows = await sql<
    { email: string; billing_email: string | null; name: string; account_id?: string }[]
  >`
    SELECT a.email, t.billing_email, t.name, a.id AS account_id
    FROM tenant t
    JOIN tenant_member m ON m.tenant_id = t.id AND m.role = 'owner'
    JOIN customer_account a ON a.id = m.account_id
    WHERE t.id = ${tenantId}::uuid
    ORDER BY m.created_at LIMIT 1`;
  const r = rows[0];
  return r
    ? {
        email: r.email,
        billingEmail: r.billing_email,
        tenantName: r.name,
        accountId: r.account_id ?? null,
      }
    : null;
}
```

- [ ] **Step 4: Chạy lại test lớp SQL và test route đang gọi `danhSachDonAdmin`**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-db.test.ts test/admin-orders.test.ts`
Expected: `commerce-db` PASS. `admin-orders.test.ts` **typecheck fail hoặc FAIL** vì route chưa truyền `tenantId/from/to` — Task 2 sửa. (vitest không chặn theo kiểu; nếu nó xanh thì cũng chỉ vì `undefined` bind như null. Đừng coi đó là xong.)

- [ ] **Step 5: Bài GRANT dưới role `api` — thêm ba câu nguyên văn vào `db/commerce-grant.dbtest.mjs`**

Trong `it('mọi câu ĐỌC của khách, cron và admin chạy được dưới role api')`, thay câu danh sách admin cũ (`SELECT o.id, to_char(...) ... LIMIT 26`) bằng bản có bộ lọc, và sửa câu `chuTenant`:

```js
      await sql`SELECT o.id,
          to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
          t.name AS tenant_name
        FROM customer_order o JOIN tenant t ON t.id = o.tenant_id
        WHERE (${null}::text IS NULL OR o.status = ${null})
          AND (${tenantId}::uuid IS NULL OR o.tenant_id = ${tenantId}::uuid)
          AND (${null}::timestamptz IS NULL OR o.created_at >= ${null}::timestamptz)
          AND (${null}::timestamptz IS NULL OR o.created_at < ${null}::timestamptz)
        ORDER BY o.created_at DESC, o.id DESC LIMIT 26`;
```

```js
      await sql`SELECT a.email, t.billing_email, t.name, a.id AS account_id
        FROM tenant t
        JOIN tenant_member m ON m.tenant_id = t.id AND m.role = 'owner'
        JOIN customer_account a ON a.id = m.account_id
        WHERE t.id = ${tenantId}::uuid ORDER BY m.created_at LIMIT 1`;
```

Trong `it('mọi UPDATE của máy trạng thái chạy được…')`, sau câu `cancelled` cuối cùng thêm:

```js
      // Hai lệnh admin của pha 4. Đơn đang fulfilled: huỷ không đổi dòng nào (đúng), hoàn tiền
      // đổi đúng một dòng. Cả hai phải KHÔNG bị từ chối quyền (status, note, updated_at đã GRANT).
      expect(
        await sql`UPDATE customer_order SET status = 'cancelled', note = 'kiem-grant', updated_at = now()
          WHERE id = ${orderId}::uuid AND status = 'pending' RETURNING id`,
      ).toHaveLength(0);
      expect(
        await sql`UPDATE customer_order SET status = 'refunded', note = 'kiem-grant', updated_at = now()
          WHERE id = ${orderId}::uuid AND status = 'fulfilled' RETURNING id`,
      ).toHaveLength(1);
```

- [ ] **Step 6: Chạy bài GRANT trên DB dev**

Run: `pnpm db:up && pnpm db:migrate && pnpm exec vitest run --config vitest.db.config.ts db/commerce-grant.dbtest.mjs`
Expected: PASS (5 bài). Nếu Postgres dev chưa có, ghi lại và chạy ở Task 11 trong harness.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/commerce/db.ts apps/api/test/commerce-db.test.ts db/commerce-grant.dbtest.mjs
git commit -m "feat(api): lớp SQL đơn hàng — bộ lọc tenant/khoảng ngày cho admin, huỷ đơn và đánh dấu hoàn tiền có điều kiện trạng thái cũ, chủ tổ chức kèm accountId

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Route `admin-orders.ts` — bộ lọc, "Huỷ đơn", "Đánh dấu hoàn tiền"; quyền `customers.read`

**Files:**
- Modify: `apps/api/src/routes/admin-orders.ts`
- Modify: `apps/api/src/routes/admin.ts` (`ALL_PERMISSIONS`)
- Test: `apps/api/test/admin-orders.test.ts`

- [ ] **Step 1: Viết test đỏ — mở rộng `apps/api/test/admin-orders.test.ts`**

Trong `kho()`, thêm hai nhánh **trước** dòng `if (q.text.includes('tenant_member'))`:

```ts
    if (q.text.includes("SET status = 'cancelled'") && hienTai) {
      if (hienTai.status !== 'pending') return [];
      hienTai = { ...hienTai, status: 'cancelled', note: q.params[0] as string };
      return [{ id: ORDER }];
    }
    if (q.text.includes("SET status = 'refunded'") && hienTai) {
      if (!['fulfilled', 'paid_unfulfilled', 'underpaid'].includes(hienTai.status)) return [];
      hienTai = { ...hienTai, status: 'refunded', note: q.params[0] as string };
      return [{ id: ORDER }];
    }
```

Thêm bản PayOS giả và cho `app()` nhận nó (thay chữ ký `app` hiện có):

```ts
import type { PayosPort } from '../src/commerce/payos';

const payosGia = (huyLink: PayosPort['huyLink'] = vi.fn(async () => {})) =>
  ({
    ten: 'payos',
    taoLink: vi.fn(),
    docLink: vi.fn(),
    huyLink,
    checkoutUrlTuId: (id: string) => `https://pay/web/${id}`,
  }) as unknown as PayosPort;

function app(
  k: ReturnType<typeof kho>,
  so: ReturnType<typeof soGia>['so'] = soGia().so,
  email: string | null = 'billing@test.local',
  payos: PayosPort = payosGia(),
) {
  const a = new Hono<AppEnv>();
  a.onError((err, c) => errorResponse(c, err));
  a.use('*', async (c, next) => {
    if (!email) return c.json({ error: { code: 'missing_access_jwt' } }, 401);
    c.set('reviewer', email);
    await next();
  });
  a.route(
    '/',
    adminOrdersWith({
      sql: () => k.sql,
      so: () => so,
      now: () => NOW,
      payos: () => payos,
      emailPort: () => ({ ten: 'debug', send: vi.fn().mockResolvedValue({ id: 'r' }) }),
      writeAuditEntry: (e) => k.audit.push(e as DongAudit),
    }),
  );
  return a;
}
```

Thêm vào `describe('GET /v1/admin/orders')`:

```ts
  it('lọc tenant + khoảng ngày: ngày-chỉ-có-ngày thành ranh giới ngày giờ Việt Nam', async () => {
    const k = kho({ danhSach: [] });
    const res = await get(
      app(k),
      `/v1/admin/orders?tenant=${TENANT}&from=2026-09-01&to=2026-09-19`,
    );
    expect(res.status).toBe(200);
    const params = k.calls[0]?.params ?? [];
    expect(params).toContain(TENANT);
    // 00:00 ngày 01/09 giờ VN = 17:00 ngày 31/08 UTC; "đến 19/09" = trước 00:00 ngày 20/09 giờ VN.
    expect(params.some((p) => p instanceof Date && p.toISOString() === '2026-08-31T17:00:00.000Z')).toBe(true);
    expect(params.some((p) => p instanceof Date && p.toISOString() === '2026-09-19T17:00:00.000Z')).toBe(true);
  });

  it('mốc ISO đầy đủ giữ nguyên, không cộng ngày', async () => {
    const k = kho({ danhSach: [] });
    await get(app(k), '/v1/admin/orders?to=2026-09-19T03:00:00Z');
    const params = k.calls[0]?.params ?? [];
    expect(params.some((p) => p instanceof Date && p.toISOString() === '2026-09-19T03:00:00.000Z')).toBe(true);
  });

  it('tenant không phải uuid → 400; from rác → 400', async () => {
    expect((await get(app(kho()), '/v1/admin/orders?tenant=rac')).status).toBe(400);
    expect((await get(app(kho()), '/v1/admin/orders?from=hom-qua')).status).toBe(400);
  });
```

Thêm hai `describe` mới cuối file:

```ts
describe('POST /v1/admin/orders/:id/cancel', () => {
  const than = { operationId: 'op-huy-0001', reason: 'Khách đổi ý, chưa chuyển tiền' };

  it('pending có link → gọi PayOS huỷ đúng orderCode, rồi cancelled; audit giữ lý do', async () => {
    const k = kho();
    const huyLink = vi.fn(async () => {});
    const res = await post(app(k, undefined, undefined, payosGia(huyLink)), `/v1/admin/orders/${ORDER}/cancel`, than);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ order: { status: 'cancelled', note: than.reason }, moi: true });
    expect(huyLink).toHaveBeenCalledWith(100001, expect.stringContaining('Khách đổi ý'));
    expect(k.doc()?.status).toBe('cancelled');
    expect(k.audit.find((d) => d.action === 'admin.order.cancel')?.detail).toMatchObject({
      reason: than.reason,
      operation_id: 'op-huy-0001',
      order_code: 100001,
    });
  });

  it('pending chưa có link → không gọi PayOS, vẫn cancelled', async () => {
    const k = kho({ don: don({ payment_link_id: null, checkout_url: null }) });
    const huyLink = vi.fn(async () => {});
    const res = await post(app(k, undefined, undefined, payosGia(huyLink)), `/v1/admin/orders/${ORDER}/cancel`, than);
    expect(res.status).toBe(200);
    expect(huyLink).not.toHaveBeenCalled();
  });

  it('PayOS lỗi → 503 payment_provider_unavailable và đơn ĐỨNG IM ở pending', async () => {
    const k = kho();
    const huyLink = vi.fn(async () => {
      throw new Error('payos_unreachable');
    });
    const res = await post(app(k, undefined, undefined, payosGia(huyLink)), `/v1/admin/orders/${ORDER}/cancel`, than);
    expect(res.status).toBe(503);
    expect(k.doc()?.status).toBe('pending');
    expect(k.audit.some((d) => d.action === 'admin.order.cancel')).toBe(false);
  });

  it('đã cancelled → 200 moi:false, không gọi PayOS; fulfilled → 409 order_not_cancellable', async () => {
    const huyLink = vi.fn(async () => {});
    const daHuy = await post(
      app(kho({ don: don({ status: 'cancelled' }) }), undefined, undefined, payosGia(huyLink)),
      `/v1/admin/orders/${ORDER}/cancel`,
      than,
    );
    expect(daHuy.status).toBe(200);
    expect(await daHuy.json()).toMatchObject({ moi: false });
    expect(huyLink).not.toHaveBeenCalled();

    const res = await post(app(kho({ don: don({ status: 'fulfilled' }) })), `/v1/admin/orders/${ORDER}/cancel`, than);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('order_not_cancellable');
  });

  it('thiếu reason hoặc operationId hợp lệ → 400', async () => {
    const a = app(kho());
    expect((await post(a, `/v1/admin/orders/${ORDER}/cancel`, { ...than, reason: '  ' })).status).toBe(400);
    expect((await post(a, `/v1/admin/orders/${ORDER}/cancel`, { ...than, operationId: 'x' })).status).toBe(400);
  });
});

describe('POST /v1/admin/orders/:id/refund', () => {
  const than = { operationId: 'op-hoan-0001', reason: 'Khách yêu cầu, đã chuyển trả 650.000' };

  it('fulfilled → refunded, không lệnh nào tới sổ quota; audit giữ lý do và số tiền đã nhận', async () => {
    const k = kho({ don: don({ status: 'fulfilled', paid_amount_vnd: 650_000 }) });
    const { so, lenh } = soGia();
    const res = await post(app(k, so), `/v1/admin/orders/${ORDER}/refund`, than);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ order: { status: 'refunded', note: than.reason }, moi: true });
    expect(lenh).toHaveLength(0);
    expect(k.audit.find((d) => d.action === 'admin.order.refund')?.detail).toMatchObject({
      reason: than.reason,
      operation_id: 'op-hoan-0001',
      paid_amount_vnd: 650_000,
    });
  });

  it('paid_unfulfilled và underpaid cũng đánh dấu được — đó là ca hoàn tiền hay gặp nhất', async () => {
    for (const status of ['paid_unfulfilled', 'underpaid'] as const) {
      const k = kho({ don: don({ status, paid_amount_vnd: 650_000 }) });
      const res = await post(app(k), `/v1/admin/orders/${ORDER}/refund`, than);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ order: { status: 'refunded' }, moi: true });
    }
  });

  it('đã refunded → 200 moi:false; pending và paid → 409 order_not_refundable', async () => {
    const lai = await post(app(kho({ don: don({ status: 'refunded' }) })), `/v1/admin/orders/${ORDER}/refund`, than);
    expect(lai.status).toBe(200);
    expect(await lai.json()).toMatchObject({ moi: false });

    for (const status of ['pending', 'paid'] as const) {
      const res = await post(app(kho({ don: don({ status }) })), `/v1/admin/orders/${ORDER}/refund`, than);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('order_not_refundable');
    }
  });

  it('thiếu reason → 400 invalid_reason', async () => {
    const res = await post(app(kho({ don: don({ status: 'fulfilled' }) })), `/v1/admin/orders/${ORDER}/refund`, { operationId: 'op-hoan-0001' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_reason');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/admin-orders.test.ts`
Expected: FAIL — 404 cho `/cancel`, `/refund`; bài bộ lọc không thấy `Date` trong params.

- [ ] **Step 3: Sửa `apps/api/src/routes/admin-orders.ts`**

Import thêm (giữ các import cũ):

```ts
import {
  chuTenant,
  type DonHang,
  daCoSuKien,
  danhDauHoanTien,
  danhSachDonAdmin,
  docDon,
  ghiSuKienThanhToan,
  huyDonAdmin,
  suKienCuaDon,
  suKienKhongKhop,
  type TrangThaiDon,
  tomTatDon,
  tongTienDaNhan,
} from '../commerce/db';
import { chonPayosPort, type PayosPort } from '../commerce/payos';
import { moTaLoi } from '../errors';   // gộp vào dòng import ApiError sẵn có
```

Thêm hằng và helper (sau `MAX_BODY`):

```ts
const NGAY = /^\d{4}-\d{2}-\d{2}$/;
const MOT_NGAY_MS = 86_400_000;
/** Trạng thái đánh dấu hoàn tiền được — giống hệt điều kiện trong `danhDauHoanTien`, xem lý do ở đó. */
const CO_THE_HOAN_TIEN = new Set<TrangThaiDon>(['fulfilled', 'paid_unfulfilled', 'underpaid']);

/**
 * `from`/`to` nhận "YYYY-MM-DD" hoặc ISO đầy đủ. Ngày-chỉ-có-ngày hiểu theo giờ Việt Nam (người
 * vận hành ngồi ở +07:00), và `to` dạng ngày là BAO GỒM cả ngày đó: ta trả ranh giới 00:00 ngày
 * kế tiếp để SQL dùng `<`. Mốc ISO đầy đủ giữ nguyên.
 */
function docMoc(raw: string | null, laMocCuoi: boolean): Date | null {
  if (raw === null || raw === '') return null;
  const chiNgay = NGAY.test(raw);
  const ms = Date.parse(chiNgay ? `${raw}T00:00:00+07:00` : raw);
  if (!Number.isFinite(ms)) {
    throw new ApiError(400, 'invalid_request', 'from/to phải là ngày YYYY-MM-DD hoặc mốc ISO');
  }
  return new Date(chiNgay && laMocCuoi ? ms + MOT_NGAY_MS : ms);
}

function docLyDo(body: Record<string, unknown>): string {
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!reason) throw new ApiError(400, 'invalid_reason', 'Cần lý do');
  return reason;
}

function docOperationId(body: Record<string, unknown>): string {
  const v = body.operationId;
  if (typeof v !== 'string' || !OPERATION_ID.test(v)) {
    throw new ApiError(400, 'invalid_request', 'operationId phải có 8–64 ký tự [A-Za-z0-9_-]');
  }
  return v;
}
```

Thêm `payos` vào deps:

```ts
export interface AdminOrdersDeps extends FulfilDeps, ThongBaoDeps {
  sql?: (env: Env) => ReturnType<typeof getSql>;
  /** Cổng PayOS, tiêm được: "Huỷ đơn" phải huỷ link ở PayOS trước khi đánh dấu. */
  payos?: (env: Env) => PayosPort;
  writeAuditEntry?: (entry: { action: string; target: string; detail: ChiTietAudit }) => void;
}
```

Trong `adminOrdersWith`, sau `const now = …` thêm `const payos = (env: Env) => (deps.payos ?? chonPayosPort)(env);`.

Thay phần đọc query của `routes.get('/v1/admin/orders', …)`:

```ts
  routes.get('/v1/admin/orders', async (c) => {
    const q = new URL(c.req.url).searchParams;
    const statusRaw = q.get('status');
    if (statusRaw !== null && !TRANG_THAI.has(statusRaw)) {
      throw new ApiError(400, 'invalid_request', 'status không hợp lệ');
    }
    const status = (statusRaw as TrangThaiDon | null) ?? null;
    const tenantRaw = q.get('tenant');
    if (tenantRaw !== null && tenantRaw !== '' && !UUID.test(tenantRaw)) {
      throw new ApiError(400, 'invalid_request', 'tenant phải là uuid');
    }
    const tenantId = tenantRaw ? tenantRaw : null;
    const from = docMoc(q.get('from'), false);
    const to = docMoc(q.get('to'), true);
    const limit = parseLimit(q);
    let cursor: { createdAt: string; id: string } | null = null;
    const raw = q.get('cursor');
    if (raw !== null) {
      const [createdAt, id] = raw.split('|');
      if (!createdAt || !id || !CURSOR_TIME.test(createdAt) || !UUID.test(id)) {
        throw new ApiError(400, 'invalid_request', 'cursor phải có dạng <thời điểm ISO>|<uuid>');
      }
      cursor = { createdAt, id };
    }
    const rows = await voiSqlCua(c, (sql) =>
      danhSachDonAdmin(sql, { status, tenantId, from, to, limit, cursor }),
    );
    // … phần còn lại giữ nguyên (hasMore, page, nextCursor)
```

Thêm hai route mới **sau** `confirm-manual`, trước `return routes;`:

```ts
  /**
   * Huỷ đơn (spec 13). Thứ tự bắt buộc: PayOS huỷ link TRƯỚC, DB đánh dấu SAU — cùng lý do với
   * `console-orders.ts`: link còn sống mà ta bảo "đã huỷ" là nói sai, và khách vẫn quét mã đó rồi
   * chuyển tiền cho một đơn ta coi là đã đóng. Lệnh gọi lại trên đơn đã cancelled là thành công.
   */
  routes.post('/v1/admin/orders/:id/cancel', async (c) => {
    const id = orderId(c.req.param('id'));
    const body = await docJson(c.req.raw);
    const operationId = docOperationId(body);
    const reason = docLyDo(body);

    const don = await voiSqlCua(c, (sql) => docDon(sql, id));
    if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    if (don.status === 'cancelled') {
      return c.json({ order: donJsonAdmin(don), moi: false }, 200, NO_STORE);
    }
    if (don.status !== 'pending') {
      throw new ApiError(409, 'order_not_cancellable', 'Chỉ huỷ được đơn đang chờ thanh toán');
    }

    // Gọi PayOS NGOÀI phạm vi client Postgres: một lời gọi mạng có thể mất mười giây.
    if (don.payment_link_id) {
      try {
        await payos(c.env).huyLink(don.order_code, `Admin huỷ: ${reason}`.slice(0, 255));
      } catch (error) {
        console.error(`[commerce] admin huỷ link đơn ${don.order_code} lỗi: ${moTaLoi(error)}`);
        throw new ApiError(
          503,
          'payment_provider_unavailable',
          'Cổng thanh toán đang bận, chưa huỷ; hãy thử lại',
        );
      }
    }

    const daHuy = await voiSqlCua(c, (sql) => huyDonAdmin(sql, id, reason));
    if (!daHuy) throw new ApiError(409, 'order_not_cancellable', 'Đơn vừa đổi trạng thái');
    ghiAudit(c, 'admin.order.cancel', id, {
      order_code: don.order_code,
      tenant_id: don.tenant_id,
      operation_id: operationId,
      reason,
      payos_link: don.payment_link_id !== null,
    });
    return c.json(
      { order: donJsonAdmin({ ...don, status: 'cancelled', note: reason }), moi: true },
      200,
      NO_STORE,
    );
  });

  /**
   * Đánh dấu hoàn tiền (spec 9.5, 13). Chỉ ghi nhận: tiền trả lại khách đi ngoài hệ thống, và sổ
   * quota KHÔNG bị đụng — thu hồi quyền dùng là lệnh `suspend` riêng ở màn Gói cước, do người
   * quyết định. Gọi lại trên đơn đã refunded là thành công.
   */
  routes.post('/v1/admin/orders/:id/refund', async (c) => {
    const id = orderId(c.req.param('id'));
    const body = await docJson(c.req.raw);
    const operationId = docOperationId(body);
    const reason = docLyDo(body);

    const kq = await voiSqlCua(c, async (sql) => {
      const don = await docDon(sql, id);
      if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
      if (don.status === 'refunded') return { don, moi: false };
      if (!CO_THE_HOAN_TIEN.has(don.status)) {
        throw new ApiError(
          409,
          'order_not_refundable',
          'Chỉ đánh dấu hoàn tiền cho đơn đã có tiền vào (đã cấp gói, tiền vào chưa cấp, hoặc thiếu tiền)',
        );
      }
      const doi = await danhDauHoanTien(sql, id, reason);
      if (!doi) throw new ApiError(409, 'order_not_refundable', 'Đơn vừa đổi trạng thái');
      return { don: { ...don, status: 'refunded' as const, note: reason }, moi: true };
    });

    if (kq.moi) {
      ghiAudit(c, 'admin.order.refund', id, {
        order_code: kq.don.order_code,
        tenant_id: kq.don.tenant_id,
        operation_id: operationId,
        reason,
        paid_amount_vnd: kq.don.paid_amount_vnd,
      });
    }
    return c.json({ order: donJsonAdmin(kq.don), moi: kq.moi }, 200, NO_STORE);
  });
```

Trong `confirm-manual`, thay đoạn tự đọc `operationId` bằng `const operationId = docOperationId(body);` chỉ khi bạn giữ nguyên thông điệp lỗi `invalid_confirm` cho ba trường — **không bắt buộc**; nếu đổi, sửa bài test `thiếu lý do, mã ngân hàng hoặc operationId hợp lệ → 400` vẫn đúng vì nó chỉ kiểm mã 400.

- [ ] **Step 4: Thêm quyền `customers.read` — `apps/api/src/routes/admin.ts`**

```ts
const ALL_PERMISSIONS = [
  'edits.read',
  'edits.write',
  'tenants.read',
  'tenants.write',
  'billing.read',
  'billing.write',
  'health.read',
  'audit.read',
  // 0023 — đơn hàng và giao dịch (pha 3). `orders.write` gắn với mọi lệnh chạm tiền.
  'orders.read',
  'orders.write',
  // Pha 4 — tài khoản khách hàng. Danh sách và vô hiệu hoá chỉ cần Access (spec 13), nên một
  // quyền đọc là đủ; vô hiệu hoá không phải lệnh tiền.
  'customers.read',
] as const;
```

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/admin-orders.test.ts test/commerce-db.test.ts && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS toàn bộ; typecheck sạch.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin-orders.ts apps/api/src/routes/admin.ts apps/api/test/admin-orders.test.ts
git commit -m "feat(api): admin đơn hàng — lọc theo tenant và khoảng ngày (giờ VN), huỷ đơn sau khi PayOS xác nhận, đánh dấu hoàn tiền không đụng sổ; quyền customers.read

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Lớp SQL tài khoản khách cho admin — `console/admin-db.ts` + bài GRANT bằng role `api`

**Files:**
- Create: `apps/api/src/console/admin-db.ts`
- Test: `apps/api/test/console-admin-db.test.ts`
- Create: `db/customer-admin-grant.dbtest.mjs`

- [ ] **Step 1: Viết test đỏ `apps/api/test/console-admin-db.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  danhSachTaiKhoanAdmin,
  docTaiKhoanAdmin,
  kichHoatLaiTaiKhoan,
  phienCuaTaiKhoan,
  voHieuHoaTaiKhoan,
} from '../src/console/admin-db';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';

describe('danhSachTaiKhoanAdmin', () => {
  it('tìm theo email HOẶC tên, không phân biệt hoa thường; tenant lấy qua LATERAL để không nhân dòng', async () => {
    const { sql, calls } = fakeSql([]);
    await danhSachTaiKhoanAdmin(sql, { q: 'vidu', limit: 25, cursor: null });
    const q = calls[0] as RecordedQuery;
    expect(q.text).toContain("a.email ILIKE '%' || $");
    expect(q.text).toContain("a.name ILIKE '%' || $");
    expect(q.text).toContain('LEFT JOIN LATERAL');
    expect(q.text).toContain("m.role = 'owner'");
    expect(q.text).toContain('LIMIT $');
    expect(q.params).toContain(26);
  });

  it('con trỏ bind qua ::text::timestamptz như danh sách tenant', async () => {
    const { sql, calls } = fakeSql([]);
    await danhSachTaiKhoanAdmin(sql, {
      q: null,
      limit: 10,
      cursor: { createdAt: '2026-09-19T03:00:00.000000Z', id: ACCOUNT },
    });
    const q = calls[0] as RecordedQuery;
    expect(q.text).toContain('(a.created_at, a.id) < ($');
    expect(q.text).toContain('::text::timestamptz');
    expect(q.params).toContain('2026-09-19T03:00:00.000000Z');
  });
});

describe('phienCuaTaiKhoan', () => {
  it('KHÔNG chọn ip_hash hay token_hash; chỉ phiên còn hạn', async () => {
    const { sql, calls } = fakeSql([]);
    await phienCuaTaiKhoan(sql, ACCOUNT);
    const q = calls[0] as RecordedQuery;
    expect(q.text).not.toContain('ip_hash');
    expect(q.text).not.toContain('token_hash');
    expect(q.text).toContain('expires_at > now()');
    expect(q.text).toContain('user_agent');
  });
});

describe('voHieuHoaTaiKhoan', () => {
  it('đặt disabled_at CHỈ khi còn NULL rồi xoá mọi phiên, trong một transaction', async () => {
    const { sql, calls } = fakeSql((q) =>
      q.text.startsWith('UPDATE') ? [{ id: ACCOUNT }] : [{ token_hash: 'a' }, { token_hash: 'b' }],
    );
    const kq = await voHieuHoaTaiKhoan(sql, ACCOUNT);
    expect(kq).toEqual({ doi: true, phienXoa: 2 });
    expect(calls[0]?.text).toContain('SET disabled_at = now() WHERE id = $1::uuid AND disabled_at IS NULL');
    expect(calls[1]?.text).toContain('DELETE FROM customer_session WHERE account_id = $1::uuid');
  });

  it('đã bị khoá từ trước → doi:false nhưng phiên vẫn bị xoá (không để sót)', async () => {
    const { sql } = fakeSql((q) => (q.text.startsWith('UPDATE') ? [] : [{ token_hash: 'x' }]));
    expect(await voHieuHoaTaiKhoan(sql, ACCOUNT)).toEqual({ doi: false, phienXoa: 1 });
  });
});

describe('kichHoatLaiTaiKhoan', () => {
  it('chỉ đổi khi đang bị khoá', async () => {
    const { sql, calls } = fakeSql([]);
    expect(await kichHoatLaiTaiKhoan(sql, ACCOUNT)).toBe(false);
    expect(calls[0]?.text).toContain('SET disabled_at = NULL WHERE id = $1::uuid AND disabled_at IS NOT NULL');
  });
});

describe('docTaiKhoanAdmin', () => {
  it('cùng cột với danh sách, thêm điều kiện id', async () => {
    const { sql, calls } = fakeSql([]);
    expect(await docTaiKhoanAdmin(sql, ACCOUNT)).toBeNull();
    expect(calls[0]?.text).toContain('WHERE a.id = $1::uuid');
    expect(calls[0]?.text).toContain('(a.google_sub IS NOT NULL) AS google_linked');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/console-admin-db.test.ts`
Expected: FAIL — module `../src/console/admin-db` không tồn tại.

- [ ] **Step 3: Viết `apps/api/src/console/admin-db.ts`**

```ts
import type { getSql } from '../db';

/**
 * Câu SQL về tài khoản khách hàng dành cho TRANG ADMIN. Cố ý tách khỏi `console/db.ts`: mọi câu
 * bên đó mang điều kiện theo tài khoản/tenant của phiên, còn bên này KHÔNG có điều kiện đó — admin
 * đọc mọi tài khoản. Để chung một file là mời một ngày nào đó route khách hàng import nhầm câu
 * không giới hạn. Chỉ `routes/admin-customers.ts` được import file này.
 */

type Sql = ReturnType<typeof getSql>;

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
    ORDER BY m.created_at LIMIT 1) t ON true`;

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

export async function docTaiKhoanAdmin(sql: Sql, id: string): Promise<TaiKhoanAdmin | null> {
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
 */
export async function voHieuHoaTaiKhoan(
  sql: Sql,
  accountId: string,
): Promise<{ doi: boolean; phienXoa: number }> {
  return await sql.begin(async (tx) => {
    const doi = await tx<{ id: string }[]>`
      UPDATE customer_account SET disabled_at = now()
      WHERE id = ${accountId}::uuid AND disabled_at IS NULL RETURNING id`;
    const phien = await tx<{ token_hash: string }[]>`
      DELETE FROM customer_session WHERE account_id = ${accountId}::uuid RETURNING token_hash`;
    return { doi: doi.length > 0, phienXoa: phien.length };
  });
}

export async function kichHoatLaiTaiKhoan(sql: Sql, accountId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_account SET disabled_at = NULL
    WHERE id = ${accountId}::uuid AND disabled_at IS NOT NULL RETURNING id`;
  return rows.length > 0;
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/console-admin-db.test.ts`
Expected: PASS 7 bài.

- [ ] **Step 5: Bài GRANT `db/customer-admin-grant.dbtest.mjs`**

```js
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
  await sql`DELETE FROM tenant_member WHERE tenant_id IN (SELECT id FROM tenant WHERE name = ${TENANT})`;
  await sql`UPDATE customer_account SET trial_tenant_id = NULL WHERE email = ${EMAIL}`;
  await sql`DELETE FROM tenant WHERE name = ${TENANT}`;
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
    ORDER BY m.created_at LIMIT 1) t ON true`;

describe('GRANT cho admin tài khoản khách (pha 4) dưới role api', () => {
  beforeAll(async () => {
    await don();
    [{ id: accountId }] = await sql`
      INSERT INTO customer_account (email, name) VALUES (${EMAIL}, 'Kiểm Grant') RETURNING id`;
    [{ id: tenantId }] = await sql`
      INSERT INTO tenant (name, plan, quota_mode) VALUES (${TENANT}, 'free', 'commercial') RETURNING id`;
    await sql`INSERT INTO tenant_member (tenant_id, account_id, role)
      VALUES (${tenantId}::uuid, ${accountId}::uuid, 'owner')`;
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
      expect(ds.find((d) => d.email === EMAIL).tenant_name).toBe(TENANT);
      expect(ds.find((d) => d.email === EMAIL).google_linked).toBe(false);

      const [chiTiet] = await sql.unsafe(`SELECT ${COT} ${TU_TENANT} WHERE a.id = $1::uuid`, [accountId]);
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
          WHERE account_id = ${accountId}::uuid RETURNING token_hash`;
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
```

Lưu ý: `UPDATE customer_session SET user_agent` bị từ chối vì 0020 chỉ GRANT UPDATE `(last_seen_at, expires_at)` — đó là điều bài kiểm khẳng định.

- [ ] **Step 6: Chạy bài GRANT trên DB dev**

Run: `pnpm exec vitest run --config vitest.db.config.ts db/customer-admin-grant.dbtest.mjs`
Expected: PASS 3 bài. Sau đó **không** chạy tay `db/schema.dbtest.mjs` (nó xoá sạch DB dev — bài học pha 3).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/console/admin-db.ts apps/api/test/console-admin-db.test.ts db/customer-admin-grant.dbtest.mjs
git commit -m "feat(api): lớp SQL tài khoản khách cho admin — danh sách có tenant qua LATERAL, phiên không lộ băm, vô hiệu hoá xoá phiên trong transaction; bài GRANT role api

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Route `admin-customers.ts`; tenant detail trả `owner`

**Files:**
- Create: `apps/api/src/routes/admin-customers.ts`
- Modify: `apps/api/src/routes/admin.ts` (mount), `apps/api/src/routes/admin-tenants.ts` (GET `:id`)
- Test: `apps/api/test/admin-customers.test.ts`

- [ ] **Step 1: Viết test đỏ `apps/api/test/admin-customers.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { TaiKhoanAdmin } from '../src/console/admin-db';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { adminCustomersWith } from '../src/routes/admin-customers';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const TENANT = '00000000-0000-4000-8000-0000000000c1';
const NOW = new Date('2026-09-20T03:00:00Z');
const moi = { ...env, ENVIRONMENT: 'test' } as unknown as Env;

type Dong = TaiKhoanAdmin & { cursor_at?: string };
const taiKhoan = (them: Partial<Dong> = {}): Dong => ({
  id: ACCOUNT,
  email: 'khach@vidu.vn',
  name: 'Khách Thử',
  google_linked: false,
  last_login_at: NOW,
  disabled_at: null,
  created_at: NOW,
  tenant_id: TENANT,
  tenant_name: 'Công ty Thử',
  tenant_quota_mode: 'commercial',
  cursor_at: '2026-09-20T03:00:00.000000Z',
  ...them,
});

interface DongAudit {
  action: string;
  target: string;
  detail: Record<string, unknown>;
}

function kho(tuyChon: { danhSach?: Dong[]; tk?: Dong | null; phien?: number } = {}) {
  let hienTai = tuyChon.tk === undefined ? taiKhoan() : tuyChon.tk;
  const audit: DongAudit[] = [];
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('LEFT JOIN LATERAL') && q.text.includes('LIMIT $')) return tuyChon.danhSach ?? [];
    if (q.text.includes('WHERE a.id = $')) return hienTai ? [hienTai] : [];
    if (q.text.includes('FROM customer_session')) {
      return Array.from({ length: tuyChon.phien ?? 1 }, (_, i) => ({
        created_at: NOW,
        last_seen_at: NOW,
        expires_at: NOW,
        user_agent: `UA ${i}`,
      }));
    }
    if (q.text.includes('SET disabled_at = now()')) {
      if (!hienTai || hienTai.disabled_at) return [];
      hienTai = { ...hienTai, disabled_at: NOW };
      return [{ id: ACCOUNT }];
    }
    if (q.text.includes('DELETE FROM customer_session')) return [{ token_hash: 'a' }, { token_hash: 'b' }];
    if (q.text.includes('SET disabled_at = NULL')) {
      if (!hienTai?.disabled_at) return [];
      hienTai = { ...hienTai, disabled_at: null };
      return [{ id: ACCOUNT }];
    }
    return [];
  });
  return { sql, calls, audit, doc: () => hienTai };
}

const boiCanh = () =>
  ({
    waitUntil: (p: Promise<unknown>) => void p.catch(() => {}),
    passThroughOnException: () => {},
  }) as unknown as ExecutionContext;

function app(k: ReturnType<typeof kho>, email: string | null = 'admin@test.local') {
  const a = new Hono<AppEnv>();
  a.onError((err, c) => errorResponse(c, err));
  a.use('*', async (c, next) => {
    if (!email) return c.json({ error: { code: 'missing_access_jwt' } }, 401);
    c.set('reviewer', email);
    await next();
  });
  a.route(
    '/',
    adminCustomersWith({
      sql: () => k.sql,
      writeAuditEntry: (e) => k.audit.push(e as DongAudit),
    }),
  );
  return a;
}

const get = (a: Hono<AppEnv>, d: string) => a.request(`https://api${d}`, {}, moi, boiCanh());
const post = (a: Hono<AppEnv>, d: string, body: unknown) =>
  a.request(
    `https://api${d}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    moi,
    boiCanh(),
  );
const than = { operationId: 'op-khach-0001', reason: 'Lạm dụng mã OTP' };

describe('GET /v1/admin/customers', () => {
  it('không reviewer → 401', async () => {
    expect((await get(app(kho(), null), '/v1/admin/customers')).status).toBe(401);
  });

  it('danh sách: googleLinked, tenant lồng, nextCursor khi dư một dòng; q vào SQL', async () => {
    const ds = Array.from({ length: 26 }, (_, i) =>
      taiKhoan({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}` }),
    );
    const k = kho({ danhSach: ds });
    const res = await get(app(k), '/v1/admin/customers?q=vidu&limit=25');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(25);
    expect(body.items[0]).toMatchObject({
      email: 'khach@vidu.vn',
      googleLinked: false,
      disabledAt: null,
      tenant: { id: TENANT, name: 'Công ty Thử', quotaMode: 'commercial' },
    });
    expect(body.items[0]).not.toHaveProperty('cursorAt');
    expect(body.items[0]).not.toHaveProperty('googleSub');
    expect(body.nextCursor).toMatch(/\|/);
    expect(k.calls[0]?.params).toContain('vidu');
  });

  it('tài khoản chưa có tổ chức → tenant: null', async () => {
    const k = kho({ danhSach: [taiKhoan({ tenant_id: null, tenant_name: null, tenant_quota_mode: null })] });
    const body = (await (await get(app(k), '/v1/admin/customers')).json()) as { items: { tenant: unknown }[] };
    expect(body.items[0]?.tenant).toBeNull();
  });

  it('cursor rác → 400', async () => {
    expect((await get(app(kho()), '/v1/admin/customers?cursor=rac')).status).toBe(400);
  });
});

describe('GET /v1/admin/customers/:id', () => {
  it('tài khoản + phiên (không token_hash, không ip_hash); 404 khi không có; id rác → 404', async () => {
    const res = await get(app(kho({ phien: 2 })), `/v1/admin/customers/${ACCOUNT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { account: { id: string }; sessions: Record<string, unknown>[] };
    expect(body.account.id).toBe(ACCOUNT);
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0]).toEqual({
      createdAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      expiresAt: NOW.toISOString(),
      userAgent: 'UA 0',
    });
    expect(JSON.stringify(body)).not.toMatch(/token_hash|ip_hash|tokenHash|ipHash/);
    expect((await get(app(kho({ tk: null })), `/v1/admin/customers/${ACCOUNT}`)).status).toBe(404);
    expect((await get(app(kho()), '/v1/admin/customers/rac')).status).toBe(404);
  });
});

describe('POST /v1/admin/customers/:id/disable', () => {
  it('đang hoạt động → disabledAt đặt, phiên bị xoá, audit giữ lý do', async () => {
    const k = kho();
    const res = await post(app(k), `/v1/admin/customers/${ACCOUNT}/disable`, than);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      account: { disabledAt: NOW.toISOString() },
      moi: true,
      sessionsDeleted: 2,
    });
    expect(k.audit.find((d) => d.action === 'admin.customer.disable')?.detail).toMatchObject({
      email: 'khach@vidu.vn',
      reason: 'Lạm dụng mã OTP',
      operation_id: 'op-khach-0001',
      sessions_deleted: 2,
    });
  });

  it('đã bị khoá → 200 moi:false, KHÔNG ghi audit lần hai', async () => {
    const k = kho({ tk: taiKhoan({ disabled_at: NOW }) });
    const res = await post(app(k), `/v1/admin/customers/${ACCOUNT}/disable`, than);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ moi: false });
    expect(k.audit).toHaveLength(0);
  });

  it('thiếu lý do → 400 invalid_reason; operationId sai → 400; không có tài khoản → 404', async () => {
    const a = app(kho());
    expect((await post(a, `/v1/admin/customers/${ACCOUNT}/disable`, { ...than, reason: '' })).status).toBe(400);
    expect((await post(a, `/v1/admin/customers/${ACCOUNT}/disable`, { ...than, operationId: 'x' })).status).toBe(400);
    expect((await post(app(kho({ tk: null })), `/v1/admin/customers/${ACCOUNT}/disable`, than)).status).toBe(404);
  });
});

describe('POST /v1/admin/customers/:id/enable', () => {
  it('đang bị khoá → disabledAt về null, audit admin.customer.enable', async () => {
    const k = kho({ tk: taiKhoan({ disabled_at: NOW }) });
    const res = await post(app(k), `/v1/admin/customers/${ACCOUNT}/enable`, than);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ account: { disabledAt: null }, moi: true });
    expect(k.audit.map((d) => d.action)).toEqual(['admin.customer.enable']);
  });

  it('đang hoạt động → 200 moi:false', async () => {
    const res = await post(app(kho()), `/v1/admin/customers/${ACCOUNT}/enable`, than);
    expect(await res.json()).toMatchObject({ moi: false });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/admin-customers.test.ts`
Expected: FAIL — module `../src/routes/admin-customers` không tồn tại.

- [ ] **Step 3: Viết `apps/api/src/routes/admin-customers.ts`**

```ts
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
import { encodeTenantCursor, parseTenantListParams } from './admin-tenant-params';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BODY = 16 * 1024;

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

async function docJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) {
    throw new ApiError(413, 'payload_too_large', 'Thân yêu cầu quá lớn');
  }
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Lý do và operationId là bắt buộc cho mọi lệnh ghi (spec 13): audit phải nói được VÌ SAO. */
function docLenh(body: Record<string, unknown>): { reason: string; operationId: string } {
  const operationId = body.operationId;
  if (typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) {
    throw new ApiError(400, 'invalid_request', 'operationId phải có 8–64 ký tự [A-Za-z0-9_-]');
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!reason) throw new ApiError(400, 'invalid_reason', 'Cần lý do');
  return { reason, operationId };
}

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
      const { doi, phienXoa } = await voHieuHoaTaiKhoan(sql, id);
      const sau = (await docTaiKhoanAdmin(sql, id)) ?? tk;
      return { tk: sau, doi, phienXoa };
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
      const doi = await kichHoatLaiTaiKhoan(sql, id);
      const sau = (await docTaiKhoanAdmin(sql, id)) ?? tk;
      return { tk: sau, doi };
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
```

Bẫy với `fakeSql`: route gọi `docTaiKhoanAdmin` hai lần quanh lệnh ghi (trước để 404 sớm, sau để trả trạng thái mới). Bản giả trong test trả `hienTai` đã đổi nên khẳng định `disabledAt` mới là thật.

- [ ] **Step 4: Mount vào app `admin` — `apps/api/src/routes/admin.ts`**

Thêm import `import { adminCustomers } from './admin-customers';` và dòng mount sau `admin.route('/', adminTenants);`:

```ts
// Tài khoản khách hàng (pha 4): cùng cổng Access + chống CSRF như tenant; không chạm tiền nên
// không qua requireBillingAccess — đơn của khách giao diện lấy ở /v1/admin/orders?tenant=….
admin.route('/', adminCustomers);
```

- [ ] **Step 5: Tenant detail trả `owner` — `apps/api/src/routes/admin-tenants.ts`**

Import `import { chuTenant } from '../commerce/db';`. Trong `GET /v1/admin/tenants/:id`, sau câu `keys`:

```ts
    // Chủ tổ chức (pha 4): admin cần biết ai đứng sau tenant để liên hệ, và để nhảy sang màn Khách
    // hàng. Tenant nội bộ/cũ không có owner → null, giao diện hiện "—".
    const chu = await chuTenant(sql, id);
```

và trong `c.json({ tenant, keys: … })` thêm:

```ts
        owner: chu
          ? { email: chu.email, billingEmail: chu.billingEmail, accountId: chu.accountId }
          : null,
```

- [ ] **Step 6: Chạy test, typecheck**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/admin-customers.test.ts test/admin-tenants.test.ts test/admin-me.test.ts && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS; typecheck sạch.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin-customers.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin-tenants.ts apps/api/test/admin-customers.test.ts
git commit -m "feat(api): admin tài khoản khách — danh sách/chi tiết/vô hiệu hoá/kích hoạt lại sau cổng Access, phiên không lộ băm; chi tiết tenant trả chủ tổ chức

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: itest trên harness — Postgres thật, PayOS giả, Access giả

**Files:**
- Create: `apps/api/test-db/admin-customers.itest.mjs`
- Create: `apps/api/test-db/admin-orders.itest.mjs`

Harness `node scripts/api-db-test.mjs` tự tìm `apps/api/test-db/*.itest.mjs`. Email Access giả `phong@access-fake.local` nằm trong `BILLING_ADMIN_EMAILS` của harness nên gọi được cả `/v1/admin/orders*`.

- [ ] **Step 1: `apps/api/test-db/admin-customers.itest.mjs`**

```js
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });

/** Dọn như commerce.itest: quota-summary chỉ lấy 25 tenant mới nhất, để lại là đỏ bài khác. */
const emailDaTao = [];
afterAll(async () => {
  for (const email of emailDaTao) {
    const [tk] = await sql`SELECT id, trial_tenant_id FROM customer_account WHERE email = ${email}`;
    if (!tk) continue;
    await sql`DELETE FROM customer_session WHERE account_id = ${tk.id}::uuid`;
    await sql`DELETE FROM customer_login_code WHERE email = ${email}`;
    const tenants = await sql`SELECT tenant_id FROM tenant_member WHERE account_id = ${tk.id}::uuid`;
    await sql`DELETE FROM tenant_member WHERE account_id = ${tk.id}::uuid`;
    await sql`UPDATE customer_account SET trial_tenant_id = NULL WHERE id = ${tk.id}::uuid`;
    for (const { tenant_id } of tenants) {
      await sql`DELETE FROM api_key WHERE tenant_id = ${tenant_id}::uuid`;
      await sql`DELETE FROM tenant WHERE id = ${tenant_id}::uuid`;
    }
    await sql`DELETE FROM customer_account WHERE id = ${tk.id}::uuid`;
  }
  await sql.end({ timeout: 5 });
});

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
/** @param {string} path @param {RequestInit} [init] */
const adminFetch = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      'Sec-Fetch-Site': 'same-origin',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

/** Đăng nhập bằng mã một lần qua đúng đường của cổng khách; trả cookie + hàm gọi. @param {string} email */
async function dangNhap(email) {
  const xin = await fetch(`${base}/v1/console/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ email, turnstileToken: '' }),
  });
  const ma = xin.headers.get('x-debug-otp');
  const xac = await fetch(`${base}/v1/console/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ email, code: ma }),
  });
  const cookie = (xac.headers.get('set-cookie') ?? '').split(';')[0];
  /** @param {string} path @param {RequestInit} [init] */
  const khach = (path, init = {}) =>
    fetch(base + path, {
      ...init,
      headers: {
        cookie,
        'Sec-Fetch-Site': 'same-origin',
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  return { status: xac.status, body: await xac.json().catch(() => ({})), khach };
}

/** @param {string} action @param {string} target */
async function doiAudit(action, target) {
  for (let i = 0; i < 24; i += 1) {
    const rows = await sql`SELECT detail FROM admin_audit WHERE action = ${action} AND target = ${target}`;
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

describe('admin tài khoản khách — trọn chặng', () => {
  it('đăng ký → admin tìm thấy → tạo tổ chức → chi tiết có phiên → vô hiệu hoá có hiệu lực trong MỘT request → đăng nhập lại bị 403 → kích hoạt lại', async () => {
    const email = `khach-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@vidu.vn`;
    emailDaTao.push(email);
    const k1 = await dangNhap(email);
    expect(k1.status).toBe(200);

    // Danh sách: tìm theo email, chưa có tổ chức.
    let ds = await (await adminFetch(`/v1/admin/customers?q=${encodeURIComponent(email)}`)).json();
    expect(ds.items).toHaveLength(1);
    expect(ds.items[0]).toMatchObject({ email, googleLinked: false, disabledAt: null, tenant: null });
    const id = ds.items[0].id;

    // Tạo tổ chức → danh sách hiện tên tenant; chi tiết tenant hiện owner.
    const tao = await k1.khach('/v1/console/tenant', {
      method: 'POST',
      body: JSON.stringify({ name: 'Công ty Khách Admin' }),
    });
    const { tenant } = await tao.json();
    ds = await (await adminFetch(`/v1/admin/customers?q=${encodeURIComponent(email)}`)).json();
    expect(ds.items[0].tenant).toMatchObject({ id: tenant.id, name: 'Công ty Khách Admin' });
    const ct = await (await adminFetch(`/v1/admin/tenants/${tenant.id}`)).json();
    expect(ct.owner).toMatchObject({ email, accountId: id });

    // Chi tiết: một phiên, không lộ băm.
    const chiTiet = await (await adminFetch(`/v1/admin/customers/${id}`)).json();
    expect(chiTiet.account.email).toBe(email);
    expect(chiTiet.sessions.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(chiTiet)).not.toMatch(/token_hash|ip_hash|tokenHash|ipHash|google_sub/);

    // Khách đang vào được.
    expect((await k1.khach('/v1/console/me')).status).toBe(200);

    // Vô hiệu hoá → request kế tiếp của khách nhận 401 (phiên đã xoá): tiêu chí 20.11.
    const than = { operationId: `op-${Date.now()}`, reason: 'Kiểm thử vô hiệu hoá' };
    const khoa = await adminFetch(`/v1/admin/customers/${id}/disable`, {
      method: 'POST',
      body: JSON.stringify(than),
    });
    expect(khoa.status).toBe(200);
    const khoaBody = await khoa.json();
    expect(khoaBody.moi).toBe(true);
    expect(khoaBody.sessionsDeleted).toBeGreaterThanOrEqual(1);
    expect(khoaBody.account.disabledAt).not.toBeNull();
    expect((await k1.khach('/v1/console/me')).status).toBe(401);

    // Đăng nhập lại bị chặn ở bước xác nhận mã: 403 account_disabled.
    const k2 = await dangNhap(email);
    expect(k2.status).toBe(403);
    expect(k2.body.error.code).toBe('account_disabled');

    const audit = await doiAudit('admin.customer.disable', id);
    expect(audit).toHaveLength(1);
    expect(audit[0].detail.reason).toBe('Kiểm thử vô hiệu hoá');

    // Gọi lại: thành công, không đổi gì.
    const lai = await adminFetch(`/v1/admin/customers/${id}/disable`, {
      method: 'POST',
      body: JSON.stringify(than),
    });
    expect((await lai.json()).moi).toBe(false);

    // Kích hoạt lại → đăng nhập được, /me 200.
    const mo = await adminFetch(`/v1/admin/customers/${id}/enable`, {
      method: 'POST',
      body: JSON.stringify({ operationId: `op-mo-${Date.now()}`, reason: 'Đã xác minh' }),
    });
    expect((await mo.json())).toMatchObject({ moi: true, account: { disabledAt: null } });
    const k3 = await dangNhap(email);
    expect(k3.status).toBe(200);
    expect((await k3.khach('/v1/console/me')).status).toBe(200);
    expect(await doiAudit('admin.customer.enable', id)).toHaveLength(1);
  });

  it('cổng: thiếu JWT → 401; POST cross-site → 403 trước cả JWT', async () => {
    expect((await fetch(`${base}/v1/admin/customers`)).status).toBe(401);
    const res = await fetch(`${base}/v1/admin/customers/00000000-0000-4000-8000-000000000001/disable`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('cross_site_request');
  });
});
```

- [ ] **Step 2: `apps/api/test-db/admin-orders.itest.mjs`**

```js
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';
import { PAYOS_FAKE_PORT } from '../../../scripts/lib/payos-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const payosFake = `http://127.0.0.1:${PAYOS_FAKE_PORT}`;
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });

const tenantDaTao = [];
afterAll(async () => {
  for (const id of tenantDaTao) {
    await sql`DELETE FROM payment_event WHERE order_id IN (
      SELECT id FROM customer_order WHERE tenant_id = ${id}::uuid)`;
    await sql`DELETE FROM customer_order WHERE tenant_id = ${id}::uuid`;
    await sql`DELETE FROM api_key WHERE tenant_id = ${id}::uuid`;
    await sql`DELETE FROM tenant_member WHERE tenant_id = ${id}::uuid`;
    await sql`UPDATE customer_account SET trial_tenant_id = NULL WHERE trial_tenant_id = ${id}::uuid`;
    await sql`DELETE FROM tenant WHERE id = ${id}::uuid`;
  }
  await sql.end({ timeout: 5 });
});

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
/** @param {string} path @param {RequestInit} [init] */
const adminFetch = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      'Sec-Fetch-Site': 'same-origin',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

/** @param {string} ten */
async function dangKy(ten) {
  const email = `don-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@vidu.vn`;
  const xin = await fetch(`${base}/v1/console/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ email, turnstileToken: '' }),
  });
  const ma = xin.headers.get('x-debug-otp');
  const xac = await fetch(`${base}/v1/console/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ email, code: ma }),
  });
  const cookie = (xac.headers.get('set-cookie') ?? '').split(';')[0];
  /** @param {string} path @param {RequestInit} [init] */
  const khach = (path, init = {}) =>
    fetch(base + path, {
      ...init,
      headers: { cookie, 'Sec-Fetch-Site': 'same-origin', 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  const { tenant } = await (
    await khach('/v1/console/tenant', { method: 'POST', body: JSON.stringify({ name: ten }) })
  ).json();
  tenantDaTao.push(tenant.id);
  return { email, khach, tenantId: tenant.id };
}

/** @param {{khach: (p: string, i?: RequestInit) => Promise<Response>}} k */
const taoDonStarter = async (k) =>
  (await (await k.khach('/v1/console/orders', {
    method: 'POST',
    body: JSON.stringify({ kind: 'plan', tier: 'starter', months: 1 }),
  })).json()).order;

/** @param {string} action @param {string} target */
async function doiAudit(action, target) {
  for (let i = 0; i < 24; i += 1) {
    const rows = await sql`SELECT detail FROM admin_audit WHERE action = ${action} AND target = ${target}`;
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

/** Ngày YYYY-MM-DD theo giờ Việt Nam, lệch `lech` ngày. @param {number} lech */
const ngayVN = (lech) =>
  new Date(Date.now() + 7 * 3_600_000 + lech * 86_400_000).toISOString().slice(0, 10);

describe('admin đơn hàng — huỷ, hoàn tiền, bộ lọc', () => {
  it('huỷ đơn pending: PayOS giả thấy CANCELLED, đơn cancelled, audit giữ lý do, gọi lại moi:false', async () => {
    const k = await dangKy('Công ty Admin Huỷ');
    const don = await taoDonStarter(k);
    expect(don.status).toBe('pending');

    const than = { operationId: `op-huy-${don.orderCode}`, reason: 'Khách gọi điện xin huỷ' };
    const huy = await adminFetch(`/v1/admin/orders/${don.id}/cancel`, { method: 'POST', body: JSON.stringify(than) });
    expect(huy.status).toBe(200);
    expect(await huy.json()).toMatchObject({ moi: true, order: { status: 'cancelled', note: than.reason } });

    const tt = await (
      await fetch(`${payosFake}/v2/payment-requests/${don.orderCode}`, {
        headers: { 'x-client-id': 'fake-client-id', 'x-api-key': 'fake-api-key' },
      })
    ).json();
    expect(tt.data.status).toBe('CANCELLED');

    expect((await (await k.khach(`/v1/console/orders/${don.id}`)).json()).order.status).toBe('cancelled');
    const audit = await doiAudit('admin.order.cancel', don.id);
    expect(audit[0].detail).toMatchObject({ reason: than.reason, payos_link: true });

    const lai = await adminFetch(`/v1/admin/orders/${don.id}/cancel`, { method: 'POST', body: JSON.stringify(than) });
    expect((await lai.json()).moi).toBe(false);
  });

  it('hoàn tiền đơn fulfilled: refunded + note, sổ quota KHÔNG đổi, audit có số tiền; pending → 409', async () => {
    const k = await dangKy('Công ty Admin Hoàn');
    const don = await taoDonStarter(k);
    const tra = await (
      await fetch(`${payosFake}/__fake/pay/${don.orderCode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ webhookUrl: `${base}/v1/pay/payos/webhook`, reference: `FT-HOAN-${don.orderCode}` }),
      })
    ).json();
    expect(tra.webhookBody).toMatchObject({ status: 'fulfilled' });

    const truoc = await (await adminFetch(`/v1/admin/billing/${k.tenantId}/periods`)).json();
    const than = { operationId: `op-hoan-${don.orderCode}`, reason: 'Khách không dùng, đã chuyển trả' };
    const hoan = await adminFetch(`/v1/admin/orders/${don.id}/refund`, { method: 'POST', body: JSON.stringify(than) });
    expect(hoan.status).toBe(200);
    expect(await hoan.json()).toMatchObject({ moi: true, order: { status: 'refunded', note: than.reason, paidAmountVnd: 650_000 } });

    const sau = await (await adminFetch(`/v1/admin/billing/${k.tenantId}/periods`)).json();
    expect(sau.periods).toEqual(truoc.periods);
    expect((await (await k.khach('/v1/console/usage')).json()).status).toBe('active');

    const audit = await doiAudit('admin.order.refund', don.id);
    expect(audit[0].detail).toMatchObject({ reason: than.reason, paid_amount_vnd: 650_000 });

    // Webhook bắn lại cho đơn refunded: 200, không đổi gì (apDungThanhToan trả khong_doi).
    const lai = await fetch(`${base}/v1/pay/payos/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tra.webhook),
    });
    expect(lai.status).toBe(200);
    expect((await (await adminFetch(`/v1/admin/orders/${don.id}`)).json()).order.status).toBe('refunded');

    const donMoi = await taoDonStarter(k);
    const tuChoi = await adminFetch(`/v1/admin/orders/${donMoi.id}/refund`, { method: 'POST', body: JSON.stringify(than) });
    expect(tuChoi.status).toBe(409);
    expect((await tuChoi.json()).error.code).toBe('order_not_refundable');
  });

  it('bộ lọc tenant + status + khoảng ngày (giờ VN)', async () => {
    const k = await dangKy('Công ty Admin Lọc');
    const d1 = await taoDonStarter(k);
    await adminFetch(`/v1/admin/orders/${d1.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ operationId: `op-loc-${d1.orderCode}`, reason: 'lọc' }),
    });
    const d2 = await taoDonStarter(k);

    const tatCa = await (await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}`)).json();
    expect(tatCa.items.map((d) => d.id).sort()).toEqual([d1.id, d2.id].sort());
    for (const d of tatCa.items) expect(d.tenantId).toBe(k.tenantId);

    const daHuy = await (await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}&status=cancelled`)).json();
    expect(daHuy.items.map((d) => d.id)).toEqual([d1.id]);

    const homNay = await (await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}&from=${ngayVN(0)}&to=${ngayVN(0)}`)).json();
    expect(homNay.items).toHaveLength(2);
    const ngayMai = await (await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}&from=${ngayVN(1)}`)).json();
    expect(ngayMai.items).toHaveLength(0);
    const homQua = await (await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}&to=${ngayVN(-1)}`)).json();
    expect(homQua.items).toHaveLength(0);

    expect((await adminFetch('/v1/admin/orders?tenant=rac')).status).toBe(400);
  });
});
```

- [ ] **Step 3: Chạy harness**

Run: `pnpm test:api-db`
Expected: mọi itest xanh, gồm 2 file mới (5 bài). Nếu bài `ngayVN` đỏ vì chạy sát nửa đêm giờ VN thì chạy lại — ghi nhận là bẫy đo, không phải lỗi mã.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test-db/admin-customers.itest.mjs apps/api/test-db/admin-orders.itest.mjs
git commit -m "test(itest): admin khách hàng — vô hiệu hoá có hiệu lực trong một request, đăng nhập lại 403; admin đơn hàng — huỷ qua PayOS giả, hoàn tiền không đụng sổ, bộ lọc tenant/ngày

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5b: Vòng dọn API sau rà Task 2 và Task 4

Sinh ra từ hai bản rà chất lượng, **chạy sau khi Task 5 (itest) đã xanh** để không đổi mã API giữa lúc harness đang chạy.

**Files:**
- Create: `apps/api/src/routes/admin-lenh.ts`
- Modify: `apps/api/src/console/admin-db.ts`, `apps/api/src/routes/admin-customers.ts`, `apps/api/src/routes/admin-orders.ts`, `apps/api/test/admin-customers.test.ts`, `apps/api/test/console-admin-db.test.ts`

- [ ] **Step 1: Bỏ lần đọc thứ hai ngoài transaction (đua trạng thái)**

`disable` và `enable` hiện đi ba lượt: đọc → ghi trong `sql.begin` → đọc lại **ngoài** transaction. Hai admin bấm ngược nhau cùng lúc thì phản hồi trả `moi: true` kèm `disabledAt: null` — báo sai trạng thái trong khi audit nói đã khoá. Cho `voHieuHoaTaiKhoan`/`kichHoatLaiTaiKhoan` đọc lại **trong cùng `tx`** và trả luôn dòng tài khoản:

```ts
export async function voHieuHoaTaiKhoan(
  sql: Sql,
  accountId: string,
): Promise<{ doi: boolean; phienXoa: number; tk: TaiKhoanAdmin | null }> {
```

Route giữ lần đọc ĐẦU (để 404 sớm và lấy email cho audit) và bỏ hẳn lần đọc thứ hai. Bài kiểm: hai lệnh vẫn trả đúng `account.disabledAt` mới, và số lời gọi SQL giảm đúng một.

- [ ] **Step 2: Gom phần dùng chung của hai nhóm route lệnh**

`NO_STORE`, `UUID`, `OPERATION_ID`, `MAX_BODY`, `docJson()` và luật `reason.trim().slice(0, 500)` đang bị chép nguyên văn ở `admin-orders.ts` lẫn `admin-customers.ts`, và đã bắt đầu trôi: một bên tách `docLyDo` + `docOperationId`, bên kia gộp thành `docLenh`, còn `confirm-manual` viết bản thứ ba inline. Tách `apps/api/src/routes/admin-lenh.ts` giữ `NO_STORE`, `UUID`, `OPERATION_ID`, `MAX_BODY`, `docJson`, `docLyDo`, `docOperationId`, `docLenh`; hai file cùng import. Thuần cơ học, **không đổi một hành vi nào** — mã lỗi cũ của `confirm-manual` (`invalid_confirm`) giữ nguyên.

- [ ] **Step 3: Hai bài kiểm còn thiếu ở tầng route**

1. `admin-customers.test.ts`: fixture `taiKhoan()` thêm `google_sub: 'sub-123'` rồi khẳng định `expect(JSON.stringify(body)).not.toMatch(/google_sub|sub-123/)` — hiện fixture không có khoá đó nên một `...a` lỡ tay vẫn xanh.
2. Cùng file: khẳng định câu đọc phiên mang đúng id tài khoản — `expect(k.calls.find((q) => q.text.includes('FROM customer_session'))?.params).toContain(ACCOUNT)`.

- [ ] **Step 4: Cổng và commit**

```bash
pnpm --filter @mapslibvn/api test
pnpm --filter @mapslibvn/api typecheck
pnpm typecheck
pnpm exec biome check apps/api/src/routes apps/api/src/console apps/api/test
pnpm exec vitest run --config vitest.db.config.ts db/customer-admin-grant.dbtest.mjs
pnpm test:api-db
```

```bash
git commit apps/api/src/routes/admin-lenh.ts apps/api/src/routes/admin-customers.ts apps/api/src/routes/admin-orders.ts apps/api/src/console/admin-db.ts apps/api/test/admin-customers.test.ts apps/api/test/console-admin-db.test.ts -m "refactor(api): gom hằng và bộ đọc lệnh dùng chung của hai nhóm route admin; vô hiệu hoá/kích hoạt lại đọc lại trong cùng transaction

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Admin nền — quyền, sidebar, route, mã lỗi, loại việc audit, form lý do dùng chung

**Files:**
- Modify: `apps/admin/src/lib/permissions.ts`, `apps/admin/src/layout/sidebar-nav.tsx` (+ `.test.tsx`), `apps/admin/src/routes.tsx` (+ `.test.tsx`), `apps/admin/src/features/billing/error-vi.ts`, `apps/admin/src/features/audit/api.ts`
- Create: `apps/admin/src/features/lenh/form-ly-do.tsx`, `apps/admin/src/features/lenh/form-ly-do.test.tsx`
- Create (tạm, để route không đỏ): `apps/admin/src/features/customers/page.tsx` — bản rỗng ở task này, Task 8 viết thật

- [ ] **Step 1: Test đỏ — sidebar và routes**

`apps/admin/src/layout/sidebar-nav.test.tsx`: thêm `'customers.read'` vào `FULL.permissions` và thêm `describe` cuối file:

```tsx
describe('mục Tài khoản khách hàng (pha 4)', () => {
  it('hiện khi có quyền customers.read, đứng trong nhóm Khách hàng', () => {
    renderNav(FULL);
    expect(screen.getByRole('link', { name: 'Tài khoản khách hàng' })).toBeVisible();
  });

  it('ẩn khi không có quyền đó', () => {
    renderNav({ email: 'a@b.c', permissions: ['edits.read', 'orders.read'] });
    expect(screen.queryByRole('link', { name: 'Tài khoản khách hàng' })).toBeNull();
  });
});
```

`apps/admin/src/routes.test.tsx`: thêm `'customers.read'` vào `ME.permissions` và bài:

```tsx
  it('/admin/customers có màn hình thật từ pha 4 thương mại', async () => {
    mo('/admin/customers');
    expect(await screen.findByLabelText('Tìm theo email hoặc tên')).toBeVisible();
    expect(document.body.textContent).not.toContain('Không có màn hình này');
  });
```

- [ ] **Step 2: Test đỏ — `form-ly-do.test.tsx`**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FormLyDo } from './form-ly-do';

describe('FormLyDo', () => {
  it('nút gửi khoá khi lý do trống hoặc chỉ khoảng trắng; gửi lý do đã trim', async () => {
    const onGui = vi.fn();
    render(
      <FormLyDo tieuDe="Huỷ đơn 100001" moTa="Sẽ huỷ link PayOS." nutGui="Huỷ đơn" onGui={onGui} onThoi={() => {}} />,
    );
    const gui = screen.getByRole('button', { name: 'Huỷ đơn' });
    expect(gui).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Lý do'), '   ');
    expect(gui).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Lý do'));
    await userEvent.type(screen.getByLabelText('Lý do'), '  Khách đổi ý  ');
    expect(gui).toBeEnabled();
    await userEvent.click(gui);
    expect(onGui).toHaveBeenCalledWith('Khách đổi ý');
  });

  it('nút Thôi gọi onThoi, không gọi onGui', async () => {
    const onGui = vi.fn();
    const onThoi = vi.fn();
    render(<FormLyDo tieuDe="T" moTa="M" nutGui="Gửi" onGui={onGui} onThoi={onThoi} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thôi' }));
    expect(onThoi).toHaveBeenCalledTimes(1);
    expect(onGui).not.toHaveBeenCalled();
  });

  it('form mang aria-label là tiêu đề để hai form cùng ô "Lý do" phân biệt được', () => {
    render(<FormLyDo tieuDe="Đánh dấu hoàn tiền" moTa="M" nutGui="Gửi" onGui={() => {}} onThoi={() => {}} />);
    expect(screen.getByRole('form', { name: 'Đánh dấu hoàn tiền' })).toBeVisible();
  });
});
```

- [ ] **Step 3: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run apps/admin/src/layout/sidebar-nav.test.tsx apps/admin/src/routes.test.tsx apps/admin/src/features/lenh`
Expected: FAIL — không có link "Tài khoản khách hàng", `/admin/customers` rơi vào "Không có màn hình này", module `form-ly-do` thiếu.

- [ ] **Step 4: `permissions.ts` — quyền mới và `can()` chịu được `me` hỏng**

```ts
export type Permission =
  | 'edits.read'
  | 'edits.write'
  | 'tenants.read'
  | 'tenants.write'
  | 'billing.read'
  | 'billing.write'
  | 'health.read'
  | 'audit.read'
  | 'orders.read'
  | 'orders.write'
  | 'customers.read';
```

```ts
export function can(me: Me | undefined, permission: Permission): boolean {
  // `Array.isArray` chứ không `me?.permissions.includes`: một /v1/admin/me trả thân lạ (proxy
  // chèn trang HTML, hay stub test trả nhầm) không được làm trắng cả trang vì `.includes` của
  // undefined. Không có quyền thì ẩn, đó là hành vi đúng cho dữ liệu hỏng.
  return Array.isArray(me?.permissions) && me.permissions.includes(permission);
}
```

- [ ] **Step 5: `sidebar-nav.tsx` — mục mới đứng đầu nhóm Khách hàng**

```ts
  {
    title: 'Khách hàng',
    items: [
      // "Tài khoản khách hàng" chứ không "Khách hàng": trùng chữ với tiêu đề nhóm ngay trên.
      { to: '/customers', label: 'Tài khoản khách hàng', permission: 'customers.read' },
      { to: '/tenants', label: 'Tenant & khoá API', permission: 'tenants.read' },
      { to: '/billing', label: 'Gói cước & hạn mức', permission: 'billing.read' },
      { to: '/orders', label: 'Đơn hàng & giao dịch', permission: 'orders.read' },
    ],
  },
```

- [ ] **Step 6: `routes.tsx` — route `/customers`**

```tsx
const CustomersPage = lazy(() =>
  import('@/features/customers/page').then((module) => ({ default: module.CustomersPage })),
);
```

và trong `children`, sau `orders`: `{ path: 'customers', element: wait(<CustomersPage />) },`.

Tạo **bản tạm** `apps/admin/src/features/customers/page.tsx` để route và test biên dịch (Task 8 thay toàn bộ):

```tsx
export function CustomersPage() {
  return (
    <input
      aria-label="Tìm theo email hoặc tên"
      placeholder="Tìm theo email hoặc tên"
      className="min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
    />
  );
}
```

- [ ] **Step 7: `error-vi.ts` — mã lỗi của pha 3 và pha 4**

Thêm vào `MA_LOI_BILLING` (trước `khong_goi_duoc`):

```ts
  order_not_found: 'Không có đơn này — có thể đã bị xoá cùng tổ chức thử.',
  order_not_fulfillable: 'Chỉ cấp lại được đơn đã có tiền mà gói chưa vào sổ.',
  order_not_confirmable: 'Chỉ xác nhận tay cho đơn đang chờ, thiếu tiền hoặc hết hạn.',
  order_not_cancellable:
    'Chỉ huỷ được đơn đang chờ thanh toán. Đơn đã có tiền thì không huỷ — dùng hoàn tiền sau khi cấp.',
  order_not_refundable:
    'Chỉ đánh dấu hoàn tiền cho đơn đã cấp gói. Đơn chưa cấp thì tiền chưa vào sổ, xử lý bằng huỷ hoặc chờ.',
  invalid_reason: 'Thiếu lý do. Mọi lệnh tiền và lệnh khoá tài khoản đều phải có lý do để nhật ký đọc được.',
  payment_provider_unavailable:
    'PayOS không phản hồi nên CHƯA huỷ. Đơn vẫn đang chờ; thử lại sau một phút.',
  customer_not_found: 'Không có tài khoản khách này.',
```

- [ ] **Step 8: `audit/api.ts` — thêm loại việc vào gợi ý**

```ts
export const LOAI_VIEC = [
  'edit.approve',
  'edit.reject',
  'edits.bulk_approve',
  'edits.bulk_reject',
  'tenant.key_issue',
  'tenant.key_revoke',
  'tenant.key_restore',
  'tenant.quota_mode',
  'tenant.delete',
  'billing.command',
  'billing.unlock_acks',
  'admin.order.fulfil',
  'admin.order.confirm_manual',
  'admin.order.cancel',
  'admin.order.refund',
  'admin.customer.disable',
  'admin.customer.enable',
] as const;
```

- [ ] **Step 9: `features/lenh/form-ly-do.tsx`**

```tsx
import { Button } from '@mapslibvn/ui';
import { type FormEvent, useState } from 'react';

const O =
  'min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal';

export interface FormLyDoProps {
  /** Cũng là aria-label của form: hai form cùng ô "Lý do" trên một màn vẫn phân biệt được. */
  tieuDe: string;
  /** Nói hệ quả — cái gì sẽ xảy ra và cái gì KHÔNG xảy ra — trước khi người bấm gõ lý do. */
  moTa: string;
  nutGui: string;
  /** Viền đỏ + nút đỏ cho lệnh đáng dè chừng (vô hiệu hoá tài khoản); mặc định hổ phách. */
  nguyHiem?: boolean;
  onGui: (lyDo: string) => void;
  onThoi: () => void;
}

/**
 * Form một ô "Lý do" dùng chung cho huỷ đơn, đánh dấu hoàn tiền, vô hiệu hoá/kích hoạt lại tài
 * khoản. Tự nó KHÔNG gửi gì: cha nhận lý do rồi xếp lịch qua `useDelayedAction` (5 giây đổi ý).
 * Nút gửi khoá khi lý do rỗng — máy chủ vẫn từ chối 400 `invalid_reason`, đây là lớp tiện tay.
 */
export function FormLyDo({ tieuDe, moTa, nutGui, nguyHiem, onGui, onThoi }: FormLyDoProps) {
  const [lyDo, datLyDo] = useState('');
  const sach = lyDo.trim();
  const gui = (e: FormEvent) => {
    e.preventDefault();
    if (sach) onGui(sach);
  };
  return (
    <form
      aria-label={tieuDe}
      className={`space-y-3 rounded-[var(--radius-card)] border p-4 ${nguyHiem ? 'border-red-300' : 'border-amber-300'}`}
      onSubmit={gui}
    >
      <p className="text-sm font-bold">{tieuDe}</p>
      <p className="text-sm text-[var(--text-muted)]">{moTa}</p>
      <label className="block text-sm font-semibold">
        Lý do
        <input
          aria-label="Lý do"
          className={`${O} mt-1`}
          value={lyDo}
          onChange={(e) => datLyDo(e.target.value)}
          maxLength={500}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={!sach} {...(nguyHiem ? { variant: 'danger' as const } : {})}>
          {nutGui}
        </Button>
        <Button type="button" variant="secondary" onClick={onThoi}>
          Thôi
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 10: Chạy, xác nhận xanh**

Run: `pnpm exec vitest run apps/admin/src/layout apps/admin/src/routes.test.tsx apps/admin/src/features/lenh apps/admin/src/lib && pnpm --filter @mapslibvn/admin typecheck`
Expected: PASS; typecheck sạch.

- [ ] **Step 11: Commit**

```bash
git add apps/admin/src/lib/permissions.ts apps/admin/src/layout/sidebar-nav.tsx apps/admin/src/layout/sidebar-nav.test.tsx apps/admin/src/routes.tsx apps/admin/src/routes.test.tsx apps/admin/src/features/billing/error-vi.ts apps/admin/src/features/audit/api.ts apps/admin/src/features/lenh apps/admin/src/features/customers/page.tsx
git commit -m "feat(admin): nền pha 4 — quyền customers.read, mục Tài khoản khách hàng, route /customers, mã lỗi đơn/khách, loại việc audit, form lý do dùng chung

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Admin Đơn hàng — bộ lọc tenant/khoảng ngày; "Huỷ đơn", "Đánh dấu hoàn tiền"; ghi chú

**Files:**
- Modify: `apps/admin/src/features/orders/api.ts`, `hooks.ts`, `page.tsx`, `chi-tiet.tsx`
- Test: `apps/admin/src/features/orders/api.test.ts` (mới), `page.test.tsx`, `chi-tiet.test.tsx`

- [ ] **Step 1: Test đỏ — `orders/api.test.ts` (thuần, không jsdom)**

```ts
import { describe, expect, it } from 'vitest';
import { thamSoDon } from './api';

describe('thamSoDon', () => {
  it('chỉ đưa vào URL những bộ lọc có giá trị; limit mặc định 25', () => {
    expect(thamSoDon({}).toString()).toBe('limit=25');
    expect(
      thamSoDon({ status: 'pending', tenant: 't1', from: '2026-09-01', to: '2026-09-19', cursor: 'c|d', limit: 5 }).toString(),
    ).toBe('limit=5&status=pending&tenant=t1&from=2026-09-01&to=2026-09-19&cursor=c%7Cd');
  });

  it('chuỗi rỗng coi như không lọc', () => {
    expect(thamSoDon({ tenant: '', from: '' }).toString()).toBe('limit=25');
  });
});
```

- [ ] **Step 2: Test đỏ — `chi-tiet.test.tsx`**

Bọc `ve()` bằng `MemoryRouter` (chi tiết sẽ có `<Link>` sang Gói cước) — thêm `import { MemoryRouter } from 'react-router';` và:

```tsx
const ve = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DelayedActionProvider>
        <MemoryRouter>
          <ChiTietDonPanel id="d1" onClose={() => {}} />
        </MemoryRouter>
      </DelayedActionProvider>
    </QueryClientProvider>,
  );
```

Cho `don()` nhận `note`: đổi chữ ký `const don = (status: string, note: string | null = null) => ({ order: { …, note }, … })`. Sửa bài `đơn fulfilled: không có lệnh tiền nào` thành:

```tsx
  it('fulfilled: không cấp lại, không xác nhận tay; CÓ Đánh dấu hoàn tiền, KHÔNG có Huỷ đơn', async () => {
    stub(don('fulfilled'));
    ve();
    expect(await screen.findByText('FT1')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Thử cấp lại/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xác nhận đã nhận tiền/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Đánh dấu hoàn tiền' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
  });
```

Thêm các bài:

```tsx
  it('pending: có Huỷ đơn và Xác nhận tay; mở lệnh này thì lệnh kia đóng — chỉ MỘT ô Lý do', async () => {
    stub(don('pending'));
    ve();
    await userEvent.click(await screen.findByRole('button', { name: /Xác nhận đã nhận tiền/ }));
    expect(screen.getAllByLabelText('Lý do')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ đơn' }));
    expect(screen.getAllByLabelText('Lý do')).toHaveLength(1);
    expect(screen.getByRole('form', { name: /Huỷ đơn 100001/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Gửi xác nhận/ })).toBeNull();
  });

  it('paid_unfulfilled cũng có Đánh dấu hoàn tiền (cạnh Thử cấp lại), và form KHÔNG gợi ý Tạm dừng', async () => {
    stub(don('paid_unfulfilled'));
    ve();
    expect(await screen.findByRole('button', { name: /Thử cấp lại/ })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Đánh dấu hoàn tiền' }));
    expect(screen.queryByRole('link', { name: /Gói cước/ })).toBeNull();
  });

  it('form hoàn tiền nói rõ: không đụng sổ quota, thu hồi quyền dùng là lệnh Tạm dừng ở Gói cước', async () => {
    stub(don('fulfilled'));
    ve();
    await userEvent.click(await screen.findByRole('button', { name: 'Đánh dấu hoàn tiền' }));
    expect(screen.getByText(/không đụng sổ quota/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /Gói cước/ })).toHaveAttribute('href', '/billing?tenant=t');
  });

  it('refunded: không lệnh nào; hiện ghi chú admin', async () => {
    stub(don('refunded', 'Khách không dùng, đã chuyển trả'));
    ve();
    expect(await screen.findByText('Khách không dùng, đã chuyển trả')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Đánh dấu hoàn tiền' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Thử cấp lại/ })).toBeNull();
  });
```

- [ ] **Step 3: Test đỏ — `page.test.tsx`**

Thêm bài (giữ `ve()` cũ nhưng cho nó nhận đường dẫn):

```tsx
const ve = (duong = '/orders') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DelayedActionProvider>
        <MemoryRouter initialEntries={[duong]}>
          <OrdersPage />
        </MemoryRouter>
      </DelayedActionProvider>
    </QueryClientProvider>,
  );
```

```tsx
  it('bộ lọc ngày và tenant đi từ URL vào lời gọi API; chip tenant có nút bỏ lọc', async () => {
    const fetchMock = stubFetch();
    ve('/orders?tenant=t&from=2026-09-01&to=2026-09-19');
    expect(await screen.findByText('Công ty Thử')).toBeVisible();
    expect(screen.getByLabelText('Từ ngày')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Đến ngày')).toHaveValue('2026-09-19');
    expect(screen.getByRole('button', { name: /Bỏ lọc tenant/ })).toBeVisible();
    const goiDanhSach = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.includes('/v1/admin/orders?'));
    expect(goiDanhSach).toContain('tenant=t');
    expect(goiDanhSach).toContain('from=2026-09-01');
    expect(goiDanhSach).toContain('to=2026-09-19');
  });
```

`stubFetch` phải trả `fetchMock` (đổi `const stubFetch = () => { const m = vi.fn()…; vi.stubGlobal('fetch', m); return m; }`).

- [ ] **Step 4: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run apps/admin/src/features/orders`
Expected: FAIL — `thamSoDon` chưa có; không có nút "Huỷ đơn"/"Đánh dấu hoàn tiền"; không có ô "Từ ngày".

- [ ] **Step 5: `orders/api.ts` — bộ lọc và hai lệnh**

Thay `listOrders` bằng:

```ts
export interface BoLocDon {
  status?: TrangThaiDon | '';
  tenant?: string;
  /** YYYY-MM-DD (giờ VN) hoặc ISO — máy chủ hiểu cả hai. */
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/** Thuần, để test không cần fetch: chỉ tham số có giá trị mới vào URL, thứ tự ổn định. */
export function thamSoDon(f: BoLocDon): URLSearchParams {
  const p = new URLSearchParams({ limit: String(f.limit ?? 25) });
  for (const k of ['status', 'tenant', 'from', 'to', 'cursor'] as const) {
    const v = f[k];
    if (v) p.set(k, v);
  }
  return p;
}

export const listOrders = (f: BoLocDon): Promise<TrangDon> =>
  apiFetch<TrangDon>(`/v1/admin/orders?${thamSoDon(f).toString()}`);
```

Thêm cuối file:

```ts
export interface LenhCoLyDo {
  operationId: string;
  reason: string;
}

export const cancelOrder = (id: string, body: LenhCoLyDo) =>
  postJson<{ order: DonHangAdmin; moi: boolean }>(`/v1/admin/orders/${id}/cancel`, body);

export const refundOrder = (id: string, body: LenhCoLyDo) =>
  postJson<{ order: DonHangAdmin; moi: boolean }>(`/v1/admin/orders/${id}/refund`, body);
```

- [ ] **Step 6: `orders/hooks.ts`**

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelOrder,
  confirmManual,
  fulfilOrder,
  getOrder,
  getSummary,
  getUnmatched,
  type LenhCoLyDo,
  listOrders,
  refundOrder,
  type TrangThaiDon,
  type XacNhanTay,
} from './api';

export interface BoLocDanhSach {
  status: TrangThaiDon | '';
  tenant: string;
  from: string;
  to: string;
}

export const orderKeys = {
  list: (b: BoLocDanhSach) => ['orders', 'list', b.status, b.tenant, b.from, b.to] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  summary: () => ['orders', 'summary'] as const,
  unmatched: () => ['orders', 'unmatched'] as const,
  ganNhat: (tenantId: string) => ['orders', 'gan-nhat', tenantId] as const,
};

export function useOrderList(b: BoLocDanhSach) {
  return useInfiniteQuery({
    queryKey: orderKeys.list(b),
    queryFn: ({ pageParam }) =>
      listOrders({
        ...(b.status ? { status: b.status } : {}),
        ...(b.tenant ? { tenant: b.tenant } : {}),
        ...(b.from ? { from: b.from } : {}),
        ...(b.to ? { to: b.to } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor,
  });
}

export const useOrderDetail = (id: string | null) =>
  useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: () => getOrder(id as string),
    enabled: id !== null,
  });

/**
 * Cùng khoá cache với hai ô của Tổng quan (pha 4). `retry: false`: tài khoản ngoài
 * BILLING_ADMIN_EMAILS nhận 403 một lần là đủ, không thử ba lần. `enabled` để màn không có quyền
 * `orders.read` không gọi.
 */
export const useOrderSummary = (tuyChon: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: orderKeys.summary(),
    queryFn: getSummary,
    staleTime: 30_000,
    retry: false,
    enabled: tuyChon.enabled ?? true,
  });

export const useUnmatched = () =>
  useQuery({ queryKey: orderKeys.unmatched(), queryFn: getUnmatched, staleTime: 30_000 });

/** Năm đơn gần nhất của một tenant — chi tiết tenant và chi tiết khách hàng dùng chung. */
export const useDonGanNhat = (tenantId: string | null, tuyChon: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: orderKeys.ganNhat(tenantId ?? ''),
    queryFn: () => listOrders({ tenant: tenantId as string, limit: 5 }),
    enabled: tenantId !== null && (tuyChon.enabled ?? true),
    retry: false,
    staleTime: 30_000,
  });

function useInvalidateOrders() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: ['orders'] });
}

export function useFulfil() {
  const invalidate = useInvalidateOrders();
  return useMutation({ mutationFn: (id: string) => fulfilOrder(id), onSettled: invalidate });
}

export function useConfirmManual() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: XacNhanTay }) => confirmManual(id, body),
    onSettled: invalidate,
  });
}

export function useCancelOrder() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LenhCoLyDo }) => cancelOrder(id, body),
    onSettled: invalidate,
  });
}

export function useRefundOrder() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LenhCoLyDo }) => refundOrder(id, body),
    onSettled: invalidate,
  });
}
```

- [ ] **Step 7: `orders/page.tsx` — bộ lọc trong URL**

Thay phần đầu hàm và khối bộ lọc:

```tsx
export function OrdersPage() {
  const [q, datQ] = useSearchParams();
  const boLoc = {
    status: (q.get('status') ?? '') as TrangThaiDon | '',
    tenant: q.get('tenant') ?? '',
    from: q.get('from') ?? '',
    to: q.get('to') ?? '',
  };
  const id = q.get('id');
  const list = useOrderList(boLoc);
  const tomTat = useOrderSummary();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  // Tên tenant để gắn lên chip: lấy từ dòng đầu, vì URL chỉ mang id.
  const tenTenantLoc = items[0]?.tenantName ?? boLoc.tenant;

  const doi = (k: string, v: string | null) => {
    const m = new URLSearchParams(q);
    if (v) m.set(k, v);
    else m.delete(k);
    datQ(m);
  };
```

Khối bộ lọc (thay `<label className="block text-sm font-semibold">Trạng thái…</label>`):

```tsx
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm font-semibold">
          Trạng thái
          <select
            value={boLoc.status}
            onChange={(event) => doi('status', event.target.value || null)}
            className={`${O_INPUT} mt-1 block`}
          >
            <option value="">Tất cả</option>
            {TAT_CA_TRANG_THAI.map((s) => (
              <option key={s} value={s}>
                {NHAN_TRANG_THAI[s].nhan}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Từ ngày
          <input
            type="date"
            aria-label="Từ ngày"
            value={boLoc.from}
            onChange={(event) => doi('from', event.target.value || null)}
            className={`${O_INPUT} mt-1 block`}
          />
        </label>
        <label className="block text-sm font-semibold">
          Đến ngày
          <input
            type="date"
            aria-label="Đến ngày"
            value={boLoc.to}
            onChange={(event) => doi('to', event.target.value || null)}
            className={`${O_INPUT} mt-1 block`}
          />
        </label>
        {boLoc.tenant && (
          <span className="flex min-h-11 items-center gap-2 text-sm">
            <Badge tone="brand">Tenant: {tenTenantLoc}</Badge>
            <Button variant="secondary" onClick={() => doi('tenant', null)}>
              Bỏ lọc tenant
            </Button>
          </span>
        )}
      </div>
```

với hằng module `const O_INPUT = 'min-h-11 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal';`. Đổi `hint` của `EmptyState` thành `"Đổi bộ lọc trạng thái, ngày hoặc bỏ lọc tenant để xem đơn khác."`.

- [ ] **Step 8: `orders/chi-tiet.tsx` — một state `lenhMo`, hai lệnh mới, ghi chú**

Thêm hằng module (cạnh `O`): `const CO_THE_HOAN_TIEN = ['fulfilled', 'paid_unfulfilled', 'underpaid'];`

Thay `const [moForm, datMoForm] = useState(false);` bằng:

```tsx
  type Lenh = 'xac_nhan' | 'huy' | 'hoan_tien';
  // Cùng tập trạng thái mà `danhDauHoanTien` nhận; hằng module, không phải trong thân hàm.
  const [lenhMo, datLenhMo] = useState<Lenh | null>(null);
  const huy = useCancelOrder();
  const hoanTien = useRefundOrder();
```

Import thêm `Link` từ `react-router`, `FormLyDo` từ `@/features/lenh/form-ly-do`, `useCancelOrder`, `useRefundOrder` từ `./hooks`.

Hai hàm xếp lịch, đặt cạnh `guiXacNhan` (cùng luật: `operationId` sinh MỘT lần, `onClose()` ngay sau `schedule`):

```tsx
  const guiHuy = (reason: string) => {
    if (!d) return;
    const operationId = crypto.randomUUID().replace(/-/g, '');
    schedule({
      label: `Huỷ đơn ${d.orderCode}`,
      run: async () => {
        await huy.mutateAsync({ id, body: { operationId, reason } });
      },
    });
    onClose();
  };

  const guiHoanTien = (reason: string) => {
    if (!d) return;
    const operationId = crypto.randomUUID().replace(/-/g, '');
    schedule({
      label: `Đánh dấu hoàn tiền đơn ${d.orderCode}`,
      run: async () => {
        await hoanTien.mutateAsync({ id, body: { operationId, reason } });
      },
    });
    onClose();
  };
```

Trong `<dl>`, sau dòng `Cấp gói`, thêm:

```tsx
                {d.note && (
                  <>
                    <dt className="text-[var(--text-muted)]">Ghi chú admin</dt>
                    <dd>{d.note}</dd>
                  </>
                )}
```

Thay mọi `moForm`/`datMoForm(true|false)` của form xác nhận tay bằng `lenhMo === 'xac_nhan'` / `datLenhMo('xac_nhan')` / `datLenhMo(null)`; nút mở giữ điều kiện `['pending','underpaid','expired'].includes(d.status) && lenhMo !== 'xac_nhan'`.

Thêm sau khối form xác nhận tay:

```tsx
              {d.status === 'pending' && lenhMo !== 'huy' && (
                <Button block variant="secondary" onClick={() => datLenhMo('huy')}>
                  Huỷ đơn
                </Button>
              )}
              {lenhMo === 'huy' && (
                <FormLyDo
                  tieuDe={`Huỷ đơn ${d.orderCode}`}
                  moTa="Sẽ huỷ link thanh toán ở PayOS trước, rồi đánh dấu đơn đã huỷ. Nếu khách vẫn chuyển tiền sau đó, tiền vào vẫn được ghi nhận và cấp gói. Lệnh gửi sau 5 giây, huỷ được trong lúc đếm ngược."
                  nutGui="Huỷ đơn"
                  onGui={guiHuy}
                  onThoi={() => datLenhMo(null)}
                />
              )}

              {CO_THE_HOAN_TIEN.includes(d.status) && lenhMo !== 'hoan_tien' && (
                <Button block variant="secondary" onClick={() => datLenhMo('hoan_tien')}>
                  Đánh dấu hoàn tiền
                </Button>
              )}
              {lenhMo === 'hoan_tien' && (
                <div className="space-y-2">
                  <FormLyDo
                    tieuDe="Đánh dấu hoàn tiền"
                    moTa="Chỉ ghi nhận: tiền trả lại khách làm ngoài hệ thống (chuyển khoản lại). Lệnh này KHÔNG đụng sổ quota — gói đã cấp vẫn chạy."
                    nutGui="Đánh dấu đã hoàn tiền"
                    onGui={guiHoanTien}
                    onThoi={() => datLenhMo(null)}
                  />
                  {/* Gợi ý suspend chỉ có nghĩa khi gói ĐÃ vào sổ; đơn paid_unfulfilled/underpaid
                      thì chưa cấp gì nên không có quyền nào để thu hồi. */}
                  {d.status === 'fulfilled' && (
                    <p className="text-sm text-[var(--text-muted)]">
                      Cần thu hồi quyền dùng? Dùng lệnh Tạm dừng ở{' '}
                      <Link className="underline" to={`/billing?tenant=${d.tenantId}`}>
                        Gói cước
                      </Link>
                      .
                    </p>
                  )}
                </div>
              )}
```

Hiện lỗi lệnh (dưới cùng, trước `</div>` đóng `space-y-5`):

```tsx
              {(huy.isError || hoanTien.isError) && (
                <p className="text-sm text-red-700 dark:text-red-200">
                  {loiVi(huy.error ?? hoanTien.error).cau}
                </p>
              )}
```

- [ ] **Step 9: Chạy, xác nhận xanh**

Run: `pnpm exec vitest run apps/admin/src/features/orders && pnpm --filter @mapslibvn/admin typecheck && pnpm exec biome check apps/admin/src/features/orders`
Expected: PASS toàn bộ; typecheck và biome sạch.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/features/orders
git commit -m "feat(admin): màn Đơn hàng đầy đủ — lọc theo tenant và khoảng ngày trong URL, Huỷ đơn và Đánh dấu hoàn tiền qua đếm ngược 5 giây, một lệnh mở tại một thời điểm, ghi chú admin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Admin Khách hàng — danh sách, chi tiết, vô hiệu hoá / kích hoạt lại

**Files:**
- Create: `apps/admin/src/features/customers/api.ts`, `hooks.ts`, `hien-thi.ts` (+ `.test.ts`), `chi-tiet.tsx` (+ `.test.tsx`)
- Replace: `apps/admin/src/features/customers/page.tsx` (+ `page.test.tsx`)

- [ ] **Step 1: Test đỏ — `hien-thi.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { rutGonUA } from './hien-thi';

describe('rutGonUA', () => {
  it('nhận ra trình duyệt và hệ điều hành phổ biến', () => {
    expect(
      rutGonUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'),
    ).toBe('Safari · iPhone');
    expect(
      rutGonUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0'),
    ).toBe('Edge · Windows');
    expect(
      rutGonUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'),
    ).toBe('Chrome · Android');
    expect(
      rutGonUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'),
    ).toBe('Chrome · macOS');
  });

  it('không nhận ra thì trả 40 ký tự đầu; null thành "không rõ"', () => {
    expect(rutGonUA(null)).toBe('không rõ');
    expect(rutGonUA('curl/8.4.0')).toBe('curl/8.4.0');
    expect(rutGonUA('x'.repeat(60))).toBe(`${'x'.repeat(40)}…`);
  });
});
```

- [ ] **Step 2: Test đỏ — `page.test.tsx`**

```tsx
// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomersPage } from './page';

const khach = (them: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  email: 'khach@vidu.vn',
  name: 'Khách Thử',
  googleLinked: true,
  lastLoginAt: '2026-09-19T03:00:00Z',
  disabledAt: null,
  createdAt: '2026-09-01T03:00:00Z',
  tenant: { id: 't1', name: 'Công ty Thử', quotaMode: 'commercial' },
  ...them,
});

const ME = { email: 'phong@test.invalid', permissions: ['customers.read', 'orders.read'] };

function stubFetch(items: unknown[]) {
  const m = vi.fn(async (input: RequestInfo | URL) => {
    const duongDan = new URL(String(input), 'https://admin.test').pathname;
    const than =
      duongDan === '/v1/admin/me'
        ? ME
        : duongDan === '/v1/admin/orders'
          ? { items: [], nextCursor: null }
          : duongDan.startsWith('/v1/admin/customers/')
            ? { account: items[0], sessions: [] }
            : { items, nextCursor: null };
    return new Response(JSON.stringify(than), { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', m);
  return m;
}

afterEach(() => vi.unstubAllGlobals());

const ve = (duong = '/customers') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DelayedActionProvider>
        <MemoryRouter initialEntries={[duong]}>
          <CustomersPage />
        </MemoryRouter>
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

describe('CustomersPage', () => {
  it('danh sách: email, tenant, Google, trạng thái', async () => {
    stubFetch([khach(), khach({ id: 'a2', email: 'khoa@vidu.vn', disabledAt: '2026-09-18T00:00:00Z', tenant: null, googleLinked: false })]);
    ve();
    expect(await screen.findByText('khach@vidu.vn')).toBeVisible();
    expect(screen.getByText('Công ty Thử')).toBeVisible();
    expect(screen.getAllByText('Đang hoạt động').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Đã vô hiệu hoá').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Google').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Chưa có tổ chức').length).toBeGreaterThan(0);
  });

  it('ô tìm gửi q lên API; trống → trạng thái rỗng', async () => {
    const m = stubFetch([]);
    ve('/customers?q=vidu');
    expect(await screen.findByText('Không có tài khoản nào khớp')).toBeVisible();
    expect(screen.getByLabelText('Tìm theo email hoặc tên')).toHaveValue('vidu');
    expect(m.mock.calls.map(([u]) => String(u)).some((u) => u.includes('/v1/admin/customers?') && u.includes('q=vidu'))).toBe(true);
  });

  it('?id= trong URL mở ngăn chi tiết', async () => {
    stubFetch([khach()]);
    ve('/customers?id=00000000-0000-4000-8000-0000000000a1');
    expect(await screen.findByRole('dialog')).toBeVisible();
  });
});
```

- [ ] **Step 3: Test đỏ — `chi-tiet.test.tsx`**

```tsx
// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChiTietKhachPanel } from './chi-tiet';

const ID = '00000000-0000-4000-8000-0000000000a1';
const chiTiet = (them: Record<string, unknown> = {}) => ({
  account: {
    id: ID,
    email: 'khach@vidu.vn',
    name: 'Khách Thử',
    googleLinked: false,
    lastLoginAt: '2026-09-19T03:00:00Z',
    disabledAt: null,
    createdAt: '2026-09-01T03:00:00Z',
    tenant: { id: 't1', name: 'Công ty Thử', quotaMode: 'commercial' },
    ...them,
  },
  sessions: [
    { createdAt: '2026-09-19T02:00:00Z', lastSeenAt: '2026-09-19T03:00:00Z', expiresAt: '2026-10-19T03:00:00Z', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1' },
    { createdAt: '2026-09-10T02:00:00Z', lastSeenAt: '2026-09-18T03:00:00Z', expiresAt: '2026-10-18T03:00:00Z', userAgent: null },
  ],
});
const DON = {
  items: [
    {
      id: 'd1', orderCode: 100001, noiDungChuyenKhoan: 'MLV100001', kind: 'plan', tier: 'starter', months: 1,
      quotaGroup: null, packs: null, moTa: 'Starter 1 tháng', amountVnd: 650_000, amountUsdCents: 2_500,
      status: 'fulfilled', checkoutUrl: null, linkExpiresAt: null, paidAt: null, paidAmountVnd: 650_000,
      fulfilledAt: null, fulfilError: null, fulfilAttempts: 0, createdAt: '2026-09-19T02:00:00Z',
      updatedAt: '2026-09-19T02:00:00Z', tenantId: 't1', tenantName: 'Công ty Thử', accountId: ID,
      paymentLinkId: null, entitlementReceipt: null, note: null,
    },
  ],
  nextCursor: null,
};

function stub(body: unknown, quyen: string[] = ['customers.read', 'orders.read']) {
  const m = vi.fn(async (input: RequestInfo | URL) => {
    const duongDan = new URL(String(input), 'https://admin.test').pathname;
    const than = duongDan === '/v1/admin/me'
      ? { email: 'p@t', permissions: quyen }
      : duongDan === '/v1/admin/orders'
        ? DON
        : body;
    return new Response(JSON.stringify(than), { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', m);
  return m;
}

afterEach(() => vi.unstubAllGlobals());

const ve = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DelayedActionProvider>
        <MemoryRouter>
          <ChiTietKhachPanel id={ID} onClose={() => {}} />
        </MemoryRouter>
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

describe('ChiTietKhachPanel', () => {
  it('đang hoạt động: huy hiệu, phiên rút gọn, link tenant và đơn, nút Vô hiệu hoá; KHÔNG có Kích hoạt lại', async () => {
    stub(chiTiet());
    ve();
    expect(await screen.findByText('khach@vidu.vn')).toBeVisible();
    expect(screen.getByText('Đang hoạt động')).toBeVisible();
    expect(screen.getByText(/Phiên đang mở \(2\)/)).toBeVisible();
    expect(screen.getByText('Safari · iPhone')).toBeVisible();
    expect(screen.getByText('không rõ')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Công ty Thử' })).toHaveAttribute('href', '/tenants?id=t1');
    expect(screen.getByRole('link', { name: /Xem tất cả đơn/ })).toHaveAttribute('href', '/orders?tenant=t1');
    expect(await screen.findByText('Starter 1 tháng')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Vô hiệu hoá' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Kích hoạt lại' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/token_hash|ip_hash/);
  });

  it('đã vô hiệu hoá: huy hiệu đỏ và nút Kích hoạt lại', async () => {
    stub(chiTiet({ disabledAt: '2026-09-19T05:00:00Z' }));
    ve();
    expect(await screen.findByText('Đã vô hiệu hoá')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Kích hoạt lại' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Vô hiệu hoá' })).toBeNull();
  });

  it('không có quyền orders.read → không gọi /v1/admin/orders, không có mục Đơn gần nhất', async () => {
    const m = stub(chiTiet(), ['customers.read']);
    ve();
    expect(await screen.findByText('khach@vidu.vn')).toBeVisible();
    expect(screen.queryByText(/Đơn gần nhất/)).toBeNull();
    expect(m.mock.calls.map(([u]) => String(u)).some((u) => u.includes('/v1/admin/orders'))).toBe(false);
  });

  it('chưa có tổ chức → nói rõ, không link tenant', async () => {
    stub(chiTiet({ tenant: null }));
    ve();
    expect(await screen.findByText('Chưa tạo tổ chức')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Xem tất cả đơn/ })).toBeNull();
  });

  it('bấm Vô hiệu hoá mở form lý do; nút gửi nói rõ hệ quả xoá phiên', async () => {
    stub(chiTiet());
    ve();
    await userEvent.click(await screen.findByRole('button', { name: 'Vô hiệu hoá' }));
    expect(screen.getByRole('form', { name: /Vô hiệu hoá khach@vidu.vn/ })).toBeVisible();
    expect(screen.getByText(/xoá mọi phiên/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Vô hiệu hoá tài khoản' })).toBeDisabled();
  });
});
```

- [ ] **Step 4: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run apps/admin/src/features/customers`
Expected: FAIL — thiếu `hien-thi`, `chi-tiet`; page tạm không có danh sách.

- [ ] **Step 5: `customers/api.ts`**

```ts
import { apiFetch } from '@/lib/fetcher';

export interface TenantCuaKhach {
  id: string;
  name: string;
  quotaMode: 'legacy' | 'commercial';
}

export interface TaiKhoanKhach {
  id: string;
  email: string;
  name: string | null;
  googleLinked: boolean;
  lastLoginAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  tenant: TenantCuaKhach | null;
}

/** Máy chủ cố ý KHÔNG trả token_hash lẫn ip_hash; kiểu này không có chỗ cho chúng. */
export interface PhienKhach {
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

export interface TrangKhach {
  items: TaiKhoanKhach[];
  nextCursor: string | null;
}

export interface ChiTietKhach {
  account: TaiKhoanKhach;
  sessions: PhienKhach[];
}

export function listCustomers(f: { q?: string; cursor?: string }): Promise<TrangKhach> {
  const p = new URLSearchParams({ limit: '25' });
  if (f.q) p.set('q', f.q);
  if (f.cursor) p.set('cursor', f.cursor);
  return apiFetch<TrangKhach>(`/v1/admin/customers?${p.toString()}`);
}

export const getCustomer = (id: string) => apiFetch<ChiTietKhach>(`/v1/admin/customers/${id}`);

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export interface LenhTaiKhoan {
  operationId: string;
  reason: string;
}

export const disableCustomer = (id: string, body: LenhTaiKhoan) =>
  postJson<{ account: TaiKhoanKhach; moi: boolean; sessionsDeleted: number }>(
    `/v1/admin/customers/${id}/disable`,
    body,
  );

export const enableCustomer = (id: string, body: LenhTaiKhoan) =>
  postJson<{ account: TaiKhoanKhach; moi: boolean }>(`/v1/admin/customers/${id}/enable`, body);
```

- [ ] **Step 6: `customers/hooks.ts`**

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { disableCustomer, enableCustomer, getCustomer, type LenhTaiKhoan, listCustomers } from './api';

export const customerKeys = {
  list: (q: string) => ['customers', 'list', q] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
};

export function useCustomerList(q: string) {
  return useInfiniteQuery({
    queryKey: customerKeys.list(q),
    queryFn: ({ pageParam }) =>
      listCustomers({ ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor,
  });
}

export const useCustomerDetail = (id: string | null) =>
  useQuery({
    queryKey: customerKeys.detail(id ?? ''),
    queryFn: () => getCustomer(id as string),
    enabled: id !== null,
  });

function useInvalidateCustomers() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: ['customers'] });
}

export function useDisableCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LenhTaiKhoan }) => disableCustomer(id, body),
    onSettled: invalidate,
  });
}

export function useEnableCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LenhTaiKhoan }) => enableCustomer(id, body),
    onSettled: invalidate,
  });
}
```

- [ ] **Step 7: `customers/hien-thi.ts`**

```ts
/**
 * "Safari · iPhone" thay cho chuỗi User-Agent 120 ký tự: người vận hành cần biết khách đang dùng
 * gì để nhận ra phiên lạ, không cần bản gốc. Không nhận ra thì trả 40 ký tự đầu — không giấu.
 */
export function rutGonUA(ua: string | null): string {
  if (!ua) return 'không rõ';
  const trinhDuyet = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const heDieuHanh = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (trinhDuyet && heDieuHanh) return `${trinhDuyet} · ${heDieuHanh}`;
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}

export const gioNgay = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
```

- [ ] **Step 8: `customers/chi-tiet.tsx`**

```tsx
import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, Button, ErrorState, LoadingSkeleton, useDelayedAction } from '@mapslibvn/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { Link } from 'react-router';
import { loiVi } from '@/features/billing/error-vi';
import { FormLyDo } from '@/features/lenh/form-ly-do';
import { useDonGanNhat } from '@/features/orders/hooks';
import { NHAN_TRANG_THAI } from '@/features/orders/trang-thai';
import { can, useMe } from '@/lib/permissions';
import { gioNgay, rutGonUA } from './hien-thi';
import { useCustomerDetail, useDisableCustomer, useEnableCustomer } from './hooks';

interface Props {
  id: string | null;
  onClose: () => void;
}

/**
 * Ngăn chi tiết một tài khoản khách. Cùng khuôn với ngăn đơn hàng: Radix Dialog modal, lệnh ghi
 * đi qua toast đếm ngược 5 giây và ngăn đóng NGAY sau khi xếp lịch (toast nằm ngoài ngăn, để ngăn
 * mở thì nó bị aria-hidden). Đơn của khách chỉ tải khi có quyền `orders.read`: đường đó đứng sau
 * cổng billing, gọi mà không có quyền là một 403 vô ích.
 */
export function ChiTietKhachPanel({ id, onClose }: Props) {
  const { data: me } = useMe();
  const chiTiet = useCustomerDetail(id);
  const tk = chiTiet.data?.account;
  const xemDon = can(me, 'orders.read');
  const don = useDonGanNhat(tk?.tenant?.id ?? null, { enabled: xemDon });
  const voHieu = useDisableCustomer();
  const kichHoat = useEnableCustomer();
  const { schedule } = useDelayedAction();
  const [lenhMo, datLenhMo] = useState<'khoa' | 'mo' | null>(null);
  if (id === null) return null;

  const gui = (loai: 'khoa' | 'mo', reason: string) => {
    if (!tk) return;
    const operationId = crypto.randomUUID().replace(/-/g, '');
    schedule({
      label: loai === 'khoa' ? `Vô hiệu hoá ${tk.email}` : `Kích hoạt lại ${tk.email}`,
      run: async () => {
        const body = { operationId, reason };
        if (loai === 'khoa') await voHieu.mutateAsync({ id, body });
        else await kichHoat.mutateAsync({ id, body });
      },
    });
    onClose();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-[var(--bg)] p-5 text-[var(--text)] lg:w-[520px]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-bold break-all">
              {tk?.email ?? 'Tài khoản khách'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="secondary" aria-label="Đóng">
                ✕
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Chi tiết tài khoản khách hàng và các lệnh xử lý
          </Dialog.Description>

          {chiTiet.isPending && <LoadingSkeleton rows={4} />}
          {chiTiet.isError && (
            <ErrorState error={chiTiet.error} onRetry={() => void chiTiet.refetch()} />
          )}

          {tk && (
            <div className="mt-4 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {tk.disabledAt ? (
                  <Badge tone="danger">Đã vô hiệu hoá</Badge>
                ) : (
                  <Badge tone="success">Đang hoạt động</Badge>
                )}
                <Badge tone={tk.googleLinked ? 'brand' : 'neutral'}>
                  {tk.googleLinked ? 'Google đã liên kết' : 'Chỉ mã một lần'}
                </Badge>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-[var(--text-muted)]">Tên</dt>
                <dd>{tk.name ?? '—'}</dd>
                <dt className="text-[var(--text-muted)]">Tổ chức</dt>
                <dd>
                  {tk.tenant ? (
                    <Link className="underline" to={`/tenants?id=${tk.tenant.id}`}>
                      {tk.tenant.name}
                    </Link>
                  ) : (
                    'Chưa tạo tổ chức'
                  )}
                </dd>
                <dt className="text-[var(--text-muted)]">Đăng nhập gần nhất</dt>
                <dd>{gioNgay(tk.lastLoginAt)}</dd>
                <dt className="text-[var(--text-muted)]">Tạo</dt>
                <dd>{gioNgay(tk.createdAt)}</dd>
                {tk.disabledAt && (
                  <>
                    <dt className="text-[var(--text-muted)]">Vô hiệu hoá lúc</dt>
                    <dd>{gioNgay(tk.disabledAt)}</dd>
                  </>
                )}
              </dl>

              <section>
                <h3 className="text-sm font-bold">Phiên đang mở ({chiTiet.data?.sessions.length ?? 0})</h3>
                {chiTiet.data?.sessions.length === 0 && (
                  <p className="mt-1 text-sm text-[var(--text-muted)]">Không có phiên nào.</p>
                )}
                <ul className="mt-2 space-y-1 text-sm">
                  {chiTiet.data?.sessions.map((p, i) => (
                    <li key={`${p.createdAt}-${i}`} className="flex flex-wrap justify-between gap-2">
                      <span>{rutGonUA(p.userAgent)}</span>
                      <span className="text-[var(--text-muted)]">thấy lần cuối {gioNgay(p.lastSeenAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {xemDon && tk.tenant && (
                <section>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold">Đơn gần nhất</h3>
                    <Link className="ml-auto text-sm underline" to={`/orders?tenant=${tk.tenant.id}`}>
                      Xem tất cả đơn
                    </Link>
                  </div>
                  {don.isPending && <LoadingSkeleton rows={1} />}
                  {don.data && don.data.items.length === 0 && (
                    <p className="mt-1 text-sm text-[var(--text-muted)]">Chưa có đơn nào.</p>
                  )}
                  <ul className="mt-2 space-y-1 text-sm">
                    {don.data?.items.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2">
                        <Link className="font-semibold underline" to={`/orders?id=${d.id}`}>
                          {d.orderCode}
                        </Link>
                        <span>{d.moTa}</span>
                        <span>{dinhDangVnd(d.amountVnd)}</span>
                        <Badge tone={NHAN_TRANG_THAI[d.status].tone}>{NHAN_TRANG_THAI[d.status].nhan}</Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!tk.disabledAt && lenhMo !== 'khoa' && (
                <Button block variant="secondary" className="text-red-700 dark:text-red-300" onClick={() => datLenhMo('khoa')}>
                  Vô hiệu hoá
                </Button>
              )}
              {lenhMo === 'khoa' && (
                <FormLyDo
                  tieuDe={`Vô hiệu hoá ${tk.email}`}
                  moTa="Sẽ xoá mọi phiên đang mở ngay lập tức và chặn đăng nhập lại. Khoá API của tổ chức KHÔNG bị thu hồi — làm ở màn Tenant nếu cần. Lệnh gửi sau 5 giây, huỷ được trong lúc đếm ngược."
                  nutGui="Vô hiệu hoá tài khoản"
                  nguyHiem
                  onGui={(ly) => gui('khoa', ly)}
                  onThoi={() => datLenhMo(null)}
                />
              )}
              {tk.disabledAt && lenhMo !== 'mo' && (
                <Button block onClick={() => datLenhMo('mo')}>
                  Kích hoạt lại
                </Button>
              )}
              {lenhMo === 'mo' && (
                <FormLyDo
                  tieuDe={`Kích hoạt lại ${tk.email}`}
                  moTa="Khách đăng nhập lại được ngay. Phiên cũ đã xoá nên họ phải đăng nhập mới."
                  nutGui="Kích hoạt lại"
                  onGui={(ly) => gui('mo', ly)}
                  onThoi={() => datLenhMo(null)}
                />
              )}
              {(voHieu.isError || kichHoat.isError) && (
                <p className="text-sm text-red-700 dark:text-red-200">
                  {loiVi(voHieu.error ?? kichHoat.error).cau}
                </p>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 9: `customers/page.tsx` (thay bản tạm)**

```tsx
import { Badge, Button, EmptyState, ErrorState, LoadingSkeleton, RecordView } from '@mapslibvn/ui';
import { useSearchParams } from 'react-router';
import { ChiTietKhachPanel } from './chi-tiet';
import { gioNgay } from './hien-thi';
import { useCustomerList } from './hooks';

const TrangThai = ({ disabledAt }: { disabledAt: string | null }) =>
  disabledAt ? <Badge tone="danger">Đã vô hiệu hoá</Badge> : <Badge tone="success">Đang hoạt động</Badge>;

/**
 * Danh sách tài khoản khách. Ô tìm và tài khoản đang mở nằm trong URL (`?q=`, `?id=`): chi tiết
 * tenant và chi tiết đơn link thẳng tới đây, và tải lại trang không mất chỗ đang xem.
 */
export function CustomersPage() {
  const [q, datQ] = useSearchParams();
  const tim = q.get('q') ?? '';
  const id = q.get('id');
  const list = useCustomerList(tim);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const doi = (k: string, v: string | null) => {
    const m = new URLSearchParams(q);
    if (v) m.set(k, v);
    else m.delete(k);
    datQ(m);
  };

  return (
    <div className="space-y-4">
      <input
        value={tim}
        onChange={(event) => doi('q', event.target.value || null)}
        placeholder="Tìm theo email hoặc tên"
        aria-label="Tìm theo email hoặc tên"
        className="min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
      />

      {list.isPending && <LoadingSkeleton rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyState
          title="Không có tài khoản nào khớp"
          hint="Xoá ô tìm để xem tất cả. Tài khoản chỉ sinh ra khi khách tự đăng ký ở cổng khách hàng."
        />
      )}

      {items.length > 0 && (
        <RecordView
          items={items}
          rowKey={(k) => k.id}
          renderCard={(k) => (
            <button type="button" className="w-full text-left" onClick={() => doi('id', k.id)}>
              <span className="block break-all font-semibold">{k.email}</span>
              <span className="block text-sm">{k.tenant?.name ?? 'Chưa có tổ chức'}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <TrangThai disabledAt={k.disabledAt} />
                {k.googleLinked && <Badge tone="brand">Google</Badge>}
                <span className="text-[var(--text-muted)]">{gioNgay(k.lastLoginAt)}</span>
              </span>
            </button>
          )}
          columns={[
            {
              key: 'email',
              header: 'Email',
              render: (k) => (
                <button type="button" className="text-left" onClick={() => doi('id', k.id)}>
                  <span className="break-all font-semibold underline">{k.email}</span>
                  {k.name && <span className="block text-xs text-[var(--text-muted)]">{k.name}</span>}
                </button>
              ),
            },
            { key: 'tenant', header: 'Tổ chức', render: (k) => k.tenant?.name ?? 'Chưa có tổ chức' },
            { key: 'dangnhap', header: 'Đăng nhập gần nhất', render: (k) => gioNgay(k.lastLoginAt) },
            {
              key: 'google',
              header: 'Google',
              render: (k) => (k.googleLinked ? <Badge tone="brand">Google</Badge> : '—'),
            },
            { key: 'tt', header: 'Trạng thái', render: (k) => <TrangThai disabledAt={k.disabledAt} /> },
          ]}
        />
      )}

      {list.hasNextPage && (
        <Button variant="secondary" block disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {list.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
        </Button>
      )}

      <ChiTietKhachPanel id={id} onClose={() => doi('id', null)} />
    </div>
  );
}
```

- [ ] **Step 10: Chạy, xác nhận xanh**

Run: `pnpm exec vitest run apps/admin/src/features/customers apps/admin/src/routes.test.tsx && pnpm --filter @mapslibvn/admin typecheck && pnpm exec biome check apps/admin/src/features/customers`
Expected: PASS; typecheck và biome sạch.

- [ ] **Step 10b: Bốn việc dọn một dòng, gộp từ bản rà Task 6**

1. `apps/admin/src/lib/permissions.test.ts` — thêm bài giữ nhánh `Array.isArray`, hiện không gì bảo vệ nó:

```ts
  it('me hỏng (permissions không phải mảng) → false, không ném', () => {
    expect(can({ email: 'a@b.c', permissions: 'admin' } as unknown as Me, 'edits.read')).toBe(false);
  });
```

2. `apps/admin/src/features/audit/api.ts` — thêm `'tenant.delete'` vào `LOAI_VIEC` (API phát ra loại việc này thật, ở `admin-tenants.ts`, nhưng ô gợi ý đang thiếu).
3. `apps/admin/src/features/billing/error-vi.ts` — `customer_not_found` nói thêm vế đường dẫn sai: route trả mã này cả khi id không phải UUID, lúc đó tài khoản vẫn có thể tồn tại.
4. `apps/admin/src/features/lenh/form-ly-do.tsx` — bỏ `aria-label="Lý do"` trên ô nhập; `<label>` đã bọc `<input>` nên tên truy cập có sẵn, giữ hai nguồn tên là mời chúng lệch nhau. `aria-label` trên thẻ `<form>` thì GIỮ NGUYÊN.

Chạy lại `pnpm exec vitest run apps/admin/src` sau bốn việc này; commit kèm Task 8.

- [ ] **Step 11: Commit**

```bash
git add apps/admin/src/features/customers
git commit -m "feat(admin): màn Tài khoản khách hàng — tìm theo email/tên, chi tiết với phiên rút gọn và đơn gần nhất, vô hiệu hoá/kích hoạt lại qua đếm ngược 5 giây

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Chi tiết tenant hiện chủ tổ chức + 5 đơn gần nhất; danh sách tenant nhận `?id=`; Tổng quan thêm hai ô tiền

**Files:**
- Modify: `apps/admin/src/features/tenants/api.ts`, `detail.tsx` (+ `.test.tsx`), `page.tsx` (+ `.test.tsx`)
- Modify: `apps/admin/src/features/overview/page.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Test đỏ — `tenants/detail.test.tsx`**

Bọc cả `renderPanel` và `renderHarness` bằng `<MemoryRouter>` (import từ `react-router`) — chi tiết sắp có `<Link>`. Thêm `owner: null` vào `detailBody`. Thêm `describe` mới:

```tsx
describe('TenantDetailPanel — chủ tổ chức và đơn gần nhất (pha 4)', () => {
  const ME = { email: 'p@t', permissions: ['tenants.read', 'orders.read'] };
  const DON = {
    items: [
      {
        id: 'd1', orderCode: 100007, noiDungChuyenKhoan: 'MLV100007', kind: 'plan', tier: 'starter', months: 1,
        quotaGroup: null, packs: null, moTa: 'Starter 1 tháng', amountVnd: 650_000, amountUsdCents: 2_500,
        status: 'fulfilled', checkoutUrl: null, linkExpiresAt: null, paidAt: null, paidAmountVnd: 650_000,
        fulfilledAt: null, fulfilError: null, fulfilAttempts: 0, createdAt: '2026-09-19T02:00:00Z',
        updatedAt: '2026-09-19T02:00:00Z', tenantId: 't1', tenantName: 'Công ty Thử Nghiệm', accountId: 'a1',
        paymentLinkId: null, entitlementReceipt: null, note: null,
      },
    ],
    nextCursor: null,
  };
  const stubTheoDuong = (quyen: string[]) => {
    const m = vi.fn(async (input: RequestInfo | URL) => {
      const duongDan = new URL(String(input), 'https://admin.test').pathname;
      const than = duongDan === '/v1/admin/me'
        ? { ...ME, permissions: quyen }
        : duongDan === '/v1/admin/orders'
          ? DON
          : { ...detailBody, owner: { email: 'chu@vidu.vn', billingEmail: null, accountId: 'a1' } };
      return new Response(JSON.stringify(than), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', m);
    return m;
  };

  it('hiện email chủ tổ chức (link sang Khách hàng) và 5 đơn gần nhất khi có orders.read', async () => {
    stubTheoDuong(['tenants.read', 'orders.read']);
    renderPanel('t1');
    expect(await screen.findByRole('link', { name: 'chu@vidu.vn' })).toHaveAttribute('href', '/customers?id=a1');
    expect(await screen.findByText('Starter 1 tháng')).toBeVisible();
    expect(screen.getByRole('link', { name: /Xem tất cả đơn/ })).toHaveAttribute('href', '/orders?tenant=t1');
  });

  it('không có orders.read → không gọi /v1/admin/orders, không có mục đơn', async () => {
    const m = stubTheoDuong(['tenants.read']);
    renderPanel('t1');
    expect(await screen.findByText('chu@vidu.vn')).toBeVisible();
    expect(screen.queryByText(/Đơn gần nhất/)).toBeNull();
    expect(m.mock.calls.map(([u]) => String(u)).some((u) => u.includes('/v1/admin/orders'))).toBe(false);
  });

  it('tenant không có chủ (nội bộ) → "—"', async () => {
    stubFetch({ ...detailBody, owner: null });
    renderPanel('t1');
    expect(await screen.findByText('Công ty Thử Nghiệm')).toBeVisible();
    expect(screen.getByText('Chủ tổ chức').nextElementSibling).toHaveTextContent('—');
  });
});
```

`stubFetch` cũ trả `detailBody` cho MỌI url kể cả `/v1/admin/me` — `can()` đã chịu được (Task 6), nên các bài cũ vẫn xanh mà không cần sửa.

- [ ] **Step 2: Test đỏ — `tenants/page.test.tsx`**

Bọc `renderPage` bằng `<MemoryRouter initialEntries={[duong]}>` với `duong = '/tenants'` mặc định, và thêm bài:

```tsx
  it('?id= trong URL mở ngăn chi tiết ngay', async () => {
    stubFetch({ items: [tenant()], nextCursor: null, tenant: tenant(), keys: [], owner: null });
    renderPage('/tenants?id=00000000-0000-4000-8000-0000000000cc');
    expect(await screen.findByRole('dialog')).toBeVisible();
  });
```

- [ ] **Step 3: Test đỏ — `overview/page.test.tsx`**

Thêm `'orders.read'` vào `ME.permissions`, thêm vào bảng `than` trong `mo()`: `'/v1/admin/orders/summary': { choXuLy: 3, doanhThu30Ngay: 4_550_000, pendingQua1Gio: 0, khongKhop: 1 },`. Thêm bài:

`mo()` trong file này tự `render(<OverviewPage/>)` và KHÔNG trả về mock; các bài cũ đọc lời gọi qua `globalThis.fetch`. Giữ đúng khuôn đó:

```tsx
  it('có orders.read → hai ô Đơn chờ xử lý và Doanh thu 30 ngày, trỏ về màn Đơn hàng', async () => {
    mo();
    expect(await screen.findByRole('link', { name: /Đơn chờ xử lý/ })).toHaveAttribute(
      'href',
      '/orders?status=paid_unfulfilled',
    );
    expect(await screen.findByText('3')).toBeVisible();
    expect(await screen.findByText('4.550.000đ')).toBeVisible();
    expect(screen.getByRole('link', { name: /Doanh thu 30 ngày/ })).toHaveAttribute(
      'href',
      '/orders?status=fulfilled',
    );
  });

  it('không có orders.read → không gọi summary, không có hai ô đó', async () => {
    mo((url) =>
      url.includes('/v1/admin/me')
        ? new Response(JSON.stringify({ ...ME, permissions: ['edits.read'] }))
        : null,
    );
    expect(await screen.findByRole('link', { name: /Đóng góp chờ duyệt/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Đơn chờ xử lý/ })).toBeNull();
    const goi = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => String(c[0]),
    );
    expect(goi.some((u) => u.includes('/orders/summary'))).toBe(false);
  });
```

Bài cũ `bốn ô và năm việc gần nhất` dùng `findByText('7')` và `findByText('43')` — hai ô mới hiện `3` và `4.550.000đ`, không trùng, nên bài cũ vẫn xanh.

- [ ] **Step 4: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run apps/admin/src/features/tenants apps/admin/src/features/overview`
Expected: FAIL — không có link chủ tổ chức, không có "Đơn chờ xử lý", `?id=` không mở ngăn.

- [ ] **Step 5: `tenants/api.ts` — thêm `owner`**

```ts
export interface TenantDetail {
  tenant: Tenant;
  keys: ApiKey[];
  /** Chủ tổ chức (pha 4). null với tenant nội bộ hoặc tenant cũ chưa gắn tài khoản. */
  owner: { email: string; billingEmail: string | null; accountId: string | null } | null;
}
```

- [ ] **Step 6: `tenants/detail.tsx`**

Import thêm `Link` từ `react-router`, `dinhDangVnd` từ `@mapslibvn/catalog`, `useDonGanNhat` từ `@/features/orders/hooks`, `NHAN_TRANG_THAI` từ `@/features/orders/trang-thai`, `can, useMe` từ `@/lib/permissions`. Trong thân hàm sau `const detail = useTenantDetail(id);`:

```tsx
  const { data: me } = useMe();
  const xemDon = can(me, 'orders.read');
  const don = useDonGanNhat(id, { enabled: xemDon });
```

Sau khối `<p className="select-all break-all font-mono …">{detail.data.tenant.id}</p>` thêm:

```tsx
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-[var(--text-muted)]">Chủ tổ chức</dt>
                  <dd className="break-all">
                    {detail.data.owner ? (
                      detail.data.owner.accountId ? (
                        <Link className="underline" to={`/customers?id=${detail.data.owner.accountId}`}>
                          {detail.data.owner.email}
                        </Link>
                      ) : (
                        detail.data.owner.email
                      )
                    ) : (
                      '—'
                    )}
                  </dd>
                </dl>

                {xemDon && (
                  <section>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">Đơn gần nhất</h3>
                      <Link className="ml-auto text-sm underline" to={`/orders?tenant=${detail.data.tenant.id}`}>
                        Xem tất cả đơn
                      </Link>
                    </div>
                    {don.isPending && <LoadingSkeleton rows={1} />}
                    {don.isError && (
                      <p className="mt-1 text-sm text-[var(--text-muted)]">Không đọc được đơn của tenant này.</p>
                    )}
                    {don.data && don.data.items.length === 0 && (
                      <p className="mt-1 text-sm text-[var(--text-muted)]">Chưa có đơn nào.</p>
                    )}
                    <ul className="mt-2 space-y-1 text-sm">
                      {don.data?.items.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2">
                          <Link className="font-semibold underline" to={`/orders?id=${d.id}`}>
                            {d.orderCode}
                          </Link>
                          <span>{d.moTa}</span>
                          <span>{dinhDangVnd(d.amountVnd)}</span>
                          <Badge tone={NHAN_TRANG_THAI[d.status].tone}>{NHAN_TRANG_THAI[d.status].nhan}</Badge>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
```

- [ ] **Step 7: `tenants/page.tsx` — `?id=` mở ngăn**

Thay `const [openId, setOpenId] = useState<string | null>(null);` bằng:

```tsx
  // Chi tiết khách hàng link tới đây bằng `?id=`; chỉ đọc lúc dựng — sau đó state là của trang.
  const [params] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(params.get('id'));
```

Import `useSearchParams` từ `react-router`.

- [ ] **Step 8: `overview/page.tsx` — hai ô tiền**

Import `dinhDangVnd` từ `@mapslibvn/catalog` và `useOrderSummary` từ `@/features/orders/hooks`. Trong thân, sau `const viec = useVietGanNhat();`:

```tsx
  // Cùng khoá cache với đầu trang Đơn hàng (spec 13): mở Tổng quan rồi sang Đơn hàng không tốn
  // thêm truy vấn. Chỉ gọi khi có quyền — đường này đứng sau cổng billing.
  const xemDon = can(me, 'orders.read');
  const donHang = useOrderSummary({ enabled: xemDon });
```

Trong lưới ô, sau ô "Lượt bị chặn vì hạn mức":

```tsx
        {xemDon && (
          <O
            ten="Đơn chờ xử lý"
            den="/orders?status=paid_unfulfilled"
            dangTai={donHang.isPending}
            loi={donHang.isError}
            so={donHang.data?.choXuLy}
            phu="tiền vào chưa cấp + thiếu tiền"
          />
        )}
        {xemDon && (
          <O
            ten="Doanh thu 30 ngày"
            den="/orders?status=fulfilled"
            dangTai={donHang.isPending}
            loi={donHang.isError}
            so={donHang.data ? dinhDangVnd(donHang.data.doanhThu30Ngay) : undefined}
          />
        )}
```

- [ ] **Step 9: Chạy, xác nhận xanh**

Run: `pnpm exec vitest run apps/admin/src && pnpm --filter @mapslibvn/admin typecheck && pnpm exec biome check apps/admin`
Expected: PASS toàn bộ bộ admin; typecheck và biome sạch.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/features/tenants apps/admin/src/features/overview
git commit -m "feat(admin): chi tiết tenant hiện chủ tổ chức và 5 đơn gần nhất, danh sách tenant nhận ?id=; Tổng quan thêm ô Đơn chờ xử lý và Doanh thu 30 ngày cùng khoá cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9b: Gom hai chỗ trùng của giao diện admin

Sinh ra từ ba bản rà (Task 7, 8, 9). **Chạy sau khi Task 10 đã chạy e2e xong**, để không làm bẩn cây lúc harness dựng bản build.

**Files:**
- Create: `apps/admin/src/features/orders/don-gan-nhat.tsx` (+ `.test.tsx`), `apps/admin/src/features/lenh/dung-lenh-hoan-lai.ts` (+ `.test.ts`)
- Modify: `apps/admin/src/features/tenants/detail.tsx`, `apps/admin/src/features/customers/chi-tiet.tsx`, `apps/admin/src/features/orders/chi-tiet.tsx`

- [ ] **Step 1: `DanhSachDonGanNhat` — một bản duy nhất**

Chi tiết tenant và chi tiết khách hàng đang dựng cùng một danh sách "Đơn gần nhất" bằng hai đoạn mã ~25 dòng gần trùng, **và chúng đã lệch nhau ngay lần sinh thứ hai**: một bên `font-bold`, bên kia `font-semibold`; một bên có nhánh `isError`, bên kia không. Tách thành một component nhận `tenantId` và `enabled`, đặt trong `features/orders/` vì nó thuộc miền đơn hàng, rồi hai màn cùng dùng. Giữ nhánh lỗi (bản đầy đủ hơn trong hai bản). Bài kiểm: rỗng, có đơn, lỗi, và không gọi mạng khi `enabled` sai.

- [ ] **Step 2: `dungLenhHoanLai()` — một chỗ giữ bất biến "operationId sinh lúc bấm"**

Bốn chỗ đang lặp cùng một đoạn: `crypto.randomUUID()` → `schedule({ label, run })` → `onClose()`. Đó là nơi sống của một bất biến quan trọng, mà hiện mỗi bản tự giữ lấy. Gói thành một hook nhận `{ label, onClose }` và trả hàm chạy lệnh, để **một** bài kiểm khoá được cả bốn chỗ gọi. Không gói phần thân form.

- [ ] **Step 3: Cổng và commit**

```bash
pnpm exec vitest run apps/admin/src
pnpm --filter @mapslibvn/admin typecheck
pnpm exec biome check apps/admin/src
```

```bash
git commit apps/admin/src -m "refactor(admin): một bản danh sách Đơn gần nhất dùng chung, một hook giữ bất biến operationId sinh lúc bấm

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: e2e Playwright — khách hàng và huỷ đơn qua giao diện thật

**Files:**
- Create: `apps/admin/e2e/khach-hang.spec.ts`
- Modify: `apps/admin/e2e/don-hang.spec.ts`

- [ ] **Step 1: `apps/admin/e2e/khach-hang.spec.ts`**

```ts
import { type APIRequestContext, expect, test } from '@playwright/test';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const API = 'http://127.0.0.1:8799';
const ACCESS_JWT = signAccessJwt({ email: 'phong@e2e.local' });
const ADMIN = { 'Cf-Access-Jwt-Assertion': ACCESS_JWT, 'Sec-Fetch-Site': 'same-origin' };

/** Một khách mới có tổ chức, đăng nhập bằng mã một lần qua API thuần. */
async function taoKhach(request: APIRequestContext) {
  const email = `khach-e2e-${Date.now()}@vidu.vn`;
  const xin = await request.post(`${API}/v1/console/auth/otp/request`, {
    headers: { 'Sec-Fetch-Site': 'same-origin' },
    data: { email, turnstileToken: '' },
  });
  const ma = xin.headers()['x-debug-otp'];
  const xac = await request.post(`${API}/v1/console/auth/otp/verify`, {
    headers: { 'Sec-Fetch-Site': 'same-origin' },
    data: { email, code: ma },
  });
  const cookie = (xac.headers()['set-cookie'] ?? '').split(';')[0] as string;
  const h = { cookie, 'Sec-Fetch-Site': 'same-origin' };
  const { tenant } = await (
    await request.post(`${API}/v1/console/tenant`, { headers: h, data: { name: 'Công ty Khách E2E' } })
  ).json();
  const ds = await (
    await request.get(`${API}/v1/admin/customers?q=${encodeURIComponent(email)}`, { headers: ADMIN })
  ).json();
  return { email, cookie: h, tenantId: tenant.id as string, accountId: ds.items[0].id as string };
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': ACCESS_JWT });
});

test('tìm khách theo email → chi tiết có phiên và tổ chức → vô hiệu hoá qua đếm ngược → khách mất phiên → huy hiệu đỏ', async ({
  page,
  request,
}) => {
  const k = await taoKhach(request);

  await page.goto('/admin/customers');
  await page.getByLabel('Tìm theo email hoặc tên').fill(k.email);
  await page.getByRole('button', { name: k.email }).click();
  const ngan = page.getByRole('dialog');
  await expect(ngan.getByText('Đang hoạt động')).toBeVisible();
  await expect(ngan.getByText(/Phiên đang mở \(1\)/)).toBeVisible();
  await expect(ngan.getByRole('link', { name: 'Công ty Khách E2E' })).toBeVisible();

  await ngan.getByRole('button', { name: 'Vô hiệu hoá' }).click();
  await ngan.getByLabel('Lý do').fill('E2E: kiểm thử vô hiệu hoá');
  await ngan.getByRole('button', { name: 'Vô hiệu hoá tài khoản' }).click();
  // Ngăn đóng ngay, toast đếm ngược 5 giây rồi mới gửi — đúng cơ chế delayed-action.
  await expect(page.getByRole('status')).toContainText(/Vô hiệu hoá/);
  await page.waitForTimeout(6500);

  // Khách mất phiên trong một request (tiêu chí 20.11).
  const me = await request.get(`${API}/v1/console/me`, { headers: k.cookie });
  expect(me.status()).toBe(401);

  await page.goto(`/admin/customers?id=${k.accountId}`);
  await expect(page.getByRole('dialog').getByText('Đã vô hiệu hoá')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Kích hoạt lại' })).toBeVisible();
});

test('chi tiết tenant hiện chủ tổ chức và link sang màn Khách hàng', async ({ page, request }) => {
  const k = await taoKhach(request);
  await page.goto(`/admin/tenants?id=${k.tenantId}`);
  const ngan = page.getByRole('dialog');
  await expect(ngan.getByRole('link', { name: k.email })).toHaveAttribute('href', `/admin/customers?id=${k.accountId}`);
  await ngan.getByRole('link', { name: k.email }).click();
  await expect(page.getByRole('dialog').getByText(k.email)).toBeVisible();
});
```

Lưu ý: `basename: '/admin'` của router làm `href` thật là `/admin/customers?id=…` — bài e2e khẳng định đúng chuỗi đó, khác với test jsdom (không basename).

- [ ] **Step 2: Thêm bài huỷ đơn vào `apps/admin/e2e/don-hang.spec.ts`**

```ts
test('admin huỷ đơn pending qua đếm ngược → Đã huỷ, ghi chú hiện trong ngăn', async ({ page, request }) => {
  const don = await taoDonKhach(request);

  await page.goto(`/admin/orders?id=${don.id}`);
  const ngan = page.getByRole('dialog');
  await ngan.getByRole('button', { name: 'Huỷ đơn' }).click();
  await ngan.getByLabel('Lý do').fill('E2E: khách đổi ý');
  await ngan.getByRole('form', { name: /Huỷ đơn/ }).getByRole('button', { name: 'Huỷ đơn' }).click();
  await page.waitForTimeout(6500);

  await page.goto(`/admin/orders?id=${don.id}`);
  await expect(page.getByRole('dialog').getByText('Đã huỷ')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('E2E: khách đổi ý')).toBeVisible();
  // Lọc theo trạng thái Đã huỷ vẫn thấy đơn — bộ lọc URL hoạt động.
  await page.goto('/admin/orders?status=cancelled');
  await expect(page.getByRole('button', { name: String(don.orderCode) })).toBeVisible();
});
```

- [ ] **Step 3: Chạy e2e admin**

Run: `pnpm test:admin-e2e`
Expected: mọi bài xanh (18 cũ + 3 mới). Harness `--serve` tự dựng; nếu đã có harness đang chạy từ Task 5 thì Playwright tái dùng.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/e2e/khach-hang.spec.ts apps/admin/e2e/don-hang.spec.ts
git commit -m "test(e2e): admin vô hiệu hoá khách qua đếm ngược và khách mất phiên ngay; chi tiết tenant link sang khách; huỷ đơn pending qua giao diện

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Bốn tầng cổng, tài liệu, chứng cứ, đóng pha

**Files:**
- Create: `docs/evidence/commerce/2026-09-20-pha-4-admin.md`
- Modify: `README.md` (mục Thanh toán), `docs/DEVLOG.md` (mục 26), plan này (biển trạng thái)

- [ ] **Step 1: Chạy ĐÚNG những lệnh CI chạy**

```bash
pnpm lint
node scripts/notices-sync.mjs --check
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:api-db
pnpm test:admin-e2e
pnpm test:console-e2e
pnpm exec vitest run --config vitest.db.config.ts db/commerce-grant.dbtest.mjs db/customer-admin-grant.dbtest.mjs
```

Ghi từng con số (số file/test, thời gian) vào chứng cứ. **Không** chạy tay `db/schema.dbtest.mjs` rồi đọc `test:db` sau đó.

- [ ] **Step 2: README — mục "Thanh toán (PayOS)", thay gạch đầu dòng "Admin"**

```markdown
- Admin: `/admin/orders` — bốn ô đối soát, lọc theo trạng thái/tenant/khoảng ngày (giờ VN), "Thử cấp
  lại", "Xác nhận đã nhận tiền (tay)", "Huỷ đơn" (huỷ link PayOS trước, đánh dấu sau) và "Đánh dấu
  hoàn tiền" (chỉ ghi nhận, không đụng sổ quota — thu hồi quyền dùng là lệnh Tạm dừng ở Gói cước).
  `/admin/customers` — tài khoản khách: tìm theo email, phiên đang mở, tổ chức, vô hiệu hoá (xoá mọi
  phiên ngay) và kích hoạt lại. Mọi lệnh đi qua đếm ngược 5 giây và ghi lý do vào nhật ký.
```

- [ ] **Step 3: DEVLOG — mục 26**

Viết `## 26. 20/09/2026 — Thương mại tự phục vụ pha 4: admin đối soát từng đơn, từng khách` theo giọng các mục trước: điều gì đã làm, **quyết định đáng nhớ** (huỷ đơn chờ PayOS xác nhận rồi mới đánh dấu; hoàn tiền không đụng sổ; vô hiệu hoá xoá phiên trong transaction; đơn của khách nằm sau cổng billing nên giao diện chỉ gọi khi có `orders.read`; ngày lọc hiểu theo giờ VN), **bẫy gặp trong lúc làm** (điền thật lúc chạy: test không bọc Router, stub fetch trả cùng thân, hai ô "Lý do"…), con số cổng, và câu "Tiếp theo" (việc còn nợ pha 1: Lighthouse + Search Console; hai chỗ mỏng pha 3).

- [ ] **Step 4: Chứng cứ `docs/evidence/commerce/2026-09-20-pha-4-admin.md`**

Cấu trúc như pha 3: `## 1. Cổng ở máy — số thật` (bảng lệnh → kết quả), `## 2. Lời hứa của pha, chứng minh bằng itest và e2e` (liệt kê từng bài và tiêu chí spec nó đóng: 20.1, 20.10, 20.11), `## 3. Quyền database đã kiểm bằng role thật` (hai file grant), `## 4. Bất biến và nơi chứng minh` (sáu bất biến ở đầu plan → test nào), `## 5. Lệch spec có chủ ý` (mục sidebar tên "Tài khoản khách hàng"; đơn của khách lấy qua `/v1/admin/orders?tenant=` thay vì nhúng vào `/customers/:id` để giữ cổng billing; bộ lọc ngày theo +07:00; **đánh dấu hoàn tiền nhận cả `paid_unfulfilled` và `underpaid`** chứ không chỉ `fulfilled` như hình 5.3 — nếu không, đơn tiền-vào-gói-hỏng đã hoàn tiền kẹt vĩnh viễn trong ô "Đơn chờ xử lý" và cron vẫn thử cấp; `paid` cố ý đứng ngoài), `## 6. Điều chưa làm, cố ý` (không email cho khách khi huỷ/hoàn; không thu hồi khoá API khi vô hiệu hoá tài khoản; không xoá tài khoản). **Ghi kèm danh sách nợ kỹ thuật do các bản rà chất lượng nêu ra và pha này cố ý không làm** — mỗi món một dòng, kèm điều kiện lôi ra lại:
- `admin-db.ts`: ô tìm `q` không escape `%`/`_` và `ILIKE '%…%'` luôn quét toàn bảng `customer_account`; cần index nên phải có migration, mà pha này cố ý không có. Lôi ra khi số tài khoản vượt vài nghìn.
- Ranh giới `console/db.ts` (theo phiên) ↔ `console/admin-db.ts` (không theo phiên) hiện chỉ giữ bằng chú thích; một luật `noRestrictedImports` sẽ chắc hơn.
- `db/*.dbtest.mjs` chép tay câu SQL của mã thật, nên chúng bảo vệ **quyền** chứ không bảo vệ **văn bản câu lệnh**; hai bản có thể trôi khỏi nhau mà không ai biết.
- `phienCuaTaiKhoan` cắt ở 20 phiên mà không báo cho giao diện biết là còn nữa.
- `apps/admin/src/features/orders/chi-tiet.tsx` đã 338 dòng và giữ ba luồng lệnh; chỗ tách tự nhiên là form xác nhận tay và khối dòng thời gian tiền vào.
- `apps/admin/src/features/billing/error-vi.ts` giờ chứa cả mã lỗi đơn hàng và tài khoản khách, tên thư mục `billing/` không còn đúng phạm vi; nên đổi về `lib/ma-loi-vi.ts` ở một lần dọn sau.
- Phản hồi lỗi của toàn bộ nhóm admin không gắn `cache-control`; đây là hành vi chung có sẵn, không phải hồi quy của pha này.
- **Chỗ mỏng cố ý, cần PHONG xác nhận khi gặp thật:** nhánh "huỷ một link PayOS đã huỷ rồi thì coi là thành công" nhận diện bằng chuỗi tiếng Việt trong `desc` mà PayOS trả về, và **chuỗi thật chưa ai thấy** — nó được đoán theo văn phong các thông điệp PayOS đã biết. Nếu PayOS dùng câu khác, lệnh huỷ lần hai lại rơi về 503 và đơn kẹt `pending` với link đã chết. Lôi ra lại ngay lần đầu tiên một admin bấm huỷ hai lần trên production: đọc `desc` thật trong log rồi sửa nhánh cho khớp., `## 7. Việc tay của PHONG` (không có migration, không có secret mới — chỉ cần Deploy API chạy sau merge; nghiệm thu trên production: mở `/admin/customers`, tìm email của chính PHONG, mở `/admin/orders?status=fulfilled` thấy đơn 100002/100003 với owner).

- [ ] **Step 5: Biển trạng thái trên plan này**

Thêm ngay dưới dòng `> **For agentic workers**` ở đầu file:

```markdown
> **TRẠNG THÁI <ngày> — PLAN ĐÃ THỰC THI XONG.** Các ô `- [ ]` bên dưới **không được tick trong lúc
> chạy** — đừng đọc chúng là "chưa làm". Bằng chứng là commit trên `feat/thuong-mai-pha-4` và hồ sơ
> `docs/evidence/commerce/2026-09-20-pha-4-admin.md`.
```

- [ ] **Step 6: Commit tài liệu, merge vào main — DỪNG trước push**

```bash
git add README.md docs/DEVLOG.md docs/evidence/commerce/2026-09-20-pha-4-admin.md docs/superpowers/plans/2026-09-20-thuong-mai-pha-4-admin.md
git commit -m "docs: chứng cứ pha 4, DEVLOG mục 26, README mục admin đơn hàng/khách hàng

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git checkout main && git merge --no-ff feat/thuong-mai-pha-4 -m "merge: thương mại tự phục vụ pha 4 — admin khách hàng, đơn hàng & giao dịch đầy đủ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Không push.** Báo PHONG: push lên `origin/main` sẽ kích `Deploy API` (không migration, không secret mới → an toàn), và hỏi PHONG có duyệt push không. Sau push: theo dõi 4 workflow, rồi kiểm production `GET /v1/admin/me` (qua Access) có `customers.read`, `/admin/customers` 200.

---

## Self-review

**Spec coverage (mục 13, 14, 20):**

| Yêu cầu spec | Task |
|---|---|
| `/admin/customers`: danh sách email, tên, tenant, đăng nhập gần nhất, Google, trạng thái; tìm theo email; con trỏ `created_at` | 3, 4, 8 |
| Chi tiết khách: phiên (số lượng, thiết bị, lần thấy cuối), đơn hàng, Vô hiệu hoá/Kích hoạt lại qua delayed-action, vô hiệu hoá xoá mọi phiên; link sang tenant | 3, 4, 8 |
| `/admin/orders`: lọc trạng thái, tenant, khoảng ngày | 1, 2, 7 |
| Bốn ô đầu trang | đã có pha 3 |
| Chi tiết đơn: mọi trường, dòng thời gian, biên lai, lỗi cấp gói | đã có pha 3; `note` thêm ở 7 |
| Lệnh Thử cấp lại, Xác nhận tay | đã có pha 3 |
| Lệnh Huỷ đơn (`pending`, gọi PayOS cancel rồi `cancelled`) | 2, 7, 10 |
| Lệnh Đánh dấu hoàn tiền (→ `refunded`, không đụng sổ, gợi ý suspend) — **mở rộng có chủ đích:** nhận cả `paid_unfulfilled` và `underpaid`, xem lý do ở `danhDauHoanTien` | 2, 7 |
| Mọi lệnh tiền sau `requireBillingAccess()`, `operationId` từ client, audit `admin.order.*` | 2 (mount không đổi), 5 |
| Danh sách khách chỉ cần `requireAccess()` | 4 |
| Chi tiết tenant hiện owner + 5 đơn gần nhất | 1, 4, 9 |
| Tổng quan hai ô cùng khoá cache | 9 |
| Quyền `customers.read` (+ `orders.read/write` có sẵn) trong `ALL_PERMISSIONS`, màn gọi `can()` | 2, 6, 8, 9 |
| API `GET /customers`, `/customers/:id`, `POST disable/enable`; `POST orders/:id/cancel`, `/refund` | 2, 4 |
| `cache-control: private, no-store` | 2, 4 (test khẳng định ở 4) |
| Tiêu chí 20.1 (bốn tầng cổng xanh) | 11 |
| Tiêu chí 20.11 (vô hiệu hoá có hiệu lực trong một request) | 5, 10 |
| Mỗi câu SQL mới chạy dưới role `api` thật | 1, 3 |

**Không có trong spec, cố ý không làm:** email cho khách khi huỷ/hoàn tiền; thu hồi khoá API khi vô hiệu hoá tài khoản; xoá tài khoản; lọc đơn theo tài khoản (lọc theo tenant đủ vì một tài khoản = một tenant owner ở giai đoạn này).

**Type consistency đã rà:** `BoLocDonAdmin` (Task 1) ↔ lời gọi ở Task 2; `TaiKhoanAdmin`/`taiKhoanJson` (Task 3–4) ↔ `TaiKhoanKhach` (Task 8: `googleLinked`, `disabledAt`, `tenant.quotaMode`); `LenhCoLyDo` (Task 7) và `LenhTaiKhoan` (Task 8) cùng hình `{ operationId, reason }` như route đọc; `useDonGanNhat(tenantId, { enabled })` dùng ở Task 8 và 9 đúng chữ ký Task 7; `TenantDetail.owner.accountId: string | null` khớp `ChuTenant.accountId` Task 1; `FormLyDo` props `tieuDe/moTa/nutGui/nguyHiem/onGui/onThoi` dùng nhất quán ở Task 7, 8.
