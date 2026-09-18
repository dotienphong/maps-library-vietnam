# Thương mại tự phục vụ — Pha 2: cổng khách hàng `/console` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người lạ tự đăng ký, tự lấy khoá API và gọi được `/v1/autocomplete` trong năm phút, không cần PHONG chạm tay.

**Architecture:** Cổng khách hàng là SPA React tĩnh do chính Worker phục vụ tại `/console`, cùng origin với `/v1/console/*`, nên phiên đi bằng cookie `HttpOnly` và không có CORS. Đăng nhập không mật khẩu: mã một lần gửi qua email, hoặc Google. Mọi cổng ngoài (email, Google, Turnstile) đứng sau một interface và có bản giả, nên pha này code và kiểm được đầy đủ ở máy trước khi PHONG có khoá thật.

**Tech Stack:** Hono trên Workers, Postgres qua Hyperdrive, Durable Object quota sẵn có, Resend, Google OIDC, Cloudflare Turnstile, Rate Limiting binding, React 19 + Vite + Tailwind v4 + `@mapslibvn/ui`, Playwright.

Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 5.1, 6, 7, 12, 14, 19.
Pha 0 và pha 1 đã lên production.

---

## Bối cảnh bắt buộc đọc trước khi làm

**Bốn nguyên tắc của pha này, vi phạm là hỏng thật:**

1. **Sổ quota không học thêm khái niệm nào.** Console chỉ gọi đúng các lệnh đã có (`activateTrial`,
   `readUsage`, `readPeriods`). Tiền và tài khoản là chuyện của Postgres.
2. **Không chép logic cấp và thu hồi khoá.** Hai chỗ đó đang chạy production với thứ tự fail-closed
   đã cân nhắc kỹ; Task 8 tách thành hàm dùng chung chứ không viết bản thứ hai.
3. **API là nơi chặn thật.** Giao diện ẩn nút chỉ cho gọn mắt. Mọi truy vấn của khách phải có
   `WHERE tenant_id = <tenant của phiên>`.
4. **Khoá API dạng rõ chỉ tồn tại đúng một lần trong phản hồi.** Không ghi log, không lưu, không
   trả lại lần thứ hai.

**Bẫy của repo, đã trả giá ít nhất một lần:**

- `pnpm typecheck` chạy `tsc -p tsconfig.scripts.json` **trước** turbo, và bước đó bật `checkJs`
  cho `scripts/**/*.mjs`. Chạy thiếu bước này là ở máy xanh mà CI đỏ.
- Thiếu một dòng `GRANT` chỉ lộ trên production, vì `test:api-db` nối DB bằng role **chủ sở hữu**.
  Mọi bảng mới phải có bài kiểm chạy bằng role `api` thật.
- Mảng SQL phải đi qua `textArray(sql, …)`, không bind mảng JavaScript rồi cast `::text[]`.
- Cột thời gian đọc cho con trỏ phân trang phải qua `to_char(...)` và bind lại bằng
  `::text::timestamptz`, nếu không mất micro giây.
- `instanceof` không sống qua ranh giới RPC của Durable Object; bắt lỗi theo `message`.
- Tailwind v4 không quét `node_modules`: app dùng `@mapslibvn/ui` phải khai `@source`.
- e2e của console phải có cổng riêng, không trùng cổng `dev` của ai khác.

**Cổng ngoài và cách tắt khi chưa có khoá:**

| Cổng | Biến | Vắng biến thì |
|---|---|---|
| Email | `RESEND_API_KEY` | Ngoài production dùng bản ghi log; production trả 503 `email_not_configured` |
| Mã một lần | `OTP_DELIVERY=debug` | Chỉ ngoài production: mã trả thêm ở header `X-Debug-Otp` để e2e chạy được |
| Google | `GOOGLE_CLIENT_ID`/`SECRET` | Nút Google không hiện, route trả 503 `google_not_configured` |
| Turnstile | `TURNSTILE_SECRET` | Bỏ qua bước kiểm, có ghi log cảnh báo; production vắng secret thì từ chối |

Mọi commit kết thúc bằng `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
Không push cho tới Task 18.

## Cấu trúc file

**Tạo mới**

```
db/migrations/0020_customer.sql  +  .down.sql

apps/api/src/console/
  flags.ts            (đã có từ pha 0) selfServeOpen
  session.ts          sinh token, băm, đọc/ghi cookie, tạo/xoá phiên
  session.test.ts
  otp.ts              sinh mã, băm, kiểm hạn và số lần thử
  otp.test.ts
  turnstile.ts        kiểm token Turnstile, bỏ qua khi vắng secret
  turnstile.test.ts
  google.ts           PKCE, đổi code, xác thực id_token theo JWKS
  google.test.ts
  require-customer.ts middleware phiên + nạp tenant
  db.ts               truy vấn Postgres của nhóm console (một chỗ duy nhất)

apps/api/src/email/
  port.ts             interface EmailPort + chọn bản theo môi trường
  resend.ts
  debug.ts
  ngan-sach.ts        đếm email đã gửi trong ngày qua admin_audit
  mau.ts              hai mẫu thư: mã đăng nhập, chào mừng
  mau.test.ts

apps/api/src/tenant-keys.ts   issueKeyForTenant / setKeyRevokedForTenant dùng chung

apps/api/src/routes/
  console-auth.ts     otp/request, otp/verify, google/start, google/callback, logout, logout-all
  console.ts          config, me, tenant, keys, usage, periods — mount chung một cổng

apps/api/test/
  console-session.test.ts  console-otp.test.ts  console-google.test.ts
  console-routes.test.ts   console-keys.test.ts  email-port.test.ts

apps/console/           SPA, build ra apps/admin/dist/console
  package.json  vite.config.ts  tsconfig.json  playwright.config.ts  index.html
  src/main.tsx  routes.tsx  index.css
  src/lib/       fetcher.ts  phien.ts  error-vi.ts  format.ts
  src/layout/    app-shell.tsx  topbar.tsx
  src/features/  auth/  onboarding/  tong-quan/  khoa/  cai-dat/
  e2e/console.spec.ts

docs/evidence/commerce/2026-09-18-pha-2-console.md
```

**Sửa**: `apps/api/src/index.ts` (mount, fallback `/console/*`), `apps/api/src/env.ts` (bảy biến),
`apps/api/wrangler.toml` (hai ratelimit, ba vars), `apps/api/src/routes/admin-tenants.ts` và
`routes/billing-admin.ts` (gọi hàm tách ra), `vitest.config.ts`, `package.json` gốc
(`test:console-e2e`, build console trong `test`), `.github/workflows/deploy-api.yml` (build
console), `docs/DEVLOG.md`, `apps/docs/src/content/docs/khoa-api.md`.

---

### Task 1: Migration `0020` — tài khoản, phiên, thành viên

**Files:**
- Create: `db/migrations/0020_customer.sql`, `db/migrations/0020_customer.down.sql`

- [ ] **Step 1: Viết migration**

`db/migrations/0020_customer.sql` — chép nguyên khối SQL ở spec mục 5.1, kèm ba ghi chú:

```sql
-- Tài khoản khách hàng cho cổng tự phục vụ (spec thương mại tự phục vụ mục 5.1, 6).
-- Không có cột mật khẩu: đăng nhập bằng mã một lần qua email hoặc bằng Google, nên không có
-- kho mật khẩu để rò rỉ.
CREATE TABLE IF NOT EXISTS customer_account (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),
  name            text,
  google_sub      text UNIQUE,
  trial_tenant_id uuid REFERENCES tenant (id),
  last_login_at   timestamptz,
  disabled_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Mã một lần: DB chỉ giữ băm, y như api_key. Đọc trộm bảng này không đăng nhập được.
CREATE TABLE IF NOT EXISTS customer_login_code (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_login_code_email_idx
  ON customer_login_code (email, created_at DESC);
-- Dọn mã hết hạn bằng cron; index theo hạn để câu xoá không quét cả bảng.
CREATE INDEX IF NOT EXISTS customer_login_code_expires_idx ON customer_login_code (expires_at);

CREATE TABLE IF NOT EXISTS customer_session (
  token_hash   text PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES customer_account (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text,
  ip_hash      text
);
CREATE INDEX IF NOT EXISTS customer_session_account_idx ON customer_session (account_id);
CREATE INDEX IF NOT EXISTS customer_session_expires_idx ON customer_session (expires_at);

CREATE TABLE IF NOT EXISTS tenant_member (
  tenant_id  uuid NOT NULL REFERENCES tenant (id),
  account_id uuid NOT NULL REFERENCES customer_account (id),
  role       text NOT NULL CHECK (role IN ('owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, account_id)
);
CREATE INDEX IF NOT EXISTS tenant_member_account_idx ON tenant_member (account_id);

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_name     text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_tax_code text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_address  text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_email    text;

-- GRANT theo đúng nhu cầu và theo CỘT khi chỉ cần vài cột. Migration 0016 tồn tại chính vì 0005
-- quên một dòng GRANT: route thu hồi khoá trả upstream_unavailable trên production trong khi test
-- xanh, vì test nối DB bằng role chủ sở hữu.
GRANT SELECT, INSERT ON customer_account TO api;
GRANT UPDATE (name, google_sub, trial_tenant_id, last_login_at, disabled_at)
  ON customer_account TO api;
GRANT SELECT, INSERT, DELETE ON customer_login_code TO api;
GRANT UPDATE (attempts, consumed_at) ON customer_login_code TO api;
GRANT USAGE, SELECT ON SEQUENCE customer_login_code_id_seq TO api;
GRANT SELECT, INSERT, DELETE ON customer_session TO api;
GRANT UPDATE (last_seen_at, expires_at) ON customer_session TO api;
GRANT SELECT, INSERT ON tenant_member TO api;
-- Console tự tạo tenant: 0005 chỉ cấp SELECT trên tenant.
GRANT INSERT ON tenant TO api;
GRANT UPDATE (name, billing_name, billing_tax_code, billing_address, billing_email)
  ON tenant TO api;
```

`db/migrations/0020_customer.down.sql`:

```sql
DROP TABLE IF EXISTS tenant_member;
DROP TABLE IF EXISTS customer_session;
DROP TABLE IF EXISTS customer_login_code;
-- customer_account phải bỏ SAU ba bảng trên vì chúng tham chiếu tới nó.
DROP TABLE IF EXISTS customer_account;
ALTER TABLE tenant DROP COLUMN IF EXISTS billing_email;
ALTER TABLE tenant DROP COLUMN IF EXISTS billing_address;
ALTER TABLE tenant DROP COLUMN IF EXISTS billing_tax_code;
ALTER TABLE tenant DROP COLUMN IF EXISTS billing_name;
```

- [ ] **Step 2: Chạy lên rồi xuống rồi lên lại trên DB dev**

```bash
pnpm db:up
pnpm db:migrate
psql "$DATABASE_URL" -c "\d customer_account" | head -12
```

Expected: `pnpm db:migrate` in ra đã áp dụng `0020_customer.sql`; bảng có đủ cột.

Nếu chưa có `DATABASE_URL` trong môi trường, lấy từ `.env` gốc repo.

- [ ] **Step 3: Kiểm quyền bằng role `api` thật**

Đây là bước quan trọng nhất của task, vì nó là thứ `test:api-db` không bắt được:

```bash
psql "$DATABASE_URL" <<'SQL'
SET ROLE api;
SELECT count(*) FROM customer_account;
INSERT INTO customer_account (email) VALUES ('kiem-quyen@vidu.vn') RETURNING id;
UPDATE customer_account SET last_login_at = now() WHERE email = 'kiem-quyen@vidu.vn';
INSERT INTO tenant (name, plan, quota_mode) VALUES ('Kiểm quyền', 'free', 'commercial') RETURNING id;
SELECT count(*) FROM customer_session;
SELECT count(*) FROM tenant_member;
RESET ROLE;
DELETE FROM customer_account WHERE email = 'kiem-quyen@vidu.vn';
DELETE FROM tenant WHERE name = 'Kiểm quyền';
SQL
```

Expected: mọi câu chạy được, không có `permission denied`. Câu nào đỏ nghĩa là thiếu một dòng
`GRANT` — sửa migration rồi chạy lại từ đầu bằng `pnpm db:migrate`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0020_customer.sql db/migrations/0020_customer.down.sql
git commit -m "$(cat <<'EOF'
feat(db): migration 0020 — tài khoản khách, mã đăng nhập, phiên, thành viên tenant

GRANT theo cột cho role api và đã kiểm bằng SET ROLE api, không chỉ bằng role chủ sở hữu.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Cổng email — `EmailPort`, bản Resend, bản ghi log, ngân sách ngày

**Files:**
- Create: `apps/api/src/email/port.ts`, `resend.ts`, `debug.ts`, `ngan-sach.ts`, `mau.ts`
- Test: `apps/api/test/email-port.test.ts`, `apps/api/src/email/mau.test.ts` → đặt trong `apps/api/test/email-mau.test.ts`
- Modify: `apps/api/src/env.ts`

- [ ] **Step 1: Viết test (đỏ)**

`apps/api/test/email-port.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { chonEmailPort } from '../src/email/port';
import { resendPort } from '../src/email/resend';

const ENV_CO_KEY = {
  ENVIRONMENT: 'production',
  RESEND_API_KEY: 'khoa-gia',
  EMAIL_FROM: 'no-reply@vidu.vn',
  SUPPORT_EMAIL: 'ho-tro@vidu.vn',
};

describe('chonEmailPort', () => {
  it('có RESEND_API_KEY thì dùng Resend', () => {
    expect(chonEmailPort(ENV_CO_KEY).ten).toBe('resend');
  });

  it('ngoài production mà thiếu key thì dùng bản ghi log, không chặn phát triển', () => {
    expect(chonEmailPort({ ENVIRONMENT: 'dev' }).ten).toBe('debug');
  });

  it('production mà thiếu key thì KHÔNG âm thầm nuốt thư', () => {
    const port = chonEmailPort({ ENVIRONMENT: 'production' });
    expect(port.ten).toBe('thieu-cau-hinh');
  });
});

describe('resendPort', () => {
  it('gọi đúng endpoint, kèm Bearer, from và reply-to', async () => {
    const fetchGia = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'thu-1' }), { status: 200 }),
    );
    const port = resendPort(ENV_CO_KEY, fetchGia);
    const ketQua = await port.send({
      to: 'khach@vidu.vn',
      subject: 'Mã đăng nhập',
      html: '<p>123456</p>',
      text: '123456',
    });

    expect(ketQua.id).toBe('thu-1');
    const [url, init] = fetchGia.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer khoa-gia');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.from).toBe('no-reply@vidu.vn');
    expect(body.reply_to).toBe('ho-tro@vidu.vn');
    expect(body.to).toEqual(['khach@vidu.vn']);
    // Luôn gửi CẢ hai dạng: một số ứng dụng thư chỉ hiện bản chữ, và thiếu nó làm điểm spam xấu đi.
    expect(body.html).toBe('<p>123456</p>');
    expect(body.text).toBe('123456');
  });

  it('Resend trả lỗi thì ném, không nuốt', async () => {
    const fetchGia = vi.fn().mockResolvedValue(new Response('sai khoá', { status: 401 }));
    const port = resendPort(ENV_CO_KEY, fetchGia);
    await expect(port.send({ to: 'a@b.vn', subject: 's', html: 'h', text: 't' })).rejects.toThrow(
      /email_send_failed/,
    );
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api test -- email-port`
Expected: FAIL — không resolve được `../src/email/port`.

- [ ] **Step 3: Viết `port.ts`, `resend.ts`, `debug.ts`**

```ts
// apps/api/src/email/port.ts
import type { Env } from '../env';
import { debugPort } from './debug';
import { resendPort } from './resend';

export interface ThuGui {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailPort {
  /** Tên bản đang dùng, để log và để test khẳng định — không dùng cho logic nghiệp vụ. */
  ten: 'resend' | 'debug' | 'thieu-cau-hinh';
  send(thu: ThuGui): Promise<{ id: string }>;
}

/**
 * Production mà thiếu khoá thì KHÔNG rơi về bản ghi log: thư không gửi mà hệ thống báo thành công
 * là kiểu hỏng tệ nhất — khách ngồi chờ mã không bao giờ tới, còn log thì xanh.
 */
export function chonEmailPort(
  env: Pick<Env, 'ENVIRONMENT' | 'RESEND_API_KEY' | 'EMAIL_FROM' | 'SUPPORT_EMAIL'>,
  fetchImpl: typeof fetch = fetch,
): EmailPort {
  if (env.RESEND_API_KEY) return resendPort(env, fetchImpl);
  if (env.ENVIRONMENT === 'production') {
    return {
      ten: 'thieu-cau-hinh',
      send() {
        throw new Error('email_not_configured');
      },
    };
  }
  return debugPort();
}
```

```ts
// apps/api/src/email/resend.ts
import type { Env } from '../env';
import type { EmailPort, ThuGui } from './port';

export function resendPort(
  env: Pick<Env, 'RESEND_API_KEY' | 'EMAIL_FROM' | 'SUPPORT_EMAIL'>,
  fetchImpl: typeof fetch = fetch,
): EmailPort {
  return {
    ten: 'resend',
    async send(thu: ThuGui) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [thu.to],
          reply_to: env.SUPPORT_EMAIL,
          subject: thu.subject,
          html: thu.html,
          text: thu.text,
        }),
      });
      if (!res.ok) {
        // KHÔNG đưa nội dung phản hồi vào message: nó có thể chứa địa chỉ khách.
        throw new Error(`email_send_failed_${res.status}`);
      }
      const body = (await res.json()) as { id?: string };
      return { id: body.id ?? '' };
    },
  };
}
```

```ts
// apps/api/src/email/debug.ts
import type { EmailPort, ThuGui } from './port';

/** Dùng khi phát triển: in tiêu đề ra log, KHÔNG in nội dung vì mã đăng nhập nằm trong đó. */
export function debugPort(): EmailPort {
  return {
    ten: 'debug',
    async send(thu: ThuGui) {
      console.log(`[email:debug] tới ${thu.to} — ${thu.subject}`);
      return { id: `debug-${crypto.randomUUID()}` };
    },
  };
}
```

`apps/api/src/env.ts` thêm sau `SELF_SERVE`:

```ts
  /** Khoá Resend. Vắng ở production → route gửi thư trả 503 `email_not_configured`. */
  RESEND_API_KEY?: string;
  /** Địa chỉ người gửi, phải thuộc tên miền đã xác thực ở Resend. */
  EMAIL_FROM?: string;
  /** Địa chỉ nhận thư trả lời và hiện trên website. */
  SUPPORT_EMAIL?: string;
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `pnpm --filter @mapslibvn/api test -- email-port`
Expected: 5 test xanh.

- [ ] **Step 5: Ngân sách email ngày**

`apps/api/src/email/ngan-sach.ts`:

```ts
import { endSql, getSql } from '../db';
import type { Env } from '../env';

/** Gói miễn phí của Resend: 100 thư mỗi ngày cho cả tài khoản. */
export const TRAN_NGAY = 100;
/** Chừa cho mã đăng nhập; cron nhắc hạn dừng khi phần còn lại thấp hơn mức này. */
export const CHUA_CHO_OTP = 20;

/**
 * Đếm thư đã gửi trong ngày. Nguồn là `admin_audit` chứ không phải KV hay Rate Limiting binding:
 * Workers Free chỉ cho 1.000 lượt ghi KV mỗi ngày, còn binding Rate Limiting chỉ có chu kỳ 10
 * hoặc 60 giây. Một câu đếm trên bảng đã có index `created_at` là rẻ nhất.
 *
 * Resend tính ngày theo UTC, nên mốc cũng phải là 00:00 UTC.
 */
export async function daGuiHomNay(
  env: Env,
  executionCtx: { waitUntil(promise: Promise<unknown>): void },
): Promise<number> {
  const sql = getSql(env);
  try {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM admin_audit
      WHERE action = 'email.sent' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`;
    return rows[0]?.n ?? 0;
  } finally {
    endSql(executionCtx, sql);
  }
}
```

Kèm hai test trong `apps/api/test/email-port.test.ts`: `TRAN_NGAY` bằng 100 và `CHUA_CHO_OTP`
nhỏ hơn hẳn nó — hai hằng này là chỗ duy nhất nói về giới hạn nhà cung cấp.

- [ ] **Step 6: Hai mẫu thư**

`apps/api/src/email/mau.ts` xuất hai hàm thuần, không chạm mạng:

```ts
export function mauMaDangNhap(ma: string, phutConLai: number): { subject: string; html: string; text: string }
export function mauChaoMung(tenTenant: string, consoleUrl: string, docsUrl: string): { subject: string; html: string; text: string }
```

Nội dung tiếng Việt có dấu, không dùng từ ngữ kiểu quảng cáo; thư mã đăng nhập nói rõ hạn và câu
"không phải bạn thì bỏ qua thư này". `apps/api/test/email-mau.test.ts` kiểm: mã xuất hiện trong cả
`html` lẫn `text`, `subject` dưới 78 ký tự, và **mã không nằm trong `subject`** — tiêu đề thư hiện
ở màn hình khoá điện thoại, ai cầm máy cũng đọc được.

- [ ] **Step 7: Chạy và commit**

Run: `pnpm --filter @mapslibvn/api test -- email && pnpm --filter @mapslibvn/api typecheck && pnpm lint`
Expected: toàn bộ xanh.

```bash
git add apps/api/src/email apps/api/src/env.ts apps/api/test/email-port.test.ts apps/api/test/email-mau.test.ts
git commit -m "$(cat <<'EOF'
feat(api): cổng email — EmailPort, bản Resend, bản ghi log, ngân sách 100 thư/ngày

Production thiếu khoá thì ném email_not_configured chứ không rơi về bản ghi log: thư không gửi mà
hệ thống báo thành công là kiểu hỏng tệ nhất.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Phiên đăng nhập — token, cookie, `requireCustomer()`

**Files:**
- Create: `apps/api/src/console/session.ts`, `apps/api/src/console/db.ts`, `apps/api/src/console/require-customer.ts`
- Test: `apps/api/test/console-session.test.ts`
- Modify: `apps/api/src/env.ts`

- [ ] **Step 1: Viết test (đỏ)**

`apps/api/test/console-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  COOKIE_PHIEN,
  docCookiePhien,
  dungCookiePhien,
  dungCookieXoa,
  hanPhienMoi,
  nenGiaHan,
  sinhTokenPhien,
  bamToken,
} from '../src/console/session';

describe('token phiên', () => {
  it('sinh token dài, ngẫu nhiên, khác nhau mỗi lần', () => {
    const a = sinhTokenPhien();
    const b = sinhTokenPhien();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('băm ổn định và không lộ token gốc', async () => {
    const token = sinhTokenPhien();
    expect(await bamToken(token, 'pepper')).toBe(await bamToken(token, 'pepper'));
    expect(await bamToken(token, 'pepper')).not.toBe(await bamToken(token, 'pepper-khac'));
    expect(await bamToken(token, 'pepper')).not.toContain(token);
  });
});

describe('cookie', () => {
  it('HttpOnly, Secure, SameSite=Lax, Path=/', () => {
    const cookie = dungCookiePhien('abc', 30);
    expect(cookie).toContain(`${COOKIE_PHIEN}=abc`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    // Path=/ chứ không phải /console: cookie phải tới được cả /console/* lẫn /v1/console/*.
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=2592000');
  });

  it('cookie xoá đặt Max-Age=0', () => {
    expect(dungCookieXoa()).toContain('Max-Age=0');
  });

  it('đọc đúng token giữa nhiều cookie khác', () => {
    expect(docCookiePhien(`a=1; ${COOKIE_PHIEN}=xyz; b=2`)).toBe('xyz');
    expect(docCookiePhien('a=1; b=2')).toBeNull();
    expect(docCookiePhien(null)).toBeNull();
  });
});

describe('gia hạn trượt', () => {
  it('phiên mới hết hạn sau 30 ngày', () => {
    const moc = new Date('2026-09-18T00:00:00Z');
    expect(hanPhienMoi(moc).toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });

  it('còn dưới 15 ngày thì gia hạn, còn nhiều hơn thì thôi', () => {
    const now = new Date('2026-09-18T00:00:00Z');
    expect(nenGiaHan(new Date('2026-09-25T00:00:00Z'), now)).toBe(true);
    expect(nenGiaHan(new Date('2026-10-15T00:00:00Z'), now)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api test -- console-session`
Expected: FAIL — không resolve được module.

- [ ] **Step 3: Viết `session.ts`**

```ts
const NGAY_MS = 86_400_000;
/** Phiên sống 30 ngày, gia hạn trượt khi còn dưới 15 ngày. */
export const SONG_NGAY = 30;
const GIA_HAN_KHI_CON_NGAY = 15;

export const COOKIE_PHIEN = 'mlv_console_session';

/** 32 byte ngẫu nhiên, base64url — không có dấu `=` nên đặt vào cookie an toàn. */
export function sinhTokenPhien(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** DB chỉ giữ băm, y như api_key: đọc trộm bảng phiên không mạo danh được ai. */
export async function bamToken(token: string, pepper: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token + pepper));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hanPhienMoi(now: Date = new Date()): Date {
  return new Date(now.getTime() + SONG_NGAY * NGAY_MS);
}

export function nenGiaHan(hetHan: Date, now: Date = new Date()): boolean {
  return hetHan.getTime() - now.getTime() < GIA_HAN_KHI_CON_NGAY * NGAY_MS;
}

/**
 * `SameSite=Lax` cộng cổng chống CSRF sẵn có là đủ cho mọi thao tác ghi; không cần token CSRF
 * riêng. `Path=/` vì cookie phải đi tới cả SPA ở `/console/*` lẫn API ở `/v1/console/*`.
 */
export function dungCookiePhien(token: string, songNgay = SONG_NGAY): string {
  return [
    `${COOKIE_PHIEN}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${songNgay * 86_400}`,
  ].join('; ');
}

export function dungCookieXoa(): string {
  return `${COOKIE_PHIEN}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function docCookiePhien(header: string | null): string | null {
  if (!header) return null;
  for (const phan of header.split(';')) {
    const [ten, ...gia] = phan.trim().split('=');
    if (ten === COOKIE_PHIEN) return gia.join('=') || null;
  }
  return null;
}
```

`apps/api/src/env.ts` thêm:

```ts
  /** Pepper băm token phiên và mã đăng nhập. Đặt bằng `wrangler secret put SESSION_PEPPER`. */
  SESSION_PEPPER?: string;
```

- [ ] **Step 4: Viết `console/db.ts` — mọi truy vấn Postgres của nhóm console nằm một chỗ**

Xuất các hàm: `timTaiKhoanTheoEmail`, `taoTaiKhoan`, `ganGoogleSub`, `taoPhien`, `docPhien`
(join sang `customer_account` và `tenant_member` trong MỘT câu), `giaHanPhien`, `xoaPhien`,
`xoaPhienKhac`, `tenantCuaTaiKhoan`.

`docPhien` trả `null` khi phiên hết hạn hoặc tài khoản bị vô hiệu hoá — kiểm ở SQL chứ không ở
JavaScript, để không có đường nào quên kiểm.

- [ ] **Step 5: `require-customer.ts`**

```ts
/**
 * Cổng cho mọi route `/v1/console/*` trừ `config`, `catalog` và nhóm `auth/*`.
 * Kiểm `disabled_at` ở MỖI request, không cache: vô hiệu hoá một tài khoản phải có hiệu lực ngay,
 * không phải sau khi phiên hết hạn.
 */
export function requireCustomer(): MiddlewareHandler<AppEnv>;
```

Thiếu hoặc hỏng cookie → 401 `not_signed_in` dạng JSON. Tài khoản bị vô hiệu hoá → 403
`account_disabled` **và xoá phiên** ngay tại chỗ. Gán
`c.set('customer', { accountId, email, tenantId })`. Kiểu `Variables` trong `env.ts` thêm
`customer?: { accountId: string; email: string; tenantId: string | null }`.

- [ ] **Step 6: Chạy test và commit**

Run: `pnpm --filter @mapslibvn/api test -- console-session && pnpm --filter @mapslibvn/api typecheck`
Expected: 8 test xanh.

```bash
git add apps/api/src/console apps/api/src/env.ts apps/api/test/console-session.test.ts
git commit -m "$(cat <<'EOF'
feat(api): phiên đăng nhập khách — token 32 byte, DB chỉ giữ băm, cookie HttpOnly SameSite=Lax

requireCustomer() kiểm disabled_at ở mỗi request, không cache: vô hiệu hoá tài khoản có hiệu lực
trong vòng một request.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Mã đăng nhập một lần — sinh, băm, hạn, số lần thử

**Files:**
- Create: `apps/api/src/console/otp.ts`, `apps/api/src/console/turnstile.ts`
- Test: `apps/api/test/console-otp.test.ts`

- [ ] **Step 1: Viết test (đỏ)**

`apps/api/test/console-otp.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  chuanHoaEmail,
  HAN_PHUT,
  hetHanLuc,
  laEmailHopLe,
  maConDung,
  SO_LAN_THU_TOI_DA,
  sinhMa,
} from '../src/console/otp';
import { kiemTurnstile } from '../src/console/turnstile';

describe('sinhMa', () => {
  it('đúng sáu chữ số, có thể bắt đầu bằng 0', () => {
    for (let i = 0; i < 200; i += 1) expect(sinhMa()).toMatch(/^\d{6}$/);
  });

  it('không lặp lại ngay — 200 lần sinh cho ra nhiều hơn 150 giá trị khác nhau', () => {
    const tap = new Set(Array.from({ length: 200 }, () => sinhMa()));
    expect(tap.size).toBeGreaterThan(150);
  });
});

describe('email', () => {
  it('chuẩn hoá về chữ thường và cắt khoảng trắng', () => {
    expect(chuanHoaEmail('  Khach@ViDu.VN ')).toBe('khach@vidu.vn');
  });

  it('nhận dạng hợp lệ tối thiểu, từ chối rác', () => {
    expect(laEmailHopLe('a@b.vn')).toBe(true);
    expect(laEmailHopLe('khach.hang+thu@vi-du.com.vn')).toBe(true);
    expect(laEmailHopLe('khong-co-a-cong')).toBe(false);
    expect(laEmailHopLe('a@b')).toBe(false);
    expect(laEmailHopLe(`${'a'.repeat(250)}@b.vn`)).toBe(false);
  });
});

describe('vòng đời mã', () => {
  it('hết hạn sau 10 phút', () => {
    expect(HAN_PHUT).toBe(10);
    const moc = new Date('2026-09-18T00:00:00Z');
    expect(hetHanLuc(moc).toISOString()).toBe('2026-09-18T00:10:00.000Z');
  });

  it('mã còn dùng được khi chưa hết hạn, chưa dùng, chưa quá số lần thử', () => {
    const now = new Date('2026-09-18T00:05:00Z');
    const con = { expires_at: new Date('2026-09-18T00:10:00Z'), consumed_at: null, attempts: 0 };
    expect(maConDung(con, now)).toBe(true);
    expect(maConDung({ ...con, expires_at: new Date('2026-09-18T00:04:00Z') }, now)).toBe(false);
    expect(maConDung({ ...con, consumed_at: new Date() }, now)).toBe(false);
    expect(maConDung({ ...con, attempts: SO_LAN_THU_TOI_DA }, now)).toBe(false);
  });

  it('cho tối đa năm lần thử một mã', () => {
    expect(SO_LAN_THU_TOI_DA).toBe(5);
  });
});

describe('kiemTurnstile', () => {
  it('vắng secret ngoài production thì cho qua và ghi log', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await kiemTurnstile({ ENVIRONMENT: 'dev' }, 'bat-ky')).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('vắng secret ở production thì TỪ CHỐI — không mở toang chống bot vì quên cấu hình', async () => {
    expect(await kiemTurnstile({ ENVIRONMENT: 'production' }, 'bat-ky')).toBe(false);
  });

  it('có secret thì gọi siteverify và theo kết quả', async () => {
    const env = { ENVIRONMENT: 'production', TURNSTILE_SECRET: 'bi-mat' };
    const dung = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
    expect(await kiemTurnstile(env, 'token', dung)).toBe(true);
    const sai = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false })));
    expect(await kiemTurnstile(env, 'token', sai)).toBe(false);
  });

  it('siteverify chết thì coi như KHÔNG qua', async () => {
    const hong = vi.fn().mockRejectedValue(new Error('mạng chết'));
    expect(
      await kiemTurnstile({ ENVIRONMENT: 'production', TURNSTILE_SECRET: 'x' }, 'token', hong),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ.** Run: `pnpm --filter @mapslibvn/api test -- console-otp`

- [ ] **Step 3: Viết `otp.ts`**

```ts
export const HAN_PHUT = 10;
export const SO_LAN_THU_TOI_DA = 5;

/**
 * Sáu chữ số, lấy từ nguồn ngẫu nhiên mật mã. Dùng rejection sampling để mọi mã có xác suất đều
 * nhau — `% 1000000` trên một số 32 bit làm các mã nhỏ hơi nhiều hơn, và đó là thứ không cần phải
 * chấp nhận khi cách đúng chỉ tốn thêm ba dòng.
 */
export function sinhMa(): string {
  const TRAN = 1_000_000;
  const GIOI_HAN = Math.floor(0xff_ff_ff_ff / TRAN) * TRAN;
  const so = new Uint32Array(1);
  do {
    crypto.getRandomValues(so);
  } while ((so[0] as number) >= GIOI_HAN);
  return String((so[0] as number) % TRAN).padStart(6, '0');
}

export const chuanHoaEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Kiểm tối thiểu: có đúng một `@`, phần sau có dấu chấm, độ dài hợp lý. Không cố viết biểu thức
 * "đúng chuẩn RFC" — nó dài, sai, và cuối cùng thứ chứng minh email có thật vẫn là lá thư gửi tới.
 */
export function laEmailHopLe(email: string): boolean {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export const hetHanLuc = (now: Date = new Date()): Date =>
  new Date(now.getTime() + HAN_PHUT * 60_000);

export function maConDung(
  ma: { expires_at: Date; consumed_at: Date | null; attempts: number },
  now: Date = new Date(),
): boolean {
  return (
    ma.consumed_at === null && ma.attempts < SO_LAN_THU_TOI_DA && ma.expires_at.getTime() > now.getTime()
  );
}
```

- [ ] **Step 4: Viết `turnstile.ts`**

Hàm `kiemTurnstile(env, token, fetchImpl = fetch)`; vắng secret thì trả `false` ở production và
`true` kèm `console.warn` ở nơi khác; có secret thì POST `https://challenges.cloudflare.com/turnstile/v0/siteverify`
với `secret` và `response`, bọc try/catch và **mọi lỗi đều tính là không qua**.

`env.ts` thêm `TURNSTILE_SECRET?: string;` và `TURNSTILE_SITE_KEY?: string;` (site key công khai,
để `[vars]`).

- [ ] **Step 5: Chạy và commit**

Run: `pnpm --filter @mapslibvn/api test -- console-otp && pnpm --filter @mapslibvn/api typecheck`
Expected: 9 test xanh.

```bash
git add apps/api/src/console apps/api/src/env.ts apps/api/test/console-otp.test.ts
git commit -m "$(cat <<'EOF'
feat(api): mã đăng nhập một lần và cổng Turnstile

Mã sáu số dùng rejection sampling cho phân phối đều; Turnstile vắng secret thì TỪ CHỐI ở
production, chỉ cho qua ở môi trường phát triển.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Đăng nhập Google — PKCE và xác thực `id_token`

**Files:**
- Create: `apps/api/src/console/google.ts`
- Test: `apps/api/test/console-google.test.ts`

Tự viết phần xác thực thay vì gọi `access.ts`: `access.ts` là mã bảo mật đang chạy cho trang Admin
với `aud`, `iss` và JWKS của Cloudflare Access. Trùng khoảng ba mươi dòng còn rẻ hơn rủi ro sửa nó.

- [ ] **Step 1: Viết test (đỏ)**

`apps/api/test/console-google.test.ts` dựng cặp khoá RSA bằng `crypto.subtle.generateKey`, ký
`id_token` giả rồi kiểm sáu nhánh:

```ts
import { describe, expect, it, vi } from 'vitest';
import { doiCodeLayToken, dungUrlDangNhap, sinhPkce, xacThucIdToken } from '../src/console/google';

// (phần dựng khoá và hàm kyJwt viết đầy đủ trong file test)

describe('sinhPkce', () => {
  it('verifier đủ dài, challenge là S256 của verifier', async () => {
    const { verifier, challenge } = await sinhPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).not.toBe(verifier);
    const lai = await sinhPkce(verifier);
    expect(lai.challenge).toBe(challenge);
  });
});

describe('dungUrlDangNhap', () => {
  it('có đủ tham số bắt buộc và code_challenge_method=S256', () => {
    const url = new URL(
      dungUrlDangNhap({
        clientId: 'client-1',
        redirectUri: 'https://api.vidu.vn/v1/console/auth/google/callback',
        state: 'trang-thai',
        challenge: 'thach-thuc',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('trang-thai');
  });
});

describe('xacThucIdToken', () => {
  it('token hợp lệ trả email và sub', async () => {/* … */});
  it('từ chối khi email_verified là false — email chưa xác minh chiếm được tài khoản người khác', async () => {/* … */});
  it('từ chối aud khác client id', async () => {/* … */});
  it('từ chối iss lạ', async () => {/* … */});
  it('từ chối token hết hạn', async () => {/* … */});
  it('từ chối khi chữ ký ký bằng khoá khác', async () => {/* … */});
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ.** Run: `pnpm --filter @mapslibvn/api test -- console-google`

- [ ] **Step 3: Viết `google.ts`**

Bốn hàm xuất:

- `sinhPkce(verifier?)` — verifier 32 byte base64url, challenge là SHA-256 base64url. Nhận
  verifier để test khẳng định tính tất định.
- `dungUrlDangNhap({ clientId, redirectUri, state, challenge })`.
- `doiCodeLayToken({ code, verifier, clientId, clientSecret, redirectUri }, fetchImpl)` — POST
  `https://oauth2.googleapis.com/token`, trả `id_token`.
- `xacThucIdToken(token, { clientId, jwks })` — RS256, kiểm `iss` thuộc
  `{'https://accounts.google.com', 'accounts.google.com'}`, `aud` bằng `clientId`, `exp` còn hạn,
  và **bắt buộc `email_verified === true`**; trả `{ email, sub, name }`.

JWKS tải từ `https://www.googleapis.com/oauth2/v3/certs`, cache KV một giờ dưới khoá
`google:certs` — cùng cách `access.ts` cache JWKS của Access.

`env.ts` thêm `GOOGLE_CLIENT_ID?`, `GOOGLE_CLIENT_SECRET?`.

- [ ] **Step 4: Chạy và commit**

Run: `pnpm --filter @mapslibvn/api test -- console-google && pnpm --filter @mapslibvn/api typecheck`
Expected: 8 test xanh, gồm cả bốn nhánh từ chối.

```bash
git add apps/api/src/console/google.ts apps/api/src/env.ts apps/api/test/console-google.test.ts
git commit -m "$(cat <<'EOF'
feat(api): đăng nhập Google — PKCE, đổi code, xác thực id_token theo JWKS

Bắt buộc email_verified: email chưa xác minh cho phép chiếm tài khoản của người khác.
Không đụng access.ts — đó là mã bảo mật đang chạy cho trang Admin.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Nhóm route xác thực `/v1/console/auth/*`

**Files:**
- Create: `apps/api/src/routes/console-auth.ts`
- Test: `apps/api/test/console-auth.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Viết test (đỏ)** — tiêm cổng giả cho DB, email và Turnstile theo đúng khuôn
`billingAdminWith(dependencies)` đã có, để test không cần Postgres:

```ts
describe('POST /v1/console/auth/otp/request', () => {
  it('luôn trả 200 kể cả email chưa từng đăng ký — không lộ ai đã có tài khoản', async () => {});
  it('email sai định dạng vẫn trả 200 nhưng KHÔNG gửi thư', async () => {});
  it('Turnstile không qua → 403 turnstile_failed', async () => {});
  it('vượt tần suất → 429 too_many_requests kèm Retry-After', async () => {});
  it('ngân sách email cạn → 503 email_budget_exhausted, nói thật chứ không im lặng', async () => {});
  it('ngoài production và OTP_DELIVERY=debug thì trả mã ở header X-Debug-Otp', async () => {});
  it('ở production thì KHÔNG bao giờ trả header đó dù đặt cờ', async () => {});
  it('xin mã mới thì mã cũ của cùng email bị xoá', async () => {});
});

describe('POST /v1/console/auth/otp/verify', () => {
  it('mã đúng → đặt cookie phiên, trả onboarded', async () => {});
  it('mã sai → 401 và tăng số lần thử', async () => {});
  it('sai đủ năm lần → mã chết, lần thứ sáu vẫn 401 dù gõ đúng', async () => {});
  it('mã hết hạn → 401 code_expired', async () => {});
  it('tài khoản bị vô hiệu hoá → 403 account_disabled, không cấp phiên', async () => {});
});

describe('logout', () => {
  it('xoá phiên trong DB và trả cookie Max-Age=0', async () => {});
  it('logout-all xoá mọi phiên KHÁC, giữ phiên hiện tại', async () => {});
});

describe('cổng tự phục vụ', () => {
  it('SELF_SERVE=0 → mọi route auth trả 503 self_serve_closed', async () => {});
  it('nhưng /v1/console/config vẫn trả 200 để SPA hiện màn "Sắp mở"', async () => {});
});
```

- [ ] **Step 2: Viết `console-auth.ts`**

Luồng `otp/request` theo đúng thứ tự, và **thứ tự này quan trọng**:

1. Cổng `selfServeOpen`.
2. Đọc body ≤ 4 KiB; `chuanHoaEmail`.
3. `kiemTurnstile` — trước khi chạm DB, để bot không làm mình tốn truy vấn.
4. Rate limit: `OTP_EMAIL_RATE_LIMITER.limit({ key: email })` và
   `OTP_IP_RATE_LIMITER.limit({ key: ipHash })`.
5. `laEmailHopLe` — sai thì **vẫn trả 200**, không gửi gì.
6. Ngân sách email ngày.
7. Xoá mã cũ, chèn mã mới đã băm, gửi thư trong `waitUntil`, ghi `admin_audit` `email.sent`.
8. Trả 200 `{ daGui: true }`; chỉ khi ngoài production và `OTP_DELIVERY === 'debug'` mới kèm
   header `X-Debug-Otp`.

`otp/verify`: lấy mã mới nhất chưa dùng của email, so băm; sai thì `attempts + 1` rồi 401; đúng thì
đánh dấu đã dùng, upsert tài khoản, tạo phiên, đặt cookie, cập nhật `last_login_at`, ghi audit
`customer.signin`.

`google/start` và `google/callback` theo Task 5; `state` và `code_verifier` để trong cookie
`mlv_oauth` HttpOnly hạn 10 phút, xoá ngay sau khi dùng.

- [ ] **Step 3: Mount và cổng chung trong `index.ts`**

```ts
// Cùng khuôn với nhóm admin: khai cổng đúng MỘT chỗ, để thêm route mới không thể quên gắn.
app.use('/v1/console/*', requireSameSitePost());
app.route('/', consoleAuth);
```

`requireSameSitePost()` dùng lại của `routes/admin.ts` — cookie `SameSite=Lax` cộng cổng này là đủ
cho CSRF, không cần token riêng.

- [ ] **Step 4: `wrangler.toml` — hai ratelimit và ba vars**

```toml
# Mã đăng nhập: mỗi email một mã mỗi phút, mỗi IP ba lượt mỗi phút. Binding Rate Limiting chỉ có
# chu kỳ 10 hoặc 60 giây, nên giao diện phải nói đúng hành vi thật là "mỗi phút một mã".
ratelimits = [
  …,
  { name = "OTP_EMAIL_RATE_LIMITER", namespace_id = "20260920", simple = { limit = 1, period = 60 } },
  { name = "OTP_IP_RATE_LIMITER",    namespace_id = "20260921", simple = { limit = 3, period = 60 } },
]
```

Thêm vào `[vars]` và khối `[env.production]`: `EMAIL_FROM = "no-reply@ai-solutions.io.vn"`,
`SUPPORT_EMAIL = "dotienphong1993@gmail.com"`, `TURNSTILE_SITE_KEY = ""` (PHONG điền sau).
`SELF_SERVE` giữ `"0"` tới Task 18.

- [ ] **Step 5: Chạy và commit**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck && pnpm lint`
Expected: toàn bộ xanh; `wrangler deploy --dry-run --env production` bundle được.

```bash
git add apps/api/src/routes/console-auth.ts apps/api/src/index.ts apps/api/wrangler.toml apps/api/test/console-auth.test.ts
git commit -m "$(cat <<'EOF'
feat(api): nhóm route xác thực khách — mã một lần, Google, đăng xuất

otp/request luôn trả 200 để không lộ email nào đã đăng ký; hai lỗi hạ tầng thì nói thật vì khách
cần biết phải chờ. Header X-Debug-Otp chỉ sống ngoài production.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Tenant, bản dùng thử và thông tin biên nhận

**Files:**
- Create: `apps/api/src/routes/console.ts`
- Test: `apps/api/test/console-routes.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Viết test (đỏ)**

```ts
describe('GET /v1/console/config', () => {
  it('công khai, trả site key Turnstile, cờ Google và cờ tự phục vụ', async () => {});
  it('KHÔNG lộ secret nào', async () => {});
});

describe('GET /v1/console/me', () => {
  it('chưa đăng nhập → 401 not_signed_in dạng JSON, không phải HTML', async () => {});
  it('đã đăng nhập, chưa có tenant → onboarded false', async () => {});
});

describe('POST /v1/console/tenant', () => {
  it('tạo tenant plan=free quota_mode=commercial, gắn owner, rồi kích hoạt trial', async () => {});
  it('operationId của trial cố định theo tenant nên gọi lại không tạo trial thứ hai', async () => {});
  it('tài khoản đã có tenant → 409 tenant_already_exists', async () => {});
  it('tài khoản đã dùng trial ở tenant khác → 409 trial_already_used', async () => {});
  it('tên tenant rỗng hoặc quá dài → 400 invalid_tenant_name', async () => {});
  it('tạo tenant xong mà sổ quota lỗi → tenant vẫn tồn tại, lần sau gọi lại kích hoạt được', async () => {});
});

describe('PATCH /v1/console/tenant', () => {
  it('đổi được tên và bốn trường biên nhận', async () => {});
  it('KHÔNG đổi được plan hay quota_mode dù gửi lên', async () => {});
});
```

- [ ] **Step 2: Viết `console.ts`**

`POST /v1/console/tenant` theo đúng thứ tự spec mục 7:

```ts
// Postgres trước, sổ quota sau. Ngược lại thì một sổ quota mồ côi ra đời cho một tenant không
// tồn tại, và không có đường nào tìm lại nó — trang Admin đã có sáu sổ như vậy từ một lỗi khác.
// Bước 2 lỗi thì tenant vẫn còn, `status: 'none'`, và lần mở console kế tiếp gọi lại đúng
// operationId nên idempotent.
```

1. Trong một transaction: `INSERT tenant` → `INSERT tenant_member(owner)` →
   `UPDATE customer_account SET trial_tenant_id`.
2. `activateTrial` với `operationId = 'trial:' + tenantId`, `expectedRevision: 0`,
   `actor: 'customer:' + email`, `reason: 'Tự đăng ký qua cổng khách hàng'`.
3. Audit `customer.tenant_create`.

Bắt lỗi theo **message** chứ không `instanceof` — lỗi từ Durable Object đi qua RPC mất class.

- [ ] **Step 3: Chạy và commit**

Run: `pnpm --filter @mapslibvn/api test -- console-routes && pnpm --filter @mapslibvn/api typecheck`

```bash
git add apps/api/src/routes/console.ts apps/api/src/index.ts apps/api/test/console-routes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): console tạo tenant và kích hoạt bản dùng thử

Postgres trước, sổ quota sau: ngược lại sinh ra sổ quota mồ côi không tìm lại được.
operationId cố định theo tenant nên gọi lại không tạo trial thứ hai.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Tách cấp và thu hồi khoá thành hàm dùng chung

**Files:**
- Create: `apps/api/src/tenant-keys.ts`
- Test: `apps/api/test/console-keys.test.ts`
- Modify: `apps/api/src/routes/admin-tenants.ts`, `apps/api/src/routes/billing-admin.ts`

Đây là task dễ làm hỏng nhất của cả pha, vì nó đụng vào hai đường đang chạy production. Quy tắc:
**chuyển nguyên hành vi, không cải tiến gì thêm**, và bộ test cũ phải xanh y nguyên trước lẫn sau.

- [ ] **Step 1: Ghi mốc test trước khi đụng vào**

```bash
pnpm --filter @mapslibvn/api test 2>&1 | tail -3
```

Ghi lại số file và số test. Sau Task 8 con số này chỉ được **tăng**, không được giảm.

- [ ] **Step 2: Tạo `tenant-keys.ts` bằng cách CHUYỂN mã, không viết lại**

Hai hàm, nhận `sql` và `env` từ ngoài để cả hai đường gọi đều dùng chung một bản:

```ts
/**
 * Cấp một khoá API mới cho tenant. Chuyển nguyên từ route quản trị (`admin-tenants.ts`) để trang
 * Admin và cổng khách hàng không bao giờ lệch nhau về cách sinh khoá, cách băm và cách xoá cache.
 *
 * Khoá dạng rõ chỉ tồn tại trong giá trị trả về của hàm này. Không ghi log, không lưu lại.
 */
export async function issueKeyForTenant(
  sql: Sql,
  env: Env,
  input: { tenantId: string; label: string; kind: KeyKind; allowedOrigins: string[]; allowedBundleIds: string[]; scopes: string[]; quotaDirectionsPerDay: number | null },
): Promise<{ key: string; keyPrefix: string; keyHash: string }>;

/**
 * Thu hồi hoặc khôi phục một khoá. Giữ NGUYÊN thứ tự fail-closed đã cân nhắc ở route quản trị:
 * thu hồi chạm Durable Object trước rồi mới tới Postgres, khôi phục thì ngược lại. Đổi thứ tự
 * này tạo ra cửa sổ mà khoá đã thu hồi vẫn gọi API được.
 */
export async function setKeyRevokedForTenant(
  sql: Sql,
  env: Env,
  input: { tenantId: string; keyHash: string; revoked: boolean; operationId: string; actor: string; reason: string },
): Promise<unknown>;
```

Ba điều bắt buộc giữ nguyên khi chuyển: ba cột mảng đi qua `textArray(sql, …)`; xoá
`META.delete('apikey:' + keyHash)` cả ở nhánh thành công lẫn nhánh lỗi; và câu `INSERT` giữ đúng
danh sách cột hiện có.

- [ ] **Step 3: Hai route quản trị gọi hàm mới**

`admin-tenants.ts` và `billing-admin.ts` bỏ phần thân, gọi hàm chung, **giữ nguyên** phần kiểm
tham số, phần ghi `audit` và phần dựng phản hồi — đó là chuyện riêng của từng route.

- [ ] **Step 4: Bộ test cũ phải xanh y nguyên**

```bash
pnpm --filter @mapslibvn/api test 2>&1 | tail -3
```

Expected: số test **bằng hoặc lớn hơn** mốc ở Step 1, không bài nào đỏ. Đỏ một bài nghĩa là đã
đổi hành vi trong lúc chuyển — quay lại so từng dòng với bản gốc.

- [ ] **Step 5: Route khoá của console**

Trong `console.ts`:

- `GET /v1/console/keys` — chỉ khoá của tenant trong phiên, không trả `key_hash` đầy đủ mà chỉ
  `key_prefix` cộng tám ký tự đầu của hash làm định danh để thu hồi.
- `POST /v1/console/keys` — tối đa **10 khoá đang hoạt động** mỗi tenant, vượt thì 409
  `too_many_keys`; scope cố định `['places:read']`; trả khoá rõ **đúng một lần**.
- `POST /v1/console/keys/:hash/revoke` — `operationId` do client sinh.

- [ ] **Step 6: Viết test cho nhóm khoá console**

`apps/api/test/console-keys.test.ts`:

```ts
it('chỉ liệt kê khoá của tenant trong phiên', async () => {});
it('tài khoản khác không thu hồi được khoá của tenant mình không sở hữu → 404', async () => {});
it('khoá rõ chỉ xuất hiện một lần, lần đọc sau không còn', async () => {});
it('scope luôn là places:read dù client gửi edits:write', async () => {});
it('quá 10 khoá đang hoạt động → 409 too_many_keys', async () => {});
it('khoá đã thu hồi không tính vào hạn mức 10 khoá', async () => {});
```

Bài thứ hai là bài quan trọng nhất của cả task: nó chứng minh một khách không chạm được vào tenant
của khách khác.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/tenant-keys.ts apps/api/src/routes apps/api/test/console-keys.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): tách issueKeyForTenant và setKeyRevokedForTenant dùng chung cho Admin lẫn console

Chuyển nguyên hành vi, giữ đúng thứ tự fail-closed: thu hồi chạm Durable Object trước, khôi phục
chạm Postgres trước. Console cấp tối đa 10 khoá và luôn ép scope places:read.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Mức dùng và lịch sử kỳ cho khách

**Files:**
- Modify: `apps/api/src/routes/console.ts`
- Test: `apps/api/test/console-routes.test.ts`

- [ ] **Step 1: Viết test (đỏ)**

```ts
it('GET /v1/console/usage trả đúng bản readUsage của tenant trong phiên', async () => {});
it('chưa có tenant → 409 chua_co_tenant, không tạo sổ quota', async () => {});
it('KHÔNG lộ trường nội bộ nào ngoài hợp đồng UsageSnapshot', async () => {});
it('GET /v1/console/periods trả lịch sử kỳ, mặc định 12 kỳ gần nhất', async () => {});
it('mọi phản hồi đặt cache-control private, no-store', async () => {});
```

- [ ] **Step 2: Viết hai route**

Gọi thẳng `quotaObject(env, tenantId).readUsage()` và `.readPeriods(12)`. Tenant của console luôn
`quota_mode = 'commercial'` nên không có chuyện tạo sổ mồ côi cho tenant `legacy` — khác trang
Admin, nơi đã phải rẽ nhánh theo `quota_mode` vì lý do đó.

- [ ] **Step 3: Chạy và commit**

```bash
git add apps/api/src/routes/console.ts apps/api/test/console-routes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): console đọc mức dùng và lịch sử kỳ của chính tenant mình

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Bộ kiểm chạy bằng role `api` thật cho bảng mới

**Files:**
- Modify: `scripts/api-db-test.mjs` hoặc thêm `db/console.dbtest.mjs` theo khuôn đang có
- Test: chạy bằng `pnpm test:api-db`

Đây là lưới an toàn cho đúng loại lỗi mà `test:api-db` bỏ lọt: bộ đó nối DB bằng role **chủ sở
hữu**, nên thiếu `GRANT` vẫn xanh ở máy rồi đỏ trên production.

- [ ] **Step 1: Xem khuôn hiện có**

```bash
ls db/*.dbtest.mjs
grep -rn "SET ROLE" db/ scripts/ | head -5
```

- [ ] **Step 2: Viết bài kiểm**

Mở kết nối rồi `SET ROLE api`, sau đó chạy đúng những câu mà mã thật chạy: chèn tài khoản, chèn
mã đăng nhập, chèn phiên, chèn tenant, chèn thành viên, cập nhật từng cột được cấp, và **thử một
cột KHÔNG được cấp** (`UPDATE tenant SET plan = 'paid'`) để khẳng định nó bị từ chối.

Bài cuối quan trọng không kém bài đầu: nó chứng minh cấp quyền theo cột thật sự có hiệu lực, chứ
không phải mình tưởng thế.

- [ ] **Step 3: Chạy và commit**

Run: `pnpm test:api-db`
Expected: toàn bộ xanh, gồm các bài mới.

```bash
git add db scripts
git commit -m "$(cat <<'EOF'
test(db): kiểm bảng 0020 bằng role api thật, gồm cả cột KHÔNG được cấp phải bị từ chối

test:api-db nối DB bằng role chủ sở hữu nên không bắt được thiếu GRANT; bài này bắt.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Scaffold `apps/console` — SPA chạy được với một màn hình

**Files:**
- Create: `apps/console/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/routes.tsx`, `src/index.css`, `src/lib/fetcher.ts`, `src/layout/app-shell.tsx`
- Modify: `apps/api/src/index.ts` (fallback `/console/*`), `package.json` gốc, `vitest.config.ts`, `.github/workflows/deploy-api.yml`

- [ ] **Step 1: `package.json` — build ra thư mục con của admin**

```json
{
  "name": "@mapslibvn/console",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 4324",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@mapslibvn/catalog": "workspace:*",
    "@mapslibvn/ui": "workspace:*",
    "@tanstack/react-query": "^5.102.8",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "react-router": "^8.4.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@tailwindcss/vite": "^4.3.3",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.7",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.1",
    "tailwindcss": "^4.3.3",
    "typescript": "^6.0.3",
    "vite": "^8.3.0"
  }
}
```

`vite.config.ts`: `base: '/console/'`, `build.outDir: '../admin/dist/console'`,
`resolve.dedupe: ['react', 'react-dom']`, alias `@` → `src`.

```ts
// Worker `[assets]` chỉ nhận MỘT thư mục và đang trỏ ../admin/dist, nên console build thẳng vào
// thư mục con của nó. `emptyOutDir` phải TẮT: bật lên thì lần build console xoá sạch bản admin
// nằm cùng thư mục cha.
build: { outDir: '../admin/dist/console', emptyOutDir: false },
```

- [ ] **Step 2: `index.css` — token dùng chung và `@source`**

```css
@import "tailwindcss";
@import "../../../packages/ui/src/tokens.css";
/* Tailwind v4 không quét node_modules, mà component của @mapslibvn/ui tới đây qua symlink.
   Thiếu dòng này thì nút mất kiểu mà không có lỗi nào — pha 0 đã vấp. */
@source "../../../packages/ui/src";
@custom-variant dark (&:where(.dark, .dark *));
```

Phần `body` và `@layer base` chép từ `apps/admin/src/index.css`; theme dùng khoá riêng
`mapslibvn-console-theme` qua adapter giống admin.

- [ ] **Step 3: `lib/fetcher.ts` — khác admin ở cách xử lý 401**

```ts
/**
 * Khác trang Admin: ở đó 401 nghĩa là phiên Cloudflare Access hết hạn và cách sửa là tải lại
 * trang để Access đưa về màn đăng nhập. Ở đây 401 là phiên khách hết hạn, và tải lại trang chỉ
 * cho ra đúng màn hình đó lần nữa. Cách đúng là chuyển sang màn đăng nhập của chính console,
 * giữ lại đường dẫn đang xem trong `?next=` để quay lại sau khi đăng nhập.
 */
export class ConsoleApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
```

`apiFetch` gửi `credentials: 'same-origin'`, đặt `accept: application/json`, và khi gặp 401
`not_signed_in` thì gọi một hàm điều hướng do `main.tsx` tiêm vào (không import router ở đây, để
`fetcher` không biết gì về giao diện).

- [ ] **Step 4: Fallback SPA trong Worker**

`apps/api/src/index.ts` — mở rộng đúng luật đã có cho `/admin`:

```ts
// Cùng luật với /admin: CHỈ đường dẫn điều hướng, không áp cho tệp có phần mở rộng. Bản đầu của
// /admin nuốt cả yêu cầu .js và làm bản đồ trắng không lỗi — sự cố 16/09/2026.
app.get('/console/*', async (c) => { … });
```

- [ ] **Step 5: Script gốc và CI**

`package.json` gốc: thêm `"test:console-e2e"`, và chèn `pnpm --filter @mapslibvn/console build`
vào script `test` **trước** `@mapslibvn/api test`. `deploy-api.yml` thêm bước build console
**sau** build admin (vì console ghi vào thư mục con của admin, mà admin build có `emptyOutDir`).
`vitest.config.ts` thêm `'apps/console/src/**/*.test.{ts,tsx}'`.

- [ ] **Step 6: Build và kiểm**

```bash
pnpm install
pnpm --filter @mapslibvn/admin build
pnpm --filter @mapslibvn/console build
ls apps/admin/dist/admin/index.html apps/admin/dist/console/index.html
grep -c -- "--color-brand-700" apps/admin/dist/console/assets/*.css
```

Expected: cả hai `index.html` cùng tồn tại — chứng minh build console **không** xoá bản admin;
grep ≥ 1.

- [ ] **Step 7: Commit**

```bash
git add apps/console apps/api/src/index.ts package.json vitest.config.ts .github/workflows/deploy-api.yml pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(console): scaffold apps/console — SPA build vào thư mục con của admin/dist

emptyOutDir TẮT: bật lên thì build console xoá sạch bản admin nằm cùng thư mục cha.
Fallback /console/* dùng đúng luật "chỉ đường dẫn không có phần mở rộng" của /admin.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Màn đăng nhập và xác thực mã

**Files:**
- Create: `apps/console/src/features/auth/api.ts`, `hooks.ts`, `dang-nhap.tsx`, `xac-thuc.tsx`, `o-ma.tsx`, `o-ma.test.tsx`
- Modify: `apps/console/src/routes.tsx`

- [ ] **Step 1: Viết test cho ô nhập mã (đỏ)**

Ô nhập mã sáu số là chỗ dễ làm khó chịu nhất trên điện thoại, nên nó có test riêng:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OMa } from './o-ma';

describe('OMa', () => {
  it('gõ sáu số thì gọi onXong đúng một lần với cả mã', async () => {});
  it('dán cả mã từ clipboard thì điền hết sáu ô', async () => {});
  it('xoá lùi ở ô rỗng thì nhảy về ô trước', async () => {});
  it('chỉ nhận chữ số, bỏ qua chữ cái', async () => {});
  it('inputMode numeric và autocomplete one-time-code để điện thoại gợi ý mã từ tin nhắn', () => {});
});
```

- [ ] **Step 2: Viết `o-ma.tsx`** — sáu `<input maxLength={1} inputMode="numeric"
  autoComplete="one-time-code">`, tự nhảy ô, xử lý dán, và `aria-label` từng ô.

- [ ] **Step 3: Màn `dang-nhap.tsx`**

Ô email, Turnstile (chỉ dựng widget khi `config.turnstileSiteKey` có giá trị), nút gửi mã, nút
"Đăng nhập bằng Google" (chỉ hiện khi `config.googleEnabled`), và một dòng dẫn tới Điều khoản
tenant. Sau khi gửi mã, chuyển sang `/console/xac-thuc?email=…`.

Nút gửi lại mã bị khoá 60 giây kèm đếm ngược, vì máy chủ chỉ cho một mã mỗi phút — hiện đúng hành
vi thật thay vì để khách bấm rồi nhận 429.

- [ ] **Step 4: Màn `xac-thuc.tsx`**

`OMa`, đồng hồ đếm ngược 10 phút, nút gửi lại, và thông báo lỗi dịch sang tiếng Việt qua
`error-vi.ts`: `invalid_code` → "Mã không đúng, còn N lần thử", `code_expired` → "Mã đã hết hạn,
hãy xin mã mới", `too_many_requests` → "Mỗi phút chỉ xin được một mã", `email_budget_exhausted` →
"Hệ thống tạm hết lượt gửi thư hôm nay, hãy thử lại sau hoặc đăng nhập bằng Google".

Xác thực xong: `onboarded` false → `/console/bat-dau`, true → `/console/`.

- [ ] **Step 5: Chạy và commit**

Run: `npx vitest run apps/console/src && pnpm --filter @mapslibvn/console typecheck`

```bash
git add apps/console
git commit -m "$(cat <<'EOF'
feat(console): màn đăng nhập bằng mã một lần và Google

Ô nhập mã sáu số dán được, tự nhảy ô, khai one-time-code để điện thoại gợi ý mã từ tin nhắn.
Nút gửi lại khoá 60 giây đúng bằng hành vi thật của máy chủ.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Màn bắt đầu — tạo tổ chức và khoá đầu tiên

**Files:**
- Create: `apps/console/src/features/onboarding/page.tsx`, `api.ts`, `hooks.ts`, `khoa-mot-lan.tsx`, `khoa-mot-lan.test.tsx`

- [ ] **Step 1: Viết test cho khối hiện khoá (đỏ)**

```tsx
it('hiện khoá đầy đủ kèm cảnh báo chỉ thấy một lần', () => {});
it('nút sao chép gọi clipboard với đúng chuỗi khoá', async () => {});
it('clipboard bị chặn thì vẫn chọn được chữ để chép tay, không im lặng', async () => {});
it('đoạn mã nhúng mẫu chứa đúng khoá vừa cấp', () => {});
```

Bài thứ ba đáng giá: trình duyệt chặn clipboard trong ngữ cảnh không an toàn hoặc khi thiếu quyền,
và một nút sao chép im lặng không làm gì là cách chắc chắn để khách mất khoá.

- [ ] **Step 2: Màn bắt đầu, ba bước trên một trang**

1. Tên tổ chức (bắt buộc), tên khoá đầu tiên (mặc định "Khoá đầu tiên"), ô origin cho phép (có
   thể bỏ trống, kèm giải thích một dòng là để trống nghĩa là không giới hạn).
2. Bấm tạo: gọi `POST /v1/console/tenant` rồi `POST /v1/console/keys` **tuần tự**; tenant tạo được
   mà cấp khoá lỗi thì vẫn vào được Tổng quan và cấp khoá sau ở màn Khoá.
3. Hiện khoá **một lần** kèm đoạn mã nhúng có sẵn khoá, nút sao chép, và nút "Tôi đã lưu khoá"
   dẫn sang Tổng quan.

- [ ] **Step 3: Chạy và commit**

```bash
git add apps/console
git commit -m "$(cat <<'EOF'
feat(console): màn bắt đầu — tạo tổ chức, kích hoạt bản dùng thử, cấp khoá đầu tiên

Khoá hiện đúng một lần kèm đoạn mã nhúng dán chạy được ngay; nút sao chép có nhánh dự phòng khi
trình duyệt chặn clipboard.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Màn Tổng quan — gói, hạn mức, cảnh báo

**Files:**
- Create: `apps/console/src/features/tong-quan/page.tsx`, `api.ts`, `hooks.ts`, `thanh-han-muc.tsx`, `thanh-han-muc.test.tsx`

- [ ] **Step 1: Viết test cho thanh hạn mức (đỏ)**

```tsx
it('dưới 80% hiện màu thương hiệu', () => {});
it('từ 80% hiện hổ phách', () => {});
it('từ 100% hiện đỏ và nói rõ đã hết lượt', () => {});
it('hiện cả số đã dùng lẫn hạn mức, không chỉ phần trăm', () => {});
it('lượt mua thêm hiện thành phần riêng, không cộng lẫn vào hạn mức kỳ', () => {});
it('chia cho hạn mức 0 không làm vỡ giao diện', () => {});
```

Bài cuối là bài bảo vệ: tenant chưa có quyền có `limit = 0`, và một phép chia cho 0 làm cả trang
trắng ngay lần mở đầu tiên của khách mới.

- [ ] **Step 2: Màn Tổng quan**

Ô gói hiện tại (tên gói, trạng thái, ngày hết hạn, số ngày còn lại); hai thanh hạn mức Places và
tuyến đường; ô lượt mua thêm nếu có; cảnh báo khi `missingAcks.locked`; và ba nút "Gia hạn",
"Nâng gói", "Mua thêm lượt" — pha này **chưa có trang mua**, nên ba nút dẫn tới một hộp thoại nói
rõ "Thanh toán tự phục vụ đang được hoàn thiện, hãy liên hệ để được cấp gói" kèm email và số điện
thoại. Nói thật còn hơn một nút bấm vào không có gì xảy ra.

Dưới cùng là lịch sử kỳ từ `/v1/console/periods`.

- [ ] **Step 3: Chạy và commit**

```bash
git add apps/console
git commit -m "$(cat <<'EOF'
feat(console): màn Tổng quan — gói, hai thanh hạn mức, cảnh báo 80% và 100%

Ba nút mua dẫn tới hộp thoại nói thật là thanh toán tự phục vụ chưa xong, kèm email và số điện
thoại — thay vì một nút bấm vào không có gì xảy ra.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Màn Khoá API và màn Cài đặt

**Files:**
- Create: `apps/console/src/features/khoa/page.tsx`, `api.ts`, `hooks.ts`; `apps/console/src/features/cai-dat/page.tsx`, `api.ts`, `hooks.ts`

- [ ] **Step 1: Màn Khoá**

Danh sách khoá: tiền tố, nhãn, loại, origin cho phép, ngày tạo, trạng thái. Nút cấp khoá mới dùng
lại khối hiện khoá một lần của Task 13. Thu hồi đi qua `delayed-action` năm giây của
`@mapslibvn/ui` — cùng cơ chế trang Admin dùng cho thao tác khó đảo ngược.

Một dòng nhắc ngay dưới tiêu đề: **cấp thêm khoá không cấp thêm hạn mức**. Đây là hiểu nhầm phổ
biến nhất và tài liệu đã phải nói riêng một mục về nó.

- [ ] **Step 2: Màn Cài đặt**

Tên tổ chức; bốn trường thông tin biên nhận; email đăng nhập (chỉ đọc); trạng thái liên kết
Google; nút "Đăng xuất mọi thiết bị" đi qua `delayed-action`; nút "Đăng xuất".

- [ ] **Step 3: Khung `app-shell.tsx`**

Thanh trên có tên tổ chức, tên gói, và menu tài khoản. Điều hướng bốn mục: Tổng quan, Khoá API,
Cài đặt, cộng liên kết ra tài liệu. **Ở khung hẹp dùng hamburger** với thẻ `<dialog>` — cùng khuôn
đã làm cho website ở pha 1, đừng dựng lại thanh cuộn ngang.

- [ ] **Step 4: Chạy và commit**

```bash
git add apps/console
git commit -m "$(cat <<'EOF'
feat(console): màn Khoá API, màn Cài đặt và khung điều hướng

Thu hồi khoá và đăng xuất mọi thiết bị đi qua delayed-action 5 giây. Khung hẹp dùng hamburger
bằng thẻ dialog, cùng khuôn với website ở pha 1.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Cổng `SELF_SERVE` và màn "Sắp mở"

**Files:**
- Create: `apps/console/src/features/sap-mo/page.tsx`
- Modify: `apps/console/src/routes.tsx`, `apps/console/src/lib/fetcher.ts`

- [ ] **Step 1: Hành vi**

`GET /v1/console/config` luôn trả được kể cả khi cổng đóng. SPA đọc `selfServe` từ đó; đóng thì
mọi route hiện màn "Sắp mở" với email, số điện thoại và liên kết tới website — **không** hiện form
đăng nhập rồi mới báo lỗi sau khi khách gõ xong email.

Nếu cổng đóng giữa chừng trong lúc khách đang dùng, mọi lời gọi trả 503 `self_serve_closed`, và
`error-vi.ts` dịch thành một câu rõ ràng.

- [ ] **Step 2: Test**

```tsx
it('cổng đóng → hiện màn Sắp mở, không hiện form đăng nhập', () => {});
it('cổng mở → hiện form đăng nhập bình thường', () => {});
it('lỗi self_serve_closed giữa chừng có câu tiếng Việt riêng', () => {});
```

- [ ] **Step 3: Commit**

```bash
git add apps/console
git commit -m "$(cat <<'EOF'
feat(console): màn "Sắp mở" khi cổng tự phục vụ còn đóng

Không hiện form đăng nhập rồi mới báo lỗi sau khi khách gõ xong email.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: e2e — một người lạ đi hết chặng trong một bài

**Files:**
- Create: `apps/console/playwright.config.ts`, `apps/console/e2e/console.spec.ts`
- Modify: `scripts/api-db-test.mjs` (harness phục vụ console và bật `OTP_DELIVERY=debug`)

- [ ] **Step 1: `playwright.config.ts`**

Dùng harness sẵn có `node scripts/api-db-test.mjs --serve` ở cổng 8799 như trang Admin, **không**
dựng máy chủ riêng. Harness phải:

- build console trước khi phục vụ (bài học: harness từng dùng bản build admin cũ);
- đặt `SELF_SERVE=1`, `OTP_DELIVERY=debug`, `SESSION_PEPPER` giá trị thử;
- **không** đặt `RESEND_API_KEY`, để bản ghi log được dùng.

- [ ] **Step 2: Bài chính, đi hết chặng**

```ts
test('người lạ đăng ký, lấy khoá, gọi API thật bằng khoá đó', async ({ page, request }) => {
  const email = `thu-${Date.now()}@vidu.vn`;

  await page.goto('/console/');
  await page.getByLabel('Email').fill(email);
  // Mã lấy từ header X-Debug-Otp của chính lời gọi xin mã — chỉ sống ngoài production.
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/otp/request')),
    page.getByRole('button', { name: /Gửi mã/ }).click(),
  ]);
  const ma = res.headers()['x-debug-otp'];
  expect(ma).toMatch(/^\d{6}$/);

  await page.getByLabel(/Chữ số thứ nhất/).fill(ma[0] as string);
  // … điền nốt sáu ô

  await expect(page).toHaveURL(/\/console\/bat-dau/);
  await page.getByLabel('Tên tổ chức').fill('Công ty Thử Nghiệm');
  await page.getByRole('button', { name: /Tạo và lấy khoá/ }).click();

  const khoa = await page.getByTestId('khoa-mot-lan').innerText();
  expect(khoa).toMatch(/^mlv_live_[0-9A-Za-z]{24}$/);

  // Lời hứa của cả pha: khoá vừa cấp gọi được API thật, không cần ai duyệt.
  const goi = await request.get('/v1/autocomplete?q=ca%20phe', { headers: { 'X-Api-Key': khoa } });
  expect(goi.status()).toBe(200);

  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();
  await expect(page.getByText('Dùng thử')).toBeVisible();
  await expect(page.getByText(/2\.000/)).toBeVisible();
});
```

- [ ] **Step 3: Sáu bài bảo vệ**

```ts
it('mã sai năm lần thì mã chết, lần thứ sáu gõ đúng vẫn không vào được', …);
it('chưa đăng nhập mà mở /console/khoa thì bị đưa về màn đăng nhập, giữ ?next=', …);
it('đăng xuất rồi thì gọi /v1/console/me trả 401', …);
it('tài khoản A không thấy khoá của tài khoản B', …);
it('thu hồi khoá rồi thì gọi API bằng khoá đó trả 401', …);
it('huỷ trong 5 giây khi thu hồi thì khoá vẫn dùng được', …);
```

Bài cuối chứng minh `delayed-action` vẫn đúng ở ứng dụng thứ hai, không chỉ ở trang Admin.

- [ ] **Step 4: Chạy**

Run: `pnpm test:console-e2e`
Expected: toàn bộ xanh. Thiếu trình duyệt thì
`pnpm --filter @mapslibvn/console exec playwright install chromium`.

- [ ] **Step 5: Commit**

```bash
git add apps/console/playwright.config.ts apps/console/e2e scripts/api-db-test.mjs
git commit -m "$(cat <<'EOF'
test(console): e2e đi hết chặng — đăng ký, lấy khoá, gọi /v1/autocomplete bằng chính khoá đó

Sáu bài bảo vệ kèm theo, trong đó có "tài khoản A không thấy khoá của B" và "huỷ trong 5 giây thì
khoá vẫn sống".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Bốn tầng cổng, tài liệu, chứng cứ và bàn giao

**Files:**
- Create: `docs/evidence/commerce/2026-09-18-pha-2-console.md`
- Modify: `docs/DEVLOG.md`, `apps/docs/src/content/docs/khoa-api.md`, `README.md`

- [ ] **Step 1: Sửa tài liệu cách xin khoá**

`khoa-api.md` hiện hướng dẫn xin khoá bằng email. Đổi thành tự đăng ký ở cổng khách hàng, giữ
đường email làm lối dự phòng. Thêm một câu về hạn mức 10 khoá và nhắc lại "cấp thêm khoá không cấp
thêm hạn mức".

- [ ] **Step 2: Bốn tầng cổng — chạy ĐÚNG lệnh CI chạy**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:api-db
pnpm test:admin-e2e
pnpm test:console-e2e
```

`pnpm typecheck` chứ không phải `turbo run typecheck`: lệnh gốc còn kiểm `scripts/**/*.mjs` bằng
`checkJs`, và bỏ bước đó là ở máy xanh mà CI đỏ — đã xảy ra ở pha 1.

- [ ] **Step 3: Ghi chứng cứ với số thật**

Gồm bảng cổng; kết quả bài e2e đi hết chặng; và **mục việc tay của PHONG**, theo thứ tự:

1. Tạo tài khoản Resend, thêm tên miền `ai-solutions.io.vn`, đặt bản ghi DKIM và SPF trên
   Cloudflare DNS, chờ trạng thái Verified.
2. Tạo OAuth client kiểu Web ở Google Cloud, thêm hai địa chỉ chuyển hướng: bản production và bản
   harness `http://127.0.0.1:8799/v1/console/auth/google/callback`.
3. Tạo widget Turnstile, lấy site key và secret.
4. Đặt bốn secret: `wrangler secret put RESEND_API_KEY --env production`, tương tự với
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET`, `SESSION_PEPPER`.
5. Điền `TURNSTILE_SITE_KEY` vào `[vars]` của `wrangler.toml` rồi deploy.
6. **Chạy migration `0020` trên máy chủ trước khi deploy Worker**, rồi đối chiếu `/healthz/db`
   thấy `schema_migration` đã sang `0020`. Deploy trước migration đã từng làm chết API.
7. Sau khi mọi thứ xanh, đổi `SELF_SERVE` thành `"1"` trong `[env.production]` và deploy lần nữa.
8. Tự đăng ký một tài khoản thật bằng email của mình để nghiệm thu đầu cuối.

- [ ] **Step 4: DEVLOG mục 20** theo khuôn mục 18 và 19: làm gì, lệch spec chỗ nào, bẫy nào đã
  vấp, cổng nào đã chạy.

- [ ] **Step 5: Commit và bàn giao**

Báo PHONG rõ ba điều: pha 2 **không tự bật** (`SELF_SERVE` vẫn `0`), việc chạy migration trên máy
chủ là việc tay và phải làm **trước** deploy, và cổng tự phục vụ chỉ mở sau khi PHONG đã đặt đủ
năm secret.

---

## Self-review

**Phủ spec:** mục 5.1 migration (Task 1) · 6.1 OTP (Task 4, 6) · 6.2 Google (Task 5, 6) · 6.3
phiên và CSRF (Task 3, 6) · 6.4 chống lạm dụng (Task 4, 6) · 7 tenant, trial, khoá, mức dùng
(Task 7, 8, 9) · 10 email (Task 2) · 12 bảy màn hình console (Task 11–16; màn Mua và Đơn hàng
thuộc pha 3 nên ở đây chỉ là hộp thoại nói thật) · 14 bảng API (Task 6, 7, 8, 9) · 15 bảo mật
(Task 3, 8, 10) · 16 cấu hình và việc tay (Task 6, 18) · 19 pha 2 kết thúc bằng "người lạ tự lấy
khoá" (Task 17).

**Lệch spec có chủ ý, phải ghi vào DEVLOG:**

1. Spec liệt kê chín màn hình console; pha này làm sáu. Ba màn còn lại (Mua gói, Đơn hàng, chi
   tiết đơn) phụ thuộc bảng `customer_order` của migration `0021`, tức là pha 3. Ba nút mua ở
   Tổng quan dẫn tới hộp thoại nói thật thay vì dẫn tới trang trống.
2. Khung hẹp của console dùng hamburger bằng thẻ `<dialog>` thay vì thanh cuộn ngang — bài học đo
   được ở pha 1.

**Không placeholder.** Chỗ nào là giao diện dài thì giao bằng danh sách thành phần bắt buộc và
danh sách bài test phải xanh, không phải mô tả mơ hồ. Mọi hàm được gọi ở task sau đều có chữ ký
khai ở task trước.

**Nhất quán kiểu và tên:** `EmailPort.send`/`ten` khai Task 2, dùng Task 6. `sinhTokenPhien`,
`bamToken`, `dungCookiePhien`, `docCookiePhien`, `nenGiaHan` khai Task 3, dùng Task 6.
`chuanHoaEmail`, `laEmailHopLe`, `sinhMa`, `maConDung`, `HAN_PHUT`, `SO_LAN_THU_TOI_DA` khai Task
4, dùng Task 6. `kiemTurnstile` khai Task 4, dùng Task 6. `sinhPkce`, `dungUrlDangNhap`,
`doiCodeLayToken`, `xacThucIdToken` khai Task 5, dùng Task 6. `issueKeyForTenant` và
`setKeyRevokedForTenant` khai Task 8, dùng Task 8 và 15. `requireCustomer` khai Task 3, dùng Task
7, 8, 9. `selfServeOpen` có từ pha 0, dùng Task 6 và 16.

**Rủi ro lớn nhất và chỗ chặn nó:** Task 8 đụng vào hai đường đang chạy production — chặn bằng
cách ghi mốc số test trước khi sửa và đòi con số không được giảm. Rủi ro thứ hai là sổ quota mồ
côi khi tạo tenant — chặn bằng thứ tự Postgres trước, sổ sau, cộng `operationId` cố định để gọi
lại được. Rủi ro thứ ba là thiếu `GRANT` chỉ lộ trên production — chặn bằng Task 10 chạy `SET ROLE
api` và kiểm cả cột **không** được cấp.
