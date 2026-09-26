# MapsLibVN — Thiết kế hệ thống Maps SDK nhúng (Việt Nam trước)

- Ngày: 2026-08-26 (bản 2 — cập nhật hạ tầng 0 đ, môi trường di động, lệnh cập nhật dữ liệu)
- Trạng thái: bản viết đã được PHONG review; roadmap và plan M1 sẵn sàng thực thi
- Chủ dự án: PHONG
- Repo: `software_business/MapsLibVN` (repo riêng, private ở giai đoạn nội bộ)

## 0. Tóm tắt một đoạn

MapsLibVN là nền tảng bản đồ **nhúng được vào bất kỳ dự án web hoặc mobile nào**, dựng hoàn toàn trên phần mềm mã nguồn mở và dữ liệu mở (MapLibre GL, OpenStreetMap, Overture Maps, Foursquare OS Places), tự host trên Cloudflare (R2/Workers) cộng một Postgres/PostGIS chạy trên máy nội bộ 24/7 nối qua Cloudflare Tunnel — **0 đ chi phí vận hành cho 5.000 user đầu**. Phiên bản đầu phủ chi tiết **Việt Nam** với kho POI hợp nhất (~2–3 triệu địa điểm), tìm kiếm/autocomplete tiếng Việt, geocoding địa chỉ kiểu hẻm ("88/9 Nguyễn Lâm") có kèm mức chính xác, và cơ chế người dùng cuối đóng góp/sửa POI. Dùng nội bộ cho các dự án của PHONG trước; ranh giới API key/tenant có sẵn từ đầu để thương mại hoá sau mà không đổi kiến trúc. Môi trường phát triển và máy chủ đều dựng lại được **bằng một lệnh** trên macOS, Windows hay Linux.

## 1. Mục tiêu, phạm vi, người dùng

### 1.1 Mục tiêu

1. Một dòng `<script>` hoặc một gói npm là nhúng được bản đồ có POI, tìm kiếm, geocoding — không cần tài khoản Google/Mapbox.
2. Chi phí vận hành **0 đ** ở giai đoạn nội bộ (≤ 5.000 user); tăng tuyến tính và rẻ hơn Google ≥ 100 lần ở quy mô 1M map-load.
3. POI Việt Nam dày nhất có thể **từ nguồn hợp pháp**; chất lượng tăng theo thời gian nhờ đóng góp của người dùng cuối.
4. Tuân thủ giấy phép (BSD/MIT/ODbL/CDLA/Apache) và pháp luật Việt Nam về bản đồ (thể hiện đúng chủ quyền Hoàng Sa, Trường Sa).
5. Không phụ thuộc nhà cung cấp: đổi nguồn tiles, engine tìm kiếm, nơi chạy DB hay hạ tầng mà không đổi SDK và hợp đồng API.
6. Dữ liệu tự cập nhật theo nguồn gốc (OSM, Overture, Foursquare) bằng **một lệnh**, có rollback.

### 1.2 Trong phạm vi MVP (mốc M1–M5)

- Tiles nền vector cho Việt Nam (z0–14, thế giới mờ ở z0–6), 2 theme sáng/tối, phông tiếng Việt đầy đủ dấu.
- Kho POI hợp nhất từ OSM + Overture Places + Foursquare OS Places; lớp POI hiển thị trên bản đồ theo zoom.
- Places API: autocomplete, search, nearby, chi tiết POI, geocode địa chỉ, reverse geocode, đóng góp/sửa POI.
- Web SDK (`@mapslibvn/web`, ESM + UMD) và React bindings (`@mapslibvn/react`).
- API key theo tenant, quota, ghi nguồn (attribution) bắt buộc, đo lường sử dụng.
- Tài liệu + playground công khai.
- Môi trường dev một lệnh (`pnpm run setup`) và máy chủ nội bộ một lệnh (`pnpm server:setup`); lệnh cập nhật dữ liệu `pnpm data:update`.

### 1.3 Ngoài phạm vi MVP (có chỗ trong kiến trúc, làm sau)

- React Native SDK (`@mapslibvn/react-native`) — spec riêng sau khi web ổn định (mục 8.1).
- Chỉ đường (routing/ETA) — cần Valhalla/OSRM riêng.
- Ảnh vệ tinh, Street View, giao thông trực tiếp.
- Cổng nhà phát triển tự đăng ký, thanh toán.
- Chi tiết ngoài Việt Nam.
- Tìm kiếm chịu lỗi chính tả nâng cao (Meilisearch) — chỉ khi Postgres trigram không đủ (mục 8.3).

### 1.4 Người dùng

| Vai | Là ai | Cần gì |
|---|---|---|
| Dev nhúng (tenant) | PHONG và các dự án của anh (app kết bạn theo bối cảnh, stock_app…); sau này là developer khác | SDK dễ dùng, API ổn định, tài liệu, key |
| Người dùng cuối | Người dùng của app nhúng | Bản đồ nhanh, tìm đúng chỗ, sửa được thông tin sai |
| Admin | PHONG | Pipeline tự chạy, duyệt đóng góp, xem sử dụng, rollback, đổi máy làm việc không mất công |

### 1.5 Quyết định đã chốt (26/08/2026)

| Quyết định | Chọn | Lý do ngắn |
|---|---|---|
| Đối tượng | Nội bộ trước, thương mại sau | Khách chỉ trả tiền khi dữ liệu tốt hơn Goong; cần thời gian tích luỹ |
| Phạm vi địa lý | Việt Nam trước | Dữ liệu ~1 GB tiles, ~2–3 triệu POI; xử lý chủ quyền gọn |
| Nền tảng | Web trước, rồi React Native/Expo | Khớp stack React/Next.js hiện có |
| Kiến trúc | A — tĩnh tối đa (serverless) | Tiles/POI tĩnh trên CDN; chỉ tìm kiếm và đóng góp chạm DB; mọi nâng cấp nằm sau Worker |
| Hạ tầng | Cloudflare (R2, Workers, KV, Pages, Hyperdrive, Tunnel, Access) + **Postgres/PostGIS self-host bằng Docker trên máy nội bộ chạy 24/7** | 0 đ cho 5.000 user đầu; không managed Postgres nào free đủ 2–3 GB (Supabase 500 MB, Aiven 1 GB, Neon 0,5 GB); Hyperdrive→Access→Tunnel là đường Cloudflare hỗ trợ chính thức |
| Khi thương mại | Chuyển DB sang VPS Singapore / cloud VN / Supabase Pro bằng `pg_dump` + đổi cấu hình Hyperdrive | Khách trả tiền cần SLA; nhà riêng không phải nơi giữ dữ liệu khách hàng |
| Môi trường | Chỉ cài Docker + Node 22 trên máy host; mọi công cụ khác trong Docker; `pnpm run setup` một lệnh; Dev Container | PHONG sắp đổi MacBook → Windows |
| Tên | MapsLibVN; gói `@mapslibvn/*`; global UMD `MapsLibVN` | Do PHONG chọn |

## 2. Kiến trúc tổng thể

```
                 ┌──────────────── SDK (phía khách nhúng) ────────────────┐
                 │  @mapslibvn/web   @mapslibvn/react   (@mapslibvn/react-native – sau)
                 │                 └── dùng chung @mapslibvn/core ──┘       │
                 └──────────────┬──────────────────────────┬─────────────────┘
        pmtiles:// range-request trực tiếp (không qua Worker)  │ REST JSON (X-Api-Key) · style.json
        ┌───────────────────────▼──────────┐   ┌───────────▼──────────────────────┐
        │  R2 public  tiles.<domain>       │   │  apps/api  (Cloudflare Worker)    │
        │  vn-YYYYMMDD.pmtiles             │   │  /v1/styles  ← manifest phiên bản │
        │  poi-YYYYMMDD.pmtiles            │   │  /v1/autocomplete /search /nearby │
        │  fonts · sprites · CDN cache     │   │  /places/{id} /geocode /reverse   │
        │  egress 0 đ, không giới hạn      │   │  /edits /attribution · key/quota  │
        └───────────────────────▲──────────┘   └───────────▲──────────────────────┘
                                │                          │ Hyperdrive → Access → Tunnel
                     upload có phiên bản                   ▼
        ┌───────────────────────┴─────────────────────────────────────────────────┐
        │  MÁY NỘI BỘ 24/7 (Docker Compose)                                        │
        │  postgres: Postgres 16 + PostGIS + pg_trgm + unaccent (TLS, không mở port)│
        │    src_osm_place │ src_overture_place │ src_fsq_place  ← lớp nguồn, tách  │
        │    poi │ poi_source_link │ poi_edit │ category │ address_anchor │ street │
        │    alley │ admin_area │ admin_alias │ tenant │ api_key                    │
        │  cloudflared: Tunnel  ·  backup: pg_dump → R2  ·  pipeline: cron tuần    │
        └─────────────────────────────────────────────────────────────────────────┘
                                ▲ pnpm data:update (một lệnh; cũng chạy được trên GitHub Actions)
        ┌───────────────────────┴─────────────────────┐   ┌───────────────────────┐
        │ pipelines/poi  (image Docker chung)         │   │ pipelines/tiles       │
        │ OSM PBF · Overture parquet · FSQ parquet    │   │ pyosmium patch → Planetiler → QA → R2
        │ → chuẩn hoá → gộp → anchors → poi.pmtiles   │   │                       │
        └─────────────────────────────────────────────┘   └───────────────────────┘
```

### 2.1 Nguyên tắc thiết kế

1. **Tách bộ vẽ và dữ liệu.** MapLibre chỉ vẽ; dữ liệu là file có phiên bản trên R2 hoặc JSON từ Worker. Đổi nguồn tiles không đụng SDK.
2. **Mọi nâng cấp nằm sau Worker.** Postgres ở nhà → VPS → Supabase, hay thêm Meilisearch: hợp đồng API và SDK không đổi; "DB ở đâu" là một cấu hình Hyperdrive.
3. **Lớp nguồn bất biến, tách bảng.** Dữ liệu OSM/Overture/FSQ giữ nguyên trong bảng riêng theo nguồn; bản ghi chuẩn của MapsLibVN chỉ *liên kết* bằng ID (mô hình Collective Database của ODbL, mục 12.2).
4. **Tĩnh trước, động sau.** Bản đồ và lớp POI hiển thị là file tĩnh đọc thẳng từ R2 qua CDN; chỉ tìm kiếm và đóng góp chạm DB. Máy nội bộ sập thì **bản đồ vẫn chạy**, chỉ tìm kiếm tạm dừng.
5. **Ghi nguồn không tắt được.** SDK luôn hiển thị attribution; API trả chuỗi bắt buộc.
6. **Không có nguồn Google/Apple/Grab.** Không cào, không nhập dữ liệu vi phạm điều khoản.
7. **Trung thực về độ chính xác.** Mọi kết quả geocode kèm `precision` và `confidence`.
8. **Mọi thứ dựng lại được bằng lệnh.** Dữ liệu phục vụ tái tạo từ nguồn; môi trường dev và máy chủ dựng từ repo; không có bước tay nào ngoài checklist đã viết.

## 3. Repo, công nghệ, môi trường

### 3.1 Cấu trúc monorepo

```
MapsLibVN/
  apps/
    api/            Cloudflare Worker (Hono): styles, Places API, key/quota, tiles fallback
    docs/           Tài liệu + playground (Astro Starlight, Cloudflare Pages)
    admin/          Trang duyệt đóng góp tối giản (Next.js tĩnh trên Pages, bảo vệ bằng Cloudflare Access) — từ M4
  packages/
    core/           @mapslibvn/core: client TS gọi API, kiểu dữ liệu, chuỗi attribution, parser địa chỉ, chuẩn hoá tiếng Việt
    web/            @mapslibvn/web: bọc maplibre-gl + pmtiles protocol, web component <mapslibvn-autocomplete>, bản UMD
    react/          @mapslibvn/react: <MapsLibVNMap>, useMap, usePlaces
    style/          style.json light/dark, sprite, glyph, sovereignty.geojson, script build
  pipelines/
    Dockerfile      Image chung: Ubuntu 24.04 + Java 21 + Planetiler + tippecanoe + Python/pyosmium + DuckDB CLI + Node 22 + pnpm
    tiles/          patch PBF (pyosmium) → Planetiler → QA → upload R2
    poi/            ingest (DuckDB) → chuẩn hoá → gộp → anchors → COPY Postgres → poi.pmtiles
  infra/
    server/         compose.yml máy nội bộ 24/7: postgres, cloudflared, backup, pipeline-cron; README checklist Tunnel/Access/Hyperdrive
    dev/            compose.yml máy dev: postgres (fixture), tuỳ chọn pipeline
  db/
    migrations/     SQL migration Postgres (đánh số, idempotent; `pnpm db:migrate`)
    seed/           seed tenant/api_key, taxonomy, admin_alias, fixture Quận 1
  scripts/          setup.mjs · server-setup.mjs · data-update.mjs · data-rollback.mjs · db-restore.mjs — Node thuần, chạy mọi HĐH
  .devcontainer/    devcontainer.json (base = pipelines/Dockerfile + service postgres)
  docs/superpowers/specs/   tài liệu thiết kế (file này)
  .github/workflows/        ci.yml · deploy-api.yml · deploy-docs.yml · data-update.yml (tuỳ chọn, chạy khi máy nội bộ không sẵn)
  .gitattributes (* text=auto eol=lf) · .editorconfig · .nvmrc (22)
```

### 3.2 Công nghệ và phiên bản

| Lớp | Công cụ | Giấy phép | Ghi chú |
|---|---|---|---|
| Ngôn ngữ | TypeScript 5 (strict), Node 22 LTS, pnpm 9, Turborepo | — | Toàn repo trừ 1 bước pyosmium |
| Bộ vẽ | maplibre-gl 5.x + thư viện `pmtiles` (web); @maplibre/maplibre-react-native (sau, hỗ trợ `pmtiles://` sẵn) | BSD-3 / BSD-3 / BSD-2 | peer dependency của SDK |
| Tiles nền | Planetiler (bản phát hành mới nhất ≥ 0.9), lược đồ OpenMapTiles | Apache-2.0 / BSD + CC-BY 4.0 (thiết kế) | chạy trong image Docker |
| Tiền xử lý PBF | Python 3.12 + pyosmium | BSD | chỉ cho bước chủ quyền (4.3), trong image |
| POI tiles | tippecanoe 2.x | BSD-2 | trong image |
| Định dạng | PMTiles v3 | BSD-3 | |
| Pipeline dữ liệu | DuckDB 1.5 (httpfs, spatial) | MIT | đọc parquet thẳng từ S3 |
| DB | Postgres 16 + PostGIS 3.4 (image `postgis/postgis:16-3.4`), pg_trgm, unaccent | PostgreSQL / GPL (chạy server, không phân phối) | Docker trên máy nội bộ 24/7; sau: VPS/Supabase Pro |
| Kết nối DB | Cloudflare Hyperdrive → Access (service token) → Tunnel (`cloudflared`) → Postgres; driver `postgres` (porsager) | — / Apache-2.0 / Unlicense | DB không mở cổng ra Internet |
| API | Hono 4 trên Cloudflare Workers, Wrangler 4 | MIT | |
| Môi trường | Docker Desktop (macOS/Windows, backend WSL2) hoặc Docker Engine (Linux); Dev Containers; `fnm` quản lý Node | Apache-2.0 / MIT | 2 thứ duy nhất cài trên máy host: Docker + Node 22 |
| Test | Vitest, Playwright, `@maplibre/maplibre-gl-style-spec` | MIT / Apache | |
| Docs | Astro Starlight | MIT | |
| Phông | Noto Sans (Regular/Bold/Italic) | SIL OFL 1.1 | glyph PBF tự build |
| Icon | Maki + Temaki | CC0 | |

### 3.3 Giấy phép mã của chính repo

- Gói SDK (`packages/*`) phát hành npm dưới **MIT** để khách nhúng không vướng gì.
- `apps/*`, `pipelines/*`, `infra/*`, `db/*` giữ private trong giai đoạn nội bộ. Không thành phần nào dùng mã copyleft phía server cần phân phối, nên không có nghĩa vụ mở mã.

### 3.4 Môi trường phát triển di động (macOS / Windows / Linux)

Mục tiêu: máy mới → làm việc được trong **≤ 15 phút**, kể cả tải image.

- **Cài trên máy host chỉ 2 thứ**: Docker Desktop (Windows: bật WSL2, Docker dùng backend WSL2) và Node 22 (qua `fnm`, có bản Windows; `corepack enable` để có pnpm). Java, Planetiler, tippecanoe, pyosmium, DuckDB, Postgres, cloudflared **đều nằm trong Docker** — không cài native, không lệch phiên bản giữa máy.
- **Một lệnh**: `git clone <repo> && cd maps-library-vietnam && pnpm install && pnpm run setup`. `scripts/setup.mjs` (Node, không bash): kiểm tra Docker/Node, tạo `.env` từ `.env.example`, `docker compose -f infra/dev/compose.yml up -d` (Postgres+PostGIS), chạy migration, nạp fixture Quận 1 (~3 phút), kiểm tra `wrangler login`, in hướng dẫn `pnpm dev` (playground + `wrangler dev` cùng lúc).
- **Dev Container** (tuỳ chọn, khuyến nghị khi đổi máy): `.devcontainer/devcontainer.json` dùng `pipelines/Dockerfile` làm base + service Postgres; VS Code/Cursor "Reopen in Container" → môi trường giống hệt trên mọi HĐH, kể cả chạy pipeline đầy đủ.
- **Windows**: clone repo bên trong hệ thống file WSL (`~/src/MapsLibVN`) để I/O nhanh và tránh vấn đề đường dẫn; `.gitattributes` ép LF; mọi script npm là Node (`scripts/*.mjs`), không có lệnh bash trong `package.json`; `.editorconfig` thống nhất.
- **Bí mật**: `.env.example` chỉ chứa giá trị dev mặc định an toàn (Postgres local). Bí mật thật (token Tunnel, Cloudflare API token, `EDIT_SALT`, service token Access) không nằm trong git — PHONG giữ trong password manager; máy dev mới chỉ cần `wrangler login`. Bí mật Worker nạp bằng `wrangler secret`; bí mật máy chủ nằm trong `infra/server/.env` trên chính máy đó.
- **Dữ liệu cho dev**: mặc định fixture Quận 1 (nhanh, đủ test mọi tính năng). Cần toàn VN thì `pnpm db:restore --latest` tải bản `pg_dump` mới nhất từ R2 (~1 GB, 10–15 phút). Máy dev không cần chạy pipeline đầy đủ.
- **Đồng bộ giữa máy**: code qua GitHub (remote alias `github.com-dotienphong`), không copy thư mục; `node_modules`, `.env`, dữ liệu Docker không di chuyển — dựng lại bằng `pnpm run setup`.

## 4. P1 — Tiles nền Việt Nam

### 4.1 Nguồn và sản phẩm

- OSM: `https://download.geofabrik.de/asia/vietnam-latest.osm.pbf` (~350 MB, cập nhật hằng ngày).
- Natural Earth + OSM water polygons: Planetiler tự tải.
- Sản phẩm: **một file** `vn-YYYYMMDD.pmtiles` (ước ~1 GB), lược đồ OpenMapTiles, zoom 0–14; ngoài Việt Nam chỉ có lớp Natural Earth (đất/nước/biên giới/tên nước) đến z6.

### 4.2 Lệnh build (chạy trong image `pipelines/Dockerfile`, do `pnpm data:update --tiles` gọi)

```
java -Xmx4g -jar planetiler.jar \
  --osm-path=work/vietnam-patched.osm.pbf \
  --download --area=vietnam \
  --bounds=-180,-85.0511,180,85.0511 \
  --languages=vi,en \
  --maxzoom=14 \
  --nodemap-type=sparsearray --storage=mmap \
  --output=out/vn-YYYYMMDD.pmtiles
```

- Thứ tự: (1) `planetiler --area=vietnam --only-download` tải PBF gốc + Natural Earth + water polygons; (2) pyosmium patch PBF gốc → `work/vietnam-patched.osm.pbf`; (3) lệnh build trên với `--osm-path` trỏ vào file đã patch (Planetiler chỉ tải khi file thiếu, nên file patch không bị ghi đè).
- `--bounds` toàn cầu để các lớp Natural Earth phủ thế giới ở zoom thấp trong khi OSM chỉ có Việt Nam.
- **Dự phòng** (nếu kết quả zoom thấp ngoài VN không đạt trong M1): lấy lớp thế giới z0–6 bằng `pmtiles extract --maxzoom=6` từ bản build công cộng của Protomaps (ODbL, ~150 MB) làm nguồn thứ hai trong style. Quyết định chốt ở M1 sau khi nhìn kết quả; cả hai đường đều đã được thiết kế.

### 4.3 Chủ quyền — ba lớp bảo vệ, đều bắt buộc

1. **Tầng dữ liệu (pyosmium patch, trước Planetiler):** với mọi node/way/relation có `name` nằm trong hai bbox
   - Hoàng Sa: lon 111.0–113.0, lat 15.7–17.2
   - Trường Sa: lon 111.5–117.8, lat 6.5–12.0
   thì đặt `name := name:vi` nếu có `name:vi`; nếu không có `name:vi` thì **xoá `name`** (không hiển thị tên nước ngoài); xoá các khoá `name:zh`, `name:zh-Hans`, `name:zh-Hant`, `name:en` trong hai bbox này để không lọt qua lớp nào khác. Mọi thứ ngoài bbox giữ nguyên.
2. **Tầng style:** mọi nhãn dùng biểu thức `["coalesce", ["get","name:vi"], ["get","name"]]`; nguồn GeoJSON `sovereignty` (trong `packages/style/sovereignty.geojson`) với hai điểm nhãn "Quần đảo Hoàng Sa (Việt Nam)" tại (16.5, 112.0) và "Quần đảo Trường Sa (Việt Nam)" tại (10.0, 114.0), hiển thị từ **z ≥ 4** (khi cả nước nằm trong khung hình) với ưu tiên cao nhất (`symbol-sort-key` thấp nhất, không bị che).
3. **Tầng QA trong pipeline (`pipelines/tiles/qa.ts`):** giải mã toàn bộ tiles z4–z14 giao hai bbox; **fail** nếu bất kỳ thuộc tính `name*` chứa ký tự CJK, hoặc chứa các chuỗi `Paracel`, `Spratly`, `Xisha`, `Nansha`, `Huangyan`, `Zhongsha`; fail nếu không có polygon đảo nào trong mỗi bbox ở z8; fail nếu style không có 2 nhãn sovereignty. Build không đạt QA → không upload, không đổi manifest.

### 4.4 Style, phông, icon (`packages/style`)

- Hai theme: `mapslibvn-light` (kế thừa OSM Liberty, BSD), `mapslibvn-dark` (kế thừa Dark Matter/OpenMapTiles, BSD/CC-BY). Ghi nguồn thiết kế trong `NOTICE`.
- Glyph: build từ Noto Sans bằng `font-maker` thành PBF theo dải 256; phủ đủ tiếng Việt (Latin Extended Additional).
- Sprite: Maki + Temaki, build bằng `spreet`.
- Style được **template hoá**: `{TILES_BASE}`, `{VN_FILE}`, `{POI_FILE}`, `{API_BASE}`, `{KEY}` thay tại Worker khi phục vụ `/v1/styles/{light|dark}.json`.
- Style phải qua `validateStyleMin` (maplibre-gl-style-spec) trong CI.

### 4.5 Phục vụ tiles: trực tiếp từ R2, style là "alias"

- R2 bucket `mapslibvn-tiles` gắn **custom domain** `tiles.<domain>` (zone hiện có của PHONG trên Cloudflare; không cần mua domain mới). CORS: cho phép `GET, HEAD` + header `Range` từ mọi origin. Cache Rules "cache everything" cho `tiles.<domain>/tiles/*` và `/assets/*`, TTL 1 năm — an toàn vì tên file có ngày, bất biến.
- SDK và style dùng nguồn `pmtiles://https://tiles.<domain>/tiles/vn-YYYYMMDD.pmtiles` và `.../poi-YYYYMMDD.pmtiles`. MapLibre GL JS đọc qua thư viện `pmtiles` (SDK tự `addProtocol`); MapLibre Native (Android ≥ 11.8, iOS ≥ 6.10) hỗ trợ `pmtiles://` sẵn. **Tile không chạm Worker** → không tính vào 100.000 request/ngày của Workers Free; egress R2 = 0 đ.
- **Style là alias phiên bản**: Worker phục vụ `GET /v1/styles/{light|dark}.json` đọc manifest KV `release:current` (`{vn:"vn-20260826", poi:"poi-20260826"}`) → điền tên file hiện hành. Phát hành = upload file mới + smoke test đọc 20 tile ngẫu nhiên + ghi manifest; phiên đang mở tiếp tục dùng file cũ đến khi tải lại; rollback = ghi manifest về bản trước. Giữ 3 bản gần nhất trên R2, xoá bản cũ hơn.
- Bố cục R2: `tiles/vn-YYYYMMDD.pmtiles`, `tiles/poi-YYYYMMDD.pmtiles`, `assets/fonts/{fontstack}/{range}.pbf`, `assets/sprites/{name}[@2x].{json|png}`, `state/releases.json`, `backups/`.
- Style cache `Cache-Control: max-age=3600`, vary theo key.
- **Fallback** cho client không dùng được `pmtiles://` (Leaflet, iframe bên thứ ba): route Worker `GET /v1/tiles/{vn|poi}/{z}/{x}/{y}.pbf` (đọc R2 qua binding, Cache API, `max-age=86400`) và TileJSON `GET /v1/tiles/{vn|poi}.json`. Không phải đường mặc định; tile ngoài bbox VN ở z > 6 trả `204`.

### 4.6 Lịch và tài nguyên

- Chạy trong `pnpm data:update` (mục 5.9) trên máy nội bộ, cron thứ Hai 02:00 giờ VN; Planetiler VN cần ~4 GB RAM, 20–30 phút.
- Chạy được tay bất kỳ lúc nào, hoặc trên GitHub Actions (`data-update.yml`, runner 7 GB) khi máy nội bộ không sẵn.

## 5. P2 — Kho POI và dữ liệu geocoding

### 5.1 Nguồn (đã đo ngày 26/08/2026)

| Nguồn | Giấy phép | Độ phủ VN đo được | Vai trò |
|---|---|---|---|
| OSM (cùng PBF ở P1) | ODbL | TP.HCM: 1.646 trường học, 29.917 hẻm có tên "Hẻm <số>", 31.288 đối tượng có số nhà, 2.151 quán cà phê | Khung xương: đường, hẻm, ranh giới, cơ sở công (trường, bệnh viện, công viên) |
| Overture Places (`s3://overturemaps-us-west-2/release/<ver>/theme=places/type=place/`) | CDLA-Permissive 2.0 (Apache-2.0 phần FSQ) | **2.011.764 POI trong bbox VN; 90% có địa chỉ chữ; 93% có phân loại**; ô 2×1,5 km quanh Nguyễn Lâm: 6.849 POI, 1.226 địa chỉ kiểu hẻm | Khối lượng POI thương mại; **kho mốc số nhà** |
| Foursquare OS Places (`s3://fsq-os-places-us-east-1/release/dt=<date>/places/parquet/`) | Apache-2.0 | ước 0,5–1 triệu bản ghi VN (đo ở M2) | Bổ sung, popularity |
| Wikidata | CC0 | — | Giai đoạn 2 (trường đại học, di tích) |

Lưu ý chất lượng Overture: 98,8% bản ghi mẫu đến từ Meta (trang Facebook): có trùng lặp, cơ sở đã đóng, toạ độ lệch (ví dụ "102 Đường Nguyễn Lâm" lệch ~120 m khỏi đường), `confidence` phổ biến 0,5–0,75. Bước gộp và lọc là bắt buộc.

### 5.2 Lược đồ dữ liệu (Postgres, schema `public`, migration trong `db/migrations`)

Bảng nguồn — **bất biến**, chỉ pipeline ghi, mỗi lần nạp thay toàn bộ theo `release`:

```
src_osm_place      (osm_type char(1), osm_id bigint, name text, names jsonb, tags jsonb, geom geometry(Point,4326),
                    release date, PRIMARY KEY (osm_type, osm_id))
src_overture_place (id text PRIMARY KEY, name text, names jsonb, category text, categories jsonb, confidence real,
                    addresses jsonb, websites text[], phones text[], sources jsonb, geom geometry(Point,4326), release text)
src_fsq_place      (fsq_place_id text PRIMARY KEY, name text, categories jsonb, address text, locality text, region text,
                    tel text, website text, date_closed date, geom geometry(Point,4326), release date)
```

Bảng chuẩn của MapsLibVN:

```
category         (code text PRIMARY KEY, group_code text, name_vi text, name_en text, icon text, rank smallint)
category_map     (source text, source_value text, code text, PRIMARY KEY (source, source_value))

poi              (id text PRIMARY KEY,                 -- ULID sinh từ hash nguồn chính (5.4)
                  name text NOT NULL, name_norm text NOT NULL, name_alt text[],
                  category text REFERENCES category, geom geometry(Point,4326) NOT NULL,
                  housenumber text, street text, ward text, province text, address_text text,
                  contact jsonb,                       -- {phone[], website[], facebook}
                  hours jsonb,                         -- opening_hours chuẩn OSM + bản parse
                  primary_source text, primary_source_id text,
                  quality_score smallint, popularity real,
                  status text CHECK (status IN ('active','closed','pending','rejected')),
                  locked_fields text[] DEFAULT '{}',   -- trường do người dùng sửa, pipeline không ghi đè
                  created_by text CHECK (created_by IN ('pipeline','user')),
                  created_at timestamptz, updated_at timestamptz)
poi_source_link  (poi_id text REFERENCES poi, source text, source_id text, confidence real, role text CHECK (role IN ('primary','secondary')),
                  PRIMARY KEY (source, source_id))
poi_edit         (id bigserial PRIMARY KEY, poi_id text NULL REFERENCES poi, tenant_id uuid, end_user_hash text,
                  kind text CHECK (kind IN ('create','update','close','reopen','report')),
                  changes jsonb, photo_url text, note text,
                  status text CHECK (status IN ('pending','approved','rejected','auto_approved')),
                  reviewer text, reviewed_at timestamptz, ip_hash text, created_at timestamptz)

address_anchor   (id bigserial PRIMARY KEY, housenumber text, alley_chain text[], house_in_alley text,
                  street_norm text, ward_norm text, province_norm text, geom geometry(Point,4326),
                  source text, source_id text, confidence real, release text)
street           (id bigserial PRIMARY KEY, osm_way_ids bigint[], name text, name_norm text, ward_norm text[], province_norm text,
                  geom geometry(MultiLineString,4326))
alley            (id bigserial PRIMARY KEY, osm_way_id bigint, number text, parent_street_id bigint REFERENCES street,
                  name text, geom geometry(LineString,4326), entrance geometry(Point,4326))
admin_area       (id bigserial PRIMARY KEY, level smallint, name text, name_norm text, parent_id bigint,
                  osm_relation_id bigint, geom geometry(MultiPolygon,4326))
admin_alias      (alias_norm text, level smallint, admin_area_id bigint REFERENCES admin_area, valid_until date,
                  PRIMARY KEY (alias_norm, level))

tenant           (id uuid PRIMARY KEY, name text, plan text CHECK (plan IN ('internal','free','paid')), created_at timestamptz)
api_key          (key text PRIMARY KEY,                -- dạng mlv_live_<24 ký tự base62>
                  tenant_id uuid REFERENCES tenant, label text, kind text CHECK (kind IN ('web','mobile','server')),
                  allowed_origins text[], allowed_bundle_ids text[], scopes text[],
                  quota_tiles_per_day int, quota_places_per_day int, quota_edits_per_day int,
                  active boolean DEFAULT true, created_at timestamptz, revoked_at timestamptz)
```

Index chính: GIST trên mọi `geom`; GIN `gin_trgm_ops` trên `poi.name_norm`, `street.name_norm`, `address_anchor.street_norm`; B-tree `(street_norm, ward_norm)` trên `address_anchor`; B-tree `poi(status, category)`.

Ước lượng kích cỡ: ~2,5 triệu `poi` + ~3,5 triệu bản ghi nguồn + ~2 triệu `address_anchor` ≈ 2–3 GB kể cả index → chạy thoải mái trên Postgres self-host (máy ≥ 8 GB RAM, SSD ≥ 50 GB). Không có khoản chi cố định nào ở giai đoạn nội bộ.

### 5.3 Chuẩn hoá tiếng Việt (`packages/core/src/normalize.ts`, dùng chung pipeline và API)

Thứ tự áp dụng cho `name_norm`, `street_norm`, `ward_norm`, và chuỗi truy vấn:

1. Unicode NFC → lowercase.
2. Bỏ dấu: NFD, xoá combining marks; `đ → d`.
3. Thay viết tắt (bảng cố định trong `abbrev.json`): `p. → phuong`, `q. → quan`, `tp. → thanh pho`, `tt. → thi tran`, `đ. → duong`, `kp → khu pho`, `f → phuong` (chỉ khi đứng trước số), `ng. → nguyen`, `cty → cong ty`, `tnhh`, `cp → co phan`.
4. Bỏ dấu câu trừ `/` (giữ chuỗi hẻm) và `-`; gộp khoảng trắng.
5. **Chỉ khi so khớp tên POI** (không áp dụng cho hiển thị): bỏ từ đệm đầu chuỗi: `cong ty`, `cty`, `tnhh`, `co phan`, `cua hang`, `quan`, `tiem`, `nha hang`, `shop`, `cafe`, `ca phe`, `coffee` → tạo `name_core` dùng cho trigram.
6. Alias thương hiệu (`brand_alias.json`, mở rộng dần): `highlands = highlands coffee`, `cong caphe = cong ca phe = cộng`, `the coffee house = tch`, `phuc long = phuc long coffee & tea`…

Kiểm thử: bộ fixture ≥ 200 cặp (đầu vào → chuẩn hoá) gồm các trường hợp dấu ghép Unicode (`ả` NFD/NFC), viết tắt, chữ hoa toàn phần.

### 5.4 Thuật toán gộp (conflation) — `pipelines/poi/src/conflate.ts`

1. **Ứng viên**: với mỗi bản ghi nguồn, tìm bản ghi nguồn khác trong bán kính 75 m (150 m nếu cả hai thuộc nhóm `education`, `health`, `public_admin`, `transport` — cơ sở diện tích lớn).
2. **Tương thích loại**: cùng `group_code` sau ánh xạ, hoặc một bên không có loại.
3. **Tương đồng tên**: trigram similarity trên `name_core` ≥ 0,6; **hoặc** ≥ 0,45 khi trùng số điện thoại (chuẩn hoá E.164) hoặc trùng domain website.
4. **Ghép tham lam gần nhất trước** (không dùng union-find bắc cầu để tránh gộp dây chuyền): sắp cặp theo điểm `0,6·sim + 0,4·(1 − d/75)`, duyệt giảm dần, mỗi bản ghi chỉ vào một cụm; cụm tối đa 1 bản ghi mỗi nguồn (trùng trong cùng nguồn xử lý riêng ở bước 0 bằng cùng luật nhưng ngưỡng sim ≥ 0,8).
5. **Chọn nguồn chính** theo điểm đầy đủ: `3·có_sđt + 3·có_website + 2·có_giờ + 2·có_số_nhà + 1·có_loại + 2·confidence`; hoà → OSM > Overture > FSQ.
6. **Vị trí**: nếu cụm có OSM → lấy toạ độ OSM (khảo sát thực địa, ít lệch); nếu không → toạ độ nguồn chính.
7. **Trường của `poi`** chép từ **đúng một** nguồn chính (5.2 `primary_source`); các nguồn khác chỉ nằm trong `poi_source_link`. Không trộn trường giữa nguồn (giữ tính "khớp ID trivial" theo hướng dẫn ODbL).
8. **ID ổn định**: `poi.id = ULID(hash(primary_source, primary_source_id))` — chạy lại pipeline giữ nguyên ID nếu nguồn chính không đổi; nếu nguồn chính biến mất, ID giữ, `primary_source` chuyển sang nguồn còn lại, ghi log.
9. **Tôn trọng sửa của người dùng**: pipeline chỉ cập nhật các trường không nằm trong `locked_fields`; POI `created_by='user'` không bao giờ bị xoá bởi pipeline, chỉ có thể được gắn thêm `poi_source_link` khi khớp.
10. **Loại bỏ**: Overture `confidence < 0,4` và không khớp nguồn khác → không tạo `poi` (giữ ở bảng nguồn); FSQ có `date_closed` → `status='closed'`.

### 5.5 Điểm chất lượng và độ phổ biến

- `quality_score` (0–100) = đầy đủ trường (tối đa 40: sđt 10, website 10, giờ 10, số nhà 10) + đồng thuận nguồn (20 nếu ≥ 2 nguồn, 10 nếu 1 nguồn có confidence ≥ 0,7) + confidence nguồn chính ×20 + độ mới (20 nếu nguồn cập nhật ≤ 12 tháng, giảm tuyến tính về 0 ở 48 tháng).
- `popularity` = log2(1 + số nguồn) + 0,5·(FSQ có bản ghi) + đóng góp người dùng đã duyệt ×0,2 (tối đa 1). Dùng để xếp hạng, không hiển thị.

### 5.6 Phân loại (taxonomy)

12 nhóm (`group_code`): `food_drink`, `shopping`, `services`, `health`, `education`, `finance`, `lodging`, `entertainment_sport`, `culture_tourism`, `transport`, `public_admin`, `religion_community`. Khoảng 150 loại lá định nghĩa trong `db/seed/category.json` (mã, tên VI/EN, icon, rank hiển thị theo zoom). Ba bảng ánh xạ `category_map` từ OSM (`amenity=cafe → cafe`), Overture (`coffee_shop → cafe`), FSQ (`Coffee Shop → cafe`). Giá trị không ánh xạ được → `other` trong nhóm suy ra từ nguồn, ghi log để bổ sung dần.

### 5.7 Địa chỉ: bộ phân tích và kho mốc

**Bộ phân tích địa chỉ tiếng Việt** (`packages/core/src/address.ts`, thuần TS, không phụ thuộc mạng) trả về:

```ts
type ParsedAddress = {
  housenumber?: string;      // "88/9", "12/59F", "130C"
  alleyChain: string[];      // ["88"] cho "88/9"; ["88","9"] cho "88/9/12"
  houseInAlley?: string;     // "9" cho "88/9"; "12" cho "88/9/12"
  alleyKeyword?: 'hem'|'ngo'|'ngach'|'kiet';
  street?: string; streetNorm?: string;
  ward?: string; district?: string; province?: string;   // đã bỏ tiền tố P./Q./TP.
  confidence: number;        // 0–1 theo số thành phần nhận diện được
}
```

Ngữ pháp nhận diện (theo thứ tự): `[số nhà [/số]*] [Hẻm|Ngõ|Ngách|Kiệt N] [Đường|Phố] <tên đường>, [Phường|Xã|Thị trấn] X, [Quận|Huyện|Thị xã|TP] Y, <Tỉnh/TP>`; chấp nhận thiếu dấu phẩy, thiếu tiền tố, viết tắt (5.3), thứ tự tỉnh trước hay sau. Fixture ≥ 300 địa chỉ thật (lấy từ Overture `addresses.freeform` của VN, ẩn danh) với kỳ vọng phân tách.

**Kho mốc `address_anchor`** nạp từ: OSM `addr:housenumber` + `addr:street` (+ `addr:city`/quan hệ hành chính); địa chỉ POI Overture và FSQ đã phân tách (chỉ nhận khi có `housenumber` và `street`, `confidence ≥ 0,5`); đóng góp người dùng đã duyệt (`confidence = 0,95`). Mốc trùng (cùng số, cùng đường, cách nhau < 30 m) gộp lấy trung vị toạ độ.

**Đường và hẻm**: `street` gộp các way OSM cùng `name_norm` liền kề trong cùng phường (để nội suy theo toàn tuyến); `alley` từ way có tên khớp `^(Hẻm|Ngõ|Ngách|Kiệt) (\d+[A-Z]?)( .+)?$`, `parent_street` xác định theo (a) phần tên sau số nếu có ("Hẻm 112 Nguyễn Lâm"), (b) nếu không thì đường có tên gần nhất chạm điểm đầu/cuối hẻm; `entrance` = điểm hẻm chạm đường mẹ.

**Hành chính**: `admin_area` từ ranh giới OSM `admin_level=4` (34 tỉnh/thành sau 1/7/2025) và `admin_level=8` (phường/xã); `admin_level=6` (quận/huyện cũ) nạp nếu OSM còn để phục vụ `admin_alias`. `admin_alias` seed từ bảng đối chiếu tên cũ → mới của sáp nhập 2025 (`db/seed/admin_alias_2025.csv`, biên soạn từ Nghị quyết sắp xếp đơn vị hành chính), ví dụ `phuong 6, quan 10 → Phường Diên Hồng`. Mức level nào thực sự có trong OSM được xác nhận ở lần chạy đầu M2 và ghi vào README pipeline.

### 5.8 Lớp POI tiles (`poi-YYYYMMDD.pmtiles`)

- Xuất `poi` có `status='active'` ra FlatGeobuf → tippecanoe, zoom 10–16 (style overzoom đến 22).
- Luật mật độ: z10–11 chỉ nhóm `education`, `health`, `transport`, `public_admin`, `culture_tourism` với `quality_score ≥ 70`; z12–14 mọi nhóm với `quality_score ≥ 60` và `-r1 --drop-densest-as-needed`; z15–16 toàn bộ.
- Thuộc tính tối thiểu: `id`, `name`, `cat`, `grp`, `q` (bucket 0–9). Chi tiết lấy qua `GET /v1/places/{id}` khi bấm.
- Kích cỡ mục tiêu ≤ 300 MB.

### 5.9 Lệnh cập nhật dữ liệu một dòng và lịch chạy

Một lệnh cho mọi cập nhật dữ liệu, chạy trong image Docker chung (`scripts/data-update.mjs` điều phối):

```
pnpm data:update              # dò 3 nguồn → chỉ build phần có bản mới → QA → upload → chuyển phiên bản
pnpm data:update --tiles      # chỉ tiles nền (OSM)
pnpm data:update --poi        # chỉ kho POI + poi.pmtiles
pnpm data:update --force      # build lại tất cả dù không có bản mới
pnpm data:update --dry-run    # chỉ báo nguồn nào có bản mới, không làm gì
pnpm data:rollback [--to=YYYYMMDD]   # đổi manifest về bản trước (tức thì)
```

Các bước của `data:update`:

1. **Dò phiên bản**: Geofabrik (`Last-Modified` + `.md5` của `vietnam-latest.osm.pbf`), Overture (liệt kê `s3://overturemaps-us-west-2/release/` lấy bản mới nhất), Foursquare (partition `dt=` mới nhất). So với `state/releases.json` trên R2. Không có gì mới và không `--force` → thoát mã 0, không làm gì (idempotent).
2. **Build có điều kiện**: OSM đổi → tiles (4.2–4.3) và POI; Overture/FSQ đổi → chỉ POI. Pipeline POI: DuckDB đọc parquet theo bbox VN → chuẩn hoá → gộp → anchors/street/alley/admin → `COPY` vào bảng tạm → hoán đổi bảng trong một transaction → `REINDEX` → gộp đóng góp đã duyệt (tôn trọng `locked_fields`) → xuất `poi.pmtiles`.
3. **QA**: chủ quyền (4.3), validate style, đếm sanity (số `poi` không giảm quá 10% so bản trước nếu không `--force`), đọc 20 tile ngẫu nhiên.
4. **Phát hành nguyên tử**: upload file mang ngày lên R2 → ghi manifest KV `release:current` → ghi `state/releases.json` → in tóm tắt (số POI, số mốc, thời gian) và gửi email tuỳ chọn. Thất bại ở bất kỳ bước nào → không đổi gì, bản cũ vẫn phục vụ.

Nơi chạy: **mặc định cron trên máy nội bộ 24/7** (service `pipeline` trong `infra/server/compose.yml`, thứ Hai 02:00 giờ VN; đổi lên hằng ngày cho OSM khi muốn); chạy tay bất kỳ lúc nào từ máy dev (`pnpm data:update` dùng cùng image, nối DB qua Tunnel bằng `cloudflared access tcp`); hoặc `gh workflow run data-update` trên GitHub Actions (runner 7 GB, ~2.000 phút/tháng free đủ cho chạy tuần). Một vòng đầy đủ ~1,5–2 giờ.

## 6. P3 — Places API (Worker `apps/api`, Hono)

### 6.1 Endpoint

| Endpoint | Tham số | Trả về | Ghi chú |
|---|---|---|---|
| `GET /v1/autocomplete` | `q` (≥ 2 ký tự), `near=lat,lng`, `limit≤10`, `types=poi,street,address` | `{items:[{type, id?, name, secondary, lat, lng, precision?, score}]}` | hợp nhất POI + đường + địa chỉ; **cache 10 phút** theo khoá `(q_norm, H3 res 6 của near, types)` |
| `GET /v1/search` | `q`, `category`, `near`, `radius≤50000`, `bbox`, `limit≤50`, `offset≤500` | `{items:[Place], total}` | |
| `GET /v1/nearby` | `lat,lng`, `radius≤5000`, `category`, `limit≤100` | `{items:[Place]}` | `ST_DWithin` |
| `GET /v1/places/{id}` | — | `Place` đầy đủ + `sources[]` + `attribution` | cache 1 giờ |
| `GET /v1/geocode` | `q`, `near`, `limit≤5` | `{items:[{lat,lng,precision,confidence,matched:{housenumber,street,ward,province},display_name,bbox}]}` | thang phân giải 6.3 |
| `GET /v1/reverse` | `lat,lng` | `{address:{approx_housenumber,street,ward,province,display_name}, nearest_poi:Place?}` | |
| `POST /v1/edits` | body `{poi_id?, kind, changes, photo_url?, note?, end_user_token}` | `{edit_id, status}` | scope `edits:write`; luật duyệt 6.5 |
| `GET /v1/attribution` | — | `{html, text, links[]}` | chuỗi bắt buộc (12.3) |
| `GET /v1/styles/{light\|dark}.json` | `key` | style đã điền phiên bản tiles | mục 4.5 |

`Place` = `{id, name, category:{code,group,name_vi,name_en}, lat, lng, address:{housenumber,street,ward,province,text}, contact, hours, quality_score, status, updated_at}`.

### 6.2 Xếp hạng autocomplete

`score = 0,55·sim + 0,25·prox + 0,15·pop + 0,05·prior`, trong đó `sim` = trigram similarity giữa `q_norm` và `name_norm` (hoặc `name_core`), cộng 0,1 nếu `name_norm` bắt đầu bằng `q_norm`; `prox = exp(−d/5 km)` nếu có `near`, 0,5 nếu không; `pop` = `popularity` chuẩn hoá 0–1; `prior` = 1 cho POI, 0,7 cho đường, và **đảo ngược** (địa chỉ 1, POI 0,5) khi `q` bắt đầu bằng chữ số. Hệ số nằm trong `apps/api/src/ranking.ts` để chỉnh bằng test.

### 6.3 Thang phân giải geocode (`apps/api/src/geocode.ts`)

Đầu vào qua bộ phân tích 5.7, rồi thử lần lượt, dừng ở bước đầu có kết quả:

| Bước | Điều kiện | Vị trí | `precision` | `confidence` |
|---|---|---|---|---|
| 1 | có `address_anchor` cùng `housenumber` (kể cả chuỗi hẻm) + cùng `street_norm` (+ cùng phường nếu người dùng cung cấp) | toạ độ mốc | `rooftop` | 0,9 (0,95 nếu mốc từ người dùng) |
| 2 | có `alley` số = `alleyChain[0]` thuộc đường khớp | điểm trên hẻm cách `entrance` = min(chiều dài hẻm, 6 m × `houseInAlley`) | `alley` | 0,7 |
| 3 | có ≥ 1 mốc cùng đường, **cùng chẵn/lẻ**, số nhỏ hơn và ≥ 1 mốc số lớn hơn, cả hai cách nhau ≤ 400 m | nội suy tuyến tính theo hình đường giữa hai mốc (chiếu mốc lên tuyến) | `interpolated` | 0,6 |
| 4 | khớp `street` trong phường/tỉnh đã nêu (hoặc gần `near`) | điểm giữa tuyến | `street` | 0,4 |
| 5 | khớp `admin_area` | tâm phường / tỉnh | `ward` / `province` | 0,2 |

Khi đường trùng tên ở nhiều nơi (5 đường "Nguyễn Lâm"), ưu tiên theo phường/tỉnh trong câu, rồi theo `near`, rồi trả nhiều kết quả (tối đa `limit`).

`reverse`: tìm 2 mốc gần nhất cùng đường khác phía số → "≈ 86–90 Nguyễn Lâm"; nếu không có → "gần <POI gần nhất>, <đường>, <phường>".

### 6.4 Xác thực, quota, đo lường

- Key qua header `X-Api-Key` hoặc query `key`. Tra `api_key` (cache KV 5 phút). Key `web` phải khớp `Origin`/`Referer` với `allowed_origins` (hỗ trợ wildcard subdomain); key `mobile` kiểm `X-Bundle-Id` mềm (log, không chặn ở MVP); key `server` không kiểm nguồn.
- Quota theo ngày (giờ VN) đếm trong KV theo `(key, ngày, nhóm: places|edits|tiles-fallback)`; chấp nhận đếm xấp xỉ; chặn `429` khi vượt **2×** quota (tránh chặn nhầm do đếm trễ); tenant `internal` không giới hạn. Mặc định plan `free`: 20.000 places/ngày, 500 edits/ngày, 100.000 tiles-fallback/ngày. **Giai đoạn nội bộ mọi tenant là `internal` nên không có ghi KV theo request** (Workers Free chỉ cho 1.000 ghi KV/ngày); bộ đếm bật khi xuất hiện tenant `free/paid` — lúc đó đã có Workers Paid. Tiles mặc định không qua Worker nên không có quota.
- Đo lường: Workers Analytics Engine ghi `(tenant, key, endpoint, status, ms)` cho mọi request — nền cho billing sau.
- Không lưu IP thô; `ip_hash = sha256(ip + salt ngày)` chỉ trong `poi_edit` để chống spam.

### 6.5 Đóng góp và duyệt

- `end_user_token` do app nhúng tạo (chuỗi bất kỳ ổn định theo người dùng); Worker băm với `tenant_id` thành `end_user_hash`. Giới hạn 20 edit/ngày/end-user, 500/ngày/key.
- Tự duyệt (`auto_approved`) — **luật hiện hành từ 26/09/2026** (`apps/api/src/edits/rules.ts`, danh sách trắng): (a) tenant `internal` gửi bằng khoá `server`; (b) khoá `server`, `kind='update'` **chỉ đổi `hours`** (đúng cú pháp opening_hours) trên POI có `quality_score ≥ 60`; (c) khoá `server`, update chỉ đổi `hours` được ≥ 2 **tenant** khác nhau gửi bằng khoá `server` còn hiệu lực trong 30 ngày. Khoá web/mobile (kể cả của `internal`) không bao giờ tự duyệt. Luật gốc M4 (hours/contact quality ≥ 60; mọi thay đổi có ≥ 2 end-user) bị thay vì cho phép ai cầm khoá công khai chiếm SĐT/tên, đóng hoặc dời POI và sinh mốc geocode rooftop, trong khi `locked_fields` giữ giá trị sai qua mọi lần build.
- Mọi trường hợp khác `pending` → trang `apps/admin` (bảo vệ bằng Cloudflare Access, chỉ email admin của PHONG) duyệt/từ chối; duyệt → áp dụng vào `poi`, thêm trường vào `locked_fields`, tạo `address_anchor` nếu có số nhà.
- `kind='create'` từ người dùng: tạo `poi` với `status='pending'`, `created_by='user'`; chỉ hiển thị cho tenant tạo ra cho đến khi duyệt.

### 6.6 Kết nối DB, lỗi, hiệu năng

- Worker → **Hyperdrive** (config `mapslibvn-db`) → Cloudflare Access (service token) → **Cloudflare Tunnel** → Postgres trên máy nội bộ (TLS bắt buộc). Worker không mở kết nối trực tiếp; DB không có cổng public. Hyperdrive bật cache truy vấn cho `SELECT` (TTL 60 s). Đổi DB sang VPS/Supabase = tạo Hyperdrive config mới + đổi binding trong `wrangler.toml`.
- Mọi lỗi trả `{error:{code, message, request_id}}` với mã: `400 invalid_request`, `401 missing_key`, `403 origin_not_allowed|scope`, `404 not_found`, `429 quota_exceeded`, `503 upstream_unavailable` (+ `Retry-After: 30`).
- DB không phản hồi (máy nội bộ mất điện/mạng): tiles/styles/assets **không ảnh hưởng** (tĩnh trên R2); autocomplete trả bản cache cũ (`stale-if-error` 1 giờ) nếu có, nếu không `503`.
- Mục tiêu hiệu năng: autocomplete p95 < 300 ms từ client tại VN (đo bằng Playwright + `performance.now()`), tile p95 < 150 ms khi cache hit. Worker chạy tại PoP Cloudflare HCM/HN → Tunnel → máy nội bộ trong nước: ~10–30 ms mỗi truy vấn.

## 7. P4 — Web SDK và React

### 7.1 `@mapslibvn/core`

- `createClient({apiKey, baseUrl?})` → `{autocomplete, search, nearby, getPlace, geocode, reverse, suggestEdit, attribution}`; dùng `fetch`, không phụ thuộc DOM; kiểu dữ liệu xuất khẩu (`Place`, `GeocodeResult`, `ParsedAddress`…).
- `parseAddress`, `normalizeVi` (dùng chung với pipeline qua workspace).
- Kích cỡ ≤ 8 kB gzip.

### 7.2 `@mapslibvn/web`

```ts
import { createMap } from '@mapslibvn/web';
const map = createMap({
  container: 'map', apiKey: 'mlv_live_…',
  style: 'light' | 'dark' | string,      // hoặc URL style tuỳ biến
  center: [106.70, 10.77], zoom: 14, lang: 'vi' | 'en',
  poiLayer: true,                        // hiển thị lớp POI, mặc định true
});
map.gl                                   // đối tượng maplibregl.Map — không giấu gì
map.addMarker({lng, lat, popupHtml?}); map.fitBounds(bbox); map.flyTo(...)
map.on('poiClick', (poi) => …)           // từ queryRenderedFeatures trên lớp POI
map.places                               // client @mapslibvn/core với cùng key
```

- Tự đăng ký protocol `pmtiles://` (thư viện `pmtiles`) trước khi tạo map; `maplibre-gl` là peer dependency; bản **UMD** (`dist/mapslibvn.umd.js`, kèm CSS) đóng gói sẵn maplibre + pmtiles để nhúng bằng một `<script>`; global `MapsLibVN.createMap`.
- Web component `<mapslibvn-autocomplete api-key near-map="map1" placeholder>` phát sự kiện `select` với `Place | GeocodeResult`; dùng được trong mọi framework hoặc HTML thuần.
- Attribution: luôn thêm `AttributionControl`, không có tuỳ chọn tắt (chỉ có `compact`). Hai source trong style (`openmaptiles`, `poi`) mang **chuỗi đầy đủ** `attributionHtml()`, sinh lúc build từ `@mapslibvn/core`; source `openmaptiles` luôn có mặt nên ẩn lớp POI (`poiLayer: false`) hay thiếu bản POI trong manifest vẫn đủ nguồn, và nạp style thẳng vào `maplibre-gl` thuần cũng có ghi nguồn. Với theme `light`/`dark`, SDK **không** thêm `customAttribution`: style do API phục vụ là nguồn sự thật duy nhất. Chỉ khi style là URL lạ SDK mới thêm `attributionHtml()` của chính nó. Lý do: MapLibre chỉ gộp các chuỗi trùng khít, mà chuỗi của SDK đi theo phiên bản SDK còn chuỗi của style đi theo phiên bản API — hễ lệch một ký tự (SDK cũ trên npm, hoặc trình duyệt còn giữ style cũ trong cache 1 giờ) là ghi nguồn hiện hai lần. Sửa 04/09/2026; sửa lại 23/09/2026 sau khi 0.14.1 đổi href của "© MapsLibVN" làm mọi bản SDK ≤ 0.14.0 hiện hai lần.
- Ngân sách: wrapper ≤ 15 kB gzip (không tính maplibre-gl); kiểm trong CI bằng `size-limit`.
- Trình duyệt hỗ trợ: 2 bản mới nhất của Chrome/Edge/Firefox/Safari, iOS Safari 16+.

### 7.3 `@mapslibvn/react`

`<MapsLibVNMap apiKey style center zoom onPoiClick onLoad>{children}</MapsLibVNMap>`, `<Marker>`, `useMap()`, `usePlaces()` (SWR-style cho autocomplete với debounce 200 ms). React 18+.

### 7.4 Tài liệu và playground (`apps/docs`)

Bắt đầu 5 phút (script tag / npm / React), tham chiếu API, ví dụ sống (nhúng thật với key demo giới hạn origin `docs`), trang "Giấy phép & ghi nguồn", trang "Độ chính xác geocode" giải thích `precision`, trang "Tự host" (dựng máy chủ và pipeline từ repo). Deploy Cloudflare Pages.

## 8. Các phần để sau nhưng đã có chỗ

### 8.1 React Native SDK

`@mapslibvn/react-native` bọc `@maplibre/maplibre-react-native` 11.3+, dùng nguyên `/v1/styles/*.json` (MapLibre Native đọc `pmtiles://` ở tầng native, không cần `addProtocol`) và `@mapslibvn/core`; key `mobile`. **Spec riêng (mốc M6): `docs/superpowers/specs/2026-09-03-react-native-sdk-design.md`** (03/09/2026).

### 8.2 Cổng nhà phát triển, thanh toán

`tenant`/`api_key` và Analytics Engine đã đủ dữ liệu; portal tự đăng ký + Polar (đã dùng ở dự án khác) làm khi mở thương mại.

### 8.3 Nâng cấp tìm kiếm

Khi p95 autocomplete > 300 ms bền vững hoặc DAU > 20K: thêm Meilisearch (Docker, cùng máy nội bộ hoặc VPS) đồng bộ từ `poi` theo `updated_at`, Worker đổi backend theo cờ cấu hình; hợp đồng API không đổi. Tuỳ chọn khác: sinh mảnh chỉ mục tĩnh trên R2 để giảm tải DB đọc về gần 0.

## 9. Bảo mật và riêng tư

- Key `web` không phải bí mật (lộ trong trình duyệt) — bảo vệ bằng `allowed_origins` + quota. Key `server` là bí mật, chỉ dùng phía máy chủ.
- Không thu thập dữ liệu người dùng cuối ngoài: `end_user_hash` (do tenant cung cấp, đã băm), `ip_hash` theo ngày trong `poi_edit`. Không lưu lịch sử truy vấn theo người.
- DB không mở cổng ra Internet; chỉ Hyperdrive có service token Access đi qua Tunnel; Postgres bật TLS và chỉ chấp nhận user `api` (quyền `SELECT` + `INSERT` vào `poi_edit`) từ Worker; user `pipeline` riêng cho ghi dữ liệu.
- Log Worker giữ 30 ngày; Analytics Engine chỉ số liệu tổng hợp.
- Điều khoản tenant (viết ở M5): cấm cào/xuất hàng loạt, phải giữ attribution, tenant chịu trách nhiệm xin phép vị trí của người dùng cuối theo Nghị định 13/2023.
- Secrets: chuỗi kết nối DB nằm trong cấu hình Hyperdrive (Cloudflare giữ), `EDIT_SALT` qua `wrangler secret`, token Tunnel và mật khẩu Postgres trong `infra/server/.env` trên máy chủ; không có bí mật nào trong repo.

## 10. Kiểm thử

| Tầng | Nội dung | Công cụ |
|---|---|---|
| Unit | `normalizeVi` (≥ 200 fixture), `parseAddress` (≥ 300 fixture), `categoryMap`, hàm xếp hạng, luật auto-approve, dò phiên bản nguồn (`data:update`) với HTTP giả | Vitest |
| Unit | matcher gộp POI với fixture khó: "Cà phê Cộng" ~ "Cong Caphe", "Highlands Coffee Nguyễn Huệ" ~ "Highlands Nguyen Hue", hai quán cùng chuỗi cách 60 m **không** được gộp | Vitest |
| Tích hợp pipeline | chạy toàn pipeline trong image Docker trên PBF cắt bbox Quận 1 cũ + Overture/FSQ cùng bbox (fixture parquet trong repo, ~20 MB): số POI hợp lý, không lỗi, `poi.pmtiles` sinh ra | Vitest + DuckDB |
| Tích hợp tiles | QA chủ quyền (4.3), validate style, đọc 20 tile ngẫu nhiên | script TS |
| Tích hợp API | Postgres docker (`infra/dev`) nạp fixture, `wrangler dev` + Miniflare; **2 fixture bắt buộc**: `q=Trường Tiểu học Hoàng Diệu&near=10.77,106.70` → ≥ 3 kết quả, trường Linh Xuân (10.85594, 106.77325) đứng đầu; `geocode?q=88/9 Nguyễn Lâm&near=10.76,106.66` → `precision=interpolated`, toạ độ cách (10.7647, 106.6631) ≤ 60 m | Vitest |
| Môi trường | `pnpm run setup` trên máy sạch (container Ubuntu trong CI + thử tay trên macOS và Windows) hoàn tất ≤ 15 phút, `pnpm dev` chạy; `pnpm server:setup` dựng compose máy chủ và Postgres nhận kết nối TLS | CI + checklist tay |
| E2E | playground tải bản đồ (mọi tile 200/204), gõ "highlands" có gợi ý ≤ 1 s, bấm POI hiện chi tiết, attribution hiện | Playwright |
| Cổng CI | lint, typecheck, unit, size-limit, style validate; `data:update` có QA riêng | GitHub Actions |

## 11. Vận hành và chi phí

### 11.1 Máy chủ nội bộ 24/7 (`infra/server/compose.yml`)

- **Yêu cầu máy**: ≥ 8 GB RAM, SSD ≥ 50 GB, Docker; Linux ưu tiên (mini PC/NUC, Mac mini cũ chạy macOS cũng được qua Docker Desktop; Windows chạy được qua WSL2 nhưng phải tắt chế độ ngủ). Không dùng laptop làm việc. UPS khuyến nghị.
- **Dịch vụ**: `postgres` (`postgis/postgis:16-3.4`, volume `pgdata`, TLS bằng chứng chỉ tự ký do `server-setup` sinh, `max_connections=100`, `shared_buffers` = 25% RAM, `pg_trgm` + `unaccent`); `cloudflared` (token Tunnel, route hostname `maps-db.<domain>` → `tcp://postgres:5432`); `backup` (cron: `pg_dump -Fc | zstd` hằng ngày 03:00, giữ 7 bản ngày + 4 bản tuần, `rclone` lên R2 `backups/`); `pipeline` (image `pipelines/Dockerfile`, cron thứ Hai 02:00 chạy `pnpm data:update`).
- **Dựng bằng một lệnh**: `pnpm server:setup` (Node): kiểm tra Docker, sinh cert + mật khẩu, tạo `infra/server/.env`, `docker compose up -d`, chạy migration, in checklist việc tay trên dashboard Cloudflare (tạo Tunnel, Access application + service token, Hyperdrive config, custom domain R2) — checklist đầy đủ trong `infra/server/README.md`. Cập nhật image: `pnpm server:update`.
- **Chuyển máy chủ** (hỏng máy, đổi nhà): `pnpm server:setup` trên máy mới + `pnpm db:restore --latest` từ R2 + trỏ Tunnel sang máy mới. Dưới 1 giờ.

### 11.2 Triển khai và rollback

- API: `deploy-api.yml` (wrangler) khi `apps/api` đổi trên `main`; rollback `wrangler rollback`. Docs: `deploy-docs.yml` (Pages).
- Dữ liệu: `pnpm data:rollback` (đổi manifest KV, tức thì). DB: `pnpm db:restore <bản>`.
- Data jobs mặc định chạy trên máy nội bộ; `data-update.yml` trên GitHub Actions là đường dự phòng (nối DB qua `cloudflared access tcp` với service token).

### 11.3 Giám sát

Cloudflare Tunnel health (email khi tunnel down), Workers metrics (5xx, p95), `pg_stat` qua script tuần, báo cáo tuần tự động từ Analytics Engine gửi email.

### 11.4 Tên miền

Dùng subdomain của zone hiện có của PHONG trên Cloudflare: `tiles.<domain>` (R2 custom domain), `maps-api.<domain>` (Worker), `maps-db.<domain>` (Tunnel, chỉ Access đi qua), `maps-docs.<domain>` (Pages). Domain riêng `mapslibvn.com` mua khi thương mại hoá; đổi domain chỉ là đổi cấu hình và chuỗi `{TILES_BASE}`/`{API_BASE}`.

### 11.5 Chi phí theo quy mô

| Quy mô | Tiles (R2 trực tiếp) | API (Workers) | DB | Tổng/tháng |
|---|---|---|---|---|
| **5.000 user** (~1.250 DAU) | ~2,3 triệu đọc/tháng < 10 triệu free; egress 0 | ~15.000 req/ngày < 100.000 free | máy nội bộ | **0 đ** |
| 50.000 user (~12K DAU) | ~22 triệu đọc → ~4 USD | ~150.000 req/ngày → Workers Paid 5 USD | máy nội bộ, hoặc VPS Singapore ~6 USD | ≈ 10–15 USD |
| 500.000 user (1M+ map-load) | ~40 USD | ~30 USD | VPS 20–40 USD hoặc Supabase Pro Large ~110 USD | ≈ 100–180 USD |

Đối chiếu: Google Maps web Dynamic Maps ≈ 7.000 USD cho 1M map-load; Places Nearby Search 32 USD/1.000 lượt.

### 11.6 Chuyển sang thương mại

Khi có khách trả tiền: `pg_dump` → `pg_restore` lên VPS Singapore (DigitalOcean/Vultr 5–6 USD) hoặc cloud Việt Nam (~150–300K đ/tháng) hoặc Supabase Pro (25 USD); tạo Hyperdrive config mới → đổi binding → deploy. Tìm kiếm gián đoạn vài phút; bản đồ không gián đoạn. Máy nội bộ giữ vai trò chạy pipeline và dự phòng.

## 12. Pháp lý và giấy phép

### 12.1 Ma trận

Xem 3.2. Tất cả cho phép dùng thương mại. Nghĩa vụ: giữ notice BSD/MIT/Apache trong `THIRD_PARTY_NOTICES.md` đóng gói cùng SDK; ghi nguồn OSM/OpenMapTiles/Overture/Foursquare (12.3).

### 12.2 ODbL — mô hình Collective Database

Dữ liệu OSM nằm trong `src_osm_place` và các bảng dẫn xuất thuần OSM (`street`, `alley`, `admin_area`) — đây là Derivative Database của OSM và **được cung cấp theo ODbL khi có yêu cầu** (ta không phản đối: script `pnpm export:odbl` xuất các bảng này). Bảng `poi` chép trường từ đúng một nguồn và chỉ *liên kết* các nguồn bằng ID; `address_anchor` ghi rõ `source` từng dòng. Dữ liệu người dùng đóng góp (`created_by='user'`, các trường trong `locked_fields`) là dữ liệu riêng của MapsLibVN. Bản đồ và kết quả API là Produced Work: chỉ cần ghi nguồn. Việc tay: xác nhận cách đọc này với luật sư trước khi thương mại hoá.

### 12.3 Chuỗi ghi nguồn bắt buộc (trả từ `/v1/attribution`)

`© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Places: Overture Maps Foundation (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0)` — có link tới từng nguồn và tới trang giấy phép của MapsLibVN.

### 12.4 Pháp luật Việt Nam

- Luật Đo đạc và bản đồ 2018, Nghị định 18/2020/NĐ-CP: bản đồ phải thể hiện đúng chủ quyền — thiết kế 4.3 là biện pháp kỹ thuật; **việc tay**: hỏi luật sư về việc kinh doanh nền tảng bản đồ số có thuộc danh mục cần giấy phép hoạt động đo đạc và bản đồ (Điều 51) hay không, trước khi thu phí. Không chặn giai đoạn nội bộ.
- Nghị định 13/2023 (dữ liệu cá nhân): MapsLibVN không nhận dữ liệu định danh người dùng cuối; nghĩa vụ xin phép vị trí thuộc app nhúng (ghi trong điều khoản tenant). Khi thương mại, dữ liệu đóng góp chuyển lên hạ tầng có kiểm soát vật lý (11.6) — không giữ ở nhà riêng.
- Nhãn hiệu: tên "MapsLibVN" cần rà soát với chính sách nhãn hiệu của MapLibre (tránh gây nhầm là sản phẩm chính thức); nếu bị phản đối, đổi tên gói trước khi phát hành npm công khai — tên gói chỉ là hằng số cấu hình trong monorepo.

### 12.5 Không dùng trong sản xuất

Nominatim công cộng và Overpass API chỉ dùng cho kiểm tra phát triển (chính sách sử dụng của OSMF); sản phẩm chạy hoàn toàn trên dữ liệu tự host.

## 13. Lộ trình và tiêu chí chấp nhận

| Mốc | Nội dung | Tiêu chí chấp nhận | Ước lượng |
|---|---|---|---|
| **M1** Bản đồ câm + môi trường | monorepo, `pipelines/Dockerfile`, `infra/dev`, `scripts/setup.mjs`, `.devcontainer`; `pipelines/tiles` (patch + Planetiler + QA + upload R2 + manifest); `packages/style`; Worker `/v1/styles` + tiles fallback; `@mapslibvn/core` (attribution) + `@mapslibvn/web` (createMap, pmtiles protocol, UMD); playground | `pnpm run setup` trên máy mới (thử macOS **và** Windows) ≤ 15 phút; playground hiện bản đồ VN nhãn tiếng Việt, theme sáng/tối, tiles đọc thẳng từ `tiles.<domain>`; QA chủ quyền xanh; nhúng bằng `<script>` chạy trên trang HTML trắng; `data:update --tiles` chạy trọn vòng | 1,5–2 tuần |
| **M2** Kho POI + máy chủ | `infra/server` (compose, `server:setup`, Tunnel/Access/Hyperdrive theo checklist, backup); `db/migrations`; `pipelines/poi` (ingest 3 nguồn, chuẩn hoá, gộp, taxonomy, anchors/street/alley/admin); `poi.pmtiles`; lớp POI trong style; `data:update` đầy đủ | Máy nội bộ chạy Postgres nhận kết nối TLS qua Tunnel từ Worker; `data:update` chạy trọn trên máy nội bộ; ≥ 1,5 triệu `poi` active; POI hiện theo zoom; bấm POI thấy tên/loại từ tile; báo cáo số liệu gộp; `db:restore --latest` phục hồi được trên máy dev | 2 tuần |
| **M3** Places API | 7 endpoint đọc, ranking, geocode ladder, cache, key/quota cơ bản, `@mapslibvn/core` đầy đủ, `<mapslibvn-autocomplete>`, `@mapslibvn/react` | 2 fixture bắt buộc xanh; p95 autocomplete < 300 ms từ VN; quota 429 hoạt động với tenant `free` thử nghiệm; React demo | 2 tuần |
| **M4** Đóng góp | `POST /v1/edits`, luật auto-approve, `apps/admin` sau Access, áp dụng edit vào `poi`/anchor, pipeline tôn trọng `locked_fields` | Gửi sửa giờ mở cửa → auto-approve → thấy ngay qua API; tạo POI mới → pending → duyệt → có trong build kế tiếp | 1 tuần |
| **M5** Phát hành nội bộ | docs 5 phút + trang tự host, trang giấy phép/độ chính xác, seed key cho một ứng dụng nhúng độc lập (thư viện không gắn với dự án nào), báo cáo tuần, `THIRD_PARTY_NOTICES.md`, điều khoản tenant | Ứng dụng nhúng độc lập dùng được bằng key riêng; báo cáo sử dụng tuần đầu; checklist pháp lý ghi rõ việc tay còn lại | 1 tuần |
| **M6** React Native | `@mapslibvn/react-native` bọc `@maplibre/maplibre-react-native` 11.3+; core thêm `headers`, `PoiFeature`, biến đổi style thuần; app Expo thử `examples/embed-rn` + `pnpm example:rn`; trang docs; khoá `mobile` thử nghiệm (spec riêng 2026-09-03) | App thử chạy trên iOS và Android bằng khoá `mobile`, tiles thẳng từ R2, poiClick, attribution không tắt được; Analytics có khoá mobile; CI 4 gói xanh; trang docs deploy | 1–1,5 tuần |

Tổng ≈ 8 tuần cho M1–M5; M6 React Native thêm 1–1,5 tuần (spec riêng `docs/superpowers/specs/2026-09-03-react-native-sdk-design.md`).

## 14. Rủi ro và giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| `--bounds` toàn cầu của Planetiler không cho lớp thế giới đẹp | bản đồ ngoài VN trống | dự phòng Protomaps extract z0–6 (4.2), quyết định ở M1 |
| Dữ liệu Overture nhiễu (trùng, đóng cửa, lệch toạ độ) | POI sai làm mất tin | ngưỡng confidence, ưu tiên toạ độ OSM, quality_score, báo cáo người dùng, lớp POI chỉ hiện q ≥ 60 ở zoom trung |
| Chuỗi hẻm/đánh số bất quy tắc | geocode sai vị trí | luôn trả `precision`, không bao giờ giả `rooftop`; nội suy chỉ khi có mốc hai phía ≤ 400 m |
| Tên phường/quận cũ-mới sau 2025 | không khớp địa chỉ | `admin_alias` + fixture địa chỉ cũ |
| **Máy nội bộ mất điện/mạng/hỏng ổ** | tìm kiếm & đóng góp trả 503 | bản đồ + lớp POI tĩnh trên R2 vẫn chạy; UPS; cảnh báo Tunnel; backup hằng ngày lên R2; dựng lại máy < 1 giờ; chuyển VPS khi thương mại |
| ISP gia đình đổi IP / CGNAT | mất kết nối DB | Tunnel là kết nối ra ngoài từ máy chủ, không cần IP tĩnh hay mở cổng |
| Đổi máy dev macOS → Windows | môi trường lệch, script hỏng | mọi công cụ trong Docker/devcontainer, script Node thuần, LF ép bằng `.gitattributes`, test `pnpm run setup` trên cả hai HĐH ở M1 |
| Workers Free 100K request/ngày | API bị chặn khi DAU > ~8K | tiles không qua Worker; nâng Workers Paid 5 USD khi cần |
| Dự án cá nhân/cộng đồng ngừng (Planetiler, PMTiles) | không build được | đều là mã mở, pin phiên bản trong image, có thể fork |
| Tên MapsLibVN vướng nhãn hiệu MapLibre | phải đổi tên gói | tên là hằng số; rà soát trước khi publish npm |
| Điều 51 Luật ĐĐ&BĐ yêu cầu giấy phép khi kinh doanh | trì hoãn thương mại hoá | không chặn nội bộ; hỏi luật sư ở M5 |

## 15. Việc tay của PHONG (không chặn code)

1. Chuẩn bị máy nội bộ chạy 24/7 (≥ 8 GB RAM, SSD ≥ 50 GB, cài Docker) — cần trước M2.
2. Trên Cloudflare (zone hiện có): tạo R2 bucket `mapslibvn-tiles` + custom domain `tiles.<domain>`; tạo Tunnel, Access application + service token, Hyperdrive config theo checklist `infra/server/README.md`; cấp API token cho GitHub Actions và máy chủ.
3. Hỏi luật sư: Điều 51 Luật Đo đạc và bản đồ; cách đọc ODbL Collective Database (12.2); nhãn hiệu.
4. Sau M5: quyết định thời điểm mở cho developer ngoài; lúc đó mua domain riêng và chuyển DB lên VPS/cloud (11.6).
