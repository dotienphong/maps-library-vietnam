# Đặc tả quota thương mại — giai đoạn 1

Ngày: 15/09/2026. PHONG duyệt hướng spec; rà soát bổ sung cùng ngày theo yêu cầu review kỹ.
Bản sau review có các ràng buộc mục 14 và cổng kỹ thuật Task 0; chưa coi là đã chứng minh an toàn runtime.
Nguồn quyết định: `docs/research/2026-09-14-thuong-mai-hoa-va-gia-chot.md`.
Phạm vi đã được yêu cầu tiếp tục: quota dùng chung theo thuê bao, trial, chu kỳ và lượt mua thêm.
Hướng DO với reserve/prepare/client ACK và các lựa chọn trong phạm vi giai đoạn 1 đã được duyệt theo spec.
Các phần ghi ngoài phạm vi (thanh toán, VAT, tiles, tự tính tiền nâng/hạ) vẫn cần spec riêng.

## 1. Mục tiêu và phạm vi

Khách chỉ dùng được số lượt đã cấp, mọi key của cùng tenant dùng chung hạn mức.
Không nhân quota bằng cách đổi key, không mất số đếm khi request đồng thời hoặc Worker restart.
Đảm bảo trial theo cả ngày, tổng và thời hạn; Places hết không chặn directions còn lượt.
Lưu lịch sử cấp quyền và tiêu thụ để đối soát; Analytics Engine vẫn phục vụ quan sát.

Trong phạm vi: bộ máy quota, giao diện nội bộ cấp quyền có xác thực, báo cáo usage theo tenant,
adapter middleware bảy endpoint, hợp đồng lỗi SDK, kiểm thử, tài liệu và rollout kiểm soát.
Chưa bao gồm: checkout/webhook nhà cung cấp thanh toán, đăng ký/console/popup hoàn chỉnh,
VAT/hoá đơn, tự tính tiền nâng/hạ gói, hạn mức tiles hoặc hệ thống chống nhiều tài khoản Free.
Các phần đó nối vào hợp đồng quota; hoàn tất giai đoạn này chưa đủ để mở bán tự phục vụ.

## 2. Các con số đã chốt

| Gói | USD/tháng | Places/kỳ | Directions/kỳ | Giới hạn ngày |
|---|---:|---:|---:|---|
| Free trial | 0 | 2.000 tổng | 200 tổng | 200 Places + 20 directions |
| Starter | 25 | 30.000 | 3.000 | Không thêm trần ngày thương mại; vẫn chống burst |
| Professional | 100 | 100.000 | 10.000 | Như Starter |
| Business | 400 | 400.000 | 40.000 | Như Starter |

Trial dài 30 ngày. Mua thêm theo khối nguyên 1.000 lượt: Places $1, directions $3.
Online support chỉ Professional/Business: T2–T6 08:00–20:00; T7/CN 08:00–17:00 giờ VN.
Giá không được đọc từ dữ liệu client gửi lên; lưu số tiền bằng đơn vị nhỏ nhất nguyên.

## 3. Hiện trạng đã kiểm tra

- `apps/api/src/quota.ts`: mặc định 20.000/2.000 mỗi ngày; KV get/put theo key hash/ngày/nhóm,
  chặn ở 2×. `internal` bỏ qua quota thương mại nhưng còn burst limit.
- `apps/api/src/auth.ts`: key hash, tenantId, scope/origin, KV cache auth; plan chỉ internal/free/paid.
- `db/migrations/0005_tenant.sql`, `0010_api_key_hash.sql`, `0012_api_key_quota_directions.sql`:
  có tenant/key và override ngày, không có trial expiry hoặc sổ tiêu thụ chu kỳ.
- `apps/api/src/errors.ts`: lỗi có code/message/request_id; 429 mặc định retry-after 3600.
- `apps/api/src/routes/*`: requireAuth → quota → handler, validation và cache nằm trong handler.
- `apps/api/vitest.config.ts`: Workers pool; DB cố tình trỏ cổng đóng. Không đưa DB thật vào test này.
- `apps/api/wrangler.toml`: production bật quota, chưa có Durable Object binding/migration.

## 4. So sánh hướng triển khai

| Phương án | Lợi ích | Hạn chế | Kết luận |
|---|---|---|---|
| Giữ KV và sửa con số | Ít thay đổi | Không nguyên tử, vẫn mất lượt/không đúng quota | Loại |
| Postgres transaction cho mỗi lượt | Dùng hạ tầng quen thuộc, đối soát tập trung | Request cache cũng ghi DB tại nhà, tăng độ trễ và điểm phụ thuộc | Phương án dự phòng nếu DO không đạt đo tải |
| SQLite Durable Object theo tenant | Kho dữ liệu nhất quán, quota tách khỏi DB POI, cùng tenant dùng cùng sổ | Thêm binding, chi phí và quy trình backup/khôi phục | Đề xuất |

Nguồn chính thức đã đọc 15/09/2026:
- https://developers.cloudflare.com/kv/concepts/how-kv-works/
- https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- https://developers.cloudflare.com/durable-objects/api/alarms/

Cloudflare khuyến nghị SQLite cho namespace DO mới. Storage là transactional/strongly consistent;
vẫn phải dùng transaction nguyên tử, không suy ra mọi đoạn async trong object tự được tuần tự hoá.
Không thay phiên bản dependency hàng loạt; kiểm compatibility Wrangler/types/Workers pool đã khoá
trước khi lập plan. Không mặc định xem DO là miễn phí hoặc không giới hạn throughput.

## 5. Quyền sở hữu dữ liệu và hợp đồng nội bộ

Một DO được định danh bằng tenantId do requireAuth xác thực; client không được chọn tenant từ query.
Mỗi tenant có tối đa một thuê bao hoạt động ở giai đoạn đầu. Tất cả key/project của tenant cộng chung.
Postgres vẫn sở hữu tài khoản/key; DO sở hữu quyền sử dụng thương mại và sổ tiêu thụ.
Không lấy paid/free từ auth cache làm nguồn quyết định còn hạn mức. Tier thực đọc trong DO.
Không cho request data API tự tạo trial, tự đổi plan hoặc kéo dài thời hạn.

Kho dữ liệu DO dự kiến:
- entitlement: trạng thái, tier, revision, trial_started_at/trial_ends_at, trial_used_once.
- periods: period_id, start/end UTC, tier/limits, trạng thái cấp quyền.
- counters: used/reserved theo period/group và ngày VN khi trial.
- grants: grant_id, group, units, used/reserved, expires_at, tham chiếu giao dịch cấp quyền.
- reservations: request_id do server sinh, group, period/day, nguồn lượt đã giữ,
  state reserved/awaiting_ack/committed/released/expired/compensated, token hash, deadline và timestamps;
  không lưu token thô, query, toạ độ hoặc key thô.
- entitlement_events: operation_id duy nhất, actor, payload hash, revision, thời gian và lý do.

Các thao tác nội bộ:
- activateTrial(operationId, tenant): một lần, không reset khi đổi key.
- grantPeriod(operationId, start, end, tier, expectedRevision): cấp kỳ đã được xác nhận quyền sử dụng.
- addCredits(operationId, paymentReference, group, packs): cộng đúng packs × 1.000.
- suspend/resume(expectedRevision, reason): đình chỉ theo quyết định quản trị.
- reserve(requestId, group), prepare(requestId, tokenHash), ack(requestId, token),
  release(requestId, reason), readReceipt(requestId), readUsage().

Không expose DO trực tiếp ra internet. Điều khiển qua backend quản trị có Access JWT đã xác minh
và quyền quản trị thuê bao; không dùng key places:read để cộng tiền/quota. Có audit actor/reason.
Operation cùng ID/cùng payload trả kết quả cũ; cùng ID/khác payload bị từ chối.
Lệnh đổi quyền có revision tránh sự kiện cũ ghi đè mới. Nếu backend crash sau khi DO đã áp dụng,
retry cùng operationId đối soát được. Lịch sử thanh toán tương lai là bản ghi nghiệp vụ riêng,
trạng thái applied chỉ xác nhận sau khi DO đã áp dụng; không dual-write không kiểm soát.

## 6. Quy tắc tính lượt — PHONG đã chốt 15/09/2026

PHONG chọn “Chỉ trừ lượt thành công (đề xuất)” và ngày 15/09/2026 chốt thêm hướng nghiêm ngặt
**client ACK kết quả thành công** sau Task 0. Quy tắc mục tiêu: chỉ trừ khi server tạo phản hồi 2xx
và client/SDK gửi ACK hợp lệ cho receipt của phản hồi đó, kể cả kết quả rỗng/cache;
không trừ lỗi 4xx/5xx, chống lạm dụng vẫn áp dụng cho request lỗi:
- Sáu endpoint autocomplete/search/nearby/places/geocode/reverse: mỗi request thành công = 1 Places.
- directions: một phản hồi thành công = 1 tuyến, trong giới hạn tham số/độ phức tạp hiện có.
- Kết quả rỗng, cache hit, stale response thành công vẫn tính một lượt.
- 4xx/5xx, OPTIONS/HEAD, health, styles/tiles, edits, usage không trừ Places/directions.
- Burst/rate limit vẫn kiểm request lỗi. Lỗi validation hiện xảy ra sau quota phải được release.
- Retry request với cùng requestId và ACK cùng receipt token phải idempotent. Retry bằng requestId mới
  là request mới; SDK phải tự retry ACK cũ trước khi phát request dữ liệu mới.
- ACK chứng minh client có token trong response 2xx, không chứng minh người dùng đã đọc/xử lý payload
  hoặc nhận từng byte trước khi kết nối đứt. Raw REST và bốn SDK phải cùng mô tả giới hạn này.

Hợp đồng public mục tiêu để triển khai đồng nhất:
- Response 2xx của bảy data API mang `X-MapsLibVN-Receipt-Id`, `X-MapsLibVN-Receipt-Token` và
  `X-MapsLibVN-Receipt-Expires-At`; ba header được CORS expose và toàn response là `private, no-store`.
  Không đưa token vào log, Analytics Engine, cache key hoặc error telemetry.
- Raw REST gọi `POST /v1/quota/receipts/:receiptId/ack` với API key gốc và token trong JSON body.
  Endpoint ACK không tiêu quota nhưng có auth, tenant binding, body cap và rate limit chống dò token.
  ACK đúng hoặc replay sau commit trả 200 cùng receipt; token sai trả 403; receipt hết hạn/đóng trả 409.
- SDK chỉ ACK sau khi đã nhận và decode trọn response, nhưng không chặn dữ liệu đã decode trong lúc
  chờ ACK: resolve data cho caller, ghi receipt vào hàng đợi bền vững rồi thử ACK nền ngay. Trước
  request data kế tiếp, SDK flush ACK cũ với một retry hữu hạn trong deadline; nếu vẫn chưa xác định,
  trả `quota_ack_pending` có retryable=true thay vì tạo thêm receipt. Giới hạn kích thước/số receipt
  chờ phải được chốt theo từng SDK trước public launch; không lưu API key hoặc response body trong
  hàng đợi. Cách này giữ quy tắc chỉ charge sau ACK mà không cộng thêm round-trip ACK vào latency trả data.
- Nếu API key bị revoke/suspend trước ACK thì ACK bị từ chối, receipt tự expiry và không charge.
  Việc này ưu tiên khách và không được tính thành missing-ACK do gian lận; DO cần reason riêng cho
  revoke/suspend cleanup để không khóa oan tenant.

## 7. Giữ lượt trước, chốt lượt sau

1. Chặn abuse ở edge trước KV/DB; xác thực key + tenant và kiểm burst.
   OPTIONS kết thúc ở CORS; HEAD trên bảy API dữ liệu trả 405 sớm, không chạy GET handler,
   không reserve/DB/Valhalla. Các route metadata/tiles có semantics riêng giữ nguyên.
2. DO kiểm trạng thái, thời hạn và available = limit + grants - used - reserved.
   Trial đồng thời kiểm quota ngày và tổng. Kiểm + giữ một lượt trong một transaction.
3. Chỉ khi reserve thành công mới gọi handler. Không giữ transaction mở trong lúc query/fetch.
4. Handler 2xx: DO chuyển reservation sang `awaiting_ack`; reserved vẫn giữ chỗ, `used` chưa tăng.
   Response trả receipt ID + token ngẫu nhiên và `private, no-store`. 4xx/5xx: release.
5. Client/SDK ACK bằng receipt ID + token. DO chỉ lưu hash token; transaction chuyển sang committed,
   reserved giảm và used tăng. ACK lặp trả receipt cũ, không tăng used lần hai; ACK sai/replay tenant
   khác bị từ chối. Không dùng `waitUntil` làm bằng chứng client đã nhận response.
6. Receipt không ACK hết lease chuyển expired, reserved giảm, used giữ nguyên. Fault trước ACK luôn
   nghiêng về phía khách. Mất response của chính lệnh ACK sau commit được client retry cùng token.
   DO lỗi trả 503 quota_unavailable, không fallback KV hoặc bỏ qua quota.

Reservation phải có lease bền vững. Đề xuất deadline xử lý 30 giây, lease 120 giây;
worker không được commit quá deadline/lease. Thực thi timeout/cancellation phù hợp DB và fetch,
không chỉ Promise.race bỏ mặc truy vấn chạy mãi. Alarm và reserve mới dọn lease hết hạn;
alarm lặp lại phải idempotent, không đếm hoặc hoàn lượt hai lần.
Reservation expired không được hồi sinh bởi ACK đến muộn; response 2xx có thể đã được client nhận
nhưng không tính lượt nếu ACK không đến — đây là sai số có lợi cho khách đã được PHONG chọn.
DO crash không làm mất reservation. Request xử lý sát giao ngày/kỳ luôn commit/release vào period/day lúc reserve.

Đề xuất retention: reservation/tombstone 35 ngày, aggregate kỳ và grant/event audit 13 tháng;
dọn theo batch có giới hạn. Operation tài chính có tombstone tối thiểu suốt cửa sổ replay của hệ
thống thanh toán, không xoá ID rồi cho phép cộng lại. Chốt retention tài chính khi chọn provider.
Không cho phép grant/payment thật trước khi có quy tắc retention và đối soát được nghiệm thu.

## 8. Trial, chu kỳ và credits

Trial: [start, start + 30 × 24h), tổng không reset. Ngày địa phương reset 00:00 Asia/Ho_Chi_Minh.
Tại thời điểm end thì hết quyền; request đã reserve trước đó commit/release vào trial cũ.
Không cần cron mới chặn hết hạn: kiểm timestamp ở mỗi reserve.

Trả phí theo spec đã duyệt: chu kỳ theo ngày/giờ kích hoạt tháng lịch, giữ anchor gốc khi tháng thiếu ngày
(31/01 → ngày cuối tháng 02 → 31/03). Lưu start/end UTC rõ ràng, không lấy 30 ngày thay mọi tháng.
Chỉ grant kỳ tiếp theo sau xác nhận thanh toán; ngày reset không tự phát lượt miễn phí.
Adapter quota nhận kỳ explicit từ backend; việc tính giá nâng/hạ nằm ngoài giai đoạn này.

Credits theo spec đã duyệt: chỉ khách có thuê bao trả phí đang hoạt động mua được; dùng lượt trong gói trước,
sau đó credits sớm hết hạn trước; credits hết hạn cùng kỳ mua và không chuyển kỳ.
Hết thuê bao không được dùng credits tiếp. Không quảng cáo hạn mức nâng/hạ chưa triển khai.
Thêm credits nhóm nào chỉ mở lại nhóm đó. Free hết quota ngày chờ ngày mới hoặc nâng gói.
Nâng trial sang paid tạo period mới sau thanh toán, giữ lịch sử trial và trial_used_once.
Không reset usage paid khi chỉ đổi key, cấp lại key hoặc replay cấp kỳ.

## 9. Hợp đồng lỗi/usage và trải nghiệm khách

Giữ envelope error.code/message/request_id; thêm quota details theo cách tương thích:
group, reason (daily/period/trial_total/trial_expired/subscription_expired), reset_at khi thực
sự có reset cấp quyền, actions (upgrade/buy_more/wait/renew). URL upgrade thuộc console cấu hình,
không chấp nhận URL tùy ý từ client. 429 quota_exceeded cho hết lượt; 403 subscription_expired
cho hết quyền, 503 quota_unavailable khi sổ quota lỗi. 429 rate_limit_exceeded vẫn riêng.
Retry-After chỉ đưa khi biết thời điểm phù hợp; không dùng 3600 chung cho trial đã hết vĩnh viễn.
Trial hết ngày có reset; tổng trial hết không tự có reset; paid chưa thanh toán kỳ sau không hứa reset.

Usage đầy đủ chỉ trả cho chủ tenant hoặc admin đã xác thực, không expose lịch sử giao dịch
qua key web/mobile công khai. Giai đoạn này cung cấp hợp đồng nội bộ và test adapter quản trị,
console sau dùng cùng số liệu: limit, used, reserved, available, grant balance, ends_at.
Không cộng snapshot Analytics hoặc KV vào balance. Popup dành cho người mua API trong console;
SDK trả lỗi để ứng dụng khách tự chọn UI cho người dùng cuối.

## 10. Rollout, bảo mật và khôi phục

- Bổ sung binding QUOTA + SQLite class migration rõ cả dev/test/production; không trỏ môi trường
  test vào DO production. Export class giữ nguyên default Hono worker export.
- Chế độ migration tenant server-side: legacy hoặc commercial. Tenant commercial thiếu entitlement
  bị từ chối, không fallback quota cũ. Không để QUOTA_ENABLED=0 vô tình bypass commercial tenant.
- Auth cache KV có TTL 5 phút nhưng không coi chờ TTL là ranh giới an toàn. Cutover/key
  revocation theo mục 14.2: admission gate, cache hard expiry và thu hồi quyền bền vững.
  Không tự chuyển toàn bộ tenant.
- Internal/demo giữ miễn quota thương mại và burst hiện tại; không thay quyền mà chưa kiểm inventory.
- KV số đếm cũ xấp xỉ không nhập thành hóa đơn thật. Pilot cấp kỳ/trial mới tại thời điểm cắt rõ ràng.
- Rollback tenant commercial về bản quota cũ không được mở vượt lượt: tạm dừng tenant commercial,
  giữ DO/ledger nguyên vẹn rồi sửa. Không deleteAll/reset object để chữa lỗi.
- Export audit/aggregate có checksum sang bucket backup riêng không public. Drill phục hồi DO phải
  dừng traffic và đối chiếu grants/usage kể từ checkpoint; PITR đơn thuần có thể làm hồi lượt đã dùng.
- Các API vẫn đọc Places/routing từ hạ tầng tại nhà theo quyết định PHONG; DO không di chuyển POI DB.

## 11. Files, quy ước và lệnh dự kiến

Thêm `apps/api/src/billing/` (catalog, policy, quota object, entitlement commands) và test tương ứng
ở `apps/api/test/`. Adapter trong quota.ts, env.ts, index.ts, errors.ts, cấu hình Workers pool/Wrangler.
Nếu cần thêm cột migration tenant: migration số kế tiếp chưa dùng, up/down và dbtest riêng;
không tái sử dụng hoặc sửa migration đã chạy. Docs cập nhật api.md/khoa-api.md và Setup_Local_Guide.md.
Không sửa AGENTS.md, không log key/token/toạ độ, không trộn refactor ngoài phạm vi.

Giữ TypeScript strict, hàm thuần cho policy/chu kỳ; tên nhóm `places`/`directions`.
Ví dụ hợp đồng kiểu, không phải implementation: `type QuotaGroup = 'places' | 'directions'`;
`reserve` trả discriminated union allowed/denied thay vì boolean mất lý do.

Lệnh kiểm tra lúc implementation:
```sh
pnpm --filter @mapslibvn/core build
pnpm --filter @mapslibvn/admin build
pnpm --filter @mapslibvn/api test
pnpm typecheck
pnpm lint
pnpm test
```
Nếu thêm DB schema: `pnpm image:build`, `pnpm test:db`, `pnpm test:api-db` trên DB fixture cô lập.
Không chạy các test trên chỉ để xác nhận văn bản spec; giai đoạn hiện tại dùng git diff --check.

## 12. Tiêu chí nghiệm thu

1. Free request Places thứ 201 cùng ngày bị chặn; directions thứ 21 bị chặn; hai nhóm độc lập.
2. Free hết 2.000/200 tổng không được mở lại ngày sau; hết 30 ngày chặn dù còn lượt.
3. Hai key cùng tenant cộng chung; tenant khác độc lập; đổi/revoke key không reset quota.
4. Còn 1 lượt, 50 reserve đồng thời: chỉ 1 allowed; cả retry/restart không tăng số allowed.
5. 2xx gồm empty/cache chỉ commit một lượt sau ACK hợp lệ; 400/401/403/404/429/503 không charge theo quyết định mục 6.
6. Worker crash sau reserve: lease được giải phóng; prepare/ACK/release và alarm lặp vẫn idempotent,
   ACK muộn sau expiry không trừ sai.
7. Qua 00:00/kỳ mới khi request còn chạy: ACK hợp lệ commit đúng sổ cũ, không trừ sổ mới.
8. Mua 1 khối Places: cộng đúng 1.000, replay không tăng thêm; payload khác cùng ID bị từ chối.
9. Hết Places không chặn directions; mua thêm chỉ mở đúng nhóm, hết thuê bao vẫn không được gọi.
10. Tháng 28/29/30/31 ngày, revision out-of-order, trial→paid, cấp kỳ lặp đều có test.
11. DO lỗi hoặc timeout: fail closed 503, không dùng KV fallback; lỗi không biến thành charge im lặng.
12. Không lộ tenant khác/usage đầy đủ qua public key; admin grant kiểm quyền, audit và idempotency.
13. Bảo toàn burst/internal, cache response body và SDK error envelope; docs đúng runtime.
14. Kiểm hiệu năng A/B warm/cold, cache hit/miss, nhiều tenant/hot tenant, p50/p95/p99/errors và
    chi phí DO theo trial/Starter/Pro/Business dùng hết gói. Ngưỡng phục vụ được chốt bằng số đo,
    không lấy quota tháng hoặc số người giả định làm bằng chứng RPS.
15. Nghiệm thu rollout/rollback và recovery thực trên tenant thử trước khi cấp commercial tenant thật.

## 13. Quyết định duyệt spec

- ĐÃ DUYỆT: chỉ trừ request thành công, kể cả empty/cache; không trừ 4xx/5xx (mục 6).
- PHONG duyệt hướng DO và thông số kỹ thuật; protocol ban đầu reserve/settle đã được thay bằng
  reserve/prepare/client ACK theo quyết định sau Task 0 ngày 15/09/2026.
- Theo spec đã duyệt: credits chỉ trong kỳ, chỉ cho paid active; chu kỳ theo ngày kích hoạt.

Chu kỳ theo ngày kích hoạt đã duyệt; tiền thanh toán, tự tính giá nâng/hạ và tiles ngoài phạm vi.
Sau duyệt: viết plan triển khai theo thứ tự catalog → DO + tests → quyền quản trị → middleware →
SDK/docs → đo tải/rollout. Việc xây UI/thanh toán/tiles theo spec tiếp theo.

## 14. Bổ sung sau review 15/09 — bắt buộc đối chiếu trước implementation

Báo cáo: `docs/research/2026-09-15-review-quota-spec-plan.md`. Các quy tắc cụ thể mục này
làm rõ phần trước; không thay giá hoặc chính sách chỉ tính request thành công.

### 14.1. Charge, response và mất ACK (R1, blocker)

**Quyết định sau Task 0 ngày 15/09/2026:** PHONG chọn protocol client ACK nghiêm ngặt. Receipt pending,
alarm và audit journal phải được ghi bền vững trước khi handler chạy; handler 2xx chỉ chuyển sang
`awaiting_ack`; `used` chỉ tăng khi ACK token hợp lệ. Task 0 đã đóng cổng quyết định kiến trúc
bằng fixture local/staging: fault recovery, mixed/sustained load, SQL billing counters,
snapshot+journal restore, cutover và timeout đều có evidence. Raw REST/SDK và policy production
vẫn phải được triển khai, kiểm thử trong Task 3–6 trước khi bật commercial.
Mốc pilot: tối đa 3 receipt `awaiting_ack` hết hạn
trong cửa sổ trượt 24 giờ/tenant; vượt trả 429 `ack_required`, không gợi ý mua thêm. Hết cửa sổ tự
mở; admin mở sớm phải có operationId idempotent, actor, reason và audit. Mốc 3/24 giờ phải được
đo false-positive ở pilot và điều chỉnh trước public launch; không dùng nó để thay rate limit/trial abuse.

Không thể transaction chung SQLite và việc client nhận HTTP. Luồng commit→mất ACK→503
có thể để used tăng dù khách nhận lỗi; đổi status trong middleware không tự undo commit.
Cần phân biệt **handler outcome**, **ledger outcome** và **HTTP outcome do Worker chọn**.

Trước nối production, Task 0 phải chứng minh protocol có receipt trạng thái rõ, retry bằng ID
và bù trừ idempotent cho khoản đã commit cần điều chỉnh. `prepare`, `ack`, `release` và `compensate`
không được chỉ trả void: trả trạng thái awaiting_ack/committed/released/expired/compensated cùng
charged boolean; unknown phải là nhánh riêng.
Không cho `release` sau commit âm thầm no-op rồi báo khách đã hoàn. Bù trừ tạo audit event,
có lý do và ID, không xoá lịch sử. Late success sau compensated bị từ chối, nguồn/day/kỳ gốc
không được chuyển sang kỳ mới. Thu hồi khoản charge sai đã đóng kỳ phải tạo điều chỉnh rõ ràng.

Nếu Worker quyết định trả 5xx sau commit/unknown, phải có đường ghi nhận và retry bù trừ bền vững
độc lập với tiến trình Worker, có thể khôi phục sau crash. Telemetry/console.log/waitUntil đơn lẻ
không đủ. Đồng thời kiểm mất cả kênh ghi bù trừ: nếu chưa chứng minh được kết quả theo chính sách,
không bật commercial; không tự đổi sang tính phí lỗi. Không hứa exactly-once delivery qua internet.
Task 0 phải nêu rõ trường hợp Worker chết trước ghi outcome và lựa chọn xử lý sai số có lợi cho
khách/chi phí nhà cung cấp để PHONG review nếu cần đổi chính sách. Không thêm queue/journal
mỗi request chỉ bằng giả định — đo chi phí/độ trễ và giới hạn dữ liệu trước khi chọn.

### 14.2. Cutover, auth cache và thu hồi quyền (R2)

KV eventually consistent nên không cam kết “chờ 5 phút + buffer là an toàn”. Auth cache phải
mang issuedAt/expiresAt tuyệt đối; reject/reload entry hết hạn hoặc legacy không có metadata.
Không refresh TTL cho dữ liệu cũ. Kiểm cache âm và mọi key của tenant; revoke key có cơ chế deny
bền vững trong DO của tenant commercial, không chỉ xoá KV. Tenant commercial + plan internal
là cấu hình lỗi bị chặn; không lấy internal từ cache cũ để bypass DO.

Trước onboard public commercial: dùng admission gate ở edge/server config độc lập ledger
cho maintenance và bật bắt buộc commercial với mọi tenant không internal. KV mode cũ không
được bypass gate. Legacy tồn tại chỉ trong pilot giới hạn tenant/key được kiểm soát; khi còn
traffic legacy công khai thì chưa mở bán tự phục vụ. Rollback chỉ về build vẫn hiểu admission gate;
rollback xa hơn phải block traffic bên ngoài Worker trước. Đổi mode DB không phải kill switch.

### 14.3. Cache và HTTP methods (R3/R4)

HEAD phải bị short-circuit, vì Hono 4.13.5 gọi handler GET cho HEAD. OPTIONS không gọi handler.
Response bảy API xác thực, usage và lỗi trả ra ngoài đặt `Cache-Control: private, no-store`.
Cache API nội bộ vẫn lưu dữ liệu public dùng chung như hiện tại, không gắn tenant/usage headers
vào entry chung. Không dùng external CDN/browser cache để bỏ qua auth/quota; purge rule/response
cache cũ khi cutover. POI pending thuộc tenant vẫn không được cache chung.
Test same URL khác key/tenant, cache hit khi key revoke/quota hết và metadata không rò tenant khác.

### 14.4. Backpressure và request lỗi (R5)

Quota tháng là ngân sách, không bảo vệ tải tức thời. Ngoài burst theo key+IP/colo đang có:
- Chặn request rác trước auth KV/DB bằng edge rule/rate limit, không ghi raw IP.
- Validation rẻ của bảy endpoint phải diễn ra trước reserve; tái dùng parser, không parse hai lần.
- DO kiểm trần in-flight theo tenant/group trong transaction reserve; reason concurrency_limit
  là quá tải tạm, không hiện mua thêm; không queue request vô hạn. Slot giải phóng cả khi lỗi.
- Nhiều tenant vẫn dùng chung origin: có concurrency/queue limit hữu hạn tại gateway DB/routing,
  timeout truy vấn trên server, overload trả 503 upstream_busy. Không thêm một global DO cho mọi
  request; không chỉ tăng max_connections để chữa nghẽn. Các giá trị trần phải đo trên hạ tầng hiện tại.
- Legacy/internal không được làm sập origin: kiểm giới hạn origin áp cả chúng, giữ miễn phí quota.
- Đếm request lỗi ở metric abuse; không ghi reservation cho request bị deny trước reserve.

### 14.5. Vòng đời kỳ và uniqueness tài chính (R6)

Unique operationId chưa ngăn cùng giao dịch được gửi với operationId mới. Thêm unique business
identity cho payment/receipt + line item trong tenant; receipt phải từ backend đã xác minh,
actor không nhập amount tuỳ ý. Backend ràng buộc receipt/line với tenant duy nhất trước khi
chuyển vào DO; unique trong một DO không đủ chống cùng receipt được dùng cho tenant khác.
Replay business identity cùng payload trả grant cũ, khác payload reject.
Kỳ có ID duy nhất, start < end, không overlap; grant kỳ tương lai không ghi đè kỳ đang hoạt động.
Từ chối grant hồi tố/chỉnh quota để reset used. Unique identity cần có trong backup và restore.
Trial activation một lần; chuyển paid giữ sổ trial đang có reservation; suspend từ chối reserve mới,
request đã admitted commit/release về nguồn cũ. Suspend bảo mật cần huỷ response phải áp R1, không no-op.

### 14.6. Nguồn phục hồi và giới hạn export (R7)

Snapshot + checksum không tạo lại usage sau snapshot. Phải chỉ ra journal/checkpoint độc lập,
sequence liên tục, cách xác nhận đã export và policy khi thiếu tail. RPO/RTO là số đo, chưa cam kết 0.
Nếu không có tail tin cậy: giữ maintenance, đối soát/điều chỉnh có audit; không mở từ snapshot cũ
như thể số dư đúng. Backup schema version, entitlement revision, periods/grants, balances, trial flag,
reservation state và operation/business dedup tombstones. Không backup riêng aggregate rồi bỏ grants.
Export cursor theo sequence, batch tối đa 100 record hoặc 256 KiB (ngưỡng nào đến trước), không
list toàn bộ 35 ngày vào RAM; không restore trực tiếp vào object đang nhận traffic. Export đã ghi
bền vững xong mới advance checkpoint. Import không giữ transaction trong lúc tải R2.

### 14.7. Chi phí, placement và hot path (R8/R9)

Luồng thành công đã chọn dùng 3 RPC DO (reserve/prepare/client ACK); lỗi handler dùng reserve/release.
Không gọi readUsage riêng ở mỗi request. Raw REST phải ACK tường minh; bốn SDK tự ACK và retry receipt
cũ trước khi gửi request dữ liệu mới. Việc tăng từ 2 lên 3 RPC phải được đo ở staging trước mở bán.
Không đưa query Postgres/Valhalla vào DO. Namespace có version schema, không đổi idFromName/namespace
khi deploy; placement hint dùng ở lúc provision gần thị trường VN, không coi hint là bảo đảm vị trí.
Mọi request/nhóm của một tenant cùng DO có thể tranh CPU; DO này có thể thành bottleneck.

Retry tối đa 1 lần bổ sung cho từng thao tác idempotent khi `.retryable`, tạo stub mới, có jitter
và deadline chung; `.overloaded` không retry. Không phát retry cùng ID khi call trước chưa kết thúc
mà không có receipt/deadline chống hậu quả muộn. Control-plane và settlement/recovery có budget
riêng, không để vòng reserve overload chiếm hết khả năng giải phóng slot.

Cleanup: index deadline cho reservation pending, index expiresAt cho grants và closedAt cho retention;
chỉ đọc bucket hiện tại/index liên quan, không SUM/list mọi lịch sử mỗi reserve.
Lazy cleanup tối đa 32 record mỗi reserve; alarm tối đa 100 record/lượt, hẹn lại khi còn việc;
không ghi setAlarm nếu lịch sớm nhất không thay đổi. Không chạy setInterval/poll giữ DO active.
Retention không xoá pending/unknown/operation tài chính chưa đối soát. Giữ tombstone gọn,
không lưu response body hay toạ độ. Giới hạn input/control payload 16 KiB, safe integers,
kiểm overflow packs×1.000 và cents, pagination query có cap. Tham số SQL tối đa 100 mỗi statement
theo platform: batch 100 record không đồng nghĩa bind tuỳ ý hàng nghìn tham số trong một lệnh.

Task 0 đo rowsRead/rowsWritten (gồm index), databaseSize, request count và latency RPC. Alarm,
delete, duration và stored GB-month phải theo dõi qua Usage/Billing khi pilot; GraphQL Analytics
không được coi là hóa đơn chính xác. Workers Free quota là toàn tài khoản, hết allocation có thể gây outage hàng
loạt tenant; xác minh plan billing thực tế trước live. Không hứa “DO không làm giảm hiệu năng”.

### 14.8. Thời hạn, SDK và công cụ kiểm thử (R10/R11/R12)

Dùng một absolute processing deadline, bắt đầu trước reserve; giữ 30s là ceiling, không tăng
routing timeout đang ngắn hơn. DO tự kiểm lease bằng clock storage; không gia hạn lease khi retry.
RPC wait, DB statement, Valhalla và đọc/parse body đều có budget. Không chỉ clear timer rồi để
query tiếp tục chiếm connection. Kết nối Hyperdrive pooling: timeout cục bộ transaction/role được
kiểm chứng, không SET session tuỳ ý rò sang tenant sau; không gửi dữ liệu chưa serialize trước commit.

SDK cần đọc details/reset/actions/retry-after từ lỗi thành kiểu optional, tương thích constructor cũ;
CORS expose header thực sự dùng. Navigation đang có reroute retry: lỗi quota/expired không lặp
tự động chờ cooldown, giữ tuyến đang có và phát trạng thái để app khách xử lý; không tự popup bán hàng
trên app khách và không huỷ dẫn đường đang chạy chỉ vì quota hết. Lỗi quá tải dùng backoff hữu hạn.

Workers test pool 0.6.16 kéo Wrangler 3 trong lock, deploy dùng Wrangler 4.126.0. Task 0 phải kiểm
SQLite/RPC/alarms/restart thực trong pool; không dùng fake timers phía test rồi mặc định DO clock đã
đổi. Inject clock qua fixture test-only không expose production API. Test hồi quy migration vào DB
fixture và test cutover stale cache là bắt buộc. Không nâng dependency rộng để làm test xanh.

### 14.9. Coverage bổ sung và trạng thái sau review

Thêm acceptance: HEAD handlerCalls=0; external cache no-store; ledger commit ACK mất + HTTP5xx;
transaction business ID replay; kỳ overlap/future period; in-flight/overload/retry cap; origin nhiều
tenant; cache legacy sau cutoff; restore thiếu tail; tombstone/cleanup bound; SDK navigation quota.
Mỗi ca nối với Task 0/2/3/4/5/6/7 trong plan. Task 0 đã kiểm chứng spike và load để đóng quyết định
kiến trúc; runtime vẫn chưa có billing code. Các acceptance còn lại được thực thi tuần tự ở Task 1–7,
không bật middleware/commercial trước khi task phụ trách của nó xanh.
