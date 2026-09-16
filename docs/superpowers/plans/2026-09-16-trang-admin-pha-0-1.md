# Trang Admin MapsLibVN — Pha 0 (nền) và Pha 1 (Duyệt đóng góp)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay hoàn toàn trang `apps/admin` hiện tại bằng SPA có khung điều hướng mobile-first, dark/light mode, nhật ký kiểm toán, và màn Duyệt đóng góp đầy đủ kèm bản đồ so sánh vị trí cũ/mới.

**Architecture:** SPA tĩnh Vite + React 19 build ra `apps/admin/dist`, do chính Worker API phục vụ tại `/admin/` — cùng origin với `/v1/admin/*` nên chỉ cần một Cloudflare Access application. Giao diện chia theo mảng nghiệp vụ trong `src/features/*`; `DataView` vẽ thẻ dưới 1024px và bảng từ 1024px. Mọi hành động khó đảo ngược đi qua toast đếm ngược 5 giây (chưa gọi API cho tới khi hết giờ).

**Tech Stack:** React 19, Vite 8, TypeScript 6, Tailwind v4, Radix + component kiểu shadcn chép vào repo, TanStack Query v5, React Router v7, maplibre-gl (nạp trễ), Hono (API), PostGIS, vitest 5 + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-trang-admin-react-design.md`

---

## Ghi chú bắt buộc đọc trước khi bắt đầu

1. **`tsconfig.base.json` bật `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.** Nghĩa là `arr[0]` có kiểu `T | undefined`, và **không được** truyền `{ foo: undefined }` cho một prop khai báo `foo?: string` — phải bỏ hẳn key đó (`...(x ? { foo: x } : {})`).
2. **Không dùng shadcn CLI.** Nó tương tác và đổi theo phiên bản. Plan này cài Radix + CVA trực tiếp rồi chép mã component vào `src/components/ui/` — kết quả giống hệt shadcn (mã nằm trong repo, nền Radix), nhưng kiểm soát được.
3. **`apps/api/test` không được cần Postgres.** Test route ở tầng đó chỉ kiểm auth/validation; DB đóng nên nhánh chạm DB trả 503. Test SQL thật nằm ở `apps/api/test-db/*.itest.mjs`, chạy bằng `pnpm test:api-db`.
4. **`pnpm test:db` trên máy dev có thể đỏ ở `pipeline-fixture`** vì thiếu `tippecanoe` — đó là hiện tượng đã biết, không phải lỗi do plan này.
5. **Chạy lệnh `wrangler` từ `apps/api`**, vì wrangler đọc `.env` ở gốc repo.
6. Sau mỗi task: `pnpm lint` và `pnpm typecheck` phải xanh trước khi commit.

---

## Cấu trúc file sau khi xong plan này

**Tạo mới trong `apps/admin/src/`:**

| File | Trách nhiệm |
|---|---|
| `index.css` | `@import "tailwindcss"`, token màu `@theme`, biến thể `dark` |
| `lib/utils.ts` | `cn()` — gộp class |
| `lib/theme.ts` | Đọc/ghi lựa chọn sáng-tối, gắn class `dark` |
| `lib/fetcher.ts` | `apiFetch`, `AdminApiError`, xử lý 401 trả HTML |
| `lib/permissions.ts` | `can()` + `useMe()` |
| `components/ui/button.tsx` `badge.tsx` `card.tsx` `sheet.tsx` | Component nền kiểu shadcn |
| `components/states.tsx` | 5 trạng thái chuẩn |
| `components/data-view.tsx` | Thẻ ↔ bảng theo ngưỡng 1024px |
| `components/delayed-action.tsx` | Toast đếm ngược 5 giây |
| `layout/app-shell.tsx` `sidebar-nav.tsx` `drawer.tsx` `topbar.tsx` | Khung trang |
| `routes.tsx` | Khai báo route, lazy-load feature |
| `features/edits/api.ts` `hooks.ts` `page.tsx` `detail.tsx` `edit-map.tsx` `field-diff.tsx` | Mảng Duyệt đóng góp |

**Tạo mới trong `apps/api/`:**

| File | Trách nhiệm |
|---|---|
| `src/audit.ts` | `writeAudit()` thuần + `audit()` gắn context |
| `src/routes/admin.ts` (sửa) | `/me`, `/edits` phân trang, `/edits/:id`, `/edits/count`, `/edits/bulk` |
| `test/admin-me.test.ts` `admin-edits-params.test.ts` `audit.test.ts` | Test không DB |
| `test-db/admin-detail.itest.mjs` | Test SQL thật |

**Khác:** `db/migrations/0017_admin_audit.sql` + `.down.sql`, sửa `vitest.config.ts` gốc, mở rộng `apps/admin/e2e/admin.spec.ts`.

---

# PHA 0 — NỀN

## Task 1: Dựng Tailwind v4 và đường dẫn tắt `@/`

**Files:**
- Modify: `apps/admin/package.json`
- Create: `apps/admin/src/index.css`
- Modify: `apps/admin/vite.config.ts`
- Modify: `apps/admin/tsconfig.json`
- Modify: `vitest.config.ts` (gốc repo)

- [ ] **Step 1: Cài phụ thuộc**

```bash
cd /Users/dtphong/Desktop/software_business/mapsLibVN
pnpm --filter @mapslibvn/admin add -D tailwindcss @tailwindcss/vite
pnpm --filter @mapslibvn/admin add clsx tailwind-merge class-variance-authority
```

- [ ] **Step 2: Tạo `apps/admin/src/index.css`**

```css
@import "tailwindcss";

/* Tailwind v4 mặc định dark theo prefers-color-scheme. Trang này cho phép người dùng
   chọn tay, nên buộc biến thể `dark` bám vào class trên <html>. */
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  /* Xanh bản đồ — cùng màu style bản đồ đang dùng, xem packages/style */
  --color-brand-50: #eef3fb;
  --color-brand-100: #e8effa;
  --color-brand-500: #2f5da3;
  --color-brand-600: #24497f;
  --color-brand-700: #1b3a6b;
  --color-brand-800: #152c52;
  --color-brand-900: #0f1f3a;

  --radius-card: 12px;
  --radius-btn: 9px;
  --radius-sheet: 16px;
}

:root {
  --bg: #f7f8fa;
  --surface: #ffffff;
  --border: #e3e6ec;
  --text: #101828;
  --text-muted: #667085;
}

.dark {
  --bg: #0d1117;
  --surface: #161b22;
  --border: #2a313c;
  --text: #e6edf3;
  --text-muted: #9198a1;
}

body {
  background: var(--bg);
  color: var(--text);
  /* iPhone có tai thỏ: chừa chỗ an toàn ở mọi cạnh */
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
  margin: 0;
}
```

- [ ] **Step 3: Nối Tailwind và alias vào Vite**

Ghi đè `apps/admin/vite.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base /admin/ + outDir dist/admin: Worker assets directory = apps/admin/dist
// → URL /admin/ trỏ file dist/admin/index.html.
export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { outDir: 'dist/admin', emptyOutDir: true },
});
```

- [ ] **Step 4: Khai alias cho TypeScript**

Trong `apps/admin/tsconfig.json`, thêm `baseUrl` và `paths` vào `compilerOptions`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["react", "react-dom", "vite/client"],
    "noEmit": true,
    "allowJs": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "vite.config.ts", "e2e"]
}
```

- [ ] **Step 5: Cho vitest gốc thấy test của admin**

Trong `vitest.config.ts` ở gốc repo, thêm hai dòng vào mảng `include` (ngay sau dòng `'apps/docs/src/**/*.test.ts',`):

```ts
      'apps/docs/src/**/*.test.ts',
      'apps/admin/src/**/*.test.{ts,tsx}',
```

và thêm khối `resolve` để alias `@/` dùng được trong test:

```ts
export default defineConfig({
  resolve: {
    alias: { '@': new URL('./apps/admin/src', import.meta.url).pathname },
  },
  test: {
    clearMocks: false,
    // …include/exclude giữ nguyên
  },
});
```

**Không** đặt `environment: 'jsdom'` ở cấp `test`: bộ test gốc còn chạy `scripts/**/*.test.mjs` trong môi trường Node, đổi toàn cục sẽ làm chậm và có thể làm vỡ chúng. Thay vào đó **mỗi file test React phải mở đầu bằng một dòng docblock**:

```ts
// @vitest-environment jsdom
```

Dòng này phải là dòng đầu tiên của file, trước mọi `import`. Áp dụng cho toàn bộ file `.test.tsx` và cho `apps/admin/src/lib/theme.test.ts` (nó chạm `localStorage` và `document`).

- [ ] **Step 6: Nạp CSS vào ứng dụng**

Thêm dòng đầu tiên vào `apps/admin/src/main.tsx`:

```tsx
import './index.css';
```

- [ ] **Step 7: Kiểm tra build và lint**

```bash
pnpm --filter @mapslibvn/admin build
pnpm lint
pnpm typecheck
```

Kỳ vọng: cả ba xanh. Nếu Biome báo lỗi trên `index.css` vì các at-rule `@theme`/`@custom-variant`, thêm `"!**/apps/admin/src/index.css"` vào `files.includes` của `biome.json` và ghi chú lý do ngay trên dòng đó — giống cách repo đã xử lý at-rule lạ ở docs.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/package.json apps/admin/src/index.css apps/admin/vite.config.ts \
        apps/admin/tsconfig.json apps/admin/src/main.tsx vitest.config.ts pnpm-lock.yaml biome.json
git commit -m "feat(admin): dựng Tailwind v4, token màu xanh bản đồ và alias @/"
```

---

## Task 2: `cn()` và chuyển đổi sáng/tối

**Files:**
- Create: `apps/admin/src/lib/utils.ts`
- Create: `apps/admin/src/lib/theme.ts`
- Test: `apps/admin/src/lib/theme.test.ts`

- [ ] **Step 1: Viết test thất bại**

`apps/admin/src/lib/theme.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, readStoredTheme, resolveTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('chưa chọn gì → theo hệ điều hành', () => {
    expect(readStoredTheme()).toBe('system');
  });

  it('applyTheme("dark") gắn class dark và nhớ lựa chọn', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(readStoredTheme()).toBe('dark');
  });

  it('applyTheme("light") gỡ class dark', () => {
    applyTheme('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolveTheme("system") hỏi matchMedia', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/lib/theme.test.ts
```

Kỳ vọng: FAIL — `Failed to resolve import "./theme"`.

- [ ] **Step 3: Viết `apps/admin/src/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Viết `apps/admin/src/lib/theme.ts`**

```ts
export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'mapslibvn-admin-theme';

export function readStoredTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư) — coi như chưa chọn.
  }
  return 'system';
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}

export function applyTheme(choice: ThemeChoice): void {
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', resolveTheme(choice, prefersDark) === 'dark');
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Không ghi nhớ được thì vẫn đổi giao diện cho phiên này.
  }
}
```

- [ ] **Step 5: Chạy test để xác nhận xanh**

```bash
pnpm exec vitest run apps/admin/src/lib/theme.test.ts
```

Kỳ vọng: PASS, 4 test.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/lib/utils.ts apps/admin/src/lib/theme.ts apps/admin/src/lib/theme.test.ts
git commit -m "feat(admin): cn() và chuyển đổi sáng/tối có ghi nhớ lựa chọn"
```

---

## Task 3: `fetcher.ts` — gọi API và xử lý phiên hết hạn

**Files:**
- Create: `apps/admin/src/lib/fetcher.ts`
- Test: `apps/admin/src/lib/fetcher.test.ts`

Bối cảnh: khi JWT Access hết hạn giữa phiên, request trả **401 kèm trang HTML đăng nhập**, không phải JSON. Trang phải tải lại để Access đưa về màn đăng nhập, trừ khi đang có hành động chờ gửi.

- [ ] **Step 1: Viết test thất bại**

`apps/admin/src/lib/fetcher.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError, apiFetch, setReloadGuard } from './fetcher';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.restoreAllMocks();
  setReloadGuard(() => false);
});

describe('apiFetch', () => {
  it('trả về thân JSON khi thành công', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [1] })));
    await expect(apiFetch<{ items: number[] }>('/v1/admin/edits')).resolves.toEqual({ items: [1] });
  });

  it('lỗi JSON → AdminApiError mang đúng mã và status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'not_found', message: 'Không có' } }, 404)),
    );
    await expect(apiFetch('/v1/admin/edits/9')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
    await expect(apiFetch('/v1/admin/edits/9')).rejects.toBeInstanceOf(AdminApiError);
  });

  it('401 trả HTML (trang đăng nhập Access) → tải lại trang', async () => {
    const reload = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>đăng nhập</html>', {
          status: 401,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    await expect(apiFetch('/v1/admin/edits', {}, reload)).rejects.toMatchObject({ status: 401 });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('đang có việc chờ gửi thì KHÔNG tải lại, tránh mất việc', async () => {
    const reload = vi.fn();
    setReloadGuard(() => true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html/>', { status: 401, headers: { 'content-type': 'text/html' } }),
      ),
    );
    await expect(apiFetch('/v1/admin/edits', {}, reload)).rejects.toMatchObject({ status: 401 });
    expect(reload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/lib/fetcher.test.ts
```

Kỳ vọng: FAIL — không resolve được `./fetcher`.

- [ ] **Step 3: Viết `apps/admin/src/lib/fetcher.ts`**

```ts
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/**
 * Cho phép phần khác của ứng dụng chặn việc tự tải lại trang. `delayed-action` bật cờ này trong
 * lúc đếm ngược: tải lại giữa chừng sẽ nuốt mất một thao tác người dùng tưởng đã làm.
 */
let hasPendingWork: () => boolean = () => false;
export function setReloadGuard(guard: () => boolean): void {
  hasPendingWork = guard;
}

/**
 * Cùng origin với Worker nên dùng đường dẫn tương đối — Access đã đứng trước cả /admin và
 * /v1/admin. Không gửi kèm khoá API: route admin xác thực bằng JWT do Access chèn.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  reload: () => void = () => location.reload(),
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  });

  if (response.ok) return (await response.json()) as T;

  const contentType = response.headers.get('content-type') ?? '';
  // Phiên Access hết hạn: origin trả trang đăng nhập HTML thay vì JSON.
  if (response.status === 401 && !contentType.includes('application/json')) {
    if (!hasPendingWork()) reload();
    throw new AdminApiError(401, 'session_expired', 'Phiên đăng nhập đã hết hạn');
  }

  let code = `http_${response.status}`;
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    // Thân lỗi không phải JSON — giữ thông điệp mặc định.
  }
  throw new AdminApiError(response.status, code, message);
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm exec vitest run apps/admin/src/lib/fetcher.test.ts
```

Kỳ vọng: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/fetcher.ts apps/admin/src/lib/fetcher.test.ts
git commit -m "feat(admin): fetcher xử lý phiên Access hết hạn, không nuốt việc đang chờ"
```

---

## Task 4: Migration `0017` — bảng `admin_audit`

**Files:**
- Create: `db/migrations/0017_admin_audit.sql`
- Create: `db/migrations/0017_admin_audit.down.sql`

- [ ] **Step 1: Viết `db/migrations/0017_admin_audit.sql`**

```sql
-- Nhật ký kiểm toán cho trang Admin: ai làm gì, lúc nào. `actor` là email do Cloudflare Access
-- xác thực, nên không phụ thuộc việc hệ thống đã có phân quyền hay chưa.
CREATE TABLE IF NOT EXISTS admin_audit (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,
  target     text,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor_idx   ON admin_audit (actor, created_at DESC);

-- GRANT theo đúng nhu cầu, không cấp cả bảng. Migration 0016 tồn tại chính vì 0005 quên một dòng
-- GRANT UPDATE trên api_key: route thu hồi khoá rơi vào catch chung và trả upstream_unavailable
-- trên production, còn test thì xanh vì nối DB bằng role chủ sở hữu.
GRANT SELECT, INSERT ON admin_audit TO api;
GRANT USAGE, SELECT ON SEQUENCE admin_audit_id_seq TO api;
```

- [ ] **Step 2: Viết `db/migrations/0017_admin_audit.down.sql`**

```sql
DROP TABLE IF EXISTS admin_audit;
```

- [ ] **Step 3: Áp dụng lên DB dev và kiểm tra**

```bash
pnpm db:up
pnpm db:migrate
```

Kỳ vọng: log có dòng áp dụng `0017_admin_audit.sql`.

- [ ] **Step 4: Xác nhận bảng và quyền tồn tại**

```bash
docker compose --env-file .env -f infra/dev/compose.yml exec -T postgres \
  psql -U mapslibvn -d mapslibvn -c "\dp admin_audit"
```

Kỳ vọng: dòng `admin_audit` xuất hiện, cột `Access privileges` chứa `api=ar/` (a = INSERT, r = SELECT).

- [ ] **Step 5: Kiểm tra revert chạy được rồi áp lại**

```bash
pnpm db:migrate --down
pnpm db:migrate
```

Kỳ vọng: revert xong không lỗi, áp lại xong không lỗi.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0017_admin_audit.sql db/migrations/0017_admin_audit.down.sql
git commit -m "feat(db): bảng admin_audit cho nhật ký kiểm toán trang Admin"
```

---

## Task 5: `audit.ts` — ghi nhật ký ở tầng API

**Files:**
- Create: `apps/api/src/audit.ts`
- Test: `apps/api/test/audit.test.ts`

Thiết kế: tách `writeAudit(sql, entry)` **thuần** để test được bằng `fakeSql` mà không cần Postgres, còn `audit(c, …)` chỉ lo lấy email và đẩy vào `waitUntil`.

- [ ] **Step 1: Viết test thất bại**

`apps/api/test/audit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { writeAudit } from '../src/audit';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

describe('writeAudit', () => {
  it('chèn đúng actor, action, target và detail', async () => {
    const calls: RecordedQuery[] = [];
    const sql = fakeSql([], calls) as unknown as Parameters<typeof writeAudit>[0];
    await writeAudit(sql, {
      actor: 'phong@test.local',
      action: 'edit.approve',
      target: '42',
      detail: { poi_id: 'poi_1' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('INSERT INTO admin_audit');
    expect(calls[0]?.params.slice(0, 3)).toEqual(['phong@test.local', 'edit.approve', '42']);
  });

  it('không có target/detail vẫn ghi được', async () => {
    const calls: RecordedQuery[] = [];
    const sql = fakeSql([], calls) as unknown as Parameters<typeof writeAudit>[0];
    await writeAudit(sql, { actor: 'a@b.c', action: 'edits.list' });
    expect(calls[0]?.params[2]).toBeNull();
  });

  it('lỗi ghi nhật ký được nuốt, không ném ra ngoài', async () => {
    const sql = (() => {
      throw new Error('DB chết');
    }) as unknown as Parameters<typeof writeAudit>[0];
    await expect(writeAudit(sql, { actor: 'a@b.c', action: 'x' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/audit.test.ts
```

Kỳ vọng: FAIL — không tìm thấy `../src/audit`.

- [ ] **Step 3: Viết `apps/api/src/audit.ts`**

```ts
import type { Context } from 'hono';
import { endSql, getSql } from './db';
import type { AppEnv } from './env';

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  detail?: Record<string, unknown>;
}

type Sql = ReturnType<typeof getSql>;

/**
 * Ghi một dòng nhật ký. Lỗi ở đây KHÔNG được làm hỏng thao tác chính: nhật ký là bằng chứng,
 * không phải điều kiện. Ném ra ngoài sẽ biến một lần duyệt đã thành công thành 503 cho người dùng.
 */
export async function writeAudit(sql: Sql, entry: AuditEntry): Promise<void> {
  try {
    await sql`INSERT INTO admin_audit (actor, action, target, detail)
      VALUES (${entry.actor}, ${entry.action}, ${entry.target ?? null},
              ${entry.detail ? JSON.stringify(entry.detail) : null}::jsonb)`;
  } catch (error) {
    console.error('admin_audit', error);
  }
}

/**
 * Ghi nhật ký cho một request đang xử lý. Chạy trong `waitUntil` nên không cộng độ trễ vào phản
 * hồi; mở client riêng vì client của nhánh chính có thể đã bị `endSql` đóng trước khi tới đây.
 */
export function audit(
  c: Context<AppEnv>,
  action: string,
  target?: string,
  detail?: Record<string, unknown>,
): void {
  const actor = c.get('reviewer') ?? '';
  if (!actor) return;
  const sql = getSql(c.env);
  c.executionCtx.waitUntil(
    writeAudit(sql, {
      actor,
      action,
      ...(target === undefined ? {} : { target }),
      ...(detail === undefined ? {} : { detail }),
    }).finally(() => {
      endSql(c.executionCtx, sql);
    }),
  );
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/audit.test.ts
```

Kỳ vọng: PASS, 3 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit.ts apps/api/test/audit.test.ts
git commit -m "feat(api): ghi nhật ký kiểm toán, lỗi nhật ký không làm hỏng thao tác"
```

---

## Task 6: `GET /v1/admin/me` và `can()` phía giao diện

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/test/admin-me.test.ts`
- Create: `apps/admin/src/lib/permissions.ts`
- Test: `apps/admin/src/lib/permissions.test.ts`

- [ ] **Step 1: Viết test API thất bại**

`apps/api/test/admin-me.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /v1/admin/me', () => {
  it('thiếu JWT Access → 401 missing_access_jwt', async () => {
    const response = await SELF.fetch('https://api/v1/admin/me');
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('missing_access_jwt');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-me.test.ts
```

Kỳ vọng: FAIL — hiện `/v1/admin/me` chưa tồn tại nên rơi vào `notFound` và trả 404 thay vì 401.

- [ ] **Step 3: Thêm route vào `apps/api/src/routes/admin.ts`**

Chèn ngay sau dòng `admin.use('/v1/admin/*', requireAccess());`:

```ts
/**
 * Danh sách quyền để giao diện biết vẽ những mục nào. Giai đoạn này hệ thống chưa phân quyền
 * (một người quản lý), nên ai qua được Access đều nhận đủ quyền. Hợp đồng đã có sẵn chỗ để thêm
 * vai trò sau mà không phải đổi giao diện — xem mục 9 của spec.
 */
const ALL_PERMISSIONS = [
  'edits.read',
  'edits.write',
  'tenants.read',
  'tenants.write',
  'billing.read',
  'billing.write',
  'health.read',
  'audit.read',
] as const;

admin.get('/v1/admin/me', (c) =>
  c.json(
    { email: c.get('reviewer') ?? '', permissions: [...ALL_PERMISSIONS] },
    200,
    { 'cache-control': 'private, no-store' },
  ),
);
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-me.test.ts
```

Kỳ vọng: PASS.

- [ ] **Step 5: Viết test `permissions` thất bại**

`apps/admin/src/lib/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { can } from './permissions';

describe('can', () => {
  it('có quyền trong danh sách → true', () => {
    expect(can({ email: 'a@b.c', permissions: ['edits.write'] }, 'edits.write')).toBe(true);
  });

  it('không có quyền → false', () => {
    expect(can({ email: 'a@b.c', permissions: ['edits.read'] }, 'billing.write')).toBe(false);
  });

  it('chưa tải xong thông tin người dùng → false, không đoán bừa', () => {
    expect(can(undefined, 'edits.write')).toBe(false);
  });
});
```

- [ ] **Step 6: Viết `apps/admin/src/lib/permissions.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetcher';

export type Permission =
  | 'edits.read'
  | 'edits.write'
  | 'tenants.read'
  | 'tenants.write'
  | 'billing.read'
  | 'billing.write'
  | 'health.read'
  | 'audit.read';

export interface Me {
  email: string;
  permissions: string[];
}

/**
 * Giai đoạn này máy chủ trả đủ quyền cho mọi người qua được Access, nên hàm này luôn đúng. Các
 * màn hình vẫn gọi nó ngay từ đầu: ngày thêm phân quyền chỉ phải đổi phía máy chủ, không phải đi
 * sửa rải rác từng màn hình để tìm chỗ cần chặn.
 *
 * Giao diện chỉ ẩn cho gọn mắt — API mới là nơi chặn thật.
 */
export function can(me: Me | undefined, permission: Permission): boolean {
  return me?.permissions.includes(permission) ?? false;
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<Me>('/v1/admin/me'),
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 7: Cài TanStack Query rồi chạy test**

```bash
pnpm --filter @mapslibvn/admin add @tanstack/react-query
pnpm exec vitest run apps/admin/src/lib/permissions.test.ts
```

Kỳ vọng: PASS, 3 test.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/test/admin-me.test.ts \
        apps/admin/src/lib/permissions.ts apps/admin/src/lib/permissions.test.ts \
        apps/admin/package.json pnpm-lock.yaml
git commit -m "feat(admin): GET /v1/admin/me và can() — điểm móc cho phân quyền sau này"
```

---

## Task 7: Component nền kiểu shadcn

**Files:**
- Create: `apps/admin/src/components/ui/button.tsx`
- Create: `apps/admin/src/components/ui/badge.tsx`
- Create: `apps/admin/src/components/ui/card.tsx`
- Test: `apps/admin/src/components/ui/button.test.tsx`

- [ ] **Step 1: Cài Radix và Testing Library cho admin**

```bash
pnpm --filter @mapslibvn/admin add @radix-ui/react-dialog
pnpm --filter @mapslibvn/admin add -D @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 2: Viết test thất bại**

`apps/admin/src/components/ui/button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('hiện nhãn và gọi onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Duyệt</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('vùng chạm tối thiểu 44px — lớp min-h-11 luôn có mặt', () => {
    render(<Button>Duyệt</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-11');
  });

  it('disabled thì không gọi onClick', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Duyệt
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/components/ui/button.test.tsx
```

Kỳ vọng: FAIL — không resolve được `./button`.

- [ ] **Step 4: Viết `apps/admin/src/components/ui/button.tsx`**

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// min-h-11 = 44px: ngưỡng vùng chạm tối thiểu trên điện thoại, áp cho mọi biến thể.
const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-btn)] px-4 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
  {
    variants: {
      variant: {
        primary: 'bg-brand-700 text-white hover:bg-brand-800',
        secondary:
          'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-brand-50 dark:hover:bg-brand-900',
        ghost: 'text-[var(--text-muted)] hover:bg-brand-50 dark:hover:bg-brand-900',
        danger: 'bg-red-600 text-white hover:bg-red-700',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, block, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, block }), className)}
      {...props}
    />
  );
}
```

- [ ] **Step 5: Viết `apps/admin/src/components/ui/badge.tsx`**

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
  {
    variants: {
      tone: {
        brand: 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-100',
        neutral: 'bg-black/5 text-[var(--text-muted)] dark:bg-white/10',
        success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
        warning: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
        danger: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
```

- [ ] **Step 6: Viết `apps/admin/src/components/ui/card.tsx`**

```tsx
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold', className)} {...props} />;
}

export function CardMuted({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-[var(--text-muted)]', className)} {...props} />;
}
```

- [ ] **Step 7: Chạy test để xác nhận xanh**

```bash
pnpm exec vitest run apps/admin/src/components/ui/button.test.tsx
```

Kỳ vọng: PASS, 3 test.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/components/ui apps/admin/package.json pnpm-lock.yaml
git commit -m "feat(admin): component nền kiểu shadcn — Button, Badge, Card"
```

---

## Task 8: Ngăn kéo điều hướng (☰)

**Files:**
- Create: `apps/admin/src/layout/drawer.tsx`
- Test: `apps/admin/src/layout/drawer.test.tsx`

Dùng `@radix-ui/react-dialog` làm nền: nó lo sẵn giam tiêu điểm, Esc, khoá cuộn nền và trả tiêu điểm về nút mở — bốn thứ dễ làm ẩu nhất nếu tự viết.

- [ ] **Step 1: Viết test thất bại**

`apps/admin/src/layout/drawer.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Drawer } from './drawer';

const setup = () =>
  render(
    <Drawer title="Điều hướng">
      <a href="/admin/edits">Duyệt đóng góp</a>
    </Drawer>,
  );

describe('Drawer', () => {
  it('đóng mặc định — nội dung không có trong cây', () => {
    setup();
    expect(screen.queryByText('Duyệt đóng góp')).not.toBeInTheDocument();
  });

  it('bấm ☰ thì mở', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Mở menu điều hướng' }));
    expect(await screen.findByText('Duyệt đóng góp')).toBeVisible();
  });

  it('Esc thì đóng và trả tiêu điểm về nút ☰', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Mở menu điều hướng' });
    await userEvent.click(trigger);
    await screen.findByText('Duyệt đóng góp');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Duyệt đóng góp')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
```

Thêm `apps/admin/src/test-setup.ts`:

```ts
// setupFiles áp cho MỌI file test của bộ gốc, kể cả scripts/**/*.test.mjs chạy trong Node.
// jest-dom cần `document`, nên chỉ nạp khi thật sự đang ở môi trường jsdom.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}
```

và khai báo nó trong `vitest.config.ts` gốc, trong khối `test`:

```ts
    setupFiles: ['./apps/admin/src/test-setup.ts'],
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/layout/drawer.test.tsx
```

Kỳ vọng: FAIL — không resolve được `./drawer`.

- [ ] **Step 3: Viết `apps/admin/src/layout/drawer.tsx`**

```tsx
import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

interface DrawerProps {
  title: string;
  children: ReactNode;
}

/**
 * Ngăn kéo cho màn hình hẹp. Radix Dialog lo giam tiêu điểm, Esc, khoá cuộn nền và trả tiêu điểm
 * về nút mở. Trượt bằng `transform` chứ không animate `width`: animate width buộc trình duyệt
 * tính lại bố cục mỗi khung hình và giật trên máy yếu.
 */
export function Drawer({ title, children }: DrawerProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        aria-label="Mở menu điều hướng"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-btn)] text-white lg:hidden"
      >
        <span aria-hidden="true" className="flex flex-col gap-1">
          <span className="block h-0.5 w-4 rounded bg-current" />
          <span className="block h-0.5 w-4 rounded bg-current" />
          <span className="block h-0.5 w-4 rounded bg-current" />
        </span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content
          className="fixed inset-y-0 left-0 z-50 w-72 max-w-[82vw] overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl"
          aria-label={title}
        >
          <Dialog.Title className="px-2 pb-3 pt-1 text-base font-bold">Admin Page</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm exec vitest run apps/admin/src/layout/drawer.test.tsx
```

Kỳ vọng: PASS, 3 test.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/layout/drawer.tsx apps/admin/src/layout/drawer.test.tsx \
        apps/admin/src/test-setup.ts vitest.config.ts
git commit -m "feat(admin): ngăn kéo điều hướng giam tiêu điểm, Esc đóng, trả tiêu điểm"
```

---

## Task 9: Năm trạng thái chuẩn

**Files:**
- Create: `apps/admin/src/components/states.tsx`
- Test: `apps/admin/src/components/states.test.tsx`

- [ ] **Step 1: Viết test thất bại**

`apps/admin/src/components/states.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '@/lib/fetcher';
import { EmptyState, ErrorState, LoadingSkeleton } from './states';

describe('states', () => {
  it('LoadingSkeleton dựng đúng số khối xương và báo cho trình đọc màn hình', () => {
    const { container } = render(<LoadingSkeleton rows={3} />);
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveAccessibleName('Đang tải');
  });

  it('EmptyState nêu lý do chứ không chỉ nói "không có dữ liệu"', () => {
    render(<EmptyState title="Không có đóng góp chờ duyệt" hint="Mọi đóng góp đã được xử lý." />);
    expect(screen.getByText('Không có đóng góp chờ duyệt')).toBeVisible();
    expect(screen.getByText('Mọi đóng góp đã được xử lý.')).toBeVisible();
  });

  it('ErrorState hiện mã lỗi thật của API và nút Thử lại gọi onRetry', async () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new AdminApiError(503, 'upstream_unavailable', 'DB chết')} onRetry={onRetry} />);
    expect(screen.getByText(/upstream_unavailable/)).toBeVisible();
    screen.getByRole('button', { name: 'Thử lại' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('ErrorState với 403 nói rõ bị chặn vì quyền', () => {
    render(<ErrorState error={new AdminApiError(403, 'billing_admin_forbidden', 'Không có quyền')} />);
    expect(screen.getByText(/không có quyền/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/components/states.test.tsx
```

Kỳ vọng: FAIL — không resolve được `./states`.

- [ ] **Step 3: Viết `apps/admin/src/components/states.tsx`**

```tsx
import { AdminApiError } from '@/lib/fetcher';
import { Button } from './ui/button';

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Đang tải" className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          data-skeleton-row
          className="h-24 animate-pulse rounded-[var(--radius-card)] border border-[var(--border)] bg-black/5 dark:bg-white/5"
        />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof AdminApiError ? error : null;
  const forbidden = api?.status === 403;
  return (
    <div className="rounded-[var(--radius-card)] border border-red-300 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950">
      <p className="font-semibold text-red-800 dark:text-red-100">
        {forbidden ? 'Tài khoản này không có quyền xem mục đó' : 'Không tải được dữ liệu'}
      </p>
      <p className="mt-1 text-sm text-red-700 dark:text-red-200">
        {api ? `${api.code} — ${api.message}` : String(error)}
      </p>
      {onRetry && !forbidden && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

export function OfflineBanner() {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-btn)] bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100"
    >
      Mất kết nối mạng. Dữ liệu hiển thị có thể đã cũ.
    </div>
  );
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm exec vitest run apps/admin/src/components/states.test.tsx
```

Kỳ vọng: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/states.tsx apps/admin/src/components/states.test.tsx
git commit -m "feat(admin): năm trạng thái chuẩn — tải, rỗng, lỗi, thiếu quyền, mất mạng"
```

---

## Task 10: `DataView` — thẻ dưới 1024px, bảng từ 1024px

**Files:**
- Create: `apps/admin/src/components/data-view.tsx`
- Test: `apps/admin/src/components/data-view.test.tsx`

- [ ] **Step 1: Viết test thất bại**

`apps/admin/src/components/data-view.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataView } from './data-view';

interface Row {
  id: number;
  ten: string;
}
const items: Row[] = [
  { id: 1, ten: 'Cà phê Chiều Thứ Bảy' },
  { id: 2, ten: 'Tạp hoá Bà Tư' },
];

/** matchMedia không tồn tại trong jsdom — dựng bản giả trả đúng kết quả ta cần. */
const stubWidth = (wide: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: wide,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
};

const view = () =>
  render(
    <DataView
      items={items}
      rowKey={(row) => String(row.id)}
      columns={[{ key: 'ten', header: 'Tên', render: (row) => row.ten }]}
      renderCard={(row) => <article data-card>{row.ten}</article>}
    />,
  );

afterEach(() => vi.unstubAllGlobals());

describe('DataView', () => {
  it('dưới 1024px dựng thẻ, không dựng bảng', () => {
    stubWidth(false);
    const { container } = view();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(2);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('từ 1024px dựng bảng có tiêu đề cột, không dựng thẻ', () => {
    stubWidth(true);
    const { container } = view();
    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Tên' })).toBeVisible();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(0);
  });

  it('hỏi đúng ngưỡng 1024px', () => {
    stubWidth(true);
    view();
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/components/data-view.test.tsx
```

Kỳ vọng: FAIL — không resolve được `./data-view`.

- [ ] **Step 3: Viết `apps/admin/src/components/data-view.tsx`**

```tsx
import { type ReactNode, useEffect, useState } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  className?: string;
}

interface DataViewProps<T> {
  items: T[];
  columns: Column<T>[];
  renderCard: (item: T) => ReactNode;
  rowKey: (item: T) => string;
}

const WIDE = '(min-width: 1024px)';

/**
 * Một ngưỡng duy nhất cho cả trang, đo theo khung nhìn chứ không theo container: hành vi đoán
 * được, và không phải nghĩ xem mỗi màn hình đang rộng bao nhiêu.
 */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia(WIDE).matches : false,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(WIDE);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
}

export function DataView<T>({ items, columns, renderCard, rowKey }: DataViewProps<T>) {
  const wide = useIsWide();

  if (!wide) {
    return (
      <div className="space-y-3">
        {items.map((item) => (
          <div key={rowKey(item)}>{renderCard(item)}</div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-black/[0.03] dark:bg-white/[0.04]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={rowKey(item)} className="border-t border-[var(--border)]">
              {columns.map((column) => (
                <td key={column.key} className={column.className ?? 'px-3 py-2 align-top'}>
                  {column.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm exec vitest run apps/admin/src/components/data-view.test.tsx
```

Kỳ vọng: PASS, 3 test.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/data-view.tsx apps/admin/src/components/data-view.test.tsx
git commit -m "feat(admin): DataView đổi thẻ sang bảng ở ngưỡng 1024px"
```

---

## Task 11: `delayed-action` — toast đếm ngược 5 giây

**Files:**
- Create: `apps/admin/src/components/delayed-action.tsx`
- Test: `apps/admin/src/components/delayed-action.test.tsx`

Đây là bài quan trọng nhất của plan. `apply_poi_edit` ghi thẳng vào bảng POI và xoá cache, nên không có "hoàn tác" thật. Thay vào đó: bấm Duyệt → giao diện cập nhật ngay nhưng **chưa gửi gì**; bấm Huỷ trong 5 giây là thôi hẳn, không request nào rời trình duyệt.

- [ ] **Step 1: Viết test thất bại**

`apps/admin/src/components/delayed-action.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedActionProvider, useDelayedAction } from './delayed-action';

function Harness({ run }: { run: () => Promise<void> }) {
  const { schedule } = useDelayedAction();
  return (
    <button type="button" onClick={() => schedule({ label: 'Đã duyệt #1', run })}>
      Duyệt
    </button>
  );
}

const setup = (run: () => Promise<void>) =>
  render(
    <DelayedActionProvider>
      <Harness run={run} />
    </DelayedActionProvider>,
  );

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('delayed-action', () => {
  it('huỷ trong 5 giây → KHÔNG gọi API lần nào', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(run);

    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(run).not.toHaveBeenCalled();
  });

  it('để hết 5 giây → gọi đúng một lần', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(run);

    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(run).toHaveBeenCalledOnce();
  });

  it('toast hiện nhãn và số giây còn lại', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(vi.fn().mockResolvedValue(undefined));

    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect(screen.getByText(/Đã duyệt #1/)).toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/3 giây/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/components/delayed-action.test.tsx
```

Kỳ vọng: FAIL — không resolve được `./delayed-action`.

- [ ] **Step 3: Viết `apps/admin/src/components/delayed-action.tsx`**

```tsx
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { setReloadGuard } from '@/lib/fetcher';
import { Button } from './ui/button';

const DELAY_MS = 5000;

interface ScheduleInput {
  label: string;
  run: () => Promise<void>;
  onCancel?: () => void;
}

interface Pending extends ScheduleInput {
  id: number;
  remaining: number;
}

interface DelayedActionValue {
  schedule: (input: ScheduleInput) => void;
}

const Context = createContext<DelayedActionValue | null>(null);

export function useDelayedAction(): DelayedActionValue {
  const value = useContext(Context);
  if (!value) throw new Error('useDelayedAction phải nằm trong DelayedActionProvider');
  return value;
}

/**
 * Hoãn gửi 5 giây thay vì hoàn tác sau khi đã gửi. Với những thao tác ghi thẳng vào dữ liệu thật
 * — duyệt đóng góp gọi apply_poi_edit rồi xoá cache — đảo ngược sạch sẽ là không làm được, nên
 * cách an toàn là chưa làm gì cho tới khi người dùng hết cơ hội đổi ý.
 */
export function DelayedActionProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const nextId = useRef(0);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  // Chặn fetcher tự tải lại trang khi phiên hết hạn giữa lúc đang đếm ngược: tải lại sẽ nuốt mất
  // một thao tác mà người dùng tưởng đã làm xong.
  useEffect(() => {
    setReloadGuard(() => pendingRef.current !== null);
    return () => setReloadGuard(() => false);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      setPending((current) => {
        if (!current) return null;
        const remaining = current.remaining - 1000;
        if (remaining > 0) return { ...current, remaining };
        void current.run();
        return null;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pending?.id]);

  const schedule = useCallback((input: ScheduleInput) => {
    setPending((current) => {
      // Xếp việc mới khi việc cũ chưa gửi: gửi luôn việc cũ, không bỏ rơi nó.
      if (current) void current.run();
      nextId.current += 1;
      return { ...input, id: nextId.current, remaining: DELAY_MS };
    });
  }, []);

  const cancel = useCallback(() => {
    setPending((current) => {
      current?.onCancel?.();
      return null;
    });
  }, []);

  const value = useMemo(() => ({ schedule }), [schedule]);

  return (
    <Context.Provider value={value}>
      {children}
      {pending && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-[var(--radius-btn)] bg-[var(--text)] px-4 py-3 text-sm text-[var(--bg)] shadow-lg"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <span className="flex-1">
            {pending.label} · gửi sau {Math.ceil(pending.remaining / 1000)} giây
          </span>
          <Button variant="ghost" className="text-[var(--bg)] underline" onClick={cancel}>
            Huỷ
          </Button>
        </div>
      )}
    </Context.Provider>
  );
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm exec vitest run apps/admin/src/components/delayed-action.test.tsx
```

Kỳ vọng: PASS, 3 test. Bài đầu tiên là bài phải luôn xanh — nó chứng minh huỷ trong 5 giây không gọi API lần nào.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/delayed-action.tsx apps/admin/src/components/delayed-action.test.tsx
git commit -m "feat(admin): hoãn gửi 5 giây kèm nút Huỷ thay cho hoàn tác sau khi đã ghi"
```

---

## Task 12: AppShell, sidebar và router

**Files:**
- Create: `apps/admin/src/layout/sidebar-nav.tsx`
- Create: `apps/admin/src/layout/topbar.tsx`
- Create: `apps/admin/src/layout/app-shell.tsx`
- Create: `apps/admin/src/routes.tsx`
- Modify: `apps/admin/src/main.tsx`
- Modify: `apps/admin/index.html`
- Test: `apps/admin/src/layout/sidebar-nav.test.tsx`

- [ ] **Step 1: Cài React Router**

```bash
pnpm --filter @mapslibvn/admin add react-router
```

- [ ] **Step 2: Viết test thất bại**

`apps/admin/src/layout/sidebar-nav.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Me } from '@/lib/permissions';
import { SidebarNav } from './sidebar-nav';

const renderNav = (me: Me | undefined, pendingCount?: number) =>
  render(
    <MemoryRouter>
      <SidebarNav me={me} {...(pendingCount === undefined ? {} : { pendingCount })} />
    </MemoryRouter>,
  );

const FULL: Me = {
  email: 'phong@test.local',
  permissions: ['edits.read', 'tenants.read', 'billing.read', 'health.read', 'audit.read'],
};

describe('SidebarNav', () => {
  it('đủ quyền → hiện cả ba nhóm', () => {
    renderNav(FULL);
    expect(screen.getByText('Nội dung')).toBeVisible();
    expect(screen.getByText('Khách hàng')).toBeVisible();
    expect(screen.getByText('Vận hành')).toBeVisible();
  });

  it('thiếu quyền billing → không render mục Gói cước', () => {
    renderNav({ email: 'a@b.c', permissions: ['edits.read'] });
    expect(screen.queryByRole('link', { name: /Gói cước/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Duyệt đóng góp/ })).toBeVisible();
  });

  it('huy hiệu số việc chờ bám vào mục Duyệt đóng góp', () => {
    renderNav(FULL, 12);
    expect(screen.getByRole('link', { name: /Duyệt đóng góp/ })).toHaveTextContent('12');
  });

  it('chưa biết người dùng là ai → không đoán, không hiện mục nào', () => {
    renderNav(undefined);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/layout/sidebar-nav.test.tsx
```

Kỳ vọng: FAIL — không resolve được `./sidebar-nav`.

- [ ] **Step 4: Viết `apps/admin/src/layout/sidebar-nav.tsx`**

```tsx
import { NavLink } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { can, type Me, type Permission } from '@/lib/permissions';

interface NavItem {
  to: string;
  label: string;
  permission: Permission;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Nội dung',
    items: [
      { to: '/', label: 'Tổng quan', permission: 'edits.read' },
      { to: '/edits', label: 'Duyệt đóng góp', permission: 'edits.read' },
    ],
  },
  {
    title: 'Khách hàng',
    items: [
      { to: '/tenants', label: 'Tenant & khoá API', permission: 'tenants.read' },
      { to: '/billing', label: 'Gói cước & hạn mức', permission: 'billing.read' },
    ],
  },
  {
    title: 'Vận hành',
    items: [
      { to: '/health', label: 'Sức khoẻ hệ thống', permission: 'health.read' },
      { to: '/audit', label: 'Nhật ký kiểm toán', permission: 'audit.read' },
    ],
  },
];

interface SidebarNavProps {
  me: Me | undefined;
  pendingCount?: number;
}

export function SidebarNav({ me, pendingCount }: SidebarNavProps) {
  return (
    <nav aria-label="Điều hướng chính" className="space-y-4">
      {GROUPS.map((group) => {
        const visible = group.items.filter((item) => can(me, item.permission));
        if (visible.length === 0) return null;
        return (
          <div key={group.title}>
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {group.title}
            </p>
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center justify-between rounded-[var(--radius-btn)] px-3 text-sm',
                    isActive
                      ? 'bg-brand-100 font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-100'
                      : 'text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/5',
                  )
                }
              >
                <span>{item.label}</span>
                {item.to === '/edits' && pendingCount !== undefined && pendingCount > 0 && (
                  <Badge tone="brand">{pendingCount}</Badge>
                )}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Viết `apps/admin/src/layout/topbar.tsx`**

```tsx
import type { ReactNode } from 'react';
import { applyTheme, readStoredTheme } from '@/lib/theme';
import { Button } from '@/components/ui/button';

interface TopbarProps {
  title: string;
  email: string | undefined;
  drawer: ReactNode;
}

export function Topbar({ title, email, drawer }: TopbarProps) {
  const toggle = () => {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
  };

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 bg-brand-700 px-3 py-2 text-white">
      {drawer}
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
      <Button
        variant="ghost"
        className="text-white hover:bg-white/10"
        aria-label={readStoredTheme() === 'dark' ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'}
        onClick={toggle}
      >
        ◐
      </Button>
      {email && (
        <a
          href="/cdn-cgi/access/logout"
          className="hidden max-w-[12rem] truncate text-sm underline underline-offset-4 sm:block"
          title={`${email} — bấm để đăng xuất`}
        >
          {email}
        </a>
      )}
    </header>
  );
}
```

- [ ] **Step 6: Viết `apps/admin/src/layout/app-shell.tsx`**

```tsx
import { Outlet, useLocation } from 'react-router';
import { DelayedActionProvider } from '@/components/delayed-action';
import { useMe } from '@/lib/permissions';
import { Drawer } from './drawer';
import { SidebarNav } from './sidebar-nav';
import { Topbar } from './topbar';

const TITLES: Record<string, string> = {
  '/': 'Tổng quan',
  '/edits': 'Duyệt đóng góp POI',
  '/tenants': 'Tenant & khoá API',
  '/billing': 'Gói cước & hạn mức',
  '/health': 'Sức khoẻ hệ thống',
  '/audit': 'Nhật ký kiểm toán',
};

export function AppShell({ pendingCount }: { pendingCount?: number }) {
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? 'Admin Page';

  return (
    <DelayedActionProvider>
      <Topbar
        title={title}
        email={me?.email}
        drawer={
          <Drawer title="Điều hướng chính">
            <SidebarNav me={me} {...(pendingCount === undefined ? {} : { pendingCount })} />
          </Drawer>
        }
      />
      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-4">
        {/* Sidebar cố định chỉ xuất hiện từ 1024px; dưới đó nó nằm trong ngăn kéo. */}
        <aside className="hidden w-60 shrink-0 lg:block">
          <p className="px-2 pb-3 text-base font-bold">Admin Page</p>
          <SidebarNav me={me} {...(pendingCount === undefined ? {} : { pendingCount })} />
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </DelayedActionProvider>
  );
}
```

- [ ] **Step 7: Viết `apps/admin/src/routes.tsx`**

```tsx
import { lazy, type ReactNode, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { LoadingSkeleton } from '@/components/states';
import { AppShell } from '@/layout/app-shell';

const EditsPage = lazy(() =>
  import('@/features/edits/page').then((module) => ({ default: module.EditsPage })),
);

const wait = (node: ReactNode) => (
  <Suspense fallback={<LoadingSkeleton rows={4} />}>{node}</Suspense>
);

// basename /admin: Worker phục vụ SPA tại đường dẫn đó, không phải ở gốc tên miền.
export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: wait(<EditsPage />) },
        { path: 'edits', element: wait(<EditsPage />) },
      ],
    },
  ],
  { basename: '/admin' },
);
```

- [ ] **Step 8: Ghi đè `apps/admin/src/main.tsx`**

```tsx
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { applyTheme, readStoredTheme } from './lib/theme';
import { router } from './routes';

applyTheme(readStoredTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Thiếu #root');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 9: Đổi tiêu đề trong `apps/admin/index.html`**

```html
    <title>Admin Page — MapsLibVN</title>
```

- [ ] **Step 10: Chạy test và build**

```bash
pnpm exec vitest run apps/admin/src/layout/sidebar-nav.test.tsx
pnpm --filter @mapslibvn/admin build
pnpm typecheck
```

Kỳ vọng: 4 test PASS; build và typecheck xanh. Build sẽ đỏ ở `@/features/edits/page` — file đó chưa có, tạo ở Task 18. Tạo tạm để build xanh:

`apps/admin/src/features/edits/page.tsx`

```tsx
export function EditsPage() {
  return <p>Đang dựng ở Task 18.</p>;
}
```

- [ ] **Step 11: Commit**

```bash
git add apps/admin/src/layout apps/admin/src/routes.tsx apps/admin/src/main.tsx \
        apps/admin/index.html apps/admin/src/features/edits/page.tsx \
        apps/admin/package.json pnpm-lock.yaml
git commit -m "feat(admin): khung trang Admin Page — topbar, sidebar, router, hoãn gửi"
```

---

# PHA 1 — DUYỆT ĐÓNG GÓP

## Task 13: Tham số lọc và phân trang cho `GET /v1/admin/edits`

**Files:**
- Create: `apps/api/src/routes/admin-edit-params.ts`
- Test: `apps/api/test/admin-edits-params.test.ts`

Tách phần phân tích tham số ra file riêng để test được mà không cần DB — tầng test `apps/api/test` không có Postgres.

- [ ] **Step 1: Viết test thất bại**

`apps/api/test/admin-edits-params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEditListParams } from '../src/routes/admin-edit-params';

const parse = (query: string) =>
  parseEditListParams(new URL(`https://api/v1/admin/edits?${query}`).searchParams);

describe('parseEditListParams', () => {
  it('mặc định: pending, 25 bản ghi, không con trỏ', () => {
    expect(parse('')).toEqual({ status: 'pending', limit: 25, cursor: null, kind: null, tenantId: null, q: null });
  });

  it('status lạ → ném lỗi 400', () => {
    expect(() => parse('status=xyz')).toThrow(/status/);
  });

  it('kind lạ → ném lỗi 400', () => {
    expect(() => parse('kind=xoa')).toThrow(/kind/);
  });

  it('limit bị kẹp trong 1..100', () => {
    expect(parse('limit=500').limit).toBe(100);
    expect(parse('limit=0').limit).toBe(1);
    expect(parse('limit=abc').limit).toBe(25);
  });

  it('cursor phải là số nguyên dương', () => {
    expect(parse('cursor=42').cursor).toBe(42);
    expect(() => parse('cursor=-1')).toThrow(/cursor/);
  });

  it('tenant phải là uuid', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parse(`tenant=${id}`).tenantId).toBe(id);
    expect(() => parse('tenant=khong-phai-uuid')).toThrow(/tenant/);
  });

  it('q bị cắt còn 80 ký tự và bỏ khoảng trắng thừa', () => {
    expect(parse('q=%20%20ca%20phe%20%20').q).toBe('ca phe');
    expect(parse(`q=${'a'.repeat(200)}`).q).toHaveLength(80);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-edits-params.test.ts
```

Kỳ vọng: FAIL — không tìm thấy `../src/routes/admin-edit-params`.

- [ ] **Step 3: Viết `apps/api/src/routes/admin-edit-params.ts`**

```ts
import { ApiError } from '../errors';

const STATUSES = ['pending', 'approved', 'rejected', 'auto_approved'] as const;
const KINDS = ['create', 'update', 'close', 'reopen', 'report'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EditListParams {
  status: (typeof STATUSES)[number];
  kind: (typeof KINDS)[number] | null;
  tenantId: string | null;
  q: string | null;
  limit: number;
  /** Con trỏ = id của bản ghi cuối trang trước. Danh sách sắp giảm dần theo id. */
  cursor: number | null;
}

export function parseEditListParams(params: URLSearchParams): EditListParams {
  const status = params.get('status') ?? 'pending';
  if (!(STATUSES as readonly string[]).includes(status))
    throw new ApiError(400, 'invalid_request', `status phải là: ${STATUSES.join(', ')}`);

  const rawKind = params.get('kind');
  if (rawKind !== null && !(KINDS as readonly string[]).includes(rawKind))
    throw new ApiError(400, 'invalid_request', `kind phải là: ${KINDS.join(', ')}`);

  const rawTenant = params.get('tenant');
  if (rawTenant !== null && !UUID.test(rawTenant))
    throw new ApiError(400, 'invalid_request', 'tenant phải là uuid');

  const rawCursor = params.get('cursor');
  let cursor: number | null = null;
  if (rawCursor !== null) {
    const parsed = Number(rawCursor);
    if (!Number.isInteger(parsed) || parsed <= 0)
      throw new ApiError(400, 'invalid_request', 'cursor phải là số nguyên dương');
    cursor = parsed;
  }

  const rawLimit = Number(params.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit !== 0 ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : 25;

  const rawQ = params.get('q')?.trim() ?? '';
  const q = rawQ === '' ? null : rawQ.slice(0, 80);

  return {
    status: status as EditListParams['status'],
    kind: (rawKind as EditListParams['kind']) ?? null,
    tenantId: rawTenant,
    q,
    limit,
    cursor,
  };
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm --filter @mapslibvn/api exec vitest run test/admin-edits-params.test.ts
```

Kỳ vọng: PASS, 7 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-edit-params.ts apps/api/test/admin-edits-params.test.ts
git commit -m "feat(api): phân tích tham số lọc và phân trang cho danh sách đóng góp"
```

---

## Task 14: Dùng tham số mới trong `GET /v1/admin/edits` và thêm `/count`

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/test-db/admin-list.itest.mjs`

- [ ] **Step 1: Thay thân route `GET /v1/admin/edits`**

Trong `apps/api/src/routes/admin.ts`, thêm import ở đầu file:

```ts
import { audit } from '../audit';
import { parseEditListParams } from './admin-edit-params';
```

rồi thay toàn bộ handler `admin.get('/v1/admin/edits', …)` hiện tại bằng:

```ts
admin.get('/v1/admin/edits', async (c) => {
  const params = parseEditListParams(new URL(c.req.url).searchParams);
  const sql = getSql(c.env);
  try {
    // Lấy dư một bản ghi để biết còn trang sau hay không, thay vì đếm tổng — đếm tổng trên bảng
    // đóng góp là quét toàn phần, còn người duyệt chỉ cần biết "còn nữa không".
    const rows = await sql`
      SELECT e.id::int AS id, e.poi_id, e.kind, e.changes, e.photo_url, e.note, e.status,
             e.reviewer, e.reviewed_at, e.created_at, e.tenant_id,
             p.name AS poi_name, p.status AS poi_status,
             p.ward AS poi_ward, p.province AS poi_province,
             CASE WHEN e.changes ? 'lat' AND p.geom IS NOT NULL
                  THEN round(ST_DistanceSphere(
                         p.geom,
                         ST_SetSRID(ST_MakePoint((e.changes->>'lng')::float8,
                                                 (e.changes->>'lat')::float8), 4326))::numeric)::int
             END AS distance_m
      FROM poi_edit e LEFT JOIN poi p ON p.id = e.poi_id
      WHERE e.status = ${params.status}
        AND (${params.kind}::text IS NULL OR e.kind = ${params.kind})
        AND (${params.tenantId}::uuid IS NULL OR e.tenant_id = ${params.tenantId}::uuid)
        AND (${params.q}::text IS NULL OR p.name ILIKE '%' || ${params.q} || '%'
             OR e.changes->>'name' ILIKE '%' || ${params.q} || '%')
        AND (${params.cursor}::int IS NULL OR e.id < ${params.cursor}::int)
      ORDER BY e.id DESC
      LIMIT ${params.limit + 1}`;

    const hasMore = rows.length > params.limit;
    const items = hasMore ? rows.slice(0, params.limit) : rows;
    const last = items.at(-1);
    return c.json(
      { items, nextCursor: hasMore && last ? Number(last.id) : null },
      200,
      { 'cache-control': 'private, no-store' },
    );
  } catch (error) {
    console.error('admin/edits', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
  } finally {
    endSql(c.executionCtx, sql);
  }
});

admin.get('/v1/admin/edits/count', async (c) => {
  const sql = getSql(c.env);
  try {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM poi_edit WHERE status = 'pending'`;
    return c.json({ pending: row?.count ?? 0 }, 200, { 'cache-control': 'private, no-store' });
  } catch (error) {
    console.error('admin/edits/count', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đếm được đóng góp chờ duyệt');
  } finally {
    endSql(c.executionCtx, sql);
  }
});
```

- [ ] **Step 2: Viết test SQL thật**

`apps/api/test-db/admin-list.itest.mjs`:

```js
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const FREE_KEY = 'mlv_live_edit00000000000000000000';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path) => fetch(base + path, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });

const createPending = async (name) =>
  (
    await fetch(`${base}/v1/edits`, {
      method: 'POST',
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'create',
        changes: { name, lat: 10.775, lng: 106.699, category: 'cafe' },
        end_user_token: `list-itest-${name}`,
      }),
    })
  ).json();

describe('GET /v1/admin/edits — lọc và phân trang', () => {
  it('limit + cursor chia trang không trùng, không sót', async () => {
    const names = [];
    for (let i = 0; i < 3; i += 1) {
      const name = `Quán Phân Trang ${Date.now()}-${i}`;
      names.push(name);
      await createPending(name);
    }

    const first = await (await adminFetch('/v1/admin/edits?status=pending&limit=2')).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTypeOf('number');

    const second = await (
      await adminFetch(`/v1/admin/edits?status=pending&limit=2&cursor=${first.nextCursor}`)
    ).json();
    const firstIds = first.items.map((item) => item.id);
    const secondIds = second.items.map((item) => item.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });

  it('lọc kind=create chỉ trả bản ghi create', async () => {
    const body = await (await adminFetch('/v1/admin/edits?status=pending&kind=create')).json();
    expect(body.items.every((item) => item.kind === 'create')).toBe(true);
  });

  it('tìm theo tên khớp cả POI lẫn changes->>name', async () => {
    const name = `Quán Tìm Kiếm ${Date.now()}`;
    await createPending(name);
    const body = await (
      await adminFetch(`/v1/admin/edits?status=pending&q=${encodeURIComponent('Quán Tìm Kiếm')}`)
    ).json();
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('status lạ → 400 invalid_request', async () => {
    const response = await adminFetch('/v1/admin/edits?status=xyz');
    expect(response.status).toBe(400);
  });

  it('/count trả số bản ghi pending', async () => {
    const body = await (await adminFetch('/v1/admin/edits/count')).json();
    expect(body.pending).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Chạy test SQL thật**

```bash
pnpm db:up
pnpm test:api-db
```

Kỳ vọng: file `admin-list.itest.mjs` PASS, và `admin.itest.mjs` cũ vẫn PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/test-db/admin-list.itest.mjs
git commit -m "feat(api): lọc, tìm và phân trang con trỏ cho danh sách đóng góp"
```

---

## Task 15: `GET /v1/admin/edits/:id` — chi tiết kèm POI hiện tại và POI lân cận

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/test-db/admin-detail.itest.mjs`

`/v1/nearby` không dùng được: nó đòi API key **và tính quota**, tức mỗi lần mở một đóng góp sẽ tiêu lượt của một tenant. Endpoint này gộp mọi thứ màn chi tiết cần vào một request đi qua Access.

- [ ] **Step 1: Viết test SQL thật trước**

`apps/api/test-db/admin-detail.itest.mjs`:

```js
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const FREE_KEY = 'mlv_live_edit00000000000000000000';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path, init = {}) =>
  fetch(base + path, { ...init, headers: { 'Cf-Access-Jwt-Assertion': jwt, ...(init.headers ?? {}) } });

const submit = (body) =>
  fetch(`${base}/v1/edits`, {
    method: 'POST',
    headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((response) => response.json());

describe('GET /v1/admin/edits/:id', () => {
  it('create → có nearby, không có poi_hien_tai và không có distance_m', async () => {
    const created = await submit({
      kind: 'create',
      changes: { name: `Chi Tiết Tạo ${Date.now()}`, lat: 10.7769, lng: 106.7009, category: 'cafe' },
      end_user_token: 'detail-create',
    });
    const body = await (await adminFetch(`/v1/admin/edits/${created.edit_id}`)).json();
    expect(body.edit.kind).toBe('create');
    expect(body.poi_hien_tai).toBeNull();
    expect(body.distance_m).toBeNull();
    expect(Array.isArray(body.nearby)).toBe(true);
  });

  it('update đổi toạ độ → distance_m là số dương, poi_hien_tai có toạ độ cũ', async () => {
    const created = await submit({
      kind: 'create',
      changes: { name: `Chi Tiết Sửa ${Date.now()}`, lat: 10.77, lng: 106.7, category: 'cafe' },
      end_user_token: 'detail-seed',
    });
    await adminFetch(`/v1/admin/edits/${created.edit_id}/approve`, { method: 'POST' });

    const moved = await submit({
      kind: 'update',
      poi_id: created.poi_id,
      changes: { lat: 10.773, lng: 106.703 },
      end_user_token: 'detail-move',
    });
    const body = await (await adminFetch(`/v1/admin/edits/${moved.edit_id}`)).json();
    expect(body.poi_hien_tai.lat).toBeCloseTo(10.77, 3);
    expect(body.distance_m).toBeGreaterThan(100);
    expect(body.nearby).toEqual([]);
  });

  it('id không tồn tại → 404', async () => {
    expect((await adminFetch('/v1/admin/edits/99999999')).status).toBe(404);
  });

  it('không JWT → 401', async () => {
    expect((await fetch(`${base}/v1/admin/edits/1`)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm test:api-db
```

Kỳ vọng: `admin-detail.itest.mjs` FAIL — route chưa tồn tại nên trả 404 ở mọi ca, hai ca đầu đỏ.

- [ ] **Step 3: Thêm route vào `apps/api/src/routes/admin.ts`**

Đặt **trước** `admin.post('/v1/admin/edits/:id/approve', …)`:

```ts
const NEARBY_RADIUS_M = 200;
const NEARBY_LIMIT = 10;

admin.get('/v1/admin/edits/:id', async (c) => {
  const id = editId(c.req.param('id'));
  const sql = getSql(c.env);
  try {
    const [row] = await sql`
      SELECT to_jsonb(e) - 'ip_hash' - 'end_user_hash' AS edit,
             CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', p.id, 'name', p.name, 'category', p.category, 'status', p.status,
               'housenumber', p.housenumber, 'street', p.street, 'ward', p.ward,
               'province', p.province, 'address_text', p.address_text,
               'contact', p.contact, 'hours', p.hours,
               'lat', ST_Y(p.geom), 'lng', ST_X(p.geom)) END AS poi_hien_tai,
             CASE WHEN e.changes ? 'lat' AND p.geom IS NOT NULL
                  THEN round(ST_DistanceSphere(
                         p.geom,
                         ST_SetSRID(ST_MakePoint((e.changes->>'lng')::float8,
                                                 (e.changes->>'lat')::float8), 4326))::numeric)::int
             END AS distance_m
      FROM poi_edit e LEFT JOIN poi p ON p.id = e.poi_id
      WHERE e.id = ${id}::bigint`;

    if (!row) throw new ApiError(404, 'not_found', 'Không có đóng góp này');

    // POI lân cận chỉ có nghĩa với `create`: câu hỏi của người duyệt lúc đó là "chỗ này đã có POI
    // nào chưa", tức là bắt trùng lặp. Các loại khác đã có POI đích rồi.
    const edit = row.edit as { kind: string; changes: Record<string, unknown> | null };
    let nearby: unknown[] = [];
    if (edit.kind === 'create' && edit.changes && 'lat' in edit.changes) {
      nearby = await sql`
        SELECT p.id, p.name, p.category, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng,
               round(ST_DistanceSphere(p.geom, ST_SetSRID(ST_MakePoint(
                 ${Number(edit.changes.lng)}::float8, ${Number(edit.changes.lat)}::float8), 4326))::numeric)::int AS distance_m
        FROM poi p
        WHERE p.status = 'active'
          AND ST_DWithin(p.geom::geography,
                ST_SetSRID(ST_MakePoint(${Number(edit.changes.lng)}::float8,
                                        ${Number(edit.changes.lat)}::float8), 4326)::geography,
                ${NEARBY_RADIUS_M})
        ORDER BY distance_m
        LIMIT ${NEARBY_LIMIT}`;
    }

    return c.json(
      { edit: row.edit, poi_hien_tai: row.poi_hien_tai, distance_m: row.distance_m ?? null, nearby },
      200,
      { 'cache-control': 'private, no-store' },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/edits/:id', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đọc được chi tiết đóng góp');
  } finally {
    endSql(c.executionCtx, sql);
  }
});
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm test:api-db
```

Kỳ vọng: `admin-detail.itest.mjs` PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/test-db/admin-detail.itest.mjs
git commit -m "feat(api): chi tiết đóng góp kèm POI hiện tại, khoảng cách và POI lân cận"
```

---

## Task 16: Duyệt hàng loạt và ghi nhật ký cho mọi thao tác

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/test-db/admin-bulk.itest.mjs`

- [ ] **Step 1: Viết test SQL thật**

`apps/api/test-db/admin-bulk.itest.mjs`:

```js
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const FREE_KEY = 'mlv_live_edit00000000000000000000';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const EMAIL = 'phong@access-fake.local';
const jwt = signAccessJwt({ email: EMAIL });
const adminFetch = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

const createPending = async (name) =>
  (
    await fetch(`${base}/v1/edits`, {
      method: 'POST',
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'create',
        changes: { name, lat: 10.778, lng: 106.701, category: 'cafe' },
        end_user_token: `bulk-${name}`,
      }),
    })
  ).json();

describe('POST /v1/admin/edits/bulk', () => {
  it('duyệt một lô: mọi id chuyển khỏi pending, nhật ký ghi đúng người', async () => {
    const a = await createPending(`Lô A ${Date.now()}`);
    const b = await createPending(`Lô B ${Date.now()}`);

    const response = await adminFetch('/v1/admin/edits/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: [a.edit_id, b.edit_id], action: 'approve' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toHaveLength(2);

    const rows = await sql`SELECT status FROM poi_edit WHERE id IN (${a.edit_id}, ${b.edit_id})`;
    expect(rows.every((row) => row.status === 'approved')).toBe(true);

    // Nhật ký ghi trong waitUntil nên có độ trễ nhỏ.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const audit = await sql`SELECT actor, action FROM admin_audit
      WHERE action = 'edits.bulk_approve' ORDER BY id DESC LIMIT 1`;
    expect(audit[0]?.actor).toBe(EMAIL);
  });

  it('id không còn pending nằm ở danh sách failed, phần còn lại vẫn chạy', async () => {
    const a = await createPending(`Lô C ${Date.now()}`);
    await adminFetch(`/v1/admin/edits/${a.edit_id}/approve`, { method: 'POST' });
    const b = await createPending(`Lô D ${Date.now()}`);

    const body = await (
      await adminFetch('/v1/admin/edits/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids: [a.edit_id, b.edit_id], action: 'approve' }),
      })
    ).json();
    expect(body.failed).toContain(a.edit_id);
    expect(body.ok).toContain(b.edit_id);
  });

  it('quá 50 id → 400', async () => {
    const response = await adminFetch('/v1/admin/edits/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: Array.from({ length: 51 }, (_, i) => i + 1), action: 'approve' }),
    });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm test:api-db
```

Kỳ vọng: `admin-bulk.itest.mjs` FAIL — route chưa có.

- [ ] **Step 3: Thêm route và ghi nhật ký vào `apps/api/src/routes/admin.ts`**

Thêm ngay sau route `GET /v1/admin/edits/:id`:

```ts
const BULK_MAX = 50;

admin.post('/v1/admin/edits/bulk', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { ids?: unknown; action?: unknown }
    | null;
  const action = body?.action;
  if (action !== 'approve' && action !== 'reject')
    throw new ApiError(400, 'invalid_request', 'action phải là approve hoặc reject');
  if (!Array.isArray(body?.ids) || body.ids.length === 0 || body.ids.length > BULK_MAX)
    throw new ApiError(400, 'invalid_request', `ids phải là mảng 1..${BULK_MAX} phần tử`);

  const ids = body.ids.map((value) => editId(String(value)));
  const reviewer = c.get('reviewer') ?? '';
  const sql = getSql(c.env);
  const ok: number[] = [];
  const failed: number[] = [];
  try {
    for (const id of ids) {
      try {
        if (action === 'approve') {
          const [row] = await sql<{ poi_id: string | null }[]>`
            SELECT apply_poi_edit(${id}::bigint, ${reviewer}, 'approved') AS poi_id`;
          if (!row || row.poi_id === null) failed.push(id);
          else {
            ok.push(id);
            await invalidateCachedJson(placeCacheUrl(row.poi_id));
          }
        } else {
          const [row] = await sql<{ ok: boolean }[]>`
            SELECT reject_poi_edit(${id}::bigint, ${reviewer}) AS ok`;
          if (row?.ok) ok.push(id);
          else failed.push(id);
        }
      } catch (error) {
        console.error('admin/bulk item', id, error);
        failed.push(id);
      }
    }
    audit(c, `edits.bulk_${action}`, undefined, { ok, failed });
    return c.json({ ok, failed }, 200, { 'cache-control': 'private, no-store' });
  } finally {
    endSql(c.executionCtx, sql);
  }
});
```

- [ ] **Step 4: Ghi nhật ký cho approve/reject lẻ**

Trong handler `admin.post('/v1/admin/edits/:id/approve', …)`, ngay trước `return c.json({ ok: true, poi_id: row.poi_id })`:

```ts
    audit(c, 'edit.approve', String(id), { poi_id: row.poi_id });
```

Trong handler `reject`, ngay trước `return c.json({ ok: true })`:

```ts
    audit(c, 'edit.reject', String(id));
```

- [ ] **Step 5: Chạy test để xác nhận xanh**

```bash
pnpm test:api-db
```

Kỳ vọng: `admin-bulk.itest.mjs` PASS, 3 test; các file itest cũ vẫn PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/test-db/admin-bulk.itest.mjs
git commit -m "feat(api): duyệt hàng loạt và ghi nhật ký kiểm toán cho thao tác duyệt"
```

---

## Task 17: Tầng dữ liệu `features/edits`

**Files:**
- Create: `apps/admin/src/features/edits/api.ts`
- Create: `apps/admin/src/features/edits/hooks.ts`
- Delete: `apps/admin/src/api.ts` (file cũ, sẽ gỡ ở Task 23)

- [ ] **Step 1: Viết `apps/admin/src/features/edits/api.ts`**

```ts
import { apiFetch } from '@/lib/fetcher';

export type EditStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved';
export type EditKind = 'create' | 'update' | 'close' | 'reopen' | 'report';

export interface AdminEdit {
  id: number;
  poi_id: string | null;
  poi_name: string | null;
  poi_status: string | null;
  poi_ward: string | null;
  poi_province: string | null;
  kind: EditKind;
  changes: Record<string, unknown> | null;
  photo_url: string | null;
  note: string | null;
  status: EditStatus;
  reviewer: string | null;
  created_at: string;
  tenant_id: string;
  /** Chỉ có khi changes đổi toạ độ; tính bằng PostGIS để khớp số trong màn chi tiết. */
  distance_m: number | null;
}

export interface EditListPage {
  items: AdminEdit[];
  nextCursor: number | null;
}

export interface PoiSnapshot {
  id: string;
  name: string | null;
  category: string | null;
  status: string;
  housenumber: string | null;
  street: string | null;
  ward: string | null;
  province: string | null;
  address_text: string | null;
  contact: Record<string, unknown> | null;
  hours: Record<string, unknown> | null;
  lat: number;
  lng: number;
}

export interface NearbyPoi {
  id: string;
  name: string | null;
  category: string | null;
  lat: number;
  lng: number;
  distance_m: number;
}

export interface EditDetail {
  edit: AdminEdit;
  poi_hien_tai: PoiSnapshot | null;
  distance_m: number | null;
  nearby: NearbyPoi[];
}

export interface EditListFilter {
  status: EditStatus;
  kind?: EditKind;
  q?: string;
  cursor?: number;
}

export function listEdits(filter: EditListFilter): Promise<EditListPage> {
  const params = new URLSearchParams({ status: filter.status, limit: '25' });
  if (filter.kind) params.set('kind', filter.kind);
  if (filter.q) params.set('q', filter.q);
  if (filter.cursor) params.set('cursor', String(filter.cursor));
  return apiFetch<EditListPage>(`/v1/admin/edits?${params.toString()}`);
}

export function getEdit(id: number): Promise<EditDetail> {
  return apiFetch<EditDetail>(`/v1/admin/edits/${id}`);
}

export function countPending(): Promise<{ pending: number }> {
  return apiFetch<{ pending: number }>('/v1/admin/edits/count');
}

export function reviewEdit(id: number, action: 'approve' | 'reject'): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/v1/admin/edits/${id}/${action}`, { method: 'POST' });
}

export function reviewBulk(
  ids: number[],
  action: 'approve' | 'reject',
): Promise<{ ok: number[]; failed: number[] }> {
  return apiFetch<{ ok: number[]; failed: number[] }>('/v1/admin/edits/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids, action }),
  });
}
```

- [ ] **Step 2: Viết `apps/admin/src/features/edits/hooks.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  countPending,
  type EditListFilter,
  getEdit,
  listEdits,
  reviewBulk,
  reviewEdit,
} from './api';

export const editKeys = {
  list: (filter: EditListFilter) => ['edits', 'list', filter] as const,
  detail: (id: number) => ['edits', 'detail', id] as const,
  count: () => ['edits', 'count'] as const,
};

export function useEditList(filter: EditListFilter) {
  return useQuery({ queryKey: editKeys.list(filter), queryFn: () => listEdits(filter) });
}

export function useEditDetail(id: number | null) {
  return useQuery({
    queryKey: editKeys.detail(id ?? 0),
    queryFn: () => getEdit(id as number),
    enabled: id !== null,
  });
}

export function usePendingCount() {
  return useQuery({
    queryKey: editKeys.count(),
    queryFn: countPending,
    refetchInterval: 60_000,
  });
}

/** Làm mới danh sách và huy hiệu sau khi một thao tác duyệt đã gửi thật. */
function useInvalidateEdits() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['edits'] });
  };
}

export function useReviewEdit() {
  const invalidate = useInvalidateEdits();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'reject' }) =>
      reviewEdit(id, action),
    onSettled: invalidate,
  });
}

export function useReviewBulk() {
  const invalidate = useInvalidateEdits();
  return useMutation({
    mutationFn: ({ ids, action }: { ids: number[]; action: 'approve' | 'reject' }) =>
      reviewBulk(ids, action),
    onSettled: invalidate,
  });
}
```

- [ ] **Step 3: Kiểm tra kiểu**

```bash
pnpm --filter @mapslibvn/admin exec tsc --noEmit
```

Kỳ vọng: xanh.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/edits/api.ts apps/admin/src/features/edits/hooks.ts
git commit -m "feat(admin): tầng dữ liệu mảng Duyệt đóng góp"
```

---

## Task 18: Danh sách đóng góp — thẻ, bảng và bộ lọc

**Files:**
- Modify: `apps/admin/src/features/edits/page.tsx`
- Create: `apps/admin/src/features/edits/edit-card.tsx`
- Test: `apps/admin/src/features/edits/edit-card.test.tsx`

- [ ] **Step 1: Viết test thất bại**

`apps/admin/src/features/edits/edit-card.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminEdit } from './api';
import { EditCard } from './edit-card';

const base: AdminEdit = {
  id: 1,
  poi_id: 'poi_1',
  poi_name: 'Cà phê Chiều Thứ Bảy',
  poi_status: 'active',
  poi_ward: 'Phường Bến Nghé',
  poi_province: 'TP.HCM',
  kind: 'update',
  changes: { name: 'Tên mới' },
  photo_url: null,
  note: null,
  status: 'pending',
  reviewer: null,
  created_at: new Date().toISOString(),
  tenant_id: 't1',
  distance_m: null,
};

describe('EditCard', () => {
  it('hiện tên POI, nhãn loại tiếng Việt và địa chỉ', () => {
    render(<EditCard edit={base} onOpen={vi.fn()} onReview={vi.fn()} />);
    expect(screen.getByText('Cà phê Chiều Thứ Bảy')).toBeVisible();
    expect(screen.getByText('Sửa')).toBeVisible();
    expect(screen.getByText(/Phường Bến Nghé/)).toBeVisible();
  });

  it('có đổi toạ độ → hiện nhãn cảnh báo kèm số mét', () => {
    render(<EditCard edit={{ ...base, distance_m: 340 }} onOpen={vi.fn()} onReview={vi.fn()} />);
    expect(screen.getByText('Đổi vị trí · 340 m')).toBeVisible();
  });

  it('không đổi toạ độ → không có nhãn đó', () => {
    render(<EditCard edit={base} onOpen={vi.fn()} onReview={vi.fn()} />);
    expect(screen.queryByText(/Đổi vị trí/)).not.toBeInTheDocument();
  });

  it('bản ghi đã duyệt → không có nút Duyệt/Từ chối', () => {
    render(<EditCard edit={{ ...base, status: 'approved' }} onOpen={vi.fn()} onReview={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();
  });

  it('bấm Duyệt gọi onReview với approve', async () => {
    const onReview = vi.fn();
    render(<EditCard edit={base} onOpen={vi.fn()} onReview={onReview} />);
    screen.getByRole('button', { name: 'Duyệt' }).click();
    expect(onReview).toHaveBeenCalledWith(1, 'approve');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/edits/edit-card.test.tsx
```

Kỳ vọng: FAIL — không resolve được `./edit-card`.

- [ ] **Step 3: Viết `apps/admin/src/features/edits/edit-card.tsx`**

```tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import type { AdminEdit, EditKind } from './api';

export const KIND_VI: Record<EditKind, string> = {
  create: 'Tạo mới',
  update: 'Sửa',
  close: 'Đóng cửa',
  reopen: 'Mở lại',
  report: 'Báo lỗi',
};

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}

export function editTitle(edit: AdminEdit): string {
  const fromChanges = typeof edit.changes?.name === 'string' ? edit.changes.name : null;
  return edit.poi_name ?? fromChanges ?? edit.poi_id ?? `Đóng góp #${edit.id}`;
}

interface EditCardProps {
  edit: AdminEdit;
  onOpen: (id: number) => void;
  onReview: (id: number, action: 'approve' | 'reject') => void;
}

export function EditCard({ edit, onOpen, onReview }: EditCardProps) {
  const address = [edit.poi_ward, edit.poi_province].filter(Boolean).join(', ');
  const pending = edit.status === 'pending';

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Badge tone={edit.kind === 'create' ? 'brand' : 'neutral'}>{KIND_VI[edit.kind]}</Badge>
        {edit.distance_m !== null && <Badge tone="warning">Đổi vị trí · {edit.distance_m} m</Badge>}
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          {relativeTime(edit.created_at)}
        </span>
      </div>

      <button type="button" onClick={() => onOpen(edit.id)} className="mt-2 block w-full text-left">
        <CardTitle>{editTitle(edit)}</CardTitle>
        {address && <p className="mt-0.5 text-sm text-[var(--text-muted)]">{address}</p>}
      </button>

      {pending && (
        <div className="mt-3 flex gap-2">
          <Button block onClick={() => onReview(edit.id, 'approve')}>
            Duyệt
          </Button>
          <Button block variant="secondary" onClick={() => onReview(edit.id, 'reject')}>
            Từ chối
          </Button>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm exec vitest run apps/admin/src/features/edits/edit-card.test.tsx
```

Kỳ vọng: PASS, 5 test.

- [ ] **Step 5: Ghi đè `apps/admin/src/features/edits/page.tsx`**

```tsx
import { useState } from 'react';
import { DataView } from '@/components/data-view';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDelayedAction } from '@/components/delayed-action';
import type { EditKind, EditStatus } from './api';
import { EditCard, editTitle, KIND_VI, relativeTime } from './edit-card';
import { EditDetailPanel } from './detail';
import { useEditList, useReviewEdit } from './hooks';

const STATUS_TABS: { value: EditStatus; label: string }[] = [
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'approved', label: 'Đã duyệt' },
  { value: 'rejected', label: 'Từ chối' },
  { value: 'auto_approved', label: 'Tự duyệt' },
];

const KINDS: EditKind[] = ['create', 'update', 'close', 'reopen', 'report'];

export function EditsPage() {
  const [status, setStatus] = useState<EditStatus>('pending');
  const [kind, setKind] = useState<EditKind | ''>('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const filter = { status, ...(kind ? { kind } : {}), ...(q ? { q } : {}) };
  const list = useEditList(filter);
  const review = useReviewEdit();
  const { schedule } = useDelayedAction();

  const onReview = (id: number, action: 'approve' | 'reject') => {
    schedule({
      label: action === 'approve' ? `Đã duyệt #${id}` : `Đã từ chối #${id}`,
      run: async () => {
        await review.mutateAsync({ id, action });
      },
    });
    setOpenId((current) => (current === id ? null : current));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={
              tab.value === status
                ? 'min-h-11 rounded-full bg-brand-700 px-4 text-sm font-semibold text-white'
                : 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Tìm theo tên POI"
          aria-label="Tìm theo tên POI"
          className="min-h-11 flex-1 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
        />
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as EditKind | '')}
          aria-label="Lọc theo loại"
          className="min-h-11 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
        >
          <option value="">Mọi loại</option>
          {KINDS.map((value) => (
            <option key={value} value={value}>
              {KIND_VI[value]}
            </option>
          ))}
        </select>
      </div>

      {list.isPending && <LoadingSkeleton rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data?.items.length === 0 && (
        <EmptyState
          title="Không có đóng góp nào ở trạng thái này"
          hint="Đổi bộ lọc phía trên, hoặc chờ người dùng gửi đóng góp mới."
        />
      )}

      {list.data && list.data.items.length > 0 && (
        <DataView
          items={list.data.items}
          rowKey={(edit) => String(edit.id)}
          renderCard={(edit) => <EditCard edit={edit} onOpen={setOpenId} onReview={onReview} />}
          columns={[
            {
              key: 'kind',
              header: 'Loại',
              render: (edit) => <Badge>{KIND_VI[edit.kind]}</Badge>,
            },
            {
              key: 'poi',
              header: 'POI',
              render: (edit) => (
                <button type="button" className="text-left" onClick={() => setOpenId(edit.id)}>
                  <span className="font-semibold">{editTitle(edit)}</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {[edit.poi_ward, edit.poi_province].filter(Boolean).join(', ')}
                  </span>
                </button>
              ),
            },
            {
              key: 'vitri',
              header: 'Vị trí',
              render: (edit) =>
                edit.distance_m === null ? (
                  <span className="text-[var(--text-muted)]">—</span>
                ) : (
                  <Badge tone="warning">{edit.distance_m} m</Badge>
                ),
            },
            {
              key: 'luc',
              header: 'Lúc gửi',
              render: (edit) => relativeTime(edit.created_at),
            },
            {
              key: 'hanhdong',
              header: '',
              render: (edit) =>
                edit.status === 'pending' ? (
                  <div className="flex gap-2">
                    <Button onClick={() => onReview(edit.id, 'approve')}>Duyệt</Button>
                    <Button variant="secondary" onClick={() => onReview(edit.id, 'reject')}>
                      Từ chối
                    </Button>
                  </div>
                ) : null,
            },
          ]}
        />
      )}

      <EditDetailPanel id={openId} onClose={() => setOpenId(null)} onReview={onReview} />
    </div>
  );
}
```

- [ ] **Step 6: Commit** (build sẽ đỏ vì `./detail` chưa có — tạo ở Task 19; commit phần test đã xanh)

```bash
git add apps/admin/src/features/edits/edit-card.tsx apps/admin/src/features/edits/edit-card.test.tsx \
        apps/admin/src/features/edits/page.tsx
git commit -m "feat(admin): danh sách đóng góp có bộ lọc, thẻ trên mobile và bảng trên desktop"
```

---

## Task 19: Bảng so sánh cũ → mới theo từng trường

**Files:**
- Create: `apps/admin/src/features/edits/field-diff.tsx`
- Test: `apps/admin/src/features/edits/field-diff.test.tsx`

- [ ] **Step 1: Viết test thất bại**

`apps/admin/src/features/edits/field-diff.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildDiff, FieldDiff } from './field-diff';
import type { PoiSnapshot } from './api';

const poi: PoiSnapshot = {
  id: 'poi_1',
  name: 'Cà phê Cũ',
  category: 'cafe',
  status: 'active',
  housenumber: '12',
  street: 'Lê Lợi',
  ward: 'Phường Bến Nghé',
  province: 'TP.HCM',
  address_text: '12 Lê Lợi',
  contact: null,
  hours: null,
  lat: 10.7721,
  lng: 106.7012,
};

describe('buildDiff', () => {
  it('bỏ qua các trường dẫn xuất *_norm — chúng là hệ quả, không phải thay đổi người dùng gửi', () => {
    const rows = buildDiff({ name: 'Mới', name_norm: 'moi' }, poi);
    expect(rows.map((row) => row.field)).toEqual(['name']);
  });

  it('gộp lat và lng thành một dòng toạ độ', () => {
    const rows = buildDiff({ lat: 10.7748, lng: 106.7031 }, poi);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.field).toBe('toạ độ');
    expect(rows[0]?.before).toContain('10,7721');
  });

  it('tạo mới (chưa có POI) → cột cũ để trống', () => {
    const rows = buildDiff({ name: 'Quán Mới' }, null);
    expect(rows[0]?.before).toBeNull();
  });

  it('giá trị dạng object được in ra JSON đọc được', () => {
    const rows = buildDiff({ hours: { mon: '08:00-22:00' } }, poi);
    expect(rows[0]?.after).toContain('mon');
  });
});

describe('FieldDiff', () => {
  it('hiện nhãn trường tiếng Việt và cả hai giá trị', () => {
    render(<FieldDiff changes={{ street: 'Nguyễn Huệ' }} poi={poi} />);
    expect(screen.getByText('Đường')).toBeVisible();
    expect(screen.getByText('Lê Lợi')).toBeVisible();
    expect(screen.getByText('Nguyễn Huệ')).toBeVisible();
  });

  it('không có thay đổi nào → nói rõ thay vì hiện bảng rỗng', () => {
    render(<FieldDiff changes={null} poi={poi} />);
    expect(screen.getByText(/Không có trường nào thay đổi/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/edits/field-diff.test.tsx
```

Kỳ vọng: FAIL — không resolve được `./field-diff`.

- [ ] **Step 3: Viết `apps/admin/src/features/edits/field-diff.tsx`**

```tsx
import type { PoiSnapshot } from './api';

/** Các khoá do máy chủ sinh ra từ giá trị người dùng gửi — hiện chúng chỉ làm nhiễu. */
const DERIVED = new Set(['name_norm', 'street_norm', 'ward_norm', 'province_norm']);

const LABELS: Record<string, string> = {
  name: 'Tên',
  category: 'Danh mục',
  housenumber: 'Số nhà',
  street: 'Đường',
  ward: 'Phường/xã',
  province: 'Tỉnh/thành',
  address_text: 'Địa chỉ',
  contact: 'Liên hệ',
  hours: 'Giờ mở cửa',
  'toạ độ': 'Toạ độ',
};

export interface DiffRow {
  field: string;
  before: string | null;
  after: string;
}

const show = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const coords = (lat: unknown, lng: unknown): string =>
  `${Number(lat).toFixed(4).replace('.', ',')} · ${Number(lng).toFixed(4).replace('.', ',')}`;

export function buildDiff(
  changes: Record<string, unknown> | null,
  poi: PoiSnapshot | null,
): DiffRow[] {
  if (!changes) return [];
  const rows: DiffRow[] = [];

  if ('lat' in changes || 'lng' in changes) {
    rows.push({
      field: 'toạ độ',
      before: poi ? coords(poi.lat, poi.lng) : null,
      after: coords(changes.lat ?? poi?.lat, changes.lng ?? poi?.lng),
    });
  }

  for (const [key, value] of Object.entries(changes)) {
    if (key === 'lat' || key === 'lng' || DERIVED.has(key)) continue;
    const before = poi ? show((poi as unknown as Record<string, unknown>)[key]) : null;
    rows.push({ field: key, before, after: show(value) });
  }

  return rows;
}

export function FieldDiff({
  changes,
  poi,
}: {
  changes: Record<string, unknown> | null;
  poi: PoiSnapshot | null;
}) {
  const rows = buildDiff(changes, poi);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Không có trường nào thay đổi — đóng góp này chỉ đổi trạng thái của địa điểm.
      </p>
    );
  }

  return (
    <dl className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
      {rows.map((row) => (
        <div
          key={row.field}
          className="flex flex-wrap items-baseline gap-2 border-b border-[var(--border)] px-3 py-2 last:border-b-0"
        >
          <dt className="w-24 shrink-0 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            {LABELS[row.field] ?? row.field}
          </dt>
          <dd className="flex flex-1 flex-wrap items-baseline gap-2 text-sm">
            {row.before !== null && (
              <>
                <span className="text-[var(--text-muted)] line-through">{row.before}</span>
                <span aria-hidden="true">→</span>
              </>
            )}
            <span className="font-semibold text-green-700 dark:text-green-300">{row.after}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 4: Chạy test để xác nhận xanh**

```bash
pnpm exec vitest run apps/admin/src/features/edits/field-diff.test.tsx
```

Kỳ vọng: PASS, 6 test.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/edits/field-diff.tsx apps/admin/src/features/edits/field-diff.test.tsx
git commit -m "feat(admin): bảng so sánh cũ → mới theo trường, gộp lat/lng thành một dòng"
```

---

## Task 20: Bản đồ so sánh vị trí

**Files:**
- Create: `apps/admin/src/features/edits/edit-map.tsx`
- Test: `apps/admin/src/features/edits/edit-map.test.tsx`

Quyết định quan trọng: **hàm thuần `mapPlan()` quyết định vẽ gì, tách khỏi component**. Nhờ vậy bốn nhánh — gồm cả nhánh *không vẽ bản đồ nào* — test được mà không cần dựng `maplibre-gl` trong jsdom.

- [ ] **Step 1: Cài maplibre-gl**

```bash
pnpm --filter @mapslibvn/admin add maplibre-gl
```

- [ ] **Step 2: Viết test thất bại**

`apps/admin/src/features/edits/edit-map.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EditDetail } from './api';
import { EditMap, mapPlan } from './edit-map';

const detail = (over: Partial<EditDetail>): EditDetail => ({
  edit: {
    id: 1,
    poi_id: 'poi_1',
    poi_name: 'Quán',
    poi_status: 'active',
    poi_ward: null,
    poi_province: null,
    kind: 'update',
    changes: null,
    photo_url: null,
    note: null,
    status: 'pending',
    reviewer: null,
    created_at: new Date().toISOString(),
    tenant_id: 't1',
    distance_m: null,
  },
  poi_hien_tai: null,
  distance_m: null,
  nearby: [],
  ...over,
});

describe('mapPlan', () => {
  it('update có đổi toạ độ → hai chốt kèm khoảng cách', () => {
    const plan = mapPlan(
      detail({
        edit: { ...detail({}).edit, changes: { lat: 10.7748, lng: 106.7031 } },
        poi_hien_tai: { lat: 10.7721, lng: 106.7012 } as never,
        distance_m: 340,
      }),
    );
    expect(plan).toMatchObject({ mode: 'so-sanh', distanceM: 340 });
  });

  it('update không đổi toạ độ → không vẽ bản đồ', () => {
    const plan = mapPlan(detail({ edit: { ...detail({}).edit, changes: { hours: {} } } }));
    expect(plan.mode).toBe('khong-ve');
  });

  it('create → một chốt kèm POI lân cận', () => {
    const plan = mapPlan(
      detail({
        edit: { ...detail({}).edit, kind: 'create', changes: { lat: 10.78, lng: 106.7 } },
        nearby: [{ id: 'p2', name: 'Khác', category: null, lat: 10.78, lng: 106.7, distance_m: 40 }],
      }),
    );
    expect(plan).toMatchObject({ mode: 'mot-chot' });
    expect(plan.mode === 'mot-chot' && plan.nearby).toHaveLength(1);
  });

  it('close → một chốt tại vị trí hiện tại', () => {
    const plan = mapPlan(
      detail({
        edit: { ...detail({}).edit, kind: 'close', changes: null },
        poi_hien_tai: { lat: 10.77, lng: 106.7 } as never,
      }),
    );
    expect(plan.mode).toBe('mot-chot');
  });

  it('không có toạ độ nào → không vẽ bản đồ', () => {
    expect(mapPlan(detail({ edit: { ...detail({}).edit, kind: 'close' } })).mode).toBe('khong-ve');
  });
});

describe('EditMap', () => {
  it('nhánh không vẽ thì KHÔNG tải maplibre-gl về', async () => {
    const load = vi.fn();
    const { container } = render(
      <EditMap detail={detail({ edit: { ...detail({}).edit, changes: { hours: {} } } })} loadMap={load} />,
    );
    expect(load).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('nhánh so sánh hiện số mét ngay cả trước khi bản đồ tải xong', () => {
    render(
      <EditMap
        detail={detail({
          edit: { ...detail({}).edit, changes: { lat: 10.7748, lng: 106.7031 } },
          poi_hien_tai: { lat: 10.7721, lng: 106.7012 } as never,
          distance_m: 340,
        })}
        loadMap={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText(/Lệch 340 m/)).toBeVisible();
  });
});
```

- [ ] **Step 3: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/edits/edit-map.test.tsx
```

Kỳ vọng: FAIL — không resolve được `./edit-map`.

- [ ] **Step 4: Viết `apps/admin/src/features/edits/edit-map.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import type { EditDetail, NearbyPoi } from './api';

export interface Point {
  lat: number;
  lng: number;
}

export type MapPlan =
  | { mode: 'khong-ve' }
  | { mode: 'mot-chot'; point: Point; nearby: NearbyPoi[] }
  | { mode: 'so-sanh'; before: Point; after: Point; distanceM: number | null };

/**
 * Bản đồ chỉ xuất hiện khi nó trả lời được câu hỏi người duyệt đang có:
 * - `update` đổi toạ độ → lệch bao xa, về hướng nào
 * - `create` → chỗ này đã có POI nào chưa (bắt trùng lặp)
 * - `close`/`reopen`/`report` → chỗ đó ở đâu
 * - `update` không đổi toạ độ → không câu hỏi nào cần bản đồ, nên không vẽ
 */
export function mapPlan(detail: EditDetail): MapPlan {
  const changes = detail.edit.changes;
  const movedLat = changes && typeof changes.lat === 'number' ? changes.lat : null;
  const movedLng = changes && typeof changes.lng === 'number' ? changes.lng : null;
  const current = detail.poi_hien_tai;

  if (movedLat !== null && movedLng !== null) {
    const after: Point = { lat: movedLat, lng: movedLng };
    if (detail.edit.kind === 'create' || !current) {
      return { mode: 'mot-chot', point: after, nearby: detail.nearby };
    }
    return {
      mode: 'so-sanh',
      before: { lat: current.lat, lng: current.lng },
      after,
      distanceM: detail.distance_m,
    };
  }

  if (current) return { mode: 'mot-chot', point: current, nearby: [] };
  return { mode: 'khong-ve' };
}

type LoadMap = (container: HTMLElement, plan: MapPlan) => Promise<void>;

/**
 * Nạp trễ maplibre-gl: nó nặng, mà phần lớn đóng góp không cần bản đồ. Danh sách không bao giờ
 * kéo theo nó, và nhánh `khong-ve` cũng không.
 */
const defaultLoadMap: LoadMap = async (container, plan) => {
  if (plan.mode === 'khong-ve') return;
  const maplibre = await import('maplibre-gl');
  await import('maplibre-gl/dist/maplibre-gl.css');

  const dark = document.documentElement.classList.contains('dark');
  const map = new maplibre.Map({
    container,
    style: dark ? '/v1/styles/dark.json' : '/v1/styles/light.json',
    attributionControl: { compact: true },
    center: plan.mode === 'so-sanh' ? [plan.after.lng, plan.after.lat] : [plan.point.lng, plan.point.lat],
    zoom: 15,
  });

  map.on('load', () => {
    if (plan.mode === 'mot-chot') {
      for (const poi of plan.nearby) {
        new maplibre.Marker({ color: '#98a2b3', scale: 0.7 })
          .setLngLat([poi.lng, poi.lat])
          .setPopup(new maplibre.Popup().setText(`${poi.name ?? poi.id} · ${poi.distance_m} m`))
          .addTo(map);
      }
      new maplibre.Marker({ color: '#1b3a6b' }).setLngLat([plan.point.lng, plan.point.lat]).addTo(map);
      return;
    }

    new maplibre.Marker({ color: '#98a2b3' }).setLngLat([plan.before.lng, plan.before.lat]).addTo(map);
    new maplibre.Marker({ color: '#1b3a6b' }).setLngLat([plan.after.lng, plan.after.lat]).addTo(map);
    map.addSource('duong-noi', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [plan.before.lng, plan.before.lat],
            [plan.after.lng, plan.after.lat],
          ],
        },
      },
    });
    map.addLayer({
      id: 'duong-noi',
      type: 'line',
      source: 'duong-noi',
      paint: { 'line-color': '#98a2b3', 'line-width': 2, 'line-dasharray': [2, 2] },
    });
    map.fitBounds(
      [
        [Math.min(plan.before.lng, plan.after.lng), Math.min(plan.before.lat, plan.after.lat)],
        [Math.max(plan.before.lng, plan.after.lng), Math.max(plan.before.lat, plan.after.lat)],
      ],
      { padding: 56, maxZoom: 17 },
    );
  });
};

interface EditMapProps {
  detail: EditDetail;
  loadMap?: LoadMap;
}

export function EditMap({ detail, loadMap = defaultLoadMap }: EditMapProps) {
  const plan = mapPlan(detail);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (plan.mode === 'khong-ve' || !ref.current) return;
    void loadMap(ref.current, plan);
  }, [detail.edit.id]);

  if (plan.mode === 'khong-ve') return null;

  return (
    <figure className="m-0">
      <div
        ref={ref}
        className="h-48 w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] sm:h-64"
      />
      <figcaption className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
        {plan.mode === 'so-sanh' ? (
          <>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#98a2b3]" /> vị trí cũ
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-700" /> vị trí mới
            </span>
            {plan.distanceM !== null && (
              <strong className="text-[var(--text)]">Lệch {plan.distanceM} m</strong>
            )}
          </>
        ) : (
          plan.nearby.length > 0 && <span>{plan.nearby.length} POI sẵn có trong bán kính 200 m</span>
        )}
      </figcaption>
    </figure>
  );
}
```

- [ ] **Step 5: Chạy test để xác nhận xanh**

```bash
pnpm exec vitest run apps/admin/src/features/edits/edit-map.test.tsx
```

Kỳ vọng: PASS, 7 test. Bài `nhánh không vẽ thì KHÔNG tải maplibre-gl về` là bài chứng minh cam kết nạp trễ.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/features/edits/edit-map.tsx apps/admin/src/features/edits/edit-map.test.tsx \
        apps/admin/package.json pnpm-lock.yaml
git commit -m "feat(admin): bản đồ so sánh vị trí cũ/mới, bốn nhánh theo loại đóng góp"
```

---

## Task 21: Màn chi tiết đóng góp

**Files:**
- Create: `apps/admin/src/features/edits/detail.tsx`
- Test: `apps/admin/src/features/edits/detail.test.tsx`

- [ ] **Step 1: Viết test thất bại**

`apps/admin/src/features/edits/detail.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditDetailPanel } from './detail';

const detailBody = {
  edit: {
    id: 7,
    poi_id: 'poi_1',
    poi_name: 'Cà phê Chiều Thứ Bảy',
    poi_status: 'active',
    poi_ward: 'Phường Bến Nghé',
    poi_province: 'TP.HCM',
    kind: 'update',
    changes: { street: 'Nguyễn Huệ' },
    photo_url: null,
    note: 'Đổi tên đường',
    status: 'pending',
    reviewer: null,
    created_at: new Date().toISOString(),
    tenant_id: 't1',
    distance_m: null,
  },
  poi_hien_tai: {
    id: 'poi_1',
    name: 'Cà phê Chiều Thứ Bảy',
    category: 'cafe',
    status: 'active',
    housenumber: '12',
    street: 'Lê Lợi',
    ward: 'Phường Bến Nghé',
    province: 'TP.HCM',
    address_text: '12 Lê Lợi',
    contact: null,
    hours: null,
    lat: 10.7721,
    lng: 106.7012,
  },
  distance_m: null,
  nearby: [],
};

const renderPanel = (id: number | null, onReview = vi.fn(), onClose = vi.fn()) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EditDetailPanel id={id} onClose={onClose} onReview={onReview} />
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('EditDetailPanel', () => {
  it('id = null → không dựng gì', () => {
    const { container } = renderPanel(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('tải xong → hiện tên, ghi chú và bảng so sánh trường', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(detailBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    renderPanel(7);
    expect(await screen.findByText('Cà phê Chiều Thứ Bảy')).toBeVisible();
    expect(screen.getByText('Đổi tên đường')).toBeVisible();
    expect(screen.getByText('Lê Lợi')).toBeVisible();
    expect(screen.getByText('Nguyễn Huệ')).toBeVisible();
  });

  it('bấm Duyệt gọi onReview rồi đóng', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(detailBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const onReview = vi.fn();
    renderPanel(7, onReview);
    await userEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    expect(onReview).toHaveBeenCalledWith(7, 'approve');
  });

  it('API lỗi → hiện mã lỗi thật', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'not_found', message: 'Không có' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    renderPanel(7);
    await waitFor(() => expect(screen.getByText(/not_found/)).toBeVisible());
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/edits/detail.test.tsx
```

Kỳ vọng: FAIL — không resolve được `./detail`.

- [ ] **Step 3: Viết `apps/admin/src/features/edits/detail.tsx`**

```tsx
import * as Dialog from '@radix-ui/react-dialog';
import { ErrorState, LoadingSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { editTitle, KIND_VI, relativeTime } from './edit-card';
import { EditMap } from './edit-map';
import { FieldDiff } from './field-diff';
import { useEditDetail } from './hooks';

interface EditDetailPanelProps {
  id: number | null;
  onClose: () => void;
  onReview: (id: number, action: 'approve' | 'reject') => void;
}

/**
 * Toàn màn hình trên điện thoại, ngăn bên phải từ 1024px. Dùng Radix Dialog để có sẵn giam tiêu
 * điểm và Esc; nội dung cuộn riêng, phần nút duyệt dính đáy để ngón cái luôn với tới.
 */
export function EditDetailPanel({ id, onClose, onReview }: EditDetailPanelProps) {
  const detail = useEditDetail(id);
  if (id === null) return null;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[30rem] lg:border-l lg:border-[var(--border)]">
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
            <Dialog.Title className="flex-1 text-base font-semibold">
              Chi tiết đóng góp #{id}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Đóng chi tiết">
                ✕
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {detail.isPending && <LoadingSkeleton rows={3} />}
            {detail.isError && (
              <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
            )}

            {detail.data && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={detail.data.edit.kind === 'create' ? 'brand' : 'neutral'}>
                    {KIND_VI[detail.data.edit.kind]}
                  </Badge>
                  {detail.data.distance_m !== null && (
                    <Badge tone="warning">Đổi vị trí · {detail.data.distance_m} m</Badge>
                  )}
                  <span className="ml-auto text-xs text-[var(--text-muted)]">
                    {relativeTime(detail.data.edit.created_at)}
                  </span>
                </div>

                <h2 className="text-lg font-semibold">{editTitle(detail.data.edit)}</h2>

                <EditMap detail={detail.data} />

                <FieldDiff changes={detail.data.edit.changes} poi={detail.data.poi_hien_tai} />

                {detail.data.edit.photo_url && (
                  <img
                    src={detail.data.edit.photo_url}
                    alt="Ảnh người gửi đính kèm"
                    className="w-full rounded-[var(--radius-card)] border border-[var(--border)]"
                  />
                )}

                {detail.data.edit.note && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                      Ghi chú người gửi
                    </p>
                    <p className="text-sm">{detail.data.edit.note}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {detail.data?.edit.status === 'pending' && (
            <div
              className="flex gap-2 border-t border-[var(--border)] px-4 py-3"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
            >
              <Button block onClick={() => onReview(id, 'approve')}>
                Duyệt
              </Button>
              <Button block variant="secondary" onClick={() => onReview(id, 'reject')}>
                Từ chối
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Chạy test và build**

```bash
pnpm exec vitest run apps/admin/src/features/edits/detail.test.tsx
pnpm --filter @mapslibvn/admin build
pnpm typecheck
pnpm lint
```

Kỳ vọng: 4 test PASS; build, typecheck, lint đều xanh.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/edits/detail.tsx apps/admin/src/features/edits/detail.test.tsx
git commit -m "feat(admin): màn chi tiết đóng góp — bản đồ, so sánh trường, ảnh, ghi chú"
```

---

## Task 22: Nối huy hiệu số việc chờ và mở rộng e2e

**Files:**
- Modify: `apps/admin/src/layout/app-shell.tsx`
- Modify: `apps/admin/e2e/admin.spec.ts`

- [ ] **Step 1: Nối huy hiệu vào AppShell**

Trong `apps/admin/src/layout/app-shell.tsx`, đổi chữ ký và bỏ prop truyền tay:

```tsx
import { usePendingCount } from '@/features/edits/hooks';
```

rồi thay `export function AppShell({ pendingCount }: { pendingCount?: number })` bằng:

```tsx
export function AppShell() {
  const { data: me } = useMe();
  const { data: count } = usePendingCount();
  const pendingCount = count?.pending;
  const { pathname } = useLocation();
```

Phần còn lại của component giữ nguyên.

- [ ] **Step 2: Thêm ba kịch bản e2e**

Thêm vào cuối `apps/admin/e2e/admin.spec.ts`:

```ts
test('huỷ trong 5 giây: đóng góp vẫn ở hàng chờ, POI chưa active', async ({ page, request }) => {
  const name = `Quán E2E Huỷ ${Date.now()}`;
  const created = await (
    await request.post('/v1/edits', {
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      data: {
        kind: 'create',
        changes: { name, lat: 10.7705, lng: 106.7045, category: 'cafe' },
        end_user_token: 'e2e-huy',
      },
    })
  ).json();

  await page.goto('/admin/edits');
  const card = page.getByText(name).locator('xpath=ancestor::*[self::article or self::div][1]');
  await expect(card).toBeVisible();

  await page.getByRole('button', { name: 'Duyệt' }).first().click();
  await page.getByRole('button', { name: 'Huỷ' }).click();
  await page.waitForTimeout(6000);

  // POI vẫn chưa được tạo/kích hoạt vì request duyệt chưa bao giờ được gửi.
  const place = await request.get(`/v1/places/${created.poi_id}`, {
    headers: { 'X-Api-Key': FREE_KEY },
  });
  expect(place.status()).toBe(404);
});

test('màn hình hẹp: điều hướng bằng nút hamburger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/edits');
  await page.getByRole('button', { name: 'Mở menu điều hướng' }).click();
  await expect(page.getByRole('link', { name: /Duyệt đóng góp/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: /Duyệt đóng góp/ })).toBeHidden();
});

test('chi tiết đóng góp đổi toạ độ hiện khoảng cách lệch', async ({ page, request }) => {
  const name = `Quán E2E Dời ${Date.now()}`;
  const created = await (
    await request.post('/v1/edits', {
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      data: {
        kind: 'create',
        changes: { name, lat: 10.769, lng: 106.706, category: 'cafe' },
        end_user_token: 'e2e-doi-seed',
      },
    })
  ).json();
  await request.post(`/v1/admin/edits/${created.edit_id}/approve`, {
    headers: { 'Cf-Access-Jwt-Assertion': ACCESS_JWT },
  });
  await request.post('/v1/edits', {
    headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
    data: {
      kind: 'update',
      poi_id: created.poi_id,
      changes: { lat: 10.772, lng: 106.709 },
      end_user_token: 'e2e-doi-move',
    },
  });

  await page.goto('/admin/edits');
  await expect(page.getByText(/Đổi vị trí · \d+ m/).first()).toBeVisible();
  await page.getByText(name).first().click();
  await expect(page.getByText(/Lệch \d+ m/)).toBeVisible();
});
```

- [ ] **Step 3: Sửa ba test cũ cho khớp đường dẫn mới**

Trong hai test cũ, đổi `await page.goto('/admin/')` thành `await page.goto('/admin/edits')` và đổi khẳng định tiêu đề:

```ts
  await expect(page.getByRole('heading', { name: 'Duyệt đóng góp POI' })).toBeVisible();
```

thành

```ts
  await expect(page).toHaveTitle(/Admin Page/);
```

Lý do: tiêu đề "Duyệt đóng góp POI" giờ nằm ở thanh trên chứ không còn là `heading` cấp trang.

- [ ] **Step 4: Chạy e2e**

```bash
pnpm db:up
pnpm test:admin-e2e
```

Kỳ vọng: 6 test PASS (3 cũ đã sửa + 3 mới).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/layout/app-shell.tsx apps/admin/e2e/admin.spec.ts
git commit -m "test(admin): e2e huỷ trong 5 giây, điều hướng hamburger, khoảng cách lệch"
```

---

## Task 23: Gỡ trang cũ và danh sách kiểm khi đưa lên production

**Files:**
- Delete: `apps/admin/src/app.tsx`
- Delete: `apps/admin/src/api.ts`

- [ ] **Step 1: Xác nhận không còn ai tham chiếu hai file cũ**

```bash
cd /Users/dtphong/Desktop/software_business/mapsLibVN
grep -rn "from './app'\|from './api'\|src/app\|src/api" apps/admin/src apps/admin/e2e
```

Kỳ vọng: không có kết quả nào. Nếu còn, sửa nơi tham chiếu sang `@/features/edits/api` trước.

- [ ] **Step 2: Xoá hai file cũ**

```bash
git rm apps/admin/src/app.tsx apps/admin/src/api.ts
```

- [ ] **Step 3: Viết `apps/admin/README.md`**

Máy dev không có Cloudflare Access nên `ACCESS_TEAM_DOMAIN` trống và mọi route admin trả 401 — người tiếp theo cần biết điều này trước khi mất một buổi tìm lỗi.

````markdown
# Admin Page

Trang quản trị MapsLibVN. SPA tĩnh, build ra `dist/admin`, do Worker API phục vụ tại `/admin/`
và bảo vệ bằng Cloudflare Access.

## Chạy tại máy

**Không dùng `wrangler dev` trần**: không có Access nên `ACCESS_TEAM_DOMAIN` trống, mọi route
`/v1/admin/*` sẽ trả 401 và trang trắng trơn. Dùng harness có JWKS giả:

```bash
pnpm db:up
node scripts/api-db-test.mjs --serve   # dựng DB cô lập + wrangler dev :8799 + Access giả
```

Rồi mở http://127.0.0.1:8799/admin/

Muốn sửa giao diện có nạp nóng thì chạy thêm `pnpm --filter @mapslibvn/admin dev` ở cửa sổ khác,
nhưng các lời gọi API vẫn phải trỏ về cổng 8799.

## Địa chỉ

| Môi trường | Địa chỉ |
|---|---|
| Production | https://api.ai-solutions.io.vn/admin/ |
| Harness | http://127.0.0.1:8799/admin/ |

## Kiểm thử

```bash
pnpm exec vitest run apps/admin        # component
pnpm test:admin-e2e                    # Playwright, tự dựng harness
```
````

- [ ] **Step 4: Chạy trọn bộ kiểm tra**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:api-db
pnpm test:admin-e2e
```

Kỳ vọng: tất cả xanh. Lưu ý `pnpm test` có chạy `pnpm --filter @mapslibvn/admin build`, nên build hỏng sẽ chặn cả bộ.

- [ ] **Step 5: Commit**

```bash
git add -A apps/admin
git commit -m "refactor(admin): gỡ trang duyệt cũ sau khi Admin Page thay thế hoàn toàn"
```

- [ ] **Step 6: Đưa lên production — đúng thứ tự này**

Migration phải chạy **trước** khi deploy Worker. Deploy trước migration đã từng làm chết API.

```bash
# 1. Chạy migration trên máy chủ production
pnpm server:migrate

# 2. Xác nhận schema đã sang bản mới TRƯỚC khi deploy
curl -s https://api.ai-solutions.io.vn/healthz/db | grep 0017_admin_audit

# 3. Deploy Worker (lệnh này build cả apps/admin)
pnpm deploy:api
```

Kỳ vọng ở bước 2: chuỗi `0017_admin_audit` xuất hiện. Nếu không thấy, **dừng lại** — deploy lúc này sẽ làm mọi route admin trả 503 vì bảng `admin_audit` chưa tồn tại.

- [ ] **Step 7: Kiểm tra bằng tay trên production**

Danh sách này cần một điện thoại thật và một cửa sổ ẩn danh:

1. Mở `https://api.ai-solutions.io.vn/admin/` ở cửa sổ ẩn danh → phải bị đưa về màn đăng nhập Access. Nếu vào thẳng được, **policy Access đang hở** và cần sửa trên dashboard Zero Trust.
2. Gọi `curl -s -o /dev/null -w '%{http_code}' https://api.ai-solutions.io.vn/v1/admin/edits` → phải trả `401`.
3. Trên điện thoại: mở trang, bấm ☰, chuyển mục, đóng bằng cách chạm nền.
4. Duyệt một đóng góp rồi bấm Huỷ trong 5 giây → bản ghi phải còn nguyên trong hàng chờ.
5. Mở một đóng góp `update` có đổi toạ độ → thấy hai chốt, đường nối và số mét.
6. Bật/tắt nền tối → bản đồ đổi theo.
7. Bấm email ở góc trên → `/cdn-cgi/access/logout` đưa về màn đăng nhập.

---

## Sau plan này

Pha 2–6 mỗi pha một plan riêng, dựa trên cùng spec: Tenant & khoá API · Gói cước & hạn mức · Nhật ký kiểm toán (phần đọc) · Sức khoẻ hệ thống · Tổng quan. Khung, `DataView`, `delayed-action`, năm trạng thái và nhật ký đã dựng xong ở đây nên các pha sau chỉ còn là lặp lại khuôn.
