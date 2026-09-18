# Pha 6 — Tổng quan (`/admin`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` trở thành trang đích thật — bốn ô số liệu (đóng góp chờ duyệt · hạn mức · DB+migration · định tuyến) và năm việc gần nhất — thay cho việc nó đang trỏ tạm vào `EditsPage`.

**Architecture:** Màn hình gần như chỉ **gộp** những API đã có: `/v1/admin/edits/count` (pha 1), `/v1/admin/health` + `/v1/admin/metrics` (pha 5), `/v1/admin/audit` (pha 4). Chỉ thêm đúng một route mới `GET /v1/admin/quota-summary` cho phần phần trăm hạn mức. Mỗi ô tự chịu trạng thái tải/lỗi của mình; một API chết không làm trắng trang.

**Tech Stack:** Hono trên Cloudflare Workers · Hyperdrive/Postgres · KV · Durable Object (chỉ cho tenant commercial) · React 18 + TanStack Query + Tailwind · vitest + `@cloudflare/vitest-pool-workers` · Playwright cho E2E.

---

## Bối cảnh: bốn điều đã kiểm trong mã trước khi viết plan này

1. **`readUsage()` của Durable Object TẠO sổ quota** cho tenant chưa có. Đó chính là lý do
   `/v1/admin/billing/:id/legacy-usage` tồn tại (lời bình trong `billing-read.ts` nói thẳng: "Đọc
   route này KHÔNG tạo sổ quota"). Nên rollup **bắt buộc rẽ nhánh theo `tenant.quota_mode`**: chỉ
   tenant `commercial` mới được chạm DO. Mở trang chủ mà đẻ ra sổ quota cho tenant legacy là một
   tác dụng phụ không ai yêu cầu và rất khó lần ra sau này.
2. **Đặt route trong tiền tố `billing/` sẽ vỡ.** `billing-admin.ts` có middleware
   `routes.use('/v1/admin/billing/:tenantId/*')` kèm cổng kiểm tenant tồn tại, nên
   `/v1/admin/billing/quota-summary` sẽ bị hiểu "quota-summary" là một `:tenantId` không có thật.
   Đây đúng là lý do `GET /v1/admin/plan-catalog` phải đứng NGOÀI tiền tố billing.
3. **Cả hai nguồn đều cho ra hình dạng `{ used, limit }`**: legacy cộng bộ đếm KV theo từng khoá
   (`quota:<key_hash>:<ngày VN>:<nhóm>`, hạn mức lấy từ `api_key.quota_*_per_day`, thiếu thì
   `FREE_*_PER_DAY`), commercial lấy `GroupUsage { limit, used, reserved, credits, available }`
   từ `readUsage()`.
4. **`listAudit()` (pha 4) đang ghi cứng `limit: '25'`** trong `apps/admin/src/features/audit/api.ts`.
   Tổng quan cần 5 dòng, nên hàm đó phải nhận thêm tham số `limit` — sửa tại chỗ, KHÔNG viết hàm
   thứ hai gọi cùng endpoint.

Hai quyết định của PHONG ngày 18/09/2026:

- Ô hạn mức lấy **số lượt 429 trong 24 giờ làm số chính** (dùng lại đúng ô cache 5 phút của
  `/v1/admin/metrics?window=24h` mà màn Sức khoẻ đã tạo → không tốn thêm truy vấn Analytics nào)
  và **phần trăm hạn mức cao nhất làm dòng phụ**.
- Hai ô DB/định tuyến **dùng chung khoá cache React Query với màn Sức khoẻ**, `staleTime` 60 giây
  ở Tổng quan. Vào trang đích lần đầu thì đo thật; mở lại trong 60 giây thì dùng lại. Bấm sang
  `/admin/health` vẫn LUÔN đo lại vì màn đó để `staleTime: 0`.

## Cấu trúc file

**Tạo mới**

| File | Trách nhiệm |
|---|---|
| `apps/api/src/billing/legacy-usage.ts` | Hàm dùng chung: đọc bộ đếm KV của một tenant → `{ places, directions }` |
| `apps/api/src/routes/admin-quota-summary.ts` | Route `GET /v1/admin/quota-summary` + hàm thuần `phanTram()` |
| `apps/api/test/admin-quota-summary.test.ts` | Test route (cổng quyền + hai nhánh quota_mode) |
| `apps/api/test-db/admin-quota-summary.itest.mjs` | Test qua DB thật |
| `apps/admin/src/features/overview/api.ts` | Kiểu dữ liệu + lời gọi `getQuotaSummary()` |
| `apps/admin/src/features/overview/hooks.ts` | `useQuotaSummary()` |
| `apps/admin/src/features/overview/tile.tsx` | Một ô số liệu: tiêu đề, số lớn, dòng phụ, liên kết |
| `apps/admin/src/features/overview/tile.test.tsx` | Test ô (tải, lỗi, không có quyền) |
| `apps/admin/src/features/overview/page.tsx` | Màn hình Tổng quan |
| `apps/admin/src/features/overview/page.test.tsx` | Test màn hình |

**Sửa**

| File | Sửa gì |
|---|---|
| `apps/api/src/routes/billing-read.ts` | Dùng hàm chung `legacyUsageForTenant()` thay đoạn đọc KV tại chỗ |
| `apps/api/src/index.ts` | Mount route mới sau `requireBillingAccess()` |
| `apps/admin/src/features/audit/api.ts` | `listAudit(filter, limit = 25)` |
| `apps/admin/src/features/health/hooks.ts` | `useHealth({ staleTime })`, mặc định 0 |
| `apps/admin/src/routes.tsx` | `index` trỏ `OverviewPage` |
| `apps/admin/src/routes.test.tsx` | Lật bài "hai đường dẫn giống nhau" thành "khác nhau" |

**Không có migration.** Máy chủ giữ `0019`.

---

### Task 1: Hàm chung đọc bộ đếm KV của một tenant

**Files:**
- Create: `apps/api/src/billing/legacy-usage.ts`
- Modify: `apps/api/src/routes/billing-read.ts`

Hiện đoạn đọc KV nằm ngay trong handler `/legacy-usage`. Rollup của Tổng quan cần đúng phép tính
đó; chép lại là dựng sẵn hai bản sẽ trôi khỏi nhau.

- [ ] **Step 1: Viết hàm chung**

Tạo `apps/api/src/billing/legacy-usage.ts`:

```ts
import type { Env } from '../env';
import { FREE_DIRECTIONS_PER_DAY, FREE_PLACES_PER_DAY, vnDay } from '../quota';

export interface KhoaQuota {
  key_hash: string;
  key_prefix: string;
  label: string | null;
  quota_places_per_day: number | null;
  quota_directions_per_day: number | null;
}

export interface MucDungNhom {
  used: number;
  limit: number;
}

export interface MucDungKhoa {
  keyPrefix: string;
  label: string | null;
  places: MucDungNhom;
  directions: MucDungNhom;
}

/**
 * Mức dùng HÔM NAY (theo ngày VN) của tenant chưa bật chế độ thương mại, đọc từ bộ đếm xấp xỉ
 * trong KV. KHÔNG chạm Durable Object: `readUsage()` sẽ TẠO sổ quota cho tenant chưa có, và một
 * lần mở trang quản trị không được phép đẻ ra sổ cho tenant legacy.
 */
export async function legacyUsageForKeys(
  env: Env,
  keys: readonly KhoaQuota[],
): Promise<{ day: string; keys: MucDungKhoa[]; total: { places: MucDungNhom; directions: MucDungNhom } }> {
  const day = vnDay();
  const items = await Promise.all(
    keys.map(async (key) => {
      const [places, directions] = await Promise.all([
        env.META.get(`quota:${key.key_hash}:${day}:places`),
        env.META.get(`quota:${key.key_hash}:${day}:directions`),
      ]);
      return {
        keyPrefix: key.key_prefix,
        label: key.label,
        places: {
          used: Number(places ?? 0),
          limit: key.quota_places_per_day ?? FREE_PLACES_PER_DAY,
        },
        directions: {
          used: Number(directions ?? 0),
          limit: key.quota_directions_per_day ?? FREE_DIRECTIONS_PER_DAY,
        },
      };
    }),
  );
  const cong = (group: 'places' | 'directions'): MucDungNhom => ({
    used: items.reduce((tong, item) => tong + item[group].used, 0),
    limit: items.reduce((tong, item) => tong + item[group].limit, 0),
  });
  return { day, keys: items, total: { places: cong('places'), directions: cong('directions') } };
}
```

- [ ] **Step 2: `/legacy-usage` gọi hàm chung**

Trong `apps/api/src/routes/billing-read.ts`, thay từ `const day = vnDay();` tới hết phần dựng
`items` + `cong` bằng:

```ts
      const { day, keys: items, total } = await legacyUsageForKeys(c.env, keys);
```

và đổi phần trả về để dùng `total` thay cho `cong(...)`:

```ts
          keys: items,
          total,
```

Thêm import:

```ts
import { legacyUsageForKeys } from '../billing/legacy-usage';
```

Xoá khỏi dòng import `../quota` những tên không còn dùng trong file (kiểm bằng
`grep -n "FREE_PLACES_PER_DAY\|FREE_DIRECTIONS_PER_DAY\|vnDay" apps/api/src/routes/billing-read.ts`
trước khi xoá — nếu còn chỗ khác dùng thì giữ nguyên).

- [ ] **Step 3: Chạy test sẵn có của billing để chứng minh không đổi hành vi**

Run: `cd apps/api && pnpm exec vitest run test/billing-read.test.ts`
Expected: PASS — đây là lưới an toàn cho việc tách hàm.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/billing/legacy-usage.ts apps/api/src/routes/billing-read.ts
git commit -m "refactor(api): tách legacyUsageForKeys() dùng chung"
```

---

### Task 2: Hàm thuần `phanTram()`

**Files:**
- Create: `apps/api/src/routes/admin-quota-summary.ts` (phần đầu)
- Test: `apps/api/test/admin-quota-summary.test.ts` (phần đầu)

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/api/test/admin-quota-summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { phanTram } from '../src/routes/admin-quota-summary';

describe('phanTram', () => {
  it('lấy nhóm dùng nhiều hơn trong hai nhóm', () => {
    expect(phanTram({ used: 10, limit: 100 }, { used: 80, limit: 100 })).toBe(80);
  });

  it('hạn mức 0 KHÔNG phải 100% và cũng không phải NaN', () => {
    // Tenant `internal` cố ý không đếm lượt, và một khoá có thể có hạn mức 0. Chia cho 0 ra
    // Infinity, `toFixed` ra "Infinity", và ô số liệu hiện chữ đó trên trang chủ.
    expect(phanTram({ used: 0, limit: 0 }, { used: 0, limit: 0 })).toBe(0);
  });

  it('vượt hạn mức thì cắt ở 100, không hiện 340%', () => {
    expect(phanTram({ used: 340, limit: 100 }, { used: 0, limit: 100 })).toBe(100);
  });

  it('làm tròn về số nguyên', () => {
    expect(phanTram({ used: 1, limit: 3 }, { used: 0, limit: 3 })).toBe(33);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `cd apps/api && pnpm exec vitest run test/admin-quota-summary.test.ts`
Expected: FAIL — `Cannot find module '../src/routes/admin-quota-summary'`

- [ ] **Step 3: Viết hàm**

Tạo `apps/api/src/routes/admin-quota-summary.ts`:

```ts
import type { MucDungNhom } from '../billing/legacy-usage';

/**
 * Phần trăm hạn mức ngày đã dùng, lấy nhóm cao hơn trong hai nhóm. Cắt ở 100 và coi hạn mức 0 là
 * 0%: tenant `internal` cố ý không đếm lượt, chia cho 0 ra Infinity và ô số liệu sẽ hiện chữ đó.
 */
export function phanTram(places: MucDungNhom, directions: MucDungNhom): number {
  const mot = (g: MucDungNhom) => (g.limit > 0 ? Math.min(100, (g.used / g.limit) * 100) : 0);
  return Math.round(Math.max(mot(places), mot(directions)));
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `cd apps/api && pnpm exec vitest run test/admin-quota-summary.test.ts`
Expected: PASS — 4 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-quota-summary.ts apps/api/test/admin-quota-summary.test.ts
git commit -m "feat(api): hàm thuần tính phần trăm hạn mức"
```

---

### Task 3: Route `GET /v1/admin/quota-summary`

**Files:**
- Modify: `apps/api/src/routes/admin-quota-summary.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/admin-quota-summary.test.ts`

- [ ] **Step 1: Viết test đỏ cho cổng quyền**

Thêm vào cuối `apps/api/test/admin-quota-summary.test.ts`:

```ts
import { SELF } from 'cloudflare:test';

describe('GET /v1/admin/quota-summary — cổng vào', () => {
  it('thiếu JWT Access → không bao giờ là 200', async () => {
    // Mức tiêu thụ của khách là dữ liệu kinh doanh: nó nói khách nào đang dùng bao nhiêu.
    const response = await SELF.fetch('https://api/v1/admin/quota-summary');
    expect(response.status).not.toBe(200);
    expect([401, 403]).toContain(response.status);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `cd apps/api && pnpm exec vitest run test/admin-quota-summary.test.ts`
Expected: FAIL — nhận 404 vì route chưa tồn tại (404 không nằm trong `[401, 403]`).

- [ ] **Step 3: Viết route**

Thêm vào `apps/api/src/routes/admin-quota-summary.ts`:

```ts
import { Hono } from 'hono';
import { quotaObject } from '../billing/object';
import { legacyUsageForKeys } from '../billing/legacy-usage';
import type { KhoaQuota, MucDungNhom } from '../billing/legacy-usage';
import { cachedJson } from '../cache';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';

type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

/** Trần tenant đọc trong một lần. Trang đích không phải chỗ quét cả cơ sở khách hàng. */
const MAX_TENANTS = 25;
/** Ngưỡng "đáng chú ý" của phần trăm hạn mức. */
export const NGUONG_CANH_BAO = 80;
const CACHE_SEC = 60;
const CACHE_URL = 'https://cache.mapslibvn/admin-quota-summary';

interface TenantRow {
  id: string;
  name: string;
  quota_mode: 'legacy' | 'commercial';
}

async function docTenant(env: Env, ctx: WaitUntil): Promise<{ rows: TenantRow[]; truncated: boolean }> {
  const sql = getSql(env);
  try {
    const rows = await sql<TenantRow[]>`
      SELECT t.id::text AS id, t.name,
             -- to_jsonb thay vì tham chiếu cột: Postgres phân giải cột ngay lúc parse, nên Worker
             -- deploy trước một migration thêm cột sẽ làm hỏng CẢ câu (sự cố 06/09/2026).
             coalesce(to_jsonb(t) ->> 'quota_mode', 'legacy') AS quota_mode
      FROM tenant t
      ORDER BY t.created_at DESC
      LIMIT ${MAX_TENANTS + 1}`;
    return { rows: rows.slice(0, MAX_TENANTS), truncated: rows.length > MAX_TENANTS };
  } finally {
    endSql(ctx, sql);
  }
}

async function khoaCuaTenant(env: Env, ctx: WaitUntil, tenantId: string): Promise<KhoaQuota[]> {
  const sql = getSql(env);
  try {
    return await sql<KhoaQuota[]>`
      SELECT k.key_hash, k.key_prefix, k.label, k.quota_places_per_day,
             (to_jsonb(k) ->> 'quota_directions_per_day')::int AS quota_directions_per_day
      FROM api_key k
      WHERE k.tenant_id = ${tenantId}::uuid AND k.active AND k.revoked_at IS NULL
      ORDER BY k.created_at
      LIMIT 50`;
  } finally {
    endSql(ctx, sql);
  }
}

async function mucDung(
  env: Env,
  ctx: WaitUntil,
  tenant: TenantRow,
): Promise<{ places: MucDungNhom; directions: MucDungNhom }> {
  if (tenant.quota_mode === 'commercial') {
    const usage = await quotaObject(env, tenant.id).readUsage();
    return {
      places: { used: usage.places.used, limit: usage.places.limit },
      directions: { used: usage.directions.used, limit: usage.directions.limit },
    };
  }
  // Nhánh legacy KHÔNG được chạm Durable Object: readUsage() tạo sổ quota cho tenant chưa có, và
  // mở trang chủ không phải lý do để đẻ ra sổ.
  const keys = await khoaCuaTenant(env, ctx, tenant.id);
  const { total } = await legacyUsageForKeys(env, keys);
  return total;
}

export const adminQuotaSummary = new Hono<AppEnv>();

adminQuotaSummary.get('/v1/admin/quota-summary', async (c) => {
  const response = await cachedJson(c.executionCtx, CACHE_URL, CACHE_SEC, CACHE_SEC, async () => {
    const { rows, truncated } = await docTenant(c.env, c.executionCtx);
    const items = await Promise.all(
      rows.map(async (tenant) => {
        try {
          const { places, directions } = await mucDung(c.env, c.executionCtx, tenant);
          return {
            tenant_id: tenant.id,
            name: tenant.name,
            quota_mode: tenant.quota_mode,
            places,
            directions,
            pct: phanTram(places, directions),
          };
        } catch (error) {
          // Một tenant hỏng sổ không được làm mất số của những tenant còn lại.
          console.error('quota-summary tenant', tenant.id, error);
          return null;
        }
      }),
    );
    const tenants = items.filter((item) => item !== null);
    return {
      computed_at: new Date().toISOString(),
      truncated,
      tenants: tenants.sort((a, b) => b.pct - a.pct),
      above: tenants.filter((t) => t.pct >= NGUONG_CANH_BAO).length,
    };
  }).catch((error: unknown) => {
    if (error instanceof ApiError) throw error;
    console.error('admin/quota-summary', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đọc được mức dùng hạn mức');
  });

  const out = new Response(response.body, response);
  // cachedJson lưu bằng `public, max-age` (bắt buộc, nếu không Cache API không nhận). Đổi lại SAU
  // khi đã put, nếu không số liệu khách hàng nằm trong cache trình duyệt.
  out.headers.set('cache-control', 'private, no-store');
  return out;
});
```

- [ ] **Step 4: Mount sau cổng billing**

Trong `apps/api/src/index.ts`, ngay **dưới** dòng `app.route('/', billingAdmin());` (chỗ
`requireSameSitePost()` và `requireBillingAccess()` đã được khai cho tiền tố billing), thêm:

```ts
// Mức tiêu thụ của khách là cùng loại dữ liệu mà nhóm billing đang bảo vệ, nên route này chịu
// đúng cổng đó. Đặt NGOÀI tiền tố `/v1/admin/billing/` vì trong đó có middleware coi đoạn đầu là
// `:tenantId` và sẽ trả 404 cho một đường dẫn tĩnh — đúng lý do `plan-catalog` cũng đứng ngoài.
app.use('/v1/admin/quota-summary', requireSameSitePost());
app.use('/v1/admin/quota-summary', requireBillingAccess());
app.route('/', adminQuotaSummary);
```

Thêm import:

```ts
import { adminQuotaSummary } from './routes/admin-quota-summary';
```

- [ ] **Step 5: Chạy test**

Run: `cd apps/api && pnpm exec vitest run test/admin-quota-summary.test.ts`
Expected: PASS — 5 test (4 hàm thuần + 1 cổng vào).

- [ ] **Step 6: Chạy cả bộ api**

Run: `cd apps/api && pnpm test`
Expected: PASS toàn bộ.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin-quota-summary.ts apps/api/src/index.ts apps/api/test/admin-quota-summary.test.ts
git commit -m "feat(api): GET /v1/admin/quota-summary cho ô hạn mức của Tổng quan"
```

---

### Task 4: itest qua DB thật

**Files:**
- Create: `apps/api/test-db/admin-quota-summary.itest.mjs`

- [ ] **Step 1: Viết itest**

Tạo `apps/api/test-db/admin-quota-summary.itest.mjs`:

```js
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

// `phong@access-fake.local` là email nằm trong BILLING_ADMIN_EMAILS của hạ tầng itest.
const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path) => fetch(base + path, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });

describe('GET /v1/admin/quota-summary — DB thật', () => {
  it('trả về từng tenant kèm phần trăm, sắp xếp cao xuống thấp', async () => {
    const response = await adminFetch('/v1/admin/quota-summary');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.tenants)).toBe(true);
    expect(body.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const t of body.tenants) {
      expect(typeof t.name).toBe('string');
      expect(t.pct).toBeGreaterThanOrEqual(0);
      expect(t.pct).toBeLessThanOrEqual(100);
    }
    const pcts = body.tenants.map((t) => t.pct);
    expect([...pcts].sort((a, b) => b - a)).toEqual(pcts);
  });

  it('KHÔNG tạo sổ quota cho tenant legacy chỉ vì có người mở trang chủ', async () => {
    // Đây là điều dễ hỏng nhất của route này và không tầng test nào khác bắt được: `readUsage()`
    // tạo sổ Durable Object cho tenant chưa có. Cách kiểm gián tiếp mà chắc chắn: tenant legacy
    // phải có mặt trong kết quả với hạn mức lấy từ api_key (KV), và route trả về trong thời gian
    // của một lượt đọc KV chứ không phải của một lượt dựng DO.
    const [legacy] = await sql`SELECT id::text, name FROM tenant
      WHERE coalesce(to_jsonb(tenant) ->> 'quota_mode', 'legacy') = 'legacy' LIMIT 1`;
    if (!legacy) return; // Hạ tầng seed không có tenant legacy thì không có gì để kiểm.

    const body = await (await adminFetch('/v1/admin/quota-summary')).json();
    const dong = body.tenants.find((t) => t.tenant_id === legacy.id);
    expect(dong).toBeDefined();
    expect(dong.quota_mode).toBe('legacy');
    expect(typeof dong.places.limit).toBe('number');
  });

  it('cache 60 giây: lượt thứ hai trả đúng cùng mốc computed_at', async () => {
    const mot = await (await adminFetch('/v1/admin/quota-summary')).json();
    const hai = await (await adminFetch('/v1/admin/quota-summary')).json();
    expect(hai.computed_at).toBe(mot.computed_at);
  });
});
```

- [ ] **Step 2: Chạy**

Run: `pnpm test:api-db`
Expected: PASS — gồm 3 test mới.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test-db/admin-quota-summary.itest.mjs
git commit -m "test(api): itest quota-summary qua DB thật"
```

---

### Task 5: Hai sửa nhỏ ở giao diện để dùng lại được

**Files:**
- Modify: `apps/admin/src/features/audit/api.ts`
- Modify: `apps/admin/src/features/health/hooks.ts`

- [ ] **Step 1: `listAudit` nhận `limit`**

Trong `apps/admin/src/features/audit/api.ts`, đổi hàm cuối file:

```ts
export function listAudit(filter: AuditFilter, limit = 25): Promise<AuditPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  for (const [ten, gia] of Object.entries(filter)) {
    if (gia) params.set(ten, gia);
  }
  return apiFetch<AuditPage>(`/v1/admin/audit?${params.toString()}`);
}
```

- [ ] **Step 2: `useHealth` nhận `staleTime`**

Trong `apps/admin/src/features/health/hooks.ts`, đổi `useHealth`:

```ts
/**
 * Trạng thái sống KHÔNG cache phía client ở màn Sức khoẻ: mở màn hình là đo lại. Máy chủ định
 * tuyến là máy Mac ở nhà — nó ngủ là routing chết, và một ảnh chụp cũ 5 phút đúng lúc đó là câu
 * trả lời sai.
 *
 * Tổng quan truyền `staleTime: 60_000` vì nó là TRANG ĐÍCH, mở mỗi lần vào: mỗi lượt mở là một
 * lời gọi Valhalla thật. Hai màn dùng chung một khoá cache, nên sang màn Sức khoẻ vẫn đo lại
 * (observer ở đó để staleTime 0), còn quay về trang đích trong một phút thì không đo lại nữa.
 */
export function useHealth(options: { staleTime?: number } = {}) {
  return useQuery({
    queryKey: healthKeys.health,
    queryFn: getHealth,
    staleTime: options.staleTime ?? 0,
    retry: false,
  });
}
```

- [ ] **Step 3: Chạy test của hai màn đã có**

Run: `pnpm exec vitest run apps/admin/src/features/health apps/admin/src/features/audit`
Expected: PASS — không đổi hành vi mặc định.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/audit/api.ts apps/admin/src/features/health/hooks.ts
git commit -m "refactor(admin): listAudit nhận limit, useHealth nhận staleTime"
```

---

### Task 6: Ô số liệu

**Files:**
- Create: `apps/admin/src/features/overview/tile.tsx`
- Test: `apps/admin/src/features/overview/tile.test.tsx`

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/admin/src/features/overview/tile.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { O } from './tile';

const mo = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('Ô số liệu', () => {
  it('đang tải thì KHÔNG hiện số 0', () => {
    // Hiện 0 lúc chưa biết là nói dối: "không có đóng góp nào chờ" khác hẳn "chưa biết".
    mo(<O ten="Chờ duyệt" den="/edits" dangTai />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Đang tải')).toBeVisible();
  });

  it('lỗi thì nói là lỗi, không hiện số cũ', () => {
    mo(<O ten="Chờ duyệt" den="/edits" loi />);
    expect(screen.getByText(/không đọc được/i)).toBeVisible();
  });

  it('có số thì hiện số, dòng phụ và liên kết sang mảng tương ứng', () => {
    mo(<O ten="Chờ duyệt" den="/edits" so={7} phu="3 việc hôm nay" />);
    expect(screen.getByText('7')).toBeVisible();
    expect(screen.getByText('3 việc hôm nay')).toBeVisible();
    expect(screen.getByRole('link', { name: /Chờ duyệt/ })).toHaveAttribute('href', '/edits');
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm exec vitest run apps/admin/src/features/overview/tile.test.tsx`
Expected: FAIL — `Failed to resolve import "./tile"`

- [ ] **Step 3: Viết ô**

Tạo `apps/admin/src/features/overview/tile.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { LoadingSkeleton } from '@/components/states';
import { Card, CardMuted, CardTitle } from '@/components/ui/card';

export interface OProps {
  ten: string;
  den: string;
  so?: ReactNode;
  phu?: ReactNode;
  dangTai?: boolean;
  loi?: boolean;
}

/**
 * Một ô số liệu của Tổng quan. Ba trạng thái tách bạch, và ô nào cũng tự chịu trạng thái của
 * mình: một API chết chỉ làm hỏng ô của nó, không làm trắng trang đích.
 *
 * Lúc đang tải KHÔNG hiện 0. "Không có đóng góp nào chờ duyệt" và "chưa biết có bao nhiêu" là hai
 * câu trả lời khác hẳn nhau, và cái sai ở đây khiến người trực bỏ qua việc cần làm.
 */
export function O({ ten, den, so, phu, dangTai, loi }: OProps) {
  return (
    <Card interactive>
      <CardTitle>
        {/* Link thật phủ cả thẻ: bàn phím và trình đọc màn hình tới được, và người dùng xem trước
            được đích đến ở thanh trạng thái trình duyệt. */}
        <Link to={den} className="after:absolute after:inset-0 after:content-['']">
          {ten}
        </Link>
      </CardTitle>
      {dangTai && <LoadingSkeleton rows={1} />}
      {!dangTai && loi && <CardMuted>Không đọc được số liệu</CardMuted>}
      {!dangTai && !loi && (
        <>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{so}</p>
          {phu && <CardMuted>{phu}</CardMuted>}
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `pnpm exec vitest run apps/admin/src/features/overview/tile.test.tsx`
Expected: PASS — 3 test.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/overview/tile.tsx apps/admin/src/features/overview/tile.test.tsx
git commit -m "feat(admin): ô số liệu cho Tổng quan"
```

---

### Task 7: Lời gọi và hook của Tổng quan

**Files:**
- Create: `apps/admin/src/features/overview/api.ts`
- Create: `apps/admin/src/features/overview/hooks.ts`

- [ ] **Step 1: Viết `api.ts`**

```ts
import { apiFetch } from '@/lib/fetcher';

export interface MucDungNhom {
  used: number;
  limit: number;
}

export interface DongQuota {
  tenant_id: string;
  name: string;
  quota_mode: 'legacy' | 'commercial';
  places: MucDungNhom;
  directions: MucDungNhom;
  /** Nhóm dùng nhiều hơn trong hai nhóm, đã cắt ở 100 và làm tròn. */
  pct: number;
}

export interface QuotaSummary {
  computed_at: string;
  truncated: boolean;
  tenants: DongQuota[];
  /** Số tenant từ 80% trở lên. */
  above: number;
}

export const getQuotaSummary = (): Promise<QuotaSummary> =>
  apiFetch<QuotaSummary>('/v1/admin/quota-summary');
```

- [ ] **Step 2: Viết `hooks.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { getQuotaSummary } from './api';

export const overviewKeys = {
  quota: ['overview', 'quota-summary'] as const,
};

/**
 * `retry: false` để một lần 403 (email không nằm trong BILLING_ADMIN_EMAILS) không bị thử lại ba
 * lần; màn hình chỉ cần biết ngay là không được xem phần này.
 */
export function useQuotaSummary() {
  return useQuery({
    queryKey: overviewKeys.quota,
    queryFn: getQuotaSummary,
    staleTime: 60_000,
    retry: false,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/admin && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/overview/api.ts apps/admin/src/features/overview/hooks.ts
git commit -m "feat(admin): lời gọi và hook cho Tổng quan"
```

---

### Task 8: Màn hình Tổng quan

**Files:**
- Create: `apps/admin/src/features/overview/page.tsx`
- Test: `apps/admin/src/features/overview/page.test.tsx`

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/admin/src/features/overview/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from './page';

const ME = { email: 'phong@test.invalid', permissions: ['edits.read', 'billing.read', 'health.read', 'audit.read'] };
const HEALTH = {
  checked_at: '2026-09-18T10:00:00.000Z',
  db: { ok: true, ms: 120, user: 'api', version: 'PostgreSQL 16.4', word_similarity_threshold: 0.6, schema_migration: '0019_x' },
  routing: { ok: false, ms: 6001, error: 'Dịch vụ chỉ đường không phản hồi' },
  data: { ok: true, ms: 12, tiles: 'vn-1', poi: 'poi-1', updated_at: null },
};
const METRICS = {
  computed_at: '2026-09-18T09:58:00.000Z',
  routes: [],
  tenants: [{ tenant_id: 't1', ten: 'Phong_Admin', requests: 1267, errors_5xx: 0, quota_429: 43, p95_ms: 900 }],
};
const QUOTA = {
  computed_at: '2026-09-18T09:59:00.000Z',
  truncated: false,
  above: 0,
  tenants: [{ tenant_id: 't1', name: 'Phong_Admin', quota_mode: 'legacy', places: { used: 62, limit: 100 }, directions: { used: 0, limit: 100 }, pct: 62 }],
};
const AUDIT = {
  items: [
    { id: '10', actor: 'phong@test.invalid', action: 'edit.approve', target: '7', detail: null, created_at: '2026-09-18T09:00:00.000Z' },
  ],
  nextCursor: null,
};

function mo(override: (url: string) => Response | null = () => null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const rieng = override(url);
      if (rieng) return rieng;
      if (url.includes('/v1/admin/me')) return new Response(JSON.stringify(ME));
      if (url.includes('/v1/admin/edits/count')) return new Response(JSON.stringify({ pending: 7 }));
      if (url.includes('/v1/admin/health')) return new Response(JSON.stringify(HEALTH));
      if (url.includes('/v1/admin/metrics')) return new Response(JSON.stringify(METRICS));
      if (url.includes('/v1/admin/quota-summary')) return new Response(JSON.stringify(QUOTA));
      return new Response(JSON.stringify(AUDIT));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OverviewPage', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', undefined));
  afterEach(() => vi.unstubAllGlobals());

  it('bốn ô và năm việc gần nhất', async () => {
    mo();
    expect(await screen.findByText('7')).toBeVisible();
    expect(screen.getByRole('link', { name: /Đóng góp chờ duyệt/ })).toHaveAttribute('href', '/edits');
    expect(await screen.findByText('43')).toBeVisible();
    expect(await screen.findByText(/Phong_Admin 62%/)).toBeVisible();
    expect(await screen.findByText('edit.approve')).toBeVisible();
  });

  it('định tuyến hỏng hiện ngay trên trang đích, không phải chờ vào màn Sức khoẻ', async () => {
    mo();
    expect(await screen.findByText(/Hỏng/)).toBeVisible();
  });

  it('403 ở ô hạn mức chỉ làm hỏng ô đó, ba ô kia vẫn có số', async () => {
    // Email ngoài BILLING_ADMIN_EMAILS nhận 403 ở quota-summary. Trang đích không được trắng vì
    // một người không có quyền xem doanh thu.
    mo((url) =>
      url.includes('/v1/admin/quota-summary')
        ? new Response(JSON.stringify({ error: { code: 'forbidden', message: 'x' } }), { status: 403 })
        : null,
    );
    expect(await screen.findByText('7')).toBeVisible();
    expect(await screen.findByText(/không đọc được/i)).toBeVisible();
  });

  it('gọi audit với limit=5, không phải 25', async () => {
    mo();
    await screen.findByText('edit.approve');
    const goi = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => String(c[0]),
    );
    expect(goi.some((u) => u.includes('/v1/admin/audit') && u.includes('limit=5'))).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm exec vitest run apps/admin/src/features/overview/page.test.tsx`
Expected: FAIL — `Failed to resolve import "./page"`

- [ ] **Step 3: Viết màn hình**

Tạo `apps/admin/src/features/overview/page.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { listAudit } from '@/features/audit/api';
import { gioNgay } from '@/features/audit/page';
import { useHealth, useMetrics } from '@/features/health/hooks';
import { usePendingCount } from '@/features/edits/hooks';
import { can, useMe } from '@/lib/permissions';
import { useQuotaSummary } from './hooks';
import { O } from './tile';

/** Năm việc gần nhất, dùng lại đúng lời gọi của Nhật ký kiểm toán. */
function useVietGanNhat() {
  return useQuery({
    queryKey: ['overview', 'audit-5'],
    queryFn: () => listAudit({}, 5),
    staleTime: 60_000,
    retry: false,
  });
}

export function OverviewPage() {
  const { data: me } = useMe();
  const pending = usePendingCount();
  // Trang đích mở mỗi lần vào, nên 60 giây: mỗi lượt đo là một lời gọi Valhalla thật. Màn Sức khoẻ
  // dùng CHUNG khoá cache này nhưng để staleTime 0, nên vào đó vẫn luôn đo lại.
  const health = useHealth({ staleTime: 60_000 });
  const metrics = useMetrics('24h');
  const quota = useQuotaSummary();
  const viec = useVietGanNhat();

  const tong429 = metrics.data?.tenants.reduce((tong, t) => tong + t.quota_429, 0);
  const caoNhat = quota.data?.tenants[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {can(me, 'edits.read') && (
          <O
            ten="Đóng góp chờ duyệt"
            den="/edits"
            dangTai={pending.isPending}
            loi={pending.isError}
            so={pending.data?.pending}
          />
        )}
        {can(me, 'billing.read') && (
          <O
            ten="Lượt bị chặn vì hạn mức"
            den="/billing"
            dangTai={metrics.isPending}
            loi={metrics.isError || quota.isError}
            so={tong429}
            phu={
              caoNhat ? `${caoNhat.name} ${caoNhat.pct}% hạn mức hôm nay` : 'trong 24 giờ qua'
            }
          />
        )}
        {can(me, 'health.read') && (
          <O
            ten="Cơ sở dữ liệu"
            den="/health"
            dangTai={health.isPending}
            loi={health.isError}
            so={<Badge tone={health.data?.db.ok ? 'success' : 'danger'}>{health.data?.db.ok ? 'Bình thường' : 'Hỏng'}</Badge>}
            phu={health.data?.db.ok ? health.data.db.schema_migration : undefined}
          />
        )}
        {can(me, 'health.read') && (
          <O
            ten="Định tuyến"
            den="/health"
            dangTai={health.isPending}
            loi={health.isError}
            so={<Badge tone={health.data?.routing.ok ? 'success' : 'danger'}>{health.data?.routing.ok ? 'Bình thường' : 'Hỏng'}</Badge>}
            phu={health.data?.routing.ok ? `tuyến thử ${health.data.routing.distance_km} km` : undefined}
          />
        )}
      </div>

      {can(me, 'audit.read') && (
        <Card>
          <div className="flex items-center gap-2">
            <CardTitle>Việc gần nhất</CardTitle>
            <Link to="/audit" className="ml-auto text-sm text-[var(--text-muted)] underline">
              Xem tất cả
            </Link>
          </div>
          <ul className="mt-2 space-y-2">
            {viec.data?.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>{item.action}</Badge>
                <span className="min-w-0 break-all">{item.actor}</span>
                <span className="ml-auto text-xs text-[var(--text-muted)]">
                  {gioNgay(item.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `pnpm exec vitest run apps/admin/src/features/overview/page.test.tsx`
Expected: PASS — 4 test.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/overview/page.tsx apps/admin/src/features/overview/page.test.tsx
git commit -m "feat(admin): màn Tổng quan gộp bốn nguồn số liệu"
```

---

### Task 9: Nối route và lật bài test đã cài sẵn từ pha 4

**Files:**
- Modify: `apps/admin/src/routes.tsx`
- Modify: `apps/admin/src/routes.test.tsx`

- [ ] **Step 1: Lật bài test**

Trong `apps/admin/src/routes.test.tsx`, thay bài `'/admin và /admin/edits hiện cùng một màn hình — Tổng quan (pha 6) chưa làm'` bằng:

```tsx
  it('/admin là Tổng quan, KHÁC với /admin/edits — pha 6 đã làm', async () => {
    // Bài test cũ khẳng định hai đường dẫn hiện y hệt nhau vì route index trỏ tạm EditsPage. Nó
    // là lời nhắc đã cài sẵn từ pha 4, và pha 6 chính là lúc nó phải đổi.
    mo('/admin');
    expect(await screen.findByRole('link', { name: /Đóng góp chờ duyệt/ })).toBeVisible();
    const goc = screen.getByRole('main').textContent;
    cleanup();

    mo('/admin/edits');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeVisible());
    expect(screen.getByRole('main').textContent).not.toBe(goc);
  });
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm exec vitest run apps/admin/src/routes.test.tsx`
Expected: FAIL — `/admin` vẫn là EditsPage nên không có liên kết "Đóng góp chờ duyệt".

- [ ] **Step 3: Nối route**

Trong `apps/admin/src/routes.tsx`, thêm lazy import:

```tsx
const OverviewPage = lazy(() =>
  import('@/features/overview/page').then((module) => ({ default: module.OverviewPage })),
);
```

và đổi nhánh index:

```tsx
        { index: true, element: wait(<OverviewPage />) },
```

- [ ] **Step 4: Chạy lại**

Run: `pnpm exec vitest run apps/admin/src/routes.test.tsx`
Expected: PASS — cả bốn bài.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/routes.tsx apps/admin/src/routes.test.tsx
git commit -m "feat(admin): /admin là Tổng quan, không còn trỏ tạm EditsPage"
```

---

### Task 10: Bốn tầng xanh, chứng cứ, lên production

**Files:**
- Create: `docs/evidence/admin/2026-09-18-pha-6-tong-quan.md`

- [ ] **Step 1: Lint và typecheck không cache**

Run: `pnpm lint && pnpm exec turbo run typecheck --continue --force`
Expected: PASS, 14/14, 0 cached. (`--force` là bắt buộc: turbo phát lại kết quả cũ và một lỗi
typecheck mới sẽ không hiện ra.)

- [ ] **Step 2: Bộ test đầy đủ**

Run: `pnpm test`
Expected: PASS (lệnh này build luôn `@mapslibvn/admin`).

- [ ] **Step 3: DB thật**

Run: `pnpm test:api-db`
Expected: PASS, gồm 3 test mới của Task 4.

- [ ] **Step 4: E2E**

Run: `pnpm test:admin-e2e`
Expected: PASS. Đã kiểm trước: `apps/admin/e2e/admin.spec.ts` **không** có bài nào mở `/admin`
trần — mọi bài đều `goto('/admin/edits')`, `/admin/tenants` hoặc `/admin/billing`. Nên pha 6
không làm đỏ bài E2E nào. Nếu vẫn đỏ thì đó là lỗi thật, không phải hệ quả mong đợi.

- [ ] **Step 5: Viết chứng cứ**

Tạo `docs/evidence/admin/2026-09-18-pha-6-tong-quan.md`:

```markdown
# Chứng cứ pha 6 — Tổng quan (`/admin`)

Plan: `docs/superpowers/plans/2026-09-18-trang-admin-pha-6.md`

## 1. Bốn tầng xanh ở máy
- `pnpm lint` · `turbo run typecheck --force` (0 cached) · `pnpm test` · `pnpm test:api-db` ·
  `pnpm test:admin-e2e` — điền số thật.

## 2. Deploy
- version:
- Không có migration; máy chủ giữ `0019`.

## 3. Nghiệm thu bằng mắt
- [ ] `/admin` hiện Tổng quan, KHÔNG còn giống `/admin/edits`
- [ ] Bốn ô có số; bấm từng ô sang đúng mảng
- [ ] Ô "Lượt bị chặn vì hạn mức" khớp cột 429 của màn Sức khoẻ (cùng nguồn, cùng cache)
- [ ] Năm việc gần nhất khớp năm dòng đầu của `/admin/audit`
- [ ] Tắt định tuyến → ô Định tuyến chuyển "Hỏng" ngay trên trang đích

## 4. Sổ quota KHÔNG bị tạo thêm
- [ ] Trước và sau khi mở trang đích nhiều lần, số sổ quota không tăng: tenant `legacy` phải đi
      nhánh KV. Kiểm bằng `pnpm audit:quota` hoặc so sổ của tenant legacy trước/sau.
```

- [ ] **Step 6: Commit và push**

```bash
git add docs/evidence/admin/2026-09-18-pha-6-tong-quan.md
git commit -m "docs(admin): khung chứng cứ pha 6"
git push
```

- [ ] **Step 7: Deploy**

Run: `pnpm deploy:api`
Expected: deploy xong, in version mới. Không có migration nên không cần `check:migration`.

- [ ] **Step 8: Nghiệm thu**

Mở `https://api.ai-solutions.io.vn/admin/` trên điện thoại thật, điền mục 3 và 4 của file chứng cứ.

---

## Self-review

**Phủ spec 11.1 —** bốn ô (Task 8) · năm việc gần nhất từ `admin_audit` (Task 8, dùng lại
`listAudit` đã sửa ở Task 5) · mỗi ô bấm sang mảng tương ứng (Task 6, `Link` thật) · mỗi ô kiểm
`can(...)` (Task 8).

**Lệch spec có chủ ý:** spec viết ô thứ hai là "tenant sắp vượt hạn mức". Bản làm ra lấy **số lượt
429 trong 24 giờ** làm số chính và **phần trăm cao nhất** làm dòng phụ — PHONG chốt 18/09/2026. Lý
do: 429 là thứ thật sự xảy ra với người dùng cuối và nó dùng lại đúng ô cache của màn Sức khoẻ nên
không tốn thêm truy vấn nào.

**Rủi ro lớn nhất và chỗ chặn nó:** `readUsage()` tạo sổ Durable Object cho tenant chưa có. Chặn ở
Task 3 (rẽ nhánh theo `quota_mode`) và canh ở Task 4 (itest) cộng mục 4 của file chứng cứ.

**Không có placeholder.** Ba giả định đã kiểm trong mã trước khi chốt plan:
`apps/api/test/billing-read.test.ts` tồn tại (lưới an toàn của Task 1); `gioNgay` **đã** được
export từ `apps/admin/src/features/audit/page.tsx:13` nên Task 8 dùng lại được, không phải chép
công thức định dạng giờ; và E2E không có bài nào mở `/admin` trần.
