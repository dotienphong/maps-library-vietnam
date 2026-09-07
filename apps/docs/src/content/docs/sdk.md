---
title: SDK JavaScript
description: Tham chiếu bốn gói @mapslibvn — export thật, bảng tuỳ chọn và mặc định, sự kiện và payload, phương thức client ứng với endpoint nào.
---

Trang này liệt kê **đúng những gì bốn gói xuất ra**, kèm mặc định thật lấy từ mã nguồn. Hướng dẫn từng bước ở [Bản đồ web](/ban-do-web/), [Tìm kiếm & autocomplete](/tim-kiem/) và [React](/react/); tham chiếu HTTP ở [REST API](/api/).

## 1. Bốn gói

| Gói | Phiên bản | Làm gì | Peer dependency |
|---|---|---|---|
| `@mapslibvn/core` | 0.3.0 | client REST, kiểu dữ liệu, chuỗi ghi nguồn, chuẩn hoá tiếng Việt | không có |
| `@mapslibvn/web` | 0.3.0 | `createMap` bọc MapLibre GL JS, web component autocomplete | `maplibre-gl@^5` |
| `@mapslibvn/react` | 0.3.0 | component và hook cho React | `maplibre-gl@^5`, `react>=18` |
| `@mapslibvn/react-native` | 0.3.0 | component và hook cho iOS/Android | `@maplibre/maplibre-react-native@^11.3`, `react>=19.1`, `react-native>=0.80` |

`@mapslibvn/web` phụ thuộc `@mapslibvn/core` và `pmtiles`; `@mapslibvn/react` phụ thuộc cả `core` và `web`. Bạn chỉ cần cài gói ngoài cùng.

Cả bốn gói **chưa phát hành lên npm** trong giai đoạn nội bộ. Cách cài hiện tại — UMD qua thẻ `<script>` hoặc tarball — ở [Cài đặt](/cai-dat/).

### Nâng từ 0.2.x lên 0.3.0

Bản 0.3.0 **chỉ thêm**, không đổi hành vi: mặc định vẫn là cả ba nguồn POI như 0.2.x, nên code đang
chạy không phải sửa gì. Mới:

- Tuỳ chọn `poiSources` cho `createMap`, `<MapsLibVNMap>` (React và React Native) và `createClient`;
  thuộc tính `sources` cho `<mapslibvn-autocomplete>`; tham số `sources=` cho REST.
- Export mới ở `@mapslibvn/core`: `PoiSource`, `PoiSourceProfile`, `POI_SOURCES`,
  `POI_SOURCE_PROFILES`, `DEFAULT_POI_SOURCES`, `normalizePoiSources`, `parsePoiSourcesCsv`,
  `poiSourcesKey`, `profileForSources`, `poiSourceClause`.

Đặt `poiSources: ['osm']` nếu chỉ muốn POI có nguồn chính OpenStreetMap — lưu ý đó là khoảng 7 %
kho POI hiện tại, nên bản đồ sẽ thưa hẳn.

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
| Kiểu dữ liệu API | `Place`, `PlaceDetails`, `PlaceCategory`, `PlaceAddress`, `PlaceSource`, `AutocompleteItem`, `AutocompleteType`, `GeocodeItem`, `GeocodeMatched`, `GeocodePrecision`, `ReverseResponse`, `ReverseAddress`, `EditKind`, `EditChanges`, `SuggestEditRequest`, `SuggestEditResponse`, `PoiFeature` |

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
| `suggestEdit(edit)` | `POST /v1/edits` | `SuggestEditResponse` |

Tham số của `opts` khớp một-một với query string của endpoint tương ứng:

| Phương thức | `opts` |
|---|---|
| `autocomplete` | `near`, `limit`, `types` |
| `search` | `category`, `near`, `radius`, `bbox`, `limit`, `offset` |
| `nearby` | `lat`, `lng` (bắt buộc), `radius`, `category`, `limit` |
| `geocode` | `near`, `limit` |

Lưu ý về thứ tự toạ độ: `near` là `[lat, lng]` (**vĩ độ trước**, đúng như tham số `near` của API), còn `bbox` là `[minLng, minLat, maxLng, maxLat]` và `center` của bản đồ là `[lng, lat]`. Tham số `undefined` bị bỏ khỏi URL, nên client không tự áp mặc định nào — mặc định do máy chủ quyết định, xem [REST API](/api/) mục 4.

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
    // 429 — thử lại sau, header retry-after là 3600 giây
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

Export của `packages/web/src/index.ts`: `createMap`, `applyLanguage`, `nameExpression`, `MapsLibVNAutocomplete`, `defineAutocomplete`, các kiểu `CreateMapOptions`, `MapEvents`, `MapsLibVNMap`, `MarkerOptions`, `PoiFeature`, `Lang`, và re-export từ core: `createClient`, `MapsLibVNError`, `attributionText`, `attributionHtml` cùng kiểu `AttributionResponse`, `ClientOptions`, `MapsLibVNClient`, `Theme`.

### createMap — tuỳ chọn và mặc định

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
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
| `addMarker(o)` | `maplibregl.Marker` | `o` là `MarkerOptions`; có `popupHtml` thì gắn `Popup` với `offset: 24` |
| `fitBounds(bbox, padding?)` | `void` | `bbox` là `[minLng, minLat, maxLng, maxLat]`, `padding` mặc định `40` |
| `flyTo(center, zoom?)` | `void` | `center` là `[lng, lat]`; bỏ `zoom` thì giữ zoom hiện tại |
| `on(event, handler)` | `void` | |
| `off(event, handler)` | `void` | |
| `remove()` | `void` | gọi `gl.remove()` |

`MarkerOptions`: `lng`, `lat` bắt buộc; `popupHtml` và `color` tuỳ chọn (bỏ `color` thì dùng màu mặc định của MapLibre).

### Sự kiện và payload

| Sự kiện | Payload | Khi nào |
|---|---|---|
| `load` | `undefined` | sau khi MapLibre tải xong style; `lang` và `poiLayer` đã được áp trước khi phát |
| `poiClick` | `PoiFeature` | người dùng bấm lên một biểu tượng của lớp `poi` |

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

| Thuộc tính JS | Kiểu | Ghi chú |
|---|---|---|
| `.map` | bản đồ từ `createMap`, hoặc `null` | gán để lấy tâm bản đồ hiện tại làm `near` cho mỗi lần gợi ý |

| Sự kiện | `detail` | Ghi chú |
|---|---|---|
| `select` | `AutocompleteItem` | `bubbles: true`, `composed: true` nên bắt được ở ngoài shadow DOM. `detail` là **nguyên** item, kể cả `bbox` của `type: 'area'` |

Hành vi: gõ từ **2 ký tự** trở lên mới gọi API, debounce **200 ms**, phản hồi của truy vấn đã bị thay thế bị bỏ qua. Ô nhập là combobox ARIA (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`) với danh sách `role="listbox"` và các mục `role="option"`; `↑`/`↓` di chuyển vòng, `Enter` chọn mục đang sáng, `Escape` đóng danh sách, rời khỏi ô cũng đóng sau 150 ms. Có một vùng `role="status"` `aria-live="polite"` đọc trạng thái ("Đang tìm…", số kết quả, lỗi). Toàn bộ nằm trong shadow DOM nên CSS của trang không tác động vào bên trong.

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

Export của `packages/react/src/index.ts`: `MapsLibVNMap`, `useMap`, `Marker`, `usePlaces`, các kiểu `MapsLibVNMapProps`, `UsePlacesOptions`, `UsePlacesResult`, và re-export kiểu `AutocompleteItem`, `MapsLibVNClient`, `Place` từ core.

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

### useMap, Marker, usePlaces

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
| `debounceMs` | `number` | `200` | |
| `client` | `MapsLibVNClient` | client của bản đồ trong context | **bắt buộc** khi hook nằm ngoài `<MapsLibVNMap>` |

Hook chỉ gọi API khi `query` có từ **2 ký tự** trở lên sau khi bỏ khoảng trắng; ngắn hơn thì `items` về mảng rỗng và không có request nào. Trong lúc tải, `items` giữ kết quả cũ (kiểu SWR) và `loading` là `true`. Không có `client` — cả prop lẫn context — thì hook im lặng trả mảng rỗng, không báo lỗi; đó là bẫy hay gặp khi đặt ô tìm kiếm **cạnh** bản đồ chứ không phải bên trong nó.

## 5. `@mapslibvn/react-native`

Cùng bộ API với `@mapslibvn/react` nhưng bọc `@maplibre/maplibre-react-native`. Export của `packages/react-native/src/index.ts`: `MapsLibVNMap`, `useMap`, `Marker`, `usePlaces`, `DEFAULT_CENTER` (`[106.7, 10.776]`), `DEFAULT_ZOOM` (`12`), `DEFAULT_MARKER_COLOR` (`'#3FB1CE'`), `COMPACT_ATTRIBUTION`, các kiểu `MapsLibVNMapProps`, `MarkerProps`, `MapHandle`, `UsePlacesOptions`, `UsePlacesResult`, và re-export kiểu `AutocompleteItem`, `Lang`, `MapsLibVNClient`, `Place`, `PoiFeature`, `Theme` từ core.

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
