# MapsLibVN — Thiết kế tối ưu đội xe (chia đơn cho nhiều xe): `POST /v1/fleet-plan`

- Ngày: 2026-09-23
- Trạng thái: **Đã phát hành API 23/09/2026.** Trần giữ nguyên 5 xe / 30 đơn / 10 đơn mỗi xe, nhịp 2/phút — evidence `docs/evidence/routing/2026-09-23-fleet.md` (đo trên MacBook M4 Pro); DEVLOG mục 34. Plan: `docs/superpowers/plans/2026-09-23-toi-uu-doi-xe.md`.
- Chủ dự án: PHONG
- Tài liệu do Fable 5.1 viết
- Spec gốc: `2026-09-22-ma-tran-toi-uu-thu-tu-design.md` mục 1.2 gọi đây là "tầng 3" và mục 12 dự trù đường đi
  (container VROOM, `POST /v1/fleet-plan`). Spec này làm đúng tầng đó.

## 0. Tóm tắt một đoạn

`/v1/optimized-route` sắp thứ tự ghé cho **một** xe. Khách có nhiều xe phải tự chia đơn trước rồi gọi
từng xe — docs mục 5 thừa nhận cách đó "không đảm bảo ngắn nhất toàn cục". Spec này thêm bộ giải
định tuyến đội xe (Vehicle Routing Problem) **VROOM** làm container thứ sáu trong compose máy chủ,
dùng Valhalla sẵn có để lấy ma trận, và một endpoint Worker `POST /v1/fleet-plan`: gửi tối đa **5 xe
và 30 đơn** kèm sức chứa, khối lượng, thời gian dừng, khung giờ khách hẹn, giờ làm của xe; nhận về
đơn nào giao cho xe nào, thứ tự ghé, giờ đến ước tính, đơn không xếp được, và **tuyến đầy đủ của
từng xe** dạng `DirectionsResponse` để `routes.show()` và `navigation.start()` dùng ngay. Một request
là **một lượt** nhóm `directions`, có **nhịp riêng 2 request/phút/khoá** và trần cỡ kiểm ở Worker. Gói
core thêm `client.fleetPlan()`, web và React Native thêm `routes.showFleet()` vẽ K xe K màu.
Playground tab Đội xe thêm mục "Chia đơn cho nhiều xe". Docs và site sửa sau khi đo production đạt
ngưỡng, đúng quy trình spec ma trận. VROOM không mở cổng nào: Worker tới nó qua **luật đường dẫn
`/fleet/` trên cùng hostname Tunnel `maps-route`**, dùng lại Access application và service token đang có.

## 1. Mục tiêu, phạm vi, quyết định

### 1.1 Mục tiêu

- Khách có đội xe gửi **một request** cho cả lô đơn và nhận kế hoạch cho cả đội, thay vì tự chia tay.
- Nhận đủ ba ràng buộc mà docs hiện ghi "chưa có": sức chứa xe, khung giờ khách hẹn, thời gian dừng
  mỗi điểm — cộng open-end (kết thúc ở đơn cuối) vốn VROOM cho miễn phí.
- Kết quả từng xe **là** `DirectionsResponse` (tuyến, chặng, câu chỉ dẫn tiếng Việt), nên mã vẽ và dẫn
  đường hiện có không đổi.
- Không phá dịch vụ khác trên cùng Valhalla: đo production trước khi công bố, trần và nhịp chốt bằng số đo.

### 1.2 Trong phạm vi

- Container VROOM (server + dev), cấu hình, luật Tunnel, health, cron cảnh báo (thành phần thứ tư), trang Admin.
- Worker: `POST /v1/fleet-plan`, `GET /healthz/fleet`, nhịp riêng, cache, quota preflight cho body JSON.
- Core: kiểu, `client.fleetPlan()`, `fleetRouteFeatures()`, `decodeFleet()`, `FLEET_COLORS`.
- Web + RN: `map.routes.showFleet()`; publish ba gói minor.
- Playground tab Đội xe: mục chia đơn nhiều xe, e2e.
- Smoke production `pnpm smoke:fleet`, evidence, docs, site, DEVLOG.

### 1.3 Ngoài phạm vi (mục 14)

Lấy hàng và giao hàng ghép đôi (shipments), kỹ năng tài xế, nghỉ giữa ca, nhiều loại xe trong một
request, tính lượt theo số xe, chế độ đánh giá lịch có sẵn (plan mode), giao thông thời gian thực,
theo dõi vị trí đội xe.

### 1.4 Quyết định đã chốt (PHONG, 23/09/2026)

| # | Câu hỏi | Quyết định |
|---|---|---|
| 1 | Ràng buộc bản đầu | **Đủ**: chia đơn + sắp thứ tự + sức chứa/khối lượng + thời gian dừng + khung giờ khách hẹn + giờ làm của xe (+ open-end, ưu tiên đơn) |
| 2 | Tính lượt | **1 lượt nhóm `directions` mỗi request**, như ma trận; bảo vệ bằng nhịp 2/phút/khoá và trần cỡ. Tính theo xe để sau, khi sổ quota trừ được nhiều đơn vị |
| 3 | Trần cỡ | **≤ 5 xe, ≤ 30 đơn, ≤ 10 đơn mỗi xe**; chốt lại theo số đo production |
| 4 | React Native | **Làm `routes.showFleet()` cho RN ngay**, cùng đợt với web |
| 5 | Nhánh | Làm **thẳng trên `main`**, không tạo nhánh |
| 6 | Máy chủ | Máy chủ **chính là MacBook** (arm64); Ubuntu 2 nhân là máy phụ tạm; sau khi phát hành app dời máy chủ chính sang **Windows Core i5-1340P, 16 GB** (Docker Desktop/WSL2). Image phải chạy được cả arm64 lẫn amd64; trần cỡ đo lại khi dời máy |

## 2. Tiền đề kỹ thuật đã xác minh (23/09/2026)

**VROOM** (`ghcr.io/vroom-project/vroom-docker:v1.15.0`, digest index
`sha256:247d5683d6745c755d718a156d16b16aac80baccc276a003a68b986c13883b08`, có `linux/amd64` và
`linux/arm64`; nền `node:20-bookworm-slim`, có `curl`):

- Bọc bởi **vroom-express**: `POST <baseurl>` giải bài, `GET <baseurl>health`; cổng 3000; cấu hình
  `/conf/config.yml` (entrypoint chép vào `/vroom-express/config.yml` lúc khởi động và `touch
  /conf/access.log` — mount **thư mục**, không mount một file read-only); `VROOM_ROUTER=valhalla`
  hoặc `cliArgs.router`. `maxlocations`, `maxvehicles`, `limit` vượt → **413**. Mã thoát VROOM →
  HTTP: `0` → 200, `2` (lỗi đầu vào) → 400, `3` (lỗi định tuyến) → 500, `1` (lỗi trong) → 500; body
  luôn JSON `{ code, error? }`. Tuỳ chọn per-request (`options.g`…) chỉ áp khi có trong `override`.
- Với `router: valhalla`, VROOM gọi Valhalla **`/sources_to_targets`** (ma trận, `units`
  kilômét, ô `time` null = không nối) và **`/route`** (`directions_type: none`) — đúng hai action đang
  chạy. `profile` của xe truyền **nguyên văn** làm `costing`, nên profile của ta là
  `auto` / `motor_scooter` / `pedestrian`. Ma trận có ô null → VROOM ném lỗi định tuyến
  "Unfound route(s) …" cho **cả request** (không tự bỏ điểm).
- `id` của xe và đơn phải là **số nguyên** → Worker ánh xạ chuỗi ↔ chỉ số.
- Mọi thời gian là **giây nguyên**; `time_window` là `[bắt đầu, kết thúc]` bao cả hai đầu; giá trị
  tuyệt đối (UNIX giây) hay tương đối đều được. Không có khung giờ = không ràng buộc. VROOM chọn
  giờ xuất phát trong ca làm để giảm chờ, nên `arrival` của bước `start` là giờ xuất phát khuyến nghị.
- `geometry` bật thì VROOM tự gọi `/route` từng xe để lấy polyline **precision 5** không có câu chỉ
  dẫn. Ta **tắt**: Worker gọi `/route` từng xe để có `DirectionsResponse` đầy đủ, cùng chi phí.

**Valhalla production** (`/custom_files/valhalla.json` trên MacBook, 23/09): `max_matrix_location_pairs`
**2.500** (mọi costing) → ma trận vuông tối đa 50 điểm; `max_locations` **20** cho `auto`, 50 cho
`motor_scooter`/`pedestrian`; `max_matrix_distance` 400 km `auto`, 200 km hai costing kia. Trần 5 xe +
30 đơn = tối đa 40 điểm → ≤ 1.600 cặp, và mỗi xe ≤ 10 đơn + 2 đầu = 12 điểm mỗi `/route`.

**Cloudflare Tunnel**: luật Public Hostname nhận thêm **đường dẫn** (regex), so từ trên xuống; luật
có đường dẫn phải đứng trên luật cùng hostname không có đường dẫn. Access application `mapslibvn-route`
khai theo domain nên phủ mọi đường dẫn của `maps-route.<domain>`, kể cả `/fleet/`.

**Trong mã**: `quotaMiddleware(group, preflight)` chỉ nhận preflight đồng bộ (đọc body JSON là bất
đồng bộ → mở rộng). `AppEnv.Variables.params` có sẵn để preflight chuyển tham số đã parse cho handler.
Cron cảnh báo đọc trạng thái KV cũ bằng `laTrangThai()`: thiếu thành phần mới → coi như chưa có trạng
thái → lượt `lan-dau`, **không gửi thư** — thêm thành phần thứ tư không cần migrate KV.

## 3. Kiến trúc và luồng dữ liệu

```
Client ──POST /v1/fleet-plan (JSON, X-Api-Key)──▶ Worker
  1. requireAuth places:read → nhịp FLEET_RATE_LIMITER 2/phút/khoá → quotaMiddleware('directions', preflight)
     preflight: đọc body ≤ 64 KB, parseFleetBody() → 400 không tốn lượt; c.set('params', p)
  2. cachedJson(fleetCacheUrl(p), 60 s, stale 300 s):
     a. callVroom(env, fleetVroomBody(p))  ── POST {FLEET_BASE}/ ──▶ vroom:3000 ── sources_to_targets ──▶ valhalla:8002
     b. translateFleet(json, p): xe → danh sách đơn theo thứ tự, stops (arrival/waiting/service), unassigned
     c. Promise.all: mỗi xe có đơn → callValhalla('/route', [start, …đơn theo thứ tự, end?]) ──▶ valhalla:8002
     d. assembleFleetPlan(): translateDirections() từng xe + stops + summary → FleetPlanResponse
◀── 200 JSON (mỗi xe là DirectionsResponse + vehicle/jobs/stops)
```

Trên máy chủ, `vroom` và `valhalla` nói chuyện trong mạng compose; `cloudflared` là cửa duy nhất từ
ngoài: `maps-route.<domain>/fleet/*` → `vroom:3000`, phần còn lại của hostname → `valhalla:8002`.
Dev: `infra/dev/compose.yml` profile `routing` dựng cả hai; Worker dev trỏ `FLEET_BASE=http://127.0.0.1:3000/fleet`.

## 4. API Worker

### 4.1 `POST /v1/fleet-plan`

Header `X-Api-Key` (scope `places:read`), `Content-Type: application/json`, body ≤ **64 KB**:

```json
{
  "mode": "motorbike",
  "lang": "vi",
  "vehicles": [
    { "id": "xe-1", "start": [10.7725, 106.698], "capacity": 20, "max_jobs": 10,
      "time_window": ["2026-09-24T08:00:00+07:00", "2026-09-24T12:00:00+07:00"] },
    { "id": "xe-2", "start": [10.7725, 106.698], "end": "open", "capacity": 20,
      "time_window": ["2026-09-24T08:00:00+07:00", "2026-09-24T12:00:00+07:00"] }
  ],
  "jobs": [
    { "id": "don-1", "location": [10.7826, 106.6958], "demand": 3, "service_s": 300, "priority": 50,
      "time_windows": [["2026-09-24T09:00:00+07:00", "2026-09-24T10:00:00+07:00"]] },
    { "id": "don-2", "location": [10.7686, 106.7069], "demand": 5, "service_s": 300 }
  ]
}
```

| Trường | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `mode` | `motorbike` \| `car` \| `walk` | không | `motorbike` | một phương tiện cho cả đội |
| `lang` | `vi` \| `en` | không | `vi` | ngôn ngữ câu chỉ dẫn của tuyến từng xe |
| `vehicles[]` | 1–5 | có | — | |
| `vehicles[].id` | chuỗi 1–64 ký tự | có | — | duy nhất trong `vehicles` |
| `vehicles[].start` | `[lat, lng]` | có | — | |
| `vehicles[].end` | `[lat, lng]` \| `"open"` | không | = `start` | `"open"` = kết thúc ở đơn cuối (open-end) |
| `vehicles[].capacity` | số nguyên 0–1.000.000 | không | — | **tất cả hoặc không**: một xe có thì mọi xe phải có |
| `vehicles[].max_jobs` | số nguyên 1–10 | không | 10 | trần đơn mỗi xe |
| `vehicles[].time_window` | `[ISO, ISO]` | không | — | giờ làm: sớm nhất rời `start`, muộn nhất kết thúc |
| `jobs[]` | 1–30 | có | — | |
| `jobs[].id` | chuỗi 1–64 ký tự | có | — | duy nhất trong `jobs` |
| `jobs[].location` | `[lat, lng]` | có | — | |
| `jobs[].demand` | số nguyên 0–1.000.000 | không | 0 | khối lượng; `> 0` chỉ khi các xe có `capacity` |
| `jobs[].service_s` | số nguyên 0–7.200 | không | 0 | thời gian dừng tại điểm, giây |
| `jobs[].priority` | số nguyên 0–100 | không | 0 | đơn ưu tiên được xếp trước khi không đủ chỗ |
| `jobs[].time_windows` | mảng 1–3 `[ISO, ISO]` | không | — | khung giờ khách nhận |

Toạ độ vào `[lat, lng]` như mọi endpoint dẫn đường; toạ độ trong response `[lng, lat]`.

### 4.2 Luật kiểm ở Worker (400 `invalid_request`, không tốn lượt, không gọi VROOM)

1. Body là JSON object, ≤ 64 KB (kiểm `content-length` rồi kiểm độ dài thật). Sai → `Body phải là JSON ≤ 64 KB`.
2. Đếm trước khi parse sâu: `vehicles` 1–5, `jobs` 1–30 (mảng dài hơn bị từ chối ở bước đếm).
3. `id` chuỗi đã trim 1–64 ký tự, duy nhất trong từng danh sách.
4. Toạ độ hợp lệ, mọi điểm (start, end, đơn) trong hộp Việt Nam (`assertInVietnam`).
5. **Cặp điểm xa nhất** (mọi cặp trong tập start/end/đơn) ≤ `MATRIX_MAX_CROW_DISTANCE_M[mode]` (200 km xe máy, 400 km ô tô, 50 km đi bộ) — bằng đúng trần ma trận Valhalla, để engine không trả 400 cho cả request. Thông báo nêu đúng cặp vi phạm.
6. `jobs.length ≤ Σ max_jobs`, không thì `30 đơn nhưng các xe chỉ nhận tối đa 20 (2 xe × 10)`.
7. Sức chứa tất cả-hoặc-không; có `demand > 0` mà không có `capacity` → `Đơn có khối lượng thì mọi xe phải có sức chứa`.
8. Khung giờ **tất cả-hoặc-không ở phía xe**: có bất kỳ `time_window`/`time_windows` nào trong request thì **mọi xe** phải có `time_window` (mục 4.3). Mỗi mốc là ISO 8601 **kèm múi giờ** (`+07:00` hoặc `Z`; thiếu → 400 `Giờ phải kèm múi giờ, ví dụ 2026-09-24T08:00:00+07:00`), `bắt đầu < kết thúc`, mỗi khung ≤ 24 giờ, toàn bộ mốc trong request trải ≤ 48 giờ.
9. Các số nguyên trong khoảng ở bảng 4.1; trường lạ bị bỏ qua (không lỗi).

### 4.3 Hai chế độ thời gian

- **Tương đối** (không có khung giờ nào): VROOM chạy không ràng buộc giờ; response chỉ có `arrival_s`,
  `waiting_s` (= 0), `service_s`, `finish_s` tính từ lúc xe rời `start`.
- **Tuyệt đối** (mọi xe có `time_window`): Worker đổi ISO → UNIX giây cho VROOM; response có thêm
  `departure_at`, `arrival_at`, `finish_at` dạng ISO 8601 **theo múi giờ của `time_window[0]` của xe đó**
  (ví dụ `2026-09-24T08:12:00+07:00`). `departure_at` là giờ xuất phát VROOM chọn (muộn nhất trong ca mà
  không làm trễ đơn nào), có thể sau `time_window[0]`. `arrival_s` vẫn tính từ `departure_at`.

Không có chế độ lẫn: xe không có `time_window` trong request có khung giờ → 400
`Có khung giờ thì mọi xe phải có time_window (giờ làm)` — vì VROOM sẽ coi xe đó rảnh từ năm 1970 và giờ
đến trả về vô nghĩa.

### 4.4 Response 200

```json
{
  "mode": "motorbike",
  "vehicles": [
    {
      "vehicle": "xe-1",
      "jobs": ["don-2", "don-1"],
      "stops": [
        { "job": "don-2", "arrival_s": 540, "arrival_at": "2026-09-24T08:21:00+07:00", "waiting_s": 0, "service_s": 300 },
        { "job": "don-1", "arrival_s": 1620, "arrival_at": "2026-09-24T09:00:00+07:00", "waiting_s": 240, "service_s": 300 }
      ],
      "departure_at": "2026-09-24T08:12:00+07:00",
      "finish_s": 2700,
      "finish_at": "2026-09-24T08:57:00+07:00",
      "load": 8,
      "routes": [{ "mode": "motorbike", "distance_m": 6120, "duration_s": 1380, "legs": ["…3 leg…"], "geometry": "polyline6…", "bbox": [], "flags": {} }],
      "waypoints": [{ "location": [106.698, 10.7725], "snapped": [], "name": null }, "…"],
      "attribution": "© OpenStreetMap contributors"
    },
    { "vehicle": "xe-2", "jobs": [], "stops": [], "finish_s": 0, "load": 0, "routes": [], "waypoints": [], "attribution": "© OpenStreetMap contributors" }
  ],
  "unassigned": [{ "id": "don-9" }],
  "summary": { "vehicles_used": 1, "jobs_assigned": 2, "jobs_unassigned": 1, "distance_m": 6120, "duration_s": 1380, "service_s": 600, "waiting_s": 240 },
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "vroom+valhalla", "graph": "2026-09-17" }
}
```

- `vehicles[k]` **là** `DirectionsResponse` (`routes`, `waypoints`, `attribution`) cộng `vehicle`, `jobs`,
  `stops`, `load`, `finish_s`, và ba trường `*_at` ở chế độ tuyệt đối. `routes[0].legs.length` = số đơn
  (+1 nếu không open-end). `waypoints` = start, các đơn theo thứ tự ghé, end (nếu có).
- Xe không được giao đơn nào vẫn có mặt với `jobs: []`, `routes: []`, `waypoints: []`, để ứng dụng hiện "xe nghỉ".
- `stops[i].arrival_s`/`waiting_s`/`service_s` lấy từ lịch VROOM (tính trên **ma trận**); `routes[0]`
  lấy từ `/route`. Hai con số có thể lệch vài phần trăm — docs nói rõ.
- `load` = tổng `demand` các đơn được giao (0 khi không dùng sức chứa).
- `finish_s` = giờ tới `end` trừ giờ xuất phát; với open-end = giờ tới đơn cuối + chờ + dừng.
- `summary.distance_m`/`duration_s` = tổng `routes[0]` của các xe (từ `/route`); `service_s`/`waiting_s` từ VROOM.
- `unassigned[].id` là id đơn không xếp được (hết chỗ, quá sức chứa, khung giờ không thoả). VROOM không
  cho lý do, ta không bịa.
- `engine.name` = `vroom+valhalla`; `graph` như directions.

### 4.5 Lỗi

| Tình huống | Trả về |
|---|---|
| Không/sai khoá, sai scope, origin | 401/403 như mọi route (requireAuth) |
| Vi phạm mục 4.2 | `400 invalid_request`, message tiếng Việt nêu đúng chỗ sai |
| Quá nhịp 2/phút/khoá | `429 rate_limit_exceeded`, `retry-after: 60`, message `Gửi quá nhiều request chia đơn đội xe trong một phút` |
| VROOM `code 3` với thông điệp `Unfound route(s)` | `404 no_route`: `Không tới được bằng mạng đường: đơn don-7` — Worker đối chiếu toạ độ `[lon, lat]` trong thông điệp với điểm đã gửi (làm tròn 6 chữ số) để gọi tên; không khớp thì message chung |
| VROOM HTTP 400 (`code 2`) | `400 invalid_request` `Bộ giải từ chối yêu cầu (mã 2): <error>` — không nên xảy ra sau 4.2; giữ để chẩn đoán |
| VROOM 413 | `400 invalid_request` `Yêu cầu quá cỡ` — không nên xảy ra vì trần Worker thấp hơn |
| VROOM `code 1`, `code 3` khác (không nối được Valhalla), Access 302/403, không JSON, quá 18 s | `503 upstream_unavailable` `Bộ giải đội xe không phản hồi` hoặc `… trả dữ liệu không hợp lệ` |
| `/route` của một xe lỗi | theo `mapValhallaError` hiện có (404/503) cho **cả request** — không trả kế hoạch thiếu tuyến |
| `FLEET_BASE` chưa cấu hình | `503 upstream_unavailable` `Chưa cấu hình bộ giải đội xe (FLEET_BASE)` |

VROOM chỉ báo "Unfound route(s)" ở cặp đầu tiên gặp; docs dặn: thử `/v1/matrix` 1×N từ kho tới các đơn để tìm hết điểm không nối.

### 4.6 Cache

`cachedJson()` 60 s tươi / 300 s stale như ba endpoint dẫn đường, khoá
`https://cache.mapslibvn/fleet-plan?v=1&h=<sha256>` với hash của **tham số đã chuẩn hoá**: mode, lang,
danh sách xe và đơn theo thứ tự gửi (id, toạ độ làm tròn 4 chữ số ≈ 11 m, capacity, max_jobs, demand,
service_s, priority, mốc giờ dạng UNIX giây). Lỗi 4xx không cache; header `x-mlv-cache` như cũ.

### 4.7 Quota, nhịp, đo lường

- `requireAuth('places:read', { deferRevocation: true })` → nhịp `FLEET_RATE_LIMITER` (2/phút/khoá thuần,
  áp cả khoá `server`) → `quotaMiddleware('directions', preflight)`. `quotaMiddleware` mở rộng nhận
  preflight `(c) => void | Promise<void>`; preflight đọc và kiểm body, `c.set('params', p)`; handler
  đọc `c.get('params')` — không parse hai lần (spec thương mại 14.4).
- Một request = **một lượt** `directions` (quyết định 2). Vẫn chịu burst 20/phút khoá+IP và trần 100/phút khoá `web`/`mobile` của nhóm.
- Analytics: route ghi như mọi route (`/v1/fleet-plan`); không thêm cột.

### 4.8 Health

- `GET /healthz/fleet` (không cần khoá, như `/healthz/routing`): gọi VROOM giải bài tí hon **1 xe, 2 đơn
  ở Hà Nội** (Hồ Gươm → Văn Miếu, Nhà hát Lớn; `auto`; không geometry) với timeout 6 s; trả
  `{ ok: true, jobs_assigned: 2, ms }`; sai → 503. Không dùng `GET /fleet/health` của vroom-express
  làm bằng chứng sống: nó chỉ nói tiến trình Node còn chạy, không nói bộ giải nối được Valhalla
  (bài học "Valhalla `/status` xanh giả").
- Cron cảnh báo (`health/phep-do.ts`): `THANH_PHAN` thêm `'fleet'` ("Đội xe"), `SoLieu.fleet = { assigned: number }`,
  cùng phép đo trên. Trang Admin: `features/health/api.ts` thêm `fleet`, `page.tsx` thêm ô thứ tư
  (lưới `sm:grid-cols-4`), `overview/page.tsx` thêm thẻ "Đội xe". Trạng thái KV cũ thiếu `fleet` → lượt
  `lan-dau`, không thư (mục 2). **Thứ tự phát hành** (mục 12) bật VROOM trước khi deploy Worker để
  thành phần mới không khởi đầu ở trạng thái hỏng.

### 4.9 Hằng số (export từ module, docs/site chép tay kèm ghi chú)

```ts
// apps/api/src/routing/fleet.ts
export const FLEET_MAX_VEHICLES = 5;
export const FLEET_MAX_JOBS = 30;
export const FLEET_MAX_JOBS_PER_VEHICLE = OPTIMIZED_MAX_STOPS; // 10 = MAX_VIA: tuyến từng xe dẫn đường và tính lại được
export const FLEET_MAX_TIME_WINDOWS = 3;
export const FLEET_MAX_SERVICE_S = 7_200;
export const FLEET_MAX_QUANTITY = 1_000_000; // capacity, demand
export const FLEET_MAX_PRIORITY = 100;
export const FLEET_MAX_BODY_BYTES = 65_536;
export const FLEET_ID_MAX_LENGTH = 64;
export const FLEET_MAX_WINDOW_S = 86_400;
export const FLEET_MAX_SPAN_S = 172_800;
// apps/api/src/routing/vroom.ts
export const FLEET_TIMEOUT_MS = 18_000;       // VROOM giải + ma trận Valhalla
export const FLEET_ROUTE_TIMEOUT_MS = 8_000;  // /route từng xe, song song; tổng xấu nhất < 30 s của handler thương mại
```

### 4.10 Cấu trúc mã (`apps/api/src`)

| File | Trách nhiệm |
|---|---|
| `routing/vroom.ts` | `callVroom<T>(env, body, opts)`, `fetchVroomHealth`, `mapVroomError`, kiểu `VroomRequest/Response/Step`, hằng timeout; dùng lại `routingHeaders()` (Access) |
| `routing/fleet-time.ts` | `parseIsoWithOffset(s) → { unix, offsetMin }`, `formatIsoAt(unix, offsetMin)` |
| `routing/fleet.ts` | hằng số, `parseFleetBody(raw)`, `fleetVroomBody(p)`, `fleetCacheUrl(p)`, `translateFleet(json, p)` (VROOM → khung kế hoạch), `assembleFleetPlan(khung, routes[], p, graph)`, `fleetRouteBody(p, xe)` |
| `routing/nhip.ts` | tổng quát `apDungNhip(limiter, keyHash, thongDiep)`; `apDungNhipMaTran` giữ làm wrapper |
| `quota.ts` | preflight nhận `Promise<void>` |
| `routes/fleet.ts` | `POST /v1/fleet-plan`, `GET /healthz/fleet` |
| `health/phep-do.ts` | thành phần `fleet` |
| `env.ts`, `wrangler.toml`, `vitest.config.ts` | `FLEET_BASE`, `FLEET_RATE_LIMITER` (namespace `20260924`, `limit 2, period 60`); test `FLEET_BASE: 'https://fleet.test'` |
| `index.ts` | nối route |

## 5. Hạ tầng

### 5.1 Compose máy chủ (`infra/server/compose.yml`)

```yaml
  vroom:
    # Ghim digest của manifest list v1.15.0 (amd64 + arm64, `docker buildx imagetools inspect` 23/09/2026).
    image: ghcr.io/vroom-project/vroom-docker:v1.15.0@sha256:247d5683d6745c755d718a156d16b16aac80baccc276a003a68b986c13883b08
    restart: unless-stopped
    environment:
      VROOM_ROUTER: valhalla
    volumes:
      # Mount THƯ MỤC: entrypoint chép config.yml và touch access.log trong /conf.
      - ./vroom:/conf
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3000/fleet/health >/dev/null"]
      interval: 30s
      timeout: 5s
      retries: 3
    # KHÔNG có `ports:` — chỉ cloudflared nối tới vroom:3000 qua luật đường dẫn /fleet/ của hostname maps-route.
```

Không `depends_on: valhalla` có điều kiện: healthcheck Valhalla có `start_period` một giờ; VROOM chỉ nối
Valhalla khi có request nên khởi động độc lập được. `infra/server/vroom/access.log` vào `.gitignore`.

`infra/server/vroom/config.yml` (nguồn: `config.yml` mặc định của vroom-express, chỉ đổi các dòng dưới):

```yaml
cliArgs:
  geometry: false   # Worker tự lấy tuyến từng xe bằng /route (có câu chỉ dẫn); VROOM chỉ giải
  planmode: false
  threads: 2
  explore: 5
  limit: '256kb'
  logdir: '/conf'
  logsize: '20M'
  maxlocations: 40  # lớp chặn thứ hai sau Worker: 5 xe + 30 đơn ≤ 40 điểm
  maxvehicles: 5
  override: []      # request không đổi được cờ nào (không -g, không -c)
  path: ''
  port: 3000
  router: 'valhalla'
  timeout: 25000
  baseurl: '/fleet/'
routingServers:
  valhalla:
    auto:          { host: 'valhalla', port: '8002' }
    motor_scooter: { host: 'valhalla', port: '8002' }
    pedestrian:    { host: 'valhalla', port: '8002' }
```

### 5.2 Compose dev (`infra/dev/compose.yml`, profile `routing`)

Cùng image, `ports: ["127.0.0.1:${VROOM_PORT:-3000}:3000"]`, volume `./vroom:/conf`
(`infra/dev/vroom/config.yml` giống trên nhưng `threads: 1` để fixture ổn định). `scripts/routing-test.mjs`
dựng `valhalla` **và** `vroom`, chờ `GET /fleet/health` 200, truyền `--var FLEET_BASE:http://127.0.0.1:3000/fleet`
cho wrangler dev; `--capture` ghi thêm fixture (mục 9).

### 5.3 Đường từ Worker tới VROOM

- Tunnel `mapslibvn-db` → Public Hostname **thêm** luật: subdomain `maps-route`, domain
  `ai-solutions.io.vn`, **Path `^/fleet/`**, Service HTTP `vroom:3000`; kéo luật này **lên trên** luật
  `maps-route` hiện có. Việc tay của PHONG (mục 16). Không cần hostname, DNS hay Access application mới.
- `wrangler.toml`: `[vars] FLEET_BASE = "http://127.0.0.1:3000/fleet"`; `[env.production]`
  `FLEET_BASE = "https://maps-route.ai-solutions.io.vn/fleet"`; `ratelimits` thêm `FLEET_RATE_LIMITER`.
  Worker gửi cùng header Access (`routingHeaders`) vì cùng hostname.
- Kiểm: `curl -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" https://maps-route.<domain>/fleet/health`
  → 200; không header → 403/302; `…/status` vẫn là Valhalla; `https://api.<domain>/healthz/fleet` → `ok:true`.

### 5.4 Script và tài liệu vận hành

- `scripts/server-setup.mjs`: `up -d vroom` cùng lúc với valhalla, thêm bước 9 vào checklist in ra.
- `scripts/lib/server-env.mjs` `pullPlan()`: thêm `vroom` vào danh sách pull khi image pipeline dựng tại máy.
- `infra/server/README.md`: mục "Đội xe (spec 23/09/2026)": lệnh `up -d vroom`, luật Tunnel, cách kiểm, ghi chú Windows/WSL2 (bind mount `./vroom` chạy trên Docker Desktop; WSL2 mặc định cấp ~50 % RAM).
- `THIRD_PARTY_NOTICES.md`: VROOM (BSD-2-Clause — bộ giải đội xe, chạy như dịch vụ riêng, không liên kết mã).
- Docs `tu-host.md`: bảng thành phần thêm VROOM, đoạn cấu hình.

## 6. Gói core, web, React Native

### 6.1 Core (`packages/core`)

```ts
export interface FleetVehicle { id: string; start: [number, number]; end?: [number, number] | 'open';
  capacity?: number; max_jobs?: number; time_window?: [string, string]; }
export interface FleetJob { id: string; location: [number, number]; demand?: number; service_s?: number;
  priority?: number; time_windows?: [string, string][]; }
export interface FleetPlanOptions { vehicles: FleetVehicle[]; jobs: FleetJob[]; mode?: TravelMode; lang?: DirectionsLang; }
export interface FleetStop { job: string; arrival_s: number; arrival_at?: string; waiting_s: number; service_s: number; }
export interface FleetVehiclePlan extends DirectionsResponse { vehicle: string; jobs: string[]; stops: FleetStop[];
  load: number; finish_s: number; departure_at?: string; finish_at?: string; }
export interface FleetPlanResponse { mode: TravelMode; vehicles: FleetVehiclePlan[]; unassigned: { id: string }[];
  summary: { vehicles_used: number; jobs_assigned: number; jobs_unassigned: number; distance_m: number;
    duration_s: number; service_s: number; waiting_s: number }; attribution: string;
  engine?: { name: string; graph: string | null }; }
```

- `client.fleetPlan(opts)` → `post<FleetPlanResponse>('/v1/fleet-plan', body)`; `post()` sẵn có đã qua
  `requireNoPendingAck()` và ACK receipt như mọi lời gọi. Tham số `[lat, lng]` giữ nguyên (API cũng nhận `[lat, lng]`).
- `navigation/route-features.ts`: `RouteFeatureKind` thêm `'fleet'`; `fleetRouteFeatures(coords, { colors, active })`
  → LineString `properties: { kind: 'fleet', index, color, opacity }` (`opacity` 1, hoặc 0,35 cho xe không
  được chọn khi `active` là số); `decodeFleet(plan)` → `[number, number][][]` theo chỉ số xe (xe không có
  tuyến → mảng rỗng, giữ đúng chỉ số).
- `FLEET_COLORS = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00']` (bảng Okabe–Ito, phân biệt được với
  người mù màu; đúng 5 = trần xe).
- `size-limit` barrel core đang 15,45 kB / trần 16 kB: thêm hàm và bảng màu gần chắc vượt → nâng trần lên
  **17 kB** trong cùng commit, ghi số đo thật.

### 6.2 Web (`packages/web/src/routes-layer.ts`)

```ts
showFleet(plan: FleetPlanResponse, opts?: { active?: number | null; colors?: readonly string[]; markers?: boolean }): void;
```

- Source riêng `FLEET_SOURCE_ID = 'mapslibvn-fleet'`, hai layer `ROUTE_LAYER_IDS.fleetCasing` (trắng, 9 px) và
  `ROUTE_LAYER_IDS.fleetLine` (`line-color: ['get','color']`, `line-opacity: ['get','opacity']`, 6 px), chèn
  trước layer symbol đầu tiên như tuyến thường; dựng lại khi `style.load`.
- Bấm vào tuyến đội xe phát `routeClick` với `index` = chỉ số xe. `setActive(i)` khi đang ở chế độ đội xe
  làm mờ xe khác (đổi `opacity`, không đổi source). `setProgress` bỏ qua ở chế độ đội xe.
- Marker: mỗi điểm ghé của xe một `Marker({ color: màu xe })` tại `waypoints[i].snapped` (bỏ điểm đầu); `markers: false` để app tự vẽ.
- `show()` xoá dữ liệu đội xe và ngược lại — một lúc một chế độ. `clear()` xoá cả hai.
- Export `FLEET_SOURCE_ID`, `FLEET_COLORS`, kiểu mới qua `index.ts` và `umd.ts` (playground dùng `SDK.FLEET_COLORS`).
- `size-limit` web `dist/index.js` trần 15 kB — đo lại, nâng nếu cần, ghi số.

### 6.3 React Native (`packages/react-native`)

- `routes-store.ts`: snapshot thêm `fleet: { plan, active, colors } | null` và `fleetFeatures`; `showFleet()`
  đặt `response = null`; `show()`/`clear()` đặt `fleet = null`. `fleetFeatures` chỉ dựng lại khi `showFleet`
  hoặc `setActive` (cùng nguyên tắc B1: không đẩy lại qua cầu native mỗi lần định vị).
- `route-layers.tsx`: khi `snap.fleet` → `GeoJSONSource id="mapslibvn-fleet"` với hai `Layer` line
  (casing + line data-driven `['get','color']`/`['get','opacity']`), `onPress` → `onRouteClick(index)`,
  `Marker` màu xe tại từng điểm ghé (`testID="mapslibvn-fleet-marker"`).
- `map.tsx` `routes.showFleet(plan, opts)`; `index.ts` re-export kiểu và `FLEET_COLORS`.
- Test: `routes-store.test.ts`, `route-layers.test.tsx` (số layer, số marker, màu theo xe, bấm chọn xe),
  `map.test.tsx`. Thử một lần trên máy thật bằng app mẫu `examples/embed-rn` (PHONG, mục 16).
- `size-limit` RN 32 kB — đo lại.

Publish `@mapslibvn/core`, `web`, `react-native` (và `react` nếu bump lockstep như các lần trước) **0.13.0 → 0.14.0**.

## 7. Playground (`apps/docs/public/playground*.{html,js,css}`)

Tab Đội xe thêm mục **"Chia đơn cho nhiều xe — `POST /v1/fleet-plan`"** giữa "Tối ưu thứ tự điểm dừng" và
"Ma trận khoảng cách". Điểm 1 là kho chung (start của mọi xe); các điểm còn lại là đơn.

| Điều khiển | id | Ghi chú |
|---|---|---|
| Số xe | `fl-veh` (select 1–5, mặc định 2) | |
| Sức chứa mỗi xe | `fl-cap` (number, trống = không dùng) | |
| Khối lượng mỗi đơn | `fl-dem` (number, mặc định 1) | chỉ gửi khi có sức chứa |
| Dừng mỗi điểm (phút) | `fl-svc` (number, mặc định 5) | → `service_s` |
| Giờ xuất phát | `fl-dep` (`input type="time"`, trống = không ràng buộc giờ) | |
| Ca làm (giờ) | `fl-shift` (number, mặc định 8) | `time_window` = [hôm nay giờ xuất phát, + ca làm] múi `+07:00` |
| Kết thúc | `fl-end` (select: về kho / kết thúc ở đơn cuối) | `end` bỏ trống hoặc `"open"` |
| Khung giờ từng đơn | ô `.fl-tw` trên mỗi dòng điểm (placeholder `08:30-09:30`) | chỉ gửi khi có giờ xuất phát; có khung mà chưa có giờ xuất phát → lỗi hiển thị `Nhập giờ xuất phát để dùng khung giờ` |
| Nút | `fl-plan` "Chia đơn — /v1/fleet-plan" | |
| Kết quả | `fl-plan-msg`, `fl-plan-list` (mỗi xe một khối `.fl-veh` có ô màu `.fl-swatch`, danh sách điểm ghé kèm `arrival_s`/`arrival_at`, chờ), `fl-unassigned`, `fl-plan-req` (`POST /v1/fleet-plan` + body JSON) | JSON gần nhất vào `fl-json` chung |

- Vẽ bằng `map.routes.showFleet(plan, { markers: false })` (marker đánh số của tab vẫn là marker chung; đổi
  màu viền marker theo xe được giao). Bấm một khối xe → `routes.setActive(k)`. `fitBox` theo hợp bbox các xe.
- `playground-lib.js`: hằng `FLEET_MAX_VEHICLES = 5`, `FLEET_MAX_JOBS = 30` (kèm ghi chú nguồn), `NavPoint`
  thêm `tw?: string`, `fleetPlanRequest(input) → { ok, body } | { ok: false, error }`, `fleetSnippet()` thêm
  đoạn `client.fleetPlan()` + `map.routes.showFleet(plan)`.
- Lỗi 429 nói đúng nhịp: `Quá 2 lần/phút cho khoá này (khoá demo dùng chung) — đợi một phút…`.
- E2E `apps/docs/e2e/playground.spec.ts`: giả `POST **/v1/fleet-plan` bằng fixture `fleet-plan-q1.json`
  (mục 9), kiểm: body gửi có 2 xe và 5 đơn, hiện 2 khối xe với 2 màu khác nhau, tổng số điểm ghé = 5, layer
  `mapslibvn-fleet-line` có trên bản đồ, không lỗi JS.

## 8. Bảo vệ máy chủ: đo trước khi công bố

### 8.1 `pnpm smoke:fleet -- --confirm-production [--requests=5] [--rounds=3] [--p95-max=8000] [--busy-max=2000] [--ratio-max=2]`

`scripts/smoke-fleet.mjs` + `scripts/lib/smoke-fleet.mjs` (+ `.test.mjs`), dùng bộ 29 toạ độ đã kiểm nối
được ở `scripts/lib/smoke-matrix.mjs` (kho = Chợ Bến Thành), ACK receipt qua `postAndAck()` mới trong
`scripts/lib/receipt-ack.mjs`:

- **Bài E — cỡ gần tối đa**: 5 xe cùng kho, 28 đơn xe máy, không ràng buộc; N lượt cách **30 s** (nhịp 2/phút);
  mỗi lượt dịch kho 0,0001° × k để không trúng cache. Kiểm: 200, đủ 5 xe, `jobs_assigned = 28`, mỗi
  `routes[0].legs.length = jobs + 1`.
- **Bài E2 — có ràng buộc**: 2 xe, 8 đơn, sức chứa 5 / khối lượng 1, dừng 300 s, ca 08:00–12:00, hai đơn có
  khung giờ. Kiểm thêm: `arrival_at` tăng dần trong mỗi xe, `load ≤ 5`, đơn có khung giờ đến trong khung.
- **Bài F — chèn khách khác**: K vòng: 5 lượt `/v1/directions` lúc rảnh → bắn **2 bài E song song** + 5 lượt
  directions xen kẽ → nghỉ hết phút. Tổng ≤ 12 request/phút/khoá.

### 8.2 Ngưỡng nghiệm thu (chốt lại theo số đo, không đoán)

| Ngưỡng | Đề xuất |
|---|---|
| p95 bài E | < 8.000 ms |
| p95 bài E2 | < 5.000 ms |
| p95 directions lúc bận (bài F) | < 2.000 ms **tuyệt đối** và ≤ 2× lúc rảnh, vòng xấu nhất |
| Lỗi | 0 lỗi 5xx, 0 lỗi 429, 0 ACK trượt |

### 8.3 Nếu hụt

Thứ tự thử: (1) hạ trần đơn 30 → 20 và xe 5 → 3; (2) hạ nhịp 2 → 1/phút; (3) `threads` VROOM 2 → 1. Mỗi
lần đổi trần phải sửa hằng số, docs, site, playground-lib **cùng commit**. Số đo ghi
`docs/evidence/routing/2026-09-<ngày>-fleet.md`, ghi rõ **máy nào** (MacBook hay Ubuntu); dời máy chủ
(Windows i5-1340P) phải đo lại trước khi giữ trần.

## 9. Kiểm thử

- **Unit API** (không Postgres, không mạng; mock `https://fleet.test` và `https://routing.test` bằng `fetchMock`):
  `test/routing-fleet.test.ts` (kiểm từng luật 4.2, hai chế độ thời gian, `fleetVroomBody`, `fleetCacheUrl`
  làm tròn, `translateFleet` với fixture tay `fixtures/vroom/two-vehicles.json` có xe rỗi và đơn unassigned,
  `assembleFleetPlan`), `test/routing-vroom.test.ts` (bảng lỗi 4.5, Unfound → 404 gọi đúng tên đơn),
  `test/fleet-plan.test.ts` (route: 401; các 400 **không** đăng ký interceptor VROOM; 200 với VROOM giả +
  hai `/route` giả; 404; 503; `x-mlv-cache: hit`; xe rỗi vẫn có mặt), `test/fleet-time.test.ts`,
  `test/quota.test.ts` thêm ca preflight bất đồng bộ, `test/health-*` thêm `fleet`.
- **Tích hợp** (`pnpm test:routing`): `test-routing/fleet-plan.rtest.mjs` trên Valhalla + VROOM Quận 1:
  2 xe, 5 đơn mẫu → hoán vị đủ 5 đơn, mỗi xe ≤ 10, câu tiếng Việt; open-end → xe không có leg về kho; một đơn
  Vũng Tàu → 404; chế độ tuyệt đối → `arrival_at` đúng múi `+07:00`.
- **Fixture**: `--capture` ghi `apps/api/test/fixtures/vroom/q1-fleet.json` (VROOM thô) và
  `fixtures/valhalla/q1-fleet-route-{0,1}.json` (`/route` từng xe theo thứ tự VROOM trả).
  `test/routing-fixture-sync.test.ts` thêm ca: `assembleFleetPlan(q1-fleet, [route-0, route-1], p)` snapshot ra
  `packages/core/tests/fixtures/fleet-plan-q1.json` **và** `apps/docs/e2e/fixtures/fleet-plan-q1.json` — một nguồn cho core/web/RN/e2e.
- **Core/web/RN**: `client.fleet-plan.test.ts` (POST body đúng, `[lat, lng]` giữ nguyên), `route-features.test.ts`
  (`fleetRouteFeatures`, `decodeFleet` giữ chỉ số xe rỗi), `routes-layer.test.ts` (showFleet: source, 2 layer, màu,
  click → index xe, show() xoá fleet), RN như 6.3.
- **E2E docs** mục 7; **site**: `doi-dau.test.ts`, `e2e/trang.spec.ts` sửa chữ khoá.
- **Scripts**: `smoke-fleet.test.mjs` (kế hoạch bài, kiểm response, parse args), `receipt-ack` thêm test `postAndAck`.

## 10. Docs (`apps/docs/src/content/docs`)

- `doi-xe.md`: bảng đầu thêm hàng "Nhiều xe, chia đơn thế nào?" → `client.fleetPlan()`; mục **3 mới "Chia đơn
  cho cả đội"** (ví dụ web đầy đủ: kho, 2 xe, 6 đơn, sức chứa, khung giờ, `showFleet`, `setActive`, dẫn đường
  một xe bằng `navigation.start({ response: plan.vehicles[0] })`); mục React Native thêm `showFleet`; bảng Giới hạn
  thêm hàng "Đội xe: 1–5 xe, 1–30 đơn, ≤ 10 đơn mỗi xe, nhịp 2/phút/khoá, 1 lượt"; mục 5 "Chuyến có hơn 10 điểm dừng"
  đổi thành "dùng chia đơn"; mục 6 "Chưa có" còn: giao thông thời gian thực, theo dõi vị trí, **thêm** lấy hàng &
  giao hàng ghép đôi, kỹ năng tài xế / nghỉ giữa ca, nhiều loại xe trong một request.
- `api.md`: mục `POST /v1/fleet-plan` sau `/v1/optimized-route` (bảng trường, luật 4.2, hai chế độ giờ, ví dụ
  curl + JSON, ghi chú lệch ma trận/tuyến); đoạn quota: ba endpoint nặng, nhịp 6/phút cho hai cái cũ và
  **2/phút cho fleet-plan**; "Chín endpoint dữ liệu" → mười (fleet-plan là POST nên không nằm trong câu 405);
  bảng cache thêm hàng; đoạn `x-mlv-cache` và khoá cache thêm fleet-plan; bảng lỗi `no_route` thêm fleet-plan.
- `sdk.md`: hàng `fleetPlan(opts)` và tham số; `react-native.md`, `react.md` (nếu có mục routes): `routes.showFleet`.
- `tinh-nang.md`: đoạn Giao hàng thêm câu chia đơn đội xe; bỏ "Chưa có tối ưu đội xe nhiều xe".
- `tu-host.md`: VROOM. `thong-bao-ben-thu-ba.md` sinh từ `THIRD_PARTY_NOTICES.md` (không sửa tay).
- Spec `2026-09-22-…` mục 12 bullet đầu thêm "→ đã làm ở spec 2026-09-23-toi-uu-doi-xe".

## 11. Site (`apps/site`)

- `lib/doi-dau.ts`: `CHUA_CO` bỏ `'tối ưu đội xe nhiều xe'`; hàng Google "Tối ưu đội xe nhiều xe" → `ta`: "Có:
  tối đa 5 xe và 30 đơn mỗi lượt, sức chứa, khung giờ, thời gian dừng; một lượt Chỉ đường", `ho`: "Có (Route
  Optimization API), cỡ và ràng buộc rộng hơn", `thang: 'hoa'`; hàng "Cỡ và nhịp" thêm "5 xe / 30 đơn, 2 lượt mỗi
  phút" (ghi chú chép tay từ `FLEET_MAX_*`); hàng VIETMAP "Bài toán vận tải…": "Có ma trận, tối ưu thứ tự và chia
  đơn cho đội xe tới 5 xe; chưa theo dõi phương tiện" (vẫn `ho`).
- `pages/tinh-nang.astro` đoạn Giao hàng; `pages/index.astro` thẻ "Giao hàng & vận tải": chip `['Ma trận ≤ 50 cặp', 'Đội xe ≤ 5 xe · 30 đơn', '1 lượt Chỉ đường']`.
- `lib/doi-dau.test.ts` và `e2e/trang.spec.ts` sửa kỳ vọng.

## 12. Thứ tự làm và phát hành (trên `main`)

1. Dev: compose dev + VROOM, `routing-test.mjs` dựng VROOM, capture fixture — xác minh hình dạng response thật trước khi viết translate.
2. Worker: env, `vroom.ts`, `fleet-time.ts`, `fleet.ts`, nhịp, quota preflight, route, health, cron, Admin — unit test xanh.
3. Core (kiểu, client, features, màu, size-limit) → web → RN — test xanh, `pnpm typecheck`, `pnpm lint`.
4. Tích hợp `pnpm test:routing` xanh, fixture sync ra core + e2e.
5. Playground + e2e docs.
6. Smoke script + test.
7. Hạ tầng máy chủ: compose, config, README, server-setup/update, notices, .gitignore. Commit.
8. **PHONG**: trên MacBook (máy chủ chính) `git pull` + `docker compose … up -d vroom`; thêm luật Tunnel `/fleet/`; kiểm `…/fleet/health` qua Access.
9. **PHONG duyệt push** → CI deploy API (endpoint sống, chưa công bố) → kiểm `/healthz/fleet`, một request thật bằng `!curl`.
10. **PHONG chạy** `pnpm smoke:fleet -- --confirm-production --requests=5 --rounds=3` → evidence → chốt trần/nhịp (mục 8.3).
11. Docs + site + DEVLOG mục 34 + trạng thái spec → commit → PHONG duyệt push → **deploy docs tay đè** (CI xoá khoá demo) → `pnpm sdk:publish` 0.14.0 (OTP).
12. Cập nhật trí nhớ dự án: bố trí máy chủ, trần fleet.

## 13. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Một request cỡ tối đa (ma trận ≤ 1.600 cặp + 5 `/route`) chèn `/v1/directions` của khách khác | Nhịp 2/phút/khoá; bài F đo trước khi công bố; hụt → mục 8.3 |
| Số đo hôm nay là của MacBook; Ubuntu/Windows khác hẳn | Evidence ghi máy; dời máy đo lại; docs nói "trần theo máy chủ hiện tại" |
| VROOM báo lỗi định tuyến cho cả request khi một đơn không nối | 404 gọi tên đơn; docs chỉ cách dùng `/v1/matrix` 1×N để soát |
| Giờ đến (ma trận) lệch tuyến vẽ (`/route`) | Docs nói rõ; `stops` là lịch, `legs` là tuyến |
| Luật Tunnel đặt sai thứ tự → `/fleet/` rơi vào Valhalla → 404 | Bước kiểm 5.3 bắt buộc trước khi deploy Worker; `/healthz/fleet` đỏ nếu sai |
| Thành phần cron mới khởi đầu "hỏng" nếu deploy Worker trước khi bật VROOM | Thứ tự mục 12: VROOM và luật Tunnel (bước 8) trước deploy (bước 9) |
| Entrypoint VROOM ghi `access.log` vào thư mục repo trên máy chủ | `.gitignore`; `logsize` 20M |
| `size-limit` core/web/RN vượt | Nâng trần cùng commit, ghi số đo |
| Khoá `web` công khai bắn fleet-plan | Nhịp 2/phút theo khoá thuần + burst/trần nhóm directions |
| Body JSON lớn làm tốn CPU Worker | Chặn `content-length` > 64 KB trước khi đọc; đếm mảng trước khi parse sâu |
| VROOM nâng bản đổi hình dạng response | Ghim digest; `translateFleet` không đoán: thiếu `code`, `routes`, `steps` → 503; `--capture` chụp lại khi nâng |
| CI Deploy Docs xoá khoá demo | Bước 11 deploy docs tay đè |

## 14. Ngoài phạm vi và đường nâng cấp đã dự trù

- **Shipments** (lấy ở A giao ở B): VROOM có sẵn `shipments`; thêm khi có khách cần, cùng schema `pickup`/`delivery`.
- **Skills, breaks, nhiều profile trong một request**: passthrough VROOM, để sau.
- **Tính lượt theo xe**: khi `QuotaObject.reserve()` nhận `units`.
- **Plan mode (`-c`)**: đánh giá lịch có sẵn và báo vi phạm — hữu ích cho điều phối tay, để sau.
- **`snapped`/khoảng bám** cho đơn: khi có người cần phát hiện điểm bám xa.

## 15. Nghiệm thu

| # | Tiêu chí | Cách kiểm |
|---|---|---|
| 1 | `POST /v1/fleet-plan` trên production trả 200 với 2 xe/5 đơn mẫu, mỗi xe là `DirectionsResponse` hợp lệ, `order` hoán vị đủ | `!curl` + `pnpm smoke:fleet` bài E2 |
| 2 | Chế độ tuyệt đối: `arrival_at` trong khung giờ khách, `departure_at` trong ca | bài E2 |
| 3 | Bài E, E2, F đạt ngưỡng 8.2 hoặc trần đã hạ và docs khớp | evidence |
| 4 | 400 không tốn lượt (receipt không phát), 429 khi quá 2/phút | unit + `!curl` |
| 5 | `/healthz/fleet` xanh; cron báo 4 thành phần; Admin hiện ô Đội xe | production |
| 6 | Playground: chia đơn 2 xe, 2 màu, danh sách giờ đến, e2e xanh | e2e + PHONG thử tay |
| 7 | `routes.showFleet` chạy trên iOS/Android thật (app mẫu) | PHONG xác nhận |
| 8 | Docs/site không còn "chưa có tối ưu đội xe"; `CHUA_CO` 3 mục; test site xanh | build + e2e |
| 9 | npm 0.14.0 lên đủ ba gói, cài thật được | `pnpm sdk:publish` đối chiếu registry |

## 16. Việc tay của PHONG

1. Trên MacBook (máy chủ chính): `git pull` rồi `docker compose -f infra/server/compose.yml --env-file infra/server/.env up -d vroom`; `docker compose … ps` thấy `vroom` healthy.
2. Cloudflare Zero Trust → Networks → Tunnels → `mapslibvn-db` → Public Hostname → Add: subdomain `maps-route`,
   domain `ai-solutions.io.vn`, **Path** `^/fleet/`, Service HTTP `vroom:3000` → Save → kéo luật mới **lên trên**
   luật `maps-route` cũ.
3. Kiểm bằng `!curl` với hai header Access (đọc từ biến môi trường): `…/fleet/health` → 200; `…/status` vẫn JSON Valhalla.
4. Duyệt push để CI deploy API; `!curl https://api.ai-solutions.io.vn/healthz/fleet`.
5. `!pnpm smoke:fleet -- --confirm-production --requests=5 --rounds=3`, dán kết quả để ghi evidence.
6. Sau khi docs/site xong: duyệt push; deploy docs tay đè; `pnpm sdk:publish` với OTP.
7. Thử `routes.showFleet` trên iPhone/Android thật bằng app mẫu (`pnpm example:rn --pack-only`).
8. Khi dời máy chủ sang Windows: chạy lại smoke matrix + fleet, cập nhật evidence trước khi giữ trần.
