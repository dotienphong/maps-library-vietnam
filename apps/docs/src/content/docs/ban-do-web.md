---
title: Bản đồ web
description: Hướng dẫn đầy đủ gói @mapslibvn/web — tuỳ chọn createMap, theme, ngôn ngữ, marker, khung nhìn, sự kiện load và poiClick, truy cập thẳng MapLibre qua map.gl.
---

Gói `@mapslibvn/web` bọc `maplibre-gl` bằng một lớp mỏng: lo style, tiles, ghi nguồn và lớp POI,
còn lại trả nguyên đối tượng MapLibre cho bạn. Trang này đi hết mọi khả năng của `createMap`.

## 1. Tạo bản đồ

Bản UMD — `MapsLibVN.createMap` không cần truyền `maplibre-gl`:

```html
<link rel="stylesheet" href="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.css" />
<script src="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.umd.js"></script>
<div id="map" style="height:400px"></div>
<script>
  const map = MapsLibVN.createMap({
    container: 'map',
    apiKey: 'mlv_live_…',
    apiBase: 'https://api.ai-solutions.io.vn',
  });
</script>
```

Bản ESM — `maplibre-gl` là **peer dependency**, phải truyền vào qua tham số thứ hai:

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import { createMap } from '@mapslibvn/web';

const map = createMap(
  { container: 'map', apiKey: 'mlv_live_…', apiBase: 'https://api.ai-solutions.io.vn' },
  { maplibre: maplibregl },
);
```

Nếu không truyền `{ maplibre }`, `createMap` tìm `globalThis.maplibregl`; không thấy thì ném
`Error('Cần maplibre-gl: import maplibre-gl hoặc dùng bản UMD @mapslibvn/web/umd')`.

Gói `@mapslibvn/web` đã public trên npm; các cách cài xem [Cài đặt](/cai-dat/).

## 2. Tuỳ chọn `CreateMapOptions`

| Tuỳ chọn | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `container` | `string \| HTMLElement` | — | **bắt buộc**. Id phần tử hoặc chính phần tử DOM |
| `apiKey` | `string` | — | **bắt buộc**. Khoá dạng `mlv_live_…`, dùng cho cả style lẫn `map.places` |
| `apiBase` | `string` | — | **bắt buộc**. Gốc API, ví dụ `https://api.ai-solutions.io.vn` |
| `style` | `'light' \| 'dark' \| string` | `'light'` | Theme của MapsLibVN, hoặc URL style riêng |
| `center` | `[number, number]` | `[106.7, 10.776]` | `[lng, lat]` — kinh độ trước, như MapLibre |
| `zoom` | `number` | `12` | Mức thu phóng ban đầu |
| `lang` | `'vi' \| 'en'` | `'vi'` | Ngôn ngữ nhãn |
| `poiLayer` | `boolean` | `true` | `false` ẩn lớp POI |
| `poiSources` | `('osm' \| 'fsq')[]` | cả hai (`all`) | Nguồn POI cho bản đồ **và** `map.places`; nhận đúng ba profile ở mục 8, tổ hợp khác ném lỗi khi tạo map |
| `compactAttribution` | `boolean` | `false` | Attribution dạng gọn. Không có tuỳ chọn tắt |

Phần tử chứa bản đồ phải có chiều cao thật (`height`), nếu không bản đồ cao 0 pixel.

## 3. Theme và style riêng

Khi `style` là `'light'` hoặc `'dark'`, SDK lấy style từ API của bạn:
`{apiBase}/v1/styles/{theme}.json?key={apiKey}`. Mọi giá trị khác được coi là **URL style**, dùng
nguyên xi:

```js
const map = MapsLibVN.createMap({
  container: 'map',
  apiKey: 'mlv_live_…',
  apiBase: 'https://api.ai-solutions.io.vn',
  style: 'https://vi-du.example.vn/style-cua-toi.json',
});
```

Với style riêng, lớp `poi` có thể không tồn tại — khi đó `poiLayer: false` không có tác dụng gì và
sự kiện `poiClick` không bao giờ bắn (xem mục 7).

Đổi theme sau khi tạo map thì gọi thẳng MapLibre:

```js
map.gl.setStyle(map.places.styleUrl('dark'));
```

Lưu ý: SDK chỉ áp `lang` và `poiLayer` một lần khi style đầu tải xong. Sau `setStyle`, hãy gọi lại
`applyLanguage` (mục 4) và ẩn lớp `poi` (mục 8) trong `map.gl.once('style.load', …)` nếu bạn đang dùng
hai tuỳ chọn đó. Cách đơn giản hơn là gỡ map và tạo lại với `style` mới, như playground đang làm.

## 4. Ngôn ngữ nhãn

`lang: 'en'` được áp dụng **một lần** khi style tải xong. Muốn đổi lúc chạy, gọi `applyLanguage`:

```js
MapsLibVN.applyLanguage(map.gl, 'en'); // 'vi' | 'en'
```

`applyLanguage` duyệt mọi lớp `symbol` có `text-field` tham chiếu `name` và đặt lại thành
`['coalesce', ['get', 'name:en'], ['get', 'name']]`. Lớp `sovereignty-label` được **bỏ qua**, nên
nhãn Hoàng Sa và Trường Sa luôn giữ tiếng Việt. Hàm này cần style đã tải xong — gọi trong
`map.on('load', …)` hoặc sau đó.

## 5. Marker và popup

```js
const marker = map.addMarker({
  lng: 106.6981,
  lat: 10.7725,
  popupHtml: '<b>Chợ Bến Thành</b><br>Quận 1',
  color: '#2458a6',
});
```

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `lng`, `lat` | `number` | có | — |
| `popupText` | `string` | không | Popup văn bản thuần, hiện nguyên văn. Dùng cho mọi dữ liệu lấy từ API |
| `popupHtml` | `string` | không | Popup HTML, **không được lọc**. Chỉ truyền HTML bạn tự viết |
| `color` | `string` | không | Màu marker mặc định của MapLibre |

Tên POI, địa chỉ và mọi chuỗi khác lấy từ API là dữ liệu bản đồ mà bên thứ ba sửa được. Đưa chúng
vào `popupHtml` là để trang của bạn chạy HTML của người lạ, nên hãy dùng `popupText`. Có cả hai
thì `popupText` được dùng. Popup luôn gắn `maplibregl.Popup` với `offset: 24`.

`addMarker` trả về **`maplibregl.Marker`** đã `addTo(map.gl)`. Muốn gỡ thì gọi `marker.remove()`;
muốn di chuyển thì `marker.setLngLat([lng, lat])`.

## 6. Khung nhìn — `flyTo` và `fitBounds`

```js
map.flyTo([106.6981, 10.7725]);      // giữ nguyên zoom hiện tại
map.flyTo([106.6981, 10.7725], 16);  // đặt luôn zoom

map.fitBounds([106.68, 10.76, 106.72, 10.79]);      // padding mặc định 40 px
map.fitBounds([106.68, 10.76, 106.72, 10.79], 80);
```

`bbox` theo thứ tự `[minLng, minLat, maxLng, maxLat]` — đúng thứ tự mà `GeocodeItem.bbox` trả về,
nên ghép thẳng được:

```js
const { items } = await map.places.geocode('Chợ Bến Thành');
if (items[0]?.bbox) map.fitBounds(items[0].bbox);
```

## 7. Sự kiện `load` và `poiClick`

```js
map.on('load', () => console.log('Style đã tải xong'));

map.on('poiClick', (poi) => {
  console.log(poi.id, poi.name, poi.category, poi.group, poi.lngLat);
});
```

| Sự kiện | Payload |
|---|---|
| `load` | `undefined`. Bắn một lần khi style tải xong, sau khi SDK áp `lang` và `poiLayer` |
| `poiClick` | `PoiFeature`: `{ id, name, category, group, lngLat }` — `category` là mã loại, `group` là mã nhóm, `lngLat` là `[lng, lat]` |

Vài điều dễ vấp:

- `load` bắn **đúng một lần**. Đăng ký sau khi bản đồ đã tải xong thì handler không chạy — hãy gọi
  `map.on('load', …)` ngay sau `createMap`.
- `poiClick` **chỉ hoạt động khi đã có ít nhất một listener và style có lớp `poi`**. SDK kiểm tra cả
  hai điều kiện ở mỗi lần bấm; thiếu một trong hai thì không truy vấn gì cả.
- Truy vấn dùng `queryRenderedFeatures` tại đúng điểm bấm, chỉ lấy đối tượng đầu tiên và chỉ nhận
  hình học `Point`. Bấm lệch khỏi biểu tượng vài pixel là không có kết quả.
- Biểu tượng POI xuất hiện tăng dần từ zoom 10 theo độ quan trọng và mật độ. Nhãn địa danh lớn xuất
  hiện từ zoom 12; nhãn địa điểm địa phương từ zoom 16. POI không hiện trên nền vẫn tìm được qua
  Search/Nearby.
- `off` gỡ listener: `map.off('poiClick', handler)`.

Lấy chi tiết POI vừa bấm:

```js
map.on('poiClick', async (poi) => {
  const chiTiet = await map.places.getPlace(poi.id);
  console.log(chiTiet.address.text, chiTiet.sources);
});
```

## 8. Lớp POI

Mặc định `all` vẽ cả hai nguồn. Ba profile hợp lệ là `all` (`['osm','fsq']`), `osm` (`['osm']`) và
`fsq` (`['fsq']`). Các cấu hình riêng:

```js
poiSources: ['osm'];
poiSources: ['fsq'];
```

Nếu archive riêng chưa phát hành, style dùng `all` và trả header `x-poi-profile: all;fallback`.
Tuỳ chọn áp cho `search`, `nearby`, `reverse` và autocomplete của `map.places`; `getPlace(id)` không
lọc theo profile. POI thuộc nguồn bị tắt bị loại khỏi các truy vấn danh sách; POI cùng nguồn nhưng bị
thinning khỏi tile vẫn có thể tìm thấy. POI người dùng luôn được giữ trong mọi profile nhưng vẫn
chịu trạng thái, xếp hạng, limit và thinning bình thường. `<mapslibvn-autocomplete>` nhận thuộc tính
`sources="osm"` hoặc `sources="fsq"` tương ứng.

`poiLayer: false` đặt `visibility: 'none'` cho lớp `poi` khi style tải xong. Bật lại lúc chạy:

```js
map.gl.setLayoutProperty('poi', 'visibility', 'visible');
```

## 9. `map.gl` — toàn bộ API MapLibre

`map.gl` là đối tượng `maplibregl.Map`, không bị giấu gì. Mọi thứ MapLibre làm được đều dùng thẳng:

```js
map.gl.addControl(new MapsLibVN.maplibregl.NavigationControl(), 'top-right');
map.gl.on('moveend', () => {
  const c = map.gl.getCenter();
  console.log(c.lng.toFixed(4), c.lat.toFixed(4), map.gl.getZoom().toFixed(1));
});
```

Bản UMD xuất luôn `MapsLibVN.maplibregl` nên không cần thẻ `<script>` thứ hai cho MapLibre.

## 10. `map.places` — gọi Places API cùng khoá

`map.places` là client `@mapslibvn/core` được tạo sẵn với `apiKey` và `apiBase` bạn đã truyền:

```js
const { items } = await map.places.nearby({
  lat: map.gl.getCenter().lat,
  lng: map.gl.getCenter().lng,
  radius: 800,
  category: 'cafe',
});
for (const p of items) map.addMarker({ lng: p.lng, lat: p.lat, popupText: p.name });
```

Danh sách phương thức đầy đủ ở [Tìm kiếm & autocomplete](/tim-kiem/) và [SDK JavaScript](/sdk/).

Ngoài `gl` và `places`, đối tượng map còn có `routes` (vẽ tuyến: `show`, `setActive`,
`setProgress`, `clear`) và `navigation` (dẫn đường từng bước: `start`, `stop`, `recenter`,
`reroute`) — xem [Dẫn đường](/dan-duong/).

## 11. Gỡ bản đồ

```js
map.remove();
```

Gọi khi rời trang hoặc trước khi tạo lại bản đồ với tuỳ chọn khác — nếu không, phiên bản cũ vẫn giữ
WebGL context và listener.

## 12. Lỗi hay gặp

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| `Error: Cần maplibre-gl…` | Dùng bản ESM mà quên truyền `{ maplibre: maplibregl }` |
| Bản đồ trắng, cao 0 px | Phần tử `container` chưa có `height` |
| Marker và popup không có kiểu | Quên nạp CSS (`mapslibvn.css` với UMD, `maplibre-gl.css` với ESM) |
| API trả `403 origin_not_allowed` | Origin của trang chưa nằm trong danh sách của khoá — xem [Khoá API](/khoa-api/) |
| `poiClick` không bắn | Style không có lớp `poi`, hoặc bấm lệch khỏi biểu tượng |

Các ví dụ trên dùng endpoint nội bộ hiện tại `api.ai-solutions.io.vn` và SDK phục vụ từ
`mapslibvn-docs.pages.dev`. Cả hai là **tạm thời** trong giai đoạn nội bộ và sẽ đổi khi MapsLibVN có
tên miền riêng.

Đọc thêm: [Tìm kiếm & autocomplete](/tim-kiem/), [React](/react/),
[SDK JavaScript](/sdk/).
