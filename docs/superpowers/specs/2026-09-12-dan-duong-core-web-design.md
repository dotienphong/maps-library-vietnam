# MapsLibVN — Thiết kế dẫn đường, spec B: logic dẫn đường trong core và SDK web

- Ngày: 2026-09-12
- Trạng thái: bản viết sau brainstorming với PHONG (7 quyết định phạm vi và kiến trúc A đã duyệt 12/09/2026); chờ PHONG review file trước khi viết plan
- Chủ dự án: PHONG
- Tài liệu do Fable 5.1 viết
- Spec trước: `docs/superpowers/specs/2026-09-10-dan-duong-engine-api-design.md` (spec A, đã phát hành 11/09/2026) — mục 1.3, 5.2, 6, 9, 10 của spec A trỏ các việc sang file này
- Chuỗi spec dẫn đường: **A** engine + API → **B** logic dẫn đường trong core và SDK web (file này) → **C** SDK React Native (quyền, định vị nền, đọc chỉ dẫn bằng TTS native). Spec C dùng lại nguyên máy trạng thái của B (mục 10)

## 0. Tóm tắt một đoạn

Gói core thêm thư mục `navigation/` chứa **máy trạng thái dẫn đường thuần** (`createNavigator`): nhận từng
điểm GPS, bám vào polyline tuyến, biết đang ở bước nào, còn bao xa tới chỗ rẽ, lệch tuyến hay chưa, đến
nơi hay chưa, và quyết định **khi nào đọc câu gì**. Không DOM, không timer; thời gian lấy từ chính điểm
GPS nên test được bằng chuỗi vị trí giả lập. Khi lệch tuyến đã xác nhận, navigator gọi `RouteProvider`
(mặc định là `client.directions()`) để tính lại, có cooldown và trần lỗi. SDK web thêm `map.routes` (vẽ
tuyến chính, tuyến thay thế, phần đã đi) và `map.navigation` (nối `navigator.geolocation`, camera bám
theo, mũi tên vị trí, đọc bằng `speechSynthesis` giọng Việt, giữ màn hình sáng). Worker vá câu tiếng
Việt dịch máy của Valhalla bằng một bảng cụm từ và trả thêm `verbal_alert`. Không có UI dẫn đường đóng
gói: app tự vẽ bảng chỉ dẫn từ sự kiện. Nghiệm thu bằng giả lập GPS trong test/E2E **và** PHONG đi bộ một
tuyến thật.

## 1. Mục tiêu, phạm vi, người dùng

### 1.1 Mục tiêu

1. Dev nhúng có tuyến từ `directions()` là dẫn đường được ngay trên web: một lệnh `start()`, nhận sự kiện
   để vẽ UI, có giọng đọc tiếng Việt, tự tính lại khi lệch.
2. Logic dẫn đường nằm ở core, **không phụ thuộc nền tảng và engine**, để spec C (React Native) dùng lại
   không sửa.
3. Không tăng tải máy chủ khi nhiều người đang đi: bám GPS chạy trên thiết bị; máy chủ chỉ tính tuyến
   (như spec A mục 0 đã hứa).
4. Câu chỉ dẫn tiếng Việt đọc tự nhiên hơn bản dịch máy của Valhalla, sửa ở Worker nên deploy là có.
5. Mọi ngưỡng (lệch tuyến, khoảng cách đọc, bán kính đến nơi) có mặc định theo phương tiện, app ghi đè
   được, và được chốt lại sau thực địa chứ không đoán.

### 1.2 Trong phạm vi spec B

- Core: `packages/core/src/navigation/` — kiểu dữ liệu, hình học, tiến độ, máy trạng thái, lịch đọc,
  giả lập vị trí, `RouteProvider`, `formatDistance`.
- Web: `map.routes`, `map.navigation`, `PositionSource` (`geolocationSource`, `playbackSource`),
  `createSpeech`, puck, camera bám theo, wake lock.
- React: hook `useNavigation()`.
- Worker: trường `verbal_alert` trong `RouteStep`; module `vi-phrases.ts` áp cho `lang=vi`.
- Fixture `DirectionsResponse` dịch từ fixture Valhalla Quận 1, dùng chung cho test core, web và demo.
- Docs: trang hướng dẫn `dan-duong`, trang demo `/dan-duong-demo/`, cập nhật `api.md`, `sdk.md`,
  `react.md`, `tinh-nang.md`; E2E Playwright cho demo; evidence thực địa.

### 1.3 Ngoài phạm vi (có chỗ trong kiến trúc)

- UI dẫn đường đóng gói (banner, bảng ETA, nút dừng) — app tự dựng từ `progress`/`announce`; cân nhắc
  web component riêng sau khi có phản hồi tenant.
- Lớp dán React Native (định vị nền, `expo-speech`) — spec C.
- Làn đường, giới hạn tốc độ, giao thông, camera phạt nguội.
- Tính lại khi **có tuyến tốt hơn** (chỉ tính lại khi lệch).
- Dẫn đường nền trên web (trình duyệt tạm dừng `watchPosition` khi tắt màn hình; web chỉ giữ màn hình
  sáng bằng wake lock).
- Map-matching máy chủ, tuyến ngoại tuyến, tối ưu thứ tự nhiều điểm dừng.

### 1.4 Người dùng

| Vai | Cần gì từ spec B |
|---|---|
| Dev nhúng web | `directions()` → `routes.show()` → `navigation.start()`; sự kiện đủ để vẽ UI; giả lập để thử không cần ra đường |
| Người dùng cuối | Câu rẽ đọc đúng lúc, đúng tiếng Việt; lệch thì tự tính lại; tới nơi thì báo |
| Fable (spec C) | `createNavigator`, `PositionSource`, `announce` dùng lại nguyên cho RN |
| PHONG | Duyệt bảng cụm từ; đi bộ nghiệm thu; ngưỡng ghi evidence |

### 1.5 Quyết định đã chốt (12/09/2026)

| Quyết định | Chọn | Lý do ngắn |
|---|---|---|
| Mức đóng gói | Headless + vẽ tuyến, không UI | UI khác nhau từng app; giữ web wrapper dưới trần 15 kB; docs có demo mẫu |
| Giọng nói web | Có, `speechSynthesis`, tắt được (`voice: false`) | Core quyết "khi nào nói gì" để spec C dùng lại; web chỉ là bộ đọc |
| Tính lại tuyến | `reroute: 'auto'` mặc định, cooldown 15 s, trần 3 lỗi liên tiếp; `'manual'` để app tự gọi | Khớp burst 20 request/phút/khoá+IP của spec A; app kiểm soát được quota |
| Câu tiếng Việt | Vá ở Worker bằng bảng cụm từ neo vào câu mẫu | Locale nằm **trong binary** Valhalla (mục 2), không mount được; Worker tự sinh câu là việc lớn, để spec sau nếu bảng vá vượt ~30 luật |
| Nghiệm thu | Giả lập GPS (unit + E2E) **và** PHONG đi bộ ~1 km | Giả lập không thấy nhiễu GPS thật, trễ, và hành vi trình duyệt khi tắt màn hình |
| Kiến trúc | A: core máy trạng thái thuần, web là lớp dán mỏng | Test xác định; RN dùng lại; timer/DOM chỉ ở lớp dán |
| Kích cỡ core | Nâng trần barrel 12 → **16 kB** gzip, đo lại sau build | Ước +3–4 kB; `sideEffects: false` nên app không dùng dẫn đường vẫn tree-shake; entry riêng để dành nếu vượt 16 kB |

## 2. Tiền đề kỹ thuật đã xác minh (12/09/2026)

- **Valhalla nhúng locale vào binary.** Image `ghcr.io/valhalla/valhalla-scripted:3.8.3` không có thư
  mục `locales/` trên đĩa; `valhalla_service` chứa 50 chỗ chuỗi `Rẽ <RELATIVE_DIRECTION>`. Phương án
  "vá `vi-VN.json` bằng volume mount" của spec A mục 9 **không thực hiện được** → vá ở Worker (mục 6).
- File `locales/vi-VN.json` (Valhalla 3.8.3, GitHub): 1.139 chuỗi mẫu, `posix_locale: vi_VN.UTF-8`,
  `aliases: ["vi"]`. Câu ổn: `turn`, `continue`, `enter_roundabout`, `post_transition_verbal`
  ("Tiếp tục đi thêm <LENGTH>."). Câu gượng tập trung ở `destination` ("nằm ở trái"), `merge`
  ("Sáp nhập"), `uturn` ("Rẽ trái hình chữ U"), `ramp`/`exit` ("đoạn đường nối", "Rẽ ra ngoài tại đoạn
  rẽ"), `keep` ("Giữ trái tại điểm giao"), `start` ("Lái về phía"). Multi-cue ghép chữ hoa giữa câu
  ("Rồi, trong 100 mét nữa, Rẽ phải vào Nguyễn Du.").
- **Câu alert của Valhalla không kèm khoảng cách.** Trong `src/odin/narrativebuilder.cc` 3.8.3, hàm
  `FormVerbalAlertApproachInstruction` (mẫu "Trong <LENGTH> nữa, <CURRENT_VERBAL_CUE>") được định nghĩa
  nhưng **không nơi nào gọi**; `verbal_transition_alert_instruction` chỉ là câu rẽ ngắn gọn ("Rẽ phải vào
  Lê Thánh Tôn." so với `verbal_pre` "Rẽ phải vào Lê Thánh Tôn, Đường Lê Thánh Tôn."). Client tự quyết
  đọc lúc nào và tự ghép khoảng cách → core làm việc này (mục 4.5); Worker trả thêm `verbal_alert`.
- Fixture `apps/api/test/fixtures/valhalla/q1-motorbike.json`: 6 maneuver (3 → 10 → 15 → 10 → 15 → 6),
  đủ trường `verbal_transition_alert_instruction`, `verbal_pre/post_transition_instruction`,
  `verbal_succinct_transition_instruction`, `length` (km), `time` (s), `begin/end_shape_index`. Đủ để
  dịch thành fixture `DirectionsResponse` cho mọi test của spec B (mục 7.0).
- Kích cỡ hiện tại (gzip, đo 12/09): core barrel 10,56 kB (trần 12 kB), web wrapper 4,59 kB (trần
  15 kB), UMD 293 kB (trần 350 kB). Web build tsup externalize `@mapslibvn/core` (dependency), nên số
  của wrapper không gồm core.
- `createMap` hiện có `gl`, `places`, `addMarker`, `fitBounds`, `flyTo`, `on/off(poiClick|load)`,
  `remove`; chưa có source/layer nào do SDK thêm; React bọc qua `MapContext` và `useMap()`; RN đóng gói
  core riêng. Fake maplibre trong `packages/web/src/map.test.ts` dùng lại được (thêm `addSource`,
  `addLayer`, `getSource`, `easeTo`).
- `MapsLibVNClient.directions(opts: DirectionsOptions)` đã có chữ ký đúng `RouteProvider` → không cần bọc.
- Docs: Playwright chạy `apps/api dev:e2e` (wrangler local, không Valhalla) + `astro preview`; demo
  dẫn đường vì vậy phải chạy được với provider fixture, không gọi `/v1/directions` trong E2E.
- API trình duyệt dùng: `navigator.geolocation.watchPosition` (cần HTTPS; iOS tạm dừng khi tắt màn hình),
  `speechSynthesis` (giọng `vi-VN` tuỳ máy: Safari/iOS có "Linh", Chrome desktop có Google Tiếng Việt khi
  online, Android tuỳ gói TTS đã cài; iOS cần một lần `speak()` trong user gesture), `navigator.wakeLock`
  (Chrome, Safari ≥ 16.4; bị nhả khi tab ẩn, xin lại lúc hiện).

## 3. Kiến trúc

```
app web ──► @mapslibvn/web
             ├─ map.routes       vẽ tuyến chính / thay thế / phần đã đi; marker đích, via
             └─ map.navigation   PositionSource ─► core navigator ─► camera, puck, speech, wake lock
                                        │ RouteProvider (mặc định map.places.directions) khi cần tính lại
                                        ▼
            @mapslibvn/core  navigation/   thuần: không DOM, không timer, thời gian từ fix.timestamp
             createNavigator({ response, provider?, reroute }) .update(fix) ─► sự kiện
                                        ▼
            Worker GET /v1/directions  (+ verbal_alert, + vi-phrases khi lang=vi)  ─► Valhalla
```

Nguyên tắc:

- Core **không biết** geolocation, speechSynthesis, maplibre, timer. Mọi thứ phụ thuộc nền tảng nằm ở
  lớp dán web (và sau này RN).
- Máy trạng thái chỉ tiến khi có fix mới; "đã 5 giây" nghĩa là chênh `timestamp` giữa hai fix, không phải
  đồng hồ máy. Lớp dán chịu trách nhiệm cấp fix đều (geolocation tự làm; playback dùng timer).
- Async duy nhất trong core là gọi `provider.directions()`; kết quả chỉ được áp khi trạng thái vẫn là
  `rerouting` (người dùng tự quay lại tuyến trong lúc chờ thì bỏ kết quả).
- Lớp dán và React không giữ trạng thái riêng: mọi thứ đọc từ `navigator.progress`.

## 4. Gói core: `packages/core/src/navigation/`

### 4.1 File

| File | Việc |
|---|---|
| `types.ts` | `GeoFix`, `RouteProvider`, `NavigationStatus`, `NavigationThresholds`, `NavigationProgress`, `Announcement`, `NavigationEvents`, `NavigatorOptions`, `Navigator`, `PositionSource` |
| `geometry.ts` | `haversineM`, `bearingDeg`, `angleDiffDeg`, `projectOnSegment`, `cumulativeDistances` |
| `snap.ts` | `snapToRoute` theo cửa sổ với tie-break heading rồi chiều đi |
| `progress.ts` | `buildRouteIndex(route)`: khoảng cách cộng dồn từng đỉnh, mốc mét đầu mỗi step và leg; `progressAt(index, shapeIndex, t)` → step, leg, `distanceToStep_m`, `remaining_m`, `remaining_s` |
| `announce.ts` | `formatDistance`, `formatDistanceShort`, `roundForSpeech`, `composeApproach`, `planAnnouncements(progress, done)` |
| `navigator.ts` | `createNavigator()` |
| `simulate.ts` | `simulateFixes(route, opts)` |
| `index.ts` | re-export; barrel core `src/index.ts` thêm `export * from './navigation'` |

### 4.2 Kiểu dữ liệu

```ts
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

export interface RouteProvider {
  directions(opts: DirectionsOptions): Promise<DirectionsResponse>;
}

/** Nguồn vị trí do lớp dán cung cấp; core chỉ định nghĩa kiểu để web và RN cùng hình. */
export interface PositionSource {
  subscribe(onFix: (fix: GeoFix) => void, onError?: (error: PositionError) => void): () => void;
}
export interface PositionError { code: 'denied' | 'unavailable' | 'timeout'; message: string; raw?: unknown }

export type NavigationStatus = 'idle' | 'navigating' | 'off_route' | 'rerouting' | 'arrived' | 'stopped';

export interface NavigationThresholds {
  offRoute_m: number;        // ngưỡng lệch cơ sở; hiệu dụng = max(offRoute_m, 1.5 × accuracy_m)
  offRouteFixes: number;     // số fix liên tiếp ngoài ngưỡng
  offRouteSeconds: number;   // và đã kéo dài ít nhất bấy nhiêu giây
  maxAccuracy_m: number;     // fix kém hơn thì bỏ, không cập nhật gì
  approach_m: number;        // đọc "Trong X nữa, …" khi còn ≤
  pre_m: number;             // đọc câu rẽ khi còn ≤
  arrive_m: number;          // bán kính đến nơi / qua điểm via
  rerouteCooldown_s: number; // 15
  rerouteMaxFailures: number;// 3
}
export const NAVIGATION_THRESHOLDS: Readonly<Record<TravelMode, NavigationThresholds>>;

export interface NavigationProgress {
  status: NavigationStatus;
  route: Route;
  routeIndex: number;
  legIndex: number;
  stepIndex: number;
  step: RouteStep;
  /** Bước có điểm rẽ kế tiếp; null khi step hiện tại là `arrive`. */
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
  /** 3 = câu rẽ / đến nơi, 2 = "Trong X nữa", 1 = verbal_post. Lớp dán cắt câu đang đọc có ưu tiên thấp hơn hoặc bằng. */
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
  routeIndex?: number;            // mặc định 0
  provider?: RouteProvider;       // thiếu + reroute 'auto' → ném lỗi ngay khi tạo
  reroute?: 'auto' | 'manual';    // mặc định 'auto'
  lang?: DirectionsLang;          // mặc định 'vi'; dùng cho câu "Trong X nữa" và request tính lại
  thresholds?: Partial<NavigationThresholds>;
}

export interface Navigator {
  readonly status: NavigationStatus;
  readonly progress: NavigationProgress | null;
  /** Đồng bộ. Fix kém accuracy bị bỏ; fix có timestamp ≤ fix trước bị bỏ. */
  update(fix: GeoFix): void;
  /** Thay tuyến (app tự tính lại, hoặc đổi sang tuyến thay thế). Reset bước, lịch đọc, bộ đếm lệch. */
  setRoute(response: DirectionsResponse, routeIndex?: number): void;
  /** Gọi provider ngay (bỏ cooldown), dùng cho `reroute: 'manual'` hoặc nút "Tính lại". */
  reroute(): Promise<void>;
  stop(): void;
  on<K extends keyof NavigationEvents>(event: K, handler: (e: NavigationEvents[K]) => void): void;
  off<K extends keyof NavigationEvents>(event: K, handler: (e: NavigationEvents[K]) => void): void;
}

export function createNavigator(opts: NavigatorOptions): Navigator;
```

`Route`, `RouteStep`, `Waypoint`, `DirectionsResponse`, `DirectionsOptions`, `TravelMode`,
`DirectionsLang` là kiểu sẵn có của spec A.

### 4.3 Ngưỡng mặc định theo phương tiện

| | `walk` | `motorbike` | `car` |
|---|---|---|---|
| `offRoute_m` | 25 | 40 | 50 |
| `offRouteFixes` / `offRouteSeconds` | 3 / 5 | 3 / 5 | 3 / 5 |
| `maxAccuracy_m` | 60 | 100 | 100 |
| `approach_m` | 40 | 200 | 400 |
| `pre_m` | 15 | 50 | 80 |
| `arrive_m` | 15 | 25 | 30 |
| `rerouteCooldown_s` / `rerouteMaxFailures` | 15 / 3 | 15 / 3 | 15 / 3 |

Đây là số khởi điểm; mục 11 yêu cầu ghi lại số đo thực địa và chỉnh nếu cần (kèm DEVLOG).

### 4.4 Máy trạng thái

```
idle ──start()──► navigating ──lệch xác nhận──► off_route ──auto & hết cooldown──► rerouting ──tuyến mới──► navigating
                     │  ▲                          │  ▲                              │
                     │  └── quay lại trong ngưỡng ──┘  └── provider lỗi ×3 (final) ───┘ (ở lại off_route)
                     └──trong arrive_m của đích──► arrived
      bất kỳ ──stop()──► stopped
```

**Bám tuyến theo cửa sổ (`snapToRoute`).** Ứng viên là các đoạn polyline từ `shapeIndex − 2` tới đoạn có
khoảng cách cộng dồn ≤ `traveled_m + cửa_sổ`, với `cửa_sổ = 300 m + 40 m/s × (t_fix − t_fix_trước)`,
trần 3 km. Chọn đoạn có khoảng cách vuông góc nhỏ nhất; hai đoạn chênh dưới 10 m thì ưu tiên đoạn có hướng
gần `heading` GPS (khi có) rồi đoạn xa hơn theo chiều đi. Không tìm ngoài cửa sổ: tuyến đi qua cùng con
đường hai lần (rất thường ở phố có dải phân cách) sẽ không bị nhảy lên đoạn sau. Fix đầu tiên sau
`start()`/`setRoute()` tìm trên **toàn tuyến**.

**Lệch tuyến.** Fix có `offRoute_m > max(offRoute_m, 1.5 × accuracy_m)` là "ứng viên lệch". Ứng viên lệch
`offRouteFixes` lần liên tiếp **và** kéo dài ≥ `offRouteSeconds` (theo timestamp) → `off_route`, phát
`offRoute`. Trường hợp thứ hai cũng coi là lệch: `traveled_m` **lùi** hơn `offRoute_m` so với đỉnh đã đạt
trong `offRouteFixes` fix liên tiếp (người dùng quay đầu chạy ngược trên chính tuyến — khoảng cách vuông
góc vẫn 0 nên luật thứ nhất không bắt được). Một fix trở lại trong ngưỡng → về `navigating`, xoá bộ đếm.
Trong khi `off_route`, `progress` vẫn phát (snapped = điểm gần nhất trong cửa sổ) để UI không đứng hình.

**Tính lại.** `reroute: 'auto'`: khi vào `off_route` và đã qua `rerouteCooldown_s` kể từ lần gọi trước →
`rerouting`, gọi `provider.directions({ from: [fix.lat, fix.lng], to, via, mode: route.mode, lang,
alternatives: false })` với `to` = `waypoints[cuối].location` và `via` = `location` của các waypoint
chưa qua (`waypoints[legIndex+1 … n−2]`), đổi `[lng, lat]` → `[lat, lng]` như `DirectionsOptions` yêu
cầu. Kết quả về mà trạng thái vẫn `rerouting` → `setRoute()` nội bộ, phát `reroute { reason: 'off_route' }`,
đọc lại câu khởi hành. Lỗi → `rerouteFailed { attempts, final }`, quay về `off_route`; `final = true` sau
`rerouteMaxFailures` lỗi liên tiếp, từ đó không tự gọi nữa cho tới khi về `navigating` hoặc app gọi
`reroute()`/`setRoute()`. `'manual'`: không gọi provider bao giờ; `reroute()` vẫn dùng được.

**Bước, leg, via, đến nơi.** `stepIndex` là step có `shape_begin ≤ shapeIndex < shape_end` (step cuối
của leg có `shape_begin = shape_end`, là điểm; thuộc về step đó khi `shapeIndex ≥ shape_begin`). Đổi step
→ `step`. `traveled_m` vượt mốc `shape_offset` của leg kế **hoặc** fix trong `arrive_m` của
`waypoints[legIndex+1].snapped` → `waypoint`, `legIndex++`. `remaining_m ≤ arrive_m`, hoặc fix trong `arrive_m` của điểm cuối tuyến **khi đang ở leg cuối và
`remaining_m ≤ 150 m`** (tuyến một chiều vòng qua đích có thể đi sát đích khi còn vài trăm mét) →
`arrived`, phát `arrive`; sau đó `update()` không làm gì.

**Bỏ fix.** `accuracy_m > maxAccuracy_m` hoặc `timestamp ≤ timestamp trước` → bỏ, không phát gì. Fix
đầu tiên cách tuyến hơn ngưỡng lệch (người dùng bấm bắt đầu khi chưa tới điểm xuất phát) → vào thẳng
`off_route` theo luật thường (3 fix / 5 s) rồi tính lại; không có trạng thái riêng.

### 4.5 Lịch đọc (`announce.ts`)

Mỗi câu đọc **một lần** cho mỗi cặp (`stepIndex`, `kind`); `setRoute()` xoá bộ nhớ đã đọc. Ký hiệu
`S[i]` là step i, `D` = `distanceToStep_m`.

1. `depart` (ưu tiên 3): ngay sau fix hợp lệ đầu tiên, đọc `S[0].verbal_pre` (Valhalla đã gộp multi-cue
   "Rồi, trong 100 mét nữa, …" khi step kế ngắn).
2. `post` (ưu tiên 1): khi vừa đổi sang step i ≥ 1 và `S[i].distance_m > approach_m + pre_m`, đọc
   `S[i].verbal_post` ("Tiếp tục đi thêm 300 mét."). Step ngắn hơn thì bỏ để không nói dồn.
3. `approach` (ưu tiên 2): khi `D ≤ approach_m` và `S[i].distance_m > approach_m + pre_m` (step đủ dài để câu
   có nghĩa), đọc `composeApproach(D, S[i+1])`:
   - `vi`: `"Trong " + formatDistance(roundForSpeech(D), 'vi') + " nữa, " + hạChữĐầu(S[i+1].verbal_alert ?? S[i+1].verbal_pre)`
   - `en`: `"In " + formatDistance(…, 'en') + ", " + hạChữĐầu(…)`
   - `roundForSpeech`: ≥ 200 m làm tròn 50; dưới 200 m làm tròn 10; tối thiểu 10.
4. `pre` (ưu tiên 3): khi `D ≤ pre_m`, đọc `S[i+1].verbal_pre`. Nếu `S[i+1].kind = 'arrive'` thì
   `kind = 'arrive'` (câu đến nơi, ví dụ "Điểm đến ở bên trái.").
5. Không đọc khi `off_route`/`rerouting`; câu khởi hành của tuyến mới đọc như mục 1.

`formatDistance(m, lang)`: `vi` → `"85 mét"`, `"1,2 ki-lô-mét"` (một chữ số lẻ dưới 10 km, nguyên từ 10 km;
viết "ki-lô-mét" để giọng đọc phát âm đúng); `en` → `"85 meters"`, `"1.2 kilometers"`.
`formatDistanceShort(m)` → `"85 m"`, `"1,2 km"` cho UI.

### 4.6 `simulateFixes(route, opts)`

```ts
simulateFixes(route: Route, opts?: {
  speed_mps?: number;   // mặc định theo mode: walk 1.4, motorbike 8, car 12
  interval_s?: number;  // 1
  accuracy_m?: number;  // 8
  jitter_m?: number;    // 0 — nhiễu vị trí đều hai chiều, PRNG có seed
  seed?: number;        // 1
  start_ms?: number;    // 1_700_000_000_000
}): GeoFix[]
```

Đi dọc polyline với vận tốc hằng; `heading` = hướng đoạn; `speed_mps` = vận tốc. Thuần, xác định, dùng
cho unit test core và `playbackSource` của web. Test tự ghép chuỗi lệch bằng cách nối `simulateFixes` của
một tuyến khác hoặc dịch toạ độ.

### 4.7 Kích cỡ

Ước +3–4 kB gzip. `.size-limit.json` của core nâng trần lên **16 kB**; đo sau build và ghi DEVLOG. Nếu
vượt 16 kB: chuyển `navigation/` thành entry riêng `@mapslibvn/core/navigation` (exports map + entry thứ
hai của tsup) thay vì nâng tiếp — ghi quyết định phát sinh.

## 5. SDK web (`packages/web`) và React

### 5.1 File mới

| File | Việc |
|---|---|
| `routes-layer.ts` | `createRoutesLayer(gl, ml)` → `map.routes` |
| `position-source.ts` | `geolocationSource(opts?)`, `playbackSource(fixes, opts?)` |
| `speech.ts` | `createSpeech(opts)` |
| `navigation.ts` | `createNavigation(map, deps)` → `map.navigation` |

`MapsLibVNMap` thêm hai thuộc tính `routes` và `navigation`; `remove()` gọi `navigation.stop()` và
`routes.clear()` trước `gl.remove()`. `index.ts`/`umd.ts` xuất thêm `geolocationSource`,
`playbackSource`, `createNavigator`, `simulateFixes`, `formatDistance`, `formatDistanceShort`,
`NAVIGATION_THRESHOLDS` và các kiểu.

### 5.2 `map.routes`

```ts
interface RoutesLayer {
  show(response: DirectionsResponse, opts?: { active?: number; markers?: boolean }): void;
  setActive(index: number): void;
  setProgress(shapeIndex: number, snapped: [number, number]): void;
  clear(): void;
}
```

- Một source GeoJSON `mapslibvn-route`; feature `kind ∈ 'alt' | 'active' | 'traveled'`. Bốn layer theo
  thứ tự dưới→trên: `mapslibvn-route-alt` (`#9ca8ba`, 5 px), `mapslibvn-route-casing` (trắng, 9 px),
  `mapslibvn-route-line` (`#2458a6`, 6 px), `mapslibvn-route-traveled` (`#2458a6` alpha 0,35, 6 px).
  Chèn **trước layer `symbol` đầu tiên** của style để nhãn đường nằm trên tuyến; style không có symbol
  thì chèn trên cùng. Source/layer thêm lại sau `styledata` nếu app đổi style.
- `setProgress` cắt polyline tuyến chính tại (`shapeIndex`, `snapped`): phần trước thành `traveled`, phần
  sau thành `active`. Gọi mỗi fix (≤ 1 lần/giây) — `setData` GeoJSON vài trăm điểm là rẻ.
- `markers: true` (mặc định) đặt `maplibregl.Marker` cho đích và các via; `clear()` gỡ.
- Bấm vào tuyến thay thế → sự kiện `routeClick { index }` trên `map`; app gọi `setActive` và
  `navigation.start` với `routeIndex` tương ứng. `MapEvents` thêm `routeClick`.

### 5.3 `PositionSource`

- `geolocationSource({ enableHighAccuracy = true, maximumAge = 1000, timeout = 10000 })`:
  `watchPosition` → `GeoFix` (`coords.accuracy`, `heading` NaN → null, `speed` null giữ null; `timestamp`
  thiếu hoặc không phải số → `Date.now()`); lỗi → `PositionError` với `code` ánh xạ từ
  `PERMISSION_DENIED | POSITION_UNAVAILABLE | TIMEOUT`. `unsubscribe` gọi `clearWatch`. Không có
  `navigator.geolocation` → `onError({ code: 'unavailable' })` ngay.
- `playbackSource(fixes, { rate = 1 })`: phát từng fix theo chênh `timestamp` chia `rate` bằng
  `setTimeout`; `unsubscribe` dừng. `rate: 0` phát tất cả trong một tick (E2E).

### 5.4 `createSpeech`

```ts
createSpeech({ lang: 'vi' | 'en'; rate?: number; volume?: number; synth?: SpeechSynthesis }) → {
  speak(text: string, priority: 1 | 2 | 3): void;  // cắt câu đang đọc nếu priority mới ≥ priority cũ
  warmUp(): void;                                  // speak('') — gọi trong user gesture để iOS mở khoá
  cancel(): void;
  readonly available: boolean;                     // có synth và có voice khớp lang
}
```

Chọn voice `lang` bắt đầu bằng `vi` (hoặc `en`); danh sách rỗng lúc đầu thì chờ `voiceschanged` một lần.
Không có voice khớp → `available = false`, `speak` im, `map.navigation` phát `voiceUnavailable` **một lần**
lúc `start()`. Không ném lỗi trong bất kỳ trường hợp nào.

### 5.5 `map.navigation`

```ts
map.navigation.start({
  response: DirectionsResponse;
  routeIndex?: number;
  provider?: RouteProvider;                 // mặc định map.places
  reroute?: 'auto' | 'manual';
  lang?: 'vi' | 'en';                       // mặc định theo `lang` của map (kiểu Lang = 'vi' | 'en')
  voice?: boolean | { rate?: number; volume?: number };   // mặc định true
  follow?: boolean | { zoom?: number; pitch?: number; padding?: maplibregl.PaddingOptions }; // mặc định true
  source?: PositionSource;                  // mặc định geolocationSource()
  thresholds?: Partial<NavigationThresholds>;
  wakeLock?: boolean;                       // mặc định true
}): void;
map.navigation.stop(): void;
map.navigation.recenter(): void;           // bật lại bám theo
map.navigation.reroute(): Promise<void>;
map.navigation.state: NavigationProgress | null;
map.navigation.status: NavigationStatus;
map.navigation.on/off(event, handler);     // NavigationEvents + followChange + positionError + voiceUnavailable
```

Nối dây trong `start()`:

1. `routes.show(response, { active: routeIndex })`; tạo `createNavigator`; `speech.warmUp()` khi
   `voice` bật (còn trong gesture của nút Bắt đầu).
2. `source.subscribe(fix => navigator.update(fix), err => emit('positionError', err))`.
3. `progress` → `routes.setProgress`, cập nhật puck, camera nếu đang bám.
4. `announce` → `speech.speak(text, priority)`.
5. `reroute` → `routes.show(response)` tuyến mới.
6. `arrive` → `stop()` phần nguồn vị trí và wake lock, giữ tuyến trên bản đồ tới khi app gọi
   `routes.clear()`.
7. Wake lock: `navigator.wakeLock.request('screen')` nếu có; xin lại khi `visibilitychange` về `visible`.

**Puck**: một `maplibregl.Marker` với phần tử `div` có style inline (mũi tên 22 px xanh `#2458a6`, viền
trắng, đổ bóng; không cần file CSS), `rotationAlignment: 'map'`, `pitchAlignment: 'map'`, `rotation =
progress.bearing`, vị trí `progress.snapped`.

**Camera bám**: mỗi `progress` khi `follow` bật → `gl.easeTo({ center: snapped, bearing, zoom, pitch,
padding, duration: min(1000, Δt_fix) })`; zoom mặc định theo mode `walk 17 / motorbike 16.5 / car 15.5`,
pitch 45. `dragstart`, `wheel`, `touchstart` hai ngón → tắt bám, `followChange(false)`; `recenter()` →
bật lại, `followChange(true)`. `follow: false` → không đụng camera.

`stop()`: unsubscribe nguồn, `speech.cancel()`, nhả wake lock, gỡ puck, `navigator.stop()`, gỡ listener
drag; **không** xoá tuyến (app quyết); `status` về `'idle'` và `state` về `null` (mỗi `start()` tạo
navigator mới nên `'stopped'` của core không lộ ra web). Gọi `start()` khi đang chạy → `stop()` trước.

### 5.6 React (`packages/react`)

```ts
const { status, progress, start, stop, recenter, reroute } = useNavigation();
```

`useSyncExternalStore` đăng ký `status` + `progress` trên `map.navigation` của `useMap()`. Không thêm
component. `index.ts` xuất `useNavigation` và kiểu `NavigationProgress`, `NavigationStatus`,
`Announcement`, `RouteProvider`. `MapsLibVNMap` không đổi.

### 5.7 Kích cỡ

Ước web wrapper +5 kB gzip (4,59 → ~10 kB), dưới trần 15 kB. UMD +~10 kB, dưới 350 kB. Đo sau build.

## 6. Worker (`apps/api/src/routing/`)

### 6.1 `verbal_alert`

`RouteStep` thêm `verbal_alert: string | null` từ `verbal_transition_alert_instruction` (thiếu → `null`).
Đây là bổ sung trường; mọi trường của spec A giữ nguyên tên và nghĩa. Cập nhật `types.ts` core, `api.md`
mục 4 và 7, fixture kỳ vọng trong test Worker.

### 6.2 `vi-phrases.ts`

`translateDirections(json, mode, graph, lang)` nhận thêm `lang`; khi `lang === 'vi'`, mỗi chuỗi
`instruction`, `verbal_alert`, `verbal_pre`, `verbal_post` đi qua `applyViPhrases(text)`: mảng luật
`{ pattern: RegExp, replace: string | (m) => string }` áp tuần tự, cờ `u`. Ràng buộc bắt buộc với mọi luật:

- Chỉ khớp chữ **của câu mẫu**: neo `^` đầu câu hoặc `\.$` cuối câu, hoặc cụm nhiều từ không thể là tên
  đường ("hình chữ U", "đoạn đường nối", "tại đoạn rẽ").
- Có test chạy toàn bộ luật trên (a) mọi `street_names` trong hai fixture Valhalla, (b) 300 địa chỉ của
  `packages/core/tests/fixtures/addresses.jsonl`, (c) danh sách 63 tỉnh `provinces.json` — không luật
  nào được đổi bất kỳ chuỗi nào trong ba tập đó.
- Mỗi luật có test riêng câu trước → câu sau; snapshot toàn bộ fixture `q1-motorbike` sau khi vá.
- `lang = 'en'` không đi qua bảng.

Bảng đề xuất ban đầu (PHONG duyệt bảng cuối trong plan, trước khi deploy):

| Câu Valhalla | Sửa thành |
|---|---|
| `Điểm đến của bạn nằm ở trái.` / `… phải.` | `Điểm đến ở bên trái.` / `… phải.` |
| `Địa điểm của bạn sẽ nằm ở trái.` (alert) | `Điểm đến ở bên trái.` |
| `Bạn đã đến điểm dừng.` | giữ |
| `Rẽ trái hình chữ U…` / `Rẽ phải hình chữ U…` | `Quay đầu bên trái…` / `… phải…` |
| `Sáp nhập.` / `Sáp nhập trái/phải…` / `Sáp nhập vào…` (đầu câu) | `Nhập làn.` / `Nhập làn bên trái/phải…` / `Nhập vào…` |
| `đoạn đường nối` | `đường nhánh` |
| `Rẽ ra ngoài tại đoạn rẽ…` / `Rẽ vào đoạn rẽ <số>…` / `đoạn rẽ <số>` | `Ra ở lối ra…` / `Vào lối ra <số>…` / `lối ra <số>` |
| `Giữ trái…` / `Giữ phải…` (đầu câu) | `Giữ bên trái…` / `Giữ bên phải…` |
| `Lái về phía <hướng>` (đầu câu khởi hành) | `Đi về hướng <hướng>` |
| `, Rẽ` · `, Đi` · `, Giữ` · `, Vào` · `, Quay` sau `nữa,` hoặc `Rồi,` / `Rồi Rẽ` | hạ chữ đầu động từ |

Luật nào PHONG bỏ thì xoá khỏi bảng, không giữ luật tắt.

## 7. Kiểm thử

### 7.0 Fixture dùng chung

`packages/core/tests/fixtures/directions-q1.json`: `DirectionsResponse` dịch từ
`apps/api/test/fixtures/valhalla/q1-motorbike.json` bằng `translateDirections()` (sau vá cụm từ, `lang=vi`).
Một test trong `apps/api/test` so file này với kết quả dịch hiện tại — lệch là đỏ, chạy `--update` để ghi
lại. Docs `prebuild` (`scripts/copy-sdk.mjs`) chép sang `apps/docs/public/fixtures/directions-q1.json`
cho demo và E2E. Một nguồn, ba nơi dùng, không chép tay.

### 7.1 Core (vitest, không DOM)

- `geometry`: chiếu điểm lên đoạn (trong/ngoài hai đầu), haversine với cặp đã biết, bearing bốn hướng;
  `snapToRoute` trên tuyến tự giao (đi qua cùng đoạn đường hai lần) chọn đoạn trong cửa sổ, không nhảy.
- `progress`: mốc mét step/leg từ fixture; ETA giảm đơn điệu dọc tuyến; `distanceToStep_m` = 0 ở step cuối.
- `navigator` với `simulateFixes(directions-q1)`:
  - đi đúng → `step` 5 lần, `arrive` một lần, `status` kết `arrived`; `progress` mỗi fix;
  - lệch (dịch 80 m từ fix thứ 10) → `offRoute` sau đúng 3 fix/≥5 s; provider giả trả tuyến mới →
    `rerouting` → `reroute` → `navigating`, `announce depart` lại;
  - provider giả ném lỗi 3 lần → `rerouteFailed` ×3, lần cuối `final: true`, không gọi lần 4 dù có fix mới;
    `reroute()` tay gọi được;
  - quay đầu chạy ngược trên tuyến → `offRoute`;
  - `accuracy_m` 150 → fix bị bỏ, không sự kiện; timestamp lùi → bỏ;
  - `reroute: 'manual'` → có `offRoute`, provider không bao giờ được gọi; `'auto'` không provider → ném khi tạo;
  - kết quả tính lại về sau khi người dùng đã quay lại tuyến → bị bỏ, không `reroute`;
  - tuyến 2 leg (`two-legs.json` dịch) → `waypoint` đúng một lần, `legIndex` tăng;
  - người dùng quay lại trong ngưỡng sau 2 fix lệch → không `offRoute`.
- `announce`: snapshot thứ tự và nội dung câu trên fixture xe máy ("Trong 200 mét nữa, rẽ phải vào Nguyễn
  Du."), step ngắn không có `post`/`approach`, mỗi câu một lần; `formatDistance` vi/en các mốc 9, 85, 850,
  1.230, 12.400 m; `roundForSpeech`.
- `simulateFixes`: số fix ≈ tổng chiều dài / (vận tốc × interval); heading khớp đoạn; seed cho kết quả lặp.

### 7.2 Web (vitest + fake maplibre mở rộng)

- `routes.show` thêm source + 4 layer trước symbol đầu; `setProgress` chia traveled/active; `clear` gỡ hết;
  bấm alt → `routeClick`.
- `navigation.start` với `playbackSource(fixes, { rate: 0 })` và fake `speechSynthesis`: `speak` gọi với
  voice `vi-VN`, câu ưu tiên 3 cắt câu ưu tiên 1; `voice: false` không gọi; không voice → `voiceUnavailable`
  một lần.
- Camera: `easeTo` được gọi với `bearing`/`zoom` theo mode; `dragstart` → không `easeTo` nữa +
  `followChange(false)`; `recenter()` → có lại.
- `geolocationSource` với fake `navigator.geolocation`: ánh xạ trường, lỗi → `PositionError`, unsubscribe
  → `clearWatch`.
- `stop()` gỡ marker, unsubscribe, cancel speech, nhả wake lock (fake `navigator.wakeLock`).
- `map.remove()` gọi `navigation.stop()`.

### 7.3 Worker (vitest, không dịch vụ ngoài)

- Từng luật `vi-phrases`; luật không đụng ba tập tên (mục 6.2); `lang=en` không áp; `verbal_alert` có
  mặt/null; snapshot fixture; test đồng bộ `directions-q1.json` (mục 7.0).
- `test-routing/directions.rtest.mjs` (Valhalla fixture, `pnpm test:routing`): thêm kiểm câu đến nơi bằng
  "ở bên trái/phải" và không còn "hình chữ U", "Sáp nhập" trong ba tuyến mẫu.

### 7.4 E2E docs (Playwright, không Valhalla)

`apps/docs/e2e/dan-duong-demo.spec.ts`: mở `/dan-duong-demo/?api=http://localhost:8787&fixture=1&simulate=1`
→ demo dùng provider fixture (`fetch('/fixtures/directions-q1.json')`), `playbackSource(simulateFixes(...),
{ rate: 20 })`, `voice: false`; kiểm `[data-status]` đi `navigating → arrived` trong 30 s, danh sách câu đã
"đọc" (demo ghi ra `<ol data-announcements>`) có ít nhất một câu bắt đầu bằng "Trong " và câu cuối là câu
đến nơi, `map.gl.getLayer('mapslibvn-route-line')` tồn tại, bảng chỉ dẫn hiện `distanceToStep` giảm.

### 7.5 Thực địa (PHONG)

Mở `/dan-duong-demo/` production trên điện thoại (Safari iOS hoặc Chrome Android), chọn tuyến đi bộ ~1 km
có ≥ 3 chỗ rẽ, bấm Bắt đầu, đi hết tuyến, **cố ý lệch một lần** (rẽ nhầm rồi đi tiếp ≥ 30 m). Ghi
`docs/evidence/navigation/<ngày>-di-bo.md`: thiết bị/trình duyệt, số fix và accuracy điển hình (demo
hiện), câu đã đọc và có đúng chỗ không, thời gian từ lúc lệch tới khi có tuyến mới, có `arrived` không, màn
hình có tắt không, pin. Ngưỡng mục 4.3 nào sai thì chỉnh và ghi DEVLOG.

## 8. Docs (`apps/docs`)

- `src/content/docs/dan-duong.md` (sidebar "Hướng dẫn" sau "Tìm kiếm & autocomplete"): khái niệm
  (tuyến → navigator → sự kiện), ví dụ đầy đủ web (autocomplete chọn đích → `directions()` →
  `routes.show()` → `navigation.start()` → vẽ bảng chỉ dẫn từ `progress`, icon theo `ManeuverKind`),
  bảng sự kiện, bảng ngưỡng mặc định, giả lập bằng `simulateFixes` + `playbackSource`, `reroute: 'manual'`,
  giới hạn trình duyệt (HTTPS bắt buộc; iOS tạm dừng GPS khi tắt màn hình — web không dẫn đường nền; giọng
  tiếng Việt tuỳ máy; quota `directions` khi tính lại), React `useNavigation`.
- `src/pages/dan-duong-demo.astro` + `src/lib/dan-duong-demo.ts` (vanilla, ESM `@mapslibvn/web` như
  React demo): ô chọn điểm đi/đến bằng `<mapslibvn-autocomplete>` (hoặc bấm bản đồ), chọn phương tiện, nút
  Tìm tuyến / Bắt đầu / Giả lập / Dừng, bảng chỉ dẫn tối giản (icon, câu, khoảng cách, ETA), danh sách câu
  đã đọc, trạng thái GPS (số fix, accuracy). Query `api`, `key`, `fixture`, `simulate` cho E2E. Sidebar
  "Thử nghiệm" thêm "Demo dẫn đường".
- `api.md`: `verbal_alert` trong response mẫu và kiểu `RouteStep`; ghi rõ câu tiếng Việt đã qua bảng cụm
  từ của MapsLibVN.
- `sdk.md`: mục core thêm `createNavigator`, `simulateFixes`, `formatDistance`; mục web thêm
  `map.routes`, `map.navigation`, `geolocationSource`, `playbackSource`; mục React thêm `useNavigation`.
- `tinh-nang.md` mục 5: dòng "Dẫn đường từng bước trên web: bám GPS, đọc tiếng Việt, tự tính lại khi lệch".
- `react.md`: ví dụ `useNavigation`.

## 9. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| GPS nhiễu trong phố hẹp, dưới cầu vượt → báo lệch giả, tính lại tốn quota | Ngưỡng theo accuracy, xác nhận 3 fix + 5 s, cửa sổ snap, cooldown 15 s, trần 3 lỗi; chốt lại ngưỡng sau thực địa |
| Tuyến đi qua cùng đường hai lần → bám nhầm đoạn sau | Snap theo cửa sổ, không tìm toàn tuyến sau fix đầu |
| iOS dừng `watchPosition` khi tắt màn hình | Wake lock; docs ghi rõ web không dẫn đường nền; là việc spec C |
| Không có giọng tiếng Việt / iOS chặn audio | `voiceUnavailable`, UI vẫn có chữ; `warmUp()` trong gesture |
| `timestamp` của geolocation lệch với `Date.now()` trên vài trình duyệt | Chỉ so chênh giữa các fix, không so với đồng hồ máy; thiếu → `Date.now()` |
| Người dùng bấm Bắt đầu khi còn cách điểm xuất phát vài trăm mét | Luật lệch thường → tính lại từ vị trí thật sau ~5 s; docs khuyên app gọi `directions()` từ vị trí hiện tại |
| Luật cụm từ đụng tên đường | Neo câu mẫu + test trên ba tập tên (mục 6.2) |
| Vượt trần size core/web | Đo sau build; core 16 kB, còn vượt thì entry riêng (mục 4.7) |
| Đo ở giả lập rồi kết luận (bài học tìm kiếm và spec A) | Nghiệm thu bắt buộc có thực địa và evidence |
| App đổi style bản đồ lúc đang dẫn | Thêm lại source/layer sau `styledata` |
| `q1-motorbike` chỉ có câu rẽ trái/phải, không có vòng xuyến/nhánh/nhập làn để kiểm luật vá trên câu thật | Test luật bằng câu mẫu từ `vi-VN.json`; `test:routing` kiểm thêm khi có tuyến qua vòng xuyến trong fixture Quận 1 (Công trường Công xã Paris có vòng xuyến trong evidence) |

## 10. Đường nâng cấp đã dự trù

- **Spec C (React Native)**: dùng nguyên `createNavigator`, `NAVIGATION_THRESHOLDS`, `Announcement`; viết
  `PositionSource` từ `expo-location` (kể cả nền), đọc `announce` bằng `expo-speech`, vẽ tuyến bằng
  `ShapeSource`/`LineLayer` của maplibre-react-native. Không cần đổi core.
- **UI đóng gói**: web component `<mapslibvn-navigation>` đọc `map.navigation` — làm khi có tenant cần.
- **Worker tự sinh câu tiếng Việt** từ dữ liệu có cấu trúc (bỏ text Valhalla) — nếu bảng cụm từ vượt ~30
  luật hoặc đổi engine.
- **Tính lại khi có tuyến tốt hơn**, làn đường, tốc độ — sau khi có dữ liệu thực địa.
- **Provider chạy trên client** (spec A mục 10): chỉ cần thoả `RouteProvider`.

## 11. Nghiệm thu spec B

1. `pnpm test` xanh (core, web, react, Worker); `pnpm typecheck`, `pnpm lint` xanh; size-limit core ≤ 16 kB,
   web ≤ 15 kB, UMD ≤ 350 kB — số đo ghi DEVLOG.
2. `pnpm --filter @mapslibvn/docs e2e` xanh, gồm `dan-duong-demo.spec.ts`.
3. `pnpm test:routing` xanh với ca kiểm câu đã vá.
4. Worker deploy tay (`wrangler deploy --env production`, Actions còn khoá): `pnpm smoke:directions
   --confirm-production --requests=20` xanh; response production có `verbal_alert` và câu đến nơi là
   "Điểm đến ở bên trái/phải."
5. Thực địa mục 7.5 đạt: câu rẽ đọc trước chỗ rẽ trong khoảng ngưỡng, lệch một lần → có tuyến mới trong
   ≤ 30 s kể từ khi lệch, tới nơi có `arrived`; evidence có file.
6. Docs production có trang `dan-duong` và `/dan-duong-demo/`; `api.md` có `verbal_alert`.
7. DEVLOG mục 1–2, `docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md` và memory trạng thái mốc
   cập nhật; spec A mục 9 sửa một dòng ("vá `vi-VN.json` bằng volume mount" → "vá ở Worker, xem spec B")
   kèm dòng quyết định phát sinh trong DEVLOG.

## 12. Việc tay của PHONG

- Review file này, rồi plan.
- Duyệt bảng cụm từ cuối (mục 6.2) trước khi deploy Worker.
- Thực địa đi bộ (mục 7.5) và gửi số liệu nếu Fable không có trên máy.
- Khi GitHub Actions mở lại: chạy workflow `Routing tests` (nợ từ spec A) — không chặn spec B.
