# Gỡ hoàn toàn nguồn POI Overture — biên bản thực thi

Ngày: 13/09/2026 (Asia/Ho_Chi_Minh). Plan: `docs/superpowers/plans/2026-09-13-go-bo-overture.md`.
Quyết định của PHONG: "remove toàn bộ data POI từ overture ra khỏi hệ thống, remove database, tất cả các
nơi sử dụng nó, kể cả docs, playground, react-native".

## 1. Lý do (đo production sáng 13/09, chỉ đọc)

- `src_overture_place` Việt Nam: 99,2 % bản ghi có dataset `meta` (trang Facebook), Microsoft 0,5 %.
- 39.438 POI Overture (3,4 %) nằm ở toạ độ có ≥ 5 POI khác; 519 POI ở đúng điểm 21,0333/105,85 (tâm
  Hà Nội), 282 ở 10,7694/106,682 (tâm TP.HCM). Bản ghi thô tại đó có địa chỉ ở quận khác: Meta
  geocode thất bại rơi về tâm thành phố. FSQ 0,4 %, OSM 0.
- Sai tỉnh so với địa chỉ của chính POI: Overture 1,39 %, FSQ 0,76 %, OSM 0,27 %.
- Trùng lặp liên nguồn tại 3 lõi đô thị: 1.526 cặp fsq+overture cùng tên ≤ 50 m không được gộp
  (khác nhóm category 433, chặn số nhà 580, chặn tên đường 502); Overture tự trùng chỉ 2 cặp.
- `confidence` không phân biệt được nhóm chồng tâm thành phố (0,631 so với 0,690 toàn bộ).

## 2. Trạng thái TRƯỚC

| Bảng / khoá | Giá trị |
|---|---|
| `poi` active theo `primary_source` | overture 1.173.922 · fsq 235.813 · osm 106.248 · user 1 |
| `poi` closed | overture 360 · fsq 5.996 · osm 77 |
| `poi_source_link` source=overture | primary 1.174.282 · secondary 12.509 |
| `address_anchor` source=overture | 780.316 |
| `category_map` source=overture | 380 |
| `src_overture_place` | 1.501.161 dòng, 2.002 MB |
| Manifest KV `release:current` | `vn-20260827`, `poi-20260904`, `poiProfiles` {osm: poi-osm-20260907, overture-fsq: poi-overture-fsq-20260909-074253-c3f26595, overture: poi-overture-20260909-074253-c3f26595, fsq: poi-fsq-20260909-074253-c3f26595, osm-fsq: poi-osm-fsq-20260909-105543-b198022f} |
| Archive POI trên `r2:mapslibvn-tiles/tiles/` | poi-20260830, poi-20260904, poi-fsq-2026…c3f26595, poi-osm-20260907, poi-osm-fsq-2026…b198022f, poi-overture-2026…c3f26595, poi-overture-fsq-2026…c3f26595 (+ `.sha256` trừ poi-20260830) |
| Backup gần nhất | `mapslibvn-20260913-0300.dump.zst.enc` 904 MB → `r2:mapslibvn-backups/backups/daily` |

## 3. Code (đã push `origin/main`)

| Commit | Nội dung |
|---|---|
| `b00dff5` | core: registry `osm`/`fsq`, profile `all`/`osm`/`fsq`, attribution bỏ Overture, `PlaceSource.source: PoiSource`, 0.7.0 |
| `0c4399d` | SDK web/react/react-native: test, README, 0.7.0 |
| `a39740d` | API: `sources chỉ nhận osm,fsq,all`; fixture DB test hai nguồn (kèm 5 file xoá của pipeline bị cuốn theo index) |
| `0c06b8f` | Docs site + Playground: ba profile, chuỗi ghi nguồn mới |
| `aa3276b` | Pipeline: bỏ ingest/records/taxonomy Overture, conflate hai nguồn |
| `7c3ef9a` | Migration 0013, scripts dò nguồn/state/manifest/rollback lọc theo registry, notices, legal |

Chuỗi ghi nguồn mới: `© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Foursquare OS Places (Apache-2.0)`.

Cổng trước khi push: Biome 456 file sạch; typecheck 14/14; vitest gốc 127 file / 1.297 test (3 skipped);
API 34 file / 249 test; API-DB (Wrangler + Postgres cô lập, migration tới 0013) 3 file / 53 test.

## 4. Production — các bước đã chạy

1. Backup thủ công trước khi phá: `mapslibvn-20260913-0723.dump.zst.enc` (904 MB) → `r2:mapslibvn-backups/backups/daily`.
2. `pnpm image:build` rồi `docker compose … up -d --force-recreate pipeline backup`.
3. Migration `0013_drop_overture.sql` áp dụng bằng superuser (`db-migrate.mjs`).
4. `data:update --poi --force --skip-routing` (nền, container `pipeline`) — **thất bại 2 lần** vì một
   lỗi quyền sở hữu bảng không liên quan Overture (mục 4.1), sau đó **thành công lần 3** sau khi bỏ
   qua một cổng QA hành chính không liên quan Overture (mục 4.2, có duyệt của PHONG).

### 4.1 Sự cố ngoài kế hoạch: quyền sở hữu bảng thô geocode

`osm_road_raw`, `osm_admin_raw`, `osm_admin_old_raw` bị thuộc sở hữu role `mapslibvn` (superuser) thay
vì `pipeline` — dấu vết của một lần phục hồi DB trước đây (`pg_dump`/`pg_restore` dùng
`--no-owner`, và `scripts/lib/db-permissions.mjs` — kịch bản reconcile quyền sau restore — bỏ sót ba
bảng thô này khỏi danh sách `ALTER TABLE … OWNER TO pipeline`). Không liên quan gì tới việc gỡ
Overture; lộ ra vì đây là lần đầu geocode chạy lại đầy đủ sau một lần phục hồi DB nào đó.

Hệ quả: `publish.mjs` đã ghi đè `poi` production (376.468 active, chỉ osm+fsq) rồi `osm-roads.mjs`
mới chết ở `DROP TABLE osm_road_raw` vì thiếu quyền — dừng pipeline giữa chừng, để `poi` production
ở trạng thái mới nhưng tile/manifest/street/alley/anchor vẫn cũ trong một khoảng thời gian ngắn.

Đã sửa: thêm ba dòng `ALTER TABLE … OWNER TO pipeline` vào `PERMISSIONS_SQL`
(commit `d4d15cb`, `b5081cc`), áp trực tiếp lên production bằng superuser, rà toàn bộ 25 bảng + 8
sequence trong `public` để xác nhận không còn bảng nào khác sai chủ.

### 4.2 Quyết định sản phẩm: bỏ qua QA alias hành chính Cô Tô cho lần chạy này

`admin.mjs` (dựng lại `admin_area`/`admin_area_old`/`admin_alias`) chặn với
`QA alias hành chính đỏ: unmatched=2` — hai đơn vị **Xã Thanh Lân** và **Thị trấn Cô Tô** (huyện đảo
Cô Tô, Quảng Ninh, snapshot 2025-06-30) không tìm được ranh giới OSM hiện tại khớp đủ. Xác minh: đây
là vấn đề dữ liệu ranh giới OSM cho một huyện đảo, hoàn toàn không liên quan Overture/FSQ/OSM POI.

PHONG quyết (hỏi qua AskUserQuestion 13/09): **bỏ qua `admin.mjs` cho lần chạy này**, xử lý Cô Tô
riêng sau. Thực hiện: tạm comment dòng gọi `admin.mjs` trong bản sao `data-update.mjs` **bên trong
container đang chạy** (không sửa repo/image), chạy lại toàn bộ, phục hồi nguyên bản ngay sau khi
xong. `streets.mjs`/`anchors.mjs` chỉ đọc `admin_area` (bảng live, không đổi vì `admin.mjs` chưa kịp
publish) nên không bị ảnh hưởng — chỉ hơi cũ hơn khoảng một tuần.

**Việc còn treo, cần xử lý riêng:** `admin_area`/`admin_area_old`/`admin_alias` KHÔNG được rebuild
trong lần này, vẫn giữ dữ liệu từ lần thành công gần nhất trước 13/09. Cron `data:update` tự động
thứ Hai 02:00 VN **sẽ gặp lại đúng lỗi này** cho tới khi có seed override hoặc sửa dữ liệu OSM cho Cô
Tô — cần xử lý trước khi cron chạy, nếu không cron sẽ dừng giữa chừng ở đúng điểm này (nhưng an toàn:
publish `poi` xong mới dừng, không hỏng dữ liệu).

## 5. Trạng thái SAU

Chạy `data:update --poi --force --skip-routing` lần 4 (bỏ qua `admin.mjs`) thành công, 15 phút
(exit 0). Số liệu:

| Bước | Kết quả |
|---|---|
| `src_osm_place` | 229.903 dòng (release 2026-09-13, OSM mới hơn — Geofabrik cập nhật) |
| `src_fsq_place` | 272.349 dòng (release 2026-08-11, không đổi) |
| `category_map` | 575 dòng (OSM 296 + FSQ 279, không còn Overture) |
| `poi_work_record` | 397.096 dòng (fsq 272.349, osm 124.747) |
| Gộp | 382.900 cụm (8.763 đa nguồn = 2,3 %), 14.196 bản ghi phụ |
| `poi` active | **376.468** (osm 117.893, fsq 258.574, user 1) — từ 1.515.983 trước đó |
| `street` / `alley` / `address_anchor` | 61.378 / 58.663 / 145.817 |
| Release | `poi-20260913-101907-c4f8a1f9` (+ `-osm-`, `-fsq-` cùng buildId) |
| Manifest `poiProfiles` | `{"osm": "…", "fsq": "…"}` — không còn `overture`/`overture-fsq`/`osm-fsq` |

R2 đã xoá: `poi-20260830` (mồ côi, không còn trong `release:history`), hai archive `overture`/
`overture-fsq` và một archive `osm-fsq` (profile đã bỏ khỏi registry). **Giữ lại** `poi-20260904`,
`poi-osm-20260907`, `poi-fsq-20260909-074253-c3f26595` vì vẫn được `release:history` (3 bản gần nhất)
tham chiếu cho rollback; sẽ tự đủ điều kiện xoá khi lịch sử trôi qua.

Kiểm production sau khi xong:

| Kiểm tra | Kết quả |
|---|---|
| `GET /v1/attribution` | `© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Foursquare OS Places (Apache-2.0)` |
| `/v1/styles/light.json` (mặc định, `?sources=osm`, `?sources=fsq`, `?sources=osm,fsq`) | HTTP 200, `x-poi-profile` đúng `all`/`osm`/`fsq`/`all`, trỏ đúng archive `…-101907-c4f8a1f9` |
| `/v1/styles/light.json?sources=overture` | HTTP 400 `invalid_request` |
| `/healthz/db` | `schema_migration: "0013_drop_overture.sql"` |
| `poi` theo `primary_source` | chỉ `osm`, `fsq`, NULL (user) — không còn `overture` |
| `to_regclass('src_overture_place')` | NULL — bảng đã xoá hẳn |
| Playground production | 3 lựa chọn nguồn (Tất cả, OSM, Foursquare), không còn nhắc Overture |

Container `pipeline` đã phục hồi `scripts/data-update.mjs` về đúng bản gốc (khớp lại image/repo) sau
khi rebuild thành công — không còn sửa tạm nào tồn tại.

## 6. Việc để sau

- **Cấp bách — hạn thứ Hai 02:00 VN:** QA alias hành chính Cô Tô (mục 4.2) cần seed override hoặc sửa
  dữ liệu OSM trước khi cron `data:update` tự động chạy lại, nếu không cron sẽ dừng giữa chừng ở đúng
  điểm `admin.mjs` mỗi tuần (an toàn — dừng sau khi `poi` đã publish, không hỏng dữ liệu — nhưng
  street/alley/anchor/tiles sẽ không được refresh cho tới khi giải quyết).
- Publish npm `@mapslibvn/{core,web,react,react-native}@0.7.0` — PHONG quyết (kiểu `PoiSource` hẹp lại là breaking với người tích hợp đang truyền `'overture'`).
- Sửa `pairAllowed` để gộp FSQ↔OSM (khác nhóm category, chặn số nhà/tên đường) — `docs/evidence/conflate/2026-09-07-dieu-tra-multisource-3-3.md` mục 10.
- Tên CJK/emoji → `name_norm` rỗng (1.986 POI FSQ, 196 OSM) không gộp và không tìm được.
- `poi-20260904`, `poi-osm-20260907`, `poi-fsq-20260909-074253-c3f26595` trên R2: xoá khi
  `release:history` không còn tham chiếu (kiểm bằng `manifest.mjs get`).
