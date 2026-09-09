# @mapslibvn/web

SDK bản đồ Web của MapsLibVN, bọc MapLibre GL JS và PMTiles, có autocomplete web component và
attribution bắt buộc.

## Cài đặt

```bash
npm install @mapslibvn/web maplibre-gl@^6.4.1
```

MapLibre GL JS 6 yêu cầu trình duyệt hỗ trợ WebGL2. Nạp CSS của MapLibre một lần ở điểm vào ứng
dụng.

## Ví dụ ESM

```ts
import { createMap } from '@mapslibvn/web';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const map = createMap(
  {
    container: 'map',
    apiKey: 'mlv_live_…',
    apiBase: 'https://api.ai-solutions.io.vn',
    center: [106.7, 10.776],
    zoom: 13,
  },
  { maplibre: maplibregl },
);
```

Bản UMD tại export `@mapslibvn/web/umd` đóng gói sẵn MapLibre và PMTiles. Khi tự phục vụ UMD, đặt
`maplibre-gl-worker.mjs` và `maplibre-gl-shared.mjs` cạnh `mapslibvn.umd.js`. Không tắt hoặc che
attribution. Không đưa khóa bí mật vào mã nguồn; khóa Web phải giới hạn đúng origin.

Tài liệu: <https://mapslibvn-docs.pages.dev/ban-do-web/>

Giấy phép mã nguồn: MIT; xem `THIRD_PARTY_NOTICES.md` cho giấy phép phụ thuộc và dữ liệu.
