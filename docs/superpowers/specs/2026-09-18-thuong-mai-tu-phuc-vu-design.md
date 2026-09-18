# Đặc tả thương mại hoá tự phục vụ — website, cổng khách hàng, thanh toán, admin

Ngày: 18/09/2026. PHONG duyệt hướng A qua phiên brainstorming cùng ngày.
Nối tiếp spec quota (`2026-09-15-quota-thue-bao-design.md`, phần "ngoài phạm vi: thanh toán,
đăng ký, console") và spec trang Admin (`2026-09-16-trang-admin-react-design.md`).
Nguồn giá: `docs/research/2026-09-14-thuong-mai-hoa-va-gia-chot.md`.

Bốn mảng nằm trong một spec vì chúng dùng chung một mô hình dữ liệu và một hệ thiết kế; rủi ro
"dài quá làm dở" xử lý bằng cách chia pha ở mục 19, mỗi pha kết thúc là một thứ dùng được và có
plan riêng.

## 1. Mục tiêu và phạm vi

Người lạ vào website, hiểu sản phẩm, xem giá, tự đăng ký, tự lấy khoá, gọi API trong 5 phút, tự
trả tiền bằng QR ngân hàng, và gói tự vào sổ quota mà PHONG không phải chạm tay. PHONG nhìn thấy
từng khách, từng đơn, từng đồng, và can thiệp được khi máy không tự xử lý nổi.

Trong phạm vi:

1. **Website quảng bá** `apps/site` — tĩnh, tối ưu SEO, bảng giá so sánh đối thủ.
2. **Cổng khách hàng** `/console` — đăng nhập OTP và Google, tenant, trial, khoá API, mức dùng.
3. **Mua và thanh toán** — đơn hàng, PayOS, webhook, cấp gói tự động, mua thêm lượt, gia hạn,
   email biên nhận và nhắc hạn.
4. **Admin mở rộng** — màn Khách hàng, màn Đơn hàng & giao dịch, xác nhận tay, thử cấp lại.

Ngoài phạm vi có chủ ý — xem mục 21.

## 2. Các quyết định đã chốt

| Hạng mục | Quyết định | Ghi chú |
|---|---|---|
| Kiến trúc | **Hướng A**: mở rộng monorepo, cùng Worker | Website Astro tĩnh trên Pages; console React SPA do Worker phục vụ tại `/console`, API `/v1/console/*` cùng origin |
| Công nghệ website | **Astro 7 tĩnh**, island React chỉ ở chỗ tương tác | PHONG hỏi "React có tốt cho SEO không": SPA thuần thì không; Astro dựng sẵn HTML nên tốt nhất. Repo đã có Astro và `@astrojs/react` |
| Cổng thanh toán | **PayOS** | Miễn phí không giới hạn cho cá nhân/HKD từ 23/01/2026, xác thực CCCD không cần MST, ngân hàng MB/OCB/KienlongBank/ACB/BIDV. Có trang checkout, QR, `returnUrl`, webhook ký HMAC-SHA256. SePay chỉ khớp biến động số dư, không có checkout |
| Đăng nhập khách | **Email OTP + Google OAuth** | Không có mật khẩu |
| Đồng tiền | **VND chính, USD phụ** | 650.000 / 2.600.000 / 10.400.000 đ mỗi tháng; mua thêm 26.000 đ / 78.000 đ mỗi 1.000 lượt. USD hiện mờ bên cạnh theo tỷ giá tham chiếu 26.000, ghi rõ là tham chiếu |
| Kỳ mua | **1, 3, 6, 12 tháng, giá nhân đơn** | Không chiết khấu. Không trừ tiền định kỳ |
| Email | **Resend gói miễn phí** | 3.000/tháng, 100/ngày. Cloudflare Email Sending chỉ có trên Workers Paid; tài khoản đang Free (`wrangler email sending list` trả 2036 Unauthorized) |
| Người gửi / hỗ trợ | Gửi từ `no-reply@ai-solutions.io.vn`, Reply-To và email hỗ trợ `dotienphong1993@gmail.com` | Resend không gửi được từ Gmail |
| Tên miền | **Deploy `mapslibvn-site.pages.dev` trước, đổi sau** | PHONG chọn; SEO tính lại khi đổi, cần 301 toàn site lúc chuyển. Mọi URL tuyệt đối đi qua một biến `SITE_URL` |
| Phân quyền admin | Giữ nguyên: Access + `BILLING_ADMIN_EMAILS` | Thao tác tiền trong admin đứng sau `requireBillingAccess()` |

## 3. Hiện trạng đã kiểm tra (18/09/2026, HEAD `9fd36f1`)

- Sổ quota Durable Object đã có đủ lệnh: `activateTrial`, `grantPeriod(periodId, tier, startsAt,
  endsAt, paymentReference, lineItemId)`, `addCredits(periodId, group, packs, …)`, `suspend`,
  `resume`. Mọi lệnh đòi `expectedRevision` khớp `revision` hiện tại và `operationId` idempotent;
  cặp `(paymentReference, lineItemId)` là định danh tài chính chống cấp hai lần.
- Luật chồng kỳ trong `quota-object.ts`: `grantPeriod` **từ chối** `period_overlap` nếu kỳ mới
  đè lên kỳ có sẵn, **trừ** khi kỳ bị đè là trial và tenant đang trial — lúc đó trial bị cắt đúng
  tại `startsAt`. `addCredits` đòi `status = active`, `tier ≠ trial` và `periodId` đúng kỳ đang
  chạy; credit hết hạn cùng kỳ.
- `PLAN_CATALOG` chỉ có `priceCents` USD, nằm trong `apps/api/src/billing/catalog.ts`; admin đọc
  qua `/v1/admin/plan-catalog`. Chưa có giá VND ở đâu trong mã.
- Schema: `tenant(id, name, plan internal|free|paid, quota_mode legacy|commercial, created_at)`.
  Role `api` chỉ có `SELECT` trên `tenant` cộng `UPDATE (quota_mode)`; **chưa có `INSERT`**.
  `api_key` đã có `INSERT` (0018) và `UPDATE (active, revoked_at)` (0016).
- Không có bảng tài khoản khách, phiên, đơn hàng, giao dịch. Không có mã gửi email. Không có
  handler `scheduled` và không có `[triggers]` trong `wrangler.toml`.
- `apps/admin` là SPA React 19 + Vite + Tailwind v4, có bộ `components/ui`, `states`, `data-view`,
  `delayed-action`, `fetcher`, `theme` dùng lại được cho console.
- `apps/docs` Astro 7 + Starlight + `@astrojs/react`, deploy Pages `mapslibvn-docs` qua
  `deploy-docs.yml`. Trang chủ nhúng `/playground.html?embed=1` bằng iframe.
- Worker phục vụ SPA qua `[assets] directory = "../admin/dist"`, fallback `index.html` chỉ cho
  đường dẫn không có phần mở rộng dưới `/admin/*` (sự cố 16/09).
- Cổng chống CSRF `requireSameSitePost()` xuất khẩu từ `routes/admin.ts`; audit ghi bằng
  `audit(c, action, target, detail)` trong `waitUntil`, `actor` lấy từ `c.get('reviewer')`.
- `vitest.config.ts` gốc chạy test `apps/admin/src/**`; `apps/api` chạy vitest-pool-workers riêng.
- Máy chủ DB là Mac ở nhà, có thể ngủ (memory `may-chu-mac-ngu-dem`): mọi việc chạy theo cron
  phải chịu được DB không trả lời.

## 4. Kiến trúc và ranh giới

```
Trình duyệt khách                    Cloudflare
┌────────────────────┐   ┌──────────────────────────────────────────────────────┐
│ mapslibvn-site     │   │ Pages: apps/site (HTML tĩnh, SEO)                     │
│ .pages.dev         │──▶│   "Bắt đầu miễn phí" → api.…/console/                 │
└────────────────────┘   ├──────────────────────────────────────────────────────┤
┌────────────────────┐   │ Worker mapslibvn-api (một Worker, một origin)         │
│ api.ai-solutions   │──▶│  /console/*        SPA apps/console (assets)          │
│ .io.vn/console     │   │  /v1/console/*     API khách, cookie phiên, CSRF       │
└────────────────────┘   │  /v1/pay/payos/webhook  server-to-server, ký HMAC     │
┌────────────────────┐   │  /admin/*, /v1/admin/*  như hiện tại + 2 màn mới      │
│ PayOS              │──▶│  scheduled()        cron 5 phút + cron ngày            │
└────────────────────┘   │  QuotaObject (DO)   sổ quota — KHÔNG đổi hợp đồng     │
                         └──────────┬─────────────────────┬─────────────────────┘
                                    ▼                     ▼
                              Postgres (Hyperdrive)    Resend (email)
```

Ranh giới bắt buộc giữ:

- **Sổ quota không học thêm khái niệm nào.** Đơn hàng, tiền, khách là chuyện của Postgres; sổ chỉ
  nhận đúng các lệnh đã có. Nhờ vậy phần tài chính mới không kéo theo rủi ro cho phần đếm lượt
  đang chạy production.
- **Một Worker, một origin** cho console và API khách: cookie `HttpOnly` đi thẳng, không CORS,
  không token trong `localStorage`. Khi mua tên miền, cùng Worker gắn thêm hostname
  `console.<tên miền>`; cookie theo host nên không phải đổi mã.
- **Website không gọi API lúc render.** Giá và bảng so sánh đọc từ `@mapslibvn/catalog` lúc
  build; đổi giá là một commit và một deploy, có lịch sử git.
- `features/*/api.ts` không import React; `page.tsx` không tự `fetch` — giữ đúng quy ước của
  `apps/admin`.

### 4.1. Hai package nội bộ mới

| Package | Nội dung | Ai dùng |
|---|---|---|
| `@mapslibvn/catalog` (`packages/catalog`) | `PLAN_CATALOG` chuyển từ `apps/api` sang, thêm `priceVnd`; `COMPARISON` (bảng so sánh Google/VIETMAP, ngày đối chiếu, giả định, nguồn); hàm `quoteOrder()` tính tiền một đơn; `addMonths()` | api, site, console, admin |
| `@mapslibvn/ui` (`packages/ui`) | Chuyển từ `apps/admin/src`: `components/ui/*`, `states.tsx`, `data-view.tsx`, `delayed-action.tsx`, `lib/utils.ts`, `lib/theme.ts`, và `tokens.css` (biến màu, bo góc, font) | admin, console; `tokens.css` còn dùng cho site |

Cả hai `private: true`, không publish. `scripts/lib/npm-sdk-release.mjs` chỉ đòi phân loại package
**public** (`manifest.private !== true`), nên không cần thêm vào `NON_SDK_PACKAGE_DIRS` — kiểm lại
18/09/2026 khi làm pha 0.
Chuyển file kèm test đi theo; `apps/admin` đổi import; bộ test admin phải xanh y nguyên sau khi
chuyển — đây là pha 0, không đổi hành vi.

## 5. Dữ liệu và migration

Hai migration, mỗi cái kèm `.down.sql`, **`GRANT` cho role `api` nằm ngay trong migration** và cấp
theo cột khi chỉ cần vài cột (bài học 0016).

### 5.1. `0020_customer.sql` — tài khoản, phiên, thành viên

```sql
CREATE TABLE customer_account (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),
  name            text,
  google_sub      text UNIQUE,
  trial_tenant_id uuid REFERENCES tenant (id),      -- mỗi tài khoản một trial
  last_login_at   timestamptz,
  disabled_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_login_code (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  code_hash   text NOT NULL,                       -- sha256(mã + SESSION_PEPPER)
  expires_at  timestamptz NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_login_code_email_idx ON customer_login_code (email, created_at DESC);

CREATE TABLE customer_session (
  token_hash   text PRIMARY KEY,                    -- sha256(token); token chỉ nằm trong cookie
  account_id   uuid NOT NULL REFERENCES customer_account (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text,
  ip_hash      text                                 -- băm kèm pepper như poi_edit, không IP thô
);
CREATE INDEX customer_session_account_idx ON customer_session (account_id);

CREATE TABLE tenant_member (
  tenant_id  uuid NOT NULL REFERENCES tenant (id),
  account_id uuid NOT NULL REFERENCES customer_account (id),
  role       text NOT NULL CHECK (role IN ('owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, account_id)
);
CREATE INDEX tenant_member_account_idx ON tenant_member (account_id);

-- Thông tin in trên biên nhận; nullable, khách điền ở Cài đặt.
ALTER TABLE tenant
  ADD COLUMN billing_name text, ADD COLUMN billing_tax_code text,
  ADD COLUMN billing_address text, ADD COLUMN billing_email text;

GRANT SELECT, INSERT ON customer_account TO api;
GRANT UPDATE (name, google_sub, trial_tenant_id, last_login_at, disabled_at) ON customer_account TO api;
GRANT SELECT, INSERT, DELETE ON customer_login_code TO api;
GRANT UPDATE (attempts, consumed_at) ON customer_login_code TO api;
GRANT USAGE, SELECT ON SEQUENCE customer_login_code_id_seq TO api;
GRANT SELECT, INSERT, DELETE ON customer_session TO api;
GRANT UPDATE (last_seen_at, expires_at) ON customer_session TO api;
GRANT SELECT, INSERT ON tenant_member TO api;
GRANT INSERT ON tenant TO api;                      -- console tự tạo tenant; 0005 chỉ cho SELECT
GRANT UPDATE (name, billing_name, billing_tax_code, billing_address, billing_email) ON tenant TO api;
```

Mô hình cho phép một tài khoản thuộc nhiều tenant, nhưng **giao diện giai đoạn này chỉ dùng
tenant đầu tiên** mà tài khoản là `owner`. Bảng `tenant_member` tồn tại để sau này thêm thành viên
không phải đổi schema.

### 5.2. `0021_customer_order.sql` — đơn hàng và giao dịch

```sql
-- PayOS đòi orderCode là số nguyên duy nhất; description tối đa 9 ký tự với tài khoản ngân hàng
-- chưa liên kết → nội dung chuyển khoản là "MLV" + orderCode, đủ 9 ký tự tới 999999.
CREATE SEQUENCE customer_order_code_seq START 100001;

CREATE TABLE customer_order (
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
CREATE INDEX customer_order_tenant_idx ON customer_order (tenant_id, created_at DESC);
CREATE INDEX customer_order_status_idx ON customer_order (status, created_at DESC);

-- Mọi webhook nhận được, kể cả không khớp đơn nào. `reference` của PayOS là khoá idempotent.
CREATE TABLE payment_event (
  id              bigserial PRIMARY KEY,
  order_id        uuid REFERENCES customer_order (id),  -- NULL khi không khớp đơn
  provider        text NOT NULL,
  reference       text NOT NULL,
  order_code      bigint,
  amount_vnd      bigint,
  signature_valid boolean NOT NULL,
  payload         jsonb NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, reference)
);

GRANT SELECT, INSERT ON customer_order TO api;
GRANT UPDATE (status, payment_link_id, checkout_url, qr_code, link_expires_at, paid_at,
              paid_amount_vnd, fulfilled_at, fulfil_attempts, fulfil_error,
              entitlement_receipt, note, updated_at) ON customer_order TO api;
GRANT USAGE, SELECT ON SEQUENCE customer_order_code_seq TO api;
GRANT SELECT, INSERT ON payment_event TO api;
GRANT USAGE, SELECT ON SEQUENCE payment_event_id_seq TO api;
```

### 5.3. Máy trạng thái đơn hàng

```
pending ──(webhook đủ tiền)──▶ paid ──(sổ quota nhận lệnh)──▶ fulfilled
   │                             │
   │                             └──(sổ quota từ chối/lỗi)──▶ paid_unfulfilled ──(cron/admin thử lại)──▶ fulfilled
   ├──(webhook thiếu tiền)──▶ underpaid ──(admin xác nhận tay)──▶ fulfilled
   ├──(link hết hạn, PayOS EXPIRED/CANCELLED)──▶ expired
   └──(khách/admin huỷ)──▶ cancelled
fulfilled ──(admin đánh dấu)──▶ refunded        (chỉ ghi nhận; hoàn tiền làm ngoài hệ thống)
```

Hai bất biến: **tiền đã ghi nhận thì không mất** — webhook hợp lệ tới cho đơn `expired` hay
`cancelled` vẫn chuyển sang `paid` rồi cấp gói, vì tiền đã rời tài khoản khách; và **`fulfilled`
chỉ đặt sau khi sổ quota trả biên lai**, không đặt trước rồi hy vọng.

## 6. Xác thực khách hàng

### 6.1. Email OTP

1. `POST /v1/console/auth/otp/request { email, turnstileToken }` — kiểm Turnstile với
   `TURNSTILE_SECRET`; chuẩn hoá email về chữ thường; giới hạn **1 mã/phút mỗi email** và **3 yêu
   cầu/phút mỗi IP** bằng hai Rate Limiting binding `OTP_EMAIL_RATE_LIMITER` và
   `OTP_IP_RATE_LIMITER` (binding này chỉ có chu kỳ 10 hoặc 60 giây; không dùng KV vì Workers Free
   1.000 ghi/ngày). Kiểm ngân sách email ngày (mục 10) trước khi gửi. Sinh mã 6 số bằng
   `crypto.getRandomValues`, lưu `sha256(mã + SESSION_PEPPER)`, hết hạn 10 phút, mã cũ của cùng
   email bị xoá. Gửi email. **Luôn trả 200** cùng câu "Nếu email hợp lệ, mã đã được gửi" để không
   lộ email nào đã đăng ký; riêng hai lỗi hạ tầng 503 `email_not_configured` và
   `email_budget_exhausted` thì nói thật, vì khách cần biết phải chờ.
2. `POST /v1/console/auth/otp/verify { email, code }` — tối đa 5 lần thử một mã, sai lần thứ 5
   thì mã chết. Đúng thì `consumed_at`, upsert `customer_account`, tạo phiên (6.3), trả
   `{ onboarded: boolean }`.
3. Ngoài production (`ENVIRONMENT !== 'production'`) và khi `OTP_DELIVERY = 'debug'`, mã trả thêm
   trong header `X-Debug-Otp` để e2e chạy được mà không cần hộp thư. Cờ này **không có tác dụng**
   ở production dù đặt nhầm.

### 6.2. Google OAuth (OIDC, authorization code + PKCE)

- `GET /v1/console/auth/google/start` — sinh `state` và `code_verifier`, đặt vào cookie
  `mlv_oauth` (HttpOnly, 10 phút), chuyển hướng tới `accounts.google.com` với
  `scope=openid email profile`, `redirect_uri = <origin>/v1/console/auth/google/callback`.
- `GET /v1/console/auth/google/callback` — kiểm `state`, đổi `code` lấy token bằng
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, xác thực `id_token` RS256 theo JWKS
  `https://www.googleapis.com/oauth2/v3/certs` (cache KV 1 giờ), kiểm `iss`, `aud`, `exp`, và
  **bắt buộc `email_verified = true`**. Khớp tài khoản theo email; ghi `google_sub` lần đầu; nếu
  `google_sub` đã gắn email khác thì 409 `google_account_mismatch`. Tạo phiên, chuyển hướng
  `/console/`.
- Module `console/google.ts` tự có phần xác thực JWT của nó, **không sửa `access.ts`**: đó là
  mã bảo mật đang chạy cho admin, trùng ~30 dòng còn rẻ hơn rủi ro đụng vào.

### 6.3. Phiên và CSRF

- Token 32 byte ngẫu nhiên, cookie `mlv_console_session`: `HttpOnly; Secure; SameSite=Lax;
  Path=/`. `Path=/` vì cookie phải tới cả `/console/*` lẫn `/v1/console/*`. DB chỉ giữ
  `sha256(token)`.
- Sống 30 ngày, gia hạn trượt khi còn dưới 15 ngày. Đăng xuất xoá dòng và xoá cookie. Tài khoản
  `disabled_at` thì mọi phiên bị từ chối 403 `account_disabled` và bị xoá ở lần chạm kế tiếp.
- Middleware `requireCustomer()` cho `/v1/console/*` (trừ nhóm `auth/*` và `catalog`): đọc cookie,
  tra phiên, nạp membership, gán `c.set('customer', { accountId, email, tenantId | null })`.
  Thiếu hoặc hỏng → 401 `not_signed_in` dạng JSON; SPA thấy 401 là chuyển về màn đăng nhập.
- POST/PATCH đi qua đúng `requireSameSitePost()` sẵn có. Cookie `SameSite=Lax` cộng cổng này là
  đủ; không cần token CSRF riêng.
- Đăng nhập mới **không** xoá phiên cũ của tài khoản: khách dùng cả máy tính lẫn điện thoại.
  Màn Cài đặt có nút "Đăng xuất mọi thiết bị" xoá mọi phiên trừ phiên hiện tại.

### 6.4. Chống lạm dụng

Turnstile trên form OTP, Rate Limiting theo email và IP, 5 lần thử mỗi mã, mỗi tài khoản một trial
(`trial_tenant_id`), và `trial_already_used` của sổ quota theo tenant. Không chặn email dùng một
lần và không xác minh doanh nghiệp — đó là việc của giai đoạn có khách thật để nhìn.

## 7. Tenant, trial và khoá trong console

**Onboarding** (`POST /v1/console/tenant { name }`), chạy khi tài khoản chưa có tenant, trong
một transaction Postgres rồi mới gọi sổ quota:

1. `INSERT tenant (name, plan = 'free', quota_mode = 'commercial')`; `INSERT tenant_member
   (owner)`; `UPDATE customer_account SET trial_tenant_id`.
2. `activateTrial` với `operationId = 'trial:' + tenantId`, `startsAt = now`, `expectedRevision
   = 0`, `actor = 'customer:' + email`. Bước 1 xong mà bước 2 lỗi → tenant tồn tại nhưng không có
   quyền; lần mở console kế tiếp thấy `status = none` sẽ gọi lại cùng `operationId`, idempotent.
3. Khách đã có `trial_tenant_id` mà không còn membership nào (dữ liệu hỏng) → 409
   `trial_already_used`, hiện hướng dẫn liên hệ hỗ trợ.

**Khoá**: `GET /v1/console/keys`, `POST /v1/console/keys { label, kind, allowed_origins,
allowed_bundle_ids }` — dùng lại `generateApiKey`, `sha256Hex`, `textArray` và đúng câu `INSERT`
của `admin-tenants.ts` (tách thành hàm `issueKeyForTenant()` dùng chung, không chép). Scope cố
định `places:read`; khách muốn `edits:write` thì liên hệ. Tối đa 10 khoá hoạt động mỗi tenant.
Khoá rõ trả **đúng một lần**, giao diện cảnh báo như admin. Thu hồi: `POST
/v1/console/keys/:hash/revoke` dùng lại hàm thu hồi của `billing-admin.ts` (tách thành
`revokeKey()` giữ đúng thứ tự fail-closed DO trước, DB sau).

**Mức dùng**: `GET /v1/console/usage` trả `readUsage()` của sổ (đã có `places`/`directions`
`limit/used/reserved/credits/available`, `endsAt`, `missingAcks`); `GET /v1/console/periods` trả
`readPeriods(12)`. Tenant của console luôn `commercial` nên không tạo sổ mồ côi (khác admin).

Mọi hành động ghi của khách vào `admin_audit` với `actor = 'customer:<email>'`:
`customer.signup`, `customer.tenant_create`, `customer.key_issue`, `customer.key_revoke`,
`order.create`, `order.cancel`. Hệ thống ghi `actor = 'system:payos'` / `'system:cron'` cho
`order.paid`, `order.fulfilled`, `order.fulfil_failed`, `order.expired`. Màn Nhật ký kiểm toán
hiện được ngay, không cần bảng mới.

## 8. Catalog giá và tính tiền

`packages/catalog/src/index.ts`:

```ts
export const PLAN_CATALOG = {
  trial:        { priceCents: 0,      priceVnd: 0,          places: 2_000,   directions: 200,    dailyPlaces: 200, dailyDirections: 20, onlineSupport: false },
  starter:      { priceCents: 2_500,  priceVnd: 650_000,    places: 30_000,  directions: 3_000,  dailyPlaces: null, dailyDirections: null, onlineSupport: false },
  professional: { priceCents: 10_000, priceVnd: 2_600_000,  places: 100_000, directions: 10_000, …, onlineSupport: true },
  business:     { priceCents: 40_000, priceVnd: 10_400_000, places: 400_000, directions: 40_000, …, onlineSupport: true },
  addOns: {
    places:     { units: 1_000, priceCents: 100, priceVnd: 26_000 },
    directions: { units: 1_000, priceCents: 300, priceVnd: 78_000 },
  },
} as const;
/** Tỷ giá THAM CHIẾU đã chốt 14/09/2026, chỉ để hiện USD mờ; đổi là quyết định giá, không tự động. */
export const USD_REFERENCE_RATE = 26_000;
export const PERIOD_MONTHS = [1, 3, 6, 12] as const;

export function quoteOrder(input: OrderInput): { amountVnd: number; amountUsdCents: number };
export function addMonths(startsAt: Date, months: number): Date;   // theo lịch, giữ giờ; 31/01 + 1 → 28/02 hoặc 29/02
```

Máy chủ **tính lại tiền từ catalog** khi tạo đơn; client chỉ gửi `kind`, `tier`, `months` hoặc
`group`, `packs`. Số tiền trong yêu cầu của client, nếu có, bị bỏ qua. `COMPARISON` mang nguyên
ba dòng workload của tài liệu nghiên cứu, ngày đối chiếu 14/09/2026, ba URL nguồn và đoạn giả
định — website phải in cả ba thứ đó cạnh bảng.

`apps/api` chuyển sang import từ `@mapslibvn/catalog`; `/v1/admin/plan-catalog` trả thêm
`priceVnd`. Thêm `GET /v1/catalog` **công khai**, `cache-control: public, max-age=3600`, cho console
và cho ai muốn đọc bằng máy — nội dung là bảng giá đã in trên website, không có gì để giấu.

## 9. Đơn hàng và PayOS

### 9.1. Tạo đơn

`POST /v1/console/orders` với `{ kind: 'plan', tier, months }` hoặc `{ kind: 'addon', group,
packs }`:

1. Cổng nghiệp vụ: tenant phải `commercial`; `addon` đòi `usage.status = active` và `tier ≠
   trial` (409 `credits_require_paid_active`, cùng mã sổ quota dùng để giao diện dịch một chỗ);
   tối đa 3 đơn `pending` mỗi tenant, quá thì 409 `too_many_pending_orders` kèm gợi ý huỷ.
2. `quoteOrder()` → `INSERT customer_order (status = 'pending')` lấy `order_code`.
3. Gọi PayOS `POST https://api-merchant.payos.vn/v2/payment-requests` với header `x-client-id`,
   `x-api-key`; body `orderCode`, `amount` (VND nguyên), `description = 'MLV' + orderCode`,
   `returnUrl = <origin>/console/don-hang/<id>?ket-qua=thanh-cong`, `cancelUrl =
   …?ket-qua=huy`, `expiredAt = now + 24h`, `buyerEmail`, `buyerName`/`buyerCompanyName`/
   `buyerTaxCode` từ `tenant.billing_*` nếu có, `items[]` một dòng mô tả gói, `signature` =
   HMAC-SHA256(`amount=…&cancelUrl=…&description=…&orderCode=…&returnUrl=…`, `PAYOS_CHECKSUM_KEY`).
   Kiểm `signature` trong phản hồi theo cùng luật.
4. Lưu `payment_link_id`, `checkout_url`, `qr_code`, `link_expires_at`. PayOS lỗi → đơn vẫn
   `pending` không có link, trả 503 `payment_provider_unavailable`; khách bấm lại thì dùng lại
   đơn đó (không tạo đơn mới) và thử tạo link lần nữa.

Console hiện QR (vẽ từ `qr_code` bằng thư viện QR nhỏ phía client), số tiền, nội dung chuyển
khoản, nút "Mở trang thanh toán PayOS" (`checkout_url`), và **poll `GET /v1/console/orders/:id`
mỗi 3 giây** trong lúc `pending`. `returnUrl` chỉ là đường về giao diện; **trạng thái luôn lấy từ
đơn trong DB**, không tin tham số trên URL.

### 9.2. Webhook `POST /v1/pay/payos/webhook`

Không qua Access, không qua cổng CSRF (server-to-server), không cookie. Thứ tự:

1. Đọc body ≤ 16 KiB, parse `{ code, desc, success, data, signature }`.
2. Tính HMAC-SHA256 của `data` theo luật PayOS: sắp khoá theo bảng chữ cái, `key=value` nối bằng
   `&`, `null`/`undefined` thành chuỗi rỗng, mảng và object lồng thì JSON.stringify; so với
   `signature` bằng so sánh thời gian hằng. Sai → **vẫn ghi `payment_event(signature_valid =
   false, order_id = NULL, reference = 'invalid:' + sha256(body))`** rồi trả 400 — `reference`
   trong payload sai chữ ký không đáng tin nên không dùng nó làm khoá. Ghi lại để admin thấy có ai
   đang gõ cửa.
3. `INSERT payment_event` với `UNIQUE (provider, reference)`; trùng → trả 200 ngay (PayOS gửi
   lại), không làm gì thêm.
4. Tìm đơn theo `data.orderCode`. Không có (kể cả webhook thử nghiệm của PayOS lúc
   `confirm-webhook`) → giữ sự kiện với `order_id = NULL`, trả 200. Admin có mục "Giao dịch không
   khớp đơn".
5. `code !== '00'` → chỉ lưu sự kiện, trả 200.
6. So tiền: `amount ≥ amount_vnd` → `status = 'paid'`, `paid_at`, `paid_amount_vnd`; ít hơn →
   `underpaid`, email báo khách và admin, trả 200, dừng.
7. Cấp gói (9.3) **trong cùng request**; kết quả quyết định `fulfilled` hay `paid_unfulfilled`.
   Dù nhánh nào, webhook trả 200 — tiền đã nhận là sự thật, việc cấp gói là việc của mình.
8. Email biên nhận trong `waitUntil`.

### 9.3. Cấp gói — hàm `fulfilOrder(orderId)` dùng chung cho webhook, cron và admin

1. `usage = readUsage()`; `history = readPeriods()`.
2. Với `plan`: `startsAt` = mốc muộn nhất trong `{ now, max(endsAt) của mọi kỳ trả phí có endsAt
   > now }`. Tenant đang trial → `startsAt = now` và sổ tự cắt trial (luật có sẵn). Tenant đã có kỳ
   trả phí tới 30/11 mà mua thêm 3 tháng → kỳ mới 30/11 → 28/02, không đụng `period_overlap`.
   Mua gói **khác tier** khi đang có kỳ trả phí → cũng xếp sau kỳ hiện tại; giao diện nói rõ
   "gói mới có hiệu lực từ ngày …". `endsAt = addMonths(startsAt, months)`.
   Lệnh: `grantPeriod { operationId: 'order:' + id, periodId: id, tier, startsAt, endsAt,
   paymentReference: payment_event.reference, lineItemId: id, expectedRevision: usage.revision,
   actor: 'system:payos', reason: 'Đơn ' + order_code }`.
3. Với `addon`: cần `usage.status = active`, `tier ≠ trial`; `periodId = usage.periodId` **tại
   lúc cấp**, không phải lúc tạo đơn (kỳ có thể đã đổi trong lúc khách chuyển khoản). Lệnh
   `addCredits { …, group, packs }`.
4. `revision_conflict` → đọc lại, thử tối đa 3 lần. `operation_conflict` hoặc
   `business_identity_conflict` → đã cấp rồi bằng đúng định danh này, coi là thành công (đọc
   biên lai từ sổ). Mã khác hoặc DO không trả lời → `paid_unfulfilled`, `fulfil_error = mã`,
   `fulfil_attempts + 1`, audit `order.fulfil_failed`.
5. Thành công → `fulfilled`, `entitlement_receipt`, audit `order.fulfilled`.

### 9.4. Cron `scheduled()`

`[triggers] crons = ["*/5 * * * *", "0 2 * * *"]` (Workers Free cho phép). Mỗi lượt bọc trong
try/catch theo từng việc; DB không trả lời (máy chủ ngủ) thì log và bỏ qua, **không** ném lỗi làm
hỏng lượt sau.

Mỗi 5 phút:

- `paid_unfulfilled` có `fulfil_attempts < 20` → `fulfilOrder()`. Qua 20 lần thì thôi tự thử,
  admin xử lý.
- `pending` tạo quá 10 phút và chưa hết `link_expires_at` → `GET /v2/payment-requests/{orderCode}`
  của PayOS, tối đa 30 đơn/lượt: `PAID` mà chưa có sự kiện → tự dựng `payment_event` từ
  `transactions` rồi đi tiếp như webhook (phòng webhook rơi); `CANCELLED`/`EXPIRED` → `expired`.
- `pending` quá `link_expires_at` + 1 giờ → `expired`, audit.
- Xoá `customer_login_code` hết hạn và `customer_session` hết hạn.

09:00 giờ Việt Nam (`0 2 * * *` UTC): với tenant `commercial` có kỳ trả phí kết thúc trong 7
ngày hoặc 1 ngày, hoặc vừa hết hạn hôm qua và **không có kỳ kế tiếp** → email nhắc/hết hạn cho
owner. Danh sách tenant lấy từ Postgres (`quota_mode = 'commercial'` có `tenant_member`), mốc kỳ
đọc từ sổ. Chống gửi hai lần không cần cột mới: mỗi thư nhắc ghi `admin_audit` với `action =
'email.reminder'`, `target = tenantId + ':' + periodId + ':' + loại`, và cron bỏ qua cặp đã có.
Cron dừng khi ngân sách email ngày (mục 10) còn dưới 20 thư, để chừa cho OTP; phần còn lại lượt
mai gửi tiếp.

### 9.5. Gia hạn, nâng, hạ, trial, hoàn tiền

- **Gia hạn** = mua thêm kỳ cùng tier; xếp nối tiếp. Console có nút "Gia hạn" ngay ở ô gói.
- **Nâng gói giữa kỳ**: không tính chênh lệch (nghiên cứu 14/09 chưa chốt). Khách mua gói cao hơn
  thì kỳ mới bắt đầu sau kỳ hiện tại. Muốn đổi ngay thì liên hệ, admin dùng lệnh sẵn có.
- **Hạ gói**: mua gói thấp hơn cho kỳ sau, tự nhiên theo cùng luật.
- **Trial → trả phí**: kỳ trả phí bắt đầu ngay, trial bị cắt (luật sổ). Lượt trial chưa dùng mất.
  Console nói rõ điều này trước khi khách bấm mua.
- **Hoàn tiền**: ngoài hệ thống. Admin đánh dấu `refunded` kèm lý do; nếu cần thu hồi quyền thì
  dùng `suspend` sẵn có ở màn Gói cước.

## 10. Email

`apps/api/src/email/port.ts`:

```ts
export interface EmailPort {
  send(message: { to: string; subject: string; html: string; text: string; replyTo?: string }): Promise<{ id: string }>;
}
```

Hai bản: `resend.ts` (POST `https://api.resend.com/emails`, Bearer `RESEND_API_KEY`, `from =
EMAIL_FROM`) và `debug.ts` (ghi `console.log`, trả id giả) dùng khi thiếu `RESEND_API_KEY` ngoài
production. Production thiếu key → route OTP trả 503 `email_not_configured`, không âm thầm nuốt.

Năm mẫu, tiếng Việt có dấu, mỗi mẫu có `html` và `text`, từ ngữ không có gì giống spam (bài học
deliverability): **mã đăng nhập** (mã, hạn 10 phút, "không phải bạn thì bỏ qua"), **chào mừng**
(khoá đầu tiên đã tạo, link docs "Bắt đầu 5 phút"), **biên nhận** (mã đơn, gói, kỳ, số tiền VND,
ngày hiệu lực, ghi rõ "biên nhận thanh toán, không phải hoá đơn VAT"), **sắp hết hạn** (7 và 1
ngày), **đã hết hạn**. Mọi thư `Reply-To: dotienphong1993@gmail.com`.

Ngân sách 100/ngày của gói miễn phí: OTP chiếm phần lớn. Mỗi thư gửi thành công ghi một dòng
`admin_audit` `action = 'email.sent'` (`target` = loại thư, không ghi địa chỉ khách vào `detail`);
trước khi gửi, `EmailPort` đếm `SELECT count(*) … WHERE action = 'email.sent' AND created_at >=
<00:00 UTC hôm nay>` (Resend tính ngày theo UTC). Đủ 100 → OTP trả 503 `email_budget_exhausted`,
cron bỏ lượt nhắc. Một truy vấn đếm trên bảng có chỉ mục `created_at` là rẻ, và không tốn lượt
ghi KV. Vượt trần là lúc trả $20/tháng cho Resend Pro hoặc lên Workers Paid — lúc đó đã có khách
để trả.

Việc tay: thêm domain `ai-solutions.io.vn` vào Resend, đặt bản ghi DKIM/SPF trên Cloudflare DNS,
kiểm "Verified" trước khi bật pha 2.

## 11. Website `apps/site`

### 11.1. Công nghệ và cấu trúc

Astro 7 **không** dùng Starlight; `output: 'static'`; `@tailwindcss/vite`; `@astrojs/react` cho
island; `@astrojs/sitemap`; `astro:assets` cho ảnh. Font **Be Vietnam Pro** (có dấu tiếng Việt
tốt, giấy phép OFL) tự host qua `@fontsource-variable/be-vietnam-pro`, preload file WOFF2 chính.

```
apps/site/
  astro.config.mjs         site: SITE_URL, sitemap, react
  src/
    layouts/Base.astro     <head> đầy đủ SEO, header, footer, theme sáng/tối
    components/
      Hero.astro           tiêu đề, hai CTA, ảnh bản đồ tĩnh + nút "Bấm để tương tác" → iframe
      CodeTabs.tsx         island: script tag / npm / React Native
      PricingCards.tsx     island: 4 thẻ + công tắc 1/3/6/12 tháng, USD mờ
      ComparisonTable.astro  tĩnh, đọc COMPARISON
      Faq.astro            <details>/<summary>, không JS
      SeoHead.astro        title, description, canonical, OG, Twitter, JSON-LD
    content/bai-viet/      Markdown, frontmatter title/description/date/tags
    pages/
      index.astro
      tinh-nang.astro
      bang-gia.astro
      so-sanh/google-maps-api.astro
      so-sanh/vietmap.astro
      bai-viet/index.astro, bai-viet/[slug].astro
      lien-he.astro
      404.astro
  public/robots.txt, og/*.png
```

Token màu import từ `@mapslibvn/ui/tokens.css` — cùng `#1b3a6b` và thang xám với admin/console để
ba mặt nhìn là một sản phẩm.

### 11.2. Trang và nội dung

| Trang | Nội dung | Từ khoá mục tiêu |
|---|---|---|
| `/` | Hero một câu: "API bản đồ và địa điểm Việt Nam trên dữ liệu mở, thấp hơn Google từ 37 % đến 68 % ở ba workload đã đối chiếu" — hai con số lấy từ `COMPARISON`, không gõ tay. Hai CTA "Bắt đầu miễn phí" (→ console) và "Xem bảng giá". Bản đồ sống. Ba tab mã nhúng. Sáu tính năng. Bảng giá tóm tắt. Khối "vì sao rẻ hơn" (số của COMPARISON). FAQ 6 câu. | API bản đồ Việt Nam |
| `/tinh-nang/` | Bản đồ nền, POI 164 loại, tìm kiếm & autocomplete, geocode trung thực, dẫn đường, đóng góp, 4 SDK — mỗi mục có ảnh và link sang docs | thư viện bản đồ web, SDK bản đồ React Native |
| `/bang-gia/` | 4 thẻ; công tắc kỳ; mua thêm lượt; bảng so sánh Google/VIETMAP kèm ngày, giả định, nguồn; FAQ giá (VAT, hoàn tiền, quota tính thế nào, "cấp thêm khoá không cấp thêm hạn mức"); link Điều khoản tenant | giá API bản đồ, so sánh giá Google Maps API |
| `/so-sanh/google-maps-api/` | Trang dài: chi phí Google theo SKU cho ba workload, chỗ MapsLibVN khác (dữ liệu mở, tự host được, chủ quyền), chỗ Google hơn (phủ toàn cầu, Street View) — **thật, không hạ đối thủ** | thay thế Google Maps API |
| `/so-sanh/vietmap/` | Tương tự với VIETMAP | so sánh VIETMAP API |
| `/bai-viet/` | Ba bài khởi động, PHONG duyệt nội dung trước khi đăng: "Chi phí Google Maps API cho doanh nghiệp Việt Nam 2026", "Tự host bản đồ Việt Nam với dữ liệu mở", "Geocoding địa chỉ Việt Nam: vì sao độ chính xác phải nói thật" | dài hạn |
| `/lien-he/` | Email hỗ trợ, giờ hỗ trợ đã chốt (T2–T6 08:00–20:00, T7/CN 08:00–17:00 cho Professional/Business), link docs | |

Mọi con số trên website phải truy được về `@mapslibvn/catalog` hoặc `COMPARISON`; không gõ tay
số nào trong `.astro`. Câu "rẻ hơn Google X %" luôn đi kèm workload cụ thể, đúng lời dặn trong
tài liệu nghiên cứu: không quảng cáo tỷ lệ này cho mọi workload.

### 11.3. SEO kỹ thuật — tiêu chí, không phải gợi ý

- Mỗi trang một `<title>` ≤ 60 ký tự và `description` 120–160 ký tự riêng; `<link rel=canonical>`
  tuyệt đối theo `SITE_URL`; `og:*` và `twitter:card` với ảnh 1200×630 riêng cho trang chủ và bảng
  giá; `lang="vi"`.
- JSON-LD: `Organization` (trang chủ), `SoftwareApplication` với `offers[]` bốn gói giá VND
  (`/bang-gia/`), `FAQPage` ở mọi trang có FAQ, `Article` cho bài viết, `BreadcrumbList` cho trang
  con.
- `sitemap-index.xml` tự sinh, `robots.txt` trỏ sitemap; `/console`, `/admin` không thuộc site
  nên không cần chặn ở đây.
- HTML ngữ nghĩa: một `<h1>` mỗi trang, `<nav>`, `<main>`, `<article>`, bảng so sánh là `<table>`
  thật có `<th scope>`.
- Hiệu năng: **LCP ≤ 2,5 s, CLS ≤ 0,1, TBT ≤ 200 ms** trên Lighthouse mobile (Moto G Power, 4G
  giả lập — phòng lab đo TBT, không đo INP); Performance ≥ 90, SEO = 100, Accessibility ≥ 95. JavaScript của trang chủ ≤ 60 KB
  gzip **không tính** iframe bản đồ. Bản đồ sống chỉ nạp iframe sau khi khách bấm hoặc sau khi
  trang đã tương tác xong (`requestIdleCallback`), trước đó là ảnh PNG tĩnh có chiều cao cố định
  để không CLS.
- Ảnh AVIF/WebP có `width`/`height`; font `font-display: swap` với `size-adjust` để không nhảy
  chữ.
- Đổi tên miền sau: sửa `SITE_URL`, thêm `_redirects` 301 toàn site từ `pages.dev` sang tên miền
  mới, gửi lại sitemap ở Search Console. Spec ghi việc này để lúc đó không phải nghĩ lại.

### 11.4. Thiết kế

Kiểu các trang SaaS hạ tầng hiện nay (Mapbox, Stripe, Linear): nền sáng nhiều khoảng trắng, một
màu nhấn `#1b3a6b`, chữ lớn, ảnh sản phẩm thật (ảnh chụp bản đồ, playground, console) thay minh
hoạ vẽ. Bản tối theo `prefers-color-scheme` và công tắc lưu `localStorage`. Bo góc 12 px thẻ, 9 px
nút như admin. Chữ nội dung tối thiểu 16 px (website đọc, khác admin 14 px), vùng chạm 44 px.
Không hiệu ứng cuộn nặng; chuyển động chỉ ở hover và mở FAQ, tôn trọng `prefers-reduced-motion`.

### 11.5. Deploy

Workflow `deploy-site.yml` chạy khi `apps/site/**`, `packages/catalog/**`, `packages/ui/**` đổi:
build core → catalog → ui → site, `wrangler pages deploy dist --project-name mapslibvn-site`.
Script gốc `deploy:site`. PHONG tạo project Pages `mapslibvn-site` một lần (việc tay).

## 12. Console `apps/console`

Cùng khung `apps/admin`: React 19, Vite, Tailwind v4, TanStack Query, React Router, `base:
'/console/'`. Worker `[assets]` chỉ nhận **một** thư mục và đang trỏ `../admin/dist`, nên console
build thẳng ra `apps/admin/dist/console` (`outDir: '../admin/dist/console'`, `emptyOutDir` chỉ
xoá thư mục con đó). Không đổi `wrangler.toml`, không thêm bước chép; nhược điểm là thư mục dist
của admin chứa thứ không phải admin — ghi rõ trong README của cả hai app, và CI build console
**trước** khi build api. Fallback SPA trong `index.ts` mở rộng cho `/console/*` với cùng luật
"chỉ đường dẫn không có phần mở rộng".

Màn hình:

| Route | Nội dung |
|---|---|
| `/console/dang-nhap` | Ô email + Turnstile + nút gửi mã; nút "Đăng nhập bằng Google"; link Điều khoản tenant, checkbox đồng ý ở lần đầu |
| `/console/xac-thuc` | 6 ô số, dán được, đếm ngược 10 phút, "Gửi lại" sau 60 giây |
| `/console/bat-dau` | Onboarding: tên tổ chức, tên khoá đầu tiên, origin cho phép (mặc định trống), tạo xong hiện khoá **một lần** + đoạn mã nhúng có sẵn khoá |
| `/console/` | Tổng quan: gói và trạng thái, ngày hết hạn, hai thanh Places/Directions với `used/limit`, credit riêng, hổ phách 80 % đỏ 100 %, cảnh báo `missingAcks.locked`, nút "Gia hạn"/"Nâng gói"/"Mua thêm lượt", 5 đơn gần nhất |
| `/console/khoa` | Danh sách khoá (prefix, nhãn, loại, origin, ngày tạo), tạo mới, thu hồi qua `delayed-action` 5 giây |
| `/console/mua` | Chọn gói (4 thẻ, thẻ hiện tại đánh dấu), chọn kỳ, hoặc tab "Mua thêm lượt"; tóm tắt tiền VND và USD mờ; dòng "hiệu lực từ …" tính bằng cùng luật 9.3 qua `GET /v1/console/orders/quote`; nút "Thanh toán" tạo đơn → chuyển sang chi tiết đơn |
| `/console/don-hang` | Danh sách đơn với trạng thái tiếng Việt và màu |
| `/console/don-hang/:id` | QR, số tiền, nội dung chuyển khoản, nút mở PayOS, đồng hồ hết hạn link, poll 3 giây; `fulfilled` hiện biên lai và nút về Tổng quan; `paid_unfulfilled` nói thật "đã nhận tiền, đang cấp gói, tự thử lại mỗi 5 phút"; `underpaid` nói số thiếu và cách liên hệ |
| `/console/cai-dat` | Tên tổ chức, thông tin biên nhận (tên, MST, địa chỉ, email nhận biên nhận), email đăng nhập (chỉ đọc), tài khoản Google đã liên kết, "Đăng xuất mọi thiết bị" |

Năm trạng thái chuẩn (`LoadingSkeleton`, `EmptyState`, `ErrorState`, `ForbiddenState`,
`OfflineState`) từ `@mapslibvn/ui`; mã lỗi API → câu tiếng Việt qua một bảng `error-vi.ts` gồm cả
mã của sổ quota. Fetcher thấy 401 `not_signed_in` → về `/console/dang-nhap` giữ `?next=`.
`SELF_SERVE = '0'` → mọi route `/v1/console/*` trừ `catalog` trả 503 `self_serve_closed`, SPA hiện
một màn "Sắp mở, liên hệ dotienphong1993@gmail.com" — để website deploy pha 1 có chỗ trỏ tới.

## 13. Admin mở rộng

Thêm nhóm sidebar **Khách hàng** hai mục mới (mục Tenant & khoá và Gói cước giữ nguyên):

**Khách hàng — `/admin/customers`.** Danh sách tài khoản: email, tên, tenant sở hữu, đăng nhập
gần nhất, Google đã liên kết, trạng thái; tìm theo email; con trỏ theo `created_at`. Chi tiết: phiên
đang mở (số lượng, thiết bị, lần thấy cuối), đơn hàng, nút "Vô hiệu hoá"/"Kích hoạt lại" qua
`delayed-action` (vô hiệu hoá xoá mọi phiên). Link sang tenant.

**Đơn hàng & giao dịch — `/admin/orders`.** Lọc trạng thái, tenant, khoảng ngày; thẻ/dòng: mã
đơn, tenant, nội dung, tiền VND, trạng thái, tuổi. Bốn ô đầu trang: đơn chờ xử lý
(`paid_unfulfilled` + `underpaid`), doanh thu 30 ngày (tổng `paid_amount_vnd` của `fulfilled`),
đơn `pending` quá 1 giờ, giao dịch không khớp đơn. Chi tiết đơn: mọi trường, dòng thời gian
`payment_event` (chữ ký hợp lệ hay không, payload thu gọn), biên lai sổ quota, lỗi cấp gói, và các
lệnh:

| Lệnh | Điều kiện | Cơ chế |
|---|---|---|
| Thử cấp lại | `paid_unfulfilled` | `fulfilOrder()`; kết quả hiện ngay |
| Xác nhận đã nhận tiền (tay) | `pending`, `underpaid`, `expired` | Nhập lý do và mã tham chiếu ngân hàng → dựng `payment_event(provider='manual', reference='manual:'+ulid)` → `paid` → `fulfilOrder()`; `delayed-action` 5 giây; audit giữ lý do |
| Huỷ đơn | `pending` | Gọi PayOS cancel rồi `cancelled` |
| Đánh dấu hoàn tiền | `fulfilled` | Nhập lý do → `refunded`, không đụng sổ; gợi ý `suspend` ở màn Gói cước |

Tất cả lệnh tiền đứng sau `requireBillingAccess()`, `operationId` từ client, audit `admin.order.*`.
Danh sách khách hàng chỉ cần `requireAccess()`.

**Chỉnh nhỏ ở màn cũ**: chi tiết tenant hiện owner (email) và 5 đơn gần nhất; Tổng quan thêm hai
ô "Đơn chờ xử lý" và "Doanh thu 30 ngày" (cùng truy vấn với đầu trang Đơn hàng, cache TanStack
chung khoá). Quyền `customers.read`, `orders.read`, `orders.write` thêm vào `ALL_PERMISSIONS` và
các màn gọi `can()` như mọi chỗ khác.

## 14. API mới

| Phương thức | Đường dẫn | Cổng | Ghi chú |
|---|---|---|---|
| GET | `/v1/catalog` | công khai | cache 1 giờ |
| POST | `/v1/console/auth/otp/request` | Turnstile + Rate Limiting | luôn 200 |
| POST | `/v1/console/auth/otp/verify` | Rate Limiting | đặt cookie |
| GET | `/v1/console/auth/google/start` | | redirect |
| GET | `/v1/console/auth/google/callback` | cookie `mlv_oauth` | redirect `/console/` |
| POST | `/v1/console/auth/logout` | phiên + CSRF | |
| POST | `/v1/console/auth/logout-all` | phiên + CSRF | |
| GET | `/v1/console/config` | công khai | `{ turnstileSiteKey, googleEnabled, selfServe }` |
| GET | `/v1/console/me` | phiên | `{ email, name, tenant, onboarded }` |
| POST | `/v1/console/tenant` | phiên + CSRF | onboarding |
| PATCH | `/v1/console/tenant` | phiên + CSRF | tên, billing_* |
| GET | `/v1/console/usage`, `/periods` | phiên | từ sổ quota |
| GET / POST | `/v1/console/keys`, `/keys/:hash/revoke` | phiên + CSRF | |
| GET | `/v1/console/orders/quote?kind=…` | phiên | tiền + "hiệu lực từ" |
| GET / POST | `/v1/console/orders`, `/orders/:id`, `/orders/:id/cancel` | phiên + CSRF | |
| POST | `/v1/pay/payos/webhook` | chữ ký HMAC | server-to-server |
| GET | `/v1/admin/customers`, `/customers/:id` | Access | |
| POST | `/v1/admin/customers/:id/disable`, `/enable` | Access + CSRF | |
| GET | `/v1/admin/orders`, `/orders/:id`, `/orders/summary`, `/payment-events/unmatched` | Access + billing | |
| POST | `/v1/admin/orders/:id/fulfil`, `/confirm-manual`, `/cancel`, `/refund` | Access + billing + CSRF | `operationId` |

Mọi phản hồi console và admin `cache-control: private, no-store`. Mã lỗi giữ dạng
`{ error: { code, message, request_id } }` của `ApiError`.

## 15. Bảo mật

- Webhook: chữ ký HMAC so sánh thời gian hằng; body ≤ 16 KiB; không tin `orderCode` trước khi
  kiểm chữ ký; sự kiện sai chữ ký vẫn được ghi để thấy. Không lộ `PAYOS_*` ra client — client chỉ
  nhận `checkout_url` và `qr_code`.
- Tiền tính ở máy chủ từ catalog; đơn `pending` không cho đổi nội dung, chỉ huỷ.
- Cookie phiên `HttpOnly` nên JavaScript không đọc được; không có token trong URL hay
  `localStorage`. OTP và phiên chỉ lưu dạng băm kèm `SESSION_PEPPER`.
- `requireCustomer()` kiểm `disabled_at` mỗi request, không cache.
- Console không bao giờ thấy `key_hash` đầy đủ của khoá tenant khác: mọi truy vấn khoá và đơn đều
  có `WHERE tenant_id = <tenant của phiên>`; test phải có ca "tài khoản A gọi id đơn của B nhận
  404".
- Secret mới đặt bằng `wrangler secret put … --env production`: `PAYOS_CLIENT_ID`,
  `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET`, `SESSION_PEPPER`. Biến thường: `EMAIL_FROM`,
  `SUPPORT_EMAIL`, `SELF_SERVE`, `TURNSTILE_SITE_KEY` (công khai, cho SPA đọc qua `/v1/console/config`).
- Log Workers không in email khách ở mức info; lỗi in `request_id` và mã, không in payload PayOS.
- `docs/legal/dieu-khoan-tenant.md` được link ở form đăng nhập và trang bảng giá; đồng ý điều
  khoản ghi `admin_audit` `customer.accept_terms` với phiên bản điều khoản (ngày sửa file).

## 16. Cấu hình, cờ và việc tay

`wrangler.toml`: thêm `[triggers] crons`; hai ratelimits `OTP_EMAIL_RATE_LIMITER` (`limit = 1,
period = 60`, khoá là email) và `OTP_IP_RATE_LIMITER` (`limit = 3, period = 60`, khoá là băm IP) —
giao diện nói đúng hành vi thật: "mỗi phút một mã"; vars `SELF_SERVE = "0"` ở cả dev lẫn
production **cho tới khi pha 2 nghiệm thu** (trial tự phục vụ không cần thanh toán), `EMAIL_FROM`,
`SUPPORT_EMAIL`, `TURNSTILE_SITE_KEY`. Giá trị để trong file, **không** truyền `--var` (memory:
`--var` bị lần deploy sau xoá sạch).

Việc tay của PHONG, chặn pha tương ứng:

| Việc | Chặn pha |
|---|---|
| Tạo project Pages `mapslibvn-site` | 1 |
| Xác thực Google Search Console và Bing cho `mapslibvn-site.pages.dev`, gửi sitemap | 1 (sau deploy) |
| Duyệt nội dung ba bài viết và hai trang so sánh | 1 |
| Tạo Resend, thêm domain `ai-solutions.io.vn`, đặt DKIM/SPF trên Cloudflare DNS | 2 |
| Tạo Google Cloud OAuth client (Web), redirect URI production và harness | 2 |
| Tạo Turnstile widget, lấy site key và secret | 2 |
| Đăng ký PayOS, xác thực CCCD, tạo kênh thanh toán, lấy Client ID / API Key / Checksum Key, đăng ký webhook URL | 3 |
| Đặt 8 secret bằng `wrangler secret put` | 2, 3 |
| Tự mua Starter bằng tiền thật để nghiệm thu pha 3 | 3 |

## 17. Kiểm thử

**Unit, `apps/api` (vitest-pool-workers):**

- Chữ ký PayOS: một fixture lấy từ tài liệu PayOS phải cho ra đúng chuỗi ký và HMAC; ca `null`
  thành rỗng; ca mảng; ca đổi một byte payload thì chữ ký không khớp.
- Máy trạng thái đơn: mọi cạnh trong 5.3 và **mọi cạnh không có trong đó bị từ chối**.
- `fulfilOrder()`: tiêm sổ quota giả (như `billing-admin.test.ts`): trial→paid `startsAt = now`;
  có kỳ tới 30/11 thì `startsAt = 30/11`; `revision_conflict` thử lại 3 lần rồi mới bỏ;
  `business_identity_conflict` coi là thành công; addon lấy `periodId` lúc cấp.
- Webhook: chữ ký sai → 400 và có `payment_event(signature_valid = false)`; trùng `reference` →
  200 không cấp lần hai; không khớp đơn → 200 `order_id NULL`; thiếu tiền → `underpaid`; đủ →
  `fulfilled` và email được gọi đúng một lần.
- `quoteOrder()` và `addMonths()` (31/01 + 1 tháng, 30/11 + 3 tháng qua năm mới).
- OTP: hết hạn, 5 lần sai, mã cũ chết khi xin mã mới; phản hồi request luôn 200.
- Google: `id_token` ký bằng JWKS giả, thiếu `email_verified` bị từ chối, `aud` sai bị từ chối.
- `requireCustomer()`: tài khoản `disabled_at` → 403; đơn của tenant khác → 404.
- Cron: DB ném lỗi ở việc thứ nhất thì việc thứ hai vẫn chạy.

**Component, `packages/ui` và `apps/console` (jsdom):** thẻ giá đổi số theo kỳ và hiện USD mờ;
màn đơn hàng poll dừng khi rời `pending`; `delayed-action` huỷ trong 5 giây không gọi API (test
chuyển từ admin sang `packages/ui` phải vẫn xanh); `error-vi` phủ mọi mã trong 14.

**API + DB thật (`test:api-db`, mở rộng harness):** migration 0020/0021 lên xuống sạch; mỗi câu
SQL mới chạy được **bằng role `api`** — thêm bài `SET ROLE api` cho từng bảng mới (bài học: itest
nối bằng role chủ sở hữu nên không thấy thiếu GRANT); tạo tenant qua console rồi đọc lại bằng
route admin; hai tài khoản không thấy đơn của nhau.

**E2E Playwright (`apps/console/e2e`, harness `api-db-test.mjs --serve` với `OTP_DELIVERY =
debug` và PayOS giả):** đăng nhập bằng OTP đọc từ header, onboarding tạo khoá, gọi
`/v1/autocomplete` bằng khoá đó nhận 200; tạo đơn Starter 3 tháng, script
`scripts/pay-fake-webhook.mjs` ký webhook bằng checksum key giả và bắn vào harness → màn đơn
chuyển `fulfilled`, Tổng quan hiện Starter với hạn đúng 3 tháng; admin thấy đơn ở `/admin/orders`.
Trên website: `astro check` xanh, Playwright kiểm mỗi trang có đúng một `<h1>`, canonical, JSON-LD
parse được; Lighthouse chạy tay ghi vào evidence với số thật.

## 18. Rủi ro và cách chặn

| Rủi ro | Cách chặn |
|---|---|
| Webhook PayOS không tới (mạng, PayOS trục trặc) | Cron đối soát `pending` bằng GET PayOS mỗi 5 phút |
| Tiền vào mà cấp gói hỏng | Trạng thái `paid_unfulfilled` riêng, cron thử lại, admin thấy ngay; webhook vẫn 200 |
| Cấp gói hai lần | `operationId = 'order:' + id`, `(paymentReference, lineItemId)` là định danh tài chính của sổ; `UNIQUE (provider, reference)` ở `payment_event` |
| Kỳ chồng nhau | `startsAt` xếp sau kỳ muộn nhất; test tất cả nhánh; `period_overlap` nếu vẫn xảy ra → `paid_unfulfilled` chứ không mất tiền |
| Thiếu `GRANT` chỉ lộ trên production | Bài `SET ROLE api` cho mọi bảng mới trong `test:api-db` |
| Deploy trước migration | Cổng `check:migration` sẵn có; thứ tự migration → `/healthz/db` → deploy |
| DB ngủ lúc cron chạy | Từng việc try/catch riêng; không có việc nào giả định DB sống |
| Vượt 100 email/ngày | Đếm `email.sent` trong `admin_audit` trước mỗi lần gửi; OTP báo rõ 503; cron chừa 20 |
| Người lạ đăng ký hàng loạt lấy trial | Turnstile + Rate Limiting + một trial mỗi tài khoản; theo dõi số tenant mới/ngày ở Tổng quan admin |
| SPA fallback nuốt file tĩnh | Cùng luật `LA_TEP_TINH` đã có cho `/admin` |
| Website lệch giá với API | Cùng `@mapslibvn/catalog`; test snapshot số trên trang bằng số trong package |
| Số so sánh đối thủ lỗi thời | Website in ngày đối chiếu; `COMPARISON.checkedAt` quá 180 ngày thì build in cảnh báo |
| Đổi tên miền sau làm mất SEO | `SITE_URL` một chỗ; `_redirects` 301; mục 11.3 |
| `dist/admin` chứa console | Ghi README; build console trước build api trong CI |

## 19. Thứ tự triển khai theo pha

| Pha | Nội dung | Kết quả dùng được | Migration |
|---|---|---|---|
| 0 | `@mapslibvn/catalog` (chuyển catalog, thêm VND, COMPARISON, `quoteOrder`, `addMonths`), `@mapslibvn/ui` (chuyển từ admin, test đi theo), `NON_SDK_PACKAGE_DIRS`, `SELF_SERVE`, `/v1/catalog` | Không đổi hành vi; admin xanh y nguyên | không |
| 1 | Website `apps/site` đủ trang mục 11, SEO 11.3, `deploy-site.yml` | **Có website công khai**, CTA trỏ console đang "Sắp mở" | không |
| 2 | Console: OTP, Google, phiên, onboarding, trial, khoá, mức dùng; email OTP/chào mừng; `apps/console` SPA; fallback `/console/*` | **Người lạ tự lấy khoá và gọi API**; bật `SELF_SERVE = 1` sau nghiệm thu | `0020` |
| 3 | Đơn hàng, PayOS, webhook, `fulfilOrder`, cron, email biên nhận/nhắc hạn; màn Mua và Đơn hàng; màn admin tối thiểu (danh sách đơn, "Thử cấp lại", giao dịch không khớp) | **Tự trả tiền, gói tự vào sổ**; PHONG mua thật để nghiệm thu | `0021` |
| 4 | Admin: Khách hàng, Đơn hàng & giao dịch, chỉnh tenant/tổng quan | **Đối soát được từng đơn** | không |

Pha 4 đứng sau pha 3 vì nó đọc dữ liệu pha 3 tạo ra; nhưng **mục "Giao dịch không khớp đơn" và
"Thử cấp lại" phải có ngay khi bật `SELF_SERVE`** — nên pha 3 kết thúc bằng một màn admin tối
thiểu chỉ có danh sách đơn và hai nút đó, pha 4 làm đầy đủ. Mỗi pha một plan riêng trong
`docs/superpowers/plans/`, mỗi plan kết thúc bằng file chứng cứ trong `docs/evidence/commerce/`.

## 20. Tiêu chí nghiệm thu

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:api-db`, `pnpm test:admin-e2e` và
   `pnpm test:console-e2e` xanh; test admin cũ xanh sau khi chuyển sang `@mapslibvn/ui`.
2. Lighthouse mobile trang chủ và bảng giá: Performance ≥ 90, SEO 100, Accessibility ≥ 95,
   LCP ≤ 2,5 s — ảnh chụp trong evidence, chạy trên bản deploy thật.
3. Google Search Console báo sitemap đã nhận và ít nhất trang chủ được index trong 14 ngày sau
   deploy pha 1 (ghi ngày kiểm).
4. Người chưa từng dùng hệ thống, mở website trên điện thoại, đăng ký, lấy khoá, gọi
   `/v1/autocomplete` thành công trong 5 phút, không hỏi PHONG câu nào.
5. PHONG mua Starter 1 tháng bằng tiền thật: đơn `fulfilled` trong 60 giây sau khi chuyển khoản,
   Tổng quan console hiện Starter với hạn đúng, `/admin/billing` hiện kỳ mới với
   `paymentReference` là `reference` của PayOS, email biên nhận về hộp thư, `admin_audit` có
   `order.paid` và `order.fulfilled`.
6. Bắn lại đúng webhook đó lần hai → 200, không có kỳ thứ hai, `payment_event` không thêm dòng.
7. Tắt webhook (đổi URL ở PayOS), mua thêm 1.000 lượt → cron đối soát cấp credit trong 10 phút.
8. Chuyển thiếu tiền → `underpaid`, khách và admin nhận email; admin xác nhận tay → `fulfilled`.
9. Mỗi bảng mới có bài kiểm bằng role `api` thật; `/healthz/db` báo `0021` trước khi deploy pha 3.
10. Tài khoản A không đọc được đơn, khoá, mức dùng của tenant B (404), kiểm bằng test và bằng tay.
11. Tài khoản bị vô hiệu hoá mất quyền trong vòng một request.
12. Bản sáng và tối của website, console đạt tương phản AA; console dùng được trên điện thoại thật.

## 21. Ngoài phạm vi

Hoá đơn điện tử VAT; hoàn tiền tự động; trừ tiền định kỳ; tính chênh lệch nâng gói giữa kỳ; giao
diện nhiều thành viên và vai trò trong tenant; bản tiếng Anh của website và console; hạn mức
tiles và băng thông; chống nhiều tài khoản Free vượt quá mục 6.4; thẻ quốc tế và USD thật;
chatbot hỗ trợ; trang trạng thái hệ thống công khai; thay tên miền (làm khi PHONG mua, theo mục
11.3).

## 22. Files và quy ước

- Mới: `packages/catalog`, `packages/ui`, `apps/site`, `apps/console`, `apps/api/src/console/*`
  (`session.ts`, `otp.ts`, `google.ts`, `require-customer.ts`), `apps/api/src/commerce/*`
  (`orders.ts`, `fulfil.ts`, `payos.ts`, `cron.ts`), `apps/api/src/email/*`,
  `apps/api/src/routes/console-*.ts`, `routes/pay-webhook.ts`, `routes/admin-customers.ts`,
  `routes/admin-orders.ts`, `db/migrations/0020_customer.sql`, `0021_customer_order.sql` kèm
  `.down.sql`, `.github/workflows/deploy-site.yml`, `scripts/pay-fake-webhook.mjs`.
- Sửa: `apps/api/src/index.ts` (mount, fallback `/console/*`, `scheduled`), `wrangler.toml`
  (triggers, ratelimits, vars), `routes/admin.ts` (`ALL_PERMISSIONS`), `routes/admin-tenants.ts`
  (tách `issueKeyForTenant`), `routes/billing-admin.ts` (tách `revokeKey`), `apps/admin` (import từ
  `@mapslibvn/ui`, hai màn mới, sidebar), `scripts/lib/npm-sdk-release.mjs`
  (`NON_SDK_PACKAGE_DIRS`), `vitest.config.ts` (include `packages/ui`, `apps/console`),
  `deploy-api.yml` (build console), `package.json` gốc (`deploy:site`, `test:console-e2e`),
  `apps/docs/src/content/docs/khoa-api.md` (cách xin khoá đổi thành tự đăng ký, link console).
- Không sửa: `access.ts`, `quota-object.ts`, hợp đồng lệnh của sổ quota, `requireBillingAccess()`.
- Toàn bộ chuỗi giao diện tiếng Việt có dấu đầy đủ; tên file và biến theo quy ước từng thư mục
  đang có (admin dùng tiếng Việt không dấu cho biến nội bộ, API dùng tiếng Anh).
