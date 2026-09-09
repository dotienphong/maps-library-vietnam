# Nghiệm thu production — profile OpenStreetMap + Foursquare

Ngày nghiệm thu: 09/09/2026 (Asia/Ho_Chi_Minh). Không capture màn hình theo yêu cầu.

## 1. Code và deploy

- Source đã push lên `origin/main`: `5a1695128cc701c193cad8b0920af3d842226277`.
- API deploy trực tiếp sau full local gate: Worker version
  `c4b6a18d-ef29-4df2-ace9-6a66249adac6`.
- Docs deploy trực tiếp: `https://1bee6441.mapslibvn-docs.pages.dev`; canonical
  `https://mapslibvn-docs.pages.dev/playground` hoạt động mà không cần `?api=` override.
- Trước khi publish archive, `styles/light.json?sources=osm%2Cfsq` trả HTTP 200,
  `x-poi-profile: all;fallback` và vẫn trỏ `poi-20260904`. Code fallback vì thế đã có trên
  production trước khi manifest công bố profile mới.
- `GET /healthz` sau publish trả `{"ok":true,"environment":"production"}`.

Năm workflow GitHub Actions của SHA source đều fail trước khi chạy bất kỳ step nào. Annotation:
payment gần đây thất bại hoặc spending limit cần tăng trong `Billing & plans`. Đây là blocker hạ
tầng tài khoản, không phải test failure; vì vậy tài liệu này không gọi CI là green.

## 2. Snapshot, archive và manifest

`pnpm poi:profile --profiles osm-fsq` hoàn tất trong 300 giây và chỉ cập nhật manifest sau QA,
upload và remote smoke.

- Build ID: `20260909-105543-b198022f`.
- Snapshot: 1.515.984 dòng; SHA-256
  `2ac7bbddebc82630de04727dae50e8233ee12f21209f0edad05c3625f91fd8d4`.
- Nguồn active phù hợp: 342.062; selected: 88.378; thinned: 253.684;
  `rankFallback=0`, `invalidCoordinates=0`.
- Selected theo minzoom 10→16: 513, 548, 2.835, 5.810, 12.908, 26.036, 39.728.
- Archive: `poi-osm-fsq-20260909-105543-b198022f.pmtiles`, 25.447.237 byte; SHA-256
  `c4a35baae5ecd95406d5b9a4e9dd22214a2fb1b2aa7a7e8dd29d0edbe3125300`.
- QA chủ quyền/style đạt; upload archive, checksum companion và assets đạt.
- Remote smoke đạt 18 tile, trong đó 2 tile trống hợp lệ.

Manifest được set lúc `2026-09-09T04:00:38.957Z`:

```json
{
  "vn": "vn-20260827",
  "poi": "poi-20260904",
  "poiProfiles": {
    "osm": "poi-osm-20260907",
    "overture-fsq": "poi-overture-fsq-20260909-074253-c3f26595",
    "overture": "poi-overture-20260909-074253-c3f26595",
    "fsq": "poi-fsq-20260909-074253-c3f26595",
    "osm-fsq": "poi-osm-fsq-20260909-105543-b198022f"
  }
}
```

Các release cũ và default `all` không đổi; history của manifest vẫn giữ trạng thái ngay trước
rollout để rollback. Không gọi rollback vì production đang đúng.

## 3. API, SDK và Places production

- Light/dark đều HTTP 200, `x-poi-profile: osm-fsq`, trỏ đúng archive mới.
- `GET /v1/tiles/poi-osm-fsq.json` HTTP 200, minzoom 10, maxzoom 16.
- Range `bytes=0-16383` trên archive trả HTTP 206, đủ 16.384 byte; `Content-Range` xác nhận tổng
  25.447.237 byte.
- Với `sources=osm,fsq` tại TP.HCM: search 5 item, nearby 5 item, reverse 1 POI và autocomplete
  5 item; tất cả HTTP 200.
- Mở detail từ kết quả trả HTTP 200 và nguồn chính `osm`; gửi thêm `sources=overture` vào detail
  vẫn HTTP 200, xác nhận contract `getPlace` không lọc theo profile.
- Core/Web/React/React Native SDK đã nhận profile thứ sáu; build local của cả workspace và test
  đồng bộ `poiSources` đều đạt. Playground production bên dưới chạy Web SDK đã deploy.

## 4. Playground production, không ảnh

Chromium headless mở public canonical không có `?api=` override và không chụp ảnh:

- selector có đúng 6 profile;
- chọn `osm-fsq` rồi áp dụng tạo URL `sources=osm,fsq`;
- snippet sinh `poiSources: ['osm', 'fsq']`;
- style request HTTP 200 với `x-poi-profile: osm-fsq`;
- trạng thái map `loaded`; tổng page/console/HTTP error: 0.

## 5. Autocomplete cold/warm

Benchmark xen kẽ 5 vòng × 10 query × 2 cohort tại colo HKG. Gate dùng warm-hit p95; cold miss
được báo riêng.

| Cohort | Cold miss `n / p50 / p95 / p99` ms | Warm hit `n / p50 / p95 / p99` ms |
|---|---:|---:|
| `osm,fsq` | 10 / 1.078 / 1.773 / 1.773 | 40 / 81 / 155 / 227 |
| `all` | 10 / 1.172 / 1.991 / 1.991 | 40 / 78 / 155 / 518 |

Warm p95 delta là 0 ms, đạt cổng không chậm hơn `all` quá 50 ms. Cold profile vẫn ở mức giây và
tiếp tục cần theo dõi riêng, không được diễn giải như cache-hit.

## 6. Verification local

- Focused root: 9 file / 120 test.
- API style + TileJSON: 2 file / 24 test.
- Full root: 80 file / 960 test; API: 25 file / 177 test.
- API PostgreSQL thật: 3 file / 52 test.
- Pipeline PostgreSQL trong image có `tippecanoe`: 10 file / 68 test, gồm 12 archive fixture
  (6 profile × 2 snapshot).
- Browser E2E local: 30/30; lint 332 file; typecheck 14/14; workspace build 8/8.

Lần chạy DB trên host dừng ở `tippecanoe ENOENT`; gate chuẩn trong pipeline image đạt đầy đủ nên
đây là khác biệt môi trường host, không phải lỗi code.

## 7. Kết luận và điểm còn mở

Archive/manifest/API/SDK/Playground của profile `osm-fsq` đã phát hành và đạt nghiệm thu
production, không tạo screenshot. Điểm còn mở duy nhất là GitHub Actions bị Billing chặn trước
runner; cần sửa `Billing & plans`, rerun năm workflow theo SHA source/evidence và xác nhận green.
