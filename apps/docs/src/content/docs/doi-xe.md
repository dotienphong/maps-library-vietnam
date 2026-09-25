---
title: "Tối ưu tuyến giao hàng và đội xe"
description: Chọn tài xế gần nhất bằng ma trận khoảng cách, sắp thứ tự giao cho một chuyến, chia đơn cho cả đội xe, vẽ tuyến và dẫn đường — trên web và React Native.
---

Ba endpoint cho bài toán giao hàng, gọi xe, kỹ thuật viên đi hiện trường:

| Bạn cần | Dùng | Trả về |
|---|---|---|
| Ai gần nhất? Kho nào gần đơn nhất? Xếp hạng theo thời gian đi thật | [`client.matrix()`](/api/#get-v1matrix) | Bảng thời gian và quãng đường N điểm đi × M điểm đến, **không có tuyến** |
| Một xe ghé nhiều điểm, đi theo thứ tự nào cho nhanh nhất? | [`client.optimizedRoute()`](/api/#get-v1optimized-route) | Thứ tự ghé tối ưu **kèm tuyến đầy đủ** để vẽ và dẫn đường |
| Nhiều xe: đơn nào giao xe nào, ghé theo thứ tự nào, mấy giờ tới? | [`client.fleetPlan()`](/api/#post-v1fleet-plan) | Đơn chia cho từng xe, thứ tự ghé, giờ đến ước tính, đơn không xếp được, **kèm tuyến đầy đủ của từng xe** |

Cả hai tính theo mạng đường OpenStreetMap thật cho xe máy, ô tô, đi bộ, **không** phải đường chim
bay. Mỗi request tính **một lượt** Chỉ đường, dù ma trận có 4 hay 50 cặp, hay đội xe có 1 hay 5 xe.

Muốn thử ngay không cần code: mở [Playground → Đội xe](/playground#doi-xe), bấm "Nạp mẫu Quận 1"
rồi bấm "Tối ưu", "Chia đơn" hoặc "Tính ma trận".

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
SDK tự gọi lại `directions` qua các điểm còn lại **theo thứ tự đã tối ưu**, không sắp lại —
`/v1/directions` nhận tới 10 điểm via, bằng trần điểm dừng, nên chuyến cỡ nào cũng tính lại được.

## 3. Chia đơn cho cả đội

Sáng có 12 đơn và 2 shipper cùng xuất phát từ kho. Gửi cả đội và cả lô đơn trong **một request**;
máy chủ tự chia đơn, sắp thứ tự ghé cho từng xe và trả **tuyến đầy đủ của từng xe**:

```ts
const depot: [number, number] = [10.7725, 106.698];
const shift: [string, string] = ['2026-09-24T08:00:00+07:00', '2026-09-24T12:00:00+07:00'];

const plan = await client.fleetPlan({
  mode: 'motorbike',
  vehicles: [
    { id: 'xe-1', start: depot, capacity: 20, time_window: shift },
    { id: 'xe-2', start: depot, capacity: 20, time_window: shift },
  ],
  jobs: orders.map((o) => ({
    id: o.code,
    location: o.latLng, // [lat, lng]
    demand: o.parcels, // khối lượng, cùng đơn vị với capacity
    service_s: 300, // dừng 5 phút mỗi điểm
    ...(o.slot ? { time_windows: [o.slot] } : {}), // ['2026-09-24T09:00:00+07:00', '2026-09-24T10:00:00+07:00']
  })),
});

for (const v of plan.vehicles) {
  console.log(v.vehicle, v.jobs); // ['don-7', 'don-2', …] theo thứ tự ghé; [] = xe nghỉ
  for (const s of v.stops) console.log(s.job, s.arrival_at, s.waiting_s); // giờ đến ước tính, giây chờ
}
console.log(plan.unassigned); // [{ id: 'don-9' }] — hết chỗ, quá sức chứa hoặc khung giờ không thoả

map.routes.showFleet(plan); // K xe K màu (FLEET_COLORS)
map.on('routeClick', ({ index }) => map.routes.setActive(index)); // bấm tuyến → làm mờ xe khác
```

Mỗi `plan.vehicles[k]` **là** một `DirectionsResponse` cộng `vehicle`, `jobs`, `stops`, `load`,
`finish_s`, nên app tài xế dùng đúng mã của [Dẫn đường](/dan-duong/):
`map.routes.show(plan.vehicles[k])` và `map.navigation.start({ response: plan.vehicles[k] })`.

Ba điều cần biết trước khi tin con số:

- **Hai chế độ thời gian.** Không có khung giờ nào thì `stops[].arrival_s` là giây kể từ lúc xe rời
  `start`. Có khung giờ thì **mọi xe** phải có `time_window` (giờ làm), mốc giờ viết ISO 8601 **kèm múi
  giờ** (`+07:00`), và response có thêm `departure_at`, `arrival_at`, `finish_at` cùng múi.
  `departure_at` là giờ xuất phát bộ giải chọn, có thể muộn hơn đầu ca để khỏi phải chờ khách.
- **Giờ đến tính trên ma trận, tuyến vẽ tính bằng chỉ đường.** Hai con số có thể lệch vài phần trăm;
  `stops` là lịch, `routes[0].legs` là tuyến.
- **`end` bỏ trống là về lại `start`, `end: 'open'` là kết thúc ở đơn cuối.** Sức chứa là tất cả hoặc
  không: một xe có `capacity` thì mọi xe phải có; `demand` mặc định 0. `max_jobs` (mặc định 10) giới hạn
  số đơn mỗi xe; `priority` 0–100 quyết định đơn nào được xếp trước khi không đủ chỗ.

Một điểm không tới được bằng mạng đường thì cả request trả `404 no_route`, thông điệp gọi tên đơn.
Soát hết điểm hỏng trước bằng `client.matrix({ sources: [depot], targets: jobs })`: ô `null` là điểm
cần sửa.

## 4. React Native

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

Chia đơn cho cả đội cũng chỉ là hai dòng: `const plan = await map.places.fleetPlan({ … })` rồi
`map.routes.showFleet(plan)`. Thêm `onRouteClick={(index) => map.routes.setActive(index)}` vào
`<MapsLibVNMap>` để bấm tuyến chọn xe; tài xế dẫn đường một xe bằng
`map.navigation.start({ response: plan.vehicles[k] })`.

Ngoài `<MapsLibVNMap>` (ví dụ trong màn danh sách đơn), tạo client riêng bằng `createClient` như mục 1.
SDK không có sẵn giao diện danh sách đơn hay bảng ma trận vì mỗi app một kiểu: bạn tự vẽ từ
`order`, `legs`, `durations_s`.

## 5. Giới hạn

| | Trần mỗi request | Ghi chú |
|---|---|---|
| Ma trận | `sources × targets ≤ 50` cặp, **mỗi bên ≤ 25 điểm** | Ví dụ 7 × 7, 10 × 5, 25 × 2, 1 × 25 |
| Tối ưu thứ tự | **1–10 điểm dừng**, cộng `from` và `to` tuỳ chọn | Tối đa 12 điểm một chuyến (11 nếu quay về kho) |
| Đội xe | **1–5 xe, 1–30 đơn, tối đa 10 đơn mỗi xe**; 1–3 khung giờ mỗi đơn, dừng tối đa 2 giờ | Sức chứa tất cả hoặc không; có khung giờ thì mọi xe cần `time_window`; body tối đa 64 KB |
| Nhịp | **6 request/phút/khoá** cho ma trận và tối ưu cộng chung; **2 request/phút/khoá** cho đội xe | Vượt → `429 rate_limit_exceeded`, header `retry-after` |
| Khoảng cách | Xe máy 200 km, ô tô 400 km, đi bộ 50 km (đường chim bay) | Mọi điểm trong Việt Nam; với đội xe là cặp điểm xa nhất |
| Hạn mức | **1 lượt** nhóm Chỉ đường mỗi request | Request sai tham số trả `400`, **không tính lượt** |

Kết quả được cache 60 giây theo đúng bộ toạ độ và phương tiện, nên gọi lại y hệt trong một phút sẽ
nhanh hơn. Hai con số trần là kết quả đo tải trên máy chủ hiện tại, không phải giới hạn của thuật
toán; cần cỡ lớn hơn thì [liên hệ](https://mapslibvn.pages.dev/lien-he/).

## 6. Khi cần vượt trần

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

**Hơn 10 đơn, hoặc nhiều xe:** dùng chia đơn ở mục 3. Tối đa 30 đơn và 5 xe một lượt; bộ giải nhìn
toàn cục nên tốt hơn tự chia theo khu vực. Hơn 30 đơn thì chia lô theo khu vực (quận, hoặc nhóm theo
hướng từ kho) rồi gọi nhiều lượt cách nhau 30 giây, đúng nhịp 2 request/phút.

## 7. Chưa có

Nói thẳng để bạn quyết định sớm:

- Giao thông thời gian thực — thời gian tính trên hình học mạng đường và tốc độ theo loại đường.
- Theo dõi vị trí đội xe trên máy chủ — app của bạn tự gửi và lưu vị trí tài xế.

Nếu bài toán cần một trong số này ngay, xem
[so sánh với Google Maps API](https://mapslibvn.pages.dev/so-sanh/google-maps-api/).
