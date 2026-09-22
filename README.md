# MapsLibVN

Nền tảng bản đồ nhúng cho web và mobile, dựng trên MapLibre GL và dữ liệu mở
(OpenStreetMap, Foursquare OS). Việt Nam trước.

## Bắt đầu (máy mới)

Hướng dẫn đầy đủ cho Windows 11/WSL2 và hai chế độ dev/full production data:
[`Setup_Local_Guide.md`](./Setup_Local_Guide.md).

Cài Docker Desktop và Node 22 (khuyên dùng `fnm`), rồi:

```bash
corepack enable
pnpm install
pnpm run setup  # tạo .env, dựng Postgres, migrate, cấu hình Git local cá nhân
pnpm dev
```

Khôi phục máy chủ mới từ backup production mã hóa (sau khi quản trị viên cấp
`infra/server/.env` qua password manager):

```bash
pnpm server:restore
```

## Start app hằng ngày

Mở Docker Desktop, sau đó chạy:

```bash
pnpm db:up
pnpm dev
```

`pnpm dev` chạy các app trong monorepo ở chế độ phát triển. Nhấn `Ctrl+C` để
dừng; khi không dùng database nữa, chạy `pnpm db:down`.

## Website quảng bá

Website tĩnh dựng bằng Astro, nằm ở `apps/site`, phát hành lên Cloudflare Pages
`mapslibvn-site`. Chạy tại máy:

```bash
pnpm --filter @mapslibvn/site dev      # http://localhost:4322
pnpm --filter @mapslibvn/site build    # dựng tĩnh ra apps/site/dist
pnpm test:site-e2e                     # 20 bài Playwright chạy trên bản build
```

Giá và bảng so sánh đối thủ đọc từ `@mapslibvn/catalog` lúc build, nên **không gõ tay con số nào
vào file `.astro`**; sửa giá là sửa package đó.

Ảnh hero và bốn ảnh OG sinh bằng `node scripts/site-images.mjs` rồi commit vào repo, vì máy dựng
của Pages không chạy Playwright.

**Đổi tên miền:** sửa `SITE_URL` trong `apps/site/site.config.mjs` (nguồn duy nhất của mọi URL
tuyệt đối: canonical, OG, sitemap, robots.txt), thêm `_redirects` chuyển 301 toàn bộ đường dẫn từ
tên miền cũ, rồi gửi lại sitemap ở Google Search Console.

## Phát hành toàn bộ SDK lên npm

Kiểm tra trước mà không publish:

```bash
pnpm sdk:publish --dry-run
```

Sau khi đã bump cùng version cho bốn SDK và đăng nhập npm, phát hành bằng đúng
một lệnh:

```bash
pnpm sdk:publish
```

Tài khoản npm bật 2FA thì lệnh trên dừng với `npm error code EOTP`. Truyền mã qua
**biến môi trường** (không dùng cờ `--otp`, để mã không lọt vào log lệnh); một mã
đủ cho cả bốn gói vì chúng publish liên tiếp trong vài giây:

```bash
NPM_CONFIG_OTP=123456 pnpm sdk:publish
```

Sau khi publish, lệnh tự đối chiếu registry và **báo lỗi nếu gói nào chưa lên** — vì
publish tuần tự `core → web → react → react-native`, một gói đầu thất bại mà gói sau
vẫn lên sẽ để lại trên npm một gói trỏ dependency vào version không tồn tại (đã xảy ra
22/09/2026: `@mapslibvn/react@0.13.0` đòi `@mapslibvn/core@0.13.0` chưa có, ai cài đều
gặp `ETARGET`). Khi đó publish riêng gói còn thiếu, **đừng** chạy lại lệnh tổng vì gói
đã lên sẽ lỗi `EPUBLISHCONFLICT` và chặn luôn phần còn lại:

```bash
cd packages/core && NPM_CONFIG_OTP=123456 pnpm publish --access public --publish-branch main --no-git-checks
```

Lệnh chạy lint, typecheck, test, build và dry-run toàn bộ package trước khi
publish tuần tự core → web → react → react-native với public access.

> Khi thêm SDK npm mới (Kotlin, Swift hoặc ngôn ngữ khác), bắt buộc thêm thư mục
> của SDK vào `SDK_PACKAGE_DIRS` trong `scripts/lib/npm-sdk-release.mjs` theo
> dependency order. Đây là source of truth của `pnpm sdk:publish` và release
> contract test; không được publish SDK mới bằng một lệnh rời rồi bỏ sót lệnh tổng.
> Lệnh sẽ tự dừng nếu phát hiện package public mới chưa được phân loại. `@mapslibvn/style`
> hiện là ngoại lệ nội bộ có tên rõ trong `NON_SDK_PACKAGE_DIRS`.

## Thanh toán (PayOS)

- Khách mua gói ở `/console/mua`; tiền về tài khoản ngân hàng đã liên kết với PayOS; gói tự vào sổ
  quota khi webhook tới (`POST /v1/pay/payos/webhook`). Cron mỗi 5 phút đối soát phòng webhook rơi
  và cấp lại đơn treo; 09:00 giờ VN gửi thư nhắc hạn.
- Ba secret production: `wrangler secret put PAYOS_CLIENT_ID|PAYOS_API_KEY|PAYOS_CHECKSUM_KEY --env production`.
  Thiếu bất kỳ khoá nào thì tạo đơn và webhook đều trả 503 — không có nhánh "tạm tin".
- Thử ở máy: `pnpm test:api-db` tự dựng PayOS giả (`scripts/lib/payos-fake.mjs`, cổng 8791) vì
  **PayOS không có môi trường sandbox**. Bắn một webhook đã ký vào harness:
  `pnpm pay:fake-webhook --order-code <mã> --amount <tiền>` (script từ chối trỏ vào production).
- Admin: `/admin/orders` — bốn ô đối soát, lọc theo trạng thái/tenant/khoảng ngày (giờ VN), "Thử cấp
  lại", "Xác nhận đã nhận tiền (tay)", "Huỷ đơn" (huỷ link PayOS trước, đánh dấu sau) và "Đánh dấu
  hoàn tiền" (chỉ ghi nhận, không đụng sổ quota — thu hồi quyền dùng là lệnh Tạm dừng ở Gói cước).
  `/admin/customers` — tài khoản khách: tìm theo email, phiên đang mở, tổ chức, vô hiệu hoá (xoá mọi
  phiên ngay) và kích hoạt lại. Mọi lệnh đi qua đếm ngược 5 giây và ghi lý do vào nhật ký.

## Cập nhật dữ liệu bản đồ và POI

Nên kiểm tra trước xem OSM hoặc Foursquare có phiên bản mới hay không:

```bash
pnpm data:update --dry-run
```

Chạy trọn pipeline cập nhật:

```bash
pnpm data:update
```

Lệnh này tự dò phiên bản nguồn, chỉ build phần thay đổi, chạy QA, cập nhật
database POI, upload các bản phát hành lên R2 và chuyển manifest sang bản mới.
OSM thay đổi sẽ cập nhật cả map tiles và POI; Foursquare thay đổi chỉ cập nhật
POI.

Các chế độ giới hạn:

```bash
pnpm data:update --tiles  # chỉ map tiles OSM
pnpm data:update --poi    # chỉ dữ liệu POI và lớp POI PMTiles
pnpm data:update --force  # build lại tất cả dù nguồn chưa đổi
```

> **Lưu ý:** `pnpm data:update` là pipeline phát hành, không chỉ tải dữ liệu về
> máy. Trước khi chạy thật, điền credentials Cloudflare/R2 và `HF_TOKEN` vào
> `.env`; không truyền hoặc commit secrets. `--dry-run` chỉ kiểm tra và không
> phát hành dữ liệu.

## Dev Container (tuỳ chọn, khuyên dùng khi đổi máy)

VS Code/Cursor → **“Dev Containers: Clone Repository in Container Volume…”** →
dán URL repo. Môi trường Node, Java, tippecanoe, DuckDB và Postgres sẽ giống nhau
trên mọi hệ điều hành.

Cách **“Reopen in Container”** vẫn hoạt động; các volume `node_modules` riêng
giữ dependency Linux tách khỏi máy host.

## Tài liệu

- Spec: `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md`
- Roadmap & plan: `docs/superpowers/plans/`
- Nhật ký & "đang ở đâu": `docs/DEVLOG.md` — **đọc trước khi làm bất cứ việc gì**

## Quy tắc GitHub

Chỉ dùng remote
`git@github.com-dotienphong:dotienphong/maps-library-vietnam.git` (account cá
nhân). Hook `pre-push` sẽ chặn nếu sai.
