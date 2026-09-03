# MapsLibVN — Thiết kế `@mapslibvn/react-native` (spec mục 8.1, mốc M6)

- Ngày: 2026-09-03
- Trạng thái: bản viết sau brainstorming với PHONG (phạm vi và cách A đã duyệt); chờ PHONG review file trước khi viết plan
- Chủ dự án: PHONG
- Spec gốc: `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md` (bản 2) — mục 8.1 trỏ về file này
- Tiền đề: M1–M5 đã nghiệm thu 03/09/2026; API, style, tiles, khoá `mobile` đều đã có trên production

## 0. Tóm tắt một đoạn

`@mapslibvn/react-native` là gói React Native bọc `@maplibre/maplibre-react-native` theo đúng
hình dạng API của `@mapslibvn/react`, để một app iOS/Android hiện bản đồ MapsLibVN có lớp POI,
tìm kiếm/autocomplete và geocoding bằng **khoá `mobile`**. Không thêm endpoint API, không thêm biến
thể style: MapLibre Native đọc `pmtiles://https://…` ở tầng native nên `/v1/styles/{light|dark}.json`
hiện tại dùng nguyên. Kèm theo gói là một app Expo thử độc lập `examples/embed-rn` mở bằng một
lệnh `pnpm example:rn`, một trang docs "React Native", và checklist nghiệm thu chạy thật trên
simulator iOS và emulator Android. Toàn bộ là mốc **M6**, ước lượng 1–1,5 tuần.

## 1. Mục tiêu, phạm vi, người dùng

### 1.1 Mục tiêu

1. Nhà phát triển React Native (Expo hoặc bare) đã có app chạy New Architecture nhúng được bản đồ
   MapsLibVN bằng một component, cùng cách gọi với web.
2. Không đổi hợp đồng API, không đổi Worker, không đổi style: mọi thứ mobile cần đã có sẵn.
3. Attribution bắt buộc và không tắt được, như web (spec 12.3).
4. Nghiệm thu chạy thật trên thiết bị giả lập, không chỉ test unit.

### 1.2 Trong phạm vi M6

- Gói `packages/react-native` (`@mapslibvn/react-native`): `<MapsLibVNMap>`, `<Marker>`,
  `useMap()`, `usePlaces()`, kiểu dữ liệu tái xuất từ core.
- Hai sửa nhỏ ở `@mapslibvn/core` để dùng chung (mục 4.5): tuỳ chọn `headers`, kiểu `PoiFeature`,
  hai hàm biến đổi style JSON thuần.
- App Expo thử `examples/embed-rn` + script `scripts/example-rn.mjs` (`pnpm example:rn`).
- Trang docs `react-native` trong `apps/docs` + cập nhật `bat-dau.md` và sidebar.
- Khoá `mobile` cho tenant thử nghiệm, biến `KEY_EXAMPLE_RN` trong `.env`.
- Mở rộng `notices:sync` cho gói thứ tư; CI typecheck/test/build bao gói mới.

### 1.3 Ngoài phạm vi (có chỗ, làm sau)

- Tiles offline (tải PMTiles về máy, `file://`): MapLibre Native hỗ trợ nhưng chưa cần.
- UI đóng góp/sửa POI có sẵn trong SDK: app tự gọi `places.suggestEdit`.
- SDK native thuần (Swift/Kotlin), Flutter: MapLibre Native/Flutter đọc thẳng style và tiles;
  chỉ cần docs, không cần gói.
- Kiểm `X-Bundle-Id` cứng phía API: giữ kiểm mềm theo spec 6.4.
- Publish npm: chặn bởi checklist pháp lý B3 (nhãn hiệu). Gói và app thử cài bằng tarball.

## 2. Tiền đề kỹ thuật đã xác minh (03/09/2026)

| Điều | Kết quả | Hệ quả |
|---|---|---|
| `@maplibre/maplibre-react-native` bản mới nhất | 11.3.8 (01/09/2026); kèm MapLibre Native Android 13.2.0, iOS 6.26.0 | pin `^11.3.0` |
| `pmtiles://` trên native | MapLibre Native đọc `pmtiles://https://…` từ Android 11.8.0 / iOS 6.10.0, không cần `addProtocol`; URL bên trong phải tuyệt đối | style production đã dùng URL tuyệt đối → dùng nguyên, **không** cần tiles fallback qua Worker |
| Peer deps wrapper | `react >=19.1.0`, `react-native >=0.80.0`, `expo >=54.0.0`; chỉ New Architecture; Android API ≥ 23; không chạy Expo Go | gói khai báo cùng yêu cầu; monorepo web vẫn React 18.3, gói mới có devDependencies React 19 riêng |
| API wrapper v11 | component chính là `Map` (prop `mapStyle: string \| StyleSpecification`, `attribution`, `logo`, `onPress`, `onDidFinishLoadingStyle`, `onDidFailLoadingMap`, ref `queryRenderedFeatures(point, {layers})`, `setSourceVisibility`, `showAttribution`, `getBounds`); `Camera` (prop `initialViewState`, ref `flyTo`, `fitBounds`, `easeTo`); `Marker` (`lngLat`, `anchor`, `onPress`, children là một View); `Layer`, `GeoJSONSource`, `VectorSource`; không có API đổi layout property của lớp có sẵn | `lang` xử lý bằng biến đổi style JSON trước khi truyền (mục 4.3) |
| `/v1/styles/*.json` | công khai, không kiểm khoá; `?key=` chỉ đi kèm | native tải style trực tiếp |
| `/v1/autocomplete` … | bắt buộc `X-Api-Key`; khoá `mobile` log `X-Bundle-Id`, không chặn | core gửi header như hiện tại + `X-Bundle-Id` tuỳ chọn |
| `@mapslibvn/react` | đã đóng gói core + web vào `dist` (chỉ external react, maplibre-gl, pmtiles) | gói RN làm tương tự: đóng gói core, không kéo web |
| `examples/*` | không nằm trong `pnpm-workspace.yaml` | app Expo là dự án npm độc lập (cách A) |

Mục 8.1 spec gốc ghi wrapper "đã hỗ trợ `pmtiles://`". Câu này đúng về kết quả nhưng cơ chế là
native, không phải JS. Spec gốc được sửa một dòng trỏ về đây (ghi vào DEVLOG mục 3).

## 3. Kiến trúc

```
app RN (React 19, RN ≥0.80, New Arch, Expo ≥54 hoặc bare)
 └─ @mapslibvn/react-native            ← gói này (đóng gói sẵn @mapslibvn/core)
     ├─ <MapsLibVNMap>  →  Map + Camera của @maplibre/maplibre-react-native (peer)
     │                        └─ MapLibre Native (Android/iOS) tải style JSON, đọc pmtiles:// từ R2
     ├─ <Marker>        →  Marker của wrapper
     ├─ useMap()        →  { native, camera, places, flyTo, fitBounds, getBounds }
     └─ usePlaces()     →  places.autocomplete (fetch, X-Api-Key, X-Bundle-Id)
                              └─ Worker api.<domain> /v1/* (khoá mobile)
```

Ba luồng dữ liệu:

1. **Style và tiles**: `places.styleUrl(theme)` → truyền URL cho `Map.mapStyle` → native tải JSON,
   rồi tự tải glyph/sprite và range request vào `tiles.<domain>/tiles/*.pmtiles`. Không đi qua
   Worker, không tốn quota. Khi cần biến đổi (`lang='en'` hoặc `poiLayer=false`), SDK tải JSON
   bằng `fetch` trong JS, biến đổi thuần, truyền object.
2. **Places**: `createClient({apiKey, baseUrl: apiBase, headers})` của core, y như web.
3. **Sự kiện**: `Map.onPress` → toạ độ pixel → `queryRenderedFeatures(point, {layers: ['poi']})`
   → `PoiFeature` cùng shape với web → `onPoiClick`.

## 4. Gói `@mapslibvn/react-native`

### 4.1 `package.json`

- `name` `@mapslibvn/react-native`, `version` 0.1.0, `license` MIT, `type` module,
  `main`/`types` trỏ `dist`, `files` = `dist`, `LICENSE`, `THIRD_PARTY_NOTICES.md`
  (được `notices:sync` copy vào — thêm `packages/react-native` vào `SDK_PACKAGES` trong
  `scripts/lib/notices.mjs` và test tương ứng).
- `peerDependencies`: `@maplibre/maplibre-react-native ^11.3.0`, `react >=19.1.0`,
  `react-native >=0.80.0`.
- `dependencies`: `@mapslibvn/core workspace:*`, **đóng gói vào dist** bằng `tsup.config.ts` với
  `noExternal: ['@mapslibvn/core']` (tsup mặc định external mọi `dependencies`; `@mapslibvn/react`
  hiện để core/web external vì cài từ workspace — gói RN thì phải tự chứa để cài được bằng một
  tarball). Không phụ thuộc `@mapslibvn/web`.
- `devDependencies`: `react ^19.1`, `react-dom ^19.1`, `@types/react ^19.1`, `react-native ^0.80`,
  `@maplibre/maplibre-react-native ^11.3`, `@testing-library/react ^16`, `tsup`, `typescript`.
  pnpm cô lập theo gói nên React 19 ở đây không đụng React 18 của root và `packages/react`.
- `scripts`: `build` = `tsup src/index.ts --format esm --dts --clean --target es2020 --external react --external react-native --external @maplibre/maplibre-react-native`;
  `typecheck` = `tsc --noEmit`. Target es2020 để Hermes/Metro không phải xử lý cú pháp mới hơn.
- Không có `size-limit`: gói được Metro đóng gói vào app, không có chi phí tải qua mạng.
- `tsconfig.json`: extends `tsconfig.base.json`, `jsx: react-jsx`, `lib: ["ES2022"]` (không DOM),
  `types: ["react", "react-native"]`, `include: ["src"]`.

### 4.2 API công khai

```tsx
import { MapsLibVNMap, Marker, useMap, usePlaces } from '@mapslibvn/react-native';

<MapsLibVNMap
  apiKey="mlv_live_…" apiBase="https://api.ai-solutions.io.vn"
  style="light"                       // 'light' | 'dark' | URL style tuỳ biến (giống web)
  center={[106.7, 10.776]} zoom={12}  // giá trị KHỞI TẠO camera (khác web: đổi sau không tạo lại map)
  lang="vi"                           // 'vi' | 'en'
  poiLayer                            // mặc định true
  compactAttribution={false}
  bundleId="vn.example.app"           // tuỳ chọn → header X-Bundle-Id
  containerStyle={{ flex: 1 }}        // StyleProp<ViewStyle> của khung ngoài
  onLoad={(map) => …}                 // map: MapHandle (mục 4.4)
  onPoiClick={(poi) => …}             // PoiFeature {id, name, category, group, lngLat}
  onError={(err) => …}                // lỗi tải style/map
  testID="map"
>
  <Marker lng={106.7} lat={10.776} color="#e53935" onPress={…}>{/* View tuỳ ý, hoặc bỏ trống */}</Marker>
</MapsLibVNMap>
```

| Xuất khẩu | Mô tả |
|---|---|
| `MapsLibVNMap` | component chính; props ở trên. `style` là **theme** như `@mapslibvn/react`; khung ngoài dùng `containerStyle`. |
| `Marker` | bọc `Marker` của wrapper. Không có children → vẽ ghim mặc định (View tròn 22 pt viền trắng, màu `color`, mặc định `#3FB1CE` như MapLibre). `anchor` mặc định `center` (ghim tròn), app tự vẽ thì truyền `anchor` phù hợp. Không có `popupHtml` (không phải HTML); app tự hiện chi tiết qua `onPress`. |
| `useMap()` | trả `MapHandle`; ném lỗi nếu gọi ngoài `<MapsLibVNMap>`, thông điệp tiếng Việt như web. |
| `usePlaces(query, {near, limit, debounceMs, client})` | copy nguyên `packages/react/src/use-places.ts` và test của nó (đổi import context). Chấp nhận trùng ~60 dòng vì hai gói có peer React khác nhau. |
| kiểu | `MapsLibVNMapProps`, `MarkerProps`, `MapHandle`, `PoiFeature`, `Lang`, `Theme`, `AutocompleteItem`, `MapsLibVNClient`, `Place` (tái xuất từ core). |

### 4.3 Hành vi `MapsLibVNMap`

1. **Client**: `useMemo` → `createClient({ apiKey, baseUrl: apiBase, headers: bundleId ? {'X-Bundle-Id': bundleId} : undefined })`.
2. **Style**:
   - `style` là theme → `places.styleUrl(theme)`; là chuỗi khác → dùng nguyên.
   - Nếu `lang` khác `'vi'` **hoặc** `poiLayer === false`: `fetch(url)` → JSON → `localizeStyle(json, lang)` rồi `hidePoiLayer(json)` (hàm thuần trong core, mục 4.5) → `mapStyle={object}`. Trong khi chờ, render khung trống cùng kích cỡ (không nháy). Lỗi fetch → `onError`, không render `Map`.
   - Ngược lại: `mapStyle={url}` — native tải, đường nhanh nhất và là mặc định.
   - Một cơ chế cho cả hai tuỳ chọn để có một đường mã, test được thuần.
3. **Camera**: `<Camera ref initialViewState={{ center, zoom }}>`; mặc định `[106.7, 10.776]`, zoom 12 như web. Đổi `center`/`zoom` sau khi mount **không** tạo lại map; app dùng `flyTo`. Đổi `apiKey`, `apiBase`, `style`, `lang`, `poiLayer` → tạo lại map (đổi `key` của cây con), như `@mapslibvn/react`.
4. **Map props cố định**: `attribution` bật, `attributionPosition` góc dưới phải, `logo` tắt
   (BSD của MapLibre không yêu cầu logo; web SDK cũng không hiện), `compass` bật mặc định của wrapper.
5. **Attribution MapsLibVN** (spec 12.3): một `<Text>` nhỏ chồng góc dưới trái, nền mờ,
   `accessibilityRole="link"`. Đầy đủ: `attributionText()` từ core (được xuống dòng). Gọn
   (`compactAttribution`): `© MapsLibVN · © OpenStreetMap contributors`. Bấm vào gọi
   `native.showAttribution()` — hộp thoại native liệt kê attribution từng source trong style
   (OSM, OpenMapTiles, Overture, Foursquare đã nằm trong `sources.*.attribution`). Không có prop tắt.
6. **Sự kiện**:
   - `onDidFinishLoadingStyle` → gọi `onLoad(handle)` một lần.
   - `onDidFailLoadingMap` → `onError(new Error('Không tải được bản đồ'))`.
   - `onPress` → đọc toạ độ pixel từ `nativeEvent` → `native.queryRenderedFeatures(point, { layers: ['poi'] })` → feature `Point` đầu tiên → `onPoiClick({ id: String(p.id), name: String(p.name ?? ''), category: String(p.cat ?? ''), group: String(p.grp ?? ''), lngLat })`. Bỏ qua khi không có `onPoiClick` hoặc `poiLayer === false`. Hàm `toPoiFeature(feature)` tách riêng để test.
7. **Context**: `MapContext` cung cấp `MapHandle` cho `Marker`, `useMap`, `usePlaces` (lấy `places` khi không truyền `client`).
8. **Dọn dẹp**: unmount → wrapper tự huỷ view native; SDK huỷ mọi promise đang chờ bằng cờ `cancelled` (như `usePlaces`).

### 4.4 `MapHandle`

```ts
interface MapHandle {
  native: RefObject<MapRef | null>;      // ref Map của wrapper — không giấu gì, tương ứng map.gl ở web
  camera: RefObject<CameraRef | null>;
  places: MapsLibVNClient;
  flyTo(center: [number, number], zoom?: number): void;                 // camera.flyTo
  fitBounds(bbox: [number, number, number, number], padding?: number): void; // camera.fitBounds, padding mặc định 40
  getBounds(): Promise<[number, number, number, number]>;               // native.getBounds → [w, s, e, n]
}
```

### 4.5 Thay đổi ở `@mapslibvn/core` (nhỏ, có test, không đổi hành vi cũ)

| Thay đổi | Lý do |
|---|---|
| `ClientOptions.headers?: Record<string, string>` — gộp vào header của `get`/`post` sau `X-Api-Key` (không cho ghi đè `X-Api-Key`) | gửi `X-Bundle-Id` cho khoá `mobile` (spec 6.4) |
| `PoiFeature` chuyển từ `packages/web/src/map.ts` sang `packages/core/src/types.ts`; web `export type { PoiFeature } from '@mapslibvn/core'` | hai SDK cùng shape sự kiện, RN không kéo web |
| `packages/core/src/style-transform.ts`: `nameExpression(lang)`, `localizeStyle(style, lang)` (bản thuần của `applyLanguage`: bỏ qua `sovereignty-label`, chỉ đổi `text-field` symbol có `name`), `hidePoiLayer(style)` (đặt `layout.visibility='none'` cho lớp `poi`, trả style mới, không đột biến) | RN không có API đổi layout property lúc chạy; web `language.ts` import `nameExpression` từ core để không trùng |
| Ngân sách `size-limit` core giữ 8 kB gzip (thêm ~0,4 kB) | kiểm trong CI như cũ |

### 4.6 Kiểm thử gói

Chạy trong Vitest root (`packages/*/src/**/*.test.ts` đã nằm trong include), môi trường jsdom,
React 19 lấy từ `node_modules` của gói.

| Test | Cách |
|---|---|
| `style-transform.test.ts` (core) | fixture style rút gọn có `sovereignty-label`, symbol tên đường, lớp `poi` → kiểm expression, visibility, không đột biến đầu vào |
| `client.test.ts` (core, thêm case) | `headers` được gộp; không ghi đè `X-Api-Key` |
| `map.test.tsx` | `vi.mock('react-native')` (View/Text/Pressable → phần tử DOM), `vi.mock('@maplibre/maplibre-react-native')` (Map/Camera/Marker ghi lại props, ref giả có `queryRenderedFeatures`, `showAttribution`, `getBounds`); render bằng `@testing-library/react`. Kiểm: `mapStyle` là URL khi mặc định; là object đã biến đổi khi `lang='en'` (fetch giả); `onLoad` gọi một lần; `onPress` → `queryRenderedFeatures` với `layers:['poi']` → `onPoiClick` đúng shape; không gọi khi `poiLayer=false`; attribution luôn có trong cây; `onError` khi fetch lỗi |
| `marker.test.tsx` | ghim mặc định khi không children; `lngLat` và `anchor` truyền đúng |
| `use-places.test.ts` | copy từ `packages/react` |
| `to-poi-feature.test.ts` | ánh xạ properties `cat`/`grp`, bỏ qua geometry không phải Point |

Không có test E2E tự động trên simulator (không có runner macOS/Android trong 2.000 phút CI của
repo private); nghiệm thu tay theo mục 7.

## 5. App Expo thử `examples/embed-rn` (cách A)

### 5.1 Nguyên tắc

- Dự án npm **độc lập**, không trong `pnpm-workspace.yaml`, không thuộc dự án nào khác của PHONG,
  tên hiển thị trung lập ("MapsLibVN Demo"), `bundleIdentifier`/`package` = `vn.mapslibvn.demo`.
- Cài SDK bằng **tarball** sinh từ `pnpm pack` — mô phỏng đúng đường npm của người ngoài trong khi
  npm publish còn chặn (B3). Gói đã đóng gói core nên chỉ một tarball.
- Khoá **không** nằm trong repo: đọc từ `KEY_EXAMPLE_RN` trong `.env` gốc, ghi vào
  `examples/embed-rn/.env` (gitignore) dưới tên `EXPO_PUBLIC_MAPSLIBVN_KEY`; `EXPO_PUBLIC_MAPSLIBVN_API`
  mặc định `https://api.ai-solutions.io.vn`.
- Gitignore trong thư mục app: `node_modules/`, `ios/`, `android/`, `.expo/`, `vendor/`, `.env`.

### 5.2 Nội dung app

- Expo SDK 54+, `app.json`: `newArchEnabled: true`, `plugins: ["@maplibre/maplibre-react-native"]`,
  `ios.bundleIdentifier` và `android.package` như trên. Không dùng Expo Router (một màn hình).
- Một màn hình: `<MapsLibVNMap>` full màn, `bundleId` lấy từ `expo-application` (`applicationId`),
  nút đổi theme light/dark và ngôn ngữ vi/en (đổi prop `style`/`lang` → SDK tạo lại map, chấp nhận),
  ô tìm kiếm phía trên dùng `usePlaces` hiển thị `FlatList` gợi ý; chọn gợi ý → `flyTo` + `<Marker>`;
  bấm POI → `Alert` tên/loại (đủ để nghiệm thu, không làm bottom sheet).
- Hiển thị dòng attribution của SDK, không thêm gì che nó.

### 5.3 Lệnh `pnpm example:rn`

`scripts/example-rn.mjs` (main) + `scripts/lib/example-rn.mjs` (hàm thuần có test) theo pattern
`example-embed.mjs`:

```
pnpm example:rn --ios        # mặc định trên macOS
pnpm example:rn --android
pnpm example:rn --pack-only  # chỉ build + pack + cài, không chạy
```

Các bước:

1. Kiểm `KEY_EXAMPLE_RN` (bỏ nháy đơn bao quanh như đã sửa cho `KEY_EXAMPLE_EMBED`); thiếu →
   in đúng lệnh cấp khoá (mục 5.4) và thoát mã 1.
2. `pnpm --filter @mapslibvn/core --filter @mapslibvn/react-native build`.
3. `pnpm --filter @mapslibvn/react-native pack --pack-destination examples/embed-rn/vendor`, đổi tên
   thành `mapslibvn-react-native.tgz` (tên cố định để `package.json` của app trỏ
   `"file:vendor/mapslibvn-react-native.tgz"`).
4. Ghi `examples/embed-rn/.env`.
5. `npm install --no-audit --no-fund` trong `examples/embed-rn` (npm, không pnpm, đúng như người ngoài).
6. `npx expo run:ios` hoặc `npx expo run:android` (Expo tự `prebuild` lần đầu). Ctrl+C dừng.

Hàm thuần trong `lib`: `parseArgs`, `resolveKey` (dùng lại từ `example-serve.mjs` với tên env
khác — tách `resolveKey(argv, env, envName)`), `tarballName`, `envFileContent`, `runCommand(platform)`.
`tsconfig.scripts.json` có `checkJs` — áp bẫy typecheck trong memory `m3-plan-ky-thuat`.

### 5.4 Khoá `mobile`

Tenant thử nghiệm `nhung_thu` (UUID `00000000-0000-4000-8000-000000000002`, đã seed ở M5) cấp thêm
một khoá kind `mobile`:

```bash
pnpm key:issue --tenant 00000000-0000-4000-8000-000000000002 --label "embed-rn thử độc lập" --kind mobile
```

Khoá ghi vào `.env` dưới `KEY_EXAMPLE_RN=` (không nháy); `.env.example` thêm dòng placeholder kèm
chú thích. Khoá `mobile` không có `allowed_origins`; nhận diện qua `X-Bundle-Id` trong log và
Analytics (blob `key`).

## 6. Docs (`apps/docs`)

- Trang mới `src/content/docs/react-native.md`, sidebar nhóm "Hướng dẫn", nhãn "React Native".
  Nội dung: yêu cầu (RN ≥ 0.80, React ≥ 19.1, Expo ≥ 54, New Architecture, không Expo Go, Android
  API ≥ 23); cài đặt Expo (plugin + rebuild) và bare (pod install); snippet 15 dòng như mục 4.2;
  khoá `mobile` và `bundleId`; attribution bắt buộc; bảng khác biệt so với web (`center`/`zoom` chỉ
  khởi tạo, không `popupHtml`, `native` thay `gl`); giới hạn hiện tại (chưa publish npm — cài từ
  tarball theo `examples/embed-rn/README.md`; chưa offline).
- `bat-dau.md` thêm mục "4. React Native" một đoạn trỏ sang trang mới.
- `index.mdx` thêm một dòng trong danh sách nền tảng.
- Link check Playwright hiện có tự bao trang mới.

## 7. Nghiệm thu M6 (bảng cho spec gốc mục 13)

| # | Tiêu chí | Cách chứng minh |
|---|---|---|
| 1 | `pnpm example:rn --ios` và `--android` chạy trọn: app hiện bản đồ VN nhãn tiếng Việt, tiles đọc thẳng từ `tiles.ai-solutions.io.vn` (không có request `/v1/tiles/*` trong log Worker), theme light/dark, `lang=en` đổi nhãn nhưng nhãn Hoàng Sa/Trường Sa vẫn tiếng Việt | ảnh chụp simulator iOS + emulator Android lưu `docs/evidence/m6/`; truy vấn Workers Observability không có `/v1/tiles` từ khoá mobile |
| 2 | Gõ "highlands" → gợi ý ≤ 1 s; chọn → `flyTo` + marker hiện | ảnh chụp |
| 3 | Bấm POI → `onPoiClick` trả tên/loại đúng với tile | ảnh chụp Alert |
| 4 | Attribution MapsLibVN hiện; bấm mở hộp thoại native liệt kê OSM/OpenMapTiles/Overture/Foursquare; không có prop tắt (kiểm bằng typecheck) | ảnh chụp + test |
| 5 | Request từ app xuất hiện trong Analytics với khoá `mobile`; log Worker có `X-Bundle-Id=vn.mapslibvn.demo` | truy vấn SQL API như báo cáo tuần |
| 6 | CI xanh: lint, typecheck (gói mới với React 19), vitest (test mục 4.6), build 4 gói, `notices --check` 4 gói; docs deploy, link check qua | GitHub Actions |
| 7 | Trang docs `react-native` hiển thị trên `mapslibvn-docs.pages.dev` | link |

Kết thúc: tick plan M6, DEVLOG mục 1–2, thêm hàng M6 vào bảng 13 của spec gốc và mục 7 roadmap.

## 8. Rủi ro và giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Tên trường trong `nativeEvent` của `onPress` (pixel/lngLat) khác dự đoán | poiClick không chạy | Task đầu của plan: viết test kiểu từ `.d.ts` của wrapper; `toPoiFeature` nhận đầu vào đã chuẩn hoá |
| `Marker` của wrapper không nhận `Callout`/children rỗng | ghim không hiện | luôn render một View con (ghim mặc định) |
| Truyền `mapStyle` object lớn (style light ~ vài chục kB) qua bridge | chậm lần đầu | chỉ khi `lang≠vi` hoặc `poiLayer=false`; mặc định vẫn URL |
| Hermes không hỗ trợ cú pháp trong dist | crash lúc import | target es2020; app thử là bằng chứng |
| Expo prebuild lần đầu chậm (CocoaPods, Gradle) | nghiệm thu mất thời gian | ghi rõ trong README; `--pack-only` để lặp nhanh phần JS |
| React 19 trong `packages/react-native` lọt vào lockfile root gây trùng | typecheck web lệch | pnpm cô lập; CI kiểm `pnpm typecheck` toàn repo |
| Wrapper đổi API ở 12.x | vỡ gói | pin `^11.3.0`; nâng có chủ đích |
| B3 chưa xong nên không publish | người ngoài chưa cài được | docs nói rõ; tarball là đường tạm |

## 9. Việc tay của PHONG

| Khi nào | Việc | Chặn |
|---|---|---|
| Trước Task app thử | Cài Xcode (simulator iOS) và Android Studio (emulator API ≥ 23) trên máy dev; `npx expo doctor` xanh | nghiệm thu 1–4 |
| Trước Task khoá | Chạy `pnpm key:issue … --kind mobile` (production DB qua tunnel như M5) và dán vào `.env` `KEY_EXAMPLE_RN` | nghiệm thu 1, 5 |
| Cuối M6 | Xem ảnh chụp, ký nghiệm thu trong DEVLOG | đóng M6 |

## 10. Quyết định đã chốt trong brainstorming (03/09/2026)

1. Phạm vi: gói + app Expo thử + trang docs (PHONG chọn).
2. App thử độc lập ngoài workspace, cài bằng tarball (cách A, PHONG chọn); không đưa Expo vào
   pnpm workspace để tránh đổi `node-linker` toàn repo.
3. Không tạo biến thể style mobile, không dùng tiles fallback qua Worker: native đọc `pmtiles://`.
4. API bám `@mapslibvn/react`; `center`/`zoom` chỉ khởi tạo; không `popupHtml`.
5. `lang` và `poiLayer` xử lý bằng biến đổi style JSON thuần trong core (một cơ chế).
6. Đóng gói core vào dist gói RN, không phụ thuộc `@mapslibvn/web`; `PoiFeature` và hàm biến đổi
   style chuyển vào core.
7. Attribution: nút native + dòng MapsLibVN chồng, chỉ có `compactAttribution`, không tắt.
8. Khoá `mobile` kiểm mềm như spec 6.4; SDK gửi `X-Bundle-Id` khi app truyền `bundleId`.
9. Đây là mốc M6 với plan cấp bước riêng `docs/superpowers/plans/<ngày viết>-m6-react-native.md`,
   viết bằng skill writing-plans sau khi PHONG duyệt file này; roadmap mục 0.4 thêm hàng 7.
