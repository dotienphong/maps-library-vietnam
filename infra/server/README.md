# Máy chủ nội bộ MapsLibVN (spec 11.1)

Máy ≥ 8 GB RAM, SSD ≥ 50 GB, Docker (Linux ưu tiên; macOS qua Docker Desktop; Windows qua WSL2 và tắt chế độ ngủ). Không dùng laptop làm việc. Khuyến nghị UPS.

**Điều khiển máy chủ từ xa (Tailscale): `infra/server/SSH.md`.** Mọi lệnh `server:*` dưới đây phải gõ TRÊN máy chủ, không phải trên máy dev.

## Dựng lần đầu

Onboarding Windows/WSL2 xem `Setup_Local_Guide.md` ở thư mục gốc. `server:setup` chỉ dựng stack và
migration; để khôi phục full production data trên máy mới, chuẩn bị file `infra/server/.env` của máy
cũ rồi chạy `pnpm server:restore`.

```bash
git clone git@github.com-dotienphong:dotienphong/maps-library-vietnam.git && cd maps-library-vietnam
corepack enable && pnpm install
echo "<PAT ghcr read:packages>" | docker login ghcr.io -u dotienphong --password-stdin   # image GHCR là private
pnpm server:setup
```

`server:setup` sinh `infra/server/.env` (mật khẩu superuser/api/pipeline, `PG_SHARED_BUFFERS` = 25% RAM), chứng chỉ TLS tự ký trong volume `pgcerts`, kéo image, `docker compose up -d`, chạy migration, in checklist. Điền thêm vào `infra/server/.env` các biến Cloudflare/R2 (copy từ `.env` máy dev) để `backup` và `pipeline` đẩy lên R2.

## Việc tay trên Cloudflare (một lần)

1. **Tunnel**: Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared → tên `mapslibvn-db` → copy **token** → `TUNNEL_TOKEN=` trong `infra/server/.env` → `pnpm server:setup` (lần này chạy thêm `cloudflared`). Tab Public Hostname: subdomain `maps-db`, domain `<domain>`, Service type **TCP**, URL `postgres:5432`.
2. **Service token**: Zero Trust → Access → Service Auth → Create Service Token `hyperdrive` (thời hạn dài nhất) → lưu **Client ID** và **Client Secret**.
3. **Access application**: Access → Applications → Add → Self-hosted → tên `mapslibvn-db`, domain `maps-db.<domain>` → Policy: action **Service Auth**, include "Service Token" = `hyperdrive`.
4. **Hyperdrive**: Workers & Pages → Hyperdrive → Create configuration → tên `mapslibvn-db`; host `maps-db.<domain>`, port `5432`, database `mapslibvn`, user `api`, password `API_PASSWORD` (trong `infra/server/.env`); mở "Connect via Cloudflare Access" → dán Client ID/Secret; SSL mode `require`. Copy **Hyperdrive ID** → `apps/api/wrangler.toml` (`[[hyperdrive]] id` và `env.production.hyperdrive`).
5. **Cảnh báo tunnel down (bắt buộc, spec 2026-09-20-canh-bao-suc-khoe mục 4)**: chính sách Notification `tunnel_health_event` lọc trạng thái **Down** (API: `new_status = ["TUNNEL_STATUS_TYPE_DOWN"]`, KHÔNG phải `down`), email tới địa chỉ vận hành. **Đã tạo 20/09/2026**, id `474c4effac064a91806ed562e136a594`, trên Dashboard → Notifications → Add → Cloudflare Tunnel → Tunnel Health Alert (token API của máy dev lúc đó không có `Notifications Write`). Email mới phải bấm xác nhận trong thư của Cloudflare. Chi tiết và trạng thái: `docs/evidence/health/2026-09-20-canh-bao-suc-khoe.md`.
6. **Báo cáo tuần (M5, spec 11.3)** — bật một lần để cron thứ Hai 08:00 VN gửi được email:
   1. Dashboard → **Email Service → Email Sending → Add domain** → `<domain>`; Cloudflare tự thêm bản
      ghi SPF/DKIM vào zone. Chờ trạng thái **Active** trước khi gửi thật.
   2. My Profile → **API Tokens → Create Custom Token** tên `mapslibvn-report`, chỉ hai quyền:
      *Account · Account Analytics · Read* và *Account · Email Sending · Edit*; Account Resources
      giới hạn đúng account này. **Không dùng lại token deploy** (token đó có quyền ghi Workers/R2/KV).
   3. Thêm vào `infra/server/.env`:
      ```
      CF_REPORT_API_TOKEN=<token vừa tạo>
      REPORT_EMAIL_TO=<email nhận báo cáo>
      REPORT_EMAIL_FROM=maps-report@<domain>
      ```
   4. Nạp biến mới cho container: `pnpm server:update` (kéo image mới có cron 2 job) rồi
      `docker compose -f infra/server/compose.yml --env-file infra/server/.env up -d pipeline`.
7. **Chỉ đường (spec dẫn đường A, 10/09/2026)** — mở Valhalla ra Worker:
   1. Access → Service Auth → Create Service Token `routing` (thời hạn dài nhất) → lưu Client ID/Secret vào password manager. Token có hạn: khi hết, `/healthz/routing` trả 503 và direct Access-protected `/status` diagnostics fail → tạo token mới, `wrangler secret put` lại, xoá token cũ.
   2. Access → Applications → Add → Self-hosted `mapslibvn-route`, domain `maps-route.<domain>` → Policy Service Auth, include Service Token `routing`.
   3. **Chỉ sau khi có Access application**: Tunnel `mapslibvn-db` → Public Hostname → Add: subdomain `maps-route`, domain `<domain>`, Service type **HTTP**, URL `valhalla:8002`. (Làm ngược thứ tự là Valhalla công khai trên Internet trong lúc chưa có Access.)
   4. Máy dev: `cd apps/api && pnpm exec wrangler secret put ROUTING_ACCESS_CLIENT_ID --env production` và `cd apps/api && pnpm exec wrangler secret put ROUTING_ACCESS_CLIENT_SECRET --env production`. `ROUTING_BASE` production nằm sẵn trong `wrangler.toml`.
   5. Kiểm (đọc secret từ biến môi trường, không gõ thẳng vào lệnh để khỏi lọt shell history): `curl -H "CF-Access-Client-Id: $CF_ROUTING_ID" -H "CF-Access-Client-Secret: $CF_ROUTING_SECRET" https://maps-route.<domain>/status` → JSON có `version`; không header → 403 của Access. Worker health: `curl https://api.<domain>/healthz/routing` → 503 nếu upstream/token lỗi.
8. **Đội xe (spec 2026-09-23-toi-uu-doi-xe)** — mở VROOM ra Worker qua CÙNG hostname với Valhalla:
   1. Trên máy chủ: `docker compose -f infra/server/compose.yml --env-file infra/server/.env up -d vroom`; `… ps vroom` thấy `healthy` (healthcheck gọi `/fleet/health` bên trong container).
   2. Tunnel `mapslibvn-db` → Public Hostname → **Add**: subdomain `maps-route`, domain `<domain>`, **Path** `^/fleet/`, Service **HTTP**, URL `vroom:3000` → Save → kéo luật mới **lên trên** luật `maps-route` không có đường dẫn (cloudflared so từ trên xuống; để dưới thì `/fleet/` rơi vào Valhalla và trả 404).
   3. Không cần Access application hay service token mới: app `mapslibvn-route` khai theo domain nên phủ mọi đường dẫn; Worker dùng lại `ROUTING_ACCESS_CLIENT_ID/SECRET`. `FLEET_BASE` production (`https://maps-route.<domain>/fleet`) đã nằm trong `wrangler.toml`.
   4. Kiểm từ máy dev: `curl -H "CF-Access-Client-Id: $CF_ROUTING_ID" -H "CF-Access-Client-Secret: $CF_ROUTING_SECRET" https://maps-route.<domain>/fleet/health` → 200; không header → 403/302; `…/status` vẫn là JSON Valhalla. Sau deploy Worker: `curl https://api.<domain>/healthz/fleet` → `{"ok":true,"jobs_assigned":2,…}` (bài thử 1 xe 2 đơn ở Hà Nội, cần graph VN đầy đủ).
   5. **Làm bước 1–4 TRƯỚC khi deploy Worker có `/v1/fleet-plan`**: cron cảnh báo đo thêm thành phần "Đội xe"; deploy trước thì thành phần này khởi đầu ở trạng thái hỏng.
   6. Windows/WSL2 (máy chủ chính sau khi phát hành app): bind mount `./vroom` chạy được trên Docker Desktop; WSL2 mặc định chỉ cấp ~50 % RAM — đủ cho Valhalla + VROOM + Postgres, nhưng phải đo lại `pnpm smoke:fleet` trước khi giữ trần.

## Kiểm tra

- Trạng thái: `docker compose --env-file infra/server/.env -f infra/server/compose.yml ps` — 6 dịch vụ `running` (`valhalla` `healthy` sau khi build graph xong), `postgres` và `vroom` `healthy`.
- Graph chỉ đường: chạy `docker compose -f infra/server/compose.yml --env-file infra/server/.env run --rm pipeline node scripts/routing-graph.mjs status`, ghi lại `activeGraph`/`previousGraph` gồm `vnRelease` và `pbfMd5`. Build lại tay bằng cùng tiền tố Compose/pipeline rồi `node scripts/routing-graph.mjs prepare --force`. Rollback graph có nhãn dùng `rollback --expected-current <activeGraph.vnRelease> --expected-target <previousGraph.vnRelease>`; graph setup/legacy không có nhãn dùng `rollback --expected-current-md5 <activeGraph.pbfMd5> --expected-target-md5 <previousGraph.pbfMd5>`. Không trộn hoặc bỏ dở hai cặp. Thông thường chạy `docker compose -f infra/server/compose.yml --env-file infra/server/.env run --rm pipeline node scripts/data-rollback.mjs` để manifest và graph đổi đồng bộ. `data:update` tự gọi prepare idempotent khi OSM đổi.
- `routing-graph.mjs status` (và `server:setup`, vốn gọi status để lập kế hoạch) tự phục hồi transaction dở dang trước khi trả JSON/kết luận; `run.sh` thấy journal thì chờ và không chạy upstream. Status phải cho thấy `activeGraph` và `previousGraph`, kích thước `tarBytes`/`prevTarBytes`, PBF đã chép và MD5 PBF có khớp graph đang active hay không (`copiedPbf.matchesActiveGraph`), cùng `pendingReload`, `buildInProgress` và `buildFailed`. `prepare` trước hết hoàn tất recovery nếu có journal, sau đó từ chối khi thiếu PBF, còn `pendingReload`, `buildInProgress` hoặc `buildFailed`; rollback lúc idle được phép nếu có `previousGraph`/`prevTar`, còn khi còn `pendingReload` hoặc `buildInProgress` chỉ được phép sau khi wrapper đã ghi `buildFailed: true`.
- Worker: `curl https://api.<domain>/healthz/routing` → `{"ok":true,"version":"3.8.x","graph_built_at":"…"}`.
- TLS bắt buộc từ ngoài: chạy trên **máy dev** (không cần mở cổng):
  ```bash
  PIPE pipeline sh -c 'cloudflared access tcp --hostname maps-db.<domain> --url 127.0.0.1:5433 \
     --service-token-id "$CF_ACCESS_CLIENT_ID" --service-token-secret "$CF_ACCESS_CLIENT_SECRET" & sleep 4; \
     psql "postgres://api:<API_PASSWORD>@127.0.0.1:5433/mapslibvn?sslmode=require" -c "select current_user, ssl from pg_stat_ssl where pid = pg_backend_pid()"'
  ```
  Kỳ vọng: `api | t`. Với `sslmode=disable` phải bị từ chối (`no pg_hba.conf entry … SSL off`).
- Worker: `cd apps/api && pnpm exec wrangler dev --remote` → `curl localhost:8787/healthz/db` → `{"ok":true,"user":"api",…}`.
- Backup tay: `docker compose -f infra/server/compose.yml --env-file infra/server/.env exec backup node infra/server/backup/backup.mjs --once` → `rclone ls r2:mapslibvn-backups/backups/daily` có file `.dump.zst.enc`.
  **Audit 09/09/2026:** dump từng nằm plaintext trong bucket `mapslibvn-tiles` (có custom domain công khai) và
  tải được không cần xác thực. Nay: (1) object luôn mã hoá AES-256 bằng `BACKUP_PASSPHRASE` trong
  `infra/server/.env` — mất passphrase là mất backup, lưu vào password manager; (2) ghi vào bucket riêng
  `BACKUP_BUCKET=mapslibvn-backups`, KHÔNG gắn custom domain. Token S3 (`RCLONE_CONFIG_R2_*`) phải có quyền
  Object Read & Write trên cả hai bucket. Cách nhanh không cần dashboard: khoá S3 của R2 suy được từ một API token có
  quyền R2 — `ACCESS_KEY_ID` = `id` trong `GET /user/tokens/verify`, `SECRET_ACCESS_KEY` = `sha256(token)` hex; máy chủ
  đang dùng khoá suy từ `CLOUDFLARE_API_TOKEN` (R2 Edit toàn tài khoản) từ 09/09/2026. Chưa đặt `BACKUP_BUCKET`
  thì script vẫn ghi vào bucket tiles kèm cảnh báo — chỉ tạm chấp nhận vì file đã mã hoá.
- Cron: `docker compose -f infra/server/compose.yml --env-file infra/server/.env logs pipeline | tail -2` → dòng `[cron] <job> kế tiếp <ISO> (thứ Hai HH:MM VN)`
  cho job gần nhất trong hai job: `data:update` 02:00 và `report:weekly` 08:00 (giờ VN).
- Báo cáo tuần: `docker compose -f infra/server/compose.yml --env-file infra/server/.env exec pipeline
  node scripts/weekly-report.mjs --dry-run` in bảng theo tenant/key/endpoint ra stdout mà không gửi mail.
  Thêm `--this-week` để xem tuần đang chạy (tuần trước có thể chưa có traffic). Bỏ `--dry-run` để gửi thật.
- Thử phục hồi (chứng minh lời hứa "chuyển máy < 1 giờ") — phục hồi vào **DB mới**, không `--clean` lên DB đang chạy
  (`spatial_ref_sys` là bảng cấu hình của extension, restore trùng khoá). Container `backup` **không** có sẵn
  `DATABASE_URL`; dựng URL từ các biến `POSTGRES_*` của chính container:
  ```bash
  C="docker compose -f infra/server/compose.yml --env-file infra/server/.env"
  F=$($C exec -T backup rclone lsf r2:mapslibvn-backups/backups/daily | sort | tail -1 | tr -d '\r')
  $C exec -T postgres psql -U mapslibvn -d postgres -c "DROP DATABASE IF EXISTS restore_smoke" -c "CREATE DATABASE restore_smoke"
  # .enc → giải mã bằng BACKUP_PASSPHRASE (container backup đọc từ env_file) rồi mới zstd/pg_restore
  $C exec -T backup sh -c "rclone cat r2:mapslibvn-backups/backups/daily/$F | \
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE | zstd -dc | \
    pg_restore --no-owner --no-privileges -d \"postgres://\$POSTGRES_USER:\$POSTGRES_PASSWORD@\$POSTGRES_HOST:5432/restore_smoke?sslmode=require\""
  $C exec -T postgres psql -U mapslibvn -d restore_smoke -tAc "select count(*) from schema_migrations"
  $C exec -T postgres psql -U mapslibvn -d postgres -c "DROP DATABASE restore_smoke"
  ```
  Kỳ vọng: dòng cuối trả số migration đã áp dụng (= số file `NNNN_*.sql` không có `.down.` trong `db/migrations`).

## Vận hành

- Cập nhật mã/image: `pnpm server:update`.
- **Release có migration — thứ tự bắt buộc là migration trước, deploy sau.** Chạy
  `pnpm server:migrate` (chỉ áp migration, `--no-deps` nên không chạm container postgres đang phục
  vụ, và mount `db/` của working tree nên không phụ thuộc `db/` nướng trong image). Kiểm
  `/healthz/db` thấy `schema_migration` đúng bản mới, rồi mới push để `Deploy API` chạy. Làm ngược
  lại là lặp sự cố 06–07/09/2026: Worker đọc cột chưa tồn tại, `/v1/autocomplete` trả 503 nhiều giờ
  trong khi `Deploy API` vẫn xanh. Từ 13/09/2026 workflow deploy có bước `pnpm check:migration` tự
  đối chiếu và chặn, nhưng nó chỉ là lưới an toàn — thứ tự vẫn do người vận hành giữ.
  Revert một migration: `pnpm server:migrate -- --down`.
- Kiểm thủ công cổng migration từ máy bất kỳ: `pnpm check:migration`
  (mặc định gọi `https://api.ai-solutions.io.vn/healthz/db`, đổi bằng `--base`).
- Chuyển máy: trên máy mới chép `infra/server/.env` an toàn từ password manager rồi chạy
  `pnpm server:restore` → dán lại `TUNNEL_TOKEN` (hoặc tạo tunnel mới rồi trỏ hostname) → xong
  < 1 giờ. Lệnh dùng đúng `infra/server/compose.yml`; không gọi nhầm restore của dev compose.
  Restore nạp vào
  DB tạm, đổi tên nguyên tử, chạy migration còn thiếu và reconcile lại owner/grant
  `api`/`pipeline` vì archive portable cố ý dùng `--no-owner --no-privileges`.
- Kiểm restore: `SELECT count(*) FROM poi;` và xác nhận `poi.tableowner = pipeline`,
  role `api` chỉ có `SELECT` trên `poi` cùng `INSERT, SELECT` trên `poi_edit`.
- Log: `docker compose -f infra/server/compose.yml --env-file infra/server/.env logs -f postgres cloudflared backup pipeline valhalla vroom`.
- Không bao giờ thêm `ports:` cho `postgres`. Mọi truy cập đi qua Tunnel + Access.
- Không bao giờ thêm `ports:` cho `valhalla`. Đường vào duy nhất là Tunnel + Access.
- Không bao giờ thêm `ports:` cho `vroom`. Đường vào duy nhất là Tunnel (luật đường dẫn `/fleet/`) + Access.
- `vroom` không cần graph và khởi động độc lập; nó gọi `valhalla:8002` theo từng request. Valhalla đang build graph thì `/v1/fleet-plan` trả 503 như `/v1/directions`.
- Log vroom: `docker compose -f infra/server/compose.yml --env-file infra/server/.env logs -f vroom`; `infra/server/vroom/access.log` là log HTTP của vroom-express (xoay ở 20M, đã gitignore).
- `pnpm server:update` kéo cả image `valhalla`. Nếu volume `valhalla-data` còn rỗng, wrapper chỉ chờ và không chạy upstream; chạy `pnpm server:setup` để dọn marker bootstrap lỗi từ bản cũ, tải PBF, prepare rồi start an toàn.
- Sau `pnpm server:restore` trên máy mới, graph không nằm trong backup: lệnh đã gọi `server:setup`, tự tải PBF/prepare/start khi volume `valhalla-data` rỗng. Không chạy `prepare` lần hai; kiểm tra `status` và log trước. Chỉ chạy `docker compose -f infra/server/compose.yml --env-file infra/server/.env run --rm pipeline node scripts/routing-graph.mjs prepare` nếu setup báo chưa có graph/PBF khả dụng và không còn marker recovery/build (volume cần ~5 GB: PBF + thư mục tile + tar + tar prev).
- Build trên máy ít RAM: `VALHALLA_THREADS` trong `infra/server/.env` mặc định **1** (cả build và service); chỉ tăng khi có đủ RAM. Health `/status` chỉ chứng minh service phản hồi, phải thử một tuyến thực tế để nghiệm thu graph.
- **`PG_SHARED_BUFFERS` phải khớp RAM của MÁY CHỦ, không phải máy chạy `server:setup`.** `pnpm server:setup` tính giá trị này bằng 25 % RAM của máy đang gõ lệnh; nếu `.env` sinh ở máy dev rồi mang sang máy chủ thì con số sai. Phát hiện 22/09/2026: production chạy `PG_SHARED_BUFFERS=4096MB` (25 % của MacBook 16 GB) trên máy chủ **3,7 GB** — Postgres xin 4 GB trên máy 3,7 GB nên hệ thống swap 81 %, `/v1/directions` chậm gấp 3–5 lần và ma trận 50 cặp mất 3,6–4,5 s. Máy chủ này dùng **512MB** (thấp hơn 25 % vì còn phải nuôi page cache cho graph Valhalla 1,16 GB). `pnpm server:update` từ nay in cảnh báo nếu giá trị vượt 30 % RAM máy hiện tại.
- **~~Production đang đặt `VALHALLA_THREADS=2` (22/09/2026)~~ — ĐÃ HOÀN NGUYÊN VỀ 1 cùng ngày.** Thử tăng luồng để giảm chèn lấn, nhưng máy chỉ **2 nhân**: hai luồng Valhalla lấy hết CPU của `cloudflared` và Postgres, `smoke:directions` cho p95 1,1–4,0 s (ngưỡng 800 ms). Nút thắt thật là bộ nhớ, không phải CPU — xem dòng `PG_SHARED_BUFFERS` ở trên và `docs/evidence/routing/2026-09-22-matrix.md`. Đổi biến rồi `docker compose -f infra/server/compose.yml --env-file infra/server/.env up -d valhalla`: container nạp lại tar có sẵn, **không** build lại graph, `/v1/directions` trả 503 khoảng một phút. Sau khi lên, kiểm `/custom_files/` không còn `reload.failed` hay `reload.in-progress`.
- Sau restart, nếu còn `reload.failed` hoặc `reload.in-progress` mà không có request mới, wrapper **chờ phục hồi**, không nạp tile dang dở. Không xoá marker hoặc phát `reload.request` chỉ để chạy lại: phải rollback sang graph tốt hoặc cô lập tile/tar lỗi và chuẩn bị build sạch trước. Graph bootstrap chưa có bản trước cần operator phục hồi, không thể rollback.
- Build lỗi/OOM: container ghi `buildFailed: true`, ngủ 10 phút rồi Docker khởi động lại; xem log và status, chờ marker lỗi rồi chạy `docker compose -f infra/server/compose.yml --env-file infra/server/.env run --rm pipeline node scripts/data-rollback.mjs`, hoặc rollback graph thủ công với đúng một cặp VN-release hay MD5 lấy từ status. CLI kiểm lại cặp identity dưới cùng kernel lock ngay trước transaction, nên status cũ không thể làm graph bị toggle về phía trước.
- Mỗi graph do `data:update` dựng mới ghi `vnRelease` vào metadata. `data:rollback` chỉ đổi graph khi VN release của manifest thực sự đổi và chỉ khi `activeGraph.vnRelease`/`previousGraph.vnRelease` khớp chính xác current/target; POI-only rollback không chạm graph và trạng thái thiếu/sai identity bị từ chối để không toggle graph về phía trước. `--skip-routing` chỉ dùng khi chủ ý rollback manifest mà bỏ qua graph.
