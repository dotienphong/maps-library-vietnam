# Rollout, sao lưu và phục hồi sổ quota — 15/09/2026

Tài liệu vận hành cho plan `2026-09-15-quota-thue-bao.md` Task 6–7. Gồm quy trình bật/tắt
commercial, sao lưu sổ quota và diễn tập phục hồi.

**Trạng thái: commercial VẪN ĐÓNG.** `COMMERCIAL_ADMISSION=0` ở cả dev lẫn production. Mọi số
trong file này là kết quả cổng LOCAL; phần staging/production đánh dấu **CHỜ PHONG** chưa chạy.

## 1. Sổ quota được sao lưu như thế nào

Sổ nằm trong SQLite Durable Object của từng tenant, không nằm trong Postgres, nên backup DB hằng
ngày **không** chạm tới nó. Bản sao lưu gồm hai phần:

| Phần | Nội dung | Vì sao cần |
|---|---|---|
| Snapshot | entitlement, period, counter, credit_grant, reservation còn treo + mới đóng, missed_ack, entitlement_event, business_identity, operational_command, revoked_key, export_checkpoint | Toàn bộ số dư và mọi mốc chống trùng giao dịch |
| Đuôi journal | Mỗi lượt ACK thành công, mỗi lệnh quyền, mỗi lần thu hồi khoá — có số thứ tự liền mạch | Snapshot chỉ đúng tại một thời điểm; các khoản tính SAU đó nằm ở đây |

Snapshot được dựng trong **một** transaction rồi mới cắt thành trang (≤100 bản ghi hoặc ≤256 KiB
mỗi trang). Xuất từng bảng bằng nhiều lần đọc rời sẽ cho bản chắp vá — `counter` đã cộng một lượt
mà `reservation` thì chưa — và nạp lại bản đó là tính tiền sai.

Số thứ tự journal được cấp trong **cùng** transaction với thay đổi nó mô tả, nên transaction bị
rollback thì số cũng không bị tiêu. Vì vậy một lỗ thủng trong dãy số luôn có nghĩa là **mất dữ
liệu thật**, và trình phục hồi dừng hẳn thay vì coi khoản thiếu bằng 0.

`reserved` (chỗ đang giữ) **không** được phục hồi: sau sự cố mọi request đang bay đều đã hỏng,
nên trả chỗ về cho khách là sai số nghiêng đúng phía theo quyết định mục 6 của spec.

### Giới hạn phải nói rõ

- Checksum chứng minh **toàn vẹn của file sao lưu**, không chứng minh sổ bên trong object chưa bị
  ai sửa: người có quyền ghi storage của object thì sửa được cả dãy số lẫn checksum.
- Journal chỉ bị cắt sau khi checkpoint nhích. Nếu backup ngừng chạy nhiều ngày, journal phình
  theo lưu lượng. `pending` trong `/backup/journal` là con số phải theo dõi.
- Trong lúc phát lại journal, **không** được gửi lệnh quản trị khác lên cùng tenant.

## 2. Quyền và biến môi trường

| Biến | Nơi đặt | Ghi chú |
|---|---|---|
| `BILLING_ADMIN_EMAILS` | var của Worker | Cấp gói, trial, credits, đổi mode |
| `BILLING_BACKUP_EMAILS` | var của Worker | **Tách riêng** — sao lưu/ghi đè sổ. Rỗng = deny |
| `BILLING_ACCESS_CLIENT_ID` / `_SECRET` | `.env` máy vận hành | Service token Cloudflare Access cho CLI |
| `BACKUP_PASSPHRASE` | `infra/server/.env` | Cùng passphrase với backup DB; mất là không giải mã được |
| `BACKUP_BUCKET` | `infra/server/.env` | Phải là bucket riêng không gắn custom domain |

Quyền cấp gói **không** kéo theo quyền ghi đè sổ tiêu thụ: đó là hai việc khác hẳn nhau, và
`billing_backup_forbidden` là bằng chứng cổng này thật sự tách (test `billing-admin.test.ts`).

## 3. Sao lưu định kỳ

```sh
pnpm audit:quota export --tenant <uuid> --base https://api.ai-solutions.io.vn
```

Thứ tự bên trong, **không được đổi**:

1. `POST /backup/snapshot` → đóng băng snapshot, trả manifest (sequence + checksum).
2. `GET /backup/snapshot/:id/:index` → từng trang, mỗi trang có checksum riêng.
3. `GET /backup/journal?after=<sequence>` → đuôi phát sinh trong lúc đang tải trang.
4. Kiểm lại checksum **phía client** bằng chính chuỗi byte đã tải.
5. Mã hoá AES-256 (PBKDF2 600k vòng) rồi đẩy lên `r2:<BACKUP_BUCKET>/quota-audit/<tenant>/`.
6. **Chỉ khi bước 5 xong** mới `POST /backup/checkpoint` — chốt và cắt journal.

Chốt trước bước 5 là cách chắc chắn nhất để mất đúng đoạn journal vừa bị cắt. Test
`scripts/quota-audit.test.mjs` khoá thứ tự này: khi `persist` ném lỗi, checkpoint không được gọi.

Kiểm một file đã lưu, không cần mạng:

```sh
pnpm audit:quota verify --file out/quota-audit/quota-20260916-0300.json.enc
```

Báo cáo in ra chỉ có số đếm, trạng thái và checksum — không băm khoá, không truy vấn, không toạ độ.

## 4. Phục hồi

**Không bao giờ** nạp bản sao lưu lên một object đang nhận traffic. Ba cổng chặn, theo thứ tự:

1. `not_in_maintenance` — chưa bật bảo trì.
2. `snapshot_stale` — sổ đã đi xa hơn bản sao lưu; nạp vào sẽ xoá sạch lượt tính giữa hai mốc.
3. `traffic_active` — object còn thấy reservation trong 60 giây qua. Đây là **bằng chứng** traffic
   đã dừng, không phải lời hứa của người vận hành: cổng admission đóng ở tầng ngoài vẫn có thể
   còn request dở đang bay tới.

```sh
# 1. Đóng cổng admission ở tầng ngoài trước (xem mục 5)
# 2. Nạp; script tự bật bảo trì, nạp từng trang rồi phát lại journal theo lô ≤100
pnpm audit:quota restore --tenant <uuid> --file <...enc> --base <...> --yes
# 3. Đối chiếu số, rồi mới tắt bảo trì bằng POST /backup/maintenance {enabled:false}
```

Script **cố tình không** tự tắt bảo trì: phải đối chiếu `used`/`credits` với báo cáo trước khi mở
lại cho khách.

**Thiếu đuôi journal thì dừng, không đoán.** `journal_gap` giữ nguyên trạng thái, không áp một
nửa rồi báo xong. Khi đó giữ maintenance và đối soát tay có audit — mở lại từ snapshot cũ như thể
số dư đúng chính là kiểu hỏng mà spec 14.6 cấm.

## 5. Bật commercial cho một tenant

1. **Provision DO**: `POST /v1/admin/billing/:tenantId/commands` với `activateTrial` hoặc
   `grantPeriod`. Tenant commercial thiếu entitlement sẽ fail closed, không rơi về quota cũ.
2. **Đóng cổng admission** (`COMMERCIAL_ADMISSION=0`) trước khi đổi mode.
3. **Vô hiệu cache auth**: `POST /v1/admin/billing/:tenantId/mode` đã tự xoá `apikey:<hash>` của
   mọi khoá thuộc tenant. TTL 5 phút **không** phải bằng chứng: KV là eventually consistent, nên
   phải kiểm entry mới có `issuedAt`/`expiresAt` tuyệt đối, không chỉ chờ hết TTL.
4. **Mở cổng admission** (`COMMERCIAL_ADMISSION=1`).
5. **Thử nhiều khoá** của cùng tenant: hai khoá phải cộng chung một sổ; đổi/thu hồi khoá không
   reset quota.
6. Mở traffic thật.

**Rollback**: dừng tenant tại cổng admission (bước 2), **giữ nguyên** DO và ledger rồi sửa.
Không `deleteAll`, không reset object, không fallback về bộ đếm KV — đổi mode trong DB không phải
kill switch.

## 6. Cổng đã chạy

| Cổng | Kết quả | Ngày |
|---|---|---|
| `pnpm --filter @mapslibvn/api test` | 44 file / 333 test xanh (gồm `billing-backup.test.ts` 7 ca) | 15/09/2026 |
| `pnpm test` (gốc) | 142 file / 1.504 test xanh (3 skip), gồm `quota-audit` 13 ca và A/B `load-api` | 15/09/2026 |
| `pnpm test:api-db` | 3 file / 53 test xanh trên DB cô lập | 15/09/2026 |
| `pnpm typecheck` | 14/14 | 15/09/2026 |
| `pnpm lint` | sạch | 15/09/2026 |
| Diễn tập phục hồi trên tenant thử (staging) | **CHỜ PHONG** — cần deploy + service token Access | — |
| Đo tải commercial A/B | mục 7 dưới | — |

Ca đã khoá bằng test, mức Durable Object:

- Checkpoint từ chối checksum sai; chỉ nhích khi người gọi cầm đúng chuỗi byte đã ghi.
- Snapshot `used=10` + đuôi 3 khoản → phục hồi ra **13**, phát lại lần hai vẫn 13.
- Phát lại lệnh cấp credits không cộng đôi 1.000 lượt.
- Snapshot cũ nạp lên sổ đã đi xa hơn → `snapshot_stale`, sổ giữ nguyên 13.
- Chưa bảo trì → `not_in_maintenance`; còn traffic → `traffic_active`.
- Đuôi thủng → `journal_gap`, `used` giữ nguyên 4 (không áp một nửa).
- Bản xuất không mang băm khoá, truy vấn hay toạ độ của khách.

## 7. Đo tải và chi phí

### Bộ đo đã có

`scripts/load-api.mjs` nhận thêm ba chế độ để trả lời đúng câu hỏi "quota thương mại đắt thêm bao
nhiêu", thay vì chỉ đo được năng lực tổng:

```sh
# A/B: cùng bộ URL, nhánh A khoá tenant legacy, nhánh B khoá tenant commercial
MAPSLIBVN_API_KEY=<legacy> MAPSLIBVN_API_KEY_B=<commercial> \
  pnpm load:api --mode=ab --levels=25 --cache=cold

# Đường cache: mọi VU dùng chung một URL đã mồi → đo cache hit thay vì đo DB
… pnpm load:api --mode=ab --levels=25 --cache=warm

# Nhiều tenant cùng lúc, mỗi tenant một dải URL riêng
… pnpm load:api --mode=mixed --levels=10
```

Bốn quyết định thiết kế đáng ghi:

- **Hai nhánh chạy lần lượt, không song song.** Chạy cùng lúc thì hai nhánh tranh chính origin
  đang đo, và phần chênh lệch sẽ lẫn cả tải do nhánh kia gây ra.
- **Cùng bộ URL.** `targetPath` chỉ phụ thuộc `(users, index, group, cache)` nên hai nhánh chạm
  đúng cùng dữ liệu; test khoá điều này bằng cách so danh sách URL của hai nhánh.
- **Nghỉ 65 giây giữa hai nhánh** để burst limit không làm bẩn số đo. Đo overhead thì phải giữ
  nhịp dưới burst — chuyện "burst còn hoạt động không" là nghiệm thu **riêng** bằng
  `pnpm smoke:rate-limit`, không trộn vào cùng một lượt chạy.
- **Chế độ warm mồi cache trước mỗi nhánh.** Không mồi thì nhánh đầu gánh toàn bộ chi phí nạp
  cache và "chi phí quota" đo được sẽ mang dấu âm.
- **`mixed` báo số của từng tenant**, kèm p95 tệ nhất. Gộp thành một p95 chung sẽ giấu mất chuyện
  một tenant đang bị tenant khác làm chậm.

### Số đo: CHƯA CÓ

**Chưa chạy được lượt đo nào có ý nghĩa**, và không có số nào trong mục này được suy ra thay.
Lý do: `COMMERCIAL_ADMISSION=0` ở mọi môi trường và chưa có tenant commercial nào được provision,
nên nhánh B của A/B không tồn tại. Đo nhánh A rồi gọi đó là "chi phí quota" sẽ là con số bịa.

Cần PHONG làm trước khi có số:

1. Deploy bản hiện tại lên staging (hoặc production với `COMMERCIAL_ADMISSION` vẫn `0`).
2. Provision một tenant thử: `activateTrial` hoặc `grantPeriod`, đặt `quota_mode=commercial`.
3. Cấp hai khoá: một của tenant legacy, một của tenant thử.
4. Chạy ba lệnh ở trên, lưu bảng kết quả vào chính mục này.
5. Đối chiếu Cloudflare **Usage/Billing** thật cho DO requests, rows read/written, duration và
   storage — GraphQL Analytics theo tài liệu Cloudflare không phải hoá đơn chính xác.

Ngưỡng đề xuất từ Task 0 (chưa phải SLA, PHONG duyệt sau khi có số thật): overhead quota
p95 ≤ 100 ms và p99 ≤ 250 ms trên request cache-hit; không có lỗi nào do quota gây ra ở mức tải pilot.

### Chi phí: phần suy ra được, và phần phải đo

Task 0 đã **đo** chuỗi reserve→prepare→ACK bằng `SqlStorageCursor`: **11 rows read, 14 rows
written** mỗi lượt thành công, đã gồm index.

Task 6 thêm sổ journal vào đúng đường nóng đó. Mỗi lượt ACK thành công ghi thêm một dòng
`journal` và một lần cập nhật `ledger_meta` — **ước tính +2 ghi và +1 đọc**, tức khoảng
**16 ghi / 12 đọc** mỗi lượt. Đây là con số **suy ra từ số câu lệnh SQL, chưa đo**; phải đo lại
bằng chính cursor billing counters khi có tenant thử, vì index và ghi thực tế không nhất thiết
khớp số câu lệnh.

Quy đổi thô cho Business 440.000 lượt/tháng: khoảng 1,32 triệu DO request và **7,04 triệu row
writes** (Task 0 tính 6,16 triệu khi chưa có journal), vẫn nằm trong Workers Paid (1 triệu DO
request và 50 triệu writes/tháng trong gói). Phần vượt gói vẫn ở mức vài xu mỗi tháng.

Dung lượng journal là chi phí **mới** Task 0 chưa tính: journal chỉ bị cắt khi checkpoint nhích,
nên nếu sao lưu chạy hằng ngày thì nó giữ khoảng một ngày lưu lượng. Ở mức Business
(~14.700 lượt/ngày) đó là cỡ vài MB mỗi tenant — nhỏ, nhưng **backup ngừng chạy thì nó lớn không
giới hạn**. `pending` trong `/backup/journal` là con số phải theo dõi, không phải chi tiết nội bộ.

Free tier của Workers là hạn mức **toàn tài khoản**, không phải mỗi tenant: cạn allocation có thể
làm outage hàng loạt tenant cùng lúc. Phải xác nhận tài khoản đang ở Workers Paid trước khi mở bán.

## 8. Việc còn lại trước khi bật commercial

| Việc | Ai làm | Vì sao máy không tự làm được |
|---|---|---|
| Deploy + provision tenant thử | PHONG | Cần deploy và ghi vào DB máy chủ production |
| Chạy A/B, mixed, warm/cold rồi điền mục 7 | PHONG | Phụ thuộc tenant thử ở trên |
| Đối chiếu Cloudflare Usage/Billing | PHONG | Cần đăng nhập dashboard |
| Diễn tập phục hồi trên tenant thử | PHONG | Cần service token Access và object thật |
| Duyệt ngưỡng latency/chi phí | PHONG | Quyết định kinh doanh |
| Đặt `BILLING_BACKUP_EMAILS` cho production | PHONG | Là cấu hình Worker, không nằm trong repo |
| Bật `COMMERCIAL_ADMISSION=1` | PHONG | Chỉ sau khi năm việc trên xong |
