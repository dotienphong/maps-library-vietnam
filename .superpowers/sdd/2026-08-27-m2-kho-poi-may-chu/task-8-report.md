# M2 Task 8 — Báo cáo triển khai kho geocode toàn Việt Nam

Ngày hoàn tất: 2026-08-29
Branch/worktree: `feature/m2-task8` / `/tmp/mapslibvn-m2-task8`
Base: `e02d7367de55040ebbac481dbcd3045b3b8c6650`
Implementation commit: `ebedbac22ac6f1aef3362963bb38e145490dc69b` (`feat(pipeline-poi): build national geocode warehouse`)
Không push, không sửa `AGENTS.md`.

## Kết quả

Task 8 đã hoàn tất end-to-end: trích road/admin từ PBF, phát hành `admin_area`/`admin_alias`,
gộp street, nhận diện alley + parent/entrance, tạo address anchor từ OSM/Overture/FSQ,
test thuần + DB fixture cô lập, chạy toàn Việt Nam, kiểm invariant, cập nhật README/plan/DEVLOG.

## Files changed

- `db/seed/admin_alias_2025.csv`: seed alias tỉnh cũ → tỉnh hiện tại và ví dụ alias phường/xã.
- `pipelines/poi/src/geocode/alley-name.mjs`: pure parser tên hẻm và chuẩn hoá tên đường.
- `pipelines/poi/src/geocode/osm-roads.mjs`: osmium PBF → `osm_road_raw`, `osm_admin_raw`.
- `pipelines/poi/src/geocode/admin.mjs`: semantic admin levels, current-area filter, alias seed, atomic publish.
- `pipelines/poi/src/geocode/streets.mjs`: cluster named non-alley ways thành street và ward intersections.
- `pipelines/poi/src/geocode/alleys.mjs`: alley, parent street, entrance, atomic publish street+alley.
- `pipelines/poi/src/geocode/anchors.mjs`: raw anchors, two-pass dedupe, admin fill, atomic publish.
- `pipelines/poi/tests/alley-name.test.mjs`: 5 pure tests, gồm mẫu OSM toàn quốc phát hiện khi chạy thật.
- `pipelines/poi/tests/geocode.dbtest.mjs`: 5 DB tests trên đúng `mapslibvn_task8_test`.
- `pipelines/poi/README.md`: commands, admin-level truth và exact national counts.
- `docs/superpowers/plans/2026-08-27-m2-kho-poi-may-chu.md`: Task 8 Step 1–10 checked.
- `docs/DEVLOG.md`: checkpoint chuyển sang Task 9, decisions, counts, việc tay còn lại.

## TDD — RED/GREEN evidence

1. `pnpm exec vitest run pipelines/poi/tests/alley-name.test.mjs`
   - RED đầu tiên: `ERR_MODULE_NOT_FOUND` cho `../src/geocode/alley-name.mjs`.
   - GREEN sau implementation: ban đầu 3/3; sau các regression OSM thật là 5/5.
   - Các RED bổ sung bắt slash/range, `Bis`, thiếu khoảng trắng, `111K1`, `453/77C-D`,
     `02/K01`, `102+104`, dấu phẩy/chấm, `Ngách 40/Ngõ`, và hyphen có khoảng trắng.
2. `DATABASE_URL=postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn_task8_test pnpm exec vitest run pipelines/poi/tests/geocode.dbtest.mjs --config vitest.db.config.ts`
   - Test được viết trước module; RED đầu tiên: `MODULE_NOT_FOUND` cho `osm-roads.mjs`.
   - RED tiếp theo phát hiện PostgreSQL target `UPDATE` không được tham chiếu từ `FROM LATERAL`,
     `array_agg(text[])` không subscript như scalar, mapping OSM 2025 level 6, foreign relation,
     log alias đếm input thay vì row thật, và duplicate anchor exact 30 m.
   - GREEN cuối: 1 file, 5/5 tests, 23.589 s trong full DB suite.
   - Child process dùng `execFile` async/await, timeout 110 s, `AbortController`, cleanup
     `afterEach` + `afterAll`; fail-closed nếu URL pathname không phải `/mapslibvn_task8_test`.
   - Assertions không bị giảm; fixture thêm retired province, legacy ward, đặc khu và foreign-area regressions.
3. Anchor national RED: pass DBSCAN độ ban đầu còn đúng 1 cặp `(310, Minh Khai)` cách
   `29.50896126 m`. Thử epsilon độ `0.00035` làm overmerge 8.992 anchor nên bị loại bỏ.
   Two-pass metric cleanup chỉ gộp thêm 5 anchor và đưa exact duplicate về 0.

## Verification commands và exact counts

- `pnpm lint` → exit 0; Biome checked **124 files**, no fixes.
- `pnpm typecheck` → exit 0; Turbo **10/10 tasks successful** (9 cached, Task 8 pipeline fresh).
- `pnpm test` → exit 0:
  - root Vitest **27 files, 432/432 tests**;
  - API Vitest **3 files, 10/10 tests**.
- `DATABASE_URL=postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn_task8_test pnpm test:db -- --reporter=verbose`
  → exit 0; **4 files, 26/26 tests**, 471.90 s:
  - conflate 11/11 (437.143 s), geocode 5/5 (23.589 s), schema 6/6 (0.969 s), ingest 4/4 (9.606 s).
- `git diff --check` → exit 0.
- Final pipeline report rerun trong Compose → `/app/out/poi-report-20260829.json`, anchors 918.416.

Một DB verification bị ngắt trước đó để lại `poi_new` trong riêng fixture DB, làm schema test
RED 1/6 (`expected ['schema_migrations']`, got thêm `poi_new`). `pg_stat_activity` xác nhận
không còn child/connection, chỉ đúng bảng tạm được drop trong `mapslibvn_task8_test`; schema
rerun 6/6 và full DB suite sau đó 26/26. Không thay assertion/schema logic.

## Full Vietnam runtime

Input: `/app/work/vietnam-patched.osm.pbf`, **313 MB**, từ named volume
`mapslibvn-dev_pipeline-work`. Full chain chạy thành công và rerun idempotent:

```sh
node pipelines/poi/src/geocode/osm-roads.mjs &&
node pipelines/poi/src/geocode/admin.mjs &&
node pipelines/poi/src/geocode/streets.mjs &&
node pipelines/poi/src/geocode/alleys.mjs &&
node pipelines/poi/src/geocode/anchors.mjs &&
node pipelines/poi/src/report.mjs
```

Raw:

- `osm_road_raw`: **215.360** named ways.
- `osm_admin_raw`: **9.073** relations: L0=1, L3=7, L4=39, L6=3.322, L8=565, L9=5.139.

Published:

- `admin_area`: **3.352** = L4 **33** + semantic L8 **3.319**.
- `admin_alias`: **33 distinct**; unmatched seed: `ninh thuan,4,Khánh Hòa,`.
- `street`: **61.031**; 60.983 có ward, 58.979 có province; numeric alley-name còn trong street: **0**.
- `alley`: **58.388**; parent **52.789**, entrance **52.789** (**90,41 %**);
  entrance cách parent street >1 m: **0**.
- `address_anchor`: **918.416**; Nguyễn Lâm **171**; ward **918.300**; province **896.232**.
- Anchor source: OSM **66.055**, Overture **775.848**, FSQ **76.513**.
- Bảng tên `%_new`: **0**.

Exact anchor invariant:

- Self-join cast geography thuần không dùng được GiST và bị terminate sau hơn 10 phút.
- Equivalent indexed exact check dùng `ST_DWithin(a.geom,b.geom,0.00035)` làm GiST prefilter,
  sau đó vẫn kiểm exact `ST_DWithin(a.geom::geography,b.geom::geography,30)`; timeout 120 s,
  hoàn tất với duplicate `(housenumber, street_norm, ≤30 m)` = **0**. Prefilter không bỏ
  cặp 30 m tại Việt Nam và exact predicate vẫn là tiêu chí quyết định.

Task 7 binding invariant trước/sau không đổi:

- `poi_work_record`: **1.897.933**.
- `poi`: **1.522.371**.
- `poi_source_link`: **1.583.562**.

## Disk evidence

- Host `/System/Volumes/Data`/root available: **24 GiB trước → 22/21 GiB trong/sau**; final 21 GiB.
- Docker `/app/work`: **352 GiB trước → 350 GiB sau**, 19% used.
- PBF tồn tại trong volume, không download lại. Không có disk-pressure failure.

## Deviations/rulings

- Plan estimate L4=34 không khớp PBF hiện tại: raw chỉ có 33 current province geometries;
  Khánh Hòa thiếu hẳn relation level 4. Không tạo geometry giả/không đổi test để ép estimate.
- OSM hiện dùng raw level 6 cho đơn vị cấp xã mới (gồm đặc khu), không phải raw level 8 như
  plan giả định. Pipeline map current Vietnamese L6 → semantic L8, loại legacy L8 được phủ và
  foreign/border relations; exact raw/published counts được ghi README + DEVLOG.
- Plan street estimate 150–300 nghìn không phải acceptance invariant; actual named connected
  clusters là 61.031 và được giữ theo dữ liệu thật.
- Parser alley mở rộng từ regex spec theo các RED lấy trực tiếp từ national OSM để không để
  numeric alley lọt vào street.
- Anchor dùng pass DBSCAN độ theo plan rồi metric cleanup EPSG:32648 30,5 m. Ruling được chọn
  sau khi exact 30 m invariant bắt một miss; phương án tăng epsilon độ bị bác do overmerge lớn.

## Remaining concerns

- Seed phường/xã mới hiện chỉ có ví dụ Diên Hồng; cần biên soạn đầy đủ từ nghị quyết UBTVQH 2025.
- Cần bổ sung relation level 4 Khánh Hòa vào OSM/override được duyệt để alias Ninh Thuận nạp được.
- Exact national self-join cần geometry GiST prefilter để vận hành; geography-only form không
  thực tế trên 918 nghìn anchors.
- Không có push/remote CI trong scope được giao; branch và worktree được giữ nguyên để parent tích hợp.
