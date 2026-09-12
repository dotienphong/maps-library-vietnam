# Dẫn đường spec C — SDK React Native: phiên độc lập, định vị nền, TTS native — Plan thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App React Native có tuyến từ `directions()` là dẫn đường được với giọng Việt, tiếp tục khi khoá máy hoặc chuyển app, và phiên dẫn đường sống độc lập với màn hình bản đồ nào đang hiện.

**Architecture:** `createNavigationSession()` (gói RN) cầm `createNavigator` của core + `PositionSource` + `Speaker` + keep-awake + phiên âm thanh, API giữ chữ ký `map.navigation` web; `<MapsLibVNMap navigation={session}>` chỉ *gắn* để vẽ tuyến, puck, camera bám. Entry riêng `@mapslibvn/react-native/expo` cung cấp mặc định Expo (expo-location + expo-task-manager cho nền, expo-speech, expo-audio, expo-keep-awake); gói chính không import Expo. Core chỉ thêm hàm thuần `routeFeatures()`/`decodeRoutes()` (chuyển từ web) và hằng `FIRST_SYMBOL_LAYER_ID`. Spec: `docs/superpowers/specs/2026-09-12-dan-duong-react-native-design.md`.

**Tech Stack:** TypeScript 5 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), pnpm 9, Vitest (jsdom cho test React), Biome (2 space, single quote, lineWidth 100), tsup, React 19 + React Native 0.86 + `@maplibre/maplibre-react-native` 11.3.8, Expo SDK 57 (app thử), Astro Starlight + Playwright.

---

## 0. Quy ước cho mọi task

- Mọi lệnh chạy từ **gốc repo** trừ khi ghi khác.
- Test RN/core/web/style chạy ở gốc: `pnpm exec vitest run <đường dẫn>`. Test đụng core **qua gói** (`@mapslibvn/core`, tức style test và RN test) cần core đã build: `pnpm --filter @mapslibvn/core build` trước (`pnpm test` ở gốc đã làm sẵn).
- Test React ghi dòng đầu `// @vitest-environment jsdom` và mock `react-native` + `@maplibre/maplibre-react-native` bằng hai file trong `packages/react-native/src/test/` (như `map.test.tsx`).
- Không dùng `!` (non-null assertion) — Biome cấm; dùng `??`, `if (!x) return`, hoặc helper. Không dùng `forEach` (Biome `noForEach`) — dùng `for…of`.
- `exactOptionalPropertyTypes` bật: không gán `undefined` cho thuộc tính tuỳ chọn; dùng spread có điều kiện `...(x !== undefined ? { x } : {})`.
- **Không đưa Expo vào pnpm workspace** (quyết định M6 giữ nguyên). Kiểu của năm gói expo khai báo ambient trong `packages/react-native/src/expo/expo-modules.d.ts` (Task 10); app thử là dự án npm riêng.
- Commit sau mỗi task, thông điệp Conventional Commits tiếng Việt, kết thúc bằng dòng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Không push (PHONG quyết).
- Bước cuối mỗi task: tick checkbox trong plan này. DEVLOG cập nhật ở Task 19 (một lần); task nào làm lệch spec thì ghi ngay vào mục "Lệch spec" của Task 18.
- GitHub Actions đang khoá vì thanh toán: mọi cổng CI chạy tay ở Task 19.
- Fixture tuyến dùng chung: `packages/core/tests/fixtures/directions-q1.json` (1 tuyến `motorbike`, 42 điểm, 6 step, 2 waypoint). Từ `packages/react-native/src/navigation/` import bằng `../../../core/tests/fixtures/directions-q1.json`.

## 1. Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `packages/core/src/navigation/route-features.ts` (+ test) | `decodeRoutes`, `routeFeatures`, `EMPTY_ROUTE_FEATURES`, kiểu `RouteFeature*`, `RouteProgressCut` |
| `packages/core/src/style-transform.ts` | thêm `FIRST_SYMBOL_LAYER_ID` |
| `packages/style/src/first-symbol-layer.test.ts` | bảo vệ hằng bằng style dựng thật |
| `packages/web/src/routes-layer.ts` | gọi core thay `collection()` cục bộ; test giữ nguyên |
| `packages/react-native/src/navigation/playback-source.ts` (+ test) | copy `playbackSource` web |
| `packages/react-native/src/navigation/session.ts` (+ test) | `createNavigationSession`, kiểu `Speaker`, `KeepAwake`, `AudioSession`, `SessionPositionSource`, `SessionEvents` |
| `packages/react-native/src/navigation/puck-image.ts`, `scripts/gen-puck.mjs` | PNG mũi tên nhúng base64 + script sinh lại |
| `packages/react-native/src/navigation/routes-store.ts` (+ test) | store `response/active/progress → features` cho `useSyncExternalStore` |
| `packages/react-native/src/navigation/route-layers.tsx` | `GeoJSONSource` + `Images` + 5 `Layer` + marker đích/via |
| `packages/react-native/src/navigation/map-binding.ts` | gắn/gỡ phiên vào map, camera bám, AppState, `recenter`, `followChange` |
| `packages/react-native/src/map.tsx`, `context.ts`, `marker.tsx` | props mới, `routes`, `navigation`, `onRegionWillChange`, render `RouteLayers`; Marker đọc `MapContext` trực tiếp |
| `packages/react-native/src/use-navigation.ts` (+ test) | hook |
| `packages/react-native/src/expo/expo-modules.d.ts`, `modules.ts` | kiểu ambient + một chỗ import năm gói expo (test mock file này) |
| `packages/react-native/src/expo/location-source.ts` (+ test) | `defineNavigationTask`, `expoLocationSource`, `toGeoFix`, `NAVIGATION_TASK` |
| `packages/react-native/src/expo/speech.ts`, `device.ts` (+ test) | `expoSpeech`, `expoAudioSession`, `expoKeepAwake` |
| `packages/react-native/src/expo/index.ts` | entry `/expo`, `expoNavigation` |
| `packages/react-native/src/test/mlrn-mock.tsx`, `react-native-mock.tsx` | thêm `GeoJSONSource`, `Layer`, `Images`, `AppState` |
| `packages/react-native/package.json`, `tsup.config.ts`, `src/index.ts`, `README.md` | entry thứ hai, exports, peer tuỳ chọn, 0.5.0 |
| `scripts/lib/example-rn.mjs` (+ test), `scripts/example-rn.mjs` | cờ `--device` |
| `examples/embed-rn/{package.json,app.json,index.ts,App.tsx,navigation-ui.tsx,README.md}` | app thử đủ luồng |
| `apps/docs/src/content/docs/dan-duong-react-native.md`, `astro.config.mjs`, `e2e/docs.spec.ts`, `react-native.md`, `dan-duong.md`, `tinh-nang.md` | docs |
| `THIRD_PARTY_NOTICES.md` (+ 4 bản sao) | năm gói expo |
| `docs/evidence/navigation/2026-09-1x-rn-phat-hanh.md`, `…-rn-thuc-dia.md` | evidence |

---

### Task 1: Core `routeFeatures` / `decodeRoutes` (thuần, chuyển từ web)

**Files:**
- Create: `packages/core/src/navigation/route-features.ts`
- Create: `packages/core/src/navigation/route-features.test.ts`
- Modify: `packages/core/src/navigation/index.ts`

- [x] **Step 1: Viết test đỏ**

`packages/core/src/navigation/route-features.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import { decodePolyline6 } from '../polyline';
import type { DirectionsResponse } from '../types';
import {
  EMPTY_ROUTE_FEATURES,
  type RouteFeature,
  decodeRoutes,
  routeFeatures,
} from './route-features';

const response = fixture as unknown as DirectionsResponse;
const coords = decodeRoutes(response);
const first = coords[0] ?? [];
const two = [first, first];

const kinds = (features: readonly RouteFeature[]) => features.map((f) => f.properties.kind);
const lineCoords = (f: RouteFeature | undefined): [number, number][] => {
  if (!f || f.geometry.type !== 'LineString') throw new Error('không phải LineString');
  return f.geometry.coordinates;
};

describe('decodeRoutes', () => {
  it('giải mã polyline6 từng tuyến, cùng kết quả decodePolyline6', () => {
    expect(coords).toHaveLength(1);
    expect(first).toEqual(decodePolyline6(response.routes[0]?.geometry ?? ''));
    expect(first.length).toBe(42);
  });
});

describe('routeFeatures', () => {
  it('không progress: tuyến active nguyên vẹn, tuyến khác là alt kèm index', () => {
    const fc = routeFeatures(two, { active: 1 });
    expect(
      fc.features.map((f) => [f.properties.kind, 'index' in f.properties ? f.properties.index : -1]),
    ).toEqual([
      ['alt', 0],
      ['active', 1],
    ]);
    expect(lineCoords(fc.features[1])).toHaveLength(42);
  });

  it('progress cắt tại shapeIndex: traveled kết thúc và active bắt đầu ở điểm bám', () => {
    const fc = routeFeatures(coords, {
      active: 0,
      progress: { shapeIndex: 5, snapped: [106.6985, 10.7791] },
    });
    expect(kinds(fc.features)).toEqual(['traveled', 'active']);
    const traveled = lineCoords(fc.features[0]);
    const active = lineCoords(fc.features[1]);
    expect(traveled).toHaveLength(7); // 6 đỉnh + điểm bám
    expect(traveled.at(-1)).toEqual([106.6985, 10.7791]);
    expect(active[0]).toEqual([106.6985, 10.7791]);
    expect(active).toHaveLength(42 - 6 + 1);
  });

  it('progress ở đoạn cuối → cả tuyến là active', () => {
    const fc = routeFeatures(coords, { active: 0, progress: { shapeIndex: 41, snapped: [0, 0] } });
    expect(kinds(fc.features)).toEqual(['active']);
  });

  it('puck: Point tại điểm bám mang bearing; không progress thì không puck', () => {
    const fc = routeFeatures(coords, {
      active: 0,
      puck: true,
      progress: { shapeIndex: 5, snapped: [106.6985, 10.7791], bearing: 123 },
    });
    const puck = fc.features.at(-1);
    expect(puck?.geometry).toEqual({ type: 'Point', coordinates: [106.6985, 10.7791] });
    expect(puck?.properties).toEqual({ kind: 'puck', bearing: 123 });
    expect(kinds(routeFeatures(coords, { active: 0, puck: true }).features)).toEqual(['active']);
  });

  it('không đột biến đầu vào; EMPTY_ROUTE_FEATURES rỗng', () => {
    const before = JSON.stringify(coords);
    routeFeatures(coords, { active: 0, progress: { shapeIndex: 3, snapped: [1, 2] } });
    expect(JSON.stringify(coords)).toBe(before);
    expect(EMPTY_ROUTE_FEATURES.features).toEqual([]);
  });
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `pnpm exec vitest run packages/core/src/navigation/route-features.test.ts`
Expected: FAIL — `Failed to resolve import "./route-features"`.

- [x] **Step 3: Viết `route-features.ts`**

```ts
import { decodePolyline6 } from '../polyline';
import type { DirectionsResponse } from '../types';

/** Vai của từng feature trong source tuyến — web và RN cùng lọc theo `properties.kind`. */
export type RouteFeatureKind = 'alt' | 'active' | 'traveled' | 'puck';

export interface RouteLineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { kind: 'alt' | 'active' | 'traveled'; index: number };
}

export interface RoutePuckFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { kind: 'puck'; bearing: number };
}

export type RouteFeature = RouteLineFeature | RoutePuckFeature;

export interface RouteFeatureCollection {
  type: 'FeatureCollection';
  features: RouteFeature[];
}

/** Điểm cắt tuyến chính: trước là đã đi, sau là còn lại. */
export interface RouteProgressCut {
  shapeIndex: number;
  snapped: [number, number];
  /** Hướng đi (độ) cho puck; thiếu → 0. */
  bearing?: number;
}

export interface RouteFeaturesOptions {
  active: number;
  progress?: RouteProgressCut | null;
  /** Thêm feature Point `puck` tại `snapped` khi có `progress`. Mặc định false. */
  puck?: boolean;
}

export const EMPTY_ROUTE_FEATURES: RouteFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Giải mã polyline6 của mọi tuyến trong response — làm một lần rồi cache ở lớp dán. */
export function decodeRoutes(response: DirectionsResponse): [number, number][][] {
  return response.routes.map((route) => decodePolyline6(route.geometry));
}

const line = (
  kind: RouteLineFeature['properties']['kind'],
  index: number,
  coordinates: [number, number][],
): RouteLineFeature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties: { kind, index },
});

/**
 * Dựng FeatureCollection cho source tuyến: tuyến khác `active` là `alt`; tuyến `active` bị cắt tại
 * `progress` thành `traveled` + `active` (cả hai đi qua điểm bám); không có `progress` thì nguyên
 * tuyến là `active`. `puck` thêm một Point tại điểm bám mang `bearing`. Không đột biến `coords`.
 */
export function routeFeatures(
  coords: readonly (readonly [number, number][])[],
  opts: RouteFeaturesOptions,
): RouteFeatureCollection {
  const progress = opts.progress ?? null;
  const features: RouteFeature[] = [];
  for (const [i, c] of coords.entries()) {
    if (i !== opts.active) {
      features.push(line('alt', i, [...c]));
      continue;
    }
    if (progress && progress.shapeIndex < c.length - 1) {
      features.push(
        line('traveled', i, [...c.slice(0, progress.shapeIndex + 1), progress.snapped]),
        line('active', i, [progress.snapped, ...c.slice(progress.shapeIndex + 1)]),
      );
    } else {
      features.push(line('active', i, [...c]));
    }
  }
  if (opts.puck && progress) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: progress.snapped },
      properties: { kind: 'puck', bearing: progress.bearing ?? 0 },
    });
  }
  return { type: 'FeatureCollection', features };
}
```

Thêm vào cuối `packages/core/src/navigation/index.ts`:

```ts
export * from './route-features';
```

- [x] **Step 4: Chạy để thấy xanh + typecheck core**

Run: `pnpm exec vitest run packages/core/src/navigation/route-features.test.ts && pnpm --filter @mapslibvn/core typecheck`
Expected: 6 test PASS; typecheck không lỗi.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/navigation/route-features.ts packages/core/src/navigation/route-features.test.ts packages/core/src/navigation/index.ts
git commit -m "feat(core): routeFeatures/decodeRoutes — dựng GeoJSON tuyến thuần cho web và RN dùng chung

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `FIRST_SYMBOL_LAYER_ID` trong core, test bảo vệ bằng style dựng thật

**Files:**
- Modify: `packages/core/src/style-transform.ts`
- Create: `packages/style/src/first-symbol-layer.test.ts`

- [x] **Step 1: Viết test đỏ**

`packages/style/src/first-symbol-layer.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_SYMBOL_LAYER_ID, attributionHtml } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import { addPoiLayers } from './poi-layers.mjs';
import { transformStyle } from './transform.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(resolve(here, path), 'utf8'));
const sovereignty = readJson('sovereignty.geojson');

// Spec C mục 4: RN chèn tuyến trước lớp này (không có getStyle() ở native). Style đổi thứ tự lớp
// thì test này đỏ, thay vì tuyến lặng lẽ đè lên nhãn đường trên máy người dùng.
describe('FIRST_SYMBOL_LAYER_ID của core khớp style dựng thật', () => {
  const themes = [
    ['base/osm-liberty.json', 'light'],
    ['base/dark-matter.json', 'dark'],
  ] as const;
  for (const [base, theme] of themes) {
    it(`${theme}: lớp symbol đầu tiên là ${FIRST_SYMBOL_LAYER_ID[theme]}`, () => {
      const attribution = attributionHtml();
      const out = addPoiLayers(
        transformStyle(readJson(base), { theme, sovereignty, attribution }),
        { theme, attribution },
      );
      const firstSymbol = out.layers.find((layer) => layer.type === 'symbol');
      expect(firstSymbol?.id).toBe(FIRST_SYMBOL_LAYER_ID[theme]);
    });
  }
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `pnpm --filter @mapslibvn/core build && pnpm exec vitest run packages/style/src/first-symbol-layer.test.ts`
Expected: FAIL — `FIRST_SYMBOL_LAYER_ID` không phải export của `@mapslibvn/core` (undefined → `Cannot read properties of undefined`).

- [x] **Step 3: Thêm hằng vào core**

Trong `packages/core/src/style-transform.ts`, thêm sau dòng `export const POI_LAYER_ID = 'poi';`:

```ts
/**
 * Lớp symbol đầu tiên của từng theme MapsLibVN — chèn tuyến dẫn đường trước lớp này để nhãn đường
 * nằm trên tuyến (spec C mục 4). `packages/style/src/first-symbol-layer.test.ts` bảo vệ giá trị.
 */
export const FIRST_SYMBOL_LAYER_ID: Readonly<Record<Theme, string>> = {
  light: 'road_one_way_arrow',
  dark: 'water_name',
};
```

và thêm import ở đầu file (chỉ kiểu, không tạo vòng import lúc chạy):

```ts
import type { Theme } from './client';
```

- [x] **Step 4: Build core, chạy test xanh**

Run: `pnpm --filter @mapslibvn/core build && pnpm exec vitest run packages/style/src/first-symbol-layer.test.ts packages/core/src/style-transform.test.ts`
Expected: PASS (2 test mới + test cũ).

- [x] **Step 5: Commit**

```bash
git add packages/core/src/style-transform.ts packages/style/src/first-symbol-layer.test.ts
git commit -m "feat(core): FIRST_SYMBOL_LAYER_ID theo theme, test style bảo vệ giá trị

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Web `routes-layer.ts` gọi core (test web giữ nguyên)

**Files:**
- Modify: `packages/web/src/routes-layer.ts`
- Test có sẵn: `packages/web/src/routes-layer.test.ts` (không sửa)

- [x] **Step 1: Chạy test web hiện tại để có mốc xanh**

Run: `pnpm exec vitest run packages/web/src/routes-layer.test.ts`
Expected: PASS (5 test).

- [x] **Step 2: Thay phần dựng GeoJSON cục bộ bằng core**

Sửa `packages/web/src/routes-layer.ts`:

1. Dòng import đầu file đổi thành:

```ts
import {
  type DirectionsResponse,
  EMPTY_ROUTE_FEATURES,
  type RouteProgressCut,
  decodeRoutes,
  routeFeatures,
} from '@mapslibvn/core';
```

2. Xoá các khai báo `interface LineFeature`, `interface Collection`, hằng `EMPTY`, hàm `feature`
   (giữ `type Kind = 'alt' | 'active' | 'traveled';` và `type GeoJsonData`).

3. Trong `createRoutesLayer`: đổi `let progress: { shapeIndex: number; snapped: [number, number] } | null = null;`
   thành `let progress: RouteProgressCut | null = null;`.

4. Trong `ensureLayers`, dòng `gl.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY as GeoJsonData });`
   đổi `EMPTY` thành `EMPTY_ROUTE_FEATURES`.

5. Xoá hàm `collection` và viết lại `setData`:

```ts
  const setData = (): void => {
    const source = gl.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const data = response ? routeFeatures(coords, { active, progress }) : EMPTY_ROUTE_FEATURES;
    source?.setData(data as GeoJsonData);
  };
```

6. Trong `show`: `coords = next.routes.map((r) => decodePolyline6(r.geometry));` → `coords = decodeRoutes(next);`.

7. Trong `clear`: `source?.setData(EMPTY as GeoJsonData);` → `source?.setData(EMPTY_ROUTE_FEATURES as GeoJsonData);`.

- [x] **Step 3: Test web xanh không sửa test, typecheck web**

Run: `pnpm --filter @mapslibvn/core build && pnpm exec vitest run packages/web/src/routes-layer.test.ts packages/web/src/navigation.test.ts && pnpm --filter @mapslibvn/web typecheck && pnpm lint`
Expected: PASS toàn bộ; lint xanh (Biome sẽ báo import chưa dùng nếu quên xoá `decodePolyline6`).

- [x] **Step 4: Commit**

```bash
git add packages/web/src/routes-layer.ts
git commit -m "refactor(web): routes-layer dùng routeFeatures/decodeRoutes của core

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: RN `playbackSource` (copy từ web)

**Files:**
- Create: `packages/react-native/src/navigation/playback-source.ts`
- Create: `packages/react-native/src/navigation/playback-source.test.ts`

- [x] **Step 1: Viết test đỏ**

`packages/react-native/src/navigation/playback-source.test.ts`:

```ts
import type { GeoFix } from '@mapslibvn/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playbackSource } from './playback-source';

describe('playbackSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const fixes: GeoFix[] = [0, 1000, 3000].map((dt) => ({
    lng: 106.7,
    lat: 10.77,
    timestamp: 1_700_000_000_000 + dt,
  }));

  it('phát theo chênh timestamp chia rate; unsubscribe dừng', () => {
    const onFix = vi.fn();
    const stop = playbackSource(fixes, { rate: 2 }).subscribe(onFix);
    vi.advanceTimersByTime(0);
    expect(onFix).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(499);
    expect(onFix).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onFix).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(5000);
    expect(onFix).toHaveBeenCalledTimes(2);
  });

  it('rate 0 → phát tất cả trong một tick', () => {
    const onFix = vi.fn();
    playbackSource(fixes, { rate: 0 }).subscribe(onFix);
    expect(onFix).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(onFix).toHaveBeenCalledTimes(3);
  });
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `pnpm exec vitest run packages/react-native/src/navigation/playback-source.test.ts`
Expected: FAIL — không resolve được `./playback-source`.

- [x] **Step 3: Viết `playback-source.ts`** (bản sao của `packages/web/src/position-source.ts` phần `playbackSource`; chấp nhận trùng như `usePlaces`, vì core không chứa timer)

```ts
import type { GeoFix, PositionSource } from '@mapslibvn/core';

/**
 * Phát lại chuỗi fix (ví dụ từ `simulateFixes`) theo chênh timestamp chia `rate`; `rate: 0` phát
 * hết trong một tick. Copy từ `@mapslibvn/web` — core không có timer nên không đặt ở đó.
 */
export function playbackSource(
  fixes: readonly GeoFix[],
  options: { rate?: number } = {},
): PositionSource {
  const rate = options.rate ?? 1;
  return {
    subscribe(onFix) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let i = 0;
      const emitNext = (): void => {
        if (stopped) return;
        const fix = fixes[i];
        if (!fix) return;
        onFix(fix);
        i += 1;
        const next = fixes[i];
        if (!next) return;
        timer = setTimeout(emitNext, Math.max(0, (next.timestamp - fix.timestamp) / rate));
      };
      timer = setTimeout(
        rate <= 0
          ? () => {
              for (const f of fixes) {
                if (stopped) break;
                onFix(f);
              }
            }
          : emitNext,
        0,
      );
      return () => {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
      };
    },
  };
}
```

- [x] **Step 4: Chạy xanh**

Run: `pnpm exec vitest run packages/react-native/src/navigation/playback-source.test.ts`
Expected: 2 PASS.

- [x] **Step 5: Commit**

```bash
git add packages/react-native/src/navigation/playback-source.ts packages/react-native/src/navigation/playback-source.test.ts
git commit -m "feat(react-native): playbackSource cho giả lập dẫn đường

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `createNavigationSession` — phiên dẫn đường thuần (không React, không Expo)

**Files:**
- Create: `packages/react-native/src/navigation/session.ts`
- Create: `packages/react-native/src/navigation/session.test.ts`

- [x] **Step 1: Viết test đỏ**

`packages/react-native/src/navigation/session.test.ts`:

```ts
import {
  type DirectionsResponse,
  type GeoFix,
  type PositionError,
  type Route,
  simulateFixes,
} from '@mapslibvn/core';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import {
  MISSING_SOURCE_MESSAGE,
  type SessionEvents,
  type SessionPositionSource,
  createNavigationSession,
} from './session';

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;
const provider = { directions: vi.fn(async () => response) };

function fakeSource(calls: string[]) {
  let onFix: ((fix: GeoFix) => void) | null = null;
  let onError: ((e: PositionError) => void) | undefined;
  let bgCb: ((e: SessionEvents['backgroundUnavailable']) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    onFix = null;
  });
  const source: SessionPositionSource = {
    setMode: (mode) => {
      calls.push(`setMode:${mode}`);
    },
    onBackgroundUnavailable: (cb) => {
      bgCb = cb;
    },
    subscribe: (fix, err) => {
      calls.push('subscribe');
      onFix = fix;
      onError = err;
      return unsubscribe;
    },
  };
  return {
    source,
    unsubscribe,
    push(fixes: readonly GeoFix[]) {
      for (const f of fixes) onFix?.(f);
    },
    fail(e: PositionError) {
      onError?.(e);
    },
    background(e: SessionEvents['backgroundUnavailable']) {
      bgCb?.(e);
    },
  };
}

function fakeDevice(calls: string[]) {
  return {
    speech: {
      speak: vi.fn((_text: string, priority: number, lang: string) => {
        calls.push(`speak:${priority}:${lang}`);
      }),
      cancel: vi.fn(() => {
        calls.push('cancel');
      }),
      available: vi.fn(async () => {
        calls.push('available');
        return true;
      }),
      setOptions: vi.fn(),
    },
    keepAwake: {
      activate: vi.fn(async () => {
        calls.push('keep:on');
      }),
      deactivate: vi.fn(async () => {
        calls.push('keep:off');
      }),
    },
    audio: {
      activate: vi.fn(async () => {
        calls.push('audio:on');
      }),
      deactivate: vi.fn(async () => {
        calls.push('audio:off');
      }),
    },
  };
}

describe('createNavigationSession', () => {
  it('start: audio → available → keep-awake → setMode → subscribe; hết fix → arrived, end{arrived}, nhả nguồn và thiết bị', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const d = fakeDevice(calls);
    const session = createNavigationSession({ provider, source: s.source, ...d });
    const events: string[] = [];
    session.on('status', (e) => events.push(e.status));
    session.on('end', (e) => events.push(`end:${e.reason}`));
    session.on('route', (e) => events.push(`route:${e.routeIndex}`));

    await session.start({ response });
    expect(calls).toEqual(['audio:on', 'available', 'keep:on', 'setMode:motorbike', 'subscribe']);
    expect(session.status).toBe('navigating');
    expect(session.response).toBe(response);
    expect(session.state).toBeNull();

    s.push(simulateFixes(route));
    expect(session.status).toBe('arrived');
    expect(session.state?.status).toBe('arrived');
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(d.audio.deactivate).toHaveBeenCalledTimes(1));
    expect(d.keepAwake.deactivate).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['route:0', 'navigating', 'arrived', 'end:arrived']);
    const spoken = d.speech.speak.mock.calls;
    expect(spoken).toHaveLength(12);
    expect(spoken.every((c) => c[2] === 'vi')).toBe(true);
    expect(spoken.at(-1)?.[0]).toBe('Điểm đến ở bên trái.');

    await session.stop(); // sau khi đến nơi: không phát end lần hai, status về idle
    expect(events.filter((e) => e.startsWith('end:'))).toEqual(['end:arrived']);
    expect(session.status).toBe('idle');
  });

  it('stop: cắt giọng, nhả thiết bị, gỡ nguồn, end{stopped} một lần; status idle, state null, response giữ', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const d = fakeDevice(calls);
    const session = createNavigationSession({ provider, source: s.source, ...d });
    const ends: string[] = [];
    const statuses: string[] = [];
    session.on('end', (e) => ends.push(e.reason));
    session.on('status', (e) => statuses.push(e.status));
    await session.start({ response });
    s.push(simulateFixes(route).slice(0, 5));
    expect(session.state?.status).toBe('navigating');
    await session.stop();
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    expect(d.speech.cancel).toHaveBeenCalledTimes(1);
    expect(d.keepAwake.deactivate).toHaveBeenCalledTimes(1);
    expect(d.audio.deactivate).toHaveBeenCalledTimes(1);
    expect(ends).toEqual(['stopped']);
    expect(statuses).toEqual(['navigating', 'idle']);
    expect(session.status).toBe('idle');
    expect(session.state).toBeNull();
    expect(session.response).toBe(response);
    await session.stop(); // lần hai: no-op
    expect(ends).toEqual(['stopped']);
  });

  it('thiếu source → reject với thông điệp chỉ cách truyền', async () => {
    const session = createNavigationSession({ provider });
    await expect(session.start({ response })).rejects.toThrow(MISSING_SOURCE_MESSAGE);
    expect(session.status).toBe('idle');
  });

  it('voice false → không audio/speech; available() false → voiceUnavailable một lần; voice {rate} → setOptions', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const d = fakeDevice(calls);
    const session = createNavigationSession({ provider, source: s.source, ...d });
    await session.start({ response, voice: false });
    expect(calls).toEqual(['keep:on', 'setMode:motorbike', 'subscribe']);
    s.push(simulateFixes(route).slice(0, 3));
    expect(d.speech.speak).not.toHaveBeenCalled();

    d.speech.available.mockResolvedValueOnce(false);
    const unavailable = vi.fn();
    session.on('voiceUnavailable', unavailable);
    await session.start({ response, voice: { rate: 1.2 } });
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(d.speech.setOptions).toHaveBeenCalledWith({ rate: 1.2 });
  });

  it('positionError và backgroundUnavailable của nguồn phát lại trên phiên', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const session = createNavigationSession({ provider, source: s.source });
    const errors: string[] = [];
    session.on('positionError', (e) => errors.push(e.code));
    session.on('backgroundUnavailable', (e) => errors.push(e.reason));
    await session.start({ response });
    s.fail({ code: 'denied', message: 'từ chối' });
    s.background({ reason: 'task_not_defined', message: 'chưa defineNavigationTask' });
    expect(errors).toEqual(['denied', 'task_not_defined']);
  });

  it('start khi đang chạy → stop trước: gỡ nguồn cũ, end:stopped rồi route mới', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const session = createNavigationSession({ provider, source: s.source });
    const events: string[] = [];
    session.on('end', (e) => events.push(`end:${e.reason}`));
    session.on('route', (e) => events.push(`route:${e.routeIndex}`));
    await session.start({ response });
    await session.start({ response, routeIndex: 0 });
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c === 'subscribe')).toHaveLength(2);
    expect(events).toEqual(['route:0', 'end:stopped', 'route:0']);
  });

  it('setRoute đổi response/routeIndex và phát route; reroute khi chưa start → reject', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const session = createNavigationSession({ provider, source: s.source });
    await expect(session.reroute()).rejects.toThrow(/chưa start/);
    const routes: number[] = [];
    session.on('route', (e) => routes.push(e.routeIndex));
    await session.start({ response });
    session.setRoute(response, 0);
    expect(routes).toEqual([0, 0]);
    expect(session.response).toBe(response);
  });

  it('không speech/keepAwake/audio: phiên tối giản vẫn chạy tới arrived', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const session = createNavigationSession({ provider, source: s.source });
    const progress = vi.fn();
    session.on('progress', progress);
    await session.start({ response, keepAwake: false });
    s.push(simulateFixes(route));
    expect(session.status).toBe('arrived');
    expect(progress).toHaveBeenCalled();
    expect(calls).toEqual(['setMode:motorbike', 'subscribe']);
  });
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `pnpm --filter @mapslibvn/core build && pnpm exec vitest run packages/react-native/src/navigation/session.test.ts`
Expected: FAIL — không resolve được `./session`.

- [x] **Step 3: Viết `session.ts`**

```ts
import {
  type DirectionsLang,
  type DirectionsResponse,
  type NavigationEvents,
  type NavigationProgress,
  type NavigationStatus,
  type NavigationThresholds,
  type Navigator,
  type NavigatorOptions,
  type PositionError,
  type PositionSource,
  type RouteProvider,
  type TravelMode,
  createNavigator,
} from '@mapslibvn/core';

/** Bộ đọc câu — mặc định Expo ở `@mapslibvn/react-native/expo`; app thay bằng TTS riêng được. */
export interface Speaker {
  /** Cắt câu đang đọc nếu `priority` ≥ ưu tiên câu đó; thấp hơn thì xếp hàng. */
  speak(text: string, priority: 1 | 2 | 3, lang: DirectionsLang): void;
  cancel(): void;
  /** Có giọng khớp `lang` không; phiên gọi một lần lúc `start()` để phát `voiceUnavailable`. */
  available(lang: DirectionsLang): Promise<boolean>;
  /** Nhận `voice: { rate, volume }` của `start()`; tuỳ chọn. */
  setOptions?(options: { rate?: number; volume?: number }): void;
}

export interface KeepAwake {
  activate(): Promise<void> | void;
  deactivate(): Promise<void> | void;
}

export interface AudioSession {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
}

export interface BackgroundUnavailable {
  reason: 'task_not_defined' | 'not_configured' | 'permission' | 'unsupported';
  message: string;
}

/** `PositionSource` của core cộng hai móc tuỳ chọn; phiên nhận diện bằng `'setMode' in source`. */
export interface SessionPositionSource extends PositionSource {
  /** Phiên gọi trước `subscribe` với `mode` của tuyến (iOS activityType, Android ưu tiên). */
  setMode?(mode: TravelMode): void;
  /** Nguồn báo đã rơi về tiền cảnh; phiên phát lại thành `backgroundUnavailable`. */
  onBackgroundUnavailable?(cb: (e: BackgroundUnavailable) => void): void;
}

export interface NavigationSessionOptions {
  provider: RouteProvider;
  /** Bắt buộc để `start()` chạy; thiếu → reject với `MISSING_SOURCE_MESSAGE`. */
  source?: SessionPositionSource;
  /** Thiếu → không đọc, không phát `voiceUnavailable`. */
  speech?: Speaker;
  keepAwake?: KeepAwake;
  audio?: AudioSession;
}

export interface NavigationSessionStartOptions {
  response: DirectionsResponse;
  /** Mặc định 0. */
  routeIndex?: number;
  /** Mặc định 'auto'. */
  reroute?: 'auto' | 'manual';
  /** Mặc định 'vi'. */
  lang?: DirectionsLang;
  /** Mặc định true khi có `speech`. */
  voice?: boolean | { rate?: number; volume?: number };
  thresholds?: Partial<NavigationThresholds>;
  /** Mặc định true khi có `keepAwake`. */
  keepAwake?: boolean;
}

export interface SessionEvents extends NavigationEvents {
  /** Tuyến hiện tại đổi: `start()`, `setRoute()`, hoặc tính lại xong. Map gắn vào vẽ theo đây. */
  route: { response: DirectionsResponse; routeIndex: number };
  positionError: PositionError;
  voiceUnavailable: undefined;
  /** Nguồn vị trí không chạy nền được, đã rơi về tiền cảnh (một lần mỗi `start`). */
  backgroundUnavailable: BackgroundUnavailable;
  /** Phiên đã dừng nguồn vị trí: đến nơi hoặc app gọi `stop()`. */
  end: { reason: 'arrived' | 'stopped' };
}

export interface NavigationSession {
  /** Resolve sau khi đã đăng ký nguồn vị trí (có thể chờ hộp thoại quyền). Reject chỉ khi thiếu `source`. */
  start(opts: NavigationSessionStartOptions): Promise<void>;
  stop(): Promise<void>;
  reroute(): Promise<void>;
  setRoute(response: DirectionsResponse, routeIndex?: number): void;
  /** 'idle' khi chưa start hoặc đã stop; 'navigating' ngay sau start (core chỉ đổi ở fix đầu). */
  readonly status: NavigationStatus;
  readonly state: NavigationProgress | null;
  /** Tuyến hiện tại — map gắn muộn vẽ lại từ đây; `stop()` không xoá. */
  readonly response: DirectionsResponse | null;
  readonly routeIndex: number;
  on<K extends keyof SessionEvents>(event: K, handler: (e: SessionEvents[K]) => void): void;
  off<K extends keyof SessionEvents>(event: K, handler: (e: SessionEvents[K]) => void): void;
}

export const MISSING_SOURCE_MESSAGE =
  'Phiên dẫn đường thiếu nguồn vị trí: truyền source (ví dụ expoLocationSource() từ @mapslibvn/react-native/expo)';

/** Sự kiện core phát lại nguyên; `status` xử lý riêng (lọc 'stopped' và idle→navigating). */
const FORWARDED = [
  'progress',
  'step',
  'waypoint',
  'offRoute',
  'reroute',
  'rerouteFailed',
  'announce',
  'arrive',
] as const;

type Listener = (e: never) => void;

export function createNavigationSession(opts: NavigationSessionOptions): NavigationSession {
  const listeners = new Map<string, Set<Listener>>();
  const emit = <K extends keyof SessionEvents>(event: K, e: SessionEvents[K]): void => {
    for (const fn of listeners.get(event) ?? []) (fn as (e: SessionEvents[K]) => void)(e);
  };

  let nav: Navigator | null = null;
  let unsubscribe: (() => void) | null = null;
  let running = false;
  let ended = false;
  let startToken = 0;
  let response: DirectionsResponse | null = null;
  let routeIndex = 0;
  let voiceOn = false;
  let keepOn = false;
  let audioOn = false;

  const currentStatus = (): NavigationStatus => {
    if (!nav) return 'idle';
    return nav.status === 'idle' ? 'navigating' : nav.status;
  };
  const releaseSource = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const releaseDevice = async (): Promise<void> => {
    if (keepOn) {
      keepOn = false;
      try {
        await opts.keepAwake?.deactivate();
      } catch {
        /* không chặn dừng */
      }
    }
    if (audioOn) {
      audioOn = false;
      try {
        await opts.audio?.deactivate();
      } catch {
        /* không chặn dừng */
      }
    }
  };

  async function stop(): Promise<void> {
    if (!running) return;
    running = false;
    startToken += 1;
    const previous = currentStatus();
    releaseSource();
    if (voiceOn) opts.speech?.cancel();
    voiceOn = false;
    const engine = nav;
    nav = null;
    engine?.stop(); // core phát status 'stopped' — bị lọc, phiên tự phát 'idle' bên dưới
    await releaseDevice();
    emit('status', { status: 'idle', previous });
    if (!ended) emit('end', { reason: 'stopped' });
    ended = false;
  }

  async function start(o: NavigationSessionStartOptions): Promise<void> {
    if (running) await stop();
    const source = opts.source;
    if (!source) throw new Error(MISSING_SOURCE_MESSAGE);
    running = true;
    ended = false;
    startToken += 1;
    const token = startToken;
    response = o.response;
    routeIndex = o.routeIndex ?? 0;
    const lang: DirectionsLang = o.lang ?? 'vi';
    const navOptions: NavigatorOptions = {
      response: o.response,
      routeIndex,
      provider: opts.provider,
      reroute: o.reroute ?? 'auto',
      lang,
    };
    if (o.thresholds) navOptions.thresholds = o.thresholds;
    const engine = createNavigator(navOptions);
    const mode: TravelMode = o.response.routes[routeIndex]?.mode ?? 'motorbike';

    voiceOn = o.voice !== false && Boolean(opts.speech);
    if (voiceOn && opts.speech) {
      if (typeof o.voice === 'object') opts.speech.setOptions?.(o.voice);
      if (opts.audio) {
        audioOn = true;
        try {
          await opts.audio.activate();
        } catch {
          /* vẫn thử đọc */
        }
      }
      let available = true;
      try {
        available = await opts.speech.available(lang);
      } catch {
        /* coi như có giọng */
      }
      if (token !== startToken) return; // stop() hoặc start() khác đã chen vào lúc chờ
      if (!available) emit('voiceUnavailable', undefined);
    }
    keepOn = (o.keepAwake ?? true) && Boolean(opts.keepAwake);
    if (keepOn) {
      try {
        await opts.keepAwake?.activate();
      } catch {
        /* không chặn */
      }
    }
    if (token !== startToken) return;

    nav = engine;
    for (const name of FORWARDED) {
      engine.on(name, (e) => emit(name, e as SessionEvents[typeof name]));
    }
    engine.on('status', (e) => {
      if (e.status === 'stopped') return;
      if (e.status === 'navigating' && e.previous === 'idle') return; // đã phát lúc start()
      emit('status', e);
    });
    engine.on('announce', (a) => {
      if (voiceOn) opts.speech?.speak(a.text, a.priority, lang);
    });
    engine.on('reroute', (e) => {
      response = e.response;
      routeIndex = 0;
      emit('route', { response: e.response, routeIndex: 0 });
    });
    engine.on('arrive', () => {
      ended = true;
      releaseSource();
      void releaseDevice();
      emit('end', { reason: 'arrived' });
    });

    emit('route', { response: o.response, routeIndex });
    emit('status', { status: 'navigating', previous: 'idle' });
    source.setMode?.(mode);
    source.onBackgroundUnavailable?.((e) => emit('backgroundUnavailable', e));
    unsubscribe = source.subscribe(
      (fix) => engine.update(fix),
      (error) => emit('positionError', error),
    );
  }

  return {
    start,
    stop,
    reroute() {
      return nav ? nav.reroute() : Promise.reject(new Error('Phiên dẫn đường chưa start()'));
    },
    setRoute(next, index = 0) {
      response = next;
      routeIndex = index;
      nav?.setRoute(next, index);
      emit('route', { response: next, routeIndex: index });
    },
    get status() {
      return currentStatus();
    },
    get state() {
      return nav?.progress ?? null;
    },
    get response() {
      return response;
    },
    get routeIndex() {
      return routeIndex;
    },
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as Listener);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler as Listener);
    },
  };
}
```

- [x] **Step 4: Chạy xanh + typecheck gói RN**

Run: `pnpm exec vitest run packages/react-native/src/navigation/session.test.ts && pnpm --filter @mapslibvn/react-native typecheck`
Expected: 8 PASS; typecheck sạch.

- [x] **Step 5: Commit**

```bash
git add packages/react-native/src/navigation/session.ts packages/react-native/src/navigation/session.test.ts
git commit -m "feat(react-native): createNavigationSession — phiên dẫn đường độc lập với map, interface Speaker/KeepAwake/AudioSession

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Ảnh puck nhúng base64 + script sinh lại

**Files:**
- Create: `packages/react-native/scripts/gen-puck.mjs`
- Create: `packages/react-native/src/navigation/puck-image.ts` (do script sinh)
- Create: `packages/react-native/src/navigation/puck-image.test.ts`

- [x] **Step 1: Viết test đỏ**

`packages/react-native/src/navigation/puck-image.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PUCK_IMAGE_KEY, PUCK_PNG_DATA_URI } from './puck-image';

describe('puck-image', () => {
  it('là PNG RGBA 66×66 nhúng base64, khoá cố định', () => {
    expect(PUCK_IMAGE_KEY).toBe('mapslibvn-puck');
    const prefix = 'data:image/png;base64,';
    expect(PUCK_PNG_DATA_URI.startsWith(prefix)).toBe(true);
    const png = Buffer.from(PUCK_PNG_DATA_URI.slice(prefix.length), 'base64');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(66); // width
    expect(png.readUInt32BE(20)).toBe(66); // height
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // RGBA
    expect(png.length).toBeLessThan(2000);
  });
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `pnpm exec vitest run packages/react-native/src/navigation/puck-image.test.ts`
Expected: FAIL — không resolve được `./puck-image`.

- [x] **Step 3: Viết script sinh**

`packages/react-native/scripts/gen-puck.mjs`:

```js
#!/usr/bin/env node
// Sinh src/navigation/puck-image.ts: PNG mũi tên 66×66 hướng bắc (xanh #2458a6, viền trắng, khuyết
// đuôi), siêu lấy mẫu 4× cho mượt, nhúng base64 để tarball không cần file asset (spec C mục 7).
// Chạy: node packages/react-native/scripts/gen-puck.mjs
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const W = 66;
const H = 66;
const S = 4; // mẫu mỗi chiều trên một điểm ảnh
const BLUE = [0x24, 0x58, 0xa6];
const WHITE = [255, 255, 255];
// Mũi tên = hai tam giác (nửa trái/phải) để có khuyết ở đuôi; ruột nhỏ hơn viền ~4 px.
const OUTER = [
  [[33, 3], [60, 60], [33, 48]],
  [[33, 3], [6, 60], [33, 48]],
];
const INNER = [
  [[33, 10], [53, 55], [33, 44]],
  [[33, 10], [13, 55], [33, 44]],
];

/** @param {number} px @param {number} py @param {number[][]} t */
function insideTri(px, py, t) {
  const [[x1, y1], [x2, y2], [x3, y3]] = t;
  const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
  const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
/** @param {number} px @param {number} py @param {number[][][]} tris */
const inAny = (px, py, tris) => tris.some((t) => insideTri(px, py, t));

const bytes = [];
for (let y = 0; y < H; y++) {
  bytes.push(0); // filter type của dòng
  for (let x = 0; x < W; x++) {
    let outer = 0;
    let inner = 0;
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const px = x + (sx + 0.5) / S;
        const py = y + (sy + 0.5) / S;
        if (inAny(px, py, OUTER)) outer += 1;
        if (inAny(px, py, INNER)) inner += 1;
      }
    }
    const alpha = outer / (S * S);
    if (alpha === 0) {
      bytes.push(0, 0, 0, 0);
      continue;
    }
    const t = inner / outer;
    for (let k = 0; k < 3; k++) bytes.push(Math.round(WHITE[k] * (1 - t) + BLUE[k] * t));
    bytes.push(Math.round(255 * alpha));
  }
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.from(bytes), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = `// Sinh bởi scripts/gen-puck.mjs — KHÔNG sửa tay; chạy lại script nếu đổi hình.
/** Khoá ảnh đăng ký qua <Images> và dùng trong icon-image của layer puck. */
export const PUCK_IMAGE_KEY = 'mapslibvn-puck';
/** PNG 66×66 mũi tên hướng bắc, xanh #2458a6 viền trắng, nền trong suốt. */
export const PUCK_PNG_DATA_URI =
  'data:image/png;base64,${png.toString('base64')}';
`;
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src/navigation/puck-image.ts');
writeFileSync(target, out);
console.log(`✓ ${target} (${png.length} byte PNG)`);
```

- [x] **Step 4: Chạy script, xem ảnh, chạy test xanh**

Run:
```bash
node packages/react-native/scripts/gen-puck.mjs
node -e "const s=require('fs').readFileSync('packages/react-native/src/navigation/puck-image.ts','utf8');const b=s.match(/base64,([^']+)'/)[1];require('fs').writeFileSync('/tmp/puck.png',Buffer.from(b,'base64'))" && open /tmp/puck.png
pnpm exec vitest run packages/react-native/src/navigation/puck-image.test.ts
```
Expected: in ra `✓ … (~900 byte PNG)`; ảnh là tam giác xanh viền trắng mũi hướng lên; test PASS. `pnpm lint` phải xanh (Biome không đòi ngắt chuỗi dài).

- [x] **Step 5: Commit**

```bash
git add packages/react-native/scripts/gen-puck.mjs packages/react-native/src/navigation/puck-image.ts packages/react-native/src/navigation/puck-image.test.ts
git commit -m "feat(react-native): ảnh puck mũi tên nhúng base64 + script sinh lại

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `RoutesStore` + `RouteLayers` (source, layer, puck, marker) + mock mlrn mở rộng

**Files:**
- Create: `packages/react-native/src/navigation/routes-store.ts`
- Create: `packages/react-native/src/navigation/routes-store.test.ts`
- Create: `packages/react-native/src/navigation/route-layers.tsx`
- Create: `packages/react-native/src/navigation/route-layers.test.tsx`
- Modify: `packages/react-native/src/test/mlrn-mock.tsx`

- [x] **Step 1: Viết test store đỏ**

`packages/react-native/src/navigation/routes-store.test.ts`:

```ts
import type { DirectionsResponse } from '@mapslibvn/core';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import { createRoutesStore } from './routes-store';

const response = fixture as unknown as DirectionsResponse;
const kinds = (store: ReturnType<typeof createRoutesStore>) =>
  store.getSnapshot().features.features.map((f) => f.properties.kind);

describe('createRoutesStore', () => {
  it('show → active; setProgress → traveled/active/puck; setPuck(false) bỏ puck; setActive reset progress', () => {
    const store = createRoutesStore();
    const onChange = vi.fn();
    store.subscribe(onChange);
    expect(kinds(store)).toEqual([]);
    store.show(response);
    expect(kinds(store)).toEqual(['active']);
    store.setProgress({ shapeIndex: 5, snapped: [106.6985, 10.7791], bearing: 90 });
    expect(kinds(store)).toEqual(['traveled', 'active', 'puck']);
    store.setPuck(false);
    expect(kinds(store)).toEqual(['traveled', 'active']);
    store.setPuck(false); // không đổi → không báo
    store.setActive(0);
    expect(store.getSnapshot().progress).toBeNull();
    expect(kinds(store)).toEqual(['active']);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('clear xoá response và features; snapshot ổn định khi không đổi; unsubscribe ngừng báo', () => {
    const store = createRoutesStore();
    const onChange = vi.fn();
    const off = store.subscribe(onChange);
    store.show(response, { active: 0 });
    const a = store.getSnapshot();
    expect(store.getSnapshot()).toBe(a);
    store.clear();
    expect(store.getSnapshot().response).toBeNull();
    expect(kinds(store)).toEqual([]);
    off();
    store.show(response);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
```

- [x] **Step 2: Chạy đỏ**

Run: `pnpm exec vitest run packages/react-native/src/navigation/routes-store.test.ts`
Expected: FAIL — không resolve được `./routes-store`.

- [x] **Step 3: Viết `routes-store.ts`**

```ts
import {
  type DirectionsResponse,
  EMPTY_ROUTE_FEATURES,
  type RouteFeatureCollection,
  type RouteProgressCut,
  decodeRoutes,
  routeFeatures,
} from '@mapslibvn/core';

export interface RoutesSnapshot {
  response: DirectionsResponse | null;
  active: number;
  progress: RouteProgressCut | null;
  puck: boolean;
  features: RouteFeatureCollection;
}

/** Nguồn sự thật cho lớp vẽ tuyến; `useSyncExternalStore` đọc `getSnapshot` (object mới mỗi lần đổi). */
export interface RoutesStore {
  getSnapshot(): RoutesSnapshot;
  subscribe(onChange: () => void): () => void;
  show(response: DirectionsResponse, opts?: { active?: number }): void;
  setActive(index: number): void;
  setProgress(cut: RouteProgressCut | null): void;
  setPuck(on: boolean): void;
  clear(): void;
}

export function createRoutesStore(): RoutesStore {
  let coords: [number, number][][] = [];
  let snapshot: RoutesSnapshot = {
    response: null,
    active: 0,
    progress: null,
    puck: true,
    features: EMPTY_ROUTE_FEATURES,
  };
  const listeners = new Set<() => void>();

  const set = (patch: Partial<Omit<RoutesSnapshot, 'features'>>): void => {
    const next: RoutesSnapshot = { ...snapshot, ...patch };
    next.features = next.response
      ? routeFeatures(coords, { active: next.active, progress: next.progress, puck: next.puck })
      : EMPTY_ROUTE_FEATURES;
    snapshot = next;
    for (const fn of listeners) fn();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    show(response, opts = {}) {
      coords = decodeRoutes(response);
      set({ response, active: opts.active ?? 0, progress: null });
    },
    setActive(index) {
      set({ active: index, progress: null });
    },
    setProgress(cut) {
      set({ progress: cut });
    },
    setPuck(on) {
      if (on !== snapshot.puck) set({ puck: on });
    },
    clear() {
      coords = [];
      set({ response: null, progress: null });
    },
  };
}
```

- [x] **Step 4: Chạy test store xanh**

Run: `pnpm exec vitest run packages/react-native/src/navigation/routes-store.test.ts`
Expected: 2 PASS.

- [x] **Step 5: Mở rộng mock mlrn**

Thêm vào `packages/react-native/src/test/mlrn-mock.tsx` (sau `Marker`):

```tsx
type SourceProps = {
  id?: string;
  data: unknown;
  onPress?: (e: unknown) => void;
  children?: ReactNode;
};
let lastSourceProps: SourceProps | null = null;
export const getLastSourceProps = () => lastSourceProps;

export function GeoJSONSource(props: SourceProps) {
  lastSourceProps = props;
  return (
    <div data-testid={`mlrn-source-${props.id ?? 'x'}`} data-geojson={JSON.stringify(props.data)}>
      {props.children}
    </div>
  );
}

export function Layer(props: Record<string, unknown> & { id?: string }) {
  return <div data-testid={`mlrn-layer-${String(props.id)}`} data-layer={JSON.stringify(props)} />;
}

export function Images(props: { images: Record<string, unknown> }) {
  return <div data-testid="mlrn-images" data-keys={Object.keys(props.images).join(',')} />;
}
```

và trong `resetMocks` thêm dòng `lastSourceProps = null;`.

- [x] **Step 6: Viết test RouteLayers đỏ**

`packages/react-native/src/navigation/route-layers.test.tsx`:

```tsx
// @vitest-environment jsdom
import type { DirectionsResponse, MapsLibVNClient } from '@mapslibvn/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import { MapContext, type MapHandle } from '../context';
import { getLastSourceProps, resetMocks } from '../test/mlrn-mock';
import { ROUTE_LAYER_IDS, ROUTE_SOURCE_ID, RouteLayers } from './route-layers';
import { createRoutesStore } from './routes-store';

vi.mock('react-native', () => import('../test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('../test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const withAlt: DirectionsResponse = {
  ...response,
  routes: [response.routes[0], { ...response.routes[0], distance_m: 1 }] as DirectionsResponse['routes'],
};
// Marker của SDK gọi useMap() → cần một MapHandle giả trong context.
const handle = { places: {} as MapsLibVNClient } as unknown as MapHandle;
const layer = (id: string) =>
  JSON.parse(screen.getByTestId(`mlrn-layer-${id}`).dataset.layer ?? '{}') as Record<string, unknown>;
const geojson = () =>
  JSON.parse(screen.getByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`).dataset.geojson ?? '{}') as {
    features: { properties: { kind: string } }[];
  };

afterEach(() => {
  cleanup();
  resetMocks();
});

describe('RouteLayers', () => {
  it('không có tuyến → không render; show → source + 4 layer line trước beforeId, ảnh puck đăng ký, marker đích', () => {
    const store = createRoutesStore();
    const { rerender } = render(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId="road_one_way_arrow" />
      </MapContext.Provider>,
    );
    expect(screen.queryByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`)).toBeNull();
    act(() => store.show(response));
    rerender(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId="road_one_way_arrow" />
      </MapContext.Provider>,
    );
    expect(geojson().features.map((f) => f.properties.kind)).toEqual(['active']);
    for (const id of [ROUTE_LAYER_IDS.alt, ROUTE_LAYER_IDS.casing, ROUTE_LAYER_IDS.line, ROUTE_LAYER_IDS.traveled]) {
      expect(layer(id).beforeId).toBe('road_one_way_arrow');
      expect(layer(id).type).toBe('line');
    }
    expect(layer(ROUTE_LAYER_IDS.line).paint).toEqual({ 'line-color': '#2458a6', 'line-width': 6 });
    expect(screen.getByTestId('mlrn-images').dataset.keys).toBe('mapslibvn-puck');
    // Layer puck luôn có khi puck bật; chưa có progress thì source không có feature puck (kinds ở trên).
    expect(screen.getByTestId(`mlrn-layer-${ROUTE_LAYER_IDS.puck}`)).toBeTruthy();
    const markers = screen.getAllByTestId('mapslibvn-route-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0]?.dataset.lnglat).toBe(response.waypoints[1]?.snapped.join(','));
  });

  it('progress → traveled/active/puck; layer puck xoay theo bearing, không beforeId; routeStyle đổi màu', () => {
    const store = createRoutesStore();
    store.show(response);
    store.setProgress({ shapeIndex: 5, snapped: [106.6985, 10.7791], bearing: 77 });
    render(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId={null} routeStyle={{ color: '#ff0000', traveledOpacity: 0.5 }} />
      </MapContext.Provider>,
    );
    expect(geojson().features.map((f) => f.properties.kind)).toEqual(['traveled', 'active', 'puck']);
    const puck = layer(ROUTE_LAYER_IDS.puck);
    expect(puck.type).toBe('symbol');
    expect(puck.beforeId).toBeUndefined();
    expect(puck.layout).toMatchObject({
      'icon-image': 'mapslibvn-puck',
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
    });
    expect(layer(ROUTE_LAYER_IDS.line).beforeId).toBeUndefined();
    expect(layer(ROUTE_LAYER_IDS.line).paint).toMatchObject({ 'line-color': '#ff0000' });
    expect(layer(ROUTE_LAYER_IDS.traveled).paint).toMatchObject({ 'line-opacity': 0.5 });
  });

  it('bấm tuyến thay thế → onRouteClick(index); puck tắt → không layer puck', () => {
    const store = createRoutesStore();
    store.show(withAlt, { active: 0 });
    store.setProgress({ shapeIndex: 5, snapped: [106.6985, 10.7791], bearing: 0 });
    store.setPuck(false);
    const onRouteClick = vi.fn();
    render(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId={null} onRouteClick={onRouteClick} />
      </MapContext.Provider>,
    );
    expect(screen.queryByTestId(`mlrn-layer-${ROUTE_LAYER_IDS.puck}`)).toBeNull();
    getLastSourceProps()?.onPress?.({
      nativeEvent: { features: [{ properties: { kind: 'alt', index: 1 } }] },
    });
    expect(onRouteClick).toHaveBeenCalledWith(1);
    getLastSourceProps()?.onPress?.({ nativeEvent: { features: [{ properties: { kind: 'active', index: 0 } }] } });
    expect(onRouteClick).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 7: Chạy đỏ**

Run: `pnpm exec vitest run packages/react-native/src/navigation/route-layers.test.tsx`
Expected: FAIL — không resolve được `./route-layers`.

- [x] **Step 8: Viết `route-layers.tsx`**

```tsx
import {
  type FilterSpecification,
  GeoJSONSource,
  Images,
  Layer,
  type LineLayerSpecification,
  type PressEventWithFeatures,
  type SymbolLayerSpecification,
} from '@maplibre/maplibre-react-native';
import { useSyncExternalStore } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import { Marker } from '../marker';
import { PUCK_IMAGE_KEY, PUCK_PNG_DATA_URI } from './puck-image';
import type { RoutesStore } from './routes-store';

export const ROUTE_SOURCE_ID = 'mapslibvn-route';
export const ROUTE_LAYER_IDS = {
  alt: 'mapslibvn-route-alt',
  casing: 'mapslibvn-route-casing',
  line: 'mapslibvn-route-line',
  traveled: 'mapslibvn-route-traveled',
  puck: 'mapslibvn-route-puck',
} as const;
export const ROUTE_COLOR = '#2458a6';
export const ALT_ROUTE_COLOR = '#9ca8ba';
export const DESTINATION_COLOR = '#d92d20';

export interface RouteStyle {
  /** Tuyến chính và phần đã đi — mặc định #2458a6. */
  color?: string;
  /** Tuyến thay thế — mặc định #9ca8ba. */
  altColor?: string;
  /** Viền tuyến chính — mặc định trắng. */
  casingColor?: string;
  /** Độ mờ phần đã đi — mặc định 0,35. */
  traveledOpacity?: number;
}

interface RouteLayersProps {
  store: RoutesStore;
  routeStyle?: RouteStyle | undefined;
  /** Chèn các layer line trước lớp này; null = trên cùng. Puck luôn trên cùng. */
  beforeId: string | null;
  onRouteClick?: ((index: number) => void) | undefined;
}

const kindIs = (kind: string): FilterSpecification => ['==', ['get', 'kind'], kind];
const ROUND: NonNullable<LineLayerSpecification['layout']> = {
  'line-join': 'round',
  'line-cap': 'round',
};
const PUCK_LAYOUT: NonNullable<SymbolLayerSpecification['layout']> = {
  'icon-image': PUCK_IMAGE_KEY,
  'icon-rotate': ['get', 'bearing'],
  'icon-rotation-alignment': 'map',
  'icon-pitch-alignment': 'map',
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
  'icon-size': 0.5,
};

/** Source + layer tuyến và puck đọc từ RoutesStore. Render bên trong <Map> và trong MapContext. */
export function RouteLayers({ store, routeStyle, beforeId, onRouteClick }: RouteLayersProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (!snap.response) return null;
  const color = routeStyle?.color ?? ROUTE_COLOR;
  const altColor = routeStyle?.altColor ?? ALT_ROUTE_COLOR;
  const casingColor = routeStyle?.casingColor ?? '#ffffff';
  const traveledOpacity = routeStyle?.traveledOpacity ?? 0.35;
  const before = beforeId ? { beforeId } : {};
  const onPress = (e: NativeSyntheticEvent<PressEventWithFeatures>): void => {
    const alt = e.nativeEvent.features.find((f) => f.properties?.kind === 'alt');
    const index: unknown = alt?.properties?.index;
    if (typeof index === 'number') onRouteClick?.(index);
  };
  const waypoints = snap.response.waypoints;
  const last = waypoints.length - 1;
  return (
    <>
      <Images images={{ [PUCK_IMAGE_KEY]: { source: { uri: PUCK_PNG_DATA_URI } } }} />
      <GeoJSONSource
        id={ROUTE_SOURCE_ID}
        data={snap.features as GeoJSON.FeatureCollection}
        onPress={onPress}
      >
        <Layer
          type="line"
          id={ROUTE_LAYER_IDS.alt}
          source={ROUTE_SOURCE_ID}
          filter={kindIs('alt')}
          layout={ROUND}
          paint={{ 'line-color': altColor, 'line-width': 5 }}
          {...before}
        />
        <Layer
          type="line"
          id={ROUTE_LAYER_IDS.casing}
          source={ROUTE_SOURCE_ID}
          filter={kindIs('active')}
          layout={ROUND}
          paint={{ 'line-color': casingColor, 'line-width': 9 }}
          {...before}
        />
        <Layer
          type="line"
          id={ROUTE_LAYER_IDS.line}
          source={ROUTE_SOURCE_ID}
          filter={kindIs('active')}
          layout={ROUND}
          paint={{ 'line-color': color, 'line-width': 6 }}
          {...before}
        />
        <Layer
          type="line"
          id={ROUTE_LAYER_IDS.traveled}
          source={ROUTE_SOURCE_ID}
          filter={kindIs('traveled')}
          layout={ROUND}
          paint={{ 'line-color': color, 'line-width': 6, 'line-opacity': traveledOpacity }}
          {...before}
        />
        {snap.puck ? (
          <Layer
            type="symbol"
            id={ROUTE_LAYER_IDS.puck}
            source={ROUTE_SOURCE_ID}
            filter={kindIs('puck')}
            layout={PUCK_LAYOUT}
          />
        ) : null}
      </GeoJSONSource>
      {waypoints.map((w, i) =>
        i === 0 ? null : (
          <Marker
            key={`${i}-${w.snapped[0]}-${w.snapped[1]}`}
            lng={w.snapped[0]}
            lat={w.snapped[1]}
            color={i === last ? DESTINATION_COLOR : ALT_ROUTE_COLOR}
            testID="mapslibvn-route-marker"
          />
        ),
      )}
    </>
  );
}
```

Nếu `data={snap.features as GeoJSON.FeatureCollection}` báo lỗi kiểu, đổi thành
`data={snap.features as unknown as GeoJSON.FeatureCollection}` (kiểu core hẹp hơn `GeoJSON.Feature`
ở `properties`, không phải lỗi logic).

- [x] **Step 8b: `marker.tsx` đọc context trực tiếp** (tránh vòng import `map → route-layers → marker → map`)

Trong `packages/react-native/src/marker.tsx` đổi `import { useMap } from './map';` thành
`import { useContext } from 'react';` + `import { MapContext } from './context';`, và thay dòng
`useMap(); // bảo đảm nằm trong <MapsLibVNMap>` bằng:

```ts
  if (!useContext(MapContext)) throw new Error('useMap phải được gọi bên trong <MapsLibVNMap>');
```

(`marker.test.tsx` sẵn có vẫn xanh — thông điệp giữ nguyên.)

- [x] **Step 9: Chạy xanh + typecheck**

Run: `pnpm exec vitest run packages/react-native/src/navigation/ packages/react-native/src/marker.test.tsx && pnpm --filter @mapslibvn/react-native typecheck`
Expected: PASS toàn bộ thư mục (session, playback, puck, store, layers); typecheck sạch. Mock `Marker` in
`data-testid` từ prop `testID` nên `getAllByTestId('mapslibvn-route-marker')` bắt được.

- [x] **Step 10: Commit**

```bash
git add packages/react-native/src/navigation/routes-store.ts packages/react-native/src/navigation/routes-store.test.ts packages/react-native/src/navigation/route-layers.tsx packages/react-native/src/navigation/route-layers.test.tsx packages/react-native/src/test/mlrn-mock.tsx packages/react-native/src/marker.tsx
git commit -m "feat(react-native): RoutesStore + RouteLayers — GeoJSONSource, 4 layer tuyến, puck symbol, marker đích

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Gắn phiên vào map — `createMapBinding`, props `navigation`/`follow`/`puck`, `useMap().routes`/`.navigation`

**Files:**
- Create: `packages/react-native/src/navigation/map-binding.ts`
- Create: `packages/react-native/src/test/fake-session.ts`
- Create: `packages/react-native/src/map-navigation.test.tsx`
- Modify: `packages/react-native/src/test/react-native-mock.tsx` (thêm `AppState`)
- Modify: `packages/react-native/src/context.ts`
- Modify: `packages/react-native/src/use-style.ts` (export `isTheme`)
- Modify: `packages/react-native/src/map.tsx`

- [x] **Step 1: Thêm `AppState` vào mock react-native**

Thêm vào cuối `packages/react-native/src/test/react-native-mock.tsx`:

```tsx
type AppStateStatus = 'active' | 'background' | 'inactive';
const appStateListeners = new Set<(s: AppStateStatus) => void>();
export const AppState = {
  currentState: 'active' as AppStateStatus,
  addEventListener: (_type: string, cb: (s: AppStateStatus) => void) => {
    appStateListeners.add(cb);
    return { remove: () => appStateListeners.delete(cb) };
  },
};
/** Chỉ cho test: đổi trạng thái app và báo mọi listener. */
export function setAppState(s: AppStateStatus): void {
  AppState.currentState = s;
  for (const fn of appStateListeners) fn(s);
}
```

- [x] **Step 2: Phiên giả dùng chung cho test map và hook**

`packages/react-native/src/test/fake-session.ts`:

```ts
import type { DirectionsResponse, NavigationProgress, Route, RouteStep } from '@mapslibvn/core';
import { vi } from 'vitest';
import type { NavigationSession } from '../navigation/session';

/** Phiên giả điều khiển được từ test: phát sự kiện, đổi state/response. */
export function fakeSession(
  init: { response?: DirectionsResponse; routeIndex?: number; state?: NavigationProgress } = {},
) {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  let response: DirectionsResponse | null = init.response ?? null;
  let routeIndex = init.routeIndex ?? 0;
  let state: NavigationProgress | null = init.state ?? null;
  const session = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    reroute: vi.fn(async () => {}),
    setRoute: vi.fn(),
    on: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] ??= [];
      handlers[ev].push(fn);
    }),
    off: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn);
    }),
    get status() {
      return state?.status ?? 'idle';
    },
    get state() {
      return state;
    },
    get response() {
      return response;
    },
    get routeIndex() {
      return routeIndex;
    },
  } as unknown as NavigationSession;
  const emit = (ev: string, e: unknown) => {
    for (const fn of handlers[ev] ?? []) fn(e);
  };
  return {
    session,
    emit,
    progress(p: NavigationProgress) {
      state = p;
      emit('progress', p);
    },
    route(r: DirectionsResponse, i = 0) {
      response = r;
      routeIndex = i;
      emit('route', { response: r, routeIndex: i });
    },
    status(s: NavigationProgress['status']) {
      emit('status', { status: s, previous: 'idle' });
    },
    handlerCount: (ev: string) => (handlers[ev] ?? []).length,
  };
}

/** Một NavigationProgress hợp lệ tại `shapeIndex` trên tuyến fixture. */
export function progressAt(
  route: Route,
  shapeIndex: number,
  timestamp = 1_700_000_000_000,
): NavigationProgress {
  const step = route.legs[0]?.steps[0] as RouteStep;
  return {
    status: 'navigating',
    route,
    routeIndex: 0,
    legIndex: 0,
    stepIndex: 0,
    step,
    nextStep: route.legs[0]?.steps[1] ?? null,
    snapped: [106.6985, 10.7791],
    bearing: 45,
    shapeIndex,
    traveled_m: 100,
    remaining_m: 900,
    remaining_s: 120,
    distanceToStep_m: 50,
    offRoute_m: 2,
    fix: { lng: 106.6985, lat: 10.7791, timestamp },
  };
}
```

- [x] **Step 3: Viết test map đỏ**

`packages/react-native/src/map-navigation.test.tsx`:

```tsx
// @vitest-environment jsdom
import type { DirectionsResponse, Route } from '@mapslibvn/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import type { MapHandle } from './context';
import { MapsLibVNMap, type MapsLibVNMapProps } from './map';
import { ROUTE_LAYER_IDS, ROUTE_SOURCE_ID } from './navigation/route-layers';
import { MISSING_SOURCE_MESSAGE, type SessionPositionSource } from './navigation/session';
import { fakeSession, progressAt } from './test/fake-session';
import { cameraRefMock, getLastMapProps, getLastSourceProps, resetMocks } from './test/mlrn-mock';
import { setAppState } from './test/react-native-mock';

vi.mock('react-native', () => import('./test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('./test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;
const base = { apiKey: 'mlv_live_k', apiBase: 'https://api.test' };

const kinds = () =>
  (
    JSON.parse(screen.getByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`).dataset.geojson ?? '{}') as {
      features: { properties: { kind: string } }[];
    }
  ).features.map((f) => f.properties.kind);
const layerBefore = (id: string) =>
  (JSON.parse(screen.getByTestId(`mlrn-layer-${id}`).dataset.layer ?? '{}') as { beforeId?: string })
    .beforeId;
type MapProps = {
  onDidFinishLoadingStyle: () => void;
  onRegionWillChange: (e: { nativeEvent: { userInteraction: boolean } }) => void;
};
const mapProps = () => getLastMapProps() as unknown as MapProps;
/** Render map với props thêm, ép onLoad để lấy MapHandle. */
function mount(props: Omit<MapsLibVNMapProps, 'apiKey' | 'apiBase'> = {}) {
  const got: { handle: MapHandle | null } = { handle: null };
  const r = render(
    <MapsLibVNMap
      {...base}
      {...props}
      onLoad={(h) => {
        got.handle = h;
      }}
    />,
  );
  act(() => mapProps().onDidFinishLoadingStyle());
  if (!got.handle) throw new Error('onLoad chưa gọi');
  return { ...r, handle: got.handle };
}

afterEach(() => {
  cleanup();
  resetMocks();
  setAppState('active');
});

describe('MapsLibVNMap + navigation', () => {
  it('gắn phiên có tuyến → vẽ ngay dưới lớp symbol của theme; progress → traveled/puck + easeTo theo mode', () => {
    const s = fakeSession({ response });
    render(<MapsLibVNMap {...base} navigation={s.session} />);
    expect(kinds()).toEqual(['active']);
    expect(layerBefore(ROUTE_LAYER_IDS.line)).toBe('road_one_way_arrow');
    act(() => s.progress(progressAt(route, 5)));
    expect(kinds()).toEqual(['traveled', 'active', 'puck']);
    expect(cameraRefMock.easeTo).toHaveBeenLastCalledWith({
      center: [106.6985, 10.7791],
      bearing: 45,
      zoom: 16.5,
      pitch: 45,
      duration: 500,
    });
    act(() => s.progress(progressAt(route, 6, 1_700_000_000_000 + 2500)));
    expect(cameraRefMock.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 1000 }));
    act(() => s.route(response, 0));
    expect(kinds()).toEqual(['active']); // route mới → progress reset
  });

  it('beforeId: dark → water_name; URL style → không; routeBeforeLayerId ghi đè ("poi" hoặc null)', () => {
    const s = fakeSession({ response });
    const { rerender } = render(<MapsLibVNMap {...base} style="dark" navigation={s.session} />);
    expect(layerBefore(ROUTE_LAYER_IDS.line)).toBe('water_name');
    rerender(<MapsLibVNMap {...base} style="https://x.test/style.json" navigation={s.session} />);
    expect(layerBefore(ROUTE_LAYER_IDS.line)).toBeUndefined();
    rerender(<MapsLibVNMap {...base} routeBeforeLayerId="poi" navigation={s.session} />);
    expect(layerBefore(ROUTE_LAYER_IDS.line)).toBe('poi');
    rerender(<MapsLibVNMap {...base} routeBeforeLayerId={null} navigation={s.session} />);
    expect(layerBefore(ROUTE_LAYER_IDS.line)).toBeUndefined();
  });

  it('kéo tay → tắt bám + followChange(false), progress không easeTo; recenter → bật lại và easeTo ngay', () => {
    const s = fakeSession({ response });
    const { handle } = mount({ navigation: s.session });
    const follow = vi.fn();
    handle.navigation.on('followChange', follow);
    act(() => mapProps().onRegionWillChange({ nativeEvent: { userInteraction: true } }));
    expect(follow).toHaveBeenCalledWith(false);
    expect(handle.navigation.following).toBe(false);
    act(() => s.progress(progressAt(route, 5)));
    expect(cameraRefMock.easeTo).not.toHaveBeenCalled();
    act(() => mapProps().onRegionWillChange({ nativeEvent: { userInteraction: false } })); // animation của chính SDK
    expect(follow).toHaveBeenCalledTimes(1);
    act(() => handle.navigation.recenter());
    expect(follow).toHaveBeenLastCalledWith(true);
    expect(cameraRefMock.easeTo).toHaveBeenCalledTimes(1);
  });

  it('đổi prop navigation → gỡ listener phiên cũ, gắn phiên mới; bỏ prop → xoá tuyến; unmount không stop phiên', () => {
    const a = fakeSession({ response });
    const b = fakeSession({ response, state: progressAt(route, 8) });
    const { rerender, unmount } = render(<MapsLibVNMap {...base} navigation={a.session} />);
    expect(a.handlerCount('progress')).toBe(1);
    rerender(<MapsLibVNMap {...base} navigation={b.session} />);
    expect(a.handlerCount('progress')).toBe(0);
    expect(kinds()).toEqual(['traveled', 'active', 'puck']); // gắn muộn: vẽ từ state sẵn có
    expect(cameraRefMock.easeTo).toHaveBeenCalledTimes(1);
    rerender(<MapsLibVNMap {...base} />);
    expect(screen.queryByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`)).toBeNull();
    expect(b.handlerCount('progress')).toBe(0);
    rerender(<MapsLibVNMap {...base} navigation={b.session} />);
    unmount();
    expect(b.session.stop).not.toHaveBeenCalled();
    expect(b.handlerCount('progress')).toBe(0);
  });

  it('AppState background → progress không easeTo (tuyến vẫn cập nhật); về active → easeTo một lần từ state', () => {
    const s = fakeSession({ response });
    render(<MapsLibVNMap {...base} navigation={s.session} />);
    act(() => setAppState('background'));
    act(() => s.progress(progressAt(route, 5)));
    expect(kinds()).toEqual(['traveled', 'active', 'puck']);
    expect(cameraRefMock.easeTo).not.toHaveBeenCalled();
    act(() => setAppState('active'));
    expect(cameraRefMock.easeTo).toHaveBeenCalledTimes(1);
  });

  it('routes.show/clear không cần phiên; onRouteClick từ source; puck={false}; follow={false}', () => {
    const onRouteClick = vi.fn();
    const { handle, rerender } = mount({ onRouteClick, puck: false, follow: false });
    act(() => handle.routes.show(response));
    expect(kinds()).toEqual(['active']);
    getLastSourceProps()?.onPress?.({ nativeEvent: { features: [{ properties: { kind: 'alt', index: 1 } }] } });
    expect(onRouteClick).toHaveBeenCalledWith(1);
    const s = fakeSession({ response });
    rerender(<MapsLibVNMap {...base} onRouteClick={onRouteClick} puck={false} follow={false} navigation={s.session} />);
    act(() => s.progress(progressAt(route, 5)));
    expect(kinds()).toEqual(['traveled', 'active']);
    expect(screen.queryByTestId(`mlrn-layer-${ROUTE_LAYER_IDS.puck}`)).toBeNull();
    expect(cameraRefMock.easeTo).not.toHaveBeenCalled();
    act(() => handle.navigation.recenter());
    expect(cameraRefMock.easeTo).not.toHaveBeenCalled();
    act(() => handle.routes.clear());
    expect(screen.queryByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`)).toBeNull();
  });

  it('phiên mặc định: thiếu source → start reject; có sessionOptions.source → start vẽ tuyến và status navigating', async () => {
    const first = mount();
    expect(first.handle.navigation.status).toBe('idle');
    await expect(first.handle.navigation.start({ response })).rejects.toThrow(MISSING_SOURCE_MESSAGE);
    cleanup();
    resetMocks();
    const source: SessionPositionSource = { subscribe: () => () => {} };
    const { handle } = mount({ sessionOptions: { source } });
    await act(() => handle.navigation.start({ response }));
    expect(kinds()).toEqual(['active']);
    expect(handle.navigation.status).toBe('navigating');
    expect(handle.navigation.session.response).toBe(response);
  });
});
```

- [x] **Step 4: Chạy đỏ**

Run: `pnpm exec vitest run packages/react-native/src/map-navigation.test.tsx`
Expected: FAIL — `./navigation/map-binding` không tồn tại / props chưa có.

- [x] **Step 5: Viết `map-binding.ts`**

```ts
import type { CameraRef, ViewPadding } from '@maplibre/maplibre-react-native';
import type { NavigationProgress, NavigationStatus, TravelMode } from '@mapslibvn/core';
import type { RefObject } from 'react';
import type { RoutesStore } from './routes-store';
import type { NavigationSession, NavigationSessionStartOptions, SessionEvents } from './session';

export interface FollowOptions {
  /** Mặc định theo phương tiện: walk 17, motorbike 16,5, car 15,5. */
  zoom?: number;
  /** Mặc định 45. */
  pitch?: number;
  padding?: ViewPadding;
}

export const FOLLOW_ZOOM: Readonly<Record<TravelMode, number>> = {
  walk: 17,
  motorbike: 16.5,
  car: 15.5,
};
export const FOLLOW_PITCH = 45;

export interface BindingEvents extends SessionEvents {
  followChange: boolean;
}

/** Thứ lộ ra qua `useMap().navigation` — uỷ quyền sang phiên, thêm bám camera của map này. */
export interface MapNavigationBinding {
  /** Phiên qua prop `navigation`, không thì phiên mặc định của map (tạo lười). */
  readonly session: NavigationSession;
  readonly following: boolean;
  recenter(): void;
  start(opts: NavigationSessionStartOptions): Promise<void>;
  stop(): Promise<void>;
  reroute(): Promise<void>;
  readonly state: NavigationProgress | null;
  readonly status: NavigationStatus;
  on<K extends keyof BindingEvents>(event: K, handler: (e: BindingEvents[K]) => void): void;
  off<K extends keyof BindingEvents>(event: K, handler: (e: BindingEvents[K]) => void): void;
}

export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';
/** Phần của `AppState` (react-native) mà binding cần; tiêm được cho test. */
export interface AppStateLike {
  currentState: AppStateStatus;
  addEventListener(type: 'change', cb: (s: AppStateStatus) => void): { remove(): void };
}

export interface MapBindingDeps {
  camera: RefObject<CameraRef | null>;
  store: RoutesStore;
  appState: AppStateLike;
  /** Tạo phiên mặc định khi app dùng `useMap().navigation` mà không truyền prop `navigation`. */
  createDefaultSession: () => NavigationSession;
}

/** Nội bộ cho map.tsx; `api` là `MapNavigationBinding`. */
export interface MapBinding {
  readonly api: MapNavigationBinding;
  /** `null` = gỡ phiên đang gắn và xoá tuyến; phiên mặc định sẽ gắn lại lười khi `api` được dùng. */
  attach(session: NavigationSession | null): void;
  setFollow(follow: boolean | FollowOptions): void;
  /** Người dùng kéo/xoay bản đồ → tắt bám. */
  userGesture(): void;
  dispose(): void;
}

const SESSION_EVENTS = [
  'status',
  'progress',
  'step',
  'waypoint',
  'offRoute',
  'reroute',
  'rerouteFailed',
  'announce',
  'arrive',
  'route',
  'positionError',
  'voiceUnavailable',
  'backgroundUnavailable',
  'end',
] as const;

type Listener = (e: never) => void;

export function createMapBinding(deps: MapBindingDeps): MapBinding {
  const listeners = new Map<string, Set<Listener>>();
  const emit = <K extends keyof BindingEvents>(event: K, e: BindingEvents[K]): void => {
    for (const fn of listeners.get(event) ?? []) (fn as (e: BindingEvents[K]) => void)(e);
  };

  let explicit: NavigationSession | null = null;
  let fallback: NavigationSession | null = null;
  let attached: NavigationSession | null = null;
  let detachFns: (() => void)[] = [];
  let follow: { zoom?: number; pitch: number; padding?: ViewPadding } | null = { pitch: FOLLOW_PITCH };
  let following = true;
  let lastFixTs: number | null = null;

  const camera = (p: NavigationProgress): void => {
    if (!follow || !following || deps.appState.currentState !== 'active') return;
    const dt = lastFixTs === null ? 500 : p.fix.timestamp - lastFixTs;
    lastFixTs = p.fix.timestamp;
    deps.camera.current?.easeTo({
      center: p.snapped,
      bearing: p.bearing,
      zoom: follow.zoom ?? FOLLOW_ZOOM[p.route.mode],
      pitch: follow.pitch,
      duration: Math.max(0, Math.min(1000, dt)),
      ...(follow.padding ? { padding: follow.padding } : {}),
    });
  };
  const paint = (p: NavigationProgress): void => {
    deps.store.setProgress({ shapeIndex: p.shapeIndex, snapped: p.snapped, bearing: p.bearing });
    camera(p);
  };

  const detach = (): void => {
    for (const fn of detachFns) fn();
    detachFns = [];
    attached = null;
    lastFixTs = null;
    deps.store.clear();
  };

  const attachTo = (session: NavigationSession): void => {
    if (attached === session) return;
    detach();
    attached = session;
    const on = <K extends keyof SessionEvents>(k: K, fn: (e: SessionEvents[K]) => void): void => {
      session.on(k, fn);
      detachFns.push(() => session.off(k, fn));
    };
    // Một handler mỗi sự kiện: vẽ (route/progress) rồi phát lại cho listener của binding.
    for (const name of SESSION_EVENTS) {
      on(name, (e) => {
        if (name === 'progress') paint(e as NavigationProgress);
        else if (name === 'route') {
          const r = e as SessionEvents['route'];
          deps.store.show(r.response, { active: r.routeIndex });
        }
        emit(name, e as BindingEvents[typeof name]);
      });
    }
    if (session.response) deps.store.show(session.response, { active: session.routeIndex });
    const p = session.state;
    if (p) paint(p);
  };

  /** Phiên đang dùng để đọc trạng thái — không tạo phiên mặc định. */
  const current = (): NavigationSession | null => explicit ?? fallback;
  /** Phiên để ra lệnh — tạo và gắn phiên mặc định nếu chưa có. */
  const resolve = (): NavigationSession => {
    if (explicit) return explicit;
    if (!fallback) fallback = deps.createDefaultSession();
    if (attached !== fallback) attachTo(fallback);
    return fallback;
  };

  const appSub = deps.appState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    const p = attached?.state;
    if (p) camera(p);
  });

  const api: MapNavigationBinding = {
    get session() {
      return resolve();
    },
    get following() {
      return following;
    },
    recenter() {
      if (!follow) return;
      following = true;
      emit('followChange', true);
      const p = attached?.state;
      if (p) camera(p);
    },
    start: (o) => resolve().start(o),
    stop: () => current()?.stop() ?? Promise.resolve(),
    reroute: () =>
      current()?.reroute() ?? Promise.reject(new Error('Phiên dẫn đường chưa start()')),
    get state() {
      return current()?.state ?? null;
    },
    get status() {
      return current()?.status ?? 'idle';
    },
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as Listener);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler as Listener);
    },
  };

  return {
    api,
    attach(session) {
      explicit = session;
      if (session) attachTo(session);
      else detach();
    },
    setFollow(opt) {
      if (opt === false) {
        follow = null;
        following = false;
        return;
      }
      const o = typeof opt === 'object' ? opt : {};
      follow = {
        pitch: o.pitch ?? FOLLOW_PITCH,
        ...(o.zoom !== undefined ? { zoom: o.zoom } : {}),
        ...(o.padding ? { padding: o.padding } : {}),
      };
      following = true;
    },
    userGesture() {
      if (!following) return;
      following = false;
      emit('followChange', false);
    },
    dispose() {
      detach();
      appSub.remove();
      listeners.clear();
    },
  };
}
```

- [x] **Step 6: `context.ts` thêm `routes` và `navigation`**

Thay toàn bộ `packages/react-native/src/context.ts`:

```ts
import type { CameraRef, MapRef } from '@maplibre/maplibre-react-native';
import type { DirectionsResponse, MapsLibVNClient } from '@mapslibvn/core';
import { type RefObject, createContext } from 'react';
import type { MapNavigationBinding } from './navigation/map-binding';

/** Tay cầm map — tương ứng `MapsLibVNMap` của web: `native` thay `gl`. */
export interface MapHandle {
  /** Ref `Map` của @maplibre/maplibre-react-native — không giấu gì. */
  native: RefObject<MapRef | null>;
  camera: RefObject<CameraRef | null>;
  /** Client @mapslibvn/core với cùng khoá. */
  places: MapsLibVNClient;
  flyTo(center: [number, number], zoom?: number): void;
  fitBounds(bbox: [number, number, number, number], padding?: number): void;
  /** [west, south, east, north] */
  getBounds(): Promise<[number, number, number, number]>;
  /** Vẽ tuyến không cần phiên (xem trước, app khách). Phiên gắn vào sẽ ghi đè. */
  routes: {
    show(response: DirectionsResponse, opts?: { active?: number }): void;
    setActive(index: number): void;
    clear(): void;
  };
  /** Dẫn đường của map này: phiên qua prop `navigation`, không thì phiên mặc định tạo lười. */
  navigation: MapNavigationBinding;
}

export const MapContext = createContext<MapHandle | null>(null);
```

- [x] **Step 7: Export `isTheme` từ `use-style.ts`**

Đổi dòng `const isTheme = (s: string): s is Theme => s === 'light' || s === 'dark';` thành
`export const isTheme = (s: string): s is Theme => s === 'light' || s === 'dark';`.

- [x] **Step 8: Viết lại `map.tsx`**

Thay toàn bộ `packages/react-native/src/map.tsx`:

```tsx
import {
  Camera,
  type CameraRef,
  type MapRef,
  Map as NativeMap,
  type PressEvent,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import {
  FIRST_SYMBOL_LAYER_ID,
  type Lang,
  POI_LAYER_ID,
  type PoiFeature,
  type PoiSource,
  type Theme,
  createClient,
} from '@mapslibvn/core';
import { type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import {
  AppState,
  type NativeSyntheticEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Attribution } from './attribution';
import { MapContext, type MapHandle } from './context';
import { type FollowOptions, createMapBinding } from './navigation/map-binding';
import { RouteLayers, type RouteStyle } from './navigation/route-layers';
import { createRoutesStore } from './navigation/routes-store';
import {
  type NavigationSession,
  type NavigationSessionOptions,
  createNavigationSession,
} from './navigation/session';
import { toPoiFeature } from './to-poi-feature';
import { isTheme, useResolvedStyle } from './use-style';

export const DEFAULT_CENTER: [number, number] = [106.7, 10.776];
export const DEFAULT_ZOOM = 12;

export interface MapsLibVNMapProps {
  apiKey: string;
  /** Gốc API MapsLibVN, ví dụ https://api.ai-solutions.io.vn */
  apiBase: string;
  /** Theme 'light' | 'dark' hoặc URL style tuỳ biến — giống @mapslibvn/react. */
  style?: Theme | string;
  /** Giá trị KHỞI TẠO camera; đổi sau khi mount không tạo lại map — dùng useMap().flyTo. */
  center?: [number, number];
  zoom?: number;
  lang?: Lang;
  /** Hiển thị lớp POI — mặc định true */
  poiLayer?: boolean;
  /** Tập nguồn POI cho bản đồ và Places API — mặc định cả ba; đổi sau khi mount tạo lại map. */
  poiSources?: readonly PoiSource[];
  /** Attribution gọn (không có tuỳ chọn tắt) */
  compactAttribution?: boolean;
  /** Bundle id / application id của app → header X-Bundle-Id cho khoá mobile */
  bundleId?: string;
  /** Style của khung View bọc ngoài */
  containerStyle?: StyleProp<ViewStyle>;
  /** Phiên dẫn đường gắn vào map để vẽ tuyến, puck, camera bám; bỏ prop → gỡ và xoá tuyến. */
  navigation?: NavigationSession;
  /** Tuỳ chọn cho phiên mặc định (khi không truyền `navigation`); cần ít nhất `source`. */
  sessionOptions?: Omit<NavigationSessionOptions, 'provider'>;
  /** Camera bám vị trí khi dẫn đường — mặc định true (zoom theo phương tiện, pitch 45). */
  follow?: boolean | FollowOptions;
  /** Vẽ mũi tên vị trí — mặc định true; false để app tự vẽ từ `progress.snapped`. */
  puck?: boolean;
  routeStyle?: RouteStyle;
  /** Chèn tuyến dưới lớp này; mặc định lớp symbol đầu tiên của theme; null = trên cùng. */
  routeBeforeLayerId?: string | null;
  /** Bấm tuyến thay thế. */
  onRouteClick?: (index: number) => void;
  onLoad?: (map: MapHandle) => void;
  onPoiClick?: (poi: PoiFeature) => void;
  onError?: (error: Error) => void;
  testID?: string;
  children?: ReactNode;
}

export function MapsLibVNMap({
  apiKey,
  apiBase,
  style = 'light',
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  lang = 'vi',
  poiLayer = true,
  poiSources,
  compactAttribution = false,
  bundleId,
  containerStyle,
  navigation,
  sessionOptions,
  follow = true,
  puck = true,
  routeStyle,
  routeBeforeLayerId,
  onRouteClick,
  onLoad,
  onPoiClick,
  onError,
  testID,
  children,
}: MapsLibVNMapProps) {
  // Hook chỉ đọc khoá chuỗi này, không đọc `poiSources`: `poiSources={['osm']}` inline đổi
  // reference mỗi lần render, để mảng vào deps thì client bị tạo lại liên tục.
  const poiSourcesKey = poiSources?.join(',') ?? '';
  const places = useMemo(
    () =>
      createClient({
        apiKey,
        baseUrl: apiBase,
        ...(bundleId ? { headers: { 'X-Bundle-Id': bundleId } } : {}),
        ...(poiSourcesKey ? { poiSources: poiSourcesKey.split(',') as PoiSource[] } : {}),
      }),
    [apiKey, apiBase, bundleId, poiSourcesKey],
  );
  const native = useRef<MapRef | null>(null);
  const camera = useRef<CameraRef | null>(null);
  const handlers = useRef({ onLoad, onPoiClick, onError, onRouteClick });
  handlers.current = { onLoad, onPoiClick, onError, onRouteClick };
  const sessionOptionsRef = useRef(sessionOptions);
  sessionOptionsRef.current = sessionOptions;

  const store = useMemo(() => createRoutesStore(), []);
  const binding = useMemo(
    () =>
      createMapBinding({
        camera,
        store,
        appState: AppState,
        createDefaultSession: () =>
          createNavigationSession({ provider: places, ...sessionOptionsRef.current }),
      }),
    [places, store],
  );
  useEffect(() => () => binding.dispose(), [binding]);
  useEffect(() => {
    binding.attach(navigation ?? null);
  }, [binding, navigation]);
  // `follow` là object mới mỗi render → so bằng chuỗi để không setFollow liên tục.
  const followKey = JSON.stringify(follow);
  useEffect(() => {
    binding.setFollow(JSON.parse(followKey) as boolean | FollowOptions);
  }, [binding, followKey]);
  useEffect(() => {
    store.setPuck(puck);
  }, [store, puck]);

  const handle = useMemo<MapHandle>(
    () => ({
      native,
      camera,
      places,
      flyTo(c, z) {
        camera.current?.flyTo(z === undefined ? { center: c } : { center: c, zoom: z });
      },
      fitBounds(bbox, padding = 40) {
        camera.current?.fitBounds(bbox, {
          padding: { top: padding, right: padding, bottom: padding, left: padding },
        });
      },
      async getBounds() {
        const b = await native.current?.getBounds();
        if (!b) throw new Error('Bản đồ chưa sẵn sàng');
        return b;
      },
      routes: {
        show: (response, opts) => store.show(response, opts ?? {}),
        setActive: (index) => store.setActive(index),
        clear: () => store.clear(),
      },
      navigation: binding.api,
    }),
    [places, store, binding],
  );

  const resolved = useResolvedStyle(places, { style, lang, poiLayer });
  useEffect(() => {
    if (resolved.status === 'error') handlers.current.onError?.(resolved.error);
  }, [resolved]);

  // Đổi một trong các giá trị này → tạo lại map (như @mapslibvn/react); onLoad gọi lại một lần.
  const mapKey = `${apiKey}|${apiBase}|${style}|${lang}|${poiLayer}|${poiSourcesKey}`;
  const loadedFor = useRef<string | null>(null);

  const onPress = async (e: NativeSyntheticEvent<PressEvent>) => {
    if (!poiLayer || !handlers.current.onPoiClick) return;
    const features = await native.current?.queryRenderedFeatures(e.nativeEvent.point, {
      layers: [POI_LAYER_ID],
    });
    const poi = toPoiFeature(features?.[0]);
    if (poi) handlers.current.onPoiClick?.(poi);
  };
  const onRegionWillChange = (e: NativeSyntheticEvent<ViewStateChangeEvent>): void => {
    if (e.nativeEvent.userInteraction) binding.userGesture();
  };
  const beforeId =
    routeBeforeLayerId === undefined
      ? isTheme(style)
        ? FIRST_SYMBOL_LAYER_ID[style]
        : null
      : routeBeforeLayerId;

  return (
    <View style={[styles.container, containerStyle]} {...(testID ? { testID } : {})}>
      {resolved.status === 'ready' ? (
        <NativeMap
          key={mapKey}
          ref={native}
          style={styles.map}
          mapStyle={resolved.mapStyle}
          attribution
          attributionPosition={{ bottom: 8, right: 8 }}
          logo={false}
          onPress={onPress}
          onRegionWillChange={onRegionWillChange}
          onDidFinishLoadingStyle={() => {
            if (loadedFor.current === mapKey) return;
            loadedFor.current = mapKey;
            handlers.current.onLoad?.(handle);
          }}
          onDidFailLoadingMap={() => handlers.current.onError?.(new Error('Không tải được bản đồ'))}
        >
          <Camera ref={camera} initialViewState={{ center, zoom }} />
          <MapContext.Provider value={handle}>
            <RouteLayers
              store={store}
              routeStyle={routeStyle}
              beforeId={beforeId}
              onRouteClick={(index) => handlers.current.onRouteClick?.(index)}
            />
            {children}
          </MapContext.Provider>
        </NativeMap>
      ) : null}
      <Attribution
        compact={compactAttribution}
        onPress={() => {
          void native.current?.showAttribution();
        }}
      />
    </View>
  );
}

/** Map hiện hành — chỉ dùng bên trong <MapsLibVNMap>. */
export function useMap(): MapHandle {
  const map = useContext(MapContext);
  if (!map) throw new Error('useMap phải được gọi bên trong <MapsLibVNMap>');
  return map;
}

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  map: { flex: 1 },
});
```

- [x] **Step 9: Chạy xanh toàn bộ test RN + typecheck + lint**

Run: `pnpm exec vitest run packages/react-native && pnpm --filter @mapslibvn/react-native typecheck && pnpm lint`
Expected: PASS (kể cả `map.test.tsx`, `marker.test.tsx` cũ — nếu `map.test.tsx` đỏ vì `AppState` thiếu trong mock, Step 1 chưa lưu). Biome: nếu báo `useExhaustiveDependencies` ở effect `followKey`, giữ nguyên cách parse từ `followKey` (đã không đọc `follow` trong effect).

- [x] **Step 10: Commit**

```bash
git add packages/react-native/src/navigation/map-binding.ts packages/react-native/src/test/fake-session.ts packages/react-native/src/map-navigation.test.tsx packages/react-native/src/test/react-native-mock.tsx packages/react-native/src/context.ts packages/react-native/src/use-style.ts packages/react-native/src/map.tsx
git commit -m "feat(react-native): gắn phiên dẫn đường vào <MapsLibVNMap> — routes, navigation binding, camera bám, AppState

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Hook `useNavigation(session?)`

**Files:**
- Create: `packages/react-native/src/use-navigation.ts`
- Create: `packages/react-native/src/use-navigation.test.tsx`

- [x] **Step 1: Viết test đỏ**

`packages/react-native/src/use-navigation.test.tsx`:

```tsx
// @vitest-environment jsdom
import type { DirectionsResponse, Route } from '@mapslibvn/core';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import { MapsLibVNMap } from './map';
import { fakeSession, progressAt } from './test/fake-session';
import { getLastMapProps, resetMocks } from './test/mlrn-mock';
import { useNavigation } from './use-navigation';

vi.mock('react-native', () => import('./test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('./test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;

afterEach(() => {
  cleanup();
  resetMocks();
});

describe('useNavigation', () => {
  it('trong map, không tham số: đọc từ useMap().navigation, re-render theo status/progress/followChange; unmount gỡ listener', () => {
    const s = fakeSession({ response });
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <MapsLibVNMap apiKey="k" apiBase="https://api.test" navigation={s.session}>
        {children}
      </MapsLibVNMap>
    );
    const { result, unmount } = renderHook(() => useNavigation(), { wrapper });
    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBeNull();
    expect(result.current.following).toBe(true);
    act(() => s.progress(progressAt(route, 5)));
    expect(result.current.progress?.shapeIndex).toBe(5);
    expect(result.current.status).toBe('navigating');
    const props = getLastMapProps() as unknown as {
      onRegionWillChange: (e: { nativeEvent: { userInteraction: boolean } }) => void;
    };
    act(() => props.onRegionWillChange({ nativeEvent: { userInteraction: true } }));
    expect(result.current.following).toBe(false);
    act(() => result.current.recenter());
    expect(result.current.following).toBe(true);
    result.current.start({ response });
    expect(s.session.start).toHaveBeenCalledWith({ response });
    unmount();
    // binding của map đã dispose: listener trên phiên về 0
    expect(s.handlerCount('progress')).toBe(0);
  });

  it('có session: dùng được ngoài map; following=false, recenter no-op; start/stop/reroute uỷ quyền', async () => {
    const s = fakeSession({ response });
    const { result } = renderHook(() => useNavigation(s.session));
    expect(result.current.following).toBe(false);
    act(() => s.progress(progressAt(route, 3)));
    expect(result.current.progress?.shapeIndex).toBe(3);
    act(() => result.current.recenter());
    await result.current.stop();
    await result.current.reroute();
    expect(s.session.stop).toHaveBeenCalledTimes(1);
    expect(s.session.reroute).toHaveBeenCalledTimes(1);
  });

  it('ngoài map và không session → ném lỗi rõ', () => {
    expect(() => render(<Probe />)).toThrowError(/useNavigation phải được gọi bên trong/);
  });
});

function Probe() {
  useNavigation();
  return null;
}
```

- [x] **Step 2: Chạy đỏ**

Run: `pnpm exec vitest run packages/react-native/src/use-navigation.test.tsx`
Expected: FAIL — không resolve được `./use-navigation`.

- [x] **Step 3: Viết hook**

`packages/react-native/src/use-navigation.ts`:

```ts
import type { NavigationProgress, NavigationStatus } from '@mapslibvn/core';
import { useCallback, useContext, useSyncExternalStore } from 'react';
import { MapContext } from './context';
import type { NavigationSession, NavigationSessionStartOptions } from './navigation/session';

export interface UseNavigationResult {
  status: NavigationStatus;
  progress: NavigationProgress | null;
  /** Camera của map trong context đang bám; luôn false khi hook nhận `session` tường minh. */
  following: boolean;
  start(opts: NavigationSessionStartOptions): Promise<void>;
  stop(): Promise<void>;
  reroute(): Promise<void>;
  /** Bật lại bám camera của map trong context; no-op khi không có map. */
  recenter(): void;
}

/** Giao diện chung tối thiểu của phiên và binding — để hook không phải phân biệt hai kiểu. */
interface NavigationLike {
  readonly status: NavigationStatus;
  readonly state: NavigationProgress | null;
  start(opts: NavigationSessionStartOptions): Promise<void>;
  stop(): Promise<void>;
  reroute(): Promise<void>;
  on(event: 'status' | 'progress', handler: () => void): void;
  off(event: 'status' | 'progress', handler: () => void): void;
}

const noop = (): void => {};

/**
 * Không tham số → dùng `useMap().navigation` (phải nằm trong `<MapsLibVNMap>`).
 * Có `session` → dùng được ở bất kỳ đâu (banner ngoài map, màn hình khác).
 */
export function useNavigation(session?: NavigationSession): UseNavigationResult {
  const map = useContext(MapContext);
  const binding = session ? null : (map?.navigation ?? null);
  const target: NavigationLike | null = session ?? binding;
  if (!target) {
    throw new Error('useNavigation phải được gọi bên trong <MapsLibVNMap> hoặc truyền session');
  }
  // Ba store riêng: mỗi useSyncExternalStore gọi subscribe của NÓ một lần.
  const subscribeStatus = useCallback(
    (onChange: () => void) => {
      target.on('status', onChange);
      return () => target.off('status', onChange);
    },
    [target],
  );
  const subscribeProgress = useCallback(
    (onChange: () => void) => {
      target.on('progress', onChange);
      return () => target.off('progress', onChange);
    },
    [target],
  );
  const subscribeFollow = useCallback(
    (onChange: () => void) => {
      if (!binding) return noop;
      binding.on('followChange', onChange);
      return () => binding.off('followChange', onChange);
    },
    [binding],
  );
  const status = useSyncExternalStore(
    subscribeStatus,
    () => target.status,
    () => target.status,
  );
  const progress = useSyncExternalStore(
    subscribeProgress,
    () => target.state,
    () => target.state,
  );
  const following = useSyncExternalStore(
    subscribeFollow,
    () => binding?.following ?? false,
    () => binding?.following ?? false,
  );
  return {
    status,
    progress,
    following,
    start: (opts) => target.start(opts),
    stop: () => target.stop(),
    reroute: () => target.reroute(),
    recenter: () => binding?.recenter(),
  };
}
```

Nếu TypeScript không chấp nhận gán `NavigationSession`/`MapNavigationBinding` vào `NavigationLike` vì
`on` generic, đổi hai dòng `on`/`off` trong `NavigationLike` thành
`on(event: never, handler: () => void): void;` **không được** — thay vào đó bọc:
`const target = session ? asLike(session) : binding ? asLike(binding) : null;` với
`const asLike = (n: { on(...a: never[]): void; off(...a: never[]): void; ... }) => n as unknown as NavigationLike;`.
Ưu tiên cách gán thẳng; chỉ bọc khi typecheck thật sự đỏ.

- [x] **Step 4: Chạy xanh + typecheck**

Run: `pnpm exec vitest run packages/react-native/src/use-navigation.test.tsx && pnpm --filter @mapslibvn/react-native typecheck`
Expected: 3 PASS.

- [x] **Step 5: Commit**

```bash
git add packages/react-native/src/use-navigation.ts packages/react-native/src/use-navigation.test.tsx
git commit -m "feat(react-native): useNavigation(session?) — trong map hoặc với phiên tường minh

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Entry `/expo` — kiểu ambient, `modules.ts`, `defineNavigationTask`, `expoLocationSource`

**Files:**
- Create: `packages/react-native/src/expo/expo-modules.d.ts`
- Create: `packages/react-native/src/expo/modules.ts`
- Create: `packages/react-native/src/expo/location-source.ts`
- Create: `packages/react-native/src/expo/location-source.test.ts`

- [x] **Step 1: Kiểu ambient cho năm gói Expo** (không cài gói vào workspace — quyết định M6)

`packages/react-native/src/expo/expo-modules.d.ts`:

```ts
// Kiểu ambient TỐI THIỂU cho năm gói Expo mà entry `/expo` gọi. Không cài các gói này vào pnpm
// workspace (quyết định M6: Expo nằm ngoài workspace). App nhúng dùng kiểu thật của gói đã cài;
// API công khai của entry không lộ kiểu nào ở đây. Đối chiếu với expo-location 57.0.15,
// expo-task-manager 57.0.15, expo-speech 57.0.2, expo-audio 57.0.4, expo-keep-awake 57.0.1.

declare module 'expo-location' {
  export interface LocationObjectCoords {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    heading: number | null;
    speed: number | null;
  }
  export interface LocationObject {
    coords: LocationObjectCoords;
    timestamp: number;
  }
  export interface LocationSubscription {
    remove(): void;
  }
  export interface PermissionResponse {
    granted: boolean;
    status: string;
  }
  export interface LocationOptions {
    accuracy?: number;
    timeInterval?: number;
    distanceInterval?: number;
  }
  export function requestForegroundPermissionsAsync(): Promise<PermissionResponse>;
  export function watchPositionAsync(
    options: LocationOptions,
    callback: (location: LocationObject) => void,
    errorHandler?: (reason: string) => void,
  ): Promise<LocationSubscription>;
  export function startLocationUpdatesAsync(
    taskName: string,
    options?: Record<string, unknown>,
  ): Promise<void>;
  export function stopLocationUpdatesAsync(taskName: string): Promise<void>;
  export function hasStartedLocationUpdatesAsync(taskName: string): Promise<boolean>;
  export function isBackgroundLocationAvailableAsync(): Promise<boolean>;
}

declare module 'expo-task-manager' {
  export interface TaskManagerTaskBody<T = unknown> {
    data: T;
    error: { code: string | number; message: string } | null;
    executionInfo: {
      eventId: string;
      taskName: string;
      appState?: 'active' | 'background' | 'inactive';
    };
  }
  export function defineTask<T = unknown>(
    taskName: string,
    executor: (body: TaskManagerTaskBody<T>) => Promise<unknown> | unknown,
  ): void;
  export function isTaskDefined(taskName: string): boolean;
}

declare module 'expo-speech' {
  export interface SpeechOptions {
    language?: string;
    pitch?: number;
    rate?: number;
    volume?: number;
    voice?: string;
    onDone?: () => void;
    onStopped?: () => void;
    onError?: (error: Error) => void;
  }
  export interface Voice {
    identifier: string;
    name: string;
    quality: string;
    language: string;
  }
  export function speak(text: string, options?: SpeechOptions): void;
  export function stop(): Promise<void>;
  export function getAvailableVoicesAsync(): Promise<Voice[]>;
}

declare module 'expo-audio' {
  export interface AudioMode {
    playsInSilentMode: boolean;
    shouldPlayInBackground: boolean;
    interruptionMode: 'mixWithOthers' | 'doNotMix' | 'duckOthers';
    allowsRecording: boolean;
    shouldRouteThroughEarpiece: boolean;
  }
  export function setAudioModeAsync(mode: Partial<AudioMode>): Promise<void>;
}

declare module 'expo-keep-awake' {
  export function activateKeepAwakeAsync(tag?: string): Promise<void>;
  export function deactivateKeepAwake(tag?: string): Promise<void>;
}
```

`packages/react-native/src/expo/modules.ts`:

```ts
/// <reference path="./expo-modules.d.ts" />
// Chỗ DUY NHẤT import Expo trong SDK: test mock file này (`vi.mock('./modules')`), tsup để external,
// Metro của app chỉ resolve khi app import `@mapslibvn/react-native/expo`.
import * as Audio from 'expo-audio';
import * as KeepAwake from 'expo-keep-awake';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import * as TaskManager from 'expo-task-manager';

export { Audio, KeepAwake, Location, Speech, TaskManager };
```

- [x] **Step 2: Viết test đỏ**

`packages/react-native/src/expo/location-source.test.ts`:

```ts
import type { GeoFix, PositionError } from '@mapslibvn/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundUnavailable } from '../navigation/session';

const mocks = vi.hoisted(() => ({
  Location: {
    requestForegroundPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
    watchPositionAsync: vi.fn(
      async (_options: Record<string, unknown>, _cb?: unknown, _err?: unknown) => ({
        remove: vi.fn(),
      }),
    ),
    startLocationUpdatesAsync: vi.fn(async (_task: string, _options?: Record<string, unknown>) => {}),
    stopLocationUpdatesAsync: vi.fn(async () => {}),
    hasStartedLocationUpdatesAsync: vi.fn(async () => false),
    isBackgroundLocationAvailableAsync: vi.fn(async () => true),
  },
  TaskManager: {
    defineTask: vi.fn(),
    isTaskDefined: vi.fn(() => false),
  },
}));
vi.mock('./modules', () => ({
  Location: mocks.Location,
  TaskManager: mocks.TaskManager,
  Speech: {},
  Audio: {},
  KeepAwake: {},
}));

import {
  NAVIGATION_TASK,
  __resetNavigationTaskForTests,
  defineNavigationTask,
  expoLocationSource,
  toGeoFix,
} from './location-source';

type Executor = (body: {
  data: { locations?: unknown[] } | null;
  error: { code: string; message: string } | null;
  executionInfo: { eventId: string; taskName: string };
}) => unknown;
const executor = (): Executor => {
  const call = mocks.TaskManager.defineTask.mock.calls[0];
  if (!call) throw new Error('defineTask chưa được gọi');
  return call[1] as Executor;
};
const location = (over: Partial<{ latitude: number; longitude: number; accuracy: number | null; heading: number | null; speed: number | null }> = {}, timestamp = 1_700_000_000_000) => ({
  coords: { latitude: 10.7798, longitude: 106.699, accuracy: 12, heading: 90, speed: 3.5, ...over },
  timestamp,
});
const info = { eventId: 'e1', taskName: NAVIGATION_TASK };

/** Đợi các await bên trong subscribe() chạy xong. */
const flush = () => vi.waitFor(() => expect(mocks.Location.requestForegroundPermissionsAsync).toHaveBeenCalled());

beforeEach(() => {
  vi.clearAllMocks();
  __resetNavigationTaskForTests();
  mocks.TaskManager.isTaskDefined.mockReturnValue(false);
  mocks.Location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
  mocks.Location.isBackgroundLocationAvailableAsync.mockResolvedValue(true);
  mocks.Location.startLocationUpdatesAsync.mockResolvedValue(undefined);
  mocks.Location.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
});

describe('toGeoFix', () => {
  it('ánh xạ trường; heading/speed âm (iOS không có) → null; accuracy null → bỏ; timestamp hỏng → Date.now()', () => {
    expect(toGeoFix(location())).toEqual({
      lng: 106.699,
      lat: 10.7798,
      accuracy_m: 12,
      heading: 90,
      speed_mps: 3.5,
      timestamp: 1_700_000_000_000,
    });
    const fix = toGeoFix(location({ accuracy: null, heading: -1, speed: -1 }, Number.NaN));
    expect(fix.heading).toBeNull();
    expect(fix.speed_mps).toBeNull();
    expect('accuracy_m' in fix).toBe(false);
    expect(fix.timestamp).toBeGreaterThan(1_700_000_000_000);
  });
});

describe('defineNavigationTask', () => {
  it('define đúng một lần dù gọi hai lần; dừng task cũ còn sót', async () => {
    mocks.Location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    defineNavigationTask();
    defineNavigationTask();
    expect(mocks.TaskManager.defineTask).toHaveBeenCalledTimes(1);
    expect(mocks.TaskManager.defineTask.mock.calls[0]?.[0]).toBe(NAVIGATION_TASK);
    await vi.waitFor(() => expect(mocks.Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(NAVIGATION_TASK));
  });

  it('executor chạy khi không ai nghe (app bị đánh thức lại) → tự dừng task', async () => {
    defineNavigationTask();
    executor()({ data: { locations: [location()] }, error: null, executionInfo: info });
    await vi.waitFor(() => expect(mocks.Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1));
  });
});

describe('expoLocationSource — đường nền', () => {
  it('quyền → startLocationUpdatesAsync đúng options theo mode; executor đẩy fix theo thứ tự; unsubscribe dừng task', async () => {
    defineNavigationTask();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    const source = expoLocationSource({ notification: { title: 'Demo', color: '#2458a6' } });
    source.setMode?.('walk');
    const fixes: GeoFix[] = [];
    const bg = vi.fn();
    source.onBackgroundUnavailable?.(bg);
    const stop = source.subscribe((f) => fixes.push(f));
    await vi.waitFor(() => expect(mocks.Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1));
    expect(mocks.Location.startLocationUpdatesAsync).toHaveBeenCalledWith(NAVIGATION_TASK, {
      accuracy: 6,
      timeInterval: 1000,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      activityType: 3,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Demo',
        notificationBody: 'Chạm để mở ứng dụng',
        notificationColor: '#2458a6',
        killServiceOnDestroy: true,
      },
    });
    expect(mocks.Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(bg).not.toHaveBeenCalled();
    executor()({
      data: { locations: [location({}, 1), location({}, 2)] },
      error: null,
      executionInfo: info,
    });
    expect(fixes.map((f) => f.timestamp)).toEqual([1, 2]);
    stop();
    expect(mocks.Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(NAVIGATION_TASK);
    executor()({ data: { locations: [location({}, 3)] }, error: null, executionInfo: info });
    expect(fixes).toHaveLength(2);
  });

  it('mode mặc định motorbike → activityType 2; executor báo error → positionError unavailable', async () => {
    defineNavigationTask();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    const errors: PositionError[] = [];
    expoLocationSource().subscribe(
      () => {},
      (e) => errors.push(e),
    );
    await vi.waitFor(() => expect(mocks.Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1));
    expect(mocks.Location.startLocationUpdatesAsync.mock.calls[0]?.[1]).toMatchObject({ activityType: 2 });
    executor()({ data: null, error: { code: 'E_LOCATION', message: 'GPS tắt' }, executionInfo: info });
    expect(errors).toEqual([{ code: 'unavailable', message: 'GPS tắt', raw: { code: 'E_LOCATION', message: 'GPS tắt' } }]);
  });
});

describe('expoLocationSource — rơi về tiền cảnh', () => {
  const runFallback = async (): Promise<BackgroundUnavailable | undefined> => {
    const bg = vi.fn();
    const source = expoLocationSource();
    source.onBackgroundUnavailable?.(bg);
    source.subscribe(() => {});
    await vi.waitFor(() => expect(mocks.Location.watchPositionAsync).toHaveBeenCalledTimes(1));
    return bg.mock.calls[0]?.[0] as BackgroundUnavailable | undefined;
  };

  it('task chưa define → task_not_defined', async () => {
    expect(await runFallback()).toMatchObject({ reason: 'task_not_defined' });
    expect(mocks.Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mocks.Location.watchPositionAsync.mock.calls[0]?.[0]).toEqual({
      accuracy: 6,
      timeInterval: 1000,
      distanceInterval: 0,
    });
  });

  it('isBackgroundLocationAvailableAsync false → not_configured, không gọi start', async () => {
    defineNavigationTask();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    mocks.Location.isBackgroundLocationAvailableAsync.mockResolvedValue(false);
    expect(await runFallback()).toMatchObject({ reason: 'not_configured' });
    expect(mocks.Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('start ném: UIBackgroundModes → not_configured; Not authorized → permission; khác → unsupported', async () => {
    defineNavigationTask();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    mocks.Location.startLocationUpdatesAsync.mockRejectedValueOnce(
      new Error("Background location has not been configured, make sure to add 'location' to 'UIBackgroundModes' in the Info.plist file"),
    );
    expect(await runFallback()).toMatchObject({ reason: 'not_configured' });
    vi.clearAllMocks();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    mocks.Location.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('Not authorized to use background location services'));
    expect(await runFallback()).toMatchObject({ reason: 'permission' });
    vi.clearAllMocks();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    mocks.Location.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('boom'));
    expect(await runFallback()).toMatchObject({ reason: 'unsupported', message: 'boom' });
  });

  it('background:false → thẳng watchPositionAsync, không báo backgroundUnavailable; unsubscribe remove()', async () => {
    const remove = vi.fn();
    mocks.Location.watchPositionAsync.mockResolvedValue({ remove });
    const bg = vi.fn();
    const source = expoLocationSource({ background: false, accuracy: 'high', timeInterval_ms: 500 });
    source.onBackgroundUnavailable?.(bg);
    const stop = source.subscribe(() => {});
    await vi.waitFor(() => expect(mocks.Location.watchPositionAsync).toHaveBeenCalledTimes(1));
    expect(mocks.Location.watchPositionAsync.mock.calls[0]?.[0]).toEqual({ accuracy: 4, timeInterval: 500, distanceInterval: 0 });
    expect(bg).not.toHaveBeenCalled();
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('expoLocationSource — quyền và huỷ sớm', () => {
  it('từ chối quyền → positionError denied, không start/watch', async () => {
    mocks.Location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied' });
    const errors: PositionError[] = [];
    expoLocationSource().subscribe(
      () => {},
      (e) => errors.push(e),
    );
    await flush();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]?.code).toBe('denied');
    expect(mocks.Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mocks.Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('unsubscribe trước khi quyền trả về → không đăng ký gì', async () => {
    const gate: { grant: ((v: { granted: boolean; status: string }) => void) | null } = { grant: null };
    mocks.Location.requestForegroundPermissionsAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.grant = resolve;
        }),
    );
    const stop = expoLocationSource({ background: false }).subscribe(() => {});
    stop();
    gate.grant?.({ granted: true, status: 'granted' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.Location.watchPositionAsync).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 3: Chạy đỏ**

Run: `pnpm exec vitest run packages/react-native/src/expo/location-source.test.ts`
Expected: FAIL — không resolve được `./location-source`.

- [x] **Step 4: Viết `location-source.ts`**

```ts
import type { GeoFix, PositionError, TravelMode } from '@mapslibvn/core';
import type { BackgroundUnavailable, SessionPositionSource } from '../navigation/session';
import { Location, TaskManager } from './modules';

/** Tên task expo-task-manager nhận vị trí nền; một tên → một phiên nền tại một thời điểm. */
export const NAVIGATION_TASK = 'mapslibvn-navigation-location';

/** Độ chính xác của expo-location, đặt tên để không lộ enum của gói ra API công khai. */
export type ExpoLocationAccuracy = 'balanced' | 'high' | 'highest' | 'bestForNavigation';
const ACCURACY: Readonly<Record<ExpoLocationAccuracy, number>> = {
  balanced: 3,
  high: 4,
  highest: 5,
  bestForNavigation: 6,
};
/** `LocationActivityType` của expo-location (iOS `CLActivityType`). */
const ACTIVITY = { automotiveNavigation: 2, fitness: 3 } as const;

export interface ExpoLocationSourceOptions {
  /** Định vị cả khi khoá máy/chuyển app — mặc định true; cần app cấu hình plugin (docs). */
  background?: boolean;
  /** Mặc định 'bestForNavigation'. */
  accuracy?: ExpoLocationAccuracy;
  /** Mặc định 1000. */
  timeInterval_ms?: number;
  /** Thông báo foreground service Android. Mặc định "Đang dẫn đường" / "Chạm để mở ứng dụng". */
  notification?: { title?: string; body?: string; color?: string };
  /** iOS: thanh trạng thái báo đang dùng vị trí nền — mặc định true. */
  showsBackgroundLocationIndicator?: boolean;
  /** iOS activityType và Android ưu tiên; mặc định 'motorbike', phiên ghi đè bằng `setMode` theo tuyến. */
  mode?: TravelMode;
}

interface LocationObject {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
}

const finiteNonNegative = (v: number | null): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** `LocationObject` của expo-location → `GeoFix` của core. iOS trả heading/speed âm khi không có. */
export function toGeoFix(l: LocationObject): GeoFix {
  const c = l.coords;
  return {
    lng: c.longitude,
    lat: c.latitude,
    ...(finiteNonNegative(c.accuracy) ? { accuracy_m: c.accuracy } : {}),
    heading: finiteNonNegative(c.heading) ? c.heading : null,
    speed_mps: finiteNonNegative(c.speed) ? c.speed : null,
    timestamp: Number.isFinite(l.timestamp) ? l.timestamp : Date.now(),
  };
}

type FixListener = (fix: GeoFix) => void;
type ErrorListener = (e: PositionError) => void;
const fixListeners = new Set<FixListener>();
const errorListeners = new Set<ErrorListener>();
let taskDefined = false;

const stopTask = (): void => {
  void Location.stopLocationUpdatesAsync(NAVIGATION_TASK).catch(() => {
    /* task không tồn tại — bỏ qua */
  });
};

/**
 * Gọi ở PHẠM VI TOÀN CỤC của `index.ts`, trước `registerRootComponent` (yêu cầu của
 * expo-task-manager). Gọi lại là no-op. Executor đẩy fix cho nguồn đang đăng ký; không ai nghe (app
 * bị iOS đánh thức lại sau khi bị giết) thì tự dừng task để không thành task ma.
 */
export function defineNavigationTask(): void {
  if (taskDefined) return;
  taskDefined = true;
  TaskManager.defineTask<{ locations?: LocationObject[] } | null>(NAVIGATION_TASK, ({ data, error }) => {
    if (fixListeners.size === 0) {
      stopTask();
      return;
    }
    if (error) {
      for (const fn of errorListeners) fn({ code: 'unavailable', message: error.message, raw: error });
      return;
    }
    for (const l of data?.locations ?? []) {
      const fix = toGeoFix(l);
      for (const fn of fixListeners) fn(fix);
    }
  });
  // Task cũ còn sót từ lần chạy trước (app crash giữa chừng) → dừng.
  void Location.hasStartedLocationUpdatesAsync(NAVIGATION_TASK)
    .then((started) => {
      if (started) stopTask();
    })
    .catch(() => {
      /* không chặn khởi động */
    });
}

/** Chỉ cho test. */
export function __resetNavigationTaskForTests(): void {
  taskDefined = false;
  fixListeners.clear();
  errorListeners.clear();
}

const reasonFor = (message: string): BackgroundUnavailable['reason'] => {
  if (/in the background/i.test(message)) return 'unsupported';
  if (/authoriz|permission is required/i.test(message)) return 'permission';
  if (/UIBackgroundModes|manifest|task manager|task-manager|foreground service/i.test(message)) {
    return 'not_configured';
  }
  return 'unsupported';
};
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Nguồn vị trí Expo: một đường cho cả tiền cảnh lẫn nền (`startLocationUpdatesAsync` + task);
 * điều kiện nền thiếu thì rơi về `watchPositionAsync` và báo `onBackgroundUnavailable` (spec C 6.1).
 * Chỉ xin quyền When In Use — đã xác minh hai hệ không cần Always khi khởi động từ tiền cảnh.
 */
export function expoLocationSource(opts: ExpoLocationSourceOptions = {}): SessionPositionSource {
  let mode: TravelMode = opts.mode ?? 'motorbike';
  let onBackgroundUnavailable: ((e: BackgroundUnavailable) => void) | null = null;
  const request = {
    accuracy: ACCURACY[opts.accuracy ?? 'bestForNavigation'],
    timeInterval: opts.timeInterval_ms ?? 1000,
    distanceInterval: 0,
  };

  const tryBackground = async (): Promise<BackgroundUnavailable | null> => {
    if (!TaskManager.isTaskDefined(NAVIGATION_TASK)) {
      return {
        reason: 'task_not_defined',
        message: 'Chưa gọi defineNavigationTask() ở phạm vi toàn cục của index.ts',
      };
    }
    const available = await Location.isBackgroundLocationAvailableAsync().catch(() => true);
    if (!available) {
      return {
        reason: 'not_configured',
        message: 'Thiếu UIBackgroundModes location (iOS) — xem plugin expo-location trong docs',
      };
    }
    try {
      await Location.startLocationUpdatesAsync(NAVIGATION_TASK, {
        ...request,
        pausesUpdatesAutomatically: false,
        activityType: mode === 'walk' ? ACTIVITY.fitness : ACTIVITY.automotiveNavigation,
        showsBackgroundLocationIndicator: opts.showsBackgroundLocationIndicator ?? true,
        foregroundService: {
          notificationTitle: opts.notification?.title ?? 'Đang dẫn đường',
          notificationBody: opts.notification?.body ?? 'Chạm để mở ứng dụng',
          ...(opts.notification?.color ? { notificationColor: opts.notification.color } : {}),
          killServiceOnDestroy: true,
        },
      });
      return null;
    } catch (e) {
      const message = messageOf(e);
      return { reason: reasonFor(message), message };
    }
  };

  return {
    setMode(m) {
      mode = m;
    },
    onBackgroundUnavailable(cb) {
      onBackgroundUnavailable = cb;
    },
    subscribe(onFix, onError) {
      let stopped = false;
      let cleanup: (() => void) | null = null;
      void (async () => {
        const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
        if (stopped) return;
        if (!perm?.granted) {
          onError?.({ code: 'denied', message: 'Người dùng từ chối quyền vị trí' });
          return;
        }
        if (opts.background !== false) {
          const fallback = await tryBackground();
          if (stopped) {
            if (fallback === null) stopTask();
            return;
          }
          if (fallback === null) {
            const fixFn: FixListener = (f) => onFix(f);
            const errFn: ErrorListener = (e) => onError?.(e);
            fixListeners.add(fixFn);
            errorListeners.add(errFn);
            cleanup = () => {
              fixListeners.delete(fixFn);
              errorListeners.delete(errFn);
              stopTask();
            };
            return;
          }
          onBackgroundUnavailable?.(fallback);
        }
        try {
          const sub = await Location.watchPositionAsync(
            request,
            (l) => onFix(toGeoFix(l)),
            (reason) => onError?.({ code: 'unavailable', message: reason }),
          );
          if (stopped) {
            sub.remove();
            return;
          }
          cleanup = () => sub.remove();
        } catch (e) {
          onError?.({ code: 'unavailable', message: messageOf(e), raw: e });
        }
      })();
      return () => {
        stopped = true;
        cleanup?.();
        cleanup = null;
      };
    },
  };
}
```

- [x] **Step 5: Chạy xanh + typecheck**

Run: `pnpm exec vitest run packages/react-native/src/expo/location-source.test.ts && pnpm --filter @mapslibvn/react-native typecheck`
Expected: 11 PASS. Nếu typecheck báo không tìm thấy module `expo-location`, kiểm tra `expo-modules.d.ts` nằm trong `src/` (tsconfig `include: ["src"]`) và dòng `/// <reference>` trong `modules.ts`.

- [x] **Step 6: Commit**

```bash
git add packages/react-native/src/expo/expo-modules.d.ts packages/react-native/src/expo/modules.ts packages/react-native/src/expo/location-source.ts packages/react-native/src/expo/location-source.test.ts
git commit -m "feat(react-native/expo): defineNavigationTask + expoLocationSource — định vị nền một đường, tự rơi về tiền cảnh

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Entry `/expo` — `expoSpeech`, `expoAudioSession`, `expoKeepAwake`, `expoNavigation`, `index.ts`

**Files:**
- Create: `packages/react-native/src/expo/speech.ts`, `speech.test.ts`
- Create: `packages/react-native/src/expo/device.ts`, `device.test.ts`
- Create: `packages/react-native/src/expo/index.ts`

- [x] **Step 1: Viết test speech đỏ**

`packages/react-native/src/expo/speech.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SpeakOptions = {
  language?: string;
  rate?: number;
  volume?: number;
  pitch?: number;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (e: Error) => void;
};
const mocks = vi.hoisted(() => ({
  Speech: {
    speak: vi.fn<(text: string, options?: SpeakOptions) => void>(),
    stop: vi.fn(async () => {}),
    getAvailableVoicesAsync: vi.fn(async () => [] as { language: string }[]),
  },
}));
vi.mock('./modules', () => ({ Speech: mocks.Speech, Location: {}, TaskManager: {}, Audio: {}, KeepAwake: {} }));

import { expoSpeech } from './speech';

const lastOptions = (): SpeakOptions => mocks.Speech.speak.mock.calls.at(-1)?.[1] ?? {};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.clearAllMocks());

describe('expoSpeech', () => {
  it('đọc với vi-VN; ưu tiên thấp hơn câu đang đọc thì xếp hàng (không stop); bằng/cao hơn thì stop() rồi đọc', async () => {
    const s = expoSpeech({ rate: 1.1 });
    s.speak('Rẽ phải', 3, 'vi');
    expect(mocks.Speech.speak).toHaveBeenCalledTimes(1);
    expect(lastOptions()).toMatchObject({ language: 'vi-VN', rate: 1.1 });
    s.speak('Tiếp tục 200 mét', 1, 'vi');
    expect(mocks.Speech.stop).not.toHaveBeenCalled();
    expect(mocks.Speech.speak).toHaveBeenCalledTimes(2);
    s.speak('Điểm đến ở bên trái', 3, 'en');
    expect(mocks.Speech.stop).toHaveBeenCalledTimes(1);
    await flush();
    expect(mocks.Speech.speak).toHaveBeenCalledTimes(3);
    expect(lastOptions().language).toBe('en-US');
  });

  it('onStopped của câu cũ (đến muộn) không xoá ưu tiên câu mới; onDone câu mới thì xoá', async () => {
    const s = expoSpeech();
    s.speak('A', 3, 'vi');
    const first = lastOptions();
    s.speak('B', 3, 'vi');
    await flush();
    first.onStopped?.(); // callback của A về sau khi B đã bắt đầu
    s.speak('C', 3, 'vi'); // B vẫn đang đọc → phải stop
    expect(mocks.Speech.stop).toHaveBeenCalledTimes(2);
    await flush();
    lastOptions().onDone?.();
    s.speak('D', 1, 'vi'); // không còn câu nào → đọc thẳng
    expect(mocks.Speech.stop).toHaveBeenCalledTimes(2);
  });

  it('cancel → stop(); text rỗng bỏ qua; setOptions đổi rate/volume', () => {
    const s = expoSpeech();
    s.speak('', 3, 'vi');
    expect(mocks.Speech.speak).not.toHaveBeenCalled();
    s.setOptions?.({ rate: 0.9, volume: 0.5 });
    s.speak('A', 2, 'vi');
    expect(lastOptions()).toMatchObject({ rate: 0.9, volume: 0.5 });
    s.cancel();
    expect(mocks.Speech.stop).toHaveBeenCalledTimes(1);
    s.speak('B', 1, 'vi'); // sau cancel không còn ưu tiên → không stop thêm
    expect(mocks.Speech.stop).toHaveBeenCalledTimes(1);
  });

  it('available: danh sách rỗng → true; có voice khớp → true; không khớp → false; lỗi → true', async () => {
    const s = expoSpeech();
    expect(await s.available('vi')).toBe(true);
    mocks.Speech.getAvailableVoicesAsync.mockResolvedValue([{ language: 'vi_VN' }, { language: 'en-US' }]);
    expect(await s.available('vi')).toBe(true);
    mocks.Speech.getAvailableVoicesAsync.mockResolvedValue([{ language: 'en-US' }]);
    expect(await s.available('vi')).toBe(false);
    mocks.Speech.getAvailableVoicesAsync.mockRejectedValue(new Error('x'));
    expect(await s.available('vi')).toBe(true);
  });
});
```

- [x] **Step 2: Viết test device đỏ**

`packages/react-native/src/expo/device.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  Audio: { setAudioModeAsync: vi.fn(async () => {}) },
  KeepAwake: { activateKeepAwakeAsync: vi.fn(async () => {}), deactivateKeepAwake: vi.fn(async () => {}) },
}));
vi.mock('./modules', () => ({ Audio: mocks.Audio, KeepAwake: mocks.KeepAwake, Location: {}, TaskManager: {}, Speech: {} }));

import { KEEP_AWAKE_TAG, expoAudioSession, expoKeepAwake } from './device';

beforeEach(() => vi.clearAllMocks());

describe('expoAudioSession', () => {
  it('activate: phát khi im lặng, nền, duck nhạc; deactivate: trả về mixWithOthers; lỗi nuốt', async () => {
    const a = expoAudioSession();
    await a.activate();
    expect(mocks.Audio.setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
    await a.deactivate();
    expect(mocks.Audio.setAudioModeAsync).toHaveBeenLastCalledWith({
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
    mocks.Audio.setAudioModeAsync.mockRejectedValueOnce(new Error('x'));
    await expect(a.activate()).resolves.toBeUndefined();
  });
});

describe('expoKeepAwake', () => {
  it('activate/deactivate cùng tag; lỗi nuốt', async () => {
    const k = expoKeepAwake();
    await k.activate();
    expect(mocks.KeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
    await k.deactivate();
    expect(mocks.KeepAwake.deactivateKeepAwake).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
    mocks.KeepAwake.activateKeepAwakeAsync.mockRejectedValueOnce(new Error('x'));
    await expect(k.activate()).resolves.toBeUndefined();
  });
});
```

- [x] **Step 3: Chạy đỏ**

Run: `pnpm exec vitest run packages/react-native/src/expo/speech.test.ts packages/react-native/src/expo/device.test.ts`
Expected: FAIL — không resolve được `./speech`, `./device`.

- [x] **Step 4: Viết `speech.ts`**

```ts
import type { DirectionsLang } from '@mapslibvn/core';
import type { Speaker } from '../navigation/session';
import { Speech } from './modules';

export interface ExpoSpeechOptions {
  /** 1 = tốc độ thường của hệ. */
  rate?: number;
  /** 0–1. */
  volume?: number;
  pitch?: number;
}

const BCP47: Readonly<Record<DirectionsLang, string>> = { vi: 'vi-VN', en: 'en-US' };

/**
 * `Speaker` trên expo-speech. Android xếp hàng (`QUEUE_ADD`) và iOS cũng xếp hàng, nên muốn cắt câu
 * phải `stop()` trước rồi mới `speak`. Theo dõi câu đang đọc bằng số thứ tự để callback của câu cũ
 * đến muộn không xoá nhầm ưu tiên câu mới.
 */
export function expoSpeech(opts: ExpoSpeechOptions = {}): Speaker {
  let rate = opts.rate;
  let volume = opts.volume;
  const pitch = opts.pitch;
  let current = 0; // ưu tiên câu đang đọc, 0 = im
  let seq = 0;

  const say = (text: string, priority: 1 | 2 | 3, lang: DirectionsLang): void => {
    seq += 1;
    const id = seq;
    current = Math.max(current, priority); // câu xếp hàng không hạ ưu tiên câu đang đọc
    const done = (): void => {
      if (seq === id) current = 0;
    };
    Speech.speak(text, {
      language: BCP47[lang],
      ...(rate !== undefined ? { rate } : {}),
      ...(volume !== undefined ? { volume } : {}),
      ...(pitch !== undefined ? { pitch } : {}),
      onDone: done,
      onStopped: done,
      onError: done,
    });
  };

  return {
    speak(text, priority, lang) {
      if (!text) return;
      if (current > 0 && priority >= current) {
        seq += 1; // vô hiệu callback của câu bị cắt
        void Speech.stop()
          .catch(() => {
            /* vẫn đọc */
          })
          .then(() => say(text, priority, lang));
        return;
      }
      say(text, priority, lang);
    },
    cancel() {
      seq += 1;
      current = 0;
      void Speech.stop().catch(() => {
        /* không có gì để dừng */
      });
    },
    async available(lang) {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        if (voices.length === 0) return true; // Android chưa khởi tạo TTS — không báo sai
        return voices.some((v) => v.language.toLowerCase().replace('_', '-').startsWith(lang));
      } catch {
        return true;
      }
    },
    setOptions(o) {
      if (o.rate !== undefined) rate = o.rate;
      if (o.volume !== undefined) volume = o.volume;
    },
  };
}
```

- [x] **Step 5: Viết `device.ts`**

```ts
import type { AudioSession, KeepAwake } from '../navigation/session';
import { Audio, KeepAwake as ExpoKeepAwake } from './modules';

/** Phiên âm thanh để giọng đọc phát khi khoá máy và làm nhỏ nhạc đang phát (spec C 6.3). */
export function expoAudioSession(): AudioSession {
  return {
    async activate() {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'duckOthers',
        });
      } catch {
        /* thiếu expo-audio native → vẫn dẫn đường, chỉ không phát khi nền */
      }
    },
    async deactivate() {
      try {
        await Audio.setAudioModeAsync({ shouldPlayInBackground: false, interruptionMode: 'mixWithOthers' });
      } catch {
        /* bỏ qua */
      }
    },
  };
}

export const KEEP_AWAKE_TAG = 'mapslibvn-navigation';

export function expoKeepAwake(): KeepAwake {
  return {
    async activate() {
      try {
        await ExpoKeepAwake.activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      } catch {
        /* bỏ qua */
      }
    },
    async deactivate() {
      try {
        await ExpoKeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG);
      } catch {
        /* bỏ qua */
      }
    },
  };
}
```

- [x] **Step 6: Viết `expo/index.ts`**

```ts
import type { NavigationSessionOptions } from '../navigation/session';
import { KEEP_AWAKE_TAG, expoAudioSession, expoKeepAwake } from './device';
import {
  type ExpoLocationSourceOptions,
  NAVIGATION_TASK,
  defineNavigationTask,
  expoLocationSource,
  toGeoFix,
} from './location-source';
import { type ExpoSpeechOptions, expoSpeech } from './speech';

export { NAVIGATION_TASK, defineNavigationTask, expoLocationSource, toGeoFix };
export type { ExpoLocationAccuracy, ExpoLocationSourceOptions } from './location-source';
export { expoSpeech };
export type { ExpoSpeechOptions } from './speech';
export { KEEP_AWAKE_TAG, expoAudioSession, expoKeepAwake };

export type ExpoNavigationOptions = ExpoLocationSourceOptions & { speech?: ExpoSpeechOptions };

/** Bộ adapter Expo mặc định cho `createNavigationSession({ provider, ...expoNavigation() })`. */
export function expoNavigation(
  opts: ExpoNavigationOptions = {},
): Required<Pick<NavigationSessionOptions, 'source' | 'speech' | 'audio' | 'keepAwake'>> {
  const { speech, ...location } = opts;
  return {
    source: expoLocationSource(location),
    speech: expoSpeech(speech ?? {}),
    audio: expoAudioSession(),
    keepAwake: expoKeepAwake(),
  };
}
```

- [x] **Step 7: Chạy xanh + typecheck + lint**

Run: `pnpm exec vitest run packages/react-native/src/expo && pnpm --filter @mapslibvn/react-native typecheck && pnpm lint`
Expected: PASS (location 11, speech 4, device 2).

- [x] **Step 8: Commit**

```bash
git add packages/react-native/src/expo
git commit -m "feat(react-native/expo): expoSpeech, expoAudioSession, expoKeepAwake, expoNavigation — entry /expo hoàn chỉnh

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Đóng gói — entry thứ hai, exports, peer tuỳ chọn, README, kiểm dist

**Files:**
- Modify: `packages/react-native/tsup.config.ts`
- Modify: `packages/react-native/package.json`
- Modify: `packages/react-native/src/index.ts`
- Modify: `packages/react-native/README.md`

- [x] **Step 1: tsup hai entry, external Expo**

Thay `packages/react-native/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

// Đóng gói @mapslibvn/core vào dist để app cài được bằng MỘT tarball (spec M6 4.1).
// Entry thứ hai `src/expo/index.ts` → dist/expo/index.js: chỗ duy nhất import Expo (external),
// Metro chỉ resolve khi app import '@mapslibvn/react-native/expo' (spec C 6.4).
export default defineConfig({
  entry: ['src/index.ts', 'src/expo/index.ts'],
  format: ['esm'],
  // `noExternal` gộp JS; `dts.resolve` gộp luôn .d.ts của core (core nằm ở devDependencies
  // để tarball KHÔNG đòi cài @mapslibvn/core chưa publish) — dist tự chứa cả code lẫn type.
  dts: { resolve: ['@mapslibvn/core'] },
  clean: true,
  target: 'es2020',
  external: [
    'react',
    'react/jsx-runtime',
    'react-native',
    '@maplibre/maplibre-react-native',
    'expo-location',
    'expo-task-manager',
    'expo-speech',
    'expo-audio',
    'expo-keep-awake',
  ],
  noExternal: ['@mapslibvn/core'],
});
```

- [x] **Step 2: `package.json`**

Sửa `packages/react-native/package.json`:

- `"version": "0.5.0"`.
- `"description": "React Native bindings MapsLibVN: <MapsLibVNMap>, <Marker>, useMap, usePlaces, dẫn đường (createNavigationSession, useNavigation; entry /expo cho định vị nền + TTS) — bọc @maplibre/maplibre-react-native"`.
- `exports` thêm:

```json
    "./expo": {
      "types": "./dist/expo/index.d.ts",
      "import": "./dist/expo/index.js",
      "default": "./dist/expo/index.js"
    }
```

- `peerDependencies` thêm (phiên bản tối thiểu = bản đi kèm Expo SDK 54, đã tra `bundledNativeModules.json` của `expo@54.0.0`; Expo 57 dùng số hợp nhất 57.x nên `>=` vẫn khớp):

```json
    "expo-audio": ">=1.0.10",
    "expo-keep-awake": ">=15.0.6",
    "expo-location": ">=19.0.6",
    "expo-speech": ">=14.0.6",
    "expo-task-manager": ">=14.0.6"
```

- thêm khối:

```json
  "peerDependenciesMeta": {
    "expo-audio": { "optional": true },
    "expo-keep-awake": { "optional": true },
    "expo-location": { "optional": true },
    "expo-speech": { "optional": true },
    "expo-task-manager": { "optional": true }
  },
```

- [x] **Step 3: `src/index.ts` xuất khẩu mới**

Thay toàn bộ `packages/react-native/src/index.ts`:

```ts
export { DEFAULT_CENTER, DEFAULT_ZOOM, MapsLibVNMap, useMap } from './map';
export type { MapsLibVNMapProps } from './map';
export { DEFAULT_MARKER_COLOR, Marker } from './marker';
export type { MarkerProps } from './marker';
export type { MapHandle } from './context';
export { usePlaces } from './use-places';
export type { UsePlacesOptions, UsePlacesResult } from './use-places';
export { useNavigation } from './use-navigation';
export type { UseNavigationResult } from './use-navigation';
export { COMPACT_ATTRIBUTION } from './attribution';
export { MISSING_SOURCE_MESSAGE, createNavigationSession } from './navigation/session';
export type {
  AudioSession,
  BackgroundUnavailable,
  KeepAwake,
  NavigationSession,
  NavigationSessionOptions,
  NavigationSessionStartOptions,
  SessionEvents,
  SessionPositionSource,
  Speaker,
} from './navigation/session';
export { FOLLOW_PITCH, FOLLOW_ZOOM } from './navigation/map-binding';
export type { BindingEvents, FollowOptions, MapNavigationBinding } from './navigation/map-binding';
export {
  ALT_ROUTE_COLOR,
  DESTINATION_COLOR,
  ROUTE_COLOR,
  ROUTE_LAYER_IDS,
  ROUTE_SOURCE_ID,
} from './navigation/route-layers';
export type { RouteStyle } from './navigation/route-layers';
export { playbackSource } from './navigation/playback-source';
export {
  NAVIGATION_THRESHOLDS,
  createClient,
  createNavigator,
  decodePolyline6,
  formatDistance,
  formatDistanceShort,
  simulateFixes,
} from '@mapslibvn/core';
export type {
  Announcement,
  AutocompleteItem,
  DirectionsLang,
  DirectionsOptions,
  DirectionsResponse,
  GeoFix,
  Lang,
  ManeuverKind,
  MapsLibVNClient,
  NavigationEvents,
  NavigationProgress,
  NavigationStatus,
  NavigationThresholds,
  Place,
  PoiFeature,
  PoiSource,
  PositionError,
  PositionSource,
  Route,
  RouteLeg,
  RouteProvider,
  RouteStep,
  Theme,
  TravelMode,
} from '@mapslibvn/core';
```

- [x] **Step 4: README gói — thêm mục dẫn đường** (chèn trước mục "Tài liệu:")

```markdown
## Dẫn đường (0.5.0)

```tsx
// index.ts — phạm vi toàn cục, trước registerRootComponent
import { defineNavigationTask } from '@mapslibvn/react-native/expo';
defineNavigationTask();
```

```tsx
import { MapsLibVNMap, createClient, createNavigationSession, useNavigation } from '@mapslibvn/react-native';
import { expoNavigation } from '@mapslibvn/react-native/expo';

const client = createClient({ apiKey, baseUrl: apiBase });
const session = createNavigationSession({ provider: client, ...expoNavigation() }); // sống ngoài cây React

const response = await client.directions({ from: [10.7798, 106.699], to: [10.7725, 106.698], mode: 'motorbike' });
await session.start({ response });            // GPS cả khi khoá máy, giọng Việt, tự tính lại khi lệch

<MapsLibVNMap {...props} navigation={session} />   // gắn để vẽ tuyến, puck, camera bám; unmount không dừng phiên
const { status, progress } = useNavigation(session); // dùng ở bất kỳ đâu
```

Cần `npx expo install expo-location expo-task-manager expo-speech expo-audio` và plugin trong
`app.json` (xem docs). App có luồng GPS riêng: truyền `source` của bạn thay `expoNavigation()`.
```

- [x] **Step 5: Build và kiểm dist**

Run:
```bash
pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/react-native build
ls packages/react-native/dist packages/react-native/dist/expo
grep -c "expo-" packages/react-native/dist/index.js
grep -o "from ['\"]expo-[a-z-]*['\"]" packages/react-native/dist/expo/index.js | sort -u
grep -E "^import.*expo-|from ['\"]expo-" packages/react-native/dist/expo/index.d.ts | wc -l
grep -c "createNavigationSession" packages/react-native/dist/index.d.ts
cd packages/react-native && pnpm pack --pack-destination /tmp && tar -tzf /tmp/mapslibvn-react-native-0.5.0.tgz | grep -E "dist/(expo/)?index" && cd ../..
```
Expected: `dist/expo/index.js` + `.d.ts` tồn tại; entry chính **0** lần nhắc `expo-`; entry expo import đúng 5 gói; `dist/expo/index.d.ts` **0** dòng import từ `expo-*` (không lộ kiểu Expo; nhắc trong comment doc thì được); `createNavigationSession` có trong `.d.ts`; tarball chứa cả hai entry.

- [x] **Step 6: Test + typecheck + lint toàn gói**

Run: `pnpm exec vitest run packages/react-native && pnpm --filter @mapslibvn/react-native typecheck && pnpm lint`
Expected: xanh.

- [x] **Step 7: Commit**

```bash
git add packages/react-native/tsup.config.ts packages/react-native/package.json packages/react-native/src/index.ts packages/react-native/README.md
git commit -m "feat(react-native): đóng gói 0.5.0 — entry /expo, peer Expo tuỳ chọn, xuất khẩu dẫn đường

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: `pnpm example:rn --device` (chạy máy thật)

**Files:**
- Modify: `scripts/lib/example-rn.mjs`
- Modify: `scripts/lib/example-rn.test.mjs`
- Modify: `scripts/example-rn.mjs`

- [x] **Step 1: Sửa test hiện có thành đỏ**

Trong `scripts/lib/example-rn.test.mjs`, đổi các kỳ vọng `parseArgs` và `expoRunArgs`:

```js
describe('parseArgs', () => {
  it('mặc định theo hệ điều hành; --ios/--android ghi đè', () => {
    expect(parseArgs([], 'darwin')).toEqual({ platform: 'ios', packOnly: false, device: false });
    expect(parseArgs([], 'linux')).toEqual({ platform: 'android', packOnly: false, device: false });
    expect(parseArgs(['--android'], 'darwin').platform).toBe('android');
    expect(parseArgs(['--ios'], 'linux').platform).toBe('ios');
  });
  it('--pack-only và --device', () => {
    expect(parseArgs(['--pack-only'], 'darwin')).toEqual({ platform: 'ios', packOnly: true, device: false });
    expect(parseArgs(['--device', '--android'], 'darwin')).toEqual({ platform: 'android', packOnly: false, device: true });
  });
  it('tham số lạ → ném lỗi nêu tên', () => {
    expect(() => parseArgs(['--web'], 'darwin')).toThrow(/--web/);
  });
});
```

(giữ nguyên tên `describe`/`it` sẵn có nếu khác; điều cốt lõi là ba kỳ vọng có `device`.)

```js
  it('expoRunArgs', () => {
    expect(expoRunArgs('ios')).toEqual(['expo', 'run:ios']);
    expect(expoRunArgs('android')).toEqual(['expo', 'run:android']);
    expect(expoRunArgs('ios', true)).toEqual(['expo', 'run:ios', '--device']);
  });
```

Run: `pnpm exec vitest run scripts/lib/example-rn.test.mjs` → Expected: FAIL (`device` thiếu, `--device` bị ném lỗi).

- [x] **Step 2: Sửa `scripts/lib/example-rn.mjs`**

```js
/**
 * @param {string[]} argv
 * @param {string} platform process.platform
 * @returns {{ platform: 'ios' | 'android', packOnly: boolean, device: boolean }}
 */
export function parseArgs(argv, platform) {
  /** @type {'ios' | 'android'} */
  let target = platform === 'darwin' ? 'ios' : 'android';
  let packOnly = false;
  let device = false;
  for (const a of argv) {
    if (a === '--ios') target = 'ios';
    else if (a === '--android') target = 'android';
    else if (a === '--pack-only') packOnly = true;
    else if (a === '--device') device = true;
    else if (a === '--key')
      break; // phần còn lại do resolveKey đọc
    else
      throw new Error(
        `Không hiểu tham số ${a}. Dùng: --ios | --android | --device | --pack-only | --key mlv_live_…`,
      );
  }
  return { platform: target, packOnly, device };
}

/** @param {'ios' | 'android'} platform @param {boolean} [device] chạy trên máy thật đang cắm */
export function expoRunArgs(platform, device = false) {
  return device ? ['expo', `run:${platform}`, '--device'] : ['expo', `run:${platform}`];
}
```

- [x] **Step 3: Nối vào `scripts/example-rn.mjs`**

- Dòng header usage thêm `//   pnpm example:rn --device           (máy thật đang cắm USB; iOS cần ký bằng Apple ID trong Xcode)`.
- `const { platform, packOnly, device } = parseArgs(argv, process.platform);`
- Dòng cuối: `run('npx', expoRunArgs(platform, device), { cwd: appDir, env: { ...process.env, ...extraEnv } });`
- Thông báo bước 5: `` console.log(`▶ 5/5 npx expo run:${platform}${device ? ' --device' : ''} (lần đầu prebuild + CocoaPods/Gradle, vài phút)`); ``

- [x] **Step 4: Test xanh + typecheck scripts**

Run: `pnpm exec vitest run scripts/lib/example-rn.test.mjs && tsc -p tsconfig.scripts.json`
Expected: PASS; typecheck sạch (checkJs cho `scripts/*.mjs`, xem memory "Bẫy typecheck M3").

- [x] **Step 5: Commit**

```bash
git add scripts/lib/example-rn.mjs scripts/lib/example-rn.test.mjs scripts/example-rn.mjs
git commit -m "chore(scripts): pnpm example:rn --device chạy app thử trên máy thật

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: App thử — cài Expo modules, plugin, `defineNavigationTask`, prebuild lại

**Files:**
- Modify: `examples/embed-rn/package.json` (qua `npx expo install`)
- Modify: `examples/embed-rn/app.json`
- Modify: `examples/embed-rn/index.ts`
- Modify: `examples/embed-rn/README.md`

- [x] **Step 1: Cài module (từ thư mục app, dùng npm — app ngoài workspace)**

Run:
```bash
cd examples/embed-rn && npx expo install expo-location expo-task-manager expo-speech expo-audio && cd ../..
node -e "const p=require('./examples/embed-rn/package.json');for(const k of ['expo-location','expo-task-manager','expo-speech','expo-audio'])console.log(k,p.dependencies[k])"
```
Expected: bốn dòng in phiên bản `~57.0.x`.

- [x] **Step 2: `app.json` plugin**

Thay khối `"plugins"`:

```json
    "plugins": [
      "@maplibre/maplibre-react-native",
      [
        "expo-location",
        {
          "isIosBackgroundLocationEnabled": true,
          "isAndroidForegroundServiceEnabled": true,
          "locationWhenInUsePermission": "MapsLibVN Demo dùng vị trí của bạn để dẫn đường."
        }
      ],
      "expo-audio"
    ]
```

(`expo-audio` mặc định `enableBackgroundPlayback: true` → thêm `UIBackgroundModes: audio`; **không** bật
`isAndroidBackgroundLocationEnabled`.)

- [x] **Step 3: `index.ts`**

```ts
import { defineNavigationTask } from '@mapslibvn/react-native/expo';
import { registerRootComponent } from 'expo';

import App from './App';

// Bắt buộc ở phạm vi toàn cục, trước khi đăng ký root: expo-task-manager giao vị trí nền cho SDK
// (spec C 6.1). Thiếu dòng này thì SDK rơi về tiền cảnh và báo backgroundUnavailable(task_not_defined).
defineNavigationTask();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(App);
```

- [x] **Step 4: README app thử — thêm đoạn**

Sau đoạn "Yêu cầu máy", thêm:

```markdown
## Dẫn đường (spec C)

App có màn dẫn đường đủ luồng (điểm đến → phương tiện → Bắt đầu / Giả lập). Định vị nền cần plugin
trong `app.json` (đã có) và **prebuild lại** sau khi đổi plugin: `npx expo prebuild --clean` trong
thư mục này (xoá `ios/`, `android/` rồi sinh lại — đều gitignore).

Máy thật: `pnpm example:rn --device --android` (bật USB debugging) hoặc `pnpm example:rn --device`
(iPhone: mở `ios/MapsLibVNDemo.xcworkspace` một lần, Signing & Capabilities → Team = Apple ID cá
nhân; trên máy: Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị → tin cậy nhà phát triển).
```

- [x] **Step 5: Prebuild lại và xác nhận cấu hình native**

Run:
```bash
cd examples/embed-rn && npx expo prebuild --clean && cd ../..
grep -c "UIBackgroundModes" examples/embed-rn/ios/MapsLibVNDemo/Info.plist
grep -A3 "UIBackgroundModes" examples/embed-rn/ios/MapsLibVNDemo/Info.plist | grep -E "location|audio"
grep -E "FOREGROUND_SERVICE|ACCESS_BACKGROUND_LOCATION|ACCESS_FINE_LOCATION" examples/embed-rn/android/app/src/main/AndroidManifest.xml
```
Expected: Info.plist có `location` **và** `audio`; manifest có `ACCESS_FINE_LOCATION`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_LOCATION`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`; **không** có `ACCESS_BACKGROUND_LOCATION`.

- [x] **Step 6: Commit** (chỉ file trong git — `ios/`, `android/`, `node_modules/` gitignore)

```bash
git add examples/embed-rn/package.json examples/embed-rn/package-lock.json examples/embed-rn/app.json examples/embed-rn/index.ts examples/embed-rn/README.md
git commit -m "chore(embed-rn): cài expo-location/task-manager/speech/audio, plugin nền, defineNavigationTask

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: App thử — màn dẫn đường đủ luồng

**Files:**
- Create: `examples/embed-rn/navigation-ui.tsx`
- Modify: `examples/embed-rn/App.tsx`

- [x] **Step 1: Bảng điều khiển dẫn đường (ngoài `<MapsLibVNMap>`, dùng `useNavigation(session)`)**

`examples/embed-rn/navigation-ui.tsx`:

```tsx
import {
  type MapHandle,
  type NavigationSession,
  type TravelMode,
  formatDistanceShort,
  useNavigation,
} from '@mapslibvn/react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export const MODES: { mode: TravelMode; label: string }[] = [
  { mode: 'car', label: 'Ô tô' },
  { mode: 'motorbike', label: 'Xe máy' },
  { mode: 'walk', label: 'Đi bộ' },
];

/** Số liệu để điền evidence thực địa (spec C mục 13 tiêu chí 5). */
interface Diag {
  fixes: number;
  accuracy: number | null;
  reroutes: number;
  background: 'chưa rõ' | 'nền' | 'tiền cảnh';
  voice: string;
}

export function NavigationPanel({
  session,
  map,
  onStop,
}: {
  session: NavigationSession;
  map: MapHandle | null;
  onStop: () => void;
}) {
  const { status, progress, following } = useNavigation(session);
  const [diag, setDiag] = useState<Diag>({
    fixes: 0,
    accuracy: null,
    reroutes: 0,
    background: 'chưa rõ',
    voice: 'chưa rõ',
  });

  useEffect(() => {
    const onProgress = (p: { fix: { accuracy_m?: number } }) =>
      setDiag((d) => ({ ...d, fixes: d.fixes + 1, accuracy: p.fix.accuracy_m ?? null }));
    const onReroute = () => setDiag((d) => ({ ...d, reroutes: d.reroutes + 1 }));
    const onBg = (e: { reason: string }) =>
      setDiag((d) => ({ ...d, background: 'tiền cảnh', voice: `${d.voice} · nền: ${e.reason}` }));
    const onVoice = () => setDiag((d) => ({ ...d, voice: 'không có giọng' }));
    const onRoute = () => setDiag((d) => ({ ...d, background: 'nền', fixes: 0 }));
    session.on('progress', onProgress);
    session.on('reroute', onReroute);
    session.on('backgroundUnavailable', onBg);
    session.on('voiceUnavailable', onVoice);
    session.on('route', onRoute);
    return () => {
      session.off('progress', onProgress);
      session.off('reroute', onReroute);
      session.off('backgroundUnavailable', onBg);
      session.off('voiceUnavailable', onVoice);
      session.off('route', onRoute);
    };
  }, [session]);

  if (status === 'idle' || !progress) return null;
  const next = progress.nextStep ?? progress.step;
  const minutes = Math.max(1, Math.round(progress.remaining_s / 60));
  return (
    <>
      <View style={styles.banner}>
        <Text style={styles.instruction} numberOfLines={2}>
          {status === 'arrived' ? 'Đã đến nơi' : next.instruction}
        </Text>
        <Text style={styles.distance}>
          {status === 'off_route' || status === 'rerouting'
            ? 'Lệch tuyến, đang tính lại…'
            : formatDistanceShort(progress.distanceToStep_m)}
        </Text>
      </View>
      <View style={styles.bottom}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eta}>
            {minutes} phút · {formatDistanceShort(progress.remaining_m)} · {status}
          </Text>
          <Text style={styles.diag}>
            fix {diag.fixes} · sai số {diag.accuracy === null ? '—' : `${Math.round(diag.accuracy)} m`} ·{' '}
            {diag.background} · tính lại {diag.reroutes} · giọng {diag.voice}
          </Text>
        </View>
        {!following && map ? (
          <Pressable style={styles.btn} onPress={() => map.navigation.recenter()}>
            <Text style={styles.btnText}>Về vị trí</Text>
          </Pressable>
        ) : null}
        <Pressable style={[styles.btn, styles.stop]} onPress={onStop}>
          <Text style={[styles.btnText, { color: '#fff' }]}>Dừng</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 56,
    left: 12,
    right: 12,
    backgroundColor: '#1b3a6b',
    borderRadius: 12,
    padding: 14,
  },
  instruction: { color: '#fff', fontSize: 20, fontWeight: '700' },
  distance: { color: '#cfe0ff', fontSize: 16, marginTop: 4 },
  bottom: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    elevation: 3,
  },
  eta: { fontSize: 16, fontWeight: '600' },
  diag: { fontSize: 11, color: '#666', marginTop: 2 },
  btn: { backgroundColor: '#eef2f8', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  stop: { backgroundColor: '#d92d20' },
  btnText: { fontWeight: '600' },
});
```

- [x] **Step 2: `App.tsx` — thêm điểm đến, chip phương tiện, tuyến, Bắt đầu / Giả lập**

Thay toàn bộ `examples/embed-rn/App.tsx`:

```tsx
import {
  type AutocompleteItem,
  type DirectionsResponse,
  type Lang,
  type MapHandle,
  type MapsLibVNClient,
  MapsLibVNMap,
  Marker,
  type NavigationSession,
  type Theme,
  type TravelMode,
  createClient,
  createNavigationSession,
  playbackSource,
  simulateFixes,
  usePlaces,
} from '@mapslibvn/react-native';
import { expoKeepAwake, expoNavigation, expoSpeech } from '@mapslibvn/react-native/expo';
import * as Application from 'expo-application';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  LogBox,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MODES, NavigationPanel } from './navigation-ui';

const API_KEY = process.env.EXPO_PUBLIC_MAPSLIBVN_KEY ?? '';
const API_BASE = process.env.EXPO_PUBLIC_MAPSLIBVN_API ?? 'https://api.ai-solutions.io.vn';
const BUNDLE_ID = Application.applicationId ?? undefined;

// Cảnh báo của MapLibre Native về vài đoạn line trong tile (dữ liệu, không phải code app).
LogBox.ignoreLogs(['Invalid geometry in line layer']);

// Client và phiên GPS thật sống ở cấp module: đổi màn hình, popup đè lên bản đồ không dừng dẫn đường.
const client: MapsLibVNClient = createClient({
  apiKey: API_KEY,
  baseUrl: API_BASE,
  ...(BUNDLE_ID ? { headers: { 'X-Bundle-Id': BUNDLE_ID } } : {}),
});
const realSession = createNavigationSession({
  provider: client,
  ...expoNavigation({ notification: { title: 'MapsLibVN Demo đang dẫn đường' } }),
});

type Point = { name: string; lng: number; lat: number };

/** Ô tìm kiếm + gợi ý — nằm ngoài <MapsLibVNMap> nên truyền client tường minh. */
function Search({ near, onPick }: { near: [number, number]; onPick: (p: Point) => void }) {
  const [q, setQ] = useState('');
  const { items, loading } = usePlaces(q, { near, limit: 6, client });
  return (
    <View style={styles.search}>
      <TextInput
        style={styles.input}
        placeholder="Điểm đến: tên đường, địa điểm…"
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
        testID="search-input"
      />
      {q.trim().length >= 2 && (
        <FlatList
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          data={items}
          keyExtractor={(it: AutocompleteItem, i) => it.id ?? `${it.type}-${i}`}
          ListEmptyComponent={
            <Text style={styles.hint}>{loading ? 'Đang tìm…' : 'Không có gợi ý'}</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                setQ('');
                onPick({ name: item.name, lng: item.lng, lat: item.lat });
              }}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.secondary}>{item.secondary}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>('light');
  const [lang, setLang] = useState<Lang>('vi');
  const [map, setMap] = useState<MapHandle | null>(null);
  const [origin, setOrigin] = useState<[number, number] | null>(null); // [lng, lat]
  const [dest, setDest] = useState<Point | null>(null);
  const [mode, setMode] = useState<TravelMode>('motorbike');
  const [response, setResponse] = useState<DirectionsResponse | null>(null);
  const [active, setActive] = useState(0);
  const [session, setSession] = useState<NavigationSession>(realSession);
  const [navigating, setNavigating] = useState(false);

  // Vị trí hiện tại lúc mở app → bay tới; xin quyền một lần ở đây, SDK dùng lại khi start().
  useEffect(() => {
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      const p = await Location.getCurrentPositionAsync({});
      setOrigin([p.coords.longitude, p.coords.latitude]);
    })().catch(() => {});
  }, []);
  useEffect(() => {
    if (map && origin) map.flyTo(origin, 15);
  }, [map, origin]);

  // Đủ hai điểm → tự tính tuyến; đổi phương tiện hay điểm đến → tính lại.
  useEffect(() => {
    if (!origin || !dest || navigating) return;
    let cancelled = false;
    client
      .directions({
        from: [origin[1], origin[0]],
        to: [dest.lat, dest.lng],
        mode,
        alternatives: true,
      })
      .then((r) => {
        if (cancelled) return;
        setResponse(r);
        setActive(0);
        map?.routes.show(r, { active: 0 });
        const bbox = r.routes[0]?.bbox;
        if (bbox) map?.fitBounds(bbox, 60);
      })
      .catch((e: unknown) => Alert.alert('Không tính được tuyến', e instanceof Error ? e.message : ''));
    return () => {
      cancelled = true;
    };
  }, [origin, dest, mode, map, navigating]);

  const start = useCallback(
    async (kind: 'real' | 'sim') => {
      if (!response) return;
      const route = response.routes[active];
      if (!route) return;
      const s =
        kind === 'real'
          ? realSession
          : createNavigationSession({
              provider: client,
              source: playbackSource(simulateFixes(route, { jitter_m: 4 }), { rate: 4 }),
              speech: expoSpeech(),
              keepAwake: expoKeepAwake(),
            });
      if (s !== session) await session.stop();
      setSession(s);
      setNavigating(true);
      await s.start({ response, routeIndex: active, lang });
    },
    [response, active, session, lang],
  );
  const stop = useCallback(async () => {
    await session.stop();
    setNavigating(false);
  }, [session]);

  if (!API_KEY) {
    return (
      <View style={styles.center}>
        <Text>Thiếu EXPO_PUBLIC_MAPSLIBVN_KEY — chạy `pnpm example:rn` từ gốc repo.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <MapsLibVNMap
        apiKey={API_KEY}
        apiBase={API_BASE}
        style={theme}
        lang={lang}
        {...(BUNDLE_ID ? { bundleId: BUNDLE_ID } : {})}
        navigation={session}
        onLoad={setMap}
        onRouteClick={(i) => {
          setActive(i);
          map?.routes.setActive(i);
        }}
        onPoiClick={(poi) => setDest({ name: poi.name, lng: poi.lngLat[0], lat: poi.lngLat[1] })}
        onError={(e) => Alert.alert('Lỗi bản đồ', e.message)}
        testID="map"
      >
        {dest && !response && <Marker lng={dest.lng} lat={dest.lat} color="#e53935" />}
      </MapsLibVNMap>

      {!navigating && (
        <>
          <Search near={origin ? [origin[1], origin[0]] : [10.776, 106.7]} onPick={setDest} />
          {dest && (
            <View style={styles.card}>
              <Text style={styles.name} numberOfLines={1}>
                → {dest.name}
              </Text>
              <View style={styles.chips}>
                {MODES.map((m) => (
                  <Pressable
                    key={m.mode}
                    style={[styles.chip, mode === m.mode && styles.chipOn]}
                    onPress={() => setMode(m.mode)}
                  >
                    <Text style={mode === m.mode ? styles.chipTextOn : styles.chipText}>{m.label}</Text>
                  </Pressable>
                ))}
              </View>
              {response ? (
                <>
                  <Text style={styles.secondary}>
                    {response.routes.map((r, i) => `${i === active ? '● ' : '○ '}${Math.round(r.duration_s / 60)} phút · ${(r.distance_m / 1000).toFixed(1)} km`).join('   ')}
                  </Text>
                  <View style={styles.chips}>
                    <Pressable style={[styles.btn, styles.primary]} onPress={() => void start('real')}>
                      <Text style={[styles.btnText, { color: '#fff' }]}>Bắt đầu</Text>
                    </Pressable>
                    <Pressable style={styles.btn} onPress={() => void start('sim')}>
                      <Text style={styles.btnText}>Giả lập</Text>
                    </Pressable>
                    <Pressable
                      style={styles.btn}
                      onPress={() => {
                        setDest(null);
                        setResponse(null);
                        map?.routes.clear();
                      }}
                    >
                      <Text style={styles.btnText}>Xoá</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Text style={styles.hint}>{origin ? 'Đang tính tuyến…' : 'Chờ vị trí GPS…'}</Text>
              )}
            </View>
          )}
          <View style={styles.toolbar}>
            <Pressable style={styles.btn} onPress={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              <Text style={styles.btnText}>{theme === 'light' ? 'Tối' : 'Sáng'}</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => setLang(lang === 'vi' ? 'en' : 'vi')}>
              <Text style={styles.btnText}>{lang === 'vi' ? 'EN' : 'VI'}</Text>
            </Pressable>
          </View>
        </>
      )}

      {navigating && <NavigationPanel session={session} map={map} onStop={() => void stop()} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  search: { position: 'absolute', top: 56, left: 12, right: 12 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  list: { backgroundColor: '#fff', borderRadius: 8, marginTop: 6, maxHeight: 280 },
  row: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  name: { fontSize: 15, fontWeight: '600' },
  secondary: { fontSize: 12, color: '#666' },
  hint: { padding: 12, color: '#666' },
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 32,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    elevation: 3,
  },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#eef2f8' },
  chipOn: { backgroundColor: '#2458a6' },
  chipText: { fontWeight: '600', color: '#1b3a6b' },
  chipTextOn: { fontWeight: '600', color: '#fff' },
  toolbar: { position: 'absolute', right: 12, top: 120, gap: 8 },
  btn: { backgroundColor: '#eef2f8', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  primary: { backgroundColor: '#2458a6' },
  btnText: { fontWeight: '600' },
});
```

- [x] **Step 3: Lint + đóng gói + cài vào app + kiểm kiểu trong app**

Run:
```bash
pnpm lint
pnpm example:rn --pack-only
cd examples/embed-rn && npx tsc --noEmit -p tsconfig.json && cd ../..
```
Expected: lint xanh; tarball 0.5.0 cài vào app; `tsc` của app sạch (app đọc kiểu từ `dist/index.d.ts` và
`dist/expo/index.d.ts` — đây là chỗ bắt lỗi "kiểu Expo lộ ra ngoài" nếu Task 12 Step 5 sót).

- [x] **Step 4: Commit**

```bash
git add examples/embed-rn/App.tsx examples/embed-rn/navigation-ui.tsx
git commit -m "feat(embed-rn): màn dẫn đường đủ luồng — điểm đến, chip phương tiện, tuyến thay thế, Bắt đầu/Giả lập, banner + số liệu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Chạy simulator/emulator và kiểm sớm hai rủi ro trên máy thật

Không có test tự động; ghi kết quả vào `docs/evidence/navigation/<ngày>-rn-phat-hanh.md` (tạo ở
bước này, hoàn thiện ở Task 19). Task này **chặn** Task 17–19 nếu rủi ro 1 hoặc 2 buộc đổi thiết kế.

- [x] **Step 1: iOS simulator — giả lập**

Run: `pnpm example:rn` (iOS). Trong app: chọn điểm đến bằng ô tìm (ví dụ "chợ bến thành"), chip Xe máy →
thấy tuyến; bấm **Giả lập**.
Expected: puck mũi tên chạy dọc tuyến, phần đã đi mờ, camera xoay theo hướng, banner đổi câu, simulator
phát giọng (bật âm thanh Mac); kết thúc "Đã đến nơi". Dòng chẩn đoán hiện `fix N`. Chụp màn hình
`docs/evidence/navigation/rn-ios-sim-giả-lập.png`.

**Kiểm rủi ro 2 (data URI cho `Images`)**: nếu puck **không hiện** (chỉ có tuyến), ghi lại và chuyển sang
dự phòng của spec mục 7: trong `route-layers.tsx` thay layer symbol bằng `<Marker>` với `View` tam giác
xoay `bearing − bearing_bản_đồ` (bearing bản đồ đọc từ `onRegionIsChanging` → store). Mở việc đó thành
Task 16b trong plan này trước khi tiếp tục.

- [x] **Step 2: Android emulator — giả lập**

Run: `pnpm example:rn --android`. Lặp lại Step 1. Expected như trên; chụp `rn-android-emu-giả-lập.png`.

- [x] **Step 3: iPhone thật — kiểm rủi ro 1 (giọng đọc khi khoá máy) NGAY, bằng Giả lập**

Run: `pnpm example:rn --device` (ký theo README app thử). Trong app bấm **Giả lập** rồi **khoá màn hình**
ngay, chờ ≥ 60 giây.
Expected: vẫn nghe câu rẽ khi máy khoá (giả lập không cần GPS nên tách riêng được rủi ro TTS). Nếu **im**:
thử lần lượt (a) mở lại app xem dòng chẩn đoán có `giọng không có giọng` không (khác vấn đề); (b) áp dự
phòng (a) của spec mục 11 — `expo-audio` phát một `AudioPlayer` im lặng lặp trong `expoAudioSession().activate()`;
(c) nếu vẫn im, ghi giới hạn "iOS chỉ đọc khi màn hình sáng" vào docs + nghiệm thu 4 ĐẠT MỘT PHẦN.
Ghi kết quả (đạt / dự phòng nào) vào evidence.

- [ ] **Step 4: Android thật — thông báo foreground service**

Run: `pnpm example:rn --device --android`. Bấm **Bắt đầu** (GPS thật, đứng yên cũng được) → kéo thanh
thông báo.
Expected: thông báo "MapsLibVN Demo đang dẫn đường / Chạm để mở ứng dụng"; dòng chẩn đoán hiện `nền`;
bấm **Dừng** → thông báo biến mất. Nếu dòng chẩn đoán hiện `tiền cảnh · nền: <reason>` → đọc `reason`:
`not_configured` = prebuild chưa chạy lại (Task 14 Step 5); `task_not_defined` = `index.ts` chưa gọi.

- [x] **Step 5: Ghi evidence tạm và commit**

Tạo `docs/evidence/navigation/<ngày>-rn-phat-hanh.md` với mục "Kiểm sớm trên máy" (bốn dòng kết quả
trên, tên máy, hệ điều hành) — các mục còn lại điền ở Task 19.

```bash
git add docs/evidence/navigation/
git commit -m "docs(evidence): spec C kiểm sớm simulator + máy thật — puck data URI, TTS iOS khi khoá máy, foreground service Android

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Docs — trang `dan-duong-react-native`, sidebar, link check, link chéo

**Files:**
- Create: `apps/docs/src/content/docs/dan-duong-react-native.md`
- Modify: `apps/docs/astro.config.mjs`, `apps/docs/e2e/docs.spec.ts`
- Modify: `apps/docs/src/content/docs/react-native.md`, `dan-duong.md`, `tinh-nang.md`

- [x] **Step 1: Trang mới**

`apps/docs/src/content/docs/dan-duong-react-native.md`:

```markdown
---
title: Dẫn đường trên React Native
description: Phiên dẫn đường độc lập với màn hình bản đồ, định vị cả khi khoá máy, giọng Việt bằng TTS native — @mapslibvn/react-native 0.5.
---

Trang này dành cho `@mapslibvn/react-native` (0.5 trở lên). Logic dẫn đường giống hệt web (cùng
máy trạng thái trong `@mapslibvn/core`, xem [Dẫn đường](/dan-duong/)); khác ở hai điểm: **phiên dẫn
đường sống ngoài cây React** (popup đè lên bản đồ hay unmount bản đồ không dừng dẫn đường) và **định
vị tiếp tục khi khoá máy hoặc chuyển app**.

## 1. Yêu cầu và cài đặt

Ngoài yêu cầu của [React Native](/react-native/) mục 1, dẫn đường cần năm module Expo (app bare chạy
`npx install-expo-modules@latest` trước):

```bash
npx expo install expo-location expo-task-manager expo-speech expo-audio expo-keep-awake
```

Bản đồ và tìm kiếm **không** cần các module này; chỉ khi bạn import
`@mapslibvn/react-native/expo` Metro mới resolve chúng.

## 2. Cấu hình `app.json` và `index.ts`

```json
"plugins": [
  "@maplibre/maplibre-react-native",
  ["expo-location", {
    "isIosBackgroundLocationEnabled": true,
    "isAndroidForegroundServiceEnabled": true,
    "locationWhenInUsePermission": "Ứng dụng dùng vị trí của bạn để dẫn đường."
  }],
  "expo-audio"
]
```

Plugin thêm `UIBackgroundModes: location` + `audio` (iOS) và quyền `FOREGROUND_SERVICE_LOCATION`
(Android). **Không** bật `isAndroidBackgroundLocationEnabled`: SDK không xin quyền "Luôn luôn", vì cả
hai hệ đều cho tiếp tục định vị khi phiên khởi động lúc app đang mở. Đổi plugin xong chạy
`npx expo prebuild --clean` rồi build lại.

```ts
// index.ts — PHẢI ở phạm vi toàn cục, trước registerRootComponent (yêu cầu của expo-task-manager)
import { defineNavigationTask } from '@mapslibvn/react-native/expo';
import { registerRootComponent } from 'expo';
import App from './App';

defineNavigationTask();
registerRootComponent(App);
```

## 3. Ba bước

```tsx
import { MapsLibVNMap, createClient, createNavigationSession } from '@mapslibvn/react-native';
import { expoNavigation } from '@mapslibvn/react-native/expo';

// Tạo ở cấp module: phiên sống qua đổi màn hình, popup, unmount bản đồ.
const client = createClient({ apiKey: 'mlv_live_…', baseUrl: 'https://api.ai-solutions.io.vn' });
const session = createNavigationSession({ provider: client, ...expoNavigation() });

// 1. Tính tuyến (tham số [lat, lng]; response dùng [lng, lat])
const response = await client.directions({ from: [10.7798, 106.699], to: [10.7725, 106.698], mode: 'motorbike' });

// 2. Dẫn đường — gọi khi người dùng bấm nút, lúc app đang mở (Android không cho khởi động
//    foreground service từ nền). Hộp thoại quyền vị trí hiện ở đây nếu chưa cấp.
await session.start({ response });

// 3. Gắn bản đồ vào phiên để vẽ tuyến, puck, camera bám. Gỡ prop hoặc unmount → phiên vẫn chạy.
<MapsLibVNMap apiKey="…" apiBase="…" navigation={session} />
```

`session.stop()` dừng GPS, giọng, giữ màn hình sáng; tuyến còn trên bản đồ tới khi
`useMap().routes.clear()`. Đến nơi thì phiên tự nhả GPS và phát `end { reason: 'arrived' }`.

App nhỏ không muốn tự cầm phiên: bỏ prop `navigation`, truyền `sessionOptions={expoNavigation()}` và
gọi `useMap().navigation.start({ response })` — API giống `map.navigation` của web.

## 4. Vẽ UI từ sự kiện

SDK không có banner sẵn. Hook `useNavigation(session)` dùng được **ở bất kỳ đâu**, không cần nằm
trong `<MapsLibVNMap>`:

```tsx
import { formatDistanceShort, useNavigation } from '@mapslibvn/react-native';

function Banner() {
  const { status, progress, following, stop } = useNavigation(session);
  if (status === 'idle' || !progress) return null;
  const next = progress.nextStep ?? progress.step;
  return (
    <View>
      <Text>{status === 'arrived' ? 'Đã đến nơi' : next.instruction}</Text>
      <Text>{formatDistanceShort(progress.distanceToStep_m)} · còn {Math.round(progress.remaining_s / 60)} phút</Text>
      <Button title="Dừng" onPress={() => void stop()} />
    </View>
  );
}
```

Sự kiện trên phiên: mọi sự kiện core (`progress`, `step`, `announce`, `offRoute`, `reroute`,
`arrive`…) cộng `route` (tuyến đổi), `positionError`, `voiceUnavailable`, `backgroundUnavailable`,
`end`. Trên map: `useMap().navigation.on('followChange', …)` và `recenter()` để bật lại bám camera
sau khi người dùng kéo bản đồ.

Tuỳ biến bản đồ: `follow={{ zoom: 17, pitch: 60 }}` hoặc `follow={false}`; `puck={false}` để tự vẽ
từ `progress.snapped`; `routeStyle={{ color: '#0a7', altColor: '#999' }}`; `onRouteClick` để đổi
tuyến thay thế (`useMap().routes.setActive(i)` rồi `session.start({ response, routeIndex: i })`).

## 5. Nền và quyền — điều gì xảy ra

| Tình huống | SDK làm gì |
|---|---|
| App cấu hình đủ (mục 2) | `startLocationUpdatesAsync` + task: GPS và câu đọc tiếp tục khi khoá máy. iOS hiện chỉ báo vị trí nền màu xanh; Android hiện thông báo "Đang dẫn đường" (đổi chữ bằng `expoNavigation({ notification: { title, body } })`) |
| Thiếu `defineNavigationTask()` | rơi về tiền cảnh, phát `backgroundUnavailable { reason: 'task_not_defined' }` |
| Thiếu plugin / `UIBackgroundModes` | rơi về tiền cảnh, `reason: 'not_configured'` |
| Người dùng từ chối vị trí | `positionError { code: 'denied' }`; phiên vẫn `navigating` chờ, không có fix |
| App bị giết rồi iOS đánh thức lại | task tự dừng vì không còn phiên nào nghe |

Một thiết bị chỉ có một task nền: phiên thứ hai bật nền khi phiên đầu còn chạy sẽ dùng chung task —
hãy `stop()` phiên cũ trước.

## 6. Giọng đọc và âm thanh

`expoSpeech()` đọc bằng giọng hệ thống (`vi-VN`; iOS có sẵn, Android tuỳ gói TTS đã cài — thiếu
thì `voiceUnavailable`). `expoAudioSession()` bật phát khi máy im lặng và khi nền, làm nhỏ nhạc đang
phát (`duckOthers`). App có cấu hình âm thanh riêng: bỏ `audio` khỏi phiên. Tắt giọng cho một lượt:
`start({ response, voice: false })`; đổi tốc độ: `voice: { rate: 1.1 }`.

## 7. Tự cắm nguồn vị trí riêng

App đã có luồng GPS (báo vị trí tài xế về máy chủ) hoặc app khách muốn hiện tiến độ tài xế từ feed
máy chủ: đừng chạy hai luồng GPS — bơm fix của bạn vào phiên.

```ts
import type { GeoFix, PositionSource } from '@mapslibvn/react-native';

const fromMyFeed: PositionSource = {
  subscribe(onFix, onError) {
    const off = myFeed.on('position', (p) =>
      onFix({ lng: p.lng, lat: p.lat, accuracy_m: p.acc, heading: p.heading ?? null, speed_mps: p.speed ?? null, timestamp: p.ts }),
    );
    myFeed.on('error', (e) => onError?.({ code: 'unavailable', message: String(e) }));
    return off;
  },
};
const session = createNavigationSession({ provider: client, source: fromMyFeed, speech: expoSpeech() });
```

`timestamp` là nguồn thời gian duy nhất của máy trạng thái — phải tăng dần. Không cần Expo location
cho đường này; muốn không đọc gì thì bỏ `speech`.

## 8. Thử không cần ra đường

```ts
import { createNavigationSession, playbackSource, simulateFixes } from '@mapslibvn/react-native';
import { expoSpeech } from '@mapslibvn/react-native/expo';

const sim = createNavigationSession({
  provider: client,
  source: playbackSource(simulateFixes(response.routes[0], { jitter_m: 4 }), { rate: 4 }),
  speech: expoSpeech(),
});
await sim.start({ response });
```

App thử `examples/embed-rn` trong repo có nút "Giả lập" làm đúng việc này và hiện số fix, sai số,
số lần tính lại để ghi evidence.

## 9. Khác với web

| Web | React Native |
|---|---|
| `map.navigation.start()` đồng bộ | `session.start()` trả Promise (chờ quyền, đăng ký task) |
| Phiên gắn với map | Phiên độc lập, `navigation={session}`; một phiên gắn nhiều map |
| `follow` là tuỳ chọn của `start()` | `follow` là prop của map — mỗi map tự quyết |
| Wake Lock, không có nền | Keep-awake khi app mở; **có nền** qua expo-location + task |
| `speechSynthesis` | expo-speech; iOS cần expo-audio để phát khi khoá máy |

## 10. Giới hạn hiện tại

- Nội dung thông báo foreground service Android cố định từ lúc `start()` (không đổi theo câu rẽ).
- Chưa có config plugin riêng của MapsLibVN — cấu hình theo mục 2.
- Chưa ETA theo giao thông, làn đường, map-matching máy chủ, tiles offline (giống web).
- Gói chưa publish npm — cài từ tarball như [React Native](/react-native/) mục 6.

Đọc thêm: [Dẫn đường (web)](/dan-duong/), [React Native](/react-native/), [REST API — directions](/api/#get-v1directions).
```

- [x] **Step 2: Sidebar, link check, link chéo**

- `apps/docs/astro.config.mjs`: trong nhóm "Hướng dẫn", sau `{ label: 'Dẫn đường', slug: 'dan-duong' },`
  thêm `{ label: 'Dẫn đường React Native', slug: 'dan-duong-react-native' },`.
- `apps/docs/e2e/docs.spec.ts`: thêm `'/dan-duong-react-native/',` ngay sau `'/dan-duong/',`.
- `react-native.md` mục 6 "Giới hạn hiện tại": thêm dòng đầu
  `- Dẫn đường (định vị nền, giọng Việt) từ 0.5: xem [Dẫn đường trên React Native](/dan-duong-react-native/).`
  và mục 4 bảng thêm hàng `| \`map.navigation\` gắn với map | \`createNavigationSession()\` độc lập, \`navigation={session}\` — xem [Dẫn đường React Native](/dan-duong-react-native/) |`.
- `dan-duong.md` mục 7, dòng "Không dẫn đường nền trên web…": đổi câu cuối thành
  `Dẫn đường nền có ở SDK React Native: [Dẫn đường trên React Native](/dan-duong-react-native/).`
  và mục 5 câu "Đây cũng là phần React Native sẽ dùng lại." → "Đây cũng là phần React Native dùng lại (xem [Dẫn đường trên React Native](/dan-duong-react-native/))."
- `tinh-nang.md` mục 5 "Chỉ đường": thêm câu
  `SDK React Native dẫn đường cả khi khoá máy, phiên độc lập với màn hình bản đồ — [Dẫn đường trên React Native](/dan-duong-react-native/).`

- [x] **Step 3: Build docs và chạy link check**

Run:
```bash
pnpm --filter @mapslibvn/docs build
pnpm --filter @mapslibvn/docs e2e -- docs.spec.ts
```
Expected: build xanh; `docs.spec.ts` xanh cho mọi trang kể cả `/dan-duong-react-native/` (E2E cần
`apps/api dev:e2e` như các lần trước — xem `apps/docs/package.json` script `e2e`).

- [x] **Step 4: Commit**

```bash
git add apps/docs/src/content/docs/dan-duong-react-native.md apps/docs/astro.config.mjs apps/docs/e2e/docs.spec.ts apps/docs/src/content/docs/react-native.md apps/docs/src/content/docs/dan-duong.md apps/docs/src/content/docs/tinh-nang.md
git commit -m "docs: trang Dẫn đường trên React Native — cấu hình nền, phiên, hook, cắm nguồn riêng, giới hạn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: THIRD_PARTY_NOTICES, spec B mục 10, ghi lệch spec C

**Files:**
- Modify: `THIRD_PARTY_NOTICES.md` (+ 4 bản sao qua `pnpm notices:sync`)
- Modify: `docs/superpowers/specs/2026-09-12-dan-duong-core-web-design.md` (mục 10)
- Modify: `docs/superpowers/specs/2026-09-12-dan-duong-react-native-design.md`

- [x] **Step 1: Notices — bảng mục 1 và nguyên văn 4.9**

Trong `THIRD_PARTY_NOTICES.md`:

- Dòng `Cập nhật: 04/09/2026.` → ngày hôm nay.
- Bảng mục 1 thêm sau hàng `react, react-native`:

```markdown
| expo-location, expo-task-manager | 57.0.15 (peer **tuỳ chọn**, chỉ entry `@mapslibvn/react-native/expo`) | MIT | định vị tiền cảnh và nền cho dẫn đường |
| expo-speech, expo-audio, expo-keep-awake | 57.0.2 / 57.0.4 / 57.0.1 (peer **tuỳ chọn**, chỉ entry `@mapslibvn/react-native/expo`) | MIT | đọc câu chỉ dẫn, phiên âm thanh khi nền, giữ màn hình sáng |
```

- Thêm mục `### 4.9 Các gói Expo (expo-location, expo-task-manager, expo-speech, expo-audio, expo-keep-awake) — MIT`
  ngay sau 4.8, nguyên văn từ file `LICENSE` của các gói (giống nhau):

````markdown
### 4.9 expo-location, expo-task-manager, expo-speech, expo-audio, expo-keep-awake — MIT

```
The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Các gói này là peer dependency **tuỳ chọn**: chỉ app import `@mapslibvn/react-native/expo` (dẫn
đường) mới cài; SDK không đóng gói mã của chúng.
````

Run: `pnpm notices:sync && node scripts/notices-sync.mjs --check`
Expected: `đã đồng bộ 8 file (4 thay đổi)` rồi `✓ notices trong 4 gói SDK khớp gốc`.

- [x] **Step 2: Spec B mục 10 — sửa tên và trỏ sang spec C**

Trong `2026-09-12-dan-duong-core-web-design.md` mục 10, gạch đầu dòng "Spec C" đổi thành:

```markdown
- **Spec C (React Native)** — đã viết `2026-09-12-dan-duong-react-native-design.md`: dùng nguyên
  `createNavigator`, `NAVIGATION_THRESHOLDS`, `Announcement`; `PositionSource` từ `expo-location` (cả
  nền, qua `expo-task-manager`), đọc `announce` bằng `expo-speech`, vẽ tuyến bằng
  `GeoJSONSource`/`Layer` của maplibre-react-native 11 (tên `ShapeSource`/`LineLayer` ở bản trước là
  của v10). Core chỉ thêm hàm thuần `routeFeatures()` (chuyển từ `routes-layer.ts` web).
```

- [x] **Step 3: Ghi lệch spec C (mục "Lệch khi thực thi", thêm trước mục 11 của spec C)**

```markdown
## 10b. Lệch khi thực thi (plan `2026-09-12-dan-duong-react-native.md`)

| Mục spec | Spec viết | Thực tế | Lý do |
|---|---|---|---|
| 7 | Puck SDF + `icon-color` | PNG **màu sẵn** (xanh viền trắng), không SDF | SDF một ảnh không có viền trắng; `routeStyle.color` không đổi màu puck |
| 5.2 | `Speaker` 3 hàm | thêm `setOptions?({ rate, volume })` | để `start({ voice: { rate } })` có tác dụng |
| 5.2, 5.4 | map vẽ theo `progress`/`reroute` | thêm sự kiện `route { response, routeIndex }` phát ở `start()`, `setRoute()`, tính lại xong | map gắn vào cần biết tuyến mới ngay lúc `start()` |
| 5.3 | "phiên vẫn ở navigating chờ fix" | phiên tự phát `status navigating` lúc `start()` và `idle` lúc `stop()`; lọc `stopped` và idle→navigating của core | core chỉ đổi status ở fix đầu |
| 6.4 | devDependencies expo 57.x để typecheck | **không** cài Expo vào workspace; kiểu ambient `src/expo/expo-modules.d.ts` | quyết định M6 giữ Expo ngoài workspace |
| 6.1 | `isBackgroundLocationAvailableAsync()` là điều kiện | vẫn gọi, nhưng lỗi → coi là có; quyết định cuối do `startLocationUpdatesAsync` ném hay không | hàm này chỉ đọc `providerStatus.backgroundModeEnabled` |
```

- [x] **Step 4: Commit**

```bash
git add THIRD_PARTY_NOTICES.md packages/*/THIRD_PARTY_NOTICES.md docs/superpowers/specs/2026-09-12-dan-duong-core-web-design.md docs/superpowers/specs/2026-09-12-dan-duong-react-native-design.md
git commit -m "docs: notices năm gói Expo (peer tuỳ chọn), spec B mục 10 trỏ spec C, ghi lệch spec C

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: Cổng local, evidence phát hành, DEVLOG, trạng thái

**Files:**
- Modify: `docs/evidence/navigation/<ngày>-rn-phat-hanh.md` (tạo ở Task 16)
- Modify: `docs/DEVLOG.md`
- Create: `docs/evidence/navigation/<ngày>-rn-thuc-dia.md` (mẫu để PHONG điền ở Task 20)

- [x] **Step 1: Cổng local (Actions đang khoá)**

Run lần lượt, ghi kết quả vào evidence:
```bash
pnpm lint
pnpm typecheck
pnpm test
node scripts/notices-sync.mjs --check
pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e -- docs.spec.ts
pnpm example:rn --pack-only && ls -la examples/embed-rn/vendor/
```
Expected: tất cả xanh; ghi số test/file của `pnpm test` (gốc và apps/api), kích cỡ tarball trước
(0.4.0, lấy từ evidence M6 nếu có) và sau.

- [x] **Step 2: Hoàn thiện evidence phát hành**

`docs/evidence/navigation/<ngày>-rn-phat-hanh.md` — cấu trúc:

```markdown
# Phát hành spec C — SDK React Native dẫn đường (Task 19)

Ngày: <ngày>. Commit: <sha>.

## Kiểm sớm trên máy (Task 16)
| Hạng mục | Máy | Kết quả |
|---|---|---|
| Puck data URI hiện | iOS sim / Android emu | … |
| TTS iOS khi khoá máy (giả lập) | iPhone … iOS … | … (đạt / dự phòng a / giới hạn) |
| Foreground service Android | … Android … | … |

## Cổng local
| Lệnh | Kết quả |
|---|---|
| pnpm lint | … |
| pnpm typecheck | … |
| pnpm test | gốc … test / … file; apps/api … |
| notices-sync --check | … |
| docs build + docs.spec.ts | … |

## Kích cỡ
| | 0.4.0 | 0.5.0 |
|---|---|---|
| tarball @mapslibvn/react-native | … | … |
| dist/index.js | … | … |
| dist/expo/index.js | — | … |
| core dist/index.js gzip | 16,91 kB | … (trần 20 kB) |
```

- [x] **Step 3: Mẫu evidence thực địa cho PHONG điền**

`docs/evidence/navigation/<ngày>-rn-thuc-dia.md`:

```markdown
# Thực địa dẫn đường React Native — spec C mục 13 tiêu chí 3–5

Người thực hiện: PHONG. Cách lấy số: dòng chẩn đoán dưới thanh ETA trong app thử (fix, sai số,
nền/tiền cảnh, tính lại); giờ theo đồng hồ điện thoại; pin đọc ở Cài đặt trước và sau.

## Android thật
| Hạng mục | Kết quả |
|---|---|
| Máy, Android, build | |
| Tuyến (từ → đến, phương tiện, km, số chỗ rẽ ≥ 3) | |
| Số fix lúc đến nơi / sai số điển hình (m) | |
| Câu đọc đúng chỗ / tổng câu | |
| Cố ý lệch: giây từ lệch tới có tuyến mới | |
| Khoá màn hình liên tục lâu nhất mà vẫn nghe câu (phút) | |
| Thông báo foreground service hiện / biến mất khi Dừng | |
| `arrived` có báo không | |
| Pin trước → sau (%) và thời gian | |
| Số lần rơi về tiền cảnh (`backgroundUnavailable`) | |
| Ghi chú | |

## iPhone thật
| Hạng mục | Kết quả |
|---|---|
| Máy, iOS, build | |
| Tuyến | |
| Số fix / sai số | |
| Câu đọc đúng chỗ / tổng | |
| Giây lệch → tuyến mới | |
| Khoá màn hình lâu nhất vẫn nghe câu (phút) | |
| Chỉ báo vị trí nền màu xanh hiện | |
| Hộp thoại quyền chỉ hỏi "Khi dùng ứng dụng" | |
| `arrived` | |
| Pin trước → sau | |
| Số lần rơi về tiền cảnh | |
| Ghi chú | |

## Ngưỡng cần chỉnh
(để trống nếu giữ nguyên `NAVIGATION_THRESHOLDS`)
```

- [x] **Step 4: DEVLOG mục 1 và mục 2**

Thêm đầu mục "1. Trạng thái hiện tại" một gạch đầu dòng ngày phát hành, tóm tắt: phiên độc lập,
entry `/expo`, nền một đường + rơi về tiền cảnh, core `routeFeatures`, app thử đủ luồng, số test,
kích cỡ, kết quả kiểm sớm Task 16, và "**Còn lại:** thực địa PHONG (Task 20) → nghiệm thu mục 13".
Sửa câu "**Bắt đầu tiếp:** spec C…" của mục 12/09 cũ thành "(đã làm — xem mục ngày <ngày>)".
Mục "2. Bước kế tiếp": thay dòng spec C bằng "Thực địa spec C hai máy; sau đó cân nhắc spec D
(tenant đầu tiên) hoặc publish npm (B3)".

- [x] **Step 5: Commit**

```bash
git add docs/evidence/navigation/ docs/DEVLOG.md
git commit -m "docs: cổng local + evidence phát hành spec C, mẫu thực địa, DEVLOG

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 20: Thực địa hai máy (PHONG) và nghiệm thu spec C

Việc tay của PHONG; Fable hỗ trợ đọc số và ghi. Không code.

- [ ] **Step 1: Android** — `pnpm example:rn --device --android`. Tuyến ≥ 1 km, ≥ 3 chỗ rẽ; bấm Bắt đầu;
      giữa chừng **khoá màn hình ≥ 2 phút**, bỏ túi; cố ý rẽ nhầm rồi đi tiếp ≥ 30 m; đi tới đích. Điền
      bảng Android trong `…-rn-thuc-dia.md`.
- [ ] **Step 2: iPhone** — `pnpm example:rn --device`. Cùng kịch bản; để ý chỉ báo xanh và hộp thoại quyền.
      Điền bảng iPhone.
- [ ] **Step 3: Nghiệm thu mục 13** — Fable điền bảng 7 tiêu chí vào spec C (mục "Kết quả nghiệm thu")
      và DEVLOG mục 13 "Nghiệm thu spec C", ĐẠT / ĐẠT MỘT PHẦN kèm lý do như spec B. Tiêu chí 7 (app gọi
      xe giả định) chứng bằng test `session.test.ts` "phiên tối giản" + `map-navigation.test.tsx` "unmount
      không stop phiên" + mục 7 docs (≤ 20 dòng).
- [ ] **Step 4: Ngưỡng** — nếu số đo cho thấy `NAVIGATION_THRESHOLDS` sai (ví dụ `arrive_m` walk 15 m quá
      chặt với sai số 20 m), sửa trong `packages/core/src/navigation/types.ts`, cập nhật test core liên
      quan, ghi DEVLOG mục 3 "Quyết định phát sinh".
- [ ] **Step 5: Commit**

```bash
git add docs/evidence/navigation/ docs/DEVLOG.md docs/superpowers/specs/2026-09-12-dan-duong-react-native-design.md
git commit -m "docs: nghiệm thu spec C — thực địa Android + iPhone có số đo, bảng 7 tiêu chí

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Tự rà soát plan (đã chạy khi viết)

- **Phủ spec:** 1.2 (gói RN: T5–T9, T12; entry expo: T10–T11; core: T1–T2; web: T3; app thử: T13–T15;
  docs: T17; notices/evidence/DEVLOG: T18–T19; spec B mục 10: T18) · 4 (`routeFeatures`,
  `FIRST_SYMBOL_LAYER_ID`, test style: T1–T2) · 5.1–5.4 (T5, T7, T8, T9) · 6.1–6.4 (T10–T12) · 7 (T7,
  rủi ro data URI kiểm ở T16) · 8 (mỗi test nằm trong task tương ứng; mock T7/T8) · 9 (T14–T15,
  `--device` T13) · 10 (T17, T12 README, T18 notices) · 11 (rủi ro 1–2 kiểm T16; task ma T10; peer
  T12; ký iOS README T14) · 13 (T19 tiêu chí 1–2, 6; T20 tiêu chí 3–5, 7).
- **Placeholder:** không có TBD/TODO; mọi bước có code hoặc lệnh; các chỗ "nếu … thì …" đều nêu cách
  xử lý cụ thể.
- **Nhất quán kiểu:** `SessionPositionSource.setMode/onBackgroundUnavailable` (T5) ↔ dùng ở T10;
  `SessionEvents.route` (T5) ↔ binding nghe `route` (T8) ↔ fake-session phát `route` (T8/T9);
  `Speaker.setOptions?` (T5) ↔ `expoSpeech.setOptions` (T11); `RouteProgressCut.bearing` (T1) ↔
  `store.setProgress({ …, bearing })` (T8); `MapNavigationBinding` (T8) ↔ `MapHandle.navigation`
  (T8 context) ↔ `useNavigation` (T9); `ROUTE_LAYER_IDS.puck` (T7) ↔ test T8; `FOLLOW_ZOOM` T8 ↔
  index T12; `MISSING_SOURCE_MESSAGE` T5 ↔ T8 test ↔ T12 index; `createClient` tái xuất T12 ↔ App.tsx T15.
