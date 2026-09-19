# Thương mại tự phục vụ — Pha 3: thanh toán PayOS, cấp gói tự động — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **TRẠNG THÁI 20/09/2026 — PLAN ĐÃ THỰC THI XONG VÀ PHA ĐÃ ĐÓNG.**
> Các ô `- [ ]` bên dưới **không được tick trong lúc chạy** — đừng đọc chúng là "chưa làm".
> Bằng chứng là commit, không phải checkbox: 20 commit trên `feat/thuong-mai-pha-3`, merge
> `00fd6c3`, sửa CI `0b01ada`, tài liệu `2c8b856`. Pha đã chạy tiền thật trên production
> (đơn `100002`, `100003`). Hồ sơ đóng pha và hai chỗ mỏng còn lại:
> `docs/evidence/commerce/2026-09-19-pha-3-thanh-toan.md` mục 9–10; DEVLOG mục 25.

**Goal:** Khách tự trả tiền bằng chuyển khoản VietQR qua PayOS, gói tự vào sổ quota trong vòng một phút, và **không một đồng nào bị mất hay bị cấp hai lần** dù webhook rơi, gửi lại, hay máy chủ ngủ giữa chừng.

**Architecture:** Đơn hàng sống trong Postgres (`customer_order`), mọi webhook nhận được — kể cả sai chữ ký — được ghi vào `payment_event` với `UNIQUE (provider, reference)` làm khoá chống trùng. Một hàm duy nhất `apDungThanhToan()` đọc **tổng tiền đã nhận từ các sự kiện hợp lệ** rồi quyết định `paid`/`underpaid`, và một hàm duy nhất `fulfilOrder()` gọi sổ quota với `operationId = order:<id>`; webhook, cron đối soát và nút admin đều đi qua đúng hai hàm đó. PayOS đứng sau một interface có bản giả chạy trong harness, nên toàn bộ pha kiểm được ở máy trước khi PHONG có khoá thật.

**Tech Stack:** Hono trên Workers (fetch + `scheduled`), Postgres qua Hyperdrive, Durable Object quota sẵn có, PayOS REST v2 (HMAC-SHA256), Resend, React 19 + Vite + `@mapslibvn/ui`, `qrcode-generator` (0 dependency), Playwright.

Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 5.2, 5.3, 9, 10, 12 (ba màn còn thiếu), 13 (phần tối thiểu), 14, 16, 17, 18, 19, 20.
Pha 0, 1, 2 đã lên production; `SELF_SERVE = 1` từ 19/09/2026.

---

## 0. Đánh giá PayOS trước khi viết một dòng mã

Đối chiếu ngày 19/09/2026 với tài liệu chính thức `payos.vn/docs` và mã nguồn SDK `@payos/node@2.0.5`
(thư viện chính thức, đọc để lấy đúng thuật toán chữ ký chứ **không** cài vào Worker — xem lý do ở
0.3).

### 0.1. Những gì đã xác minh được

| Điều | Kết quả | Hệ quả cho plan |
|---|---|---|
| Tạo link: `POST /v2/payment-requests`, header `x-client-id`, `x-api-key` | Đúng như spec | Task 4 |
| Chữ ký tạo link | `HMAC-SHA256(checksumKey, "amount=…&cancelUrl=…&description=…&orderCode=…&returnUrl=…")`, hex | Task 3, có vector cố định |
| Chữ ký webhook (và chữ ký trên `data` của mọi phản hồi) | Sắp khoá theo bảng chữ cái → `key=value` nối `&` → HMAC-SHA256 hex. `null`/`undefined`/chuỗi `'null'`/`'undefined'` → rỗng; mảng → `JSON.stringify` sau khi sắp khoá từng phần tử; `undefined` bị bỏ khỏi chuỗi | Task 3 chép **đúng** luật này, kể cả điểm kỳ quặc của mảng |
| `description` | **Tối đa 9 ký tự** với tài khoản ngân hàng chưa liên kết qua PayOS | `'MLV' + orderCode`, sequence bắt đầu 100001 → đúng 9 ký tự tới 999999 |
| `checkoutUrl` | `https://pay.payos.vn/web/{paymentLinkId}` | Dựng lại được khi chỉ có `id` từ `GET` |
| `GET /v2/payment-requests/{id}` | Trả `status`, `amountPaid`, `amountRemaining`, `transactions[]` — **có trả góp từng phần** | Task 7 tính tổng tiền từ mọi sự kiện, không tin một webhook đơn lẻ |
| Trùng `orderCode` | Lỗi `"Đơn thanh toán đã tồn tại"`; mã số **không** được tài liệu hoá | Task 10 rơi về `GET` rồi dựng lại `checkoutUrl` |
| Webhook trả về | Phải trả 2XX; **không có tài liệu về số lần gửi lại hay timeout** | Cron đối soát bằng `GET` mỗi 5 phút là bắt buộc, không phải phòng hờ |
| Danh sách IP máy chủ PayOS | **Không có** | Không lọc IP; chữ ký HMAC là cổng duy nhất, nên phải so sánh hằng thời gian và không có nhánh nào bỏ qua |
| Môi trường thử nghiệm | Tài liệu nói thẳng: *"payOS không cung cấp môi trường test (sandbox/staging) riêng biệt"*, khuyên dùng *"giá trị giao dịch nhỏ khi kiểm thử"* | Bản giả `scripts/lib/payos-fake.mjs` cho mọi kiểm thử tự động; nghiệm thu bằng **tiền thật, đơn nhỏ nhất** (1 khối 1.000 lượt Places = 26.000 ₫) trước khi mua Starter |
| Chống replay | Chỉ có chữ ký, **không có timestamp/nonce** trong chữ ký | Replay một webhook hợp lệ = trùng `reference` = 200 và không làm gì. Đủ, vì mọi hiệu ứng tiền đều idempotent |
| Hạn mức số tiền một link | **Không ghi trong tài liệu** | Đơn lớn nhất của catalog là Business 12 tháng = 124.800.000 ₫, có thể vượt hạn mức chuyển khoản một lần của một số ngân hàng phía **khách**. Không đổi catalog trong pha này; ghi vào việc tay để PHONG hỏi PayOS lúc đăng ký |
| Phí | Trang chủ nói gói FREE-100 / PIONEER-500 giao dịch, phí cố định "từ dưới 1.500 ₫/giao dịch" — **không phải tài liệu kỹ thuật** | PHONG xác nhận biểu phí thật lúc ký; plan không phụ thuộc phí |

### 0.2. Rủi ro về tiền và chỗ chặn — thứ tự ưu tiên

| # | Rủi ro | Chặn ở đâu | Bài kiểm |
|---|---|---|---|
| 1 | Kẻ lạ gửi webhook giả để được cấp gói | Chữ ký HMAC kiểm **trước mọi thứ**, so sánh hằng thời gian; sai → 400, không đụng đơn | Task 9: sai chữ ký → 400 và trạng thái đơn không đổi |
| 2 | Cấp gói hai lần (PayOS gửi lại, cron và webhook chạy cùng lúc, admin bấm hai lần) | Ba tầng: `UNIQUE (provider, reference)`; `operationId = order:<id>`; `business_identity (paymentReference, lineItemId)` trong sổ | Task 15: bắn lại webhook → 200, `readPeriods` vẫn một kỳ |
| 3 | Tiền vào mà gói không vào (sổ quota lỗi, DB ngủ) | Trạng thái `paid_unfulfilled` riêng; cron thử lại tới 20 lần; admin thấy ngay; webhook vẫn 200 | Task 7, 11, 15 |
| 4 | Khách trả thiếu (phí ngân hàng, gõ nhầm) | `underpaid` + email cho khách và admin; admin xác nhận tay bằng đường **đi qua cùng `apDungThanhToan`** | Task 12, 15 |
| 5 | Khách trả làm hai lần cho đủ | Tổng `amount_vnd` của mọi sự kiện hợp lệ ≥ giá → `paid` | Task 7 |
| 6 | Tiền vào đơn đã `expired`/`cancelled` | Webhook hợp lệ vẫn chuyển sang `paid` rồi cấp — tiền đã rời tài khoản khách là sự thật | Task 7 |
| 7 | Client tự gửi số tiền | Máy chủ chỉ nhận `{kind, tier, months}`/`{kind, group, packs}`; tiền do `quoteOrder()` tính | Task 10 |
| 8 | Tenant A đọc/huỷ đơn của B | Mọi câu SQL của khách có `tenant_id = <tenant của phiên>` ngay trong câu | Task 5, 15 |
| 9 | Lộ khoá PayOS | Ba khoá là secret `wrangler secret put`; không log; harness dùng khoá giả | Task 4 |
| 10 | Lũ webhook rác làm đầy DB | Thân ≤ 16 KiB; sai chữ ký thì ghi tối đa 20 dòng/phút/IP (Rate Limiting binding), `reference = 'invalid:' + sha256(body)` nên cùng thân chỉ ghi một lần | Task 9 |
| 11 | Deploy Worker trước migration | Cổng `check:migration` sẵn có; số migration là **0023**, không phải 0021 như spec (repo đã có 0021, 0022) | Task 2 |
| 12 | Thiếu `GRANT` chỉ lộ trên production | `db/commerce-grant.dbtest.mjs` chạy **nguyên văn** từng câu của `commerce/db.ts` dưới `SET ROLE api` | Task 13 |
| 13 | Phản hồi PayOS bị giả mạo/đổi trên đường (TLS lỗi, proxy) | Kiểm chữ ký trên `data` của **mọi** phản hồi PayOS, như SDK chính thức làm | Task 4 |
| 14 | `audit()` của cổng khách hàng **đang không ghi gì** (lỗi pha 2, phát hiện khi viết plan này) | Sửa trước tiên: actor rơi về `customer:<email>`; cả `email.sent` (ngân sách thư) mới đếm được | Task 1 |

### 0.3. Quyết định kỹ thuật, lệch spec có chủ ý

1. **Không cài `@payos/node`.** SDK kéo theo lớp phát hiện nền tảng và log riêng, chưa được kiểm trên
   Workers, và toàn bộ giá trị của nó với ta là ~40 dòng chữ ký + 3 lời gọi `fetch`. Viết tay,
   chép đúng thuật toán, kiểm bằng vector cố định. Ít mã lạ chạy cạnh khoá thanh toán hơn.
2. **Migration là `0023_customer_order.sql`**, vì repo đã có `0021_cap_lai_grant_api_key` và
   `0022_xoa_tenant_function`. Spec viết 0021 vào lúc chưa có hai file đó.
3. **Tính tiền theo tổng sự kiện**, không theo một webhook: PayOS hỗ trợ trả từng phần
   (`amountPaid`/`amountRemaining`). Spec 9.2 bước 6 so `amount` của một webhook; ở đây so **tổng**
   `amount_vnd` của mọi sự kiện hợp lệ của đơn. Một webhook đủ tiền cho ra kết quả y hệt spec.
4. **Xác nhận tay lấy `reference = 'manual:' + operationId`** thay vì `'manual:' + ulid`: `UNIQUE`
   sẵn có biến lệnh này thành idempotent, bấm hai lần không tạo hai sự kiện.
5. **Admin tối thiểu có bốn việc chứ không ba:** danh sách đơn, "Thử cấp lại", "Giao dịch không
   khớp đơn", **và "Xác nhận đã nhận tiền (tay)"** — vì tiêu chí nghiệm thu 20.8 (chuyển thiếu →
   admin xác nhận → `fulfilled`) không có đường nào khác để đóng, và để một đơn `underpaid` không có
   cách xử lý ngoài sửa DB tay là rủi ro tiền bạc thật. Huỷ đơn và Đánh dấu hoàn tiền phía admin vẫn
   để pha 4.
6. **Webhook trùng `reference` vẫn gọi lại `apDungThanhToan()`** nếu đơn chưa `fulfilled`: lần nhận
   đầu có thể đã ghi được sự kiện rồi đổ ở bước cấp gói; PayOS gửi lại là cơ hội tự lành, không nên
   trả 200 rồi đứng im.
7. **Cron reminder gom `readUsage()` từng tenant thương mại** (tối đa 200/lượt). Ở quy mô hiện tại
   là vài lời gọi DO mỗi ngày; khi có hàng trăm tenant thì phải đổi cách, ghi rõ trong DEVLOG.

---

## Bối cảnh bắt buộc đọc trước khi làm

**Tám bất biến của pha này, vi phạm là mất tiền thật:**

1. Số tiền chỉ do máy chủ tính bằng `quoteOrder()`; mọi số tiền client gửi lên bị bỏ.
2. Chữ ký webhook được kiểm **trước** khi đọc bất kỳ trường nào; so sánh hằng thời gian; không có
   nhánh "bỏ qua kiểm chữ ký khi thiếu cấu hình" — thiếu `PAYOS_CHECKSUM_KEY` thì 503.
3. `payment_event.reference` là khoá idempotent của tiền vào; `operationId = 'order:' + id` và
   `lineItemId = id` là khoá idempotent của gói ra. Không route nào tự bịa `operationId` khác.
4. `fulfilled` chỉ được đặt **sau** khi sổ quota trả biên lai. Không đặt trước rồi hy vọng.
5. Tiền đã ghi nhận thì không mất: webhook hợp lệ tới cho đơn `expired`/`cancelled` vẫn chuyển
   `paid` rồi cấp.
6. Mọi câu SQL của khách có `tenant_id = <tenant của phiên>` ngay trong câu, không kiểm ở JS.
7. Không log payload PayOS, không log khoá, `moTaLoi()` không lấy `detail` của Postgres. Ba khoá
   PayOS chỉ vào Worker qua `wrangler secret put`.
8. Hai đường làm thay đổi trạng thái tiền — webhook và admin xác nhận tay — cùng đi qua
   `apDungThanhToan()`; hai đường cấp gói — webhook/cron và admin "Thử cấp lại" — cùng đi qua
   `fulfilOrder()`. Không có bản thứ hai.

**Bẫy của repo, đã trả giá ít nhất một lần:**

- `pnpm typecheck` chạy `tsc -p tsconfig.scripts.json` **trước** turbo, bật `checkJs` cho
  `scripts/**/*.mjs`. Chạy thiếu là ở máy xanh mà CI đỏ.
- Thiếu một dòng `GRANT` chỉ lộ trên production: `test:api-db` nối DB bằng role **chủ sở hữu**.
  Bài kiểm quyền phải chạy **nguyên văn** câu của mã thật (sự cố `ON CONFLICT DO UPDATE SET email`
  19/09).
- `postgres.js` với `fetch_types: false` trả `bigint` dưới dạng **chuỗi**: mọi cột `bigint` đọc ra
  phải `::int` trong SQL (giá trị lớn nhất 124.800.000 nằm gọn trong int4).
- Cột thời gian cho con trỏ phân trang đi qua `to_char(...)` và bind lại bằng `::text::timestamptz`.
- `instanceof` không sống qua RPC của Durable Object; khớp lỗi theo `message`.
- `sql.json()` cho cột jsonb; truyền chuỗi đã stringify thì cột giữ một *string* JSON.
- `audit(c, …)` chỉ ghi khi có `reviewer`; pha 2 gọi nó từ route khách hàng và **mọi dòng đó đã
  rơi vào im lặng** — Task 1 sửa.
- `--var` truyền cho `wrangler deploy` bị lần deploy sau xoá sạch; giá trị lâu dài phải nằm trong
  `wrangler.toml`; secret thì `wrangler secret put`.
- `db/schema.dbtest.mjs` chốt cứng **số bảng** và **danh sách cột được UPDATE** của role `api`;
  migration mới làm cả hai lệch → phải cập nhật cùng lúc (Task 2), và phải chạy `pnpm test:db` chứ
  không chỉ `test:api-db` (bài học pha 2, mục 4b).
- Route `/orders/quote` và `/orders/summary` phải khai **trước** `/orders/:id`, nếu không `:id`
  nuốt mất.

**Cổng ngoài và cách tắt khi chưa có khoá:**

| Cổng | Biến | Vắng biến thì |
|---|---|---|
| PayOS | `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` (secret), `PAYOS_BASE` (tuỳ chọn, mặc định `https://api-merchant.payos.vn`), `PAYOS_CHECKOUT_BASE` (tuỳ chọn, mặc định `https://pay.payos.vn`) | Tạo đơn trả 503 `payment_provider_not_configured`; webhook trả 503 (không bao giờ "tạm tin") |
| Rate limit webhook sai chữ ký | `PAYOS_WEBHOOK_RATE_LIMITER` | Bỏ giới hạn (như OTP): dev không có binding |
| Gốc link trong thư cron | `CONSOLE_ORIGIN` | Thư nhắc hạn không có nút mở console, vẫn gửi |
| Email | như pha 2 | như pha 2 |

Harness `api-db-test.mjs` nạp ba khoá **giả** và trỏ `PAYOS_BASE` về `scripts/lib/payos-fake.mjs`.

Mọi commit kết thúc bằng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
Không push cho tới Task 19.

## Cấu trúc file

**Tạo mới**

```
db/migrations/0023_customer_order.sql  +  .down.sql
db/commerce-grant.dbtest.mjs                 SET ROLE api cho từng câu của commerce/db.ts

apps/api/src/commerce/
  chu-ky.ts        kyTaoLink, chuoiKyDuLieu, kyDuLieu, khopChuKy, soSanhHangSo — thuần, không mạng
  payos.ts         PayosPort (taoLink, docLink, huyLink), chonPayosPort, PayosError
  db.ts            MỌI câu SQL của nhóm đơn hàng, một chỗ duy nhất
  ky-han.ts        tinhStartsAt, daCapChoDon, maLoi — thuần
  fulfil.ts        apDungThanhToan, fulfilOrder
  thu.ts           guiThuGiaoDich: ngân sách ngày + audit email.sent
  cron.ts          chayCron và năm việc

apps/api/src/email/mau-don-hang.ts   mauBienNhan, mauThieuTien, mauBaoAdminThieuTien, mauNhacHan
apps/api/src/routes/pay-webhook.ts
apps/api/src/routes/console-orders.ts
apps/api/src/routes/admin-orders.ts

apps/api/test/commerce-chu-ky.test.ts, commerce-payos.test.ts, commerce-db.test.ts,
  commerce-ky-han.test.ts, commerce-fulfil.test.ts, commerce-cron.test.ts,
  email-mau-don-hang.test.ts, pay-webhook.test.ts, console-orders.test.ts, admin-orders.test.ts
apps/api/test-db/commerce.itest.mjs

scripts/lib/payos-fake.mjs  (+ payos-fake.test.mjs)   máy chủ PayOS giả + hàm ký webhook
scripts/pay-fake-webhook.mjs                            ký và bắn một webhook vào API

apps/console/src/features/mua/page.tsx, the-goi.tsx (+ .test.tsx)
apps/console/src/features/don-hang/page.tsx, chi-tiet.tsx, ma-qr.tsx (+ .test.tsx),
  trang-thai.ts (+ .test.ts)
apps/admin/src/features/orders/api.ts, hooks.ts, trang-thai.ts (+ .test.ts), page.tsx (+ .test.tsx),
  chi-tiet.tsx (+ .test.tsx), khong-khop.tsx

docs/evidence/commerce/2026-09-19-pha-3-thanh-toan.md
```

**Sửa**

```
apps/api/src/audit.ts (+ test/audit.test.ts)           actor customer:<email>
apps/api/src/env.ts                                     PAYOS_*, CONSOLE_ORIGIN, PAYOS_WEBHOOK_RATE_LIMITER
apps/api/src/index.ts                                   mount ba nhóm route; export { fetch, scheduled }
apps/api/wrangler.toml                                  [triggers], ratelimit mới, CONSOLE_ORIGIN
apps/api/src/routes/admin.ts                            ALL_PERMISSIONS + orders.read/orders.write
apps/api/test/helpers/fake-sql.ts                       thêm sql.begin
db/schema.dbtest.mjs                                    23 bảng; 13 cột UPDATE của customer_order
scripts/api-db-test.mjs                                 chạy payos-fake, ba khoá giả, --test-scheduled
apps/console/src/lib/api.ts, lib/error-vi.ts, routes.tsx, layout/app-shell.tsx,
  features/tong-quan/page.tsx, package.json (qrcode-generator)
apps/admin/src/lib/permissions.ts, layout/sidebar-nav.tsx (+ .test.tsx), routes.tsx (+ .test.tsx)
README.md, docs/DEVLOG.md (mục 23)
```

---

### Task 1: Sửa `audit()` — cổng khách hàng đang không ghi nhật ký

**Vì sao đứng đầu:** `audit()` đọc `c.get('reviewer')` và trả về sớm khi rỗng. Route khách hàng
(`console.ts`, `console-auth.ts`) chưa bao giờ đặt `reviewer`, nên `customer.tenant_create`,
`customer.key_issue`, `customer.key_revoke`, `customer.logout_all` **và `email.sent`** đều bị bỏ
qua từ pha 2. `email.sent` là nguồn của `daGuiHomNay()`, tức ngân sách 100 thư/ngày của Resend
chưa từng được đếm. Pha 3 ghi `order.*` bằng cùng đường này và cron chống gửi trùng bằng
`admin_audit` — không sửa thì cả hai câm.

**Files:**
- Modify: `apps/api/src/audit.ts`
- Test: `apps/api/test/audit.test.ts`

- [ ] **Step 1: Viết test đỏ**

Thêm vào cuối `apps/api/test/audit.test.ts`:

```ts
describe('audit() chọn actor', () => {
  const ghi = async (bienContext: Record<string, unknown>) => {
    const { audit } = await import('../src/audit');
    const { fakeSql } = await import('./helpers/fake-sql');
    const { calls } = fakeSql([]);
    // Context giả: đủ `get`, `env`, `executionCtx`; getSql thật sẽ mở client tới cổng đóng nên
    // ta chặn ở tầng module bằng vi.mock ở file này (xem đầu file) — ở đây chỉ kiểm chọn actor.
    const c = {
      get: (k: string) => bienContext[k],
      env: {},
      executionCtx: { waitUntil: () => {} },
    } as never;
    audit(c, 'customer.key_issue', 'abc');
    return calls;
  };

  it('có reviewer → actor là email của Access', async () => {
    await expect(ghi({ reviewer: 'phong@test.local' })).resolves.toBeDefined();
  });

  it('không có reviewer nhưng có customer → actor là customer:<email>', async () => {
    const { chonActor } = await import('../src/audit');
    expect(
      chonActor({
        reviewer: undefined,
        customer: { email: 'khach@vidu.vn', accountId: 'a', tenantId: null },
      }),
    ).toBe('customer:khach@vidu.vn');
  });

  it('reviewer thắng customer khi có cả hai', async () => {
    const { chonActor } = await import('../src/audit');
    expect(
      chonActor({ reviewer: 'phong@test.local', customer: { email: 'khach@vidu.vn' } }),
    ).toBe('phong@test.local');
  });

  it('không có gì → chuỗi rỗng (và audit() bỏ qua)', async () => {
    const { chonActor } = await import('../src/audit');
    expect(chonActor({ reviewer: undefined, customer: undefined })).toBe('');
  });
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/audit.test.ts`
Expected: FAIL — `chonActor` không tồn tại.

- [ ] **Step 3: Sửa `audit.ts`**

Thêm `chonActor` và dùng nó trong `audit()`:

```ts
/**
 * Actor của một dòng nhật ký. Người quản trị (Access) đứng trước; khách đã đăng nhập ở cổng tự
 * phục vụ ghi dưới dạng `customer:<email>` để tra được ai đã cấp khoá, mua gói, đăng xuất.
 *
 * Sự cố phát hiện 19/09/2026 khi viết plan pha 3: bản cũ chỉ đọc `reviewer`, nên mọi dòng
 * `customer.*` và cả `email.sent` của pha 2 đều bị bỏ qua — ngân sách thư chưa từng được đếm.
 */
export function chonActor(bien: {
  reviewer?: string | undefined;
  customer?: { email: string } | undefined;
}): string {
  if (bien.reviewer) return bien.reviewer;
  if (bien.customer?.email) return `customer:${bien.customer.email}`;
  return '';
}
```

và trong `audit()` thay `const actor = c.get('reviewer') ?? '';` bằng:

```ts
  const actor = chonActor({ reviewer: c.get('reviewer'), customer: c.get('customer') });
```

- [ ] **Step 4: Chạy test, thấy xanh; chạy cả bộ API**

Run: `pnpm --filter @mapslibvn/api test`
Expected: PASS toàn bộ (550 + 4).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit.ts apps/api/test/audit.test.ts
git commit -m "fix(api): audit() ghi actor customer:<email> — nhật ký cổng khách hàng và email.sent từng bị bỏ qua

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Migration `0023` — đơn hàng và sự kiện thanh toán

**Files:**
- Create: `db/migrations/0023_customer_order.sql`, `db/migrations/0023_customer_order.down.sql`
- Modify: `db/schema.dbtest.mjs`

- [ ] **Step 1: Viết migration**

`db/migrations/0023_customer_order.sql`:

```sql
-- Đơn hàng và sự kiện thanh toán cho cổng tự phục vụ (spec thương mại tự phục vụ mục 5.2, 9).
-- Số 0023 chứ không phải 0021 như spec: repo đã có 0021 (cấp lại GRANT api_key) và 0022 (hàm xoá
-- tenant) trước khi pha này bắt đầu.

-- PayOS đòi orderCode là số nguyên duy nhất; description tối đa 9 ký tự với tài khoản ngân hàng
-- chưa liên kết → nội dung chuyển khoản là 'MLV' + orderCode, đúng 9 ký tự từ 100001 tới 999999.
CREATE SEQUENCE IF NOT EXISTS customer_order_code_seq START 100001;

CREATE TABLE IF NOT EXISTS customer_order (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code       bigint NOT NULL UNIQUE DEFAULT nextval('customer_order_code_seq'),
  tenant_id        uuid NOT NULL REFERENCES tenant (id),
  account_id       uuid NOT NULL REFERENCES customer_account (id),
  kind             text NOT NULL CHECK (kind IN ('plan', 'addon')),
  tier             text CHECK (tier IN ('starter', 'professional', 'business')),
  months           int  CHECK (months IN (1, 3, 6, 12)),
  quota_group      text CHECK (quota_group IN ('places', 'directions')),
  packs            int  CHECK (packs > 0 AND packs <= 1000),
  amount_vnd       bigint NOT NULL CHECK (amount_vnd > 0),
  amount_usd_cents int NOT NULL,
  status           text NOT NULL CHECK (status IN
    ('pending', 'paid', 'fulfilled', 'paid_unfulfilled', 'underpaid', 'expired', 'cancelled', 'refunded')),
  provider         text NOT NULL DEFAULT 'payos',
  payment_link_id  text,
  checkout_url     text,
  qr_code          text,
  link_expires_at  timestamptz,
  paid_at          timestamptz,
  paid_amount_vnd  bigint,
  fulfilled_at     timestamptz,
  fulfil_attempts  int NOT NULL DEFAULT 0,
  fulfil_error     text,
  entitlement_receipt jsonb,
  note             text,                           -- admin ghi khi xác nhận tay / hoàn tiền
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'plan'  AND tier IS NOT NULL AND months IS NOT NULL AND quota_group IS NULL AND packs IS NULL)
      OR (kind = 'addon' AND quota_group IS NOT NULL AND packs IS NOT NULL AND tier IS NULL AND months IS NULL))
);
CREATE INDEX IF NOT EXISTS customer_order_tenant_idx ON customer_order (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_order_status_idx ON customer_order (status, created_at DESC);

-- Mọi webhook nhận được, kể cả sai chữ ký hay không khớp đơn nào. `reference` của PayOS là khoá
-- chống trùng: PayOS gửi lại thì INSERT đụng UNIQUE và ta trả 200 mà không làm gì thêm.
CREATE TABLE IF NOT EXISTS payment_event (
  id              bigserial PRIMARY KEY,
  order_id        uuid REFERENCES customer_order (id),  -- NULL khi không khớp đơn hoặc sai chữ ký
  provider        text NOT NULL,
  reference       text NOT NULL,
  order_code      bigint,
  -- NULL khi sự kiện không phải "tiền vào" (sai chữ ký, code khác 00): tổng tiền chỉ cộng cột này.
  amount_vnd      bigint,
  signature_valid boolean NOT NULL,
  payload         jsonb NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, reference)
);
CREATE INDEX IF NOT EXISTS payment_event_order_idx ON payment_event (order_id, id);
CREATE INDEX IF NOT EXISTS payment_event_unmatched_idx
  ON payment_event (received_at DESC) WHERE order_id IS NULL;

-- GRANT theo CỘT như 0020. `tenant_id`, `account_id`, `kind`, `tier`, `months`, `quota_group`,
-- `packs`, `amount_vnd`, `amount_usd_cents`, `order_code`, `created_at` cố ý VẮNG: đó là nội dung
-- và giá của đơn, chốt lúc tạo và không route nào được đổi sau đó. Không có DELETE: đơn là hồ sơ
-- tài chính, chỉ đổi trạng thái.
GRANT SELECT, INSERT ON customer_order TO api;
GRANT UPDATE (status, payment_link_id, checkout_url, qr_code, link_expires_at, paid_at,
              paid_amount_vnd, fulfilled_at, fulfil_attempts, fulfil_error,
              entitlement_receipt, note, updated_at) ON customer_order TO api;
GRANT USAGE, SELECT ON SEQUENCE customer_order_code_seq TO api;
-- payment_event chỉ ghi thêm, không bao giờ sửa hay xoá: nó là nhật ký tiền vào.
GRANT SELECT, INSERT ON payment_event TO api;
GRANT USAGE, SELECT ON SEQUENCE payment_event_id_seq TO api;
```

`db/migrations/0023_customer_order.down.sql`:

```sql
-- payment_event tham chiếu customer_order nên phải bỏ trước.
DROP TABLE IF EXISTS payment_event;
DROP TABLE IF EXISTS customer_order;
DROP SEQUENCE IF EXISTS customer_order_code_seq;
```

- [ ] **Step 2: Cập nhật `db/schema.dbtest.mjs` — hai con số**

Trong bài `'0015/0016/0020: api được UPDATE đúng danh sách cột…'`, đổi tên bài thành
`'0015/0016/0020/0023: …'` và chèn giữa `'customer_login_code.consumed_at'` và
`'customer_session.expires_at'`:

```js
      // 0023 — đơn hàng. Cột nội dung/giá (tenant_id, kind, tier, months, packs, amount_*)
      // cố ý VẮNG: chốt lúc tạo, không route nào đổi được. Không có DELETE trên bảng nào.
      'customer_order.checkout_url',
      'customer_order.entitlement_receipt',
      'customer_order.fulfil_attempts',
      'customer_order.fulfil_error',
      'customer_order.fulfilled_at',
      'customer_order.link_expires_at',
      'customer_order.note',
      'customer_order.paid_amount_vnd',
      'customer_order.paid_at',
      'customer_order.payment_link_id',
      'customer_order.qr_code',
      'customer_order.status',
      'customer_order.updated_at',
```

Trong bài vòng đời migration, đổi:

```js
    // 23 = 21 bảng tới migration 0022, cộng hai bảng của 0023: customer_order, payment_event.
    expect((await tables()).length).toBe(23);
```

- [ ] **Step 3: Áp migration lên DB dev và chạy bộ DB**

```bash
pnpm db:up && pnpm db:migrate
pnpm exec vitest run --config vitest.db.config.ts db/schema.dbtest.mjs
```

Expected: PASS; bài vòng đời lùi rồi tiến lại toàn bộ migration (kể cả 0023 xuống/lên sạch).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0023_customer_order.sql db/migrations/0023_customer_order.down.sql db/schema.dbtest.mjs
git commit -m "feat(db): migration 0023 — customer_order và payment_event, GRANT theo cột cho role api

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Chữ ký PayOS — thuần, có vector cố định

**Files:**
- Create: `apps/api/src/commerce/chu-ky.ts`
- Test: `apps/api/test/commerce-chu-ky.test.ts`

Vector dưới đây tính bằng `node:crypto` với khoá `kiem-thu-checksum-key`, theo đúng thuật toán của
`@payos/node@2.0.5` (`sortObjDataByKey` → `convertObjToQueryStr` → HMAC-SHA256 hex). Test là bằng
chứng thuật toán của ta và của SDK chính thức cho ra cùng một chuỗi byte.

- [ ] **Step 1: Viết test đỏ**

`apps/api/test/commerce-chu-ky.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  chuoiKyDuLieu,
  khopChuKy,
  kyDuLieu,
  kyTaoLink,
  soSanhHangSo,
} from '../src/commerce/chu-ky';

const KHOA = 'kiem-thu-checksum-key';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';

describe('kyTaoLink — chữ ký khi tạo link', () => {
  it('đúng chuỗi amount&cancelUrl&description&orderCode&returnUrl và đúng HMAC', async () => {
    const sig = await kyTaoLink(
      {
        amount: 1_950_000,
        cancelUrl: `https://api.test/console/don-hang/${ORDER_ID}?ket-qua=huy`,
        description: 'MLV100001',
        orderCode: 100001,
        returnUrl: `https://api.test/console/don-hang/${ORDER_ID}?ket-qua=thanh-cong`,
      },
      KHOA,
    );
    // Vector tính bằng node:crypto ngoài Worker, 19/09/2026.
    expect(sig).toBe('b3a5e4052d63e72368197aed9cc3e6d39c525ea6ec530c864b8564eeeb9d4f37');
  });
});

describe('chuoiKyDuLieu — luật của SDK chính thức', () => {
  const data = {
    orderCode: 100001,
    amount: 1_950_000,
    description: 'MLV100001',
    accountNumber: '0123456789',
    reference: 'FT26262ABC123',
    transactionDateTime: '2026-09-19 10:15:00',
    currency: 'VND',
    paymentLinkId: '8f3e2c1d9a7b4c6e8d0f1a2b3c4d5e6f',
    code: '00',
    desc: 'Thành công',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: null,
    counterAccountNumber: null,
    virtualAccountName: '',
    virtualAccountNumber: '',
  };

  it('sắp khoá theo bảng chữ cái, null thành rỗng, nối bằng &', () => {
    expect(chuoiKyDuLieu(data)).toBe(
      'accountNumber=0123456789&amount=1950000&code=00&counterAccountBankId=&counterAccountBankName=&counterAccountName=&counterAccountNumber=&currency=VND&desc=Thành công&description=MLV100001&orderCode=100001&paymentLinkId=8f3e2c1d9a7b4c6e8d0f1a2b3c4d5e6f&reference=FT26262ABC123&transactionDateTime=2026-09-19 10:15:00&virtualAccountName=&virtualAccountNumber=',
    );
  });

  it('bỏ trường undefined, giữ chuỗi "null"/"undefined" thành rỗng như SDK', () => {
    expect(chuoiKyDuLieu({ b: undefined, a: 'null', c: 'undefined', d: false })).toBe(
      'a=&c=&d=false',
    );
  });

  it('mảng: JSON.stringify sau khi sắp khoá từng phần tử (kể cả điểm kỳ quặc của SDK)', () => {
    // SDK gọi sortObjDataByKey lên MỌI phần tử; với số nguyên thì Object.keys(3) rỗng → {}.
    // Chép đúng để chữ ký khớp nếu một ngày PayOS gửi mảng; webhook hiện không có mảng.
    expect(chuoiKyDuLieu({ items: [{ z: 1, a: 2 }], n: [1] })).toBe(
      'items=[{"a":2,"z":1}]&n=[{}]',
    );
  });

  it('HMAC của webhook mẫu khớp vector', async () => {
    expect(await kyDuLieu(data, KHOA)).toBe(
      '993354446fbecee7a023e91e61e11b6584a473fa883e1a91c6fb5d4d44c2a754',
    );
  });

  it('khopChuKy đúng/sai, và đổi một chữ số là sai', async () => {
    const sig = await kyDuLieu(data, KHOA);
    expect(await khopChuKy(data, sig, KHOA)).toBe(true);
    expect(await khopChuKy({ ...data, amount: 1_950_001 }, sig, KHOA)).toBe(false);
    expect(await khopChuKy(data, sig.toUpperCase(), KHOA)).toBe(false);
    expect(await khopChuKy(data, '', KHOA)).toBe(false);
  });

  it('chữ ký phản hồi tạo link khớp vector', async () => {
    const resp = {
      bin: '970422',
      accountNumber: '0123456789',
      accountName: 'DO TIEN PHONG',
      amount: 1_950_000,
      description: 'MLV100001',
      orderCode: 100001,
      currency: 'VND',
      paymentLinkId: '8f3e2c1d9a7b4c6e8d0f1a2b3c4d5e6f',
      status: 'PENDING',
      checkoutUrl: 'https://pay.payos.vn/web/8f3e2c1d9a7b4c6e8d0f1a2b3c4d5e6f',
      qrCode:
        '00020101021238570010A00000072701270006970422011300123456789020208QRIBFTTA53037045406195000005802VN62130809MLV1000016304ABCD',
    };
    expect(await kyDuLieu(resp, KHOA)).toBe(
      '24c32a8695fad03523cb0ba6ce5e06bfa8f37c1d90ded2b724e89c4874d6b4bb',
    );
  });
});

describe('soSanhHangSo', () => {
  it('bằng khi giống hệt, khác khi lệch độ dài hoặc một ký tự', () => {
    expect(soSanhHangSo('abc', 'abc')).toBe(true);
    expect(soSanhHangSo('abc', 'abd')).toBe(false);
    expect(soSanhHangSo('abc', 'ab')).toBe(false);
    expect(soSanhHangSo('', '')).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-chu-ky.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `chu-ky.ts`**

```ts
/**
 * Chữ ký PayOS, chép đúng thuật toán của SDK chính thức `@payos/node@2.0.5`
 * (`lib/utils/sort-obj-by-key.js`, `lib/utils/convert-obj-to-query-str.js`,
 * `lib/crypto/subtle-crypto.js`). Không cài SDK vào Worker: toàn bộ giá trị của nó với ta là ~40
 * dòng dưới đây, và ít mã lạ chạy cạnh khoá thanh toán hơn. Mọi thay đổi ở đây phải qua vector
 * cố định trong test/commerce-chu-ky.test.ts.
 */

const encoder = new TextEncoder();

async function hmacHex(chuoi: string, khoa: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(khoa),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(chuoi));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface TaoLinkKy {
  amount: number;
  cancelUrl: string;
  description: string;
  orderCode: number;
  returnUrl: string;
}

/** Chữ ký gửi kèm `POST /v2/payment-requests`: đúng năm trường, đúng thứ tự này. */
export function kyTaoLink(input: TaoLinkKy, checksumKey: string): Promise<string> {
  const chuoi =
    `amount=${input.amount}&cancelUrl=${input.cancelUrl}&description=${input.description}` +
    `&orderCode=${input.orderCode}&returnUrl=${input.returnUrl}`;
  return hmacHex(chuoi, checksumKey);
}

type DuLieu = Record<string, unknown>;

/** `sortObjDataByKey` của SDK: sắp khoá; với giá trị không phải object thì Object.keys rỗng → {}. */
function sapXepKhoa(gia: unknown): Record<string, unknown> {
  const doiTuong = (gia ?? {}) as Record<string, unknown>;
  return Object.keys(doiTuong)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = doiTuong[k];
      return acc;
    }, {});
}

/**
 * `convertObjToQueryStr(sortObjDataByKey(data))` của SDK, giữ nguyên cả điểm kỳ quặc: phần tử
 * mảng đi qua `sortObjDataByKey` bất kể kiểu. Webhook thật hiện không có mảng, nhưng nếu một ngày
 * có thì chữ ký phải khớp với thứ PayOS tính, không phải với thứ ta thấy hợp lý.
 */
export function chuoiKyDuLieu(data: DuLieu): string {
  return Object.keys(data)
    .sort()
    .filter((k) => data[k] !== undefined)
    .map((k) => {
      let v: unknown = data[k];
      if (Array.isArray(v)) v = JSON.stringify(v.map((phanTu) => sapXepKhoa(phanTu)));
      if (v === null || v === undefined || v === 'undefined' || v === 'null') v = '';
      return `${k}=${String(v)}`;
    })
    .join('&');
}

/** Chữ ký của `data` trong webhook và trong mọi phản hồi của PayOS. */
export function kyDuLieu(data: DuLieu, checksumKey: string): Promise<string> {
  return hmacHex(chuoiKyDuLieu(data), checksumKey);
}

/**
 * So sánh không phụ thuộc vị trí sai khác. `!==` thoát ở byte sai đầu tiên, và thời gian đó đo
 * được từ ngoài; với chữ ký hex 64 ký tự thì XOR toàn bộ rồi mới kết luận.
 */
export function soSanhHangSo(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let khac = 0;
  for (let i = 0; i < a.length; i += 1) khac |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return khac === 0;
}

export async function khopChuKy(
  data: DuLieu,
  chuKy: string,
  checksumKey: string,
): Promise<boolean> {
  if (typeof chuKy !== 'string' || !/^[0-9a-f]{64}$/.test(chuKy)) return false;
  return soSanhHangSo(await kyDuLieu(data, checksumKey), chuKy);
}
```

- [ ] **Step 4: Chạy test, thấy xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-chu-ky.test.ts`
Expected: PASS 9 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/commerce/chu-ky.ts apps/api/test/commerce-chu-ky.test.ts
git commit -m "feat(api): chữ ký PayOS — chép đúng thuật toán SDK, so sánh hằng thời gian, vector cố định

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Cổng PayOS — `PayosPort`, bản thật và bản thiếu cấu hình

**Files:**
- Create: `apps/api/src/commerce/payos.ts`
- Modify: `apps/api/src/env.ts`
- Test: `apps/api/test/commerce-payos.test.ts`

- [ ] **Step 1: Thêm biến môi trường vào `env.ts`**

Chèn sau khối `GOOGLE_CLIENT_SECRET?: string;`:

```ts
  /**
   * Ba khoá PayOS, đặt bằng `wrangler secret put PAYOS_CLIENT_ID --env production` (tương tự hai
   * khoá kia). Vắng bất kỳ khoá nào → tạo đơn trả 503 `payment_provider_not_configured` và webhook
   * trả 503: KHÔNG có nhánh "tạm tin khi thiếu khoá". Harness nạp ba giá trị GIẢ và trỏ PAYOS_BASE
   * về máy chủ giả trong scripts/lib/payos-fake.mjs.
   */
  PAYOS_CLIENT_ID?: string;
  PAYOS_API_KEY?: string;
  PAYOS_CHECKSUM_KEY?: string;
  /** Gốc API PayOS. Bỏ trống = https://api-merchant.payos.vn; harness trỏ về bản giả. */
  PAYOS_BASE?: string;
  /** Gốc trang thanh toán, để dựng lại checkoutUrl từ paymentLinkId. Bỏ trống = https://pay.payos.vn. */
  PAYOS_CHECKOUT_BASE?: string;
  /** Webhook sai chữ ký: tối đa 20 dòng ghi/phút mỗi IP để DB không bị lũ rác. */
  PAYOS_WEBHOOK_RATE_LIMITER?: RateLimit;
  /**
   * Gốc URL cổng khách hàng để dựng link trong thư gửi từ cron (không có request nào để lấy
   * origin). Production: https://api.ai-solutions.io.vn. Vắng → thư không có nút mở console.
   */
  CONSOLE_ORIGIN?: string;
```

- [ ] **Step 2: Viết test đỏ**

`apps/api/test/commerce-payos.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { kyDuLieu, kyTaoLink } from '../src/commerce/chu-ky';
import { chonPayosPort, PayosError } from '../src/commerce/payos';

const KHOA = 'kiem-thu-checksum-key';
const env = {
  ENVIRONMENT: 'test',
  PAYOS_CLIENT_ID: 'client-1',
  PAYOS_API_KEY: 'api-key-1',
  PAYOS_CHECKSUM_KEY: KHOA,
  PAYOS_BASE: 'https://payos.test',
};

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const input = {
  orderCode: 100001,
  amount: 1_950_000,
  description: 'MLV100001',
  returnUrl: `https://api.test/console/don-hang/${ORDER_ID}?ket-qua=thanh-cong`,
  cancelUrl: `https://api.test/console/don-hang/${ORDER_ID}?ket-qua=huy`,
  expiredAt: new Date('2026-09-20T10:00:00Z'),
  buyerEmail: 'khach@vidu.vn',
  buyerName: null,
  buyerCompanyName: 'Công ty Thử',
  buyerTaxCode: null,
  buyerAddress: null,
  itemName: 'Starter 3 tháng',
};

/** Phản hồi PayOS hợp lệ: thân JSON kèm chữ ký đúng trên `data`. */
const phanHoi = async (data: Record<string, unknown>, code = '00', status = 200) =>
  new Response(
    JSON.stringify({ code, desc: code === '00' ? 'success' : 'lỗi', data, signature: await kyDuLieu(data, KHOA) }),
    { status, headers: { 'content-type': 'application/json' } },
  );

const dataTao = {
  bin: '970422',
  accountNumber: '0123456789',
  accountName: 'DO TIEN PHONG',
  amount: 1_950_000,
  description: 'MLV100001',
  orderCode: 100001,
  currency: 'VND',
  paymentLinkId: 'link-abc',
  status: 'PENDING',
  checkoutUrl: 'https://pay.payos.vn/web/link-abc',
  qrCode: '000201...',
};

describe('chonPayosPort', () => {
  it('thiếu một trong ba khoá → bản thieu-cau-hinh, mọi lời gọi ném payment_provider_not_configured', async () => {
    const port = chonPayosPort({ ...env, PAYOS_API_KEY: undefined } as never);
    expect(port.ten).toBe('thieu-cau-hinh');
    await expect(port.taoLink(input)).rejects.toMatchObject({
      code: 'payment_provider_not_configured',
    });
    await expect(port.docLink(100001)).rejects.toBeInstanceOf(PayosError);
  });

  it('đủ khoá → bản thật, gốc mặc định api-merchant.payos.vn khi không đặt PAYOS_BASE', () => {
    const port = chonPayosPort({ ...env, PAYOS_BASE: undefined } as never);
    expect(port.ten).toBe('payos');
    expect(port.checkoutUrlTuId('abc')).toBe('https://pay.payos.vn/web/abc');
  });
});

describe('taoLink', () => {
  it('gửi đúng header, đúng thân, chữ ký đúng, expiredAt là giây', async () => {
    const fetchImpl = vi.fn(async () => phanHoi(dataTao));
    const port = chonPayosPort(env as never, fetchImpl as unknown as typeof fetch);
    const link = await port.taoLink(input);

    expect(link).toEqual({
      paymentLinkId: 'link-abc',
      checkoutUrl: 'https://pay.payos.vn/web/link-abc',
      qrCode: '000201...',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://payos.test/v2/payment-requests');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-client-id']).toBe('client-1');
    expect(headers['x-api-key']).toBe('api-key-1');
    const than = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(than.orderCode).toBe(100001);
    expect(than.amount).toBe(1_950_000);
    expect(than.description).toBe('MLV100001');
    expect(than.expiredAt).toBe(Math.floor(input.expiredAt.getTime() / 1000));
    expect(than.buyerEmail).toBe('khach@vidu.vn');
    expect(than.buyerCompanyName).toBe('Công ty Thử');
    expect(than).not.toHaveProperty('buyerName');
    expect(than.items).toEqual([{ name: 'Starter 3 tháng', quantity: 1, price: 1_950_000 }]);
    expect(than.signature).toBe(
      await kyTaoLink(
        {
          amount: 1_950_000,
          cancelUrl: input.cancelUrl,
          description: 'MLV100001',
          orderCode: 100001,
          returnUrl: input.returnUrl,
        },
        KHOA,
      ),
    );
  });

  it('chữ ký phản hồi sai → PayosError payos_response_signature, KHÔNG trả link', async () => {
    const fetchImpl = vi.fn(async () => {
      const res = await phanHoi(dataTao);
      const than = (await res.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...than, signature: 'f'.repeat(64) }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const port = chonPayosPort(env as never, fetchImpl as unknown as typeof fetch);
    await expect(port.taoLink(input)).rejects.toMatchObject({ code: 'payos_response_signature' });
  });

  it('desc "Đơn thanh toán đã tồn tại" → mã payos_order_exists để route rơi về GET', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: '231', desc: 'Đơn thanh toán đã tồn tại', data: null }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const port = chonPayosPort(env as never, fetchImpl as unknown as typeof fetch);
    await expect(port.taoLink(input)).rejects.toMatchObject({ code: 'payos_order_exists' });
  });

  it('mạng hỏng → payos_unreachable, thông điệp không chứa khoá', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const port = chonPayosPort(env as never, fetchImpl as unknown as typeof fetch);
    const loi = await port.taoLink(input).catch((e: unknown) => e);
    expect(loi).toMatchObject({ code: 'payos_unreachable' });
    expect(String((loi as Error).message)).not.toContain('api-key-1');
    expect(String((loi as Error).message)).not.toContain(KHOA);
  });
});

describe('docLink', () => {
  it('trả trạng thái và danh sách giao dịch; transactions không phải mảng thì thành []', async () => {
    const data = {
      id: 'link-abc',
      orderCode: 100001,
      amount: 1_950_000,
      amountPaid: 1_950_000,
      amountRemaining: 0,
      status: 'PAID',
      createdAt: '2026-09-19T10:00:00.000Z',
      transactions: [
        { reference: 'FT1', amount: 1_950_000, transactionDateTime: '2026-09-19 17:01:00' },
      ],
    };
    const fetchImpl = vi.fn(async () => phanHoi(data));
    const port = chonPayosPort(env as never, fetchImpl as unknown as typeof fetch);
    const thongTin = await port.docLink(100001);
    expect(thongTin).toMatchObject({ paymentLinkId: 'link-abc', status: 'PAID', amountPaid: 1_950_000 });
    expect(thongTin?.transactions).toEqual([
      { reference: 'FT1', amount: 1_950_000, transactionDateTime: '2026-09-19 17:01:00' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://payos.test/v2/payment-requests/100001');
    expect(init.method).toBe('GET');
  });

  it('"Mã thanh toán không tồn tại" → null; lỗi khác → ném', async () => {
    const khongCo = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: '101', desc: 'Mã thanh toán không tồn tại', data: null }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    expect(
      await chonPayosPort(env as never, khongCo as unknown as typeof fetch).docLink(1),
    ).toBeNull();

    const loiKhac = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      chonPayosPort(env as never, loiKhac as unknown as typeof fetch).docLink(1),
    ).rejects.toMatchObject({ code: 'payos_bad_response' });
  });
});

describe('huyLink', () => {
  it('POST /cancel kèm lý do; "không tồn tại" cũng coi là xong', async () => {
    const fetchImpl = vi.fn(async () =>
      phanHoi({ id: 'link-abc', orderCode: 100001, status: 'CANCELLED', transactions: [] }),
    );
    const port = chonPayosPort(env as never, fetchImpl as unknown as typeof fetch);
    await port.huyLink(100001, 'Khách huỷ');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://payos.test/v2/payment-requests/100001/cancel');
    expect(JSON.parse(String(init.body))).toEqual({ cancellationReason: 'Khách huỷ' });
  });
});
```

- [ ] **Step 3: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-payos.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 4: Viết `payos.ts`**

```ts
import type { Env } from '../env';
import { khopChuKy, kyTaoLink } from './chu-ky';

/**
 * Cổng PayOS. Ba lời gọi REST, mỗi lời gọi kiểm chữ ký trên `data` của phản hồi như SDK chính
 * thức làm — TLS lỗi hay một proxy "tốt bụng" sửa thân phản hồi thì lộ ngay chứ không âm thầm
 * lưu một checkoutUrl lạ vào đơn của khách.
 */

export type PayosEnv = Pick<
  Env,
  | 'ENVIRONMENT'
  | 'PAYOS_CLIENT_ID'
  | 'PAYOS_API_KEY'
  | 'PAYOS_CHECKSUM_KEY'
  | 'PAYOS_BASE'
  | 'PAYOS_CHECKOUT_BASE'
>;

export const PAYOS_BASE_MAC_DINH = 'https://api-merchant.payos.vn';
export const PAYOS_CHECKOUT_MAC_DINH = 'https://pay.payos.vn';
/** PayOS chậm hơn mức này thì coi như không tới: khách đang chờ QR trên màn hình. */
const TIMEOUT_MS = 10_000;

/** Mã nằm ở `code` để route khớp; message KHÔNG bao giờ chứa khoá hay dữ liệu khách. */
export class PayosError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PayosError';
  }
}

export interface TaoLinkInput {
  orderCode: number;
  amount: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  expiredAt: Date;
  buyerEmail: string;
  buyerName: string | null;
  buyerCompanyName: string | null;
  buyerTaxCode: string | null;
  buyerAddress: string | null;
  itemName: string;
}

export interface LinkThanhToan {
  paymentLinkId: string;
  checkoutUrl: string;
  /** Chuỗi VietQR (EMVCo). null khi PayOS không trả — giao diện chỉ còn nút mở trang thanh toán. */
  qrCode: string | null;
}

export interface GiaoDichPayos {
  reference: string;
  amount: number;
  transactionDateTime: string;
}

export interface ThongTinLink {
  paymentLinkId: string;
  orderCode: number;
  amount: number;
  amountPaid: number;
  amountRemaining: number;
  /** PENDING | PAID | CANCELLED | EXPIRED — giữ string vì PayOS có thể thêm giá trị. */
  status: string;
  transactions: GiaoDichPayos[];
}

export interface PayosPort {
  ten: 'payos' | 'thieu-cau-hinh';
  taoLink(input: TaoLinkInput): Promise<LinkThanhToan>;
  /** null khi PayOS nói mã thanh toán không tồn tại; lỗi khác thì ném. */
  docLink(orderCode: number): Promise<ThongTinLink | null>;
  huyLink(orderCode: number, lyDo: string): Promise<void>;
  checkoutUrlTuId(paymentLinkId: string): string;
}

interface ThanPayos {
  code?: string;
  desc?: string;
  data?: Record<string, unknown> | null;
  signature?: string;
}

/** Mã ổn định từ `desc` vì PayOS không tài liệu hoá mã số; hai câu này lấy nguyên văn từ docs. */
function maTuDesc(than: ThanPayos): string {
  const desc = (than.desc ?? '').toLowerCase();
  if (desc.includes('đã tồn tại')) return 'payos_order_exists';
  if (desc.includes('không tồn tại')) return 'payos_not_found';
  return `payos_${than.code ?? 'unknown'}`;
}

const soNguyen = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

function docGiaoDich(raw: unknown): GiaoDichPayos[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      reference: String(t.reference ?? ''),
      amount: soNguyen(t.amount),
      transactionDateTime: String(t.transactionDateTime ?? ''),
    }))
    .filter((t) => t.reference !== '');
}

export function chonPayosPort(env: PayosEnv, fetchImpl: typeof fetch = fetch): PayosPort {
  const checkoutBase = (env.PAYOS_CHECKOUT_BASE ?? PAYOS_CHECKOUT_MAC_DINH).replace(/\/+$/, '');
  const checkoutUrlTuId = (id: string) => `${checkoutBase}/web/${encodeURIComponent(id)}`;

  const clientId = env.PAYOS_CLIENT_ID;
  const apiKey = env.PAYOS_API_KEY;
  const checksumKey = env.PAYOS_CHECKSUM_KEY;
  if (!clientId || !apiKey || !checksumKey) {
    const tuChoi = () =>
      Promise.reject(
        new PayosError('payment_provider_not_configured', 'Chưa cấu hình PayOS trên máy chủ'),
      );
    return { ten: 'thieu-cau-hinh', taoLink: tuChoi, docLink: tuChoi, huyLink: tuChoi, checkoutUrlTuId };
  }

  const base = (env.PAYOS_BASE ?? PAYOS_BASE_MAC_DINH).replace(/\/+$/, '');

  async function goi(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ThanPayos> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          'x-client-id': clientId as string,
          'x-api-key': apiKey as string,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Không nhét `error.message` của fetch vào đây: nó có thể chứa URL kèm tham số.
      throw new PayosError('payos_unreachable', `Không gọi được PayOS (${method} ${path})`);
    }
    let than: ThanPayos;
    try {
      than = (await res.json()) as ThanPayos;
    } catch {
      throw new PayosError('payos_bad_response', `PayOS trả ${res.status} không phải JSON`);
    }
    if (!res.ok && !than.code) {
      throw new PayosError(`payos_http_${res.status}`, `PayOS trả HTTP ${res.status}`);
    }
    return than;
  }

  /** Mọi `data` của PayOS đều có chữ ký; sai là dừng, không dùng một trường nào trong đó. */
  async function duLieuDaKiem(than: ThanPayos): Promise<Record<string, unknown>> {
    if (than.code !== '00' || !than.data) throw new PayosError(maTuDesc(than), than.desc ?? 'PayOS từ chối');
    if (!(await khopChuKy(than.data, than.signature ?? '', checksumKey as string))) {
      throw new PayosError('payos_response_signature', 'Chữ ký phản hồi PayOS không khớp');
    }
    return than.data;
  }

  return {
    ten: 'payos',
    checkoutUrlTuId,

    async taoLink(input) {
      const signature = await kyTaoLink(
        {
          amount: input.amount,
          cancelUrl: input.cancelUrl,
          description: input.description,
          orderCode: input.orderCode,
          returnUrl: input.returnUrl,
        },
        checksumKey as string,
      );
      const than = await goi('POST', '/v2/payment-requests', {
        orderCode: input.orderCode,
        amount: input.amount,
        description: input.description,
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        expiredAt: Math.floor(input.expiredAt.getTime() / 1000),
        buyerEmail: input.buyerEmail,
        ...(input.buyerName ? { buyerName: input.buyerName } : {}),
        ...(input.buyerCompanyName ? { buyerCompanyName: input.buyerCompanyName } : {}),
        ...(input.buyerTaxCode ? { buyerTaxCode: input.buyerTaxCode } : {}),
        ...(input.buyerAddress ? { buyerAddress: input.buyerAddress } : {}),
        items: [{ name: input.itemName, quantity: 1, price: input.amount }],
        signature,
      });
      const data = await duLieuDaKiem(than);
      return {
        paymentLinkId: String(data.paymentLinkId ?? ''),
        checkoutUrl: String(data.checkoutUrl ?? checkoutUrlTuId(String(data.paymentLinkId ?? ''))),
        qrCode: typeof data.qrCode === 'string' && data.qrCode ? data.qrCode : null,
      };
    },

    async docLink(orderCode) {
      const than = await goi('GET', `/v2/payment-requests/${orderCode}`);
      if (than.code !== '00' && maTuDesc(than) === 'payos_not_found') return null;
      const data = await duLieuDaKiem(than);
      return {
        paymentLinkId: String(data.id ?? ''),
        orderCode: soNguyen(data.orderCode),
        amount: soNguyen(data.amount),
        amountPaid: soNguyen(data.amountPaid),
        amountRemaining: soNguyen(data.amountRemaining),
        status: String(data.status ?? ''),
        transactions: docGiaoDich(data.transactions),
      };
    },

    async huyLink(orderCode, lyDo) {
      const than = await goi('POST', `/v2/payment-requests/${orderCode}/cancel`, {
        cancellationReason: lyDo,
      });
      if (than.code !== '00' && maTuDesc(than) === 'payos_not_found') return;
      await duLieuDaKiem(than);
    },
  };
}
```

- [ ] **Step 5: Chạy test, thấy xanh; typecheck**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-payos.test.ts && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS 9 test; typecheck sạch.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/commerce/payos.ts apps/api/src/env.ts apps/api/test/commerce-payos.test.ts
git commit -m "feat(api): cổng PayOS — tạo/đọc/huỷ link, kiểm chữ ký mọi phản hồi, bản thiếu cấu hình fail-closed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Lớp SQL của đơn hàng — `commerce/db.ts`, một chỗ duy nhất

**Files:**
- Create: `apps/api/src/commerce/db.ts`
- Modify: `apps/api/test/helpers/fake-sql.ts` (thêm `begin`)
- Test: `apps/api/test/commerce-db.test.ts`

- [ ] **Step 1: Thêm `begin` vào `fakeSql`**

Trong `apps/api/test/helpers/fake-sql.ts`, sau dòng `tag.json = …`:

```ts
  // `sql.begin(fn)` của postgres.js chạy fn với client trong transaction; bản giả chạy ngay với
  // chính tag này — đủ để khẳng định thứ tự và nội dung câu lệnh, không giả lập rollback.
  tag.begin = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tag);
```

- [ ] **Step 2: Viết test đỏ**

`apps/api/test/commerce-db.test.ts` — bài kiểm **hình dạng câu SQL**, vì lỗi đáng sợ nhất ở đây là
một câu thiếu điều kiện `tenant_id` hay thiếu điều kiện trạng thái. Bộ này không có Postgres; câu
chạy được trên DB thật hay không do Task 13 (role `api`) và Task 15 (itest) trả lời.

```ts
import { describe, expect, it } from 'vitest';
import {
  danhSachDonCuaTenant,
  datCapHong,
  datDaCap,
  datDaTra,
  datHetHan,
  datThieuTien,
  demDonPending,
  docDonCuaTenant,
  ghiSuKienThanhToan,
  huyDonCuaTenant,
  luuLinkThanhToan,
  taoDon,
  timDonPendingChuaCoLink,
  tongTienDaNhan,
} from '../src/commerce/db';
import { fakeSql } from './helpers/fake-sql';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const ORDER = '00000000-0000-4000-8000-0000000000d1';

describe('mọi câu của khách có tenant_id ngay trong SQL', () => {
  for (const [ten, goi] of [
    ['docDonCuaTenant', (sql: never) => docDonCuaTenant(sql, TENANT, ORDER)],
    ['danhSachDonCuaTenant', (sql: never) => danhSachDonCuaTenant(sql, TENANT)],
    ['demDonPending', (sql: never) => demDonPending(sql, TENANT)],
    ['huyDonCuaTenant', (sql: never) => huyDonCuaTenant(sql, TENANT, ORDER)],
    [
      'timDonPendingChuaCoLink',
      (sql: never) =>
        timDonPendingChuaCoLink(sql, TENANT, { kind: 'plan', tier: 'starter', months: 3 }),
    ],
  ] as const) {
    it(ten, async () => {
      const { sql, calls } = fakeSql([{ n: 0 }]);
      await goi(sql as never);
      expect(calls[0]?.text).toMatch(/tenant_id = \$\d+::uuid/);
      expect(calls[0]?.params).toContain(TENANT);
    });
  }
});

describe('taoDon', () => {
  it('ghi đúng cột theo kind, tiền là số máy chủ tính, trạng thái pending', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER, order_code: 100001 }]);
    await taoDon(sql, {
      tenantId: TENANT,
      accountId: ACCOUNT,
      don: { kind: 'plan', tier: 'starter', months: 3 },
      gia: { amountVnd: 1_950_000, amountUsdCents: 7_500 },
    });
    const q = calls[0];
    expect(q?.text).toContain('INSERT INTO customer_order');
    expect(q?.text).toContain("'pending'");
    expect(q?.params).toEqual(
      expect.arrayContaining([TENANT, ACCOUNT, 'plan', 'starter', 3, null, null, 1_950_000, 7_500]),
    );
    expect(q?.text).toContain('order_code::int');
  });

  it('addon: tier/months null, quota_group/packs có giá trị', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    await taoDon(sql, {
      tenantId: TENANT,
      accountId: ACCOUNT,
      don: { kind: 'addon', group: 'places', packs: 5 },
      gia: { amountVnd: 130_000, amountUsdCents: 500 },
    });
    expect(calls[0]?.params).toEqual(
      expect.arrayContaining(['addon', null, null, 'places', 5, 130_000]),
    );
  });
});

describe('chuyển trạng thái có điều kiện — không câu nào UPDATE vô điều kiện', () => {
  it('luuLinkThanhToan chỉ ghi khi còn pending', async () => {
    const { sql, calls } = fakeSql([]);
    await luuLinkThanhToan(sql, ORDER, {
      paymentLinkId: 'l',
      checkoutUrl: 'u',
      qrCode: null,
      linkExpiresAt: new Date(),
    });
    expect(calls[0]?.text).toMatch(/WHERE id = \$\d+::uuid AND status = 'pending'/);
    expect(calls[0]?.text).toContain('updated_at = now()');
  });

  it("datDaTra chuyển từ pending/underpaid/expired/cancelled — tiền đã ghi nhận thì không mất", async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    const doi = await datDaTra(sql, ORDER, 1_950_000, new Date());
    expect(doi).toBe(true);
    expect(calls[0]?.text).toContain("status IN ('pending', 'underpaid', 'expired', 'cancelled')");
    expect(calls[0]?.text).toContain("status = 'paid'");
  });

  it('datThieuTien chỉ từ pending/underpaid', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    await datThieuTien(sql, ORDER, 1_000_000);
    expect(calls[0]?.text).toContain("status IN ('pending', 'underpaid')");
    expect(calls[0]?.text).toContain("status = 'underpaid'");
  });

  it('datDaCap chỉ từ paid/paid_unfulfilled, biên lai qua sql.json, xoá fulfil_error', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    const bienLai = { operationId: 'order:x', revision: 2 };
    await datDaCap(sql, ORDER, bienLai);
    expect(calls[0]?.text).toContain("status IN ('paid', 'paid_unfulfilled')");
    expect(calls[0]?.text).toContain("status = 'fulfilled'");
    expect(calls[0]?.text).toContain('fulfil_error = NULL');
    expect(calls[0]?.params).toContainEqual(bienLai);
  });

  it('datCapHong tăng fulfil_attempts và giữ mã lỗi', async () => {
    const { sql, calls } = fakeSql([]);
    await datCapHong(sql, ORDER, 'revision_conflict');
    expect(calls[0]?.text).toContain('fulfil_attempts = fulfil_attempts + 1');
    expect(calls[0]?.text).toContain("status = 'paid_unfulfilled'");
    expect(calls[0]?.params).toContain('revision_conflict');
  });

  it('datHetHan và huỷ chỉ từ pending', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    await datHetHan(sql, ORDER);
    await huyDonCuaTenant(sql, TENANT, ORDER);
    expect(calls[0]?.text).toContain("status = 'pending'");
    expect(calls[1]?.text).toContain("status = 'pending'");
  });
});

describe('payment_event', () => {
  it('ghiSuKienThanhToan: ON CONFLICT (provider, reference) DO NOTHING, trả true khi chèn mới', async () => {
    const { sql, calls } = fakeSql([{ id: 7 }]);
    const moi = await ghiSuKienThanhToan(sql, {
      orderId: ORDER,
      provider: 'payos',
      reference: 'FT1',
      orderCode: 100001,
      amountVnd: 1_950_000,
      signatureValid: true,
      payload: { orderCode: 100001 },
    });
    expect(moi).toBe(true);
    expect(calls[0]?.text).toContain('ON CONFLICT (provider, reference) DO NOTHING');
    expect(calls[0]?.text).toContain('RETURNING id');
    expect(calls[0]?.params).toContainEqual({ orderCode: 100001 });
  });

  it('trùng reference → false', async () => {
    const { sql } = fakeSql([]);
    expect(
      await ghiSuKienThanhToan(sql, {
        orderId: null,
        provider: 'payos',
        reference: 'FT1',
        orderCode: null,
        amountVnd: null,
        signatureValid: false,
        payload: {},
      }),
    ).toBe(false);
  });

  it('tongTienDaNhan chỉ cộng sự kiện chữ ký hợp lệ của đúng đơn', async () => {
    const { sql, calls } = fakeSql([{ tong: 1_950_000, tham_chieu: 'FT1', luc: new Date() }]);
    const kq = await tongTienDaNhan(sql, ORDER);
    expect(kq.tong).toBe(1_950_000);
    expect(kq.thamChieu).toBe('FT1');
    expect(calls[0]?.text).toContain('signature_valid');
    expect(calls[0]?.text).toMatch(/order_id = \$\d+::uuid/);
  });
});
```

- [ ] **Step 3: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-db.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 4: Viết `commerce/db.ts`**

```ts
import type { OrderInput, PaidTier, PeriodMonths, Quote, QuotaGroup } from '@mapslibvn/catalog';
import type { getSql } from '../db';

/**
 * Mọi câu SQL của nhóm đơn hàng nằm đúng ở đây, cùng lý do với console/db.ts: câu của khách phải
 * có `tenant_id` của phiên, câu đổi trạng thái phải có điều kiện trạng thái cũ, và rải chúng
 * khắp route là cách chắc chắn để một ngày quên mất một điều kiện.
 *
 * Cột `bigint` (order_code, amount_vnd, paid_amount_vnd) đọc qua `::int`: postgres.js với
 * `fetch_types: false` trả bigint dưới dạng CHUỖI, và 124.800.000 (đơn lớn nhất) nằm gọn trong int4.
 */

type Sql = ReturnType<typeof getSql>;

export type TrangThaiDon =
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'paid_unfulfilled'
  | 'underpaid'
  | 'expired'
  | 'cancelled'
  | 'refunded';

export interface DonHang {
  id: string;
  order_code: number;
  tenant_id: string;
  account_id: string;
  kind: 'plan' | 'addon';
  tier: PaidTier | null;
  months: PeriodMonths | null;
  quota_group: QuotaGroup | null;
  packs: number | null;
  amount_vnd: number;
  amount_usd_cents: number;
  status: TrangThaiDon;
  provider: string;
  payment_link_id: string | null;
  checkout_url: string | null;
  qr_code: string | null;
  link_expires_at: Date | null;
  paid_at: Date | null;
  paid_amount_vnd: number | null;
  fulfilled_at: Date | null;
  fulfil_attempts: number;
  fulfil_error: string | null;
  entitlement_receipt: unknown;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

const COT_DON = `id, order_code::int AS order_code, tenant_id, account_id, kind, tier, months,
  quota_group, packs, amount_vnd::int AS amount_vnd, amount_usd_cents, status, provider,
  payment_link_id, checkout_url, qr_code, link_expires_at, paid_at,
  paid_amount_vnd::int AS paid_amount_vnd, fulfilled_at, fulfil_attempts, fulfil_error,
  entitlement_receipt, note, created_at, updated_at`;

/** Nội dung chuyển khoản: 'MLV' + orderCode, đúng 9 ký tự — giới hạn của PayOS (spec 5.2). */
export const noiDungChuyenKhoan = (orderCode: number): string => `MLV${orderCode}`;

export async function taoDon(
  sql: Sql,
  input: { tenantId: string; accountId: string; don: OrderInput; gia: Quote },
): Promise<DonHang> {
  const d = input.don;
  const tier = d.kind === 'plan' ? d.tier : null;
  const months = d.kind === 'plan' ? d.months : null;
  const group = d.kind === 'addon' ? d.group : null;
  const packs = d.kind === 'addon' ? d.packs : null;
  const rows = await sql<DonHang[]>`
    INSERT INTO customer_order
      (tenant_id, account_id, kind, tier, months, quota_group, packs, amount_vnd, amount_usd_cents, status)
    VALUES (${input.tenantId}::uuid, ${input.accountId}::uuid, ${d.kind}, ${tier}, ${months},
            ${group}, ${packs}, ${input.gia.amountVnd}, ${input.gia.amountUsdCents}, 'pending')
    RETURNING ${sql.unsafe(COT_DON)}`;
  return rows[0] as DonHang;
}

/**
 * Đơn pending cùng nội dung mà PayOS chưa cấp link (lần trước PayOS lỗi). Khách bấm lại thì dùng
 * lại đơn đó thay vì đẻ thêm đơn — spec 9.1 bước 4.
 */
export async function timDonPendingChuaCoLink(
  sql: Sql,
  tenantId: string,
  don: OrderInput,
): Promise<DonHang | null> {
  const tier = don.kind === 'plan' ? don.tier : null;
  const months = don.kind === 'plan' ? don.months : null;
  const group = don.kind === 'addon' ? don.group : null;
  const packs = don.kind === 'addon' ? don.packs : null;
  const rows = await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE tenant_id = ${tenantId}::uuid AND status = 'pending' AND payment_link_id IS NULL
      AND kind = ${don.kind} AND tier IS NOT DISTINCT FROM ${tier}
      AND months IS NOT DISTINCT FROM ${months}
      AND quota_group IS NOT DISTINCT FROM ${group} AND packs IS NOT DISTINCT FROM ${packs}
    ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ?? null;
}

export async function luuLinkThanhToan(
  sql: Sql,
  orderId: string,
  link: { paymentLinkId: string; checkoutUrl: string; qrCode: string | null; linkExpiresAt: Date },
): Promise<void> {
  await sql`
    UPDATE customer_order
    SET payment_link_id = ${link.paymentLinkId}, checkout_url = ${link.checkoutUrl},
        qr_code = ${link.qrCode}, link_expires_at = ${link.linkExpiresAt}, updated_at = now()
    WHERE id = ${orderId}::uuid AND status = 'pending'`;
}

export async function docDonCuaTenant(
  sql: Sql,
  tenantId: string,
  orderId: string,
): Promise<DonHang | null> {
  const rows = await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE tenant_id = ${tenantId}::uuid AND id = ${orderId}::uuid`;
  return rows[0] ?? null;
}

export async function danhSachDonCuaTenant(
  sql: Sql,
  tenantId: string,
  limit = 50,
): Promise<DonHang[]> {
  return await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE tenant_id = ${tenantId}::uuid
    ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
}

export async function demDonPending(sql: Sql, tenantId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM customer_order
    WHERE tenant_id = ${tenantId}::uuid AND status = 'pending'`;
  return rows[0]?.n ?? 0;
}

/** Đọc đơn KHÔNG theo tenant — chỉ cho webhook, cron và admin, không bao giờ cho route khách. */
export async function docDon(sql: Sql, orderId: string): Promise<DonHang | null> {
  const rows = await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order WHERE id = ${orderId}::uuid`;
  return rows[0] ?? null;
}

export async function docDonTheoOrderCode(sql: Sql, orderCode: number): Promise<DonHang | null> {
  const rows = await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order WHERE order_code = ${orderCode}`;
  return rows[0] ?? null;
}

export interface SuKienMoi {
  orderId: string | null;
  provider: string;
  reference: string;
  orderCode: number | null;
  /** null khi sự kiện không phải "tiền vào" hợp lệ; tổng tiền chỉ cộng cột này. */
  amountVnd: number | null;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}

/** true nếu là sự kiện MỚI; false nếu `(provider, reference)` đã có — PayOS gửi lại. */
export async function ghiSuKienThanhToan(sql: Sql, ev: SuKienMoi): Promise<boolean> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO payment_event
      (order_id, provider, reference, order_code, amount_vnd, signature_valid, payload)
    VALUES (${ev.orderId}::uuid, ${ev.provider}, ${ev.reference}, ${ev.orderCode},
            ${ev.amountVnd}, ${ev.signatureValid}, ${sql.json(ev.payload)})
    ON CONFLICT (provider, reference) DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

/**
 * Tổng tiền đã nhận của một đơn và mã tham chiếu ĐẦU TIÊN — mã đó là `paymentReference` gửi sang
 * sổ quota, và phải ổn định qua mọi lần gọi lại để `business_identity` nhận ra cùng một đơn.
 */
export async function tongTienDaNhan(
  sql: Sql,
  orderId: string,
): Promise<{ tong: number; thamChieu: string | null; luc: Date | null }> {
  const rows = await sql<{ tong: number; tham_chieu: string | null; luc: Date | null }[]>`
    SELECT coalesce(sum(amount_vnd), 0)::int AS tong,
           (array_agg(reference ORDER BY id))[1] AS tham_chieu,
           min(received_at) AS luc
    FROM payment_event
    WHERE order_id = ${orderId}::uuid AND signature_valid AND amount_vnd IS NOT NULL`;
  const r = rows[0];
  return { tong: r?.tong ?? 0, thamChieu: r?.tham_chieu ?? null, luc: r?.luc ?? null };
}

/** Bất biến 5: tiền vào cho đơn đã expired/cancelled vẫn chuyển paid. Trả true nếu có dòng đổi. */
export async function datDaTra(
  sql: Sql,
  orderId: string,
  paidAmountVnd: number,
  paidAt: Date,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order
    SET status = 'paid', paid_amount_vnd = ${paidAmountVnd}, paid_at = ${paidAt}, updated_at = now()
    WHERE id = ${orderId}::uuid AND status IN ('pending', 'underpaid', 'expired', 'cancelled')
    RETURNING id`;
  return rows.length > 0;
}

export async function datThieuTien(
  sql: Sql,
  orderId: string,
  paidAmountVnd: number,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order
    SET status = 'underpaid', paid_amount_vnd = ${paidAmountVnd}, updated_at = now()
    WHERE id = ${orderId}::uuid AND status IN ('pending', 'underpaid')
    RETURNING id`;
  return rows.length > 0;
}

/** Bất biến 4: chỉ gọi SAU khi sổ quota đã trả biên lai. */
export async function datDaCap(sql: Sql, orderId: string, receipt: unknown): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order
    SET status = 'fulfilled', fulfilled_at = now(), entitlement_receipt = ${sql.json(receipt as never)},
        fulfil_error = NULL, updated_at = now()
    WHERE id = ${orderId}::uuid AND status IN ('paid', 'paid_unfulfilled')
    RETURNING id`;
  return rows.length > 0;
}

export async function datCapHong(sql: Sql, orderId: string, maLoi: string): Promise<void> {
  await sql`
    UPDATE customer_order
    SET status = 'paid_unfulfilled', fulfil_attempts = fulfil_attempts + 1,
        fulfil_error = ${maLoi.slice(0, 200)}, updated_at = now()
    WHERE id = ${orderId}::uuid AND status IN ('paid', 'paid_unfulfilled')`;
}

export async function datHetHan(sql: Sql, orderId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order SET status = 'expired', updated_at = now()
    WHERE id = ${orderId}::uuid AND status = 'pending' RETURNING id`;
  return rows.length > 0;
}

export async function huyDonCuaTenant(
  sql: Sql,
  tenantId: string,
  orderId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE customer_order SET status = 'cancelled', updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid AND id = ${orderId}::uuid AND status = 'pending'
    RETURNING id`;
  return rows.length > 0;
}

// ---- cron ----

export async function donCanCapLai(sql: Sql, tranThu: number, limit = 20): Promise<DonHang[]> {
  return await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE status IN ('paid', 'paid_unfulfilled') AND fulfil_attempts < ${tranThu}
    ORDER BY updated_at ASC LIMIT ${limit}`;
}

/** Pending có link, tạo quá 10 phút, link chưa hết hạn — ứng viên hỏi PayOS phòng webhook rơi. */
export async function donPendingCanDoiSoat(sql: Sql, now: Date, limit = 30): Promise<DonHang[]> {
  return await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE status = 'pending' AND payment_link_id IS NOT NULL
      AND created_at < ${now}::timestamptz - interval '10 minutes'
      AND link_expires_at > ${now}::timestamptz
    ORDER BY created_at ASC LIMIT ${limit}`;
}

/** Pending quá `link_expires_at` + 1 giờ, hoặc chưa từng có link mà đã quá 24 giờ. */
export async function donPendingQuaHan(sql: Sql, now: Date, limit = 100): Promise<DonHang[]> {
  return await sql<DonHang[]>`
    SELECT ${sql.unsafe(COT_DON)} FROM customer_order
    WHERE status = 'pending'
      AND ((link_expires_at IS NOT NULL AND link_expires_at + interval '1 hour' < ${now}::timestamptz)
        OR (link_expires_at IS NULL AND created_at + interval '24 hours' < ${now}::timestamptz))
    ORDER BY created_at ASC LIMIT ${limit}`;
}

export async function coSuKienHopLe(sql: Sql, orderId: string): Promise<boolean> {
  const rows = await sql<{ co: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM payment_event
      WHERE order_id = ${orderId}::uuid AND signature_valid AND amount_vnd IS NOT NULL) AS co`;
  return rows[0]?.co === true;
}

/** Một sự kiện với khoá (provider, reference) đã tồn tại chưa — cho lệnh admin gọi lại. */
export async function daCoSuKien(sql: Sql, provider: string, reference: string): Promise<boolean> {
  const rows = await sql<{ co: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM payment_event
      WHERE provider = ${provider} AND reference = ${reference}) AS co`;
  return rows[0]?.co === true;
}

export interface ChuTenant {
  email: string;
  billingEmail: string | null;
  tenantName: string;
}

export async function chuTenant(sql: Sql, tenantId: string): Promise<ChuTenant | null> {
  const rows = await sql<{ email: string; billing_email: string | null; name: string }[]>`
    SELECT a.email, t.billing_email, t.name
    FROM tenant t
    JOIN tenant_member m ON m.tenant_id = t.id AND m.role = 'owner'
    JOIN customer_account a ON a.id = m.account_id
    WHERE t.id = ${tenantId}::uuid
    ORDER BY m.created_at LIMIT 1`;
  const r = rows[0];
  return r ? { email: r.email, billingEmail: r.billing_email, tenantName: r.name } : null;
}

/** Tenant thương mại có chủ sở hữu — ứng viên nhận thư nhắc hạn. */
export async function tenantThuongMaiCoChu(
  sql: Sql,
  limit = 200,
): Promise<{ id: string; name: string; email: string }[]> {
  return await sql<{ id: string; name: string; email: string }[]>`
    SELECT t.id, t.name, a.email
    FROM tenant t
    JOIN tenant_member m ON m.tenant_id = t.id AND m.role = 'owner'
    JOIN customer_account a ON a.id = m.account_id AND a.disabled_at IS NULL
    WHERE t.quota_mode = 'commercial'
    ORDER BY t.created_at LIMIT ${limit}`;
}

/** Chống gửi hai thư nhắc cho cùng (tenant, kỳ, loại) — không cần cột mới, spec 9.4. */
export async function daNhacRoi(sql: Sql, target: string): Promise<boolean> {
  const rows = await sql<{ co: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM admin_audit
      WHERE action = 'email.reminder' AND target = ${target}) AS co`;
  return rows[0]?.co === true;
}

export async function donDepPhienVaMa(sql: Sql, now: Date): Promise<{ ma: number; phien: number }> {
  const ma = await sql<{ id: number }[]>`
    DELETE FROM customer_login_code WHERE expires_at < ${now}::timestamptz RETURNING id`;
  const phien = await sql<{ token_hash: string }[]>`
    DELETE FROM customer_session WHERE expires_at < ${now}::timestamptz RETURNING token_hash`;
  return { ma: ma.length, phien: phien.length };
}

// ---- admin ----

export interface DonHangAdmin extends DonHang {
  tenant_name: string;
  cursor_at: string;
}

/** Cùng danh sách cột như COT_DON, thêm tiền tố `o.` vì câu admin JOIN với tenant. */
const COT_DON_O = `o.id, o.order_code::int AS order_code, o.tenant_id, o.account_id, o.kind, o.tier,
  o.months, o.quota_group, o.packs, o.amount_vnd::int AS amount_vnd, o.amount_usd_cents, o.status,
  o.provider, o.payment_link_id, o.checkout_url, o.qr_code, o.link_expires_at, o.paid_at,
  o.paid_amount_vnd::int AS paid_amount_vnd, o.fulfilled_at, o.fulfil_attempts, o.fulfil_error,
  o.entitlement_receipt, o.note, o.created_at, o.updated_at`;

export async function danhSachDonAdmin(
  sql: Sql,
  p: { status: TrangThaiDon | null; limit: number; cursor: { createdAt: string; id: string } | null },
): Promise<DonHangAdmin[]> {
  const createdAt = p.cursor?.createdAt ?? null;
  const cursorId = p.cursor?.id ?? null;
  // Lấy dư một dòng để biết còn trang sau; to_char giữ micro giây cho con trỏ (bài học admin-tenants).
  return await sql<DonHangAdmin[]>`
    SELECT ${sql.unsafe(COT_DON_O)},
           t.name AS tenant_name,
           to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    FROM customer_order o
    JOIN tenant t ON t.id = o.tenant_id
    WHERE (${p.status}::text IS NULL OR o.status = ${p.status})
      AND (${createdAt}::text IS NULL
           OR (o.created_at, o.id) < (${createdAt}::text::timestamptz, ${cursorId}::uuid))
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ${p.limit + 1}`;
}

export interface SuKien {
  id: number;
  order_id: string | null;
  provider: string;
  reference: string;
  order_code: number | null;
  amount_vnd: number | null;
  signature_valid: boolean;
  /** Thu gọn: chỉ code/desc/orderCode/amount/transactionDateTime, không có số tài khoản đối ứng. */
  tom_tat: Record<string, unknown>;
  received_at: Date;
}

const COT_SU_KIEN = `id::int AS id, order_id, provider, reference, order_code::int AS order_code,
  amount_vnd::int AS amount_vnd, signature_valid,
  jsonb_build_object('code', payload->'code', 'desc', payload->'desc', 'orderCode', payload->'orderCode',
    'amount', payload->'amount', 'transactionDateTime', payload->'transactionDateTime',
    'reason', payload->'reason', 'bankReference', payload->'bankReference') AS tom_tat,
  received_at`;

export async function suKienCuaDon(sql: Sql, orderId: string): Promise<SuKien[]> {
  return await sql<SuKien[]>`
    SELECT ${sql.unsafe(COT_SU_KIEN)} FROM payment_event
    WHERE order_id = ${orderId}::uuid ORDER BY id`;
}

export async function suKienKhongKhop(sql: Sql, limit = 50): Promise<SuKien[]> {
  return await sql<SuKien[]>`
    SELECT ${sql.unsafe(COT_SU_KIEN)} FROM payment_event
    WHERE order_id IS NULL ORDER BY received_at DESC LIMIT ${limit}`;
}

export interface TomTatDon {
  choXuLy: number;
  doanhThu30Ngay: number;
  pendingQua1Gio: number;
  khongKhop: number;
}

export async function tomTatDon(sql: Sql, now: Date): Promise<TomTatDon> {
  const rows = await sql<
    { cho_xu_ly: number; doanh_thu: number; pending_qua: number; khong_khop: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM customer_order WHERE status IN ('paid_unfulfilled', 'underpaid')) AS cho_xu_ly,
      (SELECT coalesce(sum(paid_amount_vnd), 0)::int FROM customer_order
        WHERE status = 'fulfilled' AND paid_at >= ${now}::timestamptz - interval '30 days') AS doanh_thu,
      (SELECT count(*)::int FROM customer_order
        WHERE status = 'pending' AND created_at < ${now}::timestamptz - interval '1 hour') AS pending_qua,
      (SELECT count(*)::int FROM payment_event WHERE order_id IS NULL) AS khong_khop`;
  const r = rows[0];
  return {
    choXuLy: r?.cho_xu_ly ?? 0,
    doanhThu30Ngay: r?.doanh_thu ?? 0,
    pendingQua1Gio: r?.pending_qua ?? 0,
    khongKhop: r?.khong_khop ?? 0,
  };
}
```

- [ ] **Step 5: Chạy test, thấy xanh; typecheck**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-db.test.ts && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS 14 test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/commerce/db.ts apps/api/test/commerce-db.test.ts apps/api/test/helpers/fake-sql.ts
git commit -m "feat(api): lớp SQL đơn hàng — tenant_id trong câu, chuyển trạng thái có điều kiện, payment_event chỉ ghi thêm

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Toán kỳ hạn — `ky-han.ts`, thuần

**Files:**
- Create: `apps/api/src/commerce/ky-han.ts`
- Test: `apps/api/test/commerce-ky-han.test.ts`

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest';
import type { PeriodHistory } from '../src/billing/types';
import { daCapChoDon, maLoi, tinhStartsAt } from '../src/commerce/ky-han';

const NOW = new Date('2026-09-19T03:00:00Z');
const ky = (
  tier: 'trial' | 'starter' | 'professional',
  startsAt: string,
  endsAt: string,
  lineItemId: string | null = null,
) => ({
  periodId: `${tier}:${startsAt}`,
  tier,
  startsAt,
  endsAt,
  paymentReference: lineItemId ? 'FT' : null,
  lineItemId,
  places: { limit: 0, used: 0, reserved: 0 },
  directions: { limit: 0, used: 0, reserved: 0 },
});
const lichSu = (periods: ReturnType<typeof ky>[]): PeriodHistory => ({ periods, credits: [] });

describe('tinhStartsAt — spec 9.3 bước 2', () => {
  it('không có kỳ nào → now', () => {
    expect(tinhStartsAt(lichSu([]), NOW).toISOString()).toBe(NOW.toISOString());
  });

  it('đang dùng thử → now (sổ tự cắt trial)', () => {
    expect(
      tinhStartsAt(lichSu([ky('trial', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')]), NOW),
    ).toEqual(NOW);
  });

  it('có kỳ trả phí tới 30/11 → 30/11', () => {
    expect(
      tinhStartsAt(lichSu([ky('starter', '2026-09-01T00:00:00Z', '2026-11-30T17:00:00Z')]), NOW)
        .toISOString(),
    ).toBe('2026-11-30T17:00:00.000Z');
  });

  it('kỳ trả phí đã hết hạn → now, không lùi về quá khứ', () => {
    expect(
      tinhStartsAt(lichSu([ky('starter', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')]), NOW),
    ).toEqual(NOW);
  });

  it('nhiều kỳ nối tiếp (kể cả kỳ tương lai) → mốc muộn nhất', () => {
    expect(
      tinhStartsAt(
        lichSu([
          ky('starter', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'),
          ky('professional', '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z'),
        ]),
        NOW,
      ).toISOString(),
    ).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('daCapChoDon', () => {
  it('true khi có kỳ hoặc credit mang lineItemId của đơn', () => {
    const id = 'don-1';
    expect(daCapChoDon(lichSu([ky('starter', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', id)]), id)).toBe(true);
    expect(
      daCapChoDon(
        {
          periods: [],
          credits: [
            {
              grantId: 'g',
              periodId: 'p',
              group: 'places',
              units: 1000,
              used: 0,
              reserved: 0,
              expiresAt: '2026-10-01T00:00:00Z',
              paymentReference: 'FT',
              lineItemId: id,
            },
          ],
        },
        id,
      ),
    ).toBe(true);
    expect(daCapChoDon(lichSu([]), id)).toBe(false);
  });
});

describe('maLoi', () => {
  it('lấy message của Error, String của thứ khác', () => {
    expect(maLoi(new Error('revision_conflict'))).toBe('revision_conflict');
    expect(maLoi('x')).toBe('x');
  });
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-ky-han.test.ts`

- [ ] **Step 3: Viết `ky-han.ts`**

```ts
import type { PeriodHistory } from '../billing/types';

/**
 * Mốc bắt đầu kỳ mới (spec 9.3 bước 2): muộn nhất trong {now, endsAt của mọi kỳ TRẢ PHÍ chưa
 * kết thúc}. Kỳ dùng thử bị bỏ qua — sổ quota tự cắt trial đúng lúc kỳ trả phí bắt đầu. Kỳ đã hết
 * hạn không kéo mốc về quá khứ. Đây cũng là "hiệu lực từ …" mà màn Mua hiện cho khách.
 */
export function tinhStartsAt(history: Pick<PeriodHistory, 'periods'>, now: Date): Date {
  let moc = now.getTime();
  for (const p of history.periods) {
    if (p.tier === 'trial') continue;
    const end = Date.parse(p.endsAt);
    if (Number.isFinite(end) && end > moc) moc = end;
  }
  return new Date(moc);
}

/**
 * Sổ đã nhận đơn này chưa — nhìn bằng `lineItemId`, thứ ta luôn đặt bằng id đơn. Dùng khi sổ trả
 * `operation_conflict`: cùng operationId nhưng expectedRevision khác nghĩa là lần trước ĐÃ ghi,
 * và bằng chứng nằm trong lịch sử chứ không trong mã lỗi.
 */
export function daCapChoDon(history: PeriodHistory, orderId: string): boolean {
  return (
    history.periods.some((p) => p.lineItemId === orderId) ||
    history.credits.some((c) => c.lineItemId === orderId)
  );
}

/** Lỗi từ Durable Object về đây là Error thường (mất class qua RPC); khớp theo message. */
export const maLoi = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
```

- [ ] **Step 4: Chạy test, thấy xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-ky-han.test.ts`
Expected: PASS 8 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/commerce/ky-han.ts apps/api/test/commerce-ky-han.test.ts
git commit -m "feat(api): toán kỳ hạn — startsAt xếp sau kỳ trả phí muộn nhất, nhận biết đơn đã cấp qua lineItemId

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `apDungThanhToan()` và `fulfilOrder()` — đường duy nhất tiền đi vào sổ

**Files:**
- Create: `apps/api/src/commerce/fulfil.ts`
- Test: `apps/api/test/commerce-fulfil.test.ts`

- [ ] **Step 1: Viết test đỏ**

Bản giả của sổ và của DB nằm ngay trong test: `khoDon()` trả lời từng câu SQL theo nội dung, còn
`soGia()` ghi lại lệnh nhận được và trả lỗi theo kịch bản.

```ts
import { describe, expect, it, vi } from 'vitest';
import type { CommandReceipt, EntitlementCommand, PeriodHistory, UsageSnapshot } from '../src/billing/types';
import type { DonHang } from '../src/commerce/db';
import { apDungThanhToan, fulfilOrder } from '../src/commerce/fulfil';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const NOW = new Date('2026-09-19T03:00:00Z');
const ORDER = '00000000-0000-4000-8000-0000000000d1';
const TENANT = '00000000-0000-4000-8000-0000000000c1';

const don = (them: Partial<DonHang> = {}): DonHang => ({
  id: ORDER,
  order_code: 100001,
  tenant_id: TENANT,
  account_id: 'a',
  kind: 'plan',
  tier: 'starter',
  months: 3,
  quota_group: null,
  packs: null,
  amount_vnd: 1_950_000,
  amount_usd_cents: 7_500,
  status: 'paid',
  provider: 'payos',
  payment_link_id: 'l',
  checkout_url: 'u',
  qr_code: null,
  link_expires_at: null,
  paid_at: NOW,
  paid_amount_vnd: 1_950_000,
  fulfilled_at: null,
  fulfil_attempts: 0,
  fulfil_error: null,
  entitlement_receipt: null,
  note: null,
  created_at: NOW,
  updated_at: NOW,
  ...them,
});

/** DB giả: trạng thái đơn sống trong biến `hienTai`, các UPDATE đổi nó như DB thật sẽ làm. */
function khoDon(banDau: DonHang, tien: { tong: number; thamChieu: string | null }) {
  let hienTai = { ...banDau };
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('FROM customer_order')) return [hienTai];
    if (q.text.includes('coalesce(sum(amount_vnd)')) {
      return [{ tong: tien.tong, tham_chieu: tien.thamChieu, luc: NOW }];
    }
    if (q.text.includes("status = 'paid'") && q.text.includes('UPDATE')) {
      if (!['pending', 'underpaid', 'expired', 'cancelled'].includes(hienTai.status)) return [];
      hienTai = { ...hienTai, status: 'paid', paid_amount_vnd: q.params[0] as number };
      return [{ id: ORDER }];
    }
    if (q.text.includes("status = 'underpaid'")) {
      if (!['pending', 'underpaid'].includes(hienTai.status)) return [];
      hienTai = { ...hienTai, status: 'underpaid' };
      return [{ id: ORDER }];
    }
    if (q.text.includes("status = 'fulfilled'")) {
      if (!['paid', 'paid_unfulfilled'].includes(hienTai.status)) return [];
      hienTai = { ...hienTai, status: 'fulfilled', entitlement_receipt: q.params[0] };
      return [{ id: ORDER }];
    }
    if (q.text.includes("status = 'paid_unfulfilled'")) {
      hienTai = { ...hienTai, status: 'paid_unfulfilled', fulfil_attempts: hienTai.fulfil_attempts + 1 };
      return [];
    }
    return [];
  });
  return { sql, calls, doc: () => hienTai };
}

const usage = (them: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  tenantId: TENANT,
  status: 'active',
  tier: 'trial',
  revision: 3,
  periodId: 'trial:x',
  startsAt: '2026-09-01T00:00:00Z',
  endsAt: '2026-10-01T00:00:00Z',
  trialUsedOnce: true,
  maintenance: false,
  missingAcks: { count: 0, limit: 3, locked: false, opensAt: null },
  places: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
  directions: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
  ...them,
});

function soGia(kichBan: {
  usage?: UsageSnapshot;
  history?: PeriodHistory;
  loi?: string[];
}) {
  const lenh: EntitlementCommand[] = [];
  const loi = [...(kichBan.loi ?? [])];
  const so = {
    readUsage: vi.fn(async () => kichBan.usage ?? usage()),
    readPeriods: vi.fn(async () => kichBan.history ?? { periods: [], credits: [] }),
    applyCommand: vi.fn(async (c: EntitlementCommand): Promise<CommandReceipt> => {
      lenh.push(c);
      const ma = loi.shift();
      if (ma) throw new Error(ma);
      return {
        operationId: c.operationId,
        revision: c.expectedRevision + 1,
        status: 'active',
        tier: 'starter',
        appliedAt: NOW.toISOString(),
      };
    }),
  };
  return { so, lenh };
}

const env = {} as never;

describe('fulfilOrder — gói', () => {
  it('trial → startsAt = now, endsAt = +3 tháng, operationId order:<id>, lineItemId = id, paymentReference = mã sự kiện đầu', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so, lenh } = soGia({});
    const kq = await fulfilOrder(kho.sql, env, ORDER, { so: () => so, now: () => NOW });

    expect(kq.status).toBe('fulfilled');
    expect(lenh).toHaveLength(1);
    expect(lenh[0]).toMatchObject({
      kind: 'grantPeriod',
      operationId: `order:${ORDER}`,
      tenantId: TENANT,
      actor: 'system:payos',
      expectedRevision: 3,
      periodId: ORDER,
      tier: 'starter',
      startsAt: NOW.toISOString(),
      paymentReference: 'FT1',
      lineItemId: ORDER,
    });
    // addMonths theo lịch VN: 19/09 10:00 VN + 3 tháng = 19/12 10:00 VN = 19/12 03:00Z.
    expect((lenh[0] as { endsAt: string }).endsAt).toBe('2026-12-19T03:00:00.000Z');
    expect(kho.doc().status).toBe('fulfilled');
    // Audit ghi SAU khi sổ nhận lệnh.
    const audit = kho.calls.find((c) => c.text.includes('INSERT INTO admin_audit'));
    expect(audit?.params).toContain('order.fulfilled');
  });

  it('đang có kỳ trả phí tới 30/11 → kỳ mới bắt đầu 30/11', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so, lenh } = soGia({
      usage: usage({ tier: 'starter', periodId: 'p1' }),
      history: {
        periods: [
          {
            periodId: 'p1',
            tier: 'starter',
            startsAt: '2026-09-01T00:00:00Z',
            endsAt: '2026-11-30T17:00:00Z',
            paymentReference: 'FT0',
            lineItemId: 'don-cu',
            places: { limit: 0, used: 0, reserved: 0 },
            directions: { limit: 0, used: 0, reserved: 0 },
          },
        ],
        credits: [],
      },
    });
    await fulfilOrder(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect((lenh[0] as { startsAt: string }).startsAt).toBe('2026-11-30T17:00:00.000Z');
  });

  it('revision_conflict → đọc lại và thử lại, tối đa 3 lần', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so, lenh } = soGia({ loi: ['revision_conflict', 'revision_conflict'] });
    const kq = await fulfilOrder(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq.status).toBe('fulfilled');
    expect(lenh).toHaveLength(3);
    expect(so.readUsage).toHaveBeenCalledTimes(3);
  });

  it('operation_conflict mà lịch sử đã có lineItemId của đơn → fulfilled, KHÔNG cấp lần hai', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    let lanDoc = 0;
    const { so, lenh } = soGia({ loi: ['operation_conflict'] });
    so.readPeriods.mockImplementation(async () => {
      lanDoc += 1;
      // Lần đọc đầu chưa thấy (giả lập cuộc đua), lần hai thấy kỳ đã cấp.
      if (lanDoc === 1) return { periods: [], credits: [] };
      return {
        periods: [
          {
            periodId: ORDER,
            tier: 'starter',
            startsAt: NOW.toISOString(),
            endsAt: '2026-12-19T03:00:00.000Z',
            paymentReference: 'FT1',
            lineItemId: ORDER,
            places: { limit: 0, used: 0, reserved: 0 },
            directions: { limit: 0, used: 0, reserved: 0 },
          },
        ],
        credits: [],
      };
    });
    const kq = await fulfilOrder(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq).toMatchObject({ status: 'fulfilled', daCoTuTruoc: true });
    expect(lenh).toHaveLength(1);
    expect(kho.doc().status).toBe('fulfilled');
  });

  it('sổ không trả lời → paid_unfulfilled, fulfil_attempts + 1, audit order.fulfil_failed, KHÔNG ném', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so } = soGia({});
    so.readUsage.mockRejectedValue(new Error('Durable Object reset'));
    const kq = await fulfilOrder(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq).toMatchObject({ status: 'paid_unfulfilled', error: 'Durable Object reset' });
    expect(kho.doc().status).toBe('paid_unfulfilled');
    expect(kho.doc().fulfil_attempts).toBe(1);
    const audit = kho.calls.find((c) => c.params.includes('order.fulfil_failed'));
    expect(audit).toBeDefined();
  });

  it('đơn đã fulfilled → trả lại ngay, không gọi sổ', async () => {
    const kho = khoDon(don({ status: 'fulfilled', entitlement_receipt: { revision: 9 } }), {
      tong: 1_950_000,
      thamChieu: 'FT1',
    });
    const { so } = soGia({});
    const kq = await fulfilOrder(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq).toMatchObject({ status: 'fulfilled', daCoTuTruoc: true });
    expect(so.applyCommand).not.toHaveBeenCalled();
  });

  it('đơn pending → khong_ap_dung (không có tiền thì không cấp)', async () => {
    const kho = khoDon(don({ status: 'pending' }), { tong: 0, thamChieu: null });
    const { so } = soGia({});
    const kq = await fulfilOrder(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq).toMatchObject({ status: 'khong_ap_dung', lyDo: 'order_pending' });
    expect(so.applyCommand).not.toHaveBeenCalled();
  });
});

describe('fulfilOrder — mua thêm lượt', () => {
  const donAddon = () =>
    don({ kind: 'addon', tier: null, months: null, quota_group: 'places', packs: 5, amount_vnd: 130_000 });

  it('cần thuê bao trả phí đang hoạt động; periodId lấy LÚC CẤP', async () => {
    const kho = khoDon(donAddon(), { tong: 130_000, thamChieu: 'FT2' });
    const { so, lenh } = soGia({ usage: usage({ tier: 'starter', periodId: 'p-hien-tai' }) });
    const kq = await fulfilOrder(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq.status).toBe('fulfilled');
    expect(lenh[0]).toMatchObject({
      kind: 'addCredits',
      periodId: 'p-hien-tai',
      group: 'places',
      packs: 5,
      lineItemId: ORDER,
      paymentReference: 'FT2',
    });
  });

  it('đang dùng thử → paid_unfulfilled với mã credits_require_paid_active (cron sẽ thử lại)', async () => {
    const kho = khoDon(donAddon(), { tong: 130_000, thamChieu: 'FT2' });
    const { so } = soGia({});
    const kq = await fulfilOrder(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq).toMatchObject({ status: 'paid_unfulfilled', error: 'credits_require_paid_active' });
    expect(so.applyCommand).not.toHaveBeenCalled();
  });
});

describe('apDungThanhToan — từ sự kiện tới trạng thái', () => {
  it('đủ tiền: pending → paid → fulfilled, audit order.paid rồi order.fulfilled', async () => {
    const kho = khoDon(don({ status: 'pending', paid_amount_vnd: null }), {
      tong: 1_950_000,
      thamChieu: 'FT1',
    });
    const { so } = soGia({});
    const kq = await apDungThanhToan(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq.trangThai).toBe('fulfilled');
    const hanhDong = kho.calls
      .filter((c) => c.text.includes('INSERT INTO admin_audit'))
      .map((c) => c.params[1]);
    expect(hanhDong).toEqual(['order.paid', 'order.fulfilled']);
  });

  it('hai lần chuyển cộng lại đủ → paid (tổng, không phải một webhook)', async () => {
    const kho = khoDon(don({ status: 'underpaid', paid_amount_vnd: 1_000_000 }), {
      tong: 1_950_000,
      thamChieu: 'FT1',
    });
    const { so } = soGia({});
    const kq = await apDungThanhToan(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq.trangThai).toBe('fulfilled');
  });

  it('thiếu tiền → underpaid kèm số thiếu, không gọi sổ', async () => {
    const kho = khoDon(don({ status: 'pending' }), { tong: 1_900_000, thamChieu: 'FT1' });
    const { so } = soGia({});
    const kq = await apDungThanhToan(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq).toMatchObject({ trangThai: 'underpaid', thieu: 50_000 });
    expect(so.applyCommand).not.toHaveBeenCalled();
    expect(kho.doc().status).toBe('underpaid');
  });

  it('đơn expired mà tiền vào đủ → vẫn paid rồi cấp (bất biến 5)', async () => {
    const kho = khoDon(don({ status: 'expired' }), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so } = soGia({});
    const kq = await apDungThanhToan(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq.trangThai).toBe('fulfilled');
  });

  it('chưa có sự kiện nào → khong_doi', async () => {
    const kho = khoDon(don({ status: 'pending' }), { tong: 0, thamChieu: null });
    const { so } = soGia({});
    const kq = await apDungThanhToan(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq.trangThai).toBe('khong_doi');
  });

  it('đã fulfilled → khong_doi, không chạm sổ (webhook gửi lại)', async () => {
    const kho = khoDon(don({ status: 'fulfilled' }), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so } = soGia({});
    const kq = await apDungThanhToan(kho.sql, env, ORDER, { so: () => so, now: () => NOW });
    expect(kq.trangThai).toBe('khong_doi');
    expect(so.applyCommand).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-fulfil.test.ts`

- [ ] **Step 3: Viết `fulfil.ts`**

```ts
import { addMonths } from '@mapslibvn/catalog';
import { writeAudit } from '../audit';
import { quotaObject } from '../billing/object';
import type {
  CommandReceipt,
  EntitlementCommand,
  PeriodHistory,
  UsageSnapshot,
} from '../billing/types';
import type { getSql } from '../db';
import type { Env } from '../env';
import {
  datCapHong,
  datDaCap,
  datDaTra,
  datThieuTien,
  docDon,
  type DonHang,
  tongTienDaNhan,
} from './db';
import { daCapChoDon, maLoi, tinhStartsAt } from './ky-han';

type Sql = ReturnType<typeof getSql>;

/** Mặt của sổ quota mà nhóm này dùng; hẹp để test tiêm bản giả không cần Durable Object. */
export interface CongSo {
  applyCommand(command: EntitlementCommand): Promise<CommandReceipt>;
  readUsage(): Promise<UsageSnapshot>;
  readPeriods(limit: number): Promise<PeriodHistory>;
}

export interface FulfilDeps {
  so?: (env: Env, tenantId: string) => CongSo;
  now?: () => Date;
}

export const ACTOR_HE_THONG = 'system:payos';
/** Qua ngưỡng này cron thôi tự thử; admin xử lý (spec 9.4). */
export const TRAN_THU_CAP = 20;
const SO_LAN_THU_REVISION = 3;

export type KetQuaCap =
  | { status: 'fulfilled'; receipt: CommandReceipt | null; daCoTuTruoc: boolean }
  | { status: 'paid_unfulfilled'; error: string }
  | { status: 'khong_ap_dung'; lyDo: string };

const congSo = (deps: FulfilDeps, env: Env, tenantId: string): CongSo =>
  (deps.so ?? quotaObject)(env, tenantId);

/** Dựng lệnh cho sổ, hoặc lý do không dựng được. Thuần — mọi số liệu đã đọc xong ở ngoài. */
function dungLenh(
  don: DonHang,
  usage: UsageSnapshot,
  history: PeriodHistory,
  thamChieu: string,
  now: Date,
): EntitlementCommand | { loi: string } {
  const chung = {
    operationId: `order:${don.id}`,
    tenantId: don.tenant_id,
    actor: ACTOR_HE_THONG,
    reason: `Đơn ${don.order_code}`,
    expectedRevision: usage.revision,
    paymentReference: thamChieu,
    lineItemId: don.id,
  };
  if (don.kind === 'plan') {
    if (!don.tier || !don.months) return { loi: 'invalid_order' };
    const startsAt = tinhStartsAt(history, now);
    return {
      ...chung,
      kind: 'grantPeriod',
      periodId: don.id,
      tier: don.tier,
      startsAt: startsAt.toISOString(),
      endsAt: addMonths(startsAt, don.months).toISOString(),
    };
  }
  if (!don.quota_group || !don.packs) return { loi: 'invalid_order' };
  // periodId lấy LÚC CẤP, không phải lúc tạo đơn: kỳ có thể đã đổi trong lúc khách chuyển khoản.
  if (usage.status !== 'active' || usage.tier === 'trial' || !usage.periodId) {
    return { loi: 'credits_require_paid_active' };
  }
  return {
    ...chung,
    kind: 'addCredits',
    periodId: usage.periodId,
    group: don.quota_group,
    packs: don.packs,
  };
}

/**
 * Cấp gói cho một đơn đã có tiền. Dùng chung cho webhook, cron và admin "Thử cấp lại" — spec 9.3.
 * KHÔNG ném vì lỗi sổ: mọi nhánh hỏng đều thành `paid_unfulfilled` có mã, để webhook vẫn trả 200
 * và cron biết mà thử lại. Chỉ lỗi Postgres mới bay ra ngoài.
 */
export async function fulfilOrder(
  sql: Sql,
  env: Env,
  orderId: string,
  deps: FulfilDeps = {},
): Promise<KetQuaCap> {
  const don = await docDon(sql, orderId);
  if (!don) return { status: 'khong_ap_dung', lyDo: 'order_not_found' };
  if (don.status === 'fulfilled') {
    return {
      status: 'fulfilled',
      receipt: (don.entitlement_receipt as CommandReceipt | null) ?? null,
      daCoTuTruoc: true,
    };
  }
  if (don.status !== 'paid' && don.status !== 'paid_unfulfilled') {
    return { status: 'khong_ap_dung', lyDo: `order_${don.status}` };
  }
  const { thamChieu } = await tongTienDaNhan(sql, don.id);
  if (!thamChieu) return { status: 'khong_ap_dung', lyDo: 'no_payment_reference' };

  const so = congSo(deps, env, don.tenant_id);
  const now = (deps.now ?? (() => new Date()))();
  let loiCuoi = 'unknown';

  for (let lan = 0; lan < SO_LAN_THU_REVISION; lan += 1) {
    let usage: UsageSnapshot;
    let history: PeriodHistory;
    try {
      usage = await so.readUsage();
      history = await so.readPeriods(60);
    } catch (error) {
      loiCuoi = maLoi(error);
      break;
    }

    // Sổ đã có kỳ/credit mang lineItemId của đơn: lần trước đã ghi (có thể là cuộc đua với cron,
    // hoặc operation_conflict ở vòng trước). Chỉ cần ghi nhận, tuyệt đối không cấp lần hai.
    if (daCapChoDon(history, don.id)) {
      await datDaCap(sql, don.id, { daCoTuTruoc: true });
      await writeAudit(sql, {
        actor: ACTOR_HE_THONG,
        action: 'order.fulfilled',
        target: don.id,
        detail: { order_code: don.order_code, tenant_id: don.tenant_id, da_co_tu_truoc: true },
      });
      return { status: 'fulfilled', receipt: null, daCoTuTruoc: true };
    }

    const lenh = dungLenh(don, usage, history, thamChieu, now);
    if ('loi' in lenh) {
      loiCuoi = lenh.loi;
      break;
    }

    try {
      const receipt = await so.applyCommand(lenh);
      // Bất biến 4: `fulfilled` chỉ SAU biên lai. Ghi kèm startsAt/endsAt của lệnh để thư biên
      // nhận in được hiệu lực — biên lai của sổ (CommandReceipt) không mang hai mốc đó.
      await datDaCap(sql, don.id, {
        ...receipt,
        ...(lenh.kind === 'grantPeriod' ? { startsAt: lenh.startsAt, endsAt: lenh.endsAt } : {}),
      });
      await writeAudit(sql, {
        actor: ACTOR_HE_THONG,
        action: 'order.fulfilled',
        target: don.id,
        detail: {
          order_code: don.order_code,
          tenant_id: don.tenant_id,
          kind: don.kind,
          revision: receipt.revision,
        },
      });
      return { status: 'fulfilled', receipt, daCoTuTruoc: false };
    } catch (error) {
      loiCuoi = maLoi(error);
      // Ba mã này đều nói "sổ đã đổi từ lúc đọc": đọc lại rồi thử lại, và vòng sau daCapChoDon
      // sẽ thấy nếu chính ta là người đã ghi.
      if (
        loiCuoi === 'revision_conflict' ||
        loiCuoi === 'operation_conflict' ||
        loiCuoi === 'business_identity_conflict'
      ) {
        continue;
      }
      break;
    }
  }

  await datCapHong(sql, don.id, loiCuoi);
  await writeAudit(sql, {
    actor: ACTOR_HE_THONG,
    action: 'order.fulfil_failed',
    target: don.id,
    detail: { order_code: don.order_code, tenant_id: don.tenant_id, error: loiCuoi, attempts: don.fulfil_attempts + 1 },
  });
  console.error(`[commerce] cấp gói đơn ${don.order_code} lỗi: ${loiCuoi}`);
  return { status: 'paid_unfulfilled', error: loiCuoi };
}

export type KetQuaApDung =
  | { trangThai: 'fulfilled' | 'paid_unfulfilled'; don: DonHang; cap: KetQuaCap }
  | { trangThai: 'underpaid'; don: DonHang; thieu: number }
  | { trangThai: 'khong_doi'; don: DonHang };

/**
 * Từ các sự kiện tiền vào tới trạng thái đơn. Idempotent và không cần transaction: mỗi bước là
 * một UPDATE có điều kiện trạng thái cũ, chạy lại bao nhiêu lần cũng ra cùng kết quả. Webhook,
 * cron đối soát và admin xác nhận tay đều gọi đúng hàm này (bất biến 8).
 */
export async function apDungThanhToan(
  sql: Sql,
  env: Env,
  orderId: string,
  deps: FulfilDeps = {},
): Promise<KetQuaApDung> {
  const don = await docDon(sql, orderId);
  if (!don) throw new Error('order_not_found');
  if (don.status === 'fulfilled' || don.status === 'refunded') return { trangThai: 'khong_doi', don };

  const { tong, luc } = await tongTienDaNhan(sql, don.id);
  if (tong <= 0) return { trangThai: 'khong_doi', don };

  if (tong < don.amount_vnd) {
    const doi = await datThieuTien(sql, don.id, tong);
    if (doi && don.status !== 'underpaid') {
      await writeAudit(sql, {
        actor: ACTOR_HE_THONG,
        action: 'order.underpaid',
        target: don.id,
        detail: { order_code: don.order_code, tenant_id: don.tenant_id, da_nhan: tong, gia: don.amount_vnd },
      });
    }
    return {
      trangThai: 'underpaid',
      don: { ...don, status: 'underpaid', paid_amount_vnd: tong },
      thieu: don.amount_vnd - tong,
    };
  }

  if (don.status !== 'paid' && don.status !== 'paid_unfulfilled') {
    const doi = await datDaTra(sql, don.id, tong, luc ?? (deps.now ?? (() => new Date()))());
    if (doi) {
      await writeAudit(sql, {
        actor: ACTOR_HE_THONG,
        action: 'order.paid',
        target: don.id,
        detail: { order_code: don.order_code, tenant_id: don.tenant_id, da_nhan: tong },
      });
    }
  }

  const cap = await fulfilOrder(sql, env, don.id, deps);
  const donSau = (await docDon(sql, don.id)) ?? don;
  return {
    trangThai: cap.status === 'fulfilled' ? 'fulfilled' : 'paid_unfulfilled',
    don: donSau,
    cap,
  };
}
```

- [ ] **Step 4: Chạy test, thấy xanh; typecheck**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-fulfil.test.ts && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS 15 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/commerce/fulfil.ts apps/api/test/commerce-fulfil.test.ts
git commit -m "feat(api): apDungThanhToan + fulfilOrder — tổng sự kiện quyết định paid/underpaid, fulfilled chỉ sau biên lai sổ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Thư giao dịch — bốn mẫu và một cổng gửi có ngân sách

**Files:**
- Create: `apps/api/src/email/mau-don-hang.ts`, `apps/api/src/commerce/thu.ts`
- Modify: `apps/api/src/email/mau.ts` (export `KHUNG_HTML`), `apps/api/src/email/ngan-sach.ts`
- Test: `apps/api/test/email-mau-don-hang.test.ts`, `apps/api/test/commerce-thu.test.ts`

- [ ] **Step 1: Định dạng tiền dùng chung trong `@mapslibvn/catalog`**

Website pha 1 đã có `dinhDangVnd` trong `apps/site/src/lib/gia.ts` ("1.950.000đ"). Thư, console
và admin phải in **cùng một kiểu**, nên đưa bản không phụ thuộc `Intl` vào catalog (Workers, Node và
trình duyệt ra cùng chuỗi). `apps/site` giữ bản của nó — không đụng pha 1.

`packages/catalog/src/tien.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dinhDangSo, dinhDangUsd, dinhDangVnd, TEN_GOI } from './tien';

describe('định dạng tiền', () => {
  it('chấm ngăn hàng nghìn, hậu tố đ liền', () => {
    expect(dinhDangVnd(1_950_000)).toBe('1.950.000đ');
    expect(dinhDangVnd(26_000)).toBe('26.000đ');
    expect(dinhDangVnd(0)).toBe('0đ');
    expect(dinhDangSo(2_000)).toBe('2.000');
  });
  it('USD tham chiếu: tròn thì không lẻ, lẻ thì hai chữ số với dấu phẩy', () => {
    expect(dinhDangUsd(7_500)).toBe('$75');
    expect(dinhDangUsd(2_550)).toBe('$25,50');
  });
  it('tên gói đủ bốn bậc', () => {
    expect(TEN_GOI.trial).toBe('Dùng thử');
    expect(TEN_GOI.business).toBe('Business');
  });
});
```

`packages/catalog/src/tien.ts`:

```ts
import type { Tier } from './plans';

/** Không dùng Intl: Workers, Node và trình duyệt phải in ra CÙNG một chuỗi cho một số tiền. */
export const dinhDangSo = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Cùng kiểu với website (apps/site/src/lib/gia.ts): "1.950.000đ". */
export const dinhDangVnd = (n: number): string => `${dinhDangSo(n)}đ`;

/** USD chỉ là con số tham chiếu hiện mờ cạnh giá VND. */
export function dinhDangUsd(cents: number): string {
  const usd = cents / 100;
  return Number.isInteger(usd) ? `$${dinhDangSo(usd)}` : `$${usd.toFixed(2).replace('.', ',')}`;
}

export const TEN_GOI: Record<Tier, string> = {
  trial: 'Dùng thử',
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};
```

Thêm vào `packages/catalog/src/index.ts`:
`export { dinhDangSo, dinhDangUsd, dinhDangVnd, TEN_GOI } from './tien';`

Run: `pnpm exec vitest run packages/catalog/src/tien.test.ts` → PASS 3.

- [ ] **Step 2: Viết test đỏ cho mẫu thư**

`apps/api/test/email-mau-don-hang.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  mauBaoAdminThieuTien,
  mauBienNhan,
  mauNhacHan,
  mauThieuTien,
  moTaDon,
} from '../src/email/mau-don-hang';

describe('moTaDon', () => {
  it('gói: tên bậc + số tháng; lượt: số lượt + nhóm', () => {
    expect(moTaDon({ kind: 'plan', tier: 'starter', months: 3, quota_group: null, packs: null })).toBe(
      'Starter 3 tháng',
    );
    expect(moTaDon({ kind: 'addon', tier: null, months: null, quota_group: 'places', packs: 5 })).toBe(
      '5.000 lượt Places',
    );
    expect(
      moTaDon({ kind: 'addon', tier: null, months: null, quota_group: 'directions', packs: 1 }),
    ).toBe('1.000 lượt tính tuyến');
  });
});

describe('mauBienNhan', () => {
  const thu = mauBienNhan({
    orderCode: 100001,
    moTa: 'Starter 3 tháng',
    amountVnd: 1_950_000,
    tenTenant: 'Công ty Thử',
    hieuLucTu: '2026-09-19T03:00:00.000Z',
    hetHan: '2026-12-19T03:00:00.000Z',
    consoleUrl: 'https://api.test/console/don-hang/x',
  });

  it('có cả text lẫn html, mã đơn và số tiền ở cả hai', () => {
    for (const ban of [thu.text, thu.html]) {
      expect(ban).toContain('100001');
      expect(ban).toContain('1.950.000đ');
      expect(ban).toContain('Starter 3 tháng');
      expect(ban).toContain('19/09/2026');
      expect(ban).toContain('19/12/2026');
    }
    expect(thu.subject).toBe('Biên nhận đơn 100001 — MapsLibVN');
  });

  it('không nói "hoá đơn VAT" — đây là biên nhận, hoá đơn điện tử ngoài phạm vi', () => {
    expect(thu.text.toLowerCase()).not.toContain('hoá đơn');
  });
});

describe('mauThieuTien và mauBaoAdminThieuTien', () => {
  it('khách: số đã nhận, số còn thiếu, nội dung chuyển khoản, email hỗ trợ', () => {
    const thu = mauThieuTien({
      orderCode: 100001,
      amountVnd: 1_950_000,
      daNhan: 1_900_000,
      noiDungChuyenKhoan: 'MLV100001',
      supportEmail: 'ho-tro@vidu.vn',
    });
    expect(thu.text).toContain('1.900.000đ');
    expect(thu.text).toContain('50.000đ');
    expect(thu.text).toContain('MLV100001');
    expect(thu.text).toContain('ho-tro@vidu.vn');
    expect(thu.subject).toContain('100001');
  });

  it('admin: tên tổ chức và link mở màn đơn', () => {
    const thu = mauBaoAdminThieuTien({
      orderCode: 100001,
      tenTenant: 'Công ty Thử',
      amountVnd: 1_950_000,
      daNhan: 1_900_000,
      adminUrl: 'https://api.test/admin/orders?id=x',
    });
    expect(thu.text).toContain('Công ty Thử');
    expect(thu.text).toContain('https://api.test/admin/orders?id=x');
  });
});

describe('mauNhacHan', () => {
  const goc = { tenTenant: 'Công ty Thử', tenGoi: 'Starter', hetHan: '2026-12-19T03:00:00.000Z' };
  it('ba loại, ba tiêu đề khác nhau; có nút console khi có URL', () => {
    const bay = mauNhacHan({ ...goc, loai: '7d', consoleUrl: 'https://api.test/console/mua' });
    const mot = mauNhacHan({ ...goc, loai: '1d', consoleUrl: null });
    const het = mauNhacHan({ ...goc, loai: 'het', consoleUrl: null });
    expect(bay.subject).toContain('7 ngày');
    expect(mot.subject).toContain('ngày mai');
    expect(het.subject).toContain('đã hết hạn');
    expect(bay.html).toContain('https://api.test/console/mua');
    expect(mot.html).not.toContain('href="null');
    for (const t of [bay, mot, het]) expect(t.text).toContain('19/12/2026');
  });
});
```

- [ ] **Step 3: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/email-mau-don-hang.test.ts`

- [ ] **Step 4: Export khung HTML từ `mau.ts` và viết `mau-don-hang.ts`**

Trong `apps/api/src/email/mau.ts` đổi `const KHUNG_HTML =` thành `export const KHUNG_HTML =`.

`apps/api/src/email/mau-don-hang.ts`:

```ts
import { PLAN_CATALOG, type QuotaGroup } from '@mapslibvn/catalog';
import { KHUNG_HTML, type MauThu } from './mau';

/** Không dựa vào Intl của runtime: `1.950.000đ` là quy ước cố định của ta. */
export const dinhDangVnd = (n: number): string =>
  `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;

const TEN_GOI: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};
const TEN_NHOM: Record<QuotaGroup, string> = { places: 'Places', directions: 'tính tuyến' };

export const ngayVn = (iso: string): string => {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

export function moTaDon(don: {
  kind: 'plan' | 'addon';
  tier: string | null;
  months: number | null;
  quota_group: QuotaGroup | null;
  packs: number | null;
}): string {
  if (don.kind === 'plan') return `${TEN_GOI[don.tier ?? ''] ?? don.tier} ${don.months} tháng`;
  const nhom = don.quota_group ?? 'places';
  const luot = (don.packs ?? 0) * PLAN_CATALOG.addOns[nhom].units;
  return `${dinhDangVnd(luot).replace('đ', '')} lượt ${TEN_NHOM[nhom]}`;
}

const chanThu = 'MapsLibVN';

export function mauBienNhan(d: {
  orderCode: number;
  moTa: string;
  amountVnd: number;
  tenTenant: string;
  hieuLucTu: string | null;
  hetHan: string | null;
  consoleUrl: string | null;
}): MauThu {
  const hieuLuc =
    d.hieuLucTu && d.hetHan ? `Hiệu lực từ ${ngayVn(d.hieuLucTu)} đến ${ngayVn(d.hetHan)}.` : '';
  const text = [
    `Chào ${d.tenTenant},`,
    '',
    `MapsLibVN đã nhận ${dinhDangVnd(d.amountVnd)} cho đơn ${d.orderCode}: ${d.moTa}.`,
    hieuLuc,
    'Gói đã được cấp vào tài khoản của bạn.',
    '',
    d.consoleUrl ? `Xem đơn: ${d.consoleUrl}` : '',
    '',
    'Đây là biên nhận thanh toán, không phải chứng từ thuế.',
    chanThu,
  ]
    .filter((dong, i, arr) => !(dong === '' && arr[i - 1] === ''))
    .join('\n');

  const html = KHUNG_HTML(
    `<p style="margin:0 0 12px">Chào <strong>${d.tenTenant}</strong>,</p>
<p style="margin:0 0 12px">MapsLibVN đã nhận <strong>${dinhDangVnd(d.amountVnd)}</strong> cho đơn <strong>${d.orderCode}</strong>: ${d.moTa}.</p>
${hieuLuc ? `<p style="margin:0 0 12px;color:#667085">${hieuLuc}</p>` : ''}
<p style="margin:0 0 20px">Gói đã được cấp vào tài khoản của bạn.</p>
${d.consoleUrl ? `<p style="margin:0 0 20px"><a href="${d.consoleUrl}" style="display:inline-block;background:#1b3a6b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:600">Xem đơn</a></p>` : ''}
<p style="margin:0;color:#667085">Đây là biên nhận thanh toán, không phải chứng từ thuế.</p>`,
  );
  return { subject: `Biên nhận đơn ${d.orderCode} — MapsLibVN`, html, text };
}

export function mauThieuTien(d: {
  orderCode: number;
  amountVnd: number;
  daNhan: number;
  noiDungChuyenKhoan: string;
  supportEmail: string;
}): MauThu {
  const thieu = d.amountVnd - d.daNhan;
  const text = [
    `Đơn ${d.orderCode} của bạn cần ${dinhDangVnd(d.amountVnd)}, MapsLibVN mới nhận ${dinhDangVnd(d.daNhan)}.`,
    `Còn thiếu ${dinhDangVnd(thieu)}.`,
    '',
    `Bạn có thể chuyển thêm đúng số còn thiếu với nội dung ${d.noiDungChuyenKhoan}, hoặc trả lời thư này`,
    `tới ${d.supportEmail} để được xử lý tay.`,
    '',
    'Gói chưa được cấp cho tới khi nhận đủ tiền.',
    chanThu,
  ].join('\n');
  const html = KHUNG_HTML(
    `<p style="margin:0 0 12px">Đơn <strong>${d.orderCode}</strong> cần <strong>${dinhDangVnd(d.amountVnd)}</strong>, MapsLibVN mới nhận <strong>${dinhDangVnd(d.daNhan)}</strong>. Còn thiếu <strong>${dinhDangVnd(thieu)}</strong>.</p>
<p style="margin:0 0 12px;color:#667085">Bạn có thể chuyển thêm đúng số còn thiếu với nội dung <strong>${d.noiDungChuyenKhoan}</strong>, hoặc trả lời thư này tới <a href="mailto:${d.supportEmail}" style="color:#1b3a6b">${d.supportEmail}</a> để được xử lý tay.</p>
<p style="margin:0;color:#667085">Gói chưa được cấp cho tới khi nhận đủ tiền.</p>`,
  );
  return { subject: `Đơn ${d.orderCode} còn thiếu tiền — MapsLibVN`, html, text };
}

export function mauBaoAdminThieuTien(d: {
  orderCode: number;
  tenTenant: string;
  amountVnd: number;
  daNhan: number;
  adminUrl: string;
}): MauThu {
  const text = [
    `Đơn ${d.orderCode} của ${d.tenTenant} chuyển thiếu: cần ${dinhDangVnd(d.amountVnd)}, đã nhận ${dinhDangVnd(d.daNhan)}.`,
    `Xử lý: ${d.adminUrl}`,
    chanThu,
  ].join('\n');
  const html = KHUNG_HTML(
    `<p style="margin:0 0 12px">Đơn <strong>${d.orderCode}</strong> của <strong>${d.tenTenant}</strong> chuyển thiếu: cần ${dinhDangVnd(d.amountVnd)}, đã nhận ${dinhDangVnd(d.daNhan)}.</p>
<p style="margin:0"><a href="${d.adminUrl}" style="color:#1b3a6b">Mở màn đơn hàng</a></p>`,
  );
  return { subject: `[Admin] Đơn ${d.orderCode} chuyển thiếu`, html, text };
}

export type LoaiNhac = '7d' | '1d' | 'het';

export function mauNhacHan(d: {
  tenTenant: string;
  tenGoi: string;
  hetHan: string;
  loai: LoaiNhac;
  consoleUrl: string | null;
}): MauThu {
  const ngay = ngayVn(d.hetHan);
  const tieuDe =
    d.loai === '7d'
      ? `Gói ${d.tenGoi} còn 7 ngày — MapsLibVN`
      : d.loai === '1d'
        ? `Gói ${d.tenGoi} hết hạn ngày mai — MapsLibVN`
        : `Gói ${d.tenGoi} đã hết hạn — MapsLibVN`;
  const cau =
    d.loai === 'het'
      ? `Gói ${d.tenGoi} của ${d.tenTenant} đã hết hạn ngày ${ngay}. Khoá API vẫn còn nhưng mọi lượt gọi bị từ chối cho tới khi gia hạn.`
      : `Gói ${d.tenGoi} của ${d.tenTenant} sẽ hết hạn ngày ${ngay}. Gia hạn trước ngày đó thì kỳ mới nối tiếp, không mất ngày nào.`;
  const text = [cau, '', d.consoleUrl ? `Gia hạn: ${d.consoleUrl}` : '', chanThu]
    .filter((dong, i, arr) => !(dong === '' && arr[i - 1] === ''))
    .join('\n');
  const html = KHUNG_HTML(
    `<p style="margin:0 0 20px">${cau}</p>
${d.consoleUrl ? `<p style="margin:0"><a href="${d.consoleUrl}" style="display:inline-block;background:#1b3a6b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:600">Gia hạn</a></p>` : ''}`,
  );
  return { subject: tieuDe, html, text };
}
```

- [ ] **Step 5: Chạy test, thấy xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/email-mau-don-hang.test.ts test/email-mau.test.ts`
Expected: PASS (mẫu cũ không hồi quy).

- [ ] **Step 6: Tách đếm thư theo `sql` sẵn có và viết test đỏ cho `thu.ts`**

Trong `apps/api/src/email/ngan-sach.ts` thêm hàm dùng client sẵn có, và cho `daGuiHomNay` gọi nó:

```ts
type Sql = ReturnType<typeof getSql>;

/** Đếm bằng client đang mở — cho cron và webhook, nơi đã có `sql` trong tay. */
export async function daGuiHomNayVoiSql(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM admin_audit
    WHERE action = 'email.sent'
      AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`;
  return rows[0]?.n ?? 0;
}
```

và thân `daGuiHomNay` thành `return await daGuiHomNayVoiSql(sql);` trong `try`.

`apps/api/test/commerce-thu.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { guiThuGiaoDich } from '../src/commerce/thu';
import { fakeSql } from './helpers/fake-sql';

const mau = { subject: 'Thử', html: '<p>x</p>', text: 'x' };
const env = { ENVIRONMENT: 'test', SUPPORT_EMAIL: 'ho-tro@vidu.vn' } as never;

describe('guiThuGiaoDich', () => {
  it('gửi từng người nhận, mỗi thư một dòng email.sent', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'r1' });
    const { sql, calls } = fakeSql([{ n: 0 }]);
    const ok = await guiThuGiaoDich(env, sql, { to: ['a@vidu.vn', 'b@vidu.vn'], mau, loai: 'bien-nhan' }, {
      port: { ten: 'debug', send },
    });
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    const audit = calls.filter((c) => c.text.includes('INSERT INTO admin_audit'));
    expect(audit).toHaveLength(2);
    expect(audit[0]?.params).toEqual(expect.arrayContaining(['system:email', 'email.sent', 'bien-nhan']));
  });

  it('hết ngân sách ngày → không gửi, trả false, không ném', async () => {
    const send = vi.fn();
    const { sql } = fakeSql([{ n: 100 }]);
    expect(
      await guiThuGiaoDich(env, sql, { to: ['a@vidu.vn'], mau, loai: 'bien-nhan' }, { port: { ten: 'debug', send } }),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('thư hàng loạt dừng khi còn dưới 20 thư', async () => {
    const send = vi.fn();
    const { sql } = fakeSql([{ n: 85 }]);
    expect(
      await guiThuGiaoDich(env, sql, { to: ['a@vidu.vn'], mau, loai: 'nhac-han', hangLoat: true }, { port: { ten: 'debug', send } }),
    ).toBe(false);
  });

  it('Resend lỗi → false, log lý do, không ném', async () => {
    const send = vi.fn().mockRejectedValue(new Error('email_send_failed_401'));
    const { sql } = fakeSql([{ n: 0 }]);
    expect(
      await guiThuGiaoDich(env, sql, { to: ['a@vidu.vn'], mau, loai: 'bien-nhan' }, { port: { ten: 'debug', send } }),
    ).toBe(false);
  });
});
```

- [ ] **Step 7: Viết `commerce/thu.ts`**

```ts
import { writeAudit } from '../audit';
import type { getSql } from '../db';
import type { MauThu } from '../email/mau';
import { conCho, conChoHangLoat, daGuiHomNayVoiSql } from '../email/ngan-sach';
import { chonEmailPort, type EmailPort } from '../email/port';
import type { Env } from '../env';
import { moTaLoi } from '../errors';

type Sql = ReturnType<typeof getSql>;

export interface ThuGiaoDich {
  to: string[];
  mau: MauThu;
  /** Ghi vào `target` của dòng `email.sent`: bien-nhan | thieu-tien | thieu-tien-admin | nhac-han. */
  loai: string;
  /** Thư nhắc hạn: dừng khi ngân sách còn dưới 20 để chừa cho mã đăng nhập (spec 9.4). */
  hangLoat?: boolean;
}

export interface GuiThuDeps {
  port?: EmailPort;
}

/**
 * Gửi một thư giao dịch trong ngân sách 100 thư/ngày của Resend. Không bao giờ ném: thư là việc
 * phụ của một giao dịch tiền đã xong, và một lỗi ở đây không được biến `fulfilled` thành 503.
 * Trả `true` khi MỌI người nhận đều đã gửi.
 */
export async function guiThuGiaoDich(
  env: Env,
  sql: Sql,
  thu: ThuGiaoDich,
  deps: GuiThuDeps = {},
): Promise<boolean> {
  try {
    const daGui = await daGuiHomNayVoiSql(sql);
    const con = thu.hangLoat ? conChoHangLoat(daGui + thu.to.length - 1) : conCho(daGui + thu.to.length - 1);
    if (!con) {
      console.warn(`[email] bỏ qua ${thu.loai}: ngân sách ngày còn ${100 - daGui}`);
      return false;
    }
    const port = deps.port ?? chonEmailPort(env);
    for (const to of thu.to) {
      await port.send({ to, subject: thu.mau.subject, html: thu.mau.html, text: thu.mau.text });
      await writeAudit(sql, { actor: 'system:email', action: 'email.sent', target: thu.loai });
    }
    return true;
  } catch (error) {
    // In cả message: Observability chỉ giữ stack khi nhận Error (sự cố Resend 401, 19/09).
    console.error(`[email] gửi ${thu.loai} lỗi: ${moTaLoi(error)}`, error);
    return false;
  }
}
```

- [ ] **Step 8: Chạy test, thấy xanh; typecheck**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-thu.test.ts test/console-auth.test.ts && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS; `console-auth.test.ts` không hồi quy sau khi tách `daGuiHomNayVoiSql`.

- [ ] **Step 9: Commit**

```bash
git add packages/catalog apps/api/src/email apps/api/src/commerce/thu.ts apps/api/test/email-mau-don-hang.test.ts apps/api/test/commerce-thu.test.ts
git commit -m "feat(api): bốn mẫu thư đơn hàng và cổng gửi có ngân sách, ghi email.sent cho từng người nhận

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Webhook `POST /v1/pay/payos/webhook`

**Files:**
- Create: `apps/api/src/routes/pay-webhook.ts`, `apps/api/src/commerce/thong-bao.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/pay-webhook.test.ts`

- [ ] **Step 1: Viết test đỏ**

```ts
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { CommandReceipt, EntitlementCommand } from '../src/billing/types';
import { kyDuLieu } from '../src/commerce/chu-ky';
import type { DonHang } from '../src/commerce/db';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { payWebhookWith } from '../src/routes/pay-webhook';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const KHOA = 'kiem-thu-checksum-key';
const ORDER = '00000000-0000-4000-8000-0000000000d1';
const TENANT = '00000000-0000-4000-8000-0000000000c1';
const NOW = new Date('2026-09-19T03:00:00Z');

const moiTruong = (them: Record<string, unknown> = {}) =>
  ({ ...env, ENVIRONMENT: 'test', PAYOS_CHECKSUM_KEY: KHOA, SUPPORT_EMAIL: 'ho-tro@vidu.vn', ...them }) as unknown as Env;

const don = (them: Partial<DonHang> = {}): DonHang => ({
  id: ORDER, order_code: 100001, tenant_id: TENANT, account_id: 'a', kind: 'plan', tier: 'starter',
  months: 3, quota_group: null, packs: null, amount_vnd: 1_950_000, amount_usd_cents: 7_500,
  status: 'pending', provider: 'payos', payment_link_id: 'l', checkout_url: 'u', qr_code: null,
  link_expires_at: null, paid_at: null, paid_amount_vnd: null, fulfilled_at: null,
  fulfil_attempts: 0, fulfil_error: null, entitlement_receipt: null, note: null,
  created_at: NOW, updated_at: NOW, ...them,
});

/** DB giả cho webhook: đơn theo order_code, sự kiện cộng dồn, các UPDATE đổi trạng thái. */
function kho(banDau: DonHang | null, tuyChon: { trungReference?: boolean } = {}) {
  let hienTai = banDau ? { ...banDau } : null;
  const suKien: { amount: number | null; reference: string; valid: boolean }[] = [];
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('FROM customer_order WHERE order_code')) return hienTai ? [hienTai] : [];
    if (q.text.includes('FROM customer_order WHERE id')) return hienTai ? [hienTai] : [];
    if (q.text.includes('INSERT INTO payment_event')) {
      if (tuyChon.trungReference) return [];
      suKien.push({ amount: q.params[4] as number | null, reference: q.params[2] as string, valid: q.params[5] as boolean });
      return [{ id: suKien.length }];
    }
    if (q.text.includes('coalesce(sum(amount_vnd)')) {
      const hopLe = suKien.filter((s) => s.valid && s.amount !== null);
      return [{ tong: hopLe.reduce((t, s) => t + (s.amount ?? 0), 0), tham_chieu: hopLe[0]?.reference ?? null, luc: NOW }];
    }
    if (q.text.includes("status = 'paid'") && q.text.includes('UPDATE') && hienTai) {
      hienTai = { ...hienTai, status: 'paid', paid_amount_vnd: q.params[0] as number };
      return [{ id: ORDER }];
    }
    if (q.text.includes("status = 'underpaid'") && hienTai) {
      hienTai = { ...hienTai, status: 'underpaid' };
      return [{ id: ORDER }];
    }
    if (q.text.includes("status = 'fulfilled'") && hienTai) {
      hienTai = { ...hienTai, status: 'fulfilled' };
      return [{ id: ORDER }];
    }
    if (q.text.includes('FROM tenant t')) return [{ email: 'khach@vidu.vn', billing_email: null, name: 'Công ty Thử' }];
    if (q.text.includes("action = 'email.sent'")) return [{ n: 0 }];
    return [];
  });
  return { sql, calls, suKien, doc: () => hienTai };
}

function soGia() {
  const lenh: EntitlementCommand[] = [];
  return {
    lenh,
    so: {
      readUsage: vi.fn(async () => ({
        tenantId: TENANT, status: 'active', tier: 'trial', revision: 1, periodId: 't', startsAt: null, endsAt: null,
        trialUsedOnce: true, maintenance: false, missingAcks: { count: 0, limit: 3, locked: false, opensAt: null },
        places: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
        directions: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
      })),
      readPeriods: vi.fn(async () => ({ periods: [], credits: [] })),
      applyCommand: vi.fn(async (c: EntitlementCommand): Promise<CommandReceipt> => {
        lenh.push(c);
        return { operationId: c.operationId, revision: 2, status: 'active', tier: 'starter', appliedAt: NOW.toISOString() };
      }),
    },
  };
}

const guiThu = vi.fn().mockResolvedValue({ id: 'r' });

function app(k: ReturnType<typeof kho>, so: ReturnType<typeof soGia>['so']) {
  const a = new Hono<AppEnv>();
  a.onError((err, c) => errorResponse(c, err));
  a.route(
    '/',
    payWebhookWith({
      sql: () => k.sql,
      so: () => so,
      now: () => NOW,
      emailPort: () => ({ ten: 'debug', send: guiThu }),
    }),
  );
  return a;
}

const duLieu = (them: Record<string, unknown> = {}) => ({
  orderCode: 100001, amount: 1_950_000, description: 'MLV100001', accountNumber: '0123456789',
  reference: 'FT26262ABC123', transactionDateTime: '2026-09-19 10:15:00', currency: 'VND',
  paymentLinkId: 'l', code: '00', desc: 'Thành công', counterAccountBankId: '', counterAccountBankName: '',
  counterAccountName: null, counterAccountNumber: null, virtualAccountName: '', virtualAccountNumber: '',
  ...them,
});

async function ban(a: Hono<AppEnv>, moi: Env, data: Record<string, unknown>, chuKy?: string) {
  const body = JSON.stringify({ code: '00', desc: 'success', success: true, data, signature: chuKy ?? (await kyDuLieu(data, KHOA)) });
  return a.request('https://api/v1/pay/payos/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body }, moi);
}

describe('webhook — cổng chữ ký', () => {
  it('thiếu PAYOS_CHECKSUM_KEY → 503, không bao giờ "tạm tin"', async () => {
    const k = kho(don());
    const res = await ban(app(k, soGia().so), moiTruong({ PAYOS_CHECKSUM_KEY: undefined }), duLieu());
    expect(res.status).toBe(503);
    expect(k.suKien).toHaveLength(0);
  });

  it('thân quá 16 KiB → 413', async () => {
    const k = kho(don());
    const res = await app(k, soGia().so).request('https://api/v1/pay/payos/webhook', { method: 'POST', body: 'x'.repeat(16 * 1024 + 1) }, moiTruong());
    expect(res.status).toBe(413);
  });

  it('không phải JSON hoặc thiếu data → 400 invalid_webhook', async () => {
    const k = kho(don());
    const a = app(k, soGia().so);
    expect((await a.request('https://api/v1/pay/payos/webhook', { method: 'POST', body: '{' }, moiTruong())).status).toBe(400);
    const res = await a.request('https://api/v1/pay/payos/webhook', { method: 'POST', body: JSON.stringify({ signature: 'x' }) }, moiTruong());
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_webhook');
  });

  it('sai chữ ký → 400, ghi sự kiện signature_valid=false với reference invalid:<sha256>, đơn KHÔNG đổi', async () => {
    const k = kho(don());
    const { so } = soGia();
    const res = await ban(app(k, so), moiTruong(), duLieu(), 'f'.repeat(64));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_signature');
    expect(k.suKien).toHaveLength(1);
    expect(k.suKien[0]?.valid).toBe(false);
    expect(k.suKien[0]?.reference).toMatch(/^invalid:[a-f0-9]{64}$/);
    expect(k.doc()?.status).toBe('pending');
    expect(so.applyCommand).not.toHaveBeenCalled();
  });

  it('sai chữ ký mà bị giới hạn tần suất → vẫn 400 nhưng KHÔNG ghi DB', async () => {
    const k = kho(don());
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const res = await ban(app(k, soGia().so), moiTruong({ PAYOS_WEBHOOK_RATE_LIMITER: limiter }), duLieu(), 'f'.repeat(64));
    expect(res.status).toBe(400);
    expect(k.suKien).toHaveLength(0);
    expect(limiter.limit).toHaveBeenCalledTimes(1);
  });
});

describe('webhook — nghiệp vụ', () => {
  it('đủ tiền: 200, sự kiện có amount, đơn fulfilled, sổ nhận đúng một lệnh, biên nhận gửi cho khách', async () => {
    const k = kho(don());
    const { so, lenh } = soGia();
    guiThu.mockClear();
    const res = await ban(app(k, so), moiTruong(), duLieu());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, matched: true, duplicate: false, status: 'fulfilled' });
    expect(k.suKien[0]).toMatchObject({ amount: 1_950_000, reference: 'FT26262ABC123', valid: true });
    expect(lenh).toHaveLength(1);
    expect(k.doc()?.status).toBe('fulfilled');
    // Thư gửi trong waitUntil của Hono test → chờ một vòng.
    await new Promise((r) => setTimeout(r, 10));
    expect(guiThu).toHaveBeenCalledTimes(1);
    expect(guiThu.mock.calls[0]?.[0]).toMatchObject({ to: 'khach@vidu.vn' });
  });

  it('không khớp đơn nào (webhook thử của PayOS) → 200 matched:false, sự kiện order_id NULL', async () => {
    const k = kho(null);
    const res = await ban(app(k, soGia().so), moiTruong(), duLieu({ orderCode: 123 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, matched: false });
    const insert = k.calls.find((c) => c.text.includes('INSERT INTO payment_event'));
    expect(insert?.params[0]).toBeNull();
  });

  it('code khác 00 → 200, chỉ lưu, amount NULL, không cấp', async () => {
    const k = kho(don());
    const { so } = soGia();
    const res = await ban(app(k, so), moiTruong(), duLieu({ code: '01', desc: 'Thất bại' }));
    expect(res.status).toBe(200);
    expect(k.suKien[0]?.amount).toBeNull();
    expect(k.doc()?.status).toBe('pending');
    expect(so.applyCommand).not.toHaveBeenCalled();
  });

  it('thiếu tiền → 200 status underpaid, thư cho khách VÀ admin', async () => {
    const k = kho(don());
    guiThu.mockClear();
    const res = await ban(app(k, soGia().so), moiTruong(), duLieu({ amount: 1_900_000 }));
    expect(await res.json()).toMatchObject({ status: 'underpaid' });
    await new Promise((r) => setTimeout(r, 10));
    const nguoiNhan = guiThu.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(nguoiNhan).toEqual(['ho-tro@vidu.vn', 'khach@vidu.vn']);
  });

  it('trùng reference (PayOS gửi lại) → 200 duplicate:true, và vẫn thử áp dụng nếu đơn chưa xong', async () => {
    const k = kho(don({ status: 'paid_unfulfilled', fulfil_attempts: 1 }), { trungReference: true });
    // Sự kiện cũ đã có trong DB: giả lập bằng cách nạp trước vào kho.
    k.suKien.push({ amount: 1_950_000, reference: 'FT26262ABC123', valid: true });
    const { so, lenh } = soGia();
    const res = await ban(app(k, so), moiTruong(), duLieu());
    expect(await res.json()).toMatchObject({ duplicate: true, status: 'fulfilled' });
    expect(lenh).toHaveLength(1);
  });

  it('trùng reference và đơn đã fulfilled → 200, sổ không bị gọi', async () => {
    const k = kho(don({ status: 'fulfilled' }), { trungReference: true });
    const { so } = soGia();
    const res = await ban(app(k, so), moiTruong(), duLieu());
    expect(res.status).toBe(200);
    expect(so.applyCommand).not.toHaveBeenCalled();
  });

  it('thiếu reference → 400 (không có khoá chống trùng thì không nhận)', async () => {
    const k = kho(don());
    const res = await ban(app(k, soGia().so), moiTruong(), duLieu({ reference: '' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/pay-webhook.test.ts`

- [ ] **Step 3: Viết `commerce/thong-bao.ts` — thư sau khi áp dụng, dùng chung ba nơi**

```ts
import { voiSql } from '../console/db';
import type { getSql } from '../db';
import { mauBaoAdminThieuTien, mauBienNhan, mauThieuTien, moTaDon } from '../email/mau-don-hang';
import type { EmailPort } from '../email/port';
import type { Env } from '../env';
import { moTaLoi } from '../errors';
import { chuTenant, noiDungChuyenKhoan } from './db';
import type { KetQuaApDung } from './fulfil';
import { guiThuGiaoDich } from './thu';

type Ctx = { waitUntil(promise: Promise<unknown>): void };
type Sql = ReturnType<typeof getSql>;

export interface ThongBaoDeps {
  sql?: (env: Env) => Sql;
  emailPort?: (env: Env) => EmailPort;
}

/** Người nhận thư của một tenant: chủ sở hữu, cộng email biên nhận nếu khác. */
export const nguoiNhan = (chu: { email: string; billingEmail: string | null }): string[] =>
  chu.billingEmail && chu.billingEmail !== chu.email ? [chu.email, chu.billingEmail] : [chu.email];

/**
 * Gửi thư tương ứng với kết quả `apDungThanhToan`. Chạy trong waitUntil với client Postgres
 * RIÊNG: client của request đã được `endSql` đóng ở finally trước khi tới đây.
 *
 * - fulfilled lần đầu (không phải daCoTuTruoc) → biên nhận cho khách.
 * - underpaid và sự kiện là MỚI → thư thiếu tiền cho khách + admin. Gửi lại webhook cũ không gửi lại thư.
 * - paid_unfulfilled → không gửi gì; biên nhận sẽ đi khi cron cấp được.
 */
export function thongBaoSauApDung(
  env: Env,
  ctx: Ctx,
  kq: KetQuaApDung,
  tuyChon: { origin: string; suKienMoi: boolean },
  deps: ThongBaoDeps = {},
): void {
  const guiBienNhan = kq.trangThai === 'fulfilled' && kq.cap.status === 'fulfilled' && !kq.cap.daCoTuTruoc;
  const guiThieu = kq.trangThai === 'underpaid' && tuyChon.suKienMoi;
  if (!guiBienNhan && !guiThieu) return;

  const viec = async (sql: Sql) => {
    const chu = await chuTenant(sql, kq.don.tenant_id);
    if (!chu) return;
    const port = deps.emailPort ? deps.emailPort(env) : undefined;
    const guiDeps = port ? { port } : {};
    if (guiBienNhan) {
      const bienLai = (kq.don.entitlement_receipt ?? {}) as Record<string, unknown>;
      await guiThuGiaoDich(
        env,
        sql,
        {
          to: nguoiNhan(chu),
          mau: mauBienNhan({
            orderCode: kq.don.order_code,
            moTa: moTaDon(kq.don),
            amountVnd: kq.don.paid_amount_vnd ?? kq.don.amount_vnd,
            tenTenant: chu.tenantName,
            hieuLucTu: typeof bienLai.startsAt === 'string' ? bienLai.startsAt : null,
            hetHan: typeof bienLai.endsAt === 'string' ? bienLai.endsAt : null,
            consoleUrl: `${tuyChon.origin}/console/don-hang/${kq.don.id}`,
          }),
          loai: 'bien-nhan',
        },
        guiDeps,
      );
    }
    if (guiThieu && kq.trangThai === 'underpaid') {
      await guiThuGiaoDich(
        env,
        sql,
        {
          to: nguoiNhan(chu),
          mau: mauThieuTien({
            orderCode: kq.don.order_code,
            amountVnd: kq.don.amount_vnd,
            daNhan: kq.don.paid_amount_vnd ?? 0,
            noiDungChuyenKhoan: noiDungChuyenKhoan(kq.don.order_code),
            supportEmail: env.SUPPORT_EMAIL ?? '',
          }),
          loai: 'thieu-tien',
        },
        guiDeps,
      );
      if (env.SUPPORT_EMAIL) {
        await guiThuGiaoDich(
          env,
          sql,
          {
            to: [env.SUPPORT_EMAIL],
            mau: mauBaoAdminThieuTien({
              orderCode: kq.don.order_code,
              tenTenant: chu.tenantName,
              amountVnd: kq.don.amount_vnd,
              daNhan: kq.don.paid_amount_vnd ?? 0,
              adminUrl: `${tuyChon.origin}/admin/orders?id=${kq.don.id}`,
            }),
            loai: 'thieu-tien-admin',
          },
          guiDeps,
        );
      }
    }
  };

  const chay = deps.sql ? viec(deps.sql(env)) : voiSql(env, ctx, viec);
  ctx.waitUntil(chay.catch((error: unknown) => console.error(`[commerce] thư sau áp dụng lỗi: ${moTaLoi(error)}`, error)));
}
```

- [ ] **Step 4: Viết `routes/pay-webhook.ts`**

```ts
import { Hono } from 'hono';
import { khopChuKy } from '../commerce/chu-ky';
import { docDonTheoOrderCode, ghiSuKienThanhToan } from '../commerce/db';
import { apDungThanhToan, type FulfilDeps } from '../commerce/fulfil';
import { type ThongBaoDeps, thongBaoSauApDung } from '../commerce/thong-bao';
import { endSql, getSql } from '../db';
import { sha256Hex } from '../edits/hash';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const MAX_BODY = 16 * 1024;

export interface PayWebhookDeps extends FulfilDeps, ThongBaoDeps {
  sql?: (env: Env) => ReturnType<typeof getSql>;
}

interface TruongWebhook {
  orderCode: number | null;
  amount: number | null;
  reference: string | null;
  code: string;
}

/** Đọc bốn trường cần dùng, mỗi trường kiểm kiểu — payload là dữ liệu bên ngoài dù chữ ký đúng. */
function docTruong(data: Record<string, unknown>): TruongWebhook {
  const orderCode =
    typeof data.orderCode === 'number' && Number.isSafeInteger(data.orderCode) && data.orderCode > 0
      ? data.orderCode
      : null;
  const amount =
    typeof data.amount === 'number' && Number.isSafeInteger(data.amount) && data.amount >= 0
      ? data.amount
      : null;
  const reference =
    typeof data.reference === 'string' && data.reference.trim().length > 0
      ? data.reference.trim().slice(0, 128)
      : null;
  return { orderCode, amount, reference, code: String(data.code ?? '') };
}

/**
 * Webhook PayOS (spec 9.2). Không Access, không CSRF, không cookie: server-to-server, và chữ ký
 * HMAC là cổng duy nhất — nên nó được kiểm trước khi đọc bất kỳ trường nào, và không có nhánh nào
 * chạy tiếp khi sai. Mọi đường hợp lệ đều trả 200 kể cả khi cấp gói hỏng: tiền đã nhận là sự thật,
 * cấp gói là việc của ta (cron thử lại). Chỉ lỗi Postgres mới thành 503 để PayOS gửi lại.
 */
export function payWebhookWith(deps: PayWebhookDeps = {}) {
  const routes = new Hono<AppEnv>();

  routes.post('/v1/pay/payos/webhook', async (c) => {
    const key = c.env.PAYOS_CHECKSUM_KEY;
    if (!key) {
      throw new ApiError(503, 'payment_provider_not_configured', 'Chưa cấu hình PayOS');
    }
    const text = await c.req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY) {
      throw new ApiError(413, 'payload_too_large', 'Webhook quá lớn');
    }
    let than: { data?: unknown; signature?: unknown };
    try {
      than = JSON.parse(text) as { data?: unknown; signature?: unknown };
    } catch {
      throw new ApiError(400, 'invalid_webhook', 'Webhook không phải JSON');
    }
    const data = than?.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new ApiError(400, 'invalid_webhook', 'Webhook thiếu data');
    }
    const duLieu = data as Record<string, unknown>;
    const hopLe = await khopChuKy(duLieu, typeof than.signature === 'string' ? than.signature : '', key);

    const sql = (deps.sql ?? getSql)(c.env);
    try {
      if (!hopLe) {
        await ghiSaiChuKy(c.env, c.req.raw, sql, text, duLieu);
        throw new ApiError(400, 'invalid_signature', 'Chữ ký webhook không hợp lệ');
      }

      const truong = docTruong(duLieu);
      if (!truong.reference) throw new ApiError(400, 'invalid_webhook', 'Webhook thiếu reference');

      const don = truong.orderCode === null ? null : await docDonTheoOrderCode(sql, truong.orderCode);
      const tienVao = truong.code === '00' && truong.amount !== null && truong.amount > 0;
      const moi = await ghiSuKienThanhToan(sql, {
        orderId: don?.id ?? null,
        provider: 'payos',
        reference: truong.reference,
        orderCode: truong.orderCode,
        amountVnd: tienVao ? truong.amount : null,
        signatureValid: true,
        payload: duLieu,
      });

      if (!don) return c.json({ received: true, matched: false, duplicate: !moi }, 200, NO_STORE);
      if (!tienVao) {
        return c.json({ received: true, matched: true, applied: false, duplicate: !moi }, 200, NO_STORE);
      }

      // Trùng reference vẫn áp dụng lại: lần nhận trước có thể đã ghi được sự kiện rồi đổ ở bước
      // cấp gói. apDungThanhToan idempotent nên gọi thừa không hại (quyết định 0.3.6).
      const kq = await apDungThanhToan(sql, c.env, don.id, deps);
      thongBaoSauApDung(
        c.env,
        c.executionCtx,
        kq,
        { origin: new URL(c.req.url).origin, suKienMoi: moi },
        deps,
      );
      return c.json(
        { received: true, matched: true, duplicate: !moi, status: kq.don.status },
        200,
        NO_STORE,
      );
    } finally {
      endSql(c.executionCtx, sql);
    }
  });

  return routes;
}

/**
 * Ghi lại webhook sai chữ ký để admin thấy có ai đang gõ cửa — nhưng có trần: tối đa 20 dòng/phút
 * mỗi IP, và `reference = invalid:<sha256 thân>` nên cùng một thân chỉ chiếm một dòng. Payload KHÔNG
 * lưu nguyên văn (không đáng tin), chỉ vài trường đủ để nhận dạng.
 */
async function ghiSaiChuKy(
  env: Env,
  req: Request,
  sql: ReturnType<typeof getSql>,
  text: string,
  data: Record<string, unknown>,
): Promise<void> {
  console.warn('[pay] webhook sai chữ ký');
  const limiter = env.PAYOS_WEBHOOK_RATE_LIMITER;
  if (limiter) {
    const ip = req.headers.get('CF-Connecting-IP') ?? 'khong-ro';
    const { success } = await limiter.limit({ key: await sha256Hex(ip) });
    if (!success) return;
  }
  await ghiSuKienThanhToan(sql, {
    orderId: null,
    provider: 'payos',
    reference: `invalid:${await sha256Hex(text)}`,
    orderCode: typeof data.orderCode === 'number' ? data.orderCode : null,
    amountVnd: null,
    signatureValid: false,
    payload: {
      code: data.code ?? null,
      orderCode: data.orderCode ?? null,
      amount: data.amount ?? null,
      kich_thuoc: text.length,
    },
  });
}

export const payWebhook = payWebhookWith();
```

- [ ] **Step 5: Mount vào `index.ts`**

Sau dòng `app.route('/', consoleRoutes);` thêm:

```ts
// Webhook PayOS: ngoài mọi cổng Access/CSRF/cookie — server-to-server, chữ ký HMAC là cổng duy nhất.
app.route('/', payWebhook);
```

kèm `import { payWebhook } from './routes/pay-webhook';`.

- [ ] **Step 6: Chạy test, thấy xanh; typecheck**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/pay-webhook.test.ts test/commerce-fulfil.test.ts && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS 12 + 15.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/pay-webhook.ts apps/api/src/commerce/thong-bao.ts apps/api/src/index.ts apps/api/test/pay-webhook.test.ts
git commit -m "feat(api): webhook PayOS — chữ ký trước mọi thứ, sự kiện là khoá chống trùng, luôn 200 khi tiền hợp lệ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Route đơn hàng của khách — `/v1/console/orders*`

**Files:**
- Create: `apps/api/src/routes/console-orders.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/console-orders.test.ts`

- [ ] **Step 1: Viết test đỏ**

```ts
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { DonHang } from '../src/commerce/db';
import type { LinkThanhToan, PayosPort } from '../src/commerce/payos';
import { PayosError } from '../src/commerce/payos';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { consoleOrdersWith } from '../src/routes/console-orders';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const ORDER = '00000000-0000-4000-8000-0000000000d1';
const NOW = new Date('2026-09-19T03:00:00Z');
const moiTruong = (them: Record<string, unknown> = {}) =>
  ({ ...env, ENVIRONMENT: 'test', SELF_SERVE: '1', SESSION_PEPPER: 'p', ...them }) as unknown as Env;

const khach = { accountId: 'acc-1', email: 'khach@vidu.vn', name: null, tenantId: TENANT, tenantName: 'Công ty Thử', tokenHash: 'h' };

const don = (them: Partial<DonHang> = {}): DonHang => ({
  id: ORDER, order_code: 100001, tenant_id: TENANT, account_id: 'acc-1', kind: 'plan', tier: 'starter',
  months: 3, quota_group: null, packs: null, amount_vnd: 1_950_000, amount_usd_cents: 7_500,
  status: 'pending', provider: 'payos', payment_link_id: null, checkout_url: null, qr_code: null,
  link_expires_at: null, paid_at: null, paid_amount_vnd: null, fulfilled_at: null, fulfil_attempts: 0,
  fulfil_error: null, entitlement_receipt: null, note: null, created_at: NOW, updated_at: NOW, ...them,
});

function kho(tuyChon: { quotaMode?: string; pending?: number; donCu?: DonHang | null; donTheoId?: DonHang | null } = {}) {
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('FROM tenant WHERE id')) return [{ id: TENANT, name: 'Công ty Thử', plan: 'free', quota_mode: tuyChon.quotaMode ?? 'commercial', billing_name: null, billing_tax_code: null, billing_address: null, billing_email: null }];
    if (q.text.includes('count(*)::int AS n FROM customer_order')) return [{ n: tuyChon.pending ?? 0 }];
    if (q.text.includes('payment_link_id IS NULL')) return tuyChon.donCu ? [tuyChon.donCu] : [];
    if (q.text.includes('INSERT INTO customer_order')) return [don()];
    if (q.text.includes('FROM customer_order') && q.text.includes('tenant_id')) return tuyChon.donTheoId === undefined ? [don()] : tuyChon.donTheoId ? [tuyChon.donTheoId] : [];
    if (q.text.includes("status = 'cancelled'")) return [{ id: ORDER }];
    return [];
  });
  return { sql, calls };
}

const link: LinkThanhToan = { paymentLinkId: 'link-1', checkoutUrl: 'https://pay.test/web/link-1', qrCode: '0002...' };
function payosGia(tuyChon: { taoLoi?: PayosError; docLink?: unknown } = {}): PayosPort & { taoLink: ReturnType<typeof vi.fn> } {
  return {
    ten: 'payos',
    checkoutUrlTuId: (id) => `https://pay.test/web/${id}`,
    taoLink: vi.fn(async () => { if (tuyChon.taoLoi) throw tuyChon.taoLoi; return link; }),
    docLink: vi.fn(async () => tuyChon.docLink ?? null) as never,
    huyLink: vi.fn(async () => {}),
  } as never;
}

const soGia = (tier: 'trial' | 'starter' = 'trial') => ({
  readUsage: async () => ({ status: 'active', tier, revision: 1, periodId: 'p' }),
  readPeriods: async () => ({ periods: [], credits: [] }),
  applyCommand: async () => { throw new Error('không dùng ở đây'); },
});

function app(k: ReturnType<typeof kho>, payos: PayosPort, dangNhap = true) {
  const a = new Hono<AppEnv>();
  a.onError((err, c) => errorResponse(c, err));
  a.route('/', consoleOrdersWith({
    sql: () => k.sql,
    payos: () => payos,
    so: () => soGia() as never,
    now: () => NOW,
    xacThuc: dangNhap
      ? async (c, next) => { c.set('customer', khach); await next(); }
      : undefined,
  }));
  return a;
}

const post = (a: Hono<AppEnv>, duong: string, body: unknown, moi = moiTruong()) =>
  a.request(`https://api${duong}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, moi);

describe('cổng đăng nhập', () => {
  for (const [duong, method] of [['/v1/console/orders', 'GET'], ['/v1/console/orders', 'POST'], ['/v1/console/orders/quote?kind=plan&tier=starter&months=1', 'GET'], [`/v1/console/orders/${ORDER}`, 'GET'], [`/v1/console/orders/${ORDER}/cancel`, 'POST']] as const) {
    it(`${method} ${duong} chưa đăng nhập → 401`, async () => {
      const res = await app(kho(), payosGia(), false).request(`https://api${duong}`, { method }, moiTruong());
      expect(res.status).toBe(401);
    });
  }
});

describe('GET /v1/console/orders/quote', () => {
  it('gói: tiền máy chủ tính, hiệu lực từ now khi đang dùng thử, hết hạn +3 tháng', async () => {
    const res = await app(kho(), payosGia()).request('https://api/v1/console/orders/quote?kind=plan&tier=starter&months=3', {}, moiTruong());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ amountVnd: 1_950_000, amountUsdCents: 7_500, hieuLucTu: NOW.toISOString(), hetHanLuc: '2026-12-19T03:00:00.000Z' });
  });

  it('tier lạ → 400 invalid_tier; months lạ → 400 invalid_months', async () => {
    const a = app(kho(), payosGia());
    const r1 = await a.request('https://api/v1/console/orders/quote?kind=plan&tier=vip&months=3', {}, moiTruong());
    expect(((await r1.json()) as { error: { code: string } }).error.code).toBe('invalid_tier');
    const r2 = await a.request('https://api/v1/console/orders/quote?kind=plan&tier=starter&months=5', {}, moiTruong());
    expect(((await r2.json()) as { error: { code: string } }).error.code).toBe('invalid_months');
  });

  it('mua lượt khi đang dùng thử → 409 credits_require_paid_active', async () => {
    const res = await app(kho(), payosGia()).request('https://api/v1/console/orders/quote?kind=addon&group=places&packs=5', {}, moiTruong());
    expect(res.status).toBe(409);
  });
});

describe('POST /v1/console/orders', () => {
  it('tạo đơn, gọi PayOS với tiền của máy chủ và returnUrl cùng origin, lưu link, 201', async () => {
    const k = kho();
    const payos = payosGia();
    const res = await post(app(k, payos), '/v1/console/orders', { kind: 'plan', tier: 'starter', months: 3, amount: 1 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { order: Record<string, unknown> };
    expect(body.order).toMatchObject({ id: ORDER, orderCode: 100001, noiDungChuyenKhoan: 'MLV100001', amountVnd: 1_950_000, status: 'pending' });
    const goi = payos.taoLink.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(goi.amount).toBe(1_950_000);
    expect(goi.description).toBe('MLV100001');
    expect(goi.returnUrl).toBe(`https://api/console/don-hang/${ORDER}?ket-qua=thanh-cong`);
    expect(goi.cancelUrl).toBe(`https://api/console/don-hang/${ORDER}?ket-qua=huy`);
    expect((goi.expiredAt as Date).getTime()).toBe(NOW.getTime() + 24 * 3_600_000);
    const luu = k.calls.find((c) => c.text.includes('payment_link_id = $'));
    expect(luu?.params).toEqual(expect.arrayContaining(['link-1', 'https://pay.test/web/link-1']));
  });

  it('tenant không phải commercial → 409 tenant_not_commercial, không chạm PayOS', async () => {
    const payos = payosGia();
    const res = await post(app(kho({ quotaMode: 'legacy' }), payos), '/v1/console/orders', { kind: 'plan', tier: 'starter', months: 1 });
    expect(res.status).toBe(409);
    expect(payos.taoLink).not.toHaveBeenCalled();
  });

  it('đã 3 đơn pending → 409 too_many_pending_orders', async () => {
    const res = await post(app(kho({ pending: 3 }), payosGia()), '/v1/console/orders', { kind: 'plan', tier: 'starter', months: 1 });
    expect(res.status).toBe(409);
  });

  it('PayOS lỗi → 503 payment_provider_unavailable kèm orderId; đơn vẫn pending không link', async () => {
    const k = kho();
    const res = await post(app(k, payosGia({ taoLoi: new PayosError('payos_unreachable', 'x') })), '/v1/console/orders', { kind: 'plan', tier: 'starter', months: 3 });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; details?: { orderId?: string } } };
    expect(body.error.code).toBe('payment_provider_unavailable');
    expect(body.error.details?.orderId).toBe(ORDER);
    expect(k.calls.some((c) => c.text.includes('payment_link_id = $'))).toBe(false);
  });

  it('bấm lại khi đã có đơn pending cùng nội dung chưa link → dùng lại đơn đó, không INSERT', async () => {
    const k = kho({ donCu: don() });
    const res = await post(app(k, payosGia()), '/v1/console/orders', { kind: 'plan', tier: 'starter', months: 3 });
    expect(res.status).toBe(201);
    expect(k.calls.some((c) => c.text.includes('INSERT INTO customer_order'))).toBe(false);
  });

  it('PayOS báo orderCode đã tồn tại → đọc lại link, dựng checkoutUrl từ id, qr null', async () => {
    const k = kho();
    const payos = payosGia({ taoLoi: new PayosError('payos_order_exists', 'x'), docLink: { paymentLinkId: 'cu-1', orderCode: 100001, amount: 1_950_000, amountPaid: 0, amountRemaining: 1_950_000, status: 'PENDING', transactions: [] } });
    const res = await post(app(k, payos), '/v1/console/orders', { kind: 'plan', tier: 'starter', months: 3 });
    expect(res.status).toBe(201);
    const luu = k.calls.find((c) => c.text.includes('payment_link_id = $'));
    expect(luu?.params).toEqual(expect.arrayContaining(['cu-1', 'https://pay.test/web/cu-1', null]));
  });

  it('cổng đóng → 503 self_serve_closed', async () => {
    const res = await post(app(kho(), payosGia()), '/v1/console/orders', { kind: 'plan', tier: 'starter', months: 1 }, moiTruong({ SELF_SERVE: '0' }));
    expect(res.status).toBe(503);
  });
});

describe('GET /v1/console/orders/:id và cancel', () => {
  it('đơn của tenant khác → 404 (câu SQL có tenant_id của phiên)', async () => {
    const k = kho({ donTheoId: null });
    const res = await app(k, payosGia()).request(`https://api/v1/console/orders/${ORDER}`, {}, moiTruong());
    expect(res.status).toBe(404);
    const doc = k.calls.find((c) => c.text.includes('FROM customer_order'));
    expect(doc?.params).toContain(TENANT);
  });

  it('qrCode chỉ trả khi còn pending', async () => {
    const k = kho({ donTheoId: don({ status: 'fulfilled', qr_code: 'QR' }) });
    const res = await app(k, payosGia()).request(`https://api/v1/console/orders/${ORDER}`, {}, moiTruong());
    expect(((await res.json()) as { order: { qrCode: unknown } }).order.qrCode).toBeNull();
  });

  it('huỷ đơn pending: gọi PayOS cancel rồi cancelled', async () => {
    const payos = payosGia();
    const res = await post(app(kho({ donTheoId: don({ payment_link_id: 'l' }) }), payos), `/v1/console/orders/${ORDER}/cancel`, {});
    expect(res.status).toBe(200);
    expect(payos.huyLink).toHaveBeenCalledWith(100001, expect.any(String));
  });

  it('huỷ đơn không pending → 409 order_not_cancellable', async () => {
    const res = await post(app(kho({ donTheoId: don({ status: 'fulfilled' }) }), payosGia()), `/v1/console/orders/${ORDER}/cancel`, {});
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/console-orders.test.ts`

- [ ] **Step 3: Viết `routes/console-orders.ts`**

```ts
import { addMonths, CatalogError, type OrderInput, quoteOrder } from '@mapslibvn/catalog';
import { Hono, type MiddlewareHandler } from 'hono';
import { audit } from '../audit';
import { quotaObject } from '../billing/object';
import {
  danhSachDonCuaTenant,
  demDonPending,
  docDonCuaTenant,
  type DonHang,
  huyDonCuaTenant,
  luuLinkThanhToan,
  noiDungChuyenKhoan,
  taoDon,
  timDonPendingChuaCoLink,
} from '../commerce/db';
import type { CongSo, FulfilDeps } from '../commerce/fulfil';
import { tinhStartsAt } from '../commerce/ky-han';
import { chonPayosPort, PayosError, type PayosPort } from '../commerce/payos';
import { docTenant } from '../console/db';
import { selfServeOpen } from '../console/flags';
import { requireCustomer } from '../console/require-customer';
import { endSql, getSql } from '../db';
import { moTaDon } from '../email/mau-don-hang';
import type { AppEnv, Env } from '../env';
import { ApiError, moTaLoi } from '../errors';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const MAX_BODY = 4 * 1024;
/** Quá số này thì khách đang tạo đơn để chơi; 409 kèm gợi ý huỷ (spec 9.1). */
const DON_PENDING_TOI_DA = 3;
const LINK_SONG_MS = 24 * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ConsoleOrdersDeps extends FulfilDeps {
  sql?: (env: Env) => ReturnType<typeof getSql>;
  payos?: (env: Env) => PayosPort;
  /** Test thay cổng phiên bằng middleware đặt sẵn `customer`; production dùng requireCustomer(). */
  xacThuc?: MiddlewareHandler<AppEnv> | undefined;
}

/**
 * Đọc nội dung đơn từ dữ liệu ngoài (query hoặc body). Chỉ nhận đúng các trường định danh gói;
 * số tiền KHÔNG có chỗ ở đây — quoteOrder() tính, và mọi số client gửi đều bị bỏ.
 */
function docOrderInput(raw: Record<string, unknown>): OrderInput {
  const kind = raw.kind;
  if (kind === 'plan') {
    return { kind: 'plan', tier: String(raw.tier ?? '') as never, months: Number(raw.months) as never };
  }
  if (kind === 'addon') {
    return { kind: 'addon', group: String(raw.group ?? '') as never, packs: Number(raw.packs) };
  }
  throw new ApiError(400, 'invalid_kind', 'kind phải là plan hoặc addon');
}

function baoGia(input: OrderInput) {
  try {
    return quoteOrder(input);
  } catch (error) {
    if (error instanceof CatalogError) throw new ApiError(400, error.code, 'Nội dung đơn không hợp lệ');
    throw error;
  }
}

async function docJsonNho(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) {
    throw new ApiError(413, 'payload_too_large', 'Thân yêu cầu quá lớn');
  }
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Hình dạng đơn trả cho khách. `qrCode` chỉ khi còn pending: đơn xong rồi thì mã QR là mồi trả nhầm. */
export function donJson(don: DonHang) {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    id: don.id,
    orderCode: don.order_code,
    noiDungChuyenKhoan: noiDungChuyenKhoan(don.order_code),
    kind: don.kind,
    tier: don.tier,
    months: don.months,
    quotaGroup: don.quota_group,
    packs: don.packs,
    moTa: moTaDon(don),
    amountVnd: don.amount_vnd,
    amountUsdCents: don.amount_usd_cents,
    status: don.status,
    checkoutUrl: don.status === 'pending' ? don.checkout_url : null,
    qrCode: don.status === 'pending' ? don.qr_code : null,
    linkExpiresAt: iso(don.link_expires_at),
    paidAt: iso(don.paid_at),
    paidAmountVnd: don.paid_amount_vnd,
    fulfilledAt: iso(don.fulfilled_at),
    fulfilError: don.fulfil_error,
    createdAt: iso(don.created_at),
  };
}

export function consoleOrdersWith(deps: ConsoleOrdersDeps = {}) {
  const routes = new Hono<AppEnv>();
  const cong = deps.xacThuc ?? requireCustomer();
  const so = (env: Env, tenantId: string): CongSo =>
    (deps.so ?? quotaObject)(env, tenantId) as CongSo;
  const payos = (env: Env) => (deps.payos ?? chonPayosPort)(env);
  const now = () => (deps.now ?? (() => new Date()))();

  routes.use('/v1/console/orders', cong);
  routes.use('/v1/console/orders/*', cong);

  const khachCoTenant = (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => {
    const khach = c.get('customer');
    if (!khach) throw new ApiError(401, 'not_signed_in', 'Chưa đăng nhập');
    if (!khach.tenantId) throw new ApiError(409, 'chua_co_tenant', 'Tài khoản chưa có tổ chức');
    return { ...khach, tenantId: khach.tenantId };
  };

  async function voiSqlCua<T>(c: Parameters<MiddlewareHandler<AppEnv>>[0], fn: (sql: ReturnType<typeof getSql>) => Promise<T>) {
    const sql = (deps.sql ?? getSql)(c.env);
    try {
      return await fn(sql);
    } finally {
      endSql(c.executionCtx, sql);
    }
  }

  // `quote` PHẢI khai trước `:id`.
  routes.get('/v1/console/orders/quote', async (c) => {
    const khach = khachCoTenant(c);
    const q = new URL(c.req.url).searchParams;
    const input = docOrderInput(Object.fromEntries(q.entries()));
    const gia = baoGia(input);
    const s = so(c.env, khach.tenantId);
    if (input.kind === 'addon') {
      const usage = await s.readUsage();
      if (usage.status !== 'active' || usage.tier === 'trial') {
        throw new ApiError(409, 'credits_require_paid_active', 'Chỉ mua thêm lượt khi có thuê bao trả phí đang hoạt động');
      }
      return c.json({ ...gia, hieuLucTu: null, hetHanLuc: null }, 200, NO_STORE);
    }
    const history = await s.readPeriods(60);
    const hieuLucTu = tinhStartsAt(history, now());
    return c.json(
      { ...gia, hieuLucTu: hieuLucTu.toISOString(), hetHanLuc: addMonths(hieuLucTu, input.months).toISOString() },
      200,
      NO_STORE,
    );
  });

  routes.get('/v1/console/orders', async (c) => {
    const khach = khachCoTenant(c);
    const ds = await voiSqlCua(c, (sql) => danhSachDonCuaTenant(sql, khach.tenantId));
    return c.json({ orders: ds.map(donJson) }, 200, NO_STORE);
  });

  routes.post('/v1/console/orders', async (c) => {
    if (!selfServeOpen(c.env)) throw new ApiError(503, 'self_serve_closed', 'Cổng tự phục vụ chưa mở');
    const khach = khachCoTenant(c);
    const input = docOrderInput(await docJsonNho(c.req.raw));
    const gia = baoGia(input);

    const don = await voiSqlCua(c, async (sql) => {
      const tenant = await docTenant(sql, khach.tenantId);
      if (!tenant) throw new ApiError(404, 'not_found', 'Không có tổ chức này');
      if (tenant.quota_mode !== 'commercial') {
        throw new ApiError(409, 'tenant_not_commercial', 'Tổ chức chưa ở chế độ thương mại');
      }
      if (input.kind === 'addon') {
        const usage = await so(c.env, khach.tenantId).readUsage();
        if (usage.status !== 'active' || usage.tier === 'trial') {
          throw new ApiError(409, 'credits_require_paid_active', 'Chỉ mua thêm lượt khi có thuê bao trả phí đang hoạt động');
        }
      }
      // Đơn pending cùng nội dung mà PayOS chưa cấp link: dùng lại, không đẻ thêm đơn.
      const cu = await timDonPendingChuaCoLink(sql, khach.tenantId, input);
      if (cu) return cu;
      if ((await demDonPending(sql, khach.tenantId)) >= DON_PENDING_TOI_DA) {
        throw new ApiError(409, 'too_many_pending_orders', 'Đang có quá nhiều đơn chờ thanh toán, hãy huỷ bớt');
      }
      const moi = await taoDon(sql, { tenantId: khach.tenantId, accountId: khach.accountId, don: input, gia });
      audit(c, 'customer.order_create', moi.id, { order_code: moi.order_code, tenant_id: khach.tenantId, kind: input.kind, amount_vnd: moi.amount_vnd });
      return moi;
    });

    // Gọi PayOS NGOÀI phạm vi client Postgres của bước trên: lời gọi mạng có thể mất 10 giây.
    const origin = new URL(c.req.url).origin;
    const cong = payos(c.env);
    const hetHan = new Date(now().getTime() + LINK_SONG_MS);
    let link: { paymentLinkId: string; checkoutUrl: string; qrCode: string | null };
    try {
      const tenant = await voiSqlCua(c, (sql) => docTenant(sql, khach.tenantId));
      link = await cong.taoLink({
        orderCode: don.order_code,
        amount: don.amount_vnd,
        description: noiDungChuyenKhoan(don.order_code),
        returnUrl: `${origin}/console/don-hang/${don.id}?ket-qua=thanh-cong`,
        cancelUrl: `${origin}/console/don-hang/${don.id}?ket-qua=huy`,
        expiredAt: hetHan,
        buyerEmail: tenant?.billing_email ?? khach.email,
        buyerName: khach.name,
        buyerCompanyName: tenant?.billing_name ?? null,
        buyerTaxCode: tenant?.billing_tax_code ?? null,
        buyerAddress: tenant?.billing_address ?? null,
        itemName: moTaDon(don),
      });
    } catch (error) {
      if (error instanceof PayosError && error.code === 'payos_order_exists') {
        // Lần trước PayOS đã tạo link mà ta không lưu được: đọc lại, dựng checkoutUrl từ id.
        const co = await cong.docLink(don.order_code).catch(() => null);
        if (!co) throw new ApiError(503, 'payment_provider_unavailable', 'Không tạo được link thanh toán', undefined, { orderId: don.id });
        link = { paymentLinkId: co.paymentLinkId, checkoutUrl: cong.checkoutUrlTuId(co.paymentLinkId), qrCode: null };
      } else {
        console.error(`[commerce] PayOS tạo link đơn ${don.order_code} lỗi: ${moTaLoi(error)}`);
        // Đơn vẫn pending không link; khách bấm lại thì dùng lại đơn này (timDonPendingChuaCoLink).
        throw new ApiError(503, 'payment_provider_unavailable', 'Cổng thanh toán đang bận, hãy thử lại', undefined, { orderId: don.id });
      }
    }

    await voiSqlCua(c, (sql) => luuLinkThanhToan(sql, don.id, { ...link, linkExpiresAt: hetHan }));
    return c.json(
      { order: donJson({ ...don, payment_link_id: link.paymentLinkId, checkout_url: link.checkoutUrl, qr_code: link.qrCode, link_expires_at: hetHan }) },
      201,
      NO_STORE,
    );
  });

  routes.get('/v1/console/orders/:id', async (c) => {
    const khach = khachCoTenant(c);
    const id = c.req.param('id');
    if (!UUID.test(id)) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    const don = await voiSqlCua(c, (sql) => docDonCuaTenant(sql, khach.tenantId, id));
    if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    return c.json({ order: donJson(don) }, 200, NO_STORE);
  });

  routes.post('/v1/console/orders/:id/cancel', async (c) => {
    const khach = khachCoTenant(c);
    const id = c.req.param('id');
    if (!UUID.test(id)) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    const don = await voiSqlCua(c, (sql) => docDonCuaTenant(sql, khach.tenantId, id));
    if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    if (don.status !== 'pending') throw new ApiError(409, 'order_not_cancellable', 'Chỉ huỷ được đơn đang chờ thanh toán');
    if (don.payment_link_id) {
      try {
        await payos(c.env).huyLink(don.order_code, 'Khách huỷ ở cổng khách hàng');
      } catch (error) {
        // Không đánh dấu huỷ khi PayOS chưa xác nhận: link còn sống mà ta bảo "đã huỷ" là nói sai.
        console.error(`[commerce] PayOS huỷ link đơn ${don.order_code} lỗi: ${moTaLoi(error)}`);
        throw new ApiError(503, 'payment_provider_unavailable', 'Cổng thanh toán đang bận, hãy thử lại');
      }
    }
    const daHuy = await voiSqlCua(c, (sql) => huyDonCuaTenant(sql, khach.tenantId, id));
    if (!daHuy) throw new ApiError(409, 'order_not_cancellable', 'Đơn vừa đổi trạng thái');
    audit(c, 'customer.order_cancel', id, { order_code: don.order_code, tenant_id: khach.tenantId });
    return c.json({ order: donJson({ ...don, status: 'cancelled' }) }, 200, NO_STORE);
  });

  return routes;
}

export const consoleOrders = consoleOrdersWith();
```

- [ ] **Step 4: Mount vào `index.ts`**

Sau `app.route('/', consoleRoutes);`:

```ts
app.route('/', consoleOrders);
```

kèm import `{ consoleOrders } from './routes/console-orders'`. Nhóm này nằm dưới tiền tố
`/v1/console/*` nên cổng chống CSRF đã khai một lần ở trên áp luôn.

- [ ] **Step 5: Chạy test, thấy xanh; typecheck; cả bộ API**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS toàn bộ.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/console-orders.ts apps/api/src/index.ts apps/api/test/console-orders.test.ts
git commit -m "feat(api): đơn hàng của khách — báo giá, tạo đơn qua PayOS, danh sách, chi tiết, huỷ; tiền do máy chủ tính

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Cron — cấp lại, đối soát, hết hạn, dọn dẹp, nhắc hạn; `scheduled()` trong Worker

**Files:**
- Create: `apps/api/src/commerce/cron.ts`
- Modify: `apps/api/src/index.ts`, `apps/api/wrangler.toml`
- Test: `apps/api/test/commerce-cron.test.ts`, `apps/api/test/scheduled.test.ts`

- [ ] **Step 1: Viết test đỏ**

`apps/api/test/commerce-cron.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { CommandReceipt, EntitlementCommand, UsageSnapshot } from '../src/billing/types';
import { chayCron, CRON_HANG_NGAY, CRON_MOI_5_PHUT, phanLoaiNhac } from '../src/commerce/cron';
import type { DonHang } from '../src/commerce/db';
import type { PayosPort, ThongTinLink } from '../src/commerce/payos';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const NOW = new Date('2026-09-19T02:00:00Z');
const TENANT = '00000000-0000-4000-8000-0000000000c1';
const ORDER = '00000000-0000-4000-8000-0000000000d1';
const env = { ENVIRONMENT: 'test', CONSOLE_ORIGIN: 'https://api.test', SUPPORT_EMAIL: 'ho-tro@vidu.vn' } as never;
const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };

const don = (them: Partial<DonHang> = {}): DonHang => ({
  id: ORDER, order_code: 100001, tenant_id: TENANT, account_id: 'a', kind: 'plan', tier: 'starter', months: 1,
  quota_group: null, packs: null, amount_vnd: 650_000, amount_usd_cents: 2_500, status: 'pending', provider: 'payos',
  payment_link_id: 'l', checkout_url: 'u', qr_code: null, link_expires_at: new Date(NOW.getTime() + 3_600_000),
  paid_at: null, paid_amount_vnd: null, fulfilled_at: null, fulfil_attempts: 0, fulfil_error: null,
  entitlement_receipt: null, note: null, created_at: new Date(NOW.getTime() - 20 * 60_000), updated_at: NOW, ...them,
});

const usage = (them: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  tenantId: TENANT, status: 'active', tier: 'starter', revision: 1, periodId: 'p1',
  startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-09-26T02:00:00Z', trialUsedOnce: true, maintenance: false,
  missingAcks: { count: 0, limit: 3, locked: false, opensAt: null },
  places: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
  directions: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 }, ...them,
});

/** Kho giả có hai đơn tuỳ chọn và một tenant thương mại. */
function kho(tuyChon: { capLai?: DonHang[]; doiSoat?: DonHang[]; quaHan?: DonHang[]; daNhac?: boolean; daGui?: number } = {}) {
  const suKien: string[] = [];
  const trangThai = new Map<string, string>();
  const audit: string[] = [];
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('fulfil_attempts < $')) return tuyChon.capLai ?? [];
    if (q.text.includes("interval '10 minutes'")) return tuyChon.doiSoat ?? [];
    if (q.text.includes("interval '1 hour' <")) return tuyChon.quaHan ?? [];
    if (q.text.includes('FROM customer_order WHERE id')) {
      const d = [...(tuyChon.capLai ?? []), ...(tuyChon.doiSoat ?? [])].find((x) => x.id === q.params[0]);
      return d ? [{ ...d, status: trangThai.get(d.id) ?? d.status }] : [];
    }
    if (q.text.includes('INSERT INTO payment_event')) { suKien.push(q.params[2] as string); return [{ id: suKien.length }]; }
    if (q.text.includes('coalesce(sum(amount_vnd)')) return [{ tong: suKien.length ? 650_000 : 0, tham_chieu: suKien[0] ?? null, luc: NOW }];
    if (q.text.includes('EXISTS(SELECT 1 FROM payment_event')) return [{ co: suKien.length > 0 }];
    if (q.text.includes("status = 'paid'") && q.text.includes('UPDATE')) { trangThai.set(q.params[2] as string, 'paid'); return [{ id: q.params[2] }]; }
    if (q.text.includes("status = 'fulfilled'")) { trangThai.set(q.params[1] as string, 'fulfilled'); return [{ id: q.params[1] }]; }
    if (q.text.includes("status = 'expired'")) { trangThai.set(q.params[0] as string, 'expired'); return [{ id: q.params[0] }]; }
    if (q.text.includes('DELETE FROM customer_login_code')) return [{ id: 1 }, { id: 2 }];
    if (q.text.includes('DELETE FROM customer_session')) return [{ token_hash: 'x' }];
    if (q.text.includes("quota_mode = 'commercial'")) return [{ id: TENANT, name: 'Công ty Thử', email: 'khach@vidu.vn' }];
    if (q.text.includes("action = 'email.reminder'")) return [{ co: tuyChon.daNhac ?? false }];
    if (q.text.includes("action = 'email.sent'")) return [{ n: tuyChon.daGui ?? 0 }];
    if (q.text.includes('FROM tenant t')) return [{ email: 'khach@vidu.vn', billing_email: null, name: 'Công ty Thử' }];
    if (q.text.includes('INSERT INTO admin_audit')) { audit.push(q.params[1] as string); return []; }
    return [];
  });
  return { sql, calls, suKien, trangThai, audit };
}

function soGia(u: UsageSnapshot = usage()) {
  const lenh: EntitlementCommand[] = [];
  return {
    lenh,
    so: {
      readUsage: vi.fn(async () => u),
      readPeriods: vi.fn(async () => ({ periods: [], credits: [] })),
      applyCommand: vi.fn(async (c: EntitlementCommand): Promise<CommandReceipt> => {
        lenh.push(c);
        return { operationId: c.operationId, revision: 2, status: 'active', tier: 'starter', appliedAt: NOW.toISOString() };
      }),
    },
  };
}

const payosGia = (tt: Partial<ThongTinLink> | null): PayosPort => ({
  ten: 'payos',
  checkoutUrlTuId: (id) => id,
  taoLink: vi.fn(),
  huyLink: vi.fn(),
  docLink: vi.fn(async () => (tt ? { paymentLinkId: 'l', orderCode: 100001, amount: 650_000, amountPaid: 0, amountRemaining: 650_000, status: 'PENDING', transactions: [], ...tt } : null)),
} as never);

const guiThu = vi.fn().mockResolvedValue({ id: 'r' });
const deps = (k: ReturnType<typeof kho>, so: ReturnType<typeof soGia>['so'], payos: PayosPort) => ({
  sql: () => k.sql, so: () => so, payos: () => payos, now: () => NOW, emailPort: () => ({ ten: 'debug' as const, send: guiThu }),
});

describe('cron mỗi 5 phút', () => {
  it('bốn việc chạy độc lập: một việc ném thì ba việc kia vẫn xong', async () => {
    const k = kho();
    const payos = payosGia(null);
    (payos.docLink as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PayOS chết'));
    // doiSoat sẽ không gọi PayOS vì không có đơn; ép lỗi ở việc dọn dẹp bằng cách làm DELETE ném.
    const goc = k.sql;
    const sqlLoi = new Proxy(goc, { apply: (t, thisArg, args) => { const q = Reflect.apply(t, thisArg, args) as Promise<unknown> & { text: string }; return q.text.includes('DELETE FROM customer_login_code') ? Promise.reject(new Error('DB ngủ')) : q; } });
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, { ...deps(k, soGia().so, payos), sql: () => sqlLoi as never });
    expect(bc.map((v) => [v.ten, v.ok])).toEqual([['capLaiDonTreo', true], ['doiSoatPending', true], ['hetHanDon', true], ['donDep', false]]);
    expect(bc[3]?.loi).toContain('DB ngủ');
  });

  it('capLaiDonTreo: đơn paid_unfulfilled được cấp, biên nhận gửi', async () => {
    const k = kho({ capLai: [don({ status: 'paid_unfulfilled', fulfil_attempts: 2, paid_amount_vnd: 650_000 })] });
    k.suKien.push('FT-cu');
    const { so, lenh } = soGia();
    guiThu.mockClear();
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, so, payosGia(null)));
    expect(bc[0]).toMatchObject({ ten: 'capLaiDonTreo', ok: true, soLuong: 1 });
    expect(lenh).toHaveLength(1);
    expect(k.trangThai.get(ORDER)).toBe('fulfilled');
    await new Promise((r) => setTimeout(r, 10));
    expect(guiThu).toHaveBeenCalledTimes(1);
  });

  it('doiSoatPending: PayOS nói PAID mà chưa có sự kiện → dựng sự kiện từ transactions rồi cấp', async () => {
    const k = kho({ doiSoat: [don()] });
    const { so, lenh } = soGia();
    const payos = payosGia({ status: 'PAID', amountPaid: 650_000, amountRemaining: 0, transactions: [{ reference: 'FT-GET', amount: 650_000, transactionDateTime: '2026-09-19 08:50:00' }] });
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, so, payos));
    expect(bc[1]).toMatchObject({ ten: 'doiSoatPending', ok: true, soLuong: 1 });
    expect(k.suKien).toEqual(['FT-GET']);
    expect(lenh).toHaveLength(1);
    expect(k.trangThai.get(ORDER)).toBe('fulfilled');
  });

  it('doiSoatPending: PAID không có transactions → reference payos-get:<linkId>, vẫn cấp', async () => {
    const k = kho({ doiSoat: [don()] });
    const payos = payosGia({ status: 'PAID', amountPaid: 650_000, transactions: [] });
    await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, soGia().so, payos));
    expect(k.suKien).toEqual(['payos-get:l']);
  });

  it('doiSoatPending: CANCELLED/EXPIRED → expired, audit order.expired', async () => {
    const k = kho({ doiSoat: [don()] });
    await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, soGia().so, payosGia({ status: 'CANCELLED' })));
    expect(k.trangThai.get(ORDER)).toBe('expired');
    expect(k.audit).toContain('order.expired');
  });

  it('hetHanDon: pending quá hạn → expired', async () => {
    const k = kho({ quaHan: [don({ id: 'qua-han' })] });
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, soGia().so, payosGia(null)));
    expect(bc[2]).toMatchObject({ ten: 'hetHanDon', soLuong: 1 });
    expect(k.trangThai.get('qua-han')).toBe('expired');
  });

  it('donDep: đếm mã và phiên đã xoá', async () => {
    const k = kho();
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, soGia().so, payosGia(null)));
    expect(bc[3]).toMatchObject({ ten: 'donDep', ok: true, soLuong: 3 });
  });
});

describe('phanLoaiNhac', () => {
  const lichSu = { periods: [], credits: [] };
  it('còn đúng 7 ngày → 7d; 1 ngày → 1d; hết hạn hôm qua → het; khác → null', () => {
    expect(phanLoaiNhac(usage({ endsAt: '2026-09-26T02:00:00Z' }), lichSu, NOW)?.loai).toBe('7d');
    expect(phanLoaiNhac(usage({ endsAt: '2026-09-20T02:00:00Z' }), lichSu, NOW)?.loai).toBe('1d');
    expect(phanLoaiNhac(usage({ status: 'expired', endsAt: '2026-09-18T10:00:00Z' }), lichSu, NOW)?.loai).toBe('het');
    expect(phanLoaiNhac(usage({ endsAt: '2026-09-23T02:00:00Z' }), lichSu, NOW)).toBeNull();
  });
  it('dùng thử không nhắc; đã có kỳ kế tiếp không nhắc', () => {
    expect(phanLoaiNhac(usage({ tier: 'trial', endsAt: '2026-09-26T02:00:00Z' }), lichSu, NOW)).toBeNull();
    const coKyMoi = { periods: [{ periodId: 'p2', tier: 'starter' as const, startsAt: '2026-09-26T02:00:00Z', endsAt: '2026-10-26T02:00:00Z', paymentReference: 'FT', lineItemId: 'x', places: { limit: 0, used: 0, reserved: 0 }, directions: { limit: 0, used: 0, reserved: 0 } }], credits: [] };
    expect(phanLoaiNhac(usage({ endsAt: '2026-09-26T02:00:00Z' }), coKyMoi, NOW)).toBeNull();
  });
});

describe('cron hằng ngày — nhắc hạn', () => {
  it('gửi một thư, ghi email.reminder với target tenant:kỳ:loại', async () => {
    const k = kho();
    guiThu.mockClear();
    const bc = await chayCron(env, ctx, CRON_HANG_NGAY, deps(k, soGia().so, payosGia(null)));
    expect(bc[0]).toMatchObject({ ten: 'nhacHan', ok: true, soLuong: 1 });
    expect(guiThu).toHaveBeenCalledTimes(1);
    const ghi = k.calls.find((c) => c.params.includes('email.reminder'));
    expect(ghi?.params).toContain(`${TENANT}:p1:7d`);
  });

  it('đã nhắc rồi → không gửi lại', async () => {
    const k = kho({ daNhac: true });
    guiThu.mockClear();
    await chayCron(env, ctx, CRON_HANG_NGAY, deps(k, soGia().so, payosGia(null)));
    expect(guiThu).not.toHaveBeenCalled();
  });

  it('ngân sách còn dưới 20 → dừng, không gửi', async () => {
    const k = kho({ daGui: 85 });
    guiThu.mockClear();
    const bc = await chayCron(env, ctx, CRON_HANG_NGAY, deps(k, soGia().so, payosGia(null)));
    expect(guiThu).not.toHaveBeenCalled();
    expect(bc[0]?.soLuong).toBe(0);
  });
});
```

`apps/api/test/scheduled.test.ts` — bằng chứng cron không làm hỏng Worker khi DB chết (binding
Hyperdrive của tầng test trỏ cổng đóng):

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

describe('scheduled()', () => {
  it('DB không nối được → mọi việc báo lỗi, KHÔNG ném, Worker sống', async () => {
    const viec: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => viec.push(p), passThroughOnException: () => {} };
    expect(() =>
      worker.scheduled(
        { cron: '*/5 * * * *', scheduledTime: Date.now(), noRetry: () => {} } as never,
        { ...env, PAYOS_CLIENT_ID: 'x', PAYOS_API_KEY: 'x', PAYOS_CHECKSUM_KEY: 'x' } as never,
        ctx as never,
      ),
    ).not.toThrow();
    expect(viec).toHaveLength(1);
    await expect(Promise.all(viec)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/commerce-cron.test.ts test/scheduled.test.ts`

- [ ] **Step 3: Viết `commerce/cron.ts`**

```ts
import { writeAudit } from '../audit';
import { quotaObject } from '../billing/object';
import type { PeriodHistory, UsageSnapshot } from '../billing/types';
import { endSql, getSql } from '../db';
import { type LoaiNhac, mauNhacHan } from '../email/mau-don-hang';
import type { EmailPort } from '../email/port';
import type { Env } from '../env';
import { moTaLoi } from '../errors';
import {
  coSuKienHopLe,
  daNhacRoi,
  datHetHan,
  donCanCapLai,
  donDepPhienVaMa,
  donPendingCanDoiSoat,
  donPendingQuaHan,
  ghiSuKienThanhToan,
  tenantThuongMaiCoChu,
} from './db';
import { ACTOR_HE_THONG, apDungThanhToan, type CongSo, type FulfilDeps, TRAN_THU_CAP } from './fulfil';
import { maLoi } from './ky-han';
import { chonPayosPort, type PayosPort } from './payos';
import { thongBaoSauApDung } from './thong-bao';
import { guiThuGiaoDich } from './thu';

type Sql = ReturnType<typeof getSql>;
type Ctx = { waitUntil(promise: Promise<unknown>): void };

export const CRON_MOI_5_PHUT = '*/5 * * * *';
/** 02:00 UTC = 09:00 Việt Nam. */
export const CRON_HANG_NGAY = '0 2 * * *';
const ACTOR_CRON = 'system:cron';
const TEN_GOI: Record<string, string> = { starter: 'Starter', professional: 'Professional', business: 'Business' };

export interface CronDeps extends FulfilDeps {
  sql?: (env: Env) => Sql;
  payos?: (env: Env) => PayosPort;
  emailPort?: (env: Env) => EmailPort;
}

export interface BaoCaoViec {
  ten: string;
  ok: boolean;
  soLuong: number;
  loi?: string;
}

/**
 * Mỗi việc bọc try/catch RIÊNG (spec 9.4): DB ngủ lúc việc thứ nhất chạy thì việc thứ hai vẫn
 * chạy, và không việc nào ném ra ngoài làm hỏng lượt cron sau. Báo cáo trả về để test và log.
 */
async function viec(ten: string, fn: () => Promise<number>): Promise<BaoCaoViec> {
  try {
    return { ten, ok: true, soLuong: await fn() };
  } catch (error) {
    console.error(`[cron] ${ten} lỗi: ${moTaLoi(error)}`, error);
    return { ten, ok: false, soLuong: 0, loi: maLoi(error) };
  }
}

export async function chayCron(env: Env, ctx: Ctx, cron: string, deps: CronDeps = {}): Promise<BaoCaoViec[]> {
  const sql = (deps.sql ?? getSql)(env);
  const now = deps.now ?? (() => new Date());
  const so = (tenantId: string): CongSo => (deps.so ?? quotaObject)(env, tenantId) as CongSo;
  const origin = (env.CONSOLE_ORIGIN ?? '').replace(/\/+$/, '');
  const thongBao = (kq: Parameters<typeof thongBaoSauApDung>[2], suKienMoi: boolean) =>
    thongBaoSauApDung(env, ctx, kq, { origin, suKienMoi }, { sql: deps.sql ?? getSql, ...(deps.emailPort ? { emailPort: deps.emailPort } : {}) });

  try {
    if (cron === CRON_HANG_NGAY) {
      return [await viec('nhacHan', () => nhacHan(sql, env, so, now(), origin, deps))];
    }
    return [
      await viec('capLaiDonTreo', async () => {
        let n = 0;
        for (const don of await donCanCapLai(sql, TRAN_THU_CAP)) {
          const kq = await apDungThanhToan(sql, env, don.id, { ...deps, now });
          if (kq.trangThai === 'fulfilled') n += 1;
          thongBao(kq, false);
        }
        return n;
      }),
      await viec('doiSoatPending', async () => {
        const payos = (deps.payos ?? chonPayosPort)(env);
        let n = 0;
        for (const don of await donPendingCanDoiSoat(sql, now())) {
          const tt = await payos.docLink(don.order_code);
          if (!tt) continue;
          if (tt.status === 'PAID') {
            if (!(await coSuKienHopLe(sql, don.id))) {
              // Webhook rơi: dựng sự kiện từ chính dữ liệu PayOS trả về qua GET.
              const giaoDich = tt.transactions.length > 0
                ? tt.transactions
                : [{ reference: `payos-get:${tt.paymentLinkId}`, amount: tt.amountPaid, transactionDateTime: '' }];
              for (const gd of giaoDich) {
                await ghiSuKienThanhToan(sql, {
                  orderId: don.id, provider: 'payos', reference: gd.reference, orderCode: don.order_code,
                  amountVnd: gd.amount > 0 ? gd.amount : null, signatureValid: true,
                  payload: { nguon: 'cron-doi-soat', ...gd, status: tt.status },
                });
              }
            }
            const kq = await apDungThanhToan(sql, env, don.id, { ...deps, now });
            thongBao(kq, true);
            n += 1;
          } else if (tt.status === 'CANCELLED' || tt.status === 'EXPIRED') {
            if (await datHetHan(sql, don.id)) {
              await writeAudit(sql, { actor: ACTOR_CRON, action: 'order.expired', target: don.id, detail: { order_code: don.order_code, payos_status: tt.status } });
              n += 1;
            }
          }
        }
        return n;
      }),
      await viec('hetHanDon', async () => {
        let n = 0;
        for (const don of await donPendingQuaHan(sql, now())) {
          if (await datHetHan(sql, don.id)) {
            await writeAudit(sql, { actor: ACTOR_CRON, action: 'order.expired', target: don.id, detail: { order_code: don.order_code, ly_do: 'qua_han_link' } });
            n += 1;
          }
        }
        return n;
      }),
      await viec('donDep', async () => {
        const { ma, phien } = await donDepPhienVaMa(sql, now());
        return ma + phien;
      }),
    ];
  } finally {
    endSql(ctx, sql);
  }
}

/**
 * Loại thư nhắc cho một tenant hôm nay, hoặc null. Mỗi mốc chỉ trúng đúng một ngày vì cron chạy
 * một lần mỗi ngày; kỳ dùng thử và tenant đã có kỳ kế tiếp thì không nhắc.
 */
export function phanLoaiNhac(
  usage: UsageSnapshot,
  history: Pick<PeriodHistory, 'periods'>,
  now: Date,
): { loai: LoaiNhac; periodId: string } | null {
  if (!usage.endsAt || !usage.periodId || usage.tier === 'trial' || usage.tier === null) return null;
  const end = Date.parse(usage.endsAt);
  if (!Number.isFinite(end)) return null;
  const coKyKeTiep = history.periods.some((p) => p.tier !== 'trial' && Date.parse(p.startsAt) >= end);
  if (coKyKeTiep) return null;
  const NGAY = 86_400_000;
  if (usage.status === 'active') {
    const conNgay = Math.ceil((end - now.getTime()) / NGAY);
    if (conNgay === 7) return { loai: '7d', periodId: usage.periodId };
    if (conNgay === 1) return { loai: '1d', periodId: usage.periodId };
    return null;
  }
  if (usage.status === 'expired' && now.getTime() - end < NGAY && now.getTime() >= end) {
    return { loai: 'het', periodId: usage.periodId };
  }
  return null;
}

async function nhacHan(
  sql: Sql,
  env: Env,
  so: (tenantId: string) => CongSo,
  now: Date,
  origin: string,
  deps: CronDeps,
): Promise<number> {
  let n = 0;
  for (const t of await tenantThuongMaiCoChu(sql)) {
    let usage: UsageSnapshot;
    let history: PeriodHistory;
    try {
      usage = await so(t.id).readUsage();
      history = await so(t.id).readPeriods(12);
    } catch (error) {
      console.error(`[cron] nhắc hạn: đọc sổ ${t.id} lỗi: ${moTaLoi(error)}`);
      continue;
    }
    const nhac = phanLoaiNhac(usage, history, now);
    if (!nhac) continue;
    const target = `${t.id}:${nhac.periodId}:${nhac.loai}`;
    if (await daNhacRoi(sql, target)) continue;
    const da = await guiThuGiaoDich(
      env,
      sql,
      {
        to: [t.email],
        mau: mauNhacHan({ tenTenant: t.name, tenGoi: TEN_GOI[usage.tier ?? ''] ?? String(usage.tier), hetHan: usage.endsAt as string, loai: nhac.loai, consoleUrl: origin ? `${origin}/console/mua` : null }),
        loai: 'nhac-han',
        hangLoat: true,
      },
      deps.emailPort ? { port: deps.emailPort(env) } : {},
    );
    // Hết ngân sách thì thôi lượt này; mai gửi tiếp — không ghi dấu để mai còn nhắc.
    if (!da) break;
    await writeAudit(sql, { actor: ACTOR_HE_THONG, action: 'email.reminder', target, detail: { tenant_id: t.id, loai: nhac.loai } });
    n += 1;
  }
  return n;
}
```

- [ ] **Step 4: `index.ts` xuất `{ fetch, scheduled }`; `wrangler.toml` thêm trigger, ratelimit, CONSOLE_ORIGIN**

Cuối `apps/api/src/index.ts`, thay `export default app;` bằng:

```ts
/**
 * Worker xuất một object: `fetch` cho HTTP, `scheduled` cho cron (spec 9.4). `SELF.fetch` của
 * cloudflare:test và `wrangler dev` đều nhận dạng này. Cron chạy trong waitUntil và không bao giờ
 * ném — mỗi việc tự bọc lỗi trong chayCron.
 */
export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      chayCron(env, ctx, controller.cron).then((baoCao) => {
        console.log(`[cron] ${controller.cron}: ${JSON.stringify(baoCao)}`);
      }),
    );
  },
};
```

kèm `import { chayCron } from './commerce/cron';` và `import type { AppEnv, Env } from './env';`.

`apps/api/wrangler.toml`, sau khối `[observability]`:

```toml
# Cron của nhóm đơn hàng (spec 9.4): mỗi 5 phút cấp lại/đối soát/hết hạn/dọn dẹp; 02:00 UTC
# (09:00 VN) nhắc hạn. `triggers` là khoá KẾ THỪA nên áp cho cả [env.production]. Ở dev,
# `wrangler dev --test-scheduled` mở đường `/__scheduled?cron=…` để harness gọi tay.
[triggers]
crons = ["*/5 * * * *", "0 2 * * *"]
```

Trong `[vars]` thêm `CONSOLE_ORIGIN = "http://127.0.0.1:8787"`; trong `vars = { … }` của
`[env.production]` thêm `CONSOLE_ORIGIN = "https://api.ai-solutions.io.vn"`. Trong `ratelimits`
của production thêm:

```toml
  # Webhook PayOS sai chữ ký: ghi tối đa 20 dòng/phút mỗi IP để DB không bị lũ rác (spec 18).
  { name = "PAYOS_WEBHOOK_RATE_LIMITER", namespace_id = "20260922", simple = { limit = 20, period = 60 } },
```

- [ ] **Step 5: Chạy test, thấy xanh; cả bộ API; typecheck**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS. `SELF.fetch` của các test cũ vẫn chạy với export mới.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/commerce/cron.ts apps/api/src/index.ts apps/api/wrangler.toml apps/api/test/commerce-cron.test.ts apps/api/test/scheduled.test.ts
git commit -m "feat(api): cron đơn hàng — cấp lại, đối soát PayOS phòng webhook rơi, hết hạn, dọn dẹp, nhắc hạn; scheduled() không bao giờ ném

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Admin tối thiểu — danh sách đơn, chi tiết, "Thử cấp lại", "Xác nhận đã nhận tiền", giao dịch không khớp

**Files:**
- Create: `apps/api/src/routes/admin-orders.ts`
- Modify: `apps/api/src/routes/admin.ts` (`ALL_PERMISSIONS`), `apps/api/src/index.ts`
- Test: `apps/api/test/admin-orders.test.ts`

- [ ] **Step 1: Viết test đỏ**

```ts
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { CommandReceipt, EntitlementCommand } from '../src/billing/types';
import type { DonHang } from '../src/commerce/db';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { adminOrdersWith } from '../src/routes/admin-orders';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const ORDER = '00000000-0000-4000-8000-0000000000d1';
const TENANT = '00000000-0000-4000-8000-0000000000c1';
const NOW = new Date('2026-09-19T03:00:00Z');
const moi = { ...env, ENVIRONMENT: 'test', SUPPORT_EMAIL: 'ho-tro@vidu.vn' } as unknown as Env;

const don = (them: Partial<DonHang> = {}): DonHang & { tenant_name?: string; cursor_at?: string } => ({
  id: ORDER, order_code: 100001, tenant_id: TENANT, account_id: 'a', kind: 'plan', tier: 'starter', months: 1,
  quota_group: null, packs: null, amount_vnd: 650_000, amount_usd_cents: 2_500, status: 'pending', provider: 'payos',
  payment_link_id: 'l', checkout_url: 'u', qr_code: null, link_expires_at: null, paid_at: null, paid_amount_vnd: null,
  fulfilled_at: null, fulfil_attempts: 0, fulfil_error: null, entitlement_receipt: null, note: null,
  created_at: NOW, updated_at: NOW, tenant_name: 'Công ty Thử', cursor_at: '2026-09-19T03:00:00.000000Z', ...them,
});

function kho(tuyChon: { danhSach?: DonHang[]; don?: DonHang | null; trungRef?: boolean } = {}) {
  let hienTai = tuyChon.don === undefined ? don() : tuyChon.don;
  const suKien: { ref: string; amount: number | null; provider: string }[] = [];
  const audit: RecordedQuery[] = [];
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('JOIN tenant t ON t.id = o.tenant_id')) return tuyChon.danhSach ?? [];
    if (q.text.includes('FROM customer_order WHERE id')) return hienTai ? [hienTai] : [];
    if (q.text.includes('SELECT count(*)::int FROM customer_order WHERE status IN')) return [{ cho_xu_ly: 2, doanh_thu: 3_250_000, pending_qua: 1, khong_khop: 4 }];
    if (q.text.includes('WHERE order_id IS NULL ORDER BY received_at')) return [{ id: 9, order_id: null, provider: 'payos', reference: 'invalid:abc', order_code: null, amount_vnd: null, signature_valid: false, tom_tat: {}, received_at: NOW }];
    // `coalesce(sum` phải đứng TRƯỚC câu liệt kê sự kiện: tongTienDaNhan cũng có `ORDER BY id`.
    if (q.text.includes('coalesce(sum(amount_vnd)')) return [{ tong: suKien.reduce((t, s) => t + (s.amount ?? 0), 0), tham_chieu: suKien[0]?.ref ?? null, luc: NOW }];
    if (q.text.includes('FROM payment_event') && q.text.includes('ORDER BY id')) return [];
    if (q.text.includes('WHERE provider = $')) return [{ co: tuyChon.trungRef === true }];
    if (q.text.includes('INSERT INTO payment_event')) { if (tuyChon.trungRef) return []; suKien.push({ ref: q.params[2] as string, amount: q.params[4] as number | null, provider: q.params[1] as string }); return [{ id: 1 }]; }
    if (q.text.includes("status = 'paid'") && q.text.includes('UPDATE') && hienTai) { hienTai = { ...hienTai, status: 'paid' }; return [{ id: ORDER }]; }
    if (q.text.includes("status = 'fulfilled'") && hienTai) { hienTai = { ...hienTai, status: 'fulfilled' }; return [{ id: ORDER }]; }
    if (q.text.includes('FROM tenant t') && q.text.includes('tenant_member')) return [{ email: 'khach@vidu.vn', billing_email: null, name: 'Công ty Thử' }];
    if (q.text.includes("action = 'email.sent'")) return [{ n: 0 }];
    if (q.text.includes('INSERT INTO admin_audit')) { audit.push(q); return []; }
    return [];
  });
  return { sql, calls, suKien, audit, doc: () => hienTai };
}

const soGia = () => {
  const lenh: EntitlementCommand[] = [];
  return { lenh, so: {
    readUsage: vi.fn(async () => ({ tenantId: TENANT, status: 'active', tier: 'trial', revision: 1, periodId: 't', startsAt: null, endsAt: null, trialUsedOnce: true, maintenance: false, missingAcks: { count: 0, limit: 3, locked: false, opensAt: null }, places: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 }, directions: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 } })),
    readPeriods: vi.fn(async () => ({ periods: [], credits: [] })),
    applyCommand: vi.fn(async (c: EntitlementCommand): Promise<CommandReceipt> => { lenh.push(c); return { operationId: c.operationId, revision: 2, status: 'active', tier: 'starter', appliedAt: NOW.toISOString() }; }),
  } };
};

function app(k: ReturnType<typeof kho>, so = soGia().so, email: string | null = 'billing@test.local') {
  const a = new Hono<AppEnv>();
  a.onError((err, c) => errorResponse(c, err));
  a.use('*', async (c, next) => { if (!email) return c.json({ error: { code: 'missing_access_jwt' } }, 401); c.set('reviewer', email); await next(); });
  a.route('/', adminOrdersWith({ sql: () => k.sql, so: () => so, now: () => NOW, emailPort: () => ({ ten: 'debug', send: vi.fn().mockResolvedValue({ id: 'r' }) }) }));
  return a;
}
const get = (a: Hono<AppEnv>, d: string) => a.request(`https://api${d}`, {}, moi);
const post = (a: Hono<AppEnv>, d: string, body: unknown) => a.request(`https://api${d}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, moi);

describe('admin orders — cổng', () => {
  it('không có reviewer → 401', async () => {
    expect((await get(app(kho(), undefined, null), '/v1/admin/orders')).status).toBe(401);
  });
});

describe('GET /v1/admin/orders', () => {
  it('danh sách có tenant_name, nextCursor khi dư một dòng, lọc status', async () => {
    const ds = Array.from({ length: 26 }, (_, i) => don({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}` }));
    const k = kho({ danhSach: ds });
    const res = await get(app(k), '/v1/admin/orders?status=pending&limit=25');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { tenantName: string; cursorAt?: unknown }[]; nextCursor: string | null };
    expect(body.items).toHaveLength(25);
    expect(body.items[0]?.tenantName).toBe('Công ty Thử');
    expect(body.items[0]).not.toHaveProperty('cursorAt');
    expect(body.nextCursor).toMatch(/\|/);
    expect(k.calls[0]?.params).toContain('pending');
  });

  it('status lạ → 400', async () => {
    expect((await get(app(kho()), '/v1/admin/orders?status=vip')).status).toBe(400);
  });

  it('summary trả bốn ô', async () => {
    const res = await get(app(kho()), '/v1/admin/orders/summary');
    expect(await res.json()).toEqual({ choXuLy: 2, doanhThu30Ngay: 3_250_000, pendingQua1Gio: 1, khongKhop: 4 });
  });

  it('unmatched trả sự kiện order_id NULL', async () => {
    const res = await get(app(kho()), '/v1/admin/payment-events/unmatched');
    const body = (await res.json()) as { items: { reference: string; signatureValid: boolean }[] };
    expect(body.items[0]).toMatchObject({ reference: 'invalid:abc', signatureValid: false });
  });
});

describe('GET /v1/admin/orders/:id', () => {
  it('đơn + sự kiện + chủ tenant; 404 khi không có', async () => {
    const res = await get(app(kho()), `/v1/admin/orders/${ORDER}`);
    const body = (await res.json()) as { order: { id: string; tenantId: string }; events: unknown[]; owner: { email: string } };
    expect(body.order).toMatchObject({ id: ORDER, tenantId: TENANT });
    expect(body.owner.email).toBe('khach@vidu.vn');
    expect((await get(app(kho({ don: null })), `/v1/admin/orders/${ORDER}`)).status).toBe(404);
  });
});

describe('POST /v1/admin/orders/:id/fulfil', () => {
  it('đơn paid_unfulfilled → cấp, audit admin.order.fulfil', async () => {
    const k = kho({ don: don({ status: 'paid_unfulfilled', paid_amount_vnd: 650_000 }) });
    k.suKien.push({ ref: 'FT1', amount: 650_000, provider: 'payos' });
    const { so, lenh } = soGia();
    const res = await post(app(k, so), `/v1/admin/orders/${ORDER}/fulfil`, {});
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ order: { status: 'fulfilled' } });
    expect(lenh).toHaveLength(1);
    expect(k.audit.some((q) => q.params.includes('admin.order.fulfil'))).toBe(true);
  });

  it('đơn pending → 409 order_not_fulfillable', async () => {
    const res = await post(app(kho()), `/v1/admin/orders/${ORDER}/fulfil`, {});
    expect(res.status).toBe(409);
  });
});

describe('POST /v1/admin/orders/:id/confirm-manual', () => {
  const than = { operationId: 'op-12345678', reason: 'Thấy tiền trong sao kê', bankReference: 'FT9999' };

  it('thiếu lý do/mã ngân hàng/operationId → 400', async () => {
    const a = app(kho());
    for (const xau of [{ ...than, reason: '' }, { ...than, bankReference: '' }, { ...than, operationId: 'x' }]) {
      expect((await post(a, `/v1/admin/orders/${ORDER}/confirm-manual`, xau)).status).toBe(400);
    }
  });

  it('pending → sự kiện manual:<operationId> đủ tiền còn thiếu → paid → fulfilled; audit giữ lý do', async () => {
    const k = kho();
    const { so, lenh } = soGia();
    const res = await post(app(k, so), `/v1/admin/orders/${ORDER}/confirm-manual`, than);
    expect(res.status).toBe(200);
    expect(k.suKien[0]).toEqual({ ref: 'manual:op-12345678', amount: 650_000, provider: 'manual' });
    expect(lenh).toHaveLength(1);
    expect(k.doc()?.status).toBe('fulfilled');
    const audit = k.audit.find((q) => q.params.includes('admin.order.confirm_manual'));
    expect(JSON.stringify(audit?.params)).toContain('Thấy tiền trong sao kê');
    expect(JSON.stringify(audit?.params)).toContain('FT9999');
  });

  it('cùng operationId lần hai → 200, moi:false, không thêm sự kiện', async () => {
    const k = kho({ trungRef: true, don: don({ status: 'fulfilled' }) });
    const res = await post(app(k), `/v1/admin/orders/${ORDER}/confirm-manual`, than);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ moi: false });
    expect(k.suKien).toHaveLength(0);
  });

  it('đơn fulfilled → 409 order_not_confirmable', async () => {
    const k = kho({ don: don({ status: 'fulfilled' }) });
    expect((await post(app(k), `/v1/admin/orders/${ORDER}/confirm-manual`, than)).status).toBe(409);
  });
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/admin-orders.test.ts`

- [ ] **Step 3: Viết `routes/admin-orders.ts`**

```ts
import { Hono } from 'hono';
import { audit } from '../audit';
import {
  chuTenant,
  daCoSuKien,
  danhSachDonAdmin,
  docDon,
  type DonHang,
  ghiSuKienThanhToan,
  suKienCuaDon,
  suKienKhongKhop,
  tomTatDon,
  tongTienDaNhan,
  type TrangThaiDon,
} from '../commerce/db';
import { apDungThanhToan, type FulfilDeps } from '../commerce/fulfil';
import { type ThongBaoDeps, thongBaoSauApDung } from '../commerce/thong-bao';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';
import { parseLimit } from './admin-list-params';
import { donJson } from './console-orders';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const TRANG_THAI = new Set<TrangThaiDon>(['pending', 'paid', 'fulfilled', 'paid_unfulfilled', 'underpaid', 'expired', 'cancelled', 'refunded']);
/** operationId do trang Admin sinh; thành `reference = manual:<id>` nên phải an toàn để làm khoá. */
const OPERATION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BODY = 16 * 1024;

export interface AdminOrdersDeps extends FulfilDeps, ThongBaoDeps {
  sql?: (env: Env) => ReturnType<typeof getSql>;
}

/** Hình dạng cho admin: mọi trường của khách cộng phần vận hành. */
function donJsonAdmin(don: DonHang & { tenant_name?: string }) {
  return {
    ...donJson(don),
    // Admin cần thấy checkoutUrl kể cả khi đơn không còn pending — để đối chiếu với PayOS.
    checkoutUrl: don.checkout_url,
    tenantId: don.tenant_id,
    tenantName: don.tenant_name ?? null,
    accountId: don.account_id,
    paymentLinkId: don.payment_link_id,
    fulfilAttempts: don.fulfil_attempts,
    entitlementReceipt: don.entitlement_receipt,
    note: don.note,
    updatedAt: new Date(don.updated_at).toISOString(),
  };
}

const suKienJson = (s: Awaited<ReturnType<typeof suKienCuaDon>>[number]) => ({
  id: s.id,
  orderId: s.order_id,
  provider: s.provider,
  reference: s.reference,
  orderCode: s.order_code,
  amountVnd: s.amount_vnd,
  signatureValid: s.signature_valid,
  tomTat: s.tom_tat,
  receivedAt: new Date(s.received_at).toISOString(),
});

async function docJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) throw new ApiError(413, 'payload_too_large', 'Thân quá lớn');
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const orderId = (raw: string): string => {
  if (!UUID.test(raw)) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
  return raw;
};

/**
 * Nhóm admin tối thiểu của pha 3 (spec 19; quyết định 0.3.5). Mount ở index.ts SAU
 * requireSameSiteGhi + requireBillingAccess cho cả `/v1/admin/orders*` và `/v1/admin/payment-events/*`:
 * mọi lệnh tiền đứng sau cổng billing, kể cả đọc.
 */
export function adminOrdersWith(deps: AdminOrdersDeps = {}) {
  const routes = new Hono<AppEnv>();

  async function voiSqlCua<T>(c: { env: Env; executionCtx: { waitUntil(p: Promise<unknown>): void } }, fn: (sql: ReturnType<typeof getSql>) => Promise<T>) {
    const sql = (deps.sql ?? getSql)(c.env);
    try {
      return await fn(sql);
    } finally {
      endSql(c.executionCtx, sql);
    }
  }
  const now = () => (deps.now ?? (() => new Date()))();

  // Hai đường tĩnh khai TRƯỚC `:id`.
  routes.get('/v1/admin/orders/summary', async (c) => {
    const tomTat = await voiSqlCua(c, (sql) => tomTatDon(sql, now()));
    return c.json(tomTat, 200, NO_STORE);
  });

  routes.get('/v1/admin/payment-events/unmatched', async (c) => {
    const limit = parseLimit(new URL(c.req.url).searchParams);
    const items = await voiSqlCua(c, (sql) => suKienKhongKhop(sql, limit));
    return c.json({ items: items.map(suKienJson) }, 200, NO_STORE);
  });

  routes.get('/v1/admin/orders', async (c) => {
    const q = new URL(c.req.url).searchParams;
    const statusRaw = q.get('status');
    if (statusRaw !== null && !TRANG_THAI.has(statusRaw as TrangThaiDon)) {
      throw new ApiError(400, 'invalid_request', 'status không hợp lệ');
    }
    const status = (statusRaw as TrangThaiDon | null) ?? null;
    const limit = parseLimit(q);
    let cursor: { createdAt: string; id: string } | null = null;
    const raw = q.get('cursor');
    if (raw !== null) {
      const [createdAt, id] = raw.split('|');
      if (!createdAt || !id || !CURSOR_TIME.test(createdAt) || !UUID.test(id)) {
        throw new ApiError(400, 'invalid_request', 'cursor phải có dạng <thời điểm ISO>|<uuid>');
      }
      cursor = { createdAt, id };
    }
    const rows = await voiSqlCua(c, (sql) => danhSachDonAdmin(sql, { status, limit, cursor }));
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return c.json(
      {
        items: page.map(({ cursor_at: _c, ...don }) => donJsonAdmin(don)),
        nextCursor: hasMore && last ? `${last.cursor_at}|${last.id}` : null,
      },
      200,
      NO_STORE,
    );
  });

  routes.get('/v1/admin/orders/:id', async (c) => {
    const id = orderId(c.req.param('id'));
    const kq = await voiSqlCua(c, async (sql) => {
      const don = await docDon(sql, id);
      if (!don) return null;
      const [events, owner] = await Promise.all([suKienCuaDon(sql, id), chuTenant(sql, don.tenant_id)]);
      return { don, events, owner };
    });
    if (!kq) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
    return c.json(
      {
        order: donJsonAdmin({ ...kq.don, ...(kq.owner ? { tenant_name: kq.owner.tenantName } : {}) }),
        events: kq.events.map(suKienJson),
        owner: kq.owner ? { email: kq.owner.email, billingEmail: kq.owner.billingEmail } : null,
      },
      200,
      NO_STORE,
    );
  });

  /** "Thử cấp lại": idempotent, kết quả hiện ngay (spec 13). Đi qua apDungThanhToan như mọi đường. */
  routes.post('/v1/admin/orders/:id/fulfil', async (c) => {
    const id = orderId(c.req.param('id'));
    const kq = await voiSqlCua(c, async (sql) => {
      const don = await docDon(sql, id);
      if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
      if (don.status !== 'paid' && don.status !== 'paid_unfulfilled') {
        throw new ApiError(409, 'order_not_fulfillable', 'Chỉ cấp lại đơn đã có tiền mà chưa vào sổ');
      }
      return await apDungThanhToan(sql, c.env, id, { ...deps, now });
    });
    thongBaoSauApDung(c.env, c.executionCtx, kq, { origin: new URL(c.req.url).origin, suKienMoi: false }, deps);
    audit(c, 'admin.order.fulfil', id, { order_code: kq.don.order_code, ket_qua: kq.trangThai, ...(kq.trangThai === 'paid_unfulfilled' ? { loi: kq.cap.status === 'paid_unfulfilled' ? kq.cap.error : null } : {}) });
    return c.json({ order: donJsonAdmin(kq.don), ketQua: kq.trangThai }, 200, NO_STORE);
  });

  /**
   * Xác nhận đã nhận tiền bằng tay (spec 13; quyết định 0.3.4). Dựng một sự kiện provider=manual với
   * reference = manual:<operationId> — UNIQUE sẵn có làm nó idempotent — rồi đi qua ĐÚNG
   * apDungThanhToan như webhook. Lý do và mã tham chiếu ngân hàng nằm cả trong payload lẫn audit.
   */
  routes.post('/v1/admin/orders/:id/confirm-manual', async (c) => {
    const id = orderId(c.req.param('id'));
    const body = await docJson(c.req.raw);
    const operationId = typeof body.operationId === 'string' && OPERATION_ID.test(body.operationId) ? body.operationId : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const bankReference = typeof body.bankReference === 'string' ? body.bankReference.trim().slice(0, 64) : '';
    if (!operationId || !reason || !bankReference) {
      throw new ApiError(400, 'invalid_confirm', 'Cần operationId, lý do và mã tham chiếu ngân hàng');
    }
    const soTienNhap = body.amountVnd === undefined ? null : Number(body.amountVnd);
    if (soTienNhap !== null && (!Number.isSafeInteger(soTienNhap) || soTienNhap <= 0)) {
      throw new ApiError(400, 'invalid_confirm', 'amountVnd phải là số nguyên dương');
    }

    const { kq, moi } = await voiSqlCua(c, async (sql) => {
      const don = await docDon(sql, id);
      if (!don) throw new ApiError(404, 'order_not_found', 'Không có đơn này');
      const daCo = await tongTienDaNhan(sql, don.id);
      const conThieu = Math.max(0, don.amount_vnd - daCo.tong);
      if (!['pending', 'underpaid', 'expired'].includes(don.status)) {
        // Cùng operationId gọi lại sau khi đã xong (bấm hai lần, mạng chập): trả trạng thái hiện
        // tại với moi:false, không lỗi. Một operationId LẠ trên đơn đã xong mới là 409.
        if (await daCoSuKien(sql, 'manual', `manual:${operationId}`)) {
          return { kq: { trangThai: 'khong_doi' as const, don }, moi: false };
        }
        throw new ApiError(409, 'order_not_confirmable', 'Chỉ xác nhận tay cho đơn pending, underpaid hoặc expired');
      }
      const amountVnd = soTienNhap ?? conThieu;
      if (amountVnd <= 0) throw new ApiError(409, 'order_not_confirmable', 'Đơn đã đủ tiền');
      const moi = await ghiSuKienThanhToan(sql, {
        orderId: don.id,
        provider: 'manual',
        reference: `manual:${operationId}`,
        orderCode: don.order_code,
        amountVnd,
        signatureValid: true,
        payload: { reason, bankReference, actor: c.get('reviewer') ?? '', amount: amountVnd },
      });
      const kq = await apDungThanhToan(sql, c.env, don.id, { ...deps, now });
      return { kq, moi };
    });

    thongBaoSauApDung(c.env, c.executionCtx, kq, { origin: new URL(c.req.url).origin, suKienMoi: moi }, deps);
    audit(c, 'admin.order.confirm_manual', id, { order_code: kq.don.order_code, operation_id: operationId, reason, bank_reference: bankReference, ket_qua: kq.trangThai, moi });
    return c.json({ order: donJsonAdmin(kq.don), ketQua: kq.trangThai, moi }, 200, NO_STORE);
  });

  return routes;
}

export const adminOrders = adminOrdersWith();
```

- [ ] **Step 4: Quyền và mount**

`apps/api/src/routes/admin.ts`, thêm vào `ALL_PERMISSIONS` sau `'audit.read'`:

```ts
  'orders.read',
  'orders.write',
```

`apps/api/src/index.ts`, ngay sau khối `adminQuotaSummary`:

```ts
// Đơn hàng và giao dịch: cùng lớp dữ liệu tiền như billing, chịu đúng hai cổng đó kể cả khi đọc.
for (const duong of ['/v1/admin/orders', '/v1/admin/orders/*', '/v1/admin/payment-events/*'] as const) {
  app.use(duong, requireSameSiteGhi());
  app.use(duong, requireBillingAccess());
}
app.route('/', adminOrders);
```

kèm import `{ adminOrders } from './routes/admin-orders'`.

- [ ] **Step 5: Chạy test, thấy xanh; cả bộ; typecheck**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin-orders.ts apps/api/src/routes/admin.ts apps/api/src/index.ts apps/api/test/admin-orders.test.ts
git commit -m "feat(api): admin đơn hàng tối thiểu — danh sách, chi tiết, thử cấp lại, xác nhận tay idempotent, giao dịch không khớp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Bộ kiểm chạy bằng role `api` thật cho hai bảng mới

**Files:**
- Create: `db/commerce-grant.dbtest.mjs`

- [ ] **Step 1: Viết bài kiểm — nguyên văn câu của `commerce/db.ts`**

```js
// Chạy: pnpm exec vitest run --config vitest.db.config.ts db/commerce-grant.dbtest.mjs
// (cần Postgres dev: pnpm db:up && pnpm db:migrate). Chỉ chạy trên DB local.
//
// Cùng lý do với console-grant.dbtest.mjs: harness nối DB bằng role chủ sở hữu nên thiếu GRANT
// vẫn xanh ở máy rồi đỏ trên production. Mỗi câu dưới đây là câu MÃ THẬT gửi đi (chép từ
// apps/api/src/commerce/db.ts), chạy dưới `SET ROLE api`, cộng các câu PHẢI bị từ chối.
import 'dotenv/config';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../scripts/lib/migrations.mjs';

const url = databaseUrlFromEnv(process.env);
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
  throw new Error(`dbtest chỉ chạy trên DB local, không phải ${host}`);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });

const TENANT = 'Kiểm GRANT đơn hàng';
const EMAIL = 'kiem-grant-don-hang@vidu.vn';
let tenantId;
let accountId;
let orderId;

async function duoiRoleApi(fn) {
  await sql.unsafe('SET ROLE api');
  try {
    return await fn();
  } finally {
    await sql.unsafe('RESET ROLE');
  }
}

const COT_DON = `id, order_code::int AS order_code, tenant_id, account_id, kind, tier, months,
  quota_group, packs, amount_vnd::int AS amount_vnd, amount_usd_cents, status, provider,
  payment_link_id, checkout_url, qr_code, link_expires_at, paid_at,
  paid_amount_vnd::int AS paid_amount_vnd, fulfilled_at, fulfil_attempts, fulfil_error,
  entitlement_receipt, note, created_at, updated_at`;

describe('GRANT của migration 0023 dưới role api', () => {
  beforeAll(async () => {
    await sql`DELETE FROM payment_event WHERE order_id IN (SELECT id FROM customer_order WHERE tenant_id IN (SELECT id FROM tenant WHERE name = ${TENANT}))`;
    await sql`DELETE FROM payment_event WHERE reference LIKE 'kiem-grant:%'`;
    await sql`DELETE FROM customer_order WHERE tenant_id IN (SELECT id FROM tenant WHERE name = ${TENANT})`;
    await sql`DELETE FROM tenant_member WHERE tenant_id IN (SELECT id FROM tenant WHERE name = ${TENANT})`;
    await sql`DELETE FROM customer_account WHERE email = ${EMAIL}`;
    await sql`DELETE FROM tenant WHERE name = ${TENANT}`;
    [{ id: tenantId }] = await sql`INSERT INTO tenant (name, plan, quota_mode) VALUES (${TENANT}, 'free', 'commercial') RETURNING id`;
    [{ id: accountId }] = await sql`INSERT INTO customer_account (email) VALUES (${EMAIL}) RETURNING id`;
    await sql`INSERT INTO tenant_member (tenant_id, account_id, role) VALUES (${tenantId}::uuid, ${accountId}::uuid, 'owner')`;
  });

  afterAll(async () => {
    await sql`DELETE FROM payment_event WHERE order_id IN (SELECT id FROM customer_order WHERE tenant_id = ${tenantId}::uuid)`;
    await sql`DELETE FROM payment_event WHERE reference LIKE 'kiem-grant:%'`;
    await sql`DELETE FROM customer_order WHERE tenant_id = ${tenantId}::uuid`;
    await sql`DELETE FROM tenant_member WHERE tenant_id = ${tenantId}::uuid`;
    await sql`DELETE FROM customer_account WHERE id = ${accountId}::uuid`;
    await sql`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
    await sql.end({ timeout: 5 });
  });

  it('taoDon: INSERT … RETURNING chạy được, order_code bắt đầu từ 100001', async () => {
    const [don] = await duoiRoleApi(() => sql.unsafe(
      `INSERT INTO customer_order (tenant_id, account_id, kind, tier, months, quota_group, packs, amount_vnd, amount_usd_cents, status)
       VALUES ($1::uuid, $2::uuid, 'plan', 'starter', 3, NULL, NULL, 1950000, 7500, 'pending') RETURNING ${COT_DON}`,
      [tenantId, accountId],
    ));
    orderId = don.id;
    expect(don.order_code).toBeGreaterThanOrEqual(100001);
    expect(typeof don.order_code).toBe('number');
    expect(don.amount_vnd).toBe(1950000);
  });

  it('các câu đọc của khách, cron và admin chạy được', async () => {
    await duoiRoleApi(async () => {
      expect(await sql.unsafe(`SELECT ${COT_DON} FROM customer_order WHERE tenant_id = $1::uuid AND id = $2::uuid`, [tenantId, orderId])).toHaveLength(1);
      expect(await sql`SELECT count(*)::int AS n FROM customer_order WHERE tenant_id = ${tenantId}::uuid AND status = 'pending'`).toEqual([{ n: 1 }]);
      await sql.unsafe(`SELECT ${COT_DON} FROM customer_order WHERE status IN ('paid', 'paid_unfulfilled') AND fulfil_attempts < 20 ORDER BY updated_at ASC LIMIT 20`);
      await sql.unsafe(`SELECT ${COT_DON} FROM customer_order WHERE status = 'pending' AND payment_link_id IS NOT NULL AND created_at < now() - interval '10 minutes' AND link_expires_at > now() ORDER BY created_at ASC LIMIT 30`);
      await sql`SELECT o.id, t.name AS tenant_name, to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM customer_order o JOIN tenant t ON t.id = o.tenant_id ORDER BY o.created_at DESC, o.id DESC LIMIT 26`;
      await sql`SELECT (SELECT count(*)::int FROM customer_order WHERE status IN ('paid_unfulfilled', 'underpaid')) AS cho_xu_ly, (SELECT coalesce(sum(paid_amount_vnd), 0)::int FROM customer_order WHERE status = 'fulfilled' AND paid_at >= now() - interval '30 days') AS doanh_thu`;
      await sql`SELECT a.email, t.billing_email, t.name FROM tenant t JOIN tenant_member m ON m.tenant_id = t.id AND m.role = 'owner' JOIN customer_account a ON a.id = m.account_id WHERE t.id = ${tenantId}::uuid ORDER BY m.created_at LIMIT 1`;
      await sql`SELECT t.id, t.name, a.email FROM tenant t JOIN tenant_member m ON m.tenant_id = t.id AND m.role = 'owner' JOIN customer_account a ON a.id = m.account_id AND a.disabled_at IS NULL WHERE t.quota_mode = 'commercial' ORDER BY t.created_at LIMIT 200`;
    });
  });

  it('mọi UPDATE của máy trạng thái chạy được, theo đúng thứ tự pending → paid → fulfilled', async () => {
    await duoiRoleApi(async () => {
      await sql`UPDATE customer_order SET payment_link_id = 'l', checkout_url = 'u', qr_code = NULL, link_expires_at = now() + interval '1 day', updated_at = now() WHERE id = ${orderId}::uuid AND status = 'pending'`;
      expect(await sql`UPDATE customer_order SET status = 'paid', paid_amount_vnd = 1950000, paid_at = now(), updated_at = now() WHERE id = ${orderId}::uuid AND status IN ('pending', 'underpaid', 'expired', 'cancelled') RETURNING id`).toHaveLength(1);
      await sql`UPDATE customer_order SET status = 'paid_unfulfilled', fulfil_attempts = fulfil_attempts + 1, fulfil_error = 'thu', updated_at = now() WHERE id = ${orderId}::uuid AND status IN ('paid', 'paid_unfulfilled')`;
      expect(await sql`UPDATE customer_order SET status = 'fulfilled', fulfilled_at = now(), entitlement_receipt = ${sql.json({ revision: 1 })}, fulfil_error = NULL, updated_at = now() WHERE id = ${orderId}::uuid AND status IN ('paid', 'paid_unfulfilled') RETURNING id`).toHaveLength(1);
      // Các câu còn lại không đổi dòng (trạng thái không khớp) nhưng phải KHÔNG bị từ chối quyền.
      await sql`UPDATE customer_order SET status = 'underpaid', paid_amount_vnd = 1, updated_at = now() WHERE id = ${orderId}::uuid AND status IN ('pending', 'underpaid') RETURNING id`;
      await sql`UPDATE customer_order SET status = 'expired', updated_at = now() WHERE id = ${orderId}::uuid AND status = 'pending' RETURNING id`;
      await sql`UPDATE customer_order SET status = 'cancelled', updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${orderId}::uuid AND status = 'pending' RETURNING id`;
    });
  });

  it('payment_event: INSERT … ON CONFLICT DO NOTHING RETURNING id — lần hai trả rỗng; sum và exists chạy được', async () => {
    await duoiRoleApi(async () => {
      const chen = () => sql`INSERT INTO payment_event (order_id, provider, reference, order_code, amount_vnd, signature_valid, payload)
        VALUES (${orderId}::uuid, 'payos', 'kiem-grant:FT1', 100001, 1950000, true, ${sql.json({ code: '00' })})
        ON CONFLICT (provider, reference) DO NOTHING RETURNING id`;
      expect(await chen()).toHaveLength(1);
      expect(await chen()).toHaveLength(0);
      const [tong] = await sql`SELECT coalesce(sum(amount_vnd), 0)::int AS tong, (array_agg(reference ORDER BY id))[1] AS tham_chieu, min(received_at) AS luc FROM payment_event WHERE order_id = ${orderId}::uuid AND signature_valid AND amount_vnd IS NOT NULL`;
      expect(tong.tong).toBe(1950000);
      expect(tong.tham_chieu).toBe('kiem-grant:FT1');
      await sql`SELECT EXISTS(SELECT 1 FROM payment_event WHERE order_id = ${orderId}::uuid AND signature_valid AND amount_vnd IS NOT NULL) AS co`;
      await sql`SELECT EXISTS(SELECT 1 FROM payment_event WHERE provider = 'manual' AND reference = 'manual:x') AS co`;
      await sql`SELECT id::int AS id, order_id, provider, reference, order_code::int AS order_code, amount_vnd::int AS amount_vnd, signature_valid, jsonb_build_object('code', payload->'code') AS tom_tat, received_at FROM payment_event WHERE order_id IS NULL ORDER BY received_at DESC LIMIT 50`;
    });
  });

  it('cột giá và nội dung đơn KHÔNG sửa được; không xoá được đơn hay sự kiện', async () => {
    await duoiRoleApi(async () => {
      for (const cau of [
        sql`UPDATE customer_order SET amount_vnd = 1 WHERE id = ${orderId}::uuid`,
        sql`UPDATE customer_order SET tenant_id = ${tenantId}::uuid WHERE id = ${orderId}::uuid`,
        sql`UPDATE customer_order SET tier = 'business' WHERE id = ${orderId}::uuid`,
        sql`DELETE FROM customer_order WHERE id = ${orderId}::uuid`,
        sql`UPDATE payment_event SET amount_vnd = 1 WHERE reference = 'kiem-grant:FT1'`,
        sql`DELETE FROM payment_event WHERE reference = 'kiem-grant:FT1'`,
      ]) {
        await expect(cau).rejects.toMatchObject({ code: '42501' });
      }
    });
  });
});
```

- [ ] **Step 2: Chạy**

Run: `pnpm exec vitest run --config vitest.db.config.ts db/commerce-grant.dbtest.mjs`
Expected: PASS 5 test. Bài cuối phải thấy đúng mã `42501` (insufficient_privilege) ở cả sáu câu.

- [ ] **Step 3: Commit**

```bash
git add db/commerce-grant.dbtest.mjs
git commit -m "test(db): mọi câu của commerce/db.ts chạy dưới role api; cột giá và DELETE bị từ chối

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Harness — PayOS giả, script bắn webhook, cron gọi tay

**Files:**
- Create: `scripts/lib/payos-fake.mjs`, `scripts/lib/payos-fake.test.mjs`, `scripts/pay-fake-webhook.mjs`
- Modify: `scripts/api-db-test.mjs`, `package.json` (script `pay:fake-webhook`)

PayOS không có sandbox (mục 0.1), nên bản giả này là môi trường kiểm thử duy nhất ngoài tiền
thật. Nó phải **ký bằng đúng thuật toán** để chữ ký của ta được kiểm thật sự chứ không phải kiểm
với một bản giả dễ tính.

- [ ] **Step 1: Viết test đỏ cho phần ký của bản giả**

`scripts/lib/payos-fake.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { chuoiKyDuLieu, dungWebhook, kyDuLieu, kyTaoLink } from './payos-fake.mjs';

const KHOA = 'kiem-thu-checksum-key';

describe('payos-fake ký như PayOS thật (cùng vector với apps/api/test/commerce-chu-ky.test.ts)', () => {
  it('kyTaoLink khớp vector', () => {
    expect(
      kyTaoLink(
        {
          amount: 1950000,
          cancelUrl: 'https://api.test/console/don-hang/11111111-1111-4111-8111-111111111111?ket-qua=huy',
          description: 'MLV100001',
          orderCode: 100001,
          returnUrl: 'https://api.test/console/don-hang/11111111-1111-4111-8111-111111111111?ket-qua=thanh-cong',
        },
        KHOA,
      ),
    ).toBe('b3a5e4052d63e72368197aed9cc3e6d39c525ea6ec530c864b8564eeeb9d4f37');
  });

  it('kyDuLieu khớp vector webhook', () => {
    const data = {
      orderCode: 100001, amount: 1950000, description: 'MLV100001', accountNumber: '0123456789',
      reference: 'FT26262ABC123', transactionDateTime: '2026-09-19 10:15:00', currency: 'VND',
      paymentLinkId: '8f3e2c1d9a7b4c6e8d0f1a2b3c4d5e6f', code: '00', desc: 'Thành công',
      counterAccountBankId: '', counterAccountBankName: '', counterAccountName: null,
      counterAccountNumber: null, virtualAccountName: '', virtualAccountNumber: '',
    };
    expect(chuoiKyDuLieu(data)).toContain('counterAccountName=&');
    expect(kyDuLieu(data, KHOA)).toBe('993354446fbecee7a023e91e61e11b6584a473fa883e1a91c6fb5d4d44c2a754');
  });

  it('dungWebhook trả thân đầy đủ có chữ ký khớp data', () => {
    const than = dungWebhook({ orderCode: 100001, amount: 650000, reference: 'FT1' }, KHOA);
    expect(than.code).toBe('00');
    expect(than.data.orderCode).toBe(100001);
    expect(than.data.description).toBe('MLV100001');
    expect(than.signature).toBe(kyDuLieu(than.data, KHOA));
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run scripts/lib/payos-fake.test.mjs`

- [ ] **Step 3: Viết `scripts/lib/payos-fake.mjs`**

```js
// PayOS giả cho harness itest/E2E. KHÔNG dùng cho production.
//
// Vì sao tồn tại: PayOS không có sandbox (tài liệu chính thức), nên đây là nơi duy nhất kiểm được
// đường "tạo link → khách trả → webhook → cấp gói" mà không mất tiền thật. Ký bằng đúng thuật toán
// của SDK chính thức (cùng vector với apps/api/test/commerce-chu-ky.test.ts) để chữ ký phía API
// được kiểm thật.
//
// Đường mô phỏng: POST /__fake/pay/:orderCode đánh dấu ĐÃ TRẢ (tuỳ chọn số tiền khác giá) và trả
// về thân webhook đã ký; kèm { webhookUrl } thì tự bắn webhook tới đó.
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

export const PAYOS_FAKE_PORT = 8791;
export const FAKE_CLIENT_ID = 'fake-client-id';
export const FAKE_API_KEY = 'fake-api-key';
export const FAKE_CHECKSUM = 'fake-checksum-key-itest';

/** @param {Record<string, unknown>} o */
const sapXep = (o) =>
  Object.keys(o ?? {}).sort().reduce((a, k) => { a[k] = /** @type {Record<string, unknown>} */ (o)[k]; return a; }, /** @type {Record<string, unknown>} */ ({}));

/** Đúng convertObjToQueryStr(sortObjDataByKey(data)) của @payos/node@2.0.5.
 * @param {Record<string, unknown>} data */
export function chuoiKyDuLieu(data) {
  return Object.keys(data).sort().filter((k) => data[k] !== undefined).map((k) => {
    let v = data[k];
    if (Array.isArray(v)) v = JSON.stringify(v.map((x) => sapXep(/** @type {Record<string, unknown>} */ (x))));
    if (v === null || v === undefined || v === 'undefined' || v === 'null') v = '';
    return `${k}=${String(v)}`;
  }).join('&');
}

/** @param {Record<string, unknown>} data @param {string} khoa */
export const kyDuLieu = (data, khoa) => createHmac('sha256', khoa).update(chuoiKyDuLieu(data)).digest('hex');

/** @param {{amount:number,cancelUrl:string,description:string,orderCode:number,returnUrl:string}} i @param {string} khoa */
export const kyTaoLink = (i, khoa) =>
  createHmac('sha256', khoa)
    .update(`amount=${i.amount}&cancelUrl=${i.cancelUrl}&description=${i.description}&orderCode=${i.orderCode}&returnUrl=${i.returnUrl}`)
    .digest('hex');

/** Thân webhook như PayOS gửi, ký bằng `khoa`.
 * @param {{orderCode:number,amount:number,reference:string,code?:string,paymentLinkId?:string}} g @param {string} khoa */
export function dungWebhook(g, khoa) {
  const data = {
    orderCode: g.orderCode,
    amount: g.amount,
    description: `MLV${g.orderCode}`,
    accountNumber: '0123456789',
    reference: g.reference,
    transactionDateTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
    currency: 'VND',
    paymentLinkId: g.paymentLinkId ?? `fake-${g.orderCode}`,
    code: g.code ?? '00',
    desc: g.code && g.code !== '00' ? 'Thất bại' : 'Thành công',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: null,
    counterAccountNumber: null,
    virtualAccountName: '',
    virtualAccountNumber: '',
  };
  return { code: '00', desc: 'success', success: true, data, signature: kyDuLieu(data, khoa) };
}

/** @param {import('node:http').IncomingMessage} req */
const docThan = (req) => new Promise((resolve) => {
  let t = '';
  req.on('data', (c) => { t += c; });
  req.on('end', () => { try { resolve(JSON.parse(t || '{}')); } catch { resolve({}); } });
});

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} body */
const traJson = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

/** @param {Record<string, unknown>} data @param {string} khoa */
const traKy = (res, data, khoa, code = '00', desc = 'success') => traJson(res, 200, { code, desc, data, signature: kyDuLieu(data, khoa) });

/**
 * @param {number} [port] @param {string} [khoa]
 * @returns {Promise<import('node:http').Server>}
 */
export function startPayosFake(port = PAYOS_FAKE_PORT, khoa = FAKE_CHECKSUM) {
  /** @type {Map<number, {id:string,orderCode:number,amount:number,amountPaid:number,status:string,transactions:object[],createdAt:string}>} */
  const links = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const p = url.pathname;
    if (p === '/healthz') return traJson(res, 200, { ok: true });

    // Mô phỏng khách trả tiền — ngoài API PayOS thật.
    const tra = p.match(/^\/__fake\/pay\/(\d+)$/);
    if (tra && req.method === 'POST') {
      const orderCode = Number(tra[1]);
      const than = /** @type {{amount?:number,reference?:string,webhookUrl?:string,code?:string}} */ (await docThan(req));
      const link = links.get(orderCode);
      const amount = than.amount ?? link?.amount ?? 0;
      const reference = than.reference ?? `FT${Date.now()}`;
      if (link) {
        link.amountPaid += amount;
        link.status = link.amountPaid >= link.amount ? 'PAID' : 'PENDING';
        link.transactions.push({ reference, amount, transactionDateTime: new Date().toISOString() });
      }
      const webhook = dungWebhook({ orderCode, amount, reference, paymentLinkId: link?.id, ...(than.code ? { code: than.code } : {}) }, khoa);
      if (than.webhookUrl) {
        const r = await fetch(than.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(webhook) });
        return traJson(res, 200, { webhookStatus: r.status, webhookBody: await r.json().catch(() => null), webhook });
      }
      return traJson(res, 200, { webhook });
    }

    // API PayOS thật — kiểm header như thật.
    if (req.headers['x-client-id'] !== FAKE_CLIENT_ID || req.headers['x-api-key'] !== FAKE_API_KEY) {
      return traJson(res, 401, { code: '401', desc: 'Unauthorized' });
    }
    if (p === '/v2/payment-requests' && req.method === 'POST') {
      const b = /** @type {Record<string, any>} */ (await docThan(req));
      const kyDung = kyTaoLink({ amount: b.amount, cancelUrl: b.cancelUrl, description: b.description, orderCode: b.orderCode, returnUrl: b.returnUrl }, khoa);
      if (b.signature !== kyDung) return traJson(res, 200, { code: '20', desc: 'Mã kiểm tra(signature) không hợp lệ', data: null });
      if (String(b.description ?? '').length > 9) return traJson(res, 200, { code: '21', desc: 'description tối đa 9 ký tự', data: null });
      if (links.has(b.orderCode)) return traJson(res, 200, { code: '231', desc: 'Đơn thanh toán đã tồn tại', data: null });
      const id = `fake-${b.orderCode}`;
      links.set(b.orderCode, { id, orderCode: b.orderCode, amount: b.amount, amountPaid: 0, status: 'PENDING', transactions: [], createdAt: new Date().toISOString() });
      return traKy(res, {
        bin: '970422', accountNumber: '0123456789', accountName: 'FAKE PAYOS', amount: b.amount, description: b.description,
        orderCode: b.orderCode, currency: 'VND', paymentLinkId: id, status: 'PENDING',
        checkoutUrl: `http://127.0.0.1:${port}/web/${id}`, qrCode: `000201FAKEQR${b.orderCode}`,
      }, khoa);
    }
    const m = p.match(/^\/v2\/payment-requests\/([^/]+)(\/cancel)?$/);
    if (m) {
      const link = [...links.values()].find((l) => String(l.orderCode) === m[1] || l.id === m[1]);
      if (!link) return traJson(res, 200, { code: '101', desc: 'Mã thanh toán không tồn tại', data: null });
      if (m[2] && req.method === 'POST') {
        const b = /** @type {{cancellationReason?:string}} */ (await docThan(req));
        link.status = 'CANCELLED';
        return traKy(res, { id: link.id, orderCode: link.orderCode, amount: link.amount, amountPaid: link.amountPaid, amountRemaining: link.amount - link.amountPaid, status: link.status, createdAt: link.createdAt, canceledAt: new Date().toISOString(), cancellationReason: b.cancellationReason ?? '', transactions: link.transactions }, khoa);
      }
      return traKy(res, { id: link.id, orderCode: link.orderCode, amount: link.amount, amountPaid: link.amountPaid, amountRemaining: link.amount - link.amountPaid, status: link.status, createdAt: link.createdAt, transactions: link.transactions }, khoa);
    }
    traJson(res, 404, { code: '404', desc: 'not found' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// Tiến trình RIÊNG như access-fake: harness chạy vitest bằng spawnSync, chặn event loop của nó.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await startPayosFake();
  console.log(`payos-fake: http://127.0.0.1:${PAYOS_FAKE_PORT}`);
}
```

- [ ] **Step 4: Viết `scripts/pay-fake-webhook.mjs`**

```js
#!/usr/bin/env node
// Ký và bắn một webhook PayOS giả vào API (spec 17). Dùng cho harness và cho kiểm tra tay.
//
//   node scripts/pay-fake-webhook.mjs --order-code 100001 --amount 650000 [--reference FT1]
//        [--code 00] [--base http://127.0.0.1:8799] [--key <checksum>]
//
// Khoá lấy từ --key, rồi PAYOS_CHECKSUM_KEY trong env, rồi FAKE_CHECKSUM của harness. KHÔNG bao
// giờ trỏ --base vào production bằng khoá thật: đó là tự tạo một giao dịch giả trên hệ thống thật.
import { dungWebhook, FAKE_CHECKSUM } from './lib/payos-fake.mjs';

/** @param {string} name @param {string} [macDinh] */
const arg = (name, macDinh) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : macDinh;
};

const base = (arg('base', 'http://127.0.0.1:8799') ?? '').replace(/\/+$/, '');
if (/ai-solutions\.io\.vn/.test(base)) {
  console.error('Từ chối: script này không bắn vào production.');
  process.exit(2);
}
const orderCode = Number(arg('order-code'));
const amount = Number(arg('amount'));
if (!Number.isInteger(orderCode) || !Number.isInteger(amount)) {
  console.error('Cần --order-code và --amount là số nguyên');
  process.exit(2);
}
const khoa = arg('key') ?? process.env.PAYOS_CHECKSUM_KEY ?? FAKE_CHECKSUM;
const than = dungWebhook(
  { orderCode, amount, reference: arg('reference', `FT${Date.now()}`) ?? '', code: arg('code', '00') },
  khoa,
);
const res = await fetch(`${base}/v1/pay/payos/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(than),
});
console.log(`${res.status} ${await res.text()}`);
process.exitCode = res.ok ? 0 : 1;
```

Thêm vào `package.json` gốc: `"pay:fake-webhook": "node scripts/pay-fake-webhook.mjs"`.

- [ ] **Step 5: Sửa `scripts/api-db-test.mjs`**

Sau khối khởi động `certsProc` (dòng "Access giả lập: …"), thêm:

```js
import { FAKE_API_KEY, FAKE_CHECKSUM, FAKE_CLIENT_ID, PAYOS_FAKE_PORT } from './lib/payos-fake.mjs';
// (import đặt ở đầu file cùng các import khác)

// PayOS giả — tiến trình riêng, cùng lý do với access-fake.
const payosProc = spawn(process.execPath, ['scripts/lib/payos-fake.mjs'], { stdio: 'inherit' });
await new Promise((resolve, reject) => {
  const deadline = Date.now() + 15_000;
  const tick = async () => {
    if (payosProc.exitCode !== null) return reject(new Error('payos-fake thoát sớm'));
    try {
      if ((await fetch(`http://127.0.0.1:${PAYOS_FAKE_PORT}/healthz`)).ok) return resolve(undefined);
    } catch {}
    if (Date.now() > deadline) return reject(new Error('payos-fake không lên trong 15 giây'));
    setTimeout(tick, 250);
  };
  void tick();
});
console.log(`PayOS giả lập: http://127.0.0.1:${PAYOS_FAKE_PORT}`);
```

Trong mảng tham số `wrangler dev`, thêm sau `--var SESSION_PEPPER…`:

```js
    // Nhóm đơn hàng: ba khoá GIẢ và gốc trỏ về payos-fake; CONSOLE_ORIGIN để thư cron có link.
    // `--test-scheduled` mở /__scheduled?cron=… cho itest gọi cron tay.
    '--var', `PAYOS_CLIENT_ID:${FAKE_CLIENT_ID}`,
    '--var', `PAYOS_API_KEY:${FAKE_API_KEY}`,
    '--var', `PAYOS_CHECKSUM_KEY:${FAKE_CHECKSUM}`,
    '--var', `PAYOS_BASE:http://127.0.0.1:${PAYOS_FAKE_PORT}`,
    '--var', `PAYOS_CHECKOUT_BASE:http://127.0.0.1:${PAYOS_FAKE_PORT}`,
    '--var', `CONSOLE_ORIGIN:http://127.0.0.1:${PORT}`,
    '--test-scheduled',
```

Trong `stopWrangler`, đổi `for (const child of [wrangler, certsProc])` thành
`for (const child of [wrangler, certsProc, payosProc])`.

Và truyền cho vitest itest: thêm `PAYOS_CHECKSUM_KEY: FAKE_CHECKSUM` vào object env của
`run('pnpm', ['exec', 'vitest', …])`.

- [ ] **Step 6: Chạy test bản giả và typecheck scripts**

Run: `pnpm exec vitest run scripts/lib/payos-fake.test.mjs && pnpm typecheck`
Expected: PASS 3 test; `tsc -p tsconfig.scripts.json` sạch (`checkJs` kiểm JSDoc của hai file mới).

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/payos-fake.mjs scripts/lib/payos-fake.test.mjs scripts/pay-fake-webhook.mjs scripts/api-db-test.mjs package.json
git commit -m "test(harness): PayOS giả ký đúng thuật toán, script bắn webhook, cron gọi tay qua --test-scheduled

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: itest trên harness — trọn chặng với Postgres thật, sổ quota thật, PayOS giả

**Files:**
- Create: `apps/api/test-db/commerce.itest.mjs`

- [ ] **Step 1: Viết bài kiểm**

```js
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';
import { dungWebhook, FAKE_CHECKSUM, PAYOS_FAKE_PORT } from '../../../scripts/lib/payos-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const payosFake = `http://127.0.0.1:${PAYOS_FAKE_PORT}`;
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path, init = {}) =>
  fetch(base + path, { ...init, headers: { 'Cf-Access-Jwt-Assertion': jwt, 'Sec-Fetch-Site': 'same-origin', ...(init.headers ?? {}) } });

/** Đăng ký một khách mới qua đúng đường của console, trả về cookie phiên. */
async function dangKy(ten) {
  const email = `don-${Date.now()}-${Math.floor(Math.random() * 1e6)}@vidu.vn`;
  const xin = await fetch(`${base}/v1/console/auth/otp/request`, { method: 'POST', headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ email, turnstileToken: '' }) });
  const ma = xin.headers.get('x-debug-otp');
  const xac = await fetch(`${base}/v1/console/auth/otp/verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ email, code: ma }) });
  const cookie = (xac.headers.get('set-cookie') ?? '').split(';')[0];
  const khach = (path, init = {}) => fetch(base + path, { ...init, headers: { cookie, 'Sec-Fetch-Site': 'same-origin', 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const tao = await khach('/v1/console/tenant', { method: 'POST', body: JSON.stringify({ name: ten }) });
  const { tenant } = await tao.json();
  return { email, khach, tenantId: tenant.id };
}

const webhook = (than) => fetch(`${base}/v1/pay/payos/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(than) });
const cron = (bieuThuc) => fetch(`${base}/__scheduled?cron=${encodeURIComponent(bieuThuc)}`);

/** admin_audit ghi trong waitUntil nên có thể tới sau phản hồi. */
async function doiAudit(action, target) {
  for (let i = 0; i < 20; i += 1) {
    const rows = await sql`SELECT detail FROM admin_audit WHERE action = ${action} AND target = ${target}`;
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

describe('đơn hàng — trọn chặng', () => {
  it('khách mua Starter 3 tháng: link từ PayOS giả, webhook → fulfilled trong một request, sổ có kỳ đúng 3 tháng, bắn lại không cấp hai lần', async () => {
    const { khach, tenantId } = await dangKy('Công ty Mua Gói');

    const baoGia = await (await khach('/v1/console/orders/quote?kind=plan&tier=starter&months=3')).json();
    expect(baoGia.amountVnd).toBe(1_950_000);

    const tao = await khach('/v1/console/orders', { method: 'POST', body: JSON.stringify({ kind: 'plan', tier: 'starter', months: 3, amount: 1 }) });
    expect(tao.status).toBe(201);
    const { order } = await tao.json();
    expect(order).toMatchObject({ status: 'pending', amountVnd: 1_950_000, noiDungChuyenKhoan: `MLV${order.orderCode}` });
    expect(order.checkoutUrl).toContain(`/web/fake-${order.orderCode}`);
    expect(order.qrCode).toContain('FAKEQR');

    // Khách "chuyển khoản": PayOS giả đánh dấu đã trả và bắn webhook vào API.
    const tra = await (await fetch(`${payosFake}/__fake/pay/${order.orderCode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webhookUrl: `${base}/v1/pay/payos/webhook`, reference: `FT-${order.orderCode}` }) })).json();
    expect(tra.webhookStatus).toBe(200);
    expect(tra.webhookBody).toMatchObject({ matched: true, duplicate: false, status: 'fulfilled' });

    const sau = await (await khach(`/v1/console/orders/${order.id}`)).json();
    expect(sau.order.status).toBe('fulfilled');
    expect(sau.order.paidAmountVnd).toBe(1_950_000);
    expect(sau.order.qrCode).toBeNull();

    // Sổ quota thật: đúng một kỳ Starter, dài 3 tháng, mang lineItemId = id đơn.
    const usage = await (await khach('/v1/console/usage')).json();
    expect(usage).toMatchObject({ status: 'active', tier: 'starter' });
    const lichSu = await (await adminFetch(`/v1/admin/billing/${tenantId}/periods`)).json();
    const kyMua = lichSu.periods.filter((p) => p.lineItemId === order.id);
    expect(kyMua).toHaveLength(1);
    const dai = (Date.parse(kyMua[0].endsAt) - Date.parse(kyMua[0].startsAt)) / 86_400_000;
    expect(dai).toBeGreaterThanOrEqual(89);
    expect(dai).toBeLessThanOrEqual(92);
    expect(kyMua[0].paymentReference).toBe(`FT-${order.orderCode}`);

    // Tiêu chí 20.6: bắn lại đúng webhook → 200, không có kỳ thứ hai, payment_event không thêm dòng.
    const lai = await webhook(tra.webhook);
    expect(lai.status).toBe(200);
    expect(await lai.json()).toMatchObject({ duplicate: true });
    const lichSu2 = await (await adminFetch(`/v1/admin/billing/${tenantId}/periods`)).json();
    expect(lichSu2.periods.filter((p) => p.lineItemId === order.id)).toHaveLength(1);
    expect(await sql`SELECT count(*)::int AS n FROM payment_event WHERE order_id = ${order.id}::uuid`).toEqual([{ n: 1 }]);

    const audit = await doiAudit('order.fulfilled', order.id);
    expect(audit).toHaveLength(1);
    expect(await doiAudit('order.paid', order.id)).toHaveLength(1);
  });

  it('sai chữ ký → 400, ghi sự kiện không khớp, đơn đứng im; admin thấy ở unmatched', async () => {
    const { khach } = await dangKy('Công ty Chữ Ký');
    const { order } = await (await khach('/v1/console/orders', { method: 'POST', body: JSON.stringify({ kind: 'plan', tier: 'starter', months: 1 }) })).json();
    const gia = dungWebhook({ orderCode: order.orderCode, amount: 650_000, reference: 'FT-GIA' }, 'khoa-sai');
    expect((await webhook(gia)).status).toBe(400);
    expect((await (await khach(`/v1/console/orders/${order.id}`)).json()).order.status).toBe('pending');
    const um = await (await adminFetch('/v1/admin/payment-events/unmatched')).json();
    expect(um.items.some((s) => s.signatureValid === false && s.reference.startsWith('invalid:'))).toBe(true);
  });

  it('chuyển thiếu → underpaid; admin xác nhận tay phần còn thiếu → fulfilled; cùng operationId lần hai không thêm sự kiện', async () => {
    const { khach } = await dangKy('Công ty Thiếu Tiền');
    const { order } = await (await khach('/v1/console/orders', { method: 'POST', body: JSON.stringify({ kind: 'plan', tier: 'starter', months: 1 }) })).json();
    const thieu = await webhook(dungWebhook({ orderCode: order.orderCode, amount: 600_000, reference: `FT-THIEU-${order.orderCode}` }, FAKE_CHECKSUM));
    expect(await thieu.json()).toMatchObject({ status: 'underpaid' });
    expect((await (await khach(`/v1/console/orders/${order.id}`)).json()).order).toMatchObject({ status: 'underpaid', paidAmountVnd: 600_000 });

    const than = { operationId: `op-${order.orderCode}`, reason: 'Thấy 50.000 trong sao kê', bankReference: 'FT-TAY' };
    const xacNhan = await adminFetch(`/v1/admin/orders/${order.id}/confirm-manual`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(than) });
    expect(xacNhan.status).toBe(200);
    expect(await xacNhan.json()).toMatchObject({ ketQua: 'fulfilled', moi: true });
    const lai = await adminFetch(`/v1/admin/orders/${order.id}/confirm-manual`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(than) });
    expect(await lai.json()).toMatchObject({ moi: false });
    expect(await sql`SELECT provider, amount_vnd::int AS a FROM payment_event WHERE order_id = ${order.id}::uuid ORDER BY id`).toEqual([{ provider: 'payos', a: 600_000 }, { provider: 'manual', a: 50_000 }]);
    const audit = await doiAudit('admin.order.confirm_manual', order.id);
    expect(audit[0].detail.bank_reference).toBe('FT-TAY');
  });

  it('webhook rơi: cron đối soát hỏi PayOS giả, thấy PAID, tự dựng sự kiện và cấp (tiêu chí 20.7)', async () => {
    const { khach } = await dangKy('Công ty Webhook Rơi');
    const { order } = await (await khach('/v1/console/orders', { method: 'POST', body: JSON.stringify({ kind: 'plan', tier: 'starter', months: 1 }) })).json();
    // Trả ở PayOS giả nhưng KHÔNG bắn webhook.
    await fetch(`${payosFake}/__fake/pay/${order.orderCode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference: `FT-ROI-${order.orderCode}` }) });
    // Đơn phải "tạo quá 10 phút" mới được đối soát: lùi created_at bằng role chủ sở hữu.
    await sql`UPDATE customer_order SET created_at = now() - interval '11 minutes' WHERE id = ${order.id}::uuid`;
    expect((await cron('*/5 * * * *')).ok).toBe(true);
    expect((await (await khach(`/v1/console/orders/${order.id}`)).json()).order.status).toBe('fulfilled');
    expect(await sql`SELECT reference FROM payment_event WHERE order_id = ${order.id}::uuid`).toEqual([{ reference: `FT-ROI-${order.orderCode}` }]);
  });

  it('đơn pending quá hạn link → cron chuyển expired; tiền vào sau đó vẫn cấp (bất biến 5)', async () => {
    const { khach } = await dangKy('Công ty Quá Hạn');
    const { order } = await (await khach('/v1/console/orders', { method: 'POST', body: JSON.stringify({ kind: 'plan', tier: 'starter', months: 1 }) })).json();
    await sql`UPDATE customer_order SET link_expires_at = now() - interval '2 hours' WHERE id = ${order.id}::uuid`;
    await cron('*/5 * * * *');
    expect((await (await khach(`/v1/console/orders/${order.id}`)).json()).order.status).toBe('expired');
    const tra = await webhook(dungWebhook({ orderCode: order.orderCode, amount: 650_000, reference: `FT-MUON-${order.orderCode}` }, FAKE_CHECKSUM));
    expect(await tra.json()).toMatchObject({ status: 'fulfilled' });
  });

  it('tài khoản A không đọc, không huỷ được đơn của B (404); B huỷ được đơn pending của mình', async () => {
    const a = await dangKy('Công ty A');
    const b = await dangKy('Công ty B');
    const { order } = await (await b.khach('/v1/console/orders', { method: 'POST', body: JSON.stringify({ kind: 'plan', tier: 'starter', months: 1 }) })).json();
    expect((await a.khach(`/v1/console/orders/${order.id}`)).status).toBe(404);
    expect((await a.khach(`/v1/console/orders/${order.id}/cancel`, { method: 'POST', body: '{}' })).status).toBe(404);
    const huy = await b.khach(`/v1/console/orders/${order.id}/cancel`, { method: 'POST', body: '{}' });
    expect(huy.status).toBe(200);
    expect((await huy.json()).order.status).toBe('cancelled');
    const tt = await (await fetch(`${payosFake}/v2/payment-requests/${order.orderCode}`, { headers: { 'x-client-id': 'fake-client-id', 'x-api-key': 'fake-api-key' } })).json();
    expect(tt.data.status).toBe('CANCELLED');
  });

  it('mua thêm lượt khi đang dùng thử → 409; sau khi có gói trả phí → addCredits vào đúng kỳ hiện tại', async () => {
    const { khach, tenantId } = await dangKy('Công ty Mua Lượt');
    expect((await khach('/v1/console/orders/quote?kind=addon&group=places&packs=2')).status).toBe(409);
    const { order: goi } = await (await khach('/v1/console/orders', { method: 'POST', body: JSON.stringify({ kind: 'plan', tier: 'starter', months: 1 }) })).json();
    await webhook(dungWebhook({ orderCode: goi.orderCode, amount: 650_000, reference: `FT-G-${goi.orderCode}` }, FAKE_CHECKSUM));
    const { order: luot } = await (await khach('/v1/console/orders', { method: 'POST', body: JSON.stringify({ kind: 'addon', group: 'places', packs: 2 }) })).json();
    expect(luot.amountVnd).toBe(52_000);
    const kq = await webhook(dungWebhook({ orderCode: luot.orderCode, amount: 52_000, reference: `FT-L-${luot.orderCode}` }, FAKE_CHECKSUM));
    expect(await kq.json()).toMatchObject({ status: 'fulfilled' });
    const lichSu = await (await adminFetch(`/v1/admin/billing/${tenantId}/periods`)).json();
    expect(lichSu.credits.some((c) => c.lineItemId === luot.id && c.units === 2_000)).toBe(true);
    const usage = await (await khach('/v1/console/usage')).json();
    expect(usage.places.credits).toBe(2_000);
  });

  it('admin: danh sách lọc, summary, chi tiết có sự kiện và chủ tenant', async () => {
    const ds = await (await adminFetch('/v1/admin/orders?status=fulfilled&limit=5')).json();
    expect(ds.items.length).toBeGreaterThan(0);
    expect(ds.items[0]).toHaveProperty('tenantName');
    const tomTat = await (await adminFetch('/v1/admin/orders/summary')).json();
    expect(tomTat.doanhThu30Ngay).toBeGreaterThan(0);
    const chiTiet = await (await adminFetch(`/v1/admin/orders/${ds.items[0].id}`)).json();
    expect(chiTiet.events.length).toBeGreaterThan(0);
    expect(chiTiet.owner.email).toContain('@vidu.vn');
  });

  it('route đơn hàng admin đứng sau cổng billing: email ngoài BILLING_ADMIN_EMAILS nhận 403', async () => {
    const la = signAccessJwt({ email: 'nguoi-la@access-fake.local' });
    const res = await fetch(`${base}/v1/admin/orders`, { headers: { 'Cf-Access-Jwt-Assertion': la } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Chạy harness**

Run: `pnpm test:api-db`
Expected: PASS toàn bộ, gồm 9 bài mới. Nếu bài "webhook rơi" đỏ vì cron chưa nhận đơn: kiểm
`--test-scheduled` đã vào tham số wrangler và `/__scheduled` trả 200.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test-db/commerce.itest.mjs
git commit -m "test(itest): đơn hàng trọn chặng — PayOS giả, webhook, replay, thiếu tiền + xác nhận tay, cron đối soát, cách ly tenant

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Console — màn Mua, Đơn hàng, chi tiết đơn; nút thật ở Tổng quan

**Files:**
- Create: `apps/console/src/features/mua/page.tsx`,
  `apps/console/src/features/mua/the-goi.tsx` (+ `.test.tsx`), `apps/console/src/features/don-hang/page.tsx`,
  `apps/console/src/features/don-hang/chi-tiet.tsx`, `apps/console/src/features/don-hang/ma-qr.tsx` (+ `.test.tsx`),
  `apps/console/src/features/don-hang/trang-thai.ts` (+ `.test.ts`)
- Modify: `apps/console/package.json`, `apps/console/src/lib/api.ts`,
  `apps/console/src/lib/error-vi.ts`, `apps/console/src/features/auth/hooks.ts`, `apps/console/src/routes.tsx`,
  `apps/console/src/layout/app-shell.tsx`, `apps/console/src/features/tong-quan/page.tsx`

- [ ] **Step 1: Kiểm `dinhDangVnd`, `dinhDangSo`, `dinhDangUsd`, `TEN_GOI` đã có trong `@mapslibvn/catalog`**

Đã tạo ở Task 8 bước 1. Nếu Task 8 chưa chạy tới, làm bước đó trước — mọi thẻ giá và màn đơn
hàng dưới đây import từ catalog, không tự định dạng.

- [ ] **Step 2: Kiểu và hàm gọi API trong `lib/api.ts`, mã lỗi trong `error-vi.ts`, khoá cache**

Thêm vào `apps/console/src/lib/api.ts`:

```ts
import type { PaidTier, PeriodMonths, QuotaGroup } from '@mapslibvn/catalog';
import { postJson } from './fetcher';

export type TrangThaiDon =
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'paid_unfulfilled'
  | 'underpaid'
  | 'expired'
  | 'cancelled'
  | 'refunded';

export interface DonHang {
  id: string;
  orderCode: number;
  noiDungChuyenKhoan: string;
  kind: 'plan' | 'addon';
  tier: PaidTier | null;
  months: PeriodMonths | null;
  quotaGroup: QuotaGroup | null;
  packs: number | null;
  moTa: string;
  amountVnd: number;
  amountUsdCents: number;
  status: TrangThaiDon;
  checkoutUrl: string | null;
  qrCode: string | null;
  linkExpiresAt: string | null;
  paidAt: string | null;
  paidAmountVnd: number | null;
  fulfilledAt: string | null;
  fulfilError: string | null;
  createdAt: string;
}

export interface BaoGia {
  amountVnd: number;
  amountUsdCents: number;
  hieuLucTu: string | null;
  hetHanLuc: string | null;
}

export type NoiDungDon =
  | { kind: 'plan'; tier: PaidTier; months: PeriodMonths }
  | { kind: 'addon'; group: QuotaGroup; packs: number };

/** Nội dung đơn dựng lại từ một đơn đã có — để "Tạo lại link" gửi đúng thứ đã mua. */
export function noiDungTuDon(don: DonHang): NoiDungDon | null {
  if (don.kind === 'plan' && don.tier && don.months) return { kind: 'plan', tier: don.tier, months: don.months };
  if (don.kind === 'addon' && don.quotaGroup && don.packs) return { kind: 'addon', group: don.quotaGroup, packs: don.packs };
  return null;
}

const thamSo = (d: NoiDungDon) =>
  new URLSearchParams(
    d.kind === 'plan'
      ? { kind: 'plan', tier: d.tier, months: String(d.months) }
      : { kind: 'addon', group: d.group, packs: String(d.packs) },
  ).toString();

export const layBaoGia = (d: NoiDungDon) => apiFetch<BaoGia>(`/v1/console/orders/quote?${thamSo(d)}`);
export const taoDon = (d: NoiDungDon) =>
  postJson<{ order: DonHang }>('/v1/console/orders', d).then((r) => r.order);
export const layDonHang = () => apiFetch<{ orders: DonHang[] }>('/v1/console/orders').then((r) => r.orders);
export const layDon = (id: string) => apiFetch<{ order: DonHang }>(`/v1/console/orders/${id}`).then((r) => r.order);
export const huyDon = (id: string) =>
  postJson<{ order: DonHang }>(`/v1/console/orders/${id}/cancel`, {}).then((r) => r.order);
```

Thêm vào `khoaCache` trong `features/auth/hooks.ts`:

```ts
  donHang: ['don-hang'] as const,
  don: (id: string) => ['don-hang', id] as const,
  baoGia: (d: unknown) => ['bao-gia', d] as const,
```

Thêm vào `CAU` trong `lib/error-vi.ts`:

```ts
  tenant_not_commercial: 'Tổ chức chưa ở chế độ thương mại. Hãy liên hệ hỗ trợ.',
  credits_require_paid_active:
    'Chỉ mua thêm lượt khi đang có gói trả phí. Hãy mua gói trước, hoặc gia hạn nếu gói đã hết hạn.',
  too_many_pending_orders: 'Bạn đang có quá nhiều đơn chờ thanh toán. Hãy huỷ bớt ở mục Đơn hàng.',
  payment_provider_unavailable:
    'Cổng thanh toán đang bận. Đơn đã được giữ; hãy mở đơn và bấm "Tạo lại link thanh toán".',
  payment_provider_not_configured: 'Thanh toán trực tuyến chưa mở. Hãy liên hệ hỗ trợ.',
  order_not_found: 'Không tìm thấy đơn này.',
  order_not_cancellable: 'Đơn này không còn ở trạng thái huỷ được.',
  invalid_kind: 'Nội dung đơn không hợp lệ.',
  invalid_tier: 'Gói không hợp lệ.',
  invalid_months: 'Kỳ thuê bao phải là 1, 3, 6 hoặc 12 tháng.',
  invalid_group: 'Nhóm lượt không hợp lệ.',
  invalid_packs: 'Số khối lượt phải từ 1 đến 1.000.',
```

- [ ] **Step 3: `trang-thai.ts` — nhãn, chu kỳ poll, đếm ngược — và test**

`apps/console/src/features/don-hang/trang-thai.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chuKyPoll, giayConLai, NHAN_TRANG_THAI } from './trang-thai';

describe('trạng thái đơn', () => {
  it('đủ nhãn cho cả tám trạng thái', () => {
    expect(Object.keys(NHAN_TRANG_THAI).sort()).toEqual(
      ['cancelled', 'expired', 'fulfilled', 'paid', 'paid_unfulfilled', 'pending', 'refunded', 'underpaid'],
    );
  });
  it('poll 3 giây khi pending, 5 giây khi đã trả mà chưa cấp, dừng khi xong', () => {
    expect(chuKyPoll('pending')).toBe(3000);
    expect(chuKyPoll('paid')).toBe(5000);
    expect(chuKyPoll('paid_unfulfilled')).toBe(5000);
    expect(chuKyPoll('fulfilled')).toBe(false);
    expect(chuKyPoll('underpaid')).toBe(false);
    expect(chuKyPoll(undefined)).toBe(false);
  });
  it('đếm ngược không âm, null khi không có hạn', () => {
    const now = Date.parse('2026-09-19T03:00:00Z');
    expect(giayConLai('2026-09-19T03:10:00Z', now)).toBe(600);
    expect(giayConLai('2026-09-19T02:00:00Z', now)).toBe(0);
    expect(giayConLai(null, now)).toBeNull();
  });
});
```

`apps/console/src/features/don-hang/trang-thai.ts`:

```ts
import type { TrangThaiDon } from '@/lib/api';

export const NHAN_TRANG_THAI: Record<
  TrangThaiDon,
  { nhan: string; tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' }
> = {
  pending: { nhan: 'Chờ thanh toán', tone: 'brand' },
  paid: { nhan: 'Đã nhận tiền', tone: 'brand' },
  fulfilled: { nhan: 'Đã cấp gói', tone: 'success' },
  paid_unfulfilled: { nhan: 'Đã nhận tiền, đang cấp gói', tone: 'warning' },
  underpaid: { nhan: 'Thiếu tiền', tone: 'warning' },
  expired: { nhan: 'Hết hạn', tone: 'neutral' },
  cancelled: { nhan: 'Đã huỷ', tone: 'neutral' },
  refunded: { nhan: 'Đã hoàn tiền', tone: 'neutral' },
};

/** Spec 12: poll 3 giây lúc pending; đã trả mà chưa vào sổ thì 5 giây; còn lại dừng hẳn. */
export function chuKyPoll(status: TrangThaiDon | undefined): number | false {
  if (status === 'pending') return 3000;
  if (status === 'paid' || status === 'paid_unfulfilled') return 5000;
  return false;
}

export function giayConLai(hetHan: string | null, now = Date.now()): number | null {
  if (!hetHan) return null;
  return Math.max(0, Math.floor((Date.parse(hetHan) - now) / 1000));
}

export const ngayGioVn = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
```

- [ ] **Step 4: `ma-qr.tsx` — QR từ chuỗi VietQR, không thư viện nào có phụ thuộc**

Thêm `"qrcode-generator": "^2.0.4"` vào `dependencies` của `apps/console/package.json` rồi
`pnpm install`. Gói MIT, **không dependency**, có `dist/qrcode.mjs` và `.d.ts`.

`apps/console/src/features/don-hang/ma-qr.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MaQr } from './ma-qr';

describe('MaQr', () => {
  it('vẽ ảnh QR dạng data URL từ chuỗi VietQR, có alt', () => {
    render(<MaQr noiDung="00020101021238570010A000000727012700069704220113001234567890208QRIBFTTA5303704" />);
    const anh = screen.getByRole('img', { name: /Mã QR/ });
    expect(anh.getAttribute('src')).toMatch(/^data:image\/gif;base64,/);
  });
});
```

`apps/console/src/features/don-hang/ma-qr.tsx`:

```tsx
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * Chuỗi `qrCode` của PayOS là payload EMVCo/VietQR; mọi ứng dụng ngân hàng quét được. Vẽ ở client
 * bằng một thư viện không phụ thuộc, xuất GIF data URL — không chèn HTML, không gọi máy chủ ảnh
 * bên ngoài, nên nội dung chuyển khoản không rời trình duyệt của khách.
 */
export function MaQr({ noiDung }: { noiDung: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(noiDung);
    qr.make();
    return qr.createDataURL(4, 8);
  }, [noiDung]);
  return (
    <img
      src={src}
      alt="Mã QR chuyển khoản VietQR"
      width={232}
      height={232}
      className="rounded-[var(--radius-btn)] border border-[var(--border)] bg-white"
    />
  );
}
```

Nếu `tsc` báo module không có default export, đổi thành
`import * as QR from 'qrcode-generator';` và gọi `QR.default(0, 'M')` — hai bản 2.x khác nhau ở
đúng chỗ này.

- [ ] **Step 5: `the-goi.tsx` — thẻ gói đổi số theo kỳ — và test**

`apps/console/src/features/mua/the-goi.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TheGoi } from './the-goi';

describe('TheGoi', () => {
  it('giá nhân theo kỳ, USD mờ, đánh dấu gói hiện tại', () => {
    render(<TheGoi tier="starter" months={3} dangDung daChon={false} chon={vi.fn()} />);
    expect(screen.getByText('1.950.000đ')).toBeVisible();
    expect(screen.getByText('$75')).toBeVisible();
    expect(screen.getByText('Gói hiện tại')).toBeVisible();
    expect(screen.getByText(/30\.000 lượt Places/)).toBeVisible();
  });
  it('bấm Chọn gọi chon()', () => {
    const chon = vi.fn();
    render(<TheGoi tier="professional" months={1} dangDung={false} daChon={false} chon={chon} />);
    screen.getByRole('button', { name: /Chọn Professional/ }).click();
    expect(chon).toHaveBeenCalledTimes(1);
  });
});
```

`apps/console/src/features/mua/the-goi.tsx`:

```tsx
import {
  dinhDangSo,
  dinhDangUsd,
  dinhDangVnd,
  type PaidTier,
  type PeriodMonths,
  PLAN_CATALOG,
  TEN_GOI,
} from '@mapslibvn/catalog';
import { Badge, Button, cn } from '@mapslibvn/ui';

interface TheGoiProps {
  tier: PaidTier;
  months: PeriodMonths;
  dangDung: boolean;
  daChon: boolean;
  chon: () => void;
}

/** Con số trên thẻ tính từ cùng PLAN_CATALOG mà máy chủ dùng; máy chủ vẫn tính lại khi tạo đơn. */
export function TheGoi({ tier, months, dangDung, daChon, chon }: TheGoiProps) {
  const goi = PLAN_CATALOG[tier];
  return (
    <section
      aria-label={`Gói ${TEN_GOI[tier]}`}
      className={cn(
        'rounded-[var(--radius-card)] border bg-[var(--surface)] p-5',
        daChon ? 'border-brand-700 ring-2 ring-brand-700/30' : 'border-[var(--border)]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-bold">{TEN_GOI[tier]}</h3>
        {dangDung && <Badge tone="brand">Gói hiện tại</Badge>}
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums">{dinhDangVnd(goi.priceVnd * months)}</p>
      <p className="text-sm text-[var(--text-muted)]">
        <span>{dinhDangUsd(goi.priceCents * months)}</span> · {months} tháng
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        <li>{dinhDangSo(goi.places)} lượt Places mỗi kỳ</li>
        <li>{dinhDangSo(goi.directions)} lượt tính tuyến mỗi kỳ</li>
        <li>{goi.onlineSupport ? 'Hỗ trợ trực tuyến' : 'Hỗ trợ qua email'}</li>
      </ul>
      <Button className="mt-4" block variant={daChon ? 'primary' : 'secondary'} onClick={chon}>
        {daChon ? `Đã chọn ${TEN_GOI[tier]}` : `Chọn ${TEN_GOI[tier]}`}
      </Button>
    </section>
  );
}
```

- [ ] **Step 6: Màn Mua `features/mua/page.tsx`**

```tsx
import {
  dinhDangSo,
  dinhDangUsd,
  dinhDangVnd,
  MAX_PACKS,
  type PaidTier,
  PAID_TIERS,
  PERIOD_MONTHS,
  type PeriodMonths,
  PLAN_CATALOG,
  type QuotaGroup,
  TEN_GOI,
} from '@mapslibvn/catalog';
import { Button, LoadingSkeleton } from '@mapslibvn/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { khoaCache, useToi } from '@/features/auth/hooks';
import { ngayGioVn } from '@/features/don-hang/trang-thai';
import { layBaoGia, layMucDung, type MucDung, type NoiDungDon, taoDon } from '@/lib/api';
import { ConsoleApiError } from '@/lib/fetcher';
import { LoiHop } from '@/lib/loi-hop';
import { TheGoi } from './the-goi';

const laTier = (v: string | null): v is PaidTier => (PAID_TIERS as readonly string[]).includes(v ?? '');
const laKy = (v: number): v is PeriodMonths => (PERIOD_MONTHS as readonly number[]).includes(v);

export function Mua() {
  const { data: toi } = useToi();
  const [q] = useSearchParams();
  const dieuHuong = useNavigate();
  const [tab, datTab] = useState<'goi' | 'luot'>(q.get('tab') === 'luot' ? 'luot' : 'goi');
  const [tier, datTier] = useState<PaidTier>(laTier(q.get('goi')) ? (q.get('goi') as PaidTier) : 'starter');
  const [months, datMonths] = useState<PeriodMonths>(laKy(Number(q.get('ky'))) ? (Number(q.get('ky')) as PeriodMonths) : 1);
  const [group, datGroup] = useState<QuotaGroup>('places');
  const [packs, datPacks] = useState(1);

  const mucDung = useQuery<MucDung>({ queryKey: khoaCache.mucDung, queryFn: layMucDung, enabled: toi?.onboarded === true, retry: 1 });
  const noiDung: NoiDungDon = tab === 'goi' ? { kind: 'plan', tier, months } : { kind: 'addon', group, packs };
  const baoGia = useQuery({ queryKey: khoaCache.baoGia(noiDung), queryFn: () => layBaoGia(noiDung), enabled: toi?.onboarded === true, retry: false });

  const mua = useMutation({
    mutationFn: () => taoDon(noiDung),
    onSuccess: (don) => void dieuHuong(`/don-hang/${don.id}`),
    onError: (error) => {
      // PayOS bận nhưng đơn đã được giữ: đưa khách tới đơn đó, ở đó có nút tạo lại link.
      if (error instanceof ConsoleApiError && error.code === 'payment_provider_unavailable') {
        const orderId = error.details?.orderId;
        if (typeof orderId === 'string') void dieuHuong(`/don-hang/${orderId}`);
      }
    },
  });

  if (!toi) return <LoadingSkeleton rows={3} />;
  if (!toi.onboarded) {
    return <p className="text-[var(--text-muted)]">Hãy tạo tổ chức trước khi mua gói.</p>;
  }
  const dangThu = mucDung.data?.tier === 'trial';
  const lopTab = (dang: boolean) =>
    `min-h-11 rounded-[var(--radius-btn)] px-4 font-semibold ${dang ? 'bg-brand-700 text-white' : 'border border-[var(--border)]'}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Mua gói</h1>
      <div role="tablist" aria-label="Loại mua" className="flex gap-2">
        <button type="button" role="tab" aria-selected={tab === 'goi'} className={lopTab(tab === 'goi')} onClick={() => datTab('goi')}>Gói thuê bao</button>
        <button type="button" role="tab" aria-selected={tab === 'luot'} className={lopTab(tab === 'luot')} onClick={() => datTab('luot')}>Mua thêm lượt</button>
      </div>

      {tab === 'goi' && (
        <>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-sm font-semibold">Kỳ thuê bao</legend>
            {PERIOD_MONTHS.map((ky) => (
              <label key={ky} className={`${lopTab(months === ky)} flex cursor-pointer items-center`}>
                <input type="radio" name="ky" className="sr-only" checked={months === ky} onChange={() => datMonths(ky)} />
                {ky} tháng
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 md:grid-cols-3">
            {PAID_TIERS.map((t) => (
              <TheGoi key={t} tier={t} months={months} dangDung={mucDung.data?.tier === t} daChon={tier === t} chon={() => datTier(t)} />
            ))}
          </div>
        </>
      )}

      {tab === 'luot' && (
        <section className="space-y-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="text-sm text-[var(--text-muted)]">
            Mỗi khối {dinhDangSo(PLAN_CATALOG.addOns.places.units)} lượt, cộng vào kỳ hiện tại và hết hạn cùng kỳ. Chỉ mua được khi đang có gói trả phí.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="nhom" className="block text-sm font-semibold">Nhóm lượt</label>
              <select id="nhom" value={group} onChange={(su) => datGroup(su.target.value as QuotaGroup)} className="mt-1 min-h-11 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3">
                <option value="places">Places — {dinhDangVnd(PLAN_CATALOG.addOns.places.priceVnd)}/khối</option>
                <option value="directions">Tính tuyến — {dinhDangVnd(PLAN_CATALOG.addOns.directions.priceVnd)}/khối</option>
              </select>
            </div>
            <div>
              <label htmlFor="khoi" className="block text-sm font-semibold">Số khối</label>
              <input id="khoi" type="number" min={1} max={MAX_PACKS} value={packs} onChange={(su) => datPacks(Math.min(MAX_PACKS, Math.max(1, Number(su.target.value) || 1)))} className="mt-1 min-h-11 w-28 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3" />
            </div>
          </div>
        </section>
      )}

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-bold">Tóm tắt</h2>
        {baoGia.isPending && <LoadingSkeleton rows={1} />}
        {baoGia.isError && <div className="mt-2"><LoiHop error={baoGia.error} /></div>}
        {baoGia.data && (
          <dl className="mt-2 space-y-1">
            <div className="flex justify-between"><dt>Thành tiền</dt><dd className="text-xl font-bold tabular-nums">{dinhDangVnd(baoGia.data.amountVnd)}</dd></div>
            <div className="flex justify-between text-sm text-[var(--text-muted)]"><dt>Tham chiếu</dt><dd>{dinhDangUsd(baoGia.data.amountUsdCents)}</dd></div>
            {baoGia.data.hieuLucTu && (
              <div className="flex justify-between text-sm"><dt>Hiệu lực</dt><dd>từ {ngayGioVn(baoGia.data.hieuLucTu)} đến {ngayGioVn(baoGia.data.hetHanLuc)}</dd></div>
            )}
          </dl>
        )}
        {tab === 'goi' && dangThu && (
          <p className="mt-3 rounded-[var(--radius-btn)] bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            Bản dùng thử sẽ kết thúc ngay khi thanh toán; lượt dùng thử chưa dùng sẽ mất.
          </p>
        )}
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Thanh toán bằng chuyển khoản VietQR qua PayOS. Gói vào tài khoản ngay khi ngân hàng báo có, thường trong một phút.
        </p>
        {mua.isError && <div className="mt-3"><LoiHop error={mua.error} /></div>}
        <Button className="mt-4" block disabled={!baoGia.data || mua.isPending} onClick={() => mua.mutate()}>
          {mua.isPending ? 'Đang tạo đơn…' : `Thanh toán ${TEN_GOI[tier] && tab === 'goi' ? TEN_GOI[tier] : 'lượt'}`}
        </Button>
      </section>
    </div>
  );
}
```

- [ ] **Step 7: Danh sách đơn `features/don-hang/page.tsx`**

```tsx
import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, LoadingSkeleton } from '@mapslibvn/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { khoaCache, useToi } from '@/features/auth/hooks';
import { layDonHang } from '@/lib/api';
import { LoiHop } from '@/lib/loi-hop';
import { NHAN_TRANG_THAI, ngayGioVn } from './trang-thai';

export function DonHangPage() {
  const { data: toi } = useToi();
  const ds = useQuery({ queryKey: khoaCache.donHang, queryFn: layDonHang, enabled: toi?.onboarded === true, retry: 1 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Đơn hàng</h1>
        <Link to="/mua" className="inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-brand-700 px-4 font-semibold text-white">Mua gói</Link>
      </div>
      {ds.isPending && <LoadingSkeleton rows={3} />}
      {ds.isError && <LoiHop error={ds.error} />}
      {ds.data && ds.data.length === 0 && (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center text-[var(--text-muted)]">Chưa có đơn nào.</p>
      )}
      <ul className="space-y-3">
        {ds.data?.map((don) => (
          <li key={don.id}>
            <Link to={`/don-hang/${don.id}`} className="block rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-brand-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">Đơn {don.orderCode} · {don.moTa}</span>
                <Badge tone={NHAN_TRANG_THAI[don.status].tone}>{NHAN_TRANG_THAI[don.status].nhan}</Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{dinhDangVnd(don.amountVnd)} · tạo {ngayGioVn(don.createdAt)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 8: Chi tiết đơn `features/don-hang/chi-tiet.tsx`**

```tsx
import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, Button, LoadingSkeleton, useDelayedAction } from '@mapslibvn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { khoaCache, useCauHinh } from '@/features/auth/hooks';
import { huyDon, layDon, noiDungTuDon, taoDon } from '@/lib/api';
import { LoiHop } from '@/lib/loi-hop';
import { MaQr } from './ma-qr';
import { chuKyPoll, giayConLai, NHAN_TRANG_THAI, ngayGioVn } from './trang-thai';

const mmss = (giay: number) => `${Math.floor(giay / 60)}:${String(giay % 60).padStart(2, '0')}`;

export function ChiTietDon() {
  const { id = '' } = useParams();
  const [q] = useSearchParams();
  const { data: cauHinh } = useCauHinh();
  const queryClient = useQueryClient();
  const { schedule } = useDelayedAction();

  // Trạng thái LUÔN lấy từ đơn trong DB; `?ket-qua=` chỉ là đường về giao diện (spec 9.1).
  const don = useQuery({
    queryKey: khoaCache.don(id),
    queryFn: () => layDon(id),
    refetchInterval: (query) => chuKyPoll(query.state.data?.status),
    retry: 1,
  });

  const [giay, datGiay] = useState<number | null>(null);
  useEffect(() => {
    const hetHan = don.data?.linkExpiresAt ?? null;
    datGiay(giayConLai(hetHan));
    const t = setInterval(() => datGiay(giayConLai(hetHan)), 1000);
    return () => clearInterval(t);
  }, [don.data?.linkExpiresAt]);

  const lamMoi = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: khoaCache.don(id) }),
      queryClient.invalidateQueries({ queryKey: khoaCache.donHang }),
      queryClient.invalidateQueries({ queryKey: khoaCache.mucDung }),
    ]);
  const huy = useMutation({ mutationFn: () => huyDon(id), onSettled: lamMoi });
  const taoLaiLink = useMutation({
    mutationFn: () => {
      const nd = don.data ? noiDungTuDon(don.data) : null;
      if (!nd) throw new Error('order_not_found');
      // Máy chủ nhận ra đơn pending chưa có link cùng nội dung và dùng lại nó — không tạo đơn mới.
      return taoDon(nd);
    },
    onSettled: lamMoi,
  });

  if (don.isPending) return <LoadingSkeleton rows={3} />;
  if (don.isError) return <LoiHop error={don.error} />;
  const d = don.data;
  const tt = NHAN_TRANG_THAI[d.status];
  const thieu = d.paidAmountVnd !== null ? d.amountVnd - d.paidAmountVnd : d.amountVnd;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Đơn {d.orderCode}</h1>
        <Badge tone={tt.tone}>{tt.nhan}</Badge>
      </div>
      <p className="text-[var(--text-muted)]">{d.moTa} · {dinhDangVnd(d.amountVnd)} · tạo {ngayGioVn(d.createdAt)}</p>

      {d.status === 'pending' && (
        <section className="space-y-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          {q.get('ket-qua') === 'thanh-cong' && (
            <p className="rounded-[var(--radius-btn)] bg-brand-50 p-3 text-sm dark:bg-brand-900">PayOS báo đã thanh toán; đang chờ ngân hàng xác nhận, thường dưới một phút.</p>
          )}
          <h2 className="text-base font-bold">Chuyển khoản {dinhDangVnd(d.amountVnd)}</h2>
          <p className="text-sm">Nội dung chuyển khoản: <strong className="font-mono">{d.noiDungChuyenKhoan}</strong> — giữ đúng nội dung này để hệ thống nhận ra đơn.</p>
          {d.qrCode ? <MaQr noiDung={d.qrCode} /> : <p className="text-sm text-[var(--text-muted)]">Chưa có mã QR cho đơn này.</p>}
          {d.checkoutUrl ? (
            <a href={d.checkoutUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-brand-700 px-4 font-semibold text-white">Mở trang thanh toán PayOS</a>
          ) : (
            <Button onClick={() => taoLaiLink.mutate()} disabled={taoLaiLink.isPending}>{taoLaiLink.isPending ? 'Đang tạo…' : 'Tạo lại link thanh toán'}</Button>
          )}
          {taoLaiLink.isError && <LoiHop error={taoLaiLink.error} />}
          {giay !== null && <p className="text-sm text-[var(--text-muted)]">{giay > 0 ? `Link hết hạn sau ${mmss(giay)}` : 'Link đã hết hạn; hệ thống sẽ đóng đơn này.'}</p>}
          <p className="text-sm text-[var(--text-muted)]">Trang tự cập nhật mỗi 3 giây. Không cần tải lại.</p>
          <Button variant="danger" onClick={() => schedule({ label: `Huỷ đơn ${d.orderCode}`, run: async () => { await huy.mutateAsync(); } })}>Huỷ đơn</Button>
          {huy.isError && <LoiHop error={huy.error} />}
        </section>
      )}

      {(d.status === 'paid' || d.status === 'paid_unfulfilled') && (
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="font-semibold">Đã nhận {dinhDangVnd(d.paidAmountVnd ?? d.amountVnd)}, đang cấp gói.</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Hệ thống tự thử lại mỗi 5 phút; gói sẽ vào tài khoản mà bạn không cần làm gì. Nếu quá 30 phút vẫn ở trạng thái này, hãy liên hệ {cauHinh?.supportEmail}.</p>
        </section>
      )}

      {d.status === 'fulfilled' && (
        <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="font-semibold">Gói đã được cấp.</p>
          <dl className="text-sm">
            <div className="flex justify-between"><dt>Đã nhận</dt><dd>{dinhDangVnd(d.paidAmountVnd ?? d.amountVnd)}</dd></div>
            <div className="flex justify-between"><dt>Lúc</dt><dd>{ngayGioVn(d.paidAt)}</dd></div>
            <div className="flex justify-between"><dt>Cấp gói lúc</dt><dd>{ngayGioVn(d.fulfilledAt)}</dd></div>
          </dl>
          <p className="text-sm text-[var(--text-muted)]">Biên nhận đã gửi qua email. Đây là biên nhận thanh toán, không phải chứng từ thuế.</p>
          <Link to="/" className="inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-brand-700 px-4 font-semibold text-white">Về Tổng quan</Link>
        </section>
      )}

      {d.status === 'underpaid' && (
        <section className="space-y-2 rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-semibold">Đã nhận {dinhDangVnd(d.paidAmountVnd ?? 0)}, còn thiếu {dinhDangVnd(thieu)}.</p>
          <p className="text-sm">Chuyển thêm đúng {dinhDangVnd(thieu)} với nội dung <strong className="font-mono">{d.noiDungChuyenKhoan}</strong>, hoặc liên hệ {cauHinh?.supportEmail} để được xử lý tay. Gói chưa được cấp cho tới khi nhận đủ.</p>
        </section>
      )}

      {(d.status === 'expired' || d.status === 'cancelled') && (
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="font-semibold">{d.status === 'expired' ? 'Đơn đã hết hạn thanh toán.' : 'Đơn đã huỷ.'}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Nếu bạn đã chuyển khoản cho đơn này, tiền vẫn được ghi nhận và gói vẫn được cấp — trang này sẽ tự cập nhật. Muốn mua lại thì tạo đơn mới.</p>
          <Link to="/mua" className="mt-3 inline-flex min-h-11 items-center rounded-[var(--radius-btn)] border border-[var(--border)] px-4 font-semibold">Mua gói</Link>
        </section>
      )}

      <p className="text-sm"><Link to="/don-hang" className="underline">← Tất cả đơn hàng</Link></p>
    </div>
  );
}
```

- [ ] **Step 9: Route, điều hướng, Tổng quan**

`routes.tsx`: thêm ba lazy import và ba child:

```tsx
const Mua = lazy(() => import('@/features/mua/page').then((m) => ({ default: m.Mua })));
const DonHang = lazy(() => import('@/features/don-hang/page').then((m) => ({ default: m.DonHangPage })));
const ChiTietDon = lazy(() => import('@/features/don-hang/chi-tiet').then((m) => ({ default: m.ChiTietDon })));
…
        { path: 'mua', element: cho(<Mua />) },
        { path: 'don-hang', element: cho(<DonHang />) },
        { path: 'don-hang/:id', element: cho(<ChiTietDon />) },
```

`layout/app-shell.tsx`: `MUC` thêm `{ den: '/don-hang', nhan: 'Đơn hàng' }` sau Khoá API.

`features/tong-quan/page.tsx`: **xoá** hộp thoại "đang được hoàn thiện" và `useRef`; thay khối
ba nút bằng ba `Link`, và thêm mục năm đơn gần nhất:

```tsx
          <section className="flex flex-wrap gap-3">
            {tier && tier !== 'trial' && (
              <Link to={`/mua?goi=${tier}&ky=1`} className={lopNut}>Gia hạn</Link>
            )}
            <Link to="/mua" className={lopNut}>{tier === 'trial' || !tier ? 'Mua gói' : 'Nâng gói'}</Link>
            {tier && tier !== 'trial' && <Link to="/mua?tab=luot" className={lopNut}>Mua thêm lượt</Link>}
          </section>

          <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Đơn gần nhất</h2>
              <Link to="/don-hang" className="text-sm underline">Tất cả</Link>
            </div>
            {donGanNhat.data && donGanNhat.data.length === 0 && <p className="mt-2 text-sm text-[var(--text-muted)]">Chưa có đơn nào.</p>}
            <ul className="mt-2 space-y-2">
              {donGanNhat.data?.slice(0, 5).map((don) => (
                <li key={don.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Link to={`/don-hang/${don.id}`} className="underline">Đơn {don.orderCode} · {don.moTa}</Link>
                  <Badge tone={NHAN_TRANG_THAI[don.status].tone}>{NHAN_TRANG_THAI[don.status].nhan}</Badge>
                </li>
              ))}
            </ul>
          </section>
```

với `const lopNut = 'inline-flex min-h-11 items-center rounded-[var(--radius-btn)] border border-[var(--border)] px-4 font-semibold';`
và `const donGanNhat = useQuery({ queryKey: khoaCache.donHang, queryFn: layDonHang, enabled: toi?.onboarded === true, retry: 1 });`
(import `Badge` từ `@mapslibvn/ui`, `layDonHang` từ `@/lib/api`, `NHAN_TRANG_THAI` từ
`@/features/don-hang/trang-thai`). Bỏ `useCauHinh` nếu không còn dùng.

- [ ] **Step 10: Test, typecheck, build**

```bash
pnpm exec vitest run apps/console/src packages/catalog/src
pnpm --filter @mapslibvn/console typecheck
pnpm --filter @mapslibvn/admin build && pnpm --filter @mapslibvn/console build
```

Expected: PASS (các test cũ của console không hồi quy; `thanh-han-muc.test.tsx` không đổi);
typecheck sạch; build console vào `apps/admin/dist/console`.

- [ ] **Step 11: Commit**

```bash
git add apps/console pnpm-lock.yaml
git commit -m "feat(console): màn Mua gói, Đơn hàng, chi tiết đơn với QR và poll; nút thật ở Tổng quan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Admin — màn Đơn hàng tối thiểu

**Files:**
- Create: `apps/admin/src/features/orders/api.ts`, `hooks.ts`, `trang-thai.ts` (+ `.test.ts`), `page.tsx` (+ `.test.tsx`),
  `chi-tiet.tsx` (+ `.test.tsx`), `khong-khop.tsx`
- Modify: `apps/admin/src/lib/permissions.ts`, `apps/admin/src/layout/sidebar-nav.tsx` (+ `.test.tsx`),
  `apps/admin/src/routes.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Quyền, mục điều hướng, route**

`lib/permissions.ts`: thêm `| 'orders.read' | 'orders.write'` vào `Permission`.
`layout/sidebar-nav.tsx`: trong nhóm "Khách hàng" thêm
`{ to: '/orders', label: 'Đơn hàng & giao dịch', permission: 'orders.read' }`.
`routes.tsx`: `const OrdersPage = lazy(() => import('@/features/orders/page').then((m) => ({ default: m.OrdersPage })));`
và `{ path: 'orders', element: wait(<OrdersPage />) }`.
`routes.test.tsx` và `layout/sidebar-nav.test.tsx`: thêm `'orders.read'`, `'orders.write'` vào
danh sách quyền của `ME`; thêm một khẳng định trong sidebar-nav.test: có quyền `orders.read` thì
thấy mục "Đơn hàng & giao dịch", không có thì không thấy.

- [ ] **Step 2: `api.ts`, `hooks.ts`, `trang-thai.ts` + test**

`features/orders/api.ts`:

```ts
import { apiFetch } from '@/lib/fetcher';

export type TrangThaiDon = 'pending' | 'paid' | 'fulfilled' | 'paid_unfulfilled' | 'underpaid' | 'expired' | 'cancelled' | 'refunded';

export interface DonHangAdmin {
  id: string;
  orderCode: number;
  noiDungChuyenKhoan: string;
  kind: 'plan' | 'addon';
  tier: string | null;
  months: number | null;
  quotaGroup: string | null;
  packs: number | null;
  moTa: string;
  amountVnd: number;
  amountUsdCents: number;
  status: TrangThaiDon;
  checkoutUrl: string | null;
  linkExpiresAt: string | null;
  paidAt: string | null;
  paidAmountVnd: number | null;
  fulfilledAt: string | null;
  fulfilError: string | null;
  fulfilAttempts: number;
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  tenantName: string | null;
  accountId: string;
  paymentLinkId: string | null;
  entitlementReceipt: unknown;
  note: string | null;
}

export interface SuKien {
  id: number;
  orderId: string | null;
  provider: string;
  reference: string;
  orderCode: number | null;
  amountVnd: number | null;
  signatureValid: boolean;
  tomTat: Record<string, unknown>;
  receivedAt: string;
}

export interface TomTatDon {
  choXuLy: number;
  doanhThu30Ngay: number;
  pendingQua1Gio: number;
  khongKhop: number;
}

export interface TrangDon {
  items: DonHangAdmin[];
  nextCursor: string | null;
}

export interface ChiTietDon {
  order: DonHangAdmin;
  events: SuKien[];
  owner: { email: string; billingEmail: string | null } | null;
}

export function listOrders(f: { status?: TrangThaiDon; cursor?: string }): Promise<TrangDon> {
  const p = new URLSearchParams({ limit: '25' });
  if (f.status) p.set('status', f.status);
  if (f.cursor) p.set('cursor', f.cursor);
  return apiFetch<TrangDon>(`/v1/admin/orders?${p.toString()}`);
}
export const getOrder = (id: string) => apiFetch<ChiTietDon>(`/v1/admin/orders/${id}`);
export const getSummary = () => apiFetch<TomTatDon>('/v1/admin/orders/summary');
export const getUnmatched = () => apiFetch<{ items: SuKien[] }>('/v1/admin/payment-events/unmatched');

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const fulfilOrder = (id: string) =>
  postJson<{ order: DonHangAdmin; ketQua: string }>(`/v1/admin/orders/${id}/fulfil`, {});

export interface XacNhanTay {
  operationId: string;
  reason: string;
  bankReference: string;
  amountVnd?: number;
}
export const confirmManual = (id: string, body: XacNhanTay) =>
  postJson<{ order: DonHangAdmin; ketQua: string; moi: boolean }>(`/v1/admin/orders/${id}/confirm-manual`, body);
```

`features/orders/hooks.ts`:

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmManual, fulfilOrder, getOrder, getSummary, getUnmatched, listOrders, type TrangThaiDon, type XacNhanTay } from './api';

export const orderKeys = {
  list: (status: TrangThaiDon | '') => ['orders', 'list', status] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  summary: () => ['orders', 'summary'] as const,
  unmatched: () => ['orders', 'unmatched'] as const,
};

export function useOrderList(status: TrangThaiDon | '') {
  return useInfiniteQuery({
    queryKey: orderKeys.list(status),
    queryFn: ({ pageParam }) => listOrders({ ...(status ? { status } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor,
  });
}
export const useOrderDetail = (id: string | null) =>
  useQuery({ queryKey: orderKeys.detail(id ?? ''), queryFn: () => getOrder(id as string), enabled: id !== null });
/** Cùng khoá cache với hai ô của Tổng quan (spec 13) — pha 4 nối vào, khoá đã sẵn. */
export const useOrderSummary = () => useQuery({ queryKey: orderKeys.summary(), queryFn: getSummary, staleTime: 30_000 });
export const useUnmatched = () => useQuery({ queryKey: orderKeys.unmatched(), queryFn: getUnmatched, staleTime: 30_000 });

function useInvalidateOrders() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: ['orders'] });
}
export function useFulfil() {
  const inv = useInvalidateOrders();
  return useMutation({ mutationFn: (id: string) => fulfilOrder(id), onSettled: inv });
}
export function useConfirmManual() {
  const inv = useInvalidateOrders();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: XacNhanTay }) => confirmManual(id, body), onSettled: inv });
}
```

`features/orders/trang-thai.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NHAN_TRANG_THAI, tuoi } from './trang-thai';

describe('trạng thái đơn (admin)', () => {
  it('đủ tám trạng thái', () => {
    expect(Object.keys(NHAN_TRANG_THAI)).toHaveLength(8);
  });
  it('tuổi đơn: phút, giờ, ngày', () => {
    const now = Date.parse('2026-09-19T03:00:00Z');
    expect(tuoi('2026-09-19T02:58:00Z', now)).toBe('2 phút');
    expect(tuoi('2026-09-19T00:00:00Z', now)).toBe('3 giờ');
    expect(tuoi('2026-09-16T03:00:00Z', now)).toBe('3 ngày');
  });
});
```

`features/orders/trang-thai.ts`:

```ts
import type { TrangThaiDon } from './api';

export const NHAN_TRANG_THAI: Record<TrangThaiDon, { nhan: string; tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' }> = {
  pending: { nhan: 'Chờ thanh toán', tone: 'brand' },
  paid: { nhan: 'Đã nhận tiền', tone: 'brand' },
  fulfilled: { nhan: 'Đã cấp gói', tone: 'success' },
  paid_unfulfilled: { nhan: 'Tiền vào, gói chưa vào', tone: 'danger' },
  underpaid: { nhan: 'Thiếu tiền', tone: 'warning' },
  expired: { nhan: 'Hết hạn', tone: 'neutral' },
  cancelled: { nhan: 'Đã huỷ', tone: 'neutral' },
  refunded: { nhan: 'Đã hoàn tiền', tone: 'neutral' },
};

export const TAT_CA_TRANG_THAI = Object.keys(NHAN_TRANG_THAI) as TrangThaiDon[];

/** "3 giờ" — đủ để nhìn bảng biết đơn nào đang treo lâu. */
export function tuoi(iso: string, now = Date.now()): string {
  const phut = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (phut < 60) return `${phut} phút`;
  const gio = Math.floor(phut / 60);
  if (gio < 24) return `${gio} giờ`;
  return `${Math.floor(gio / 24)} ngày`;
}

export const gioNgay = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
```

- [ ] **Step 3: `page.tsx` + test**

`features/orders/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from './page';

const don = {
  id: '00000000-0000-4000-8000-0000000000d1', orderCode: 100001, noiDungChuyenKhoan: 'MLV100001', kind: 'plan', tier: 'starter',
  months: 3, quotaGroup: null, packs: null, moTa: 'Starter 3 tháng', amountVnd: 1_950_000, amountUsdCents: 7_500,
  status: 'paid_unfulfilled', checkoutUrl: null, linkExpiresAt: null, paidAt: '2026-09-19T03:00:00Z', paidAmountVnd: 1_950_000,
  fulfilledAt: null, fulfilError: 'revision_conflict', fulfilAttempts: 3, createdAt: '2026-09-19T02:00:00Z', updatedAt: '2026-09-19T03:00:00Z',
  tenantId: 't', tenantName: 'Công ty Thử', accountId: 'a', paymentLinkId: 'l', entitlementReceipt: null, note: null,
};

const stubFetch = () =>
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
    const body = url.includes('/summary') ? { choXuLy: 2, doanhThu30Ngay: 3_250_000, pendingQua1Gio: 1, khongKhop: 4 }
      : url.includes('/unmatched') ? { items: [] }
      : url.includes('/v1/admin/me') ? { email: 'a@b.c', permissions: ['orders.read', 'orders.write'] }
      : { items: [don], nextCursor: null };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }));

afterEach(() => vi.unstubAllGlobals());

const ve = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DelayedActionProvider>
        <MemoryRouter initialEntries={['/orders']}>
          <OrdersPage />
        </MemoryRouter>
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

describe('OrdersPage', () => {
  it('bốn ô đầu trang và danh sách có tenant, số tiền, trạng thái', async () => {
    stubFetch();
    ve();
    expect(await screen.findByText('3.250.000đ')).toBeVisible();
    expect(screen.getByText('Đơn chờ xử lý')).toBeVisible();
    expect(await screen.findByText('Công ty Thử')).toBeVisible();
    expect(screen.getByText('1.950.000đ')).toBeVisible();
    expect(screen.getByText('Tiền vào, gói chưa vào')).toBeVisible();
  });
});
```

`features/orders/page.tsx`:

```tsx
import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, Button, EmptyState, ErrorState, LoadingSkeleton, RecordView } from '@mapslibvn/ui';
import { useSearchParams } from 'react-router';
import { O } from '@/features/overview/tile';
import type { TrangThaiDon } from './api';
import { ChiTietDonPanel } from './chi-tiet';
import { useOrderList, useOrderSummary } from './hooks';
import { KhongKhop } from './khong-khop';
import { NHAN_TRANG_THAI, TAT_CA_TRANG_THAI, tuoi } from './trang-thai';

export function OrdersPage() {
  const [q, datQ] = useSearchParams();
  const status = (q.get('status') ?? '') as TrangThaiDon | '';
  const id = q.get('id');
  const list = useOrderList(status);
  const tomTat = useOrderSummary();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const doi = (k: string, v: string | null) => {
    const m = new URLSearchParams(q);
    if (v) m.set(k, v); else m.delete(k);
    datQ(m);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <O ten="Đơn chờ xử lý" den="/orders?status=paid_unfulfilled" dangTai={tomTat.isPending} loi={tomTat.isError} so={tomTat.data?.choXuLy} phu="paid_unfulfilled + underpaid" />
        <O ten="Doanh thu 30 ngày" den="/orders?status=fulfilled" dangTai={tomTat.isPending} loi={tomTat.isError} so={tomTat.data ? dinhDangVnd(tomTat.data.doanhThu30Ngay) : undefined} />
        <O ten="Pending quá 1 giờ" den="/orders?status=pending" dangTai={tomTat.isPending} loi={tomTat.isError} so={tomTat.data?.pendingQua1Gio} />
        <O ten="Giao dịch không khớp đơn" den="/orders#khong-khop" dangTai={tomTat.isPending} loi={tomTat.isError} so={tomTat.data?.khongKhop} />
      </div>

      <label className="block text-sm font-semibold">
        Trạng thái
        <select value={status} onChange={(e) => doi('status', e.target.value || null)} className="mt-1 block min-h-11 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal">
          <option value="">Tất cả</option>
          {TAT_CA_TRANG_THAI.map((s) => <option key={s} value={s}>{NHAN_TRANG_THAI[s].nhan}</option>)}
        </select>
      </label>

      {list.isPending && <LoadingSkeleton rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && <EmptyState title="Không có đơn nào" hint="Đổi bộ lọc trạng thái để xem đơn khác." />}
      {items.length > 0 && (
        <RecordView
          items={items}
          rowKey={(d) => d.id}
          renderCard={(d) => (
            <button type="button" className="w-full text-left" onClick={() => doi('id', d.id)}>
              <span className="font-semibold">Đơn {d.orderCode}</span> · {d.tenantName} · {d.moTa}
              <span className="mt-1 block text-sm">{dinhDangVnd(d.amountVnd)} · <Badge tone={NHAN_TRANG_THAI[d.status].tone}>{NHAN_TRANG_THAI[d.status].nhan}</Badge> · {tuoi(d.createdAt)}</span>
            </button>
          )}
          columns={[
            { key: 'ma', header: 'Đơn', render: (d) => <button type="button" className="font-semibold underline" onClick={() => doi('id', d.id)}>{d.orderCode}</button> },
            { key: 'tenant', header: 'Tenant', render: (d) => d.tenantName ?? d.tenantId },
            { key: 'noiDung', header: 'Nội dung', render: (d) => d.moTa },
            { key: 'tien', header: 'Tiền', render: (d) => dinhDangVnd(d.amountVnd) },
            { key: 'tt', header: 'Trạng thái', render: (d) => <Badge tone={NHAN_TRANG_THAI[d.status].tone}>{NHAN_TRANG_THAI[d.status].nhan}</Badge> },
            { key: 'tuoi', header: 'Tuổi', render: (d) => tuoi(d.createdAt) },
          ]}
        />
      )}
      {list.hasNextPage && (
        <Button variant="secondary" block disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {list.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
        </Button>
      )}

      <KhongKhop />
      <ChiTietDonPanel id={id} onClose={() => doi('id', null)} />
    </div>
  );
}
```

- [ ] **Step 4: `chi-tiet.tsx` + test, `khong-khop.tsx`**

`features/orders/chi-tiet.test.tsx`:

```tsx
// @vitest-environment jsdom
import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChiTietDonPanel } from './chi-tiet';

const don = (status: string) => ({
  order: {
    id: 'd1', orderCode: 100001, noiDungChuyenKhoan: 'MLV100001', kind: 'plan', tier: 'starter', months: 1, quotaGroup: null, packs: null,
    moTa: 'Starter 1 tháng', amountVnd: 650_000, amountUsdCents: 2_500, status, checkoutUrl: null, linkExpiresAt: null, paidAt: null,
    paidAmountVnd: status === 'underpaid' ? 600_000 : null, fulfilledAt: null, fulfilError: null, fulfilAttempts: 0,
    createdAt: '2026-09-19T02:00:00Z', updatedAt: '2026-09-19T02:00:00Z', tenantId: 't', tenantName: 'Công ty Thử', accountId: 'a',
    paymentLinkId: 'l', entitlementReceipt: null, note: null,
  },
  events: [{ id: 1, orderId: 'd1', provider: 'payos', reference: 'FT1', orderCode: 100001, amountVnd: 600_000, signatureValid: true, tomTat: { code: '00' }, receivedAt: '2026-09-19T02:30:00Z' }],
  owner: { email: 'khach@vidu.vn', billingEmail: null },
});

const stub = (body: unknown) => vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })));
afterEach(() => vi.unstubAllGlobals());
const ve = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DelayedActionProvider><ChiTietDonPanel id="d1" onClose={() => {}} /></DelayedActionProvider>
  </QueryClientProvider>,
);

describe('ChiTietDonPanel', () => {
  it('underpaid: hiện sự kiện, số đã nhận, nút Xác nhận đã nhận tiền; KHÔNG có Thử cấp lại', async () => {
    stub(don('underpaid'));
    ve();
    expect(await screen.findByText('FT1')).toBeVisible();
    expect(screen.getByText('600.000đ')).toBeVisible();
    expect(screen.getByRole('button', { name: /Xác nhận đã nhận tiền/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Thử cấp lại/ })).toBeNull();
  });

  it('paid_unfulfilled: có Thử cấp lại, không có Xác nhận tay', async () => {
    stub(don('paid_unfulfilled'));
    ve();
    expect(await screen.findByRole('button', { name: /Thử cấp lại/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Xác nhận đã nhận tiền/ })).toBeNull();
  });

  it('form xác nhận tay khoá nút Gửi khi thiếu lý do hoặc mã ngân hàng', async () => {
    stub(don('pending'));
    ve();
    await userEvent.click(await screen.findByRole('button', { name: /Xác nhận đã nhận tiền/ }));
    const gui = screen.getByRole('button', { name: /Gửi xác nhận/ });
    expect(gui).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Lý do'), 'Thấy trong sao kê');
    expect(gui).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Mã tham chiếu ngân hàng'), 'FT9');
    expect(gui).toBeEnabled();
  });
});
```

`features/orders/chi-tiet.tsx`:

```tsx
import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, Button, ErrorState, LoadingSkeleton, useDelayedAction } from '@mapslibvn/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { loiVi } from '@/features/billing/error-vi';
import { useConfirmManual, useFulfil, useOrderDetail } from './hooks';
import { gioNgay, NHAN_TRANG_THAI } from './trang-thai';

interface Props {
  id: string | null;
  onClose: () => void;
}

const o = 'min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm';

export function ChiTietDonPanel({ id, onClose }: Props) {
  const chiTiet = useOrderDetail(id);
  const capLai = useFulfil();
  const xacNhan = useConfirmManual();
  const { schedule } = useDelayedAction();
  const [moForm, datMoForm] = useState(false);
  const [lyDo, datLyDo] = useState('');
  const [maNganHang, datMaNganHang] = useState('');
  const [soTien, datSoTien] = useState('');
  if (id === null) return null;

  const d = chiTiet.data?.order;
  const conThieu = d ? d.amountVnd - (d.paidAmountVnd ?? 0) : 0;

  /** operationId sinh MỘT lần cho mỗi lần bấm: đi cùng lệnh, gọi lại không tạo sự kiện thứ hai. */
  const guiXacNhan = () => {
    if (!d) return;
    const operationId = crypto.randomUUID().replace(/-/g, '');
    const body = { operationId, reason: lyDo.trim(), bankReference: maNganHang.trim(), ...(soTien ? { amountVnd: Number(soTien) } : {}) };
    schedule({
      label: `Xác nhận đã nhận ${dinhDangVnd(body.amountVnd ?? conThieu)} cho đơn ${d.orderCode}`,
      run: async () => { await xacNhan.mutateAsync({ id, body }); },
    });
    onClose();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-[var(--bg)] p-5 text-[var(--text)] lg:w-[520px]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-bold">{d ? `Đơn ${d.orderCode}` : 'Đơn hàng'}</Dialog.Title>
            <Dialog.Close asChild><Button variant="secondary" aria-label="Đóng">✕</Button></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Chi tiết đơn hàng và các lệnh xử lý</Dialog.Description>

          {chiTiet.isPending && <LoadingSkeleton rows={4} />}
          {chiTiet.isError && <ErrorState error={chiTiet.error} onRetry={() => void chiTiet.refetch()} />}
          {d && (
            <div className="mt-4 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={NHAN_TRANG_THAI[d.status].tone}>{NHAN_TRANG_THAI[d.status].nhan}</Badge>
                <span className="text-sm text-[var(--text-muted)]">{d.tenantName ?? d.tenantId}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-[var(--text-muted)]">Nội dung</dt><dd>{d.moTa}</dd>
                <dt className="text-[var(--text-muted)]">Giá</dt><dd>{dinhDangVnd(d.amountVnd)}</dd>
                <dt className="text-[var(--text-muted)]">Đã nhận</dt><dd>{d.paidAmountVnd === null ? '—' : dinhDangVnd(d.paidAmountVnd)}</dd>
                <dt className="text-[var(--text-muted)]">Chuyển khoản</dt><dd className="font-mono">{d.noiDungChuyenKhoan}</dd>
                <dt className="text-[var(--text-muted)]">Chủ tổ chức</dt><dd>{chiTiet.data?.owner?.email ?? '—'}</dd>
                <dt className="text-[var(--text-muted)]">Tạo</dt><dd>{gioNgay(d.createdAt)}</dd>
                <dt className="text-[var(--text-muted)]">Trả tiền</dt><dd>{gioNgay(d.paidAt)}</dd>
                <dt className="text-[var(--text-muted)]">Cấp gói</dt><dd>{gioNgay(d.fulfilledAt)}</dd>
                {d.fulfilError && (<><dt className="text-[var(--text-muted)]">Lỗi cấp gói</dt><dd className="font-mono text-red-700 dark:text-red-200">{d.fulfilError} (đã thử {d.fulfilAttempts} lần)</dd></>)}
                {d.checkoutUrl && (<><dt className="text-[var(--text-muted)]">PayOS</dt><dd><a className="underline" href={d.checkoutUrl} target="_blank" rel="noreferrer">link thanh toán</a></dd></>)}
              </dl>

              <section>
                <h3 className="text-sm font-bold">Dòng thời gian tiền vào</h3>
                {chiTiet.data?.events.length === 0 && <p className="mt-1 text-sm text-[var(--text-muted)]">Chưa có sự kiện nào.</p>}
                <ul className="mt-2 space-y-2">
                  {chiTiet.data?.events.map((s) => (
                    <li key={s.id} className="rounded-[var(--radius-btn)] border border-[var(--border)] p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono">{s.reference}</span>
                        <Badge tone={s.signatureValid ? 'success' : 'danger'}>{s.signatureValid ? 'chữ ký hợp lệ' : 'chữ ký SAI'}</Badge>
                      </div>
                      <p className="mt-1 text-[var(--text-muted)]">{s.provider} · {s.amountVnd === null ? 'không tính tiền' : dinhDangVnd(s.amountVnd)} · {gioNgay(s.receivedAt)}{typeof s.tomTat.code === 'string' ? ` · code ${s.tomTat.code}` : ''}</p>
                    </li>
                  ))}
                </ul>
              </section>

              {(d.status === 'paid' || d.status === 'paid_unfulfilled') && (
                <section className="space-y-2">
                  <Button block disabled={capLai.isPending} onClick={() => capLai.mutate(id)}>{capLai.isPending ? 'Đang cấp…' : 'Thử cấp lại'}</Button>
                  {capLai.data && <p className="text-sm">Kết quả: <strong>{capLai.data.ketQua}</strong></p>}
                  {capLai.isError && <p className="text-sm text-red-700 dark:text-red-200">{loiVi(capLai.error).cau}</p>}
                </section>
              )}

              {['pending', 'underpaid', 'expired'].includes(d.status) && !moForm && (
                <Button block variant="secondary" onClick={() => datMoForm(true)}>Xác nhận đã nhận tiền (tay)</Button>
              )}
              {moForm && (
                <form className="space-y-3 rounded-[var(--radius-card)] border border-amber-300 p-4" onSubmit={(e) => { e.preventDefault(); guiXacNhan(); }}>
                  <p className="text-sm">Chỉ dùng khi đã thấy tiền trong sao kê mà webhook không tới. Lệnh gửi sau 5 giây, huỷ được trong lúc đếm ngược.</p>
                  <label className="block text-sm font-semibold">Lý do<input aria-label="Lý do" className={`${o} mt-1`} value={lyDo} onChange={(e) => datLyDo(e.target.value)} maxLength={500} /></label>
                  <label className="block text-sm font-semibold">Mã tham chiếu ngân hàng<input aria-label="Mã tham chiếu ngân hàng" className={`${o} mt-1`} value={maNganHang} onChange={(e) => datMaNganHang(e.target.value)} maxLength={64} /></label>
                  <label className="block text-sm font-semibold">Số tiền (bỏ trống = phần còn thiếu {dinhDangVnd(conThieu)})<input aria-label="Số tiền" type="number" min={1} className={`${o} mt-1`} value={soTien} onChange={(e) => datSoTien(e.target.value)} /></label>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={!lyDo.trim() || !maNganHang.trim()}>Gửi xác nhận</Button>
                    <Button type="button" variant="secondary" onClick={() => datMoForm(false)}>Thôi</Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

`features/orders/khong-khop.tsx`:

```tsx
import { dinhDangVnd } from '@mapslibvn/catalog';
import { Badge, Card, CardTitle, LoadingSkeleton } from '@mapslibvn/ui';
import { useUnmatched } from './hooks';
import { gioNgay } from './trang-thai';

/** Webhook thử của PayOS, webhook sai chữ ký, và tiền vào mà không khớp đơn nào (spec 13). */
export function KhongKhop() {
  const um = useUnmatched();
  return (
    <Card>
      <CardTitle><span id="khong-khop">Giao dịch không khớp đơn</span></CardTitle>
      {um.isPending && <LoadingSkeleton rows={1} />}
      {um.data && um.data.items.length === 0 && <p className="mt-1 text-sm text-[var(--text-muted)]">Không có.</p>}
      <ul className="mt-2 space-y-2">
        {um.data?.items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={s.signatureValid ? 'warning' : 'danger'}>{s.signatureValid ? 'không khớp đơn' : 'chữ ký sai'}</Badge>
            <span className="font-mono break-all">{s.reference}</span>
            {s.orderCode !== null && <span>orderCode {s.orderCode}</span>}
            {s.amountVnd !== null && <span>{dinhDangVnd(s.amountVnd)}</span>}
            <span className="ml-auto text-xs text-[var(--text-muted)]">{gioNgay(s.receivedAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

`apps/admin/package.json` **chưa có** `@mapslibvn/catalog`: thêm `"@mapslibvn/catalog": "workspace:*"` vào `dependencies` rồi `pnpm install` — mọi chỗ in tiền ở trên import từ đó.

- [ ] **Step 5: Test, typecheck, build**

```bash
pnpm exec vitest run apps/admin/src
pnpm --filter @mapslibvn/admin typecheck && pnpm --filter @mapslibvn/admin build && pnpm --filter @mapslibvn/console build
```

Expected: PASS (17 e2e cũ chưa chạy ở đây); `routes.test.tsx`, `sidebar-nav.test.tsx` xanh với quyền mới.

- [ ] **Step 6: Commit**

```bash
git add apps/admin pnpm-lock.yaml
git commit -m "feat(admin): màn Đơn hàng tối thiểu — bốn ô, danh sách, chi tiết với dòng thời gian tiền vào, thử cấp lại, xác nhận tay, giao dịch không khớp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: e2e Playwright — khách mua, PayOS giả trả, gói vào; admin thấy đơn

**Files:**
- Create: `apps/console/e2e/helpers.ts`, `apps/console/e2e/don-hang.spec.ts`, `apps/admin/e2e/don-hang.spec.ts`
- Modify: `apps/console/e2e/console.spec.ts` (import helper thay vì định nghĩa tại chỗ)

- [ ] **Step 1: Tách helper đăng ký ra `apps/console/e2e/helpers.ts`**

Chuyển nguyên văn `emailMoi`, `xinMaVaDoc`, `nhapMa`, `dangNhap`, `dangKyLayKhoa` từ
`console.spec.ts` sang `helpers.ts` (thêm `export`), rồi `console.spec.ts` import từ `./helpers`.
Chạy `pnpm test:console-e2e` để chắc 8/8 vẫn xanh trước khi thêm bài mới.

- [ ] **Step 2: `apps/console/e2e/don-hang.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { FAKE_CHECKSUM, PAYOS_FAKE_PORT, dungWebhook } from '../../../scripts/lib/payos-fake.mjs';
import { dangKyLayKhoa, emailMoi } from './helpers';

const PAYOS_FAKE = `http://127.0.0.1:${PAYOS_FAKE_PORT}`;
const API = 'http://127.0.0.1:8799';

/** Mua Starter theo kỳ đã chọn, trả về mã đơn và id đơn đọc từ URL. */
async function muaStarter(page: import('@playwright/test').Page, ky: '1' | '3') {
  await page.goto('/console/mua');
  await page.getByRole('radio', { name: `${ky} tháng` }).check({ force: true });
  await page.getByRole('button', { name: /chọn Starter/i }).click();
  await page.getByRole('button', { name: /Thanh toán Starter/ }).click();
  await expect(page).toHaveURL(/\/console\/don-hang\/[0-9a-f-]{36}/);
  const id = page.url().split('/don-hang/')[1]?.split('?')[0] as string;
  const tieuDe = await page.getByRole('heading', { level: 1 }).innerText();
  const orderCode = Number(tieuDe.replace(/\D/g, ''));
  return { id, orderCode };
}

test('khách mua Starter 3 tháng: QR hiện, PayOS giả báo trả, trang tự chuyển "Đã cấp gói", Tổng quan hiện Starter với hạn 3 tháng', async ({ page }) => {
  await dangKyLayKhoa(page, emailMoi(), 'Công ty Mua Thật');
  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();

  const { orderCode } = await muaStarter(page, '3');
  await expect(page.getByText('1.950.000đ').first()).toBeVisible();
  await expect(page.getByText(`MLV${orderCode}`)).toBeVisible();
  await expect(page.getByRole('img', { name: /Mã QR/ })).toBeVisible();
  await expect(page.getByText('Chờ thanh toán')).toBeVisible();

  // "Chuyển khoản": PayOS giả đánh dấu đã trả và bắn webhook vào API — đúng đường production.
  const tra = await (await fetch(`${PAYOS_FAKE}/__fake/pay/${orderCode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webhookUrl: `${API}/v1/pay/payos/webhook` }) })).json();
  expect(tra.webhookStatus).toBe(200);

  // Poll 3 giây: không tải lại trang.
  await expect(page.getByText('Đã cấp gói')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Gói đã được cấp/)).toBeVisible();

  await page.getByRole('link', { name: 'Về Tổng quan' }).click();
  await expect(page.getByText('Starter').first()).toBeVisible();
  // Hết hạn ≈ hôm nay + 3 tháng: chỉ kiểm năm-tháng để không phụ thuộc giờ chạy.
  const hetHan = new Date();
  hetHan.setMonth(hetHan.getMonth() + 3);
  await expect(page.getByText(new RegExp(`/${String(hetHan.getMonth() + 1).padStart(2, '0')}/${hetHan.getFullYear()}`))).toBeVisible();
});

test('chuyển thiếu → trang nói rõ số đã nhận và số còn thiếu', async ({ page }) => {
  await dangKyLayKhoa(page, emailMoi(), 'Công ty Thiếu');
  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();
  const { orderCode } = await muaStarter(page, '1');
  const than = dungWebhook({ orderCode, amount: 600_000, reference: `FT-E2E-${orderCode}` }, FAKE_CHECKSUM);
  await fetch(`${API}/v1/pay/payos/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(than) });
  await expect(page.getByText('Thiếu tiền')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Đã nhận 600\.000đ, còn thiếu 50\.000đ/)).toBeVisible();
});

test('huỷ đơn: đếm ngược 5 giây rồi mới gửi; huỷ trong lúc đếm thì đơn vẫn chờ', async ({ page }) => {
  await dangKyLayKhoa(page, emailMoi(), 'Công ty Huỷ');
  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();
  await muaStarter(page, '1');
  await page.getByRole('button', { name: 'Huỷ đơn' }).click();
  await page.getByRole('button', { name: 'Huỷ', exact: true }).click(); // huỷ việc huỷ
  await page.waitForTimeout(6000);
  await expect(page.getByText('Chờ thanh toán')).toBeVisible();
  await page.getByRole('button', { name: 'Huỷ đơn' }).click();
  await expect(page.getByText('Đã huỷ')).toBeVisible({ timeout: 10_000 });
});

test('tài khoản khác mở đơn của mình → không tìm thấy', async ({ browser }) => {
  const goc = { baseURL: 'http://127.0.0.1:8799' };
  const ctxA = await browser.newContext(goc);
  const pageA = await ctxA.newPage();
  await dangKyLayKhoa(pageA, emailMoi(), 'Công ty A');
  await pageA.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();
  const { id } = await muaStarter(pageA, '1');

  const ctxB = await browser.newContext(goc);
  const pageB = await ctxB.newPage();
  await dangKyLayKhoa(pageB, emailMoi(), 'Công ty B');
  await pageB.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();
  await pageB.goto(`/console/don-hang/${id}`);
  await expect(pageB.getByRole('alert')).toContainText('Không tìm thấy đơn này');
  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 3: `apps/admin/e2e/don-hang.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';
import { PAYOS_FAKE_PORT } from '../../../scripts/lib/payos-fake.mjs';

const API = 'http://127.0.0.1:8799';
const ACCESS_JWT = signAccessJwt({ email: 'phong@e2e.local' });

/** Tạo một khách và một đơn Starter 1 tháng bằng API thuần, không qua giao diện console. */
async function taoDonKhach(request: import('@playwright/test').APIRequestContext) {
  const email = `admin-e2e-${Date.now()}@vidu.vn`;
  const xin = await request.post(`${API}/v1/console/auth/otp/request`, { headers: { 'Sec-Fetch-Site': 'same-origin' }, data: { email, turnstileToken: '' } });
  const ma = xin.headers()['x-debug-otp'];
  const xac = await request.post(`${API}/v1/console/auth/otp/verify`, { headers: { 'Sec-Fetch-Site': 'same-origin' }, data: { email, code: ma } });
  const cookie = (xac.headers()['set-cookie'] ?? '').split(';')[0] as string;
  const h = { cookie, 'Sec-Fetch-Site': 'same-origin' };
  await request.post(`${API}/v1/console/tenant`, { headers: h, data: { name: 'Công ty Admin E2E' } });
  const { order } = await (await request.post(`${API}/v1/console/orders`, { headers: h, data: { kind: 'plan', tier: 'starter', months: 1 } })).json();
  return order as { id: string; orderCode: number };
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': ACCESS_JWT });
});

test('admin thấy đơn mới, mở chi tiết, xác nhận tay → Đã cấp gói và sự kiện manual xuất hiện', async ({ page, request }) => {
  const don = await taoDonKhach(request);
  await page.goto('/admin/orders?status=pending');
  await expect(page.getByText(String(don.orderCode)).first()).toBeVisible();
  await page.getByRole('button', { name: String(don.orderCode) }).click();
  await page.getByRole('button', { name: /Xác nhận đã nhận tiền/ }).click();
  await page.getByLabel('Lý do').fill('E2E thấy tiền trong sao kê');
  await page.getByLabel('Mã tham chiếu ngân hàng').fill('FT-E2E');
  await page.getByRole('button', { name: /Gửi xác nhận/ }).click();
  // Ngăn đóng ngay, toast đếm ngược 5 giây rồi gửi.
  await page.waitForTimeout(6500);
  await page.goto(`/admin/orders?status=fulfilled&id=${don.id}`);
  await expect(page.getByText('Đã cấp gói').first()).toBeVisible();
  await expect(page.getByText('manual:')).toBeVisible();
  await expect(page.getByText('chữ ký hợp lệ')).toBeVisible();
  // Trả về `/__fake/pay` KHÔNG dùng ở bài này: đây là đường xác nhận tay, không có PayOS.
  expect((await request.get(`http://127.0.0.1:${PAYOS_FAKE_PORT}/healthz`)).ok()).toBeTruthy();
});
```

- [ ] **Step 4: Chạy**

```bash
pnpm test:console-e2e
pnpm test:admin-e2e
```

Expected: console 12/12 (8 cũ + 4 mới), admin 18/18 (17 cũ + 1 mới). Bài "khách mua Starter" là
lời hứa của pha này; nó phải đi qua webhook thật của API, không được gọi tắt vào DB.

- [ ] **Step 5: Commit**

```bash
git add apps/console/e2e apps/admin/e2e
git commit -m "test(e2e): khách mua gói và nhận gói qua webhook PayOS giả; thiếu tiền; huỷ; cách ly tenant; admin xác nhận tay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: Bốn tầng cổng, tài liệu, chứng cứ, việc tay của PHONG và bàn giao

**Files:**
- Create: `docs/evidence/commerce/2026-09-19-pha-3-thanh-toan.md`
- Modify: `README.md`, `docs/DEVLOG.md`

- [ ] **Step 1: Chạy ĐÚNG những lệnh CI chạy — cả sáu, không bỏ `test:db`**

```bash
pnpm lint
node scripts/notices-sync.mjs --check
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:api-db
pnpm test:admin-e2e
pnpm test:console-e2e
pnpm exec vitest run --config vitest.db.config.ts db/commerce-grant.dbtest.mjs
```

Pha 2 đã đỏ CI một lần vì bỏ `pnpm test:db` (schema.dbtest chốt số bảng và cột UPDATE). Ghi
từng con số vào chứng cứ.

- [ ] **Step 2: README — mục "Thanh toán"**

Sau mục "Website quảng bá" thêm:

```markdown
## Thanh toán (PayOS)

- Khách mua gói ở `/console/mua`; tiền về tài khoản ngân hàng đã liên kết với PayOS; gói tự vào sổ
  quota khi webhook tới (`POST /v1/pay/payos/webhook`), cron 5 phút đối soát phòng webhook rơi.
- Ba secret production: `wrangler secret put PAYOS_CLIENT_ID|PAYOS_API_KEY|PAYOS_CHECKSUM_KEY --env production`.
- Thử ở máy: `pnpm test:api-db` dựng PayOS giả (`scripts/lib/payos-fake.mjs`, cổng 8791);
  `pnpm pay:fake-webhook --order-code <mã> --amount <tiền>` bắn một webhook đã ký vào harness.
  Script từ chối trỏ vào production.
- Admin: `/admin/orders` — thử cấp lại, xác nhận tay khi thấy tiền trong sao kê mà webhook không tới.
```

- [ ] **Step 3: Chứng cứ `docs/evidence/commerce/2026-09-19-pha-3-thanh-toan.md`** theo khuôn pha 2:

1. Bảng cổng với số thật (lint, typecheck, test, test:db, test:api-db, hai bộ e2e, grant dbtest).
2. Lời hứa của pha, chứng minh bằng itest và e2e: liệt kê từng bài với tick.
3. Quyền database đã kiểm bằng role thật: 5 bài của `commerce-grant.dbtest.mjs`, kể cả sáu câu
   bị từ chối.
4. Bất biến tiền và bài kiểm tương ứng (bảng 0.2 với cột "đã chứng minh ở").
5. Điểm lệch spec (mục 0.3) và lỗi phát hiện trong lúc làm (ít nhất: `audit()` của pha 2).
6. **Việc tay của PHONG, theo thứ tự, có đánh dấu bước nào chạm production:**

   1. **Đăng ký PayOS** tại `my.payos.vn`: xác thực CCCD, liên kết tài khoản ngân hàng nhận tiền,
      tạo **kênh thanh toán**. Hỏi PayOS hai điều và ghi câu trả lời vào chứng cứ: (a) hạn mức số
      tiền tối đa một link — đơn lớn nhất của catalog là 124.800.000 ₫; (b) biểu phí thực tế.
   2. Lấy `Client ID`, `API Key`, `Checksum Key` của kênh. **Không** dán vào chat, file, hay
      `wrangler.toml`. Đặt bằng:
      ```
      wrangler secret put PAYOS_CLIENT_ID --env production
      wrangler secret put PAYOS_API_KEY --env production
      wrangler secret put PAYOS_CHECKSUM_KEY --env production
      ```
      Bài học pha 2: kết quả công cụ in liền `IMPORTANT` vào đuôi khoá Resend. Dán từ bảng điều
      khiển PayOS, kiểm ký tự cuối.
   3. **Chạy migration `0023` trên máy chủ** (`pnpm server:migrate` từ máy chủ Ubuntu), đối chiếu
      `/healthz/db` báo `0023_customer_order.sql`. Deploy trước migration đã từng làm chết API.
   4. Push → Deploy API xanh (cổng `check:migration` nhả sau bước 3).
   5. **Đăng ký webhook URL** `https://api.ai-solutions.io.vn/v1/pay/payos/webhook` trong kênh
      thanh toán ở `my.payos.vn`. PayOS bắn một webhook mẫu và đòi 2XX: API trả
      `{ received: true, matched: false }` và admin thấy một dòng ở "Giao dịch không khớp đơn" —
      đó là dấu hiệu đúng, không phải lỗi.
   6. **Nghiệm thu bằng tiền thật, đơn nhỏ trước.** PayOS không có sandbox. Cách rẻ nhất:
      - Ở `/admin/billing`, cấp cho tenant của chính PHONG một kỳ Starter bằng lệnh `grantPeriod`
        sẵn có (không tốn tiền), để tenant ở trạng thái trả phí đang hoạt động.
      - Ở `/console/mua`, tab "Mua thêm lượt", mua **1 khối Places = 26.000 ₫**. Chuyển khoản bằng
        QR. Kiểm: đơn `fulfilled` trong 60 giây; Tổng quan cộng 1.000 lượt; email biên nhận về;
        `/admin/orders` có đơn với sự kiện `signature_valid = true`; `admin_audit` có `order.paid`
        và `order.fulfilled`.
      - Sau đó mới mua **Starter 1 tháng = 650.000 ₫** để đóng tiêu chí 20.5 nguyên văn (kỳ mới
        xếp sau kỳ đã cấp tay, hiệu lực từ ngày kết thúc kỳ đó — đúng luật 9.3).
      - Bắn lại đúng webhook thật lần hai (PayOS có nút gửi lại trong lịch sử giao dịch, hoặc
        `curl` với thân đã ghi trong `payment_event.payload`): 200, không có kỳ thứ hai
        (tiêu chí 20.6).
      - Tiêu chí 20.7 (tắt webhook, cron đối soát cấp trong 10 phút) và 20.8 (chuyển thiếu) đã
        chứng minh trên harness; làm thật chỉ khi PHONG muốn chi thêm một đơn 26.000 ₫ mỗi tiêu chí.
   7. Rollback nếu cần: `wrangler` rollback Worker về bản trước; migration lùi bằng
      `0023_customer_order.down.sql` **chỉ khi chưa có đơn thật nào** — có đơn rồi thì không lùi
      schema, chỉ tắt tạo đơn bằng cách xoá ba secret (route trả 503, webhook trả 503, không mất
      dữ liệu).

- [ ] **Step 4: DEVLOG mục 23** theo khuôn mục 20: làm gì, lệch spec chỗ nào (mục 0.3), bẫy nào
  đã vấp, cổng nào đã chạy, và **một mục riêng về lỗi `audit()` của pha 2** — vì sao không ai
  thấy (không bài kiểm nào đọc `admin_audit` sau thao tác của khách) và bài kiểm nào giờ canh nó.

- [ ] **Step 5: Commit và bàn giao**

```bash
git add README.md docs/DEVLOG.md docs/evidence/commerce/2026-09-19-pha-3-thanh-toan.md
git commit -m "docs: chứng cứ pha 3, DEVLOG mục 23, README mục thanh toán

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Báo PHONG rõ bốn điều: (1) push xong thì Deploy API **sẽ đỏ** ở cổng `check:migration` cho tới
khi PHONG chạy `0023` trên máy chủ — đó là cổng làm đúng việc; (2) khách **chưa** mua được cho tới
khi đủ ba secret PayOS — màn Mua hiện "Thanh toán trực tuyến chưa mở"; (3) webhook URL đăng ký
**sau** deploy, và dòng "không khớp đơn" đầu tiên là webhook thử của PayOS; (4) nghiệm thu tiền
thật theo đúng thứ tự mục 6, đơn 26.000 ₫ trước.

---

## Self-review

**Phủ spec:** 5.2 migration (Task 2, số 0023) · 5.3 máy trạng thái (Task 5 UPDATE có điều kiện,
Task 7) · 9.1 tạo đơn (Task 10) · 9.2 webhook tám bước (Task 9; bước 6 đổi thành tổng sự kiện —
0.3.3) · 9.3 `fulfilOrder` (Task 6, 7) · 9.4 cron hai lịch (Task 11) · 9.5 gia hạn/nâng/hạ/trial
(Task 6 `tinhStartsAt`, Task 16 cảnh báo trial) · 10 email biên nhận/thiếu tiền/nhắc hạn (Task 8)
· 12 ba màn còn thiếu + Tổng quan (Task 16) · 13 phần tối thiểu + xác nhận tay (Task 12, 17) · 14
API console/webhook/admin (Task 9, 10, 12) · 15 bảo mật (bất biến 1–8, Task 3 hằng thời gian, Task
9 rate limit) · 16 secret và việc tay (Task 4, 19) · 17 kiểm thử ba tầng (Task 13, 15, 18) · 18 rủi
ro (bảng 0.2) · 19 pha 3 kết thúc bằng "tự trả tiền, gói tự vào sổ" (Task 15 bài đầu, Task 18 bài
đầu) · 20 tiêu chí 5–11 (Task 15, 19).

**Lệch spec có chủ ý** — bảy điểm ở mục 0.3, ghi vào DEVLOG (Task 19).

**Placeholder:** không có "TBD/TODO/thêm xử lý lỗi". Chỗ duy nhất giao bằng mô tả là Task 19 bước
3–4 (chứng cứ và DEVLOG), vì nội dung là số đo lúc chạy.

**Nhất quán kiểu và tên:** `kyTaoLink`, `chuoiKyDuLieu`, `kyDuLieu`, `khopChuKy`, `soSanhHangSo`
(Task 3) dùng ở Task 4, 9, 14. `PayosPort{taoLink,docLink,huyLink,checkoutUrlTuId}`, `PayosError`,
`chonPayosPort` (Task 4) dùng ở Task 10, 11. `DonHang`, `TrangThaiDon`, `SuKienMoi`, `taoDon`,
`timDonPendingChuaCoLink`, `luuLinkThanhToan`, `docDonCuaTenant`, `danhSachDonCuaTenant`,
`demDonPending`, `docDon`, `docDonTheoOrderCode`, `ghiSuKienThanhToan`, `tongTienDaNhan`,
`datDaTra`, `datThieuTien`, `datDaCap`, `datCapHong`, `datHetHan`, `huyDonCuaTenant`,
`donCanCapLai`, `donPendingCanDoiSoat`, `donPendingQuaHan`, `coSuKienHopLe`, `daCoSuKien`,
`chuTenant`, `tenantThuongMaiCoChu`, `daNhacRoi`, `donDepPhienVaMa`, `danhSachDonAdmin`,
`suKienCuaDon`, `suKienKhongKhop`, `tomTatDon`, `noiDungChuyenKhoan` (Task 5) dùng ở Task 7, 9,
10, 11, 12, 13. `tinhStartsAt`, `daCapChoDon`, `maLoi` (Task 6) dùng ở Task 7, 10, 11.
`fulfilOrder`, `apDungThanhToan`, `CongSo`, `FulfilDeps`, `KetQuaCap`, `KetQuaApDung`,
`ACTOR_HE_THONG`, `TRAN_THU_CAP` (Task 7) dùng ở Task 9, 10, 11, 12. `guiThuGiaoDich` (Task 8),
`thongBaoSauApDung`, `nguoiNhan`, `ThongBaoDeps` (Task 9) dùng ở Task 11, 12. `donJson` (Task 10)
dùng ở Task 12. `chayCron`, `phanLoaiNhac`, `CRON_MOI_5_PHUT`, `CRON_HANG_NGAY` (Task 11) dùng ở
`index.ts`. `dinhDangVnd`, `dinhDangSo`, `dinhDangUsd`, `TEN_GOI` (Task 16 bước 1) dùng ở Task 8,
16, 17. `dungWebhook`, `FAKE_CHECKSUM`, `PAYOS_FAKE_PORT` (Task 14) dùng ở Task 15, 18.

**Rủi ro lớn nhất và chỗ chặn:** (1) cấp gói hai lần — ba tầng idempotent, kiểm ở Task 7 (unit),
15 (itest replay), 19 (webhook thật gửi lại); (2) webhook giả — chữ ký trước mọi thứ, Task 3 vector,
Task 9, Task 15; (3) thiếu GRANT trên production — Task 13 chạy nguyên văn từng câu dưới role `api`,
kể cả sáu câu phải bị từ chối; (4) `expectedRevision` làm `operation_conflict` sau lần cấp thành
công — Task 7 bài "operation_conflict mà lịch sử đã có lineItemId"; (5) PayOS không có sandbox —
mọi tầng tự động chạy trên bản giả ký đúng thuật toán, nghiệm thu thật đi từ đơn 26.000 ₫.
