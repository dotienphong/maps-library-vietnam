# MapsLibVN — Thiết kế dẫn đường, spec A: engine chỉ đường và API `/v1/directions`

- Ngày: 2026-09-10
- Trạng thái: **Đã phát hành 11/09/2026**; nghiệm thu mục 11 đạt 5/7, hai dòng đạt một phần vì lý do ngoài mã (GitHub Actions bị khoá thanh toán; khoá `free` đã thu hồi ở audit 09/09) — xem `docs/evidence/routing/` và DEVLOG mục 12
- Chủ dự án: PHONG
- Tài liệu do Fable 5.1 viết
- Spec gốc: `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md` mục 1.3 ghi "Chỉ đường (routing/ETA) — cần Valhalla/OSRM riêng" là ngoài phạm vi MVP; spec này mở phạm vi đó
- Chuỗi spec dẫn đường: **A** engine + API (file này) → **B** logic dẫn đường trong core và SDK web (GPS, lệch tuyến, vẽ tuyến) → **C** SDK React Native (quyền, định vị nền, đọc chỉ dẫn). B và C có spec riêng, viết sau khi A nghiệm thu

## 0. Tóm tắt một đoạn

Thêm dịch vụ chỉ đường **Valhalla** tự host trên máy chủ nội bộ (cùng máy Postgres; đo 22/09/2026: 2 nhân, 3,7 GB RAM),
build graph từ file OSM Việt Nam mà pipeline tiles đã tải sẵn, phục vụ ba phương tiện **xe máy, ô tô,
đi bộ**. Worker có endpoint mới `GET /v1/directions` gọi Valhalla qua Cloudflare Tunnel + Access
service token (cùng mô hình với Postgres) và **dịch kết quả sang schema tuyến riêng của MapsLibVN**
để SDK không phụ thuộc engine. Gói core thêm `client.directions()` và kiểu dữ liệu tuyến. Không
map-matching, không ma trận ETA, không giao thông trực tiếp. Máy chủ chỉ tốn CPU lúc **tính tuyến**;
việc đi theo tuyến, bám GPS, phát hiện lệch đường sẽ chạy trên thiết bị (spec B), nên số người đang
dẫn đường cùng lúc không tạo tải cho máy chủ.

## 1. Mục tiêu, phạm vi, người dùng

### 1.1 Mục tiêu

1. App nhúng MapsLibVN gọi một endpoint là có tuyến đường kèm bước rẽ tiếng Việt cho xe máy, ô tô, đi bộ trong Việt Nam.
2. Hợp đồng API độc lập engine: đổi Valhalla sang engine khác, hay sau này tính tuyến trên client, **không đổi SDK**.
3. Chi phí vận hành vẫn 0 đ: dùng image mã nguồn mở, Tunnel/Access/Worker đang có, không thêm dịch vụ trả tiền.
4. Graph tự cập nhật cùng kỳ với tiles bằng lệnh `data:update` hiện có, có rollback.
5. Tái dùng toàn bộ hạ tầng khoá/quota/cache/đo lường/lỗi của API hiện tại.

### 1.2 Trong phạm vi spec A

- Service `valhalla` trong `infra/server/compose.yml`, build graph Việt Nam, ba costing `motor_scooter`, `auto`, `pedestrian`.
- Bước build/reload graph trong `scripts/data-update.mjs` và `scripts/data-rollback.mjs`; bước dựng lần đầu trong `scripts/server-setup.mjs`.
- Public hostname + Access application + service token cho Valhalla (việc tay, ghi README).
- `GET /v1/directions`, `GET /healthz/routing` trên Worker; module dịch Valhalla → schema MapsLibVN; quota nhóm `directions`; migration cột `quota_directions_per_day`.
- Gói core: `client.directions()`, kiểu `Route`/`RouteLeg`/`RouteStep`/`ManeuverKind`/`Waypoint`, hàm `decodePolyline6`.
- Fixture PBF một quận cho compose dev và test tích hợp; smoke production; trang docs; THIRD_PARTY_NOTICES.

### 1.3 Ngoài phạm vi spec A (có chỗ trong kiến trúc)

- Map-matching (bám chuỗi GPS vào đường trên máy chủ), ma trận ETA nhiều điểm, isochrone. Ma trận và tối ưu thứ tự điểm dừng đã có spec riêng 22/09/2026: `2026-09-22-ma-tran-toi-uu-thu-tu-design.md`.
- Giao thông trực tiếp, tránh phí, tránh cao tốc, giờ khởi hành, thời tiết.
- Ngôn ngữ ngoài `vi` và `en`.
- Máy trạng thái dẫn đường, GPS, lệch tuyến, vẽ tuyến, đọc chỉ dẫn (spec B, C).
- Tính tuyến trên client (đồ thị tĩnh trên R2); đã cân nhắc và để sau, xem mục 10.
- Build graph tách container (không gián đoạn) — nâng cấp sau nếu gián đoạn thứ Hai 02:00 thành vấn đề.

### 1.4 Người dùng

| Vai | Cần gì từ spec A |
|---|---|
| Dev nhúng (tenant) | Một hàm `directions()` trả tuyến + bước rẽ tiếng Việt; lỗi rõ ràng; quota biết trước |
| Người dùng cuối | Tuyến hợp lý cho xe máy (không lên cao tốc), ô tô, đi bộ; câu rẽ tiếng Việt đọc được |
| Admin (PHONG) | Graph tự cập nhật, rollback, health check, số đo RAM/thời gian build ghi lại |

### 1.5 Quyết định đã chốt (10/09/2026)

| Quyết định | Chọn | Lý do ngắn |
|---|---|---|
| Nơi tính tuyến | Máy chủ (Valhalla), không phải client | Chuẩn ngành, ít rủi ro, chất lượng có cộng đồng bảo trì; tìm đường không phải điểm khác biệt của MapsLibVN. Client có thể thêm sau qua giao diện nhà cung cấp tuyến (mục 10) |
| Engine | Valhalla, không OSRM | Ba phương tiện trong một tiến trình, có costing xe máy, có locale `vi-VN`, image chính thức arm64 chạy được Docker Desktop trên Mac |
| Phương tiện bản đầu | Xe máy, ô tô, đi bộ | Xe máy là phương tiện chính ở VN; xe đạp để sau |
| Phạm vi API | Chỉ directions | Gọn nhất; bám GPS làm ở thiết bị (spec B) |
| Build graph | Một container tự build rồi phục vụ | Ít mã nhất; gián đoạn vài chục phút lúc 02:00 thứ Hai chấp nhận được ở giai đoạn nội bộ |
| Định dạng trả về | Schema riêng MapsLibVN, Worker dịch | Mục tiêu 5 của spec gốc: không phụ thuộc nhà cung cấp |
| Hình tuyến | polyline6 | Nhẹ hơn GeoJSON nhiều lần; core có hàm giải mã |
| Quota | Nhóm riêng `directions`, cột riêng trong `api_key`; burst riêng 20/phút/khoá+IP; trần 100/phút theo khoá cho mọi khoá `web`/`mobile` kể cả plan internal (quyết định 10/09 sau review bảo mật) | Một lượt tính tuyến đắt hơn một lượt tìm kiếm; khoá web/mobile nằm công khai trong HTML/app (khoá demo docs) nên không được miễn; dùng Rate Limiting thay KV vì Workers Free chỉ 1.000 ghi KV/ngày |
| Scope | Dùng lại `places:read` | Không thêm scope ở bản này để không đụng quy trình cấp khoá; tách khi thương mại hoá |

## 2. Tiền đề kỹ thuật đã xác minh (10/09/2026)

- Valhalla có file ngôn ngữ `locales/vi-VN.json` (kèm `.po`). Chất lượng bản dịch **chưa kiểm**; spec B quyết có sửa hay không.
- Image chính thức: `ghcr.io/valhalla/valhalla-scripted:3.8.3` (entrypoint kịch bản `/valhalla/scripts/docker-entrypoint.sh build_tiles`, gộp từ dự án `docker-valhalla` đã archive 03/2026); manifest có cả `amd64` và `arm64` (kiểm bằng `docker manifest inspect` 10/09). Cổng 8002. Volume `/custom_files` chứa PBF, `valhalla.json`, `valhalla_tiles.tar`, thư mục tile `valhalla_tiles/`, `admins.sqlite`, `timezones.sqlite`, `file_hashes.txt`. Biến môi trường chính: `serve_tiles`, `use_tiles_ignore_pbf` (mặc định `True`: có tar hoặc thư mục tile thì phục vụ ngay, bỏ qua PBF), `force_rebuild`, `server_threads`, `build_elevation`, `build_admins`, `build_time_zones`, `build_tar`, `tileset_name`. **Lưu ý đã đọc mã `configure_valhalla.sh`:** "hash" trong `file_hashes.txt` là sha256 của **đường dẫn file**, không phải nội dung — ghi đè PBF cùng tên không kích hoạt build lại. Build lại chỉ xảy ra khi không có tar **và** thư mục tile rỗng, hoặc `force_rebuild=True`. `build_tar=True` chỉ tạo tar khi chưa có tar. Vì vậy cách kích hoạt build lại tin cậy là **đổi tên tar hiện tại đi (giữ làm bản trước) và xoá thư mục tile**, rồi khởi động lại entrypoint (mục 4.4).
- `/status` (không cần `verbose`) trả `version`, `tileset_last_modified` (UNIX giây) và `available_actions`; `verbose=true` mới cần `service_limits.status.allow_verbose`. Không cần verbose cho nhu cầu của spec này.
- JSON gốc của `/route`: `legs[].shape` luôn là polyline6; `shape_format` chỉ áp dụng cho `format=osrm`. `alternates` không hỗ trợ khi có hơn 2 điểm. `trip.locations[]` trả lại toạ độ **gốc** kèm `original_index`/`side_of_street`, không có toạ độ đã bám và không có tên đường trừ khi request gửi `street`.
- Fixture PBF có sẵn: `pipelines/poi/fixtures/q1.osm.pbf` (2,1 MB, cắt `-s smart` từ PBF Việt Nam, 13.436 way có `highway`, kiểm bằng `osmium tags-filter` 10/09) — đủ để build graph mini cho test tích hợp, không cần cắt fixture mới.
- Costing có sẵn: `auto`, `motor_scooter`, `motorcycle`, `pedestrian`, `bicycle`, `truck`, `bus`, `taxi`… Xe máy dùng `motor_scooter` (tránh cao tốc, ưu tiên đường nhỏ, đúng luật VN cấm xe máy lên cao tốc).
- Mã maneuver Valhalla: số nguyên 0–43 (`kNone`…`kBuildingExit`). Không có đường → HTTP 400 với `error_code` 442; điểm quá xa mạng đường → 171; vượt khoảng cách → 154.
- Máy chủ: ~~16 GB RAM~~ — **đo lại 22/09/2026 trên chính máy chủ Ubuntu: 2 nhân, 3,7 GB RAM tổng.** Con số 16 GB ở đây là giả định lúc viết spec (10/09) khi còn định chạy trên MacBook; máy chủ thật nhỏ hơn nhiều. Postgres `shared_buffers` = 25 % RAM. File PBF Việt Nam đã có tại `pipeline-work:/app/work/data/sources/vietnam.osm.pbf` (`pipelines/tiles/src/lib/env.mjs`). Image pipeline có `osmium-tool` để cắt fixture.
- Worker gọi máy chủ nhà hiện qua Hyperdrive → Access → Tunnel `mapslibvn-db` (`infra/server/README.md` mục 1–4). Valhalla dùng cùng tunnel, thêm public hostname loại HTTP.
- **Chưa có số**: thời gian build graph Việt Nam, RAM đỉnh lúc build, dung lượng tar, p95 tính tuyến. Plan phải đo và ghi `docs/evidence/routing/`.

## 3. Kiến trúc

```
 SDK (web / RN)  ──X-Api-Key──▶  Worker apps/api
                                 GET /v1/directions
                                 ├─ requireAuth('places:read')  quotaMiddleware('directions')
                                 ├─ validate + giới hạn khoảng cách theo mode
                                 ├─ Cache API (tươi 60 s, stale 300 s)
                                 ├─ fetch ROUTING_BASE/route  (CF-Access-Client-Id/Secret)
                                 │      │  HTTPS → Tunnel mapslibvn-db → cloudflared → valhalla:8002
                                 └─ translate(valhalla.json) → schema MapsLibVN → JSON

 Máy chủ nội bộ (compose)
   postgres ── (không liên quan)      valhalla ──/custom_files── volume valhalla-data
   pipeline ── data:update ─── chép vietnam.osm.pbf + cờ reload ──▶ valhalla-data
```

Nguyên tắc: SDK **không bao giờ** gọi thẳng Valhalla; mọi thứ đi qua Worker để có khoá, quota, cache, đo lường và schema ổn định. Không có gì chạm Postgres trong đường đi này.

## 4. Máy chủ: service `valhalla`

### 4.1 compose

Thêm vào `infra/server/compose.yml`:

- `image: ghcr.io/valhalla/valhalla-scripted:3.8.3@sha256:24ef7955899dececb94e26c6dfb89d64fabfae875f980432694b0261eb6c251b` (bản phát hành 25/07/2026, mới nhất lúc viết spec; ghim digest để tag bị đẩy lại không đổi được bản chạy).
- `volumes: valhalla-data:/custom_files` và `./valhalla/run.sh:/opt/mapslibvn/run.sh:ro`.
- `entrypoint: ["/bin/bash", "/opt/mapslibvn/run.sh"]` (kịch bản bọc, mục 4.3; phải ghi đè `entrypoint`, không phải `command`, vì ENTRYPOINT gốc của image nhận `command` làm tham số).
- `environment`: `serve_tiles=True`, `use_tiles_ignore_pbf=True` (mặc định: có tar thì phục vụ ngay; build lại do mục 4.4 kích hoạt bằng cách dời tar và xoá thư mục tile), `force_rebuild=False`, `server_threads=4`, `build_elevation=False`, `build_admins=True`, `build_time_zones=True`, `build_tar=True`, `tileset_name=valhalla_tiles`.
- `restart: unless-stopped`; `healthcheck` gọi `curl -f http://localhost:8002/status`.
- **Không có `ports:`**, cùng nguyên tắc với Postgres. Chỉ `cloudflared` nối tới `valhalla:8002` trong mạng compose.
- `mem_limit` không đặt ở bản đầu; đo trước rồi quyết ở plan (mục 9).

Volume mới `valhalla-data` khai báo ở khối `volumes:`. Service `pipeline` gắn thêm `valhalla-data:/app/valhalla` để chép PBF và ghi cờ.

### 4.2 Build lần đầu (`pnpm server:setup`)

Thêm bước sau "Khởi động dịch vụ": nếu `valhalla-data` chưa có `valhalla_tiles.tar`, chạy trong container pipeline `node scripts/routing-graph.mjs prepare` (chép `vietnam.osm.pbf` sang `/app/valhalla/vietnam.osm.pbf` nếu chưa có hoặc khác hash) rồi in hướng dẫn: "Valhalla đang build graph lần đầu, theo dõi bằng `docker compose logs -f valhalla`; `/status` trả 200 là xong". Setup **không chờ** build xong (có thể vài chục phút) để không chặn phần còn lại; checklist cuối in kèm bước tay mục 4.5.

Nếu chưa có PBF (máy chủ mới chưa chạy pipeline lần nào), bước này chạy `pipelines/tiles/src/download.mjs` trước.

### 4.3 Kịch bản bọc `infra/server/valhalla/run.sh`

Lý do: entrypoint gốc chỉ kiểm tra hash PBF **lúc khởi động**; pipeline không có Docker socket để khởi động lại container khác (và không nên có). Kịch bản bọc:

1. Chạy entrypoint gốc của image ở nền (build nếu cần rồi `valhalla_service`).
2. Vòng lặp mỗi 30 giây kiểm tra file `/custom_files/reload.request`.
3. Thấy cờ: xoá cờ, gửi TERM cho tiến trình entrypoint và `valhalla_service`, chờ thoát, quay lại bước 1. Entrypoint thấy hash PBF đổi thì build lại rồi phục vụ; không đổi thì phục vụ ngay (trường hợp rollback, mục 4.4).
4. Ghi log ra stdout theo dạng `[run.sh] …` để `docker compose logs valhalla` đọc được.

Kịch bản ~45 dòng bash. Không viết test tự động cho nó; kiểm bằng checklist tay trong plan (tạo cờ, xem log, `/status` quay lại 200). Entrypoint chạy qua `setsid` và bị dừng theo **cả nhóm tiến trình**, để cờ tới giữa lúc build không để sót `valhalla_build_tiles` chạy mồ côi (hai build chồng nhau làm hỏng graph). Nếu entrypoint thoát mà **không** có cờ (build lỗi, OOM), kịch bản ngủ 10 phút rồi thoát cùng mã lỗi để Docker `restart: unless-stopped` khởi động lại — tránh vòng lặp build liên tục; quay về graph cũ bằng `rollback` (mục 4.4). Nếu entrypoint gốc không hợp tác (ví dụ không tôn trọng TERM hoặc ghi hash ở chỗ khác), phương án dự phòng là `tecnativa/docker-socket-proxy` chỉ cho phép `POST /containers/{id}/restart` — quyết định ở plan nếu rơi vào ca này, ghi DEVLOG.

### 4.4 Cập nhật và rollback

`scripts/routing-graph.mjs` (chạy trong container pipeline, checkJs như mọi script) có ba lệnh:

- `prepare`: tính md5 PBF nguồn `MAPSLIBVN_WORK/data/sources/vietnam.osm.pbf`; nếu trùng `graph.json.pbfMd5` và đã có tar thì dừng (idempotent, trừ `--force`). Ngược lại: dời `valhalla_tiles.tar` hiện có sang `prev/valhalla_tiles.tar` (ghi đè bản prev cũ hơn) cùng `prev/graph.json`, xoá thư mục tile `valhalla_tiles/`, chép PBF sang `/app/valhalla/vietnam.osm.pbf`, ghi `graph.json` `{ pbfMd5, pbfDate, requestedAt, previous }`, ghi cờ `reload.request` nội dung `rebuild`. Container thấy cờ → khởi động lại entrypoint → không có tar và thư mục tile rỗng → build → tar (mục 2). Dời tar (rename) trong khi `valhalla_service` còn chạy là an toàn vì file đã mở vẫn đọc được.
- `rollback`: cần `prev/valhalla_tiles.tar`; đổi chỗ tar hiện tại ↔ prev (và `graph.json` ↔ `prev/graph.json`), ghi cờ `reload.request` nội dung `rollback`. Container khởi động lại → có tar → phục vụ ngay không build (`use_tiles_ignore_pbf=True`). Không có prev → lỗi rõ. Không giữ PBF cũ (graph đã đủ trong tar).
- `status`: in `graph.json` và kích cỡ tar; dùng cho checklist và evidence.
- `admins.sqlite`/`timezones.sqlite` chỉ build lần đầu (`build_admins=True` không rebuild khi file đã có); ranh giới hành chính đổi rất hiếm, chấp nhận. Muốn làm lại thì xoá hai file đó trước khi `prepare`.

`scripts/data-update.mjs`: sau khối tiles (khi `work.tiles` và PBF thật sự đổi), thêm bước `run('node', ['scripts/routing-graph.mjs', 'prepare'])`. Cờ `--tiles`/`--poi` giữ nguyên nghĩa; thêm `--skip-routing` để bỏ qua. Manifest KV `release:current` **không** ghi graph (graph không phải file trên R2; SDK không cần biết phiên bản graph). Phiên bản graph xem qua `/healthz/routing`.

`scripts/data-rollback.mjs`: thêm bước gọi `routing-graph.mjs rollback` sau khi rollback tiles, có cờ `--skip-routing`.

Trong lúc build (vài chục phút), `valhalla_service` không chạy → Worker trả `503 upstream_unavailable` với `retry-after: 30`. Khung giờ trùng pipeline tiles thứ Hai 02:00 (`scripts/cron.mjs`).

### 4.5 Việc tay trên Cloudflare (ghi vào `infra/server/README.md`)

1. Access → Service Auth → Create Service Token `routing` (thời hạn dài nhất) → lưu Client ID/Secret. Token hết hạn → `/healthz/routing` 503, log Worker `valhalla 403` → tạo token mới, đặt lại secret.
2. Access → Applications → Add → Self-hosted `mapslibvn-route`, domain `maps-route.<domain>` → Policy Service Auth, include Service Token `routing`.
3. **Chỉ sau khi có Access application:** Zero Trust → Networks → Tunnels → `mapslibvn-db` → Public Hostname → Add: subdomain `maps-route`, domain `<domain>`, Service type **HTTP**, URL `valhalla:8002`. Làm ngược thứ tự là Valhalla công khai trên Internet trong lúc chưa có Access.
4. `wrangler secret put ROUTING_ACCESS_CLIENT_ID --env production`, `wrangler secret put ROUTING_ACCESS_CLIENT_SECRET --env production`; `ROUTING_BASE=https://maps-route.<domain>` vào `vars` production trong `wrangler.toml`.
5. Kiểm: `curl -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" https://maps-route.<domain>/status` trả JSON; không header → 403 từ Access.

## 5. API Worker

### 5.1 `GET /v1/directions`

Middleware: `requireAuth('places:read')`, `quotaMiddleware('directions')` (mục 5.5), `analyticsMiddleware` sẵn có.

Tham số query:

| Tham số | Bắt buộc | Dạng | Ghi chú |
|---|---|---|---|
| `from` | có | `lat,lng` | 5–7 chữ số thập phân là đủ |
| `to` | có | `lat,lng` | |
| `via` | không | `lat,lng;lat,lng…` | tối đa **5** điểm |
| `mode` | không | `motorbike` \| `car` \| `walk` | mặc định `motorbike` |
| `lang` | không | `vi` \| `en` | mặc định `vi`; ánh xạ `vi-VN`, `en-US` |
| `alternatives` | không | `0` \| `1` | mặc định `0`; `1` = xin thêm tối đa 1 tuyến thay thế |

Kiểm tra ở Worker **trước khi gọi Valhalla** (không tốn máy chủ nhà cho request sai):

- Toạ độ hợp lệ và nằm trong hộp Việt Nam mở rộng (lat 8–24, lng 102–110). Ngoài hộp → `400 invalid_request` "Chỉ hỗ trợ trong Việt Nam".
- Khoảng cách đường chim bay lớn nhất giữa hai điểm liên tiếp và tổng theo mode: xe máy ≤ 500 km, ô tô ≤ 2.000 km, đi bộ ≤ 50 km. Vượt → `400 invalid_request` kèm giới hạn trong message.
- Tổng điểm (from + via + to) ≤ 7.

Gọi Valhalla `POST {ROUTING_BASE}/route` body:

```json
{
  "locations": [{"lat":…,"lon":…,"type":"break"}, …],
  "costing": "motor_scooter" | "auto" | "pedestrian",
  "directions_options": {"language":"vi-VN","units":"kilometers"},
  "alternates": 1,
  "id": "<request_id của Worker>"
}
```

`alternates` chỉ gửi khi `alternatives=1` **và** không có `via`. Không gửi `shape_format` (chỉ dành cho `format=osrm`; JSON gốc luôn polyline6).

Header `CF-Access-Client-Id`/`CF-Access-Client-Secret` khi hai secret có mặt (production); dev không có → gọi thẳng `http://localhost:8002`. Timeout **10 s** bằng `AbortSignal.timeout`.

Tham số `costing_options` bản đầu để mặc định Valhalla; tinh chỉnh (ví dụ `motor_scooter.use_hills`, `auto.use_tolls`) là việc của spec sau khi có phản hồi tuyến thực tế, không đoán trước.

### 5.2 Schema trả về (schema MapsLibVN, không lộ trường Valhalla)

```json
{
  "routes": [
    {
      "mode": "motorbike",
      "distance_m": 12840,
      "duration_s": 1710,
      "bbox": [106.62, 10.75, 106.71, 10.81],
      "geometry": "<polyline6>",
      "legs": [
        {
          "distance_m": 12840,
          "duration_s": 1710,
          "steps": [
            {
              "kind": "turn_left",
              "instruction": "Rẽ trái vào Nguyễn Văn Trỗi.",
              "verbal_pre": "Trong 200 mét, rẽ trái vào Nguyễn Văn Trỗi.",
              "verbal_post": "Đi tiếp 1,2 ki-lô-mét.",
              "street_names": ["Nguyễn Văn Trỗi"],
              "distance_m": 1200,
              "duration_s": 160,
              "shape_begin": 14,
              "shape_end": 37,
              "location": [106.667, 10.792],
              "roundabout_exit": null
            }
          ]
        }
      ],
      "flags": { "toll": false, "highway": false, "ferry": false }
    }
  ],
  "waypoints": [
    { "location": [106.7, 10.776], "snapped": [106.7002, 10.7761], "name": null }
  ],
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "valhalla", "graph": "2026-09-15" }
}
```

Quy ước:

- Toạ độ `[lng, lat]` (GeoJSON) ở mọi nơi trong response, kể cả `location`/`snapped`; **tham số vào** vẫn `lat,lng` cho khớp `/v1/nearby`, `/v1/reverse`. Ghi rõ trong docs, đây là chỗ dễ nhầm.
- `geometry` là polyline6 **của cả tuyến**; `legs[].steps[].shape_begin/shape_end` là chỉ số điểm trong polyline của **leg** (Valhalla trả shape theo leg). Worker nối shape các leg thành một polyline tuyến và **dịch chỉ số** để `shape_begin/shape_end` trỏ vào polyline tuyến; leg giữ thêm `shape_offset` để ai cần vẫn tách được. Quyết định này để spec B chỉ giải mã một chuỗi.
- `distance_m` nguyên (mét), `duration_s` nguyên (giây); Valhalla trả km số thực → nhân 1000 làm tròn.
- `kind` (`ManeuverKind`) là tập cố định của MapsLibVN, ánh xạ từ mã 0–43 của Valhalla:

| `kind` | Mã Valhalla |
|---|---|
| `depart` | 1, 2, 3 |
| `arrive` | 4, 5, 6 |
| `continue` | 7, 8, 22 |
| `slight_right` / `slight_left` | 9 / 16 |
| `turn_right` / `turn_left` | 10 / 15 |
| `sharp_right` / `sharp_left` | 11 / 14 |
| `uturn_right` / `uturn_left` | 12 / 13 |
| `ramp_straight` / `ramp_right` / `ramp_left` | 17 / 18 / 19 |
| `exit_right` / `exit_left` | 20 / 21 |
| `keep_right` / `keep_left` | 23 / 24 |
| `merge` / `merge_right` / `merge_left` | 25 / 37 / 38 |
| `roundabout_enter` / `roundabout_exit` | 26 / 27 |
| `ferry_enter` / `ferry_exit` | 28 / 29 |
| `elevator` / `steps` / `escalator` / `building_enter` / `building_exit` | 39 / 40 / 41 / 42 / 43 |
| `other` | 0, 30–36 (transit, không dùng) và mọi mã lạ |

- `roundabout_exit`: số lối ra khi `kind = roundabout_enter` (Valhalla `roundabout_exit_count`), còn lại `null`.
- `verbal_pre`/`verbal_post` lấy từ `verbal_pre_transition_instruction`/`verbal_post_transition_instruction`; thiếu → `null`. Spec B dùng để đọc bằng giọng nói.
- `waypoints[].location` là toạ độ người dùng gửi; `waypoints[].snapped` là điểm đầu leg tương ứng trong polyline đã nối (điểm cuối tuyến cho waypoint cuối) — Valhalla không trả toạ độ đã bám riêng. `waypoints[].name` luôn `null` ở bản này (Valhalla không trả tên đường cho location); giữ trường để sau điền bằng reverse geocode nếu cần.
- `engine.graph` là ngày build graph (`graph_built_at` của mục 5.6, cắt còn `YYYY-MM-DD`), Worker lấy từ `/status` và cache 5 phút trong `caches.default`; không có → `null`. Trường `engine` là thông tin chẩn đoán, docs ghi rõ **không phải hợp đồng ổn định**.
- `alternatives=1` → `routes` có tối đa 2 phần tử, phần tử đầu là tuyến chính. Khi có `via`, `alternatives` bị bỏ qua (Valhalla chỉ tính tuyến thay thế cho hai điểm); docs ghi rõ.
- Nối shape các leg: điểm cuối leg i trùng điểm đầu leg i+1, Worker bỏ điểm trùng và dịch chỉ số theo đó.

### 5.3 Lỗi

| Tình huống | HTTP | `code` | Ghi chú |
|---|---|---|---|
| Thiếu/sai tham số, ngoài hộp VN, vượt khoảng cách, quá điểm | 400 | `invalid_request` | message nói rõ giới hạn |
| Valhalla HTTP 400 với `error_code` 442/441 (không có đường, điểm không tới được), 170/171 (vùng không kết nối, điểm quá xa mạng đường) | 404 | `no_route` | `message` tiếng Việt phân biệt hai ca; không thêm trường mới vào body lỗi |
| Valhalla HTTP 400 khác (154 vượt max distance của engine, v.v.) | 400 | `invalid_request` | message ghi mã Valhalla, không lộ message thô; log server có |
| Valhalla không trả lời, timeout 10 s, body không phải JSON, mọi HTTP status khác 400 (302 redirect Access, 401/403 token sai hoặc hết hạn, 404/405 sai đường dẫn, 5xx), đang build, chưa cấu hình `ROUTING_BASE` | 503 | `upstream_unavailable` | `retry-after: 30` (đã có sẵn trong `errorResponse`); chỉ HTTP 400 mới là lỗi của người gọi |
| Quota ngày / burst | 429 | `quota_exceeded` / `rate_limit_exceeded` | cơ chế sẵn có |

`no_route` là mã lỗi mới trong `apps/api/src/errors.ts` và trong bảng lỗi docs `api.md` mục 2.

### 5.4 Cache

Dùng `cachedJson()` sẵn có (`apps/api/src/cache.ts`): khoá `https://cache.mapslibvn/directions?<tham số chuẩn hoá>` với toạ độ làm tròn 5 chữ số, `mode`/`lang`/`alternatives`/`via` chuẩn hoá thứ tự. Tươi 60 s, stale 300 s (stale-if-error: Valhalla đang build vẫn trả tuyến vừa tính cho request trùng). Kỳ vọng tỷ lệ trúng thấp; giá trị chính là chống gọi lặp khi client retry và khi nhiều người đi cùng tuyến phổ biến trong cùng phút.

### 5.5 Quota, giới hạn, đo lường

- `quotaMiddleware` mở rộng nhận `group: 'places' | 'directions'`; giới hạn ngày lấy từ `auth.quotaDirectionsPerDay ?? FREE_DIRECTIONS_PER_DAY` với `FREE_DIRECTIONS_PER_DAY = 2_000`. Tenant `internal` không đếm KV (như hiện tại — Workers Free chỉ cho 1.000 ghi KV/ngày, ngân sách dùng chung với auth cache và manifest; đếm KV cho một khoá công khai là để kẻ tấn công làm cạn ngân sách đó). Khoá KV `quota:<keyHash>:<ngày VN>:directions`.
- Migration `0012_api_key_quota_directions.sql` (+ `.down.sql`): `ALTER TABLE api_key ADD COLUMN IF NOT EXISTS quota_directions_per_day int;` `scripts/api-key-issue.mjs` thêm cờ `--quota-directions`. `loadAuth` đọc cột mới bằng `(to_jsonb(k) ->> 'quota_directions_per_day')::int` thay vì tham chiếu cột trực tiếp, nên câu SQL **chạy được cả khi cột chưa tồn tại** (trả NULL → dùng mặc định plan). Nhờ vậy deploy Worker và áp migration độc lập thứ tự, tránh lặp lại sự cố 06–07/09 "deploy trước migration làm chết API"; migration được áp ở lần `pnpm server:update` kế tiếp. `test:api-db` (Postgres thật) phải có ca kiểm câu SQL này ở cả hai trạng thái không thực tế được, nên chỉ kiểm sau migration; trạng thái "chưa có cột" kiểm bằng unit test SQL shape (fake sql) xác nhận không có chuỗi `k.quota_directions_per_day`.
- Burst và trần theo khoá (quyết định PHONG 10/09/2026 sau review bảo mật, thay cho ý ban đầu "dùng lại `PLACES_RATE_LIMITER`"): hai Rate Limiting binding mới trong `[env.production]` — `DIRECTIONS_RATE_LIMITER` 20 request/phút/colo theo khoá+IP (Valhalla đắt hơn Postgres), và `DIRECTIONS_KEY_RATE_LIMITER` 100 request/phút/colo theo **khoá thuần** (mọi IP cộng lại) áp cho mọi khoá `web`/`mobile` **kể cả plan internal**; khoá `server` không chịu trần này. Lý do: khoá web/mobile nằm công khai trong HTML/app (khoá demo docs là khoá web của tenant internal), không có trần thì ai lấy được là dùng Valhalla không giới hạn. Vượt → `429 rate_limit_exceeded`, `retry-after: 60` (cơ chế sẵn có). Dev/test không có binding → bỏ qua.
- Analytics: `analyticsMiddleware` sẵn có ghi pathname `/v1/directions`; thêm `stageHit` = -1 (route khác) như hiện tại. Không thêm cột.

### 5.6 `GET /healthz/routing`

Không cần khoá (như `/healthz/db`). Gọi `{ROUTING_BASE}/status` (không verbose) với header Access, timeout 5 s; trả `{ ok, version, graph_built_at, ms }`, trong đó `graph_built_at` là ISO của `tileset_last_modified` (UNIX giây) mà Valhalla trả; vắng → `null`. Valhalla không trả lời hoặc chưa cấu hình → 503. `pbfDate` trong `graph.json` (mục 4.4) chỉ dùng cho lệnh `status` trên máy chủ và evidence, Worker không đọc file đó.

### 5.7 Biến môi trường và secret (`apps/api/src/env.ts`)

- `ROUTING_BASE: string` (var; dev `http://127.0.0.1:8002`, production `https://maps-route.<domain>`).
- `DIRECTIONS_RATE_LIMITER?`, `DIRECTIONS_KEY_RATE_LIMITER?` (Rate Limiting binding, chỉ production; `namespace_id` khác nhau: 20260911, 20260912).
- `ROUTING_ACCESS_CLIENT_ID?`, `ROUTING_ACCESS_CLIENT_SECRET?` (secret production; vắng cả hai → gọi không header, dành cho dev/test).
- Vắng `ROUTING_BASE` → `/v1/directions` và `/healthz/routing` trả `503 upstream_unavailable` "Chưa cấu hình routing". API còn lại không ảnh hưởng.
- Header Access **chỉ gửi khi `ROUTING_BASE` là https** (không bao giờ đưa service token qua http dù cấu hình nhầm); fetch tới Valhalla dùng `redirect: 'manual'` để 302 của Access không kéo Worker tới URL khác rồi parse HTML.

## 6. Gói core (`packages/core`)

`types.ts` thêm:

```ts
export type TravelMode = 'motorbike' | 'car' | 'walk';
export type ManeuverKind =
  | 'depart' | 'arrive' | 'continue'
  | 'slight_right' | 'slight_left' | 'turn_right' | 'turn_left' | 'sharp_right' | 'sharp_left'
  | 'uturn_right' | 'uturn_left'
  | 'ramp_straight' | 'ramp_right' | 'ramp_left' | 'exit_right' | 'exit_left'
  | 'keep_right' | 'keep_left' | 'merge' | 'merge_right' | 'merge_left'
  | 'roundabout_enter' | 'roundabout_exit' | 'ferry_enter' | 'ferry_exit'
  | 'elevator' | 'steps' | 'escalator' | 'building_enter' | 'building_exit'
  | 'other';

export interface RouteStep {
  kind: ManeuverKind;
  instruction: string;
  verbal_pre: string | null;
  verbal_post: string | null;
  street_names: string[];
  distance_m: number;
  duration_s: number;
  /** Chỉ số điểm trong polyline của cả tuyến (đã dịch qua các leg). */
  shape_begin: number;
  shape_end: number;
  /** [lng, lat] điểm bắt đầu bước. */
  location: [number, number];
  roundabout_exit: number | null;
}
export interface RouteLeg {
  distance_m: number;
  duration_s: number;
  /** Chỉ số điểm đầu của leg trong polyline tuyến. */
  shape_offset: number;
  steps: RouteStep[];
}
export interface Route {
  mode: TravelMode;
  distance_m: number;
  duration_s: number;
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  /** polyline6 của cả tuyến; giải mã bằng decodePolyline6 → [lng, lat][] */
  geometry: string;
  legs: RouteLeg[];
  flags: { toll: boolean; highway: boolean; ferry: boolean };
}
export interface Waypoint {
  location: [number, number];
  snapped: [number, number];
  name: string | null;
}
export interface DirectionsResponse {
  routes: Route[];
  waypoints: Waypoint[];
  attribution: string;
  engine?: { name: string; graph: string | null };
}
```

`client.ts` thêm:

```ts
directions: (opts: { from: [number, number]; to: [number, number]; via?: [number, number][]; mode?: TravelMode; lang?: 'vi' | 'en'; alternatives?: boolean }) =>
  get<DirectionsResponse>('/v1/directions', { from: `${opts.from[0]},${opts.from[1]}`, … })
```

Tham số `from`/`to`/`via` của **client** nhận `[lat, lng]` để khớp cách gọi `nearby({lat, lng})` và `reverse(lat, lng)` hiện có; client tự ghép chuỗi. Response giữ `[lng, lat]`. Docs nêu rõ.

`polyline.ts` mới: `decodePolyline6(s: string): [number, number][]` trả `[lng, lat]`, có test với chuỗi mẫu và với fixture Valhalla thật. Export từ `index.ts`.

Bảng ánh xạ `ManeuverKind` (mục 5.2) đặt ở core (`maneuver.ts`, `VALHALLA_MANEUVER_KIND`) để Worker import và spec B dùng lại cho icon; đây là ngoại lệ có chủ đích của nguyên tắc "core không biết engine": bảng chỉ là dữ liệu, không phải logic gọi engine, và để một chỗ đỡ lệch hai bản.

## 7. Kiểm thử

1. **Unit Worker** (`apps/api/test`, vitest, không cần dịch vụ ngoài theo quy tắc test API không được cần Postgres): fixture JSON Valhalla ghi sẵn cho ba mode + một ca `alternates` + ca lỗi 442/171/154; test `translate()` (ánh xạ kind, nối shape và dịch chỉ số, làm tròn, bbox, waypoints), validate tham số (hộp VN, khoảng cách theo mode, số điểm), ánh xạ lỗi, khoá cache chuẩn hoá, header Access chỉ gửi khi có secret, timeout → 503. Mock `fetch` bằng `vi.stubGlobal`.
2. **Core**: `decodePolyline6` với chuỗi đã biết; `directions()` ghép tham số đúng (`[lat,lng]` → `lat,lng`).
3. **Fixture PBF Quận 1 có sẵn** `pipelines/poi/fixtures/q1.osm.pbf` (mục 2), không cắt mới. `infra/dev/compose.yml` thêm service `valhalla` (profile `routing`, không bật mặc định) đọc thư mục `work/valhalla-dev/` (gitignore) mà script chép fixture vào → build graph mini vài phút. Script `scripts/routing-test.mjs` (`pnpm test:routing`): dựng compose profile, chờ `/status`, chạy `wrangler dev` với `ROUTING_BASE` trỏ container và khoá test seed vào KV local, rồi chạy bộ `apps/api/test-routing/*.rtest.mjs`: tuyến Nhà thờ Đức Bà → Chợ Bến Thành cho cả 3 mode, kiểm `routes[0].distance_m` trong khoảng, `steps[0].kind = depart`, bước cuối `arrive`, câu `instruction` có dấu tiếng Việt, điểm ngoài Quận 1 → `404 no_route`, `/healthz/routing` trả `graph_built_at`. Cờ `--capture` ghi JSON Valhalla thô làm fixture `apps/api/test/fixtures/valhalla/q1-motorbike.json` cho unit test. Trên CI chạy trong **workflow riêng `Routing tests`** trên `ubuntu-latest` (job DB tests chạy trong container image pipeline nên không có Docker), kích hoạt khi chạm mã routing hoặc chạy tay; **không** đưa vào job CI nhanh.
4. **Smoke production** `scripts/smoke-directions.mjs` (`pnpm smoke:directions`): bốn tuyến cố định — nội thành TP.HCM xe máy (~8 km), liên tỉnh xe máy TP.HCM → Vũng Tàu (kiểm `flags.highway = false`), liên tỉnh ô tô TP.HCM → Cần Thơ, đi bộ ~2,5 km Hồ Gươm → Lăng Bác; in `distance_m`, số lượt lỗi, cờ highway, có dấu tiếng Việt, p95; các lượt cách nhau 3,5 s để không vướng burst 20/phút (20 lượt × 4 tuyến ≈ 5 phút); lần đầu chạy 20 lượt để lấy p95 ghi vào evidence, sau đó ngưỡng p95 ghi vào script (đo rồi mới chốt số, không đoán); production bắt buộc `--confirm-production`.
5. **Kịch bản bọc**: kiểm tay theo checklist trong plan: tạo cờ → log "reload" → `/status` không trả lời → build → 200; rollback → `/healthz/routing` trả `graph_built_at` cũ và `routing-graph.mjs status` trả `pbfDate` cũ.

## 8. Docs, thông báo bên thứ ba, attribution

- `apps/docs/src/content/docs/api.md`: mục 4 thêm `GET /v1/directions` (tham số, ví dụ curl, response mẫu, bảng `kind`, lưu ý `[lat,lng]` vào / `[lng,lat]` ra), mục 2 thêm `no_route`, mục 3 thêm quota `directions`, mục 6 thêm `/healthz/routing`, mục 7 thêm kiểu `Route`… `tinh-nang.md` thêm dòng "Chỉ đường xe máy/ô tô/đi bộ (bước rẽ tiếng Việt)". `sdk.md` thêm ví dụ `client.directions()`.
- `THIRD_PARTY_NOTICES.md` mục 5 (công cụ máy chủ, không phân phối) thêm Valhalla — MIT. Không thêm nghĩa vụ attribution UI: dữ liệu đường là OSM, đã ghi nguồn.
- Riêng tư (quyết định PHONG 10/09/2026, phương án 1 — chỉ tài liệu, không đổi mã): `docs/legal/dieu-khoan-tenant.md` mục 5 nói rõ log request Workers có toạ độ trong URL (`near`, `lat`/`lng`, `from`/`to`/`via`) kèm khoá tenant, không kèm định danh người dùng cuối, chỉ dùng chẩn đoán, không ghép thành hành trình; trang API nhắc lại ở mục directions. Phương án kỹ thuật (hạ `head_sampling_rate`/tắt invocation logs) ghi vào `docs/legal/checklist-phap-ly.md` C6 để sau.
- `infra/server/README.md`: mục 4.5, cách xem log build, cách rollback, mục "Không bao giờ thêm `ports:` cho `valhalla`".
- `docs/evidence/routing/`: số đo build (thời gian, RAM đỉnh qua `docker stats`, dung lượng tar), p95 ba tuyến, ảnh/log smoke.

## 9. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Máy chủ Mac ngủ → Valhalla chết cùng DB | Điều kiện mở tính năng: xác nhận đã tắt auto-sleep khi cắm điện và tunnel có cảnh báo email (đã có mục 5 README) |
| Build graph ăn RAM đỉnh cao, chèn Postgres | `server_threads=4`; đo lần đầu bằng `docker stats`; nếu đỉnh > 6 GB thì đặt `mem_limit` và hạ `PG_SHARED_BUFFERS` xuống 3 GB, ghi DEVLOG |
| Gián đoạn chỉ đường lúc build (vài chục phút, 02:00 thứ Hai) | Chấp nhận ở giai đoạn nội bộ; 503 có retry-after; stale cache đỡ tuyến trùng; nâng lên build tách container nếu thành vấn đề |
| Entrypoint image không hợp tác với kịch bản bọc | Phương án dự phòng docker-socket-proxy chỉ cho `restart` (mục 4.3) |
| Câu tiếng Việt của Valhalla dịch máy, đọc gượng | Spec A trả nguyên; spec B vá ở Worker bằng bảng cụm từ (locale nằm trong binary, không mount được — xem spec B mục 2, 6.2) |
| Dữ liệu một chiều/cấm rẽ OSM Việt Nam thiếu → tuyến sai nội thành | Không giải trong spec này; là bài toán dữ liệu OSM. Ghi vào docs "độ chính xác"; cơ chế đóng góp POI không áp dụng cho đường |
| Xe máy lên cao tốc do costing chưa chuẩn | Kiểm smoke liên tỉnh: `flags.highway` phải `false` với `mode=motorbike`; nếu sai chỉnh `costing_options.motor_scooter.use_highways = 0` ở plan |
| Đo ở dev rồi kết luận (bài học tìm kiếm) | Mọi ngưỡng p95 và RAM chốt bằng số đo production, ghi evidence |
| Worker deploy trước migration 0012 | `loadAuth` đọc cột qua `to_jsonb(k) ->> …` nên không phụ thuộc thứ tự (mục 5.5); vẫn đối chiếu `/healthz/db` sau `server:update` |
| Gói core vượt trần size-limit 10 kB gzip (hiện 9,5 kB) khi thêm polyline + bảng maneuver | Nâng trần lên 12 kB trong `.size-limit.json` kèm ghi DEVLOG; đo lại sau build |
| Build graph lỗi/OOM → Docker khởi động lại và build lại liên tục | `run.sh` ngủ 10 phút trước khi thoát; `rollback` quay về tar cũ; xem log trước khi build lại |
| Máy chủ là macOS: container chạy trong VM Docker Desktop, RAM của VM (không phải 16 GB của máy) mới là trần thật cho Postgres + Valhalla | Kiểm `docker info` MemTotal ≥ 12 GB trước khi build lần đầu; chỉnh Settings → Resources; hạ `PG_SHARED_BUFFERS` nếu VM nhỏ |
| Toạ độ điểm đi/đến của người dùng cuối nằm trong URL → có trong log Workers vài ngày (cùng tình trạng `nearby`/`reverse` hiện có, nhưng chỉ đường lộ cả hành trình) | Phương án 1 (PHONG 10/09): minh bạch trong điều khoản tenant mục 5 và trang API; không đổi mã. Phương án 2 (hạ sampling log) ghi checklist C6 |
| Khoá `web` của tenant plan `internal` (khoá demo trong docs/playground) công khai trong HTML và không có quota ngày → người ngoài dùng làm backend chỉ đường miễn phí | **Đã quyết 10/09** (mục 5.5): trần 100/phút theo khoá bằng Rate Limiting cho mọi khoá web/mobile + burst riêng 20/phút. Không dùng quota ngày KV cho khoá công khai: Workers Free chỉ 1.000 ghi KV/ngày, kẻ tấn công có thể làm cạn ngân sách KV của cả tài khoản (auth cache, manifest) |

## 10. Đường nâng cấp đã dự trù

- **Giao diện nhà cung cấp tuyến**: spec B định nghĩa `RouteProvider = { directions(opts): Promise<DirectionsResponse> }`; bản mặc định gọi `client.directions()`. Sau này thêm provider chạy trên client (đồ thị tĩnh trên R2, tính tuyến trên thiết bị) hoặc đổi engine máy chủ mà SDK và app không đổi. Đây là lý do schema mục 5.2 không lộ tên trường Valhalla.
- **Khi thương mại hoá**: Valhalla chuyển sang VPS/container cloud cùng lúc với Postgres, chỉ đổi `ROUTING_BASE` và Access.
- **Tách scope** `directions:read` và quota theo plan trả tiền khi có cổng nhà phát triển.

## 11. Nghiệm thu spec A

1. `pnpm server:setup` trên máy chủ dựng `valhalla`, graph Việt Nam build xong, `/healthz/routing` production trả 200 kèm `graph_built_at`.
2. `pnpm smoke:directions` production: ba tuyến trả 200, `mode=motorbike` liên tỉnh có `flags.highway=false`, câu chỉ dẫn tiếng Việt có dấu; p95 ghi evidence.
3. `pnpm test` xanh (unit Worker + core), `pnpm test:routing` xanh trên dev với fixture, job DB tests xanh trên CI.
4. `routing-graph.mjs prepare --force` trên máy chủ làm graph build lại và phục vụ lại không cần tay (đường đi `data:update` gọi cùng lệnh khi OSM đổi); `routing-graph.mjs rollback` quay về graph trước và `/healthz/routing` trả `graph_built_at` cũ.
5. Quota `directions` đếm được với khoá `free` (kiểm bằng KV), tenant `internal` không đếm.
6. Docs site có trang directions; THIRD_PARTY_NOTICES có Valhalla; README máy chủ có mục 4.5; evidence có số đo build và p95.
7. Trạng thái mốc và DEVLOG cập nhật.

## 12. Việc tay của PHONG

- Xác nhận máy chủ đã tắt auto-sleep khi cắm điện (điều kiện mở tính năng).
- Cloudflare dashboard: public hostname, service token, Access application (mục 4.5); dán hai secret bằng `wrangler secret put`.
- Chạy `pnpm server:setup` trên máy chủ (build lần đầu) và cung cấp số đo `docker stats` nếu Fable không có SSH.
- Review file này và plan trước khi thực thi.
