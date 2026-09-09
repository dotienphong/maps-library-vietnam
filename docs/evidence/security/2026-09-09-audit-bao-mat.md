# Audit bảo mật toàn hệ thống — 09/09/2026

Người thực hiện: Claude (Fable 5.1) theo yêu cầu PHONG; PHONG duyệt sửa ngay trong ngày.

## 1. Phát hiện

| # | Mức | Phát hiện | Trạng thái |
|---|---|---|---|
| 1 | **Nghiêm trọng** | pg_dump production (superuser, ~948 MB) tải được công khai qua `https://tiles.ai-solutions.io.vn/backups/daily/mapslibvn-YYYYMMDD-0300.dump.zst` — backup ghi vào bucket `mapslibvn-tiles` có custom domain; tên file suy từ ngày. Dump chứa `api_key` plaintext, `tenant`, `poi_edit`. | **Đã chặn**: xoá cả 8 object (7 daily + 1 weekly) khỏi bucket công khai lúc 20:30 09/09; bản mới nhất đã chuyển vào bucket riêng `mapslibvn-backups` (không domain). Code: backup mã hoá AES-256 + bucket riêng (mục 3). |
| 2 | **Nghiêm trọng** | Khoá demo công khai `mlv_live_demo…` (kind web, tenant `internal`) có `edits:write` → ai cũng POST `/v1/edits` từ curl (không Origin thì cho qua) và edit **tự duyệt ngay** (plan internal). Khoá `mlv_live_server000…` cố định trong seed (đoán được) cũng vậy. | **Đã sửa trên DB production 09/09 (bước A)**: demo chỉ `places:read`; `server000…`, `freetest…` đã thu hồi. |
| 3 | Cao | Khoá API lưu plaintext trong `api_key.key` và `poi_edit.api_key` → lộ DB = lộ toàn bộ khoá (đã xảy ra ở #1). | Migration 0010 đã áp production 09/09 (~21:00), Worker mới deploy ~21:20 (`/healthz/db` = 0010, `?key=` → 401). Mọi khoá plaintext đã thu hồi. Migration 0011 xoá cột `key` — áp sau khi cấp khoá mới. |
| 4 | Trung bình | Đồng thuận (2 end-user cùng thay đổi → tự duyệt) giả được vì `end_user_token` do client tự đặt. | Chỉ tính phiếu từ tenant khác. |
| 5 | Trung bình | POST `/v1/admin/*` không chống CSRF; Access app chưa đặt SameSite cho cookie. | Worker chặn `Sec-Fetch-Site: cross-site`/`Origin` lạ. Access app đã đặt SameSite=Lax qua API 09/09. |
| 6 | Thấp | Khoá nhận qua `?key=`; khoá thô ghi vào Analytics Engine; KV cache theo khoá thô. | Chỉ nhận header; analytics/KV/quota dùng hash. |
| 7 | Thấp | `/healthz/db` lộ user DB, phiên bản PG, tên migration. | Giữ (đang dùng để đối chiếu sau deploy). |

Đã kiểm và không thấy vấn đề: SQL injection (toàn bộ qua tagged template), JWT Access (RS256, kid, aud, exp; thử JWT giả trên route workers.dev bị 401), quyền DB (api không UPDATE poi; SECURITY DEFINER owner pipeline; pg_hba TLS+scram), secret trong git history, gói npm publish, XSS SDK/admin, CI workflows.

## 2. Đã làm trên production (09/09/2026)

- Tạo bucket R2 `mapslibvn-backups` (APAC, không custom domain).
- Xoá 8 object `backups/**` khỏi `mapslibvn-tiles` (wrangler `r2 object delete`); `HEAD` URL công khai → 404.
- Tải bản `mapslibvn-20260909-0300.dump.zst` về máy dev (`/private/tmp/claude-502/…/scratchpad/`) và upload vào `mapslibvn-backups/backups/daily/`. **Xoá file tạm sau khi PHONG xác nhận.**
- Thêm `BACKUP_PASSPHRASE` (48 ký tự) vào `infra/server/.env`. `BACKUP_BUCKET` để comment cho tới khi token S3 có quyền trên bucket mới.
- Build lại image `mapslibvn/pipeline:local` (có backup.mjs mới). Container `backup` **chưa** recreate.
- Áp migration 0010 lên dev và production (PHONG chạy `node scripts/server-migrate.mjs`). Worker mới deploy thủ công bằng wrangler (Actions bị chặn billing). Bản backup mã hoá đầu tiên `mapslibvn-20260909-2109.dump.zst.enc` đã giải mã + `zstd -t` OK; URL công khai 403.
- Đã thu hồi 4 khoá plaintext cũ (server, freetest, embed-web, embed-rn); cấp 3 khoá mới (server nội bộ, embed-web, embed-rn); demo chỉ đọc. Migration 0011 đã áp: DB không còn cột `key`.
- Đã xoá bản dump plaintext tạm trên máy dev.

## 3. Thay đổi code (commit kèm file này)

- `db/migrations/0010_api_key_hash.sql`: thêm `key_hash` (PK mới), `key_prefix`; backfill; `key` cũ nullable — Worker cũ vẫn chạy cho tới khi deploy. Migration 0011 (sau deploy) sẽ `DROP COLUMN key`.
- `apps/api/src/auth.ts`: tra `key_hash`; chỉ nhận `X-Api-Key`; khoá web + `edits:write` bắt buộc Origin (`403 origin_required`).
- `apps/api/src/routes/edits.ts`: đồng thuận theo tenant khác; `poi_edit.api_key` = hash.
- `apps/api/src/routes/admin.ts`: chặn CSRF cho POST (`403 cross_site_request`).
- `quota.ts`, `analytics.ts`: dùng hash. `scripts/lib/weekly-report.mjs`: nhãn qua `key_hash`/`key_prefix`.
- `infra/server/backup/backup.mjs`, `scripts/db-restore.mjs`, `scripts/lib/backup-plan.mjs`: `pg_dump | zstd | openssl enc -aes-256-cbc -pbkdf2 -iter 600000` → `.dump.zst.enc`; bucket `BACKUP_BUCKET`; thiếu passphrase thì dừng.
- Seeds: khoá demo chỉ `places:read`; bỏ khoá server cố định. `scripts/api-key-issue.mjs` ghi hash + prefix.
- Tests: 186 Worker + 974 script + 53 DB thật (local) xanh.

## 4. Việc PHONG cần chạy, ĐÚNG THỨ TỰ

```bash
C="docker compose --env-file infra/server/.env -f infra/server/compose.yml"
```

**A. Vá DB production — ĐÃ CHẠY 09/09 (giữ lại để tham chiếu):**
```bash
$C exec -T postgres psql -U mapslibvn -d mapslibvn -v ON_ERROR_STOP=1 \
  -c "UPDATE api_key SET scopes='{places:read}' WHERE key='mlv_live_demo00000000000000000000'" \
  -c "UPDATE api_key SET active=false, revoked_at=now() WHERE key IN ('mlv_live_server000000000000000000','mlv_live_freetest0000000000000000') AND active"
```
(KV cache khoá 5 phút — hiệu lực sau ≤ 5 phút.)

**B. ĐÃ CHẠY 09/09.** Áp migration 0010 (cộng thêm cột, Worker cũ vẫn chạy) — hoặc gọn hơn: `node scripts/server-migrate.mjs`
(chỉ migrate, không pull/up như `server:update`):
```bash
{ cat db/migrations/0010_api_key_hash.sql; echo "INSERT INTO schema_migrations (name) VALUES ('0010_api_key_hash.sql');"; } \
  | $C exec -T postgres psql -U mapslibvn -d mapslibvn -v ON_ERROR_STOP=1 -1
$C exec -T postgres psql -U mapslibvn -d mapslibvn -At -c "SELECT key_prefix, active, scopes FROM api_key"
```

**C. ĐÃ CHẠY 09/09 (wrangler deploy thủ công).** Push để deploy Worker (chỉ SAU B): `git push origin main` → chờ `Deploy API` xanh →
`curl -s https://api.ai-solutions.io.vn/healthz/db` phải có `"schema_migration":"0010_api_key_hash.sql"`, và
`curl -H "X-Api-Key: mlv_live_demo00000000000000000000" -H "Origin: http://localhost" "https://api.ai-solutions.io.vn/v1/autocomplete?q=ha%20noi"` → 200.

**D. Xoay khoá đã lộ trong dump** (sau C; mỗi lệnh in khoá đúng một lần — lưu vào password manager rồi cập nhật `.env` máy dev: `KEY_EXAMPLE_EMBED`, `KEY_EXAMPLE_RN`):
```bash
SUPER=$(grep '^POSTGRES_SUPER_PASSWORD=' infra/server/.env | cut -d= -f2)
ISSUE="$C run --rm -e POSTGRES_USER=mapslibvn -e POSTGRES_PASSWORD=$SUPER pipeline node scripts/api-key-issue.mjs"
$ISSUE --tenant 00000000-0000-4000-8000-000000000001 --label "server nội bộ (curl/test)" --kind server --scopes places:read,edits:write
$ISSUE --tenant 00000000-0000-4000-8000-000000000002 --label "embed-web thử độc lập" --kind web --origins http://localhost:5500
$ISSUE --tenant 00000000-0000-4000-8000-000000000002 --label "embed-rn thử độc lập" --kind mobile
# thu hồi khoá cũ (mọi khoá còn cột key plaintext, trừ demo):
$C exec -T postgres psql -U mapslibvn -d mapslibvn -c "UPDATE api_key SET active=false, revoked_at=now() WHERE key IS NOT NULL AND key <> 'mlv_live_demo00000000000000000000' AND active"
```
**D ĐÃ XONG 09/09 ~21:45:** 3 khoá mới cấp bằng `node scripts/server-key-issue.mjs …`, khoá cũ thu hồi, `.env` máy dev cập nhật; migration 0011 đã áp (`/healthz/db` = 0011) — bảng `api_key` không còn cột `key`.

**E. Backup mã hoá + bucket riêng:**
1. Cloudflare → R2 → Manage API tokens → token S3 mà máy chủ đang dùng (`RCLONE_CONFIG_R2_ACCESS_KEY_ID` trong `infra/server/.env`) → sửa scope thêm bucket `mapslibvn-backups` (Object Read & Write). Hoặc tạo token mới và thay hai biến RCLONE.
2. Bỏ comment `BACKUP_BUCKET=mapslibvn-backups` trong `infra/server/.env`.
3. `$C up -d --force-recreate --no-deps backup pipeline` rồi `$C exec -T backup node infra/server/backup/backup.mjs --once` → `$C exec -T backup rclone lsf r2:mapslibvn-backups/backups/daily` có file `.dump.zst.enc`.
4. Thử restore theo `infra/server/README.md` mục Kiểm tra (đã cập nhật lệnh giải mã).
5. Xoá bản dump plaintext tạm trên máy dev: `rm /private/tmp/claude-502/*/c800d017-*/scratchpad/mapslibvn-20260909-0300.dump.zst`.

**F. Cloudflare — ĐÃ LÀM qua API 09/09:** Access app `MapsLibVN Admin` SameSite=Lax; WAF custom rule (ruleset version 34) Block
`(http.host eq "tiles.ai-solutions.io.vn" and (starts_with(http.request.uri.path, "/backups/") or starts_with(http.request.uri.path, "/state/")))`
— `HEAD /backups/…` giờ trả 403 dù object còn.

**Còn lại duy nhất: bước E** (token S3 cho bucket `mapslibvn-backups`, bật `BACKUP_BUCKET`, recreate backup).

**G. Cân nhắc:** xoay `API_PASSWORD`/`PIPELINE_PASSWORD` (pg_dump không chứa mật khẩu role và DB chỉ tới được qua Tunnel + service token, nên không bắt buộc); bật `QUOTA_ENABLED=1` trên production.
