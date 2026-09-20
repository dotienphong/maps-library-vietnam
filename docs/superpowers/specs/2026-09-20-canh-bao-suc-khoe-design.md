# Cảnh báo sức khoẻ hệ thống qua email — thiết kế

Ngày: 20/09/2026. PHONG duyệt hướng làm "cả hai" cùng ngày, sau câu trả lời rằng ba thẻ ở
`/admin/health` **chỉ đo khi có người mở trang** và chưa có cơ chế nào báo khi một thẻ hỏng.

## 1. Vấn đề

Trang `/admin/health` có ba thẻ — Cơ sở dữ liệu, Định tuyến, Dữ liệu — đến từ một endpoint
`GET /v1/admin/health` chạy ba phép đo song song. Thẻ chỉ đổi màu **lúc có người mở trang**. Máy chủ
ở nhà ngủ lúc 2 giờ sáng thì DB và định tuyến chết, khách gọi API nhận 503, và không ai biết cho tới
khi PHONG tình cờ mở trang.

Những gì đã có đều không phải cảnh báo: cron Worker chỉ làm việc đơn hàng; Cloudflare Notifications
trong tài khoản chỉ có hai chính sách (Passive Origin Monitoring, ngân sách); báo cáo tuần là báo
cáo sử dụng; Docker `restart: unless-stopped` không chống được máy ngủ và không gửi mail.

## 2. Mục tiêu và ngoài phạm vi

**Mục tiêu.** Khi một trong ba thành phần chuyển từ bình thường sang hỏng, dotienphong1993@gmail.com
nhận một thư nói rõ **cái nào** hỏng và **vì sao**, chậm nhất 5 phút sau khi hỏng. Khi phục hồi, nhận
một thư nữa nói hỏng bao lâu. Nhấp nháy một lần (một lượt đo quá hạn rồi lượt sau lại tốt) **không**
sinh thư. Một sự cố kéo dài cả đêm sinh đúng **một** thư hỏng và **một** thư phục hồi.

**Ngoài phạm vi.** Không làm dashboard lịch sử sự cố. Không gửi Telegram/Slack. Không nhắc lại mỗi
N giờ khi vẫn hỏng. Không giám sát chính Cloudflare Workers từ bên ngoài (xem điểm mù ở mục 8).

## 3. Hai lớp, vì mỗi lớp bắt một nhóm lỗi khác nhau

| | Lớp A — Cloudflare Tunnel Health Alert | Lớp B — cron Worker đo ba phép đo |
|---|---|---|
| Ai đo | Cloudflare, từ phía edge | Worker của ta, mỗi 5 phút |
| Bắt được | Máy chủ ngủ, mất mạng, `cloudflared` tắt | Graph rỗng, container postgres chết trong khi tunnel còn, manifest KV hỏng, Access token sai, **và** cả ba ca của lớp A |
| Sống khi | Worker hoặc cron của ta hỏng | Tunnel lên nhưng dịch vụ sau tunnel hỏng |
| Chi phí | 0, vài phút cấu hình | Một lượt `/route` Valhalla + một `SELECT 1` mỗi 5 phút |

Chỉ làm lớp B thì mù khi cron không chạy. Chỉ làm lớp A thì mù với ba ca "tunnel lên, dịch vụ chết"
— mà graph rỗng đã có tiền lệ nghiệm thu xanh giả (memory `valhalla-status-xanh-gia`).

## 4. Lớp A — Cloudflare Tunnel Health Alert

Một chính sách Notification loại `tunnel_health_event` trong tài khoản Cloudflare, cơ chế email tới
dotienphong1993@gmail.com. Tunnel `mapslibvn-db` mang **cả** hostname `maps-db` (Postgres) và
`maps-route` (Valhalla), nên một chính sách là đủ cho cả hai.

- Thử tạo bằng API `POST /accounts/{id}/alerting/v3/policies` với `CLOUDFLARE_API_TOKEN` của máy
  dev ngày 20/09: đọc được danh sách chính sách nhưng **ghi bị từ chối** (10000 Authentication
  error — token thiếu `Notifications Write`). Vì vậy PHONG tạo tay: Dashboard → Notifications → Add
  → Cloudflare Tunnel → Tunnel Health Alert → email → chỉ chọn trạng thái **Down** — đúng bước 5
  "tuỳ chọn" trong `infra/server/README.md`, nay đổi thành **bắt buộc**.
- Bộ lọc `new_status`: chỉ **Down**. Giá trị thật trong API là `TUNNEL_STATUS_TYPE_DOWN` (đọc lại
  từ chính sách dashboard tạo ngày 20/09), **không phải** `down` chữ thường như trường `status` của
  API tunnel — schema OpenAPI không liệt kê, và đoán sai là một chính sách enabled không bao giờ khớp.
  Dashboard cũng gắn `tunnel_id` của `mapslibvn-db`. Không nhận Degraded: một `cloudflared` giữ bốn kết
  nối HA, rớt hai trong bốn là chuyện bình thường của mạng nhà và không làm dịch vụ chết. Không nhận
  Healthy: thư phục hồi để lớp B lo, vì lớp B biết nói "hỏng bao lâu".
- Email lần đầu vào chính sách phải được **xác nhận**: Cloudflare gửi thư xác nhận, PHONG bấm link.
  Chưa bấm thì chính sách tồn tại mà không gửi gì — ghi vào checklist nghiệm thu.

## 5. Lớp B — cron Worker

### 5.1 Vị trí trong mã

- `apps/api/src/health/phep-do.ts` — tách ba phép đo (`db`, `routing`, `data`) ra khỏi
  `routes/admin-health.ts` thành `doBaPhepDo(env, ctx)`. Route và cron **dùng chung một hàm**: hai
  nơi đo "có sống không" mà trả lời khác nhau là cách để một sự cố trông như hai sự cố (nguyên tắc đã
  ghi ở `db-health.ts`).
- `apps/api/src/health/canh-bao.ts` — `theoDoiSucKhoe(env, ctx, deps)`: đo, so với trạng thái lần
  trước trong KV, gửi thư khi có chuyển trạng thái, lưu lại. Trả về một báo cáo để log và để test.
- `apps/api/src/email/mau-canh-bao.ts` — mẫu thư, hàm thuần, có cả HTML và bản chữ như mọi mẫu khác.
- `apps/api/src/index.ts` — `scheduled()` đẩy thêm một `waitUntil` cho `theoDoiSucKhoe` khi cron là
  `*/5 * * * *`. **Không** nhét vào `commerce/cron.ts`: đó là mã nghiệp vụ đơn hàng.

### 5.2 Một lượt chạy

1. Thiếu `ALERT_EMAIL` → không đo, trả báo cáo `thieu-cau-hinh`. Dev không có biến này nên không
   tốn lượt gọi Valhalla mỗi 5 phút ở máy.
2. Đo ba phép đo song song (cùng thời gian chờ với trang: DB nối 5 s, định tuyến 6 s).
3. Phép đo nào hỏng thì **chờ 15 s rồi đo lại đúng phép đó**. Hỏng cả hai lần mới tính là hỏng. Một
   lượt `/route` quá hạn vì máy chủ đang bận build graph không phải sự cố, và một thư lúc 3 giờ sáng
   vì việc đó là cách nhanh nhất để PHONG tắt cảnh báo. Tổng xấu nhất 6 + 15 + 6 = 27 s, dưới trần
   thời gian của cron.
4. Đọc trạng thái lần trước ở KV `META`, khoá `health:canh-bao` (đọc **không** `cacheTtl`).
5. So từng thành phần:
   - chưa có trạng thái (lần chạy đầu) → ghi, không gửi;
   - `ok → hỏng` → vào danh sách **hỏng**;
   - `hỏng → ok` → vào danh sách **phục hồi**, kèm thời gian hỏng tính từ `tuLuc`;
   - không đổi → giữ `tuLuc`.
6. Có ít nhất một chuyển trạng thái → gửi **một** thư gộp. Máy ngủ làm DB và định tuyến chết cùng lúc
   là một thư "HỎNG: Cơ sở dữ liệu, Định tuyến", không phải hai thư.
7. Lưu trạng thái mới. Nếu gửi thư **thất bại**, thành phần vừa chuyển trạng thái giữ nguyên trạng
   thái cũ để lượt sau thử gửi lại; nhịp `kiemLuc` vẫn cập nhật.

### 5.3 Trạng thái trong KV

```json
{
  "v": 1,
  "kiemLuc": "2026-09-20T03:05:12.000Z",
  "ghiLuc":  "2026-09-20T03:05:12.000Z",
  "thanhPhan": {
    "db":      { "ok": true,  "tuLuc": "2026-09-19T20:00:00.000Z" },
    "routing": { "ok": false, "tuLuc": "2026-09-20T03:05:12.000Z", "loi": "Dịch vụ chỉ đường không phản hồi" },
    "data":    { "ok": true,  "tuLuc": "2026-09-19T20:00:00.000Z" }
  },
  "guiTrongNgay": { "ngay": "2026-09-20", "so": 1 }
}
```

**Ghi KV có chọn lọc.** Workers Free chỉ cho 1.000 lượt ghi KV mỗi ngày (quyết định đã ghi trong
DEVLOG 10/09). Cron chạy 288 lượt/ngày; ghi mỗi lượt là tiêu gần một phần ba hạn mức cho một việc
phụ. Vì vậy chỉ ghi khi **có chuyển trạng thái** hoặc khi `ghiLuc` cũ hơn **30 phút** (nhịp tim cho
mục 5.5). Tối đa khoảng 48 lượt ghi/ngày cộng số lần đổi trạng thái.

### 5.4 Thư

- Gửi bằng `chonEmailPort(env)` trực tiếp, **không** qua `guiThuGiaoDich`: hàm đó đếm ngân sách và
  ghi audit trong Postgres, mà Postgres có thể chính là thứ đang chết. Thư cảnh báo phải gửi được
  khi DB chết — đó là toàn bộ lý do nó tồn tại.
- Trần **10 thư/ngày** theo ngày UTC, đếm trong KV (`guiTrongNgay`). Resend gói miễn phí là 100
  thư/ngày cho cả tài khoản; 10 là đủ cho một hệ nhấp nháy tệ và không ăn vào mã đăng nhập của
  khách. Vượt trần: vẫn lưu trạng thái mới, ghi `console.warn`, không gửi.
- Tiêu đề: `[MapsLibVN] HỎNG: Định tuyến`, `[MapsLibVN] PHỤC HỒI: Định tuyến (hỏng 23 phút)`, hoặc
  gộp `[MapsLibVN] HỎNG: Cơ sở dữ liệu · PHỤC HỒI: Định tuyến`. Tiêu đề hiện trên màn hình khoá
  điện thoại, nên phải đọc một dòng là biết chuyện gì.
- Nội dung: từng thành phần một dòng — tên, thông điệp lỗi nguyên văn từ phép đo, thời điểm theo giờ
  Việt Nam; link `https://api.ai-solutions.io.vn/admin/health` (dựng từ `CONSOLE_ORIGIN`).
- Người nhận: biến `ALERT_EMAIL` mới. Không dùng lại `SUPPORT_EMAIL` dù cùng địa chỉ hôm nay: một
  cái là nơi khách trả lời, một cái là nơi máy gọi người trực; ngày chúng khác nhau không cần sửa mã.

### 5.5 Ai canh người canh

Cron chết thì im lặng, và im lặng trông giống hệt "mọi thứ tốt". Endpoint `/v1/admin/health` trả thêm
`watcher` đọc từ KV: `{ kiem_luc, gui_trong_ngay }` hoặc `null` khi chưa chạy lần nào. Trang Sức
khoẻ hiện một dòng dưới ba thẻ:

- chưa có → "Giám sát tự động chưa chạy lần nào";
- `kiem_luc` trong 60 phút → "Giám sát tự động: đo lần cuối HH:MM · đã gửi N cảnh báo hôm nay";
- cũ hơn 60 phút → cùng dòng nhưng tô `danger`: "… — cron có thể đang không chạy". Ngưỡng 60 phút vì
  nhịp ghi KV là 30 phút (5.3): dưới 30 phút thì trạng thái cũ 29 phút vẫn là bình thường.

## 6. Cấu hình

| Biến | Dev `[vars]` | `[env.production]` | Vắng thì |
|---|---|---|---|
| `ALERT_EMAIL` | không đặt | `dotienphong1993@gmail.com` | Lớp B không đo, báo cáo `thieu-cau-hinh` |

Không thêm secret nào: Resend đã có `RESEND_API_KEY`. `[triggers]` giữ nguyên hai lịch. Giá trị đặt
**trong file**, không `--var`: `deploy-api.yml` deploy không kèm cờ nên `--var` bị lần push sau xoá
(bẫy đã ghi cạnh `AUTOCOMPLETE_FAST`).

## 7. Kiểm thử

Tầng vitest của `apps/api` (pool Workers, KV thật của miniflare, **không** cần Postgres — binding
Hyperdrive trỏ cổng đóng nên phép đo DB luôn hỏng, đúng cảnh cần).

`test/health-canh-bao.test.ts` — tiêm `phepDo`, `emailPort`, `cho` (thay 15 s bằng 0), `now`:

1. lần đầu: không gửi, có ghi KV;
2. ok → hỏng: một thư, tiêu đề có tên thành phần, thân có thông điệp lỗi, trạng thái `ok:false`;
3. hỏng → hỏng: không gửi, `tuLuc` giữ nguyên;
4. hỏng → ok: một thư phục hồi có "hỏng N phút";
5. hai thành phần đổi cùng lượt: đúng một thư, cả hai tên trong tiêu đề;
6. nhấp nháy: lượt một hỏng, lượt đo lại tốt → không gửi, trạng thái không đổi; `cho` được gọi
   đúng một lần;
7. gửi thư ném lỗi: không đổi `ok` của thành phần vừa chuyển; lượt sau gửi lại;
8. thiếu `ALERT_EMAIL`: không gọi `phepDo`, báo cáo `thieu-cau-hinh`;
9. trần 10 thư/ngày: thư thứ 11 không gửi nhưng trạng thái vẫn lưu; sang ngày UTC mới đếm lại;
10. ghi KV có chọn lọc: không đổi trạng thái và `ghiLuc` mới → **không** `put`; `ghiLuc` cũ hơn
    30 phút → có `put`.

`test/email-mau-canh-bao.test.ts` — có cả `html` và `text`; tiêu đề đúng ba dạng ở 5.4.

`test/scheduled.test.ts` — cron `*/5` xếp **hai** việc nền (đơn hàng + sức khoẻ) và không ném khi DB
không nối được; cron `0 2` chỉ một việc. Tầng test không có `ALERT_EMAIL` nên việc sức khoẻ kết
thúc `thieu-cau-hinh` — cố ý: có nó thì ba phép đo đều hỏng và bài test phải chờ 15 s đo lại.

`test/admin-health.test.ts` — `watcher` là `null` khi KV trống; đúng nội dung khi có trạng thái.
Các bài cũ giữ nguyên: tách hàm không được đổi hình dạng phản hồi.

`apps/admin/src/features/health/page.test.tsx` — dòng giám sát ba trạng thái (chưa chạy / mới / cũ
hơn 60 phút).

## 8. Điểm mù còn lại, cố ý

- **Cloudflare Workers ngừng chạy cron** → lớp B im, lớp A vẫn báo được máy chủ ngủ, và dòng 5.5
  cho thấy "cron có thể đang không chạy" khi PHONG mở trang. Che nốt cần một dịch vụ ngoài gọi
  `/healthz/db` định kỳ; chưa cần khi mới có một người vận hành.
- **Resend chết cùng lúc** → thư không đi, log có `email_send_failed_*`, lượt sau thử lại.
- **Tunnel lên, Access hỏng token** → lớp B bắt (định tuyến trả 302 → hỏng), lớp A không.

## 9. Nghiệm thu

1. Toàn bộ cổng xanh: `pnpm test`, `pnpm typecheck`, `pnpm lint`.
2. Chính sách `tunnel_health_event` tồn tại trong tài khoản (đọc lại bằng API), email **đã xác nhận**
   (PHONG bấm link trong thư của Cloudflare).
3. Sau deploy, chậm nhất 5 phút KV `health:canh-bao` có `kiemLuc` (đọc bằng `wrangler kv key get`).
4. **Diễn tập đường thư không cần làm hỏng gì:** ghi tay vào KV trạng thái `routing.ok=false` với
   `tuLuc` 10 phút trước; lượt cron kế tiếp thấy định tuyến tốt → PHONG nhận thư
   `[MapsLibVN] PHỤC HỒI: Định tuyến (hỏng ~10 phút)`. Đây là bằng chứng đầu-cuối cho cả đo, so, gửi
   và người nhận, trên production, không đụng dịch vụ nào.
5. Trang `/admin/health` hiện dòng giám sát với giờ đo gần đây.

## 10. Tài liệu đi kèm

- `apps/docs/src/content/docs/tu-host.md` mục 6: thay câu chung chung bằng hai lớp thật.
- `infra/server/README.md` bước 5: "tuỳ chọn" → bắt buộc, kèm bộ lọc `down`.
- `docs/DEVLOG.md` mục 27 và `docs/evidence/health/2026-09-20-canh-bao-suc-khoe.md` (bằng chứng
  nghiệm thu mục 9).
