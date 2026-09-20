# Nghiệm thu — cảnh báo sức khoẻ qua email (20/09/2026)

Spec: `docs/superpowers/specs/2026-09-20-canh-bao-suc-khoe-design.md`. Plan: `docs/superpowers/plans/2026-09-20-canh-bao-suc-khoe.md`.

## 1. Cổng chất lượng (nhánh `feat/canh-bao-suc-khoe`, trước merge)

| Cổng | Kết quả |
|---|---|
| `pnpm test` (vitest gốc) | 215 file, 1987 pass, 5 skipped |
| `pnpm test` (`apps/api`, pool Workers) | 86 file, 773 pass — tăng 21 bài: `health-canh-bao` 12, `email-mau-canh-bao` 4, `scheduled` +1, `admin-health` +2; admin `page.test.tsx` +3 nằm trong bộ gốc |
| `pnpm typecheck` | sạch (turbo 18 task) |
| `pnpm lint` (biome) | 858 file, không lỗi |

## 2. Lớp A — Tunnel Health Alert

- **Trạng thái: chờ PHONG tạo tay.** `POST /accounts/{id}/alerting/v3/policies` với `CLOUDFLARE_API_TOKEN`
  trả `success: false`, lỗi `10000 Authentication error`: token thiếu `Notifications Write` (đọc danh
  sách chính sách thì được). Token cũng không thấy tunnel nào (`cfd_tunnel` trả rỗng) nên không lọc
  được theo `tunnel_id` — bộ lọc rỗng áp cho mọi tunnel của tài khoản, hiện chỉ có `mapslibvn-db`.
- Bước tạo: Dashboard → **Notifications** → **Add** → Product **Cloudflare Tunnel** → **Tunnel Health
  Alert** → tên `MapsLibVN — Tunnel mapslibvn-db down` → email `dotienphong1993@gmail.com` → trạng thái
  chỉ chọn **Down** → Create. Sau đó bấm xác nhận trong thư "Verify your email" của Cloudflare nếu có.
- Chưa kiểm được: giá trị bộ lọc trạng thái mà Cloudflare so khớp (schema OpenAPI không liệt kê).
  Cách kiểm thật duy nhất là một lần tunnel down thật; khi có, ghi lại ở đây.

## 3. Lớp B — cron Worker trên production

(điền sau deploy — xem mục 9 của spec)

## 4. Điểm mù còn lại

Xem spec mục 8. Phát sinh trong lúc làm: lớp A phụ thuộc một bước tay của PHONG (mục 2).
