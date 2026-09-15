# Quota thương mại — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task in this session. Steps use checkbox syntax. Không tự dispatch subagent.

**Goal:** Áp dụng quota chính xác theo tenant, trial 30 ngày và lượt mua thêm cho API hiện có.
**Architecture:** SQLite Durable Object theo tenant là nguồn quyền sử dụng và số đếm.
Reserve trước handler, commit cho 2xx/release lỗi; Postgres tiếp tục sở hữu tenant/key.
**Tech Stack:** TypeScript, Hono, Cloudflare Workers/SQLite Durable Objects, Vitest Workers pool, PostgreSQL.
**Spec:** `docs/superpowers/specs/2026-09-15-quota-thue-bao-design.md` — PHONG đã duyệt 15/09/2026.
**Trạng thái:** Task 0–6 PASS local ngày 15/09/2026, Task 7 xong phần máy làm được. Task 0–5:
catalog/policy, SQLite Durable Object,
entitlement commands, reserve/prepare/ACK/release/recovery lease, quản trị thuê bao qua Access +
migration `quota_mode`, và middleware thương mại nối bảy API + hợp đồng receipt/ACK của bốn SDK.
Task 6 thêm journal + snapshot/checkpoint/restore trong DO, nhóm route `/backup/*` có quyền riêng
`BILLING_BACKUP_EMAILS`, `scripts/quota-audit.mjs` và runbook
`docs/evidence/billing/2026-09-15-quota-rollout.md`. Task 7 cập nhật `api.md`/`khoa-api.md`, thêm
`--mode=ab|mixed` và `--cache=warm|cold` cho `scripts/load-api.mjs`, ghi DEVLOG mục 17.
Cổng local 15/09/2026: `pnpm test` (142 file/1.504 test + API 44 file/333 test),
`pnpm test:api-db` (3 file/53 test), `pnpm typecheck` 14/14, `pnpm lint`, `git diff --check` —
tất cả xanh. **CHƯA deploy, CHƯA có số đo A/B** vì chưa có tenant commercial nào tồn tại;
`COMMERCIAL_ADMISSION=0` ở cả dev lẫn production nên commercial vẫn đóng.
**Báo cáo review:** `docs/research/2026-09-15-review-quota-spec-plan.md`. Ràng buộc spec mục 14 áp dụng toàn plan.

## Global Constraints

- Free 2.000 Places/200 tuyến tổng trong 30 ngày, 200/20 mỗi ngày VN.
- Starter $25: 30.000/3.000; Professional $100: 100.000/10.000; Business $400: 400.000/40.000 mỗi kỳ.
- Mua thêm $1/1.000 Places, $3/1.000 tuyến; credits trong kỳ, chỉ paid active, dùng base trước.
- Chỉ 2xx tính lượt, kể cả empty/cache; lỗi 4xx/5xx không trừ, vẫn chống burst.
- Mọi key cùng tenant dùng chung. Internal vẫn miễn quota thương mại và chịu burst hiện có.
- Không tự mở billing, checkout, console/popup, quota tiles hoặc sửa pháp lý ngoài quyết định đã lưu.
- Không sửa AGENTS.md, không chạm secret hoặc dùng DB production cho test.
- Mỗi task: RED → sửa tối thiểu → GREEN → tự review diff. Commit theo checkpoint được giao,
  chỉ stage file task; không gộp/xoá thay đổi có sẵn. Không coi test local là nghiệm thu production.

## File map và giao diện chung

- `apps/api/src/billing/catalog.ts`: gói, đơn giá integer cents, nhóm API.
- `apps/api/src/billing/policy.ts`: thời hạn, available, eligibility và chu kỳ thuần.
- `apps/api/src/billing/types.ts`: contract reserve/prepare/ack/release/grant/usage.
- `apps/api/src/billing/quota-object.ts`: storage, transaction và RPC; export từ index.ts.
- `apps/api/src/billing/ledger.ts`: schema SQLite và thao tác transaction; không giữ transaction khi fetch.
- `apps/api/src/billing/commands.ts`: kiểm lệnh quản trị, revision/idempotency.
- `apps/api/src/billing/middleware.ts`: adapter route, response prepare/release và receipt headers.
- `apps/api/src/routes/billing-admin.ts`: quyền quản trị thuê bao qua Access + allowlist riêng.
- Test tương ứng `apps/api/test/billing-*.test.ts`, DB migration test ở `db/` nếu cần.

Contract phải thống nhất giữa các task:
```ts
type QuotaGroup = 'places' | 'directions';
type Tier = 'trial' | 'starter' | 'professional' | 'business';
type ReserveResult =
  | { allowed: true; requestId: string; deadline: string }
  | { allowed: false; reason: string; group: QuotaGroup; resetAt: string | null };
// requestId do server sinh, không lấy từ client.
// DO tự đọc clock; test điều khiển clock bằng fake timers.
// reserve(requestId: string, group: QuotaGroup): Promise<ReserveResult>
// prepare(requestId: string, tokenHash: string): Promise<SettlementReceipt>
// ack(requestId: string, token: string): Promise<SettlementReceipt>
// release(requestId: string, reason: string): Promise<SettlementReceipt>
// readReceipt(requestId: string): Promise<SettlementReceipt | null>
// compensate(requestId: string, operationId: string, reason: string): Promise<SettlementReceipt>
// readUsage(): Promise<UsageSnapshot>
// applyCommand(command: EntitlementCommand): Promise<CommandReceipt>
```
`SettlementReceipt` gồm requestId, state awaiting_ack/committed/released/expired/compensated, charged boolean;
unknown là lỗi riêng phải đối soát, không đồng nghĩa failure đã hoàn lượt. Giao diện compensate
và journal bền vững phải được kiểm chứng tại Task 0 trước khi code Task 3/5.
`UsageSnapshot` gồm trạng thái/period/endsAt và từng nhóm limit/used/reserved/available/credits;
`EntitlementCommand` là union activateTrial/grantPeriod/addCredits/suspend/resume, mang
operationId/actor/reason/expectedRevision; `CommandReceipt` lưu revision và payload hash.

## Task 0: Kiểm chứng các rủi ro kiến trúc trước triển khai chính

**Tiền kiểm 15/09/2026: PASS cho kiến trúc; [bằng chứng chi tiết](../../evidence/billing/2026-09-15-quota-preflight.md).**
Fixture local 29/29 pass. Strict ACK, cutover, checksum snapshot+journal restore, SQL billing
counters, timeout Postgres/Valhalla, tải staging mixed/sustained và wave origin 10 Places+4 tuyến
đã được kiểm chứng trong phạm vi cô lập. Pilot chốt tenant 2 Places+1 tuyến và origin 10+4 đang
xử lý. SDK trả data sau khi ghi receipt bền vững, ACK nền; request kế tiếp fail closed nếu ACK cũ
chưa rõ. `MAX_PENDING=2` chỉ là fixture. Runtime còn được triển khai ở Task 1–6.

Evidence giữ tại `docs/evidence/billing/2026-09-15-quota-preflight.md`; harness dùng một lần
đã xóa sau khi staging được dọn. Code spike không được mang sang production; Task 1–7 viết test
chính thức cho từng contract.

- [x] Xác nhận phiên bản: `pnpm --filter @mapslibvn/api exec wrangler --version`, đọc lock và chạy
  fixture DO SQLite transaction/RPC/alarm/restart bằng pool đang khoá; nếu thiếu compatibility chỉ
  đề xuất nâng đúng gói cần, không update toàn workspace.
- [x] Fixture local Worker+DO mô phỏng protocol cũ và client-ACK đã chọn. Fault injection từng biên:
  ACK mất sau commit, timeout trước commit, Worker crash, retry không thành công, alarm sau restart.
```text
Given: used=0, handler trả 2xx, DO commit used=1, ACK bị drop
When: Worker chọn trả 503 quota_unavailable
Then: có outcome bền vững để bù trừ idempotent; đối soát kết thúc used=0
And: settle success đến muộn không đảo compensated thành committed
```
- [x] Chứng minh local nguồn durable outcome khi Worker chết: pending receipt + alarm nằm trong DO
  trước handler, ACK commit retry idempotent; staging/backup vẫn là gate riêng. Nếu chỉ có waitUntil/log thì FAIL gate.
  Đánh giá giảm độ phức tạp protocol và trường hợp không xác định; không sửa chính sách tính phí
  lỗi để vượt test. Ghi rõ failure model không thể bảo đảm delivery exactly-once qua mạng.
- [x] Đo cả 2 RPC protocol cũ và 3 RPC client-ACK đã chọn với cache-only handler ở local và staging;
  kiểm mỗi request không kéo theo full scan/readUsage/resetAlarm thừa. Cohort staging 100 mẫu báo
  p50/p95/p99 client và p95/p99 `Server-Timing` DO; ghi request/row model và databaseSize.
- [x] Đo SQL cursor billing counters (11 reads/14 writes mỗi success), databaseSize và request
  model; GraphQL staging trả rỗng và theo tài liệu không phải hóa đơn chính xác. Lặp
  mixed/sustained/hot-tenant; giữ Usage/Billing production làm cổng vận hành sau pilot.
- [x] Viết fixture proof cutover cache cũ sau TTL, admission gate độc lập DO và ledger backup tail.
  Chứng minh HEAD không chạy handler, timeout query thật giải phóng resource. Fixture không chạm
  DB nhà đang phục vụ; đo PG/Valhalla bằng môi trường cô lập.
- [x] Ghi ngưỡng kiểm tra staging đề xuất: quota overhead p95 ≤100 ms, p99 ≤250 ms cho cache-hit;
  không quota-induced errors ở tải pilot được chọn; zero mismatch số đếm trong fault cases đã nêu.
  Strict cohort 100 mẫu đạt DO p95/p99 37/114 ms và client 167/226 ms, nhưng cohort 30 mẫu có spike;
  đây là PASS tạm cho fixture tuần tự, không phải SLA. Nếu tải lặp không đạt, sửa thiết kế hoặc
  review lại mục tiêu trước mở bán, không che overhead bằng latency DB.
- [x] Xác định `MAX_INFLIGHT_PLACES`, `MAX_INFLIGHT_DIRECTIONS` theo tenant và trần tổng origin
  từ load fixture; không tự đồng nhất reserved với mọi resource còn chạy sau timeout.
  Report số cold/warm, nhiều tenant, 4xx/5xx storm, cap và headroom cụ thể trước bật live.
  Pilot: tenant 2 Places+1 directions; origin 10 Places+4 directions. Đây là cap ban đầu,
  tăng chỉ sau soak test và server metrics.
- [x] Kết thúc: evidence ghi từng cổng, R1/R2/recovery có đường xử lý được kiểm chứng; staging
  đã xóa Worker và namespace. Cho phép bắt đầu Task 1, nhưng chỉ bật commercial sau khi các cổng
  runtime tương ứng ở Task 2–7 hoàn tất.

## Task 1: Catalog và quy tắc thuần

Files: tạo catalog.ts, policy.ts, types.ts; test `apps/api/test/billing-policy.test.ts`.

- [x] Viết test RED cho giá, tổng/ngày Free, 2xx, biên thời gian và tháng ngắn:
```ts
expect(PLAN_CATALOG.starter.places).toBe(30_000);
expect(PLAN_CATALOG.trial.dailyDirections).toBe(20);
expect(isBillableStatus(200)).toBe(true);
expect(isBillableStatus(503)).toBe(false);
expect(available(100, 98, 2)).toBe(0);
```
- [x] Chạy `pnpm --filter @mapslibvn/api test -- test/billing-policy.test.ts`, ghi lỗi RED đúng nguyên nhân.
- [x] Implement catalog và hàm thuần `isBillableStatus(status)`, `available(limit, used, reserved)`,
  `trialEndsAt(start)`, `periodBoundary(anchor, monthOffset)` với integer arithmetic và kiểm ngày hợp lệ.
```ts
export const isBillableStatus = (status: number) => status >= 200 && status < 300;
export const available = (limit: number, used: number, reserved: number) =>
  Math.max(0, limit - used - reserved);
```
- [x] Test anchor ngày 31 qua tháng 02 rồi trở lại 31/03, năm nhuận; trial end exclusive;
  `vnDay` lúc 16:59Z/17:00Z. GREEN lệnh trên rồi `pnpm typecheck`.
- [x] Review: không thay middleware/production. Checkpoint đề xuất `feat(billing): define plans and quota policy`.

## Task 2: DO storage và cấp quyền

Files: quota-object.ts, ledger.ts, commands.ts, `billing-object.test.ts`, env.ts/index.ts,
wrangler.toml/vitest.config.ts. Đọc phiên bản khoá hiện tại trước khi thêm SQLite binding.

- [x] RED: object mới không có quyền; activateTrial replay không reset; grant cùng operationId
  khác payload bị từ chối, revision cũ bị từ chối; số tiền/units âm hoặc packs lẻ bị từ chối.
  Thêm business receipt/line ID replay với operationId khác, kỳ overlap, kỳ tương lai không
  thay kỳ hiện tại, trial→paid với reservation đang chạy, integer overflow và payload >16 KiB.
```ts
const first = await object.applyCommand(trialCommand);
expect(await object.applyCommand(trialCommand)).toEqual(first);
expect((await object.readUsage()).places.limit).toBe(2_000);
```
  Fixture `trialCommand` chứa operationId duy nhất, actor test, tenantId fixture, reason và revision 0.
- [x] Chạy `pnpm --filter @mapslibvn/api test -- test/billing-object.test.ts` để xác nhận RED.
- [x] Tạo schema theo spec mục 5; transaction cho update quyền + event/receipt. Lưu timestamps UTC,
  amounts integer; parameterized SQL, unique operationId; derive units từ catalog server.
```sql
CREATE TABLE IF NOT EXISTS entitlement_events (
  operation_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
  receipt_json TEXT NOT NULL, created_at TEXT NOT NULL
);
```
- [x] Thêm QUOTA namespace và SQLite migration mới, cấu hình dev/test/production riêng;
  giữ default export Hono. Test dùng object ID riêng mỗi ca, không gọi production binding.
- [x] GREEN, kiểm restart object vẫn giữ quyền/counters. Kiểm snapshot trial/paid/suspended/expired.
  Checkpoint `feat(billing): persist tenant entitlements in durable objects`.

## Task 3: Reserve/prepare/ack đồng thời và recovery lease

Files: ledger.ts, quota-object.ts; `billing-reservations.test.ts`.

- [x] RED cho 50 request tranh lượt cuối:
```ts
const results = await Promise.all(Array.from({ length: 50 }, (_, i) =>
  object.reserve(`last-unit-${i}`, 'places')));
expect(results.filter((r) => r.allowed)).toHaveLength(1);
```
  Fixture cấp period test có limit 1 qua helper storage chỉ có trong test, không public command.
- [x] Chạy `pnpm --filter @mapslibvn/api test -- test/billing-reservations.test.ts`.
- [x] Transaction reserve kiểm trạng thái/thời gian, cả daily+total với trial; chọn base rồi credits;
  giữ period/day/source grant trong reservation. Idempotent requestId gắn group/payload.
  Kiểm in-flight trong cùng transaction; dùng storage.transactionSync cho chuỗi SQL không await.
  Index deadline/state, expiresAt và retention; query bound, không scan 35 ngày mỗi request.
```text
BEGIN transaction
  return receipt nếu requestId đã tồn tại và cùng group
  reject nếu hết quyền hoặc used + reserved >= limit
  tăng reserved; insert reservation cùng period/day và lease
COMMIT
```
- [x] Handler 2xx `prepare` chuyển reserved→awaiting_ack và giữ chỗ, chưa tăng used; failure
  `release`. ACK token hợp lệ chuyển awaiting_ack→used đúng nguồn; repeat idempotent. Mất ACK RPC
  ở mọi biên theo proof Task 0; expired/released không được hồi sinh. Token chỉ lưu hash.
  Không dùng waitUntil làm write chính hoặc bằng chứng client nhận response.
- [x] Áp cửa sổ pilot missing-ACK đã chốt: 3 receipt awaiting_ack hết hạn/24 giờ/tenant thì
  reserve trả 429 `ack_required`; tự mở khi cửa sổ trôi. Admin mở sớm qua operationId/actor/reason,
  audit và idempotency; test false-positive và không tạo alarm/write mới cho request đã deny.
- [x] Alarm idempotent + lazy cleanup mỗi reserve; lease 120s, processing deadline 30s,
  lazy cleanup ≤32 row, alarm ≤100 row; không setAlarm nếu lịch không đổi. Test clock trong DO
  được kiểm ở Task 0, không giả định fake timers test driver tự thay clock isolate.
  Tombstone 35 ngày nhưng không xoá pending/unknown; test restart/giao kỳ/late RPC quá lease.
- [x] GREEN: hai tenant độc lập, request qua nhiều key chung tenant, nhóm độc lập; checkpoint
  `feat(billing): reserve and acknowledge quota atomically`.

## Task 4: Giao diện quản trị và migration tenant

Files: billing-admin.ts, access.ts/env.ts/index.ts; auth.ts, DB migration kế tiếp chưa dùng,
DB test và `billing-admin.test.ts`. Không để test Workers cần Postgres thật.

- [x] RED: thiếu JWT, JWT đúng nhưng email không có quyền billing, public Places key,
  sai tenant, replay grant, revision stale và suspend/resume; JWT issuer sai; cache legacy còn
  sống sau cutover; revoked key còn trong KV; rollback về build cũ không được mở bypass.
```ts
expect((await SELF.fetch('https://api/v1/admin/billing/tenant/usage')).status).toBe(401);
```
- [x] Chạy `pnpm --filter @mapslibvn/api test -- test/billing-admin.test.ts`.
- [x] Implement `/v1/admin/billing/:tenantId/commands` và `/usage`, Access JWT +
  allowlist BILLING_ADMIN_EMAILS (rỗng = deny). Validate UUID, union command và actor lấy từ JWT;
  không tin actor/price client. Đảm bảo tenant tồn tại trước provision, không tạo DO tùy ý vô hạn.
  API commands có body cap 16 KiB, exact Origin/CSRF nếu cookie-backed UI, không dựa vào CORS
  để phân quyền. Valid JWT issuer/audience/expiry/email; billing allowlist tách quyền duyệt POI.
  Business receipt phải gắn tenant ở backend để không dùng lại receipt cho tenant khác.
- [x] Thêm `quota_mode` legacy/commercial mặc định legacy bằng migration up/down;
  auth đọc tương thích rollout như mẫu to_jsonb đang dùng. Mutation mode chỉ qua quản trị,
  admission gate và absolute cache expiry theo spec 14.2; tenant commercial chưa có entitlement
  fail closed. Đưa revoked key hash vào DO commercial. Không chọn internal bypass trước kiểm
  mode; commercial+internal là lỗi cấu hình. Thêm pre-auth edge guard trước KV/DB.
- [x] Kiểm migrate/backward-compatible reads trong DB fixture: `pnpm image:build`,
  `pnpm test:db`, `pnpm test:api-db`; GREEN API test. Checkpoint `feat(billing): manage entitlements securely`.

## Task 5: Nối middleware bảy API và hợp đồng lỗi SDK

Files: billing/middleware.ts, quota.ts, errors.ts/env.ts/index.ts; bảy routes nếu cần cancellation;
packages/core/src/errors.ts/client.ts và test tương ứng; `billing-middleware.test.ts`;
packages/core/src/navigation/navigator.ts và navigator.reroute.test.ts cho hành vi hết quota.

- [x] RED: 2xx/cache/empty charge; 400/404/503 release; HEAD/OPTIONS không charge; giữ burst;
  commercial không được bỏ quota khi QUOTA_ENABLED=0; lỗi quota đúng group/reason/actions.
  HEAD trả 405/handlerCalls=0; same URL khác tenant và pending POI không rò dữ liệu; external
  no-store không đổi internal cache; quota hết/revoked key không được phục vụ từ browser/CDN.
```ts
await callFixtureRoute({ status: 503 });
expect((await object.readUsage()).places.used).toBe(0);
const response = await callFixtureRoute({ status: 200 });
await acknowledgeReceipt(response.receiptId, response.receiptToken);
expect((await object.readUsage()).places.used).toBe(1);
```
  `callFixtureRoute` là helper test gọi Hono route gắn middleware thật, auth fixture, handler status.
- [x] Chạy `pnpm --filter @mapslibvn/api test -- test/billing-middleware.test.ts`.
- [x] Branch commercial sau requireAuth/burst → reserve → handler → await prepare/release. Kiểm Hono
  onError có thể biến throw thành response; status 2xx trả receipt ID/token qua contract versioned,
  client gọi `POST /v1/quota/receipts/:receiptId/ack` bằng API key gốc và token; endpoint không tiêu
  quota nhưng có tenant binding/body cap/rate limit. Response data expose ba header receipt theo spec.
  Bốn SDK resolve data sau khi decode trọn body, lưu receipt rồi ACK nền; trước request data kế tiếp
  flush ACK cũ với retry hữu hạn. ACK vẫn chưa xác định thì trả `quota_ack_pending`, không tạo receipt
  mới và không giữ key/body. Raw REST phải ACK rõ trong docs.
  Request ID sinh trước handler, giữ cùng ID trong error/audit; external response private,no-store,
  không cache/log receipt token. Revoke/suspend trước ACK làm receipt expiry không charge và không
  cộng missing-ACK gian lận.
  Validation rẻ trước reserve, parser tái dùng. Request reject không ghi reservation. Xử lý HEAD
  theo raw method trước Hono GET handler, thêm 405/Allow vào error contract nếu cần.
- [x] Deadline/cancellation thật: AbortSignal fetch, statement timeout/cancel DB tương ứng,
  chặn success sau deadline và hoàn đúng lỗi; routing giữ timeout ngắn hiện có. Kiểm body
  serialization trước commit. Retry một lần bổ sung khi retryable, stub mới+jitter; overloaded
  không retry. Cancellation/statement timeout phải không rò session setting qua Hyperdrive pool.
  DO outage không chờ vô hạn. Tích hợp cap origin/gateway theo số đo Task 0 trước mở commercial.
- [x] Error details optional giữ SDK tương thích; bỏ retry-after 3600 chung cho commercial;
  resetAt chỉ khi thật có quyền reset. Metadata thêm trên response copy, không làm nhiễm cache chung.
  External response private,no-store; error/usage cũng vậy. SDK optional details/retryAfter, CORS
  expose cần thiết. Navigation gặp hết quota dừng retry tự động, giữ tuyến hiện tại; không ép popup.
- [x] GREEN API + core client tests; internal/legacy regression. Checkpoint `feat(api): enforce commercial quota`.

## Task 6: Backup, đối soát và runbook migration

Files: scripts/quota-audit.mjs + test, billing-admin.ts (snapshot qua quyền riêng),
docs/evidence/billing/2026-09-15-quota-rollout.md, Setup_Local_Guide.md.

- [x] RED: snapshot checksum sai bị từ chối, grants replay không tăng credit; restore snapshot
  cũ không tự cấp lại lượt đã dùng; lệnh audit không ghi thông tin key/query/location.
```text
snapshot used=10; ledger sau checkpoint commit thêm 3
reconcile phải cho used=13, không cho reset về 10
```
- [x] Implement export aggregate/audit tới bucket backup riêng, không public; import/reconcile
  chỉ trong maintenance với operationId/revision. Có bằng chứng traffic đã dừng khi phục hồi.
  Journal sequence/tail độc lập theo Task 0; tail thiếu thì dừng phục hồi, không giả định usage=0.
  Export grants/periods/entitlement/trial-used/dedup+reservations, cursor ≤100 record/256KiB.
  Chỉ advance checkpoint sau durable export; aggregate 13 tháng; không xoá pending/unknown.
  Unique business identity không mất khi restore và không giới hạn ở operationId.
- [x] Bổ sung hướng dẫn cụ thể: provision DO → đóng admission gate → vô hiệu cache và kiểm absolute expiry →
  bật mode qua admission gate → thử nhiều key → mở traffic. TTL không là bằng chứng duy nhất.
  Rollback thương mại dừng tenant tại gate độc lập ledger, không fallback KV.
- [x] Chạy test `pnpm exec vitest run scripts/quota-audit.test.mjs` và drill trên tenant thử;
  lưu evidence timestamp/config/revision/checksum. Không đánh dấu nghiệm thu nếu chỉ có script.
  **XONG 15/09:** test xanh, và drill chạy THẬT trên production — xuất sổ tenant `…dc`, kiểm file
  `.enc` độc lập, nạp sang object khác `…dd`, đối chiếu khớp từng trường (`tier`, `used=50`,
  `limit`, `periodId`, `endsAt`), rồi tắt bảo trì khép chu trình. Evidence mục 7b.
- [x] Checkpoint `feat(billing): audit and recover quota state` — commit a95b46e.

## Task 7: Docs, đo tải và release gate

Files: docs api.md/khoa-api.md, core README nếu error thay đổi, scripts/load-api.mjs/test,
docs/evidence/billing/2026-09-15-quota-rollout.md, DEVLOG.md.

- [x] Cập nhật quota ngày/tháng/trial, retry, reset, credits, examples lỗi; không công bố console
  hoặc payment chưa xây. Phân biệt rate-limit theo edge với quota thương mại theo tenant.
- [x] Fixture đo warm/cold, hit/miss, một tenant nóng/nhiều tenant; giữ pace không vướng burst
  trong đo overhead quota, có lượt đo riêng chứng minh burst còn hoạt động. Đo A/B cùng dữ liệu.
- [ ] **MỘT NỬA 15/09.** ĐÃ CÓ: p50/p95/p99 và errors trên production, chi phí quota tách theo
  từng vòng gọi bằng `Server-Timing`, và nguyên nhân độ trễ đã truy tới gốc (object đặt sai chỗ;
  `locationHint: apac-se` đưa một vòng gọi từ ~280 ms xuống ~50–76 ms). CÒN THIẾU: reservation
  backlog, CPU/storage/request counts, và chi phí tiền theo giá Cloudflare chính thức — chưa mở
  Usage/Billing lần nào. Còn ~208 ms chênh giữa đo đầu-cuối và tổng `Server-Timing` chưa giải thích.
  Lưu p50/p95/p99, errors, reservation backlog, CPU/storage/request counts; tính chi phí
  theo giá Cloudflare chính thức tại thời điểm đo, gồm rows/index/delete/alarm/duration/storage,
  backup và outcome recovery. Giới hạn Free là toàn account, không mỗi tenant. Không suy RPS từ
  quota tháng. Đo thêm failed-request storm, nhiều ngày retention, admin/export tranh với data RPC.
- [x] Full gate (15/09/2026, tất cả xanh):
```sh
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```
- [ ] **GẦN XONG 15/09.** `pnpm smoke:commercial` ĐẠT 25/25 trên production; thêm credits, replay,
  business identity và trial→paid chạy thật; đối chiếu 15 tiêu chí gốc cho **10/15 chứng minh trên
  production, 4 dựa test, 1 chưa kiểm** (evidence mục 7c). Ba tiêu chí còn thiếu bằng chứng
  production đều tốn thời gian thật (2.000 request, 30 ngày, giao ngày) chứ không thiếu cơ chế.
  `pnpm smoke:commercial` ĐẠT 25/25 trên production: receipt, chưa ACK chưa
  trừ, ACK idempotent, 4xx không trừ, HEAD 405, hai khoá chung sổ, bảo trì 503, đình chỉ 403. Thêm
  trần ngày trial và thu hồi khoá chứng minh ngoài kịch bản. CHƯA: trial hết tổng, trial hết hạn
  30 ngày, paid hết nhóm, credits, DO outage, restart — và chưa đối chiếu có hệ thống 15 tiêu chí
  gốc với evidence. Smoke staging commercial tenant: trial hết ngày/tổng/thời hạn, paid hết nhóm, credits,
  DO outage, restart, nhiều key. Đối chiếu 15 tiêu chí gốc + spec 14.9 với evidence cụ thể.
- [ ] **CHỜ PHONG.** ĐÃ CÓ: backup+rollback diễn tập thật (mục 7b), inventory tenant/mode đã lập
  bằng `pnpm server:tenants` (5 tenant, 2 commercial, cả hai là tenant thử, không có internal +
  commercial). CÒN THIẾU: ngưỡng latency/cost do PHONG duyệt, và chi phí tiền theo Usage/Billing. Trước bật production: đạt ngưỡng latency/cost do PHONG duyệt từ báo cáo đo, CI đúng commit,
  inventory tenant/mode, backup+rollback verified; chưa có evidence thì giữ commercial không mở.
- [ ] Checkpoint `docs(billing): record commercial quota acceptance` chỉ khi đủ bằng chứng;
  cập nhật kết quả thật và việc còn lại vào DEVLOG, không tick hộ bước chưa chạy.
  **15/09: CHƯA đủ bằng chứng** (thiếu số đo A/B và drill staging) nên commit tài liệu dùng
  thông điệp mô tả đúng việc đã làm, không dùng chữ "acceptance". DEVLOG mục 17 đã ghi kết quả
  thật và danh sách việc còn lại.

## Đối chiếu coverage và điểm bắt đầu

Spec 14 và mọi blocker trong báo cáo: Task 0 trước tích hợp;
Spec 1–4/6/8: Task 1–3; spec 5: Task 2/4; spec 7: Task 3/5;
spec 9: Task 4/5/7; spec 10: Task 4/6/7; spec 11–12: test của từng task và gate Task 7.
Retention 35 ngày/13 tháng triển khai cleanup trong Task 3/6; payment thật vẫn chờ spec provider.
Task 0 là bước tiếp theo sau review. Không cần chọn lại giá hoặc hỏi lại chính sách 2xx đã được duyệt.


## Chuyển tiếp bắt buộc ngay sau Quota — PHONG yêu cầu 15/09/2026

Sau khi hoàn tất nghiệm thu plan Quota, **ngay lập tức bắt đầu thiết kế rồi triển khai Trang Admin
quản lý/theo dõi hệ thống**. Đây là công việc tiếp theo đã được PHONG chỉ định, không đổi sang
feature khác và không cần hỏi lại có muốn làm Admin không. Quy trình vẫn thiết kế → review → plan → code.

Phạm vi Admin phải có trong spec kế tiếp:
- Quản lý tổ chức/khách hàng, trạng thái, cấp trial và gói, gia hạn, upgrade/downgrade theo điều khoản,
  đình chỉ/mở lại, hạn mức và cấp lượt mua thêm/hoàn lượt có audit.
- Cấp/phân quyền/thu hồi/rotate API key; web/mobile/server, scopes, allowed origins, xem usage theo key;
  không hiển thị lại secret đã cấp. Tổng quota vẫn theo thuê bao.
- Dashboard hệ thống: RPS, p50/p95/p99, 4xx/5xx, timeout, rate-limit vs quota, DO backlog/overload,
  DB connections/slow queries/CPU/RAM/disk, Valhalla latency/queue/errors, cache, backup/data update.
- Cảnh báo dịch vụ chết/chậm/nghẽn, probe từ bên ngoài máy chủ nhà, lịch sử incident và xác nhận xử lý.
- Quản trị viên có vai trò rõ; tách quyền xem vận hành, quản lý key, quản lý thuê bao/điều chỉnh tiền;
  audit ai đổi gì/lý do, bảo vệ endpoint bằng xác thực và chống CSRF phù hợp.
- Crash app/SDK là tích hợp client tùy chọn với quyền và dữ liệu tối thiểu; không nhầm health API
  với phát hiện mọi crash trên điện thoại của khách.
- Giữ chức năng duyệt POI hiện có. Dùng API quản trị/usage của Quota, không tạo bộ đếm thứ hai.

Tiêu chí bàn giao Quota: ghi bằng chứng nghiệm thu, tồn đọng thật và tạo spec Admin làm bước kế tiếp.
Khi chờ gate Quota có thể chuẩn bị thiết kế Admin độc lập, nhưng không coi Quota đã hoàn thành.
