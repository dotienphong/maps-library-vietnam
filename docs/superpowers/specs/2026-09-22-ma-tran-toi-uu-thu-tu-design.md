# MapsLibVN — Thiết kế ma trận khoảng cách và tối ưu thứ tự điểm dừng: `GET /v1/matrix`, `GET /v1/optimized-route`

- Ngày: 2026-09-22
- Trạng thái: **Đã phát hành 22/09/2026.** Nghiệm thu mục 13 đạt trừ bài đo đồng thời ở vòng nguội — xem `docs/evidence/routing/2026-09-22-matrix.md` và DEVLOG mục 33. Trần chốt ở 50 cặp / 8 điểm dừng cộng nhịp 6 request/phút, khác bản thiết kế ban đầu (100 / 10, không có nhịp riêng)
- Chủ dự án: PHONG
- Tài liệu do Fable 5.1 viết
- Spec gốc: spec dẫn đường A `docs/superpowers/specs/2026-09-10-dan-duong-engine-api-design.md` mục 1.3 ghi "ma trận ETA nhiều điểm" là ngoài phạm vi; spec này mở phạm vi đó. **Không** mở phạm vi tối ưu đội xe nhiều xe (VRP) — mục 12.

## 0. Tóm tắt một đoạn

Valhalla đang chạy trên máy chủ nội bộ đã bật sẵn hai action chưa dùng: `sources_to_targets` (ma trận
thời gian/quãng đường N×M) và `optimized_route` (sắp thứ tự ghé tối ưu cho **một** xe, điểm đầu và
điểm cuối cố định). Spec này thêm hai endpoint Worker `GET /v1/matrix` và `GET /v1/optimized-route`
theo đúng khuôn `/v1/directions`: cùng scope, cùng nhóm quota `directions` (**một request = một lượt
bất kể cỡ**), cùng rate limiter, cùng cache, cùng cách dịch sang schema riêng của MapsLibVN. Không thêm
dịch vụ trên máy chủ, không đổi sổ quota, catalog, cơ sở dữ liệu, admin hay console. Lớp bảo vệ máy chủ
(Valhalla production chạy **1 luồng**) là **trần cỡ chặt kiểm ở Worker** — tối đa 100 cặp mỗi ma trận,
tối đa 10 điểm dừng mỗi lần tối ưu — cộng một bài đo production **trước khi công bố** trong docs và
site. Gói core thêm `client.matrix()` và `client.optimizedRoute()`; response tối ưu thứ tự là
`DirectionsResponse` cộng mảng `order`, nên `map.routes.show()` vẽ được ngay. Trang Tính năng thêm mục
"Giao hàng & vận tải", bảng đối đầu Google/VIETMAP tách hàng cũ thành hai và `CHUA_CO` còn bốn mục.

## 1. Mục tiêu, phạm vi, quyết định

### 1.1 Mục tiêu

1. Tenant gọi một endpoint là có bảng thời gian và quãng đường giữa N điểm đi và M điểm đến, để chọn tài xế gần nhất, kho gần nhất, cửa hàng gần nhất.
2. Tenant gọi một endpoint là có thứ tự ghé tối ưu cho một chuyến giao nhiều điểm, kèm tuyến đầy đủ và bước rẽ tiếng Việt để vẽ và dẫn đường ngay.
3. Không tốn thêm chi phí vận hành: không dịch vụ mới, không migration, không đổi mô hình tính tiền.
4. Website và docs nói đúng cái đã có: bỏ "ma trận khoảng cách" và "tối ưu lộ trình đội xe" khỏi danh sách chưa có, nhưng vẫn nói rõ **chưa có đội xe nhiều xe**.

### 1.2 Ba tầng của cụm "ma trận và tối ưu đội xe" — spec này làm hai tầng đầu

| Tầng | Là gì | Engine | Spec này |
|---|---|---|---|
| 1. Ma trận khoảng cách | N điểm đi × M điểm đến → bảng thời gian + quãng đường, không có hình tuyến | Valhalla `sources_to_targets`, có sẵn | **Làm** |
| 2. Tối ưu thứ tự điểm dừng (TSP một xe) | Một xe, điểm đầu và cuối cố định, sắp thứ tự các điểm giữa | Valhalla `optimized_route`, có sẵn | **Làm** |
| 3. Tối ưu đội xe (VRP) | Nhiều xe, sức chứa, ca làm, khung giờ khách hẹn, kỹ năng; chia đơn cho xe và sắp thứ tự | Không có trong Valhalla; cần VROOM hoặc OR-Tools, tức một container mới | **Không làm.** PHONG quyết 22/09: để tới khi máy chủ mạnh hơn và có người dùng thật đòi |

### 1.3 Trong phạm vi

- Worker: `GET /v1/matrix`, `GET /v1/optimized-route`; module `routing/matrix.ts`, `routing/optimized.ts`; mở rộng `routing/valhalla.ts` và `routing/params.ts`; test unit và route; ca tích hợp trên fixture Quận 1; smoke production kèm bài đo đồng thời.
- Core: hai hàm client, bốn kiểu mới; `@mapslibvn/web` và `@mapslibvn/react-native` re-export kiểu.
- Docs: hai mục endpoint trong `api.md`; cập nhật `tinh-nang.md`, `sdk.md`, `dan-duong.md`, `khoa-api.md`, `tu-host.md`; một dòng trỏ chéo trong spec A.
- Site: mục "Giao hàng & vận tải" ở trang Tính năng, một thẻ bento ở trang chủ, bảng đối đầu và `CHUA_CO`, mô tả meta, trang so sánh VIETMAP.
- Evidence số đo production; DEVLOG; phát hành SDK bản minor kế tiếp.

### 1.4 Ngoài phạm vi (có chỗ trong kiến trúc, xem mục 12)

- Tối ưu đội xe nhiều xe, sức chứa, khung giờ, thời gian phục vụ tại điểm.
- Kết thúc ở điểm bất kỳ (open-end TSP): Valhalla chỉ tối ưu các điểm **giữa**, đầu và cuối cố định.
- Nhóm quota riêng, tính tiền theo cặp, add-on riêng.
- Tab ma trận trong Playground docs.
- Trả toạ độ đã bám (`snapped`) trong response ma trận; tính ma trận theo giờ khởi hành; ma trận có `date_time`.
- Thay đổi `valhalla.json` trên máy chủ (`service_limits`).

### 1.5 Quyết định đã chốt (PHONG, 22/09/2026)

| Quyết định | Chọn | Lý do ngắn |
|---|---|---|
| Phạm vi | Tầng 1 + tầng 2; tầng 3 để sau | Hai tầng đầu có sẵn trong Valhalla, không cần dịch vụ mới; tầng 3 cần container solver và spec riêng; chưa có người dùng thật đòi (95 % request 10 ngày qua là phép đo của chính mình) |
| Tính lượt | **Một request = một lượt nhóm `directions`**, bù bằng trần cỡ chặt | Không đụng sổ `QuotaObject` đang chạy tiền thật (hardcode `['places','directions']` ở bốn chỗ, `reserve()` chỉ trừ một lượt), không đụng catalog, migration, admin, console. Là điểm bán rõ ràng so với Google tính theo từng cặp. Nâng cách tính khi có khách thật (mục 12) |
| Loại khoá được gọi | Mọi loại khoá, kể cả `web`/`mobile` công khai. Giữ burst 20/phút/khoá+IP và trần 100/phút/khoá web-mobile của directions, **cộng thêm `MATRIX_RATE_LIMITER` 6/phút theo khoá thuần riêng cho hai endpoint này** (bổ sung 22/09 sau khi đo — xem mục 6.3) | App shipper trên điện thoại gọi thẳng được. Trần cỡ giới hạn một request; nhịp riêng giới hạn tải tổng lên engine 1 luồng của máy 2 nhân |
| Trình bày trên site | Mục riêng "Giao hàng & vận tải" ở trang Tính năng + thẻ bento mới ở trang chủ; bảng đối đầu tách hàng cũ thành hai | Mục tiêu PHONG nêu là thu hút người tìm giải pháp giao hàng; gộp vào Dẫn đường dễ bị bỏ sót |
| Cách làm kỹ thuật | Cách 1: hai endpoint **GET** riêng, mở rộng module `routing/` sẵn có | Ít mã nhất; cache, 405 HEAD, rate limit, analytics, khuôn docs "endpoint GET" đều có sẵn. POST JSON (cách 2) phá khuôn và đòi hash body cho cache; gộp vào `/v1/directions?optimize=1` (cách 3) chỉ giải quyết nửa việc |
| Ngữ nghĩa `to` của optimized-route | Tuỳ chọn; **bỏ trống = quay về `from`** (round trip) | Khớp cách Valhalla làm được; open-end ghi rõ chưa có |
| Tên endpoint và hàm | `/v1/matrix`, `/v1/optimized-route`; `client.matrix()`, `client.optimizedRoute()` | Khớp tên action Valhalla và thuật ngữ ngành |

## 2. Tiền đề kỹ thuật đã xác minh (22/09/2026)

Đo trên image `ghcr.io/valhalla/valhalla-scripted:3.8.3` cùng digest production, chạy tại máy dev trên graph fixture Quận 1 (`work/valhalla-dev`, compose dev profile `routing`):

- `/status` trả `available_actions` gồm `sources_to_targets` và `optimized_route`. Production dùng cùng image nên có cùng action; `/healthz/routing` hiện không trả trường này, việc xác nhận trên production là chính lượt smoke đầu tiên sau deploy (mục 10 bước 5).
- `service_limits` mặc định của image (`valhalla_build_config`), áp cho production vì `valhalla.json` do entrypoint tự sinh:

| Costing | `max_locations` (route, optimized_route) | `max_matrix_distance` | `max_matrix_location_pairs` |
|---|---|---|---|
| `auto` (ô tô) | 20 | 400 km | 2.500 |
| `motor_scooter` (xe máy) | 50 | 200 km | 2.500 |
| `pedestrian` (đi bộ) | 50 | 200 km | 2.500 |

  Trần Worker (mục 4.6) thấp hơn hẳn mọi số trên, nên Worker là lớp chặn và không cần sửa `valhalla.json`.
- Response `POST /sources_to_targets` (gửi `units: "kilometers"`): `sources_to_targets[i][j]` là object `{ from_index, to_index, time (giây), distance (km), begin_lat, begin_lon, end_lat, end_lon, begin_heading, end_heading }`; `sources`/`targets` là mảng **phẳng** `{ lat, lon }` với toạ độ **đã bám** vào đường (khác `/route`, vốn trả toạ độ gốc). Cặp không nối được (đã thấy với target Vũng Tàu nằm ngoài graph Quận 1 nhưng vẫn bám được vào một edge) → `time: null, distance: null`, HTTP vẫn 200, các ô khác đầy đủ.
- Cặp vượt `max_matrix_distance` → HTTP 400 `error_code 154` "Path distance exceeds the max distance limit" cho **cả request** (đã thấy với xe máy TP.HCM → Hà Nội, và ô tô 400 km).
- `POST /optimized_route` với `locations` kiểu `break`: trả `trip` cùng hình dạng `/route` (`legs[].shape` polyline6, `maneuvers`, `summary`), và `trip.locations[]` **theo thứ tự đi** kèm `original_index` là chỉ số trong request. Điểm đầu và cuối luôn giữ nguyên chỗ (`original_index` 0 và n−1). Round trip (điểm cuối trùng toạ độ điểm đầu) chạy bình thường, trả n−1 leg. Request 2 điểm (không có điểm giữa) cũng chạy. Một điểm dừng không nối được → HTTP 400 `error_code 442` cho cả request (đúng ca `no_route` sẵn có).
- **Máy chủ production (đo trên chính máy 22/09/2026): Ubuntu, `nproc` = 2 nhân, tổng RAM 3,7 GB (còn trống ~1 GB), Postgres 592 MB, Valhalla 343 MB lúc rảnh.** Bản đầu của spec này chép nhầm "15,6 GB RAM, đỉnh build 3,7 GB" từ `docs/evidence/routing/build-stats.txt` — file đó đo trên **MacBook** ngày 11/09, không phải máy chủ (bài học đã ghi: máy chủ production không ở MacBook). Mọi tính toán dung lượng trong spec này dựa trên **2 nhân / 3,7 GB**.
- Production: `server_threads = 1` (`VALHALLA_THREADS` mặc định). Thử `= 2` ngày 22/09 và **đã quay lại 1**: trên máy 2 nhân, hai luồng Valhalla chiếm cả hai nhân lúc bận, không còn nhân cho `cloudflared` (đường vào mọi request) và Postgres — p95 `/v1/directions` lúc rảnh tụt từ ~0,8 s xuống 1,7–3,9 s trong khi lúc bận không nhanh hơn. Số đo ở `docs/evidence/routing/2026-09-22-matrix.md`.
- p95 `/v1/directions` đo 11/09 là 280–480 ms, nhưng **không so trực tiếp được với hôm nay**: lúc đó tenant còn quota legacy (KV), nay là quota thương mại và `server-timing` cho thấy sổ DO tốn `reserve 166 ms + prepare 158 ms` mỗi request.
- Sổ quota `apps/api/src/billing/quota-object.ts`: `reserve(requestId, group, keyHash)` trừ đúng một lượt, `group` phải thuộc `['places','directions']` (kiểm ở bốn chỗ). `quotaMiddleware('directions', preflight)` dùng lại nguyên cho hai endpoint mới.
- `analyticsMiddleware` ghi `c.req.routePath` vào blob4 → hai route mới tự có mẫu `/v1/matrix`, `/v1/optimized-route`, không thêm cột.
- Gói core: `.size-limit.json` trần **16 kB gzip** cho barrel `dist/index.js`; barrel đã minify từ 17/09.
- Test tích hợp routing sẵn có: `scripts/routing-test.mjs` dựng compose dev + `wrangler dev`, chạy `apps/api/test-routing/*.rtest.mjs`; cờ `--capture` ghi JSON Valhalla thô vào `apps/api/test/fixtures/valhalla/`.

## 3. Kiến trúc

```
 SDK (web / RN / server của tenant) ──X-Api-Key──▶ Worker apps/api
                                                   GET /v1/matrix            GET /v1/optimized-route
                                                   ├─ requireAuth('places:read')  quotaMiddleware('directions', preflight)
                                                   ├─ parseMatrixParams / parseOptimizedParams  (đếm trước, parse sau; hộp VN; trần cỡ; chim bay)
                                                   ├─ cachedJson (tươi 60 s, stale 300 s; toạ độ làm tròn 4 chữ số)
                                                   ├─ routingFetch ROUTING_BASE/sources_to_targets | /optimized_route  (Access header, timeout 20 s)
                                                   └─ translateMatrix → MatrixResponse | translateOptimized → DirectionsResponse + order

 Máy chủ nội bộ (compose) — KHÔNG ĐỔI: valhalla:8002 đã phục vụ cả hai action trên graph hiện có
```

Nguyên tắc giữ từ spec A: SDK không bao giờ gọi thẳng Valhalla; schema trả về không lộ tên trường
Valhalla; mọi kiểm tra đầu vào chạy ở Worker trước khi tốn máy chủ nhà.

## 4. API Worker

### 4.1 `GET /v1/matrix`

Middleware: `requireAuth('places:read', { deferRevocation: true })`, `quotaMiddleware('directions', preflight)` với `preflight = parseMatrixParams` (request sai không tốn lượt — khuôn directions), `analyticsMiddleware` sẵn có.

| Tham số | Bắt buộc | Dạng | Ghi chú |
|---|---|---|---|
| `sources` | có | `lat,lng;lat,lng…` | 1–25 điểm đi |
| `targets` | có | `lat,lng;lat,lng…` | 1–25 điểm đến |
| `mode` | không | `motorbike` \| `car` \| `walk` | mặc định `motorbike` |

Kiểm tra ở Worker, **theo thứ tự này**:

1. Đếm phần tử bằng `split(';')` **trước** khi parse: `sources` và `targets` mỗi bên 1–25; `sources.length × targets.length ≤ 100`. Vượt → `400 invalid_request` nêu trần. Chuỗi hàng nghìn điểm bị từ chối ở bước đếm, không tốn CPU parse (khuôn `MAX_VIA` của directions).
2. Parse từng điểm bằng `parseLatLngPair`; lỗi → `400` nêu tên `sources[i]` / `targets[j]`.
3. `mode` thuộc `TRAVEL_MODES`.
4. Mọi điểm trong hộp Việt Nam mở rộng (lat 8–24, lng 102–110) → ngoài hộp `400` "Chỉ hỗ trợ trong Việt Nam".
5. Khoảng cách đường chim bay **lớn nhất** trên mọi cặp source–target ≤ trần theo `mode` (mục 4.6). Vượt → `400` nêu cặp vi phạm và trần, ví dụ "sources[2] → targets[5] cách 231 km, ma trận motorbike tối đa 200 km đường chim bay". Tối đa 100 phép haversine — rẻ.

Điểm trùng nhau (kể cả cùng một điểm ở cả hai bên) được phép; Valhalla trả `0`.

Body gửi Valhalla `POST {ROUTING_BASE}/sources_to_targets`:

```json
{
  "sources": [{ "lat": 10.7798, "lon": 106.699 }, …],
  "targets": [{ "lat": 10.8153, "lon": 106.6633 }, …],
  "costing": "motor_scooter" | "auto" | "pedestrian",
  "units": "kilometers",
  "id": "<request id của Worker>"
}
```

Không gửi `directions_options` (ma trận không có câu chỉ dẫn). Timeout **20 s**.

Response (schema MapsLibVN):

```json
{
  "mode": "motorbike",
  "sources": [[106.699, 10.7798], [106.698, 10.7725]],
  "targets": [[106.6633, 10.8153]],
  "durations_s": [[930], [1010]],
  "distances_m": [[7480], [8120]],
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "valhalla", "graph": "2026-09-15" }
}
```

Quy ước:

- `sources`/`targets` là toạ độ **người dùng gửi**, đổi sang `[lng, lat]` (GeoJSON) như mọi response dẫn đường; Worker **không** dùng toạ độ đã bám mà Valhalla trả (mục 1.4). Tham số vào vẫn `lat,lng`.
- `durations_s[i][j]` và `distances_m[i][j]` là từ `sources[i]` tới `targets[j]`; số nguyên (giây, mét; Valhalla trả km số thực → ×1000 làm tròn). Worker đặt ô theo `from_index`/`to_index` của từng object, không tin thứ tự mảng.
- Cặp không nối được: `null` ở **cả hai** bảng; request vẫn `200`. Worker coi `time`/`distance` là `null`, không phải số, hoặc âm đều là "không nối".
- Bảng phải đúng cỡ `sources.length × targets.length`; Valhalla trả thiếu ô hay sai `from_index`/`to_index` → `503 upstream_unavailable` "Dịch vụ chỉ đường trả dữ liệu không hợp lệ" (không trả bảng lệch).
- `engine.graph` lấy từ `graphBuiltAt()` dùng chung (mục 4.7); là thông tin chẩn đoán, không phải hợp đồng ổn định.

### 4.2 `GET /v1/optimized-route`

Middleware như 4.1, `preflight = parseOptimizedParams`.

| Tham số | Bắt buộc | Dạng | Ghi chú |
|---|---|---|---|
| `from` | có | `lat,lng` | điểm xuất phát, cố định ở đầu |
| `stops` | có | `lat,lng;…` | 1–10 điểm cần ghé, thứ tự tuỳ ý |
| `to` | không | `lat,lng` | điểm kết thúc, cố định ở cuối; **bỏ trống = quay về `from`** |
| `mode` | không | `motorbike` \| `car` \| `walk` | mặc định `motorbike` |
| `lang` | không | `vi` \| `en` | mặc định `vi`; câu rẽ đi qua bảng cụm từ tiếng Việt như directions |

Không có `alternatives` (Valhalla không tính tuyến thay thế cho nhiều điểm). `stops` một điểm vẫn hợp lệ (trả `order: [0]`) để client không phải rẽ nhánh theo số đơn.

Kiểm tra ở Worker, theo thứ tự: đếm `stops` trước khi parse (1–10) → parse `from`, `stops[i]`, `to` → `mode`, `lang` → hộp Việt Nam → khoảng cách chim bay **từ `from`** tới từng điểm của `stops` và tới `to` ≤ trần theo `mode` (mục 4.6); vượt → `400` nêu điểm và trần. Trùng toạ độ được phép, kể cả `to` trùng `from`.

Body gửi Valhalla `POST {ROUTING_BASE}/optimized_route`:

```json
{
  "locations": [
    { "lat": <from>, "lon": …, "type": "break" },
    { "lat": <stops[0]>, "lon": …, "type": "break" }, …,
    { "lat": <to hoặc from>, "lon": …, "type": "break" }
  ],
  "costing": "motor_scooter" | "auto" | "pedestrian",
  "directions_options": { "language": "vi-VN" | "en-US", "units": "kilometers" },
  "id": "<request id của Worker>"
}
```

Thứ tự `locations` gửi đi: `from`, các `stops` theo thứ tự đầu vào, rồi `to` (hoặc `from` lần nữa). Vì vậy `stops[i]` có `original_index = i + 1`. Timeout **20 s**.

Response = **`DirectionsResponse`** (đúng schema `/v1/directions`: `routes[0]` với `legs`/`steps`/`geometry`, `waypoints` theo thứ tự đi, `attribution`, `engine`) **cộng** một trường:

```json
"order": [2, 0, 1]
```

- `order[k]` là chỉ số vào mảng `stops` đầu vào của điểm ghé thứ k. Worker dựng từ `trip.locations[1 … n−2]`: `original_index − 1`. Ví dụ trên: đi `from` → `stops[2]` → `stops[0]` → `stops[1]` → `to`.
- Worker kiểm `order` là hoán vị đủ của `0 … stops.length−1`, và `trip.locations[0].original_index === 0`, `trip.locations[n−1].original_index === n−1`; sai → `503` "dữ liệu không hợp lệ".
- `routes` luôn đúng một phần tử; `routes[0].legs.length === stops.length + 1`. `waypoints.length === stops.length + 2`, phần tử đầu là `from`, cuối là `to` (hoặc `from`).
- Phần dịch tuyến dùng lại **nguyên** `translateTrip`, `mergeLegShapes`, `translateWaypoints`, `applyViPhrases` — không chép mã.

Kiểu core: `OptimizedRouteResponse extends DirectionsResponse { order: number[] }`, nên `map.routes.show(response)` và `createNavigator` nhận được ngay.

### 4.3 Lỗi

| Tình huống | HTTP | `code` | Ghi chú |
|---|---|---|---|
| Thiếu/sai tham số, quá cỡ, ngoài hộp VN, vượt chim bay | 400 | `invalid_request` | message nói rõ trần và phần tử vi phạm; bắt ở `preflight` nên **không tốn lượt** |
| Valhalla 400 `error_code` 442/441 (không có đường), 170/171 (vùng không kết nối, điểm quá xa mạng đường) | 404 | `no_route` | Với optimized-route: một điểm dừng không tới được là đủ để cả chuyến lỗi. Với matrix: **chỉ** xảy ra khi một điểm không bám được vào đường nào (171); cặp không nối được trong graph **không** phải lỗi mà là `null` trong bảng (mục 4.1) |
| Valhalla 400 khác (154 vượt trần khoảng cách của engine, v.v.) | 400 | `invalid_request` | Không nên xảy ra vì Worker chặn trước bằng cùng trần; nếu xảy ra, `mapValhallaError` sẵn có ghi mã Valhalla trong message |
| Valhalla không trả lời, timeout 20 s, body không phải JSON, bảng sai cỡ, `order` không phải hoán vị, HTTP khác 400 (302 Access, 401/403, 5xx), đang build graph, chưa cấu hình `ROUTING_BASE` | 503 | `upstream_unavailable` | `retry-after: 30` sẵn có; bản cache stale trong 5 phút vẫn được trả |
| Quota / burst / trần khoá | 429 | `quota_exceeded` / `rate_limit_exceeded` / `concurrency_limit` … | cơ chế sẵn có, không đổi |
| HEAD | 405 | — | `quotaMiddleware` sẵn có trả `Allow: GET` |

Không thêm mã lỗi mới vào `errors.ts`. Bảng lỗi `api.md` mục 2 chỉ sửa dòng `no_route` để nhắc hai endpoint mới.

### 4.4 Cache

`cachedJson()` sẵn có, tươi **60 s**, stale **300 s** như directions. Khoá cache:

- `https://cache.mapslibvn/matrix?v=1&s=<sources>&t=<targets>&m=<mode>`
- `https://cache.mapslibvn/optimized-route?v=1&f=<from>&s=<stops>&t=<to>&m=<mode>&l=<lang>`

Toạ độ trong khoá làm tròn **4 chữ số** (~11 m). Bài học đo 20/09/2026 với cache directions: làm tròn 5 chữ số (1,1 m) nên không bao giờ trúng; gom 11 m lệch quãng đường 0,19 %, chấp nhận được; từ 56 m trở lên mới ra tuyến khác hẳn. **Chỉ khoá cache làm tròn**; toạ độ gửi Valhalla giữ nguyên. Chuỗi khoá ~2,5 kB với 100 điểm, không cần hash. Không đụng khoá cache của directions trong spec này (giữ 5 chữ số; đổi là việc riêng).

### 4.5 Quota, burst, đo lường — không đổi mã

- `quotaMiddleware('directions', preflight)`: tenant thương mại → `QuotaObject.reserve(…, 'directions')` một lượt; tenant legacy → KV `quota:<keyHash>:<ngày VN>:directions` cộng 1; tenant `internal` không đếm. Receipt/ACK như mọi endpoint thương mại.
- Burst `DIRECTIONS_RATE_LIMITER` 20 request/phút/khoá+IP và trần `DIRECTIONS_KEY_RATE_LIMITER` 100 request/phút cho khoá `web`/`mobile` áp cho **cả ba** endpoint cộng lại (cùng bộ đếm). Hệ quả cho smoke: mọi bài đo trên một khoá+IP phải giữ tổng request ≤ 20/phút.
- Analytics: `routePath` tự ghi; báo cáo tuần đọc pathname nên hai endpoint mới tự xuất hiện.
- Console và Admin hiển thị nhóm "Chỉ đường" như cũ; docs nói rõ nhóm này gồm cả ma trận và tối ưu thứ tự.

### 4.6 Hằng số (export từ module để test và docs cùng một nguồn)

| Hằng số | Giá trị | Nơi | Ghi chú |
|---|---|---|---|
| `MATRIX_MAX_SOURCES`, `MATRIX_MAX_TARGETS` | 25, 25 | `routing/matrix.ts` | ngang trần một request Distance Matrix của Google |
| `MATRIX_MAX_PAIRS` | 100 | `routing/matrix.ts` | ngang trần element/request của Google; bằng 4 % trần 2.500 của Valhalla |
| `OPTIMIZED_MAX_STOPS` | 10 | `routing/optimized.ts` | 12 điểm kể cả `from`/`to`, dưới `max_locations = 20` của `auto` |
| `MATRIX_MAX_CROW_DISTANCE_M` | motorbike 200 000, car 400 000, walk 50 000 | `routing/params.ts` | motorbike/car = `max_matrix_distance` của Valhalla; walk giữ 50 km cho khớp directions. Dùng cho **cả hai** endpoint |
| `MATRIX_TIMEOUT_MS` | 20 000 | `routing/valhalla.ts` | dưới `COMMERCIAL_HANDLER_TIMEOUT_MS = 30 000`; directions giữ 10 000 |
| Cache | tươi 60 s, stale 300 s, làm tròn 4 chữ số | `routing/matrix.ts`, `routing/optimized.ts` | |

Các số cỡ là **chốt tạm** cho bản đầu; mục 6 quy định cách hạ nếu số đo production không đạt. Đổi hằng số là một commit + deploy, không đổi hợp đồng API (docs in trần từ cùng nguồn qua ví dụ, plan phải cập nhật docs cùng lúc).

### 4.7 Cấu trúc mã (`apps/api/src`)

| File | Việc |
|---|---|
| `routing/matrix.ts` (mới) | `MatrixParams`, `parseMatrixParams()`, `matrixBody()`, `translateMatrix()`, `matrixCacheUrl()`, hằng số 4.6 |
| `routing/optimized.ts` (mới) | `OptimizedParams`, `parseOptimizedParams()`, `optimizedBody()`, `translateOptimized()` (dựng `order` + gọi `translateTrip`/`translateWaypoints`), `optimizedCacheUrl()`, hằng số |
| `routes/matrix.ts`, `routes/optimized.ts` (mới) | Handler Hono theo khuôn `routes/directions.ts` |
| `routing/valhalla.ts` | `routingFetch` mở path union `'/route' \| '/status' \| '/sources_to_targets' \| '/optimized_route'`; `callValhalla<T>(env, path, body, options)` nhận path và kiểu trả về — **đổi chữ ký**, cập nhật chỗ gọi duy nhất trong `routes/directions.ts` và test, không giữ overload cũ; thêm `ValhallaMatrixResponse`, `ValhallaMatrixCell`; `ValhallaTrip.locations[]` thêm `original_index?: number`; thêm `MATRIX_TIMEOUT_MS` |
| `routing/params.ts` | Tách `parseLatLngList(raw, name, max)` (đếm trước, parse sau) và `assertInVietnam(points)` thành hàm dùng chung; `MAX_VIA`, `MAX_CROW_DISTANCE_M`, `parseDirectionsParams` **không đổi hành vi** |
| `index.ts` | `app.route('/', matrix)`, `app.route('/', optimized)` |
| `routing/graph.ts` (mới) | `graphBuiltAt(c)` và `STATUS_CACHE_URL` chuyển từ `routes/directions.ts` sang đây để ba route dùng chung; `routing/valhalla.ts` vẫn thuần fetch, không import `cache.ts` |
| `routes/directions.ts` | Chỉ import `graphBuiltAt` từ `routing/graph.ts`; không đổi hành vi |

## 5. Gói core (`packages/core`) và re-export

`types.ts` thêm:

```ts
export interface MatrixResponse {
  mode: TravelMode;
  /** [lng, lat] — toạ độ bạn gửi, theo thứ tự gửi. */
  sources: [number, number][];
  targets: [number, number][];
  /** durations_s[i][j]: giây từ sources[i] tới targets[j]; null khi không nối được. */
  durations_s: (number | null)[][];
  /** distances_m[i][j]: mét; null cùng ô với durations_s. */
  distances_m: (number | null)[][];
  attribution: string;
  engine?: { name: string; graph: string | null };
}

export interface OptimizedRouteResponse extends DirectionsResponse {
  /** Chỉ số vào mảng `stops` bạn gửi, theo thứ tự nên đi. waypoints và legs đã xếp theo thứ tự này. */
  order: number[];
}
```

`client.ts` thêm:

```ts
export interface MatrixOptions {
  /** Mỗi điểm [lat, lng]; 1–25 điểm mỗi bên, tối đa 100 cặp. */
  sources: [number, number][];
  targets: [number, number][];
  mode?: TravelMode;
}
export interface OptimizedRouteOptions {
  from: [number, number];
  /** 1–10 điểm [lat, lng], thứ tự tuỳ ý. */
  stops: [number, number][];
  /** Bỏ trống = quay về `from`. */
  to?: [number, number];
  mode?: TravelMode;
  lang?: DirectionsLang;
}
// trong createClient():
matrix: (opts: MatrixOptions) =>
  get<MatrixResponse>('/v1/matrix', { sources: opts.sources.map(latLng).join(';'), targets: …, mode: opts.mode }),
optimizedRoute: (opts: OptimizedRouteOptions) =>
  get<OptimizedRouteResponse>('/v1/optimized-route', { from: latLng(opts.from), stops: …, to: opts.to && latLng(opts.to), mode: opts.mode, lang: opts.lang }),
```

Quy ước giữ từ spec A: tham số vào `[lat, lng]`, response `[lng, lat]`. `index.ts` export bốn kiểu mới. `packages/web/src/index.ts` và `packages/react-native/src/index.ts` thêm bốn kiểu vào khối `export type { … } from '@mapslibvn/core'` cạnh `DirectionsOptions`/`DirectionsResponse`. Không thêm hàm UI: `map.routes.show()` và `createNavigator()` nhận `OptimizedRouteResponse` vì nó là `DirectionsResponse`. Không chạm `@mapslibvn/react`, `@mapslibvn/ui`, `@mapslibvn/catalog`.

Phát hành: bản **minor** kế tiếp của bốn gói SDK qua `pnpm sdk:publish` (thêm API, không phá). Không ghi số phiên bản cứng vào docs (bài học đã ghi memory).

Trần `size-limit` 16 kB gzip: hai hàm client mới cỡ vài trăm byte; nếu build báo vượt, nâng trần trong `.size-limit.json` cùng commit và ghi số cũ/mới vào DEVLOG.

## 6. Bảo vệ máy chủ: đo trước khi công bố

Chưa có số đo nào cho hai action mới trên graph Việt Nam, và Valhalla production chạy một luồng. Vì vậy endpoint được **deploy trước, công bố sau** (mục 10): giữa hai bước là bài đo dưới đây.

### 6.1 Bài đo — `scripts/smoke-matrix.mjs` (`pnpm smoke:matrix -- --confirm-production`)

Theo khuôn `smoke-directions.mjs` (HTTPS bắt buộc, `--confirm-production`, khoá từ `MAPSLIBVN_API_KEY`, in bảng và p95, `--p95-max` chốt sau lần đo đầu). Toạ độ cố định trong nội thành TP.HCM, mọi điểm nằm trên đường công cộng (bài học "VĐ. bảo vệ sân bay" 11/09: toạ độ sân bay bám vào đường nội bộ khu bay).

| Bài | Nội dung | Số lượt |
|---|---|---|
| A. Ma trận 10×10 | 100 cặp, `motorbike` | 20, cách 3,5 s |
| B. Ma trận 25×4 | 100 cặp dạng dẹt, `car` | 20, cách 3,5 s |
| C. TSP 12 điểm | `from` + 10 `stops` + `to`, `motorbike`, `lang=vi` | 20, cách 3,5 s |
| D. Đồng thời | 3 vòng; mỗi vòng: đo 5 lượt `/v1/directions` lúc rảnh → bắn 5 ma trận 10×10 **song song** và trong lúc đó bắn 5 lượt directions xen kẽ → nghỉ hết phút. Tổng ≤ 15 request/phút/khoá để không tự gây 429 (mục 4.5) | 3 vòng |

Bài D là bài quan trọng hơn: bài học đo 20/09 ghi trần per-tenant **không** bảo vệ origin; câu hỏi là năm ma trận cùng lúc có làm directions của khách khác nhảy từ 400 ms lên vài giây hay không.

Kết quả ghi `docs/evidence/routing/2026-09-<ngày>-matrix.md`: bảng p95 từng bài, p95 directions rảnh/bận/sau, số lỗi, mã lỗi, phiên bản Worker và `graph_built_at`.

### 6.2 Ngưỡng nghiệm thu

- p95 bài A, B, C mỗi bài **< 3.000 ms**.
- p95 directions **trong lúc** năm ma trận chạy: ≤ **2 ×** p95 lúc rảnh **VÀ** dưới **2.000 ms tuyệt đối**.
  Hai điều kiện, không phải một. Bản đầu chỉ có tỷ lệ và nó **đã bị qua mặt** ngày 22/09: đặt
  `VALHALLA_THREADS=2` làm p95 lúc rảnh xấu đi (0,8 s → 3,9 s) nên tỷ lệ tụt từ 5,3× xuống 1,4× trong
  khi `busy_p95` gần như không đổi (5.287 → 5.493 ms). Một ngưỡng tương đối tự nó luôn thoả được bằng
  cách làm mẫu số tệ đi.
- 0 lỗi 5xx; không có 429; **0 ACK receipt trượt** (mục 7).
- Đo xong chạy thêm `pnpm smoke:directions -- --confirm-production --requests=20` để chắc bộ bốn tuyến
  chuẩn không hồi quy — đây là phép so duy nhất có mốc lịch sử.

### 6.3 Nếu hụt ngưỡng — và điều đã thật sự xảy ra ngày 22/09/2026

Lần đo đầu với trần 100 cặp / 10 điểm dừng và 1 luồng: A/B/C đạt (1.483 / 1.857 / 2.178 ms) nhưng bài
D hụt nặng — p95 directions lúc bận gấp **4,1–5,3 lần** lúc rảnh (2,7–5,3 s).

Ba đường đã cân nhắc, và kết quả:

1. **Tăng `VALHALLA_THREADS` 1 → 2 — ĐÃ THỬ, ĐÃ HOÀN NGUYÊN.** Máy chỉ 2 nhân nên hai luồng Valhalla
   lấy hết CPU của `cloudflared` và Postgres. Tỷ lệ trông đẹp hơn (1,25–1,43×) nhưng chỉ vì baseline
   tệ đi; `pnpm smoke:directions` trên bốn tuyến chuẩn cho p95 1,1–4,0 s, vượt xa ngưỡng 800 ms đã
   chốt 11/09. Đã quay về 1 luồng. Đường này đóng cho tới khi máy chủ có nhiều nhân hơn.
2. **Hạ trần cỡ: `MATRIX_MAX_PAIRS` 100 → 50, `OPTIMIZED_MAX_STOPS` 10 → 8** (PHONG chốt 22/09). Giảm
   tải của MỘT request, nhưng không chặn được năm khách cùng gọi.
3. **Rate limiter riêng cho hai endpoint nặng: `MATRIX_RATE_LIMITER`, 6 request/phút theo khoá thuần**
   (PHONG chốt 22/09, đảo quyết định "dùng chung limiter" ở mục 1.5 khi chưa có số). Đây mới là thứ
   giới hạn **tải tổng** lên engine: trần cỡ giới hạn một request, nhịp giới hạn số request. Áp cho cả
   `web`/`mobile` lẫn `server` vì mục tiêu là bảo vệ origin, không phải chống spam theo IP.

Làm cả 2 và 3, rồi đo lại. Vẫn hụt thì hạ tiếp trần xuống 25 cặp, hoặc để tính năng ở trạng thái
"đã có endpoint nhưng chưa công bố" cho tới khi máy chủ được nâng cấp — **không** nới ngưỡng.
## 7. Kiểm thử

| Lớp | File | Kiểm gì |
|---|---|---|
| Unit Worker | `apps/api/test/routing-matrix.test.ts` | đếm trước parse (5.000 điểm bị từ chối không parse); trần 25/25/100; hộp VN; chim bay theo mode với cặp vi phạm trong message; `matrixBody()` đúng costing/units, không có `directions_options`; `translateMatrix()` đặt ô theo `from_index`/`to_index`, km→m, làm tròn, `null` cho `time: null`, bảng sai cỡ → 503; `matrixCacheUrl()` làm tròn 4 chữ số và ổn định theo thứ tự |
| Unit Worker | `apps/api/test/routing-optimized.test.ts` | trần 10 stops; `to` bỏ trống → body có `from` ở cuối; thứ tự `locations`; `order` từ `original_index`; hoán vị sai/đầu-cuối sai → 503; `lang=vi` đi qua `applyViPhrases`; `legs.length === stops + 1` |
| Route Worker | `apps/api/test/matrix-route.test.ts`, `apps/api/test/optimized-route.test.ts` | khuôn `directions-route.test.ts`: mock fetch Valhalla bằng fixture; 200 đúng schema; 400 không gọi Valhalla và không tốn lượt; 442 → 404; timeout → 503; `x-mlv-cache` hit/stale; HEAD → 405; quota group `directions` |
| Unit Worker | `apps/api/test/routing-valhalla.test.ts` (mở rộng) | `routingFetch` với hai path mới; header Access chỉ khi https; `redirect: 'manual'` |
| Fixture | `apps/api/test/fixtures/valhalla/q1-matrix.json`, `q1-optimized.json` | JSON Valhalla thô ghi bằng `scripts/routing-test.mjs --capture` (mở rộng cờ) trên graph Quận 1; là đầu vào cho unit test, không phải snapshot |
| Core | `packages/core/src/client.matrix.test.ts`, `client.optimized-route.test.ts` | query string ghép đúng; `[lat,lng]` → `lat,lng;…`; `to` vắng thì không gửi tham số |
| Tích hợp local | `apps/api/test-routing/matrix.rtest.mjs`, `optimized-route.rtest.mjs` | trên Valhalla fixture Quận 1 qua `wrangler dev`: ma trận 2×2 bốn điểm Quận 1 có số dương, đường chéo hợp lý; TSP `from` + 2 stops + `to` trả `order` là hoán vị của `[0,1]`, `legs.length === 3`, câu tiếng Việt có dấu; điểm ngoài graph trong TSP → 404 |
| Site | `apps/site/src/lib/doi-dau.test.ts`, `trang.test.ts`, `seo.test.ts` sẵn có | tự bắt: hàng `'ta'` không chứa mục `CHUA_CO`; description 120–160 ký tự; ≥ 2 hàng đối thủ thắng |
| Cổng chung | `pnpm test`, `pnpm typecheck`, `pnpm lint`, build core với `size-limit` | xanh trước mỗi commit; test API không cần Postgres (quy tắc sẵn có) |

## 8. Docs (`apps/docs/src/content/docs`)

| Trang | Sửa |
|---|---|
| `api.md` | Hai mục `### GET /v1/matrix`, `### GET /v1/optimized-route` ngay sau `GET /v1/directions`, cùng khuôn: đoạn dẫn, bảng tham số, ràng buộc, curl, JSON mẫu, "điểm cần chú ý" (toạ độ `[lng, lat]`; `null` là không nối; `order` là chỉ số vào `stops`; bỏ `to` = về `from`; toạ độ nằm trong URL nên có trong log Workers như directions). Mục quota Chỉ đường: thêm câu "`/v1/matrix` và `/v1/optimized-route` tính **một lượt mỗi request** bất kể số điểm". Bảng cache thêm hai dòng 60 s / 5 phút. Câu "Bảy endpoint dữ liệu (sáu API Places và `/v1/directions`) nay trả 405" → chín, kể tên. Dòng lỗi `no_route` nhắc thêm hai endpoint. Phần catalog/gói không đổi |
| `tinh-nang.md` | Bảng endpoint thêm hai dòng; "Chín endpoint: tám đọc, một ghi" → "Mười một endpoint: mười đọc, một ghi"; mục 5 Chỉ đường thêm đoạn "Giao hàng và vận tải" nêu hai endpoint, trần cỡ, một lượt, và chưa có đội xe nhiều xe |
| `sdk.md` | Bảng hàm client +2 dòng; bảng kiểu +4 (`MatrixOptions`, `MatrixResponse`, `OptimizedRouteOptions`, `OptimizedRouteResponse`); bảng tham số +2; danh sách re-export của web và RN |
| `dan-duong.md` | Mục mới ngắn "Tối ưu thứ tự điểm dừng": gọi `map.places.optimizedRoute()`, đưa thẳng vào `map.routes.show()`, dùng `order` đánh số marker, `navigation.start({ response })` dùng được nguyên |
| `khoa-api.md` | Dòng "Burst Chỉ đường … riêng `GET /v1/directions`" → "cho `/v1/directions`, `/v1/matrix`, `/v1/optimized-route` cộng lại" |
| `tu-host.md` | Một câu: image Valhalla đã bật sẵn `sources_to_targets` và `optimized_route`, không cần cấu hình thêm |
| Spec A mục 1.3 | Thêm dòng: "Ma trận và tối ưu thứ tự điểm dừng: xem spec `2026-09-22-ma-tran-toi-uu-thu-tu-design.md`" |

Không đổi `THIRD_PARTY_NOTICES.md` (Valhalla đã có, không thêm thư viện). Không đổi Playground.

## 9. Site (`apps/site`)

| File | Sửa |
|---|---|
| `src/lib/doi-dau.ts` | `CHUA_CO` = `['tối ưu đội xe nhiều xe', 'giao thông thời gian thực', 'Street View', 'ảnh vệ tinh']`. Bảng Google: thay hàng "Ma trận khoảng cách và tối ưu lộ trình đội xe" bằng **hai** hàng — `{ tieuChi: 'Ma trận khoảng cách và tối ưu thứ tự điểm dừng', ta: 'Có; tối đa 100 cặp hoặc 10 điểm dừng mỗi lượt, tính một lượt Chỉ đường', ho: 'Có; cỡ lớn hơn, tính tiền theo từng cặp', thang: 'hoa' }` và `{ tieuChi: 'Tối ưu đội xe nhiều xe', ta: 'Chưa có', ho: 'Có (Route Optimization API)', thang: 'ho' }`. Bảng VIETMAP: hàng "Bài toán vận tải và theo dõi phương tiện" đổi cột `ta` thành 'Có ma trận khoảng cách và tối ưu thứ tự cho một xe; chưa có đội xe nhiều xe, chưa theo dõi phương tiện', giữ `thang: 'ho'`. Số đọc từ hằng số? **Không** — site không import `apps/api`; chuỗi chép tay, và plan có bước đối chiếu với `MATRIX_MAX_PAIRS`/`OPTIMIZED_MAX_STOPS` khi đổi trần (ghi chú ngay trên dòng) |
| `src/pages/tinh-nang.astro` | Mục thứ 6 trong `MUC`: `id: 'giao-hang'`, nhãn "Giao hàng", tiêu đề "Giao hàng & vận tải", hai đoạn (ma trận N×M chọn tài xế/kho gần nhất; tối ưu thứ tự ghé cho một chuyến, trả tuyến vẽ được ngay; nói rõ tối đa 100 cặp / 10 điểm dừng mỗi lượt, tính một lượt Chỉ đường; chưa có đội xe nhiều xe), link `${DOCS_URL}/api/#get-v1matrix`. Minh hoạ tĩnh trong `data-bang-chung`: bảng 3×3 số phút nhỏ và danh sách thứ tự ghé "1 → 3 → 2", cùng thang `t-*` và component `The` sẵn có. Mục "Những thứ chưa có" tự cập nhật từ `CHUA_CO` |
| `src/pages/index.astro` | Thêm một `BentoO` "Giao hàng & vận tải" (nhãn `MATRIX`), xếp lại `span` để mỗi hàng đủ 12 cột ở ≥ 1024 px; câu "Sáu mảng đang chạy thật" → "Bảy mảng" |
| `src/lib/trang.ts` | `tinhNang.description` thêm cụm "ma trận khoảng cách" và viết gọn lại để giữ 120–160 ký tự (test SEO kiểm) |
| `src/pages/so-sanh/vietmap.astro` | "tối ưu lộ trình đội xe" → "tối ưu đội xe nhiều xe" trong câu "nên chọn VIETMAP khi…"; câu đáp FAQ vẫn đúng, không đổi |

`src/content/bai-viet/chi-phi-google-maps-api-cho-doanh-nghiep-viet-nam-2026.md` nhắc "ma trận khoảng cách" trong bối cảnh Google tính tiền riêng — vẫn đúng, giữ.

## 10. Thứ tự làm và phát hành

Nhánh `feat/ma-tran-toi-uu-thu-tu` (quy ước repo: việc nhiều commit đi qua `feat/*` rồi merge).

1. Worker: params, body, translate, route, test unit/route; `pnpm test`, `typecheck`, `lint` xanh.
2. Core: kiểu, hai hàm, test; web/RN re-export; build core qua `size-limit`.
3. `routing-test.mjs`: mở rộng `--capture` cho hai action, ghi hai fixture; hai file `.rtest.mjs`; `pnpm test:routing` xanh trên máy dev (container Valhalla Quận 1 đang có).
4. **Merge lần 1 → push main → CI Deploy API.** Endpoint sống trên production nhưng chưa ghi ở đâu. **Sau mỗi push main đều deploy docs tay đè** (bài học đã ghi: workflow Deploy Docs xoá khoá demo, playground trả 401).
5. `pnpm smoke:matrix -- --confirm-production` (PHONG gõ bằng `!`), bài A–D, ghi evidence. Đạt ngưỡng mục 6.2 → bước 6. Hụt → mục 6.3, đo lại.
6. Docs + site (mục 8, 9) + ảnh nghiệm thu production; DEVLOG mục mới; **merge lần 2 → push main**; deploy docs tay đè lần nữa; `pnpm sdk:publish` bản minor; kiểm `CHUA_CO` trên production còn bốn mục và bảng đối đầu đổi hàng.

Bước 4→5→6 là "cờ tính năng" tự nhiên: không cần biến môi trường mới.

## 11. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Một ma trận 100 cặp chiếm Valhalla một luồng vài giây, chèn `/v1/directions` của khách khác | Trần 100 cặp / 10 stops; bài D đo trước khi công bố; hạ trần hoặc tăng luồng theo mục 6.3 |
| Kẻ có khoá `web` công khai bắn ma trận liên tục | Trần 100 request/phút/khoá web-mobile và burst 20/phút/khoá+IP dùng chung → tối đa 100 ma trận/phút/khoá ≈ 10.000 cặp/phút; bài D cho biết con số đó có chịu được không; nếu không, thêm binding trần riêng thấp hơn (phương án 3 đã cân nhắc 22/09, để dự phòng) |
| Người dùng gửi 25×4 thay 10×10 để "lách" — không phải lách: cùng 100 cặp | Trần theo **cặp**, không theo số điểm mỗi bên |
| Valhalla trả `time`/`distance` dạng khác `null` cho ô không nối ở phiên bản sau | Worker coi `null`, không phải số, hoặc âm đều là không nối; test có ca này |
| `original_index` vắng ở một phiên bản Valhalla | Worker trả 503 "dữ liệu không hợp lệ" chứ không đoán thứ tự; `routing-fixture` capture lại khi nâng image |
| Cache key làm tròn 11 m trả bảng của người khác ở điểm khác 11 m | Lệch quãng đường 0,19 % (đo 20/09), chấp nhận; toạ độ gửi Valhalla vẫn nguyên |
| Trần cỡ chép tay vào site lệch với hằng số Worker khi hạ trần | Ghi chú ngay trên dòng trong `doi-dau.ts` và `tinh-nang.astro`; mục 6.3 bắt buộc sửa docs/site cùng commit đổi trần |
| CI Deploy Docs xoá khoá demo sau mỗi push main | Bước 4 và 6 đều có "deploy docs tay đè" |
| Vượt `size-limit` core 16 kB | Nâng trần cùng commit, ghi số |
| Đo ở dev (graph Quận 1, 2 luồng) rồi kết luận | Mọi ngưỡng chốt bằng số đo production (bài học đã ghi memory); dev chỉ để xác minh hình dạng response |
| Bài D tự gây 429 làm số đo sai | Tổng request ≤ 15/phút/khoá; smoke kiểm và dừng nếu gặp 429 |

## 12. Ngoài phạm vi và đường nâng cấp đã dự trù

- **Tầng 3 — tối ưu đội xe (VRP)**: khi có khách thật đòi và máy chủ mạnh hơn. Đường đi dự kiến: container VROOM (dùng Valhalla làm nền ma trận) trong `infra/server/compose.yml`, endpoint `POST /v1/fleet-plan` (đây là ca đáng dùng POST vì body có xe/đơn/khung giờ), spec riêng, nhóm quota riêng. `CHUA_CO` giữ mục "tối ưu đội xe nhiều xe" tới lúc đó. → **Đã làm 23/09/2026**: spec `2026-09-23-toi-uu-doi-xe-design.md`, endpoint `POST /v1/fleet-plan`, container VROOM.
- **Tính lượt theo cặp**: thêm tham số `units` cho `QuotaObject.reserve()` hoặc nhóm quota `matrix` riêng — làm khi số liệu Analytics cho thấy ma trận chiếm phần đáng kể chi phí máy chủ.
- **Open-end TSP**: không có trong Valhalla; nếu cần, tính bằng ma trận N×N rồi giải TSP nhỏ ngay trong Worker (N ≤ 12 đủ rẻ) — để sau.
- **`snapped` cho ma trận**: Valhalla đã trả toạ độ bám; thêm trường khi có người dùng cần phát hiện điểm bám xa.
- **Tab Playground**: khi có người dùng hỏi.

## 13. Nghiệm thu

1. `pnpm test`, `pnpm typecheck`, `pnpm lint` xanh; `pnpm test:routing` xanh trên máy dev với hai ca mới; build core qua `size-limit`.
2. Production sau merge lần 1: `GET /v1/matrix` 2×2 và `GET /v1/optimized-route` 3 điểm trả 200 đúng schema với khoá `server`; HEAD trả 405; 26 sources trả 400 không tốn lượt (kiểm bằng usage Console/Admin trước–sau).
3. Evidence `docs/evidence/routing/2026-09-<ngày>-matrix.md` có bảng A–D, đạt ngưỡng mục 6.2 hoặc ghi quyết định mục 6.3 kèm số đo hai lần.
4. Docs production có hai mục endpoint, quota nói "một lượt", bảng endpoint đếm đúng; playground vẫn có khoá (không 401).
5. Site production: trang Tính năng có mục Giao hàng & vận tải; mục "Những thứ chưa có" còn bốn mục; bảng đối đầu Google có hàng hoà và hàng "Tối ưu đội xe nhiều xe"; trang chủ bảy thẻ; ảnh nghiệm thu commit.
6. Bốn gói SDK bản minor mới trên npm, `client.matrix` và `client.optimizedRoute` có trong `dist/index.d.ts`.
7. DEVLOG mục mới; spec A mục 1.3 có dòng trỏ chéo; trạng thái spec này đổi thành "Đã phát hành".

## 14. Việc tay của PHONG

- Duyệt văn bản spec này, rồi plan.
- Bước 5: chạy `pnpm smoke:matrix -- --confirm-production` bằng `!` với khoá `server` (auto mode chặn Fable đụng production), dán kết quả để ghi evidence.
- Nếu hụt ngưỡng: quyết hạ trần hay tăng `VALHALLA_THREADS` (mục 6.3).
- Sau merge: xác nhận Deploy API xanh; nếu Fable không có quyền deploy docs đè thì chạy lệnh deploy docs bằng `!`.
