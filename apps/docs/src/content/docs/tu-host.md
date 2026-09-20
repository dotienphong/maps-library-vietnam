---
title: Tự host
description: Dựng lại toàn bộ MapsLibVN từ repo — tiles trên R2, Worker API, Postgres/PostGIS trên máy nội bộ qua Cloudflare Tunnel — bằng các lệnh một dòng.
---

MapsLibVN được thiết kế để dựng lại **bằng một lệnh** trên macOS, Windows qua WSL2, hay Linux. Trang này tóm tắt đường đi; chi tiết từng bước nằm trong repo tại `infra/server/README.md` và `docs/DEVLOG.md`. Repo hiện **private** trong giai đoạn nội bộ, liên hệ theo [Điều khoản tenant](/dieu-khoan/) mục 10 để được cấp quyền.

## 1. Kiến trúc cần dựng

| Thành phần | Chạy ở đâu | Chi phí |
|---|---|---|
| Tiles PMTiles nền Việt Nam và lớp POI | Cloudflare R2 kèm custom domain, client đọc thẳng bằng HTTP Range | 0 đồng egress |
| Places API, styles, trang duyệt đóng góp | Cloudflare Worker chạy Hono | gói Workers Free đủ cho nội bộ |
| Postgres 16 kèm PostGIS | máy nội bộ chạy 24/7 trong Docker, nối ra qua Cloudflare Tunnel rồi Access rồi Hyperdrive | tiền điện và máy |
| Pipeline dữ liệu OSM, Foursquare | container `pipeline` trên máy chủ, cron thứ Hai 02:00 | — |
| Tài liệu | Cloudflare Pages | 0 đồng |

Cơ sở dữ liệu **không mở cổng ra Internet**. Worker nối vào qua Hyperdrive, Hyperdrive xác thực bằng service token của Cloudflare Access, Access mới cho đi qua Tunnel.

## 2. Máy dev — chỉ cài hai thứ

Docker Desktop hoặc Docker Engine, và Node 22 qua `fnm` kèm `corepack enable`. Mọi công cụ khác gồm Planetiler, tippecanoe, osmium, DuckDB, Postgres và cloudflared đều nằm trong Docker, không cài native nên không lệch phiên bản giữa các máy.

```bash
git clone <repo> && cd maps-library-vietnam
pnpm install && pnpm run setup   # tạo .env, Postgres dev, migration, nạp fixture Quận 1
pnpm dev                          # playground và wrangler dev cùng lúc
```

Trên Windows, hãy clone vào trong hệ thống file của WSL để I/O nhanh và tránh vấn đề đường dẫn.

## 3. Máy chủ nội bộ 24/7

Yêu cầu máy: RAM từ 8 GB, SSD từ 50 GB, có Docker. Không dùng laptop làm việc, và khuyến nghị có UPS.

```bash
pnpm server:setup   # sinh .env máy chủ, cert TLS, compose up, migration, in checklist việc tay
```

Việc tay một lần trên Cloudflare, theo đúng checklist mà script in ra: tạo **Tunnel** với hostname kiểu TCP trỏ vào `postgres:5432`, tạo **service token** và **Access application** bảo vệ hostname đó, tạo **Hyperdrive** trỏ tới hostname qua Access với user chỉ đọc. Dán Hyperdrive ID vào cấu hình Worker.

Compose có bốn dịch vụ: `postgres` bắt buộc TLS và không mở cổng, `cloudflared`, `backup` chạy `pg_dump` hằng ngày lúc 03:00 đẩy lên R2 giữ 7 bản ngày và 4 bản tuần, `pipeline` chạy cron.

Chuyển sang máy khác: chạy `pnpm server:setup` trên máy mới, rồi `pnpm db:restore --latest`, rồi trỏ lại Tunnel. Dưới một giờ.

## 4. Tiles và dữ liệu

```bash
pnpm data:update --tiles   # build tiles nền, QA chủ quyền, upload R2, cập nhật manifest
pnpm data:update           # POI: OSM, Foursquare, gộp, nạp Postgres, build lớp POI
pnpm data:rollback         # đổi manifest về bản trước, có hiệu lực ngay
pnpm export:odbl           # xuất các bảng dẫn xuất OSM theo ODbL
```

Bước thể hiện chủ quyền với Hoàng Sa và Trường Sa là **bắt buộc** trong pipeline tiles: patch dữ liệu trước khi chạy Planetiler, thêm lớp `sovereignty` trong style, và bước QA sẽ chặn publish nếu thiếu.

## 5. Worker API và tài liệu

```bash
cd apps/api && pnpm exec wrangler deploy --env production
pnpm --filter @mapslibvn/docs build
pnpm --filter @mapslibvn/docs exec wrangler pages deploy dist --project-name <pages-project>
```

Worker cần các binding R2, KV, Hyperdrive và Analytics Engine, cùng các biến `TILES_BASE`, `ENVIRONMENT`, `QUOTA_ENABLED`, và hai biến Access để bảo vệ trang duyệt đóng góp.

Cấp khoá API cho ứng dụng nhúng:

```bash
pnpm db:seed-tenant db/seed/tenant_nhung_thu.sql
pnpm key:issue --tenant <uuid> --label "app của tôi" --kind web --origins https://app.example.vn
```

## 6. Giám sát

Hai lớp cảnh báo email, mỗi lớp bắt một nhóm lỗi khác nhau (spec `2026-09-20-canh-bao-suc-khoe`):

- **Cloudflare Tunnel Health Alert** — chính sách Notification `tunnel_health_event`, lọc trạng thái
  `down`, gửi tới email vận hành. Bắt máy chủ ngủ, mất mạng, `cloudflared` tắt. Sống độc lập với
  Worker. Email nhận phải bấm xác nhận trong thư của Cloudflare một lần.
- **Cron Worker mỗi 5 phút** đo ba phép đo của trang `/admin/health` (DB `SELECT 1`, một `/route`
  Valhalla thật, manifest KV), đo lại phép hỏng sau 15 s, và gửi **một** thư gộp tới `ALERT_EMAIL`
  khi trạng thái **đổi** (hỏng → thư "HỎNG: …", phục hồi → thư "PHỤC HỒI: … (hỏng N phút)"). Trạng
  thái nằm ở KV `META` khoá `health:canh-bao`; trần 10 thư/ngày. Trang Sức khoẻ hiện dòng "Giám sát
  tự động: đo lần cuối …" và tô đỏ nếu cron im lặng quá 60 phút.

Ngoài hai lớp trên: số liệu 5xx và p95 của Worker ở `/admin/health`, và báo cáo sử dụng hằng tuần
tự động gửi email từ Analytics Engine do container `pipeline` chạy vào thứ Hai lúc 08:00 giờ Việt Nam.
