# Pha 5 — Sức khoẻ hệ thống (`/admin/health`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Màn `/admin/health` trả lời được hai câu hỏi trong một lần mở: "hệ thống còn sống không" (DB, định tuyến, dữ liệu — đo tươi mỗi lần) và "hệ thống đang chạy thế nào" (lượt gọi, p95, tỉ lệ lỗi, 429 theo endpoint và theo tenant — từ Analytics Engine, cache 5 phút).

**Architecture:** Hai route độc lập. `GET /v1/admin/health` chạy ba phép đo song song, mỗi phép tự bọc lỗi nên một thứ chết không kéo sập payload; không cache. `GET /v1/admin/metrics?window=1h|24h|7d` gọi Analytics Engine SQL API bằng token chỉ quyền đọc, cache 5 phút mỗi cửa sổ qua Cache API. Giao diện là một feature mới `apps/admin/src/features/health/`, dùng lại `RecordView` + năm trạng thái chuẩn.

**Tech Stack:** Hono trên Cloudflare Workers · Workers Analytics Engine SQL API · Hyperdrive/Postgres · React 18 + TanStack Query + Tailwind · vitest (+ `@cloudflare/vitest-pool-workers`) · vitest itest chạy bằng role `api` thật.

---

## Bối cảnh: bốn điều đã đo thật ngày 18/09/2026, đừng đo lại

Bốn giả định dưới đây đã được kiểm bằng API thật trước khi viết plan này. Chúng là nền của thiết kế; nếu một trong bốn sai thì phải quay lại brainstorm chứ không phải vá trong lúc code.

1. **Token đọc Analytics đã chứng minh chạy được.** `CLOUDFLARE_API_TOKEN` trong `.env` gọi được `POST /client/v4/accounts/:id/analytics_engine/sql` → HTTP 200. Nghĩa là đường đi và cú pháp không có gì bí ẩn. **Nhưng production sẽ dùng một token KHÁC**, hẹp hơn (xem Task 2).
2. **`replaceRegexpAll` KHÔNG tồn tại trong Analytics Engine SQL API** → `HTTP 422 unknown function call: REPLACEREGEXPALL`. Không chuẩn hoá được đường dẫn lúc đọc. Và p95 **không cộng dồn được** — gộp mấy dòng p95 thành một số là sai toán học. Vì vậy mẫu route phải được ghi sẵn lúc ghi số liệu (Task 1).
3. **`c.req.routePath` sau `await next()` trả đúng mẫu route.** Đo thật với Hono của repo: `/v1/places/abc-123` → `/v1/places/:id`; `/v1/admin/billing/<uuid>/usage` → `/v1/admin/billing/:id/usage`; đường dẫn không khớp route nào → `/v1/*` (mẫu của chính middleware, dùng làm nhóm "không khớp route").
4. **`blob4` truy vấn được ngay cả khi chưa từng ghi**: trả chuỗi rỗng cho dữ liệu cũ, không phải lỗi. Nên màn hình phải gộp `''` thành một dòng "(trước 18/09)" thay vì hiện một dòng trống khó hiểu.

Thêm hai bài học của repo mà plan này bám theo:

- `SUM`/`sumIf` của Analytics Engine trả **chuỗi** (UInt64), `quantileWeighted` trả **số** (Float64) — đã xác nhận 02/09/2026 trong `scripts/lib/weekly-report.mjs`. Mọi con số phải đi qua `Number()`.
- `quantileWeighted` là hàm phân vị **duy nhất** dùng được; `quantile(...)` trả `unknown function call`.

## Cấu trúc file

**Tạo mới**

| File | Trách nhiệm |
|---|---|
| `apps/api/src/routes/admin-metrics-sql.ts` | Hàm thuần: kiểm tham số `window`, quy đổi ra khoảng thời gian, dựng hai câu SQL, ép kiểu dòng trả về |
| `apps/api/src/analytics-sql.ts` | Gọi Analytics Engine SQL API (token, tài khoản, lỗi mạng) — cạnh `analytics.ts` là chỗ ghi |
| `apps/api/src/routes/admin-metrics.ts` | Route `GET /v1/admin/metrics` + cache 5 phút + nhãn tenant từ DB |
| `apps/api/src/db-health.ts` | `dbHealth()` dùng chung cho `/healthz/db` và `/v1/admin/health` |
| `apps/api/src/routes/admin-health.ts` | Route `GET /v1/admin/health` — ba phép đo song song |
| `apps/api/test/admin-metrics-sql.test.ts` | Test hàm thuần |
| `apps/api/test/admin-metrics.test.ts` | Test route metrics (Analytics giả qua `fetch-mock`) |
| `apps/api/test/admin-health.test.ts` | Test route health (Valhalla giả, DB hỏng) |
| `apps/api/test-db/admin-health.itest.mjs` | Bài kiểm chạy bằng role `api` THẬT (tiêu chí nghiệm thu số 10 của spec) |
| `apps/admin/src/features/health/api.ts` | Kiểu dữ liệu + hai lời gọi |
| `apps/admin/src/features/health/hooks.ts` | `useHealth()` (luôn tươi) và `useMetrics(window)` (5 phút) |
| `apps/admin/src/features/health/page.tsx` | Màn hình |
| `apps/admin/src/features/health/page.test.tsx` | Test component |

**Sửa**

| File | Sửa gì |
|---|---|
| `apps/api/src/analytics.ts` | Thêm `blob4` = mẫu route |
| `apps/api/test/analytics.test.ts` | Cập nhật khẳng định `blobs` + test mới cho blob4 |
| `apps/api/src/env.ts` | Thêm `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN` |
| `apps/api/wrangler.toml` | Thêm `CF_ACCOUNT_ID` vào `[vars]` **và** `[env.production] vars` |
| `apps/api/src/index.ts` | `/healthz/db` gọi `dbHealth()` thay vì tự viết câu SQL |
| `apps/api/src/routes/admin.ts` | Mount hai router mới |
| `apps/admin/src/routes.tsx` | Thêm route `health` |
| `apps/admin/src/routes.test.tsx` | Lật test "health rơi vào 404" thành "health có màn hình thật" |

**Không có migration.** Máy chủ giữ nguyên `0019`. Vì vậy thứ tự lên production là: đặt secret → deploy → nghiệm thu (không có bước `check:migration`).

---

### Task 1: `blob4` = mẫu route trong Analytics Engine

**Files:**
- Modify: `apps/api/src/analytics.ts`
- Test: `apps/api/test/analytics.test.ts`

- [ ] **Step 1: Viết test đỏ cho blob4**

Thêm vào cuối `apps/api/test/analytics.test.ts`, trong cùng `describe`:

```ts
  it('blob4 là MẪU route chứ không phải đường dẫn thật', async () => {
    // p95 không cộng dồn được: gộp p95 của /v1/admin/billing/<uuid-1>/usage với <uuid-2> thành một
    // con số là sai toán học. Nên mẫu route phải được gom sẵn LÚC GHI, không phải lúc đọc —
    // Analytics Engine SQL API không có replaceRegexpAll (đo thật 18/09/2026: HTTP 422).
    const points: DataPoint[] = [];
    const app = new Hono<AppEnv>();
    app.use('/v1/*', analyticsMiddleware());
    app.get('/v1/places/:id', (c) => c.json({ ok: true }));
    const env = {
      ANALYTICS: {
        writeDataPoint(point: DataPoint) {
          points.push(point);
        },
      },
    } as unknown as AppEnv['Bindings'];

    await app.request('https://api/v1/places/abc-123', {}, env);

    expect(points).toHaveLength(1);
    expect(points[0]?.blobs?.[2]).toBe('/v1/places/abc-123');
    expect(points[0]?.blobs?.[3]).toBe('/v1/places/:id');
  });
```

Và thêm `Hono` vào import đầu file:

```ts
import { Hono } from 'hono';
```

- [ ] **Step 2: Chạy test để thấy nó đỏ**

Run: `cd apps/api && pnpm exec vitest run test/analytics.test.ts`
Expected: FAIL — `expected undefined to be '/v1/places/:id'`

- [ ] **Step 3: Ghi thêm blob4**

Trong `apps/api/src/analytics.ts`, thay lời gọi `writeDataPoint`:

```ts
      c.env.ANALYTICS?.writeDataPoint({
        // blob4 = MẪU route (`/v1/places/:id`), blob3 giữ nguyên đường dẫn THÔ. Hai cột chứ không
        // phải một: `report:weekly` đọc blob3, và lịch sử trước 18/09/2026 không có blob4 (truy vấn
        // vẫn chạy, cột trả chuỗi rỗng). Đường dẫn không khớp route nào rơi vào `/v1/*`.
        blobs: [
          auth?.tenantId ?? '',
          auth?.keyHash ?? '',
          new URL(c.req.url).pathname,
          c.req.routePath ?? '',
        ],
        // stage_hit: -1 route khác, -2 autocomplete trúng cache, 0 chạy mà rỗng, 1..3 bậc trúng.
        doubles: [c.res.status, Date.now() - t0, c.get('stageHit') ?? -1],
        indexes: [auth?.keyHash ?? 'anon'],
      });
```

- [ ] **Step 4: Sửa khẳng định của test cũ**

Test cũ dựng context giả (`req: { url }`) nên `c.req.routePath` là `undefined` → `?? ''`. Trong `apps/api/test/analytics.test.ts` sửa dòng khẳng định `blobs`:

```ts
    expect(points[0]?.blobs).toEqual(['tenant-test', 'a'.repeat(64), '/v1/autocomplete', '']);
```

- [ ] **Step 5: Chạy lại cả file**

Run: `cd apps/api && pnpm exec vitest run test/analytics.test.ts`
Expected: PASS — cả hai test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/analytics.ts apps/api/test/analytics.test.ts
git commit -m "feat(api): ghi mẫu route vào blob4 của Analytics Engine"
```

---

### Task 2: Biến môi trường cho Analytics SQL API

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/wrangler.toml`

- [ ] **Step 1: Khai hai biến trong `Env`**

Trong `apps/api/src/env.ts`, thêm ngay dưới khai báo `ANALYTICS?: AnalyticsEngineDataset;`:

```ts
  /**
   * Tài khoản Cloudflare, dùng dựng URL Analytics Engine SQL API. Không phải bí mật (nó nằm trong
   * URL của mọi lời gọi API), nên để ở `[vars]` chứ không phải secret.
   */
  CF_ACCOUNT_ID?: string;
  /**
   * Token CHỈ có quyền `Account Analytics: Read`, đặt bằng
   * `wrangler secret put CF_ANALYTICS_TOKEN --env production`.
   *
   * Cố ý KHÔNG dùng lại `CLOUDFLARE_API_TOKEN` của máy dev dù nó cũng đọc được Analytics: token đó
   * deploy được Worker, đọc được R2 và KV. Nhét nó vào Worker là biến một lỗ hổng trong Worker
   * thành quyền điều khiển cả tài khoản. Vắng biến này → `/v1/admin/metrics` trả 503
   * `analytics_not_configured`, KHÔNG phải 500.
   */
  CF_ANALYTICS_TOKEN?: string;
```

- [ ] **Step 2: Thêm `CF_ACCOUNT_ID` vào cả hai khối vars của wrangler**

Trong `apps/api/wrangler.toml`, thêm vào khối `[vars]` (dev):

```toml
# Tài khoản Cloudflare cho Analytics Engine SQL API (pha 5). Dev không có CF_ANALYTICS_TOKEN nên
# /v1/admin/metrics ở máy trả 503 analytics_not_configured — đúng như thiết kế.
CF_ACCOUNT_ID = "<giá trị CLOUDFLARE_ACCOUNT_ID trong .env ở gốc repo>"
```

Và thêm `CF_ACCOUNT_ID` vào đối tượng `vars` một dòng của `[env.production]`. **Khối production ghi đè TOÀN BỘ vars**, nên thiếu ở đây là production không có biến này dù `[vars]` đã có:

```toml
vars = { TILES_BASE = "https://tiles.ai-solutions.io.vn", ENVIRONMENT = "production", QUOTA_ENABLED = "1", COMMERCIAL_ADMISSION = "1", ROUTING_BASE = "https://maps-route.ai-solutions.io.vn", ACCESS_TEAM_DOMAIN = "snowy-credit-f444.cloudflareaccess.com", ACCESS_AUD = "26088029373e358f9a24e68f66fe85ccc0c771e53cde538638a54151969cc6f5", AUTOCOMPLETE_FAST = "1", CF_ACCOUNT_ID = "<cùng giá trị>" }
```

- [ ] **Step 3: Kiểm typecheck**

Run: `cd apps/api && pnpm typecheck`
Expected: PASS, không lỗi nào.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/env.ts apps/api/wrangler.toml
git commit -m "chore(api): khai CF_ACCOUNT_ID và CF_ANALYTICS_TOKEN cho pha 5"
```

---

### Task 3: Hàm thuần — tham số cửa sổ và hai câu SQL

**Files:**
- Create: `apps/api/src/routes/admin-metrics-sql.ts`
- Test: `apps/api/test/admin-metrics-sql.test.ts`

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/api/test/admin-metrics-sql.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  METRICS_WINDOWS,
  parseWindow,
  routeSql,
  soAe,
  tenantSql,
  windowRange,
} from '../src/routes/admin-metrics-sql';

const NOW = new Date('2026-09-18T10:00:00.000Z');

describe('parseWindow', () => {
  it('thiếu tham số → 24h; giá trị lạ → 400 chứ không âm thầm về mặc định', () => {
    expect(parseWindow(null)).toBe('24h');
    // Âm thầm thay bằng mặc định là cách chắc chắn để người trực đọc nhầm cửa sổ thời gian:
    // bấm "1 giờ", nhận số của 24 giờ, và không có gì trên màn hình nói rằng đã bị đổi.
    expect(() => parseWindow('30d')).toThrow(ApiError);
  });

  it('nhận đúng ba cửa sổ đã khai', () => {
    for (const w of METRICS_WINDOWS) expect(parseWindow(w)).toBe(w);
  });
});

describe('windowRange', () => {
  it('lùi đúng số giờ, mốc `to` là bây giờ', () => {
    expect(windowRange('1h', NOW).from.toISOString()).toBe('2026-09-18T09:00:00.000Z');
    expect(windowRange('24h', NOW).from.toISOString()).toBe('2026-09-17T10:00:00.000Z');
    expect(windowRange('7d', NOW).from.toISOString()).toBe('2026-09-11T10:00:00.000Z');
    expect(windowRange('1h', NOW).to.toISOString()).toBe(NOW.toISOString());
  });
});

describe('routeSql', () => {
  it('gộp theo blob4, dùng quantileWeighted, và bọc mốc thời gian trong toDateTime', () => {
    const sql = routeSql(windowRange('24h', NOW));
    expect(sql).toContain('blob4 AS route');
    // `quantile(...)` trả "unknown function call" trên API thật — quantileWeighted là hàm phân vị
    // duy nhất dùng được (đo 02/09/2026, xem scripts/lib/weekly-report.mjs).
    expect(sql).toContain('quantileWeighted(0.95)(double2, _sample_interval)');
    expect(sql).toContain("toDateTime('2026-09-17 10:00:00')");
    expect(sql).toContain("toDateTime('2026-09-18 10:00:00')");
    expect(sql).not.toContain('replaceRegexpAll');
  });
});

describe('tenantSql', () => {
  it('gộp theo blob1 và đếm riêng 429', () => {
    const sql = tenantSql(windowRange('7d', NOW));
    expect(sql).toContain('blob1 AS tenant_id');
    expect(sql).toContain('sumIf(_sample_interval, double1 = 429)');
  });
});

describe('soAe', () => {
  it('SUM của Analytics Engine về dạng chuỗi — phải ép, và rỗng thành 0', () => {
    // Xác nhận trên API thật: SUM/sumIf trả UInt64 dưới dạng CHUỖI, quantileWeighted trả số.
    expect(soAe('1267')).toBe(1267);
    expect(soAe(1182)).toBe(1182);
    expect(soAe(null)).toBe(0);
    expect(soAe(undefined)).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `cd apps/api && pnpm exec vitest run test/admin-metrics-sql.test.ts`
Expected: FAIL — `Failed to resolve import "../src/routes/admin-metrics-sql"`

- [ ] **Step 3: Viết hàm thuần**

Tạo `apps/api/src/routes/admin-metrics-sql.ts`:

```ts
import { ApiError } from '../errors';

/** Dataset Analytics Engine mà `analyticsMiddleware()` ghi vào (xem wrangler.toml). */
export const DATASET = 'mapslibvn_api';
export const METRICS_WINDOWS = ['1h', '24h', '7d'] as const;
export type MetricsWindow = (typeof METRICS_WINDOWS)[number];

const GIO_CUA_SO: Readonly<Record<MetricsWindow, number>> = { '1h': 1, '24h': 24, '7d': 24 * 7 };
/** Trần số dòng mỗi bảng: màn hình của người trực, không phải kho dữ liệu. */
const LIMIT = 20;

export interface Khoang {
  from: Date;
  to: Date;
}

export function parseWindow(raw: string | null): MetricsWindow {
  if (raw === null || raw === '') return '24h';
  if ((METRICS_WINDOWS as readonly string[]).includes(raw)) return raw as MetricsWindow;
  throw new ApiError(400, 'invalid_request', `window phải là ${METRICS_WINDOWS.join(', ')}`);
}

export function windowRange(window: MetricsWindow, now: Date): Khoang {
  return { from: new Date(now.getTime() - GIO_CUA_SO[window] * 3_600_000), to: now };
}

/** Analytics Engine SQL nhận mốc dạng 'YYYY-MM-DD HH:MM:SS' theo UTC, không nhận ISO có chữ T/Z. */
const mocSql = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');

const khoangSql = ({ from, to }: Khoang): string =>
  `timestamp >= toDateTime('${mocSql(from)}') AND timestamp < toDateTime('${mocSql(to)}')`;

/**
 * Theo MẪU route (blob4). Không chuẩn hoá được lúc đọc: Analytics Engine SQL API không có
 * `replaceRegexpAll` (HTTP 422, đo 18/09/2026), và p95 của nhiều nhóm không cộng lại thành một p95.
 * Dòng có route rỗng là dữ liệu ghi trước 18/09/2026 — giao diện gộp nó thành "(trước 18/09)".
 */
export function routeSql(khoang: Khoang): string {
  return `
SELECT
  blob4 AS route,
  SUM(_sample_interval) AS requests,
  sumIf(_sample_interval, double1 >= 500) AS errors_5xx,
  sumIf(_sample_interval, double1 = 429) AS quota_429,
  quantileWeighted(0.95)(double2, _sample_interval) AS p95_ms
FROM ${DATASET}
WHERE ${khoangSql(khoang)}
GROUP BY route
ORDER BY requests DESC
LIMIT ${LIMIT}`;
}

/** Theo tenant (blob1). Chuỗi rỗng = request không kèm khoá (tiles, style, healthz…). */
export function tenantSql(khoang: Khoang): string {
  return `
SELECT
  blob1 AS tenant_id,
  SUM(_sample_interval) AS requests,
  sumIf(_sample_interval, double1 >= 500) AS errors_5xx,
  sumIf(_sample_interval, double1 = 429) AS quota_429,
  quantileWeighted(0.95)(double2, _sample_interval) AS p95_ms
FROM ${DATASET}
WHERE ${khoangSql(khoang)}
GROUP BY tenant_id
ORDER BY requests DESC
LIMIT ${LIMIT}`;
}

/** SUM/sumIf trả UInt64 dưới dạng CHUỖI; quantileWeighted trả số. Một cửa duy nhất để ép kiểu. */
export function soAe(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `cd apps/api && pnpm exec vitest run test/admin-metrics-sql.test.ts`
Expected: PASS — 6 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-metrics-sql.ts apps/api/test/admin-metrics-sql.test.ts
git commit -m "feat(api): hàm thuần dựng câu SQL số liệu cho pha 5"
```

---

### Task 4: Client gọi Analytics Engine SQL API

**Files:**
- Create: `apps/api/src/analytics-sql.ts`
- Test: gộp trong `apps/api/test/admin-metrics.test.ts` ở Task 5 (client chỉ có nghĩa qua route)

- [ ] **Step 1: Viết client**

Tạo `apps/api/src/analytics-sql.ts`:

```ts
import type { Env } from './env';
import { ApiError } from './errors';

const SQL_TIMEOUT_MS = 10_000;

interface KetQuaSql<T> {
  data: T[];
  rows: number;
}

type AnalyticsEnv = Pick<Env, 'CF_ACCOUNT_ID' | 'CF_ANALYTICS_TOKEN'>;

/**
 * Đọc Analytics Engine bằng SQL API. Đây là chiều ĐỌC; chiều ghi ở `analytics.ts`.
 *
 * Thiếu cấu hình trả 503 `analytics_not_configured` với thông điệp nói rõ phải làm gì: màn Sức khoẻ
 * hiện đúng câu đó cho người trực, thay vì một lỗi chung chung khiến người ta đi kiểm DB.
 */
export async function queryAnalytics<T>(
  env: AnalyticsEnv,
  sql: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T[]> {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) {
    throw new ApiError(
      503,
      'analytics_not_configured',
      'Chưa đặt CF_ANALYTICS_TOKEN (token chỉ quyền Account Analytics: Read) cho Worker',
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}` },
        body: sql,
        signal: AbortSignal.timeout(SQL_TIMEOUT_MS),
      },
    );
  } catch {
    throw new ApiError(503, 'upstream_unavailable', 'Analytics API không phản hồi');
  }

  if (!response.ok) {
    // Thân lỗi của API này là văn bản thuần ("unknown function call: …") và nó nói đúng chỗ sai,
    // nên ghi log nguyên văn — nhưng KHÔNG trả ra ngoài: nó chứa nguyên câu SQL.
    console.error('analytics sql', response.status, await response.text().catch(() => ''));
    throw new ApiError(503, 'upstream_unavailable', 'Analytics API trả lỗi');
  }

  try {
    const body = (await response.json()) as KetQuaSql<T>;
    return body.data ?? [];
  } catch {
    throw new ApiError(503, 'upstream_unavailable', 'Analytics API trả dữ liệu không hợp lệ');
  }
}
```

- [ ] **Step 2: Kiểm typecheck**

Run: `cd apps/api && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/analytics-sql.ts
git commit -m "feat(api): client đọc Analytics Engine qua SQL API"
```

---

### Task 5: Route `GET /v1/admin/metrics` + cache 5 phút

**Files:**
- Create: `apps/api/src/routes/admin-metrics.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/test/admin-metrics.test.ts`

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/api/test/admin-metrics.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { fetchMock } from './helpers/fetch-mock';

const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

describe('cổng vào của /v1/admin/metrics', () => {
  it('thiếu JWT Access → 401, không rò một con số nào', async () => {
    // Số liệu này lộ ra tenant nào đang gọi bao nhiêu — bản đồ khách hàng của hệ thống.
    const response = await SELF.fetch('https://api/v1/admin/metrics');
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('window lạ vẫn bị Access chặn TRƯỚC, không lộ thông điệp kiểm tham số', async () => {
    const response = await SELF.fetch('https://api/v1/admin/metrics?window=30d');
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `cd apps/api && pnpm exec vitest run test/admin-metrics.test.ts`
Expected: FAIL — route chưa tồn tại nên `app.notFound` trả 404 `not_found`, không phải 401.

- [ ] **Step 3: Viết route**

Tạo `apps/api/src/routes/admin-metrics.ts`:

```ts
import { Hono } from 'hono';
import { queryAnalytics } from '../analytics-sql';
import { cachedJson } from '../cache';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';
import {
  type Khoang,
  type MetricsWindow,
  parseWindow,
  routeSql,
  soAe,
  tenantSql,
  windowRange,
} from './admin-metrics-sql';

/** Cache 5 phút mỗi cửa sổ. Quét lại Analytics cho mỗi lần bấm F5 là tốn tiền mà không thêm tin. */
const CACHE_SEC = 300;
const cacheUrl = (window: MetricsWindow): string =>
  `https://cache.mapslibvn/admin-metrics?window=${window}`;

interface DongRouteThô {
  route: string;
  requests: string | number;
  errors_5xx: string | number;
  quota_429: string | number;
  p95_ms: string | number;
}
interface DongTenantThô extends Omit<DongRouteThô, 'route'> {
  tenant_id: string;
}

/**
 * Nhãn tenant để người trực đọc được tên thay vì uuid. Bảng `tenant` chỉ có vài dòng nên đọc cả
 * bảng: `WHERE id = ANY(...)` phải bind mảng, mà bind mảng + ::uuid[] đã từng vỡ trên production
 * trong khi unit test vẫn xanh. Hỏng lời gọi này KHÔNG được làm hỏng cả trang — mất nhãn thôi.
 */
async function nhanTenant(env: Env, ctx: ExecutionContext): Promise<Record<string, string>> {
  const sql = getSql(env);
  try {
    const rows = await sql<{ id: string; name: string }[]>`
      SELECT id::text AS id, name FROM tenant`;
    return Object.fromEntries(rows.map((r) => [r.id, r.name]));
  } catch (error) {
    console.error('admin/metrics nhãn tenant', error);
    return {};
  } finally {
    endSql(ctx, sql);
  }
}

async function tinhSoLieu(env: Env, ctx: ExecutionContext, khoang: Khoang) {
  const [routes, tenants, nhan] = await Promise.all([
    queryAnalytics<DongRouteThô>(env, routeSql(khoang)),
    queryAnalytics<DongTenantThô>(env, tenantSql(khoang)),
    nhanTenant(env, ctx),
  ]);

  return {
    computed_at: new Date().toISOString(),
    routes: routes.map((r) => ({
      route: r.route,
      requests: soAe(r.requests),
      errors_5xx: soAe(r.errors_5xx),
      quota_429: soAe(r.quota_429),
      p95_ms: Math.round(soAe(r.p95_ms)),
    })),
    tenants: tenants.map((r) => ({
      tenant_id: r.tenant_id,
      ten: nhan[r.tenant_id] ?? null,
      requests: soAe(r.requests),
      errors_5xx: soAe(r.errors_5xx),
      quota_429: soAe(r.quota_429),
      p95_ms: Math.round(soAe(r.p95_ms)),
    })),
  };
}

export const adminMetrics = new Hono<AppEnv>();

adminMetrics.get('/v1/admin/metrics', async (c) => {
  const window = parseWindow(new URL(c.req.url).searchParams.get('window'));
  const khoang = windowRange(window, new Date());

  // `cachedJson` lưu vào Cache API với `cache-control: public` — bắt buộc phải lưu công khai thì
  // Cache API mới nhận. Header trả cho TRÌNH DUYỆT thì đổi lại thành private/no-store, và đổi SAU
  // khi cachedJson đã put xong, không phải trước.
  const response = await cachedJson(c.executionCtx, cacheUrl(window), CACHE_SEC, CACHE_SEC, () =>
    tinhSoLieu(c.env, c.executionCtx, khoang),
  ).catch((error: unknown) => {
    if (error instanceof ApiError) throw error;
    console.error('admin/metrics', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đọc được số liệu');
  });

  const out = new Response(response.body, response);
  out.headers.set('cache-control', 'private, no-store');
  // `window` không nằm trong phần được cache: nó là câu hỏi, không phải câu trả lời.
  out.headers.set('x-mlv-window', window);
  return out;
});
```

- [ ] **Step 4: Mount router**

Trong `apps/api/src/routes/admin.ts`, thêm import và mount cạnh các router khác:

```ts
import { adminMetrics } from './admin-metrics';
```

```ts
admin.route('/', adminMetrics);
```

- [ ] **Step 5: Chạy test**

Run: `cd apps/api && pnpm exec vitest run test/admin-metrics.test.ts`
Expected: PASS — 2 test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin-metrics.ts apps/api/src/routes/admin.ts apps/api/test/admin-metrics.test.ts
git commit -m "feat(api): GET /v1/admin/metrics — số liệu Analytics cache 5 phút"
```

---

### Task 6: `dbHealth()` dùng chung

**Files:**
- Create: `apps/api/src/db-health.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/healthz-db.test.ts` (không đổi — nó là lưới an toàn cho việc tách hàm)

- [ ] **Step 1: Tách hàm, giữ nguyên từng dòng SQL và từng lời bình**

Tạo `apps/api/src/db-health.ts`:

```ts
import { endSql, getSql } from './db';
import type { Env } from './env';
import { ApiError } from './errors';

export interface DbHealth {
  ok: boolean;
  user: string | undefined;
  version: string | undefined;
  word_similarity_threshold: number | null;
  schema_migration: string | null;
}

/**
 * Trạng thái DB cho `/healthz/db` (công khai) và `/v1/admin/health` (sau Access). Một hàm chứ
 * không hai: hai nơi đọc "DB có sống không" mà trả lời khác nhau là cách để một sự cố trông như
 * hai sự cố.
 */
export async function dbHealth(env: Env, ctx: ExecutionContext): Promise<DbHealth> {
  const sql = getSql(env);
  try {
    // current_setting(…, true) trả NULL thay vì ném khi GUC chưa có: API deploy được trước khi
    // migration 0007 áp lên máy chủ mà /healthz/db không rơi xuống 503.
    const [row] = await sql<
      { ok: number; user: string; version: string; wst: string | null }[]
    >`SELECT 1 AS ok, current_user AS "user", version() AS version,
        current_setting('pg_trgm.word_similarity_threshold', true) AS wst`;
    // Phiên bản schema để phát hiện lệch giữa Worker đã deploy và DB. 06/09/2026: Worker mang code
    // đọc admin_area_old/admin_alias.old_area_id được deploy trước migration 0008, làm
    // /v1/autocomplete mặc định 503 suốt nhiều giờ mà /healthz/db vẫn 200. Postgres phân giải quan
    // hệ ngay lúc parse nên không lồng được vào câu trên: phải truy vấn riêng và nuốt lỗi.
    let schemaMigration: string | null = null;
    try {
      const [migration] = await sql<{ name: string | null }[]>`
        SELECT max(name) AS name FROM schema_migrations`;
      schemaMigration = migration?.name ?? null;
    } catch {
      schemaMigration = null;
    }
    return {
      ok: row?.ok === 1,
      user: row?.user,
      version: row?.version.split(' ').slice(0, 2).join(' '),
      word_similarity_threshold: row?.wst == null ? null : Number(row.wst),
      schema_migration: schemaMigration,
    };
  } catch (err) {
    console.error('healthz/db', err);
    throw new ApiError(503, 'upstream_unavailable', 'Không nối được DB');
  } finally {
    endSql(ctx, sql);
  }
}
```

- [ ] **Step 2: `/healthz/db` gọi hàm chung**

Trong `apps/api/src/index.ts`, thay toàn bộ thân handler `/healthz/db` bằng:

```ts
app.get('/healthz/db', async (c) => c.json(await dbHealth(c.env, c.executionCtx)));
```

Thêm import:

```ts
import { dbHealth } from './db-health';
```

Và xoá những import chỉ còn dùng cho đoạn vừa bỏ (`getSql`/`endSql`) **nếu** không còn chỗ nào trong `index.ts` dùng tới — kiểm bằng `grep -n "getSql\|endSql" apps/api/src/index.ts` trước khi xoá.

- [ ] **Step 3: Chạy test cũ để chứng minh không đổi hành vi**

Run: `cd apps/api && pnpm exec vitest run test/healthz-db.test.ts`
Expected: PASS — DB không nối được vẫn ra 503 `upstream_unavailable` kèm `request_id`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db-health.ts apps/api/src/index.ts
git commit -m "refactor(api): tách dbHealth() dùng chung cho healthz và trang Admin"
```

---

### Task 7: Route `GET /v1/admin/health`

**Files:**
- Create: `apps/api/src/routes/admin-health.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/test/admin-health.test.ts`

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/api/test/admin-health.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { fetchMock } from './helpers/fetch-mock';

const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

describe('cổng vào của /v1/admin/health', () => {
  it('thiếu JWT Access → 401', async () => {
    // Payload này khai phiên bản Postgres, mốc migration và phiên bản graph định tuyến — vừa đủ để
    // người ngoài biết nên thử lỗ hổng nào.
    const response = await SELF.fetch('https://api/v1/admin/health');
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `cd apps/api && pnpm exec vitest run test/admin-health.test.ts`
Expected: FAIL — nhận 404 `not_found` vì route chưa có.

- [ ] **Step 3: Viết route**

Tạo `apps/api/src/routes/admin-health.ts`:

```ts
import { Hono } from 'hono';
import { dbHealth } from '../db-health';
import type { AppEnv, Env } from '../env';
import { getManifest } from '../manifest';
import { callValhalla, valhallaBody } from '../routing/valhalla';

/**
 * Tuyến thử cố định ở Hà Nội (Hồ Gươm → Văn Miếu), khoảng 2 km đường lớn. Cố định để so sánh được
 * giữa các lần đo, và nằm ở nơi graph VN nào cũng phải phủ.
 */
const TUYEN_THU = {
  locations: [
    { lat: 21.0287, lng: 105.8524 },
    { lat: 21.0293, lng: 105.8355 },
  ],
  mode: 'car',
  lang: 'vi',
  alternatives: false,
} as const;

/** Ngắn hơn ROUTE_TIMEOUT_MS (10 s) của route thật: đây là màn hình có người đang ngồi đợi. */
const PROBE_TIMEOUT_MS = 6_000;

type KetQua<T> = ({ ok: true; ms: number } & T) | { ok: false; ms: number; error: string };

/** Mỗi phép đo tự bọc lỗi: máy chủ định tuyến ngủ KHÔNG được làm mất luôn trạng thái DB. */
async function do_<T>(fn: () => Promise<T>): Promise<KetQua<T>> {
  const t0 = Date.now();
  try {
    return { ok: true, ms: Date.now() - t0, ...(await fn()) };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: error instanceof Error ? error.message : 'Lỗi không xác định',
    };
  }
}

/**
 * Định tuyến đo bằng một `/route` THẬT, không phải `/status`: Valhalla trả 200 cho `/status` kể cả
 * khi graph rỗng — đã có tiền lệ, một lần nghiệm thu xanh giả. Tuyến không ra mét nào thì coi như hỏng.
 */
async function doDinhTuyen(env: Env) {
  const json = await callValhalla(env, valhallaBody(TUYEN_THU, crypto.randomUUID()), {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const km = json.trip?.summary?.length ?? 0;
  if (!(km > 0)) throw new Error('Tuyến thử ra 0 km — graph nhiều khả năng rỗng');
  return { distance_km: Math.round(km * 100) / 100, phut: Math.round((json.trip.summary.time ?? 0) / 60) };
}

export const adminHealth = new Hono<AppEnv>();

adminHealth.get('/v1/admin/health', async (c) => {
  const [db, routing, data] = await Promise.all([
    do_(() => dbHealth(c.env, c.executionCtx)),
    do_(() => doDinhTuyen(c.env)),
    do_(async () => {
      const m = await getManifest(c.env);
      return { tiles: m.vn, poi: m.poi, updated_at: m.updatedAt ?? null };
    }),
  ]);

  // Luôn 200 khi qua được Access: đây là BÁO CÁO về sức khoẻ, không phải sức khoẻ của chính nó.
  // Trả 503 khi Valhalla chết thì màn hình mất luôn trạng thái DB và không nói được gì đã hỏng.
  return c.json({ checked_at: new Date().toISOString(), db, routing, data }, 200, {
    'cache-control': 'private, no-store',
  });
});
```

- [ ] **Step 4: Mount router**

Trong `apps/api/src/routes/admin.ts`:

```ts
import { adminHealth } from './admin-health';
```

```ts
admin.route('/', adminHealth);
```

- [ ] **Step 5: Chạy test**

Run: `cd apps/api && pnpm exec vitest run test/admin-health.test.ts`
Expected: PASS.

- [ ] **Step 6: Chạy cả bộ test của api để chắc không vỡ chỗ khác**

Run: `cd apps/api && pnpm test`
Expected: PASS toàn bộ.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin-health.ts apps/api/src/routes/admin.ts apps/api/test/admin-health.test.ts
git commit -m "feat(api): GET /v1/admin/health — DB, một /route thật và manifest"
```

---

### Task 8: Bài kiểm chạy bằng role `api` thật

**Files:**
- Create: `apps/api/test-db/admin-health.itest.mjs`

Tiêu chí nghiệm thu số 10 của spec: mỗi route mới có ít nhất một bài kiểm chạy bằng role `api` thật. Tầng unit ở trên chỉ chứng minh cổng Access; nó không chứng minh được role `api` có quyền đọc `schema_migrations` và `tenant`.

- [ ] **Step 1: Viết itest**

Tạo `apps/api/test-db/admin-health.itest.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path) => fetch(base + path, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });

describe('GET /v1/admin/health — role api thật', () => {
  it('đọc được DB và mốc migration bằng đúng role api', async () => {
    const response = await adminFetch('/v1/admin/health');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.db.ok).toBe(true);
    expect(body.db.user).toBe('api');
    // Quyền SELECT trên schema_migrations chỉ vỡ khi chạy bằng role thật: unit test không có DB.
    expect(body.db.schema_migration).toMatch(/^\d{4}/);
    expect(body.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('máy chủ định tuyến không có trong itest → routing.ok=false mà cả payload vẫn sống', async () => {
    // Đây chính là hình dạng của sự cố thật: máy Mac ở nhà ngủ thì định tuyến chết trong khi DB
    // và dữ liệu vẫn chạy. Màn hình phải nói được "cái nào hỏng", không phải tắt ngóm.
    const body = await (await adminFetch('/v1/admin/health')).json();
    expect(body.routing.ok).toBe(false);
    expect(typeof body.routing.error).toBe('string');
    expect(body.db.ok).toBe(true);
  });
});

describe('GET /v1/admin/metrics — role api thật', () => {
  it('chưa có CF_ANALYTICS_TOKEN → 503 analytics_not_configured, không phải 500', async () => {
    const response = await adminFetch('/v1/admin/metrics?window=1h');
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('analytics_not_configured');
  });

  it('window lạ → 400 invalid_request', async () => {
    const response = await adminFetch('/v1/admin/metrics?window=30d');
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
  });
});
```

- [ ] **Step 2: Chạy toàn bộ bộ itest**

Run: `pnpm test:api-db`
Expected: PASS — bao gồm 4 test mới. (Bộ này dựng DB cô lập, migrate, seed rồi chạy Wrangler thật; mất vài phút.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/test-db/admin-health.itest.mjs
git commit -m "test(api): itest role api thật cho /v1/admin/health và /metrics"
```

---

### Task 9: Giao diện — lời gọi và hook

**Files:**
- Create: `apps/admin/src/features/health/api.ts`
- Create: `apps/admin/src/features/health/hooks.ts`

- [ ] **Step 1: Viết `api.ts`**

```ts
import { apiFetch } from '@/lib/fetcher';

export const CUA_SO = ['1h', '24h', '7d'] as const;
export type CuaSo = (typeof CUA_SO)[number];
export const NHAN_CUA_SO: Readonly<Record<CuaSo, string>> = {
  '1h': '1 giờ',
  '24h': '24 giờ',
  '7d': '7 ngày',
};

/** Một phép đo: hoặc đo được (`ok: true` kèm số liệu), hoặc hỏng (`ok: false` kèm lý do). */
export type PhepDo<T> = ({ ok: true; ms: number } & T) | { ok: false; ms: number; error: string };

export interface Health {
  checked_at: string;
  db: PhepDo<{
    user?: string;
    version?: string;
    word_similarity_threshold: number | null;
    schema_migration: string | null;
  }>;
  routing: PhepDo<{ distance_km: number; phut: number }>;
  data: PhepDo<{ tiles: string | null; poi: string | null; updated_at: string | null }>;
}

export interface DongRoute {
  route: string;
  requests: number;
  errors_5xx: number;
  quota_429: number;
  p95_ms: number;
}

export interface DongTenant extends Omit<DongRoute, 'route'> {
  tenant_id: string;
  ten: string | null;
}

export interface Metrics {
  computed_at: string;
  routes: DongRoute[];
  tenants: DongTenant[];
}

export const getHealth = (): Promise<Health> => apiFetch<Health>('/v1/admin/health');

export const getMetrics = (window: CuaSo): Promise<Metrics> =>
  apiFetch<Metrics>(`/v1/admin/metrics?window=${window}`);
```

- [ ] **Step 2: Viết `hooks.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { type CuaSo, getHealth, getMetrics } from './api';

export const healthKeys = {
  health: ['health', 'trang-thai'] as const,
  metrics: (window: CuaSo) => ['health', 'so-lieu', window] as const,
};

/**
 * Trạng thái sống KHÔNG cache phía client: mở màn hình là đo lại. Máy chủ định tuyến là máy Mac ở
 * nhà — nó ngủ là routing chết, và một ảnh chụp cũ 5 phút đúng lúc đó là câu trả lời sai.
 */
export function useHealth() {
  return useQuery({ queryKey: healthKeys.health, queryFn: getHealth, staleTime: 0, retry: false });
}

/** Số liệu thì cache đúng bằng cache phía máy chủ — hỏi lại sớm hơn chỉ nhận lại cùng câu trả lời. */
export function useMetrics(window: CuaSo) {
  return useQuery({
    queryKey: healthKeys.metrics(window),
    queryFn: () => getMetrics(window),
    staleTime: 300_000,
    retry: false,
  });
}
```

- [ ] **Step 3: Kiểm typecheck**

Run: `cd apps/admin && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/health/api.ts apps/admin/src/features/health/hooks.ts
git commit -m "feat(admin): lời gọi và hook cho màn Sức khoẻ hệ thống"
```

---

### Task 10: Giao diện — màn hình

**Files:**
- Create: `apps/admin/src/features/health/page.tsx`
- Test: `apps/admin/src/features/health/page.test.tsx`

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/admin/src/features/health/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthPage } from './page';

const HEALTH = {
  checked_at: '2026-09-18T10:00:00.000Z',
  db: { ok: true, ms: 120, user: 'api', version: 'PostgreSQL 16.3', schema_migration: '0019_x' },
  routing: { ok: false, ms: 6001, error: 'Dịch vụ chỉ đường không phản hồi' },
  data: { ok: true, ms: 12, tiles: 'vn-20260901', poi: 'poi-20260901', updated_at: null },
};

const METRICS = {
  computed_at: '2026-09-18T09:58:00.000Z',
  routes: [
    { route: '/v1/autocomplete', requests: 127, errors_5xx: 0, quota_429: 3, p95_ms: 1182 },
    { route: '', requests: 40, errors_5xx: 0, quota_429: 0, p95_ms: 300 },
  ],
  tenants: [
    { tenant_id: 'de65cfba', ten: 'Phong_Admin', requests: 1267, errors_5xx: 0, quota_429: 43, p95_ms: 900 },
  ],
};

let duocGoi: string[] = [];

function mo() {
  duocGoi = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      duocGoi.push(url);
      return new Response(JSON.stringify(url.includes('/health') ? HEALTH : METRICS));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HealthPage />
    </QueryClientProvider>,
  );
}

describe('HealthPage', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', undefined));
  afterEach(() => vi.unstubAllGlobals());

  it('một phép đo hỏng không giấu hai phép đo còn lại', async () => {
    // Đây là hình dạng thật của sự cố: máy chủ định tuyến ngủ, DB vẫn chạy. Màn hình phải chỉ
    // đúng cái hỏng chứ không đỏ toàn bộ.
    mo();
    expect(await screen.findByText(/Dịch vụ chỉ đường không phản hồi/)).toBeVisible();
    expect(screen.getByText('0019_x')).toBeVisible();
    expect(screen.getByText('vn-20260901')).toBeVisible();
  });

  it('dòng số liệu trước 18/09 không có mẫu route, hiện nhãn thay vì ô trống', async () => {
    mo();
    expect(await screen.findByText('/v1/autocomplete')).toBeVisible();
    expect(screen.getByText(/trước 18\/09/)).toBeVisible();
  });

  it('đổi cửa sổ thì gọi lại đúng tham số window', async () => {
    mo();
    await screen.findByText('/v1/autocomplete');
    await userEvent.click(screen.getByRole('button', { name: '1 giờ' }));
    await waitFor(() => expect(duocGoi.some((u) => u.includes('window=1h'))).toBe(true));
  });

  it('hiện giờ tính số liệu để không ai tưởng đó là số của lúc này', async () => {
    mo();
    expect(await screen.findByText(/tính đến/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm exec vitest run apps/admin/src/features/health/page.test.tsx`
Expected: FAIL — `Failed to resolve import "./page"`

- [ ] **Step 3: Viết màn hình**

Tạo `apps/admin/src/features/health/page.tsx`:

```tsx
import { useState } from 'react';
import { type Column, RecordView } from '@/components/data-view';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CUA_SO,
  type CuaSo,
  type DongRoute,
  type DongTenant,
  type Health,
  NHAN_CUA_SO,
  type PhepDo,
} from './api';
import { useHealth, useMetrics } from './hooks';

const gio = (iso: string): string =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/** Dữ liệu ghi trước 18/09/2026 không có mẫu route: một ô trống trên bảng không nói được gì. */
const nhanRoute = (route: string): string => route || '(trước 18/09, chưa gắn mẫu route)';

const tiLe = (phan: number, tong: number): string =>
  tong === 0 ? '—' : `${((phan / tong) * 100).toFixed(1)}%`;

function The({ ten, do_, children }: { ten: string; do_: PhepDo<object>; children: React.ReactNode }) {
  return (
    <article className="space-y-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{ten}</h2>
        <Badge tone={do_.ok ? 'brand' : 'warning'}>{do_.ok ? 'Bình thường' : 'Hỏng'}</Badge>
        <span className="ml-auto text-xs text-[var(--text-muted)]">{do_.ms} ms</span>
      </div>
      {do_.ok ? (
        children
      ) : (
        <p className="text-sm text-[var(--text-muted)]">{do_.error}</p>
      )}
    </article>
  );
}

const cotRoute: Column<DongRoute>[] = [
  { key: 'route', header: 'Endpoint', render: (r) => <span className="font-mono text-xs">{nhanRoute(r.route)}</span> },
  { key: 'requests', header: 'Lượt', render: (r) => r.requests.toLocaleString('vi-VN') },
  { key: 'p95', header: 'p95', render: (r) => `${r.p95_ms} ms` },
  { key: 'loi', header: '5xx', render: (r) => tiLe(r.errors_5xx, r.requests) },
  { key: 'q429', header: '429', render: (r) => tiLe(r.quota_429, r.requests) },
];

const cotTenant: Column<DongTenant>[] = [
  { key: 'ten', header: 'Tenant', render: (r) => r.ten ?? <span className="font-mono text-xs">{r.tenant_id || '(không kèm khoá)'}</span> },
  { key: 'requests', header: 'Lượt', render: (r) => r.requests.toLocaleString('vi-VN') },
  { key: 'p95', header: 'p95', render: (r) => `${r.p95_ms} ms` },
  { key: 'q429', header: '429', render: (r) => tiLe(r.quota_429, r.requests) },
];

function TrangThai({ health }: { health: Health }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <The ten="Cơ sở dữ liệu" do_={health.db}>
        <dl className="space-y-0.5 text-xs">
          <div className="flex gap-1">
            <dt className="text-[var(--text-muted)]">migration:</dt>
            <dd className="font-mono">{health.db.ok ? (health.db.schema_migration ?? '—') : null}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-[var(--text-muted)]">role:</dt>
            <dd className="font-mono">{health.db.ok ? (health.db.user ?? '—') : null}</dd>
          </div>
        </dl>
      </The>
      <The ten="Định tuyến" do_={health.routing}>
        <p className="text-xs text-[var(--text-muted)]">
          Tuyến thử {health.routing.ok ? health.routing.distance_km : 0} km ·{' '}
          {health.routing.ok ? health.routing.phut : 0} phút
        </p>
      </The>
      <The ten="Dữ liệu" do_={health.data}>
        <dl className="space-y-0.5 text-xs">
          <div className="flex gap-1">
            <dt className="text-[var(--text-muted)]">tiles:</dt>
            <dd className="font-mono">{health.data.ok ? (health.data.tiles ?? '—') : null}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-[var(--text-muted)]">POI:</dt>
            <dd className="font-mono">{health.data.ok ? (health.data.poi ?? '—') : null}</dd>
          </div>
        </dl>
      </The>
    </div>
  );
}

export function HealthPage() {
  const [cuaSo, setCuaSo] = useState<CuaSo>('24h');
  const health = useHealth();
  const metrics = useMetrics(cuaSo);

  return (
    <div className="space-y-4">
      {health.isPending && <LoadingSkeleton rows={3} />}
      {health.isError && <ErrorState onRetry={() => health.refetch()} />}
      {health.data && <TrangThai health={health.data} />}

      <div className="flex flex-wrap items-center gap-2">
        {CUA_SO.map((w) => (
          <Button
            key={w}
            variant={w === cuaSo ? 'primary' : 'ghost'}
            onClick={() => setCuaSo(w)}
            aria-pressed={w === cuaSo}
          >
            {NHAN_CUA_SO[w]}
          </Button>
        ))}
        {metrics.data && (
          <span className="ml-auto text-xs text-[var(--text-muted)]">
            Số liệu tính đến {gio(metrics.data.computed_at)}
          </span>
        )}
      </div>

      {metrics.isPending && <LoadingSkeleton rows={4} />}
      {metrics.isError && <ErrorState onRetry={() => metrics.refetch()} />}
      {metrics.data && metrics.data.routes.length === 0 && (
        <EmptyState message="Chưa có lượt gọi nào trong khoảng này" />
      )}
      {metrics.data && metrics.data.routes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Theo endpoint</h2>
          <RecordView
            items={metrics.data.routes}
            columns={cotRoute}
            rowKey={(r) => r.route || '(trong)'}
            renderCard={(r) => (
              <article className="space-y-1 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="break-all font-mono text-xs">{nhanRoute(r.route)}</p>
                <p className="text-sm">
                  {r.requests.toLocaleString('vi-VN')} lượt · p95 {r.p95_ms} ms · 5xx{' '}
                  {tiLe(r.errors_5xx, r.requests)} · 429 {tiLe(r.quota_429, r.requests)}
                </p>
              </article>
            )}
          />
        </section>
      )}
      {metrics.data && metrics.data.tenants.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Theo tenant</h2>
          <RecordView
            items={metrics.data.tenants}
            columns={cotTenant}
            rowKey={(r) => r.tenant_id || '(khong-khoa)'}
            renderCard={(r) => (
              <article className="space-y-1 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-sm font-semibold">{r.ten ?? r.tenant_id || '(không kèm khoá)'}</p>
                <p className="text-sm">
                  {r.requests.toLocaleString('vi-VN')} lượt · p95 {r.p95_ms} ms · 429{' '}
                  {tiLe(r.quota_429, r.requests)}
                </p>
              </article>
            )}
          />
        </section>
      )}
    </div>
  );
}
```

**Trước khi viết:** mở `apps/admin/src/components/states.tsx` và `apps/admin/src/components/ui/button.tsx` để dùng ĐÚNG tên prop hiện có (`EmptyState`/`ErrorState` nhận prop gì, `Button` có `variant` nào). Nếu khác, sửa theo file thật chứ không sửa file thật theo plan này.

- [ ] **Step 4: Chạy test**

Run: `pnpm exec vitest run apps/admin/src/features/health/page.test.tsx`
Expected: PASS — 4 test.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/health/
git commit -m "feat(admin): màn Sức khoẻ hệ thống — ba thẻ trạng thái và hai bảng số liệu"
```

---

### Task 11: Nối route và lật test 404

**Files:**
- Modify: `apps/admin/src/routes.tsx`
- Modify: `apps/admin/src/routes.test.tsx`

- [ ] **Step 1: Sửa test trước (nó đang ghi nhận hiện trạng cũ)**

Trong `apps/admin/src/routes.test.tsx`, vòng lặp ở dòng ~54 đang khẳng định `/admin/health` rơi vào trang 404. Bỏ `/admin/health` khỏi danh sách:

```tsx
  for (const duongDan of ['/admin/khong-co-that']) {
```

Và thêm test mới ngay sau test của `/admin/audit`:

```tsx
  it('/admin/health có màn hình thật từ pha 5, không còn rơi vào 404', async () => {
    window.history.pushState({}, '', '/admin/health');
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('Sức khoẻ hệ thống')).toBeVisible();
  });
```

**Đọc test `/admin/audit` ngay trên nó và chép đúng cách nó dựng router/chờ đợi** — file này có thể dùng `QueryClientProvider` hoặc stub `fetch`; giữ nguyên lối đó thay vì phát minh lối mới.

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm exec vitest run apps/admin/src/routes.test.tsx`
Expected: FAIL — `/admin/health` vẫn hiện trang 404, không tìm thấy tiêu đề.

- [ ] **Step 3: Nối route**

Trong `apps/admin/src/routes.tsx`, thêm lazy import cạnh các trang khác:

```tsx
const HealthPage = lazy(() =>
  import('@/features/health/page').then((module) => ({ default: module.HealthPage })),
);
```

Và thêm nhánh **trước** nhánh `*`:

```tsx
        { path: 'health', element: wait(<HealthPage />) },
```

- [ ] **Step 4: Chạy lại**

Run: `pnpm exec vitest run apps/admin/src/routes.test.tsx`
Expected: PASS — gồm cả test cũ của `/admin/audit` và `/admin` ↔ `/admin/edits`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/routes.tsx apps/admin/src/routes.test.tsx
git commit -m "feat(admin): nối /admin/health vào router"
```

---

### Task 12: Bốn tầng xanh, chứng cứ, lên production

**Files:**
- Create: `docs/evidence/admin/2026-09-18-pha-5-suc-khoe-he-thong.md`

- [ ] **Step 1: Lint và typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS. **Turbo có thể phát lại kết quả cũ từ cache** — nếu typecheck xanh tức thì mà vừa sửa code, chạy lại với `--force` để chắc.

- [ ] **Step 2: Bộ test đầy đủ**

Run: `pnpm test`
Expected: PASS (bộ này build luôn `@mapslibvn/admin`, nên lỗi build giao diện sẽ lộ ở đây).

- [ ] **Step 3: Test có DB thật**

Run: `pnpm test:api-db`
Expected: PASS, gồm 4 test mới của Task 8.

- [ ] **Step 4: E2E trang Admin**

Run: `pnpm test:admin-e2e`
Expected: PASS.

- [ ] **Step 5: Viết khung chứng cứ**

Tạo `docs/evidence/admin/2026-09-18-pha-5-suc-khoe-he-thong.md` với các mục để trống chờ số thật:

```markdown
# Chứng cứ pha 5 — Sức khoẻ hệ thống

## 1. Bốn tầng xanh ở máy (điền kết quả thật)
- `pnpm lint` ·  `pnpm typecheck` (không cache) ·  `pnpm test` ·  `pnpm test:api-db` ·  `pnpm test:admin-e2e`

## 2. Secret trên production
- [ ] `wrangler secret put CF_ANALYTICS_TOKEN --env production` (token CHỈ có Account Analytics: Read)
- [ ] `wrangler secret list --env production` thấy tên `CF_ANALYTICS_TOKEN`

## 3. Deploy
- version:
- `wrangler deployments list --env production` (mốc thời gian):

## 4. Nghiệm thu thật trên điện thoại
- [ ] `/admin/health` mở được, ba thẻ trạng thái hiện đủ
- [ ] Bảng theo endpoint có số, p95 khớp thứ tự hợp lý
- [ ] Bấm 1 giờ / 24 giờ / 7 ngày đổi được số
- [ ] Dòng "Số liệu tính đến HH:MM" đúng giờ VN
- [ ] **Phép thử máy chủ ngủ:** tắt Docker định tuyến (hoặc để máy Mac ngủ) → thẻ Định tuyến
      chuyển sang "Hỏng" kèm lý do, hai thẻ còn lại vẫn bình thường
```

- [ ] **Step 6: Commit và push**

```bash
git add docs/evidence/admin/2026-09-18-pha-5-suc-khoe-he-thong.md
git commit -m "docs(admin): khung chứng cứ nghiệm thu pha 5"
git push
```

- [ ] **Step 7: PHONG đặt secret (máy KHÔNG tự làm được)**

Việc này cần đăng nhập dashboard Cloudflare, nên PHONG làm bằng tay:

1. Dashboard → **Manage Account → API Tokens → Create Token → Create Custom Token**.
2. Permissions: **Account · Analytics · Read**. Account Resources: đúng tài khoản đang chạy MapsLibVN. Không thêm quyền nào khác.
3. Chạy trong terminal của phiên này bằng tiền tố `!`:

```
! cd apps/api && npx wrangler secret put CF_ANALYTICS_TOKEN --env production
```

4. Xác nhận: `npx wrangler secret list --env production` phải thấy `CF_ANALYTICS_TOKEN`.

- [ ] **Step 8: Deploy**

Run: `pnpm deploy:api`
Expected: deploy xong, in ra version mới. Không có migration nên không cần `check:migration`.

- [ ] **Step 9: Nghiệm thu trên production**

Mở `https://api.ai-solutions.io.vn/admin/health` bằng điện thoại thật và điền mục 4 của file chứng cứ. Lưu ý: Access chặn ở BIÊN nên gọi trần `/v1/admin/health` bằng curl luôn ra 302 — mã HTTP **không** phân biệt được route đã deploy với route không tồn tại. Muốn biết bản nào đang chạy thì đọc `wrangler deployments list --env production`.

---

## Self-review

**Phủ spec 11.5 —** lượt gọi/p95/tỉ lệ lỗi tách theo tenant (Task 3, 5, 10) · DB + `schema_migration` từ `/healthz/db` (Task 6, 7) · định tuyến đo bằng `/route` thật (Task 7) · phiên bản manifest tile và POI (Task 7) · cache 5 phút + "số liệu tính đến HH:MM" (Task 5, 10). Một chỗ **cố ý lệch spec**: spec viết cache 5 phút cho cả màn, plan này chỉ cache phần số liệu còn phần trạng thái sống luôn đo tươi — PHONG chốt 18/09/2026, lý do ở mục Kiến trúc.

**Phủ spec mục 12 —** hai dòng `GET /v1/admin/metrics` và `GET /v1/admin/health` của bảng API đã có route.

**Tiêu chí nghiệm thu mục 18 —** số 1 (bốn tầng xanh) ở Task 12 · số 10 (mỗi route mới có bài kiểm bằng role `api` thật) ở Task 8 · số 5 không áp dụng vì pha này không có migration.

**Không có placeholder.** Chỗ duy nhất phải tra khi làm là tên prop của `EmptyState`/`ErrorState`/`Button` (Task 10 Step 3) và lối dựng router của `routes.test.tsx` (Task 11 Step 1) — cả hai đều đã nói rõ phải đọc file nào.
