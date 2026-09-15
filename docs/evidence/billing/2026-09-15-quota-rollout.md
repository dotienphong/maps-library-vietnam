# Rollout, sao lưu và phục hồi sổ quota — 15/09/2026

Tài liệu vận hành cho plan `2026-09-15-quota-thue-bao.md` Task 6–7. Gồm quy trình bật/tắt
commercial, sao lưu sổ quota và diễn tập phục hồi.

**Trạng thái 15/09/2026: quota thương mại ĐÃ MỞ trên production.** `COMMERCIAL_ADMISSION = "1"`
nằm trong `[env.production]` của `wrangler.toml`, nên mặc định của kho mã giờ là MỞ. Dev vẫn `"0"`.
Đóng khẩn cấp không cần sửa file:
`wrangler deploy --env production --var COMMERCIAL_ADMISSION:0`.

**Nhưng chưa bán cho ai.** Hai tenant đang ở `quota_mode=commercial` đều là tenant thử (`…bb`,
`…dc`); không khách thật nào được chuyển. Mở cổng chỉ nghĩa là hệ thống sẵn sàng phục vụ khi có
tenant thương mại, không phải đã có khách trả tiền.

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
- Việc cắt journal chạy theo lô có trần (1.000 dòng mỗi lần chốt, 100 dòng mỗi lần alarm) nên một
  ngày lưu lượng lớn không dồn thành một câu `DELETE` khổng lồ. Hệ quả: ngay sau khi chốt, dung
  lượng có thể chưa giảm hết — nó giảm dần qua các lần alarm kế tiếp.
- Trong lúc phát lại journal, **không** được gửi lệnh quản trị khác lên cùng tenant.

## 2. Quyền và biến môi trường

| Biến | Nơi đặt | Ghi chú |
|---|---|---|
| `BILLING_ADMIN_EMAILS` | `wrangler secret put … --env production` | Cấp gói, trial, credits, đổi mode |
| `BILLING_BACKUP_EMAILS` | `wrangler secret put … --env production` | **Tách riêng** — sao lưu/ghi đè sổ. Rỗng = deny |
| `BILLING_ACCESS_JWT` | môi trường shell của máy vận hành | JWT **người dùng** từ `cloudflared access token` |
| `BACKUP_PASSPHRASE` | `infra/server/.env` | Cùng passphrase với backup DB; mất là không giải mã được |
| `BACKUP_BUCKET` | `infra/server/.env` | Phải là bucket riêng không gắn custom domain |

Hai danh sách email đặt bằng `wrangler secret put` chứ không viết vào `wrangler.toml`: khối
`[env.production] vars` nằm trong git, mà đây là danh sách kiểm soát truy cập. Cả hai đã được đặt
trên production ngày 15/09/2026; trước đó chúng vắng mặt, nghĩa là API quản trị billing deny mọi
người — đây là thứ chặn ngay bước provision đầu tiên.

Xác thực CLI phải dùng JWT **người dùng**, không dùng service token: `verifyAccessJwt` bắt buộc có
claim `email` để ghi `actor` vào audit, mà JWT của service token chỉ mang `common_name`. Service
token qua được biên Access rồi chết ở Worker với `invalid_access_jwt`.

```sh
cloudflared access login https://api.ai-solutions.io.vn/v1/admin
export BILLING_ACCESS_JWT=$(cloudflared access token -app=https://api.ai-solutions.io.vn/v1/admin)
```

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
6. **Đo vị trí object TRƯỚC khi mở traffic** — bước bắt buộc, thêm 15/09/2026:

   ```sh
   curl -s -D - -o /dev/null -H "X-Api-Key: <khoá tenant mới>" \
     "https://api.ai-solutions.io.vn/v1/autocomplete?q=hue&limit=1&near=10.79,106.70" \
     | grep -i '^server-timing'
   ```

   Cộng `reserve` và `prepare`: phải **≤ 150 ms** (ngưỡng PHONG chốt ở mục 7a). Nếu ra ~500 ms thì
   object đã bị đặt xa và **không đổi chỗ được** — Cloudflare chỉ đọc `locationHint` ở lần `get()`
   đầu tiên. Khi đó phải dựng lại object dưới một tên khác rồi chuyển sổ bằng export/restore của
   Task 6, TRƯỚC khi có khách dùng. Nhớ ACK receipt mà lệnh trên tạo ra, hoặc bỏ qua và chấp nhận
   một `missed_ack`.
7. Mở traffic thật.

Hai lệnh điều khiển cổng admission:

```sh
pnpm deploy:api:open-commercial   # deploy kèm --var COMMERCIAL_ADMISSION:1 → MỞ
pnpm deploy:api                   # deploy thường → wrangler.toml đưa về "0" → ĐÓNG
```

`--var` chỉ sống trong đúng bản deploy mang nó. `wrangler.toml` vẫn ghi `"0"`, nên mặc định của
kho mã là đóng và mọi lần `pnpm deploy:api` thường đều đóng lại. Đó là tính chất mong muốn, nhưng
nó sẽ cắn người đang đo tải nếu deploy giữa chừng mà quên. Sau mỗi lần dùng `--var`, kiểm
`/healthz/routing` để chắc cờ chỉ ghi đè đúng một biến chứ không thay cả khối vars.

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

### Số đo trên production — 15/09/2026

Tenant pilot `…bb` trên production, `COMMERCIAL_ADMISSION=1`, gói Starter. Nhánh nền là tenant
legacy (`KEY_EXAMPLE_EMBED`, plan `internal`).

**Nghiệm thu chức năng — ĐẠT.** `pnpm smoke:commercial` cho **25/25**, gồm: receipt đủ ba header
và `private, no-store`; chưa ACK thì chưa trừ lượt; ACK trừ đúng một lượt và ACK lặp không trừ
thêm; 4xx không trừ; HEAD trả 405 + `Allow`; hai khoá cùng tenant cộng chung một sổ; bảo trì trả
503 `quota_unavailable`; đình chỉ trả 403 `subscription_expired`.

Thêm hai tiêu chí của spec mục 12 được chứng minh ngoài kịch bản: **trần ngày của trial chặn đúng**
(lượt thứ 201 trả `quota_exceeded` / `reason: daily` / `resetAt` thật, không phải hằng số), và
**thu hồi khoá có hiệu lực** qua route quản trị.

**Chi phí độ trễ — KHÔNG ĐẠT ngưỡng đề xuất.** Đo A/B warm, 3 đồng thời × 10 wave, gộp 30 mẫu:

| Lượt | Số vòng gọi DO | Chênh lệch p50 |
|---|---|---:|
| Trước khi gộp `revoke` | 3 | **+677 ms** |
| Sau khi gộp `revoke` vào `reserve` | 2 | **+557 ms** |

Bỏ một vòng lấy lại đúng ~120 ms. Ngưỡng Task 0 đề xuất là p95 ≤ 100 ms; thực tế vượt khoảng 5–6 lần.

**Chi phí nằm ở đâu — đã xác định.** `Server-Timing` đo bên trong Worker (n=29, p50):

| Vòng gọi | p50 | Ghi chú |
|---|---:|---|
| `ping` | **257 ms** | KHÔNG chạm storage, chỉ trả `Date.now()` |
| `reserve` | 282 ms | +25 ms so với ping = việc thật bên trong |
| `prepare` | 268 ms | +11 ms |

`ping` là phép đo quyết định: chi phí **không phải** chờ ghi bền vững (~10–25 ms, bình thường) mà
là **đường mạng tới object**, nhân theo số vòng gọi. Xác nhận chéo bằng đường quản trị: `/usage`
của tenant pilot 761 ms p50 so với 533 ms của một tenant không tồn tại (404 trước khi chạm DO) →
228 ms cho một vòng gọi, khớp với 257 ms đo từ trong Worker.

Đối chiếu: Task 0 đo cả **ba** vòng ở staging chỉ 37 ms p95, tức ~12 ms mỗi vòng. Chênh ~20 lần
với cùng một đoạn mã. Nghĩa là 250 ms không phải bản chất của Durable Object mà là đặc tính của
**object cụ thể này** — nó được tạo bởi một lệnh quản trị chứ không phải bởi traffic thật, đúng
kiểu tài liệu Cloudflare cảnh báo làm xấu độ trễ, và object đã tạo thì không đổi chỗ được.

**`locationHint` CÓ cứu được — đã chứng minh.** Tenant thử `…dc` được tạo riêng cho phép đo này
(seed `db/seed/tenant_quota_probe.sql`), nên object của nó ra đời SAU khi mã có hint. So sánh hai
object thương mại, cùng mã, cùng thời điểm, đo bằng `Server-Timing` (n=24 mỗi lượt):

| Object | `reserve` p50 | `prepare` p50 | Tổng |
|---|---:|---:|---:|
| `…bb` — tạo trước khi có hint | 291 ms | 270 ms | ~560 ms |
| `…dc` — `apac-se`, lượt 1 | **52 ms** | **42 ms** | **~94 ms** |
| `…dc` — `apac-se`, lượt 2 | **76 ms** | **49 ms** | **~125 ms** |

Nhanh hơn **4–6 lần**, ổn định qua hai lượt độc lập. Kết hợp với phép đo `ping` ở trên, chuỗi
suy luận khép kín: chi phí là đường mạng tới object → object đặt sai chỗ → đặt đúng chỗ thì hết.

**Hệ quả vận hành: không cần di chuyển gì.** `quotaObject()` đã gắn hint cho mọi lần cấp phát, nên
tenant mới tự động được đặt đúng. Object đặt sai duy nhất là `…bb`, một tenant thử. Nếu sau này có
tenant THẬT rơi vào object đặt sai, đường di chuyển là export/restore của Task 6 kèm đổi tên object
(ví dụ thêm tiền tố phiên bản) — nhưng hiện chưa cần, và spec 14.7 cấm đổi `idFromName` tuỳ tiện.

**Một chỗ chưa khớp, ghi lại thay vì lờ đi.** Lượt đo legacy so với `…dc` cho chênh lệch đầu-cuối
333 ms p50 trong khi hai vòng gọi chỉ 125 ms — dư ~208 ms không giải thích được. Ở object cũ thì
hai con số khớp nhau (557 so với 550). Nhiều khả năng là nhiễu giữa hai tenant khác nhau trên
production, nhưng **chưa được chứng minh**, nên chi phí thật của một object đặt đúng chỗ nằm đâu đó
trong khoảng 125–333 ms chứ không phải một con số chốt.

### Độ nhiễu của chính phép đo — phải ghi lại

Sáu trong chín lượt đo bị từ chối, và bộ đo phải sửa năm lần mới bắt được hết các kiểu hỏng:
nhánh sau hưởng cache của nhánh trước; `--repeat` biến cold thành warm; không ACK receipt làm
tenant tự khoá; **không request nào thành công mà vẫn báo số**; **mọi request thành công nhưng
không nhánh nào chạm sổ quota**. Hai cái cuối nguy hiểm nhất vì con số in ra trông hoàn toàn hợp lý.

Một lượt chạy 30 mẫu trên production **không** phân biệt được 250 ms với 400 ms. Mọi kết luận ở
trên chỉ dựa vào `Server-Timing` đo bên trong Worker, hoặc vào chênh lệch đủ lớn để vượt nhiễu.

### Việc đo còn thiếu

1. Giải thích ~208 ms chênh giữa đo đầu-cuối và tổng `Server-Timing` trên object đặt đúng chỗ,
   hoặc chạy đủ nhiều lượt để chứng minh đó chỉ là nhiễu.
2. Đối chiếu Cloudflare **Usage/Billing** thật cho DO requests, rows read/written, duration và
   storage — GraphQL Analytics theo tài liệu Cloudflare không phải hoá đơn chính xác.
3. PHONG chốt ngưỡng dựa trên số thật. Ngưỡng Task 0 đề xuất (p95 ≤ 100 ms) được rút ra từ staging
   nơi một vòng gọi tốn ~12 ms; nó không đại diện cho production và cần xem lại.

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

## 7a. Ngưỡng đã chốt và chi phí thật

**PHONG chốt 15/09/2026: chi phí quota p50 ≤ 150 ms là cổng phát hành.**

Ngưỡng ≤100 ms p95 mà Task 0 đề xuất **bị bỏ**: nó rút từ staging nơi một vòng gọi tốn ~12 ms, còn
production một vòng đã 50–76 ms và mỗi request tính lượt cần hai vòng. p95 chuyển sang **theo dõi,
không làm cổng** — dữ liệu p95 hiện quá mỏng, có lượt vọt 450 ms từ một mẫu lẻ.

Đối chiếu ngưỡng với số đo:

| Tenant | Chi phí quota p50 | Ngưỡng 150 ms |
|---|---:|---|
| `…dc` — object đặt đúng chỗ (`apac-se`) | 94–125 ms | **ĐẠT** |
| `…bb` — object đặt sai chỗ | ~560 ms | **TRƯỢT** |

**Hệ quả quan trọng: cổng này là theo TỪNG TENANT, không phải một lần cho cả hệ thống.** Cùng một
đoạn mã cho hai kết quả cách nhau 4–6 lần chỉ vì vị trí object. Vì vậy quy trình cấp phát ở mục 5
có thêm một bước bắt buộc: đo `Server-Timing` của tenant mới TRƯỚC khi mở traffic.

### Chi phí tiền — không phải rủi ro ở quy mô này

Cloudflare Billable Usage kỳ 24/08–24/09: **$0.00, chưa phát sinh khoản tính tiền nào.**

| Chỉ số | Kỳ hiện tại | Mỗi DO request |
|---|---:|---:|
| DO requests | 1.980 | — |
| SQL rows read | 28.200 | 14,2 |
| SQL rows written | 5.160 | 2,6 |
| Duration | 28,1 GB-s | 14,2 ms·GB |
| SQL storage | 303,1 kB | 60,6 kB mỗi object |

Quy đổi thô cho Business 440.000 lượt/tháng (3 DO request mỗi lượt): ~1,32 triệu DO request,
~18,8 triệu rows read, ~3,44 triệu rows written, ~18.700 GB-s, và ~0,1 GB lưu trữ cho 1.000 tenant.

**Ba cảnh báo về con số này, đừng dùng nó làm dự toán:**

1. Gần như toàn bộ 1.980 request là **traffic thí nghiệm hôm nay**, và mix đó nặng về đọc — lệnh
   quản trị, export, restore, inventory. Không giống hình dạng traffic thật.
2. Vì vậy **2,6 writes mỗi request gần như chắc chắn là thấp hơn thực tế**: Task 0 đo riêng chuỗi
   reserve→prepare→ACK được 14 writes mỗi lượt thành công, và Task 6 còn thêm một dòng journal nữa.
3. 18 lỗi trong 24 giờ qua là các lượt 503/timeout của chính đợt đo, đã được giải thích ở mục 7.

Đọc lại dashboard sau vài ngày có traffic thật thì widget Billable Usage tự hiện số tiền, không
phải tự nhân giá. Link:
`dash.cloudflare.com/90de8c1aef96991cdf2a49008f9a0122/workers/durable-objects`.

## 7b. Diễn tập phục hồi — ĐẠT 15/09/2026

Chạy thật trên production, tenant nguồn `…dc` → tenant đích `…dd` (object khác, theo spec mục 10
cấm nạp lên object đang nhận traffic).

```sh
pnpm server:seed-tenant db/seed/tenant_quota_probe.sql   # tạo tenant đích
node scripts/quota-audit.mjs export  --tenant …dc --no-upload
node scripts/quota-audit.mjs verify  --file out/quota-audit/quota-20260915-2324.json.enc
node scripts/quota-audit.mjs restore --tenant …dd --file … --yes
```

| Bước | Kết quả |
|---|---|
| Xuất | 4 bản ghi, 1 trang, checkpoint chốt ở sequence 51 |
| Kiểm file `.enc` độc lập | `✓ Bản sao lưu toàn vẹn` |
| Nạp sang object đích | `applied`, sổ đích vào bảo trì |
| Đối chiếu | `tier`, `used=50`, `limit=2000`, `periodId`, `endsAt` **khớp từng trường** |
| Khép chu trình | tắt bảo trì trên đích, `maintenance: false` |

Script cố tình để sổ đích trong bảo trì sau khi nạp; người vận hành phải đối chiếu số rồi mới tắt.

## 7c. Đối chiếu 15 tiêu chí nghiệm thu (spec mục 12)

**P** = chứng minh trên production hôm nay. **T** = chỉ có test (Durable Object hoặc API). **—** = chưa kiểm.

| # | Tiêu chí | | Bằng chứng |
|---|---|---|---|
| 1 | Trần ngày Places/directions, hai nhóm độc lập | **P** một phần | Places thứ 201 trả `quota_exceeded`/`daily` kèm `resetAt` thật. Directions chưa kiểm |
| 2 | Hết tổng trial không mở lại; hết 30 ngày chặn | **T** | Cần 2.000 request hoặc chờ 30 ngày |
| 3 | Nhiều khoá chung sổ; tenant độc lập; revoke không reset | **P** | Smoke 25/25; hai tenant thử có sổ riêng; thu hồi khoá không đổi `used` |
| 4 | 50 reserve tranh lượt cuối, chỉ 1 allowed | **T** | `billing-reservations.test.ts` |
| 5 | 2xx kể cả cache chỉ tính sau ACK; 4xx/5xx không tính | **P** | Smoke: `chưa ACK thì chưa trừ`, `lỗi 4xx không trừ` |
| 6 | Worker crash sau reserve: lease giải phóng, idempotent | **T** | `billing-reservations.test.ts` |
| 7 | Qua giao ngày/kỳ khi request còn chạy | **T** | `billing-reservations.test.ts` — ACK sau nửa đêm commit vào sổ ngày ĐẶT CHỖ, sổ ngày mới không mọc dòng |
| 8 | Mua 1 khối = 1.000, replay không tăng, payload khác bị từ chối | **P** | `credits=1000`; replay trả receipt cũ; `business_identity_conflict` 409 |
| 9 | Hết nhóm này không chặn nhóm kia; mua thêm mở đúng nhóm; hết quyền vẫn chặn | **P** một phần | Credits chỉ vào Places, directions vẫn 0; đình chỉ → 403. Chưa cạn nhóm trả phí |
| 10 | Tháng 28–31 ngày, revision out-of-order, trial→paid, cấp kỳ lặp | **P** một phần | trial→paid chạy thật, kỳ mới không mang `used` cũ. Còn lại là test |
| 11 | DO lỗi/timeout fail closed 503, không fallback KV | **P** | Bảo trì → 503 `quota_unavailable`; `reserve` quá 2 giây → 503 |
| 12 | Không lộ usage qua khoá public; admin có quyền, audit, idempotency | **P** | 401 thiếu Access, 403 `billing_backup_forbidden`, replay lệnh trả receipt cũ |
| 13 | Bảo toàn burst/internal, cache, envelope lỗi; docs đúng runtime | **P** | `smoke:rate-limit` chặn ở request 61; tenant legacy vẫn `public, max-age=3600`, không receipt header |
| 14 | A/B hiệu năng và chi phí DO | **P** một phần | Độ trễ xong (mục 7). Chi phí tiền chưa — chưa mở Usage/Billing |
| 15 | Nghiệm thu rollout/rollback và recovery trên tenant thử | **P** | Mục 7b; rollback bằng cổng admission đã dùng thật nhiều lần |

**10/15 chứng minh trên production, 5 dựa vào test, 0 bỏ trống.** Hai tiêu chí còn thiếu bằng chứng
production (hết tổng 2.000 lượt, hết hạn 30 ngày) tốn thời gian thật chứ không thiếu cơ chế.

Tiêu chí 7 lúc đầu bỏ trống hoàn toàn — cơ chế đúng theo thiết kế (`reserve` ghi `day_key` và
`source_id` vào dòng reservation, `ack` cộng theo dòng đó chứ không theo đồng hồ) nhưng chưa ai
khoá lại. Đã bổ sung test trước khi ký nghiệm thu.

## 7d. Inventory tenant/mode — 15/09/2026

`pnpm server:tenants`:

| Tenant | plan | quota_mode | khoá hoạt động |
|---|---|---|---:|
| `…001` MapsLibVN nội bộ | internal | legacy | 3 |
| `…002` Ứng dụng nhúng thử nghiệm | internal | legacy | 2 |
| `…bb` Free thử nghiệm | free | **commercial** | 4 |
| `…dc` Đo vị trí DO | free | **commercial** | 1 |
| `…dd` Đích phục hồi | free | legacy | 0 |

**5 tenant, 2 ở chế độ commercial — cả hai đều là tenant thử.** Không tenant nào vừa `internal`
vừa `commercial` (cấu hình đó bị `validateCommercialAuth` chặn thẳng). Không khách thật nào đang ở
chế độ commercial. Lệnh tự thoát khác 0 nếu phát hiện internal + commercial.

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
