# DEVLOG — MapsLibVN

Đọc file này trước khi làm bất cứ việc gì. Cập nhật ở bước cuối của MỌI task (cùng
commit với code).

## 1. Trạng thái hiện tại

- Mốc: M2 — Kho POI + máy chủ nội bộ
- Plan: `docs/superpowers/plans/2026-08-27-m2-kho-poi-may-chu.md` (11 task, 6.535 dòng sau review lần 3)
- Task đang làm: Task 9 — POI PMTiles + lớp style + Worker (thứ tự thực thi: 0 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 1 → 10)
- Commit cuối: M2 T8 (commit hiện tại)
- Môi trường đã dựng: máy dev macOS; remote GitHub cá nhân; Postgres/PostGIS dev,
  migration `0001_extensions.sql`; `pnpm run setup` sạch đạt 6,51 giây; image
  pipeline local đã build/smoke trên arm64 và chạy được qua Compose; Dev Container
  đã dựng thành công và chạy đủ 20 test trong Linux container; CI GitHub xanh
  trên amd64 và image đã được push lên GHCR; R2 bucket `mapslibvn-tiles` (APAC),
  custom domain `tiles.ai-solutions.io.vn` (SSL active), CORS, KV
  `mapslibvn-META` và Cache Rule đã cấu hình; tiles `vn-20260827` đã publish,
  smoke 20/20 qua custom domain và manifest KV đã active; M1a/M1b đã nghiệm thu
  trên macOS arm64; Worker `mapslibvn-api-production.dotienphong1993.workers.dev`
  và docs `mapslibvn-docs.pages.dev` đã chạy production; repo GitHub chuyển **private**
  với 8 secret Actions; **M1 (M1a+M1b+M1c) đã nghiệm thu 27/08/2026**;
  **PENDING Windows** (chờ PHONG có máy để kiểm)

## 2. Bước kế tiếp

M2 Task 9 — xuất `poi-YYYYMMDD.pmtiles`, thêm lớp POI vào style và Worker điền
`{POI_FILE}`; bắt đầu bằng test thuần export/layer theo plan.

**Lưu ý vận hành máy dev:** đĩa đã đầy 97 % ngày 27/08 (`~/.cache/uv` 124 GB + JSONL Overture không nén);
đã dọn còn 44 GiB trống. Trước các bước nặng (Task 7 gộp, Task 10 `data:update`), kiểm `df -h /`.

**Việc tay PHONG trước Task 1 (làm sau Task 9):** máy dev làm máy chủ tạm — tắt ngủ máy;
tạo token Cloudflare riêng `mapslibvn-pipeline` (Workers KV Edit + Workers R2 Edit) cho
`infra/server/.env`; Tunnel/Access/Hyperdrive theo `infra/server/README.md`.

**Việc tay còn lại của M2 Task 8:** biên soạn bảng alias phường/xã trước→sau sắp xếp
2025 từ các nghị quyết UBTVQH; bổ sung relation level 4 Khánh Hòa vào nguồn OSM/override
đã duyệt để nạp được alias Ninh Thuận.

**Việc còn treo từ M1 (không chặn M2):**
- Nghiệm thu `pnpm run setup` trên **Windows** — chờ PHONG có máy.
- QA `requireIslands` cho Hoàng Sa đang tắt (chỉ cảnh báo): extract `vietnam.poly` của
  Geofabrik không phủ Hoàng Sa và chỉ phủ Trường Sa tới 114,6°E. Nhãn chủ quyền hiện do
  lớp `sovereignty` của style bảo đảm và đã kiểm chứng hiện thật ở z4. Cần PHONG chốt
  nguồn extract OSM bổ sung rồi bật lại.
- Tiles còn dùng `tiles.ai-solutions.io.vn`; khi có domain riêng, **nhớ mang theo cặp
  Cache Rule** ở SC-1.
- `.github/workflows/data-update.yml` thiếu `RCLONE_CONFIG_R2_NO_CHECK_BUCKET` (M1c để
  lọt, dry-run không lộ) — sửa ở M2 Task 10 cùng lúc thêm biến Tunnel/HF.

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
| 2026-08-27 | Repo GitHub chuyển **private** đúng roadmap; `data-update.yml` bỏ `schedule`, chỉ còn `workflow_dispatch` | Repo private ở gói Free chỉ có 2.000 phút Actions/tháng, mà một lần `data:update` đủ tốn 60–180 phút; lịch định kỳ do máy nội bộ đảm nhận từ M2 | `058dafc` |
| 2026-08-27 | Đẩy secret bằng `printf '%s' "$v" \| gh secret set NAME` (stdin), **không dùng `--body -`** | `gh secret set --body -` không đọc stdin mà lưu đúng ký tự `-`; cả 8 secret nhận giá trị `-` khiến 3 workflow fail (`7003 No route for that URI`, `dial tcp: lookup -: no such host`). Dấu hiệu nhận biết: GitHub che **mọi** dấu `-` trong log thành `***` (`pnpm ***filter`, `maps***library***vietnam`) | (Task M1c T4) |
| 2026-08-27 | **Foursquare OS Places đọc qua Hugging Face** (`hf://datasets/foursquare/fsq-os-places/release/dt=…/places/parquet/`, gated, cần `HF_TOKEN` Read), không qua S3 | Bucket `fsq-os-places-us-east-1` chỉ còn LICENSE/NOTICE, `release/` trả `KeyCount 0`, file parquet cũ → 404; docs Foursquare: "now delivered through the Foursquare Places Portal … instead of the legacy public S3 bucket". PHONG chọn phương án HF thay vì bỏ FSQ hay dùng Places Portal/Iceberg | (review plan M2) |
| 2026-08-27 | **Máy dev là máy chủ nội bộ tạm** (G3); compose `mapslibvn-server` chạy song song compose dev; chuyển máy thật sau bằng `server:setup` + `db:restore --latest` + dán lại `TUNNEL_TOKEN` | PHONG chưa có máy 24/7; kiến trúc Docker-volume + backup R2 hằng ngày đã cho phép chuyển máy bằng ba lệnh — điều kiện: backup→restore phải được thử ngay ở Task 1 Step 8 | (review plan M2) |
| 2026-08-27 | Thứ tự thực thi M2: `0 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 1 → 10` (Task 1 sau Task 9) | Task 1 phụ thuộc việc tay Cloudflare + máy chủ; mọi task khác chạy trên Postgres dev. Commit binding Hyperdrive chỉ khi có ID thật vì `deploy-api.yml` tự deploy mỗi push chạm `apps/api/**` | (review plan M2) |
| 2026-08-27 | `pg_hba.conf` máy chủ: `hostssl all all all` + `hostnossl all all all reject`, không có dòng `samenet`; `databaseUrlFromEnv` thêm `?sslmode=require` khi `POSTGRES_SSL=require` | Plan cũ xếp `host … samenet` trước `hostssl` → cloudflared (cùng mạng compose) không bị buộc TLS, câu "sslmode=disable bị từ chối" trong README là sai; client `postgres` mặc định không TLS nên compose phải đặt `POSTGRES_SSL` | (review plan M2) |
| 2026-08-27 | `publishNew` chỉ `setval` khi bảng có cột `id` (kiểm `information_schema.columns`) | Đã chạy thật trên Postgres 16: `pg_get_serial_sequence('bảng_không_có_id','id')` **ném lỗi** `column "id" … does not exist`, không trả NULL như plan giả định → src_*, admin_alias sẽ fail ngay lần đầu | (review plan M2) |
| 2026-08-27 | `db:restore` phục hồi vào DB tạm `<db>_restore` (TEMPLATE template0) rồi `ALTER DATABASE … RENAME`, không `--clean` lên DB đang chạy | `spatial_ref_sys` là bảng cấu hình của extension PostGIS → dump có data → restore `--clean` trùng khoá/vướng phụ thuộc; DB đang phục vụ không bị bỏ trống nếu restore lỗi | (review plan M2) |
| 2026-08-27 | Job `dbtest` tách thành workflow `dbtest.yml` có `paths` filter + `workflow_dispatch`, không nằm trong `ci.yml` | Repo private chỉ có 2.000 phút Actions/tháng; dbtest 10–15 phút mỗi lần | (review plan M2) |
| 2026-08-27 | Pin `cloudflared 2026.8.2` (plan cũ 2025.8.1); `@duckdb/node-api` pin bản không pre-release (hiện `pnpm view` trả `1.5.5-r.4`); Overture mới nhất `2026-08-19.0` | Kiểm thật 27/08 | (review plan M2) |
| 2026-08-27 | Icon lá `category.json`: `rail`→`railway`, `rail_metro`→`railway_metro`, `doctor`→`doctors`, `beach`→`swimming` | Sprite osm-liberty (244 icon) không có 4 tên cũ; API M3 sẽ trả tên icon không tồn tại | (review plan M2) |
| 2026-08-27 | G4/G5/G7 kiểm xong bằng lược đồ thật: Overture `2026-08-19.0` có `geometry` kiểu **GEOMETRY native** (không WKB) + cột mới `socials`, `operating_status`, `taxonomy`; FSQ `dt=2026-08-11` qua HF đủ cột, `date_closed` là VARCHAR, có `country`; `@duckdb/node-api` pin `1.5.5-r.4` (mọi bản đều `-r.N`) | `ST_GeomFromWKB` trong plan sẽ lỗi trên GEOMETRY; `operating_status`/`socials` cho `closed`/facebook chính xác hơn suy từ `sources`; token HF của PHONG đã được cấp quyền gated (`HTTP 200`) | (M2 T0) |
| 2026-08-27 | M2 khác roadmap mục 3 ở 7 điểm (đã cân nhắc khi viết plan): (1) OSM POI qua `osmium tags-filter` + `export` GeoJSONSeq thay `ST_ReadOSM` để giữ POI dạng vùng; (2) cặp ứng viên gộp sinh bằng PostGIS (`ST_DWithin` + `similarity`) thay DuckDB; (3) nạp Postgres bằng `COPY FROM STDIN` từ Node thay `ATTACH postgres`; (4) test pipeline là `.mjs` + JSDoc, `*.dbtest.mjs` cần Postgres dev; (5) `init-roles.sql` → `init-roles.sh`, roles tạo NOLOGIN ở migration 0002; (6) `poi` gộp (UPDATE/INSERT/đóng) không hoán đổi bảng vì `poi_edit` FK; (7) thêm nhóm giả `other` + lá `<nhóm>_other` | Xem phần "Khác biệt so với roadmap" trong plan; ghi ở đây để roadmap mục 3 không bị hiểu là nguồn chân lý | (M2 T0) |
| 2026-08-27 | Vitest tách hai tầng: `vitest.config.ts` (unit, loại `**/*.dbtest.mjs`) và `vitest.db.config.ts` (`fileParallelism: false`, timeout 120 giây, `--passWithNoTests`) | dbtest cần Postgres dev và chạy hàng phút; không được lẫn vào `pnpm test` của CI chính | (M2 T0) |
| 2026-08-27 | `NAME_FILLERS` có thêm `mtv`; `abbrev.json` thêm `tx.`, `h.`, `x.` so với spec 5.3; alias thương hiệu chỉ áp ở đầu chuỗi | "Công ty TNHH MTV …" rất phổ biến trong tên đăng ký; thị xã/huyện/xã xuất hiện trong địa chỉ ngoài đô thị; alias giữa chuỗi gây dương tính giả ("Quán TCH") | (M2 T3) |
| 2026-08-27 | `parseAddress`: 9 luật thêm so với plan sau khi review 300 địa chỉ thật — (1) "N/M Hẻm N X" gộp chuỗi hẻm trùng đầu (`mergeChain`), số hẻm nhận dạng `A/B`; (2) tiền tố "Đường/Phố" chỉ khi bản gốc có `Đ`/`ố` (tránh nuốt "Dương Quảng Hàm", "Phổ Quang"); (3) `tỉnh lộ` không phải tỉnh; (4) phần đã tách dấu phẩy được tách tiếp ở phường/quận (không tách `xã` vì "Xã Đàn"); (5) tên đường ở phần kế sau số nhà đứng riêng ("736/169/10, Đ. Lê Đức Thọ"); (6) số nhà có chữ `272A4`, `E4/15`, `C33` (loại `p6/q10/f6/tp`, mã đường `QL/TL/ĐT/HL`); (7) "3 Tháng 2" là tên đường; (8) bỏ ngoặc đơn, gạch dài `–`, "Cư xá", "gần/đối diện/cuối", tiếng Anh `Ward`/`District`; (9) "Lô P2" không tách thành phường 2 | Lấy mẫu phân tầng 300 địa chỉ Overture (100 có `/`, 60 hẻm/ngõ, 60 có P./Q., 80 còn lại) lộ các mẫu địa chỉ thật mà 49 dòng curated không phủ | (M2 T4) |
| 2026-08-27 | JSONL trung gian của ingest Overture/FSQ **nén gzip** (`COPY … (FORMAT json, COMPRESSION gzip)`, `readJsonl` tự giải nén theo đuôi `.gz`) | Bản không nén ~3–4 GB cho 2 triệu dòng làm đầy đĩa dev (còn 435 MiB) → Docker treo, job bị giết; nguyên nhân gốc là `~/.cache/uv` 124 GB nhưng pipeline không nên cần vài GB tạm | `a70514c` |
| 2026-08-28 | Đo độ phủ taxonomy phân biệt **thiếu ánh xạ** (không có dòng CSV nào khớp, kể cả wildcard — ngưỡng chặn 2 %) với **`*_other` chủ đích** (có dòng CSV trỏ thẳng tới `<nhóm>_other`) | Bản đo đầu gộp chung hai loại nên báo Overture 29,3 % "chưa ánh xạ", nhưng phần lớn là nhóm cha chung của nguồn (`professional_services` → `services_other`) — ánh xạ đúng ngữ nghĩa, không thể chi tiết hơn | (M2 T6) |
| 2026-08-28 | `OSM_DROP` mở rộng thêm 22 giá trị: hạ tầng đường sắt (`railway=level_crossing/switch/signal/platform/stop/crossing/subway_entrance/buffer_stop/milestone`), sân bay (`aeroway=gate/taxiway/runway/holding_position/parking_position`), và `amenity=house/shower/watering_place/water_point/bicycle_repair_station/smoking_area/lounger/trolley_bay`, `leisure=outdoor_seating/swimming_area` | Đo trên 228 nghìn đối tượng OSM VN: đây là hạ tầng, không phải địa điểm để tìm kiếm; giữ lại sẽ tạo POI rác | (M2 T6) |
| 2026-08-28 | 55 ánh xạ bổ sung so với plan, chọn theo số lượng thật trong dữ liệu VN (Overture `health_spa` 4.114 → `spa`, `bridal_shop` 3.683 → `clothes`, `laundromat` 1.865 → `laundry`, `day_care_preschool` 1.752 → `kindergarten`…; FSQ `Structure`, `Factory`, `Assisted Living`…); `farm`/`agriculture`/`agricultural_service` cố ý để rơi vào `other` | Địa điểm nông nghiệp không thuộc 12 nhóm của spec 5.6; ghi chú `#` ngay trong CSV | (M2 T6) |
| 2026-08-28 | Cổng fixture phân biệt `category = 'other'` (chưa ánh xạ, <10 %) với tỷ lệ báo cáo `other OR *_other` | `*_other` là lá parent được Task 6 ánh xạ có chủ đích, không phải thất bại taxonomy; fixture gộp đo 16,1 % combined, toàn VN 19,5 %, đều được báo cáo nhưng không nới ánh xạ ở Task 7 | (M2 T7) |
| 2026-08-28 | Khi nhiều cụm cùng kế thừa một `poi_id`, giữ cụm chứa **previous** `primary_source`/`primary_source_id` của POI cũ, kể cả record đó hiện là secondary; tie bằng `poi_id`/`cluster_no` | Merge/split có thể đổi primary hiện tại; kiểm role mới không xác định POI lịch sử và tạo khoá trùng `poi_new` hoặc chọn ID tuỳ ý | (M2 T7) |
| 2026-08-28 | Ghép tham lam dùng thứ tự toàn phần `score DESC, a, b`; mọi quét nguồn có `ORDER BY` khoá nguồn; `pickPrimary` hoà cùng nguồn dùng `rid` thấp hơn | Không có tie-break làm số cụm thay đổi giữa các lần dựng và có thể tách/kế thừa `poi_id` không ổn định; hai pass toàn VN final-head cùng 402.210 cặp, 1.522.371 POI (1.515.938 active), 1.583.562 link và hash source-link `1434f2acaaa69fd3eee74a9dbdda47a2` | (M2 T7) |
| 2026-08-28 | Không nới ngưỡng gộp chỉ để đạt kỳ vọng đa nguồn 10–25 % | Audit cuối: 50.862/1.522.368 = 3,3 % đa nguồn; Overture chiếm 1.140.030 cụm đơn. 63.269 cặp liên nguồn được luật hiện hành chấp nhận (OSM+Overture 18.405, FSQ+OSM 9.701, FSQ+Overture 35.163); phần còn lại chủ yếu bị khoảng cách/tên/số nhà/đường loại. Đây là thực tế dữ liệu dưới luật chống gộp nhầm, cần quyết định sản phẩm riêng nếu muốn đổi recall | (M2 T7) |
| 2026-08-27 | `osmium export` ghi id đối tượng ở `feature.id`, không ở `properties.id` như plan giả định → `parseOsmiumId(f.id ?? f.properties?.id)`; sửa cả `osm-roads.mjs` (Task 8) trong plan | Ingest OSM fixture trả 0 dòng cho tới khi sửa | `f9f1fda` |
| 2026-08-27 | Fixture `q1.osm.pbf` dùng `-s smart -S types=any` nên có node ngoài bbox Quận 1 (bbox thật 105,77–108,43°E); test bbox chỉ áp cho Overture/FSQ, OSM kiểm trong VN + ≥ 500 đối tượng trong Quận 1 | Giữ trọn relation ranh giới để Task 8 dựng `admin_area` trên fixture | `f9f1fda` |
| 2026-08-27 | Dockerfile gộp luôn Task 1 Step 4 (`postgresql-client-16`, `zstd`, `cloudflared 2026.8.2`) vào lần rebuild của Task 5 | Chỉ rebuild image một lần (~10 phút) thay vì hai | `f9f1fda` |
| 2026-08-27 | DuckDB 1.5 `ST_AsGeoJSON` trả kiểu JSON (object) — `make-vn-boundary.mjs` nhận cả object lẫn chuỗi | Bản đầu `JSON.parse` hai lần → lỗi `[object Object]` | `a70514c` |
| 2026-08-27 | Danh sách 34 tỉnh + alias tên cũ nằm trong `packages/core/src/provinces.json` (NQ 202/2025/QH15) | Địa chỉ cũ ("Bình Dương", "Vũng Tàu", "Bến Tre") vẫn về đúng tỉnh mới | (M2 T4) |
| 2026-08-29 | OSM raw hiện dùng level 6 cho 3.308 phường/xã/thị trấn + 11 đặc khu sau sắp xếp; map chúng sang semantic level 8, loại level 8 cũ đã bị bao phủ và relation biên giới; level 4 lọc theo seed alias tỉnh 2025 | Raw có `L4=39, L6=3.322, L8=565`, không còn theo giả định plan cũ. Kết quả đúng dữ liệu hiện tại là L4=33, L8=3.319; OSM thiếu riêng Khánh Hòa, không tạo geometry giả để ép đủ 34 | (M2 T8) |
| 2026-08-29 | Parser tên hẻm nhận thêm chuỗi `/`, khoảng `-`, mã chữ-số (`111K1`, `02/K01`), `+`, dấu phẩy/chấm và lỗi thiếu khoảng trắng | Regex spec hẹp làm 109 street cluster toàn VN vẫn mang tên hẻm số; RED từ mẫu OSM thật rồi mở rộng, final còn 0 | (M2 T8) |
| 2026-08-29 | Anchor gộp hai pass: DBSCAN độ theo plan, sau đó cleanup metric UTM 48N 30,5 m trên các median | Exact indexed national check bắt 1 cặp còn cách 29,509 m sau pass đầu; tăng epsilon độ lên 0,00035 overmerge 8.992 mốc nên bỏ. Two-pass chỉ giảm 5 mốc và đưa duplicate exact về 0 | (M2 T8) |
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
| 8 | 3 workflow deploy trên Actions | **Cả 3 xanh.** Deploy API 47 giây → `Deployed mapslibvn-api-production`, version `eedb3317-2431-4f89-91b8-6ea2118d823e`. Deploy Docs 1 phút 2 giây → `Uploaded 8 files (24 already uploaded)`, deployment complete. Data update 41 giây trong image GHCR → `Kế hoạch: {"tiles":false,"poi":false,"reasons":[]}` rồi `(dry-run) dừng.` |

**Kết luận: M1 (M1a + M1b + M1c) NGHIỆM THU ĐẠT ngày 27/08/2026**, trừ hai việc đã ghi
rõ ở mục 2 và không chặn M2: kiểm trên Windows, và bật lại `requireIslands` cho Hoàng Sa.
- 2026-08-27 · M1c · SC-1 đóng: sau khi tách Cache Rule, Range trên cache key mới trả
  `206`/1.024 B trong 1,10 s (`DYNAMIC`), font vẫn `HIT` · (commit hiện tại)
- 2026-08-27 · M1c T5 · nghiệm thu M1 trên production: playground light/dark, nhúng UMD
  từ trang bên thứ ba, z4 hiện đủ 2 nhãn chủ quyền, tile toàn `206` đọc thẳng R2,
  `data:update --dry-run` idempotent, spec 4.2 đánh giá ĐẠT · (commit hiện tại)
- 2026-08-27 · M1c T4 S1+S5 · 8 secret lên repo private; 3 workflow chạy: **Cả 3 xanh.** Deploy API 47 giây → `Deployed mapslibvn-api-production`, version `eedb3317-2431-4f89-91b8-6ea2118d823e`. Deploy Docs 1 phút 2 giây → `Uploaded 8 files (24 already uploaded)`, deployment complete. Data update 41 giây trong image GHCR → `Kế hoạch: {"tiles":false,"poi":false,"reasons":[]}` rồi `(dry-run) dừng.` · (commit hiện tại)
- 2026-08-27 · M1c T5 · **nghiệm thu M1 đạt**, chuyển mốc sang M2 — kho POI + máy chủ
  nội bộ, plan `2026-08-27-m2-kho-poi-may-chu.md`, Task 0 · (commit hiện tại)
- 2026-08-27 · M2 · review plan lần 3 trước khi thực thi: 4 điểm chặn (FSQ mất S3 công khai,
  `publishNew` lỗi trên bảng không có `id`, thiếu `RCLONE_CONFIG_R2_NO_CHECK_BUCKET` ở máy
  chủ/Actions, trình tự Hyperdrive vs auto-deploy) + 7 điểm quan trọng — đã sửa 55 chỗ
  thẳng vào plan; PHONG quyết FSQ qua Hugging Face và máy dev làm máy chủ tạm · (commit hiện tại)
- 2026-08-27 · M2 T0 · G1 (79/79 test, đủ file M1), G2 (image 8 công cụ), G4 Overture
  `2026-08-19.0` (GEOMETRY native), G5 FSQ `dt=2026-08-11` qua HF (`HTTP 200`), G7 pin
  `@duckdb/node-api 1.5.5-r.4`, G8 token HF của PHONG đã được cấp quyền gated; vitest tách
  unit/dbtest, scripts `test:db`/`server:setup`/`server:update`/`db:restore` khai báo sẵn;
  lint 76 file, typecheck 9/9 · (commit hiện tại)
- 2026-08-27 · M2 T2 · migration 0002–0005 (roles `api`/`pipeline` NOLOGIN, 3 bảng nguồn,
  `category`/`poi`/`poi_source_link`/`poi_edit`, 5 bảng geocoding, `tenant`/`api_key`) + 4 file
  `.down.sql`; `db:migrate --down` revert đúng một migration; `databaseUrlFromEnv` hỗ trợ
  `POSTGRES_SSL=require`; `db/schema.dbtest.mjs` 6/6 xanh (16 bảng, SRID, index, ràng buộc,
  quyền, down×4 → migrate lại); workflow `dbtest.yml` riêng có `paths`; unit 87/87 · (commit hiện tại)
- 2026-08-27 · M2 T3 · `@mapslibvn/core`: `stripDiacritics`/`expandAbbrev`/`normalizeVi`/
  `applyBrandAlias`/`nameCore` + `abbrev.json` (12 viết tắt) + `brand_alias.json` (25 thương
  hiệu); fixture 85 dòng × 3 biến thể (gốc/HOA/NFD) = 255 + 4 test hàm → **259/259 xanh ngay
  lần đầu**; build ESM + d.ts, lint, typecheck 9/9, unit 331/331 · (commit hiện tại)
- 2026-08-27 · M2 T4 · `parseAddress` + `provinces.json` (34 tỉnh); fixture 49 curated **49/49**;
  lấy mẫu 300 địa chỉ thật từ Overture `2026-08-19.0` (DuckDB trong image, 5 phút 13 giây),
  review tay từng dòng: bỏ 8 dòng không phải địa chỉ, sửa kỳ vọng 62 dòng, 70 dòng họ "N/M Hẻm N"
  đặt theo luật ngữ nghĩa, 160 dòng nháp xác nhận đúng → 292 dòng `reviewed: true`; sau 9 luật sửa
  parser đạt **339/341 = 99,4 %** (ngưỡng 95 %; 2 dòng lệch chấp nhận: "Tây Hồ Hà Nội",
  "Việt Hùng, Quế Võ" — không có từ khoá hành chính); `dist/index.js` 6,14 kB gzip (ngân sách 8 kB);
  unit 384/384 · (commit hiện tại)
- 2026-08-27/28 · M2 T5 · `pipelines/poi`: ingest 3 nguồn → `src_*`, ranh giới VN Natural Earth (MultiPolygon
  119 KB), fixture Quận 1 11,5 MB (PBF 2,0 + Overture 5,9 + FSQ 3,6; tạo trong ~2 phút), image rebuild
  có pg client/zstd/cloudflared + core dist + extension DuckDB cài sẵn; dbtest 10/10 (schema 6 + ingest 4)
  trong 11 giây; **toàn VN**: OSM 228.144 (10,5 s), Overture 1.501.161 (3 phút 18 s; 6,6 % không phân loại
  — spec 7 %; 6.7 % không có địa chỉ chữ), FSQ 272.349 (73 s); DB dev 2,2 GB. Sự cố đĩa đầy 97 %
  giữa chừng (xem mục 3), dọn xong còn 44 GiB · (commit hiện tại)
- 2026-08-28 · M2 T6 · taxonomy: `db/seed/category.json` 164 mã lá (12 nhóm thật + `other`, mọi icon có
  trong sprite osm-liberty), 3 CSV ánh xạ 955 dòng (OSM 296, Overture 380, FSQ 279), `taxonomy.mjs`
  (`mapCategory`, `osmCandidates` với tag phụ religion/sport/station, `refineSchool`, CLI `load`);
  9/9 test đơn vị; `category-coverage.mjs` đo trên dữ liệu VN thật: **thiếu ánh xạ OSM 0,4 % ·
  Overture 0,8 % · FSQ 0 %** (ngưỡng 2 %), `*_other` chủ đích 7,5 / 23,1 / 11,8 %, Overture còn
  24,6 % other ở mức bản ghi sau khi dùng `alternate`; nạp DB idempotent (164 mã, 955 dòng, chạy
  hai lần cùng kết quả); unit 402/402 · (commit hiện tại)
- 2026-08-28 · M2 T7 · final-head `records`/PostGIS pairs/ghép tham lam hai lượt/publish/report: toàn VN
  1.897.933 records → 402.210 cặp → 1.522.371 cụm (50.860 đa nguồn = 3,3 %, 61.201 secondary,
  946 ID lịch sử dùng lại) → 1.522.371 POI (1.515.938 active, 6.433 closed), 1.583.562 links. Hai pass
  toàn phần A/B có cùng hash canonical `(source,source_id,poi_id)` `1434f2acaaa69fd3eee74a9dbdda47a2`;
  B quan sát: records 1:36–2:07, conflate 4:04–10:41, publish 1:57–2:28, report 9,577 s. Báo cáo tách bare
  `other` 8,4 % (128.087), mapped `*_other` 11,1 % (169.733), combined 19,6 % (297.820); fixture combined
  16,1 % và bare `other` <10 %. dbtest có forward-link assertion và merge/split historical-primary regression ·
  (commit hiện tại)
- 2026-08-29 · M2 T8 · geocode full national từ PBF 313 MB: 215.360 named road ways / 9.073
  admin relation raw → `admin_area` 3.352 (L4=33, L8=3.319; OSM thiếu Khánh Hòa), 33
  alias distinct; 61.031 street; 58.388 alley, 52.789 (90,41 %) có parent+entrance và 0
  entrance xa đường mẹ >1 m; 918.416 anchor, Nguyễn Lâm 171, exact duplicate ≤30 m = 0.
  Task 7 bất biến: 1.897.933 records / 1.522.371 POI / 1.583.562 links. TDD pure 5/5,
  geocode fixture 5/5 async child trên DB `mapslibvn_task8_test`; full run hai lần idempotent;
  disk volume 352→350 GiB trống, host 24→21 GiB trống · (commit hiện tại)
