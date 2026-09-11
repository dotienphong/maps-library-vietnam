# Nghiệm thu production chỉ đường (spec dẫn đường A, Task 18)

Ngày: 2026-09-11. Base: `https://api.ai-solutions.io.vn`. Worker `mapslibvn-api-production`
version `4d3170db-b51b-4d93-9c1a-74a0db9791e4` (version mới sinh ra khi đặt hai secret Access;
mã nguồn vẫn là bản deploy `03db4486-ebd6-4f28-8173-d1d4295a1c5c` của Task 16).

## Health và schema

```
GET /healthz/routing
{"ok":true,"version":"3.8.3","graph_built_at":"2026-09-11T14:40:19.000Z","ms":284}

GET /healthz/db
"schema_migration":"0012_api_key_quota_directions.sql"
```

`graph_built_at` khớp graph build lúc 14:40:19Z trong `2026-09-11-build-graph-may-chu.md`.

## Smoke bốn tuyến — 20 lượt/tuyến, cách 3500 ms

```
┌─────────┬────────────────────┬─────────────┬────┬────────┬─────────┬────────────┬────────────┬───────────────────┬────────────┬───────┐
│ (index) │ name               │ mode        │ ok │ failed │ highway │ vietnamese │ distance_m │ p95_ms            │ violations │ codes │
├─────────┼────────────────────┼─────────────┼────┼────────┼─────────┼────────────┼────────────┼───────────────────┼────────────┼───────┤
│ 0       │ 'noi-thanh-hcm'    │ 'motorbike' │ 20 │ 0      │ false   │ true       │ 6599       │ 399.6108329999988 │ []         │ ''    │
│ 1       │ 'lien-tinh-xe-may' │ 'motorbike' │ 20 │ 0      │ false   │ true       │ 82771      │ 375.4068340000231 │ []         │ ''    │
│ 2       │ 'lien-tinh-o-to'   │ 'car'       │ 20 │ 0      │ true    │ true       │ 154070     │ 482.8344159999979 │ []         │ ''    │
│ 3       │ 'di-bo-ha-noi'     │ 'walk'      │ 20 │ 0      │ false   │ true       │ 2864       │ 347.430457999988  │ []         │ ''    │
└─────────┴────────────────────┴─────────────┴────┴────────┴─────────┴────────────┴────────────┴───────────────────┴────────────┴───────┘
✓ smoke directions https://api.ai-solutions.io.vn — 20 lượt/tuyến
```

`failed 0` cả bốn tuyến, `lien-tinh-xe-may` có `highway: false` (xe máy không lên cao tốc) và
`lien-tinh-o-to` có `highway: true`, chỉ dẫn tiếng Việt ở cả bốn. Không gặp 429 nào — ba rate
limiter production hoạt động đúng ở nhịp 3,5 giây.

### Một tuyến phải sửa toạ độ trước khi đo được

Lần chạy đầu `noi-thanh-hcm` hỏng **20/20 lượt** với `no_route`. Không phải lỗi graph: điểm đích
`10.8188,106.6520` (toạ độ sân bay Tân Sơn Nhất thường được trích dẫn) snap vào edge
**"VĐ. bảo vệ sân bay"** — đường vành đai trong khu bay, không nối mạng đường công cộng.
`/locate` với costing `auto` chỉ trả đúng hai edge đó; `pedestrian` đi được còn `auto` và
`motor_scooter` đều trả Valhalla 442. Đổi đích sang `10.8153,106.6633` (Trường Sơn, trước nhà ga)
thì cả bốn tuyến xanh. Đã sửa trong `scripts/smoke-directions.mjs` kèm chú thích cảnh báo.

## Ngưỡng p95

p95 lớn nhất 482,8 ms (`lien-tinh-o-to`) × 1,5 → làm tròn lên trăm = **`--p95-max=800`**, ghi vào
comment đầu `scripts/smoke-directions.mjs`.

Chạy lại kiểm ngưỡng, `--requests=20 --p95-max=800` → **xanh**, p95 còn thấp hơn lần đo đầu:

| Tuyến | p95 lần đo (lạnh) | p95 lần kiểm ngưỡng (ấm) |
|---|---|---|
| `noi-thanh-hcm` | 399,6 ms | 280,0 ms |
| `lien-tinh-xe-may` | 375,4 ms | 326,3 ms |
| `lien-tinh-o-to` | 482,8 ms | 311,1 ms |
| `di-bo-ha-noi` | 347,4 ms | 271,7 ms |

**Ngưỡng 800 ms gắn với cỡ mẫu 20 lượt/tuyến.** Chạy ở mặc định `--requests=5` thì p95 gần như
bằng lượt chậm nhất, và lượt đầu sau một khoảng nghỉ mất ~2 giây (isolate Worker nguội + bắt tay
Access lần đầu): lần thử `--p95-max=800` không kèm `--requests=20` đã trượt với `noi-thanh-hcm`
p95 1956 ms trong khi ba tuyến sau đó chỉ 338–766 ms. Khi kiểm ngưỡng phải dùng `--requests=20`.

Lưu ý cách chạy: `pnpm smoke:directions -- --confirm-production` **không dùng được** — pnpm truyền
nguyên chuỗi `--` vào script và script từ chối với "Cờ không hợp lệ hoặc thiếu giá trị: --". Gọi
thẳng `node scripts/smoke-directions.mjs --confirm-production …`.

## Cổng mã nguồn (Task 16, 11/09/2026)

`pnpm lint` 374 file sạch · `pnpm typecheck` 14/14 · `pnpm test` 223 test / 32 file ·
`pnpm test:routing` 7 test · `pnpm test:api-db` 53 test · core gzip **10,62 kB** (trần 12 kB).

Chạy lại sau khi sửa toạ độ smoke (11/09, cuối Task 18): `pnpm lint` 374 file sạch ·
`pnpm typecheck` 14/14 · `scripts/smoke-directions.test.mjs` 11 test · `node scripts/routing-test.mjs`
**7 test xanh** (dùng lại container Valhalla fixture Quận 1 đang chạy nên không đo lại thời gian
build graph fixture; `/v1/directions` qua `wrangler dev` 6–95 ms).

**Không có ID run CI để ghi.** GitHub Actions bị khoá vì thanh toán từ 10/09/2026: mọi workflow
fail sau 3–23 giây, job không khởi động. Cổng được chạy tay tại máy dev và deploy bằng
`npx wrangler deploy --env production`. Còn nợ khi Actions mở lại: `gh workflow run "Routing tests"`
rồi ghi ID run vào đây.
