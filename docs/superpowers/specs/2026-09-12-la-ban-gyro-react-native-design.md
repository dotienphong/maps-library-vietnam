# MapsLibVN — Thiết kế la bàn và con quay hồi chuyển cho `@mapslibvn/react-native`

- Ngày: 2026-09-12
- Trạng thái: bản viết sau brainstorming với PHONG (4 quyết định đã duyệt cùng ngày, mục 1.5); chờ PHONG
  review file này trước khi viết plan
- Chủ dự án: PHONG
- Tài liệu do Fable 5.1 viết
- Spec nền: `2026-09-12-dan-duong-react-native-design.md` (spec C, đã nghiệm thu 12/09/2026) — mục 12 của
  spec C trỏ sang file này. Không đổi máy trạng thái dẫn đường của spec B, không đổi API máy chủ.
- Bối cảnh PHONG nêu: SDK sẽ nhúng vào một app đặt xe kiểu Grab trong tương lai; la bàn và gyro phải là
  **tuỳ chọn gọi ra được**, app không dùng thì không tốn gì.

## 0. Tóm tắt một đoạn

Gói `@mapslibvn/react-native` thêm **nguồn hướng** `HeadingSource` (la bàn hệ điều hành trộn với con quay
hồi chuyển qua một bộ lọc bù thuần trong core) và dùng nó ở ba chỗ: (1) trong dẫn đường, puck xoay theo
hướng điện thoại khi đứng yên hoặc đi dưới 1 m/s, còn đang chạy vẫn theo GPS như cũ; camera chỉ xoay theo
la bàn khi app bật `follow={{ bearing: 'heading' }}`; (2) ngoài dẫn đường, prop `userLocation` vẽ chấm
xanh có nón hướng và vòng sai số, bám tâm hoặc bám hướng tuỳ chọn; (3) hook `useHeading()` và sự kiện
`heading` trên phiên để app đọc hướng ở bất kỳ đâu (xoay icon tài xế, gửi hướng về máy chủ). Mặc định Expo
`expoHeadingSource()` nằm trong entry `@mapslibvn/react-native/expo`: la bàn từ `expo-location` (đã là peer),
gyro từ `expo-sensors` (peer mới, entry `/expo` bắt buộc cài). Core chỉ nhận thêm kiểu và một bộ lọc thuần
theo timestamp, để web dùng lại sau với DeviceOrientation. App thử có nút "La bàn" và bảng chẩn đoán hướng;
nghiệm thu trên hai máy thật của PHONG vì simulator không có la bàn.

## 1. Mục tiêu, phạm vi, người dùng

### 1.1 Mục tiêu

1. Đứng yên hay dừng đèn đỏ, mũi tên vị trí quay theo hướng điện thoại trong nửa giây, không rung.
2. App đọc được hướng và mức tin cậy ở mọi màn hình, kể cả khi không dẫn đường.
3. Trước khi đặt xe, màn hình bản đồ có chấm xanh + nón hướng kiểu Grab bằng một prop.
4. Không dùng thì không trả giá: gói chính không import cảm biến; entry `/expo` mới cần `expo-sensors`.
5. Một công thức cho cả hai hệ, kiểm được bằng test thuần; phần phụ thuộc thiết bị là adapter mỏng.

### 1.2 Trong phạm vi

- Core: kiểu `HeadingFix`, `HeadingSource`, `HeadingError`, `RotationRate`; hàm `createHeadingFilter()`,
  `wrapDeg()`; xuất hằng `MOVING_SPEED_MPS` đang nằm riêng trong `navigator.ts`.
- Gói RN: tuỳ chọn `heading` của phiên + sự kiện `heading`/`headingUnavailable` + getter `session.heading`;
  map-binding xoay puck theo la bàn khi chậm; `FollowOptions.bearing`; hook `useHeading()`; prop
  `userLocation` với store, lớp vẽ, bám camera và `useMap().userLocation`.
- Entry `/expo`: `expoHeadingSource()`, `expoNavigation()` tự kèm heading, kiểu ambient cho `expo-sensors`
  và `watchHeadingAsync`, tsup external, peer dependency, notices.
- Ảnh nón hướng sinh bởi `scripts/gen-puck.mjs` (mở rộng script hiện có, vẫn nhúng base64).
- App thử `examples/embed-rn`: cài `expo-sensors` + plugin, chấm xanh, nút "La bàn", bảng chẩn đoán hướng.
- Docs: hai trang RN, `sdk.md`, README gói hai ngôn ngữ, một dòng trang dẫn đường web, `tinh-nang.md`,
  `THIRD_PARTY_NOTICES.md`.

### 1.3 Ngoài phạm vi (ghi để không kỳ vọng nhầm)

- Màn hình ngang: hướng la bàn của cả hai hệ tham chiếu cạnh trên máy ở tư thế dọc; SDK không bù. App thử
  và docs khai báo portrait.
- Lộ dữ liệu gyro/từ kế thô ra API công khai — chỉ có hướng đã lọc. Pitch/roll không dùng cho bản đồ.
- La bàn trên web (DeviceOrientation) — kiểu và bộ lọc đặt ở core để làm sau, spec này không đụng web.
- Bù độ lệch từ bằng mô hình WMM khi hệ không cho hướng thật — Việt Nam lệch dưới 2°, chấp nhận dùng hướng từ.
- Nhận hướng khi app ở nền: cảm biến tạm dừng khi app không active (puck không hiện, giọng đọc không cần hướng).
- Dùng `NativeUserLocation`/`Camera.trackUserLocation` native của wrapper — loại vì không trả hướng ra JS
  và chạy luồng GPS riêng (mục 2).
- Hiệu chuẩn la bàn có UI: chỉ lộ `accuracy`, app tự nhắc người dùng.

### 1.4 Người dùng

- Đội làm app gọi xe: tài xế dừng chờ khách vẫn thấy mình quay hướng nào; app khách hiện chấm xanh + nón
  trước khi đặt; gửi `heading` cùng vị trí về máy chủ để vẽ xe đúng chiều.
- App đi bộ tới điểm đón: bản đồ xoay theo hướng nhìn (`follow.bearing = 'heading'` hoặc
  `userLocation.follow = 'heading'`).
- App chỉ hiện bản đồ, không dẫn đường: không cài gì thêm, không đổi gì.

### 1.5 Quyết định đã chốt (12/09/2026)

1. Làm cả bốn việc: puck theo la bàn khi đứng yên, `useHeading()` + sự kiện, camera xoay theo hướng nhìn
   (tuỳ chọn), chấm xanh + nón hướng ngoài dẫn đường.
2. `expo-sensors` **gộp vào entry `/expo`, bắt buộc cài** cho mọi app import `/expo` — PHONG chọn một entry
   một lệnh cài thay cho entry riêng tuỳ chọn.
3. Chấm xanh là **puck riêng của SDK** dùng chung `HeadingSource`, không bọc component native của wrapper.
4. Camera mặc định **không** xoay theo la bàn (`bearing: 'route'`); app bật `'heading'` khi cần.

## 2. Tiền đề kỹ thuật đã xác minh (12/09/2026)

| Điều | Kết quả | Hệ quả |
|---|---|---|
| `expo-location` 57.0.17 `watchHeadingAsync` | trả `{ trueHeading, magHeading, accuracy 0–3 }`. iOS: `CLLocationManager.startUpdatingHeading` — CoreLocation đã trộn từ kế + gyro, mượt. Android: chỉ `TYPE_MAGNETIC_FIELD` + `TYPE_ACCELEROMETER` ở `SENSOR_DELAY_NORMAL`, lọc phát khi đổi ≥ ~2° và ≥ 50 ms, **không gyro** → rung và trễ khi xoay nhanh | gyro chỉ cần bù trên Android; iOS nhận thêm cũng vô hại |
| `startHeadingUpdate` Android | `return` im lặng nếu chưa có `ACCESS_FINE_LOCATION`/`COARSE`; không lỗi, không mẫu | adapter phải `requestForegroundPermissionsAsync` trước, từ chối → `HeadingError.denied` |
| `watchHeadingAsync` trên iOS simulator | `CLLocationManager.headingAvailable()` false → reject `HeadingUnavailableException` | adapter → `HeadingError.unavailable`, nguồn im; simulator không nghiệm thu được la bàn |
| `trueHeading` | −1 khi thiếu vị trí (Android cần một fix để tính `GeomagneticField`; iOS cần dịch vụ vị trí) | rơi về `magHeading`, `source` vẫn ghi đúng |
| `expo-sensors` 57.0.3 `Gyroscope` | rad/s ba trục; `setUpdateInterval(ms)`, `addListener(cb) → { remove() }`, `isAvailableAsync()`; `timestamp` giây theo đồng hồ cảm biến. Hệ toạ độ thiết bị thuận tay phải, **Z hướng ra khỏi màn hình trên cả hai hệ** → z dương = xoay ngược chiều kim đồng hồ nhìn từ trên = hướng bắc giảm | một công thức `heading −= z_dps·dt` cho cả hai; `gyroSign` để đảo nếu thực địa thấy ngược |
| `expo-sensors` `DeviceMotion` | Android dùng `TYPE_ROTATION_VECTOR` (trộn sẵn), alpha = −azimuth radian; iOS dùng `xMagneticNorthZVertical`, alpha = yaw với X trỏ bắc từ → công thức yaw→heading **khác nhau hai hệ** | không dùng; chọn Gyroscope + bộ lọc bù để chỉ có một công thức |
| Quyền `expo-sensors` | iOS: plugin thêm `NSMotionUsageDescription`; `CMMotionManager` gyroscope không hỏi lúc chạy. Android: ≤ 200 Hz không cần quyền | không có hộp thoại quyền mới |
| `@maplibre/maplibre-react-native` 11.3.8 | `Camera.trackUserLocation='heading'` và `NativeUserLocation mode='heading'` dùng la bàn native (Android `RenderMode.COMPASS`, iOS `showsUserHeadingIndicator`) nhưng chạy `LocationManager` riêng và **không trả hướng ra JS**; `<UserLocation heading>` JS lấy `coords.heading` = course GPS (Android `getBearing()`, iOS `location.course`) → vô dụng khi đứng yên | SDK tự vẽ chấm xanh và nón bằng GeoJSON, đúng quyết định 3 |
| Puck hiện tại | symbol layer `icon-rotate: ['get','bearing']`, `icon-rotation-alignment: 'map'`; `bearing` = heading GPS khi `speed_mps > MOVING_SPEED_MPS` (hằng riêng = 1 trong `navigator.ts`), còn không thì hướng đoạn tuyến | map-binding ghi đè `bearing` của `RouteProgressCut` khi chậm; core xuất hằng để dùng chung ngưỡng |
| `NavigationProgress.fix` | có `speed_mps`, `timestamp` | binding biết đang chậm hay chạy không cần thêm sự kiện |
| Barrel core | 17,34 kB gzip / trần 20 kB (đo `pnpm --filter @mapslibvn/core build` 12/09) | bộ lọc ước 1–1,5 kB; vượt trần thì báo PHONG, không tự nâng |
| Độ lệch từ ở Việt Nam | dưới 2° (WMM) | dùng hướng từ khi thiếu hướng thật là chấp nhận được cho puck |

## 3. Kiến trúc

```
core (thuần, có test)
  HeadingFix · HeadingSource · HeadingError · RotationRate · createHeadingFilter() · wrapDeg() · MOVING_SPEED_MPS
        ▲
@mapslibvn/react-native/expo
  expoHeadingSource() ─ một đăng ký native dùng chung (đếm người nghe, tạm dừng khi app không active)
     ├─ expo-location watchHeadingAsync  → filter.compass()
     └─ expo-sensors Gyroscope (20 Hz)   → filter.gyro()
  expoNavigation() = { source, speech, audio, keepAwake, heading }
        │
@mapslibvn/react-native
  createNavigationSession({ heading })  → sự kiện 'heading' | 'headingUnavailable'; session.heading
  map-binding                           → puck theo la bàn khi fix.speed_mps ≤ 1; follow.bearing 'route' | 'heading'
  <MapsLibVNMap userLocation={…}>       → user-location-store + user-location-layers + bám camera; ẩn khi dẫn đường
  useHeading(source | session)          → HeadingFix | null
```

Ba luồng:

1. **Cảm biến → hướng.** Adapter Expo nhận mẫu la bàn (chậm, tuyệt đối, có mức tin cậy) và mẫu gyro (nhanh,
   tương đối). Bộ lọc bù trong core tích phân gyro giữa hai mẫu la bàn và kéo góc về la bàn theo hằng thời
   gian, phát ra `HeadingFix` thưa hơn (≥ 100 ms, ≥ 1°) để React không render dồn.
2. **Hướng → puck/camera trong dẫn đường.** Phiên chỉ chuyển tiếp; map-binding quyết định: chậm thì puck theo
   la bàn, chạy thì theo GPS; camera theo tuyến trừ khi app chọn `'heading'`; `accuracy === 'unreliable'` thì
   bỏ la bàn, quay về hướng tuyến (điện thoại kẹp giá đỡ nam châm là ca thật).
3. **Hướng → chấm xanh ngoài dẫn đường.** Store riêng gom fix tiền cảnh + heading thành một feature Point;
   ba lớp vẽ; ẩn và ngừng nghe nguồn khi phiên dẫn đường gắn vào map đang có tiến độ.

## 4. Thay đổi ở core (`packages/core`) — thuần, có test

File mới `src/navigation/heading.ts` (+ `heading.test.ts`), xuất qua `navigation/index.ts`.

```ts
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

/** Cùng hình với PositionSource: lớp dán (RN, sau này web) cung cấp. */
export interface HeadingSource {
  subscribe(onHeading: (fix: HeadingFix) => void, onError?: (error: HeadingError) => void): () => void;
}

/** Tốc độ xoay quanh trục vuông góc màn hình, độ/giây; dương = ngược chiều kim đồng hồ nhìn từ trên. */
export interface RotationRate {
  z_dps: number;
  /** ms, đồng hồ bất kỳ nhưng phải cùng đồng hồ giữa các mẫu gyro. */
  timestamp: number;
}

export interface CompassSample {
  heading: number;
  magnetic?: number;
  accuracy: HeadingAccuracy;
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
  compass(sample: CompassSample): HeadingFix | null;
  gyro(rate: RotationRate): HeadingFix | null;
  current(): HeadingFix | null;
  reset(): void;
}

export function createHeadingFilter(opts?: HeadingFilterOptions): HeadingFilter;
/** Chuẩn hoá về [0, 360). */
export function wrapDeg(deg: number): number;
/** Dưới vận tốc này heading GPS không tin được — chuyển từ navigator.ts, navigator import lại. */
export const MOVING_SPEED_MPS = 1;
```

Thuật toán (bộ lọc bù bậc một, không ma trận):

- Trạng thái: góc ước lượng `est`, mẫu la bàn cuối, timestamp gyro cuối, lần phát cuối, cờ "gyro còn sống"
  (có mẫu gyro trong `maxGyroGap_s`).
- `compass(s)`: chưa có `est` → `est = s.heading`, phát ngay. Có gyro sống → `est += diff(s.heading, est) ·
  (1 − e^(−dt/tau_s))` với `dt` từ mẫu la bàn trước. Không gyro → cùng công thức với `smoothing_s`. Lưu
  `accuracy`, độ lệch từ `s.heading − s.magnetic` để suy `magnetic` cho các lần phát sau. `diff` là chênh có
  dấu trong (−180, 180], nên 359 → 1 đi qua 0 chứ không quay 358°.
- `gyro(r)`: chưa có `est` → chỉ ghi timestamp, trả `null` (không tích phân khi chưa có mốc tuyệt đối).
  `dt` từ mẫu gyro trước; `dt > maxGyroGap_s` hay `dt ≤ 0` → chỉ ghi timestamp. Ngược lại `est = wrapDeg(est −
  gyroSign · z_dps · dt)`, `source = 'fused'`.
- Phát khi và chỉ khi: chưa từng phát, hoặc cách lần phát trước ≥ `minInterval_ms` **và** `angleDiffDeg(est,
  phát trước) ≥ minDelta_deg`. `timestamp` phát = timestamp của mẫu vừa xử lý (adapter truyền `Date.now()`).
- `accuracy` phát = của mẫu la bàn cuối. Bộ lọc **không** lọc theo accuracy; người dùng quyết (binding bỏ
  `unreliable`).

Test `heading.test.ts`: mẫu la bàn đầu phát ngay; vòng 359→1 kéo qua 0; gyro không phát khi chưa có la bàn;
gyro tích phân đúng dấu (z_dps = 90 trong 1 s → heading giảm 90) và đảo với `gyroSign: -1`; khoảng gyro quá
lớn bị bỏ; la bàn kéo về theo `tau_s` (sau 3τ còn dưới 5% chênh); throttle theo thời gian và theo góc;
`magnetic` suy đúng độ lệch; `reset()` về trạng thái đầu; `wrapDeg(−90) = 270`, `wrapDeg(360) = 0`.

`navigator.ts` import `MOVING_SPEED_MPS` từ `heading.ts` (hằng chuyển chỗ, giá trị giữ 1) — test navigator
không đổi. Size-limit chạy trong `build` như cũ.

## 5. Gói `@mapslibvn/react-native`

### 5.1 File mới và sửa

| File | Việc |
|---|---|
| `src/navigation/session.ts` (+ test) | `NavigationSessionOptions.heading?: HeadingSource`; sự kiện `heading`, `headingUnavailable`; getter `heading` |
| `src/navigation/map-binding.ts` (+ test mới `map-binding.test.ts`) | nghe `heading`; ghi đè bearing puck khi chậm; `FollowOptions.bearing`; camera theo la bàn có throttle |
| `src/use-heading.ts` (+ test) | hook |
| `src/user-location/store.ts` (+ test) | `createUserLocationStore()`: fix + heading → feature |
| `src/user-location/feature.ts` (+ test) | hàm thuần `userLocationFeature(fix, heading)`, `accuracyRadiusExpression(accuracy_m, lat)` |
| `src/user-location/layers.tsx` (+ test) | `<Images>` nón + `GeoJSONSource` + 3 `Layer`; ẩn khi có tiến độ dẫn đường |
| `src/user-location/binding.ts` (+ test) | đăng ký/huỷ hai nguồn theo `visible`, bám camera, `following`, `recenter`, `followChange` |
| `src/navigation/puck-image.ts`, `scripts/gen-puck.mjs` | thêm `HEADING_CONE_IMAGE_KEY`, `HEADING_CONE_PNG_DATA_URI` |
| `src/map.tsx`, `src/context.ts` | prop `userLocation`; `MapHandle.userLocation`; `onRegionWillChange` báo cả hai binding |
| `src/index.ts` | xuất mới (mục 5.2) |
| `src/expo/heading-source.ts` (+ test), `src/expo/index.ts`, `modules.ts`, `expo-modules.d.ts` | mục 6 |
| `package.json`, `tsup.config.ts` | peer `expo-sensors`, external |

### 5.2 API công khai

Xuất thêm từ `@mapslibvn/react-native`:

```ts
export { useHeading } from './use-heading';
export type { UserLocationOptions, UserLocationHandle } from './user-location/binding';
export { USER_LOCATION_SOURCE_ID, USER_LOCATION_LAYER_IDS } from './user-location/layers';
export { HEADING_CONE_IMAGE_KEY } from './navigation/puck-image';
export { MOVING_SPEED_MPS, createHeadingFilter, wrapDeg } from '@mapslibvn/core';
export type { CompassSample, HeadingAccuracy, HeadingError, HeadingFilter, HeadingFilterOptions, HeadingFix, HeadingSource, RotationRate } from '@mapslibvn/core';
```

Phiên:

```ts
interface NavigationSessionOptions {
  // … như spec C
  /** Nguồn hướng; thiếu → puck và camera như trước, không phát sự kiện heading. */
  heading?: HeadingSource;
}
interface SessionEvents {
  // … như spec C
  heading: HeadingFix;
  /** Nguồn hướng lỗi (từ chối quyền, simulator không có la bàn) — một lần mỗi start. */
  headingUnavailable: HeadingError;
}
interface NavigationSession {
  // … như spec C
  /** Hướng cuối của phiên đang chạy; null khi idle hoặc chưa có mẫu. */
  readonly heading: HeadingFix | null;
}
```

Map:

```tsx
interface FollowOptions {
  zoom?: number;
  pitch?: number;
  padding?: ViewPadding;
  /** 'route' (mặc định): camera theo hướng đi/tuyến. 'heading': theo la bàn của phiên, hợp đi bộ. */
  bearing?: 'route' | 'heading';
}

interface UserLocationOptions {
  /** Vị trí tiền cảnh — thường expoLocationSource({ background: false }). Bắt buộc. */
  source: PositionSource;
  /** Có → nón hướng và (nếu follow 'heading') camera xoay. */
  heading?: HeadingSource;
  /** Mặc định 'none'. 'center' bám tâm; 'heading' bám tâm và xoay theo la bàn. */
  follow?: 'none' | 'center' | 'heading';
  /** Zoom khi bám — mặc định 16. */
  zoom?: number;
  /** Vòng sai số — mặc định true. */
  accuracyCircle?: boolean;
}

interface UserLocationHandle {
  readonly following: boolean;
  /** Fix và hướng cuối SDK đang vẽ; null khi chưa có hoặc đang ẩn vì dẫn đường. */
  readonly fix: GeoFix | null;
  readonly heading: HeadingFix | null;
  recenter(): void;
  on(event: 'followChange', handler: (following: boolean) => void): void;
  off(event: 'followChange', handler: (following: boolean) => void): void;
}

<MapsLibVNMap userLocation={{ source, heading, follow: 'heading' }} … />
useMap().userLocation // UserLocationHandle — luôn có, kể cả khi không truyền prop (following false, fix null)
```

Hook:

```ts
/** Nhận HeadingSource (tự đăng ký theo vòng đời component) hoặc NavigationSession (đọc sự kiện heading). */
export function useHeading(target: HeadingSource | NavigationSession): HeadingFix | null;
```

Phân biệt bằng `'start' in target` (phiên) — `HeadingSource` chỉ có `subscribe`.

### 5.3 Hành vi phiên

1. `start()`: sau khi `source.subscribe` thành công, nếu có `opts.heading` → `heading.subscribe(onHeading,
   onError)`. `onHeading` lưu `lastHeading`, `emit('heading')`. `onError` → `emit('headingUnavailable')` một
   lần mỗi start rồi bỏ qua các lỗi sau.
2. `releaseSource()` (gọi ở `stop()` và khi đến nơi) huỷ cả đăng ký hướng; `lastHeading = null`.
3. `start()` chen ngang khi chờ quyền: dùng cùng `token` như spec C, đăng ký hướng chỉ khi token còn khớp.
4. Phiên **không** lọc, không bỏ mẫu — chỉ chuyển tiếp; logic dùng nằm ở binding để phiên headless vẫn đúng
   với app không có map.

### 5.4 Hành vi map-binding

- `attachTo` đăng ký thêm `heading` và `headingUnavailable` (thêm vào `SESSION_EVENTS` để phát lại cho
  listener của binding).
- Giữ `lastProgress` (đã có qua `attached.state`) và `lastHeading`.
- `heading(h)`:
  - `h.accuracy === 'unreliable'` → chỉ lưu, không dùng.
  - `stationary = (state.fix.speed_mps ?? 0) <= MOVING_SPEED_MPS` (fix không có `speed_mps` coi là đứng yên,
    đúng với quy ước core). Đứng yên → `store.setProgress({ shapeIndex, snapped, bearing: h.heading })`.
  - `follow.bearing === 'heading'` và đang bám và app active → camera `easeTo({ center: snapped, bearing:
    h.heading, zoom, pitch, duration: 250 })`, throttle riêng cho camera: cách lần trước ≥ 250 ms **và** đổi ≥ 2°.
- `progress(p)` (mỗi fix GPS): puck theo `p.bearing` như cũ **trừ khi** đứng yên và có `lastHeading` không
  `unreliable` trong 2 s gần nhất → giữ hướng la bàn để puck không nhảy về hướng tuyến giữa hai mẫu la bàn.
  Camera: `bearing: follow.bearing === 'heading' && lastHeading tươi ? lastHeading.heading : p.bearing`.
- `detach()` xoá `lastHeading`.
- `setFollow` nhận `bearing`; đổi từ `'heading'` về `'route'` không gọi camera ngay, fix kế tiếp tự chỉnh.

### 5.5 Hành vi `userLocation`

- `map.tsx` tạo `createUserLocationStore()` và `createUserLocationBinding({ camera, store, appState,
  routesStore })` một lần (như binding dẫn đường); `useEffect` theo khoá chuỗi của options (`follow`, `zoom`,
  `accuracyCircle`) và **tham chiếu** `source`/`heading` (app phải giữ ổn định, ví dụ ở cấp module hoặc
  `useMemo`; docs nói rõ) → `binding.setOptions(opts | null)`.
- `visible = options != null && routesStore.progress == null`. Binding nghe `routesStore.subscribe`: có tiến
  độ dẫn đường → `visible = false` → huỷ đăng ký hai nguồn, `store.clear()`; hết tiến độ (stop) → đăng ký lại.
  Không có hai điểm trên map và không có hai luồng GPS khi dẫn đường.
- Fix vào → `store.setFix(fix)`; `follow !== 'none'` và `following` và app active → `easeTo({ center,
  zoom, ...(follow === 'heading' && heading ? { bearing } : {}), duration: min(1000, dt) })`.
- Heading vào → `store.setHeading(h)`; `follow === 'heading'` → camera bearing với throttle 250 ms / 2°.
  `unreliable` → vẫn vẽ nón (mờ hơn qua `hasReliableHeading`) nhưng không xoay camera.
- `onRegionWillChange` do người dùng → `following = false`, `followChange`. `recenter()` bật lại và ease ngay
  tới fix cuối.
- `HeadingError`/`PositionError` của nguồn: không có sự kiện riêng ở map; store giữ trạng thái cũ. App muốn
  biết dùng `useHeading(source)` hoặc nguồn của mình.

### 5.6 Kích cỡ

Gói RN không có size-limit. Ảnh nón ước 1–2 kB base64. Core xem mục 4.

## 6. Entry `@mapslibvn/react-native/expo`

### 6.1 `expoHeadingSource`

```ts
export interface ExpoHeadingOptions extends HeadingFilterOptions {
  /** Trộn gyro từ expo-sensors — mặc định true; máy không có gyro tự rơi về la bàn đơn. */
  gyro?: boolean;
  /** Mặc định 50 ms (20 Hz). */
  gyroInterval_ms?: number;
}
export function expoHeadingSource(opts?: ExpoHeadingOptions): HeadingSource;
```

- **Một đăng ký native dùng chung** ở cấp module cho mọi instance và mọi người nghe (như `fixListeners` của
  `location-source.ts`): `Location.watchHeadingAsync` và `Gyroscope.addListener` chỉ chạy khi có ≥ 1 người
  nghe; người cuối rời → `remove()` cả hai. Mỗi instance có **bộ lọc riêng** (options riêng) nhận mẫu thô từ
  đăng ký chung và phát cho người nghe của nó.
- `subscribe`: `requestForegroundPermissionsAsync` (Android không có quyền thì im lặng, mục 2) → từ chối →
  `onError({ code: 'denied' })`, không đăng ký. Được → tăng đếm, khởi động native nếu là người đầu.
- Mẫu la bàn → `CompassSample { heading: trueHeading >= 0 ? trueHeading : magHeading, magnetic: magHeading,
  accuracy: {3:'high',2:'medium',1:'low',0:'unreliable'}[accuracy], timestamp: Date.now() }`.
- Mẫu gyro → `RotationRate { z_dps: z · 180/π, timestamp: timestamp · 1000 }` (giây → ms; chỉ dùng để tính
  `dt` giữa hai mẫu gyro, không trộn với `Date.now()`).
- `watchHeadingAsync` reject (simulator) hoặc `errorHandler` → `onError({ code: 'unavailable' })` cho mọi
  người nghe một lần; gyro không có (`isAvailableAsync` false hoặc ném) → chỉ la bàn, không báo lỗi.
- `AppState` không `active` → `remove()` native nhưng giữ đếm; `active` lại → đăng ký lại. Bộ lọc `reset()`
  khi tạm dừng để không tích phân qua khoảng nền.
- Hằng `HEADING_ACCURACY_LEVELS` xuất để test và docs.

### 6.2 `expoNavigation`

```ts
export type ExpoNavigationOptions = ExpoLocationSourceOptions & {
  speech?: ExpoSpeechOptions;
  /** false → không kèm nguồn hướng; object → tuỳ chọn cho expoHeadingSource. Mặc định bật. */
  heading?: false | ExpoHeadingOptions;
};
// trả về thêm `heading` khi không tắt
```

### 6.3 Đóng gói entry

- `modules.ts` thêm `import * as Sensors from 'expo-sensors'` — vẫn là chỗ duy nhất import Expo.
- `expo-modules.d.ts` thêm `watchHeadingAsync`, `LocationHeadingObject` cho `expo-location`; module
  `expo-sensors` với `Gyroscope.{ setUpdateInterval, addListener, isAvailableAsync }` và
  `GyroscopeMeasurement`. Ghi số version đối chiếu (57.0.3) trong chú thích đầu file như hiện có.
- `tsup.config.ts` external thêm `expo-sensors`.
- `package.json`: `peerDependencies['expo-sensors'] = '>=15.0.0'` (mốc Expo SDK 54, cùng cách các peer expo
  khác), `peerDependenciesMeta` optional như năm gói kia. Không bump version (PHONG bump khi publish).
- `THIRD_PARTY_NOTICES.md` gốc: dòng bảng mục 2 và tiêu đề 4.9 thêm `expo-sensors 57.0.3 — MIT`; `pnpm
  notices:sync` copy vào bốn gói.
- Metro: app import `/expo` mà chưa cài `expo-sensors` sẽ lỗi resolve — docs ghi rõ ở bước cài, đây là hệ quả
  của quyết định 2.

## 7. Vẽ chấm xanh, nón, vòng sai số (`user-location/layers.tsx`)

- Source `mapslibvn-user-location`, một feature Point, properties `{ kind: 'user', bearing, hasHeading,
  hasReliableHeading, accuracy_m }`.
- Lớp `mapslibvn-user-accuracy` (circle): `circle-radius` là expression `['interpolate', ['exponential', 2],
  ['zoom'], 0, r₀, 24, r₂₄]` với `r(z) = accuracy_m / (156543,03 · cos(lat) / 2^z)` — hàm thuần
  `accuracyRadiusExpression(accuracy_m, lat)` tính lại mỗi fix; `circle-color` màu tuyến 12% alpha, không viền.
  Tắt bằng `accuracyCircle: false`.
- Lớp `mapslibvn-user-cone` (symbol): `icon-image` nón, `icon-rotate: ['get','bearing']`,
  `icon-rotation-alignment: 'map'`, `icon-allow-overlap`, `filter: ['==', ['get','hasHeading'], true]`,
  `icon-opacity: ['case', ['get','hasReliableHeading'], 1, 0.45]`.
- Lớp `mapslibvn-user-dot` (circle): bán kính 7, `#2458a6`, viền trắng 2,5 — cùng màu tuyến để một bộ nhận
  diện. Không đổi được màu ở bản này (YAGNI; `routeStyle.color` sẽ dùng chung nếu có).
- Nón: PNG 66×66 sinh bởi `gen-puck.mjs`, hình quạt 70° mở lên trên từ tâm ảnh, alpha tuyến tính 0,4 ở tâm
  → 0 ở mép, màu `#2458a6`; tâm ảnh là tâm chấm nên `icon-anchor` mặc định `center` là đúng.
- Thứ tự: accuracy → cone → dot, chèn trước `beforeId` của tuyến; puck dẫn đường vẫn trên cùng nhưng hai
  bên không bao giờ hiện cùng lúc (mục 5.5).
- Component trả `null` khi `store.snapshot.fix == null` hoặc `visible == false`.

## 8. Kiểm thử

Vitest gốc, jsdom cho React, mock `react-native` + wrapper bằng hai file trong `src/test/` như spec C;
`vi.mock('./modules')` cho Expo, thêm `Sensors.Gyroscope` vào mock.

| Test | Kiểm |
|---|---|
| core `heading.test.ts` | mục 4 |
| `session.test.ts` (thêm case) | có `heading`: đăng ký sau source, phát `heading`, `session.heading`; `stop()`/arrive huỷ; lỗi → `headingUnavailable` một lần; không `heading` → không sự kiện; start chen ngang không đăng ký kép |
| `map-binding.test.ts` (mới, dùng `fakeSession` + `cameraRefMock`) | đứng yên → puck bearing = la bàn; chạy > 1 m/s → GPS; `unreliable` bỏ; camera không xoay mặc định; `bearing: 'heading'` → `easeTo` bearing la bàn có throttle; progress khi đứng yên giữ la bàn tươi; detach xoá |
| `use-heading.test.tsx` | với `HeadingSource` giả: đăng ký khi mount, cập nhật, huỷ khi unmount; với phiên giả: đọc sự kiện |
| `user-location/feature.test.ts` | feature đúng shape; `hasHeading` false khi thiếu; bán kính theo zoom đúng công thức tại vĩ độ 10,8 và 21 |
| `user-location/store.test.ts` | fix/heading/clear → snapshot mới, listener gọi |
| `user-location/binding.test.ts` | đăng ký hai nguồn khi visible; ẩn khi routesStore có progress và huỷ đăng ký; bám 'center'/'heading'; userGesture → followChange; recenter; app không active không ease |
| `user-location/layers.test.tsx` | 3 layer + Images khi có fix; null khi không; opacity theo reliable |
| `map.test.tsx` (thêm case) | prop `userLocation` → source GeoJSON có mặt; `useMap().userLocation` luôn có |
| `expo/heading-source.test.ts` | từ chối quyền → denied; đếm người nghe: 2 người → 1 `watchHeadingAsync`, rời hết → remove; thang accuracy; `trueHeading` −1 → magnetic; gyro không có → chỉ la bàn; reject → unavailable một lần; AppState background → remove, active → đăng ký lại |
| `expo/index` (case trong test hiện có) | `expoNavigation()` có `heading`; `{ heading: false }` không |
| `puck-image.test.ts` (thêm) | PNG nón hợp lệ, 66×66, khoá khác puck |

Không có test E2E cảm biến: simulator iOS không có la bàn, emulator Android chỉ có cảm biến ảo tay.

## 9. App thử `examples/embed-rn`

- `package.json` thêm `expo-sensors ~57.0.3`; `app.json` plugins thêm `["expo-sensors", { "motionPermission":
  "MapsLibVN Demo dùng cảm biến chuyển động để hiện hướng." }]`.
- `App.tsx`: `const headingSource = expoHeadingSource()` và `const foregroundSource =
  expoLocationSource({ background: false })` ở cấp module (tham chiếu ổn định). Khi `!navigating` truyền
  `userLocation={{ source: foregroundSource, heading: headingSource, follow: compass ? 'heading' : 'none' }}`;
  nút "La bàn" bật/tắt `compass`. `realSession` nhận heading qua `expoNavigation()` mặc định. Phiên Giả lập
  **không** truyền `heading`: phát lại luôn chạy trên 1 m/s nên la bàn không có tác dụng, và giữ phiên giả lập
  tối giản để so sánh.
- `navigation-ui.tsx`: bảng chẩn đoán thêm dòng `hướng: 123° · high · fused` từ `useHeading(session)`.
- Nút "Về tôi" gọi `map.userLocation.recenter()` khi `following === false`.

## 10. Docs và đóng gói

- `dan-duong-react-native.md`: mục 1 lệnh cài thêm `expo-sensors`; mục 2 plugin; **mục mới "La bàn và con quay
  hồi chuyển"** (chèn sau "Giọng đọc và âm thanh", đánh số lại): puck khi đứng yên, `follow={{ bearing:
  'heading' }}`, `useHeading`, tắt bằng `expoNavigation({ heading: false })`, tự cắm `HeadingSource` riêng
  ≤ 15 dòng; mục giới hạn thêm: portrait, simulator không có la bàn, Android cần hiệu chuẩn số 8, giá đỡ nam
  châm làm `unreliable`.
- `react-native.md`: **mục mới "Vị trí của tôi và la bàn"** sau mục 3 với snippet `userLocation`; bảng "Khác
  với web" thêm dòng; mục giới hạn thêm portrait.
- `sdk.md` mục 5: liệt kê xuất mới.
- `dan-duong.md` (web) dòng "Đứng yên thì hướng mũi tên lấy theo tuyến, không theo la bàn" thêm "SDK React
  Native có la bàn: xem …".
- `tinh-nang.md` mục 5: một câu về la bàn/gyro trên RN.
- README gói `packages/react-native/README.md` (EN và VI): bullet "Compass + gyroscope, opt-in" và một snippet
  3 dòng; lệnh cài thêm `expo-sensors`. Không ghi số version (feedback PHONG 12/09).
- `THIRD_PARTY_NOTICES.md` như mục 6.3. `examples/embed-rn/README.md` nếu có lệnh cài thì thêm gói.
- Spec C mục 12 thêm dòng trỏ spec này (làm cùng lúc viết spec).
- DEVLOG: mục 1 một đoạn, mục nghiệm thu mới "14. Nghiệm thu la bàn/gyro" theo bảng mục 12 dưới đây.
- Không bump version, không publish — PHONG quyết.

## 10b. Lệch khi thực thi (plan `2026-09-12-la-ban-gyro-react-native.md`)

- `HeadingFilter.gyro(rate, now?)` có tham số `now` (ms epoch) — spec 4 viết "timestamp phát = timestamp
  của mẫu vừa xử lý", nhưng đồng hồ gyro (giây, đồng hồ cảm biến) khác miền `Date.now()`, nên fix phát
  từ gyro gắn `now` do adapter truyền; `rate.timestamp` chỉ dùng tính `dt`.
- Mét/pixel dùng chu vi Trái Đất / (512 · 2^z) = 78 271,517 m/px ở zoom 0 (tile 512 của MapLibre),
  không phải 156 543,03 (tile 256) như spec 7 viết.
- Đường dẫn đến docs "mục 10" (dẫn đường RN) và "mục 6" (React Native) chốt khi chèn mục mới trước
  "Giới hạn hiện tại", không đánh số lại các mục khác để giữ tham chiếu cũ.
- Task 8: kiểu `CircleRadius` trong `user-location/feature.ts` trích qua property tuỳ chọn của
  `CircleLayerSpecification['paint']` vẫn giữ `| undefined` — `exactOptionalPropertyTypes` từ chối
  literal `{ 'circle-radius': accuracyRadiusExpression(...) }` trong `layers.tsx`. Sửa bằng thêm một
  lớp `NonNullable` lồng nhau; không đổi hành vi.
- Task 12 (`examples/embed-rn/App.tsx`): `useEffect` theo dõi `followChange` cần `compass` trong mảng
  deps để re-run khi đổi `follow` mode, nhưng thân hàm không đọc trực tiếp `compass` (đổi mode khiến
  `createUserLocationBinding.setOptions` tự đặt `wantFollow = true` mà KHÔNG phát sự kiện
  `followChange`, nên phải re-run để đồng bộ `userFollowing` cục bộ). Biome
  `useExhaustiveDependencies` báo dư — thêm `biome-ignore` kèm chú thích giải thích, không bỏ deps.
- Task 13: bullet "Gói chưa publish npm — cài từ tarball…" trong `dan-duong-react-native.md` (nay mục
  11) đổi từ tham chiếu "mục 6" sang "mục 7" của `react-native.md` (mục Giới hạn dịch xuống một số sau
  khi chèn "Vị trí của tôi và la bàn" làm mục 6 mới) — đúng như dự tính ở mục lệch spec thứ ba trên.

- **Thực địa iPhone 14 Plus 13/09/2026 (lần 2, sau `07b4218`): vẫn "hơi giật" và thêm "trễ nhẹ" khi xoay
  máy → ba lệch so với spec 4/5/6, đều có test:**
  - Spec 4 viết `compass(s)`: "có gyro sống → `est += diff · (1 − e^(−dt/tau_s))` với `dt` từ mẫu la bàn
    trước". Bỏ. Lý do: iOS chỉ phát la bàn khi đổi ≥ 1° (expo-location không đặt `headingFilter`), đứng
    yên vài giây là la bàn im → mẫu đầu sau đó có `dt` lớn → `alpha ≈ 1` → góc **nhảy** một phát về la bàn
    (vốn trễ hơn gyro); trong lúc la bàn im, bias gyro thô (`CMGyroData`, chưa bù) trôi tự do. Nay mẫu la
    bàn chỉ đổi **đích**; kéo về đích xảy ra ở **từng bước gyro** theo `dt` của bước đó (bộ lọc bù kinh
    điển) → không nhảy, bias chỉ lệch ≈ bias·τ. Gyro "chết" (mẫu cuối cách quá `maxGyroGap_s`, so bằng
    `now` epoch) → la bàn tự làm mượt theo `smoothing_s` như không có gyro. `tau_s: Infinity` tắt kéo (test).
  - Spec 4 định nghĩa `RotationRate.z_dps` là "xoay quanh trục vuông góc màn hình". Đổi nghĩa thành
    "xoay quanh trục **thẳng đứng**": máy cầm nghiêng θ thì trục z của gyro chỉ bắt được cosθ phần xoay,
    phần còn lại chờ la bàn kéo về theo τ → nón **trễ** rồi "trôi nốt" sau khi dừng. Core thêm `Vec3`,
    `RotationRate3`, `yawRateDps(rate, up)` (chiếu ω lên hướng "lên"; không có `up` → trả z như cũ).
    `expoHeadingSource` (spec 6.1) đăng ký thêm `expo-sensors.Accelerometer` cùng nhịp gyro, EMA k = 0,2,
    tuỳ chọn `tiltCompensation` (mặc định true) để A/B thực địa. Quy ước dấu do expo-sensors giữ nguyên
    của hệ điều hành: iOS đo trọng lực (nằm ngang z ≈ −1 → lên = −a), Android đo phản lực (z ≈ +1 → lên
    = +a) — `upFromAccelerometer` chọn theo `Platform.OS`, có test cả hai.
  - Spec 5.4/5.5 không nói easing; MLRN `easeTo` mặc định `easing: 'ease'` = `EaseInEaseOut`
    (`CameraUpdateItem.m`), chuỗi `easeTo` nối tiếp mỗi 250 ms/mỗi fix thành từng đoạn tăng–giảm tốc →
    bản đồ xoay **giật nhịp** ở chế độ La bàn. Mọi `easeTo` bám trong `user-location/binding.ts` và
    `navigation/map-binding.ts` nay truyền `easing: 'linear'`.
  - **Chưa sửa, chờ PHONG quyết vì lệch kiến trúc mục 7:** `icon-rotate` qua re-tile GeoJSON là bước rời
    rạc 20 Hz, không nội suy, độ trễ pipeline JS → Fabric → `MLNShapeSource.shape` → worker layout cỡ vài
    khung hình. Muốn mượt như puck hệ điều hành cần vẽ nón bằng view native (`Marker` của MLRN xoay bằng
    `Animated` trên UI thread) hoặc dùng `NativeUserLocation mode="heading"` (bỏ bộ lọc riêng). Trước
    đó có thể thử không đổi code: `expoHeadingSource({ gyroInterval_ms: 33, minInterval_ms: 33 })`.

## 11. Rủi ro và giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Dấu trục Z gyro hoá ra ngược trên một hệ | puck quay ngược khi xoay nhanh rồi bị la bàn kéo về | `gyroSign` trong options; nghiệm thu máy thật trước khi đóng; test thuần cố định quy ước |
| Đồng hồ `timestamp` gyro khác miền `Date.now()` | tích phân sai nếu trộn | chỉ dùng gyro timestamp cho `dt` giữa hai mẫu gyro; phát bằng `Date.now()` |
| Từ kế nhiễu trên xe (giá đỡ nam châm, khung sắt) | hướng sai hàng chục độ | `accuracy` từ hệ; `unreliable` → về hướng tuyến; docs nhắc |
| Android cần hiệu chuẩn lần đầu | vài giây đầu `low`/`unreliable` | vẽ nón mờ, không xoay camera; docs |
| `trueHeading` −1 kéo dài (chưa có fix) | dùng hướng từ, lệch < 2° | chấp nhận; `source` và `magnetic` cho app biết |
| Core vượt trần 20 kB | build đỏ | ước 1–1,5 kB, còn 2,6 kB; vượt thì báo PHONG quyết nâng trần, không tự nâng |
| App quên cài `expo-sensors` sau khi nâng gói | Metro lỗi resolve khi import `/expo` | docs bước cài + README; thông điệp lỗi Metro nêu tên gói |
| Hai luồng GPS khi vừa `userLocation` vừa dẫn đường | pin | binding huỷ nguồn khi ẩn (mục 5.5) |
| Camera xoay theo la bàn gây chóng mặt | trải nghiệm | mặc định `'route'`; throttle 250 ms / 2°; docs khuyên chỉ dùng cho đi bộ |
| Ảnh nón render mờ trên màn 3× | nhìn xấu | 66×66 với `icon-size` 0,5 như puck; sinh siêu lấy mẫu 4× |

## 12. Nghiệm thu — 4/7 ĐẠT, 1 ĐẠT MỘT PHẦN, 2 CHỜ MÁY THẬT (cập nhật 13/09/2026)

| # | Tiêu chí | Cách chứng minh | Kết quả |
|---|---|---|---|
| 1 | `pnpm test`, `pnpm typecheck`, `pnpm lint`, `node scripts/notices-sync.mjs --check` xanh; core barrel ≤ 20 kB; tarball cài vào app thử bằng `npm` không lỗi peer với `expo-sensors` | output lệnh trong evidence | **ĐẠT** |
| 2 | Android emulator: cảm biến ảo xoay quanh Z → nón chấm xanh xoay theo, bảng chẩn đoán đổi số; Giả lập tuyến puck vẫn theo GPS | ảnh chụp `docs/evidence/navigation/2026-09-12-la-ban-*.png` | **ĐẠT MỘT PHẦN** — chấm xanh/vòng sai số/nút La bàn/Giả lập tới arrived đều đạt trên cả Android emulator và iOS simulator (ngoài kế hoạch); riêng nón xoay theo cảm biến ảo không kiểm được vì la bàn không phát sự kiện trên môi trường giả lập (xác nhận không phải lỗi SDK, xem evidence) |
| 3 | Xiaomi Mi 9 thật: đứng yên xoay người 90° → nón/puck theo kịp trong khoảng nửa giây, sau 1 s không rung quá ±3°; bật "La bàn" bản đồ xoay theo; đưa điện thoại gần nam châm → nón mờ, camera không xoay | PHONG xác nhận + ảnh; số đo ghi định tính nếu không đo được | **CHỜ PHONG** (Task 15) |
| 4 | iPhone 14 Plus thật: cùng kịch bản; không có hộp thoại quyền mới ngoài vị trí | PHONG xác nhận + ảnh | **CHỜ PHONG** (Task 15) |
| 5 | Dẫn đường thật ≥ 1 chỗ dừng đèn đỏ: puck xoay theo máy lúc dừng, chạy lại về GPS không giật; `follow.bearing 'heading'` khi đi bộ ≥ 200 m bản đồ xoay mượt | PHONG xác nhận | **CHỜ PHONG** (Task 15) |
| 6 | Docs sống trên production (deploy tay `pnpm deploy:docs`), link check xanh, README gói hai ngôn ngữ, notices đủ sáu gói Expo | `curl` domain chính có cụm "expo-sensors" | **ĐẠT MỘT PHẦN** — nội dung cục bộ đúng, build docs xanh (22 trang); chưa `pnpm deploy:docs` — để PHONG quyết định thời điểm |
| 7 | Kịch bản app gọi xe: `useHeading(session)` trả hướng ngoài `<MapsLibVNMap>`; `HeadingSource` từ feed ngoài viết ≤ 15 dòng; app không truyền `heading` thì mọi test cũ của spec C vẫn xanh không sửa | test + docs | **ĐẠT** |

Evidence: `docs/evidence/navigation/2026-09-12-la-ban.md`. Như spec C, PHONG có thể đóng tiêu chí thực địa bằng
xác nhận định tính; bảng phải ghi rõ "theo quyết định PHONG" nếu không có số. Chi tiết vì sao tiêu chí 2 chỉ
đạt một phần (la bàn không phát trên cả hai máy giả lập, đã chẩn đoán tận gốc bằng log trực tiếp gọi
`expo-location` không qua wrapper của SDK) nằm trong evidence, mục "Phát hiện: la bàn Android không phát
sự kiện trên emulator này".

## 13. Việc tay của PHONG

| Khi nào | Việc | Chặn |
|---|---|---|
| Sau task app thử | `pnpm example:rn --pack-only` rồi cài lên Mi 9 và iPhone 14 Plus (lệnh trong memory: chỉ đích danh tên máy) | nghiệm thu 3, 4, 5 |
| Nghiệm thu | Ra ngoài xoay người, đi bộ 200 m, một lượt xe có dừng đèn đỏ; chụp ảnh | 3, 4, 5 |
| Cuối | `pnpm deploy:docs`; quyết định push và bump version | 6 |
