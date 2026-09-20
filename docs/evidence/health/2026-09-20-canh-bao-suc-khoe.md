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

- Merge `5e7fc17` lên `main` lúc 02:46 UTC; bốn workflow (Deploy API, CI, Deploy Docs, Routing tests)
  xanh; `/healthz` và `/healthz/db` trả 200 sau deploy.
- **Lượt cron đầu 02:55:18 UTC** ghi KV `health:canh-bao` (đọc bằng `wrangler kv key get --remote`):

  ```json
  {"v":1,"kiemLuc":"2026-09-20T02:55:18.436Z","ghiLuc":"2026-09-20T02:55:18.436Z",
   "thanhPhan":{"db":{"ok":true,"tuLuc":"2026-09-20T02:55:18.436Z"},
                "routing":{"ok":true,"tuLuc":"2026-09-20T02:55:18.436Z"},
                "data":{"ok":true,"tuLuc":"2026-09-20T02:55:18.436Z"}},
   "guiTrongNgay":{"ngay":"2026-09-20","so":0}}
  ```

- Lượt 03:00 UTC **không ghi KV** (trạng thái không đổi, bản ghi mới 5 phút) — đúng quy tắc ghi chọn
  lọc ở spec 5.3; `kiemLuc` vẫn là 02:55:18 khi đọc lúc 03:04.
- **Diễn tập đường thư (spec 9.4)** lúc 03:03:32 UTC: `wrangler kv key put` trạng thái với
  `routing = {ok:false, tuLuc:"2026-09-20T02:53:32.000Z", loi:"diễn tập đường thư 20/09/2026"}`, phần
  còn lại giữ nguyên. Lượt cron **03:05:17 UTC** thấy định tuyến tốt → chuyển trạng thái → gửi thư.
  KV sau đó:

  ```json
  {"v":1,"kiemLuc":"2026-09-20T03:05:17.945Z","ghiLuc":"2026-09-20T03:05:17.945Z",
   "thanhPhan":{"db":{"ok":true,"tuLuc":"2026-09-20T02:55:18.436Z"},
                "routing":{"ok":true,"tuLuc":"2026-09-20T03:05:17.945Z"},
                "data":{"ok":true,"tuLuc":"2026-09-20T02:55:18.436Z"}},
   "guiTrongNgay":{"ngay":"2026-09-20","so":1}}
  ```

  Dòng log của chính lượt đó (`wrangler tail --env production`):

  ```
  [health] {"ten":"canhBaoSucKhoe","ok":true,"trangThai":"da-gui","hong":[],"phucHoi":["routing"],"daGhiKv":true}
  ```

  `so: 1` chỉ tăng sau khi `port.send()` trả về không lỗi, nên Resend đã nhận thư. Tiêu đề theo mẫu:
  `[MapsLibVN] PHỤC HỒI: Định tuyến (hỏng 12 phút)` (02:53:32 → 03:05:17). **PHONG xác nhận đã nhận
  thư trong hộp dotienphong1993@gmail.com lúc ~10:10 giờ VN ngày 20/09/2026** — đường thư nghiệm thu
  đầu-cuối trên production.
- Trang `/admin/health` sau lượt này phải hiện "Giám sát tự động: đo lần cuối 10:05 · đã gửi 1 cảnh
  báo hôm nay" (giờ Việt Nam). PHONG kiểm khi mở trang.
- Bẫy gặp trong lúc nghiệm thu: `wrangler` chạy không tương tác **không đọc `.env`** ở gốc repo — phải
  `set -a; source ../../.env; set +a` trước, nếu không `kv key get` báo thiếu `CLOUDFLARE_API_TOKEN`
  (và một vòng poll 9 phút đã trôi qua vì thế). macOS không có `timeout`; `wrangler tail` giới hạn
  thời gian bằng `&` + `sleep` + `kill`.

## 4. Điểm mù còn lại

Xem spec mục 8. Phát sinh trong lúc làm: lớp A phụ thuộc một bước tay của PHONG (mục 2).
