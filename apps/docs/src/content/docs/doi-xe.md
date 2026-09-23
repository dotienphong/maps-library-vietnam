---
title: Giao hàng & đội xe
description: Chọn tài xế gần nhất bằng ma trận khoảng cách, sắp thứ tự giao cho một chuyến, vẽ tuyến và dẫn đường — trên web và React Native.
---

Hai endpoint cho bài toán giao hàng, gọi xe, kỹ thuật viên đi hiện trường:

| Bạn cần | Dùng | Trả về |
|---|---|---|
| Ai gần nhất? Kho nào gần đơn nhất? Xếp hạng theo thời gian đi thật | [`client.matrix()`](/api/#get-v1matrix) | Bảng thời gian và quãng đường N điểm đi × M điểm đến, **không có tuyến** |
| Một xe ghé nhiều điểm, đi theo thứ tự nào cho nhanh nhất? | [`client.optimizedRoute()`](/api/#get-v1optimized-route) | Thứ tự ghé tối ưu **kèm tuyến đầy đủ** để vẽ và dẫn đường |

Cả hai tính theo mạng đường OpenStreetMap thật cho xe máy, ô tô, đi bộ, **không** phải đường chim
bay. Mỗi request tính **một lượt** Chỉ đường, dù ma trận có 4 hay 50 cặp.

Muốn thử ngay không cần code: mở [Playground → Đội xe](/playground#doi-xe), bấm "Nạp mẫu Quận 1"
rồi bấm "Tối ưu" hoặc "Tính ma trận".

## 1. Chọn tài xế gần nhất

Đơn mới vào, bạn có vị trí của 5 tài xế đang rảnh. Gọi ma trận 5 × 1 rồi chọn ô nhỏ nhất:

```ts
import { createClient } from '@mapslibvn/core';

const client = createClient({ apiKey: 'mlv_live_…', baseUrl: 'https://api.ai-solutions.io.vn' });

const drivers = [
  { id: 'tx-01', at: [10.7798, 106.699] },
  { id: 'tx-02', at: [10.7826, 106.6958] },
  { id: 'tx-03', at: [10.7686, 106.7069] },
  // …
];
const order = [10.7725, 106.698]; // [lat, lng] điểm lấy hàng

const m = await client.matrix({
  sources: drivers.map((d) => d.at),
  targets: [order],
  mode: 'motorbike',
});

// durations_s[i][0] = giây từ tài xế i tới đơn; null = không có đường (bỏ qua)
const ranked = drivers
  .map((d, i) => ({ ...d, seconds: m.durations_s[i][0], meters: m.distances_m[i][0] }))
  .filter((d) => d.seconds !== null)
  .sort((a, b) => a.seconds - b.seconds);

console.log(`Giao cho ${ranked[0].id}: ${Math.round(ranked[0].seconds / 60)} phút`);
```

Cùng mẫu này dùng cho "kho nào gần khách nhất" (kho là `sources`, khách là `targets`) hay "hiện
5 cửa hàng gần nhất kèm số phút". Tham số vào là `[lat, lng]`; toạ độ trong response là `[lng, lat]`.

## 2. Sắp thứ tự giao cho một chuyến

Shipper nhận 6 đơn buổi sáng, xuất phát từ kho và quay về kho:

```ts
const warehouse = [10.7725, 106.698];
const stops = [
  [10.7826, 106.6958],
  [10.7686, 106.7069],
  [10.777, 106.6953],
  [10.7716, 106.7043],
  [10.7798, 106.699],
];

const trip = await client.optimizedRoute({
  from: warehouse,
  stops,
  // to: [lat, lng],  // bỏ trống = quay về `from`; có `to` thì kết thúc cố định ở đó
  mode: 'motorbike',
});

// trip.order: chỉ số vào `stops` theo thứ tự nên ghé, ví dụ [3, 1, 4, 0, 2]
const visit = trip.order.map((i) => stops[i]);
const route = trip.routes[0];
console.log(`${(route.distance_m / 1000).toFixed(1)} km, ${Math.round(route.duration_s / 60)} phút`);

// Mỗi chặng: route.legs[k] đi tới điểm ghé thứ k; chặng cuối về kho (hoặc tới `to`)
route.legs.forEach((leg, k) => console.log(k, leg.distance_m, leg.duration_s));
```

Response có cùng dạng với [`/v1/directions`](/api/#get-v1directions), chỉ thêm `order`. Vì thế
vẽ tuyến và dẫn đường dùng đúng mã của [Dẫn đường](/dan-duong/):

```ts
map.routes.show(trip);
map.fitBounds(trip.routes[0].bbox, 60);
startButton.onclick = () => map.navigation.start({ response: trip });
```

Khi dẫn đường, SDK đọc câu "Đến nơi" ở từng điểm dừng rồi đi tiếp chặng sau. Nếu tài xế đi lệch,
SDK tự gọi lại `directions` qua các điểm còn lại **theo thứ tự đã tối ưu**, không sắp lại.
`/v1/directions` nhận tối đa 5 điểm via, nên với chuyến 6–8 điểm dừng, lệch tuyến khi còn hơn 5
điểm chưa ghé thì lần tính lại sẽ báo lỗi: SDK phát `rerouteFailed` và giữ tuyến cũ.

## 3. React Native

Không cần cài thêm gì: `@mapslibvn/react-native` đã có sẵn cả hai hàm qua `useMap().places`, và
`routes`/`navigation` nhận thẳng kết quả tối ưu.

```tsx
import { MapsLibVNMap, useMap } from '@mapslibvn/react-native';
import { Button } from 'react-native';

function OptimizeButton({ warehouse, stops }) {
  const map = useMap();
  return (
    <Button
      title="Sắp thứ tự giao"
      onPress={async () => {
        const trip = await map.places.optimizedRoute({ from: warehouse, stops, mode: 'motorbike' });
        map.routes.show(trip);
        map.fitBounds(trip.routes[0].bbox, 60);
        // map.navigation.start({ response: trip }) khi tài xế bấm "Bắt đầu"
      }}
    />
  );
}

export default function Screen() {
  return (
    <MapsLibVNMap apiKey="mlv_live_…" apiBase="https://api.ai-solutions.io.vn">
      <OptimizeButton warehouse={[10.7725, 106.698]} stops={[[10.7826, 106.6958], [10.7686, 106.7069]]} />
    </MapsLibVNMap>
  );
}
```

Ngoài `<MapsLibVNMap>` (ví dụ trong màn danh sách đơn), tạo client riêng bằng `createClient` như mục 1.
SDK không có sẵn giao diện danh sách đơn hay bảng ma trận vì mỗi app một kiểu: bạn tự vẽ từ
`order`, `legs`, `durations_s`.

## 4. Giới hạn

| | Trần mỗi request | Ghi chú |
|---|---|---|
| Ma trận | `sources × targets ≤ 50` cặp, **mỗi bên ≤ 25 điểm** | Ví dụ 7 × 7, 10 × 5, 25 × 2, 1 × 25 |
| Tối ưu thứ tự | **1–8 điểm dừng**, cộng `from` và `to` tuỳ chọn | Tối đa 10 điểm một chuyến (9 nếu quay về kho) |
| Nhịp | **6 request/phút/khoá**, gộp chung cả hai endpoint | Vượt → `429 rate_limit_exceeded`, header `retry-after` |
| Khoảng cách | Xe máy 200 km, ô tô 400 km, đi bộ 50 km (đường chim bay) | Mọi điểm trong Việt Nam |
| Hạn mức | **1 lượt** nhóm Chỉ đường mỗi request | Request sai tham số trả `400`, **không tính lượt** |

Kết quả được cache 60 giây theo đúng bộ toạ độ và phương tiện, nên gọi lại y hệt trong một phút sẽ
nhanh hơn. Hai con số trần là kết quả đo tải trên máy chủ hiện tại, không phải giới hạn của thuật
toán; cần cỡ lớn hơn thì [liên hệ](https://mapslibvn-site.pages.dev/lien-he/).

## 5. Khi cần vượt trần

**Ma trận lớn hơn 50 cặp:** chia `sources` thành lô rồi gọi tuần tự, cách nhau ít nhất 10 giây
để không chạm nhịp 6 request/phút:

```ts
import { MapsLibVNError } from '@mapslibvn/core';

async function bigMatrix(sources, targets, mode) {
  // targets ≤ 25; mỗi lô sources ≤ 25 và sources × targets ≤ 50
  const perBatch = Math.min(25, Math.max(1, Math.floor(50 / targets.length)));
  const rows = [];
  for (let i = 0; i < sources.length; i += perBatch) {
    const batch = sources.slice(i, i + perBatch);
    for (;;) {
      try {
        const m = await client.matrix({ sources: batch, targets, mode });
        rows.push(...m.durations_s);
        break;
      } catch (err) {
        if (!(err instanceof MapsLibVNError) || err.status !== 429) throw err;
        await new Promise((r) => setTimeout(r, (err.retryAfter ?? 10) * 1000));
      }
    }
    if (i + perBatch < sources.length) await new Promise((r) => setTimeout(r, 10_000));
  }
  return rows; // rows[i][j] = giây từ sources[i] tới targets[j]
}
```

**Chuyến có hơn 8 điểm dừng:** tách thành nhiều chuyến nhỏ theo khu vực (quận, phường, hoặc
nhóm theo hướng từ kho), mỗi chuyến tối đa 8 điểm, rồi tối ưu từng chuyến. Cách này cho kết quả
tốt trên thực tế nhưng **không đảm bảo** ngắn nhất toàn cục như một bộ giải chia đơn cho nhiều xe.

## 6. Chưa có

Nói thẳng để bạn quyết định sớm:

- **Tối ưu nhiều xe cùng lúc** (chia đơn cho cả đội) — chưa có; mỗi request là một xe.
- Sức chứa xe, khung giờ khách hẹn, thời gian dừng mỗi điểm — chưa có.
- Kết thúc ở một điểm bất kỳ do thuật toán chọn (open-end) — phải chỉ định `to` hoặc quay về `from`.
- Giao thông thời gian thực — thời gian tính trên hình học mạng đường và tốc độ theo loại đường.
- Theo dõi vị trí đội xe trên máy chủ — app của bạn tự gửi và lưu vị trí tài xế.

Nếu bài toán cần một trong số này ngay, xem
[so sánh với Google Maps API](https://mapslibvn-site.pages.dev/so-sanh/google-maps-api/).
