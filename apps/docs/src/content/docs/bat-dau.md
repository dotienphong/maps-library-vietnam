---
title: Bắt đầu 5 phút
description: Đường nhanh nhất để có bản đồ MapsLibVN chạy — script tag, npm, React hoặc React Native.
---

Đây là đường ngắn nhất. Muốn biết đủ điều kiện, yêu cầu và cách xử lý lỗi thì đọc
[Cài đặt](/cai-dat/).

## 1. Một dòng `<script>`

Cách nhanh nhất, không cần build. Bản UMD đã gói sẵn `maplibre-gl` và `pmtiles`.

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

Chưa có khoá? Dùng [khoá demo](/khoa-api/) và chạy trên `http://localhost` —
[Nhúng thử trang của bạn](/nhung-thu/) hướng dẫn trong hai phút.

## 2. npm

:::note[Gói npm đã public]
Bốn gói `@mapslibvn/*` đã phát hành công khai; dist-tag `latest` hiện trỏ tới `0.4.0`.
:::

```bash
pnpm add @mapslibvn/web maplibre-gl
```

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import { createMap } from '@mapslibvn/web';

const map = createMap(
  { container: 'map', apiKey: 'mlv_live_…', apiBase: 'https://api.ai-solutions.io.vn' },
  { maplibre: maplibregl },
);
map.addMarker({ lng: 106.7, lat: 10.776, popupHtml: '<b>Chợ Bến Thành</b>' });
map.on('poiClick', (poi) => console.log(poi.name));
```

`maplibre-gl@^6.4.1` là peer dependency và bản ESM không gộp nó, nên phải truyền
`{ maplibre: maplibregl }`. `map.gl` là đối tượng `maplibregl.Map` — mọi API của MapLibre đều dùng
được.

## 3. React

```tsx
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapsLibVNMap, Marker } from '@mapslibvn/react';

<MapsLibVNMap apiKey="mlv_live_…" apiBase="https://api.ai-solutions.io.vn" containerStyle={{ height: 400 }}>
  <Marker lng={106.6981} lat={10.7725} />
</MapsLibVNMap>;
```

## 4. React Native

App iOS/Android dùng `@mapslibvn/react-native` với cùng props (`style`, `lang`, `poiLayer`,
`onPoiClick`) và khoá kind `mobile`. Xem [React Native](/react-native/).

## 5. Endpoint và khoá

Các ví dụ trên dùng endpoint nội bộ hiện tại: API tại `api.ai-solutions.io.vn` và SDK phục vụ từ
`mapslibvn-docs.pages.dev`. Cả hai là **tạm thời** trong giai đoạn nội bộ và sẽ đổi khi MapsLibVN có
tên miền riêng. Nếu bạn tự host, hãy thay bằng tên miền của mình, xem [Tự host](/tu-host/).

Khoá API phải khớp origin của trang nhúng. Nếu bị trả về lỗi `origin_not_allowed`, nghĩa là origin
của bạn chưa nằm trong danh sách của khoá — xem [Khoá API](/khoa-api/).

## 6. Đọc thêm

- [Cài đặt](/cai-dat/) — bốn cách nhúng đầy đủ, bảng yêu cầu, lỗi hay gặp.
- [Khoá API](/khoa-api/) — ba loại khoá, scope, quota, cách xin khoá.
- [Nhúng thử trang của bạn](/nhung-thu/) — trang HTML trắng chạy được ngay bằng khoá demo.
- [Bản đồ web](/ban-do-web/) — toàn bộ tuỳ chọn `createMap`, marker, sự kiện, đổi ngôn ngữ.
- [Độ chính xác geocode](/do-chinh-xac/) — dùng đúng `precision` và `confidence`.
- [Giấy phép & ghi nguồn](/giay-phep/) — nghĩa vụ attribution.
