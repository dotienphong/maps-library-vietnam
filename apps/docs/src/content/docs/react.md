---
title: React
description: Gói @mapslibvn/react — component MapsLibVNMap, hook useMap và usePlaces, component Marker, kèm ví dụ tìm-và-ghim trọn màn hình.
---

`@mapslibvn/react` gói `@mapslibvn/web` thành component React: một `<MapsLibVNMap>` lo vòng đời bản
đồ, `useMap()` và `usePlaces()` cho phần còn lại.

## 1. Cài đặt

```bash
pnpm add @mapslibvn/react maplibre-gl react
```

`maplibre-gl@^6.4.1` và `react>=18` là **peer dependency** — bạn tự cài. Gói `@mapslibvn/react` import
`maplibre-gl` trực tiếp nên **không** phải truyền `{ maplibre }` như bản web thuần.

Gói đã public trên npm; lệnh trên cài trực tiếp từ registry.

Nhớ nạp CSS của MapLibre một lần ở điểm vào ứng dụng:

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
```

Cùng chỗ đó, trỏ luôn **worker của MapLibre** về thư mục tĩnh của bạn, sau khi đã copy hai file
`maplibre-gl-worker.mjs` và `maplibre-gl-shared.mjs` từ `node_modules/maplibre-gl/dist/` vào `public/`:

```ts
import * as maplibregl from 'maplibre-gl';

maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs');
```

Bỏ bước này thì **bản build** ra bản đồ trống trơn (dev server vẫn tốt, nên rất dễ chẩn đoán sai). Lý
do và cách gắn vào script build: [Cài đặt — Worker của MapLibre khi dùng bundler](/cai-dat/).

## 2. `<MapsLibVNMap>`

```tsx
import { MapsLibVNMap, Marker } from '@mapslibvn/react';

export function BanDo() {
  return (
    <div style={{ height: '100vh' }}>
      <MapsLibVNMap
        apiKey="mlv_live_…"
        apiBase="https://api.ai-solutions.io.vn"
        center={[106.7, 10.776]}
        zoom={13}
        onPoiClick={(poi) => console.log(poi.name, poi.category)}
      >
        <Marker lng={106.6981} lat={10.7725} popupHtml="<b>Chợ Bến Thành</b>" />
      </MapsLibVNMap>
    </div>
  );
}
```

Props nhận **toàn bộ `CreateMapOptions` trừ `container`**, cộng năm prop riêng của React:

| Prop | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `apiKey` | `string` | — | bắt buộc |
| `apiBase` | `string` | — | bắt buộc |
| `style` | `'light' \| 'dark' \| string` | `'light'` | theme hoặc URL style. **Không phải** CSS |
| `center` | `[number, number]` | `[106.7, 10.776]` | `[lng, lat]` |
| `zoom` | `number` | `12` | — |
| `lang` | `'vi' \| 'en'` | `'vi'` | — |
| `poiLayer` | `boolean` | `true` | — |
| `poiSources` | `PoiSource[]` | cả hai (`all`) | Ba profile: cả hai, `['osm']`, `['fsq']`. Đổi prop là tạo lại map |
| `compactAttribution` | `boolean` | `false` | — |
| `className` | `string` | — | class của khung bao |
| `containerStyle` | `CSSProperties` | — | CSS của khung bao. Đây mới là chỗ đặt kiểu, vì `style` đã mang nghĩa theme |
| `onPoiClick` | `(poi: PoiFeature) => void` | — | — |
| `onLoad` | `(map) => void` | — | nhận đối tượng map của `@mapslibvn/web` (`gl`, `places`, `flyTo`…) |
| `children` | `ReactNode` | — | chỉ render **sau khi** map được tạo |

Khung bao mặc định `width: 100%; height: 100%; position: relative`, nên **phần tử cha phải có chiều
cao thật**. `containerStyle` ghi đè được cả `position`.

Các profile riêng dùng trực tiếp trên component:

```tsx
<MapsLibVNMap poiSources={['osm']} {...props} />
<MapsLibVNMap poiSources={['fsq']} {...props} />
```

POI người dùng luôn được giữ. Các lời gọi danh sách qua client của map dùng cùng profile;
`getPlace(id)` không lọc. Nếu archive profile hợp lệ chưa có, style tạm dùng `all` và trả
`x-poi-profile: all;fallback`.

### Đổi prop nào thì tạo lại bản đồ

Đổi bất kỳ prop nào trong `apiKey`, `apiBase`, `style`, `center`, `zoom`, `lang`, `poiLayer`,
`compactAttribution` sẽ **huỷ và tạo lại** bản đồ: vị trí người dùng đã kéo bị mất và `onLoad` chạy
lần nữa. Vì vậy:

- Coi `center` và `zoom` là **giá trị khởi tạo**. Muốn di chuyển bản đồ lúc chạy thì dùng
  `useMap().flyTo(...)` chứ đừng đổi prop.
- Giữ `center` ổn định — mảng literal viết thẳng trong JSX tạo tham chiếu mới mỗi lần render, nhưng
  effect so sánh theo `center[0]` và `center[1]` nên chỉ tạo lại khi giá trị thật sự đổi.

`onPoiClick` và `onLoad` được giữ trong ref, nên truyền hàm mũi tên viết thẳng trong JSX **không**
gây tạo lại bản đồ.

## 3. `useMap()`

```tsx
import { useMap } from '@mapslibvn/react';

function NutVeTrungTam() {
  const map = useMap();
  return (
    <button type="button" onClick={() => map.flyTo([106.7, 10.776], 13)}>
      Về trung tâm
    </button>
  );
}
```

Trả về chính đối tượng map của `@mapslibvn/web`: `gl`, `places`, `routes`, `navigation`,
`addMarker`, `fitBounds`, `flyTo`, `on`, `off`, `remove`. Gọi **ngoài** `<MapsLibVNMap>` sẽ ném
`Error('useMap phải được gọi bên trong <MapsLibVNMap>')`.

Component dùng `useMap()` phải nằm trong `children` của `<MapsLibVNMap>`. Cần điều khiển bản đồ từ
một component **cạnh** map (ví dụ thanh bên) thì giữ lại đối tượng map do `onLoad` trả về:

```tsx
const [map, setMap] = useState(null);
// …
<MapsLibVNMap … onLoad={setMap} />
// rồi map?.flyTo([106.7, 10.776], 13) từ bất kỳ đâu
```

Trong TypeScript, kiểu của giá trị đó là `MapsLibVNMap` **của `@mapslibvn/web`** — trùng tên với
component React, nên hãy import kèm bí danh:
`import type { MapsLibVNMap as WebMap } from '@mapslibvn/web';`

## 4. `<Marker>`

```tsx
<Marker lng={106.6981} lat={10.7725} popupHtml="<b>Chợ Bến Thành</b>" color="#2458a6" />
```

| Prop | Kiểu | Bắt buộc |
|---|---|---|
| `lng`, `lat` | `number` | có |
| `popupText` | `string` | không |
| `popupHtml` | `string` | không |
| `color` | `string` | không |

`popupText` hiện nguyên văn, dùng nó cho tên POI và mọi dữ liệu lấy từ API. `popupHtml` không được
lọc, chỉ truyền HTML bạn tự viết.

`<Marker>` không render DOM nào của riêng nó (`return null`): nó gọi `map.addMarker` trong effect và
gỡ marker khi unmount. Đổi bất kỳ prop nào cũng gỡ marker cũ rồi thêm marker mới. Phải đặt bên trong
`<MapsLibVNMap>` vì nó dùng `useMap()`.

## 5. `usePlaces()`

```tsx
const { items, loading, error } = usePlaces(query, {
  near: [10.776, 106.7], // [lat, lng]
  limit: 8,
  debounceMs: 300,
  client,
});
```

| Tuỳ chọn | Kiểu | Mặc định |
|---|---|---|
| `near` | `[number, number]` | không có — **vĩ độ trước** |
| `limit` | `number` | không truyền (API mặc định 10) |
| `debounceMs` | `number` | `300` |
| `client` | `MapsLibVNClient` | lấy từ `<MapsLibVNMap>` gần nhất qua context |

Trả về `{ items: AutocompleteItem[]; loading: boolean; error: Error | null }`.

Hành vi cần nhớ:

- Query được cắt khoảng trắng; **ngắn hơn 2 ký tự** thì hook xoá `items`, đặt `loading` và `error`
  về trạng thái rỗng và **không gọi mạng**.
- `loading` bật ngay khi query hợp lệ, trước khi hết debounce.
- Kiểu SWR: `items` cũ được **giữ nguyên** trong lúc tải query mới, nên danh sách không nhấp nháy.
- Phản hồi của query đã bị huỷ bị bỏ qua, không ghi đè kết quả mới.
- **Cần `client` khi hook nằm ngoài `<MapsLibVNMap>`.** Không có client thì hook im lặng trả mảng
  rỗng, không báo lỗi — đây là lỗi hay gặp nhất khi ô tìm kiếm đặt cạnh bản đồ chứ không phải bên
  trong nó.

## 6. `useNavigation()`

```tsx
import { useNavigation } from '@mapslibvn/react';

function DanDuong({ response }: { response: DirectionsResponse }) {
  const { status, progress, start, stop } = useNavigation();
  if (status === 'idle' || status === 'arrived') {
    return <button onClick={() => start({ response })}>Bắt đầu</button>;
  }
  const next = progress?.nextStep ?? progress?.step;
  return (
    <div>
      <p>{next?.instruction}</p>
      <button onClick={stop}>Dừng</button>
    </div>
  );
}
```

Hook đọc `map.navigation` của bản đồ trong context; `start/stop/recenter/reroute` là hàm của SDK web.
Tuỳ chọn `start()` và danh sách sự kiện ở [Dẫn đường](/dan-duong/).

## 7. Ví dụ — tìm và ghim

Ô tìm kiếm nằm **ngoài** map, nên phải tự tạo `client` và truyền vào `usePlaces`; component ghim
marker nằm **trong** map để dùng được `useMap()`.

```tsx
import { type AutocompleteItem, createClient } from '@mapslibvn/core';
import { MapsLibVNMap, Marker, useMap, usePlaces } from '@mapslibvn/react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useState } from 'react';

const API_KEY = 'mlv_live_…';
const API_BASE = 'https://api.ai-solutions.io.vn';
const TRUNG_TAM: [number, number] = [106.7, 10.776];

function DiaDiemDaChon({ item }: { item: AutocompleteItem }) {
  const map = useMap();
  useEffect(() => map.flyTo([item.lng, item.lat], 16), [map, item.lng, item.lat]);
  return <Marker lng={item.lng} lat={item.lat} />;
}

export default function TimVaGhim() {
  const client = useMemo(() => createClient({ apiKey: API_KEY, baseUrl: API_BASE }), []);
  const [query, setQuery] = useState('');
  const [chon, setChon] = useState<AutocompleteItem | null>(null);
  const { items, loading, error } = usePlaces(query, {
    client,
    near: [TRUNG_TAM[1], TRUNG_TAM[0]],
  });

  let trangThai = 'Nhập ít nhất 2 ký tự.';
  if (loading) trangThai = 'Đang tìm…';
  else if (error) trangThai = 'Không thể tải kết quả. Hãy thử lại.';
  else if (chon) trangThai = `Đã chọn ${chon.name}`;
  else if (query.trim().length >= 2)
    trangThai = items.length > 0 ? `Có ${items.length} kết quả.` : 'Không tìm thấy kết quả.';

  return (
    <main style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: '100vh' }}>
      <section aria-label="Tìm địa điểm">
        <label htmlFor="q">Địa điểm</label>
        <input
          id="q"
          value={query}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setChon(null);
          }}
        />
        <p aria-live="polite">{trangThai}</p>
        <ul>
          {items.map((item) => (
            <li key={`${item.type}-${item.id ?? item.name}-${item.lat}-${item.lng}`}>
              <button type="button" onClick={() => setChon(item)}>
                <span>{item.name}</span>
                {item.secondary ? <small>{item.secondary}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Bản đồ kết quả">
        <MapsLibVNMap apiKey={API_KEY} apiBase={API_BASE} center={TRUNG_TAM} zoom={13}>
          {chon ? <DiaDiemDaChon item={chon} /> : null}
        </MapsLibVNMap>
      </section>
    </main>
  );
}
```

Bản chạy được của ví dụ này là [React demo](/react-demo/).

## 8. Lỗi hay gặp

| Hiện tượng | Nguyên nhân |
|---|---|
| Bản đồ cao 0 px | Phần tử cha không có chiều cao; đặt `height` cho cha hoặc dùng `containerStyle` |
| `useMap phải được gọi bên trong <MapsLibVNMap>` | Component gọi hook không nằm trong `children` của map |
| `usePlaces` luôn trả mảng rỗng | Hook ở ngoài `<MapsLibVNMap>` mà chưa truyền `client` |
| `useNavigation` ném lỗi | Hook ở ngoài `<MapsLibVNMap>` |
| Bản đồ nhấp nháy, tự nhảy về tâm ban đầu | Đang đổi `center` hoặc `zoom` bằng state — dùng `useMap().flyTo` thay thế |
| Marker và popup mất kiểu | Quên `import 'maplibre-gl/dist/maplibre-gl.css'` |
| Bản đồ trống trơn ở bản build, dev server vẫn tốt | Chưa copy hai file worker của MapLibre vào `public/` và chưa gọi `setWorkerUrl` — xem mục 1 |

Các ví dụ dùng endpoint nội bộ hiện tại `api.ai-solutions.io.vn` — **tạm thời** trong giai đoạn nội
bộ, sẽ đổi khi MapsLibVN có tên miền riêng.

Đọc thêm: [Bản đồ web](/ban-do-web/), [Tìm kiếm & autocomplete](/tim-kiem/),
[React Native](/react-native/), [SDK JavaScript](/sdk/).
