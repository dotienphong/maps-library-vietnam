# DEVLOG — MapsLibVN

Đọc file này trước khi làm bất cứ việc gì. Cập nhật ở bước cuối của MỌI task (cùng
commit với code).

## 1. Trạng thái hiện tại

- Mốc: M1c — Worker, Web SDK, docs
- Plan: `docs/superpowers/plans/2026-08-26-m1c-worker-web-sdk-docs.md`
- Task đang làm: Task 4 (Step 5) + Task 5
- Commit cuối: Task M1c T4 (commit hiện tại)
- Môi trường đã dựng: máy dev macOS; remote GitHub cá nhân; Postgres/PostGIS dev,
  migration `0001_extensions.sql`; `pnpm run setup` sạch đạt 6,51 giây; image
  pipeline local đã build/smoke trên arm64 và chạy được qua Compose; Dev Container
  đã dựng thành công và chạy đủ 20 test trong Linux container; CI GitHub xanh
  trên amd64 và image đã được push lên GHCR; R2 bucket `mapslibvn-tiles` (APAC),
  custom domain `tiles.ai-solutions.io.vn` (SSL active), CORS, KV
  `mapslibvn-META` và Cache Rule đã cấu hình; tiles `vn-20260827` đã publish,
  smoke 20/20 qua custom domain và manifest KV đã active; M1a/M1b đã nghiệm thu
  trên macOS arm64;
  **PENDING Windows** (chờ PHONG có máy để kiểm)

## 2. Bước kế tiếp

Worker và docs đã lên production:

- Worker: `https://mapslibvn-api-production.dotienphong1993.workers.dev`
  (version `6a7d5c14-5e27-4208-8403-169ee22d09a8`, upload 182,82 KiB / gzip 38,97 KiB,
  startup 19 ms). Kiểm thật: `/healthz` → `{"ok":true,"environment":"production"}`;
  `/v1/styles/light.json` → 105 layer, `pmtiles://https://tiles.ai-solutions.io.vn/tiles/vn-20260827.pmtiles`,
  `cache-control: public, max-age=3600`, 2 nhãn chủ quyền; theme lạ → 404; `/r2/*` → 404
  (chặn đúng ở production). Tile fallback đọc R2 qua binding: z8/z12/z14 đều 200
  (66.609 / 60.924 / 200.978 byte) kèm `content-encoding: gzip`.
- Docs: `https://mapslibvn-docs.pages.dev` (32 file). Playground ở `/playground`
  — Cloudflare Pages tự 308 từ `/playground.html`, trình duyệt theo redirect nên link
  trong sidebar vẫn chạy.

**BLOCKER đang chờ PHONG (việc tay trên dashboard):** sửa Cache Rule của zone
`ai-solutions.io.vn` — xem mục 5 "Sự cố đang mở". Chưa sửa thì bản đồ production
không dùng được.

Sau khi sửa xong: đo lại Range → nghiệm thu M1c T4 Step 5 (kiểm 3 workflow) và
Task 5 (nghiệm thu M1), rồi chuyển mốc sang M2.

## 3. Quyết định phát sinh

| Ngày | Quyết định | Lý do | Commit |
|---|---|---|---|
| 2026-08-26 | Lint/format dùng Biome thay ESLint+Prettier | Một công cụ, nhanh, không cấu hình rườm rà | `9cff9a8` |
| 2026-08-26 | Typecheck gốc kiểm thêm `vitest.config.ts` | TypeScript 5.9 trả TS18003 khi `scripts/` chưa tồn tại | `9cff9a8` |
| 2026-08-26 | Spec bản 2 đã được PHONG review | Trạng thái thiết kế đã được chủ dự án xác nhận | `cb98a09` |
| 2026-08-26 | Repo GitHub dùng slug `maps-library-vietnam`, tên sản phẩm vẫn là MapsLibVN | PHONG đã tạo repo và cung cấp URL chính thức | `e7f16d4` |
| 2026-08-26 | PostGIS dev chạy image `postgis/postgis:16-3.4` amd64 qua giả lập trên Mac arm64 | Tag đã chốt trong spec/plan chưa có manifest arm64; health và migration vẫn đạt | `d4186f3` |
| 2026-08-26 | Lệnh setup công khai là `pnpm run setup`, không phải `pnpm setup` | `pnpm setup` là built-in của pnpm 9.15 và không dispatch package script | `cc16199` |
| 2026-08-26 | Setup chỉ migrate khi PID 1 trong container là `postgres` và `pg_isready` đạt | PostGIS entrypoint chạy server tạm rồi restart; chỉ `pg_isready` gây ECONNRESET | `cc16199` |
| 2026-08-26 | Image pin Planetiler 0.10.2, tippecanoe 2.62.5, DuckDB 1.5.3, pyosmium 4.0.2, Node 22 và pnpm 9.15.0 | Các release/asset đã được build và smoke thật trên arm64; DuckDB 1.5.5 chưa có CLI asset | `67a7b99` |
| 2026-08-26 | Planetiler tải 8 HTTP range song song, cache từng part, kiểm tra đúng 93.278.824 byte và SHA-256 | GitHub release chỉ đạt khoảng 22 KB/s/kết nối; tải một luồng mất hơn một giờ và dễ mất tiến độ | `67a7b99` |
| 2026-08-27 | Override Dev Container dùng `../..` cho build context và bind mount | Đường dẫn Compose được resolve theo file đầu tiên ở `infra/dev`, không theo thư mục `.devcontainer` | `673f6fe` |
| 2026-08-27 | CI gọi chung `pnpm image:smoke` thay vì lặp lệnh kiểm tra tool trong YAML | Local và CI dùng cùng một hợp đồng smoke đã được kiểm chứng ở Task 6 | `469836a` |
| 2026-08-27 | `pnpm run setup` luôn cấu hình author cá nhân bằng `git config --local` trước khi kiểm | Clone sạch kế thừa email Bark từ Git global và không thể đạt setup; cấu hình local giữ global nguyên vẹn, hook vẫn chặn override sai | `4a7552c` |
| 2026-08-27 | Font vendor dùng asset `noto-sans.zip` của OpenMapTiles v2.0, không dùng `v2.0.zip` | `v2.0.zip` chỉ có Roboto; asset Noto riêng chứa đúng 3 stack cần phục vụ glyph | `1cfb4d2` |
| 2026-08-27 | Template style M1 chỉ dùng placeholder `TILES_BASE`/`VN_FILE` | `API_BASE`/`KEY` chỉ cần khi bổ sung POI details ở M2/M3 | `1cfb4d2` |
| 2026-08-27 | Dependency `pmtiles` được smoke từ workspace `pipelines/tiles`, không từ root `/app` | pnpm strict isolation chỉ expose dependency tại package khai báo nó | (Task M1b T3) |
| 2026-08-27 | Full build Planetiler bật `--compress-temp` | Temp mmap không nén tăng 7,9 GB và làm host chỉ còn 131 MiB; nén hoàn tất cùng archive 952 MiB và giữ host an toàn | (Task M1b T4) |
| 2026-08-27 | QA chỉ tính đối tượng có hình học giao bbox (giải mã `toGeoJSON`), không tính mọi feature trong tile giao bbox | Tile z4–z7 giao bbox trải tới đất liền và phần đệm nước láng giềng; công viên `花山` (Quảng Tây, 22°N) lọt vào tile z5/z6 của Hoàng Sa là dương tính giả | (Task M1b T5) |
| 2026-08-27 | Patch tầng 1 thêm vùng biển Đông `[102, 6, 117.8, 17.5]` với luật hẹp: `name` chữ CJK không có `name:vi` → xoá (có `name:vi` → thay), xoá `name:zh*`; tên Latin giữ nguyên; `Collector` dùng `locations=True` | Núi ngầm tên Trung Quốc ngay ngoài hai bbox (`镜台海山` 111,34°E 11,40°N, `流春海山` 111,62°E 12,36°N…) lọt vào tile z10 giao bbox Trường Sa; vùng dừng ở 17,5°N để không chạm Hải Nam và đệm biên giới bắc | (Task M1b T5) |
| 2026-08-27 | Test `lonLatToTile` kỳ vọng TP.HCM z10 = (815, 481) thay cho (815, 483) trong plan | Tính lại Web Mercator: ln(tan φ + sec φ)/π = 0,0602 → y = 481; plan gõ sai | (Task M1b T5) |
| 2026-08-27 | QA: kiểm "có đảo tên VI ở z8–10" cấu hình theo bbox (`requireIslands`); Hoàng Sa tạm **tắt, chỉ cảnh báo**; Trường Sa bắt buộc | Extract `vietnam.poly` của Geofabrik không phủ Hoàng Sa (6 node, 1 way) và chỉ phủ Trường Sa tới 114,6°E — không có đảo để kiểm; nhãn chủ quyền vẫn do lớp `sovereignty` (style) bảo đảm. **Việc còn lại:** merge thêm extract OSM cho bbox Hoàng Sa/Trường Sa đông (nguồn cần PHONG chốt) rồi bật lại `requireIslands` | (Task M1b T5) |
| 2026-08-27 | Thêm 4 MCP server Cloudflare vào `.mcp.json` (scope project): `cloudflare-api` (mcp.cloudflare.com — toàn bộ REST API qua search/execute), `cloudflare-bindings` (KV/R2/D1/Workers), `cloudflare-docs`, `cloudflare-observability` | Phần lớn "việc tay của PHONG" ở M1b T6 và M2 T1 (R2 bucket, custom domain, CORS, KV namespace, Cache Rule, Tunnel/Access/Hyperdrive) làm được qua API; scope project để không lẫn vào các repo khác. Xác thực OAuth qua `/mcp` — chỉ PHONG làm được. **Chưa chắc qua API:** khoá S3 của R2 API token và Workers API token có thể vẫn phải tạo trên dashboard | (sau M1b T5) |
| 2026-08-27 | Task 6 dùng preflight credentials trước khi build; `manifest.mjs get` dùng Wrangler 4 `--text`; `--poi` bị từ chối rõ ở M1 | Tránh build tốn thời gian rồi mới lỗi upload, tránh parse nhầm output nhị phân của KV, và không ghi OSM state khi pipeline POI chưa tồn tại | (Task M1b T6) |
| 2026-08-27 | Token R2 object-level bắt buộc `no_check_bucket=true`; image pin rclone 1.75.0 bằng SHA-256 cho arm64/amd64; rollback chạy lại trong pipeline container | Cloudflare yêu cầu bỏ bucket check cho token scoped; rclone 1.60.1-DEV của Ubuntu gây 501 cho từng object; chạy Wrangler trực tiếp trên host phụ thuộc DNS/quyền log | (Task M1b T6) |
| 2026-08-27 | Test Worker khai báo binding qua `apps/api/test/env.d.ts` (`interface ProvidedEnv extends Env`) | `cloudflare:test` không tự suy ra `META`/`TILES` từ `wrangler.toml`; không có file này `env.META` báo TS2339 | (Task M1c T1) |
| 2026-08-27 | Toạ độ kiểm tile Quận 1 z14 là `13048/7698`, không phải `13049/7752` như plan | Web Mercator cho 106,700°E 10,776°N: x = 13048, y = 7698; toạ độ trong plan trả 204 vì nằm ngoài fixture | (Task M1c T1) |
| 2026-08-27 | `fakeBucket` trong test R2Source phải cast `as unknown as Pick<R2Bucket, 'get'>` | `exactOptionalPropertyTypes: true` khiến overload `R2Bucket.get` (có `onlyIf`, `range: Headers \| R2Range`) không nhận stub hẹp | (Task M1c T1) |
| 2026-08-27 | Token Cloudflare mới `mapslibvn-deploy` (custom, 6 quyền: Workers Scripts Edit, Cloudflare Pages Edit, Workers KV Edit, Workers R2 Edit, Account Settings Read, User Details Read) thay token cũ chỉ có KV | Token cũ deploy Worker trả `Authentication error [code: 10000]`; template "Edit Cloudflare Workers" không kèm quyền Pages nên phải tạo custom | (Task M1c T1/T3) |
| 2026-08-27 | Tiles tạm giữ trên `tiles.ai-solutions.io.vn`, đổi sang domain riêng của MapsLibVN khi PHONG mua (dự kiến trước M5) | Tài khoản Cloudflare hiện chỉ có 1 zone; `TILES_BASE` đã tham số hoá nên chuyển domain chỉ tốn sửa `wrangler.toml` + `.env` + secret rồi redeploy. Tách domain là quyết định thương hiệu, độc lập với lỗi Range bên dưới | (Task M1c T3) |
| 2026-08-27 | `apps/docs/tsconfig.json` phải `exclude: ["dist", "public"]` | `astro check` với `include: ["**/*"]` kéo cả `public/sdk/mapslibvn.umd.js` (1 MB) và sourcemap (2,4 MB) vào TypeScript → hết heap 4 GB, exit 137 | (Task M1c T3) |
| 2026-08-27 | `biome.json` bỏ qua `apps/docs/public/sdk/**` | Thư mục là artefact copy từ bản build web; biome báo vượt giới hạn 1 MiB và lỗi CSS của maplibre | (Task M1c T3) |

## 4. Nhật ký

- 2026-08-26 · M1a T1 · khung monorepo · `9cff9a8`
- 2026-08-26 · M1a T2 · DEVLOG + hook pre-push khoá account cá nhân · `cb98a09`
- 2026-08-26 · M1a T3 · remote GitHub cá nhân + push đầu tiên · `e7f16d4`
- 2026-08-26 · M1a T4 · Postgres/PostGIS dev + migration idempotent · `d4186f3`
- 2026-08-26 · M1a T5 · `pnpm run setup` sạch đạt 6,51 giây · `cc16199`
- 2026-08-26 · M1a T6 · image pipeline đủ 8 tool, cached rebuild 4,8 giây · `67a7b99`
- 2026-08-27 · M1a T7 · Dev Container dựng thành công, 20/20 test trong Linux · `673f6fe`
- 2026-08-27 · M1a T8 · CI xanh: test 18 giây, image + smoke 3 phút 52 giây · `469836a` · https://github.com/dotienphong/maps-library-vietnam/actions/runs/33024223882
- 2026-08-27 · M1a T9 · nghiệm thu đạt trên macOS arm64 · `c5e3f40`:
  - Clone sạch: install + setup `real 4,42s`; setup báo sẵn sàng sau 2 giây.
  - Máy dev: install lockfile, lint, typecheck và 21/21 test đều xanh.
  - Image local arm64 smoke đủ 8 tool; CI amd64 của bản sửa setup xanh: https://github.com/dotienphong/maps-library-vietnam/actions/runs/33024620355
  - Hook từ chối `someone@bark.com`, in `pre-push: BỊ CHẶN`, trả `exit=1`.
  - Windows: **PENDING Windows** (chờ PHONG có máy để kiểm).
- 2026-08-27 · M1b T1 · `@mapslibvn/core`: attribution spec 12.3, client
  `attribution()`/`styleUrl()`, lỗi có `code`/`requestId`; build ESM + declarations,
  typecheck và 27/27 test xanh · `595dd37`
- 2026-08-27 · M1b T2 · style light/dark vendor từ OSM Liberty/Dark Matter,
  template 105/48 layer hợp lệ, `name:vi` fallback, 3 stack Noto và 2 nhãn chủ
  quyền; typecheck và 35/35 test xanh · `1cfb4d2`
- 2026-08-27 · M1b T3 · pipeline tải nguồn trong 4 phút 4 giây, Geofabrik PBF
  327 MB khớp MD5 `620d0258ffecd450363e24560d0a7b8b`; patch thật đổi 108
  object trong 10.351 node/486 way thuộc bbox; Python fixture xanh và tổng 37/37
  test xanh · `889a500`
- 2026-08-27 · M1b T4 · fixture Quận 1 1,0 MB/25 tile; full archive
  `vn-20260827.pmtiles` 952 MiB, zoom 0–14, bounds toàn cầu, 16 layer và
  6.291.183 tile entry; build nén temp hoàn tất trong 3 phút 24 giây; lint,
  typecheck và 38/38 test xanh · `2534482`
- 2026-08-27 · M1b T5 · QA chủ quyền: `qa.mjs` giải mã 574 tile giao hai bbox (z4–z10 toàn
  phần, z11–z14 quanh 13 điểm đảo), lọc theo hình học thật; lần 1 bắt 259 vi phạm tên chữ Hán
  (núi ngầm `镜台海山`, `流春海山`… ngay ngoài bbox) → mở rộng patch vùng biển Đông (thêm 85
  object: 72 node, 13 way), build lại archive 952 MB (3 phút, cache) → 0 vi phạm tên, Trường Sa
  có đảo tên VI, Hoàng Sa cảnh báo vì extract Geofabrik không phủ; style 2 nhãn chủ quyền đạt;
  47/47 test JS + pytest xanh · `cceae80`
- 2026-08-27 · M1b T6 · Cloudflare resource active; pipeline thật dùng OSM MD5
  `620d0258ffecd450363e24560d0a7b8b`, patch 193 object, build archive 997 MB
  trong 3 phút 18 giây, QA giải mã 574 tile đạt; upload R2, smoke HTTP 20/20,
  manifest `vn-20260827`, state idempotent và rollback→restore đều đạt. Token
  object-level dùng `no_check_bucket=true`; image pin rclone 1.75.0 để loại 501;
  rollback chạy trong container; lint 46 file, typecheck 3/3, build 2/2,
  61/61 test JS, image smoke 8 tool và pytest 1/1 đều xanh · (commit hiện tại)
- 2026-08-27 · M1c T1 · Worker Hono `apps/api`: `/v1/styles/:theme.json` điền
  `TILES_BASE`/phiên bản từ manifest KV (cache 1 giờ), `/v1/attribution` (5 link),
  `/healthz`, TileJSON + tile `z/x/y.pbf` fallback đọc R2 qua `R2Source` (gzip
  passthrough, cache edge), `/r2/*` Range 206 cho dev/E2E; lỗi theo spec 6.6 có
  `request_id`. Kiểm thật với fixture Quận 1 qua `wrangler dev`: healthz OK,
  style trỏ `pmtiles://…/q1-fixture.pmtiles`, Range `206 16384`, tile
  `vn/14/13048/7698.pbf` → `200` 189.986 byte kèm `content-encoding: gzip`.
  Lint/typecheck xanh, 71/71 test (61 root + 10 api) · (commit hiện tại)
  — **Step 7 deploy production chưa chạy: bị bộ lọc quyền chặn.**
- 2026-08-27 · M1c T2 · `@mapslibvn/web`: `createMap` bọc maplibre-gl với dependency
  injection (test không cần WebGL), `pmtiles://` đăng ký đúng một lần, attribution ép
  bật bằng `AttributionControl` riêng (`attributionControl: false` + `customAttribution`),
  `addMarker`/`fitBounds`/`flyTo`/`poiClick`/`lang`, bản UMD gói kèm maplibre + CSS.
  Build: `dist/index.js` 1,47 kB gzip (giới hạn 15 kB), `dist/mapslibvn.umd.js`
  294 kB gzip (giới hạn 350 kB), `dist/mapslibvn.css` 10,06 kB gzip. Lint/typecheck
  xanh, 79/79 test (69 root + 10 api) · (commit hiện tại)
- 2026-08-27 · M1c T3 · docs Astro Starlight (tiếng Việt, 3 trang: trang chủ splash,
  "Bắt đầu 5 phút", playground) + `scripts/copy-sdk.mjs` đưa bản UMD vào `public/sdk`;
  E2E Playwright chạy **offline hoàn toàn** bằng fixture Quận 1: Worker `dev:e2e` seed
  R2/KV local rồi phục vụ `/r2/*`, Chromium tải bản đồ thật. Kết quả thật: build docs
  3 trang trong 7,11 giây, E2E **2/2 passed (11,4 giây)** — tile Range 206/200,
  attribution chứa "OpenStreetMap", marker Chợ Bến Thành hiện, style dark cũng tải.
  Lint 75 file, typecheck 9/9, 79/79 test · (commit hiện tại)
- 2026-08-27 · M1c T4 (một phần) · 3 workflow: `deploy-api.yml` (push chạm
  `apps/api`/`packages/core`/`packages/style` → build + test api + `wrangler deploy
  --env production`), `deploy-docs.yml` (build core+web+docs → `pages deploy`),
  `data-update.yml` (dispatch/cron chủ nhật 19:00 UTC, chạy trong image GHCR,
  `--memory 6g`, timeout 180 phút). **Chưa kiểm chạy: Step 1 đặt secret bị bộ lọc
  quyền chặn** · (commit hiện tại)
- 2026-08-27 · M1c · phát hiện khi chạy deploy: token Cloudflare thiếu
  `Workers Scripts: Edit` + `Cloudflare Pages: Edit` (chỉ có KV), PAT GitHub thiếu
  `Secrets: Read and write`. Dry-run bundle Worker production đạt 182,82 KiB
  (gzip 38,97 KiB) với đủ 4 binding · (commit hiện tại)
- 2026-08-27 · M1c T1 S7 · Worker deploy production thành công sau khi thay token:
  `mapslibvn-api-production.dotienphong1993.workers.dev`, 4 binding đúng (META KV,
  TILES R2, TILES_BASE, ENVIRONMENT=production) · (commit hiện tại)
- 2026-08-27 · M1c T3 S4 · Pages project `mapslibvn-docs` tạo + deploy 32 file:
  `https://mapslibvn-docs.pages.dev` · (commit hiện tại)

## 5. Sự cố

### SC-1 · Cache Rule nuốt Range của PMTiles — **ĐÃ ĐÓNG 27/08/2026**

**Triệu chứng.** Client đọc `https://tiles.ai-solutions.io.vn/tiles/vn-20260827.pmtiles`
bằng `Range: bytes=0-1023` nhận **HTTP 200 kèm toàn bộ 997.786.022 byte** thay vì
`206` + 1 KB. Trình duyệt sẽ tải 952 MB rồi mới vẽ được bản đồ.

**Nguyên nhân gốc.** Cache Rule của zone là `(http.host eq "tiles.ai-solutions.io.vn")`
→ `cache: true`, edge TTL 1 năm — áp cho **toàn bộ** hostname, gồm cả archive 951,6 MiB.
Zone ở gói **Free**, giới hạn object cache là **512 MB**. Khi gặp một cache key chưa biết,
Cloudflare cố cache-fill: bỏ qua header `Range`, kéo trọn object từ R2 và trả nguyên cho
client; chỉ sau đó mới kết luận không cache được (`cf-cache-status: BYPASS`) và ghi nhớ —
nên request sau **trên cùng cache key** mới được proxy Range đúng. Hệ quả: người dùng đầu
tiên chạm vào mỗi PoP chưa warm phải tải 952 MB.

**Bằng chứng phân biệt (trước khi sửa).**

| Phép đo | Kết quả |
|---|---|
| Range, cache key cũ | `206`, 1.024 B, `BYPASS` |
| Range, cache key mới × 3 | `200`, tải 245 MB / 207 MB / 189 MB trước khi ngắt |
| Range trên font nhỏ cùng bucket | `206`, 100 B |
| Worker đọc R2 qua binding | 200, tile đúng ở z8/z12/z14 |

Hai dòng cuối chứng minh archive trong R2 lành lặn và R2 hỗ trợ Range — lỗi ở tầng cache
của Cloudflare, không ở dữ liệu.

**Cách sửa (PHONG áp trên dashboard).** Tách rule cũ thành hai, loại trừ lẫn nhau nên
không phụ thuộc thứ tự:

1. `(http.host eq "tiles.ai-solutions.io.vn" and not ends_with(http.request.uri.path, ".pmtiles"))`
   → Eligible for cache, edge 1 năm, browser 1 ngày (font, sprite).
2. `(http.host eq "tiles.ai-solutions.io.vn" and ends_with(http.request.uri.path, ".pmtiles"))`
   → **Bypass cache**.

**Kiểm chứng sau khi sửa.** Cache key hoàn toàn mới → `206`, đúng 1.024 byte, 1,10 s rồi
0,34 s, `cf-cache-status: DYNAMIC`. Font → `206`, `cf-cache-status: HIT` (vẫn cache đúng).

**Bài học.** Với gói Free/Pro/Business, mọi object > 512 MB phục vụ qua Cloudflare phải
được đặt **Bypass cache** — nếu không, mỗi cache key lạnh phải trả giá một lần kéo trọn
file và Range bị vô hiệu. Khi đổi sang domain riêng của MapsLibVN, **phải mang theo cặp
rule này**, nếu không lỗi lặp lại y hệt.

## 6. Nghiệm thu M1 (spec mục 13, hàng M1)

Chạy 27/08/2026 trên production thật (Chromium headless qua Playwright, ảnh lưu ngoài repo).

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | `pnpm run setup` clone sạch | macOS arm64: `real 4,42s`, báo sẵn sàng sau 2 giây (M1a T9). **Windows: PENDING** |
| 2 | Playground production, style light | Bản đồ TP.HCM nhãn tiếng Việt đủ dấu; 14 tile request **toàn bộ `206`**, tải 3.127 KB; **0 request tới Worker cho tile** — client đọc thẳng R2 đúng kiến trúc spec |
| 2b | Style dark | Tải được, 14 tile `206`, 2.495 KB |
| 3 | Zoom z4, nhãn chủ quyền | `queryRenderedFeatures` trên lớp `sovereignty-label` trả đúng 2 nhãn **"Quần đảo Hoàng Sa (Việt Nam)"** và **"Quần đảo Trường Sa (Việt Nam)"** — hiện thật trên ảnh |
| 4 | Trang HTML trắng của bên thứ ba nhúng bằng một thẻ `<script>` UMD | Bản đồ Hà Nội tải, 8 tile `206`, attribution chứa cả "OpenStreetMap" lẫn "MapsLibVN", 1 marker, không lỗi trang |
| 5 | `pnpm data:update --dry-run` | `Kế hoạch: {"tiles":false,"poi":false,"reasons":[]}` → `(dry-run) dừng.` — idempotent |
| 5b | `data:update --tiles` trọn vòng | Đã chạy thật ở M1b T6 (download → patch → build → QA → R2 → smoke 20/20 → manifest). **Không chạy lại `--force`** ở bước nghiệm thu: tốn 60–90 phút build lại trong khi vòng đời đã được chứng minh và `--dry-run` xác nhận trạng thái nhất quán |
| 6 | Spec 4.2 — lớp thế giới ngoài VN ở z0–6 | **ĐẠT.** z2 hiển thị đầy đủ hình khối toàn cầu (landcover 25, boundary 7, water 10 feature), không có "lỗ đen"; Planetiler đã dùng Natural Earth cho z0–7. **Hạn chế đã biết:** không có nhãn địa danh ngoài Việt Nam — ở z2/z4 chỉ có nhãn "Việt Nam", z6 chỉ các đô thị VN (Huế, Pleiku, Kon Tum, Buôn Ma Thuột, Quảng Ngãi…). Chấp nhận được cho M1 ("bản đồ câm", định hướng Việt Nam trước); **không cần Protomaps**. Nếu sau này muốn tên nước láng giềng, cân nhắc ở M3: bật lớp place của Natural Earth trong profile Planetiler |
| 7 | Test và CI | lint 75 file, typecheck 9/9, **79/79 test** (69 root + 10 api), E2E Playwright 2/2 offline; CI xanh liên tiếp |

**Còn lại để đóng M1:** M1c T4 Step 5 — kiểm 3 workflow trên Actions, đang chờ quyền
`Secrets: Read and write` cho PAT GitHub.
- 2026-08-27 · M1c · SC-1 đóng: sau khi tách Cache Rule, Range trên cache key mới trả
  `206`/1.024 B trong 1,10 s (`DYNAMIC`), font vẫn `HIT` · (commit hiện tại)
- 2026-08-27 · M1c T5 · nghiệm thu M1 trên production: playground light/dark, nhúng UMD
  từ trang bên thứ ba, z4 hiện đủ 2 nhãn chủ quyền, tile toàn `206` đọc thẳng R2,
  `data:update --dry-run` idempotent, spec 4.2 đánh giá ĐẠT · (commit hiện tại)
