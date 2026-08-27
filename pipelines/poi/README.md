# pipelines/poi — kho POI

Chạy trong image (`PIPE pipeline …`, xem plan M2). Mọi bước idempotent: tạo `<bảng>_new` → nạp → hoán đổi trong một transaction.

| Bước | Lệnh | Đầu vào → đầu ra |
|---|---|---|
| Ingest OSM | `node pipelines/poi/src/ingest/osm.mjs [--fixture]` | `work/vietnam-patched.osm.pbf` → `src_osm_place` |
| Ingest Overture | `node pipelines/poi/src/ingest/overture.mjs --release <ver>` | S3 parquet → `src_overture_place` |
| Ingest FSQ | `node pipelines/poi/src/ingest/fsq.mjs --release <dt>` | Hugging Face parquet (cần `HF_TOKEN`) → `src_fsq_place` |

Bảng phụ do pipeline tạo: `vn_boundary` (ranh giới VN đệm 2 km), `poi_work_*` (Task 7–8).

Fixture Quận 1: `pipelines/poi/fixtures/` (tạo lại bằng `scripts/make-fixture.mjs`). Ranh giới: `data/vn-boundary.geojson` (Natural Earth, public domain).

## admin_level thực tế trong OSM VN
(điền ở Task 8)
