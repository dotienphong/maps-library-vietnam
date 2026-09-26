# pipelines/poi — kho POI

Chạy trong image (`PIPE pipeline …`, xem plan M2). Mọi bước idempotent: tạo `<bảng>_new` → nạp → hoán đổi trong một transaction.

## Chạy trọn vòng

- `pnpm data:update --dry-run`: dò release OSM/FSQ và chỉ in kế hoạch.
- `pnpm data:update --poi [--force]`: ingest 2 nguồn → taxonomy → gộp → geocode →
  PMTiles/QA/upload/smoke/manifest/report. Ngoài máy chủ, lệnh mở Cloudflare Access
  Tunnel khi có `DB_TUNNEL_HOSTNAME` và `PIPELINE_DATABASE_URL`.
- `pnpm db:fixture`: nạp toàn pipeline fixture Quận 1 vào DB dev.
- `pnpm test:db`: tự chạy trong image pipeline rồi tạo lại DB local cô lập
  `mapslibvn_task8_test`; không sửa DB dev `mapslibvn`. Image cung cấp osmium/tippecanoe.

| Bước | Lệnh | Đầu vào → đầu ra |
|---|---|---|
| Ingest OSM | `node pipelines/poi/src/ingest/osm.mjs [--fixture]` | `work/vietnam-patched.osm.pbf` → `src_osm_place` |
| Ingest FSQ | `node pipelines/poi/src/ingest/fsq.mjs --release <dt>` | Hugging Face parquet (cần `HF_TOKEN`) → `src_fsq_place` |

**Overture đã gỡ 13/09/2026** (plan `docs/superpowers/plans/2026-09-13-go-bo-overture.md`); các số liệu Task 10 dưới đây là lịch sử khi còn ba nguồn.

Số liệu ingest thật toàn VN (Task 10, 31/08/2026): `src_osm_place` 228.255 raw,
124.476 record sau lọc; `src_overture_place`
1.501.161 (COPY 2.011.973 trong bbox, loại 510.812 ngoài ranh giới VN đệm 2 km; 3 phút 18 giây), `src_fsq_place`
272.349 (73 giây). File trung gian JSONL **nén gzip** — bản không nén (3–4 GB) đã làm đầy đĩa dev một lần.

| Taxonomy | `node pipelines/poi/src/taxonomy.mjs load` | `db/seed/category*.{json,csv}` → `category`, `category_map` |
| Đo độ phủ loại | `node pipelines/poi/scripts/category-coverage.mjs [--top 200]` | `src_*` → báo cáo % thiếu ánh xạ / `*_other` chủ đích |
| Records | `node pipelines/poi/src/records.mjs` | `src_*` → `poi_work_record` |
| Conflate | `node pipelines/poi/src/conflate.mjs` | `poi_work_record` → `poi_work_pair`, `poi_work_cluster`, `poi_work_cluster_meta` |
| Publish | `node pipelines/poi/src/publish.mjs [--force]` | gộp vào `poi`, `poi_source_link`; sanity giảm active tối đa 10 % |
| Trích đường/ranh giới | `node pipelines/poi/src/geocode/osm-roads.mjs [--fixture]` | PBF đã patch → `osm_road_raw` (kèm `name_alt` từ `old_name`/`alt_name`/`short_name`/`name:vi`/`official_name`), `osm_admin_raw` |
| Hành chính | `node pipelines/poi/src/geocode/admin.mjs [--fixture]` | current raw + snapshot 250101 + seed/tag → publish nguyên tử `admin_area`, `admin_area_old`, `admin_alias`; QA ở `out/admin-alias/report.json` |
| POI ↔ hành chính hiện hành | `node pipelines/poi/src/geocode/poi-admin.mjs` | `admin_area` cấp 8/4 chứa `poi.geom` → `poi.admin_ward`, `poi.admin_province` (chỉ ghi dòng đổi; không đụng `ward`/`province` nguồn; API đọc `coalesce(admin_x, x)`) |
| Chỉ dựng lại alias cũ | `node pipelines/poi/src/geocode/admin-old.mjs [--fixture]` | giữ current đã publish; thay nguyên tử old + alias dưới cùng advisory lock |
| Đường/hẻm | `node pipelines/poi/src/geocode/streets.mjs && node pipelines/poi/src/geocode/alleys.mjs` | raw road → `street` (kèm `name_alt`, `name_key`, `name_alt_norm`, `name_tsv`), `alley` + parent/entrance |
| Mốc địa chỉ | `node pipelines/poi/src/geocode/anchors.mjs` | `src_osm_place` + `poi_work_record` → `address_anchor` |
| Report | `node pipelines/poi/src/report.mjs` | `out/poi-report-*.json` |

## Backfill cột tìm kiếm

Migration `0009_search_keys.sql` thêm `name_key`, `name_alt_norm`, `name_tsv` (`poi`, `street`),
`name_key` (`admin_area`, `admin_area_old`) và `alias_key` (`admin_alias`). Pipeline điền chúng từ
lần chạy kế tiếp, nhưng dữ liệu **đã publish** vẫn NULL cho tới lúc đó — API chịu được NULL (không
5xx, chỉ là không khớp), nên không phải chạy gấp, nhưng muốn có ngay thì:

```bash
node scripts/backfill-search-keys.mjs            # chỉ điền dòng còn NULL, idempotent
node scripts/backfill-search-keys.mjs --all      # tính lại toàn bộ (sau khi đổi bảng luật viKey)
node scripts/backfill-search-keys.mjs --table street
```

Script từ chối chạy nếu `schema_migrations` chưa tới `0009_search_keys.sql`. Chạy trong container
`pipeline` (role `pipeline` có `UPDATE`). Giá trị sinh ra bằng đúng `searchKeys()` của
`@mapslibvn/core` — cùng một định nghĩa với pipeline, nên hai đường không thể lệch nhau.

## Hiển thị POI tăng dần theo zoom

Exporter sắp POI theo `category.rank` trước, rồi `popularity`, `quality_score` và MD5 của ID để
kết quả xác định giữa các lần build. Tile chỉ mang các thuộc tính công khai `id`, `name`, `cat`,
`grp`, `q`, `r`, `d`; `popularity` chỉ dùng nội bộ để xếp hạng và không được xuất ra PMTiles.

| `r` | Zoom sớm nhất |
|---:|---:|
| 1 | 10 |
| 2 | 12 |
| 3 | 13 |
| 4 | 14 |
| 5 hoặc rank lỗi | 15 |

Mỗi ứng viên chỉ được nhận nếu ô Web Mercator của nó còn trống ở zoom nhận **và mọi zoom cao hơn**.
Khoảng cách ô dùng cho z10→z16 lần lượt là `160, 160, 144, 128, 112, 96, 80` pixel. Nhờ vậy một
POI đã xuất hiện không biến mất khi zoom vào và mật độ không tạo dải dày tại biên tile.

Exporter in một dòng JSON gồm `activeRead`, `selected`, `thinned`, `byMinZoom`, `rankFallback` và
`invalidCoordinates`. Có tọa độ lỗi thì job dừng trước Tippecanoe. POI bị `thinned` chỉ bị ẩn khỏi
nền bản đồ; bản ghi `poi.status='active'` vẫn nguyên và vẫn tìm được qua Search/Nearby.

Taxonomy (Task 6): 164 mã lá (12 nhóm + `other`), 2 CSV ánh xạ (OSM 296, FSQ 279). Từ 26/09/2026:
182 mã (13 nhóm + `other`, thêm nhóm `place`), OSM 332 dòng — xem mục "Làm giàu 26/09/2026" dưới đây.
Độ phủ đo trên dữ liệu VN thật: **thiếu ánh xạ** OSM 0,4 %, FSQ 0 % (ngưỡng 2 %).
Phần rơi vào `<nhóm>_other` **có chủ đích** (nhóm cha chung chung của nguồn, không thể chi tiết hơn):
OSM 7,5 %, FSQ 11,8 %; con số này giảm ở bảng `poi` sau gộp vì OSM phân loại chi tiết hơn (Task 7).

Bảng phụ do pipeline tạo: `vn_boundary` (ranh giới VN đệm 2 km), `poi_work_*` (Task 7–8).

Số liệu gộp live Task 10: 1.897.986 records → 402.242 cặp → 1.522.416 cụm,
1.515.983 POI active; 50.868 POI đa nguồn (3,3 %), 1.583.616 source links.
`category = 'other'` là chưa ánh xạ và có ngưỡng
fixture <10 %; `*_other` là nhánh cha chủ đích, được báo cáo riêng và không phải cổng fail.
Tỷ lệ combined là 19,6 % (`other OR *_other`; 297.823 POI).

Fixture Quận 1: `pipelines/poi/fixtures/` (tạo lại bằng `scripts/make-fixture.mjs`). Ranh giới: `data/vn-boundary.geojson` (Natural Earth, public domain).

## admin_level thực tế trong OSM VN — baseline trước hệ alias cũ/mới

Đo ngày 29/08/2026 trên `vietnam-patched.osm.pbf` 313 MB. Đây là số relation **raw**;
schema MapsLibVN chỉ phát hành đơn vị hành chính Việt Nam còn hiệu lực.

| `admin_level` raw | Số relation | Cách dùng |
|---:|---:|---|
| 0 | 1 | bỏ (ranh giới quốc gia) |
| 3 | 7 | bỏ |
| 4 | 39 | lọc 6 ranh giới tỉnh cũ; phát hành 33 tỉnh/thành hiện có |
| 6 | 3.322 | OSM 2025 dùng cho phường/xã/thị trấn/đặc khu mới; map sang semantic level 8 |
| 8 | 565 | ranh giới cấp xã cũ đã bị level 6 mới bao phủ hoặc relation biên giới; không phát hành trùng |
| 9 | 5.139 | khu phố/thôn, ngoài scope Task 8 |

OSM hiện thiếu relation level 4 của **Khánh Hòa**, nên `admin_area` có L4=33 thay vì 34 và
alias `ninh thuan → Khánh Hòa` chưa nạp được ở baseline này. Mọi L6/L8 phát hành phải nằm trong một L4
Việt Nam hiện hành; `admin_area` cuối có L8=3.255 và `admin_alias`
có 33 khóa distinct từ seed 2025. Alias phường/xã mới chỉ có ví dụ spec Diên Hồng; cần
biên soạn đầy đủ từ các nghị quyết UBTVQH 2025. Task alias mới giữ khoảng thiếu này trong
`admin-old-source.json`; job toàn quốc dừng trước publish nếu QA còn unmatched, overlap, geometry
không sửa được hoặc seed không tìm thấy đích. Fixture Quận 1 hiện dựng 54 vùng cũ và khoảng 300
cạnh alias; đây chỉ là kiểm tích hợp, không phải bằng chứng độ phủ toàn quốc.

### Nguồn, seed override và report

- **Manifest nguồn** `pipelines/poi/fixtures/admin-old-source.json`: URL, `md5`/`sha256`/`bytes` của
  snapshot `vietnam-250101.osm.pbf`, `osmTimestamp` lấy từ `osmium fileinfo`, `targetValidUntil`,
  và `issues[]` là ledger khoảng thiếu (`resolution: null` nghĩa là chưa giải quyết). Downloader
  kiểm `sha256` trước khi dùng và không ghi đè file tốt khi tải lỗi.
- **Seed override** `db/seed/admin_alias_2025.csv`: bốn cột cũ vẫn chạy, thêm ba cột tuỳ chọn
  `share,source_url,source_clause`. Seed nạp **sau** overlay và thay **cả tập cạnh** của nhóm
  cùng khóa + cấp, nên dùng nó để sửa hẳn một vùng thay vì chèn thêm cạnh lẻ. Nhóm nào không tìm
  được đích thì vào `seedMisses` và **không** xoá nhóm overlay đang đúng.
- **Report** `out/admin-alias/report.json`: `countsByLevel`, `countsBySource`, `coverage` (mỗi vùng
  cũ có `rawCoverage`/`keptCoverage`/`discardedShare`/`targets`), `unmatched`, `coverageGaps`
  (<0,95), `overlapErrors` (>1,01), `splits`, `seedMisses`, `ambiguousKeys`, `invalidGeometries`,
  và `osmTagSource`.
- **Thiếu bảng raw**: nguồn alias `source=osm_tag` cần `osm_admin_raw`, mà bảng này chỉ tồn tại sau
  khi `osm-roads.mjs` chạy. Chạy `admin-old.mjs` độc lập trên DB chỉ có bảng đã publish thì pipeline
  **bỏ** nguồn osm_tag, in cảnh báo và ghi `osmTagSource: {available:false, reason}` — không dừng và
  không bỏ lặng lẽ. Muốn có alias osm_tag thì chạy `osm-roads.mjs` trước, hoặc dùng `admin.mjs`.
- **Lỗi coverage**: job toàn quốc `throw` với thông điệp dạng
  `QA alias hành chính đỏ: invalid=…, unmatched=…, overlap=…, seed_miss=…` **sau** khi đã ghi
  report, và dọn sạch bảng staging. Đọc report để biết vùng nào, đừng chạy lại mù.

Số liệu geocode live Task 10: 215.872 way đường có tên → **61.154 street**; **58.479 alley**,
52.499 có đường mẹ và entrance; **923.567
address_anchor**, trong đó Nguyễn Lâm 174. Parent theo tên/chạm dùng geometry GiST prefilter
rồi geography exact ≤300/15 m. Anchor gộp connected-components theo geography exact ≤30 m
đến khi hội tụ, ưu tiên source theo confidence; không còn cặp trùng, street mang tên hẻm số,
hay bảng staging (`*_new`, raw/edge/merge).

## Làm giàu 26/09/2026 (plan `docs/superpowers/plans/2026-09-26-lam-giau-poi-lam-ngay.md`)

- **Khoá OSM mở rộng** (`ingest/osm.mjs`, `taxonomy.mjs` `STRICT_OSM_KEYS`): natural, waterway, place,
  landuse, man_made, barrier, highway, junction — chỉ giá trị có dòng trong `category_map_osm.csv`
  mới thành POI; giá trị lạ (place=town/suburb, landuse=military…) không rơi về `other`. Ingest bỏ
  đối tượng chỉ mang khoá mở rộng mà không có tag tên. Luật chặn ở `lib/osm-extended.mjs`: quân sự,
  ngoài mọi xã/phường hiện hành, tên CJK, tên "Thôn 3/Khu phố 4", place trùng tên xã/phường chứa nó,
  junction không khớp mẫu tên. `records.mjs` gom bản ghi OSM cùng tên + cùng mã trong 1 km và cho bản
  ghi mở rộng nhường POI OSM cũ cùng tên (`dedupeSameName`). Nhóm `place` và lake/river/island/junction
  không vào POI tiles (`tileVisibleSql`).
- **Tên OSM** (`lib/osm-names.mjs`, `lib/vn-banks.mjs`): tên thay thế thêm name:vi/short_name/loc_name/
  int_name, tách `;`; tên dự phòng name:vi → name:en → brand (→ operator cho cây xăng/ngân hàng); ATM
  qua bảng ngân hàng; POI không tên loại `*_other` bị bỏ; email tên miền riêng vào `contact.email`.
- **FSQ** (`lib/fsq-flags.mjs`, migration 0025): lưu `date_created`, `date_refreshed`,
  `unresolved_flags`; bỏ bản ghi doesnt_exist/delete/inappropriate/privatevenue; cờ `closed` →
  `closed_reported`, chỉ đóng cụm khi mọi thành viên đều đóng/bị báo đóng (`clusterClosed`).
- **Report**: `byProvince` (tỉnh hiện hành × nhóm × nguồn).

