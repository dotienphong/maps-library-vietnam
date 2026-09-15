# Review quota spec + plan — 15/09/2026

## Kết luận

**Request changes đối với bản trước review.** Hướng quota theo tenant bằng DO vẫn có cơ sở,
nhưng chưa đủ bằng chứng để coi thiết kế không ảnh hưởng hiệu năng hoặc tính tiền luôn đúng.
Review phát hiện 12 nhóm vấn đề dưới đây, đã thêm ràng buộc vào spec mục 14 và sửa plan,
đưa Task 0 kiểm chứng lên trước tích hợp. Sửa văn bản không đồng nghĩa đã đóng rủi ro runtime.

Phạm vi: rà tĩnh hai tài liệu và source tại HEAD `0b90504`; đọc tài liệu Cloudflare chính thức;
chạy một thí nghiệm local Hono cho HEAD. Không deploy, không đọc secrets, không load test origin,
không sửa runtime hoặc thay chính sách giá. Các file tài liệu từ phiên trước vẫn được giữ.

## Findings

| ID | Mức | Tình huống và tác hại | Bằng chứng | Xử lý sau review |
|---|---|---|---|---|
| R1 | P0 chặn thu phí | DO commit used=1, ACK mất, Worker trả 503; khách bị trừ dù nhận lỗi. `settle(): void` không biểu đạt committed/unknown; release lặp không undo commit | Spec cũ 7.4–7.6, contract plan | Thêm receipt, readReceipt, compensate và durable outcome requirement; Task 0 fault injection. **Chưa đóng:** proof protocol/recovery trước bật commercial |
| R2 | P0 chặn rollout | Cache auth cũ chứa mode legacy/internal hoặc key đã revoke; đợi 5 phút không tạo atomic cutover. Rollback Worker cũ bỏ DO và mở lại quota | auth.ts cache TTL/loadAuth, quota.ts bypass internal; Cloudflare KV eventual consistency | Hard cache expiry, admission gate độc lập ledger, revoke trong DO, rollback về build hiểu gate hoặc block bên ngoài. Cần test stale cache và inventory thật |
| R3 | P1 | HEAD được miễn quota nhưng Hono chạy handler GET, vẫn query DB/routing. Có thể dùng để tạo tải không tính lượt | Thí nghiệm local + Hono dist dòng 279 | Short-circuit HEAD 405 trên bảy API, handlerCalls=0, không DB/DO. Không sửa semantics HEAD tiles/metadata |
| R4 | P1 | `cachedJson` trả public cache headers trên API xác thực; lớp cache ngoài Worker có thể phục vụ response khi key hết quyền/quota; metadata quota dễ rò giữa tenant nếu gắn vào cache chung | apps/api/src/cache.ts; places.ts nhánh pending | External private,no-store; giữ Cache API nội bộ; test different keys/pending/revoke, purge cache rule cũ lúc cutover |
| R5 | P1 | Quota tháng không giới hạn concurrency. Nhiều key/IP/colo và nhiều tenant có thể đẩy tải lên DB nhà/routing; 4xx/5xx không charge nhưng vẫn tốn tài nguyên | quota.ts rate-limit key+IP; auth.ts chặn format nhưng random đúng format vẫn có thể vào DB; DB max_connections=100, Valhalla 4 threads | Pre-auth guard, validation rẻ trước reserve, trần in-flight tenant/group và origin backpressure. Giá trị phải đo; không coi 4 threads là throughput benchmark |
| R6 | P1 | Một payment với operationId mới có thể cộng lại; period mới overlap hoặc tương lai ghi đè period hiện tại, dẫn tới reset quota hoặc mất gói | Spec 5/8; plan Task 2 mới chỉ unique operationId | Unique business receipt/line ID, backend ràng buộc tenant, period overlap guard, bảo toàn lịch sử trial/paid và pending requests |
| R7 | P1 | Restore snapshot cũ và “reconcile” nhưng chưa chỉ ra journal tail lấy ở đâu; checksum không giúp dựng lại usage chưa backup, có thể hồi lượt hoặc cộng credits trùng | Spec 10; plan Task 6 | Task 0 xác định nguồn durable tail/sequence/RPO; export đủ grant/period/dedup; thiếu tail thì giữ maintenance, không tự mở. Cần drill thực |
| R8 | P1 | Hai RPC nối tiếp nằm trên critical path mọi request, kể cả cache hit. Một DO/tenant là điểm tập trung, placement khác vùng tăng RTT; retry quá tải làm tệ hơn | spec reserve/settle; Cloudflare limits/location/errors | Đo sớm Task 0, tối đa một retry bổ sung khi retryable, không retry overloaded; placement lúc provision, không full readUsage mỗi call. Chưa biết overhead thật |
| R9 | P1 | Retention 35 ngày + cleanup mỗi reserve có thể scan lớn, alarm writes quá nhiều, giữ DO active, tăng storage/cost; error storm tạo ledger dù không có doanh thu | spec 7 retention; thiếu index/batch bound ở plan cũ | Index, bounded cleanup/export, không interval, không ghi alarm thừa, không lưu denied requests; metric rows/duration/size và account-wide budget |
| R10 | P1 | 30s timeout ngoài Worker không tự dừng SQL/body parse/RPC; lease hết mà query tiếp tục chạy; late settle có thể trừ nhầm kỳ hoặc response lỗi sau commit | apps/api/src/db.ts chỉ connect_timeout; routing/valhalla.ts có timeout riêng; spec 7 | Absolute deadline, real cancellation/server timeout, keep shorter routing deadline, period/source pinning; test pooled connection và late results |
| R11 | P2 | SDK hiện bỏ error metadata; navigator retry không phân biệt hết quota, có thể lặp request vô ích hoặc app hiểu sai rằng phải dừng tuyến đang chạy | packages/core/src/errors.ts/client.ts; navigation/navigator.ts catch reroute | Optional details/retryAfter và typed reason, không retry quota expired, giữ tuyến có sẵn, test cả SDK consumers; popup chỉ console |
| R12 | P2 | Plan đưa performance proof ở cuối; test clock qua isolate chưa chứng minh; Workers pool dùng Wrangler 3 còn deploy 4; một số chữ “chưa chốt” còn trái trạng thái duyệt | pnpm-lock.yaml; spec 8/13; plan 2/3/7 | Task 0 kiểm harness/SQLite/RPC/restart trước, đồng bộ trạng thái duyệt và contract. Không mặc định upgrade toàn bộ dependency |

P0/P1 là ưu tiên tác động, không khẳng định đã có exploit trên production. Đây là review thiết kế
chuẩn bị triển khai; những lỗi từ source hiện có được nêu vì có tương tác trực tiếp với quota mới.

## Bằng chứng thí nghiệm HEAD

Chạy local với dependency Hono đang cài, không gọi dịch vụ thật:
```sh
pnpm --filter @mapslibvn/api exec node --input-type=module -e 'import { Hono } from "hono"; const app=new Hono(); let calls=0; app.get("/v1/search", c=>{calls++; return c.json({ok:true})}); const r=await app.request("http://test/v1/search",{method:"HEAD"}); console.log(JSON.stringify({method:"HEAD",status:r.status,handlerCalls:calls,body:await r.text()}));'
```
Kết quả: `{"method":"HEAD","status":200,"handlerCalls":1,"body":""}`.
Chứng minh framework chạy GET handler cho HEAD; không khẳng định đã tái hiện tấn công production.

## Định lượng tải tăng thêm (mô hình, không phải benchmark)

Nếu mỗi request được xử lý có một reserve và một settle RPC độc lập:

| Gói dùng hết | API request | RPC DO bình thường |
|---|---:|---:|
| Free / đợt 30 ngày | 2.200 | 4.400 |
| Starter / tháng | 33.000 | 66.000 |
| Professional / tháng | 110.000 | 220.000 |
| Business / tháng | 440.000 | 880.000 |

Chưa gồm RPC retry/status/admin, alarm, request lỗi đã reserve, credits hoặc exports.
Độ trễ tăng gần bằng thời gian reserve + settle trên critical path, không tự bằng 0 vì dùng Cloudflare.
Một doanh nghiệp dùng nhiều key vẫn tập trung vào cùng DO; nhiều tenant trải ra nhiều DO nhưng
đều dùng chung origin POI/routing. Không có số RPS/DAU tối đa được chứng minh trong phiên này.

Theo bảng Cloudflare kiểm tra hôm nay: Paid có 1 triệu DO requests/tháng và 50 triệu SQL row writes/tháng
trong allocation; Free chỉ 100.000 DO requests/ngày và 100.000 row writes/ngày. Allocation dùng chung
toàn account, không cấp riêng mỗi khách; Free vượt trần làm operations thất bại. Giá DO không chỉ RPC:
duration khi object active, row reads/writes, index, delete, alarm và storage cũng cần tính.
Chưa kiểm account đang ở plan nào hoặc invoice, nên không kết luận có/không có lãi.

## Cổng đo sớm thay vì chờ cuối plan

- Task 0: chứng minh receipt/compensation, auth cutover, journal tail và harness clock.
- Budget staging đề xuất: cache-hit quota overhead p95 ≤100ms/p99 ≤250ms, không tăng lỗi ở tải pilot
  đã chọn. Đây là tiêu chí đề xuất để kiểm, không phải cam kết đạt hoặc SLA đã bán.
- Tải: nhiều tenant/key/IP, cold/miss và warm/hit, invalid-format/valid-random-key storm,
  4xx/5xx storm, retry, cleanup backlog, usage/export đồng thời và nóng một tenant.
- Origin: DB connections/active query/CPU/RAM, routing queue/timeout; chọn in-flight caps từ số đo.
- Fault: chết trước/sau commit, ACK mất, hết deadline, restart, alarm trễ/lặp, tail backup thiếu,
  kỳ chuyển trong lúc đang xử lý, kỳ tương lai đã thanh toán, receipt cùng ID khác payload.
- Runtime gates chưa đo thì ghi CHƯA ĐO. Không tick PASS vì đã thêm checklist hay mock test.

## Phần đã sửa và phần còn phải chứng minh

Đã sửa spec/plan: HTTP methods/cache policy, typed settlement, business uniqueness, period invariants,
backpressure, cleanup bounds, recovery prerequisites, SDK semantics và thứ tự Task 0.

Chưa đóng bằng thực nghiệm: R1 outcome/compensation, R2 cutover, R5 origin caps, R7 recovery tail,
R8 latency/cost, R10 cancellation, R12 test runtime compatibility. Các phần này là việc cụ thể
của Task 0 và test implementation, không phải yêu cầu chủ dự án trả lời thêm bảng giá.
Giá, giờ hỗ trợ và các quyết định pháp lý được giữ nguyên.

## Nguồn

- https://developers.cloudflare.com/durable-objects/platform/limits/ — một object single-threaded,
  soft throughput limit không phải throughput bảo đảm cho workload này.
- https://developers.cloudflare.com/durable-objects/platform/pricing/ — allocations/requests/duration/SQL.
- https://developers.cloudflare.com/durable-objects/best-practices/error-handling/ — overloaded không retry,
  retryable + idempotent + backoff, tạo stub mới sau exception.
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ — transactionSync/SQLite.
- https://developers.cloudflare.com/durable-objects/reference/data-location/ — placement/jurisdiction.
- https://developers.cloudflare.com/kv/concepts/how-kv-works/ — cache eventual consistency.

Các dữ kiện số lấy từ bảng chính thức ngày review; cần kiểm lại khi tính bill trước release.
