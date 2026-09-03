# M6 — `@mapslibvn/react-native` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gói `@mapslibvn/react-native` (bọc `@maplibre/maplibre-react-native` 11.3+, API bám `@mapslibvn/react`), một app Expo thử độc lập `examples/embed-rn` mở bằng `pnpm example:rn`, trang docs "React Native", khoá `mobile` cho tenant thử nghiệm — nghiệm thu chạy thật trên simulator iOS và emulator Android theo spec `docs/superpowers/specs/2026-09-03-react-native-sdk-design.md` mục 7.

**Architecture:** Không thêm endpoint API, không thêm biến thể style: MapLibre Native đọc `pmtiles://https://…` ở tầng native nên `/v1/styles/{light|dark}.json` dùng nguyên. Ba nhóm việc: (1) **core dùng chung** — `ClientOptions.headers`, kiểu `PoiFeature`, hàm biến đổi style JSON thuần (`localizeStyle`, `hidePoiLayer`) chuyển vào `@mapslibvn/core`, web import lại; (2) **gói RN** `packages/react-native` — `<MapsLibVNMap>` (Map + Camera của wrapper), `<Marker>`, `useMap()`, `usePlaces()`, attribution bắt buộc, test Vitest với hai module native được mock; đóng gói core vào dist bằng tsup `noExternal`; (3) **app thử + docs + nghiệm thu** — dự án Expo ngoài pnpm workspace cài SDK bằng tarball qua `scripts/example-rn.mjs`, trang docs Starlight, bằng chứng ảnh chụp trong `docs/evidence/m6/`, DEVLOG mục 11.

**Tech Stack:** TypeScript 5 / Node 22 / pnpm 9 / Turborepo / Biome / Vitest 2 (jsdom, `@testing-library/react` 16, React 19 riêng trong gói) / tsup 8; `@maplibre/maplibre-react-native` ^11.3.8 (MapLibre Native Android 13.2.0, iOS 6.26.0; React ≥ 19.1, RN ≥ 0.80, New Architecture); Expo SDK 57 (`create-expo-app`, `expo-application`, config plugin của wrapper); Astro Starlight; Playwright (link check docs).

**Nguồn sự thật:** spec M6 `docs/superpowers/specs/2026-09-03-react-native-sdk-design.md` (mục 2 tiền đề, 3 kiến trúc, 4 gói, 5 app thử, 6 docs, 7 nghiệm thu); spec gốc `2026-08-26-mapslibvn-maps-sdk-design.md` mục 6.4 (khoá `mobile`, `X-Bundle-Id`), 7.3 (API `@mapslibvn/react`), 12.3 (attribution bắt buộc); roadmap `2026-08-26-roadmap-toan-bo-spec.md` mục 0 (quy tắc bất biến, git identity cá nhân, DEVLOG).

**Nghiệm thu M6 (spec M6 mục 7):**
1. `pnpm example:rn --ios` và `--android` chạy trọn: bản đồ VN nhãn tiếng Việt, tiles đọc thẳng từ `tiles.ai-solutions.io.vn` (không có request `/v1/tiles/*`), theme light/dark, `lang=en` đổi nhãn nhưng Hoàng Sa/Trường Sa vẫn tiếng Việt.
2. Gõ "highlands" → gợi ý ≤ 1 s; chọn → `flyTo` + marker.
3. Bấm POI → `onPoiClick` trả tên/loại đúng.
4. Attribution MapsLibVN hiện, bấm mở hộp thoại native; không có prop tắt.
5. Request từ app có trong Analytics với khoá `mobile`; log Worker có `X-Bundle-Id=vn.mapslibvn.demo`.
6. CI xanh: lint, typecheck, vitest, build 4 gói, `notices --check` 4 gói; docs deploy + link check.
7. Trang docs `react-native` hiển thị trên `mapslibvn-docs.pages.dev`.

---

## Bối cảnh — cái gì đã có sẵn (KHÔNG làm lại)

- **`@mapslibvn/core`** (`packages/core/src`): `createClient({apiKey, baseUrl, fetch?})` gửi `X-Api-Key` trong `get`/`post` (`client.ts`), `styleUrl(theme)`; `attributionText()`/`attributionHtml()` (`attribution.ts`); kiểu Places trong `types.ts`; `index.ts` `export *` từ 6 file. Test Vitest cạnh file (`client.test.ts` dùng `okFetch` giả). `size-limit` 8 kB gzip (`.size-limit.json`). tsconfig `lib: ["ES2022","DOM"]`, `noEmit`.
- **`@mapslibvn/web`** (`packages/web/src`): `map.ts` định nghĩa `PoiFeature`, `createMap` (mặc định center `[106.7, 10.776]`, zoom 12, `queryRenderedFeatures(..., {layers:['poi']})`, properties `id/name/cat/grp`); `language.ts` có `nameExpression(lang)` + `applyLanguage(gl, lang)` (bỏ qua `sovereignty-label`, chỉ symbol có `text-field` chứa `name`); `index.ts` và `umd.ts` re-export `PoiFeature`, `applyLanguage`, `nameExpression`, `Lang`.
- **`@mapslibvn/react`** (`packages/react/src`): `context.ts`, `map.tsx` (props `style` = theme, `containerStyle`, handlers trong `useRef`), `marker.tsx`, `use-places.ts` + `use-places.test.ts` (`// @vitest-environment jsdom`, `renderHook` từ `@testing-library/react`, fake timers). **tsup của gói này để `@mapslibvn/core`/`web` external** (dist import `'@mapslibvn/web'`) — gói RN phải khác: `noExternal`.
- **Wrapper `@maplibre/maplibre-react-native` 11.3.8** (đã đọc `.d.ts` từ tarball): `Map` (props `mapStyle: string | StyleSpecification`, `attribution?`, `attributionPosition?: {bottom, right}…`, `logo?`, `onPress?: (e: NativeSyntheticEvent<PressEvent>) => void` với `nativeEvent.point: [x, y]` và `nativeEvent.lngLat: [lng, lat]`, `onDidFinishLoadingStyle`, `onDidFailLoadingMap`, `ref?: Ref<MapRef>`); `MapRef` có `queryRenderedFeatures(point, {layers})`, `getBounds(): Promise<[w,s,e,n]>`, `showAttribution()`, `setSourceVisibility`; `Camera` (props `initialViewState?: {center, zoom}`, `ref?: Ref<CameraRef>`); `CameraRef` có `flyTo({center, zoom?})`, `fitBounds(bounds, {padding?: {top,right,bottom,left}})`; `Marker` (props `lngLat`, `anchor?`, `onPress?`, **`children: ReactElement` bắt buộc**). React 19: `ref` là prop thường của function component. Peer: `react >=19.1.0`, `react-native >=0.80.0`, `@types/geojson` (optional), `expo >=54.0.0` (optional).
- **Scripts**: `scripts/lib/example-serve.mjs` có `resolveKey(argv, env)` đọc `KEY_EXAMPLE_EMBED` (regex `^mlv_live_[0-9A-Za-z]{24}$`); `scripts/lib/run.mjs` có `run(cmd, args, opts)` (throw khi exit ≠ 0); `scripts/lib/notices.mjs` có `SDK_PACKAGES` 3 gói + test; pattern main script: `#!/usr/bin/env node` + `import 'dotenv/config'`. `tsconfig.scripts.json` bật `checkJs`.
- **Tenant thử nghiệm** `nhung_thu` UUID `00000000-0000-4000-8000-000000000002` (seed `db/seed/tenant_nhung_thu.sql`); `pnpm key:issue --tenant … --label … --kind mobile` (kind `mobile` không cần `--origins`).
- **Docs**: sidebar trong `apps/docs/astro.config.mjs`; trang `bat-dau.md` có 3 mục (script / npm / tuỳ chọn); `index.mdx` splash; link check `apps/docs/e2e/docs.spec.ts` mảng `PAGES`.
- **CI** `ci.yml`: `pnpm lint` → `node scripts/notices-sync.mjs --check` → `pnpm typecheck` (`tsc -p tsconfig.scripts.json` + turbo) → `pnpm test` (build core + vitest root + build admin + test api). Vitest root include `packages/*/src/**/*.test.{ts,mjs}` — file `.tsx` **chưa** nằm trong include (Task 6 thêm).
- **Không có trong repo**: `packages/react-native`, `examples/embed-rn`, `docs/evidence/m6`, `KEY_EXAMPLE_RN`.

## Quyết định thiết kế (chốt khi viết plan — ghi vào DEVLOG mục 3 ở Task 15)

1. Gói RN dùng `tsup.config.ts` (không CLI) để `noExternal: ['@mapslibvn/core']`; external `react`, `react/jsx-runtime`, `react-native`, `@maplibre/maplibre-react-native`. Spec 4.1 đã sửa câu "giống @mapslibvn/react".
2. Test component RN chạy trong jsdom bằng `@testing-library/react` (React 19) với `vi.mock('react-native')` và `vi.mock('@maplibre/maplibre-react-native')` trỏ tới hai file mock trong `packages/react-native/src/test/`. Không dùng `react-test-renderer` (React 19 đã bỏ) hay Jest preset RN.
3. Vitest root thêm `packages/*/src/**/*.test.tsx` vào include.
4. `resolveKey` của `example-serve.mjs` nhận tham số thứ ba `{ envName, hint }` để `example-rn` dùng lại (không copy).
5. App thử tạo bằng `npx create-expo-app@latest --template blank-typescript` (Expo SDK 57 tại 03/09/2026) rồi `npx expo install` wrapper và `expo-application`; không ghim tay phiên bản RN/React trong plan — lấy từ template.
6. `npm install ./vendor/mapslibvn-react-native.tgz` chạy **mỗi lần** `example:rn` để npm không giữ tarball cũ cùng tên.
7. `Marker` mặc định: View tròn 22 pt viền trắng, `anchor` mặc định `center`.
8. `onLoad` gọi một lần cho mỗi lần tạo map (theo `key` của `<Map>`), guard bằng `useRef`.

## Cây file

```
packages/core/src/client.ts                 (M) ClientOptions.headers
packages/core/src/client.test.ts            (M) 2 case headers
packages/core/src/types.ts                  (M) + PoiFeature
packages/core/src/style-transform.ts        (C) Lang, nameExpression, isNameLabelLayer, localizeStyle, hidePoiLayer
packages/core/src/style-transform.test.ts   (C)
packages/core/src/index.ts                  (M) export style-transform
packages/web/src/map.ts                     (M) PoiFeature import từ core
packages/web/src/language.ts                (M) import nameExpression/isNameLabelLayer từ core
packages/react-native/package.json          (C)
packages/react-native/tsconfig.json         (C)
packages/react-native/tsup.config.ts        (C)
packages/react-native/README.md             (C)
packages/react-native/src/index.ts          (C)
packages/react-native/src/context.ts        (C) MapHandle, MapContext
packages/react-native/src/to-poi-feature.ts (C) + .test.ts
packages/react-native/src/use-places.ts     (C) + .test.ts (copy từ react)
packages/react-native/src/attribution.tsx   (C) + .test.tsx
packages/react-native/src/use-style.ts      (C) + .test.ts
packages/react-native/src/map.tsx           (C) + .test.tsx   MapsLibVNMap, useMap
packages/react-native/src/marker.tsx        (C) + .test.tsx
packages/react-native/src/test/react-native-mock.tsx  (C)
packages/react-native/src/test/mlrn-mock.tsx          (C)
scripts/lib/notices.mjs (+test)             (M) 4 gói
scripts/lib/example-serve.mjs (+test)       (M) resolveKey(argv, env, opts)
scripts/lib/example-rn.mjs                  (C) + .test.mjs
scripts/example-rn.mjs                      (C)
package.json                                (M) script example:rn
vitest.config.ts                            (M) include .test.tsx
.env.example                                (M) KEY_EXAMPLE_RN
examples/embed-rn/{package.json,app.json,App.tsx,index.ts,tsconfig.json,.gitignore,README.md,assets/} (C)
apps/docs/src/content/docs/react-native.md  (C)
apps/docs/src/content/docs/bat-dau.md       (M) mục 4
apps/docs/src/content/docs/index.mdx        (M) một Card
apps/docs/astro.config.mjs                  (M) sidebar
apps/docs/e2e/docs.spec.ts                  (M) PAGES
docs/evidence/m6/*.png                      (C) Task 14
docs/DEVLOG.md                              (M) mỗi task; mục 11 ở Task 15
docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md (M) bảng 13 hàng M6 (Task 15)
docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md      (M) mục 7 (Task 15)
```

Quy tắc bất biến: kết thúc mỗi task = tick checkbox plan + cập nhật DEVLOG mục 1–2 + dòng mục 4 + commit (Conventional Commits tiếng Việt). Không commit khi test đỏ. Git identity cá nhân (`pnpm check:git`). Lệnh chạy từ gốc repo.

**Bẫy typecheck (memory `m3-plan-ky-thuat`)**: `exactOptionalPropertyTypes` bật — không truyền `prop={maybeUndefined}` vào prop optional; dùng spread có điều kiện `{...(x !== undefined ? { x } : {})}`. `noUncheckedIndexedAccess` — `arr[0]` là `T | undefined`. Scripts `.mjs` có `checkJs`: khai báo JSDoc `@param`/`@returns`.

---

### Task 0: Kiểm tra trạng thái trước khi bắt đầu

**Files:** không sửa mã.

- [x] **Step 1: Git sạch, đúng nhánh, đúng identity**

Run: `git status --short && git branch --show-current && pnpm check:git`
Expected: không có dòng thay đổi; `main`; check:git OK.

- [x] **Step 2: CI remote của commit đầu `main` xanh**

Run: `GH_TOKEN="$(cat ~/.config/gh-dotienphong.token)" gh run list --repo dotienphong/maps-library-vietnam --limit 6`
Expected: CI / Deploy Docs của commit `4689249` (hoặc mới hơn) `completed success`.

- [x] **Step 3: Gate local xanh trước khi đụng core**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: exit 0. Ghi số test hiện có (để Task 15 so sánh).

- [x] **Step 4: Công cụ mobile trên máy dev (việc tay PHONG, spec M6 mục 9)**

Run: `xcodebuild -version && xcrun simctl list devices available | head -5 && ls "$HOME/Library/Android/sdk" && node -e "console.log(process.version)"`
Expected: Xcode có; ≥ 1 simulator iOS; thư mục Android SDK có; Node 22. Nếu thiếu → dừng, báo PHONG cài (Xcode từ App Store; Android Studio + một AVD API ≥ 23). Task 1–12 không phụ thuộc bước này; Task 13–14 cần.

- [x] **Step 5: Ghi DEVLOG mục 2 và commit**

Thêm vào đầu mục 2 `docs/DEVLOG.md`:

```markdown
**Đang làm M6** — plan `docs/superpowers/plans/2026-09-03-m6-react-native.md`, bắt đầu Task 1.
Kết quả Task 0 (<ngày>): git sạch; CI `4689249` xanh; gate local <N> test xanh; Xcode <có|thiếu>, Android SDK <có|thiếu>.
```

```bash
git add docs/DEVLOG.md docs/superpowers/plans/2026-09-03-m6-react-native.md
git commit -m "docs: plan M6 react-native + kiểm tra trạng thái trước M6"
```

---

### Task 1: `ClientOptions.headers` trong `@mapslibvn/core`

**Files:**
- Modify: `packages/core/src/client.ts`
- Test: `packages/core/src/client.test.ts`

- [x] **Step 1: Viết test thất bại (RED)**

Thêm vào cuối `describe('createClient', …)` trong `packages/core/src/client.test.ts`:

```ts
  it('gộp headers tuỳ chọn vào mọi request (X-Bundle-Id cho khoá mobile)', async () => {
    const fetch = okFetch({ items: [] });
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.example.test',
      headers: { 'X-Bundle-Id': 'vn.mapslibvn.demo' },
      fetch,
    });
    await client.autocomplete('cafe');
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Bundle-Id']).toBe('vn.mapslibvn.demo');
    expect(headers['X-Api-Key']).toBe('mlv_live_abc');
  });

  it('headers tuỳ chọn không ghi đè được X-Api-Key', async () => {
    const fetch = okFetch({ edit_id: 'e1', status: 'pending' });
    const client = createClient({
      apiKey: 'mlv_live_abc',
      baseUrl: 'https://api.example.test',
      headers: { 'X-Api-Key': 'gia-mao' },
      fetch,
    });
    await client.suggestEdit({
      kind: 'update',
      poi_id: 'p1',
      changes: {},
      end_user_token: 'u1',
    } as never);
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('mlv_live_abc');
    expect(headers['content-type']).toBe('application/json');
  });
```

- [x] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/src/client.test.ts`
Expected: FAIL — `headers['X-Bundle-Id']` là `undefined` (TypeScript cũng báo `headers` không có trong `ClientOptions`).

- [x] **Step 3: Sửa `client.ts`**

Trong `packages/core/src/client.ts`, thêm vào `ClientOptions`:

```ts
  /**
   * Header thêm cho mọi request, ví dụ `X-Bundle-Id` cho khoá `mobile` (spec 6.4).
   * Không ghi đè được `X-Api-Key`.
   */
  headers?: Record<string, string>;
```

Trong `createClient`, ngay sau `const doFetch = …`:

```ts
  const baseHeaders = (): Record<string, string> => ({
    ...(options.headers ?? {}),
    'X-Api-Key': options.apiKey,
  });
```

Đổi `get`: `headers: { 'X-Api-Key': options.apiKey }` → `headers: baseHeaders()`.
Đổi `post`: `headers: { 'X-Api-Key': options.apiKey, 'content-type': 'application/json' }` → `headers: { ...baseHeaders(), 'content-type': 'application/json' }`.

- [x] **Step 4: Chạy test, xác nhận xanh + size-limit**

Run: `pnpm exec vitest run packages/core/src/client.test.ts && pnpm --filter @mapslibvn/core build`
Expected: PASS toàn file; `size-limit` in `dist/index.js` dưới 8 kB.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/client.ts packages/core/src/client.test.ts
git commit -m "feat(core): ClientOptions.headers — gửi X-Bundle-Id cho khoá mobile, không ghi đè X-Api-Key"
```

---

### Task 2: Chuyển `PoiFeature` vào core

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/web/src/map.ts`

- [x] **Step 1: Thêm kiểu vào core**

Cuối `packages/core/src/types.ts`:

```ts
/** POI đọc từ tile lớp `poi` khi người dùng bấm — SDK web và React Native dùng chung. */
export interface PoiFeature {
  id: string;
  name: string;
  category: string;
  group: string;
  lngLat: [number, number];
}
```

- [x] **Step 2: Web dùng kiểu từ core**

Trong `packages/web/src/map.ts`: xoá khối `export interface PoiFeature { … }` (5 trường); đổi dòng import đầu file thành:

```ts
import {
  type MapsLibVNClient,
  type PoiFeature,
  type Theme,
  attributionHtml,
  createClient,
} from '@mapslibvn/core';
export type { PoiFeature };
```

(`index.ts` và `umd.ts` vẫn `export type { PoiFeature } from './map'` — không đổi.)

- [x] **Step 3: Typecheck + test web**

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web typecheck && pnpm exec vitest run packages/web`
Expected: exit 0, test web xanh như trước.

- [x] **Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/web/src/map.ts
git commit -m "refactor(core): PoiFeature chuyển vào @mapslibvn/core, web re-export"
```

---

### Task 3: Hàm biến đổi style JSON thuần trong core; web dùng lại

**Files:**
- Create: `packages/core/src/style-transform.ts`, `packages/core/src/style-transform.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/web/src/language.ts`

- [ ] **Step 1: Viết test thất bại (RED)**

`packages/core/src/style-transform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  hidePoiLayer,
  isNameLabelLayer,
  localizeStyle,
  nameExpression,
} from './style-transform';

const style = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'city',
      type: 'symbol',
      layout: { 'text-field': ['coalesce', ['get', 'name:vi'], ['get', 'name']], 'text-size': 12 },
    },
    { id: 'hn', type: 'symbol', layout: { 'text-field': '{housenumber}' } },
    { id: 'sovereignty-label', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
    { id: 'water', type: 'fill' },
    { id: 'poi', type: 'symbol', layout: { 'text-field': ['get', 'name'], 'icon-image': 'x' } },
  ],
};

describe('nameExpression', () => {
  it('vi → coalesce name:vi, name; en → coalesce name:en, name', () => {
    expect(nameExpression('vi')).toEqual(['coalesce', ['get', 'name:vi'], ['get', 'name']]);
    expect(nameExpression('en')).toEqual(['coalesce', ['get', 'name:en'], ['get', 'name']]);
  });
});

describe('isNameLabelLayer', () => {
  it('chỉ symbol có text-field tham chiếu name, trừ lớp chủ quyền', () => {
    const [city, hn, sov, water, poi] = style.layers;
    expect(isNameLabelLayer(city!)).toBe(true);
    expect(isNameLabelLayer(hn!)).toBe(false);
    expect(isNameLabelLayer(sov!)).toBe(false);
    expect(isNameLabelLayer(water!)).toBe(false);
    expect(isNameLabelLayer(poi!)).toBe(true);
  });
});

describe('localizeStyle', () => {
  it('en: đổi text-field của city và poi, giữ text-size, không đụng hn/sovereignty/water', () => {
    const out = localizeStyle(style, 'en');
    expect(out.layers[0]?.layout).toEqual({
      'text-field': nameExpression('en'),
      'text-size': 12,
    });
    expect(out.layers[1]).toEqual(style.layers[1]);
    expect(out.layers[2]).toEqual(style.layers[2]);
    expect(out.layers[3]).toEqual(style.layers[3]);
    expect(out.layers[4]?.layout?.['text-field']).toEqual(nameExpression('en'));
  });

  it('vi: trả đúng object đầu vào', () => {
    expect(localizeStyle(style, 'vi')).toBe(style);
  });

  it('không đột biến đầu vào', () => {
    const before = JSON.stringify(style);
    localizeStyle(style, 'en');
    expect(JSON.stringify(style)).toBe(before);
  });
});

describe('hidePoiLayer', () => {
  it('đặt visibility none cho lớp poi, giữ layout còn lại, không đột biến', () => {
    const before = JSON.stringify(style);
    const out = hidePoiLayer(style);
    expect(out.layers[4]?.layout).toEqual({
      'text-field': ['get', 'name'],
      'icon-image': 'x',
      visibility: 'none',
    });
    expect(out.layers[0]).toEqual(style.layers[0]);
    expect(JSON.stringify(style)).toBe(before);
  });

  it('style không có lớp poi thì trả bản sao tương đương', () => {
    const noPoi = { ...style, layers: style.layers.slice(0, 4) };
    expect(hidePoiLayer(noPoi)).toEqual(noPoi);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/src/style-transform.test.ts`
Expected: FAIL — không resolve được `./style-transform`.

- [ ] **Step 3: Viết `style-transform.ts`**

`packages/core/src/style-transform.ts`:

```ts
/**
 * Biến đổi style JSON thuần (không cần Map đang chạy) — dùng cho React Native, nơi wrapper
 * không có API đổi layout property của lớp có sẵn. Web dùng `applyLanguage` lúc chạy nhưng
 * chia sẻ `nameExpression`/`isNameLabelLayer` từ đây.
 */
export type Lang = 'vi' | 'en';

export interface StyleLayerLike {
  id: string;
  type: string;
  layout?: Record<string, unknown> | undefined;
}

export interface StyleLike {
  layers?: readonly StyleLayerLike[] | undefined;
}

export const POI_LAYER_ID = 'poi';
const SOVEREIGNTY_LABEL_ID = 'sovereignty-label';

export function nameExpression(lang: Lang): unknown[] {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
}

/** Lớp nhãn tên (symbol có `text-field` tham chiếu `name`), trừ lớp chủ quyền luôn tiếng Việt. */
export function isNameLabelLayer(layer: StyleLayerLike): boolean {
  if (layer.type !== 'symbol' || layer.id === SOVEREIGNTY_LABEL_ID) return false;
  const textField = layer.layout?.['text-field'];
  return textField !== undefined && JSON.stringify(textField).includes('name');
}

function mapLayers<T extends StyleLike>(
  style: T,
  fn: (layer: StyleLayerLike) => StyleLayerLike,
): T {
  return { ...style, layers: (style.layers ?? []).map(fn) };
}

/** Đổi nhãn sang `lang`. `vi` là mặc định của style nên trả nguyên object. */
export function localizeStyle<T extends StyleLike>(style: T, lang: Lang): T {
  if (lang === 'vi') return style;
  return mapLayers(style, (layer) =>
    isNameLabelLayer(layer)
      ? { ...layer, layout: { ...layer.layout, 'text-field': nameExpression(lang) } }
      : layer,
  );
}

/** Ẩn lớp POI bằng `layout.visibility = 'none'`; trả style mới. */
export function hidePoiLayer<T extends StyleLike>(style: T): T {
  return mapLayers(style, (layer) =>
    layer.id === POI_LAYER_ID
      ? { ...layer, layout: { ...layer.layout, visibility: 'none' } }
      : layer,
  );
}
```

Thêm vào `packages/core/src/index.ts`: `export * from './style-transform';`

- [ ] **Step 4: Chạy test core, xác nhận xanh**

Run: `pnpm exec vitest run packages/core`
Expected: PASS (kể cả test cũ).

- [ ] **Step 5: Web dùng lại từ core**

Thay toàn bộ `packages/web/src/language.ts` bằng:

```ts
import { type Lang, isNameLabelLayer, nameExpression } from '@mapslibvn/core';

export type { Lang };
export { nameExpression };

interface StyleLike {
  getStyle():
    | { layers?: { id: string; type: string; layout?: Record<string, unknown> }[] }
    | undefined;
  setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
}

/** Đổi nhãn sang ngôn ngữ khác lúc chạy. Bỏ qua lớp chủ quyền (luôn tiếng Việt) và nhãn không phải tên. */
export function applyLanguage(gl: StyleLike, lang: Lang): void {
  for (const l of gl.getStyle()?.layers ?? []) {
    if (isNameLabelLayer(l)) gl.setLayoutProperty(l.id, 'text-field', nameExpression(lang));
  }
}
```

- [ ] **Step 6: Build core, test web, size-limit**

Run: `pnpm --filter @mapslibvn/core build && pnpm exec vitest run packages/web && pnpm --filter @mapslibvn/web typecheck && pnpm --filter @mapslibvn/web build`
Expected: exit 0; `language.test.ts` của web vẫn xanh; size-limit core < 8 kB, web < 15 kB.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/style-transform.ts packages/core/src/style-transform.test.ts packages/core/src/index.ts packages/web/src/language.ts
git commit -m "feat(core): localizeStyle/hidePoiLayer biến đổi style JSON thuần; web dùng lại nameExpression"
```

---

### Task 4: Khung gói `packages/react-native` + notices 4 gói

**Files:**
- Create: `packages/react-native/package.json`, `tsconfig.json`, `tsup.config.ts`, `src/index.ts`, `README.md`
- Modify: `scripts/lib/notices.mjs`, `scripts/lib/notices.test.mjs`, `vitest.config.ts`

- [ ] **Step 1: Test notices thất bại (RED)**

Trong `scripts/lib/notices.test.mjs`, đổi test đầu:

```js
  it('mỗi gói SDK nhận đủ LICENSE và THIRD_PARTY_NOTICES.md', () => {
    const plan = noticePlan();
    expect(NOTICE_FILES).toEqual(['LICENSE', 'THIRD_PARTY_NOTICES.md']);
    expect(SDK_PACKAGES).toEqual([
      'packages/core',
      'packages/web',
      'packages/react',
      'packages/react-native',
    ]);
    expect(plan).toHaveLength(8);
    expect(plan).toContainEqual({ src: 'LICENSE', dst: 'packages/web/LICENSE' });
    expect(plan).toContainEqual({
      src: 'THIRD_PARTY_NOTICES.md',
      dst: 'packages/react-native/THIRD_PARTY_NOTICES.md',
    });
  });
```

Trong `describe('staleCopies')`, object `files` của test "liệt kê bản sao lệch" thiếu `packages/react-native` nên kỳ vọng thêm hai dòng cuối:

```js
    expect(staleCopies(noticePlan(), (p) => files[p])).toEqual([
      'packages/core/THIRD_PARTY_NOTICES.md',
      'packages/react/LICENSE',
      'packages/react/THIRD_PARTY_NOTICES.md',
      'packages/react-native/LICENSE',
      'packages/react-native/THIRD_PARTY_NOTICES.md',
    ]);
```

Test "trả mảng rỗng khi mọi bản sao khớp": thêm `'packages/react-native/LICENSE': 'MIT'` và `'packages/react-native/THIRD_PARTY_NOTICES.md': 'notices v2'` vào object `all`.

Run: `pnpm exec vitest run scripts/lib/notices.test.mjs` → Expected: FAIL (3 gói).

- [ ] **Step 2: Sửa `SDK_PACKAGES`**

`scripts/lib/notices.mjs`: `export const SDK_PACKAGES = ['packages/core', 'packages/web', 'packages/react', 'packages/react-native'];`

Run: `pnpm exec vitest run scripts/lib/notices.test.mjs` → PASS.

- [ ] **Step 3: `package.json` của gói**

`packages/react-native/package.json`:

```json
{
  "name": "@mapslibvn/react-native",
  "version": "0.1.0",
  "description": "React Native bindings MapsLibVN: <MapsLibVNMap>, <Marker>, useMap, usePlaces — bọc @maplibre/maplibre-react-native",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "LICENSE", "THIRD_PARTY_NOTICES.md"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@maplibre/maplibre-react-native": "^11.3.0",
    "react": ">=19.1.0",
    "react-native": ">=0.80.0"
  },
  "dependencies": { "@mapslibvn/core": "workspace:*" },
  "devDependencies": {
    "@maplibre/maplibre-react-native": "^11.3.8",
    "@testing-library/react": "^16.3.0",
    "@types/geojson": "^7946.0.16",
    "@types/react": "^19.1.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-native": "^0.81.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 4: `tsconfig.json` và `tsup.config.ts`**

`packages/react-native/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true
  },
  "include": ["src"]
}
```

(`DOM` cần cho test jsdom — `.dataset`, `.textContent`; Expo `tsconfig.base` cũng bật `DOM` cùng
types của `react-native`, xung đột khai báo toàn cục nằm trong `.d.ts` nên `skipLibCheck` của
`tsconfig.base.json` bỏ qua. Namespace `GeoJSON` từ `@types/geojson`.)

`packages/react-native/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

// Đóng gói @mapslibvn/core vào dist để app cài được bằng MỘT tarball (spec M6 4.1).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2020',
  external: ['react', 'react/jsx-runtime', 'react-native', '@maplibre/maplibre-react-native'],
  noExternal: ['@mapslibvn/core'],
});
```

- [ ] **Step 5: `src/index.ts` tối thiểu + README**

`packages/react-native/src/index.ts` (tạm, Task 11 hoàn thiện):

```ts
export type { PoiFeature } from '@mapslibvn/core';
```

`packages/react-native/README.md`:

```markdown
# @mapslibvn/react-native

Bọc `@maplibre/maplibre-react-native` để hiện bản đồ MapsLibVN trong app React Native (Expo hoặc bare),
API bám `@mapslibvn/react`. Yêu cầu React ≥ 19.1, React Native ≥ 0.80, New Architecture, Expo ≥ 54
(không chạy trên Expo Go). Hướng dẫn: trang "React Native" trong docs; app thử: `examples/embed-rn`.

Chưa publish npm (checklist pháp lý B3). Cài bằng tarball: `pnpm --filter @mapslibvn/react-native pack`.
```

- [ ] **Step 6: Vitest include `.tsx`**

`vitest.config.ts`: đổi dòng `'packages/*/src/**/*.test.{ts,mjs}',` thành `'packages/*/src/**/*.test.{ts,tsx,mjs}',`.

- [ ] **Step 7: Cài, đồng bộ notices, typecheck, build**

Run: `pnpm install && pnpm notices:sync && pnpm --filter @mapslibvn/react-native typecheck && pnpm --filter @mapslibvn/react-native build && node scripts/notices-sync.mjs --check`
Expected: lockfile cập nhật (react 19 chỉ trong `packages/react-native`); `packages/react-native/LICENSE` và `THIRD_PARTY_NOTICES.md` xuất hiện; `dist/index.js` + `index.d.ts`; `--check` in OK 8 bản sao. Kiểm root vẫn React 18: `node -e "console.log(require('./node_modules/react/package.json').version)"` → `18.x`.

- [ ] **Step 8: Gate root + commit**

Run: `pnpm lint && pnpm typecheck && pnpm exec vitest run scripts/lib/notices.test.mjs`
Expected: exit 0.

```bash
git add packages/react-native scripts/lib/notices.mjs scripts/lib/notices.test.mjs vitest.config.ts pnpm-lock.yaml
git commit -m "feat(react-native): khung gói @mapslibvn/react-native (React 19 riêng, tsup noExternal core); notices 4 gói"
```

---

### Task 5: `toPoiFeature` — ánh xạ feature tile → `PoiFeature`

**Files:**
- Create: `packages/react-native/src/to-poi-feature.ts`, `packages/react-native/src/to-poi-feature.test.ts`

- [ ] **Step 1: Test thất bại (RED)**

`packages/react-native/src/to-poi-feature.test.ts`:

```ts
import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import { toPoiFeature } from './to-poi-feature';

const point: Feature = {
  type: 'Feature',
  properties: { id: 'p1', name: 'Cafe Cây Bồ Đề', cat: 'cafe', grp: 'food_drink' },
  geometry: { type: 'Point', coordinates: [106.6631, 10.7652] },
};

describe('toPoiFeature', () => {
  it('ánh xạ id/name/cat/grp và toạ độ giống SDK web', () => {
    expect(toPoiFeature(point)).toEqual({
      id: 'p1',
      name: 'Cafe Cây Bồ Đề',
      category: 'cafe',
      group: 'food_drink',
      lngLat: [106.6631, 10.7652],
    });
  });

  it('thiếu properties → chuỗi rỗng, lấy feature.id làm id', () => {
    const f: Feature = { ...point, id: 42, properties: null };
    expect(toPoiFeature(f)).toEqual({
      id: '42',
      name: '',
      category: '',
      group: '',
      lngLat: [106.6631, 10.7652],
    });
  });

  it('không phải Point hoặc undefined → null', () => {
    const line: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    };
    expect(toPoiFeature(line)).toBeNull();
    expect(toPoiFeature(undefined)).toBeNull();
  });
});
```

Run: `pnpm exec vitest run packages/react-native/src/to-poi-feature.test.ts` → FAIL (module không có).

- [ ] **Step 2: Viết hàm**

`packages/react-native/src/to-poi-feature.ts`:

```ts
import type { PoiFeature } from '@mapslibvn/core';
import type { Feature } from 'geojson';

/** Feature từ `queryRenderedFeatures` trên lớp `poi` → PoiFeature cùng shape với SDK web. */
export function toPoiFeature(feature: Feature | undefined): PoiFeature | null {
  if (!feature || feature.geometry.type !== 'Point') return null;
  const [lng, lat] = feature.geometry.coordinates;
  if (lng === undefined || lat === undefined) return null;
  const p = (feature.properties ?? {}) as Record<string, unknown>;
  return {
    id: String(p.id ?? feature.id ?? ''),
    name: String(p.name ?? ''),
    category: String(p.cat ?? ''),
    group: String(p.grp ?? ''),
    lngLat: [lng, lat],
  };
}
```

- [ ] **Step 3: Xanh + commit**

Run: `pnpm exec vitest run packages/react-native/src/to-poi-feature.test.ts && pnpm --filter @mapslibvn/react-native typecheck`
Expected: PASS 3 test.

```bash
git add packages/react-native/src/to-poi-feature.ts packages/react-native/src/to-poi-feature.test.ts
git commit -m "feat(react-native): toPoiFeature ánh xạ feature lớp poi"
```

---

### Task 6: `MapHandle`, `MapContext`, `usePlaces`

**Files:**
- Create: `packages/react-native/src/context.ts`, `src/use-places.ts`, `src/use-places.test.ts`

- [ ] **Step 1: `context.ts`**

```ts
import type { CameraRef, MapRef } from '@maplibre/maplibre-react-native';
import type { MapsLibVNClient } from '@mapslibvn/core';
import { type RefObject, createContext } from 'react';

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
}

export const MapContext = createContext<MapHandle | null>(null);
```

- [ ] **Step 2: Copy `usePlaces` và test từ `@mapslibvn/react`**

```bash
cp packages/react/src/use-places.ts packages/react-native/src/use-places.ts
cp packages/react/src/use-places.test.ts packages/react-native/src/use-places.test.ts
```

Trong `packages/react-native/src/use-places.ts` không cần đổi gì: dòng `useContext(MapContext)?.places ?? null` vẫn đúng vì `MapHandle.places` cùng tên. Kiểm bằng `grep -n MapContext packages/react-native/src/use-places.ts`.

- [ ] **Step 3: Chạy test hook với React 19 của gói**

Run: `pnpm exec vitest run packages/react-native/src/use-places.test.ts`
Expected: PASS 5 test (như gói react). Nếu lỗi "Invalid hook call"/hai bản React: kiểm `ls packages/react-native/node_modules/react` là 19.x và `@testing-library/react` nằm trong `packages/react-native/node_modules` (không phải root).

- [ ] **Step 4: Commit**

```bash
git add packages/react-native/src/context.ts packages/react-native/src/use-places.ts packages/react-native/src/use-places.test.ts
git commit -m "feat(react-native): MapHandle/MapContext + usePlaces (copy từ @mapslibvn/react)"
```

---

### Task 7: Mock `react-native` và wrapper cho test; component `Attribution`

**Files:**
- Create: `packages/react-native/src/test/react-native-mock.tsx`, `src/test/mlrn-mock.tsx`
- Create: `packages/react-native/src/attribution.tsx`, `src/attribution.test.tsx`

- [ ] **Step 1: Mock `react-native`**

`packages/react-native/src/test/react-native-mock.tsx` — View/Text/Pressable thành phần tử DOM để `@testing-library/react` truy vấn:

```tsx
import type { ReactNode } from 'react';

type AnyProps = Record<string, unknown> & { children?: ReactNode; testID?: string };

const pick = (p: AnyProps) => ({ 'data-testid': p.testID, style: undefined });

export function View(p: AnyProps) {
  return <div {...pick(p)}>{p.children}</div>;
}
export function Text(p: AnyProps) {
  return <span {...pick(p)}>{p.children}</span>;
}
export function Pressable(p: AnyProps & { onPress?: () => void; accessibilityLabel?: string }) {
  return (
    <button type="button" {...pick(p)} aria-label={p.accessibilityLabel} onClick={p.onPress}>
      {p.children}
    </button>
  );
}
export function TextInput(p: AnyProps) {
  return <input {...pick(p)} />;
}
export const StyleSheet = { create: <T,>(s: T): T => s };
export const Platform = { OS: 'ios', select: <T,>(o: { ios?: T; default?: T }) => o.ios ?? o.default };
```

- [ ] **Step 2: Mock wrapper**

`packages/react-native/src/test/mlrn-mock.tsx`:

```tsx
import { type ReactNode, type Ref, useImperativeHandle } from 'react';
import { vi } from 'vitest';

/** Ref giả của Map — test đặt kết quả cho queryRenderedFeatures/getBounds. */
export const mapRefMock = {
  queryRenderedFeatures: vi.fn(async () => [] as unknown[]),
  getBounds: vi.fn(async () => [106.6, 10.7, 106.8, 10.9] as [number, number, number, number]),
  showAttribution: vi.fn(async () => undefined),
  setSourceVisibility: vi.fn(async () => undefined),
};
export const cameraRefMock = { flyTo: vi.fn(), fitBounds: vi.fn(), easeTo: vi.fn() };

type MapProps = Record<string, unknown> & { children?: ReactNode; ref?: Ref<unknown>; mapStyle?: unknown };
let lastMapProps: MapProps | null = null;
export const getLastMapProps = () => lastMapProps;
export const resetMocks = () => {
  lastMapProps = null;
  for (const fn of Object.values(mapRefMock)) fn.mockClear();
  for (const fn of Object.values(cameraRefMock)) fn.mockClear();
};

export function Map(props: MapProps) {
  lastMapProps = props;
  useImperativeHandle(props.ref as Ref<unknown>, () => mapRefMock);
  const style = props.mapStyle;
  return (
    <div data-testid="mlrn-map" data-style={typeof style === 'string' ? style : JSON.stringify(style)}>
      {props.children}
    </div>
  );
}

export function Camera(props: { ref?: Ref<unknown>; initialViewState?: unknown }) {
  useImperativeHandle(props.ref as Ref<unknown>, () => cameraRefMock);
  return <div data-testid="mlrn-camera" data-view={JSON.stringify(props.initialViewState)} />;
}

export function Marker(props: {
  lngLat: [number, number];
  anchor?: string;
  onPress?: () => void;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <div
      data-testid={props.testID ?? 'mlrn-marker'}
      data-lnglat={props.lngLat.join(',')}
      data-anchor={props.anchor ?? 'center'}
      onClick={props.onPress}
      onKeyDown={props.onPress}
    >
      {props.children}
    </div>
  );
}
```

- [ ] **Step 3: Test `Attribution` thất bại (RED)**

`packages/react-native/src/attribution.test.tsx`:

```tsx
// @vitest-environment jsdom
import { attributionText } from '@mapslibvn/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Attribution, COMPACT_ATTRIBUTION } from './attribution';

vi.mock('react-native', () => import('./test/react-native-mock'));

describe('Attribution', () => {
  it('đầy đủ: hiện chuỗi attributionText() và gọi onPress khi bấm', () => {
    const onPress = vi.fn();
    render(<Attribution compact={false} onPress={onPress} />);
    const box = screen.getByTestId('mapslibvn-attribution');
    expect(box.textContent).toBe(attributionText());
    fireEvent.click(box);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('gọn: chỉ MapsLibVN + OSM', () => {
    render(<Attribution compact onPress={() => {}} />);
    expect(screen.getByTestId('mapslibvn-attribution').textContent).toBe(COMPACT_ATTRIBUTION);
    expect(COMPACT_ATTRIBUTION).toBe('© MapsLibVN · © OpenStreetMap contributors');
  });
});
```

Run: `pnpm exec vitest run packages/react-native/src/attribution.test.tsx` → FAIL.

- [ ] **Step 4: Viết `attribution.tsx`**

```tsx
import { attributionText } from '@mapslibvn/core';
import { Pressable, StyleSheet, Text } from 'react-native';

/** Dòng gọn khi `compactAttribution`; bấm vào mở hộp thoại native với đủ nguồn. */
export const COMPACT_ATTRIBUTION = '© MapsLibVN · © OpenStreetMap contributors';

export interface AttributionProps {
  compact: boolean;
  /** Mở hộp thoại attribution native (`MapRef.showAttribution`). */
  onPress: () => void;
}

/** Ghi nguồn bắt buộc (spec 12.3) — không có tuỳ chọn tắt. */
export function Attribution({ compact, onPress }: AttributionProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel="Ghi nguồn bản đồ"
      style={styles.box}
      testID="mapslibvn-attribution"
    >
      <Text style={styles.text} numberOfLines={compact ? 1 : 2}>
        {compact ? COMPACT_ATTRIBUTION : attributionText()}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '72%',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: { fontSize: 10, color: '#333333' },
});
```

- [ ] **Step 5: Xanh + typecheck + commit**

Run: `pnpm exec vitest run packages/react-native/src/attribution.test.tsx && pnpm --filter @mapslibvn/react-native typecheck`
Expected: PASS 2 test; tsc OK (file mock cũng được kiểm vì nằm trong `src`).

```bash
git add packages/react-native/src/test packages/react-native/src/attribution.tsx packages/react-native/src/attribution.test.tsx
git commit -m "feat(react-native): Attribution bắt buộc + mock react-native/wrapper cho test"
```

---

### Task 8: `useResolvedStyle` — URL hay style JSON đã biến đổi

**Files:**
- Create: `packages/react-native/src/use-style.ts`, `src/use-style.test.ts`

- [ ] **Step 1: Test thất bại (RED)**

`packages/react-native/src/use-style.test.ts`:

```ts
// @vitest-environment jsdom
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { type MapsLibVNClient, createClient, nameExpression } from '@mapslibvn/core';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { needsTransform, styleUrlFor, transformStyle, useResolvedStyle } from './use-style';

const places: MapsLibVNClient = createClient({ apiKey: 'mlv_live_k', baseUrl: 'https://api.test' });

// Cast vì kiểu expression của style-spec là union tuple hẹp; runtime chỉ cần shape này.
const styleJson = {
  version: 8,
  sources: {},
  layers: [
    { id: 'city', type: 'symbol', source: 's', layout: { 'text-field': ['get', 'name'] } },
    { id: 'poi', type: 'symbol', source: 's', layout: { 'text-field': ['get', 'name'] } },
  ],
} as unknown as StyleSpecification;

describe('styleUrlFor / needsTransform / transformStyle', () => {
  it('theme → styleUrl của core; chuỗi khác → giữ nguyên', () => {
    expect(styleUrlFor(places, 'dark')).toBe('https://api.test/v1/styles/dark.json?key=mlv_live_k');
    expect(styleUrlFor(places, 'https://x.test/s.json')).toBe('https://x.test/s.json');
  });

  it('chỉ cần biến đổi khi lang khác vi hoặc ẩn POI', () => {
    expect(needsTransform({ lang: 'vi', poiLayer: true })).toBe(false);
    expect(needsTransform({ lang: 'en', poiLayer: true })).toBe(true);
    expect(needsTransform({ lang: 'vi', poiLayer: false })).toBe(true);
  });

  it('transformStyle áp cả ngôn ngữ và ẩn POI', () => {
    const out = transformStyle(styleJson, { lang: 'en', poiLayer: false });
    expect(out.layers[0]?.layout).toEqual({ 'text-field': nameExpression('en') });
    expect(out.layers[1]?.layout).toEqual({ 'text-field': nameExpression('en'), visibility: 'none' });
  });
});

describe('useResolvedStyle', () => {
  it('mặc định trả URL ngay, không fetch', () => {
    const doFetch = vi.fn();
    const { result } = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'vi', poiLayer: true }, doFetch as never),
    );
    expect(result.current).toEqual({
      status: 'ready',
      mapStyle: 'https://api.test/v1/styles/light.json?key=mlv_live_k',
    });
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('lang=en: loading → fetch URL → ready với object đã biến đổi', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify(styleJson), { status: 200 }));
    const { result } = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'en', poiLayer: true }, doFetch as never),
    );
    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(doFetch).toHaveBeenCalledWith('https://api.test/v1/styles/light.json?key=mlv_live_k');
    const ready = result.current as { status: 'ready'; mapStyle: StyleSpecification };
    expect(ready.mapStyle.layers[0]?.layout).toEqual({ 'text-field': nameExpression('en') });
  });

  it('fetch lỗi → error có thông điệp tiếng Việt', async () => {
    const doFetch = vi.fn(async () => new Response('x', { status: 500 }));
    const { result } = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'vi', poiLayer: false }, doFetch as never),
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect((result.current as { error: Error }).error.message).toMatch(/Không tải được style/);
  });
});
```

Run: `pnpm exec vitest run packages/react-native/src/use-style.test.ts` → FAIL.

- [ ] **Step 2: Viết `use-style.ts`**

```ts
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import {
  type Lang,
  type MapsLibVNClient,
  type Theme,
  hidePoiLayer,
  localizeStyle,
} from '@mapslibvn/core';
import { useEffect, useState } from 'react';

export interface StyleOptions {
  /** 'light' | 'dark' hoặc URL style tuỳ biến */
  style: Theme | string;
  lang: Lang;
  poiLayer: boolean;
}

export type ResolvedStyle =
  | { status: 'loading' }
  | { status: 'ready'; mapStyle: string | StyleSpecification }
  | { status: 'error'; error: Error };

const isTheme = (s: string): s is Theme => s === 'light' || s === 'dark';

export function styleUrlFor(places: MapsLibVNClient, style: Theme | string): string {
  return isTheme(style) ? places.styleUrl(style) : style;
}

/** Native tải URL trực tiếp trừ khi phải đổi ngôn ngữ hay ẩn POI (wrapper không có API đổi layout). */
export function needsTransform(o: { lang: Lang; poiLayer: boolean }): boolean {
  return o.lang !== 'vi' || !o.poiLayer;
}

export function transformStyle<T extends StyleSpecification>(
  json: T,
  o: { lang: Lang; poiLayer: boolean },
): T {
  const localized = localizeStyle(json, o.lang);
  return o.poiLayer ? localized : hidePoiLayer(localized);
}

/**
 * Trả URL ngay khi không cần biến đổi; ngược lại fetch JSON, biến đổi thuần, trả object.
 * `doFetch` tiêm được cho test.
 */
export function useResolvedStyle(
  places: MapsLibVNClient,
  options: StyleOptions,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): ResolvedStyle {
  const url = styleUrlFor(places, options.style);
  const transform = needsTransform(options);
  const [state, setState] = useState<ResolvedStyle>(() =>
    transform ? { status: 'loading' } : { status: 'ready', mapStyle: url },
  );

  useEffect(() => {
    if (!transform) {
      setState({ status: 'ready', mapStyle: url });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      try {
        const res = await doFetch(url);
        if (!res.ok) throw new Error(`Không tải được style (HTTP ${res.status})`);
        const json = (await res.json()) as StyleSpecification;
        if (!cancelled) {
          setState({
            status: 'ready',
            mapStyle: transformStyle(json, { lang: options.lang, poiLayer: options.poiLayer }),
          });
        }
      } catch (cause) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: cause instanceof Error ? cause : new Error('Không tải được style'),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, transform, options.lang, options.poiLayer, doFetch]);

  return state;
}
```

Nếu tsc báo `StyleSpecification` không khớp `StyleLike` (layout của LayerSpecification là union hẹp): đổi hai dòng trong `transformStyle` thành `const localized = localizeStyle(json as unknown as StyleLike, o.lang)` … `return (…) as unknown as T` và import `StyleLike` từ core — ghi lại trong DEVLOG mục 3 nếu phải làm.

- [ ] **Step 3: Xanh + commit**

Run: `pnpm exec vitest run packages/react-native/src/use-style.test.ts && pnpm --filter @mapslibvn/react-native typecheck`
Expected: PASS 6 test.

```bash
git add packages/react-native/src/use-style.ts packages/react-native/src/use-style.test.ts
git commit -m "feat(react-native): useResolvedStyle — URL native mặc định, fetch+biến đổi khi lang/poiLayer"
```

---

### Task 9: `<MapsLibVNMap>` và `useMap()`

**Files:**
- Create: `packages/react-native/src/map.tsx`, `src/map.test.tsx`

- [ ] **Step 1: Test thất bại (RED)**

`packages/react-native/src/map.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapsLibVNMap, useMap } from './map';
import { cameraRefMock, getLastMapProps, mapRefMock, resetMocks } from './test/mlrn-mock';

vi.mock('react-native', () => import('./test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('./test/mlrn-mock'));

const base = { apiKey: 'mlv_live_k', apiBase: 'https://api.test' };
type PressEvent = { nativeEvent: { point: [number, number]; lngLat: [number, number] } };
const press = (): PressEvent => ({ nativeEvent: { point: [10, 20], lngLat: [106.7, 10.77] } });

afterEach(() => {
  resetMocks();
  vi.restoreAllMocks();
});

describe('MapsLibVNMap', () => {
  it('mặc định: mapStyle là URL light, camera khởi tạo HCM zoom 12, không logo, có attribution', () => {
    render(<MapsLibVNMap {...base} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toBe(
      'https://api.test/v1/styles/light.json?key=mlv_live_k',
    );
    expect(screen.getByTestId('mlrn-camera').dataset.view).toBe(
      JSON.stringify({ center: [106.7, 10.776], zoom: 12 }),
    );
    const props = getLastMapProps();
    expect(props?.logo).toBe(false);
    expect(props?.attribution).toBe(true);
    expect(screen.getByTestId('mapslibvn-attribution')).toBeTruthy();
  });

  it('style dark + center/zoom truyền vào', () => {
    render(<MapsLibVNMap {...base} style="dark" center={[105.85, 21.03]} zoom={10} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toContain('/v1/styles/dark.json');
    expect(screen.getByTestId('mlrn-camera').dataset.view).toBe(
      JSON.stringify({ center: [105.85, 21.03], zoom: 10 }),
    );
  });

  it('lang=en: fetch style rồi truyền object', async () => {
    const json = { version: 8, sources: {}, layers: [] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(json)));
    render(<MapsLibVNMap {...base} lang="en" />);
    expect(screen.queryByTestId('mlrn-map')).toBeNull(); // đang tải
    await waitFor(() => expect(screen.getByTestId('mlrn-map')).toBeTruthy());
    expect(screen.getByTestId('mlrn-map').dataset.style).toBe(JSON.stringify(json));
  });

  it('onLoad gọi đúng một lần với MapHandle khi style tải xong', () => {
    const onLoad = vi.fn();
    render(<MapsLibVNMap {...base} onLoad={onLoad} />);
    const props = getLastMapProps() as { onDidFinishLoadingStyle: () => void };
    act(() => props.onDidFinishLoadingStyle());
    act(() => props.onDidFinishLoadingStyle());
    expect(onLoad).toHaveBeenCalledTimes(1);
    const handle = onLoad.mock.calls[0]?.[0];
    expect(handle.places.baseUrl).toBe('https://api.test');
    handle.flyTo([106.7, 10.77], 15);
    expect(cameraRefMock.flyTo).toHaveBeenCalledWith({ center: [106.7, 10.77], zoom: 15 });
    handle.fitBounds([106.6, 10.7, 106.8, 10.9]);
    expect(cameraRefMock.fitBounds).toHaveBeenCalledWith([106.6, 10.7, 106.8, 10.9], {
      padding: { top: 40, right: 40, bottom: 40, left: 40 },
    });
  });

  it('onPress → queryRenderedFeatures lớp poi → onPoiClick', async () => {
    mapRefMock.queryRenderedFeatures.mockResolvedValueOnce([
      {
        type: 'Feature',
        properties: { id: 'p1', name: 'Cafe', cat: 'cafe', grp: 'food_drink' },
        geometry: { type: 'Point', coordinates: [106.66, 10.76] },
      },
    ]);
    const onPoiClick = vi.fn();
    render(<MapsLibVNMap {...base} onPoiClick={onPoiClick} />);
    const props = getLastMapProps() as { onPress: (e: PressEvent) => Promise<void> };
    await act(() => props.onPress(press()));
    expect(mapRefMock.queryRenderedFeatures).toHaveBeenCalledWith([10, 20], { layers: ['poi'] });
    expect(onPoiClick).toHaveBeenCalledWith({
      id: 'p1',
      name: 'Cafe',
      category: 'cafe',
      group: 'food_drink',
      lngLat: [106.66, 10.76],
    });
  });

  it('không query khi poiLayer=false hoặc không có onPoiClick', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: 8, sources: {}, layers: [] })),
    );
    const onPoiClick = vi.fn();
    render(<MapsLibVNMap {...base} poiLayer={false} onPoiClick={onPoiClick} />);
    await waitFor(() => expect(screen.getByTestId('mlrn-map')).toBeTruthy());
    let props = getLastMapProps() as { onPress: (e: PressEvent) => Promise<void> };
    await act(() => props.onPress(press()));
    expect(mapRefMock.queryRenderedFeatures).not.toHaveBeenCalled();

    resetMocks();
    render(<MapsLibVNMap {...base} />);
    props = getLastMapProps() as { onPress: (e: PressEvent) => Promise<void> };
    await act(() => props.onPress(press()));
    expect(mapRefMock.queryRenderedFeatures).not.toHaveBeenCalled();
  });

  it('bấm attribution → showAttribution native; onError khi map lỗi', () => {
    const onError = vi.fn();
    render(<MapsLibVNMap {...base} onError={onError} />);
    fireEvent.click(screen.getByTestId('mapslibvn-attribution'));
    expect(mapRefMock.showAttribution).toHaveBeenCalledTimes(1);
    const props = getLastMapProps() as { onDidFailLoadingMap: () => void };
    act(() => props.onDidFailLoadingMap());
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Không tải được bản đồ' }));
  });

  it('bundleId → client gửi X-Bundle-Id', async () => {
    const onLoad = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    render(<MapsLibVNMap {...base} bundleId="vn.mapslibvn.demo" onLoad={onLoad} />);
    act(() => (getLastMapProps() as { onDidFinishLoadingStyle: () => void }).onDidFinishLoadingStyle());
    await onLoad.mock.calls[0]?.[0].places.autocomplete('cafe');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Bundle-Id']).toBe('vn.mapslibvn.demo');
  });

  it('useMap ngoài <MapsLibVNMap> ném lỗi tiếng Việt; bên trong trả handle', () => {
    function Probe() {
      const map = useMap();
      return <span data-testid="probe">{map.places.baseUrl}</span>;
    }
    expect(() => render(<Probe />)).toThrow(/bên trong <MapsLibVNMap>/);
    render(
      <MapsLibVNMap {...base}>
        <Probe />
      </MapsLibVNMap>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('https://api.test');
  });
});
```

Run: `pnpm exec vitest run packages/react-native/src/map.test.tsx` → FAIL (module không có).

- [ ] **Step 2: Viết `map.tsx`**

```tsx
import {
  Camera,
  type CameraRef,
  Map as NativeMap,
  type MapRef,
  type PressEvent,
} from '@maplibre/maplibre-react-native';
import {
  type Lang,
  POI_LAYER_ID,
  type PoiFeature,
  type Theme,
  createClient,
} from '@mapslibvn/core';
import { type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import { type NativeSyntheticEvent, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { Attribution } from './attribution';
import { MapContext, type MapHandle } from './context';
import { toPoiFeature } from './to-poi-feature';
import { useResolvedStyle } from './use-style';

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
  /** Attribution gọn (không có tuỳ chọn tắt) */
  compactAttribution?: boolean;
  /** Bundle id / application id của app → header X-Bundle-Id cho khoá mobile */
  bundleId?: string;
  /** Style của khung View bọc ngoài */
  containerStyle?: StyleProp<ViewStyle>;
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
  compactAttribution = false,
  bundleId,
  containerStyle,
  onLoad,
  onPoiClick,
  onError,
  testID,
  children,
}: MapsLibVNMapProps) {
  const places = useMemo(
    () =>
      createClient({
        apiKey,
        baseUrl: apiBase,
        ...(bundleId ? { headers: { 'X-Bundle-Id': bundleId } } : {}),
      }),
    [apiKey, apiBase, bundleId],
  );
  const native = useRef<MapRef | null>(null);
  const camera = useRef<CameraRef | null>(null);
  const handlers = useRef({ onLoad, onPoiClick, onError });
  handlers.current = { onLoad, onPoiClick, onError };

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
    }),
    [places],
  );

  const resolved = useResolvedStyle(places, { style, lang, poiLayer });
  useEffect(() => {
    if (resolved.status === 'error') handlers.current.onError?.(resolved.error);
  }, [resolved]);

  // Đổi một trong các giá trị này → tạo lại map (như @mapslibvn/react); onLoad gọi lại một lần.
  const mapKey = `${apiKey}|${apiBase}|${style}|${lang}|${poiLayer}`;
  const loadedFor = useRef<string | null>(null);

  const onPress = async (e: NativeSyntheticEvent<PressEvent>) => {
    if (!poiLayer || !handlers.current.onPoiClick) return;
    const features = await native.current?.queryRenderedFeatures(e.nativeEvent.point, {
      layers: [POI_LAYER_ID],
    });
    const poi = toPoiFeature(features?.[0]);
    if (poi) handlers.current.onPoiClick?.(poi);
  };

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
          onDidFinishLoadingStyle={() => {
            if (loadedFor.current === mapKey) return;
            loadedFor.current = mapKey;
            handlers.current.onLoad?.(handle);
          }}
          onDidFailLoadingMap={() => handlers.current.onError?.(new Error('Không tải được bản đồ'))}
        >
          <Camera ref={camera} initialViewState={{ center, zoom }} />
          <MapContext.Provider value={handle}>{children}</MapContext.Provider>
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

Lưu ý typecheck: wrapper khai báo `onPress` nhận `NativeSyntheticEvent<PressEvent> | NativeSyntheticEvent<PressEventWithFeatures>`; kiểu tham số của ta hẹp hơn nhưng vẫn gán được vì `PressEventWithFeatures extends PressEvent`. `POI_LAYER_ID` đến từ core Task 3.

- [ ] **Step 3: Xanh + typecheck**

Run: `pnpm exec vitest run packages/react-native/src/map.test.tsx && pnpm --filter @mapslibvn/react-native typecheck`
Expected: PASS 9 test; tsc OK. Nếu test `lang=en` báo `act` warning: bọc `render` trong `await act(async () => …)`.

- [ ] **Step 4: Commit**

```bash
git add packages/react-native/src/map.tsx packages/react-native/src/map.test.tsx
git commit -m "feat(react-native): <MapsLibVNMap> bọc Map+Camera, poiClick qua queryRenderedFeatures, useMap"
```

---

### Task 10: `<Marker>`

**Files:**
- Create: `packages/react-native/src/marker.tsx`, `src/marker.test.tsx`

- [ ] **Step 1: Test thất bại (RED)**

`packages/react-native/src/marker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MapsLibVNMap } from './map';
import { DEFAULT_MARKER_COLOR, Marker } from './marker';

vi.mock('react-native', () => import('./test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('./test/mlrn-mock'));

const base = { apiKey: 'mlv_live_k', apiBase: 'https://api.test' };

describe('Marker', () => {
  it('không children → ghim mặc định, anchor center, lngLat đúng', () => {
    render(
      <MapsLibVNMap {...base}>
        <Marker lng={106.7} lat={10.776} testID="m1" />
      </MapsLibVNMap>,
    );
    const m = screen.getByTestId('m1');
    expect(m.dataset.lnglat).toBe('106.7,10.776');
    expect(m.dataset.anchor).toBe('center');
    expect(screen.getByTestId('mapslibvn-marker-pin')).toBeTruthy();
    expect(DEFAULT_MARKER_COLOR).toBe('#3FB1CE');
  });

  it('children tuỳ ý + anchor bottom + onPress', () => {
    const onPress = vi.fn();
    render(
      <MapsLibVNMap {...base}>
        <Marker lng={1} lat={2} anchor="bottom" onPress={onPress} testID="m2">
          <span data-testid="custom">★</span>
        </Marker>
      </MapsLibVNMap>,
    );
    expect(screen.getByTestId('custom')).toBeTruthy();
    expect(screen.queryByTestId('mapslibvn-marker-pin')).toBeNull();
    expect(screen.getByTestId('m2').dataset.anchor).toBe('bottom');
    fireEvent.click(screen.getByTestId('m2'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ngoài <MapsLibVNMap> ném lỗi', () => {
    expect(() => render(<Marker lng={1} lat={2} />)).toThrow(/bên trong <MapsLibVNMap>/);
  });
});
```

Run: `pnpm exec vitest run packages/react-native/src/marker.test.tsx` → FAIL.

- [ ] **Step 2: Viết `marker.tsx`**

```tsx
import { type Anchor, Marker as NativeMarker } from '@maplibre/maplibre-react-native';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMap } from './map';

/** Màu ghim mặc định của MapLibre. */
export const DEFAULT_MARKER_COLOR = '#3FB1CE';

export interface MarkerProps {
  lng: number;
  lat: number;
  /** Màu ghim mặc định; bỏ qua khi có children */
  color?: string;
  /** Điểm neo — mặc định 'center' (ghim tròn) */
  anchor?: Anchor;
  onPress?: () => void;
  /** View tuỳ ý thay ghim mặc định */
  children?: ReactElement;
  testID?: string;
}

export function Marker({
  lng,
  lat,
  color = DEFAULT_MARKER_COLOR,
  anchor = 'center',
  onPress,
  children,
  testID,
}: MarkerProps) {
  useMap(); // bảo đảm nằm trong <MapsLibVNMap>
  const pin = children ?? (
    <View style={[styles.pin, { backgroundColor: color }]} testID="mapslibvn-marker-pin" />
  );
  return (
    <NativeMarker
      lngLat={[lng, lat]}
      anchor={anchor}
      {...(onPress ? { onPress: () => onPress() } : {})}
      {...(testID ? { testID } : {})}
    >
      {pin}
    </NativeMarker>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    borderColor: '#ffffff',
  },
});
```

- [ ] **Step 3: Xanh + commit**

Run: `pnpm exec vitest run packages/react-native/src/marker.test.tsx && pnpm --filter @mapslibvn/react-native typecheck`
Expected: PASS 3 test.

```bash
git add packages/react-native/src/marker.tsx packages/react-native/src/marker.test.tsx
git commit -m "feat(react-native): <Marker> bọc Marker native, ghim mặc định"
```

---

### Task 11: Xuất khẩu gói, build, gate toàn repo

**Files:**
- Modify: `packages/react-native/src/index.ts`

- [ ] **Step 1: `index.ts` đầy đủ**

```ts
export { DEFAULT_CENTER, DEFAULT_ZOOM, MapsLibVNMap, useMap } from './map';
export type { MapsLibVNMapProps } from './map';
export { DEFAULT_MARKER_COLOR, Marker } from './marker';
export type { MarkerProps } from './marker';
export type { MapHandle } from './context';
export { usePlaces } from './use-places';
export type { UsePlacesOptions, UsePlacesResult } from './use-places';
export { COMPACT_ATTRIBUTION } from './attribution';
export type {
  AutocompleteItem,
  Lang,
  MapsLibVNClient,
  Place,
  PoiFeature,
  Theme,
} from '@mapslibvn/core';
```

- [ ] **Step 2: Build và kiểm dist tự chứa**

Run: `pnpm --filter @mapslibvn/react-native build && grep -c "@mapslibvn/core" packages/react-native/dist/index.js; grep -o "from \"[^\"]*\"" packages/react-native/dist/index.js | sort -u`
Expected: `grep -c` in `0` (core đã đóng gói); danh sách import chỉ gồm `react`, `react/jsx-runtime`, `react-native`, `@maplibre/maplibre-react-native`. `dist/index.d.ts` có `interface PoiFeature` (kiểm `grep -c PoiFeature packages/react-native/dist/index.d.ts` ≥ 1).

- [ ] **Step 3: Gate toàn repo**

Run: `pnpm lint && node scripts/notices-sync.mjs --check && pnpm typecheck && pnpm test`
Expected: exit 0; vitest root chạy thêm 6 file test của gói RN (to-poi-feature 3, use-places 5, attribution 2, use-style 6, map 9, marker 3 = 28 test). Nếu `pnpm lint` phàn nàn trong `src/test/*.tsx`: `Map` che tên global → thêm `// biome-ignore lint/suspicious/noShadowRestrictedNames: tên phải khớp export của wrapper` ngay trên `export function Map`; luật a11y trên `<div onClick>` của `Marker` mock → `// biome-ignore lint/a11y/<tên luật Biome in ra>: mock cho test, không phải UI`. Không tắt luật toàn repo.

- [ ] **Step 4: Push và xem CI**

```bash
git add packages/react-native/src/index.ts packages/react-native/src/test/mlrn-mock.tsx
git commit -m "feat(react-native): xuất khẩu công khai; dist tự chứa @mapslibvn/core"
git push origin main
GH_TOKEN="$(cat ~/.config/gh-dotienphong.token)" gh run watch --repo dotienphong/maps-library-vietnam --exit-status
```

Expected: CI `success` (job `test` với 4 gói).

---

### Task 12: `pnpm example:rn` — script build + pack + cài + chạy

**Files:**
- Modify: `scripts/lib/example-serve.mjs`, `scripts/lib/example-serve.test.mjs`
- Create: `scripts/lib/example-rn.mjs`, `scripts/lib/example-rn.test.mjs`, `scripts/example-rn.mjs`
- Modify: `package.json`, `.env.example`

- [ ] **Step 1: Test `resolveKey` tổng quát (RED)**

Thêm vào `describe('resolveKey')` trong `scripts/lib/example-serve.test.mjs`:

```js
  it('tham số thứ ba đổi tên biến env và gợi ý lệnh', () => {
    const opts = { envName: 'KEY_EXAMPLE_RN', hint: 'pnpm example:rn' };
    expect(resolveKey([], { KEY_EXAMPLE_RN: good }, opts)).toBe(good);
    expect(() => resolveKey([], {}, opts)).toThrow(/KEY_EXAMPLE_RN.*pnpm example:rn/s);
  });

  it("bỏ dấu nháy đơn/kép bao quanh giá trị trong .env", () => {
    expect(resolveKey([], { KEY_EXAMPLE_EMBED: `'${good}'` })).toBe(good);
    expect(resolveKey([], { KEY_EXAMPLE_EMBED: `"${good}"` })).toBe(good);
  });
```

Run: `pnpm exec vitest run scripts/lib/example-serve.test.mjs` → FAIL.

- [ ] **Step 2: Sửa `resolveKey`**

Thay hàm trong `scripts/lib/example-serve.mjs`:

```js
/**
 * Khoá lấy từ biến `.env` (`KEY_EXAMPLE_EMBED` mặc định); `--key` chỉ để ghi đè tạm.
 * Không đọc khoá từ file nào trong repo. Bỏ dấu nháy bao quanh nếu .env có.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ envName?: string, hint?: string }} [opts]
 */
export function resolveKey(argv, env, opts = {}) {
  const envName = opts.envName ?? KEY_ENV_NAME;
  const hint = opts.hint ?? 'pnpm example:embed';
  const i = argv.indexOf('--key');
  const fromArg = i >= 0 ? argv[i + 1] : undefined;
  const raw = fromArg ?? env[envName] ?? '';
  const key = raw.replace(/^['"]|['"]$/g, '');
  if (!key) {
    throw new Error(
      `Thiếu khoá. Đặt ${envName}=mlv_live_… trong .env ở gốc repo, hoặc chạy ${hint} --key mlv_live_…`,
    );
  }
  if (!/^mlv_live_[0-9A-Za-z]{24}$/.test(key)) {
    throw new Error(`Khoá không đúng định dạng mlv_live_ + 24 ký tự: ${key.slice(0, 13)}…`);
  }
  return key;
}
```

Run: `pnpm exec vitest run scripts/lib/example-serve.test.mjs` → PASS (test cũ vẫn xanh vì mặc định giữ nguyên).

- [ ] **Step 3: Test helper `example-rn` (RED)**

`scripts/lib/example-rn.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API,
  EXAMPLE_RN_DIR,
  KEY_ENV_NAME_RN,
  TARBALL,
  envFileContent,
  expoRunArgs,
  packedTarballName,
  parseArgs,
} from './example-rn.mjs';

describe('parseArgs', () => {
  it('mặc định ios trên macOS, android nơi khác; cờ --android/--ios ghi đè', () => {
    expect(parseArgs([], 'darwin')).toEqual({ platform: 'ios', packOnly: false });
    expect(parseArgs([], 'linux')).toEqual({ platform: 'android', packOnly: false });
    expect(parseArgs(['--android'], 'darwin').platform).toBe('android');
    expect(parseArgs(['--ios'], 'linux').platform).toBe('ios');
  });

  it('--pack-only chỉ build/pack/cài', () => {
    expect(parseArgs(['--pack-only'], 'darwin')).toEqual({ platform: 'ios', packOnly: true });
  });

  it('cờ lạ → lỗi', () => {
    expect(() => parseArgs(['--web'], 'darwin')).toThrow(/--web/);
  });
});

describe('hằng số và chuỗi sinh', () => {
  it('đường dẫn, tên biến, tarball, API mặc định', () => {
    expect(EXAMPLE_RN_DIR).toBe('examples/embed-rn');
    expect(KEY_ENV_NAME_RN).toBe('KEY_EXAMPLE_RN');
    expect(TARBALL).toBe('mapslibvn-react-native.tgz');
    expect(DEFAULT_API).toBe('https://api.ai-solutions.io.vn');
  });

  it('packedTarballName theo quy ước pnpm pack (bỏ @, / → -)', () => {
    expect(packedTarballName('@mapslibvn/react-native', '0.1.0')).toBe(
      'mapslibvn-react-native-0.1.0.tgz',
    );
  });

  it('envFileContent ghi hai biến EXPO_PUBLIC_*', () => {
    expect(envFileContent('mlv_live_x', 'https://api.test')).toBe(
      'EXPO_PUBLIC_MAPSLIBVN_KEY=mlv_live_x\nEXPO_PUBLIC_MAPSLIBVN_API=https://api.test\n',
    );
  });

  it('expoRunArgs', () => {
    expect(expoRunArgs('ios')).toEqual(['expo', 'run:ios']);
    expect(expoRunArgs('android')).toEqual(['expo', 'run:android']);
  });
});
```

Run: `pnpm exec vitest run scripts/lib/example-rn.test.mjs` → FAIL.

- [ ] **Step 4: Viết `scripts/lib/example-rn.mjs`**

```js
// Hàm thuần cho `pnpm example:rn` (scripts/example-rn.mjs) — app Expo thử độc lập cài SDK bằng tarball.
export const EXAMPLE_RN_DIR = 'examples/embed-rn';
export const KEY_ENV_NAME_RN = 'KEY_EXAMPLE_RN';
export const TARBALL = 'mapslibvn-react-native.tgz';
export const DEFAULT_API = 'https://api.ai-solutions.io.vn';
export const RN_PACKAGE_DIR = 'packages/react-native';

/**
 * @param {string[]} argv
 * @param {string} platform process.platform
 * @returns {{ platform: 'ios' | 'android', packOnly: boolean }}
 */
export function parseArgs(argv, platform) {
  /** @type {'ios' | 'android'} */
  let target = platform === 'darwin' ? 'ios' : 'android';
  let packOnly = false;
  for (const a of argv) {
    if (a === '--ios') target = 'ios';
    else if (a === '--android') target = 'android';
    else if (a === '--pack-only') packOnly = true;
    else if (a === '--key') break; // phần còn lại do resolveKey đọc
    else throw new Error(`Không hiểu tham số ${a}. Dùng: --ios | --android | --pack-only | --key mlv_live_…`);
  }
  return { platform: target, packOnly };
}

/** Tên file `pnpm pack` sinh: bỏ `@`, đổi `/` thành `-`. @param {string} name @param {string} version */
export function packedTarballName(name, version) {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

/** @param {string} key @param {string} api */
export function envFileContent(key, api) {
  return `EXPO_PUBLIC_MAPSLIBVN_KEY=${key}\nEXPO_PUBLIC_MAPSLIBVN_API=${api}\n`;
}

/** @param {'ios' | 'android'} platform */
export function expoRunArgs(platform) {
  return ['expo', `run:${platform}`];
}
```

Run: `pnpm exec vitest run scripts/lib/example-rn.test.mjs` → PASS.

- [ ] **Step 5: Script chính `scripts/example-rn.mjs`**

```js
#!/usr/bin/env node
// Mở app Expo thử độc lập bằng một lệnh (nghiệm thu M6, spec M6 mục 5.3):
//   pnpm example:rn            (iOS trên macOS, Android nơi khác; khoá từ KEY_EXAMPLE_RN trong .env)
//   pnpm example:rn --android
//   pnpm example:rn --pack-only        (chỉ build + pack + cài, không chạy)
//   pnpm example:rn --android --key mlv_live_…   (ghi đè tạm; --key phải đứng CUỐI)
// Các bước: build core + react-native → pnpm pack vào examples/embed-rn/vendor → ghi .env của app
// → npm install tarball → npx expo run:<platform>. Khoá KHÔNG nằm trong repo. Ctrl+C để dừng.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import 'dotenv/config';
import {
  DEFAULT_API,
  EXAMPLE_RN_DIR,
  KEY_ENV_NAME_RN,
  RN_PACKAGE_DIR,
  TARBALL,
  envFileContent,
  expoRunArgs,
  packedTarballName,
  parseArgs,
} from './lib/example-rn.mjs';
import { resolveKey } from './lib/example-serve.mjs';
import { run } from './lib/run.mjs';

const argv = process.argv.slice(2);
const { platform, packOnly } = parseArgs(argv, process.platform);
const key = resolveKey(argv, process.env, { envName: KEY_ENV_NAME_RN, hint: 'pnpm example:rn' });
const api = process.env.EXAMPLE_RN_API ?? DEFAULT_API;

const appDir = resolve(EXAMPLE_RN_DIR);
if (!existsSync(join(appDir, 'package.json'))) {
  throw new Error(`Không thấy ${EXAMPLE_RN_DIR}/package.json — chạy từ gốc repo`);
}

console.log('▶ 1/5 build @mapslibvn/core + @mapslibvn/react-native');
run('pnpm', ['--filter', '@mapslibvn/core', '--filter', '@mapslibvn/react-native', 'build']);

console.log('▶ 2/5 pnpm pack → vendor/');
const vendor = join(appDir, 'vendor');
mkdirSync(vendor, { recursive: true });
run('pnpm', ['--filter', '@mapslibvn/react-native', 'pack', '--pack-destination', vendor]);
const pkg = JSON.parse(readFileSync(join(RN_PACKAGE_DIR, 'package.json'), 'utf8'));
renameSync(join(vendor, packedTarballName(pkg.name, pkg.version)), join(vendor, TARBALL));

console.log('▶ 3/5 ghi examples/embed-rn/.env (không commit)');
writeFileSync(join(appDir, '.env'), envFileContent(key, api));

console.log('▶ 4/5 npm install tarball (cài lại mỗi lần để không dính bản cũ)');
run('npm', ['install', '--no-audit', '--no-fund', `./vendor/${TARBALL}`], { cwd: appDir });

if (packOnly) {
  console.log('✓ --pack-only: xong. Chạy tay: cd examples/embed-rn && npx expo run:ios');
} else {
  console.log(`▶ 5/5 npx expo run:${platform} (lần đầu prebuild + CocoaPods/Gradle, vài phút)`);
  run('npx', expoRunArgs(platform), { cwd: appDir });
}
```

- [ ] **Step 6: `package.json` root và `.env.example`**

Trong `package.json` root, sau dòng `"example:embed": "node scripts/example-embed.mjs",` thêm `"example:rn": "node scripts/example-rn.mjs",`.

Trong `.env.example`, sau `KEY_EXAMPLE_EMBED=` thêm:

```
# Khoá kind mobile cho app Expo thử examples/embed-rn (pnpm example:rn). Cấp bằng:
#   pnpm key:issue --tenant 00000000-0000-4000-8000-000000000002 --label "embed-rn thử độc lập" --kind mobile
KEY_EXAMPLE_RN=
```

- [ ] **Step 7: Typecheck scripts + test + commit**

Run: `pnpm typecheck && pnpm exec vitest run scripts/lib/example-rn.test.mjs scripts/lib/example-serve.test.mjs && pnpm lint`
Expected: exit 0 (checkJs không phàn nàn JSDoc).

```bash
git add scripts/lib/example-serve.mjs scripts/lib/example-serve.test.mjs scripts/lib/example-rn.mjs scripts/lib/example-rn.test.mjs scripts/example-rn.mjs package.json .env.example
git commit -m "feat(scripts): pnpm example:rn — build, pack tarball, cài vào app Expo thử, chạy simulator"
```

---

### Task 13: App Expo thử độc lập `examples/embed-rn`

**Files:**
- Create: `examples/embed-rn/` (template `blank-typescript` + `App.tsx`, `app.json`, `.gitignore`, `README.md`)

- [ ] **Step 1: Tạo dự án từ template (ngoài workspace, dùng npm)**

Run:
```bash
npx create-expo-app@latest examples/embed-rn --template blank-typescript --no-install
cd examples/embed-rn && npm install --no-audit --no-fund && npx expo install @maplibre/maplibre-react-native expo-application && cd ../..
```
Expected: thư mục có `App.tsx`, `index.ts`, `app.json`, `package.json`, `tsconfig.json`, `assets/`; `package.json` có `expo` (SDK 57), `react`, `react-native`, `@maplibre/maplibre-react-native`, `expo-application`. Kiểm: `grep -n '"@maplibre/maplibre-react-native"\|"expo":' examples/embed-rn/package.json`.

- [ ] **Step 2: `app.json`**

Thay nội dung `examples/embed-rn/app.json`:

```json
{
  "expo": {
    "name": "MapsLibVN Demo",
    "slug": "mapslibvn-demo",
    "version": "0.1.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "splash": { "image": "./assets/splash-icon.png", "resizeMode": "contain", "backgroundColor": "#ffffff" },
    "ios": { "supportsTablet": true, "bundleIdentifier": "vn.mapslibvn.demo" },
    "android": {
      "package": "vn.mapslibvn.demo",
      "adaptiveIcon": { "foregroundImage": "./assets/adaptive-icon.png", "backgroundColor": "#ffffff" }
    },
    "plugins": ["@maplibre/maplibre-react-native"]
  }
}
```

(Giữ đúng tên file ảnh mà template sinh trong `assets/`; nếu template đặt tên khác, sửa 3 đường dẫn cho khớp `ls examples/embed-rn/assets`.)

- [ ] **Step 3: `App.tsx`**

```tsx
import * as Application from 'expo-application';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  type AutocompleteItem,
  type Lang,
  type MapHandle,
  MapsLibVNMap,
  Marker,
  type Theme,
  usePlaces,
} from '@mapslibvn/react-native';

const API_KEY = process.env.EXPO_PUBLIC_MAPSLIBVN_KEY ?? '';
const API_BASE = process.env.EXPO_PUBLIC_MAPSLIBVN_API ?? 'https://api.ai-solutions.io.vn';

/** Ô tìm kiếm + danh sách gợi ý — dùng usePlaces với client của map qua context. */
function Search({ onPick }: { onPick: (item: AutocompleteItem) => void }) {
  const [q, setQ] = useState('');
  const { items, loading } = usePlaces(q, { near: [10.776, 106.7], limit: 6 });
  return (
    <View style={styles.search}>
      <TextInput
        style={styles.input}
        placeholder="Tìm địa điểm, ví dụ highlands"
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
          keyExtractor={(it, i) => it.id ?? `${it.type}-${i}`}
          ListEmptyComponent={
            <Text style={styles.hint}>{loading ? 'Đang tìm…' : 'Không có gợi ý'}</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                setQ('');
                onPick(item);
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
  const [picked, setPicked] = useState<AutocompleteItem | null>(null);

  if (!API_KEY) {
    return (
      <SafeAreaView style={styles.center}>
        <Text>Thiếu EXPO_PUBLIC_MAPSLIBVN_KEY — chạy `pnpm example:rn` từ gốc repo.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      <MapsLibVNMap
        apiKey={API_KEY}
        apiBase={API_BASE}
        style={theme}
        lang={lang}
        {...(Application.applicationId ? { bundleId: Application.applicationId } : {})}
        onLoad={setMap}
        onPoiClick={(poi) => Alert.alert(poi.name, `${poi.category} · ${poi.group}`)}
        onError={(e) => Alert.alert('Lỗi bản đồ', e.message)}
        testID="map"
      >
        {picked && <Marker lng={picked.lng} lat={picked.lat} color="#e53935" />}
      </MapsLibVNMap>

      <Search
        onPick={(item) => {
          setPicked(item);
          map?.flyTo([item.lng, item.lat], 16);
        }}
      />

      <View style={styles.toolbar}>
        <Pressable style={styles.btn} onPress={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          <Text style={styles.btnText}>{theme === 'light' ? 'Tối' : 'Sáng'}</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => setLang(lang === 'vi' ? 'en' : 'vi')}>
          <Text style={styles.btnText}>{lang === 'vi' ? 'EN' : 'VI'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
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
  toolbar: { position: 'absolute', right: 12, bottom: 48, gap: 8 },
  btn: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, elevation: 3 },
  btnText: { fontWeight: '600' },
});
```

- [ ] **Step 4: `.gitignore` và `README.md` của app**

`examples/embed-rn/.gitignore` (ghi đè file template):

```
node_modules/
.expo/
ios/
android/
vendor/
.env
*.log
```

`examples/embed-rn/README.md`:

```markdown
# App Expo thử độc lập

Dự án Expo **ngoài pnpm workspace**, không thuộc docs và không thuộc dự án nào khác, để chứng minh
`@mapslibvn/react-native` cài được như người ngoài (từ tarball, vì chưa publish npm — checklist B3)
và chạy trên iOS/Android bằng khoá `mobile` (nghiệm thu M6).

```bash
pnpm example:rn            # macOS: iOS simulator; nơi khác: Android
pnpm example:rn --android
pnpm example:rn --pack-only   # chỉ build + pack + cài
```

Khoá đọc từ `KEY_EXAMPLE_RN` trong `.env` gốc repo (cấp: xem `.env.example`); script ghi vào
`examples/embed-rn/.env` (gitignore) dưới `EXPO_PUBLIC_MAPSLIBVN_KEY`. Không chạy trên Expo Go
(cần native module) — `expo run:*` tự prebuild `ios/`/`android/` (gitignore).

Yêu cầu máy: Xcode + simulator, hoặc Android Studio + một AVD API ≥ 23; `npx expo doctor` xanh.
```

- [ ] **Step 5: Lint/format theo Biome và kiểm typecheck app**

Run: `pnpm exec biome check --write examples/embed-rn/App.tsx examples/embed-rn/index.ts && cd examples/embed-rn && npx tsc --noEmit && cd ../..`
Expected: biome format xong; `tsc` của app OK **sau khi** đã cài tarball (nếu chưa: chạy `pnpm example:rn --pack-only` trước — cần `KEY_EXAMPLE_RN` trong `.env`; nếu PHONG chưa cấp khoá, tạm `--key mlv_live_<24 chữ>` bất kỳ chỉ để pack/typecheck, không chạy app).

- [ ] **Step 6: Kiểm `pnpm lint` root không quét app**

Run: `pnpm lint`
Expected: exit 0. Nếu Biome báo lỗi trong `examples/embed-rn/**` (ví dụ `assets` hay file template): thêm `"examples/embed-rn/ios/**"`, `"examples/embed-rn/android/**"`, `"examples/embed-rn/.expo/**"` vào `files.ignore` của `biome.json` — `node_modules` đã bị ignore sẵn.

- [ ] **Step 7: Commit (không commit `.env`, `vendor/`, `ios/`, `android/`)**

```bash
git status --short examples/embed-rn   # xác nhận không có .env/vendor/ios/android
git add examples/embed-rn biome.json
git commit -m "feat(examples): app Expo thử độc lập embed-rn — tìm kiếm, marker, theme/lang, khoá mobile"
```

---

### Task 14: Khoá `mobile`, chạy thật iOS + Android, bằng chứng (nghiệm thu 1–5)

**Files:**
- Create: `docs/evidence/m6/ios-light-vi.png`, `ios-dark-en.png`, `ios-search-marker.png`, `ios-poi-alert.png`, `ios-attribution-dialog.png`, `android-light-vi.png`, `android-search-marker.png`, `android-poi-alert.png`
- Modify: `docs/DEVLOG.md` (mục 11 khởi tạo)

- [ ] **Step 1: Cấp khoá `mobile` (việc tay PHONG hoặc chạy với `DATABASE_URL` production qua Tunnel như M5)**

Run:
```bash
pnpm key:issue --tenant 00000000-0000-4000-8000-000000000002 --label "embed-rn thử độc lập" --kind mobile
```
Expected: in `kind : mobile scopes: places:read origins: (không kiểm)` và `KEY : mlv_live_…`. Dán vào `.env` gốc: `KEY_EXAMPLE_RN=mlv_live_…` (không nháy). Kiểm nhanh: `curl -s -H "X-Api-Key: $(grep KEY_EXAMPLE_RN .env | cut -d= -f2)" -H "X-Bundle-Id: vn.mapslibvn.demo" "https://api.ai-solutions.io.vn/v1/autocomplete?q=highlands" | head -c 200` → JSON `items`.

- [ ] **Step 2: Chạy iOS**

Run: `pnpm example:rn --ios`
Expected: 5 bước in ra; simulator mở app "MapsLibVN Demo"; bản đồ HCM nhãn tiếng Việt; dòng attribution góc dưới trái; nút "i" native góc dưới phải. Chụp `docs/evidence/m6/ios-light-vi.png` (`xcrun simctl io booted screenshot docs/evidence/m6/ios-light-vi.png`).

- [ ] **Step 3: Kịch bản nghiệm thu trên iOS**

1. Bấm "Tối" → theme dark; bấm "EN" → nhãn tiếng Anh; kéo tới Biển Đông (zoom ~5) xác nhận nhãn "Quần đảo Hoàng Sa (Việt Nam)"/"Quần đảo Trường Sa (Việt Nam)" **vẫn tiếng Việt** → chụp `ios-dark-en.png`.
2. Về "VI"/"Sáng"; gõ "highlands" → gợi ý hiện dưới 1 giây; chọn một dòng → camera bay tới, ghim đỏ hiện → chụp `ios-search-marker.png`.
3. Zoom ≥ 15 ở khu trung tâm, bấm một biểu tượng POI → Alert tên · loại → chụp `ios-poi-alert.png`.
4. Bấm dòng attribution → hộp thoại native liệt kê OSM/OpenMapTiles/Overture/Foursquare → chụp `ios-attribution-dialog.png`.
5. Kiểm không có tiles qua Worker: trong lúc thao tác, chạy `GH_TOKEN=… ` không cần — dùng Cloudflare Observability: truy vấn log Worker 10 phút gần nhất lọc `X-Bundle-Id` hoặc key mobile; xác nhận có `/v1/autocomplete`, có log dòng `X-Bundle-Id vn.mapslibvn.demo`, và **không có** `/v1/tiles/`. Ghi kết quả (số request, có/không) vào DEVLOG mục 11.

- [ ] **Step 4: Chạy Android**

Run: mở một AVD (Android Studio → Device Manager → Play) rồi `pnpm example:rn --android`
Expected: app cài lên emulator, bản đồ hiện. Lặp mục 2 và 3 của kịch bản → chụp `android-light-vi.png`, `android-search-marker.png`, `android-poi-alert.png` (`adb exec-out screencap -p > docs/evidence/m6/android-light-vi.png`).

- [ ] **Step 5: Analytics có khoá mobile**

Run: `pnpm report:weekly --dry-run` (hoặc truy vấn SQL API như `scripts/weekly-report.mjs` với khoảng thời gian hôm nay)
Expected: có dòng của khoá `embed-rn thử độc lập` (tenant `nhung_thu`) với số request > 0. Ghi số vào DEVLOG mục 11.

- [ ] **Step 6: Khởi tạo DEVLOG mục 11 + commit bằng chứng**

Thêm cuối `docs/DEVLOG.md`:

```markdown
## 11. Nghiệm thu M6 — `@mapslibvn/react-native` — (đang nghiệm thu)

| # | Tiêu chí (spec M6 mục 7) | Kết quả |
|---|---|---|
| 1 | iOS + Android chạy trọn, tiles thẳng từ R2, theme, lang=en giữ nhãn chủ quyền | <ĐẠT/CHƯA> — ảnh `docs/evidence/m6/ios-light-vi.png`, `ios-dark-en.png`, `android-light-vi.png`; Observability: 0 request `/v1/tiles/` |
| 2 | "highlands" gợi ý ≤ 1 s, chọn → flyTo + marker | <ĐẠT/CHƯA> — `ios-search-marker.png`, `android-search-marker.png` |
| 3 | Bấm POI → tên/loại | <ĐẠT/CHƯA> — `ios-poi-alert.png`, `android-poi-alert.png` |
| 4 | Attribution hiện, mở hộp thoại native, không tắt được | <ĐẠT/CHƯA> — `ios-attribution-dialog.png`; typecheck: không có prop tắt |
| 5 | Analytics có khoá mobile; log có X-Bundle-Id | <ĐẠT/CHƯA> — <N> request, `X-Bundle-Id=vn.mapslibvn.demo` |
| 6 | CI xanh 4 gói | (Task 15) |
| 7 | Trang docs react-native | (Task 15) |
```

```bash
git add docs/evidence/m6 docs/DEVLOG.md
git commit -m "docs(m6): bằng chứng chạy thật iOS/Android app Expo thử, nghiệm thu 1–5"
```

---

### Task 15: Trang docs "React Native", cập nhật spec/roadmap, đóng M6

**Files:**
- Create: `apps/docs/src/content/docs/react-native.md`
- Modify: `apps/docs/astro.config.mjs`, `apps/docs/src/content/docs/bat-dau.md`, `apps/docs/src/content/docs/index.mdx`, `apps/docs/e2e/docs.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md` (bảng mục 13), `docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md` (mục 7), `docs/DEVLOG.md`

- [ ] **Step 1: Link check thất bại trước (RED)**

Trong `apps/docs/e2e/docs.spec.ts`, thêm `'/react-native/',` vào mảng `PAGES` sau `'/bat-dau/',`.

Run: `pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e -- docs.spec.ts`
Expected: FAIL — `/react-native/` trả 404.

- [ ] **Step 2: Trang `react-native.md`**

```markdown
---
title: React Native
description: Nhúng bản đồ MapsLibVN vào app iOS/Android bằng @mapslibvn/react-native.
---

`@mapslibvn/react-native` bọc [`@maplibre/maplibre-react-native`](https://maplibre.org/maplibre-react-native/)
với cùng API như `@mapslibvn/react`: `<MapsLibVNMap>`, `<Marker>`, `useMap()`, `usePlaces()`.
Tiles và style dùng nguyên của web — MapLibre Native đọc `pmtiles://` trực tiếp từ CDN, không qua máy chủ.

## 1. Yêu cầu

| | Tối thiểu |
|---|---|
| React Native | 0.80, **New Architecture** bật (mặc định từ 0.76) |
| React | 19.1 |
| Expo (nếu dùng) | SDK 54; **không chạy trên Expo Go** — cần `expo run:*` hoặc EAS Build |
| Android | API 23 |
| Khoá API | kind **`mobile`** (không kiểm origin; `X-Bundle-Id` được ghi log) |

## 2. Cài đặt

**Expo**

```bash
npx expo install @maplibre/maplibre-react-native expo-application
npm install <đường dẫn tarball @mapslibvn/react-native>   # xem mục 6
```

`app.json`: thêm `"plugins": ["@maplibre/maplibre-react-native"]` và `"newArchEnabled": true`, rồi `npx expo run:ios` / `run:android`.

**Bare React Native**

```bash
npm install @maplibre/maplibre-react-native <tarball @mapslibvn/react-native>
cd ios && pod install
```

## 3. Dùng

```tsx
import * as Application from 'expo-application';
import { MapsLibVNMap, Marker, usePlaces } from '@mapslibvn/react-native';

export function Screen() {
  return (
    <MapsLibVNMap
      apiKey="mlv_live_…"
      apiBase="https://api.ai-solutions.io.vn"
      style="light"                 // 'light' | 'dark' | URL style riêng
      center={[106.7, 10.776]} zoom={13}
      lang="vi"                     // 'en' đổi nhãn; nhãn chủ quyền luôn tiếng Việt
      bundleId={Application.applicationId ?? undefined}
      onPoiClick={(poi) => console.log(poi.name, poi.category)}
      onLoad={(map) => map.flyTo([106.7, 10.776], 15)}
    >
      <Marker lng={106.7} lat={10.776} color="#e53935" />
    </MapsLibVNMap>
  );
}
```

`usePlaces(query, { near, limit })` trả `{ items, loading, error }` với debounce 200 ms — dùng trong
cây con của `<MapsLibVNMap>` (tự lấy client) hoặc truyền `client` riêng.

## 4. Khác với web

| Web (`@mapslibvn/react`) | React Native |
|---|---|
| `map.gl` là `maplibregl.Map` | `useMap().native` là ref `Map` của wrapper; `useMap().camera` là ref `Camera` |
| Đổi `center`/`zoom` tạo lại map | `center`/`zoom` chỉ là giá trị khởi tạo; dùng `useMap().flyTo` / `fitBounds` |
| `<Marker popupHtml>` | không có HTML; truyền `children` và `onPress` |
| Attribution `AttributionControl` | dòng MapsLibVN chồng góc dưới trái + nút "i" native; `compactAttribution` gọn, **không tắt được** |

Đổi `apiKey`, `apiBase`, `style`, `lang`, `poiLayer` sau khi mount sẽ tạo lại map và gọi `onLoad` lần nữa.

## 5. Khoá `mobile`

Khoá `mobile` không có `allowed_origins`; app gửi `bundleId` để máy chủ ghi `X-Bundle-Id` vào log và
báo cáo (chưa chặn — xem [Điều khoản tenant](/dieu-khoan/)). Khoá vẫn phải giữ trong cấu hình build
(`EXPO_PUBLIC_*`), không hard-code vào mã nguồn công khai.

## 6. Giới hạn hiện tại

- Chưa publish npm (đang rà soát nhãn hiệu). Cài từ tarball do `pnpm --filter @mapslibvn/react-native pack`
  sinh ra — app thử `examples/embed-rn` trong repo minh hoạ trọn quy trình bằng `pnpm example:rn`.
- Chưa có tiles offline; MapLibre Native đọc được PMTiles `file://` nên có thể thêm sau.

Đọc thêm: [Bắt đầu 5 phút](/bat-dau/) (web), [Giấy phép & ghi nguồn](/giay-phep/).
```

- [ ] **Step 3: Sidebar, `bat-dau.md`, `index.mdx`**

`apps/docs/astro.config.mjs`: trong nhóm "Hướng dẫn", sau `{ label: 'Bắt đầu 5 phút', slug: 'bat-dau' },` thêm `{ label: 'React Native', slug: 'react-native' },`.

`apps/docs/src/content/docs/bat-dau.md`: đổi `description` thành `Nhúng bản đồ MapsLibVN bằng script tag, npm, React hoặc React Native.`; trước mục "## 3. Tuỳ chọn" thêm:

```markdown
## 2b. React Native

App iOS/Android dùng `@mapslibvn/react-native` với cùng props (`style`, `lang`, `poiLayer`,
`onPoiClick`) và khoá kind `mobile`. Xem [React Native](/react-native/).
```

`apps/docs/src/content/docs/index.mdx`: trong `<CardGrid>` thêm:

```mdx
  <Card title="Web và React Native" icon="laptop">`@mapslibvn/web`, `@mapslibvn/react` cho web; `@mapslibvn/react-native` cho iOS/Android — cùng API, cùng tiles. Xem [React Native](/react-native/).</Card>
```

- [ ] **Step 4: Build docs + link check xanh**

Run: `pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e -- docs.spec.ts`
Expected: 9 trang PASS (kể cả `/react-native/`).

- [ ] **Step 5: Spec gốc bảng 13 + roadmap mục 7**

Trong `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md`, sau hàng `| **M5** Phát hành nội bộ | … |` của bảng mục 13 thêm:

```markdown
| **M6** React Native | `@mapslibvn/react-native` bọc `@maplibre/maplibre-react-native` 11.3+; core thêm `headers`, `PoiFeature`, biến đổi style thuần; app Expo thử `examples/embed-rn` + `pnpm example:rn`; trang docs; khoá `mobile` thử nghiệm (spec riêng 2026-09-03) | App thử chạy trên iOS và Android bằng khoá `mobile`, tiles thẳng từ R2, poiClick, attribution không tắt được; Analytics có khoá mobile; CI 4 gói xanh; trang docs deploy | 1–1,5 tuần |
```

và đổi dòng `Tổng ≈ 8 tuần làm việc. Sau M5: spec React Native SDK.` thành `Tổng ≈ 8 tuần cho M1–M5; M6 React Native thêm 1–1,5 tuần (spec riêng \`docs/superpowers/specs/2026-09-03-react-native-sdk-design.md\`).`

Trong `docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md`: bảng mục 0.4 hàng 7 đổi tên file thành `2026-09-03-m6-react-native.md` và trạng thái `**Đã xong <ngày>**`; cuối mục 7 thêm dòng `- [x] M6 nghiệm thu <ngày> — DEVLOG mục 11`.

- [ ] **Step 6: DEVLOG đóng mốc**

- Mục 11: đổi tiêu đề thành `## 11. Nghiệm thu M6 — \`@mapslibvn/react-native\` — **ĐẠT <ngày>**`; điền hàng 6 (`CI <sha> xanh: lint, notices 8 bản sao, typecheck, <N> test`) và hàng 7 (`https://mapslibvn-docs.pages.dev/react-native/`).
- Mục 1: `Mốc: **M6 — React Native đã nghiệm thu <ngày>**`, tóm tắt 4 dòng (gói, app thử, docs, khoá).
- Mục 2: `**Bước kế tiếp:** không còn mốc định nghĩa sẵn. Việc tay mục B/C checklist pháp lý; khi B3 xong → publish 4 gói npm (bao gồm @mapslibvn/react-native).`
- Mục 3: một dòng cho 8 quyết định thiết kế của plan này (mục "Quyết định thiết kế" ở đầu file) — kèm dòng về `StyleSpecification` cast nếu Task 8 phải làm.
- Mục 4: dòng nhật ký `<ngày> · **M6 XONG** · …`.

- [ ] **Step 7: Gate cuối, commit, push, CI**

Run: `pnpm lint && node scripts/notices-sync.mjs --check && pnpm typecheck && pnpm test`
Expected: exit 0.

```bash
git add apps/docs docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md docs/superpowers/plans/2026-09-03-m6-react-native.md docs/DEVLOG.md
git commit -m "docs(m6): trang React Native, spec bảng 13 hàng M6, roadmap; nghiệm thu M6 ĐẠT"
git push origin main
GH_TOKEN="$(cat ~/.config/gh-dotienphong.token)" gh run watch --repo dotienphong/maps-library-vietnam --exit-status
```

Expected: CI + Deploy Docs `success`; `curl -sI https://mapslibvn-docs.pages.dev/react-native/ | head -1` → `HTTP/2 200`. Điền sha CI vào DEVLOG mục 11 hàng 6 nếu còn placeholder, amend commit rồi push lại.

- [ ] **Step 8: Cập nhật memory dự án**

Cập nhật `~/.claude/projects/-Users-dtphong-Desktop-software-business-mapsLibVN/memory/trang-thai-moc-hien-tai.md`: M6 nghiệm thu <ngày>; bước kế tiếp = việc tay checklist B/C; lệnh hữu ích `pnpm example:rn`. Cập nhật dòng chỉ mục trong `MEMORY.md`.
