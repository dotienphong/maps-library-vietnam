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

`server:setup` cũng kiểm tra graph Valhalla: nếu chưa có PBF Việt Nam thì tải PBF, chạy
`node scripts/routing-graph.mjs prepare`, rồi mới khởi động service `valhalla`; lần build đầu có thể
mất vài chục phút và cần theo dõi `docker compose … logs -f valhalla`. Graph không nằm trong backup DB.
Sau `server:restore` trên máy mới, nếu volume `valhalla-data` rỗng, chạy `routing-graph.mjs prepare`
để build lại trước khi kiểm tra `/healthz/routing`. Không thêm `ports:` cho Valhalla; đường vào duy nhất
là Tunnel + Cloudflare Access, và phải tạo Access application trước khi thêm Public Hostname Tunnel.

### 5.3 Cloudflare khi laptop mới thay máy chủ cũ

Nếu chỉ cần full data để phát triển local, không bật Tunnel production. Nếu laptop mới thực sự thay
máy chủ:

1. Điền `TUNNEL_TOKEN` cũ, hoặc tạo Cloudflare Tunnel mới.
2. Trỏ hostname database tới `tcp://postgres:5432`.
3. Xác nhận Cloudflare Access service token còn hiệu lực.
4. Nếu tạo Hyperdrive mới, cập nhật ID trong `apps/api/wrangler.toml` và deploy Worker.
5. Chỉ tắt máy chủ cũ sau khi production `/healthz/db` và Places API đã nghiệm thu.

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
