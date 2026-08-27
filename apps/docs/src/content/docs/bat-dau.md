---
title: Bắt đầu 5 phút
description: Nhúng bản đồ MapsLibVN bằng script tag, npm hoặc React.
---

## 1. Một dòng `<script>`

```html
<link rel="stylesheet" href="https://maps-docs.example.com/sdk/mapslibvn.css" />
<script src="https://maps-docs.example.com/sdk/mapslibvn.umd.js"></script>
<div id="map" style="height:400px"></div>
<script>
  MapsLibVN.createMap({
    container: 'map',
    apiKey: 'mlv_live_…',
    apiBase: 'https://maps-api.example.com',
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
  { container: 'map', apiKey: 'mlv_live_…', apiBase: 'https://maps-api.example.com' },
  { maplibre: maplibregl },
);
map.addMarker({ lng: 106.7, lat: 10.776, popupHtml: '<b>Chợ Bến Thành</b>' });
map.on('poiClick', (poi) => console.log(poi.name));
```

`map.gl` là đối tượng `maplibregl.Map` — mọi API của MapLibre đều dùng được.

## 3. Tuỳ chọn

| Tuỳ chọn | Mặc định | Ý nghĩa |
|---|---|---|
| `style` | `'light'` | `'light'`, `'dark'` hoặc URL style riêng |
| `lang` | `'vi'` | `'en'` đổi nhãn sang tiếng Anh (nhãn chủ quyền luôn tiếng Việt) |
| `poiLayer` | `true` | ẩn lớp POI nếu `false` |
| `compactAttribution` | `false` | attribution gọn. Không có tuỳ chọn tắt — đây là nghĩa vụ giấy phép |

Thay `maps-api.example.com` / `maps-docs.example.com` bằng tên miền thật của bạn.
