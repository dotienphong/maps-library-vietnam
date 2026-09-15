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
| `pnpm test` (gốc) | 142 file / 1.499 test xanh, gồm `quota-audit` 13 ca | 15/09/2026 |
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

Xem mục "Đo tải commercial" bên dưới — cập nhật ở Task 7.
