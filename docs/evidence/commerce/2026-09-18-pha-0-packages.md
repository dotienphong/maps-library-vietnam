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

## 3. Sau deploy (PHONG push; `Deploy API` tự chạy)

Không có migration; máy chủ giữ `0019`. `check:migration` chỉ so bản mới nhất trong repo với
`/healthz/db`, nên không chặn.

- [ ] `curl -sI https://api.ai-solutions.io.vn/v1/catalog | grep -i cache-control` → `public, max-age=3600`
- [ ] `curl -s https://api.ai-solutions.io.vn/v1/catalog | head -c 300` thấy `"priceVnd":650000`
- [ ] Mở `https://api.ai-solutions.io.vn/admin/` trên điện thoại: nút, thẻ, huy hiệu còn đúng kiểu
      ở cả bản sáng và tối; toast đếm ngược 5 giây khi thu hồi một khoá thử rồi Huỷ.
- [ ] `/healthz` và `/v1/autocomplete?q=cafe` (khoá thử) vẫn 200 — bundle mới không hỏng gì cũ.

**Rủi ro duy nhất lộ ra ở production mà test ở máy không phủ hết:** Tailwind sinh CSS cho
component của `packages/ui`. Mục 2 đã kiểm trên CSS build thật, nhưng phép kiểm bằng mắt ở ô thứ
ba vẫn là bằng chứng cuối cùng.
