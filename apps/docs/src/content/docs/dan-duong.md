---
title: "Dẫn đường từng bước trên web"
description: "Dẫn đường từng bước trên web với MapsLibVN: vẽ tuyến từ /v1/directions, bám GPS, đọc câu rẽ bằng giọng tiếng Việt và tự tính lại tuyến khi người dùng đi lệch."
---

Trang này dành cho web (`@mapslibvn/web` và `@mapslibvn/react`). Bạn đã có tuyến từ
[`client.directions()`](/api/#get-v1directions); phần còn lại chạy **trên thiết bị**: bám vị trí GPS vào
tuyến, biết đang ở bước nào, đọc câu rẽ đúng lúc, phát hiện lệch và tự gọi lại `directions()`.
Máy chủ chỉ tốn tài nguyên lúc tính tuyến.

## 1. Ba bước

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import { createMap } from '@mapslibvn/web';

const map = createMap(
  { container: 'map', apiKey: 'mlv_live_…', apiBase: 'https://api.ai-solutions.io.vn' },
  { maplibre: maplibregl },
);

// 1. Tính tuyến (tham số [lat, lng]; response dùng [lng, lat])
const response = await map.places.directions({
  from: [10.7798, 106.699],
  to: [10.7725, 106.698],
  mode: 'motorbike',
});

// 2. Vẽ tuyến (tuyến chính, tuyến thay thế nếu có, marker đích)
map.routes.show(response);
map.fitBounds(response.routes[0].bbox, 60);

// 3. Dẫn đường — gọi trong sự kiện bấm nút để trình duyệt cho phép GPS và âm thanh
startButton.onclick = () => map.navigation.start({ response });
```

`start()` mở `navigator.geolocation.watchPosition`, bám mỗi điểm GPS vào tuyến, xoay camera theo hướng
đi, đọc câu chỉ dẫn bằng `speechSynthesis` giọng tiếng Việt và tự tính lại tuyến khi bạn lệch. Gọi
`map.navigation.stop()` để dừng; tuyến vẫn trên bản đồ cho tới khi `map.routes.clear()`.

Muốn thử ngay không cần code: mở [Playground](/playground?tab=dan-duong) → bấm "Dẫn đường".

## 2. Vẽ UI từ sự kiện

SDK không có bảng chỉ dẫn sẵn. Nghe `progress` và vẽ theo ý bạn:

```ts
import { formatDistanceShort } from '@mapslibvn/web';

map.navigation.on('progress', (p) => {
  const next = p.nextStep ?? p.step;          // bước rẽ sắp tới
  icon.dataset.kind = next.kind;              // ManeuverKind → icon của bạn
  instruction.textContent = next.instruction; // "Rẽ phải vào Nguyễn Du."
  distance.textContent = formatDistanceShort(p.distanceToStep_m); // "190 m"
  eta.textContent = `${Math.round(p.remaining_s / 60)} phút · ${formatDistanceShort(p.remaining_m)}`;
});
map.navigation.on('arrive', () => banner.textContent = 'Đã đến nơi');
map.navigation.on('offRoute', () => banner.textContent = 'Lệch tuyến, đang tính lại…');
map.navigation.on('positionError', (e) => {
  if (e.code === 'denied') banner.textContent = 'Bạn chưa cho phép truy cập vị trí';
});
```

| Sự kiện | Payload | Khi nào |
|---|---|---|
| `status` | `{ status, previous }` | `idle → navigating → off_route → rerouting → navigating → arrived` |
| `progress` | `NavigationProgress` | mỗi điểm GPS hợp lệ (≈ 1 lần/giây) |
| `step` | `{ stepIndex, step }` | vừa qua một điểm rẽ |
| `waypoint` | `{ legIndex, waypoint }` | qua một điểm dừng `via` |
| `announce` | `{ text, kind, stepIndex, priority }` | có câu cần đọc — SDK đã đọc nếu `voice` bật; dùng để hiện phụ đề |
| `offRoute` | `{ distance_m, fix }` | lệch tuyến đã xác nhận (3 điểm GPS liên tiếp và ≥ 5 giây) |
| `reroute` | `{ reason, response }` | có tuyến mới; SDK đã vẽ lại |
| `rerouteFailed` | `{ error, attempts, final }` | gọi lại thất bại; `final = true` sau 3 lần, SDK ngừng tự gọi |
| `arrive` | `{ waypoint, fix }` | trong bán kính đến nơi |
| `followChange` | `boolean` | người dùng kéo bản đồ (tắt bám) hoặc `recenter()` |
| `positionError` | `{ code: 'denied' \| 'unavailable' \| 'timeout', message }` | lỗi Geolocation |
| `voiceUnavailable` | — | máy không có giọng đọc cho ngôn ngữ đã chọn |

`NavigationProgress` có: `status`, `route`, `legIndex`, `stepIndex`, `step`, `nextStep`, `snapped`
(`[lng, lat]` đã bám), `bearing`, `traveled_m`, `remaining_m`, `remaining_s`, `distanceToStep_m`,
`offRoute_m`, `fix`.

## 3. Tuỳ chọn `start()`

| Tuỳ chọn | Mặc định | Ghi chú |
|---|---|---|
| `response` | bắt buộc | `DirectionsResponse` |
| `routeIndex` | `0` | tuyến thay thế nếu `alternatives: true` |
| `provider` | `map.places` | ai tính lại tuyến; bất kỳ object có `directions(opts)` |
| `reroute` | `'auto'` | `'manual'`: chỉ phát `offRoute`, bạn tự gọi `map.navigation.reroute()` hoặc `start()` lại |
| `lang` | `lang` của bản đồ | `'vi'` \| `'en'` — giọng đọc và câu "Trong X nữa" |
| `voice` | `true` | `false` tắt; `{ rate, volume }` chỉnh giọng |
| `follow` | `true` | `false` không đụng camera; `{ zoom, pitch, padding }` chỉnh (mặc định zoom 17 / 16,5 / 15,5 cho đi bộ / xe máy / ô tô, pitch 45) |
| `source` | GPS trình duyệt | nguồn vị trí khác — xem giả lập bên dưới |
| `thresholds` | theo phương tiện | ghi đè từng ngưỡng |
| `wakeLock` | `true` | giữ màn hình sáng khi trình duyệt hỗ trợ |

Ngưỡng mặc định theo phương tiện:

| | đi bộ | xe máy | ô tô |
|---|---|---|---|
| Lệch tuyến (m, tối thiểu; thực tế = max với 1,5 × sai số GPS) | 25 | 40 | 50 |
| Đọc "Trong X nữa, …" khi còn (m) | 40 | 200 | 400 |
| Đọc câu rẽ khi còn (m) | 15 | 50 | 80 |
| Bán kính đến nơi (m) | 15 | 25 | 30 |
| Bỏ điểm GPS có sai số hơn (m) | 60 | 100 | 100 |

Tính lại tuyến gọi `directions()` và **tính vào quota Chỉ đường** của khoá; SDK cách hai lần gọi ít
nhất 15 giây và dừng sau 3 lần lỗi liên tiếp.

## 4. Thử không cần ra đường

```ts
import { playbackSource, simulateFixes } from '@mapslibvn/web';

const route = response.routes[0];
map.navigation.start({
  response,
  voice: false,
  source: playbackSource(simulateFixes(route, { jitter_m: 4 }), { rate: 10 }), // nhanh gấp 10
});
```

`simulateFixes` đi dọc tuyến với vận tốc theo phương tiện; `jitter_m` thêm nhiễu GPS. Muốn thử lệch
tuyến, dịch toạ độ một đoạn fix rồi truyền vào `playbackSource`. [Playground → Dẫn đường](/playground?tab=dan-duong)
có nút Giả lập làm đúng việc này.

## 5. Dùng logic không cần bản đồ

Máy trạng thái nằm trong `@mapslibvn/core`, không cần MapLibre hay DOM:

```ts
import { createNavigator, createClient } from '@mapslibvn/core';

const client = createClient({ apiKey, baseUrl });
const nav = createNavigator({ response, provider: client });
nav.on('announce', (a) => console.log(a.text));
nav.update({ lng: 106.699, lat: 10.7798, accuracy_m: 8, heading: 160, speed_mps: 4, timestamp: Date.now() });
```

Đây cũng là phần React Native dùng lại (xem [Dẫn đường trên React Native](/dan-duong-react-native/)).

## 6. React

```tsx
import { useNavigation } from '@mapslibvn/react';

function Panel({ response }) {
  const { status, progress, start, stop } = useNavigation();
  return status === 'idle'
    ? <button onClick={() => start({ response })}>Bắt đầu</button>
    : <div>{progress?.nextStep?.instruction} <button onClick={stop}>Dừng</button></div>;
}
```

Hook phải nằm trong `<MapsLibVNMap>`. Xem [React](/react/) mục 6.

## 7. Tối ưu thứ tự điểm dừng

Chuyến có nhiều điểm giao thì gọi `optimizedRoute()` thay cho `directions()`. Response là
`DirectionsResponse` cộng `order`, nên phần vẽ và dẫn đường **không đổi một dòng**:

```ts
const response = await map.places.optimizedRoute({
  from: [10.7798, 106.699],
  stops: [
    [10.7716, 106.7043],
    [10.7769, 106.7032],
    [10.7686, 106.7069],
  ],
  // bỏ `to` = quay về `from`
});
map.routes.show(response);
map.fitBounds(response.routes[0].bbox, 60);

// Đánh số điểm ghé theo thứ tự nên đi: waypoints[k + 1] là điểm ghé thứ k (waypoints[0] là from).
// MarkerOptions của @mapslibvn/web nhận lng/lat rời và popupText, không có nhãn chữ trên ghim.
response.order.forEach((stopIndex, k) => {
  const [lng, lat] = response.waypoints[k + 1].location;
  map.addMarker({ lng, lat, popupText: `Điểm ghé ${k + 1} (đơn số ${stopIndex + 1})` });
});

startButton.onclick = () => map.navigation.start({ response });
```

Tối đa 10 điểm dừng, tính một lượt Chỉ đường, nhịp riêng 6 request/phút cho mỗi khoá. Điểm kết thúc phải cố định (`to`, hoặc quay về
`from`); chưa có "kết thúc ở đâu cũng được". Chi tiết ở
[REST API — optimized-route](/api/#get-v1optimized-route).

## 8. Giới hạn trình duyệt cần biết

- **Cần HTTPS** (hoặc `localhost`) để có Geolocation.
- **Không dẫn đường nền trên web.** iOS và Android tạm dừng `watchPosition` khi tắt màn hình hoặc
  chuyển app; SDK chỉ giữ màn hình sáng bằng Wake Lock khi có. Dẫn đường nền có ở SDK React Native:
  [Dẫn đường trên React Native](/dan-duong-react-native/).
- **Giọng tiếng Việt tuỳ máy.** Safari/iOS có sẵn; Chrome máy tính có khi cần mạng; Android tuỳ gói
  TTS đã cài. Không có → sự kiện `voiceUnavailable`, chữ vẫn hiện. Gọi `start()` trong sự kiện bấm
  nút để iOS cho phép phát âm.
- **GPS phố hẹp nhiễu** 20–50 m là bình thường; ngưỡng lệch đã tính theo sai số GPS. Đứng yên thì
  hướng mũi tên lấy theo tuyến, không theo la bàn — SDK React Native có la bàn + gyro, xem
  [Dẫn đường trên React Native](/dan-duong-react-native/) mục 10.
- Toạ độ bạn gửi khi tính lại tuyến nằm trong URL request như mọi lượt `directions()` — xem
  [Điều khoản tenant](/dieu-khoan/) mục 5.

Đọc thêm: [REST API — directions](/api/#get-v1directions), [SDK JavaScript](/sdk/).
