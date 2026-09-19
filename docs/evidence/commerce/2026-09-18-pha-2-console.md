# Chứng cứ pha 2 — cổng khách hàng `/console`

Plan: `docs/superpowers/plans/2026-09-18-thuong-mai-pha-2-console.md`
Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 5.1, 6, 7, 12, 14.
Ngày chạy: 19/09/2026. 18 task.

## 1. Cổng ở máy — số thật

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | 764 file, sạch |
| `pnpm typecheck` (gồm `tsc -p tsconfig.scripts.json` rồi mới tới turbo) | **18/18**, sạch |
| `pnpm test` | 194 file / **1.864 test** xanh, 5 skip |
| `pnpm --filter @mapslibvn/api test` | 69 file / **550 test** xanh |
| `pnpm test:api-db` (DB thật) | 11 file / **116 test** xanh |
| `pnpm test:db` (schema, DB thật) | 12 file / **77 test** xanh |
| `pnpm exec vitest run --config vitest.db.config.ts db/console-grant.dbtest.mjs` | 3 test xanh |
| `pnpm test:console-e2e` | **8/8** xanh, 50 giây |
| `pnpm test:admin-e2e` | 17/17 xanh (không hồi quy) |

Test API tăng từ 480 (cuối pha 1) lên 550.

## 2. Lời hứa của pha này, đã chứng minh bằng e2e

Bài `người lạ đăng ký, lấy khoá và gọi được API thật bằng chính khoá đó` chạy trọn chặng trên
harness có Postgres thật và sổ quota thật: nhập email → đọc mã sáu số → tạo tổ chức → nhận khoá →
gọi `/v1/autocomplete` bằng đúng khoá đó và nhận 200 → thấy hạn mức 2.000 lượt trên Tổng quan.

Bảy bài bảo vệ kèm theo:

- [x] Mã sai năm lần thì mã chết; lần thứ sáu gõ đúng vẫn không vào được.
- [x] Chưa đăng nhập mà mở màn Khoá thì bị đưa về đăng nhập, giữ lại đường đang xem trong `?next=`.
- [x] Đăng xuất rồi thì `/v1/console/me` trả 401.
- [x] **Tài khoản A không thấy và không thu hồi được khoá của tài khoản B** — B gửi thẳng hash của
      A lên cũng chỉ nhận 404.
- [x] Thu hồi khoá rồi thì gọi API bằng khoá đó trả 401.
- [x] Huỷ trong 5 giây khi thu hồi thì khoá vẫn dùng được (không request nào rời trình duyệt).
- [x] Cấp thêm khoá và danh sách đếm đúng số khoá đang dùng.

## 3. Quyền database đã kiểm bằng role thật

`db/console-grant.dbtest.mjs` chạy dưới `SET ROLE api`: 18 câu mà mã thật sẽ dùng đều chạy được;
`UPDATE tenant SET plan` và `DELETE FROM customer_account` bị từ chối đúng như thiết kế.

Một phát hiện ghi lại bằng bài test thay vì để người sau tự vấp: role `api` **vẫn đổi được**
`quota_mode`, vì migration `0015` đã cấp cho trang Admin và console dùng chung role đó. Thứ ngăn
console làm việc ấy là ở tầng route, không phải ở database.

## 4. Phụ thuộc giữa hai cờ — đọc trước khi bật

`SELF_SERVE=1` **một mình là chưa đủ**. Console tạo tenant ở chế độ `commercial`, và `auth.ts`
từ chối mọi khoá của tenant commercial bằng 503 `quota_unavailable` khi `COMMERCIAL_ADMISSION`
chưa mở. Bật một cờ mà quên cờ kia thì khách đăng ký được, cầm khoá trong tay, và gọi API nào cũng
503 — không có thông báo nào nối hai việc đó lại với nhau.

Production đang mở `COMMERCIAL_ADMISSION = "1"` từ 15/09/2026, nên hiện tại an toàn. Nhưng nếu
một ngày phải đóng khẩn cấp cổng thương mại, hãy biết rằng việc đó chặn luôn khách mới.

Bộ e2e bắt được điều này vì harness ban đầu thiếu đúng cờ đó.

## 4b. Một lần CI đỏ sau khi push, đã sửa

Lần push đầu (`7b18308`) làm **DB tests đỏ**, và lý do là tôi chạy thiếu một lệnh. Plan Task 18
liệt kê `pnpm test:api-db` nhưng quên `pnpm test:db` — hai bộ khác nhau, và bộ sau chứa
`db/schema.dbtest.mjs`, nơi chốt cứng danh sách cột được cấp `UPDATE` cho role `api` cùng số bảng
sau khi chạy lại toàn bộ migration. Migration `0020` làm cả hai con số lệch, đúng như bài đó sinh
ra để phát hiện.

Đã cập nhật: danh sách cột từ 3 lên 17 mục, số bảng từ 17 lên 21. Ghi chú trong test nói rõ vì sao
`tenant.plan` cố ý vắng mặt còn `tenant.quota_mode` thì có.

**Bài học lặp lại lần thứ hai trong dự án này:** chạy đúng những lệnh CI chạy, không chạy một tập
con rồi tin là đủ. Pha 1 đã vấp với `pnpm typecheck` so với `turbo run typecheck`.

**Deploy API cũng đỏ, nhưng đó là cổng làm đúng việc:** `check:migration` thấy máy chủ ở `0019`
còn repo đã có `0020` nên chặn không cho Worker lên. Đây chính là cổng sinh ra sau sự cố 06–07/09
khi Worker deploy trước migration và API chết nhiều giờ. Nó sẽ tự xanh sau bước 6 của mục 5.

## 5. Việc tay của PHONG, theo thứ tự

1. ~~**Resend.**~~ **XONG 19/09/2026.** Tên miền `ai-solutions.io.vn` ở trạng thái `verified`,
   region `ap-northeast-1`. Ba bản ghi của Resend nằm trên subdomain `send` nên MX gốc của
   Cloudflare Email Routing và bản ghi SPF gốc không bị đụng. Đã thêm DMARC `p=none` với địa chỉ
   báo cáo là email hỗ trợ. Khoá `mapslibvn-console-production` cấp quyền `sending_access` và
   giới hạn đúng tên miền này. **Một lá thư thật đã gửi và Resend báo `delivered`** — dùng đúng
   mẫu `mauMaDangNhap`, from `no-reply@ai-solutions.io.vn`, reply-to email hỗ trợ. Việc duy nhất
   còn lại của mục này là `wrangler secret put RESEND_API_KEY --env production`, PHONG chạy vì
   chế độ tự động chặn ghi secret.
2. ~~**Google Cloud.**~~ **XONG 19/09/2026.** Client Web trong project `mapslibvn`, hai địa chỉ
   chuyển hướng đã khai, ứng dụng đã Publish sang In production. Hai secret đã nạp và
   `/v1/console/config` trả `googleEnabled: true`. Chuỗi mà code sinh ra đã đối chiếu khớp từng
   ký tự với chuỗi đã khai, cho cả production lẫn harness.
   **Chưa nghiệm thu được luồng thật** vì `/v1/console/auth/google/start` đứng sau cổng tự phục
   vụ, và cổng còn đóng. Bài kiểm đó phải chạy sau bước 7.
   **Không tự động hoá được bước này:** Google không có API tạo OAuth client cho màn hình đồng ý;
   đường API duy nhất thuộc Identity-Aware Proxy và khoá luôn redirect URI. MCP của Google Cloud
   cũng không kết nối được từ Claude Code vì máy chủ của họ không hỗ trợ đăng ký client động.
3. ~~**Turnstile.**~~ **Widget đã tạo 19/09/2026** qua API Cloudflare: tên `MapsLibVN Console`,
   chế độ `managed`, giới hạn đúng `api.ai-solutions.io.vn` — cùng origin với cổng khách hàng vì
   console được phục vụ từ chính Worker. Site key `0x4AAAAAAE8hg4LHjXPOrZF8` đã vào
   `wrangler.toml` và đã lên production. Secret lấy lại được bất cứ lúc nào từ bảng điều khiển
   Turnstile, nên không chép vào đây. Còn lại: `wrangler secret put TURNSTILE_SECRET`.
4. **Đặt bốn secret** cho production:
   ```
   wrangler secret put RESEND_API_KEY --env production
   wrangler secret put GOOGLE_CLIENT_ID --env production
   wrangler secret put GOOGLE_CLIENT_SECRET --env production
   wrangler secret put TURNSTILE_SECRET --env production
   wrangler secret put SESSION_PEPPER --env production
   ```
   `SESSION_PEPPER` là chuỗi ngẫu nhiên 32 byte, sinh bằng
   `openssl rand -base64 32`. Đổi nó sau này sẽ làm mọi phiên đang mở bị đăng xuất.
5. ~~**Điền `TURNSTILE_SITE_KEY`.**~~ **XONG 19/09/2026**, nhưng **CHỈ trong `[env.production]`**.
   Bản hướng dẫn cũ ở đây viết "điền vào cả `[vars]`" và điều đó SAI: máy chủ bỏ qua bước kiểm
   chống bot ngoài production, nên site key ở `[vars]` làm giao diện dựng widget thật trong
   harness, widget không giải được trong trình duyệt tự động, nút "Gửi mã" khoá vĩnh viễn và bảy
   trên tám bài e2e của cổng khách hàng treo ngay bước đầu.
6. ~~**Chạy migration `0020` trên máy chủ.**~~ **XONG 19/09/2026**, trên máy chủ Ubuntu.
   `/healthz/db` trả `0020_customer.sql`, cổng `check:migration` nhả, Deploy API xanh.
7. **Đổi `SELF_SERVE` thành `"1"`** trong `[env.production]` rồi deploy lần nữa.
8. **Tự đăng ký một tài khoản thật** bằng email của mình để nghiệm thu đầu cuối: nhận mã, tạo tổ
   chức, lấy khoá, gọi thử `/v1/autocomplete`.

Bước 1 đến 5 làm được trước lúc nào cũng được; thiếu chúng thì cổng vẫn đóng và không ai bị ảnh
hưởng. Bước 6 là bước duy nhất chạm dữ liệu production.

## 5b. Hai lỗi chỉ lộ trên production, tìm ra lúc nghiệm thu 19/09

Cả hai nằm ở giao diện, cùng một gốc: **môi trường phát triển và harness không có site key nên
Turnstile bị bỏ qua hoàn toàn, và không bài kiểm nào chạm tới nhánh có widget.**

1. **Nút "Gửi mã đăng nhập" bật khi token còn rỗng.** Điều kiện khoá cũ chỉ là
   `gui.isPending || !email.trim()`. Ai gõ email rồi bấm trong mấy giây đầu — hoặc mạng chậm làm
   script Turnstile tải lâu — sẽ gửi token rỗng, nhận 403 `turnstile_failed`, và đọc được câu
   "Không qua được bước xác minh chống robot". Người thật bị gọi là robot ngay ở màn đầu tiên.
2. **Nút "Gửi lại mã" gửi token rỗng một cách cố định.** `xinMa(email, '')` viết cứng chuỗi rỗng,
   nên trên production chức năng này hỏng một trăm phần trăm, không phải thỉnh thoảng.

Bản vá gom việc dựng widget vào một hook dùng chung `useTurnstile`, khoá nút theo cờ `dangCho`,
xoá token khi Turnstile báo hết hạn hoặc lỗi, và xin token mới sau mỗi lần gửi vì token của
Turnstile dùng được đúng một lần. Chín bài kiểm mới khoá lại từng hành vi đó, trong đó có bài
dựng đúng cảnh "script không tải được" để chắc rằng nút vẫn khoá thay vì mở ra cho người dùng ăn
403.

**Bài học lặp lại:** một nhánh mã mà mọi môi trường kiểm thử đều tắt thì không có bài kiểm nào
canh, và nó sẽ hỏng đúng lúc gặp người dùng thật. Cùng lớp với "đo ở dev rồi kết luận" đã ghi ở
các mốc trước.

## 5c. Sự cố 19/09: khách bấm xin mã, màn hình chạy tiếp, thư không bao giờ tới

**Nguyên nhân: khoá Resend nạp vào Worker thừa đúng MỘT ký tự.** Kết quả của công cụ in liền
`Token: re_…dxgjhoIMPORTANT: The token above is only shown once`, và chữ `I` mở đầu chữ
`IMPORTANT` bị đọc nhầm thành ký tự cuối của khoá. Resend trả 401 cho mọi lần gửi.

Chứng minh bằng hai lời gọi thẳng vào Resend với cùng `from`, `to` và nội dung:

| Khoá | Kết quả |
|---|---|
| `…dxgjhoI` (bản đã nạp) | 401 `API key is invalid` |
| `…dxgjho` (bản đúng) | 200, thư gửi đi |

**Vì sao không ai thấy gì.** Route `otp/request` gửi thư trong `waitUntil` để khách không phải
chờ Resend, nên nó trả 200 và giao diện chuyển sang màn nhập mã như bình thường. Đó là thiết kế
đúng, nhưng nó có nghĩa là **một khoá sai trông y hệt một hệ thống khoẻ mạnh** từ phía người dùng.

**Log giấu mất câu trả lời.** Dòng `console.error('…', error)` đưa nguyên đối tượng `Error` cho
Workers Observability, và cái còn lại trong log chỉ là `at Object.send (index.js:10009:15)` —
không có `email_send_failed_401`. Đã sửa để in cả `message`. Con số 401 nằm sẵn trong log thì việc
truy vết là một phút thay vì mười.

**Ba mốc để lần sau soi đúng thứ tự:** Resend `list-emails` không có bản ghi nào (nếu Resend từ
chối thì KHÔNG có bản ghi, nên "danh sách rỗng" không loại trừ việc Worker đã gọi) → log Worker
có dòng lỗi từ `Object.send` → gọi thẳng Resend bằng đúng khoá đó để tách "khoá hỏng" khỏi "Worker
không gọi".

## 5d. Đăng nhập Google: ba lần hỏng, ba nguyên nhân khác nhau

Đọc từ log Workers Observability, cả ba đều trước hoặc ngoài bản vá:

| Lúc | Mã | Nguyên nhân đọc được từ log |
|---|---|---|
| 03:53 | 503 | lỗi Postgres trong callback, stack dừng ở `postgres.js` |
| 03:59 | 503 | `doiCodeLayToken` — Google từ chối đổi `code` lấy token |
| 04:16 | 400 | `invalid_oauth_state` — cookie `mlv_oauth` sống 600 giây, thử lại sau đó là mất state |

Mọi lỗi không phải `ApiError` đều thành 503 `upstream_unavailable`, nên **mã 503 ở đây không nói
được gì**; phải đọc dòng `console.error(requestId, err)` đi kèm mới biết. Chưa có một lần thử sạch
nào trên bản vá, nên chưa kết luận được Google đã chạy đúng hay chưa.

## 5e. Sự cố 19/09 lần hai: nhập đúng mã vẫn `upstream_unavailable`

**Nguyên nhân: `taoHoacLayTaiKhoan` viết `ON CONFLICT (email) DO UPDATE SET email =
EXCLUDED.email`, mà `email` không nằm trong `GRANT UPDATE` của migration 0020.** Postgres kiểm
quyền theo câu lệnh chứ không đợi có xung đột thật, nên câu đó bị từ chối ngay từ lần đăng nhập
đầu tiên. Lỗi không phải `ApiError` nên `errorResponse` gộp thành 503 `upstream_unavailable`, và
khách chỉ đọc được "Hệ thống đang bận".

Đo dưới role `api` trên DB dev:

| Câu lệnh | Kết quả |
|---|---|
| `DO UPDATE SET email = EXCLUDED.email` | `permission denied for table customer_account` |
| `DO UPDATE SET name = customer_account.name` | chạy được |

Bản vá đổi sang `SET name = customer_account.name`, một phép không đổi dữ liệu trên cột mà `api`
có quyền. **Không dùng `EXCLUDED.name`**: giá trị đó là NULL và sẽ xoá mất tên đã lưu. Cũng không
dùng `DO NOTHING`: nó trả về rỗng, mà cả luồng mã một lần lẫn luồng Google đều đọc `RETURNING`
để biết tài khoản nào vừa đăng nhập.

**Vì sao ba lớp kiểm thử đều bỏ sót.** `pnpm test:api-db` và e2e nối DB bằng **role chủ sở hữu**
nên mọi thiếu sót về GRANT đều vô hình. Còn `db/console-grant.dbtest.mjs`, file sinh ra đúng để
bắt lớp lỗi này, lại chạy `INSERT INTO customer_account (email) VALUES (...)` trơn — một câu
*tương đương về ý* nhưng không phải câu mã thật gửi đi. Đã thêm hai bài: một bài dựng lại nguyên
văn câu của `taoHoacLayTaiKhoan` và gọi hai lần để đi qua nhánh `ON CONFLICT`, một bài khẳng định
`api` vẫn KHÔNG sửa được cột `email` — đổi email người khác là chiếm tài khoản.

**Bài học:** bài kiểm quyền phải chạy **nguyên văn** câu lệnh của mã thật. Viết lại cho gọn là
đánh mất đúng thứ cần kiểm.

## 6. Còn nợ, ghi rõ chứ không lờ đi

- ~~**Chưa gửi được một lá thư thật nào.**~~ **ĐÃ GỬI 19/09/2026**, trạng thái `delivered` tới
  Gmail, message id của `ap-northeast-1.amazonses.com`. Đường DKIM và SPF đã chứng minh chạy thật.
  Cái chưa chứng minh là Worker tự gọi Resend, vì secret chưa đặt.
- **Chưa đăng nhập Google thật lần nào.** Phần xác thực `id_token` kiểm bằng khoá RSA tự sinh và
  phủ năm nhánh từ chối, nhưng luồng chuyển hướng thật với Google thì chưa chạy.
- **Ba màn hình của pha 3 chưa có** (Mua gói, Đơn hàng, chi tiết đơn). Ba nút mua ở Tổng quan dẫn
  tới hộp thoại nói thật kèm email hỗ trợ.
- **Chưa có cron dọn** mã đăng nhập và phiên hết hạn. Hai bảng đó có chỉ mục theo hạn nên câu xoá
  sẽ rẻ; việc dọn nằm trong pha 3 cùng với cron đối soát đơn hàng.
