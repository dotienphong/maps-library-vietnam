---
title: SDK JavaScript
description: Tham chiếu bốn gói @mapslibvn — export thật, bảng tuỳ chọn và mặc định, sự kiện và payload, phương thức client ứng với endpoint nào.
---

Trang này liệt kê **đúng những gì bốn gói xuất ra**, kèm mặc định thật lấy từ mã nguồn. Hướng dẫn từng bước ở [Bản đồ web](/ban-do-web/), [Tìm kiếm & autocomplete](/tim-kiem/) và [React](/react/); tham chiếu HTTP ở [REST API](/api/).

## 1. Bốn gói

| Gói | Làm gì | Peer dependency |
|---|---|---|
| `@mapslibvn/core` | client REST, kiểu dữ liệu, chuỗi ghi nguồn, chuẩn hoá tiếng Việt | không có |
| `@mapslibvn/web` | `createMap` bọc MapLibre GL JS, web component autocomplete | `maplibre-gl@^6.4.1` |
| `@mapslibvn/react` | component và hook cho React | `maplibre-gl@^6.4.1`, `react>=18` |
| `@mapslibvn/react-native` | component và hook cho iOS/Android | `@maplibre/maplibre-react-native@^11.3`, `react>=19.1`, `react-native>=0.80` |

Bốn gói luôn phát hành cùng một version. Số hiện tại xem trên npm hoặc bằng
`npm view @mapslibvn/core version` — trang này cố ý không ghi số cứng để không bao giờ lệch với
registry.

`@mapslibvn/web` phụ thuộc `@mapslibvn/core` và `pmtiles`; `@mapslibvn/react` phụ thuộc cả `core` và `web`. Bạn chỉ cần cài gói ngoài cùng.

Cả bốn gói đã phát hành công khai lên npm dưới dist-tag `latest`. Cách cài npm,
UMD hoặc tarball được mô tả ở [Cài đặt](/cai-dat/).

### Nâng từ 0.7.x lên 0.12.x — không có thay đổi phá vỡ

Cả chặng này **chỉ thêm** API và đổi hành vi bên trong; không giá trị nào bị xoá khỏi contract
công khai, nên code đang chạy biên dịch được nguyên vẹn. Ba điều đáng đọc kỹ vì chúng đổi *hành
vi* chứ không đổi *kiểu*:

**0.11.0 — `signal` không còn huỷ request ở lớp mạng.** Truyền `signal` vẫn làm lời gọi của bạn
reject **ngay** khi abort, đúng như trước, nhưng request HTTP vẫn chạy tới cùng ở phía dưới để kịp
nhận và xác nhận receipt. Nghĩa là **abort không tiết kiệm lượt** — máy chủ đã phục vụ xong rồi.
Sửa vì `usePlaces` abort mỗi lần người dùng gõ thêm một ký tự: mỗi lần như vậy vứt mất một receipt,
receipt mồ côi thành `missed_ack` sau 120 giây, và ba cái là khoá cả tenant bằng `429 ack_required`.
Muốn thật sự không tốn lượt thì đừng gửi request — debounce và đệm ở mục
[Tìm kiếm & autocomplete](/tim-kiem/) làm đúng việc đó. Abort **trước** khi gọi thì không có
request nào được gửi.

**0.12.0 — debounce mặc định của `<mapslibvn-autocomplete>` từ 200 lên 300 ms, cộng đệm 20 truy vấn
gần nhất trong phiên.** Gõ lùi hoặc thêm dấu cách không gọi lại API. Đo được giảm khoảng một nửa
số lượt trên cùng một chuỗi gõ. Muốn giữ nhịp cũ: đặt `debounce="200"` trên thẻ.

**0.9.0 — kho receipt bền vững và ACK chạy nền.** Client tự lưu receipt chưa xác nhận rồi ACK lại
sau, và ném `quota_ack_pending` khi còn quá nhiều receipt chưa xác nhận thay vì cứ gửi tiếp. Ứng
dụng mobile nên truyền `receiptStore` (mục 2) để hàng đợi sống qua lần mở app sau.

Các API mới, tất cả đều tuỳ chọn:

| Bản | Thêm gì |
|---|---|
| 0.8.0 | RN: props `styleJson`, `prefetch` cho `<MapsLibVNMap>`, export `ROUTE_ALT_SOURCE_ID`; core: `routeFeatures`, `altRouteFeatures`, `liveRouteFeatures`, `decodeRoutes`, `EMPTY_ROUTE_FEATURES` |
| 0.9.0 | core: `receiptStore` trong `ClientOptions`, `createReceiptStore`, kiểu `QuotaReceipt`, `QuotaReceiptStore`, `ReceiptKeyValueStorage`; mã lỗi `quota_ack_pending` |
| 0.10.0 | core: `client.flushReceipts()`; RN: `useFlushReceiptsOnBackground()` |
| 0.11.0 | — (chỉ đổi hành vi `signal`) |
| 0.12.0 | web: đệm gợi ý trong phiên cho web component |

Hai thay đổi hành vi nhỏ khác ở 0.8.0: `onLoad` (React Native) **không** còn gọi lại khi đổi
`style`, `lang` hay `poiLayer` — nó chỉ chạy một lần cho mỗi bản đồ; và chạm POI trên React Native
bắt trong ô vuông **±12 px** quanh điểm chạm thay vì đúng một điểm.

### Nâng từ 0.4.x lên 0.7.x — có một thay đổi phá vỡ

Đây là chặng duy nhất từ trước tới nay **xoá** một giá trị khỏi contract công khai. Nếu app của bạn
có nhắc tới `overture` ở bất cứ đâu thì phải sửa trước khi nâng, nếu không tìm kiếm sẽ hỏng.

**0.7.0 — gỡ hẳn nguồn POI Overture.** Dữ liệu Overture đã được gỡ khỏi cơ sở dữ liệu ngày
13/09/2026 vì đo được tỷ lệ trùng lặp và sai vị trí quá cao, nên nguồn này không còn tồn tại ở cả
SDK lẫn máy chủ:

- `POI_SOURCES` còn `['osm', 'fsq']`. Ba profile hợp lệ là mặc định cả hai (`all`), `['osm']` và
  `['fsq']`.
- Máy chủ trả **`400 invalid_request`** nếu tham số `sources=` chứa `overture`. Đây là chỗ đau
  nhất: app cũ truyền `poiSources: ['overture']` hoặc `['osm', 'overture']` sẽ **mất toàn bộ tìm
  kiếm**, không phải tự rơi về mặc định.
- Chuỗi ghi nguồn bỏ dòng Overture Maps. Nếu bạn tự dựng chuỗi ghi nguồn thay vì dùng
  `attributionText()`/`attributionHtml()`, hãy bỏ dòng đó đi.
- `TypeScript`: `PoiSource` không còn nhận `'overture'`, nên chỗ nào gán cứng sẽ báo lỗi biên dịch.
  Đó là tín hiệu tốt — nó chỉ đúng những chỗ cần sửa.

Cách sửa: bỏ `overture` khỏi mọi `poiSources` và mọi `sources=`. Muốn giữ nguyên hành vi cũ thì bỏ
hẳn tuỳ chọn để dùng mặc định.

**0.6.0 — la bàn và chấm xanh (chỉ thêm).** `useHeading`, prop `userLocation` cho
`<MapsLibVNMap>` React Native, lớp vẽ chấm xanh kèm nón hướng và vòng sai số; `createHeadingFilter`
cùng các kiểu hướng ở core.

**0.5.0 — dẫn đường React Native (chỉ thêm).** Entry `@mapslibvn/react-native/expo`,
`createNavigationSession`, định vị nền, giọng đọc, phiên âm thanh và chống khoá màn hình, với các
gói Expo khai báo là peer tuỳ chọn.

Hai bản 0.5.0 và 0.6.0 không đổi gì ở web/React, chỉ thêm API mới.

### Nâng từ 0.2.x lên 0.3.0

Bản 0.3.0 **chỉ thêm**, không đổi hành vi: mặc định vẫn là toàn bộ nguồn POI (`all`) như 0.2.x, nên code đang
chạy không phải sửa gì. Mới:

- Tuỳ chọn `poiSources` cho `createMap`, `<MapsLibVNMap>` (React và React Native) và `createClient`;
  thuộc tính `sources` cho `<mapslibvn-autocomplete>`; tham số `sources=` cho REST.
- Export mới ở `@mapslibvn/core`: `PoiSource`, `PoiSourceProfile`, `POI_SOURCES`,
  `POI_SOURCE_PROFILES`, `DEFAULT_POI_SOURCES`, `normalizePoiSources`, `parsePoiSourcesCsv`,
  `poiSourcesKey`, `profileForSources`, `poiSourceClause`.

Ba profile là mặc định cả hai (`all`), `['osm']` và `['fsq']`.
Các cấu hình riêng dùng cùng contract trên cả bốn SDK:

```ts
poiSources: ['osm'];
poiSources: ['fsq'];
```

POI người dùng luôn được giữ. Các list route lọc theo profile nhưng `getPlace(id)` không lọc; style
fallback về archive `all` và trả `x-poi-profile: all;fallback` nếu archive riêng chưa phát hành.

Contract `poiSources` trên vẫn giữ nguyên từ 0.3.0, trừ việc `overture` đã bị gỡ ở 0.7.0 — xem mục
nâng cấp ngay bên trên.

### Nâng từ 0.1.x lên 0.2.0

Bản 0.2.0 **chỉ thêm**, không xoá trường nào, nên code đang chạy không phải sửa gì để biên dịch —
trừ một chỗ:

- `AutocompleteType` thêm `'area'` và `GeocodePrecision` thêm `'district'`. Nếu bạn `switch` **vét
  cạn** hai kiểu này (TypeScript `never` ở nhánh `default`) thì phải bổ sung nhánh cho hai giá trị
  mới, nếu không sẽ lỗi biên dịch.
- `AutocompleteItem` thêm `bbox?`; `GeocodeMatched` thêm `former?`. Cả hai là tuỳ chọn.
- **Loại `area` bật sẵn** trong `types` mặc định của `/v1/autocomplete`, nên kết quả gợi ý giờ có
  thể chứa vùng hành chính. Muốn giữ đúng bộ loại cũ thì truyền `types: ['poi', 'street', 'address']`
  (hoặc `types=poi,street,address` khi gọi REST trực tiếp).

## 2. `@mapslibvn/core`

Toàn bộ export của `packages/core/src/index.ts`:

| Nhóm | Export |
|---|---|
| Client | `createClient`, kiểu `ClientOptions`, `MapsLibVNClient`, `AttributionResponse`, `Theme` |
| Nguồn POI | `POI_SOURCES`, `POI_SOURCE_PROFILES`, `DEFAULT_POI_SOURCES`, `normalizePoiSources`, `parsePoiSourcesCsv`, `poiSourcesKey`, `profileForSources`, `poiSourceClause`, kiểu `PoiSource`, `PoiSourceProfile` |
| Lỗi | `MapsLibVNError` |
| Ghi nguồn | `attributionText()`, `attributionHtml()`, `ATTRIBUTION_LINKS`, kiểu `AttributionLink` |
| Chuẩn hoá tiếng Việt | `normalizeVi`, `stripDiacritics`, `expandAbbrev`, `applyBrandAlias`, `nameCore`, `NAME_FILLERS` |
| Phân tích địa chỉ | `parseAddress`, kiểu `ParsedAddress`, `AlleyKeyword` |
| Biến đổi style | `localizeStyle`, `hidePoiLayer`, `nameExpression`, `isNameLabelLayer`, `POI_LAYER_ID`, kiểu `Lang`, `StyleLike`, `StyleLayerLike` |
| Kiểu dữ liệu API | `Place`, `PlaceDetails`, `PlaceCategory`, `PlaceAddress`, `PlaceSource`, `AutocompleteItem`, `AutocompleteType`, `GeocodeItem`, `GeocodeMatched`, `GeocodePrecision`, `ReverseResponse`, `ReverseAddress`, `EditKind`, `EditChanges`, `SuggestEditRequest`, `SuggestEditResponse`, `PoiFeature`, `TravelMode`, `DirectionsLang`, `ManeuverKind`, `Route`, `RouteLeg`, `RouteStep`, `Waypoint`, `DirectionsResponse`, `GeoFix`, `RouteProvider`, `PositionSource`, `PositionError`, `NavigationStatus`, `NavigationThresholds`, `NavigationProgress`, `Announcement`, `NavigationEvents`, `NavigatorOptions`, `Navigator` |
| Chỉ đường | `decodePolyline6`, `encodePolyline6`, `MANEUVER_KINDS`, `VALHALLA_MANEUVER_KIND`, `maneuverKindFromValhalla`, kiểu `DirectionsOptions` |
| Dẫn đường | `createNavigator`, `NAVIGATION_THRESHOLDS`, `simulateFixes`, `SIMULATE_DEFAULT_SPEED_MPS`, `formatDistance`, `formatDistanceShort`, `roundForSpeech`, `lowerFirst`, `composeApproach`, `planAnnouncements`, `buildRouteIndex`, `progressAt`, `stepAt`, `snapToRoute`, `haversineM`, `bearingDeg`, `angleDiffDeg`, `projectOnSegment`, `cumulativeDistances`, kiểu `FlatStep`, `RouteIndex`, `ProgressAt`, `SnapOptions`, `SnapResult`, `SimulateOptions`, `Projection`, `LngLat` — xem [Dẫn đường](/dan-duong/) mục 5 |
| Tuyến dạng GeoJSON | `routeFeatures`, `altRouteFeatures`, `liveRouteFeatures`, `decodeRoutes`, `EMPTY_ROUTE_FEATURES`, `FIRST_SYMBOL_LAYER_ID`, kiểu `RouteFeature`, `RouteFeatureCollection`, `RouteFeatureKind`, `RouteFeaturesOptions`, `RouteLineFeature`, `RoutePuckFeature`, `RouteProgressCut` — nguyên liệu để tự vẽ tuyến khi không dùng `map.routes` |
| Receipt hạn mức | `createReceiptStore`, kiểu `QuotaReceipt`, `QuotaReceiptStore`, `ReceiptKeyValueStorage` |
| La bàn | `createHeadingFilter`, `wrapDeg`, `signedDiffDeg`, `yawRateDps`, `MOVING_SPEED_MPS`, kiểu `HeadingFix`, `HeadingSource`, `HeadingError`, `HeadingAccuracy`, `HeadingFilter`, `HeadingFilterOptions`, `CompassSample`, `RotationRate`, `RotationRate3`, `Vec3` |
| Khoá tìm kiếm tiếng Việt | `searchKeys`, `viKey`, `foldTelex`, `looksLikeTelex`, `adminAliasKeys`, `applyToponymAlias`, `filterNameAlt`, `TOPONYM_ALIAS`, `mulberry32`, kiểu `SearchKeys`, `ToponymEntry`, `AdminAliasKeyInput` — cùng thuật toán chuẩn hoá máy chủ dùng để so khớp |
| Style | thêm `isPoiStyleLayer` bên cạnh `isNameLabelLayer` |

Định nghĩa từng kiểu dữ liệu API ở [REST API](/api/) mục 7.

### createClient

```ts
import { createClient } from '@mapslibvn/core';

const client = createClient({
  apiKey: 'mlv_live_…',
  baseUrl: 'https://api.ai-solutions.io.vn',
});
```

| Tuỳ chọn | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `apiKey` | `string` | bắt buộc | gửi trong header `X-Api-Key` ở mọi request |
| `baseUrl` | `string` | bắt buộc | dấu `/` ở cuối được cắt bỏ |
| `fetch` | `typeof fetch` | `globalThis.fetch` | tiêm fetch riêng cho test hoặc môi trường không có fetch toàn cục |
| `headers` | `Record<string, string>` | `{}` | header thêm cho mọi request, ví dụ `X-Bundle-Id` với khoá `mobile`; **không ghi đè được** `X-Api-Key` |
| `poiSources` | `PoiSource[]` | cả hai nguồn (`all`) | nhận ba profile nêu trên; áp cho autocomplete/search/nearby/reverse và URL style; `getPlace`/geocode không lọc |
| `receiptStore` | `QuotaReceiptStore` | bộ nhớ trong tiến trình | kho lưu receipt chưa xác nhận. Trên mobile hãy truyền `createReceiptStore(AsyncStorage)` để hàng đợi sống qua lần mở app sau |

### Phương thức client ứng với endpoint nào

| Thành viên | Gọi endpoint | Trả về |
|---|---|---|
| `baseUrl` | — (thuộc tính, là `baseUrl` đã cắt dấu `/`) | `string` |
| `styleUrl(theme)` | — (chỉ ghép chuỗi, không gọi mạng) | URL `/v1/styles/{theme}.json?key=…` |
| `attribution()` | `GET /v1/attribution` | `AttributionResponse` |
| `autocomplete(q, opts?)` | `GET /v1/autocomplete` | `{ items: AutocompleteItem[] }` |
| `search(q, opts?)` | `GET /v1/search` | `{ items: Place[], total: number }` |
| `nearby(opts)` | `GET /v1/nearby` | `{ items: Place[] }` |
| `getPlace(id)` | `GET /v1/places/{id}` | `PlaceDetails` |
| `geocode(q, opts?)` | `GET /v1/geocode` | `{ items: GeocodeItem[] }` |
| `reverse(lat, lng)` | `GET /v1/reverse` | `ReverseResponse` |
| `directions(opts)` | `GET /v1/directions` | `DirectionsResponse` |
| `suggestEdit(edit)` | `POST /v1/edits` | `SuggestEditResponse` |
| `flushReceipts()` | `POST /v1/quota/receipts/{id}/ack` cho mọi receipt còn chờ | `Promise<boolean>` — `true` khi hàng đợi đã sạch |

Tham số của `opts` khớp một-một với query string của endpoint tương ứng:

| Phương thức | `opts` |
|---|---|
| `autocomplete` | `near`, `limit`, `types`, `signal` |
| `search` | `category`, `near`, `radius`, `bbox`, `limit`, `offset` |
| `nearby` | `lat`, `lng` (bắt buộc), `radius`, `category`, `limit` |
| `geocode` | `near`, `limit` |
| `directions` | `from`, `to` (bắt buộc, `[lat, lng]`), `via`, `mode`, `lang`, `alternatives` |

`signal` là `AbortSignal` phía client; không giống các trường còn lại trong bảng, nó không phải tham số gửi lên server và không xuất hiện trong query string. **Từ 0.11.0 nó không huỷ request ở lớp mạng**: lời gọi của bạn reject ngay khi abort, nhưng request vẫn chạy tới cùng để nhận và xác nhận receipt — nên abort **không** tiết kiệm lượt. Abort *trước* khi gọi thì không có request nào được gửi. `usePlaces()` và `<mapslibvn-autocomplete>` tự quản lý `AbortController` bên trong nên không cần tự truyền; chỉ cần đến nó khi gọi thẳng `client.autocomplete()`.

Lưu ý về thứ tự toạ độ: `near` là `[lat, lng]` (**vĩ độ trước**, đúng như tham số `near` của API), còn `bbox` là `[minLng, minLat, maxLng, maxLat]` và `center` của bản đồ là `[lng, lat]`. Tham số `undefined` bị bỏ khỏi URL, nên client không tự áp mặc định nào — mặc định do máy chủ quyết định, xem [REST API](/api/) mục 4.

Với `directions`, tham số vào là `[lat, lng]` nhưng mọi toạ độ trong `DirectionsResponse` là `[lng, lat]`; giải mã `Route.geometry` bằng `decodePolyline6`.

### MapsLibVNError

Mọi phản hồi không thành công đều bị ném thành `MapsLibVNError` với bốn trường:

| Trường | Kiểu | Nội dung |
|---|---|---|
| `status` | `number` | mã HTTP |
| `code` | `string` | `error.code` từ body, hoặc `'http_error'` khi body lỗi không phải JSON |
| `message` | `string` | `error.message` từ body, hoặc `'HTTP <status>'` |
| `requestId` | `string \| undefined` | `error.request_id` từ body; `undefined` nếu không có |

`name` của lỗi là `'MapsLibVNError'`. Lớp này kế thừa `Error` nên `instanceof` dùng được bình thường.

```ts
import { MapsLibVNError } from '@mapslibvn/core';

try {
  await client.getPlace(id);
} catch (err) {
  if (err instanceof MapsLibVNError && err.code === 'quota_exceeded') {
    // 429 — hết hạn mức. Đọc `error.details.resetAt` khi có; máy chủ chỉ đặt `retry-after`
    // khi biết chắc thời điểm thử lại (60 giây với burst limit) — xem REST API mục 2.
  }
}
```

### Hàm tiện ích

- `attributionText()` và `attributionHtml()` trả chuỗi ghi nguồn bắt buộc (bản chữ và bản có thẻ `<a>`), sinh từ `ATTRIBUTION_LINKS`. Dùng khi bạn hiển thị dữ liệu ngoài bản đồ và không muốn gọi mạng.
- `normalizeVi(s)` chuẩn hoá một chuỗi theo đúng cách máy chủ chuẩn hoá trước khi so khớp: bỏ dấu, bung viết tắt, bỏ dấu câu. Dùng để so sánh phía client, không dùng để hiển thị.
- `nameCore(s)` bỏ các từ đệm ở đầu tên (`cong ty`, `quan`, `cafe`…) và áp alias thương hiệu.
- `parseAddress(s)` tách một câu địa chỉ thành số nhà, chuỗi hẻm, đường, phường, quận, tỉnh kèm `confidence`.
- `localizeStyle(style, lang)` và `hidePoiLayer(style)` biến đổi một style JSON thuần, không cần bản đồ đang chạy — dùng cho React Native. Trên web hãy dùng `applyLanguage` và tuỳ chọn `poiLayer`.

## 3. `@mapslibvn/web`

Export của `packages/web/src/index.ts`: `createMap`, `applyLanguage`, `nameExpression`, `MapsLibVNAutocomplete`, `defineAutocomplete`, các kiểu `CreateMapOptions`, `MapEvents`, `MapsLibVNMap`, `MarkerOptions`, `PoiFeature`, `Lang`, và re-export từ core: `createClient`, `MapsLibVNError`, `attributionText`, `attributionHtml` cùng kiểu `AttributionResponse`, `ClientOptions`, `MapsLibVNClient`, `Theme`, `geolocationSource`, `playbackSource`, `toGeoFix`, `createSpeech`, `ROUTE_SOURCE_ID`, `ROUTE_LAYER_IDS`, `FOLLOW_ZOOM`, các kiểu `RoutesLayer`, `NavigationController`, `NavigationStartOptions`, `WebNavigationEvents`, các kiểu `GeolocationSourceOptions`, `Speech`, `SpeechOptions`, và re-export dẫn đường từ core (`createNavigator`, `simulateFixes`, `formatDistance`, `formatDistanceShort`, `NAVIGATION_THRESHOLDS`).

### createMap — tuỳ chọn và mặc định

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import { createMap } from '@mapslibvn/web';

const map = createMap(
  { container: 'map', apiKey: 'mlv_live_…', apiBase: 'https://api.ai-solutions.io.vn' },
  { maplibre: maplibregl },
);
```

| Tuỳ chọn | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `container` | `string \| HTMLElement` | bắt buộc | id phần tử hoặc chính phần tử |
| `apiKey` | `string` | bắt buộc | dùng cho cả style, tiles và `map.places` |
| `apiBase` | `string` | bắt buộc | gốc API, ví dụ `https://api.ai-solutions.io.vn` |
| `style` | `'light' \| 'dark' \| string` | `'light'` | tên theme thành URL `/v1/styles/{theme}.json?key=…`; giá trị khác được coi là URL style riêng |
| `center` | `[number, number]` | `[106.7, 10.776]` | `[lng, lat]` |
| `zoom` | `number` | `12` | |
| `lang` | `'vi' \| 'en'` | `'vi'` | chỉ đổi nhãn khi khác `'vi'`, áp ở sự kiện `load`; nhãn chủ quyền luôn tiếng Việt |
| `poiLayer` | `boolean` | `true` | `false` đặt `visibility: none` cho lớp `poi` ở sự kiện `load` |
| `compactAttribution` | `boolean` | `false` | attribution gọn. **Không có tuỳ chọn tắt** — xem [Giấy phép & ghi nguồn](/giay-phep/) |

Tham số thứ hai là `deps`. Bản ESM cần `{ maplibre: maplibregl }`; nếu không truyền, `createMap` lấy `globalThis.maplibregl`, và không có thì ném `Error` thường (không phải `MapsLibVNError`) với thông điệp "Cần maplibre-gl…". Bản UMD đã đóng gói MapLibre nên `deps` không cần thiết. Giao thức `pmtiles://` được đăng ký đúng một lần cho cả trang.

`createMap` **luôn** tự thêm `AttributionControl` với chuỗi ghi nguồn đầy đủ và tắt attribution mặc định của MapLibre. File style cũng khai đúng chuỗi đó ở từng nguồn tiles, và MapLibre gộp các chuỗi trùng khít nhau nên trên màn hình chỉ hiện một lần. Nhờ hai phía đều tự đủ, ghi nguồn không mất khi bạn đặt `poiLayer: false` hay khi dùng style URL riêng.

### Bản đồ trả về

| Thành viên | Kiểu | Ghi chú |
|---|---|---|
| `gl` | `maplibregl.Map` | đối tượng MapLibre thật, mọi API của MapLibre dùng được |
| `places` | `MapsLibVNClient` | client core dùng chung `apiKey` và `apiBase` |
| `routes` | `RoutesLayer` | `show(response, { active, markers })`, `setActive(i)`, `setProgress(shapeIndex, snapped)`, `clear()` — source `mapslibvn-route`, bốn layer chèn dưới nhãn |
| `navigation` | `NavigationController` | `start(opts)`, `stop()`, `recenter()`, `reroute()`, `state`, `status`, `following`, `on/off` — xem [Dẫn đường](/dan-duong/) |
| `addMarker(o)` | `maplibregl.Marker` | `o` là `MarkerOptions`; có `popupHtml` thì gắn `Popup` với `offset: 24` |
| `fitBounds(bbox, padding?)` | `void` | `bbox` là `[minLng, minLat, maxLng, maxLat]`, `padding` mặc định `40` |
| `flyTo(center, zoom?)` | `void` | `center` là `[lng, lat]`; bỏ `zoom` thì giữ zoom hiện tại |
| `on(event, handler)` | `void` | |
| `off(event, handler)` | `void` | |
| `remove()` | `void` | dừng dẫn đường, xoá tuyến rồi gọi `gl.remove()` |

`MarkerOptions`: `lng`, `lat` bắt buộc; `popupHtml` và `color` tuỳ chọn (bỏ `color` thì dùng màu mặc định của MapLibre).

### Sự kiện và payload

| Sự kiện | Payload | Khi nào |
|---|---|---|
| `load` | `undefined` | sau khi MapLibre tải xong style; `lang` và `poiLayer` đã được áp trước khi phát |
| `poiClick` | `PoiFeature` | người dùng bấm lên một biểu tượng của lớp `poi` |
| `routeClick` | `{ index }` | người dùng bấm lên một tuyến thay thế đang vẽ mờ |

`poiClick` chỉ phát khi **đã có listener trước lúc bấm** và lớp `poi` tồn tại trong style — bấm khi `poiLayer: false` hoặc khi bộ tiles POI chưa phát hành thì không có gì xảy ra. Chỉ feature dạng `Point` đầu tiên tại điểm bấm được trả về. `PoiFeature.category` và `.group` là **mã** dạng chuỗi, còn `lngLat` theo thứ tự `[lng, lat]`.

### applyLanguage và nameExpression

`applyLanguage(gl, lang)` đổi nhãn của bản đồ đang chạy sang `'vi'` hoặc `'en'`, bỏ qua lớp chủ quyền và các nhãn không phải tên. `nameExpression(lang)` trả biểu thức MapLibre `['coalesce', ['get', 'name:<lang>'], ['get', 'name']]` nếu bạn muốn tự đặt `text-field` cho lớp của mình.

### Web component `<mapslibvn-autocomplete>`

| Thuộc tính HTML | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|
| `api-key` | có | — | đổi giá trị sẽ tạo client mới và huỷ request đang chạy |
| `api-base` | có | — | như trên |
| `placeholder` | không | `Tìm địa điểm…` | đổi được lúc chạy |
| `near` | không | — | `"lat,lng"`; bị **bỏ qua** nếu đã gán thuộc tính JS `.map` |
| `debounce` | không | `300` | mili giây; giá trị không hợp lệ (không phải số, hoặc âm) rơi về mặc định kèm cảnh báo console |

| Thuộc tính JS | Kiểu | Ghi chú |
|---|---|---|
| `.map` | bản đồ từ `createMap`, hoặc `null` | gán để lấy tâm bản đồ hiện tại làm `near` cho mỗi lần gợi ý |

| Sự kiện | `detail` | Ghi chú |
|---|---|---|
| `select` | `AutocompleteItem` | `bubbles: true`, `composed: true` nên bắt được ở ngoài shadow DOM. `detail` là **nguyên** item, kể cả `bbox` của `type: 'area'` |

Hành vi: gõ từ **2 ký tự** trở lên mới gọi API, debounce **300 ms mặc định** (chỉnh bằng thuộc tính `debounce`), phản hồi của truy vấn đã bị thay thế bị bỏ qua, và **20 truy vấn gần nhất được đệm trong phiên** nên gõ lùi hoặc thêm dấu cách không tốn lượt Places. Ô nhập là combobox ARIA (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`) với danh sách `role="listbox"` và các mục `role="option"`; `↑`/`↓` di chuyển vòng, `Enter` chọn mục đang sáng, `Escape` đóng danh sách, rời khỏi ô cũng đóng sau 150 ms. Có một vùng `role="status"` `aria-live="polite"` đọc trạng thái ("Đang tìm…", số kết quả, lỗi). Toàn bộ nằm trong shadow DOM nên CSS của trang không tác động vào bên trong.

Mỗi mục có một ký hiệu phân biệt loại ở đầu dòng (`area` khác `poi`) và thuộc tính `data-type` bằng
`item.type`, dùng được để tự đặt CSS. Với mục `type: 'area'` hãy khớp khung nhìn bằng `bbox`:

```js
document.querySelector('mapslibvn-autocomplete').addEventListener('select', (event) => {
  const item = event.detail;
  if (item.type === 'area' && item.bbox) map.fitBounds(item.bbox);
  else map.flyTo([item.lng, item.lat], 16);
});
```

`defineAutocomplete()` đăng ký thẻ `mapslibvn-autocomplete` (gọi lại nhiều lần không sao). Bản UMD **tự gọi** khi tải; bản ESM bạn phải tự gọi.

### Bản UMD

`dist/mapslibvn.umd.js` kèm `dist/mapslibvn.css` đóng gói sẵn MapLibre GL JS và pmtiles, đặt global **`MapsLibVN`** gồm: `createMap` (không cần `deps`), `maplibregl`, `createClient`, `MapsLibVNError`, `attributionText`, `attributionHtml`, `applyLanguage`, `nameExpression`, `MapsLibVNAutocomplete`, `defineAutocomplete`. Bản UMD không xuất các hàm chuẩn hoá tiếng Việt hay `parseAddress` — cần chúng thì dùng bản ESM.

## 4. `@mapslibvn/react`

Export của `packages/react/src/index.ts`: `MapsLibVNMap`, `useMap`, `Marker`, `usePlaces`, `useNavigation`, các kiểu `MapsLibVNMapProps`, `UsePlacesOptions`, `UsePlacesResult`, `UseNavigationResult`, và re-export kiểu `AutocompleteItem`, `MapsLibVNClient`, `Place`, `PoiSource`, `Announcement`, `NavigationProgress`, `NavigationStatus`, `RouteProvider` từ core và `NavigationStartOptions` từ `@mapslibvn/web`. Gói này **chỉ** re-export kiểu — cần hàm của core (ví dụ `createClient`, `formatDistanceShort`) thì import thẳng từ `@mapslibvn/core` hoặc `@mapslibvn/web`.

### `<MapsLibVNMap>`

Props gồm **mọi tuỳ chọn của `CreateMapOptions` trừ `container`** (mặc định giống bảng ở mục 3), cộng thêm:

| Prop | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `className` | `string` | — | class của khung bọc ngoài |
| `containerStyle` | `CSSProperties` | — | CSS của khung bọc; khác prop `style` (đó là theme bản đồ) |
| `onPoiClick` | `(poi: PoiFeature) => void` | — | |
| `onLoad` | `(map: MapsLibVNMap) => void` | — | nhận chính bản đồ, dùng để giữ lại `map.places` |
| `children` | `ReactNode` | — | chỉ render sau khi bản đồ đã tạo, nằm trong context của `useMap` |

Khung bọc mặc định `width: 100%`, `height: 100%`, `position: relative` — hãy đặt chiều cao cho phần tử cha, hoặc ghi đè bằng `containerStyle`.

Đổi `apiKey`, `apiBase`, `style`, `center`, `zoom`, `lang`, `poiLayer` hoặc `compactAttribution` sẽ **tạo lại bản đồ**. Đổi `onPoiClick`, `onLoad`, `className`, `containerStyle` hoặc `children` thì không — hai handler được giữ trong ref nên truyền hàm inline cũng an toàn.

### useMap, Marker, usePlaces, useNavigation

`useMap()` trả bản đồ hiện hành (cùng kiểu `MapsLibVNMap` của `@mapslibvn/web`). Gọi ngoài `<MapsLibVNMap>` sẽ **ném lỗi** `useMap phải được gọi bên trong <MapsLibVNMap>`.

`<Marker>` nhận đúng `MarkerOptions`: `lng`, `lat` bắt buộc, `popupHtml` và `color` tuỳ chọn. Component không render DOM của riêng nó; marker được thêm vào bản đồ khi mount và tự xoá khi unmount hoặc khi một trong bốn prop đổi.

```tsx
usePlaces(query, { near, limit, debounceMs, client }) // → { items, loading, error }
// items giữ nguyên mọi trường của AutocompleteItem, kể cả bbox của type 'area'
```

| Tuỳ chọn | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `near` | `[number, number]` | — | `[lat, lng]` |
| `limit` | `number` | — | bỏ trống thì dùng mặc định của endpoint (10) |
| `debounceMs` | `number` | `300` | |
| `client` | `MapsLibVNClient` | client của bản đồ trong context | **bắt buộc** khi hook nằm ngoài `<MapsLibVNMap>` |

Hook chỉ gọi API khi `query` có từ **2 ký tự** trở lên sau khi bỏ khoảng trắng; ngắn hơn thì `items` về mảng rỗng và không có request nào. Trong lúc tải, `items` giữ kết quả cũ (kiểu SWR) và `loading` là `true`. Không có `client` — cả prop lẫn context — thì hook im lặng trả mảng rỗng, không báo lỗi; đó là bẫy hay gặp khi đặt ô tìm kiếm **cạnh** bản đồ chứ không phải bên trong nó.

`useNavigation()` trả `{ status, progress, start, stop, recenter, reroute }` của `map.navigation` trong context và re-render theo `status`/`progress`. Ngoài `<MapsLibVNMap>` ném lỗi như `useMap`. Chi tiết ở [Dẫn đường](/dan-duong/) mục 6.

## 5. `@mapslibvn/react-native`

Cùng bộ API với `@mapslibvn/react` nhưng bọc `@maplibre/maplibre-react-native`. Export của
`packages/react-native/src/index.ts`, theo nhóm:

| Nhóm | Export |
|---|---|
| Bản đồ | `MapsLibVNMap`, `useMap`, `Marker`, `usePlaces`, `DEFAULT_CENTER` (`[106.7, 10.776]`), `DEFAULT_ZOOM` (`12`), `DEFAULT_MARKER_COLOR` (`'#3FB1CE'`), `COMPACT_ATTRIBUTION`, kiểu `MapsLibVNMapProps`, `MarkerProps`, `MapHandle`, `UsePlacesOptions`, `UsePlacesResult` |
| Phiên dẫn đường | `createNavigationSession`, `useNavigation`, `MISSING_SOURCE_MESSAGE`, `playbackSource`, kiểu `NavigationSession`, `NavigationSessionOptions`, `NavigationSessionStartOptions`, `SessionEvents`, `SessionPositionSource`, `AudioSession`, `KeepAwake`, `Speaker`, `BackgroundUnavailable`, `UseNavigationResult` |
| Vẽ tuyến và camera | `ROUTE_SOURCE_ID`, `ROUTE_ALT_SOURCE_ID`, `ROUTE_LAYER_IDS`, `ROUTE_COLOR`, `ALT_ROUTE_COLOR`, `DESTINATION_COLOR`, `FOLLOW_ZOOM`, `FOLLOW_PITCH` (`45`), `CAMERA_BEARING_MIN_MS`, `CAMERA_BEARING_MIN_DEG`, kiểu `RouteStyle`, `FollowOptions`, `BindingEvents`, `MapNavigationBinding` |
| Chấm xanh và la bàn | `useHeading`, `USER_LOCATION_SOURCE_ID`, `USER_LOCATION_LAYER_IDS`, `USER_FOLLOW_ZOOM` (`16`), `HEADING_CONE_IMAGE_KEY`, `HEADING_FRESH_MS`, kiểu `UserLocationOptions`, `UserLocationHandle` |
| Hạn mức | `useFlushReceiptsOnBackground(client)` — gọi `client.flushReceipts()` khi app vào nền; `<MapsLibVNMap>` đã tự dùng cho client của chính nó |
| Re-export từ core | `createClient`, `createNavigator`, `createHeadingFilter`, `simulateFixes`, `decodePolyline6`, `formatDistance`, `formatDistanceShort`, `wrapDeg`, `signedDiffDeg`, `MOVING_SPEED_MPS`, `NAVIGATION_THRESHOLDS`, cùng các kiểu `AutocompleteItem`, `Lang`, `MapsLibVNClient`, `Place`, `PoiFeature`, `PoiSource`, `Theme`, `GeoFix`, `PositionSource`, `PositionError`, `Route`, `RouteLeg`, `RouteStep`, `TravelMode`, `DirectionsOptions`, `DirectionsResponse`, `DirectionsLang`, `ManeuverKind`, `Announcement`, `NavigationProgress`, `NavigationStatus`, `NavigationEvents`, `NavigationThresholds`, `RouteProvider`, `HeadingFix`, `HeadingSource`, `HeadingError`, `HeadingAccuracy`, `HeadingFilter`, `HeadingFilterOptions`, `CompassSample`, `RotationRate` |

Entry riêng `@mapslibvn/react-native/expo` (chỉ import khi bạn dùng adapter Expo — Metro mới đi
resolve các module `expo-*` lúc đó):

| Export | Làm gì |
|---|---|
| `expoNavigation(opts?)` | gói sẵn bốn adapter dưới đây cho `createNavigationSession`; `{ heading: false }` để bỏ la bàn |
| `expoLocationSource(opts?)` | nguồn vị trí `expo-location`, có tuỳ chọn chạy nền |
| `expoHeadingSource(opts?)` | la bàn `expo-location` trộn con quay `expo-sensors` |
| `expoSpeech(opts?)` | đọc câu chỉ dẫn bằng `expo-speech` |
| `expoAudioSession()`, `expoKeepAwake()` | phiên âm thanh khi nền, giữ màn hình sáng |
| `defineNavigationTask()`, `NAVIGATION_TASK`, `KEEP_AWAKE_TAG` | đăng ký task nền — gọi ở phạm vi toàn cục của `index.ts` |
| `toGeoFix`, `toCompassSample`, `toAccuracy`, `HEADING_ACCURACY_LEVELS` | chuyển đổi kiểu của Expo sang kiểu SDK |
| kiểu | `ExpoNavigationOptions`, `ExpoLocationSourceOptions`, `ExpoLocationAccuracy`, `ExpoHeadingOptions`, `ExpoSpeechOptions` |

Phiên có thêm tuỳ chọn `heading`, sự kiện `heading`/`headingUnavailable` và getter `session.heading`.

Bốn khác biệt đáng nhớ:

- `useMap()` trả `MapHandle` với `native` và `camera` (ref của wrapper) thay cho `gl`, cộng `places`, `flyTo`, `fitBounds` và `getBounds()` bất đồng bộ.
- `center` và `zoom` chỉ là **giá trị khởi tạo** camera; đổi sau khi mount không tạo lại bản đồ — dùng `useMap().flyTo`.
- `<Marker>` không có `popupHtml`; thay vào đó có `anchor`, `onPress` và `children`.
- Có thêm prop `bundleId` (thành header `X-Bundle-Id` cho khoá `mobile`) và `onError`.

Yêu cầu phiên bản, cách cài đặt Expo và bare, cùng bảng so sánh đầy đủ với web ở [React Native](/react-native/).

## 6. Đọc thêm

- [Cài đặt](/cai-dat/) — bốn cách nhúng và hiện trạng phát hành npm.
- [Bản đồ web](/ban-do-web/) — hướng dẫn dùng `@mapslibvn/web` theo từng khả năng.
- [Tìm kiếm & autocomplete](/tim-kiem/) — chọn giữa web component và các phương thức client.
- [React](/react/) — ví dụ tìm-và-ghim trọn màn hình.
- [REST API](/api/) — tham số, giới hạn và mã lỗi của từng endpoint.
