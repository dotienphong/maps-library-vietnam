# MapsLibVN — hướng dẫn setup local trên Windows

Tài liệu này dành cho thành viên mới cần dựng MapsLibVN trên laptop Windows 11. Có hai chế độ:

- **Dev nhẹ:** Postgres local và fixture Quận 1, đủ để code/test hằng ngày.
- **Full data:** khôi phục toàn bộ database production mới nhất từ backup mã hóa trên Cloudflare R2.

> **Quy tắc bảo trì:** Mỗi thay đổi ảnh hưởng đến setup, dependency, biến môi trường, Docker,
> migration, backup/restore hoặc lệnh chạy hằng ngày phải cập nhật `Setup_Local_Guide.md` trong cùng
> pull request/commit. Test contract của repo kiểm tra các entrypoint quan trọng.

## 1. Yêu cầu máy

Khuyến nghị cho dev nhẹ:

- Windows 11 64-bit, đã cập nhật.
- RAM tối thiểu 8 GB; khuyến nghị 16 GB.
- Còn ít nhất 20 GB SSD.

Khuyến nghị khi dùng full data/pipeline:

- RAM tối thiểu 16 GB.
- Còn ít nhất 50 GB SSD.
- Cắm nguồn và tắt sleep nếu máy đóng vai trò server.

Riêng khi máy phải **build graph Valhalla** (mọi máy chủ mới đều phải, xem mục 5.2):

- **VM Docker phải được cấp ≥ 12 GB RAM.** Trên Windows con số này do WSL2 quyết định, xem mục 2.2.
  Đo 11/09/2026 trên máy chủ macOS: ở 8,2 GB thì `valhalla_build_tiles -s enhance` bị kernel giết
  (`Killed`) giữa chừng; ở 15,6 GB build xong, RAM đỉnh của container 3,67 GB.
- Volume `valhalla-data` cần ~5 GB: PBF Việt Nam 313 MB + thư mục tile + `valhalla_tiles.tar`
  1,08 GB + bản `prev` cùng cỡ.

## 2. Cài công cụ nền

### 2.1 WSL2 và Ubuntu

Mở PowerShell bằng quyền Administrator:

```powershell
wsl --install -d Ubuntu
```

Khởi động lại Windows nếu được yêu cầu. Mở ứng dụng Ubuntu và tạo username/password Linux.
Các lệnh còn lại trong tài liệu chạy trong terminal Ubuntu/WSL2, không chạy trong PowerShell.

Kiểm tra:

```bash
wsl.exe --status
uname -a
```

### 2.2 Docker Desktop

1. Cài Docker Desktop for Windows.
2. Settings → General → bật **Use the WSL 2 based engine**.
3. Settings → Resources → WSL Integration → bật Ubuntu vừa cài.
4. Mở Docker Desktop và chờ engine sẵn sàng.

Nếu máy sẽ build graph Valhalla, cấp RAM cho WSL2 **trước**. Trên Windows, Docker Desktop dùng
WSL2 nên thanh Memory trong Settings → Resources không có tác dụng; phải sửa file
`%UserProfile%\.wslconfig`:

```ini
[wsl2]
memory=12GB
processors=4
```

Rồi `wsl --shutdown` trong PowerShell và mở lại Docker Desktop. Kiểm bằng:

```bash
docker info --format 'RAM VM: {{.MemTotal}} · CPU: {{.NCPU}}'
```

`MemTotal` phải ≥ 12884901888. Cấp thiếu thì build graph chết giữa chừng bằng `Killed` (OOM) và —
đây là phần nguy hiểm — container vẫn khởi động lại, đóng gói thư mục tile dở thành tar và phục vụ
tiếp: `/status` trả 200 nhưng mọi `/route` trả `error_code 171`. Xem mục 7.

Trong Ubuntu kiểm tra:

```bash
docker --version
docker compose version
docker info
```

### 2.3 Node.js 22 và pnpm

Cài `fnm` trong Ubuntu theo tài liệu chính thức của fnm, sau đó:

```bash
fnm install 22
fnm use 22
node --version
corepack enable
pnpm --version
```

Node phải từ phiên bản 22. Repo khóa pnpm theo trường `packageManager` trong `package.json`.

## 3. Clone repo

Thiết lập SSH key GitHub của thành viên mới, rồi chạy trong filesystem Linux của WSL2:

```bash
mkdir -p ~/work
cd ~/work
git clone git@github.com-dotienphong:dotienphong/maps-library-vietnam.git mapsLibVN
cd mapsLibVN
pnpm install
```

Không đặt repo dưới `/mnt/c/...`: filesystem Windows làm Docker bind mount và dependency Node chậm
hơn đáng kể.

## 4. Chế độ A — môi trường dev nhẹ

Mở Docker Desktop, sau đó tại thư mục gốc repo:

```bash
pnpm run setup
```

Lệnh kiểm tra Node/Docker, tạo `.env` dev nếu chưa có, dựng Postgres/PostGIS, chạy migration và cấu
hình Git hook. Lệnh này **không tải toàn bộ production data**.

Nạp fixture POI Quận 1:

```bash
pnpm db:fixture
```

Chạy hệ thống:

```bash
pnpm dev
```

Những ngày sau chỉ cần:

```bash
pnpm db:up
pnpm dev
```

Kiểm tra tích hợp chỉ đường trên graph fixture Quận 1 (tự dựng Valhalla và Worker local):

```bash
pnpm test:routing
```

Lệnh này kiểm tra các mode xe máy/ô tô/đi bộ, điểm dừng, câu chỉ dẫn tiếng Anh và trường
`/healthz/routing`. Muốn dừng container Valhalla sau khi chạy: `pnpm test:routing -- --down`.

Dừng database dev khi không dùng:

```bash
pnpm db:down
```

### 4.1 Quota thuê bao local

Migration `0015_tenant_quota_mode.sql` thêm `tenant.quota_mode` với mặc định `legacy` và đặt
`statement_timeout=29s` cho role `api`. Worker có binding Durable Object `QUOTA`/class
`QuotaObject`. Sau khi đổi migration hoặc mã DO, rebuild pipeline image rồi kiểm tra cả schema và
API dùng DB:

```bash
pnpm image:build
pnpm test:db
pnpm test:api-db
```

`COMMERCIAL_ADMISSION` mặc định `0`, nên tenant commercial bị fail closed cho tới khi hoàn tất gate
phát hành và chủ động bật thành `1`. API quản trị billing còn yêu cầu Cloudflare Access và
`BILLING_ADMIN_EMAILS` là danh sách email chính xác, phân cách bằng dấu phẩy; danh sách rỗng từ chối
mọi người. Có thể đặt `BILLING_ADMIN_ORIGIN` để các mutation chỉ nhận đúng Origin của trang admin.
Không đưa các giá trị production hoặc Access token vào Git.

### 4.2 Sao lưu và đối soát sổ quota

Sổ tiêu thụ nằm trong Durable Object của từng tenant, **không** nằm trong Postgres, nên backup DB
hằng ngày (mục 5) không chạm tới nó. Sao lưu riêng bằng:

```bash
# Xuất snapshot + đuôi journal, kiểm checksum, mã hoá rồi mới chốt checkpoint
pnpm audit:quota export --tenant <uuid> --base http://127.0.0.1:8787

# Kiểm một file đã lưu, không cần mạng
pnpm audit:quota verify --file out/quota-audit/quota-20260916-0300.json.enc
```

`export` cần `BILLING_ACCESS_CLIENT_ID`/`BILLING_ACCESS_CLIENT_SECRET` (service token Cloudflare
Access) và `BACKUP_PASSPHRASE` — cùng passphrase với backup DB, thiếu là script dừng chứ không
upload file không mã hoá. Email vận hành phải nằm trong `BILLING_BACKUP_EMAILS`, một danh sách
**tách riêng** khỏi `BILLING_ADMIN_EMAILS`: cấp gói và ghi đè sổ tiêu thụ là hai quyền khác nhau.

Phục hồi ghi đè sổ nên có ba cổng chặn — chưa bật bảo trì, bản sao lưu cũ hơn sổ, hoặc object còn
thấy traffic trong 60 giây qua. Quy trình đầy đủ, kể cả rollback, nằm ở
`docs/evidence/billing/2026-09-15-quota-rollout.md`. Đừng nạp bản sao lưu lên object đang phục vụ.

## 5. Chế độ B — khôi phục full production data

### 5.1 Chuẩn bị secrets

Không lấy secrets từ Git hoặc gửi qua chat. Người quản trị phải cung cấp qua password manager file:

```text
infra/server/.env
```

Tối thiểu file phải có:

- `POSTGRES_SUPER_PASSWORD`
- `API_PASSWORD`
- `PIPELINE_PASSWORD`
- `BACKUP_PASSPHRASE`
- `BACKUP_BUCKET=mapslibvn-backups`
- `RCLONE_CONFIG_R2_ACCESS_KEY_ID`
- `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY`
- `RCLONE_CONFIG_R2_ENDPOINT`
- `TUNNEL_TOKEN` nếu laptop sẽ phục vụ Worker production
- `HF_TOKEN` nếu laptop sẽ chạy pipeline Foursquare

`BACKUP_PASSPHRASE` phải là passphrase của máy chủ cũ. Nếu dùng passphrase mới, backup `.enc` trên
R2 không thể giải mã. Không commit `.env` hoặc dán giá trị secrets vào issue/log.

Nếu pipeline image trên GHCR là private, đăng nhập trước:

```bash
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io -u dotienphong --password-stdin
```

### 5.2 Một lệnh dựng và restore

Từ thư mục gốc repo:

```bash
pnpm server:restore
```

Lệnh sẽ:

1. Fail trước khi thay đổi DB nếu thiếu file hoặc biến bắt buộc.
2. Chạy `pnpm server:setup` để dựng/cập nhật Postgres, backup và pipeline bằng server compose.
3. Tải backup production mới nhất từ bucket R2 riêng.
4. Giải mã AES-256, giải nén và restore vào database tạm.
5. Chạy migration và đồng bộ quyền trước khi đổi database nguyên tử.
6. Kiểm tra migration, số POI, owner bảng `poi` và quyền chỉ đọc của role `api`.

Không tắt Docker hoặc đóng laptop trong khi restore. Database production hiện gần 6 GB nên thời gian
phụ thuộc mạng và SSD.

`server:setup` tự xử lý volume `valhalla-data` rỗng: nếu chưa có PBF Việt Nam thì tải PBF, chạy
`node scripts/routing-graph.mjs prepare`, rồi mới khởi động service `valhalla`; lần build đầu có thể
mất vài chục phút và cần theo dõi `docker compose -f infra/server/compose.yml --env-file infra/server/.env logs -f valhalla`.
Nếu bản cũ từng để lại marker build lỗi trên volume hoàn toàn rỗng, setup sẽ dọn marker dưới kernel
lock rồi mới download/prepare/start; wrapper mới chỉ chờ input và không chạy upstream khi chưa có PBF/tar.
Graph không nằm trong backup DB; `server:restore` gọi `server:setup` trước, và setup tự tải PBF,
prepare rồi start Valhalla khi volume rỗng nên không cần chạy lại `prepare` trên volume đã có graph.
Hãy kiểm tra `routing-graph.mjs status` và log Valhalla sau restore. Chỉ nếu setup báo chưa có graph/PBF
khả dụng và không còn marker recovery/build đang hoạt động, chạy rõ ràng:
`docker compose -f infra/server/compose.yml --env-file infra/server/.env run --rm pipeline node scripts/routing-graph.mjs prepare`.
Không thêm `ports:` cho Valhalla; đường vào duy nhất
là Tunnel + Cloudflare Access, và phải tạo Access application trước khi thêm Public Hostname Tunnel.

### 5.3 Cloudflare khi laptop mới thay máy chủ cũ

Nếu chỉ cần full data để phát triển local, không bật Tunnel production. Nếu laptop mới thực sự thay
máy chủ:

0. **Tắt stack trên máy cũ trước** (`docker compose --env-file infra/server/.env -f infra/server/compose.yml down`).
   Hai máy cùng chạy một `TUNNEL_TOKEN` sẽ thành hai replica của cùng một tunnel và Cloudflare chia
   tải ngẫu nhiên giữa chúng: Hyperdrive lúc vào DB máy này lúc vào DB máy kia, dữ liệu phân kỳ mà
   không có lỗi nào báo.
1. Điền `TUNNEL_TOKEN` cũ, hoặc tạo Cloudflare Tunnel mới.
2. Trỏ hostname database tới `tcp://postgres:5432`.
3. Xác nhận Cloudflare Access service token còn hiệu lực — cả `hyperdrive` (cho `maps-db`) lẫn
   `routing` (cho `maps-route`).
4. Nếu tạo Hyperdrive mới, cập nhật ID trong `apps/api/wrangler.toml` và deploy Worker.
5. Chỉ tắt máy chủ cũ sau khi production `/healthz/db`, `/healthz/routing` và Places API đã nghiệm thu.

**Giữ nguyên `TUNNEL_TOKEN` thì phần Cloudflare gần như không phải làm lại.** Cấu hình ingress nằm
trên Cloudflare chứ không nằm trên máy, nên cả `maps-db → tcp://postgres:5432` lẫn
`maps-route → http://valhalla:8002` tự đi theo tunnel sang máy mới; Access application, service
token và hai secret `ROUTING_ACCESS_CLIENT_ID`/`ROUTING_ACCESS_CLIENT_SECRET` của Worker đều không
đổi.

**Graph Valhalla không nằm trong backup DB.** `server:restore` gọi `server:setup`, và setup tự tải
PBF rồi `prepare` khi volume `valhalla-data` rỗng — nhưng đó là một lần build lạnh toàn Việt Nam,
tức là khoảng downtime của `/v1/directions` khi chuyển máy. Muốn rút ngắn, chép sẵn hai file từ
volume máy cũ sang máy mới trước khi chuyển:

```bash
docker run --rm -v mapslibvn-server_valhalla-data:/d -v "$PWD":/out alpine \
  sh -c 'cp /d/valhalla_tiles.tar /d/vietnam.osm.pbf /out/'
```

Sau restore, kiểm bằng một tuyến thật chứ không chỉ `/status` (xem mục 7):

```bash
docker compose --env-file infra/server/.env -f infra/server/compose.yml \
  run --rm pipeline node scripts/routing-graph.mjs status
```

Chi tiết cấu hình cloud: `infra/server/README.md`.

## 6. Kiểm tra sau setup

Kiểm tra container server:

```bash
docker compose --env-file infra/server/.env -f infra/server/compose.yml ps
```

Kiểm tra DB production local:

```bash
docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T postgres \
  psql -U mapslibvn -d mapslibvn -c "SELECT pg_size_pretty(pg_database_size(current_database())); SELECT count(*) FROM poi;"
```

Chạy quality gates:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Nếu dùng chế độ dev, chạy:

```bash
pnpm dev
```

Sau đó mở URL được in trong terminal. Không kết luận production hoạt động chỉ từ localhost.

## 7. Lỗi thường gặp

### Docker daemon chưa chạy

Mở Docker Desktop, chờ trạng thái running rồi kiểm tra `docker info`.

### WSL hết RAM hoặc disk

Kiểm tra:

```bash
free -h
df -h .
docker system df
```

Không xóa Docker volume `mapslibvn-server_pgdata` nếu chưa có backup đã kiểm tra restore.

### Không kéo được pipeline image

Đăng nhập GHCR bằng token chỉ có quyền `read:packages`, hoặc dùng image local đã được build đúng
version. Không ghi token trực tiếp vào command history.

### Valhalla `/status` trả 200 nhưng mọi tuyến trả `error_code 171`

Graph rỗng hoặc dựng dở — gần như luôn là build bị OOM giết ở pha `enhance`. `routing-graph.mjs
status` cũng báo `buildFailed: false` nên **ba tín hiệu xanh cùng lúc trong khi dịch vụ chết**.
Kiểm bằng một tuyến thật, không dừng ở `/status`:

```bash
docker exec mapslibvn-server-valhalla-1 curl -s -X POST http://localhost:8002/route \
  -H 'content-type: application/json' \
  -d '{"locations":[{"lat":10.7798,"lon":106.699},{"lat":10.7725,"lon":106.698}],"costing":"motor_scooter","directions_options":{"language":"vi-VN"}}'
```

Sửa: cấp RAM theo mục 1 và 2.2, rồi `run --rm pipeline node scripts/routing-graph.mjs prepare --force`.
Tìm `Killed` trong `docker compose … logs valhalla` để xác nhận nguyên nhân là OOM.

### `/healthz/routing` trả 503 dù đã tạo đủ Tunnel, service token và Access application

Kiểm xem Access application đã **gắn** policy chưa — dashboard Zero Trust bản mới tạo policy như một
đối tượng dùng chung, tạo xong vẫn phải vào application → tab Policies → *Select existing policies*.
Application không có policy nào thì chặn sạch, kể cả service token đúng, và Worker trả đúng cùng một
lỗi `upstream_unavailable` như lúc chưa có Tunnel. Dấu hiệu phân biệt: trong observability
`wallTimeMs` chỉ 4–18 ms (bị Access chặn ngay) thay vì vài trăm ms (có gọi tới Valhalla).

### Rollback graph đưa nhầm bản hỏng trở lại

`rollback --expected-current-md5 X --expected-target-md5 Y` không phân biệt được hai graph dựng từ
**cùng một file PBF** vì `pbfMd5` của chúng giống hệt nhau. Chỉ graph do `data:update` dựng mới có
`vnRelease` để phân biệt. Luôn đọc `routing-graph.mjs status` **ngay trước** khi rollback: trạng thái
có thể đã đổi sau lưng, ví dụ khởi động lại Docker Desktop làm container tự build lại và tự xoay
`prev/`.

### Restore báo sai passphrase

Dừng lại và lấy đúng `BACKUP_PASSPHRASE` từ password manager. Không thử sửa hoặc ghi đè backup R2.

### Production chạy khi máy cũ tắt nhưng máy mới chưa nhận traffic

Kiểm tra lần lượt Postgres health, container `cloudflared`, Tunnel hostname, Access service token và
Hyperdrive ID. Tiles R2 có thể vẫn tải bình thường dù Places DB đang offline.

## 8. Dữ liệu không được đưa vào Git

- `.env`
- `infra/server/.env`
- API tokens và API keys
- `BACKUP_PASSPHRASE`
- Database dump đã giải mã
- Pipeline work/output chứa dữ liệu tải tạm

Backup production phải ở bucket R2 riêng, mã hóa, không gắn custom domain và được thử restore định kỳ.
