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

- **ĐÃ TẠO 20/09/2026 03:34 UTC, PHONG tạo tay trên Dashboard** (token API của máy dev thiếu
  `Notifications Write`: POST trả `10000 Authentication error`; đọc thì được). Đọc lại bằng API:

  | Trường | Giá trị |
  |---|---|
  | id | `474c4effac064a91806ed562e136a594` |
  | alert_type | `tunnel_health_event`, enabled |
  | filters.new_status | `["TUNNEL_STATUS_TYPE_DOWN"]` |
  | filters.tunnel_id | `["dd6713db-c7b4-48e2-8700-3e4a38dc1356"]` (mapslibvn-db) |
  | email | dotienphong1993@gmail.com |

- **Bài học giá trị bộ lọc.** Schema OpenAPI không liệt kê giá trị của `new_status`; plan Task 7 định
  gửi `["down"]` chữ thường theo trường `status` của API tunnel. Dashboard sinh ra
  `TUNNEL_STATUS_TYPE_DOWN`. Nếu token có quyền ghi và tôi POST `["down"]`, chính sách sẽ tồn tại,
  enabled, và **không bao giờ khớp** — một lớp cảnh báo xanh giả. Lần sau tạo bằng API phải dùng đúng
  hằng `TUNNEL_STATUS_TYPE_*` (suy ra: `TUNNEL_STATUS_TYPE_HEALTHY`, `_DEGRADED`, `_INACTIVE`).
- Việc còn lại của PHONG: bấm xác nhận trong thư "Verify your email" của Cloudflare Notifications nếu
  có; chưa xác nhận thì chính sách không gửi. Kiểm thật duy nhất là một lần tunnel down; khi có, ghi
  lại ở đây.

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

Xem spec mục 8. Phát sinh trong lúc làm: lớp A phải tạo tay (mục 2); chưa có sự kiện tunnel down thật để kiểm bộ lọc.
