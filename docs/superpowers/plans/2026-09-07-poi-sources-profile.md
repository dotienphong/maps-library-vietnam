# Bật/tắt nguồn POI theo profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người tích hợp chọn tập nguồn POI (`osm` | `overture` | `fsq`) một lần khi khởi tạo SDK; bản đồ dùng archive tile build riêng cho tập đó và Places API lọc cùng tập. Mặc định là **cả ba nguồn** (`all`) ở mọi bề mặt — giữ đúng hành vi hiện tại.

**Architecture:** Hằng `POI_SOURCE_PROFILES` ở `@mapslibvn/core` là nguồn sự thật duy nhất cho API, SDK và pipeline. Pipeline export thêm archive `poi-osm-YYYYMMDD.pmtiles` (lưới progressive chạy lại trên riêng tập OSM) và manifest KV có `poiProfiles.osm`. API nhận `sources=` trên `search/nearby/autocomplete/reverse/styles`; style trả archive theo profile, fallback `all` khi profile chưa publish. POI `created_by='user'` luôn có mặt.

**Tech Stack:** TypeScript (Hono trên Cloudflare Workers, postgres.js, vitest + `@cloudflare/vitest-pool-workers`), Node ESM `.mjs` cho pipeline (tippecanoe, rclone, wrangler KV), MapLibre GL JS / maplibre-react-native.

**Spec:** `docs/superpowers/specs/2026-09-07-poi-sources-profile-design.md`

**Quy ước chung cho mọi task**
- Chạy lệnh từ gốc repo. Test unit: `pnpm vitest run <file>`; test API: `pnpm --filter @mapslibvn/api test`; typecheck toàn repo: `pnpm typecheck`; lint: `pnpm lint` (biome). Trước khi commit một task: `pnpm lint && pnpm typecheck`.
- `exactOptionalPropertyTypes` đang bật: không gán `undefined` vào thuộc tính tuỳ chọn — dùng spread có điều kiện `...(x ? { x } : {})`.
- Test tầng API **không được cần Postgres** (Hyperdrive trỏ cổng đóng): test route chỉ kiểm auth/validate → 400, còn request hợp lệ → 503. SQL kiểm bằng `test/helpers/fake-sql.ts`.
- Commit message tiếng Việt, tiền tố `feat/fix/test/docs/chore(scope)`.

---

## Task 1: Đo trước khi chốt mặc định (cổng, không có code) — ✅ XONG 07/09/2026

**Kết quả:** OSM 7,0 % (106.325), Overture 77,1 % (1.174.282), FSQ 15,9 % (241.809);
`multiSourcePct` 3,3 %. Cổng ≥ 40 % **KHÔNG ĐẠT** → PHONG quyết **đảo mặc định thành `all`**, vẫn
giao profile `osm` như tuỳ chọn. Bằng chứng: `docs/evidence/poi-sources/do-truoc-primary-source.md`
(commit `9853b97`). Mọi task dưới đây đã theo mặc định `all`.

Spec mục 9 nghiệm thu 1. Máy dev không có `psql`/`cloudflared`; dùng báo cáo `report.mjs` đã nằm trên R2 (`bySource` đếm theo `primary_source`).

**Files:** không sửa code. Ghi kết quả vào `docs/evidence/poi-sources/do-truoc-primary-source.md` (tạo mới).

- [ ] **Step 1: Lấy tên báo cáo mới nhất trên R2**

Run:
```bash
docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline \
  sh -c 'rclone lsf r2:$R2_BUCKET/state/reports/ --files-only | sort | tail -1'
```
Expected: một dòng dạng `poi-report-20260907.json`.

- [ ] **Step 2: Đọc báo cáo và tính tỷ lệ**

Run (thay `<FILE>` bằng tên ở bước 1):
```bash
docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline \
  sh -c 'rclone cat r2:$R2_BUCKET/state/reports/<FILE>' > /tmp/poi-report.json
node -e '
const r = JSON.parse(require("fs").readFileSync("/tmp/poi-report.json","utf8"));
const total = r.bySource.reduce((s, x) => s + x.n, 0);
for (const x of r.bySource) console.log(x.source ?? "user/null", x.n, (100*x.n/total).toFixed(1)+"%");
console.log("active:", r.poi.active, "total:", r.poi.total);
'
```
Expected: ba dòng `osm/overture/fsq` (và có thể `user/null`) với phần trăm.

- [ ] **Step 3: Quyết định cổng**

Nếu `osm` **≥ 40 %** tổng → tiếp tục plan, mặc định `osm` giữ nguyên.
Nếu **< 40 %** → DỪNG plan, báo PHONG kèm số liệu; không tự đổi mặc định (spec mục 9).

(Thực tế: 7,0 % → đã dừng và PHONG chọn đảo mặc định thành `all`.)

- [ ] **Step 4: Ghi bằng chứng**

Tạo `docs/evidence/poi-sources/do-truoc-primary-source.md`:
```markdown
# Đo trước — phân bố `primary_source` trên production

Ngày đo: <YYYY-MM-DD>. Nguồn: `state/reports/<FILE>` trên R2 (report.mjs, đếm mọi status).

| primary_source | n | % |
|---|---:|---:|
| osm | … | … |
| overture | … | … |
| fsq | … | … |

POI active: …; tổng: ….

Kết luận cổng (≥ 40 % OSM): ĐẠT / KHÔNG ĐẠT → mặc định `osm` giữ / cần PHONG quyết.
```

- [ ] **Step 5: Commit**

```bash
git add docs/evidence/poi-sources/do-truoc-primary-source.md
git commit -m "docs(evidence): đo phân bố primary_source trước khi chốt mặc định nguồn POI"
```

---

## Task 2: `@mapslibvn/core` — hằng profile và hàm chuẩn hoá nguồn

**Files:**
- Create: `packages/core/src/poi-sources.ts`
- Create: `packages/core/src/poi-sources.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Viết test đỏ**

`packages/core/src/poi-sources.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POI_SOURCES,
  POI_SOURCE_PROFILES,
  normalizePoiSources,
  parsePoiSourcesCsv,
  poiSourceClause,
  poiSourcesKey,
  profileForSources,
} from './poi-sources';

describe('poi-sources', () => {
  it('mặc định là profile all (cả ba nguồn)', () => {
    expect(DEFAULT_POI_SOURCES).toEqual(['osm', 'overture', 'fsq']);
    expect(POI_SOURCE_PROFILES.all).toEqual(['osm', 'overture', 'fsq']);
    expect(POI_SOURCE_PROFILES.osm).toEqual(['osm']);
  });

  it('normalizePoiSources: bỏ trùng, sắp theo thứ tự chuẩn, sai → null', () => {
    expect(normalizePoiSources(['fsq', 'osm', 'osm'])).toEqual(['osm', 'fsq']);
    expect(normalizePoiSources([])).toBeNull();
    expect(normalizePoiSources(['osm', 'banana'])).toBeNull();
  });

  it('parsePoiSourcesCsv: rỗng → mặc định cả ba; all → cả ba; lạ → null', () => {
    expect(parsePoiSourcesCsv(undefined)).toEqual(['osm', 'overture', 'fsq']);
    expect(parsePoiSourcesCsv('')).toEqual(['osm', 'overture', 'fsq']);
    expect(parsePoiSourcesCsv('all')).toEqual(['osm', 'overture', 'fsq']);
    expect(parsePoiSourcesCsv('osm')).toEqual(['osm']);
    expect(parsePoiSourcesCsv(' overture , osm ')).toEqual(['osm', 'overture']);
    expect(parsePoiSourcesCsv('osm,banana')).toBeNull();
  });

  it('poiSourcesKey ổn định theo thứ tự chuẩn', () => {
    expect(poiSourcesKey(['fsq', 'osm'])).toBe('osm,fsq');
  });

  it('profileForSources: chỉ tập có archive mới có profile', () => {
    expect(profileForSources(['osm'])).toBe('osm');
    expect(profileForSources(['fsq', 'overture', 'osm'])).toBe('all');
    expect(profileForSources(['osm', 'overture'])).toBeNull();
  });

  it('poiSourceClause giữ POI người dùng bất kể nguồn', () => {
    expect(poiSourceClause('$1::text[]')).toBe(
      "(p.primary_source = ANY($1::text[]) OR p.created_by = 'user')",
    );
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm vitest run packages/core/src/poi-sources.test.ts`
Expected: FAIL — `Failed to resolve import "./poi-sources"`.

- [ ] **Step 3: Viết implementation**

`packages/core/src/poi-sources.ts`:
```ts
/**
 * Nguồn POI và profile archive (spec 07/09 mục 4). Đây là nguồn sự thật duy nhất cho API, SDK và
 * pipeline: thêm profile mới = thêm một dòng vào POI_SOURCE_PROFILES + một lần export-tiles.
 */
export const POI_SOURCES = ['osm', 'overture', 'fsq'] as const;
export type PoiSource = (typeof POI_SOURCES)[number];

export type PoiSourceProfile = 'osm' | 'all';
export const POI_SOURCE_PROFILES: Readonly<Record<PoiSourceProfile, readonly PoiSource[]>> = {
  osm: ['osm'],
  all: ['osm', 'overture', 'fsq'],
};

/**
 * Mặc định ở mọi bề mặt (REST và SDK): cả ba nguồn, tức đúng hành vi trước khi có tuỳ chọn này.
 * Đo 07/09/2026 cho thấy OSM chỉ là nguồn chính của 7 % POI, nên mặc định `osm` sẽ làm bản đồ mất
 * ~93 % dữ liệu (`docs/evidence/poi-sources/do-truoc-primary-source.md`).
 */
export const DEFAULT_POI_SOURCES: readonly PoiSource[] = POI_SOURCE_PROFILES.all;

const isPoiSource = (value: string): value is PoiSource =>
  (POI_SOURCES as readonly string[]).includes(value);

/** Bỏ trùng, sắp theo thứ tự POI_SOURCES. Rỗng hoặc có giá trị lạ → null. */
export function normalizePoiSources(list: readonly string[]): PoiSource[] | null {
  if (list.length === 0 || !list.every(isPoiSource)) return null;
  const set = new Set<string>(list);
  return POI_SOURCES.filter((source) => set.has(source));
}

/**
 * Chuỗi `sources=` của REST và thuộc tính `sources` của web component: phân cách dấu phẩy,
 * `all` là bí danh cả ba; undefined/rỗng → mặc định; giá trị lạ → null (caller quyết định lỗi).
 */
export function parsePoiSourcesCsv(raw: string | undefined | null): PoiSource[] | null {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return [...DEFAULT_POI_SOURCES];
  if (trimmed === 'all') return [...POI_SOURCE_PROFILES.all];
  return normalizePoiSources(trimmed.split(',').map((part) => part.trim()));
}

/** Khoá ổn định cho cache key và query string. */
export function poiSourcesKey(sources: readonly PoiSource[]): string {
  return (normalizePoiSources(sources) ?? []).join(',');
}

/** Tập nguồn → profile có archive; null nếu chưa build tổ hợp đó. */
export function profileForSources(sources: readonly PoiSource[]): PoiSourceProfile | null {
  const key = poiSourcesKey(sources);
  for (const [profile, list] of Object.entries(POI_SOURCE_PROFILES)) {
    if (list.join(',') === key) return profile as PoiSourceProfile;
  }
  return null;
}

/**
 * Mệnh đề lọc dùng chung cho export-tiles và Places API; bảng `poi` phải có alias `p`.
 * `arrayExpr` là biểu thức text[]: `$1::text[]` (postgres.js) hoặc `ARRAY['osm']::text[]` (pipeline).
 * POI người dùng tạo có primary_source NULL và luôn được giữ.
 */
export function poiSourceClause(arrayExpr: string): string {
  return `(p.primary_source = ANY(${arrayExpr}) OR p.created_by = 'user')`;
}
```

Thêm vào cuối `packages/core/src/index.ts`:
```ts
export * from './poi-sources';
```

- [ ] **Step 4: Chạy test xanh + build core**

Run: `pnpm vitest run packages/core/src/poi-sources.test.ts && pnpm --filter @mapslibvn/core build`
Expected: 6 tests PASS; build xong, `size-limit` không báo vượt.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/poi-sources.ts packages/core/src/poi-sources.test.ts packages/core/src/index.ts
git commit -m "feat(core): hằng profile nguồn POI và hàm chuẩn hoá sources"
```

---

## Task 3: `@mapslibvn/core` client — `poiSources` gắn `sources=` vào mọi request

**Files:**
- Modify: `packages/core/src/client.ts`
- Modify: `packages/core/src/client.test.ts`

- [ ] **Step 1: Sửa test hiện có và thêm test đỏ**

Trong `packages/core/src/client.test.ts`, test `'styleUrl mang theme và key'` đổi kỳ vọng:
```ts
    expect(client.styleUrl('dark')).toBe(
      'https://api.example.test/v1/styles/dark.json?key=k%201&sources=osm%2Coverture%2Cfsq',
    );
```
Thêm cuối `describe('createClient', …)`:
```ts
  it('poiSources mặc định: autocomplete/search/nearby/reverse đều gửi cả ba nguồn', async () => {
    const fetch = okFetch({ items: [] });
    const client = createClient({ apiKey: 'k', baseUrl: 'https://api.example.test', fetch });
    await client.autocomplete('pho');
    await client.search('pho');
    await client.nearby({ lat: 10.7, lng: 106.7 });
    await client.reverse(10.7, 106.7);
    for (const call of fetch.mock.calls) {
      const url = (call as unknown as [URL])[0];
      expect(url.searchParams.get('sources')).toBe('osm,overture,fsq');
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('poiSources tuỳ chọn được chuẩn hoá thứ tự; styleUrl và geocode/getPlace không lệch', async () => {
    const fetch = okFetch({ items: [] });
    const client = createClient({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      fetch,
      poiSources: ['fsq', 'osm'],
    });
    await client.search('pho');
    expect((fetch.mock.calls[0] as unknown as [URL])[0].searchParams.get('sources')).toBe(
      'osm,fsq',
    );
    expect(client.styleUrl('light')).toBe(
      'https://api.example.test/v1/styles/light.json?key=k&sources=osm%2Cfsq',
    );
    await client.geocode('12 nguyen hue');
    expect((fetch.mock.calls[1] as unknown as [URL])[0].searchParams.has('sources')).toBe(false);
  });

  it('poiSources rỗng hoặc lạ → ném Error lúc tạo client', () => {
    expect(() =>
      createClient({ apiKey: 'k', baseUrl: 'https://x', poiSources: [] }),
    ).toThrowError(/poiSources/);
    expect(() =>
      createClient({
        apiKey: 'k',
        baseUrl: 'https://x',
        poiSources: ['banana' as unknown as 'osm'],
      }),
    ).toThrowError(/poiSources/);
  });
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm vitest run packages/core/src/client.test.ts`
Expected: FAIL — `styleUrl` thiếu `&sources=…`; `searchParams.get('sources')` là `null`; không ném lỗi.

- [ ] **Step 3: Implement**

Trong `packages/core/src/client.ts`:

Import thêm (đầu file):
```ts
import {
  DEFAULT_POI_SOURCES,
  type PoiSource,
  normalizePoiSources,
  poiSourcesKey,
} from './poi-sources';
```

Thêm vào `ClientOptions` (sau `headers?`):
```ts
  /**
   * Tập nguồn POI cho bản đồ và Places API (spec 07/09). Mặc định cả ba nguồn.
   * Áp cho autocomplete/search/nearby/reverse và `styleUrl`; `getPlace`/`geocode` không lọc.
   */
  poiSources?: readonly PoiSource[];
```

Trong `createClient`, ngay sau `const baseUrl = …`:
```ts
  const poiSources = normalizePoiSources(options.poiSources ?? DEFAULT_POI_SOURCES);
  if (!poiSources) {
    throw new Error(`poiSources không hợp lệ: ${JSON.stringify(options.poiSources)}`);
  }
  const sources = poiSourcesKey(poiSources);
```

Đổi các phương thức trong object trả về:
```ts
    styleUrl: (theme: Theme) =>
      `${baseUrl}/v1/styles/${theme}.json?key=${encodeURIComponent(options.apiKey)}&sources=${encodeURIComponent(sources)}`,
```
`autocomplete`: thêm `sources,` vào object params của `get('/v1/autocomplete', { q, near, limit, types, sources })`.
`search`: thêm `sources,` vào params.
`nearby`: thêm `sources,` vào params.
`reverse`: `get<ReverseResponse>('/v1/reverse', { lat, lng, sources })`.
`geocode`, `getPlace`, `attribution`, `suggestEdit`: không đổi.

- [ ] **Step 4: Chạy test xanh**

Run: `pnpm vitest run packages/core/src/client.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/client.ts packages/core/src/client.test.ts
git commit -m "feat(core): client nhận poiSources, gắn sources= cho Places API và styleUrl"
```

---

## Task 4: API — `parseSources` và fragment lọc `poiSourceFilter`

**Files:**
- Modify: `apps/api/src/params.ts`
- Create: `apps/api/src/poi-sources.ts`
- Modify: `apps/api/test/params.test.ts`
- Create: `apps/api/test/poi-sources.test.ts`

- [ ] **Step 1: Test đỏ**

Thêm vào `apps/api/test/params.test.ts` (import thêm `parseSources`):
```ts
  it('parseSources: mặc định cả ba, all → ba nguồn, chuẩn hoá thứ tự, lạ → 400', () => {
    expect(parseSources(undefined)).toEqual(['osm', 'overture', 'fsq']);
    expect(parseSources('')).toEqual(['osm', 'overture', 'fsq']);
    expect(parseSources('osm')).toEqual(['osm']);
    expect(parseSources('all')).toEqual(['osm', 'overture', 'fsq']);
    expect(parseSources('fsq,osm')).toEqual(['osm', 'fsq']);
    expect(() => parseSources('osm,banana')).toThrowError(ApiError);
    expect(() => parseSources(',')).toThrowError(ApiError);
  });
```

Tạo `apps/api/test/poi-sources.test.ts`:
```ts
import { poiSourceClause } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import { poiSourceFilter } from '../src/poi-sources';
import { fakeSql } from './helpers/fake-sql';

describe('poiSourceFilter', () => {
  it('sinh đúng mệnh đề dùng chung của core với tham số text[]', async () => {
    const { sql, calls } = fakeSql([]);
    await sql`SELECT 1 FROM poi p WHERE p.status = 'active' AND ${poiSourceFilter(sql, ['osm'])}`;
    // fakeSql ghi cả fragment lồng vào `calls`, nên lấy câu SELECT ngoài cùng.
    const query = calls.find((call) => call.text.startsWith('SELECT'));
    expect(query?.text).toBe(
      `SELECT 1 FROM poi p WHERE p.status = 'active' AND ${poiSourceClause('$1::text[]')}`,
    );
    expect(query?.params).toEqual([['osm']]);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api test -- params poi-sources`
Expected: FAIL — `parseSources` không export; `../src/poi-sources` không tồn tại.

- [ ] **Step 3: Implement**

`apps/api/src/params.ts` — import và hàm mới:
```ts
import { type PoiSource, parsePoiSourcesCsv } from '@mapslibvn/core';
```
```ts
/** `sources=osm,overture,fsq` | `all`; rỗng → mặc định cả ba nguồn (spec 07/09 mục 6.1). */
export function parseSources(raw: string | undefined): PoiSource[] {
  const sources = parsePoiSourcesCsv(raw);
  if (!sources) {
    throw new ApiError(400, 'invalid_request', 'sources chỉ nhận osm,overture,fsq,all');
  }
  return sources;
}
```

`apps/api/src/poi-sources.ts`:
```ts
import type { PoiSource } from '@mapslibvn/core';
import type { getSql } from './db';

type Sql = ReturnType<typeof getSql>;

/**
 * Fragment lọc theo nguồn cho mọi truy vấn đọc `poi` (alias bắt buộc là `p`). Văn bản phải khớp
 * `poiSourceClause('$n::text[]')` của core — test `poi-sources.test.ts` khoá điều đó để pipeline và
 * API không lệch nhau. POI người dùng (`created_by='user'`, primary_source NULL) luôn được giữ.
 */
export function poiSourceFilter(sql: Sql, sources: readonly PoiSource[]) {
  return sql`(p.primary_source = ANY(${[...sources]}::text[]) OR p.created_by = 'user')`;
}
```

- [ ] **Step 4: Chạy xanh**

Run: `pnpm --filter @mapslibvn/api test -- params poi-sources`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/params.ts apps/api/src/poi-sources.ts apps/api/test/params.test.ts apps/api/test/poi-sources.test.ts
git commit -m "feat(api): parseSources và fragment lọc primary_source dùng chung"
```

---

## Task 5: API — áp `sources` cho `/v1/search`, `/v1/nearby`, `/v1/reverse`

**Files:**
- Modify: `apps/api/src/routes/search.ts`
- Modify: `apps/api/src/routes/nearby.ts`
- Modify: `apps/api/src/routes/reverse.ts`
- Modify: `apps/api/test/places-routes.test.ts`
- Modify: `apps/api/test/geocode-routes.test.ts` (reverse validate)

- [ ] **Step 1: Test đỏ (validate, không DB)**

Thêm vào `describe('validation search/nearby/places (không DB)')` trong `apps/api/test/places-routes.test.ts`:
```ts
  it('sources lạ → 400 ở search và nearby; sources hợp lệ đi tới DB → 503', async () => {
    expect((await fetchApi('/v1/search?q=pho&sources=banana')).status).toBe(400);
    expect((await fetchApi('/v1/nearby?lat=10.77&lng=106.70&sources=banana')).status).toBe(400);
    expect((await fetchApi('/v1/search?q=pho&sources=all')).status).toBe(503);
    expect((await fetchApi('/v1/nearby?lat=10.77&lng=106.70&sources=osm,fsq')).status).toBe(503);
  });
```
Thêm vào `apps/api/test/geocode-routes.test.ts` (dùng cùng khuôn `fetchApi` của file đó; nếu file chưa có helper thì sao chép khối `KEY`/`beforeAll`/`fetchApi` từ `places-routes.test.ts`):
```ts
  it('reverse: sources lạ → 400; hợp lệ → 503 (DB đóng)', async () => {
    expect((await fetchApi('/v1/reverse?lat=10.77&lng=106.70&sources=banana')).status).toBe(400);
    expect((await fetchApi('/v1/reverse?lat=10.77&lng=106.70&sources=osm')).status).toBe(503);
  });
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api test -- places-routes geocode-routes`
Expected: FAIL — `sources=banana` hiện trả 503 thay vì 400.

- [ ] **Step 3: Implement**

`search.ts`: import `parseSources` từ `'../params'` (thêm vào import có sẵn) và `import { poiSourceFilter } from '../poi-sources';`. Sau `const offset = …`:
```ts
  const sources = parseSources(c.req.query('sources'));
```
Trong SQL, ngay sau `WHERE p.status = 'active'`:
```ts
        AND ${poiSourceFilter(sql, sources)}
```

`nearby.ts`: import `parseSources` (bổ sung vào `import { clampInt } from '../params'`) và `poiSourceFilter`. Sau `const category = …`:
```ts
  const sources = parseSources(c.req.query('sources'));
```
Trong SQL sau `WHERE p.status = 'active'`:
```ts
        AND ${poiSourceFilter(sql, sources)}
```

`reverse.ts`: thêm `import { parseSources } from '../params';` và `import { poiSourceFilter } from '../poi-sources';`. Sau khối validate lat/lng:
```ts
  const sources = parseSources(c.req.query('sources'));
```
Trong truy vấn `poiRow`, sau `WHERE p.status = 'active'`:
```ts
        AND ${poiSourceFilter(sql, sources)}
```

- [ ] **Step 4: Chạy xanh**

Run: `pnpm --filter @mapslibvn/api test`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/search.ts apps/api/src/routes/nearby.ts apps/api/src/routes/reverse.ts apps/api/test/places-routes.test.ts apps/api/test/geocode-routes.test.ts
git commit -m "feat(api): search/nearby/reverse lọc POI theo sources (mặc định cả ba nguồn)"
```

---

## Task 6: API — autocomplete lọc nhánh `poi` và cache key theo nguồn

**Files:**
- Modify: `apps/api/src/autocomplete-sql.ts`
- Modify: `apps/api/src/routes/autocomplete.ts`
- Modify: `apps/api/test/autocomplete-sql.test.ts`
- Modify: `apps/api/test/autocomplete.test.ts`

- [ ] **Step 1: Test đỏ**

`apps/api/test/autocomplete-sql.test.ts`: thêm `sources: ['osm']` vào hằng `input` (sau `parsed: …`), và thêm test:
```ts
  it('poi: lọc theo sources với alias p, giữ POI người dùng', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, { ...shortInput, sources: ['osm', 'fsq'] });
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(query?.text).toContain('FROM poi p');
    expect(query?.text).toMatch(/p\.primary_source = ANY\(\$\d+::text\[\]\) OR p\.created_by = 'user'/);
    expect(query?.params).toEqual(expect.arrayContaining([['osm', 'fsq']]));
  });
```
`apps/api/test/autocomplete.test.ts`: đổi test cache key thành:
```ts
  it('cache key có version shape nguồn và khoá sources', () => {
    const url = autocompleteCacheUrl({
      queryNorm: 'quan 10',
      grid: '-',
      typeKey: 'area',
      sourceKey: 'osm_fsq',
      limit: 10,
    });
    expect(url).toContain('?v=src1&');
    expect(url).toContain('&s=osm_fsq&');
  });
```
và trong test `'q < 2 ký tự → 400; …'` thêm `'q=highlands&sources=banana'` vào mảng query.

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api test -- autocomplete`
Expected: FAIL — typecheck `sources` không có trong `CandidateQueryInput`; cache key thiếu `s=`.

- [ ] **Step 3: Implement**

`autocomplete-sql.ts`:
```ts
import type { ParsedAddress, PoiSource } from '@mapslibvn/core';
import { poiSourceFilter } from './poi-sources';
```
Thêm vào `CandidateQueryInput`:
```ts
  /** Tập nguồn POI (spec 07/09); chỉ nhánh `poi` dùng. */
  sources: readonly PoiSource[];
```
Trong `poiCandidates`, destructure thêm `sources` và đổi phần FROM/WHERE:
```ts
    FROM poi p
    WHERE status = 'active'
      AND ${poiSourceFilter(sql, sources)}
      AND (
```
(giữ nguyên phần còn lại; các cột không tiền tố vẫn hợp lệ với alias `p`.)

`routes/autocomplete.ts`:
```ts
import { poiSourcesKey } from '@mapslibvn/core';
import { clampInt, parseLatLngPair, parseSources, parseTypes } from '../params';
```
`autocompleteCacheUrl` thêm `sourceKey: string` vào input và đổi chuỗi:
```ts
  `https://cache.mapslibvn/autocomplete?v=src1&qn=${encodeURIComponent(input.queryNorm)}&g=${input.grid}&t=${input.typeKey}&s=${input.sourceKey}&l=${input.limit}`;
```
Trong handler, sau `const types = …`:
```ts
  const sources = parseSources(c.req.query('sources'));
```
Sau `const typeKey = …`:
```ts
  const sourceKey = poiSourcesKey(sources).replace(/,/g, '_');
  const cacheUrl = autocompleteCacheUrl({ queryNorm, grid, typeKey, sourceKey, limit });
```
Truyền vào `collectCandidates`: `{ queryNorm, queryCore, prefixPattern, near, parsed, sources }`.

Cập nhật chú thích cache: `// Cache 10 phút theo (q_norm, lưới near, types, sources, limit); stale-if-error 1 giờ.`

- [ ] **Step 4: Chạy xanh + typecheck**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS; không lỗi TS (mọi nơi tạo `CandidateQueryInput` đã có `sources`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/autocomplete-sql.ts apps/api/src/routes/autocomplete.ts apps/api/test/autocomplete-sql.test.ts apps/api/test/autocomplete.test.ts
git commit -m "feat(api): autocomplete lọc poi theo sources, cache key v=src1"
```

---

## Task 7: API — manifest `poiProfiles`, style theo profile (fallback `all`), tiles set `poi-osm`

**Files:**
- Modify: `apps/api/src/manifest.ts`
- Modify: `apps/api/src/style.ts`
- Modify: `apps/api/src/routes/styles.ts`
- Modify: `apps/api/src/routes/tiles.ts`
- Modify: `apps/api/test/styles.test.ts`
- Modify: `apps/api/test/tiles.test.ts`

- [ ] **Step 1: Test đỏ**

Thêm vào `describe('GET /v1/styles/:theme.json')` trong `apps/api/test/styles.test.ts`:
```ts
  it('mặc định (không có sources) → profile all, không fallback', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({ vn: 'vn-20260826', poi: 'poi-20260901' }),
    );
    const res = await SELF.fetch('https://api/v1/styles/light.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-poi-profile')).toBe('all');
    const style = (await res.json()) as { sources: Record<string, { url?: string }> };
    expect(style.sources.poi?.url).toBe('pmtiles://https://tiles.test/tiles/poi-20260901.pmtiles');
  });

  it('sources=osm nhưng manifest chưa có profile → dùng archive all + header fallback', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({ vn: 'vn-20260826', poi: 'poi-20260901' }),
    );
    const res = await SELF.fetch('https://api/v1/styles/light.json?sources=osm');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-poi-profile')).toBe('all;fallback');
    const style = (await res.json()) as { sources: Record<string, { url?: string }> };
    expect(style.sources.poi?.url).toBe('pmtiles://https://tiles.test/tiles/poi-20260901.pmtiles');
  });

  it('manifest có poiProfiles.osm → archive osm; sources=all → archive all', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({
        vn: 'vn-20260826',
        poi: 'poi-20260901',
        poiProfiles: { osm: 'poi-osm-20260901' },
      }),
    );
    const osm = await SELF.fetch('https://api/v1/styles/light.json?sources=osm');
    expect(osm.headers.get('x-poi-profile')).toBe('osm');
    const osmStyle = (await osm.json()) as { sources: Record<string, { url?: string }> };
    expect(osmStyle.sources.poi?.url).toBe(
      'pmtiles://https://tiles.test/tiles/poi-osm-20260901.pmtiles',
    );
    const all = await SELF.fetch('https://api/v1/styles/light.json?sources=all');
    expect(all.headers.get('x-poi-profile')).toBe('all');
    const allStyle = (await all.json()) as { sources: Record<string, { url?: string }> };
    expect(allStyle.sources.poi?.url).toBe('pmtiles://https://tiles.test/tiles/poi-20260901.pmtiles');
  });

  it('tập nguồn chưa có profile → 400 kèm danh sách profile; giá trị lạ → 400', async () => {
    const res = await SELF.fetch('https://api/v1/styles/light.json?sources=osm,overture');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toContain('osm,overture,fsq');
    expect((await SELF.fetch('https://api/v1/styles/light.json?sources=banana')).status).toBe(400);
  });
```
Thêm vào `apps/api/test/tiles.test.ts`:
```ts
  it('set poi-osm đọc manifest.poiProfiles.osm; thiếu → 404', async () => {
    await env.META.put(
      'release:current',
      JSON.stringify({ vn: 'vn-20260826', poi: 'poi-20260901' }),
    );
    const missing = await SELF.fetch('https://api/v1/tiles/poi-osm/10/815/483.pbf');
    expect(missing.status).toBe(404);
    await env.META.put(
      'release:current',
      JSON.stringify({
        vn: 'vn-20260826',
        poi: 'poi-20260901',
        poiProfiles: { osm: 'poi-osm-20260901' },
      }),
    );
    // Có release nhưng R2 local trống → lỗi đọc archive, không phải 404 "chưa phát hành".
    const present = await SELF.fetch('https://api/v1/tiles/poi-osm.json');
    expect(present.status).not.toBe(404);
  });
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api test -- styles tiles`
Expected: FAIL — không có header `x-poi-profile`; `sources=osm,overture` trả 200; set `poi-osm` trả 404 "Không có bộ tiles".

- [ ] **Step 3: Implement**

`apps/api/src/manifest.ts`:
```ts
import type { PoiSourceProfile } from '@mapslibvn/core';
import type { Env } from './env';
import { ApiError } from './errors';

export interface Manifest {
  vn: string | null;
  /** Archive POI profile `all` (giữ tên cũ để tương thích). */
  poi: string | null;
  /** Archive theo profile khác `all` (spec 07/09 mục 5.3). */
  poiProfiles?: Partial<Record<Exclude<PoiSourceProfile, 'all'>, string | null>>;
  updatedAt?: string;
}

export async function getManifest(env: Env): Promise<Manifest> {
  const m = await env.META.get<Manifest>('release:current', { type: 'json', cacheTtl: 60 });
  if (!m?.vn)
    throw new ApiError(503, 'upstream_unavailable', 'Chưa có phiên bản tiles (release:current)');
  return m;
}

/**
 * Archive POI cho profile. Profile chưa publish → dùng `all` và đánh dấu fallback (khoảng giữa
 * deploy code và publish dữ liệu không được làm bản đồ chết).
 */
export function poiReleaseFor(
  m: Manifest,
  profile: PoiSourceProfile,
): { release: string | null; fallback: boolean } {
  if (profile === 'all') return { release: m.poi, fallback: false };
  const release = m.poiProfiles?.[profile] ?? null;
  return release ? { release, fallback: false } : { release: m.poi, fallback: Boolean(m.poi) };
}
```

`apps/api/src/style.ts` — `renderStyle` đổi chữ ký và trả thêm profile:
```ts
import type { PoiSourceProfile } from '@mapslibvn/core';
import { fillTemplate } from '@mapslibvn/style';
import dark from '@mapslibvn/style/templates/dark';
import light from '@mapslibvn/style/templates/light';
import { type Manifest, poiReleaseFor } from './manifest';
```
```ts
export interface RenderedStyle {
  body: string;
  /** Giá trị header `x-poi-profile`: `osm`, `all` hoặc `all;fallback`. */
  profileHeader: string;
}

export function renderStyle(
  theme: Theme,
  manifest: Manifest,
  tilesBase: string,
  profile: PoiSourceProfile = 'all',
): RenderedStyle {
  const poi = poiReleaseFor(manifest, profile);
  const profileHeader = poi.fallback ? 'all;fallback' : profile;
  if (poi.fallback) console.warn(`style: profile ${profile} chưa publish, dùng archive all`);
  const filled = fillTemplate(TEMPLATES[theme], {
    TILES_BASE: tilesBase.replace(/\/+$/, ''),
    VN_FILE: manifest.vn ?? '',
    POI_FILE: poi.release ?? '',
  });
  if (poi.release) return { body: filled, profileHeader };
  // Chưa có bản POI: bỏ nguồn + lớp poi để MapLibre không tải file rỗng
  const style = JSON.parse(filled) as {
    sources: Record<string, unknown>;
    layers: { source?: string }[];
  };
  const { poi: _dropped, ...sources } = style.sources;
  return {
    body: JSON.stringify({ ...style, sources, layers: style.layers.filter((l) => l.source !== 'poi') }),
    profileHeader,
  };
}
```

`apps/api/src/routes/styles.ts`:
```ts
import { POI_SOURCE_PROFILES, profileForSources } from '@mapslibvn/core';
import { Hono } from 'hono';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { getManifest } from '../manifest';
import { parseSources } from '../params';
import { isTheme, renderStyle } from '../style';

export const styles = new Hono<{ Bindings: Env }>();

styles.get('/v1/styles/:file', async (c) => {
  const theme = c.req.param('file').replace(/\.json$/, '');
  if (!isTheme(theme)) throw new ApiError(404, 'not_found', `Không có theme "${theme}"`);
  const sources = parseSources(c.req.query('sources'));
  const profile = profileForSources(sources);
  if (!profile) {
    const available = Object.values(POI_SOURCE_PROFILES)
      .map((list) => list.join(','))
      .join(' | ');
    throw new ApiError(
      400,
      'invalid_request',
      `Chưa có bộ tiles cho sources=${sources.join(',')}; hiện hỗ trợ: ${available}`,
    );
  }
  const manifest = await getManifest(c.env);
  const rendered = renderStyle(theme, manifest, c.env.TILES_BASE, profile);
  return c.body(rendered.body, 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'x-poi-profile': rendered.profileHeader,
  });
});
```

`apps/api/src/routes/tiles.ts` — thay `SETS`/`releaseFor`:
```ts
import { type Manifest, getManifest } from '../manifest';
```
```ts
const SETS = ['vn', 'poi', 'poi-osm'] as const;

function releaseFor(set: string, m: Manifest): string {
  if (!(SETS as readonly string[]).includes(set))
    throw new ApiError(404, 'not_found', `Không có bộ tiles "${set}"`);
  const r = set === 'vn' ? m.vn : set === 'poi' ? m.poi : (m.poiProfiles?.osm ?? null);
  if (!r) throw new ApiError(404, 'not_found', `Bộ tiles "${set}" chưa phát hành`);
  return r;
}
```

- [ ] **Step 4: Chạy xanh + typecheck**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/manifest.ts apps/api/src/style.ts apps/api/src/routes/styles.ts apps/api/src/routes/tiles.ts apps/api/test/styles.test.ts apps/api/test/tiles.test.ts
git commit -m "feat(api): style theo profile nguồn POI, fallback all, tiles set poi-osm"
```

---

## Task 8: Pipeline — `export-tiles --sources`, tên release theo profile, seq theo release

**Files:**
- Modify: `pipelines/tiles/src/lib/dates.mjs`
- Modify: `pipelines/tiles/src/lib/dates.test.mjs`
- Create: `pipelines/poi/src/lib/poi-filter.mjs`
- Create: `pipelines/poi/src/lib/poi-filter.test.mjs`
- Modify: `pipelines/poi/src/export-tiles.mjs`

- [ ] **Step 1: Test đỏ**

`pipelines/tiles/src/lib/dates.test.mjs` — thêm vào `describe('releaseName')`:
```js
  it('nhận tiền tố profile poi-osm', () => {
    expect(releaseName('poi-osm', new Date('2026-08-26T10:00:00Z'))).toBe('poi-osm-20260826');
  });
```
`pipelines/poi/src/lib/poi-filter.test.mjs`:
```js
import { poiSourceClause } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import { activePoiWhereSql, poiReleasePrefix, sourcesForProfile } from './poi-filter.mjs';

describe('poi-filter', () => {
  it('sourcesForProfile: osm | all; lạ → ném lỗi', () => {
    expect(sourcesForProfile('osm')).toEqual(['osm']);
    expect(sourcesForProfile('all')).toEqual(['osm', 'overture', 'fsq']);
    expect(() => sourcesForProfile('banana')).toThrowError(/profile/);
  });

  it('activePoiWhereSql dùng đúng mệnh đề chung của core với ARRAY literal', () => {
    expect(activePoiWhereSql('osm')).toBe(
      `p.status = 'active' AND ${poiSourceClause("ARRAY['osm']::text[]")}`,
    );
    expect(activePoiWhereSql('all')).toContain("ARRAY['osm','overture','fsq']::text[]");
  });

  it('poiReleasePrefix: all giữ tên cũ, profile khác thêm hậu tố', () => {
    expect(poiReleasePrefix('all')).toBe('poi');
    expect(poiReleasePrefix('osm')).toBe('poi-osm');
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm vitest run pipelines/tiles/src/lib/dates.test.mjs pipelines/poi/src/lib/poi-filter.test.mjs`
Expected: FAIL — `./poi-filter.mjs` không tồn tại (dates test vẫn xanh vì JS không kiểm kiểu; typecheck sẽ bắt ở bước 4).

- [ ] **Step 3: Implement**

`pipelines/tiles/src/lib/dates.mjs` — đổi JSDoc:
```js
/** @param {'vn' | 'poi' | 'poi-osm'} prefix @param {Date} [date] */
```

`pipelines/poi/src/lib/poi-filter.mjs`:
```js
// Lọc POI theo profile nguồn khi export tile (spec 07/09 mục 4–5). Hằng lấy từ @mapslibvn/core để
// pipeline và API không lệch nhau.
import { POI_SOURCE_PROFILES, poiSourceClause } from '@mapslibvn/core';

/** @param {string} profile @returns {readonly ('osm' | 'overture' | 'fsq')[]} */
export function sourcesForProfile(profile) {
  const sources = /** @type {Record<string, readonly ('osm' | 'overture' | 'fsq')[]>} */ (
    POI_SOURCE_PROFILES
  )[profile];
  if (!sources) {
    throw new Error(`profile nguồn không hợp lệ: ${profile} (có: ${Object.keys(POI_SOURCE_PROFILES).join(', ')})`);
  }
  return sources;
}

/** WHERE cho bảng `poi p`: active + đúng nguồn, luôn giữ POI người dùng. @param {string} profile */
export function activePoiWhereSql(profile) {
  const list = sourcesForProfile(profile)
    .map((source) => `'${source}'`)
    .join(',');
  return `p.status = 'active' AND ${poiSourceClause(`ARRAY[${list}]::text[]`)}`;
}

/** Tiền tố tên release: `all` giữ `poi-YYYYMMDD` để archive cũ không đổi tên. @param {string} profile */
export function poiReleasePrefix(profile) {
  return profile === 'all' ? 'poi' : `poi-${profile}`;
}
```

`pipelines/poi/src/export-tiles.mjs`:
- Dòng chú thích đầu: `// poi active → GeoJSONSeq → tippecanoe → out/<release>.pmtiles (spec 5.8). Dùng: node export-tiles.mjs [--release poi-YYYYMMDD] [--sources osm|all]`
- Import thêm: `import { activePoiWhereSql, poiReleasePrefix } from './lib/poi-filter.mjs';`
- Trong khối `if (process.argv[1]?.endsWith('export-tiles.mjs'))`, thay hai dòng đầu:
```js
  const profile = arg('--sources', 'all') ?? 'all';
  const release =
    arg('--release', undefined) ??
    releaseName(/** @type {'poi' | 'poi-osm'} */ (poiReleasePrefix(profile)));
  mkdirSync(POI_WORK, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  // Mỗi release một file seq: hai profile export liền nhau không ghi đè nhau.
  const seq = resolve(POI_WORK, `${release}.geojsonseq`);
```
- Trong `query`, thay `WHERE p.status = 'active'` bằng:
```js
        WHERE ${activePoiWhereSql(profile)}
```
- Trong `console.log(JSON.stringify({ … }))` cuối, thêm trường đầu tiên `sources: profile,`.

- [ ] **Step 4: Chạy xanh + typecheck scripts**

Run: `pnpm vitest run pipelines/tiles/src/lib/dates.test.mjs pipelines/poi/src/lib/poi-filter.test.mjs && pnpm typecheck`
Expected: PASS; typecheck sạch (`checkJs` cho `.mjs` — kiểu prefix mới được chấp nhận).

- [ ] **Step 5: Commit**

```bash
git add pipelines/tiles/src/lib/dates.mjs pipelines/tiles/src/lib/dates.test.mjs pipelines/poi/src/lib/poi-filter.mjs pipelines/poi/src/lib/poi-filter.test.mjs pipelines/poi/src/export-tiles.mjs
git commit -m "feat(pipeline): export-tiles --sources theo profile, seq theo release"
```

---

## Task 9: Pipeline — manifest `--poi-osm`, smoke `poi-osm`, data-update build hai archive, state

**Files:**
- Modify: `pipelines/tiles/src/lib/manifest-state.mjs`
- Modify: `pipelines/tiles/src/lib/manifest-state.test.mjs`
- Modify: `pipelines/tiles/src/manifest.mjs`
- Modify: `pipelines/tiles/src/smoke.mjs`
- Modify: `scripts/lib/update-plan.mjs`
- Modify: `scripts/lib/update-plan.test.mjs`
- Modify: `scripts/data-update.mjs`
- Modify: `scripts/db-fixture.mjs`

- [ ] **Step 1: Test đỏ**

`pipelines/tiles/src/lib/manifest-state.test.mjs` — import thêm `nextManifest` và thêm:
```js
describe('nextManifest', () => {
  const current = { vn: 'vn-1', poi: 'poi-1', poiProfiles: { osm: 'poi-osm-1' } };
  const at = '2026-09-10T00:00:00.000Z';

  it('--vn giữ poi và poiProfiles', () => {
    expect(nextManifest(current, ['--vn', 'vn-2'], at)).toEqual({
      vn: 'vn-2',
      poi: 'poi-1',
      poiProfiles: { osm: 'poi-osm-1' },
      updatedAt: at,
    });
  });

  it('--poi và --poi-osm cùng lúc → cả hai profile đổi', () => {
    expect(nextManifest(current, ['--poi', 'poi-2', '--poi-osm', 'poi-osm-2'], at)).toEqual({
      vn: 'vn-1',
      poi: 'poi-2',
      poiProfiles: { osm: 'poi-osm-2' },
      updatedAt: at,
    });
  });

  it('manifest cũ không có poiProfiles thì không bịa ra khoá rỗng', () => {
    expect(nextManifest({ vn: 'vn-1', poi: null }, ['--poi', 'poi-2'], at)).toEqual({
      vn: 'vn-1',
      poi: 'poi-2',
      updatedAt: at,
    });
  });

  it('thiếu giá trị sau cờ hoặc không có cờ nào → ném lỗi', () => {
    expect(() => nextManifest(current, ['--poi'], at)).toThrowError(/Thiếu tên release/);
    expect(() => nextManifest(current, [], at)).toThrowError(/set cần/);
  });
});
```
`scripts/lib/update-plan.test.mjs` — thêm test cho `nextState`:
```js
  it('nextState ghi releases.poiOsm khi build profile osm', () => {
    const next = nextState(state, same, { poi: 'poi-20260910', poiOsm: 'poi-osm-20260910' });
    expect(next.releases).toEqual({
      vn: 'vn-20260819',
      poi: 'poi-20260910',
      poiOsm: 'poi-osm-20260910',
    });
  });
```
(đặt trong `describe` có sẵn của `nextState`; nếu file chưa có, tạo `describe('nextState', …)` bọc test này.)

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm vitest run pipelines/tiles/src/lib/manifest-state.test.mjs scripts/lib/update-plan.test.mjs`
Expected: FAIL — `nextManifest` không export; `releases.poiOsm` undefined.

- [ ] **Step 3: Implement**

`pipelines/tiles/src/lib/manifest-state.mjs` — thêm cuối file:
```js
/**
 * Manifest kế tiếp từ đối số của `manifest.mjs set`. Tách riêng để test không cần wrangler.
 * @param {{ vn: string | null, poi: string | null, poiProfiles?: { osm?: string | null } }} current
 * @param {string[]} rest
 * @param {string} updatedAt
 */
export function nextManifest(current, rest, updatedAt) {
  const flags = ['--vn', '--poi', '--poi-osm'];
  const indexes = Object.fromEntries(flags.map((flag) => [flag, rest.indexOf(flag)]));
  if (flags.every((flag) => indexes[flag] < 0)) {
    throw new Error('set cần ít nhất --vn <release>, --poi <release> hoặc --poi-osm <release>');
  }
  /** @param {string} flag */
  const valueOf = (flag) => {
    const at = indexes[flag];
    if (at === undefined || at < 0) return undefined;
    const value = rest[at + 1];
    if (!value || value.startsWith('--')) throw new Error(`Thiếu tên release sau ${flag}`);
    return value;
  };
  const vn = valueOf('--vn');
  const poi = valueOf('--poi');
  const poiOsm = valueOf('--poi-osm');
  const poiProfiles = {
    ...(current.poiProfiles ?? {}),
    ...(poiOsm ? { osm: poiOsm } : {}),
  };
  return {
    vn: vn ?? current.vn,
    poi: poi ?? current.poi,
    ...(Object.keys(poiProfiles).length > 0 ? { poiProfiles } : {}),
    updatedAt,
  };
}
```

`pipelines/tiles/src/manifest.mjs`:
- Dòng 2: `// Dùng: manifest.mjs get | set --vn <release> [--poi <release>] [--poi-osm <release>] | rollback`
- Import: `import { nextManifest, parseListedKeys, readOptionalJson } from './lib/manifest-state.mjs';`
- Thay toàn bộ nhánh `else if (command === 'set') { … }` bằng:
```js
} else if (command === 'set') {
  const next = nextManifest(current, rest, new Date().toISOString());
  put('release:history', [current, ...history].slice(0, 3));
  put('release:current', next);
  console.log('✓ manifest', JSON.stringify(next));
```
- Thông điệp lỗi cuối file: `throw new Error('Dùng: manifest.mjs get | set --vn <release> [--poi <release>] [--poi-osm <release>] | rollback');`

`pipelines/tiles/src/smoke.mjs` — thay ba dòng `set`/`expectMaxZoom`/`zooms` và hai chỗ dùng `set === 'poi'`:
```js
// Dùng: node smoke.mjs <release> [--set vn|poi|poi-osm] — đọc 20 tile qua đúng URL HTTP của client.
```
```js
const set = argv.includes('--set') ? argv[argv.indexOf('--set') + 1] : 'vn';
const isPoi = set === 'poi' || set === 'poi-osm';
const expectMaxZoom = isPoi ? 16 : 14;
const zooms = isPoi ? [12, 14, 15, 16] : [10, 12, 13, 14];
```
và `if (isPoi && ok < 15) {` (dòng kiểm cuối); thông điệp usage ở dòng 9 cũng đổi thành `[--set vn|poi|poi-osm]`.

`scripts/lib/update-plan.mjs`:
- typedef `State.releases`: `{ vn: string | null, poi: string | null, poiOsm?: string | null }`.
- `nextState` JSDoc `built`: `{ vn?: string, poi?: string, poiOsm?: string }`; trong `releases` thêm:
```js
      poiOsm: built.poiOsm ?? state.releases?.poiOsm ?? null,
```
(`nextState` với `built` không có `poiOsm` và state cũ không có → `poiOsm: null`; cập nhật test cũ của `nextState` nếu nó dùng `toEqual` trên `releases`: thêm `poiOsm: null`.)

`scripts/data-update.mjs` — trong nhánh `if (work.poi)`, thay từ dòng `const release = releaseName('poi');` tới `built.poi = release;` bằng:
```js
    const release = releaseName('poi');
    const osmRelease = releaseName('poi-osm');
    run('node', ['pipelines/poi/src/export-tiles.mjs', '--release', release]);
    run('node', ['pipelines/tiles/src/qa.mjs', `${OUT}/${release}.pmtiles`, '--skip-islands']);
    // Profile osm (spec 07/09): cùng snapshot DB, cùng ngày; lỗi ở đây thì không set manifest cho cả hai.
    run('node', ['pipelines/poi/src/export-tiles.mjs', '--release', osmRelease, '--sources', 'osm']);
    run('node', ['pipelines/tiles/src/qa.mjs', `${OUT}/${osmRelease}.pmtiles`, '--skip-islands']);
    run('node', ['pipelines/tiles/src/upload.mjs', release]);
    run('node', ['pipelines/tiles/src/upload.mjs', osmRelease]);
    run('node', ['pipelines/tiles/src/smoke.mjs', release, '--set', 'poi']);
    run('node', ['pipelines/tiles/src/smoke.mjs', osmRelease, '--set', 'poi-osm']);
    run('node', [
      'pipelines/tiles/src/manifest.mjs',
      'set',
      '--poi',
      release,
      '--poi-osm',
      osmRelease,
    ]);
    run('node', ['pipelines/poi/src/report.mjs']);
    run('rclone', ['copy', OUT, `r2:${bucket}/state/reports/`, '--include', 'poi-report-*.json']);
    built.poi = release;
    built.poiOsm = osmRelease;
    log(`✓ POI ${release} + ${osmRelease}`);
```
và đổi typedef `built`: `/** @type {{ vn?: string, poi?: string, poiOsm?: string }} */`.

`scripts/db-fixture.mjs` — thêm sau dòng export `poi-fixture`:
```js
  ['pipelines/poi/src/export-tiles.mjs', '--release', 'poi-osm-fixture', '--sources', 'osm'],
```

- [ ] **Step 4: Chạy xanh + lint + typecheck**

Run: `pnpm vitest run pipelines/tiles/src/lib/manifest-state.test.mjs scripts/lib/update-plan.test.mjs && pnpm lint && pnpm typecheck`
Expected: PASS, lint sạch, typecheck sạch.

- [ ] **Step 5: Commit**

```bash
git add pipelines/tiles/src/lib/manifest-state.mjs pipelines/tiles/src/lib/manifest-state.test.mjs pipelines/tiles/src/manifest.mjs pipelines/tiles/src/smoke.mjs scripts/lib/update-plan.mjs scripts/lib/update-plan.test.mjs scripts/data-update.mjs scripts/db-fixture.mjs
git commit -m "feat(pipeline): publish hai archive POI (all + osm) trong một lần set manifest"
```

---

## Task 10: dbtest — fixture export profile `osm` là tập con và giữ POI người dùng

Chạy trong image pipeline vì máy dev thiếu tippecanoe (memory `dbtest-local-thieu-tippecanoe`): `pnpm test:db` tự chạy trong container.

**Files:**
- Modify: `pipelines/poi/tests/pipeline-fixture.dbtest.mjs`

- [ ] **Step 1: Sửa beforeAll và đường dẫn seq, thêm test**

Trong `beforeAll`, thay dòng export bằng:
```js
  // POI người dùng: primary_source NULL, phải có mặt ở mọi profile (spec 07/09 mục 4).
  await sql`INSERT INTO poi (id, name, name_norm, category, geom, quality_score, popularity, status, locked_fields, created_by)
    VALUES ('USERPOI0000000000000000001', 'Quán thử người dùng', 'quan thu nguoi dung', 'cafe',
            ST_SetSRID(ST_MakePoint(106.7009, 10.7769), 4326), 60, 0.2, 'active', '{}', 'user')
    ON CONFLICT (id) DO NOTHING`;
  node('pipelines/poi/src/export-tiles.mjs', '--release', 'poi-fixture');
  node('pipelines/poi/src/export-tiles.mjs', '--release', 'poi-osm-fixture', '--sources', 'osm');
```
`beforeAll` phải là `async () => { … }`.

Trong test `'GeoJSON và PMTiles giữ contract progressive display…'`, đổi đường dẫn:
```js
    const features = readFileSync(resolve(WORK, 'poi', 'poi-fixture.geojsonseq'), 'utf8')
```

Thêm test mới cuối `describe`:
```js
  it('profile osm: chỉ POI primary osm hoặc người dùng; là tập con thật của all', async () => {
    const readIds = (/** @type {string} */ release) =>
      new Set(
        readFileSync(resolve(WORK, 'poi', `${release}.geojsonseq`), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line).properties.id),
      );
    const osmIds = readIds('poi-osm-fixture');
    const allIds = readIds('poi-fixture');
    expect(osmIds.size).toBeGreaterThan(0);
    expect(osmIds.size).toBeLessThan(allIds.size);

    const allowed = await sql`SELECT id FROM poi p
      WHERE p.status = 'active' AND (p.primary_source = 'osm' OR p.created_by = 'user')`;
    const allowedIds = new Set(allowed.map((row) => row.id));
    for (const id of osmIds) expect(allowedIds.has(id), `POI ${id} không phải osm/user`).toBe(true);

    expect(osmIds.has('USERPOI0000000000000000001')).toBe(true);
    expect(allIds.has('USERPOI0000000000000000001')).toBe(true);

    const [other] = await sql`SELECT count(*)::int AS n FROM poi
      WHERE status = 'active' AND primary_source IN ('overture', 'fsq')`;
    expect(other.n).toBeGreaterThan(0);

    const file = resolve(OUT, 'poi-osm-fixture.pmtiles');
    expect(existsSync(file)).toBe(true);
    expect(() => node('pipelines/tiles/src/qa.mjs', file, '--skip-islands')).not.toThrow();
  });
```

- [ ] **Step 2: Chạy dbtest trong container**

Run: `pnpm db:up && pnpm test:db -- pipelines/poi/tests/pipeline-fixture.dbtest.mjs`
Expected: PASS (nếu `test:db` không nhận filter, chạy toàn bộ `pnpm test:db`; test khác phải giữ xanh như trước).

- [ ] **Step 3: Commit**

```bash
git add pipelines/poi/tests/pipeline-fixture.dbtest.mjs
git commit -m "test(pipeline): dbtest profile osm là tập con và giữ POI người dùng"
```

---

## Task 11: `@mapslibvn/web` — `poiSources` ở `createMap` và thuộc tính `sources` của web component

**Files:**
- Modify: `packages/web/src/map.ts`
- Modify: `packages/web/src/map.test.ts`
- Modify: `packages/web/src/autocomplete-element.ts`
- Modify: `packages/web/src/autocomplete-element.test.ts`
- Modify: `packages/web/src/index.ts`

- [ ] **Step 1: Test đỏ**

`packages/web/src/map.test.ts`: trong test đầu đổi kỳ vọng
```ts
    expect(opts.style).toBe(
      'https://api.test/v1/styles/light.json?key=mlv_live_t&sources=osm%2Coverture%2Cfsq',
    );
```
Thêm:
```ts
  it('poiSources đi vào style URL và client Places; tổ hợp chưa có archive → ném lỗi sớm', () => {
    const { ml } = fakeMaplibre();
    const m = createMap({ ...base, poiSources: ['osm'] }, { maplibre: ml as never });
    expect((m.gl as unknown as { options: Record<string, unknown> }).options.style).toBe(
      'https://api.test/v1/styles/light.json?key=mlv_live_t&sources=osm',
    );
    expect(m.places.styleUrl('dark')).toContain('sources=osm');
    expect(() =>
      createMap({ ...base, poiSources: ['osm', 'overture'] }, { maplibre: ml as never }),
    ).toThrowError(/osm,overture,fsq/);
  });
```
`packages/web/src/autocomplete-element.test.ts`: đổi mock và thêm test:
```ts
const autocomplete = vi.fn();
const createClientMock = vi.fn(() => ({ autocomplete }));

vi.mock('@mapslibvn/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mapslibvn/core')>()),
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
}));
```
và test mới (đặt trong `describe` có sẵn):
```ts
  it('thuộc tính sources → poiSources của client; lạ → bỏ qua, dùng mặc định', async () => {
    createClientMock.mockClear();
    await typeQuery([poi], 'high');
    expect(createClientMock).toHaveBeenLastCalledWith({
      apiKey: 'mlv_test',
      baseUrl: 'https://api.test',
    });

    autocomplete.mockResolvedValue({ items: [poi] });
    const element = new MapsLibVNAutocomplete();
    element.setAttribute('api-key', 'mlv_test');
    element.setAttribute('api-base', 'https://api.test');
    element.setAttribute('sources', 'fsq,osm');
    document.body.append(element);
    const input = element.querySelector('input') as HTMLInputElement;
    input.value = 'high';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(createClientMock).toHaveBeenLastCalledWith({
      apiKey: 'mlv_test',
      baseUrl: 'https://api.test',
      poiSources: ['osm', 'fsq'],
    });
    element.remove();
    // Không có thuộc tính `sources` → không truyền poiSources, client tự dùng mặc định cả ba nguồn.

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = new MapsLibVNAutocomplete();
    bad.setAttribute('api-key', 'mlv_test');
    bad.setAttribute('api-base', 'https://api.test');
    bad.setAttribute('sources', 'banana');
    document.body.append(bad);
    const badInput = bad.querySelector('input') as HTMLInputElement;
    badInput.value = 'high';
    badInput.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(createClientMock).toHaveBeenLastCalledWith({
      apiKey: 'mlv_test',
      baseUrl: 'https://api.test',
    });
    expect(warn).toHaveBeenCalled();
    bad.remove();
  });
```
(Đọc hàm `typeQuery` trong file để khớp cách gắn element/gõ; nếu `typeQuery` đã gắn vào `document.body` và trả element, dùng lại nó thay cho khối thủ công.)

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm vitest run packages/web/src/map.test.ts packages/web/src/autocomplete-element.test.ts`
Expected: FAIL — style URL thiếu `sources`; `poiSources` không có trong `CreateMapOptions` (lỗi TS trong test); element không truyền `poiSources`.

- [ ] **Step 3: Implement**

`packages/web/src/map.ts`:
```ts
import {
  DEFAULT_POI_SOURCES,
  POI_SOURCE_PROFILES,
  type PoiSource,
  profileForSources,
  // … các import hiện có
} from '@mapslibvn/core';
```
Thêm vào `CreateMapOptions` sau `poiLayer?`:
```ts
  /**
   * Tập nguồn POI cho bản đồ và `map.places` — mặc định cả ba. Chỉ nhận tổ hợp đã có bộ tiles
   * (`['osm']` hoặc cả ba); tổ hợp khác ném lỗi ngay khi tạo map.
   */
  poiSources?: readonly PoiSource[];
```
Trong `createMap`, thay dòng `const places = createClient(…)`:
```ts
  const poiSources = opts.poiSources ?? DEFAULT_POI_SOURCES;
  if (!profileForSources(poiSources)) {
    const available = Object.values(POI_SOURCE_PROFILES)
      .map((list) => list.join(','))
      .join(' | ');
    throw new Error(
      `poiSources "${poiSources.join(',')}" chưa có bộ tiles; hiện hỗ trợ: ${available}`,
    );
  }
  const places = createClient({ apiKey: opts.apiKey, baseUrl: opts.apiBase, poiSources });
```

`packages/web/src/autocomplete-element.ts`:
- `static observedAttributes = ['api-key', 'api-base', 'placeholder', 'near', 'sources'];`
- `attributeChangedCallback`: điều kiện reset client thành `if (name === 'api-key' || name === 'api-base' || name === 'sources')`.
- Import `parsePoiSourcesCsv` từ `@mapslibvn/core`; `#getClient`:
```ts
  #getClient(): MapsLibVNClient | null {
    if (this.#client) return this.#client;
    const apiKey = this.getAttribute('api-key');
    const baseUrl = this.getAttribute('api-base');
    if (!apiKey || !baseUrl) return null;
    const rawSources = this.getAttribute('sources');
    const poiSources = rawSources === null ? null : parsePoiSourcesCsv(rawSources);
    if (rawSources !== null && !poiSources) {
      console.warn(`<mapslibvn-autocomplete sources="${rawSources}"> không hợp lệ — dùng mặc định`);
    }
    this.#client = createClient({
      apiKey,
      baseUrl,
      ...(poiSources ? { poiSources } : {}),
    });
    return this.#client;
  }
```

`packages/web/src/index.ts` — thêm `PoiSource` vào dòng export type từ core:
```ts
export type { AttributionResponse, ClientOptions, MapsLibVNClient, PoiSource, Theme } from '@mapslibvn/core';
```

- [ ] **Step 4: Chạy xanh**

Run: `pnpm vitest run packages/web && pnpm --filter @mapslibvn/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/map.ts packages/web/src/map.test.ts packages/web/src/autocomplete-element.ts packages/web/src/autocomplete-element.test.ts packages/web/src/index.ts
git commit -m "feat(web): poiSources cho createMap và thuộc tính sources của autocomplete"
```

---

## Task 12: `@mapslibvn/react` và `@mapslibvn/react-native` — prop `poiSources`

**Files:**
- Modify: `packages/react/src/map.tsx`
- Modify: `packages/react/src/index.ts`
- Modify: `packages/react-native/src/map.tsx`
- Modify: `packages/react-native/src/index.ts`
- Modify: `packages/react-native/src/map.test.tsx`
- Modify: `packages/react-native/src/use-style.test.ts`

- [ ] **Step 1: Test đỏ (RN)**

`packages/react-native/src/map.test.tsx`: test đầu đổi kỳ vọng
```ts
      'https://api.test/v1/styles/light.json?key=mlv_live_k&sources=osm%2Coverture%2Cfsq',
```
Thêm:
```ts
  it('poiSources đi vào style URL và client; đổi prop tạo lại map', () => {
    const { rerender } = render(<MapsLibVNMap {...base} poiSources={['osm']} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toContain('sources=osm');
    expect(screen.getByTestId('mlrn-map').dataset.style).not.toContain('overture');
    const onLoad = vi.fn();
    rerender(<MapsLibVNMap {...base} poiSources={['osm', 'overture', 'fsq']} onLoad={onLoad} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toContain('sources=osm%2Coverture%2Cfsq');
    const props = getLastMapProps() as unknown as { onDidFinishLoadingStyle: () => void };
    act(() => props.onDidFinishLoadingStyle());
    expect(onLoad.mock.calls[0]?.[0].places.styleUrl('light')).toContain(
      'sources=osm%2Coverture%2Cfsq',
    );
  });
```
`packages/react-native/src/use-style.test.ts`: kỳ vọng `styleUrlFor(places, 'dark')` đổi thành `'https://api.test/v1/styles/dark.json?key=mlv_live_k&sources=osm%2Coverture%2Cfsq'`.

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm vitest run packages/react-native`
Expected: FAIL — prop `poiSources` không tồn tại; URL thiếu `sources`.

- [ ] **Step 3: Implement**

`packages/react/src/map.tsx`: thêm `poiSources,` vào destructure props (sau `poiLayer,`); trong effect thêm:
```tsx
    if (poiSources !== undefined) options.poiSources = poiSources;
```
Trước `useEffect`, thêm `const poiSourcesKey = poiSources?.join(',') ?? '';` và thêm `poiSourcesKey,` vào mảng deps (sau `poiLayer,`).

`packages/react/src/index.ts`:
```ts
export type { AutocompleteItem, MapsLibVNClient, Place, PoiSource } from '@mapslibvn/core';
```

`packages/react-native/src/map.tsx`:
- Import `type PoiSource` từ `@mapslibvn/core`.
- Props thêm sau `poiLayer?`:
```ts
  /** Tập nguồn POI cho bản đồ và Places API — mặc định cả ba; đổi sau khi mount tạo lại map. */
  poiSources?: readonly PoiSource[];
```
- Destructure `poiSources,` (sau `poiLayer = true,`).
- `const poiSourcesKey = poiSources?.join(',') ?? '';` đặt trước `useMemo` của `places`; `places`:
```tsx
  const places = useMemo(
    () =>
      createClient({
        apiKey,
        baseUrl: apiBase,
        ...(bundleId ? { headers: { 'X-Bundle-Id': bundleId } } : {}),
        ...(poiSources ? { poiSources } : {}),
      }),
    // biome-ignore lint/correctness/useExhaustiveDependencies: poiSources so theo khoá chuỗi để mảng mới cùng nội dung không tạo lại client
    [apiKey, apiBase, bundleId, poiSourcesKey],
  );
```
- `mapKey`: `` `${apiKey}|${apiBase}|${style}|${lang}|${poiLayer}|${poiSourcesKey}` ``.

`packages/react-native/src/index.ts` — thêm `PoiSource,` vào khối `export type { … } from '@mapslibvn/core'`.

- [ ] **Step 4: Chạy xanh + typecheck**

Run: `pnpm vitest run packages/react packages/react-native && pnpm --filter @mapslibvn/react typecheck && pnpm --filter @mapslibvn/react-native typecheck && pnpm lint`
Expected: PASS; nếu biome không cần dòng `biome-ignore` (rule tắt) thì xoá dòng đó để lint không báo "unused suppression".

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/map.tsx packages/react/src/index.ts packages/react-native/src/map.tsx packages/react-native/src/index.ts packages/react-native/src/map.test.tsx packages/react-native/src/use-style.test.ts
git commit -m "feat(react,react-native): prop poiSources truyền xuống client và style"
```

---

## Task 13: Benchmark — cohort theo `sources` cho `perf-autocomplete.mjs`

**Files:**
- Modify: `scripts/perf-autocomplete.mjs`
- Modify: `scripts/perf-autocomplete.test.mjs`

- [ ] **Step 1: Test đỏ**

Thêm vào `describe` của `measurePairedCohorts` trong `scripts/perf-autocomplete.test.mjs`:
```js
  it('cohort có sources thì URL mang sources=', async () => {
    /** @type {string[]} */
    const urls = [];
    await measurePairedCohorts('https://api.test', 'k', {
      cohorts: [
        { label: 'osm', sources: 'osm' },
        { label: 'all', sources: 'all' },
      ],
      queries: [{ q: 'pho', expect: '' }],
      fetchImpl: async (url) => {
        urls.push(String(url));
        return new Response('{}');
      },
      now: () => 0,
    });
    expect(urls.some((u) => u.includes('sources=osm'))).toBe(true);
    expect(urls.some((u) => u.includes('sources=all'))).toBe(true);
    expect(urls.every((u) => !u.includes('types='))).toBe(true);
  });
```
Thêm vào `describe('parseCliArgs')`:
```js
  it('đọc --paired-sources cho cặp cohort osm/all', () => {
    expect(parseCliArgs(['https://a', 'k', '--paired-sources']).pairedSources).toBe(true);
    expect(parseCliArgs(['https://a', 'k']).pairedSources).toBe(false);
  });
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm vitest run scripts/perf-autocomplete.test.mjs`
Expected: FAIL — `pairedSources` undefined; cohort không có `types` làm URL thiếu `sources`.

- [ ] **Step 3: Implement**

Trong `measurePairedCohorts`:
- JSDoc cohorts: `cohorts: { label: string, types?: string, sources?: string }[]`.
- Trong vòng lặp, sau `const typesParam = …`:
```js
        const sourcesParam = cohort.sources
          ? `&sources=${encodeURIComponent(cohort.sources)}`
          : '';
```
và URL: `` `${normalizedBase}/v1/autocomplete?q=${encodeURIComponent(entry.q)}&near=${near}${typesParam}${sourcesParam}` ``.
- Kết quả: `cohorts.map(({ label, types, sources }) => { … return { label, ...(types === undefined ? {} : { types }), ...(sources === undefined ? {} : { sources }), ...summarize(samples), … } })`.

Trong `parseCliArgs`: `const pairedSources = hasFlag('--paired-sources');` và thêm `pairedSources,` vào object trả về.

Trong khối `isMain`: destructure `pairedSources`; đổi `if (paired) {` thành `if (paired || pairedSources) {` và cohorts:
```js
          cohorts: pairedSources
            ? [
                { label: 'osm', sources: 'osm' },
                { label: 'all', sources: 'all' },
              ]
            : [
                { label: 'default', types: '' },
                { label: 'legacy', types: 'poi,street,address' },
              ],
```
Cập nhật chuỗi "Cách dùng" thêm `[--paired-sources]`.

- [ ] **Step 4: Chạy xanh + typecheck**

Run: `pnpm vitest run scripts/perf-autocomplete.test.mjs && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/perf-autocomplete.mjs scripts/perf-autocomplete.test.mjs
git commit -m "test(perf): cohort --paired-sources so p95 osm với all"
```

---

## Task 14: Docs, phiên bản SDK, DEVLOG

**Files:**
- Modify: `packages/core/package.json`, `packages/web/package.json`, `packages/react/package.json`, `packages/react-native/package.json` (version `0.2.0` → `0.3.0`)
- Modify: `apps/docs/src/content/docs/api.md`, `ban-do-web.md`, `react.md`, `react-native.md`, `sdk.md`, `tim-kiem.md`, `tinh-nang.md`
- Modify: `docs/DEVLOG.md`

- [ ] **Step 1: Bump phiên bản**

Run:
```bash
for p in core web react react-native; do
  node -e "const f='packages/$p/package.json';const fs=require('fs');const j=JSON.parse(fs.readFileSync(f));j.version='0.3.0';fs.writeFileSync(f, JSON.stringify(j,null,2)+'\n')"
done
grep -n '"version"' packages/{core,web,react,react-native}/package.json
```
Expected: bốn dòng `"version": "0.3.0"`. Kiểm các gói có peer/dependency `workspace:*` không cần đổi.

- [ ] **Step 2: `api.md`**

Bảng tham số `GET /v1/autocomplete`, `GET /v1/search`, `GET /v1/nearby`, `GET /v1/reverse` — thêm dòng:
```markdown
| `sources` | danh sách ngăn bằng dấu phẩy | không | `all` | `osm`, `overture`, `fsq`; `all` = cả ba. Lọc POI theo **nguồn chính**; POI do người dùng đóng góp luôn có mặt |
```
Với `autocomplete` thêm câu sau bảng: "`sources` chỉ ảnh hưởng kết quả `poi`; `street`, `address`, `area` không có nguồn."
Với `reverse`: câu "POI gần nhất: 100 m, chỉ POI `active`" thêm "và thuộc `sources`".
Mục `GET /v1/places/{id}`: thêm câu "Không nhận `sources`: tra theo id luôn trả POI dù nguồn nào, để POI đã bấm trên bản đồ hay đã ghim luôn mở được."
Mục `GET /v1/styles/{theme}.json`: thêm dòng bảng
```markdown
| `sources` | chuỗi truy vấn | không | `all` | chỉ nhận tổ hợp đã có bộ tiles: `osm` hoặc `osm,overture,fsq` (`all`); tổ hợp khác `400 invalid_request` |
```
và đoạn:
```markdown
Header `x-poi-profile` cho biết archive đang phục vụ: `osm`, `all`, hoặc `all;fallback` khi profile
yêu cầu chưa được phát hành (API tạm dùng archive đầy đủ thay vì lỗi).
```
Mục `GET /v1/tiles/{set}.json`: `set` là `vn`, `poi` (đầy đủ) hoặc `poi-osm`.

- [ ] **Step 3: `ban-do-web.md`, `react.md`, `react-native.md`, `tim-kiem.md`, `tinh-nang.md`, `sdk.md`**

`ban-do-web.md` bảng `CreateMapOptions` thêm sau `poiLayer`:
```markdown
| `poiSources` | `('osm' \| 'overture' \| 'fsq')[]` | cả ba | Nguồn POI cho bản đồ **và** `map.places`. Hiện chỉ có bộ tiles cho `['osm']` và cả ba; tổ hợp khác ném lỗi khi tạo map |
```
Mục 8 "Lớp POI" thêm đoạn:
```markdown
Mặc định bản đồ vẽ POI từ cả ba nguồn. Muốn chỉ dùng dữ liệu OpenStreetMap — ví dụ để mọi POI đều
là ODbL — đặt `poiSources: ['osm']`. Lưu ý OSM là nguồn chính của khoảng 7 % POI Việt Nam trong kho
hiện tại, nên bản đồ sẽ **thưa hẳn**. Tuỳ chọn này áp cả cho search, nearby và reverse của
`map.places`, nên POI không hiện trên bản đồ cũng không xuất hiện trong ô tìm kiếm.
`<mapslibvn-autocomplete>` nhận thuộc tính `sources="osm"` tương ứng.
```
`react.md` bảng props thêm dòng `| `poiSources` | `PoiSource[]` | cả ba | đổi là tạo lại map |`.
`react-native.md`: đoạn "Đổi `apiKey`, `apiBase`, `style`, `lang`, `poiLayer` sau khi mount…" thêm `poiSources`; thêm dòng ví dụ `poiSources={['osm']}` (chú thích `// mặc định: cả ba nguồn`) vào khối `<MapsLibVNMap>`.
`tim-kiem.md` mục 4: sau đoạn `createClient` còn nhận `fetch`, `headers` thêm câu: "và `poiSources` (mặc định cả ba nguồn) — tập nguồn POI áp cho `autocomplete`, `search`, `nearby`, `reverse` và `styleUrl`; `getPlace`/`geocode` không lọc."
`tinh-nang.md` mục 2: sau đoạn "Dữ liệu POI gộp từ ba nguồn mở…" thêm:
```markdown
Mặc định bản đồ và Places API dùng **cả ba nguồn**. Người tích hợp có thể giới hạn tập nguồn bằng
`poiSources` (SDK) hoặc `sources=` (REST) — ví dụ `['osm']` khi chỉ muốn dữ liệu ODbL. Lớp POI cho
từng tập nguồn được build thành archive riêng nên mật độ hiển thị luôn đúng, không có lỗ trống.
Phân bố nguồn chính hiện tại: Overture 77 %, Foursquare 16 %, OpenStreetMap 7 %.
```
`sdk.md`: bảng phiên bản đổi `0.2.0` → `0.3.0` cho bốn gói; thêm mục trước "Nâng từ 0.1.x lên 0.2.0":
```markdown
### Nâng từ 0.2.x lên 0.3.0

Bản 0.3.0 **chỉ thêm**, không đổi hành vi: mặc định vẫn là cả ba nguồn POI như 0.2.x, nên code đang
chạy không phải sửa gì. Mới: tuỳ chọn `poiSources` cho `createMap`, `<MapsLibVNMap>` (React và React
Native) và `createClient`, thuộc tính `sources` cho `<mapslibvn-autocomplete>`, cùng các export
`PoiSource`, `PoiSourceProfile`, `POI_SOURCE_PROFILES`, `DEFAULT_POI_SOURCES`, `parsePoiSourcesCsv`,
`profileForSources`. Đặt `poiSources: ['osm']` nếu chỉ muốn POI có nguồn chính OpenStreetMap — lưu ý
đó là khoảng 7 % kho POI hiện tại.
```
Bảng export `@mapslibvn/core` thêm nhóm "Nguồn POI" với các export trên.

- [ ] **Step 4: DEVLOG**

Thêm đầu mục "## 1. Trạng thái hiện tại" một gạch đầu dòng (ngày thực tế):
```markdown
- **<DD/09/2026> — Bật/tắt nguồn POI theo profile (spec 07/09).** Đo trước cho thấy OSM chỉ là
  nguồn chính của **7,0 %** POI (Overture 77,1 %, FSQ 15,9 %) nên **mặc định là `all`**, không phải
  `osm` như dự định ban đầu — hành vi hiện tại không đổi. Core có `POI_SOURCE_PROFILES`
  (`all` mặc định, `osm` tuỳ chọn); API nhận `sources=` ở search/nearby/autocomplete/reverse/styles, cache
  key autocomplete lên `v=src1`, style trả `x-poi-profile` và fallback `all` khi profile chưa
  publish; pipeline export thêm `poi-osm-YYYYMMDD` (lưới progressive chạy riêng trên OSM), manifest
  có `poiProfiles.osm`, `data:update` publish hai archive trong một lần set. SDK 0.3.0: `poiSources`
  (web/react/RN), thuộc tính `sources` của web component. **Chưa publish dữ liệu** — xem mục 2.
```
Thêm vào "## 2. Bước kế tiếp": "Chạy Task 15 của plan `2026-09-07-poi-sources-profile.md`: deploy API → `data:update --poi` → nghiệm thu."

- [ ] **Step 5: Kiểm tra docs build, lint, test toàn bộ**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @mapslibvn/docs build`
Expected: tất cả xanh (docs build có thể mất vài phút).

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/web/package.json packages/react/package.json packages/react-native/package.json apps/docs/src/content/docs docs/DEVLOG.md
git commit -m "docs(sdk,api): poiSources/sources=, SDK 0.3.0, DEVLOG"
```

---

## Task 15: Rollout và nghiệm thu production (spec mục 9–11)

Mặc định `all` nên bước 1 **không đổi hành vi** của người tích hợp hiện tại; khoảng lệch chỉ ảnh
hưởng ai chủ động đặt `poiSources: ['osm']` trước khi archive `poi-osm` lên. Vẫn nên chạy hai bước
gần nhau. Không có migration DB.

**Files:**
- Create: `docs/evidence/poi-sources/nghiem-thu-production.md`
- Modify: `docs/DEVLOG.md`

- [ ] **Step 1: Deploy API**

Run (từ `apps/api`, wrangler đọc `.env` gốc repo — memory `wrangler-doc-env-goc-repo`):
```bash
cd apps/api && pnpm test && pnpm deploy && cd ../..
curl -sI "https://api.ai-solutions.io.vn/v1/styles/light.json" | grep -i x-poi-profile
curl -sI "https://api.ai-solutions.io.vn/v1/styles/light.json?sources=osm" | grep -i x-poi-profile
```
Expected: dòng một `x-poi-profile: all` (mặc định, không đổi gì); dòng hai `all;fallback` vì profile
`osm` chưa publish. Kiểm `curl -s "https://api.ai-solutions.io.vn/v1/search?q=pho&sources=banana" -H "X-Api-Key: $KEY"` → 400.

- [ ] **Step 2: Build và publish hai archive**

Run: `pnpm data:update --poi --force`
Expected: log có `✓ POI poi-YYYYMMDD + poi-osm-YYYYMMDD`; hai dòng JSON của export-tiles với `sources:"all"` và `sources:"osm"`; smoke `poi-osm` in `✓ smoke ≥15 tile`. Ghi lại `selected`/`thinned` của cả hai và kích thước MB của `poi-osm-*.pmtiles` (phải ≤ 300).

- [ ] **Step 3: Xác nhận style đã chuyển profile**

Run:
```bash
curl -sI "https://api.ai-solutions.io.vn/v1/styles/light.json?sources=osm" | grep -i x-poi-profile
curl -s "https://api.ai-solutions.io.vn/v1/styles/light.json?sources=osm" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).sources.poi.url))'
curl -s "https://api.ai-solutions.io.vn/v1/styles/light.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).sources.poi.url))'
```
Expected: dòng một `osm` (hết fallback); dòng hai chứa `poi-osm-YYYYMMDD.pmtiles`; dòng ba — mặc định — vẫn chứa `poi-YYYYMMDD.pmtiles`. Nếu header còn `all;fallback` sau 60 s (KV `cacheTtl: 60`), kiểm `manifest.mjs get` trong container.

- [ ] **Step 4: Cổng p95 (Task 8.6 phải giữ)**

Run (production URL và khoá thật; chờ ≥ 11 phút sau bước 2 để cache autocomplete cũ hết hạn):
```bash
node scripts/perf-autocomplete.mjs https://api.ai-solutions.io.vn "$KEY" \
  --queries scripts/fixtures/fuzzy-queries.txt --paired-sources --rounds 2 | tee /tmp/perf-sources.txt
```
Expected: ở `cache=hit` (warm), chênh p95 giữa hai cohort trong ±50 ms; ghi cả `byColo`. Cohort `osm` quét ít dòng hơn nên thường nhanh hơn — điều cần canh là cohort `all` (mặc định) **không** xấu đi so với cổng Task 8.6. Nếu xấu hơn → ghi vào bằng chứng và báo PHONG, không kết luận ĐẠT.

- [ ] **Step 5: Kiểm tay bản đồ**

Mở playground docs (hoặc `examples/`) với `poiSources` mặc định (cả ba) và với `['osm']`, so 5 thành phố `[106.7,10.77] [105.85,21.03] [108.2,16.05] [106.35,9.99] [109.19,12.24]` ở z12/z14/z16. Chụp ảnh màn hình vào `docs/evidence/poi-sources/`. Kỳ vọng: bản đồ mặc định **giống trước thay đổi**; bản đồ `['osm']` thưa hơn nhiều (OSM chỉ 7 % kho) nhưng phân bố đều, không có ô trống bất thường cạnh POI dày, nhãn major vẫn có ở z12.

- [ ] **Step 6: Ghi bằng chứng và DEVLOG**

Tạo `docs/evidence/poi-sources/nghiem-thu-production.md` gồm: ngày; tên hai archive; `activeRead/selected/thinned/byMinZoom` của cả hai profile; MB; kết quả smoke; header `x-poi-profile` ba trường hợp; bảng p95 theo cache/colo từ `/tmp/perf-sources.txt`; kết luận từng tiêu chí mục 11 spec (ĐẠT/KHÔNG). Cập nhật gạch đầu dòng DEVLOG của Task 14 thành "ĐÃ PUBLISH <ngày>" kèm số liệu chính; xoá dòng ở "Bước kế tiếp".

- [ ] **Step 7: Commit và push**

```bash
git add docs/evidence/poi-sources docs/DEVLOG.md
git commit -m "test(poi-sources): nghiệm thu production profile osm/all, cổng p95"
git push
```

**Rollback nếu cần:** `pnpm data:rollback` (manifest về object trước, style tự fallback `all;fallback` hoặc về `poi` cũ); API không cần rollback code.

---

## Self-review

- **Mặc định:** sau Task 1 (OSM 7 %), PHONG chốt mặc định `all`; Task 2–15 đã cập nhật theo, spec cũng đã sửa. `profileForSources` vẫn nhận cả `['osm']` và cả ba nên profile `osm` được giao đầy đủ.
- **Spec coverage:** mục 4 (hằng profile, mệnh đề chung) → Task 2, 4, 8; 5.1–5.4 (export, data-update, manifest, tiles/smoke) → Task 8, 9, 7; 6.1–6.3 (API) → Task 4–7; 7 (SDK) → Task 3, 11, 12; 8 (lỗi/an toàn: fallback, 400, rollback) → Task 7, 15; 9 (unit/dbtest/nghiệm thu) → mọi task + Task 10, 13, 15; 10 (rollout, docs) → Task 14, 15; 11 (tiêu chí) → Task 15 bước 6. Ngoài phạm vi giữ đúng: không thêm property tile, không đổi conflate.
- **Type consistency:** `PoiSource`, `PoiSourceProfile`, `POI_SOURCE_PROFILES`, `DEFAULT_POI_SOURCES`, `normalizePoiSources`, `parsePoiSourcesCsv`, `poiSourcesKey`, `profileForSources`, `poiSourceClause` (Task 2) dùng nhất quán ở Task 3–13; `parseSources` (API) và `poiSourceFilter(sql, sources)` (Task 4) dùng ở Task 5–7; `poiReleaseFor`/`Manifest.poiProfiles` (Task 7) khớp `nextManifest` (Task 9) và kiểm `tiles.ts`; `CandidateQueryInput.sources` (Task 6) là `readonly PoiSource[]` như `poiSourceFilter` nhận.
- **Placeholder:** không có TBD; giá trị ngày trong Task 1/14/15 là số liệu chỉ có lúc chạy, được đánh dấu `<…>` rõ ràng cho người thực thi điền.
