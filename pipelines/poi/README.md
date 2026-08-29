# pipelines/poi — kho POI

Chạy trong image (`PIPE pipeline …`, xem plan M2). Mọi bước idempotent: tạo `<bảng>_new` → nạp → hoán đổi trong một transaction.

| Bước | Lệnh | Đầu vào → đầu ra |
|---|---|---|
| Ingest OSM | `node pipelines/poi/src/ingest/osm.mjs [--fixture]` | `work/vietnam-patched.osm.pbf` → `src_osm_place` |
| Ingest Overture | `node pipelines/poi/src/ingest/overture.mjs --release <ver>` | S3 parquet → `src_overture_place` |
| Ingest FSQ | `node pipelines/poi/src/ingest/fsq.mjs --release <dt>` | Hugging Face parquet (cần `HF_TOKEN`) → `src_fsq_place` |

Số liệu ingest thật toàn VN (27–28/08/2026, DB dev): `src_osm_place` 228.144 (10,5 giây), `src_overture_place`
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

Taxonomy (Task 6): 164 mã lá (12 nhóm + `other`), 955 dòng ánh xạ (OSM 296, Overture 380, FSQ 279).
Độ phủ đo trên dữ liệu VN thật: **thiếu ánh xạ** OSM 0,4 %, Overture 0,8 %, FSQ 0 % (ngưỡng 2 %).
Phần rơi vào `<nhóm>_other` **có chủ đích** (nhóm cha chung chung của nguồn, không thể chi tiết hơn):
OSM 7,5 %, Overture 23,1 %, FSQ 11,8 % — chủ yếu do Overture có `professional_services` (73.802) và
`shopping` (53.637). Sau khi dùng cả `categories.alternate`, Overture còn 24,6 % `other` ở mức bản ghi;
con số này sẽ giảm ở bảng `poi` sau gộp vì OSM phân loại chi tiết hơn (Task 7).

Bảng phụ do pipeline tạo: `vn_boundary` (ranh giới VN đệm 2 km), `poi_work_*` (Task 7–8).

Số liệu gộp toàn VN (28/08/2026, final Task 7): 1.897.933 records → 402.210 cặp → 1.522.371 cụm,
1.515.938 POI active; 3,3 % POI đa nguồn. Hai lần dựng lại toàn phần cho cùng
1.583.562 source links cùng hash `1434f2acaaa69fd3eee74a9dbdda47a2`. `category = 'other'` là chưa ánh xạ và có ngưỡng
fixture <10 %; `*_other` là nhánh cha chủ đích, được báo cáo riêng và không phải cổng fail.
Tỷ lệ combined là 19,6 % (`other OR *_other`; bare 8,4 %, mapped `*_other` 11,1 %).

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
alias `ninh thuan → Khánh Hòa` chưa nạp được. `admin_area` cuối có L8=3.319; `admin_alias`
có 33 khóa distinct từ seed 2025. Alias phường/xã mới chỉ có ví dụ spec Diên Hồng; cần
biên soạn đầy đủ từ các nghị quyết UBTVQH 2025.

Số liệu geocode toàn VN: 215.360 way đường có tên → **61.031 street**; **58.388 alley**,
52.789 (90,41 %) có đường mẹ và entrance, 0 entrance xa đường mẹ quá 1 m; **918.416
address_anchor**, trong đó Nguyễn Lâm 171. Kiểm exact `(số nhà, đường, khoảng cách ≤ 30 m)`
không còn cặp trùng; không còn street mang tên hẻm số và không còn bảng `_new`.
