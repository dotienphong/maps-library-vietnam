# Dẫn đường trong Playground — Plan thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playground (`/playground.html`) có chế độ dẫn đường kiểu Google Maps — GPS lúc mở, hai ô điểm đi/đến (autocomplete, bấm bản đồ, bấm POI), đổi phương tiện tự tính lại tuyến, tuyến thay thế bấm đổi, "Bắt đầu"/"Giả lập" chuyển sang banner rẽ + thanh ETA toàn màn hình; gỡ trang `/dan-duong-demo/`.

**Architecture:** Toàn bộ trong `apps/docs/public/`: module mới `playground-nav.js` (ESM, sở hữu DOM dẫn đường, gọi `map.places/routes/navigation` của SDK UMD, báo thay đổi qua `onChange`), CSS riêng `playground-nav.css`, hàm thuần thêm vào `playground-lib.js` (có unit test Node), `playground.js` chỉ nối: GPS lúc tải, nút vào chế độ, chuyển click/POI, đồng bộ URL và mã nhúng. Spec: `docs/superpowers/specs/2026-09-12-playground-dan-duong-design.md`.

**Tech Stack:** Vanilla JS ESM + JSDoc (Biome kiểm, không `tsc`), SDK UMD `MapsLibVN` (đã xuất `createMap`, `playbackSource`, `simulateFixes`, `formatDistanceShort`, `maplibregl`), Vitest (Node) cho `playground-lib`, Playwright cho E2E (`apps/docs/e2e`, API local `dev:e2e` + `?fixture=1` để không cần Valhalla).

---

## 0. Quy ước cho mọi task

- Lệnh chạy từ **gốc repo** trừ khi ghi khác. Unit test: `pnpm exec vitest run apps/docs/scripts/playground-lib.test.mjs`. E2E: `cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "<tên>"` (Playwright tự dựng API local và `pnpm preview`; **phải `pnpm --filter @mapslibvn/docs build` trước** vì preview đọc `dist/`). Lint: `pnpm lint` (Biome: không `forEach`, không gán trong biểu thức, không `!`).
- **Đính chính so với spec:** bảng điều khiển playground nằm **bên trái** (`#panel { left: 12px; width: 360px }`), không phải bên phải. Thẻ dẫn đường thế chỗ đúng vị trí đó; nút "⋯ Công cụ" mở lại bảng ở cùng chỗ. Không đổi gì khác trong spec.
- Nút vào chế độ **không** có `role="tab"` (E2E hiện có đếm đúng 4 tab). Trong chế độ dẫn đường, `document.body.dataset.nav = '1'`; CSS ẩn `#panel` theo thuộc tính này.
- Chỉ `playground-nav.js` đụng vào phần tử `#nav-*`; chỉ `playground.js` đụng `state`/URL/`#panel`.
- `?fixture=1` → provider trả `/fixtures/directions-q1.json` cho mọi yêu cầu (file đã có từ spec B Task 3, được `scripts/copy-sdk.mjs` chép lúc prebuild).
- Commit sau mỗi task, Conventional Commits tiếng Việt, kết thúc bằng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Không push (PHONG quyết). Tick checkbox của task trong file này ở bước cuối.

## 1. Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `apps/docs/public/playground-lib.js` | thêm `NavPoint`, `pointFromAutocomplete/Poi/LngLat`, `directionsRequest`, `shortDistance`, `routeSummary`, `etaLabel`, `navSnippet`; `parseState/toSearchParams` thêm `tab`, `tmode`, `from`, `to` |
| `apps/docs/scripts/playground-lib.test.mjs` | test cho các hàm trên |
| `apps/docs/public/playground-nav.css` (mới) | thẻ lập kế hoạch, banner, thanh ETA, popup chọn điểm, chip, fab |
| `apps/docs/public/playground.html` | nút "Dẫn đường", markup `#nav-*`, fab `#locate`, `#tools`, link CSS |
| `apps/docs/public/playground-nav.js` (mới) | `initNavigation(...)` — toàn bộ hành vi chế độ dẫn đường |
| `apps/docs/public/playground.js` | GPS lúc tải + chấm vị trí, khởi tạo/tái tạo nav, chuyển click/POI, URL, mã nhúng |
| `apps/docs/e2e/playground.spec.ts` | 6 ca E2E mới |
| `apps/docs/e2e/docs.spec.ts`, `astro.config.mjs`, `src/content/docs/dan-duong.md` | bỏ `/dan-duong-demo/`, trỏ về playground |
| Xoá | `apps/docs/src/pages/dan-duong-demo.astro`, `apps/docs/src/lib/dan-duong-demo.ts`, `apps/docs/e2e/dan-duong-demo.spec.ts` |
| `docs/evidence/navigation/2026-09-XX-playground-dan-duong.md` | evidence phát hành |

---

### Task 1: Hàm thuần — điểm, yêu cầu tuyến, định dạng

**Files:**
- Modify: `apps/docs/public/playground-lib.js`
- Test: `apps/docs/scripts/playground-lib.test.mjs`

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `apps/docs/scripts/playground-lib.test.mjs` (và thêm các tên hàm mới vào `import { … } from '../public/playground-lib.js'` ở đầu file: `pointFromAutocomplete`, `pointFromPoi`, `pointFromLngLat`, `directionsRequest`, `shortDistance`, `routeSummary`, `etaLabel`):

```js
describe('pointFrom*', () => {
  it('autocomplete: lấy lng/lat/name; area thiếu toạ độ thì lấy tâm bbox', () => {
    expect(pointFromAutocomplete({ type: 'street', name: 'Nguyễn Du', lng: 106.699, lat: 10.78 }))
      .toEqual({ lng: 106.699, lat: 10.78, label: 'Nguyễn Du' });
    expect(pointFromAutocomplete({ type: 'area', name: 'Quận 1', bbox: [106.69, 10.77, 106.71, 10.79] }))
      .toEqual({ lng: 106.7, lat: 10.78, label: 'Quận 1' });
  });
  it('poi: lngLat [lng, lat] và tên', () => {
    expect(pointFromPoi({ id: 'p1', name: 'Chợ Bến Thành', category: 'market', group: 'shop', lngLat: [106.6981, 10.7725] }))
      .toEqual({ lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' });
  });
  it('lngLat: nhãn "lat, lng" bốn chữ số lẻ', () => {
    expect(pointFromLngLat([106.699012, 10.779834]))
      .toEqual({ lng: 106.699012, lat: 10.779834, label: '10.7798, 106.6990' });
  });
});

describe('directionsRequest', () => {
  it('đảo [lng,lat] → [lat,lng], luôn xin tuyến thay thế, có lang', () => {
    const from = { lng: 106.699, lat: 10.7798, label: 'A' };
    const to = { lng: 106.698, lat: 10.7725, label: 'B' };
    expect(directionsRequest({ from, to, mode: 'car', lang: 'vi' })).toEqual({
      from: [10.7798, 106.699],
      to: [10.7725, 106.698],
      mode: 'car',
      lang: 'vi',
      alternatives: true,
    });
  });
});

describe('shortDistance / routeSummary / etaLabel', () => {
  it('shortDistance: mét dưới 1 km, km một chữ số lẻ dấu phẩy, nguyên từ 10 km', () => {
    expect(shortDistance(85.4)).toBe('85 m');
    expect(shortDistance(1140)).toBe('1,1 km');
    expect(shortDistance(12_400)).toBe('12 km');
  });
  it('routeSummary: quãng đường, phút làm tròn (tối thiểu 1), tên đường của bước dài nhất', () => {
    const route = {
      distance_m: 1148,
      duration_s: 250,
      legs: [
        {
          steps: [
            { distance_m: 140, street_names: ['Công trường Công xã Paris'] },
            { distance_m: 333, street_names: ['Nam Kỳ Khởi Nghĩa'] },
            { distance_m: 0, street_names: [] },
          ],
        },
      ],
    };
    expect(routeSummary(route)).toEqual({ distanceText: '1,1 km', minutes: 4, via: 'Nam Kỳ Khởi Nghĩa' });
    expect(routeSummary({ distance_m: 20, duration_s: 5, legs: [{ steps: [{ distance_m: 20, street_names: [] }] }] }))
      .toEqual({ distanceText: '20 m', minutes: 1, via: null });
  });
  it('etaLabel: "phút · quãng · HH:MM" theo giờ máy', () => {
    const now = new Date(2026, 8, 12, 10, 38, 0).getTime();
    expect(etaLabel(250, 950, now)).toBe('4 phút · 950 m · 10:42');
    expect(etaLabel(0, 0, now)).toBe('0 phút · 0 m · 10:38');
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run apps/docs/scripts/playground-lib.test.mjs`
Expected: FAIL — `does not provide an export named 'pointFromAutocomplete'`.

- [ ] **Step 3: Viết hàm**

Thêm vào cuối `apps/docs/public/playground-lib.js`:

```js
/* ---------- Dẫn đường ---------- */

/**
 * Một điểm đi/đến của chế độ dẫn đường.
 * @typedef {{ lng: number, lat: number, label: string }} NavPoint
 */

/** Phương tiện hợp lệ của `GET /v1/directions`. */
export const TRAVEL_MODES = ['motorbike', 'car', 'walk'];

/**
 * @param {{ name: string, lng?: number, lat?: number, bbox?: [number, number, number, number] }} item
 * @returns {NavPoint}
 */
export function pointFromAutocomplete(item) {
  if (typeof item.lng === 'number' && typeof item.lat === 'number') {
    return { lng: item.lng, lat: item.lat, label: item.name };
  }
  const [minLng, minLat, maxLng, maxLat] = item.bbox ?? [0, 0, 0, 0];
  return { lng: round6((minLng + maxLng) / 2), lat: round6((minLat + maxLat) / 2), label: item.name };
}

/**
 * @param {{ name: string, lngLat: [number, number] }} poi
 * @returns {NavPoint}
 */
export function pointFromPoi(poi) {
  return { lng: poi.lngLat[0], lat: poi.lngLat[1], label: poi.name };
}

/**
 * @param {[number, number]} lngLat
 * @returns {NavPoint}
 */
export function pointFromLngLat([lng, lat]) {
  return { lng, lat, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
}

/**
 * Tham số cho `client.directions()` — API nhận `[lat, lng]`, luôn xin tuyến thay thế.
 * @param {{ from: NavPoint, to: NavPoint, mode: string, lang: string }} input
 */
export function directionsRequest({ from, to, mode, lang }) {
  return {
    from: /** @type {[number, number]} */ ([from.lat, from.lng]),
    to: /** @type {[number, number]} */ ([to.lat, to.lng]),
    mode,
    lang,
    alternatives: true,
  };
}

/**
 * "85 m", "1,1 km", "12 km" — cùng quy tắc với `formatDistanceShort` của SDK, viết lại để test thuần.
 * @param {number} m
 */
export function shortDistance(m) {
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`;
}

/**
 * Tóm tắt một tuyến cho danh sách chọn tuyến.
 * @param {{ distance_m: number, duration_s: number,
 *   legs: { steps: { distance_m: number, street_names: string[] }[] }[] }} route
 * @returns {{ distanceText: string, minutes: number, via: string | null }}
 */
export function routeSummary(route) {
  let via = null;
  let longest = -1;
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      const name = step.street_names[0];
      if (name && step.distance_m > longest) {
        longest = step.distance_m;
        via = name;
      }
    }
  }
  return {
    distanceText: shortDistance(route.distance_m),
    minutes: Math.max(1, Math.round(route.duration_s / 60)),
    via,
  };
}

/**
 * "4 phút · 950 m · 10:42" cho thanh dưới khi đang dẫn đường.
 * @param {number} remaining_s
 * @param {number} remaining_m
 * @param {number} nowMs
 */
export function etaLabel(remaining_s, remaining_m, nowMs) {
  const arrive = new Date(nowMs + remaining_s * 1000);
  const hh = String(arrive.getHours()).padStart(2, '0');
  const mm = String(arrive.getMinutes()).padStart(2, '0');
  return `${Math.round(remaining_s / 60)} phút · ${shortDistance(remaining_m)} · ${hh}:${mm}`;
}
```

- [ ] **Step 4: Chạy test, lint**

Run: `pnpm exec vitest run apps/docs/scripts/playground-lib.test.mjs && pnpm lint`
Expected: PASS toàn bộ (kể cả các test cũ), lint sạch.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/public/playground-lib.js apps/docs/scripts/playground-lib.test.mjs
git commit -m "feat(playground): hàm thuần cho dẫn đường — điểm, yêu cầu tuyến, tóm tắt tuyến, ETA

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: State/URL `tab`, `tmode`, `from`, `to` và mã nhúng dẫn đường

**Files:**
- Modify: `apps/docs/public/playground-lib.js` (`parseState`, `toSearchParams`, thêm `navSnippet`)
- Test: `apps/docs/scripts/playground-lib.test.mjs`

- [ ] **Step 1: Cập nhật test cũ và viết test mới**

Trong `describe('parseState')`, ca `'trả mặc định khi không có tham số'` thêm vào object kỳ vọng (sau `embed: false,`):

```js
      tab: null,
      tmode: 'motorbike',
      from: null,
      to: null,
```

Ca `'đi vòng tròn được với parseState'` thêm vào `original` (sau `zoom: 11.5,`):

```js
      tab: 'dan-duong',
      tmode: 'walk',
      from: { lng: 106.699, lat: 10.7798, label: 'Nhà thờ Đức Bà, Quận 1' },
      to: { lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' },
```

Thêm describe mới (import thêm `navSnippet`):

```js
describe('state dẫn đường trên URL', () => {
  it('đọc tab, tmode, from, to; nhãn có dấu và dấu phẩy', () => {
    const s = parseState(
      'tab=dan-duong&tmode=car&from=10.7798,106.699,Nh%C3%A0%20th%E1%BB%9D%2C%20Q1&to=10.7725,106.6981',
      API,
    );
    expect(s.tab).toBe('dan-duong');
    expect(s.tmode).toBe('car');
    expect(s.from).toEqual({ lng: 106.699, lat: 10.7798, label: 'Nhà thờ, Q1' });
    expect(s.to).toEqual({ lng: 106.6981, lat: 10.7725, label: '10.7725, 106.6981' });
  });
  it('bỏ qua tmode lạ, điểm sai định dạng, tab khác', () => {
    const s = parseState('tab=xyz&tmode=plane&from=abc&to=10.7,200', API);
    expect(s.tab).toBeNull();
    expect(s.tmode).toBe('motorbike');
    expect(s.from).toBeNull();
    expect(s.to).toBeNull();
  });
  it('toSearchParams chỉ in khi khác mặc định; from trống = vị trí của tôi', () => {
    const base = parseState('', API);
    expect(toSearchParams(base, API).toString()).toBe('');
    const p = toSearchParams(
      { ...base, tab: 'dan-duong', tmode: 'walk', to: { lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' } },
      API,
    );
    expect(p.get('tab')).toBe('dan-duong');
    expect(p.get('tmode')).toBe('walk');
    expect(p.get('from')).toBeNull();
    expect(p.get('to')).toBe('10.7725,106.6981,Chợ Bến Thành');
  });
});

describe('navSnippet', () => {
  it('sinh mã 3 bước với toạ độ [lat, lng], mode và điểm đi mặc định là GPS', () => {
    const s = {
      ...parseState('', API),
      tmode: 'car',
      to: { lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' },
    };
    const code = navSnippet(s);
    expect(code).toContain("import { createMap } from '@mapslibvn/web';");
    expect(code).toContain('to: [10.7725, 106.6981], // Chợ Bến Thành');
    expect(code).toContain("mode: 'car',");
    expect(code).toContain('navigator.geolocation.getCurrentPosition');
    expect(code).toContain('map.routes.show(response);');
    expect(code).toContain('map.navigation.start({ response })');
  });
  it('có from thì dùng thẳng toạ độ, không xin GPS', () => {
    const s = {
      ...parseState('', API),
      from: { lng: 106.699, lat: 10.7798, label: 'Nhà thờ Đức Bà' },
      to: { lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' },
    };
    const code = navSnippet(s);
    expect(code).toContain('from: [10.7798, 106.699], // Nhà thờ Đức Bà');
    expect(code).not.toContain('getCurrentPosition');
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run apps/docs/scripts/playground-lib.test.mjs`
Expected: FAIL — ca mặc định lệch (thiếu `tab/tmode/from/to`), `navSnippet` không tồn tại.

- [ ] **Step 3: Sửa `parseState`, `toSearchParams`, thêm `navSnippet`**

Trong `apps/docs/public/playground-lib.js`:

Thêm vào `@typedef PlaygroundState` bốn dòng:

```js
 * @property {'dan-duong' | null} tab Đang ở chế độ dẫn đường.
 * @property {'motorbike' | 'car' | 'walk'} tmode Phương tiện dẫn đường.
 * @property {NavPoint | null} from Điểm đi; null = vị trí của tôi.
 * @property {NavPoint | null} to Điểm đến.
```

Thêm hai hàm nội bộ ngay trên `parseState`:

```js
/**
 * `lat,lng[,nhãn]` → NavPoint; nhãn có thể chứa dấu phẩy nên chỉ tách hai phần đầu.
 * @param {string | null} raw
 * @returns {NavPoint | null}
 */
function parsePoint(raw) {
  if (!raw) return null;
  const first = raw.indexOf(',');
  const second = first < 0 ? -1 : raw.indexOf(',', first + 1);
  const latText = first < 0 ? raw : raw.slice(0, first);
  const lngText = first < 0 ? '' : second < 0 ? raw.slice(first + 1) : raw.slice(first + 1, second);
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  const label = second < 0 ? '' : raw.slice(second + 1).trim();
  return { lng: round6(lng), lat: round6(lat), label: label || `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
}

/** @param {NavPoint} point */
const pointParam = (point) => `${round6(point.lat)},${round6(point.lng)},${point.label}`;
```

Trong `parseState`, thay `return { … }` để có thêm bốn trường (đặt sau `embed:`):

```js
    embed: params.get('embed') === '1',
    tab: params.get('tab') === 'dan-duong' ? 'dan-duong' : null,
    tmode: /** @type {'motorbike' | 'car' | 'walk'} */ (
      TRAVEL_MODES.includes(params.get('tmode') ?? '') ? params.get('tmode') : 'motorbike'
    ),
    from: parsePoint(params.get('from')),
    to: parsePoint(params.get('to')),
```

Trong `toSearchParams`, trước `if (state.embed)`:

```js
  if (state.tab === 'dan-duong') params.set('tab', 'dan-duong');
  if (state.tmode !== 'motorbike') params.set('tmode', state.tmode);
  if (state.from) params.set('from', pointParam(state.from));
  if (state.to) params.set('to', pointParam(state.to));
```

Thêm cuối file:

```js
/**
 * Mã nhúng dẫn đường (ESM) theo điểm và phương tiện đang chọn — bám trang /dan-duong/ mục 1.
 * @param {PlaygroundState} state
 */
export function navSnippet(state) {
  const to = state.to ?? { lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' };
  const fromLine = state.from
    ? `  from: [${round6(state.from.lat)}, ${round6(state.from.lng)}], // ${state.from.label}`
    : '  from: [pos.coords.latitude, pos.coords.longitude], // vị trí của tôi';
  const body = [
    'const response = await map.places.directions({',
    fromLine,
    `  to: [${round6(to.lat)}, ${round6(to.lng)}], // ${to.label}`,
    `  mode: '${state.tmode}',`,
    '  alternatives: true,',
    '});',
    'map.routes.show(response);',
    'map.fitBounds(response.routes[0].bbox, 60);',
    "startButton.onclick = () => map.navigation.start({ response }); // trong sự kiện bấm nút",
  ];
  const wrapped = state.from
    ? body
    : [
        'navigator.geolocation.getCurrentPosition(async (pos) => {',
        ...body.map((line) => `  ${line}`),
        '});',
      ];
  return [
    "import { createMap } from '@mapslibvn/web';",
    "import * as maplibregl from 'maplibre-gl';",
    "import 'maplibre-gl/dist/maplibre-gl.css';",
    '',
    'const map = createMap(',
    '  {',
    optionLines(state, '    '),
    '  },',
    '  { maplibre: maplibregl },',
    ');',
    '',
    ...wrapped,
  ].join('\n');
}
```

- [ ] **Step 4: Chạy test, lint**

Run: `pnpm exec vitest run apps/docs/scripts/playground-lib.test.mjs && pnpm lint`
Expected: PASS; lint sạch.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/public/playground-lib.js apps/docs/scripts/playground-lib.test.mjs
git commit -m "feat(playground): state URL tab/tmode/from/to và mã nhúng dẫn đường

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Markup và CSS chế độ dẫn đường

**Files:**
- Modify: `apps/docs/public/playground.html`
- Create: `apps/docs/public/playground-nav.css`

- [ ] **Step 1: Sửa `playground.html`**

Trong `<head>`, sau `<link rel="stylesheet" href="/playground.css" />`:

```html
  <link rel="stylesheet" href="/playground-nav.css" />
```

Trong `<div class="pg-quick">`, sau thẻ `<mapslibvn-autocomplete id="ac" …>`:

```html
      <button id="enter-nav" type="button" class="pg-nav-enter">🧭 Dẫn đường</button>
```

Ngay sau `<div id="status" …>Đang tải…</div>` (trước `<aside id="panel"`):

```html
  <!-- Nút nổi trên bản đồ -->
  <button id="locate" type="button" class="pg-fab" title="Vị trí của tôi" aria-label="Vị trí của tôi">◎</button>
  <button id="tools" type="button" class="pg-fab pg-fab-tools" hidden aria-label="Mở công cụ">⋯ Công cụ</button>

  <!-- Chế độ dẫn đường: thẻ lập kế hoạch -->
  <section id="nav-card" class="nav-card" hidden aria-label="Lập kế hoạch dẫn đường">
    <header class="nav-card-head">
      <strong>Dẫn đường</strong>
      <button id="nav-exit" type="button" class="nav-icon" aria-label="Thoát dẫn đường">✕</button>
    </header>
    <div class="nav-points">
      <div class="nav-point nav-point-from">
        <span class="nav-dot nav-dot-from" aria-hidden="true"></span>
        <mapslibvn-autocomplete id="nav-from" placeholder="Điểm đi"></mapslibvn-autocomplete>
      </div>
      <button id="nav-swap" type="button" class="nav-icon" aria-label="Đổi chiều">⇅</button>
      <div class="nav-point nav-point-to">
        <span class="nav-dot nav-dot-to" aria-hidden="true"></span>
        <mapslibvn-autocomplete id="nav-to" placeholder="Điểm đến"></mapslibvn-autocomplete>
      </div>
    </div>
    <div class="nav-modes" role="group" aria-label="Phương tiện">
      <button type="button" class="nav-mode" data-mode="motorbike" aria-pressed="true">🏍 Xe máy</button>
      <button type="button" class="nav-mode" data-mode="car" aria-pressed="false">🚗 Ô tô</button>
      <button type="button" class="nav-mode" data-mode="walk" aria-pressed="false">🚶 Đi bộ</button>
    </div>
    <p id="nav-msg" class="nav-msg">Chọn điểm đến bằng ô tìm kiếm hoặc bấm lên bản đồ.</p>
    <ol id="nav-routes" class="nav-routes" aria-label="Các tuyến"></ol>
    <details id="nav-steps-box" class="nav-steps-box" hidden>
      <summary>Chi tiết bước</summary>
      <ol id="nav-steps" class="nav-steps"></ol>
    </details>
    <div class="nav-actions">
      <button id="nav-start" type="button" class="nav-primary" disabled>▶ Bắt đầu</button>
      <button id="nav-simulate" type="button" disabled>Giả lập</button>
    </div>
  </section>

  <!-- Chế độ dẫn đường: đang đi -->
  <div id="nav-banner" class="nav-banner" hidden data-status="idle" role="status" aria-live="polite">
    <div class="nav-banner-main">
      <span id="nav-icon" class="nav-banner-icon" aria-hidden="true">•</span>
      <div>
        <div id="nav-distance" class="nav-banner-distance">—</div>
        <div id="nav-instruction" class="nav-banner-text">—</div>
      </div>
    </div>
    <p id="nav-subtitle" class="nav-subtitle" hidden></p>
  </div>
  <div id="nav-bar" class="nav-bar" hidden>
    <span id="nav-eta">—</span>
    <button id="nav-recenter" type="button" hidden>Về vị trí</button>
    <button id="nav-stop" type="button" class="nav-stop">Dừng</button>
  </div>

  <!-- Popup chọn điểm khi bấm lên bản đồ / POI -->
  <template id="nav-popup-template">
    <div class="nav-popup">
      <p class="nav-popup-label"></p>
      <button type="button" data-kind="from">Đi từ đây</button>
      <button type="button" data-kind="to">Đến đây</button>
    </div>
  </template>
```

- [ ] **Step 2: Tạo `playground-nav.css`**

```css
/* Chế độ dẫn đường trong Playground — dùng biến màu của playground.css. */

/* Nút vào chế độ trong bảng điều khiển */
.pg-quick .pg-nav-enter {
  width: 100%;
  margin-top: 10px;
  padding: 9px 12px;
  border: 1px solid var(--pg-accent);
  border-radius: 8px;
  background: var(--pg-accent);
  color: var(--pg-accent-fg);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

/* Nút nổi trên bản đồ */
.pg-fab {
  position: fixed;
  right: 12px;
  z-index: 15;
  width: 42px;
  height: 42px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--pg-bg);
  color: var(--pg-fg);
  box-shadow: var(--pg-shadow);
  font: inherit;
  font-size: 20px;
  cursor: pointer;
}
#locate { bottom: 40px; }
#locate[aria-pressed="true"] { color: var(--pg-accent); }
.pg-fab-tools {
  top: 12px;
  width: auto;
  height: auto;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
}

/* Chấm vị trí của tôi (marker element) */
.pg-my-location {
  width: 16px;
  height: 16px;
  border: 3px solid #fff;
  border-radius: 50%;
  background: #2458a6;
  box-shadow: 0 0 0 6px rgba(36, 88, 166, 0.18), 0 1px 4px rgba(0, 0, 0, 0.35);
}

/* Trong chế độ dẫn đường: giấu bảng điều khiển, hiện nút Công cụ */
body[data-nav="1"] #panel { display: none; }
body[data-nav="1"][data-tools="1"] #panel { display: flex; z-index: 30; }
body[data-nav="1"] #status { left: 396px; }

/* Thẻ lập kế hoạch — thế chỗ bảng điều khiển bên trái */
.nav-card {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 360px;
  max-height: calc(100vh - 24px);
  padding: 12px 14px 14px;
  box-sizing: border-box;
  overflow: auto;
  border-radius: 12px;
  background: var(--pg-bg);
  color: var(--pg-fg);
  box-shadow: var(--pg-shadow);
}
.nav-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.nav-icon {
  padding: 4px 8px;
  border: 1px solid var(--pg-border);
  border-radius: 6px;
  background: var(--pg-bg);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.nav-points {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 8px;
  align-items: center;
}
.nav-point {
  display: grid;
  grid-template-columns: 14px 1fr;
  gap: 8px;
  align-items: center;
}
.nav-point mapslibvn-autocomplete { display: block; min-width: 0; }
.nav-points #nav-swap { grid-row: 1 / span 2; }
.nav-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--pg-bg);
  box-shadow: 0 0 0 1px var(--pg-border);
}
.nav-dot-from { background: #2458a6; }
.nav-dot-to { background: #d92d20; }
.nav-modes { display: flex; gap: 6px; }
.nav-mode {
  flex: 1;
  padding: 7px 4px;
  border: 1px solid var(--pg-border);
  border-radius: 999px;
  background: var(--pg-bg);
  color: var(--pg-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.nav-mode[aria-pressed="true"] {
  border-color: var(--pg-accent);
  background: var(--pg-accent);
  color: var(--pg-accent-fg);
  font-weight: 600;
}
.nav-card[aria-busy="true"] .nav-modes,
.nav-card[aria-busy="true"] .nav-routes { opacity: 0.5; }
.nav-msg { margin: 0; color: var(--pg-muted); font-size: 13px; }
.nav-msg[data-state="error"] { color: #a5301f; }
.nav-routes { margin: 0; padding: 0; list-style: none; }
.nav-routes li + li { margin-top: 4px; }
.nav-routes button {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--pg-border);
  border-left-width: 4px;
  border-radius: 8px;
  background: var(--pg-bg);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.nav-routes button[aria-pressed="true"] { border-left-color: var(--pg-accent); background: var(--pg-soft); }
.nav-routes strong { font-size: 15px; }
.nav-routes small { display: block; color: var(--pg-muted); font-size: 12px; }
.nav-steps-box summary { cursor: pointer; color: var(--pg-muted); font-size: 12px; }
.nav-steps { margin: 6px 0 0; padding-left: 18px; font-size: 13px; }
.nav-steps li { margin: 3px 0; }
.nav-actions { display: flex; gap: 8px; }
.nav-actions button {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--pg-border);
  border-radius: 8px;
  background: var(--pg-bg);
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.nav-actions button:disabled { opacity: 0.5; cursor: default; }
.nav-actions .nav-primary { border-color: var(--pg-accent); background: var(--pg-accent); color: var(--pg-accent-fg); }

/* Đang dẫn đường */
.nav-banner {
  position: fixed;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 20;
  padding: 12px 16px;
  border-radius: 12px;
  background: #1a4f9c;
  color: #fff;
  box-shadow: var(--pg-shadow);
}
.nav-banner[data-status="off_route"],
.nav-banner[data-status="rerouting"] { background: #b54708; }
.nav-banner[data-status="error"] { background: #a5301f; }
.nav-banner[data-status="arrived"] { background: #1a7f37; }
.nav-banner-main { display: grid; grid-template-columns: 56px 1fr; gap: 12px; align-items: center; }
.nav-banner-icon { font-size: 44px; line-height: 1; text-align: center; }
.nav-banner-distance { font-size: 30px; font-weight: 800; line-height: 1.1; }
.nav-banner-text { font-size: 18px; font-weight: 600; }
.nav-subtitle { margin: 8px 0 0; font-size: 13px; opacity: 0.85; }
.nav-bar {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--pg-bg);
  color: var(--pg-fg);
  box-shadow: var(--pg-shadow);
  font-weight: 600;
}
.nav-bar #nav-eta { flex: 1; }
.nav-bar button {
  padding: 8px 12px;
  border: 1px solid var(--pg-border);
  border-radius: 8px;
  background: var(--pg-bg);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.nav-bar .nav-stop { border-color: #d92d20; color: #d92d20; }
body[data-nav-phase="nav"] #locate { bottom: 76px; }
body[data-nav-phase="nav"] #status { display: none; }

/* Popup chọn điểm */
.nav-popup { display: grid; gap: 6px; min-width: 160px; font: 13px / 1.4 system-ui, sans-serif; }
.nav-popup-label { margin: 0 0 2px; font-weight: 600; color: #172033; }
.nav-popup button {
  padding: 6px 10px;
  border: 1px solid #c7cfda;
  border-radius: 6px;
  background: #fff;
  color: #172033;
  font: inherit;
  cursor: pointer;
}
.nav-popup button:hover { border-color: #2458a6; color: #2458a6; }

/* Màn hình hẹp: thẻ lập kế hoạch bám đáy, banner/thanh toàn bề rộng */
@media (max-width: 720px) {
  .nav-card {
    top: auto;
    right: 12px;
    bottom: 12px;
    width: auto;
    max-height: 60vh;
  }
  body[data-nav="1"] #status { left: 12px; }
  .nav-banner-distance { font-size: 24px; }
  .nav-banner-text { font-size: 15px; }
  #locate { bottom: calc(60vh + 24px); }
  body[data-nav-phase="nav"] #locate { bottom: 76px; }
}
```

- [ ] **Step 3: Build docs, mở kiểm bằng mắt**

Run: `pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm preview`
Mở `http://localhost:4321/playground.html`: thấy nút "🧭 Dẫn đường" dưới ô tìm nhanh, nút ◎ góc phải dưới; các khối `#nav-*` chưa hiện (hidden). Tắt preview (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add apps/docs/public/playground.html apps/docs/public/playground-nav.css
git commit -m "feat(playground): markup và CSS chế độ dẫn đường (thẻ lập kế hoạch, banner, thanh ETA, fab)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: GPS lúc tải, chấm vị trí, nút ◎ (E2E trước)

**Files:**
- Modify: `apps/docs/public/playground.js`
- Test: `apps/docs/e2e/playground.spec.ts`

- [ ] **Step 1: Viết E2E thất bại**

Thêm vào cuối `apps/docs/e2e/playground.spec.ts`:

```ts
test.describe('vị trí của tôi', () => {
  test.use({ geolocation: { latitude: 10.7798, longitude: 106.699 }, permissions: ['geolocation'] });

  test('có quyền: bay về vị trí, cắm chấm, nút ◎ bật', async ({ page }) => {
    await page.goto('/playground.html?api=http://localhost:8787');
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', { timeout: 30_000 });
    await expect(page.locator('.pg-my-location')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('#locate')).toHaveAttribute('aria-pressed', 'true');
    const center = await page.evaluate(() => {
      const c = (window as unknown as { __map: { gl: { getCenter(): { lng: number; lat: number } } } }).__map.gl.getCenter();
      return [c.lng, c.lat];
    });
    expect(center[0]).toBeCloseTo(106.699, 3);
    expect(center[1]).toBeCloseTo(10.7798, 3);
  });
});

test('không cấp quyền vị trí: không lỗi JS, giữ tâm mặc định', async ({ page, context }) => {
  await context.clearPermissions();
  const jsErrors: string[] = [];
  page.on('pageerror', (error) => jsErrors.push(error.message));
  await page.goto('/playground.html?api=http://localhost:8787');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(page.locator('.pg-my-location')).toHaveCount(0);
  await expect(page.locator('#locate')).toHaveAttribute('aria-pressed', 'false');
  expect(jsErrors).toEqual([]);
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "vị trí" --reporter=line`
Expected: FAIL — `.pg-my-location` count 0, `#locate` không có `aria-pressed`.

- [ ] **Step 3: Thêm vào `playground.js`**

Sau khối biến toàn cục (sau `let reverseMode = false;`):

```js
/** @type {import('maplibre-gl').Marker | null} */
let myLocationMarker = null;
/** @type {[number, number] | null} lng, lat */
let myLocation = null;
```

Sau hàm `drawCircle` (trước `onPoiClick`):

```js
/* ---------- Vị trí của tôi ---------- */

/** @param {[number, number]} lngLat */
function setMyLocation(lngLat) {
  myLocation = lngLat;
  if (!map) return;
  if (!myLocationMarker) {
    const dot = document.createElement('div');
    dot.className = 'pg-my-location';
    dot.setAttribute('aria-label', 'Vị trí của tôi');
    myLocationMarker = new SDK.maplibregl.Marker({ element: dot }).setLngLat(lngLat).addTo(map.gl);
  } else {
    myLocationMarker.setLngLat(lngLat);
  }
  el('locate')?.setAttribute('aria-pressed', 'true');
  nav?.setMyLocation(lngLat);
}

/**
 * Xin vị trí một lần. Từ chối/không hỗ trợ chỉ ghi vào thanh trạng thái (spec: không hộp thoại).
 * @param {{ fly: boolean }} opts
 */
function locateMe({ fly }) {
  if (!('geolocation' in navigator)) {
    setStatus('Trình duyệt không có Geolocation');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lngLat = /** @type {[number, number]} */ ([
        Number(pos.coords.longitude.toFixed(6)),
        Number(pos.coords.latitude.toFixed(6)),
      ]);
      setMyLocation(lngLat);
      if (fly && map) map.flyTo(lngLat, 16);
    },
    (err) => {
      el('locate')?.setAttribute('aria-pressed', 'false');
      setStatus(
        err.code === 1 ? 'Chưa cho phép truy cập vị trí — bấm ◎ để thử lại' : 'Không lấy được vị trí',
      );
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  );
}
```

Trong `buildMap`, ngay trước `if (map) { map.remove(); … }` thêm:

```js
  myLocationMarker = null;
```

và trong `map.on('load', …)` thêm sau `setStatus('Bản đồ đã tải', 'loaded');`:

```js
    if (myLocation) setMyLocation(myLocation);
    else locateMe({ fly: true });
```

Trong `wirePanel()` **không** thêm gì (nút ◎ nằm ngoài panel, phải chạy cả khi `embed`). Ở khối khởi động cuối file, trước `syncUrl();`:

```js
el('locate')?.setAttribute('aria-pressed', 'false');
el('locate')?.addEventListener('click', () => locateMe({ fly: true }));
```

Thêm khai báo `let nav = null;` cạnh các biến toàn cục (dùng ở Task 6; tạm thời `nav?.setMyLocation` không chạy).

- [ ] **Step 4: Chạy E2E, lint**

Run: `pnpm lint && pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "vị trí" --reporter=line`
Expected: PASS 2 ca.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/public/playground.js apps/docs/e2e/playground.spec.ts
git commit -m "feat(playground): xin GPS lúc mở, chấm vị trí của tôi và nút ◎

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `playground-nav.js` — vào/ra chế độ, chọn điểm, phương tiện

**Files:**
- Create: `apps/docs/public/playground-nav.js`
- Modify: `apps/docs/public/playground.js`
- Test: `apps/docs/e2e/playground.spec.ts`

- [ ] **Step 1: Viết E2E thất bại**

Thêm vào `apps/docs/e2e/playground.spec.ts`:

```ts
test('bấm Dẫn đường: bảng thu về ⋯ Công cụ, thẻ trái hiện, chip Xe máy đang chọn', async ({ page }) => {
  await page.goto('/playground.html?api=http://localhost:8787');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', { timeout: 30_000 });
  await page.locator('#enter-nav').click();

  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#tools')).toBeVisible();
  await expect(page.locator('#nav-card')).toBeVisible();
  await expect(page.locator('#nav-from input')).toBeVisible();
  await expect(page.locator('#nav-to input')).toBeVisible();
  await expect(page.locator('.nav-mode[data-mode="motorbike"]')).toHaveAttribute('aria-pressed', 'true');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('dan-duong');

  await page.locator('#tools').click();
  await expect(page.locator('#panel')).toBeVisible();
  await page.locator('#tools').click();
  await expect(page.locator('#panel')).toBeHidden();

  await page.locator('#nav-exit').click();
  await expect(page.locator('#nav-card')).toBeHidden();
  await expect(page.locator('#panel')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('tab')).toBeNull();
});

test('bấm bản đồ chọn "Đến đây" → ô Điểm đến có nhãn toạ độ, URL có to; đổi chiều hoán vị', async ({ page }) => {
  await page.goto('/playground.html?api=http://localhost:8787&tab=dan-duong&from=10.7798,106.699,Nhà thờ Đức Bà');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', { timeout: 30_000 });
  await expect(page.locator('#nav-from input')).toHaveValue('Nhà thờ Đức Bà');

  const canvas = page.locator('canvas.maplibregl-canvas');
  await canvas.click({ position: { x: 700, y: 300 } });
  await page.getByRole('button', { name: 'Đến đây' }).click();
  await expect(page.locator('#nav-to input')).toHaveValue(/^\d+\.\d{4}, \d+\.\d{4}$/);
  expect(new URL(page.url()).searchParams.get('to')).toMatch(/^\d+\.\d+,\d+\.\d+,/);

  await page.locator('#nav-swap').click();
  await expect(page.locator('#nav-to input')).toHaveValue('Nhà thờ Đức Bà');
  await expect(page.locator('#nav-from input')).toHaveValue(/^\d+\.\d{4}, \d+\.\d{4}$/);
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "Dẫn đường|Đến đây" --reporter=line`
Expected: FAIL — `#panel` vẫn hiện / `#nav-card` hidden.

- [ ] **Step 3: Tạo `playground-nav.js` (phần lập kế hoạch; tính tuyến và dẫn đường thêm ở Task 6, 7)**

```js
/**
 * Chế độ dẫn đường của Playground (spec 2026-09-12-playground-dan-duong-design.md).
 * Sở hữu mọi phần tử `#nav-*`; không đọc/ghi URL hay state playground — báo qua `onChange`.
 */
import {
  TRAVEL_MODES,
  pointFromAutocomplete,
  pointFromLngLat,
  pointFromPoi,
} from '/playground-lib.js';

/** @typedef {import('/playground-lib.js').NavPoint} NavPoint */

const MY_LOCATION_LABEL = 'Vị trí của tôi';

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * Đặt chữ vào ô của web component (shadow root mở) mà không phát `select`.
 * @param {HTMLElement} ac
 * @param {string} text
 */
function setAutocompleteText(ac, text) {
  const input = ac.shadowRoot?.querySelector('input');
  if (input) input.value = text;
}

/**
 * @param {{
 *   map: any,
 *   sdk: any,
 *   initial: { from: NavPoint | null, to: NavPoint | null, tmode: string },
 *   lang: string,
 *   rate: number,
 *   fixture: boolean,
 *   apiKey: string,
 *   apiBase: string,
 *   onChange: (patch: { from?: NavPoint | null, to?: NavPoint | null, tmode?: string, tab?: 'dan-duong' | null }) => void,
 *   describeError: (err: unknown) => string,
 * }} deps
 */
export function initNavigation(deps) {
  const { map, sdk, onChange, describeError } = deps;
  const gl = map.gl;

  /** @type {NavPoint | null} */
  let from = deps.initial.from;
  /** @type {NavPoint | null} */
  let to = deps.initial.to;
  let tmode = TRAVEL_MODES.includes(deps.initial.tmode) ? deps.initial.tmode : 'motorbike';
  /** @type {[number, number] | null} */
  let myLocation = null;
  let active = false;
  /** @type {'plan' | 'nav'} */
  let phase = 'plan';
  /** @type {any} marker điểm đi */
  let fromMarker = null;
  /** @type {any} marker điểm đến */
  let toMarker = null;
  /** @type {any} popup chọn điểm */
  let popup = null;

  const card = el('nav-card');
  const fromAc = el('nav-from');
  const toAc = el('nav-to');
  const msg = el('nav-msg');

  for (const ac of [fromAc, toAc]) {
    ac.setAttribute('api-key', deps.apiKey);
    ac.setAttribute('api-base', deps.apiBase);
    /** @type {any} */ (ac).map = map;
  }

  /**
   * @param {string} text
   * @param {'error'} [state]
   */
  const say = (text, state) => {
    msg.textContent = text;
    if (state) msg.dataset.state = state;
    else msg.removeAttribute('data-state');
  };

  const renderModes = () => {
    for (const button of card.querySelectorAll('.nav-mode')) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-mode') === tmode));
    }
  };

  const renderPoints = () => {
    setAutocompleteText(fromAc, from ? from.label : myLocation ? MY_LOCATION_LABEL : '');
    setAutocompleteText(toAc, to ? to.label : '');
    fromMarker?.remove();
    fromMarker = from ? map.addMarker({ lng: from.lng, lat: from.lat, color: '#2458a6' }) : null;
    toMarker?.remove();
    toMarker = to ? map.addMarker({ lng: to.lng, lat: to.lat, color: '#d92d20' }) : null;
  };

  /** Điểm đi hiệu dụng: điểm đã chọn, hoặc vị trí của tôi. */
  const effectiveFrom = () =>
    from ?? (myLocation ? { lng: myLocation[0], lat: myLocation[1], label: MY_LOCATION_LABEL } : null);

  /**
   * @param {'from' | 'to'} kind
   * @param {NavPoint | null} point
   */
  function setPoint(kind, point) {
    if (kind === 'from') from = point;
    else to = point;
    renderPoints();
    onChange(kind === 'from' ? { from } : { to });
    void compute();
  }

  /** @param {string} mode */
  function setMode(mode) {
    if (!TRAVEL_MODES.includes(mode) || mode === tmode) return;
    tmode = mode;
    renderModes();
    onChange({ tmode });
    void compute();
  }

  /** Hoán vị đi/đến; "Vị trí của tôi" khi thành điểm đến thì đóng băng thành toạ độ. */
  function swap() {
    const oldFrom = effectiveFrom();
    from = to;
    to =
      oldFrom && oldFrom.label === MY_LOCATION_LABEL
        ? pointFromLngLat([oldFrom.lng, oldFrom.lat])
        : oldFrom;
    renderPoints();
    onChange({ from, to });
    void compute();
  }

  /** Popup "Đi từ đây · Đến đây" tại một điểm trên bản đồ. @param {NavPoint} point */
  function offerPoint(point) {
    popup?.remove();
    const template = /** @type {HTMLTemplateElement} */ (el('nav-popup-template'));
    const node = /** @type {HTMLElement} */ (template.content.firstElementChild?.cloneNode(true));
    node.querySelector('.nav-popup-label').textContent = point.label;
    node.querySelector('[data-kind="from"]').addEventListener('click', () => {
      popup?.remove();
      setPoint('from', point);
    });
    node.querySelector('[data-kind="to"]').addEventListener('click', () => {
      popup?.remove();
      setPoint('to', point);
    });
    popup = new sdk.maplibregl.Popup({ offset: 12, closeButton: false })
      .setLngLat([point.lng, point.lat])
      .setDOMContent(node)
      .addTo(gl);
  }

  /* compute(), startNav(), backToPlan() được thêm ở Task 6 và 7 */
  async function compute() {}

  function enter() {
    if (active) return;
    active = true;
    document.body.dataset.nav = '1';
    delete document.body.dataset.tools;
    card.hidden = false;
    el('tools').hidden = false;
    renderModes();
    renderPoints();
    onChange({ tab: 'dan-duong' });
    void compute();
  }

  function exit() {
    if (!active) return;
    if (phase === 'nav') map.navigation.stop();
    phase = 'plan';
    active = false;
    popup?.remove();
    fromMarker?.remove();
    toMarker?.remove();
    fromMarker = null;
    toMarker = null;
    from = null;
    to = null;
    map.routes.clear();
    card.hidden = true;
    el('nav-banner').hidden = true;
    el('nav-bar').hidden = true;
    el('tools').hidden = true;
    delete document.body.dataset.nav;
    delete document.body.dataset.tools;
    delete document.body.dataset.navPhase;
    onChange({ tab: null, from: null, to: null });
  }

  el('nav-exit').addEventListener('click', exit);
  el('nav-swap').addEventListener('click', swap);
  el('tools').addEventListener('click', () => {
    if (document.body.dataset.tools === '1') delete document.body.dataset.tools;
    else document.body.dataset.tools = '1';
  });
  for (const button of card.querySelectorAll('.nav-mode')) {
    button.addEventListener('click', () => setMode(button.getAttribute('data-mode') ?? ''));
  }
  fromAc.addEventListener('select', (event) => {
    setPoint('from', pointFromAutocomplete(/** @type {CustomEvent} */ (event).detail));
  });
  toAc.addEventListener('select', (event) => {
    setPoint('to', pointFromAutocomplete(/** @type {CustomEvent} */ (event).detail));
  });

  return {
    enter,
    exit,
    get active() {
      return active;
    },
    setPoint,
    /** @param {[number, number]} lngLat */
    setMyLocation(lngLat) {
      myLocation = lngLat;
      if (active && !from) {
        renderPoints();
        void compute();
      }
    },
    /** @param {[number, number]} lngLat */
    onMapClick(lngLat) {
      if (!active || phase !== 'plan') return;
      offerPoint(pointFromLngLat(lngLat));
    },
    /** @param {{ name: string, lngLat: [number, number] }} poi */
    onPoiClick(poi) {
      if (!active || phase !== 'plan') return;
      offerPoint(pointFromPoi(poi));
    },
  };
}
```

(`deps.lang/rate/fixture/describeError` chưa dùng ở task này — Biome không bắt thuộc tính object chưa đọc; các import/hằng cần cho tính tuyến và dẫn đường được thêm ở Task 6 và 7 để không vướng `noUnusedImports`/`noUnusedVariables`.)

- [ ] **Step 4: Nối vào `playground.js`**

Đầu file, sau import từ `/playground-lib.js`:

```js
import { initNavigation } from '/playground-nav.js';
```

Thêm import `navSnippet` vào danh sách import từ `/playground-lib.js`. Biến toàn cục (đã có `let nav = null;` từ Task 4) thêm:

```js
const fixtureMode = new URLSearchParams(location.search).get('fixture') === '1';
const playbackRate = Math.max(1, Number(new URLSearchParams(location.search).get('rate') ?? '20'));
```

Thêm hàm sau `onMoveEnd`:

```js
/** Khởi tạo lại module dẫn đường cho map mới; nếu đang ở chế độ dẫn đường thì vào lại. */
function attachNavigation() {
  const wasActive = Boolean(nav?.active);
  nav = initNavigation({
    map,
    sdk: SDK,
    initial: { from: state.from, to: state.to, tmode: state.tmode },
    lang: state.lang,
    rate: playbackRate,
    fixture: fixtureMode,
    apiKey: state.key,
    apiBase: state.api,
    describeError,
    onChange(patch) {
      state = { ...state, ...patch };
      renderSnippets();
      syncUrl();
    },
  });
  if (myLocation) nav.setMyLocation(myLocation);
  if (wasActive || state.tab === 'dan-duong') nav.enter();
}
```

Trong `buildMap`, sau `renderView();` ở cuối hàm thêm `attachNavigation();`. Trước `if (map) { map.remove(); … }` thêm `nav?.exit();` — **nhưng** `exit()` xoá `from/to` khỏi state qua `onChange`; để giữ điểm khi tạo lại map, đổi thứ tự: lưu `const keep = { from: state.from, to: state.to, tab: state.tab }; nav?.exit(); state = { ...state, ...keep };` rồi mới `map.remove()`.

Trong `onPoiClick(poi)` thêm ở đầu:

```js
  if (nav?.active) {
    nav.onPoiClick(poi);
    return;
  }
```

Trong `onMapClick(event)` thêm ở đầu (trước kiểm `reverseMode`):

```js
  if (nav?.active) {
    nav.onMapClick([event.lngLat.lng, event.lngLat.lat]);
    return;
  }
```

Trong `wirePanel()` thêm:

```js
  el('enter-nav').addEventListener('click', () => nav?.enter());
```

`setMyLocation` (Task 4) đã gọi `nav?.setMyLocation(lngLat)`.

- [ ] **Step 5: Chạy E2E, lint**

Run: `pnpm lint && pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "Dẫn đường|Đến đây|vị trí" --reporter=line`
Expected: PASS 4 ca.

- [ ] **Step 6: Commit**

```bash
git add apps/docs/public/playground-nav.js apps/docs/public/playground.js apps/docs/e2e/playground.spec.ts
git commit -m "feat(playground): chế độ dẫn đường — vào/ra, hai ô điểm, chọn điểm trên bản đồ/POI, phương tiện

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Tự tính tuyến, tuyến thay thế, chi tiết bước, lỗi

**Files:**
- Modify: `apps/docs/public/playground-nav.js`
- Test: `apps/docs/e2e/playground.spec.ts`

- [ ] **Step 1: Viết E2E thất bại**

```ts
const NAV_URL =
  '/playground.html?api=http://localhost:8787&fixture=1&tab=dan-duong' +
  '&from=10.7798,106.699,Nhà thờ Đức Bà&to=10.7725,106.698,Chợ Bến Thành';

test('có đủ hai điểm: tự tính tuyến, vẽ tuyến, danh sách tuyến và 6 bước', async ({ page }) => {
  await page.goto(NAV_URL);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', { timeout: 30_000 });
  await expect(page.locator('#nav-routes li').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#nav-routes li').first()).toContainText('km');
  await expect(page.locator('#nav-routes button').first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#nav-steps-box summary').click();
  await expect(page.locator('#nav-steps li')).toHaveCount(6);
  await expect(page.locator('#nav-start')).toBeEnabled();
  const hasLayer = await page.evaluate(() =>
    Boolean((window as unknown as { __map: { gl: { getLayer(id: string): unknown } } }).__map.gl.getLayer('mapslibvn-route-line')),
  );
  expect(hasLayer).toBe(true);
});

test('đổi phương tiện → gọi lại directions và URL có tmode=car', async ({ page }) => {
  let calls = 0;
  await page.route('**/fixtures/directions-q1.json', (route) => {
    calls += 1;
    void route.continue();
  });
  await page.goto(NAV_URL);
  await expect(page.locator('#nav-routes li').first()).toBeVisible({ timeout: 30_000 });
  const before = calls;
  await page.locator('.nav-mode[data-mode="car"]').click();
  await expect(page.locator('.nav-mode[data-mode="car"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => calls).toBe(before + 1);
  expect(new URL(page.url()).searchParams.get('tmode')).toBe('car');
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "hai điểm|phương tiện" --reporter=line`
Expected: FAIL — không có `#nav-routes li`.

- [ ] **Step 3: Thay `compute()` rỗng trong `playground-nav.js`**

Đầu file: thêm `directionsRequest` và `routeSummary` vào `import { … } from '/playground-lib.js'` (giữ thứ tự chữ cái), và thêm hằng ngay dưới `MY_LOCATION_LABEL`:

```js
/** Ký hiệu theo `ManeuverKind` (spec A) — glyph hình học, không phụ thuộc font emoji. */
const ICONS = {
  depart: '●', arrive: '⚑', continue: '↑',
  slight_right: '↗', slight_left: '↖', turn_right: '↱', turn_left: '↰',
  sharp_right: '↳', sharp_left: '↲', uturn_right: '↷', uturn_left: '↶',
  ramp_straight: '↑', ramp_right: '↗', ramp_left: '↖', exit_right: '↗', exit_left: '↖',
  keep_right: '↗', keep_left: '↖', merge: '↑', merge_right: '↗', merge_left: '↖',
  roundabout_enter: '↻', roundabout_exit: '↻', ferry_enter: '⛴', ferry_exit: '⛴',
  elevator: '⇕', steps: '≡', escalator: '≡', building_enter: '⌂', building_exit: '⌂', other: '•',
};
```

Thêm biến trong `initNavigation` (cạnh `let popup`):

```js
  /** @type {any} DirectionsResponse đang hiện */
  let response = null;
  let activeRoute = 0;
  let requestId = 0;
  const provider = deps.fixture
    ? { directions: async () => (await fetch('/fixtures/directions-q1.json')).json() }
    : map.places;
```

Thay hàm `compute` rỗng bằng:

```js
  /** @param {unknown} err */
  const routeErrorText = (err) => {
    const status = err && typeof err === 'object' && 'status' in err ? err.status : 0;
    if (status === 429) {
      return 'Quá giới hạn 20 lượt/phút của khoá demo — chờ một chút hoặc dán khoá riêng ở ⋯ Công cụ.';
    }
    if (status === 503 || status === 504) return 'Máy chủ chỉ đường đang bận, thử lại sau.';
    if (status === 404 || status === 422) return 'Chưa có đường cho đoạn này.';
    return describeError(err);
  };

  const renderRoutes = () => {
    const list = el('nav-routes');
    if (!response) {
      list.replaceChildren();
      return;
    }
    list.replaceChildren(
      ...response.routes.map((route, index) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(index === activeRoute));
        const summary = routeSummary(route);
        const strong = document.createElement('strong');
        strong.textContent = `${summary.distanceText} · ${summary.minutes} phút`;
        const small = document.createElement('small');
        small.textContent = summary.via ? `qua ${summary.via}` : index === 0 ? 'Tuyến nhanh nhất' : 'Tuyến thay thế';
        button.append(strong, small);
        button.addEventListener('click', () => selectRoute(index));
        li.append(button);
        return li;
      }),
    );
  };

  const renderSteps = () => {
    const box = el('nav-steps-box');
    const list = el('nav-steps');
    const route = response?.routes[activeRoute];
    if (!route) {
      box.hidden = true;
      list.replaceChildren();
      return;
    }
    box.hidden = false;
    list.replaceChildren(
      ...route.legs.flatMap((leg) =>
        leg.steps.map((step) => {
          const li = document.createElement('li');
          li.textContent = `${ICONS[step.kind] ?? '•'} ${step.instruction} (${sdk.formatDistanceShort(step.distance_m)})`;
          return li;
        }),
      ),
    );
  };

  /** @param {number} index */
  function selectRoute(index) {
    if (!response || !response.routes[index]) return;
    activeRoute = index;
    map.routes.setActive(index);
    renderRoutes();
    renderSteps();
  }

  const setBusy = (busy) => card.setAttribute('aria-busy', String(busy));

  async function compute() {
    if (!active || phase !== 'plan') return;
    const origin = effectiveFrom();
    const id = ++requestId;
    if (!to || !origin) {
      response = null;
      map.routes.clear();
      renderRoutes();
      renderSteps();
      el('nav-start').disabled = true;
      el('nav-simulate').disabled = true;
      say(
        !to
          ? 'Chọn điểm đến bằng ô tìm kiếm hoặc bấm lên bản đồ.'
          : 'Đang chờ vị trí của bạn… hoặc chọn điểm đi khác.',
      );
      return;
    }
    setBusy(true);
    say('Đang tính tuyến…');
    try {
      const result = await provider.directions(
        directionsRequest({ from: origin, to, mode: tmode, lang: deps.lang }),
      );
      if (id !== requestId) return;
      if (!result.routes[0]) throw Object.assign(new Error('Chưa có đường cho đoạn này.'), { status: 404 });
      response = result;
      activeRoute = 0;
      map.routes.show(result, { active: 0, markers: false });
      const [minLng, minLat, maxLng, maxLat] = result.routes[0].bbox;
      gl.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: window.innerWidth > 720 ? { top: 60, right: 60, bottom: 60, left: 400 } : 60 },
      );
      renderRoutes();
      renderSteps();
      el('nav-start').disabled = false;
      el('nav-simulate').disabled = false;
      say(`${result.routes.length} tuyến · bấm để đổi tuyến, rồi Bắt đầu hoặc Giả lập.`);
    } catch (err) {
      if (id !== requestId) return;
      response = null;
      map.routes.clear();
      renderRoutes();
      renderSteps();
      el('nav-start').disabled = true;
      el('nav-simulate').disabled = true;
      say(routeErrorText(err), 'error');
    } finally {
      if (id === requestId) setBusy(false);
    }
  }
```

Trong `enter()` **không** đổi; `exit()` thêm `response = null; activeRoute = 0; requestId += 1;` trước `map.routes.clear()`. Đăng ký `map.on('routeClick', (e) => { if (active && phase === 'plan') selectRoute(e.index); });` ngay sau khối gán thuộc tính cho hai autocomplete.

- [ ] **Step 4: Chạy E2E, lint**

Run: `pnpm lint && pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "hai điểm|phương tiện" --reporter=line`
Expected: PASS 2 ca. (`fixture` trả cùng một tuyến cho mọi mode — đúng ý test đếm request.)

- [ ] **Step 5: Commit**

```bash
git add apps/docs/public/playground-nav.js apps/docs/e2e/playground.spec.ts
git commit -m "feat(playground): tự tính tuyến khi đủ điểm/đổi phương tiện, tuyến thay thế, chi tiết bước, lỗi 429/503

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Đang dẫn đường — Bắt đầu, Giả lập, banner, thanh ETA, đến nơi, dừng

**Files:**
- Modify: `apps/docs/public/playground-nav.js`
- Test: `apps/docs/e2e/playground.spec.ts`

- [ ] **Step 1: Viết E2E thất bại**

```ts
test('Giả lập: banner rẽ, phụ đề "Trong … nữa", đến nơi rồi trở về thẻ; ✕ xoá tuyến', async ({ page }) => {
  await page.goto(`${NAV_URL}&rate=20`);
  await expect(page.locator('#nav-simulate')).toBeEnabled({ timeout: 30_000 });
  const subtitles: string[] = [];
  await page.exposeFunction('__recordSubtitle', (t: string) => subtitles.push(t));
  await page.evaluate(() => {
    const node = document.getElementById('nav-subtitle');
    if (!node) return;
    new MutationObserver(() => {
      const text = node.textContent ?? '';
      if (text) (window as unknown as { __recordSubtitle(t: string): void }).__recordSubtitle(text);
    }).observe(node, { childList: true, characterData: true, subtree: true });
  });

  await page.locator('#nav-simulate').click();
  await expect(page.locator('#nav-card')).toBeHidden();
  await expect(page.locator('#nav-banner')).toHaveAttribute('data-status', 'navigating', { timeout: 10_000 });
  await expect(page.locator('#nav-bar')).toContainText('phút');
  await expect(page.locator('#nav-banner')).toHaveAttribute('data-status', 'arrived', { timeout: 30_000 });
  await expect(page.locator('#nav-card')).toBeVisible({ timeout: 6_000 });

  expect(subtitles.length).toBeGreaterThanOrEqual(10);
  expect(subtitles.some((t) => t.startsWith('Trong '))).toBe(true);
  expect(subtitles.at(-1)).toBe('Điểm đến ở bên trái.');
  const stillDrawn = await page.evaluate(() =>
    Boolean((window as unknown as { __map: { gl: { getLayer(id: string): unknown } } }).__map.gl.getLayer('mapslibvn-route-line')),
  );
  expect(stillDrawn).toBe(true);

  await page.locator('#nav-exit').click();
  await expect(page.locator('#panel')).toBeVisible();
  const routeFeatures = await page.evaluate(() =>
    (window as unknown as { __map: { gl: { querySourceFeatures(id: string): unknown[] } } }).__map.gl.querySourceFeatures('mapslibvn-route').length,
  );
  expect(routeFeatures).toBe(0);
});

test('Dừng giữa chừng → về thẻ, trạng thái idle, Bắt đầu bật lại', async ({ page }) => {
  await page.goto(`${NAV_URL}&rate=5`);
  await expect(page.locator('#nav-simulate')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#nav-simulate').click();
  await expect(page.locator('#nav-banner')).toHaveAttribute('data-status', 'navigating', { timeout: 10_000 });
  await page.locator('#nav-stop').click();
  await expect(page.locator('#nav-banner')).toBeHidden();
  await expect(page.locator('#nav-card')).toBeVisible();
  await expect(page.locator('#nav-start')).toBeEnabled();
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "Giả lập|Dừng" --reporter=line`
Expected: FAIL — bấm Giả lập không có gì xảy ra.

- [ ] **Step 3: Thêm pha dẫn đường vào `playground-nav.js`**

Đầu file: thêm `etaLabel` vào `import { … } from '/playground-lib.js'`, và hai hằng dưới `ICONS`:

```js
/** Phụ đề câu vừa đọc hiện bấy nhiêu ms. */
const SUBTITLE_MS = 4000;
/** Banner "Đã đến nơi" giữ bấy nhiêu ms rồi trở về thẻ lập kế hoạch. */
const ARRIVED_HOLD_MS = 3000;
```

Thêm biến (cạnh `let requestId`):

```js
  /** @type {ReturnType<typeof setTimeout> | null} */
  let subtitleTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let arrivedTimer = null;
```

Thêm các hàm sau `compute()`:

```js
  /** @param {'plan' | 'nav'} next */
  const setPhase = (next) => {
    phase = next;
    document.body.dataset.navPhase = next;
    card.hidden = next !== 'plan';
    el('nav-banner').hidden = next !== 'nav';
    el('nav-bar').hidden = next !== 'nav';
  };

  /** @param {string} text */
  const showSubtitle = (text) => {
    const node = el('nav-subtitle');
    node.textContent = text;
    node.hidden = false;
    if (subtitleTimer) clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(() => {
      node.hidden = true;
    }, SUBTITLE_MS);
  };

  /** @param {string} status */
  const setBanner = (status) => {
    el('nav-banner').dataset.status = status;
  };

  function backToPlan() {
    if (arrivedTimer) clearTimeout(arrivedTimer);
    arrivedTimer = null;
    setPhase('plan');
    el('nav-recenter').hidden = true;
    el('nav-start').disabled = response === null;
    el('nav-simulate').disabled = response === null;
  }

  /** @param {boolean} simulate */
  function startNav(simulate) {
    const route = response?.routes[activeRoute];
    if (!response || !route) return;
    const options = {
      response,
      routeIndex: activeRoute,
      provider,
      lang: deps.lang,
      voice: !simulate,
    };
    if (simulate) {
      options.source = sdk.playbackSource(
        sdk.simulateFixes(route, { jitter_m: 4, seed: 7 }),
        { rate: deps.rate },
      );
    }
    popup?.remove();
    setBanner('navigating');
    el('nav-icon').textContent = '•';
    el('nav-distance').textContent = '—';
    el('nav-instruction').textContent = 'Đang chờ vị trí…';
    el('nav-eta').textContent = '—';
    el('nav-subtitle').hidden = true;
    setPhase('nav');
    map.navigation.start(options);
  }

  map.navigation.on('progress', (p) => {
    const next = p.nextStep ?? p.step;
    el('nav-icon').textContent = ICONS[next.kind] ?? '•';
    el('nav-distance').textContent = sdk.formatDistanceShort(p.distanceToStep_m);
    el('nav-instruction').textContent = next.instruction;
    el('nav-eta').textContent = etaLabel(p.remaining_s, p.remaining_m, Date.now());
  });
  map.navigation.on('announce', (a) => showSubtitle(a.text));
  map.navigation.on('status', (e) => {
    if (phase !== 'nav') return;
    setBanner(e.status);
    if (e.status === 'off_route') el('nav-instruction').textContent = 'Lệch tuyến — đang tính lại…';
    if (e.status === 'arrived') {
      el('nav-icon').textContent = '⚑';
      el('nav-distance').textContent = '';
      el('nav-instruction').textContent = 'Đã đến nơi';
      arrivedTimer = setTimeout(backToPlan, ARRIVED_HOLD_MS);
    }
  });
  map.navigation.on('reroute', (e) => {
    response = e.response;
    activeRoute = 0;
    renderRoutes();
    renderSteps();
  });
  map.navigation.on('rerouteFailed', (e) => {
    showSubtitle(`Không tính lại được (${e.attempts}/3)${e.final ? ' — dừng tự tính' : ''}`);
  });
  map.navigation.on('positionError', (e) => {
    if (e.code === 'denied' && phase === 'nav') {
      map.navigation.stop();
      setBanner('error');
      el('nav-instruction').textContent = 'Mất quyền vị trí — bấm Dừng rồi cho phép lại';
    } else {
      showSubtitle(`GPS: ${e.message}`);
    }
  });
  map.navigation.on('voiceUnavailable', () =>
    showSubtitle('Máy không có giọng tiếng Việt — xem phụ đề'),
  );
  map.navigation.on('followChange', (following) => {
    el('nav-recenter').hidden = following;
  });

  el('nav-start').addEventListener('click', () => startNav(false));
  el('nav-simulate').addEventListener('click', () => startNav(true));
  el('nav-stop').addEventListener('click', () => {
    map.navigation.stop();
    backToPlan();
  });
  el('nav-recenter').addEventListener('click', () => map.navigation.recenter());
```

Trong `exit()` thêm ở đầu (sau kiểm `active`): `if (subtitleTimer) clearTimeout(subtitleTimer); if (arrivedTimer) clearTimeout(arrivedTimer);` và thay `phase = 'plan';` bằng `setPhase('plan');` (rồi `card.hidden = true` như cũ vẫn ở sau).

- [ ] **Step 4: Chạy E2E, lint**

Run: `pnpm lint && pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "Giả lập|Dừng" --reporter=line`
Expected: PASS 2 ca. Nếu "10 phụ đề" đỏ vì MutationObserver bắt thiếu khi hai câu liên tiếp giống nhau, thay `childList/characterData` bằng cách đếm qua `page.exposeFunction` gọi từ `map.navigation.on('announce')` (`window.__map.navigation.on('announce', a => window.__recordSubtitle(a.text))` trong `page.evaluate` trước khi bấm).

- [ ] **Step 5: Commit**

```bash
git add apps/docs/public/playground-nav.js apps/docs/e2e/playground.spec.ts
git commit -m "feat(playground): pha dẫn đường — Bắt đầu/Giả lập, banner rẽ, thanh ETA, phụ đề, đến nơi, dừng

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Tab Mã nhúng có mục Dẫn đường

**Files:**
- Modify: `apps/docs/public/playground.html`, `apps/docs/public/playground.js`
- Test: `apps/docs/e2e/playground.spec.ts`

- [ ] **Step 1: Viết E2E thất bại**

```ts
test('tab Mã nhúng có đoạn dẫn đường theo điểm/phương tiện đang chọn', async ({ page }) => {
  await page.goto(`${NAV_URL}&tmode=walk`);
  await expect(page.locator('#nav-routes li').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('#tools').click();
  await page.locator('#tab-ma-nhung').click();
  const pre = page.locator('#snippet-nav');
  await expect(pre).toContainText('map.places.directions');
  await expect(pre).toContainText("mode: 'walk'");
  await expect(pre).toContainText('to: [10.7725, 106.698], // Chợ Bến Thành');
  await expect(pre).toContainText('map.navigation.start');
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "Mã nhúng có đoạn" --reporter=line`
Expected: FAIL — không có `#snippet-nav`.

- [ ] **Step 3: Markup + render**

Trong `playground.html`, tab 4, sau khối `npm ESM` (sau nút `copy-esm`) thêm:

```html
        <h2>Dẫn đường — npm ESM</h2>
        <pre id="snippet-nav">—</pre>
        <button id="copy-nav" type="button">Sao chép đoạn dẫn đường</button>
```

Trong `playground.js`, `renderSnippets()` thêm:

```js
  const navPre = el('snippet-nav');
  if (navPre) navPre.textContent = navSnippet(state);
```

và trong `wirePanel()` sau `wireCopy('copy-esm', 'snippet-esm');`: `wireCopy('copy-nav', 'snippet-nav');`.

- [ ] **Step 4: Chạy E2E, lint**

Run: `pnpm lint && pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/playground.spec.ts -g "Mã nhúng" --reporter=line`
Expected: PASS (cả ca cũ "tab Mã nhúng sinh mã…").

- [ ] **Step 5: Commit**

```bash
git add apps/docs/public/playground.html apps/docs/public/playground.js apps/docs/e2e/playground.spec.ts
git commit -m "feat(playground): tab Mã nhúng thêm đoạn dẫn đường theo điểm và phương tiện đang chọn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Gỡ trang demo cũ, cập nhật docs và E2E docs

**Files:**
- Delete: `apps/docs/src/pages/dan-duong-demo.astro`, `apps/docs/src/lib/dan-duong-demo.ts`, `apps/docs/e2e/dan-duong-demo.spec.ts`
- Modify: `apps/docs/astro.config.mjs`, `apps/docs/e2e/docs.spec.ts`, `apps/docs/src/content/docs/dan-duong.md`

- [ ] **Step 1: Xoá và sửa**

```bash
git rm apps/docs/src/pages/dan-duong-demo.astro apps/docs/src/lib/dan-duong-demo.ts apps/docs/e2e/dan-duong-demo.spec.ts
```

`astro.config.mjs`: xoá dòng `{ label: 'Demo dẫn đường', link: '/dan-duong-demo/' },`.

`e2e/docs.spec.ts`: xoá dòng `'/dan-duong-demo/',`.

`src/content/docs/dan-duong.md`:
- Mục 1, sau đoạn "`start()` mở `navigator.geolocation.watchPosition`…" thêm đoạn: `Muốn thử ngay không cần code: mở [Playground](/playground.html?tab=dan-duong) → bấm "Dẫn đường".`
- Mục 4, câu `[Demo dẫn đường](/dan-duong-demo/) có nút Giả lập làm đúng việc này.` → `[Playground → Dẫn đường](/playground.html?tab=dan-duong) có nút Giả lập làm đúng việc này.`

- [ ] **Step 2: Build docs, typecheck, E2E docs**

Run: `pnpm --filter @mapslibvn/docs typecheck && pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test e2e/docs.spec.ts --reporter=line`
Expected: typecheck 0 lỗi; build không còn `/dan-duong-demo/`; docs.spec xanh (22 trang, gồm `/playground.html` và `/dan-duong/`).

- [ ] **Step 3: Commit**

```bash
git add -A apps/docs/src apps/docs/e2e apps/docs/astro.config.mjs
git commit -m "docs: gỡ trang /dan-duong-demo/, trỏ hướng dẫn về Playground → Dẫn đường

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Cổng local, deploy docs, thử tay, evidence

**Files:**
- Create: `docs/evidence/navigation/2026-09-XX-playground-dan-duong.md`

- [ ] **Step 1: Cổng local**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @mapslibvn/docs build && cd apps/docs && pnpm exec playwright test --workers=2 --reporter=line && cd ../..
```

Expected: tất cả xanh, trừ tối đa 3 ca `playground.spec.ts` **cũ** về autocomplete có thể đỏ do Postgres nghẽn (ghi nhận, không phải lỗi mới). Mọi ca mới của plan này phải xanh; chạy lại riêng `-g "Dẫn đường|Đến đây|hai điểm|phương tiện|Giả lập|Dừng|Mã nhúng có đoạn|vị trí"` để chắc.

- [ ] **Step 2: Deploy docs**

```bash
pnpm --filter @mapslibvn/docs exec wrangler pages deploy dist --project-name mapslibvn-docs
```

Mở `https://mapslibvn-docs.pages.dev/playground.html?tab=dan-duong` trên máy tính **và** điện thoại: cho GPS → thấy chấm và bay về; gõ một tên đường ở ô Điểm đến → tuyến vẽ; đổi ba phương tiện → tuyến đổi; bấm tuyến mờ → đổi tuyến chính; Giả lập → banner chạy đến nơi; Bắt đầu thật đi vài chục mét → puck và banner theo GPS thật, có giọng đọc.

- [ ] **Step 3: Evidence**

Tạo `docs/evidence/navigation/2026-09-XX-playground-dan-duong.md`:

```md
# Dẫn đường trong Playground — phát hành trước thực địa

Ngày: 2026-09-XX. Commit: `<sha>`. Spec: `docs/superpowers/specs/2026-09-12-playground-dan-duong-design.md`.

## Cổng local
| Lệnh | Kết quả |
|---|---|
| `pnpm lint` / `pnpm typecheck` | xanh |
| `pnpm test` | <N> test xanh (playground-lib thêm <n> ca) |
| `playwright test --workers=2` | <N>/<M> xanh; 8 ca mới của dẫn đường xanh; <k> ca autocomplete cũ đỏ do Postgres nghẽn (không liên quan) |

## Thử tay trên production (`https://mapslibvn-docs.pages.dev/playground.html?tab=dan-duong`)
| Việc | Máy tính | Điện thoại |
|---|---|---|
| GPS lúc mở, chấm vị trí | | |
| Tìm tên đường → tuyến | | |
| Đổi 3 phương tiện → tuyến đổi | | |
| Bấm tuyến thay thế | | |
| Giả lập → đến nơi | | |
| Bắt đầu thật (vài chục mét) | | |

Ghi chú/khác biệt thấy được: …
```

- [ ] **Step 4: Commit**

```bash
git add docs/evidence/navigation
git commit -m "docs(evidence): dẫn đường trong Playground — cổng local, deploy docs, thử tay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
