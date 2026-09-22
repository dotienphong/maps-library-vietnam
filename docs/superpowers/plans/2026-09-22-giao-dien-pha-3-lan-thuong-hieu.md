# Giao diện mới — Pha 3: lan thương hiệu sang console, tài liệu, tài sản — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khách đi từ website sang cổng khách hàng, sang trang tài liệu, và nhận email đều thấy cùng một thương hiệu. Theo spec `2026-09-22-thiet-ke-lai-giao-dien-design.md` mục 8 và 9.

**Architecture:** Không dựng lại app nào. Console đổi **mặc định theme** (token đã lan ở pha 0). Tài liệu Starlight đổi ba biến accent của nó và mặc định tối. Favicon và ảnh OG sinh lại theo bảng màu mới.

**Tiền điều kiện:** pha 0, 1, 2 xong trên nhánh `feat/giao-dien-moi`.

**Ngoài spec nhưng làm luôn, có lý do:** mẫu email (`apps/api/src/email/*`) và chấm vị trí trên bản đồ sửa POI của Admin còn ghi cứng navy `#1b3a6b`. Email là thứ khách hàng nhận trực tiếp nên để navy trong khi mọi mặt tiền khác đã đổi là thương hiệu lệch rõ. **Không đụng** `packages/style/src/transform.mjs`: đó là màu nhãn trên bản đồ, một bài toán đọc được của bản đồ chứ không phải màu thương hiệu, và đổi nó buộc phải dựng lại style rồi nghiệm thu riêng.

---

### Task 1: Console tối mặc định

**Files:** `apps/console/src/lib/theme.ts`, `apps/console/index.html`
**Test:** `apps/console/src/lib/theme.test.ts` (mới nếu chưa có)

- [ ] **Step 1: Viết test (đỏ)** — khẳng định `readStoredTheme()` của console trả `'dark'` khi chưa chọn gì, và trả đúng lựa chọn đã lưu.
- [ ] **Step 2: Chạy — FAIL.**
- [ ] **Step 3:** `readStoredTheme` truyền `'dark'` vào `readWithKey`. `index.html` đặt `theme-color` `#0a0a0a`.
- [ ] **Step 4: Chạy — PASS. Build console. Commit.**

---

### Task 2: Tài liệu Starlight — màu nhấn và tối mặc định

**Files:** `apps/docs/src/styles/custom.css`, `apps/docs/astro.config.mjs`

- [ ] **Step 1:** Trong `custom.css` đặt `--sl-color-accent-low/-accent/-accent-high` cho cả `:root` (tối) và `:root[data-theme='light']`. Bản sáng dùng `#3f6212` cho accent vì `#a3e635` trên nền trắng chỉ 1,4:1. Nút chính Starlight (`.sl-link-button.primary`) nền `#a3e635`, chữ `#0a0a0a`.
- [ ] **Step 2:** Mặc định tối: thêm script inline qua `head` trong Starlight config — nếu `localStorage['starlight-theme']` trống thì đặt `document.documentElement.dataset.theme = 'dark'`. Công tắc của Starlight giữ nguyên.
- [ ] **Step 3: `pnpm --filter @mapslibvn/docs build`.** Kiểm HTML dựng: có script mặc định tối, và `--sl-color-accent` mang giá trị mới.
- [ ] **Step 4: Commit.**

---

### Task 3: Favicon ba app

**Files:** `apps/site/public/favicon.svg`, `apps/console/public/favicon.svg`, `apps/admin/public/favicon.svg`

- [ ] **Step 1:** Site và console: nền tròn `#0a0a0a`, chữ M `#a3e635`. Admin giữ hình chốt bản đồ nhưng đổi `#1b3a6b` → `#a3e635` và nền tối.
- [ ] **Step 2:** `grep -rn "1b3a6b" apps/*/public` phải trống. Commit.

---

### Task 4: Ảnh OG

**Files:** `scripts/site-images.mjs`, `apps/site/public/og/*.png`, `apps/site/src/lib/trang.ts`

- [ ] **Step 1:** `trangOg()` đổi nền `#0a0a0a`, chữ `#fafafa`, gạch nhấn `#a3e635`; nhúng thêm nét 800 và dùng nó cho `h1`.
- [ ] **Step 2:** Đổi tên tệp OG thành `*-v2.png` và cập nhật `TRANG.*.og` — mạng xã hội cache ảnh OG theo URL, giữ tên cũ thì bản cũ còn sống rất lâu.
- [ ] **Step 3:** `node scripts/site-images.mjs --og`. Nhìn từng ảnh: chữ có dấu vẽ đúng, không rơi font.
- [ ] **Step 4:** Bài e2e "ảnh OG mà thẻ meta trỏ tới phải tồn tại thật" phải xanh. Commit.

---

### Task 5: Mẫu email và chấm vị trí Admin

**Files:** `apps/api/src/email/mau.ts`, `mau-don-hang.ts`, `mau-canh-bao.ts`, `apps/admin/src/features/edits/map-runtime.ts`

- [ ] **Step 1:** Email — nút nền `#a3e635` chữ `#0a0a0a`; link và chữ nhấn `#3f6212` (email đọc trên nền trắng, xanh chanh không đọc được). Tiêu đề "MapsLibVN" `#0a0a0a`.
- [ ] **Step 2:** `map-runtime.ts`: `COLOR_MOI` đổi `#1b3a6b` → `#4d7c0f` (chấm trên nền bản đồ sáng, cần đủ tương phản).
- [ ] **Step 3:** `pnpm exec vitest run apps/api` và `pnpm --filter @mapslibvn/api test` phải xanh. Commit.

---

### Task 6: Cổng kiểm cuối và nghiệm thu

- [ ] **Step 1:**

```bash
pnpm lint
pnpm exec vitest run
pnpm --filter @mapslibvn/site typecheck && pnpm --filter @mapslibvn/site build && pnpm --filter @mapslibvn/site e2e
pnpm --filter @mapslibvn/console typecheck && pnpm --filter @mapslibvn/console build
pnpm --filter @mapslibvn/admin typecheck && pnpm --filter @mapslibvn/admin build
pnpm --filter @mapslibvn/docs build
pnpm --filter @mapslibvn/api test
grep -rn "1b3a6b" apps packages scripts --include='*.ts' --include='*.tsx' --include='*.astro' --include='*.css' --include='*.html' --include='*.svg' --include='*.mjs' | grep -v node_modules | grep -v dist
```

Expected: mọi cổng xanh; `1b3a6b` chỉ còn ở `packages/style/src/transform.mjs` (cố ý, xem đầu plan).

- [ ] **Step 2: Ảnh nghiệm thu** console (đăng nhập, hai theme) và docs (trang chủ, hai theme) vào `docs/evidence/site-redesign/pha-3/`.
- [ ] **Step 3: DEVLOG + commit.** Rồi trình PHONG quyết định merge và push.
