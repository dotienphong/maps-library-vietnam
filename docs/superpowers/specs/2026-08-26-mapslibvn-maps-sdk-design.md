# MapsLibVN — Thiết kế hệ thống Maps SDK nhúng (Việt Nam trước)

- Ngày: 2026-08-26
- Trạng thái: thiết kế đã duyệt miệng; chờ PHONG review bản viết này trước khi lập kế hoạch thực thi
- Chủ dự án: PHONG
- Repo: `software_business/MapsLibVN` (repo riêng, private ở giai đoạn nội bộ)

## 0. Tóm tắt một đoạn

MapsLibVN là nền tảng bản đồ **nhúng được vào bất kỳ dự án web hoặc mobile nào**, dựng hoàn toàn trên phần mềm mã nguồn mở và dữ liệu mở (MapLibre GL, OpenStreetMap, Overture Maps, Foursquare OS Places), tự host trên Cloudflare + Supabase với chi phí vận hành gần 0 ở quy mô MVP. Phiên bản đầu phủ chi tiết **Việt Nam** với kho POI hợp nhất (~2–3 triệu địa điểm), tìm kiếm/autocomplete tiếng Việt, geocoding địa chỉ kiểu hẻm ("88/9 Nguyễn Lâm") có kèm mức chính xác, và cơ chế người dùng cuối đóng góp/sửa POI. Dùng nội bộ cho các dự án của PHONG trước; ranh giới API key/tenant có sẵn từ đầu để thương mại hoá sau mà không đổi kiến trúc.

## 1. Mục tiêu, phạm vi, người dùng

### 1.1 Mục tiêu

1. Một dòng `<script>` hoặc một gói npm là nhúng được bản đồ có POI, tìm kiếm, geocoding — không cần tài khoản Google/Mapbox.
2. Chi phí vận hành ≈ 0 đ/tháng ở mức < 100K map-load/tháng; tăng tuyến tính, rẻ hơn Google ≥ 100 lần ở quy mô 1M map-load.
3. POI Việt Nam dày nhất có thể **từ nguồn hợp pháp**; chất lượng tăng theo thời gian nhờ đóng góp của người dùng cuối.
4. Tuân thủ giấy phép (BSD/MIT/ODbL/CDLA/Apache) và pháp luật Việt Nam về bản đồ (thể hiện đúng chủ quyền Hoàng Sa, Trường Sa).
5. Không phụ thuộc nhà cung cấp: đổi nguồn tiles, engine tìm kiếm, hay hạ tầng DB mà không đổi SDK và hợp đồng API.

### 1.2 Trong phạm vi MVP (mốc M1–M5)

- Tiles nền vector cho Việt Nam (z0–14, thế giới mờ ở z0–6), 2 theme sáng/tối, phông tiếng Việt đầy đủ dấu.
- Kho POI hợp nhất từ OSM + Overture Places + Foursquare OS Places; lớp POI hiển thị trên bản đồ theo zoom.
- Places API: autocomplete, search, nearby, chi tiết POI, geocode địa chỉ, reverse geocode, đóng góp/sửa POI.
- Web SDK (`@mapslibvn/web`, ESM + UMD) và React bindings (`@mapslibvn/react`).
- API key theo tenant, quota, ghi nguồn (attribution) bắt buộc, đo lường sử dụng.
- Tài liệu + playground công khai.

### 1.3 Ngoài phạm vi MVP (có chỗ trong kiến trúc, làm sau)

- React Native SDK (`@mapslibvn/react-native`) — spec riêng sau khi web ổn định (mục 8.1).
- Chỉ đường (routing/ETA) — cần Valhalla/OSRM riêng.
- Ảnh vệ tinh, Street View, giao thông trực tiếp.
- Cổng nhà phát triển tự đăng ký, thanh toán.
- Chi tiết ngoài Việt Nam.

### 1.4 Người dùng

| Vai | Là ai | Cần gì |
|---|---|---|
| Dev nhúng (tenant) | PHONG và các dự án của anh (app kết bạn theo bối cảnh, stock_app…); sau này là developer khác | SDK dễ dùng, API ổn định, tài liệu, key |
| Người dùng cuối | Người dùng của app nhúng | Bản đồ nhanh, tìm đúng chỗ, sửa được thông tin sai |
| Admin | PHONG | Pipeline tự chạy, duyệt đóng góp, xem sử dụng, rollback |

### 1.5 Quyết định đã chốt (26/08/2026)

| Quyết định | Chọn | Lý do ngắn |
|---|---|---|
| Đối tượng | Nội bộ trước, thương mại sau | Khách chỉ trả tiền khi dữ liệu tốt hơn Goong; cần thời gian tích luỹ |
| Phạm vi địa lý | Việt Nam trước | Dữ liệu ~1 GB tiles, ~2–3 triệu POI; xử lý chủ quyền gọn |
| Nền tảng | Web trước, rồi React Native/Expo | Khớp stack React/Next.js hiện có |
| Kiến trúc | A — tĩnh tối đa (serverless) | Chi phí ~0, không máy chủ, nâng cấp sau Worker |
| Hạ tầng | Cloudflare (R2, Workers, KV, Pages, Hyperdrive) + Supabase (Postgres/PostGIS) project riêng | Đang dùng, quen, free tier rộng |
| Tên | MapsLibVN; gói `@mapslibvn/*`; global UMD `MapsLibVN` | Do PHONG chọn |

## 2. Kiến trúc tổng thể

```
                 ┌──────────────── SDK (phía khách nhúng) ────────────────┐
                 │  @mapslibvn/web   @mapslibvn/react   (@mapslibvn/react-native – sau)
                 │                 └── dùng chung @mapslibvn/core ──┘       │
                 └──────────────┬──────────────────────────┬─────────────────┘
                 style.json / tiles / fonts / sprites      │ REST JSON (X-Api-Key)
        ┌───────────────────────▼──────────┐   ┌───────────▼──────────────────────┐
        │  apps/api  (Cloudflare Worker)   │   │  apps/api  (cùng Worker)          │
        │  /v1/tiles /v1/styles /v1/assets │   │  /v1/autocomplete /search /nearby │
        │  đọc PMTiles trên R2 (range)     │   │  /places/{id} /geocode /reverse   │
        │  Cache API + alias KV            │   │  /edits /attribution              │
        └───────────────────────▲──────────┘   │  key/quota (KV) · Hyperdrive → DB │
                                │              └───────────▲──────────────────────┘
                     upload hằng tuần                      │ SQL (pooled)
        ┌───────────────────────┴──────────────────────────┴──────────────────────┐
        │  Supabase Postgres + PostGIS + pg_trgm + unaccent   (project "mapslibvn")│
        │  src_osm_place │ src_overture_place │ src_fsq_place   ← lớp nguồn, tách  │
        │  poi │ poi_source_link │ poi_edit │ category │ address_anchor │ street  │
        │  alley │ admin_area │ admin_alias │ tenant │ api_key                     │
        └───────────────────────▲─────────────────────────────────────────────────┘
                                │ COPY (DuckDB → Postgres)
        ┌───────────────────────┴─────────────────────┐   ┌───────────────────────┐
        │ pipelines/poi (GitHub Actions, hằng tuần)   │   │ pipelines/tiles       │
        │ OSM PBF · Overture parquet · FSQ parquet    │   │ pyosmium patch → Planetiler → QA → R2
        │ → chuẩn hoá → gộp → anchors → poi.pmtiles   │   │ (hằng tuần)           │
        └─────────────────────────────────────────────┘   └───────────────────────┘
```

### 2.1 Nguyên tắc thiết kế

1. **Tách bộ vẽ và dữ liệu.** MapLibre chỉ vẽ; mọi dữ liệu đi qua URL do Worker cấp. Đổi nguồn tiles không đụng SDK.
2. **Mọi nâng cấp nằm sau Worker.** Postgres → Meilisearch, Micro → Large, R2 → nguồn khác: hợp đồng API và SDK không đổi.
3. **Lớp nguồn bất biến, tách bảng.** Dữ liệu OSM/Overture/FSQ giữ nguyên trong bảng riêng theo nguồn; bản ghi chuẩn của MapsLibVN chỉ *liên kết* bằng ID (mô hình Collective Database của ODbL, mục 12.2).
4. **Tĩnh trước, động sau.** Bản đồ và lớp POI hiển thị là file tĩnh trên CDN; chỉ tìm kiếm và đóng góp chạm DB.
5. **Ghi nguồn không tắt được.** SDK luôn hiển thị attribution; API trả chuỗi bắt buộc.
6. **Không có nguồn Google/Apple/Grab.** Không cào, không nhập dữ liệu vi phạm điều khoản.
7. **Trung thực về độ chính xác.** Mọi kết quả geocode kèm `precision` và `confidence`.

## 3. Repo và công nghệ

### 3.1 Cấu trúc monorepo

```
MapsLibVN/
  apps/
    api/            Cloudflare Worker (Hono): tiles, styles, assets, Places API, key/quota
    docs/           Tài liệu + playground (Astro Starlight, Cloudflare Pages)
    admin/          Trang duyệt đóng góp tối giản (Next.js, Supabase Auth, chỉ admin) — từ M4
  packages/
    core/           @mapslibvn/core: client TS gọi API, kiểu dữ liệu, chuỗi attribution, parser địa chỉ (dùng chung)
    web/            @mapslibvn/web: bọc maplibre-gl, web component <mapslibvn-autocomplete>, bản UMD
    react/          @mapslibvn/react: <MapsLibVNMap>, useMap, usePlaces
    style/          style.json light/dark, sprite, glyph, sovereignty.geojson, script build
  pipelines/
    tiles/          patch PBF (pyosmium) → Planetiler → QA → upload R2 → đổi alias
    poi/            ingest (DuckDB) → chuẩn hoá → gộp → anchors → COPY Postgres → poi.pmtiles
  db/
    migrations/     SQL migration Supabase (đánh số, idempotent)
    seed/           seed tenant/api_key, taxonomy, admin_alias
  docs/superpowers/specs/   tài liệu thiết kế (file này)
  .github/workflows/        ci.yml · tiles-weekly.yml · poi-weekly.yml · deploy-api.yml · deploy-docs.yml
```

### 3.2 Công nghệ và phiên bản

| Lớp | Công cụ | Giấy phép | Ghi chú |
|---|---|---|---|
| Ngôn ngữ | TypeScript 5 (strict), Node 22 LTS, pnpm 9, Turborepo | — | Toàn repo trừ 1 bước pyosmium |
| Bộ vẽ | maplibre-gl 5.x (web); @maplibre/maplibre-react-native (sau) | BSD-3 / BSD-2 | peer dependency của SDK |
| Tiles nền | Planetiler (bản phát hành mới nhất ≥ 0.9), lược đồ OpenMapTiles | Apache-2.0 / BSD + CC-BY 4.0 (thiết kế) | chạy trong GitHub Actions |
| Tiền xử lý PBF | Python 3.12 + pyosmium | BSD | chỉ cho bước chủ quyền (4.3) |
| POI tiles | tippecanoe 2.x | BSD-2 | |
| Định dạng | PMTiles v3 + thư viện `pmtiles` (JS) | BSD-3 | |
| Pipeline dữ liệu | DuckDB 1.5 (httpfs, spatial) qua Node | MIT | đọc parquet thẳng từ S3 |
| DB | Supabase Postgres 15+, PostGIS, pg_trgm, unaccent | PostgreSQL / GPL (PostGIS – server side, không phân phối) | project riêng "mapslibvn" |
| API | Hono 4 trên Cloudflare Workers, Wrangler 4 | MIT | |
| Kết nối DB | Cloudflare Hyperdrive + `postgres` (porsager) | — / Unlicense | |
| Test | Vitest, Playwright, `@maplibre/maplibre-gl-style-spec` | MIT / Apache | |
| Docs | Astro Starlight | MIT | |
| Phông | Noto Sans (Regular/Bold/Italic) | SIL OFL 1.1 | glyph PBF tự build |
| Icon | Maki + Temaki | CC0 | |

### 3.3 Giấy phép mã của chính repo

- Gói SDK (`packages/*`) phát hành npm dưới **MIT** để khách nhúng không vướng gì.
- `apps/*`, `pipelines/*`, `db/*` giữ private trong giai đoạn nội bộ. Không thành phần nào dùng mã copyleft phía server cần phân phối, nên không có nghĩa vụ mở mã.

## 4. P1 — Tiles nền Việt Nam

### 4.1 Nguồn và sản phẩm

- OSM: `https://download.geofabrik.de/asia/vietnam-latest.osm.pbf` (~350 MB, cập nhật hằng ngày).
- Natural Earth + OSM water polygons: Planetiler tự tải.
- Sản phẩm: **một file** `vn-YYYYMMDD.pmtiles` (ước ~1 GB), lược đồ OpenMapTiles, zoom 0–14; ngoài Việt Nam chỉ có lớp Natural Earth (đất/nước/biên giới/tên nước) đến z6.

### 4.2 Lệnh build (chạy trong `tiles-weekly.yml`)

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

- Thứ tự trong workflow: (1) `planetiler --area=vietnam --only-download` tải PBF gốc + Natural Earth + water polygons; (2) pyosmium patch PBF gốc → `work/vietnam-patched.osm.pbf`; (3) lệnh build trên với `--osm-path` trỏ vào file đã patch (Planetiler chỉ tải khi file thiếu, nên file patch không bị ghi đè).
- `--bounds` toàn cầu để các lớp Natural Earth phủ thế giới ở zoom thấp trong khi OSM chỉ có Việt Nam.
- **Dự phòng** (nếu kết quả zoom thấp ngoài VN không đạt trong M1): lấy lớp thế giới z0–6 bằng `pmtiles extract --maxzoom=6` từ bản build công cộng của Protomaps (ODbL, ~150 MB) làm nguồn thứ hai trong style. Quyết định chốt ở M1 sau khi nhìn kết quả; cả hai đường đều đã được thiết kế.

### 4.3 Chủ quyền — ba lớp bảo vệ, đều bắt buộc

1. **Tầng dữ liệu (pyosmium patch, trước Planetiler):** với mọi node/way/relation có `name` nằm trong hai bbox
   - Hoàng Sa: lon 111.0–113.0, lat 15.7–17.2
   - Trường Sa: lon 111.5–117.8, lat 6.5–12.0
   thì đặt `name := name:vi` nếu có `name:vi`; nếu không có `name:vi` thì **xoá `name`** (không hiển thị tên nước ngoài); xoá các khoá `name:zh`, `name:zh-Hans`, `name:zh-Hant`, `name:en` trong hai bbox này để không lọt qua lớp nào khác. Mọi thứ ngoài bbox giữ nguyên.
2. **Tầng style:** mọi nhãn dùng biểu thức `["coalesce", ["get","name:vi"], ["get","name"]]`; nguồn GeoJSON `sovereignty` (trong `packages/style/sovereignty.geojson`) với hai điểm nhãn "Quần đảo Hoàng Sa (Việt Nam)" tại (16.5, 112.0) và "Quần đảo Trường Sa (Việt Nam)" tại (10.0, 114.0), hiển thị từ **z ≥ 4** (khi cả nước nằm trong khung hình) với ưu tiên cao nhất (`symbol-sort-key` thấp nhất, không bị che).
3. **Tầng QA trong CI (`pipelines/tiles/qa.ts`):** giải mã toàn bộ tiles z4–z14 giao hai bbox; **fail** nếu bất kỳ thuộc tính `name*` chứa ký tự CJK, hoặc chứa các chuỗi `Paracel`, `Spratly`, `Xisha`, `Nansha`, `Huangyan`, `Zhongsha`; fail nếu không có polygon đảo nào trong mỗi bbox ở z8; fail nếu style không có 2 nhãn sovereignty. Build không đạt QA → không upload, không đổi alias.

### 4.4 Style, phông, icon (`packages/style`)

- Hai theme: `mapslibvn-light` (kế thừa OSM Liberty, BSD), `mapslibvn-dark` (kế thừa Dark Matter/OpenMapTiles, BSD/CC-BY). Ghi nguồn thiết kế trong `NOTICE`.
- Glyph: build từ Noto Sans bằng `font-maker` thành PBF theo dải 256; phủ đủ tiếng Việt (Latin Extended Additional).
- Sprite: Maki + Temaki, build bằng `spreet`.
- Style được **template hoá**: `{API_BASE}` và `{KEY}` thay tại Worker khi phục vụ `/v1/styles/{light|dark}.json`, để URL tiles/glyph/sprite luôn mang key của tenant.
- Style phải qua `validateStyleMin` (maplibre-gl-style-spec) trong CI.

### 4.5 Phục vụ (Worker `apps/api`)

| Route | Xử lý | Cache |
|---|---|---|
| `GET /v1/tiles/vn/{z}/{x}/{y}.pbf` | đọc alias `tiles:vn:current` trong KV → tên file → `pmtiles` range-request vào R2 → trả tile gzip | `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`; ETag = build id; Cache API theo URL |
| `GET /v1/tiles/poi/{z}/{x}/{y}.pbf` | như trên với `tiles:poi:current` | như trên |
| `GET /v1/tiles/{vn\|poi}.json` | TileJSON (bounds, minzoom, maxzoom, attribution) | 1 giờ |
| `GET /v1/styles/{light\|dark}.json` | template style + key | 1 giờ, vary theo key |
| `GET /v1/assets/fonts/{fontstack}/{range}.pbf` · `/v1/assets/sprites/{name}[@2x].{json\|png}` | đọc R2 `assets/` | 30 ngày, immutable |

- Bố cục R2 bucket `mapslibvn-tiles`: `tiles/vn-YYYYMMDD.pmtiles`, `tiles/poi-YYYYMMDD.pmtiles`, `assets/fonts/...`, `assets/sprites/...`.
- Phát hành nguyên tử: upload file mới → chạy smoke test đọc 20 tile ngẫu nhiên → ghi alias KV. Rollback = đặt alias về file trước (giữ 3 bản gần nhất, xoá bản cũ hơn).
- Tile ngoài bbox VN ở z > 6 trả `204 No Content` (tránh 404 gây log nhiễu).

### 4.6 Lịch và tài nguyên

- `tiles-weekly.yml`: thứ Hai 02:00 (giờ VN); runner `ubuntu-latest` (7 GB RAM đủ cho VN); ước 20–30 phút gồm tải, patch, build, QA, upload.
- Có thể chạy tay (`workflow_dispatch`) khi cần hotfix dữ liệu.

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

Ước lượng kích cỡ: ~2,5 triệu `poi` + ~3,5 triệu bản ghi nguồn + ~2 triệu `address_anchor` ≈ 2–3 GB kể cả index → **Supabase Pro** (8 GB) cho project riêng `mapslibvn`. Đây là khoản chi cố định duy nhất của MVP (25 USD/tháng).

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

1. **Ứng viên**: với mỗi bản ghi nguồn, tìm bản ghi nguồn khác trong bán kính 75 m (150 m nếu cả hai thuộc nhóm `education`, `healthcare`, `public`, `transport` — cơ sở diện tích lớn).
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

### 5.9 Lịch chạy (`poi-weekly.yml`)

Thứ Ba 02:00 giờ VN (sau tiles): tải OSM PBF (dùng lại từ P1 nếu cùng tuần) → DuckDB đọc Overture/FSQ theo bbox VN → chuẩn hoá → gộp → anchors/street/alley/admin → `COPY` vào bảng tạm → hoán đổi bảng trong một transaction → `REINDEX` → xuất `poi.pmtiles` → upload R2 → đổi alias. Ước 60–90 phút trên runner 7 GB; Overture release theo tháng nên phần lớn tuần chỉ thay OSM.

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
- Quota theo ngày (giờ VN) đếm trong KV theo `(key, ngày, nhóm: tiles|places|edits)`; chấp nhận đếm xấp xỉ; chặn `429` khi vượt **2×** quota (tránh chặn nhầm do đếm trễ); tenant `internal` không giới hạn. Mặc định plan `free`: 100.000 tiles/ngày, 20.000 places/ngày, 500 edits/ngày.
- Đo lường: Workers Analytics Engine ghi `(tenant, key, endpoint, status, ms)` cho mọi request — nền cho billing sau.
- Không lưu IP thô; `ip_hash = sha256(ip + salt ngày)` chỉ trong `poi_edit` để chống spam.

### 6.5 Đóng góp và duyệt

- `end_user_token` do app nhúng tạo (chuỗi bất kỳ ổn định theo người dùng); Worker băm với `tenant_id` thành `end_user_hash`. Giới hạn 20 edit/ngày/end-user, 500/ngày/key.
- Tự duyệt (`auto_approved`) khi: tenant `internal`; hoặc `kind='update'` chỉ đổi `hours`/`contact` trên POI có `quality_score ≥ 60`; hoặc cùng thay đổi được ≥ 2 end-user khác nhau gửi trong 30 ngày.
- Mọi trường hợp khác `pending` → trang `apps/admin` (Supabase Auth, chỉ tài khoản admin) duyệt/từ chối; duyệt → áp dụng vào `poi`, thêm trường vào `locked_fields`, tạo `address_anchor` nếu có số nhà.
- `kind='create'` từ người dùng: tạo `poi` với `status='pending'`, `created_by='user'`; chỉ hiển thị cho tenant tạo ra cho đến khi duyệt.

### 6.6 Kết nối DB, lỗi, hiệu năng

- Worker → **Hyperdrive** → Supabase Postgres (pooler). Không mở kết nối trực tiếp từ Worker.
- Mọi lỗi trả `{error:{code, message, request_id}}` với mã: `400 invalid_request`, `401 missing_key`, `403 origin_not_allowed|scope`, `404 not_found`, `429 quota_exceeded`, `503 upstream_unavailable` (+ `Retry-After: 30`).
- DB không phản hồi: tiles/styles/assets **không ảnh hưởng** (tĩnh); autocomplete trả bản cache cũ (`stale-if-error` 1 giờ) nếu có, nếu không `503`.
- Mục tiêu hiệu năng: autocomplete p95 < 300 ms từ client tại VN (đo bằng Playwright + `performance.now()`), tile p95 < 150 ms khi cache hit.

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

- `maplibre-gl` là peer dependency; bản **UMD** (`dist/mapslibvn.umd.js`, kèm CSS) đóng gói sẵn maplibre để nhúng bằng một `<script>`; global `MapsLibVN.createMap`.
- Web component `<mapslibvn-autocomplete api-key near-map="map1" placeholder>` phát sự kiện `select` với `Place | GeocodeResult`; dùng được trong mọi framework hoặc HTML thuần.
- Attribution: luôn thêm `AttributionControl` với chuỗi từ `/v1/attribution`; tuỳ chọn `compact` nhưng không có tuỳ chọn tắt.
- Ngân sách: wrapper ≤ 15 kB gzip (không tính maplibre-gl); kiểm trong CI bằng `size-limit`.
- Trình duyệt hỗ trợ: 2 bản mới nhất của Chrome/Edge/Firefox/Safari, iOS Safari 16+.

### 7.3 `@mapslibvn/react`

`<MapsLibVNMap apiKey style center zoom onPoiClick onLoad>{children}</MapsLibVNMap>`, `<Marker>`, `useMap()`, `usePlaces()` (SWR-style cho autocomplete với debounce 200 ms). React 18+.

### 7.4 Tài liệu và playground (`apps/docs`)

Bắt đầu 5 phút (script tag / npm / React), tham chiếu API, ví dụ sống (nhúng thật với key demo giới hạn origin `docs`), trang "Giấy phép & ghi nguồn", trang "Độ chính xác geocode" giải thích `precision`. Deploy Cloudflare Pages.

## 8. Các phần để sau nhưng đã có chỗ

### 8.1 React Native SDK

`@mapslibvn/react-native` bọc `@maplibre/maplibre-react-native`, dùng cùng `/v1/styles/*.json` và `@mapslibvn/core`; key `mobile`. Sẽ có spec riêng sau M5.

### 8.2 Cổng nhà phát triển, thanh toán

`tenant`/`api_key` và Analytics Engine đã đủ dữ liệu; portal tự đăng ký + Polar (đã dùng ở dự án khác) làm khi mở thương mại.

### 8.3 Nâng cấp tìm kiếm

Khi p95 autocomplete > 300 ms bền vững hoặc DAU > 20K: thêm Meilisearch đồng bộ từ `poi` (CDC theo `updated_at`), Worker đổi backend theo cờ cấu hình; hợp đồng API không đổi.

## 9. Bảo mật và riêng tư

- Key `web` không phải bí mật (lộ trong trình duyệt) — bảo vệ bằng `allowed_origins` + quota. Key `server` là bí mật, chỉ dùng phía máy chủ.
- Không thu thập dữ liệu người dùng cuối ngoài: `end_user_hash` (do tenant cung cấp, đã băm), `ip_hash` theo ngày trong `poi_edit`. Không lưu lịch sử truy vấn theo người.
- Log Worker giữ 30 ngày; Analytics Engine chỉ số liệu tổng hợp.
- Điều khoản tenant (viết ở M5): cấm cào/xuất hàng loạt, phải giữ attribution, tenant chịu trách nhiệm xin phép vị trí của người dùng cuối theo Nghị định 13/2023.
- Secrets (`SUPABASE_DB_URL` qua Hyperdrive, `EDIT_SALT`) đặt bằng `wrangler secret`; không có trong repo.

## 10. Kiểm thử

| Tầng | Nội dung | Công cụ |
|---|---|---|
| Unit | `normalizeVi` (≥ 200 fixture), `parseAddress` (≥ 300 fixture), `categoryMap`, hàm xếp hạng, luật auto-approve | Vitest |
| Unit | matcher gộp POI với fixture khó: "Cà phê Cộng" ~ "Cong Caphe", "Highlands Coffee Nguyễn Huệ" ~ "Highlands Nguyen Hue", hai quán cùng chuỗi cách 60 m **không** được gộp | Vitest |
| Tích hợp pipeline | chạy toàn pipeline trên PBF cắt bbox Quận 1 cũ + Overture/FSQ cùng bbox (fixture parquet lưu trong repo, ~20 MB): số POI hợp lý, không lỗi, `poi.pmtiles` sinh ra | Vitest + DuckDB |
| Tích hợp tiles | QA chủ quyền (4.3), validate style, đọc 20 tile ngẫu nhiên | script TS |
| Tích hợp API | Postgres docker `postgis/postgis` nạp fixture, `wrangler dev` + Miniflare; **2 fixture bắt buộc**: `q=Trường Tiểu học Hoàng Diệu&near=10.77,106.70` → ≥ 3 kết quả, trường Linh Xuân (10.85594, 106.77325) đứng đầu; `geocode?q=88/9 Nguyễn Lâm&near=10.76,106.66` → `precision=interpolated`, toạ độ cách (10.7647, 106.6631) ≤ 60 m | Vitest |
| E2E | playground tải bản đồ (mọi tile 200/204), gõ "highlands" có gợi ý ≤ 1 s, bấm POI hiện chi tiết, attribution hiện | Playwright |
| Cổng CI | lint, typecheck, unit, size-limit, style validate; pipeline weekly có QA riêng | GitHub Actions |

## 11. Vận hành và chi phí

- Triển khai API: `deploy-api.yml` khi `apps/api` đổi trên `main` (wrangler). Docs: `deploy-docs.yml` (Pages).
- Rollback tiles/POI: đổi alias KV về bản trước (lệnh `pnpm tiles:rollback`). Rollback API: `wrangler rollback`.
- Giám sát: Cloudflare Workers metrics (lỗi 5xx, p95), Supabase dashboard (CPU, kết nối), báo cáo tuần tự động từ Analytics Engine gửi email.
- Tên miền: `api.mapslibvn.com` và `docs.mapslibvn.com` (mua tên miền là việc tay của PHONG); trước khi có, dùng `*.workers.dev` và `*.pages.dev`.

| Quy mô | Tiles | Places API | Chi phí/tháng |
|---|---|---|---|
| MVP nội bộ (< 100K map-load) | Workers Free | Supabase Pro Micro | ≈ 25 USD |
| 1M map-load, ~20K DAU | Workers Paid 5 USD + ~10 USD | Supabase Pro Micro + cache Worker | ≈ 40 USD |
| ~150K DAU | ≈ 30 USD | Supabase compute Large ≈ 110 USD hoặc Meilisearch ≈ 20 USD | ≈ 150 USD |

Đối chiếu: Google Maps web Dynamic Maps ≈ 7.000 USD cho 1M map-load; Places Nearby Search 32 USD/1.000 lượt.

## 12. Pháp lý và giấy phép

### 12.1 Ma trận

Xem 3.2. Tất cả cho phép dùng thương mại. Nghĩa vụ: giữ notice BSD/MIT/Apache trong `THIRD_PARTY_NOTICES.md` đóng gói cùng SDK; ghi nguồn OSM/OpenMapTiles/Overture/Foursquare (12.3).

### 12.2 ODbL — mô hình Collective Database

Dữ liệu OSM nằm trong `src_osm_place` và các bảng dẫn xuất thuần OSM (`street`, `alley`, `admin_area`) — đây là Derivative Database của OSM và **được cung cấp theo ODbL khi có yêu cầu** (ta không phản đối: script `pnpm export:odbl` xuất các bảng này). Bảng `poi` chép trường từ đúng một nguồn và chỉ *liên kết* các nguồn bằng ID; `address_anchor` ghi rõ `source` từng dòng. Dữ liệu người dùng đóng góp (`created_by='user'`, các trường trong `locked_fields`) là dữ liệu riêng của MapsLibVN. Bản đồ và kết quả API là Produced Work: chỉ cần ghi nguồn. Việc tay: xác nhận cách đọc này với luật sư trước khi thương mại hoá.

### 12.3 Chuỗi ghi nguồn bắt buộc (trả từ `/v1/attribution`)

`© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Places: Overture Maps Foundation (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0)` — có link tới từng nguồn và tới trang giấy phép của MapsLibVN.

### 12.4 Pháp luật Việt Nam

- Luật Đo đạc và bản đồ 2018, Nghị định 18/2020/NĐ-CP: bản đồ phải thể hiện đúng chủ quyền — thiết kế 4.3 là biện pháp kỹ thuật; **việc tay**: hỏi luật sư về việc kinh doanh nền tảng bản đồ số có thuộc danh mục cần giấy phép hoạt động đo đạc và bản đồ (Điều 51) hay không, trước khi thu phí. Không chặn giai đoạn nội bộ.
- Nghị định 13/2023 (dữ liệu cá nhân): MapsLibVN không nhận dữ liệu định danh người dùng cuối; nghĩa vụ xin phép vị trí thuộc app nhúng (ghi trong điều khoản tenant).
- Nhãn hiệu: tên "MapsLibVN" cần rà soát với chính sách nhãn hiệu của MapLibre (tránh gây nhầm là sản phẩm chính thức); nếu bị phản đối, đổi tên gói trước khi phát hành npm công khai — tên gói chỉ là hằng số cấu hình trong monorepo.

### 12.5 Không dùng trong sản xuất

Nominatim công cộng và Overpass API chỉ dùng cho kiểm tra phát triển (chính sách sử dụng của OSMF); sản phẩm chạy hoàn toàn trên dữ liệu tự host.

## 13. Lộ trình và tiêu chí chấp nhận

| Mốc | Nội dung | Tiêu chí chấp nhận | Ước lượng |
|---|---|---|---|
| **M1** Bản đồ câm | monorepo, `pipelines/tiles` (patch + Planetiler + QA + R2), `packages/style`, Worker tiles/styles/assets, `@mapslibvn/core` (attribution) + `@mapslibvn/web` (createMap, UMD), playground | Trang playground hiện bản đồ VN nhãn tiếng Việt, theme sáng/tối; QA chủ quyền xanh; nhúng bằng `<script>` chạy trên trang HTML trắng; chạy trên `workers.dev` + `pages.dev` | 1–1,5 tuần |
| **M2** Kho POI | `db/migrations`, `pipelines/poi` (ingest 3 nguồn, chuẩn hoá, gộp, taxonomy, anchors/street/alley/admin), `poi.pmtiles`, lớp POI trong style | Pipeline chạy trong CI; ≥ 1,5 triệu `poi` active; POI hiện theo zoom; bấm POI thấy tên/loại từ tile; báo cáo số liệu gộp | 2 tuần |
| **M3** Places API | 7 endpoint đọc, ranking, geocode ladder, cache, key/quota cơ bản, `@mapslibvn/core` đầy đủ, `<mapslibvn-autocomplete>`, `@mapslibvn/react` | 2 fixture bắt buộc xanh; p95 autocomplete < 300 ms từ VN; quota 429 hoạt động; React demo | 2 tuần |
| **M4** Đóng góp | `POST /v1/edits`, luật auto-approve, `apps/admin`, áp dụng edit vào `poi`/anchor, pipeline tôn trọng `locked_fields` | Gửi sửa giờ mở cửa → auto-approve → thấy ngay qua API; tạo POI mới → pending → duyệt → có trong build kế tiếp | 1 tuần |
| **M5** Phát hành nội bộ | docs 5 phút, trang giấy phép/độ chính xác, seed key cho app kết bạn, báo cáo tuần, `THIRD_PARTY_NOTICES.md`, điều khoản tenant | App kết bạn nhúng được bằng key riêng; báo cáo sử dụng tuần đầu; checklist pháp lý ghi rõ việc tay còn lại | 1 tuần |

Tổng ≈ 7–8 tuần làm việc. Sau M5: spec React Native SDK.

## 14. Rủi ro và giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| `--bounds` toàn cầu của Planetiler không cho lớp thế giới đẹp | bản đồ ngoài VN trống | dự phòng Protomaps extract z0–6 (4.2), quyết định ở M1 |
| Dữ liệu Overture nhiễu (trùng, đóng cửa, lệch toạ độ) | POI sai làm mất tin | ngưỡng confidence, ưu tiên toạ độ OSM, quality_score, báo cáo người dùng, lớp POI chỉ hiện q ≥ 60 ở zoom trung |
| Chuỗi hẻm/đánh số bất quy tắc | geocode sai vị trí | luôn trả `precision`, không bao giờ giả `rooftop`; nội suy chỉ khi có mốc hai phía ≤ 400 m |
| Tên phường/quận cũ-mới sau 2025 | không khớp địa chỉ | `admin_alias` + fixture địa chỉ cũ |
| Supabase Micro nghẽn khi tăng DAU | autocomplete chậm | cache Worker, nâng compute, đường lên Meilisearch (8.3) |
| Dự án cá nhân/cộng đồng ngừng (Planetiler, PMTiles) | không build được | đều là mã mở, pin phiên bản trong repo, có thể fork |
| Tên MapsLibVN vướng nhãn hiệu MapLibre | phải đổi tên gói | tên là hằng số; rà soát trước khi publish npm |
| Điều 51 Luật ĐĐ&BĐ yêu cầu giấy phép khi kinh doanh | trì hoãn thương mại hoá | không chặn nội bộ; hỏi luật sư ở M5 |

## 15. Việc tay của PHONG (không chặn code)

1. Tạo Supabase project `mapslibvn` (Pro) và Cloudflare R2 bucket `mapslibvn-tiles`; cấp token cho GitHub Actions.
2. Mua tên miền `mapslibvn.com` (hoặc tên khác cùng thương hiệu).
3. Hỏi luật sư: Điều 51 Luật Đo đạc và bản đồ; cách đọc ODbL Collective Database (12.2); nhãn hiệu.
4. Sau M5: quyết định thời điểm mở cho developer ngoài.
