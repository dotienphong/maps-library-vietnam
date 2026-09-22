# Ma trận khoảng cách và tối ưu thứ tự điểm dừng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant gọi `GET /v1/matrix` là có bảng thời gian/quãng đường N×M, gọi `GET /v1/optimized-route` là có thứ tự ghé tối ưu cho một chuyến kèm tuyến đầy đủ; cả hai tính **một lượt** nhóm quota `directions`, có trong SDK core, docs và website.

**Architecture:** Hai endpoint GET mới trên Worker `apps/api`, dùng hai action Valhalla có sẵn (`sources_to_targets`, `optimized_route`) qua đúng khuôn `/v1/directions`: `requireAuth` → `quotaMiddleware('directions', preflight)` → `cachedJson` → `routingFetch` → dịch sang schema MapsLibVN. Trần cỡ (≤ 100 cặp, ≤ 10 điểm dừng) và trần chim bay kiểm ở Worker **trước** khi tốn máy chủ. Response tối ưu thứ tự là `DirectionsResponse` cộng `order`, nên SDK web/RN vẽ được ngay. Endpoint **deploy trước, đo production, rồi mới công bố** trong docs và site.

**Tech Stack:** TypeScript (Hono trên Cloudflare Workers; vitest + `@cloudflare/vitest-pool-workers` với `fetchMock` tự viết ở `apps/api/test/helpers/fetch-mock.ts`), `@mapslibvn/core` (tsup + size-limit), Node 22 ESM `.mjs` với `checkJs` cho scripts, Astro (site), Starlight (docs), Docker Compose (Valhalla dev Quận 1).

> **ĐÃ THỰC THI XONG 22/09/2026** — trừ `pnpm sdk:publish` đang chờ mã 2FA. Thực tế khác plan ở ba
> chỗ, đều do phép đo production buộc phải đổi: (1) trần hạ 100 → **50 cặp** và 10 → **8 điểm dừng**;
> (2) thêm `MATRIX_RATE_LIMITER` 6 request/phút mà bản plan không có; (3) nguyên nhân chậm hoá ra là
> `PG_SHARED_BUFFERS=4096MB` trên máy chủ 3,7 GB chứ không phải tính năng. Xem DEVLOG mục 33 và
> `docs/evidence/routing/2026-09-22-matrix.md`.

**Spec:** `docs/superpowers/specs/2026-09-22-ma-tran-toi-uu-thu-tu-design.md` — đọc mục 2 (tiền đề đã xác minh) và mục 4 (hợp đồng API) trước khi bắt đầu.

---

## Quy ước chung cho mọi task

- Làm trên nhánh `feat/ma-tran-toi-uu-thu-tu` (đã có, chứa spec). Chạy lệnh từ gốc repo.
- Test API: `pnpm --filter @mapslibvn/api exec vitest run test/<file>.test.ts` (một file) hoặc `pnpm --filter @mapslibvn/api test` (cả bộ). Test root (core, scripts, site): `pnpm exec vitest run <đường dẫn file>`. Typecheck: `pnpm typecheck`. Lint: `pnpm lint` (biome; tự sửa bằng `pnpm lint:fix`).
- **`pnpm --filter @mapslibvn/core build` phải chạy lại sau mỗi lần sửa `packages/core/src`** trước khi test API hay typecheck: Worker và các gói khác import `@mapslibvn/core` từ `dist`. Lệnh build này cũng chạy `size-limit` (trần 16 kB gzip cho barrel).
- `exactOptionalPropertyTypes` và `noUncheckedIndexedAccess` đang bật: không gán `undefined` vào thuộc tính tuỳ chọn (dùng spread có điều kiện hoặc bỏ khoá), `arr[i]` luôn có thể `undefined` — lấy ra biến rồi kiểm.
- Biome cấm `!` (non-null assertion) và `forEach` (dùng `for…of` với `.entries()`); format nghiêm — sau khi dán code từ plan, chạy `pnpm lint:fix` rồi `pnpm lint`.
- API unit test **không được cần Postgres hay mạng**: mock Valhalla bằng `fetchMock.get('https://routing.test')` (origin test trong `apps/api/vitest.config.ts`); `fetchMock.disableNetConnect()` nên request không có interceptor → lỗi → 503. Một test 400 **không** đăng ký interceptor là bằng chứng Valhalla không bị gọi.
- Toạ độ: tham số API và client `[lat, lng]`; mọi toạ độ **trong response** `[lng, lat]`.
- Scripts `.mjs` mới nằm trong `include` của `tsconfig.scripts.json` nên phải qua `checkJs`: viết JSDoc kiểu đầy đủ cho tham số và kiểu trả về.
- Commit message tiếng Việt, tiền tố `feat/fix/test/docs/chore(scope)`, kết bằng dòng trống rồi `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. **Không push** cho tới Task 13 và 17 (PHONG duyệt merge/push).
- Production: auto mode chặn Fable đụng production. Mọi lệnh gọi production trong plan (smoke, curl có khoá) do **PHONG gõ với tiền tố `!`**, kết quả dán lại để ghi evidence.

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `apps/api/src/routing/params.ts` (+ `test/routing-params.test.ts`) | Thêm `parseLatLngList`, `assertInVietnam`, `cacheKeyPoints`, `MATRIX_MAX_CROW_DISTANCE_M`; export `requirePair`, `oneOf`; `parseDirectionsParams` dùng lại chúng, **không đổi hành vi** |
| `apps/api/src/routing/graph.ts` (mới) | `graphBuiltAt(c)`, `builtAtIso` — chuyển từ `routes/directions.ts` để ba route dùng chung |
| `apps/api/src/routing/valhalla.ts` (+ `test/routing-valhalla.test.ts`) | `ValhallaPath` union, `callValhalla<T>(env, path, body, options)`, `MATRIX_TIMEOUT_MS`, `ValhallaMatrixCell/Response`, `original_index`, export `VALHALLA_LANGUAGE` |
| `packages/core/src/types.ts`, `client.ts` (+ `client.matrix.test.ts`, `client.optimized-route.test.ts`) | `MatrixResponse`, `OptimizedRouteResponse`, `MatrixOptions`, `OptimizedRouteOptions`, `client.matrix()`, `client.optimizedRoute()` |
| `packages/web/src/index.ts`, `packages/react-native/src/index.ts` | re-export bốn kiểu mới |
| `apps/api/src/routing/matrix.ts` (+ `test/routing-matrix.test.ts`) | `parseMatrixParams`, `matrixBody`, `matrixCacheUrl`, `translateMatrix`, hằng số trần |
| `apps/api/src/routes/matrix.ts` (+ `test/matrix-route.test.ts`) | `GET /v1/matrix` |
| `apps/api/src/routing/optimized.ts` (+ `test/routing-optimized.test.ts`) | `parseOptimizedParams`, `optimizedBody`, `optimizedCacheUrl`, `translateOptimized`, `OPTIMIZED_MAX_STOPS` |
| `apps/api/src/routes/optimized.ts` (+ `test/optimized-route.test.ts`) | `GET /v1/optimized-route` |
| `apps/api/src/index.ts` | nối hai route |
| `apps/api/test/fixtures/valhalla/matrix-2x2.json`, `optimized-two-stops.json` | fixture tay cho unit test; `q1-matrix.json`, `q1-optimized.json` capture từ Valhalla Quận 1 |
| `scripts/routing-test.mjs`, `apps/api/test-routing/matrix.rtest.mjs`, `optimized-route.rtest.mjs` | capture ba action; test tích hợp qua wrangler dev |
| `scripts/lib/smoke-matrix.mjs` (+ `.test.mjs`), `scripts/smoke-matrix.mjs`, `package.json` | smoke production bài A–D |
| `apps/docs/src/content/docs/{api,tinh-nang,sdk,dan-duong,khoa-api,tu-host}.md`, spec A | tài liệu |
| `apps/site/src/lib/{doi-dau,trang}.ts`, `pages/{tinh-nang,index}.astro`, `pages/so-sanh/vietmap.astro`, `e2e/trang.spec.ts` | website |
| `docs/evidence/routing/2026-09-<ngày>-matrix.md`, `docs/DEVLOG.md`, spec (trạng thái) | bằng chứng và nhật ký |

---

### Task 1: `routing/params.ts` — hàm dùng chung cho danh sách điểm, hộp VN, khoá cache

**Files:**
- Modify: `apps/api/src/routing/params.ts`
- Test: `apps/api/test/routing-params.test.ts`

- [x] **Step 1: Viết test đỏ (thêm vào cuối `apps/api/test/routing-params.test.ts`)**

Sửa dòng import đầu file thành:

```ts
import {
  assertInVietnam,
  cacheKeyPoints,
  directionsCacheUrl,
  haversineM,
  MATRIX_MAX_CROW_DISTANCE_M,
  MAX_CROW_DISTANCE_M,
  parseDirectionsParams,
  parseLatLngList,
} from '../src/routing/params';
```

Thêm vào cuối file:

```ts
describe('hàm dùng chung cho ma trận và tối ưu thứ tự (spec 22/09 mục 4.7)', () => {
  it('parseLatLngList đếm TRƯỚC khi parse: 26 phần tử hỏng vẫn báo "tối đa 25 điểm"', () => {
    const many = Array.from({ length: 26 }, () => 'not-a-coordinate').join(';');
    expectInvalidRequest(
      () => parseLatLngList(many, 'sources', { min: 1, max: 25 }),
      /sources tối đa 25 điểm/,
    );
  });

  it('parseLatLngList: rỗng với min 1 → bắt buộc; min 0 → []; phần tử sai nêu chỉ số', () => {
    expectInvalidRequest(
      () => parseLatLngList(undefined, 'targets', { min: 1, max: 25 }),
      /targets bắt buộc/,
    );
    expectInvalidRequest(() => parseLatLngList('   ', 'targets', { min: 1, max: 25 }), /bắt buộc/);
    expect(parseLatLngList('', 'via', { min: 0, max: 5 })).toEqual([]);
    expectInvalidRequest(
      () => parseLatLngList('10.7,106.7;abc', 'stops', { min: 1, max: 10 }),
      /stops\[1\]/,
    );
    expect(parseLatLngList('10.7,106.7;10.8,106.8', 'stops', { min: 1, max: 10 })).toEqual([
      { lat: 10.7, lng: 106.7 },
      { lat: 10.8, lng: 106.8 },
    ]);
  });

  it('assertInVietnam: Bangkok → 400 có chữ "Việt Nam"; HCM và HN qua', () => {
    expectInvalidRequest(() => assertInVietnam([HCM, { lat: 13.75, lng: 100.5 }]), /Việt Nam/);
    expect(() => assertInVietnam([HCM, HN])).not.toThrow();
  });

  it('cacheKeyPoints làm tròn 4 chữ số (~11 m) và nối bằng ";"', () => {
    expect(cacheKeyPoints([{ lat: 10.77981, lng: 106.69904 }, HCM])).toBe(
      '10.7798,106.6990;10.7769,106.7009',
    );
  });

  it('trần chim bay ma trận: xe máy 200 km, ô tô 400 km, đi bộ 50 km', () => {
    expect(MATRIX_MAX_CROW_DISTANCE_M).toEqual({ motorbike: 200_000, car: 400_000, walk: 50_000 });
    // Directions giữ trần riêng, không bị kéo theo.
    expect(MAX_CROW_DISTANCE_M.motorbike).toBe(500_000);
  });
});
```

- [x] **Step 2: Chạy test, phải đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-params.test.ts`
Expected: FAIL — `parseLatLngList`, `assertInVietnam`, `cacheKeyPoints`, `MATRIX_MAX_CROW_DISTANCE_M` không tồn tại.

- [x] **Step 3: Sửa `apps/api/src/routing/params.ts`**

Thay khối từ `const VN = …` tới hết hàm `oneOf` và hàm `parseDirectionsParams` bằng bản dưới (giữ nguyên `TRAVEL_MODES`, `DIRECTIONS_LANGS`, `MAX_VIA`, `MAX_CROW_DISTANCE_M`, `DirectionsParams`, `haversineM`, `directionsCacheUrl`):

```ts
/**
 * Trần đường chim bay cho ma trận và tối ưu thứ tự (spec 22/09/2026 mục 4.6): xe máy và ô tô đúng
 * bằng `max_matrix_distance` của Valhalla (motor_scooter 200 km, auto 400 km) để Worker chặn trước
 * thay vì để engine trả 400/154 cho cả request; đi bộ giữ 50 km cho khớp directions.
 */
export const MATRIX_MAX_CROW_DISTANCE_M: Readonly<Record<TravelMode, number>> = {
  motorbike: 200_000,
  car: 400_000,
  walk: 50_000,
};
/** Hộp bao Việt Nam mở rộng. */
const VN = { minLat: 8, maxLat: 24, minLng: 102, maxLng: 110 };

const inVietnam = (p: LatLng) =>
  p.lat >= VN.minLat && p.lat <= VN.maxLat && p.lng >= VN.minLng && p.lng <= VN.maxLng;

/** Mọi điểm phải trong hộp Việt Nam; message dùng chung ba endpoint dẫn đường. */
export function assertInVietnam(points: readonly LatLng[]): void {
  if (!points.every(inVietnam)) {
    throw new ApiError(400, 'invalid_request', 'Chỉ hỗ trợ chỉ đường trong Việt Nam');
  }
}

export function requirePair(raw: string | undefined, name: string): LatLng {
  const pair = parseLatLngPair(raw, name);
  if (!pair) throw new ApiError(400, 'invalid_request', `${name} bắt buộc, dạng "lat,lng"`);
  return pair;
}

/**
 * Tách "lat,lng;lat,lng…" thành danh sách điểm. Đếm TRƯỚC khi parse: chuỗi hàng nghìn điểm bị từ
 * chối ở bước đếm dấu ";" mà không tốn CPU parse toạ độ (khuôn `via` của directions).
 */
export function parseLatLngList(
  raw: string | undefined,
  name: string,
  { min, max }: { min: number; max: number },
): LatLng[] {
  const trimmed = (raw ?? '').trim();
  const parts = trimmed ? trimmed.split(';') : [];
  if (parts.length < min) {
    throw new ApiError(
      400,
      'invalid_request',
      min === 1 ? `${name} bắt buộc, dạng "lat,lng;lat,lng"` : `${name} cần ít nhất ${min} điểm`,
    );
  }
  if (parts.length > max) {
    throw new ApiError(400, 'invalid_request', `${name} tối đa ${max} điểm`);
  }
  return parts.map((part, i) => requirePair(part, `${name}[${i}]`));
}

export function oneOf<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  dflt: T,
  name: string,
): T {
  const value = (raw?.trim() || dflt) as T;
  if (!allowed.includes(value)) {
    throw new ApiError(400, 'invalid_request', `${name} chỉ nhận ${allowed.join(', ')}`);
  }
  return value;
}

/**
 * Toạ độ trong KHOÁ CACHE làm tròn 4 chữ số (~11 m). Bài học đo 20/09/2026 với cache directions:
 * 5 chữ số (1,1 m) nên không bao giờ trúng; gom 11 m lệch quãng đường 0,19 %, từ 56 m mới ra tuyến
 * khác hẳn. Chỉ khoá cache làm tròn — toạ độ gửi Valhalla giữ nguyên.
 */
export function cacheKeyPoints(points: readonly LatLng[]): string {
  return points.map(({ lat, lng }) => `${lat.toFixed(4)},${lng.toFixed(4)}`).join(';');
}

/** Kiểm tra hết ở Worker trước khi gọi Valhalla — request sai không được tốn máy chủ nhà. */
export function parseDirectionsParams(q: Record<string, string | undefined>): DirectionsParams {
  const from = requirePair(q.from, 'from');
  const to = requirePair(q.to, 'to');
  const via = parseLatLngList(q.via, 'via', { min: 0, max: MAX_VIA });
  const mode = oneOf(q.mode, TRAVEL_MODES, 'motorbike', 'mode');
  const lang = oneOf(q.lang, DIRECTIONS_LANGS, 'vi', 'lang');
  const alternativesRaw = q.alternatives?.trim() || '0';
  if (alternativesRaw !== '0' && alternativesRaw !== '1') {
    throw new ApiError(400, 'invalid_request', 'alternatives chỉ nhận 0 hoặc 1');
  }

  const locations = [from, ...via, to];
  assertInVietnam(locations);
  let total = 0;
  for (let i = 1; i < locations.length; i++) {
    const prev = locations[i - 1];
    const cur = locations[i];
    if (prev && cur) total += haversineM(prev, cur);
  }
  const limit = MAX_CROW_DISTANCE_M[mode];
  if (total > limit) {
    throw new ApiError(
      400,
      'invalid_request',
      `Tuyến ${mode} tối đa ${limit / 1000} km đường chim bay (đang ${Math.round(total / 1000)} km)`,
    );
  }
  // Valhalla không tính tuyến thay thế cho tuyến nhiều điểm (spec A mục 5.2).
  return { locations, mode, lang, alternatives: alternativesRaw === '1' && via.length === 0 };
}
```

Lưu ý: hành vi `parseDirectionsParams` không đổi — message `via tối đa 5 điểm`, tên phần tử `via[i]`, message hộp VN vẫn như cũ (test cũ trong file phải vẫn xanh).

- [x] **Step 4: Chạy test, phải xanh cả cũ lẫn mới**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-params.test.ts test/directions-route.test.ts`
Expected: PASS toàn bộ.

- [x] **Step 5: Lint, typecheck, commit**

```bash
pnpm lint:fix && pnpm lint && pnpm --filter @mapslibvn/api exec tsc --noEmit
git add apps/api/src/routing/params.ts apps/api/test/routing-params.test.ts
git commit -m "refactor(api): tách parseLatLngList, assertInVietnam, cacheKeyPoints cho ma trận và tối ưu thứ tự

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `routing/graph.ts` — `graphBuiltAt` dùng chung

**Files:**
- Create: `apps/api/src/routing/graph.ts`
- Modify: `apps/api/src/routes/directions.ts`
- Test: `apps/api/test/directions-route.test.ts` (sẵn có, không đổi — phải vẫn xanh)

- [x] **Step 1: Tạo `apps/api/src/routing/graph.ts`**

```ts
import type { Context } from 'hono';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { fetchValhallaStatus } from './valhalla';

const STATUS_CACHE_URL = 'https://cache.mapslibvn/routing-status?v=1';

export const builtAtIso = (unixSeconds: number | undefined): string | null =>
  typeof unixSeconds === 'number' && unixSeconds > 0
    ? new Date(unixSeconds * 1000).toISOString()
    : null;

/**
 * Ngày build graph cho `engine.graph` của directions, matrix và optimized-route; cache 5 phút; lỗi →
 * null, không làm hỏng response chính. Tách khỏi routes/directions.ts (spec 22/09 mục 4.7) để ba
 * route dùng một bản, và để routing/valhalla.ts vẫn thuần fetch, không import cache.
 */
export async function graphBuiltAt(c: Context<AppEnv>): Promise<string | null> {
  try {
    const response = await cachedJson(c.executionCtx, STATUS_CACHE_URL, 300, 300, async () => {
      const status = await fetchValhallaStatus(c.env);
      return { built_at: builtAtIso(status.tileset_last_modified) };
    });
    const body = (await response.json()) as { built_at: string | null };
    return body.built_at ? body.built_at.slice(0, 10) : null;
  } catch {
    return null;
  }
}
```

- [x] **Step 2: Sửa `apps/api/src/routes/directions.ts`**

Xoá `STATUS_CACHE_URL`, `builtAtIso`, `graphBuiltAt` và import `Context`, `cachedJson` không còn dùng (giữ `cachedJson` vì handler vẫn dùng). Đầu file thành:

```ts
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { quotaMiddleware } from '../quota';
import { builtAtIso, graphBuiltAt } from '../routing/graph';
import { directionsCacheUrl, parseDirectionsParams } from '../routing/params';
import { translateDirections } from '../routing/translate';
import { callValhalla, fetchValhallaStatus, valhallaBody } from '../routing/valhalla';

export const directions = new Hono<AppEnv>();
```

Phần `directions.get('/v1/directions', …)` và `directions.get('/healthz/routing', …)` giữ nguyên (chúng gọi `graphBuiltAt(c)` và `builtAtIso(...)` — giờ là import).

- [x] **Step 3: Chạy test route directions và lint**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/directions-route.test.ts && pnpm lint`
Expected: PASS; lint xanh (biome báo import thừa nếu còn `Context`).

- [x] **Step 4: Commit**

```bash
git add apps/api/src/routing/graph.ts apps/api/src/routes/directions.ts
git commit -m "refactor(api): chuyển graphBuiltAt sang routing/graph.ts để ba route dẫn đường dùng chung

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `routing/valhalla.ts` — `callValhalla<T>(env, path, body)`, kiểu ma trận, `original_index`

**Files:**
- Modify: `apps/api/src/routing/valhalla.ts`, `apps/api/src/routes/directions.ts:43`, `apps/api/src/health/phep-do.ts:68`
- Test: `apps/api/test/routing-valhalla.test.ts`

- [x] **Step 1: Sửa test cũ theo chữ ký mới và thêm test đỏ**

Trong `apps/api/test/routing-valhalla.test.ts`, khối `describe('callValhalla / fetchValhallaStatus (fetchMock)')`: mọi `callValhalla(env, {})` → `callValhalla(env, '/route', {})`, và `callValhalla(env, {}, { fetchImpl: hang, timeoutMs: 20 })` → `callValhalla(env, '/route', {}, { fetchImpl: hang, timeoutMs: 20 })`. Thêm vào cuối khối đó:

```ts
  it('gọi đúng đường dẫn cho ma trận và tối ưu thứ tự; MATRIX_TIMEOUT_MS = 20 s', async () => {
    const origin = fetchMock.get('https://routing.test');
    origin
      .intercept({ path: '/sources_to_targets', method: 'POST' })
      .reply(200, { sources_to_targets: [] });
    expect(await callValhalla(env, '/sources_to_targets', {})).toEqual({ sources_to_targets: [] });
    origin.intercept({ path: '/optimized_route', method: 'POST' }).reply(200, { trip: { legs: [] } });
    expect(await callValhalla(env, '/optimized_route', {})).toEqual({ trip: { legs: [] } });
    expect(MATRIX_TIMEOUT_MS).toBe(20_000);
    expect(VALHALLA_LANGUAGE).toEqual({ vi: 'vi-VN', en: 'en-US' });
  });
```

Thêm `MATRIX_TIMEOUT_MS`, `VALHALLA_LANGUAGE` vào import từ `'../src/routing/valhalla'`.

- [x] **Step 2: Chạy test, phải đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-valhalla.test.ts`
Expected: FAIL — `MATRIX_TIMEOUT_MS`/`VALHALLA_LANGUAGE` không export; các ca cũ đỏ vì `callValhalla(env, '/route', {})` gửi `'/route'` làm body.

- [x] **Step 3: Sửa `apps/api/src/routing/valhalla.ts`**

Đổi `const VALHALLA_LANGUAGE` thành `export const VALHALLA_LANGUAGE`. Sau `STATUS_TIMEOUT_MS` thêm:

```ts
/** Ma trận 100 cặp và TSP 12 điểm là nhiều lần tính đường; dưới trần 30 s của handler thương mại. */
export const MATRIX_TIMEOUT_MS = 20_000;
export type ValhallaPath = '/route' | '/status' | '/sources_to_targets' | '/optimized_route';
```

Trong `ValhallaTrip`, đổi `locations` thành:

```ts
  /** `original_index` chỉ có ở /optimized_route: chỉ số của điểm trong request. */
  locations: { lat: number; lon: number; street?: string; original_index?: number }[];
```

Sau `ValhallaRouteResponse` thêm:

```ts
/** Một ô của /sources_to_targets (Valhalla 3.8, đã xác minh 22/09/2026): null khi không nối được. */
export interface ValhallaMatrixCell {
  from_index: number;
  to_index: number;
  /** giây */
  time: number | null;
  /** km (request gửi units=kilometers) */
  distance: number | null;
}
export interface ValhallaMatrixResponse {
  sources_to_targets: ValhallaMatrixCell[][];
  /** Toạ độ ĐÃ BÁM vào đường — Worker không dùng, echo lại toạ độ người gọi gửi. */
  sources: { lat: number; lon: number }[];
  targets: { lat: number; lon: number }[];
  units?: string;
  algorithm?: string;
  id?: string;
}
```

Đổi tham số `path` của `routingFetch` từ `'/route' | '/status'` thành `ValhallaPath`. Thay toàn bộ hàm `callValhalla` bằng:

```ts
/**
 * Gọi một action POST của Valhalla và trả JSON theo kiểu người gọi khai. Đổi chữ ký 22/09/2026
 * (thêm `path`) — ba chỗ gọi: routes/directions.ts, health/phep-do.ts, và hai route mới.
 */
export async function callValhalla<T = ValhallaRouteResponse>(
  env: RoutingEnv,
  path: Exclude<ValhallaPath, '/status'>,
  body: unknown,
  options: CallOptions = {},
): Promise<T> {
  const response = await routingFetch(
    env,
    path,
    { method: 'POST', body: JSON.stringify(body) },
    options.timeoutMs ?? ROUTE_TIMEOUT_MS,
    options.fetchImpl ?? fetch,
  );
  if (!response.ok) {
    let parsed: ValhallaErrorBody | null = null;
    try {
      parsed = (await response.json()) as ValhallaErrorBody;
    } catch {
      // A non-JSON error is still an upstream failure and must not leak to callers.
    }
    throw mapValhallaError(response.status, parsed);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường trả dữ liệu không hợp lệ');
  }
}
```

- [x] **Step 4: Cập nhật hai chỗ gọi**

`apps/api/src/routes/directions.ts` dòng `callValhalla(c.env, valhallaBody(params, crypto.randomUUID())),` → `callValhalla(c.env, '/route', valhallaBody(params, crypto.randomUUID())),`.

`apps/api/src/health/phep-do.ts` dòng 68:

```ts
  const json = await callValhalla(env, '/route', valhallaBody(TUYEN_THU, crypto.randomUUID()), {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
```

- [x] **Step 5: Chạy test và typecheck**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-valhalla.test.ts test/directions-route.test.ts && pnpm --filter @mapslibvn/api exec tsc --noEmit`
Expected: PASS; tsc 0 lỗi (nếu còn chỗ gọi `callValhalla` hai tham số, tsc chỉ ra — sửa theo mẫu trên).

- [x] **Step 6: Lint, commit**

```bash
pnpm lint:fix && pnpm lint
git add apps/api/src/routing/valhalla.ts apps/api/src/routes/directions.ts apps/api/src/health/phep-do.ts apps/api/test/routing-valhalla.test.ts
git commit -m "feat(api): callValhalla nhận path; kiểu response ma trận và original_index cho optimized_route

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Gói core — kiểu, `client.matrix()`, `client.optimizedRoute()`, re-export web/RN

**Files:**
- Modify: `packages/core/src/types.ts`, `packages/core/src/client.ts`, `packages/web/src/index.ts`, `packages/react-native/src/index.ts`
- Create: `packages/core/src/client.matrix.test.ts`, `packages/core/src/client.optimized-route.test.ts`

- [x] **Step 1: Viết test đỏ `packages/core/src/client.matrix.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function stubClient(body: unknown) {
  const fetch = vi.fn(async () => jsonResponse(body));
  const client = createClient({
    apiKey: 'mlv_live_test00000000000000000000',
    baseUrl: 'https://api.test/',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const calledUrl = () => new URL((fetch.mock.calls[0] as unknown[])[0] as string | URL);
  return { client, calledUrl };
}

const EMPTY = {
  mode: 'motorbike',
  sources: [],
  targets: [],
  durations_s: [],
  distances_m: [],
  attribution: '© OpenStreetMap contributors',
};

describe('client.matrix', () => {
  it('ghép sources/targets dạng lat,lng nối ";", bỏ mode khi không truyền', async () => {
    const { client, calledUrl } = stubClient(EMPTY);
    await client.matrix({
      sources: [
        [10.7798, 106.699],
        [10.7725, 106.698],
      ],
      targets: [[10.8153, 106.6633]],
    });
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/matrix');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sources: '10.7798,106.699;10.7725,106.698',
      targets: '10.8153,106.6633',
    });
  });

  it('mode truyền thẳng; trả nguyên response', async () => {
    const body = { ...EMPTY, mode: 'car', engine: { name: 'valhalla', graph: '2026-09-15' } };
    const { client, calledUrl } = stubClient(body);
    const result = await client.matrix({ sources: [[10, 106]], targets: [[11, 107]], mode: 'car' });
    expect(Object.fromEntries(calledUrl().searchParams).mode).toBe('car');
    expect(result).toEqual(body);
  });
});
```

- [x] **Step 2: Viết test đỏ `packages/core/src/client.optimized-route.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function stubClient(body: unknown) {
  const fetch = vi.fn(async () => jsonResponse(body));
  const client = createClient({
    apiKey: 'mlv_live_test00000000000000000000',
    baseUrl: 'https://api.test/',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const calledUrl = () => new URL((fetch.mock.calls[0] as unknown[])[0] as string | URL);
  return { client, calledUrl };
}

const EMPTY = {
  routes: [],
  waypoints: [],
  attribution: '© OpenStreetMap contributors',
  order: [] as number[],
};

describe('client.optimizedRoute', () => {
  it('from + stops nối ";"; không có to thì KHÔNG gửi tham số to (máy chủ hiểu là quay về from)', async () => {
    const { client, calledUrl } = stubClient(EMPTY);
    await client.optimizedRoute({
      from: [10.7798, 106.699],
      stops: [
        [10.7716, 106.7043],
        [10.7769, 106.7032],
      ],
    });
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/optimized-route');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '10.7798,106.699',
      stops: '10.7716,106.7043;10.7769,106.7032',
    });
  });

  it('to/mode/lang truyền thẳng; trả nguyên response kèm order', async () => {
    const body = { ...EMPTY, order: [1, 0] };
    const { client, calledUrl } = stubClient(body);
    const result = await client.optimizedRoute({
      from: [10.7798, 106.699],
      stops: [
        [10.7716, 106.7043],
        [10.7769, 106.7032],
      ],
      to: [10.7725, 106.698],
      mode: 'car',
      lang: 'en',
    });
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({
      from: '10.7798,106.699',
      stops: '10.7716,106.7043;10.7769,106.7032',
      to: '10.7725,106.698',
      mode: 'car',
      lang: 'en',
    });
    expect(result.order).toEqual([1, 0]);
  });
});
```

- [x] **Step 3: Chạy test, phải đỏ**

Run: `pnpm exec vitest run packages/core/src/client.matrix.test.ts packages/core/src/client.optimized-route.test.ts`
Expected: FAIL — `client.matrix`/`client.optimizedRoute` không phải hàm.

- [x] **Step 4: Thêm kiểu vào `packages/core/src/types.ts`** (ngay sau `interface DirectionsResponse`)

```ts
/** `GET /v1/matrix` (spec 22/09/2026 mục 4.1). Toạ độ `[lng, lat]`; ô `null` là không nối được. */
export interface MatrixResponse {
  mode: TravelMode;
  /** Toạ độ bạn gửi, theo thứ tự gửi, đổi sang [lng, lat]. */
  sources: [number, number][];
  targets: [number, number][];
  /** durations_s[i][j]: giây từ sources[i] tới targets[j]. */
  durations_s: (number | null)[][];
  /** distances_m[i][j]: mét; null cùng ô với durations_s. */
  distances_m: (number | null)[][];
  attribution: string;
  /** Thông tin chẩn đoán, không phải hợp đồng ổn định. */
  engine?: { name: string; graph: string | null };
}

/** `GET /v1/optimized-route` (spec 22/09/2026 mục 4.2): tuyến đầy đủ cộng thứ tự ghé. */
export interface OptimizedRouteResponse extends DirectionsResponse {
  /** Chỉ số vào mảng `stops` bạn gửi, theo thứ tự nên đi; `waypoints` và `legs` đã xếp theo đó. */
  order: number[];
}
```

- [x] **Step 5: Sửa `packages/core/src/client.ts`**

Thêm `MatrixResponse`, `OptimizedRouteResponse` vào `import type { … } from './types'`. Ngay sau `interface DirectionsOptions` thêm:

```ts
export interface MatrixOptions {
  /** Mỗi điểm [lat, lng]; 1–25 điểm mỗi bên, tối đa 100 cặp (máy chủ kiểm). */
  sources: [number, number][];
  targets: [number, number][];
  /** Mặc định máy chủ: `motorbike`. */
  mode?: TravelMode;
}

export interface OptimizedRouteOptions {
  from: [number, number];
  /** 1–10 điểm [lat, lng], thứ tự tuỳ ý — máy chủ trả thứ tự nên đi trong `order`. */
  stops: [number, number][];
  /** Điểm kết thúc cố định; bỏ trống = quay về `from`. */
  to?: [number, number];
  mode?: TravelMode;
  lang?: DirectionsLang;
}
```

Trong object trả về của `createClient`, ngay sau phương thức `directions` thêm:

```ts
    /** Ma trận thời gian/quãng đường N×M, tính MỘT lượt Chỉ đường bất kể cỡ (spec 22/09/2026). */
    matrix: (opts: MatrixOptions) =>
      get<MatrixResponse>('/v1/matrix', {
        sources: opts.sources.map(latLng).join(';'),
        targets: opts.targets.map(latLng).join(';'),
        mode: opts.mode,
      }),
    /** Thứ tự ghé tối ưu cho một chuyến; response là DirectionsResponse + `order`, đưa thẳng vào routes.show(). */
    optimizedRoute: (opts: OptimizedRouteOptions) =>
      get<OptimizedRouteResponse>('/v1/optimized-route', {
        from: latLng(opts.from),
        stops: opts.stops.map(latLng).join(';'),
        to: opts.to ? latLng(opts.to) : undefined,
        mode: opts.mode,
        lang: opts.lang,
      }),
```

- [x] **Step 6: Re-export kiểu ở web và RN**

`packages/web/src/index.ts`, khối `export type { … } from '@mapslibvn/core'` đầu file: thêm `MatrixOptions,`, `MatrixResponse,` sau `MapsLibVNClient,` và `OptimizedRouteOptions,`, `OptimizedRouteResponse,` sau `Navigator,`. Làm y như vậy trong `packages/react-native/src/index.ts` (khối export type đầu file; `MapsLibVNClient` và `NavigationThresholds` đã có ở đó). `pnpm lint:fix` sẽ sắp lại thứ tự nếu lệch.

- [x] **Step 7: Build core (kèm size-limit), chạy test**

Run: `pnpm --filter @mapslibvn/core build && pnpm exec vitest run packages/core/src/client.matrix.test.ts packages/core/src/client.optimized-route.test.ts packages/core/src/client.directions.test.ts`
Expected: build xanh, `size-limit` in kích cỡ ≤ 16 kB; test PASS.

Nếu `size-limit` đỏ (vượt 16 kB): mở `packages/core/.size-limit.json`, đổi `"limit": "16 kB"` → `"17 kB"`, ghi lại số cũ/mới để đưa vào DEVLOG (Task 17), chạy lại build.

- [x] **Step 8: Typecheck toàn repo, lint, commit**

Run: `pnpm lint:fix && pnpm lint && pnpm typecheck`
Expected: xanh (typecheck build lại core rồi chạy turbo typecheck cho web/RN — thấy kiểu mới).

```bash
git add packages/core/src/types.ts packages/core/src/client.ts packages/core/src/client.matrix.test.ts packages/core/src/client.optimized-route.test.ts packages/web/src/index.ts packages/react-native/src/index.ts packages/core/.size-limit.json
git commit -m "feat(core): client.matrix và client.optimizedRoute cùng bốn kiểu mới; web/RN re-export

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Bỏ `.size-limit.json` khỏi `git add` nếu không đổi.)

---

### Task 5: `routing/matrix.ts` — tham số, body Valhalla, khoá cache

**Files:**
- Create: `apps/api/src/routing/matrix.ts`
- Test: `apps/api/test/routing-matrix.test.ts`

- [x] **Step 1: Viết test đỏ `apps/api/test/routing-matrix.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  MATRIX_MAX_PAIRS,
  MATRIX_MAX_SOURCES,
  MATRIX_MAX_TARGETS,
  matrixBody,
  matrixCacheUrl,
  parseMatrixParams,
} from '../src/routing/matrix';

const NTDB = '10.7798,106.6990';
const BT = '10.7725,106.6980';
const NHTP = '10.7769,106.7032';
const BX = '10.7716,106.7043';
const HN = '21.0285,105.8542';
const base = { sources: `${NTDB};${BT}`, targets: `${NHTP};${BX}` };
const points = (n: number, lat = 10.77) =>
  Array.from({ length: n }, (_, i) => `${lat},${(106.6 + i / 1000).toFixed(3)}`).join(';');

function expectInvalidRequest(action: () => unknown, message?: RegExp): void {
  try {
    action();
    throw new Error('phải ném');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).code).toBe('invalid_request');
    if (message) expect((error as ApiError).message).toMatch(message);
  }
}

describe('parseMatrixParams', () => {
  it('trần: 25 sources, 25 targets, 100 cặp', () => {
    expect([MATRIX_MAX_SOURCES, MATRIX_MAX_TARGETS, MATRIX_MAX_PAIRS]).toEqual([25, 25, 100]);
  });

  it('mặc định motorbike; giữ thứ tự điểm', () => {
    expect(parseMatrixParams(base)).toEqual({
      sources: [
        { lat: 10.7798, lng: 106.699 },
        { lat: 10.7725, lng: 106.698 },
      ],
      targets: [
        { lat: 10.7769, lng: 106.7032 },
        { lat: 10.7716, lng: 106.7043 },
      ],
      mode: 'motorbike',
    });
    expect(parseMatrixParams({ ...base, mode: 'car' }).mode).toBe('car');
  });

  it('thiếu sources/targets → 400 bắt buộc; mode lạ → 400', () => {
    expectInvalidRequest(() => parseMatrixParams({ targets: NHTP }), /sources bắt buộc/);
    expectInvalidRequest(() => parseMatrixParams({ sources: NTDB }), /targets bắt buộc/);
    expectInvalidRequest(() => parseMatrixParams({ ...base, mode: 'bike' }), /mode chỉ nhận/);
  });

  it('đếm trước parse: 26 phần tử hỏng → "tối đa 25 điểm"', () => {
    const many = Array.from({ length: 26 }, () => 'x').join(';');
    expectInvalidRequest(
      () => parseMatrixParams({ sources: many, targets: NHTP }),
      /sources tối đa 25 điểm/,
    );
    expectInvalidRequest(
      () => parseMatrixParams({ sources: NTDB, targets: many }),
      /targets tối đa 25 điểm/,
    );
  });

  it('25 × 25 hợp lệ từng bên nhưng 625 cặp → 400 nêu phép nhân; 25 × 4 = 100 qua', () => {
    expectInvalidRequest(
      () => parseMatrixParams({ sources: points(25), targets: points(25, 10.78) }),
      /tối đa 100 cặp .*25 × 25 = 625/,
    );
    const ok = parseMatrixParams({ sources: points(25), targets: points(4, 10.78) });
    expect(ok.sources).toHaveLength(25);
    expect(ok.targets).toHaveLength(4);
  });

  it('điểm ngoài hộp Việt Nam → 400 "Việt Nam"', () => {
    expectInvalidRequest(
      () => parseMatrixParams({ sources: NTDB, targets: '13.75,100.50' }),
      /Việt Nam/,
    );
  });

  it('chim bay: HCM → HN vượt 200 km xe máy, nêu đúng cặp; ô tô 400 km cũng vượt; đi bộ 50 km', () => {
    expectInvalidRequest(
      () => parseMatrixParams({ sources: `${NTDB};${BT}`, targets: `${NHTP};${HN}` }),
      /sources\[0\] → targets\[1\] cách 11\d\d km, ma trận motorbike tối đa 200 km/,
    );
    expectInvalidRequest(
      () => parseMatrixParams({ sources: NTDB, targets: HN, mode: 'car' }),
      /tối đa 400 km/,
    );
    // Vũng Tàu cách HCM ~95 km: xe máy qua, đi bộ không.
    expect(() => parseMatrixParams({ sources: NTDB, targets: '10.3460,107.0843' })).not.toThrow();
    expectInvalidRequest(
      () => parseMatrixParams({ sources: NTDB, targets: '10.3460,107.0843', mode: 'walk' }),
      /tối đa 50 km/,
    );
  });
});

describe('matrixBody', () => {
  it('sources/targets dạng lat/lon, costing theo mode, units kilometers, id; KHÔNG có directions_options', () => {
    const body = matrixBody(parseMatrixParams({ ...base, mode: 'car' }), 'req-1');
    expect(body).toEqual({
      sources: [
        { lat: 10.7798, lon: 106.699 },
        { lat: 10.7725, lon: 106.698 },
      ],
      targets: [
        { lat: 10.7769, lon: 106.7032 },
        { lat: 10.7716, lon: 106.7043 },
      ],
      costing: 'auto',
      units: 'kilometers',
      id: 'req-1',
    });
    expect(matrixBody(parseMatrixParams(base), 'r').costing).toBe('motor_scooter');
    expect(matrixBody(parseMatrixParams({ ...base, mode: 'walk' }), 'r').costing).toBe('pedestrian');
  });
});

describe('matrixCacheUrl', () => {
  it('làm tròn 4 chữ số, giữ thứ tự, có mode; khác mode → khác khoá', () => {
    const p = parseMatrixParams({ sources: '10.77981,106.69904', targets: '10.77251,106.69799' });
    expect(matrixCacheUrl(p)).toBe(
      'https://cache.mapslibvn/matrix?v=1&s=10.7798%2C106.6990&t=10.7725%2C106.6980&m=motorbike',
    );
    expect(matrixCacheUrl({ ...p, mode: 'car' })).not.toBe(matrixCacheUrl(p));
    // 11 m lệch cùng ô → cùng khoá (bài học cache directions 20/09/2026).
    const near = parseMatrixParams({ sources: '10.77984,106.69901', targets: '10.77249,106.69802' });
    expect(matrixCacheUrl(near)).toBe(matrixCacheUrl(p));
  });
});
```

- [x] **Step 2: Chạy test, phải đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-matrix.test.ts`
Expected: FAIL — module `../src/routing/matrix` không tồn tại.

- [x] **Step 3: Tạo `apps/api/src/routing/matrix.ts`**

```ts
import type { MatrixResponse, TravelMode } from '@mapslibvn/core';
import { ApiError } from '../errors';
import type { LatLng } from '../params';
import {
  assertInVietnam,
  cacheKeyPoints,
  haversineM,
  MATRIX_MAX_CROW_DISTANCE_M,
  oneOf,
  parseLatLngList,
  TRAVEL_MODES,
} from './params';
import { ROUTING_ATTRIBUTION } from './translate';
import { VALHALLA_COSTING, type ValhallaMatrixResponse } from './valhalla';

/**
 * Trần cỡ (spec 22/09/2026 mục 4.6): ngang một request Distance Matrix của Google (25 × 25, ≤ 100
 * element) và bằng 4 % trần 2.500 cặp của Valhalla. Một request = MỘT lượt nhóm `directions` bất kể
 * cỡ, nên trần cặp là lớp bảo vệ máy chủ 1 luồng. Đổi số ở đây phải đổi cả docs và site (mục 6.3).
 */
export const MATRIX_MAX_SOURCES = 25;
export const MATRIX_MAX_TARGETS = 25;
export const MATRIX_MAX_PAIRS = 100;

export interface MatrixParams {
  sources: LatLng[];
  targets: LatLng[];
  mode: TravelMode;
}

/** Cặp source–target xa nhất phải dưới trần theo mode; nêu đúng cặp vi phạm để người gọi sửa. */
function assertMatrixCrowDistance(
  sources: readonly LatLng[],
  targets: readonly LatLng[],
  mode: TravelMode,
): void {
  const limit = MATRIX_MAX_CROW_DISTANCE_M[mode];
  for (const [i, source] of sources.entries()) {
    for (const [j, target] of targets.entries()) {
      const d = haversineM(source, target);
      if (d > limit) {
        throw new ApiError(
          400,
          'invalid_request',
          `sources[${i}] → targets[${j}] cách ${Math.round(d / 1000)} km, ma trận ${mode} tối đa ${limit / 1000} km đường chim bay`,
        );
      }
    }
  }
}

/** Kiểm hết ở Worker trước khi gọi Valhalla: mỗi bên đếm trước parse, rồi tích cặp, hộp VN, chim bay. */
export function parseMatrixParams(q: Record<string, string | undefined>): MatrixParams {
  const sources = parseLatLngList(q.sources, 'sources', { min: 1, max: MATRIX_MAX_SOURCES });
  const targets = parseLatLngList(q.targets, 'targets', { min: 1, max: MATRIX_MAX_TARGETS });
  const pairs = sources.length * targets.length;
  if (pairs > MATRIX_MAX_PAIRS) {
    throw new ApiError(
      400,
      'invalid_request',
      `Ma trận tối đa ${MATRIX_MAX_PAIRS} cặp (đang ${sources.length} × ${targets.length} = ${pairs})`,
    );
  }
  const mode = oneOf(q.mode, TRAVEL_MODES, 'motorbike', 'mode');
  assertInVietnam([...sources, ...targets]);
  assertMatrixCrowDistance(sources, targets, mode);
  return { sources, targets, mode };
}

const toValhalla = ({ lat, lng }: LatLng) => ({ lat, lon: lng });

/** Body `POST /sources_to_targets`; không có directions_options vì ma trận không có câu chỉ dẫn. */
export function matrixBody(p: MatrixParams, requestId: string) {
  return {
    sources: p.sources.map(toValhalla),
    targets: p.targets.map(toValhalla),
    costing: VALHALLA_COSTING[p.mode],
    units: 'kilometers',
    id: requestId,
  };
}

export function matrixCacheUrl(p: MatrixParams): string {
  return `https://cache.mapslibvn/matrix?v=1&s=${encodeURIComponent(cacheKeyPoints(p.sources))}&t=${encodeURIComponent(cacheKeyPoints(p.targets))}&m=${p.mode}`;
}
```

(`MatrixResponse`, `ROUTING_ATTRIBUTION`, `ValhallaMatrixResponse` dùng ở Task 6 — biome sẽ báo import chưa dùng; tạm giữ bằng cách làm Task 6 trước khi lint, hoặc thêm import ở Task 6.)

- [x] **Step 4: Chạy test, phải xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-matrix.test.ts`
Expected: PASS.

- [x] **Step 5: Commit (chưa lint vì import chờ Task 6)**

```bash
git add apps/api/src/routing/matrix.ts apps/api/test/routing-matrix.test.ts
git commit -m "feat(api): parseMatrixParams, matrixBody, matrixCacheUrl với trần 25/25/100 và chim bay theo mode

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `translateMatrix` — bảng N×M, `null` khi không nối, 503 khi sai cỡ

**Files:**
- Modify: `apps/api/src/routing/matrix.ts`
- Create: `apps/api/test/fixtures/valhalla/matrix-2x2.json`
- Test: `apps/api/test/routing-matrix.test.ts`

- [x] **Step 1: Tạo fixture tay `apps/api/test/fixtures/valhalla/matrix-2x2.json`** (hình dạng đúng như Valhalla 3.8 trả 22/09, ô [1][1] không nối; hàng 2 cố ý đảo thứ tự ô để test đặt theo `from_index`/`to_index`)

```json
{
  "sources_to_targets": [
    [
      { "from_index": 0, "to_index": 0, "time": 167, "distance": 0.878, "begin_heading": 133.3, "end_heading": 274.7 },
      { "from_index": 0, "to_index": 1, "time": 255.4, "distance": 1.351, "begin_heading": 133.3, "end_heading": 152.8 }
    ],
    [
      { "from_index": 1, "to_index": 1, "time": null, "distance": null },
      { "from_index": 1, "to_index": 0, "time": 292, "distance": 1.504, "begin_heading": 149.9, "end_heading": 274.7 }
    ]
  ],
  "sources": [{ "lat": 10.779615, "lon": 106.698822 }, { "lat": 10.772233, "lon": 106.697532 }],
  "targets": [{ "lat": 10.777023, "lon": 106.703204 }, { "lat": 10.771501, "lon": 106.704101 }],
  "units": "kilometers",
  "algorithm": "costmatrix",
  "id": "fixture-2x2"
}
```

- [x] **Step 2: Thêm test đỏ vào `apps/api/test/routing-matrix.test.ts`**

Thêm import: `import fixture from './fixtures/valhalla/matrix-2x2.json';`, thêm `translateMatrix` vào import từ `'../src/routing/matrix'`, và `import type { ValhallaMatrixResponse } from '../src/routing/valhalla';`. Thêm cuối file:

```ts
describe('translateMatrix', () => {
  const p = parseMatrixParams(base);
  const json = fixture as unknown as ValhallaMatrixResponse;

  it('đặt ô theo from_index/to_index (hàng 2 fixture bị đảo), giây làm tròn, km → m, null cả hai bảng', () => {
    const out = translateMatrix(json, p, '2026-09-15');
    expect(out).toEqual({
      mode: 'motorbike',
      sources: [
        [106.699, 10.7798],
        [106.698, 10.7725],
      ],
      targets: [
        [106.7032, 10.7769],
        [106.7043, 10.7716],
      ],
      durations_s: [
        [167, 255],
        [292, null],
      ],
      distances_m: [
        [878, 1351],
        [1504, null],
      ],
      attribution: '© OpenStreetMap contributors',
      engine: { name: 'valhalla', graph: '2026-09-15' },
    });
  });

  it('time âm hoặc không phải số → null; graph null giữ nguyên', () => {
    const odd = {
      ...json,
      sources_to_targets: [
        [
          { from_index: 0, to_index: 0, time: -1, distance: 0.5 },
          { from_index: 0, to_index: 1, time: 'x', distance: 1 },
        ],
        [
          { from_index: 1, to_index: 0, time: 10, distance: 0.1 },
          { from_index: 1, to_index: 1, time: 11, distance: 0.2 },
        ],
      ],
    } as unknown as ValhallaMatrixResponse;
    const out = translateMatrix(odd, p, null);
    expect(out.durations_s).toEqual([
      [null, null],
      [10, 11],
    ]);
    expect(out.engine).toEqual({ name: 'valhalla', graph: null });
  });

  it('thiếu ô, ô trùng, chỉ số ngoài bảng, không phải mảng → 503 upstream_unavailable', () => {
    const cases: unknown[] = [
      { ...json, sources_to_targets: [json.sources_to_targets[0]] },
      { ...json, sources_to_targets: [json.sources_to_targets[0], json.sources_to_targets[0]] },
      {
        ...json,
        sources_to_targets: [json.sources_to_targets[0], [{ from_index: 1, to_index: 2, time: 1, distance: 1 }, { from_index: 1, to_index: 0, time: 1, distance: 1 }]],
      },
      { ...json, sources_to_targets: 'nope' },
      {},
    ];
    for (const bad of cases) {
      try {
        translateMatrix(bad as ValhallaMatrixResponse, p, null);
        throw new Error('phải ném');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(503);
        expect((error as ApiError).code).toBe('upstream_unavailable');
      }
    }
  });
});
```

- [x] **Step 3: Chạy test, phải đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-matrix.test.ts`
Expected: FAIL — `translateMatrix` không export.

- [x] **Step 4: Thêm `translateMatrix` vào cuối `apps/api/src/routing/matrix.ts`**

```ts
const invalidUpstream = () =>
  new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường trả dữ liệu không hợp lệ');

const lngLat = ({ lat, lng }: LatLng): [number, number] => [lng, lat];

/**
 * Ô đặt theo `from_index`/`to_index`, không tin thứ tự mảng. `time`/`distance` null, không phải số
 * hoặc âm đều là "không nối được" → null ở CẢ hai bảng. Thiếu ô, ô trùng hay chỉ số lệch là dữ liệu
 * hỏng → 503, không trả bảng lệch cho khách.
 */
export function translateMatrix(
  json: ValhallaMatrixResponse,
  p: MatrixParams,
  graph: string | null,
): MatrixResponse {
  const rows = p.sources.length;
  const cols = p.targets.length;
  const durations: (number | null)[][] = [];
  const distances: (number | null)[][] = [];
  const filled: boolean[][] = [];
  for (let i = 0; i < rows; i++) {
    durations.push(Array.from({ length: cols }, () => null));
    distances.push(Array.from({ length: cols }, () => null));
    filled.push(Array.from({ length: cols }, () => false));
  }
  const cells = json?.sources_to_targets;
  if (!Array.isArray(cells)) throw invalidUpstream();
  for (const row of cells) {
    if (!Array.isArray(row)) throw invalidUpstream();
    for (const cell of row) {
      const i = cell?.from_index;
      const j = cell?.to_index;
      if (!Number.isInteger(i) || !Number.isInteger(j)) throw invalidUpstream();
      const filledRow = filled[i];
      const durationRow = durations[i];
      const distanceRow = distances[i];
      if (!filledRow || !durationRow || !distanceRow || j < 0 || j >= cols) throw invalidUpstream();
      if (filledRow[j]) throw invalidUpstream();
      filledRow[j] = true;
      const reachable =
        typeof cell.time === 'number' &&
        cell.time >= 0 &&
        typeof cell.distance === 'number' &&
        cell.distance >= 0;
      durationRow[j] = reachable ? Math.round(cell.time as number) : null;
      distanceRow[j] = reachable ? Math.round((cell.distance as number) * 1000) : null;
    }
  }
  if (!filled.every((row) => row.every(Boolean))) throw invalidUpstream();
  return {
    mode: p.mode,
    sources: p.sources.map(lngLat),
    targets: p.targets.map(lngLat),
    durations_s: durations,
    distances_m: distances,
    attribution: ROUTING_ATTRIBUTION,
    engine: { name: 'valhalla', graph },
  };
}
```

Nếu biome phàn nàn `as number` sau khi đã kiểm `typeof`, đổi thành hai biến `const time = cell.time; const distance = cell.distance;` rồi kiểm `typeof time === 'number' && time >= 0 && typeof distance === 'number' && distance >= 0` và dùng `time`/`distance` trực tiếp (TypeScript thu hẹp kiểu qua biến cục bộ).

- [x] **Step 5: Chạy test, lint, typecheck, commit**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-matrix.test.ts && pnpm lint:fix && pnpm lint && pnpm --filter @mapslibvn/api exec tsc --noEmit`
Expected: PASS, lint xanh (không còn import thừa), tsc 0 lỗi.

```bash
git add apps/api/src/routing/matrix.ts apps/api/test/routing-matrix.test.ts apps/api/test/fixtures/valhalla/matrix-2x2.json
git commit -m "feat(api): translateMatrix — bảng N×M theo from_index/to_index, null khi không nối, 503 khi sai cỡ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `GET /v1/matrix` — route Hono, nối vào app, test route

**Files:**
- Create: `apps/api/src/routes/matrix.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/matrix-route.test.ts`

- [x] **Step 1: Viết test đỏ `apps/api/test/matrix-route.test.ts`**

```ts
import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';
import fixture from './fixtures/valhalla/matrix-2x2.json';
import { fetchMock } from './helpers/fetch-mock';
import { seedKey, sha256Hex } from './helpers/seed-key';

const KEY = 'mlv_live_matrix000000000000000000';
const FREE_KEY = 'mlv_live_matrixfree00000000000000';
const origin = () => fetchMock.get('https://routing.test');
const mockMatrix = (status: number, body: object | string) =>
  origin().intercept({ path: '/sources_to_targets', method: 'POST' }).reply(status, body);
const mockStatus = () =>
  origin()
    .intercept({ path: '/status', method: 'GET' })
    .reply(200, { version: '3.8.3', tileset_last_modified: 1789430400 })
    .persist();
const call = (query: string, key = KEY, init: RequestInit = {}) =>
  SELF.fetch(`https://api/v1/matrix?${query}`, { ...init, headers: { 'X-Api-Key': key } });
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
// Mỗi test một toạ độ khác ở chữ số thứ 4 để không trúng cache của test trước (khoá cache làm tròn 4 chữ số).
const q = (suffix: number, extra = '') =>
  `sources=10.77${suffix}8,106.6990;10.7725,106.6980&targets=10.7769,106.7032;10.7716,106.7043${extra}`;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(async () => {
  await seedKey(KEY);
});

describe('GET /v1/matrix', () => {
  it('không khoá → 401; thiếu targets, mode lạ, ngoài VN, 26 sources, 11×10, chim bay → 400 mà KHÔNG gọi Valhalla', async () => {
    // Không có interceptor nào: nếu route gọi Valhalla, fetch-mock ném → 503 chứ không phải 400.
    expect((await SELF.fetch('https://api/v1/matrix?sources=10,106&targets=11,107')).status).toBe(401);
    expect((await call('sources=10.77,106.70')).status).toBe(400);
    expect((await call('sources=10.77,106.70&targets=10.78,106.71&mode=bike')).status).toBe(400);
    expect((await call('sources=10.77,106.70&targets=13.75,100.50')).status).toBe(400);
    const many = Array.from({ length: 26 }, (_, i) => `10.77,106.${600 + i}`).join(';');
    expect((await call(`sources=${many}&targets=10.78,106.71`)).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => `10.77,106.${600 + i}`).join(';');
    const ten = Array.from({ length: 10 }, (_, i) => `10.78,106.${700 + i}`).join(';');
    const pairs = await call(`sources=${eleven}&targets=${ten}`);
    expect(pairs.status).toBe(400);
    expect(((await pairs.json()) as { error: { message: string } }).error.message).toMatch(/100 cặp/);
    expect((await call('sources=10.7798,106.6990&targets=21.0285,105.8542')).status).toBe(400);
  });

  it('ma trận hợp lệ → 200 theo schema MapsLibVN, engine.graph từ /status', async () => {
    mockMatrix(200, fixture);
    mockStatus();
    const res = await call(q(1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      sources: unknown[];
      durations_s: (number | null)[][];
      distances_m: (number | null)[][];
      engine: { name: string; graph: string | null };
    };
    expect(body.mode).toBe('motorbike');
    expect(body.sources).toHaveLength(2);
    expect(body.durations_s).toEqual([
      [167, 255],
      [292, null],
    ]);
    expect(body.distances_m[1]?.[1]).toBeNull();
    expect(body.engine).toEqual({ name: 'valhalla', graph: '2026-09-15' });
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('Valhalla 400+171 (điểm không bám được) → 404 no_route; 400+154 → 400; 500 → 503 retry-after 30', async () => {
    mockStatus();
    mockMatrix(400, { error_code: 171, error: 'No suitable edges near location' });
    const far = await call(q(2));
    expect(far.status).toBe(404);
    expect(await code(far)).toBe('no_route');

    mockMatrix(400, { error_code: 154, error: 'Path distance exceeds the max distance limit' });
    const tooFar = await call(q(3));
    expect(tooFar.status).toBe(400);
    expect(await code(tooFar)).toBe('invalid_request');

    mockMatrix(500, 'boom');
    const down = await call(q(4));
    expect(down.status).toBe(503);
    expect(await code(down)).toBe('upstream_unavailable');
    expect(down.headers.get('retry-after')).toBe('30');
  });

  it('bảng sai cỡ từ Valhalla → 503, không trả bảng lệch', async () => {
    mockStatus();
    mockMatrix(200, { ...fixture, sources_to_targets: [fixture.sources_to_targets[0]] });
    const res = await call(q(5));
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('upstream_unavailable');
  });

  it('HEAD → 405 kèm Allow: GET', async () => {
    const res = await call(q(6), KEY, { method: 'HEAD' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });

  it('cache: request giống nhau trong 60 s trả từ cache (x-mlv-cache=hit)', async () => {
    mockMatrix(200, fixture).persist();
    mockStatus();
    const first = await call(q(7));
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      const again = await call(q(7));
      expect(again.status).toBe(200);
      hit = again.headers.get('x-mlv-cache') === 'hit';
      await again.arrayBuffer();
      if (!hit) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(hit).toBe(true);
  });

  it('quota nhóm directions: 200 cộng 1 vào counter directions; 400 không cộng; vượt 2× → 429', async () => {
    await seedKey(FREE_KEY, {
      tenantId: '00000000-0000-4000-8000-0000000000cc',
      plan: 'free',
      quotaDirectionsPerDay: 5,
    });
    const hash = await sha256Hex(FREE_KEY);
    const key = `quota:${hash}:${vnDay()}:directions`;
    mockMatrix(200, fixture);
    mockStatus();
    const allowed = await call(q(8), FREE_KEY);
    expect(allowed.status).toBe(200);
    await allowed.arrayBuffer();
    // KV put chạy trong waitUntil: chờ tới khi thấy giá trị.
    let count = '0';
    for (let i = 0; i < 20 && count === '0'; i++) {
      count = (await env.META.get(key)) ?? '0';
      if (count === '0') await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(count).toBe('1');

    const rejected = await call('sources=10.77,106.70', FREE_KEY);
    expect(rejected.status).toBe(400);
    await rejected.arrayBuffer();
    expect(await env.META.get(key)).toBe('1');

    await env.META.put(key, '10');
    const blocked = await call(q(9), FREE_KEY);
    expect(blocked.status).toBe(429);
    expect(await code(blocked)).toBe('quota_exceeded');
  });
});
```

- [x] **Step 2: Chạy test, phải đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/matrix-route.test.ts`
Expected: FAIL — `/v1/matrix` trả 404 `not_found` (route chưa có).

- [x] **Step 3: Tạo `apps/api/src/routes/matrix.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { quotaMiddleware } from '../quota';
import { graphBuiltAt } from '../routing/graph';
import { matrixBody, matrixCacheUrl, parseMatrixParams, translateMatrix } from '../routing/matrix';
import { callValhalla, MATRIX_TIMEOUT_MS, type ValhallaMatrixResponse } from '../routing/valhalla';

export const matrix = new Hono<AppEnv>();

/**
 * Ma trận thời gian/quãng đường N×M (spec 22/09/2026 mục 4.1). Cùng khuôn /v1/directions: scope
 * places:read, MỘT lượt nhóm `directions` bất kể cỡ, preflight parse để request sai không tốn lượt,
 * cache 60 s / stale 300 s. Trần cỡ ở parseMatrixParams là lớp bảo vệ máy chủ 1 luồng.
 */
matrix.get(
  '/v1/matrix',
  requireAuth('places:read', { deferRevocation: true }),
  quotaMiddleware('directions', (c) => {
    parseMatrixParams(c.req.query());
  }),
  async (c) => {
    const params = parseMatrixParams(c.req.query());
    return cachedJson(c.executionCtx, matrixCacheUrl(params), 60, 300, async () => {
      const [json, graph] = await Promise.all([
        callValhalla<ValhallaMatrixResponse>(
          c.env,
          '/sources_to_targets',
          matrixBody(params, crypto.randomUUID()),
          { timeoutMs: MATRIX_TIMEOUT_MS },
        ),
        graphBuiltAt(c),
      ]);
      return translateMatrix(json, params, graph);
    });
  },
);
```

- [x] **Step 4: Nối route trong `apps/api/src/index.ts`**

Thêm import (theo thứ tự alphabet cạnh `import { geocodeRoute } …`): `import { matrix } from './routes/matrix';`. Sau dòng `app.route('/', directions);` thêm `app.route('/', matrix);`.

- [x] **Step 5: Chạy test, phải xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/matrix-route.test.ts`
Expected: PASS 7 ca.

Nếu ca quota đỏ ở `expect(count).toBe('1')` vì tenant `free` legacy không cộng KV trong môi trường test: kiểm `QUOTA_ENABLED` trong `apps/api/vitest.config.ts` (đang `'1'`) và `plan: 'free'` trong seed — cùng cơ chế test directions đang dùng ở `directions-route.test.ts`.

- [x] **Step 6: Lint, typecheck, chạy cả bộ API, commit**

Run: `pnpm lint:fix && pnpm lint && pnpm --filter @mapslibvn/api exec tsc --noEmit && pnpm --filter @mapslibvn/api test`
Expected: xanh toàn bộ.

```bash
git add apps/api/src/routes/matrix.ts apps/api/src/index.ts apps/api/test/matrix-route.test.ts
git commit -m "feat(api): GET /v1/matrix — ma trận N×M trên Valhalla sources_to_targets, một lượt nhóm directions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `routing/optimized.ts` — tham số, body Valhalla, khoá cache

**Files:**
- Create: `apps/api/src/routing/optimized.ts`
- Test: `apps/api/test/routing-optimized.test.ts`

- [x] **Step 1: Viết test đỏ `apps/api/test/routing-optimized.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  OPTIMIZED_MAX_STOPS,
  optimizedBody,
  optimizedCacheUrl,
  parseOptimizedParams,
} from '../src/routing/optimized';

const NTDB = '10.7798,106.6990';
const BT = '10.7725,106.6980';
const NHTP = '10.7769,106.7032';
const BX = '10.7716,106.7043';
const HN = '21.0285,105.8542';
const base = { from: NTDB, stops: `${BX};${NHTP}`, to: BT };

function expectInvalidRequest(action: () => unknown, message?: RegExp): void {
  try {
    action();
    throw new Error('phải ném');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).code).toBe('invalid_request');
    if (message) expect((error as ApiError).message).toMatch(message);
  }
}

describe('parseOptimizedParams', () => {
  it('trần 10 điểm dừng', () => {
    expect(OPTIMIZED_MAX_STOPS).toBe(10);
  });

  it('from, stops theo thứ tự gửi, to; mặc định motorbike/vi', () => {
    expect(parseOptimizedParams(base)).toEqual({
      from: { lat: 10.7798, lng: 106.699 },
      stops: [
        { lat: 10.7716, lng: 106.7043 },
        { lat: 10.7769, lng: 106.7032 },
      ],
      to: { lat: 10.7725, lng: 106.698 },
      roundTrip: false,
      mode: 'motorbike',
      lang: 'vi',
    });
  });

  it('bỏ to (hoặc to rỗng) → to = from, roundTrip true', () => {
    const p = parseOptimizedParams({ from: NTDB, stops: BX });
    expect(p.to).toEqual(p.from);
    expect(p.roundTrip).toBe(true);
    expect(parseOptimizedParams({ from: NTDB, stops: BX, to: '  ' }).roundTrip).toBe(true);
  });

  it('một stop vẫn hợp lệ; thiếu from/stops, mode/lang lạ → 400', () => {
    expect(parseOptimizedParams({ from: NTDB, stops: BX }).stops).toHaveLength(1);
    expectInvalidRequest(() => parseOptimizedParams({ stops: BX }), /from bắt buộc/);
    expectInvalidRequest(() => parseOptimizedParams({ from: NTDB }), /stops bắt buộc/);
    expectInvalidRequest(() => parseOptimizedParams({ ...base, mode: 'bike' }), /mode chỉ nhận/);
    expectInvalidRequest(() => parseOptimizedParams({ ...base, lang: 'fr' }), /lang chỉ nhận/);
  });

  it('đếm stops trước parse: 11 phần tử hỏng → "stops tối đa 10 điểm"', () => {
    const many = Array.from({ length: 11 }, () => 'x').join(';');
    expectInvalidRequest(() => parseOptimizedParams({ from: NTDB, stops: many }), /stops tối đa 10 điểm/);
  });

  it('ngoài hộp VN → 400 "Việt Nam"; chim bay tính từ from tới từng stop và tới to', () => {
    expectInvalidRequest(() => parseOptimizedParams({ from: NTDB, stops: '13.75,100.50' }), /Việt Nam/);
    expectInvalidRequest(
      () => parseOptimizedParams({ from: NTDB, stops: `${BX};${HN}` }),
      /stops\[1\] cách from 11\d\d km, tối ưu thứ tự motorbike tối đa 200 km/,
    );
    expectInvalidRequest(
      () => parseOptimizedParams({ from: NTDB, stops: BX, to: HN, mode: 'car' }),
      /to cách from .* tối đa 400 km/,
    );
    expectInvalidRequest(
      () => parseOptimizedParams({ from: NTDB, stops: '10.3460,107.0843', mode: 'walk' }),
      /tối đa 50 km/,
    );
  });
});

describe('optimizedBody', () => {
  it('locations = from, stops theo thứ tự gửi, to; type break; costing và locale theo mode/lang', () => {
    expect(optimizedBody(parseOptimizedParams({ ...base, mode: 'car', lang: 'en' }), 'req-1')).toEqual({
      locations: [
        { lat: 10.7798, lon: 106.699, type: 'break' },
        { lat: 10.7716, lon: 106.7043, type: 'break' },
        { lat: 10.7769, lon: 106.7032, type: 'break' },
        { lat: 10.7725, lon: 106.698, type: 'break' },
      ],
      costing: 'auto',
      directions_options: { language: 'en-US', units: 'kilometers' },
      id: 'req-1',
    });
  });

  it('round trip: điểm cuối là from lần nữa', () => {
    const body = optimizedBody(parseOptimizedParams({ from: NTDB, stops: BX }), 'r');
    expect(body.locations).toHaveLength(3);
    expect(body.locations[2]).toEqual({ lat: 10.7798, lon: 106.699, type: 'break' });
    expect(body.costing).toBe('motor_scooter');
    expect(body.directions_options.language).toBe('vi-VN');
  });
});

describe('optimizedCacheUrl', () => {
  it('làm tròn 4 chữ số; round trip và to=from cho CÙNG khoá; lang/mode đổi → khác khoá', () => {
    const p = parseOptimizedParams({ from: '10.77981,106.69904', stops: BX });
    expect(optimizedCacheUrl(p)).toBe(
      'https://cache.mapslibvn/optimized-route?v=1&f=10.7798%2C106.6990&s=10.7716%2C106.7043&t=10.7798%2C106.6990&m=motorbike&l=vi',
    );
    const explicit = parseOptimizedParams({ from: '10.77981,106.69904', stops: BX, to: '10.77981,106.69904' });
    expect(optimizedCacheUrl(explicit)).toBe(optimizedCacheUrl(p));
    expect(optimizedCacheUrl({ ...p, lang: 'en' })).not.toBe(optimizedCacheUrl(p));
  });
});
```

- [x] **Step 2: Chạy test, phải đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-optimized.test.ts`
Expected: FAIL — module không tồn tại.

- [x] **Step 3: Tạo `apps/api/src/routing/optimized.ts`**

```ts
import type { DirectionsLang, OptimizedRouteResponse, TravelMode } from '@mapslibvn/core';
import { ApiError } from '../errors';
import type { LatLng } from '../params';
import {
  assertInVietnam,
  cacheKeyPoints,
  DIRECTIONS_LANGS,
  haversineM,
  MATRIX_MAX_CROW_DISTANCE_M,
  oneOf,
  parseLatLngList,
  requirePair,
  TRAVEL_MODES,
} from './params';
import { translateDirections } from './translate';
import { VALHALLA_COSTING, VALHALLA_LANGUAGE, type ValhallaRouteResponse } from './valhalla';

/**
 * 10 điểm dừng = 12 điểm kể cả from/to, dưới `max_locations = 20` của costing auto (spec 22/09/2026
 * mục 4.6). Một request = MỘT lượt nhóm `directions`. Đổi số ở đây phải đổi docs và site (mục 6.3).
 */
export const OPTIMIZED_MAX_STOPS = 10;

export interface OptimizedParams {
  from: LatLng;
  /** Theo thứ tự người gọi gửi; thứ tự đi nằm ở `order` của response. */
  stops: LatLng[];
  /** Bằng `from` khi người gọi bỏ `to` (round trip). */
  to: LatLng;
  roundTrip: boolean;
  mode: TravelMode;
  lang: DirectionsLang;
}

/** Bán kính chim bay từ `from` tới từng điểm — thứ tự đi chưa biết nên không cộng dồn được như directions. */
function assertOptimizedCrowDistance(p: Omit<OptimizedParams, 'roundTrip'>): void {
  const limit = MATRIX_MAX_CROW_DISTANCE_M[p.mode];
  const check = (name: string, point: LatLng) => {
    const d = haversineM(p.from, point);
    if (d > limit) {
      throw new ApiError(
        400,
        'invalid_request',
        `${name} cách from ${Math.round(d / 1000)} km, tối ưu thứ tự ${p.mode} tối đa ${limit / 1000} km đường chim bay`,
      );
    }
  };
  for (const [i, stop] of p.stops.entries()) check(`stops[${i}]`, stop);
  check('to', p.to);
}

/** Kiểm hết ở Worker: đếm stops trước parse, from/to, mode/lang, hộp VN, bán kính chim bay. */
export function parseOptimizedParams(q: Record<string, string | undefined>): OptimizedParams {
  const stops = parseLatLngList(q.stops, 'stops', { min: 1, max: OPTIMIZED_MAX_STOPS });
  const from = requirePair(q.from, 'from');
  const roundTrip = !q.to?.trim();
  const to = roundTrip ? from : requirePair(q.to, 'to');
  const mode = oneOf(q.mode, TRAVEL_MODES, 'motorbike', 'mode');
  const lang = oneOf(q.lang, DIRECTIONS_LANGS, 'vi', 'lang');
  assertInVietnam([from, ...stops, to]);
  assertOptimizedCrowDistance({ from, stops, to, mode, lang });
  return { from, stops, to, roundTrip, mode, lang };
}

/** Body `POST /optimized_route`: from, stops theo thứ tự gửi, to — `stops[i]` có original_index i + 1. */
export function optimizedBody(p: OptimizedParams, requestId: string) {
  return {
    locations: [p.from, ...p.stops, p.to].map(({ lat, lng }) => ({ lat, lon: lng, type: 'break' })),
    costing: VALHALLA_COSTING[p.mode],
    directions_options: { language: VALHALLA_LANGUAGE[p.lang], units: 'kilometers' },
    id: requestId,
  };
}

export function optimizedCacheUrl(p: OptimizedParams): string {
  const f = encodeURIComponent(cacheKeyPoints([p.from]));
  const s = encodeURIComponent(cacheKeyPoints(p.stops));
  const t = encodeURIComponent(cacheKeyPoints([p.to]));
  return `https://cache.mapslibvn/optimized-route?v=1&f=${f}&s=${s}&t=${t}&m=${p.mode}&l=${p.lang}`;
}
```

(`OptimizedRouteResponse`, `translateDirections`, `ValhallaRouteResponse` dùng ở Task 9.)

- [x] **Step 4: Chạy test, phải xanh; commit**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-optimized.test.ts`
Expected: PASS.

```bash
git add apps/api/src/routing/optimized.ts apps/api/test/routing-optimized.test.ts
git commit -m "feat(api): parseOptimizedParams, optimizedBody, optimizedCacheUrl — 1–10 điểm dừng, bỏ to là quay về from

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `translateOptimized` — `order` từ `original_index`, tuyến dùng lại `translateDirections`

**Files:**
- Modify: `apps/api/src/routing/optimized.ts`
- Create: `apps/api/test/fixtures/valhalla/optimized-two-stops.json` (sinh bằng script từ `two-legs.json`)
- Test: `apps/api/test/routing-optimized.test.ts`

- [x] **Step 1: Sinh fixture tay từ `two-legs.json`** — 4 điểm (from, 2 stops, to) mà Valhalla xếp `original_index` `[0, 2, 1, 3]`, 3 leg (leg thứ ba tái dùng leg đầu; hình học không quan trọng cho test thứ tự)

```bash
node -e '
const fs = require("node:fs");
const src = JSON.parse(fs.readFileSync("apps/api/test/fixtures/valhalla/two-legs.json", "utf8"));
const legs = [src.trip.legs[0], src.trip.legs[1], src.trip.legs[0]];
const out = {
  trip: {
    ...src.trip,
    locations: [
      { type: "break", lat: 10.7798, lon: 106.699, original_index: 0 },
      { type: "break", lat: 10.7769, lon: 106.7032, original_index: 2 },
      { type: "break", lat: 10.7716, lon: 106.7043, original_index: 1 },
      { type: "break", lat: 10.7725, lon: 106.698, original_index: 3 },
    ],
    legs,
    summary: { ...src.trip.summary, time: 165.6, length: 1.23 },
  },
  id: "fixture-optimized-two-stops",
};
fs.writeFileSync("apps/api/test/fixtures/valhalla/optimized-two-stops.json", JSON.stringify(out, null, 2) + "\n");
'
```

- [x] **Step 2: Thêm test đỏ vào `apps/api/test/routing-optimized.test.ts`**

Thêm import: `import fixture from './fixtures/valhalla/optimized-two-stops.json';`, `import type { ValhallaRouteResponse } from '../src/routing/valhalla';`, và `translateOptimized` vào import từ `'../src/routing/optimized'`. Cuối file:

```ts
describe('translateOptimized', () => {
  const p = parseOptimizedParams(base); // stops gửi: [BX, NHTP]; Valhalla đi NHTP trước → order [1, 0]
  const json = fixture as unknown as ValhallaRouteResponse;

  it('order từ original_index − 1; legs = stops + 1; waypoints theo thứ tự đi; phần tuyến giống translateDirections', () => {
    const out = translateOptimized(json, p, '2026-09-15');
    expect(out.order).toEqual([1, 0]);
    expect(out.routes).toHaveLength(1);
    expect(out.routes[0]?.legs).toHaveLength(3);
    expect(out.routes[0]?.mode).toBe('motorbike');
    expect(out.waypoints.map((w) => w.location)).toEqual([
      [106.699, 10.7798],
      [106.7032, 10.7769],
      [106.7043, 10.7716],
      [106.698, 10.7725],
    ]);
    expect(out.engine).toEqual({ name: 'valhalla', graph: '2026-09-15' });
    // Câu tiếng Việt đã qua bảng cụm từ như directions (fixture two-legs có "Đi về hướng nam…").
    expect(out.routes[0]?.legs[0]?.steps[0]?.instruction).toMatch(/^Đi về hướng/);
  });

  it('một stop, round trip: order [0], 2 leg', () => {
    const single = parseOptimizedParams({ from: NTDB, stops: BX });
    const two = {
      ...json,
      trip: {
        ...json.trip,
        locations: [
          { lat: 10.7798, lon: 106.699, original_index: 0 },
          { lat: 10.7716, lon: 106.7043, original_index: 1 },
          { lat: 10.7798, lon: 106.699, original_index: 2 },
        ],
        legs: [json.trip.legs[0], json.trip.legs[1]],
      },
    } as unknown as ValhallaRouteResponse;
    const out = translateOptimized(two, single, null);
    expect(out.order).toEqual([0]);
    expect(out.routes[0]?.legs).toHaveLength(2);
  });

  it('thiếu original_index, đầu/cuối đổi chỗ, không phải hoán vị, số leg lệch → 503', () => {
    const withLocations = (locations: unknown[], legs = json.trip.legs) =>
      ({ ...json, trip: { ...json.trip, locations, legs } }) as unknown as ValhallaRouteResponse;
    const L = (original_index: number | undefined) => ({ lat: 10.77, lon: 106.7, original_index });
    const cases = [
      withLocations([L(0), L(undefined), L(1), L(3)]),
      withLocations([L(1), L(2), L(0), L(3)]),
      withLocations([L(0), L(1), L(1), L(3)]),
      withLocations([L(0), L(2), L(1), L(3)], [json.trip.legs[0]]),
      withLocations([L(0), L(1), L(3)]),
    ];
    for (const bad of cases) {
      try {
        translateOptimized(bad, p, null);
        throw new Error('phải ném');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(503);
        expect((error as ApiError).code).toBe('upstream_unavailable');
      }
    }
  });
});
```

- [x] **Step 3: Chạy test, phải đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-optimized.test.ts`
Expected: FAIL — `translateOptimized` không export.

- [x] **Step 4: Thêm vào cuối `apps/api/src/routing/optimized.ts`**

```ts
const invalidUpstream = () =>
  new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường trả dữ liệu không hợp lệ');

/**
 * `order[k]` = original_index của điểm thứ k trên đường đi, trừ 1 (vì locations gửi là
 * [from, ...stops, to]). Không đoán khi dữ liệu lệch: đầu/cuối phải giữ chỗ, order phải là hoán vị
 * đủ của stops, số leg = số điểm − 1; sai → 503. Phần tuyến giao nguyên cho translateDirections.
 */
export function translateOptimized(
  json: ValhallaRouteResponse,
  p: OptimizedParams,
  graph: string | null,
): OptimizedRouteResponse {
  const n = p.stops.length + 2;
  const locations = json?.trip?.locations;
  if (!Array.isArray(locations) || locations.length !== n) throw invalidUpstream();
  const indexes = locations.map((location) => location.original_index);
  if (indexes[0] !== 0 || indexes[n - 1] !== n - 1) throw invalidUpstream();
  const order: number[] = [];
  for (const index of indexes.slice(1, -1)) {
    if (typeof index !== 'number' || !Number.isInteger(index)) throw invalidUpstream();
    order.push(index - 1);
  }
  const unique = new Set(order);
  if (
    unique.size !== p.stops.length ||
    order.some((k) => k < 0 || k >= p.stops.length) ||
    !Array.isArray(json.trip.legs) ||
    json.trip.legs.length !== n - 1
  ) {
    throw invalidUpstream();
  }
  const base = translateDirections(json, p.mode, graph, p.lang);
  return { ...base, order };
}
```

- [x] **Step 5: Chạy test, lint, typecheck, commit**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-optimized.test.ts && pnpm lint:fix && pnpm lint && pnpm --filter @mapslibvn/api exec tsc --noEmit`
Expected: PASS; lint xanh; tsc 0 lỗi.

```bash
git add apps/api/src/routing/optimized.ts apps/api/test/routing-optimized.test.ts apps/api/test/fixtures/valhalla/optimized-two-stops.json
git commit -m "feat(api): translateOptimized — order từ original_index, tuyến dùng lại translateDirections

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `GET /v1/optimized-route` — route Hono, nối vào app, test route

**Files:**
- Create: `apps/api/src/routes/optimized.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/optimized-route.test.ts`

- [x] **Step 1: Viết test đỏ `apps/api/test/optimized-route.test.ts`**

```ts
import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';
import fixture from './fixtures/valhalla/optimized-two-stops.json';
import { fetchMock } from './helpers/fetch-mock';
import { seedKey, sha256Hex } from './helpers/seed-key';

const KEY = 'mlv_live_optimized000000000000000';
const FREE_KEY = 'mlv_live_optimizedfree00000000000';
const origin = () => fetchMock.get('https://routing.test');
const mockOptimized = (status: number, body: object | string) =>
  origin().intercept({ path: '/optimized_route', method: 'POST' }).reply(status, body);
const mockStatus = () =>
  origin()
    .intercept({ path: '/status', method: 'GET' })
    .reply(200, { version: '3.8.3', tileset_last_modified: 1789430400 })
    .persist();
const call = (query: string, key = KEY, init: RequestInit = {}) =>
  SELF.fetch(`https://api/v1/optimized-route?${query}`, { ...init, headers: { 'X-Api-Key': key } });
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
// Mỗi test một from khác ở chữ số thứ 4 để không trúng cache của test trước.
const q = (suffix: number, extra = '') =>
  `from=10.77${suffix}8,106.6990&stops=10.7716,106.7043;10.7769,106.7032&to=10.7725,106.6980${extra}`;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(async () => {
  await seedKey(KEY);
});

describe('GET /v1/optimized-route', () => {
  it('không khoá → 401; thiếu stops, 11 stops, mode lạ, ngoài VN, chim bay → 400 mà KHÔNG gọi Valhalla', async () => {
    expect((await SELF.fetch('https://api/v1/optimized-route?from=10,106&stops=11,107')).status).toBe(401);
    expect((await call('from=10.77,106.70')).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => `10.77,106.${600 + i}`).join(';');
    expect((await call(`from=10.77,106.70&stops=${eleven}`)).status).toBe(400);
    expect((await call('from=10.77,106.70&stops=10.78,106.71&mode=bike')).status).toBe(400);
    expect((await call('from=10.77,106.70&stops=13.75,100.50')).status).toBe(400);
    expect((await call('from=10.7798,106.6990&stops=21.0285,105.8542')).status).toBe(400);
  });

  it('hợp lệ → 200: DirectionsResponse + order [1, 0], 3 leg, 4 waypoint, engine.graph', async () => {
    mockOptimized(200, fixture);
    mockStatus();
    const res = await call(q(1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      order: number[];
      routes: { legs: unknown[] }[];
      waypoints: unknown[];
      engine: { name: string; graph: string | null };
    };
    expect(body.order).toEqual([1, 0]);
    expect(body.routes).toHaveLength(1);
    expect(body.routes[0]?.legs).toHaveLength(3);
    expect(body.waypoints).toHaveLength(4);
    expect(body.engine).toEqual({ name: 'valhalla', graph: '2026-09-15' });
  });

  it('bỏ to → body gửi Valhalla có from ở cuối (kiểm qua fixture 3 điểm) và vẫn 200', async () => {
    const roundTrip = {
      ...fixture,
      trip: {
        ...fixture.trip,
        locations: [
          { type: 'break', lat: 10.7728, lon: 106.699, original_index: 0 },
          { type: 'break', lat: 10.7716, lon: 106.7043, original_index: 1 },
          { type: 'break', lat: 10.7728, lon: 106.699, original_index: 2 },
        ],
        legs: [fixture.trip.legs[0], fixture.trip.legs[1]],
      },
    };
    mockOptimized(200, roundTrip);
    mockStatus();
    const res = await call('from=10.7728,106.6990&stops=10.7716,106.7043');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: number[]; waypoints: { location: number[] }[] };
    expect(body.order).toEqual([0]);
    expect(body.waypoints[2]?.location).toEqual([106.699, 10.7728]);
  });

  it('Valhalla 400+442 → 404 no_route; 500 → 503 retry-after 30; order không hợp lệ → 503', async () => {
    mockStatus();
    mockOptimized(400, { error_code: 442, error: 'No path could be found for input' });
    const notFound = await call(q(2));
    expect(notFound.status).toBe(404);
    expect(await code(notFound)).toBe('no_route');

    mockOptimized(500, 'boom');
    const down = await call(q(3));
    expect(down.status).toBe(503);
    expect(down.headers.get('retry-after')).toBe('30');

    mockOptimized(200, {
      ...fixture,
      trip: { ...fixture.trip, locations: fixture.trip.locations.map((l) => ({ ...l, original_index: 0 })) },
    });
    const broken = await call(q(4));
    expect(broken.status).toBe(503);
    expect(await code(broken)).toBe('upstream_unavailable');
  });

  it('HEAD → 405 Allow: GET; cache hit trong 60 s', async () => {
    const head = await call(q(5), KEY, { method: 'HEAD' });
    expect(head.status).toBe(405);
    expect(head.headers.get('allow')).toBe('GET');

    mockOptimized(200, fixture).persist();
    mockStatus();
    const first = await call(q(6));
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      const again = await call(q(6));
      hit = again.headers.get('x-mlv-cache') === 'hit';
      await again.arrayBuffer();
      if (!hit) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(hit).toBe(true);
  });

  it('quota nhóm directions: cộng 1 khi 200, vượt 2× → 429', async () => {
    await seedKey(FREE_KEY, {
      tenantId: '00000000-0000-4000-8000-0000000000dd',
      plan: 'free',
      quotaDirectionsPerDay: 5,
    });
    const hash = await sha256Hex(FREE_KEY);
    const key = `quota:${hash}:${vnDay()}:directions`;
    mockOptimized(200, fixture);
    mockStatus();
    const allowed = await call(q(7), FREE_KEY);
    expect(allowed.status).toBe(200);
    await allowed.arrayBuffer();
    let count = '0';
    for (let i = 0; i < 20 && count === '0'; i++) {
      count = (await env.META.get(key)) ?? '0';
      if (count === '0') await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(count).toBe('1');
    await env.META.put(key, '10');
    const blocked = await call(q(8), FREE_KEY);
    expect(blocked.status).toBe(429);
    expect(await code(blocked)).toBe('quota_exceeded');
  });
});
```

- [x] **Step 2: Chạy test, phải đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/optimized-route.test.ts`
Expected: FAIL — route trả 404 `not_found`.

- [x] **Step 3: Tạo `apps/api/src/routes/optimized.ts`**

```ts
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { quotaMiddleware } from '../quota';
import { graphBuiltAt } from '../routing/graph';
import {
  optimizedBody,
  optimizedCacheUrl,
  parseOptimizedParams,
  translateOptimized,
} from '../routing/optimized';
import { callValhalla, MATRIX_TIMEOUT_MS, type ValhallaRouteResponse } from '../routing/valhalla';

export const optimized = new Hono<AppEnv>();

/**
 * Thứ tự ghé tối ưu cho MỘT xe, đầu/cuối cố định (spec 22/09/2026 mục 4.2). Response là
 * DirectionsResponse + `order` nên map.routes.show() vẽ được ngay. Cùng khuôn /v1/directions:
 * scope places:read, một lượt nhóm `directions`, preflight parse, cache 60 s / stale 300 s.
 */
optimized.get(
  '/v1/optimized-route',
  requireAuth('places:read', { deferRevocation: true }),
  quotaMiddleware('directions', (c) => {
    parseOptimizedParams(c.req.query());
  }),
  async (c) => {
    const params = parseOptimizedParams(c.req.query());
    return cachedJson(c.executionCtx, optimizedCacheUrl(params), 60, 300, async () => {
      const [json, graph] = await Promise.all([
        callValhalla<ValhallaRouteResponse>(
          c.env,
          '/optimized_route',
          optimizedBody(params, crypto.randomUUID()),
          { timeoutMs: MATRIX_TIMEOUT_MS },
        ),
        graphBuiltAt(c),
      ]);
      return translateOptimized(json, params, graph);
    });
  },
);
```

- [x] **Step 4: Nối route trong `apps/api/src/index.ts`**

Import: `import { optimized } from './routes/optimized';` (alphabet, sau `nearby`). Sau `app.route('/', matrix);` thêm `app.route('/', optimized);`.

- [x] **Step 5: Chạy test, cả bộ API, lint, typecheck, commit**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/optimized-route.test.ts && pnpm lint:fix && pnpm lint && pnpm --filter @mapslibvn/api exec tsc --noEmit && pnpm --filter @mapslibvn/api test`
Expected: xanh toàn bộ.

```bash
git add apps/api/src/routes/optimized.ts apps/api/src/index.ts apps/api/test/optimized-route.test.ts
git commit -m "feat(api): GET /v1/optimized-route — thứ tự ghé tối ưu một xe trên Valhalla optimized_route

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Capture fixture thật từ Valhalla Quận 1, test tích hợp qua wrangler dev

**Files:**
- Modify: `scripts/routing-test.mjs` (khối `--capture`)
- Create: `apps/api/test-routing/matrix.rtest.mjs`, `apps/api/test-routing/optimized-route.rtest.mjs`
- Create (capture): `apps/api/test/fixtures/valhalla/q1-matrix.json`, `q1-optimized.json`
- Modify: `apps/api/test/routing-matrix.test.ts`, `apps/api/test/routing-optimized.test.ts` (thêm ca fixture thật)

- [x] **Step 1: Mở rộng khối capture trong `scripts/routing-test.mjs`**

Thay khối `if (opts.capture) { … }` bằng:

```js
  if (opts.capture) {
    const point = (/** @type {number} */ lat, /** @type {number} */ lon) => ({ lat, lon });
    const stop = (/** @type {number} */ lat, /** @type {number} */ lon) => ({ lat, lon, type: 'break' });
    const options = { language: 'vi-VN', units: 'kilometers' };
    // Bốn điểm Quận 1: Nhà thờ Đức Bà, Bến Thành, Nhà hát TP, Bitexco.
    const captures = [
      {
        path: '/route',
        file: 'q1-motorbike.json',
        body: {
          locations: [stop(10.7798, 106.699), stop(10.7725, 106.698)],
          costing: 'motor_scooter',
          directions_options: options,
          id: 'capture-q1-motorbike',
        },
      },
      {
        path: '/sources_to_targets',
        file: 'q1-matrix.json',
        body: {
          sources: [point(10.7798, 106.699), point(10.7725, 106.698)],
          targets: [point(10.7769, 106.7032), point(10.7716, 106.7043)],
          costing: 'motor_scooter',
          units: 'kilometers',
          id: 'capture-q1-matrix',
        },
      },
      {
        path: '/optimized_route',
        file: 'q1-optimized.json',
        body: {
          locations: [
            stop(10.7798, 106.699),
            stop(10.7716, 106.7043),
            stop(10.7769, 106.7032),
            stop(10.7725, 106.698),
          ],
          costing: 'motor_scooter',
          directions_options: options,
          id: 'capture-q1-optimized',
        },
      },
    ];
    for (const { path, file, body } of captures) {
      const response = await fetch(`${opts.valhallaBase}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`capture ${path}: Valhalla trả ${response.status}`);
      const target = resolve(`apps/api/test/fixtures/valhalla/${file}`);
      writeFileSync(target, `${JSON.stringify(await response.json(), null, 2)}\n`);
      log(`đã ghi ${target}`);
    }
  }
```

Cập nhật dòng chú thích đầu file (`--capture ghi JSON Valhalla thô → …q1-motorbike.json`) thành `--capture ghi ba fixture q1-motorbike.json, q1-matrix.json, q1-optimized.json`.

- [x] **Step 2: Viết `apps/api/test-routing/matrix.rtest.mjs`**

```js
import { describe, expect, it } from 'vitest';

const base = process.env.ROUTING_API_BASE ?? 'http://127.0.0.1:8798';
const key = process.env.ROUTING_API_KEY ?? 'mlv_live_routingtest0000000000000';
/** @param {string} query */
const get = (query) => fetch(`${base}/v1/matrix?${query}`, { headers: { 'X-Api-Key': key } });
// Quận 1: Nhà thờ Đức Bà, Bến Thành → Nhà hát TP, Bitexco.
const SOURCES = '10.7798,106.6990;10.7725,106.6980';
const TARGETS = '10.7769,106.7032;10.7716,106.7043';

describe('/v1/matrix trên Valhalla fixture Quận 1', () => {
  for (const mode of ['motorbike', 'car', 'walk']) {
    it(`${mode}: 2×2 số nguyên dương, sources/targets echo dạng [lng, lat]`, async () => {
      const response = await get(`sources=${SOURCES}&targets=${TARGETS}&mode=${mode}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.mode).toBe(mode);
      expect(body.sources).toEqual([
        [106.699, 10.7798],
        [106.698, 10.7725],
      ]);
      expect(body.durations_s).toHaveLength(2);
      for (const [i, row] of body.durations_s.entries()) {
        expect(row).toHaveLength(2);
        for (const [j, seconds] of row.entries()) {
          expect(Number.isInteger(seconds) && seconds > 0, `ô ${i},${j}`).toBe(true);
          const metres = body.distances_m[i][j];
          expect(Number.isInteger(metres) && metres > 200 && metres < 5_000, `ô ${i},${j}`).toBe(true);
        }
      }
      expect(body.attribution).toContain('OpenStreetMap');
      expect(body.engine.name).toBe('valhalla');
    });
  }

  it('điểm ngoài graph fixture nhưng trong 200 km (Vũng Tàu) → ô null, không lỗi', async () => {
    const response = await get(`sources=10.7798,106.6990&targets=10.7769,106.7032;10.3460,107.0843`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.durations_s[0][0]).toBeGreaterThan(0);
    expect(body.durations_s[0][1]).toBeNull();
    expect(body.distances_m[0][1]).toBeNull();
  });

  it('11 × 10 → 400 invalid_request nêu 100 cặp', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `10.77,106.${600 + i}`).join(';');
    const ten = Array.from({ length: 10 }, (_, i) => `10.78,106.${700 + i}`).join(';');
    const response = await get(`sources=${eleven}&targets=${ten}`);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/100 cặp/);
  });
});
```

- [x] **Step 3: Viết `apps/api/test-routing/optimized-route.rtest.mjs`**

```js
import { describe, expect, it } from 'vitest';

const base = process.env.ROUTING_API_BASE ?? 'http://127.0.0.1:8798';
const key = process.env.ROUTING_API_KEY ?? 'mlv_live_routingtest0000000000000';
/** @param {string} query */
const get = (query) =>
  fetch(`${base}/v1/optimized-route?${query}`, { headers: { 'X-Api-Key': key } });
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
// from Nhà thờ Đức Bà; stops Bitexco, Nhà hát TP; to Bến Thành.
const FROM = '10.7798,106.6990';
const STOPS = '10.7716,106.7043;10.7769,106.7032';
const TO = '10.7725,106.6980';

describe('/v1/optimized-route trên Valhalla fixture Quận 1', () => {
  it('order là hoán vị của [0, 1]; 3 leg; 4 waypoint theo thứ tự đi; câu tiếng Việt', async () => {
    const response = await get(`from=${FROM}&stops=${STOPS}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect([...body.order].sort()).toEqual([0, 1]);
    expect(body.routes).toHaveLength(1);
    expect(body.routes[0].legs).toHaveLength(3);
    expect(body.waypoints).toHaveLength(4);
    expect(body.waypoints[0].location).toEqual([106.699, 10.7798]);
    expect(body.waypoints[3].location).toEqual([106.698, 10.7725]);
    const steps = body.routes[0].legs.flatMap((/** @type {{ steps: { instruction: string }[] }} */ leg) => leg.steps);
    expect(steps.some((/** @type {{ instruction: string }} */ s) => VI.test(s.instruction))).toBe(true);
  });

  it('bỏ to → quay về from: waypoint cuối trùng from, 3 leg', async () => {
    const response = await get(`from=${FROM}&stops=${STOPS}&mode=car`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.waypoints.at(-1).location).toEqual([106.699, 10.7798]);
    expect(body.routes[0].legs).toHaveLength(3);
  });

  it('một stop ngoài graph (Vũng Tàu) → 404 no_route', async () => {
    const response = await get(`from=${FROM}&stops=10.3460,107.0843;10.7769,106.7032`);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('no_route');
  });
});
```

- [x] **Step 4: Chạy capture + test tích hợp** (container `mapslibvn-dev-valhalla-1` đang chạy sẵn; lần đầu script tự dựng nếu chưa)

Run: `node scripts/routing-test.mjs --capture`
Expected: log `đã ghi …q1-motorbike.json`, `…q1-matrix.json`, `…q1-optimized.json`; wrangler dev lên; vitest routing chạy `directions.rtest.mjs`, `matrix.rtest.mjs`, `optimized-route.rtest.mjs` → PASS.

Kiểm `git diff --stat apps/api/test/fixtures/valhalla/q1-motorbike.json`: graph dev không đổi từ 11/09 nên file **không nên đổi**. Nếu đổi (graph đã build lại), chạy `pnpm --filter @mapslibvn/api exec vitest run test/routing-fixture-sync.test.ts -u` và commit cả `packages/core/tests/fixtures/directions-q1.json`.

- [x] **Step 5: Thêm ca fixture thật vào unit test**

Cuối `apps/api/test/routing-matrix.test.ts` (import `real from './fixtures/valhalla/q1-matrix.json'`):

```ts
describe('fixture thật Quận 1 (q1-matrix.json, capture 22/09/2026)', () => {
  it('2×2 số dương, đối xứng gần: chiều đi và về cùng cặp lệch dưới 2 lần', () => {
    const out = translateMatrix(real as unknown as ValhallaMatrixResponse, parseMatrixParams(base), null);
    for (const row of out.durations_s) for (const s of row) expect(s).toBeGreaterThan(0);
    const a = out.distances_m[0]?.[1] ?? 0;
    const b = out.distances_m[1]?.[0] ?? 0;
    expect(Math.max(a, b) / Math.min(a, b)).toBeLessThan(2);
  });
});
```

Cuối `apps/api/test/routing-optimized.test.ts` (import `real from './fixtures/valhalla/q1-optimized.json'`):

```ts
describe('fixture thật Quận 1 (q1-optimized.json, capture 22/09/2026)', () => {
  it('order là hoán vị của [0, 1], 3 leg, mọi bước có instruction', () => {
    const out = translateOptimized(real as unknown as ValhallaRouteResponse, p, null);
    expect([...out.order].sort()).toEqual([0, 1]);
    expect(out.routes[0]?.legs).toHaveLength(3);
    for (const leg of out.routes[0]?.legs ?? []) {
      for (const step of leg.steps) expect(step.instruction.length).toBeGreaterThan(0);
    }
  });
});
```

(`p` và `base` đã khai báo ở đầu file/khối `translateOptimized`; nếu `p` nằm trong khối `describe` khác, khai lại `const p = parseOptimizedParams(base);` trong khối mới.)

- [x] **Step 6: Chạy unit test, typecheck scripts, lint, commit**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-matrix.test.ts test/routing-optimized.test.ts && pnpm exec tsc -p tsconfig.scripts.json && pnpm lint:fix && pnpm lint`
Expected: xanh.

```bash
git add scripts/routing-test.mjs apps/api/test-routing/matrix.rtest.mjs apps/api/test-routing/optimized-route.rtest.mjs apps/api/test/fixtures/valhalla/q1-matrix.json apps/api/test/fixtures/valhalla/q1-optimized.json apps/api/test/routing-matrix.test.ts apps/api/test/routing-optimized.test.ts
git commit -m "test(routing): capture fixture ma trận và optimized_route từ Quận 1; test tích hợp hai endpoint mới

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Workflow `.github/workflows/routing-test.yml` đã có path `apps/api/src/**` và `apps/api/test-routing/**` nên tự chạy khi merge — không cần sửa.

---

### Task 12: `pnpm smoke:matrix` — smoke production bài A–D

**Files:**
- Create: `scripts/lib/smoke-matrix.mjs`, `scripts/lib/smoke-matrix.test.mjs`, `scripts/smoke-matrix.mjs`
- Modify: `package.json` (scripts)

Vì sao phải phá cache trong smoke: khoá cache làm tròn 4 chữ số và tươi 60 s, nên 20 lượt cùng URL sẽ đo cache chứ không đo Valhalla. Mỗi lượt dịch điểm đầu 0,0001° × k (~11 m) → khoá khác, request vẫn hợp lệ.

- [x] **Step 1: Viết test đỏ `scripts/lib/smoke-matrix.test.mjs`**

```js
import { describe, expect, it } from 'vitest';
import {
  HCM_POINTS,
  jitter,
  matrixIssues,
  matrixUrl,
  optimizedIssues,
  optimizedUrl,
  parseMatrixSmokeArgs,
  planBai,
} from './smoke-matrix.mjs';

describe('HCM_POINTS', () => {
  it('29 điểm, đều trong hộp Việt Nam, không trùng', () => {
    expect(HCM_POINTS).toHaveLength(29);
    for (const [lat, lng] of HCM_POINTS) {
      expect(lat).toBeGreaterThan(10.7);
      expect(lat).toBeLessThan(10.9);
      expect(lng).toBeGreaterThan(106.6);
      expect(lng).toBeLessThan(106.8);
    }
    expect(new Set(HCM_POINTS.map((p) => p.join(','))).size).toBe(29);
  });
});

describe('planBai', () => {
  it('A 10×10, B 25×4, C from + 10 stops + to, D 5 ma trận 10×10 dịch nhau', () => {
    const bai = planBai();
    expect(bai.A.sources).toHaveLength(10);
    expect(bai.A.targets).toHaveLength(10);
    expect(bai.B.sources).toHaveLength(25);
    expect(bai.B.targets).toHaveLength(4);
    expect(bai.C.stops).toHaveLength(10);
    expect(bai.D).toHaveLength(5);
    expect(bai.D[0]?.sources).not.toEqual(bai.D[1]?.sources);
    // Không có điểm nào vừa là source vừa là target trong cùng bài (ô 0 giây làm hỏng phép kiểm dương).
    for (const m of [bai.A, bai.B, ...bai.D]) {
      const s = new Set(m.sources.map((p) => p.join(',')));
      expect(m.targets.some((p) => s.has(p.join(',')))).toBe(false);
    }
  });
});

describe('URL', () => {
  it('matrixUrl/optimizedUrl ghép lat,lng nối ";" và mode; jitter dịch vĩ độ điểm đầu 0,0001° × k', () => {
    const root = 'https://api.test';
    expect(
      matrixUrl(root, { sources: [[10.7798, 106.699]], targets: [[10.7725, 106.698]], mode: 'car' }),
    ).toBe('https://api.test/v1/matrix?sources=10.7798,106.699&targets=10.7725,106.698&mode=car');
    expect(
      optimizedUrl(root, {
        from: [10.7798, 106.699],
        stops: [[10.7716, 106.7043]],
        to: [10.7725, 106.698],
        mode: 'motorbike',
      }),
    ).toBe(
      'https://api.test/v1/optimized-route?from=10.7798,106.699&stops=10.7716,106.7043&to=10.7725,106.698&mode=motorbike',
    );
    const shifted = jitter([[10.7798, 106.699], [10.7725, 106.698]], 3);
    expect(shifted[0]).toEqual([10.7801, 106.699]);
    expect(shifted[1]).toEqual([10.7725, 106.698]);
  });
});

describe('matrixIssues / optimizedIssues', () => {
  const ok = { durations_s: [[10, 20]], distances_m: [[100, 200]] };
  it('bảng đúng cỡ, số nguyên dương → không lỗi; null, âm, sai cỡ → có lỗi nêu ô', () => {
    expect(matrixIssues(ok, 1, 2)).toEqual([]);
    expect(matrixIssues({ ...ok, durations_s: [[10, null]] }, 1, 2)).toEqual(['durations_s[0][1] = null']);
    expect(matrixIssues({ ...ok, distances_m: [[100, -1]] }, 1, 2)[0]).toMatch(/distances_m\[0\]\[1\]/);
    expect(matrixIssues(ok, 2, 2)[0]).toMatch(/durations_s có 1 hàng, cần 2/);
    expect(matrixIssues('x', 1, 2)[0]).toMatch(/không phải object/);
  });

  it('optimized: order phải là hoán vị đủ, legs = stops + 1, waypoints = stops + 2', () => {
    const good = { order: [1, 0], routes: [{ legs: [{}, {}, {}] }], waypoints: [{}, {}, {}, {}] };
    expect(optimizedIssues(good, 2)).toEqual([]);
    expect(optimizedIssues({ ...good, order: [0, 0] }, 2)[0]).toMatch(/order/);
    expect(optimizedIssues({ ...good, routes: [{ legs: [{}] }] }, 2)[0]).toMatch(/legs/);
  });
});

describe('parseMatrixSmokeArgs', () => {
  it('mặc định: base production, 5 lượt, 3500 ms, không p95-max, 0 vòng D', () => {
    expect(parseMatrixSmokeArgs([])).toEqual({
      base: 'https://api.ai-solutions.io.vn',
      confirmProduction: false,
      requests: 5,
      intervalMs: 3500,
      p95Max: null,
      rounds: 0,
      ratioMax: 2,
    });
  });
  it('đọc cờ; cờ lạ, lặp, ngoài khoảng → ném', () => {
    const args = parseMatrixSmokeArgs([
      '--confirm-production',
      '--requests=20',
      '--rounds=3',
      '--p95-max=3000',
      '--ratio-max=1.5',
      '--base=https://x.test',
    ]);
    expect(args).toMatchObject({ confirmProduction: true, requests: 20, rounds: 3, p95Max: 3000, ratioMax: 1.5 });
    expect(() => parseMatrixSmokeArgs(['--foo=1'])).toThrow(/Cờ không hợp lệ/);
    expect(() => parseMatrixSmokeArgs(['--requests=0'])).toThrow(/từ 1 đến 50/);
    expect(() => parseMatrixSmokeArgs(['--rounds=11'])).toThrow(/từ 0 đến 10/);
    expect(() => parseMatrixSmokeArgs(['--requests=2', '--requests=3'])).toThrow(/không được lặp/);
  });
});
```

- [x] **Step 2: Chạy test, phải đỏ**

Run: `pnpm exec vitest run scripts/lib/smoke-matrix.test.mjs`
Expected: FAIL — module không tồn tại.

- [x] **Step 3: Tạo `scripts/lib/smoke-matrix.mjs`**

```js
// Phần thuần (test được) của scripts/smoke-matrix.mjs — spec 22/09/2026 mục 6.1.
export const DEFAULT_BASE = 'https://api.ai-solutions.io.vn';

/**
 * 29 điểm nội thành TP.HCM trên đường công cộng ([lat, lng]). KHÔNG dùng toạ độ sân bay
 * 10.8188,106.6520: nó bám vào "VĐ. bảo vệ sân bay" trong khu bay (bài học 11/09/2026) — điểm sân bay
 * ở đây là Trường Sơn trước nhà ga. Nếu một điểm cho ô null trong bài A/B, thay điểm đó, không nới trần.
 * @type {readonly (readonly [number, number])[]}
 */
export const HCM_POINTS = [
  [10.7798, 106.699], // Nhà thờ Đức Bà
  [10.7725, 106.698], // Chợ Bến Thành
  [10.7769, 106.7032], // Nhà hát TP
  [10.7716, 106.7043], // Bitexco
  [10.777, 106.6953], // Dinh Độc Lập
  [10.7826, 106.6958], // Hồ Con Rùa
  [10.7889, 106.6906], // Chợ Tân Định
  [10.7877, 106.6947], // Công viên Lê Văn Tám
  [10.7877, 106.7052], // Thảo Cầm Viên
  [10.7686, 106.7069], // Bến Nhà Rồng
  [10.8039, 106.6963], // Chợ Bà Chiểu
  [10.8153, 106.6633], // Trường Sơn, trước ga Tân Sơn Nhất
  [10.757, 106.671], // Chợ An Đông
  [10.7724, 106.658], // ĐH Bách Khoa
  [10.801, 106.7118], // Ngã tư Hàng Xanh (thay Landmark 81: điểm đó nằm trong khu Vinhomes,
  // không nối mạng đường công cộng nên mọi ô ma trận tới nó là null — đo production 22/09/2026)
  [10.796, 106.662], // Chợ Phạm Văn Hai
  [10.8148, 106.7111], // Bến xe Miền Đông cũ
  [10.812, 106.678], // Công viên Gia Định
  [10.792, 106.704], // Chợ Thị Nghè
  [10.799, 106.728], // Cầu Sài Gòn
  [10.781, 106.672], // Chợ Hoà Hưng
  [10.793, 106.653], // Ngã tư Bảy Hiền
  [10.762, 106.669], // Chợ Nguyễn Tri Phương
  [10.7497, 106.6511], // Chợ Bình Tây
  [10.7602, 106.6821], // Chợ Hoà Bình
  [10.7663, 106.6913], // Công viên 23/9
  [10.7745, 106.6866], // Bệnh viện Từ Dũ
  [10.7864, 106.6813], // Chợ Vườn Chuối
  [10.7708, 106.6939], // Chợ Thái Bình
];

/** @typedef {{ sources: (readonly [number, number])[], targets: (readonly [number, number])[], mode: 'motorbike' | 'car' | 'walk' }} BaiMaTran */
/** @typedef {{ from: readonly [number, number], stops: (readonly [number, number])[], to: readonly [number, number], mode: 'motorbike' | 'car' | 'walk' }} BaiToiUu */

/** Bài A 10×10 xe máy, B 25×4 ô tô, C TSP 12 điểm, D năm ma trận 10×10 dịch nhau (không trùng URL). */
export function planBai() {
  const P = HCM_POINTS;
  /** @type {BaiMaTran} */
  const A = { sources: P.slice(0, 10), targets: P.slice(10, 20), mode: 'motorbike' };
  /** @type {BaiMaTran} */
  const B = { sources: P.slice(0, 25), targets: P.slice(25, 29), mode: 'car' };
  const from = P[0];
  const to = P[11];
  if (!from || !to) throw new Error('HCM_POINTS thiếu điểm');
  /** @type {BaiToiUu} */
  const C = { from, stops: P.slice(1, 11), to, mode: 'motorbike' };
  /** @type {BaiMaTran[]} */
  const D = Array.from({ length: 5 }, (_, i) => ({
    sources: P.slice(i, i + 10),
    targets: P.slice(10 + i, 20 + i),
    mode: 'motorbike',
  }));
  return { A, B, C, D };
}

/** @param {readonly (readonly [number, number])[]} points */
export const joinPoints = (points) => points.map(([lat, lng]) => `${lat},${lng}`).join(';');

/**
 * Dịch vĩ độ ĐIỂM ĐẦU 0,0001° × k (~11 m) để mỗi lượt có khoá cache khác — đo Valhalla, không đo cache.
 * @param {readonly (readonly [number, number])[]} points @param {number} k
 * @returns {(readonly [number, number])[]}
 */
export function jitter(points, k) {
  return points.map(([lat, lng], i) =>
    i === 0 ? [Number((lat + 0.0001 * k).toFixed(4)), lng] : [lat, lng],
  );
}

/** @param {string} root @param {BaiMaTran} bai */
export function matrixUrl(root, { sources, targets, mode }) {
  return `${root}/v1/matrix?sources=${joinPoints(sources)}&targets=${joinPoints(targets)}&mode=${mode}`;
}

/** @param {string} root @param {BaiToiUu} bai */
export function optimizedUrl(root, { from, stops, to, mode }) {
  return `${root}/v1/optimized-route?from=${joinPoints([from])}&stops=${joinPoints(stops)}&to=${joinPoints([to])}&mode=${mode}`;
}

/** @param {string} root @param {readonly [number, number]} from @param {readonly [number, number]} to */
export function directionsUrl(root, from, to) {
  return `${root}/v1/directions?from=${joinPoints([from])}&to=${joinPoints([to])}&mode=motorbike`;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Bảng phải đúng cỡ, mọi ô số nguyên dương (điểm tốt trong nội thành không được null).
 * @param {unknown} body @param {number} rows @param {number} cols @returns {string[]}
 */
export function matrixIssues(body, rows, cols) {
  if (!isRecord(body)) return ['body không phải object'];
  /** @type {string[]} */
  const issues = [];
  for (const name of ['durations_s', 'distances_m']) {
    const table = body[name];
    if (!Array.isArray(table) || table.length !== rows) {
      issues.push(`${name} có ${Array.isArray(table) ? table.length : 0} hàng, cần ${rows}`);
      continue;
    }
    for (const [i, row] of table.entries()) {
      if (!Array.isArray(row) || row.length !== cols) {
        issues.push(`${name}[${i}] có ${Array.isArray(row) ? row.length : 0} ô, cần ${cols}`);
        continue;
      }
      for (const [j, cell] of row.entries()) {
        if (!(Number.isInteger(cell) && cell > 0)) issues.push(`${name}[${i}][${j}] = ${String(cell)}`);
      }
    }
  }
  return issues;
}

/**
 * `order` là hoán vị đủ của 0…stops−1; legs = stops + 1; waypoints = stops + 2.
 * @param {unknown} body @param {number} stops @returns {string[]}
 */
export function optimizedIssues(body, stops) {
  if (!isRecord(body)) return ['body không phải object'];
  /** @type {string[]} */
  const issues = [];
  const order = Array.isArray(body.order) ? body.order : [];
  const sorted = [...order].sort((a, b) => Number(a) - Number(b));
  const expected = Array.from({ length: stops }, (_, i) => i);
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) issues.push(`order không phải hoán vị của 0…${stops - 1}`);
  const route = Array.isArray(body.routes) ? body.routes[0] : undefined;
  const legs = isRecord(route) && Array.isArray(route.legs) ? route.legs.length : 0;
  if (legs !== stops + 1) issues.push(`legs = ${legs}, cần ${stops + 1}`);
  const waypoints = Array.isArray(body.waypoints) ? body.waypoints.length : 0;
  if (waypoints !== stops + 2) issues.push(`waypoints = ${waypoints}, cần ${stops + 2}`);
  return issues;
}

/** @param {string} value @param {string} name @param {number} min @param {number} max @param {boolean} integer */
function boundedNumber(value, name, min, max, integer) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
    throw new Error(`${name} phải ${integer ? 'là số nguyên ' : ''}từ ${min} đến ${max}`);
  }
  return parsed;
}

/** @param {string[]} argv */
export function parseMatrixSmokeArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  let confirmProduction = false;
  for (const value of argv) {
    if (value === '--confirm-production') {
      if (confirmProduction) throw new Error('--confirm-production không được lặp');
      confirmProduction = true;
      continue;
    }
    const match = /^--(base|requests|p95-max|interval-ms|rounds|ratio-max)=(.+)$/.exec(value);
    if (!match) throw new Error(`Cờ không hợp lệ hoặc thiếu giá trị: ${value}`);
    const name = match[1];
    const raw = match[2];
    if (!name || raw === undefined) throw new Error(`Cờ không hợp lệ: ${value}`);
    if (values[name] !== undefined) throw new Error(`--${name} không được lặp`);
    values[name] = raw;
  }
  return {
    base: values.base ?? DEFAULT_BASE,
    confirmProduction,
    requests: boundedNumber(values.requests ?? '5', '--requests', 1, 50, true),
    intervalMs: boundedNumber(values['interval-ms'] ?? '3500', '--interval-ms', 0, 60_000, true),
    p95Max: values['p95-max'] === undefined ? null : boundedNumber(values['p95-max'], '--p95-max', 1, 120_000, false),
    rounds: boundedNumber(values.rounds ?? '0', '--rounds', 0, 10, true),
    ratioMax: boundedNumber(values['ratio-max'] ?? '2', '--ratio-max', 1, 10, false),
  };
}
```

- [x] **Step 4: Chạy test lib, phải xanh**

Run: `pnpm exec vitest run scripts/lib/smoke-matrix.test.mjs`
Expected: PASS.

- [x] **Step 5: Tạo `scripts/smoke-matrix.mjs`**

```js
#!/usr/bin/env node
// Smoke ma trận và tối ưu thứ tự trên production (spec 22/09/2026 mục 6.1): bài A 10×10, B 25×4, C TSP
// 12 điểm, mỗi bài N lượt cách 3,5 s, in p95; --rounds=K chạy thêm bài D: K vòng, mỗi vòng đo 5 lượt
// directions lúc rảnh → bắn 5 ma trận 10×10 SONG SONG + 5 directions xen kẽ → nghỉ hết phút.
//   pnpm smoke:matrix -- --confirm-production [--requests=20] [--rounds=3] [--p95-max=3000] [--ratio-max=2]
// Ba endpoint dùng CHUNG burst 20 request/phút/khoá+IP: A–C cách 3,5 s (~17/phút); mỗi vòng D đúng 15
// request rồi nghỉ tới đủ 60 s; giữa C và D nghỉ 60 s. Gặp 429 là smoke sai nhịp — sửa smoke, không sửa trần.
// Mỗi lượt A–C dịch điểm đầu 0,0001° × k để không trúng cache (khoá cache làm tròn 4 chữ số).
// Khoá đọc từ MAPSLIBVN_API_KEY (khoá `server`). Lần đầu chạy --requests=20 --rounds=3 để lấy số ghi
// evidence docs/evidence/routing/, rồi chốt --p95-max theo số đo (không đoán).
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import {
  directionsUrl,
  jitter,
  matrixIssues,
  matrixUrl,
  optimizedIssues,
  optimizedUrl,
  parseMatrixSmokeArgs,
  planBai,
} from './lib/smoke-matrix.mjs';
import { assertDirectionsTarget, percentile } from './smoke-directions.mjs';

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} url @param {string} key
 * @returns {Promise<{ ms: number, status: number, body: unknown, code: string | null }>}
 */
async function timedGet(url, key) {
  const t0 = performance.now();
  const signal = AbortSignal.timeout(30_000);
  try {
    const response = await fetch(url, { headers: { 'X-Api-Key': key }, redirect: 'error', signal });
    /** @type {unknown} */
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const error = body && typeof body === 'object' && 'error' in body ? /** @type {{ error?: { code?: string } }} */ (body).error : undefined;
    return { ms: performance.now() - t0, status: response.status, body, code: error?.code ?? null };
  } catch (error) {
    return { ms: performance.now() - t0, status: 0, body: null, code: signal.aborted ? 'timeout' : String(error) };
  }
}

/**
 * @typedef {{ name: string, ok: number, failed: number, p95_ms: number | null, codes: string, violations: string }} Row
 * @param {string} name @param {(k: number) => string} urlAt @param {(body: unknown) => string[]} check
 * @param {{ key: string, requests: number, intervalMs: number, sent: { n: number } }} ctx
 * @returns {Promise<Row>}
 */
async function runBai(name, urlAt, check, ctx) {
  /** @type {number[]} */
  const durations = [];
  /** @type {Set<string>} */
  const codes = new Set();
  /** @type {string[]} */
  const violations = [];
  let ok = 0;
  let failed = 0;
  for (let k = 0; k < ctx.requests; k++) {
    if (ctx.sent.n > 0 && ctx.intervalMs > 0) await sleep(ctx.intervalMs);
    ctx.sent.n += 1;
    const r = await timedGet(urlAt(k), ctx.key);
    durations.push(r.ms);
    if (r.status !== 200) {
      failed += 1;
      codes.add(r.code ?? String(r.status));
      continue;
    }
    const issues = check(r.body);
    if (issues.length > 0) {
      failed += 1;
      codes.add('invalid_body');
      violations.push(...issues.slice(0, 3));
    } else ok += 1;
  }
  return {
    name,
    ok,
    failed,
    p95_ms: percentile(durations, 95) === null ? null : Math.round(percentile(durations, 95) ?? 0),
    codes: [...codes].join(','),
    violations: [...new Set(violations)].join('; '),
  };
}

/**
 * Một vòng bài D. Tổng 15 request theo khoá+IP, rồi nghỉ tới đủ 60 s.
 * @param {string} root @param {string} key @param {import('./lib/smoke-matrix.mjs').BaiMaTran[]} matrices
 * @param {number} round
 */
async function runRound(root, key, matrices, round) {
  const started = Date.now();
  const bai = planBai();
  const from = bai.C.from;
  const to = bai.C.to;
  /** @param {number} offset */
  const sampleDirections = async (offset) => {
    /** @type {number[]} */
    const ms = [];
    for (let i = 0; i < 5; i++) {
      // Mỗi lượt một điểm đến khác để không trúng cache; xen kẽ cách 1 s.
      const target = bai.C.stops[(i + offset) % bai.C.stops.length] ?? to;
      const r = await timedGet(directionsUrl(root, from, target), key);
      if (r.status !== 200) throw new Error(`vòng ${round}: directions ${r.status} ${r.code ?? ''} — dừng, không đo tiếp`);
      ms.push(r.ms);
      await sleep(1_000);
    }
    return ms;
  };
  const idle = await sampleDirections(0);
  const matrixRuns = matrices.map((m) => timedGet(matrixUrl(root, { ...m, sources: jitter(m.sources, round + 1) }), key));
  const busy = await sampleDirections(5);
  const matrixResults = await Promise.all(matrixRuns);
  const matrixFailed = matrixResults.filter((r) => r.status !== 200);
  if (matrixFailed.length > 0) {
    throw new Error(`vòng ${round}: ${matrixFailed.length} ma trận lỗi (${matrixFailed.map((r) => r.code ?? r.status).join(',')})`);
  }
  const idleP95 = percentile(idle, 95) ?? 0;
  const busyP95 = percentile(busy, 95) ?? 0;
  const row = {
    round,
    idle_p95_ms: Math.round(idleP95),
    busy_p95_ms: Math.round(busyP95),
    ratio: Number((busyP95 / Math.max(1, idleP95)).toFixed(2)),
    matrix_p95_ms: Math.round(percentile(matrixResults.map((r) => r.ms), 95) ?? 0),
  };
  const elapsed = Date.now() - started;
  if (elapsed < 60_000) await sleep(60_000 - elapsed);
  return row;
}

async function main() {
  const args = parseMatrixSmokeArgs(process.argv.slice(2));
  assertDirectionsTarget(args.base, args.confirmProduction ? ['--confirm-production'] : []);
  const key = process.env.MAPSLIBVN_API_KEY;
  if (!key) throw new Error('Thiếu MAPSLIBVN_API_KEY (khoá server) trong môi trường');
  const root = args.base.replace(/\/+$/, '');
  const bai = planBai();
  const ctx = { key, requests: args.requests, intervalMs: args.intervalMs, sent: { n: 0 } };
  console.log(`A–C: ${3 * args.requests} lượt cách ${args.intervalMs} ms; D: ${args.rounds} vòng × ~60 s`);
  const rows = [
    await runBai('A ma tran 10x10 motorbike', (k) => matrixUrl(root, { ...bai.A, sources: jitter(bai.A.sources, k) }), (b) => matrixIssues(b, 10, 10), ctx),
    await runBai('B ma tran 25x4 car', (k) => matrixUrl(root, { ...bai.B, sources: jitter(bai.B.sources, k) }), (b) => matrixIssues(b, 25, 4), ctx),
    await runBai('C TSP 12 diem motorbike', (k) => optimizedUrl(root, { ...bai.C, from: jitter([bai.C.from], k)[0] ?? bai.C.from }), (b) => optimizedIssues(b, 10), ctx),
  ];
  console.table(rows);
  for (const row of rows) {
    if (row.failed > 0) throw new Error(`${row.name}: ${row.failed} lượt lỗi (${row.codes}) ${row.violations}`);
    if (args.p95Max !== null && row.p95_ms !== null && row.p95_ms > args.p95Max) throw new Error(`${row.name}: p95 ${row.p95_ms} ms vượt ${args.p95Max} ms`);
  }
  if (args.rounds > 0) {
    console.log('nghỉ 60 s trước bài D để bộ đếm burst sạch…');
    await sleep(60_000);
    /** @type {Awaited<ReturnType<typeof runRound>>[]} */
    const dRows = [];
    for (let round = 1; round <= args.rounds; round++) dRows.push(await runRound(root, key, bai.D, round));
    console.table(dRows);
    const worst = Math.max(...dRows.map((r) => r.ratio));
    if (worst > args.ratioMax) throw new Error(`bài D: p95 directions lúc bận gấp ${worst} lần lúc rảnh, vượt ${args.ratioMax}`);
  }
  console.log(`✓ smoke matrix ${args.base}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
```

- [x] **Step 6: Thêm script vào `package.json`** — sau dòng `"smoke:directions"`:

```json
    "smoke:matrix": "node scripts/smoke-matrix.mjs",
```

- [x] **Step 7: Typecheck scripts (checkJs), lint, thử chạy cạn với base local không có Worker (phải lỗi rõ ràng, không crash)**

Run: `pnpm exec tsc -p tsconfig.scripts.json && pnpm lint:fix && pnpm lint && node scripts/smoke-matrix.mjs --base=http://127.0.0.1:1 --requests=1`
Expected: tsc 0 lỗi; lint xanh; script in bảng với `failed 1` và thoát mã 1 kèm thông điệp `A ma tran 10x10 motorbike: 1 lượt lỗi (…)` — chứng tỏ đường lỗi hoạt động.

Nếu tsc báo `percentile` trả `number | null` không gán được: đã bọc `?? 0`/kiểm null ở trên; sửa theo thông điệp.

- [x] **Step 8: Commit**

```bash
git add scripts/lib/smoke-matrix.mjs scripts/lib/smoke-matrix.test.mjs scripts/smoke-matrix.mjs package.json
git commit -m "feat(scripts): pnpm smoke:matrix — bài A/B/C p95 và bài D đo directions khi 5 ma trận chạy song song

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Cổng xanh, merge lần 1, deploy API, kiểm production — endpoint sống nhưng chưa công bố

**Files:** không sửa mã. Nhánh `feat/ma-tran-toi-uu-thu-tu` → `main`.

- [x] **Step 1: Cổng toàn repo**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: xanh toàn bộ (root vitest kể cả `scripts/lib/smoke-matrix.test.mjs`, core client tests; build site/admin/console/web/style; `pnpm --filter @mapslibvn/api test` kể cả bốn file test mới).

- [x] **Step 2: Test tích hợp routing lần cuối trên nhánh**

Run: `pnpm test:routing`
Expected: PASS ba file `.rtest.mjs`.

- [x] **Step 3: Xin PHONG duyệt merge + push** — nêu rõ: sau push, CI chạy Deploy API (endpoint mới sống), Routing tests, CI; Deploy Docs cũng chạy vì `packages/core/**` đổi → phải deploy docs đè ngay sau đó. Chờ PHONG nói "merge đi"/"push đi".

- [x] **Step 4: Merge và push (sau khi PHONG duyệt)**

```bash
git checkout main && git pull --ff-only origin main
git merge --no-ff feat/ma-tran-toi-uu-thu-tu -m "feat: ma trận khoảng cách và tối ưu thứ tự điểm dừng — /v1/matrix, /v1/optimized-route (mã + test)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

- [x] **Step 5: Theo dõi CI**

Run: `gh run list --limit 6` rồi `gh run watch <id>` cho `Deploy API`, `Routing tests`, `CI`, `Deploy Docs`.
Expected: cả bốn xanh. DB tests (~20 phút) xanh không bắt buộc cho bước sau nhưng phải xem xong trước Task 17.

- [x] **Step 6: Deploy docs tay đè** (bài học: workflow Deploy Docs xoá khoá demo, playground trả 401)

Run: `pnpm deploy:docs`
Expected: wrangler in URL deployment. Kiểm: mở `https://docs.ai-solutions.io.vn/playground` (hoặc URL docs production đang dùng) — playground tìm được địa điểm, không 401. Nếu lệnh thiếu quyền (không có OAuth wrangler), nhờ PHONG chạy `! pnpm deploy:docs`.

- [x] **Step 7: Kiểm production bằng khoá `server` — PHONG gõ với `!`** (auto mode chặn Fable)

```bash
! source .env && curl -s -H "X-Api-Key: $MAPSLIBVN_API_KEY" "https://api.ai-solutions.io.vn/v1/matrix?sources=10.7798,106.6990;10.7725,106.6980&targets=10.7769,106.7032;10.7716,106.7043" | head -c 600
! source .env && curl -s -H "X-Api-Key: $MAPSLIBVN_API_KEY" "https://api.ai-solutions.io.vn/v1/optimized-route?from=10.7798,106.6990&stops=10.7716,106.7043;10.7769,106.7032&to=10.7725,106.6980" | head -c 400
! source .env && curl -s -o /dev/null -w "%{http_code} allow=%header{allow}\n" -I -H "X-Api-Key: $MAPSLIBVN_API_KEY" "https://api.ai-solutions.io.vn/v1/matrix?sources=10.7798,106.6990&targets=10.7725,106.6980"
! source .env && curl -s -w "\n%{http_code}\n" -H "X-Api-Key: $MAPSLIBVN_API_KEY" "https://api.ai-solutions.io.vn/v1/matrix?sources=$(python3 -c 'print(";".join(f"10.77,106.{600+i}" for i in range(26)))')&targets=10.78,106.71" | tail -c 300
```

Expected: (1) JSON `mode:"motorbike"`, `durations_s` 2×2 số dương, `engine.graph` là ngày; (2) JSON có `order` là `[0,1]` hoặc `[1,0]`, `routes[0].legs` 3 phần tử; (3) `405 allow=GET`; (4) `400` với message `sources tối đa 25 điểm`.

Ghi bốn kết quả (rút gọn) vào phần đầu file evidence ở Task 14.

---

### Task 14: Đo production bài A–D, ghi evidence, quyết định trần

**Files:**
- Create: `docs/evidence/routing/2026-09-<ngày>-matrix.md` (ngày = ngày chạy đo)

- [x] **Step 1: PHONG chạy smoke đầy đủ (~4 phút A–C + 1 phút nghỉ + 3 phút D)** — bằng `!`, khoá `server` trong `.env`:

```bash
! source .env && pnpm smoke:matrix -- --confirm-production --requests=20 --rounds=3
```

Expected: hai bảng `console.table` (A/B/C với `ok 20 failed 0 p95_ms …`; D ba vòng với `idle_p95_ms`, `busy_p95_ms`, `ratio`, `matrix_p95_ms`) và dòng `✓ smoke matrix https://api.ai-solutions.io.vn`. Nếu bài A/B có `invalid_body` với `durations_s[i][j] = null`: một điểm trong `HCM_POINTS` bám vào chỗ không nối được — thay điểm đó (Task 12 Step 3), chạy lại; **không** nới trần hay bỏ phép kiểm.

- [x] **Step 2: Viết evidence `docs/evidence/routing/2026-09-<ngày>-matrix.md`** theo khuôn `2026-09-11-nghiem-thu-production.md`:

```markdown
# Đo production ma trận và tối ưu thứ tự (spec 22/09/2026 mục 6)

Ngày: 2026-09-<ngày>. Base: `https://api.ai-solutions.io.vn`. Worker `mapslibvn-api-production`
version `<wrangler deployments list>`; `/healthz/routing` → `graph_built_at <giá trị>`; `VALHALLA_THREADS` = 1.

## Kiểm sống sau deploy (Task 13 Step 7)

<dán bốn kết quả rút gọn: 2×2 JSON, optimized JSON, 405, 400>

## Bài A–C — 20 lượt mỗi bài, cách 3,5 s, mỗi lượt lệch điểm đầu 11 m để không trúng cache

<dán console.table thứ nhất>

## Bài D — 3 vòng: 5 directions rảnh → 5 ma trận 10×10 song song + 5 directions xen kẽ

<dán console.table thứ hai>

## Đối chiếu ngưỡng (spec mục 6.2)

| Ngưỡng | Đo được | Đạt? |
|---|---|---|
| p95 A < 3.000 ms | <số> | <có/không> |
| p95 B < 3.000 ms | <số> | |
| p95 C < 3.000 ms | <số> | |
| p95 directions lúc bận ≤ 2× lúc rảnh (vòng xấu nhất) | ratio <số> | |
| 0 lỗi 5xx, 0 lỗi 429 | <codes> | |

## Kết luận và trần công bố

<Đạt: giữ 100 cặp / 10 stops; `--p95-max=<p95 lớn nhất × 1,5 làm tròn lên trăm>` ghi vào chú thích đầu scripts/smoke-matrix.mjs.
Hụt: quyết định của PHONG theo spec mục 6.3 — hạ trần (commit nào) hoặc VALHALLA_THREADS=2 (giờ restart, số đo lần 2).>
```

Thay mọi `<…>` bằng số thật trước khi commit — file evidence không có chỗ trống.

- [x] **Step 3: Chốt `--p95-max`** — sửa dòng chú thích trong `scripts/smoke-matrix.mjs` thành số đo (ví dụ `Ngưỡng p95 production đo 2026-09-<ngày>: --p95-max=<số> (p95 lớn nhất <số> ms × 1,5, làm tròn lên trăm)`), rồi PHONG chạy lại kiểm ngưỡng:

```bash
! source .env && pnpm smoke:matrix -- --confirm-production --requests=20 --p95-max=<số>
```

Expected: `✓ smoke matrix …`.

- [x] **Step 4: Nếu hụt ngưỡng — nhánh 6.3** (bỏ qua nếu đạt)

  - Hạ trần: trong `apps/api/src/routing/matrix.ts` đổi `MATRIX_MAX_PAIRS = 50`; trong `apps/api/src/routing/optimized.ts` đổi `OPTIMIZED_MAX_STOPS = 8`; cập nhật các test đang khoá số 100/10 (`routing-matrix.test.ts` ca "25 × 4 = 100 qua" → dùng 25 × 2; `matrix-route.test.ts` ca 11×10 → 6×10 với message `/50 cặp/`; `routing-optimized.test.ts` ca 11 phần tử → 9; `optimized-route.test.ts` eleven → nine; `scripts/lib/smoke-matrix.mjs` bài A → 5×10, C → 8 stops và test tương ứng), commit `fix(api): hạ trần ma trận 50 cặp / 8 điểm dừng theo số đo production <ngày>`, merge/push (PHONG duyệt), đo lại, ghi lần 2 vào evidence.
  - Hoặc PHONG trên máy chủ: sửa `VALHALLA_THREADS=2` trong `infra/server/.env`, chạy `docker compose -f infra/server/compose.yml --env-file infra/server/.env up -d valhalla` (nạp lại tar, không build; `/v1/directions` 503 khoảng một phút), chờ `/healthz/routing` 200, đo lại, ghi lần 2.

- [x] **Step 5: Commit evidence (trên nhánh feature, đã rebase lên main sau merge lần 1)**

```bash
git checkout feat/ma-tran-toi-uu-thu-tu && git merge --ff-only main
git add docs/evidence/routing/2026-09-<ngày>-matrix.md scripts/smoke-matrix.mjs
git commit -m "docs(evidence): số đo production ma trận và tối ưu thứ tự, chốt ngưỡng p95 smoke:matrix

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Chỉ sang Task 15 khi ngưỡng đạt (hoặc PHONG đã quyết trần mới và đo lại đạt).** Docs và site công bố đúng số đang chạy.

---

### Task 15: Docs — hai endpoint mới, quota "một lượt", SDK, dẫn đường, khoá, tự host, spec A

**Files:**
- Modify: `apps/docs/src/content/docs/api.md`, `tinh-nang.md`, `sdk.md`, `dan-duong.md`, `khoa-api.md`, `tu-host.md`
- Modify: `docs/superpowers/specs/2026-09-10-dan-duong-engine-api-design.md` (mục 1.3)

Số trần trong docs (100 cặp, 25/25, 10 điểm dừng, 200/400/50 km) **phải bằng** hằng số đang chạy sau Task 14. Nếu Task 14 đã hạ trần, thay số tương ứng ở mọi chỗ dưới đây.

- [x] **Step 1: `api.md` — bảng lỗi (mục 2)**: dòng `no_route` đổi thành:

```markdown
| `no_route` | 404 | `GET /v1/directions` và `/v1/optimized-route`: không có đường giữa các điểm, hoặc điểm quá xa mạng đường / vùng không kết nối. `/v1/matrix`: chỉ khi một điểm không bám được vào đường nào — cặp không nối được trả `null` trong bảng, không lỗi |
```

Khối `:::caution[Thay đổi hành vi: HEAD trên bảy API dữ liệu trả 405]` → tiêu đề `…trên chín API dữ liệu trả 405`, câu đầu: `Chín endpoint dữ liệu (sáu API Places, \`/v1/directions\`, \`/v1/matrix\` và \`/v1/optimized-route\`) nay trả **\`405\` kèm \`Allow: GET\`** cho \`HEAD\`, …` (phần còn lại giữ).

- [x] **Step 2: `api.md` — mục 3 quota**: sau đoạn `**Quota Chỉ đường.** …retry-after: 60\`.` thêm đoạn:

```markdown
`GET /v1/matrix` và `GET /v1/optimized-route` tính vào **cùng quota Chỉ đường** và tính **một lượt mỗi request bất kể cỡ**: một ma trận 10 × 10 (100 cặp) hay một lần tối ưu 10 điểm dừng đều là một lượt. Bù lại cỡ mỗi request có trần (tối đa 100 cặp, tối đa 10 điểm dừng — xem từng endpoint ở mục 4). Ba endpoint dùng chung burst 20 request/phút/khoá + IP và trần 100 request/phút cho khoá `web`/`mobile`.
```

Bảng `**Cache.**` thêm hai dòng sau `/v1/directions`:

```markdown
| `/v1/matrix` | 60 giây | 5 phút |
| `/v1/optimized-route` | 60 giây | 5 phút |
```

Câu `Với \`/v1/autocomplete\`, \`/v1/places/{id}\` và \`/v1/directions\`, phản hồi lấy từ cache có header \`x-mlv-cache\`` → `Với \`/v1/autocomplete\`, \`/v1/places/{id}\`, \`/v1/directions\`, \`/v1/matrix\` và \`/v1/optimized-route\`, …`. Thêm câu cuối đoạn: `Khoá cache của ba endpoint dẫn đường làm tròn toạ độ 4 chữ số (~11 m) với ma trận và tối ưu thứ tự, 5 chữ số với directions.`

- [x] **Step 3: `api.md` — hai mục endpoint mới**, chèn ngay trước `## 5. Endpoint ghi`:

````markdown
### GET /v1/matrix

Bảng thời gian và quãng đường từ N điểm đi tới M điểm đến — để chọn tài xế gần nhất, kho gần nhất, cửa hàng gần nhất. Không có hình tuyến, không có bước rẽ. Tính bởi Valhalla trên dữ liệu đường OpenStreetMap, cùng graph với `/v1/directions`. Cần scope `places:read`, tính **một lượt quota Chỉ đường** bất kể cỡ (mục 3).

| Tham số | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `sources` | `lat,lng;lat,lng…` | có | — | 1–25 điểm đi, vĩ độ trước |
| `targets` | `lat,lng;lat,lng…` | có | — | 1–25 điểm đến |
| `mode` | `motorbike` \| `car` \| `walk` | không | `motorbike` | |

Trần mỗi request: `sources × targets ≤ 100` cặp (ví dụ 10 × 10, 25 × 4, 1 × 100). Mọi điểm trong Việt Nam. Khoảng cách đường chim bay lớn nhất giữa bất kỳ điểm đi và điểm đến: xe máy 200 km, ô tô 400 km, đi bộ 50 km. Vượt bất kỳ trần nào → `400 invalid_request` nói rõ trần và phần tử vi phạm, **không tính lượt**.

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/matrix?sources=10.7798,106.6990;10.7725,106.6980&targets=10.8153,106.6633&mode=motorbike"
```

```json
{
  "mode": "motorbike",
  "sources": [[106.699, 10.7798], [106.698, 10.7725]],
  "targets": [[106.6633, 10.8153]],
  "durations_s": [[930], [1010]],
  "distances_m": [[7480], [8120]],
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "valhalla", "graph": "2026-09-15" }
}
```

Điểm cần chú ý:

- `durations_s[i][j]` và `distances_m[i][j]` là từ `sources[i]` tới `targets[j]`, số nguyên (giây, mét).
- Cặp **không nối được** (đảo, vùng đường tách rời) → `null` ở cả hai bảng; request vẫn `200`. Chỉ khi một điểm không bám được vào đường nào (giữa biển, giữa rừng) mới trả `404 no_route`.
- `sources`/`targets` trong response là toạ độ bạn gửi, đổi sang **`[lng, lat]`** (GeoJSON) như mọi response dẫn đường; tham số vào vẫn `lat,lng`.
- Cùng một điểm có thể xuất hiện ở cả hai bên; ô đó là `0`.
- Toạ độ nằm trong URL nên có trong log request của Cloudflare Workers (giữ tối đa 30 ngày, chỉ để chẩn đoán; xem [Điều khoản tenant](/dieu-khoan/) mục 5).
- Dịch vụ đang build lại dữ liệu (thứ Hai ~02:00 giờ VN) → `503 upstream_unavailable` với `retry-after: 30`; bản cache còn trong 5 phút vẫn được trả.

### GET /v1/optimized-route

Sắp thứ tự ghé tối ưu cho **một** chuyến nhiều điểm dừng — shipper nhận 8 đơn buổi sáng, hỏi đi theo thứ tự nào cho ngắn nhất. Điểm xuất phát và điểm kết thúc cố định, các điểm dừng được sắp lại. Response là đúng schema của `/v1/directions` cộng mảng `order`, nên vẽ và dẫn đường bằng cùng mã. Cần scope `places:read`, tính **một lượt quota Chỉ đường** bất kể số điểm.

| Tham số | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `from` | `lat,lng` | có | — | điểm xuất phát, luôn đứng đầu |
| `stops` | `lat,lng;lat,lng…` | có | — | 1–10 điểm cần ghé, thứ tự tuỳ ý |
| `to` | `lat,lng` | không | — | điểm kết thúc, luôn đứng cuối; **bỏ trống = quay về `from`** |
| `mode` | `motorbike` \| `car` \| `walk` | không | `motorbike` | |
| `lang` | `vi` \| `en` | không | `vi` | ngôn ngữ câu chỉ dẫn |

Mọi điểm trong Việt Nam; mỗi điểm dừng và `to` cách `from` không quá: xe máy 200 km, ô tô 400 km, đi bộ 50 km (đường chim bay). Không có `alternatives`.

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/optimized-route?from=10.7798,106.6990&stops=10.7716,106.7043;10.7769,106.7032;10.7686,106.7069&to=10.7725,106.6980"
```

```json
{
  "order": [1, 0, 2],
  "routes": [{ "mode": "motorbike", "distance_m": 4120, "duration_s": 780, "legs": [ "…4 leg…" ], "…": "…" }],
  "waypoints": [
    { "location": [106.699, 10.7798], "snapped": [106.699, 10.7798], "name": null },
    { "location": [106.7032, 10.7769], "snapped": [106.7032, 10.7769], "name": null },
    { "location": [106.7043, 10.7716], "snapped": [106.7043, 10.7716], "name": null },
    { "location": [106.7069, 10.7686], "snapped": [106.7069, 10.7686], "name": null },
    { "location": [106.698, 10.7725], "snapped": [106.6981, 10.7725], "name": null }
  ],
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "valhalla", "graph": "2026-09-15" }
}
```

Điểm cần chú ý:

- `order[k]` là **chỉ số vào mảng `stops` bạn gửi** của điểm ghé thứ k. Ví dụ trên: đi `from` → `stops[1]` → `stops[0]` → `stops[2]` → `to`. `waypoints` và `routes[0].legs` đã xếp theo thứ tự đó; `routes[0].legs.length = stops + 1`.
- Response là `DirectionsResponse` đầy đủ (`geometry` polyline6, `steps` với câu tiếng Việt) — xem `GET /v1/directions` ở trên; đưa thẳng vào `map.routes.show()` hoặc `navigation.start()`.
- Không hỗ trợ kết thúc ở điểm bất kỳ (open-end), sức chứa, khung giờ khách hẹn hay nhiều xe — xem "Những thứ chưa có" trên website.
- Một điểm dừng không tới được → `404 no_route` cho cả chuyến.
- `stops` một điểm vẫn hợp lệ (`order: [0]`) để ứng dụng không phải rẽ nhánh theo số đơn.
````

- [x] **Step 4: `api.md` — mục 7 kiểu dữ liệu**: sau `interface DirectionsResponse { … }` trong khối mã, thêm:

```ts
interface MatrixResponse {
  mode: TravelMode;
  sources: [number, number][];        // [lng, lat], theo thứ tự bạn gửi
  targets: [number, number][];
  durations_s: (number | null)[][];    // [i][j]: giây từ sources[i] tới targets[j]; null = không nối được
  distances_m: (number | null)[][];    // mét; null cùng ô với durations_s
  attribution: string;
  engine?: { name: string; graph: string | null };
}

interface OptimizedRouteResponse extends DirectionsResponse {
  order: number[];                     // chỉ số vào `stops` theo thứ tự nên đi
}
```

Trong danh sách "Vài điểm dễ sai" thêm: `- \`MatrixResponse.durations_s\` và \`distances_m\` là mảng hai chiều \`[source][target]\`; \`null\` là không nối được, không phải lỗi.`

- [x] **Step 5: `tinh-nang.md`**: câu `Chín endpoint: tám đọc, một ghi.` → `Mười một endpoint: mười đọc, một ghi.`; bảng thêm hai dòng sau `/v1/directions`:

```markdown
| `GET /v1/matrix` | bảng thời gian/quãng đường N×M | `sources`, `targets` "lat,lng;…" 1–25 điểm mỗi bên, tối đa 100 cặp; `mode`; **một lượt** quota Chỉ đường |
| `GET /v1/optimized-route` | thứ tự ghé tối ưu cho một chuyến + tuyến đầy đủ | `from`, `stops` 1–10 điểm bắt buộc; `to` tuỳ chọn (bỏ = quay về `from`); `mode`, `lang`; **một lượt** quota Chỉ đường |
```

Cuối mục `## 5. Chỉ đường` (trước `## 6.`) thêm đoạn:

```markdown
**Giao hàng và vận tải.** `GET /v1/matrix` trả bảng thời gian và quãng đường giữa N điểm đi và M điểm
đến (tối đa 100 cặp mỗi lượt) để chọn tài xế hay kho gần nhất; `GET /v1/optimized-route` sắp thứ tự
ghé tối ưu cho một chuyến tối đa 10 điểm dừng và trả luôn tuyến đầy đủ để vẽ. Cả hai tính **một lượt**
Chỉ đường mỗi request bất kể cỡ. Chưa có tối ưu đội xe nhiều xe (sức chứa, khung giờ, chia đơn cho xe).
```

- [x] **Step 6: `sdk.md`**: bảng "Kiểu dữ liệu API" thêm `MatrixResponse`, `OptimizedRouteResponse` sau `DirectionsResponse`; dòng "Chỉ đường" thêm `, MatrixOptions, OptimizedRouteOptions` sau `kiểu DirectionsOptions`. Bảng "Phương thức client ứng với endpoint nào" thêm sau `directions(opts)`:

```markdown
| `matrix(opts)` | `GET /v1/matrix` | `MatrixResponse` |
| `optimizedRoute(opts)` | `GET /v1/optimized-route` | `OptimizedRouteResponse` (= `DirectionsResponse` + `order`) |
```

Bảng `opts` thêm:

```markdown
| `matrix` | `sources`, `targets` (bắt buộc, mảng `[lat, lng]`, tối đa 100 cặp), `mode` |
| `optimizedRoute` | `from`, `stops` (bắt buộc, `[lat, lng]`, 1–10 điểm), `to` (bỏ = quay về `from`), `mode`, `lang` |
```

Câu `Với \`directions\`, tham số vào là \`[lat, lng]\` nhưng mọi toạ độ trong \`DirectionsResponse\` là \`[lng, lat]\`…` → `Với \`directions\`, \`matrix\` và \`optimizedRoute\`, tham số vào là \`[lat, lng]\` nhưng mọi toạ độ trong response là \`[lng, lat]\`; giải mã \`Route.geometry\` bằng \`decodePolyline6\`.` Dòng "Re-export từ core" của React Native (dòng ~399) thêm `MatrixOptions`, `MatrixResponse`, `OptimizedRouteOptions`, `OptimizedRouteResponse` sau `DirectionsResponse`.

- [x] **Step 7: `dan-duong.md`**: chèn mục mới trước `## 7. Giới hạn trình duyệt cần biết` và đánh lại số mục 7 → 8:

````markdown
## 7. Tối ưu thứ tự điểm dừng

Chuyến có nhiều điểm giao thì gọi `optimizedRoute()` thay cho `directions()`. Response là
`DirectionsResponse` cộng `order`, nên phần vẽ và dẫn đường **không đổi một dòng**:

```ts
const response = await map.places.optimizedRoute({
  from: [10.7798, 106.699],
  stops: [
    [10.7716, 106.7043],
    [10.7769, 106.7032],
    [10.7686, 106.7069],
  ],
  // bỏ `to` = quay về `from`
});
map.routes.show(response);
map.fitBounds(response.routes[0].bbox, 60);

// Đánh số điểm ghé theo thứ tự nên đi: waypoints[k + 1] là điểm ghé thứ k (waypoints[0] là from).
// MarkerOptions của @mapslibvn/web nhận lng/lat rời và popupHtml, không có nhãn chữ trên ghim.
response.order.forEach((stopIndex, k) => {
  const [lng, lat] = response.waypoints[k + 1].location;
  map.addMarker({ lng, lat, popupHtml: `Điểm ghé ${k + 1} (đơn số ${stopIndex + 1})` });
});

startButton.onclick = () => map.navigation.start({ response });
```

Tối đa 10 điểm dừng, tính một lượt Chỉ đường. Điểm kết thúc phải cố định (`to`, hoặc quay về
`from`); chưa có "kết thúc ở đâu cũng được". Chi tiết ở [REST API — optimized-route](/api/#get-v1optimized-route).
````

`map.addMarker(o: MarkerOptions)` với `MarkerOptions { lng, lat, popupHtml?, color? }` là API thật của `packages/web/src/map.ts:42-66` (đã kiểm 22/09/2026) — ví dụ trên gọi đúng chữ ký đó.

- [x] **Step 8: `khoa-api.md`**: dòng bảng `| Burst Chỉ đường | 20 lượt / phút / điểm Cloudflare | mỗi cặp khoá + IP, riêng \`GET /v1/directions\` |` → `…| mỗi cặp khoá + IP, gộp \`/v1/directions\`, \`/v1/matrix\`, \`/v1/optimized-route\` |`. Dòng "Trần theo khoá Chỉ đường" thêm cuối cột áp cho: `; gộp cả ba endpoint`.

- [x] **Step 9: `tu-host.md`**: sau câu `\`valhalla\` phục vụ chỉ đường ở cổng nội bộ 8002…` (dòng ~46) thêm câu: `Cùng tiến trình đó phục vụ ma trận (\`sources_to_targets\`) và tối ưu thứ tự (\`optimized_route\`) cho \`/v1/matrix\` và \`/v1/optimized-route\` — image đã bật sẵn, không cần cấu hình thêm.`

- [x] **Step 10: Spec A mục 1.3**: dòng `- Map-matching (bám chuỗi GPS vào đường trên máy chủ), ma trận ETA nhiều điểm, isochrone.` thêm sau: `Ma trận và tối ưu thứ tự điểm dừng đã có spec riêng 22/09/2026: \`2026-09-22-ma-tran-toi-uu-thu-tu-design.md\`.`

- [x] **Step 11: Build docs, kiểm anchor, commit**

Run: `pnpm --filter @mapslibvn/docs build && grep -c 'get-v1matrix\|get-v1optimized-route' apps/docs/dist/api/index.html`
Expected: build xanh; grep ≥ 2 (hai anchor tồn tại — `dan-duong.md` và site trỏ tới `#get-v1matrix`, `#get-v1optimized-route`).

```bash
pnpm lint && git add apps/docs/src/content/docs docs/superpowers/specs/2026-09-10-dan-duong-engine-api-design.md
git commit -m "docs: GET /v1/matrix và /v1/optimized-route — tham chiếu API, quota một lượt, SDK, dẫn đường, khoá, tự host

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Site — bảng đối đầu, `CHUA_CO`, mục "Giao hàng & vận tải", thẻ trang chủ, meta, VIETMAP, e2e

**Files:**
- Modify: `apps/site/src/lib/doi-dau.ts`, `apps/site/src/lib/trang.ts`, `apps/site/src/pages/tinh-nang.astro`, `apps/site/src/pages/index.astro`, `apps/site/src/pages/so-sanh/vietmap.astro`, `apps/site/e2e/trang.spec.ts`
- Test: `apps/site/src/lib/doi-dau.test.ts`, `trang.test.ts` (sẵn có, tự bắt)

- [x] **Step 1: Viết test đỏ — thêm vào `apps/site/src/lib/doi-dau.test.ts`** (trong `describe('bảng đối đầu')`, sau vòng `for`):

```ts
  it('CHUA_CO không còn ma trận và tối ưu một xe, nhưng vẫn giữ đội xe nhiều xe (spec 22/09/2026)', () => {
    expect(CHUA_CO).toEqual([
      'tối ưu đội xe nhiều xe',
      'giao thông thời gian thực',
      'Street View',
      'ảnh vệ tinh',
    ]);
  });

  it('Google: một hàng HOÀ về ma trận/tối ưu thứ tự nêu đúng trần, một hàng ĐỐI THỦ thắng về đội xe', () => {
    const hoa = doiDauGoogle().find((h) => h.tieuChi === 'Ma trận khoảng cách và tối ưu thứ tự điểm dừng');
    expect(hoa?.thang).toBe('hoa');
    expect(hoa?.ta).toMatch(/100 cặp/);
    expect(hoa?.ta).toMatch(/10 điểm dừng/);
    const doiXe = doiDauGoogle().find((h) => h.tieuChi === 'Tối ưu đội xe nhiều xe');
    expect(doiXe?.thang).toBe('ho');
    expect(doiXe?.ta).toBe('Chưa có');
  });

  it('VIETMAP: hàng vận tải vẫn đối thủ thắng nhưng nói rõ đã có ma trận và tối ưu một xe', () => {
    const hang = doiDauVietmap().find((h) => h.tieuChi === 'Bài toán vận tải và theo dõi phương tiện');
    expect(hang?.thang).toBe('ho');
    expect(hang?.ta).toMatch(/ma trận khoảng cách/i);
    expect(hang?.ta).toMatch(/chưa có đội xe nhiều xe/);
  });
```

- [x] **Step 2: Chạy test, phải đỏ**

Run: `pnpm exec vitest run apps/site/src/lib/doi-dau.test.ts`
Expected: FAIL ba ca mới.

- [x] **Step 3: Sửa `apps/site/src/lib/doi-dau.ts`**

`CHUA_CO`:

```ts
export const CHUA_CO = [
  'tối ưu đội xe nhiều xe',
  'giao thông thời gian thực',
  'Street View',
  'ảnh vệ tinh',
] as const;
```

Trong `doiDauGoogle()`, thay hàng `{ tieuChi: 'Ma trận khoảng cách và tối ưu lộ trình đội xe', ta: 'Chưa có', ho: 'Có', thang: 'ho' }` bằng hai hàng:

```ts
    {
      tieuChi: 'Ma trận khoảng cách và tối ưu thứ tự điểm dừng',
      // Số trần chép tay từ MATRIX_MAX_PAIRS / OPTIMIZED_MAX_STOPS của apps/api (site không import
      // Worker). Đổi trần bên API phải đổi dòng này cùng commit (spec 22/09/2026 mục 6.3).
      ta: 'Có; tối đa 100 cặp hoặc 10 điểm dừng mỗi lượt, tính một lượt Chỉ đường',
      ho: 'Có; cỡ lớn hơn, tính tiền theo từng cặp',
      thang: 'hoa',
    },
    {
      tieuChi: 'Tối ưu đội xe nhiều xe',
      ta: 'Chưa có',
      ho: 'Có (Route Optimization API)',
      thang: 'ho',
    },
```

Trong `doiDauVietmap()`, hàng `'Bài toán vận tải và theo dõi phương tiện'` đổi `ta` thành:

```ts
      ta: 'Có ma trận khoảng cách và tối ưu thứ tự cho một xe; chưa có đội xe nhiều xe, chưa theo dõi phương tiện',
```

- [x] **Step 4: Chạy test doi-dau, phải xanh (kể cả "≥ 2 hàng đối thủ thắng" và "không tự nhận thắng")**

Run: `pnpm exec vitest run apps/site/src/lib/doi-dau.test.ts`
Expected: PASS.

- [x] **Step 5: `apps/site/src/lib/trang.ts`** — `tinhNang.description` đổi thành (150 ký tự, trong 120–160):

```ts
    description:
      'Bản đồ nền Việt Nam, 164 loại địa điểm, tìm kiếm hiểu cách người Việt gõ, geocode nói thật độ chính xác, dẫn đường, ma trận khoảng cách và bốn SDK.',
```

Run: `pnpm exec vitest run apps/site/src/lib/trang.test.ts` → PASS (test đếm 120–160 ký tự). Nếu đỏ vì độ dài, bỏ/thêm một từ cho vừa.

- [x] **Step 6: `apps/site/src/pages/tinh-nang.astro`** — thêm mục thứ 6 vào `MUC`, ngay sau mục `dan-duong` và trước `sdk`:

```ts
  {
    id: 'giao-hang',
    nhan: 'Giao hàng',
    tieuDe: 'Giao hàng & vận tải',
    doan: [
      'Ma trận khoảng cách trả bảng thời gian và quãng đường từ N điểm đi tới M điểm đến trong một lượt gọi — chọn tài xế gần nhất, kho gần nhất mà không phải tính từng tuyến. Tối đa 100 cặp mỗi lượt.',
      'Tối ưu thứ tự điểm dừng sắp lại tối đa 10 điểm giao cho một chuyến và trả luôn tuyến đầy đủ để vẽ và dẫn đường. Cả hai tính một lượt Chỉ đường. Chưa có tối ưu đội xe nhiều xe.',
    ],
    href: `${DOCS_URL}/api/#get-v1matrix`,
    nhanLink: 'Tham chiếu API ma trận',
  },
```

Thêm hằng số minh hoạ vào frontmatter (cạnh `CHANG`), khai kiểu rõ để `astro check` không suy ra `(string | number)[]`:

```ts
/** Số phút minh hoạ cho bảng 3×3 ở mục Giao hàng — ô ≤ 6 phút tô màu nhấn là "tài xế gần nhất". */
const MA_TRAN_MINH_HOA: readonly { ten: string; phut: readonly number[] }[] = [
  { ten: 'Tài xế A', phut: [6, 14, 21] },
  { ten: 'Tài xế B', phut: [11, 5, 17] },
  { ten: 'Tài xế C', phut: [19, 12, 4] },
];
```

Thêm minh hoạ tĩnh vào khối `data-bang-chung`, sau khối `{muc.id === 'dan-duong' && (…)}`:

```astro
                {muc.id === 'giao-hang' && (
                  <The nen="surface-2">
                    <table class="w-full border-collapse text-left">
                      <caption class="t-small pb-2 text-muted">Phút xe máy từ 3 tài xế tới 3 đơn</caption>
                      <thead>
                        <tr class="t-small text-muted">
                          <th scope="col" class="py-1 pr-3 font-normal" />
                          <th scope="col" class="py-1 pr-3 font-normal">Đơn 1</th>
                          <th scope="col" class="py-1 pr-3 font-normal">Đơn 2</th>
                          <th scope="col" class="py-1 font-normal">Đơn 3</th>
                        </tr>
                      </thead>
                      <tbody class="t-small">
                        {
                          MA_TRAN_MINH_HOA.map(({ ten, phut }) => (
                            <tr class="border-t border-border">
                              <th scope="row" class="py-1 pr-3 font-normal text-muted">{ten}</th>
                              {phut.map((p) => (
                                <td class:list={['py-1 pr-3 font-semibold', p <= 6 && 'text-accent-text']}>{p}</td>
                              ))}
                            </tr>
                          ))
                        }
                      </tbody>
                    </table>
                    <p class="t-small mt-4 text-muted">Thứ tự ghé tối ưu cho một chuyến 3 điểm:</p>
                    <ol class="t-code mt-1 flex flex-wrap items-center gap-2 text-text">
                      {['Kho', '2', '3', '1', 'Kho'].map((b, i) => (
                        <li class="flex items-center gap-2">
                          {i > 0 && <span aria-hidden="true" class="text-muted">→</span>}
                          <span class="rounded-full border border-border px-3 py-1">{b}</span>
                        </li>
                      ))}
                    </ol>
                  </The>
                )}
```

Mục "Những thứ chưa có" tự đọc `CHUA_CO`, không sửa. Đoạn dẫn đầu trang (`Những gì liệt kê dưới đây đang chạy thật…`) giữ nguyên.

- [x] **Step 7: `apps/site/src/pages/index.astro`** — tiêu đề `Sáu mảng đang chạy thật, không phải lộ trình` → `Bảy mảng đang chạy thật, không phải lộ trình`. Thẻ `Dẫn đường` đổi `span={8}` → `span={4}` và bỏ phần `<svg>` (giữ `<ul>` ba nhãn, để vừa ô 4 cột); ngay sau thẻ Dẫn đường (trước thẻ `Bốn SDK, một API`) thêm:

```astro
      <BentoO
        span={4}
        tieuDe="Giao hàng & vận tải"
        href={`${DOCS_URL}/api/#get-v1matrix`}
        nhanLink="Tham chiếu API ma trận"
        nhan="MATRIX"
      >
        Ma trận khoảng cách N×M và thứ tự ghé tối ưu cho một chuyến, mỗi request tính một lượt.
        <div slot="minh-hoa" class="flex flex-wrap gap-2">
          {
            ['≤ 100 cặp / lượt', '≤ 10 điểm dừng', '1 lượt Chỉ đường'].map((c) => (
              <span class="t-small rounded-full border border-border px-3 py-1 text-text">{c}</span>
            ))
          }
        </div>
      </BentoO>
```

Bố cục lưới 12 cột: hàng 1 `Tìm kiếm (8) + Rẻ hơn Google (4)`, hàng 2 `164 loại (4) + Geocode (4) + Dẫn đường (4)`, hàng 3 `Giao hàng (4) + Bốn SDK (4)` — hàng 3 còn trống 4 cột; đổi thẻ `Bốn SDK, một API` thành `span={8}` để hàng đủ 12.

- [x] **Step 8: `apps/site/src/pages/so-sanh/vietmap.astro`** — trong `KHI_NAO`, câu `'Bài toán của bạn là vận tải, theo dõi phương tiện hoặc tối ưu lộ trình đội xe.'` → `'Bài toán của bạn là theo dõi phương tiện hoặc tối ưu đội xe nhiều xe.'`. FAQ giữ nguyên.

- [x] **Step 9: Cập nhật e2e `apps/site/e2e/trang.spec.ts`**

Test `'bento sáu ô đúng thứ tự và mỗi ô có link tài liệu'` → đổi tên `'bento bảy ô đúng thứ tự…'`, mảng tiêu đề thêm `'Giao hàng & vận tải'` sau `'Dẫn đường'`, `toHaveCount(6)` → `toHaveCount(7)`. Test `'trang Tính năng: mục lục dính và sáu hàng…'` → `'…bảy hàng…'`, hai `toHaveCount(6)` → `toHaveCount(7)` (mục lục và `[data-bang-chung]`); `img` vẫn `toHaveCount(1)`.

- [x] **Step 10: Build site, test, e2e, lint, commit**

Run: `pnpm --filter @mapslibvn/site build && pnpm exec vitest run apps/site/src && pnpm lint:fix && pnpm lint`
Expected: build xanh; test site xanh (doi-dau, trang, seo, lien-ket-docs…); lint xanh.

Run e2e (Playwright cần trình duyệt đã cài; nếu chưa: `pnpm --filter @mapslibvn/site exec playwright install chromium`): `pnpm test:site-e2e`
Expected: PASS, kể cả hai test vừa đổi số.

```bash
git add apps/site/src/lib/doi-dau.ts apps/site/src/lib/doi-dau.test.ts apps/site/src/lib/trang.ts apps/site/src/pages/tinh-nang.astro apps/site/src/pages/index.astro apps/site/src/pages/so-sanh/vietmap.astro apps/site/e2e/trang.spec.ts
git commit -m "feat(site): mục Giao hàng & vận tải, thẻ bento ma trận, bảng đối đầu tách hàng, CHUA_CO còn bốn mục

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: DEVLOG, trạng thái spec, merge lần 2, deploy docs đè, ảnh nghiệm thu, publish SDK

**Files:**
- Modify: `docs/DEVLOG.md` (mục 33 mới), `docs/superpowers/specs/2026-09-22-ma-tran-toi-uu-thu-tu-design.md` (dòng Trạng thái), `packages/{core,web,react,react-native}/package.json` (version)
- Create: `docs/evidence/site-redesign/production/tinh-nang-giao-hang.png`, `docs/evidence/site-redesign/production/trang-chu-bay-the.png`

- [x] **Step 1: DEVLOG mục 33** — thêm cuối `docs/DEVLOG.md`, khuôn như mục 32:

```markdown
## 33. Ma trận khoảng cách và tối ưu thứ tự điểm dừng — <ngày>/09/2026

Spec `2026-09-22-ma-tran-toi-uu-thu-tu-design.md`, plan `2026-09-22-ma-tran-toi-uu-thu-tu.md`. Hai
endpoint `GET /v1/matrix` và `GET /v1/optimized-route` trên hai action Valhalla có sẵn
(`sources_to_targets`, `optimized_route`); không thêm dịch vụ, không đổi sổ quota, catalog hay DB.

**Một request = một lượt nhóm `directions`, bù bằng trần cỡ** (PHONG quyết 22/09): ≤ 100 cặp,
≤ 10 điểm dừng, chim bay 200/400/50 km theo mode, kiểm ở Worker trước khi tốn máy chủ. Đổi trần là
đổi cả docs và site cùng commit.

**Deploy trước, đo rồi mới công bố.** Endpoint sống trên production từ merge lần 1 nhưng không ghi ở
đâu cho tới khi `pnpm smoke:matrix` đạt ngưỡng (evidence `docs/evidence/routing/2026-09-<ngày>-matrix.md`):
p95 A/B/C = <số>/<số>/<số> ms; bài D: p95 directions lúc 5 ma trận chạy song song gấp <ratio> lần lúc
rảnh (ngưỡng 2). <Nếu có: quyết định hạ trần / tăng VALHALLA_THREADS và số đo lần 2.>

**Hình dạng response Valhalla đã xác minh trên graph Quận 1 trước khi viết mã:** ma trận trả
`time`/`distance` null cho cặp không nối, 400/154 khi vượt `max_matrix_distance`; `optimized_route` trả
`original_index`, chấp nhận round trip. Worker không đoán khi dữ liệu lệch: bảng sai cỡ hay `order`
không phải hoán vị → 503.

**Site:** `CHUA_CO` còn bốn mục; bảng đối đầu Google tách hàng cũ thành hàng hoà (ma trận + tối ưu một
xe) và hàng đối thủ thắng (đội xe nhiều xe); trang Tính năng có mục Giao hàng & vận tải, trang chủ
bảy thẻ. <Nếu nâng size-limit core: số cũ → mới.>

### Nghiệm thu

| Cổng | Kết quả |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | xanh |
| `pnpm test:routing` (ba file rtest) | xanh |
| CI sau merge lần 1: Deploy API, Routing tests, CI, DB tests, Deploy Docs | <kết quả> |
| Smoke production A–D | <tóm tắt> |
| Docs production có hai mục endpoint, playground còn khoá | <kết quả> |
| Site production: bảy thẻ, mục Giao hàng, bốn mục chưa có | ảnh `docs/evidence/site-redesign/production/tinh-nang-giao-hang.png`, `trang-chu-bay-the.png` |
| SDK bản minor mới trên npm, `client.matrix`/`client.optimizedRoute` trong `dist/index.d.ts` | <version> |
```

Thay mọi `<…>` bằng số thật trước khi commit.

- [x] **Step 2: Đổi trạng thái spec** — dòng `- Trạng thái: **Thiết kế đã duyệt…**` trong spec → `- Trạng thái: **Đã phát hành <ngày>/09/2026** — nghiệm thu mục 13 xem DEVLOG mục 33 và `docs/evidence/routing/2026-09-<ngày>-matrix.md``.

- [x] **Step 3: Bump version bốn SDK (minor)** — đọc version hiện tại: `grep '"version"' packages/core/package.json` (đang `0.12.1` lúc viết plan → `0.13.0`; nếu đã khác, lấy minor kế tiếp của số đang có):

```bash
for p in core web react react-native; do
  node -e "const f='packages/$p/package.json';const fs=require('node:fs');const j=JSON.parse(fs.readFileSync(f,'utf8'));j.version='0.13.0';fs.writeFileSync(f, JSON.stringify(j,null,2)+'\n')"
done
grep -h '"version"' packages/{core,web,react,react-native}/package.json
```

Expected: bốn dòng cùng `"version": "0.13.0"`. Kiểm các gói web/react/RN có `dependencies` trỏ `@mapslibvn/core` theo `workspace:*` (không ghi số) — `grep '"@mapslibvn/core"' packages/*/package.json`; nếu có số cứng, sửa cho khớp.

Không ghi số phiên bản vào docs (bài học `feedback-khong-ghi-version-cung-docs`).

- [x] **Step 4: Cổng lần cuối trên nhánh**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm sdk:publish --dry-run`
Expected: xanh; dry-run in `[npm-sdk] Kiểm tra release 0.13.0: @mapslibvn/core, @mapslibvn/web, @mapslibvn/react, @mapslibvn/react-native` và `Dry-run hoàn tất`.

```bash
git add docs/DEVLOG.md docs/superpowers/specs/2026-09-22-ma-tran-toi-uu-thu-tu-design.md packages/core/package.json packages/web/package.json packages/react/package.json packages/react-native/package.json
git commit -m "docs: DEVLOG mục 33 ma trận và tối ưu thứ tự; spec đã phát hành; SDK 0.13.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [x] **Step 5: Xin PHONG duyệt merge lần 2 + push + publish SDK.** Nêu rõ ba việc sẽ xảy ra: Deploy Docs và Deploy Site chạy trên CI; phải deploy docs đè ngay sau; `pnpm sdk:publish` đẩy 0.13.0 lên npm (không hoàn tác được).

- [x] **Step 6: Merge, push, theo dõi CI, deploy docs đè**

```bash
git checkout main && git pull --ff-only origin main
git merge --no-ff feat/ma-tran-toi-uu-thu-tu -m "feat: công bố ma trận khoảng cách và tối ưu thứ tự điểm dừng — docs, site, evidence, SDK 0.13.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
gh run list --limit 6
```

Chờ `Deploy Docs`, `Deploy Site`, `CI` xanh (`gh run watch <id>`), rồi: `pnpm deploy:docs` (hoặc PHONG `! pnpm deploy:docs`). Kiểm playground docs còn khoá (không 401).

- [x] **Step 7: Kiểm production site + docs**

```bash
curl -s https://mapslibvn-site.pages.dev/tinh-nang/ | grep -o 'Giao hàng &amp; vận tải\|Giao hàng & vận tải' | head -1
curl -s https://mapslibvn-site.pages.dev/tinh-nang/ | grep -c 'line-through'
curl -s https://mapslibvn-site.pages.dev/so-sanh/google-maps-api/ | grep -o 'Tối ưu đội xe nhiều xe' | head -1
curl -s https://mapslibvn-site.pages.dev/ | grep -o 'Bảy mảng đang chạy thật' | head -1
```

Expected: dòng 1 in tiêu đề mục; dòng 2 in `4` (bốn mục chưa có gạch ngang); dòng 3 và 4 in đúng chuỗi. Docs: mở `/api/#get-v1matrix` và `/api/#get-v1optimized-route` thấy hai mục.

- [x] **Step 8: Ảnh nghiệm thu production** — chụp bằng Playwright của site (đã cài ở Task 16):

```bash
node -e '
const { chromium } = require("./apps/site/node_modules/@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("https://mapslibvn-site.pages.dev/tinh-nang/#giao-hang", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/evidence/site-redesign/production/tinh-nang-giao-hang.png" });
  await page.goto("https://mapslibvn-site.pages.dev/#tt-tinh-nang", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/evidence/site-redesign/production/trang-chu-bay-the.png" });
  await browser.close();
})();
'
```

Expected: hai file PNG; mở xem bằng Read để xác nhận mục Giao hàng & vận tải và bảy thẻ hiện đúng.

- [x] **Step 9: Publish SDK (PHONG đã duyệt ở Step 5; cần đăng nhập npm)**

Run: `pnpm sdk:publish`
Expected: `[npm-sdk] Đã publish toàn bộ SDK version 0.13.0.` Kiểm: `npm view @mapslibvn/core version` → `0.13.0`; `npm view @mapslibvn/core dist.tarball` rồi `curl -sL <tarball> | tar -xzO package/dist/index.d.ts | grep -c 'optimizedRoute\|matrix'` ≥ 2.

- [x] **Step 10: Commit ảnh nghiệm thu, cập nhật DEVLOG bảng nghiệm thu với kết quả CI/production/npm thật, push**

```bash
git add docs/evidence/site-redesign/production/tinh-nang-giao-hang.png docs/evidence/site-redesign/production/trang-chu-bay-the.png docs/DEVLOG.md
git commit -m "docs: ảnh nghiệm thu production mục Giao hàng & vận tải và trang chủ bảy thẻ; DEVLOG kết quả CI/npm

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

Đợt push này lại kích Deploy Docs? Không: chỉ `docs/**` gốc và ảnh đổi, không khớp path filter của `deploy-docs.yml`/`deploy-site.yml`. Nếu có nhầm, deploy docs đè lần nữa.

- [x] **Step 11: Dọn nhánh**

```bash
git branch -d feat/ma-tran-toi-uu-thu-tu
```

Xong: `/v1/matrix` và `/v1/optimized-route` sống, đo được, có trong docs, site, SDK 0.13.0; `CHUA_CO` còn bốn mục; spec trạng thái "Đã phát hành".

---

## Tự soát plan (đã làm khi viết, 22/09/2026)

- **Phủ spec:** 4.1–4.2 (Task 5–10), 4.3 lỗi (Task 3, 6, 7, 9, 10), 4.4 cache (Task 1, 5, 8, 7, 10), 4.5 quota/burst (Task 7, 10 — dùng lại middleware), 4.6 hằng số (Task 1, 5, 8, 3), 4.7 cấu trúc mã (Task 1–3), 5 core (Task 4), 6 đo (Task 12–14), 7 kiểm thử (Task 1–12), 8 docs (Task 15), 9 site (Task 16), 10 thứ tự phát hành (Task 13, 14, 17), 13 nghiệm thu (Task 13, 14, 17).
- **Kiểu nhất quán:** `callValhalla<T>(env, path, body, options)`; `parseMatrixParams`/`matrixBody`/`matrixCacheUrl`/`translateMatrix`; `parseOptimizedParams`/`optimizedBody`/`optimizedCacheUrl`/`translateOptimized`; `graphBuiltAt`/`builtAtIso` ở `routing/graph.ts`; `MATRIX_TIMEOUT_MS`, `VALHALLA_LANGUAGE`, `ValhallaMatrixResponse` ở `routing/valhalla.ts`; `parseLatLngList`, `assertInVietnam`, `cacheKeyPoints`, `requirePair`, `oneOf`, `MATRIX_MAX_CROW_DISTANCE_M` ở `routing/params.ts`; core `MatrixOptions`, `MatrixResponse`, `OptimizedRouteOptions`, `OptimizedRouteResponse`, `client.matrix`, `client.optimizedRoute`.
- **Chỗ phụ thuộc số đo:** Task 14 quyết trần; Task 15–16 chép số đó. Nếu hạ trần, danh sách test phải đổi nằm ở Task 14 Step 4.
