# La bàn + con quay hồi chuyển cho `@mapslibvn/react-native` — Plan thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App React Native đọc được hướng điện thoại (la bàn trộn gyro) qua SDK: puck dẫn đường xoay theo hướng máy khi đứng yên, chấm xanh có nón hướng ngoài dẫn đường, hook `useHeading()` cho UI, camera xoay theo hướng nhìn khi app bật.

**Architecture:** Core nhận kiểu `HeadingSource`/`HeadingFix` và bộ lọc bù thuần `createHeadingFilter()` (gyro tích phân giữa hai mẫu la bàn, la bàn kéo về theo hằng thời gian). Gói RN: phiên có tuỳ chọn `heading` và sự kiện `heading`; map-binding ghi đè bearing puck khi `fix.speed_mps ≤ 1`; prop `userLocation` với store + lớp vẽ + binding bám camera riêng; `useHeading()`. Entry `/expo` thêm `expoHeadingSource()` gộp `expo-location.watchHeadingAsync` (la bàn) và `expo-sensors.Gyroscope` (gyro) trong một đăng ký native dùng chung. Spec: `docs/superpowers/specs/2026-09-12-la-ban-gyro-react-native-design.md`.

**Tech Stack:** TypeScript 5 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), pnpm 9, Vitest (jsdom cho test React), Biome (2 space, single quote, lineWidth 100), tsup, React 19 + React Native 0.86 + `@maplibre/maplibre-react-native` 11.3.8, Expo SDK 57 (`expo-location` 57.0.17, `expo-sensors` 57.0.3) trong app thử, Astro Starlight.

---

## 0. Quy ước cho mọi task

- Mọi lệnh chạy từ **gốc repo** trừ khi ghi khác.
- Test RN/core chạy ở gốc: `pnpm exec vitest run <đường dẫn>`. Test RN import `@mapslibvn/core` **qua dist** → sau khi sửa core phải `pnpm --filter @mapslibvn/core build` trước khi chạy test RN (`pnpm test` ở gốc đã làm sẵn).
- Test React ghi dòng đầu `// @vitest-environment jsdom` và mock `react-native` + `@maplibre/maplibre-react-native` bằng hai file trong `packages/react-native/src/test/` (như `map.test.tsx`). Test entry `/expo` mock `./modules` bằng `vi.mock` + `vi.hoisted` (như `location-source.test.ts`).
- Không dùng `!` (non-null assertion) — Biome cấm; dùng `??`, `if (!x) return`. Không dùng `forEach` — dùng `for…of`.
- `exactOptionalPropertyTypes` bật: không gán `undefined` cho thuộc tính tuỳ chọn; dùng spread có điều kiện `...(x !== undefined ? { x } : {})`.
- **Không đưa Expo vào pnpm workspace.** Kiểu của `expo-sensors` khai báo ambient trong `packages/react-native/src/expo/expo-modules.d.ts` (Task 10); app thử là dự án npm riêng.
- Commit sau mỗi task, thông điệp Conventional Commits tiếng Việt, kết thúc bằng dòng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Không push (PHONG quyết).
- Bước cuối mỗi task: tick checkbox trong plan này. DEVLOG cập nhật ở Task 14; task nào làm lệch spec thì ghi ngay vào mục "Lệch spec" ở Task 14 bước 6.
- GitHub Actions đang khoá vì thanh toán: mọi cổng CI chạy tay ở Task 14.
- Fixture tuyến dùng chung: `packages/core/tests/fixtures/directions-q1.json`. Từ `packages/react-native/src/navigation/` và `packages/react-native/src/user-location/` import bằng `../../../core/tests/fixtures/directions-q1.json`; từ `packages/react-native/src/` bằng `../../core/tests/fixtures/directions-q1.json`.
- Số version: KHÔNG ghi số version SDK vào README/docs (feedback PHONG 12/09); chỉ được ghi version gói Expo đối chiếu trong chú thích kỹ thuật và `THIRD_PARTY_NOTICES.md`.

## 1. Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `packages/core/src/navigation/heading.ts` (+ test) | kiểu `HeadingFix`, `HeadingSource`, `HeadingError`, `RotationRate`, `CompassSample`; `createHeadingFilter`, `wrapDeg`, `signedDiffDeg`, `MOVING_SPEED_MPS` |
| `packages/core/src/navigation/navigator.ts` | import `MOVING_SPEED_MPS` từ `heading.ts` thay hằng riêng |
| `packages/core/src/navigation/index.ts` | `export * from './heading'` |
| `packages/react-native/scripts/gen-puck.mjs`, `src/navigation/puck-image.ts` (+ test) | thêm PNG nón hướng `HEADING_CONE_*` |
| `packages/react-native/src/test/fake-session.ts` | thêm `heading` getter và helper `heading(h)` |
| `packages/react-native/src/navigation/session.ts` (+ test) | tuỳ chọn `heading`, sự kiện `heading`/`headingUnavailable`, getter `heading` |
| `packages/react-native/src/navigation/map-binding.ts` (+ test mới) | puck theo la bàn khi chậm, `FollowOptions.bearing`, camera theo la bàn có throttle |
| `packages/react-native/src/use-heading.ts` (+ test) | hook `useHeading(source \| session)` |
| `packages/react-native/src/user-location/feature.ts` (+ test) | `userLocationFeature`, `metersPerPixel`, `accuracyRadiusExpression` |
| `packages/react-native/src/user-location/store.ts` (+ test) | `createUserLocationStore` |
| `packages/react-native/src/user-location/binding.ts` (+ test) | `createUserLocationBinding`: đăng ký nguồn theo `visible`, bám camera, `recenter`, `followChange` |
| `packages/react-native/src/user-location/layers.tsx` (+ test) | `UserLocationLayers`: Images + source + 3 layer, ẩn khi dẫn đường |
| `packages/react-native/src/map.tsx`, `context.ts`, `index.ts` (+ test mới) | prop `userLocation`, `MapHandle.userLocation`, xuất mới |
| `packages/react-native/src/expo/heading-source.ts` (+ test) | `expoHeadingSource`, `toCompassSample`, `toAccuracy`, đăng ký native dùng chung |
| `packages/react-native/src/expo/index.ts` (+ test mới), `modules.ts`, `expo-modules.d.ts` | `expoNavigation` kèm heading; import `expo-sensors`; kiểu ambient |
| `packages/react-native/package.json`, `tsup.config.ts` | peer `expo-sensors`, external |
| `THIRD_PARTY_NOTICES.md` (gốc + 4 bản sao), `packages/react-native/README.md` | ghi gói mới; hướng dẫn |
| `examples/embed-rn/{package.json,app.json,App.tsx,navigation-ui.tsx,README.md}` | cài `expo-sensors`, chấm xanh, nút La bàn, chẩn đoán hướng |
| `apps/docs/src/content/docs/{dan-duong-react-native,react-native,sdk,dan-duong,tinh-nang}.md` | docs |
| `docs/evidence/navigation/2026-09-12-la-ban.md`, `docs/DEVLOG.md` | evidence, nhật ký |

---

### Task 1: Core — kiểu hướng, `wrapDeg`, `MOVING_SPEED_MPS`, bộ lọc bù

**Files:**
- Create: `packages/core/src/navigation/heading.ts`
- Create: `packages/core/src/navigation/heading.test.ts`
- Modify: `packages/core/src/navigation/index.ts`
- Modify: `packages/core/src/navigation/navigator.ts:4-25`

- [x] **Step 1: Viết test đỏ**

```ts
// packages/core/src/navigation/heading.test.ts
import { describe, expect, it } from 'vitest';
import {
  type CompassSample,
  MOVING_SPEED_MPS,
  createHeadingFilter,
  signedDiffDeg,
  wrapDeg,
} from './heading';

const T0 = 1_700_000_000_000;
const compass = (
  heading: number,
  timestamp: number,
  over: Partial<CompassSample> = {},
): CompassSample => ({ heading, accuracy: 'high', timestamp, ...over });

describe('wrapDeg / signedDiffDeg', () => {
  it('chuẩn hoá [0, 360) và chênh có dấu (−180, 180]', () => {
    expect(wrapDeg(360)).toBe(0);
    expect(wrapDeg(-90)).toBe(270);
    expect(wrapDeg(725)).toBe(5);
    expect(wrapDeg(-360)).toBe(0);
    expect(signedDiffDeg(1, 359)).toBe(2);
    expect(signedDiffDeg(359, 1)).toBe(-2);
    expect(signedDiffDeg(180, 0)).toBe(180);
    expect(MOVING_SPEED_MPS).toBe(1);
  });
});

describe('createHeadingFilter', () => {
  it('mẫu la bàn đầu phát ngay, giữ accuracy, suy magnetic', () => {
    const f = createHeadingFilter();
    const fix = f.compass(compass(10, T0, { magnetic: 12, accuracy: 'medium' }));
    expect(fix).toEqual({
      heading: 10,
      magnetic: 12,
      accuracy: 'medium',
      timestamp: T0,
      source: 'compass',
    });
    expect(f.current()).toBe(fix);
  });

  it('không gyro: làm mượt theo smoothing_s và đi qua 0 khi vòng 359 → 1', () => {
    const f = createHeadingFilter({ smoothing_s: 0.2 });
    f.compass(compass(0, T0));
    const a = f.compass(compass(10, T0 + 200)); // alpha = 1 − e^-1 ≈ 0,632
    expect(a?.heading).toBeCloseTo(6.32, 1);
    const g = createHeadingFilter({ smoothing_s: 0.2 });
    g.compass(compass(359, T0));
    const b = g.compass(compass(1, T0 + 200)); // chênh +2° → 359 + 1,26 → 0,26, không quay 358°
    expect(b?.heading).toBeCloseTo(0.26, 1);
  });

  it('gyro: null trước la bàn và ở mẫu đầu; tích phân đúng dấu; bỏ khoảng quá lớn; gyroSign đảo', () => {
    const f = createHeadingFilter({ minInterval_ms: 0, minDelta_deg: 0 });
    expect(f.gyro({ z_dps: 90, timestamp: 0 }, T0)).toBeNull(); // chưa có la bàn
    f.reset();
    f.compass(compass(180, T0));
    expect(f.gyro({ z_dps: 90, timestamp: 1000 }, T0 + 1000)).toBeNull(); // mẫu gyro đầu: chưa có dt
    const a = f.gyro({ z_dps: 90, timestamp: 2000 }, T0 + 2000); // 1 s × 90°/s ngược chiều kim đồng hồ
    expect(a?.heading).toBeCloseTo(90, 6);
    expect(a?.source).toBe('fused');
    expect(a?.timestamp).toBe(T0 + 2000);
    expect(f.gyro({ z_dps: 90, timestamp: 5500 }, T0 + 5500)).toBeNull(); // cách 3,5 s > maxGyroGap
    expect(f.current()?.heading).toBeCloseTo(90, 6);
    const b = f.gyro({ z_dps: -20, timestamp: 6000 }, T0 + 6000); // 0,5 s × −20°/s → +10°
    expect(b?.heading).toBeCloseTo(100, 6);

    const r = createHeadingFilter({ gyroSign: -1, minInterval_ms: 0, minDelta_deg: 0 });
    r.compass(compass(180, T0));
    r.gyro({ z_dps: 90, timestamp: 1000 }, T0 + 1000);
    expect(r.gyro({ z_dps: 90, timestamp: 2000 }, T0 + 2000)?.heading).toBeCloseTo(270, 6);
  });

  it('có gyro sống: la bàn kéo về theo tau_s — sau thêm 3τ còn dưới 5% chênh', () => {
    const f = createHeadingFilter({ tau_s: 0.7, minInterval_ms: 0, minDelta_deg: 0 });
    f.compass(compass(0, T0));
    f.gyro({ z_dps: 0, timestamp: 0 }, T0);
    f.gyro({ z_dps: 0, timestamp: 100 }, T0 + 100); // gyro sống, không xoay
    const a = f.compass(compass(90, T0 + 700)); // 1τ → 63,2 % của 90
    expect(a?.heading).toBeCloseTo(56.9, 0);
    const b = f.compass(compass(90, T0 + 700 + 2100)); // thêm 3τ
    expect(Math.abs(90 - (b?.heading ?? 0))).toBeLessThan(4.5);
  });

  it('phát thưa: cách ≥ minInterval_ms và đổi ≥ minDelta_deg', () => {
    const f = createHeadingFilter({ smoothing_s: 0 }); // alpha = 1 → est = target
    expect(f.compass(compass(10, T0))).not.toBeNull();
    expect(f.compass(compass(50, T0 + 50))).toBeNull(); // quá sớm
    expect(f.compass(compass(10.5, T0 + 100))).toBeNull(); // đổi 0,5° so với lần phát (10)
    expect(f.compass(compass(12, T0 + 150))?.heading).toBe(12);
  });

  it('magnetic suy từ độ lệch của mẫu la bàn cuối, kể cả sau khi gyro xoay', () => {
    const f = createHeadingFilter({ minInterval_ms: 0, minDelta_deg: 0 });
    f.compass(compass(10, T0, { magnetic: 12 }));
    f.gyro({ z_dps: 0, timestamp: 0 }, T0);
    const a = f.gyro({ z_dps: 20, timestamp: 1000 }, T0 + 1000); // 10 − 20 → 350
    expect(a?.heading).toBeCloseTo(350, 6);
    expect(a?.magnetic).toBeCloseTo(352, 6);
  });

  it('reset về trạng thái đầu', () => {
    const f = createHeadingFilter();
    f.compass(compass(10, T0));
    f.reset();
    expect(f.current()).toBeNull();
    expect(f.compass(compass(20, T0 + 10))?.heading).toBe(20); // phát ngay như mẫu đầu
  });
});
```

- [x] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/src/navigation/heading.test.ts`
Expected: FAIL — `Failed to resolve import "./heading"`.

- [x] **Step 3: Viết `heading.ts`**

```ts
// packages/core/src/navigation/heading.ts
import { angleDiffDeg } from './geometry';

/** Mức tin cậy la bàn — lớp dán ánh xạ từ thang 0–3 của hệ điều hành. */
export type HeadingAccuracy = 'unreliable' | 'low' | 'medium' | 'high';

export interface HeadingFix {
  /** Độ so với bắc thật, [0, 360), thuận chiều kim đồng hồ. */
  heading: number;
  /** Độ so với bắc từ; thiếu khi nguồn không phân biệt. */
  magnetic?: number;
  accuracy: HeadingAccuracy;
  /** ms epoch — cùng miền với GeoFix.timestamp. */
  timestamp: number;
  /** 'fused' khi gyro đã góp vào góc này. */
  source: 'compass' | 'fused';
}

export interface HeadingError {
  code: 'denied' | 'unavailable';
  message: string;
  raw?: unknown;
}

/** Nguồn hướng do lớp dán cung cấp — cùng hình với PositionSource. */
export interface HeadingSource {
  subscribe(onHeading: (fix: HeadingFix) => void, onError?: (error: HeadingError) => void): () => void;
}

/** Tốc độ xoay quanh trục vuông góc màn hình, độ/giây; dương = ngược chiều kim đồng hồ nhìn từ trên. */
export interface RotationRate {
  z_dps: number;
  /** ms, đồng hồ bất kỳ nhưng phải cùng đồng hồ giữa các mẫu gyro (chỉ dùng tính dt). */
  timestamp: number;
}

/** Một mẫu la bàn thô từ hệ điều hành. */
export interface CompassSample {
  heading: number;
  magnetic?: number;
  accuracy: HeadingAccuracy;
  /** ms epoch. */
  timestamp: number;
}

export interface HeadingFilterOptions {
  /** Hằng thời gian kéo về la bàn khi có gyro — mặc định 0,7 s. */
  tau_s?: number;
  /** Làm mượt la bàn khi không có gyro — mặc định 0,2 s. */
  smoothing_s?: number;
  /** Phát thưa: cách nhau ≥ — mặc định 100 ms. */
  minInterval_ms?: number;
  /** … và đổi ≥ — mặc định 1°. */
  minDelta_deg?: number;
  /** Đảo dấu gyro nếu thực địa thấy quay ngược — mặc định 1. */
  gyroSign?: 1 | -1;
  /** Hai mẫu gyro cách nhau quá ngần này thì không tích phân đoạn đó — mặc định 1 s. */
  maxGyroGap_s?: number;
}

export interface HeadingFilter {
  /** Mẫu la bàn; trả HeadingFix khi đủ điều kiện phát, không thì null. */
  compass(sample: CompassSample): HeadingFix | null;
  /**
   * Mẫu gyro; `now` là ms epoch gắn vào fix phát ra (đồng hồ gyro khác miền với Date.now) —
   * mặc định rate.timestamp cho trường hợp hai đồng hồ trùng nhau (test, web).
   */
  gyro(rate: RotationRate, now?: number): HeadingFix | null;
  current(): HeadingFix | null;
  reset(): void;
}

/** Dưới vận tốc này heading GPS không tin được → puck theo la bàn (RN) hoặc hướng đoạn tuyến. */
export const MOVING_SPEED_MPS = 1;

/** Chuẩn hoá về [0, 360). */
export function wrapDeg(deg: number): number {
  const d = deg % 360;
  return (d < 0 ? d + 360 : d) + 0; // `+ 0` đổi -0 thành 0
}

/** Chênh có dấu a − b trong (−180, 180]. */
export function signedDiffDeg(a: number, b: number): number {
  const d = wrapDeg(a - b);
  return d > 180 ? d - 360 : d;
}

/**
 * Bộ lọc bù bậc một (spec la bàn mục 4): gyro tích phân góc giữa hai mẫu la bàn (phản ứng ngay khi
 * xoay máy), la bàn kéo góc về theo hằng thời gian (không trôi). Không có gyro thì chỉ làm mượt nhẹ.
 * Thuần theo timestamp, không timer — web dùng lại được với DeviceOrientation.
 */
export function createHeadingFilter(opts: HeadingFilterOptions = {}): HeadingFilter {
  const tau_s = opts.tau_s ?? 0.7;
  const smoothing_s = opts.smoothing_s ?? 0.2;
  const minInterval_ms = opts.minInterval_ms ?? 100;
  const minDelta_deg = opts.minDelta_deg ?? 1;
  const gyroSign = opts.gyroSign ?? 1;
  const maxGyroGap_ms = (opts.maxGyroGap_s ?? 1) * 1000;

  let est: number | null = null;
  let accuracy: HeadingAccuracy = 'unreliable';
  let declination: number | null = null; // heading − magnetic của mẫu la bàn cuối
  let lastCompassTs: number | null = null;
  let lastGyroTs: number | null = null;
  let gyroAlive = false;
  let source: HeadingFix['source'] = 'compass';
  let last: HeadingFix | null = null;

  const emit = (timestamp: number, force: boolean): HeadingFix | null => {
    if (est === null) return null;
    if (
      !force &&
      last &&
      (timestamp - last.timestamp < minInterval_ms || angleDiffDeg(est, last.heading) < minDelta_deg)
    ) {
      return null;
    }
    last = {
      heading: est,
      ...(declination !== null ? { magnetic: wrapDeg(est - declination) } : {}),
      accuracy,
      timestamp,
      source,
    };
    return last;
  };

  return {
    compass(s) {
      accuracy = s.accuracy;
      declination = s.magnetic === undefined ? null : signedDiffDeg(s.heading, s.magnetic);
      const target = wrapDeg(s.heading);
      let first = false;
      if (est === null || lastCompassTs === null) {
        est = target;
        first = true;
      } else {
        const dt_s = Math.max(0, (s.timestamp - lastCompassTs) / 1000);
        const tc = gyroAlive ? tau_s : smoothing_s;
        const alpha = tc <= 0 ? 1 : 1 - Math.exp(-dt_s / tc);
        est = wrapDeg(est + signedDiffDeg(target, est) * alpha);
      }
      lastCompassTs = s.timestamp;
      return emit(s.timestamp, first);
    },
    gyro(r, now = r.timestamp) {
      const prev = lastGyroTs;
      lastGyroTs = r.timestamp;
      if (est === null || prev === null) return null;
      const dt_ms = r.timestamp - prev;
      if (dt_ms <= 0 || dt_ms > maxGyroGap_ms) {
        gyroAlive = false;
        return null;
      }
      gyroAlive = true;
      est = wrapDeg(est - gyroSign * r.z_dps * (dt_ms / 1000));
      source = 'fused';
      return emit(now, false);
    },
    current: () => last,
    reset() {
      est = null;
      accuracy = 'unreliable';
      declination = null;
      lastCompassTs = null;
      lastGyroTs = null;
      gyroAlive = false;
      source = 'compass';
      last = null;
    },
  };
}
```

- [x] **Step 4: Xuất và chuyển hằng trong navigator**

`packages/core/src/navigation/index.ts` — thêm dòng cuối:

```ts
export * from './heading';
```

`packages/core/src/navigation/navigator.ts` — sau dòng `import { bearingDeg, haversineM } from './geometry';` thêm:

```ts
import { MOVING_SPEED_MPS } from './heading';
```

và **xoá** hai dòng (khoảng dòng 24–25):

```ts
/** Dưới vận tốc này heading GPS không tin được → dùng hướng đoạn tuyến. */
const MOVING_SPEED_MPS = 1;
```

- [x] **Step 5: Chạy test xanh, build core kiểm size-limit**

Run: `pnpm exec vitest run packages/core/src/navigation/`
Expected: PASS toàn bộ (heading.test + navigator.test không đổi).

Run: `pnpm --filter @mapslibvn/core build`
Expected: dòng cuối `Size: … kB gzipped` ≤ 20 kB (trước task: 17,34 kB). Nếu vượt 20 kB: dừng, báo PHONG — không tự nâng trần.

- [x] **Step 6: Commit**

```bash
git add packages/core/src/navigation/heading.ts packages/core/src/navigation/heading.test.ts packages/core/src/navigation/index.ts packages/core/src/navigation/navigator.ts
git commit -m "feat(core): kiểu hướng la bàn và bộ lọc bù gyro thuần (createHeadingFilter)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Ảnh nón hướng nhúng base64

**Files:**
- Modify: `packages/react-native/scripts/gen-puck.mjs` (viết lại toàn bộ)
- Regenerate: `packages/react-native/src/navigation/puck-image.ts`
- Modify: `packages/react-native/src/navigation/puck-image.test.ts`

- [x] **Step 1: Thêm test đỏ**

Thay toàn bộ `packages/react-native/src/navigation/puck-image.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  HEADING_CONE_IMAGE_KEY,
  HEADING_CONE_PNG_DATA_URI,
  PUCK_IMAGE_KEY,
  PUCK_PNG_DATA_URI,
} from './puck-image';

const PREFIX = 'data:image/png;base64,';
const decode = (uri: string): Buffer => {
  expect(uri.startsWith(PREFIX)).toBe(true);
  return Buffer.from(uri.slice(PREFIX.length), 'base64');
};
const expectPng66 = (png: Buffer): void => {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.readUInt32BE(16)).toBe(66); // width
  expect(png.readUInt32BE(20)).toBe(66); // height
  expect(png[24]).toBe(8); // bit depth
  expect(png[25]).toBe(6); // RGBA
};

describe('puck-image', () => {
  it('mũi tên: PNG RGBA 66×66 nhúng base64, khoá cố định', () => {
    expect(PUCK_IMAGE_KEY).toBe('mapslibvn-puck');
    const png = decode(PUCK_PNG_DATA_URI);
    expectPng66(png);
    expect(png.length).toBeLessThan(2000);
  });

  it('nón hướng: PNG RGBA 66×66 riêng, khoá khác mũi tên', () => {
    expect(HEADING_CONE_IMAGE_KEY).toBe('mapslibvn-heading-cone');
    expect(HEADING_CONE_IMAGE_KEY).not.toBe(PUCK_IMAGE_KEY);
    const png = decode(HEADING_CONE_PNG_DATA_URI);
    expectPng66(png);
    expect(png.length).toBeLessThan(3000);
    expect(HEADING_CONE_PNG_DATA_URI).not.toBe(PUCK_PNG_DATA_URI);
  });
});
```

- [x] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/react-native/src/navigation/puck-image.test.ts`
Expected: FAIL — `HEADING_CONE_IMAGE_KEY` không được export.

- [x] **Step 3: Viết lại script sinh ảnh**

Thay toàn bộ `packages/react-native/scripts/gen-puck.mjs`:

```js
#!/usr/bin/env node
// Sinh src/navigation/puck-image.ts với HAI ảnh PNG 66×66 nhúng base64 (tarball không cần file asset):
//  1. Mũi tên hướng bắc cho puck dẫn đường (xanh #2458a6, viền trắng, khuyết đuôi — spec C mục 7).
//  2. Nón hướng cho chấm xanh ngoài dẫn đường: hình quạt 70° mở lên trên từ tâm ảnh, alpha 0,45 ở
//     tâm mờ dần về 0 ở mép (spec la bàn mục 7). Tâm ảnh = tâm chấm nên icon-anchor 'center' là đúng.
// Siêu lấy mẫu 4× mỗi chiều. Chạy: node packages/react-native/scripts/gen-puck.mjs
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const W = 66;
const H = 66;
const S = 4; // mẫu mỗi chiều trên một điểm ảnh
const BLUE = [0x24, 0x58, 0xa6];
const WHITE = [255, 255, 255];

// ---------- mũi tên ----------
// Hai tam giác (nửa trái/phải) để có khuyết ở đuôi; ruột nhỏ hơn viền ~4 px.
const OUTER = [
  [
    [33, 3],
    [60, 60],
    [33, 48],
  ],
  [
    [33, 3],
    [6, 60],
    [33, 48],
  ],
];
const INNER = [
  [
    [33, 10],
    [53, 55],
    [33, 44],
  ],
  [
    [33, 10],
    [13, 55],
    [33, 44],
  ],
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

/** RGBA một điểm ảnh mũi tên. @param {number} x @param {number} y @returns {number[]} */
function arrowPixel(x, y) {
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
  if (alpha === 0) return [0, 0, 0, 0];
  const t = inner / outer;
  const rgb = [0, 1, 2].map((k) => Math.round(WHITE[k] * (1 - t) + BLUE[k] * t));
  return [...rgb, Math.round(255 * alpha)];
}

// ---------- nón hướng ----------
const CX = 33;
const CY = 33;
const R_IN = 6; // chấm (bán kính 7 px ở icon-size 1) che phần này
const R_OUT = 31;
const HALF_ANGLE_DEG = 35;

/** Alpha 0..0,45 của một mẫu con thuộc quạt; 0 ngoài quạt. @param {number} px @param {number} py */
function coneAlpha(px, py) {
  const dx = px - CX;
  const dy = py - CY;
  const r = Math.hypot(dx, dy);
  if (r < R_IN || r > R_OUT) return 0;
  const angle = Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI); // 0 = hướng lên (bắc)
  if (angle > HALF_ANGLE_DEG) return 0;
  return 0.45 * (1 - (r - R_IN) / (R_OUT - R_IN));
}

/** RGBA một điểm ảnh nón. @param {number} x @param {number} y @returns {number[]} */
function conePixel(x, y) {
  let sum = 0;
  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      sum += coneAlpha(x + (sx + 0.5) / S, y + (sy + 0.5) / S);
    }
  }
  const alpha = sum / (S * S);
  if (alpha === 0) return [0, 0, 0, 0];
  return [...BLUE, Math.round(255 * alpha)];
}

// ---------- PNG ----------
/** @param {(x: number, y: number) => number[]} pixel */
function render(pixel) {
  const bytes = [];
  for (let y = 0; y < H; y++) {
    bytes.push(0); // filter type của dòng
    for (let x = 0; x < W; x++) bytes.push(...pixel(x, y));
  }
  return Buffer.from(bytes);
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
/** @param {Buffer} raw */
function encodePng(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const arrow = encodePng(render(arrowPixel));
const cone = encodePng(render(conePixel));

const out = `// Sinh bởi scripts/gen-puck.mjs — KHÔNG sửa tay; chạy lại script nếu đổi hình.
/** Khoá ảnh đăng ký qua <Images> và dùng trong icon-image của layer puck. */
export const PUCK_IMAGE_KEY = 'mapslibvn-puck';
/** PNG 66×66 mũi tên hướng bắc, xanh #2458a6 viền trắng, nền trong suốt. */
export const PUCK_PNG_DATA_URI =
  'data:image/png;base64,${arrow.toString('base64')}';
/** Khoá ảnh nón hướng của chấm xanh ngoài dẫn đường (spec la bàn mục 7). */
export const HEADING_CONE_IMAGE_KEY = 'mapslibvn-heading-cone';
/** PNG 66×66 hình quạt 70° mở lên trên từ tâm, xanh #2458a6 mờ dần ra mép, nền trong suốt. */
export const HEADING_CONE_PNG_DATA_URI =
  'data:image/png;base64,${cone.toString('base64')}';
`;
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src/navigation/puck-image.ts');
writeFileSync(target, out);
console.log(`✓ ${target} (mũi tên ${arrow.length} byte, nón ${cone.length} byte)`);
```

- [x] **Step 4: Sinh lại ảnh, chạy test xanh**

Run: `node packages/react-native/scripts/gen-puck.mjs`
Expected: `✓ …/puck-image.ts (mũi tên NNNN byte, nón NNNN byte)`.

Run: `pnpm exec vitest run packages/react-native/src/navigation/puck-image.test.ts`
Expected: PASS 2 test.

- [x] **Step 5: Commit**

```bash
git add packages/react-native/scripts/gen-puck.mjs packages/react-native/src/navigation/puck-image.ts packages/react-native/src/navigation/puck-image.test.ts
git commit -m "feat(react-native): ảnh nón hướng 66×66 nhúng base64 cho chấm xanh

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Phiên dẫn đường nhận nguồn hướng

**Files:**
- Modify: `packages/react-native/src/test/fake-session.ts`
- Modify: `packages/react-native/src/navigation/session.ts`
- Modify: `packages/react-native/src/navigation/session.test.ts`

- [x] **Step 1: Mở rộng phiên giả cho test**

Trong `packages/react-native/src/test/fake-session.ts`:

Đổi dòng import đầu thành:

```ts
import type {
  DirectionsResponse,
  HeadingFix,
  NavigationProgress,
  Route,
  RouteStep,
} from '@mapslibvn/core';
```

Sau `let state: NavigationProgress | null = init.state ?? null;` thêm:

```ts
  let heading: HeadingFix | null = null;
```

Trong object `session`, sau `get routeIndex() { … },` thêm:

```ts
    get heading() {
      return heading;
    },
```

Trong object trả về, sau hàm `status(s) { … },` thêm:

```ts
    heading(h: HeadingFix | null) {
      heading = h;
      if (h) emit('heading', h);
    },
```

- [x] **Step 2: Thêm test đỏ cho phiên**

Trong `packages/react-native/src/navigation/session.test.ts`, đổi import đầu thành:

```ts
import {
  type DirectionsResponse,
  type GeoFix,
  type HeadingError,
  type HeadingFix,
  type HeadingSource,
  type PositionError,
  type Route,
  simulateFixes,
} from '@mapslibvn/core';
```

Sau hàm `fakeDevice(...)` (trước `describe` đầu tiên) thêm:

```ts
function fakeHeading() {
  let onHeading: ((h: HeadingFix) => void) | null = null;
  let onError: ((e: HeadingError) => void) | undefined;
  const unsubscribe = vi.fn(() => {
    onHeading = null;
  });
  const source: HeadingSource = {
    subscribe: vi.fn((h: (fix: HeadingFix) => void, e?: (error: HeadingError) => void) => {
      onHeading = h;
      onError = e;
      return unsubscribe;
    }),
  };
  return {
    source,
    unsubscribe,
    push(h: HeadingFix) {
      onHeading?.(h);
    },
    fail(e: HeadingError) {
      onError?.(e);
    },
  };
}
const headingAt = (heading: number, timestamp = 1_700_000_000_000): HeadingFix => ({
  heading,
  accuracy: 'high',
  timestamp,
  source: 'compass',
});
```

Cuối file thêm:

```ts
describe('createNavigationSession — nguồn hướng', () => {
  it('có heading: đăng ký lúc start sau source, phát lại sự kiện, getter; stop() huỷ và xoá', async () => {
    const calls: string[] = [];
    const src = fakeSource(calls);
    const hd = fakeHeading();
    const session = createNavigationSession({ provider, source: src.source, heading: hd.source });
    const got: HeadingFix[] = [];
    session.on('heading', (h) => got.push(h));
    expect(session.heading).toBeNull();
    await session.start({ response });
    expect(calls).toContain('subscribe');
    expect(hd.source.subscribe).toHaveBeenCalledTimes(1);
    hd.push(headingAt(123));
    expect(got.map((h) => h.heading)).toEqual([123]);
    expect(session.heading?.heading).toBe(123);
    await session.stop();
    expect(hd.unsubscribe).toHaveBeenCalledTimes(1);
    expect(session.heading).toBeNull();
  });

  it('đến nơi huỷ đăng ký hướng; lỗi nguồn → headingUnavailable đúng một lần mỗi start', async () => {
    const calls: string[] = [];
    const src = fakeSource(calls);
    const hd = fakeHeading();
    const session = createNavigationSession({ provider, source: src.source, heading: hd.source });
    const errors: HeadingError[] = [];
    session.on('headingUnavailable', (e) => errors.push(e));
    await session.start({ response });
    hd.fail({ code: 'unavailable', message: 'simulator không có la bàn' });
    hd.fail({ code: 'unavailable', message: 'lại' });
    expect(errors).toHaveLength(1);
    src.push(simulateFixes(route));
    expect(session.status).toBe('arrived');
    expect(hd.unsubscribe).toHaveBeenCalledTimes(1);
    expect(session.heading).toBeNull();
  });

  it('không heading: không sự kiện, getter null, mọi thứ khác như cũ', async () => {
    const calls: string[] = [];
    const src = fakeSource(calls);
    const session = createNavigationSession({ provider, source: src.source });
    const onHeading = vi.fn();
    session.on('heading', onHeading);
    await session.start({ response });
    src.push(simulateFixes(route).slice(0, 3));
    expect(onHeading).not.toHaveBeenCalled();
    expect(session.heading).toBeNull();
    await session.stop();
  });
});
```

- [x] **Step 3: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/react-native/src/navigation/session.test.ts`
Expected: FAIL — `session.heading` là `undefined`, `hd.source.subscribe` chưa được gọi.

- [x] **Step 4: Sửa `session.ts`**

Import từ core — thêm ba kiểu vào khối `import { … } from '@mapslibvn/core'`:

```ts
  type HeadingError,
  type HeadingFix,
  type HeadingSource,
```

Trong `NavigationSessionOptions`, sau `audio?: AudioSession;` thêm:

```ts
  /** Nguồn hướng la bàn (spec la bàn 5.3); thiếu → puck/camera như cũ, không có sự kiện heading. */
  heading?: HeadingSource;
```

Trong `SessionEvents`, sau dòng `end: { reason: 'arrived' | 'stopped' };` thêm:

```ts
  /** Hướng la bàn đã lọc — phiên chuyển tiếp nguyên từ `heading`. */
  heading: HeadingFix;
  /** Nguồn hướng lỗi (từ chối quyền, máy không có la bàn) — một lần mỗi start. */
  headingUnavailable: HeadingError;
```

Trong `NavigationSession`, sau `readonly routeIndex: number;` thêm:

```ts
  /** Hướng la bàn cuối của phiên đang chạy; null khi idle hoặc chưa có mẫu. */
  readonly heading: HeadingFix | null;
```

Trong `createNavigationSession`, sau `let unsubscribe: (() => void) | null = null;` thêm:

```ts
  let unsubscribeHeading: (() => void) | null = null;
  let lastHeading: HeadingFix | null = null;
```

Thay hàm `releaseSource`:

```ts
  const releaseSource = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    unsubscribeHeading?.();
    unsubscribeHeading = null;
    lastHeading = null;
  };
```

Trong `start()`, ngay sau khối `unsubscribe = source.subscribe(…);` (cuối hàm) thêm:

```ts
    const headingSource = opts.heading;
    if (headingSource) {
      let reported = false;
      unsubscribeHeading = headingSource.subscribe(
        (h) => {
          lastHeading = h;
          emit('heading', h);
        },
        (error) => {
          if (reported) return;
          reported = true;
          emit('headingUnavailable', error);
        },
      );
    }
```

Trong object trả về, sau `get routeIndex() { return routeIndex; },` thêm:

```ts
    get heading() {
      return lastHeading;
    },
```

- [x] **Step 5: Chạy test xanh**

Run: `pnpm exec vitest run packages/react-native/src/navigation/session.test.ts packages/react-native/src/use-navigation.test.tsx packages/react-native/src/map-navigation.test.tsx`
Expected: PASS (test cũ không đổi; 3 test mới xanh).

- [x] **Step 6: Commit**

```bash
git add packages/react-native/src/test/fake-session.ts packages/react-native/src/navigation/session.ts packages/react-native/src/navigation/session.test.ts
git commit -m "feat(react-native): phiên dẫn đường nhận nguồn hướng, sự kiện heading/headingUnavailable

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: map-binding — puck theo la bàn khi chậm, `follow.bearing`

**Files:**
- Create: `packages/react-native/src/navigation/map-binding.test.ts`
- Modify: `packages/react-native/src/navigation/map-binding.ts` (viết lại toàn bộ)

- [x] **Step 1: Viết test đỏ**

```ts
// packages/react-native/src/navigation/map-binding.test.ts
import type { CameraRef } from '@maplibre/maplibre-react-native';
import type { DirectionsResponse, HeadingFix, NavigationProgress, Route } from '@mapslibvn/core';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import { fakeSession, progressAt } from '../test/fake-session';
import { type AppStateLike, type FollowOptions, createMapBinding } from './map-binding';
import { createRoutesStore } from './routes-store';

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;
const T0 = 1_700_000_000_000;

function setup(follow?: boolean | FollowOptions, appStateStatus: AppStateLike['currentState'] = 'active') {
  const easeTo = vi.fn();
  const camera = {
    current: { easeTo, flyTo: vi.fn(), fitBounds: vi.fn() },
  } as unknown as RefObject<CameraRef | null>;
  const store = createRoutesStore();
  const appState: AppStateLike = {
    currentState: appStateStatus,
    addEventListener: () => ({ remove: () => {} }),
  };
  const s = fakeSession({ response });
  const binding = createMapBinding({
    camera,
    store,
    appState,
    createDefaultSession: () => s.session,
  });
  if (follow !== undefined) binding.setFollow(follow);
  binding.attach(s.session);
  const puckBearing = (): number | undefined => {
    const puck = store
      .getSnapshot()
      .features.features.find((f) => f.properties.kind === 'puck');
    return puck && puck.properties.kind === 'puck' ? puck.properties.bearing : undefined;
  };
  const lastEase = () => easeTo.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
  return { easeTo, store, s, binding, puckBearing, lastEase };
}
const at = (i: number, ts: number, speed_mps: number): NavigationProgress => ({
  ...progressAt(route, i, ts),
  fix: { lng: 106.6985, lat: 10.7791, timestamp: ts, speed_mps },
});
const slow = (i: number, ts = T0) => at(i, ts, 0);
const fast = (i: number, ts = T0) => at(i, ts, 8);
const heading = (h: number, ts = T0, accuracy: HeadingFix['accuracy'] = 'high'): HeadingFix => ({
  heading: h,
  accuracy,
  timestamp: ts,
  source: 'fused',
});

describe('createMapBinding — la bàn', () => {
  it('đứng yên: mẫu la bàn xoay puck, camera KHÔNG xoay theo mặc định', () => {
    const { s, puckBearing, easeTo, lastEase } = setup();
    s.progress(slow(5));
    expect(puckBearing()).toBe(45);
    expect(easeTo).toHaveBeenCalledTimes(1);
    expect(lastEase()?.bearing).toBe(45);
    s.heading(heading(200));
    expect(puckBearing()).toBe(200);
    expect(easeTo).toHaveBeenCalledTimes(1);
  });

  it('đang chạy (> 1 m/s): la bàn không đổi puck; unreliable bị bỏ kể cả khi đứng yên', () => {
    const a = setup();
    a.s.progress(fast(5));
    a.s.heading(heading(200));
    expect(a.puckBearing()).toBe(45);
    const b = setup();
    b.s.progress(slow(5));
    b.s.heading(heading(200, T0, 'unreliable'));
    expect(b.puckBearing()).toBe(45);
  });

  it('fix mới khi đứng yên giữ hướng la bàn còn tươi (≤ 2 s), bỏ khi cũ', () => {
    const { s, puckBearing } = setup();
    s.heading(heading(200, T0));
    s.progress(slow(6, T0 + 500));
    expect(puckBearing()).toBe(200);
    s.progress(slow(7, T0 + 3000));
    expect(puckBearing()).toBe(45);
  });

  it("bearing 'heading': camera xoay theo la bàn, throttle 250 ms / 2°, fix sau dùng la bàn tươi", () => {
    const { s, easeTo, lastEase } = setup({ bearing: 'heading' });
    s.progress(slow(5, T0));
    expect(easeTo).toHaveBeenCalledTimes(1); // chưa có la bàn → bearing tuyến
    s.heading(heading(100, T0 + 100));
    expect(easeTo).toHaveBeenCalledTimes(2);
    expect(lastEase()).toMatchObject({ bearing: 100, center: [106.6985, 10.7791], duration: 250 });
    s.heading(heading(101, T0 + 200)); // < 250 ms
    expect(easeTo).toHaveBeenCalledTimes(2);
    s.heading(heading(150, T0 + 400)); // 300 ms, 50°
    expect(easeTo).toHaveBeenCalledTimes(3);
    s.heading(heading(151, T0 + 700)); // 300 ms nhưng chỉ 1°
    expect(easeTo).toHaveBeenCalledTimes(3);
    s.progress(fast(8, T0 + 1000)); // đang chạy, la bàn tươi → camera vẫn theo la bàn 151
    expect(easeTo).toHaveBeenCalledTimes(4);
    expect(lastEase()?.bearing).toBe(151);
  });

  it('không active hoặc đã kéo tay: la bàn vẫn xoay puck nhưng không đụng camera', () => {
    const bg = setup({ bearing: 'heading' }, 'background');
    bg.s.progress(slow(5));
    bg.s.heading(heading(100, T0 + 300));
    expect(bg.puckBearing()).toBe(100);
    expect(bg.easeTo).not.toHaveBeenCalled();
    const dragged = setup({ bearing: 'heading' });
    dragged.s.progress(slow(5));
    dragged.binding.userGesture();
    dragged.s.heading(heading(100, T0 + 300));
    expect(dragged.puckBearing()).toBe(100);
    expect(dragged.easeTo).toHaveBeenCalledTimes(1);
  });

  it('gỡ phiên xoá hướng đã nhớ; headingUnavailable phát lại cho listener của binding', () => {
    const { s, binding, puckBearing } = setup();
    s.heading(heading(200, T0));
    binding.attach(null);
    binding.attach(s.session);
    s.progress(slow(5, T0 + 100));
    expect(puckBearing()).toBe(45);
    const onErr = vi.fn();
    binding.api.on('headingUnavailable', onErr);
    s.emit('headingUnavailable', { code: 'unavailable', message: 'x' });
    expect(onErr).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/react-native/src/navigation/map-binding.test.ts`
Expected: FAIL — puck vẫn 45 sau mẫu la bàn; `setFollow({ bearing })` lỗi kiểu.

- [x] **Step 3: Viết lại `map-binding.ts`**

```ts
// packages/react-native/src/navigation/map-binding.ts
import type { CameraRef, ViewPadding } from '@maplibre/maplibre-react-native';
import {
  type HeadingFix,
  MOVING_SPEED_MPS,
  type NavigationProgress,
  type NavigationStatus,
  type TravelMode,
  angleDiffDeg,
} from '@mapslibvn/core';
import type { RefObject } from 'react';
import type { RoutesStore } from './routes-store';
import type { NavigationSession, NavigationSessionStartOptions, SessionEvents } from './session';

export interface FollowOptions {
  /** Mặc định theo phương tiện: walk 17, motorbike 16,5, car 15,5. */
  zoom?: number;
  /** Mặc định 45. */
  pitch?: number;
  padding?: ViewPadding;
  /**
   * 'route' (mặc định): camera theo hướng đi/tuyến. 'heading': theo la bàn của phiên (spec la bàn
   * 5.4) — hợp đi bộ; đi xe dễ chóng mặt.
   */
  bearing?: 'route' | 'heading';
}

export const FOLLOW_ZOOM: Readonly<Record<TravelMode, number>> = {
  walk: 17,
  motorbike: 16.5,
  car: 15.5,
};
export const FOLLOW_PITCH = 45;
/** Hướng la bàn cách fix GPS quá ngần này thì không dùng cho puck/camera. */
export const HEADING_FRESH_MS = 2000;
/** Camera theo la bàn cập nhật thưa hơn puck: cách ≥ 250 ms và đổi ≥ 2°. */
export const CAMERA_BEARING_MIN_MS = 250;
export const CAMERA_BEARING_MIN_DEG = 2;

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
  'heading',
  'headingUnavailable',
] as const;

type Listener = (e: never) => void;

interface FollowState {
  zoom?: number;
  pitch: number;
  padding?: ViewPadding;
  bearing: 'route' | 'heading';
}

export function createMapBinding(deps: MapBindingDeps): MapBinding {
  const listeners = new Map<string, Set<Listener>>();
  const emit = <K extends keyof BindingEvents>(event: K, e: BindingEvents[K]): void => {
    for (const fn of listeners.get(event) ?? []) (fn as (e: BindingEvents[K]) => void)(e);
  };

  let explicit: NavigationSession | null = null;
  let fallback: NavigationSession | null = null;
  let attached: NavigationSession | null = null;
  let detachFns: (() => void)[] = [];
  let follow: FollowState | null = { pitch: FOLLOW_PITCH, bearing: 'route' };
  let following = true;
  let lastFixTs: number | null = null;
  let lastHeading: HeadingFix | null = null;
  let lastCameraBearing: { value: number; at: number } | null = null;

  const stationary = (p: NavigationProgress): boolean =>
    (p.fix.speed_mps ?? 0) <= MOVING_SPEED_MPS;
  /** Hướng la bàn dùng được tại thời điểm `at`: không unreliable và còn tươi. */
  const usableHeading = (at: number): HeadingFix | null =>
    lastHeading &&
    lastHeading.accuracy !== 'unreliable' &&
    Math.abs(at - lastHeading.timestamp) <= HEADING_FRESH_MS
      ? lastHeading
      : null;
  const cameraZoom = (p: NavigationProgress, f: FollowState): number =>
    f.zoom ?? FOLLOW_ZOOM[p.route.mode];

  const camera = (p: NavigationProgress, bearing: number): void => {
    if (!follow || !following || deps.appState.currentState !== 'active') return;
    const dt = lastFixTs === null ? 500 : p.fix.timestamp - lastFixTs;
    lastFixTs = p.fix.timestamp;
    deps.camera.current?.easeTo({
      center: p.snapped,
      bearing,
      zoom: cameraZoom(p, follow),
      pitch: follow.pitch,
      duration: Math.max(0, Math.min(1000, dt)),
      ...(follow.padding ? { padding: follow.padding } : {}),
    });
  };
  /** Mỗi fix GPS: puck theo la bàn nếu đứng yên và la bàn tươi; camera theo tuyến trừ khi app chọn 'heading'. */
  const paint = (p: NavigationProgress): void => {
    const h = usableHeading(p.fix.timestamp);
    deps.store.setProgress({
      shapeIndex: p.shapeIndex,
      snapped: p.snapped,
      bearing: h && stationary(p) ? h.heading : p.bearing,
    });
    camera(p, h && follow?.bearing === 'heading' ? h.heading : p.bearing);
  };
  /** Mỗi mẫu la bàn: đứng yên → puck xoay ngay; follow.bearing 'heading' → camera xoay (thưa). */
  const onHeading = (h: HeadingFix): void => {
    lastHeading = h;
    const p = attached?.state;
    if (!p || h.accuracy === 'unreliable') return;
    if (stationary(p)) {
      deps.store.setProgress({ shapeIndex: p.shapeIndex, snapped: p.snapped, bearing: h.heading });
    }
    if (!follow || follow.bearing !== 'heading' || !following) return;
    if (deps.appState.currentState !== 'active') return;
    const prev = lastCameraBearing;
    if (
      prev &&
      (h.timestamp - prev.at < CAMERA_BEARING_MIN_MS ||
        angleDiffDeg(h.heading, prev.value) < CAMERA_BEARING_MIN_DEG)
    ) {
      return;
    }
    lastCameraBearing = { value: h.heading, at: h.timestamp };
    deps.camera.current?.easeTo({
      center: p.snapped,
      bearing: h.heading,
      zoom: cameraZoom(p, follow),
      pitch: follow.pitch,
      duration: CAMERA_BEARING_MIN_MS,
      ...(follow.padding ? { padding: follow.padding } : {}),
    });
  };

  const detach = (): void => {
    for (const fn of detachFns) fn();
    detachFns = [];
    attached = null;
    lastFixTs = null;
    lastHeading = null;
    lastCameraBearing = null;
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
    // Một handler mỗi sự kiện: vẽ (route/progress/heading) rồi phát lại cho listener của binding.
    for (const name of SESSION_EVENTS) {
      on(name, (e) => {
        if (name === 'progress') paint(e as NavigationProgress);
        else if (name === 'route') {
          const r = e as SessionEvents['route'];
          deps.store.show(r.response, { active: r.routeIndex });
        } else if (name === 'heading') onHeading(e as HeadingFix);
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
    if (p) camera(p, p.bearing);
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
      if (p) camera(p, p.bearing);
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
        bearing: o.bearing ?? 'route',
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

- [x] **Step 4: Chạy test xanh (cả test cũ đi qua map)**

Run: `pnpm exec vitest run packages/react-native/src/navigation/map-binding.test.ts packages/react-native/src/map-navigation.test.tsx packages/react-native/src/use-navigation.test.tsx`
Expected: PASS.

- [x] **Step 5: Typecheck gói**

Run: `pnpm --filter @mapslibvn/react-native typecheck`
Expected: không lỗi.

- [x] **Step 6: Commit**

```bash
git add packages/react-native/src/navigation/map-binding.ts packages/react-native/src/navigation/map-binding.test.ts
git commit -m "feat(react-native): puck theo la bàn khi đứng yên, follow.bearing 'heading' cho camera

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Hook `useHeading`

**Files:**
- Create: `packages/react-native/src/use-heading.ts`
- Create: `packages/react-native/src/use-heading.test.tsx`

- [x] **Step 1: Viết test đỏ**

```tsx
// packages/react-native/src/use-heading.test.tsx
// @vitest-environment jsdom
import type { HeadingFix, HeadingSource } from '@mapslibvn/core';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from './test/fake-session';
import { useHeading } from './use-heading';

afterEach(cleanup);
const fix = (heading: number): HeadingFix => ({
  heading,
  accuracy: 'high',
  timestamp: 1_700_000_000_000,
  source: 'compass',
});

describe('useHeading', () => {
  it('HeadingSource: đăng ký khi mount, cập nhật khi có mẫu, huỷ khi unmount', () => {
    let push: ((h: HeadingFix) => void) | null = null;
    const off = vi.fn();
    const source: HeadingSource = {
      subscribe: vi.fn((cb: (h: HeadingFix) => void) => {
        push = cb;
        return off;
      }),
    };
    const { result, unmount } = renderHook(() => useHeading(source));
    expect(result.current).toBeNull();
    expect(source.subscribe).toHaveBeenCalledTimes(1);
    act(() => push?.(fix(90)));
    expect(result.current?.heading).toBe(90);
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('NavigationSession: đọc sự kiện heading; stop (status) cũng re-render về null; unmount gỡ listener', () => {
    const s = fakeSession();
    const { result, unmount } = renderHook(() => useHeading(s.session));
    expect(result.current).toBeNull();
    act(() => s.heading(fix(180)));
    expect(result.current?.heading).toBe(180);
    act(() => {
      s.heading(null);
      s.status('idle');
    });
    expect(result.current).toBeNull();
    unmount();
    expect(s.handlerCount('heading')).toBe(0);
    expect(s.handlerCount('status')).toBe(0);
  });
});
```

- [x] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/react-native/src/use-heading.test.tsx`
Expected: FAIL — không resolve được `./use-heading`.

- [x] **Step 3: Viết hook**

```ts
// packages/react-native/src/use-heading.ts
import type { HeadingFix, HeadingSource } from '@mapslibvn/core';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { NavigationSession } from './navigation/session';

const noop = (): void => {};
const isSession = (t: HeadingSource | NavigationSession): t is NavigationSession => 'start' in t;

/**
 * Hướng la bàn hiện hành (spec la bàn 5.2).
 * - Truyền `NavigationSession` → đọc sự kiện `heading` của phiên (phiên tự đăng ký nguồn lúc start,
 *   về null khi stop).
 * - Truyền `HeadingSource` → hook tự đăng ký theo vòng đời component; dùng ở màn không dẫn đường
 *   (la bàn riêng, xoay icon tài xế). Giữ tham chiếu source ổn định (cấp module hoặc useMemo).
 */
export function useHeading(target: HeadingSource | NavigationSession): HeadingFix | null {
  const session = isSession(target) ? target : null;
  const source = isSession(target) ? null : target;

  const subscribeSession = useCallback(
    (onChange: () => void) => {
      if (!session) return noop;
      session.on('heading', onChange);
      session.on('status', onChange);
      return () => {
        session.off('heading', onChange);
        session.off('status', onChange);
      };
    },
    [session],
  );
  const fromSession = useSyncExternalStore(
    subscribeSession,
    () => session?.heading ?? null,
    () => session?.heading ?? null,
  );

  const [fromSource, setFromSource] = useState<HeadingFix | null>(null);
  useEffect(() => {
    if (!source) return;
    setFromSource(null);
    const off = source.subscribe((h) => setFromSource(h));
    return () => {
      off();
    };
  }, [source]);

  return session ? fromSession : fromSource;
}
```

- [x] **Step 4: Chạy test xanh**

Run: `pnpm exec vitest run packages/react-native/src/use-heading.test.tsx`
Expected: PASS 2 test.

- [x] **Step 5: Commit**

```bash
git add packages/react-native/src/use-heading.ts packages/react-native/src/use-heading.test.tsx
git commit -m "feat(react-native): hook useHeading đọc hướng từ HeadingSource hoặc phiên

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Chấm xanh — feature thuần và store

**Files:**
- Create: `packages/react-native/src/user-location/feature.ts`
- Create: `packages/react-native/src/user-location/feature.test.ts`
- Create: `packages/react-native/src/user-location/store.ts`
- Create: `packages/react-native/src/user-location/store.test.ts`

- [x] **Step 1: Viết test đỏ cho feature**

```ts
// packages/react-native/src/user-location/feature.test.ts
import type { GeoFix, HeadingFix } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_USER_ACCURACY_M,
  accuracyRadiusExpression,
  metersPerPixel,
  userLocationFeature,
} from './feature';

const fix: GeoFix = { lng: 106.7, lat: 10.78, accuracy_m: 12, timestamp: 1 };
const heading: HeadingFix = { heading: 90, accuracy: 'high', timestamp: 1, source: 'fused' };

describe('userLocationFeature', () => {
  it('một Point có bearing/hasHeading/hasReliableHeading/accuracy_m', () => {
    const fc = userLocationFeature(fix, heading);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [106.7, 10.78] });
    expect(fc.features[0]?.properties).toEqual({
      kind: 'user',
      bearing: 90,
      hasHeading: true,
      hasReliableHeading: true,
      accuracy_m: 12,
    });
  });
  it('không heading → bearing 0, hasHeading false; unreliable → hasReliableHeading false; thiếu sai số → mặc định', () => {
    const a = userLocationFeature({ lng: 1, lat: 2, timestamp: 1 }, null);
    expect(a.features[0]?.properties).toMatchObject({
      bearing: 0,
      hasHeading: false,
      hasReliableHeading: false,
      accuracy_m: DEFAULT_USER_ACCURACY_M,
    });
    const b = userLocationFeature(fix, { ...heading, accuracy: 'unreliable' });
    expect(b.features[0]?.properties).toMatchObject({ hasHeading: true, hasReliableHeading: false });
  });
});

describe('metersPerPixel / accuracyRadiusExpression', () => {
  it('Web Mercator tile 512: 78271,517 m/px ở xích đạo zoom 0; giảm nửa mỗi zoom; theo cos(vĩ độ)', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 2);
    expect(metersPerPixel(0, 1)).toBeCloseTo(39135.758, 2);
    expect(metersPerPixel(10.8, 16)).toBeCloseTo(1.1732, 3);
    expect(metersPerPixel(21, 16)).toBeCloseTo(1.115, 3);
  });
  it('expression interpolate exponential base 2 từ zoom 0 tới 24, bán kính px = m / (m/px)', () => {
    const e = accuracyRadiusExpression(50, 10.8) as unknown[];
    expect(e.slice(0, 3)).toEqual(['interpolate', ['exponential', 2], ['zoom']]);
    expect(e[3]).toBe(0);
    expect(e[4]).toBeCloseTo(50 / metersPerPixel(10.8, 0), 9);
    expect(e[5]).toBe(24);
    expect(e[6]).toBeCloseTo(50 / metersPerPixel(10.8, 24), 6);
    expect((e[6] as number) / (e[4] as number)).toBeCloseTo(2 ** 24, 3);
  });
});
```

- [x] **Step 2: Viết test đỏ cho store**

```ts
// packages/react-native/src/user-location/store.test.ts
import type { GeoFix, HeadingFix } from '@mapslibvn/core';
import { describe, expect, it, vi } from 'vitest';
import { createUserLocationStore } from './store';

const fix: GeoFix = { lng: 106.7, lat: 10.78, accuracy_m: 12, timestamp: 1 };
const heading: HeadingFix = { heading: 90, accuracy: 'high', timestamp: 1, source: 'fused' };

describe('createUserLocationStore', () => {
  it('setFix → 1 feature; setHeading → hasHeading; clear → rỗng; listener gọi mỗi lần đổi', () => {
    const store = createUserLocationStore();
    const onChange = vi.fn();
    store.subscribe(onChange);
    expect(store.getSnapshot().features.features).toEqual([]);
    store.setFix(fix);
    expect(store.getSnapshot().fix).toEqual(fix);
    expect(store.getSnapshot().features.features).toHaveLength(1);
    store.setHeading(heading);
    expect(store.getSnapshot().features.features[0]?.properties.hasHeading).toBe(true);
    store.setHeading(null);
    expect(store.getSnapshot().features.features[0]?.properties.hasHeading).toBe(false);
    store.clear();
    expect(store.getSnapshot().fix).toBeNull();
    expect(store.getSnapshot().heading).toBeNull();
    expect(store.getSnapshot().features.features).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('heading trước fix chưa sinh feature; clear khi đã rỗng không báo; snapshot ổn định; unsubscribe', () => {
    const store = createUserLocationStore();
    const onChange = vi.fn();
    const off = store.subscribe(onChange);
    store.setHeading(heading);
    expect(store.getSnapshot().features.features).toEqual([]);
    const a = store.getSnapshot();
    expect(store.getSnapshot()).toBe(a);
    store.clear();
    store.clear();
    expect(onChange).toHaveBeenCalledTimes(2);
    off();
    store.setFix(fix);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
```

- [x] **Step 3: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/react-native/src/user-location/`
Expected: FAIL — không resolve được `./feature`, `./store`.

- [x] **Step 4: Viết `feature.ts`**

```ts
// packages/react-native/src/user-location/feature.ts
import type { CircleLayerSpecification } from '@maplibre/maplibre-react-native';
import type { GeoFix, HeadingFix } from '@mapslibvn/core';

export interface UserLocationProperties {
  kind: 'user';
  /** Độ so với bắc; 0 khi chưa có hướng. */
  bearing: number;
  hasHeading: boolean;
  /** false khi hướng là 'unreliable' → nón vẽ mờ, camera không xoay. */
  hasReliableHeading: boolean;
  accuracy_m: number;
}
export interface UserLocationFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: UserLocationProperties;
}
export interface UserLocationCollection {
  type: 'FeatureCollection';
  features: UserLocationFeature[];
}

export const EMPTY_USER_LOCATION: UserLocationCollection = { type: 'FeatureCollection', features: [] };
/** Sai số dùng khi fix không có accuracy_m — cùng giá trị mặc định của navigator core. */
export const DEFAULT_USER_ACCURACY_M = 10;

/** Feature Point cho chấm xanh (spec la bàn mục 7). Không đột biến đầu vào. */
export function userLocationFeature(fix: GeoFix, heading: HeadingFix | null): UserLocationCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [fix.lng, fix.lat] },
        properties: {
          kind: 'user',
          bearing: heading?.heading ?? 0,
          hasHeading: heading !== null,
          hasReliableHeading: heading !== null && heading.accuracy !== 'unreliable',
          accuracy_m: fix.accuracy_m ?? DEFAULT_USER_ACCURACY_M,
        },
      },
    ],
  };
}

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** Mét trên một pixel ở vĩ độ `lat`, zoom `zoom` — Web Mercator với tile 512 px của MapLibre. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

type CircleRadius = NonNullable<CircleLayerSpecification['paint']>['circle-radius'];

/**
 * `circle-radius` (px) để vòng có bán kính `accuracy_m` thật ở mọi zoom: interpolate exponential
 * base 2 giữa zoom 0 và 24 đúng bằng cách m/px giảm nửa mỗi zoom.
 */
export function accuracyRadiusExpression(accuracy_m: number, lat: number): CircleRadius {
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    0,
    accuracy_m / metersPerPixel(lat, 0),
    24,
    accuracy_m / metersPerPixel(lat, 24),
  ];
}
```

- [x] **Step 5: Viết `store.ts`**

```ts
// packages/react-native/src/user-location/store.ts
import type { GeoFix, HeadingFix } from '@mapslibvn/core';
import { EMPTY_USER_LOCATION, type UserLocationCollection, userLocationFeature } from './feature';

export interface UserLocationSnapshot {
  fix: GeoFix | null;
  heading: HeadingFix | null;
  features: UserLocationCollection;
}

/** Nguồn sự thật cho lớp chấm xanh; `useSyncExternalStore` đọc `getSnapshot` (object mới mỗi lần đổi). */
export interface UserLocationStore {
  getSnapshot(): UserLocationSnapshot;
  subscribe(onChange: () => void): () => void;
  setFix(fix: GeoFix): void;
  setHeading(heading: HeadingFix | null): void;
  clear(): void;
}

export function createUserLocationStore(): UserLocationStore {
  let snapshot: UserLocationSnapshot = { fix: null, heading: null, features: EMPTY_USER_LOCATION };
  const listeners = new Set<() => void>();

  const set = (fix: GeoFix | null, heading: HeadingFix | null): void => {
    snapshot = {
      fix,
      heading,
      features: fix ? userLocationFeature(fix, heading) : EMPTY_USER_LOCATION,
    };
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
    setFix: (fix) => set(fix, snapshot.heading),
    setHeading: (heading) => set(snapshot.fix, heading),
    clear() {
      if (snapshot.fix === null && snapshot.heading === null) return;
      set(null, null);
    },
  };
}
```

- [x] **Step 6: Chạy test xanh**

Run: `pnpm exec vitest run packages/react-native/src/user-location/`
Expected: PASS 4 test.

- [x] **Step 7: Commit**

```bash
git add packages/react-native/src/user-location/feature.ts packages/react-native/src/user-location/feature.test.ts packages/react-native/src/user-location/store.ts packages/react-native/src/user-location/store.test.ts
git commit -m "feat(react-native): feature và store cho chấm xanh vị trí người dùng

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Chấm xanh — binding (đăng ký nguồn, bám camera, ẩn khi dẫn đường)

**Files:**
- Create: `packages/react-native/src/user-location/binding.ts`
- Create: `packages/react-native/src/user-location/binding.test.ts`

- [x] **Step 1: Viết test đỏ**

```ts
// packages/react-native/src/user-location/binding.test.ts
import type { CameraRef } from '@maplibre/maplibre-react-native';
import type {
  DirectionsResponse,
  GeoFix,
  HeadingFix,
  HeadingSource,
  PositionSource,
} from '@mapslibvn/core';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import type { AppStateLike, AppStateStatus } from '../navigation/map-binding';
import { createRoutesStore } from '../navigation/routes-store';
import { USER_FOLLOW_ZOOM, type UserLocationOptions, createUserLocationBinding } from './binding';
import { createUserLocationStore } from './store';

const response = fixture as unknown as DirectionsResponse;
const T0 = 1_700_000_000_000;
const fixAt = (ts: number, lng = 106.7): GeoFix => ({ lng, lat: 10.78, accuracy_m: 12, timestamp: ts });
const headingAt = (h: number, ts: number, accuracy: HeadingFix['accuracy'] = 'high'): HeadingFix => ({
  heading: h,
  accuracy,
  timestamp: ts,
  source: 'fused',
});

function fakeSources() {
  let onFix: ((f: GeoFix) => void) | null = null;
  let onHeading: ((h: HeadingFix) => void) | null = null;
  const offFix = vi.fn();
  const offHeading = vi.fn();
  const source: PositionSource = {
    subscribe: vi.fn((cb: (f: GeoFix) => void) => {
      onFix = cb;
      return offFix;
    }),
  };
  const heading: HeadingSource = {
    subscribe: vi.fn((cb: (h: HeadingFix) => void) => {
      onHeading = cb;
      return offHeading;
    }),
  };
  return {
    source,
    heading,
    offFix,
    offHeading,
    pushFix: (f: GeoFix) => onFix?.(f),
    pushHeading: (h: HeadingFix) => onHeading?.(h),
  };
}

function setup(opts: Omit<UserLocationOptions, 'source' | 'heading'> & { withHeading?: boolean } = {}) {
  const easeTo = vi.fn();
  const camera = { current: { easeTo } } as unknown as RefObject<CameraRef | null>;
  const store = createUserLocationStore();
  const routesStore = createRoutesStore();
  const appListeners = new Set<(s: AppStateStatus) => void>();
  const appState: AppStateLike & { set(s: AppStateStatus): void } = {
    currentState: 'active',
    addEventListener: (_t, cb) => {
      appListeners.add(cb);
      return { remove: () => appListeners.delete(cb) };
    },
    set(s) {
      appState.currentState = s;
      for (const fn of appListeners) fn(s);
    },
  };
  const src = fakeSources();
  const binding = createUserLocationBinding({ camera, store, routesStore, appState });
  const { withHeading, ...rest } = opts;
  const options: UserLocationOptions = {
    source: src.source,
    ...(withHeading ? { heading: src.heading } : {}),
    ...rest,
  };
  binding.setOptions(options);
  const lastEase = () => easeTo.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
  return { easeTo, lastEase, store, routesStore, appState, src, binding, options };
}

describe('createUserLocationBinding', () => {
  it("đăng ký cả hai nguồn; follow 'none' không đụng camera; api đọc fix/heading; following false", () => {
    const { src, store, binding, easeTo } = setup({ withHeading: true });
    expect(src.source.subscribe).toHaveBeenCalledTimes(1);
    expect(src.heading.subscribe).toHaveBeenCalledTimes(1);
    src.pushFix(fixAt(T0));
    src.pushHeading(headingAt(90, T0));
    expect(store.getSnapshot().features.features[0]?.properties).toMatchObject({
      hasHeading: true,
      bearing: 90,
    });
    expect(binding.api.fix?.timestamp).toBe(T0);
    expect(binding.api.heading?.heading).toBe(90);
    expect(binding.api.following).toBe(false);
    expect(easeTo).not.toHaveBeenCalled();
  });

  it("follow 'center': ease mỗi fix (zoom 16, không bearing); kéo tay tắt; recenter bật lại và ease ngay", () => {
    const { src, binding, easeTo, lastEase } = setup({ follow: 'center' });
    const changes: boolean[] = [];
    binding.api.on('followChange', (f) => changes.push(f));
    expect(binding.api.following).toBe(true);
    src.pushFix(fixAt(T0));
    expect(easeTo).toHaveBeenCalledTimes(1);
    expect(lastEase()).toEqual({ center: [106.7, 10.78], zoom: USER_FOLLOW_ZOOM, duration: 500 });
    binding.userGesture();
    expect(binding.api.following).toBe(false);
    src.pushFix(fixAt(T0 + 1000, 106.71));
    expect(easeTo).toHaveBeenCalledTimes(1);
    binding.api.recenter();
    expect(binding.api.following).toBe(true);
    expect(easeTo).toHaveBeenCalledTimes(2);
    expect(lastEase()?.center).toEqual([106.71, 10.78]);
    expect(changes).toEqual([false, true]);
  });

  it("follow 'heading': bearing theo la bàn, throttle 250 ms / 2°, unreliable không xoay", () => {
    const { src, easeTo, lastEase } = setup({ follow: 'heading', withHeading: true, zoom: 17 });
    src.pushFix(fixAt(T0));
    expect(lastEase()).toEqual({ center: [106.7, 10.78], zoom: 17, duration: 500 });
    src.pushHeading(headingAt(100, T0 + 100));
    expect(easeTo).toHaveBeenCalledTimes(2);
    expect(lastEase()).toEqual({ center: [106.7, 10.78], zoom: 17, bearing: 100, duration: 250 });
    src.pushHeading(headingAt(101, T0 + 200)); // quá sớm
    src.pushHeading(headingAt(150, T0 + 400)); // 300 ms, 50°
    src.pushHeading(headingAt(151, T0 + 700)); // chỉ 1°
    expect(easeTo).toHaveBeenCalledTimes(3);
    src.pushHeading(headingAt(30, T0 + 1000, 'unreliable'));
    expect(easeTo).toHaveBeenCalledTimes(3);
    // La bàn cuối không đáng tin → fix mới KHÔNG ép bearing; easeTo không có bearing nên camera giữ
    // hướng hiện tại (không quay về bắc). dt = 1500 → clamp 1000.
    src.pushFix(fixAt(T0 + 1500));
    expect(easeTo).toHaveBeenCalledTimes(4);
    expect(lastEase()).toEqual({ center: [106.7, 10.78], zoom: 17, duration: 1000 });
  });

  it('dẫn đường có tiến độ → ẩn: huỷ hai nguồn, xoá store, api null; hết tiến độ → đăng ký lại', () => {
    const { src, store, routesStore, binding } = setup({ withHeading: true });
    src.pushFix(fixAt(T0));
    routesStore.show(response);
    expect(src.offFix).not.toHaveBeenCalled(); // chỉ có tuyến, chưa có tiến độ → vẫn hiện
    routesStore.setProgress({ shapeIndex: 3, snapped: [106.69, 10.77], bearing: 10 });
    expect(src.offFix).toHaveBeenCalledTimes(1);
    expect(src.offHeading).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().fix).toBeNull();
    expect(binding.api.fix).toBeNull();
    routesStore.clear();
    expect(src.source.subscribe).toHaveBeenCalledTimes(2);
    expect(src.heading.subscribe).toHaveBeenCalledTimes(2);
  });

  it('setOptions cùng tham chiếu không đăng ký lại; đổi heading đăng ký lại; null huỷ hết; dispose', () => {
    const { src, binding, options, routesStore } = setup();
    binding.setOptions({ ...options, follow: 'center' });
    expect(src.source.subscribe).toHaveBeenCalledTimes(1);
    binding.setOptions({ ...options, heading: src.heading });
    expect(src.offFix).toHaveBeenCalledTimes(1);
    expect(src.source.subscribe).toHaveBeenCalledTimes(2);
    expect(src.heading.subscribe).toHaveBeenCalledTimes(1);
    binding.setOptions(null);
    expect(src.offFix).toHaveBeenCalledTimes(2);
    expect(src.offHeading).toHaveBeenCalledTimes(1);
    binding.setOptions(options);
    binding.dispose();
    expect(src.offFix).toHaveBeenCalledTimes(3);
    routesStore.show(response); // sau dispose không còn nghe routesStore → không ném
  });

  it('app không active: fix không ease; active lại → ease về fix cuối', () => {
    const { src, appState, easeTo } = setup({ follow: 'center' });
    appState.set('background');
    src.pushFix(fixAt(T0));
    expect(easeTo).not.toHaveBeenCalled();
    appState.set('active');
    expect(easeTo).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/react-native/src/user-location/binding.test.ts`
Expected: FAIL — không resolve được `./binding`.

- [x] **Step 3: Viết `binding.ts`**

```ts
// packages/react-native/src/user-location/binding.ts
import type { CameraRef } from '@maplibre/maplibre-react-native';
import {
  type GeoFix,
  type HeadingFix,
  type HeadingSource,
  type PositionSource,
  angleDiffDeg,
} from '@mapslibvn/core';
import type { RefObject } from 'react';
import type { AppStateLike } from '../navigation/map-binding';
import type { RoutesStore } from '../navigation/routes-store';
import type { UserLocationStore } from './store';

export interface UserLocationOptions {
  /** Vị trí tiền cảnh — thường `expoLocationSource({ background: false })`. Giữ tham chiếu ổn định. */
  source: PositionSource;
  /** Có → nón hướng; với follow 'heading' camera xoay theo. Giữ tham chiếu ổn định. */
  heading?: HeadingSource;
  /** Mặc định 'none'. 'center' bám tâm; 'heading' bám tâm và xoay theo la bàn. */
  follow?: 'none' | 'center' | 'heading';
  /** Zoom khi bám — mặc định 16. */
  zoom?: number;
  /** Vòng sai số — mặc định true (đọc ở lớp vẽ, không phải ở binding). */
  accuracyCircle?: boolean;
}

/** Thứ lộ ra qua `useMap().userLocation`. */
export interface UserLocationHandle {
  /** true khi có prop, follow ≠ 'none' và người dùng chưa kéo bản đồ. */
  readonly following: boolean;
  /** Fix/hướng SDK đang vẽ; null khi không bật hoặc đang ẩn vì dẫn đường. */
  readonly fix: GeoFix | null;
  readonly heading: HeadingFix | null;
  /** Bật lại bám và ease ngay tới fix cuối; no-op khi follow 'none'. */
  recenter(): void;
  on(event: 'followChange', handler: (following: boolean) => void): void;
  off(event: 'followChange', handler: (following: boolean) => void): void;
}

export interface UserLocationBindingDeps {
  camera: RefObject<CameraRef | null>;
  store: UserLocationStore;
  /** Có tiến độ dẫn đường → chấm xanh ẩn và ngừng nghe nguồn (spec la bàn 5.5). */
  routesStore: RoutesStore;
  appState: AppStateLike;
}

export interface UserLocationBinding {
  readonly api: UserLocationHandle;
  /** null = gỡ. Cùng tham chiếu source/heading → không đăng ký lại. */
  setOptions(opts: UserLocationOptions | null): void;
  userGesture(): void;
  dispose(): void;
}

export const USER_FOLLOW_ZOOM = 16;
const CAMERA_BEARING_MIN_MS = 250;
const CAMERA_BEARING_MIN_DEG = 2;

export function createUserLocationBinding(deps: UserLocationBindingDeps): UserLocationBinding {
  const listeners = new Set<(following: boolean) => void>();
  let options: UserLocationOptions | null = null;
  let wantFollow = true;
  let offFix: (() => void) | null = null;
  let offHeading: (() => void) | null = null;
  let subscribedTo: { source: PositionSource; heading: HeadingSource | undefined } | null = null;
  let lastFixTs: number | null = null;
  let lastCameraBearing: { value: number; at: number } | null = null;

  const followMode = (): 'none' | 'center' | 'heading' => options?.follow ?? 'none';
  const isFollowing = (): boolean => options !== null && followMode() !== 'none' && wantFollow;
  const visible = (): boolean => options !== null && deps.routesStore.getSnapshot().progress === null;
  const emitFollow = (f: boolean): void => {
    for (const fn of listeners) fn(f);
  };
  const reliableHeading = (): HeadingFix | null => {
    const h = deps.store.getSnapshot().heading;
    return h && h.accuracy !== 'unreliable' ? h : null;
  };

  const ease = (center: [number, number], bearing: number | null, duration: number): void => {
    if (!options || !isFollowing() || deps.appState.currentState !== 'active') return;
    deps.camera.current?.easeTo({
      center,
      zoom: options.zoom ?? USER_FOLLOW_ZOOM,
      ...(bearing !== null ? { bearing } : {}),
      duration,
    });
  };
  const onFix = (fix: GeoFix): void => {
    deps.store.setFix(fix);
    const dt = lastFixTs === null ? 500 : fix.timestamp - lastFixTs;
    lastFixTs = fix.timestamp;
    const h = followMode() === 'heading' ? reliableHeading() : null;
    ease([fix.lng, fix.lat], h ? h.heading : null, Math.max(0, Math.min(1000, dt)));
  };
  const onHeading = (h: HeadingFix): void => {
    deps.store.setHeading(h);
    if (followMode() !== 'heading' || h.accuracy === 'unreliable') return;
    const fix = deps.store.getSnapshot().fix;
    if (!fix) return;
    const prev = lastCameraBearing;
    if (
      prev &&
      (h.timestamp - prev.at < CAMERA_BEARING_MIN_MS ||
        angleDiffDeg(h.heading, prev.value) < CAMERA_BEARING_MIN_DEG)
    ) {
      return;
    }
    lastCameraBearing = { value: h.heading, at: h.timestamp };
    ease([fix.lng, fix.lat], h.heading, CAMERA_BEARING_MIN_MS);
  };

  const unsubscribeAll = (): void => {
    offFix?.();
    offFix = null;
    offHeading?.();
    offHeading = null;
    subscribedTo = null;
    lastFixTs = null;
    lastCameraBearing = null;
  };
  /** Đăng ký đúng khi visible; huỷ khi ẩn (dẫn đường có tiến độ) hoặc gỡ options. */
  const sync = (): void => {
    if (!options || !visible()) {
      if (subscribedTo) {
        unsubscribeAll();
        deps.store.clear();
      }
      return;
    }
    const { source, heading } = options;
    if (subscribedTo && subscribedTo.source === source && subscribedTo.heading === heading) return;
    unsubscribeAll();
    deps.store.clear();
    subscribedTo = { source, heading };
    offFix = source.subscribe(onFix);
    offHeading = heading ? heading.subscribe(onHeading) : null;
  };

  const offRoutes = deps.routesStore.subscribe(sync);
  const appSub = deps.appState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    const fix = deps.store.getSnapshot().fix;
    if (!fix) return;
    const h = followMode() === 'heading' ? reliableHeading() : null;
    ease([fix.lng, fix.lat], h ? h.heading : null, 300);
  });

  const api: UserLocationHandle = {
    get following() {
      return isFollowing();
    },
    get fix() {
      return visible() ? deps.store.getSnapshot().fix : null;
    },
    get heading() {
      return visible() ? deps.store.getSnapshot().heading : null;
    },
    recenter() {
      if (!options || followMode() === 'none') return;
      wantFollow = true;
      emitFollow(true);
      const fix = deps.store.getSnapshot().fix;
      if (!fix) return;
      const h = followMode() === 'heading' ? reliableHeading() : null;
      ease([fix.lng, fix.lat], h ? h.heading : null, 300);
    },
    on(_event, handler) {
      listeners.add(handler);
    },
    off(_event, handler) {
      listeners.delete(handler);
    },
  };

  return {
    api,
    setOptions(next) {
      options = next;
      if (next && (next.follow ?? 'none') !== 'none') wantFollow = true;
      sync();
    },
    userGesture() {
      if (!isFollowing()) return;
      wantFollow = false;
      emitFollow(false);
    },
    dispose() {
      unsubscribeAll();
      offRoutes();
      appSub.remove();
      listeners.clear();
      options = null;
    },
  };
}
```

- [x] **Step 4: Chạy test xanh**

Run: `pnpm exec vitest run packages/react-native/src/user-location/binding.test.ts`
Expected: PASS 6 test.

- [x] **Step 5: Commit**

```bash
git add packages/react-native/src/user-location/binding.ts packages/react-native/src/user-location/binding.test.ts
git commit -m "feat(react-native): binding chấm xanh — đăng ký nguồn theo hiển thị, bám camera, recenter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Chấm xanh — lớp vẽ

**Files:**
- Create: `packages/react-native/src/user-location/layers.tsx`
- Create: `packages/react-native/src/user-location/layers.test.tsx`

- [x] **Step 1: Viết test đỏ**

```tsx
// packages/react-native/src/user-location/layers.test.tsx
// @vitest-environment jsdom
import type { DirectionsResponse, GeoFix, HeadingFix } from '@mapslibvn/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import { HEADING_CONE_IMAGE_KEY } from '../navigation/puck-image';
import { createRoutesStore } from '../navigation/routes-store';
import { USER_LOCATION_LAYER_IDS, USER_LOCATION_SOURCE_ID, UserLocationLayers } from './layers';
import { createUserLocationStore } from './store';

vi.mock('react-native', () => import('../test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('../test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const fix: GeoFix = { lng: 106.7, lat: 10.78, accuracy_m: 25, timestamp: 1 };
const heading: HeadingFix = { heading: 90, accuracy: 'high', timestamp: 1, source: 'fused' };
const layer = (id: string) =>
  JSON.parse(screen.getByTestId(`mlrn-layer-${id}`).dataset.layer ?? '{}') as Record<string, unknown>;

afterEach(cleanup);

describe('<UserLocationLayers>', () => {
  it('không fix → null; có fix → Images nón + source + 3 lớp theo thứ tự accuracy, cone, dot', () => {
    const store = createUserLocationStore();
    const routes = createRoutesStore();
    const { container, rerender } = render(
      <UserLocationLayers store={store} routesStore={routes} accuracyCircle beforeId="poi" />,
    );
    expect(container.innerHTML).toBe('');
    store.setFix(fix);
    store.setHeading(heading);
    rerender(<UserLocationLayers store={store} routesStore={routes} accuracyCircle beforeId="poi" />);
    expect(screen.getByTestId('mlrn-images').dataset.keys).toBe(HEADING_CONE_IMAGE_KEY);
    const geo = JSON.parse(
      screen.getByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`).dataset.geojson ?? '{}',
    ) as { features: { properties: { bearing: number } }[] };
    expect(geo.features[0]?.properties.bearing).toBe(90);
    const ids = [...container.querySelectorAll('[data-testid^="mlrn-layer-"]')].map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(ids).toEqual([
      `mlrn-layer-${USER_LOCATION_LAYER_IDS.accuracy}`,
      `mlrn-layer-${USER_LOCATION_LAYER_IDS.cone}`,
      `mlrn-layer-${USER_LOCATION_LAYER_IDS.dot}`,
    ]);
    expect(layer(USER_LOCATION_LAYER_IDS.dot).beforeId).toBe('poi');
    const cone = layer(USER_LOCATION_LAYER_IDS.cone) as { layout: Record<string, unknown>; paint: Record<string, unknown>; filter: unknown };
    expect(cone.layout['icon-image']).toBe(HEADING_CONE_IMAGE_KEY);
    expect(cone.layout['icon-rotate']).toEqual(['get', 'bearing']);
    expect(cone.paint['icon-opacity']).toEqual(['case', ['get', 'hasReliableHeading'], 1, 0.45]);
    expect(cone.filter).toEqual(['==', ['get', 'hasHeading'], true]);
    const acc = layer(USER_LOCATION_LAYER_IDS.accuracy) as { paint: { 'circle-radius': unknown[] } };
    expect(acc.paint['circle-radius'].slice(0, 3)).toEqual(['interpolate', ['exponential', 2], ['zoom']]);
  });

  it('accuracyCircle=false bỏ vòng; dẫn đường có tiến độ → null', () => {
    const store = createUserLocationStore();
    const routes = createRoutesStore();
    store.setFix(fix);
    const { container, rerender } = render(
      <UserLocationLayers store={store} routesStore={routes} accuracyCircle={false} beforeId={null} />,
    );
    expect(screen.queryByTestId(`mlrn-layer-${USER_LOCATION_LAYER_IDS.accuracy}`)).toBeNull();
    expect(screen.getByTestId(`mlrn-layer-${USER_LOCATION_LAYER_IDS.dot}`)).toBeTruthy();
    routes.show(response);
    routes.setProgress({ shapeIndex: 2, snapped: [106.69, 10.77], bearing: 0 });
    rerender(
      <UserLocationLayers store={store} routesStore={routes} accuracyCircle={false} beforeId={null} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
```

- [x] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/react-native/src/user-location/layers.test.tsx`
Expected: FAIL — không resolve được `./layers`.

- [x] **Step 3: Viết `layers.tsx`**

```tsx
// packages/react-native/src/user-location/layers.tsx
import {
  type CircleLayerSpecification,
  type FilterSpecification,
  GeoJSONSource,
  Images,
  Layer,
  type SymbolLayerSpecification,
} from '@maplibre/maplibre-react-native';
import { useSyncExternalStore } from 'react';
import { HEADING_CONE_IMAGE_KEY, HEADING_CONE_PNG_DATA_URI } from '../navigation/puck-image';
import { ROUTE_COLOR } from '../navigation/route-layers';
import type { RoutesStore } from '../navigation/routes-store';
import { DEFAULT_USER_ACCURACY_M, accuracyRadiusExpression } from './feature';
import type { UserLocationStore } from './store';

export const USER_LOCATION_SOURCE_ID = 'mapslibvn-user-location';
export const USER_LOCATION_LAYER_IDS = {
  accuracy: 'mapslibvn-user-accuracy',
  cone: 'mapslibvn-user-cone',
  dot: 'mapslibvn-user-dot',
} as const;

const HAS_HEADING: FilterSpecification = ['==', ['get', 'hasHeading'], true];
const CONE_LAYOUT: NonNullable<SymbolLayerSpecification['layout']> = {
  'icon-image': HEADING_CONE_IMAGE_KEY,
  'icon-rotate': ['get', 'bearing'],
  'icon-rotation-alignment': 'map',
  'icon-pitch-alignment': 'map',
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
  // 0,5 như puck (spec la bàn mục 11): nón bán kính ~15 dp quanh chấm 7 dp. Thực địa thấy nhỏ thì
  // nâng lên 0,75 và ghi vào mục lệch spec.
  'icon-size': 0.5,
};
const CONE_PAINT: NonNullable<SymbolLayerSpecification['paint']> = {
  'icon-opacity': ['case', ['get', 'hasReliableHeading'], 1, 0.45],
};
const DOT_PAINT: NonNullable<CircleLayerSpecification['paint']> = {
  'circle-radius': 7,
  'circle-color': ROUTE_COLOR,
  'circle-stroke-color': '#ffffff',
  'circle-stroke-width': 2.5,
};

interface UserLocationLayersProps {
  store: UserLocationStore;
  /** Có tiến độ dẫn đường → không vẽ (puck dẫn đường thay thế). */
  routesStore: RoutesStore;
  accuracyCircle: boolean;
  /** Chèn trước lớp này; null = trên cùng. */
  beforeId: string | null;
}

/** Chấm xanh + nón hướng + vòng sai số (spec la bàn mục 7). Render bên trong <Map>. */
export function UserLocationLayers({
  store,
  routesStore,
  accuracyCircle,
  beforeId,
}: UserLocationLayersProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const routes = useSyncExternalStore(
    routesStore.subscribe,
    routesStore.getSnapshot,
    routesStore.getSnapshot,
  );
  const fix = snap.fix;
  if (!fix || routes.progress !== null) return null;
  const before = beforeId ? { beforeId } : {};
  return (
    <>
      <Images
        images={{ [HEADING_CONE_IMAGE_KEY]: { source: { uri: HEADING_CONE_PNG_DATA_URI } } }}
      />
      <GeoJSONSource id={USER_LOCATION_SOURCE_ID} data={snap.features as GeoJSON.FeatureCollection}>
        {accuracyCircle ? (
          <Layer
            type="circle"
            id={USER_LOCATION_LAYER_IDS.accuracy}
            source={USER_LOCATION_SOURCE_ID}
            paint={{
              'circle-radius': accuracyRadiusExpression(
                fix.accuracy_m ?? DEFAULT_USER_ACCURACY_M,
                fix.lat,
              ),
              'circle-color': ROUTE_COLOR,
              'circle-opacity': 0.12,
              'circle-stroke-width': 0,
            }}
            {...before}
          />
        ) : null}
        <Layer
          type="symbol"
          id={USER_LOCATION_LAYER_IDS.cone}
          source={USER_LOCATION_SOURCE_ID}
          filter={HAS_HEADING}
          layout={CONE_LAYOUT}
          paint={CONE_PAINT}
          {...before}
        />
        <Layer
          type="circle"
          id={USER_LOCATION_LAYER_IDS.dot}
          source={USER_LOCATION_SOURCE_ID}
          paint={DOT_PAINT}
          {...before}
        />
      </GeoJSONSource>
    </>
  );
}
```

- [x] **Step 4: Chạy test xanh + typecheck**

Run: `pnpm exec vitest run packages/react-native/src/user-location/layers.test.tsx && pnpm --filter @mapslibvn/react-native typecheck`
Expected: PASS 2 test; typecheck sạch (nếu `paint` circle báo lỗi kiểu `'circle-radius'`, ép `accuracyRadiusExpression(...)` đã có kiểu `CircleRadius` — kiểm lại import).

- [x] **Step 5: Commit**

```bash
git add packages/react-native/src/user-location/layers.tsx packages/react-native/src/user-location/layers.test.tsx
git commit -m "feat(react-native): lớp vẽ chấm xanh, nón hướng và vòng sai số

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Nối vào `MapsLibVNMap`, `MapHandle`, xuất công khai

**Files:**
- Modify: `packages/react-native/src/context.ts`
- Modify: `packages/react-native/src/map.tsx`
- Modify: `packages/react-native/src/index.ts`
- Create: `packages/react-native/src/map-user-location.test.tsx`

- [x] **Step 1: Viết test đỏ**

```tsx
// packages/react-native/src/map-user-location.test.tsx
// @vitest-environment jsdom
import type {
  DirectionsResponse,
  GeoFix,
  HeadingFix,
  HeadingSource,
  PositionSource,
  Route,
} from '@mapslibvn/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import type { MapHandle } from './context';
import { MapsLibVNMap, type MapsLibVNMapProps } from './map';
import { fakeSession, progressAt } from './test/fake-session';
import { getLastMapProps, resetMocks } from './test/mlrn-mock';
import { USER_LOCATION_LAYER_IDS, USER_LOCATION_SOURCE_ID } from './user-location/layers';

vi.mock('react-native', () => import('./test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('./test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;
const base = { apiKey: 'mlv_live_k', apiBase: 'https://api.test' };
const T0 = 1_700_000_000_000;
const fix: GeoFix = { lng: 106.7, lat: 10.78, accuracy_m: 12, timestamp: T0 };
const hd: HeadingFix = { heading: 90, accuracy: 'high', timestamp: T0, source: 'compass' };

function fakeSources() {
  let onFix: ((f: GeoFix) => void) | null = null;
  let onHeading: ((h: HeadingFix) => void) | null = null;
  const offFix = vi.fn();
  const offHeading = vi.fn();
  const source: PositionSource = {
    subscribe: vi.fn((cb: (f: GeoFix) => void) => {
      onFix = cb;
      return offFix;
    }),
  };
  const heading: HeadingSource = {
    subscribe: vi.fn((cb: (h: HeadingFix) => void) => {
      onHeading = cb;
      return offHeading;
    }),
  };
  return {
    source,
    heading,
    offFix,
    offHeading,
    pushFix: (f: GeoFix) => onFix?.(f),
    pushHeading: (h: HeadingFix) => onHeading?.(h),
  };
}
type MapProps = {
  onDidFinishLoadingStyle: () => void;
  onRegionWillChange: (e: { nativeEvent: { userInteraction: boolean } }) => void;
};
const mapProps = () => getLastMapProps() as unknown as MapProps;
function mount(props: Omit<MapsLibVNMapProps, 'apiKey' | 'apiBase'>) {
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
});

describe('<MapsLibVNMap userLocation>', () => {
  it('không prop: handle.userLocation có sẵn, fix null, following false, không có source chấm xanh', () => {
    const { handle } = mount({});
    expect(handle.userLocation.fix).toBeNull();
    expect(handle.userLocation.following).toBe(false);
    expect(screen.queryByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`)).toBeNull();
  });

  it('có prop: đăng ký nguồn, vẽ lớp khi có fix, nón khi có heading, handle đọc được', () => {
    const s = fakeSources();
    const { handle } = mount({ userLocation: { source: s.source, heading: s.heading } });
    expect(s.source.subscribe).toHaveBeenCalledTimes(1);
    act(() => s.pushFix(fix));
    expect(screen.getByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`mlrn-layer-${USER_LOCATION_LAYER_IDS.dot}`)).toBeTruthy();
    expect(screen.getByTestId(`mlrn-layer-${USER_LOCATION_LAYER_IDS.accuracy}`)).toBeTruthy();
    act(() => s.pushHeading(hd));
    const geo = JSON.parse(
      screen.getByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`).dataset.geojson ?? '{}',
    ) as { features: { properties: { hasHeading: boolean; bearing: number } }[] };
    expect(geo.features[0]?.properties).toMatchObject({ hasHeading: true, bearing: 90 });
    expect(handle.userLocation.fix).toEqual(fix);
    expect(handle.userLocation.heading).toEqual(hd);
  });

  it('kéo bản đồ → following false; recenter → true; dẫn đường có tiến độ → ẩn và huỷ nguồn', () => {
    const s = fakeSources();
    const nav = fakeSession({ response });
    const { handle, rerender } = mount({ userLocation: { source: s.source, follow: 'center' } });
    act(() => s.pushFix(fix));
    expect(handle.userLocation.following).toBe(true);
    act(() => mapProps().onRegionWillChange({ nativeEvent: { userInteraction: true } }));
    expect(handle.userLocation.following).toBe(false);
    act(() => handle.userLocation.recenter());
    expect(handle.userLocation.following).toBe(true);
    rerender(
      <MapsLibVNMap
        {...base}
        userLocation={{ source: s.source, follow: 'center' }}
        navigation={nav.session}
      />,
    );
    act(() => nav.progress(progressAt(route, 5)));
    expect(screen.queryByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`)).toBeNull();
    expect(s.offFix).toHaveBeenCalledTimes(1);
    expect(handle.userLocation.fix).toBeNull();
  });
});
```

- [x] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/react-native/src/map-user-location.test.tsx`
Expected: FAIL — `handle.userLocation` là `undefined`; prop `userLocation` báo lỗi kiểu.

- [x] **Step 3: `context.ts`**

Thêm import và trường:

```ts
import type { UserLocationHandle } from './user-location/binding';
```

Trong `MapHandle`, sau trường `navigation: MapNavigationBinding;` thêm:

```ts
  /** Chấm xanh + nón hướng ngoài dẫn đường (prop `userLocation`); luôn có, `fix` null khi không bật. */
  userLocation: UserLocationHandle;
```

- [x] **Step 4: `map.tsx`**

Thêm import (sau dòng import `use-style`):

```ts
import { type UserLocationOptions, createUserLocationBinding } from './user-location/binding';
import { UserLocationLayers } from './user-location/layers';
import { createUserLocationStore } from './user-location/store';
```

Trong `MapsLibVNMapProps`, sau `puck?: boolean;` thêm:

```ts
  /** Chấm xanh + nón hướng khi KHÔNG dẫn đường (spec la bàn 5.5). Giữ tham chiếu `source`/`heading` ổn định. */
  userLocation?: UserLocationOptions;
```

Trong destructuring của `MapsLibVNMap(...)`, sau `puck = true,` thêm:

```ts
  userLocation,
```

Sau khối `useEffect(() => { store.setPuck(puck); }, [store, puck]);` thêm:

```ts
  const userStore = useMemo(() => createUserLocationStore(), []);
  const userBinding = useMemo(
    () =>
      createUserLocationBinding({ camera, store: userStore, routesStore: store, appState: AppState }),
    [userStore, store],
  );
  useEffect(() => () => userBinding.dispose(), [userBinding]);
  // Chỉ theo tham chiếu source/heading và các giá trị nguyên thuỷ — object `userLocation` inline đổi
  // mỗi render, đưa cả object vào deps sẽ đăng ký lại nguồn liên tục.
  const userSource = userLocation?.source;
  const userHeading = userLocation?.heading;
  const userFollow = userLocation?.follow;
  const userZoom = userLocation?.zoom;
  useEffect(() => {
    userBinding.setOptions(
      userSource
        ? {
            source: userSource,
            ...(userHeading ? { heading: userHeading } : {}),
            ...(userFollow ? { follow: userFollow } : {}),
            ...(userZoom !== undefined ? { zoom: userZoom } : {}),
          }
        : null,
    );
  }, [userBinding, userSource, userHeading, userFollow, userZoom]);
```

Trong `useMemo<MapHandle>`, sau `navigation: binding.api,` thêm `userLocation: userBinding.api,` và đổi deps thành `[places, store, binding, userBinding]`.

Thay hàm `onRegionWillChange`:

```ts
  const onRegionWillChange = (e: NativeSyntheticEvent<ViewStateChangeEvent>): void => {
    if (!e.nativeEvent.userInteraction) return;
    binding.userGesture();
    userBinding.userGesture();
  };
```

Trong JSX, ngay sau `<RouteLayers … />` (trước `{children}`) thêm:

```tsx
            <UserLocationLayers
              store={userStore}
              routesStore={store}
              accuracyCircle={userLocation?.accuracyCircle ?? true}
              beforeId={beforeId}
            />
```

- [x] **Step 5: `index.ts` — xuất mới**

Thêm vào `packages/react-native/src/index.ts` (sau dòng `export { COMPACT_ATTRIBUTION } …`):

```ts
export { useHeading } from './use-heading';
export type { UserLocationHandle, UserLocationOptions } from './user-location/binding';
export { USER_FOLLOW_ZOOM } from './user-location/binding';
export { USER_LOCATION_LAYER_IDS, USER_LOCATION_SOURCE_ID } from './user-location/layers';
export { HEADING_CONE_IMAGE_KEY } from './navigation/puck-image';
export {
  CAMERA_BEARING_MIN_DEG,
  CAMERA_BEARING_MIN_MS,
  HEADING_FRESH_MS,
} from './navigation/map-binding';
```

Trong khối `export { … } from '@mapslibvn/core';` thêm `MOVING_SPEED_MPS, createHeadingFilter, signedDiffDeg, wrapDeg,` (giữ thứ tự chữ cái với Biome: đặt `MOVING_SPEED_MPS` trước `NAVIGATION_THRESHOLDS`, ba hàm xen theo thứ tự `createClient, createHeadingFilter, createNavigator, decodePolyline6, formatDistance, formatDistanceShort, signedDiffDeg, simulateFixes, wrapDeg`).

Trong khối `export type { … } from '@mapslibvn/core';` thêm `CompassSample, HeadingAccuracy, HeadingError, HeadingFilter, HeadingFilterOptions, HeadingFix, HeadingSource, RotationRate` theo thứ tự chữ cái.

- [x] **Step 6: Chạy toàn bộ test RN + typecheck + lint**

Run: `pnpm --filter @mapslibvn/core build && pnpm exec vitest run packages/react-native && pnpm --filter @mapslibvn/react-native typecheck && pnpm lint`
Expected: PASS toàn bộ; typecheck sạch; Biome sạch (Biome sắp lại import/export nếu sai thứ tự — chạy `pnpm exec biome check --write packages/react-native/src/index.ts` rồi kiểm lại).

- [x] **Step 7: Commit**

```bash
git add packages/react-native/src/context.ts packages/react-native/src/map.tsx packages/react-native/src/index.ts packages/react-native/src/map-user-location.test.tsx
git commit -m "feat(react-native): prop userLocation, useMap().userLocation, xuất API la bàn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Entry `/expo` — `expoHeadingSource`, `expoNavigation` kèm heading, đóng gói

**Files:**
- Modify: `packages/react-native/src/expo/expo-modules.d.ts`
- Modify: `packages/react-native/src/expo/modules.ts`
- Create: `packages/react-native/src/expo/heading-source.ts`
- Create: `packages/react-native/src/expo/heading-source.test.ts`
- Modify: `packages/react-native/src/expo/index.ts`
- Create: `packages/react-native/src/expo/index.test.ts`
- Modify: `packages/react-native/tsup.config.ts`
- Modify: `packages/react-native/package.json`

- [x] **Step 1: Kiểu ambient**

Trong `expo-modules.d.ts`, đổi dòng chú thích đầu "năm gói Expo" thành "sáu gói Expo" và thêm `expo-sensors 57.0.3` vào danh sách đối chiếu. Trong `declare module 'expo-location' { … }`, sau hàm `watchPositionAsync` thêm:

```ts
  /** Mẫu la bàn của watchHeadingAsync: iOS CLHeading (đã trộn gyro), Android từ kế + gia tốc kế. */
  export interface LocationHeadingObject {
    /** Độ so với bắc thật; −1 khi chưa có vị trí để tính độ lệch từ. */
    trueHeading: number;
    magHeading: number;
    /** 0 = không tin, 1 thấp, 2 vừa, 3 cao (iOS: sai số > 50° / < 50° / < 35° / < 20°). */
    accuracy: number;
  }
  export function watchHeadingAsync(
    callback: (heading: LocationHeadingObject) => void,
    errorHandler?: (reason: string) => void,
  ): Promise<LocationSubscription>;
```

Cuối file thêm module mới:

```ts
declare module 'expo-sensors' {
  export interface GyroscopeMeasurement {
    /** rad/s theo trục thiết bị (thuận tay phải, Z hướng ra khỏi màn hình). */
    x: number;
    y: number;
    z: number;
    /** GIÂY theo đồng hồ cảm biến — khác miền với Date.now(). */
    timestamp: number;
  }
  export interface SensorSubscription {
    remove(): void;
  }
  export const Gyroscope: {
    setUpdateInterval(intervalMs: number): void;
    addListener(listener: (measurement: GyroscopeMeasurement) => void): SensorSubscription;
    isAvailableAsync(): Promise<boolean>;
  };
}
```

- [x] **Step 2: `modules.ts` thêm `expo-sensors`**

Thay toàn bộ file:

```ts
/// <reference path="./expo-modules.d.ts" />
// Chỗ DUY NHẤT import Expo trong SDK: test mock file này (`vi.mock('./modules')`), tsup để external,
// Metro của app chỉ resolve khi app import `@mapslibvn/react-native/expo`.
import * as Audio from 'expo-audio';
import * as KeepAwake from 'expo-keep-awake';
import * as Location from 'expo-location';
import * as Sensors from 'expo-sensors';
import * as Speech from 'expo-speech';
import * as TaskManager from 'expo-task-manager';

export { Audio, KeepAwake, Location, Sensors, Speech, TaskManager };
```

- [x] **Step 3: Viết test đỏ cho `heading-source`**

```ts
// packages/react-native/src/expo/heading-source.test.ts
import type { HeadingFix } from '@mapslibvn/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  Location: {
    requestForegroundPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
    watchHeadingAsync: vi.fn(async (_cb: unknown, _err?: unknown) => ({ remove: vi.fn() })),
  },
  Gyroscope: {
    isAvailableAsync: vi.fn(async () => true),
    setUpdateInterval: vi.fn(),
    addListener: vi.fn((_cb: unknown) => ({ remove: vi.fn() })),
  },
}));
vi.mock('./modules', () => ({
  Location: mocks.Location,
  Sensors: { Gyroscope: mocks.Gyroscope },
  TaskManager: {},
  Speech: {},
  Audio: {},
  KeepAwake: {},
}));
vi.mock('react-native', () => import('../test/react-native-mock'));

import { setAppState } from '../test/react-native-mock';
import {
  __resetHeadingSourceForTests,
  expoHeadingSource,
  toAccuracy,
  toCompassSample,
} from './heading-source';

type HeadingCb = (h: { trueHeading: number; magHeading: number; accuracy: number }) => void;
type GyroCb = (m: { x: number; y: number; z: number; timestamp: number }) => void;
const headingCb = (i = 0): HeadingCb => mocks.Location.watchHeadingAsync.mock.calls[i]?.[0] as HeadingCb;
const gyroCb = (i = 0): GyroCb => mocks.Gyroscope.addListener.mock.calls[i]?.[0] as GyroCb;
const started = () => vi.waitFor(() => expect(mocks.Location.watchHeadingAsync).toHaveBeenCalled());
const gyroStarted = () =>
  vi.waitFor(() => expect(mocks.Gyroscope.addListener).toHaveBeenCalledTimes(1));

beforeEach(() => {
  __resetHeadingSourceForTests();
  mocks.Location.requestForegroundPermissionsAsync
    .mockReset()
    .mockResolvedValue({ granted: true, status: 'granted' });
  mocks.Location.watchHeadingAsync.mockReset().mockImplementation(async () => ({ remove: vi.fn() }));
  mocks.Gyroscope.isAvailableAsync.mockReset().mockResolvedValue(true);
  mocks.Gyroscope.setUpdateInterval.mockReset();
  mocks.Gyroscope.addListener.mockReset().mockImplementation(() => ({ remove: vi.fn() }));
  setAppState('active');
});

describe('toAccuracy / toCompassSample', () => {
  it('thang 0–3 → mức; trueHeading âm → dùng hướng từ; cả hai hỏng → null', () => {
    expect([0, 1, 2, 3, 7, -1, Number.NaN].map(toAccuracy)).toEqual([
      'unreliable',
      'low',
      'medium',
      'high',
      'high',
      'unreliable',
      'unreliable',
    ]);
    expect(toCompassSample({ trueHeading: 10, magHeading: 12, accuracy: 3 }, 5)).toEqual({
      heading: 10,
      magnetic: 12,
      accuracy: 'high',
      timestamp: 5,
    });
    expect(toCompassSample({ trueHeading: -1, magHeading: 12, accuracy: 2 }, 5)).toEqual({
      heading: 12,
      magnetic: 12,
      accuracy: 'medium',
      timestamp: 5,
    });
    expect(toCompassSample({ trueHeading: -1, magHeading: Number.NaN, accuracy: 0 }, 5)).toBeNull();
  });
});

describe('expoHeadingSource', () => {
  it('từ chối quyền → denied, không watchHeadingAsync', async () => {
    mocks.Location.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'denied',
    });
    const onError = vi.fn();
    expoHeadingSource().subscribe(vi.fn(), onError);
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'denied' })),
    );
    expect(mocks.Location.watchHeadingAsync).not.toHaveBeenCalled();
  });

  it('hai người nghe → MỘT đăng ký la bàn + một gyro; mẫu tới cả hai; rời hết → remove cả hai', async () => {
    const removeHeading = vi.fn();
    const removeGyro = vi.fn();
    mocks.Location.watchHeadingAsync.mockResolvedValue({ remove: removeHeading });
    mocks.Gyroscope.addListener.mockReturnValue({ remove: removeGyro });
    const a: HeadingFix[] = [];
    const b: HeadingFix[] = [];
    const offA = expoHeadingSource().subscribe((h) => a.push(h));
    const offB = expoHeadingSource({ gyro: false }).subscribe((h) => b.push(h));
    await started();
    await gyroStarted();
    expect(mocks.Location.watchHeadingAsync).toHaveBeenCalledTimes(1);
    expect(mocks.Gyroscope.setUpdateInterval).toHaveBeenCalledWith(50);
    headingCb()({ trueHeading: 45, magHeading: 46, accuracy: 3 });
    expect(a.map((h) => h.heading)).toEqual([45]);
    expect(b.map((h) => h.heading)).toEqual([45]);
    offA(); // người dùng gyro cuối rời → gỡ gyro, giữ la bàn cho B
    expect(removeGyro).toHaveBeenCalledTimes(1);
    expect(removeHeading).not.toHaveBeenCalled();
    offB();
    expect(removeHeading).toHaveBeenCalledTimes(1);
  });

  it('gyro góp vào: hai mẫu gyro sau la bàn → fix fused', async () => {
    const got: HeadingFix[] = [];
    expoHeadingSource({ minInterval_ms: 0, minDelta_deg: 0 }).subscribe((h) => got.push(h));
    await started();
    await gyroStarted();
    headingCb()({ trueHeading: 180, magHeading: 180, accuracy: 3 });
    gyroCb()({ x: 0, y: 0, z: Math.PI / 2, timestamp: 10 }); // 90°/s, đồng hồ cảm biến (giây)
    gyroCb()({ x: 0, y: 0, z: Math.PI / 2, timestamp: 11 }); // 1 s sau
    expect(got.at(-1)?.heading).toBeCloseTo(90, 3);
    expect(got.at(-1)?.source).toBe('fused');
  });

  it('máy không có gyro → chỉ la bàn; watchHeadingAsync reject → unavailable một lần', async () => {
    mocks.Gyroscope.isAvailableAsync.mockResolvedValue(false);
    const got: HeadingFix[] = [];
    expoHeadingSource().subscribe((h) => got.push(h));
    await started();
    await vi.waitFor(() => expect(mocks.Gyroscope.isAvailableAsync).toHaveBeenCalled());
    expect(mocks.Gyroscope.addListener).not.toHaveBeenCalled();
    headingCb()({ trueHeading: 10, magHeading: 10, accuracy: 3 });
    expect(got).toHaveLength(1);

    __resetHeadingSourceForTests();
    mocks.Location.watchHeadingAsync.mockRejectedValue(new Error('Heading unavailable'));
    const onError = vi.fn();
    expoHeadingSource().subscribe(vi.fn(), onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 'unavailable' });
  });

  it('app vào nền → gỡ cảm biến; active lại → đăng ký lại', async () => {
    const remove = vi.fn();
    mocks.Location.watchHeadingAsync.mockResolvedValue({ remove });
    expoHeadingSource({ gyro: false }).subscribe(vi.fn());
    await started();
    setAppState('background');
    expect(remove).toHaveBeenCalledTimes(1);
    setAppState('active');
    await vi.waitFor(() => expect(mocks.Location.watchHeadingAsync).toHaveBeenCalledTimes(2));
  });
});
```

- [x] **Step 4: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/react-native/src/expo/heading-source.test.ts`
Expected: FAIL — không resolve được `./heading-source`.

- [x] **Step 5: Viết `heading-source.ts`**

```ts
// packages/react-native/src/expo/heading-source.ts
import {
  type CompassSample,
  type HeadingAccuracy,
  type HeadingError,
  type HeadingFilterOptions,
  type HeadingFix,
  type HeadingSource,
  createHeadingFilter,
} from '@mapslibvn/core';
import { AppState, type AppStateStatus } from 'react-native';
import { Location, Sensors } from './modules';

export interface ExpoHeadingOptions extends HeadingFilterOptions {
  /** Trộn gyro từ expo-sensors — mặc định true; máy không có gyro tự rơi về la bàn đơn. */
  gyro?: boolean;
  /** Mặc định 50 ms (20 Hz). */
  gyroInterval_ms?: number;
}

/** Thang accuracy 0–3 của expo-location → mức của core. */
export const HEADING_ACCURACY_LEVELS: readonly HeadingAccuracy[] = [
  'unreliable',
  'low',
  'medium',
  'high',
];

export function toAccuracy(level: number): HeadingAccuracy {
  if (!Number.isFinite(level)) return 'unreliable';
  return HEADING_ACCURACY_LEVELS[Math.max(0, Math.min(3, Math.trunc(level)))] ?? 'unreliable';
}

const validDeg = (v: number): boolean => Number.isFinite(v) && v >= 0;

/**
 * `LocationHeadingObject` → `CompassSample`. `trueHeading` âm (chưa có vị trí để tính độ lệch từ) →
 * dùng hướng từ (Việt Nam lệch dưới 2°); cả hai hỏng → null.
 */
export function toCompassSample(
  h: { trueHeading: number; magHeading: number; accuracy: number },
  now: number,
): CompassSample | null {
  const magnetic = validDeg(h.magHeading) ? h.magHeading : undefined;
  const heading = validDeg(h.trueHeading) ? h.trueHeading : magnetic;
  if (heading === undefined) return null;
  return {
    heading,
    ...(magnetic !== undefined ? { magnetic } : {}),
    accuracy: toAccuracy(h.accuracy),
    timestamp: now,
  };
}

const RAD_TO_DEG = 180 / Math.PI;
const DEFAULT_GYRO_INTERVAL_MS = 50;

type CompassListener = (s: CompassSample) => void;
type GyroListener = (z_dps: number, timestamp_ms: number, now: number) => void;
type ErrorListener = (e: HeadingError) => void;
interface Removable {
  remove(): void;
}

/**
 * MỘT đăng ký native dùng chung cho mọi instance và mọi người nghe (spec la bàn 6.1): la bàn và gyro
 * chỉ chạy khi có ≥ 1 người nghe, tạm dừng khi app không active. Mỗi instance có bộ lọc riêng.
 */
const shared = {
  compass: new Set<CompassListener>(),
  gyro: new Set<GyroListener>(),
  errors: new Set<ErrorListener>(),
  resets: new Set<() => void>(),
  headingSub: null as Removable | null,
  gyroSub: null as Removable | null,
  starting: false,
  paused: false,
  gyroInterval_ms: DEFAULT_GYRO_INTERVAL_MS,
  appSub: null as Removable | null,
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const fail = (e: HeadingError): void => {
  for (const fn of shared.errors) fn(e);
};

async function startNative(): Promise<void> {
  if (shared.starting || shared.headingSub || shared.paused || shared.compass.size === 0) return;
  shared.starting = true;
  try {
    const sub = await Location.watchHeadingAsync(
      (h) => {
        const s = toCompassSample(h, Date.now());
        if (!s) return;
        for (const fn of shared.compass) fn(s);
      },
      (reason) => fail({ code: 'unavailable', message: reason }),
    );
    if (shared.compass.size === 0 || shared.paused) {
      sub.remove(); // mọi người rời hoặc app vào nền trong lúc chờ
      return;
    }
    shared.headingSub = sub;
  } catch (e) {
    fail({ code: 'unavailable', message: messageOf(e), raw: e });
    return;
  } finally {
    shared.starting = false;
  }
  if (shared.gyro.size === 0 || shared.gyroSub) return;
  try {
    const available = await Sensors.Gyroscope.isAvailableAsync();
    if (!available || !shared.headingSub || shared.gyroSub || shared.gyro.size === 0) return;
    Sensors.Gyroscope.setUpdateInterval(shared.gyroInterval_ms);
    shared.gyroSub = Sensors.Gyroscope.addListener((m) => {
      const now = Date.now();
      for (const fn of shared.gyro) fn(m.z * RAD_TO_DEG, m.timestamp * 1000, now);
    });
  } catch {
    /* máy không có gyro hoặc module thiếu native → la bàn đơn */
  }
}

function stopGyro(): void {
  shared.gyroSub?.remove();
  shared.gyroSub = null;
}
function stopNative(): void {
  shared.headingSub?.remove();
  shared.headingSub = null;
  stopGyro();
}

function ensureAppState(): void {
  if (shared.appSub) return;
  shared.appSub = AppState.addEventListener('change', (s: AppStateStatus) => {
    if (s === 'active') {
      if (!shared.paused) return;
      shared.paused = false;
      void startNative();
      return;
    }
    if (shared.paused) return;
    shared.paused = true;
    stopNative();
    for (const fn of shared.resets) fn(); // không tích phân gyro qua khoảng nền
  });
}

/**
 * Nguồn hướng Expo: `expo-location.watchHeadingAsync` (la bàn, bắc thật, accuracy 0–3) trộn
 * `expo-sensors.Gyroscope` qua `createHeadingFilter`. Android cần quyền vị trí để có mẫu la bàn
 * (expo-location im lặng khi thiếu) → xin quyền tiền cảnh trước; từ chối → `denied`.
 */
export function expoHeadingSource(opts: ExpoHeadingOptions = {}): HeadingSource {
  const { gyro, gyroInterval_ms, ...filterOpts } = opts;
  const useGyro = gyro !== false;
  return {
    subscribe(onHeading, onError) {
      const filter = createHeadingFilter(filterOpts);
      let stopped = false;
      let attached = false;
      const emit = (fix: HeadingFix | null): void => {
        if (fix && !stopped) onHeading(fix);
      };
      const compassFn: CompassListener = (s) => emit(filter.compass(s));
      const gyroFn: GyroListener = (z_dps, timestamp, now) =>
        emit(filter.gyro({ z_dps, timestamp }, now));
      const errorFn: ErrorListener = (e) => {
        if (!stopped) onError?.(e);
      };
      const resetFn = (): void => filter.reset();
      const detach = (): void => {
        if (!attached) return;
        attached = false;
        shared.compass.delete(compassFn);
        shared.gyro.delete(gyroFn);
        shared.errors.delete(errorFn);
        shared.resets.delete(resetFn);
        if (shared.compass.size === 0) stopNative();
        else if (shared.gyro.size === 0) stopGyro();
      };
      void (async () => {
        const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
        if (stopped) return;
        if (!perm?.granted) {
          onError?.({
            code: 'denied',
            message: 'Người dùng từ chối quyền vị trí — la bàn trên Android cần quyền này',
          });
          return;
        }
        attached = true;
        shared.compass.add(compassFn);
        if (useGyro) {
          shared.gyro.add(gyroFn);
          shared.gyroInterval_ms = Math.min(
            shared.gyroInterval_ms,
            gyroInterval_ms ?? DEFAULT_GYRO_INTERVAL_MS,
          );
        }
        shared.errors.add(errorFn);
        shared.resets.add(resetFn);
        ensureAppState();
        await startNative();
      })();
      return () => {
        stopped = true;
        detach();
      };
    },
  };
}

/** Chỉ cho test. */
export function __resetHeadingSourceForTests(): void {
  stopNative();
  shared.compass.clear();
  shared.gyro.clear();
  shared.errors.clear();
  shared.resets.clear();
  shared.appSub?.remove();
  shared.appSub = null;
  shared.starting = false;
  shared.paused = false;
  shared.gyroInterval_ms = DEFAULT_GYRO_INTERVAL_MS;
}
```

- [x] **Step 6: Chạy test xanh**

Run: `pnpm exec vitest run packages/react-native/src/expo/heading-source.test.ts`
Expected: PASS 6 test.

- [x] **Step 7: `expoNavigation` kèm heading + test**

Thay toàn bộ `packages/react-native/src/expo/index.ts`:

```ts
import type { NavigationSessionOptions } from '../navigation/session';
import { KEEP_AWAKE_TAG, expoAudioSession, expoKeepAwake } from './device';
import {
  type ExpoHeadingOptions,
  HEADING_ACCURACY_LEVELS,
  expoHeadingSource,
  toAccuracy,
  toCompassSample,
} from './heading-source';
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
export { HEADING_ACCURACY_LEVELS, expoHeadingSource, toAccuracy, toCompassSample };
export type { ExpoHeadingOptions } from './heading-source';

export type ExpoNavigationOptions = ExpoLocationSourceOptions & {
  speech?: ExpoSpeechOptions;
  /** false → không kèm nguồn hướng; object → tuỳ chọn cho expoHeadingSource. Mặc định bật. */
  heading?: false | ExpoHeadingOptions;
};

/** Bộ adapter Expo mặc định cho `createNavigationSession({ provider, ...expoNavigation() })`. */
export function expoNavigation(
  opts: ExpoNavigationOptions = {},
): Required<Pick<NavigationSessionOptions, 'source' | 'speech' | 'audio' | 'keepAwake'>> &
  Pick<NavigationSessionOptions, 'heading'> {
  const { speech, heading, ...location } = opts;
  return {
    source: expoLocationSource(location),
    speech: expoSpeech(speech ?? {}),
    audio: expoAudioSession(),
    keepAwake: expoKeepAwake(),
    ...(heading === false ? {} : { heading: expoHeadingSource(heading ?? {}) }),
  };
}
```

Tạo `packages/react-native/src/expo/index.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('./modules', () => ({
  Location: {},
  TaskManager: {},
  Speech: {},
  Audio: {},
  KeepAwake: {},
  Sensors: { Gyroscope: {} },
}));
vi.mock('react-native', () => import('../test/react-native-mock'));

import { expoNavigation } from './index';

describe('expoNavigation', () => {
  it('mặc định kèm nguồn hướng; heading: false thì không có khoá heading', () => {
    const on = expoNavigation();
    expect(typeof on.heading?.subscribe).toBe('function');
    expect(typeof on.source.subscribe).toBe('function');
    const off = expoNavigation({ heading: false });
    expect('heading' in off).toBe(false);
    expect(typeof off.speech.speak).toBe('function');
  });
});
```

Run: `pnpm exec vitest run packages/react-native/src/expo/`
Expected: PASS toàn bộ (index.test, heading-source.test, location-source.test, speech.test, device.test).

- [x] **Step 8: tsup external + peer dependency**

`packages/react-native/tsup.config.ts`: trong mảng `external`, sau `'expo-keep-awake',` thêm `'expo-sensors',`. Sửa chú thích đầu: "Entry thứ hai … chỗ duy nhất import Expo (external)" giữ nguyên, thêm câu "expo-sensors cũng external (spec la bàn 6.3)".

`packages/react-native/package.json`:
- `peerDependencies` thêm `"expo-sensors": ">=15.0.0",` (sau `expo-location`, giữ thứ tự chữ cái: `expo-audio`, `expo-keep-awake`, `expo-location`, `expo-sensors`, `expo-speech`, `expo-task-manager`).
- `peerDependenciesMeta` thêm `"expo-sensors": { "optional": true },`.
- `description` đổi thành: `React Native bindings MapsLibVN: <MapsLibVNMap>, <Marker>, useMap, usePlaces, dẫn đường (createNavigationSession, useNavigation; entry /expo cho định vị nền + TTS), la bàn + con quay hồi chuyển (useHeading, userLocation) — bọc @maplibre/maplibre-react-native`.

- [x] **Step 9: Build gói, kiểm dist không kéo expo-sensors vào gói chính**

Run: `pnpm --filter @mapslibvn/react-native build && grep -c "expo-sensors" packages/react-native/dist/index.js; grep -c "expo-sensors" packages/react-native/dist/expo/index.js`
Expected: build xanh; dòng đầu in `0` (gói chính không nhắc expo-sensors); dòng hai in ≥ 1 (entry expo import external).

- [x] **Step 10: Commit**

```bash
git add packages/react-native/src/expo packages/react-native/tsup.config.ts packages/react-native/package.json
git commit -m "feat(react-native/expo): expoHeadingSource gộp la bàn expo-location + gyro expo-sensors, expoNavigation kèm heading

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: THIRD_PARTY_NOTICES và README gói

**Files:**
- Modify: `THIRD_PARTY_NOTICES.md` (gốc), rồi `pnpm notices:sync` copy vào 4 gói
- Modify: `packages/react-native/README.md`

- [ ] **Step 1: Notices gốc**

Trong `THIRD_PARTY_NOTICES.md`, thay dòng bảng:

```
| expo-speech, expo-audio, expo-keep-awake | 57.0.3 / 57.0.5 / 57.0.1 (peer **tuỳ chọn**, chỉ entry `@mapslibvn/react-native/expo`) | MIT | đọc câu chỉ dẫn, phiên âm thanh khi nền, giữ màn hình sáng |
```

bằng:

```
| expo-speech, expo-audio, expo-keep-awake, expo-sensors | 57.0.3 / 57.0.5 / 57.0.1 / 57.0.3 (peer **tuỳ chọn**, chỉ entry `@mapslibvn/react-native/expo`) | MIT | đọc câu chỉ dẫn, phiên âm thanh khi nền, giữ màn hình sáng, con quay hồi chuyển cho la bàn |
```

Thay tiêu đề:

```
### 4.9 expo-location, expo-task-manager, expo-speech, expo-audio, expo-keep-awake — MIT
```

bằng:

```
### 4.9 expo-location, expo-task-manager, expo-speech, expo-audio, expo-keep-awake, expo-sensors — MIT
```

(Nguyên văn MIT của 650 Industries bên dưới giữ nguyên — cùng chủ sở hữu.)

- [ ] **Step 2: Đồng bộ và kiểm**

Run: `pnpm notices:sync && node scripts/notices-sync.mjs --check`
Expected: 4 bản sao được ghi; `--check` báo khớp gốc.

- [ ] **Step 3: README gói — phần tiếng Anh**

Trong `packages/react-native/README.md`, phần "## Why teams pick it", sau bullet `🔐 **Privacy-conscious by default**` thêm:

```
- 🧭 **Compass + gyroscope, opt-in** — the puck turns with the phone while you're stopped at a light, a blue dot with a heading cone before the ride starts, and `useHeading()` for your own UI (rotate the driver icon, send heading to your server). Ships through the same `/expo` entry.
```

Trong câu `You'll need \`npx expo install expo-location expo-task-manager expo-speech expo-audio\` plus …` đổi lệnh thành `npx expo install expo-location expo-task-manager expo-speech expo-audio expo-sensors`.

Trước dòng `📖 Docs:` (phần EN) thêm:

````
## Compass and heading

```tsx
import { useHeading } from '@mapslibvn/react-native';
import { expoHeadingSource, expoLocationSource } from '@mapslibvn/react-native/expo';

const heading = expoHeadingSource();                                     // compass + gyro, one shared native subscription
<MapsLibVNMap {...props} userLocation={{ source: expoLocationSource({ background: false }), heading, follow: 'heading' }} />
const fix = useHeading(heading);                                         // { heading, accuracy, source } anywhere in your app
```

`expoNavigation()` already includes the heading source, so the navigation puck follows the phone while stationary (≤ 1 m/s) and goes back to GPS when moving. Pass `follow={{ bearing: 'heading' }}` for a heading-up camera while walking.
````

- [ ] **Step 4: README gói — phần tiếng Việt**

Trong "## Vì sao nên chọn", sau bullet `🔐 **Tôn trọng quyền riêng tư mặc định**` thêm:

```
- 🧭 **La bàn + con quay hồi chuyển, tuỳ chọn** — puck xoay theo điện thoại khi dừng đèn đỏ, chấm xanh có nón hướng trước khi bắt đầu chuyến, `useHeading()` cho UI riêng (xoay icon tài xế, gửi hướng về máy chủ). Đi cùng entry `/expo`.
```

Trong câu `Cần \`npx expo install expo-location expo-task-manager expo-speech expo-audio\` và plugin …` đổi lệnh thành `npx expo install expo-location expo-task-manager expo-speech expo-audio expo-sensors`.

Trước dòng `📖 Tài liệu:` (phần VI) thêm:

````
## La bàn và hướng

```tsx
import { useHeading } from '@mapslibvn/react-native';
import { expoHeadingSource, expoLocationSource } from '@mapslibvn/react-native/expo';

const heading = expoHeadingSource();                                     // la bàn + gyro, một đăng ký native dùng chung
<MapsLibVNMap {...props} userLocation={{ source: expoLocationSource({ background: false }), heading, follow: 'heading' }} />
const fix = useHeading(heading);                                         // { heading, accuracy, source } ở bất kỳ đâu
```

`expoNavigation()` đã kèm nguồn hướng: puck dẫn đường xoay theo máy khi đứng yên (≤ 1 m/s), chạy lại theo GPS. Truyền `follow={{ bearing: 'heading' }}` để bản đồ xoay theo hướng nhìn khi đi bộ.
````

- [ ] **Step 5: Kiểm không có số version SDK trong README**

Run: `grep -n "0\.[0-9]\.[0-9]" packages/react-native/README.md`
Expected: không có dòng nào (badge shields.io không chứa số cứng).

- [ ] **Step 6: Commit**

```bash
git add THIRD_PARTY_NOTICES.md packages/core/THIRD_PARTY_NOTICES.md packages/web/THIRD_PARTY_NOTICES.md packages/react/THIRD_PARTY_NOTICES.md packages/react-native/THIRD_PARTY_NOTICES.md packages/react-native/README.md
git commit -m "docs(react-native): README la bàn + gyro; notices thêm expo-sensors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: App thử `examples/embed-rn`

**Files:**
- Modify: `examples/embed-rn/package.json`
- Modify: `examples/embed-rn/app.json`
- Modify: `examples/embed-rn/App.tsx`
- Modify: `examples/embed-rn/navigation-ui.tsx`
- Modify: `examples/embed-rn/README.md`

- [ ] **Step 1: Khai báo gói và plugin**

`examples/embed-rn/package.json` — trong `dependencies`, sau `"expo-location": "~57.0.17",` thêm:

```json
    "expo-sensors": "~57.0.3",
```

`examples/embed-rn/app.json` — trong mảng `plugins`, sau `"expo-audio"` thêm:

```json
      [
        "expo-sensors",
        {
          "motionPermission": "MapsLibVN Demo dùng cảm biến chuyển động để hiện hướng bạn đang nhìn."
        }
      ]
```

- [ ] **Step 2: `App.tsx` — nguồn hướng, chấm xanh, nút La bàn / Về tôi**

Import từ `@mapslibvn/react-native`: thêm `useHeading` **không** cần ở App (dùng ở `navigation-ui.tsx`); giữ nguyên.

Import từ `@mapslibvn/react-native/expo` đổi thành:

```ts
import {
  expoAudioSession,
  expoHeadingSource,
  expoKeepAwake,
  expoLocationSource,
  expoNavigation,
  expoSpeech,
} from '@mapslibvn/react-native/expo';
```

Sau khối `const realSession = createNavigationSession({ … });` thêm:

```ts
// Nguồn hướng và vị trí tiền cảnh cho chấm xanh — cấp module để tham chiếu ổn định (SDK chỉ đăng ký
// lại nguồn khi tham chiếu đổi). realSession đã kèm heading qua expoNavigation() mặc định.
const headingSource = expoHeadingSource();
const foregroundSource = expoLocationSource({ background: false });
```

Trong `App()`, sau `const [navigating, setNavigating] = useState<false | 'real' | 'sim'>(false);` thêm:

```ts
  const [compass, setCompass] = useState(false); // bản đồ xoay theo hướng nhìn
  const [userFollowing, setUserFollowing] = useState(false);

  // Theo dõi bám chấm xanh để hiện nút "Về tôi" khi người dùng đã kéo bản đồ.
  useEffect(() => {
    if (!map) return;
    const onChange = (f: boolean) => setUserFollowing(f);
    map.userLocation.on('followChange', onChange);
    setUserFollowing(map.userLocation.following);
    return () => map.userLocation.off('followChange', onChange);
  }, [map, compass]);
```

Trong JSX `<MapsLibVNMap …>`, sau `navigation={session}` thêm hai prop (SDK tự ẩn chấm xanh và ngừng nghe nguồn khi phiên có tiến độ, nên truyền luôn không cần điều kiện):

```tsx
        userLocation={{
          source: foregroundSource,
          heading: headingSource,
          follow: compass ? 'heading' : 'center',
        }}
        follow={compass ? { bearing: 'heading' } : true}
```

Trong `<View style={styles.toolbar}>`, sau nút đổi ngôn ngữ thêm:

```tsx
            <Pressable
              style={[styles.btn, compass && styles.primary]}
              onPress={() => setCompass((c) => !c)}
              accessibilityLabel="La bàn"
            >
              <Text style={[styles.btnText, compass && { color: '#fff' }]}>La bàn</Text>
            </Pressable>
            {!userFollowing && (
              <Pressable style={styles.btn} onPress={() => map?.userLocation.recenter()}>
                <Text style={styles.btnText}>Về tôi</Text>
              </Pressable>
            )}
```

- [ ] **Step 3: `navigation-ui.tsx` — dòng chẩn đoán hướng**

Đổi import đầu để có `useHeading`:

```ts
import {
  type MapHandle,
  type NavigationSession,
  type TravelMode,
  formatDistanceShort,
  useHeading,
  useNavigation,
} from '@mapslibvn/react-native';
```

Trong `NavigationPanel`, sau `const { status, progress, following } = useNavigation(session);` thêm:

```ts
  const heading = useHeading(session);
```

Thay `<Text style={styles.diag}>…</Text>` bằng:

```tsx
          <Text style={styles.diag}>
            fix {diag.fixes} · sai số{' '}
            {diag.accuracy === null ? '—' : `${Math.round(diag.accuracy)} m`} · {diag.source} · tính
            lại {diag.reroutes} · giọng {diag.voice} · hướng{' '}
            {heading ? `${Math.round(heading.heading)}° ${heading.accuracy} ${heading.source}` : '—'}
          </Text>
```

- [ ] **Step 4: README app thử**

Cuối `examples/embed-rn/README.md` thêm:

```markdown
## La bàn và con quay hồi chuyển

Chấm xanh có nón hướng hiện trước khi dẫn đường (nguồn `expoLocationSource({ background: false })` +
`expoHeadingSource()`); nút **La bàn** bật bản đồ xoay theo hướng nhìn, nút **Về tôi** hiện sau khi kéo
bản đồ. Trong dẫn đường, puck xoay theo máy khi đứng yên; dòng chẩn đoán ghi `hướng 123° high fused`.
Cần `expo-sensors` (đã trong `package.json`) và plugin trong `app.json` → **prebuild lại** sau khi kéo
code mới: `npx expo prebuild --clean`. Simulator/emulator không có la bàn thật: Android emulator dùng
Extended controls → Virtual sensors → Rotation để xoay; iOS simulator không có hướng (nón không hiện).
```

- [ ] **Step 5: Cài, typecheck app thử**

Run: `pnpm example:rn --pack-only`
Expected: build core + RN, pack tarball, `npm install` cài thêm `expo-sensors`, dòng cuối `✓ --pack-only: xong`.

Run: `cd examples/embed-rn && npx tsc --noEmit -p . && cd ../..`
Expected: không lỗi kiểu (prop `userLocation`, `follow.bearing`, `useHeading` đều có trong tarball).

Run: `cd examples/embed-rn && npx expo prebuild --clean && cd ../..`
Expected: sinh lại `ios/` và `android/` với plugin `expo-sensors` (kiểm `grep -c NSMotionUsageDescription examples/embed-rn/ios/MapsLibVNDemo/Info.plist` → 1).

- [ ] **Step 6: Commit**

```bash
git add examples/embed-rn/package.json examples/embed-rn/package-lock.json examples/embed-rn/app.json examples/embed-rn/App.tsx examples/embed-rn/navigation-ui.tsx examples/embed-rn/README.md
git commit -m "feat(embed-rn): chấm xanh + nón hướng, nút La bàn/Về tôi, chẩn đoán hướng, cài expo-sensors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Docs

**Files:**
- Modify: `apps/docs/src/content/docs/dan-duong-react-native.md`
- Modify: `apps/docs/src/content/docs/react-native.md`
- Modify: `apps/docs/src/content/docs/sdk.md`
- Modify: `apps/docs/src/content/docs/dan-duong.md`
- Modify: `apps/docs/src/content/docs/tinh-nang.md`

- [ ] **Step 1: `dan-duong-react-native.md` — cài đặt và plugin**

Mục 1: đổi "dẫn đường cần năm module Expo" thành "dẫn đường cần sáu module Expo" và lệnh cài thành:

```bash
npx expo install expo-location expo-task-manager expo-speech expo-audio expo-keep-awake expo-sensors
```

Sau câu "Bản đồ và tìm kiếm **không** cần các module này; …" thêm đoạn:

```markdown
`expo-sensors` chỉ phục vụ con quay hồi chuyển cho la bàn (mục 10) nhưng là bắt buộc khi import entry
`/expo`: thiếu nó Metro báo `Unable to resolve module expo-sensors`.
```

Mục 2, trong khối JSON `plugins`, sau `"expo-audio"` thêm:

```json
  ["expo-sensors", { "motionPermission": "Ứng dụng dùng cảm biến chuyển động để hiện hướng." }]
```

và sau câu "Plugin thêm `UIBackgroundModes: location` + `audio` (iOS) …" thêm câu: "Plugin `expo-sensors` thêm `NSMotionUsageDescription` (iOS); con quay hồi chuyển không hỏi quyền lúc chạy trên cả hai hệ."

- [ ] **Step 2: `dan-duong-react-native.md` — mục mới "La bàn và con quay hồi chuyển"**

Đổi tiêu đề `## 10. Giới hạn hiện tại` thành `## 11. Giới hạn hiện tại`, rồi chèn ngay TRƯỚC nó:

````markdown
## 10. La bàn và con quay hồi chuyển

`expoNavigation()` đã kèm nguồn hướng `expoHeadingSource()`: la bàn từ `expo-location`
(`watchHeadingAsync`, bắc thật, mức tin cậy 0–3 của hệ) trộn với con quay hồi chuyển từ `expo-sensors`
qua bộ lọc bù trong core (gyro phản ứng ngay khi xoay máy, la bàn kéo về để không trôi). iOS đã trộn
sẵn ở CoreLocation; gyro chủ yếu làm mượt Android.

Trong dẫn đường, SDK dùng hướng như sau:

| Tình huống | Puck | Camera |
|---|---|---|
| Đang chạy (`speed_mps` > 1) | theo GPS như cũ | theo hướng đi |
| Đứng yên / dưới 1 m/s (đèn đỏ, chờ khách) | **xoay theo điện thoại** | không đổi |
| `follow={{ bearing: 'heading' }}` | như trên | **xoay theo la bàn** (thưa: ≥ 250 ms, ≥ 2°) — hợp đi bộ, đi xe dễ chóng mặt |
| Hướng `unreliable` (từ kế nhiễu, chưa hiệu chuẩn) | về hướng tuyến | không xoay theo la bàn |

Đọc hướng ở bất kỳ đâu:

```tsx
import { useHeading } from '@mapslibvn/react-native';

const fix = useHeading(session);          // trong lúc dẫn đường: { heading, magnetic?, accuracy, timestamp, source }
const fix2 = useHeading(headingSource);   // ngoài dẫn đường: hook tự đăng ký theo vòng đời component
```

Sự kiện trên phiên: `heading` (mỗi mẫu đã lọc), `headingUnavailable` (từ chối quyền vị trí, máy không
có la bàn — một lần mỗi `start`). `accuracy` là `unreliable | low | medium | high`; `source` là `compass`
hay `fused` (đã có gyro góp vào).

Tắt: `expoNavigation({ heading: false })`. Chỉnh bộ lọc: `expoNavigation({ heading: { tau_s: 1, gyro: false } })`.
Nguồn hướng riêng (feed máy chủ, SDK cảm biến khác) ≤ 15 dòng:

```ts
import type { HeadingSource } from '@mapslibvn/react-native';

const fromMyFeed: HeadingSource = {
  subscribe(onHeading, onError) {
    const off = myFeed.on('heading', (h) =>
      onHeading({ heading: h.deg, accuracy: 'medium', timestamp: Date.now(), source: 'compass' }),
    );
    myFeed.on('error', (e) => onError?.({ code: 'unavailable', message: String(e) }));
    return off;
  },
};
const session = createNavigationSession({ provider: client, ...expoNavigation({ heading: false }), heading: fromMyFeed });
```

Chấm xanh có nón hướng **ngoài** dẫn đường: prop `userLocation` — xem [React Native](/react-native/) mục 6.
````

Trong mục "Giới hạn hiện tại" (nay là 11) thêm bốn bullet:

```markdown
- La bàn tham chiếu cạnh trên máy ở tư thế **dọc**; app xoay ngang chưa được bù.
- Simulator iOS không có la bàn (`headingUnavailable`); Android emulator chỉ có cảm biến ảo.
- Android cần hiệu chuẩn la bàn lần đầu (xoay máy hình số 8) — trước đó `accuracy` là `low`/`unreliable`.
- Giá đỡ điện thoại có nam châm trên xe máy làm từ kế nhiễu → `unreliable`, SDK tự về hướng tuyến.
```

- [ ] **Step 3: `react-native.md` — mục "Vị trí của tôi và la bàn"**

Đổi tiêu đề `## 6. Giới hạn hiện tại` thành `## 7. Giới hạn hiện tại`. Sửa hai tham chiếu chữ "mục 6":
trong khối bash mục 2 đổi `# xem mục 6` thành `# xem mục 7`; trong `dan-duong-react-native.md` mục 11 đổi
`[React Native](/react-native/) mục 6` thành `[React Native](/react-native/) mục 7`.

Chèn ngay TRƯỚC `## 7. Giới hạn hiện tại`:

````markdown
## 6. Vị trí của tôi và la bàn

Chấm xanh + nón hướng + vòng sai số kiểu app gọi xe, khi **không** dẫn đường:

```tsx
import { expoHeadingSource, expoLocationSource } from '@mapslibvn/react-native/expo';

// Cấp module hoặc useMemo: SDK chỉ đăng ký lại nguồn khi tham chiếu đổi.
const source = expoLocationSource({ background: false });
const heading = expoHeadingSource();

<MapsLibVNMap
  {...props}
  userLocation={{ source, heading, follow: 'center' }}   // follow: 'none' | 'center' | 'heading'
/>
```

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `source` (bắt buộc) | vị trí tiền cảnh — `PositionSource` bất kỳ, kể cả feed của bạn |
| `heading` | có → nón hướng (mờ khi `accuracy` là `unreliable`) |
| `follow` | `'none'` (mặc định) không đụng camera; `'center'` bám tâm; `'heading'` bám tâm và xoay bản đồ theo hướng nhìn |
| `zoom` | zoom khi bám, mặc định 16 |
| `accuracyCircle` | vòng sai số theo mét thật, mặc định true |

Người dùng kéo bản đồ → tắt bám; `useMap().userLocation.recenter()` bật lại, `following` và sự kiện
`followChange` để hiện nút "Về tôi". `useMap().userLocation.fix` / `.heading` là fix và hướng SDK
đang vẽ. Khi một phiên dẫn đường gắn vào map có tiến độ, chấm xanh **tự ẩn và ngừng nghe nguồn**
(puck dẫn đường thay thế, không có hai luồng GPS); phiên dừng thì hiện lại.

Entry `/expo` cần `expo-sensors` ngoài `expo-location`: `npx expo install expo-location expo-sensors`
và plugin `expo-sensors` trong `app.json` (xem [Dẫn đường React Native](/dan-duong-react-native/) mục 1–2).
Đọc hướng cho UI riêng: `useHeading(heading)`.
````

Trong bảng "## 4. Khác với web" thêm dòng cuối:

```markdown
| không có chấm xanh/la bàn | `userLocation={{ source, heading, follow }}`, `useHeading()`, puck dẫn đường theo la bàn khi đứng yên — xem mục 6 |
```

Trong mục Giới hạn (nay 7) thêm bullet: `- La bàn giả định màn hình dọc; simulator không có la bàn.`

- [ ] **Step 4: `sdk.md` mục 5**

Sau đoạn liệt kê export hiện có của `@mapslibvn/react-native` thêm:

```markdown
La bàn + con quay hồi chuyển: `useHeading`, prop `userLocation` (kiểu `UserLocationOptions`,
`UserLocationHandle`), `follow.bearing`, hằng `USER_LOCATION_SOURCE_ID`, `USER_LOCATION_LAYER_IDS`,
`HEADING_CONE_IMAGE_KEY`, `HEADING_FRESH_MS`, `CAMERA_BEARING_MIN_MS`, `CAMERA_BEARING_MIN_DEG`; re-export
từ core: `createHeadingFilter`, `wrapDeg`, `signedDiffDeg`, `MOVING_SPEED_MPS` và kiểu `HeadingFix`,
`HeadingSource`, `HeadingError`, `HeadingAccuracy`, `HeadingFilter`, `HeadingFilterOptions`,
`CompassSample`, `RotationRate`. Entry `/expo`: `expoHeadingSource`, `ExpoHeadingOptions`,
`HEADING_ACCURACY_LEVELS`, `toCompassSample`, `toAccuracy`; `expoNavigation({ heading })`.
Phiên: tuỳ chọn `heading`, sự kiện `heading`/`headingUnavailable`, getter `session.heading`.
```

- [ ] **Step 5: `dan-duong.md` (web) và `tinh-nang.md`**

`dan-duong.md`: đổi câu `Đứng yên thì\n  hướng mũi tên lấy theo tuyến, không theo la bàn.` thành
`Đứng yên thì hướng mũi tên lấy theo tuyến, không theo la bàn — SDK React Native có la bàn + gyro, xem [Dẫn đường trên React Native](/dan-duong-react-native/) mục 10.`

`tinh-nang.md` mục 5: sau câu "SDK React Native dẫn đường cả khi khoá máy, phiên độc lập với màn hình bản đồ — [Dẫn đường trên React Native](/dan-duong-react-native/)." thêm: "Trên React Native còn có la bàn + con quay hồi chuyển: puck xoay theo điện thoại khi đứng yên, chấm xanh có nón hướng, `useHeading()` cho UI riêng."

- [ ] **Step 6: Build docs, kiểm link nội bộ**

Run: `pnpm --filter @mapslibvn/docs build`
Expected: Astro build xanh, không cảnh báo link hỏng.

Run: `grep -c "# xem mục 7" apps/docs/src/content/docs/react-native.md; grep -c "/react-native/) mục 7" apps/docs/src/content/docs/dan-duong-react-native.md; grep -c "/react-native/) mục 6" apps/docs/src/content/docs/dan-duong-react-native.md`
Expected: `1`, `1`, `1` — hai tham chiếu cũ tới "Giới hạn" đã trỏ mục 7; tham chiếu duy nhất còn lại tới mục 6 là dòng cuối mục 10 mới (trỏ đúng "Vị trí của tôi và la bàn").

- [ ] **Step 7: Commit**

```bash
git add apps/docs/src/content/docs/dan-duong-react-native.md apps/docs/src/content/docs/react-native.md apps/docs/src/content/docs/sdk.md apps/docs/src/content/docs/dan-duong.md apps/docs/src/content/docs/tinh-nang.md
git commit -m "docs: la bàn + con quay hồi chuyển trên React Native — cài đặt, userLocation, useHeading, giới hạn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Cổng local, kiểm emulator, evidence, DEVLOG

**Files:**
- Create: `docs/evidence/navigation/2026-09-12-la-ban.md`
- Modify: `docs/DEVLOG.md`
- Modify: `docs/superpowers/specs/2026-09-12-la-ban-gyro-react-native-design.md` (mục 12 và mục lệch spec)

- [ ] **Step 1: Cổng local (GitHub Actions khoá thanh toán)**

```bash
pnpm lint
pnpm typecheck
pnpm test
node scripts/notices-sync.mjs --check
pnpm --filter @mapslibvn/core build   # đọc dòng Size: … kB gzipped
```

Expected: cả bốn lệnh xanh; ghi lại số file/test và size core vào evidence bước 4.

- [ ] **Step 2: Cài lên Android emulator và kiểm cảm biến ảo**

```bash
pnpm example:rn --android
```

Trong emulator: mở Extended controls (⋯) → Virtual sensors → Device Pose → kéo thanh **Z-Rot** (xoay quanh trục
dọc). Quan sát: nón chấm xanh xoay theo; bấm **La bàn** → bản đồ xoay theo; dòng chẩn đoán (khi Giả lập)
hiện `hướng N° … fused` và puck **không** đổi theo la bàn khi đang chạy giả lập (> 1 m/s). Chụp ảnh
`docs/evidence/navigation/2026-09-12-la-ban-android-emu-non.png` và `…-la-ban-android-emu-xoay.png`
bằng `adb exec-out screencap -p > <file>`.

Nếu emulator không phát mẫu la bàn (một số image không có từ kế ảo): ghi rõ vào evidence, chuyển tiêu chí 2
sang kiểm trên Android thật ở Task 15.

- [ ] **Step 3: iOS simulator — chỉ kiểm không crash**

```bash
pnpm example:rn --ios
```

Expected: app mở, chấm xanh hiện (không nón, simulator không có la bàn), không lỗi `headingUnavailable`
làm sập app; dòng chẩn đoán khi Giả lập hiện `hướng —`. Chụp `…-la-ban-ios-sim.png`
(`xcrun simctl io booted screenshot <file>`). Dừng simulator, emulator, Metro sau khi kiểm (bài học bộ nhớ 12/09).

- [ ] **Step 4: Viết evidence**

```markdown
# La bàn + con quay hồi chuyển — kiểm sớm và cổng local

Ngày: 2026-09-12. Spec: `docs/superpowers/specs/2026-09-12-la-ban-gyro-react-native-design.md`.
Plan: `docs/superpowers/plans/2026-09-12-la-ban-gyro-react-native.md`.

## Cổng local (GitHub Actions vẫn khoá vì thanh toán)

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | (điền: xanh, N file) |
| `pnpm typecheck` | (điền) |
| `pnpm test` | (điền: gốc N file / N test; apps/api N/N) |
| `node scripts/notices-sync.mjs --check` | (điền) |
| core barrel size-limit | (điền: N kB / 20 kB) |
| tarball cài `examples/embed-rn` (`npm install`, có `expo-sensors`) | (điền) |

## Kiểm sớm trên máy giả lập

| Hạng mục | Máy | Kết quả |
|---|---|---|
| Nón chấm xanh xoay theo cảm biến ảo Z-Rot | Android emulator (điền tên/API) | (điền + ảnh) |
| Nút La bàn → bản đồ xoay theo | Android emulator | (điền) |
| Giả lập: puck theo GPS (> 1 m/s), chẩn đoán `hướng … fused` | Android emulator | (điền) |
| Chấm xanh không nón, không crash, `hướng —` | iOS simulator (điền) | (điền) |

## Máy thật (Task 15 — PHONG)

| # | Kịch bản | Mi 9 (Android) | iPhone 14 Plus |
|---|---|---|---|
| 3a | Đứng yên xoay người 90°: nón/puck theo kịp ~0,5 s, không rung quá ±3° sau 1 s | | |
| 3b | Bật La bàn: bản đồ xoay theo hướng nhìn, đi bộ ≥ 200 m mượt | | |
| 3c | Đưa máy gần nam châm: nón mờ (`unreliable`), camera không xoay | | |
| 4 | Không có hộp thoại quyền mới ngoài vị trí | | |
| 5 | Dẫn đường thật, dừng đèn đỏ: puck xoay theo máy; chạy lại về GPS không giật | | |

Ghi định tính nếu không đo được số; ghi rõ "theo quyết định PHONG" khi đóng mà thiếu số.
```

- [ ] **Step 5: DEVLOG**

Đầu `## 1. Trạng thái hiện tại` thêm bullet mới (trên cùng):

```markdown
- **12/09/2026 — La bàn + con quay hồi chuyển cho `@mapslibvn/react-native` (spec
  `2026-09-12-la-ban-gyro-react-native-design.md`) — ĐÃ CODE XONG, chờ nghiệm thu máy thật.** Core thêm
  `createHeadingFilter` (bộ lọc bù thuần) và kiểu `HeadingSource`/`HeadingFix`; phiên nhận `heading`;
  puck theo la bàn khi `speed_mps ≤ 1`; `follow.bearing 'heading'`; prop `userLocation` (chấm xanh + nón
  + vòng sai số, tự ẩn khi dẫn đường); `useHeading()`; entry `/expo` thêm `expoHeadingSource()` và
  **bắt buộc cài `expo-sensors`** khi import `/expo` (quyết định PHONG). Cổng local xanh (evidence
  `docs/evidence/navigation/2026-09-12-la-ban.md`). Tiêu chí máy thật 3/4/5 chờ PHONG (mục 14).
```

Cuối file thêm mục:

```markdown
## 14. Nghiệm thu la bàn + con quay hồi chuyển (spec la bàn mục 12) — ĐANG CHỜ MÁY THẬT, 12/09/2026

| # | Tiêu chí | Kết quả |
|---|---|---|
| 1 | Cổng local xanh; core ≤ 20 kB; tarball cài với `expo-sensors` không lỗi peer | (điền từ evidence) |
| 2 | Android emulator cảm biến ảo → nón xoay; Giả lập puck vẫn theo GPS | (điền) |
| 3 | Mi 9 thật: xoay người, La bàn, nam châm | CHỜ PHONG |
| 4 | iPhone 14 Plus thật: cùng kịch bản, không hộp thoại quyền mới | CHỜ PHONG |
| 5 | Dẫn đường thật dừng đèn đỏ: puck theo máy, chạy lại về GPS | CHỜ PHONG |
| 6 | Docs sống production, README hai ngôn ngữ, notices đủ 6 gói Expo | (điền sau `pnpm deploy:docs`) |
| 7 | `useHeading(session)` ngoài map; `HeadingSource` ngoài ≤ 15 dòng; test spec C cũ xanh không sửa | ĐẠT — `use-heading.test.tsx`, docs mục 10, `pnpm test` không sửa test cũ |
```

- [ ] **Step 6: Ghi lệch spec vào spec**

Trong spec `2026-09-12-la-ban-gyro-react-native-design.md`, thêm mục `## 10b. Lệch khi thực thi` (trước mục 11) với ít nhất hai dòng đã biết trước:

```markdown
## 10b. Lệch khi thực thi (plan `2026-09-12-la-ban-gyro-react-native.md`)

- `HeadingFilter.gyro(rate, now?)` có tham số `now` (ms epoch) — spec 4 viết "timestamp phát = timestamp
  của mẫu vừa xử lý", nhưng đồng hồ gyro (giây, đồng hồ cảm biến) khác miền `Date.now()`, nên fix phát
  từ gyro gắn `now` do adapter truyền; `rate.timestamp` chỉ dùng tính `dt`.
- Mét/pixel dùng chu vi Trái Đất / (512 · 2^z) = 78 271,517 m/px ở zoom 0 (tile 512 của MapLibre),
  không phải 156 543,03 (tile 256) như spec 7 viết.
- Đường dẫn đến docs "mục 10" (dẫn đường RN) và "mục 6" (React Native) chốt khi chèn mục mới trước
  "Giới hạn hiện tại", không đánh số lại các mục khác để giữ tham chiếu cũ.
- (điền thêm khi thực thi)
```

- [ ] **Step 7: Commit**

```bash
git add docs/evidence/navigation/2026-09-12-la-ban.md docs/evidence/navigation/2026-09-12-la-ban-*.png docs/DEVLOG.md docs/superpowers/specs/2026-09-12-la-ban-gyro-react-native-design.md docs/superpowers/plans/2026-09-12-la-ban-gyro-react-native.md
git commit -m "docs: evidence cổng local + kiểm sớm la bàn, DEVLOG mục 14, lệch spec

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Máy thật (PHONG) và đóng

**Files:**
- Modify: `docs/evidence/navigation/2026-09-12-la-ban.md`
- Modify: `docs/DEVLOG.md` (mục 1, mục 14)
- Modify: `docs/superpowers/specs/2026-09-12-la-ban-gyro-react-native-design.md` (mục 12)

- [ ] **Step 1: Build lên hai máy thật (PHONG chạy, chỉ đích danh tên máy)**

```bash
pnpm example:rn --pack-only
cd examples/embed-rn
npx expo run:android --device            # Mi 9 cắm USB, bật USB debugging
xcrun devicectl list devices              # lấy đúng tên iPhone
npx expo run:ios --device "<tên iPhone 14 Plus trong danh sách>"
cd ../..
```

Lần đầu trên iPhone sau prebuild mới: nếu app không mở vì "profile chưa được tin cậy" → Cài đặt → Cài đặt
chung → VPN & Quản lý thiết bị → Tin cậy, rồi mở lại.

- [ ] **Step 2: Kịch bản thực địa (mỗi máy)**

1. Mở app ngoài trời, đứng yên, xoay người 90° bốn lần: nón chấm xanh theo kịp trong khoảng nửa giây; sau
   một giây đứng yên nón không rung quá vài độ. Android lần đầu có thể phải xoay máy hình số 8 để hiệu chuẩn.
2. Bấm **La bàn**, đi bộ 200 m: bản đồ xoay theo hướng nhìn, không giật. Kéo bản đồ → nút **Về tôi** hiện; bấm
   → bám lại.
3. Đưa điện thoại sát một nam châm (loa, giá đỡ xe): nón mờ đi, bản đồ ngừng xoay theo; rời ra vài giây → hồi.
4. Chọn điểm đến, **Bắt đầu** (GPS thật), đi xe có ít nhất một chỗ dừng: lúc dừng xoay máy → puck xoay theo;
   chạy tiếp → puck về hướng GPS, không giật. Dòng chẩn đoán hiện `hướng N° high fused`.
5. iPhone: ghi nhận không có hộp thoại quyền mới nào ngoài quyền vị trí đã có.

Chụp ảnh từng bước vào `docs/evidence/navigation/2026-09-12-la-ban-<may>-<buoc>.png`.

- [ ] **Step 3: Điền evidence và bảng nghiệm thu**

Điền bảng "Máy thật" trong `2026-09-12-la-ban.md` (định tính được chấp nhận; ghi rõ "theo quyết định PHONG"
nếu đóng mà không có số). Cập nhật spec mục 12 (cột kết quả) và DEVLOG mục 14 tương ứng; DEVLOG mục 1 đổi
trạng thái thành "ĐÃ NGHIỆM THU x/7".

- [ ] **Step 4: Deploy docs tay và xác nhận**

```bash
pnpm deploy:docs
curl -s https://mapslibvn-docs.pages.dev/dan-duong-react-native/ | grep -c "expo-sensors"
curl -s https://mapslibvn-docs.pages.dev/react-native/ | grep -c "userLocation"
```

Expected: hai số đếm ≥ 1. Ghi vào evidence và DEVLOG mục 14 dòng 6.

- [ ] **Step 5: Commit đóng**

```bash
git add docs/evidence/navigation docs/DEVLOG.md docs/superpowers/specs/2026-09-12-la-ban-gyro-react-native-design.md docs/superpowers/plans/2026-09-12-la-ban-gyro-react-native.md
git commit -m "docs: nghiệm thu la bàn + con quay hồi chuyển trên máy thật, deploy docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Không push, không bump version, không publish — PHONG quyết (xem hướng dẫn `pnpm sdk:publish` trong DEVLOG mục 1).
