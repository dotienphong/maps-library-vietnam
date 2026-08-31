# M3 — Places API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây tầng Places API (autocomplete, search, nearby, details, geocode, reverse) trên Worker `apps/api` đọc kho POI 1,5 triệu bản ghi qua Hyperdrive, kèm auth theo API key, quota, SDK client/web-component/React, và 2 fixture nghiệm thu bắt buộc.

**Architecture:** Worker Hono (đã có từ M1c/M2) thêm middleware auth (tra `api_key` qua KV cache 5 phút) và 6 route đọc Postgres qua Hyperdrive binding `DB`. Xếp hạng autocomplete và thang phân giải geocode là hàm thuần trong `apps/api/src/{ranking,geocode}.ts` để test bằng unit. Cache autocomplete dùng Cache API của Worker (không ghi KV theo request). SDK: thêm 6 phương thức vào `packages/core/src/client.ts`, web component `<mapslibvn-autocomplete>` trong `packages/web`, package mới `packages/react`.

**Tech Stack:** Hono 4, postgres (porsager) qua Hyperdrive, pg_trgm + PostGIS, @cloudflare/vitest-pool-workers, wrangler dev + vitest cho integration, tsup/size-limit, React 18, Playwright.

**Nguồn sự thật:** spec `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md` mục 6 (dòng 396–454), mục 7 (SDK), mục 10 (kiểm thử); roadmap `docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md` mục 4.

**Nghiệm thu M3 (spec mục 13):**
1. 2 fixture bắt buộc xanh: `q=Trường Tiểu học Hoàng Diệu&near=10.77,106.70` → ≥ 3 kết quả, trường Linh Xuân (10.85594, 106.77325) đứng đầu; `geocode?q=88/9 Nguyễn Lâm&near=10.76,106.66` → `precision=interpolated`, cách (10.7647, 106.6631) ≤ 60 m.
2. p95 autocomplete < 300 ms từ VN (đo bằng `scripts/perf-autocomplete.mjs` trên production).
3. Quota 429 hoạt động với tenant `free` thử nghiệm.
4. React demo trong docs.

---

## Bối cảnh — cái gì đã có sẵn (KHÔNG làm lại)

- `apps/api`: Hono app + CORS + `errorResponse` chuẩn `{error:{code,message,request_id}}` (`src/errors.ts`), `getSql(env)` qua Hyperdrive (`src/db.ts`), route styles/tiles/r2/healthz. Hyperdrive binding `DB` id `71d7a62b…` đã trỏ Postgres máy nội bộ qua Tunnel; local dev dùng `localConnectionString postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn`.
- DB đã migrate đến `0005_tenant.sql`: bảng `poi` (GIN trgm trên `name_norm`), `category`, `poi_source_link`, `street`, `alley`, `address_anchor`, `admin_area`, `admin_alias`, `tenant`, `api_key`. User `api` có SELECT trên tất cả. `api_key.key` CHECK `^mlv_live_[0-9A-Za-z]{24}$`.
- `packages/core`: `normalizeVi`, `nameCore`, `parseAddress` (kiểu `ParsedAddress`), `createClient` (mới có `attribution` + `styleUrl`), `MapsLibVNError`. Budget 8 kB gzip (size-limit chạy trong build).
- `packages/web`: `createMap` đã expose `map.places` (client core) và event `poiClick`. Budget ESM 15 kB.
- Test: `apps/api/test/*.test.ts` chạy vitest-pool-workers với Hyperdrive trỏ cổng đóng `127.0.0.1:59999` — **tầng này không được cần Postgres** (xem memory `api-test-khong-duoc-can-postgres`). Test có DB thật là workflow riêng.
- CI: `deploy-api.yml` tự deploy production khi push `apps/api/**`/`packages/core/**` (test phải xanh); `dbtest.yml` chạy pipeline dbtest khi động `db/**`, `packages/core/**`. **Mỗi commit phải giữ Worker deploy được.**
- E2E: Playwright ở `apps/docs/e2e/`, webServer = `wrangler dev` port 8787 + astro preview 4321.

## Quyết định thiết kế (đã chốt khi viết plan — ghi vào DEVLOG ở Task 12)

1. **Khoá cache autocomplete dùng lưới 0,05° thay H3 res 6.** Mục đích của H3 res 6 trong spec chỉ là bucket `near` cỡ ~4–6 km cho khoá cache; lưới làm tròn 0,05° (~5,5 km) đạt cùng mục đích mà không phải đóng gói `h3-js` (~200 kB) vào Worker. Hằng số nằm trong `ranking.ts` để chỉnh.
2. **2 fixture bắt buộc dùng dữ liệu seed tổng hợp**, vì cả trường Linh Xuân (10.856) lẫn Nguyễn Lâm (10.765, 106.663) đều nằm **ngoài** bbox fixture Quận 1. Integration test chạy trong workflow riêng `apitest.yml` (postgres service + migrate + seed `apps/api/test-db/setup.sql` + `wrangler dev` local), không đi qua pipeline conflate nặng.
3. **Auth chỉ áp cho 6 route places mới.** `/v1/styles`, `/v1/tiles`, `/v1/attribution`, `/r2` giữ nguyên hành vi hiện tại (đổi sau nếu cần, tránh vỡ playground/M1 acceptance).
4. **Khoá seed** đúng CHECK 24 ký tự: demo web `mlv_live_demo00000000000000000000`, server nội bộ `mlv_live_server000000000000000000`, itest `mlv_live_test00000000000000000000`, free thử nghiệm `mlv_live_freetest0000000000000000`.
5. **`suggestEdit` để M4** (roadmap M4 task 5). Client M3 có đúng 8 phương thức: autocomplete, search, nearby, getPlace, geocode, reverse + attribution, styleUrl có sẵn.
6. **Quota chỉ đếm khi `QUOTA_ENABLED === '1'` và plan ≠ `internal`** (spec 6.4 — giai đoạn nội bộ không ghi KV theo request; Workers Free chỉ cho 1.000 ghi KV/ngày). Var để `"0"` ở cả dev lẫn production cho tới khi có tenant free thật; test workers bật `'1'` qua miniflare bindings.
7. **Web component nhận `near` qua attribute hoặc property `.map`** (gán object map của `createMap`), thay cho `near-map="map1"` trong spec — tránh phải xây registry map toàn cục.
8. **Analytics Engine binding là optional trong code** (`env.ANALYTICS?.writeDataPoint`) — nếu tài khoản không bật được dataset thì bỏ binding trong wrangler.toml, code không đổi.

## Cây file (Create/Modify toàn milestone)

```
db/seed/tenant_internal.sql                    (C) Task 1
db/seed/tenant_free_test.sql                   (C) Task 11
scripts/db-seed-tenant.mjs                     (C) Task 1
scripts/api-db-test.mjs                        (C) Task 7
scripts/perf-autocomplete.mjs                  (C) Task 12
apps/api/src/auth.ts                           (C) Task 2
apps/api/src/params.ts                         (C) Task 3
apps/api/src/ranking.ts                        (C) Task 3
apps/api/src/cache.ts                          (C) Task 3
apps/api/src/place.ts                          (C) Task 5
apps/api/src/geocode.ts                        (C) Task 6
apps/api/src/quota.ts                          (C) Task 11
apps/api/src/analytics.ts                      (C) Task 11
apps/api/src/routes/autocomplete.ts            (C) Task 4
apps/api/src/routes/search.ts                  (C) Task 5
apps/api/src/routes/nearby.ts                  (C) Task 5
apps/api/src/routes/places.ts                  (C) Task 5
apps/api/src/routes/geocode.ts                 (C) Task 6
apps/api/src/routes/reverse.ts                 (C) Task 6
apps/api/src/env.ts                            (M) Task 2, 11
apps/api/src/errors.ts                         (M) Task 11 (Retry-After cho 429)
apps/api/src/index.ts                          (M) Task 4, 5, 6, 11
apps/api/wrangler.toml                         (M) Task 11 (ANALYTICS, QUOTA_ENABLED)
apps/api/vitest.config.ts                      (M) Task 11 (binding QUOTA_ENABLED test)
apps/api/vitest.itest.config.ts                (C) Task 7
apps/api/test/auth-origin.test.ts              (C) Task 2
apps/api/test/params.test.ts                   (C) Task 3
apps/api/test/ranking.test.ts                  (C) Task 3
apps/api/test/cache.test.ts                    (C) Task 3
apps/api/test/autocomplete.test.ts             (C) Task 4 (validation + auth 401/403)
apps/api/test/places-routes.test.ts            (C) Task 5
apps/api/test/quota.test.ts                    (C) Task 11
apps/api/test-db/setup.sql                     (C) Task 7
apps/api/test-db/places.itest.mjs              (C) Task 7
.github/workflows/apitest.yml                  (C) Task 7
packages/core/src/types.ts                     (C) Task 8
packages/core/src/client.ts                    (M) Task 8
packages/core/src/index.ts                     (M) Task 8
packages/core/src/client.places.test.ts        (C) Task 8
packages/web/src/autocomplete-element.ts       (C) Task 9
packages/web/src/index.ts                      (M) Task 9
packages/web/src/umd.ts                        (M) Task 9
packages/react/package.json                    (C) Task 10
packages/react/tsconfig.json                   (C) Task 10
packages/react/src/{index.ts,context.ts,map.tsx,marker.tsx,use-places.ts}  (C) Task 10
packages/react/src/use-places.test.ts          (C) Task 10
.github/workflows/deploy-docs.yml              (M) Task 10 (paths + build react)
apps/docs/public/playground.html               (M) Task 9
apps/docs/e2e/playground.spec.ts               (M) Task 9
apps/docs/astro.config.mjs                     (M) Task 10
apps/docs/package.json                         (M) Task 10
apps/docs/src/components/ReactDemo.tsx         (C) Task 10
apps/docs/src/pages/react-demo.astro           (C) Task 10
package.json (root)                            (M) Task 1, 7, 10 (scripts + devDeps react test)
docs/DEVLOG.md                                 (M) Task 12
docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md  (M) Task 12
```

Lệnh kiểm tra dùng xuyên suốt (chạy từ gốc repo):

- Test Worker: `pnpm --filter @mapslibvn/api test` — **không cần** Postgres.
- Typecheck: `pnpm -r typecheck` (hoặc `pnpm --filter <pkg> typecheck`).
- Lint: `pnpm exec biome check --write <files>`.
- Test root (core/web/react): `pnpm --filter @mapslibvn/core build && pnpm exec vitest run`.
- Integration DB: `pnpm test:api-db` (Task 7 tạo; cần `pnpm db:up` chạy trước).

---

### Task 1: Seed tenant nội bộ + script seed

Tạo dữ liệu `tenant`/`api_key` để auth có cái tra. Idempotent, chạy được cả trên dev DB lẫn máy chủ (qua tunnel).

**Files:**
- Create: `db/seed/tenant_internal.sql`
- Create: `scripts/db-seed-tenant.mjs`
- Modify: `package.json` (root — thêm script `db:seed-tenant`)

- [x] **Step 1: Viết `db/seed/tenant_internal.sql`**

```sql
-- Tenant nội bộ + khoá demo/server. Idempotent — chạy lại không đổi gì.
-- Khoá demo là kind=web: chỉ chấp nhận Origin localhost/docs (so hostname, mọi port).
-- Domain docs lấy từ apps/docs/astro.config.mjs (site: mapslibvn-docs.pages.dev).
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-000000000001', 'MapsLibVN nội bộ', 'internal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO api_key (key, tenant_id, label, kind, allowed_origins, scopes)
VALUES
  ('mlv_live_demo00000000000000000000', '00000000-0000-4000-8000-000000000001',
   'demo docs/playground', 'web',
   '{http://localhost,http://127.0.0.1,https://mapslibvn-docs.pages.dev,https://*.mapslibvn-docs.pages.dev}',
   '{places:read}'),
  ('mlv_live_server000000000000000000', '00000000-0000-4000-8000-000000000001',
   'server nội bộ (curl/test)', 'server', '{}', '{places:read}')
ON CONFLICT (key) DO NOTHING;
```

- [x] **Step 2: Viết `scripts/db-seed-tenant.mjs`**

```js
#!/usr/bin/env node
// Nạp file seed SQL vào DATABASE_URL (mặc định tenant nội bộ):
//   pnpm db:seed-tenant                       — dev DB local
//   pnpm db:seed-tenant db/seed/tenant_free_test.sql
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

const files = process.argv.slice(2);
if (files.length === 0) files.push('db/seed/tenant_internal.sql');

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
try {
  for (const file of files) {
    await sql.unsafe(await readFile(file, 'utf8'));
    console.log(`đã nạp ${file}`);
  }
  // tsconfig.scripts.json bật checkJs + noUncheckedIndexedAccess: không destructure
  // thẳng `const [{ n }] = …` (lỗi TS2339 trên Row | undefined).
  const [row] = await sql`SELECT count(*)::int AS n FROM api_key WHERE active`;
  console.log(`api_key active: ${row?.n ?? 0}`);
} finally {
  await sql.end({ timeout: 5 });
}
```

- [x] **Step 3: Thêm script vào `package.json` gốc**

Trong khối `"scripts"`, cạnh `"db:migrate"`:

```json
"db:seed-tenant": "node scripts/db-seed-tenant.mjs",
```

- [x] **Step 4: Chạy thử trên dev DB**

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed-tenant && pnpm db:seed-tenant
```

Expected: hai lần chạy đều in `api_key active: 2` (idempotent). Nếu DB local chưa từng migrate, `db:migrate` chạy hết 0001→0005 trước.

- [x] **Step 5: Commit**

```bash
git add db/seed/tenant_internal.sql scripts/db-seed-tenant.mjs package.json
git commit -m "feat(db): seed tenant nội bộ + khoá demo/server cho M3 auth"
```

**✅ Task 1 ĐÃ XONG (31/08/2026).** Kết quả thực tế: `pnpm db:seed-tenant` chạy 2 lần đều in `api_key active: 2`;
DB dev có `mlv_live_demo00000000000000000000` (kind=web, 4 origin) và `mlv_live_server000000000000000000`
(kind=server), cả hai `plan=internal`, `scopes={places:read}`, `active=t`, `revoked_at=NULL` — đúng hình dạng
`loadAuth()` của Task 2 sẽ đọc. Lint/typecheck/test toàn repo xanh (13/13 test apps/api).
**Lệch so với plan:** `const [{ n }] = await sql…` gây TS2339 dưới `checkJs + noUncheckedIndexedAccess` →
đã đổi sang `const [row] = …` + `row?.n ?? 0` (đã sửa cả trong plan ở Step 2).

---

### Task 2: Middleware auth `X-Api-Key`

Tra khoá trong `api_key` (KV cache 5 phút), kiểm Origin cho khoá `web`, scope `places:read`. Lỗi 401/403 theo chuẩn errors.ts. Test endpoint-level nằm ở Task 4 (khi có route đầu tiên); task này test hàm thuần `originAllowed`.

**Files:**
- Create: `apps/api/src/auth.ts`
- Modify: `apps/api/src/env.ts`
- Test: `apps/api/test/auth-origin.test.ts`

- [x] **Step 1: Mở rộng `apps/api/src/env.ts`**

Thay toàn bộ file bằng:

```ts
import type { AuthInfo } from './auth';

export interface Env {
  META: KVNamespace;
  TILES: R2Bucket;
  DB: Hyperdrive;
  TILES_BASE: string;
  ENVIRONMENT: string;
  /** '1' = bật đếm quota KV cho tenant free/paid (spec 6.4). Mặc định '0'. */
  QUOTA_ENABLED?: string;
  /** Workers Analytics Engine — optional, code phải hoạt động khi vắng binding. */
  ANALYTICS?: AnalyticsEngineDataset;
}

/** Kiểu Hono chung cho app: Variables.auth do requireAuth() gán. */
export type AppEnv = { Bindings: Env; Variables: { auth?: AuthInfo } };
```

- [x] **Step 2: Viết test cho `originAllowed` — `apps/api/test/auth-origin.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { originAllowed } from '../src/auth';

describe('originAllowed', () => {
  const allowed = ['http://localhost', 'https://docs.example.com', 'https://*.pages.dev'];
  it('khớp hostname bất kể port', () => {
    expect(originAllowed('http://localhost:4321', allowed)).toBe(true);
    expect(originAllowed('http://localhost:8787', allowed)).toBe(true);
  });
  it('khớp đúng domain, đúng protocol', () => {
    expect(originAllowed('https://docs.example.com', allowed)).toBe(true);
    expect(originAllowed('http://docs.example.com', allowed)).toBe(false);
  });
  it('wildcard subdomain khớp mọi cấp con và cả gốc', () => {
    expect(originAllowed('https://mapslibvn.pages.dev', allowed)).toBe(true);
    expect(originAllowed('https://deep.a.pages.dev', allowed)).toBe(true);
    expect(originAllowed('https://pages.dev', allowed)).toBe(true);
  });
  it('không khớp domain lạ hoặc origin hỏng', () => {
    expect(originAllowed('https://evil.test', allowed)).toBe(false);
    expect(originAllowed('not-a-url', allowed)).toBe(false);
    expect(originAllowed('https://xpages.dev', allowed)).toBe(false);
  });
  it('danh sách rỗng = cho phép tất cả (khoá server/mobile lưu {})', () => {
    expect(originAllowed('https://anything.test', [])).toBe(true);
  });
});
```

- [x] **Step 3: Chạy để thấy fail**

Run: `pnpm --filter @mapslibvn/api test`
Expected: FAIL — `Cannot find module '../src/auth'`.

- [x] **Step 4: Viết `apps/api/src/auth.ts`**

```ts
import type { Context, Next } from 'hono';
import { getSql } from './db';
import type { AppEnv } from './env';
import { ApiError } from './errors';

export interface AuthInfo {
  key: string;
  tenantId: string;
  plan: 'internal' | 'free' | 'paid';
  kind: 'web' | 'mobile' | 'server';
  scopes: string[];
  allowedOrigins: string[];
  quotaPlacesPerDay: number | null;
}

const KV_TTL_S = 300; // spec 6.4: cache khoá 5 phút

/** Khớp Origin/Referer với allowed_origins: so protocol + hostname (mọi port),
 *  hỗ trợ wildcard subdomain `https://*.example.com` (khớp cả example.com). */
export function originAllowed(origin: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  for (const pattern of allowed) {
    let p: URL;
    try {
      p = new URL(pattern.replace('*.', 'any-sub.'));
    } catch {
      continue; // mẫu hỏng trong DB thì bỏ qua
    }
    if (p.protocol !== url.protocol) continue;
    if (pattern.includes('*.')) {
      const suffix = p.hostname.replace(/^any-sub\./, '');
      if (url.hostname === suffix || url.hostname.endsWith(`.${suffix}`)) return true;
    } else if (p.hostname === url.hostname) return true;
  }
  return false;
}

async function loadAuth(c: Context<AppEnv>, key: string): Promise<AuthInfo | null> {
  const kvKey = `apikey:${key}`;
  const cached = await c.env.META.get<AuthInfo>(kvKey, 'json');
  if (cached) return cached;
  const sql = getSql(c.env);
  try {
    const [row] = await sql<
      {
        key: string;
        kind: AuthInfo['kind'];
        scopes: string[];
        allowed_origins: string[];
        quota_places_per_day: number | null;
        tenant_id: string;
        plan: AuthInfo['plan'];
      }[]
    >`SELECT k.key, k.kind, k.scopes, k.allowed_origins, k.quota_places_per_day,
        t.id AS tenant_id, t.plan
      FROM api_key k JOIN tenant t ON t.id = k.tenant_id
      WHERE k.key = ${key} AND k.active AND k.revoked_at IS NULL`;
    if (!row) return null;
    const info: AuthInfo = {
      key: row.key,
      tenantId: row.tenant_id,
      plan: row.plan,
      kind: row.kind,
      scopes: row.scopes,
      allowedOrigins: row.allowed_origins,
      quotaPlacesPerDay: row.quota_places_per_day,
    };
    c.executionCtx.waitUntil(
      c.env.META.put(kvKey, JSON.stringify(info), { expirationTtl: KV_TTL_S }),
    );
    return info;
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
}

/** Middleware cho các route places: 401 thiếu/sai khoá, 403 sai origin/scope. */
export function requireAuth() {
  return async (c: Context<AppEnv>, next: Next) => {
    const key = c.req.header('X-Api-Key') ?? c.req.query('key');
    if (!key) throw new ApiError(401, 'missing_key', 'Thiếu khoá API (header X-Api-Key hoặc ?key=)');
    let info: AuthInfo | null;
    try {
      info = await loadAuth(c, key);
    } catch (err) {
      console.error('auth', err);
      throw new ApiError(503, 'upstream_unavailable', 'Không tra được khoá API');
    }
    if (!info) throw new ApiError(401, 'invalid_key', 'Khoá API không hợp lệ hoặc đã thu hồi');
    if (!info.scopes.includes('places:read'))
      throw new ApiError(403, 'scope', 'Khoá không có scope places:read');
    if (info.kind === 'web') {
      const origin = c.req.header('Origin') ?? c.req.header('Referer') ?? '';
      // Không có Origin (curl, server-side) thì cho qua ở MVP — khoá web vốn không phải bí mật.
      if (origin && !originAllowed(origin, info.allowedOrigins))
        throw new ApiError(403, 'origin_not_allowed', 'Origin không nằm trong allowed_origins');
    }
    if (info.kind === 'mobile') {
      const bundle = c.req.header('X-Bundle-Id');
      // Kiểm mềm (spec 6.4): log theo tenant, không ghi khoá API ra log.
      if (bundle) console.log('bundle-id', info.tenantId, bundle);
    }
    c.set('auth', info);
    await next();
  };
}
```

- [x] **Step 5: Chạy test + typecheck**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS toàn bộ (5 test mới + test cũ).

- [x] **Step 6: Commit**

```bash
git add apps/api/src/auth.ts apps/api/src/env.ts apps/api/test/auth-origin.test.ts
git commit -m "feat(api): middleware auth X-Api-Key — tra api_key, KV cache 5', kiểm origin wildcard"
```

**✅ Task 2 ĐÃ XONG (31/08/2026).** Đã thêm `AppEnv` và binding optional cho quota/Analytics,
middleware đọc `X-Api-Key` hoặc `?key=`, tra DB rồi cache KV 5 phút, kiểm `places:read`, Origin/Referer
cho khoá web và log mềm bundle ID cho mobile. TDD RED xác nhận thiếu `auth.ts`; GREEN đạt 5/5 test mới,
tổng API 18/18, typecheck API sạch. **Lệch an toàn so với snippet plan:** log mobile ghi `tenantId` thay
vì nguyên API key để không rò secret vào Worker logs. Endpoint-level 401/403 vẫn đúng lịch ở Task 4
khi route places đầu tiên được gắn middleware. **Điểm bắt đầu phiên sau: Task 3 Step 1 — viết RED test
`apps/api/test/ranking.test.ts`, sau đó `cache.test.ts` và `params.test.ts`.**

---

### Task 3: `ranking.ts`, `cache.ts`, `params.ts` — logic thuần cho autocomplete

Công thức 6.2 và cache 10 phút tách khỏi route để test bằng unit. `params.ts` gom validate query param dùng chung cho mọi route.

**Files:**
- Create: `apps/api/src/ranking.ts`, `apps/api/src/cache.ts`, `apps/api/src/params.ts`
- Test: `apps/api/test/ranking.test.ts`, `apps/api/test/cache.test.ts`, `apps/api/test/params.test.ts`

- [x] **Step 1: Viết test ranking — `apps/api/test/ranking.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { COEFF, gridKey, priorFor, proxScore, rankScore } from '../src/ranking';

describe('ranking spec 6.2', () => {
  it('hệ số đúng spec', () => {
    expect(COEFF).toEqual({ sim: 0.55, prox: 0.25, pop: 0.15, prior: 0.05 });
  });
  it('prox: không near → 0.5; d=0 → 1; d=5km → e^-1', () => {
    expect(proxScore(null)).toBe(0.5);
    expect(proxScore(0)).toBe(1);
    expect(proxScore(5000)).toBeCloseTo(Math.exp(-1), 5);
  });
  it('prior: POI 1, đường 0.7; q bắt đầu bằng số → đảo (địa chỉ 1, POI 0.5)', () => {
    expect(priorFor('poi', false)).toBe(1);
    expect(priorFor('street', false)).toBe(0.7);
    expect(priorFor('address', true)).toBe(1);
    expect(priorFor('poi', true)).toBe(0.5);
    expect(priorFor('street', true)).toBe(0.7);
  });
  it('prefix cộng 0.1 vào sim', () => {
    const base = { sim: 0.8, prefix: false, dMeters: null, pop: 0, type: 'poi' as const, qStartsWithDigit: false };
    expect(rankScore({ ...base, prefix: true }) - rankScore(base)).toBeCloseTo(0.55 * 0.1, 5);
  });
  it('kịch bản fixture: tên khớp hẳn + pop cao thắng tên dài hơn dù gần hơn một chút', () => {
    // Linh Xuân: sim 1.0 prefix, ~12.5km, pop 0.9
    const linhXuan = rankScore({ sim: 1, prefix: true, dMeters: 12_500, pop: 0.9, type: 'poi', qStartsWithDigit: false });
    // "… Hoàng Diệu 2": sim ~0.93 prefix, ~14.9km, pop 0.4
    const truong2 = rankScore({ sim: 0.93, prefix: true, dMeters: 14_900, pop: 0.4, type: 'poi', qStartsWithDigit: false });
    expect(linhXuan).toBeGreaterThan(truong2);
  });
  it('gridKey lượng tử 0.05° và ổn định', () => {
    expect(gridKey(10.77, 106.7)).toBe(gridKey(10.78, 106.71));
    expect(gridKey(10.77, 106.7)).not.toBe(gridKey(10.9, 106.7));
  });
});
```

- [x] **Step 2: Viết test params — `apps/api/test/params.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { clampInt, parseLatLngPair, parseTypes } from '../src/params';

describe('params', () => {
  it('parseLatLngPair: "10.77,106.70" → {lat,lng}; undefined → null', () => {
    expect(parseLatLngPair('10.77,106.70', 'near')).toEqual({ lat: 10.77, lng: 106.7 });
    expect(parseLatLngPair(undefined, 'near')).toBeNull();
  });
  it('parseLatLngPair: sai định dạng hoặc ngoài biên → ApiError 400', () => {
    for (const bad of ['xx', '10.77', '91,106', '10,181', '10.77;106.70']) {
      expect(() => parseLatLngPair(bad, 'near')).toThrowError(ApiError);
    }
  });
  it('clampInt: mặc định, chặn trên, 400 khi không phải số', () => {
    expect(clampInt(undefined, 1, 10, 7, 'limit')).toBe(7);
    expect(clampInt('99', 1, 10, 7, 'limit')).toBe(10);
    expect(clampInt('3', 1, 10, 7, 'limit')).toBe(3);
    expect(() => clampInt('abc', 1, 10, 7, 'limit')).toThrowError(ApiError);
  });
  it('parseTypes: mặc định đủ 3, lọc giá trị lạ → 400', () => {
    expect([...parseTypes(undefined)].sort()).toEqual(['address', 'poi', 'street']);
    expect([...parseTypes('poi,street')].sort()).toEqual(['poi', 'street']);
    expect(() => parseTypes('poi,banana')).toThrowError(ApiError);
  });
});
```

- [x] **Step 3: Chạy để thấy fail**

Run: `pnpm --filter @mapslibvn/api test`
Expected: FAIL — thiếu module `../src/ranking`, `../src/params`.

- [x] **Step 4: Viết `apps/api/src/ranking.ts`**

```ts
/** Hệ số xếp hạng autocomplete (spec 6.2) — đặt ở đây để chỉnh bằng test. */
export const COEFF = { sim: 0.55, prox: 0.25, pop: 0.15, prior: 0.05 } as const;
export const PREFIX_BONUS = 0.1;
export const PROX_SCALE_M = 5000;
/** Lưới thay H3 res 6 cho khoá cache (~5,5 km) — xem plan M3, quyết định 1. */
export const CACHE_GRID_DEG = 0.05;

export type ItemType = 'poi' | 'street' | 'address';

export function priorFor(type: ItemType, qStartsWithDigit: boolean): number {
  if (qStartsWithDigit) return type === 'address' ? 1 : type === 'poi' ? 0.5 : 0.7;
  return type === 'poi' ? 1 : 0.7;
}

export function proxScore(dMeters: number | null | undefined): number {
  if (dMeters == null) return 0.5;
  return Math.exp(-dMeters / PROX_SCALE_M);
}

export function rankScore(x: {
  sim: number;
  prefix: boolean;
  dMeters: number | null;
  pop: number;
  type: ItemType;
  qStartsWithDigit: boolean;
}): number {
  const sim = x.sim + (x.prefix ? PREFIX_BONUS : 0);
  const pop = Math.max(0, Math.min(1, x.pop));
  return (
    COEFF.sim * sim +
    COEFF.prox * proxScore(x.dMeters) +
    COEFF.pop * pop +
    COEFF.prior * priorFor(x.type, x.qStartsWithDigit)
  );
}

export function gridKey(lat: number, lng: number): string {
  const scale = 1 / CACHE_GRID_DEG;
  const bucket = (value: number) => Math.floor(value * scale + 1e-9) / scale;
  return `${bucket(lat).toFixed(2)},${bucket(lng).toFixed(2)}`;
}
```

- [x] **Step 5: Viết `apps/api/src/params.ts`**

```ts
import { ApiError } from './errors';
import type { ItemType } from './ranking';

export interface LatLng {
  lat: number;
  lng: number;
}

/** "lat,lng" → {lat,lng}; undefined/rỗng → null; sai → 400 invalid_request. */
export function parseLatLngPair(raw: string | undefined, name: string): LatLng | null {
  if (raw === undefined || raw === '') return null;
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(raw.trim());
  const lat = m ? Number(m[1]) : Number.NaN;
  const lng = m ? Number(m[2]) : Number.NaN;
  if (!m || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw new ApiError(400, 'invalid_request', `${name} phải là "lat,lng" hợp lệ`);
  return { lat, lng };
}

export function clampInt(
  raw: string | undefined,
  min: number,
  max: number,
  dflt: number,
  name: string,
): number {
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new ApiError(400, 'invalid_request', `${name} phải là số nguyên`);
  return Math.max(min, Math.min(max, n));
}

const TYPES: ItemType[] = ['poi', 'street', 'address'];

export function parseTypes(raw: string | undefined): Set<ItemType> {
  if (!raw) return new Set(TYPES);
  const parts = raw.split(',').map((s) => s.trim()) as ItemType[];
  for (const p of parts)
    if (!TYPES.includes(p))
      throw new ApiError(400, 'invalid_request', `types chỉ nhận ${TYPES.join(',')}`);
  return new Set(parts);
}

/** "minLng,minLat,maxLng,maxLat" → tuple; sai → 400. */
export function parseBbox(raw: string | undefined): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN))
    throw new ApiError(400, 'invalid_request', 'bbox phải là "minLng,minLat,maxLng,maxLat"');
  return parts as [number, number, number, number];
}
```

- [x] **Step 6: Viết test cache — `apps/api/test/cache.test.ts`**

```ts
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { cachedJson } from '../src/cache';

const url = (s: string) => `https://cache.mapslibvn/test-${s}?k=1`;

describe('cachedJson', () => {
  it('lần đầu compute, lần hai (còn tươi) trả cache không compute lại', async () => {
    const ctx = createExecutionContext();
    let calls = 0;
    const compute = async () => ({ n: ++calls });
    const r1 = await cachedJson(ctx, url('fresh'), 600, 3600, compute);
    expect(await r1.json()).toEqual({ n: 1 });
    await waitOnExecutionContext(ctx); // chờ cache.put
    const ctx2 = createExecutionContext();
    const r2 = await cachedJson(ctx2, url('fresh'), 600, 3600, compute);
    expect(await r2.json()).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });
  it('compute lỗi + có bản stale → trả stale; không có → ném lỗi', async () => {
    const ctx = createExecutionContext();
    await cachedJson(ctx, url('stale'), 0, 3600, async () => ({ ok: true }));
    await waitOnExecutionContext(ctx);
    const boom = async () => {
      throw new Error('db down');
    };
    // freshSec=0 nên bản lưu đã "hết tươi" nhưng còn trong cửa sổ stale 3600s
    const r = await cachedJson(createExecutionContext(), url('stale'), 0, 3600, boom);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get('x-mlv-cache')).toBe('stale');
    await expect(cachedJson(createExecutionContext(), url('none'), 0, 3600, boom)).rejects.toThrow(
      'db down',
    );
  });
});
```

- [x] **Step 7: Viết `apps/api/src/cache.ts`**

```ts
/** Cache API với stale-if-error thủ công (spec 6.6): lưu với max-age = staleSec,
 *  ghi mốc thời gian vào header; đọc ra tự phân biệt "tươi" (≤ freshSec) và "stale". */
export async function cachedJson(
  ctx: { waitUntil(promise: Promise<unknown>): void },
  cacheUrl: string,
  freshSec: number,
  staleSec: number,
  compute: () => Promise<unknown>,
): Promise<Response> {
  const cache = caches.default;
  const req = new Request(cacheUrl);
  const hit = await cache.match(req);
  const ageSec = hit
    ? (Date.now() - Number(hit.headers.get('x-stored-at') ?? 0)) / 1000
    : Number.POSITIVE_INFINITY;
  if (hit && freshSec > 0 && ageSec <= freshSec) return withCacheHeader(hit, 'hit');
  try {
    const data = await compute();
    const res = new Response(JSON.stringify(data), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${staleSec}`,
        'x-stored-at': String(Date.now()),
      },
    });
    ctx.waitUntil(cache.put(req, res.clone()));
    return res;
  } catch (err) {
    if (hit && ageSec <= staleSec) return withCacheHeader(hit, 'stale');
    throw err;
  }
}

function withCacheHeader(res: Response, value: 'hit' | 'stale'): Response {
  const out = new Response(res.body, res);
  out.headers.set('x-mlv-cache', value);
  return out;
}
```

- [x] **Step 8: Chạy test + typecheck, rồi commit**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS toàn bộ.

```bash
git add apps/api/src/ranking.ts apps/api/src/cache.ts apps/api/src/params.ts apps/api/test/ranking.test.ts apps/api/test/cache.test.ts apps/api/test/params.test.ts
git commit -m "feat(api): ranking 6.2 + cache stale-if-error + validate params"
```

**✅ Task 3 ĐÃ XONG (31/08/2026), commit `ab218f1`.** TDD RED xác nhận thiếu cả ba module;
GREEN đạt 8 file / 30 test API, typecheck và lint sạch. `gridKey` dùng floor-bucket 0,05° thay vì
`Math.round` vì hai điểm mẫu 10.77/10.78 nằm khác phía ngưỡng làm tròn 10.775; test có cả toạ độ âm.
`freshSec=0` được định nghĩa stale ngay để test/cache không phụ thuộc hai lần `Date.now()` cùng millisecond.
Contract context của `cachedJson` chỉ yêu cầu `waitUntil`, tương thích cả Hono và Workers runtime types.

---

### Task 4: `GET /v1/autocomplete`

Hợp nhất POI + đường + địa chỉ bằng trigram trên `name_norm`/`street_norm`, xếp hạng bằng `ranking.ts`, cache 10 phút. Workers test chỉ phủ validation + auth (DB đóng cổng); kết quả thật nghiệm ở Task 7.

**Files:**
- Create: `apps/api/src/routes/autocomplete.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/autocomplete.test.ts`

- [x] **Step 1: Viết test — `apps/api/test/autocomplete.test.ts`**

```ts
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

// Khoá giả nạp thẳng vào KV cache của auth — tầng test này không có Postgres.
const KEY = 'mlv_live_test00000000000000000000';
const seedKey = (over: Record<string, unknown> = {}) =>
  env.META.put(
    `apikey:${KEY}`,
    JSON.stringify({
      key: KEY,
      tenantId: '00000000-0000-4000-8000-0000000000aa',
      plan: 'internal',
      kind: 'server',
      scopes: ['places:read'],
      allowedOrigins: [],
      quotaPlacesPerDay: null,
      ...over,
    }),
  );
const url = (qs: string) => `https://api/v1/autocomplete?${qs}`;
const code = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('GET /v1/autocomplete — auth + validation (không DB)', () => {
  beforeAll(() => seedKey());
  it('thiếu key → 401 missing_key', async () => {
    const res = await SELF.fetch(url('q=highlands'));
    expect(res.status).toBe(401);
    expect(await code(res)).toBe('missing_key');
  });
  it('key lạ (không có trong KV) + DB đóng → 503 upstream_unavailable', async () => {
    const res = await SELF.fetch(url('q=highlands'), {
      headers: { 'X-Api-Key': 'mlv_live_unknown0000000000000000' },
    });
    expect(res.status).toBe(503);
  });
  it('key web sai Origin → 403 origin_not_allowed', async () => {
    await seedKey({ kind: 'web', allowedOrigins: ['https://docs.example.com'] });
    const res = await SELF.fetch(url('q=highlands'), {
      headers: { 'X-Api-Key': KEY, Origin: 'https://evil.test' },
    });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('origin_not_allowed');
    await seedKey(); // trả về khoá server cho các test sau
  });
  it('thiếu scope → 403 scope', async () => {
    await seedKey({ scopes: ['edits:write'] });
    const res = await SELF.fetch(url('q=highlands'), { headers: { 'X-Api-Key': KEY } });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('scope');
    await seedKey();
  });
  it('q < 2 ký tự → 400; near hỏng → 400; types lạ → 400', async () => {
    for (const qs of ['q=a', 'q=highlands&near=xx', 'q=highlands&types=banana']) {
      const res = await SELF.fetch(url(qs), { headers: { 'X-Api-Key': KEY } });
      expect(res.status).toBe(400);
      expect(await code(res)).toBe('invalid_request');
    }
  });
  it('request hợp lệ + DB đóng → 503 (đi hết auth/validate, chết ở DB)', async () => {
    const res = await SELF.fetch(url('q=highlands&near=10.77,106.70'), {
      headers: { 'X-Api-Key': KEY },
    });
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('upstream_unavailable');
  });
});
```

- [x] **Step 2: Chạy để thấy fail**

Run: `pnpm --filter @mapslibvn/api test`
Expected: FAIL — 404 not_found (route chưa tồn tại) thay vì 401/400/503.

- [x] **Step 3: Viết `apps/api/src/routes/autocomplete.ts`**

```ts
import { nameCore, normalizeVi, parseAddress } from '@mapslibvn/core';
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { clampInt, parseLatLngPair, parseTypes } from '../params';
import { type ItemType, gridKey, rankScore } from '../ranking';

interface CandidateRow {
  type: ItemType;
  id: string | null;
  name: string;
  secondary: string | null;
  lat: number;
  lng: number;
  precision: string | null;
  sim: number;
  prefix: boolean;
  pop: number;
  d: number | null;
}

export const autocomplete = new Hono<AppEnv>();

autocomplete.get('/v1/autocomplete', requireAuth(), async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) throw new ApiError(400, 'invalid_request', 'q phải có ít nhất 2 ký tự');
  const near = parseLatLngPair(c.req.query('near'), 'near');
  const limit = clampInt(c.req.query('limit'), 1, 10, 10, 'limit');
  const types = parseTypes(c.req.query('types'));
  const qn = normalizeVi(q);
  const qc = nameCore(q) || qn;
  const qDigit = /^\d/.test(qn);
  if (!qn) throw new ApiError(400, 'invalid_request', 'q không có ký tự tra cứu được');

  // Cache 10 phút theo (q_norm, lưới near, types, limit) — spec 6.1; stale-if-error 1 giờ (6.6).
  const cacheUrl =
    'https://cache.mapslibvn/autocomplete' +
    `?qn=${encodeURIComponent(qn)}&g=${near ? gridKey(near.lat, near.lng) : '-'}` +
    `&t=${[...types].sort().join('_')}&l=${limit}`;

  const res = await cachedJson(c.executionCtx, cacheUrl, 600, 3600, async () => {
    const sql = getSql(c.env);
    try {
      const nearPt = near
        ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)`
        : null;
      const dist = (geom: string) =>
        nearPt ? sql`ST_DistanceSphere(${sql.unsafe(geom)}, ${nearPt})` : sql`NULL::float8`;
      const rows: CandidateRow[] = [];

      if (types.has('poi')) {
        rows.push(
          ...(await sql<CandidateRow[]>`
            SELECT 'poi' AS type, id, name,
              concat_ws(', ', street, ward, province) AS secondary,
              ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
              greatest(similarity(name_norm, ${qn}), similarity(name_norm, ${qc})) AS sim,
              starts_with(name_norm, ${qn}) AS prefix,
              coalesce(popularity, 0) AS pop,
              ${dist('geom')} AS d
            FROM poi
            WHERE status = 'active'
              AND (name_norm % ${qn} OR name_norm % ${qc} OR starts_with(name_norm, ${qn}))
            ORDER BY sim DESC
            LIMIT 20`),
        );
      }
      if (types.has('street')) {
        rows.push(
          ...(await sql<CandidateRow[]>`
            SELECT 'street' AS type, NULL AS id, name,
              coalesce(province_norm, '') AS secondary,
              ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng,
              NULL AS precision,
              similarity(name_norm, ${qn}) AS sim,
              starts_with(name_norm, ${qn}) AS prefix,
              0 AS pop,
              ${dist('geom')} AS d
            FROM street
            WHERE name_norm % ${qn} OR starts_with(name_norm, ${qn})
            ORDER BY sim DESC
            LIMIT 20`),
        );
      }
      const parsed = parseAddress(q);
      if (types.has('address') && parsed.housenumber && parsed.streetNorm) {
        rows.push(
          ...(await sql<CandidateRow[]>`
            SELECT 'address' AS type, NULL AS id,
              ${`${parsed.housenumber} ${parsed.street ?? ''}`.trim()} AS name,
              concat_ws(', ', ward_norm, province_norm) AS secondary,
              ST_Y(geom) AS lat, ST_X(geom) AS lng, 'rooftop' AS precision,
              similarity(street_norm, ${parsed.streetNorm}) AS sim,
              false AS prefix, 0 AS pop,
              ${dist('geom')} AS d
            FROM address_anchor
            WHERE housenumber = ${parsed.housenumber} AND street_norm % ${parsed.streetNorm}
            ORDER BY sim DESC
            LIMIT 10`),
        );
      }

      const items = rows
        .map((r) => ({
          type: r.type,
          ...(r.id ? { id: r.id } : {}),
          name: r.name,
          secondary: r.secondary ?? '',
          lat: r.lat,
          lng: r.lng,
          ...(r.precision ? { precision: r.precision } : {}),
          score:
            Math.round(
              rankScore({
                sim: Number(r.sim),
                prefix: r.prefix,
                dMeters: r.d === null ? null : Number(r.d),
                pop: Number(r.pop),
                type: r.type,
                qStartsWithDigit: qDigit,
              }) * 1000,
            ) / 1000,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return { items };
    } catch (err) {
      console.error('autocomplete', err);
      throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  });
  return res;
});
```

- [x] **Step 4: Mount route trong `apps/api/src/index.ts`**

**Quan trọng:** đổi generic của app chính sang `AppEnv` (route mới dùng `Variables.auth`; nếu giữ `{ Bindings: Env }` thì middleware `Context<AppEnv>` sẽ lỗi type):

```ts
import type { AppEnv } from './env';   // thay cho: import type { Env } from './env';

const app = new Hono<AppEnv>();        // thay cho: new Hono<{ Bindings: Env }>()
```

(Các sub-app cũ `styles`/`tiles`/`r2` giữ nguyên `Hono<{ Bindings: Env }>` — `app.route()` của Hono nhận sub-app có Env khác, không lỗi.) Rồi thêm import và mount:

```ts
import { autocomplete } from './routes/autocomplete';
// … sau app.get('/v1/attribution', …):
app.route('/', autocomplete);
```

- [x] **Step 5: Chạy test + typecheck**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS toàn bộ. Lưu ý test `503` cuối: compute ném ApiError 503 và cache không có bản stale → errorResponse trả 503 chuẩn.

- [x] **Step 6: Smoke thử với DB local (tay, không bắt buộc CI)**

```bash
pnpm db:up && pnpm db:seed-tenant
cd apps/api && pnpm dev &
sleep 5
curl -s 'http://localhost:8787/v1/autocomplete?q=highlands&near=10.77,106.70' \
  -H 'X-Api-Key: mlv_live_server000000000000000000' | head -c 400
kill %1
```

Expected: JSON `{"items":[…]}` (rỗng nếu DB local chưa chạy `pnpm db:fixture`; có kết quả Highlands nếu đã nạp fixture Quận 1).

- [x] **Step 7: Commit** (deploy-api.yml sẽ tự deploy — test đã xanh)

```bash
git add apps/api/src/routes/autocomplete.ts apps/api/src/index.ts apps/api/test/autocomplete.test.ts
git commit -m "feat(api): GET /v1/autocomplete — trigram 3 nguồn, xếp hạng 6.2, cache 10'"
```

**✅ Task 4 ĐÃ XONG (31/08/2026).** TDD RED trả 404 cho cả 6 case; GREEN đạt 9 file / 36 test API,
typecheck và lint sạch. Route đã gắn `requireAuth`, validate `q/near/types/limit`, hợp nhất POI/đường/địa
chỉ, xếp hạng 6.2 và cache 10 phút + stale-if-error 1 giờ. Smoke thật với Postgres local trả HTTP 200
trong 2,69 giây, 10 item; “Highlands” đầu tiên tại `(10.7884848, 106.6997872)`, score 0.971.
**Điểm bắt đầu phiên sau: Task 5 Step 1 — tạo helper `apps/api/src/place.ts`, sau đó RED test ba route
search/nearby/place-details trong `apps/api/test/places-routes.test.ts`.**

---

### Task 5: `GET /v1/search`, `/v1/nearby`, `/v1/places/{id}`

Ba route trả `Place` (spec 6.1). `place.ts` gom SELECT + mapper dùng chung.

**Files:**
- Create: `apps/api/src/place.ts`, `apps/api/src/routes/search.ts`, `apps/api/src/routes/nearby.ts`, `apps/api/src/routes/places.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/places-routes.test.ts`

- [x] **Step 1: Viết test — `apps/api/test/places-routes.test.ts`**

```ts
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

const KEY = 'mlv_live_test00000000000000000000';
beforeAll(() =>
  env.META.put(
    `apikey:${KEY}`,
    JSON.stringify({
      key: KEY,
      tenantId: '00000000-0000-4000-8000-0000000000aa',
      plan: 'internal',
      kind: 'server',
      scopes: ['places:read'],
      allowedOrigins: [],
      quotaPlacesPerDay: null,
    }),
  ),
);
const fetchApi = (path: string) =>
  SELF.fetch(`https://api${path}`, { headers: { 'X-Api-Key': KEY } });
const code = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('validation search/nearby/places (không DB)', () => {
  it('search không có q lẫn category/bbox/near → 400', async () => {
    const res = await fetchApi('/v1/search');
    expect(res.status).toBe(400);
    expect(await code(res)).toBe('invalid_request');
  });
  it('search radius vượt 50000 bị kẹp, limit vượt 50 bị kẹp — qua validate rồi chết ở DB → 503', async () => {
    const res = await fetchApi('/v1/search?q=pho&near=10.77,106.70&radius=999999&limit=999');
    expect(res.status).toBe(503);
  });
  it('nearby thiếu lat,lng → 400; đủ → 503 (DB đóng)', async () => {
    expect((await fetchApi('/v1/nearby')).status).toBe(400);
    expect((await fetchApi('/v1/nearby?lat=10.77&lng=106.70')).status).toBe(503);
  });
  it('places/{id} không auth → 401; có auth + DB đóng → 503', async () => {
    const anon = await SELF.fetch('https://api/v1/places/abc');
    expect(anon.status).toBe(401);
    expect((await fetchApi('/v1/places/abc')).status).toBe(503);
  });
});
```

- [x] **Step 2: Chạy để thấy fail**

Run: `pnpm --filter @mapslibvn/api test`
Expected: FAIL — các route trả 404 not_found.

- [x] **Step 3: Viết `apps/api/src/place.ts`**

```ts
import type { Place } from '@mapslibvn/core';
import type { getSql } from './db';

type Sql = ReturnType<typeof getSql>;

export interface PlaceRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  housenumber: string | null;
  street: string | null;
  ward: string | null;
  province: string | null;
  address_text: string | null;
  contact: Record<string, unknown> | null;
  hours: unknown;
  quality_score: number | null;
  status: Place['status'];
  /** porsager trả Date cho timestamptz. */
  updated_at: string | Date;
  cat_code: string | null;
  cat_group: string | null;
  cat_vi: string | null;
  cat_en: string | null;
  /** count(*) OVER() là int8 — porsager trả string. */
  total?: string | number;
  d?: number;
}

/** Cột SELECT chuẩn cho Place — luôn dùng alias `p` (poi) và `c` (category). */
export function placeColumns(sql: Sql) {
  return sql`p.id, p.name, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng,
    p.housenumber, p.street, p.ward, p.province, p.address_text,
    p.contact, p.hours, p.quality_score, p.status, p.updated_at,
    c.code AS cat_code, c.group_code AS cat_group, c.name_vi AS cat_vi, c.name_en AS cat_en`;
}

export function toPlace(r: PlaceRow): Place {
  return {
    id: r.id,
    name: r.name,
    category: r.cat_code
      ? { code: r.cat_code, group: r.cat_group ?? '', name_vi: r.cat_vi ?? '', name_en: r.cat_en ?? '' }
      : null,
    lat: r.lat,
    lng: r.lng,
    address: {
      ...(r.housenumber ? { housenumber: r.housenumber } : {}),
      ...(r.street ? { street: r.street } : {}),
      ...(r.ward ? { ward: r.ward } : {}),
      ...(r.province ? { province: r.province } : {}),
      ...(r.address_text ? { text: r.address_text } : {}),
    },
    contact: r.contact,
    hours: r.hours,
    quality_score: r.quality_score,
    status: r.status,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}
```

Lưu ý: kiểu `Place` import từ `@mapslibvn/core` — **Task 8 mới thêm `types.ts` vào core**. Để Task 5 tự chạy độc lập, tạm khai kiểu tại chỗ nếu Task 8 chưa chạy: thêm đầu file `place.ts` một interface `Place` cục bộ y hệt khối "Kiểu dữ liệu" ở Task 8 Step 2, rồi khi làm Task 8 thay bằng import. **Nếu thực hiện plan tuần tự theo thứ tự khuyến nghị (xem "Thứ tự thực hiện" cuối plan) thì làm Task 8 Step 1–3 trước Task 5** — khi đó dùng thẳng import như trên.

- [x] **Step 4: Viết `apps/api/src/routes/search.ts`**

```ts
import { normalizeVi } from '@mapslibvn/core';
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { clampInt, parseBbox, parseLatLngPair } from '../params';
import { type PlaceRow, placeColumns, toPlace } from '../place';

export const search = new Hono<AppEnv>();

search.get('/v1/search', requireAuth(), async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const category = c.req.query('category');
  const near = parseLatLngPair(c.req.query('near'), 'near');
  const bbox = parseBbox(c.req.query('bbox'));
  if (!q && !category && !near && !bbox)
    throw new ApiError(400, 'invalid_request', 'Cần ít nhất một trong q, category, near, bbox');
  const radius = clampInt(c.req.query('radius'), 1, 50_000, 5_000, 'radius');
  const limit = clampInt(c.req.query('limit'), 1, 50, 20, 'limit');
  const offset = clampInt(c.req.query('offset'), 0, 500, 0, 'offset');
  const qn = q ? normalizeVi(q) : '';

  const sql = getSql(c.env);
  try {
    const nearPt = near ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)` : null;
    const rows = await sql<PlaceRow[]>`
      SELECT ${placeColumns(sql)}, count(*) OVER() AS total
        ${nearPt ? sql`, ST_DistanceSphere(p.geom, ${nearPt}) AS d` : sql``}
      FROM poi p LEFT JOIN category c ON c.code = p.category
      WHERE p.status = 'active'
        ${qn ? sql`AND (p.name_norm % ${qn} OR starts_with(p.name_norm, ${qn}))` : sql``}
        ${category ? sql`AND p.category = ${category}` : sql``}
        ${nearPt ? sql`AND ST_DWithin(p.geom::geography, ${nearPt}::geography, ${radius})` : sql``}
        ${bbox ? sql`AND p.geom && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)` : sql``}
      ORDER BY ${qn ? sql`similarity(p.name_norm, ${qn}) DESC` : nearPt ? sql`d ASC` : sql`p.updated_at DESC`}
      LIMIT ${limit} OFFSET ${offset}`;
    return c.json({ items: rows.map(toPlace), total: rows[0]?.total ? Number(rows[0].total) : 0 });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error('search', err);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});
```

- [x] **Step 5: Viết `apps/api/src/routes/nearby.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { clampInt } from '../params';
import { type PlaceRow, placeColumns, toPlace } from '../place';

export const nearby = new Hono<AppEnv>();

nearby.get('/v1/nearby', requireAuth(), async (c) => {
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw new ApiError(400, 'invalid_request', 'lat, lng bắt buộc và phải hợp lệ');
  const radius = clampInt(c.req.query('radius'), 1, 5_000, 500, 'radius');
  const limit = clampInt(c.req.query('limit'), 1, 100, 20, 'limit');
  const category = c.req.query('category');

  const sql = getSql(c.env);
  try {
    const pt = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;
    const rows = await sql<PlaceRow[]>`
      SELECT ${placeColumns(sql)}, ST_DistanceSphere(p.geom, ${pt}) AS d
      FROM poi p LEFT JOIN category c ON c.code = p.category
      WHERE p.status = 'active'
        AND ST_DWithin(p.geom::geography, ${pt}::geography, ${radius})
        ${category ? sql`AND p.category = ${category}` : sql``}
      ORDER BY d ASC
      LIMIT ${limit}`;
    return c.json({ items: rows.map(toPlace) });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error('nearby', err);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});
```

- [x] **Step 6: Viết `apps/api/src/routes/places.ts`** (cache 1 giờ — spec 6.1)

```ts
import { attributionHtml, attributionText } from '@mapslibvn/core';
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { type PlaceRow, placeColumns, toPlace } from '../place';

export const places = new Hono<AppEnv>();

places.get('/v1/places/:id', requireAuth(), async (c) => {
  const id = c.req.param('id');
  const cacheUrl = `https://cache.mapslibvn/place?id=${encodeURIComponent(id)}`;
  return cachedJson(c.executionCtx, cacheUrl, 3600, 7200, async () => {
    const sql = getSql(c.env);
    try {
      const [row] = await sql<PlaceRow[]>`
        SELECT ${placeColumns(sql)}
        FROM poi p LEFT JOIN category c ON c.code = p.category
        WHERE p.id = ${id} AND p.status IN ('active', 'closed')`;
      if (!row) throw new ApiError(404, 'not_found', 'Không có POI này');
      const sources = await sql<{ source: string; source_id: string; role: string }[]>`
        SELECT source, source_id, role FROM poi_source_link WHERE poi_id = ${id}`;
      return {
        ...toPlace(row),
        sources,
        attribution: { text: attributionText(), html: attributionHtml() },
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      console.error('places/:id', err);
      throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  });
});
```

Lưu ý: 404 ném từ trong `cachedJson` sẽ **không** bị stale che khuất, kể cả khi cache key từng có
dữ liệu. `cachedJson` chỉ fallback stale cho lỗi upstream 5xx/ngoại lệ hạ tầng.

- [x] **Step 7: Mount trong `apps/api/src/index.ts`**

```ts
import { nearby } from './routes/nearby';
import { places } from './routes/places';
import { search } from './routes/search';
// … cạnh app.route('/', autocomplete):
app.route('/', search);
app.route('/', nearby);
app.route('/', places);
```

- [x] **Step 8: Chạy test + typecheck, rồi commit**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS.

```bash
git add apps/api/src/place.ts apps/api/src/routes/{search,nearby,places}.ts apps/api/src/index.ts apps/api/test/places-routes.test.ts
git commit -m "feat(api): /v1/search, /v1/nearby, /v1/places/{id} — Place chuẩn spec 6.1"
```

**✅ Task 5 ĐÃ XONG (31/08/2026).** TDD xác nhận RED cho route 404, bbox sai và cache stale che
404; GREEN đạt 11 file / 45 test API, typecheck và lint sạch. Ba route đều có auth, validation biên,
SQL parameterized và giới hạn truy vấn; place detail cache 1 giờ, stale tối đa 2 giờ chỉ cho lỗi
upstream. Smoke thật với PostgreSQL local trả HTTP 200 cho search (512 kết quả Highlands), nearby
và place detail (đủ source + attribution). Dữ liệu thật xác nhận `contact` là JSON hỗn hợp
(mảng/null), nên contract dùng `Record<string, unknown>`. **Điểm bắt đầu phiên sau: Task 6 Step 1 —
viết helper `apps/api/src/geocode.ts` cho thang phân giải 5 bước spec 6.3.**

---

### Task 6: Thang phân giải geocode + `GET /v1/geocode`, `GET /v1/reverse`

5 bước spec 6.3 trong `apps/api/src/geocode.ts` (nhận `sql` làm tham số → Task 7 test bằng DB thật). Reverse "≈ 86–90" theo spec.

**Files:**
- Create: `apps/api/src/geocode.ts`, `apps/api/src/routes/geocode.ts`, `apps/api/src/routes/reverse.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/geocode.test.ts`, `apps/api/test/geocode-routes.test.ts`

- [x] **Step 1: Viết `apps/api/src/geocode.ts`**

```ts
import { type GeocodeItem, type ParsedAddress, normalizeVi, parseAddress } from '@mapslibvn/core';
import type { getSql } from './db';
import type { LatLng } from './params';

type Sql = ReturnType<typeof getSql>;

interface Ctx {
  sql: Sql;
  parsed: ParsedAddress;
  near: LatLng | null;
  limit: number;
}

const nearPt = (sql: Sql, near: LatLng | null) =>
  near ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)` : null;

const displayName = (parts: (string | undefined | null)[]) => parts.filter(Boolean).join(', ');

/** Thang 5 bước spec 6.3 — dừng ở bước đầu tiên có kết quả. */
export async function geocode(
  sql: Sql,
  q: string,
  near: LatLng | null,
  limit: number,
): Promise<GeocodeItem[]> {
  const parsed = parseAddress(q);
  const ctx: Ctx = { sql, parsed, near, limit };
  if (parsed.streetNorm && parsed.housenumber) {
    const s1 = await stepAnchor(ctx);
    if (s1.length) return s1;
    if (parsed.alleyChain.length) {
      const s2 = await stepAlley(ctx);
      if (s2.length) return s2;
    }
    const s3 = await stepInterpolate(ctx);
    if (s3.length) return s3;
  }
  if (parsed.streetNorm) {
    const s4 = await stepStreet(ctx);
    if (s4.length) return s4;
  }
  return stepAdmin(ctx, q);
}

/** Bước 1 — mốc address_anchor trùng số nhà (kể cả chuỗi hẻm) + đường: rooftop 0.9/0.95. */
async function stepAnchor({ sql, parsed, near, limit }: Ctx): Promise<GeocodeItem[]> {
  const pt = nearPt(sql, near);
  const wardNorm = parsed.ward ? normalizeVi(parsed.ward) : null;
  const rows = await sql<
    { lat: number; lng: number; ward_norm: string | null; province_norm: string | null; source: string }[]
  >`SELECT ST_Y(geom) AS lat, ST_X(geom) AS lng, ward_norm, province_norm, source
    FROM address_anchor
    WHERE housenumber = ${parsed.housenumber as string} AND street_norm = ${parsed.streetNorm as string}
      ${wardNorm ? sql`AND (ward_norm = ${wardNorm} OR ward_norm IS NULL)` : sql``}
    ORDER BY ${pt ? sql`ST_DistanceSphere(geom, ${pt}) ASC` : sql`id ASC`}
    LIMIT ${limit}`;
  return rows.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    precision: 'rooftop' as const,
    confidence: r.source === 'user' ? 0.95 : 0.9,
    // exactOptionalPropertyTypes: không gán string|undefined vào prop optional — spread có điều kiện
    matched: {
      housenumber: parsed.housenumber as string,
      ...(parsed.street ? { street: parsed.street } : {}),
      ...(r.ward_norm ? { ward: r.ward_norm } : {}),
      ...(r.province_norm ? { province: r.province_norm } : {}),
    },
    display_name: displayName([
      `${parsed.housenumber} ${parsed.street ?? ''}`.trim(),
      r.ward_norm,
      r.province_norm,
    ]),
  }));
}

/** Bước 2 — hẻm số = alleyChain[0] thuộc đường khớp: điểm cách entrance
 *  min(dài hẻm, 6 m × số nhà trong hẻm), alley 0.7. */
async function stepAlley({ sql, parsed, near, limit }: Ctx): Promise<GeocodeItem[]> {
  const pt = nearPt(sql, near);
  const houseNo = Number.parseInt(parsed.houseInAlley ?? '0', 10) || 0;
  const rows = await sql<{ lat: number; lng: number }[]>`
    SELECT ST_Y(pt) AS lat, ST_X(pt) AS lng FROM (
      SELECT a.geom, CASE
        WHEN a.entrance IS NULL THEN ST_LineInterpolatePoint(a.geom, 0)
        ELSE ST_LineInterpolatePoint(a.geom, greatest(0, least(1,
          CASE WHEN ST_LineLocatePoint(a.geom, a.entrance) < 0.5
            THEN ST_LineLocatePoint(a.geom, a.entrance)
              + ${6 * houseNo} / NULLIF(ST_Length(a.geom::geography), 0)
            ELSE ST_LineLocatePoint(a.geom, a.entrance)
              - ${6 * houseNo} / NULLIF(ST_Length(a.geom::geography), 0)
          END)))
      END AS pt
      FROM alley a JOIN street s ON s.id = a.parent_street_id
      WHERE a.number = ${parsed.alleyChain[0] as string} AND s.name_norm = ${parsed.streetNorm as string}
      ORDER BY ${pt ? sql`ST_DistanceSphere(a.geom, ${pt}) ASC` : sql`a.id ASC`}
      LIMIT ${limit}
    ) t`;
  return rows.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    precision: 'alley' as const,
    confidence: 0.7,
    matched: {
      housenumber: parsed.housenumber as string,
      ...(parsed.street ? { street: parsed.street } : {}),
    },
    display_name: displayName([`${parsed.housenumber} ${parsed.street ?? ''}`.trim(), parsed.ward, parsed.province]),
  }));
}

/** Bước 3 — nội suy giữa hai mốc cùng chẵn/lẻ kẹp hai bên, cách nhau ≤ 400 m: interpolated 0.6.
 *  Số dùng nội suy là đoạn số đầu của housenumber ("88/9" → 88). */
async function stepInterpolate({ sql, parsed, near }: Ctx): Promise<GeocodeItem[]> {
  const n = Number.parseInt(parsed.housenumber as string, 10);
  if (!Number.isFinite(n)) return [];
  const wardNorm = parsed.ward ? normalizeVi(parsed.ward) : null;
  const [row] = await sql<
    | {
        lo_hn: number; hi_hn: number; gap: number;
        lo_lat: number; lo_lng: number; hi_lat: number; hi_lng: number;
        ward_norm: string | null; province_norm: string | null;
      }[]
  >`WITH numeric_candidates AS (
      SELECT geom,
        CASE WHEN housenumber ~ '^[0-9]{1,9}$' THEN housenumber::int END AS hn,
        ward_norm, province_norm
      FROM address_anchor
      WHERE street_norm = ${parsed.streetNorm as string}
        ${wardNorm ? sql`AND (ward_norm = ${wardNorm} OR ward_norm IS NULL)` : sql``}
    ),
    candidates AS (
      SELECT * FROM numeric_candidates
      WHERE hn IS NOT NULL AND hn % 2 = ${((n % 2) + 2) % 2}
    ),
    lo AS (SELECT * FROM candidates WHERE hn < ${n} ORDER BY hn DESC LIMIT 1),
    hi AS (SELECT * FROM candidates WHERE hn > ${n} ORDER BY hn ASC LIMIT 1)
    SELECT lo.hn AS lo_hn, hi.hn AS hi_hn,
      ST_DistanceSphere(lo.geom, hi.geom) AS gap,
      ST_Y(lo.geom) AS lo_lat, ST_X(lo.geom) AS lo_lng,
      ST_Y(hi.geom) AS hi_lat, ST_X(hi.geom) AS hi_lng,
      lo.ward_norm, lo.province_norm
    FROM lo, hi`;
  if (!row || Number(row.gap) > 400) return [];
  // Chiếu lên tuyến đường khi gộp được thành LINESTRING; không thì nội suy thẳng giữa hai mốc.
  const t = (n - row.lo_hn) / (row.hi_hn - row.lo_hn);
  let lat = row.lo_lat + (row.hi_lat - row.lo_lat) * t;
  let lng = row.lo_lng + (row.hi_lng - row.lo_lng) * t;
  const [proj] = await sql<{ lat: number; lng: number }[]>`
    SELECT ST_Y(pt) AS lat, ST_X(pt) AS lng FROM (
      SELECT ST_LineInterpolatePoint(line, f_lo + (f_hi - f_lo) * ${t}) AS pt FROM (
        SELECT ST_LineMerge(geom) AS line,
          ST_LineLocatePoint(ST_LineMerge(geom), ST_SetSRID(ST_MakePoint(${row.lo_lng}, ${row.lo_lat}), 4326)) AS f_lo,
          ST_LineLocatePoint(ST_LineMerge(geom), ST_SetSRID(ST_MakePoint(${row.hi_lng}, ${row.hi_lat}), 4326)) AS f_hi
        FROM street
        WHERE name_norm = ${parsed.streetNorm as string}
          AND GeometryType(ST_LineMerge(geom)) = 'LINESTRING'
          AND ST_DWithin(geom::geography,
            ST_SetSRID(ST_MakePoint(${row.lo_lng}, ${row.lo_lat}), 4326)::geography, 100)
        LIMIT 1
      ) s
    ) t2`;
  if (proj) {
    lat = proj.lat;
    lng = proj.lng;
  }
  return [
    {
      lat,
      lng,
      precision: 'interpolated' as const,
      confidence: 0.6,
      matched: {
        housenumber: parsed.housenumber as string,
        ...(parsed.street ? { street: parsed.street } : {}),
        ...(row.ward_norm ? { ward: row.ward_norm } : {}),
        ...(row.province_norm ? { province: row.province_norm } : {}),
      },
      display_name: displayName([
        `${parsed.housenumber} ${parsed.street ?? ''}`.trim(),
        row.ward_norm,
        row.province_norm,
      ]),
    },
  ];
}

/** Bước 4 — khớp street (ưu tiên phường/tỉnh trong câu, rồi near); nhiều đường trùng tên
 *  → trả nhiều kết quả tới limit: street 0.4. */
async function stepStreet({ sql, parsed, near, limit }: Ctx): Promise<GeocodeItem[]> {
  const pt = nearPt(sql, near);
  const wardNorm = parsed.ward ? normalizeVi(parsed.ward) : null;
  const provNorm = parsed.province ? normalizeVi(parsed.province) : null;
  const query = (exact: boolean) => sql<
    {
      name: string; province_norm: string | null; lat: number; lng: number;
      xmin: number; ymin: number; xmax: number; ymax: number;
    }[]
  >`SELECT name, province_norm,
      ST_Y(mid) AS lat, ST_X(mid) AS lng,
      ST_XMin(env) AS xmin, ST_YMin(env) AS ymin, ST_XMax(env) AS xmax, ST_YMax(env) AS ymax
    FROM (
      SELECT *, ST_Envelope(geom) AS env,
        CASE WHEN GeometryType(ST_LineMerge(geom)) = 'LINESTRING'
          THEN ST_LineInterpolatePoint(ST_LineMerge(geom), 0.5)
          ELSE ST_PointOnSurface(geom) END AS mid
      FROM street
      WHERE ${exact ? sql`name_norm = ${parsed.streetNorm as string}` : sql`name_norm % ${parsed.streetNorm as string}`}
        ${wardNorm ? sql`AND ${wardNorm} = ANY(ward_norm)` : sql``}
        ${provNorm ? sql`AND province_norm = ${provNorm}` : sql``}
    ) s
    ORDER BY ${pt ? sql`ST_DistanceSphere(s.geom, ${pt}) ASC` : sql`s.id ASC`}
    LIMIT ${limit}`;
  let rows = await query(true);
  if (rows.length === 0 && wardNorm === null && provNorm === null) rows = await query(false);
  return rows.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    precision: 'street' as const,
    confidence: 0.4,
    matched: { street: r.name, ...(r.province_norm ? { province: r.province_norm } : {}) },
    display_name: displayName([r.name, parsed.ward, r.province_norm]),
    bbox: [r.xmin, r.ymin, r.xmax, r.ymax] as [number, number, number, number],
  }));
}

/** Bước 5 — admin_area (kèm alias): ward/province 0.2. */
async function stepAdmin({ sql, parsed, limit }: Ctx, q: string): Promise<GeocodeItem[]> {
  const nn = normalizeVi(parsed.ward ?? parsed.district ?? parsed.province ?? q);
  if (!nn) return [];
  const rows = await sql<
    { name: string; level: number; lat: number; lng: number; xmin: number; ymin: number; xmax: number; ymax: number }[]
  >`SELECT DISTINCT ON (a.id) a.name, a.level,
      ST_Y(ST_PointOnSurface(a.geom)) AS lat, ST_X(ST_PointOnSurface(a.geom)) AS lng,
      ST_XMin(a.geom) AS xmin, ST_YMin(a.geom) AS ymin, ST_XMax(a.geom) AS xmax, ST_YMax(a.geom) AS ymax
    FROM admin_area a
    LEFT JOIN admin_alias al ON al.admin_area_id = a.id
    WHERE a.name_norm = ${nn} OR al.alias_norm = ${nn}
    ORDER BY a.id, a.level DESC
    LIMIT ${limit}`;
  rows.sort((a, b) => b.level - a.level); // phường trước tỉnh
  return rows.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    precision: (r.level >= 6 ? 'ward' : 'province') as 'ward' | 'province',
    confidence: 0.2,
    matched: r.level >= 6 ? { ward: r.name } : { province: r.name },
    display_name: r.name,
    bbox: [r.xmin, r.ymin, r.xmax, r.ymax] as [number, number, number, number],
  }));
}
```

- [x] **Step 2: Viết `apps/api/src/routes/geocode.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { geocode } from '../geocode';
import { clampInt, parseLatLngPair } from '../params';

export const geocodeRoute = new Hono<AppEnv>();

geocodeRoute.get('/v1/geocode', requireAuth(), async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) throw new ApiError(400, 'invalid_request', 'q phải có ít nhất 2 ký tự');
  const near = parseLatLngPair(c.req.query('near'), 'near');
  const limit = clampInt(c.req.query('limit'), 1, 5, 5, 'limit');
  const sql = getSql(c.env);
  try {
    return c.json({ items: await geocode(sql, q, near, limit) });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error('geocode', err);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});
```

- [x] **Step 3: Viết `apps/api/src/routes/reverse.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { type PlaceRow, placeColumns, toPlace } from '../place';

export const reverse = new Hono<AppEnv>();

reverse.get('/v1/reverse', requireAuth(), async (c) => {
  const latRaw = c.req.query('lat')?.trim();
  const lngRaw = c.req.query('lng')?.trim();
  const lat = latRaw ? Number(latRaw) : Number.NaN;
  const lng = lngRaw ? Number(lngRaw) : Number.NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw new ApiError(400, 'invalid_request', 'lat, lng bắt buộc và phải hợp lệ');
  const sql = getSql(c.env);
  try {
    const pt = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;
    // Đường gần nhất trong 150 m
    const [street] = await sql<{ name: string; name_norm: string }[]>`
      SELECT name, name_norm FROM street
      WHERE ST_DWithin(geom::geography, ${pt}::geography, 150)
      ORDER BY ST_Distance(geom::geography, ${pt}::geography) ASC LIMIT 1`;
    // "≈ 86–90": 2 mốc số gần nhất trên đường đó (spec 6.3)
    let approx: string | undefined;
    if (street) {
      const anchors = await sql<{ hn: number }[]>`
        SELECT CASE WHEN housenumber ~ '^[0-9]{1,9}$' THEN housenumber::int END AS hn
        FROM address_anchor
        WHERE street_norm = ${street.name_norm} AND housenumber ~ '^[0-9]{1,9}$'
          AND ST_DWithin(geom::geography, ${pt}::geography, 300)
        ORDER BY ST_DistanceSphere(geom, ${pt}) ASC LIMIT 2`;
      // noUncheckedIndexedAccess: lấy phần tử qua destructure + guard, không index thẳng
      const [first, second] = anchors;
      if (first && second) {
        const lo = Math.min(first.hn, second.hn);
        const hi = Math.max(first.hn, second.hn);
        approx = lo === hi ? `≈ ${lo}` : `≈ ${lo}–${hi}`;
      } else if (first) {
        approx = `≈ ${first.hn}`;
      }
    }
    // Phường/tỉnh chứa điểm
    const admins = await sql<{ name: string; level: number }[]>`
      SELECT name, level FROM admin_area
      WHERE ST_Contains(geom, ${pt}) AND level IN (4, 8) ORDER BY level DESC`;
    const ward = admins.find((a) => a.level === 8)?.name;
    const province = admins.find((a) => a.level === 4)?.name;
    // POI gần nhất trong 100 m
    const [poiRow] = await sql<PlaceRow[]>`
      SELECT ${placeColumns(sql)}
      FROM poi p LEFT JOIN category c ON c.code = p.category
      WHERE p.status = 'active' AND ST_DWithin(p.geom::geography, ${pt}::geography, 100)
      ORDER BY ST_DistanceSphere(p.geom, ${pt}) ASC LIMIT 1`;
    const nearestPoi = poiRow ? toPlace(poiRow) : null;

    const displayName = [
      approx && street ? `${approx} ${street.name}` : street?.name,
      !street && nearestPoi ? `gần ${nearestPoi.name}` : undefined,
      ward,
      province,
    ]
      .filter(Boolean)
      .join(', ');
    return c.json({
      address: {
        ...(approx ? { approx_housenumber: approx } : {}),
        ...(street ? { street: street.name } : {}),
        ...(ward ? { ward } : {}),
        ...(province ? { province } : {}),
        display_name: displayName,
      },
      nearest_poi: nearestPoi,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error('reverse', err);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});
```

- [x] **Step 4: Mount trong `apps/api/src/index.ts`**

```ts
import { geocodeRoute } from './routes/geocode';
import { reverse } from './routes/reverse';
// … cạnh các app.route hiện có:
app.route('/', geocodeRoute);
app.route('/', reverse);
```

- [x] **Step 5: Chạy test + typecheck**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS. Thực tế Task 6 thêm test auth/validation/error-path cho hai route và regression helper;
hành vi DB cô lập đầy đủ tiếp tục được khóa ở Task 7.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/geocode.ts apps/api/src/routes/{geocode,reverse}.ts apps/api/src/index.ts
git commit -m "feat(api): thang geocode 5 bước 6.3 + /v1/geocode, /v1/reverse"
```

**✅ Task 6 ĐÃ XONG (31/08/2026).** TDD RED đạt 5/5 case route trả 404; GREEN đạt 13 file /
52 test API, typecheck và lint sạch. Smoke PostgreSQL quốc gia (923.567 anchor, 61.154 street,
3.288 admin area) trả HTTP 200 cho đủ rooftop 0.9, alley 0.7, interpolated 0.6, street 0.4,
ward 0.2 và reverse có địa chỉ + POI gần nhất. Dữ liệu thật lộ 41 giá trị số nhà dài 10–25 chữ
số gây overflow khi ép `int`; cả geocode/reverse đã giới hạn 1–9 chữ số và có regression guard.
**Điểm bắt đầu phiên sau: Task 7 Step 1 — tạo `apps/api/test-db/setup.sql` cho DB integration cô
lập và hai fixture nghiệm thu bắt buộc.**

---

### Task 7: Integration test DB thật — 2 fixture bắt buộc + workflow `apitest.yml`

Chuỗi: DB cô lập → migrate → seed `setup.sql` (dữ liệu tổng hợp — quyết định 2) → `wrangler dev` (Miniflare, Hyperdrive local) → vitest fetch. Chạy local bằng `pnpm test:api-db`, CI bằng workflow riêng.

**Files:**
- Create: `apps/api/test-db/setup.sql`, `apps/api/test-db/places.itest.mjs`, `apps/api/vitest.itest.config.ts`, `scripts/api-db-test.mjs`, `.github/workflows/apitest.yml`
- Modify: `package.json` (root — script `test:api-db`)

- [ ] **Step 1: Viết `apps/api/test-db/setup.sql`**

```sql
-- Dữ liệu tổng hợp cho integration test Places API. Cả hai fixture nghiệm thu M3
-- (Linh Xuân 10.856 và Nguyễn Lâm 10.765/106.663) nằm NGOÀI bbox fixture Quận 1
-- nên seed tay, không đi qua pipeline. Idempotent: DELETE theo id trước khi INSERT.

INSERT INTO category (code, group_code, name_vi, name_en, icon, rank) VALUES
  ('primary_school', 'education', 'Trường tiểu học', 'Primary school', 'school', 4),
  ('cafe', 'food_drink', 'Quán cà phê', 'Cafe', 'cafe', 3)
ON CONFLICT (code) DO NOTHING;

-- Hành chính: tỉnh bao trùm cả hai khu fixture + 2 phường
DELETE FROM admin_area WHERE osm_relation_id IN (880000000001, 880000000002, 880000000003);
INSERT INTO admin_area (level, name, name_norm, osm_relation_id, geom) VALUES
  (4, 'Thành phố Hồ Chí Minh', 'ho chi minh', 880000000001,
    ST_Multi(ST_MakeEnvelope(106.30, 10.30, 107.10, 11.20, 4326))),
  (8, 'Phường Diên Hồng', 'dien hong', 880000000002,
    ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.6631, 10.7647), 4326), 0.01))),
  (8, 'Phường Linh Xuân', 'linh xuan', 880000000003,
    ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.77325, 10.85594), 4326), 0.01)));

-- Đường Nguyễn Lâm: một ở HCM (đi qua toạ độ đích fixture), một trùng tên ở Hà Nội
DELETE FROM street WHERE osm_way_ids && ARRAY[880000000011, 880000000012]::bigint[];
INSERT INTO street (osm_way_ids, name, name_norm, ward_norm, province_norm, geom) VALUES
  ('{880000000011}', 'Nguyễn Lâm', 'nguyen lam', '{dien hong}', 'ho chi minh',
    ST_Multi(ST_GeomFromText('LINESTRING(106.6626 10.7647, 106.6636 10.7647)', 4326))),
  ('{880000000012}', 'Nguyễn Lâm', 'nguyen lam', '{}', 'ha noi',
    ST_Multi(ST_GeomFromText('LINESTRING(105.8400 21.0000, 105.8410 21.0000)', 4326)));

-- Hẻm 112 thuộc Nguyễn Lâm HCM (test bước 2 — alley)
DELETE FROM alley WHERE osm_way_id = 880000000021;
INSERT INTO alley (osm_way_id, number, parent_street_id, name, geom, entrance)
SELECT 880000000021, '112', s.id, 'Hẻm 112 Nguyễn Lâm',
  ST_GeomFromText('LINESTRING(106.6630 10.7647, 106.6630 10.7657)', 4326),
  ST_SetSRID(ST_MakePoint(106.6630, 10.7647), 4326)
FROM street s WHERE s.name_norm = 'nguyen lam' AND s.province_norm = 'ho chi minh';

-- Mốc số nhà: 86 và 90 kẹp số 88, cùng chẵn, cách nhau ~44 m (≤ 400 m) → bước 3 nội suy
-- ra đúng (10.7647, 106.6631). KHÔNG seed mốc '88/9' và hẻm 88 để bước 1, 2 trượt.
DELETE FROM address_anchor WHERE source_id LIKE 'm3test-%';
INSERT INTO address_anchor
  (housenumber, street_norm, ward_norm, province_norm, geom, source, source_id, confidence) VALUES
  ('86', 'nguyen lam', 'dien hong', 'ho chi minh',
    ST_SetSRID(ST_MakePoint(106.6629, 10.7647), 4326), 'osm', 'm3test-86', 0.9),
  ('90', 'nguyen lam', 'dien hong', 'ho chi minh',
    ST_SetSRID(ST_MakePoint(106.6633, 10.7647), 4326), 'osm', 'm3test-90', 0.9),
  ('92', 'nguyen lam', 'dien hong', 'ho chi minh',
    ST_SetSRID(ST_MakePoint(106.6635, 10.7647), 4326), 'osm', 'm3test-92', 0.9);

-- POI: 3 trường "Hoàng Diệu" (Linh Xuân tên khớp hẳn + pop cao nhất + gần near nhất
-- trong 3 → đứng đầu) + 1 quán Highlands để test autocomplete/nearby/details
DELETE FROM poi WHERE id LIKE '01M3TEST%';
INSERT INTO poi (id, name, name_norm, category, geom, ward, province, address_text,
                 quality_score, popularity, status, primary_source, primary_source_id, created_by) VALUES
  ('01M3TEST0000000000000SCH01', 'Trường Tiểu học Hoàng Diệu', 'truong tieu hoc hoang dieu',
    'primary_school', ST_SetSRID(ST_MakePoint(106.77325, 10.85594), 4326),
    'Linh Xuân', 'Thành phố Hồ Chí Minh', 'Trường Tiểu học Hoàng Diệu, Linh Xuân, TP.HCM',
    80, 0.9, 'active', 'osm', 'm3test-sch1', 'pipeline'),
  ('01M3TEST0000000000000SCH02', 'Trường Tiểu học Hoàng Diệu 2', 'truong tieu hoc hoang dieu 2',
    'primary_school', ST_SetSRID(ST_MakePoint(106.79000, 10.87000), 4326),
    'Linh Trung', 'Thành phố Hồ Chí Minh', NULL, 60, 0.4, 'active', 'osm', 'm3test-sch2', 'pipeline'),
  ('01M3TEST0000000000000SCH03', 'Trường Tiểu học Hoàng Diệu 3', 'truong tieu hoc hoang dieu 3',
    'primary_school', ST_SetSRID(ST_MakePoint(106.80000, 10.88000), 4326),
    'Bình Chiểu', 'Thành phố Hồ Chí Minh', NULL, 60, 0.2, 'active', 'osm', 'm3test-sch3', 'pipeline'),
  ('01M3TEST0000000000000CAF01', 'Highlands Coffee Test', 'highlands coffee test',
    'cafe', ST_SetSRID(ST_MakePoint(106.70000, 10.77200), 4326),
    'Bến Thành', 'Thành phố Hồ Chí Minh', '1 Test, Bến Thành', 70, 0.8, 'active',
    'osm', 'm3test-caf1', 'pipeline');

DELETE FROM poi_source_link WHERE source_id LIKE 'm3test-%';
INSERT INTO poi_source_link (poi_id, source, source_id, confidence, role) VALUES
  ('01M3TEST0000000000000SCH01', 'osm', 'm3test-sch1', 1, 'primary');

-- Tenant + khoá cho itest (kind=server: không kiểm origin)
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-0000000000aa', 'M3 itest', 'internal')
ON CONFLICT (id) DO NOTHING;
INSERT INTO api_key (key, tenant_id, label, kind, scopes)
VALUES ('mlv_live_test00000000000000000000', '00000000-0000-4000-8000-0000000000aa',
        'itest server', 'server', '{places:read}')
ON CONFLICT (key) DO NOTHING;
```

Đã đối chiếu `0003_core.sql`: cột NOT NULL không default của `poi` là `name`, `name_norm`, `geom`, `status`, `created_by` — INSERT trên đủ hết; các cột khác nullable hoặc có default (`locked_fields`, `created_at`, `updated_at`).

- [ ] **Step 2: Viết `apps/api/vitest.itest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

// Integration test Places API: chạy bằng scripts/api-db-test.mjs (đã dựng DB + wrangler dev).
export default defineConfig({
  test: {
    include: ['test-db/**/*.itest.mjs'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

- [ ] **Step 3: Viết `apps/api/test-db/places.itest.mjs`**

```js
// Chạy qua `pnpm test:api-db` — script dựng DB cô lập + seed setup.sql + wrangler dev
// rồi đặt PLACES_API_BASE. KHÔNG chạy trực tiếp bằng vitest thường.
import { describe, expect, it } from 'vitest';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const KEY = 'mlv_live_test00000000000000000000';

const get = async (path, headers = { 'X-Api-Key': KEY }) => {
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: await res.json() };
};
const distM = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
const enc = encodeURIComponent;

describe('2 fixture nghiệm thu bắt buộc (spec mục 10)', () => {
  it('autocomplete "Trường Tiểu học Hoàng Diệu" near=10.77,106.70 → ≥ 3 kết quả, Linh Xuân đầu', async () => {
    const { status, body } = await get(
      `/v1/autocomplete?q=${enc('Trường Tiểu học Hoàng Diệu')}&near=10.77,106.70`,
    );
    expect(status).toBe(200);
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    const first = body.items[0];
    expect(first.type).toBe('poi');
    expect(first.name).toBe('Trường Tiểu học Hoàng Diệu');
    expect(distM(first.lat, first.lng, 10.85594, 106.77325)).toBeLessThanOrEqual(50);
  });
  it('geocode "88/9 Nguyễn Lâm" near=10.76,106.66 → interpolated, cách (10.7647,106.6631) ≤ 60 m', async () => {
    const { status, body } = await get(`/v1/geocode?q=${enc('88/9 Nguyễn Lâm')}&near=10.76,106.66`);
    expect(status).toBe(200);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const item = body.items[0];
    expect(item.precision).toBe('interpolated');
    expect(item.confidence).toBe(0.6);
    expect(distM(item.lat, item.lng, 10.7647, 106.6631)).toBeLessThanOrEqual(60);
  });
});

describe('thang geocode và các route còn lại', () => {
  it('bước 1 rooftop: "86 Nguyễn Lâm" → rooftop 0.9', async () => {
    const { body } = await get(`/v1/geocode?q=${enc('86 Nguyễn Lâm')}&near=10.76,106.66`);
    expect(body.items[0].precision).toBe('rooftop');
    expect(body.items[0].confidence).toBe(0.9);
  });
  it('bước 2 alley: "112/5 Nguyễn Lâm" → alley 0.7, điểm nằm trong hẻm (≤ 60 m từ entrance)', async () => {
    const { body } = await get(`/v1/geocode?q=${enc('112/5 Nguyễn Lâm')}&near=10.76,106.66`);
    expect(body.items[0].precision).toBe('alley');
    expect(distM(body.items[0].lat, body.items[0].lng, 10.7647, 106.663)).toBeLessThanOrEqual(60);
  });
  it('bước 4 street: "Nguyễn Lâm" trùng tên 2 nơi — near HCM chọn HCM trước', async () => {
    const { body } = await get(`/v1/geocode?q=${enc('Nguyễn Lâm')}&near=10.76,106.66`);
    expect(body.items[0].precision).toBe('street');
    expect(body.items[0].lat).toBeCloseTo(10.7647, 2);
  });
  it('bước 5 admin: "Phường Linh Xuân" → ward 0.2', async () => {
    const { body } = await get(`/v1/geocode?q=${enc('Phường Linh Xuân')}`);
    expect(body.items[0].precision).toBe('ward');
  });
  it('reverse tại (10.7647,106.6631) → "≈ 86–90", đường Nguyễn Lâm, phường/tỉnh điền', async () => {
    const { body } = await get('/v1/reverse?lat=10.7647&lng=106.6631');
    expect(body.address.approx_housenumber).toBe('≈ 86–90');
    expect(body.address.street).toBe('Nguyễn Lâm');
    expect(body.address.ward).toBe('Phường Diên Hồng');
    expect(body.address.province).toBe('Thành phố Hồ Chí Minh');
  });
  it('autocomplete "highlands" → có Highlands Coffee Test, score giảm dần', async () => {
    const { body } = await get('/v1/autocomplete?q=highlands&near=10.77,106.70');
    expect(body.items[0].name).toBe('Highlands Coffee Test');
    const scores = body.items.map((i) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
  it('search q + near: shape {items, total}, Place đúng khung spec 6.1', async () => {
    const { body } = await get(`/v1/search?q=${enc('hoang dieu')}&near=10.86,106.77&radius=50000`);
    expect(body.total).toBeGreaterThanOrEqual(3);
    const p = body.items[0];
    for (const k of ['id', 'name', 'category', 'lat', 'lng', 'address', 'quality_score', 'status', 'updated_at'])
      expect(p).toHaveProperty(k);
    expect(p.category.code).toBe('primary_school');
  });
  it('nearby quanh Highlands 200 m → tìm thấy', async () => {
    const { body } = await get('/v1/nearby?lat=10.772&lng=106.700&radius=200');
    expect(body.items.some((p) => p.id === '01M3TEST0000000000000CAF01')).toBe(true);
  });
  it('places/{id} → Place + sources[] + attribution; id lạ → 404', async () => {
    const { body } = await get('/v1/places/01M3TEST0000000000000SCH01');
    expect(body.sources).toEqual([{ source: 'osm', source_id: 'm3test-sch1', role: 'primary' }]);
    expect(body.attribution.text).toContain('OpenStreetMap');
    expect((await get('/v1/places/khong-ton-tai')).status).toBe(404);
  });
  it('auth trên DB thật: thiếu key 401, key lạ 401 invalid_key', async () => {
    expect((await get('/v1/autocomplete?q=highlands', {})).status).toBe(401);
    const res = await get('/v1/autocomplete?q=highlands', {
      'X-Api-Key': 'mlv_live_khongtontai00000000000000',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_key');
  });
});
```

- [ ] **Step 4: Viết `scripts/api-db-test.mjs`**

```js
#!/usr/bin/env node
// Integration test Places API trên DB thật:
//   DB cô lập → migrate → seed setup.sql → wrangler dev (Hyperdrive local) → vitest.
// Local: pnpm db:up && pnpm test:api-db. CI: .github/workflows/apitest.yml.
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { DBTEST_DATABASE, isolatedDbUrl } from './lib/db-test.mjs';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

const PORT = 8799;
const target = isolatedDbUrl(databaseUrlFromEnv(process.env));

// 1. DB sạch (giống scripts/db-test.mjs)
const admin = new URL(target);
admin.pathname = '/postgres';
{
  const sql = postgres(admin.href, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DBTEST_DATABASE}' AND pid <> pg_backend_pid()`,
    );
    await sql.unsafe(`DROP DATABASE IF EXISTS ${DBTEST_DATABASE}`);
    await sql.unsafe(`CREATE DATABASE ${DBTEST_DATABASE} TEMPLATE template0`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
console.log(`API itest DB: ${target.hostname}/${DBTEST_DATABASE}`);

// 2. Migrate + seed
const run = (cmd, args, extraEnv = {}) => {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: target.href, ...extraEnv },
  });
  if (r.status !== 0) {
    console.error(`${cmd} ${args.join(' ')} thất bại (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
};
run('node', ['scripts/db-migrate.mjs']);
{
  const sql = postgres(target.href, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(await readFile('apps/api/test-db/setup.sql', 'utf8'));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// 3. wrangler dev local, Hyperdrive trỏ DB cô lập
const wrangler = spawn(
  'pnpm',
  ['--filter', '@mapslibvn/api', 'exec', 'wrangler', 'dev', '--port', String(PORT)],
  {
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB: target.href },
  },
);
const stop = () => {
  if (!wrangler.killed) wrangler.kill('SIGTERM');
};
process.on('exit', stop);

const deadline = Date.now() + 90_000;
let up = false;
while (Date.now() < deadline && !up) {
  try {
    up = (await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!up) {
  console.error('wrangler dev không lên trong 90 s');
  stop();
  process.exit(1);
}

// 4. Vitest itest
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--config', 'apps/api/vitest.itest.config.ts'],
  {
    stdio: 'inherit',
    env: { ...process.env, PLACES_API_BASE: `http://127.0.0.1:${PORT}` },
  },
);
stop();
process.exit(result.status ?? 1);
```

- [ ] **Step 5: Thêm script gốc + chạy local**

`package.json` gốc, khối scripts: `"test:api-db": "node scripts/api-db-test.mjs",`

```bash
pnpm db:up && pnpm test:api-db
```

Expected: toàn bộ itest PASS, đặc biệt 2 fixture bắt buộc. Debug nhanh nếu đỏ:
- `interpolated` sai toạ độ → kiểm `stepInterpolate` (t = (88−86)/(90−86) = 0.5, kỳ vọng đúng (10.7647, 106.6631)).
- Linh Xuân không đứng đầu → in `body.items` và đối chiếu điểm từng thành phần với `ranking.test.ts` kịch bản fixture.

- [ ] **Step 6: Viết `.github/workflows/apitest.yml`**

(Version pnpm/node đã đối chiếu khớp `.github/workflows/ci.yml`: pnpm 9.15.0, node 22.)

```yaml
name: API test (Places, DB that)
on:
  push:
    branches: [main]
    paths:
      - 'apps/api/**'
      - 'packages/core/**'
      - 'db/migrations/**'
      - 'scripts/api-db-test.mjs'
      - 'scripts/lib/**'
      - '.github/workflows/apitest.yml'
  workflow_dispatch:
concurrency:
  group: apitest-${{ github.ref }}
  cancel-in-progress: true
jobs:
  apitest:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_USER: mapslibvn
          POSTGRES_PASSWORD: mapslibvn
          POSTGRES_DB: mapslibvn
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U mapslibvn"
          --health-interval 5s --health-timeout 5s --health-retries 12
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/style build
      - run: node scripts/api-db-test.mjs
        env:
          DATABASE_URL: postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn
```

- [ ] **Step 7: Commit + xem CI**

```bash
git add apps/api/test-db apps/api/vitest.itest.config.ts scripts/api-db-test.mjs .github/workflows/apitest.yml package.json
git commit -m "test(api): integration DB that — 2 fixture nghiem thu M3 + workflow apitest"
git push
gh run watch $(gh run list --workflow=apitest.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

Expected: workflow `apitest` xanh (~5 phút). Nếu `wrangler dev` không chạy được trên runner, xem log workerd; phương án dự phòng: đổi bước cuối sang chạy trong container node:22-bookworm.

---

### Task 8: Core — kiểu dữ liệu + 6 phương thức client

`createClient` đủ 8 phương thức (spec 7.1, trừ `suggestEdit` — M4). Kiểm size-limit ≤ 8 kB gzip sau khi thêm.

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/client.places.test.ts`
- Modify: `packages/core/src/client.ts`, `packages/core/src/index.ts`

- [ ] **Step 1: Viết test — `packages/core/src/client.places.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function stubClient(body: unknown) {
  const fetch = vi.fn(async () => jsonResponse(body));
  const client = createClient({
    apiKey: 'mlv_live_test00000000000000000000',
    baseUrl: 'https://api.test',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const calledUrl = () => new URL((fetch.mock.calls[0] as unknown[])[0] as string | URL);
  return { client, fetch, calledUrl };
}

describe('client places methods', () => {
  it('autocomplete: đúng path, near nối "lat,lng", types nối bằng phẩy, có X-Api-Key', async () => {
    const { client, fetch, calledUrl } = stubClient({ items: [] });
    await client.autocomplete('highlands', { near: [10.77, 106.7], limit: 5, types: ['poi', 'street'] });
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/autocomplete');
    expect(url.searchParams.get('q')).toBe('highlands');
    expect(url.searchParams.get('near')).toBe('10.77,106.7');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('types')).toBe('poi,street');
    const init = (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Api-Key']).toMatch(/^mlv_live_/);
  });
  it('search/nearby/geocode/reverse/getPlace: đúng path và tham số', async () => {
    const { client, calledUrl, fetch } = stubClient({ items: [], total: 0 });
    await client.search('pho', { category: 'cafe', near: [10.7, 106.7], radius: 1000 });
    expect(calledUrl().pathname).toBe('/v1/search');
    expect(calledUrl().searchParams.get('category')).toBe('cafe');
    fetch.mockClear();
    await client.nearby({ lat: 10.7, lng: 106.7, radius: 300 });
    expect(calledUrl().pathname).toBe('/v1/nearby');
    fetch.mockClear();
    await client.geocode('88/9 Nguyễn Lâm', { near: [10.76, 106.66] });
    expect(calledUrl().pathname).toBe('/v1/geocode');
    fetch.mockClear();
    await client.reverse(10.7647, 106.6631);
    expect(calledUrl().pathname).toBe('/v1/reverse');
    expect(calledUrl().searchParams.get('lat')).toBe('10.7647');
    fetch.mockClear();
    await client.getPlace('01ABC');
    expect(calledUrl().pathname).toBe('/v1/places/01ABC');
  });
});
```

- [ ] **Step 2: Chạy fail, rồi viết `packages/core/src/types.ts`**

Run: `pnpm exec vitest run packages/core` → FAIL (chưa có method).

```ts
/** Kiểu dữ liệu Places API (spec 6.1) — dùng chung Worker và SDK. */
export interface PlaceCategory {
  code: string;
  group: string;
  name_vi: string;
  name_en: string;
}

export interface PlaceAddress {
  housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
  text?: string;
}

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory | null;
  lat: number;
  lng: number;
  address: PlaceAddress;
  contact?: Record<string, unknown> | null;
  hours?: unknown;
  quality_score: number | null;
  status: 'active' | 'closed' | 'pending' | 'rejected';
  updated_at: string;
}

export interface PlaceSource {
  source: 'osm' | 'overture' | 'fsq';
  source_id: string;
  role: 'primary' | 'secondary';
}

export interface PlaceDetails extends Place {
  sources: PlaceSource[];
  attribution: { text: string; html: string };
}

export type GeocodePrecision = 'rooftop' | 'alley' | 'interpolated' | 'street' | 'ward' | 'province';

export type AutocompleteType = 'poi' | 'street' | 'address';

export interface AutocompleteItem {
  type: AutocompleteType;
  id?: string;
  name: string;
  secondary: string;
  lat: number;
  lng: number;
  precision?: GeocodePrecision;
  score: number;
}

export interface GeocodeMatched {
  housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
}

export interface GeocodeItem {
  lat: number;
  lng: number;
  precision: GeocodePrecision;
  confidence: number;
  matched: GeocodeMatched;
  display_name: string;
  bbox?: [number, number, number, number];
}

export interface ReverseAddress {
  approx_housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
  display_name: string;
}

export interface ReverseResponse {
  address: ReverseAddress;
  nearest_poi: Place | null;
}
```

- [ ] **Step 3: Thêm 6 phương thức vào `packages/core/src/client.ts`**

Thêm import đầu file:

```ts
import type {
  AutocompleteItem,
  AutocompleteType,
  GeocodeItem,
  Place,
  PlaceDetails,
  ReverseResponse,
} from './types';
```

Trong object trả về của `createClient` (sau `styleUrl`), thêm:

```ts
    autocomplete: (
      q: string,
      opts: { near?: [number, number]; limit?: number; types?: AutocompleteType[] } = {},
    ) =>
      get<{ items: AutocompleteItem[] }>('/v1/autocomplete', {
        q,
        near: opts.near?.join(','),
        limit: opts.limit,
        types: opts.types?.join(','),
      }),
    search: (
      q: string,
      opts: {
        category?: string;
        near?: [number, number];
        radius?: number;
        bbox?: [number, number, number, number];
        limit?: number;
        offset?: number;
      } = {},
    ) =>
      get<{ items: Place[]; total: number }>('/v1/search', {
        q,
        category: opts.category,
        near: opts.near?.join(','),
        radius: opts.radius,
        bbox: opts.bbox?.join(','),
        limit: opts.limit,
        offset: opts.offset,
      }),
    nearby: (opts: { lat: number; lng: number; radius?: number; category?: string; limit?: number }) =>
      get<{ items: Place[] }>('/v1/nearby', {
        lat: opts.lat,
        lng: opts.lng,
        radius: opts.radius,
        category: opts.category,
        limit: opts.limit,
      }),
    getPlace: (id: string) => get<PlaceDetails>(`/v1/places/${encodeURIComponent(id)}`),
    geocode: (q: string, opts: { near?: [number, number]; limit?: number } = {}) =>
      get<{ items: GeocodeItem[] }>('/v1/geocode', {
        q,
        near: opts.near?.join(','),
        limit: opts.limit,
      }),
    reverse: (lat: number, lng: number) =>
      get<ReverseResponse>('/v1/reverse', { lat, lng }),
```

- [ ] **Step 4: Export types — `packages/core/src/index.ts`**

```ts
export * from './attribution';
export * from './client';
export * from './errors';
export * from './normalize';
export * from './address';
export * from './types';
```

- [ ] **Step 5: Test + build (size-limit) + typecheck toàn repo**

Run: `pnpm --filter @mapslibvn/core build && pnpm exec vitest run packages/core && pnpm -r typecheck`
Expected: PASS; dòng size-limit của core in kích cỡ **≤ 8 kB** gzip (types chỉ tăng .d.ts, 6 method dùng chung `get()` chỉ thêm ~1–2 kB). Nếu vượt: rút gọn message lỗi/chuỗi trước, không đổi API.

Đồng thời Task 5 `place.ts` giờ import `Place` từ core: nếu trước đó khai kiểu cục bộ thì thay bằng `import type { Place } from '@mapslibvn/core';` rồi `pnpm --filter @mapslibvn/api typecheck`.

- [ ] **Step 6: Commit** (đụng `packages/core` → CI `dbtest.yml` + `deploy-api.yml` sẽ chạy — phải xanh)

```bash
git add packages/core/src/types.ts packages/core/src/client.ts packages/core/src/index.ts packages/core/src/client.places.test.ts apps/api/src/place.ts
git commit -m "feat(core): kiểu Places API + 6 phương thức client (đủ 8 theo spec 7.1)"
```

---

### Task 9: Web component `<mapslibvn-autocomplete>` + playground + E2E "highlands ≤ 1 s"

Custom element không phụ thuộc framework, debounce 200 ms, phát event `select` (spec 7.2). Near lấy từ property `.map` (quyết định 7).

**Files:**
- Create: `packages/web/src/autocomplete-element.ts`
- Modify: `packages/web/src/index.ts`, `packages/web/src/umd.ts`, `apps/docs/public/playground.html`, `apps/docs/e2e/playground.spec.ts`

- [ ] **Step 1: Viết `packages/web/src/autocomplete-element.ts`**

```ts
import {
  type AutocompleteItem,
  type MapsLibVNClient,
  createClient,
} from '@mapslibvn/core';

/** Đối tượng tối thiểu để lấy near — gán map của createMap vào property `.map`. */
interface NearSource {
  gl: { getCenter(): { lat: number; lng: number } };
}

const STYLE = `
:host { display: block; position: relative; font: 14px system-ui, sans-serif; }
input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #bbb;
  border-radius: 6px; font: inherit; }
ul { position: absolute; left: 0; right: 0; margin: 2px 0 0; padding: 0; list-style: none;
  background: #fff; border: 1px solid #ccc; border-radius: 6px; z-index: 30;
  max-height: 280px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,.15); }
li { padding: 7px 10px; cursor: pointer; }
li:hover, li[aria-selected="true"] { background: #eef; }
li .secondary { color: #777; font-size: 12px; display: block; }
`;

export class MapsLibVNAutocomplete extends HTMLElement {
  static observedAttributes = ['api-key', 'api-base', 'placeholder', 'near'];

  /** Gán map trả về từ createMap để dùng tâm bản đồ làm near. */
  map: NearSource | null = null;

  #client: MapsLibVNClient | null = null;
  #input!: HTMLInputElement;
  #list!: HTMLUListElement;
  #items: AutocompleteItem[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #seq = 0;

  connectedCallback() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style><input type="search" autocomplete="off" /><ul hidden></ul>`;
    this.#input = root.querySelector('input') as HTMLInputElement;
    this.#list = root.querySelector('ul') as HTMLUListElement;
    this.#input.placeholder = this.getAttribute('placeholder') ?? 'Tìm địa điểm…';
    this.#input.addEventListener('input', () => {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.#query(this.#input.value), 200); // spec 7.3: debounce 200 ms
    });
    this.#input.addEventListener('blur', () => setTimeout(() => this.#render([]), 200));
  }

  attributeChangedCallback() {
    this.#client = null; // đổi key/base → tạo lại client lần gọi sau
  }

  #getClient(): MapsLibVNClient | null {
    if (this.#client) return this.#client;
    const apiKey = this.getAttribute('api-key');
    const baseUrl = this.getAttribute('api-base');
    if (!apiKey || !baseUrl) return null;
    this.#client = createClient({ apiKey, baseUrl });
    return this.#client;
  }

  #near(): [number, number] | undefined {
    if (this.map) {
      const c = this.map.gl.getCenter();
      return [c.lat, c.lng];
    }
    const attr = this.getAttribute('near');
    if (!attr) return undefined;
    // noUncheckedIndexedAccess: guard tường minh trước khi trả tuple
    const parts = attr.split(',').map(Number);
    const lat = parts[0];
    const lng = parts[1];
    if (lat === undefined || lng === undefined) return undefined;
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : undefined;
  }

  async #query(raw: string) {
    const q = raw.trim();
    const client = this.#getClient();
    if (!client || q.length < 2) return this.#render([]);
    const seq = ++this.#seq;
    try {
      const { items } = await client.autocomplete(q, { near: this.#near() });
      if (seq === this.#seq) this.#render(items);
    } catch {
      if (seq === this.#seq) this.#render([]); // lỗi mạng/API: đóng danh sách, không ném
    }
  }

  #render(items: AutocompleteItem[]) {
    this.#items = items;
    this.#list.hidden = items.length === 0;
    this.#list.innerHTML = '';
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.dataset.index = String(i);
      const name = document.createElement('span');
      name.textContent = item.name;
      const secondary = document.createElement('span');
      secondary.className = 'secondary';
      secondary.textContent = item.secondary;
      li.append(name, secondary);
      li.addEventListener('mousedown', () => this.#select(i)); // mousedown chạy trước blur
      this.#list.append(li);
    });
  }

  #select(i: number) {
    const item = this.#items[i];
    if (!item) return;
    this.#input.value = item.name;
    this.#render([]);
    this.dispatchEvent(new CustomEvent('select', { detail: item, bubbles: true, composed: true }));
  }
}

export function defineAutocomplete(): void {
  if (!customElements.get('mapslibvn-autocomplete'))
    customElements.define('mapslibvn-autocomplete', MapsLibVNAutocomplete);
}
```

- [ ] **Step 2: Export ESM + tự đăng ký trong UMD**

`packages/web/src/index.ts` — thêm:

```ts
export { MapsLibVNAutocomplete, defineAutocomplete } from './autocomplete-element';
```

`packages/web/src/umd.ts` — thêm import + gọi ngay (bản UMD nhúng `<script>` phải dùng được element luôn):

```ts
import { defineAutocomplete } from './autocomplete-element';
defineAutocomplete();
export { MapsLibVNAutocomplete, defineAutocomplete } from './autocomplete-element';
```

- [ ] **Step 3: Build web + kiểm size-limit**

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web build`
Expected: PASS, ESM ≤ 15 kB gzip, UMD ≤ 350 kB gzip.

- [ ] **Step 4: Cập nhật `apps/docs/public/playground.html`**

Thay khoá mặc định và thêm ô autocomplete. Trong `<style>` thêm:

```css
    mapslibvn-autocomplete { position: fixed; top: 8px; right: 8px; width: 320px; z-index: 20; }
```

Trong `<body>`, sau `<div id="status" …>`:

```html
  <mapslibvn-autocomplete id="ac" placeholder="Tìm địa điểm…"></mapslibvn-autocomplete>
```

Trong `<script>`: đổi `params.get('key') || 'mlv_live_demo'` thành
`params.get('key') || 'mlv_live_demo00000000000000000000'` (khoá web seed ở Task 1), và sau `window.__map = map;` thêm:

```js
      const ac = document.getElementById('ac');
      ac.setAttribute('api-key', params.get('key') || 'mlv_live_demo00000000000000000000');
      ac.setAttribute('api-base', apiBase);
      ac.map = map;
      ac.addEventListener('select', (e) => {
        const item = e.detail;
        map.flyTo([item.lng, item.lat], 16);
        status.textContent = `Đã chọn: ${item.name}`;
      });
```

Không cần copy SDK tay: `apps/docs/scripts/copy-sdk.mjs` đã chạy tự động qua hook `predev`/`prebuild` của `@mapslibvn/docs` — chỉ cần `pnpm --filter @mapslibvn/web build` trước khi chạy docs.

- [ ] **Step 5: Thêm E2E test — `apps/docs/e2e/playground.spec.ts`**

Thêm vào cuối file:

```ts
test('gõ "highlands" có gợi ý ≤ 1 s, chọn thì hiện tên', async ({ page }) => {
  await page.goto('/playground.html?api=http://localhost:8787');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });
  const input = page.locator('mapslibvn-autocomplete input');
  await input.fill('highlands');
  // spec mục 10: gợi ý xuất hiện ≤ 1 s (200 ms debounce + API local)
  await expect(page.locator('mapslibvn-autocomplete li').first()).toBeVisible({ timeout: 1_000 });
  const firstName = await page
    .locator('mapslibvn-autocomplete li')
    .first()
    .locator('span')
    .first()
    .textContent();
  expect(firstName?.toLowerCase()).toContain('highlands');
  await page.locator('mapslibvn-autocomplete li').first().dispatchEvent('mousedown');
  await expect(page.locator('#status')).toContainText('Đã chọn:');
});
```

- [ ] **Step 6: Chạy E2E local (điều kiện: DB fixture + tenant)**

```bash
pnpm db:up && pnpm db:fixture        # ~vài phút, nạp POI Quận 1 (có Highlands thật)
pnpm db:seed-tenant                  # khoá demo cho auth
pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web build
pnpm --filter @mapslibvn/docs build  # prebuild tự copy SDK vào public/sdk
pnpm --filter @mapslibvn/docs e2e
```

Expected: 3 test E2E PASS (2 cũ + highlands mới). Nếu autocomplete rỗng: kiểm `curl 'http://localhost:8787/v1/autocomplete?q=highlands' -H 'X-Api-Key: mlv_live_server000000000000000000'` xem DB fixture có Highlands không.

Lưu ý: E2E **không chạy trong CI** (ci.yml không có Playwright, và cần DB fixture) — đây là bước chạy tay, bắt buộc trước nghiệm thu Task 12.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/autocomplete-element.ts packages/web/src/index.ts packages/web/src/umd.ts apps/docs/public/playground.html apps/docs/e2e/playground.spec.ts
git commit -m "feat(web): <mapslibvn-autocomplete> + playground autocomplete + E2E highlands ≤ 1 s"
```

---

### Task 10: `@mapslibvn/react` + React demo trong docs

`<MapsLibVNMap>`, `<Marker>`, `useMap()`, `usePlaces()` (SWR-style, debounce 200 ms — spec 7.3). Demo trong docs qua Astro React island (nghiệm thu "React demo").

**Files:**
- Create: `packages/react/package.json`, `packages/react/tsconfig.json`, `packages/react/src/{index.ts,map.tsx,marker.tsx,use-places.ts}`, `packages/react/src/use-places.test.ts`
- Modify: `package.json` (root devDeps test React), `apps/docs/astro.config.mjs`, `apps/docs/package.json`
- Create: `apps/docs/src/components/ReactDemo.tsx`, `apps/docs/src/pages/react-demo.astro`

- [ ] **Step 1: Scaffold package**

`packages/react/package.json`:

```json
{
  "name": "@mapslibvn/react",
  "version": "0.1.0",
  "description": "React bindings MapsLibVN: <MapsLibVNMap>, <Marker>, useMap, usePlaces",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean --target es2022 --external react --external maplibre-gl --external pmtiles",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": { "maplibre-gl": "^5.0.0", "react": ">=18" },
  "dependencies": { "@mapslibvn/core": "workspace:*", "@mapslibvn/web": "workspace:*" },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "maplibre-gl": "^5.0.0",
    "react": "^18.3.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0"
  }
}
```

`packages/react/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["react"]
  },
  "include": ["src"]
}
```

Root `package.json` devDependencies thêm (cho vitest chạy test hook ở root):

```json
"@testing-library/react": "^16.0.0",
"@types/react-dom": "^18.3.0",
"jsdom": "^25.0.0",
"react": "^18.3.0",
"react-dom": "^18.3.0"
```

Rồi `pnpm install`.

- [ ] **Step 2: Viết `packages/react/src/context.ts` và `packages/react/src/map.tsx`**

`context.ts` tách riêng có chủ đích: `use-places.ts` (và test của nó, chạy trong vitest gốc — ci.yml `pnpm test` **không** build `@mapslibvn/web`) chỉ import `MapContext` từ đây; import từ `@mapslibvn/web` là type-only nên bị xoá lúc biên dịch, runtime không cần dist của web/maplibre:

```ts
import type { MapsLibVNMap as WebMap } from '@mapslibvn/web';
import { createContext } from 'react';

export const MapContext = createContext<WebMap | null>(null);
```

`map.tsx`:

```tsx
import {
  type CreateMapOptions,
  type MapsLibVNMap as WebMap,
  type PoiFeature,
  createMap,
} from '@mapslibvn/web';
import maplibregl from 'maplibre-gl';
import {
  type CSSProperties,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { MapContext } from './context';

export interface MapsLibVNMapProps extends Omit<CreateMapOptions, 'container'> {
  className?: string;
  /** style CSS của div chứa map — khác prop `style` (theme) kế thừa từ CreateMapOptions. */
  containerStyle?: CSSProperties;
  onPoiClick?: (poi: PoiFeature) => void;
  onLoad?: (map: WebMap) => void;
  children?: ReactNode;
}

export function MapsLibVNMap({
  className,
  containerStyle,
  onPoiClick,
  onLoad,
  children,
  ...opts
}: MapsLibVNMapProps) {
  const div = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<WebMap | null>(null);
  const handlers = useRef({ onPoiClick, onLoad });
  handlers.current = { onPoiClick, onLoad };

  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ tạo lại map khi key/base/style đổi
  useEffect(() => {
    if (!div.current) return;
    const m = createMap(
      { ...opts, container: div.current },
      { maplibre: maplibregl as never },
    );
    m.on('poiClick', (poi) => handlers.current.onPoiClick?.(poi));
    m.on('load', () => handlers.current.onLoad?.(m));
    setMap(m);
    return () => {
      m.remove();
      setMap(null);
    };
  }, [opts.apiKey, opts.apiBase, opts.style]);

  return (
    <div ref={div} className={className} style={{ width: '100%', height: '100%', ...containerStyle }}>
      {map ? <MapContext.Provider value={map}>{children}</MapContext.Provider> : null}
    </div>
  );
}

/** Map hiện hành — chỉ dùng bên trong <MapsLibVNMap>. */
export function useMap(): WebMap {
  const map = useContext(MapContext);
  if (!map) throw new Error('useMap phải được gọi bên trong <MapsLibVNMap>');
  return map;
}
```

- [ ] **Step 3: Viết `packages/react/src/marker.tsx`**

```tsx
import type { MarkerOptions } from '@mapslibvn/web';
import { useEffect } from 'react';
import { useMap } from './map';

export function Marker(props: MarkerOptions) {
  const map = useMap();
  useEffect(() => {
    const marker = map.addMarker(props);
    return () => marker.remove();
  }, [map, props.lng, props.lat, props.popupHtml, props.color]);
  return null;
}
```

- [ ] **Step 4: Viết `packages/react/src/use-places.ts`**

```ts
import type { AutocompleteItem, MapsLibVNClient } from '@mapslibvn/core';
import { useContext, useEffect, useState } from 'react';
import { MapContext } from './context';

export interface UsePlacesOptions {
  near?: [number, number];
  limit?: number;
  debounceMs?: number;
  /** Client tường minh — bắt buộc khi dùng ngoài <MapsLibVNMap>. */
  client?: MapsLibVNClient;
}

export interface UsePlacesResult {
  items: AutocompleteItem[];
  loading: boolean;
  error: Error | null;
}

/** Autocomplete kiểu SWR: debounce 200 ms, huỷ kết quả cũ khi query đổi (spec 7.3). */
export function usePlaces(query: string, opts: UsePlacesOptions = {}): UsePlacesResult {
  const mapClient = useContext(MapContext)?.places ?? null;
  const client = opts.client ?? mapClient;
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const nearKey = opts.near ? opts.near.join(',') : '';

  useEffect(() => {
    if (!client || query.trim().length < 2) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const near = nearKey ? (nearKey.split(',').map(Number) as [number, number]) : undefined;
        const res = await client.autocomplete(query, { near, limit: opts.limit });
        if (!cancelled) {
          setItems(res.items);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, opts.debounceMs ?? 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, query, nearKey, opts.limit, opts.debounceMs]);

  return { items, loading, error };
}
```

- [ ] **Step 5: `packages/react/src/index.ts`**

```ts
export { MapsLibVNMap, useMap } from './map';
export type { MapsLibVNMapProps } from './map';
export { Marker } from './marker';
export { usePlaces } from './use-places';
export type { UsePlacesOptions, UsePlacesResult } from './use-places';
export type { AutocompleteItem, MapsLibVNClient, Place } from '@mapslibvn/core';
```

- [ ] **Step 6: Viết test — `packages/react/src/use-places.test.ts`**

```ts
// @vitest-environment jsdom
import type { MapsLibVNClient } from '@mapslibvn/core';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaces } from './use-places';

const item = { type: 'poi' as const, name: 'Highlands', secondary: '', lat: 1, lng: 2, score: 0.9 };
const makeClient = () =>
  ({ autocomplete: vi.fn(async () => ({ items: [item] })) }) as unknown as MapsLibVNClient;

describe('usePlaces', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('query < 2 ký tự → không gọi API, items rỗng', () => {
    const client = makeClient();
    const { result } = renderHook(() => usePlaces('h', { client }));
    vi.advanceTimersByTime(500);
    expect(client.autocomplete).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it('debounce 200 ms: chưa gọi ở 100 ms, gọi đúng 1 lần sau 200 ms rồi có items', async () => {
    const client = makeClient();
    const { result } = renderHook(() => usePlaces('highlands', { client }));
    vi.advanceTimersByTime(100);
    expect(client.autocomplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(client.autocomplete).toHaveBeenCalledTimes(1);
    vi.useRealTimers(); // chờ promise resolve
    await waitFor(() => expect(result.current.items).toEqual([item]));
    expect(result.current.loading).toBe(false);
  });

  it('đổi query trước khi hết debounce → chỉ gọi cho query cuối', () => {
    const client = makeClient();
    const { rerender } = renderHook(({ q }) => usePlaces(q, { client }), {
      initialProps: { q: 'high' },
    });
    vi.advanceTimersByTime(100);
    rerender({ q: 'highlands' });
    vi.advanceTimersByTime(250);
    expect(client.autocomplete).toHaveBeenCalledTimes(1);
    expect(client.autocomplete).toHaveBeenCalledWith('highlands', expect.anything());
  });
});
```

- [ ] **Step 7: Chạy test + build + typecheck**

Run: `pnpm install && pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/react build && pnpm --filter @mapslibvn/react typecheck && pnpm exec vitest run packages/react`
Expected: PASS. (Root vitest tự nhặt `packages/react/src/**/*.test.ts` — pragma jsdom trên đầu file lo phần môi trường.)

- [ ] **Step 8: React demo trong docs**

`apps/docs/package.json` — thêm dependencies:

```json
"@astrojs/react": "^4.0.0",
"@mapslibvn/react": "workspace:*",
"maplibre-gl": "^5.0.0",
"react": "^18.3.0",
"react-dom": "^18.3.0"
```

`apps/docs/astro.config.mjs` — thêm integration:

```js
import react from '@astrojs/react';
// trong defineConfig: integrations: [...(hiện có), react()],
```

`.github/workflows/deploy-docs.yml` — docs giờ phụ thuộc `@mapslibvn/react`, phải sửa 2 chỗ:

```yaml
    paths: ['apps/docs/**', 'packages/web/**', 'packages/core/**', 'packages/react/**', 'pnpm-lock.yaml']
# và bước build:
      - run: pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/react build && pnpm --filter @mapslibvn/docs build
```

`apps/docs/src/components/ReactDemo.tsx` (search đặt ngoài `<MapsLibVNMap>` nên `usePlaces` nhận client tường minh):

```tsx
import { createClient } from '@mapslibvn/core';
import { MapsLibVNMap, Marker, usePlaces } from '@mapslibvn/react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useState } from 'react';

const API_KEY = 'mlv_live_demo00000000000000000000';
const apiBase =
  new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('api') ??
  'http://localhost:8787';
const client = createClient({ apiKey: API_KEY, baseUrl: apiBase });

export default function ReactDemo() {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<[number, number] | null>(null);
  const { items, loading } = usePlaces(query, { client, near: [10.776, 106.7] });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: '80vh', gap: 8 }}>
      <div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm địa điểm…"
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
        {loading ? <p>Đang tìm…</p> : null}
        <ul>
          {items.map((item) => (
            <li key={`${item.type}-${item.name}-${item.lat}`}>
              <button type="button" onClick={() => setTarget([item.lng, item.lat])}>
                {item.name} <small>{item.secondary}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <MapsLibVNMap apiKey={API_KEY} apiBase={apiBase} center={[106.7, 10.776]} zoom={13}>
        {target ? <Marker lng={target[0]} lat={target[1]} /> : null}
      </MapsLibVNMap>
    </div>
  );
}
```

`apps/docs/src/pages/react-demo.astro`:

```astro
---
import ReactDemo from '../components/ReactDemo';
---
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <title>MapsLibVN — React demo</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <h1>React demo — @mapslibvn/react</h1>
    <ReactDemo client:only="react" />
  </body>
</html>
```

- [ ] **Step 9: Chạy demo tay**

```bash
pnpm install
pnpm --filter @mapslibvn/docs dev   # mở http://localhost:4321/react-demo (cần wrangler dev 8787 + DB fixture + seed tenant đang chạy)
```

Trên docs production (deploy-docs.yml tự deploy): trang mở với `?api=https://<api-domain>` vì apiBase mặc định là localhost — ghi link đầy đủ vào DEVLOG khi nghiệm thu.

Expected: map hiện, gõ "highlands" ra danh sách, bấm kết quả thấy marker. Chụp lại một screenshot cho DEVLOG (nghiệm thu "React demo").

- [ ] **Step 10: Commit**

```bash
git add packages/react apps/docs/astro.config.mjs apps/docs/package.json apps/docs/src/components/ReactDemo.tsx apps/docs/src/pages/react-demo.astro .github/workflows/deploy-docs.yml package.json pnpm-lock.yaml
git commit -m "feat(react): @mapslibvn/react (<MapsLibVNMap>, Marker, useMap, usePlaces) + demo docs"
```

---

### Task 11: Quota + đo lường (Analytics Engine) + tenant free thử nghiệm

Spec 6.4: đếm KV theo `(key, ngày VN, nhóm)`, chặn 429 ở **2×** quota, tenant `internal` không ghi KV; Analytics Engine ghi `(tenant, key, endpoint, status, ms)` cho mọi request `/v1/*`.

**Files:**
- Create: `apps/api/src/quota.ts`, `apps/api/src/analytics.ts`, `db/seed/tenant_free_test.sql`
- Modify: `apps/api/src/index.ts` (mount), `apps/api/src/errors.ts` (Retry-After 429), `apps/api/wrangler.toml` (vars + binding), `apps/api/vitest.config.ts` (binding test)
- Test: `apps/api/test/quota.test.ts`

- [ ] **Step 1: Viết test — `apps/api/test/quota.test.ts`**

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';

const FREE_KEY = 'mlv_live_freetest0000000000000000';
const seedFree = (quota: number | null) =>
  env.META.put(
    `apikey:${FREE_KEY}`,
    JSON.stringify({
      key: FREE_KEY,
      tenantId: '00000000-0000-4000-8000-0000000000bb',
      plan: 'free',
      kind: 'server',
      scopes: ['places:read'],
      allowedOrigins: [],
      quotaPlacesPerDay: quota,
    }),
  );
const call = () =>
  SELF.fetch('https://api/v1/autocomplete?q=highlands', { headers: { 'X-Api-Key': FREE_KEY } });

describe('quota (QUOTA_ENABLED=1 trong vitest.config)', () => {
  it('vnDay trả YYYY-MM-DD theo giờ VN (+7)', () => {
    expect(vnDay(new Date('2026-08-31T18:00:00Z'))).toBe('2026-09-01'); // 01:00 VN hôm sau
    expect(vnDay(new Date('2026-08-31T16:59:00Z'))).toBe('2026-08-31'); // 23:59 VN
  });
  it('đếm dưới 2× quota → cho qua (chết ở DB đóng = 503, không phải 429)', async () => {
    await seedFree(10);
    await env.META.put(`quota:${FREE_KEY}:${vnDay()}:places`, '19');
    expect((await call()).status).toBe(503);
  });
  it('đếm đạt 2× quota → 429 quota_exceeded + Retry-After', async () => {
    await seedFree(10);
    await env.META.put(`quota:${FREE_KEY}:${vnDay()}:places`, '20');
    const res = await call();
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('quota_exceeded');
    expect(res.headers.get('retry-after')).toBeTruthy();
  });
  it('plan internal không bị đếm/chặn dù counter cao', async () => {
    const KEY = 'mlv_live_test00000000000000000000';
    await env.META.put(
      `apikey:${KEY}`,
      JSON.stringify({
        key: KEY,
        tenantId: 't',
        plan: 'internal',
        kind: 'server',
        scopes: ['places:read'],
        allowedOrigins: [],
        quotaPlacesPerDay: 1,
      }),
    );
    await env.META.put(`quota:${KEY}:${vnDay()}:places`, '999999');
    const res = await SELF.fetch('https://api/v1/autocomplete?q=highlands', {
      headers: { 'X-Api-Key': KEY },
    });
    expect(res.status).toBe(503); // qua quota, chết ở DB đóng
  });
});
```

- [ ] **Step 2: Chạy fail, rồi viết `apps/api/src/quota.ts`**

```ts
import type { Context, Next } from 'hono';
import type { AppEnv } from './env';
import { ApiError } from './errors';

/** Mặc định plan free (spec 6.4): 20.000 places/ngày. */
export const FREE_PLACES_PER_DAY = 20_000;

/** YYYY-MM-DD theo giờ VN (UTC+7, không DST). */
export function vnDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Đếm xấp xỉ trong KV, chặn 429 khi vượt 2× quota (tránh chặn nhầm vì đếm trễ).
 *  Tenant internal: không đọc/ghi KV (Workers Free chỉ cho 1.000 ghi KV/ngày). */
export function quotaMiddleware(group: 'places') {
  return async (c: Context<AppEnv>, next: Next) => {
    const auth = c.get('auth');
    if (c.env.QUOTA_ENABLED !== '1' || !auth || auth.plan === 'internal') return next();
    const limit = auth.quotaPlacesPerDay ?? FREE_PLACES_PER_DAY;
    const key = `quota:${auth.key}:${vnDay()}:${group}`;
    const count = Number((await c.env.META.get(key)) ?? 0);
    if (count >= limit * 2)
      throw new ApiError(429, 'quota_exceeded', `Vượt quota ${group} theo ngày`);
    c.executionCtx.waitUntil(
      c.env.META.put(key, String(count + 1), { expirationTtl: 2 * 86_400 }),
    );
    await next();
  };
}
```

- [ ] **Step 3: Viết `apps/api/src/analytics.ts`**

```ts
import type { Context, Next } from 'hono';
import type { AppEnv } from './env';

/** Workers Analytics Engine: (tenant, key, endpoint) + (status, ms) cho mọi request /v1/*.
 *  Binding optional — thiếu thì bỏ qua, không lỗi. */
export function analyticsMiddleware() {
  return async (c: Context<AppEnv>, next: Next) => {
    const t0 = Date.now();
    try {
      await next();
    } finally {
      const auth = c.get('auth');
      c.env.ANALYTICS?.writeDataPoint({
        blobs: [auth?.tenantId ?? '', auth?.key ?? '', new URL(c.req.url).pathname],
        doubles: [c.res.status, Date.now() - t0],
        indexes: [auth?.key ?? 'anon'],
      });
    }
  };
}
```

- [ ] **Step 4: Nối vào app + config**

`apps/api/src/index.ts`:

```ts
import { analyticsMiddleware } from './analytics';
// … sau app.use CORS:
app.use('/v1/*', analyticsMiddleware());
```

Thêm `quotaMiddleware('places')` vào **sau** `requireAuth()` trong cả 6 route places, ví dụ autocomplete:

```ts
import { quotaMiddleware } from '../quota';
autocomplete.get('/v1/autocomplete', requireAuth(), quotaMiddleware('places'), async (c) => {
```

(tương tự `search.ts`, `nearby.ts`, `places.ts`, `geocode.ts`, `reverse.ts`.)

`apps/api/src/errors.ts` — trong `errorResponse`, cạnh dòng 503:

```ts
  if (e.status === 429) headers['retry-after'] = '3600';
```

`apps/api/wrangler.toml`:

```toml
[vars]
TILES_BASE = "https://tiles.ai-solutions.io.vn"
ENVIRONMENT = "dev"
QUOTA_ENABLED = "0"

[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "mapslibvn_api"

[env.production]
vars = { TILES_BASE = "https://tiles.ai-solutions.io.vn", ENVIRONMENT = "production", QUOTA_ENABLED = "0" }
# … giữ kv/r2/hyperdrive như cũ, thêm:
analytics_engine_datasets = [{ binding = "ANALYTICS", dataset = "mapslibvn_api" }]
```

(Nếu `wrangler deploy` báo tài khoản không dùng được Analytics Engine, **hoặc** vitest-pool-workers không parse được binding `analytics_engine_datasets` trong wrangler.toml: xoá khối binding ở env mặc định (giữ ở `[env.production]` nếu chỉ vitest kêu), code vẫn chạy vì optional chaining — ghi lại vào DEVLOG.)

`apps/api/vitest.config.ts` — bindings miniflare thêm `QUOTA_ENABLED: '1'` (bật cờ cho tầng test):

```ts
bindings: { TILES_BASE: 'https://tiles.test', ENVIRONMENT: 'test', QUOTA_ENABLED: '1' },
```

- [ ] **Step 5: Seed tenant free thử nghiệm — `db/seed/tenant_free_test.sql`**

```sql
-- Tenant free thử nghiệm cho nghiệm thu 429 (spec 13/M3). Quota nhỏ để test nhanh.
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-0000000000bb', 'Free thử nghiệm', 'free')
ON CONFLICT (id) DO NOTHING;
INSERT INTO api_key (key, tenant_id, label, kind, scopes, quota_places_per_day)
VALUES ('mlv_live_freetest0000000000000000', '00000000-0000-4000-8000-0000000000bb',
        'free test 429', 'server', '{places:read}', 25)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 6: Test + typecheck + nghiệm thử 429 local**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS toàn bộ (test cũ vẫn xanh vì khoá internal bỏ qua quota).

Nghiệm tay (DB local): `pnpm db:seed-tenant db/seed/tenant_free_test.sql`, chạy `wrangler dev --var QUOTA_ENABLED:1`, lặp `curl` 51 lần với khoá freetest → lần vượt 50 (2×25) trả 429. Ghi kết quả cho Task 12.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/{quota,analytics}.ts apps/api/src/errors.ts apps/api/src/index.ts apps/api/src/routes apps/api/wrangler.toml apps/api/vitest.config.ts apps/api/test/quota.test.ts db/seed/tenant_free_test.sql
git commit -m "feat(api): quota KV 429 tai 2x + Analytics Engine (tenant,key,endpoint,status,ms)"
```

---

### Task 12: Nghiệm thu M3 — deploy, đo p95, cập nhật tài liệu

**Files:**
- Create: `scripts/perf-autocomplete.mjs`
- Modify: `docs/DEVLOG.md`, `docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md`

- [ ] **Step 1: Viết `scripts/perf-autocomplete.mjs`**

```js
#!/usr/bin/env node
// Đo p50/p95/p99 autocomplete từ máy hiện tại (chạy từ VN để nghiệm thu p95 < 300 ms):
//   node scripts/perf-autocomplete.mjs https://<api-domain> mlv_live_xxx
const [base, key] = process.argv.slice(2);
if (!base || !key) {
  console.error('Cách dùng: node scripts/perf-autocomplete.mjs <base-url> <api-key>');
  process.exit(1);
}
const QUERIES = ['highlands', 'pho co', 'cafe', 'truong tieu hoc', 'nguyen hue',
  'ben thanh', 'circle k', 'pharmacity', 'bun bo', 'coop mart'];
const times = [];
for (let i = 0; i < 100; i++) {
  const q = QUERIES[i % QUERIES.length];
  const t0 = performance.now();
  const res = await fetch(
    `${base}/v1/autocomplete?q=${encodeURIComponent(q)}&near=10.776,106.700`,
    { headers: { 'X-Api-Key': key } },
  );
  await res.arrayBuffer();
  if (!res.ok) console.error(`lần ${i}: HTTP ${res.status}`);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const pct = (p) => Math.round(times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))]);
console.log(`n=${times.length} p50=${pct(50)}ms p95=${pct(95)}ms p99=${pct(99)}ms`);
console.log('Lưu ý: từ vòng lặp thứ 2 các query trùng sẽ hit cache 10 phút — giống hành vi client thật.');
```

- [ ] **Step 2: Việc tay trên production (làm cùng PHONG, ghi kết quả)**

1. Seed tenant trên DB máy chủ: mở tunnel như M2 (`cloudflared access tcp` — xem `infra/server/README.md`), rồi `DATABASE_URL=<qua tunnel> pnpm db:seed-tenant && DATABASE_URL=<qua tunnel> pnpm db:seed-tenant db/seed/tenant_free_test.sql`.
2. Kiểm production (deploy đã tự chạy qua `deploy-api.yml`):
   `curl 'https://<api-domain>/v1/autocomplete?q=highlands&near=10.776,106.700' -H 'X-Api-Key: mlv_live_server000000000000000000'` → items từ kho 1,5 triệu POI thật.
   `curl 'https://<api-domain>/v1/geocode?q=88%2F9%20Nguy%E1%BB%85n%20L%C3%A2m&near=10.76,106.66' -H 'X-Api-Key: …'` → ghi lại `precision` thật (dữ liệu quốc gia có thể ra `rooftop`/`alley` thay vì `interpolated` — fixture chuẩn nằm trong apitest).
3. Đo p95: `node scripts/perf-autocomplete.mjs https://<api-domain> mlv_live_server000000000000000000` → kỳ vọng p95 < 300 ms. Nếu vượt: kiểm Hyperdrive cache (SELECT TTL 60 s) và `x-mlv-cache` header.
4. Nghiệm 429 production (tuỳ chọn — cần bật `QUOTA_ENABLED=1` tạm bằng `wrangler deploy --var` hoặc để nguyên kết quả local từ Task 11 Step 6).
5. Cập nhật `allowed_origins` khoá demo bằng domain docs thật khi docs deploy.

- [ ] **Step 3: Cập nhật `docs/DEVLOG.md`**

Thêm mục "M3 — Places API" ghi: ngày, 8 quyết định thiết kế (chép từ đầu plan này), kết quả 2 fixture bắt buộc (link run `apitest.yml` xanh), số đo p95 (kèm nơi đo), kết quả 429 free tenant, screenshot React demo, và mục "Việc tay còn lại" (origin docs thật, bật QUOTA_ENABLED khi có tenant free thật, Analytics Engine nếu bị bỏ).

- [ ] **Step 4: Tick roadmap**

`docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md` mục 7: đổi `- [ ] M3 nghiệm thu…` thành `- [x] M3 nghiệm thu (2 fixture bắt buộc, p95 < 300 ms) — <ngày>.`

- [ ] **Step 5: Commit cuối + push**

```bash
git add scripts/perf-autocomplete.mjs docs/DEVLOG.md docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md
git commit -m "docs: nghiem thu M3 — Places API (2 fixture xanh, p95, 429, React demo)"
git push
```

Expected: CI `ci`, `deploy-api`, `apitest` đều xanh trên commit cuối.

---

## Thứ tự thực hiện khuyến nghị

Tuần tự **1 → 2 → 3 → 4 → 8 (Step 1–4) → 5 → 6 → 7 → 8 (Step 5–6) → 9 → 10 → 11 → 12**. Lý do: Task 5/6 import kiểu `Place`/`GeocodeItem` từ `@mapslibvn/core` (Task 8 tạo). Nếu giữ đúng thứ tự số, dùng interface cục bộ tạm trong `place.ts`/`geocode.ts` như ghi chú ở Task 5 Step 3 rồi thay ở Task 8. Mỗi task một commit; Worker luôn deploy được sau mỗi commit (deploy-api.yml tự chạy).

## Rủi ro & phương án lùi

| Rủi ro | Phát hiện | Phương án |
|---|---|---|
| `wrangler dev` (workerd) không chạy trên runner CI | apitest.yml đỏ ở bước healthz | Chạy job trong container `node:22-bookworm`, hoặc chuyển itest thành job chạy tay trước nghiệm thu |
| Core vượt 8 kB gzip sau khi thêm 6 method | `pnpm --filter @mapslibvn/core build` fail ở size-limit | Rút gọn chuỗi thông báo, gộp tham số; kiểm bằng `pnpm exec size-limit --why` |
| Analytics Engine không khả dụng trên plan hiện tại | `wrangler deploy` báo lỗi binding | Xoá binding khỏi wrangler.toml (code optional) + ghi DEVLOG |
| p95 > 300 ms từ VN | perf script | Kiểm cache hit (`x-mlv-cache`), Hyperdrive query cache; nếu vẫn chậm → mục 8.3 spec (Meilisearch) là việc của milestone sau, ghi nhận số đo thật |
| `%` (pg_trgm) không nhặt được query dài trên tên ngắn | itest fixture đỏ | Hạ `similarity` threshold bằng `set_limit()` trong cùng câu SELECT (`SELECT set_limit(0.2)` trước truy vấn, cùng connection) hoặc thêm nhánh `starts_with` |

## Ghi chú cho người thực hiện

- **Không bao giờ** để test `apps/api/test/*` cần Postgres — Hyperdrive test trỏ cổng đóng là chủ đích (memory dự án).
- Lệnh `wrangler` chạy tay luôn chạy từ `apps/api/` (Wrangler 4 đọc `.env` theo thư mục hiện tại — memory dự án).
- Mọi chuỗi hiển thị/JSON lỗi viết tiếng Việt có dấu, theo mẫu các file hiện có.
- Format/lint trước mỗi commit: `pnpm exec biome check --write <files đã đổi>`.
- `pnpm test:api-db` và `pnpm test:db` dùng **chung** DB cô lập `mapslibvn_task8_test` (scripts/lib/db-test.mjs) — không chạy song song hai lệnh này trên cùng máy.
- Repo bật `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`: không gán `string | undefined` vào prop optional (dùng spread có điều kiện như code trong plan), không index mảng rồi dùng thẳng thuộc tính.
