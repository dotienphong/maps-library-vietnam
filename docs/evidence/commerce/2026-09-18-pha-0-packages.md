# Chứng cứ pha 0 — packages/catalog và packages/ui

Plan: `docs/superpowers/plans/2026-09-18-thuong-mai-pha-0-packages.md`
Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 4.1, 8, 16, 19.
Ngày chạy: 18/09/2026. HEAD lúc chạy: `05b1cb1` (12 commit của pha 0).

## 1. Cổng ở máy — số thật

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | 673 file, sạch |
| `npx turbo run typecheck --force` | **16/16 task, 0 cached**, 26,7 s |
| `npx vitest run packages/catalog packages/ui` | 10 file / **52 test** xanh |
| `pnpm test` (gốc) | 188 file / **1.822 test** xanh, 5 skip |
| `pnpm --filter @mapslibvn/api test` | 62 file / **480 test** xanh |
| `pnpm test:api-db` (DB thật) | 11 file / **116 test** xanh |
| `pnpm test:admin-e2e` (Playwright) | **17/17** xanh, 1,1 phút |
| `grep -c min-h-11 …/index-*.css` | 1 (có) |
| `wrangler deploy --dry-run --env production` | bundle OK, 522,49 KiB / gzip 124,89 KiB; `env.SELF_SERVE ("0")` |

Chi tiết hai bộ test mới: catalog 4 file / 26 test (plans 6, months 6, quote 7, comparison 7);
ui 6 file / 26 test (button 3, card 4, states 6, record-view 3, delayed-action 5, theme 5).

## 2. Không đổi hành vi — đã đối chiếu

- [x] **Số test admin: 177 → 160, giảm đúng 17.** Năm file chuyển sang `packages/ui` mang theo
      3 + 4 + 4 + 3 + 3 = 17 test; `packages/ui` chạy 26 test (6 bài mới của `states` và
      `delayed-action` là phần thêm). Admin 29 file + ui 6 file = 35 file, 160 + 26 = 186 test.
- [x] `/v1/admin/plan-catalog` trả thêm `priceVnd`; các trường cũ y nguyên
      (`apps/api/test/admin-catalog.test.ts`).
- [x] `apps/admin/dist/admin/assets/index-YLljmFIe.css` có `min-h-11`, `bg-brand-700`,
      `--color-brand-700`, `animate-pulse` (3), `motion-reduce` (3), `focus-visible` (14),
      `radius-card` (5) — **`@source` đã sinh CSS cho component nằm trong packages/ui**.
- [x] E2E giữ nguyên 17 bài, gồm bài "huỷ trong 5 giây ở màn Gói cước: sổ quota không đổi"
      (chứng minh `delayed-action` sau khi thêm prop `reloadGuard` vẫn đúng) và bài
      "email ngoài BILLING_ADMIN_EMAILS gọi thẳng API billing → 403".

## 3. Sau deploy — đã kiểm 18/09/2026

Push `e99bc5c`; bốn workflow xanh: **Deploy API 4m16s**, CI 2m42s, Routing tests 53s,
Deploy Docs 53s. Không có migration; máy chủ giữ `0019`.

Máy kiểm được:

- [x] `curl -sI …/v1/catalog` → `HTTP/2 200`, `cache-control: public, max-age=3600`
- [x] `curl -s …/v1/catalog` → `"currency":"VND"`, `"usdReferenceRate":26000`,
      `"periodMonths":[1,3,6,12]`, `"priceVnd":650000` ở bậc starter
- [x] `curl -s …/healthz` → `{"ok":true,"environment":"production"}`
- [x] `/v1/admin/plan-catalog` không cookie → **302** về màn đăng nhập Cloudflare Access
      (đúng thiết kế: Access đứng trước Worker, không phải 401 của Worker)

**Máy KHÔNG kiểm được, PHONG phải làm bằng mắt:** `/admin/*` nằm sau Access nên
`curl …/admin/assets/index-YLljmFIe.css` trả 302 143 byte, không phải tệp CSS. Phép kiểm
Tailwind sinh đủ lớp cho component trong `packages/ui` vì vậy chỉ khép lại được trong trình duyệt
đã đăng nhập:

- [ ] Mở `https://api.ai-solutions.io.vn/admin/` trên điện thoại: nút, thẻ, huy hiệu đúng kiểu ở
      cả bản sáng và tối (nút xanh `#1b3a6b` cao 44 px, thẻ bo 12 px, khung xương lúc tải nhấp nháy).
- [ ] Thu hồi một khoá thử rồi bấm Huỷ trong 5 giây: toast đếm ngược hiện đúng, khoá không bị thu hồi.
- [ ] `/v1/autocomplete?q=cafe` bằng khoá thử vẫn 200.

Ở máy, cùng tệp CSS đó đã được kiểm đầy đủ (mục 2), nên rủi ro còn lại chỉ là bản deploy khác bản
build ở máy — điều `Deploy API` không có cách nào gây ra vì nó build lại từ cùng commit.
