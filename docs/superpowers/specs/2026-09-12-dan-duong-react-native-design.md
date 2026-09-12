# MapsLibVN — Thiết kế dẫn đường, spec C: SDK React Native (phiên độc lập, định vị nền, TTS native)

- Ngày: 2026-09-12
- Trạng thái: bản viết sau brainstorming với PHONG (9 quyết định đã duyệt cùng ngày, mục 1.5); chờ PHONG
  review file này trước khi viết plan
- Chủ dự án: PHONG
- Tài liệu do Fable 5.1 viết
- Spec trước: `2026-09-12-dan-duong-core-web-design.md` (spec B, đã phát hành 12/09/2026) — mục 1.3 và 10
  của spec B trỏ sang file này. Spec M6 `2026-09-03-react-native-sdk-design.md` là nền của gói
  `@mapslibvn/react-native` mà spec này mở rộng.
- Chuỗi spec dẫn đường: **A** engine + API → **B** logic dẫn đường trong core và SDK web → **C** SDK React
  Native (file này). Không đổi máy trạng thái của B.

## 0. Tóm tắt một đoạn

Gói `@mapslibvn/react-native` thêm **phiên dẫn đường** `createNavigationSession()` sống ngoài cây React:
phiên cầm `createNavigator` của core, một `PositionSource`, một `Speaker`, giữ màn hình sáng và phiên âm
thanh; API giữ nguyên chữ ký của `map.navigation` web (`start/stop/reroute`, `state`, `status`,
`on/off`). `<MapsLibVNMap navigation={session}>` **gắn** bản đồ vào phiên để vẽ tuyến, puck và camera bám;
gỡ prop hay unmount bản đồ không dừng phiên, một phiên gắn được nhiều bản đồ. Mọi thứ phụ thuộc nền tảng
là interface có mặc định Expo ở entry riêng `@mapslibvn/react-native/expo`: định vị **cả khi khoá máy**
bằng `expo-location` + `expo-task-manager` (một nguồn cho cả tiền cảnh lẫn nền, tự rơi về tiền cảnh khi
app chưa cấu hình), đọc câu bằng `expo-speech`, phát khi nền nhờ `expo-audio`, sáng màn hình bằng
`expo-keep-awake`. Core chỉ nhận thêm hàm thuần dựng GeoJSON tuyến (chuyển từ web) và hằng lớp chèn tuyến
theo theme. App thử `examples/embed-rn` có màn dẫn đường đủ luồng như Playground web, chạy máy thật.
Nghiệm thu bằng giả lập trên simulator **và** thực địa Android thật lẫn iPhone thật, lần này **có số đo**.

## 1. Mục tiêu, phạm vi, người dùng

### 1.1 Mục tiêu

1. Dev nhúng RN có tuyến từ `directions()` là dẫn đường được: một `start()`, sự kiện để vẽ UI, giọng Việt,
   tự tính lại khi lệch, **tiếp tục khi khoá màn hình hoặc chuyển app**.
2. Phiên dẫn đường **không phụ thuộc màn hình bản đồ nào đang hiện** — app gọi xe đè popup nhận cuốc, chat,
   chi tiết đơn lên bản đồ, hay unmount bản đồ, dẫn đường vẫn chạy.
3. Mọi thứ phụ thuộc nền tảng thay được: app có luồng GPS riêng bơm fix vào, app có TTS riêng cắm vào,
   app khách xem tuyến tài xế bằng feed từ máy chủ — không sửa SDK.
4. Core không đổi máy trạng thái; web không đổi hành vi.

### 1.2 Trong phạm vi spec C

- `packages/react-native`: `createNavigationSession`, gắn map (`navigation` prop), vẽ tuyến, puck, camera
  bám, `useMap().routes`, `useMap().navigation`, `useNavigation()`, `playbackSource` (copy từ web).
- Entry `@mapslibvn/react-native/expo`: `defineNavigationTask`, `expoLocationSource`, `expoSpeech`,
  `expoAudioSession`, `expoKeepAwake`, `expoNavigation`.
- Core: `routeFeatures()`, `decodeRoutes()`, `FIRST_SYMBOL_LAYER_ID`; web `routes-layer.ts` đổi sang gọi
  core, test web giữ nguyên.
- App thử `examples/embed-rn`: màn dẫn đường đủ luồng; `pnpm example:rn --device`.
- Docs: trang `dan-duong-react-native`, cập nhật `react-native.md`, `dan-duong.md`, `tinh-nang.md`,
  README gói, `THIRD_PARTY_NOTICES.md`; evidence thực địa có số; DEVLOG, trạng thái mốc; spec B mục 10
  sửa tên `ShapeSource/LineLayer` thành `GeoJSONSource/Layer`.

### 1.3 Ngoài phạm vi (ghi để không kỳ vọng nhầm)

- UI dẫn đường đóng gói (banner, ETA, nút) — app tự dựng từ sự kiện; app thử là mẫu.
- ETA theo giao thông thời gian thực, làn đường, giới hạn tốc độ, camera phạt nguội.
- Map-matching máy chủ, tuyến ngoại tuyến, tiles offline.
- Config plugin riêng của MapsLibVN gộp cấu hình expo — docs có snippet là đủ; cân nhắc sau.
- Gửi vị trí tài xế về máy chủ của app — app đăng ký `progress` và tự gửi.
- Đường dẫn đường **không** dùng Expo modules (LocationManager của maplibre + TTS tự cắm) — PHONG chọn
  không nuôi (mục 1.5); kiến trúc vẫn cho phép thêm sau vì `PositionSource`/`Speaker` là interface.
- Nhiều phiên nền cùng lúc trên một thiết bị — expo-location chỉ có một tên task; phiên thứ hai bật nền
  sẽ dùng chung task (mục 6.1).

### 1.4 Người dùng

| Vai | Cần gì từ spec C |
|---|---|
| Dev app Expo | `defineNavigationTask()` ở `index.ts`, `createNavigationSession({ provider, ...expoNavigation() })`, `<MapsLibVNMap navigation={session}>`, `useNavigation(session)` |
| Dev app bare | Như trên sau `npx install-expo-modules`; bản đồ và Places vẫn không cần Expo như M6 |
| App gọi xe (tài xế) | Phiên sống qua đổi màn hình; bơm GPS riêng qua `source`; tắt puck, đổi màu tuyến; nhiều map một phiên |
| App gọi xe (khách) | Cùng phiên với `voice: false`, `source` là feed máy chủ → ETA và tiến độ tài xế trên bản đồ khách |
| Người dùng cuối | Nghe câu rẽ đúng lúc kể cả khi khoá máy; lệch thì tự tính lại; đến nơi thì báo |
| PHONG | Cắm máy thật, thực địa hai hệ, điền bảng số liệu |

### 1.5 Quyết định đã chốt (12/09/2026)

| # | Quyết định | Chọn | Lý do ngắn |
|---|---|---|---|
| 1 | Mức chạy nền | **Cả nền**: khoá màn hình, chuyển app vẫn định vị và đọc câu | Đúng nghĩa dẫn đường bỏ túi; tiền đề kỹ thuật đã xác minh (mục 2) |
| 2 | Đường không Expo | **Không nuôi**; Expo modules là yêu cầu của dẫn đường, app bare cài `install-expo-modules` | Một đường mã, một bộ test, một trang docs; thêm sau được |
| 3 | Thiết bị thực địa | **Android thật qua USB và iPhone thật** | Hành vi nền khác nhau hai hệ; simulator không khoá máy được |
| 4 | App thử | **Đủ luồng như Playground web** | Cần cho thực địa nền và ghi số liệu |
| 5 | Kiến trúc | **Phiên độc lập + map gắn vào** (lai A và C; A "controller gắn map" và B "component khai báo" bị loại) | App gọi xe đè màn hình lên bản đồ; một phiên nhiều map; không phá API về sau |
| 6 | API phiên | Giữ chữ ký web; `start()/stop()` trả Promise; `follow` là prop của map | Docs/hook dùng lại; phải chờ quyền và đăng ký task; mỗi map tự quyết bám |
| 7 | Nguồn vị trí | `startLocationUpdatesAsync` là nguồn **duy nhất** cho cả tiền cảnh lẫn nền; tự rơi về `watchPositionAsync` + `backgroundUnavailable` | Một đường mã; app chưa cấu hình vẫn dẫn đường được |
| 8 | Quyền | Chỉ xin *When In Use*; **không** xin Always / `ACCESS_BACKGROUND_LOCATION` | Đã xác minh hai hệ không cần khi khởi động từ tiền cảnh (mục 2); tránh review khắt khe |
| 9 | Puck | Symbol layer, ảnh mũi tên SDF nhúng base64, xoay theo `bearing`, `icon-rotation-alignment: map`; dự phòng `Marker` | Không cần asset trong tarball, không cần theo dõi bearing bản đồ |

## 2. Tiền đề kỹ thuật đã xác minh (12/09/2026)

Đọc từ mã nguồn thật, không từ trí nhớ: `@maplibre/maplibre-react-native` 11.3.8 đang cài trong
`packages/react-native/node_modules`; `expo-location` 57.0.15, `expo-speech` 57.0.2, `expo-task-manager`
57.0.15, `expo-audio` 57.0.4 tải bằng `npm pack` (phiên bản `bundledNativeModules.json` của Expo 57.0.19
trong app thử).

- **maplibre-react-native 11.3.8 không có `ShapeSource`/`LineLayer`** (tên spec B mục 10 ghi là tên bản
  cũ). Có `GeoJSONSource` (`id`, `data`, `onPress`), `Layer` (`type`, `id`, `source`, `filter`, `paint`,
  `layout`, `beforeId`, `afterId`, `layerIndex`), `Images` (`images: { key: ImageEntry }`, `ImageEntry`
  nhận `{ source: ImageSourcePropType, sdf?: boolean }` — `ImageSourcePropType` của RN nhận `{ uri }`),
  `Marker` (`lngLat`, `anchor`, `offset`, không có rotation), `Camera` ref `easeTo({ center, zoom,
  bearing, pitch, padding, duration })`, `flyTo`, `fitBounds`, `setStop`; `Camera` prop
  `trackUserLocation` (bám GPS thô của native — không dùng vì ta bám điểm đã snap và bearing của core).
  `Map` có `onRegionWillChange/IsChanging/DidChange` với `ViewStateChangeEvent = { center, zoom,
  bearing, pitch, bounds, animated, userInteraction }`; `MapRef` có `getViewState()`, không có
  `getStyle()`. Có `LocationManager` native (`start/stop/addListener/requestPermissions`) và
  `UserLocation`/`NativeUserLocation` — không dùng theo quyết định 2, ghi lại làm đường bare sau này.
- **expo-location iOS**: `LocationModule.swift` `startLocationUpdatesAsync` chỉ gọi
  `ensureForegroundLocationPermissions` (bình luận trong mã: khởi động từ tiền cảnh **không cần** quyền
  nền), đòi `taskManager.hasBackgroundModeEnabled("location")` (ném `LocationUpdatesUnavailable` khi
  Info.plist thiếu `UIBackgroundModes: location`). `EXLocationTaskConsumer.m` đặt
  `allowsBackgroundLocationUpdates = YES`, `pausesLocationUpdatesAutomatically` **mặc định `true`** (khác
  docs JS nói `false`) → phải truyền `false`; `showsBackgroundLocationIndicator` mặc định `false`; gọi cả
  `startMonitoringSignificantLocationChanges` → app có thể bị đánh thức sau khi bị giết (task ma, mục 6.1).
  Ngược lại `BaseLocationProvider.swift` của `watchPositionAsync` đặt cứng
  `allowsBackgroundLocationUpdates = false` → **tiền cảnh chắc chắn ngừng khi khoá máy**. Khi app
  `active` fix được giao ngay; khi nền, `deferredUpdatesInterval/Distance` mặc định 0 nên cũng giao ngay.
- **expo-location Android**: `LocationModule.kt` `startLocationUpdatesAsync`: có `foregroundService` thì
  **không** đòi `ACCESS_BACKGROUND_LOCATION`; đòi app đang foreground lúc gọi
  (`ForegroundServiceStartNotAllowedException`), và manifest có `FOREGROUND_SERVICE` +
  `FOREGROUND_SERVICE_LOCATION` (API 34+). `LocationHelpers.kt`: `BestForNavigation` →
  `PRIORITY_HIGH_ACCURACY`, khoảng cách 0 m, 500 ms; `Highest` → 25 m, 1000 ms.
- **Plugin expo-location** (`plugin/build/withLocation.js`): `isIosBackgroundLocationEnabled` thêm
  `UIBackgroundModes: location`; `isAndroidForegroundServiceEnabled` thêm hai quyền foreground service;
  `isAndroidBackgroundLocationEnabled` thêm `ACCESS_BACKGROUND_LOCATION` (ta **không bật**);
  `locationWhenInUsePermission` đặt chuỗi `NSLocationWhenInUseUsageDescription`.
- **expo-task-manager**: `defineTask` phải ở **phạm vi toàn cục** của bundle (docs trong `.d.ts`);
  `EXTaskService.m` kiểm `UIBackgroundModes` chứa mode của consumer. Body task: `{ data: { locations:
  LocationObject[] }, error, executionInfo: { appState?, eventId, taskName } }`. Có `isTaskDefined`,
  `isTaskRegisteredAsync`, `unregisterTaskAsync`.
- **expo-speech**: iOS `SpeechModule.swift` **không đụng `AVAudioSession`**; Android dùng
  `TextToSpeech.QUEUE_ADD` (xếp hàng, muốn cắt phải `stop()` trước). API: `speak(text, { language, rate,
  pitch, volume, voice, onDone, onStopped, onError })`, `stop(): Promise`, `isSpeakingAsync`,
  `getAvailableVoicesAsync(): Voice[{ identifier, name, quality, language }]`.
- **expo-audio** `setAudioModeAsync(Partial<AudioMode>)` với `playsInSilentMode`,
  `shouldPlayInBackground`, `interruptionMode: 'mixWithOthers' | 'doNotMix' | 'duckOthers'`; plugin thêm
  `UIBackgroundModes: audio`. `AVSpeechSynthesizer` dùng phiên âm thanh của app nên đây là đường để giọng
  đọc phát khi khoá máy — **chưa kiểm trên máy thật**, là rủi ro số 1 (mục 11).
- **expo-keep-awake** nằm sẵn trong dependency của `expo`: `activateKeepAwakeAsync(tag)`,
  `deactivateKeepAwake(tag)`.
- App thử hiện tại (Expo 57.0.19, RN 0.86.3, React 19.2.3) **chưa cài** expo-location, expo-speech,
  expo-task-manager, expo-audio; `app.json` chỉ có plugin maplibre; prebuild `ios/` chưa có khoá
  `NSLocation*`. Plugin maplibre không thêm quyền vị trí.
- Style MapsLibVN: lớp symbol đầu tiên là `road_one_way_arrow` (light, chỉ số 60/104) và `water_name`
  (dark, chỉ số 8/51); lớp `poi` ở 100 và 47. Hai theme khác nhau nên không dùng một id cứng; `dist/` của
  `packages/style` không nằm trong git → test bảo vệ hằng số phải dựng template như
  `poi-layers.test.ts` đang làm.
- Core hiện có: `createNavigator`, `NAVIGATION_THRESHOLDS`, `simulateFixes`, `decodePolyline6`,
  `POI_LAYER_ID`, `localizeStyle`, `hidePoiLayer`. Web `routes-layer.ts` chứa hàm `collection()` dựng
  `alt/active/traveled` — thuần, tách được. `playbackSource` của web dùng `setTimeout` nên không vào core
  (core không timer), copy sang RN như đã copy `usePlaces`.
- Test RN chạy trong vitest root, jsdom, mock `react-native` và `@maplibre/maplibre-react-native` trong
  `packages/react-native/src/test/`; `cameraRefMock` đã có `easeTo`.

## 3. Kiến trúc

```
app RN
 ├─ index.ts: defineNavigationTask()            ← phạm vi toàn cục, bắt buộc cho nền
 ├─ session = createNavigationSession({ provider, ...expoNavigation() })   ← sống ngoài cây React
 │     start(opts) → PositionSource ─► core createNavigator ─► sự kiện SessionEvents
 │                 → Speaker (announce), KeepAwake, AudioSession
 └─ <MapsLibVNMap navigation={session}>          ← gắn để vẽ; gỡ/unmount không dừng phiên
        ├─ GeoJSONSource "mapslibvn-route" + 4 Layer tuyến + puck (symbol)   ← core routeFeatures()
        ├─ Camera.easeTo bám theo; onRegionWillChange(userInteraction) tắt bám
        └─ useMap().routes / useMap().navigation (binding của map này); useNavigation(session?)

@mapslibvn/react-native/expo
  expoLocationSource({ background })  startLocationUpdatesAsync + TaskManager; rơi về watchPositionAsync
  expoSpeech()                        expo-speech, stop() trước khi cắt câu
  expoAudioSession()                  expo-audio setAudioModeAsync (phát khi nền, duck nhạc)
  expoKeepAwake()                     expo-keep-awake
```

Nguyên tắc:

- **Phiên là chủ, map là người xem.** Phiên không biết map nào đang gắn. Nhiều map gắn một phiên được;
  gắn muộn thì vẽ lại từ `session.response` và `session.state`.
- **Một phiên nền tại một thời điểm** trên thiết bị (một tên task). Phiên thứ hai `start()` với nguồn nền
  khi phiên đầu còn chạy → nguồn nền dùng chung task, cả hai nhận fix; docs ghi rõ nên `stop()` phiên cũ.
- **Interface trước, Expo sau.** `PositionSource`, `Speaker`, `KeepAwake`, `AudioSession`,
  `RouteProvider` là hợp đồng của gói chính; entry `/expo` chỉ là một bộ hiện thực. Gói chính không
  import gói expo nào, Metro của app chỉ bản đồ không phải resolve chúng.
- **Khi app ở nền** phiên vẫn cập nhật navigator và đọc câu; map bỏ qua camera và puck cho tới khi
  `AppState` về `active`, rồi vẽ lại từ `session.state`.
- Core không biết Expo, AppState, maplibre-react-native; thời gian vẫn lấy từ `fix.timestamp`.

## 4. Thay đổi ở core (`packages/core`) — nhỏ, thuần, có test

```ts
// navigation/route-features.ts
export type RouteFeatureKind = 'alt' | 'active' | 'traveled' | 'puck';
export interface RouteFeatureCollection { type: 'FeatureCollection'; features: RouteFeature[] }
/** Giải mã polyline6 của mọi tuyến một lần; kết quả cache theo response ở lớp dán. */
export function decodeRoutes(response: DirectionsResponse): [number, number][][];
/** Dựng alt/active/traveled (và puck khi có progress) — chuyển nguyên từ `collection()` của web. */
export function routeFeatures(
  coords: readonly (readonly [number, number][])[],
  opts: { active: number; progress?: { shapeIndex: number; snapped: [number, number]; bearing: number } | null; puck?: boolean },
): RouteFeatureCollection;

// style-transform.ts
/** Lớp symbol đầu tiên của từng theme MapsLibVN — chèn tuyến trước lớp này để nhãn nằm trên tuyến. */
export const FIRST_SYMBOL_LAYER_ID: Readonly<Record<Theme, string>> = {
  light: 'road_one_way_arrow',
  dark: 'water_name',
};
```

- `routeFeatures` giữ nguyên thuật toán web: tuyến `i ≠ active` → `alt`; tuyến `active` có `progress` và
  `shapeIndex < length − 1` → `traveled` = `[...c.slice(0, shapeIndex+1), snapped]`, `active` =
  `[snapped, ...c.slice(shapeIndex+1)]`; không thì cả tuyến là `active`. `puck: true` thêm feature
  `Point` tại `snapped` với `properties.bearing`.
- Web `routes-layer.ts` xoá `collection()` cục bộ, gọi `routeFeatures(coords, { active, progress })`
  (`puck: false`, puck web vẫn là `Marker`). Test `routes-layer.test.ts` giữ nguyên, phải xanh không
  sửa.
- Test mới `packages/core/src/navigation/route-features.test.ts`; `packages/style/src/poi-layers.test.ts`
  (hoặc file test mới cạnh nó) dựng template light/dark bằng `fillTemplate`/`transformStyle` rồi khẳng
  định `layers.find(type === 'symbol').id === FIRST_SYMBOL_LAYER_ID[theme]` — style đổi thứ tự là test
  đỏ, không lộ ra máy người dùng.
- Kích cỡ: barrel core +~0,4 kB gzip; trần 20 kB hiện tại còn dư (đo 16,91 kB sau spec B). Đo lại
  sau build; không nâng trần.

## 5. Gói `@mapslibvn/react-native`

### 5.1 File mới và sửa

| File | Việc |
|---|---|
| `src/navigation/session.ts` | `createNavigationSession`, kiểu `Speaker`, `KeepAwake`, `AudioSession`, `SessionEvents` |
| `src/navigation/playback-source.ts` | copy `playbackSource` của web (30 dòng), test copy |
| `src/navigation/routes-store.ts` | store nhỏ (`useSyncExternalStore`) giữ `response`, `active`, `progress`, `puck` cho map |
| `src/navigation/route-layers.tsx` | `GeoJSONSource` + `Images` + 5 `Layer` + marker đích/via, đọc store |
| `src/navigation/map-binding.ts` | gắn/gỡ phiên vào map: listener, camera bám, AppState, `recenter`, `followChange` |
| `src/map.tsx` | props mới, tạo binding, render `RouteLayers`, `onRegionWillChange` |
| `src/context.ts` | `MapHandle` thêm `routes`, `navigation` |
| `src/use-navigation.ts` | hook |
| `src/expo/index.ts` + `src/expo/*.ts` | entry `/expo` (mục 6) |
| `src/test/mlrn-mock.tsx`, `react-native-mock.tsx` | thêm `GeoJSONSource`, `Layer`, `Images`, `AppState` |
| `src/index.ts` | xuất khẩu mới |
| `package.json`, `tsup.config.ts` | entry thứ hai, `exports['./expo']`, peer tuỳ chọn, version 0.5.0 |

### 5.2 API công khai

```ts
export interface Speaker {
  /** Cắt câu đang đọc nếu `priority` ≥ ưu tiên câu đó; thấp hơn thì xếp hàng. */
  speak(text: string, priority: 1 | 2 | 3, lang: DirectionsLang): void;
  cancel(): void;
  /** Có giọng khớp `lang` không; phiên gọi một lần lúc `start()` để phát `voiceUnavailable`. */
  available(lang: DirectionsLang): Promise<boolean>;
}
export interface KeepAwake { activate(): Promise<void> | void; deactivate(): Promise<void> | void }
export interface AudioSession { activate(): Promise<void>; deactivate(): Promise<void> }
/** `PositionSource` của core cộng hai móc tuỳ chọn; phiên nhận diện bằng `'setMode' in source`. */
export interface SessionPositionSource extends PositionSource {
  /** Phiên gọi trước `subscribe` với `mode` của tuyến (iOS activityType, Android ưu tiên). */
  setMode?(mode: TravelMode): void;
  /** Nguồn báo đã rơi về tiền cảnh; phiên phát lại thành `backgroundUnavailable`. */
  onBackgroundUnavailable?(cb: (e: SessionEvents['backgroundUnavailable']) => void): void;
}

export interface NavigationSessionOptions {
  provider: RouteProvider;
  /** Bắt buộc để `start()` chạy; thiếu → `start()` reject với thông điệp tiếng Việt chỉ cách truyền. */
  source?: SessionPositionSource;
  /** Thiếu → không đọc, không phát `voiceUnavailable`. */
  speech?: Speaker;
  keepAwake?: KeepAwake;
  audio?: AudioSession;
}
export interface NavigationSessionStartOptions {
  response: DirectionsResponse;
  routeIndex?: number;            // 0
  reroute?: 'auto' | 'manual';    // 'auto'
  lang?: DirectionsLang;          // 'vi'
  voice?: boolean | { rate?: number; volume?: number }; // true khi có `speech`
  thresholds?: Partial<NavigationThresholds>;
  keepAwake?: boolean;            // true khi có `keepAwake`
}
export interface SessionEvents extends NavigationEvents {
  positionError: PositionError;
  voiceUnavailable: undefined;
  /** Nguồn vị trí không chạy nền được và đã rơi về tiền cảnh (phát một lần mỗi `start`). */
  backgroundUnavailable: {
    reason: 'task_not_defined' | 'not_configured' | 'permission' | 'unsupported';
    message: string;
  };
  /** Phiên đã dừng nguồn vị trí: đến nơi hoặc app gọi `stop()`. */
  end: { reason: 'arrived' | 'stopped' };
}
export interface NavigationSession {
  /** Resolve sau khi đã đăng ký nguồn vị trí (có thể chờ hộp thoại quyền). Reject chỉ khi thiếu `source`. */
  start(opts: NavigationSessionStartOptions): Promise<void>;
  stop(): Promise<void>;
  reroute(): Promise<void>;
  setRoute(response: DirectionsResponse, routeIndex?: number): void;
  readonly status: NavigationStatus;              // 'idle' khi chưa start hoặc đã stop
  readonly state: NavigationProgress | null;
  readonly response: DirectionsResponse | null;   // tuyến hiện tại, để map gắn muộn vẽ lại
  readonly routeIndex: number;
  on<K extends keyof SessionEvents>(event: K, handler: (e: SessionEvents[K]) => void): void;
  off<K extends keyof SessionEvents>(event: K, handler: (e: SessionEvents[K]) => void): void;
}
export function createNavigationSession(opts: NavigationSessionOptions): NavigationSession;

// Map — thêm vào MapsLibVNMapProps của M6
export interface MapsLibVNMapProps {
  navigation?: NavigationSession;     // gắn phiên; đổi prop → gỡ cũ gắn mới; bỏ prop → gỡ và xoá tuyến
  sessionOptions?: Omit<NavigationSessionOptions, 'provider'>; // cho phiên mặc định của map
  follow?: boolean | { zoom?: number; pitch?: number; padding?: ViewPadding }; // true
  puck?: boolean;                     // true; false → app tự vẽ từ progress.snapped
  routeStyle?: { color?: string; altColor?: string; casingColor?: string; traveledOpacity?: number };
  routeBeforeLayerId?: string | null; // mặc định FIRST_SYMBOL_LAYER_ID[theme]; null = trên cùng; URL style tuỳ biến → null
  onRouteClick?: (index: number) => void;
}
export interface MapHandle {          // thêm vào M6
  routes: {
    show(response: DirectionsResponse, opts?: { active?: number }): void;
    setActive(index: number): void;
    clear(): void;
  };
  navigation: MapNavigationBinding;
}
export interface MapNavigationBinding {
  readonly session: NavigationSession;   // prop `navigation` nếu có, không thì phiên mặc định tạo lười
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
export interface BindingEvents extends SessionEvents { followChange: boolean }

export interface UseNavigationResult {
  status: NavigationStatus;
  progress: NavigationProgress | null;
  following: boolean;                 // false khi hook dùng với session ngoài map
  start(opts: NavigationSessionStartOptions): Promise<void>;
  stop(): Promise<void>;
  reroute(): Promise<void>;
  recenter(): void;                   // no-op khi không có map
}
/** Không tham số → `useMap().navigation` (phải trong <MapsLibVNMap>); có `session` → dùng được ở bất kỳ đâu. */
export function useNavigation(session?: NavigationSession): UseNavigationResult;
```

Xuất khẩu kiểu thêm: `NavigationSession`, `NavigationSessionOptions`, `NavigationSessionStartOptions`,
`SessionEvents`, `BindingEvents`, `MapNavigationBinding`, `SessionPositionSource`, `Speaker`, `KeepAwake`,
`AudioSession`, `UseNavigationResult`, và từ core: `NavigationProgress`, `NavigationStatus`, `NavigationThresholds`,
`Announcement`, `RouteProvider`, `PositionSource`, `PositionError`, `GeoFix`, `DirectionsResponse`,
`DirectionsOptions`, `DirectionsLang`, `TravelMode`. Hàm: `playbackSource`, `simulateFixes` (tái xuất từ
core), `NAVIGATION_THRESHOLDS`.

### 5.3 Hành vi phiên

1. **`start(opts)`**: đang chạy thì `stop()` trước. Thiếu `source` → reject
   `Error('Phiên dẫn đường thiếu nguồn vị trí: truyền source (ví dụ expoLocationSource() từ @mapslibvn/react-native/expo)')`.
   Tạo `createNavigator({ response, routeIndex, provider, reroute, lang, thresholds })`. Nếu `voice` bật và
   có `speech`: `await audio?.activate()` (lỗi nuốt), `speech.available(lang)` false → phát
   `voiceUnavailable` một lần. `keepAwake` bật → `activate()`. Nối `announce` → `speech.speak(text,
   priority, lang)`; `arrive` → dừng nguồn, keep-awake, audio, phát `end{arrived}`. Nguồn có `setMode`
   → gọi `source.setMode(route.mode)`; có `onBackgroundUnavailable` → nối để phát lại thành
   `backgroundUnavailable`. Cuối cùng `source.subscribe(fix => navigator.update(fix), err =>
   emit('positionError', err))`. Resolve sau `subscribe` trả về.
2. **`stop()`**: hủy đăng ký nguồn, `speech.cancel()`, `keepAwake.deactivate()`, `audio.deactivate()`,
   `navigator.stop()`, phát `end{stopped}`; `status` về `idle`, `state` về `null`, `response` giữ để map
   vẫn vẽ tuyến cho tới `routes.clear()`.
3. **`setRoute`/`reroute`** uỷ quyền navigator; sự kiện `reroute` của core đi thẳng ra `SessionEvents`.
4. Tất cả sự kiện core (`status`, `progress`, `step`, `waypoint`, `offRoute`, `reroute`,
   `rerouteFailed`, `announce`, `arrive`) phát lại nguyên trên phiên.
5. Phiên không dùng timer, không đụng React, không import Expo; test bằng vitest thuần.

### 5.4 Hành vi map

- **Phiên mặc định**: `MapsLibVNMap` tạo lười `createNavigationSession({ provider: places,
  ...sessionOptions })` lần đầu `useMap().navigation` được đọc. Không có `sessionOptions.source` thì
  `start()` reject như 5.3 — lỗi rõ, không im lặng.
- **Gắn** (`navigation` prop hoặc phiên mặc định): đọc `session.response`/`routeIndex`/`state` đưa vào
  store; đăng ký `progress` (store + camera), `reroute` (store `response` mới, `active` 0), `status`,
  `end`, và phát lại mọi `SessionEvents` ra binding. **Gỡ**: chỉ gỡ listener và xoá tuyến khỏi store;
  không gọi `session.stop()`. Đổi prop `navigation` → gỡ cũ, gắn mới. Unmount map → gỡ.
- **Camera bám**: mỗi `progress` khi `following` và `AppState.currentState === 'active'`:
  `camera.current?.easeTo({ center: snapped, bearing, zoom, pitch, padding, duration: max(0, min(1000,
  Δt_fix)) })`; zoom mặc định theo mode `walk 17 / motorbike 16.5 / car 15.5`, pitch 45 (cùng số web).
  `onRegionWillChange` với `nativeEvent.userInteraction` → `following = false`, `followChange(false)`;
  `recenter()` → `following = true`, `followChange(true)`, `easeTo` ngay theo `state`. `follow: false`
  → không đụng camera, `recenter()` no-op. `AppState` về `active` → nếu `following` thì `easeTo` một lần
  theo `state`.
- **`routes`** không cần phiên: `show(response, { active })` đưa tuyến vào store (app khách xem trước);
  khi có phiên gắn, phiên ghi đè store. `clear()` xoá tuyến, marker, puck.
- **Bấm tuyến thay thế**: `GeoJSONSource onPress` → feature đầu có `kind === 'alt'` →
  `onRouteClick(index)`. App gọi `routes.setActive(index)` rồi `session.start({ response, routeIndex:
  index })` nếu đang dẫn đường.
- `onLoad` của M6 không đổi. Đổi `style`/`lang` tạo lại map như M6; store giữ tuyến nên map mới vẽ lại.

### 5.5 Kích cỡ

Gói RN chưa có `size-limit` (M6 không đặt). Không đặt thêm; dist gộp core nên số đo không so được với
web. Ghi kích cỡ tarball trước/sau vào evidence để tham khảo.

## 6. Entry `@mapslibvn/react-native/expo`

```ts
export const NAVIGATION_TASK = 'mapslibvn-navigation-location';
/** Gọi ở phạm vi toàn cục của index.ts, trước registerRootComponent. Gọi lại là no-op. */
export function defineNavigationTask(): void;
export interface ExpoLocationSourceOptions {
  background?: boolean;                        // true
  accuracy?: Location.LocationAccuracy;        // BestForNavigation
  timeInterval_ms?: number;                    // 1000
  /** Android foreground service. Mặc định: "Đang dẫn đường" / "Chạm để mở ứng dụng". */
  notification?: { title?: string; body?: string; color?: string };
  showsBackgroundLocationIndicator?: boolean;  // iOS, true
  /** iOS `activityType` (walk → Fitness, còn lại → AutomotiveNavigation). Mặc định 'motorbike'; phiên ghi đè bằng `setMode` theo tuyến. */
  mode?: TravelMode;
}
export function expoLocationSource(opts?: ExpoLocationSourceOptions): SessionPositionSource;
export function expoSpeech(opts?: { rate?: number; volume?: number; pitch?: number }): Speaker;
export function expoAudioSession(): AudioSession;
export function expoKeepAwake(): KeepAwake;
/** Gộp bốn adapter mặc định. */
export function expoNavigation(opts?: ExpoLocationSourceOptions & { speech?: Parameters<typeof expoSpeech>[0] }):
  Pick<NavigationSessionOptions, 'source' | 'speech' | 'audio' | 'keepAwake'>;
```

### 6.1 `expoLocationSource`

- `defineNavigationTask()`: `TaskManager.defineTask(NAVIGATION_TASK, ({ data, error }) => …)`. Executor
  đẩy từng `LocationObject` trong `data.locations` (theo thứ tự) vào emitter cấp module; `error` →
  `onError({ code: 'unavailable', message })`. **Không ai đăng ký** (app bị iOS đánh thức lại bằng
  significant-change sau khi bị giết, hoặc app khởi động lại) → gọi
  `Location.stopLocationUpdatesAsync(NAVIGATION_TASK)` để không thành task ma. Ngoài ra lúc gọi
  `defineNavigationTask()` kiểm `hasStartedLocationUpdatesAsync` và dừng task cũ còn sót (bọc try/catch,
  không chặn khởi động).
- `subscribe(onFix, onError)`:
  1. `requestForegroundPermissionsAsync()` → không `granted` → `onError({ code: 'denied' })`, trả
     unsubscribe rỗng.
  2. Nếu `background` **và** `TaskManager.isTaskDefined(NAVIGATION_TASK)` **và**
     `isBackgroundLocationAvailableAsync()`: `startLocationUpdatesAsync(NAVIGATION_TASK, { accuracy,
     timeInterval, distanceInterval: 0, pausesUpdatesAutomatically: false, activityType: mode === 'walk'
     ? Fitness : AutomotiveNavigation, showsBackgroundLocationIndicator, foregroundService: {
     notificationTitle, notificationBody, notificationColor, killServiceOnDestroy: true } })` rồi đăng ký
     emitter. Thành công → xong.
  3. Điều kiện thiếu hoặc bước 2 ném → `watchPositionAsync({ accuracy, timeInterval, distanceInterval: 0 },
     onFix)` và báo `backgroundUnavailable` với `reason`: task chưa define → `task_not_defined`;
     `isBackgroundLocationAvailableAsync()` false hoặc lỗi `LocationUpdatesUnavailable`/thiếu quyền
     foreground service → `not_configured`; lỗi quyền → `permission`; còn lại → `unsupported`.
     `message` là thông điệp gốc. Kênh báo: `PositionSource` của core không có sự kiện này, nên
     `expoLocationSource` trả `SessionPositionSource` (mục 5.2) với `onBackgroundUnavailable(cb)` và
     `setMode(mode)`; phiên nhận diện bằng `in`, nguồn khác không cần biết.
  4. Ánh xạ `LocationObject` → `GeoFix`: `lng/lat`, `accuracy` null → bỏ trường, `heading`/`speed` null
     giữ null, `timestamp` của hệ (không phải số → `Date.now()`).
  5. `unsubscribe`: `stopLocationUpdatesAsync` hoặc `subscription.remove()`, gỡ khỏi emitter; lỗi nuốt.
- **Không bao giờ** gọi `requestBackgroundPermissionsAsync` (quyết định 8).
- Cấu hình app bắt buộc để có nền, ghi trong docs:

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

### 6.2 `expoSpeech`

- `speak(text, priority, lang)`: rỗng → bỏ. Đang đọc (`current > 0`) và `priority ≥ current` → `await
  Speech.stop()` rồi `Speech.speak(text, { language: BCP47[lang], rate, volume, pitch, onDone/onStopped/
  onError: current = 0 })`; thấp hơn → `speak` để hệ xếp hàng. `current = priority` khi gọi.
- `cancel()`: `Speech.stop()`, `current = 0`.
- `available(lang)`: `getAvailableVoicesAsync()`; danh sách rỗng (Android chưa khởi tạo TTS) → `true`;
  có danh sách mà không voice `language` bắt đầu bằng `vi`/`en` → `false`. Lỗi → `true` (không báo sai).

### 6.3 `expoAudioSession`, `expoKeepAwake`

- `activate()`: `setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true,
  interruptionMode: 'duckOthers' })`; `deactivate()`: `{ shouldPlayInBackground: false, interruptionMode:
  'mixWithOthers' }`. Lỗi nuốt. App có cấu hình âm thanh riêng thì không truyền `audio` vào phiên.
- `expoKeepAwake()`: `activateKeepAwakeAsync('mapslibvn-navigation')` / `deactivateKeepAwake(cùng tag)`.

### 6.4 Đóng gói entry

- `tsup` entry `['src/index.ts', 'src/expo/index.ts']`, `external` thêm năm gói expo;
  `exports['./expo']` trỏ `dist/expo/index.js` + `.d.ts`.
- `peerDependencies` thêm `expo-location`, `expo-task-manager`, `expo-speech`, `expo-audio`,
  `expo-keep-awake` với `peerDependenciesMeta.optional = true`; phiên bản tối thiểu là bản đi kèm Expo
  SDK 54 (kiểm lại số cụ thể trong plan bằng `bundledNativeModules.json` của SDK 54); `devDependencies`
  cài bản 57.x để typecheck và test. Entry chính **không** import chúng.

## 7. Vẽ tuyến, puck, camera (`route-layers.tsx`)

- Render khi store có tuyến: `<GeoJSONSource id="mapslibvn-route" data={fc} onPress={…}>` với các
  `Layer` theo thứ tự dưới→trên, `filter: ['==', ['get','kind'], kind]`, `beforeId` theo
  `routeBeforeLayerId` (mặc định `FIRST_SYMBOL_LAYER_ID[theme]` khi `style` là theme, `null` khi là URL
  tuỳ biến):

| id | type | paint |
|---|---|---|
| `mapslibvn-route-alt` | line | `#9ca8ba`, 5 px |
| `mapslibvn-route-casing` | line | `#ffffff`, 9 px |
| `mapslibvn-route-line` | line | `color` (`#2458a6`), 6 px |
| `mapslibvn-route-traveled` | line | `color` alpha `traveledOpacity` (0,35), 6 px |
| `mapslibvn-route-puck` | symbol | `icon-image: 'mapslibvn-puck'`, `icon-rotate: ['get','bearing']`, `icon-rotation-alignment: 'map'`, `icon-pitch-alignment: 'map'`, `icon-allow-overlap`, `icon-ignore-placement`, `icon-color: color`, `icon-size` theo mật độ điểm ảnh |

- `<Images images={{ 'mapslibvn-puck': { source: { uri: PUCK_DATA_URI }, sdf: true } }}>`: PNG mũi tên
  66 px hướng bắc, nhúng base64 trong mã (~400 byte), không có file asset trong tarball.
- Marker đích và via: `Marker` của SDK, màu `#d92d20` như web; `routes.clear()` gỡ.
- Feature puck do `routeFeatures(..., { puck: true })` sinh; `puck: false` → không có layer symbol.
- **Rủi ro cần kiểm ở task đầu tiên chạy máy**: MapLibre Native nạp data URI qua bộ nạp ảnh RN. Không
  nạp được → dự phòng `Marker` với `View` tam giác xoay `bearing − bearing_bản_đồ`, lấy bearing bản đồ
  từ `onRegionIsChanging`; spec giữ cả hai đường, plan chốt sau khi kiểm.
- Camera bám và tắt bám như 5.4.

## 8. Kiểm thử

Vitest root, jsdom, mock như M6 (`packages/react-native/src/test/`). Không có E2E simulator tự động.

| Test | Kiểm |
|---|---|
| core `route-features.test.ts` | `alt/active/traveled` bằng đúng test web hiện có; cắt tại `shapeIndex`; `puck` có `bearing`; `decodeRoutes` khớp `decodePolyline6` |
| `packages/style` test hằng | `FIRST_SYMBOL_LAYER_ID[theme]` bằng lớp symbol đầu tiên của template dựng thật |
| web `routes-layer.test.ts` | không sửa, vẫn xanh sau khi web gọi core |
| RN `session.test.ts` (không React) | `start` gọi `audio.activate`, `speech.available`, `keepAwake.activate`, `source.subscribe` theo thứ tự; fix từ `simulateFixes` chạy tới `arrived` → nguồn/keep-awake/audio được nhả, `end{arrived}`; `announce` → `speak(text, priority, lang)`; `stop` dọn đủ và `end{stopped}`; `positionError`, `voiceUnavailable`, `backgroundUnavailable` mỗi thứ một lần; `start` khi đang chạy stop trước; thiếu `source` reject thông điệp tiếng Việt; `voice: false` không gọi speech/audio |
| RN `map-binding.test.tsx` | gắn `navigation={session}` → `GeoJSONSource` có tuyến; `progress` → puck feature và `easeTo` đúng `center/bearing/zoom/pitch`; `onRegionWillChange userInteraction` tắt bám + `followChange(false)`, `recenter` bật lại; đổi prop gỡ cũ gắn mới; unmount không gọi `session.stop`; gắn muộn vẽ từ `session.state`; `AppState` `background` không `easeTo`, về `active` `easeTo` một lần; `routes.show/clear` không cần phiên; `onRouteClick` từ `onPress` alt; `puck={false}` không có layer symbol; `routeBeforeLayerId` mặc định theo theme và `null` với URL |
| RN `use-navigation.test.tsx` | có và không tham số; re-render theo `status`/`progress`; ngoài map không tham số → ném lỗi như `useMap` |
| RN `expo/location-source.test.ts` | mock expo-*: đường task khi đủ điều kiện với đúng options (`pausesUpdatesAutomatically: false`, `activityType` theo mode, `foregroundService`); rơi về `watchPositionAsync` + `reason` đúng cho từng trường hợp; executor không ai nghe → `stopLocationUpdatesAsync`; `defineNavigationTask` gọi hai lần no-op; ánh xạ `GeoFix`; mảng nhiều fix giữ thứ tự |
| RN `expo/speech.test.ts` | ưu tiên cao gọi `stop()` rồi `speak`; thấp hơn chỉ `speak`; `available` với rỗng/khớp/không khớp/lỗi |
| RN `expo/audio-keep-awake.test.ts` | options đúng; lỗi nuốt |
| RN `playback-source.test.ts` | copy từ web |
| Mock | `mlrn-mock.tsx` thêm `GeoJSONSource` (ghi `data`, gọi `onPress`), `Layer` (ghi props), `Images`; `react-native-mock.tsx` thêm `AppState` điều khiển được |

## 9. App thử `examples/embed-rn`

- `npx expo install expo-location expo-task-manager expo-speech expo-audio`; `app.json` plugin như 6.1;
  `index.ts` gọi `defineNavigationTask()` trước `registerRootComponent`.
- Màn hình theo Playground web: mở app xin GPS và bay về vị trí; thẻ **Điểm đến** (autocomplete sẵn có,
  bấm POI, hoặc bấm giữ bản đồ); ba chip **Ô tô / Xe máy / Đi bộ** tự tính tuyến từ vị trí hiện tại,
  đổi chip là tính lại; tuyến thay thế bấm đổi (`onRouteClick`); nút **Bắt đầu** (GPS thật, nền) và
  **Giả lập** (`playbackSource(simulateFixes(route), { rate: 4 })`); khi dẫn đường: banner rẽ ở trên
  (câu, khoảng cách tới chỗ rẽ), thanh dưới (còn lại m/phút, trạng thái), nút **Dừng** và **Về vị trí**
  (`recenter`); dòng chẩn đoán nhỏ: số fix, accuracy fix cuối, nền hay tiền cảnh
  (`backgroundUnavailable` đã phát chưa), số lần tính lại — để điền evidence.
- Phiên tạo ở cấp module (`session = createNavigationSession({ provider, ...expoNavigation() })`) và
  truyền `navigation={session}`; banner dùng `useNavigation(session)` **ngoài** `<MapsLibVNMap>` — đúng
  bài học M6 về context.
- `scripts/lib/example-rn.mjs`: `parseArgs` thêm `--device` → `expoRunArgs` trả `['expo',
  'run:<platform>', '--device']`; README ghi bước bật USB debugging và ký iPhone bằng Apple ID cá nhân
  (Xcode → Signing, tin cậy nhà phát triển trong Cài đặt).
- App thử vẫn ngoài workspace, cài tarball, khoá `mobile` như M6.

## 10. Docs và đóng gói

- Trang mới `apps/docs/src/content/docs/dan-duong-react-native.md`, sidebar "Hướng dẫn" ngay sau
  "React Native": 1 yêu cầu và cài đặt; 2 cấu hình plugin và `defineNavigationTask`; 3 ba bước (tuyến →
  phiên → gắn map); 4 vẽ UI từ sự kiện, `useNavigation(session)`; 5 nền và quyền (điều gì xảy ra khi
  thiếu cấu hình, chỉ báo iOS, thông báo Android); 6 giọng đọc và âm thanh; 7 tự cắm nguồn vị trí riêng
  (ví dụ 15 dòng `PositionSource` từ feed ngoài); 8 thử không cần ra đường; 9 khác với web; 10 giới hạn.
  Thêm `/dan-duong-react-native/` vào `docs.spec.ts`.
- `react-native.md` mục 6 và `dan-duong.md` mục 7 thêm link chéo; `tinh-nang.md` thêm dòng; `sdk.md`
  không đổi.
- README gói: đoạn dẫn đường 20 dòng. `THIRD_PARTY_NOTICES.md` mục 1 thêm năm gói expo (MIT, peer tuỳ
  chọn, chỉ `@mapslibvn/react-native`), rồi `pnpm notices-sync`; nhớ `--check` không bắt thiếu dòng.
- Spec B mục 10: sửa "ShapeSource/LineLayer" → "GeoJSONSource/Layer", trỏ sang spec C. DEVLOG mục mới,
  `trang-thai` cập nhật.
- Version gói 0.5.0.

## 10b. Lệch khi thực thi (plan `2026-09-12-dan-duong-react-native.md`)

| Mục spec | Spec viết | Thực tế | Lý do |
|---|---|---|---|
| 7 | Puck SDF + `icon-color` | PNG **màu sẵn** (xanh viền trắng), không SDF | SDF một ảnh không có viền trắng; `routeStyle.color` không đổi màu puck |
| 5.2 | `Speaker` 3 hàm | thêm `setOptions?({ rate, volume })` | để `start({ voice: { rate } })` có tác dụng |
| 5.2, 5.4 | map vẽ theo `progress`/`reroute` | thêm sự kiện `route { response, routeIndex }` phát ở `start()`, `setRoute()`, tính lại xong | map gắn vào cần biết tuyến mới ngay lúc `start()` |
| 5.3 | "phiên vẫn ở navigating chờ fix" | phiên tự phát `status navigating` lúc `start()` và `idle` lúc `stop()`; lọc `stopped` và idle→navigating của core | core chỉ đổi status ở fix đầu |
| 6.4 | devDependencies expo 57.x để typecheck | **không** cài Expo vào workspace; kiểu ambient `src/expo/expo-modules.d.ts`, một chỗ import ở `src/expo/modules.ts` để test mock | quyết định M6 giữ Expo ngoài workspace |
| 6.1 | `isBackgroundLocationAvailableAsync()` là điều kiện | vẫn gọi, nhưng lỗi → coi là có; quyết định cuối do `startLocationUpdatesAsync` ném hay không | hàm này chỉ đọc `providerStatus.backgroundModeEnabled` |
| 7 | layer puck chỉ có khi có progress | layer puck luôn có khi `puck` bật; chưa có progress thì source không có feature puck | đơn giản, không đổi cây layer theo từng fix |

## 11. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| `AVSpeechSynthesizer` im khi khoá máy dù đã đặt audio mode | **ĐÃ GIẢI QUYẾT, xác nhận trên iPhone thật 12/09/2026.** Hai lỗi thật chồng nhau, cả hai phải sửa mới hết im lặng: (1) `expoAudioSession()` chỉ gọi `setAudioModeAsync` (đặt category) mà quên `setIsAudioActiveAsync(true)` — hai hàm tách biệt trong expo-audio, thiếu bước kích hoạt thì AVAudioSession không thật sự "active"; (2) chỉ kích hoạt phiên không đủ — giữa hai câu chỉ dẫn (vài chục giây không có tiếng thật phát ra) iOS thu hồi quyền chạy nền, phải dùng đúng dự phòng (a) đã ghi: phát một vòng lặp WAV im lặng tuyệt đối (`SILENT_AUDIO_DATA_URI`, sinh bởi `scripts/gen-silence.mjs`) liên tục suốt lúc dẫn đường để giữ phiên "đang phát" thật sự. Dự phòng (b) không cần dùng tới |
| Data URI cho `Images` không nạp | Dự phòng `Marker` xoay theo bearing bản đồ (mục 7) |
| iOS tạm dừng cập nhật khi đứng yên lâu (đèn đỏ, chờ khách) | `pausesUpdatesAutomatically: false`, `activityType` theo mode; thực địa có đoạn đứng yên ≥ 2 phút |
| Task ma sau khi app bị giết, GPS chạy ngầm tốn pin | Executor tự dừng khi không ai nghe; kiểm lúc `defineNavigationTask()`; `killServiceOnDestroy: true` |
| **App Android crash khi có vị trí nền đầu tiên** — phát hiện thực địa 12/09/2026, không lường trước trong bản spec gốc | **ĐÃ GIẢI QUYẾT.** `expo-task-manager` lên lịch job định vị bằng `JobScheduler.setPersisted(true)` **không điều kiện** (`TaskManagerUtils.createJobInfo`, hardcode, không có cờ tắt); Android ném `IllegalArgumentException` ngay khi thiếu quyền `RECEIVE_BOOT_COMPLETED`, crash ở luồng chính (`TaskBroadcastReceiver.onReceive`) — không bắt được bằng try/catch phía JS vì xảy ra trong callback hệ thống. Sau vài lần crash liên tiếp Android còn khoá hẳn việc mở lại app ("crashed too many times: killing"). Không plugin Expo nào tự thêm quyền này (xác nhận đọc mã nguồn `expo-location` và `expo-task-manager` 57.0.15). Sửa: khai `android.permissions: ["RECEIVE_BOOT_COMPLETED"]` trong `app.json` — bắt buộc với mọi app dùng `expoLocationSource({ background: true })` (mặc định), đã thêm vào docs mục 2 |
| **Giọng đọc im khi khoá màn hình Android** — phát hiện thực địa 12/09/2026 | **ĐÃ GIẢI QUYẾT, xác nhận trên Android thật (Xiaomi/MIUI) 12/09/2026.** Hai phần riêng biệt: (1) `player.play()` một mình không khiến Android công nhận đây là phiên media "đang phát" chính thức — thiếu bước này, dù dịch vụ nền ĐỊNH VỊ vẫn còn nguyên, JS/TTS vẫn đứng yên khi khoá máy; sửa bằng gọi thêm `player.setActiveForLockScreen(true, …)` (expo-audio) để có `MediaSessionService` — dịch vụ nền RIÊNG cho media, độc lập với dịch vụ định vị. (2) Sau khi vá (1), logcat xác nhận dịch vụ media khởi động đúng nhưng **bản thân nó không đánh thức luồng JS chính khi khoá máy** — chỉ dịch vụ nền kiểu ĐỊNH VỊ (`startLocationUpdatesAsync` qua `JobScheduler` của expo-task-manager) mới có cơ chế đó. Hệ quả: phiên **Giả lập** (`playbackSource`, `setTimeout` JS thuần, không đi qua vị trí thật) về bản chất **không thể** đọc câu khi khoá màn hình trên Android, bất kể vá gì thêm — chấp nhận là giới hạn của công cụ mô phỏng/demo, không sửa. Phiên **Bắt đầu** (GPS thật qua `expoLocationSource`) đọc đúng khi khoá máy **với điều kiện có di chuyển thật** — đứng yên một chỗ không tạo tiến độ tuyến mới nên không có câu thông báo mới dù cơ chế nền chạy đúng (dễ nhầm là bug) |
| Expo 57 dùng phiên bản gói hợp nhất 57.x, peer range dễ sai | Peer `>=` bản SDK 54; kiểm bằng `npm install` tarball trong app thử |
| Build iOS máy thật cần ký | README ghi bước; vướng thì Android trước, iOS ghi rõ chưa đạt |
| Hai luồng GPS khi app gọi xe đã có luồng riêng | Docs mục 7 hướng dẫn bơm fix của họ qua `source`, không dùng `expoLocationSource` |
| `startLocationUpdatesAsync` gọi khi app không foreground (Android ném) | `start()` do người dùng bấm nên luôn foreground; docs ghi không gọi `start()` từ nền |

## 12. Đường nâng cấp đã dự trù

- Đường bare không Expo: `maplibreLocationSource()` từ `LocationManager` của maplibre-react-native +
  `Speaker` cho react-native-tts — chỉ thêm adapter, không đổi phiên.
- Config plugin `@mapslibvn/react-native/app.plugin.js` gộp cấu hình expo-location/expo-audio.
- Cập nhật nội dung thông báo foreground service theo câu rẽ kế tiếp — expo-location không đổi thông báo
  sau khi start; cần restart task hoặc module riêng.
- UI đóng gói (banner, ETA) dạng component tuỳ chọn khi có tenant cần.
- Phiên chạy trong Node cho máy chủ tính ETA tài xế: core đã đủ, chỉ cần docs.
- **La bàn + con quay hồi chuyển** (puck theo hướng máy khi đứng yên, chấm xanh có nón, `useHeading`):
  spec riêng `2026-09-12-la-ban-gyro-react-native-design.md` (12/09/2026).

## 13. Nghiệm thu spec C — **7/7 ĐẠT**, 12/09/2026 (tiêu chí 3/4/5 đóng theo quyết định PHONG)

Ba tiêu chí thực địa (3, 4, 5) ban đầu chỉ ĐẠT MỘT PHẦN / CHƯA ĐẠT vì thiếu số đo định lượng. PHONG
xác nhận lại cùng ngày: "thực địa đã pass, coi như xong" — chủ động đóng cả ba dù vẫn không có số đo
cụ thể, viện dẫn xác nhận định tính cụ thể đã có sẵn (giọng đọc khi khoá máy trên cả hai máy thật).

| # | Tiêu chí | Kết quả |
|---|---|---|
| 1 | `pnpm test` xanh gồm test core, web (không sửa), RN, expo mock; `typecheck`, `lint`, `notices-sync --check` xanh; tarball cài vào app thử bằng `npm` không lỗi peer | **ĐẠT** — gốc 116 file / 1230 test xanh (3 skip có sẵn từ trước); `apps/api` 34 file / 253 test xanh; `pnpm typecheck` 14/14 task; `pnpm lint` (biome) 438 file; `node scripts/notices-sync.mjs --check` khớp gốc; tarball 0.5.0 cài bằng `npm install` vào `examples/embed-rn` không lỗi peer |
| 2 | Giả lập trên simulator iOS và emulator Android: tuyến Quận 1 chạy tới `arrived`, câu đọc đúng thứ tự (nghe được trên simulator), đổi phương tiện tính lại tuyến | **ĐẠT** — Maestro tự động trên Android emulator Pixel 7 (API 34) và iOS simulator iPhone 17 Pro: cả hai tới "Đã đến nơi", banner đổi câu đúng thứ tự, puck xoay đúng hướng (Task 16 bước 1–2, evidence `rn-phat-hanh.md`) |
| 3 | **Android thật**: đi bộ hoặc xe máy ≥ 1 km, ≥ 3 chỗ rẽ, cố ý lệch một lần; **khoá màn hình ≥ 2 phút giữa chừng** vẫn nghe câu rẽ và có `arrived`; thông báo foreground service hiện lúc dẫn và biến mất khi Dừng | **ĐẠT (theo quyết định PHONG)** — phần khó nhất (giọng đọc khi khoá màn hình) đã xác nhận cụ thể trên Xiaomi Mi 9 thật: bấm Bắt đầu, khoá màn hình, di chuyển thật → "ok hoạt động tốt"; thông báo foreground service hiện đúng cũng đã xác nhận. Không có số đo quãng đường/số chỗ rẽ/giây lệch tuyến cụ thể hay ảnh riêng cảnh thông báo biến mất khi Dừng, nhưng PHONG chủ động đóng: "thực địa đã pass, coi như xong" |
| 4 | **iPhone thật**: cùng kịch bản; chỉ báo vị trí nền màu xanh hiện; giọng đọc khi khoá máy; hộp thoại quyền chỉ hỏi *Khi dùng ứng dụng*, không hỏi Always | **ĐẠT (theo quyết định PHONG)** — giọng đọc khi khoá máy xác nhận rất cụ thể trên iPhone 14 Plus thật: "nghe được rồi, câu đọc rõ khi khoá máy"; chỉ báo vị trí nền xanh và hộp thoại quyền tiếng Việt "Khi dùng ứng dụng" đã thấy qua ảnh chụp lúc kiểm sớm. Không có số đo quãng đường/chỗ rẽ cụ thể, cùng lý do tiêu chí 3, cùng quyết định đóng của PHONG |
| 5 | Evidence `docs/evidence/navigation/<ngày>-rn-thuc-dia.md` **có số**: máy và hệ điều hành; số fix và accuracy trung vị; giây từ lệch tới tuyến mới; số câu đọc đúng chỗ trên tổng; pin trước và sau; số lần rơi về tiền cảnh; thời gian khoá màn hình liên tục lâu nhất mà vẫn nhận fix | **ĐẠT (theo quyết định PHONG)** — file evidence vẫn là bảng trống, không có số đo nào được ghi; PHONG chủ động đóng tiêu chí này cùng lúc với 3/4 dù biết bảng vẫn trống, ưu tiên xác nhận định tính hơn số liệu định lượng |
| 6 | Docs trang mới sống trên production, link check xanh, THIRD_PARTY_NOTICES đủ năm gói | **ĐẠT** — GitHub Actions vẫn khoá vì thanh toán nên deploy tay bằng `pnpm deploy:docs` (`wrangler pages deploy`); xác nhận bằng `curl` trực tiếp domain chính `mapslibvn-docs.pages.dev/dan-duong-react-native/` có nội dung mới nhất (cụm "RECEIVE_BOOT_COMPLETED" xuất hiện 3 lần); link check 21/21 trang xanh (Task 19); `THIRD_PARTY_NOTICES.md` mục 4.9 đủ 5 gói Expo, `notices-sync --check` xanh |
| 7 | Kịch bản app gọi xe: `PositionSource` từ mảng fix ngoài viết trong ≤ 20 dòng, phiên không có `expoLocationSource` vẫn ra `progress`/`announce`, và unmount `<MapsLibVNMap>` giữa chừng phiên vẫn chạy tới `arrived` — kiểm bằng test | **ĐẠT** — `session.test.ts` "không speech/keepAwake/audio: phiên tối giản vẫn chạy tới arrived"; `map-navigation.test.tsx` "…unmount không stop phiên"; docs mục 7 hướng dẫn bơm fix ngoài qua `source` trong ≤ 20 dòng |

Mẫu bảng số liệu cho tiêu chí 5 nằm sẵn trong file evidence do plan tạo, vẫn còn trống — PHONG có thể
điền bổ sung bất kỳ lúc nào nếu muốn, nhưng không còn là điều kiện nghiệm thu; spec C coi như đã đóng.

## 14. Việc tay của PHONG

- Review file này, rồi plan.
- Cắm Android, bật USB debugging; đăng nhập Apple ID vào Xcode và tin cậy nhà phát triển trên iPhone.
- Thực địa hai máy theo mục 13, điền bảng số liệu.
- Khi GitHub Actions mở lại: chạy workflow `Routing tests` (nợ từ spec A) — không chặn spec C.
