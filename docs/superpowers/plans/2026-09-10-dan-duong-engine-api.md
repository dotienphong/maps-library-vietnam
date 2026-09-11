# Dẫn đường spec A — engine Valhalla và `/v1/directions` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App nhúng MapsLibVN gọi `GET /v1/directions` là có tuyến đường xe máy / ô tô / đi bộ trong Việt Nam kèm bước rẽ tiếng Việt, tính bởi Valhalla tự host trên máy chủ nội bộ, trả về theo schema riêng của MapsLibVN.

**Architecture:** Service `valhalla` (image `ghcr.io/valhalla/valhalla-scripted:3.8.3`) chạy cạnh Postgres trong compose máy chủ, build graph từ `vietnam.osm.pbf` mà pipeline tiles đã tải; một kịch bản bọc `run.sh` đợi cờ `reload.request` do `scripts/routing-graph.mjs` ghi để build lại/rollback không cần Docker socket. Worker gọi Valhalla qua Cloudflare Tunnel + Access service token, kiểm tham số trước, cache 60 s/stale 300 s, quota nhóm `directions`, và **dịch** JSON Valhalla sang `DirectionsResponse` của `@mapslibvn/core` (polyline6 nối cả tuyến, bảng `ManeuverKind`). Gói core thêm `client.directions()`, `decodePolyline6/encodePolyline6`, bảng maneuver. Test tích hợp chạy Valhalla trên fixture Quận 1 có sẵn.

**Tech Stack:** TypeScript (Hono trên Cloudflare Workers, vitest + `@cloudflare/vitest-pool-workers` với `fetchMock`), Node 22 ESM `.mjs` (checkJs) cho scripts, Docker Compose, Valhalla 3.8.3, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-10-dan-duong-engine-api-design.md` (đọc mục 2 "tiền đề đã xác minh" trước khi làm Task 12).

---

## Quy ước chung cho mọi task

- Chạy lệnh từ gốc repo. Test unit root: `pnpm vitest run <file>`; test API: `pnpm --filter @mapslibvn/api test` (hoặc `pnpm --filter @mapslibvn/api exec vitest run test/<file>`); typecheck: `pnpm typecheck`; lint: `pnpm lint` (biome, tự sửa bằng `pnpm lint:fix`). Trước khi commit một task: `pnpm lint && pnpm typecheck`.
- `pnpm --filter @mapslibvn/core build` **phải chạy lại** sau mỗi lần sửa `packages/core/src` trước khi test API (Worker import `@mapslibvn/core` từ `dist`). `pnpm test` ở root đã làm việc này.
- `exactOptionalPropertyTypes` và `noUncheckedIndexedAccess` đang bật: không gán `undefined` vào thuộc tính tuỳ chọn (dùng spread có điều kiện), luôn xử lý `arr[i]` có thể `undefined`.
- API unit test **không được cần Postgres hay mạng** (Hyperdrive trỏ cổng đóng; `fetchMock.disableNetConnect()`); gọi Valhalla trong test bằng `fetchMock` của `cloudflare:test`, `ROUTING_BASE` test là `https://routing.test`.
- Scripts `.mjs` mới nằm trong `include` của `tsconfig.scripts.json` (`scripts/**/*.mjs`) nên phải qua `checkJs`: viết JSDoc kiểu cho tham số.
- Commit message tiếng Việt, tiền tố `feat/fix/test/docs/chore(scope)`, kết bằng dòng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. **Không push** cho tới Task 16 (PHONG duyệt push).
- Biome format nghiêm và CI chạy `biome check .`: sau khi dán code từ plan, chạy `pnpm lint:fix` (hoặc `pnpm exec biome check --write <file>`) rồi mới `pnpm lint`. Biome cấm `!` (non-null assertion).
- Toạ độ: tham số API và client `[lat, lng]`; mọi toạ độ **trong response** `[lng, lat]`.

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `packages/core/src/polyline.ts` (+ `polyline.test.ts`) | `decodePolyline6`, `encodePolyline6` — thuần, dùng chung Worker và SDK |
| `packages/core/src/maneuver.ts` (+ `maneuver.test.ts`) | `MANEUVER_KINDS`, `VALHALLA_MANEUVER_KIND`, `maneuverKindFromValhalla` |
| `packages/core/src/types.ts` | thêm `TravelMode`, `DirectionsLang`, `ManeuverKind`, `RouteStep`, `RouteLeg`, `Route`, `Waypoint`, `DirectionsResponse` |
| `packages/core/src/client.ts` (+ `client.directions.test.ts`) | `client.directions(opts)` |
| `apps/api/src/routing/params.ts` (+ `test/routing-params.test.ts`) | parse/validate tham số, giới hạn khoảng cách, khoá cache |
| `apps/api/src/routing/valhalla.ts` (+ `test/routing-valhalla.test.ts`) | body request, header Access, gọi `/route` và `/status`, ánh xạ lỗi |
| `apps/api/src/routing/translate.ts` (+ `test/routing-translate.test.ts`) | JSON Valhalla → `DirectionsResponse` |
| `apps/api/src/routes/directions.ts` (+ `test/directions-route.test.ts`) | `GET /v1/directions`, `GET /healthz/routing` |
| `apps/api/src/{env,auth,quota}.ts`, `wrangler.toml`, `vitest.config.ts` | biến môi trường, quota nhóm `directions`, cột quota mới |
| `apps/api/test/fixtures/valhalla/*.json` | JSON Valhalla mẫu (tay) và thật (capture từ container) |
| `db/migrations/0012_api_key_quota_directions{,.down}.sql`, `scripts/api-key-issue.mjs`, `scripts/lib/api-key.mjs` | cột `quota_directions_per_day`, cờ `--quota-directions` |
| `infra/dev/compose.yml`, `scripts/routing-test.mjs`, `scripts/lib/routing-test.mjs`, `apps/api/vitest.routing.config.ts`, `apps/api/test-routing/directions.rtest.mjs`, `.github/workflows/routing-test.yml` | test tích hợp trên Valhalla fixture Quận 1 |
| `infra/server/compose.yml`, `infra/server/valhalla/run.sh`, `scripts/routing-graph.mjs`, `scripts/lib/routing-graph.mjs` | máy chủ: service, kịch bản bọc, prepare/rollback/status |
| `scripts/data-update.mjs`, `scripts/data-rollback.mjs`, `scripts/server-setup.mjs`, `scripts/lib/server-env.mjs` | móc graph vào vòng đời dữ liệu và dựng máy chủ |
| `scripts/smoke-directions.mjs` (+ test) | smoke production ba tuyến chuẩn, p95 |
| `apps/docs/src/content/docs/{api,tinh-nang,sdk}.md`, `packages/core/README.md`, `THIRD_PARTY_NOTICES.md`, `infra/server/README.md`, `docs/DEVLOG.md`, `docs/evidence/routing/` | tài liệu và bằng chứng |

---

## Task 1: `@mapslibvn/core` — polyline6 (giải mã và mã hoá)

**Files:**
- Create: `packages/core/src/polyline.ts`
- Create: `packages/core/src/polyline.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Viết test đỏ**

`packages/core/src/polyline.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodePolyline6, encodePolyline6 } from './polyline';

// Chuỗi mẫu sinh bằng thuật toán Google precision 1e6, đã kiểm ngược 10/09/2026.
const LEG1 = 'oh}pSonkojEnoBf^~{Bf^';
const LEG1_COORDS: [number, number][] = [
  [106.699, 10.7798],
  [106.6985, 10.778],
  [106.698, 10.776],
];

describe('polyline6', () => {
  it('giải mã ra [lng, lat] theo thứ tự GeoJSON', () => {
    expect(decodePolyline6(LEG1)).toEqual(LEG1_COORDS);
  });

  it('một điểm và chuỗi rỗng', () => {
    expect(decodePolyline6('_{upS_mmojE')).toEqual([[106.7, 10.776]]);
    expect(decodePolyline6('')).toEqual([]);
  });

  it('mã hoá ngược lại đúng chuỗi mẫu và làm tròn 6 chữ số', () => {
    expect(encodePolyline6(LEG1_COORDS)).toBe(LEG1);
    expect(encodePolyline6([[106.7, 10.776]])).toBe('_{upS_mmojE');
    const noisy: [number, number][] = [[106.6990004, 10.7797996]];
    expect(decodePolyline6(encodePolyline6(noisy))).toEqual([[106.699, 10.7798]]);
  });

  it('toạ độ âm (tây bán cầu, nam bán cầu) đi vòng đúng', () => {
    const coords: [number, number][] = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
      [151.2, -33.87],
    ];
    expect(decodePolyline6(encodePolyline6(coords))).toEqual(coords);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm vitest run packages/core/src/polyline.test.ts`
Expected: FAIL — `Cannot find module './polyline'`.

- [ ] **Step 3: Viết `polyline.ts`**

```ts
/**
 * Polyline mã hoá kiểu Google với precision 1e6 (Valhalla `legs[].shape`).
 * Toạ độ trả về theo thứ tự GeoJSON `[lng, lat]`.
 */
export function decodePolyline6(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    coords.push([lng / 1e6, lat / 1e6]);
  }
  return coords;
}

/** Mã hoá `[lng, lat][]` thành polyline6; Worker dùng để nối shape các leg thành một chuỗi. */
export function encodePolyline6(coords: readonly (readonly [number, number])[]): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const [lng, lat] of coords) {
    const iLat = Math.round(lat * 1e6);
    const iLng = Math.round(lng * 1e6);
    out += encodeValue(iLat - prevLat) + encodeValue(iLng - prevLng);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}
```

Thêm vào cuối `packages/core/src/index.ts`:
```ts
export * from './polyline';
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `pnpm vitest run packages/core/src/polyline.test.ts`
Expected: PASS 4 test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/polyline.ts packages/core/src/polyline.test.ts packages/core/src/index.ts
git commit -m "feat(core): giải mã và mã hoá polyline6 cho tuyến đường

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: `@mapslibvn/core` — kiểu dữ liệu tuyến và bảng maneuver

**Files:**
- Modify: `packages/core/src/types.ts` (thêm cuối file)
- Create: `packages/core/src/maneuver.ts`
- Create: `packages/core/src/maneuver.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Viết test đỏ**

`packages/core/src/maneuver.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MANEUVER_KINDS, VALHALLA_MANEUVER_KIND, maneuverKindFromValhalla } from './maneuver';

describe('maneuver', () => {
  it('ánh xạ đủ các mã Valhalla dùng cho đường bộ (spec A mục 5.2)', () => {
    expect(maneuverKindFromValhalla(1)).toBe('depart');
    expect(maneuverKindFromValhalla(3)).toBe('depart');
    expect(maneuverKindFromValhalla(5)).toBe('arrive');
    expect(maneuverKindFromValhalla(8)).toBe('continue');
    expect(maneuverKindFromValhalla(22)).toBe('continue');
    expect(maneuverKindFromValhalla(10)).toBe('turn_right');
    expect(maneuverKindFromValhalla(15)).toBe('turn_left');
    expect(maneuverKindFromValhalla(12)).toBe('uturn_right');
    expect(maneuverKindFromValhalla(26)).toBe('roundabout_enter');
    expect(maneuverKindFromValhalla(27)).toBe('roundabout_exit');
    expect(maneuverKindFromValhalla(37)).toBe('merge_right');
    expect(maneuverKindFromValhalla(43)).toBe('building_exit');
  });

  it('mã transit (30–36), 0 và mã lạ → other', () => {
    for (const code of [0, 30, 31, 32, 33, 34, 35, 36, 99, -1]) {
      expect(maneuverKindFromValhalla(code)).toBe('other');
    }
  });

  it('mọi giá trị trong bảng đều nằm trong MANEUVER_KINDS và bảng phủ 1–29 + 37–43', () => {
    for (const kind of Object.values(VALHALLA_MANEUVER_KIND)) {
      expect(MANEUVER_KINDS).toContain(kind);
    }
    const expected = [...Array.from({ length: 29 }, (_, i) => i + 1), 37, 38, 39, 40, 41, 42, 43];
    expect(Object.keys(VALHALLA_MANEUVER_KIND).map(Number).sort((a, b) => a - b)).toEqual(expected);
    expect(MANEUVER_KINDS).toContain('other');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm vitest run packages/core/src/maneuver.test.ts`
Expected: FAIL — `Cannot find module './maneuver'`.

- [ ] **Step 3: Thêm kiểu vào `types.ts`**

Thêm vào **cuối** `packages/core/src/types.ts`:
```ts
/** Phương tiện cho `GET /v1/directions` (spec dẫn đường A). */
export type TravelMode = 'motorbike' | 'car' | 'walk';
export type DirectionsLang = 'vi' | 'en';

/** Loại bước rẽ theo tập cố định của MapsLibVN — không phụ thuộc engine. */
export type ManeuverKind =
  | 'depart'
  | 'arrive'
  | 'continue'
  | 'slight_right'
  | 'slight_left'
  | 'turn_right'
  | 'turn_left'
  | 'sharp_right'
  | 'sharp_left'
  | 'uturn_right'
  | 'uturn_left'
  | 'ramp_straight'
  | 'ramp_right'
  | 'ramp_left'
  | 'exit_right'
  | 'exit_left'
  | 'keep_right'
  | 'keep_left'
  | 'merge'
  | 'merge_right'
  | 'merge_left'
  | 'roundabout_enter'
  | 'roundabout_exit'
  | 'ferry_enter'
  | 'ferry_exit'
  | 'elevator'
  | 'steps'
  | 'escalator'
  | 'building_enter'
  | 'building_exit'
  | 'other';

export interface RouteStep {
  kind: ManeuverKind;
  instruction: string;
  verbal_pre: string | null;
  verbal_post: string | null;
  street_names: string[];
  distance_m: number;
  duration_s: number;
  /** Chỉ số điểm trong polyline của CẢ tuyến (đã dịch qua các leg). */
  shape_begin: number;
  shape_end: number;
  /** [lng, lat] điểm bắt đầu bước. */
  location: [number, number];
  /** Số lối ra khi `kind = roundabout_enter`, còn lại null. */
  roundabout_exit: number | null;
}

export interface RouteLeg {
  distance_m: number;
  duration_s: number;
  /** Chỉ số điểm đầu của leg trong polyline tuyến. */
  shape_offset: number;
  steps: RouteStep[];
}

export interface Route {
  mode: TravelMode;
  distance_m: number;
  duration_s: number;
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  /** polyline6 của cả tuyến — giải mã bằng `decodePolyline6` → `[lng, lat][]`. */
  geometry: string;
  legs: RouteLeg[];
  flags: { toll: boolean; highway: boolean; ferry: boolean };
}

export interface Waypoint {
  /** [lng, lat] điểm người dùng gửi. */
  location: [number, number];
  /** [lng, lat] điểm trên tuyến gần nhất (đầu leg tương ứng). */
  snapped: [number, number];
  name: string | null;
}

export interface DirectionsResponse {
  routes: Route[];
  waypoints: Waypoint[];
  attribution: string;
  /** Thông tin chẩn đoán, không phải hợp đồng ổn định. */
  engine?: { name: string; graph: string | null };
}
```

- [ ] **Step 4: Viết `maneuver.ts`**

```ts
import type { ManeuverKind } from './types';

export const MANEUVER_KINDS: readonly ManeuverKind[] = [
  'depart',
  'arrive',
  'continue',
  'slight_right',
  'slight_left',
  'turn_right',
  'turn_left',
  'sharp_right',
  'sharp_left',
  'uturn_right',
  'uturn_left',
  'ramp_straight',
  'ramp_right',
  'ramp_left',
  'exit_right',
  'exit_left',
  'keep_right',
  'keep_left',
  'merge',
  'merge_right',
  'merge_left',
  'roundabout_enter',
  'roundabout_exit',
  'ferry_enter',
  'ferry_exit',
  'elevator',
  'steps',
  'escalator',
  'building_enter',
  'building_exit',
  'other',
];

/**
 * Mã maneuver Valhalla (0–43, `TripDirections_Maneuver_Type`) → kind MapsLibVN. Đặt ở core để Worker
 * và SDK dùng một bản (spec A mục 6); bảng chỉ là dữ liệu, không phải logic gọi engine.
 * Mã transit 30–36 và 0 (kNone) không có trong bảng → `other`.
 */
export const VALHALLA_MANEUVER_KIND: Readonly<Record<number, ManeuverKind>> = {
  1: 'depart',
  2: 'depart',
  3: 'depart',
  4: 'arrive',
  5: 'arrive',
  6: 'arrive',
  7: 'continue',
  8: 'continue',
  9: 'slight_right',
  10: 'turn_right',
  11: 'sharp_right',
  12: 'uturn_right',
  13: 'uturn_left',
  14: 'sharp_left',
  15: 'turn_left',
  16: 'slight_left',
  17: 'ramp_straight',
  18: 'ramp_right',
  19: 'ramp_left',
  20: 'exit_right',
  21: 'exit_left',
  22: 'continue',
  23: 'keep_right',
  24: 'keep_left',
  25: 'merge',
  26: 'roundabout_enter',
  27: 'roundabout_exit',
  28: 'ferry_enter',
  29: 'ferry_exit',
  37: 'merge_right',
  38: 'merge_left',
  39: 'elevator',
  40: 'steps',
  41: 'escalator',
  42: 'building_enter',
  43: 'building_exit',
};

export function maneuverKindFromValhalla(type: number): ManeuverKind {
  return VALHALLA_MANEUVER_KIND[type] ?? 'other';
}
```

Thêm vào cuối `packages/core/src/index.ts`:
```ts
export * from './maneuver';
```

- [ ] **Step 5: Chạy test và typecheck core**

Run: `pnpm vitest run packages/core/src/maneuver.test.ts && pnpm --filter @mapslibvn/core typecheck`
Expected: PASS 3 test; typecheck không lỗi.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/maneuver.ts packages/core/src/maneuver.test.ts packages/core/src/index.ts
git commit -m "feat(core): kiểu dữ liệu tuyến đường và bảng ManeuverKind

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: `@mapslibvn/core` — `client.directions()`, size-limit, README

**Files:**
- Modify: `packages/core/src/client.ts`
- Create: `packages/core/src/client.directions.test.ts`
- Modify: `packages/core/.size-limit.json`
- Modify: `packages/core/README.md:30`

- [ ] **Step 1: Viết test đỏ**

`packages/core/src/client.directions.test.ts`:
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

const EMPTY = { routes: [], waypoints: [], attribution: '© OpenStreetMap contributors' };

describe('client.directions', () => {
  it('ghép from/to dạng lat,lng, bỏ tham số undefined', async () => {
    const { client, calledUrl } = stubClient(EMPTY);
    await client.directions({ from: [10.7798, 106.699], to: [10.7725, 106.698] });
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/directions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '10.7798,106.699',
      to: '10.7725,106.698',
    });
  });

  it('via nối bằng ";", mode/lang truyền thẳng, alternatives true → 1', async () => {
    const { client, calledUrl } = stubClient(EMPTY);
    await client.directions({
      from: [10.7798, 106.699],
      to: [10.7725, 106.698],
      via: [
        [10.776, 106.698],
        [10.775, 106.699],
      ],
      mode: 'car',
      lang: 'en',
      alternatives: true,
    });
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({
      from: '10.7798,106.699',
      to: '10.7725,106.698',
      via: '10.776,106.698;10.775,106.699',
      mode: 'car',
      lang: 'en',
      alternatives: '1',
    });
  });

  it('alternatives false → 0; via rỗng không gửi', async () => {
    const { client, calledUrl } = stubClient(EMPTY);
    await client.directions({ from: [10, 106], to: [11, 107], via: [], alternatives: false });
    const params = Object.fromEntries(calledUrl().searchParams);
    expect(params.alternatives).toBe('0');
    expect(params.via).toBeUndefined();
  });

  it('trả nguyên response', async () => {
    const body = { ...EMPTY, engine: { name: 'valhalla', graph: '2026-09-15' } };
    const { client } = stubClient(body);
    expect(await client.directions({ from: [10, 106], to: [11, 107] })).toEqual(body);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm vitest run packages/core/src/client.directions.test.ts`
Expected: FAIL — `client.directions is not a function`.

- [ ] **Step 3: Sửa `client.ts`**

Thêm vào import type từ `./types`: `DirectionsLang`, `DirectionsResponse`, `TravelMode`.

Thêm sau `AttributionResponse`:
```ts
export interface DirectionsOptions {
  /** [lat, lng] — vĩ độ trước, cùng quy ước với `near`. */
  from: [number, number];
  to: [number, number];
  /** Tối đa 5 điểm dừng, mỗi điểm [lat, lng]. */
  via?: [number, number][];
  /** Mặc định máy chủ: `motorbike`. */
  mode?: TravelMode;
  /** Mặc định máy chủ: `vi`. */
  lang?: DirectionsLang;
  /** Xin thêm một tuyến thay thế (bị bỏ qua khi có `via`). */
  alternatives?: boolean;
}

const latLng = ([lat, lng]: readonly [number, number]): string => `${lat},${lng}`;
```

Thêm phương thức vào object trả về của `createClient`, ngay trước `suggestEdit`:
```ts
    /** Chỉ đường (spec dẫn đường A). Response dùng [lng, lat]; tham số vào dùng [lat, lng]. */
    directions: (opts: DirectionsOptions) =>
      get<DirectionsResponse>('/v1/directions', {
        from: latLng(opts.from),
        to: latLng(opts.to),
        via: opts.via && opts.via.length > 0 ? opts.via.map(latLng).join(';') : undefined,
        mode: opts.mode,
        lang: opts.lang,
        alternatives: opts.alternatives === undefined ? undefined : opts.alternatives ? 1 : 0,
      }),
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `pnpm vitest run packages/core/src/client.directions.test.ts`
Expected: PASS 4 test.

- [ ] **Step 5: Build core và xử lý size-limit**

Run: `pnpm --filter @mapslibvn/core build`
Expected: nếu in `Size limit: 10 kB … exceeded` thì sửa `packages/core/.size-limit.json` `"limit": "10 kB"` → `"limit": "12 kB"` (spec A mục 9: barrel 9,5 kB gzip trước khi thêm polyline + bảng maneuver) và chạy lại build. Ghi số đo mới (dòng `Size:` trong output) để đưa vào DEVLOG ở Task 19.

- [ ] **Step 6: README core**

Trong `packages/core/README.md` dòng 30, câu bắt đầu `API gồm autocomplete, search, nearby, geocode, reverse geocode, chi tiết địa điểm, style URL và` → chèn `chỉ đường (directions), ` ngay sau `chi tiết địa điểm, `.

- [ ] **Step 7: Lint, typecheck, commit**

Run: `pnpm lint && pnpm --filter @mapslibvn/core typecheck`
Expected: không lỗi.

```bash
git add packages/core
git commit -m "feat(core): client.directions() và kiểu DirectionsOptions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: API — biến môi trường, cột quota mới trong auth, nhóm quota `directions`

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/auth.ts` (AuthInfo, loadAuth SQL)
- Modify: `apps/api/src/quota.ts`
- Modify: `apps/api/test/helpers/seed-key.ts`
- Modify: `apps/api/test/quota.test.ts` (thêm test `dailyLimit`)
- Create: `apps/api/test/auth-sql.test.ts`
- Modify: `apps/api/wrangler.toml`, `apps/api/vitest.config.ts`

- [ ] **Step 1: Viết test đỏ cho `dailyLimit` và SQL tra khoá**

Thêm vào cuối `apps/api/test/quota.test.ts` (trong `describe` hiện có, sau test cuối):
```ts
  const base = {
    keyHash: 'h',
    keyPrefix: 'mlv_live_x',
    tenantId: 't',
    plan: 'free' as const,
    kind: 'server' as const,
    scopes: ['places:read'],
    allowedOrigins: [],
    quotaPlacesPerDay: null,
    quotaDirectionsPerDay: null,
  };

  it('dailyLimit: nhóm directions dùng cột riêng và mặc định 2.000 (spec A mục 5.5)', () => {
    expect(dailyLimit(base, 'places')).toBe(FREE_PLACES_PER_DAY);
    expect(dailyLimit({ ...base, quotaPlacesPerDay: 5 }, 'directions')).toBe(FREE_DIRECTIONS_PER_DAY);
    expect(dailyLimit({ ...base, quotaPlacesPerDay: 5, quotaDirectionsPerDay: 7 }, 'directions')).toBe(7);
    expect(FREE_DIRECTIONS_PER_DAY).toBe(2_000);
  });

  it('burst theo khoá+IP: directions có binding riêng; trần theo khoá chỉ áp cho khoá web/mobile ở directions', () => {
    const places = { limit: async () => ({ success: true }) };
    const directions = { limit: async () => ({ success: true }) };
    const cap = { limit: async () => ({ success: true }) };
    const env = {
      PLACES_RATE_LIMITER: places,
      DIRECTIONS_RATE_LIMITER: directions,
      DIRECTIONS_KEY_RATE_LIMITER: cap,
    };
    expect(burstLimiterFor(env, 'places')).toBe(places);
    expect(burstLimiterFor(env, 'directions')).toBe(directions);
    expect(burstLimiterFor({ PLACES_RATE_LIMITER: places }, 'directions')).toBeUndefined();
    expect(keyCapLimiterFor(env, { ...base, kind: 'web' }, 'directions')).toBe(cap);
    expect(keyCapLimiterFor(env, { ...base, kind: 'mobile', plan: 'internal' }, 'directions')).toBe(cap);
    expect(keyCapLimiterFor(env, { ...base, kind: 'server', plan: 'internal' }, 'directions')).toBeUndefined();
    expect(keyCapLimiterFor(env, { ...base, kind: 'web' }, 'places')).toBeUndefined();
  });
```
Sửa dòng import của file thành:
```ts
import {
  FREE_DIRECTIONS_PER_DAY,
  FREE_PLACES_PER_DAY,
  burstLimiterFor,
  dailyLimit,
  enforceBurstLimit,
  keyCapLimiterFor,
  rateLimitActor,
  vnDay,
} from '../src/quota';
```

`apps/api/test/auth-sql.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { selectApiKey } from '../src/auth';
import { fakeSql } from './helpers/fake-sql';

describe('SQL tra khoá API', () => {
  it('đọc quota_directions_per_day qua to_jsonb để chạy được khi cột chưa có (spec A mục 5.5)', async () => {
    const { sql, calls } = fakeSql([]);
    await selectApiKey(sql, 'abc');
    const text = calls[0]?.text ?? '';
    expect(text).toContain("(to_jsonb(k) ->> 'quota_directions_per_day')::int AS quota_directions_per_day");
    expect(text).not.toMatch(/k\.quota_directions_per_day/);
    expect(text).toContain('WHERE k.key_hash = $1 AND k.active AND k.revoked_at IS NULL');
    expect(calls[0]?.params).toEqual(['abc']);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/quota.test.ts test/auth-sql.test.ts`
Expected: FAIL — `dailyLimit`/`FREE_DIRECTIONS_PER_DAY`/`selectApiKey` không tồn tại.

- [ ] **Step 3: `env.ts`**

Thêm vào interface `Env` (sau `AUTOCOMPLETE_TELEX`):
```ts
  /** Gốc Valhalla (spec dẫn đường A): dev `http://127.0.0.1:8002`, production hostname Tunnel. Vắng → 503. */
  ROUTING_BASE?: string;
  /** Service token Cloudflare Access cho hostname routing; production đặt bằng `wrangler secret put`. */
  ROUTING_ACCESS_CLIENT_ID?: string;
  ROUTING_ACCESS_CLIENT_SECRET?: string;
  /** Burst riêng cho /v1/directions: 20 request/phút/colo theo khoá+IP (Valhalla đắt hơn Postgres). */
  DIRECTIONS_RATE_LIMITER?: RateLimit;
  /**
   * Trần tổng theo KHOÁ (mọi IP cộng lại) cho khoá web/mobile ở /v1/directions: 100 request/phút/colo.
   * Khoá web/mobile nằm công khai trong HTML/app (vd khoá demo docs của tenant internal) — không có trần
   * này thì ai lấy được khoá là dùng Valhalla không giới hạn. Dùng Rate Limiting thay KV vì Workers Free
   * chỉ cho 1.000 ghi KV/ngày (quyết định PHONG 10/09/2026).
   */
  DIRECTIONS_KEY_RATE_LIMITER?: RateLimit;
```

- [ ] **Step 4: `auth.ts`**

Trong `AuthInfo` thêm sau `quotaPlacesPerDay`:
```ts
  /** NULL → mặc định plan (FREE_DIRECTIONS_PER_DAY). Cột thêm ở migration 0012. */
  quotaDirectionsPerDay: number | null;
```

Tách câu SQL trong `loadAuth` thành hàm export (đặt ngay trên `loadAuth`):
```ts
interface ApiKeyRow {
  key_hash: string;
  key_prefix: string;
  kind: AuthInfo['kind'];
  scopes: string[] | string;
  allowed_origins: string[] | string;
  quota_places_per_day: number | null;
  quota_directions_per_day: number | null;
  tenant_id: string;
  plan: AuthInfo['plan'];
}

/**
 * `quota_directions_per_day` đọc qua `to_jsonb(k) ->> …` thay vì tham chiếu cột: Postgres phân giải
 * cột lúc parse, nên tham chiếu trực tiếp sẽ làm MỌI request có khoá 503 nếu Worker deploy trước
 * migration 0012 (sự cố 06–07/09/2026). Cột chưa có → NULL → dùng mặc định plan.
 */
export function selectApiKey(sql: ReturnType<typeof getSql>, keyHash: string) {
  return sql<ApiKeyRow[]>`SELECT k.key_hash, k.key_prefix, k.kind, k.scopes, k.allowed_origins,
        k.quota_places_per_day,
        (to_jsonb(k) ->> 'quota_directions_per_day')::int AS quota_directions_per_day,
        t.id AS tenant_id, t.plan
      FROM api_key k JOIN tenant t ON t.id = k.tenant_id
      WHERE k.key_hash = ${keyHash} AND k.active AND k.revoked_at IS NULL`;
}
```
Trong `loadAuth` thay khối `const [row] = await sql<{…}[]>\`SELECT …\`` bằng `const [row] = await selectApiKey(sql, keyHash);` và thêm vào object `info`: `quotaDirectionsPerDay: row.quota_directions_per_day,`. Ở nhánh `cached` thêm `quotaDirectionsPerDay: cached.quotaDirectionsPerDay ?? null,` (entry KV cũ chưa có trường).

- [ ] **Step 5: `quota.ts`**

Thay đầu file (import + hằng + ba hàm thuần):
```ts
import type { Context, Next } from 'hono';
import type { AuthInfo } from './auth';
import type { AppEnv, Env } from './env';
import { ApiError } from './errors';

/** Mặc định plan free (spec 6.4): 20.000 places/ngày. */
export const FREE_PLACES_PER_DAY = 20_000;
/** Mặc định plan free cho /v1/directions (spec dẫn đường A mục 5.5): một lượt tính tuyến đắt hơn một lượt tìm. */
export const FREE_DIRECTIONS_PER_DAY = 2_000;
export type QuotaGroup = 'places' | 'directions';
type LimiterEnv = Pick<
  Env,
  'PLACES_RATE_LIMITER' | 'DIRECTIONS_RATE_LIMITER' | 'DIRECTIONS_KEY_RATE_LIMITER'
>;

export function dailyLimit(auth: AuthInfo, group: QuotaGroup): number {
  if (group === 'directions') return auth.quotaDirectionsPerDay ?? FREE_DIRECTIONS_PER_DAY;
  return auth.quotaPlacesPerDay ?? FREE_PLACES_PER_DAY;
}

/** Burst theo khoá+IP tại edge: directions có binding riêng, ngưỡng thấp hơn Places. */
export function burstLimiterFor(env: LimiterEnv, group: QuotaGroup): RateLimit | undefined {
  return group === 'directions' ? env.DIRECTIONS_RATE_LIMITER : env.PLACES_RATE_LIMITER;
}

/**
 * Trần tổng theo khoá (mọi IP cộng lại) cho khoá `web`/`mobile` ở directions. Khoá loại này nằm công
 * khai trong HTML/app nên plan internal cũng không được miễn (quyết định PHONG 10/09/2026 sau review
 * bảo mật); khoá `server` (app của chính PHONG) không chịu trần. Dùng Rate Limiting thay KV: không tốn
 * write KV (Workers Free 1.000 ghi/ngày) và kẻ tấn công không làm cạn được ngân sách KV của tài khoản.
 */
export function keyCapLimiterFor(
  env: LimiterEnv,
  auth: AuthInfo,
  group: QuotaGroup,
): RateLimit | undefined {
  if (group !== 'directions' || auth.kind === 'server') return undefined;
  return env.DIRECTIONS_KEY_RATE_LIMITER;
}
```
Đổi chữ ký `quotaMiddleware(group: 'places')` → `quotaMiddleware(group: QuotaGroup)` và thay khối từ `if (c.env.PLACES_RATE_LIMITER) {` tới dòng `const limit = …` bằng:
```ts
    const burst = burstLimiterFor(c.env, group);
    if (burst) {
      const actor = await rateLimitActor(auth.keyHash, c.req.header('cf-connecting-ip') ?? 'unknown');
      await enforceBurstLimit(burst, actor);
    }
    const cap = keyCapLimiterFor(c.env, auth, group);
    if (cap) await enforceBurstLimit(cap, auth.keyHash); // khoá theo keyHash thuần: gộp mọi IP
    if (c.env.QUOTA_ENABLED !== '1' || auth.plan === 'internal') return next();
    const limit = dailyLimit(auth, group);
```
Phần còn lại của middleware (đếm KV, 429 `quota_exceeded`) giữ nguyên. Tenant internal vẫn không đọc/ghi KV.

- [ ] **Step 6: helper, wrangler, vitest**

`apps/api/test/helpers/seed-key.ts`: thêm `quotaDirectionsPerDay: null,` sau `quotaPlacesPerDay: null,`. Các test khác dựng `AuthInfo` tay (`analytics.test.ts:24`, `auth-hash.test.ts:31`) sẽ báo lỗi typecheck → thêm `quotaDirectionsPerDay: null,` vào từng chỗ.

`apps/api/wrangler.toml`: trong `[vars]` thêm `ROUTING_BASE = "http://127.0.0.1:8002"`; trong `[env.production] vars = { … }` thêm `ROUTING_BASE = "https://maps-route.ai-solutions.io.vn"` (hostname theo mẫu `maps-db.<domain>` hiện có). Thay dòng `ratelimits = [...]` của `[env.production]` bằng ba binding (`namespace_id` phải khác nhau trong tài khoản; `period` chỉ nhận 10 hoặc 60):
```toml
ratelimits = [
  { name = "PLACES_RATE_LIMITER", namespace_id = "20260910", simple = { limit = 60, period = 60 } },
  { name = "DIRECTIONS_RATE_LIMITER", namespace_id = "20260911", simple = { limit = 20, period = 60 } },
  { name = "DIRECTIONS_KEY_RATE_LIMITER", namespace_id = "20260912", simple = { limit = 100, period = 60 } },
]
```
Kiểm bằng `pnpm --filter @mapslibvn/api exec wrangler deploy --dry-run --env production` → dòng binding liệt kê đủ ba limiter.

`apps/api/vitest.config.ts` `bindings`: thêm `ROUTING_BASE: 'https://routing.test',`; `ratelimits`: thêm `DIRECTIONS_RATE_LIMITER: { simple: { limit: 10_000, period: 60 } }` và `DIRECTIONS_KEY_RATE_LIMITER: { simple: { limit: 10_000, period: 60 } }` (ngưỡng cao để test không 429 chéo; quyết định deny đã test bằng fake ở `quota.test.ts`).

- [ ] **Step 7: Chạy test và typecheck**

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: toàn bộ API test xanh (bộ cũ + 2 test mới), typecheck sạch.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/env.ts apps/api/src/auth.ts apps/api/src/quota.ts apps/api/test apps/api/wrangler.toml apps/api/vitest.config.ts
git commit -m "feat(api): nhóm quota directions và đọc cột quota mới không phụ thuộc migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: API — `routing/params.ts` (validate tham số, giới hạn khoảng cách, khoá cache)

**Files:**
- Create: `apps/api/src/routing/params.ts`
- Create: `apps/api/test/routing-params.test.ts`

- [ ] **Step 1: Viết test đỏ**

`apps/api/test/routing-params.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  MAX_CROW_DISTANCE_M,
  directionsCacheUrl,
  haversineM,
  parseDirectionsParams,
} from '../src/routing/params';

const HCM = { lat: 10.7769, lng: 106.7009 };
const HN = { lat: 21.0285, lng: 105.8542 };
const base = { from: '10.7798,106.6990', to: '10.7725,106.6980' };

describe('routing params', () => {
  it('haversine HCM→HN ≈ 1.137 km', () => {
    const d = haversineM(HCM, HN);
    expect(d).toBeGreaterThan(1_100_000);
    expect(d).toBeLessThan(1_180_000);
    expect(haversineM(HCM, HCM)).toBe(0);
  });

  it('mặc định motorbike/vi/không alternatives; from trước, to sau', () => {
    expect(parseDirectionsParams(base)).toEqual({
      locations: [
        { lat: 10.7798, lng: 106.699 },
        { lat: 10.7725, lng: 106.698 },
      ],
      mode: 'motorbike',
      lang: 'vi',
      alternatives: false,
    });
  });

  it('via xen giữa theo thứ tự; tối đa 5 điểm', () => {
    const p = parseDirectionsParams({ ...base, via: '10.776,106.698;10.775,106.699' });
    expect(p.locations.map((l) => l.lat)).toEqual([10.7798, 10.776, 10.775, 10.7725]);
    const six = Array.from({ length: 6 }, (_, i) => `10.77${i},106.69`).join(';');
    expect(() => parseDirectionsParams({ ...base, via: six })).toThrowError(ApiError);
  });

  it('thiếu from/to, mode/lang/alternatives lạ → 400 invalid_request', () => {
    const bad = [
      { to: base.to },
      { from: base.from },
      { ...base, mode: 'bike' },
      { ...base, lang: 'fr' },
      { ...base, alternatives: '2' },
      { ...base, via: '10.77' },
    ];
    for (const q of bad) {
      try {
        parseDirectionsParams(q);
        throw new Error('phải ném');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(400);
        expect((error as ApiError).code).toBe('invalid_request');
      }
    }
  });

  it('điểm ngoài hộp Việt Nam → 400 có chữ "Việt Nam"', () => {
    expect(() => parseDirectionsParams({ from: base.from, to: '13.75,100.50' })).toThrowError(
      /Việt Nam/,
    );
  });

  it('vượt giới hạn đường chim bay theo mode → 400 nêu giới hạn', () => {
    const canTho = '10.0341,105.7841';
    expect(() => parseDirectionsParams({ from: base.from, to: canTho, mode: 'walk' })).toThrowError(
      /50 km/,
    );
    expect(parseDirectionsParams({ from: base.from, to: canTho, mode: 'car' }).mode).toBe('car');
    expect(MAX_CROW_DISTANCE_M).toEqual({ motorbike: 500_000, car: 2_000_000, walk: 50_000 });
  });

  it('alternatives=1 chỉ giữ khi không có via (Valhalla không hỗ trợ multipoint)', () => {
    expect(parseDirectionsParams({ ...base, alternatives: '1' }).alternatives).toBe(true);
    expect(
      parseDirectionsParams({ ...base, alternatives: '1', via: '10.776,106.698' }).alternatives,
    ).toBe(false);
  });

  it('khoá cache làm tròn 5 chữ số và gồm mode/lang/alternatives', () => {
    const p = parseDirectionsParams({ from: '10.77981234,106.69901', to: base.to, mode: 'car' });
    expect(directionsCacheUrl(p)).toBe(
      'https://cache.mapslibvn/directions?v=1&p=10.77981%2C106.69901%3B10.77250%2C106.69800&m=car&l=vi&a=0',
    );
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-params.test.ts`
Expected: FAIL — module `../src/routing/params` không tồn tại.

- [ ] **Step 3: Viết `params.ts`**

```ts
import type { DirectionsLang, TravelMode } from '@mapslibvn/core';
import { ApiError } from '../errors';
import { type LatLng, parseLatLngPair } from '../params';

export const TRAVEL_MODES: readonly TravelMode[] = ['motorbike', 'car', 'walk'];
export const DIRECTIONS_LANGS: readonly DirectionsLang[] = ['vi', 'en'];
export const MAX_VIA = 5;
/** Tổng đường chim bay giữa các điểm liên tiếp, mét (spec A mục 5.1). */
export const MAX_CROW_DISTANCE_M: Readonly<Record<TravelMode, number>> = {
  motorbike: 500_000,
  car: 2_000_000,
  walk: 50_000,
};
/** Hộp bao Việt Nam mở rộng. */
const VN = { minLat: 8, maxLat: 24, minLng: 102, maxLng: 110 };

export interface DirectionsParams {
  /** from, …via, to */
  locations: LatLng[];
  mode: TravelMode;
  lang: DirectionsLang;
  alternatives: boolean;
}

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const inVietnam = (p: LatLng) =>
  p.lat >= VN.minLat && p.lat <= VN.maxLat && p.lng >= VN.minLng && p.lng <= VN.maxLng;

function requirePair(raw: string | undefined, name: string): LatLng {
  const pair = parseLatLngPair(raw, name);
  if (!pair) throw new ApiError(400, 'invalid_request', `${name} bắt buộc, dạng "lat,lng"`);
  return pair;
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[], dflt: T, name: string): T {
  const value = (raw?.trim() || dflt) as T;
  if (!allowed.includes(value)) {
    throw new ApiError(400, 'invalid_request', `${name} chỉ nhận ${allowed.join(', ')}`);
  }
  return value;
}

/** Kiểm tra hết ở Worker trước khi gọi Valhalla — request sai không được tốn máy chủ nhà. */
export function parseDirectionsParams(q: Record<string, string | undefined>): DirectionsParams {
  const from = requirePair(q.from, 'from');
  const to = requirePair(q.to, 'to');
  const viaRaw = (q.via ?? '').trim();
  const viaParts = viaRaw ? viaRaw.split(';') : [];
  // Đếm TRƯỚC khi parse: chuỗi via hàng nghìn điểm không được tốn CPU parse rồi mới bị từ chối.
  if (viaParts.length > MAX_VIA) {
    throw new ApiError(400, 'invalid_request', `via tối đa ${MAX_VIA} điểm`);
  }
  const via = viaParts.map((part, i) => requirePair(part, `via[${i}]`));
  const mode = oneOf(q.mode, TRAVEL_MODES, 'motorbike', 'mode');
  const lang = oneOf(q.lang, DIRECTIONS_LANGS, 'vi', 'lang');
  const alternativesRaw = q.alternatives?.trim() || '0';
  if (alternativesRaw !== '0' && alternativesRaw !== '1') {
    throw new ApiError(400, 'invalid_request', 'alternatives chỉ nhận 0 hoặc 1');
  }

  const locations = [from, ...via, to];
  if (!locations.every(inVietnam)) {
    throw new ApiError(400, 'invalid_request', 'Chỉ hỗ trợ chỉ đường trong Việt Nam');
  }
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

export function directionsCacheUrl(p: DirectionsParams): string {
  const points = p.locations.map(({ lat, lng }) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(';');
  return `https://cache.mapslibvn/directions?v=1&p=${encodeURIComponent(points)}&m=${p.mode}&l=${p.lang}&a=${p.alternatives ? 1 : 0}`;
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-params.test.ts`
Expected: PASS 8 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routing/params.ts apps/api/test/routing-params.test.ts
git commit -m "feat(api): validate tham số /v1/directions và giới hạn khoảng cách theo mode

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: API — `routing/valhalla.ts` (body, header Access, gọi engine, ánh xạ lỗi)

**Files:**
- Create: `apps/api/src/routing/valhalla.ts`
- Create: `apps/api/test/routing-valhalla.test.ts`

- [ ] **Step 1: Viết test đỏ**

`apps/api/test/routing-valhalla.test.ts`:
```ts
import { fetchMock } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  callValhalla,
  fetchValhallaStatus,
  mapValhallaError,
  routingBase,
  routingHeaders,
  valhallaBody,
} from '../src/routing/valhalla';

const env = { ROUTING_BASE: 'https://routing.test/' } as never;
const params = {
  locations: [
    { lat: 10.7798, lng: 106.699 },
    { lat: 10.7725, lng: 106.698 },
  ],
  mode: 'motorbike' as const,
  lang: 'vi' as const,
  alternatives: false,
};
const code = (e: unknown) => (e as ApiError).code;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

describe('valhallaBody', () => {
  it('ánh xạ mode→costing, lang→locale, lat/lng→lat/lon type break, id', () => {
    expect(valhallaBody(params, 'req-1')).toEqual({
      locations: [
        { lat: 10.7798, lon: 106.699, type: 'break' },
        { lat: 10.7725, lon: 106.698, type: 'break' },
      ],
      costing: 'motor_scooter',
      directions_options: { language: 'vi-VN', units: 'kilometers' },
      id: 'req-1',
    });
    expect(valhallaBody({ ...params, mode: 'car', lang: 'en' }, 'r').costing).toBe('auto');
    expect(valhallaBody({ ...params, mode: 'walk' }, 'r').costing).toBe('pedestrian');
    expect(valhallaBody({ ...params, lang: 'en' }, 'r').directions_options.language).toBe('en-US');
  });

  it('alternates chỉ có khi alternatives=true', () => {
    expect('alternates' in valhallaBody(params, 'r')).toBe(false);
    expect(valhallaBody({ ...params, alternatives: true }, 'r').alternates).toBe(1);
  });
});

describe('routingBase / routingHeaders', () => {
  it('cắt dấu / cuối; vắng ROUTING_BASE → 503 upstream_unavailable', () => {
    expect(routingBase({ ROUTING_BASE: 'https://x.test/' })).toBe('https://x.test');
    expect(() => routingBase({})).toThrowError(ApiError);
    try {
      routingBase({ ROUTING_BASE: '' });
    } catch (e) {
      expect((e as ApiError).status).toBe(503);
      expect(code(e)).toBe('upstream_unavailable');
    }
  });

  it('header Access chỉ khi đủ cả hai secret VÀ đích là https (không lộ token qua http)', () => {
    const secrets = { ROUTING_ACCESS_CLIENT_ID: 'id', ROUTING_ACCESS_CLIENT_SECRET: 's' };
    expect(routingHeaders({}, 'https://x.test')).toEqual({ 'content-type': 'application/json' });
    expect(routingHeaders({ ROUTING_ACCESS_CLIENT_ID: 'id' }, 'https://x.test')).toEqual({
      'content-type': 'application/json',
    });
    expect(routingHeaders(secrets, 'https://x.test')).toEqual({
      'content-type': 'application/json',
      'CF-Access-Client-Id': 'id',
      'CF-Access-Client-Secret': 's',
    });
    expect(routingHeaders(secrets, 'http://127.0.0.1:8002')).toEqual({
      'content-type': 'application/json',
    });
  });
});

describe('mapValhallaError', () => {
  it('HTTP 400 + 441/442/170/171 → 404 no_route; 400 khác → 400; mọi status khác → 503', () => {
    for (const code of [441, 442, 170, 171]) {
      expect(mapValhallaError(400, { error_code: code })).toMatchObject({
        status: 404,
        code: 'no_route',
      });
    }
    expect(mapValhallaError(400, { error_code: 154 })).toMatchObject({
      status: 400,
      code: 'invalid_request',
    });
    expect(mapValhallaError(400, null).message).toContain('400');
    // 302 = Access redirect về trang đăng nhập, 401/403 = token sai/hết hạn, 404/405 = sai đường dẫn,
    // 5xx = engine lỗi: đều là phía mình, không đổ lỗi cho người gọi.
    for (const status of [302, 401, 403, 404, 405, 500, 502]) {
      expect(mapValhallaError(status, null)).toMatchObject({
        status: 503,
        code: 'upstream_unavailable',
      });
    }
  });
});

describe('callValhalla / fetchValhallaStatus (fetchMock)', () => {
  it('200 → trả JSON; 400+442 → no_route; 500 → 503; lỗi mạng → 503', async () => {
    const origin = fetchMock.get('https://routing.test');
    origin.intercept({ path: '/route', method: 'POST' }).reply(200, { trip: { legs: [] } });
    expect(await callValhalla(env, {})).toEqual({ trip: { legs: [] } });

    origin.intercept({ path: '/route', method: 'POST' }).reply(400, { error_code: 442 });
    await expect(callValhalla(env, {})).rejects.toMatchObject({ status: 404, code: 'no_route' });

    origin.intercept({ path: '/route', method: 'POST' }).reply(500, 'boom');
    await expect(callValhalla(env, {})).rejects.toMatchObject({ status: 503 });

    origin.intercept({ path: '/route', method: 'POST' }).replyWithError(new Error('ECONNREFUSED'));
    await expect(callValhalla(env, {})).rejects.toMatchObject({ status: 503 });

    origin.intercept({ path: '/route', method: 'POST' }).reply(200, '<html>login</html>');
    await expect(callValhalla(env, {})).rejects.toMatchObject({ status: 503 });
  });

  it('timeout → 503', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init?.signal?.reason));
      });
    await expect(callValhalla(env, {}, { fetchImpl: hang, timeoutMs: 20 })).rejects.toMatchObject({
      status: 503,
      code: 'upstream_unavailable',
    });
  });

  it('status: 200 → version + tileset_last_modified; 500 → 503', async () => {
    const origin = fetchMock.get('https://routing.test');
    origin
      .intercept({ path: '/status', method: 'GET' })
      .reply(200, { version: '3.8.3', tileset_last_modified: 1789430400 });
    expect(await fetchValhallaStatus(env)).toEqual({ version: '3.8.3', tileset_last_modified: 1789430400 });
    origin.intercept({ path: '/status', method: 'GET' }).reply(500, 'x');
    await expect(fetchValhallaStatus(env)).rejects.toMatchObject({ status: 503 });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-valhalla.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `valhalla.ts`**

```ts
import type { DirectionsLang, TravelMode } from '@mapslibvn/core';
import type { Env } from '../env';
import { ApiError } from '../errors';
import type { DirectionsParams } from './params';

export const VALHALLA_COSTING: Readonly<Record<TravelMode, string>> = {
  motorbike: 'motor_scooter',
  car: 'auto',
  walk: 'pedestrian',
};
const VALHALLA_LANGUAGE: Readonly<Record<DirectionsLang, string>> = { vi: 'vi-VN', en: 'en-US' };
export const ROUTE_TIMEOUT_MS = 10_000;
export const STATUS_TIMEOUT_MS = 5_000;

/** Phần JSON Valhalla mà Worker đọc (docs/docs/api/route/api-reference.md của Valhalla 3.8). */
export interface ValhallaManeuver {
  type: number;
  instruction: string;
  verbal_pre_transition_instruction?: string;
  verbal_post_transition_instruction?: string;
  street_names?: string[];
  time: number;
  /** km (request gửi units=kilometers). */
  length: number;
  begin_shape_index: number;
  end_shape_index: number;
  roundabout_exit_count?: number;
}
export interface ValhallaSummary {
  time: number;
  length: number;
  has_toll?: boolean;
  has_highway?: boolean;
  has_ferry?: boolean;
  min_lat: number;
  min_lon: number;
  max_lat: number;
  max_lon: number;
}
export interface ValhallaLeg {
  summary: ValhallaSummary;
  /** polyline6 */
  shape: string;
  maneuvers: ValhallaManeuver[];
}
export interface ValhallaTrip {
  summary: ValhallaSummary;
  legs: ValhallaLeg[];
  locations: { lat: number; lon: number; street?: string }[];
}
export interface ValhallaRouteResponse {
  trip: ValhallaTrip;
  alternates?: { trip: ValhallaTrip }[];
  id?: string;
}
export interface ValhallaStatus {
  version?: string;
  /** UNIX giây lúc tar/thư mục tile đổi lần cuối. */
  tileset_last_modified?: number;
}
interface ValhallaErrorBody {
  error_code?: number;
  error?: string;
  status_code?: number;
}

type RoutingEnv = Pick<Env, 'ROUTING_BASE' | 'ROUTING_ACCESS_CLIENT_ID' | 'ROUTING_ACCESS_CLIENT_SECRET'>;

export function valhallaBody(p: DirectionsParams, requestId: string) {
  return {
    locations: p.locations.map(({ lat, lng }) => ({ lat, lon: lng, type: 'break' })),
    costing: VALHALLA_COSTING[p.mode],
    directions_options: { language: VALHALLA_LANGUAGE[p.lang], units: 'kilometers' },
    ...(p.alternatives ? { alternates: 1 } : {}),
    id: requestId,
  };
}

export function routingBase(env: Pick<Env, 'ROUTING_BASE'>): string {
  const base = env.ROUTING_BASE?.replace(/\/+$/, '');
  if (!base) throw new ApiError(503, 'upstream_unavailable', 'Chưa cấu hình routing (ROUTING_BASE)');
  return base;
}

/**
 * Header Access chỉ khi đủ cả hai secret (production) VÀ đích là https — không bao giờ gửi service
 * token qua http kể cả khi ai đó cấu hình nhầm ROUTING_BASE. Dev gọi thẳng localhost không header.
 */
export function routingHeaders(
  env: Pick<Env, 'ROUTING_ACCESS_CLIENT_ID' | 'ROUTING_ACCESS_CLIENT_SECRET'>,
  base: string,
): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const secure = base.startsWith('https://');
  if (secure && env.ROUTING_ACCESS_CLIENT_ID && env.ROUTING_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.ROUTING_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.ROUTING_ACCESS_CLIENT_SECRET;
  }
  return headers;
}

/**
 * Mã lỗi Valhalla → lỗi API (spec A mục 5.3). Chỉ HTTP 400 là lỗi đầu vào theo Valhalla; mọi status
 * khác (302 redirect của Access, 401/403 token sai hoặc hết hạn, 404/405 sai đường dẫn, 5xx) là cấu
 * hình hoặc hạ tầng phía mình → 503, không đổ lỗi cho người gọi.
 */
export function mapValhallaError(status: number, body: ValhallaErrorBody | null): ApiError {
  const code = body?.error_code;
  if (status === 400 && (code === 442 || code === 441)) {
    return new ApiError(404, 'no_route', 'Không tìm được đường giữa các điểm');
  }
  if (status === 400 && (code === 170 || code === 171)) {
    return new ApiError(404, 'no_route', 'Điểm quá xa mạng đường hoặc nằm trong vùng không kết nối');
  }
  if (status === 400) {
    return new ApiError(400, 'invalid_request', `Engine từ chối yêu cầu (mã ${code ?? status})`);
  }
  return new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường không phản hồi');
}

interface CallOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function routingFetch(
  env: RoutingEnv,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const base = routingBase(env);
  try {
    return await fetchImpl(`${base}${path}`, {
      ...init,
      headers: routingHeaders(env, base),
      // Không theo redirect: Access trả 302 về trang đăng nhập khi token sai → phải thành 503,
      // không được đi tới URL lạ rồi parse HTML.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.error('routing fetch', path, error);
    throw new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường không phản hồi');
  }
}

export async function callValhalla(
  env: RoutingEnv,
  body: unknown,
  options: CallOptions = {},
): Promise<ValhallaRouteResponse> {
  const response = await routingFetch(
    env,
    '/route',
    { method: 'POST', body: JSON.stringify(body) },
    options.timeoutMs ?? ROUTE_TIMEOUT_MS,
    options.fetchImpl ?? fetch,
  );
  if (!response.ok) {
    let parsed: ValhallaErrorBody | null = null;
    try {
      parsed = (await response.json()) as ValhallaErrorBody;
    } catch {
      parsed = null;
    }
    if (response.status >= 500 || response.status === 403) {
      console.error('valhalla', response.status, parsed);
    }
    throw mapValhallaError(response.status, parsed);
  }
  try {
    return (await response.json()) as ValhallaRouteResponse;
  } catch (error) {
    console.error('valhalla body không phải JSON', error);
    throw new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường trả dữ liệu không hợp lệ');
  }
}

export async function fetchValhallaStatus(
  env: RoutingEnv,
  options: CallOptions = {},
): Promise<ValhallaStatus> {
  const response = await routingFetch(
    env,
    '/status',
    { method: 'GET' },
    options.timeoutMs ?? STATUS_TIMEOUT_MS,
    options.fetchImpl ?? fetch,
  );
  if (!response.ok) {
    throw new ApiError(503, 'upstream_unavailable', `Valhalla /status trả ${response.status}`);
  }
  try {
    return (await response.json()) as ValhallaStatus;
  } catch {
    throw new ApiError(503, 'upstream_unavailable', 'Valhalla /status trả dữ liệu không hợp lệ');
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-valhalla.test.ts`
Expected: PASS 8 test. Nếu `replyWithError` không tồn tại ở phiên bản undici đi kèm, thay bằng `.reply(() => { throw new Error('ECONNREFUSED'); })`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routing/valhalla.ts apps/api/test/routing-valhalla.test.ts
git commit -m "feat(api): gọi Valhalla qua Access, ánh xạ lỗi engine sang lỗi API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: API — `routing/translate.ts` (JSON Valhalla → `DirectionsResponse`)

**Files:**
- Create: `apps/api/test/fixtures/valhalla/two-legs.json`
- Create: `apps/api/src/routing/translate.ts`
- Create: `apps/api/test/routing-translate.test.ts`

- [ ] **Step 1: Fixture tay (hình dạng đúng tài liệu Valhalla 3.8, polyline6 đã kiểm ngược ở Task 1)**

`apps/api/test/fixtures/valhalla/two-legs.json`:
```json
{
  "trip": {
    "locations": [
      { "type": "break", "lat": 10.7798, "lon": 106.699, "original_index": 0 },
      { "type": "break", "lat": 10.776, "lon": 106.698, "original_index": 1 },
      { "type": "break", "lat": 10.7725, "lon": 106.6981, "original_index": 2 }
    ],
    "legs": [
      {
        "maneuvers": [
          {
            "type": 1,
            "instruction": "Đi về hướng nam trên Đồng Khởi.",
            "verbal_pre_transition_instruction": "Đi về hướng nam trên Đồng Khởi trong 200 mét.",
            "verbal_post_transition_instruction": "Đi tiếp 200 mét.",
            "street_names": ["Đồng Khởi"],
            "time": 30,
            "length": 0.2,
            "begin_shape_index": 0,
            "end_shape_index": 1
          },
          {
            "type": 15,
            "instruction": "Rẽ trái vào Lê Lợi.",
            "verbal_pre_transition_instruction": "Rẽ trái vào Lê Lợi.",
            "street_names": ["Lê Lợi"],
            "time": 45.4,
            "length": 0.25,
            "begin_shape_index": 1,
            "end_shape_index": 2
          },
          {
            "type": 4,
            "instruction": "Bạn đã đến điểm dừng.",
            "time": 0,
            "length": 0,
            "begin_shape_index": 2,
            "end_shape_index": 2
          }
        ],
        "summary": {
          "has_toll": false,
          "has_highway": false,
          "has_ferry": false,
          "min_lat": 10.776,
          "min_lon": 106.698,
          "max_lat": 10.7798,
          "max_lon": 106.699,
          "time": 75.4,
          "length": 0.45
        },
        "shape": "oh}pSonkojEnoBf^~{Bf^"
      },
      {
        "maneuvers": [
          {
            "type": 8,
            "instruction": "Đi tiếp trên Lê Lợi.",
            "street_names": ["Lê Lợi"],
            "time": 20,
            "length": 0.17,
            "begin_shape_index": 0,
            "end_shape_index": 1
          },
          {
            "type": 26,
            "instruction": "Vào vòng xuyến và đi lối ra thứ 2.",
            "roundabout_exit_count": 2,
            "time": 15,
            "length": 0.2,
            "begin_shape_index": 1,
            "end_shape_index": 2
          },
          {
            "type": 6,
            "instruction": "Điểm đến ở bên trái.",
            "time": 0,
            "length": 0,
            "begin_shape_index": 2,
            "end_shape_index": 2
          }
        ],
        "summary": {
          "has_toll": true,
          "has_highway": false,
          "has_ferry": false,
          "min_lat": 10.7725,
          "min_lon": 106.6975,
          "max_lat": 10.776,
          "max_lon": 106.6981,
          "time": 35,
          "length": 0.37
        },
        "shape": "_{upS_piojEv|Af^~{Bod@"
      }
    ],
    "summary": {
      "has_toll": true,
      "has_highway": false,
      "has_ferry": false,
      "min_lat": 10.7725,
      "min_lon": 106.6975,
      "max_lat": 10.7798,
      "max_lon": 106.699,
      "time": 110.4,
      "length": 0.82
    },
    "status_message": "Found route between points",
    "status": 0,
    "units": "kilometers",
    "language": "vi-VN"
  },
  "id": "test-request"
}
```

- [ ] **Step 2: Viết test đỏ**

`apps/api/test/routing-translate.test.ts`:
```ts
import { decodePolyline6 } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import { mergeLegShapes, translateDirections } from '../src/routing/translate';
import type { ValhallaRouteResponse } from '../src/routing/valhalla';
import fixture from './fixtures/valhalla/two-legs.json';

const json = fixture as unknown as ValhallaRouteResponse;

describe('mergeLegShapes', () => {
  it('bỏ điểm trùng giữa hai leg và ghi offset', () => {
    const merged = mergeLegShapes(json.trip.legs);
    expect(merged.coords).toEqual([
      [106.699, 10.7798],
      [106.6985, 10.778],
      [106.698, 10.776],
      [106.6975, 10.7745],
      [106.6981, 10.7725],
    ]);
    expect(merged.offsets).toEqual([0, 2]);
  });
});

describe('translateDirections', () => {
  const out = translateDirections(json, 'motorbike', '2026-09-15');
  const route = out.routes[0];

  it('tuyến: mét/giây nguyên, bbox [minLng,minLat,maxLng,maxLat], flags, geometry nối', () => {
    expect(out.routes).toHaveLength(1);
    expect(route).toMatchObject({
      mode: 'motorbike',
      distance_m: 820,
      duration_s: 110,
      bbox: [106.6975, 10.7725, 106.699, 10.7798],
      flags: { toll: true, highway: false, ferry: false },
    });
    expect(decodePolyline6(route?.geometry ?? '')).toHaveLength(5);
    expect(route?.geometry).toBe('oh}pSonkojEnoBf^~{Bf^v|Af^~{Bod@');
  });

  it('leg và bước: offset, chỉ số shape đã dịch, kind, verbal, roundabout_exit, location', () => {
    const [leg0, leg1] = route?.legs ?? [];
    expect(leg0).toMatchObject({ distance_m: 450, duration_s: 75, shape_offset: 0 });
    expect(leg1).toMatchObject({ distance_m: 370, duration_s: 35, shape_offset: 2 });
    expect(leg0?.steps.map((s) => s.kind)).toEqual(['depart', 'turn_left', 'arrive']);
    expect(leg0?.steps[0]).toMatchObject({
      verbal_pre: 'Đi về hướng nam trên Đồng Khởi trong 200 mét.',
      verbal_post: 'Đi tiếp 200 mét.',
      street_names: ['Đồng Khởi'],
      distance_m: 200,
      duration_s: 30,
      shape_begin: 0,
      shape_end: 1,
      location: [106.699, 10.7798],
      roundabout_exit: null,
    });
    expect(leg0?.steps[1]).toMatchObject({ verbal_post: null, distance_m: 250, duration_s: 45 });
    expect(leg0?.steps[2]).toMatchObject({ street_names: [], shape_begin: 2, shape_end: 2 });
    expect(leg1?.steps[0]).toMatchObject({ kind: 'continue', shape_begin: 2, shape_end: 3 });
    expect(leg1?.steps[1]).toMatchObject({
      kind: 'roundabout_enter',
      roundabout_exit: 2,
      shape_begin: 3,
      shape_end: 4,
      location: [106.6975, 10.7745],
    });
    expect(leg1?.steps[2]).toMatchObject({ kind: 'arrive', location: [106.6981, 10.7725] });
  });

  it('waypoints: location gốc, snapped = đầu leg / cuối tuyến, name null', () => {
    expect(out.waypoints).toEqual([
      { location: [106.699, 10.7798], snapped: [106.699, 10.7798], name: null },
      { location: [106.698, 10.776], snapped: [106.698, 10.776], name: null },
      { location: [106.6981, 10.7725], snapped: [106.6981, 10.7725], name: null },
    ]);
  });

  it('attribution và engine', () => {
    expect(out.attribution).toBe('© OpenStreetMap contributors');
    expect(out.engine).toEqual({ name: 'valhalla', graph: '2026-09-15' });
    expect(translateDirections(json, 'car', null).engine).toEqual({ name: 'valhalla', graph: null });
  });

  it('alternates → routes[1], cùng mode', () => {
    const withAlt = { ...json, alternates: [{ trip: json.trip }] };
    const alt = translateDirections(withAlt, 'car', null);
    expect(alt.routes).toHaveLength(2);
    expect(alt.routes[1]?.mode).toBe('car');
    expect(alt.routes[1]?.distance_m).toBe(820);
  });
});
```
Nếu TypeScript báo không import được `.json`, thêm `"resolveJsonModule": true` đã có ở `tsconfig.base.json` — kiểm `apps/api/tsconfig.json` kế thừa base; nếu vẫn lỗi, đọc fixture bằng `import fixture from './fixtures/valhalla/two-legs.json' with { type: 'json' }`.

- [ ] **Step 3: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-translate.test.ts`
Expected: FAIL — module `../src/routing/translate` không tồn tại.

- [ ] **Step 4: Viết `translate.ts`**

```ts
import {
  type DirectionsResponse,
  type Route,
  type RouteLeg,
  type RouteStep,
  type TravelMode,
  type Waypoint,
  decodePolyline6,
  encodePolyline6,
  maneuverKindFromValhalla,
} from '@mapslibvn/core';
import type { ValhallaLeg, ValhallaManeuver, ValhallaRouteResponse, ValhallaTrip } from './valhalla';

/** Dữ liệu đường là OSM (ODbL); Valhalla (MIT) không yêu cầu ghi nguồn trên UI. */
export const ROUTING_ATTRIBUTION = '© OpenStreetMap contributors';

export interface MergedShape {
  coords: [number, number][];
  /** Chỉ số điểm đầu của từng leg trong `coords`. */
  offsets: number[];
}

const kmToM = (km: number) => Math.round(km * 1000);
const seconds = (s: number) => Math.round(s);

/** Nối shape các leg: điểm cuối leg i trùng điểm đầu leg i+1 → bỏ điểm trùng (spec A mục 5.2). */
export function mergeLegShapes(legs: readonly ValhallaLeg[]): MergedShape {
  const coords: [number, number][] = [];
  const offsets: number[] = [];
  for (const leg of legs) {
    const points = decodePolyline6(leg.shape);
    const drop = coords.length > 0 && points.length > 0 ? 1 : 0;
    offsets.push(coords.length - drop);
    coords.push(...points.slice(drop));
  }
  return { coords, offsets };
}

function pointAt(coords: readonly [number, number][], index: number): [number, number] {
  return coords[index] ?? coords[coords.length - 1] ?? [0, 0];
}

function translateManeuver(
  m: ValhallaManeuver,
  offset: number,
  coords: readonly [number, number][],
): RouteStep {
  const kind = maneuverKindFromValhalla(m.type);
  const begin = m.begin_shape_index + offset;
  return {
    kind,
    instruction: m.instruction,
    verbal_pre: m.verbal_pre_transition_instruction ?? null,
    verbal_post: m.verbal_post_transition_instruction ?? null,
    street_names: m.street_names ?? [],
    distance_m: kmToM(m.length),
    duration_s: seconds(m.time),
    shape_begin: begin,
    shape_end: m.end_shape_index + offset,
    location: pointAt(coords, begin),
    roundabout_exit: kind === 'roundabout_enter' ? (m.roundabout_exit_count ?? null) : null,
  };
}

export function translateTrip(
  trip: ValhallaTrip,
  mode: TravelMode,
  merged: MergedShape = mergeLegShapes(trip.legs),
): Route {
  const legs: RouteLeg[] = trip.legs.map((leg, i) => {
    const offset = merged.offsets[i] ?? 0;
    return {
      distance_m: kmToM(leg.summary.length),
      duration_s: seconds(leg.summary.time),
      shape_offset: offset,
      steps: leg.maneuvers.map((m) => translateManeuver(m, offset, merged.coords)),
    };
  });
  const s = trip.summary;
  return {
    mode,
    distance_m: kmToM(s.length),
    duration_s: seconds(s.time),
    bbox: [s.min_lon, s.min_lat, s.max_lon, s.max_lat],
    geometry: encodePolyline6(merged.coords),
    legs,
    flags: { toll: Boolean(s.has_toll), highway: Boolean(s.has_highway), ferry: Boolean(s.has_ferry) },
  };
}

/** Valhalla trả toạ độ gốc; `snapped` là điểm đầu leg tương ứng (điểm cuối tuyến cho waypoint cuối). */
export function translateWaypoints(trip: ValhallaTrip, merged: MergedShape): Waypoint[] {
  return trip.locations.map((loc, i) => {
    const index = i < merged.offsets.length ? (merged.offsets[i] ?? 0) : merged.coords.length - 1;
    return {
      location: [loc.lon, loc.lat],
      snapped: merged.coords[index] ?? [loc.lon, loc.lat],
      name: null,
    };
  });
}

export function translateDirections(
  json: ValhallaRouteResponse,
  mode: TravelMode,
  graph: string | null,
): DirectionsResponse {
  const merged = mergeLegShapes(json.trip.legs);
  const primary = translateTrip(json.trip, mode, merged);
  const alternates = (json.alternates ?? []).map((a) => translateTrip(a.trip, mode));
  return {
    routes: [primary, ...alternates],
    waypoints: translateWaypoints(json.trip, merged),
    attribution: ROUTING_ATTRIBUTION,
    engine: { name: 'valhalla', graph },
  };
}
```

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-translate.test.ts && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS 6 test; typecheck sạch.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routing/translate.ts apps/api/test/routing-translate.test.ts apps/api/test/fixtures/valhalla/two-legs.json
git commit -m "feat(api): dịch JSON Valhalla sang schema tuyến MapsLibVN

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: API — route `GET /v1/directions` và `GET /healthz/routing`

**Files:**
- Create: `apps/api/src/routes/directions.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/directions-route.test.ts`

- [ ] **Step 1: Viết test đỏ**

`apps/api/test/directions-route.test.ts`:
```ts
import { SELF, env, fetchMock } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';
import fixture from './fixtures/valhalla/two-legs.json';
import { seedKey, sha256Hex } from './helpers/seed-key';

const KEY = 'mlv_live_route0000000000000000000';
const FREE_KEY = 'mlv_live_routefree000000000000000';
const origin = () => fetchMock.get('https://routing.test');
const mockRoute = (status: number, body: unknown) =>
  origin().intercept({ path: '/route', method: 'POST' }).reply(status, body);
const mockStatus = () =>
  origin()
    .intercept({ path: '/status', method: 'GET' })
    .reply(200, { version: '3.8.3', tileset_last_modified: 1789430400 })
    .persist();
const call = (query: string, key = KEY) =>
  SELF.fetch(`https://api/v1/directions?${query}`, { headers: { 'X-Api-Key': key } });
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
// Mỗi test một cặp toạ độ khác nhau để không trúng cache của test trước.
const q = (suffix: number, extra = '') =>
  `from=10.779${suffix},106.6990&to=10.7725,106.6980${extra}`;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(async () => {
  await seedKey(KEY);
  mockStatus();
});

describe('GET /v1/directions', () => {
  it('không khoá → 401; thiếu to → 400; mode lạ → 400; ngoài VN → 400; walk 130 km → 400', async () => {
    expect((await SELF.fetch('https://api/v1/directions?from=10,106&to=11,107')).status).toBe(401);
    expect((await call('from=10.77,106.70')).status).toBe(400);
    expect((await call('from=10.77,106.70&to=10.78,106.71&mode=bike')).status).toBe(400);
    expect((await call('from=10.77,106.70&to=13.75,100.50')).status).toBe(400);
    expect((await call('from=10.77,106.70&to=10.0341,105.7841&mode=walk')).status).toBe(400);
  });

  it('tuyến hợp lệ → 200 theo schema MapsLibVN, engine.graph từ /status', async () => {
    mockRoute(200, fixture);
    const res = await call(q(1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      routes: { distance_m: number; legs: unknown[] }[];
      waypoints: unknown[];
      engine: { name: string; graph: string | null };
    };
    expect(body.routes[0]?.distance_m).toBe(820);
    expect(body.routes[0]?.legs).toHaveLength(2);
    expect(body.waypoints).toHaveLength(3);
    expect(body.engine).toEqual({ name: 'valhalla', graph: '2026-09-15' });
  });

  it('body gửi Valhalla: costing motor_scooter mặc định, không alternates khi có via', async () => {
    origin()
      .intercept({
        path: '/route',
        method: 'POST',
        body: (raw) => {
          const sent = JSON.parse(raw) as { costing: string; alternates?: number; locations: unknown[] };
          return sent.costing === 'motor_scooter' && sent.alternates === undefined && sent.locations.length === 3;
        },
      })
      .reply(200, fixture);
    const res = await call(q(2, '&via=10.776,106.698&alternatives=1'));
    expect(res.status).toBe(200);
  });

  it('Valhalla 400+442 → 404 no_route (không cache); 500 → 503 có retry-after 30', async () => {
    mockRoute(400, { error_code: 442, error: 'No path could be found for input' });
    const notFound = await call(q(3));
    expect(notFound.status).toBe(404);
    expect(await code(notFound)).toBe('no_route');

    mockRoute(500, 'boom');
    const down = await call(q(4));
    expect(down.status).toBe(503);
    expect(await code(down)).toBe('upstream_unavailable');
    expect(down.headers.get('retry-after')).toBe('30');
  });

  it('cache: request giống nhau trong 60 s được trả từ cache (x-mlv-cache=hit)', async () => {
    // cache.put chạy trong waitUntil nên có thể chưa xong khi request đầu trả về: cho phép Valhalla
    // được gọi lại (persist) và chờ tới khi thấy bản cache, tối đa ~1 s.
    mockRoute(200, fixture).persist();
    const first = await call(q(5));
    expect(first.status).toBe(200);
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      const again = await call(q(5));
      expect(again.status).toBe(200);
      hit = again.headers.get('x-mlv-cache') === 'hit';
      if (!hit) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(hit).toBe(true);
  });

  it('quota nhóm directions: đếm riêng, 2× hạn → 429; counter places không ảnh hưởng', async () => {
    await seedKey(FREE_KEY, {
      tenantId: '00000000-0000-4000-8000-0000000000bb',
      plan: 'free',
      quotaDirectionsPerDay: 5,
    });
    const hash = await sha256Hex(FREE_KEY);
    await env.META.put(`quota:${hash}:${vnDay()}:places`, '999999');
    mockRoute(200, fixture);
    expect((await call(q(6), FREE_KEY)).status).toBe(200);
    await env.META.put(`quota:${hash}:${vnDay()}:directions`, '10');
    const blocked = await call(q(7), FREE_KEY);
    expect(blocked.status).toBe(429);
    expect(await code(blocked)).toBe('quota_exceeded');
  });
});

describe('GET /healthz/routing', () => {
  it('Valhalla trả lời → ok + graph_built_at ISO; không cần khoá', async () => {
    const res = await SELF.fetch('https://api/healthz/routing');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      version: '3.8.3',
      graph_built_at: '2026-09-15T00:00:00.000Z',
    });
  });
});
```
Lưu ý: test `/healthz/routing` lỗi 503 không viết ở đây vì `mockStatus()` persist trong `beforeEach`; nhánh 503 đã có test ở `routing-valhalla.test.ts` (`fetchValhallaStatus` ném 503) và `errorResponse` sẵn có biến ApiError 503 thành response.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/directions-route.test.ts`
Expected: FAIL — `/v1/directions` trả 404 `not_found`.

- [ ] **Step 3: Viết `routes/directions.ts`**

```ts
import { type Context, Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { quotaMiddleware } from '../quota';
import { directionsCacheUrl, parseDirectionsParams } from '../routing/params';
import { translateDirections } from '../routing/translate';
import { callValhalla, fetchValhallaStatus, valhallaBody } from '../routing/valhalla';

export const directions = new Hono<AppEnv>();

const STATUS_CACHE_URL = 'https://cache.mapslibvn/routing-status?v=1';

export const builtAtIso = (unixSeconds: number | undefined): string | null =>
  typeof unixSeconds === 'number' && unixSeconds > 0
    ? new Date(unixSeconds * 1000).toISOString()
    : null;

/** Ngày build graph cho `engine.graph`; cache 5 phút; lỗi → null, không làm hỏng tuyến. */
async function graphBuiltAt(c: Context<AppEnv>): Promise<string | null> {
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

directions.get('/v1/directions', requireAuth(), quotaMiddleware('directions'), async (c) => {
  const params = parseDirectionsParams(c.req.query());
  return cachedJson(c.executionCtx, directionsCacheUrl(params), 60, 300, async () => {
    const [json, graph] = await Promise.all([
      callValhalla(c.env, valhallaBody(params, crypto.randomUUID())),
      graphBuiltAt(c),
    ]);
    return translateDirections(json, params.mode, graph);
  });
});

directions.get('/healthz/routing', async (c) => {
  const t0 = Date.now();
  const status = await fetchValhallaStatus(c.env); // ném ApiError 503 khi không trả lời/chưa cấu hình
  return c.json({
    ok: true,
    version: status.version ?? null,
    graph_built_at: builtAtIso(status.tileset_last_modified),
    ms: Date.now() - t0,
  });
});
```

Trong `apps/api/src/index.ts`: thêm `import { directions } from './routes/directions';` (theo thứ tự alphabet, sau `autocomplete`) và `app.route('/', directions);` ngay sau `app.route('/', reverse);`.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/directions-route.test.ts`
Expected: PASS 7 test. Nếu test cache trượt vì `caches.default` không giữ giữa hai lần `SELF.fetch` trong cùng test, kiểm `isolatedStorage` trong `vitest.config.ts` (mặc định `true`, cache vẫn sống trong **một** test); nếu vẫn trượt, chuyển test cache sang gọi trực tiếp `cachedJson` như `cache.test.ts` và ghi lý do vào DEVLOG.

- [ ] **Step 5: Toàn bộ API test + typecheck + lint**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck && pnpm lint`
Expected: xanh toàn bộ.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/directions.ts apps/api/src/index.ts apps/api/test/directions-route.test.ts
git commit -m "feat(api): GET /v1/directions và /healthz/routing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: DB — migration 0012 và cờ `--quota-directions` khi cấp khoá

**Files:**
- Create: `db/migrations/0012_api_key_quota_directions.sql`
- Create: `db/migrations/0012_api_key_quota_directions.down.sql`
- Modify: `scripts/lib/api-key.mjs` (`parseIssueArgs`)
- Modify: `scripts/lib/api-key.test.mjs`
- Modify: `scripts/api-key-issue.mjs`

- [ ] **Step 1: Viết test đỏ cho `parseIssueArgs`**

Thêm vào `describe('parseIssueArgs')` trong `scripts/lib/api-key.test.mjs`:
```js
  it('--quota-directions là số nguyên dương; vắng → null; sai → lỗi', () => {
    const base = ['--tenant', 't', '--kind', 'server'];
    expect(parseIssueArgs(base).quotaDirections).toBeNull();
    expect(parseIssueArgs([...base, '--quota-directions', '500']).quotaDirections).toBe(500);
    expect(() => parseIssueArgs([...base, '--quota-directions', 'abc'])).toThrow(/--quota-directions/);
    expect(() => parseIssueArgs([...base, '--quota-directions', '0'])).toThrow(/--quota-directions/);
  });
```
Test hiện có `toEqual({ tenant, label, kind, origins, scopes })` sẽ đỏ vì thiếu trường mới → thêm `quotaDirections: null,` vào object kỳ vọng của test đó.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm vitest run scripts/lib/api-key.test.mjs`
Expected: FAIL — `quotaDirections` undefined.

- [ ] **Step 3: Sửa `parseIssueArgs`**

Trong `scripts/lib/api-key.mjs`, đổi JSDoc `@returns` thành
`{{ tenant: string, label: string, kind: string, origins: string[], scopes: string[], quotaDirections: number | null }}`
và thêm trước `return`:
```js
  /** @type {number | null} */
  let quotaDirections = null;
  if (opt['quota-directions'] !== undefined) {
    const n = Number(opt['quota-directions']);
    if (!Number.isInteger(n) || n <= 0) throw new Error('--quota-directions phải là số nguyên dương');
    quotaDirections = n;
  }
  return { tenant, label: opt.label ?? '', kind, origins, scopes, quotaDirections };
```
(xoá dòng `return` cũ).

- [ ] **Step 4: Migration**

`db/migrations/0012_api_key_quota_directions.sql`:
```sql
-- Spec dẫn đường A (10/09/2026) mục 5.5: quota ngày riêng cho GET /v1/directions.
-- NULL = dùng mặc định plan (FREE_DIRECTIONS_PER_DAY = 2.000 trong Worker); tenant internal không đếm.
-- Worker đọc cột qua to_jsonb(k) ->> 'quota_directions_per_day' nên deploy trước/sau migration đều được.
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS quota_directions_per_day int;
```
`db/migrations/0012_api_key_quota_directions.down.sql`:
```sql
ALTER TABLE api_key DROP COLUMN IF EXISTS quota_directions_per_day;
```

- [ ] **Step 5: `api-key-issue.mjs`**

Dòng destructuring: `const { tenant, label, kind, origins, scopes, quotaDirections } = parseIssueArgs(process.argv.slice(2));`
INSERT:
```js
  await sql`
    INSERT INTO api_key (key_hash, key_prefix, tenant_id, label, kind, allowed_origins, scopes, quota_directions_per_day)
    VALUES (${hashKey(key)}, ${keyPrefix(key)}, ${tenant}, ${label}, ${kind}, ${origins}, ${scopes}, ${quotaDirections})`;
```
Thêm vào comment đầu file dòng ví dụ: `//     [--quota-directions 500]   (hạn /v1/directions mỗi ngày; vắng = mặc định plan 2.000)`.
Dòng in `kind   :` thêm `  quota directions: ${quotaDirections ?? 'mặc định'}`.

- [ ] **Step 6: Test, migration trên DB dev, typecheck**

Run:
```bash
pnpm vitest run scripts/lib/api-key.test.mjs
pnpm db:up && pnpm db:migrate
pnpm typecheck
```
Expected: test xanh; `[db:migrate] Áp dụng 0012_api_key_quota_directions.sql …`; typecheck sạch. Kiểm cột: `docker compose --env-file .env -f infra/dev/compose.yml exec -T postgres psql -U mapslibvn -d mapslibvn -tAc "select column_name from information_schema.columns where table_name='api_key' and column_name='quota_directions_per_day'"` → `quota_directions_per_day`.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/0012_api_key_quota_directions.sql db/migrations/0012_api_key_quota_directions.down.sql scripts/lib/api-key.mjs scripts/lib/api-key.test.mjs scripts/api-key-issue.mjs
git commit -m "feat(db): cột quota_directions_per_day và cờ --quota-directions khi cấp khoá

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: Test tích hợp — Valhalla fixture Quận 1 + `wrangler dev` + `pnpm test:routing` + capture fixture thật

**Files:**
- Modify: `infra/dev/compose.yml` (service `valhalla`, profile `routing`)
- Create: `scripts/lib/routing-test.mjs`, `scripts/lib/routing-test.test.mjs`
- Create: `scripts/routing-test.mjs`
- Create: `apps/api/vitest.routing.config.ts`
- Create: `apps/api/test-routing/directions.rtest.mjs`
- Modify: `package.json` (script `test:routing`)
- Create (capture): `apps/api/test/fixtures/valhalla/q1-motorbike.json`; Modify: `apps/api/test/routing-translate.test.ts`

- [ ] **Step 1: Test đỏ cho lib**

`scripts/lib/routing-test.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { TEST_KEY, parseRoutingTestArgs, testAuthInfo } from './routing-test.mjs';

describe('parseRoutingTestArgs', () => {
  it('mặc định máy dev: dựng compose, valhalla 8002, api 8798', () => {
    expect(parseRoutingTestArgs([], {})).toEqual({
      compose: true,
      valhallaBase: 'http://127.0.0.1:8002',
      apiPort: 8798,
      capture: false,
      down: false,
    });
  });

  it('--no-compose bắt buộc VALHALLA_BASE; --capture/--down; VALHALLA_PORT đổi cổng', () => {
    expect(() => parseRoutingTestArgs(['--no-compose'], {})).toThrow(/VALHALLA_BASE/);
    expect(
      parseRoutingTestArgs(['--no-compose', '--capture', '--down'], {
        VALHALLA_BASE: 'http://valhalla:8002/',
      }),
    ).toEqual({
      compose: false,
      valhallaBase: 'http://valhalla:8002',
      apiPort: 8798,
      capture: true,
      down: true,
    });
    expect(parseRoutingTestArgs([], { VALHALLA_PORT: '8102' }).valhallaBase).toBe(
      'http://127.0.0.1:8102',
    );
  });
});

describe('testAuthInfo', () => {
  it('khoá test internal, scope places:read, quota null (KV cache của auth)', () => {
    expect(TEST_KEY).toMatch(/^mlv_live_[0-9A-Za-z]{24}$/);
    expect(testAuthInfo('abc')).toEqual({
      keyHash: 'abc',
      keyPrefix: TEST_KEY.slice(0, 17),
      tenantId: '00000000-0000-4000-8000-0000000000ee',
      plan: 'internal',
      kind: 'server',
      scopes: ['places:read'],
      allowedOrigins: [],
      quotaPlacesPerDay: null,
      quotaDirectionsPerDay: null,
    });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm vitest run scripts/lib/routing-test.test.mjs`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `scripts/lib/routing-test.mjs`**

```js
// Phần thuần (test được) của scripts/routing-test.mjs — spec dẫn đường A mục 7.3.
export const TEST_KEY = 'mlv_live_routingtest000000000000';
export const DEFAULT_API_PORT = 8798;

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {{ compose: boolean, valhallaBase: string, apiPort: number, capture: boolean, down: boolean }}
 */
export function parseRoutingTestArgs(argv, env) {
  const compose = !argv.includes('--no-compose');
  let valhallaBase = env.VALHALLA_BASE?.replace(/\/+$/, '') ?? '';
  if (!compose && !valhallaBase) {
    throw new Error('--no-compose cần VALHALLA_BASE trỏ tới Valhalla đang chạy');
  }
  if (compose) valhallaBase = `http://127.0.0.1:${env.VALHALLA_PORT ?? '8002'}`;
  return {
    compose,
    valhallaBase,
    apiPort: DEFAULT_API_PORT,
    capture: argv.includes('--capture'),
    down: argv.includes('--down'),
  };
}

/**
 * Entry KV `apikey:<sha256>` cho wrangler dev local: auth đọc KV trước nên không cần Postgres.
 * @param {string} keyHash
 */
export function testAuthInfo(keyHash) {
  return {
    keyHash,
    keyPrefix: TEST_KEY.slice(0, 17),
    tenantId: '00000000-0000-4000-8000-0000000000ee',
    plan: 'internal',
    kind: 'server',
    scopes: ['places:read'],
    allowedOrigins: [],
    quotaPlacesPerDay: null,
    quotaDirectionsPerDay: null,
  };
}

/**
 * Chờ URL trả 2xx.
 * @param {string} url
 * @param {number} timeoutMs
 * @param {{ fetchImpl?: typeof fetch, intervalMs?: number, onTick?: (ms: number) => void }} [options]
 */
export async function waitForOk(url, timeoutMs, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const interval = options.intervalMs ?? 5_000;
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
    } catch {
      // chưa lên
    }
    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) throw new Error(`${url} không lên trong ${Math.round(timeoutMs / 1000)} giây`);
    options.onTick?.(elapsed);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
```

- [ ] **Step 4: Chạy test lib, xác nhận xanh**

Run: `pnpm vitest run scripts/lib/routing-test.test.mjs`
Expected: PASS 3 test.

- [ ] **Step 5: Service `valhalla` trong `infra/dev/compose.yml`**

Thêm sau service `pipeline` (trước `volumes:`):
```yaml
  # Valhalla mini trên fixture Quận 1 cho `pnpm test:routing` (spec dẫn đường A mục 7.3).
  # Chỉ bật: --profile routing. Thư mục work/valhalla-dev do scripts/routing-test.mjs tạo và chép PBF vào
  # (không mount thẳng fixtures/ vì image ghi valhalla.json, tar, sqlite vào cùng chỗ và chmod 664).
  valhalla:
    profiles: ["routing"]
    image: ghcr.io/valhalla/valhalla-scripted:3.8.3
    environment:
      serve_tiles: "True"
      use_tiles_ignore_pbf: "True"
      build_tar: "True"
      build_elevation: "False"
      build_admins: "True"
      build_time_zones: "True"
      server_threads: "2"
    ports:
      - "127.0.0.1:${VALHALLA_PORT:-8002}:8002"
    volumes:
      - ${MAPSLIBVN_VALHALLA_DEV:-../../work/valhalla-dev}:/custom_files
```

- [ ] **Step 6: Viết `scripts/routing-test.mjs`**

```js
#!/usr/bin/env node
// Test tích hợp chỉ đường (spec dẫn đường A mục 7.3): Valhalla trên fixture Quận 1 → wrangler dev với
// ROUTING_BASE trỏ container → khoá test trong KV local → vitest apps/api/test-routing/*.rtest.mjs.
//   pnpm test:routing              máy dev: tự dựng container (compose dev, profile routing); giữ container
//                                  sau khi chạy để lần sau nhanh; thêm --down để dừng.
//   node scripts/routing-test.mjs --no-compose     CI: VALHALLA_BASE trỏ container đã chạy.
//   node scripts/routing-test.mjs --capture        ghi JSON Valhalla thô → apps/api/test/fixtures/valhalla/q1-motorbike.json
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEST_KEY, parseRoutingTestArgs, testAuthInfo, waitForOk } from './lib/routing-test.mjs';
import { run } from './lib/run.mjs';

const opts = parseRoutingTestArgs(process.argv.slice(2), process.env);
const FIXTURE_PBF = resolve('pipelines/poi/fixtures/q1.osm.pbf');
const DEV_DIR = resolve(process.env.MAPSLIBVN_VALHALLA_DEV ?? 'work/valhalla-dev');
const compose = ['compose', '--env-file', '.env', '-f', 'infra/dev/compose.yml', '--profile', 'routing'];
const log = (/** @type {string} */ message) => console.log(`[routing-test] ${message}`);

if (opts.compose) {
  mkdirSync(DEV_DIR, { recursive: true });
  if (!existsSync(resolve(DEV_DIR, 'valhalla_tiles.tar'))) {
    copyFileSync(FIXTURE_PBF, resolve(DEV_DIR, 'q1.osm.pbf'));
    log(`chép fixture Quận 1 vào ${DEV_DIR} — lần đầu Valhalla build graph vài phút`);
  }
  run('docker', [...compose, 'up', '-d', 'valhalla'], {
    env: { ...process.env, MAPSLIBVN_VALHALLA_DEV: DEV_DIR },
  });
}
await waitForOk(`${opts.valhallaBase}/status`, 15 * 60_000, {
  onTick: (ms) => log(`chờ Valhalla /status… ${Math.round(ms / 1000)}s`),
});
log(`Valhalla sẵn sàng tại ${opts.valhallaBase}`);

if (opts.capture) {
  const body = {
    locations: [
      { lat: 10.7798, lon: 106.699, type: 'break' },
      { lat: 10.7725, lon: 106.698, type: 'break' },
    ],
    costing: 'motor_scooter',
    directions_options: { language: 'vi-VN', units: 'kilometers' },
    id: 'capture-q1-motorbike',
  };
  const response = await fetch(`${opts.valhallaBase}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`capture: Valhalla trả ${response.status}`);
  const target = resolve('apps/api/test/fixtures/valhalla/q1-motorbike.json');
  writeFileSync(target, `${JSON.stringify(await response.json(), null, 2)}\n`);
  log(`đã ghi ${target}`);
}

// wrangler.toml khai báo [assets] trỏ apps/admin/dist — thiếu thì wrangler dev không lên.
if (!existsSync('apps/admin/dist/admin/index.html')) {
  run('pnpm', ['--filter', '@mapslibvn/admin', 'build']);
}
// Cache local của wrangler sống qua nhiều phiên (bài học api-db-test 07/09/2026): xoá để tuyến không
// bị trả từ bản cache của lần chạy trước.
rmSync('apps/api/.wrangler/state/v3/cache', { recursive: true, force: true });
const keyHash = createHash('sha256').update(TEST_KEY, 'utf8').digest('hex');
run('pnpm', [
  '--filter',
  '@mapslibvn/api',
  'exec',
  'wrangler',
  'kv',
  'key',
  'put',
  `apikey:${keyHash}`,
  JSON.stringify(testAuthInfo(keyHash)),
  '--binding',
  'META',
  '--local',
]);

const detached = process.platform !== 'win32';
const wrangler = spawn(
  'pnpm',
  [
    '--filter',
    '@mapslibvn/api',
    'exec',
    'wrangler',
    'dev',
    '--port',
    String(opts.apiPort),
    '--var',
    `ROUTING_BASE:${opts.valhallaBase}`,
  ],
  { stdio: 'inherit', detached },
);
const stopWrangler = () => {
  try {
    if (detached && wrangler.pid) process.kill(-wrangler.pid, 'SIGTERM');
    else wrangler.kill('SIGTERM');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error;
  }
};
process.once('exit', stopWrangler);
process.once('SIGINT', () => {
  stopWrangler();
  process.exit(130);
});

let status = 1;
try {
  await waitForOk(`http://127.0.0.1:${opts.apiPort}/healthz`, 90_000, { intervalMs: 1_000 });
  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'apps/api/vitest.routing.config.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        ROUTING_API_BASE: `http://127.0.0.1:${opts.apiPort}`,
        ROUTING_API_KEY: TEST_KEY,
      },
    },
  );
  status = result.status ?? 1;
} finally {
  stopWrangler();
  if (opts.compose && opts.down) run('docker', [...compose, 'stop', 'valhalla']);
}
process.exit(status);
```

- [ ] **Step 7: Cấu hình vitest và file rtest**

`apps/api/vitest.routing.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

// Test tích hợp chỉ đường: cần Valhalla fixture + wrangler dev đang chạy — chạy qua `pnpm test:routing`.
export default defineConfig({
  test: {
    include: ['apps/api/test-routing/**/*.rtest.mjs'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

`apps/api/test-routing/directions.rtest.mjs`:
```js
import { describe, expect, it } from 'vitest';

const base = process.env.ROUTING_API_BASE ?? 'http://127.0.0.1:8798';
const key = process.env.ROUTING_API_KEY ?? 'mlv_live_routingtest000000000000';
/** @param {string} query */
const get = (query) =>
  fetch(`${base}/v1/directions?${query}`, { headers: { 'X-Api-Key': key } });
// Quận 1, TP.HCM: Nhà thờ Đức Bà → Chợ Bến Thành (~1,2 km đường bộ).
const FROM = '10.7798,106.6990';
const TO = '10.7725,106.6980';
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

describe('/v1/directions trên Valhalla fixture Quận 1', () => {
  for (const mode of ['motorbike', 'car', 'walk']) {
    it(`${mode}: 200, depart → arrive, quãng đường hợp lý, câu tiếng Việt có dấu`, async () => {
      const response = await get(`from=${FROM}&to=${TO}&mode=${mode}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      const route = body.routes[0];
      expect(route.mode).toBe(mode);
      expect(route.distance_m).toBeGreaterThan(800);
      expect(route.distance_m).toBeLessThan(4_000);
      expect(route.duration_s).toBeGreaterThan(0);
      expect(route.geometry.length).toBeGreaterThan(10);
      const steps = route.legs[0].steps;
      expect(steps[0].kind).toBe('depart');
      expect(steps.at(-1).kind).toBe('arrive');
      expect(steps.some((s) => VI.test(s.instruction))).toBe(true);
      expect(body.waypoints).toHaveLength(2);
      expect(body.engine.name).toBe('valhalla');
      expect(response.headers.get('content-type')).toContain('application/json');
    });
  }

  it('via → hai leg, shape_offset của leg 2 > 0; alternatives bị bỏ qua', async () => {
    const response = await get(`from=${FROM}&via=10.7760,106.6985&to=${TO}&alternatives=1`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.routes).toHaveLength(1);
    expect(body.routes[0].legs).toHaveLength(2);
    expect(body.routes[0].legs[1].shape_offset).toBeGreaterThan(0);
    expect(body.waypoints).toHaveLength(3);
  });

  it('lang=en → câu tiếng Anh', async () => {
    const body = await (await get(`from=${FROM}&to=${TO}&lang=en`)).json();
    expect(body.routes[0].legs[0].steps[0].instruction).toMatch(/^(Head|Drive|Walk|Bike|Go)/);
  });

  it('điểm ngoài graph fixture (Hà Nội) → 404 no_route', async () => {
    const response = await get('from=21.0285,105.8542&to=21.0369,105.8348&mode=walk');
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('no_route');
  });

  it('/healthz/routing → ok, version, graph_built_at ISO', async () => {
    const response = await fetch(`${base}/healthz/routing`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+/);
    expect(body.graph_built_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

`package.json` scripts: thêm `"test:routing": "node scripts/routing-test.mjs",` sau `"test:api-db"`.

- [ ] **Step 8: Chạy thật trên máy dev**

Run: `pnpm --filter @mapslibvn/core build && pnpm test:routing -- --capture`
Expected: log `chép fixture…`, sau vài phút `Valhalla sẵn sàng`, `đã ghi …/q1-motorbike.json`, wrangler lên, vitest **7 test xanh**. Nếu `docker compose up` báo thiếu `.env`: tạo từ `.env.example` (`pnpm run setup` đã làm việc này trên máy dev). Nếu test `lang=en` trượt vì câu mở đầu khác, nới regex theo câu thật và ghi lại.

Ghi lại thời gian build graph fixture (dòng `chờ Valhalla /status… Ns` cuối) cho DEVLOG.

- [ ] **Step 9: Thêm test translate trên fixture thật**

Thêm vào `apps/api/test/routing-translate.test.ts`:
```ts
import real from './fixtures/valhalla/q1-motorbike.json';

describe('fixture Valhalla thật (Quận 1, capture bằng pnpm test:routing --capture)', () => {
  it('dịch được, chỉ số shape của bước cuối trỏ đúng điểm cuối polyline', () => {
    const out = translateDirections(real as unknown as ValhallaRouteResponse, 'motorbike', null);
    const route = out.routes[0];
    const coords = decodePolyline6(route?.geometry ?? '');
    const last = route?.legs.at(-1)?.steps.at(-1);
    expect(last?.kind).toBe('arrive');
    expect(last?.shape_end).toBe(coords.length - 1);
    expect(route?.distance_m).toBeGreaterThan(800);
    expect(route?.legs[0]?.steps[0]?.kind).toBe('depart');
    expect(out.waypoints[1]?.snapped).toEqual(coords.at(-1));
  });
});
```
(đặt import cạnh import fixture tay). Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-translate.test.ts` → PASS 7.

- [ ] **Step 10: Lint, typecheck, commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add infra/dev/compose.yml scripts/routing-test.mjs scripts/lib/routing-test.mjs scripts/lib/routing-test.test.mjs apps/api/vitest.routing.config.ts apps/api/test-routing apps/api/test/fixtures/valhalla/q1-motorbike.json apps/api/test/routing-translate.test.ts package.json
git commit -m "test(api): test tích hợp chỉ đường trên Valhalla fixture Quận 1 (pnpm test:routing)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 11: CI — workflow `Routing tests` (ubuntu-latest, có Docker)

**Files:**
- Create: `.github/workflows/routing-test.yml`

- [ ] **Step 1: Viết workflow**

```yaml
name: Routing tests
# Job DB tests chạy TRONG container image pipeline (không có Docker) nên test Valhalla cần workflow riêng.
# Graph fixture Quận 1 build ~vài phút trên runner; chỉ chạy khi chạm mã routing hoặc chạy tay.
on:
  push:
    branches: [main]
    paths:
      - 'apps/api/src/routing/**'
      - 'apps/api/src/routes/directions.ts'
      - 'apps/api/test-routing/**'
      - 'apps/api/vitest.routing.config.ts'
      - 'scripts/routing-test.mjs'
      - 'scripts/lib/routing-test.mjs'
      - 'packages/core/src/polyline.ts'
      - 'packages/core/src/maneuver.ts'
      - '.github/workflows/routing-test.yml'
  workflow_dispatch:
concurrency:
  group: routing-${{ github.ref }}
  cancel-in-progress: true
jobs:
  routing:
    timeout-minutes: 30
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/style build && pnpm --filter @mapslibvn/admin build
      - name: Valhalla trên fixture Quận 1
        run: |
          mkdir -p "$RUNNER_TEMP/valhalla"
          cp pipelines/poi/fixtures/q1.osm.pbf "$RUNNER_TEMP/valhalla/"
          docker run -d --name valhalla -p 8002:8002 -e server_threads=2 \
            -v "$RUNNER_TEMP/valhalla:/custom_files" ghcr.io/valhalla/valhalla-scripted:3.8.3
      - run: node scripts/routing-test.mjs --no-compose
        env:
          VALHALLA_BASE: http://127.0.0.1:8002
      - if: failure()
        run: docker logs valhalla | tail -100
```

- [ ] **Step 2: Kiểm cú pháp YAML cục bộ**

Run: `node -e "import('node:fs').then(fs => { const y = fs.readFileSync('.github/workflows/routing-test.yml','utf8'); if (!y.includes('workflow_dispatch')) throw new Error('thiếu dispatch'); console.log('ok', y.split('\n').length, 'dòng'); })"`
Expected: `ok … dòng`. Workflow chỉ chạy thật sau khi push (Task 16); ghi vào checklist Task 16 bước kích hoạt `workflow_dispatch` và xác nhận xanh.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/routing-test.yml
git commit -m "ci: workflow Routing tests chạy Valhalla fixture Quận 1 trên ubuntu-latest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 12: Máy chủ — service `valhalla`, kịch bản bọc `run.sh`, `scripts/routing-graph.mjs`

**Files:**
- Create: `infra/server/valhalla/run.sh`
- Modify: `infra/server/compose.yml`
- Create: `scripts/lib/routing-graph.mjs`, `scripts/lib/routing-graph.test.mjs`
- Create: `scripts/routing-graph.mjs`

Đọc spec mục 2 (đoạn "Lưu ý đã đọc mã `configure_valhalla.sh`") và 4.3–4.4 trước: build lại được kích hoạt bằng cách **dời tar đi và xoá thư mục tile**, không phải bằng hash.

- [ ] **Step 1: Test đỏ cho lib**

`scripts/lib/routing-graph.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { GRAPH_FILES, graphMeta, preparePlan, rollbackPlan } from './routing-graph.mjs';

describe('preparePlan', () => {
  const md5 = 'a'.repeat(32);
  it('không có PBF nguồn → error', () => {
    expect(preparePlan({ hasSource: false, sourceMd5: null, currentMd5: null, hasTar: false, force: false }))
      .toEqual({ action: 'error', reason: expect.stringContaining('download.mjs') });
  });
  it('md5 trùng và đã có tar → skip (idempotent); --force vẫn rebuild', () => {
    const state = { hasSource: true, sourceMd5: md5, currentMd5: md5, hasTar: true, force: false };
    expect(preparePlan(state)).toEqual({ action: 'skip', reason: expect.stringContaining(md5) });
    expect(preparePlan({ ...state, force: true })).toEqual({ action: 'rebuild', keepPrev: true });
  });
  it('md5 khác hoặc chưa có tar → rebuild; keepPrev theo tar hiện có', () => {
    expect(preparePlan({ hasSource: true, sourceMd5: md5, currentMd5: 'b'.repeat(32), hasTar: true, force: false }))
      .toEqual({ action: 'rebuild', keepPrev: true });
    expect(preparePlan({ hasSource: true, sourceMd5: md5, currentMd5: null, hasTar: false, force: false }))
      .toEqual({ action: 'rebuild', keepPrev: false });
  });
});

describe('rollbackPlan / graphMeta / GRAPH_FILES', () => {
  it('rollback cần prev tar', () => {
    expect(rollbackPlan({ hasPrevTar: true })).toEqual({ action: 'swap' });
    expect(rollbackPlan({ hasPrevTar: false })).toEqual({
      action: 'error',
      reason: expect.stringContaining('prev/valhalla_tiles.tar'),
    });
  });
  it('graphMeta ghi md5, ngày PBF, thời điểm và bản trước', () => {
    const prev = { pbfMd5: 'x', pbfDate: '2026-09-01T00:00:00.000Z', requestedAt: '2026-09-01T02:00:00.000Z' };
    expect(graphMeta('y', new Date('2026-09-14T00:00:00Z'), new Date('2026-09-15T02:00:00Z'), prev)).toEqual({
      pbfMd5: 'y',
      pbfDate: '2026-09-14T00:00:00.000Z',
      requestedAt: '2026-09-15T02:00:00.000Z',
      previous: { pbfMd5: 'x', pbfDate: '2026-09-01T00:00:00.000Z', requestedAt: '2026-09-01T02:00:00.000Z' },
    });
    expect(graphMeta('y', new Date(0), new Date(0), null).previous).toBeNull();
  });
  it('tên file khớp image valhalla-scripted (tileset_name=valhalla_tiles)', () => {
    expect(GRAPH_FILES).toEqual({
      pbf: 'vietnam.osm.pbf',
      tar: 'valhalla_tiles.tar',
      tileDir: 'valhalla_tiles',
      prevDir: 'prev',
      flag: 'reload.request',
      meta: 'graph.json',
    });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm vitest run scripts/lib/routing-graph.test.mjs`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `scripts/lib/routing-graph.mjs`**

```js
// Phần thuần của scripts/routing-graph.mjs (spec dẫn đường A mục 4.4).
// Tên file bám image ghcr.io/valhalla/valhalla-scripted với tileset_name=valhalla_tiles.
export const GRAPH_FILES = {
  pbf: 'vietnam.osm.pbf',
  tar: 'valhalla_tiles.tar',
  tileDir: 'valhalla_tiles',
  prevDir: 'prev',
  flag: 'reload.request',
  meta: 'graph.json',
};

/**
 * @param {{ hasSource: boolean, sourceMd5: string | null, currentMd5: string | null, hasTar: boolean, force: boolean }} s
 * @returns {{ action: 'error', reason: string } | { action: 'skip', reason: string } | { action: 'rebuild', keepPrev: boolean }}
 */
export function preparePlan(s) {
  if (!s.hasSource) {
    return {
      action: 'error',
      reason: 'Chưa có vietnam.osm.pbf trong work — chạy `node pipelines/tiles/src/download.mjs` trước',
    };
  }
  if (!s.force && s.hasTar && s.currentMd5 === s.sourceMd5) {
    return { action: 'skip', reason: `graph đã build từ PBF md5 ${s.sourceMd5}` };
  }
  return { action: 'rebuild', keepPrev: s.hasTar };
}

/**
 * @param {{ hasPrevTar: boolean }} s
 * @returns {{ action: 'swap' } | { action: 'error', reason: string }}
 */
export function rollbackPlan(s) {
  return s.hasPrevTar
    ? { action: 'swap' }
    : { action: 'error', reason: 'Không có prev/valhalla_tiles.tar để rollback' };
}

/**
 * @typedef {{ pbfMd5: string, pbfDate: string, requestedAt: string, previous?: GraphMeta | null }} GraphMeta
 * @param {string} pbfMd5
 * @param {Date} pbfDate mtime của PBF nguồn (≈ ngày Geofabrik phát hành)
 * @param {Date} requestedAt
 * @param {GraphMeta | null} previous
 * @returns {GraphMeta}
 */
export function graphMeta(pbfMd5, pbfDate, requestedAt, previous) {
  return {
    pbfMd5,
    pbfDate: pbfDate.toISOString(),
    requestedAt: requestedAt.toISOString(),
    previous: previous
      ? { pbfMd5: previous.pbfMd5, pbfDate: previous.pbfDate, requestedAt: previous.requestedAt }
      : null,
  };
}
```

- [ ] **Step 4: Chạy test lib, xác nhận xanh**

Run: `pnpm vitest run scripts/lib/routing-graph.test.mjs`
Expected: PASS 6 test.

- [ ] **Step 5: Viết `scripts/routing-graph.mjs`**

```js
#!/usr/bin/env node
// Quản lý graph Valhalla trên volume valhalla-data (spec dẫn đường A mục 4.4). Chạy TRONG container
// pipeline của compose máy chủ (volume gắn tại /app/valhalla):
//   node scripts/routing-graph.mjs prepare [--force]  PBF mới → dời tar cũ vào prev/, xoá thư mục tile,
//                                                    chép PBF, ghi graph.json + cờ reload → valhalla tự build
//   node scripts/routing-graph.mjs rollback           đổi chỗ tar hiện tại ↔ prev/, cờ reload → phục vụ tar cũ
//   node scripts/routing-graph.mjs status             in graph.json + kích cỡ tar (JSON)
// Image valhalla-scripted chỉ băm TÊN file PBF, nên không thể kích hoạt build bằng ghi đè PBF —
// phải dời tar và xoá thư mục tile (use_tiles_ignore_pbf=True; xem spec mục 2).
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { GRAPH_FILES, graphMeta, preparePlan, rollbackPlan } from './lib/routing-graph.mjs';

const WORK = process.env.MAPSLIBVN_WORK ?? '/app/work';
const GRAPH_DIR = process.env.MAPSLIBVN_VALHALLA ?? '/app/valhalla';
const SOURCE_PBF = resolve(WORK, 'data/sources/vietnam.osm.pbf');
const path = (/** @type {string} */ name) => resolve(GRAPH_DIR, name);
const prevPath = (/** @type {string} */ name) => resolve(GRAPH_DIR, GRAPH_FILES.prevDir, name);
const log = (/** @type {string} */ message) => console.log(`[routing-graph] ${message}`);

/** @param {string} file */
async function md5(file) {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** @param {string} file @returns {import('./lib/routing-graph.mjs').GraphMeta | null} */
function readMeta(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** @param {string} content */
function requestReload(content) {
  writeFileSync(path(GRAPH_FILES.flag), `${content}\n`);
  log(`đã ghi cờ ${GRAPH_FILES.flag} (${content}) — container valhalla nhận trong ≤ 30 giây`);
}

if (!existsSync(GRAPH_DIR)) {
  throw new Error(
    `${GRAPH_DIR} không tồn tại — volume valhalla-data chưa gắn vào container pipeline (infra/server/compose.yml)`,
  );
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'prepare') {
  const current = readMeta(path(GRAPH_FILES.meta));
  const hasSource = existsSync(SOURCE_PBF);
  const sourceMd5 = hasSource ? await md5(SOURCE_PBF) : null;
  const plan = preparePlan({
    hasSource,
    sourceMd5,
    currentMd5: current?.pbfMd5 ?? null,
    hasTar: existsSync(path(GRAPH_FILES.tar)),
    force: rest.includes('--force'),
  });
  if (plan.action === 'error') throw new Error(plan.reason);
  if (plan.action === 'skip') {
    log(`${plan.reason} — không làm gì`);
    process.exit(0);
  }
  mkdirSync(prevPath(''), { recursive: true });
  if (plan.keepPrev) {
    rmSync(prevPath(GRAPH_FILES.tar), { force: true });
    renameSync(path(GRAPH_FILES.tar), prevPath(GRAPH_FILES.tar));
    if (current) writeFileSync(prevPath(GRAPH_FILES.meta), `${JSON.stringify(current, null, 2)}\n`);
    log('đã giữ tar hiện tại vào prev/ (rollback được một bản)');
  }
  rmSync(path(GRAPH_FILES.tileDir), { recursive: true, force: true });
  copyFileSync(SOURCE_PBF, path(GRAPH_FILES.pbf));
  const meta = graphMeta(
    /** @type {string} */ (sourceMd5),
    statSync(SOURCE_PBF).mtime,
    new Date(),
    current,
  );
  writeFileSync(path(GRAPH_FILES.meta), `${JSON.stringify(meta, null, 2)}\n`);
  requestReload('rebuild');
  log(`PBF md5 ${meta.pbfMd5} — theo dõi build: docker compose … logs -f valhalla`);
} else if (command === 'rollback') {
  const plan = rollbackPlan({ hasPrevTar: existsSync(prevPath(GRAPH_FILES.tar)) });
  if (plan.action === 'error') throw new Error(plan.reason);
  const tmp = path(`${GRAPH_FILES.tar}.swap`);
  const hasCurrent = existsSync(path(GRAPH_FILES.tar));
  if (hasCurrent) renameSync(path(GRAPH_FILES.tar), tmp);
  renameSync(prevPath(GRAPH_FILES.tar), path(GRAPH_FILES.tar));
  if (hasCurrent) renameSync(tmp, prevPath(GRAPH_FILES.tar));
  const current = readMeta(path(GRAPH_FILES.meta));
  const previous = readMeta(prevPath(GRAPH_FILES.meta));
  if (previous) {
    writeFileSync(
      path(GRAPH_FILES.meta),
      `${JSON.stringify({ ...previous, requestedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  }
  if (current) writeFileSync(prevPath(GRAPH_FILES.meta), `${JSON.stringify(current, null, 2)}\n`);
  requestReload('rollback');
  log(`đã đổi chỗ tar hiện tại ↔ prev/ (graph ${previous?.pbfMd5 ?? '?'} sẽ được nạp)`);
} else if (command === 'status') {
  const size = (/** @type {string} */ file) => (existsSync(file) ? statSync(file).size : null);
  console.log(
    JSON.stringify(
      {
        graph: readMeta(path(GRAPH_FILES.meta)),
        tarBytes: size(path(GRAPH_FILES.tar)),
        prevTarBytes: size(prevPath(GRAPH_FILES.tar)),
        pbfBytes: size(path(GRAPH_FILES.pbf)),
        pendingReload: existsSync(path(GRAPH_FILES.flag)),
      },
      null,
      2,
    ),
  );
} else {
  throw new Error('Dùng: routing-graph.mjs prepare [--force] | rollback | status');
}
```

- [ ] **Step 6: Viết `infra/server/valhalla/run.sh`**

```bash
#!/usr/bin/env bash
# Bọc entrypoint gốc của image valhalla-scripted (spec dẫn đường A mục 4.3): chạy build+serve, đợi cờ
# /custom_files/reload.request do scripts/routing-graph.mjs ghi, rồi dừng CẢ NHÓM tiến trình (valhalla_service
# hoặc valhalla_build_tiles đang chạy) và chạy lại entrypoint — không cần Docker socket trong container
# pipeline. Entrypoint chạy qua setsid để có process group riêng: kill -TERM cả nhóm mới không để sót
# valhalla_build_tiles chạy mồ côi nếu cờ tới giữa lúc build (hai build chồng nhau làm hỏng graph).
set -euo pipefail
CUSTOM_FILES=/custom_files
FLAG="${CUSTOM_FILES}/reload.request"
ENTRYPOINT=/valhalla/scripts/docker-entrypoint.sh
POLL_SECONDS="${RELOAD_POLL_SECONDS:-30}"
FAIL_SLEEP_SECONDS="${FAIL_SLEEP_SECONDS:-600}"
log() { echo "[run.sh] $(date -u +%FT%TZ) $*"; }

while true; do
  rm -f "${FLAG}"
  setsid "${ENTRYPOINT}" build_tiles &
  child=$!
  log "entrypoint pid ${child} (build nếu thiếu tar, rồi phục vụ :8002)"
  while kill -0 "${child}" 2>/dev/null; do
    if [[ -f "${FLAG}" ]]; then
      log "thấy cờ '$(tr -d '\n' < "${FLAG}" 2>/dev/null || echo reload)' → dừng nhóm tiến trình ${child} để nạp lại graph"
      kill -TERM -- "-${child}" 2>/dev/null || kill -TERM "${child}" 2>/dev/null || true
      wait "${child}" || true
      break
    fi
    sleep "${POLL_SECONDS}"
  done
  if [[ ! -f "${FLAG}" ]]; then
    set +e
    wait "${child}"
    code=$?
    set -e
    if [[ "${code}" -eq 0 ]]; then
      log "entrypoint thoát mã 0 → thoát"
      exit 0
    fi
    # Không để Docker restart-loop build lại liên tục khi OOM/lỗi dữ liệu: ngủ rồi mới thoát.
    log "entrypoint thoát mã ${code} mà không có cờ reload (build lỗi/OOM?) — ngủ ${FAIL_SLEEP_SECONDS}s rồi để Docker khởi động lại; quay về graph cũ: scripts/routing-graph.mjs rollback"
    sleep "${FAIL_SLEEP_SECONDS}"
    exit "${code}"
  fi
done
```

- [ ] **Step 7: `infra/server/compose.yml`**

Thêm service sau `pipeline` (trước `volumes:`):
```yaml
  valhalla:
    # Ghim theo digest của manifest list tag 3.8.3 (amd64+arm64, `docker buildx imagetools inspect`
    # 10/09/2026): tag bị đẩy lại trên GHCR không đổi được bản chạy trên máy chủ.
    image: ghcr.io/valhalla/valhalla-scripted:3.8.3@sha256:24ef7955899dececb94e26c6dfb89d64fabfae875f980432694b0261eb6c251b
    restart: unless-stopped
    # Ghi đè ENTRYPOINT (không phải command) — ENTRYPOINT gốc nhận command làm tham số; command rỗng
    # để run.sh không nhận thừa "build_tiles" của CMD gốc.
    entrypoint: ["/bin/bash", "/opt/mapslibvn/run.sh"]
    command: []
    environment:
      serve_tiles: "True"
      use_tiles_ignore_pbf: "True"
      force_rebuild: "False"
      build_tar: "True"
      build_elevation: "False"
      build_admins: "True"
      build_time_zones: "True"
      server_threads: "4"
      tileset_name: valhalla_tiles
    volumes:
      - valhalla-data:/custom_files
      - ./valhalla/run.sh:/opt/mapslibvn/run.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8002/status >/dev/null"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 3600s
    # KHÔNG có `ports:` — chỉ cloudflared nối tới valhalla:8002 trong mạng compose (spec A mục 4.1).
```
Trong service `pipeline`, `volumes:` thêm `- valhalla-data:/app/valhalla`. Khối `volumes:` cuối file thêm `valhalla-data:`.

- [ ] **Step 8: Kiểm cú pháp compose và bash, typecheck**

Run:
```bash
docker compose -f infra/server/compose.yml --env-file /dev/null config --quiet && echo compose-ok
bash -n infra/server/valhalla/run.sh && echo bash-ok
docker run --rm --entrypoint sh ghcr.io/valhalla/valhalla-scripted:3.8.3 -c 'command -v setsid curl jq && echo tools-ok'
pnpm typecheck && pnpm lint
```
Expected: `compose-ok`, `bash-ok`, `tools-ok` (image có setsid/curl/jq) (nếu `config` báo thiếu biến `${...}`, tạo file env tạm trong scratchpad với `POSTGRES_SUPER_PASSWORD=x API_PASSWORD=x PIPELINE_PASSWORD=x TUNNEL_TOKEN=x` và trỏ `--env-file` vào đó), typecheck/lint sạch.

- [ ] **Step 9: Thử `routing-graph.mjs` cục bộ với thư mục giả**

Run:
```bash
T=$(mktemp -d); mkdir -p "$T/work/data/sources" "$T/graph"; head -c 1000 /dev/urandom > "$T/work/data/sources/vietnam.osm.pbf"
MAPSLIBVN_WORK="$T/work" MAPSLIBVN_VALHALLA="$T/graph" node scripts/routing-graph.mjs prepare && ls "$T/graph" && cat "$T/graph/reload.request"
echo tar1 > "$T/graph/valhalla_tiles.tar"; rm "$T/graph/reload.request"
MAPSLIBVN_WORK="$T/work" MAPSLIBVN_VALHALLA="$T/graph" node scripts/routing-graph.mjs prepare   # → "không làm gì"
head -c 1000 /dev/urandom > "$T/work/data/sources/vietnam.osm.pbf"
MAPSLIBVN_WORK="$T/work" MAPSLIBVN_VALHALLA="$T/graph" node scripts/routing-graph.mjs prepare --force && ls "$T/graph/prev"
echo tar2 > "$T/graph/valhalla_tiles.tar"
MAPSLIBVN_WORK="$T/work" MAPSLIBVN_VALHALLA="$T/graph" node scripts/routing-graph.mjs rollback && cat "$T/graph/valhalla_tiles.tar" "$T/graph/prev/valhalla_tiles.tar"
MAPSLIBVN_WORK="$T/work" MAPSLIBVN_VALHALLA="$T/graph" node scripts/routing-graph.mjs status
```
Expected: lần 1 tạo `graph.json`, `vietnam.osm.pbf`, `reload.request` chứa `rebuild`; lần 2 in `không làm gì`; `--force` tạo `prev/valhalla_tiles.tar` (nội dung `tar1`); sau rollback tar hiện tại là `tar1`, prev là `tar2`; `status` in JSON có `pendingReload: true`.

- [ ] **Step 10: Commit**

```bash
git add infra/server/valhalla/run.sh infra/server/compose.yml scripts/routing-graph.mjs scripts/lib/routing-graph.mjs scripts/lib/routing-graph.test.mjs
git commit -m "feat(server): service Valhalla, kịch bản bọc reload và routing-graph prepare/rollback/status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 13: Máy chủ — móc graph vào `data:update`, `data:rollback`, `server:setup`, `server:update`

**Files:**
- Modify: `scripts/data-update.mjs`
- Modify: `scripts/data-rollback.mjs`
- Modify: `scripts/server-setup.mjs`
- Modify: `scripts/lib/server-env.mjs` (`pullPlan`), `scripts/lib/server-env.test.mjs`
- Modify: `scripts/lib/update-plan.mjs`, `scripts/lib/update-plan.test.mjs` (hàm `routingStep`)

- [ ] **Step 1: Test đỏ**

Thêm vào `scripts/lib/update-plan.test.mjs`:
```js
import { routingStep } from './update-plan.mjs';

describe('routingStep', () => {
  it('chỉ chạy khi có tiles mới, volume valhalla gắn và không --skip-routing', () => {
    expect(routingStep({ tiles: true, graphDirExists: true, skipRouting: false })).toEqual({
      run: true,
      reason: 'OSM đổi → build lại graph Valhalla',
    });
    expect(routingStep({ tiles: false, graphDirExists: true, skipRouting: false })).toEqual({
      run: false,
      reason: 'tiles không đổi',
    });
    expect(routingStep({ tiles: true, graphDirExists: false, skipRouting: false })).toEqual({
      run: false,
      reason: 'không có volume valhalla-data (máy dev)',
    });
    expect(routingStep({ tiles: true, graphDirExists: true, skipRouting: true })).toEqual({
      run: false,
      reason: '--skip-routing',
    });
  });
});
```
(ghép import vào dòng import hiện có của file.) Trong `scripts/lib/server-env.test.mjs` dòng 60 đổi `services: ['postgres', 'cloudflared'],` → `services: ['postgres', 'cloudflared', 'valhalla'],`.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm vitest run scripts/lib/update-plan.test.mjs scripts/lib/server-env.test.mjs`
Expected: FAIL 2 test.

- [ ] **Step 3: `update-plan.mjs` và `server-env.mjs`**

Thêm vào cuối `scripts/lib/update-plan.mjs`:
```js
/**
 * Bước graph Valhalla trong data:update (spec dẫn đường A mục 4.4): chỉ khi tiles có bản mới (OSM đổi
 * hoặc --force), volume valhalla-data đang gắn (máy chủ) và không bị --skip-routing.
 * @param {{ tiles: boolean, graphDirExists: boolean, skipRouting: boolean }} s
 */
export function routingStep(s) {
  if (s.skipRouting) return { run: false, reason: '--skip-routing' };
  if (!s.tiles) return { run: false, reason: 'tiles không đổi' };
  if (!s.graphDirExists) return { run: false, reason: 'không có volume valhalla-data (máy dev)' };
  return { run: true, reason: 'OSM đổi → build lại graph Valhalla' };
}
```
Trong `scripts/lib/server-env.mjs` `pullPlan`: `services: skipPipeline ? ['postgres', 'cloudflared', 'valhalla'] : []`.

- [ ] **Step 4: `data-update.mjs`**

- `flags` thêm `skipRouting: argv.includes('--skip-routing'),`.
- Import thêm `routingStep` từ `./lib/update-plan.mjs`.
- Sau `const OUT = …` thêm `const GRAPH_DIR = process.env.MAPSLIBVN_VALHALLA ?? '/app/valhalla';`.
- Ngay sau khối `if (work.tiles) { … log(\`✓ tiles ${release}\`); }` thêm:
```js
const routing = routingStep({
  tiles: work.tiles,
  graphDirExists: existsSync(GRAPH_DIR),
  skipRouting: flags.skipRouting,
});
if (routing.run) {
  // Valhalla tự build sau khi thấy cờ; data:update không chờ (build vài chục phút, spec A mục 4.4).
  run('node', ['scripts/routing-graph.mjs', 'prepare']);
  log('✓ routing graph: đã yêu cầu build lại (docker compose … logs -f valhalla để theo dõi)');
} else {
  log(`bỏ qua routing graph: ${routing.reason}`);
}
```
- Cập nhật comment đầu file: thêm `→ routing graph (máy chủ)` sau `manifest`.

- [ ] **Step 5: `data-rollback.mjs`**

Trong nhánh `MAPSLIBVN_IN_CONTAINER === '1'` của khối `if (process.argv[1] …)`, **trước** dòng `const bucket = process.env.R2_BUCKET;` thêm:
```js
    // Rollback graph TRƯỚC manifest: nếu không có bản prev thì dừng ngay, chưa đụng tiles
    // (chạy lại với --skip-routing sẽ không rollback tiles hai lần).
    const graphDir = process.env.MAPSLIBVN_VALHALLA ?? '/app/valhalla';
    if (!process.argv.includes('--skip-routing') && existsSync(graphDir)) {
      run('node', ['scripts/routing-graph.mjs', 'rollback']);
    }
```
Thêm `import { existsSync } from 'node:fs';`. Trong `rollbackCommand` ngoài container, nối `...process.argv.slice(2)` vào sau `'scripts/data-rollback.mjs'` để cờ đi qua (test hiện có `rollbackCommand({})` kỳ vọng mảng cố định → thêm tham số `argv = []` mặc định: `export function rollbackCommand(env, argv = [])` và `args: [..., 'scripts/data-rollback.mjs', ...argv]`; test cũ vẫn xanh). Ở khối main ngoài container đổi `rollbackCommand(process.env)` → `rollbackCommand(process.env, process.argv.slice(2))`.

- [ ] **Step 6: `server-setup.mjs`**

- Dòng `const services = ['postgres', 'backup', 'pipeline'];` giữ nguyên (valhalla khởi động **sau** khi có PBF).
- Sau bước `step('Kiểm tra TLS'); …` (trước `console.log(\`\n✔ Máy chủ đã dựng`)`) thêm:
```js
step('Graph chỉ đường (Valhalla, spec dẫn đường A)');
const inPipeline = (/** @type {string} */ shell) =>
  capture('docker', [...compose, 'run', '--rm', '-T', 'pipeline', 'sh', '-c', shell]);
if (inPipeline('test -f /app/valhalla/valhalla_tiles.tar && echo yes') === 'yes') {
  console.log('Graph đã có — valhalla phục vụ ngay.');
} else {
  if (inPipeline('test -f /app/work/data/sources/vietnam.osm.pbf && echo yes') !== 'yes') {
    console.log('Chưa có PBF Việt Nam — tải (vài phút)…');
    run('docker', [...compose, 'run', '--rm', 'pipeline', 'node', 'pipelines/tiles/src/download.mjs']);
  }
  run('docker', [...compose, 'run', '--rm', 'pipeline', 'node', 'scripts/routing-graph.mjs', 'prepare']);
  console.log(
    'Valhalla sẽ build graph lần đầu (vài chục phút, RAM đỉnh xem docker stats). Theo dõi: docker compose … logs -f valhalla; xong khi /status trả 200.',
  );
}
run('docker', [...compose, 'up', '-d', 'valhalla']);
```
- Trong chuỗi checklist cuối, thêm sau mục 5:
```
  6. Chỉ đường — làm ĐÚNG THỨ TỰ để Valhalla không có lúc nào công khai: Access → Service Auth → Service Token "routing";
     Access → Applications → Self-hosted "mapslibvn-route" domain maps-route.<domain>, Policy Service Auth = token "routing".
  7. Rồi mới: Tunnel "mapslibvn-db" → Public Hostname thêm maps-route.<domain> → Service HTTP → URL valhalla:8002.
  8. Máy dev: wrangler secret put ROUTING_ACCESS_CLIENT_ID --env production (và …_SECRET); ROUTING_BASE production đã có trong wrangler.toml.
```

- [ ] **Step 7: Test, typecheck, lint**

Run: `pnpm vitest run scripts/lib/update-plan.test.mjs scripts/lib/server-env.test.mjs scripts/data-rollback.test.mjs && pnpm typecheck && pnpm lint`
Expected: xanh.

- [ ] **Step 8: Commit**

```bash
git add scripts/data-update.mjs scripts/data-rollback.mjs scripts/server-setup.mjs scripts/lib/server-env.mjs scripts/lib/server-env.test.mjs scripts/lib/update-plan.mjs scripts/lib/update-plan.test.mjs
git commit -m "feat(server): móc graph Valhalla vào data:update, data:rollback và server:setup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 14: Smoke production — `pnpm smoke:directions` (ba tuyến chuẩn, p95)

**Files:**
- Create: `scripts/smoke-directions.mjs`
- Create: `scripts/smoke-directions.test.mjs`
- Modify: `package.json` (script `smoke:directions`)

- [ ] **Step 1: Viết test đỏ**

`scripts/smoke-directions.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import {
  SMOKE_ROUTES,
  assertDirectionsTarget,
  percentile,
  runDirectionsSmoke,
  validateDirectionsSmoke,
} from './smoke-directions.mjs';

const ok = (mode, highway = false) => ({
  routes: [
    {
      mode,
      distance_m: 9000,
      duration_s: 900,
      flags: { toll: false, highway, ferry: false },
      legs: [{ steps: [{ kind: 'depart', instruction: 'Đi về hướng bắc.' }, { kind: 'arrive', instruction: 'Đến nơi.' }] }],
    },
  ],
};
const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('smoke directions', () => {
  it('ba tuyến chuẩn: xe máy nội thành, xe máy liên tỉnh, ô tô liên tỉnh, đi bộ Hà Nội', () => {
    expect(SMOKE_ROUTES.map((r) => `${r.name}:${r.mode}`)).toEqual([
      'noi-thanh-hcm:motorbike',
      'lien-tinh-xe-may:motorbike',
      'lien-tinh-o-to:car',
      'di-bo-ha-noi:walk',
    ]);
  });

  it('percentile 95 trên mẫu nhỏ lấy phần tử trên', () => {
    expect(percentile([100, 200, 300, 400, 500], 95)).toBe(500);
    expect(percentile([300, 100, 200], 50)).toBe(200);
    expect(percentile([], 95)).toBeNull();
  });

  it('gom mẫu theo tuyến: status, p95, cờ highway, có dấu tiếng Việt', async () => {
    const summary = await runDirectionsSmoke('https://api.test', 'k', 2, {
      intervalMs: 0,
      fetchImpl: async (url) => {
        const mode = new URL(url).searchParams.get('mode');
        return reply(200, ok(mode, mode === 'car'));
      },
    });
    expect(summary).toHaveLength(4);
    expect(summary[0]).toMatchObject({ name: 'noi-thanh-hcm', mode: 'motorbike', ok: 2, failed: 0, highway: false, vietnamese: true, distance_m: 9000 });
    expect(summary[2]).toMatchObject({ name: 'lien-tinh-o-to', highway: true });
    expect(typeof summary[0].p95_ms).toBe('number');
  });

  it('validate: lỗi HTTP, xe máy lên cao tốc, thiếu dấu, vượt p95 đều bị chặn', () => {
    const good = SMOKE_ROUTES.map((r) => ({ name: r.name, mode: r.mode, ok: 3, failed: 0, highway: r.mode === 'car', vietnamese: true, distance_m: 1000, p95_ms: 400, codes: [] }));
    expect(() => validateDirectionsSmoke(good, null)).not.toThrow();
    expect(() => validateDirectionsSmoke([{ ...good[0], failed: 1 }], null)).toThrow(/noi-thanh-hcm/);
    expect(() => validateDirectionsSmoke([{ ...good[1], highway: true }], null)).toThrow(/cao tốc/);
    expect(() => validateDirectionsSmoke([{ ...good[0], vietnamese: false }], null)).toThrow(/tiếng Việt/);
    expect(() => validateDirectionsSmoke(good, 300)).toThrow(/p95/);
    expect(() => validateDirectionsSmoke(good, 500)).not.toThrow();
  });

  it('production cần --confirm-production', () => {
    expect(() => assertDirectionsTarget('https://api.ai-solutions.io.vn', [])).toThrow(/--confirm-production/);
    expect(() => assertDirectionsTarget('https://api.ai-solutions.io.vn', ['--confirm-production'])).not.toThrow();
    expect(() => assertDirectionsTarget('http://127.0.0.1:8787', [])).not.toThrow();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm vitest run scripts/smoke-directions.test.mjs`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `scripts/smoke-directions.mjs`**

```js
#!/usr/bin/env node
// Smoke chỉ đường trên production (spec dẫn đường A mục 7.4): bốn tuyến chuẩn, N lượt mỗi tuyến, p95.
//   pnpm smoke:directions -- --confirm-production [--requests=5] [--p95-max=1500] [--interval-ms=3500] [--base=https://…]
// /v1/directions có burst 20 request/phút/khoá+IP nên smoke tự cách 3,5 s giữa các lượt (~17/phút):
// 20 lượt × 4 tuyến ≈ 4,7 phút. Không hạ interval khi chạy production, nếu không sẽ tự gây 429.
// Khoá đọc từ MAPSLIBVN_API_KEY hoặc KEY_EXAMPLE_EMBED (.env). Lần đầu chạy --requests=20 để lấy p95 ghi
// evidence, sau đó chốt --p95-max theo số đo (không đoán).
import 'dotenv/config';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE = 'https://api.ai-solutions.io.vn';
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

/** @type {readonly { name: string, mode: 'motorbike' | 'car' | 'walk', from: string, to: string }[]} */
export const SMOKE_ROUTES = [
  // Nhà thờ Đức Bà → Sân bay Tân Sơn Nhất (~8 km)
  { name: 'noi-thanh-hcm', mode: 'motorbike', from: '10.7798,106.6990', to: '10.8188,106.6520' },
  // TP.HCM → Vũng Tàu (~100 km): xe máy KHÔNG được lên cao tốc → flags.highway phải false
  { name: 'lien-tinh-xe-may', mode: 'motorbike', from: '10.7725,106.6980', to: '10.3460,107.0843' },
  // TP.HCM → Cần Thơ (~170 km) ô tô
  { name: 'lien-tinh-o-to', mode: 'car', from: '10.7725,106.6980', to: '10.0341,105.7841' },
  // Hồ Gươm → Lăng Bác (~2,5 km) đi bộ
  { name: 'di-bo-ha-noi', mode: 'walk', from: '21.0285,105.8542', to: '21.0369,105.8348' },
];

/** @param {number[]} values @param {number} p */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

/**
 * @typedef {{ name: string, mode: string, ok: number, failed: number, highway: boolean | null,
 *   vietnamese: boolean, distance_m: number | null, p95_ms: number | null, codes: string[] }} RouteSummary
 * @param {string} base @param {string} key @param {number} requests
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, intervalMs?: number }} [options]
 * @returns {Promise<RouteSummary[]>}
 */
export async function runDirectionsSmoke(base, key, requests, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 3_500;
  const root = base.replace(/\/+$/, '');
  const total = SMOKE_ROUTES.length * requests;
  let sent = 0;
  /** @type {RouteSummary[]} */
  const summary = [];
  for (const route of SMOKE_ROUTES) {
    const url = `${root}/v1/directions?from=${route.from}&to=${route.to}&mode=${route.mode}`;
    /** @type {number[]} */
    const durations = [];
    /** @type {RouteSummary} */
    const row = { name: route.name, mode: route.mode, ok: 0, failed: 0, highway: null, vietnamese: false, distance_m: null, p95_ms: null, codes: [] };
    for (let i = 0; i < requests; i++) {
      // Cách đều mọi lượt (kể cả giữa hai tuyến và sau lượt lỗi) để không tự vướng burst limiter.
      if (sent > 0 && intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
      sent += 1;
      const t0 = Date.now();
      try {
        const response = await fetchImpl(url, { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(timeoutMs) });
        durations.push(Date.now() - t0);
        if (response.status !== 200) {
          row.failed += 1;
          try {
            row.codes.push(String((await response.json())?.error?.code ?? response.status));
          } catch {
            row.codes.push(String(response.status));
          }
          continue;
        }
        const body = await response.json();
        const first = body?.routes?.[0];
        row.ok += 1;
        row.distance_m = first?.distance_m ?? null;
        row.highway = first?.flags?.highway ?? null;
        row.vietnamese = Boolean(first?.legs?.some((leg) => leg.steps?.some((s) => VI.test(s.instruction))));
      } catch {
        row.failed += 1;
        row.codes.push('timeout');
      }
    }
    row.p95_ms = percentile(durations, 95);
    row.codes = [...new Set(row.codes)];
    summary.push(row);
  }
  return summary;
}

/** @param {RouteSummary[]} summary @param {number | null} p95Max */
export function validateDirectionsSmoke(summary, p95Max) {
  for (const row of summary) {
    if (row.failed > 0) throw new Error(`${row.name}: ${row.failed} lượt lỗi (${row.codes.join(',')})`);
    if (row.mode === 'motorbike' && row.highway) throw new Error(`${row.name}: xe máy bị dẫn lên cao tốc (flags.highway=true) — chỉnh costing_options.motor_scooter.use_highways`);
    if (!row.vietnamese) throw new Error(`${row.name}: không có câu chỉ dẫn tiếng Việt có dấu`);
    if (p95Max !== null && row.p95_ms !== null && row.p95_ms > p95Max) throw new Error(`${row.name}: p95 ${row.p95_ms} ms vượt ngưỡng ${p95Max} ms`);
  }
}

/** @param {string} base @param {string[]} argv */
export function assertDirectionsTarget(base, argv) {
  if (new URL(base).hostname === new URL(DEFAULT_BASE).hostname && !argv.includes('--confirm-production')) {
    throw new Error('Production cần cờ --confirm-production');
  }
}

/** @param {string} name */
function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const base = arg('base') ?? DEFAULT_BASE;
  const key = process.env.MAPSLIBVN_API_KEY ?? process.env.KEY_EXAMPLE_EMBED;
  if (!key) throw new Error('Thiếu MAPSLIBVN_API_KEY hoặc KEY_EXAMPLE_EMBED trong môi trường');
  assertDirectionsTarget(base, process.argv);
  const requests = Number(arg('requests') ?? 5);
  if (!Number.isInteger(requests) || requests < 1 || requests > 50) throw new Error('--requests từ 1 đến 50');
  const p95Raw = arg('p95-max');
  const p95Max = p95Raw === undefined ? null : Number(p95Raw);
  if (p95Max !== null && !(p95Max > 0)) throw new Error('--p95-max phải là số dương (ms)');
  const intervalMs = Number(arg('interval-ms') ?? 3500);
  if (!Number.isInteger(intervalMs) || intervalMs < 0) throw new Error('--interval-ms phải là số nguyên ≥ 0');
  console.log(`${SMOKE_ROUTES.length * requests} lượt, cách ${intervalMs} ms — ước ${Math.ceil((SMOKE_ROUTES.length * requests * intervalMs) / 60_000)} phút`);
  const summary = await runDirectionsSmoke(base, key, requests, { intervalMs });
  console.table(summary.map(({ codes, ...row }) => ({ ...row, codes: codes.join(',') })));
  validateDirectionsSmoke(summary, p95Max);
  console.log(`✓ smoke directions ${base} — ${requests} lượt/tuyến`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
```
`package.json` scripts: thêm `"smoke:directions": "node scripts/smoke-directions.mjs",` sau `"smoke:rate-limit"`.

- [ ] **Step 4: Test xanh, typecheck, lint, commit**

Run: `pnpm vitest run scripts/smoke-directions.test.mjs && pnpm typecheck && pnpm lint`
Expected: PASS 5 test; sạch. (Nếu `checkJs` than về `body?.routes` kiểu `any`, khai báo `/** @type {any} */ const body = await response.json();`.)

```bash
git add scripts/smoke-directions.mjs scripts/smoke-directions.test.mjs package.json
git commit -m "feat(scripts): smoke chỉ đường production với bốn tuyến chuẩn và p95

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 15: Tài liệu — docs site, README core, THIRD_PARTY_NOTICES, README máy chủ

**Files:**
- Modify: `apps/docs/src/content/docs/api.md`
- Modify: `apps/docs/src/content/docs/tinh-nang.md`
- Modify: `apps/docs/src/content/docs/sdk.md`
- Modify: `apps/docs/src/content/docs/khoa-api.md` (bảng giới hạn)
- Modify: `docs/legal/dieu-khoan-tenant.md` mục 5 (toạ độ trong log — quyết định PHONG 10/09, phương án 1)
- Modify: `docs/legal/checklist-phap-ly.md` mục C (C6: phương án 2 để sau)
- Modify: `THIRD_PARTY_NOTICES.md` (+ chạy `node scripts/notices-sync.mjs`)
- Modify: `infra/server/README.md`

- [ ] **Step 1: `api.md` — bảng lỗi (mục 2) và quota/cache (mục 3)**

Mục 2, thêm dòng vào bảng sau dòng `not_found`:
```
| `no_route` | 404 | `GET /v1/directions`: không có đường giữa các điểm, hoặc điểm quá xa mạng đường / vùng không kết nối |
```
Sửa dòng `upstream_unavailable` thành: `| `upstream_unavailable` | 503 | không truy vấn được cơ sở dữ liệu, không tra được khoá, chưa có phiên bản tiles, dịch vụ chỉ đường không phản hồi (kể cả lúc build lại graph) hoặc lỗi không xác định |`.

Mục 3, sau đoạn "**Quota Places.**…" thêm đoạn:
```
**Quota Chỉ đường.** `GET /v1/directions` có quota **riêng**, cũng theo ngày Việt Nam và cũng chặn ở 2× hạn mức: plan `free` mặc định **2.000** lượt/ngày, khoá có thể được đặt hạn riêng (`quota_directions_per_day`). Tenant `internal` không bị đếm theo ngày. Burst **20 request/phút** cho mỗi cặp khoá + IP (riêng, không dùng chung 60 của Places). Ngoài ra khoá `web` và `mobile` — kể cả của tenant `internal`, vì khoá loại này nằm công khai trong trang/app — chịu **trần 100 request/phút cho cả khoá** (mọi IP cộng lại); khoá `server` không chịu trần này. Vượt trả `429 rate_limit_exceeded` với `retry-after: 60`.
```
`khoa-api.md` bảng giới hạn (sau dòng `Burst Places`) thêm hai dòng:
```
| Burst Chỉ đường | 20 lượt / phút / điểm Cloudflare | mỗi cặp khoá + IP, riêng `GET /v1/directions` |
| Trần theo khoá Chỉ đường | 100 lượt / phút / điểm Cloudflare | mọi IP cộng lại; chỉ khoá `web` và `mobile` (kể cả tenant internal), khoá `server` không chịu |
```
Bảng cache thêm dòng `| `/v1/directions` | 60 giây | 5 phút |` và sửa câu "Với `/v1/autocomplete` và `/v1/places/{id}`" → "Với `/v1/autocomplete`, `/v1/places/{id}` và `/v1/directions`".

- [ ] **Step 2: `api.md` — mục mới `GET /v1/directions`**

Chèn **ngay trước** dòng `## 5. Endpoint ghi`:
````markdown
### GET /v1/directions

Tuyến đường giữa hai điểm (có thể qua điểm dừng) cho xe máy, ô tô hoặc đi bộ, kèm bước rẽ tiếng Việt. Tính bởi Valhalla trên dữ liệu đường OpenStreetMap; **chưa** có giao thông trực tiếp, chưa tránh phí/cao tốc theo yêu cầu. Endpoint này cần scope `places:read` nhưng tính vào **quota Chỉ đường** (mục 3), không tính vào quota Places.

| Tham số | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `from` | `lat,lng` | có | — | vĩ độ trước |
| `to` | `lat,lng` | có | — | |
| `via` | `lat,lng;lat,lng…` | không | — | tối đa 5 điểm dừng, theo thứ tự |
| `mode` | `motorbike` \| `car` \| `walk` | không | `motorbike` | xe máy không đi cao tốc |
| `lang` | `vi` \| `en` | không | `vi` | ngôn ngữ câu chỉ dẫn |
| `alternatives` | `0` \| `1` | không | `0` | `1` xin thêm tối đa một tuyến thay thế; **bị bỏ qua khi có `via`** |

Mọi điểm phải nằm trong Việt Nam (vĩ độ 8–24, kinh độ 102–110). Tổng đường chim bay giữa các điểm liên tiếp tối đa: xe máy 500 km, ô tô 2.000 km, đi bộ 50 km — vượt trả `400 invalid_request` ghi rõ giới hạn.

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/directions?from=10.7798,106.6990&to=10.7725,106.6980&mode=motorbike"
```

```json
{
  "routes": [
    {
      "mode": "motorbike",
      "distance_m": 1240,
      "duration_s": 210,
      "bbox": [106.6975, 10.7725, 106.699, 10.7798],
      "geometry": "oh}pSonkojEnoBf^~{Bf^v|Af^~{Bod@",
      "legs": [
        {
          "distance_m": 1240,
          "duration_s": 210,
          "shape_offset": 0,
          "steps": [
            {
              "kind": "depart",
              "instruction": "Đi về hướng nam trên Đồng Khởi.",
              "verbal_pre": "Đi về hướng nam trên Đồng Khởi trong 200 mét.",
              "verbal_post": "Đi tiếp 200 mét.",
              "street_names": ["Đồng Khởi"],
              "distance_m": 200,
              "duration_s": 30,
              "shape_begin": 0,
              "shape_end": 1,
              "location": [106.699, 10.7798],
              "roundabout_exit": null
            },
            { "kind": "turn_left", "instruction": "Rẽ trái vào Lê Lợi.", "…": "…" },
            { "kind": "arrive", "instruction": "Bạn đã đến điểm dừng.", "…": "…" }
          ]
        }
      ],
      "flags": { "toll": false, "highway": false, "ferry": false }
    }
  ],
  "waypoints": [
    { "location": [106.699, 10.7798], "snapped": [106.699, 10.7798], "name": null },
    { "location": [106.698, 10.7725], "snapped": [106.6981, 10.7725], "name": null }
  ],
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "valhalla", "graph": "2026-09-15" }
}
```

Điểm cần chú ý:

- **Toạ độ trong response theo thứ tự `[lng, lat]`** (GeoJSON), kể cả `location`/`snapped` — khác tham số vào `lat,lng`.
- `geometry` là polyline mã hoá **precision 6** của **cả tuyến**; giải mã bằng `decodePolyline6` trong `@mapslibvn/core` ra `[lng, lat][]`. `steps[].shape_begin/shape_end` và `legs[].shape_offset` là chỉ số vào polyline đó.
- `kind` là tập cố định: `depart`, `arrive`, `continue`, `slight_right`, `slight_left`, `turn_right`, `turn_left`, `sharp_right`, `sharp_left`, `uturn_right`, `uturn_left`, `ramp_straight`, `ramp_right`, `ramp_left`, `exit_right`, `exit_left`, `keep_right`, `keep_left`, `merge`, `merge_right`, `merge_left`, `roundabout_enter`, `roundabout_exit`, `ferry_enter`, `ferry_exit`, `elevator`, `steps`, `escalator`, `building_enter`, `building_exit`, `other`. `roundabout_exit` chỉ khác `null` khi `kind = roundabout_enter`.
- `verbal_pre`/`verbal_post` dành cho đọc bằng giọng nói; có thể `null`.
- `waypoints[].snapped` là điểm trên tuyến gần điểm bạn gửi; `name` hiện luôn `null`.
- `engine` là thông tin chẩn đoán (`graph` = ngày build dữ liệu đường), **không phải hợp đồng ổn định**.
- Toạ độ `from`/`to`/`via` nằm trong URL nên có trong log request của Cloudflare Workers (giữ vài ngày, chỉ để chẩn đoán; xem [Điều khoản tenant](/dieu-khoan/) mục 5). Tenant là bên kiểm soát dữ liệu vị trí của người dùng cuối.
- Không có đường → `404 no_route`. Dịch vụ đang build lại dữ liệu (thứ Hai ~02:00 giờ VN, vài chục phút) → `503 upstream_unavailable` với `retry-after: 30`; bản cache còn trong 5 phút vẫn được trả.
````

Mục 6 (`### GET /healthz`), sau câu về `/healthz/db` thêm: `Tương tự, `GET /healthz/routing` kiểm dịch vụ chỉ đường: trả `{ ok, version, graph_built_at, ms }` (ISO thời điểm build graph) hoặc `503 upstream_unavailable`.`

Mục 7: thêm vào **cuối** khối ```ts (trước dấu đóng) nguyên văn các kiểu `TravelMode`, `DirectionsLang`, `ManeuverKind`, `RouteStep`, `RouteLeg`, `Route`, `Waypoint`, `DirectionsResponse` từ `packages/core/src/types.ts` (copy đúng mã ở Task 2 Step 3, bỏ `export`). Thêm vào danh sách "Vài điểm dễ sai": `- `Route.geometry` là polyline6 (không phải GeoJSON); mọi toạ độ trong `Route`/`Waypoint` là `[lng, lat]`.`

- [ ] **Step 3: `tinh-nang.md`**

Chèn mục mới trước `## 5. Đóng góp và duyệt` và đánh số lại các mục sau (5→6, 6→7, 7→8, 8→9, 9→10):
```markdown
## 5. Chỉ đường

`GET /v1/directions` trả tuyến cho **xe máy** (không lên cao tốc), **ô tô** và **đi bộ** giữa hai điểm
trong Việt Nam, tối đa 5 điểm dừng, kèm bước rẽ tiếng Việt (hoặc tiếng Anh) có câu đọc bằng giọng nói.
Engine là Valhalla tự host trên dữ liệu đường OpenStreetMap, cập nhật cùng kỳ với tiles nền. Kết quả
theo schema riêng của MapsLibVN (`Route`, `RouteStep`), không lộ định dạng engine. Chưa có giao thông
trực tiếp, chưa tránh phí/cao tốc theo yêu cầu; logic dẫn đường theo GPS trên thiết bị thuộc SDK giai
đoạn sau. Chi tiết ở [REST API](/api/) mục 4.
```
Trong mục "Trạng thái và giới hạn hiện tại" thêm gạch đầu dòng: `- **Chỉ đường** dựa trên dữ liệu đường một chiều và cấm rẽ của OSM Việt Nam, còn thiếu ở nhiều nơi; tuyến nội thành có thể kém ứng dụng thương mại. ETA theo cấp đường, không có giao thông trực tiếp.`

- [ ] **Step 4: `sdk.md`**

Bảng "Kiểu dữ liệu API" thêm vào cuối ô: `, `TravelMode`, `DirectionsLang`, `ManeuverKind`, `Route`, `RouteLeg`, `RouteStep`, `Waypoint`, `DirectionsResponse``. Thêm dòng bảng nhóm mới: `| Chỉ đường | `decodePolyline6`, `encodePolyline6`, `MANEUVER_KINDS`, `VALHALLA_MANEUVER_KIND`, `maneuverKindFromValhalla`, kiểu `DirectionsOptions` |`.

Bảng "Phương thức client": thêm `| `directions(opts)` | `GET /v1/directions` | `DirectionsResponse` |` sau dòng `reverse`. Bảng `opts`: thêm `| `directions` | `from`, `to` (bắt buộc, `[lat, lng]`), `via`, `mode`, `lang`, `alternatives` |`. Sau đoạn "Lưu ý về thứ tự toạ độ" thêm câu: `Với `directions`, tham số vào là `[lat, lng]` nhưng mọi toạ độ trong `DirectionsResponse` là `[lng, lat]`; giải mã `Route.geometry` bằng `decodePolyline6`.`

- [ ] **Step 5: Điều khoản tenant và checklist pháp lý (riêng tư toạ độ — PHONG chọn phương án 1 ngày 10/09/2026)**

`docs/legal/dieu-khoan-tenant.md`, mục 5, thay điểm 5 hiện có:
```
5. Log request của MapsLibVN giữ tối đa 30 ngày; số liệu tổng hợp (Analytics Engine) không chứa định danh người dùng cuối.
```
bằng:
```
5. Log request của MapsLibVN (Cloudflare Workers Logs) giữ tối đa 30 ngày và chỉ dùng để chẩn đoán lỗi. Vì tham số nằm trong URL, log này có **toạ độ mà ứng dụng gửi lên** — `near`, `lat`/`lng` của tìm kiếm và reverse geocode, `from`/`to`/`via` của chỉ đường — kèm định danh khoá API của tenant, không kèm định danh người dùng cuối. MapsLibVN không trích xuất, không ghép các toạ độ này thành hành trình hay hồ sơ người dùng, không chuyển cho bên thứ ba. Số liệu tổng hợp (Analytics Engine) chỉ có đường dẫn endpoint, không có tham số. Tenant có nghĩa vụ nêu việc này trong thông báo xử lý dữ liệu với người dùng cuối của mình (điểm 3).
```
Trang `dieu-khoan.md` của docs site sinh từ file này lúc prebuild (`apps/docs/scripts/copy-legal.mjs`), không sửa trực tiếp trong `apps/docs`.

`docs/legal/checklist-phap-ly.md`, bảng mục C thêm dòng sau C5:
```
| C6 | Giảm dấu vết toạ độ trong log Workers: hạ `head_sampling_rate` (ví dụ 0,1) hoặc tắt invocation logs production trong `[observability]` của `apps/api/wrangler.toml` | Review bảo mật spec dẫn đường A 10/09/2026: PHONG chọn chỉ ghi điều khoản (phương án 1), để phương án kỹ thuật này lại; đổi lại khi làm là khó tra lỗi hiếm |
```

- [ ] **Step 6: THIRD_PARTY_NOTICES và README máy chủ**

`THIRD_PARTY_NOTICES.md` mục 5: thêm `Valhalla (MIT — engine chỉ đường, chạy như dịch vụ riêng trên máy chủ, không liên kết mã)` vào danh sách sau `PostGIS (…)`. Chạy `node scripts/notices-sync.mjs` để đồng bộ bản sao vào 4 gói SDK (CI có `--check`).

`infra/server/README.md`: mục "Việc tay trên Cloudflare (một lần)" thêm mục 7:
```markdown
7. **Chỉ đường (spec dẫn đường A, 10/09/2026)** — mở Valhalla ra Worker:
   1. Access → Service Auth → Create Service Token `routing` (thời hạn dài nhất) → lưu Client ID/Secret vào password manager. Token có hạn: khi hết, `/healthz/routing` trả 503 và log Worker có `valhalla 403` → tạo token mới, `wrangler secret put` lại, xoá token cũ.
   2. Access → Applications → Add → Self-hosted `mapslibvn-route`, domain `maps-route.<domain>` → Policy Service Auth, include Service Token `routing`.
   3. **Chỉ sau khi có Access application**: Tunnel `mapslibvn-db` → Public Hostname → Add: subdomain `maps-route`, domain `<domain>`, Service type **HTTP**, URL `valhalla:8002`. (Làm ngược thứ tự là Valhalla công khai trên Internet trong lúc chưa có Access.)
   4. Máy dev: `cd apps/api && pnpm exec wrangler secret put ROUTING_ACCESS_CLIENT_ID --env production` và `… ROUTING_ACCESS_CLIENT_SECRET --env production`. `ROUTING_BASE` production nằm sẵn trong `wrangler.toml`.
   5. Kiểm (đọc secret từ biến môi trường, không gõ thẳng vào lệnh để khỏi lọt shell history): `curl -H "CF-Access-Client-Id: $CF_ROUTING_ID" -H "CF-Access-Client-Secret: $CF_ROUTING_SECRET" https://maps-route.<domain>/status` → JSON có `version`; không header → 403 của Access.
```
Mục "Kiểm tra": sửa "4 dịch vụ `running`" → "5 dịch vụ `running` (`valhalla` `healthy` sau khi build graph xong)"; thêm gạch đầu dòng:
```markdown
- Graph chỉ đường: `docker compose … run --rm pipeline node scripts/routing-graph.mjs status` in `graph.json`, kích cỡ tar và `pendingReload`. Build lại tay: `… node scripts/routing-graph.mjs prepare --force` (valhalla ngừng phục vụ vài chục phút trong lúc build); quay về bản trước: `… node scripts/routing-graph.mjs rollback`. `data:update` tự gọi `prepare` khi OSM đổi.
- Worker: `curl https://api.<domain>/healthz/routing` → `{"ok":true,"version":"3.8.x","graph_built_at":"…"}`.
```
Mục "Vận hành" thêm: `- Không bao giờ thêm `ports:` cho `valhalla`. Đường vào duy nhất là Tunnel + Access.`, `- `pnpm server:update` kéo cả image `valhalla`; sau cập nhật lần đầu chạy `routing-graph.mjs prepare` nếu volume `valhalla-data` còn rỗng (container sẽ khởi động lại liên tục cho tới khi có PBF).`, `- Sau `pnpm server:restore` trên máy mới, graph không nằm trong backup: chạy `routing-graph.mjs prepare` để build lại (volume `valhalla-data` cần ~5 GB: PBF + thư mục tile + tar + tar prev).` và `- Build lỗi/OOM: container ngủ 10 phút rồi Docker khởi động lại; xem `docker compose … logs valhalla`, quay về graph cũ bằng `routing-graph.mjs rollback`.`

- [ ] **Step 7: Build docs, kiểm link, commit**

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/docs build && node scripts/notices-sync.mjs --check && pnpm lint`
Expected: docs build xong (số trang không đổi), notices khớp, lint sạch.

```bash
git add apps/docs/src/content/docs/api.md apps/docs/src/content/docs/tinh-nang.md apps/docs/src/content/docs/sdk.md apps/docs/src/content/docs/khoa-api.md docs/legal/dieu-khoan-tenant.md docs/legal/checklist-phap-ly.md THIRD_PARTY_NOTICES.md packages/*/THIRD_PARTY_NOTICES.md infra/server/README.md
git commit -m "docs: tài liệu GET /v1/directions, client.directions, Valhalla trong notices và README máy chủ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 16: Phát hành mã — cổng cục bộ, push, CI, Deploy API (PHONG duyệt push)

Điều kiện: Task 1–15 commit xong. Worker sẽ được deploy TRƯỚC khi máy chủ có Valhalla (Task 17): `/v1/directions` trả `503 upstream_unavailable` cho tới khi Tunnel + secret sẵn; các endpoint khác không ảnh hưởng (`loadAuth` đọc cột mới qua `to_jsonb`, migration 0012 áp ở Task 17).

- [x] **Step 1: Cổng cục bộ đầy đủ**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:routing`
Expected: tất cả xanh (ghi số file/test vào DEVLOG ở Task 19).

- [x] **Step 2: Push và theo dõi CI** → thay bằng deploy tay (xem ghi chú 11/09)

```bash
git push origin main
gh run list --limit 8
```
Expected: `CI`, `Deploy API`, `Deploy Docs`, `DB tests` (paths `db/**`, `scripts/**`), `Routing tests` (paths routing) đều xanh. Nếu `Routing tests` không tự chạy: `gh workflow run "Routing tests"` rồi `gh run watch`. Ghi ID run vào evidence Task 18.

- [x] **Step 3: Kiểm Worker production ngay sau deploy**

```bash
curl -s https://api.ai-solutions.io.vn/healthz
curl -s https://api.ai-solutions.io.vn/healthz/routing
curl -s -H "X-Api-Key: $KEY_EXAMPLE_EMBED" "https://api.ai-solutions.io.vn/v1/autocomplete?q=highlands&near=10.776,106.700" | head -c 200
```
Expected: `/healthz` 200; `/healthz/routing` **503** `upstream_unavailable` (chưa có Tunnel/secret — đúng kỳ vọng); autocomplete 200 (chứng minh `loadAuth` mới chạy được khi cột `quota_directions_per_day` chưa có trên production).


### Thực tế 11/09/2026 — GitHub Actions bị khoá vì thanh toán

Mọi workflow (`CI`, `Deploy API`, `Deploy Docs`, `DB tests`, `Routing tests`) fail sau 3–23 giây, không có log: job không bao giờ khởi động. Push KHÔNG deploy. Step 2 được thay bằng:

1. Không có gì để push — `origin/main` đã bằng `main` tại `504d27e`.
2. Tự chạy cổng chặn `apitest` mà `Deploy API` lẽ ra chạy: `DATABASE_URL='postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn' pnpm test:api-db` → **53 test xanh** (dev DB ở cổng 5432; postgres máy chủ không publish cổng nên không có rủi ro chạm production).
3. Build như CI: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/style build && pnpm --filter @mapslibvn/admin build`.
4. Deploy tay từ `apps/api`: `npx wrangler deploy --env production`.

Kết quả cổng cục bộ (Step 1): `pnpm lint` 374 file sạch · `pnpm typecheck` 14/14 · `pnpm test` **223 test / 32 file** · `pnpm test:routing` **7 test**. Core gzip **10,62 kB** (limit 12 kB).

Deploy: `mapslibvn-api-production`, Version ID `03db4486-ebd6-4f28-8173-d1d4295a1c5c`, startup 25 ms, upload 388,27 KiB (gzip 92,65 KiB). Ba rate limiter lên đúng: `PLACES_RATE_LIMITER` 60/60s, `DIRECTIONS_RATE_LIMITER` 20/60s, `DIRECTIONS_KEY_RATE_LIMITER` 100/60s.

Kiểm production (Step 3):

| Kiểm | Kết quả | Kỳ vọng |
| --- | --- | --- |
| `/healthz` | 200 `{"ok":true,"environment":"production"}` | ✅ |
| `/healthz/routing` | 503 `upstream_unavailable` | ✅ (chưa có Tunnel/Valhalla — Task 17) |
| `/healthz/db` | `schema_migration: 0011_api_key_drop_plain.sql` | ✅ migration 0012 áp ở Task 17 |
| `/v1/autocomplete` | 200, trả POI Highlands Coffee | ✅ `loadAuth` mới chạy được khi cột `quota_directions_per_day` chưa có |
| `/v1/directions` | 503 `upstream_unavailable` | ✅ đúng kỳ vọng trước Task 17 |

Còn nợ khi Actions mở lại: chạy `gh workflow run "Routing tests"` và ghi ID run vào evidence Task 18.

---

## Task 17: Máy chủ thật — Docker Desktop, Valhalla, graph Việt Nam, Cloudflare, đo RAM (PHONG chạy, Fable hướng dẫn)

Điều kiện: Task 16 đã push. PHONG xác nhận máy chủ đã tắt auto-sleep khi cắm điện (điều kiện mở tính năng, spec mục 9).

**Files:** không sửa code; kết quả ghi `docs/evidence/routing/2026-09-XX-build-graph-may-chu.md` + `build-stats.txt`.

- [ ] **Step 0: Tài nguyên VM Docker Desktop** (macOS: container chạy trong VM, không phải RAM máy)

```bash
docker info --format 'RAM VM: {{.MemTotal}} bytes · CPU: {{.NCPU}}'
```
Expected: RAM VM ≥ 12 GB (12884901888). Nếu nhỏ hơn: Docker Desktop → Settings → Resources → Memory ≥ 12 GB, CPU ≥ 4 → Apply & restart → chạy lại lệnh. `PG_SHARED_BUFFERS` trong `infra/server/.env` được sinh từ RAM máy (16 GB → 4 GB); nếu VM chỉ 12 GB thì hạ xuống `3GB` và `docker compose … up -d postgres` sau bước này. Ghi số vào evidence.

- [ ] **Step 1: Cập nhật máy chủ, migration 0012, tạo graph lần đầu**

```bash
pnpm server:update          # git pull, kéo image (kể cả valhalla), compose up -d, migration 0012
C="docker compose --env-file infra/server/.env -f infra/server/compose.yml"
$C run --rm -T pipeline sh -c 'test -f /app/work/data/sources/vietnam.osm.pbf && echo co-pbf || echo thieu-pbf'
# nếu thieu-pbf:  $C run --rm pipeline node pipelines/tiles/src/download.mjs
$C run --rm pipeline node scripts/routing-graph.mjs prepare
$C logs -f valhalla          # theo dõi tới dòng "Starting valhalla service!"
```
Expected: `[db:migrate] Áp dụng 0012_api_key_quota_directions.sql`; `[routing-graph] đã ghi cờ reload.request (rebuild)`; log valhalla: `valhalla_build_admins`, `valhalla_build_timezones`, `valhalla_build_tiles … build`, `… enhance`, `valhalla_build_extract`, rồi `INFO: Found config file. Starting valhalla service!`. (Container có thể đã khởi động lại vài lần trước `prepare` vì chưa có PBF — bình thường.)

- [ ] **Step 2: Đo trong lúc build** (terminal thứ hai trên máy chủ)

```bash
( while docker inspect -f '{{.State.Running}}' mapslibvn-server-valhalla-1 >/dev/null 2>&1; do \
    docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' mapslibvn-server-valhalla-1 mapslibvn-server-postgres-1; sleep 60; \
  done ) | tee /tmp/valhalla-build-stats.txt
```
Dừng bằng Ctrl+C khi `/status` trả 200. Ghi: thời gian từ cờ tới `Starting valhalla service!` (timestamp log), RAM đỉnh `valhalla`, RAM `postgres` cùng lúc, dung lượng tar (`$C run --rm pipeline node scripts/routing-graph.mjs status`).

- [ ] **Step 3: Kiểm nội bộ trên máy chủ**

```bash
$C exec -T valhalla curl -s http://localhost:8002/status
$C exec -T valhalla curl -s -X POST http://localhost:8002/route -H 'content-type: application/json' \
  -d '{"locations":[{"lat":10.7798,"lon":106.699},{"lat":10.7725,"lon":106.698}],"costing":"motor_scooter","directions_options":{"language":"vi-VN","units":"kilometers"}}' | head -c 600
```
Expected: `{"version":"3.8.3","tileset_last_modified":…}`; JSON tuyến có `"language":"vi-VN"` và câu tiếng Việt.

- [ ] **Step 4: Việc tay trên Cloudflare** (PHONG, theo `infra/server/README.md` mục 7, **đúng thứ tự**: service token `routing` → Access application `mapslibvn-route` → public hostname `maps-route` → hai `wrangler secret put` trên máy dev). Kiểm: `curl` có header Access → JSON; không header → 403. Sau đó `curl -s https://api.ai-solutions.io.vn/healthz/routing` → 200 (Worker đọc secret ngay, không cần deploy lại).

- [ ] **Step 5: Kiểm kịch bản bọc (spec mục 7.5)**

```bash
$C run --rm pipeline node scripts/routing-graph.mjs rollback   # chưa có prev → phải báo lỗi rõ, không đụng gì
$C run --rm pipeline node scripts/routing-graph.mjs prepare --force
$C logs --since 2m valhalla | grep run.sh      # "thấy cờ 'rebuild' → dừng nhóm tiến trình"
# … chờ build lần 2 xong (đo lại thời gian) …
$C run --rm pipeline node scripts/routing-graph.mjs rollback   # nay có prev
$C logs --since 1m valhalla | grep run.sh      # "thấy cờ 'rollback'"; /status quay lại 200 trong < 1 phút, tileset_last_modified là mốc CŨ
```
Expected đúng như chú thích. Nếu `prepare --force` không làm container build lại (log không có `run.sh`), đọc `docker logs` và áp phương án dự phòng spec mục 4.3 (docker-socket-proxy) — ghi DEVLOG "Quyết định phát sinh" trước khi làm.

- [ ] **Step 6: Ghi evidence và quyết định RAM**

Tạo `docs/evidence/routing/2026-09-XX-build-graph-may-chu.md`:
```markdown
# Build graph Valhalla Việt Nam trên máy chủ nội bộ

Ngày: 2026-09-XX. Máy: 16 GB RAM; VM Docker Desktop … GB / … CPU. Image ghcr.io/valhalla/valhalla-scripted:3.8.3 (digest 24ef7955…), server_threads=4.
PBF: vietnam-latest.osm.pbf md5 … (Geofabrik ngày …), … MB.

| Số đo | Lần 1 (lần đầu, có admins/timezones) | Lần 2 (prepare --force) |
|---|---|---|
| Thời gian từ cờ tới "Starting valhalla service!" | … phút | … phút |
| RAM đỉnh container valhalla | … GB | … GB |
| RAM postgres cùng lúc | … GB | … GB |
| valhalla_tiles.tar | … MB | … MB |

Rollback: cờ 'rollback' → /status 200 sau … giây, tileset_last_modified quay về ….
Quyết định RAM (spec mục 9): đỉnh … GB → [không đặt mem_limit | đặt mem_limit …g và hạ PG_SHARED_BUFFERS xuống 3GB].
Log docker stats: build-stats.txt (cùng thư mục).
```
Chép `/tmp/valhalla-build-stats.txt` về `docs/evidence/routing/build-stats.txt`. Nếu RAM đỉnh > 6 GB: thêm `mem_limit: 6g` cho service `valhalla`, đổi `PG_SHARED_BUFFERS=3GB` trong `infra/server/.env`, `$C up -d postgres valhalla`, ghi DEVLOG.

- [ ] **Step 7: Commit evidence**

```bash
git add docs/evidence/routing
git commit -m "docs(evidence): số đo build graph Valhalla Việt Nam trên máy chủ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Thực tế 11/09/2026 — Task 17 đóng

Step 0 phát hiện VM Docker chỉ 8,2 GB; build 13:51Z chết bằng `Killed` ở pha `enhance`, wrapper đóng
gói thư mục tile dở thành tar và phục vụ tiếp — `/status` 200, `status` báo `buildFailed: false`,
nhưng mọi `/route` trả 171. Nâng VM lên 15,6 GB thì build xanh (cờ 14:38:22Z → phục vụ 14:40:21Z,
RAM đỉnh 3,67 GB, tar 1,08 GB). Migration 0012 đã áp. Step 4 làm xong trên Cloudflare nhưng
`/healthz/routing` vẫn 503 cho tới khi **gắn** policy vào Access application (dashboard bản mới tách
policy thành đối tượng dùng chung). Step 5 diễn tập rollback đạt: 42 giây ở tầng Valhalla, 41 giây
nhìn từ `/healthz/routing`. Evidence `docs/evidence/routing/2026-09-11-build-graph-may-chu.md`,
commit `ebe21db` và `9e4b565`.

---

## Task 18: Kiểm production — healthz, smoke bốn tuyến, chốt p95, evidence

Điều kiện: Task 16 và 17 xong.

- [ ] **Step 1: Health và schema**

```bash
curl -s https://api.ai-solutions.io.vn/healthz/routing
curl -s https://api.ai-solutions.io.vn/healthz/db | grep -o '"schema_migration":"[^"]*"'
```
Expected: `{"ok":true,"version":"3.8.3","graph_built_at":"…","ms":…}`; `schema_migration":"0012_api_key_quota_directions.sql"`.

- [ ] **Step 2: Smoke 20 lượt/tuyến**

Run: `pnpm smoke:directions -- --confirm-production --requests=20`
Expected: in `80 lượt, cách 3500 ms — ước 5 phút`, rồi bảng 4 tuyến `failed 0`, `lien-tinh-xe-may` `highway false`, `vietnamese true`, p95 từng tuyến. Không thấy 429 (nếu có → kiểm ba binding ratelimit trên production bằng `wrangler deploy --dry-run --env production`).

Nếu `lien-tinh-xe-may` có `highway: true`: thêm vào `valhallaBody` khi `p.mode === 'motorbike'` trường `costing_options: { motor_scooter: { use_highways: 0 } }` (Valhalla: mọi tuỳ chọn auto áp cho motor_scooter, `use_highways` 0–1), kèm test trong `routing-valhalla.test.ts`; commit `fix(api): xe máy không dùng cao tốc`; đợi Deploy API; chạy lại smoke. Ghi DEVLOG.

- [ ] **Step 3: Chốt ngưỡng p95**

Lấy p95 lớn nhất trong bảng, nhân 1,5, làm tròn lên trăm → ghi vào comment đầu `scripts/smoke-directions.mjs` (`// Ngưỡng p95 production đo YYYY-MM-DD: --p95-max=<N>`) và chạy lại `pnpm smoke:directions -- --confirm-production --p95-max=<N>` → xanh. Commit `docs(scripts): ngưỡng p95 smoke directions theo số đo production`.

- [ ] **Step 4: Evidence production**

`docs/evidence/routing/2026-09-XX-nghiem-thu-production.md`: bảng smoke (dán `console.table`), output `/healthz/routing`, `schema_migration`, ID các run CI (Task 16), kích cỡ core gzip (Task 3), kết quả `pnpm test:routing` (số test, thời gian build graph fixture). Commit `docs(evidence): nghiệm thu production chỉ đường spec A`.

---

### Thực tế 11/09/2026 — Task 18 đóng

Lệnh trong Step 2 **sai**: `pnpm smoke:directions -- --confirm-production` bị pnpm truyền nguyên chuỗi
`--` vào script ("Cờ không hợp lệ hoặc thiếu giá trị: --"); gọi thẳng
`node scripts/smoke-directions.mjs --confirm-production --requests=20`. Lần chạy đầu tuyến
`noi-thanh-hcm` hỏng 20/20 vì toạ độ đích snap vào "VĐ. bảo vệ sân bay" trong khu bay — đổi đích sang
`10.8153,106.6633`. Sau đó bốn tuyến `failed 0`, p95 400/375/483/347 ms → chốt `--p95-max=800`; chạy
lại xanh với p95 280/326/311/272 ms. Ngưỡng chỉ đúng khi kèm `--requests=20`. Evidence
`docs/evidence/routing/2026-09-11-nghiem-thu-production.md`, commit `c223497` và `12902c8`.

---

## Task 19: Nghiệm thu spec A, DEVLOG, trạng thái mốc

- [ ] **Step 1: Đối chiếu bảng nghiệm thu spec mục 11** — từng dòng 1–7 có bằng chứng (file evidence, số test, commit). Dòng nào chưa đạt: ghi "CHƯA ĐẠT + lý do", không tick.

- [ ] **Step 2: DEVLOG**

`docs/DEVLOG.md`:
- Mục 1 thêm bullet đầu: `**YYYY-MM-DD — Chỉ đường spec A phát hành.** Valhalla 3.8.3 trên máy chủ (graph VN build … phút, RAM đỉnh … GB, tar … MB), Worker `GET /v1/directions` + `/healthz/routing`, core `client.directions()`/polyline6/ManeuverKind (barrel … kB gzip, trần … kB), quota nhóm `directions`, migration 0012, test tích hợp `pnpm test:routing` (… test, graph fixture build … s) và workflow Routing tests, smoke production 4 tuyến p95 … ms. Evidence: `docs/evidence/routing/`. **Bắt đầu tiếp:** spec B (logic dẫn đường trong core + SDK web).`
- Mục 2 thêm: `- **Dẫn đường:** spec A đóng …; bước kế tiếp là brainstorm spec B (`RouteProvider`, máy trạng thái dẫn đường, GPS web). Spec C (React Native) sau B.`
- Mục 3 thêm các dòng quyết định phát sinh (ngày, quyết định, lý do, commit): (a) `use_tiles_ignore_pbf=True` + dời tar/xoá tile dir thay cho hash vì image băm tên file; (b) `loadAuth` đọc cột mới qua `to_jsonb` để deploy độc lập migration; (c) `/status` không verbose; (d) workflow Routing tests riêng vì job DB tests không có Docker; (e) fixture Q1 dùng lại; (f) size-limit core nâng lên 12 kB (nếu có); (g) `costing_options.motor_scooter.use_highways` (nếu phải thêm ở Task 18); (h) header Access chỉ gửi qua https, `redirect: 'manual'`, mọi status ngoài 400 của Valhalla → 503; (i) image ghim digest; (j) `mem_limit`/`PG_SHARED_BUFFERS` theo số đo Task 17.
- Mục 4 thêm một dòng mỗi task: `YYYY-MM-DD · Dẫn đường A T<n> · <việc> · <commit>`.

- [ ] **Step 3: Spec A** — sửa dòng "Trạng thái" đầu file thành `Đã phát hành YYYY-MM-DD; nghiệm thu mục 11 …/7 (xem docs/evidence/routing/)`.

- [ ] **Step 4: Commit và push (PHONG duyệt)**

```bash
git add docs/DEVLOG.md docs/superpowers/specs/2026-09-10-dan-duong-engine-api-design.md docs/superpowers/plans/2026-09-10-dan-duong-engine-api.md
git commit -m "docs: đóng spec dẫn đường A — DEVLOG, nghiệm thu, trạng thái

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

## Đối chiếu spec → task

| Spec mục | Task |
|---|---|
| 4.1 compose service, 4.3 run.sh, 4.4 prepare/rollback/status | 12 |
| 4.2 server:setup build lần đầu; data:update/rollback | 13 |
| 4.5 việc tay Cloudflare | 15 (README), 17 (thực hiện) |
| 5.1 tham số, giới hạn, body Valhalla | 5, 6 |
| 5.2 schema, ánh xạ kind, nối shape, waypoints, engine.graph | 2, 7, 8 |
| 5.3 lỗi | 6, 8 |
| 5.4 cache | 5 (khoá), 8 |
| 5.5 quota, migration 0012, `--quota-directions`, loadAuth to_jsonb | 4, 9 |
| 5.6 /healthz/routing | 8 |
| 5.7 biến môi trường/secret | 4, 15, 17 |
| 6 core: types, client, polyline, maneuver | 1, 2, 3 |
| 7.1 unit Worker | 5, 6, 7, 8 |
| 7.2 core test | 1, 2, 3 |
| 7.3 fixture Q1, test:routing, workflow riêng, capture | 10, 11 |
| 7.4 smoke production, p95 | 14, 18 |
| 7.5 checklist kịch bản bọc | 17 |
| 8 docs, notices, README máy chủ, evidence | 15, 17, 18 |
| 9 rủi ro RAM/size-limit/highway/Docker Desktop | 3, 17, 18 |
| 11 nghiệm thu, 12 việc tay PHONG | 16, 17, 18, 19 |

## Bảo mật — điểm đã rà (10/09/2026)

- Worker chỉ gọi hai đường dẫn cố định `/route`, `/status` trên `ROUTING_BASE`; đầu vào người dùng chỉ vào body JSON dưới dạng số đã validate và giá trị trong allow-list → không có SSRF/injection.
- Service token Access nằm trong `wrangler secret`, chỉ gửi khi đích là https, không bao giờ ghi log; `redirect: 'manual'` để Access 302 không kéo Worker tới URL lạ.
- Valhalla không mở `ports:`; đường vào duy nhất là Tunnel + Access application (tạo Access **trước** hostname). Dev compose chỉ bind `127.0.0.1`.
- Image ghim digest; graph build từ PBF Geofabrik đã kiểm md5 (pipeline có sẵn); `default_speeds.json` tải từ GitHub OpenStreetMapSpeeds lần đầu (đầu vào ngoài duy nhất của build — chấp nhận, ghi ở đây).
- `/v1/directions` bắt buộc khoá; quota ngày riêng cho plan free (KV); burst riêng 20/phút/khoá+IP; trần 100/phút theo khoá cho mọi khoá `web`/`mobile` kể cả tenant internal (khoá công khai, vd khoá demo docs) — dùng Rate Limiting binding, không KV, vì Workers Free chỉ cho 1.000 ghi KV/ngày và ngân sách đó dùng chung với auth cache và manifest. `/healthz/routing` không cần khoá và gọi `/status` (rẻ) — cùng mô hình `/healthz/db`.
- Toạ độ `from/to` của người dùng cuối nằm trong URL nên xuất hiện trong log Workers (như `/v1/nearby`, `/v1/reverse` hiện tại); Analytics Engine chỉ ghi pathname. Không ghi thêm gì mới. PHONG chọn phương án 1 (10/09): ghi rõ trong điều khoản tenant mục 5 và trang API (Task 15 Step 5); phương án hạ sampling log ghi vào checklist pháp lý C6 để sau.
- PHONG quyết 10/09/2026: (1) khoá `web`/`mobile` mọi plan chịu trần theo khoá 100/phút ở directions (thay cho quota ngày KV — không khả thi trên Workers Free với khoá công khai); (2) limiter burst riêng 20/phút cho directions. Điểm (3) riêng tư toạ độ trong log Workers: PHONG chọn phương án 1 — chỉ ghi điều khoản tenant + trang API, không đổi mã (Task 15 Step 5).
