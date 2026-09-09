# @mapslibvn/react

React bindings cho MapsLibVN: `<MapsLibVNMap>`, `<Marker>`, `useMap()` và `usePlaces()`.

## Cài đặt

```bash
npm install @mapslibvn/react maplibre-gl@^6.4.1 react
```

Yêu cầu React 18+ và trình duyệt hỗ trợ WebGL2. Nạp CSS của MapLibre một lần ở điểm vào ứng dụng.

## Ví dụ

```tsx
import { MapsLibVNMap, Marker } from '@mapslibvn/react';
import 'maplibre-gl/dist/maplibre-gl.css';

export function BanDo() {
  return (
    <MapsLibVNMap
      apiKey="mlv_live_…"
      apiBase="https://api.ai-solutions.io.vn"
      containerStyle={{ height: 400 }}
    >
      <Marker lng={106.6981} lat={10.7725} />
    </MapsLibVNMap>
  );
}
```

Phần tử cha phải có chiều cao thật. Không tắt hoặc che attribution; khóa Web phải giới hạn đúng
origin.

Tài liệu: <https://mapslibvn-docs.pages.dev/react/>

Giấy phép mã nguồn: MIT; xem `THIRD_PARTY_NOTICES.md` cho giấy phép phụ thuộc và dữ liệu.
