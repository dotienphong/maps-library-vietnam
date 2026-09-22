# Giao diện mới — Pha 0: nền tảng token, chữ, sáng/tối — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay bộ token navy bằng bảng màu đen + xanh chanh của spec `2026-09-22-thiet-ke-lai-giao-dien-design.md` (mục 4), gỡ hết lớp `brand-*` khỏi bốn app, thêm nét 800 và JetBrains Mono, thang cỡ chữ, và làm website tối mặc định — **mà không đổi bố cục trang nào**. Kết thúc pha 0, site cũ chạy trên màu mới, mọi cổng kiểm xanh.

**Architecture:** Token ngữ nghĩa (`--bg`, `--surface`, `--accent`, …) khai ở `:root` (sáng) và `.dark` (tối) trong `packages/ui/src/tokens.css`, phơi ra Tailwind bằng `@theme inline` để utility `bg-accent`, `text-muted` đọc đúng giá trị của theme đang bật. Bốn app chỉ dùng token, không còn `brand-*`. `theme.ts` nhận mặc định theo app; website mặc định tối bằng script inline trong `<head>`.

**Tech Stack:** Tailwind v4 (`@theme inline`), Astro 7, React 19 (ui/admin/console), vitest 5, Playwright, biome, `@fontsource/be-vietnam-pro`, `@fontsource/jetbrains-mono`.

**Nhánh:** `feat/giao-dien-moi` tách từ `main` (HEAD `89c9fb7` hoặc mới hơn). Mọi task commit lên nhánh này; không push cho tới cuối pha.

**Lệnh chạy từ gốc repo** (`/Users/dtphong/Desktop/software_business/mapsLibVN`) trừ khi ghi khác. macOS không có `timeout`. Typecheck luôn kèm `--force` vì Turbo cache từng trả xanh giả.

**Khác spec, có lý do:**
- Bài kiểm tương phản đặt ở `packages/ui/src/tokens.test.ts` (cạnh tệp nó kiểm) thay vì `apps/site/src/lib`.
- `theme-color` dùng **một** thẻ `<meta>` và được script đổi theo class `.dark`, thay vì hai thẻ `media=` (hai thẻ theo hệ điều hành, mà site giờ tối mặc định bất kể hệ điều hành).

---

## Tệp đụng tới

| Tệp | Việc |
|---|---|
| `packages/ui/src/tokens.css` | Viết lại: token ngữ nghĩa sáng/tối + `@theme inline` + bo góc |
| `packages/ui/src/tokens.test.ts` | Mới: tính tương phản WCAG từ chính tệp CSS |
| `packages/ui/src/button.tsx`, `badge.tsx`, `card.tsx` | Bỏ `brand-*` |
| `packages/ui/src/theme.ts`, `theme.test.ts` | `readStoredTheme(key, macDinh)` |
| `apps/admin/src/layout/topbar.tsx`, `sidebar-nav.tsx`, `not-found.tsx`, `features/edits/page.tsx`, `features/edits/edit-map.tsx`, `features/billing/usage-panel.tsx`, `apps/admin/index.html` | Bỏ `brand-*`, `theme-color` |
| `apps/console/src/layout/app-shell.tsx`, `features/auth/dang-nhap.tsx`, `features/tong-quan/thanh-han-muc.tsx`, `features/tong-quan/page.tsx`, `features/sap-mo/page.tsx`, `features/don-hang/chi-tiet.tsx`, `features/don-hang/page.tsx`, `features/mua/the-goi.tsx`, `features/mua/page.tsx`, `features/khoa/khoa-mot-lan.tsx`, `apps/console/index.html` | Bỏ `brand-*`, `theme-color` |
| `apps/site/src/**/*.astro` | Thay `brand-*` bằng token (script một lần, không commit script) |
| `apps/site/package.json` | Thêm `@fontsource/jetbrains-mono` |
| `apps/site/src/styles/global.css` | Font 800 + mono, `--font-mono`, thang cỡ chữ `.t-*` |
| `apps/site/src/layouts/Base.astro` | Tối mặc định |
| `apps/site/src/components/SeoHead.astro` | `theme-color`, preload font 800 |
| `apps/site/src/components/Header.astro` | Công tắc đổi cả `theme-color` |
| `apps/site/e2e/trang.spec.ts` | Bài "tối mặc định", bài "không còn brand-" |
| `docs/DEVLOG.md` | Mục pha 0 |

---

### Task 1: Tạo nhánh

**Files:** không

- [ ] **Step 1: Tách nhánh từ main sạch**

```bash
git status --short          # phải trống
git checkout -b feat/giao-dien-moi
```

Expected: `Switched to a new branch 'feat/giao-dien-moi'`.

---

### Task 2: Token mới + bài kiểm tương phản

**Files:**
- Create: `packages/ui/src/tokens.test.ts`
- Modify: `packages/ui/src/tokens.css`

- [ ] **Step 1: Viết bài kiểm tương phản (đỏ trước)**

Tạo `packages/ui/src/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Đọc CHÍNH tệp tokens.css thay vì chép mã màu vào test: đổi màu là phải qua bài này.
 * Chỉ tính token dạng #rrggbb; token rgba (accent-soft) là nền mờ, không dùng làm chữ.
 *
 * Gói này là ESM (`"type": "module"`) nên KHÔNG có `__dirname`; dùng `import.meta.url`.
 */
const CSS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function khoi(selector: string): Record<string, string> {
  const bat = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
  const than = CSS.match(bat)?.[1];
  if (!than) throw new Error(`Không thấy khối ${selector} trong tokens.css`);
  const ra: Record<string, string> = {};
  for (const dong of than.split('\n')) {
    const m = dong.match(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/i);
    if (m?.[1] && m[2]) ra[m[1]] = m[2].toLowerCase();
  }
  return ra;
}

function doSang(hex: string): number {
  const kenh = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = kenh.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** Tỉ lệ tương phản WCAG 2.1, làm tròn một chữ số. */
function tuongPhan(a: string, b: string): number {
  const [s = 0, t = 0] = [doSang(a), doSang(b)].sort((x, y) => y - x);
  return Math.round(((s + 0.05) / (t + 0.05)) * 10) / 10;
}

/** Cặp [chữ, nền, ngưỡng]. 4.5 = chữ thường; 3 = chữ ≥ 24 px hoặc thành phần giao diện. */
const CAP: readonly [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-2', 4.5],
  ['text-muted', 'bg', 4.5],
  ['text-muted', 'surface-2', 4.5],
  ['text-faint', 'bg', 3],
  // KHÔNG kiểm `accent` trên `bg`: accent là màu NỀN, không bao giờ làm chữ hay nét. Thứ đặt
  // trên nó là accent-ink (cặp ngay dưới); còn viền và nét nhấn dùng accent-text.
  ['accent-ink', 'accent', 4.5],
  ['accent-text', 'bg', 4.5],
  ['accent-text', 'surface', 4.5],
  ['focus', 'bg', 3],
  ['border-strong', 'bg', 1.5],
];

describe('tokens.css', () => {
  it('không còn token brand-*', () => {
    expect(CSS).not.toMatch(/brand-/);
  });

  for (const theme of [':root', '.dark']) {
    describe(theme, () => {
      const t = khoi(theme);

      it('đủ 12 token màu dạng #rrggbb (accent-soft là rgba, kiểm riêng)', () => {
        for (const ten of [
          'bg', 'surface', 'surface-2', 'border', 'border-strong', 'text', 'text-muted',
          'text-faint', 'accent', 'accent-ink', 'accent-text', 'focus',
        ]) {
          expect(t[ten], ten).toMatch(/^#[0-9a-f]{6}$/);
        }
      });

      for (const [chu, nen, nguong] of CAP) {
        it(`${chu} trên ${nen} ≥ ${nguong}:1`, () => {
          expect(tuongPhan(t[chu] ?? '#000000', t[nen] ?? '#000000'), `${t[chu]} trên ${t[nen]}`).toBeGreaterThanOrEqual(nguong);
        });
      }
    });
  }

  it('bản sáng không dùng xanh chanh làm chữ', () => {
    const sang = khoi(':root');
    expect(sang['accent-text']).not.toBe(sang.accent);
  });

  it('phơi token ra Tailwind bằng @theme inline (không phải @theme thường)', () => {
    // @theme thường tính var() tại :root nên .dark không đổi được màu utility.
    expect(CSS).toMatch(/@theme inline\s*\{[^}]*--color-accent:\s*var\(--accent\)/);
    expect(CSS).toMatch(/--color-bg:\s*var\(--bg\)/);
    expect(CSS).toMatch(/--color-muted:\s*var\(--text-muted\)/);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

```bash
pnpm exec vitest run packages/ui/src/tokens.test.ts
```

Expected: FAIL — "không còn token brand-*" đỏ, "đủ 12 token màu…" đỏ vì thiếu `surface-2`, `accent`…

- [ ] **Step 3: Viết lại tokens.css**

Ghi đè `packages/ui/src/tokens.css`:

```css
/* Token dùng chung cho Admin, console và website: một bảng màu, một bộ bo góc.
   Import SAU `@import "tailwindcss"` trong CSS gốc của từng app, bằng đường dẫn tương đối
   (../../../packages/ui/src/tokens.css). Tailwind v4 gộp file này vào trước khi xử lý.

   Bảng màu theo spec 2026-09-22 mục 4.1: một màu nhấn xanh chanh, thang xám trung tính. Tỉ lệ
   tương phản của từng cặp được khoá bằng tokens.test.ts — đổi màu là phải qua bài đó.

   `:root` là bản SÁNG, `.dark` là bản TỐI. App nào tối mặc định thì tự gắn class `dark` sớm
   (site: script inline trong <head>; console: theme.ts với mặc định 'dark'). */

:root {
  --bg: #fafafa;
  --surface: #ffffff;
  --surface-2: #f4f4f5;
  --border: #e4e4e7;
  /* Viền khi hover: phải thấy rõ hơn --border, nếu không hover là vô nghĩa.
     #d4d4d8 chỉ đạt 1,4:1 trên nền sáng — mắt gần như không phân biệt được. */
  --border-strong: #a1a1aa;
  --text: #0a0a0a;
  --text-muted: #52525b;
  /* Chỉ cho chữ ≥ 24 px, ≥ 19 px in đậm, hoặc phần trang trí. 4,1:1 trên nền tối. */
  --text-faint: #71717a;
  /* CHỈ dùng làm NỀN (nút chính, chip), luôn đi kèm chữ --accent-ink. Trên nền sáng nó chỉ đạt
     1,4:1 nên không được dùng cho chữ, viền hay nét vẽ — những thứ đó dùng --accent-text. */
  --accent: #a3e635;
  /* Chữ đặt TRÊN nền --accent. */
  --accent-ink: #0a0a0a;
  /* Link, chữ nhấn, VIỀN nhấn và nét vẽ trên nền thường. Bản tối trùng --accent; bản sáng phải
     đậm hơn hẳn để đạt ngưỡng đọc được. */
  --accent-text: #3f6212;
  --accent-soft: rgba(163, 230, 53, 0.18);
  --focus: #3f6212;
}

.dark {
  --bg: #0a0a0a;
  --surface: #111113;
  --surface-2: #18181b;
  --border: #27272a;
  --border-strong: #3f3f46;
  --text: #fafafa;
  --text-muted: #a1a1aa;
  --text-faint: #71717a;
  --accent: #a3e635;
  --accent-ink: #0a0a0a;
  --accent-text: #a3e635;
  --accent-soft: rgba(163, 230, 53, 0.1);
  --focus: #a3e635;
}

/* `inline` là bắt buộc: với @theme thường, `--color-bg: var(--bg)` được tính MỘT lần tại :root
   (giá trị sáng) rồi kế thừa xuống, nên `.dark` không đổi được utility. `inline` làm utility ghi
   thẳng `var(--bg)` và giải tại phần tử, nơi `.dark` đã ghi đè. */
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-text: var(--text);
  --color-muted: var(--text-muted);
  --color-faint: var(--text-faint);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-accent-text: var(--accent-text);
  --color-accent-soft: var(--accent-soft);
  --color-focus: var(--focus);
}

@theme {
  --radius-card: 12px;
  --radius-btn: 8px;
  --radius-sheet: 16px;
}
```

- [ ] **Step 4: Chạy lại, xác nhận xanh**

```bash
pnpm exec vitest run packages/ui/src/tokens.test.ts
```

Expected: PASS 27 test: mỗi theme 1 bài đủ token + 11 cặp tương phản (24), cộng 3 bài chung.

Thêm một bước xác nhận `@theme inline` thật sự có tác dụng (nếu không, `.dark` sẽ không đổi được
màu utility mà không có lỗi nào):

```bash
pnpm --filter @mapslibvn/site build >/dev/null
CSS=$(ls apps/site/dist/_astro/*.css | head -1)
grep -c -- "--color-accent:" "$CSS"      # PHẢI là 0 — inline nghĩa là không phát biến ra :root
grep -c -- "--radius-btn:8px" "$CSS"      # PHẢI ≥ 1 — @theme thường vẫn phát, chứng tỏ tệp được đọc
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/tokens.css packages/ui/src/tokens.test.ts
git commit -m "feat(ui): bảng màu đen + xanh chanh, token ngữ nghĩa phơi qua @theme inline, test tương phản WCAG"
```

---

### Task 3: Gỡ `brand-*` trong `packages/ui`

**Files:**
- Modify: `packages/ui/src/button.tsx`, `packages/ui/src/badge.tsx`, `packages/ui/src/card.tsx`
- Test: `packages/ui/src/button.test.tsx` (thêm 1 bài)

- [ ] **Step 1: Thêm bài kiểm nút chính không còn brand và có chữ mực trên nền nhấn**

Thêm vào cuối `describe('Button', …)` trong `packages/ui/src/button.test.tsx`:

```tsx
  it('nút chính dùng token nhấn: nền accent, chữ accent-ink, không còn lớp brand-', () => {
    render(<Button>Duyệt</Button>);
    const lop = screen.getByRole('button').className;
    expect(lop).toContain('bg-accent');
    expect(lop).toContain('text-accent-ink');
    expect(lop).not.toMatch(/brand-/);
    expect(lop).not.toContain('text-white');
  });
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

```bash
pnpm exec vitest run packages/ui/src/button.test.tsx
```

Expected: FAIL ở bài mới (`bg-brand-700 text-white` còn).

- [ ] **Step 3: Sửa button.tsx**

Thay khối `cva(...)` trong `packages/ui/src/button.tsx`:

```tsx
// min-h-11 = 44px: ngưỡng vùng chạm tối thiểu trên điện thoại, áp cho mọi biến thể.
const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-btn)] px-4 text-sm font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
  {
    variants: {
      variant: {
        // Chữ mực trên nền xanh chanh: 13:1. Hover tối nhẹ bằng brightness để không cần token thứ hai.
        primary: 'bg-accent text-accent-ink hover:brightness-95',
        secondary:
          'border border-border bg-surface text-text hover:border-border-strong hover:bg-accent-soft',
        ghost: 'text-muted hover:bg-accent-soft hover:text-text',
        danger: 'bg-red-600 text-white hover:bg-red-700',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', block: false },
  },
);
```

- [ ] **Step 4: Sửa badge.tsx**

Trong `packages/ui/src/badge.tsx`, thay dòng `brand:`:

```tsx
        brand: 'bg-accent-soft text-accent-text',
```

- [ ] **Step 5: Sửa card.tsx**

Trong `packages/ui/src/card.tsx`, thay hai dòng có `border-brand-500`:

```tsx
          'hover:-translate-y-0.5 hover:border-accent hover:shadow-lg',
```

```tsx
          'has-[:focus-visible]:-translate-y-0.5 has-[:focus-visible]:border-accent has-[:focus-visible]:shadow-lg',
```

- [ ] **Step 6: Kiểm không còn brand trong gói, test xanh**

```bash
# Loại tệp test: chúng CHỨA chuỗi "brand-" như dữ liệu khẳng định, không phải lớp CSS.
grep -rn "brand-" packages/ui/src --include='*.tsx' --include='*.ts' --include='*.css' | grep -v "\.test\." ; echo "exit=$?"
pnpm exec vitest run packages/ui
```

Expected: grep không in dòng nào (`exit=1`); vitest PASS toàn bộ.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src
git commit -m "refactor(ui): nút, badge, card dùng token nhấn thay brand-*"
```

---

### Task 4: `readStoredTheme` nhận mặc định theo app

**Files:**
- Modify: `packages/ui/src/theme.ts`
- Test: `packages/ui/src/theme.test.ts`

- [ ] **Step 1: Thêm hai bài kiểm (đỏ trước)**

Thêm vào `describe('theme', …)` trong `packages/ui/src/theme.test.ts`:

```ts
  it('chưa chọn gì mà app đặt mặc định "dark" → trả "dark"', () => {
    expect(readStoredTheme(KEY, 'dark')).toBe('dark');
  });

  it('đã chọn "light" thì lựa chọn thắng mặc định của app', () => {
    localStorage.setItem(KEY, 'light');
    expect(readStoredTheme(KEY, 'dark')).toBe('light');
  });
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

```bash
pnpm exec vitest run packages/ui/src/theme.test.ts
```

Expected: FAIL — "Expected 1 arguments, but got 2" lúc typecheck của vitest, hoặc bài 1 trả `'system'`.

- [ ] **Step 3: Sửa theme.ts**

Thay hàm `readStoredTheme` trong `packages/ui/src/theme.ts`:

```ts
/**
 * `storageKey` do app truyền — admin và console chạy cùng origin nên chia sẻ một localStorage; dùng
 * chung khoá thì đổi theme bên này kéo bên kia theo.
 *
 * `macDinh` là lựa chọn khi người dùng CHƯA chọn gì: console truyền 'dark' (spec 22/09 mục 4.5),
 * admin để mặc định 'system'. Lựa chọn đã lưu luôn thắng.
 */
export function readStoredTheme(storageKey: string, macDinh: ThemeChoice = 'system'): ThemeChoice {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư) — coi như chưa chọn.
  }
  return macDinh;
}
```

- [ ] **Step 4: Chạy lại, xanh**

```bash
pnpm exec vitest run packages/ui/src/theme.test.ts
```

Expected: PASS 7 test.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/theme.ts packages/ui/src/theme.test.ts
git commit -m "feat(ui): readStoredTheme nhận mặc định theo app"
```

---

### Task 5: Gỡ `brand-*` trong Admin (chỉ màu nhấn, không đổi theme)

**Files:**
- Modify: `apps/admin/src/layout/topbar.tsx:18`, `apps/admin/src/layout/sidebar-nav.tsx:75`, `apps/admin/src/layout/not-found.tsx:28`, `apps/admin/src/features/edits/page.tsx:71`, `apps/admin/src/features/edits/edit-map.tsx:125`, `apps/admin/src/features/billing/usage-panel.tsx:90`, `apps/admin/index.html:9`

- [ ] **Step 1: Sửa từng dòng**

`topbar.tsx` dòng 18 — thanh trên đổi từ navy đặc sang nền trung tính có viền; xanh chanh để dành cho nút hành động:

```tsx
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface-2 px-3 py-2 text-text">
```

`sidebar-nav.tsx` dòng 75:

```tsx
                        ? 'bg-accent-soft font-semibold text-accent-text'
```

`not-found.tsx` dòng 28:

```tsx
        className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-accent px-4 text-[15px] font-semibold text-accent-ink"
```

`features/edits/page.tsx` dòng 71:

```tsx
                ? 'min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink'
```

`features/edits/edit-map.tsx` dòng 125:

```tsx
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" /> vị trí mới
```

`features/billing/usage-panel.tsx` dòng 90:

```tsx
  ok: 'bg-accent',
```

`apps/admin/index.html` dòng 9:

```html
    <meta name="theme-color" content="#fafafa" />
```

- [ ] **Step 2: Kiểm sạch, build, test**

```bash
grep -rn "brand-" apps/admin/src apps/admin/index.html | grep -v "\.test\." ; echo "exit=$?"
pnpm --filter @mapslibvn/admin build
pnpm exec vitest run apps/admin
```

Expected: grep `exit=1`; build xong không lỗi; vitest PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin
git commit -m "refactor(admin): dùng token nhấn thay brand-*, thanh trên nền trung tính"
```

---

### Task 6: Gỡ `brand-*` trong Console (chưa đổi mặc định theme — việc của pha 3)

**Files:**
- Modify: `apps/console/src/layout/app-shell.tsx:40-48`, `apps/console/src/features/auth/dang-nhap.tsx:76`, `apps/console/src/features/tong-quan/thanh-han-muc.tsx:24`, `apps/console/src/features/tong-quan/page.tsx:60`, `apps/console/src/features/sap-mo/page.tsx:19`, `apps/console/src/features/don-hang/chi-tiet.tsx:92,111,182`, `apps/console/src/features/don-hang/page.tsx:25,44`, `apps/console/src/features/mua/the-goi.tsx:31`, `apps/console/src/features/mua/page.tsx:29`, `apps/console/src/features/khoa/khoa-mot-lan.tsx:38`, `apps/console/index.html:9`

- [ ] **Step 1: Sửa từng dòng**

`app-shell.tsx` dòng 40–41:

```tsx
        ? 'bg-accent-soft text-accent-text'
        : 'text-muted hover:bg-accent-soft'
```

`app-shell.tsx` dòng 48:

```tsx
          <Link to="/" className="text-base font-bold text-accent-text">
```

`auth/dang-nhap.tsx` dòng 76 — trong chuỗi `className` của nút Google, thay `hover:bg-brand-50 dark:hover:bg-brand-900` bằng:

```
hover:bg-accent-soft
```

`tong-quan/thanh-han-muc.tsx` dòng 24:

```tsx
        : 'bg-accent';
```

`tong-quan/page.tsx` dòng 60, `sap-mo/page.tsx` dòng 19, `don-hang/chi-tiet.tsx` dòng 111 và 182, `don-hang/page.tsx` dòng 25 — mỗi chỗ thay cụm `bg-brand-700 … text-white` trong `className` thành `bg-accent … text-accent-ink`, giữ nguyên các lớp khác. Ví dụ `tong-quan/page.tsx`:

```tsx
          className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-accent px-5 font-semibold text-accent-ink"
```

`don-hang/chi-tiet.tsx` dòng 92:

```tsx
            <p className="rounded-[var(--radius-btn)] bg-accent-soft p-3 text-sm">
```

`don-hang/page.tsx` dòng 44 — thay `hover:border-brand-700` bằng `hover:border-accent`.

`mua/the-goi.tsx` dòng 31:

```tsx
        daChon ? 'border-accent ring-2 ring-accent/30' : 'border-[var(--border)]',
```

`mua/page.tsx` dòng 29:

```tsx
    dang ? 'bg-accent text-accent-ink' : 'border border-[var(--border)]'
```

`khoa/khoa-mot-lan.tsx` dòng 38 — thay `border-brand-700` bằng `border-accent`.

`apps/console/index.html` dòng 9:

```html
    <meta name="theme-color" content="#fafafa" />
```

(Pha 3 mới đổi mặc định tối cho console, lúc đó đổi `theme-color` theo.)

- [ ] **Step 2: Kiểm sạch, build, test**

```bash
grep -rn "brand-" apps/console/src apps/console/index.html | grep -v "\.test\." ; echo "exit=$?"
pnpm --filter @mapslibvn/console build
pnpm exec vitest run apps/console
```

Expected: grep `exit=1`; build không lỗi; vitest PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/console
git commit -m "refactor(console): dùng token nhấn thay brand-*"
```

---

### Task 7: Gỡ `brand-*` trong website bằng ánh xạ cơ học

Website sẽ được viết lại ở pha 1; ở đây chỉ đổi lớp để site không vỡ màu giữa hai pha và để bài e2e "không còn brand-" có chỗ đứng.

**Files:**
- Modify: mọi `apps/site/src/**/*.astro` có `brand-`
- Test: `apps/site/e2e/trang.spec.ts` (thêm 1 bài)

- [ ] **Step 1: Thêm bài e2e (đỏ trước)**

Thêm vào cuối `apps/site/e2e/trang.spec.ts`:

```ts
test('không còn lớp brand- nào trên bảy trang', async ({ page }) => {
  for (const path of TRANG) {
    await page.goto(path);
    const con = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="brand-"]')].map((el) => el.className),
    );
    expect(con, `còn brand- ở ${path}`).toEqual([]);
  }
});
```

- [ ] **Step 2: Chạy bài đó, xác nhận đỏ**

```bash
cd apps/site && pnpm exec playwright test -g "không còn lớp brand" ; cd ../..
```

Expected: FAIL, in ra các className còn `brand-`.

- [ ] **Step 3: Chạy script ánh xạ một lần (KHÔNG commit script)**

Tạo tạm `/tmp/mlv-brand.py` với nội dung sau rồi chạy `python3 /tmp/mlv-brand.py`:

```python
import pathlib, re
GOC = pathlib.Path('apps/site/src')
# Thứ tự QUAN TRỌNG: cụm dài trước, đơn lẻ sau. Cụm dark:* đi kèm bị bỏ vì token đã tự đổi theo theme.
CAP = [
  ('has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700 dark:has-[:checked]:bg-brand-900 dark:has-[:checked]:text-brand-100',
   'has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-text'),
  ('aria-selected:bg-brand-50 aria-selected:text-brand-700 dark:aria-selected:bg-brand-900 dark:aria-selected:text-brand-100',
   'aria-selected:bg-accent-soft aria-selected:text-accent-text'),
  ('aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700 dark:hover:bg-brand-900 dark:hover:text-brand-100 dark:aria-[current=page]:bg-brand-900 dark:aria-[current=page]:text-brand-100',
   'aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-text'),
  ('aria-[current=page]:text-brand-700 dark:hover:bg-brand-900 dark:hover:text-brand-100 dark:aria-[current=page]:text-brand-100',
   'aria-[current=page]:text-accent-text'),
  ('hover:bg-brand-50 hover:text-brand-700', 'hover:bg-accent-soft hover:text-accent-text'),
  ('hover:bg-brand-50 dark:hover:bg-brand-900', 'hover:bg-accent-soft'),
  ('hover:text-brand-700 dark:hover:text-brand-100', 'hover:text-accent-text'),
  ('text-brand-700 hover:underline dark:text-brand-100', 'text-accent-text hover:underline'),
  ('text-brand-700 dark:text-brand-100', 'text-accent-text'),
  ('bg-brand-50 text-xl dark:bg-brand-900', 'bg-accent-soft text-xl'),
  ('bg-brand-50 dark:bg-brand-900', 'bg-surface-2'),
  ('focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-white', 'focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink'),
  ('bg-brand-700 text-white hover:bg-brand-800', 'bg-accent text-accent-ink hover:brightness-95'),
  ('hover:bg-brand-800', 'hover:brightness-95'),
  ('border-brand-700 shadow-lg', 'border-accent'),
  ('border-brand-700', 'border-accent'),
  ('bg-brand-700', 'bg-accent'),
  ('text-brand-700', 'text-accent-text'),
  ('dark:hover:bg-brand-900', ''),
  ('dark:bg-brand-900', ''),
  ('dark:text-brand-100', ''),
  ('hover:bg-brand-50', 'hover:bg-accent-soft'),
  ('bg-brand-50', 'bg-accent-soft'),
]
for f in GOC.rglob('*.astro'):
    s = f.read_text(); goc = s
    for cu, moi in CAP: s = s.replace(cu, moi)
    # Nút đã đổi sang bg-accent mà còn text-white trong cùng thuộc tính class → chữ mực.
    s = re.sub(r'(bg-accent[^"\'`\n]*?)text-white', r'\1text-accent-ink', s)
    if s != goc: f.write_text(s); print('đã sửa', f)
con = [str(f) for f in GOC.rglob('*.astro') if 'brand-' in f.read_text()]
print('còn brand-:', con or 'không')
```

Expected: in danh sách tệp đã sửa và `còn brand-: không`. Nếu còn, sửa tay đúng dòng đó theo bảng ở trên (cùng ý: nền nhấn → `bg-accent`, chữ nhấn → `text-accent-text`, nền mờ → `bg-accent-soft`).

- [ ] **Step 4: Rà tay hai chỗ nhạy**

`apps/site/src/components/Hero.astro`: nút "Bấm để mở bản đồ tương tác" phải là `bg-accent … text-accent-ink`; lớp nền chỗ giữ `bg-surface-2`. `apps/site/src/components/PricingCards.astro`: thẻ nổi bật `border-accent`, chip "Được chọn nhiều nhất" `bg-accent … text-accent-ink`. Kiểm bằng:

```bash
grep -n "text-white" apps/site/src -r
```

Expected: không còn dòng nào (mọi nút nhấn đã dùng `text-accent-ink`).

- [ ] **Step 5: Build, e2e bài mới xanh**

```bash
cd apps/site && pnpm build && pnpm exec playwright test -g "không còn lớp brand" ; cd ../..
```

Expected: build 11 trang; bài e2e PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src apps/site/e2e/trang.spec.ts
git commit -m "refactor(site): thay brand-* bằng token nhấn; e2e khoá không còn brand-"
```

---

### Task 8: Font 800 + JetBrains Mono + thang cỡ chữ

**Files:**
- Modify: `apps/site/package.json`, `apps/site/src/styles/global.css`

- [ ] **Step 1: Thêm font mono**

```bash
pnpm --filter @mapslibvn/site add @fontsource/jetbrains-mono
ls apps/site/node_modules/@fontsource/jetbrains-mono/ | grep -E "^latin-(400|600)\.css$"
```

Expected: hai tệp `latin-400.css`, `latin-600.css` có mặt. Nếu gói chỉ có `400.css`/`600.css` thì import hai tệp đó (chúng khai nhiều @font-face theo `unicode-range`, trình duyệt vẫn chỉ tải subset latin khi trang chỉ có ASCII trong font mono).

- [ ] **Step 2: Viết lại global.css**

Ghi đè `apps/site/src/styles/global.css`:

```css
@import "tailwindcss";
/* Token màu và bo góc dùng chung với Admin và console (packages/ui). Website chỉ dùng token, không
   dùng component nào của package, nên KHÔNG cần @source. */
@import "../../../../packages/ui/src/tokens.css";
/* Be Vietnam Pro: font Việt, dấu đặt đúng ở mọi cỡ, giấy phép OFL. Bốn nét: 400 thân, 600 nhãn,
   700 tiêu đề mục, 800 tiêu đề lớn (spec 22/09 mục 4.2).
   Dùng bản ĐỦ DẢI (400.css) chứ không phải `vietnamese-400.css`: bản đủ dải khai ba @font-face
   kèm `unicode-range` nên trình duyệt chỉ tải đúng tệp woff2 cho chữ có trên trang, còn bản
   vietnamese-* chỉ phủ ký tự tiếng Việt và sẽ làm mọi chữ ASCII rơi về font hệ thống. */
@import "@fontsource/be-vietnam-pro/400.css";
@import "@fontsource/be-vietnam-pro/600.css";
@import "@fontsource/be-vietnam-pro/700.css";
@import "@fontsource/be-vietnam-pro/800.css";
/* JetBrains Mono CHỈ subset latin và CHỈ cho chuỗi ASCII (số, mã, tên gói, nhãn như SDK/API):
   font này thiếu dải Latin Extended Additional nên dấu tiếng Việt sẽ lệch. Nhãn có dấu dùng
   Be Vietnam Pro 600 viết hoa. */
@import "@fontsource/jetbrains-mono/latin-400.css";
@import "@fontsource/jetbrains-mono/latin-600.css";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: "Be Vietnam Pro", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

html {
  scroll-behavior: smooth;
  /* Nền đặt ở html chứ không chỉ body: vùng cuộn quá đà (overscroll) trên iOS lấy màu của html. */
  background: var(--bg);
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
  }
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  /* Thân 17 px desktop, 16 px mobile (spec 4.2 hàng body); website là để ĐỌC nên không xuống 14. */
  font-size: clamp(16px, 0.25vw + 14.5px, 17px);
  line-height: 1.7;
  margin: 0;
}

/* Thang cỡ chữ (spec 4.2). Dùng lớp `t-*` thay vì text-xl/2xl của Tailwind để cả site đi một
   thang, và để đổi thang là đổi đúng một chỗ. Số đo desktop / mobile nội suy bằng clamp. */
@layer components {
  .t-display {
    font-size: clamp(36px, 3vw + 24px, 52px);
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1.02;
    text-wrap: balance;
  }
  .t-h1 {
    font-size: clamp(32px, 2vw + 20px, 44px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.05;
    text-wrap: balance;
  }
  .t-h2 {
    font-size: clamp(24px, 1vw + 18px, 28px);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
    text-wrap: balance;
  }
  .t-h3 {
    font-size: clamp(18px, 0.5vw + 15px, 20px);
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.25;
  }
  .t-lead {
    font-size: clamp(17px, 0.5vw + 14px, 19px);
    line-height: 1.55;
  }
  .t-body {
    font-size: clamp(16px, 0.25vw + 14.5px, 17px);
    line-height: 1.7;
  }
  .t-small {
    font-size: clamp(14px, 0.25vw + 12.5px, 15px);
    line-height: 1.5;
  }
  /* Con số nổi bật: Be Vietnam Pro 800 (không mono — chuỗi như "37–68%" có gạch ngang ngoài ASCII). */
  .t-stat {
    font-size: clamp(28px, 1.5vw + 18px, 34px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  /* Nhãn chữ máy viết hoa, CHỈ dùng cho chuỗi ASCII. Màu muted (7,7:1), không dùng faint. */
  .t-mono-label {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    line-height: 1;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  /* Nhãn tiếng Việt viết hoa: cùng vai với t-mono-label nhưng font có dấu. */
  .t-nhan {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    line-height: 1;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .t-code {
    font-family: var(--font-mono);
    font-size: clamp(13px, 0.25vw + 11.5px, 14px);
    line-height: 1.6;
  }
}

@layer base {
  a[href],
  button:not(:disabled),
  summary,
  label[for] {
    cursor: pointer;
  }
  :focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 3: Build + typecheck**

```bash
pnpm --filter @mapslibvn/site build && pnpm --filter @mapslibvn/site typecheck
```

Expected: build 11 trang; `astro check` 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/site/package.json apps/site/src/styles/global.css pnpm-lock.yaml
git commit -m "feat(site): Be Vietnam Pro 800, JetBrains Mono latin, thang cỡ chữ t-*"
```

---

### Task 9: Website tối mặc định, `theme-color` theo class

**Files:**
- Modify: `apps/site/src/layouts/Base.astro`, `apps/site/src/components/SeoHead.astro`, `apps/site/src/components/Header.astro`
- Test: `apps/site/e2e/trang.spec.ts`

- [ ] **Step 1: Sửa bài e2e công tắc và thêm bài mặc định tối (đỏ trước)**

Trong `apps/site/e2e/trang.spec.ts`, **thay** bài `'công tắc sáng tối đổi giao diện và nhớ lựa chọn'` bằng hai bài:

```ts
test('mặc định tối bất kể cài đặt máy; chọn sáng thì nhớ', async ({ browser }) => {
  // Mô phỏng máy đặt SÁNG để chứng minh site không còn đi theo prefers-color-scheme.
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto('/');
  const html = page.locator('html');
  expect(await html.evaluate((el) => el.classList.contains('dark'))).toBe(true);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0a0a0a');

  await page.getByRole('button', { name: 'Đổi giao diện sáng tối' }).click();
  await expect.poll(() => html.evaluate((el) => el.classList.contains('dark'))).toBe(false);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#fafafa');

  await page.reload();
  expect(await html.evaluate((el) => el.classList.contains('dark'))).toBe(false);
  await ctx.close();
});

test('đã chọn tối thì reload vẫn tối', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('mapslibvn-site-theme', 'dark'));
  await page.reload();
  expect(await page.locator('html').evaluate((el) => el.classList.contains('dark'))).toBe(true);
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

```bash
cd apps/site && pnpm exec playwright test -g "mặc định tối" ; cd ../..
```

Expected: FAIL — `html.dark` là `false` khi máy đặt sáng.

- [ ] **Step 3: Sửa Base.astro**

Thay khối `<script is:inline>` trong `apps/site/src/layouts/Base.astro`:

```astro
    <script is:inline>
      // Chạy đồng bộ trong <head>: đặt class trước lần vẽ đầu tiên, nếu không trang nháy sáng
      // rồi mới chuyển tối. Không dùng module vì module bị hoãn tới sau khi parse xong.
      // TỐI là mặc định (spec 22/09 mục 4.5): chỉ khi người dùng đã chọn 'light' mới để sáng.
      // Không đọc prefers-color-scheme nữa.
      (function () {
        var sang = false;
        try {
          sang = localStorage.getItem('mapslibvn-site-theme') === 'light';
        } catch (e) {}
        if (!sang) document.documentElement.classList.add('dark');
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', sang ? '#fafafa' : '#0a0a0a');
      })();
    </script>
```

- [ ] **Step 4: Sửa SeoHead.astro — theme-color và preload font 800**

Trong frontmatter `apps/site/src/components/SeoHead.astro`, thêm hai import sau các import hiện có:

```ts
// `?url` cho ra đường dẫn đã băm lúc build, trùng với URL mà CSS của @fontsource tham chiếu.
import font800Latin from '@fontsource/be-vietnam-pro/files/be-vietnam-pro-latin-800-normal.woff2?url';
import font800Viet from '@fontsource/be-vietnam-pro/files/be-vietnam-pro-vietnamese-800-normal.woff2?url';
```

Ngay sau dòng `<meta name="viewport" …/>` thêm:

```astro
{/* Giá trị này là bản TỐI mặc định; script trong Base.astro đổi sang #fafafa khi đã chọn sáng,
    và công tắc ở Header đổi theo mỗi lần bấm. */}
<meta name="theme-color" content="#0a0a0a" />
{/* Tiêu đề lớn dùng nét 800 ngay ở màn đầu: preload để chữ không nháy từ font dự phòng. */}
<link rel="preload" as="font" type="font/woff2" crossorigin href={font800Latin} />
<link rel="preload" as="font" type="font/woff2" crossorigin href={font800Viet} />
```

Nếu `astro check` báo thiếu kiểu cho import `?url`, thêm tệp `apps/site/src/env.d.ts`:

```ts
/// <reference types="astro/client" />
```

- [ ] **Step 5: Sửa Header.astro — công tắc đổi cả theme-color**

Trong `<script>` cuối `apps/site/src/components/Header.astro`, thay khối `document.getElementById('nut-theme')?.addEventListener(...)`:

```ts
  const KHOA = 'mapslibvn-site-theme';
  document.getElementById('nut-theme')?.addEventListener('click', () => {
    const toi = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', toi);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', toi ? '#0a0a0a' : '#fafafa');
    try {
      localStorage.setItem(KHOA, toi ? 'dark' : 'light');
    } catch {
      // Chế độ riêng tư chặn localStorage — vẫn đổi cho phiên này.
    }
  });
```

- [ ] **Step 6: Build, chạy hai bài e2e, xanh**

```bash
cd apps/site && pnpm build && pnpm exec playwright test -g "mặc định tối|đã chọn tối" ; cd ../..
```

Expected: PASS 2 bài.

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/layouts/Base.astro apps/site/src/components/SeoHead.astro apps/site/src/components/Header.astro apps/site/e2e/trang.spec.ts apps/site/src/env.d.ts
git commit -m "feat(site): tối mặc định bất kể cài đặt máy, theme-color theo class, preload font 800"
```

(Nếu không tạo `env.d.ts` thì bỏ tệp đó khỏi `git add`.)

---

### Task 10: Cổng kiểm cuối pha 0

**Files:**
- Modify: `docs/DEVLOG.md`
- Create: `docs/evidence/site-redesign/pha-0/` (2 ảnh)

- [ ] **Step 1: Toàn bộ cổng**

```bash
pnpm lint
pnpm exec vitest run packages/ui apps/site apps/console apps/admin
pnpm --filter @mapslibvn/ui typecheck --force
pnpm --filter @mapslibvn/admin typecheck --force && pnpm --filter @mapslibvn/admin build
pnpm --filter @mapslibvn/console typecheck --force && pnpm --filter @mapslibvn/console build
pnpm --filter @mapslibvn/site typecheck && pnpm --filter @mapslibvn/site build
pnpm --filter @mapslibvn/site e2e
grep -rn "brand-" apps packages/ui --include='*.tsx' --include='*.ts' --include='*.astro' --include='*.css' --include='*.html' | grep -v node_modules | grep -v dist | grep -v "\.test\." | grep -v "\.spec\." ; echo "brand exit=$?"
grep -rn "1b3a6b" apps packages scripts --include='*.tsx' --include='*.ts' --include='*.astro' --include='*.css' --include='*.html' --include='*.svg' --include='*.mjs' | grep -v node_modules | grep -v dist
```

Expected: lint sạch; vitest PASS; typecheck 0 lỗi; build ba app xong; Playwright site PASS (28 bài: 26 cũ trừ 1 bài công tắc, cộng 3 bài mới); `brand exit=1`; dòng `1b3a6b` còn lại chỉ ở `apps/site/public/favicon.svg` và `scripts/site-images.mjs` (đổi ở pha 3, đã ghi trong spec mục 9).

- [ ] **Step 2: Ảnh bằng chứng console (trang đăng nhập công khai, hai theme)**

```bash
mkdir -p docs/evidence/site-redesign/pha-0
cd apps/console && pnpm exec playwright --version >/dev/null 2>&1 || true; cd ../..
cd apps/site && node --input-type=module -e "
import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [ten, toi] of [['console-dang-nhap-toi', true], ['console-dang-nhap-sang', false]]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript((t) => localStorage.setItem('mapslibvn-console-theme', t ? 'dark' : 'light'), toi);
  await p.goto('https://api.ai-solutions.io.vn/console/dang-nhap', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: '../../docs/evidence/site-redesign/pha-0/' + ten + '.png' });
  await p.close();
}
await b.close();
"; cd ../..
```

Lưu ý: ảnh này chụp bản console **đang deploy** (còn navy) để làm mốc "trước"; bản "sau" chụp ở pha 3 khi console mới lên production. Nếu lệnh lỗi mạng, bỏ qua bước này và ghi vào DEVLOG.

- [ ] **Step 3: Ghi DEVLOG**

Thêm cuối `docs/DEVLOG.md` một mục mới (số kế tiếp mục cuối cùng):

```markdown
## N. Giao diện mới — pha 0: token, chữ, sáng/tối — dd/mm/yyyy   ← N = số mục cuối + 1, ngày là ngày chạy

Theo spec `2026-09-22-thiet-ke-lai-giao-dien-design.md`, plan `2026-09-22-giao-dien-pha-0-nen-tang.md`.
Bảng màu đen + xanh chanh thay navy ở `packages/ui/src/tokens.css`, phơi qua `@theme inline` (bẫy:
`@theme` thường tính `var()` tại `:root` nên `.dark` không đổi được utility). Test tương phản WCAG
đọc thẳng tệp CSS. Bốn app không còn `brand-*` (grep = 0). `readStoredTheme(key, macDinh)`. Site:
Be Vietnam Pro 800 + JetBrains Mono latin, thang `t-*`, TỐI mặc định bất kể máy, `theme-color`
theo class. Bố cục chưa đổi — pha 1. Cổng: vitest, typecheck --force, build ba app, Playwright site
28/28, lint. Chưa push; nhánh `feat/giao-dien-moi`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/DEVLOG.md docs/evidence/site-redesign
git commit -m "docs: DEVLOG pha 0 giao diện mới + ảnh mốc console"
```

Kết thúc pha 0. **Không push.** Chuyển sang plan pha 1 (`2026-09-22-giao-dien-pha-1-trang-chu.md`) trên cùng nhánh.
