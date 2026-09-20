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
  có; chưa xác nhận thì chính sách không gửi.
- **ĐÃ KIỂM BẰNG TUNNEL DOWN THẬT, 20/09 ~03:45–03:48 UTC.** PHONG tắt tunnel khoảng 2 phút rồi mở lại.
  Lịch sử Notification (`GET /alerting/v3/history`): `tunnel_health_event` gửi email lúc
  **03:46:43 UTC** (dòng 03:36:24 trước đó là nút **Test** trên dashboard). PHONG xác nhận nhận được
  thư. Bộ lọc `TUNNEL_STATUS_TYPE_DOWN` khớp thật — điểm mù "chưa kiểm được" của lớp A đã đóng.
- **Lớp B KHÔNG gửi thư trong lần này, và đó là đúng thiết kế hiện tại:** cron đo lúc :45:17 và :50:17
  (nhịp 5 phút), KV sau sự cố vẫn cả ba `ok: true`, `guiTrongNgay.so` vẫn 1, `kiemLuc` 03:40:17 (không
  ghi vì không đổi). Một lần down ~2 phút rơi giữa hai lượt đo; muốn lớp B bắt thì sự cố phải phủ một
  lượt đo **và** lượt đo lại 15 s sau. Hệ quả: lớp B chỉ bảo đảm cho sự cố kéo dài ≥ ~5 phút. Quyết định
  có rút nhịp xuống 1 phút hay không ghi ở mục 4.
- **Token máy dev đã có `Account · Notifications · Edit` (PHONG thêm 20/09 ~03:42 UTC).** Kiểm bằng
  `PUT /alerting/v3/policies/{id}` với đúng nội dung hiện có → `success: true`, nội dung không đổi,
  chỉ `modified` nhảy lên 03:44:32 UTC. Lưu ý API: cập nhật chính sách là **PUT toàn thân**, PATCH trả
  `10405 Method not allowed for this authentication scheme` — mã lỗi đó là do sai method, không phải
  thiếu quyền. Token vẫn không thấy tunnel (`cfd_tunnel` rỗng) — không cần cho việc này.

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

Xem spec mục 8. Phát sinh trong lúc làm: lớp A phải tạo tay (mục 2), đã kiểm bằng down thật.

**Điểm mù mới thấy khi kiểm thật:** sự cố ngắn hơn nhịp cron (5 phút) không tới được lớp B. Lựa chọn
đang chờ PHONG: thêm lịch `* * * * *` riêng cho việc sức khoẻ (phát hiện ≤ ~1,5 phút; 1.440 lượt
`/route` + `SELECT 1` mỗi ngày, KV không tăng vì ghi chọn lọc, Resend không tăng vì chỉ gửi khi đổi
trạng thái), hoặc giữ 5 phút và chấp nhận bỏ qua chớp ngắn.
