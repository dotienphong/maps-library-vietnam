# Máy chủ nội bộ MapsLibVN (spec 11.1)

Máy ≥ 8 GB RAM, SSD ≥ 50 GB, Docker (Linux ưu tiên; macOS qua Docker Desktop; Windows qua WSL2 và tắt chế độ ngủ). Không dùng laptop làm việc. Khuyến nghị UPS.

## Dựng lần đầu

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
5. Tuỳ chọn cảnh báo: Zero Trust → Networks → Tunnels → `mapslibvn-db` → Notifications → email khi tunnel down (spec 11.3).

## Kiểm tra

- Trạng thái: `docker compose --env-file infra/server/.env -f infra/server/compose.yml ps` — 4 dịch vụ `running`, `postgres` `healthy`.
- TLS bắt buộc từ ngoài: chạy trên **máy dev** (không cần mở cổng):
  ```bash
  PIPE pipeline sh -c 'cloudflared access tcp --hostname maps-db.<domain> --url 127.0.0.1:5433 \
     --service-token-id "$CF_ACCESS_CLIENT_ID" --service-token-secret "$CF_ACCESS_CLIENT_SECRET" & sleep 4; \
     psql "postgres://api:<API_PASSWORD>@127.0.0.1:5433/mapslibvn?sslmode=require" -c "select current_user, ssl from pg_stat_ssl where pid = pg_backend_pid()"'
  ```
  Kỳ vọng: `api | t`. Với `sslmode=disable` phải bị từ chối (`no pg_hba.conf entry … SSL off`).
- Worker: `cd apps/api && pnpm exec wrangler dev --remote` → `curl localhost:8787/healthz/db` → `{"ok":true,"user":"api",…}`.
- Backup tay: `docker compose --env-file infra/server/.env -f infra/server/compose.yml exec backup node infra/server/backup/backup.mjs --once` → `rclone ls r2:mapslibvn-tiles/backups/daily` có file.
- Cron: `docker compose … logs pipeline | tail -2` → `data:update kế tiếp <ISO> (thứ Hai 02:00 VN)`.
- Thử phục hồi (chứng minh lời hứa "chuyển máy < 1 giờ") — phục hồi vào **DB mới**, không `--clean` lên DB đang chạy
  (`spatial_ref_sys` là bảng cấu hình của extension, restore trùng khoá). Container `backup` **không** có sẵn
  `DATABASE_URL`; dựng URL từ các biến `POSTGRES_*` của chính container:
  ```bash
  C="docker compose --env-file infra/server/.env -f infra/server/compose.yml"
  F=$($C exec -T backup rclone lsf r2:mapslibvn-tiles/backups/daily | sort | tail -1 | tr -d '\r')
  $C exec -T postgres psql -U mapslibvn -d postgres -c "DROP DATABASE IF EXISTS restore_smoke" -c "CREATE DATABASE restore_smoke"
  $C exec -T backup sh -c "rclone cat r2:mapslibvn-tiles/backups/daily/$F | zstd -dc | \
    pg_restore --no-owner --no-privileges -d \"postgres://\$POSTGRES_USER:\$POSTGRES_PASSWORD@\$POSTGRES_HOST:5432/restore_smoke?sslmode=require\""
  $C exec -T postgres psql -U mapslibvn -d restore_smoke -tAc "select count(*) from schema_migrations"
  $C exec -T postgres psql -U mapslibvn -d postgres -c "DROP DATABASE restore_smoke"
  ```
  Kỳ vọng: dòng cuối trả số migration đã áp dụng (= số file `NNNN_*.sql` không có `.down.` trong `db/migrations`).

## Vận hành

- Cập nhật mã/image: `pnpm server:update`.
- Chuyển máy: trên máy mới `pnpm server:setup` → `pnpm db:restore --latest` → dán lại
  `TUNNEL_TOKEN` (hoặc tạo tunnel mới rồi trỏ hostname) → xong < 1 giờ. Restore nạp vào
  DB tạm, đổi tên nguyên tử, chạy migration còn thiếu và reconcile lại owner/grant
  `api`/`pipeline` vì archive portable cố ý dùng `--no-owner --no-privileges`.
- Kiểm restore: `SELECT count(*) FROM poi;` và xác nhận `poi.tableowner = pipeline`,
  role `api` chỉ có `SELECT` trên `poi` cùng `INSERT, SELECT` trên `poi_edit`.
- Log: `docker compose … logs -f postgres|cloudflared|backup|pipeline`.
- Không bao giờ thêm `ports:` cho `postgres`. Mọi truy cập đi qua Tunnel + Access.
