# Trang Admin MapsLibVN — Pha 2 (Tenant & khoá API)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cấp, xem và thu hồi khoá API ngay trên trang Admin, để việc thường ngày không còn phải chạy `pnpm key:issue` và `psql` trên máy chủ.

**Architecture:** Ba endpoint mới (`GET /v1/admin/tenants`, `GET /v1/admin/tenants/:id`, `POST /v1/admin/tenants/:id/keys`) nằm trong `apps/api/src/routes/admin-tenants.ts`, mount **vào chính app `admin`** nên tự hưởng middleware chống CSRF + `requireAccess()` đã có. Thu hồi/khôi phục khoá và đổi `quota_mode` **dùng lại** nhóm route billing đã chạy từ trước (chúng ghi Durable Object quota và Postgres theo đúng thứ tự fail-closed). Giao diện thêm một mảng `apps/admin/src/features/tenants/*` theo đúng khuôn của mảng `edits` ở pha 1: danh sách `RecordView` (thẻ dưới 1024px, bảng từ 1024px), ngăn chi tiết bằng Radix Dialog, thao tác khó đảo ngược đi qua toast đếm ngược 5 giây.

**Tech Stack:** Hono + postgres.js (Hyperdrive), PostgreSQL, React 19 + TanStack Query v5 + React Router v7 + Radix Dialog + Tailwind v4, vitest (3 tầng: unit Workers / itest DB thật / dbtest quyền), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-trang-admin-react-design.md` (mục 11.3, mục 12, mục 13, mục 17 — hàng "Pha 2")

**Plan trước:** `docs/superpowers/plans/2026-09-16-trang-admin-pha-0-1.md` (pha 0 và 1 đã deploy production 16/09/2026)

---

## Ghi chú bắt buộc đọc trước khi bắt đầu

1. **Không bao giờ bind mảng JS rồi cast `::text[]` trong `apps/api`.** Bản `postgres/cf` mà Workers dùng nối mảng thành `"a,b"` nên Postgres ném `malformed array literal` — **trên production**, trong khi unit test vẫn xanh vì `fake-sql.ts` không chạy SQL thật. Idiom đúng là `textArray(sql, values)` trong `apps/api/src/geocode.ts` (đi qua JSON). Task 6 chèn ba cột mảng (`allowed_origins`, `allowed_bundle_ids`, `scopes`) — đây là chỗ dễ vỡ nhất của cả pha này.

2. **Chiều ngược lại cũng vậy: `text[]` đọc ra có thể là chuỗi `{a,b}`** vì Hyperdrive chạy `fetch_types: false`. Dùng `normalizeTextArray()` đã export sẵn từ `apps/api/src/auth.ts`, đừng tự parse.

3. **Role `api` hiện KHÔNG có quyền `INSERT` trên `api_key`.** `0005` cấp `SELECT`, `0016` thêm `UPDATE (active, revoked_at)`, `0017` thì quên dòng `GRANT INSERT ON api_key` mà spec có nhắc. Không có Task 1 thì route cấp khoá rơi vào catch chung và trả `upstream_unavailable` **chỉ trên máy chủ thật** — đúng sự cố thu hồi khoá 15/09/2026.

4. **`pnpm test:api-db` KHÔNG bắt được lỗi thiếu GRANT**: harness cho wrangler nối DB bằng `POSTGRES_USER` của `.env` (role chủ sở hữu), không phải role `api`. Bài kiểm quyền duy nhất nằm ở `db/schema.dbtest.mjs`, chạy bằng `pnpm test:db`.

5. **`pnpm test:db` trên máy dev sẽ đỏ ở `pipelines/poi/tests/pipeline-fixture.dbtest.mjs`** vì máy thiếu `tippecanoe` — hiện tượng đã biết, không phải lỗi do plan này. File phải xanh là `db/schema.dbtest.mjs`. Đừng chạy vitest chọn lọc một file dbtest (đã có lần bỏ sót và lọt lỗi) — chạy `pnpm test:db` đầy đủ rồi đọc kỹ file nào đỏ.

6. **Thứ tự triển khai bắt buộc: migration → kiểm `/healthz/db` thấy `schema_migration` sang `0018` → mới deploy Worker.** Deploy ngược lại đã từng làm chết API nhiều giờ.

7. **Thu hồi/khôi phục khoá và đổi `quota_mode` đứng sau `requireBillingAccess()`**, tức email người đăng nhập phải nằm trong `BILLING_ADMIN_EMAILS`. Spec mục 12 chốt giữ nguyên lớp này, và tiêu chí nghiệm thu số 3 cấm làm nó yếu đi. Hệ quả thực tế: harness itest/e2e phải được truyền var đó (Task 8), và trước khi làm giao diện phải xác nhận email thật của PHONG có trong danh sách production (Task 0).

8. **Khoá dạng rõ chỉ tồn tại trong đúng một phản hồi HTTP.** Không ghi vào `admin_audit` (spec mục 10: `detail` chỉ chứa `key_hash`), không `console.log`, không lưu vào query cache, không đưa vào URL.

9. **`tsconfig.base.json` bật `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.** `arr[0]` có kiểu `T | undefined`; **không** truyền `{ foo: undefined }` cho prop khai báo `foo?: string` — phải bỏ hẳn key (`...(x ? { foo: x } : {})`).

10. **`apps/api/test/**` không được cần Postgres.** Binding Hyperdrive ở tầng đó trỏ vào cổng đóng; test route chỉ kiểm auth/validation. Test SQL thật nằm ở `apps/api/test-db/*.itest.mjs` (`pnpm test:api-db`).

11. **Chạy mọi lệnh `wrangler` từ `apps/api`** (wrangler đọc `.env` ở gốc repo). Trong `apps/api` phải gọi `pnpm run deploy`, không phải `pnpm deploy` (pnpm builtin chiếm tên).

12. Sau mỗi task: `pnpm lint` và `pnpm typecheck` phải xanh trước khi commit.

---

## Cấu trúc file sau khi xong plan này

**Tạo mới trong `apps/api/`:**

| File | Trách nhiệm |
|---|---|
| `src/api-key.ts` | Sinh khoá `mlv_live_…` bằng Web Crypto + `apiKeyPrefix()` |
| `src/routes/admin-list-params.ts` | `parseLimit()` + `parseSearch()` dùng chung cho mọi danh sách admin |
| `src/routes/admin-tenant-params.ts` | `parseTenantListParams()`, `encodeTenantCursor()`, `tenantId()`, `parseNewKeyBody()` |
| `src/routes/admin-tenants.ts` | Ba endpoint tenant/khoá |
| `test/api-key.test.ts` | Khoá sinh ra qua được `isApiKeyFormat()`; rejection sampling đúng |
| `test/admin-tenant-params.test.ts` | Toàn bộ nhánh validate, không chạm DB |
| `test/admin-tenants.test.ts` | Cổng Access/CSRF của ba route mới |
| `test-db/admin-tenants.itest.mjs` | SQL thật: danh sách, chi tiết, cấp khoá dùng được ngay, audit |

**Tạo mới trong `apps/admin/src/features/tenants/`:**

| File | Trách nhiệm |
|---|---|
| `api.ts` | Kiểu dữ liệu + hàm gọi HTTP (gồm hai route billing dùng lại) |
| `hooks.ts` | `useTenantList` (vô hạn), `useTenantDetail`, ba mutation |
| `page.tsx` | Màn danh sách `/admin/tenants` |
| `tenant-card.tsx` | Thẻ tenant cho khung hẹp + `relativeDate()` |
| `detail.tsx` | Ngăn chi tiết: thông tin tenant, danh sách khoá, các thao tác |
| `key-row.tsx` | Một khoá: prefix, nhãn, phạm vi, trạng thái, nút thu hồi/khôi phục |
| `new-key.tsx` | Hộp thoại cấp khoá + màn hiện khoá rõ đúng một lần |
| `*.test.tsx` / `api.test.ts` | Test giao diện tương ứng |

**Sửa:** `db/schema.dbtest.mjs`, `apps/api/src/routes/admin.ts` (mount), `apps/api/src/routes/admin-edit-params.ts` (dùng chung parser), `apps/api/src/routes/billing-admin.ts` (ghi audit), `scripts/api-db-test.mjs` (var `BILLING_ADMIN_EMAILS`), `apps/admin/src/routes.tsx`, `apps/admin/e2e/admin.spec.ts`.

**Tạo mới:** `db/migrations/0018_api_key_insert_grant.sql` + `.down.sql`.

---

# TASK 0 — XÁC NHẬN ĐIỀU KIỆN TRƯỚC KHI VIẾT MÃ

Hai điều dưới đây quyết định giao diện làm được gì. Biết trước 10 phút rẻ hơn phát hiện sau khi deploy.

**Files:** không sửa file nào.

- [ ] **Step 1: Xác nhận email quản trị có quyền billing trên production**

Lệnh này PHONG chạy (auto mode chặn máy đọc production). Gõ trong phiên Claude Code bằng tiền tố `!`:

```bash
cd apps/api && pnpm exec wrangler secret list --env production
```

Mong đợi: danh sách có `BILLING_ADMIN_EMAILS`. Nếu KHÔNG có, hoặc email đăng nhập Access của PHONG không nằm trong đó, thì nút Thu hồi/Khôi phục và nút đổi gói ở Task 13 sẽ trả 403 `billing_admin_forbidden` trên production. Sửa bằng:

```bash
cd apps/api && pnpm exec wrangler secret put BILLING_ADMIN_EMAILS --env production
# dán: <email Access của PHONG>
```

- [ ] **Step 2: Xác nhận `BILLING_ADMIN_ORIGIN` không chặn trang admin**

```bash
cd apps/api && pnpm exec wrangler secret list --env production | grep -i BILLING_ADMIN_ORIGIN || echo "không đặt — tốt"
```

Mong đợi: **không đặt**. Nếu có đặt, giá trị phải đúng bằng `https://api.ai-solutions.io.vn` (trang admin cùng origin với API). Đặt sai thì mọi POST billing từ trang admin nhận 403 `invalid_admin_origin`.

- [ ] **Step 3: Ghi kết quả vào plan**

Ghi ngay dưới đây hai dòng kết quả để task sau không phải đoán:

```
BILLING_ADMIN_EMAILS chứa email Access của PHONG: (có / không → đã thêm ngày …)
BILLING_ADMIN_ORIGIN: (không đặt / = https://api.ai-solutions.io.vn / khác → đã sửa)
```

---

# TASK 1 — MIGRATION 0018: QUYỀN INSERT TRÊN `api_key`

**Files:**
- Modify: `db/schema.dbtest.mjs`
- Create: `db/migrations/0018_api_key_insert_grant.sql`
- Create: `db/migrations/0018_api_key_insert_grant.down.sql`

- [ ] **Step 1: Viết bài kiểm quyền (đỏ trước)**

Mở `db/schema.dbtest.mjs`, chèn test mới **ngay sau** `it('0015/0016: api được UPDATE đúng ba cột, không thừa không thiếu', …)`:

```js
  it('0018: api được INSERT đúng chín cột của api_key để cấp khoá từ trang Admin', async () => {
    // Danh sách khớp chính xác cả hai chiều. Thiếu một cột nghĩa là POST /v1/admin/tenants/:id/keys
    // trả upstream_unavailable trên máy chủ thật (đúng lớp lỗi đã sinh ra migration 0016). Thừa một
    // cột nghĩa là Worker tự đặt được `active`/`revoked_at`/`created_at` — ba thứ chỉ DEFAULT và
    // route thu hồi mới được đụng. `pnpm test:api-db` KHÔNG thay thế được bài này: nó nối DB bằng
    // role chủ sở hữu chứ không phải role `api` mà Worker dùng thật.
    const inserts = await sql`SELECT column_name FROM information_schema.column_privileges
      WHERE grantee = 'api' AND table_schema = 'public' AND table_name = 'api_key'
        AND privilege_type = 'INSERT'
      ORDER BY column_name`;
    expect(inserts.map((row) => row.column_name)).toEqual([
      'allowed_bundle_ids',
      'allowed_origins',
      'key_hash',
      'key_prefix',
      'kind',
      'label',
      'quota_directions_per_day',
      'scopes',
      'tenant_id',
    ]);
  });
```

- [ ] **Step 2: Chạy để thấy nó đỏ**

```bash
cd /Users/dtphong/Desktop/software_business/mapsLibVN
pnpm test:db
```

Mong đợi: `db/schema.dbtest.mjs` đỏ đúng một test mới với `expected [] to deeply equal [ 'allowed_bundle_ids', … ]`. (`pipelines/poi/tests/pipeline-fixture.dbtest.mjs` đỏ vì thiếu `tippecanoe` là hiện tượng đã biết — bỏ qua.)

- [ ] **Step 3: Viết migration**

`db/migrations/0018_api_key_insert_grant.sql`:

```sql
-- Pha 2 trang Admin: route POST /v1/admin/tenants/:id/keys ghi một dòng vào api_key, thay cho
-- `pnpm key:issue` chạy tay trên máy chủ. Migration 0005 chỉ cấp SELECT, 0016 thêm
-- UPDATE (active, revoked_at) — vẫn chưa có INSERT. Thiếu dòng này thì route rơi vào catch chung
-- và trả upstream_unavailable trên production, còn test thì xanh vì nối DB bằng role chủ sở hữu.
-- Đây đúng là lớp lỗi đã sinh ra 0016 ngày 15/09/2026.
--
-- Cấp theo CỘT, không cấp cả bảng: Worker không được tự đặt `active`, `revoked_at`, `created_at`
-- (đều có DEFAULT, và thu hồi là việc của route billing), cũng không đụng quota_tiles_per_day,
-- quota_places_per_day, quota_edits_per_day.
GRANT INSERT (
  key_hash, key_prefix, tenant_id, label, kind,
  allowed_origins, allowed_bundle_ids, scopes, quota_directions_per_day
) ON api_key TO api;
```

`db/migrations/0018_api_key_insert_grant.down.sql`:

```sql
REVOKE INSERT (
  key_hash, key_prefix, tenant_id, label, kind,
  allowed_origins, allowed_bundle_ids, scopes, quota_directions_per_day
) ON api_key FROM api;
```

- [ ] **Step 4: Áp lên DB dev rồi chạy lại bài kiểm**

```bash
pnpm db:migrate
pnpm test:db
```

Mong đợi: `[db:migrate] Áp dụng 0018_api_key_insert_grant.sql …`, rồi `db/schema.dbtest.mjs` xanh toàn bộ.

- [ ] **Step 5: Thử chiều revert (một lần, rồi áp lại)**

```bash
pnpm db:migrate --down && pnpm db:migrate
```

Mong đợi: revert `0018_api_key_insert_grant` rồi áp lại, không lỗi. Đây là bằng chứng file `.down.sql` chạy được — cần tới lúc phải lùi trên production.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0018_api_key_insert_grant.sql db/migrations/0018_api_key_insert_grant.down.sql db/schema.dbtest.mjs
git commit -m "$(cat <<'EOF'
feat(db): 0018 cấp INSERT theo cột trên api_key cho role api

Trang Admin pha 2 cấp khoá từ web nên role `api` cần INSERT; 0005/0016 mới có
SELECT và UPDATE(active, revoked_at). Kèm bài kiểm khớp chính xác chín cột trong
schema.dbtest — tầng duy nhất bắt được thiếu GRANT, vì test:api-db nối DB bằng
role chủ sở hữu.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 2 — SINH KHOÁ API TRONG WORKER

**Files:**
- Create: `apps/api/src/api-key.ts`
- Test: `apps/api/test/api-key.test.ts`

- [ ] **Step 1: Viết test trước**

`apps/api/test/api-key.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { apiKeyPrefix, generateApiKey } from '../src/api-key';
import { isApiKeyFormat } from '../src/auth';

describe('generateApiKey', () => {
  it('mọi khoá sinh ra đều qua được cổng isApiKeyFormat của requireAuth', () => {
    // Cổng đó chặn TRƯỚC khi chạm KV/Postgres. Khoá lệch một ký tự là khoá chết ngay từ đầu,
    // mà người dùng chỉ biết khi gọi API thật — nên kiểm ở đây, không kiểm bằng mắt.
    for (let i = 0; i < 200; i += 1) expect(isApiKeyFormat(generateApiKey())).toBe(true);
  });

  it('byte ≥ 248 bị bỏ hẳn, không lấy dư — 62 ký tự có xác suất đều nhau', () => {
    // 248 = 4 × 62. Lấy `byte % 62` cho cả byte 248..255 sẽ làm sáu ký tự đầu bảng chữ cái xuất
    // hiện nhiều hơn — một khoá 24 ký tự lệch phân phối là khoá yếu hơn nó trông.
    const batches = [
      new Uint8Array([248, 249, 250, 251, 252, 253, 254, 255, ...new Array(16).fill(0)]),
      new Uint8Array(new Array(24).fill(61)),
    ];
    let call = 0;
    const key = generateApiKey(() => batches[call++] as Uint8Array);
    // Lô đầu chỉ góp 16 ký tự '0' (byte 0); tám ký tự còn thiếu lấy từ lô sau (byte 61 → 'z').
    expect(key).toBe(`mlv_live_${'0'.repeat(16)}${'z'.repeat(8)}`);
  });

  it('hai lần gọi không ra cùng một khoá', () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });
});

describe('apiKeyPrefix', () => {
  it('đúng 17 ký tự như scripts/lib/api-key.mjs sinh ra', () => {
    const key = generateApiKey();
    expect(apiKeyPrefix(key)).toBe(key.slice(0, 17));
    expect(apiKeyPrefix(key)).toMatch(/^mlv_live_[0-9A-Za-z]{8}$/);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/api-key.test.ts
```

Mong đợi: FAIL — `Failed to resolve import "../src/api-key"`.

- [ ] **Step 3: Viết `apps/api/src/api-key.ts`**

```ts
/**
 * Sinh khoá API bên trong Worker, cho route cấp khoá của trang Admin.
 *
 * Dạng khoá, bảng chữ cái, độ dài và cách băm phải KHỚP TỪNG CHỮ với `scripts/lib/api-key.mjs`:
 * hai nơi cùng ghi vào một bảng `api_key`, và `isApiKeyFormat()` trong auth.ts là cổng chặn chung.
 * Khác biệt duy nhất là nguồn ngẫu nhiên — Workers không có `node:crypto.randomBytes`.
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_LEN = 24;
/** 248 = 4 × 62: byte từ 248 trở lên bị bỏ để 62 ký tự có xác suất đều nhau (rejection sampling). */
const CEILING = 248;

export function generateApiKey(
  random: (buffer: Uint8Array) => Uint8Array = (buffer) => crypto.getRandomValues(buffer),
): string {
  let out = '';
  while (out.length < KEY_LEN) {
    for (const byte of random(new Uint8Array(KEY_LEN))) {
      if (byte >= CEILING) continue;
      const character = ALPHABET[byte % 62];
      if (character === undefined) continue;
      out += character;
      if (out.length === KEY_LEN) break;
    }
  }
  return `mlv_live_${out}`;
}

/** Phần nhận diện lưu cùng hash cho báo cáo/thu hồi: `mlv_live_` + 8 ký tự đầu (audit 09/09/2026). */
export const apiKeyPrefix = (key: string): string => key.slice(0, 'mlv_live_'.length + 8);
```

- [ ] **Step 4: Chạy lại**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/api-key.test.ts
```

Mong đợi: 4 test PASS.

- [ ] **Step 5: Lint + typecheck rồi commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/api-key.ts apps/api/test/api-key.test.ts
git commit -m "$(cat <<'EOF'
feat(api): sinh khoá API bằng Web Crypto trong Worker

Cùng bảng chữ cái, độ dài và rejection sampling với scripts/lib/api-key.mjs; test
khoá lại bằng chính isApiKeyFormat() mà requireAuth dùng làm cổng chặn.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 3 — THAM SỐ DANH SÁCH DÙNG CHUNG + PARSER TENANT

**Files:**
- Create: `apps/api/src/routes/admin-list-params.ts`
- Modify: `apps/api/src/routes/admin-edit-params.ts`
- Create: `apps/api/src/routes/admin-tenant-params.ts`
- Test: `apps/api/test/admin-tenant-params.test.ts`
- Test (đã có, phải vẫn xanh): `apps/api/test/admin-edits-params.test.ts`

- [ ] **Step 1: Viết test cho parser tenant (đỏ trước)**

`apps/api/test/admin-tenant-params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  encodeTenantCursor,
  parseTenantListParams,
  tenantId,
} from '../src/routes/admin-tenant-params';

const parse = (query: string) =>
  parseTenantListParams(new URL(`https://api/v1/admin/tenants?${query}`).searchParams);

const UUID = '11111111-1111-4111-8111-111111111111';

describe('parseTenantListParams', () => {
  it('mặc định: 25 bản ghi, không tìm, không con trỏ', () => {
    expect(parse('')).toEqual({ q: null, limit: 25, cursor: null });
  });

  it('limit bị kẹp trong 1..100 y như danh sách đóng góp', () => {
    expect(parse('limit=500').limit).toBe(100);
    expect(parse('limit=0').limit).toBe(25);
    expect(parse('limit=abc').limit).toBe(25);
  });

  it('q bị cắt còn 80 ký tự và bỏ khoảng trắng thừa', () => {
    expect(parse('q=%20%20cong%20ty%20%20').q).toBe('cong ty');
    expect(parse(`q=${'a'.repeat(200)}`).q).toHaveLength(80);
  });

  it('con trỏ hai phần: thời điểm tạo và uuid', () => {
    const cursor = encodeTenantCursor('2026-09-16T03:04:05.000Z', UUID);
    expect(cursor).toBe(`2026-09-16T03:04:05.000Z|${UUID}`);
    expect(parse(`cursor=${encodeURIComponent(cursor)}`).cursor).toEqual({
      createdAt: '2026-09-16T03:04:05.000Z',
      id: UUID,
    });
  });

  it('con trỏ dùng được với Date do postgres.js trả về', () => {
    expect(encodeTenantCursor(new Date('2026-09-16T03:04:05.000Z'), UUID)).toBe(
      `2026-09-16T03:04:05.000Z|${UUID}`,
    );
  });

  it.each([
    ['thiếu phần uuid', '2026-09-16T03:04:05.000Z'],
    ['uuid sai', '2026-09-16T03:04:05.000Z|khong-phai-uuid'],
    ['thời điểm sai', 'hom-qua|11111111-1111-4111-8111-111111111111'],
    ['thừa phần', `2026-09-16T03:04:05.000Z|${UUID}|x`],
  ])('con trỏ hỏng (%s) → ném 400', (_name, value) => {
    expect(() => parse(`cursor=${encodeURIComponent(value)}`)).toThrow(/cursor/);
  });
});

describe('tenantId', () => {
  it('nhận uuid hợp lệ', () => {
    expect(tenantId(UUID)).toBe(UUID);
  });

  it('không phải uuid → ném 400 chứ không để rơi xuống Postgres', () => {
    // Để chuỗi rác xuống tới `::uuid` thì Postgres ném, route bắt bằng catch chung và trả 503 —
    // người gọi nhận "lỗi máy chủ" cho một lỗi của chính họ.
    expect(() => tenantId('abc')).toThrow(/tenant/);
    expect(() => tenantId(undefined)).toThrow(/tenant/);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-tenant-params.test.ts
```

Mong đợi: FAIL — không resolve được `../src/routes/admin-tenant-params`.

- [ ] **Step 3: Tách hai hàm dùng chung ra `admin-list-params.ts`**

```ts
/**
 * Tham số chung cho các danh sách của trang Admin. Tách ra vì cả `/v1/admin/edits` lẫn
 * `/v1/admin/tenants` cần đúng một luật `limit` và một luật `q`; hai bản sao sẽ trôi khỏi nhau
 * và giao diện phải nhớ mỗi danh sách cắt chuỗi tìm ở đâu.
 */

/** `limit=0` và giá trị không phải số đều rơi về mặc định; số hợp lệ bị kẹp trong 1..100. */
export function parseLimit(params: URLSearchParams): number {
  const raw = Number(params.get('limit'));
  return Number.isFinite(raw) && raw !== 0 ? Math.min(100, Math.max(1, Math.trunc(raw))) : 25;
}

/** Chuỗi tìm: bỏ khoảng trắng hai đầu, rỗng thành null, cắt còn 80 ký tự. */
export function parseSearch(params: URLSearchParams): string | null {
  const raw = params.get('q')?.trim() ?? '';
  return raw === '' ? null : raw.slice(0, 80);
}
```

- [ ] **Step 4: Cho `admin-edit-params.ts` dùng lại hai hàm đó**

Trong `apps/api/src/routes/admin-edit-params.ts`, thêm import ở đầu file:

```ts
import { ApiError } from '../errors';
import { parseLimit, parseSearch } from './admin-list-params';
```

Xoá khối tính `rawLimit`/`limit` và khối tính `rawQ`/`q`, rồi đổi phần `return` thành:

```ts
  return {
    status: status as EditListParams['status'],
    kind: (rawKind as EditListParams['kind']) ?? null,
    tenantId: rawTenant,
    q: parseSearch(params),
    limit: parseLimit(params),
    cursor,
  };
```

- [ ] **Step 5: Test cũ phải vẫn xanh — đây là bằng chứng refactor không đổi hành vi**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-edits-params.test.ts
```

Mong đợi: 7 test PASS.

- [ ] **Step 6: Viết `apps/api/src/routes/admin-tenant-params.ts` (phần danh sách)**

```ts
import { ApiError } from '../errors';
import { parseLimit, parseSearch } from './admin-list-params';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TenantListParams {
  q: string | null;
  limit: number;
  /** Khoá sắp xếp của bản ghi cuối trang trước — danh sách giảm dần theo (created_at, id). */
  cursor: { createdAt: string; id: string } | null;
}

/**
 * Con trỏ hai phần `<created_at ISO>|<uuid>`. Không dùng một cột như danh sách đóng góp được:
 * id tenant là uuid nên không tăng theo thời gian, còn created_at một mình thì hai tenant tạo
 * cùng mili giây sẽ nuốt nhau ở ranh giới trang.
 */
export function encodeTenantCursor(createdAt: string | Date, id: string): string {
  return `${new Date(createdAt).toISOString()}|${id}`;
}

export function parseTenantListParams(params: URLSearchParams): TenantListParams {
  const raw = params.get('cursor');
  let cursor: TenantListParams['cursor'] = null;
  if (raw !== null) {
    const parts = raw.split('|');
    const [createdAt, id] = parts;
    const time = createdAt === undefined ? Number.NaN : Date.parse(createdAt);
    if (parts.length !== 2 || id === undefined || !UUID.test(id) || Number.isNaN(time))
      throw new ApiError(400, 'invalid_request', 'cursor phải có dạng <thời điểm ISO>|<uuid>');
    cursor = { createdAt: new Date(time).toISOString(), id };
  }

  return { q: parseSearch(params), limit: parseLimit(params), cursor };
}

/** Chặn chuỗi rác ở cổng route: để nó xuống tới `::uuid` thì Postgres ném và ta trả nhầm 503. */
export function tenantId(raw: string | undefined): string {
  if (!raw || !UUID.test(raw))
    throw new ApiError(400, 'invalid_request', 'tenant phải là uuid');
  return raw;
}
```

- [ ] **Step 7: Chạy lại cả hai file test**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-tenant-params.test.ts test/admin-edits-params.test.ts
```

Mong đợi: tất cả PASS (13 test của tenant + 7 test của edits).

- [ ] **Step 8: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/routes/admin-list-params.ts apps/api/src/routes/admin-edit-params.ts apps/api/src/routes/admin-tenant-params.ts apps/api/test/admin-tenant-params.test.ts
git commit -m "$(cat <<'EOF'
feat(api): tham số danh sách tenant và con trỏ hai phần

parseLimit/parseSearch tách ra dùng chung với danh sách đóng góp. Con trỏ tenant
là (created_at, id) vì id tenant là uuid, không tăng theo thời gian.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 4 — VALIDATE THÂN YÊU CẦU CẤP KHOÁ

**Files:**
- Modify: `apps/api/src/routes/admin-tenant-params.ts`
- Modify: `apps/api/test/admin-tenant-params.test.ts`

- [ ] **Step 1: Viết test trước**

Thêm vào cuối `apps/api/test/admin-tenant-params.test.ts`:

```ts
import { parseNewKeyBody } from '../src/routes/admin-tenant-params';

const body = (extra: Record<string, unknown> = {}) => ({
  label: 'trang nhúng thử',
  kind: 'server',
  ...extra,
});

describe('parseNewKeyBody', () => {
  it('thân tối thiểu: nhãn + loại, mặc định scope places:read', () => {
    expect(parseNewKeyBody(body())).toEqual({
      label: 'trang nhúng thử',
      kind: 'server',
      allowedOrigins: [],
      allowedBundleIds: [],
      scopes: ['places:read'],
      quotaDirectionsPerDay: null,
    });
  });

  it('không phải object → 400', () => {
    expect(() => parseNewKeyBody(null)).toThrow(/JSON/);
    expect(() => parseNewKeyBody('mlv_live_x')).toThrow(/JSON/);
  });

  it('kind lạ → 400', () => {
    expect(() => parseNewKeyBody(body({ kind: 'desktop' }))).toThrow(/kind/);
  });

  it('label rỗng → 400, label dài bị cắt còn 80', () => {
    expect(() => parseNewKeyBody(body({ label: '   ' }))).toThrow(/label/);
    expect(parseNewKeyBody(body({ label: 'x'.repeat(200) })).label).toHaveLength(80);
  });

  it('khoá web bắt buộc có allowed_origins', () => {
    // Khoá web nằm công khai trong HTML của khách. Không có danh sách origin thì ai copy được khoá
    // cũng gọi API từ trang của mình — đúng luật mà scripts/lib/api-key.mjs đang giữ.
    expect(() => parseNewKeyBody(body({ kind: 'web' }))).toThrow(/allowed_origins/);
    expect(
      parseNewKeyBody(body({ kind: 'web', allowed_origins: ['https://khach.example.com'] }))
        .allowedOrigins,
    ).toEqual(['https://khach.example.com']);
  });

  it('origin sai định dạng → 400', () => {
    expect(() => parseNewKeyBody(body({ kind: 'web', allowed_origins: ['khach.example.com'] })))
      .toThrow(/origin/);
    expect(() =>
      parseNewKeyBody(body({ kind: 'web', allowed_origins: ['https://a.example.com/duong-dan'] })),
    ).toThrow(/origin/);
  });

  it('wildcard subdomain được chấp nhận — originAllowed() hiểu dạng này', () => {
    expect(
      parseNewKeyBody(body({ kind: 'web', allowed_origins: ['https://*.example.com'] }))
        .allowedOrigins,
    ).toEqual(['https://*.example.com']);
  });

  it('allowed_bundle_ids chỉ dành cho khoá mobile', () => {
    expect(() => parseNewKeyBody(body({ allowed_bundle_ids: ['vn.example.app'] }))).toThrow(
      /mobile/,
    );
    expect(
      parseNewKeyBody(body({ kind: 'mobile', allowed_bundle_ids: ['vn.example.app'] }))
        .allowedBundleIds,
    ).toEqual(['vn.example.app']);
  });

  it('scope ngoài danh sách → 400, trùng thì gộp', () => {
    expect(() => parseNewKeyBody(body({ scopes: ['admin:write'] }))).toThrow(/scope/);
    expect(parseNewKeyBody(body({ scopes: ['places:read', 'places:read', 'edits:write'] })).scopes)
      .toEqual(['places:read', 'edits:write']);
  });

  it('scopes rỗng → 400 (khoá không có phạm vi nào là khoá vô dụng)', () => {
    expect(() => parseNewKeyBody(body({ scopes: [] }))).toThrow(/scope/);
  });

  it('quota_directions_per_day phải là số nguyên dương hoặc vắng', () => {
    expect(parseNewKeyBody(body({ quota_directions_per_day: 500 })).quotaDirectionsPerDay).toBe(500);
    expect(parseNewKeyBody(body({ quota_directions_per_day: null })).quotaDirectionsPerDay).toBeNull();
    expect(() => parseNewKeyBody(body({ quota_directions_per_day: 0 }))).toThrow(/quota/);
    expect(() => parseNewKeyBody(body({ quota_directions_per_day: 1.5 }))).toThrow(/quota/);
  });

  it('mảng chứa thứ không phải chuỗi → 400', () => {
    expect(() => parseNewKeyBody(body({ scopes: [1, 2] }))).toThrow(/scopes/);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-tenant-params.test.ts
```

Mong đợi: FAIL — `parseNewKeyBody is not a function` (hoặc không export).

- [ ] **Step 3: Viết `parseNewKeyBody` vào `admin-tenant-params.ts`**

Thêm vào cuối file:

```ts
const KINDS = ['web', 'mobile', 'server'] as const;
/** Phạm vi đang tồn tại trong hệ thống. Thêm scope mới thì sửa ở đây, không rải rác trong route. */
const SCOPES = ['places:read', 'edits:write'] as const;
/** Cùng luật với `isOrigin` trong scripts/lib/api-key.mjs: chỉ scheme + host (+ cổng), không đường dẫn. */
const ORIGIN = /^https?:\/\/[A-Za-z0-9*.-]+(:\d+)?$/;
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{1,127}$/;

export interface NewKeyInput {
  label: string;
  kind: (typeof KINDS)[number];
  allowedOrigins: string[];
  allowedBundleIds: string[];
  scopes: string[];
  quotaDirectionsPerDay: number | null;
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new ApiError(400, 'invalid_request', `${field} phải là mảng chuỗi`);
  return (value as string[]).map((item) => item.trim()).filter(Boolean);
}

export function parseNewKeyBody(raw: unknown): NewKeyInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new ApiError(400, 'invalid_request', 'Thân yêu cầu phải là một object JSON');
  const input = raw as Record<string, unknown>;

  const kind = input.kind;
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind))
    throw new ApiError(400, 'invalid_request', `kind phải là: ${KINDS.join(', ')}`);

  const label = (typeof input.label === 'string' ? input.label.trim() : '').slice(0, 80);
  if (!label) throw new ApiError(400, 'invalid_request', 'label không được rỗng');

  const allowedOrigins = stringArray(input.allowed_origins, 'allowed_origins');
  for (const origin of allowedOrigins)
    if (!ORIGIN.test(origin))
      throw new ApiError(400, 'invalid_request', `origin không hợp lệ: ${origin}`);
  // Khoá web nằm trong HTML của khách nên coi như công khai; danh sách origin là thứ duy nhất
  // ngăn người khác dùng lại nó từ trang của họ.
  if (kind === 'web' && allowedOrigins.length === 0)
    throw new ApiError(400, 'invalid_request', 'khoá web bắt buộc có allowed_origins');

  const allowedBundleIds = stringArray(input.allowed_bundle_ids, 'allowed_bundle_ids');
  if (allowedBundleIds.length > 0 && kind !== 'mobile')
    throw new ApiError(400, 'invalid_request', 'allowed_bundle_ids chỉ dùng cho khoá mobile');
  for (const bundle of allowedBundleIds)
    if (!BUNDLE_ID.test(bundle))
      throw new ApiError(400, 'invalid_request', `bundle id không hợp lệ: ${bundle}`);

  const requested =
    input.scopes === undefined ? ['places:read'] : stringArray(input.scopes, 'scopes');
  if (requested.length === 0)
    throw new ApiError(400, 'invalid_request', `scopes phải có ít nhất một trong: ${SCOPES.join(', ')}`);
  for (const scope of requested)
    if (!(SCOPES as readonly string[]).includes(scope))
      throw new ApiError(400, 'invalid_request', `scope phải là: ${SCOPES.join(', ')}`);
  const scopes = [...new Set(requested)];

  let quotaDirectionsPerDay: number | null = null;
  const quota = input.quota_directions_per_day;
  if (quota !== undefined && quota !== null) {
    const value = Number(quota);
    if (!Number.isInteger(value) || value <= 0)
      throw new ApiError(400, 'invalid_request', 'quota_directions_per_day phải là số nguyên dương');
    quotaDirectionsPerDay = value;
  }

  return {
    label,
    kind: kind as NewKeyInput['kind'],
    allowedOrigins,
    allowedBundleIds,
    scopes,
    quotaDirectionsPerDay,
  };
}
```

- [ ] **Step 4: Chạy lại**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-tenant-params.test.ts
```

Mong đợi: toàn bộ PASS.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/routes/admin-tenant-params.ts apps/api/test/admin-tenant-params.test.ts
git commit -m "$(cat <<'EOF'
feat(api): validate thân yêu cầu cấp khoá API

Giữ nguyên luật của scripts/lib/api-key.mjs: khoá web bắt buộc allowed_origins,
origin chỉ scheme+host, scope nằm trong danh sách hệ thống thật sự có.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 5 — HAI ENDPOINT ĐỌC: DANH SÁCH VÀ CHI TIẾT TENANT

**Files:**
- Create: `apps/api/src/routes/admin-tenants.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/test/admin-tenants.test.ts`

- [ ] **Step 1: Viết test cổng Access/CSRF (đỏ trước)**

`apps/api/test/admin-tenants.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

const UUID = '11111111-1111-4111-8111-111111111111';

describe('cổng vào của nhóm route tenant', () => {
  it('GET danh sách thiếu JWT Access → 401', async () => {
    const response = await SELF.fetch('https://api/v1/admin/tenants');
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('GET chi tiết thiếu JWT Access → 401', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/tenants/${UUID}`);
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('POST cấp khoá từ trang lạ → 403 cross_site_request, chặn TRƯỚC cả bước kiểm JWT', async () => {
    // Cấp khoá là thao tác tạo bí mật mới. Nếu CSRF lọt, một trang bất kỳ có thể mượn cookie
    // Access của người đang đăng nhập để tự cấp khoá cho mình.
    const response = await SELF.fetch(`https://api/v1/admin/tenants/${UUID}/keys`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('cross_site_request');
  });

  it('POST same-origin nhưng thiếu JWT → 401', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/tenants/${UUID}/keys`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://api' },
    });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-tenants.test.ts
```

Mong đợi: FAIL — hai test đầu nhận 404 `not_found` (chưa có route nào khớp).

- [ ] **Step 3: Viết `apps/api/src/routes/admin-tenants.ts`**

```ts
import { Hono } from 'hono';
import { normalizeTextArray } from '../auth';
import { endSql, getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { encodeTenantCursor, parseTenantListParams, tenantId } from './admin-tenant-params';

/**
 * Nhóm route tenant/khoá API. KHÔNG khai middleware ở đây: router này được mount vào app `admin`,
 * nên nó nằm sau đúng một chỗ khai quyền (`/v1/admin/*`: chống CSRF rồi `requireAccess()`). Thêm
 * route mới vào file này không thể quên gắn cổng.
 */
export const adminTenants = new Hono<AppEnv>();

interface TenantRow {
  id: string;
  name: string;
  plan: string;
  quota_mode: string;
  created_at: string;
  active_keys: number;
}

interface KeyRow {
  key_hash: string;
  key_prefix: string;
  label: string | null;
  kind: string;
  scopes: string[] | string;
  allowed_origins: string[] | string;
  allowed_bundle_ids: string[] | string;
  quota_places_per_day: number | null;
  quota_directions_per_day: number | null;
  active: boolean;
  created_at: string;
  revoked_at: string | null;
}

const NO_STORE = { 'cache-control': 'private, no-store' } as const;

adminTenants.get('/v1/admin/tenants', async (c) => {
  const params = parseTenantListParams(new URL(c.req.url).searchParams);
  const createdAt = params.cursor?.createdAt ?? null;
  const cursorId = params.cursor?.id ?? null;
  const sql = getSql(c.env);
  try {
    // Lấy dư một bản ghi để biết còn trang sau hay không, giống danh sách đóng góp — không đếm
    // tổng, vì con số đó không giúp gì cho người đang tìm một tenant.
    const rows = await sql<TenantRow[]>`
      SELECT t.id, t.name, t.plan, t.quota_mode, t.created_at,
             count(k.key_hash) FILTER (WHERE k.active AND k.revoked_at IS NULL)::int AS active_keys
      FROM tenant t
      LEFT JOIN api_key k ON k.tenant_id = t.id
      WHERE (${params.q}::text IS NULL OR t.name ILIKE '%' || ${params.q} || '%')
        AND (${createdAt}::timestamptz IS NULL
             OR (t.created_at, t.id) < (${createdAt}::timestamptz, ${cursorId}::uuid))
      GROUP BY t.id
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${params.limit + 1}`;

    const hasMore = rows.length > params.limit;
    const items = hasMore ? rows.slice(0, params.limit) : rows;
    const last = items.at(-1);
    return c.json(
      {
        items,
        nextCursor: hasMore && last ? encodeTenantCursor(last.created_at, last.id) : null,
      },
      200,
      NO_STORE,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/tenants', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được danh sách tenant');
  } finally {
    endSql(c.executionCtx, sql);
  }
});

adminTenants.get('/v1/admin/tenants/:id', async (c) => {
  const id = tenantId(c.req.param('id'));
  const sql = getSql(c.env);
  try {
    const [tenant] = await sql<TenantRow[]>`
      SELECT t.id, t.name, t.plan, t.quota_mode, t.created_at,
             count(k.key_hash) FILTER (WHERE k.active AND k.revoked_at IS NULL)::int AS active_keys
      FROM tenant t
      LEFT JOIN api_key k ON k.tenant_id = t.id
      WHERE t.id = ${id}::uuid
      GROUP BY t.id`;
    if (!tenant) throw new ApiError(404, 'not_found', 'Không có tenant này');

    // `quota_directions_per_day` đọc qua to_jsonb thay vì tham chiếu cột: Postgres phân giải cột
    // ngay lúc parse, nên tham chiếu trực tiếp làm hỏng CẢ câu nếu Worker deploy trước migration
    // thêm cột (sự cố 06–07/09/2026). Giữ đúng lối viết của selectApiKey trong auth.ts.
    const keys = await sql<KeyRow[]>`
      SELECT k.key_hash, k.key_prefix, k.label, k.kind, k.scopes, k.allowed_origins,
             k.allowed_bundle_ids, k.quota_places_per_day,
             (to_jsonb(k) ->> 'quota_directions_per_day')::int AS quota_directions_per_day,
             k.active, k.created_at, k.revoked_at
      FROM api_key k
      WHERE k.tenant_id = ${id}::uuid
      ORDER BY k.created_at DESC, k.key_hash`;

    return c.json(
      {
        tenant,
        // Hyperdrive chạy `fetch_types: false` nên text[] có thể về dưới dạng chuỗi `{a,b}`.
        // Chỉ lộ ra trên DB thật; test không DB không bao giờ thấy.
        keys: keys.map((key) => ({
          ...key,
          scopes: normalizeTextArray(key.scopes),
          allowed_origins: normalizeTextArray(key.allowed_origins),
          allowed_bundle_ids: normalizeTextArray(key.allowed_bundle_ids),
        })),
      },
      200,
      NO_STORE,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/tenants/:id', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đọc được chi tiết tenant');
  } finally {
    endSql(c.executionCtx, sql);
  }
});
```

- [ ] **Step 4: Mount vào app `admin`**

Trong `apps/api/src/routes/admin.ts`, thêm import:

```ts
import { adminTenants } from './admin-tenants';
```

và ngay **sau** dòng `admin.use('/v1/admin/*', requireAccess());`, thêm:

```ts
// Mount SAU hai middleware trên: nhóm tenant hưởng đúng cổng chống CSRF và Access đã khai một
// lần ở đây, thay vì mỗi file route tự nhớ gắn lại.
admin.route('/', adminTenants);
```

- [ ] **Step 5: Chạy lại test**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-tenants.test.ts
```

Mong đợi: 4 test PASS.

- [ ] **Step 6: Chạy cả bộ test API (không DB) để chắc không vỡ chỗ khác**

```bash
pnpm --filter @mapslibvn/api test
```

Mong đợi: toàn bộ PASS.

- [ ] **Step 7: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/routes/admin-tenants.ts apps/api/src/routes/admin.ts apps/api/test/admin-tenants.test.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /v1/admin/tenants và /v1/admin/tenants/:id

Phân trang con trỏ (created_at, id), đếm khoá còn hiệu lực, chi tiết kèm danh
sách khoá. text[] đi qua normalizeTextArray vì Hyperdrive tắt fetch_types.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 6 — ENDPOINT CẤP KHOÁ

**Files:**
- Modify: `apps/api/src/routes/admin-tenants.ts`

- [ ] **Step 1: Viết route**

Thêm import ở đầu `admin-tenants.ts`:

```ts
import { apiKeyPrefix, generateApiKey } from '../api-key';
import { audit } from '../audit';
import { sha256Hex } from '../edits/hash';
import { textArray } from '../geocode';
import { parseNewKeyBody } from './admin-tenant-params';
```

Thêm route vào cuối file:

```ts
adminTenants.post('/v1/admin/tenants/:id/keys', async (c) => {
  const id = tenantId(c.req.param('id'));
  const input = parseNewKeyBody(await c.req.json().catch(() => null));

  // Sinh và băm TRƯỚC khi mở kết nối: khoá rõ không bao giờ rời hàm này ngoài phản hồi cuối cùng.
  const key = generateApiKey();
  const keyHash = await sha256Hex(key);
  const keyPrefix = apiKeyPrefix(key);

  const sql = getSql(c.env);
  try {
    const [tenant] = await sql<{ name: string }[]>`
      SELECT name FROM tenant WHERE id = ${id}::uuid`;
    if (!tenant) throw new ApiError(404, 'not_found', 'Không có tenant này');

    // Ba cột mảng đi qua `textArray`: bind mảng JS rồi cast ::text[] thì bản postgres/cf trong
    // Workers nối thành "a,b" và Postgres ném `malformed array literal` — chỉ vỡ trên production
    // và ở test:api-db, unit test không DB luôn xanh.
    await sql`
      INSERT INTO api_key
        (key_hash, key_prefix, tenant_id, label, kind,
         allowed_origins, allowed_bundle_ids, scopes, quota_directions_per_day)
      VALUES (${keyHash}, ${keyPrefix}, ${id}::uuid, ${input.label}, ${input.kind},
              ${textArray(sql, input.allowedOrigins)}, ${textArray(sql, input.allowedBundleIds)},
              ${textArray(sql, input.scopes)}, ${input.quotaDirectionsPerDay})`;

    // Cache âm của auth sống 60 giây. Ai đó vừa thử đúng chuỗi này (hoặc một lần thử trước đó
    // trong cùng phút) là khoá mới chết oan tới một phút; xoá luôn cho chắc.
    await c.env.META.delete(`apikey:${keyHash}`);

    // `detail` KHÔNG bao giờ chứa khoá rõ — spec mục 10. key_hash là định danh đủ để lần lại.
    audit(c, 'tenant.key_issue', keyHash, {
      tenant_id: id,
      key_prefix: keyPrefix,
      kind: input.kind,
      scopes: input.scopes,
      label: input.label,
    });

    return c.json(
      { key, key_prefix: keyPrefix, key_hash: keyHash, tenant_id: id },
      201,
      NO_STORE,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/tenants/:id/keys', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không cấp được khoá');
  } finally {
    endSql(c.executionCtx, sql);
  }
});
```

- [ ] **Step 2: Chạy test cổng vào (đã viết ở Task 5) — hai ca POST phải vẫn xanh**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-tenants.test.ts
```

Mong đợi: 4 test PASS. Ca `POST same-origin thiếu JWT → 401` giờ đi qua route thật thay vì 404.

- [ ] **Step 3: Kiểm bằng mắt rằng khoá rõ không lọt ra chỗ nào khác**

```bash
grep -n "key" apps/api/src/routes/admin-tenants.ts | grep -v keyHash | grep -v keyPrefix | grep -v key_hash | grep -v key_prefix | grep -v api_key | grep -v apikey
```

Mong đợi: chỉ còn các dòng `const key = generateApiKey();`, dòng tính `keyHash`/`keyPrefix` từ `key`, và dòng `return c.json({ key, … })`. Không có `console.log` nào chạm `key`.

- [ ] **Step 4: Commit**

```bash
pnpm lint && pnpm typecheck && pnpm --filter @mapslibvn/api test
git add apps/api/src/routes/admin-tenants.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /v1/admin/tenants/:id/keys — cấp khoá trả rõ một lần

Khoá rõ chỉ nằm trong phản hồi; DB giữ sha256 + tiền tố, admin_audit giữ key_hash.
Ba cột mảng đi qua textArray vì postgres/cf nối mảng JS thành chuỗi.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 7 — TEST SQL THẬT CHO BA ENDPOINT

**Files:**
- Create: `apps/api/test-db/admin-tenants.itest.mjs`

- [ ] **Step 1: Viết file itest**

```js
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
/** Tenant seed sẵn trong apps/api/test-db/setup.sql. */
const TENANT_FREE = '00000000-0000-4000-8000-0000000000cc';
const POI_ID = '01M3TEST0000000000000CAF01';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      'Sec-Fetch-Site': 'same-origin',
      ...(init.headers ?? {}),
    },
  });

const issue = (tenant, body) =>
  adminFetch(`/v1/admin/tenants/${tenant}/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /v1/admin/tenants', () => {
  it('trả tenant seed kèm số khoá còn hiệu lực', async () => {
    const body = await (await adminFetch('/v1/admin/tenants?limit=100')).json();
    const tenant = body.items.find((item) => item.id === TENANT_FREE);
    expect(tenant.name).toBe('M4 itest free');
    expect(tenant.plan).toBe('free');
    expect(tenant.quota_mode).toBe('legacy');
    expect(tenant.active_keys).toBeGreaterThanOrEqual(1);
  });

  it('tìm theo tên lọc đúng và không phân biệt hoa thường', async () => {
    const body = await (await adminFetch('/v1/admin/tenants?q=itest%20free')).json();
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) expect(item.name.toLowerCase()).toContain('itest free');
  });

  it('phân trang con trỏ: trang sau không lặp lại bản ghi của trang trước', async () => {
    const first = await (await adminFetch('/v1/admin/tenants?limit=1')).json();
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await (
      await adminFetch(`/v1/admin/tenants?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)
    ).json();
    expect(second.items[0].id).not.toBe(first.items[0].id);
  });

  it('con trỏ hỏng → 400 chứ không phải 503', async () => {
    const response = await adminFetch('/v1/admin/tenants?cursor=rac');
    expect(response.status).toBe(400);
  });

  it('không JWT → 401', async () => {
    expect((await fetch(`${base}/v1/admin/tenants`)).status).toBe(401);
  });
});

describe('GET /v1/admin/tenants/:id', () => {
  it('scopes và allowed_origins về dưới dạng MẢNG THẬT, không phải chuỗi "{a,b}"', async () => {
    // Hyperdrive chạy fetch_types: false nên text[] có thể về dạng chuỗi. Đây là lớp lỗi mà chỉ
    // tầng này thấy: unit test không DB luôn xanh, còn giao diện thì hiện "{places:read}".
    const body = await (await adminFetch(`/v1/admin/tenants/${TENANT_FREE}`)).json();
    expect(body.tenant.name).toBe('M4 itest free');
    expect(body.keys.length).toBeGreaterThan(0);
    for (const key of body.keys) {
      expect(Array.isArray(key.scopes)).toBe(true);
      expect(Array.isArray(key.allowed_origins)).toBe(true);
      expect(Array.isArray(key.allowed_bundle_ids)).toBe(true);
      expect(key.key_prefix).toMatch(/^mlv_live_[0-9A-Za-z]{8}$/);
    }
    expect(body.keys.some((key) => key.scopes.includes('edits:write'))).toBe(true);
  });

  it('tenant không tồn tại → 404', async () => {
    const response = await adminFetch('/v1/admin/tenants/11111111-1111-4111-8111-111111111111');
    expect(response.status).toBe(404);
  });

  it('id không phải uuid → 400', async () => {
    expect((await adminFetch('/v1/admin/tenants/abc')).status).toBe(400);
  });
});

describe('POST /v1/admin/tenants/:id/keys', () => {
  it('khoá vừa cấp gọi được /v1/places ngay — chứng minh INSERT, hash và scope đều đúng', async () => {
    const response = await issue(TENANT_FREE, {
      label: `itest cấp khoá ${Date.now()}`,
      kind: 'server',
      scopes: ['places:read'],
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.key).toMatch(/^mlv_live_[0-9A-Za-z]{24}$/);
    expect(body.key_prefix).toBe(body.key.slice(0, 17));

    const place = await fetch(`${base}/v1/places/${POI_ID}`, {
      headers: { 'X-Api-Key': body.key },
    });
    expect(place.status).toBe(200);

    // DB chỉ giữ hash: cột khoá rõ đã bị bỏ từ migration 0011.
    const [row] = await sql`SELECT key_hash, key_prefix, kind, scopes, allowed_origins, active
      FROM api_key WHERE key_hash = ${body.key_hash}`;
    expect(row.active).toBe(true);
    expect(row.key_prefix).toBe(body.key_prefix);
    expect(row.scopes).toEqual(['places:read']);
    expect(row.allowed_origins).toEqual([]);
  });

  it('khoá web lưu đúng allowed_origins và bị chặn khi gọi từ origin lạ', async () => {
    const body = await (
      await issue(TENANT_FREE, {
        label: `itest khoá web ${Date.now()}`,
        kind: 'web',
        allowed_origins: ['https://khach.example.com'],
      })
    ).json();

    const tot = await fetch(`${base}/v1/places/${POI_ID}`, {
      headers: { 'X-Api-Key': body.key, Origin: 'https://khach.example.com' },
    });
    expect(tot.status).toBe(200);

    const la = await fetch(`${base}/v1/places/${POI_ID}`, {
      headers: { 'X-Api-Key': body.key, Origin: 'https://ke-khac.example.net' },
    });
    expect(la.status).toBe(403);
  });

  it('khoá web thiếu allowed_origins → 400, không có dòng nào được ghi', async () => {
    const truoc = await sql`SELECT count(*)::int AS n FROM api_key WHERE tenant_id = ${TENANT_FREE}::uuid`;
    const response = await issue(TENANT_FREE, { label: 'thiếu origin', kind: 'web' });
    expect(response.status).toBe(400);
    const sau = await sql`SELECT count(*)::int AS n FROM api_key WHERE tenant_id = ${TENANT_FREE}::uuid`;
    expect(sau[0].n).toBe(truoc[0].n);
  });

  it('tenant không tồn tại → 404 và không ghi khoá mồ côi', async () => {
    const response = await issue('11111111-1111-4111-8111-111111111111', {
      label: 'tenant ma',
      kind: 'server',
    });
    expect(response.status).toBe(404);
  });

  it('ghi đúng một dòng admin_audit, có actor, KHÔNG có khoá rõ', async () => {
    const label = `itest audit ${Date.now()}`;
    const body = await (await issue(TENANT_FREE, { label, kind: 'server' })).json();

    // audit chạy trong waitUntil nên có thể tới sau phản hồi.
    let rows = [];
    for (let i = 0; i < 20 && rows.length === 0; i += 1) {
      rows = await sql`SELECT actor, action, target, detail FROM admin_audit
        WHERE action = 'tenant.key_issue' AND target = ${body.key_hash}`;
      if (rows.length === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('phong@access-fake.local');
    expect(rows[0].detail.label).toBe(label);
    expect(JSON.stringify(rows[0].detail)).not.toContain(body.key);
  });
});
```

- [ ] **Step 2: Chạy bộ itest**

```bash
pnpm test:api-db
```

Mong đợi: file `admin-tenants.itest.mjs` xanh toàn bộ, và các file itest cũ vẫn xanh. Lần chạy đầu mất 2–4 phút (dựng DB cô lập + wrangler dev).

Nếu ca "khoá vừa cấp gọi được /v1/places" đỏ với `upstream_unavailable`: kiểm lại Task 1 đã áp lên DB **của harness** chưa — harness tự chạy `scripts/db-migrate.mjs` trên DB cô lập, nên lỗi này nghĩa là migration chưa được commit/lưu đúng thư mục.

Nếu đỏ với `malformed array literal`: một trong ba cột mảng chưa đi qua `textArray` (xem Ghi chú 1).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test-db/admin-tenants.itest.mjs
git commit -m "$(cat <<'EOF'
test(api): itest DB thật cho nhóm route tenant và cấp khoá

Khoá vừa cấp phải gọi được /v1/places ngay — bài kiểm duy nhất chứng minh INSERT,
sha256, scope và GRANT đều đúng cùng lúc. Kèm ca text[] về dạng mảng thật.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 8 — GHI AUDIT CHO THU HỒI KHOÁ VÀ ĐỔI GÓI

Tiêu chí nghiệm thu số 4 của spec: **mọi thao tác ghi để lại đúng một dòng `admin_audit` với đúng `actor`**. Hai route billing mà pha 2 dùng lại hiện chỉ trả receipt của Durable Object, không ghi gì vào `admin_audit`.

**Files:**
- Modify: `apps/api/src/routes/billing-admin.ts`
- Modify: `scripts/api-db-test.mjs`
- Modify: `apps/api/test-db/admin-tenants.itest.mjs`

- [ ] **Step 1: Cho harness biết ai được quản trị billing**

Trong `scripts/api-db-test.mjs`, trong mảng tham số của `crossSpawn('pnpm', [...])` khởi động wrangler, thêm ngay sau cặp `'--var', 'AUTOCOMPLETE_TELEX:1',`:

```js
    // Nhóm route billing (thu hồi khoá, đổi gói) đứng sau requireBillingAccess(): danh sách rỗng
    // là từ chối tất cả. Trang Admin pha 2 gọi chính những route đó, nên itest và E2E phải có hai
    // email mà access-fake ký: phong@access-fake.local (itest) và phong@e2e.local (Playwright).
    '--var',
    'BILLING_ADMIN_EMAILS:phong@access-fake.local,phong@e2e.local',
```

- [ ] **Step 2: Viết test itest trước (đỏ)**

Thêm vào cuối `apps/api/test-db/admin-tenants.itest.mjs`:

```js
describe('thu hồi khoá từ trang Admin (route billing dùng lại)', () => {
  it('thu hồi → khoá chết ngay, khôi phục → sống lại, mỗi lần một dòng audit', async () => {
    const body = await (
      await issue(TENANT_FREE, { label: `itest thu hồi ${Date.now()}`, kind: 'server' })
    ).json();
    expect(
      (await fetch(`${base}/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': body.key } })).status,
    ).toBe(200);

    const revocation = (revoked, operationId) =>
      adminFetch(`/v1/admin/billing/${TENANT_FREE}/keys/${body.key_hash}/revocation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revoked, reason: 'itest', operationId }),
      });

    expect((await revocation(true, `itest-thu-hoi-${body.key_hash}`)).status).toBe(200);
    // Route tự xoá cache KV của khoá, nên hiệu lực là tức thì chứ không phải sau 300 giây.
    expect(
      (await fetch(`${base}/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': body.key } })).status,
    ).toBe(401);

    expect((await revocation(false, `itest-khoi-phuc-${body.key_hash}`)).status).toBe(200);
    expect(
      (await fetch(`${base}/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': body.key } })).status,
    ).toBe(200);

    let rows = [];
    for (let i = 0; i < 20 && rows.length < 2; i += 1) {
      rows = await sql`SELECT actor, action FROM admin_audit
        WHERE target = ${body.key_hash} AND action IN ('tenant.key_revoke', 'tenant.key_restore')
        ORDER BY id`;
      if (rows.length < 2) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(rows.map((row) => row.action)).toEqual(['tenant.key_revoke', 'tenant.key_restore']);
    for (const row of rows) expect(row.actor).toBe('phong@access-fake.local');
  });

  it('đổi quota_mode ghi audit và đổi thật trong DB', async () => {
    const response = await adminFetch(`/v1/admin/billing/${TENANT_FREE}/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'commercial' }),
    });
    expect(response.status).toBe(200);
    const [tenant] = await sql`SELECT quota_mode FROM tenant WHERE id = ${TENANT_FREE}::uuid`;
    expect(tenant.quota_mode).toBe('commercial');

    let rows = [];
    for (let i = 0; i < 20 && rows.length === 0; i += 1) {
      rows = await sql`SELECT actor, detail FROM admin_audit
        WHERE action = 'tenant.quota_mode' AND target = ${TENANT_FREE} ORDER BY id DESC LIMIT 1`;
      if (rows.length === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(rows[0].actor).toBe('phong@access-fake.local');
    expect(rows[0].detail.mode).toBe('commercial');

    // Trả tenant về legacy để các file itest khác không chạy dưới luật thương mại.
    await adminFetch(`/v1/admin/billing/${TENANT_FREE}/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'legacy' }),
    });
  });
});

describe('lớp quyền billing không bị nới ra vì trang Admin (tiêu chí nghiệm thu số 3)', () => {
  it('email ngoài BILLING_ADMIN_EMAILS: xem được tenant nhưng KHÔNG thu hồi được khoá', async () => {
    // Đây là bài kiểm duy nhất chạy qua `requireBillingAccess()` THẬT. `apps/api/test/
    // billing-admin.test.ts` dựng một Hono riêng và tự gán `reviewer`, nên nó không nói gì về
    // lớp lọc email — chỉ tầng này có JWT ký được với email tuỳ ý.
    const laJwt = signAccessJwt({ email: 'nguoi-la@access-fake.local' });
    const laFetch = (path, init = {}) =>
      fetch(base + path, {
        ...init,
        headers: {
          'Cf-Access-Jwt-Assertion': laJwt,
          'Sec-Fetch-Site': 'same-origin',
          ...(init.headers ?? {}),
        },
      });

    // Giai đoạn này hệ thống chưa phân quyền: ai qua được Access đều xem được tenant.
    expect((await laFetch('/v1/admin/tenants?limit=1')).status).toBe(200);

    const response = await laFetch(
      `/v1/admin/billing/${TENANT_FREE}/keys/${'a'.repeat(64)}/revocation`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revoked: true, reason: 'thử', operationId: 'thử' }),
      },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('billing_admin_forbidden');
  });
});
```

- [ ] **Step 3: Chạy để thấy đỏ**

```bash
pnpm test:api-db
```

Mong đợi: hai test audit đỏ ở khẳng định `admin_audit` (mảng rỗng) — phần HTTP của chúng đã xanh nhờ Step 1. Test "lớp quyền billing không bị nới ra" phải **xanh ngay**: nó chỉ khẳng định hành vi sẵn có. Nếu nó đỏ, dừng lại xem `BILLING_ADMIN_EMAILS` ở Step 1 có bị gõ nhầm thành `nguoi-la@access-fake.local` không.

- [ ] **Step 4: Ghi audit trong `billing-admin.ts`**

Thêm import ở đầu file:

```ts
import { audit } from '../audit';
```

Trong route `POST /v1/admin/billing/:tenantId/mode`, ngay **trước** `return c.json({ tenantId, mode: body.mode }, …)`:

```ts
      audit(c, 'tenant.quota_mode', tenantId, { mode: String(body.mode) });
```

Trong route `POST /v1/admin/billing/:tenantId/keys/:keyHash/revocation`, ngay **sau** `await c.env.META.delete(\`apikey:${keyHash}\`);` của nhánh thành công và **trước** `return c.json(receipt, …)`:

```ts
      // Nhật ký kiểm toán là bằng chứng "ai tắt khoá của khách lúc mấy giờ" — receipt của Durable
      // Object nằm trong sổ quota, không phải nơi người quản trị tra cứu. Không ghi khoá rõ: chỉ
      // key_hash, đúng như spec mục 10.
      audit(c, revoked ? 'tenant.key_revoke' : 'tenant.key_restore', keyHash, {
        tenant_id: tenantId,
        reason,
        operation_id: operationId,
      });
```

- [ ] **Step 5: Chạy lại**

```bash
pnpm test:api-db
```

Mong đợi: toàn bộ xanh.

- [ ] **Step 6: Bộ test API không DB vẫn phải xanh**

```bash
pnpm --filter @mapslibvn/api test
```

Mong đợi: PASS. (`writeAudit` nuốt lỗi DB nên tầng này không bị ảnh hưởng dù binding trỏ cổng đóng.)

- [ ] **Step 7: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/routes/billing-admin.ts scripts/api-db-test.mjs apps/api/test-db/admin-tenants.itest.mjs
git commit -m "$(cat <<'EOF'
feat(api): ghi admin_audit khi thu hồi khoá và đổi gói

Hai route billing là nơi trang Admin pha 2 ghi dữ liệu, nên chúng phải để lại vết
như mọi thao tác ghi khác. Harness itest/E2E được cấp BILLING_ADMIN_EMAILS để thử
đúng đường mà người dùng thật đi.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 9 — LỚP GỌI API PHÍA TRÌNH DUYỆT

**Files:**
- Create: `apps/admin/src/features/tenants/api.ts`
- Create: `apps/admin/src/features/tenants/hooks.ts`
- Test: `apps/admin/src/features/tenants/api.test.ts`

- [ ] **Step 1: Viết test trước**

`apps/admin/src/features/tenants/api.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTenant, issueKey, listTenants, setKeyRevoked, setQuotaMode } from './api';

const stub = (body: unknown, status = 200) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const url = (fetchMock: ReturnType<typeof vi.fn>) => String(fetchMock.mock.calls[0]?.[0]);
const init = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

afterEach(() => vi.unstubAllGlobals());

describe('listTenants', () => {
  it('không lọc gì thì chỉ gửi limit', async () => {
    const fetchMock = stub({ items: [], nextCursor: null });
    await listTenants({});
    expect(url(fetchMock)).toBe('/v1/admin/tenants?limit=25');
  });

  it('con trỏ chứa dấu | và : nên phải được mã hoá', async () => {
    const fetchMock = stub({ items: [], nextCursor: null });
    await listTenants({ q: 'cà phê', cursor: '2026-09-16T03:04:05.000Z|abc' });
    const query = new URL(url(fetchMock), 'https://api').searchParams;
    expect(query.get('q')).toBe('cà phê');
    expect(query.get('cursor')).toBe('2026-09-16T03:04:05.000Z|abc');
  });
});

describe('issueKey', () => {
  it('POST kèm content-type JSON và thân đúng', async () => {
    const fetchMock = stub({ key: 'mlv_live_x' }, 201);
    await issueKey('t1', { label: 'thử', kind: 'server' });
    expect(url(fetchMock)).toBe('/v1/admin/tenants/t1/keys');
    expect(init(fetchMock)?.method).toBe('POST');
    expect(JSON.parse(String(init(fetchMock)?.body))).toEqual({ label: 'thử', kind: 'server' });
  });
});

describe('setKeyRevoked', () => {
  it('gọi đúng route billing đã có, kèm operationId và lý do', async () => {
    const fetchMock = stub({ ok: true });
    await setKeyRevoked('t1', 'a'.repeat(64), true, 'khách yêu cầu', 'op-1');
    expect(url(fetchMock)).toBe(`/v1/admin/billing/t1/keys/${'a'.repeat(64)}/revocation`);
    expect(JSON.parse(String(init(fetchMock)?.body))).toEqual({
      revoked: true,
      reason: 'khách yêu cầu',
      operationId: 'op-1',
    });
  });
});

describe('setQuotaMode', () => {
  it('gọi route đổi gói', async () => {
    const fetchMock = stub({ mode: 'commercial' });
    await setQuotaMode('t1', 'commercial');
    expect(url(fetchMock)).toBe('/v1/admin/billing/t1/mode');
    expect(JSON.parse(String(init(fetchMock)?.body))).toEqual({ mode: 'commercial' });
  });
});

describe('getTenant', () => {
  it('gọi đúng đường dẫn chi tiết', async () => {
    const fetchMock = stub({ tenant: {}, keys: [] });
    await getTenant('t1');
    expect(url(fetchMock)).toBe('/v1/admin/tenants/t1');
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/tenants/api.test.ts
```

Mong đợi: FAIL — không resolve được `./api`.

- [ ] **Step 3: Viết `apps/admin/src/features/tenants/api.ts`**

```ts
import { apiFetch } from '@/lib/fetcher';

export type TenantPlan = 'internal' | 'free' | 'paid';
export type QuotaMode = 'legacy' | 'commercial';
export type KeyKind = 'web' | 'mobile' | 'server';

export interface Tenant {
  id: string;
  name: string;
  plan: TenantPlan;
  quota_mode: QuotaMode;
  created_at: string;
  active_keys: number;
}

export interface ApiKey {
  key_hash: string;
  key_prefix: string;
  label: string | null;
  kind: KeyKind;
  scopes: string[];
  allowed_origins: string[];
  allowed_bundle_ids: string[];
  quota_places_per_day: number | null;
  quota_directions_per_day: number | null;
  active: boolean;
  created_at: string;
  revoked_at: string | null;
}

export interface TenantListPage {
  items: Tenant[];
  /** Chuỗi `<thời điểm ISO>|<uuid>`; null là hết. */
  nextCursor: string | null;
}

export interface TenantDetail {
  tenant: Tenant;
  keys: ApiKey[];
}

export interface NewKeyInput {
  label: string;
  kind: KeyKind;
  allowed_origins?: string[];
  allowed_bundle_ids?: string[];
  scopes?: string[];
  quota_directions_per_day?: number;
}

export interface NewKeyResult {
  /** Khoá dạng rõ. Máy chủ trả đúng MỘT lần; DB chỉ giữ sha256. Không lưu lại ở bất kỳ đâu. */
  key: string;
  key_prefix: string;
  key_hash: string;
  tenant_id: string;
}

export function listTenants(filter: { q?: string; cursor?: string }): Promise<TenantListPage> {
  const params = new URLSearchParams({ limit: '25' });
  if (filter.q) params.set('q', filter.q);
  if (filter.cursor) params.set('cursor', filter.cursor);
  return apiFetch<TenantListPage>(`/v1/admin/tenants?${params.toString()}`);
}

export function getTenant(id: string): Promise<TenantDetail> {
  return apiFetch<TenantDetail>(`/v1/admin/tenants/${id}`);
}

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export function issueKey(tenantId: string, input: NewKeyInput): Promise<NewKeyResult> {
  return postJson<NewKeyResult>(`/v1/admin/tenants/${tenantId}/keys`, input);
}

/**
 * Thu hồi/khôi phục và đổi gói dùng LẠI nhóm route billing có từ trước: chúng ghi Durable Object
 * quota và Postgres theo đúng thứ tự fail-closed (thu hồi chạm DO trước, khôi phục chạm DB trước),
 * viết route thứ hai là chép lại đúng phần khó nhất.
 *
 * Hai route này đứng sau `requireBillingAccess()`, nên tài khoản ngoài BILLING_ADMIN_EMAILS nhận
 * 403 `billing_admin_forbidden` — giao diện phải nói thẳng điều đó thay vì "không tải được".
 */
export function setKeyRevoked(
  tenantId: string,
  keyHash: string,
  revoked: boolean,
  reason: string,
  operationId: string,
): Promise<unknown> {
  return postJson(`/v1/admin/billing/${tenantId}/keys/${keyHash}/revocation`, {
    revoked,
    reason,
    operationId,
  });
}

export function setQuotaMode(tenantId: string, mode: QuotaMode): Promise<{ mode: QuotaMode }> {
  return postJson<{ mode: QuotaMode }>(`/v1/admin/billing/${tenantId}/mode`, { mode });
}
```

- [ ] **Step 4: Viết `apps/admin/src/features/tenants/hooks.ts`**

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTenant,
  issueKey,
  listTenants,
  type NewKeyInput,
  type QuotaMode,
  setKeyRevoked,
  setQuotaMode,
} from './api';

export const tenantKeys = {
  list: (q: string) => ['tenants', 'list', q] as const,
  detail: (id: string) => ['tenants', 'detail', id] as const,
};

export function useTenantList(q: string) {
  return useInfiniteQuery({
    queryKey: tenantKeys.list(q),
    queryFn: ({ pageParam }) =>
      listTenants({ ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTenantDetail(id: string | null) {
  return useQuery({
    queryKey: tenantKeys.detail(id ?? ''),
    queryFn: () => getTenant(id as string),
    enabled: id !== null,
  });
}

/** Làm mới danh sách và chi tiết sau mỗi thao tác đã gửi thật. */
function useInvalidateTenants() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['tenants'] });
  };
}

export function useIssueKey() {
  const invalidate = useInvalidateTenants();
  return useMutation({
    mutationFn: ({ tenantId, input }: { tenantId: string; input: NewKeyInput }) =>
      issueKey(tenantId, input),
    onSettled: invalidate,
  });
}

export function useSetKeyRevoked() {
  const invalidate = useInvalidateTenants();
  return useMutation({
    mutationFn: ({
      tenantId,
      keyHash,
      revoked,
      reason,
      operationId,
    }: {
      tenantId: string;
      keyHash: string;
      revoked: boolean;
      reason: string;
      operationId: string;
    }) => setKeyRevoked(tenantId, keyHash, revoked, reason, operationId),
    onSettled: invalidate,
  });
}

export function useSetQuotaMode() {
  const invalidate = useInvalidateTenants();
  return useMutation({
    mutationFn: ({ tenantId, mode }: { tenantId: string; mode: QuotaMode }) =>
      setQuotaMode(tenantId, mode),
    onSettled: invalidate,
  });
}
```

- [ ] **Step 5: Chạy lại test**

```bash
pnpm exec vitest run apps/admin/src/features/tenants/api.test.ts
```

Mong đợi: 6 test PASS.

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/admin/src/features/tenants/api.ts apps/admin/src/features/tenants/hooks.ts apps/admin/src/features/tenants/api.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): lớp gọi API cho mảng Tenant & khoá

Ba endpoint mới cộng hai route billing dùng lại, gói trong TanStack Query; danh
sách dùng useInfiniteQuery vì API phân trang bằng con trỏ.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 10 — MÀN DANH SÁCH TENANT

**Files:**
- Create: `apps/admin/src/features/tenants/tenant-card.tsx`
- Create: `apps/admin/src/features/tenants/page.tsx`
- Modify: `apps/admin/src/routes.tsx`
- Test: `apps/admin/src/features/tenants/page.test.tsx`

- [ ] **Step 1: Viết test trước**

`apps/admin/src/features/tenants/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantsPage } from './page';

const tenant = (extra: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000cc',
  name: 'Công ty Thử Nghiệm',
  plan: 'free',
  quota_mode: 'legacy',
  created_at: new Date('2026-09-01T00:00:00.000Z').toISOString(),
  active_keys: 2,
  ...extra,
});

const stubFetch = (body: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TenantsPage />
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('TenantsPage', () => {
  it('hiện tên, gói và số khoá đang hoạt động', async () => {
    stubFetch({ items: [tenant()], nextCursor: null });
    renderPage();
    expect(await screen.findByText('Công ty Thử Nghiệm')).toBeVisible();
    expect(screen.getByText('free')).toBeVisible();
    expect(screen.getByText('2 khoá')).toBeVisible();
  });

  it('không có tenant nào → trạng thái rỗng, không phải bảng trống', async () => {
    stubFetch({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText(/Không có tenant nào/)).toBeVisible();
  });

  it('403 → nói rõ là thiếu quyền chứ không phải lỗi mạng', async () => {
    stubFetch({ error: { code: 'billing_admin_forbidden', message: 'không có quyền' } }, 403);
    renderPage();
    expect(await screen.findByText(/không có quyền/i)).toBeVisible();
  });

  it('còn trang sau → có nút tải thêm; hết trang thì không', async () => {
    stubFetch({ items: [tenant()], nextCursor: '2026-09-01T00:00:00.000Z|abc' });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Tải thêm' })).toBeVisible();
  });

  it('gõ vào ô tìm thì gửi tham số q', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await userEvent.type(screen.getByLabelText('Tìm theo tên tenant'), 'thử');
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([path]) => String(path).includes('q=th'))).toBe(true),
    );
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/tenants/page.test.tsx
```

Mong đợi: FAIL — không resolve được `./page`.

- [ ] **Step 3: Viết `tenant-card.tsx`**

```tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardMuted, CardTitle } from '@/components/ui/card';
import type { Tenant } from './api';

/** Ngày tuyệt đối, không phải "3 ngày trước": tenant sống nhiều năm, ngày tạo là mốc tra cứu. */
export function tenantDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export const MODE_VI: Record<Tenant['quota_mode'], string> = {
  legacy: 'Chưa tính tiền',
  commercial: 'Thương mại',
};

export function TenantCard({ tenant, onOpen }: { tenant: Tenant; onOpen: (id: string) => void }) {
  return (
    <Card>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle>{tenant.name}</CardTitle>
          <CardMuted>Tạo ngày {tenantDate(tenant.created_at)}</CardMuted>
        </div>
        <Badge tone={tenant.quota_mode === 'commercial' ? 'brand' : 'neutral'}>
          {MODE_VI[tenant.quota_mode]}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge>{tenant.plan}</Badge>
        <Badge tone={tenant.active_keys > 0 ? 'success' : 'warning'}>
          {tenant.active_keys} khoá
        </Badge>
        <Button variant="secondary" className="ml-auto" onClick={() => onOpen(tenant.id)}>
          Xem khoá
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Viết `page.tsx`**

```tsx
import { useState } from 'react';
import { RecordView } from '@/components/data-view';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TenantDetailPanel } from './detail';
import { MODE_VI, TenantCard, tenantDate } from './tenant-card';
import { useTenantList } from './hooks';

export function TenantsPage() {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useTenantList(q);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Tìm theo tên tenant"
        aria-label="Tìm theo tên tenant"
        className="min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
      />

      {list.isPending && <LoadingSkeleton rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyState
          title="Không có tenant nào khớp"
          hint="Xoá ô tìm để xem tất cả. Tenant mới vẫn tạo bằng pnpm db:seed-tenant."
        />
      )}

      {items.length > 0 && (
        <RecordView
          items={items}
          rowKey={(tenant) => tenant.id}
          renderCard={(tenant) => <TenantCard tenant={tenant} onOpen={setOpenId} />}
          columns={[
            {
              key: 'ten',
              header: 'Tenant',
              render: (tenant) => (
                <button type="button" className="text-left" onClick={() => setOpenId(tenant.id)}>
                  <span className="font-semibold">{tenant.name}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{tenant.id}</span>
                </button>
              ),
            },
            { key: 'goi', header: 'Gói', render: (tenant) => <Badge>{tenant.plan}</Badge> },
            {
              key: 'chedo',
              header: 'Chế độ',
              render: (tenant) => (
                <Badge tone={tenant.quota_mode === 'commercial' ? 'brand' : 'neutral'}>
                  {MODE_VI[tenant.quota_mode]}
                </Badge>
              ),
            },
            {
              key: 'khoa',
              header: 'Khoá',
              render: (tenant) => (
                <Badge tone={tenant.active_keys > 0 ? 'success' : 'warning'}>
                  {tenant.active_keys} khoá
                </Badge>
              ),
            },
            {
              key: 'ngay',
              header: 'Ngày tạo',
              render: (tenant) => tenantDate(tenant.created_at),
            },
          ]}
        />
      )}

      {list.hasNextPage && (
        <Button
          variant="secondary"
          block
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
        </Button>
      )}

      <TenantDetailPanel id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
```

- [ ] **Step 5: Tạm thời để `detail.tsx` là khung rỗng để test danh sách chạy được**

Tạo `apps/admin/src/features/tenants/detail.tsx` với nội dung tối thiểu (Task 11 viết đầy đủ):

```tsx
export function TenantDetailPanel(_props: { id: string | null; onClose: () => void }) {
  return null;
}
```

- [ ] **Step 6: Thêm route `/tenants`**

Trong `apps/admin/src/routes.tsx`, thêm khai báo lazy cạnh `EditsPage`:

```tsx
const TenantsPage = lazy(() =>
  import('@/features/tenants/page').then((module) => ({ default: module.TenantsPage })),
);
```

và thêm vào mảng `children`, sau mục `edits`:

```tsx
        { path: 'tenants', element: wait(<TenantsPage />) },
```

- [ ] **Step 7: Chạy test**

```bash
pnpm exec vitest run apps/admin/src/features/tenants/page.test.tsx
```

Mong đợi: 5 test PASS.

- [ ] **Step 8: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/admin/src/features/tenants/ apps/admin/src/routes.tsx
git commit -m "$(cat <<'EOF'
feat(admin): màn danh sách Tenant & khoá API

Thẻ dưới 1024px, bảng từ 1024px; tìm theo tên và nút tải thêm theo con trỏ.
Mục điều hướng /tenants đã có sẵn từ pha 0 nên không phải sửa sidebar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 11 — NGĂN CHI TIẾT TENANT VÀ DANH SÁCH KHOÁ

**Files:**
- Create: `apps/admin/src/features/tenants/key-row.tsx`
- Modify: `apps/admin/src/features/tenants/detail.tsx`
- Test: `apps/admin/src/features/tenants/detail.test.tsx`

- [ ] **Step 1: Viết test trước**

`apps/admin/src/features/tenants/detail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelayedActionProvider } from '@/components/delayed-action';
import { TenantDetailPanel } from './detail';

const detailBody = {
  tenant: {
    id: 't1',
    name: 'Công ty Thử Nghiệm',
    plan: 'free',
    quota_mode: 'legacy',
    created_at: new Date('2026-09-01T00:00:00.000Z').toISOString(),
    active_keys: 1,
  },
  keys: [
    {
      key_hash: 'a'.repeat(64),
      key_prefix: 'mlv_live_ABCD1234',
      label: 'trang nhúng khách',
      kind: 'web',
      scopes: ['places:read'],
      allowed_origins: ['https://khach.example.com'],
      allowed_bundle_ids: [],
      quota_places_per_day: null,
      quota_directions_per_day: 500,
      active: true,
      created_at: new Date('2026-09-10T00:00:00.000Z').toISOString(),
      revoked_at: null,
    },
    {
      key_hash: 'b'.repeat(64),
      key_prefix: 'mlv_live_ZZZZ9999',
      label: 'khoá cũ',
      kind: 'server',
      scopes: ['places:read', 'edits:write'],
      allowed_origins: [],
      allowed_bundle_ids: [],
      quota_places_per_day: null,
      quota_directions_per_day: null,
      active: false,
      created_at: new Date('2026-08-01T00:00:00.000Z').toISOString(),
      revoked_at: new Date('2026-09-05T00:00:00.000Z').toISOString(),
    },
  ],
};

const stubFetch = (body: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

const renderPanel = (id: string | null) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DelayedActionProvider>
        <TenantDetailPanel id={id} onClose={vi.fn()} />
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('TenantDetailPanel', () => {
  it('id = null → không dựng gì', () => {
    const { container } = renderPanel(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('hiện tên tenant, gói và từng khoá kèm tiền tố', async () => {
    stubFetch(detailBody);
    renderPanel('t1');
    expect(await screen.findByText('Công ty Thử Nghiệm')).toBeVisible();
    expect(screen.getByText('mlv_live_ABCD1234')).toBeVisible();
    expect(screen.getByText('mlv_live_ZZZZ9999')).toBeVisible();
  });

  it('khoá còn hiệu lực có nút Thu hồi; khoá đã thu hồi có nút Khôi phục', async () => {
    stubFetch(detailBody);
    renderPanel('t1');
    expect(await screen.findByRole('button', { name: 'Thu hồi' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Khôi phục' })).toBeVisible();
  });

  it('không bao giờ hiện khoá dạng rõ — chỉ tiền tố 17 ký tự', async () => {
    stubFetch(detailBody);
    renderPanel('t1');
    await screen.findByText('mlv_live_ABCD1234');
    // DB không giữ khoá rõ, nên bất kỳ chuỗi 24 ký tự nào xuất hiện ở đây đều là lỗi logic.
    expect(document.body.textContent).not.toMatch(/mlv_live_[0-9A-Za-z]{24}/);
  });

  it('hiện origin cho phép của khoá web', async () => {
    stubFetch(detailBody);
    renderPanel('t1');
    expect(await screen.findByText('https://khach.example.com')).toBeVisible();
  });

  it('tenant chưa có khoá nào → trạng thái rỗng', async () => {
    stubFetch({ ...detailBody, keys: [] });
    renderPanel('t1');
    expect(await screen.findByText(/Tenant này chưa có khoá nào/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/tenants/detail.test.tsx
```

Mong đợi: FAIL ở test thứ hai trở đi (panel hiện là khung rỗng).

- [ ] **Step 3: Viết `key-row.tsx`**

```tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ApiKey } from './api';
import { tenantDate } from './tenant-card';

export const KIND_VI: Record<ApiKey['kind'], string> = {
  web: 'Trang web',
  mobile: 'Ứng dụng',
  server: 'Máy chủ',
};

interface KeyRowProps {
  apiKey: ApiKey;
  onRevoke: (apiKey: ApiKey, revoked: boolean) => void;
}

export function KeyRow({ apiKey, onRevoke }: KeyRowProps) {
  const song = apiKey.active && apiKey.revoked_at === null;
  return (
    <li className="rounded-[var(--radius-card)] border border-[var(--border)] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* Tiền tố là tất cả những gì hệ thống còn giữ để nhận diện một khoá — DB bỏ cột khoá
              rõ từ migration 0011. Cho phép chọn/sao chép được vì nó dùng để đối chiếu với khách. */}
          <p className="select-all font-mono text-sm font-semibold">{apiKey.key_prefix}</p>
          <p className="text-sm text-[var(--text-muted)]">{apiKey.label ?? 'Không có nhãn'}</p>
        </div>
        <Badge tone={song ? 'success' : 'danger'}>{song ? 'Đang dùng' : 'Đã thu hồi'}</Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge>{KIND_VI[apiKey.kind]}</Badge>
        {apiKey.scopes.map((scope) => (
          <Badge key={scope} tone="brand">
            {scope}
          </Badge>
        ))}
        {apiKey.quota_directions_per_day !== null && (
          <Badge tone="warning">{apiKey.quota_directions_per_day} tuyến/ngày</Badge>
        )}
      </div>

      {apiKey.allowed_origins.length > 0 && (
        <p className="mt-2 break-all text-xs text-[var(--text-muted)]">
          Origin cho phép: {apiKey.allowed_origins.join(', ')}
        </p>
      )}
      {apiKey.allowed_bundle_ids.length > 0 && (
        <p className="mt-1 break-all text-xs text-[var(--text-muted)]">
          Bundle id: {apiKey.allowed_bundle_ids.join(', ')}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">
          Cấp ngày {tenantDate(apiKey.created_at)}
          {apiKey.revoked_at ? ` · thu hồi ${tenantDate(apiKey.revoked_at)}` : ''}
        </span>
        <Button
          variant={song ? 'danger' : 'secondary'}
          className="ml-auto"
          onClick={() => onRevoke(apiKey, song)}
        >
          {song ? 'Thu hồi' : 'Khôi phục'}
        </Button>
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Viết `detail.tsx` đầy đủ**

```tsx
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ApiKey } from './api';
import { useTenantDetail } from './hooks';
import { KeyRow } from './key-row';
import { NewKeyDialog } from './new-key';
import { MODE_VI, tenantDate } from './tenant-card';

interface TenantDetailPanelProps {
  id: string | null;
  onClose: () => void;
}

/**
 * Toàn màn hình trên điện thoại, ngăn bên phải từ 1024px — cùng khuôn với ngăn chi tiết đóng góp
 * ở pha 1, nên Esc và giam tiêu điểm hành xử giống hệt.
 */
export function TenantDetailPanel({ id, onClose }: TenantDetailPanelProps) {
  const detail = useTenantDetail(id);
  const [capKhoa, setCapKhoa] = useState(false);
  if (id === null) return null;

  const onRevoke = (_apiKey: ApiKey, _revoked: boolean) => {
    // Task 13 nối thao tác thật vào đây.
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[34rem] lg:border-l lg:border-[var(--border)]">
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
            <Dialog.Title className="flex-1 text-base font-semibold">
              {detail.data?.tenant.name ?? 'Chi tiết tenant'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Đóng chi tiết tenant">
                ✕
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {detail.isPending && <LoadingSkeleton rows={3} />}
            {detail.isError && (
              <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
            )}

            {detail.data && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{detail.data.tenant.plan}</Badge>
                  <Badge tone={detail.data.tenant.quota_mode === 'commercial' ? 'brand' : 'neutral'}>
                    {MODE_VI[detail.data.tenant.quota_mode]}
                  </Badge>
                  <span className="ml-auto text-xs text-[var(--text-muted)]">
                    Tạo ngày {tenantDate(detail.data.tenant.created_at)}
                  </span>
                </div>
                <p className="select-all break-all font-mono text-xs text-[var(--text-muted)]">
                  {detail.data.tenant.id}
                </p>

                <h3 className="text-sm font-semibold">Khoá API</h3>
                {detail.data.keys.length === 0 ? (
                  <EmptyState
                    title="Tenant này chưa có khoá nào"
                    hint="Bấm “Cấp khoá mới” bên dưới — khoá sẽ hiện đúng một lần."
                  />
                ) : (
                  <ul className="space-y-3">
                    {detail.data.keys.map((apiKey) => (
                      <KeyRow key={apiKey.key_hash} apiKey={apiKey} onRevoke={onRevoke} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {detail.data && (
            <div
              className="flex gap-2 border-t border-[var(--border)] px-4 py-3"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
            >
              <Button block onClick={() => setCapKhoa(true)}>
                Cấp khoá mới
              </Button>
            </div>
          )}

          {capKhoa && detail.data && (
            <NewKeyDialog tenantId={detail.data.tenant.id} onClose={() => setCapKhoa(false)} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 5: Tạo khung tạm cho `new-key.tsx` (Task 12 viết đầy đủ)**

```tsx
export function NewKeyDialog(_props: { tenantId: string; onClose: () => void }) {
  return null;
}
```

- [ ] **Step 6: Chạy test**

```bash
pnpm exec vitest run apps/admin/src/features/tenants/
```

Mong đợi: tất cả file test của mảng tenants PASS.

- [ ] **Step 7: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/admin/src/features/tenants/
git commit -m "$(cat <<'EOF'
feat(admin): ngăn chi tiết tenant kèm danh sách khoá

Mỗi khoá hiện tiền tố, nhãn, loại, phạm vi, origin và trạng thái. Có bài kiểm
khẳng định không chuỗi 24 ký tự nào lọt ra màn này — DB không giữ khoá rõ.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 12 — HỘP THOẠI CẤP KHOÁ VÀ MÀN HIỆN KHOÁ MỘT LẦN

**Files:**
- Modify: `apps/admin/src/features/tenants/new-key.tsx`
- Test: `apps/admin/src/features/tenants/new-key.test.tsx`

- [ ] **Step 1: Viết test trước**

`apps/admin/src/features/tenants/new-key.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewKeyDialog } from './new-key';

const KEY = 'mlv_live_ABCDEFGHIJKLMNOPQRSTUVWX';

const stubIssue = () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        key: KEY,
        key_prefix: KEY.slice(0, 17),
        key_hash: 'a'.repeat(64),
        tenant_id: 't1',
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const renderDialog = (onClose = vi.fn()) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NewKeyDialog tenantId="t1" onClose={onClose} />
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('NewKeyDialog', () => {
  it('chọn loại "Trang web" thì hiện ô origin và không cho gửi khi bỏ trống', async () => {
    const fetchMock = stubIssue();
    renderDialog();
    await userEvent.type(screen.getByLabelText('Nhãn'), 'trang nhúng khách');
    await userEvent.selectOptions(screen.getByLabelText('Loại khoá'), 'web');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp khoá' }));
    expect(await screen.findByText(/bắt buộc/i)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cấp khoá máy chủ: gửi đúng thân yêu cầu', async () => {
    const fetchMock = stubIssue();
    renderDialog();
    await userEvent.type(screen.getByLabelText('Nhãn'), 'máy chủ nội bộ');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp khoá' }));
    await screen.findByText(KEY);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      label: 'máy chủ nội bộ',
      kind: 'server',
      scopes: ['places:read'],
    });
  });

  it('khoá hiện đúng một lần kèm cảnh báo rõ ràng', async () => {
    stubIssue();
    renderDialog();
    await userEvent.type(screen.getByLabelText('Nhãn'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp khoá' }));
    expect(await screen.findByText(KEY)).toBeVisible();
    expect(screen.getByText(/chỉ hiện một lần/i)).toBeVisible();
    // Không còn đường quay lại form khi khoá đã hiện: bấm cấp lần nữa là cấp khoá thứ hai.
    expect(screen.queryByRole('button', { name: 'Cấp khoá' })).not.toBeInTheDocument();
  });

  it('nút sao chép ghi đúng khoá vào clipboard', async () => {
    stubIssue();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderDialog();
    await userEvent.type(screen.getByLabelText('Nhãn'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp khoá' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sao chép khoá' }));
    expect(writeText).toHaveBeenCalledWith(KEY);
    expect(await screen.findByText('Đã sao chép')).toBeVisible();
  });

  it('lỗi từ máy chủ hiện nguyên mã lỗi, không nuốt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'invalid_request', message: 'label không được rỗng' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    renderDialog();
    await userEvent.type(screen.getByLabelText('Nhãn'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp khoá' }));
    expect(await screen.findByText(/label không được rỗng/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/tenants/new-key.test.tsx
```

Mong đợi: FAIL — không tìm thấy ô `Nhãn` (component đang trả null).

- [ ] **Step 3: Viết `new-key.tsx`**

```tsx
import * as Dialog from '@radix-ui/react-dialog';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { KeyKind, NewKeyInput, NewKeyResult } from './api';
import { useIssueKey } from './hooks';

const KINDS: { value: KeyKind; label: string; hint: string }[] = [
  { value: 'server', label: 'Máy chủ', hint: 'Gọi từ backend của khách; không kiểm origin.' },
  { value: 'web', label: 'Trang web', hint: 'Nằm công khai trong HTML — bắt buộc khai origin.' },
  { value: 'mobile', label: 'Ứng dụng', hint: 'Gọi từ app iOS/Android; có thể khai bundle id.' },
];

const field =
  'min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm';

export function NewKeyDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<KeyKind>('server');
  const [origins, setOrigins] = useState('');
  const [bundleIds, setBundleIds] = useState('');
  const [editsWrite, setEditsWrite] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [ketQua, setKetQua] = useState<NewKeyResult | null>(null);
  const [daChep, setDaChep] = useState(false);
  const issue = useIssueKey();

  const danhSach = (value: string) =>
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoi(null);
    const allowedOrigins = danhSach(origins);
    // Chặn tại chỗ trước khi gửi: máy chủ cũng chặn, nhưng bắt người dùng đợi một vòng mạng để
    // biết mình quên một ô là phí thời gian của họ.
    if (kind === 'web' && allowedOrigins.length === 0) {
      setLoi('Khoá trang web bắt buộc có ít nhất một origin, ví dụ https://khach.example.com');
      return;
    }

    const input: NewKeyInput = {
      label: label.trim(),
      kind,
      scopes: editsWrite ? ['places:read', 'edits:write'] : ['places:read'],
      ...(allowedOrigins.length > 0 ? { allowed_origins: allowedOrigins } : {}),
      ...(kind === 'mobile' && danhSach(bundleIds).length > 0
        ? { allowed_bundle_ids: danhSach(bundleIds) }
        : {}),
    };

    try {
      setKetQua(await issue.mutateAsync({ tenantId, input }));
    } catch (error) {
      // Giữ nguyên thông điệp máy chủ trả về (fetcher đã đặt nó vào AdminApiError.message):
      // "không cấp được khoá" không giúp ai sửa được gì.
      setLoi(error instanceof Error ? error.message : String(error));
    }
  };

  const sao = async () => {
    if (!ketQua) return;
    try {
      await navigator.clipboard.writeText(ketQua.key);
      setDaChep(true);
    } catch {
      // Trình duyệt từ chối clipboard (ngữ cảnh không bảo mật): khoá vẫn hiện để chọn tay.
      setDaChep(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/55" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-[70] max-h-[90vh] overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--bg)] p-4 lg:inset-0 lg:m-auto lg:h-fit lg:max-w-lg lg:rounded-[var(--radius-card)]">
          <Dialog.Title className="text-base font-semibold">
            {ketQua ? 'Khoá mới — lưu ngay' : 'Cấp khoá API mới'}
          </Dialog.Title>

          {ketQua ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-[var(--radius-btn)] bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                Khoá này <strong>chỉ hiện một lần</strong>. Máy chủ chỉ lưu bản băm, không có cách
                nào xem lại — mất thì phải cấp khoá khác và thu hồi khoá này.
              </div>
              <p className="select-all break-all rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-sm">
                {ketQua.key}
              </p>
              <div className="flex items-center gap-2">
                <Button onClick={() => void sao()}>Sao chép khoá</Button>
                {daChep && <span className="text-sm text-[var(--text-muted)]">Đã sao chép</span>}
                <Dialog.Close asChild>
                  <Button variant="secondary" className="ml-auto">
                    Tôi đã lưu
                  </Button>
                </Dialog.Close>
              </div>
            </div>
          ) : (
            <form className="mt-3 space-y-3" onSubmit={(event) => void onSubmit(event)}>
              <label className="block text-sm font-medium">
                Nhãn
                <input
                  className={`mt-1 ${field}`}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="vd: trang nhúng của khách A"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                Loại khoá
                <select
                  className={`mt-1 ${field}`}
                  value={kind}
                  onChange={(event) => setKind(event.target.value as KeyKind)}
                >
                  {KINDS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-[var(--text-muted)]">
                {KINDS.find((item) => item.value === kind)?.hint}
              </p>

              {kind === 'web' && (
                <label className="block text-sm font-medium">
                  Origin cho phép (mỗi dòng một origin)
                  <textarea
                    className="mt-1 min-h-24 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
                    value={origins}
                    onChange={(event) => setOrigins(event.target.value)}
                    placeholder={'https://khach.example.com\nhttps://*.khach.example.com'}
                  />
                </label>
              )}

              {kind === 'mobile' && (
                <label className="block text-sm font-medium">
                  Bundle id (mỗi dòng một id, có thể bỏ trống)
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
                    value={bundleIds}
                    onChange={(event) => setBundleIds(event.target.value)}
                    placeholder="vn.example.app"
                  />
                </label>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editsWrite}
                  onChange={(event) => setEditsWrite(event.target.checked)}
                />
                Cho phép gửi đóng góp POI (scope edits:write)
              </label>

              {loi && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-200">
                  {loi}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="submit" block disabled={issue.isPending}>
                  {issue.isPending ? 'Đang cấp…' : 'Cấp khoá'}
                </Button>
                <Dialog.Close asChild>
                  <Button variant="secondary" block>
                    Huỷ
                  </Button>
                </Dialog.Close>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Chạy test**

```bash
pnpm exec vitest run apps/admin/src/features/tenants/new-key.test.tsx
```

Mong đợi: 5 test PASS. Nếu ca "lỗi từ máy chủ" đỏ vì thông điệp bị nuốt, kiểm lại nhánh `catch` đang dùng `AdminApiError.message` (fetcher đã đặt sẵn thông điệp của máy chủ vào đó).

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/admin/src/features/tenants/new-key.tsx apps/admin/src/features/tenants/new-key.test.tsx
git commit -m "$(cat <<'EOF'
feat(admin): hộp thoại cấp khoá và màn hiện khoá đúng một lần

Form đổi theo loại khoá (web bắt buộc origin), khoá rõ hiện kèm cảnh báo và nút
sao chép, không có đường quay lại form sau khi đã cấp.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 13 — THU HỒI, KHÔI PHỤC VÀ ĐỔI GÓI

**Files:**
- Modify: `apps/admin/src/features/tenants/detail.tsx`
- Modify: `apps/admin/src/features/tenants/detail.test.tsx`

- [ ] **Step 1: Viết test trước**

Thêm vào `detail.test.tsx` (giữ nguyên các test cũ):

```tsx
import { act } from 'react';

/**
 * `shouldAdvanceTime: true` là bắt buộc, y như delayed-action.test.tsx: thiếu nó thì `findBy…`
 * của Testing Library chờ trên timer đã bị đóng băng và test treo tới khi hết hạn, chứ không
 * phải hỏng logic.
 */
const stubDetailFetch = () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(detailBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const daGoiThuHoi = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.some(([path]) => String(path).includes('revocation'));

describe('TenantDetailPanel — thao tác ghi', () => {
  afterEach(() => vi.useRealTimers());

  it('thu hồi đi qua toast đếm ngược 5 giây, chưa gửi gì trong lúc đếm', async () => {
    // Thu hồi làm chết ngay ứng dụng đang dùng khoá đó. 5 giây là khoảng để nhận ra bấm nhầm
    // dòng — sau khi request đã đi thì khách đã mất dịch vụ rồi, dù có khôi phục sau đó.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubDetailFetch();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel('t1');

    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }));
    expect(screen.getByRole('status').textContent).toMatch(/Đã thu hồi/);
    expect(daGoiThuHoi(fetchMock)).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(daGoiThuHoi(fetchMock)).toBe(true);
  });

  it('bấm Huỷ trong lúc đếm thì không request nào rời trình duyệt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubDetailFetch();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel('t1');

    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }));
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(daGoiThuHoi(fetchMock)).toBe(false);
  });

  it('nút đổi sang chế độ thương mại có mặt và nói rõ hệ quả', async () => {
    stubFetch(detailBody);
    renderPanel('t1');
    expect(await screen.findByRole('button', { name: /Chuyển sang thương mại/ })).toBeVisible();
    expect(screen.getByText(/bật chặn theo hạn mức ngay/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/tenants/detail.test.tsx
```

Mong đợi: ba test mới FAIL (chưa có toast, chưa có nút đổi gói).

- [ ] **Step 3: Nối thao tác thật vào `detail.tsx`**

Thêm import:

```tsx
import { useDelayedAction } from '@/components/delayed-action';
import { useSetKeyRevoked, useSetQuotaMode } from './hooks';
```

Thay thân `TenantDetailPanel` phần logic (giữ nguyên JSX khung) bằng:

```tsx
  const detail = useTenantDetail(id);
  const [capKhoa, setCapKhoa] = useState(false);
  const revoke = useSetKeyRevoked();
  const doiGoi = useSetQuotaMode();
  const { schedule } = useDelayedAction();
  if (id === null) return null;

  /**
   * `operationId` sinh MỘT lần cho mỗi lần bấm và đi cùng lệnh: route billing dùng nó để lệnh
   * lặp không thu hồi hai lần. Sinh lại lúc gửi sẽ làm mất chính tính chất đó.
   */
  const onRevoke = (apiKey: ApiKey, revoked: boolean) => {
    const operationId = crypto.randomUUID();
    schedule({
      label: revoked ? `Đã thu hồi ${apiKey.key_prefix}` : `Đã khôi phục ${apiKey.key_prefix}`,
      run: async () => {
        await revoke.mutateAsync({
          tenantId: id,
          keyHash: apiKey.key_hash,
          revoked,
          reason: revoked ? 'Thu hồi từ trang Admin' : 'Khôi phục từ trang Admin',
          operationId,
        });
      },
    });
  };

  const onDoiGoi = () => {
    const tenant = detail.data?.tenant;
    if (!tenant) return;
    const mode = tenant.quota_mode === 'commercial' ? 'legacy' : 'commercial';
    schedule({
      label:
        mode === 'commercial'
          ? `Chuyển ${tenant.name} sang thương mại`
          : `Chuyển ${tenant.name} về chưa tính tiền`,
      run: async () => {
        await doiGoi.mutateAsync({ tenantId: id, mode });
      },
    });
  };
```

Thêm nút đổi gói vào khối thông tin tenant, ngay dưới dòng hiện `tenant.id`:

```tsx
                <div className="rounded-[var(--radius-card)] border border-[var(--border)] p-3">
                  <p className="text-sm">
                    Chế độ hạn mức:{' '}
                    <strong>{MODE_VI[detail.data.tenant.quota_mode]}</strong>
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {detail.data.tenant.quota_mode === 'commercial'
                      ? 'Mọi request của tenant này đang đi qua sổ quota và bị chặn khi hết hạn mức.'
                      : 'Tenant này chưa bị tính tiền; chuyển sang thương mại sẽ bật chặn theo hạn mức ngay.'}
                  </p>
                  <Button variant="secondary" className="mt-2" onClick={onDoiGoi}>
                    {detail.data.tenant.quota_mode === 'commercial'
                      ? 'Chuyển về chưa tính tiền'
                      : 'Chuyển sang thương mại'}
                  </Button>
                </div>
```

- [ ] **Step 4: Chạy lại toàn bộ test của mảng tenants**

```bash
pnpm exec vitest run apps/admin/src/features/tenants/
```

Mong đợi: tất cả PASS.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/admin/src/features/tenants/detail.tsx apps/admin/src/features/tenants/detail.test.tsx
git commit -m "$(cat <<'EOF'
feat(admin): thu hồi/khôi phục khoá và đổi chế độ hạn mức

Cả ba thao tác đi qua toast đếm ngược 5 giây và mang operationId sinh một lần cho
mỗi lần bấm, để lệnh lặp không thu hồi hai lần.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 14 — E2E: CẤP KHOÁ THẬT RỒI DÙNG NÓ GỌI API THẬT

**Files:**
- Modify: `apps/admin/e2e/admin.spec.ts`

- [ ] **Step 1: Viết hai test e2e**

Thêm vào cuối `apps/admin/e2e/admin.spec.ts`:

```ts
const TENANT_FREE = '00000000-0000-4000-8000-0000000000cc';
const POI_ID = '01M3TEST0000000000000CAF01';

test('cấp khoá từ trang Admin rồi gọi API thật bằng chính khoá đó', async ({ page, request }) => {
  await page.goto('/admin/tenants');
  await expect(page).toHaveTitle(/Admin Page/);

  // Mở tenant free đã seed sẵn trong setup.sql.
  await page.getByLabel('Tìm theo tên tenant').fill('M4 itest free');
  await page.getByRole('button', { name: /M4 itest free/ }).first().click();
  await expect(page.getByRole('button', { name: 'Cấp khoá mới' })).toBeVisible();

  await page.getByRole('button', { name: 'Cấp khoá mới' }).click();
  await page.getByLabel('Nhãn').fill(`e2e ${Date.now()}`);
  await page.getByRole('button', { name: 'Cấp khoá' }).click();

  // Khoá rõ hiện đúng một lần, ngay trên màn hình.
  const khoa = await page.locator('p.font-mono').filter({ hasText: /^mlv_live_/ }).first().innerText();
  expect(khoa).toMatch(/^mlv_live_[0-9A-Za-z]{24}$/);

  // Bằng chứng mạnh nhất của cả pha: khoá vừa cấp gọi được API công khai ngay lập tức.
  const place = await request.get(`/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': khoa } });
  expect(place.status()).toBe(200);

  // Đóng hộp thoại rồi tải lại: chỉ còn tiền tố, khoá rõ không quay lại được.
  await page.getByRole('button', { name: 'Tôi đã lưu' }).click();
  await page.reload();
  await page.getByLabel('Tìm theo tên tenant').fill('M4 itest free');
  await page.getByRole('button', { name: /M4 itest free/ }).first().click();
  await expect(page.getByText(khoa)).toHaveCount(0);
  await expect(page.getByText(khoa.slice(0, 17)).first()).toBeVisible();
});

test('thu hồi khoá trên trang Admin làm khoá chết thật sau 5 giây', async ({ page, request }) => {
  // Cấp khoá qua API để test này không phụ thuộc test trước.
  const ACCESS = { 'Cf-Access-Jwt-Assertion': ACCESS_JWT, 'Sec-Fetch-Site': 'same-origin' };
  const cap = await (
    await request.post(`/v1/admin/tenants/${TENANT_FREE}/keys`, {
      headers: { ...ACCESS, 'content-type': 'application/json' },
      data: { label: `e2e thu hồi ${Date.now()}`, kind: 'server' },
    })
  ).json();
  expect(
    (await request.get(`/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': cap.key } })).status(),
  ).toBe(200);

  await page.goto('/admin/tenants');
  await page.getByLabel('Tìm theo tên tenant').fill('M4 itest free');
  await page.getByRole('button', { name: /M4 itest free/ }).first().click();

  const dong = page.locator('li').filter({ hasText: cap.key_prefix });
  await expect(dong).toBeVisible();
  await dong.getByRole('button', { name: 'Thu hồi' }).click();

  // Hoãn 5 giây: trong lúc đếm, khoá vẫn phải sống.
  expect(
    (await request.get(`/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': cap.key } })).status(),
  ).toBe(200);

  await page.waitForTimeout(7000);
  await expect
    .poll(
      async () =>
        (await request.get(`/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': cap.key } })).status(),
      { timeout: 15_000 },
    )
    .toBe(401);
});
```

- [ ] **Step 2: Chạy e2e**

```bash
pnpm test:admin-e2e
```

Mong đợi: toàn bộ test cũ + hai test mới PASS. Lần chạy đầu dựng harness mất 2–4 phút.

Nếu test thu hồi đỏ với 403: xem lại Task 8 Step 1 — harness phải được truyền `BILLING_ADMIN_EMAILS` có chứa `phong@e2e.local`.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/e2e/admin.spec.ts
git commit -m "$(cat <<'EOF'
test(admin): e2e cấp khoá rồi gọi API thật bằng chính khoá đó

Kèm ca thu hồi: khoá còn sống trong lúc toast đếm ngược, chết ngay sau khi lệnh
được gửi (route billing tự xoá cache KV).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 15 — CỔNG NGHIỆM THU CỤC BỘ

**Files:** không sửa file nào (trừ khi có lỗi phải vá).

- [ ] **Step 1: Bốn cổng bắt buộc**

```bash
cd /Users/dtphong/Desktop/software_business/mapsLibVN
pnpm lint
pnpm typecheck
pnpm test
pnpm test:api-db
```

Mong đợi: cả bốn xanh. `pnpm test` có chạy `pnpm --filter @mapslibvn/admin build`, nên build hỏng là chặn cả bộ.

**Tiêu chí nghiệm thu số 3** (email ngoài `BILLING_ADMIN_EMAILS` vẫn nhận 403) được chứng minh ở `pnpm test:api-db`, bằng ca cuối của `admin-tenants.itest.mjs` — **không phải** ở `apps/api/test/billing-admin.test.ts`: file đó dựng một Hono riêng và tự gán `reviewer`, nên nó không chạy qua `requireBillingAccess()` thật.

- [ ] **Step 2: Cổng quyền DB**

```bash
pnpm test:db
```

Mong đợi: `db/schema.dbtest.mjs` xanh (gồm bài `0018` của Task 1). `pipelines/poi/tests/pipeline-fixture.dbtest.mjs` đỏ vì thiếu `tippecanoe` là hiện tượng đã biết.

- [ ] **Step 3: Cổng e2e**

```bash
pnpm test:admin-e2e
```

Mong đợi: toàn bộ xanh, gồm cả các test của pha 0–1.

- [ ] **Step 4: Thử tay trên điện thoại thật (tiêu chí nghiệm thu số 2 của spec)**

```bash
pnpm dev
```

rồi mở `http://<IP máy>:5173/admin/tenants` trên điện thoại (hoặc dùng bản đã deploy ở Task 16 nếu tiện hơn) và kiểm:

- Danh sách hiện dạng **thẻ**, không phải bảng ngang cuộn.
- Mở một tenant, bấm **Cấp khoá mới**, hộp thoại trượt lên từ đáy và nút bấm được bằng ngón cái.
- Khoá hiện ra, bấm **Sao chép khoá** thấy chữ "Đã sao chép".
- Bấm **Thu hồi** rồi bấm **Huỷ** trong 5 giây: dòng khoá vẫn nguyên trạng thái "Đang dùng".
- Bật bản tối bằng nút trên thanh trên: chữ trên nền tối vẫn đọc được ở mọi thẻ.

- [ ] **Step 5: Ghi kết quả vào plan**

Đánh dấu từng gạch đầu dòng ở Step 4. Gì không đạt thì sửa rồi chạy lại Step 1.

---

# TASK 16 — TRIỂN KHAI PRODUCTION

**Thứ tự này là bắt buộc. Đảo lại đã từng làm chết API nhiều giờ.**

**Files:** không sửa mã. Ghi chứng cứ vào `docs/evidence/`.

- [ ] **Step 1: Đẩy nhánh và để CI chạy**

```bash
git push origin main
```

Mong đợi: workflow `CI`, `API tests (Places, real DB)` xanh. `Deploy API` sẽ **tự chạy** và nó tự có cổng `pnpm check:migration` — cổng đó sẽ **chặn** vì repo đã có `0018` mà production chưa. Đó là hành vi đúng, không phải lỗi.

- [ ] **Step 2: Áp migration lên DB máy chủ TRƯỚC**

Lệnh này PHONG chạy trên máy chủ (auto mode chặn máy chạy lệnh production). Gõ bằng `!`:

```bash
pnpm server:migrate
```

Mong đợi: `[db:migrate] Áp dụng 0018_api_key_insert_grant.sql …` rồi `✔ server:migrate xong`.

- [ ] **Step 3: Xác nhận DB đã sang 0018 trước khi Worker lên**

```bash
curl -s https://api.ai-solutions.io.vn/healthz/db | python3 -m json.tool
```

Mong đợi: `"schema_migration": "0018_api_key_insert_grant.sql"`. Chưa thấy thì **dừng**, đừng deploy.

- [ ] **Step 4: Cho `Deploy API` chạy lại**

Chạy lại workflow `Deploy API` (nút Re-run trên GitHub Actions, hoặc `workflow_dispatch`). Nếu Actions không dùng được, deploy tay:

```bash
cd apps/api && pnpm run deploy
```

(từ gốc repo: `pnpm deploy:api` — nó build rồi gọi wrangler với `--env production`.)

Mong đợi: `pnpm check:migration` in `[migration-gate] khớp` rồi wrangler deploy thành công.

- [ ] **Step 5: Nghiệm thu trên production — đúng nhánh mới, không chỉ `/healthz`**

Trong cửa sổ đã đăng nhập Access, mở `https://api.ai-solutions.io.vn/admin/tenants` và kiểm theo thứ tự:

1. Danh sách tenant hiện đủ tên, gói, chế độ, số khoá, ngày tạo.
2. Mở một tenant → danh sách khoá hiện **tiền tố** và **phạm vi dưới dạng thẻ rời** (không phải chuỗi `{places:read}` — nếu thấy dấu ngoặc nhọn thì `normalizeTextArray` chưa được áp ở đâu đó).
3. Cấp một khoá `server` nhãn `kiểm tra pha 2 <ngày>`, lưu khoá lại.
4. Gọi thật bằng khoá đó:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "X-Api-Key: <khoá vừa cấp>" \
  https://api.ai-solutions.io.vn/v1/places/<một poi id có thật>
```

Mong đợi `200`.

5. Thu hồi chính khoá đó trên trang, chờ hết 5 giây, gọi lại lệnh curl trên. Mong đợi `401`.
6. Kiểm nhật ký kiểm toán trên máy chủ (PHONG chạy bằng `!`):

```bash
docker exec mapslibvn-server-postgres-1 psql -U mapslibvn -d mapslibvn -c \
  "SELECT actor, action, target, created_at FROM admin_audit ORDER BY id DESC LIMIT 5"
```

Mong đợi: có dòng `tenant.key_issue` và `tenant.key_revoke`, `actor` đúng email Access của PHONG, và **không** dòng nào chứa khoá dạng rõ.

- [ ] **Step 6: Dọn khoá kiểm tra**

Khoá ở Step 5 đã bị thu hồi ở mục 5 nên không cần làm gì thêm. Nếu vì lý do nào đó chưa thu hồi, thu hồi ngay trên trang.

- [ ] **Step 7: Ghi chứng cứ**

Tạo `docs/evidence/admin/2026-09-1X-pha-2-tenant-khoa-api.md` với đúng những gì đã đo ở Step 5 (mã trạng thái thật, thời điểm, tên khoá, ba dòng audit). Rồi:

```bash
git add docs/evidence/admin/
git commit -m "$(cat <<'EOF'
docs(admin): chứng cứ nghiệm thu pha 2 trên production

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Tiêu chí hoàn thành pha 2

Đánh dấu khi tất cả đều đúng:

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:api-db`, `pnpm test:admin-e2e` xanh; `pnpm test:db` xanh ở `db/schema.dbtest.mjs`.
- [ ] `/healthz/db` báo `schema_migration` = `0018_api_key_insert_grant.sql` **trước** khi Worker mang mã pha 2 lên.
- [ ] Cấp được khoá trên trang, khoá gọi được API công khai ngay, và **không có cách nào xem lại** khoá đó.
- [ ] Thu hồi trên trang làm khoá chết thật (401), khôi phục làm nó sống lại.
- [ ] Mỗi thao tác ghi để lại đúng một dòng `admin_audit` với `actor` là email Access, và không dòng nào chứa khoá rõ.
- [ ] Email ngoài `BILLING_ADMIN_EMAILS` gọi `/v1/admin/billing/...` vẫn nhận 403 — lớp bảo vệ cũ không yếu đi.
- [ ] Trang dùng được trên điện thoại thật: cấp và thu hồi khoá bằng một tay, huỷ được trong 5 giây.
- [ ] `pnpm key:issue` từ nay chỉ còn dùng cho việc bootstrap/khôi phục, không phải việc thường ngày.

## Ngoài phạm vi pha 2

Tạo tenant mới từ web (vẫn dùng `pnpm db:seed-tenant`); sửa hạn mức `quota_places_per_day` của một khoá đã cấp; xem mức tiêu thụ theo endpoint (đó là pha 3 — Gói cước & hạn mức); phân quyền theo vai trò.

---

## Nhật ký thực thi (16/09/2026)

Task 1–15 đã xong trên nhánh `feat/admin-pha-2`. Task 0 và Task 16 cần PHONG chạy lệnh production.

**Bốn thứ plan không lường trước, đều đã sửa và có bài kiểm khoá lại:**

1. **`admin_audit.detail` ghi ra jsonb *string* double-encode** (lỗi có từ pha 0, mọi dòng nhật ký
   tới nay đều vậy). `${JSON.stringify(x)}::jsonb` khiến porsager stringify lần nữa; `edits.ts` đã
   ghi chú đúng bẫy này cho `changes` nhưng `audit.ts` thì không. Sửa bằng `sql.json()`, kèm test
   ở `apps/api/test/audit.test.ts` và khẳng định `detail.label` trong itest.

2. **Con trỏ phân trang tenant mất micro giây.** Bind cho `::timestamptz` đi qua `Date` của
   JavaScript nên `.809602` và `.809601` đều thành `.809000`, và điều kiện keyset loại sạch trang
   sau — ba tenant seed cùng transaction có `created_at` giống nhau tới micro giây nên lộ ngay.
   Sửa: con trỏ lấy chuỗi `to_char` từ Postgres, so sánh qua `::text::timestamptz`. Bài kiểm nay
   đi hết danh sách từng trang một và so với truy vấn một lần.

3. **Ngăn chi tiết là dialog modal nên nút "Huỷ" của toast không bấm được.** Radix đặt
   `pointer-events: none` cho mọi thứ ngoài dialog, tức cơ chế hoãn 5 giây mất tác dụng khi thao
   tác phát ra từ trong ngăn. Sửa: ngăn tự đóng ngay khi xếp lịch; test dùng cha giữ state thật.

4. **Harness itest/E2E chỉ build `apps/admin` khi `dist` chưa tồn tại**, nên lượt E2E đầu chạy
   trên bundle pha 1 và không có màn Tenant. Sửa: luôn build (cùng lớp lỗi với APK đóng gói bundle
   Metro cũ).

**Ngoài phạm vi, cần PHONG quyết:** `pnpm test:db` còn 2 test đỏ ở
`pipelines/poi/tests/pipeline-fixture.dbtest.mjs` vì image `mapslibvn/pipeline:local` có `pbf 4.0.2`
trong khi repo đã nâng lên `^5.1.2` và `pipelines/tiles/src/qa.mjs` dùng `PbfReader` (chỉ có ở
pbf 5). Không liên quan pha 2 (nhánh này không sửa file nào trong `pipelines/`). Chữa bằng
`pnpm image:build && pnpm image:smoke`.

**Kết quả cổng cục bộ:** `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm test` ✓ (1.636 + 384) ·
`pnpm test:api-db` ✓ (85) · `pnpm test:admin-e2e` ✓ (13) · `pnpm test:db` — `db/schema.dbtest.mjs`
✓ (12), riêng `pipeline-fixture` đỏ vì lệch image như trên.
