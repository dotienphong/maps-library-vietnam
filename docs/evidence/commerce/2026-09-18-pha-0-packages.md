# Chứng cứ pha 0 — packages/catalog và packages/ui

Plan: `docs/superpowers/plans/2026-09-18-thuong-mai-pha-0-packages.md`
Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 4.1, 8, 16, 19.

## 1. Cổng ở máy (điền số thật)

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | |
| `turbo run typecheck --force` | … / … package, 0 cached |
| `npx vitest run packages/catalog packages/ui` | … file / … test |
| `pnpm test` (gốc, gồm build core/style/web/admin + api test) | |
| `pnpm --filter @mapslibvn/api test` | … file / … test |
| `pnpm test:admin-e2e` | |
| `grep -c "min-h-11" apps/admin/dist/admin/assets/index-*.css` | |
| `cd apps/api && npx wrangler deploy --dry-run --outdir .wrangler/dry-run --env production` | bundle OK |

## 2. Không đổi hành vi

- [ ] Số test admin sau pha 0 = số trước − 17 (button 3, card 4, states 4, data-view 3, delayed-action 3), phần chênh đã chạy ở `packages/ui` (26 test).
- [ ] `/v1/admin/plan-catalog` trả thêm `priceVnd`, các trường cũ y nguyên (test admin-catalog).
- [ ] `apps/admin/dist/admin/assets/index-*.css` có `min-h-11` và `--color-brand-700`.

## 3. Sau deploy (PHONG push; Deploy API tự chạy)

- [ ] `curl -sI https://api.ai-solutions.io.vn/v1/catalog | grep -i cache-control` → `public, max-age=3600`
- [ ] `curl -s https://api.ai-solutions.io.vn/v1/catalog | head -c 300` thấy `"priceVnd":650000`
- [ ] Mở `https://api.ai-solutions.io.vn/admin/` trên điện thoại: nút, thẻ, huy hiệu còn đúng kiểu ở cả bản sáng và tối; toast đếm ngược 5 giây khi thu hồi một khoá thử rồi Huỷ.
- [ ] `/healthz` và `/v1/autocomplete?q=cafe` (khoá thử) vẫn 200 — bundle mới không hỏng gì cũ.
