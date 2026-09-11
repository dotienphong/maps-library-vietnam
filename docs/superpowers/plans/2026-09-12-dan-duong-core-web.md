# Dẫn đường spec B — máy trạng thái core, `map.navigation` web, vá câu tiếng Việt — Plan thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Từ một `DirectionsResponse` của spec A, SDK web dẫn đường được từng bước theo GPS (bám tuyến, đọc câu tiếng Việt đúng lúc, tự tính lại khi lệch, báo đến nơi), logic nằm ở core để spec C dùng lại; Worker trả câu tiếng Việt đã vá và thêm `verbal_alert`.

**Architecture:** Core thêm `navigation/` — máy trạng thái thuần (`createNavigator`) nhận từng `GeoFix`, bám polyline theo cửa sổ, tính bước/ETA/lệch/đến nơi, lập lịch đọc; async duy nhất là gọi `RouteProvider` khi lệch. Web thêm `map.routes` (vẽ tuyến) và `map.navigation` (geolocation, camera, puck, `speechSynthesis`, wake lock) là lớp dán mỏng; React thêm `useNavigation()`. Worker thêm `verbal_alert` và bảng cụm từ `vi-phrases.ts`. Spec: `docs/superpowers/specs/2026-09-12-dan-duong-core-web-design.md`.

**Tech Stack:** TypeScript 5 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), pnpm 9, Vitest (core/web/react ở root; Worker dùng `@cloudflare/vitest-pool-workers`), Biome (2 space, single quote, lineWidth 100), tsup + size-limit, maplibre-gl 6, Hono 4 + Wrangler 4, Astro Starlight + Playwright.

---

## 0. Quy ước cho mọi task

- Mọi lệnh chạy từ **gốc repo** trừ khi ghi khác. Wrangler chạy từ `apps/api` (đọc `.env` ở gốc).
- **Trước khi chạy test Worker sau khi đổi core:** `pnpm --filter @mapslibvn/core build` (Worker import core từ `dist`). `pnpm test` ở gốc đã làm việc này.
- Test core/web/react chạy ở gốc: `pnpm exec vitest run <đường dẫn>`. Test Worker chạy trong `apps/api`: `pnpm exec vitest run test/<file>`.
- Test cần DOM ghi dòng đầu `// @vitest-environment jsdom` (như `packages/web/src/autocomplete-element.test.ts`).
- Kiểu `RouteStep`, `Route`, `DirectionsResponse`, `DirectionsOptions`, `TravelMode`, `DirectionsLang` là của spec A trong `packages/core/src/types.ts`. Toạ độ trong response là `[lng, lat]`; tham số `directions()` là `[lat, lng]`.
- Không dùng `!` (non-null assertion) — Biome cấm; dùng `?? `, `if (!x) return`, hoặc helper.
- Commit sau mỗi task, thông điệp Conventional Commits tiếng Việt, kết thúc bằng dòng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Không push (PHONG quyết).
- Bước cuối mỗi task: tick checkbox trong plan này. DEVLOG cập nhật ở Task 21 (một lần), trừ khi task đổi spec thì ghi ngay vào mục 3 DEVLOG.
- GitHub Actions đang khoá vì thanh toán: mọi cổng CI chạy tay ở Task 19.

## 1. Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `packages/core/src/types.ts` | thêm `verbal_alert` vào `RouteStep` |
| `packages/core/src/navigation/types.ts` | kiểu `GeoFix`, `RouteProvider`, `PositionSource`, `PositionError`, `NavigationStatus`, `NavigationThresholds` + `NAVIGATION_THRESHOLDS`, `NavigationProgress`, `Announcement`, `NavigationEvents`, `NavigatorOptions`, `Navigator` |
| `packages/core/src/navigation/geometry.ts` | `haversineM`, `bearingDeg`, `projectOnSegment`, `cumulativeDistances`, `angleDiffDeg` |
| `packages/core/src/navigation/progress.ts` | `buildRouteIndex` (khoảng cách cộng dồn, step phẳng, mốc leg), `stepAt`, `progressAt` |
| `packages/core/src/navigation/snap.ts` | `snapToRoute` theo cửa sổ với tie-break |
| `packages/core/src/navigation/announce.ts` | `formatDistance`, `formatDistanceShort`, `roundForSpeech`, `lowerFirst`, `composeApproach`, `planAnnouncements` |
| `packages/core/src/navigation/simulate.ts` | `simulateFixes`, PRNG `mulberry32` |
| `packages/core/src/navigation/navigator.ts` | `createNavigator` |
| `packages/core/src/navigation/index.ts` | re-export; `packages/core/src/index.ts` thêm một dòng |
| `packages/core/tests/fixtures/directions-q1.json` | `DirectionsResponse` dịch từ fixture Valhalla Quận 1 (sinh bởi test Worker, Task 3) |
| `packages/core/tests/helpers/synthetic-route.ts` | tuyến hai leg tổng hợp cho test core |
| `packages/web/src/routes-layer.ts` | `createRoutesLayer` → `map.routes` |
| `packages/web/src/position-source.ts` | `geolocationSource`, `playbackSource`, `toGeoFix` |
| `packages/web/src/speech.ts` | `createSpeech` |
| `packages/web/src/navigation.ts` | `createNavigation` → `map.navigation` |
| `packages/web/src/map.ts` | gắn `routes`, `navigation`, sự kiện `routeClick`, `remove()` dọn |
| `packages/web/src/index.ts`, `umd.ts` | export mới |
| `packages/react/src/use-navigation.ts` | `useNavigation()` |
| `apps/api/src/routing/vi-phrases.ts` | bảng cụm từ + `applyViPhrases` |
| `apps/api/src/routing/translate.ts`, `valhalla.ts`, `routes/directions.ts` | `verbal_alert`, tham số `lang`, áp bảng |
| `apps/api/test/routing-vi-phrases.test.ts`, `routing-fixture-sync.test.ts` | test luật + corpus; sinh/so fixture dùng chung |
| `apps/docs/scripts/copy-sdk.mjs` | chép fixture vào `public/fixtures/` |
| `apps/docs/src/content/docs/dan-duong.md` | trang hướng dẫn |
| `apps/docs/src/pages/dan-duong-demo.astro`, `src/lib/dan-duong-demo.ts` | trang demo |
| `apps/docs/e2e/dan-duong-demo.spec.ts` | E2E giả lập |
| `docs/evidence/navigation/` | evidence thực địa + số đo size |

---

### Task 1: `verbal_alert` xuyên suốt core → Worker

**Files:**
- Modify: `packages/core/src/types.ts` (interface `RouteStep`, khoảng dòng 181–196)
- Modify: `apps/api/src/routing/valhalla.ts` (interface `ValhallaManeuver`, dòng 16–28)
- Modify: `apps/api/src/routing/translate.ts` (`translateManeuver`)
- Test: `apps/api/test/routing-translate.test.ts`

- [x] **Step 1: Viết test thất bại**

Trong `describe('translateDirections', …)` của `apps/api/test/routing-translate.test.ts`, sau `it('waypoints: …')`, thêm:

```ts
  it('verbal_alert: null khi Valhalla không trả, có thì giữ nguyên (spec B mục 6.1)', () => {
    expect(route?.legs[0]?.steps[0]?.verbal_alert).toBeNull();
    const realOut = translateDirections(real as unknown as ValhallaRouteResponse, 'motorbike', null);
    expect(realOut.routes[0]?.legs[0]?.steps[1]?.verbal_alert).toBe('Rẽ phải vào Nguyễn Du.');
    expect(realOut.routes[0]?.legs[0]?.steps[0]?.verbal_alert).toBeNull();
  });
```

- [x] **Step 2: Chạy test, xác nhận đỏ**

Run: `cd apps/api && pnpm exec vitest run test/routing-translate.test.ts`
Expected: FAIL — `expected undefined to be null` (trường chưa tồn tại).

- [x] **Step 3: Thêm trường vào core, kiểu Valhalla và translate**

`packages/core/src/types.ts`, trong `RouteStep` ngay sau `instruction: string;`:

```ts
  /** Câu rẽ ngắn gọn để đọc lúc còn cách xa (spec B); Valhalla không trả → null. */
  verbal_alert: string | null;
```

`apps/api/src/routing/valhalla.ts`, trong `ValhallaManeuver` ngay sau `instruction: string;`:

```ts
  verbal_transition_alert_instruction?: string;
```

`apps/api/src/routing/translate.ts`, trong `translateManeuver`, ngay sau `instruction: m.instruction,`:

```ts
    verbal_alert: m.verbal_transition_alert_instruction ?? null,
```

- [x] **Step 4: Build core, chạy test, typecheck**

Run: `pnpm --filter @mapslibvn/core build && cd apps/api && pnpm exec vitest run test/routing-translate.test.ts && cd ../.. && pnpm typecheck`
Expected: test PASS; typecheck xanh (không nơi nào khác dựng `RouteStep`).

- [x] **Step 5: Commit**

```bash
git add packages/core/src/types.ts apps/api/src/routing/valhalla.ts apps/api/src/routing/translate.ts apps/api/test/routing-translate.test.ts
git commit -m "feat(routing): thêm verbal_alert vào RouteStep từ verbal_transition_alert_instruction (spec B 6.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Bảng cụm từ `vi-phrases.ts` và áp vào translate khi `lang=vi`

**Files:**
- Create: `apps/api/src/routing/vi-phrases.ts`
- Create: `apps/api/test/routing-vi-phrases.test.ts`
- Modify: `apps/api/test/env.d.ts` (khai báo `*?raw`)
- Modify: `apps/api/src/routing/translate.ts` (tham số `lang`)
- Modify: `apps/api/src/routes/directions.ts:45` (truyền `params.lang`)
- Modify: `apps/api/test/routing-translate.test.ts`
- Modify: `apps/api/test-routing/directions.rtest.mjs`

- [x] **Step 1: Khai báo kiểu cho import `?raw`**

Thêm vào cuối `apps/api/test/env.d.ts`:

```ts
declare module '*?raw' {
  const text: string;
  export default text;
}
```

- [x] **Step 2: Viết test thất bại cho từng luật và corpus**

Tạo `apps/api/test/routing-vi-phrases.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import provinces from '../../../packages/core/src/provinces.json';
import addresses from '../../../packages/core/tests/fixtures/addresses.jsonl?raw';
import type { ValhallaRouteResponse } from '../src/routing/valhalla';
import { VI_PHRASE_RULES, applyViPhrases } from '../src/routing/vi-phrases';
import q1 from './fixtures/valhalla/q1-motorbike.json';
import twoLegs from './fixtures/valhalla/two-legs.json';

/** [câu Valhalla, câu mong đợi] — bảng spec B mục 6.2, PHONG duyệt trước khi deploy. */
const CASES: [string, string][] = [
  ['Điểm đến của bạn nằm ở trái.', 'Điểm đến ở bên trái.'],
  ['Điểm đến của bạn nằm ở phải.', 'Điểm đến ở bên phải.'],
  ['Địa điểm của bạn sẽ nằm ở trái.', 'Điểm đến ở bên trái.'],
  ['Rẽ trái hình chữ U vào Lê Lợi.', 'Quay đầu bên trái vào Lê Lợi.'],
  ['Rẽ phải hình chữ U.', 'Quay đầu bên phải.'],
  ['Sáp nhập.', 'Nhập làn.'],
  ['Sáp nhập trái vào Xa lộ Hà Nội.', 'Nhập làn bên trái vào Xa lộ Hà Nội.'],
  ['Sáp nhập vào Xa lộ Hà Nội.', 'Nhập vào Xa lộ Hà Nội.'],
  ['Sáp nhập về hướng Biên Hòa.', 'Nhập làn về hướng Biên Hòa.'],
  ['Đi vào đoạn đường nối phía phải.', 'Đi vào đường nhánh phía phải.'],
  ['Rẽ trái để đi vào đoạn đường nối.', 'Rẽ trái để đi vào đường nhánh.'],
  ['Rẽ ra ngoài tại đoạn rẽ phải.', 'Ra ở lối ra bên phải.'],
  ['Rẽ ra ngoài tại đoạn rẽ QL1 phía trái.', 'Ra ở lối ra QL1 phía trái.'],
  ['Rẽ vào đoạn rẽ 12 phía trái.', 'Vào lối ra 12 phía trái.'],
  ['Giữ trái tại điểm giao.', 'Giữ bên trái tại điểm giao.'],
  [
    'Giữ phải để rẽ ra ngoài tại đoạn rẽ 3 vào Võ Nguyên Giáp.',
    'Giữ bên phải để rẽ ra ngoài tại lối ra 3 vào Võ Nguyên Giáp.',
  ],
  [
    'Lái về phía đông nam trên Công trường Công xã Paris.',
    'Đi về hướng đông nam trên Công trường Công xã Paris.',
  ],
  [
    'Lái về phía đông nam trên Công trường Công xã Paris. Rồi, trong 100 mét nữa, Rẽ phải vào Nguyễn Du.',
    'Đi về hướng đông nam trên Công trường Công xã Paris. Rồi, trong 100 mét nữa, rẽ phải vào Nguyễn Du.',
  ],
  ['Rẽ trái vào Lê Lợi. Rồi Rẽ phải vào Nguyễn Huệ.', 'Rẽ trái vào Lê Lợi. Rồi rẽ phải vào Nguyễn Huệ.'],
  // Giữ nguyên
  ['Rẽ trái vào Lê Lợi.', 'Rẽ trái vào Lê Lợi.'],
  ['Bạn đã đến điểm dừng.', 'Bạn đã đến điểm dừng.'],
  ['Bạn đã tới nơi.', 'Bạn đã tới nơi.'],
  ['Vào vòng xuyến và đi lối ra thứ 2.', 'Vào vòng xuyến và đi lối ra thứ 2.'],
  ['Tiếp tục đi thêm 300 mét.', 'Tiếp tục đi thêm 300 mét.'],
  ['Đi tiếp trên Lê Lợi.', 'Đi tiếp trên Lê Lợi.'],
];

const streetNames = (json: ValhallaRouteResponse): string[] =>
  json.trip.legs.flatMap((leg) => leg.maneuvers.flatMap((m) => m.street_names ?? []));

describe('applyViPhrases', () => {
  for (const [input, expected] of CASES) {
    it(`"${input}" → "${expected}"`, () => {
      expect(applyViPhrases(input)).toBe(expected);
    });
  }

  it('mọi luật có cờ u và ghi chú câu mẫu; bảng không quá 30 luật (spec B 1.5: vượt thì cân nhắc tự sinh câu)', () => {
    expect(VI_PHRASE_RULES.length).toBeLessThanOrEqual(30);
    for (const rule of VI_PHRASE_RULES) {
      expect(rule.pattern.flags).toContain('u');
      expect(rule.note.length).toBeGreaterThan(0);
    }
  });

  it('không luật nào đụng tên đường trong fixture, 341 địa chỉ thật và 34 tỉnh + alias', () => {
    const corpus = [
      ...streetNames(q1 as unknown as ValhallaRouteResponse),
      ...streetNames(twoLegs as unknown as ValhallaRouteResponse),
      ...addresses
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { input: string }).input),
      ...Object.keys(provinces),
      ...Object.values(provinces as Record<string, string[]>).flat(),
    ];
    expect(corpus.length).toBeGreaterThan(400);
    for (const text of corpus) {
      expect(applyViPhrases(text), text).toBe(text);
      // Tên đường đứng sau "vào " trong câu rẽ cũng không được đổi.
      expect(applyViPhrases(`Rẽ trái vào ${text}.`)).toBe(`Rẽ trái vào ${text}.`);
    }
  });
});
```

- [x] **Step 3: Chạy test, xác nhận đỏ**

Run: `cd apps/api && pnpm exec vitest run test/routing-vi-phrases.test.ts`
Expected: FAIL — `Failed to resolve import "../src/routing/vi-phrases"`.

- [x] **Step 4: Viết `vi-phrases.ts`**

Tạo `apps/api/src/routing/vi-phrases.ts`:

```ts
/**
 * Bảng cụm từ vá câu tiếng Việt dịch máy của Valhalla (spec B mục 6.2).
 *
 * Locale nằm TRONG binary Valhalla (kiểm image 3.8.3 ngày 12/09/2026) nên không sửa được ở máy chủ;
 * Worker sửa trên chuỗi đã sinh. Mọi luật phải neo vào chữ của CÂU MẪU: `^` đầu câu, `\.$` cuối câu,
 * hoặc cụm nhiều từ không thể là tên đường. Test corpus (tên đường fixture, 341 địa chỉ, 34 tỉnh) bảo vệ.
 * Bảng vượt ~30 luật → cân nhắc để Worker tự sinh câu (spec B mục 10), không nhồi thêm.
 */
export interface ViPhraseRule {
  /** Cờ `u` bắt buộc; thêm `g` khi cụm có thể lặp trong một câu. */
  pattern: RegExp;
  replace: string | ((match: string, ...groups: string[]) => string);
  /** Khối/câu mẫu trong `locales/vi-VN.json` bị ảnh hưởng, để PHONG duyệt. */
  note: string;
}

const lowerFirstLetter = (_match: string, lead: string, letter: string): string =>
  `${lead}${letter.toLowerCase()}`;

export const VI_PHRASE_RULES: readonly ViPhraseRule[] = [
  {
    pattern: /^Điểm đến của bạn nằm ở (trái|phải)\.$/u,
    replace: 'Điểm đến ở bên $1.',
    note: 'destination.2 / destination_verbal.2',
  },
  {
    pattern: /^Địa điểm của bạn sẽ nằm ở (trái|phải)\.$/u,
    replace: 'Điểm đến ở bên $1.',
    note: 'destination_verbal_alert.2',
  },
  { pattern: /^Rẽ (trái|phải) hình chữ U/u, replace: 'Quay đầu bên $1', note: 'uturn.* / uturn_verbal.*' },
  { pattern: /^Sáp nhập\.$/u, replace: 'Nhập làn.', note: 'merge.0' },
  { pattern: /^Sáp nhập (trái|phải)/u, replace: 'Nhập làn bên $1', note: 'merge.1 .3 .5' },
  { pattern: /^Sáp nhập vào/u, replace: 'Nhập vào', note: 'merge.2' },
  { pattern: /^Sáp nhập về hướng/u, replace: 'Nhập làn về hướng', note: 'merge.4' },
  { pattern: /đoạn đường nối/gu, replace: 'đường nhánh', note: 'ramp.* / ramp_verbal.*' },
  {
    pattern: /^Rẽ ra ngoài (?:tại|vào) đoạn rẽ (trái|phải)\.$/u,
    replace: 'Ra ở lối ra bên $1.',
    note: 'exit.0 (chỉ hướng, không biển số)',
  },
  {
    pattern: /^Rẽ ra ngoài (?:tại|vào) đoạn rẽ/u,
    replace: 'Ra ở lối ra',
    note: 'exit.2 .4 .6 (có biển/hướng)',
  },
  { pattern: /^Rẽ vào đoạn rẽ (\d+)/u, replace: 'Vào lối ra $1', note: 'exit.1 .3 .5 .7' },
  { pattern: /đoạn rẽ (\d+)/gu, replace: 'lối ra $1', note: 'keep.1 .3 .5 .7 (giữa câu)' },
  { pattern: /^Giữ (trái|phải)/u, replace: 'Giữ bên $1', note: 'keep.* / keep_to_stay_on.*' },
  { pattern: /^Lái về phía/u, replace: 'Đi về hướng', note: 'start.* cho xe máy và ô tô' },
  {
    pattern: /(nữa, |Rồi, |Rồi )(\p{Lu})/gu,
    replace: lowerFirstLetter,
    note: 'verbal_multi_cue.*: chữ hoa đầu cue thứ hai giữa câu',
  },
];

/** Áp tuần tự mọi luật; câu không khớp luật nào trả về nguyên văn. */
export function applyViPhrases(text: string): string {
  let out = text;
  for (const rule of VI_PHRASE_RULES) {
    out =
      typeof rule.replace === 'string'
        ? out.replace(rule.pattern, rule.replace)
        : out.replace(rule.pattern, rule.replace);
  }
  return out;
}
```

- [x] **Step 5: Chạy test luật, xác nhận xanh**

Run: `cd apps/api && pnpm exec vitest run test/routing-vi-phrases.test.ts`
Expected: PASS toàn bộ (26 ca + 2 test cấu trúc). Nếu ca corpus đỏ ở một địa chỉ cụ thể, siết luật đó (thêm neo), không bỏ test.

- [x] **Step 6: Viết test thất bại cho translate theo `lang`**

Trong `apps/api/test/routing-translate.test.ts`, `describe('fixture Valhalla thật …')`, thêm:

```ts
  it('lang=vi (mặc định) áp bảng cụm từ; lang=en giữ nguyên chữ Valhalla', () => {
    const vi = translateDirections(real as unknown as ValhallaRouteResponse, 'motorbike', null);
    const steps = vi.routes[0]?.legs[0]?.steps ?? [];
    expect(steps.at(-1)?.instruction).toBe('Điểm đến ở bên trái.');
    expect(steps.at(-1)?.verbal_alert).toBe('Điểm đến ở bên trái.');
    expect(steps[0]?.instruction).toBe('Đi về hướng đông nam trên Công trường Công xã Paris.');
    expect(steps[0]?.verbal_pre).toBe(
      'Đi về hướng đông nam trên Công trường Công xã Paris. Rồi, trong 100 mét nữa, rẽ phải vào Nguyễn Du.',
    );
    const en = translateDirections(real as unknown as ValhallaRouteResponse, 'motorbike', null, 'en');
    expect(en.routes[0]?.legs[0]?.steps.at(-1)?.instruction).toBe('Điểm đến của bạn nằm ở trái.');
  });
```

Run: `cd apps/api && pnpm exec vitest run test/routing-translate.test.ts`
Expected: FAIL — instruction vẫn là câu Valhalla.

- [x] **Step 7: Nối `lang` vào translate và route**

`apps/api/src/routing/translate.ts`:

Thêm import:

```ts
import type { DirectionsLang } from '@mapslibvn/core';
import { applyViPhrases } from './vi-phrases';
```

(`DirectionsLang` gộp vào khối `import { type … } from '@mapslibvn/core'` sẵn có cho Biome organizeImports.)

Thay `translateManeuver` bằng:

```ts
const patchVi = (step: RouteStep): RouteStep => ({
  ...step,
  instruction: applyViPhrases(step.instruction),
  verbal_alert: step.verbal_alert === null ? null : applyViPhrases(step.verbal_alert),
  verbal_pre: step.verbal_pre === null ? null : applyViPhrases(step.verbal_pre),
  verbal_post: step.verbal_post === null ? null : applyViPhrases(step.verbal_post),
});

function translateManeuver(
  m: ValhallaManeuver,
  offset: number,
  coords: readonly [number, number][],
  lang: DirectionsLang,
): RouteStep {
  const kind = maneuverKindFromValhalla(m.type);
  const begin = m.begin_shape_index + offset;
  const step: RouteStep = {
    kind,
    instruction: m.instruction,
    verbal_alert: m.verbal_transition_alert_instruction ?? null,
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
  return lang === 'vi' ? patchVi(step) : step;
}
```

`translateTrip` nhận thêm tham số cuối `lang: DirectionsLang = 'vi'` và gọi `translateManeuver(m, offset, merged.coords, lang)`. `translateDirections` nhận `lang: DirectionsLang = 'vi'` làm tham số thứ tư, truyền cho cả `translateTrip(json.trip, mode, merged, lang)` và `translateTrip(a.trip, mode, undefined, lang)` (alternates — `mergeLegShapes` mặc định khi `undefined`).

`apps/api/src/routes/directions.ts` dòng `return translateDirections(json, params.mode, graph);` → `return translateDirections(json, params.mode, graph, params.lang);`

- [x] **Step 8: Chạy toàn bộ test Worker và typecheck**

Run: `cd apps/api && pnpm exec vitest run && cd ../.. && pnpm typecheck`
Expected: PASS (fixture `two-legs` không có câu nào khớp luật nên các test cũ giữ nguyên).

- [x] **Step 9: Thêm kiểm câu đã vá vào test tích hợp Valhalla**

`apps/api/test-routing/directions.rtest.mjs`, trong vòng `for (const mode …)`, sau dòng `expect(steps.some((s) => VI.test(s.instruction))).toBe(true);` thêm:

```js
      // Spec B mục 6.2: câu đã qua bảng cụm từ, và mọi bước có verbal_alert (string hoặc null).
      expect(steps.at(-1).instruction).toMatch(/^(Điểm đến ở bên (trái|phải)\.|Bạn đã tới nơi\.)$/);
      for (const s of steps) {
        expect(s).toHaveProperty('verbal_alert');
        expect(s.instruction).not.toMatch(/hình chữ U|^Sáp nhập|nằm ở (trái|phải)\.$|^Lái về phía/);
      }
```

Không chạy được trên máy không có Docker; Task 19 chạy `pnpm test:routing`.

- [x] **Step 10: Commit**

```bash
git add apps/api/src/routing/vi-phrases.ts apps/api/src/routing/translate.ts apps/api/src/routes/directions.ts apps/api/test/env.d.ts apps/api/test/routing-vi-phrases.test.ts apps/api/test/routing-translate.test.ts apps/api/test-routing/directions.rtest.mjs
git commit -m "feat(routing): vá câu tiếng Việt Valhalla bằng bảng cụm từ khi lang=vi (spec B 6.2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Fixture `DirectionsResponse` dùng chung, sinh và giữ đồng bộ bằng test Worker

**Files:**
- Create: `apps/api/test/routing-fixture-sync.test.ts`
- Create (sinh ra): `packages/core/tests/fixtures/directions-q1.json`
- Modify: `apps/docs/scripts/copy-sdk.mjs`
- Modify: `apps/docs/.gitignore` (nếu có) — không cần; `public/fixtures/` sinh lúc prebuild, thêm vào gitignore của docs

- [x] **Step 1: Viết test đồng bộ (đây vừa là test vừa là bộ sinh)**

Tạo `apps/api/test/routing-fixture-sync.test.ts`:

```ts
import { expect, it } from 'vitest';
import { translateDirections } from '../src/routing/translate';
import type { ValhallaRouteResponse } from '../src/routing/valhalla';
import q1 from './fixtures/valhalla/q1-motorbike.json';

/**
 * Fixture DirectionsResponse dùng chung cho test core, web và demo docs (spec B mục 7.0).
 * Lệch với translate() hiện tại → đỏ. Cập nhật: từ apps/api chạy
 *   pnpm exec vitest run test/routing-fixture-sync.test.ts -u
 * rồi commit cả file JSON. `toMatchFileSnapshot` chạy được trong workers pool (kiểm 12/09/2026).
 */
it('packages/core/tests/fixtures/directions-q1.json khớp translateDirections(q1-motorbike, vi)', async () => {
  const out = translateDirections(
    q1 as unknown as ValhallaRouteResponse,
    'motorbike',
    '2026-09-11',
    'vi',
  );
  await expect(`${JSON.stringify(out, null, 2)}\n`).toMatchFileSnapshot(
    '../../../packages/core/tests/fixtures/directions-q1.json',
  );
});
```

- [x] **Step 2: Chạy lần đầu để sinh file, rồi chạy lại để so khớp**

Run: `cd apps/api && pnpm exec vitest run test/routing-fixture-sync.test.ts && pnpm exec vitest run test/routing-fixture-sync.test.ts`
Expected: lần 1 in `Snapshots 1 written`; lần 2 PASS không ghi. Kiểm file:

Run: `node -e 'const j=require("./packages/core/tests/fixtures/directions-q1.json");const s=j.routes[0].legs[0].steps;console.log(s.length, s.map(x=>x.kind).join(","), "|", s.at(-1).instruction, "|", j.waypoints.length)'`
Expected: `6 depart,turn_right,turn_left,turn_right,turn_left,arrive | Điểm đến ở bên trái. | 2`

- [x] **Step 3: Chép fixture sang docs lúc prebuild**

`apps/docs/scripts/copy-sdk.mjs`, thêm trước dòng `console.log('✓ copy SDK vào public/sdk');`:

```js
// Fixture tuyến Quận 1 cho demo dẫn đường và E2E (spec B mục 7.0) — một nguồn, không chép tay.
const fixtureSrc = resolve('../../packages/core/tests/fixtures/directions-q1.json');
const fixtureDst = resolve('public/fixtures');
if (!existsSync(fixtureSrc))
  throw new Error('Thiếu directions-q1.json — chạy test apps/api routing-fixture-sync trước');
mkdirSync(fixtureDst, { recursive: true });
copyFileSync(fixtureSrc, resolve(fixtureDst, 'directions-q1.json'));
```

`apps/docs/.gitignore` đã có `public/sdk/`; thêm dòng `public/fixtures/` ngay dưới.

Run: `cd apps/docs && node scripts/copy-sdk.mjs && ls public/fixtures`
Expected: in `✓ copy SDK vào public/sdk` và `directions-q1.json`. (Cần `packages/web/dist` sẵn; nếu thiếu, `pnpm --filter @mapslibvn/web build` trước.)

- [x] **Step 4: Commit**

```bash
git add apps/api/test/routing-fixture-sync.test.ts packages/core/tests/fixtures/directions-q1.json apps/docs/scripts/copy-sdk.mjs apps/docs/.gitignore
git commit -m "test(routing): fixture DirectionsResponse Quận 1 dùng chung, đồng bộ bằng toMatchFileSnapshot (spec B 7.0)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Kiểu dữ liệu `navigation/types.ts`, bảng ngưỡng, `geometry.ts`

**Files:**
- Create: `packages/core/src/navigation/types.ts`
- Create: `packages/core/src/navigation/geometry.ts`
- Create: `packages/core/src/navigation/index.ts`
- Modify: `packages/core/src/index.ts` (thêm `export * from './navigation';`)
- Modify: `packages/core/.size-limit.json` (trần 12 → 16 kB)
- Test: `packages/core/src/navigation/geometry.test.ts`, `packages/core/src/navigation/types.test.ts`

- [x] **Step 1: Viết test thất bại cho hình học và bảng ngưỡng**

Tạo `packages/core/src/navigation/geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  angleDiffDeg,
  bearingDeg,
  cumulativeDistances,
  haversineM,
  projectOnSegment,
} from './geometry';

// 1° trên kinh tuyến với R = 6 371 008,8 m là 111 195,08 m.
const ONE_DEG_M = 111_195.08;

describe('geometry', () => {
  it('haversine: 1° vĩ độ ≈ 111 195 m, cùng điểm = 0, đối xứng', () => {
    expect(haversineM([0, 0], [0, 1])).toBeCloseTo(ONE_DEG_M, 0);
    expect(haversineM([106.7, 10.77], [106.7, 10.77])).toBe(0);
    expect(haversineM([106.699, 10.7798], [106.698, 10.7725])).toBeCloseTo(
      haversineM([106.698, 10.7725], [106.699, 10.7798]),
      6,
    );
    // Nhà thờ Đức Bà → Chợ Bến Thành đường chim bay ~0,82 km
    expect(haversineM([106.699, 10.7798], [106.698, 10.7725])).toBeGreaterThan(800);
    expect(haversineM([106.699, 10.7798], [106.698, 10.7725])).toBeLessThan(840);
  });

  it('bearing bốn hướng chính, kết quả trong [0, 360)', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 5);
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 5);
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(180, 5);
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(270, 5);
  });

  it('angleDiffDeg: chênh góc nhỏ nhất, xử lý vòng 360', () => {
    expect(angleDiffDeg(10, 350)).toBe(20);
    expect(angleDiffDeg(90, 270)).toBe(180);
    expect(angleDiffDeg(45, 45)).toBe(0);
  });

  it('projectOnSegment: điểm giữa đoạn → t≈0,5, khoảng cách vuông góc ≈ 11 m; ngoài đầu mút thì kẹp', () => {
    const a: [number, number] = [106.7, 10.77];
    const b: [number, number] = [106.701, 10.77]; // ~109 m về đông
    const mid = projectOnSegment([106.7005, 10.7701], a, b);
    expect(mid.t).toBeCloseTo(0.5, 2);
    expect(mid.distance_m).toBeCloseTo(11.12, 0);
    expect(mid.point[0]).toBeCloseTo(106.7005, 6);
    expect(mid.point[1]).toBeCloseTo(10.77, 6);

    const beyond = projectOnSegment([106.702, 10.77], a, b);
    expect(beyond.t).toBe(1);
    expect(beyond.point).toEqual(b);
    expect(beyond.distance_m).toBeCloseTo(haversineM([106.702, 10.77], b), 0);

    const degenerate = projectOnSegment([106.7, 10.7701], a, a);
    expect(degenerate.t).toBe(0);
    expect(degenerate.distance_m).toBeCloseTo(11.12, 0);
  });

  it('cumulativeDistances: bắt đầu 0, tăng đơn điệu, cộng dồn haversine', () => {
    const cum = cumulativeDistances([
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeCloseTo(ONE_DEG_M, 0);
    expect(cum[2]).toBeCloseTo(ONE_DEG_M + haversineM([0, 1], [1, 1]), 3);
    expect(cumulativeDistances([])).toEqual([]);
    expect(cumulativeDistances([[1, 1]])).toEqual([0]);
  });
});
```

Tạo `packages/core/src/navigation/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NAVIGATION_THRESHOLDS } from './types';

describe('NAVIGATION_THRESHOLDS (spec B mục 4.3)', () => {
  it('ba phương tiện, giá trị khởi điểm đúng bảng', () => {
    expect(Object.keys(NAVIGATION_THRESHOLDS).sort()).toEqual(['car', 'motorbike', 'walk']);
    expect(NAVIGATION_THRESHOLDS.walk).toEqual({
      offRoute_m: 25,
      offRouteFixes: 3,
      offRouteSeconds: 5,
      maxAccuracy_m: 60,
      approach_m: 40,
      pre_m: 15,
      arrive_m: 15,
      rerouteCooldown_s: 15,
      rerouteMaxFailures: 3,
    });
    expect(NAVIGATION_THRESHOLDS.motorbike).toMatchObject({
      offRoute_m: 40,
      maxAccuracy_m: 100,
      approach_m: 200,
      pre_m: 50,
      arrive_m: 25,
    });
    expect(NAVIGATION_THRESHOLDS.car).toMatchObject({
      offRoute_m: 50,
      maxAccuracy_m: 100,
      approach_m: 400,
      pre_m: 80,
      arrive_m: 30,
    });
  });

  it('câu rẽ luôn đọc gần hơn câu "Trong X nữa", và bán kính đến nơi không lớn hơn câu rẽ', () => {
    for (const th of Object.values(NAVIGATION_THRESHOLDS)) {
      expect(th.pre_m).toBeLessThan(th.approach_m);
      expect(th.arrive_m).toBeLessThanOrEqual(th.pre_m + 1);
    }
  });
});
```

- [x] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/src/navigation`
Expected: FAIL — không resolve được `./geometry`, `./types`.

- [x] **Step 3: Viết `types.ts`**

Tạo `packages/core/src/navigation/types.ts`:

```ts
import type {
  DirectionsLang,
  DirectionsOptions,
  DirectionsResponse,
  Route,
  RouteStep,
  TravelMode,
  Waypoint,
} from '../types';

/** Một điểm định vị. Lớp dán (web/RN) đổi từ API nền tảng sang dạng này. */
export interface GeoFix {
  lng: number;
  lat: number;
  /** Bán kính sai số (m). Thiếu → coi là 10 m. */
  accuracy_m?: number;
  /** Độ so với bắc, thuận chiều kim đồng hồ; null/undefined khi đứng yên hoặc không có. */
  heading?: number | null;
  speed_mps?: number | null;
  /** ms epoch — nguồn thời gian duy nhất của máy trạng thái. */
  timestamp: number;
}

/** Nguồn tuyến. `MapsLibVNClient` của `createClient` thoả kiểu này không cần bọc. */
export interface RouteProvider {
  directions(opts: DirectionsOptions): Promise<DirectionsResponse>;
}

export interface PositionError {
  code: 'denied' | 'unavailable' | 'timeout';
  message: string;
  raw?: unknown;
}

/** Nguồn vị trí do lớp dán cung cấp; core chỉ định nghĩa kiểu để web và RN cùng hình. */
export interface PositionSource {
  subscribe(onFix: (fix: GeoFix) => void, onError?: (error: PositionError) => void): () => void;
}

export type NavigationStatus =
  | 'idle'
  | 'navigating'
  | 'off_route'
  | 'rerouting'
  | 'arrived'
  | 'stopped';

export interface NavigationThresholds {
  /** Ngưỡng lệch cơ sở; hiệu dụng = max(offRoute_m, 1.5 × accuracy_m). */
  offRoute_m: number;
  /** Số fix liên tiếp ngoài ngưỡng để xác nhận lệch. */
  offRouteFixes: number;
  /** … và đã kéo dài ít nhất bấy nhiêu giây (theo timestamp fix). */
  offRouteSeconds: number;
  /** Fix kém hơn thì bỏ, không cập nhật gì. */
  maxAccuracy_m: number;
  /** Đọc "Trong X nữa, …" khi còn ≤. */
  approach_m: number;
  /** Đọc câu rẽ khi còn ≤. */
  pre_m: number;
  /** Bán kính đến nơi / qua điểm via. */
  arrive_m: number;
  rerouteCooldown_s: number;
  rerouteMaxFailures: number;
}

/** Số khởi điểm theo spec B mục 4.3; chốt lại sau thực địa (Task 20). */
export const NAVIGATION_THRESHOLDS: Readonly<Record<TravelMode, NavigationThresholds>> = {
  walk: {
    offRoute_m: 25,
    offRouteFixes: 3,
    offRouteSeconds: 5,
    maxAccuracy_m: 60,
    approach_m: 40,
    pre_m: 15,
    arrive_m: 15,
    rerouteCooldown_s: 15,
    rerouteMaxFailures: 3,
  },
  motorbike: {
    offRoute_m: 40,
    offRouteFixes: 3,
    offRouteSeconds: 5,
    maxAccuracy_m: 100,
    approach_m: 200,
    pre_m: 50,
    arrive_m: 25,
    rerouteCooldown_s: 15,
    rerouteMaxFailures: 3,
  },
  car: {
    offRoute_m: 50,
    offRouteFixes: 3,
    offRouteSeconds: 5,
    maxAccuracy_m: 100,
    approach_m: 400,
    pre_m: 80,
    arrive_m: 30,
    rerouteCooldown_s: 15,
    rerouteMaxFailures: 3,
  },
};

export interface NavigationProgress {
  status: NavigationStatus;
  route: Route;
  routeIndex: number;
  legIndex: number;
  /** Chỉ số step PHẲNG qua mọi leg (spec B 4.4). */
  stepIndex: number;
  step: RouteStep;
  /** Step có điểm rẽ kế tiếp; null khi step hiện tại là arrive cuối. */
  nextStep: RouteStep | null;
  /** [lng, lat] điểm đã bám lên tuyến. */
  snapped: [number, number];
  /** Hướng đi (độ): heading GPS khi speed_mps > 1, còn không thì hướng đoạn tuyến. */
  bearing: number;
  /** Chỉ số đỉnh đầu của đoạn polyline đang ở. */
  shapeIndex: number;
  traveled_m: number;
  remaining_m: number;
  /** ETA: phần còn lại của step hiện tại theo tỉ lệ + tổng duration các step sau. */
  remaining_s: number;
  /** Tới điểm rẽ của nextStep; 0 khi không còn. */
  distanceToStep_m: number;
  /** Khoảng cách vuông góc từ fix tới tuyến. */
  offRoute_m: number;
  fix: GeoFix;
}

export interface Announcement {
  text: string;
  kind: 'depart' | 'post' | 'approach' | 'pre' | 'arrive';
  stepIndex: number;
  /** 3 = câu rẽ / đến nơi / khởi hành, 2 = "Trong X nữa", 1 = verbal_post. */
  priority: 1 | 2 | 3;
}

export interface NavigationEvents {
  status: { status: NavigationStatus; previous: NavigationStatus };
  progress: NavigationProgress;
  step: { stepIndex: number; step: RouteStep };
  waypoint: { legIndex: number; waypoint: Waypoint };
  offRoute: { distance_m: number; fix: GeoFix };
  reroute: { reason: 'off_route' | 'manual'; response: DirectionsResponse };
  rerouteFailed: { error: unknown; attempts: number; final: boolean };
  announce: Announcement;
  arrive: { waypoint: Waypoint; fix: GeoFix };
}

export interface NavigatorOptions {
  response: DirectionsResponse;
  /** Mặc định 0. */
  routeIndex?: number;
  /** Bắt buộc khi `reroute` là 'auto' (mặc định). */
  provider?: RouteProvider;
  /** Mặc định 'auto'. */
  reroute?: 'auto' | 'manual';
  /** Mặc định 'vi'; dùng cho câu "Trong X nữa" và request tính lại. */
  lang?: DirectionsLang;
  thresholds?: Partial<NavigationThresholds>;
}

export interface Navigator {
  readonly status: NavigationStatus;
  readonly progress: NavigationProgress | null;
  /** Đồng bộ. Fix kém accuracy hoặc timestamp không tăng bị bỏ. */
  update(fix: GeoFix): void;
  /** Thay tuyến: reset bước, lịch đọc, bộ đếm lệch; fix kế tiếp bám trên toàn tuyến. */
  setRoute(response: DirectionsResponse, routeIndex?: number): void;
  /** Gọi provider ngay (bỏ cooldown và trần lỗi). */
  reroute(): Promise<void>;
  stop(): void;
  on<K extends keyof NavigationEvents>(event: K, handler: (e: NavigationEvents[K]) => void): void;
  off<K extends keyof NavigationEvents>(event: K, handler: (e: NavigationEvents[K]) => void): void;
}
```

- [x] **Step 4: Viết `geometry.ts`**

Tạo `packages/core/src/navigation/geometry.ts`:

```ts
/** Hình học cầu và chiếu điểm cho dẫn đường (spec B 4.1). Toạ độ luôn `[lng, lat]`. */
export type LngLat = readonly [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Hướng từ a tới b, độ [0, 360) thuận chiều kim đồng hồ từ bắc. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const phi1 = toRad(a[1]);
  const phi2 = toRad(b[1]);
  const dLambda = toRad(b[0] - a[0]);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Chênh góc nhỏ nhất giữa hai hướng, [0, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export interface Projection {
  /** Vị trí trên đoạn, 0 = a, 1 = b (đã kẹp). */
  t: number;
  point: [number, number];
  /** Khoảng cách từ p tới điểm chiếu (m). */
  distance_m: number;
}

/**
 * Chiếu p lên đoạn ab trong mặt phẳng cục bộ quanh a (equirectangular, đủ chính xác cho đoạn dưới
 * vài km). Đoạn suy biến (a = b) → t = 0.
 */
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): Projection {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(toRad(a[1]));
  const bx = (b[0] - a[0]) * mPerDegLng;
  const by = (b[1] - a[1]) * M_PER_DEG_LAT;
  const px = (p[0] - a[0]) * mPerDegLng;
  const py = (p[1] - a[1]) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const qx = bx * t;
  const qy = by * t;
  const point: [number, number] =
    t === 1 ? [b[0], b[1]] : [a[0] + qx / mPerDegLng, a[1] + qy / M_PER_DEG_LAT];
  return { t, point, distance_m: Math.hypot(px - qx, py - qy) };
}

/** Khoảng cách cộng dồn (m) tại từng đỉnh; `cum[0] = 0`; mảng rỗng → rỗng. */
export function cumulativeDistances(coords: readonly LngLat[]): number[] {
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    const prev = coords[i - 1];
    const cur = coords[i];
    if (i > 0 && prev && cur) total += haversineM(prev, cur);
    cum.push(total);
  }
  return cum;
}
```

Tạo `packages/core/src/navigation/index.ts`:

```ts
export * from './types';
export * from './geometry';
```

`packages/core/src/index.ts` thêm dòng cuối: `export * from './navigation';`

`packages/core/.size-limit.json`: đổi `"limit": "12 kB"` → `"limit": "16 kB"`.

- [x] **Step 5: Chạy test, build, đo size**

Run: `pnpm exec vitest run packages/core/src/navigation && pnpm --filter @mapslibvn/core build && pnpm typecheck`
Expected: test PASS; build in size-limit dưới 16 kB (ghi số đo vào ghi chú commit).

- [x] **Step 6: Commit**

```bash
git add packages/core/src/navigation packages/core/src/index.ts packages/core/.size-limit.json
git commit -m "feat(core): kiểu dữ liệu dẫn đường, bảng ngưỡng theo phương tiện và hình học cầu (spec B 4.1–4.3)

Nâng trần size-limit barrel core 12 → 16 kB theo spec B 4.7.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `progress.ts` — chỉ mục tuyến, step phẳng, ETA

**Files:**
- Create: `packages/core/src/navigation/progress.ts`
- Create: `packages/core/tests/helpers/synthetic-route.ts`
- Test: `packages/core/src/navigation/progress.test.ts`
- Modify: `packages/core/src/navigation/index.ts`

- [x] **Step 1: Helper tuyến hai leg tổng hợp**

Tạo `packages/core/tests/helpers/synthetic-route.ts`:

```ts
import type { DirectionsResponse, RouteStep } from '../../src/types';
import { encodePolyline6 } from '../../src/polyline';

/**
 * Tuyến thẳng hướng bắc 4 đoạn × ~111 m (0,001° vĩ độ), hai leg, via ở đỉnh 2.
 * Leg 0: depart (0→1), turn_left (1→2), arrive-via (2). Leg 1 offset 2: depart (2→3), continue (3→4), arrive (4).
 */
export const SYNTHETIC_COORDS: [number, number][] = [
  [106.7, 10.77],
  [106.7, 10.771],
  [106.7, 10.772],
  [106.7, 10.773],
  [106.7, 10.774],
];

const step = (
  kind: RouteStep['kind'],
  begin: number,
  end: number,
  distance_m: number,
  duration_s: number,
  instruction: string,
): RouteStep => ({
  kind,
  instruction,
  verbal_alert: instruction,
  verbal_pre: instruction,
  verbal_post: distance_m > 0 ? `Tiếp tục đi thêm ${distance_m} mét.` : null,
  street_names: ['Đường Thử'],
  distance_m,
  duration_s,
  shape_begin: begin,
  shape_end: end,
  location: SYNTHETIC_COORDS[begin] ?? [0, 0],
  roundabout_exit: null,
});

export function syntheticTwoLegRoute(): DirectionsResponse {
  return {
    routes: [
      {
        mode: 'walk',
        distance_m: 445,
        duration_s: 320,
        bbox: [106.7, 10.77, 106.7, 10.774],
        geometry: encodePolyline6(SYNTHETIC_COORDS),
        legs: [
          {
            distance_m: 222,
            duration_s: 160,
            shape_offset: 0,
            steps: [
              step('depart', 0, 1, 111, 80, 'Đi về hướng bắc trên Đường Thử.'),
              step('turn_left', 1, 2, 111, 80, 'Rẽ trái vào Đường Thử.'),
              step('arrive', 2, 2, 0, 0, 'Bạn đã đến điểm dừng.'),
            ],
          },
          {
            distance_m: 223,
            duration_s: 160,
            shape_offset: 2,
            steps: [
              step('depart', 2, 3, 111, 80, 'Đi về hướng bắc trên Đường Thử.'),
              step('continue', 3, 4, 112, 80, 'Đi tiếp trên Đường Thử.'),
              step('arrive', 4, 4, 0, 0, 'Điểm đến ở bên phải.'),
            ],
          },
        ],
        flags: { toll: false, highway: false, ferry: false },
      },
    ],
    waypoints: [
      { location: [106.7, 10.77], snapped: [106.7, 10.77], name: null },
      { location: [106.7, 10.772], snapped: [106.7, 10.772], name: null },
      { location: [106.7, 10.774], snapped: [106.7, 10.774], name: null },
    ],
    attribution: '© OpenStreetMap contributors',
  };
}
```

- [x] **Step 2: Viết test thất bại**

Tạo `packages/core/src/navigation/progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import { syntheticTwoLegRoute } from '../../tests/helpers/synthetic-route';
import type { DirectionsResponse, Route } from '../types';
import { buildRouteIndex, progressAt, stepAt } from './progress';

const q1 = (fixture as unknown as DirectionsResponse).routes[0] as Route;

describe('buildRouteIndex', () => {
  it('fixture Quận 1: 6 step phẳng, mốc mét tăng, tổng ≈ distance_m của tuyến (±5 %)', () => {
    const index = buildRouteIndex(q1);
    expect(index.steps).toHaveLength(6);
    expect(index.steps.map((s) => s.step.kind)).toEqual([
      'depart',
      'turn_right',
      'turn_left',
      'turn_right',
      'turn_left',
      'arrive',
    ]);
    expect(index.steps[0]?.begin_m).toBe(0);
    for (let i = 1; i < index.steps.length; i++) {
      expect(index.steps[i]?.begin_m ?? 0).toBeGreaterThanOrEqual(index.steps[i - 1]?.begin_m ?? 0);
      expect(index.steps[i - 1]?.end_m).toBe(index.steps[i]?.begin_m);
    }
    expect(index.steps.at(-1)?.end_m).toBe(index.total_m);
    expect(Math.abs(index.total_m - q1.distance_m) / q1.distance_m).toBeLessThan(0.05);
    expect(index.legBegin_m).toEqual([0]);
  });

  it('tuyến hai leg: legBegin_m có hai mốc, step arrive-via dài 0 nằm giữa', () => {
    const route = syntheticTwoLegRoute().routes[0] as Route;
    const index = buildRouteIndex(route);
    expect(index.steps).toHaveLength(6);
    expect(index.legBegin_m[0]).toBe(0);
    expect(index.legBegin_m[1]).toBeCloseTo(222.39, 0);
    const via = index.steps[2];
    expect(via?.step.kind).toBe('arrive');
    expect(via?.begin_m).toBe(via?.end_m);
    expect(index.steps[3]?.legIndex).toBe(1);
  });
});

describe('stepAt / progressAt', () => {
  const route = syntheticTwoLegRoute().routes[0] as Route;
  const index = buildRouteIndex(route);

  it('along 0 → step 0; qua via → step depart của leg 1 (bỏ step dài 0); hết tuyến → step cuối', () => {
    expect(stepAt(index, 0)).toBe(0);
    expect(stepAt(index, 150)).toBe(1);
    expect(stepAt(index, index.legBegin_m[1] ?? 0)).toBe(3);
    expect(stepAt(index, (index.legBegin_m[1] ?? 0) + 1)).toBe(3);
    expect(stepAt(index, index.total_m)).toBe(5);
    expect(stepAt(index, index.total_m + 50)).toBe(5);
  });

  it('progressAt: khoảng cách tới step kế, còn lại, ETA giảm đơn điệu', () => {
    const start = progressAt(index, 0);
    expect(start.stepIndex).toBe(0);
    expect(start.legIndex).toBe(0);
    expect(start.distanceToStep_m).toBeCloseTo(111.2, 0);
    expect(start.remaining_m).toBeCloseTo(index.total_m, 6);
    expect(start.remaining_s).toBe(320);

    let previous = start.remaining_s;
    for (let along = 20; along <= index.total_m; along += 20) {
      const p = progressAt(index, along);
      expect(p.remaining_s).toBeLessThanOrEqual(previous);
      previous = p.remaining_s;
    }
    const end = progressAt(index, index.total_m);
    expect(end.stepIndex).toBe(5);
    expect(end.distanceToStep_m).toBe(0);
    expect(end.remaining_m).toBe(0);
    expect(end.remaining_s).toBe(0);
  });

  it('progressAt giữa step 1: ETA = phần còn lại step 1 theo tỉ lệ + các step sau', () => {
    const begin1 = index.steps[1]?.begin_m ?? 0;
    const end1 = index.steps[1]?.end_m ?? 0;
    const p = progressAt(index, (begin1 + end1) / 2);
    // 0,5 × 80 + 0 + 80 + 80 + 0 = 200
    expect(p.remaining_s).toBe(200);
    expect(p.legIndex).toBe(0);
  });
});
```

- [x] **Step 3: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/src/navigation/progress.test.ts`
Expected: FAIL — không resolve `./progress`.

- [x] **Step 4: Viết `progress.ts`**

```ts
import { decodePolyline6 } from '../polyline';
import type { Route, RouteStep } from '../types';
import { cumulativeDistances } from './geometry';

export interface FlatStep {
  step: RouteStep;
  legIndex: number;
  indexInLeg: number;
  /** Mét từ đầu tuyến tới điểm rẽ của step (đầu step). */
  begin_m: number;
  /** = begin_m của step kế, hoặc tổng chiều dài với step cuối. */
  end_m: number;
}

export interface RouteIndex {
  coords: [number, number][];
  /** cum[i] = mét từ đầu tuyến tới đỉnh i. */
  cum: number[];
  total_m: number;
  /** Step phẳng qua mọi leg, theo thứ tự đi. */
  steps: FlatStep[];
  /** Mét tại điểm đầu từng leg (`shape_offset`). */
  legBegin_m: number[];
}

export function buildRouteIndex(route: Route): RouteIndex {
  const coords = decodePolyline6(route.geometry);
  const cum = cumulativeDistances(coords);
  const total_m = cum[cum.length - 1] ?? 0;
  const at = (vertex: number): number => cum[Math.min(Math.max(vertex, 0), cum.length - 1)] ?? 0;

  const steps: FlatStep[] = [];
  route.legs.forEach((leg, legIndex) => {
    leg.steps.forEach((step, indexInLeg) => {
      const begin_m = at(step.shape_begin);
      steps.push({ step, legIndex, indexInLeg, begin_m, end_m: begin_m });
    });
  });
  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    if (current) current.end_m = steps[i + 1]?.begin_m ?? total_m;
  }
  return { coords, cum, total_m, steps, legBegin_m: route.legs.map((leg) => at(leg.shape_offset)) };
}

/**
 * Step đang ở tại along_m: step có begin_m ≤ along < end_m. Step dài 0 (arrive tại via) không bao
 * giờ là "đang ở" trừ step cuối cùng khi along ≥ total.
 */
export function stepAt(index: RouteIndex, along_m: number): number {
  const { steps, total_m } = index;
  if (steps.length === 0) return 0;
  if (along_m >= total_m) return steps.length - 1;
  let found = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s) continue;
    if (s.begin_m > along_m) break;
    if (along_m < s.end_m) {
      found = i;
      break;
    }
    found = i;
  }
  return found;
}

export interface ProgressAt {
  stepIndex: number;
  legIndex: number;
  distanceToStep_m: number;
  remaining_m: number;
  remaining_s: number;
}

export function progressAt(index: RouteIndex, along_m: number): ProgressAt {
  const clamped = Math.max(0, Math.min(along_m, index.total_m));
  const stepIndex = stepAt(index, clamped);
  const current = index.steps[stepIndex];
  const next = index.steps[stepIndex + 1];
  let remaining_s = 0;
  if (current) {
    const length = current.end_m - current.begin_m;
    const fraction = length > 0 ? Math.max(0, Math.min(1, (current.end_m - clamped) / length)) : 0;
    remaining_s += fraction * current.step.duration_s;
  }
  for (let i = stepIndex + 1; i < index.steps.length; i++) {
    remaining_s += index.steps[i]?.step.duration_s ?? 0;
  }
  return {
    stepIndex,
    legIndex: current?.legIndex ?? 0,
    distanceToStep_m: next ? Math.max(0, next.begin_m - clamped) : 0,
    remaining_m: Math.max(0, index.total_m - clamped),
    remaining_s: Math.round(remaining_s),
  };
}
```

`packages/core/src/navigation/index.ts` thêm `export * from './progress';`

- [x] **Step 5: Chạy test**

Run: `pnpm exec vitest run packages/core/src/navigation && pnpm typecheck`
Expected: PASS. Nếu `legBegin_m[1]` lệch 222,39 quá 0,5 m thì đó là bug haversine — không sửa số kỳ vọng.

- [x] **Step 6: Commit**

```bash
git add packages/core/src/navigation packages/core/tests/helpers/synthetic-route.ts
git commit -m "feat(core): chỉ mục tuyến, step phẳng qua leg và ETA cho dẫn đường (spec B 4.4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `snap.ts` — bám tuyến theo cửa sổ

**Files:**
- Create: `packages/core/src/navigation/snap.ts`
- Test: `packages/core/src/navigation/snap.test.ts`
- Modify: `packages/core/src/navigation/index.ts`

- [x] **Step 1: Viết test thất bại**

```ts
import { describe, expect, it } from 'vitest';
import { encodePolyline6 } from '../polyline';
import type { Route } from '../types';
import { buildRouteIndex } from './progress';
import { snapToRoute } from './snap';

/** Đi đông 328 m trên AB, xuống nam 13 m, quay về tây trên CD song song — hai đoạn cách nhau 13 m. */
const OVERLAP: [number, number][] = [
  [106.7, 10.77],
  [106.703, 10.77],
  [106.703, 10.76988],
  [106.7, 10.76988],
];
const routeOf = (coords: [number, number][]): Route => ({
  mode: 'motorbike',
  distance_m: 0,
  duration_s: 0,
  bbox: [0, 0, 0, 0],
  geometry: encodePolyline6(coords),
  legs: [],
  flags: { toll: false, highway: false, ferry: false },
});
const index = buildRouteIndex(routeOf(OVERLAP));
// Điểm giữa AB và CD, cách mỗi đoạn ~6,7 m
const between: [number, number] = [106.7005, 10.76994];

describe('snapToRoute', () => {
  it('fix đầu (không cửa sổ), không heading: hoà → chọn đoạn xa hơn theo chiều đi', () => {
    const s = snapToRoute(index, between, { fromShapeIndex: null, window_m: 300 });
    expect(s?.shapeIndex).toBe(2);
    expect(s?.distance_m).toBeCloseTo(6.67, 0);
  });

  it('có heading đông (90°) → chọn AB dù hoà khoảng cách', () => {
    const s = snapToRoute(index, between, { fromShapeIndex: null, window_m: 300, heading: 90 });
    expect(s?.shapeIndex).toBe(0);
  });

  it('cửa sổ 300 m từ đoạn 0 chỉ chứa AB → không nhảy sang CD dù CD gần bằng', () => {
    const s = snapToRoute(index, between, { fromShapeIndex: 0, window_m: 300 });
    expect(s?.shapeIndex).toBe(0);
    expect(s?.along_m).toBeCloseTo(54.6, 0);
  });

  it('cửa sổ 400 m từ đoạn 0 chứa cả CD → hoà, chọn xa hơn', () => {
    const s = snapToRoute(index, between, { fromShapeIndex: 0, window_m: 400 });
    expect(s?.shapeIndex).toBe(2);
  });

  it('đoạn kề nhau không dùng luật hoà: điểm sát đỉnh chung chọn đoạn thật gần hơn', () => {
    // Điểm ngay trước B, lệch 3 m về bắc: AB gần hơn BC vài mét, không được nhảy lên BC.
    const nearB: [number, number] = [106.70295, 10.77003];
    const s = snapToRoute(index, nearB, { fromShapeIndex: 0, window_m: 400 });
    expect(s?.shapeIndex).toBe(0);
    expect(s?.t).toBeGreaterThan(0.9);
  });

  it('cửa sổ luôn bao gồm đoạn hiện tại và lùi 2 đoạn', () => {
    const s = snapToRoute(index, [106.7029, 10.76985], { fromShapeIndex: 2, window_m: 10 });
    expect(s?.shapeIndex).toBe(2);
    const back = snapToRoute(index, [106.7015, 10.77004], { fromShapeIndex: 2, window_m: 10 });
    expect(back?.shapeIndex).toBe(0);
  });

  it('tuyến dưới 2 điểm → null', () => {
    expect(snapToRoute(buildRouteIndex(routeOf([[106.7, 10.77]])), between, { fromShapeIndex: null, window_m: 100 })).toBeNull();
  });
});
```

- [x] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/src/navigation/snap.test.ts`
Expected: FAIL — không resolve `./snap`.

- [x] **Step 3: Viết `snap.ts`**

```ts
import { type LngLat, angleDiffDeg, bearingDeg, projectOnSegment } from './geometry';
import type { RouteIndex } from './progress';

export interface SnapResult {
  /** Đỉnh đầu của đoạn được chọn. */
  shapeIndex: number;
  t: number;
  point: [number, number];
  /** Khoảng cách vuông góc fix → tuyến (m). */
  distance_m: number;
  /** Mét từ đầu tuyến tới điểm chiếu. */
  along_m: number;
}

export interface SnapOptions {
  /** null → tìm trên toàn tuyến (fix đầu sau start/setRoute). */
  fromShapeIndex: number | null;
  /** Đoạn có mốc đầu ≤ cum[from] + window_m mới được xét. */
  window_m: number;
  heading?: number | null | undefined;
}

/** Hai ứng viên KHÔNG kề nhau chênh dưới ngần này coi là hoà → tie-break theo heading rồi chiều đi. */
const TIE_M = 10;
/** Lùi tối đa bấy nhiêu đoạn so với đoạn hiện tại (nhiễu GPS lùi nhẹ). */
const LOOKBACK_SEGMENTS = 2;

export function snapToRoute(index: RouteIndex, p: LngLat, opts: SnapOptions): SnapResult | null {
  const { coords, cum } = index;
  const segments = coords.length - 1;
  if (segments < 1) return null;

  let lo = 0;
  let hi = segments - 1;
  if (opts.fromShapeIndex !== null) {
    const from = Math.max(0, Math.min(opts.fromShapeIndex, segments - 1));
    lo = Math.max(0, from - LOOKBACK_SEGMENTS);
    const limit = (cum[from] ?? 0) + opts.window_m;
    hi = from;
    for (let i = from + 1; i < segments; i++) {
      if ((cum[i] ?? 0) <= limit) hi = i;
      else break;
    }
  }

  const heading = typeof opts.heading === 'number' && Number.isFinite(opts.heading) ? opts.heading : null;
  let best: SnapResult | null = null;
  for (let i = lo; i <= hi; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    if (!a || !b) continue;
    const proj = projectOnSegment(p, a, b);
    const segStart = cum[i] ?? 0;
    const segEnd = cum[i + 1] ?? segStart;
    const candidate: SnapResult = {
      shapeIndex: i,
      t: proj.t,
      point: proj.point,
      distance_m: proj.distance_m,
      along_m: segStart + proj.t * (segEnd - segStart),
    };
    if (!best) {
      best = candidate;
      continue;
    }
    const diff = candidate.distance_m - best.distance_m;
    const adjacent = candidate.shapeIndex - best.shapeIndex <= 1;
    if (!adjacent && Math.abs(diff) <= TIE_M) {
      best = preferByHeadingOrFurther(coords, best, candidate, heading);
    } else if (diff < 0) {
      best = candidate;
    }
  }
  return best;
}

function segmentBearing(coords: readonly [number, number][], shapeIndex: number): number {
  const a = coords[shapeIndex];
  const b = coords[shapeIndex + 1];
  return a && b ? bearingDeg(a, b) : 0;
}

/** Có heading → đoạn cùng hướng hơn; hoà (hoặc không heading) → đoạn xa hơn theo chiều đi. */
function preferByHeadingOrFurther(
  coords: readonly [number, number][],
  current: SnapResult,
  candidate: SnapResult,
  heading: number | null,
): SnapResult {
  if (heading === null) return candidate;
  const dCurrent = angleDiffDeg(segmentBearing(coords, current.shapeIndex), heading);
  const dCandidate = angleDiffDeg(segmentBearing(coords, candidate.shapeIndex), heading);
  return dCandidate <= dCurrent ? candidate : current;
}
```

`index.ts` thêm `export * from './snap';`

- [x] **Step 4: Chạy test**

Run: `pnpm exec vitest run packages/core/src/navigation/snap.test.ts && pnpm typecheck`
Expected: PASS. Nếu ca "đoạn kề nhau" đỏ vì BC gần hơn thật (điểm chọn chưa đúng), dời `nearB` xa B thêm 0,00002° kinh độ về tây — không đổi luật.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/navigation
git commit -m "feat(core): bám tuyến theo cửa sổ với tie-break heading/chiều đi (spec B 4.4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `announce.ts` — định dạng khoảng cách và lịch đọc

**Files:**
- Create: `packages/core/src/navigation/announce.ts`
- Test: `packages/core/src/navigation/announce.test.ts`
- Modify: `packages/core/src/navigation/index.ts`

- [x] **Step 1: Viết test thất bại**

```ts
import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import type { DirectionsResponse, Route, RouteStep } from '../types';
import {
  composeApproach,
  formatDistance,
  formatDistanceShort,
  lowerFirst,
  planAnnouncements,
  roundForSpeech,
} from './announce';
import { NAVIGATION_THRESHOLDS, type NavigationProgress } from './types';

const route = (fixture as unknown as DirectionsResponse).routes[0] as Route;
const steps = route.legs[0]?.steps ?? [];
const th = NAVIGATION_THRESHOLDS.motorbike;

describe('formatDistance', () => {
  it('tiếng Việt: mét dưới 1 km, ki-lô-mét một chữ số lẻ dưới 10 km, nguyên từ 10 km', () => {
    expect(formatDistance(9)).toBe('9 mét');
    expect(formatDistance(85.4)).toBe('85 mét');
    expect(formatDistance(850)).toBe('850 mét');
    expect(formatDistance(1230)).toBe('1,2 ki-lô-mét');
    expect(formatDistance(1000)).toBe('1,0 ki-lô-mét');
    expect(formatDistance(12_400)).toBe('12 ki-lô-mét');
  });
  it('tiếng Anh', () => {
    expect(formatDistance(85, 'en')).toBe('85 meters');
    expect(formatDistance(1230, 'en')).toBe('1.2 kilometers');
    expect(formatDistance(12_400, 'en')).toBe('12 kilometers');
  });
  it('bản ngắn cho UI', () => {
    expect(formatDistanceShort(85)).toBe('85 m');
    expect(formatDistanceShort(1230)).toBe('1,2 km');
    expect(formatDistanceShort(12_400)).toBe('12 km');
  });
});

describe('roundForSpeech / lowerFirst / composeApproach', () => {
  it('≥ 200 m tròn 50, dưới 200 m tròn 10, tối thiểu 10', () => {
    expect(roundForSpeech(194)).toBe(190);
    expect(roundForSpeech(226)).toBe(250);
    expect(roundForSpeech(3)).toBe(10);
    expect(roundForSpeech(1180)).toBe(1200);
  });
  it('lowerFirst hạ chữ đầu kể cả Đ', () => {
    expect(lowerFirst('Đi tiếp.')).toBe('đi tiếp.');
    expect(lowerFirst('Rẽ phải')).toBe('rẽ phải');
    expect(lowerFirst('')).toBe('');
  });
  it('composeApproach ưu tiên verbal_alert, rồi verbal_pre; không có cả hai → null', () => {
    const turn = steps[1] as RouteStep;
    expect(composeApproach(194, turn, 'vi')).toBe('Trong 190 mét nữa, rẽ phải vào Nguyễn Du.');
    expect(composeApproach(194, turn, 'en')).toBe('In 190 meters, rẽ phải vào Nguyễn Du.');
    const noAlert: RouteStep = { ...turn, verbal_alert: null, verbal_pre: 'Rẽ phải.' };
    expect(composeApproach(400, noAlert, 'vi')).toBe('Trong 400 mét nữa, rẽ phải.');
    expect(composeApproach(400, { ...noAlert, verbal_pre: null }, 'vi')).toBeNull();
  });
});

describe('planAnnouncements', () => {
  const progress = (stepIndex: number, distanceToStep_m: number): NavigationProgress => ({
    status: 'navigating',
    route,
    routeIndex: 0,
    legIndex: 0,
    stepIndex,
    step: steps[stepIndex] as RouteStep,
    nextStep: steps[stepIndex + 1] ?? null,
    snapped: [0, 0],
    bearing: 0,
    shapeIndex: 0,
    traveled_m: 0,
    remaining_m: 0,
    remaining_s: 0,
    distanceToStep_m,
    offRoute_m: 0,
    fix: { lng: 0, lat: 0, timestamp: 0 },
  });

  it('step depart: đọc verbal_pre khởi hành một lần, không đọc post; step kế 140 m không có approach', () => {
    const announced = new Set<string>();
    const first = planAnnouncements(progress(0, 138), th, 'vi', announced, true);
    expect(first.map((a) => a.kind)).toEqual(['depart']);
    expect(first[0]?.priority).toBe(3);
    expect(first[0]?.text).toBe(steps[0]?.verbal_pre);
    // Fix kế: không lặp depart; D = 120 ≤ approach 200 nhưng step 0 chỉ 140 m → không approach.
    expect(planAnnouncements(progress(0, 120), th, 'vi', announced, false)).toEqual([]);
    // D = 45 ≤ pre 50 → câu rẽ của step 1
    const pre = planAnnouncements(progress(0, 45), th, 'vi', announced, false);
    expect(pre).toEqual([
      { text: 'Rẽ phải vào Nguyễn Du.', kind: 'pre', stepIndex: 1, priority: 3 },
    ]);
    expect(planAnnouncements(progress(0, 40), th, 'vi', announced, false)).toEqual([]);
  });

  it('vào step dài 294 m: post lúc đổi step, approach ở ≤ 200 m, pre ở ≤ 50 m; mỗi câu một lần', () => {
    const announced = new Set<string>();
    const enter = planAnnouncements(progress(1, 290), th, 'vi', announced, true);
    expect(enter).toEqual([
      { text: 'Tiếp tục đi thêm 300 mét.', kind: 'post', stepIndex: 1, priority: 1 },
    ]);
    const approach = planAnnouncements(progress(1, 194), th, 'vi', announced, false);
    expect(approach).toEqual([
      {
        text: 'Trong 190 mét nữa, rẽ trái vào Nam Kỳ Khởi Nghĩa.',
        kind: 'approach',
        stepIndex: 2,
        priority: 2,
      },
    ]);
    expect(planAnnouncements(progress(1, 150), th, 'vi', announced, false)).toEqual([]);
    const pre = planAnnouncements(progress(1, 30), th, 'vi', announced, false);
    expect(pre.map((a) => a.kind)).toEqual(['pre']);
  });

  it('step kế là arrive → kind arrive với câu đã vá', () => {
    const announced = new Set<string>();
    const out = planAnnouncements(progress(4, 20), th, 'vi', announced, true);
    expect(out.map((a) => a.kind)).toEqual(['arrive']);
    expect(out[0]?.text).toBe('Điểm đến ở bên trái.');
  });

  it('step cuối (arrive) không còn nextStep → không đọc gì thêm', () => {
    expect(planAnnouncements(progress(5, 0), th, 'vi', new Set(), true)).toEqual([]);
  });
});
```

- [x] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/src/navigation/announce.test.ts`
Expected: FAIL — không resolve `./announce`.

- [x] **Step 3: Viết `announce.ts`**

```ts
import type { DirectionsLang, RouteStep } from '../types';
import type { Announcement, NavigationProgress, NavigationThresholds } from './types';

const viNumber = (value: string): string => value.replace('.', ',');

/** "85 mét", "1,2 ki-lô-mét" (viết đủ để giọng đọc phát âm đúng), "12 ki-lô-mét"; en tương ứng. */
export function formatDistance(m: number, lang: DirectionsLang = 'vi'): string {
  const vi = lang === 'vi';
  if (m < 1000) {
    const n = Math.max(0, Math.round(m));
    return vi ? `${n} mét` : `${n} meters`;
  }
  const km = m / 1000;
  if (km < 10) {
    const s = km.toFixed(1);
    return vi ? `${viNumber(s)} ki-lô-mét` : `${s} kilometers`;
  }
  const n = Math.round(km);
  return vi ? `${n} ki-lô-mét` : `${n} kilometers`;
}

/** Bản ngắn cho UI: "85 m", "1,2 km", "12 km". */
export function formatDistanceShort(m: number): string {
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  const km = m / 1000;
  return km < 10 ? `${viNumber(km.toFixed(1))} km` : `${Math.round(km)} km`;
}

/** ≥ 200 m làm tròn 50; dưới 200 m làm tròn 10; tối thiểu 10. */
export function roundForSpeech(m: number): number {
  if (m >= 200) return Math.round(m / 50) * 50;
  return Math.max(10, Math.round(m / 10) * 10);
}

export function lowerFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/** "Trong 190 mét nữa, rẽ phải vào Nguyễn Du." — Valhalla 3.8.3 không tự ghép khoảng cách vào alert. */
export function composeApproach(
  distance_m: number,
  step: RouteStep,
  lang: DirectionsLang,
): string | null {
  const cue = step.verbal_alert ?? step.verbal_pre;
  if (!cue) return null;
  const d = formatDistance(roundForSpeech(distance_m), lang);
  return lang === 'vi' ? `Trong ${d} nữa, ${lowerFirst(cue)}` : `In ${d}, ${lowerFirst(cue)}`;
}

/**
 * Lịch đọc spec B mục 4.5. `announced` giữ khoá `${stepIndex}:${kind}` đã đọc (navigator xoá khi đổi
 * tuyến). `stepChanged` = fix này vừa đổi step (hoặc là fix đầu).
 */
export function planAnnouncements(
  p: NavigationProgress,
  th: NavigationThresholds,
  lang: DirectionsLang,
  announced: Set<string>,
  stepChanged: boolean,
): Announcement[] {
  const out: Announcement[] = [];
  const push = (
    stepIndex: number,
    kind: Announcement['kind'],
    text: string | null,
    priority: Announcement['priority'],
  ): void => {
    if (!text) return;
    const key = `${stepIndex}:${kind}`;
    if (announced.has(key)) return;
    announced.add(key);
    out.push({ text, kind, stepIndex, priority });
  };

  const longEnough = p.step.distance_m > th.approach_m + th.pre_m;
  if (p.step.kind === 'depart') push(p.stepIndex, 'depart', p.step.verbal_pre, 3);
  else if (stepChanged && longEnough) push(p.stepIndex, 'post', p.step.verbal_post, 1);

  const next = p.nextStep;
  if (next) {
    const nextIndex = p.stepIndex + 1;
    const d = p.distanceToStep_m;
    if (d <= th.approach_m && longEnough) {
      push(nextIndex, 'approach', composeApproach(d, next, lang), 2);
    }
    if (d <= th.pre_m) push(nextIndex, next.kind === 'arrive' ? 'arrive' : 'pre', next.verbal_pre, 3);
  }
  return out;
}
```

`index.ts` thêm `export * from './announce';`

- [x] **Step 4: Chạy test**

Run: `pnpm exec vitest run packages/core/src/navigation/announce.test.ts && pnpm typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/navigation
git commit -m "feat(core): định dạng khoảng cách và lịch đọc năm loại câu (spec B 4.5)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `simulate.ts` — chuỗi GPS giả lập thuần

**Files:**
- Create: `packages/core/src/navigation/simulate.ts`
- Test: `packages/core/src/navigation/simulate.test.ts`
- Modify: `packages/core/src/navigation/index.ts`

- [x] **Step 1: Viết test thất bại**

```ts
import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import { decodePolyline6 } from '../polyline';
import type { DirectionsResponse, Route } from '../types';
import { haversineM } from './geometry';
import { buildRouteIndex } from './progress';
import { simulateFixes } from './simulate';

const route = (fixture as unknown as DirectionsResponse).routes[0] as Route;
const coords = decodePolyline6(route.geometry);
const total = buildRouteIndex(route).total_m;

describe('simulateFixes', () => {
  it('xe máy 8 m/s mỗi 1 s: số fix ≈ tổng/8 + 1, fix đầu/cuối trùng hai đầu tuyến, timestamp tăng đều', () => {
    const fixes = simulateFixes(route);
    expect(fixes.length).toBe(Math.floor(total / 8) + 2);
    expect([fixes[0]?.lng, fixes[0]?.lat]).toEqual(coords[0]);
    const last = fixes.at(-1);
    expect(haversineM([last?.lng ?? 0, last?.lat ?? 0], coords.at(-1) ?? [0, 0])).toBeLessThan(0.01);
    for (let i = 1; i < fixes.length; i++) {
      expect((fixes[i]?.timestamp ?? 0) - (fixes[i - 1]?.timestamp ?? 0)).toBe(1000);
    }
    expect(fixes[3]?.accuracy_m).toBe(8);
    expect(fixes[3]?.speed_mps).toBe(8);
  });

  it('heading khớp hướng đoạn đang đi; khoảng cách giữa hai fix liên tiếp ≈ speed × interval', () => {
    const fixes = simulateFixes(route, { speed_mps: 5, interval_s: 2 });
    for (let i = 1; i < fixes.length - 1; i++) {
      const a = fixes[i - 1];
      const b = fixes[i];
      if (!a || !b) continue;
      expect(haversineM([a.lng, a.lat], [b.lng, b.lat])).toBeLessThanOrEqual(10.05);
      expect(b.heading).toBeGreaterThanOrEqual(0);
      expect(b.heading).toBeLessThan(360);
    }
  });

  it('jitter với seed cho kết quả lặp lại và lệch không quá jitter_m', () => {
    const a = simulateFixes(route, { jitter_m: 6, seed: 42 });
    const b = simulateFixes(route, { jitter_m: 6, seed: 42 });
    const clean = simulateFixes(route);
    expect(a).toEqual(b);
    expect(a).not.toEqual(clean);
    for (let i = 0; i < a.length; i++) {
      const noisy = a[i];
      const exact = clean[i];
      if (!noisy || !exact) continue;
      expect(haversineM([noisy.lng, noisy.lat], [exact.lng, exact.lat])).toBeLessThanOrEqual(6.05);
    }
  });

  it('mặc định vận tốc theo phương tiện: walk 1,4, car 12', () => {
    expect(simulateFixes({ ...route, mode: 'walk' })[1]?.speed_mps).toBe(1.4);
    expect(simulateFixes({ ...route, mode: 'car' })[1]?.speed_mps).toBe(12);
  });
});
```

- [x] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/src/navigation/simulate.test.ts`
Expected: FAIL.

- [x] **Step 3: Viết `simulate.ts`**

```ts
import { decodePolyline6 } from '../polyline';
import type { Route, TravelMode } from '../types';
import { bearingDeg, cumulativeDistances } from './geometry';
import type { GeoFix } from './types';

export interface SimulateOptions {
  /** Mặc định theo mode: walk 1.4, motorbike 8, car 12. */
  speed_mps?: number;
  /** Mặc định 1. */
  interval_s?: number;
  /** Mặc định 8. */
  accuracy_m?: number;
  /** Nhiễu vị trí đều trong hình tròn bán kính này; mặc định 0. */
  jitter_m?: number;
  /** Mặc định 1. */
  seed?: number;
  /** Mặc định 1_700_000_000_000. */
  start_ms?: number;
}

export const SIMULATE_DEFAULT_SPEED_MPS: Readonly<Record<TravelMode, number>> = {
  walk: 1.4,
  motorbike: 8,
  car: 12,
};

const M_PER_DEG_LAT = (Math.PI / 180) * 6_371_008.8;

/** PRNG xác định (mulberry32) để test và demo lặp lại được. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Đi dọc polyline với vận tốc hằng; heading = hướng đoạn; thuần và xác định. */
export function simulateFixes(route: Route, opts: SimulateOptions = {}): GeoFix[] {
  const coords = decodePolyline6(route.geometry);
  const cum = cumulativeDistances(coords);
  const total = cum[cum.length - 1] ?? 0;
  const speed = opts.speed_mps ?? SIMULATE_DEFAULT_SPEED_MPS[route.mode];
  const interval = opts.interval_s ?? 1;
  const accuracy = opts.accuracy_m ?? 8;
  const jitter = opts.jitter_m ?? 0;
  const start = opts.start_ms ?? 1_700_000_000_000;
  const rand = mulberry32(opts.seed ?? 1);
  const stepM = speed * interval;
  if (coords.length === 0 || stepM <= 0) return [];

  const fixes: GeoFix[] = [];
  let segment = 0;
  const distances: number[] = [];
  for (let d = 0; d < total; d += stepM) distances.push(d);
  distances.push(total);

  distances.forEach((d, k) => {
    while (segment < coords.length - 2 && (cum[segment + 1] ?? 0) < d) segment += 1;
    const a = coords[segment];
    const b = coords[segment + 1] ?? a;
    if (!a || !b) return;
    const segStart = cum[segment] ?? 0;
    const segLen = (cum[segment + 1] ?? segStart) - segStart;
    const t = segLen > 0 ? Math.min(1, (d - segStart) / segLen) : 0;
    let lng = a[0] + (b[0] - a[0]) * t;
    let lat = a[1] + (b[1] - a[1]) * t;
    if (jitter > 0) {
      const angle = rand() * 2 * Math.PI;
      const radius = jitter * Math.sqrt(rand());
      lat += (radius * Math.cos(angle)) / M_PER_DEG_LAT;
      lng += (radius * Math.sin(angle)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    }
    fixes.push({
      lng,
      lat,
      accuracy_m: accuracy,
      heading: bearingDeg(a, b),
      speed_mps: speed,
      timestamp: start + k * interval * 1000,
    });
  });
  return fixes;
}
```

`index.ts` thêm `export * from './simulate';`

- [x] **Step 4: Chạy test**

Run: `pnpm exec vitest run packages/core/src/navigation/simulate.test.ts && pnpm typecheck`
Expected: PASS. Nếu số fix lệch 1 so với `floor(total/8) + 2`, kiểm vòng `for (d < total)` — tuyến có tổng chia hết cho 8 sẽ ít hơn một fix; khi đó đổi kỳ vọng test thành `Math.ceil(total / 8) + 1`.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/navigation
git commit -m "feat(core): simulateFixes — chuỗi GPS giả lập xác định dọc tuyến (spec B 4.6)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `navigator.ts` — máy trạng thái (đi đúng, bước, via, đến nơi, lệch, lọc fix)

**Files:**
- Create: `packages/core/src/navigation/navigator.ts`
- Test: `packages/core/src/navigation/navigator.test.ts`
- Modify: `packages/core/src/navigation/index.ts`

- [ ] **Step 1: Viết test thất bại (phần 1 — không có provider)**

Tạo `packages/core/src/navigation/navigator.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import { syntheticTwoLegRoute } from '../../tests/helpers/synthetic-route';
import type { DirectionsResponse } from '../types';
import { createNavigator } from './navigator';
import { simulateFixes } from './simulate';
import type { Announcement, GeoFix, NavigationStatus } from './types';

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0];
if (!route) throw new Error('fixture thiếu routes[0]');

/** Dịch vĩ độ ~89 m về bắc cho mọi fix từ chỉ số `from` — mô phỏng lệch tuyến. */
const shiftFrom = (fixes: GeoFix[], from: number, dLat = 0.0008): GeoFix[] =>
  fixes.map((f, i) => (i >= from ? { ...f, lat: f.lat + dLat } : f));

function record(nav: ReturnType<typeof createNavigator>) {
  const statuses: NavigationStatus[] = [];
  const steps: number[] = [];
  const announcements: Announcement[] = [];
  const offRoute = vi.fn();
  const arrive = vi.fn();
  const waypoint = vi.fn();
  const progress = vi.fn();
  nav.on('status', (e) => statuses.push(e.status));
  nav.on('step', (e) => steps.push(e.stepIndex));
  nav.on('announce', (a) => announcements.push(a));
  nav.on('offRoute', offRoute);
  nav.on('arrive', arrive);
  nav.on('waypoint', waypoint);
  nav.on('progress', progress);
  return { statuses, steps, announcements, offRoute, arrive, waypoint, progress };
}

describe('createNavigator — đi đúng tuyến Quận 1 (xe máy)', () => {
  const nav = createNavigator({ response, reroute: 'manual' });
  const r = record(nav);
  const fixes = simulateFixes(route);
  for (const f of fixes) nav.update(f);

  it('idle → navigating → arrived; step đổi 5 lần; arrive một lần; progress mỗi fix tới khi đến', () => {
    expect(r.statuses).toEqual(['navigating', 'arrived']);
    expect(nav.status).toBe('arrived');
    expect(r.steps).toEqual([1, 2, 3, 4, 5]);
    expect(r.arrive).toHaveBeenCalledTimes(1);
    expect(r.arrive.mock.calls[0]?.[0]).toMatchObject({ waypoint: response.waypoints[1] });
    expect(r.progress.mock.calls.length).toBeGreaterThan(fixes.length * 0.9);
    expect(r.progress.mock.calls.length).toBeLessThan(fixes.length);
    expect(r.offRoute).not.toHaveBeenCalled();
    expect(r.waypoint).not.toHaveBeenCalled();
  });

  it('lịch đọc đúng thứ tự spec B 4.5 cho 6 step (step 0 và 4 ngắn nên không post/approach)', () => {
    expect(r.announcements.map((a) => a.kind)).toEqual([
      'depart',
      'pre',
      'post',
      'approach',
      'pre',
      'post',
      'approach',
      'pre',
      'post',
      'approach',
      'pre',
      'arrive',
    ]);
    for (const a of r.announcements.filter((x) => x.kind === 'approach')) {
      expect(a.text).toMatch(/^Trong \d+ mét nữa, [a-zđ]/u);
      expect(a.priority).toBe(2);
    }
    expect(r.announcements.at(-1)?.text).toBe('Điểm đến ở bên trái.');
    expect(r.announcements[0]?.text).toBe(route.legs[0]?.steps[0]?.verbal_pre);
  });

  it('progress cuối: remaining_m ≤ arrive_m, distanceToStep 0, bearing trong [0,360), snapped gần fix', () => {
    const p = nav.progress;
    expect(p?.status).toBe('arrived');
    expect(p?.remaining_m ?? 99).toBeLessThanOrEqual(25);
    expect(p?.distanceToStep_m).toBe(0);
    expect(p?.bearing ?? -1).toBeGreaterThanOrEqual(0);
    expect(p?.bearing ?? 999).toBeLessThan(360);
    expect(p?.offRoute_m ?? 99).toBeLessThan(1);
  });

  it('sau arrived, update() bị bỏ qua', () => {
    const before = r.progress.mock.calls.length;
    nav.update({ ...(fixes[0] as GeoFix), timestamp: Date.now() + 1e9 });
    expect(r.progress.mock.calls.length).toBe(before);
  });
});

describe('createNavigator — lọc fix, stop, setRoute', () => {
  it('bỏ fix accuracy quá ngưỡng và fix có timestamp không tăng', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const [f0, f1] = simulateFixes(route) as [GeoFix, GeoFix];
    nav.update({ ...f0, accuracy_m: 150 });
    expect(r.progress).not.toHaveBeenCalled();
    expect(nav.status).toBe('idle');
    nav.update(f0);
    nav.update({ ...f1, timestamp: f0.timestamp });
    expect(r.progress).toHaveBeenCalledTimes(1);
    nav.update(f1);
    expect(r.progress).toHaveBeenCalledTimes(2);
  });

  it("'auto' không có provider → ném ngay khi tạo", () => {
    expect(() => createNavigator({ response })).toThrowError(/provider/);
  });

  it('stop() → stopped, fix sau bị bỏ', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(route);
    nav.update(fixes[0] as GeoFix);
    nav.stop();
    nav.update(fixes[1] as GeoFix);
    expect(nav.status).toBe('stopped');
    expect(r.statuses).toEqual(['navigating', 'stopped']);
    expect(r.progress).toHaveBeenCalledTimes(1);
  });

  it('setRoute() reset: fix kế bám toàn tuyến, lịch đọc reset, progress cũ bị xoá', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(route);
    for (const f of fixes.slice(0, 30)) nav.update(f);
    expect(r.announcements.filter((a) => a.kind === 'depart')).toHaveLength(1);
    const postsBefore = r.announcements.filter((a) => a.kind === 'post' && a.stepIndex === 1);
    expect(postsBefore).toHaveLength(1);
    nav.setRoute(response);
    expect(nav.progress).toBeNull();
    nav.update(fixes[30] as GeoFix);
    // Fix 30 nằm giữa step 1 (không phải depart) → lịch đọc đã reset nên 'post' của step 1 đọc lại.
    expect(r.announcements.filter((a) => a.kind === 'post' && a.stepIndex === 1)).toHaveLength(2);
    expect(r.announcements.filter((a) => a.kind === 'depart')).toHaveLength(1);
    expect(nav.progress?.stepIndex).toBe(1);
  });
});

describe('createNavigator — lệch tuyến (reroute manual)', () => {
  it('3 fix liên tiếp ngoài ngưỡng và ≥ 5 s → off_route một lần; progress vẫn phát', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = shiftFrom(simulateFixes(route), 20);
    const offAt: number[] = [];
    fixes.forEach((f, i) => {
      nav.update(f);
      if (r.offRoute.mock.calls.length === 1 && offAt.length === 0) offAt.push(i);
    });
    expect(r.offRoute).toHaveBeenCalledTimes(1);
    // fix 20, 21, 22 = 3 fix; 5 s kể từ fix 20 → fix 25
    expect(offAt).toEqual([25]);
    expect(r.offRoute.mock.calls[0]?.[0]).toMatchObject({ distance_m: expect.any(Number) });
    expect((r.offRoute.mock.calls[0]?.[0] as { distance_m: number }).distance_m).toBeGreaterThan(60);
    expect(nav.status).toBe('off_route');
    expect(r.progress.mock.calls.length).toBe(fixes.length);
    expect(r.arrive).not.toHaveBeenCalled();
  });

  it('lệch 2 fix rồi quay lại → không off_route', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(route).map((f, i) =>
      i === 20 || i === 21 ? { ...f, lat: f.lat + 0.0008 } : f,
    );
    for (const f of fixes) nav.update(f);
    expect(r.offRoute).not.toHaveBeenCalled();
    expect(nav.status).toBe('arrived');
  });

  it('quay lại trong ngưỡng sau khi đã off_route → navigating', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(route).map((f, i) =>
      i >= 20 && i < 40 ? { ...f, lat: f.lat + 0.0008 } : f,
    );
    for (const f of fixes) nav.update(f);
    expect(r.offRoute).toHaveBeenCalledTimes(1);
    expect(r.statuses).toEqual(['navigating', 'off_route', 'navigating', 'arrived']);
  });

  it('ngưỡng hiệu dụng theo accuracy: lệch 60 m với accuracy 50 m (ngưỡng 75) không tính là lệch', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(route, { accuracy_m: 50 }).map((f, i) =>
      i >= 20 ? { ...f, lat: f.lat + 0.00054 } : f,
    );
    for (const f of fixes) nav.update(f);
    expect(r.offRoute).not.toHaveBeenCalled();
  });

  it('chạy ngược trên chính tuyến → off_route (khoảng cách vuông góc vẫn 0)', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const forward = simulateFixes(route).slice(0, 41);
    const t0 = forward.at(-1)?.timestamp ?? 0;
    const backward = forward
      .slice(0, 40)
      .reverse()
      .map((f, i) => ({ ...f, timestamp: t0 + (i + 1) * 1000 }));
    for (const f of [...forward, ...backward]) nav.update(f);
    expect(r.offRoute).toHaveBeenCalledTimes(1);
    expect(nav.status).toBe('off_route');
    expect(r.arrive).not.toHaveBeenCalled();
  });

  it('ghi đè ngưỡng: offRouteFixes 1, offRouteSeconds 0 → lệch ngay fix đầu ngoài ngưỡng', () => {
    const nav = createNavigator({
      response,
      reroute: 'manual',
      thresholds: { offRouteFixes: 1, offRouteSeconds: 0 },
    });
    const r = record(nav);
    for (const f of shiftFrom(simulateFixes(route), 20).slice(0, 21)) nav.update(f);
    expect(r.offRoute).toHaveBeenCalledTimes(1);
  });
});

describe('createNavigator — tuyến hai leg', () => {
  it('qua via → waypoint đúng một lần, legIndex 1, đọc khởi hành leg 2, rồi arrive', () => {
    const twoLeg = syntheticTwoLegRoute();
    const nav = createNavigator({ response: twoLeg, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(twoLeg.routes[0] as NonNullable<(typeof twoLeg.routes)[0]>, {
      speed_mps: 5,
    });
    for (const f of fixes) nav.update(f);
    expect(r.waypoint).toHaveBeenCalledTimes(1);
    expect(r.waypoint.mock.calls[0]?.[0]).toMatchObject({
      legIndex: 1,
      waypoint: twoLeg.waypoints[1],
    });
    expect(r.announcements.filter((a) => a.kind === 'depart')).toHaveLength(2);
    expect(r.announcements.filter((a) => a.kind === 'arrive')).toHaveLength(2);
    expect(r.arrive).toHaveBeenCalledTimes(1);
    expect(nav.status).toBe('arrived');
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/src/navigation/navigator.test.ts`
Expected: FAIL — không resolve `./navigator`.

- [ ] **Step 3: Viết `navigator.ts` (đầy đủ, gồm cả tính lại tuyến — test ở Task 10)**

```ts
import type { DirectionsLang, DirectionsOptions, DirectionsResponse, Route } from '../types';
import { planAnnouncements } from './announce';
import { bearingDeg, haversineM } from './geometry';
import { type RouteIndex, buildRouteIndex, progressAt } from './progress';
import { snapToRoute } from './snap';
import {
  type GeoFix,
  NAVIGATION_THRESHOLDS,
  type NavigationEvents,
  type NavigationProgress,
  type NavigationStatus,
  type NavigationThresholds,
  type Navigator,
  type NavigatorOptions,
} from './types';

const DEFAULT_ACCURACY_M = 10;
const WINDOW_BASE_M = 300;
const WINDOW_SPEED_MPS = 40;
const WINDOW_MAX_M = 3000;
/** Gần đích theo chim bay chỉ tính là đến nơi khi còn lại theo tuyến dưới ngần này (tuyến vòng qua đích). */
const ARRIVE_NEAR_REMAINING_M = 150;
/** Dưới vận tốc này heading GPS không tin được → dùng hướng đoạn tuyến. */
const MOVING_SPEED_MPS = 1;

interface RouteState {
  response: DirectionsResponse;
  routeIndex: number;
  route: Route;
  index: RouteIndex;
  th: NavigationThresholds;
}

interface LastFix {
  fix: GeoFix;
  shapeIndex: number;
  along_m: number;
  stepIndex: number;
  legIndex: number;
}

function buildState(
  response: DirectionsResponse,
  routeIndex: number,
  override: Partial<NavigationThresholds> | undefined,
): RouteState {
  const route = response.routes[routeIndex];
  if (!route) throw new Error(`createNavigator: response không có routes[${routeIndex}]`);
  return {
    response,
    routeIndex,
    route,
    index: buildRouteIndex(route),
    th: { ...NAVIGATION_THRESHOLDS[route.mode], ...override },
  };
}

/** Máy trạng thái dẫn đường thuần (spec B mục 4.4–4.5): không DOM, không timer, thời gian từ fix. */
export function createNavigator(opts: NavigatorOptions): Navigator {
  const rerouteMode = opts.reroute ?? 'auto';
  const provider = opts.provider;
  if (rerouteMode === 'auto' && !provider) {
    throw new Error("createNavigator: reroute 'auto' cần provider (ví dụ client của createClient)");
  }
  const lang: DirectionsLang = opts.lang ?? 'vi';

  let rs = buildState(opts.response, opts.routeIndex ?? 0, opts.thresholds);
  let status: NavigationStatus = 'idle';
  let progress: NavigationProgress | null = null;
  let last: LastFix | null = null;
  let maxAlong_m = 0;
  let offCount = 0;
  let offSince: number | null = null;
  let backCount = 0;
  let announced = new Set<string>();
  let rerouteAttempts = 0;
  let lastRerouteAt: number | null = null;
  let inflight = false;
  let rerouteToken = 0;
  let rerouteReason: 'off_route' | 'manual' | null = null;

  const listeners: { [K in keyof NavigationEvents]: Set<(e: NavigationEvents[K]) => void> } = {
    status: new Set(),
    progress: new Set(),
    step: new Set(),
    waypoint: new Set(),
    offRoute: new Set(),
    reroute: new Set(),
    rerouteFailed: new Set(),
    announce: new Set(),
    arrive: new Set(),
  };
  const emit = <K extends keyof NavigationEvents>(k: K, e: NavigationEvents[K]): void => {
    for (const fn of listeners[k]) fn(e);
  };
  const setStatus = (next: NavigationStatus): void => {
    if (next === status) return;
    const previous = status;
    status = next;
    emit('status', { status, previous });
  };

  const resetTracking = (): void => {
    last = null;
    maxAlong_m = 0;
    offCount = 0;
    offSince = null;
    backCount = 0;
    announced = new Set();
  };

  const applyRoute = (response: DirectionsResponse, routeIndex: number): void => {
    rs = buildState(response, routeIndex, opts.thresholds);
    resetTracking();
    progress = null;
  };

  const destinationLatLng = (): [number, number] => {
    const w = rs.response.waypoints[rs.response.waypoints.length - 1];
    const end = rs.index.coords[rs.index.coords.length - 1];
    const [lng, lat] = w ? w.location : (end ?? [0, 0]);
    return [lat, lng];
  };

  const rerouteRequest = (fix: GeoFix, legIndex: number): DirectionsOptions => {
    const via = rs.response.waypoints
      .slice(legIndex + 1, -1)
      .map((w): [number, number] => [w.location[1], w.location[0]]);
    const request: DirectionsOptions = {
      from: [fix.lat, fix.lng],
      to: destinationLatLng(),
      mode: rs.route.mode,
      lang,
      alternatives: false,
    };
    if (via.length > 0) request.via = via;
    return request;
  };

  async function runReroute(
    reason: 'off_route' | 'manual',
    fix: GeoFix,
    legIndex: number,
  ): Promise<void> {
    if (!provider) return;
    const token = ++rerouteToken;
    inflight = true;
    rerouteReason = reason;
    lastRerouteAt = fix.timestamp;
    setStatus('rerouting');
    try {
      const next = await provider.directions(rerouteRequest(fix, legIndex));
      inflight = false;
      // Người dùng đã tự quay lại tuyến, stop(), hoặc setRoute() trong lúc chờ → bỏ kết quả.
      if (token !== rerouteToken || status !== 'rerouting') return;
      rerouteAttempts = 0;
      applyRoute(next, 0);
      setStatus('navigating');
      emit('reroute', { reason, response: next });
    } catch (error) {
      inflight = false;
      if (token !== rerouteToken) return;
      rerouteAttempts += 1;
      if (status === 'rerouting') setStatus('off_route');
      emit('rerouteFailed', {
        error,
        attempts: rerouteAttempts,
        final: rerouteAttempts >= rs.th.rerouteMaxFailures,
      });
    }
  }

  const maybeAutoReroute = (fix: GeoFix, legIndex: number): void => {
    if (rerouteMode !== 'auto' || !provider || inflight) return;
    if (rerouteAttempts >= rs.th.rerouteMaxFailures) return;
    if (lastRerouteAt !== null && fix.timestamp - lastRerouteAt < rs.th.rerouteCooldown_s * 1000) {
      return;
    }
    void runReroute('off_route', fix, legIndex);
  };

  const segmentBearing = (shapeIndex: number): number => {
    const a = rs.index.coords[shapeIndex];
    const b = rs.index.coords[shapeIndex + 1];
    return a && b ? bearingDeg(a, b) : 0;
  };

  function update(fix: GeoFix): void {
    if (status === 'arrived' || status === 'stopped') return;
    const accuracy = fix.accuracy_m ?? DEFAULT_ACCURACY_M;
    if (accuracy > rs.th.maxAccuracy_m) return;
    const prev = last;
    if (prev && fix.timestamp <= prev.fix.timestamp) return;
    if (status === 'idle') setStatus('navigating');

    const dt_s = prev ? (fix.timestamp - prev.fix.timestamp) / 1000 : 0;
    const window_m = Math.min(WINDOW_MAX_M, WINDOW_BASE_M + WINDOW_SPEED_MPS * dt_s);
    const here: [number, number] = [fix.lng, fix.lat];
    const snap = snapToRoute(rs.index, here, {
      fromShapeIndex: prev ? prev.shapeIndex : null,
      window_m,
      heading: fix.heading,
    });
    if (!snap) return;

    // Điểm via trong bán kính đến nơi → coi như đã qua (spec B 4.4).
    let along_m = snap.along_m;
    const currentLeg = prev?.legIndex ?? 0;
    const nextLegBegin = rs.index.legBegin_m[currentLeg + 1];
    const nextVia = rs.response.waypoints[currentLeg + 1];
    if (
      nextLegBegin !== undefined &&
      nextVia &&
      currentLeg + 1 < rs.route.legs.length &&
      along_m < nextLegBegin &&
      haversineM(here, nextVia.snapped) <= rs.th.arrive_m
    ) {
      along_m = nextLegBegin;
    }

    const threshold = Math.max(rs.th.offRoute_m, 1.5 * accuracy);
    const perpendicularOk = snap.distance_m <= threshold;
    // Chạy ngược trên chính tuyến: khoảng cách vuông góc vẫn 0 nhưng along lùi.
    if (perpendicularOk && prev && along_m < maxAlong_m - rs.th.offRoute_m) backCount += 1;
    else backCount = 0;
    const onRoute = perpendicularOk && backCount < rs.th.offRouteFixes;

    if (onRoute) {
      offCount = 0;
      offSince = null;
      maxAlong_m = prev ? Math.max(maxAlong_m, along_m) : along_m;
      if (status === 'off_route' || (status === 'rerouting' && rerouteReason === 'off_route')) {
        rerouteAttempts = 0;
        setStatus('navigating');
      }
    } else {
      offCount += 1;
      offSince ??= fix.timestamp;
      if (
        status === 'navigating' &&
        offCount >= rs.th.offRouteFixes &&
        fix.timestamp - offSince >= rs.th.offRouteSeconds * 1000
      ) {
        setStatus('off_route');
        emit('offRoute', { distance_m: snap.distance_m, fix });
      }
    }

    const at = progressAt(rs.index, along_m);
    const flat = rs.index.steps[at.stepIndex];
    if (!flat) return;
    const nextFlat = rs.index.steps[at.stepIndex + 1];
    const moving = (fix.speed_mps ?? 0) > MOVING_SPEED_MPS;
    const bearing =
      moving && typeof fix.heading === 'number' && Number.isFinite(fix.heading)
        ? fix.heading
        : segmentBearing(snap.shapeIndex);
    const stepChanged = prev === null || prev.stepIndex !== at.stepIndex;
    const legChanged = prev !== null && at.legIndex > prev.legIndex;

    progress = {
      status,
      route: rs.route,
      routeIndex: rs.routeIndex,
      legIndex: at.legIndex,
      stepIndex: at.stepIndex,
      step: flat.step,
      nextStep: nextFlat ? nextFlat.step : null,
      snapped: snap.point,
      bearing,
      shapeIndex: snap.shapeIndex,
      traveled_m: along_m,
      remaining_m: at.remaining_m,
      remaining_s: at.remaining_s,
      distanceToStep_m: at.distanceToStep_m,
      offRoute_m: snap.distance_m,
      fix,
    };
    last = {
      fix,
      shapeIndex: snap.shapeIndex,
      along_m,
      stepIndex: at.stepIndex,
      legIndex: at.legIndex,
    };

    if (status === 'navigating') {
      if (stepChanged && prev !== null) emit('step', { stepIndex: at.stepIndex, step: flat.step });
      if (legChanged) {
        const waypoint = rs.response.waypoints[at.legIndex];
        if (waypoint) emit('waypoint', { legIndex: at.legIndex, waypoint });
      }
    }
    emit('progress', progress);

    if (status === 'navigating') {
      for (const a of planAnnouncements(progress, rs.th, lang, announced, stepChanged)) {
        emit('announce', a);
      }
      const end = rs.index.coords[rs.index.coords.length - 1];
      const lastLeg = at.legIndex === rs.route.legs.length - 1;
      const nearEnd =
        end !== undefined &&
        lastLeg &&
        haversineM(here, end) <= rs.th.arrive_m &&
        at.remaining_m <= ARRIVE_NEAR_REMAINING_M;
      if (at.remaining_m <= rs.th.arrive_m || nearEnd) {
        setStatus('arrived');
        progress = { ...progress, status };
        const waypoint = rs.response.waypoints[rs.response.waypoints.length - 1];
        if (waypoint) emit('arrive', { waypoint, fix });
      }
    } else if (status === 'off_route') {
      maybeAutoReroute(fix, at.legIndex);
    }
  }

  return {
    get status() {
      return status;
    },
    get progress() {
      return progress;
    },
    update,
    setRoute(response, routeIndex = 0) {
      rerouteToken += 1;
      inflight = false;
      rerouteAttempts = 0;
      lastRerouteAt = null;
      applyRoute(response, routeIndex);
      if (status === 'off_route' || status === 'rerouting') setStatus('navigating');
    },
    async reroute() {
      if (!provider) throw new Error('createNavigator: không có provider để tính lại');
      if (status === 'arrived' || status === 'stopped') return;
      if (!last) throw new Error('createNavigator: chưa có vị trí để tính lại');
      await runReroute('manual', last.fix, last.legIndex);
    },
    stop() {
      rerouteToken += 1;
      inflight = false;
      setStatus('stopped');
    },
    on(event, handler) {
      (listeners[event] as Set<unknown>).add(handler);
    },
    off(event, handler) {
      (listeners[event] as Set<unknown>).delete(handler);
    },
  };
}
```

`index.ts` thêm `export * from './navigator';`

- [ ] **Step 4: Chạy test phần 1**

Run: `pnpm exec vitest run packages/core/src/navigation/navigator.test.ts && pnpm typecheck`
Expected: PASS. Ca "3 fix và ≥ 5 s → fix 25" là kiểm tra chính của luật xác nhận lệch; nếu ra 22 nghĩa là thiếu điều kiện thời gian, nếu ra 26 nghĩa là so `>` thay cho `>=`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation
git commit -m "feat(core): createNavigator — máy trạng thái dẫn đường thuần: bám tuyến, bước, via, đến nơi, lệch (spec B 4.4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Tính lại tuyến — test auto/cooldown/trần lỗi/kết quả cũ/manual; khoá export core

**Files:**
- Test: `packages/core/src/navigation/navigator.reroute.test.ts`
- Modify (nếu test lộ lỗi): `packages/core/src/navigation/navigator.ts`
- Verify: `packages/core/dist` size, `pnpm typecheck` toàn repo (gồm react-native dùng core)

- [ ] **Step 1: Viết test thất bại/đỏ-xanh cho reroute**

Tạo `packages/core/src/navigation/navigator.reroute.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import { syntheticTwoLegRoute } from '../../tests/helpers/synthetic-route';
import type { DirectionsOptions, DirectionsResponse, Route } from '../types';
import { createNavigator } from './navigator';
import { simulateFixes } from './simulate';
import type { GeoFix, RouteProvider } from './types';

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const shiftFrom = (fixes: GeoFix[], from: number, dLat = 0.0008): GeoFix[] =>
  fixes.map((f, i) => (i >= from ? { ...f, lat: f.lat + dLat } : f));

/** Cho từng fix vào navigator và chờ microtask sau mỗi fix để promise của provider chạy. */
async function feed(nav: ReturnType<typeof createNavigator>, fixes: GeoFix[]) {
  for (const f of fixes) {
    nav.update(f);
    await flush();
  }
}

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createNavigator — reroute auto', () => {
  it('lệch xác nhận → gọi provider đúng tham số → rerouting → reroute → navigating, lịch đọc reset', async () => {
    const directions = vi.fn(async (_o: DirectionsOptions) => response);
    const provider: RouteProvider = { directions };
    const nav = createNavigator({ response, provider });
    const events: string[] = [];
    nav.on('status', (e) => events.push(`status:${e.status}`));
    nav.on('offRoute', () => events.push('offRoute'));
    nav.on('reroute', (e) => events.push(`reroute:${e.reason}`));
    nav.on('announce', (a) => events.push(`announce:${a.kind}`));

    const fixes = shiftFrom(simulateFixes(route), 20);
    await feed(nav, fixes.slice(0, 27));

    expect(directions).toHaveBeenCalledTimes(1);
    const fix25 = fixes[25] as GeoFix;
    const dest = response.waypoints[1]?.location ?? [0, 0];
    expect(directions.mock.calls[0]?.[0]).toEqual({
      from: [fix25.lat, fix25.lng],
      to: [dest[1], dest[0]],
      mode: 'motorbike',
      lang: 'vi',
      alternatives: false,
    });
    const i = events.indexOf('offRoute');
    expect(events.slice(i, i + 4)).toEqual([
      'offRoute',
      'status:rerouting',
      'reroute:off_route',
      'status:navigating',
    ]);
    // Tuyến mới (cùng fixture): lịch đọc reset. Fix 26 vẫn lệch 89 m nên kiểm bằng một fix đúng tuyến
    // ở giữa step 1 → 'post' của step 1 đọc lại (đã đọc một lần lúc vào step 1 ở fix ~18).
    const postsBefore = events.filter((e) => e === 'announce:post').length;
    nav.update({ ...(simulateFixes(route)[26] as GeoFix), timestamp: fix25.timestamp + 2000 });
    expect(events.filter((e) => e === 'announce:post').length).toBe(postsBefore + 1);
    expect(nav.status).toBe('navigating');
  });

  it('cooldown 15 s giữa hai lần gọi; request giữ via chưa qua', async () => {
    const twoLeg = syntheticTwoLegRoute();
    const directions = vi.fn(async (_o: DirectionsOptions) => twoLeg);
    const nav = createNavigator({ response: twoLeg, provider: { directions } });
    const base = simulateFixes(twoLeg.routes[0] as Route, { speed_mps: 5 });
    // Lệch từ fix 5 (leg 0, chưa qua via ở ~222 m) và giữ lệch tới hết → tính lại nhiều lần.
    const fixes = shiftFrom(base, 5);
    await feed(nav, fixes.slice(0, 40));

    expect(directions.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(directions.mock.calls[0]?.[0].via).toEqual([[10.772, 106.7]]);
    const fixOf = (from: [number, number]): GeoFix =>
      fixes.find((f) => f.lat === from[0] && f.lng === from[1]) as GeoFix;
    const c0 = fixOf(directions.mock.calls[0]?.[0].from as [number, number]);
    const c1 = fixOf(directions.mock.calls[1]?.[0].from as [number, number]);
    // Lần 1 sau khi lệch đủ 3 fix và 5 s (walk: fix 5 → fix 10); lần 2 cách lần 1 ≥ 15 s.
    expect(c0.timestamp).toBeGreaterThanOrEqual((fixes[5] as GeoFix).timestamp + 5000);
    expect(c1.timestamp - c0.timestamp).toBeGreaterThanOrEqual(15_000);
  });

  it('provider lỗi 3 lần → rerouteFailed final, không gọi lần 4 tự động; reroute() tay vẫn gọi', async () => {
    const directions = vi.fn(async (_o: DirectionsOptions): Promise<DirectionsResponse> => {
      throw new Error('503');
    });
    const nav = createNavigator({ response, provider: { directions } });
    const failed: { attempts: number; final: boolean }[] = [];
    nav.on('rerouteFailed', (e) => failed.push({ attempts: e.attempts, final: e.final }));
    const fixes = shiftFrom(simulateFixes(route), 20);
    await feed(nav, fixes.slice(0, 120));

    expect(directions).toHaveBeenCalledTimes(3);
    expect(failed).toEqual([
      { attempts: 1, final: false },
      { attempts: 2, final: false },
      { attempts: 3, final: true },
    ]);
    expect(nav.status).toBe('off_route');

    await nav.reroute();
    expect(directions).toHaveBeenCalledTimes(4);
    expect(failed.at(-1)).toEqual({ attempts: 4, final: true });
  });

  it('kết quả về sau khi người dùng đã quay lại tuyến → bị bỏ, tuyến không đổi', async () => {
    const d = deferred<DirectionsResponse>();
    const directions = vi.fn((_o: DirectionsOptions) => d.promise);
    const nav = createNavigator({ response, provider: { directions } });
    const reroute = vi.fn();
    nav.on('reroute', reroute);
    const clean = simulateFixes(route);
    const fixes = shiftFrom(clean, 20);
    await feed(nav, fixes.slice(0, 26));
    expect(nav.status).toBe('rerouting');
    expect(directions).toHaveBeenCalledTimes(1);

    await feed(nav, clean.slice(26, 30));
    expect(nav.status).toBe('navigating');

    const other: DirectionsResponse = {
      ...response,
      routes: [{ ...route, distance_m: 1 }],
    };
    d.resolve(other);
    await flush();
    expect(reroute).not.toHaveBeenCalled();
    expect(nav.progress?.route.distance_m).toBe(route.distance_m);
  });

  it("reroute 'manual': không gọi provider khi lệch; reroute() gọi và phát reroute:manual", async () => {
    const directions = vi.fn(async (_o: DirectionsOptions) => response);
    const nav = createNavigator({ response, provider: { directions }, reroute: 'manual' });
    const reroute = vi.fn();
    nav.on('reroute', reroute);
    await feed(nav, shiftFrom(simulateFixes(route), 20).slice(0, 40));
    expect(nav.status).toBe('off_route');
    expect(directions).not.toHaveBeenCalled();
    await nav.reroute();
    expect(directions).toHaveBeenCalledTimes(1);
    expect(reroute).toHaveBeenCalledWith({ reason: 'manual', response });
    expect(nav.status).toBe('navigating');
  });

  it('reroute() tay trong lúc đang đúng tuyến không bị fix kế tiếp huỷ', async () => {
    const d = deferred<DirectionsResponse>();
    const directions = vi.fn((_o: DirectionsOptions) => d.promise);
    const nav = createNavigator({ response, provider: { directions } });
    const reroute = vi.fn();
    nav.on('reroute', reroute);
    const clean = simulateFixes(route);
    await feed(nav, clean.slice(0, 10));
    const pending = nav.reroute();
    expect(nav.status).toBe('rerouting');
    await feed(nav, clean.slice(10, 13));
    expect(nav.status).toBe('rerouting');
    d.resolve(response);
    await pending;
    expect(reroute).toHaveBeenCalledWith({ reason: 'manual', response });
    expect(nav.status).toBe('navigating');
  });

  it('reroute() khi chưa có vị trí → ném; sau stop() → không làm gì', async () => {
    const directions = vi.fn(async (_o: DirectionsOptions) => response);
    const nav = createNavigator({ response, provider: { directions } });
    await expect(nav.reroute()).rejects.toThrow(/vị trí/);
    nav.update(simulateFixes(route)[0] as GeoFix);
    nav.stop();
    await nav.reroute();
    expect(directions).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test**

Run: `pnpm exec vitest run packages/core/src/navigation/navigator.reroute.test.ts`
Expected: PASS nếu Task 9 viết đúng. Ca dễ đỏ: "cooldown" — nếu chỉ có một lần gọi trong 40 fix (200 s) thì `maybeAutoReroute` bị chặn bởi `rerouteAttempts` hay `inflight` không được reset sau khi provider thành công; sửa ở `runReroute` (đặt `inflight = false` trước khi kiểm token).

- [ ] **Step 3: Kiểm barrel, size và typecheck toàn repo**

Run: `pnpm --filter @mapslibvn/core build && pnpm typecheck && pnpm exec vitest run packages/core`
Expected: size-limit in số gzip của `dist/index.js` (kỳ vọng 13–15 kB, dưới 16 kB); typecheck xanh kể cả `packages/react-native` (import core). Ghi số gzip vào commit.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/navigation
git commit -m "test(core): tính lại tuyến — auto/cooldown/trần lỗi/kết quả cũ/manual (spec B 4.4)

Barrel core sau navigation: <số đo> kB gzip (trần 16 kB).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Web `position-source.ts` — `geolocationSource`, `playbackSource`

**Files:**
- Create: `packages/web/src/position-source.ts`
- Test: `packages/web/src/position-source.test.ts`

- [ ] **Step 1: Viết test thất bại**

```ts
// @vitest-environment jsdom
import type { GeoFix } from '@mapslibvn/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geolocationSource, playbackSource, toGeoFix, toPositionError } from './position-source';

function fakeGeolocation() {
  let success: PositionCallback | null = null;
  let failure: PositionErrorCallback | null = null;
  const geo = {
    watchPosition: vi.fn((s: PositionCallback, f?: PositionErrorCallback | null) => {
      success = s;
      failure = f ?? null;
      return 7;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation;
  return {
    geo,
    push: (p: GeolocationPosition) => success?.(p),
    fail: (e: GeolocationPositionError) => failure?.(e),
  };
}

const position = (over: Partial<GeolocationCoordinates> = {}, timestamp = 1_700_000_000_000) =>
  ({
    coords: {
      latitude: 10.7798,
      longitude: 106.699,
      accuracy: 12,
      heading: 90,
      speed: 3.5,
      altitude: null,
      altitudeAccuracy: null,
      ...over,
    },
    timestamp,
  }) as unknown as GeolocationPosition;

describe('toGeoFix / toPositionError', () => {
  it('ánh xạ trường; heading NaN → null; speed null giữ null; timestamp không hợp lệ → Date.now()', () => {
    expect(toGeoFix(position())).toEqual({
      lng: 106.699,
      lat: 10.7798,
      accuracy_m: 12,
      heading: 90,
      speed_mps: 3.5,
      timestamp: 1_700_000_000_000,
    });
    const odd = toGeoFix(position({ heading: Number.NaN, speed: null }, Number.NaN));
    expect(odd.heading).toBeNull();
    expect(odd.speed_mps).toBeNull();
    expect(Math.abs(odd.timestamp - Date.now())).toBeLessThan(1000);
  });

  it('mã lỗi 1/2/3 → denied/unavailable/timeout', () => {
    const err = (code: number) => ({ code, message: `m${code}` }) as GeolocationPositionError;
    expect(toPositionError(err(1))).toMatchObject({ code: 'denied', message: 'm1' });
    expect(toPositionError(err(2))).toMatchObject({ code: 'unavailable' });
    expect(toPositionError(err(3))).toMatchObject({ code: 'timeout' });
  });
});

describe('geolocationSource', () => {
  it('watchPosition với tuỳ chọn mặc định, chuyển fix và lỗi, unsubscribe → clearWatch(id)', () => {
    const { geo, push, fail } = fakeGeolocation();
    const onFix = vi.fn();
    const onError = vi.fn();
    const stop = geolocationSource({ geolocation: geo }).subscribe(onFix, onError);
    expect(geo.watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10_000,
    });
    push(position());
    expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ lng: 106.699, lat: 10.7798 }));
    fail({ code: 1, message: 'denied' } as GeolocationPositionError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'denied' }));
    stop();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
  });

  it('không có Geolocation → onError unavailable ngay, unsubscribe vô hại', () => {
    const onError = vi.fn();
    const stop = geolocationSource({ geolocation: undefined }).subscribe(vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unavailable' }));
    expect(() => stop()).not.toThrow();
  });
});

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

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/web/src/position-source.test.ts`
Expected: FAIL — không resolve `./position-source`.

- [ ] **Step 3: Viết `position-source.ts`**

```ts
import type { GeoFix, PositionError, PositionSource } from '@mapslibvn/core';

export interface GeolocationSourceOptions {
  /** Mặc định true. */
  enableHighAccuracy?: boolean;
  /** Mặc định 1000 ms. */
  maximumAge?: number;
  /** Mặc định 10 000 ms. */
  timeout?: number;
  /** Tiêm cho test; mặc định `navigator.geolocation`. */
  geolocation?: Geolocation | undefined;
}

export function toGeoFix(position: GeolocationPosition): GeoFix {
  const c = position.coords;
  return {
    lng: c.longitude,
    lat: c.latitude,
    accuracy_m: c.accuracy,
    heading: typeof c.heading === 'number' && Number.isFinite(c.heading) ? c.heading : null,
    speed_mps: typeof c.speed === 'number' && Number.isFinite(c.speed) ? c.speed : null,
    timestamp: Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
  };
}

export function toPositionError(error: GeolocationPositionError): PositionError {
  const code = error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable';
  return { code, message: error.message || code, raw: error };
}

/** `navigator.geolocation.watchPosition` → `GeoFix`. Cần HTTPS (trừ localhost). */
export function geolocationSource(options: GeolocationSourceOptions = {}): PositionSource {
  const geo =
    'geolocation' in options
      ? options.geolocation
      : typeof navigator !== 'undefined'
        ? navigator.geolocation
        : undefined;
  const positionOptions: PositionOptions = {
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    maximumAge: options.maximumAge ?? 1000,
    timeout: options.timeout ?? 10_000,
  };
  return {
    subscribe(onFix, onError) {
      if (!geo) {
        onError?.({ code: 'unavailable', message: 'Trình duyệt không có Geolocation' });
        return () => {};
      }
      const id = geo.watchPosition(
        (p) => onFix(toGeoFix(p)),
        (e) => onError?.(toPositionError(e)),
        positionOptions,
      );
      return () => geo.clearWatch(id);
    },
  };
}

/** Phát lại chuỗi fix (ví dụ từ `simulateFixes`) theo chênh timestamp chia `rate`; `rate: 0` phát hết một tick. */
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

- [ ] **Step 4: Chạy test**

Run: `pnpm exec vitest run packages/web/src/position-source.test.ts && pnpm --filter @mapslibvn/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/position-source.ts packages/web/src/position-source.test.ts
git commit -m "feat(web): PositionSource — geolocationSource và playbackSource (spec B 5.3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Web `speech.ts` — đọc bằng `speechSynthesis`

**Files:**
- Create: `packages/web/src/speech.ts`
- Test: `packages/web/src/speech.test.ts`

- [ ] **Step 1: Viết test thất bại**

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeech } from './speech';

class FakeUtterance {
  text: string;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeSynth(voices: { lang: string; name: string }[]) {
  const listeners: Record<string, (() => void)[]> = {};
  const synth = {
    speaking: false,
    pending: false,
    getVoices: vi.fn(() => voices as SpeechSynthesisVoice[]),
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener: vi.fn((ev: string, fn: () => void) => {
      (listeners[ev] ??= []).push(fn);
    }),
  } as unknown as SpeechSynthesis;
  return { synth, fire: (ev: string) => listeners[ev]?.forEach((fn) => fn()) };
}

beforeEach(() => vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance));
afterEach(() => vi.unstubAllGlobals());

describe('createSpeech', () => {
  it('chọn voice vi-*, đặt lang vi-VN, rate/volume; câu ưu tiên cao cắt câu đang đọc', () => {
    const { synth } = fakeSynth([
      { lang: 'en-US', name: 'Samantha' },
      { lang: 'vi-VN', name: 'Linh' },
    ]);
    const s = createSpeech({ lang: 'vi', rate: 1.1, volume: 0.8, synth });
    expect(s.available).toBe(true);
    s.speak('Tiếp tục đi thêm 300 mét.', 1);
    const first = (synth.speak as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as FakeUtterance;
    expect(first.lang).toBe('vi-VN');
    expect(first.voice?.name).toBe('Linh');
    expect(first.rate).toBe(1.1);
    expect(first.volume).toBe(0.8);
    expect(synth.cancel).not.toHaveBeenCalled();

    (synth as { speaking: boolean }).speaking = true;
    s.speak('Rẽ phải vào Nguyễn Du.', 3);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(2);

    // Câu ưu tiên thấp hơn không cắt câu ưu tiên 3 đang đọc — xếp hàng.
    s.speak('Tiếp tục đi thêm 200 mét.', 1);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(3);
  });

  it('voice chưa có lúc đầu → chờ voiceschanged; không có voice vi → onUnavailable một lần, speak im', () => {
    const { synth, fire } = fakeSynth([]);
    const onUnavailable = vi.fn();
    const s = createSpeech({ lang: 'vi', synth, onUnavailable });
    expect(s.available).toBe(true); // chưa biết → coi là có
    expect(onUnavailable).not.toHaveBeenCalled();
    (synth.getVoices as ReturnType<typeof vi.fn>).mockReturnValue([
      { lang: 'en-GB', name: 'Daniel' },
    ] as SpeechSynthesisVoice[]);
    fire('voiceschanged');
    expect(s.available).toBe(false);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    s.speak('Rẽ trái.', 3);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('không có speechSynthesis → onUnavailable ngay, mọi hàm vô hại', () => {
    const onUnavailable = vi.fn();
    const s = createSpeech({ lang: 'en', synth: undefined, onUnavailable });
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(s.available).toBe(false);
    expect(() => {
      s.speak('Turn left.', 3);
      s.warmUp();
      s.cancel();
    }).not.toThrow();
  });

  it('warmUp đọc câu rỗng âm lượng 0 (mở khoá iOS); cancel gọi synth.cancel', () => {
    const { synth } = fakeSynth([{ lang: 'vi_VN', name: 'Google Tiếng Việt' }]);
    const s = createSpeech({ lang: 'vi', synth });
    s.warmUp();
    const u = (synth.speak as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as FakeUtterance;
    expect(u.text).toBe('');
    expect(u.volume).toBe(0);
    s.cancel();
    expect(synth.cancel).toHaveBeenCalled();
    expect(s.available).toBe(true); // vi_VN (gạch dưới) vẫn nhận
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/web/src/speech.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết `speech.ts`**

```ts
import type { DirectionsLang } from '@mapslibvn/core';

export interface SpeechOptions {
  lang: DirectionsLang;
  rate?: number;
  volume?: number;
  /** Tiêm cho test; mặc định `speechSynthesis` toàn cục. */
  synth?: SpeechSynthesis | undefined;
  /** Gọi đúng một lần khi xác định không đọc được (không có API hoặc không có voice khớp). */
  onUnavailable?: () => void;
}

export interface Speech {
  /** Cắt câu đang đọc nếu `priority` ≥ ưu tiên câu đó; thấp hơn thì xếp hàng. */
  speak(text: string, priority: 1 | 2 | 3): void;
  /** Đọc câu rỗng trong user gesture để iOS mở khoá âm thanh. */
  warmUp(): void;
  cancel(): void;
  /** false khi không có API hoặc đã biết danh sách voice mà không có voice khớp. */
  readonly available: boolean;
}

const BCP47: Readonly<Record<DirectionsLang, string>> = { vi: 'vi-VN', en: 'en-US' };

export function createSpeech(opts: SpeechOptions): Speech {
  const synth =
    'synth' in opts
      ? opts.synth
      : typeof speechSynthesis !== 'undefined'
        ? speechSynthesis
        : undefined;
  const prefix = opts.lang;
  let voice: SpeechSynthesisVoice | null = null;
  let voicesKnown = false;
  let reported = false;
  let current = 0;

  const reportUnavailable = (): void => {
    if (reported) return;
    reported = true;
    opts.onUnavailable?.();
  };
  const pickVoice = (): void => {
    if (!synth) return;
    const voices = synth.getVoices();
    if (voices.length === 0) return;
    voicesKnown = true;
    voice =
      voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(prefix)) ?? null;
    if (!voice) reportUnavailable();
  };

  if (!synth) reportUnavailable();
  else {
    pickVoice();
    if (!voicesKnown && typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', pickVoice, { once: true });
    }
  }

  const utterance = (text: string): SpeechSynthesisUtterance => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP47[opts.lang];
    if (voice) u.voice = voice;
    u.rate = opts.rate ?? 1;
    u.volume = opts.volume ?? 1;
    return u;
  };

  return {
    get available() {
      return Boolean(synth) && (!voicesKnown || voice !== null);
    },
    speak(text, priority) {
      if (!synth || !text) return;
      if (voicesKnown && !voice) return;
      if ((synth.speaking || synth.pending) && priority >= current) synth.cancel();
      const u = utterance(text);
      current = priority;
      u.onend = () => {
        current = 0;
      };
      u.onerror = () => {
        current = 0;
      };
      synth.speak(u);
    },
    warmUp() {
      if (!synth) return;
      const u = utterance('');
      u.volume = 0;
      synth.speak(u);
    },
    cancel() {
      synth?.cancel();
      current = 0;
    },
  };
}
```

- [ ] **Step 4: Chạy test**

Run: `pnpm exec vitest run packages/web/src/speech.test.ts && pnpm --filter @mapslibvn/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/speech.ts packages/web/src/speech.test.ts
git commit -m "feat(web): createSpeech — đọc chỉ dẫn bằng speechSynthesis, ưu tiên cắt câu, voice vi-VN (spec B 5.4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Web `routes-layer.ts` — vẽ tuyến, tuyến thay thế, phần đã đi

**Files:**
- Create: `packages/web/src/routes-layer.ts`
- Test: `packages/web/src/routes-layer.test.ts`

- [ ] **Step 1: Viết test thất bại**

```ts
import type { DirectionsResponse } from '@mapslibvn/core';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import { ROUTE_LAYER_IDS, ROUTE_SOURCE_ID, createRoutesLayer } from './routes-layer';

const response = fixture as unknown as DirectionsResponse;
const withAlt: DirectionsResponse = {
  ...response,
  routes: [response.routes[0], { ...response.routes[0], distance_m: 1 }] as DirectionsResponse['routes'],
};

function fakeGl(symbolFirst = true) {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const setData = vi.fn();
  const sources = new Set<string>();
  const layers: { id: string; before?: string }[] = [];
  const gl = {
    isStyleLoaded: vi.fn(() => true),
    getStyle: vi.fn(() => ({
      layers: symbolFirst
        ? [
            { id: 'water', type: 'fill' },
            { id: 'road-label', type: 'symbol' },
            { id: 'poi', type: 'symbol' },
          ]
        : [{ id: 'water', type: 'fill' }],
    })),
    getSource: vi.fn((id: string) => (sources.has(id) ? { setData } : undefined)),
    addSource: vi.fn((id: string) => sources.add(id)),
    addLayer: vi.fn((layer: { id: string }, before?: string) =>
      layers.push(before === undefined ? { id: layer.id } : { id: layer.id, before }),
    ),
    on: vi.fn((ev: string, a: unknown, b?: unknown) => {
      const key = typeof a === 'string' ? `${ev}:${a}` : ev;
      const fn = (typeof a === 'string' ? b : a) as (e: unknown) => void;
      (handlers[key] ??= []).push(fn);
    }),
    once: vi.fn((ev: string, fn: (e: unknown) => void) => (handlers[ev] ??= []).push(fn)),
  };
  const markers: { options: { color?: string }; lngLat?: unknown; removed: boolean }[] = [];
  class Marker {
    entry: { options: { color?: string }; lngLat?: unknown; removed: boolean };
    constructor(options: { color?: string }) {
      this.entry = { options, removed: false };
      markers.push(this.entry);
    }
    setLngLat = vi.fn((lngLat: unknown) => {
      this.entry.lngLat = lngLat;
      return this;
    });
    addTo = vi.fn(() => this);
    remove = vi.fn(() => {
      this.entry.removed = true;
    });
  }
  return {
    gl,
    ml: { Marker },
    setData,
    layers,
    markers,
    resetSources: () => sources.clear(),
    fire: (key: string, e?: unknown) => handlers[key]?.forEach((fn) => fn(e)),
  };
}

const lastData = (setData: ReturnType<typeof vi.fn>) =>
  setData.mock.calls.at(-1)?.[0] as {
    features: { properties: { kind: string; index: number }; geometry: { coordinates: number[][] } }[];
  };

describe('createRoutesLayer', () => {
  it('show: một source, bốn layer chèn trước symbol đầu tiên, feature active, marker đích', () => {
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    routes.show(response);
    expect(f.gl.addSource).toHaveBeenCalledWith(ROUTE_SOURCE_ID, expect.objectContaining({ type: 'geojson' }));
    expect(f.layers.map((l) => l.id)).toEqual([
      ROUTE_LAYER_IDS.alt,
      ROUTE_LAYER_IDS.casing,
      ROUTE_LAYER_IDS.line,
      ROUTE_LAYER_IDS.traveled,
    ]);
    expect(f.layers.every((l) => l.before === 'road-label')).toBe(true);
    const data = lastData(f.setData);
    expect(data.features.map((x) => x.properties.kind)).toEqual(['active']);
    expect(data.features[0]?.geometry.coordinates.length).toBeGreaterThan(30);
    // Marker cho đích (waypoint cuối) màu đỏ, không có marker cho điểm đi
    expect(f.markers).toHaveLength(1);
    expect(f.markers[0]?.options.color).toBe('#d92d20');
    expect(f.markers[0]?.lngLat).toEqual(response.waypoints[1]?.snapped);
  });

  it('style không có symbol → chèn trên cùng (before undefined); show lần hai không thêm source/layer lại', () => {
    const f = fakeGl(false);
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    routes.show(response);
    routes.show(response);
    expect(f.layers).toHaveLength(4);
    expect(f.layers[0]?.before).toBeUndefined();
    expect(f.gl.addSource).toHaveBeenCalledTimes(1);
  });

  it('tuyến thay thế là alt; setActive đổi vai; bấm alt → onRouteClick(index)', () => {
    const f = fakeGl();
    const onRouteClick = vi.fn();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, onRouteClick);
    routes.show(withAlt, { active: 0 });
    let data = lastData(f.setData);
    expect(data.features.map((x) => [x.properties.kind, x.properties.index])).toEqual([
      ['active', 0],
      ['alt', 1],
    ]);
    routes.setActive(1);
    data = lastData(f.setData);
    expect(data.features.map((x) => [x.properties.kind, x.properties.index])).toEqual([
      ['alt', 0],
      ['active', 1],
    ]);
    f.fire(`click:${ROUTE_LAYER_IDS.alt}`, { features: [{ properties: { kind: 'alt', index: 0 } }] });
    expect(onRouteClick).toHaveBeenCalledWith(0);
  });

  it('setProgress chia traveled/active tại điểm bám; clear gỡ marker và xoá dữ liệu', () => {
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    routes.show(response);
    routes.setProgress(5, [106.6985, 10.7791]);
    const data = lastData(f.setData);
    expect(data.features.map((x) => x.properties.kind)).toEqual(['traveled', 'active']);
    expect(data.features[0]?.geometry.coordinates).toHaveLength(7); // 6 đỉnh + điểm bám
    expect(data.features[0]?.geometry.coordinates.at(-1)).toEqual([106.6985, 10.7791]);
    expect(data.features[1]?.geometry.coordinates[0]).toEqual([106.6985, 10.7791]);
    routes.clear();
    expect(lastData(f.setData).features).toEqual([]);
    expect(f.markers.every((m) => m.removed)).toBe(true);
  });

  it('style chưa load → chờ style.load rồi mới thêm; style.load về sau (đổi style) → thêm lại source/layer', () => {
    const f = fakeGl();
    f.gl.isStyleLoaded.mockReturnValueOnce(false);
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    routes.show(response);
    expect(f.gl.addSource).not.toHaveBeenCalled();
    f.fire('style.load');
    expect(f.gl.addSource).toHaveBeenCalledTimes(1);
    // Đổi style: style mới không còn source → thêm lại
    f.resetSources();
    f.fire('style.load');
    expect(f.gl.addSource).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/web/src/routes-layer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết `routes-layer.ts`**

```ts
import { type DirectionsResponse, decodePolyline6 } from '@mapslibvn/core';
import type * as maplibregl from 'maplibre-gl';

export const ROUTE_SOURCE_ID = 'mapslibvn-route';
export const ROUTE_LAYER_IDS = {
  alt: 'mapslibvn-route-alt',
  casing: 'mapslibvn-route-casing',
  line: 'mapslibvn-route-line',
  traveled: 'mapslibvn-route-traveled',
} as const;
export const ROUTE_COLOR = '#2458a6';
const ALT_COLOR = '#9ca8ba';
const DESTINATION_COLOR = '#d92d20';

export interface RoutesLayer {
  show(response: DirectionsResponse, opts?: { active?: number; markers?: boolean }): void;
  setActive(index: number): void;
  /** Chia tuyến chính tại (`shapeIndex`, `snapped`): trước là đã đi, sau là còn lại. */
  setProgress(shapeIndex: number, snapped: [number, number]): void;
  clear(): void;
}

type Kind = 'alt' | 'active' | 'traveled';
interface LineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { kind: Kind; index: number };
}
interface Collection {
  type: 'FeatureCollection';
  features: LineFeature[];
}
type GeoJsonData = Parameters<maplibregl.GeoJSONSource['setData']>[0];

const EMPTY: Collection = { type: 'FeatureCollection', features: [] };
const feature = (kind: Kind, index: number, coordinates: [number, number][]): LineFeature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties: { kind, index },
});

export function createRoutesLayer(
  gl: maplibregl.Map,
  ml: { Marker: typeof maplibregl.Marker },
  onRouteClick: (index: number) => void,
): RoutesLayer {
  let response: DirectionsResponse | null = null;
  let coords: [number, number][][] = [];
  let active = 0;
  let showMarkers = true;
  let progress: { shapeIndex: number; snapped: [number, number] } | null = null;
  let markers: maplibregl.Marker[] = [];
  let clickBound = false;

  const firstSymbolLayerId = (): string | undefined =>
    gl.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id;

  const addLine = (
    id: string,
    kind: Kind,
    paint: maplibregl.LineLayerSpecification['paint'],
    before: string | undefined,
  ): void => {
    gl.addLayer(
      {
        id,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        filter: ['==', ['get', 'kind'], kind],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint,
      },
      before,
    );
  };

  const ensureLayers = (): void => {
    if (gl.getSource(ROUTE_SOURCE_ID)) return;
    gl.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY as GeoJsonData });
    const before = firstSymbolLayerId();
    addLine(ROUTE_LAYER_IDS.alt, 'alt', { 'line-color': ALT_COLOR, 'line-width': 5 }, before);
    addLine(ROUTE_LAYER_IDS.casing, 'active', { 'line-color': '#ffffff', 'line-width': 9 }, before);
    addLine(ROUTE_LAYER_IDS.line, 'active', { 'line-color': ROUTE_COLOR, 'line-width': 6 }, before);
    addLine(
      ROUTE_LAYER_IDS.traveled,
      'traveled',
      { 'line-color': ROUTE_COLOR, 'line-width': 6, 'line-opacity': 0.35 },
      before,
    );
    if (!clickBound) {
      clickBound = true;
      gl.on('click', ROUTE_LAYER_IDS.alt, (e) => {
        const index = e.features?.[0]?.properties?.index;
        if (typeof index === 'number') onRouteClick(index);
      });
    }
  };

  const collection = (): Collection => {
    if (!response) return EMPTY;
    const features: LineFeature[] = [];
    response.routes.forEach((_route, i) => {
      const c = coords[i];
      if (!c) return;
      if (i !== active) {
        features.push(feature('alt', i, c));
        return;
      }
      if (progress && progress.shapeIndex < c.length - 1) {
        features.push(
          feature('traveled', i, [...c.slice(0, progress.shapeIndex + 1), progress.snapped]),
          feature('active', i, [progress.snapped, ...c.slice(progress.shapeIndex + 1)]),
        );
      } else {
        features.push(feature('active', i, c));
      }
    });
    return { type: 'FeatureCollection', features };
  };

  const setData = (): void => {
    const source = gl.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(collection() as GeoJsonData);
  };

  const apply = (): void => {
    if (!response) return;
    if (!gl.isStyleLoaded()) {
      gl.once('style.load', apply);
      return;
    }
    ensureLayers();
    setData();
  };

  const clearMarkers = (): void => {
    for (const m of markers) m.remove();
    markers = [];
  };
  const placeMarkers = (): void => {
    clearMarkers();
    if (!response || !showMarkers) return;
    const last = response.waypoints.length - 1;
    response.waypoints.forEach((w, i) => {
      if (i === 0) return;
      markers.push(
        new ml.Marker({ color: i === last ? DESTINATION_COLOR : ALT_COLOR })
          .setLngLat(w.snapped)
          .addTo(gl),
      );
    });
  };

  // App đổi style → source/layer mất; thêm lại khi style mới load xong.
  gl.on('style.load', () => {
    if (response && !gl.getSource(ROUTE_SOURCE_ID)) {
      ensureLayers();
      setData();
    }
  });

  return {
    show(next, opts = {}) {
      response = next;
      coords = next.routes.map((r) => decodePolyline6(r.geometry));
      active = opts.active ?? 0;
      showMarkers = opts.markers ?? true;
      progress = null;
      apply();
      placeMarkers();
    },
    setActive(index) {
      active = index;
      progress = null;
      setData();
    },
    setProgress(shapeIndex, snapped) {
      progress = { shapeIndex, snapped };
      setData();
    },
    clear() {
      response = null;
      coords = [];
      progress = null;
      clearMarkers();
      const source = gl.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(EMPTY as GeoJsonData);
    },
  };
}
```

Lưu ý test "clear gỡ marker và xoá dữ liệu" kỳ vọng `lastData(...).features` rỗng — `clear()` gọi `setData(EMPTY)` trực tiếp, đúng kỳ vọng.

- [ ] **Step 4: Chạy test**

Run: `pnpm exec vitest run packages/web/src/routes-layer.test.ts && pnpm --filter @mapslibvn/web typecheck`
Expected: PASS. Nếu typecheck kêu về `filter`/`paint`, ép kiểu tường minh (`as maplibregl.FilterSpecification`) thay vì `as never`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes-layer.ts packages/web/src/routes-layer.test.ts
git commit -m "feat(web): map.routes — vẽ tuyến chính, thay thế, phần đã đi và marker đích (spec B 5.2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Web `navigation.ts`, nối vào `createMap`, export ESM/UMD

**Files:**
- Create: `packages/web/src/navigation.ts`
- Test: `packages/web/src/navigation.test.ts`
- Modify: `packages/web/src/map.ts`, `packages/web/src/map.test.ts` (fake thêm `getSource`, `off`, `once`, `isStyleLoaded`)
- Modify: `packages/web/src/index.ts`, `packages/web/src/umd.ts`

- [ ] **Step 1: Viết test thất bại cho `createNavigation`**

```ts
// @vitest-environment jsdom
import { type DirectionsResponse, type Route, simulateFixes } from '@mapslibvn/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import { FOLLOW_ZOOM, createNavigation } from './navigation';
import { playbackSource } from './position-source';

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;

class FakeUtterance {
  text: string;
  lang = '';
  voice: unknown = null;
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeDeps() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const gl = {
    easeTo: vi.fn(),
    on: vi.fn((ev: string, fn: (e: unknown) => void) => (handlers[ev] ??= []).push(fn)),
    off: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn);
    }),
  };
  class Marker {
    options: unknown;
    setLngLat = vi.fn(() => this);
    setRotation = vi.fn(() => this);
    addTo = vi.fn(() => this);
    remove = vi.fn();
    constructor(options: unknown) {
      this.options = options;
    }
  }
  const routes = { show: vi.fn(), setActive: vi.fn(), setProgress: vi.fn(), clear: vi.fn() };
  const places = { directions: vi.fn(async () => response) };
  const synth = {
    speaking: false,
    pending: false,
    getVoices: vi.fn(() => [{ lang: 'vi-VN', name: 'Linh' }]),
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
  };
  const sentinel = { release: vi.fn(async () => {}) };
  const wakeLock = { request: vi.fn(async () => sentinel) };
  return {
    gl,
    Marker,
    routes,
    places,
    synth,
    wakeLock,
    sentinel,
    fire: (ev: string, e?: unknown) => handlers[ev]?.forEach((fn) => fn(e)),
    handlerCount: (ev: string) => (handlers[ev] ?? []).length,
    make: () =>
      createNavigation({
        gl: gl as never,
        ml: { Marker } as never,
        places: places as never,
        routes,
        lang: 'vi',
        wakeLock: wakeLock as never,
        document,
      }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createNavigation', () => {
  it('start: vẽ tuyến, wake lock, puck, camera bám theo mode; announce → speak vi-VN; arrive → dừng nguồn', async () => {
    const d = fakeDeps();
    vi.stubGlobal('speechSynthesis', d.synth);
    const nav = d.make();
    const statuses: string[] = [];
    nav.on('status', (e) => statuses.push(e.status));
    const fixes = simulateFixes(route);
    nav.start({ response, source: playbackSource(fixes, { rate: 0 }) });

    expect(d.routes.show).toHaveBeenCalledWith(response, { active: 0 });
    expect(d.wakeLock.request).toHaveBeenCalledWith('screen');
    // warmUp trong gesture
    expect(d.synth.speak).toHaveBeenCalledTimes(1);
    expect((d.synth.speak.mock.calls[0]?.[0] as FakeUtterance).text).toBe('');

    await vi.runAllTimersAsync();

    expect(nav.status).toBe('arrived');
    expect(statuses).toEqual(['navigating', 'arrived']);
    expect(d.routes.setProgress).toHaveBeenCalled();
    const ease = d.gl.easeTo.mock.calls[0]?.[0] as { zoom: number; pitch: number; bearing: number };
    expect(ease.zoom).toBe(FOLLOW_ZOOM.motorbike);
    expect(ease.pitch).toBe(45);
    expect(ease.bearing).toBeGreaterThanOrEqual(0);
    const spoken = d.synth.speak.mock.calls.slice(1).map((c) => c[0] as FakeUtterance);
    expect(spoken.length).toBe(12);
    expect(spoken.every((u) => u.lang === 'vi-VN')).toBe(true);
    expect(spoken.at(-1)?.text).toBe('Điểm đến ở bên trái.');
    expect(nav.state?.status).toBe('arrived');
    // arrive → nhả wake lock, tuyến vẫn trên bản đồ
    expect(d.sentinel.release).toHaveBeenCalled();
    expect(d.routes.clear).not.toHaveBeenCalled();
  });

  it('kéo bản đồ tắt bám (followChange false, easeTo dừng); recenter bật lại', async () => {
    const d = fakeDeps();
    const nav = d.make();
    const follow = vi.fn();
    nav.on('followChange', follow);
    const fixes = simulateFixes(route).slice(0, 40);
    nav.start({ response, voice: false, source: playbackSource(fixes, { rate: 1 }) });
    await vi.advanceTimersByTimeAsync(5000);
    const before = d.gl.easeTo.mock.calls.length;
    expect(before).toBeGreaterThan(3);
    d.fire('dragstart');
    expect(follow).toHaveBeenCalledWith(false);
    expect(nav.following).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(d.gl.easeTo.mock.calls.length).toBe(before);
    nav.recenter();
    expect(follow).toHaveBeenCalledWith(true);
    expect(d.gl.easeTo.mock.calls.length).toBe(before + 1);
    expect(d.synth.speak).not.toHaveBeenCalled();
  });

  it('follow: false → không easeTo; voice: false → không speech; lang en truyền xuống provider khi tính lại', async () => {
    const d = fakeDeps();
    const nav = d.make();
    const fixes = simulateFixes(route).slice(0, 5);
    nav.start({ response, voice: false, follow: false, lang: 'en', source: playbackSource(fixes, { rate: 0 }) });
    await vi.runAllTimersAsync();
    expect(d.gl.easeTo).not.toHaveBeenCalled();
    await nav.reroute();
    expect(d.places.directions).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en' }));
  });

  it('positionError chuyển tiếp; không có speechSynthesis → voiceUnavailable một lần', () => {
    const d = fakeDeps();
    vi.stubGlobal('speechSynthesis', undefined);
    const nav = d.make();
    const onError = vi.fn();
    const onVoice = vi.fn();
    nav.on('positionError', onError);
    nav.on('voiceUnavailable', onVoice);
    nav.start({
      response,
      source: {
        subscribe: (_onFix, onErr) => {
          onErr?.({ code: 'denied', message: 'x' });
          return () => {};
        },
      },
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'denied' }));
    expect(onVoice).toHaveBeenCalledTimes(1);
  });

  it('stop(): huỷ nguồn, cancel speech, nhả wake lock, gỡ puck và listener kéo; start lần hai tự stop trước', async () => {
    const d = fakeDeps();
    vi.stubGlobal('speechSynthesis', d.synth);
    const nav = d.make();
    const fixes = simulateFixes(route);
    nav.start({ response, source: playbackSource(fixes, { rate: 1 }) });
    await vi.advanceTimersByTimeAsync(3000);
    expect(d.handlerCount('dragstart')).toBe(1);
    nav.stop();
    const calls = d.routes.setProgress.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(d.routes.setProgress.mock.calls.length).toBe(calls);
    expect(d.synth.cancel).toHaveBeenCalled();
    expect(d.sentinel.release).toHaveBeenCalled();
    expect(d.handlerCount('dragstart')).toBe(0);
    expect(nav.status).toBe('idle');
    expect(nav.state).toBeNull();

    nav.start({ response, source: playbackSource(fixes, { rate: 1 }) });
    nav.start({ response, source: playbackSource(fixes, { rate: 1 }) });
    expect(d.handlerCount('dragstart')).toBe(1);
    expect(d.routes.show).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/web/src/navigation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết `navigation.ts`**

```ts
import {
  type DirectionsLang,
  type DirectionsResponse,
  type MapsLibVNClient,
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
import type * as maplibregl from 'maplibre-gl';
import { geolocationSource } from './position-source';
import type { RoutesLayer } from './routes-layer';
import { type Speech, type SpeechOptions, createSpeech } from './speech';

export interface NavigationStartOptions {
  response: DirectionsResponse;
  routeIndex?: number;
  /** Mặc định `map.places`. */
  provider?: RouteProvider;
  /** Mặc định 'auto'. */
  reroute?: 'auto' | 'manual';
  /** Mặc định theo `lang` của map. */
  lang?: DirectionsLang;
  /** Mặc định true. */
  voice?: boolean | { rate?: number; volume?: number };
  /** Mặc định true; zoom theo phương tiện, pitch 45. */
  follow?: boolean | { zoom?: number; pitch?: number; padding?: maplibregl.PaddingOptions };
  /** Mặc định `geolocationSource()`. */
  source?: PositionSource;
  thresholds?: Partial<NavigationThresholds>;
  /** Mặc định true. */
  wakeLock?: boolean;
}

export interface WebNavigationEvents extends NavigationEvents {
  followChange: boolean;
  positionError: PositionError;
  voiceUnavailable: undefined;
}

export interface NavigationController {
  start(opts: NavigationStartOptions): void;
  /** Dừng GPS, giọng nói, wake lock, puck; KHÔNG xoá tuyến (gọi `map.routes.clear()` nếu cần). */
  stop(): void;
  recenter(): void;
  reroute(): Promise<void>;
  readonly state: NavigationProgress | null;
  readonly status: NavigationStatus;
  readonly following: boolean;
  on<K extends keyof WebNavigationEvents>(
    event: K,
    handler: (e: WebNavigationEvents[K]) => void,
  ): void;
  off<K extends keyof WebNavigationEvents>(
    event: K,
    handler: (e: WebNavigationEvents[K]) => void,
  ): void;
}

export interface NavigationDeps {
  gl: maplibregl.Map;
  ml: { Marker: typeof maplibregl.Marker };
  places: MapsLibVNClient;
  routes: RoutesLayer;
  lang: DirectionsLang;
  /** Tiêm cho test; mặc định `navigator.wakeLock`. */
  wakeLock?: WakeLock | undefined;
  /** Tiêm cho test; mặc định `document`. */
  document?: Document | undefined;
}

export const FOLLOW_ZOOM: Readonly<Record<TravelMode, number>> = {
  walk: 17,
  motorbike: 16.5,
  car: 15.5,
};
const FOLLOW_PITCH = 45;
/** Mũi tên hướng bắc; Marker xoay theo bearing với rotationAlignment 'map'. */
const PUCK_STYLE =
  'width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;' +
  'border-bottom:26px solid #2458a6;filter:drop-shadow(0 0 2px #fff) drop-shadow(0 1px 3px rgba(0,0,0,.5));';
const NAV_EVENTS = [
  'status',
  'progress',
  'step',
  'waypoint',
  'offRoute',
  'reroute',
  'rerouteFailed',
  'announce',
  'arrive',
] as const;

export function createNavigation(deps: NavigationDeps): NavigationController {
  const { gl, ml, routes } = deps;
  const doc = 'document' in deps ? deps.document : typeof document !== 'undefined' ? document : undefined;
  const wakeLockApi =
    'wakeLock' in deps
      ? deps.wakeLock
      : typeof navigator !== 'undefined'
        ? navigator.wakeLock
        : undefined;

  const listeners = new Map<string, Set<(e: never) => void>>();
  const emit = <K extends keyof WebNavigationEvents>(k: K, e: WebNavigationEvents[K]): void => {
    for (const fn of listeners.get(k) ?? []) (fn as (e: WebNavigationEvents[K]) => void)(e);
  };

  let nav: Navigator | null = null;
  let unsubscribe: (() => void) | null = null;
  let speech: Speech | null = null;
  let puck: maplibregl.Marker | null = null;
  let puckOnMap = false;
  let running = false;
  let following = false;
  let follow: { zoom: number; pitch: number; padding?: maplibregl.PaddingOptions } | null = null;
  let sentinel: WakeLockSentinel | null = null;
  let lastFixTs: number | null = null;

  const onUserMove = (): void => {
    if (!following) return;
    following = false;
    emit('followChange', false);
  };

  const camera = (p: NavigationProgress): void => {
    if (!follow) return;
    const dt = lastFixTs === null ? 500 : p.fix.timestamp - lastFixTs;
    lastFixTs = p.fix.timestamp;
    const options: maplibregl.EaseToOptions = {
      center: p.snapped,
      bearing: p.bearing,
      zoom: follow.zoom,
      pitch: follow.pitch,
      duration: Math.max(0, Math.min(1000, dt)),
    };
    if (follow.padding) options.padding = follow.padding;
    gl.easeTo(options);
  };

  const requestWakeLock = async (): Promise<void> => {
    if (!wakeLockApi) return;
    try {
      sentinel = await wakeLockApi.request('screen');
    } catch {
      sentinel = null;
    }
  };
  const releaseWakeLock = (): void => {
    void sentinel?.release();
    sentinel = null;
  };
  const onVisibility = (): void => {
    if (running && doc?.visibilityState === 'visible' && sentinel === null) void requestWakeLock();
  };

  function stop(): void {
    if (!running) return;
    running = false;
    unsubscribe?.();
    unsubscribe = null;
    speech?.cancel();
    speech = null;
    releaseWakeLock();
    doc?.removeEventListener('visibilitychange', onVisibility);
    gl.off('dragstart', onUserMove);
    gl.off('wheel', onUserMove);
    puck?.remove();
    puck = null;
    puckOnMap = false;
    nav?.stop();
    nav = null;
    lastFixTs = null;
    following = false;
    follow = null;
  }

  function start(opts: NavigationStartOptions): void {
    if (running) stop();
    running = true;
    const lang = opts.lang ?? deps.lang;
    const routeIndex = opts.routeIndex ?? 0;
    const navOptions: NavigatorOptions = {
      response: opts.response,
      routeIndex,
      provider: opts.provider ?? deps.places,
      reroute: opts.reroute ?? 'auto',
      lang,
    };
    if (opts.thresholds) navOptions.thresholds = opts.thresholds;
    const engine = createNavigator(navOptions);
    nav = engine;
    routes.show(opts.response, { active: routeIndex });

    if (opts.voice !== false) {
      const v = typeof opts.voice === 'object' ? opts.voice : {};
      const speechOptions: SpeechOptions = {
        lang,
        onUnavailable: () => emit('voiceUnavailable', undefined),
      };
      if (v.rate !== undefined) speechOptions.rate = v.rate;
      if (v.volume !== undefined) speechOptions.volume = v.volume;
      speech = createSpeech(speechOptions);
      speech.warmUp();
    }

    if (opts.follow !== false) {
      const f = typeof opts.follow === 'object' ? opts.follow : {};
      const mode = opts.response.routes[routeIndex]?.mode ?? 'motorbike';
      follow = { zoom: f.zoom ?? FOLLOW_ZOOM[mode], pitch: f.pitch ?? FOLLOW_PITCH };
      if (f.padding) follow.padding = f.padding;
      following = true;
      gl.on('dragstart', onUserMove);
      gl.on('wheel', onUserMove);
    }

    const el = doc?.createElement('div');
    if (el) {
      el.setAttribute('style', PUCK_STYLE);
      el.setAttribute('aria-hidden', 'true');
      puck = new ml.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
    }

    engine.on('progress', (p) => {
      routes.setProgress(p.shapeIndex, p.snapped);
      if (puck) {
        puck.setLngLat(p.snapped).setRotation(p.bearing);
        if (!puckOnMap) {
          puck.addTo(gl);
          puckOnMap = true;
        }
      }
      if (following) camera(p);
    });
    engine.on('announce', (a) => speech?.speak(a.text, a.priority));
    engine.on('reroute', (e) => routes.show(e.response, { active: 0 }));
    engine.on('arrive', () => {
      unsubscribe?.();
      unsubscribe = null;
      releaseWakeLock();
    });
    for (const name of NAV_EVENTS) {
      engine.on(name, (e) => emit(name, e as WebNavigationEvents[typeof name]));
    }

    const source = opts.source ?? geolocationSource();
    unsubscribe = source.subscribe(
      (fix) => engine.update(fix),
      (error) => emit('positionError', error),
    );
    if (opts.wakeLock !== false) {
      void requestWakeLock();
      doc?.addEventListener('visibilitychange', onVisibility);
    }
  }

  return {
    start,
    stop,
    recenter() {
      if (!running || !follow) return;
      following = true;
      emit('followChange', true);
      if (nav?.progress) camera(nav.progress);
    },
    reroute() {
      return nav ? nav.reroute() : Promise.reject(new Error('map.navigation chưa start()'));
    },
    get state() {
      return nav?.progress ?? null;
    },
    get status() {
      return nav?.status ?? 'idle';
    },
    get following() {
      return following;
    },
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as (e: never) => void);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler as (e: never) => void);
    },
  };
}
```

Lưu ý: `stop()` gọi `nav.stop()` rồi bỏ tham chiếu nên `status` về `'idle'` (test kỳ vọng) — trạng thái `'stopped'` chỉ tồn tại trong core.

- [ ] **Step 4: Chạy test navigation**

Run: `pnpm exec vitest run packages/web/src/navigation.test.ts`
Expected: PASS. Ca "12 câu" phụ thuộc lịch đọc core (Task 9) — nếu lệch, kiểm core trước, không sửa số ở đây.

- [ ] **Step 5: Nối vào `map.ts`**

`packages/web/src/map.ts`:

Thêm import:

```ts
import { type NavigationController, createNavigation } from './navigation';
import { type RoutesLayer, createRoutesLayer } from './routes-layer';
```

`MapEvents` thêm `routeClick: { index: number };`. `MapsLibVNMap` thêm sau `places`:

```ts
  /** Vẽ tuyến từ `DirectionsResponse` (spec B 5.2). */
  routes: RoutesLayer;
  /** Dẫn đường theo GPS (spec B 5.5). */
  navigation: NavigationController;
```

Trong `createMap`, sau khối `listeners` (thêm `routeClick: new Set(),` vào object `listeners`) và hàm `emit`:

```ts
  const routes = createRoutesLayer(gl, ml, (index) => emit('routeClick', { index }));
  const navigation = createNavigation({ gl, ml, places, routes, lang: opts.lang ?? 'vi' });
```

Object trả về thêm `routes, navigation,` sau `places,` và `remove()` thành:

```ts
    remove() {
      navigation.stop();
      routes.clear();
      gl.remove();
    },
```

`packages/web/src/map.test.ts`, trong `class Map` của `fakeMaplibre()` thêm:

```ts
    getSource = vi.fn(() => undefined);
    isStyleLoaded = vi.fn(() => true);
    off = vi.fn();
    easeTo = vi.fn();
```

và thêm test cuối `describe('createMap')`:

```ts
  it('có routes và navigation; remove() dừng dẫn đường, xoá tuyến rồi gl.remove()', () => {
    const { ml } = fakeMaplibre();
    const m = createMap(base, { maplibre: ml as never });
    expect(typeof m.routes.show).toBe('function');
    expect(m.navigation.status).toBe('idle');
    m.remove();
    expect(m.gl.remove).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 6: Export ESM và UMD**

`packages/web/src/index.ts` thay toàn bộ bằng:

```ts
export { createMap } from './map';
export type { CreateMapOptions, MapEvents, MapsLibVNMap, MarkerOptions, PoiFeature } from './map';
export { applyLanguage, nameExpression } from './language';
export type { Lang } from './language';
export { MapsLibVNAutocomplete, defineAutocomplete } from './autocomplete-element';
export { ROUTE_LAYER_IDS, ROUTE_SOURCE_ID } from './routes-layer';
export type { RoutesLayer } from './routes-layer';
export { FOLLOW_ZOOM } from './navigation';
export type { NavigationController, NavigationStartOptions, WebNavigationEvents } from './navigation';
export { geolocationSource, playbackSource, toGeoFix } from './position-source';
export type { GeolocationSourceOptions } from './position-source';
export { createSpeech } from './speech';
export type { Speech, SpeechOptions } from './speech';
export {
  attributionHtml,
  attributionText,
  createClient,
  createNavigator,
  formatDistance,
  formatDistanceShort,
  MapsLibVNError,
  NAVIGATION_THRESHOLDS,
  simulateFixes,
} from '@mapslibvn/core';
export type {
  Announcement,
  AttributionResponse,
  ClientOptions,
  DirectionsLang,
  DirectionsOptions,
  DirectionsResponse,
  GeoFix,
  ManeuverKind,
  MapsLibVNClient,
  NavigationEvents,
  NavigationProgress,
  NavigationStatus,
  NavigationThresholds,
  Navigator,
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

`packages/web/src/umd.ts`: khối `export { … } from './index';` thêm `ROUTE_LAYER_IDS, ROUTE_SOURCE_ID, FOLLOW_ZOOM, geolocationSource, playbackSource, toGeoFix, createSpeech, createNavigator, formatDistance, formatDistanceShort, NAVIGATION_THRESHOLDS, simulateFixes`; khối `export type` thêm các kiểu mới tương ứng.

- [ ] **Step 7: Test, typecheck, build, size**

Run: `pnpm exec vitest run packages/web && pnpm --filter @mapslibvn/web typecheck && pnpm --filter @mapslibvn/web build`
Expected: PASS; size-limit in `dist/index.js` (kỳ vọng ≤ 11 kB gzip, trần 15 kB) và UMD (< 350 kB). Ghi số vào commit.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): map.navigation — geolocation, camera bám, puck, giọng nói, wake lock; map.routes gắn vào createMap (spec B 5.5)

Web wrapper: <số đo> kB gzip (trần 15 kB); UMD <số đo> kB.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: React `useNavigation()`

**Files:**
- Create: `packages/react/src/use-navigation.ts`
- Test: `packages/react/src/use-navigation.test.tsx`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Viết test thất bại**

```tsx
// @vitest-environment jsdom
import { createMap } from '@mapslibvn/web';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapsLibVNMap } from './map';
import { useNavigation } from './use-navigation';

vi.mock('maplibre-gl', () => ({}));
vi.mock('@mapslibvn/web', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mapslibvn/web')>()),
  createMap: vi.fn(),
}));

function fakeNavigation() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  let status = 'idle';
  let state: unknown = null;
  const nav = {
    start: vi.fn(),
    stop: vi.fn(),
    recenter: vi.fn(),
    reroute: vi.fn(async () => {}),
    on: vi.fn((ev: string, fn: (e: unknown) => void) => (handlers[ev] ??= []).push(fn)),
    off: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn);
    }),
    get status() {
      return status;
    },
    get state() {
      return state;
    },
    get following() {
      return true;
    },
  };
  return {
    nav,
    setStatus: (s: string) => {
      status = s;
      handlers.status?.forEach((fn) => fn({ status: s, previous: 'idle' }));
    },
    setProgress: (p: unknown) => {
      state = p;
      handlers.progress?.forEach((fn) => fn(p));
    },
    handlerCount: (ev: string) => (handlers[ev] ?? []).length,
  };
}

const wrapperFor = (): ((props: { children: ReactNode }) => ReactElement) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MapsLibVNMap apiKey="k" apiBase="https://api.test">
        {children}
      </MapsLibVNMap>
    );
  };

describe('useNavigation', () => {
  const fake = fakeNavigation();
  beforeEach(() => {
    vi.mocked(createMap).mockImplementation(
      () => ({ on: vi.fn(), remove: vi.fn(), navigation: fake.nav }) as never,
    );
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('trả status/progress hiện hành và cập nhật khi sự kiện phát; unmount gỡ listener', async () => {
    const { result, unmount } = renderHook(() => useNavigation(), { wrapper: wrapperFor() });
    await act(async () => {});
    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBeNull();
    act(() => fake.setStatus('navigating'));
    expect(result.current.status).toBe('navigating');
    act(() => fake.setProgress({ stepIndex: 2, remaining_m: 500 }));
    expect(result.current.progress).toMatchObject({ stepIndex: 2 });
    expect(fake.handlerCount('progress')).toBe(1);
    unmount();
    expect(fake.handlerCount('progress')).toBe(0);
    expect(fake.handlerCount('status')).toBe(0);
  });

  it('start/stop/recenter/reroute là của map.navigation', async () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: wrapperFor() });
    await act(async () => {});
    result.current.start({ response: { routes: [], waypoints: [], attribution: '' } });
    result.current.stop();
    result.current.recenter();
    await result.current.reroute();
    expect(fake.nav.start).toHaveBeenCalledTimes(1);
    expect(fake.nav.stop).toHaveBeenCalledTimes(1);
    expect(fake.nav.recenter).toHaveBeenCalledTimes(1);
    expect(fake.nav.reroute).toHaveBeenCalledTimes(1);
  });

  it('ngoài <MapsLibVNMap> → ném như useMap', () => {
    expect(() => render(<Probe />)).toThrowError(/useMap phải được gọi bên trong/);
  });
});

function Probe() {
  useNavigation();
  return null;
}
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/react/src/use-navigation.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Viết `use-navigation.ts`**

```ts
import type { NavigationProgress, NavigationStatus } from '@mapslibvn/core';
import type { NavigationStartOptions } from '@mapslibvn/web';
import { useCallback, useSyncExternalStore } from 'react';
import { useMap } from './map';

export interface UseNavigationResult {
  status: NavigationStatus;
  progress: NavigationProgress | null;
  start(opts: NavigationStartOptions): void;
  stop(): void;
  recenter(): void;
  reroute(): Promise<void>;
}

/** Trạng thái dẫn đường của bản đồ trong context, re-render theo `status` và `progress` (spec B 5.6). */
export function useNavigation(): UseNavigationResult {
  const nav = useMap().navigation;
  const subscribe = useCallback(
    (onChange: () => void) => {
      nav.on('status', onChange);
      nav.on('progress', onChange);
      return () => {
        nav.off('status', onChange);
        nav.off('progress', onChange);
      };
    },
    [nav],
  );
  const status = useSyncExternalStore(subscribe, () => nav.status, () => nav.status);
  const progress = useSyncExternalStore(subscribe, () => nav.state, () => nav.state);
  return {
    status,
    progress,
    start: (opts) => nav.start(opts),
    stop: () => nav.stop(),
    recenter: () => nav.recenter(),
    reroute: () => nav.reroute(),
  };
}
```

`packages/react/src/index.ts` thêm:

```ts
export { useNavigation } from './use-navigation';
export type { UseNavigationResult } from './use-navigation';
export type {
  Announcement,
  NavigationProgress,
  NavigationStatus,
  RouteProvider,
} from '@mapslibvn/core';
export type { NavigationStartOptions } from '@mapslibvn/web';
```

- [ ] **Step 4: Chạy test, typecheck, build**

Run: `pnpm exec vitest run packages/react && pnpm --filter @mapslibvn/react typecheck && pnpm --filter @mapslibvn/react build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src
git commit -m "feat(react): useNavigation() đọc status/progress của map.navigation qua useSyncExternalStore (spec B 5.6)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Docs — trang `dan-duong`, cập nhật `api.md`, `sdk.md`, `tinh-nang.md`, `react.md`, sidebar

**Files:**
- Create: `apps/docs/src/content/docs/dan-duong.md`
- Modify: `apps/docs/src/content/docs/api.md` (mục 4 GET /v1/directions và mục 7 `RouteStep`)
- Modify: `apps/docs/src/content/docs/sdk.md` (mục 2, 3, 4)
- Modify: `apps/docs/src/content/docs/tinh-nang.md` (mục 5)
- Modify: `apps/docs/src/content/docs/react.md`
- Modify: `apps/docs/astro.config.mjs` (sidebar "Hướng dẫn")
- Modify: `apps/docs/e2e/docs.spec.ts` (thêm `/dan-duong/`)

- [ ] **Step 1: Trang hướng dẫn `dan-duong.md`**

```md
---
title: Dẫn đường từng bước
description: Bám GPS theo tuyến của /v1/directions trên web — vẽ tuyến, đọc câu tiếng Việt, tự tính lại khi lệch.
---

Trang này dành cho web (`@mapslibvn/web` và `@mapslibvn/react`). Bạn đã có tuyến từ
[`client.directions()`](/api/#get-v1directions); phần còn lại chạy **trên thiết bị**: bám vị trí GPS vào
tuyến, biết đang ở bước nào, đọc câu rẽ đúng lúc, phát hiện lệch và tự gọi lại `directions()`.
Máy chủ chỉ tốn tài nguyên lúc tính tuyến.

## 1. Ba bước

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import { createMap } from '@mapslibvn/web';

const map = createMap(
  { container: 'map', apiKey: 'mlv_live_…', apiBase: 'https://api.ai-solutions.io.vn' },
  { maplibre: maplibregl },
);

// 1. Tính tuyến (tham số [lat, lng]; response dùng [lng, lat])
const response = await map.places.directions({
  from: [10.7798, 106.699],
  to: [10.7725, 106.698],
  mode: 'motorbike',
});

// 2. Vẽ tuyến (tuyến chính, tuyến thay thế nếu có, marker đích)
map.routes.show(response);
map.fitBounds(response.routes[0].bbox, 60);

// 3. Dẫn đường — gọi trong sự kiện bấm nút để trình duyệt cho phép GPS và âm thanh
startButton.onclick = () => map.navigation.start({ response });
```

`start()` mở `navigator.geolocation.watchPosition`, bám mỗi điểm GPS vào tuyến, xoay camera theo hướng
đi, đọc câu chỉ dẫn bằng `speechSynthesis` giọng tiếng Việt và tự tính lại tuyến khi bạn lệch. Gọi
`map.navigation.stop()` để dừng; tuyến vẫn trên bản đồ cho tới khi `map.routes.clear()`.

## 2. Vẽ UI từ sự kiện

SDK không có bảng chỉ dẫn sẵn. Nghe `progress` và vẽ theo ý bạn:

```ts
import { formatDistanceShort } from '@mapslibvn/web';

map.navigation.on('progress', (p) => {
  const next = p.nextStep ?? p.step;          // bước rẽ sắp tới
  icon.dataset.kind = next.kind;              // ManeuverKind → icon của bạn
  instruction.textContent = next.instruction; // "Rẽ phải vào Nguyễn Du."
  distance.textContent = formatDistanceShort(p.distanceToStep_m); // "190 m"
  eta.textContent = `${Math.round(p.remaining_s / 60)} phút · ${formatDistanceShort(p.remaining_m)}`;
});
map.navigation.on('arrive', () => banner.textContent = 'Đã đến nơi');
map.navigation.on('offRoute', () => banner.textContent = 'Lệch tuyến, đang tính lại…');
map.navigation.on('positionError', (e) => {
  if (e.code === 'denied') banner.textContent = 'Bạn chưa cho phép truy cập vị trí';
});
```

| Sự kiện | Payload | Khi nào |
|---|---|---|
| `status` | `{ status, previous }` | `idle → navigating → off_route → rerouting → navigating → arrived` |
| `progress` | `NavigationProgress` | mỗi điểm GPS hợp lệ (≈ 1 lần/giây) |
| `step` | `{ stepIndex, step }` | vừa qua một điểm rẽ |
| `waypoint` | `{ legIndex, waypoint }` | qua một điểm dừng `via` |
| `announce` | `{ text, kind, stepIndex, priority }` | có câu cần đọc — SDK đã đọc nếu `voice` bật; dùng để hiện phụ đề |
| `offRoute` | `{ distance_m, fix }` | lệch tuyến đã xác nhận (3 điểm GPS liên tiếp và ≥ 5 giây) |
| `reroute` | `{ reason, response }` | có tuyến mới; SDK đã vẽ lại |
| `rerouteFailed` | `{ error, attempts, final }` | gọi lại thất bại; `final = true` sau 3 lần, SDK ngừng tự gọi |
| `arrive` | `{ waypoint, fix }` | trong bán kính đến nơi |
| `followChange` | `boolean` | người dùng kéo bản đồ (tắt bám) hoặc `recenter()` |
| `positionError` | `{ code: 'denied' \| 'unavailable' \| 'timeout', message }` | lỗi Geolocation |
| `voiceUnavailable` | — | máy không có giọng đọc cho ngôn ngữ đã chọn |

`NavigationProgress` có: `status`, `route`, `legIndex`, `stepIndex`, `step`, `nextStep`, `snapped`
(`[lng, lat]` đã bám), `bearing`, `traveled_m`, `remaining_m`, `remaining_s`, `distanceToStep_m`,
`offRoute_m`, `fix`.

## 3. Tuỳ chọn `start()`

| Tuỳ chọn | Mặc định | Ghi chú |
|---|---|---|
| `response` | bắt buộc | `DirectionsResponse` |
| `routeIndex` | `0` | tuyến thay thế nếu `alternatives: true` |
| `provider` | `map.places` | ai tính lại tuyến; bất kỳ object có `directions(opts)` |
| `reroute` | `'auto'` | `'manual'`: chỉ phát `offRoute`, bạn tự gọi `map.navigation.reroute()` hoặc `start()` lại |
| `lang` | `lang` của bản đồ | `'vi'` \| `'en'` — giọng đọc và câu "Trong X nữa" |
| `voice` | `true` | `false` tắt; `{ rate, volume }` chỉnh giọng |
| `follow` | `true` | `false` không đụng camera; `{ zoom, pitch, padding }` chỉnh (mặc định zoom 17 / 16,5 / 15,5 cho đi bộ / xe máy / ô tô, pitch 45) |
| `source` | GPS trình duyệt | nguồn vị trí khác — xem giả lập bên dưới |
| `thresholds` | theo phương tiện | ghi đè từng ngưỡng |
| `wakeLock` | `true` | giữ màn hình sáng khi trình duyệt hỗ trợ |

Ngưỡng mặc định theo phương tiện:

| | đi bộ | xe máy | ô tô |
|---|---|---|---|
| Lệch tuyến (m, tối thiểu; thực tế = max với 1,5 × sai số GPS) | 25 | 40 | 50 |
| Đọc "Trong X nữa, …" khi còn (m) | 40 | 200 | 400 |
| Đọc câu rẽ khi còn (m) | 15 | 50 | 80 |
| Bán kính đến nơi (m) | 15 | 25 | 30 |
| Bỏ điểm GPS có sai số hơn (m) | 60 | 100 | 100 |

Tính lại tuyến gọi `directions()` và **tính vào quota Chỉ đường** của khoá; SDK cách hai lần gọi ít
nhất 15 giây và dừng sau 3 lần lỗi liên tiếp.

## 4. Thử không cần ra đường

```ts
import { playbackSource, simulateFixes } from '@mapslibvn/web';

const route = response.routes[0];
map.navigation.start({
  response,
  voice: false,
  source: playbackSource(simulateFixes(route, { jitter_m: 4 }), { rate: 10 }), // nhanh gấp 10
});
```

`simulateFixes` đi dọc tuyến với vận tốc theo phương tiện; `jitter_m` thêm nhiễu GPS. Muốn thử lệch
tuyến, dịch toạ độ một đoạn fix rồi truyền vào `playbackSource`. [Demo dẫn đường](/dan-duong-demo/)
có nút Giả lập làm đúng việc này.

## 5. Dùng logic không cần bản đồ

Máy trạng thái nằm trong `@mapslibvn/core`, không cần MapLibre hay DOM:

```ts
import { createNavigator, createClient } from '@mapslibvn/core';

const client = createClient({ apiKey, baseUrl });
const nav = createNavigator({ response, provider: client });
nav.on('announce', (a) => console.log(a.text));
nav.update({ lng: 106.699, lat: 10.7798, accuracy_m: 8, heading: 160, speed_mps: 4, timestamp: Date.now() });
```

Đây cũng là phần React Native sẽ dùng lại.

## 6. React

```tsx
import { useNavigation } from '@mapslibvn/react';

function Panel({ response }) {
  const { status, progress, start, stop } = useNavigation();
  return status === 'idle'
    ? <button onClick={() => start({ response })}>Bắt đầu</button>
    : <div>{progress?.nextStep?.instruction} <button onClick={stop}>Dừng</button></div>;
}
```

Hook phải nằm trong `<MapsLibVNMap>`. Xem [React](/react/) mục 6.

## 7. Giới hạn trình duyệt cần biết

- **Cần HTTPS** (hoặc `localhost`) để có Geolocation.
- **Không dẫn đường nền trên web.** iOS và Android tạm dừng `watchPosition` khi tắt màn hình hoặc
  chuyển app; SDK chỉ giữ màn hình sáng bằng Wake Lock khi có. Dẫn đường nền là việc của SDK React Native.
- **Giọng tiếng Việt tuỳ máy.** Safari/iOS có sẵn; Chrome máy tính có khi cần mạng; Android tuỳ gói
  TTS đã cài. Không có → sự kiện `voiceUnavailable`, chữ vẫn hiện. Gọi `start()` trong sự kiện bấm
  nút để iOS cho phép phát âm.
- **GPS phố hẹp nhiễu** 20–50 m là bình thường; ngưỡng lệch đã tính theo sai số GPS. Đứng yên thì
  hướng mũi tên lấy theo tuyến, không theo la bàn.
- Toạ độ bạn gửi khi tính lại tuyến nằm trong URL request như mọi lượt `directions()` — xem
  [Điều khoản tenant](/dieu-khoan/) mục 5.

Đọc thêm: [REST API — directions](/api/#get-v1directions), [SDK JavaScript](/sdk/).
```

- [ ] **Step 2: `api.md`**

Trong response mẫu của `GET /v1/directions` (mục 4), sau dòng `"instruction": "Đi về hướng nam trên Đồng Khởi.",` thêm `"verbal_alert": "Đi về hướng nam trên Đồng Khởi.",`. Trong "Điểm cần chú ý", thay dòng

`- \`verbal_pre\`/\`verbal_post\` dành cho đọc bằng giọng nói; có thể \`null\`.`

bằng

```md
- `verbal_alert` (câu rẽ ngắn để đọc lúc còn xa), `verbal_pre` (đọc ngay trước điểm rẽ), `verbal_post` (đọc sau khi rẽ) dành cho giọng nói; có thể `null`. Câu không kèm khoảng cách — SDK ghép "Trong 200 mét nữa, …" theo vị trí thật (xem [Dẫn đường](/dan-duong/)).
- Câu tiếng Việt (`lang=vi`) đã qua bảng sửa cụm từ của MapsLibVN (ví dụ "Điểm đến ở bên trái." thay cho bản dịch máy "Điểm đến của bạn nằm ở trái."); `lang=en` trả nguyên văn engine.
```

Mục 7, `interface RouteStep`: thêm `  verbal_alert: string | null;` ngay sau `instruction: string;`.

- [ ] **Step 3: `sdk.md`**

Mục 2, bảng export core: dòng "Kiểu dữ liệu API" thêm cuối: `, \`GeoFix\`, \`RouteProvider\`, \`PositionSource\`, \`PositionError\`, \`NavigationStatus\`, \`NavigationThresholds\`, \`NavigationProgress\`, \`Announcement\`, \`NavigationEvents\`, \`NavigatorOptions\`, \`Navigator\``. Thêm dòng mới sau "Chỉ đường":

```md
| Dẫn đường | `createNavigator`, `NAVIGATION_THRESHOLDS`, `simulateFixes`, `SIMULATE_DEFAULT_SPEED_MPS`, `formatDistance`, `formatDistanceShort`, `roundForSpeech`, `composeApproach`, `planAnnouncements`, `buildRouteIndex`, `progressAt`, `stepAt`, `snapToRoute`, `haversineM`, `bearingDeg`, `projectOnSegment`, `cumulativeDistances` — xem [Dẫn đường](/dan-duong/) mục 5 |
```

Mục 3, câu đầu "Export của `packages/web/src/index.ts`: …" thêm: `, \`geolocationSource\`, \`playbackSource\`, \`toGeoFix\`, \`createSpeech\`, \`ROUTE_SOURCE_ID\`, \`ROUTE_LAYER_IDS\`, \`FOLLOW_ZOOM\`, các kiểu \`RoutesLayer\`, \`NavigationController\`, \`NavigationStartOptions\`, \`WebNavigationEvents\`, và re-export dẫn đường từ core (\`createNavigator\`, \`simulateFixes\`, \`formatDistance\`, \`formatDistanceShort\`, \`NAVIGATION_THRESHOLDS\`)`.

Bảng "Bản đồ trả về" thêm hai dòng sau `places`:

```md
| `routes` | `RoutesLayer` | `show(response, { active, markers })`, `setActive(i)`, `setProgress(shapeIndex, snapped)`, `clear()` — source `mapslibvn-route`, bốn layer chèn dưới nhãn |
| `navigation` | `NavigationController` | `start(opts)`, `stop()`, `recenter()`, `reroute()`, `state`, `status`, `following`, `on/off` — xem [Dẫn đường](/dan-duong/) |
```

Dòng `remove()` đổi ghi chú thành `dừng dẫn đường, xoá tuyến rồi gọi \`gl.remove()\``.

Bảng "Sự kiện và payload" thêm:

```md
| `routeClick` | `{ index }` | người dùng bấm lên một tuyến thay thế đang vẽ mờ |
```

Mục 4 "useMap, Marker, usePlaces" đổi tiêu đề thành "useMap, Marker, usePlaces, useNavigation" và thêm cuối mục:

```md
`useNavigation()` trả `{ status, progress, start, stop, recenter, reroute }` của `map.navigation` trong context và re-render theo `status`/`progress`. Ngoài `<MapsLibVNMap>` ném lỗi như `useMap`. Chi tiết ở [Dẫn đường](/dan-duong/) mục 6.
```

- [ ] **Step 4: `tinh-nang.md` mục 5**

Thay câu `logic dẫn đường theo GPS trên thiết bị thuộc SDK giai đoạn sau.` bằng `SDK web dẫn đường từng bước trên thiết bị: bám GPS vào tuyến, đọc câu tiếng Việt đúng lúc bằng giọng nói, tự tính lại khi lệch, báo đến nơi — xem [Dẫn đường](/dan-duong/).`

- [ ] **Step 5: `react.md`**

Trước `## 6. Ví dụ — tìm và ghim` chèn mục mới, rồi đổi `## 6. Ví dụ` → `## 7. Ví dụ`, `## 7. Lỗi hay gặp` → `## 8. Lỗi hay gặp`:

```md
## 6. `useNavigation()`

```tsx
import { useNavigation } from '@mapslibvn/react';

function DanDuong({ response }: { response: DirectionsResponse }) {
  const { status, progress, start, stop } = useNavigation();
  if (status === 'idle' || status === 'arrived') {
    return <button onClick={() => start({ response })}>Bắt đầu</button>;
  }
  const next = progress?.nextStep ?? progress?.step;
  return (
    <div>
      <p>{next?.instruction}</p>
      <button onClick={stop}>Dừng</button>
    </div>
  );
}
```

Hook đọc `map.navigation` của bản đồ trong context; `start/stop/recenter/reroute` là hàm của SDK web.
Tuỳ chọn `start()` và danh sách sự kiện ở [Dẫn đường](/dan-duong/).
```

Bảng "Lỗi hay gặp" thêm dòng: `| \`useNavigation\` ném lỗi | Hook ở ngoài \`<MapsLibVNMap>\` |`.

- [ ] **Step 6: Sidebar và E2E link**

`apps/docs/astro.config.mjs`, nhóm "Hướng dẫn", sau `{ label: 'Tìm kiếm & autocomplete', slug: 'tim-kiem' },` thêm `{ label: 'Dẫn đường', slug: 'dan-duong' },`.

`apps/docs/e2e/docs.spec.ts`, mảng `PAGES` thêm `'/dan-duong/',` sau `'/tim-kiem/',`.

- [ ] **Step 7: Build docs kiểm link**

Run: `pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs typecheck`
Expected: build xanh, không cảnh báo link hỏng (`/dan-duong-demo/` chưa tồn tại tới Task 17 — trang `dan-duong.md` có link tới nó; Starlight không fail build vì link nội bộ, E2E `docs.spec` mới kiểm — chạy E2E ở Task 17).

- [ ] **Step 8: Commit**

```bash
git add apps/docs/src/content/docs apps/docs/astro.config.mjs apps/docs/e2e/docs.spec.ts
git commit -m "docs: trang Dẫn đường, verbal_alert và bảng cụm từ trong API, map.routes/map.navigation/useNavigation trong SDK (spec B mục 8)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Trang demo `/dan-duong-demo/` và E2E giả lập

**Files:**
- Create: `apps/docs/src/lib/dan-duong-demo.ts`
- Create: `apps/docs/src/pages/dan-duong-demo.astro`
- Create: `apps/docs/e2e/dan-duong-demo.spec.ts`
- Modify: `apps/docs/astro.config.mjs` (nhóm "Thử nghiệm"), `apps/docs/e2e/docs.spec.ts` (`/dan-duong-demo/`)

- [ ] **Step 1: Viết E2E thất bại**

Tạo `apps/docs/e2e/dan-duong-demo.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// Spec B mục 7.4: provider fixture (không Valhalla) + playbackSource nhanh gấp 20, voice tắt.
test('demo dẫn đường giả lập: tìm tuyến từ fixture, chạy hết, có câu "Trong … nữa", đến nơi', async ({
  page,
}) => {
  await page.goto('/dan-duong-demo/?api=http://localhost:8787&fixture=1&simulate=1&rate=20');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

  await page.getByRole('button', { name: 'Tìm tuyến' }).click();
  await expect(page.locator('#steps li')).toHaveCount(6);
  await expect(page.locator('#start')).toBeEnabled();

  await page.getByRole('button', { name: 'Bắt đầu' }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'navigating', {
    timeout: 10_000,
  });
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'arrived', {
    timeout: 30_000,
  });

  const said = await page.locator('#announcements li').allTextContents();
  expect(said.length).toBeGreaterThanOrEqual(10);
  expect(said.some((t) => t.startsWith('Trong '))).toBe(true);
  expect(said.at(-1)).toBe('Điểm đến ở bên trái.');

  const distanceText = await page.locator('#distance').textContent();
  expect(distanceText).toMatch(/\d+ m|\d+,\d km/);

  const hasLayer = await page.evaluate(() => {
    const demo = (globalThis as { __mapslibvnDemo?: { hasRouteLayer(): boolean } }).__mapslibvnDemo;
    return demo?.hasRouteLayer() ?? false;
  });
  expect(hasLayer).toBe(true);
});
```

`apps/docs/e2e/docs.spec.ts` thêm `'/dan-duong-demo/',` sau `'/react-demo/',`.

- [ ] **Step 2: Chạy E2E, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e -- e2e/dan-duong-demo.spec.ts`
Expected: FAIL — trang 404.

- [ ] **Step 3: Viết `src/lib/dan-duong-demo.ts`**

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  type DirectionsResponse,
  type ManeuverKind,
  type NavigationProgress,
  type NavigationStartOptions,
  type RouteProvider,
  type TravelMode,
  createMap,
  formatDistanceShort,
  playbackSource,
  simulateFixes,
} from '@mapslibvn/web';
import * as maplibregl from 'maplibre-gl';
import { resolveApiBase } from './api-base';

const DEMO_KEY = 'mlv_live_demo00000000000000000000';
const CENTER: [number, number] = [106.699, 10.7798];

const ICONS: Readonly<Record<ManeuverKind, string>> = {
  depart: '●',
  arrive: '⚑',
  continue: '↑',
  slight_right: '↗',
  slight_left: '↖',
  turn_right: '↱',
  turn_left: '↰',
  sharp_right: '↳',
  sharp_left: '↲',
  uturn_right: '↷',
  uturn_left: '↶',
  ramp_straight: '↑',
  ramp_right: '↗',
  ramp_left: '↖',
  exit_right: '↗',
  exit_left: '↖',
  keep_right: '↗',
  keep_left: '↖',
  merge: '↑',
  merge_right: '↗',
  merge_left: '↖',
  roundabout_enter: '↻',
  roundabout_exit: '↻',
  ferry_enter: '⛴',
  ferry_exit: '⛴',
  elevator: '⇕',
  steps: '≡',
  escalator: '≡',
  building_enter: '⌂',
  building_exit: '⌂',
  other: '•',
};

const STATUS_TEXT: Readonly<Record<string, string>> = {
  idle: 'Chưa dẫn đường',
  navigating: 'Đang dẫn đường',
  off_route: 'Lệch tuyến',
  rerouting: 'Đang tính lại tuyến…',
  arrived: 'Đã đến nơi',
};

function byId<T extends HTMLElement>(root: Document, id: string): T {
  const el = root.getElementById(id);
  if (!el) throw new Error(`Thiếu #${id}`);
  return el as T;
}

export function mountDemo(root: Document = document): void {
  const q = new URLSearchParams(location.search);
  const apiBase = resolveApiBase(location.search, location.hostname);
  const apiKey = q.get('key') ?? DEMO_KEY;
  const useFixture = q.get('fixture') === '1';
  let simulate = q.get('simulate') === '1';
  const rate = Math.max(1, Number(q.get('rate') ?? '20'));

  const status = byId<HTMLElement>(root, 'status');
  const findButton = byId<HTMLButtonElement>(root, 'find');
  const startButton = byId<HTMLButtonElement>(root, 'start');
  const simulateButton = byId<HTMLButtonElement>(root, 'simulate');
  const stopButton = byId<HTMLButtonElement>(root, 'stop');
  const recenterButton = byId<HTMLButtonElement>(root, 'recenter');
  const modeSelect = byId<HTMLSelectElement>(root, 'mode');
  const hint = byId<HTMLElement>(root, 'hint');
  const icon = byId<HTMLElement>(root, 'icon');
  const instruction = byId<HTMLElement>(root, 'instruction');
  const distance = byId<HTMLElement>(root, 'distance');
  const eta = byId<HTMLElement>(root, 'eta');
  const gps = byId<HTMLElement>(root, 'gps');
  const steps = byId<HTMLOListElement>(root, 'steps');
  const announcements = byId<HTMLOListElement>(root, 'announcements');
  const log = byId<HTMLUListElement>(root, 'log');

  const map = createMap(
    { container: 'map', apiKey, apiBase, center: CENTER, zoom: 15 },
    { maplibre: maplibregl },
  );

  let from: [number, number] | null = null; // [lng, lat]
  let to: [number, number] | null = null;
  let fromMarker: maplibregl.Marker | null = null;
  let toMarker: maplibregl.Marker | null = null;
  let response: DirectionsResponse | null = null;
  let fixCount = 0;

  const provider: RouteProvider = useFixture
    ? {
        directions: async () =>
          (await (await fetch('/fixtures/directions-q1.json')).json()) as DirectionsResponse,
      }
    : map.places;

  const addLog = (text: string): void => {
    const li = root.createElement('li');
    li.textContent = `${new Date().toLocaleTimeString('vi-VN')} — ${text}`;
    log.prepend(li);
  };
  const setStatus = (s: string): void => {
    status.dataset.status = s;
    status.textContent = STATUS_TEXT[s] ?? s;
  };
  const setPoints = (): void => {
    hint.textContent = !from
      ? 'Bấm lên bản đồ để chọn điểm đi.'
      : !to
        ? 'Bấm lên bản đồ để chọn điểm đến.'
        : 'Bấm "Tìm tuyến".';
    findButton.disabled = !(useFixture || (from && to));
  };

  map.gl.on('click', (e) => {
    if (map.navigation.status !== 'idle' && map.navigation.status !== 'arrived') return;
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    if (!from || (from && to)) {
      from = lngLat;
      to = null;
      fromMarker?.remove();
      toMarker?.remove();
      fromMarker = map.addMarker({ lng: lngLat[0], lat: lngLat[1], color: '#2458a6' });
      response = null;
      map.routes.clear();
      startButton.disabled = true;
      simulateButton.disabled = true;
    } else {
      to = lngLat;
      toMarker = map.addMarker({ lng: lngLat[0], lat: lngLat[1], color: '#d92d20' });
    }
    setPoints();
  });

  const renderSteps = (r: DirectionsResponse): void => {
    steps.replaceChildren();
    const route = r.routes[0];
    if (!route) return;
    for (const leg of route.legs) {
      for (const s of leg.steps) {
        const li = root.createElement('li');
        li.textContent = `${ICONS[s.kind]} ${s.instruction} (${formatDistanceShort(s.distance_m)})`;
        steps.append(li);
      }
    }
  };

  findButton.addEventListener('click', async () => {
    findButton.disabled = true;
    try {
      const mode = modeSelect.value as TravelMode;
      const req = useFixture
        ? { from: [10.7798, 106.699] as [number, number], to: [10.7725, 106.698] as [number, number], mode }
        : {
            from: [from?.[1] ?? 0, from?.[0] ?? 0] as [number, number],
            to: [to?.[1] ?? 0, to?.[0] ?? 0] as [number, number],
            mode,
          };
      response = await provider.directions(req);
      const route = response.routes[0];
      if (!route) throw new Error('Không có tuyến');
      map.routes.show(response);
      map.fitBounds(route.bbox, 60);
      renderSteps(response);
      startButton.disabled = false;
      simulateButton.disabled = false;
      addLog(`Tuyến ${formatDistanceShort(route.distance_m)}, ${Math.round(route.duration_s / 60)} phút, ${route.legs[0]?.steps.length ?? 0} bước`);
    } catch (error) {
      addLog(`Lỗi tính tuyến: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      findButton.disabled = false;
    }
  });

  const start = (): void => {
    if (!response) return;
    const route = response.routes[0];
    if (!route) return;
    fixCount = 0;
    announcements.replaceChildren();
    const options: NavigationStartOptions = { response, provider, voice: !simulate };
    if (simulate) {
      options.source = playbackSource(simulateFixes(route, { jitter_m: 4, seed: 7 }), { rate });
    }
    map.navigation.start(options);
    startButton.disabled = true;
    simulateButton.disabled = true;
    stopButton.disabled = false;
  };
  startButton.addEventListener('click', () => {
    simulate = q.get('simulate') === '1';
    start();
  });
  simulateButton.addEventListener('click', () => {
    simulate = true;
    start();
  });
  stopButton.addEventListener('click', () => {
    map.navigation.stop();
    setStatus('idle');
    stopButton.disabled = true;
    startButton.disabled = response === null;
    simulateButton.disabled = response === null;
  });
  recenterButton.addEventListener('click', () => map.navigation.recenter());

  map.navigation.on('status', (e) => {
    setStatus(e.status);
    if (e.status === 'arrived') {
      stopButton.disabled = true;
      startButton.disabled = false;
      simulateButton.disabled = false;
    }
  });
  map.navigation.on('progress', (p: NavigationProgress) => {
    fixCount += 1;
    const next = p.nextStep ?? p.step;
    icon.textContent = ICONS[next.kind];
    instruction.textContent = next.instruction;
    distance.textContent = formatDistanceShort(p.distanceToStep_m);
    eta.textContent = `${Math.max(1, Math.round(p.remaining_s / 60))} phút · ${formatDistanceShort(p.remaining_m)}`;
    gps.textContent = `${fixCount} điểm · sai số ${Math.round(p.fix.accuracy_m ?? 0)} m · lệch ${Math.round(p.offRoute_m)} m`;
  });
  map.navigation.on('announce', (a) => {
    const li = root.createElement('li');
    li.textContent = a.text;
    li.dataset.kind = a.kind;
    announcements.append(li);
  });
  map.navigation.on('offRoute', (e) => addLog(`Lệch tuyến ${Math.round(e.distance_m)} m`));
  map.navigation.on('reroute', (e) => {
    addLog(`Có tuyến mới (${e.reason})`);
    renderSteps(e.response);
  });
  map.navigation.on('rerouteFailed', (e) => addLog(`Tính lại thất bại lần ${e.attempts}${e.final ? ' — dừng tự tính' : ''}`));
  map.navigation.on('arrive', () => addLog('Đã đến nơi'));
  map.navigation.on('positionError', (e) => addLog(`GPS: ${e.code} — ${e.message}`));
  map.navigation.on('voiceUnavailable', () => addLog('Máy không có giọng đọc cho ngôn ngữ này'));
  map.navigation.on('followChange', (following) => {
    recenterButton.hidden = following;
  });

  setStatus('idle');
  setPoints();
  (globalThis as { __mapslibvnDemo?: unknown }).__mapslibvnDemo = {
    map,
    hasRouteLayer: () => Boolean(map.gl.getLayer('mapslibvn-route-line')),
  };
}
```

- [ ] **Step 4: Viết `src/pages/dan-duong-demo.astro`**

```astro
---
---

<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Demo dẫn đường từng bước của MapsLibVN trên web" />
    <title>MapsLibVN — Demo dẫn đường</title>
    <style>
      :root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #172033; background: #f4f6f9; }
      body { margin: 0; }
      header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 18px; padding: 14px clamp(16px, 4vw, 48px); background: #fff; border-bottom: 1px solid #dce1e8; }
      h1 { margin: 0; font-size: clamp(18px, 3vw, 26px); }
      header nav { display: flex; gap: 18px; margin-left: auto; font-size: 15px; }
      header nav a { color: #2458a6; text-decoration: none; }
      main { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 12px; padding: 12px; height: calc(100vh - 61px); box-sizing: border-box; }
      aside { overflow: auto; display: grid; gap: 12px; align-content: start; }
      .card { padding: 14px; background: #fff; border: 1px solid #dce1e8; border-radius: 10px; }
      .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      button, select { font: inherit; padding: 8px 12px; border-radius: 7px; border: 1px solid #9ca8ba; background: #fff; cursor: pointer; }
      button:disabled { opacity: .5; cursor: default; }
      button.primary { background: #2458a6; color: #fff; border-color: #2458a6; }
      #status { font-weight: 650; }
      #status[data-status="navigating"] { color: #1a7f37; }
      #status[data-status="off_route"], #status[data-status="rerouting"] { color: #b54708; }
      #status[data-status="arrived"] { color: #2458a6; }
      .turn { display: grid; grid-template-columns: 56px 1fr; gap: 10px; align-items: center; }
      #icon { font-size: 40px; line-height: 1; text-align: center; }
      #instruction { font-size: 18px; font-weight: 650; }
      #distance { font-size: 28px; font-weight: 700; color: #2458a6; }
      .muted { color: #596579; font-size: 14px; }
      ol, ul { margin: 6px 0 0; padding-left: 20px; font-size: 14px; }
      #announcements li[data-kind="approach"] { color: #b54708; }
      #announcements li[data-kind="pre"], #announcements li[data-kind="arrive"] { font-weight: 650; }
      #map { min-height: 360px; border: 1px solid #dce1e8; border-radius: 10px; overflow: hidden; background: #dce5ef; }
      @media (max-width: 720px) { main { grid-template-columns: 1fr; height: auto; } #map { height: 55vh; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Demo dẫn đường — @mapslibvn/web</h1>
      <nav aria-label="Liên kết tài liệu">
        <a href="/">← Tài liệu</a>
        <a href="/dan-duong/">Hướng dẫn dẫn đường</a>
      </nav>
    </header>
    <main>
      <aside>
        <section class="card" aria-label="Điều khiển">
          <p id="hint" class="muted">Bấm lên bản đồ để chọn điểm đi.</p>
          <div class="controls">
            <label>Phương tiện
              <select id="mode">
                <option value="motorbike">Xe máy</option>
                <option value="car">Ô tô</option>
                <option value="walk">Đi bộ</option>
              </select>
            </label>
            <button id="find" type="button" disabled>Tìm tuyến</button>
            <button id="start" class="primary" type="button" disabled>Bắt đầu</button>
            <button id="simulate" type="button" disabled>Giả lập</button>
            <button id="stop" type="button" disabled>Dừng</button>
            <button id="recenter" type="button" hidden>Về vị trí</button>
          </div>
          <p><span id="status" data-status="idle">Chưa dẫn đường</span></p>
        </section>
        <section class="card" aria-label="Chỉ dẫn hiện tại">
          <div class="turn">
            <div id="icon" aria-hidden="true">•</div>
            <div>
              <div id="distance">—</div>
              <div id="instruction">Chưa có tuyến</div>
            </div>
          </div>
          <p class="muted"><span id="eta">—</span></p>
          <p class="muted"><span id="gps">Chưa có vị trí</span></p>
        </section>
        <section class="card" aria-label="Các bước">
          <strong>Các bước</strong>
          <ol id="steps"></ol>
        </section>
        <section class="card" aria-label="Câu đã đọc">
          <strong>Câu đã đọc</strong>
          <ol id="announcements"></ol>
        </section>
        <section class="card" aria-label="Nhật ký">
          <strong>Nhật ký</strong>
          <ul id="log"></ul>
        </section>
      </aside>
      <div id="map" role="region" aria-label="Bản đồ"></div>
    </main>
    <script>
      import { mountDemo } from '../lib/dan-duong-demo';
      mountDemo();
    </script>
  </body>
</html>
```

`apps/docs/astro.config.mjs` nhóm "Thử nghiệm", sau `{ label: 'React demo', link: '/react-demo/' },` thêm `{ label: 'Demo dẫn đường', link: '/dan-duong-demo/' },`.

- [ ] **Step 5: Build, typecheck, chạy E2E**

Run: `pnpm --filter @mapslibvn/docs typecheck && pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e`
Expected: `astro check` xanh; E2E toàn bộ xanh gồm `dan-duong-demo.spec.ts`, `docs.spec.ts` (hai trang mới), `react-demo-worker.spec.ts`. Nếu canvas không hiện vì worker MapLibre 404 trên trang mới, kiểm `_astro/maplibre-gl-worker.mjs` được integration `copyMaplibreWorker` chép (áp cho mọi trang build).

- [ ] **Step 6: Thử tay trên máy dev (không bắt buộc cho commit)**

Run: `pnpm --filter @mapslibvn/api dev:e2e` (terminal 1) và `pnpm --filter @mapslibvn/docs dev` (terminal 2), mở `http://localhost:4321/dan-duong-demo/?fixture=1` → bấm Tìm tuyến → Giả lập: mũi tên chạy dọc tuyến, bảng chỉ dẫn đổi, câu hiện trong danh sách.

- [ ] **Step 7: Commit**

```bash
git add apps/docs/src/lib/dan-duong-demo.ts apps/docs/src/pages/dan-duong-demo.astro apps/docs/e2e/dan-duong-demo.spec.ts apps/docs/e2e/docs.spec.ts apps/docs/astro.config.mjs
git commit -m "docs(demo): trang /dan-duong-demo/ với giả lập GPS và E2E không cần Valhalla (spec B 7.4, 8)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: Cổng local, PHONG duyệt bảng cụm từ, deploy Worker + docs tay, smoke production, evidence

**Files:**
- Create: `docs/evidence/navigation/2026-09-XX-phat-hanh.md` (XX = ngày chạy)
- Verify: toàn bộ repo

- [ ] **Step 1: PHONG duyệt bảng cụm từ**

Gửi PHONG bảng `CASES` trong `apps/api/test/routing-vi-phrases.test.ts` (26 cặp câu). Luật PHONG bỏ → xoá khỏi `VI_PHRASE_RULES` **và** `CASES`, cập nhật `directions-q1.json` bằng `pnpm exec vitest run test/routing-fixture-sync.test.ts -u` (trong `apps/api`), commit `fix(routing): bảng cụm từ theo duyệt của PHONG`. Không deploy trước khi PHONG xác nhận.

- [ ] **Step 2: Cổng local đầy đủ (thay CI đang khoá)**

Run lần lượt, mọi lệnh phải xanh:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/react build
pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e
pnpm test:routing
```

`pnpm test:routing` cần Docker (dựng Valhalla fixture Quận 1 vài phút); kiểm ca mới "câu đã vá" và `verbal_alert` xanh. Ghi lại: số test `pnpm test`, số test routing, size gzip core/web/UMD từ output size-limit.

- [ ] **Step 3: Deploy Worker production và kiểm**

```bash
cd apps/api && pnpm exec wrangler deploy --env production && cd ../..
node scripts/smoke-directions.mjs --confirm-production --requests=20 --p95-max=800
```

Expected: deploy in Version ID mới; smoke `failed 0` cả bốn tuyến, p95 dưới 800 ms. Rồi kiểm `verbal_alert` và câu đã vá trên production (khoá đọc từ `.env` bằng `--env-file`, cùng biến với smoke):

```bash
node --env-file=.env -e '
const key = process.env.MAPSLIBVN_API_KEY ?? process.env.KEY_EXAMPLE_EMBED;
const url = "https://api.ai-solutions.io.vn/v1/directions?from=10.7798,106.6990&to=10.7725,106.6980&mode=walk";
fetch(url, { headers: { "X-Api-Key": key } }).then(async (r) => {
  const j = await r.json();
  const st = j.routes[0].legs[0].steps;
  console.log(r.status, JSON.stringify({ first: st[0].instruction, alert1: st[1]?.verbal_alert ?? null, hasAlertField: "verbal_alert" in st[0], last: st.at(-1).instruction }));
});'
```

Expected: `first` bắt đầu bằng "Đi về hướng" (không "Lái về phía"), `alert1` là chuỗi hoặc `null` (có trường), `last` là "Điểm đến ở bên trái." hoặc "… phải." hoặc "Bạn đã tới nơi.".

- [ ] **Step 4: Deploy docs production**

```bash
pnpm --filter @mapslibvn/docs exec wrangler pages deploy dist --project-name mapslibvn-docs
```

Mở `https://<docs production>/dan-duong-demo/?fixture=1` và `/dan-duong/`: trang hiện, bấm Tìm tuyến → Giả lập chạy. Ghi URL vào evidence.

- [ ] **Step 5: Evidence phát hành**

Tạo `docs/evidence/navigation/2026-09-XX-phat-hanh.md`:

```md
# Phát hành spec B — dẫn đường core + web (Task 18)

Ngày: 2026-09-XX. Commit: `<sha>`.

## Cổng local (GitHub Actions khoá vì thanh toán)

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | xanh |
| `pnpm typecheck` | xanh |
| `pnpm test` | <N> test / <M> file xanh |
| `pnpm --filter @mapslibvn/docs e2e` | <N> test xanh (gồm dan-duong-demo) |
| `pnpm test:routing` | <N> test xanh, graph fixture build <s> s |

## Size (gzip)

| Gói | Đo | Trần |
|---|---|---|
| core `dist/index.js` | <x> kB | 16 kB |
| web `dist/index.js` | <x> kB | 15 kB |
| web UMD | <x> kB | 350 kB |

## Production

- Worker version `<id>`; smoke 4 tuyến × 20 lượt: failed 0, p95 <…> ms.
- Kiểm `verbal_alert` + câu đã vá: `<output JSON của curl>`
- Docs: `<URL>/dan-duong/`, `<URL>/dan-duong-demo/`.
```

- [ ] **Step 6: Commit**

```bash
git add docs/evidence/navigation
git commit -m "docs(evidence): phát hành spec B — cổng local, size, smoke production, verbal_alert

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: Thực địa — PHONG đi bộ một tuyến, chốt ngưỡng

**Files:**
- Create: `docs/evidence/navigation/2026-09-XX-di-bo.md`
- Modify (nếu chỉnh ngưỡng): `packages/core/src/navigation/types.ts`, `types.test.ts`, `apps/docs/src/content/docs/dan-duong.md` (bảng ngưỡng), spec B mục 4.3, DEVLOG mục 3

- [ ] **Step 1: Hướng dẫn PHONG (chép vào tin nhắn)**

1. Mở `https://<docs>/dan-duong-demo/` trên điện thoại (Safari iOS hoặc Chrome Android), cho phép vị trí.
2. Chọn "Đi bộ"; bấm bản đồ chọn điểm đi (vị trí đang đứng) và điểm đến ~1 km, tuyến có ≥ 3 chỗ rẽ → Tìm tuyến → Bắt đầu (mở loa).
3. Đi hết tuyến. **Ở một chỗ rẽ, cố ý rẽ nhầm và đi tiếp ≥ 30 m** rồi quay lại hoặc đi theo tuyến mới.
4. Tới nơi, chụp màn hình bảng "Câu đã đọc", "Nhật ký" và dòng GPS; ghi lại: máy/trình duyệt, câu nào đọc sớm/muộn/thiếu, mấy giây sau khi lệch thì có tuyến mới, có báo "Đã đến nơi" không, màn hình có tắt giữa chừng không, pin hao bao nhiêu.

- [ ] **Step 2: Ghi evidence**

Tạo `docs/evidence/navigation/2026-09-XX-di-bo.md` theo mẫu:

```md
# Thực địa đi bộ — spec B mục 7.5

Ngày: 2026-09-XX. Thiết bị: <máy>, <trình duyệt + phiên bản>. Tuyến: <điểm đi> → <điểm đến>, <x> m, <n> chỗ rẽ.

| Hạng mục | Kết quả |
|---|---|
| Số điểm GPS / sai số điển hình | <n> điểm, <x> m |
| Câu rẽ đọc đúng chỗ (trước chỗ rẽ 15–40 m) | <đạt/không>, ghi chú câu nào lệch |
| Lệch cố ý → `offRoute` sau bao lâu | <s> s |
| Có tuyến mới sau bao lâu kể từ lệch | <s> s (ngưỡng nghiệm thu ≤ 30 s) |
| `arrived` khi tới nơi | <có/không>, cách đích <m> |
| Màn hình tắt / GPS dừng | <không / có lúc …> |
| Pin | <%> trong <phút> |
| Giọng đọc | <có/không, voice nào> |

Ảnh: `2026-09-XX-di-bo-*.png` (cùng thư mục).

## Ngưỡng cần chỉnh

<không / danh sách ngưỡng + số mới + lý do>
```

- [ ] **Step 3: Chỉnh ngưỡng nếu thực địa yêu cầu**

Nếu PHONG báo câu rẽ đọc quá sớm/muộn hoặc lệch giả: đổi số trong `NAVIGATION_THRESHOLDS` (`types.ts`), cập nhật `types.test.ts`, bảng trong `dan-duong.md` và spec B mục 4.3; thêm dòng DEVLOG mục 3 `| ngày | Ngưỡng <tên> walk đổi a → b | thực địa <ngày>: … | commit |`. Chạy `pnpm test` xanh.

- [ ] **Step 4: Commit**

```bash
git add docs/evidence/navigation packages/core/src/navigation apps/docs/src/content/docs/dan-duong.md docs/superpowers/specs/2026-09-12-dan-duong-core-web-design.md docs/DEVLOG.md
git commit -m "docs(evidence): thực địa đi bộ spec B và chốt ngưỡng dẫn đường

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 20: Đóng spec B — DEVLOG, spec A, spec B, memory

**Files:**
- Modify: `docs/DEVLOG.md` (mục 1, 2, 3, 4)
- Modify: `docs/superpowers/specs/2026-09-10-dan-duong-engine-api-design.md` (mục 9, dòng "Câu tiếng Việt của Valhalla dịch máy")
- Modify: `docs/superpowers/specs/2026-09-12-dan-duong-core-web-design.md` (dòng Trạng thái)
- Modify: `/Users/dtphong/.claude/projects/-Users-dtphong-Desktop-software-business-mapsLibVN/memory/trang-thai-moc-hien-tai.md`

- [ ] **Step 1: DEVLOG mục 1 — thêm bullet đầu**

```md
- **2026-09-XX — Dẫn đường spec B phát hành.** Core `navigation/` (createNavigator máy trạng thái thuần,
  bám tuyến theo cửa sổ, lịch đọc 5 loại câu, reroute auto có cooldown 15 s / trần 3 lỗi, simulateFixes;
  barrel <x> kB gzip, trần 16 kB), web `map.routes` + `map.navigation` (geolocation, camera bám, puck,
  speechSynthesis vi-VN, wake lock; wrapper <x> kB), React `useNavigation()`, Worker `verbal_alert` +
  bảng cụm từ `vi-phrases.ts` (<n> luật, corpus 400+ tên không đụng), fixture `directions-q1.json` dùng
  chung qua `toMatchFileSnapshot`, docs `/dan-duong/` + `/dan-duong-demo/` (E2E giả lập), thực địa đi
  bộ <ngày> đạt. `pnpm test` <N> test. Evidence: `docs/evidence/navigation/`. **Bắt đầu tiếp:** spec C
  (React Native: PositionSource từ expo-location, expo-speech, ShapeSource/LineLayer).
```

- [ ] **Step 2: DEVLOG mục 2 — thay đoạn "Dẫn đường"**

```md
- **Dẫn đường:** spec A đóng 11/09, spec B đóng <ngày> (xem mục 1). Kế tiếp: brainstorm **spec C** React
  Native — dùng nguyên `createNavigator`/`PositionSource`/`announce` của core; việc riêng của RN là định vị
  nền, quyền, TTS native, vẽ tuyến bằng ShapeSource. Hai nợ spec A còn nguyên (Routing tests trên Actions;
  đo build lạnh graph).
```

- [ ] **Step 3: DEVLOG mục 3 — các quyết định phát sinh**

Thêm các dòng (điền ngày và commit thật):

```md
| 2026-09-12 | Vá câu tiếng Việt Valhalla **ở Worker** bằng bảng cụm từ, không mount `vi-VN.json` | Locale nằm trong binary Valhalla 3.8.3 (không có `locales/` trên đĩa, `valhalla_service` chứa chuỗi mẫu) — spec A mục 9 sửa một dòng trỏ sang spec B | <commit Task 2> |
| 2026-09-12 | Thêm trường `verbal_alert` vào `RouteStep` (bổ sung, không đổi trường cũ) | Valhalla trả alert ngắn gọn hơn `verbal_pre`; câu "Trong X nữa" do core ghép vì `FormVerbalAlertApproachInstruction` không được gọi trong 3.8.3 | <commit Task 1> |
| 2026-09-12 | Trần size-limit barrel core 12 → 16 kB | navigation/ thêm ~<x> kB; app không dùng dẫn đường vẫn tree-shake (`sideEffects: false`) | <commit Task 4> |
```

- [ ] **Step 4: DEVLOG mục 4 — nhật ký**

Thêm một dòng cho mỗi task đã xong theo dạng `- 2026-09-XX · Spec B T<n> · <việc> · \`<sha>\``.

- [ ] **Step 5: Spec A mục 9**

Dòng `| Câu tiếng Việt của Valhalla dịch máy, đọc gượng | Spec A trả nguyên; spec B đánh giá và có thể vá \`vi-VN.json\` bằng volume mount |` đổi vế sau thành `Spec A trả nguyên; spec B vá ở Worker bằng bảng cụm từ (locale nằm trong binary, không mount được — xem spec B mục 2, 6.2)`.

- [ ] **Step 6: Spec B trạng thái**

Dòng `- Trạng thái: bản viết sau brainstorming …` đổi thành `- Trạng thái: **Đã phát hành <ngày>**; nghiệm thu mục 11 <n>/7 đạt — evidence \`docs/evidence/navigation/\`, DEVLOG mục 1`. Ghi kết quả từng điểm nghiệm thu mục 11 ngay dưới mục 11 (bảng Đạt / Đạt một phần + lý do).

- [ ] **Step 7: Memory trạng thái mốc**

Cập nhật file memory `trang-thai-moc-hien-tai.md`: đoạn "Dẫn đường" ghi spec B đóng <ngày>, plan `docs/superpowers/plans/2026-09-12-dan-duong-core-web.md` 20 task xong, việc tiếp theo brainstorm spec C; giữ hai nợ spec A. Cập nhật `description` frontmatter cho khớp.

- [ ] **Step 8: Cổng cuối và commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: xanh.

```bash
git add docs/DEVLOG.md docs/superpowers/specs/2026-09-10-dan-duong-engine-api-design.md docs/superpowers/specs/2026-09-12-dan-duong-core-web-design.md docs/superpowers/plans/2026-09-12-dan-duong-core-web.md
git commit -m "docs: đóng spec B dẫn đường — DEVLOG, nghiệm thu, trạng thái; spec A mục 9 trỏ sang vá câu ở Worker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Báo PHONG: spec B đóng, hai nợ spec A còn nguyên, bước kế tiếp là brainstorm spec C. Không push — PHONG quyết.
