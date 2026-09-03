---
title: Bắt đầu 5 phút
description: Nhúng bản đồ MapsLibVN bằng script tag, npm, React hoặc React Native.
---

## 1. Một dòng `<script>`

```html
<link rel="stylesheet" href="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.css" />
<script src="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.umd.js"></script>
<div id="map" style="height:400px"></div>
<script>
  MapsLibVN.createMap({
    container: 'map',
    apiKey: 'mlv_live_…',
    apiBase: 'https://api.ai-solutions.io.vn',
    center: [106.70, 10.776],
    zoom: 13,
  });
</script>
```

## 2. npm

```bash
pnpm add @mapslibvn/web maplibre-gl
```

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { createMap } from '@mapslibvn/web';

const map = createMap(
  { container: 'map', apiKey: 'mlv_live_…', apiBase: 'https://api.ai-solutions.io.vn' },
  { maplibre: maplibregl },
);
map.addMarker({ lng: 106.7, lat: 10.776, popupHtml: '<b>Chợ Bến Thành</b>' });
map.on('poiClick', (poi) => console.log(poi.name));
```

`map.gl` là đối tượng `maplibregl.Map` — mọi API của MapLibre đều dùng được.

## 2b. React Native

App iOS/Android dùng `@mapslibvn/react-native` với cùng props (`style`, `lang`, `poiLayer`,
`onPoiClick`) và khoá kind `mobile`. Xem [React Native](/react-native/).

## 3. Tuỳ chọn

| Tuỳ chọn | Mặc định | Ý nghĩa |
|---|---|---|
| `style` | `'light'` | `'light'`, `'dark'` hoặc URL style riêng |
| `lang` | `'vi'` | `'en'` đổi nhãn sang tiếng Anh (nhãn chủ quyền luôn tiếng Việt) |
| `poiLayer` | `true` | ẩn lớp POI nếu `false` |
| `compactAttribution` | `false` | attribution gọn. Không có tuỳ chọn tắt — đây là nghĩa vụ giấy phép |

Các ví dụ trên dùng endpoint nội bộ hiện tại: API tại `api.ai-solutions.io.vn` và SDK phục vụ từ `mapslibvn-docs.pages.dev`. Cả hai là **tạm thời** trong giai đoạn nội bộ và sẽ đổi khi MapsLibVN có tên miền riêng. Nếu bạn tự host, hãy thay bằng tên miền của mình, xem [Tự host](/tu-host/).

Khoá API phải khớp origin của trang nhúng. Nếu bị trả về lỗi `origin_not_allowed`, nghĩa là origin của bạn chưa nằm trong danh sách của khoá.

Đọc thêm: [Độ chính xác geocode](/do-chinh-xac/) để dùng đúng `precision` và `confidence`, [Giấy phép & ghi nguồn](/giay-phep/) cho nghĩa vụ attribution.
