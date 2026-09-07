# Nghiệm thu production — profile nguồn POI

Ngày: 07/09/2026. Plan: `docs/superpowers/plans/2026-09-07-poi-sources-profile.md` (Task 15).
Rollout theo mức PHONG chọn: **deploy API + export riêng profile `osm`** (chỉ đọc DB production,
không re-ingest, không đụng archive `all`).

## 1. Deploy API

Worker `mapslibvn-api` version `e15713e5-ba83-4b0a-b23f-e293357ba628`.

| Yêu cầu | Kết quả |
|---|---|
| `GET /v1/styles/light.json` (mặc định) | `x-poi-profile: all`, POI_FILE `poi-20260904.pmtiles` — **không đổi** |
| `?sources=osm` trước khi publish | `x-poi-profile: all;fallback` (không 5xx) |
| `?sources=all` | `x-poi-profile: all` |
| `?sources=osm,overture` | `400 invalid_request` — "hiện hỗ trợ: osm \| osm,overture,fsq" |
| `?sources=banana` | `400 invalid_request` |

## 2. `sources=` trên Workers + DB production

Đây là tầng duy nhất bắt được lỗi mảng (`postgres/cf` nối mảng JS → `malformed array literal`).
Không endpoint nào ném lỗi.

`GET /v1/search?q=Highlands`:

| `sources` | `total` |
|---|---:|
| `osm` | 145 |
| `overture,fsq` | 1.207 |
| `all` | 1.352 |

**145 + 1.207 = 1.352** — phân hoạch khớp chính xác, không trùng không thiếu.

Kiểm nghĩa qua `/v1/places/{id}`: 8/8 POI đầu của nhánh `sources=osm` có `primary=osm`
(Chợ Bến Thành, Techcombank, Cà Phê Journeys…); 5/5 POI chỉ xuất hiện ở nhánh `all` có
`primary=overture` hoặc `fsq` (Nước Hoa Chính Hãng…, Thuận Kiều Broken Rice, Ben Thanh Market…).

`nearby`, `reverse`, `autocomplete` với `sources=` đều HTTP 200.

> Lưu ý phương pháp: **không** dùng phép kiểm "osm ⊂ all" trên danh sách item của `nearby`/
> `autocomplete` — hai nhánh đều bị `limit` cắt và xếp theo khoảng cách/score nên tập con không
> đúng dù lọc đúng. Chỉ `total` của `search` và `primary_source` của place details mới nói được.

## 3. Publish archive profile `osm`

`pnpm poi:profile --profile osm` — 39 giây, chỉ đọc bảng `poi` qua Cloudflare Tunnel.

```json
{"sources":"osm","activeRead":106249,"selected":54579,"thinned":51670,
 "byMinZoom":{"10":460,"11":423,"12":2550,"13":4254,"14":7815,"15":16782,"16":22295},
 "rankFallback":0,"invalidCoordinates":0}
```

- `poi-osm-20260907.pmtiles`: **54.579 POI, 16,5 MB** (trần 300 MiB), zoom 10–16, layer `poi`.
- QA chủ quyền: đạt. Smoke: **16/20 tile có dữ liệu** (cổng ≥ 15).
- Manifest sau publish: `{"vn":"vn-20260827","poi":"poi-20260904","poiProfiles":{"osm":"poi-osm-20260907"}}`
  — archive `all` **giữ nguyên** `poi-20260904`.
- `GET /v1/tiles/poi-osm.json`: zoom 10–16, layer `poi`.

## 4. Cổng p95 autocomplete — ĐẠT

`perf-autocomplete.mjs --paired-sources --rounds 2`, 40 truy vấn fixture, xen kẽ từng cặp,
**cùng colo SIN**:

| cohort | cache | n | p50 | p95 |
|---|---|---:|---:|---:|
| `osm` | hit | 41 | 78 ms | **95 ms** |
| `all` | hit | 41 | 79 ms | **103 ms** |
| `osm` | miss | 39 | 817 ms | 2.447 ms |
| `all` | miss | 39 | 801 ms | 2.017 ms |

Nhánh mặc định (`all`) **không xấu đi** so với cổng Task 8.6 (p50 79 ms so với 81/88 ms đo 07/09).
Nhánh `osm` nhanh hơn 8 ms ở p95 ấm vì quét ít dòng hơn. Cache lạnh vẫn chi phối p95 tổng như đã
biết từ Task 8.5 — không phải hồi quy của thay đổi này.

## 5. Mật độ bản đồ — đo bằng số feature trong tile thật

Số feature layer `poi` trong tile tại tâm 5 thành phố (qua `GET /v1/tiles/{set}/{z}/{x}/{y}.pbf`):

| thành phố | z12 all/osm | z14 all/osm | z16 all/osm |
|---|---|---|---|
| TP.HCM | 3 / 3 | 5 / 6 | 13 / 15 |
| Hà Nội | 4 / 5 | 6 / 7 | 8 / 10 |
| Đà Nẵng | 4 / 5 | 5 / 5 | 4 / **0** |
| Cần Thơ | 4 / 7 | 5 / 5 | 9 / 13 |
| Nha Trang | 4 / 4 | 8 / 4 | 10 / 13 |

**Tổng 15 tile: all = 92, osm = 102 (110,9 %).**

Archive `osm` có **nhiều** feature mỗi tile hơn `all` dù chỉ lấy từ 7 % kho POI. Đó chính là lý do
chọn phương án A (archive riêng theo profile) thay vì lọc ở client: lưới progressive chạy lại trên
riêng tập OSM nên POI OSM trước đây thua ô cho một POI Overture/FSQ giờ thắng ô. Lọc ở client sẽ
để lại lỗ trống ở đúng những chỗ này.

Ngoại lệ thật cần biết: **Đà Nẵng z16 có all=4 nhưng osm=0** — tile đó (khoảng 600 m) không có POI
OSM nào. Nha Trang z14 chỉ đạt 50 %. Đây không phải lỗi mà là hệ quả của việc OSM chỉ có ~106
nghìn POI toàn quốc: chọn `poiSources: ['osm']` thì có vùng trống thật. Docs đã nói rõ điều này.

## 6. Đối chiếu tiêu chí nghiệm thu (spec mục 11)

| Tiêu chí | Kết quả |
|---|---|
| `sources` mặc định (`all`) cho kết quả như trước thay đổi | **ĐẠT** — style trả `poi-20260904`, `total`=1.352 như cũ; chỉ cache key autocomplete lên `v=src1` |
| `sources=osm` chỉ trả POI `primary_source='osm'` hoặc `created_by='user'` | **ĐẠT** — phân hoạch 145+1.207=1.352; 8/8 mẫu đúng nguồn |
| Archive `poi-osm-*` ≤ 300 MiB, maxzoom 16, smoke xanh | **ĐẠT** — 16,5 MB, zoom 10–16, 16/20 tile |
| p95 autocomplete không xấu hơn cổng Task 8.6 | **ĐẠT** — `all` p95 ấm 103 ms, p50 79 ms |
| Unit test xanh không cần Postgres | **ĐẠT** — 70 file/711 test + 24 file/140 test API |
| dbtest xanh | **ĐẠT** — 10 file/62 test (trong container); api-db 3 file/33 test |

## 7. Rollback

`pnpm data:rollback` → `manifest rollback` đưa `release:current` về object trước (không có
`poiProfiles`), khi đó `sources=osm` tự quay lại `all;fallback`. API không cần rollback code vì
mặc định `all` giữ nguyên hành vi. Không có migration DB.
