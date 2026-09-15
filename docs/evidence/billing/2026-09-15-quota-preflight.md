# Task 0 — tiền kiểm quota thuê bao (15/09/2026)

**Kết luận: PASS cho quyết định kiến trúc và bắt đầu Task 1.** Task 0 chỉ kiểm chứng spike
SQLite Durable Object, strict client ACK, phục hồi, cutover, timeout và giới hạn pilot; chưa nối
quota thương mại vào runtime. Protocol commit trước response bị loại vì có thể trừ lượt khi Worker
trả 503. Protocol được chốt giữ reservation, chỉ tăng `used` sau ACK của client/SDK.

## Phạm vi

- Harness dùng một lần không dùng binding, DB, KV, R2, Hyperdrive, key hoặc hostname production;
  đã xóa khỏi working tree sau nghiệm thu. Staging riêng dùng Worker
  `mapslibvn-quota-preflight-20260915`.
- Fixture local cuối: **29/29 pass** (8 protocol cũ + 21 strict ACK/recovery).
- Wrangler CLI **4.126.0**. Pool khóa Vitest **2.1.9**,
  `@cloudflare/vitest-pool-workers` **0.6.16**, Miniflare **3.20250204.1** và cảnh báo hạ
  compatibility date test từ `2025-09-01` xuống `2025-02-04`. Task 0 không nâng dependency.
- Raw kết quả, script tải production và báo cáo này được giữ làm evidence. Production chỉ chạy
  wave có guard 10 Places + 4 directions bằng
  `docs/evidence/capacity/2026-09-15-mixed-origin-probe.mjs`.

## Kết quả cổng kiến trúc

| Cổng | Trạng thái | Bằng chứng và giới hạn |
|---|---|---|
| SQLite transaction/RPC/alarm | PASS | Exception giữa hai SQL write rollback toàn transaction. Alarm/restart giải phóng receipt, không tăng `used`. |
| Failure model | PASS strict ACK | Mất response sau reserve/prepare để `used=0`; ACK response mất sau commit retry idempotent và `used=1`; ACK sai tenant/token và ACK muộn fail closed. Không tuyên bố exactly-once delivery qua mạng. |
| Chống cố ý không ACK | PASS pilot | Ba receipt thiếu ACK trong rolling 24 giờ khóa bằng `ack_required`; cửa sổ trôi tự mở; admin unlock cần `operationId`, actor, reason, audit và idempotency. Theo dõi false positive trong pilot. |
| Cutover/cache/HEAD | PASS fixture | Gate đóng trước DO; cache phát hành trước cutover bị từ chối dù sliding TTL còn dài; cache mới có absolute expiry được nhận; HEAD 405 không gọi handler. Runtime triển khai tại Task 4/5. |
| Backup/recovery | PASS spike | Snapshot versioned có checksum/checkpoint; journal sequence/checksum, export 100+5; restore snapshot + tail liên tục đúng `used`, replay idempotent; checksum sửa, sequence gap và transition sai đều rollback/fail closed. Task 6 phải stream nhiều page, chỉ advance checkpoint sau khi R2 ghi xong và không restore object đang nhận traffic. |
| Postgres timeout | PASS cô lập | PostGIS 16-3.4: `statement_timeout=100ms` hủy `pg_sleep(5)`; không còn query sleep active và `SELECT 1` sau đó thành công. Runtime `db.ts` chưa cấu hình. |
| Valhalla timeout | PASS transport | `callValhalla(... timeoutMs=75)` với upstream treo reject sau **78,85 ms**, socket đóng và active request về 0. Chứng minh giải phóng HTTP resource, không chứng minh thuật toán nội bộ dừng ngay sau disconnect. |
| Persistence/cleanup | PASS | Dữ liệu staging còn sau redeploy. Cleanup migration đã xóa hai namespace; Worker đã xóa, URL trả 404 và namespace REST trả `[]`. |

## Độ trễ và tải

Staging tuần tự 100 mẫu: success→ACK p50/p95/p99 **141/167/226 ms**; tổng ba RPC DO
p95/p99 **37/114 ms**; `used=100`, không mismatch, database 102.400 B. Cohort nhỏ từng có
spike p99 607–743 ms nên đây không phải SLA.

- Hot tenant 20 request: 2 admitted, 18 `pending_limit`, sau ACK `used=2`.
- 25 tenant, 50 operation: 0 error; strict ACK p95/p99 **1.560/2.386 ms**.
- 10 tenant × 10 wave, 200 operation: 0 error; p95/p99 **1.129/1.272 ms**.
- Storm 100 handler 503: 73 reserve/release, 27 pending-limit, 0 unexpected; cuối cùng
  mọi tenant `used=0`, `pending=0`.
- Object đã provision, mỗi tenant hai request/wave: data response concurrency 4 có p95
  **95,90 ms**, p99 **650,47 ms**; concurrency 8–16 có p95 **453–548 ms**.
  Cold object p95 khoảng 0,8–1,3 giây; `locationHint: apac-se` chỉ giảm nhẹ, best effort.

SDK decode xong, ghi receipt vào hàng đợi bền vững rồi resolve data; ACK chạy nền. Trước request
data tiếp theo SDK flush ACK cũ với retry hữu hạn. Nếu outcome chưa rõ, trả `quota_ack_pending`
và không tạo receipt mới. Không lưu API key hoặc response body.

Wave production hỗn hợp: **10 Places + 4 directions, 14/14 HTTP 200**; p95 Places
**3.490 ms**, p95 directions **2.022 ms**; `/healthz`, `/healthz/db`,
`/healthz/routing` đều 200. Đây là một wave end-to-end, không phải soak test.

## Cap pilot

- Tenant: `MAX_INFLIGHT_PLACES=2`, `MAX_INFLIGHT_DIRECTIONS=1`.
- Origin: tối đa **10 Places + 4 directions đang chạy**; vượt trần trả lỗi retryable trước khi
  mở thêm query Postgres/Valhalla.
- Pending ACK tách khỏi inflight origin. SDK chỉ giữ một receipt chưa xác định trên mỗi API key;
  nhiều key vẫn chịu cap tenant ở server.

Cap khớp hot-tenant fixture và wave mixed, đồng thời giữ headroom so với wave riêng trước DO
(50 autocomplete, 16 tuyến). Đây là cấu hình pilot bảo thủ, không phải số user đồng thời hoặc SLA.
Chỉ tăng sau soak test có queue, timeout, PG connections, Valhalla CPU và p95/p99.

## Chi phí DO

`SqlStorageCursor` của chuỗi reserve→prepare→ACK đo **11 rows read, 14 rows written**,
gồm index; database mới sau lifecycle 53.248 B. Mỗi success dùng ba DO request, cộng Workers
request cho ACK và có thể một alarm write. Business 440.000 lượt/tháng tương đương khoảng
**1,32 triệu DO request** và **6,16 triệu row writes** trước retry/alarm/cleanup. Dùng đều sẽ
vượt Free (~205.333 writes/ngày), nhưng nằm trong Workers Paid: 1 triệu DO requests và
50 triệu writes/tháng; 0,32 triệu request vượt gói tối thiểu khoảng **$0,05/tháng**.
Duration/storage phải theo dõi thật, không suy từ `Server-Timing`.

GraphQL Analytics ngày 14–15/09 trả mảng rỗng cho invocation/periodic/storage, có thể do độ trễ
tổng hợp hoặc namespace đã xóa. Cloudflare ghi rõ GraphQL không phải hóa đơn chính xác. Task 0
vì vậy dùng cursor billing counters + databaseSize + request model; production đối chiếu Usage/Billing.

Nguồn: [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[SQLite metrics](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[GraphQL limitation](https://developers.cloudflare.com/analytics/graphql-api/),
[data location](https://developers.cloudflare.com/durable-objects/reference/data-location/),
[migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

## Giới hạn chuyển sang Task 1

Task 0 không sửa `auth.ts`, `quota.ts`, `db.ts`, cache, bảy route hoặc bốn SDK. Task 2–6
sẽ triển khai entitlement, cutover, receipt endpoint, SDK durable queue, Hyperdrive timeout,
origin semaphore, telemetry, backup R2 và drill nhiều page. Nếu không giữ đúng contract này,
commercial mode phải fail closed.
