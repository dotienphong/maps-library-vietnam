# M2 Task 8 — Báo cáo triển khai kho geocode toàn Việt Nam

Ngày hoàn tất: 2026-08-29
Branch/worktree: `feature/m2-task8` / `/tmp/mapslibvn-m2-task8`
Base: `e02d7367de55040ebbac481dbcd3045b3b8c6650`
Implementation commit: `ebedbac22ac6f1aef3362963bb38e145490dc69b` (`feat(pipeline-poi): build national geocode warehouse`)
Review fix commit: `20550a99f2ad9385aa8fdd02476a99487d2f1310` (`fix(pipeline-poi): enforce exact geocode boundaries`)
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
- `pipelines/poi/src/geocode/raw-tables.mjs`: build/swap atomic hai raw tables, cleanup failure.
- `pipelines/poi/src/geocode/anchors.mjs`: exact graph dedupe, iterative convergence, staging cleanup.
- `pipelines/poi/tests/alley-name.test.mjs`: 5 pure tests, gồm mẫu OSM toàn quốc phát hiện khi chạy thật.
- `pipelines/poi/tests/geocode.dbtest.mjs`: 8 DB tests trên đúng `mapslibvn_task8_test`.
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
   - GREEN trước review: 1 file, 5/5 tests, 23.589 s; Important-review là 7/7;
     final Minor cleanup là 8/8.
   - Child process dùng `execFile` async/await, timeout 110 s, `AbortController`, cleanup
     `afterEach` + `afterAll`; fail-closed nếu URL pathname không phải `/mapslibvn_task8_test`.
   - Assertions không bị giảm; fixture thêm retired province, legacy ward, đặc khu và foreign-area regressions.
3. Anchor national RED: pass DBSCAN độ ban đầu còn đúng 1 cặp `(310, Minh Khai)` cách
   `29.50896126 m`. Thử epsilon độ `0.00035` làm overmerge 8.992 anchor nên bị loại bỏ.
   Đây là RED/GREEN trước review; review sau đó loại hẳn DBSCAN degree/30,5 m và thay bằng
   graph geography exact ≤30 m có regression biên, xem phụ lục review fixes.

## Verification commands và exact counts

- `pnpm lint` trước review → exit 0, **124 files**; final branch → exit 0, **125 files**.
- `pnpm typecheck` → exit 0; Turbo **10/10 tasks successful** (9 cached, Task 8 pipeline fresh).
- `pnpm test` → exit 0:
  - root Vitest **27 files, 432/432 tests**;
  - API Vitest **3 files, 10/10 tests**.
- `DATABASE_URL=postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn_task8_test pnpm test:db -- --reporter=verbose`
  → final sau review exit 0; **4 files, 28/28 tests**, 489,09 s:
  - conflate 11/11 (439,727 s), geocode 7/7 (38,395 s), schema 6/6 (1,026 s), ingest 4/4 (9,152 s).
- `git diff --check` → exit 0.
- Final pipeline report rerun trong Compose → `/app/out/poi-report-20260829.json`, anchors 923.541.

Một DB verification bị ngắt trước đó để lại `poi_new` trong riêng fixture DB, làm schema test
RED 1/6 (`expected ['schema_migrations']`, got thêm `poi_new`). `pg_stat_activity` xác nhận
không còn child/connection, chỉ đúng bảng tạm được drop trong `mapslibvn_task8_test`; schema
rerun 6/6 và full DB suite trước review sau đó 26/26. Không thay assertion/schema logic.

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

- `admin_area`: **3.288** = L4 **33** + semantic L8 **3.255**.
- `admin_alias`: **33 distinct**; unmatched seed: `ninh thuan,4,Khánh Hòa,`.
- `street`: **61.031**; 60.983 có ward, 58.979 có province; numeric alley-name còn trong street: **0**.
- `alley`: **58.388**; parent **52.408**, entrance **52.408** (**89,76 %**);
  entrance cách parent street >1 m: **0**.
- `address_anchor`: **923.541**; Nguyễn Lâm **174**; ward **901.166**; province **901.231**.
- Anchor source: OSM **66.157**, Overture **780.329**, FSQ **77.055**.
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
- Docker `/app/work`: **352 GiB trước → 349 GiB sau**, 19% used.
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
- Anchor cuối dùng exact-edge graph: geometry GiST prefilter + geography ≤30 m, connected
  components và lặp trên median đến khi exact duplicate = 0. DBSCAN degree/UTM 30,5 m đã bỏ.

## Remaining concerns

- Seed phường/xã mới hiện chỉ có ví dụ Diên Hồng; cần biên soạn đầy đủ từ nghị quyết UBTVQH 2025.
- Cần bổ sung relation level 4 Khánh Hòa vào OSM/override được duyệt để alias Ninh Thuận nạp được.
- Exact national self-join cần geometry GiST prefilter để vận hành; geography-only form không
  thực tế trên 918 nghìn anchors.
- Không có push/remote CI trong scope được giao; branch và worktree được giữ nguyên để parent tích hợp.

## Appendix — review fixes (2026-08-29)

Review verdict không có Critical, có 4 Important; toàn bộ đã sửa theo TDD. Review fix commit:
`20550a99f2ad9385aa8fdd02476a99487d2f1310`; report commit riêng theo sau.

### RED evidence trước fix

- Focused geocode DB test: **3 failed, 2 passed**:
  - foreign Vietnamese-style `Xã Sa Mouay` được nhận sai (`expected 0, received 1`);
  - alley 301 m và 15,1 m vẫn có parent;
  - hai anchor cùng address cách 30,1 m bị gộp còn một.
- Safety regression tiếp theo RED ở collection vì chưa có `raw-tables.mjs`/exported
  `buildAnchors`; test yêu cầu failure giữ published data và cleanup staging.
- Bản exact recursive đầu dùng `OR` adjacency join chạm hook timeout 120 s. Root cause là CTE
  edge không có indexed traversal; đổi sang directed edge table + B-tree, giữ nguyên exact predicate.
- Exact graph pass đầu còn 4 cặp median-created ≤30 m; regression/invariant không đổi. Thêm
  iterative exact clustering đến hội tụ thay vì làm yếu assertion.

### Fixes

1. `osm-roads.mjs` gọi `replaceRawTables`: COPY/index/validate trên hai `_new`; drop old +
   rename cả hai và indexes trong cùng transaction; `finally` dọn staging khi bất kỳ bước nào lỗi.
2. `anchors.mjs` export `buildAnchors`, cleanup raw/edge/merge/new trong `finally`; graph cạnh
   chỉ tạo khi exact geography ≤30 m sau GiST prefilter, ưu tiên confidence/source, lặp đến 0 duplicate.
3. `alleys.mjs` giữ geometry prefilter nhưng parent-name/touch quyết định bằng geography exact
   ≤300 m/≤15 m và xếp nearest bằng geography distance.
4. `admin.mjs` lấy 34 current province norms từ `provinces.json`; mọi L6/L8 accepted phải có
   point-on-surface nằm trong retained L4. Fixture `Xã Sa Mouay` ngoài province bị loại.

### GREEN và national rerun

- Focused geocode: **1 file, 7/7 tests, 37,32 s**; gồm 299/301 m, 14,9/15,1 m,
  29,9/30,1 m + OSM source priority, dual-raw failure và anchor failure cleanup.
- Full affected national chain exit 0: raw 215.360/9.073; admin 3.288 (33/3.255), alias 33;
  street 61.031; alley 58.388, parent+entrance 52.408, entrance far >1 m =0; anchors 923.541,
  Nguyễn Lâm 174. Pipeline chỉ publish sau exact duplicate ≤30 m =0.
- Source: OSM 66.157, Overture 780.329, FSQ 77.055; staging table =0.
- Ward filled 901.166; province filled 901.231. Task 7 binding counts không đổi:
  1.897.933 work records / 1.522.371 POI / 1.583.562 links.
- Disk sau rerun: host 21 GiB, `/app/work` 349 GiB available.
- Final gates sau review: lint 125 files; typecheck 10/10 tasks; unit 432/432; API 10/10.
- Full DB suite sau fixes: **4 files, 28/28 tests, 489,09 s** — conflate 11,
  geocode 7, schema 6, ingest 4.

## Appendix — final Minor cleanup (2026-08-29)

- RED: tạo `street_new` rỗng không có ready marker rồi chạy `alleys.mjs`; promise resolve và
  publish sai `street=0`, `alley=2.181`. Focused result **1 failed, 7 passed**.
- GREEN: `streets.mjs` chỉ đặt comment marker `mapslibvn:street-ready:v1` sau khi build/analyze
  hoàn tất; lỗi trước completion dọn `street_new`. `alleys.mjs` kiểm marker trước khi tạo
  `alley_new`, và `finally` luôn dọn cả hai staging tables. `admin.mjs` luôn dọn
  `admin_area_new`/`admin_alias_new` trong `finally`; published tables vẫn chỉ đổi trong
  transaction của `publishNew`.
- DB assertion address anchor tách riêng `ward_norm / total > 95%` và
  `province_norm / total > 95%` thay vì chỉ kiểm province.
- Focused geocode final: **1 file, 8/8 tests, 38,41 s**.
- Final gates: lint **125 files**, typecheck **10/10 tasks**, root unit **432/432**, API **10/10**;
  `git diff --check` sạch.
- Không rerun national: cleanup/marker chỉ tác động failure/staging path; success path vẫn chạy
  cùng SQL và cùng atomic publish, không thay đổi dữ liệu/counters national đã nghiệm thu.
