# pipelines/poi — kho POI

Chạy trong image (`PIPE pipeline …`, xem plan M2). Mọi bước idempotent: tạo `<bảng>_new` → nạp → hoán đổi trong một transaction.

## Chạy trọn vòng

- `pnpm data:update --dry-run`: dò release OSM/Overture/FSQ và chỉ in kế hoạch.
- `pnpm data:update --poi [--force]`: ingest 3 nguồn → taxonomy → gộp → geocode →
  PMTiles/QA/upload/smoke/manifest/report. Ngoài máy chủ, lệnh mở Cloudflare Access
  Tunnel khi có `DB_TUNNEL_HOSTNAME` và `PIPELINE_DATABASE_URL`.
- `pnpm db:fixture`: nạp toàn pipeline fixture Quận 1 vào DB dev.
- `pnpm test:db`: tự tạo lại DB local cô lập `mapslibvn_task8_test`; không sửa DB dev
  `mapslibvn`. Cần image pipeline vì test dùng osmium/tippecanoe.

| Bước | Lệnh | Đầu vào → đầu ra |
|---|---|---|
| Ingest OSM | `node pipelines/poi/src/ingest/osm.mjs [--fixture]` | `work/vietnam-patched.osm.pbf` → `src_osm_place` |
| Ingest Overture | `node pipelines/poi/src/ingest/overture.mjs --release <ver>` | S3 parquet → `src_overture_place` |
| Ingest FSQ | `node pipelines/poi/src/ingest/fsq.mjs --release <dt>` | Hugging Face parquet (cần `HF_TOKEN`) → `src_fsq_place` |

Số liệu ingest thật toàn VN (Task 10, 31/08/2026): `src_osm_place` 228.255 raw,
124.476 record sau lọc; `src_overture_place`
1.501.161 (COPY 2.011.973 trong bbox, loại 510.812 ngoài ranh giới VN đệm 2 km; 3 phút 18 giây), `src_fsq_place`
272.349 (73 giây). File trung gian JSONL **nén gzip** — bản không nén (3–4 GB) đã làm đầy đĩa dev một lần.

| Taxonomy | `node pipelines/poi/src/taxonomy.mjs load` | `db/seed/category*.{json,csv}` → `category`, `category_map` |
| Đo độ phủ loại | `node pipelines/poi/scripts/category-coverage.mjs [--top 200]` | `src_*` → báo cáo % thiếu ánh xạ / `*_other` chủ đích |
| Records | `node pipelines/poi/src/records.mjs` | `src_*` → `poi_work_record` |
| Conflate | `node pipelines/poi/src/conflate.mjs` | `poi_work_record` → `poi_work_pair`, `poi_work_cluster`, `poi_work_cluster_meta` |
| Publish | `node pipelines/poi/src/publish.mjs [--force]` | gộp vào `poi`, `poi_source_link`; sanity giảm active tối đa 10 % |
| Trích đường/ranh giới | `node pipelines/poi/src/geocode/osm-roads.mjs [--fixture]` | PBF đã patch → `osm_road_raw`, `osm_admin_raw` |
| Hành chính | `node pipelines/poi/src/geocode/admin.mjs` | raw OSM + seed alias 2025 → `admin_area`, `admin_alias` |
| Đường/hẻm | `node pipelines/poi/src/geocode/streets.mjs && node pipelines/poi/src/geocode/alleys.mjs` | raw road → `street`, `alley` + parent/entrance |
| Mốc địa chỉ | `node pipelines/poi/src/geocode/anchors.mjs` | `src_osm_place` + `poi_work_record` → `address_anchor` |
| Report | `node pipelines/poi/src/report.mjs` | `out/poi-report-*.json` |

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

Taxonomy (Task 6): 164 mã lá (12 nhóm + `other`), 955 dòng ánh xạ (OSM 296, Overture 380, FSQ 279).
Độ phủ đo trên dữ liệu VN thật: **thiếu ánh xạ** OSM 0,4 %, Overture 0,8 %, FSQ 0 % (ngưỡng 2 %).
Phần rơi vào `<nhóm>_other` **có chủ đích** (nhóm cha chung chung của nguồn, không thể chi tiết hơn):
OSM 7,5 %, Overture 23,1 %, FSQ 11,8 % — chủ yếu do Overture có `professional_services` (73.802) và
`shopping` (53.637). Sau khi dùng cả `categories.alternate`, Overture còn 24,6 % `other` ở mức bản ghi;
con số này sẽ giảm ở bảng `poi` sau gộp vì OSM phân loại chi tiết hơn (Task 7).

Bảng phụ do pipeline tạo: `vn_boundary` (ranh giới VN đệm 2 km), `poi_work_*` (Task 7–8).

Số liệu gộp live Task 10: 1.897.986 records → 402.242 cặp → 1.522.416 cụm,
1.515.983 POI active; 50.868 POI đa nguồn (3,3 %), 1.583.616 source links.
`category = 'other'` là chưa ánh xạ và có ngưỡng
fixture <10 %; `*_other` là nhánh cha chủ đích, được báo cáo riêng và không phải cổng fail.
Tỷ lệ combined là 19,6 % (`other OR *_other`; 297.823 POI).

Fixture Quận 1: `pipelines/poi/fixtures/` (tạo lại bằng `scripts/make-fixture.mjs`). Ranh giới: `data/vn-boundary.geojson` (Natural Earth, public domain).

## admin_level thực tế trong OSM VN

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
alias `ninh thuan → Khánh Hòa` chưa nạp được. Mọi L6/L8 phát hành phải nằm trong một L4
Việt Nam hiện hành; `admin_area` cuối có L8=3.255 và `admin_alias`
có 33 khóa distinct từ seed 2025. Alias phường/xã mới chỉ có ví dụ spec Diên Hồng; cần
biên soạn đầy đủ từ các nghị quyết UBTVQH 2025.

Số liệu geocode live Task 10: 215.872 way đường có tên → **61.154 street**; **58.479 alley**,
52.499 có đường mẹ và entrance; **923.567
address_anchor**, trong đó Nguyễn Lâm 174. Parent theo tên/chạm dùng geometry GiST prefilter
rồi geography exact ≤300/15 m. Anchor gộp connected-components theo geography exact ≤30 m
đến khi hội tụ, ưu tiên source theo confidence; không còn cặp trùng, street mang tên hẻm số,
hay bảng staging (`*_new`, raw/edge/merge).
