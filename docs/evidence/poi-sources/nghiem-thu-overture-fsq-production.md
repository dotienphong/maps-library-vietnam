# Nghiệm thu production — profile Overture và Foursquare

Ngày nghiệm thu: 09/09/2026 (Asia/Ho_Chi_Minh).

## 1. Code và deploy

- Source đã push lên `origin/main`: `7de69539a12c57049df3bebd122211eba08ba7b4`.
- `gh auth` ban đầu hết hạn nhưng đã được phục hồi. Truy vấn sau đó xác nhận cả năm workflow của
  source `7de6953` đều fail trước khi có bất kỳ step nào: GitHub annotation báo payment gần đây thất
  bại hoặc spending limit cần tăng. CI của evidence `63f9294` cũng bị chặn cùng nguyên nhân. Đây
  không phải test failure, nhưng các workflow **không được gọi là green**.
- Deploy trực tiếp theo workflow hiện hành sau full gate local:
  - API Worker version `d4004b85-a6de-4180-b729-c0a2448943f3`.
  - Docs Pages deployment `https://ae4a40e6.mapslibvn-docs.pages.dev`;
    canonical `https://mapslibvn-docs.pages.dev/playground` trả HTTP 200 và có đủ ba option mới.
- `GET https://api.ai-solutions.io.vn/healthz` trả
  `{"ok":true,"environment":"production"}`.
- Trước khi publish dữ liệu, `styles/light.json?sources=fsq` trả HTTP 200,
  `x-poi-profile: all;fallback` và trỏ `poi-20260904`; chứng minh code fallback đã lên trước
  manifest mới.

## 2. Snapshot, archive và manifest

Batch duy nhất `pnpm poi:profile --profiles overture-fsq,overture,fsq` hoàn tất trong 390 giây.

- Build ID chung: `20260909-074253-c3f26595`.
- Snapshot: 1.515.984 dòng; SHA-256
  `554edffbe8c6051d308d37484fd81f4b8ddb48d4452187d453a166d5c359a40f`.
- Mỗi export có `rankFallback=0`, `invalidCoordinates=0`; QA chủ quyền/style đều đạt.

| Profile | Active phù hợp | Selected | Thinned | Selected theo minzoom 10→16 | Bytes | SHA-256 |
|---|---:|---:|---:|---|---:|---|
| `overture-fsq` | 1.409.736 | 239.536 | 1.170.200 | 596, 830, 4.841, 11.975, 28.036, 73.871, 119.387 | 63.392.930 | `62b3ccf77298e31b66add272797c9b7bd8b5cf8031f9d20de999676836081d9c` |
| `overture` | 1.173.923 | 225.391 | 948.532 | 579, 789, 4.745, 11.513, 25.655, 70.205, 111.905 | 60.386.122 | `0060309dc8a00db852a6266680b26f72b1befe670c04565776f7cfa00122272c` |
| `fsq` | 235.814 | 52.608 | 183.206 | 361, 289, 1.469, 3.666, 8.317, 15.342, 23.164 | 15.212.150 | `76e6c35c4f7eff8e5d7a48580d8a640500906a016280d00ed5854d20e991b865` |

R2 có đủ `.pmtiles` và `.pmtiles.sha256` cho cả ba release. Smoke archive đạt:

- `overture-fsq`: 19 tile, 1 tile trống hợp lệ.
- `overture`: 19 tile, 1 tile trống hợp lệ.
- `fsq`: 17 tile, 3 tile trống hợp lệ.

Manifest chỉ được set sau đủ ba smoke, tại `2026-09-09T00:49:19.726Z`:

```json
{
  "vn": "vn-20260827",
  "poi": "poi-20260904",
  "poiProfiles": {
    "osm": "poi-osm-20260907",
    "overture-fsq": "poi-overture-fsq-20260909-074253-c3f26595",
    "overture": "poi-overture-20260909-074253-c3f26595",
    "fsq": "poi-fsq-20260909-074253-c3f26595"
  }
}
```

## 3. API và partition production

Light/dark của cả ba profile đều HTTP 200, `x-poi-profile` đúng profile và source `poi` trỏ đúng
release trong bảng trên. Với từng profile, smoke tại TP.HCM đạt:

| Profile | Search | Nearby | Reverse | Autocomplete | `/places/{id}` với profile khác |
|---|---:|---:|---:|---:|---:|
| `overture-fsq` | 5 item | 5 item | 1 POI | 5 item | 200 |
| `overture` | 5 item | 5 item | 1 POI | 5 item | 200 |
| `fsq` | 5 item | 5 item | 1 POI | 5 item | 200 |

Tối đa ba ID trên mỗi response được mở lại bằng `/v1/places/{id}`; nguồn `primary` đều thuộc tập
được chọn, hoặc record không có primary (POI user). Kiểm tra ID với `sources` profile đối nghịch vẫn
HTTP 200, xác nhận detail route không lọc.

## 4. Browser production

Public Playground canonical được mở không có `?api=` override. Mỗi ảnh chờ map loaded và WebGL ổn
định 3 giây, assert panel rộng 360 px, style HTTP 200/header đúng, PMTiles Range HTTP 206 và 0
page/console/HTTP error. Có một lần chờ style `fsq`/TP.HCM z16 timeout 30 giây; retry riêng với 60
giây đạt, không có response 4xx/5xx. Tổng cuối: **45/45 ảnh đạt**.

| Profile / thành phố | z12 | z14 | z16 |
|---|---|---|---|
| Overture+FSQ / Hà Nội | [ảnh](screenshots/2026-09-09-overture-fsq-ha-noi-z12.png) | [ảnh](screenshots/2026-09-09-overture-fsq-ha-noi-z14.png) | [ảnh](screenshots/2026-09-09-overture-fsq-ha-noi-z16.png) |
| Overture+FSQ / Hải Phòng | [ảnh](screenshots/2026-09-09-overture-fsq-hai-phong-z12.png) | [ảnh](screenshots/2026-09-09-overture-fsq-hai-phong-z14.png) | [ảnh](screenshots/2026-09-09-overture-fsq-hai-phong-z16.png) |
| Overture+FSQ / Đà Nẵng | [ảnh](screenshots/2026-09-09-overture-fsq-da-nang-z12.png) | [ảnh](screenshots/2026-09-09-overture-fsq-da-nang-z14.png) | [ảnh](screenshots/2026-09-09-overture-fsq-da-nang-z16.png) |
| Overture+FSQ / TP.HCM | [ảnh](screenshots/2026-09-09-overture-fsq-hcm-z12.png) | [ảnh](screenshots/2026-09-09-overture-fsq-hcm-z14.png) | [ảnh](screenshots/2026-09-09-overture-fsq-hcm-z16.png) |
| Overture+FSQ / Cần Thơ | [ảnh](screenshots/2026-09-09-overture-fsq-can-tho-z12.png) | [ảnh](screenshots/2026-09-09-overture-fsq-can-tho-z14.png) | [ảnh](screenshots/2026-09-09-overture-fsq-can-tho-z16.png) |
| Overture / Hà Nội | [ảnh](screenshots/2026-09-09-overture-ha-noi-z12.png) | [ảnh](screenshots/2026-09-09-overture-ha-noi-z14.png) | [ảnh](screenshots/2026-09-09-overture-ha-noi-z16.png) |
| Overture / Hải Phòng | [ảnh](screenshots/2026-09-09-overture-hai-phong-z12.png) | [ảnh](screenshots/2026-09-09-overture-hai-phong-z14.png) | [ảnh](screenshots/2026-09-09-overture-hai-phong-z16.png) |
| Overture / Đà Nẵng | [ảnh](screenshots/2026-09-09-overture-da-nang-z12.png) | [ảnh](screenshots/2026-09-09-overture-da-nang-z14.png) | [ảnh](screenshots/2026-09-09-overture-da-nang-z16.png) |
| Overture / TP.HCM | [ảnh](screenshots/2026-09-09-overture-hcm-z12.png) | [ảnh](screenshots/2026-09-09-overture-hcm-z14.png) | [ảnh](screenshots/2026-09-09-overture-hcm-z16.png) |
| Overture / Cần Thơ | [ảnh](screenshots/2026-09-09-overture-can-tho-z12.png) | [ảnh](screenshots/2026-09-09-overture-can-tho-z14.png) | [ảnh](screenshots/2026-09-09-overture-can-tho-z16.png) |
| FSQ / Hà Nội | [ảnh](screenshots/2026-09-09-fsq-ha-noi-z12.png) | [ảnh](screenshots/2026-09-09-fsq-ha-noi-z14.png) | [ảnh](screenshots/2026-09-09-fsq-ha-noi-z16.png) |
| FSQ / Hải Phòng | [ảnh](screenshots/2026-09-09-fsq-hai-phong-z12.png) | [ảnh](screenshots/2026-09-09-fsq-hai-phong-z14.png) | [ảnh](screenshots/2026-09-09-fsq-hai-phong-z16.png) |
| FSQ / Đà Nẵng | [ảnh](screenshots/2026-09-09-fsq-da-nang-z12.png) | [ảnh](screenshots/2026-09-09-fsq-da-nang-z14.png) | [ảnh](screenshots/2026-09-09-fsq-da-nang-z16.png) |
| FSQ / TP.HCM | [ảnh](screenshots/2026-09-09-fsq-hcm-z12.png) | [ảnh](screenshots/2026-09-09-fsq-hcm-z14.png) | [ảnh](screenshots/2026-09-09-fsq-hcm-z16.png) |
| FSQ / Cần Thơ | [ảnh](screenshots/2026-09-09-fsq-can-tho-z12.png) | [ảnh](screenshots/2026-09-09-fsq-can-tho-z14.png) | [ảnh](screenshots/2026-09-09-fsq-can-tho-z16.png) |

## 5. Autocomplete cold/warm

Mỗi lệnh chạy 5 vòng × 10 query × 2 cohort xen kẽ. Cổng là p95 cache hit của profile mới không
chậm hơn `all` quá 50 ms; cả ba đạt. Cold miss được báo riêng và không dùng để thay thế kết quả warm.

| Profile (colo) | Cold miss `n / p50 / p95 / p99` ms | Warm hit `n / p50 / p95 / p99` ms | `all` warm p95 | Chênh p95 warm |
|---|---|---|---:|---:|
| `overture,fsq` (SIN) | 10 / 1.744 / 2.889 / 2.889 | 40 / 77 / 88 / 99 | 95 ms | -7 ms |
| `overture` (HKG) | 10 / 1.176 / 2.974 / 2.974 | 40 / 61 / 67 / 77 | 65 ms | +2 ms |
| `fsq` (SIN) | 10 / 876 / 1.607 / 1.607 | 40 / 74 / 89 / 95 | 89 ms | 0 ms |

Ở lượt `fsq`, cohort `all` đã ấm từ các lượt trước nên có 50 hit và không có sample miss; không suy
ra cold baseline `all` từ lượt này. Cold profile còn ở mức 1,6–3,0 giây p95 và cần tiếp tục theo dõi.

## 6. Rollback

History đầu là manifest trước rollout: `poi-20260904` + profile `osm=poi-osm-20260907`. Kiểm tra
ban đầu phát hiện hai archive lịch sử chưa có companion checksum. Đã băm trực tiếp object R2 rồi
chỉ bổ sung `.sha256` (không sửa archive, không đổi manifest):

| Release | Bytes | SHA-256 |
|---|---:|---|
| `poi-20260904` | 66.924.565 | `f8ce0cbf0645205050ccc1b9178b49d6265eaba69a52b9300cb1d3b64f7a3811` |
| `poi-osm-20260907` | 17.336.161 | `01f9095b8cf4aaea36f385477e6d7ba0121bb1cc1293780edfc2a384e4333626` |

`verifyRollbackArchives` trả đủ hai release/checksum. Không gọi `data:rollback` vì production đang
đúng.

## 7. Kết luận và điểm còn mở

Production archive/manifest/API/SDK/Playground đạt các cổng chức năng, partition, browser và warm
performance. Sau khi push evidence, smoke lại ba style đều HTTP 200, header đúng profile và trỏ
đúng ba release của build chung. Full test mới nhất đạt 80 file/957 test cùng API 25 file/175 test.
npm không được publish vì bốn package source `0.4.0` vẫn chờ rà soát nhãn hiệu theo phạm vi đã
duyệt. Điểm duy nhất còn mở là GitHub Actions bị Billing chặn trước khi runner khởi động; cần xử lý
`Billing & plans`, rerun các workflow theo SHA source/evidence rồi xác nhận green.
