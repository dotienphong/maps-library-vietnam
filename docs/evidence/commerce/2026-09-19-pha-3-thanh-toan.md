# Chứng cứ pha 3 — thanh toán PayOS, cấp gói tự động

Plan: `docs/superpowers/plans/2026-09-19-thuong-mai-pha-3-thanh-toan.md`
Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 5.2, 5.3, 9, 10, 12, 13, 14.
Ngày chạy: 19/09/2026. 19 task, 19 commit trên nhánh `feat/thuong-mai-pha-3`.

**Trạng thái: mã xong và mọi cổng xanh ở máy. CHƯA lên production** — còn chờ PHONG làm việc tay ở
mục 7, và chưa có đồng tiền thật nào chạy qua.

## 1. Cổng ở máy — số thật

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | 829 file, sạch |
| `pnpm typecheck` (gồm `tsc -p tsconfig.scripts.json` rồi mới tới turbo) | **18/18** task, sạch |
| `pnpm test` | 208 file / **1.933 test** xanh (5 skip) |
| `pnpm --filter @mapslibvn/api test` | 82 file / **715 test** xanh |
| `pnpm test:db` (DB thật, trong container) | 13 file / **88 test** xanh |
| `pnpm test:api-db` (DB thật + sổ quota thật + PayOS giả) | 12 file / **125 test** xanh |
| `pnpm test:console-e2e` | **13/13** xanh, 58 giây |
| `pnpm test:admin-e2e` | **18/18** xanh, 1,1 phút |

Test API tăng từ 570 (đầu pha, sau khi sửa `audit()`) lên 715. itest tăng từ 116 lên 125.
e2e console từ 9 lên 13, e2e admin từ 17 lên 18.

**Một bẫy đã vấp khi đo:** lần chạy `pnpm test:db` đầu tiên đỏ 9 bài (conflate, export-odbl, hai bài
lùi migration). Nguyên nhân là DB dev đã bị chính tôi làm bẩn khi chạy `db/schema.dbtest.mjs` đứng
một mình trước đó — bài đó lùi toàn bộ migration rồi tiến lại, và ghi chú trong repo đã cảnh báo
"schema.dbtest xoá sạch dev DB". Chạy lại qua đúng harness container (DB cô lập) thì 13/13 xanh.
Bài học: **không đọc kết quả `test:db` sau khi đã chạy tay một file dbtest nào đó.**

## 2. Lời hứa của pha này, đã chứng minh bằng itest và e2e

Bài e2e `khách mua Starter 3 tháng` chạy trọn chặng trên harness có Postgres thật, sổ quota thật và
PayOS giả: chọn gói → tạo đơn → QR hiện kèm nội dung chuyển khoản `MLV<orderCode>` → PayOS giả bắn
webhook đã ký → **trang tự chuyển sang "Đã cấp gói" mà không tải lại** → Tổng quan hiện Starter với
hạn đúng ba tháng.

Chín bài itest bảo vệ kèm theo (`apps/api/test-db/commerce.itest.mjs`):

- [x] Sổ quota nhận đúng MỘT kỳ Starter dài 89–92 ngày, `paymentReference` là mã giao dịch thật.
- [x] **Bắn lại đúng webhook đó lần hai → 200, không có kỳ thứ hai, `payment_event` không thêm dòng** (tiêu chí 20.6).
- [x] Sai chữ ký → 400, đơn đứng im, và admin thấy dòng đó ở mục "Giao dịch không khớp đơn".
- [x] Chuyển thiếu → `underpaid`; admin xác nhận tay phần còn thiếu → `fulfilled`; gọi lại cùng
      `operationId` → `moi: false`, không thêm sự kiện (tiêu chí 20.8).
- [x] **Webhook rơi: cron đối soát hỏi PayOS, thấy PAID, tự dựng sự kiện và cấp** (tiêu chí 20.7).
- [x] Đơn quá hạn link → cron đóng thành `expired`; tiền vào SAU đó vẫn được cấp.
- [x] Tài khoản A không đọc, không huỷ được đơn của B (404 cả hai đường); B huỷ được đơn của mình,
      và PayOS cũng thấy link đã huỷ chứ không chỉ DB của ta.
- [x] Mua thêm lượt bị chặn khi đang dùng thử; sau khi có gói trả phí thì cộng đúng kỳ hiện tại.
- [x] Route đơn hàng admin đứng sau cổng billing: email ngoài danh sách nhận 403.

## 3. Quyền database đã kiểm bằng role thật

`db/commerce-grant.dbtest.mjs` chạy dưới `SET ROLE api`, mỗi câu là câu **nguyên văn** mà
`commerce/db.ts` gửi đi (bài học 19/09: một câu "tương đương" không đủ):

- 5/5 bài xanh: tạo đơn, mọi câu đọc của khách/cron/admin, cả máy trạng thái
  `pending → paid → paid_unfulfilled → fulfilled`, và `payment_event` với `ON CONFLICT DO NOTHING`.
- `order_code` về dưới dạng **số** chứ không phải chuỗi — bằng chứng `::int` đã đúng chỗ.
- Vế thứ hai của phân quyền cũng được khoá lại: bảy câu PHẢI bị từ chối đều nhận `42501` —
  sửa `amount_vnd`, `tenant_id`, `tier`, `order_code`, xoá đơn, sửa và xoá `payment_event`.

## 4. Bất biến về tiền và nơi chứng minh

| Bất biến | Chặn ở đâu | Chứng minh ở |
|---|---|---|
| Webhook giả không cấp được gói | Chữ ký HMAC kiểm trước mọi trường, so sánh hằng thời gian | `commerce-chu-ky.test.ts` (vector cố định), `pay-webhook.test.ts`, itest |
| Không cấp gói hai lần | `UNIQUE (provider, reference)` + `operationId = order:<id>` + `business_identity` | `commerce-fulfil.test.ts`, itest replay |
| Tiền vào mà gói không vào thì không mất | `paid_unfulfilled` + cron thử lại + nút admin; webhook vẫn 200 | `commerce-fulfil.test.ts`, `commerce-cron.test.ts` |
| Trả thiếu / trả làm nhiều lần | Tính theo TỔNG sự kiện hợp lệ, không theo một webhook | `commerce-fulfil.test.ts`, itest |
| Tiền vào đơn đã hết hạn vẫn được cấp | `datDaTra` nhận cả `expired`/`cancelled` | `commerce-db.test.ts`, itest |
| Client không tự đặt được số tiền | Máy chủ chỉ nhận `{tier, months}`; `quoteOrder()` tính | `console-orders.test.ts` (gửi `amount: 1` bị bỏ), itest |
| Tenant A không chạm được đơn của B | `tenant_id` nằm TRONG từng câu SQL | `commerce-db.test.ts`, itest, e2e |
| Thiếu GRANT chỉ lộ trên production | Bài chạy `SET ROLE api` với câu nguyên văn | `db/commerce-grant.dbtest.mjs` |
| Thiếu khoá PayOS không được "tạm tin" | `chonPayosPort` trả bản từ chối; webhook 503 | `commerce-payos.test.ts`, `pay-webhook.test.ts` |
| Lũ webhook rác không làm đầy DB | Thân ≤ 16 KiB, rate limit 20 dòng/phút/IP, `reference = invalid:<sha256 thân>` | `pay-webhook.test.ts` |

## 5. Lệch spec có chủ ý

1. **Migration là `0023`**, không phải `0021` như spec — repo đã có 0021 và 0022 từ 19/09.
2. **Tiền tính theo tổng sự kiện**, không theo một webhook: PayOS hỗ trợ trả từng phần
   (`amountPaid`/`amountRemaining`), và khách chuyển thiếu rồi chuyển bù là chuyện thường.
3. **Không cài `@payos/node`.** Đọc mã nguồn SDK để lấy đúng thuật toán chữ ký rồi viết tay ~90
   dòng, có vector cố định. Ít mã lạ chạy cạnh khoá thanh toán hơn.
4. **Admin tối thiểu có thêm "Xác nhận đã nhận tiền (tay)"** ngoài ba mục spec liệt kê: tiêu chí
   nghiệm thu 20.8 không có đường nào khác để đóng, và để một đơn `underpaid` không có cách xử lý
   ngoài sửa DB tay là rủi ro tiền bạc thật. Lệnh này idempotent nhờ `reference = manual:<operationId>`.
5. **Webhook trùng `reference` vẫn thử áp dụng lại** nếu đơn chưa xong: lần nhận đầu có thể đã ghi
   được sự kiện rồi đổ ở bước cấp gói, nên lần gửi lại của PayOS là cơ hội tự lành.
6. **Xác nhận tay dùng `manual:<operationId>`** thay vì `manual:<ulid>` như spec: `UNIQUE` sẵn có
   biến lệnh thành idempotent, bấm hai lần không tạo hai sự kiện tiền.
7. **Cron nhắc hạn đọc `readUsage()` từng tenant** (trần 200/lượt). Ở quy mô hiện tại là vài lời gọi
   Durable Object mỗi ngày; khi có hàng trăm tenant thì phải đổi cách.

## 6. Hai lỗi có sẵn, phát hiện trong lúc làm

**`audit()` của pha 2 chưa từng ghi gì cho cổng khách hàng.** Hàm đọc `c.get('reviewer')` — biến do
Cloudflare Access đặt — rồi trả về sớm khi rỗng. Không route nào của `/v1/console/*` đặt biến đó,
nên từ pha 2 tới nay mọi dòng `customer.tenant_create`, `customer.key_issue`, `customer.key_revoke`,
`customer.logout_all` **và `email.sent`** đều rơi vào im lặng. `email.sent` chính là nguồn đếm ngân
sách 100 thư/ngày của Resend, nghĩa là ngân sách đó chưa từng được tính. Task 1 sửa bằng
`chonActor()` rơi về `customer:<email>`, có bốn bài kiểm khoá lại.

*Vì sao không ai thấy:* không bài kiểm nào của pha 2 đọc `admin_audit` sau một thao tác của khách.
Giờ có — `commerce.itest.mjs` đọc `order.paid`, `order.fulfilled`, `admin.order.confirm_manual`.

**Console không làm mới mức dùng khi đơn xong qua poll.** Bài e2e bắt được: khách trả tiền, trang
chi tiết chuyển sang "Đã cấp gói", nhưng bấm về Tổng quan vẫn thấy gói cũ tới 30 giây (hạn cache),
kèm nút "Mua gói" thay vì "Gia hạn" — trông y như tiền chưa vào. Đã thêm một `useEffect` làm mới
đúng một lần khi trạng thái chạm `fulfilled`.

## 7. Việc tay của PHONG, theo thứ tự

Bước 1 và 2 **không chạm production** và làm được ngay. Bước 3 trở đi chạm production.

1. **Đăng ký PayOS** tại `my.payos.vn`: xác thực CCCD, liên kết tài khoản ngân hàng nhận tiền, tạo
   **kênh thanh toán**. Đây là đường găng — xác thực mất vài ngày.
   Hỏi PayOS hai điều và ghi câu trả lời vào file này:
   - **Hạn mức số tiền tối đa một link.** Đơn lớn nhất của catalog là Business 12 tháng =
     124.800.000 ₫, có thể vượt hạn mức chuyển khoản một lần của một số ngân hàng phía khách.
   - **Biểu phí thực tế.** Trang chủ PayOS quảng cáo "từ dưới 1.500 ₫/giao dịch" nhưng đó không phải
     tài liệu kỹ thuật.
2. Lấy `Client ID`, `API Key`, `Checksum Key` của kênh. **Không** dán vào chat, file, hay
   `wrangler.toml`. Đặt bằng:
   ```
   wrangler secret put PAYOS_CLIENT_ID --env production
   wrangler secret put PAYOS_API_KEY --env production
   wrangler secret put PAYOS_CHECKSUM_KEY --env production
   ```
   Bài học 19/09: kết quả công cụ in liền `IMPORTANT` vào đuôi khoá Resend và khoá thừa một ký tự.
   Dán thẳng từ bảng điều khiển PayOS, kiểm ký tự cuối.
3. **Chạy migration `0023` trên máy chủ** (`pnpm server:migrate`, gõ trên máy chủ Ubuntu), rồi đối
   chiếu `/healthz/db` báo `0023_customer_order.sql`. Deploy trước migration đã từng làm chết API.
4. Push → Deploy API xanh. Cổng `check:migration` **sẽ chặn** cho tới khi bước 3 xong; đó là cổng
   làm đúng việc, không phải sự cố.
5. **Đăng ký webhook URL** `https://api.ai-solutions.io.vn/v1/pay/payos/webhook` trong kênh thanh
   toán. PayOS bắn một webhook mẫu và đòi 2XX: API trả `{ received: true, matched: false }` và admin
   thấy một dòng ở "Giao dịch không khớp đơn" — **đó là dấu hiệu đúng**, không phải lỗi.
6. **Nghiệm thu bằng tiền thật, đơn nhỏ trước.** PayOS không có sandbox, nên không có cách nào khác.
   - Ở `/admin/billing`, cấp cho tenant của chính PHONG một kỳ Starter bằng lệnh `grantPeriod` sẵn
     có (không tốn tiền), để tenant ở trạng thái trả phí đang hoạt động.
   - Ở `/console/mua` tab "Mua thêm lượt", mua **1 khối Places = 26.000 ₫**. Chuyển khoản bằng QR.
     Kiểm: đơn `fulfilled` trong 60 giây; Tổng quan cộng 1.000 lượt; email biên nhận về hộp thư;
     `/admin/orders` có đơn với sự kiện `signature_valid = true`; `admin_audit` có `order.paid` và
     `order.fulfilled`.
   - Sau đó mới mua **Starter 1 tháng = 650.000 ₫** để đóng tiêu chí 20.5 nguyên văn (kỳ mới xếp sau
     kỳ đã cấp tay — đúng luật 9.3, giao diện nói rõ "hiệu lực từ …" trước khi bấm).
   - Bắn lại đúng webhook thật lần hai (PayOS có nút gửi lại trong lịch sử giao dịch): 200, không có
     kỳ thứ hai.
7. **Rollback nếu cần:** `wrangler` đưa Worker về bản trước. Migration lùi bằng
   `0023_customer_order.down.sql` **chỉ khi chưa có đơn thật nào**; có đơn rồi thì không lùi schema —
   xoá ba secret là đủ để đóng cửa (tạo đơn 503, webhook 503, không mất dữ liệu).

## 8. Điều chưa làm, cố ý

- **Chưa có đồng tiền thật nào chạy qua.** Mọi con số ở mục 1 và 2 đến từ PayOS giả.
- Tiêu chí 20.7 (tắt webhook, cron cấp trong 10 phút) và 20.8 (chuyển thiếu) đã chứng minh trên
  harness; làm lại bằng tiền thật chỉ khi PHONG muốn chi thêm 26.000 ₫ cho mỗi tiêu chí.
- Màn admin của pha này là **bản tối thiểu**: danh sách, chi tiết, thử cấp lại, xác nhận tay, giao
  dịch không khớp. "Huỷ đơn" và "Đánh dấu hoàn tiền" phía admin thuộc pha 4.
