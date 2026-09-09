# MapsLibVN

Nền tảng bản đồ nhúng cho web và mobile, dựng trên MapLibre GL và dữ liệu mở
(OpenStreetMap, Overture, Foursquare OS). Việt Nam trước.

## Bắt đầu (máy mới)

Cài Docker Desktop và Node 22 (khuyên dùng `fnm`), rồi:

```bash
corepack enable
pnpm install
pnpm run setup  # tạo .env, dựng Postgres, migrate, cấu hình Git local cá nhân
pnpm dev
```

## Start app hằng ngày

Mở Docker Desktop, sau đó chạy:

```bash
pnpm db:up
pnpm dev
```

`pnpm dev` chạy các app trong monorepo ở chế độ phát triển. Nhấn `Ctrl+C` để
dừng; khi không dùng database nữa, chạy `pnpm db:down`.

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

Lệnh chạy lint, typecheck, test, build và dry-run toàn bộ package trước khi
publish tuần tự core → web → react → react-native với public access.

> Khi thêm SDK npm mới (Kotlin, Swift hoặc ngôn ngữ khác), bắt buộc thêm thư mục
> của SDK vào `SDK_PACKAGE_DIRS` trong `scripts/lib/npm-sdk-release.mjs` theo
> dependency order. Đây là source of truth của `pnpm sdk:publish` và release
> contract test; không được publish SDK mới bằng một lệnh rời rồi bỏ sót lệnh tổng.
> Lệnh sẽ tự dừng nếu phát hiện package public mới chưa được phân loại. `@mapslibvn/style`
> hiện là ngoại lệ nội bộ có tên rõ trong `NON_SDK_PACKAGE_DIRS`.

## Cập nhật dữ liệu bản đồ và POI

Nên kiểm tra trước xem OSM, Overture hoặc Foursquare có phiên bản mới hay không:

```bash
pnpm data:update --dry-run
```

Chạy trọn pipeline cập nhật:

```bash
pnpm data:update
```

Lệnh này tự dò phiên bản nguồn, chỉ build phần thay đổi, chạy QA, cập nhật
database POI, upload các bản phát hành lên R2 và chuyển manifest sang bản mới.
OSM thay đổi sẽ cập nhật cả map tiles và POI; Overture hoặc Foursquare thay đổi
chỉ cập nhật POI.

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
