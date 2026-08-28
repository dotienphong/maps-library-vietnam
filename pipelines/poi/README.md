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
| Report | `node pipelines/poi/src/report.mjs` | `out/poi-report-*.json` |

Taxonomy (Task 6): 164 mã lá (12 nhóm + `other`), 955 dòng ánh xạ (OSM 296, Overture 380, FSQ 279).
Độ phủ đo trên dữ liệu VN thật: **thiếu ánh xạ** OSM 0,4 %, Overture 0,8 %, FSQ 0 % (ngưỡng 2 %).
Phần rơi vào `<nhóm>_other` **có chủ đích** (nhóm cha chung chung của nguồn, không thể chi tiết hơn):
OSM 7,5 %, Overture 23,1 %, FSQ 11,8 % — chủ yếu do Overture có `professional_services` (73.802) và
`shopping` (53.637). Sau khi dùng cả `categories.alternate`, Overture còn 24,6 % `other` ở mức bản ghi;
con số này sẽ giảm ở bảng `poi` sau gộp vì OSM phân loại chi tiết hơn (Task 7).

Bảng phụ do pipeline tạo: `vn_boundary` (ranh giới VN đệm 2 km), `poi_work_*` (Task 7–8).

Số liệu gộp toàn VN (28/08/2026): 1.897.933 records → 402.210 cặp → 1.522.368 cụm,
1.515.935 POI active; 3,3 % POI đa nguồn. Hai lần dựng lại toàn phần cho cùng
1.583.560 source links cùng hash `3096e40c592b99520f4586ab14af0839`. `category = 'other'` là chưa ánh xạ và có ngưỡng
fixture <10 %; `*_other` là nhánh cha chủ đích nên luôn báo cáo cùng `other` nhưng không phải cổng fail.
Tỷ lệ gộp toàn VN là 19,5 % (`other OR *_other`).

Fixture Quận 1: `pipelines/poi/fixtures/` (tạo lại bằng `scripts/make-fixture.mjs`). Ranh giới: `data/vn-boundary.geojson` (Natural Earth, public domain).

## admin_level thực tế trong OSM VN
(điền ở Task 8)
