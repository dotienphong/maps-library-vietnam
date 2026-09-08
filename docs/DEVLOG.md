# DEVLOG — MapsLibVN

Đọc file này trước khi làm bất cứ việc gì. Cập nhật ở bước cuối của MỌI task (cùng
commit với code).

## 1. Trạng thái hiện tại

- **08/09/2026 — Mở lại gate POI Sources Profile sau review.** Tính năng đã rollout
  ngày 07/09, nhưng kết luận plan hoàn tất 15/15 và tick đồng loạt 76 bước là quá sớm.
  Plan `docs/superpowers/plans/2026-09-07-poi-sources-profile.md` đã bổ sung R1–R8:
  kế thừa client map cho autocomplete, release bất biến, snapshot chung, sửa test
  thinning/tập con, API DB test nguồn/user, gate 300 MiB và nghiệm thu p95/browser.
  Rollout ban đầu chỉ publish OSM theo lựa chọn PHONG, không phải build đôi.
  Lượt này chỉ cập nhật plan/checkpoint; chưa implement các sửa chữa sau review.
  **Bắt đầu tiếp:** Task 11 Step 6 — regression test autocomplete gắn map OSM nhưng
  không có thuộc tính sources; sau đó sửa kế thừa map.places. Gate đã chạy trước
  review (905 unit + 168 API, lint/typecheck/docs build) không thay thế gate mới.
  **R1 ĐÓNG:** `<mapslibvn-autocomplete>.map` nay dùng
  `map.places`, nên kế thừa đúng `poiSources`; đổi/gỡ map huỷ kết quả cũ và gỡ map
  quay về client standalone. Unit test khóa cả cấu hình mâu thuẫn và request cũ;
  Chrome headless fixture trả `pass` với map client + near, không gọi endpoint standalone.
  **R2/R8 release ĐÓNG:** mỗi lần build POI tạo một build ID
  `YYYYMMDD-HHmmss-<nonce>` dùng chung cho `poi` và `poi-osm`; tên date-only lịch sử
  vẫn đọc được. Uploader ghi SHA-256 companion, retry cùng bytes là idempotent và từ
  chối release đã có bytes khác hoặc archive cũ không có checksum. Exporter lẫn uploader
  đều chặn cứng trên `300 * 2 ** 20` bytes trước manifest; unit test khóa đúng biên
  300 MiB/+1 byte và các trạng thái upload. Basemap `vn-*` không bị đổi contract.
  **Bắt đầu tiếp:** R3 — xuất hai profile từ cùng một snapshot trung gian bất biến và
  thêm fault-injection chứng minh manifest không đổi nếu bất kỳ export/upload/smoke lỗi.
  **R3 Step 6 ĐÓNG:** `data:update --poi` nay stream bảng `poi` active đúng một lần
  thành `snapshot-<buildId>.jsonl`, chỉ công bố file sau khi ghi xong và kèm SHA-256.
  Cả exporter `all` và `osm` xác thực cùng build ID/checksum rồi lọc từ file này;
  thay đổi DB giữa hai export không còn lọt vào archive sau. Mỗi profile vẫn chạy
  progressive selector độc lập. Unit test khóa lọc nguồn/user, DB-change mô phỏng,
  thiếu checksum, sai checksum và metadata/build ID.
  **R3 Step 7 ĐÓNG:** DB fixture trong pipeline container chụp snapshot thật, chèn
  một POI người dùng sau thời điểm chụp, rồi export cả `all` và `osm` từ cùng snapshot.
  POI muộn vắng ở cả hai archive đầu và có mặt ở cả hai archive của snapshot/build kế
  tiếp; full `pnpm test:db` xanh 10 file/67 test. **Tiếp:** R3 Step 8 fault-injection
  tại export OSM, upload thứ hai và từng smoke; manifest hiện hành phải giữ nguyên.
  **R3 Step 8 ĐÓNG:** orchestration POI nay là danh sách bước có ID và manifest là
  commit cuối sau export/QA/upload/smoke của cả `all` lẫn `osm`. Fault-injection tại
  export OSM, upload OSM và từng smoke đều chứng minh manifest hiện hành không đổi;
  fake external state dùng đúng argument upload để khóa checksum hai archive cũ.
  Unit boundary liên quan xanh 32/32; script typecheck và Biome tập trung sạch.
  **Tiếp:** R3 Step 9 — rollback theo release ID + checksum và retry khi report/state
  lỗi sau manifest mà không ghi đè release bất biến.
  **R3 Step 9 ĐÓNG:** `data:rollback` trong container nay đọc target đầu lịch sử,
  bắt buộc từng release POI đích có cả archive và companion SHA-256 hợp lệ trên R2,
  log đúng ID+checksum rồi mới đổi manifest. Test retry sau lỗi report/state khóa hai
  nhánh: cùng bytes được reuse, bytes khác bị uploader bất biến từ chối. Nhóm test
  rollback/orchestration/archive guard xanh 31/31; script typecheck và Biome sạch.
  **Tiếp:** R4/R5 — sửa ý nghĩa thinning trong DB fixture và thêm API DB semantic
  tests cho nguồn/user trên search, nearby, reverse và autocomplete.
  **R4 ĐÓNG:** DB fixture không còn giả định archive `osm` là tập con/nhỏ hơn `all`
  sau thinning. Ba POI cùng ô chứng minh Overture thắng ở `all`, OSM được phục hồi ở
  `osm`, còn POI user không bị lọc theo nguồn nhưng vẫn chịu ranking/thinning; kiểm
  đúng ID trên cả GeoJSONSeq và tile PMTiles giải mã thật. POI user không cạnh tranh
  vẫn có trong cả hai archive. Full pipeline DB gate xanh 10 file/68 test.
  **Tiếp:** R5 — fixture API DB biệt lập cho OSM/Overture/FSQ/user và ma trận ID trên
  search, nearby, reverse, autocomplete, gồm cache theo hai chiều profile.
  **R5 ĐÓNG:** fixture API DB có ID cố định cho OSM, Overture, FSQ và user/nguồn NULL.
  Search + nearby khóa đủ ba profile; reverse đặt Overture gần nhất rồi chứng minh `osm`
  chọn lại OSM và `fsq` chọn lại FSQ. Autocomplete khóa prefix, alias địa danh, tsvector,
  viKey, Telex fallback bật thật trong Wrangler; cache chạy `osm→all` và `all→osm`, còn
  street/address/area không bị lọc. API unit xanh 25 file/168 test, API DB thật xanh
  3 file/51 test. **Tiếp:** R8 — đồng bộ spec/docs với snapshot, thinning độc lập,
  release bất biến và trạng thái package 0.4.0.
  **R8 ĐÓNG:** spec và docs nay mô tả đúng snapshot JSONL chung có checksum, build ID
  chung `YYYYMMDD-HHmmss-<nonce>`, manifest-last, archive bất biến và rollback kiểm
  companion SHA-256. Tài liệu bỏ lời hứa sai rằng POI không vẽ thì không tìm được:
  chỉ nguồn bị tắt mới bị lọc, còn thinning tile không lọc Places API; user chỉ được
  miễn source filter. Trang SDK hiển thị đúng source version `0.4.0` và nói rõ bốn gói
  chưa publish npm. Docs build xanh 20 trang; lint sạch 330 file.
  **Tiếp:** R7/R6 — đo paired p95 có baseline tương ứng, build đôi trên staging và
  nghiệm thu browser 5 thành phố trước khi đóng production acceptance.
  **R6/R7 phần có thể tái lập ĐÓNG:** fixture build đôi chung snapshot đạt QA/DB 68/68,
  fault/rollback giữ manifest và checksum. Benchmark production 40 query × 5 vòng tại
  HKG: warm `osm` n=160 p95 116 ms, `all` n=160 p95 115 ms; cold ghi riêng n=40,
  không dùng kết luận. Chromium kiểm `all`/`osm` ở 5 thành phố × z12/14/16: 30/30
  đúng `x-poi-profile`, console không error; ảnh đã lưu. **Còn đúng một gate:** chưa
  có baseline `all` trước/sau trên cùng snapshot và điều kiện, nên chưa thể chứng minh
  không hồi quy lịch sử; plan bắt buộc giữ Task 15 Step 4 mở.

- **07/09/2026 — ĐÃ PHÁT HÀNH bật/tắt nguồn POI theo profile (spec 07/09).**
  Cổng đo trước cho kết quả bất ngờ: OSM chỉ là **nguồn chính của 7,0 %** POI (106.325/1.522.416;
  Overture 77,1 %, FSQ 15,9 %; `multiSourcePct` 3,3 %) — mặc định `['osm']` như dự định ban đầu sẽ
  làm bản đồ mất ~93 % POI, nên PHONG quyết **đảo mặc định thành `all`**, giữ profile `osm` làm tuỳ
  chọn. Bằng chứng: `docs/evidence/poi-sources/do-truoc-primary-source.md`.
  **Core:** `POI_SOURCE_PROFILES` (`all` mặc định, `osm`), `parsePoiSourcesCsv`, `profileForSources`,
  `poiSourceClause` — một nguồn sự thật cho API, SDK và pipeline.
  **API:** `sources=` ở search/nearby/reverse/autocomplete/styles; cache key autocomplete lên
  `v=src1` (thêm `&s=`); style trả header `x-poi-profile` và fallback `all` khi profile chưa publish;
  tiles thêm set `poi-osm`. `/v1/places/{id}` cố ý KHÔNG lọc.
  **Pipeline:** `export-tiles --sources`, seq theo release, manifest `--poi-osm` + `poiProfiles.osm`,
  `data:update --poi` build và publish hai archive trong MỘT lần set manifest.
  **SDK 0.3.0:** `poiSources` (web/react/RN), thuộc tính `sources` của web component. Chỉ thêm API,
  mặc định không đổi hành vi.
  **Hai lỗi tự bắt được:** (1) route TileJSON dùng pattern `[a-z]+\.json` nên `poi-osm.json` không
  khớp → đổi thành `[a-z][a-z-]*`; (2) bind mảng JS rồi cast `::text[]` chạy đúng ở unit test nhưng
  `postgres/cf` trong Workers nối thành `"osm,overture,fsq"` → `malformed array literal` trên
  production; đã dùng lại `textArray` của `geocode.ts` (nay export) và khoá bằng 2 itest chạy
  Wrangler/Hyperdrive thật.
  **Kiểm thử:** 70 file/711 test unit + 24 file/140 test API + 3 file/33 test api-db + 10 file/62
  test DB (trong container vì máy dev thiếu tippecanoe) — tất cả xanh.
  **Phát hành (Task 15, mức PHONG chọn: deploy API + export riêng profile osm, chỉ ĐỌC DB):**
  Worker version `e15713e5`; `pnpm poi:profile --profile osm` (lệnh mới) publish
  `poi-osm-20260907.pmtiles` — **54.579 POI / 16,5 MB**, thinned 51.670, smoke 16/20 tile, 39 giây.
  Manifest `{"poi":"poi-20260904","poiProfiles":{"osm":"poi-osm-20260907"}}` — archive `all`
  KHÔNG đổi. Bằng chứng: `docs/evidence/poi-sources/nghiem-thu-production.md`.
  **Phân hoạch đúng trên production:** `search?q=Highlands` cho `osm`=145, `overture,fsq`=1.207,
  `all`=1.352 (145+1.207=1.352); 8/8 mẫu nhánh osm có `primary=osm`.
  **Cổng p95 ĐẠT:** cache ấm `osm` 95 ms so với `all` 103 ms, cùng colo SIN, đo xen kẽ — nhánh mặc
  định không xấu đi.
  **Phát hiện đáng ghi:** archive `osm` có **110,9 %** số feature/tile của `all` (92 → 102 trên 15
  tile ở 5 thành phố) dù chỉ lấy từ 7 % kho POI — vì lưới progressive chạy lại trên riêng tập OSM
  nên POI OSM trước đây thua ô giờ thắng ô. Đây là bằng chứng thực nghiệm cho việc chọn phương án
  archive-theo-profile thay vì lọc ở client. Ngoại lệ: Đà Nẵng z16 osm=0 (tile đó không có POI OSM).
  **Việc nên làm tiếp (chưa mở task):** `multiSourcePct` chỉ 3,3 % — "Chợ Bến Thành" (osm) và
  "Ben Thanh Market" (fsq) là cùng một chỗ mà conflate không ghép. Nếu muốn dùng nguồn làm tín hiệu
  chất lượng thì phải xử lý chuyện này trước.

- **07/09/2026 — ĐÃ PUBLISH dữ liệu alias hành chính lên production; nghiệm thu 8.5/8.6.**
  Thứ tự theo 9.2: backup `mapslibvn-20260907-1020.dump.zst` lên R2 → `osm-roads.mjs` (9.105 ranh
  giới, 216.301 đường) → `admin.mjs --accept-qa "<lý do>"`. Kết quả: `admin_area` **3.353 (L4=34**,
  trước 33), `admin_area_old` 4.972, `admin_alias` **37.246** (trước 33), publish **2.496 ms** —
  khoá ngắn hơn dự đoán nhiều. Cổng QA còn `unmatched=2` (hai vùng đảo Thanh Lân, Cô Tô), publish
  bằng cờ tường minh, lý do ghi vào `report.acceptedQa`.
  **Smoke:** `Quận 10` trả vùng kèm danh sách phường đích (trước rỗng), `Bình Dương` trả
  `Thành phố Hồ Chí Minh` với tên cũ ở dòng phụ. `Thủ Dầu Một` lúc đầu vẫn rỗng vì nó là thành phố
  cấp huyện cũ nhưng nằm trong alias tỉnh của `provinces.json`, nên `parseAddress` canonicalize
  thành tỉnh và `aliasLevel` khoá cấp 4 trong khi alias `thu dau mot` chỉ có ở level 6 — đã sửa:
  tỉnh suy từ alias thì không khoá cấp.
  **8.6 geocode ĐẠT:** 9/10 chính xác cao (yêu cầu ≥8), tám cặp cho `rooftop` ở cả hai cách viết,
  `hcm-address-10` địa chỉ **cũ còn tốt hơn mới** (`rooftop` so với `ward`), không ca nào ra ngoài
  `expectedBbox`. **hit@3 37/40 = baseline** ĐẠT. Ca trượt duy nhất `hcm-address-04`: old ward
  "Phường 12" của **Quận 4 không có trong snapshot** — lỗ hổng upstream, không phải hồi quy.
  **8.5 đo được nhưng chưa kết luận cổng p95:** default (có `area`) p50 81 ms / p95 1.873 ms so với
  `types=poi,street,address` p50 88 ms / p95 1.627 ms. Chênh p95 +246 ms vượt ngưỡng +50 ms, nhưng
  hai cohort **rơi vào hai colo khác nhau** (HKG/SIN), p95 do cache lạnh qua internet chi phối, và
  mỗi cohort chỉ 80 request thay vì ≥100. Tín hiệu tin được là p50 (81 so với 88) — `area` không
  thêm chi phí đo được ở nhánh ấm. Phải đo lại từ điểm quan sát ổn định; không tự chọn lại bộ mẫu.
  **Một lỗi của chính tôi đã sửa:** DB tests đỏ từ `93fc7e2` (4 file/5 test) vì test
  `bootstrapMissingProvince` chèn hộp giả vào `vn_boundary` thật — `ensureVnBoundary()` có guard
  "đã có dòng thì return" nên bỏ nạp ranh giới VN, rồi `deleteOutsideVn()` xoá sạch POI Quận 1 của
  các test khác dùng chung DB cô lập; ingest ra 0 dòng và tippecanoe báo "Did not read any valid
  geometries". Nay hàm nhận `boundaryTable` và test dùng bảng riêng: bộ DB trong container
  **10 file/57 test xanh**. Cũng sửa lỗi tôi gây ra ở `--types` của `perf-autocomplete.mjs`:
  `indexOf` trả -1 thì `-1+1=0` ăn mất base-url.

- **07/09/2026 — Dựng lại CẢ HAI phía toàn quốc: cổng QA pipeline từ `unmatched=72` xuống `=2`.**
  Tải extract OSM hiện hành `vietnam-latest.osm.pbf` (md5 `72d7b298f4dbae54283a2ee8506bd17f`, đối
  chiếu **độc lập** với Geofabrik vì log tải có ba lần 503/502 nên không tin lần kiểm trong script),
  vá chủ quyền (193 object), trích `osm_admin_raw` 9.105 ranh giới (L4=39, L6=3.322, L8=565 — khớp
  đúng ghi chú M2 T8), rồi chạy current + old + alias trên DB đo.
  `bootstrapMissingProvince()` chạy ở **cả hai** phía: current dựng L4 Khánh Hòa từ **64** đơn vị
  con mồ côi, old dựng từ **8**. Publish vào DB đo: `admin_area` 3.353 (**L4=34**, L8 3.319),
  `admin_area_old` 4.972, `admin_alias` **37.246**.
  **Cổng QA pipeline: `invalid=0, unmatched=2, overlap=0, seed_miss=0`** (trước: `unmatched=72,
  seed_miss=1`). Evaluator 8.3/8.4: tổng failure **223 → 84**; `count_out_of_range` 3 → **1**;
  `missing_mainland_l8` 72 → **10**; `raw_coverage_gap` 122 → **60**;
  `fixture_district_mismatch` 10 → **0**; L4/L6 cũ 62/686 → **63/694** (đúng spec); ca alias
  47/60 → **48/60**.
  **Bốn nhóm còn lại đã phân giải hết nguyên nhân:** (1) L8 cũ 4.215 so với spec 10.000–10.700 là
  độ phủ **upstream** của snapshot 01/2025, code không sửa được; (2) 10 `missing_mainland_l8` tách
  sạch thành **8 ca do `normalizeVi` gộp dấu** — `Đông Thành`/`Đông Thạnh`, `Lộc Thành`/`Lộc Thạnh`,
  `Phú Thành`/`Phú Thạnh`, `Sa Pa`/`Sa Pả` trùng khóa nên cả cặp bị loại vì mơ hồ, mà mỗi cặp còn
  **cùng huyện** nên khóa có huyện cũng không cứu — và **2 ca đảo** (`Thanh Lân`, `Cô Tô`) có
  polygon gần như toàn biển nên mọi chồng lấn dưới ngưỡng sliver 0,05; (3) 60 `raw_coverage_gap`
  chính là nhóm ven biển có mẫu số gồm lãnh hải; (4) 12 ca alias còn lại cần đối chiếu nghị quyết
  từng ca như đã làm cho Đà Nẵng và Cần Thơ.
  **Chưa publish lên production** — trạng thái này ở DB đo dùng-một-lần; phát hành phải theo Task 9.2.

- **07/09/2026 — Ba việc PHONG yêu cầu: việc 1 và 3 xong, việc 2 sửa được một nửa quan trọng.**

  **Việc 1 — fixture sai ground truth.** Fetch nguyên văn NQ 1659 (Đà Nẵng) và NQ 1668 (Cần Thơ):
  **tập đích trong fixture ĐÚNG** (Xuân Hà→Thanh Khê, Hòa An→An Khê, Phước Mỹ→An Hải,
  Thọ Quang→Sơn Trà, Bùi Hữu Nghĩa tách khoản 2 "một phần" + khoản 6 "phần còn lại",
  Trà An→Thới An Đông, Lê Bình→Cái Răng). Chỉ trường **huyện** bị điền hàng loạt sai — đã sửa 10 ca
  theo snapshot đã pin. Sinh lại `expectedKeys` cho cả 60 ca từ `adminAliasKeys()` và thêm test chốt
  `expectedKeys === adminAliasKeys()` trong `packages/core/tests` (nơi duy nhất import được core).
  Cũng sửa một **dương tính giả của chính CLI**: Đồng Tháp có hai `Xã Tân Phước` (Lai Vung và Tân
  Hồng), CLI lấy dòng đầu tuỳ ý nên báo `dt-08` lệch dù fixture ghi đúng; nay ưu tiên dòng trùng
  huyện và cảnh báo `fixture_district_ambiguous` khi không quyết được. Danh sách lệch thật: **10 ca**.

  **Việc 3 — 122 vùng `raw_coverage < 0,95`.** Phân rã dứt điểm: **70 ca là Ninh Thuận** (cùng gốc
  việc 2), 52 ca còn lại dồn vào tỉnh ven biển/cửa sông (Quảng Ninh 25, Hải Phòng 11, Trà Vinh 10,
  Bến Tre 4…). Nguyên nhân là **thước đo sai**, không phải thiếu dữ liệu: tử số là phần đất (phường
  hiện hành chỉ vẽ trên đất) còn mẫu số là cả polygon cũ **gồm lãnh hải**. Bằng chứng định lượng:
  `Tỉnh Bà Rịa - Vũng Tàu` cũ 31.303 km² nhưng phần phủ 1.967 km² — trùng khít đất liền thật
  (~1.980); Cà Mau 5.130 (~5.294), Bình Thuận 7.947 (~7.812), Kiên Giang 6.313 (~6.348),
  Hải Phòng 1.411 (~1.526). `Thị trấn Cô Tô` cũ 202,8 km² phủ 5,2 km². **Không** tự đổi ngữ nghĩa
  cổng: `vn_boundary` là VN **đệm 2 km** nên clip vào đó vẫn làm hỏng mẫu số cho đảo nhỏ. Đây là
  danh sách ngoại lệ cần quyết định QA có nguồn theo đúng 8.4.

  **Việc 2 — Khánh Hòa.** Xác minh được điều quyết định: **các đơn vị cấu thành có đủ trong OSM**.
  Snapshot 01/2025 có 8 quận/huyện cũ (Nha Trang, Cam Ranh, Cam Lâm, Diên Khánh, Khánh Sơn, Khánh
  Vĩnh, Vạn Ninh, Ninh Hòa) — chúng chính là 8 trong 11 relation L6 bị loại vì không nằm trong L4
  nào (3 relation còn lại là nước ngoài: Sa Mouay, Bằng Tường, ໄຊຈຳພອນ). Overpass xác nhận OSM hiện
  tại cũng có phường mới của tỉnh này (`Phường Nha Trang`, `Bắc/Nam/Tây Nha Trang`, `admin_level=6`).
  Đã thêm `bootstrapMissingProvince()` dựng L4 bằng **hợp các con mồ côi**, hai chốt an toàn: chỉ
  chạy khi **đúng một** tỉnh trong `provinces.json` thiếu (đo thật: đúng một, `khanh hoa`, ở cả phía
  old và current), và chỉ gộp con có **≥90% diện tích trong VN**. Ngưỡng đó không phải chọn bừa:
  kiểm bằng point-on-surface **không đủ** — `vn_boundary` đệm 2 km nên `Sa Mouay` (Lào) vẫn lọt và
  bị hút vào polygon tỉnh; đo tỷ lệ diện tích thì Sa Mouay 0,362 còn 8 huyện Khánh Hòa 0,987–1,000,
  tách sạch. Chạy thật trên snapshot toàn quốc: L4 **62 → 63** (đúng spec), L6 **686 → 694** (vào
  khoảng 690–710 của spec), L8 4.152 → 4.215, Khánh Hòa có **72 vùng cũ**. Hàm idempotent (lần hai
  báo "thiếu 0", không chèn trùng).
  **Cảnh báo vận hành quan trọng:** sửa riêng nhánh old làm cổng QA **xấu đi** — unmatched
  **72 → 142** — vì phía current vẫn thiếu Khánh Hòa nên các vùng cũ vừa được giữ không có đích.
  Chỉ xanh khi dựng lại current bằng cùng hàm này, việc đó cần extract OSM hiện hành
  (`work/vietnam-patched.osm.pbf`, ~400 MB) và một lần chạy `admin.mjs` toàn quốc.
  **Không publish trạng thái trung gian này.**

- **07/09/2026 — Chạy 8.3/8.4 trên bộ toàn quốc: cổng đỏ vì BA nguyên nhân độc lập, trong đó một
  cái là ground truth của chính fixture sai.** Chạy `verify-admin-alias.mjs --mode coverage` trên DB
  `mapslibvn_alias_scale` (3.288 current, 4.900 old, 36.456 alias). Kết quả: **47/60 ca alias đạt,
  ca tách 4/6**; failures gồm `missing_mainland_l8` 72, `raw_coverage_gap` 122,
  **`fixture_district_mismatch` 11**, `count_out_of_range` 3, `target_missing` 11,
  `split_target_missing` 1, `unexpected_target` 3; warnings 1.901 sliver bị bỏ. Tóm tắt commit ở
  `docs/evidence/admin-alias/8-3-8-4-coverage-summary.json` (artifact đầy đủ 1,3 MB không commit).
  **Nguyên nhân 2 là phát hiện mới và nặng nhất:** fixture `admin-alias-2025.jsonl` — thứ đáng ra là
  ground truth biên soạn từ nghị quyết — **gán sai huyện cho 11 ca**, theo kiểu điền hàng loạt: mọi
  ca Đà Nẵng ghi "Quận Hải Châu", mọi ca Cần Thơ ghi "Ninh Kiều". Snapshot ODbL nói Hòa Liên thuộc
  **Hòa Vang**, Xuân Hà thuộc **Thanh Khê**, Hòa An thuộc **Cẩm Lệ**, Phước Mỹ và Thọ Quang thuộc
  **Sơn Trà**, Bùi Hữu Nghĩa và Trà An thuộc **Bình Thủy**, Quán Thánh thuộc **Ba Đình**.
  `admin-alias-fixtures.test.mjs` không bắt được vì chỉ assert `expectedKeys.length > 0`.
  Đã thêm failure `fixture_district_mismatch` vào `evaluateCoverage` để lớp lỗi này không lọt nữa.
  **Một lỗi nữa của chính phép đo, đã sửa:** CLI tra alias theo `expectedKeys[0]` viết tay, mà khóa
  đó lệch khỏi dạng canonical của core (`phuong da kao quan 1 thanh pho ho chi minh` so với
  `phuong da kao quan 1 ho chi minh` — core bỏ "thanh pho" ở tên tỉnh). Vì thế lần đo đầu báo ca
  tách **0/6** dù dữ liệu hoàn toàn đúng: `Phường Đa Kao` thật sự có đủ hai đích `Phường Sài Gòn` và
  `Phường Tân Định`. CLI nay tra theo **đơn vị cũ** (tên/huyện/tỉnh), không theo chuỗi khóa; sau khi
  sửa mới ra 47/60 và 4/6. Bài học: đừng lấy chuỗi khóa viết tay làm khoá tra khi core là nguồn sinh
  khóa duy nhất.
  Còn `missing_mainland_l8` giữ nguyên cả 10 ca đảo (Thanh Lân, Cô Tô…) trong danh sách thiếu —
  Task 8.3 cấm suy "ngoài đất liền" chỉ vì không khớp, phải có bằng chứng nguồn mới tách ra.

- **07/09/2026 — Sửa xếp hạng `area`: vùng hành chính giờ luôn có suất khi người dùng gõ tên
  hành chính.** Phân tách điểm của `Quận 10` cho thấy chỗ hụt chính xác:
  area `0,76 = 0,55·1,1 (sim+prefix) + 0,25·0,5 (không có near) + 0,15·0 + 0,05·0,6`, còn POI
  `0,875` nhờ `0,15·0,633 (pop) + 0,05·1 (prior)`. Tức vùng bị chấp sẵn **0,17 điểm**, trong đó
  0,15 là do `area-candidates.ts` trả `0 AS pop`. **Không** sửa bằng cách gán `pop` cho vùng: muốn
  thắng bằng điểm thì phải đặt ≈ 1, tức khai vùng là thứ phổ biến nhất DB và sẽ cướp chỗ POI ở
  những truy vấn như "Bến Thành"; hơn nữa `sim` của vùng đã bão hoà ở 1,1 nên mô hình điểm không
  còn chỗ diễn đạt "đây đúng là đơn vị hành chính bạn vừa gõ", và plan cấm đổi xếp hạng POI/đường
  đã nghiệm thu. Nên can thiệp ở **tầng chọn**: `withAreaSlot()` dành **một** suất cuối cho vùng
  điểm cao nhất khi `isAdminOnlyQuery()` đúng — có phường/quận/tỉnh mà **không** có số nhà hay tên
  đường. Điểm của mọi loại giữ nguyên tuyệt đối, số kết quả không đổi. Cổng chặn kiểm trên parse
  thật: `Quận 10`, `Phường An Lợi Đông` → dành suất; `88/9 Nguyễn Lâm, Phường 6, Quận 10`,
  `Lê Lợi, Quận 1`, `highlands` → không. Đo lại trên API thật: **cả bảy truy vấn tên quận trước
  đây trắng tay giờ đều có vùng ở suất cuối** kèm tên và danh sách phường đích; `highlands` và
  `cà phê` không đổi (top vẫn POI 0,93). Nhờ vậy E2E docs quay lại đúng ca **"Quận 10"** như plan
  viết ban đầu — trước đó phải né sang `Phường An Lợi Đông` vì vùng không lọt top 10. Gate: API
  unit 23 file/128 test, E2E docs 27/27, API DB 3 file/31 test.
  **Smoke trên production sau deploy** (một phần của 9.4, phần không cần dữ liệu toàn quốc):
  `Bình Dương` và `Bà Rịa Vũng Tàu` đều trả vùng ở suất cuối — tên hiện hành
  `Thành phố Hồ Chí Minh`, tên cũ ở dòng phụ, `precision: province` — đúng như hai tỉnh này đã sáp
  nhập năm 2025. `Quận 10` và `Thủ Dầu Một` **chưa** ra vùng, và đó là đúng: production mới có 32
  alias L4 + 1 L8 từ seed, chưa có alias cấp quận/phường nên không có ứng viên nào để dành suất.
  Hai truy vấn đó sẽ ra ngay khi publish được dữ liệu overlay.
  **Bẫy bắt được khi chạy gate:** API DB test đỏ ở chỗ không liên quan — autocomplete trả POI
  "Highlands Coffee" trong khi `setup.sql` chỉ seed "Highlands Coffee Test", mà bảng `poi` của DB
  itest đúng là chỉ có bản Test. Thủ phạm là **cache local của wrangler** ở
  `apps/api/.wrangler/state/v3/cache`: nó sống qua nhiều phiên, nên một lần `pnpm dev:e2e` chạy
  trên **DB dev** đủ để itest sau đó nhận lại câu trả lời của DB khác. Không phải hồi quy của bản
  sửa xếp hạng. Đã chặn hẳn: `api-db-test.mjs` xoá thư mục cache đó trước khi dựng DB, nên bộ test
  tự chứa. Kiểm bằng cách cố tình nạp cache từ DB dev rồi chạy lại — 31/31 xanh.

- **07/09/2026 — Task 8.1–8.2 xong (bộ kiểm chứng), phần đo còn chặn:**
  `scripts/verify-admin-alias.mjs` gồm hai hàm thuần `evaluateCoverage`/`evaluateGeocode` và CLI
  `--mode coverage|geocode`, timeout 10 s với **3 lần thử hữu hạn** — lần cuối thất bại giữ nguyên
  trong kết quả, không retry đến khi đạt rồi bỏ lần trượt. 17 test thuần khoá đúng sáu ca plan yêu
  cầu: thiếu L8 đất liền, `normalized share=1` nhưng raw coverage 0,6, thiếu đích ca tách, 7/10
  precision, 8/10 nhưng có cặp kém hơn địa chỉ mới, và lỗi HTTP **vẫn nằm trong mẫu**. Smoke-test
  thật cả hai mode: coverage trên dev DB → exit 1 với 65 failure; geocode qua API local → exit 1,
  6/10 chính xác cao. Artifact chứa commit, checksum nguồn, timings, cases và **0 lần xuất hiện
  khoá API**. Smoke test lộ một lỗi thật đã sửa ngay: coverage đọc `out/admin-alias/report.json`
  có thể **lệch generation** với DB, nên thêm failure `report_generation_mismatch` — nó bắt đúng
  trường hợp report 10 vùng cũ so với DB 54 vùng. `perf-autocomplete.mjs` thêm `--types` để so
  default mới với bộ loại cũ. Lưu ý mốc: **baseline "trước khi deploy API mới" đã trôi** vì API
  Task 5/6 deploy từ 06/09, chỉ còn so được explicit types trên cùng một bản deploy.
  8.3–8.7 chặn vì cần bộ dữ liệu toàn quốc qua cổng QA — tức chặn bởi Khánh Hòa.
  Gate 9.1 chạy đủ: lint, typecheck, unit 68 file/666 test, API unit 23 file/119 test,
  `pnpm build` 8/8, **`test:db` trong container 10 file/53 test**, `test:api-db` 3 file/31 test,
  E2E docs 27/27, `git diff --check` sạch.

- **07/09/2026 — SỰ CỐ PRODUCTION đã khắc phục: `/v1/autocomplete` chết vì deploy trước
  migration.** Phát hiện khi làm Task 9.2. Worker mang code Task 5/6 (`cbbdf06` ~00:48 UTC 06/09)
  đọc `admin_area_old` và `admin_alias.old_area_id`, nhưng DB production vẫn ở migration 0007 nên
  không có bảng/cột đó. Vì `area` nằm trong `types` **mặc định**, mọi request
  `/v1/autocomplete` trả **503** suốt ~4,5 giờ; `/v1/geocode` cũng 503 với mọi câu có đơn vị hành
  chính. Khoanh vùng bằng hộp đen: `/healthz/db` 200 (DB khoẻ, user `api`, PG 16.4),
  `types=poi` 200 nhưng `types=area` 503, `geocode?q=Nguyen Lam` 200 nhưng có "Phường 6, Quận 10"
  thì 503. **`Deploy API` xanh cả 5 lần** — nó chỉ chứng minh Worker đã lên, không chứng minh chạy
  được, đúng cảnh báo 9.3.
  **Khắc phục theo đúng thứ tự 9.2:** (1) backup `mapslibvn-20260907-0518.dump.zst` (634,7 MB) lên
  R2 `backups/daily` bằng `backup.mjs --once` — đây cũng là artifact rollback của 9.6; (2) dựng DB
  cô lập `mapslibvn_restore_test` từ **schema + dữ liệu admin thật** của production rồi áp 0008 ở
  đó trước: PK `admin_alias` đổi từ `(alias_norm, level)` sang `(alias_norm, level, admin_area_id)`
  thành công, 33 alias giữ nguyên, role `api` SELECT được `admin_area_old` và INSERT bị từ chối,
  và **đúng câu đang gây 503 chạy sạch** (trả 0 dòng); (3) áp 0008 lên production trong **một
  transaction** kèm ghi `schema_migrations`, giống hệt `db-migrate.mjs`. Sau đó:
  `/v1/autocomplete` mặc định **200**, `types=area` **200**, geocode có đơn vị hành chính **200**.
  **Không nạp dữ liệu alias** — bảng old vẫn rỗng, đúng chủ trương không đưa dữ liệu chưa qua cổng
  độ phủ lên production.
  **Kiểm chứng không có hồi quy:** `88/9 Nguyễn Lâm, TP.HCM` vẫn trả `interpolated` 0,6 nên bộ lọc
  `province_norm` mà Task 5 thêm vào không giết kết quả; câu dùng tên phường **cũ** trả rỗng vì
  `ward_norm` production là tên hiện hành — đúng giới hạn đã ghi trong tài liệu và chính là thứ dữ
  liệu alias sẽ vá, không phải hồi quy mới.
  **Chốt chặn để không tái diễn:** `/healthz/db` thêm trường `schema_migration` (tên migration mới
  nhất đã áp) để phát hiện lệch giữa Worker và DB; phải truy vấn riêng có `try/catch` vì Postgres
  phân giải quan hệ ngay lúc parse nên không lồng được vào câu healthz cũ. Thêm hai itest: healthz
  phải công bố `schema_migration`, và autocomplete mặc định (có `area`) không được 5xx khi bảng old
  rỗng.
  **Chính chốt chặn đó lúc đầu cũng hỏng, và test không bắt được:** deploy xong production trả
  `schema_migration: null` vì role `api` **không có quyền SELECT** `schema_migrations` — null khi
  đó không phân biệt được "thiếu bảng" với "thiếu quyền", tức mất đúng khả năng vừa định thêm.
  Itest không bắt vì `api-db-test.mjs` cho wrangler nối bằng `POSTGRES_USER` của `.env`
  (`mapslibvn`, superuser), **không phải role `api` của production** — bài học: assertion về quyền
  chỉ đáng tin ở tầng DB test có `has_table_privilege`/`SET LOCAL ROLE`. Đã sửa: `db-migrate.mjs`
  cấp `GRANT SELECT ON schema_migrations TO api` (bọc trong `DO $$` kiểm role tồn tại để DB dev và
  dbtest không lỗi), thêm DB test `has_table_privilege('api','schema_migrations',…)` xanh sau khi
  đỏ đúng lý do, và cấp quyền trên production. Kiểm lại:
  `{"ok":true,"user":"api",…,"schema_migration":"0008_admin_old.sql"}`.

- **06/09/2026 — Alias hành chính Task 7 hoàn tất; SDK lên 0.2.0:** bốn gói core/web/react/
  react-native bump minor (deps nội bộ dùng `workspace:*` nên không có ràng buộc version phải
  đồng bộ); `dist/index.d.ts` đã xuất `AutocompleteType` có `area`, `GeocodePrecision` có
  `district`, `bbox?`, `former?`. Web component thêm **icon phân biệt loại** (`TYPE_ICON` glyph
  hình học, không dùng emoji để không phụ thuộc font hệ điều hành) và `data-type` trên mỗi option
  để tự đặt CSS; `select` vốn đã phát nguyên item và `secondary` vốn dùng `textContent` nên chỉ
  icon là phần RED thật. Playground thêm `goToArea()` gọi `map.fitBounds(item.bbox)`;
  `MapsLibVNMap.fitBounds` đã nhận đúng `[minLng,minLat,maxLng,maxLat]` nên không sửa wrapper.
  Docs: `tim-kiem.md` (bảng trường + mục "Chọn một vùng hành chính" có ví dụ fitBounds),
  `api.md` (ví dụ JSON area, `former`, `district`, ghi chú migration), `do-chinh-xac.md` (hàng
  `district` + mục địa chỉ theo đơn vị cũ), `sdk.md` (mục "Nâng từ 0.1.x lên 0.2.0"),
  `pipelines/poi/README.md` (manifest nguồn, seed override, trường report, thiếu bảng raw, lỗi
  coverage). Giữ nguyên câu "bảng alias chưa đầy đủ" vì Task 9 chưa đạt độ phủ, nhưng ghi rõ phạm
  vi đã kiểm chứng. **Không phải sửa** hai thứ plan dự kiến: `db-fixture.mjs` + coordinator đã
  truyền `--fixture` từ Task 4.6, `setup.sql` đã có old district + alias từ Task 5.7. Fixture Q1
  đã pin **có sẵn Quận 10** (alias `quan 10`, 4 đích) nên không cần mở rộng fixture; dev DB nạp
  bằng `db-migrate` + `osm-roads.mjs --fixture` + `admin.mjs --fixture` cho 54 vùng cũ và 297
  alias. Gate: unit 67 file/648 test, API 23 file/119 test, `pnpm build` 8/8, **E2E docs 27/27**
  (phải `playwright install chromium` trước — máy dev chưa có browser).
  **Việc thứ tư lộ ra ở 7.6 — gợi ý `area` gần như vô hình với `types` mặc định:** đo trên API
  local, bảy truy vấn tên quận (`Quận 10`, `Quận 3`, `Quận 4`, `Quận 5`, `Quận Bình Thạnh`,
  `Quận Phú Nhuận`, `Thành phố Thủ Đức`) **không có item `area` nào trong 10 gợi ý**; gọi riêng
  `types=area` thì trả đúng vùng kèm bbox và ba tên đích + "…". Nguyên nhân **không** phải `prior`
  (nặng 0,05 trong `COEFF`) mà vì `area-candidates.ts` trả `0 AS pop`, nên vùng mất trắng
  `0,15·pop`: area 0,76 so với POI khớp token 0,875. Vì thế E2E dùng `Phường An Lợi Đông` (phường
  cũ đổi tên → `Phường An Khánh`, area ở vị trí 0) thay `Quận 10` như plan viết. Đổi xếp hạng nên
  chờ PHONG quyết; đã ghi giới hạn vào `tinh-nang.md`.

- **06/09/2026 — Sửa hai việc 6.5 phát hiện; việc thứ ba chặn ở nguồn OSM:**
  **(1) Selectivity nhánh alias.** `areaCandidates` chia bậc: bậc 1 chỉ tiền tố, chỉ leo lên `<%`
  khi bậc 1 **rỗng** — không leo khi bậc 1 *ít* kết quả, vì `quan 10` có đúng 18 dòng tiền tố mà
  leo lên sẽ trả 11.072 dòng sim thấp, vừa chậm vừa vô ích. `<%` vẫn giữ vì là thứ duy nhất cứu lỗi
  gõ: đo trên DB toàn quốc, `quna 10` cho 0 hit tiền tố và 12 hit fuzzy. Đo lại cùng DB/dữ liệu:
  `Quận 10` 81,9 → **0,269 ms** (304×), `Tân Thành` 100,9 → **1,032 ms** (98×), alias dài 13,8 →
  **0,120 ms** (115×), `qu` 116,9 → **41,9 ms** (2,8×). Số ứng viên nhánh alias: 7.700 → 18,
  6.383 → 10, 77 → 1, 11.664 → 7.552. Trường hợp xấu nhất còn lại là `qu`, **không** do fuzzy mà vì
  7.552 alias thật sự bắt đầu bằng "qu" (grouping chiếm 37,3 ms); đề xuất bỏ nhánh alias khi query
  < 3 ký tự chưa làm vì là đánh đổi tính năng, chờ PHONG.
  **(2) `osm_admin_raw`.** `admin-overlay.mjs` kiểm `to_regclass` trước khi join; thiếu bảng thì bỏ
  nguồn `osm_tag`, in cảnh báo và ghi `report.osmTagSource={available:false,reason}`. DB test khoá
  cả hai nhánh và tái hiện đúng lỗi production (`42P01`) ở bước RED.
  **(3) Khánh Hòa — chặn ở nguồn, đã xác định dứt điểm.** OSM **không có** relation
  `admin_level=4` cho Khánh Hòa: snapshot 01/2025 chỉ có 62/63 tỉnh cũ và **không tỉnh nào tên chứa
  "Kh"**, còn OSM hiện tại truy vấn Overpass `[admin_level=4][name="Khánh Hòa"]` trả về rỗng. Nên
  cách hợp Khánh Hòa cũ + Ninh Thuận cũ cũng bất khả vì bản thân Khánh Hòa cũ vắng. Khớp đúng ghi
  chú M2 T8: `admin.mjs` chỉ nhận L6/L8 có point-on-surface trong một L4 thuộc 34 tỉnh, nên phường
  vùng này bị loại ("64 relation ngoài retained province"). 62 phường cũ Ninh Thuận trong snapshot
  khớp đúng 62 L8 unmatched của report. Ba đường ra (chờ/đóng góp OSM upstream; nguồn có giấy phép
  tương thích ODbL; bootstrap L4 bằng hợp các phường) đều cần PHONG quyết về nguồn và giấy phép.
  Gate: unit 66 file/641 test, API 23 file/119 test, API DB 3 file/29 test, `admin-old.dbtest`
  4/4 — tất cả xanh; lint và typecheck 14/14 sạch.

- **06/09/2026 — Cổng 6.5 đã đo xong ở quy mô toàn quốc; Task 0–6 đóng:** dựng DB dùng-một-lần
  `mapslibvn_alias_scale` trên **chính instance Postgres máy chủ** (chung `shared_buffers=6GB`,
  `work_mem=32MB`) thay vì đụng DB production — `apps/api/wrangler.toml` chỉ có một Hyperdrive
  `71d7a62b…` cho cả default lẫn `[env.production]`, nên DB máy chủ chính là dữ liệu production và
  alias chưa qua cổng độ phủ Task 8 không được đưa lên. Copy `admin_area` 3.288 vùng từ DB thật
  (chỉ đọc), dựng old+alias bằng `admin-old.mjs` trên snapshot đã pin `vietnam-250101.osm.pbf`
  (md5 khớp manifest): **4.900 vùng cũ (L4 62/L6 686/L8 4.152), 36.456 alias**. Đo 16 phép
  EXPLAIN ANALYZE BUFFERS (4 query × 4 nhánh), PREPARE/EXECUTE giữ bind parameter như postgres.js,
  lấy lần chạy ấm (`read=0` toàn bộ), không đụng `enable_seqscan`. Index đúng thiết kế:
  `admin_alias_trgm_idx` + `admin_alias_prefix_idx` qua BitmapOr, **không seq scan trên
  `admin_alias`**; `Seq Scan admin_area` trong join là lựa chọn đúng vì bảng chỉ 3.288 dòng.
  Thời gian full query: `qu` 116,9 ms — `Tân Thành` 100,9 ms — `Quận 10` 81,9 ms — alias dài
  13,8 ms; nhánh current luôn 0,011–1,44 ms nên **toàn bộ chi phí nằm ở nhánh alias**. Hồ sơ:
  `docs/evidence/admin-alias/6-5-explain-autocomplete-area.md`. **Ba việc lộ ra, chưa sửa:**
  (1) `<%` kém chọn lọc — `qu` khớp 11.664/36.456 dòng (32% bảng), `Quận 10` khớp 7.700 dòng dù
  đã lọc `level=6`, vì `word_similarity` bắt mọi alias chứa từ `quan`; nhánh POI có
  `useSimilarityBranch()` chặn query dài nhưng nhánh alias không chặn query ngắn → cổng 8.6
  `p95 ≤ baseline+50ms` có nguy cơ trượt, mà số đo này mới là **cận dưới** (L8 cũ 4.152 so với
  spec 10.000–10.700). (2) `admin-old.mjs` standalone **hỏng trên production**:
  `admin-overlay.mjs:163` join thẳng `osm_admin_raw`, nhưng DB production không có bảng raw nào
  (`42P01`) — mâu thuẫn Task 4.6, ảnh hưởng thứ tự phát hành 9.2. (3) `admin_area` production chỉ
  có **33/34 tỉnh**, thiếu hẳn Khánh Hòa/Ninh Thuận/Phú Yên → 70/72 vùng unmatched và `seed_miss=1`
  đều là Ninh Thuận, cổng QA alias đỏ nên chưa thể publish alias toàn quốc. Điểm sáng: cổng QA
  Task 4.5 chặn publish đúng như thiết kế và staging được dọn sạch sau lỗi (Task 4.7).

- **06/09/2026 — Alias hành chính Task 6 đã triển khai, còn cổng scale 6.5:** autocomplete
  mặc định thêm `area`; query current và alias chạy ở hai nhánh riêng rồi `UNION ALL`, gom/khử
  trùng trước LIMIT. Quận/phường cũ bị tách trả một item cùng bbox cũ và tối đa ba tên đích +
  “…”; đổi nguyên và tỉnh cũ trả vùng hiện hành với tên cũ ở secondary. Response giữ bbox, area
  không có POI id, cache giữ TTL cũ và dùng shape key `v=admin1`. Fixture có 12 đích; API unit
  23 file/116 test và API DB 3 file/29 test xanh, gồm cache hit và types filter. EXPLAIN fixture
  14 current/72 alias chạy 0,48–4,01 ms; planner chọn seq scan đúng với bảng rất nhỏ. Chưa tick
  6.5: DB staging dài hạn hiện có 3.288 current nhưng chưa có migration 0008/alias toàn quốc,
  nên chưa thể chứng minh index/timing toàn quốc mà không làm sai cổng QA nguồn. Bước code tiếp:
  Task 7 SDK/playground/docs; cổng 6.5 chạy ngay sau khi staging alias toàn quốc hợp lệ.

- **06/09/2026 — Alias hành chính Task 5 hoàn tất:** geocode phân giải alias trước thang
  rooftop → alley → interpolation → street → admin, lấy toàn bộ đích của nhóm alias thắng và
  giữ scope theo ward/province cùng polygon vùng cũ. Kết quả dùng tên hiện hành, giữ `former`;
  truy vấn chỉ có quận/phường cũ trả đúng bbox lịch sử với nhãn `(trước 07/2025)`. Fixture DB
  khóa trường hợp hai địa chỉ trùng số/đường ở hai tỉnh, ward NULL ngoài polygon và đủ bốn bậc
  rooftop/alley/interpolated/street. Suite API DB thật 3 file/27 test xanh; unit tập trung 15 test
  và typecheck xanh. Suite cũng phát hiện cache place cũ sau auto/admin approve; route giờ xóa
  cache đồng bộ để GET ngay thấy dữ liệu vừa duyệt. Bước tiếp: Task 6 autocomplete `area` có
  grouping alias cũ và bbox.

- **06/09/2026 — Alias hành chính Task 4 hoàn tất:** coordinator dựng
  current + old + alias staging rồi publish cả ba trong một transaction; standalone old+alias dùng
  cùng advisory lock. Overlay giữ riêng raw coverage/discarded share, lọc sliver L8 5%, không lọc
  các con L6, chặn khóa ngắn mơ hồ, ưu tiên seed theo cả nhóm và ghi report QA trước publish.
  Polygon DB test phủ 100%, 60/40, 96/4, thiếu 40%, overlap gấp đôi, tên trùng tỉnh và huyện 25
  con; failure injection chứng minh ba bảng published rollback cùng nhau. Fixture container dựng
  54 vùng cũ và 299 alias; chạy lại khi current ID đổi vẫn giữ đúng tên đích/FK. Unit gate gồm
  641 + 103 API tests. DB suite sạch trong pipeline container: 10 file/52 test xanh trong 549,28 s,
  gồm overlay, failure injection, lock cạnh tranh, schema, ODbL và pipeline fixture. Bước tiếp: Task 5 resolver
  scope hành chính cũ cho geocode; chưa tuyên bố độ phủ toàn quốc vì ledger Khánh Hòa còn mở.

- **05/09/2026 — Alias hành chính Task 3 hoàn tất:** downloader cache/checksum/failure-safe có
  3/3 unit tests; fixture `admin-old-q1.osm.pbf` 1.755.836 bytes được cắt từ snapshot pinned,
  SHA-256 `9aaec861475aaf03ea6286410ca1b31a3e6a408c506e43f09556ecf086ee60f1`.
  Import thật trong pipeline container dựng `osm_admin_old_raw` 54 relation: L4=1, L6=8,
  L8=45; geometry được validate trước swap. Bước tiếp: Task 4 overlay/publish nguyên tử.

- **05/09/2026 — Alias hành chính Task 2 hoàn tất:** core giữ `adminOriginal` trước khi
  canonicalize tỉnh, export `adminAliasKeys()` theo thứ tự khóa cụ thể→rộng và mở rộng type bằng
  `area`, `bbox`, `district`, `matched.former`. Focused core 57/57 và build/size-limit xanh;
  fixture parser cũ vẫn 339/341. Bước tiếp: Task 3 import snapshot.

- **05/09/2026 — Alias hành chính Task 1 hoàn tất:** migration `0008_admin_old` thêm bảng lịch
  sử, alias 1–n có share/source/provenance, index prefix/trigram, quyền API/pipeline và bảng xuất
  ODbL thứ sáu. Focused DB gate trong pipeline container: schema 7/7 và admin-old 4/4; down
  migration từ chối và rollback nguyên vẹn khi có mapping 1–n. Bước tiếp: Task 2 core keys.

- **05/09/2026 — Alias hành chính Task 0 hoàn tất:** snapshot Geofabrik 250101 đã tải và xác
  minh `306547939` bytes, MD5 `1f0fdd199d7194e515a9c4b48b3e5835`, SHA-256
  `01cc05f42f7287036d8fce59418fe98da8f5ca3ff539c9696302af922a566aad`, timestamp OSM
  `2025-01-01T21:21:00Z`. Fixture pháp lý có 60 ca tại 6 tỉnh, 6 ca tách và 10 cặp địa chỉ;
  test fixture 3/3 xanh. Ledger vẫn ghi rõ khoảng trống Jan→Jun và Khánh Hòa, nên chưa tuyên bố
  độ phủ toàn quốc. Bước tiếp: Task 1 migration 0008.

- **05/09/2026 — Đã viết plan hạng mục 1: Alias đầy đủ đơn vị hành chính cũ–mới**, theo yêu cầu
  PHONG: [plan 10 task](superpowers/plans/2026-09-05-alias-hanh-chinh-cu-moi.md), dựa trên spec đã
  duyệt và source tại `a7d34ef`. **Chưa triển khai**. Bao gồm migration 0008, nguồn/fixture có
  kiểm chứng, overlay 1–n, publication nguyên tử, scope geocode, autocomplete area, SDK/docs và
  nghiệm thu toàn quốc. Bước tiếp: **Task 0.1–0.6**, chốt snapshot/checksum và bộ ≥60 ca/≥6 tỉnh/
  ≥5 ca tách; kiểm khoảng thiếu dữ liệu trước khi gọi là “đầy đủ”. Phiên viết plan chỉ sửa tài
  liệu, chưa chạy migration/pipeline/deploy; đã rà đường dẫn, đối chiếu spec và `git diff --check`.

- Mốc: **M6 — React Native đã nghiệm thu 03/09/2026** (bảng 7/7 tiêu chí ở mục 11); spec
  (`docs/superpowers/specs/2026-09-03-react-native-sdk-design.md`) và plan
  (`docs/superpowers/plans/2026-09-03-m6-react-native.md`) đã tick trọn 16 task. Gồm:
  - **Gói** `@mapslibvn/react-native` bọc `@maplibre/maplibre-react-native` 11.3.8 —
    `<MapsLibVNMap>`, `<Marker>`, `useMap()`, `usePlaces()`, attribution không tắt được;
    `dist` tự chứa `@mapslibvn/core` (tsup `noExternal`) nên cài được khi core chưa publish
  - **App thử** `examples/embed-rn` (Expo SDK 57, ngoài workspace, cài SDK từ tarball bằng
    `npm`) mở bằng một lệnh `pnpm example:rn --ios|--android`
  - **Docs** trang `/react-native/` trên `mapslibvn-docs.pages.dev`, link check 9/9 trang
  - **Khoá `mobile`** (không kiểm origin, ghi `X-Bundle-Id` vào log và báo cáo tuần)
  - Mốc trước: **M5 — Phát hành nội bộ nghiệm thu 03/09/2026 → SPEC BẢN 2 HOÀN TẤT**;
    **M4 — Đóng góp nghiệm thu 02/09/2026**
- **Hiển thị POI tăng dần theo zoom đã phát hành production 05/09/2026** theo
  `docs/superpowers/plans/2026-09-04-progressive-poi-display.md`: priority xác định, lưới Web
  Mercator xuyên zoom, ba tầng style và SDK ẩn đủ mọi layer POI. Manifest production đang dùng
  `vn-20260827` + `poi-20260904`; archive trước `poi-20260830` còn trong R2 và đứng đầu rollback
  history.
- Plan M5: `docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md` — **10/10 task XONG**,
  nghiệm thu 5/5 hạng mục ĐẠT 03/09/2026 (bảng bằng chứng ở mục 10). Gồm: docs đủ 5 trang
  spec 7.4 + 2 trang pháp lý sinh lúc prebuild (`/dieu-khoan/`, `/thong-bao-ben-thu-ba/`,
  không commit), link check Playwright 8/8; `LICENSE` MIT + `THIRD_PARTY_NOTICES.md` đóng gói
  trong 3 gói SDK với bước CI `--check`; tenant thử nghiệm + `pnpm key:issue` cấp khoá ngẫu
  nhiên; trang nhúng độc lập `examples/embed-web` mở bằng `pnpm example:embed`;
  `pnpm export:odbl` xuất 5 bảng OSM; báo cáo tuần chạy tự động trong container `pipeline`
  (Analytics + gửi mail bằng `CF_REPORT_API_TOKEN`, manifest KV bằng `CLOUDFLARE_API_TOKEN`),
  PHONG xác nhận **đã nhận** thư
- Việc tay còn lại **không thuộc M5**: `docs/legal/checklist-phap-ly.md` mục B (6 việc cần
  luật sư, chặn thương mại hoá) và mục C (5 việc kỹ thuật còn treo)
- Plan M4: `docs/superpowers/plans/2026-09-01-m4-dong-gop.md` — **11/11 task XONG** (viết 01/09/2026,
  đã tự review 1 lượt: sửa test consensus, REVOKE PUBLIC cho hàm SECURITY DEFINER,
  ép `id::int` cho bigserial qua porsager, cwd Playwright). 10 quyết định thiết kế đã ghi
  vào mục 3; bằng chứng nghiệm thu ở mục 9
- Task cuối của M4: **Task 11 — nghiệm thu M4 XONG 02/09/2026**: custom domain
  `api.ai-solutions.io.vn`; Cloudflare Access bảo vệ `/admin` + `/v1/admin`; production DB
  đã áp dụng `0006_edits.sql` và seed `edits:write`; edit #1 auto-approved; edit #2 được
  PHONG duyệt thành POI active với reviewer đúng email. Toàn M4 gồm: migration `0006` + 3 hàm SECURITY DEFINER;
  `apps/api/src/edits/*`; `POST /v1/edits`; POI pending cho tenant tạo; Access JWT +
  `/v1/admin/*`; Access giả lập + itest 22/22; `apps/admin` SPA tại `/admin` + E2E 3/3;
  pipeline tôn trọng `locked_fields` + giữ anchor người dùng; `suggestEdit` + docs "Đóng góp")
- Mốc trước: **M2 — Kho POI + máy chủ nội bộ đã nghiệm thu 31/08/2026**, 11/11 task; plan
  `docs/superpowers/plans/2026-08-27-m2-kho-poi-may-chu.md` đã tick trọn, kết quả ở mục 7
- Commit cấu hình production M4: `5cbf1a0`; commit chốt nghiệm thu: (commit này).
  Remote trên `5cbf1a0`: CI, Deploy API, Deploy Docs, API DB và DB tests đều xanh
- Môi trường đã dựng: máy dev macOS; remote GitHub cá nhân; Postgres/PostGIS dev,
  migration `0001_extensions.sql`; `pnpm run setup` sạch đạt 6,51 giây; image
  pipeline local đã build/smoke trên arm64 và chạy được qua Compose; Dev Container
  đã dựng thành công và chạy đủ 20 test trong Linux container; CI GitHub xanh
  trên amd64 và image đã được push lên GHCR; R2 bucket `mapslibvn-tiles` (APAC),
  custom domain `tiles.ai-solutions.io.vn` (SSL active), CORS, KV
  `mapslibvn-META` và Cache Rule đã cấu hình; tiles `vn-20260827` đã publish,
  smoke 20/20 qua custom domain và manifest KV đã active; M1a/M1b đã nghiệm thu
  trên macOS arm64; Worker `api.ai-solutions.io.vn`
  (`mapslibvn-api-production.dotienphong1993.workers.dev` vẫn là route gốc)
  và docs `mapslibvn-docs.pages.dev` đã chạy production; repo GitHub chuyển **private**
  với 8 secret Actions; **M1 (M1a+M1b+M1c) đã nghiệm thu 27/08/2026**;
  **máy chủ nội bộ (compose `mapslibvn-server`) đã chạy đủ 4 dịch vụ trên chính máy dev
  (G3 — máy chủ tạm)**: `postgres` PostGIS TLS bắt buộc (không mở `ports:`), `cloudflared`
  (tunnel `mapslibvn-db`, 4 kết nối edge Singapore), `backup` daemon 03:00 VN → R2,
  `pipeline` cron thứ Hai 02:00 VN; Tunnel `maps-db.ai-solutions.io.vn` + Access application
  `mapslibvn-db` (policy Service Auth, token `hyperdrive`) + Hyperdrive
  `71d7a62b89e9462e91bb0094af1f750f` đã hoạt động — Worker `/healthz/db` qua
  `wrangler dev --remote` trả `{"ok":true,"user":"api","version":"PostgreSQL 16.4"}`;
  POI live `poi-20260830` đã publish vào manifest production;
  **PENDING Windows** (chờ PHONG có máy để kiểm)

## 2. Bước kế tiếp

- **Nguồn POI:** đã phát hành 07/09 (xem mục 1). Profile thứ ba `osm+overture` chỉ làm khi có nhu
  cầu thật (thêm một dòng vào `POI_SOURCE_PROFILES` + một lần `pnpm poi:profile`).

- **07/09/2026 — ĐÃ ĐIỀU TRA XONG `multiSourcePct` 3,3 %; chờ PHONG quyết có sửa conflate hay không.**
  Báo cáo: `docs/evidence/conflate/2026-09-07-dieu-tra-multisource-3-3.md` (đo trên production, chỉ
  đọc). Nguyên nhân chi phối **không** phải greedy: 920 cặp `sim ≥ 0,6` chưa ghép thì 92 % bị chặn
  đúng luật (xung đột số nhà 500 / tên đường 594), chỉ 73 cặp không giải thích được. Thủ phạm là
  **khoá so tên**: `NAME_FILLERS` chỉ có 13 từ thương mại tiếng Việt và `nameCore` chỉ bóc **tiền
  tố**, nên tên kiểu Overture/FSQ (từ chỉ loại ở CUỐI, tiếng Anh) không được chuẩn hoá →
  `brewbliss coffee` ↔ `brewbliss` = 0,59, **sát dưới ngưỡng 0,6**. Đo 3 lõi đô thị: 4.108 cặp nằm
  trong dải 0,30–0,60 trên 64.049 POI. "BrewBliss" tồn tại ba lần (osm/overture/fsq).
  **Đã thử và LOẠI `word_similarity`:** cứu 6/8 ca dương nhưng ghép sai **cả 2/2 ca đối chứng âm**
  (`amazing specialty coffee` ↔ `shin specialty coffee` = 0,81) — nó khớp cụm con nên cụm chỉ-loại
  dùng chung đủ vượt ngưỡng. Hướng đúng: **bóc từ chỉ loại ở cả hai đầu, hai ngôn ngữ** — 7/10, và
  là phương án duy nhất giữ được cả hai ca âm.
  **Ba rủi ro chưa giải quyết, đọc trước khi implement:** (1) danh sách từ phải tách "từ chỉ loại"
  khỏi "địa danh", nếu bóc `saigon` thì `Pizza Saigon` và `Pizza Hanoi` ghép sai; (2) `nameCore`
  dùng chung với autocomplete/search nên nên viết `conflateKey` riêng thay vì sửa `nameCore`;
  (3) gộp thêm sẽ **đổi `poi.id`** (sinh từ `hash(primary_source, source_id)`) → ảnh hưởng client
  đã lưu id và `poi_edit.poi_id` của M4, cần đường di trú.
  **Kết luận cho quyết định 07/09:** `primary_source` không phải thước đo chất lượng, nên giữ mặc
  định `all` là đúng; lọc theo nguồn là công tắc chọn dữ liệu, không phải công cụ nâng chất lượng.

- **05/09/2026 — Tìm mờ `word_similarity`: baseline trước khi đổi code.** *(ĐÃ PHÁT HÀNH — giữ lại làm bằng chứng baseline, không còn là việc chờ làm.)* Đo production
  `api.ai-solutions.io.vn` bằng `scripts/perf-autocomplete.mjs --queries scripts/fixtures/fuzzy-queries.txt`
  (40 truy vấn, khoá `mobile` của tenant …000002). Lần 1 cache lạnh: `p50=427ms p95=2156ms p99=2762ms`,
  `hit@3=36/40`. Ba trong bốn trượt là **lỗi fixture của tôi**, không phải lỗi API: tên thật là
  `Coopmart`/`Coop Mart` chứ không có dấu chấm, nên đích `co.op` không bao giờ khớp; đã sửa đích
  thành `coop`. Lần 2 sau khi sửa (cache ấm): `p50=99ms p95=186ms p99=739ms`, **`hit@3=38/40`**,
  chỉ còn trượt `cho rya` và `sieu thi co op`.

  **Baseline 38/40 đã vượt tiêu chí ≥36/40 của plan**, nghĩa là bộ 40 truy vấn HTTP này quá dễ:
  các thương hiệu ngắn và đặc trưng (`highlands`, `pharmacity`) vốn đã khớp bằng `similarity` với
  ngưỡng 0,3. Bộ này giữ lại làm đối chứng không hồi quy, **không** dùng làm bằng chứng cải thiện.

  Bằng chứng thật lấy bằng `scripts/fuzzy-ab.mjs` — so trực tiếp điều kiện cũ (`name_norm % q`) và
  mới (`q <% name_norm`) trên DB dev 79.775 POI, tính hạng POI đích trong danh sách ứng viên với
  ngưỡng cắt thật `LIMIT 20` của route:

  | Truy vấn | Hạng cũ | Hạng mới | Kiểu lỗi |
  |---|---:|---:|---|
  | `cho rya` | không thấy | 2 | lỗi gõ đảo hai ký tự |
  | `skincode` | không thấy | 1 | từ nằm giữa tên rất dài |
  | `nguyen thi minh khai cienco` | 100 | 13 | đảo từ, tên dài |
  | `laptop nhap my` | 30 | 1 | cụm giữa tên dài |
  | `nong nghiep moi truong` | 1 | 3 | tụt hạng nhưng vẫn trong 20 |

  **Cứu được 4 ca cũ rơi ngoài `LIMIT 20`; làm hỏng 0 ca cũ đang đạt.** Ba ca tụt hạng (1→3, 1→3,
  4→5) vô hại vì hạng trong SQL chỉ là ngưỡng cắt ứng viên, thứ tự cuối do `rankScore` quyết định.

- **05/09/2026 — Tìm mờ `word_similarity`: ĐÃ PHÁT HÀNH.** *(Kiểm 07/09: cả bảy commit đã push;
  `/healthz/db` trả `word_similarity_threshold: 0.5` và `schema_migration: 0008_admin_old.sql`.)* Plan
  `docs/superpowers/plans/2026-09-05-tim-mo-word-similarity.md`, Task 0–7 xong. Bảy commit: `4c56cc2` (bộ đo), `62ecebc` (format),
  `1f0cb8d` (migration 0007), `3efccd7` (healthz), `8c8e695` (fakeSql), `22eed9c` (module truy vấn),
  `8ef0b05` (route autocomplete), `52f74db` (search + geocode), `fee9daf` (docs).

  Thay `name_norm % q` bằng `q <% name_norm` ở `/v1/autocomplete`, `/v1/search` và bước khớp đường
  của `/v1/geocode`; SQL ứng viên tách ra `apps/api/src/autocomplete-sql.ts` và ba loại
  (poi/street/address) chạy **song song** thay vì tuần tự. `EXPLAIN ANALYZE` trên DB dev xác nhận
  nhánh mới vẫn **dùng chỉ số `poi_name_norm_trgm_idx`** (`Index Cond: name_norm %> 'higland'`),
  thời gian chạy 7 ms — không có nhánh nào quét bảng.

  Kiểm thật qua API dev (79.775 POI): `skincode` → "Showroom Skincode - Swiss Derma Center" hạng 1
  (trước không tìm thấy); `laptop nhap my` → "Saigon Lab - Chuyên Laptop Nhập Mỹ" hạng 1 (trước
  hạng 30, ngoài `LIMIT 20`); `coffee highlands` → Highlands Coffee hạng 1; `higland` → Highland
  Coffee hạng 2; `/v1/search?q=higlands` → Highlands Coffee, `total=118`.

  Cổng local xanh: lint 285 file, typecheck 14/14, vitest gốc 62 file/**624 test**, API 21
  file/**100 test**, docs build 20 trang.

  **Hai quyết định lệch plan, có lý do:**
  1. GUC đặt ở **cấp database** (`ALTER DATABASE … SET`) chứ không phải cấp role `api` — dev nối
     bằng user `mapslibvn` và dbtest tạo DB cô lập, cấp role chỉ phủ production. Đã sửa lại spec.
  2. `/healthz/db` dùng `current_setting('pg_trgm.word_similarity_threshold', true)` (hai tham số,
     trả NULL thay vì ném). Bản plan dùng một tham số sẽ làm `/healthz/db` trả **503** trên
     production trong khoảng thời gian giữa lúc Deploy API chạy tự động và lúc PHONG áp migration.

  **Bẫy đã gặp và cách tránh:** chạy `pnpm exec vitest --config vitest.db.config.ts` thẳng vào DB
  dev (thay vì `pnpm test:db`, vốn tạo DB cô lập `mapslibvn_task8_test`) khiến test `--down` revert
  sạch schema và **xoá toàn bộ dữ liệu fixture dev**. Hồi phục đủ bằng `pnpm db:fixture` trong
  119 giây, số liệu về đúng như cũ (79.775 POI, 1.094 street, 43.094 anchor). Luôn dùng
  `pnpm test:db`.

  Test `--down` trong `db/schema.dbtest.mjs` đếm số migration sau 0001, nên thêm 0007 phải sửa
  `i < 5` thành `i < 6` — mọi migration sau này đều phải sửa chỗ này.

  **Đã phát hành `d5ba3f9` lúc 18:24.** Cả năm workflow xanh: CI `33963237070`, Deploy API
  `33963237038`, Deploy Docs `33963237092`, API tests (Places, real DB) `33963237098`, và
  DB tests `33963237109` (chạy trong image pipeline nên `pipeline-fixture` có tippecanoe và
  không bị skip như trên máy dev). Production chạy code mới; `skincode` nay trả đúng
  "Showroom Skincode - Swiss Derma Center" trong khi trước đó trả Skin79/SKINJAM.

  **Migration 0007 CHƯA áp lên production** — `/healthz/db` trả `"word_similarity_threshold":null`,
  tức ngưỡng đang là mặc định 0,6. Hai lý do:
  1. `pnpm server:update` **không chạy được, và không liên quan gì tới thay đổi này**:
     `infra/server/.env` đặt `PIPELINE_IMAGE=mapslibvn/pipeline:local` (image dựng tại máy hôm
     04/09 cho arm64), nên `docker compose pull` đi tìm `mapslibvn/pipeline` trên Docker Hub và
     nhận `pull access denied`. Script dừng ngay ở bước pull, **không đụng container nào** —
     cả 4 container vẫn `Up`. Muốn `server:update` chạy lại được thì phải hoặc đẩy image arm64
     lên GHCR rồi trỏ `PIPELINE_IMAGE` về đó, hoặc cho script bỏ qua `pull` khi image là local.
  2. Ghi thẳng SQL vào DB production bị chính sách chặn (đúng), nên không có đường vòng.

  **Số đo sau phát hành, cache lạnh** (cùng lệnh, cùng bộ 40 truy vấn):

  | | baseline (code cũ) | sau (code mới, ngưỡng 0,6) |
  |---|---:|---:|
  | p50 | 427 ms | **270 ms** |
  | p95 | 2156 ms | **808 ms** |
  | p99 | 2762 ms | **1148 ms** |
  | hit@3 | 38/40 | 35/40 |

  Độ trễ giảm 62 % ở p95 — đó là phần chạy song song ba loại truy vấn, không phải phần `<%`.

  **hit@3 tụt 38 → 35 là hồi quy thật, cần quyết định.** `word_similarity` giữa truy vấn và tên
  đích cho thấy nguyên nhân là ngưỡng, không phải thuật toán:

  | truy vấn | word_similarity | qua 0,6 | qua 0,5 |
  |---|---:|---|---|
  | `cho rya` | 0,625 | có | có |
  | `phuc lonh` | 0,800 | có | có |
  | `nguyne hue` | 0,571 | **không** | có |
  | `winmrt` | 0,571 | **không** | có |
  | `higland` | 0,455 | không | **không** |
  | `cirlce k` | 0,385 | không | **không** |

  Áp 0007 (ngưỡng 0,5) cứu `nguyne hue` và `winmrt`. Còn `higland` (thiếu 1 ký tự) và `cirlce k`
  (đảo 2 ký tự) trên **từ ngắn** thì `<%` ở mọi ngưỡng hợp lý đều không cứu, trong khi toán tử `%`
  cũ ở ngưỡng 0,3 lại bắt được. Nói cách khác: đổi `%` sang `<%` **đánh đổi** recall của lỗi gõ
  trên từ ngắn để lấy độ chính xác và khả năng tìm từ nằm giữa tên dài.

  **Đã xử lý xong cả hai việc treo, PHONG chọn "làm giúp tôi" — xem mục kế tiếp.**

  **Ba lựa chọn đã cân nhắc:**
  - **(a) Giữ cả hai**: `WHERE q <% name_norm OR name_norm % q OR name_norm LIKE 'q%'`. Lấy được
    cả recall cũ lẫn năng lực mới; đổi lại nhiều ứng viên hơn nên có thể ăn bớt phần độ trễ vừa
    giành được. Sửa nhỏ, một dòng mỗi truy vấn, nhưng ngược với khẳng định "không còn toán tử `%`"
    trong plan và test đang khoá điều đó.
  - **(b) Hạ ngưỡng xuống ~0,45** trong 0007 thay vì 0,5: cứu thêm `higland`, vẫn trượt `cirlce k`,
    và nới lỏng cho mọi truy vấn nên dễ nhiễu hơn.
  - **(c) Giữ nguyên**, chấp nhận đánh đổi, để dành cho hạng mục 3 (bậc 2 tsvector token và bậc 3
    khoá ngữ âm mới là chỗ xử lý đúng lớp lỗi này).

  Khuyến nghị: **(a)** rồi đo lại — nó phục hồi recall mà không phải đoán ngưỡng, và nếu p95 tăng
  quá thì mới cân nhắc bỏ.

- **05/09/2026 — Đóng cả hai việc treo của tìm mờ.** PHONG chọn làm luôn. Hai commit:
  `fcbe06e` (giữ cả hai toán tử) và `1597bcb` (sửa `server:update`).

  **Việc 1 — hồi quy hit@3.** Chọn phương án (a): mệnh đề WHERE giữ **cả ba nhánh**
  `q <% name_norm`, `name_norm % q` và `name_norm LIKE 'q%'`, áp cho `/v1/autocomplete`,
  `/v1/search` và fallback đường của `/v1/geocode`. Bỏ nhánh `core` khi `nameCore` trùng
  `normalizeVi` (đa số truy vấn) để khỏi làm việc thừa.

  Chi phí đo trên DB dev, cache ấm, cùng truy vấn `higland`:

  | biến thể | thời gian |
  |---|---:|
  | chỉ `%` (mã trước 05/09) | 6,8 ms |
  | chỉ `<%` | 1,5 ms |
  | cả hai (đang dùng) | 5,5 ms |

  Tức bản cuối vẫn **nhanh hơn mã cũ**, chỉ đắt hơn bản chỉ-`<%` khoảng 4 ms. `EXPLAIN` cho thấy
  mọi nhánh đều chạy trên `poi_name_norm_trgm_idx` qua `BitmapOr`, không nhánh nào quét bảng.

  `scripts/fuzzy-ab.mjs` nay so **ba** biến thể và thêm 4 ca lỗi gõ trên từ ngắn. So với mã cũ:
  cứu 3 ca, hỏng 0 ca. Cột "chỉ`<%`" là bằng chứng vì sao phải giữ `%`: `cirlce k` **không tìm
  thấy** ở cột đó nhưng hạng 2 ở cột "cả hai". Kiểm qua API dev, cả bảy ca đều đúng, gồm ba ca
  trước đây trượt (`cirlce k`, `winmrt`, `nguyne hue`) lẫn ba ca năng lực mới (`skincode`,
  `laptop nhap my`, `coffee highlands`).

  Một ca **không** cứu được: `nguyen thi minh khai cienco` ở hạng 95 với cả hai toán tử, so với 13
  khi chỉ dùng `<%` — nhánh `%` kéo thêm đối thủ chen lên. Hạng 95 vẫn bằng mã cũ (100) nên không
  phải hồi quy so với production trước hôm nay. Đã thử đổi `ORDER BY` sang `word_similarity DESC,
  similarity DESC`: chỉ nhích 95→92 mà làm `cho rya` tệ đi 1→3, nên giữ `greatest(...)`.

  **Việc 2 — `server:update` và migration 0007.** Nguyên nhân đã sửa tận gốc: thêm `pullPlan()`
  vào `scripts/lib/server-env.mjs`, khi `PIPELINE_IMAGE` có tag `:local` thì chỉ
  `docker compose pull postgres cloudflared`, không pull image dựng tại máy. Có 3 test đơn vị.
  Quy trình chạy thật: `pnpm image:build` (image mới có 0007) rồi `pnpm server:update` — lệnh
  chạy trọn, chỉ `pipeline` và `backup` bị tạo lại, **`postgres` và `cloudflared` vẫn `Up`**,
  và `[db:migrate] Áp dụng 0007_word_similarity_threshold.sql … Xong`.

  **Việc 3 — chi phí của nhánh `%` ở quy mô thật, phát hiện sau khi deploy `fcbe06e`.** Đo lại
  production thấy hit@3 hồi phục 35 → 37 nhưng **p95 vọt lên 2420 ms**, tệ hơn cả baseline.
  `EXPLAIN ANALYZE` trên DB production 1,5 triệu POI chỉ đúng thủ phạm: chi phí nhánh `%` tăng
  theo số trigram của truy vấn, và với truy vấn dài nó quét tới **127.151 dòng chỉ số**.

  | truy vấn | độ dài | chỉ `<%` | thêm `%` |
  |---|---:|---:|---:|
  | `cirlce k` | 8 | — | 37 ms |
  | `higland` | 7 | — | 120 ms |
  | `phuc long coffee` | 16 | 196 ms | **1355 ms** |
  | `nguyen tieu hoc truong` | 22 | — | **2381 ms** |

  DB dev nhỏ hơn 19 lần nên không lộ ra: cùng phép đo ở đó chỉ 5,5 ms so với 6,8 ms.

  Sửa ở `79ba24f`: **chỉ thêm nhánh `%` khi truy vấn ≤ 12 ký tự** (`useSimilarityBranch()` trong
  `apps/api/src/autocomplete-sql.ts`, dùng chung cho autocomplete, search và geocode). Đúng chỗ
  `<%` bất lực (lỗi gõ từ ngắn) và cũng đúng chỗ `%` còn rẻ; truy vấn dài vốn đã được `<%` phục vụ
  tốt. Ngưỡng 12 phủ mọi ca trong fixture: `winmrt` 6, `higland` 7, `cho rya` 7, `cirlce k` 8,
  `phuc lonh` 9, `nguyne hue` 10.

  **Số đo cuối cùng trên production**, ba lần chạy cache lạnh hoàn toàn (40 truy vấn, `near` khác
  nhau mỗi lần để không dính cache 10 phút):

  | lần | p50 | p95 | p99 | hit@3 |
  |---|---:|---:|---:|---:|
  | 1 | 680 ms | 1910 ms | 3149 ms | 37/40 |
  | 2 | 610 ms | 1782 ms | 3073 ms | 37/40 |
  | 3 | 565 ms | 2055 ms | 3224 ms | 37/40 |

  So với baseline (n=80 nửa nóng nửa lạnh, p95 2156 ms và các mẫu lạnh 2,1–2,8 giây) thì bản cuối
  nhanh hơn rõ. **Cảnh báo về cách đo:** đừng so p95 giữa các lần chạy khác methodology — lần
  `n=80` có một nửa mẫu là cache hit nên p95 thấp giả tạo. Chỉ so các lần cùng `n=40` toàn lạnh.

  Ba ca còn trượt: `higland` và `sieu thi co op` là **lỗi đích trong fixture** chứ không phải lỗi
  API (production có POI đặt tên đúng chữ "Higland" nên chúng xếp trên "Highlands"; `sieu thi co op`
  trượt từ baseline). Còn `cho rya` là vấn đề xếp hạng: recall có nhưng hàng trăm POI tên "Chợ …"
  chen lên trên. Cả ba để lại cho hạng mục 3.

  **Bẫy Hyperdrive cần nhớ:** ngay sau khi áp migration, `/healthz/db` vẫn trả
  `"word_similarity_threshold":0.6` trong khi `pg_db_role_setting` đã là 0,5 và phiên psql mới đọc
  đúng 0,5. Lý do: `ALTER DATABASE … SET` chỉ áp cho **phiên mới**, còn Hyperdrive gộp và tái dùng
  kết nối có từ trước. Đây là hành vi bình thường, không phải migration hỏng — kiểm bằng psql
  trước khi kết luận. Đã thử hai lần Deploy API (`1597bcb`, `79ba24f`) mà vẫn 0,6, nên pool nằm
  phía Cloudflare và **sống qua cả lần deploy worker**; nó sẽ tự xoay vòng theo thời gian. Chưa
  cần can thiệp: nhánh `%` đã lo phần lỗi gõ từ ngắn nên chênh lệch 0,6 với 0,5 hiện không ảnh
  hưởng hit@3. Muốn ép ngay thì phải `pg_terminate_backend` các kết nối của user `api`.

- **05/09/2026 — Progressive POI production release `poi-20260904`.** User phê duyệt release
  riêng; code phát hành ở `f1adb213f9524c49bc62959cddb1359e455ecdf5`. Remote gate đúng SHA:
  CI + image smoke [33851729860](https://github.com/dotienphong/maps-library-vietnam/actions/runs/33851729860),
  API real-DB [33851729884](https://github.com/dotienphong/maps-library-vietnam/actions/runs/33851729884),
  Deploy API [33851729949](https://github.com/dotienphong/maps-library-vietnam/actions/runs/33851729949)
  và DB integration 27m15s [33851729814](https://github.com/dotienphong/maps-library-vietnam/actions/runs/33851729814)
  đều xanh. CI ban đầu trên `e4ce269` lộ test seed đọc font vendor bị gitignore; sửa TDD để sprite
  vẫn bắt buộc, font vendor chỉ seed khi tồn tại, rồi local gate đạt lint 281 file, typecheck 14/14,
  root 62 file/**622 test** và API 20 file/95 test.

  Máy chủ tạm là arm64 trong khi GHCR CI hiện chỉ publish `linux/amd64`, nên `pnpm server:update`
  dừng an toàn tại pull trước compose-up. Đã build/smoke image ARM native từ đúng checkout
  `f1adb213`, recreate riêng `pipeline`/`backup`, giữ Postgres và tunnel đang chạy; container dùng
  image digest `sha256:4c986846636fa9c3d9e8187e784204f99ed881b5c35694c08eb4c18026543470`,
  Postgres healthy và migration báo 0 bản mới.

  Export production DB đọc **1.515.984 active**, chọn **255.848**, thinning **1.260.136**,
  `rankFallback=0`, `invalidCoordinates=0`; minzoom z10→z16 là
  **622 / 895 / 5.098 / 12.589 / 29.919 / 77.947 / 128.778**. Archive **63,8 MiB**
  (66.924.565 byte, dưới trần 300 MiB), QA style/sovereignty xanh và R2 custom-domain smoke đạt
  **19/20 tile dữ liệu**. Range request production trả `206`, `Content-Range:
  bytes 0-16383/66924565`.

  Visual Chromium 1000×800 chụp đủ **4 địa bàn × 5 zoom × 2 theme = 40 ảnh** trước khi đổi
  manifest. Mỗi ô dưới là tổng symbol POI render `cũ → mới`; light/dark candidate cho cùng kết quả:

  | Địa bàn | z10 | z12 | z14 | z15 | z16 |
  |---|---:|---:|---:|---:|---:|
  | TP.HCM | 186→10 | 368→12 | 292→21 | 256→26 | 136→27 |
  | Hà Nội | 188→10 | 355→11 | 271→18 | 302→27 | 225→33 |
  | Đà Nẵng | 41→8 | 210→13 | 241→15 | 124→22 | 47→19 |
  | Đồng Tháp nông thôn | 39→9 | 61→7 | 7→11 | 8→5 | 2→2 |

  Candidate 40/40 viewport `loaded` + `tilesLoaded=true`; nhãn local bằng 0 trước z16, major chỉ
  rank 1–2, local chỉ rank 3–5, không thấy overlap hay dải icon sau pan 256px qua biên tile.
  Click trả đúng `Trường Trưng Vương` id `5XB2X3G9YZH8J70K4FGBQ2A7HK`; `poi=0` ẩn và render 0
  cho cả ba layer; `lang=en` tải xong; console không có error.

  Sau khi set manifest, style light/dark đều trỏ `poi-20260904`; kiểm lại public URL
  `https://mapslibvn-docs.pages.dev/playground.html` không `?api=` đạt 40/40 viewport, click,
  dark, `poi=0`, console sạch và API `/healthz` xanh. Rollback drill logic: `release:history[0]`
  chứa nguyên manifest trước `{vn:vn-20260827, poi:poi-20260830}`; không xoá archive cũ.

- **04/09/2026 — Progressive POI candidate local.** Contract tile thêm `r` (rank 1–5), `d`
  (display sort key) và `tippecanoe.minzoom`; `popularity` chỉ tham gia xếp hạng nội bộ, không xuất
  vào tile. Style tách `poi` icon-only z10, `poi-label-major` z12 và `poi-label-local` z16;
  `poiLayer:false` ẩn cả ba nhưng click vẫn query đúng layer icon `poi`. Fixture DB cô lập đọc
  **78.122 active**, chọn **2.136**, thinning **75.986**, `invalidCoordinates=0`; phân bổ minzoom
  z10→z16 là **5 / 2 / 8 / 9 / 21 / 981 / 1.110**; PMTiles **401.489 byte**. Test fixture còn
  chứng minh POI bị thinning vẫn `active`, mỗi display cell chỉ có một feature ở mọi zoom và
  archive thật giữ `r/d`. Trạng thái lịch sử này đã được release production ngày 05/09/2026 như
  mục ngay phía trên.

  Full gate local: lint **281 file**, typecheck **14/14 task**, Vitest root **62 file / 621 test**,
  API **20 file / 95 test**, build **8/8 task** và docs **20 trang**, Playwright mặc định **26/26**;
  Playwright chạy lại với `poi-fixture.pmtiles` cũng **26/26**. Full DB run có **42 test qua** và
  lộ đúng 1 lỗi đường dẫn fixture; sau khi sửa, riêng test fixture chạy lại đạt **4/4**. Visual
  smoke dùng Chromium viewport 1000×800, tâm `106.709006,10.784050`:

  | Theme | Zoom | Icon `poi` | Nhãn major | Nhãn local |
  |---|---:|---:|---:|---:|
  | light | 10 | 4 | 0 | 0 |
  | light | 12 | 0 | 5 | 0 |
  | light | 14 | 2 | 18 | 0 |
  | light | 15 | 2 | 25 | 0 |
  | light | 16 | 1 | 21 | 5 |
  | dark | 10 | 4 | 0 | 0 |
  | dark | 12 | 0 | 5 | 0 |
  | dark | 14 | 2 | 18 | 0 |
  | dark | 15 | 2 | 25 | 0 |
  | dark | 16 | 1 | 21 | 5 |

  Số symbol sau collision không phải golden count. Nhãn major quan sát chỉ có rank 1–2; nhãn
  local chỉ xuất hiện ở z16 và có rank 3–5; không thấy dải icon ở biên tile trên light/dark.
  Click icon `Trường Trưng Vương` trả đủ id `5XB2X3G9YZH8J70K4FGBQ2A7HK`, name, `park` và
  `culture_tourism`; `poi=0` đặt `visibility:none` và rendered count 0 cho cả ba layer;
  `lang=en` vẫn báo `loaded`. Visual QA còn bắt được seed local thiếu sprite/font: đã thêm bốn
  sprite osm-liberty và bốn glyph range tiếng Việt tối thiểu để preview dùng asset thật như
  production.

- **04/09/2026 — sửa ghi nguồn hiện hai lần trên bản đồ.** Trước đó `AttributionControl` hiển thị ba
  khối: hai khối do từng source trong style tự khai, một khối do SDK thêm bằng `attributionHtml()`,
  nên OpenStreetMap, OpenMapTiles, Overture và Foursquare mỗi bên hiện hai lần. **Cách sửa cuối cùng:
  cả hai phía dùng CHUNG một chuỗi.** MapLibre gộp các chuỗi ghi nguồn trùng khít nhau (đã kiểm bằng
  thí nghiệm riêng: 3 chuỗi giống hệt → hiển thị 1 lần), nên `transformStyle`/`addPoiLayers` nhận
  `attribution` từ ngoài và `scripts/build.mjs` truyền `attributionHtml()` của `@mapslibvn/core` vào,
  còn `createMap` giữ nguyên `attributionHtml()`. Kết quả: một nguồn sự thật duy nhất, hiển thị đúng
  một lần, và **mỗi phía tự đủ** — nạp style thẳng vào maplibre-gl thuần vẫn có ghi nguồn, mà ẩn lớp
  POI hay thiếu bản POI trong manifest cũng không mất bên nào.
  **Đã thử hướng khác rồi bỏ:** ban đầu cho SDK chỉ thêm `© MapsLibVN` cho theme của mình và để style
  lo phần dữ liệu (commit `bf4ee25`). Đo trên production thấy `?poi=0` (`poiLayer: false`) làm mất
  ghi nguồn Overture và Foursquare, vì MapLibre bỏ attribution của source không có lớp nào hiển thị —
  trong khi ứng dụng vẫn có thể đang hiện kết quả Places API của hai nguồn đó. Hướng dùng chung chuỗi
  không có lỗ hổng này.
  Ràng buộc phải giữ: chuỗi ở style và ở SDK **không được lệch một ký tự**, lệch là hiện hai lần —
  hai test trong `packages/style` khoá điều này bằng cách so thẳng với `attributionHtml()`.
  `packages/style` nay có devDependency `@mapslibvn/core` chỉ để build và test lấy chuỗi; template
  vẫn là JSON tĩnh nên Worker không bundle thêm gì. Sửa kèm: spec mục 7.2, `sdk.md`, `tinh-nang.md`,
  `cai-dat.mdx`, `giay-phep.md`. **React Native không đổi** — bản đó vẽ overlay riêng cộng nút thông
  tin native, không chồng nhau. Khuyến nghị còn treo: khoá `web` vẫn được cho qua khi không có Origin
  (chủ ý MVP).


- **04/09/2026 — Website docs hoàn chỉnh (chưa commit, chờ PHONG duyệt).** Rà soát toàn hệ thống rồi
  viết spec `docs/superpowers/specs/2026-09-04-docs-site-hoan-chinh-design.md` và plan
  `docs/superpowers/plans/2026-09-04-docs-site-hoan-chinh.md` (Fable 5.1 lập, Opus 5 thực hiện 5 task).
  Kết quả: 9 trang mới (`/tinh-nang/`, `/cai-dat/`, `/khoa-api/`, `/ban-do-web/`, `/tim-kiem/`,
  `/react/`, `/api/`, `/sdk/`, `/nhung-thu/`), sidebar 6 nhóm, trang chủ có bản đồ sống (iframe
  `/playground.html?embed=1`) + 6 card + 3 tab nhúng + trạng thái dự án; playground viết lại
  (`public/playground.{html,js,css}` + `playground-lib.js` thuần có 25 test Vitest) với 4 tab Bản đồ /
  Tìm kiếm / Geocode / Mã nhúng, nhập khoá riêng, URL chia sẻ được, vòng tròn ước lượng theo
  `precision`; sửa lỗi `/react-demo/` trỏ `localhost:8787` trên production (`src/lib/api-base.ts`);
  `bat-dau.md` không còn viết `pnpm add` như đã publish. Gate: lint 275 file, typecheck 14/14, vitest
  59 file / 607 test, build 20 trang, Playwright 26/26 (19 docs + 7 playground, API local `dev:e2e`).
  Hai khuyến nghị **chưa thực hiện** chờ quyết định: attribution hiện hai lần trên bản đồ (style nguồn
  + `customAttribution` — spec 7.2), và khoá `web` được cho qua khi không có Origin (chủ ý MVP).


**BẮT ĐẦU TỪ ĐÂY: không còn mốc định nghĩa sẵn.** M1–M6 đều đã nghiệm thu. Việc còn lại là việc
tay trong `docs/legal/checklist-phap-ly.md`. Mốc mới phải brainstorm + viết spec trước khi viết plan.

**Trạng thái checklist tại 04/09/2026:**
- **C4 XONG** — pepper bí mật cho `ip_hash`/`end_user_hash`.
- **B3 đã chuẩn bị hồ sơ** (`docs/legal/b3-ra-soat-nhan-hieu.md`), **chưa xong**: còn hai việc chỉ
  người làm được — tra WIPO Global Brand Database + Cục SHTT, và gửi thư hỏi `team@maplibre.org`
  (mẫu thư có sẵn trong hồ sơ). Xong B3 mới publish 4 gói npm (`@mapslibvn/*` hiện còn trống chỗ
  trên registry, kiểm 04/09); `@mapslibvn/react-native` hiện chỉ cài được từ tarball.
- Còn treo: B1, B2, B4 (cần luật sư), B5, B6 (cần tiền/quyết định), C1 (cần máy Windows), C2, C3
  (cần nguồn dữ liệu mới + chạy lại pipeline), C5 (chờ cron `data:update` thứ Hai 02:00 giờ VN).

**Lịch sử M6 (đã xong 03/09/2026)** — plan `docs/superpowers/plans/2026-09-03-m6-react-native.md`
(16 task, spec + plan đều đã duyệt). Task 0: git sạch trên `main`, identity cá
nhân OK; CI remote của `471bd92` xanh; gate local xanh (lint 243 file, typecheck 13 task, vitest
root 49 file / 529 test, API 19 file / 87 test); Xcode 26.6 + 6 simulator iOS có, Android SDK có
với AVD `Pixel_7`, Node v22.23.2. Task 1: `ClientOptions.headers` trong `@mapslibvn/core`.
Task 2: `PoiFeature` chuyển vào core, web re-export. Task 3: `localizeStyle`/`hidePoiLayer`
trong core, web dùng lại `isNameLabelLayer`. Task 4: khung gói `packages/react-native` + notices 4 gói. Task 5: `toPoiFeature`. Task 6: `MapHandle`/`MapContext` + `usePlaces`. Task 7: mock + `Attribution`. Task 8: `useResolvedStyle`. Task 9: `<MapsLibVNMap>` + `useMap`. Task 10: `<Marker>`. Task 11: `src/index.ts` xuất khẩu công khai; `dist` tự chứa cả JS lẫn `.d.ts` (`@mapslibvn/core` chuyển sang `devDependencies` + `dts: { resolve: ['@mapslibvn/core'] }` — nếu để ở `dependencies` như plan viết thì tarball sẽ đòi npm cài `@mapslibvn/core@0.1.0` chưa publish). Task 12: `pnpm example:rn` (`resolveKey` nhận `envName`/`hint` và bỏ nháy bao quanh; `scripts/lib/example-rn.mjs` + `scripts/example-rn.mjs` build → `pnpm pack` → ghi `.env` app → `npm install` tarball → `npx expo run:<platform>`). Task 13: `examples/embed-rn` — Expo SDK 57 (React 19.2.3, RN 0.86.3) ngoài workspace, bundle id `vn.mapslibvn.demo`, `App.tsx` có tìm kiếm + `<Marker>` + nút theme/lang, cài SDK từ tarball bằng `npm` (chứng minh dist tự chứa); `npx expo-doctor` 21/21 xanh sau khi gỡ `newArchEnabled` (SDK 57 đã bỏ khoá này) và `npx tsc --noEmit` của app sạch; `pnpm pack` phải chạy trong thư mục gói vì pnpm không nhận `--filter` cho `pack`. Gate: lint 267 file, typecheck 14 task, vitest root 57 file / 575 test, API 19 file / 87 test. Task 14: khoá `mobile` đã cấp; chạy thật iOS 26.1 (iPhone 17 Pro) + Android Pixel 7, 8 ảnh bằng chứng, nghiệm thu 1–5 ĐẠT — chi tiết và 4 lỗi phát hiện khi chạy thật ở mục 11. Task 15: trang docs `/react-native/` (RED link check trước, rồi sidebar + `bat-dau.md` mục 2b + Card trang chủ → 9/9 trang xanh), spec gốc bảng 13 thêm hàng M6, roadmap mục 0.4 hàng 7 và mục 7 tick, DEVLOG đóng mốc.

Khoá `mobile` đã cấp 03/09/2026 (đuôi `…7z1U`, tenant `…000002`) và ghi vào `.env` gốc thành
`KEY_EXAMPLE_RN` — chạy `scripts/api-key-issue.mjs` bằng superuser `mapslibvn` qua Tunnel trong
container `pipeline` (role `api`/`pipeline` chỉ có SELECT trên `api_key`). Không còn việc tay nào
chặn M6.

**Spec bản 2 đã hoàn tất 03/09/2026** — M1 đến M5 đều nghiệm thu; roadmap
`docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md` mục 7 đã tick trọn, thêm dòng M6.

Trước khi bắt đầu, đọc `docs/legal/checklist-phap-ly.md`: mục B là 6 việc cần luật sư trước khi
thương mại hoá, mục C là 5 việc kỹ thuật còn treo (Windows, QA Hoàng Sa, alias phường xã 2025,
pepper cho `ip_hash`, kiểm đóng góp M4 sau `data:update` kế tiếp).

**M4 Task 11 xong 02/09/2026.** Tạo custom domain `api.ai-solutions.io.vn`; một Cloudflare
Access application bảo vệ hai path `/admin` và `/v1/admin`, policy email PHONG 24 giờ; Worker
production nhận `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`. Production DB ban đầu mới ở migration
`0005`, khiến smoke đầu tiên trả 503; đã xác định bằng schema/GRANT, áp dụng transactional
`0006_edits.sql` bằng DB owner rồi seed scope. Edit #1 sửa giờ POI quality 87 →
`auto_approved`, API đọc ngay `Mo-Su 07:00-22:00`; edit #2 tạo POI bằng tenant free → pending,
thu hồi scope tạm → PHONG duyệt qua Access → POI active, reviewer đúng email. Chi tiết mục 9.

**M4 Task 10 xong 01/09/2026.** `packages/core`: thêm `suggestEdit` (client giờ có 9 phương thức)
cùng types `EditKind`/`EditChanges`/`SuggestEditRequest`/`SuggestEditResponse`; tách `parseOrThrow`
dùng chung cho `get`/`post` nên bỏ được khối đọc lỗi trùng lặp. Bundle core 6,54 kB gzip (budget 8).
Trang docs `dong-gop.md` (bảng 5 `kind`, danh sách trường `changes` hợp lệ, luật duyệt, giới hạn
20/ngày/end-user + 500/ngày/key, ví dụ bắt `MapsLibVNError`) và thêm vào sidebar. 4 test mới —
có ca `create` và ca body lỗi không phải JSON mà trước đây chưa test nhánh `catch` của `parseOrThrow`.
Gate: core 327 test, root 490/490, api 87/87, docs build 5 trang, lint 225 file.

**M4 Task 9 xong 01/09/2026.** `publish.mjs` giờ dùng `CASE WHEN '<cột>' = ANY(p.locked_fields)`
cho 11 cột của `poi` nên pipeline không ghi đè trường người dùng đã sửa, và không đóng POI có
`'status'` trong `locked_fields` khi POI vắng mặt ở nguồn. `anchors.mjs` chép mốc `source='user'`
(confidence 0,95) sang `address_anchor_new` trước khi hoán đổi bảng — đặt sau bước gán
ward/province để giữ giá trị người dùng. `pipelines/poi/tests/edit-lock.dbtest.mjs` 3/3.
Hai điều khác plan: fixture `poi_work_record` phải có thêm cột `confidence` (publish.mjs dùng khi
dựng lại `poi_source_link`), và tôi thêm một test cho nhánh `status` bị khoá mà plan chưa có.
`pnpm test:db`: 38 passed / 3 skipped; `pipeline-fixture` vẫn đỏ trên máy dev vì thiếu
`tippecanoe` (chạy trong image GHCR trên CI).

**M4 Task 7 + 8 xong 01/09/2026.** `apps/admin` là SPA Vite + React 18 (`base:'/admin/'`,
`outDir dist/admin`, 146 kB / 47 kB gzip): danh sách edit theo `status`, nút Duyệt/Từ chối, báo
lỗi HTTP ra UI. Worker phục vụ nó qua `[assets] directory = "../admin/dist"` trong `wrangler.toml`
(cả `[env.production]`) — đã kiểm thật là assets **không che** `/healthz`, `/v1/*` hay 404-JSON.
`deploy-api.yml` + script `test` gốc + `api-db-test.mjs` đều build admin trước; `apitest.yml` chạy
thêm `pnpm test:admin-e2e`. E2E Playwright 3/3 với Access giả lập: bấm Duyệt trên trang thật →
POI `active` qua API; bấm Từ chối → POI 404; không JWT → 401. **Ba lỗi thật đã sửa:**
`test.use({extraHTTPHeaders})` không áp cho `fetch()` của trang (phải `page.setExtraHTTPHeaders`);
`access-fake.mjs` đọc `.cache/` theo cwd nên Playwright sinh cặp khoá thứ hai và JWT sai chữ ký
(sửa: đường dẫn tuyệt đối từ `import.meta.url`); `webServer` thiếu `gracefulShutdown` nên
Playwright treo sau khi test đã xanh. Gate: root 486/486, api 87/87, api-db 22/22, E2E 3/3,
typecheck 13 task, lint 223 file.

**M4 Task 5 + 6 xong 01/09/2026.** `apps/api/src/access.ts` verify JWT Cloudflare Access
(RS256 bằng WebCrypto, JWKS từ `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` cache KV 1 giờ, kiểm
`aud` + `exp` + `email`), mã lỗi mới `missing_access_jwt`/`invalid_access_jwt`.
`apps/api/src/routes/admin.ts`: `GET /v1/admin/edits?status=`, `POST /v1/admin/edits/{id}/approve`
và `/reject` — reviewer lấy từ email trong JWT. Vars mới `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`
(+`ACCESS_CERTS_URL` chỉ để test). `scripts/lib/access-fake.mjs` sinh cặp RSA lưu `.cache/`
(gitignored), phục vụ JWKS và ký JWT cho itest/E2E; `api-db-test.mjs` chạy nó và thêm mode
`--serve` cho Playwright ở Task 8. **Lỗi kiến trúc test đã sửa:** JWKS server ban đầu nằm cùng
tiến trình harness, mà harness gọi vitest bằng `spawnSync` (chặn event loop) → 4 test admin
timeout 30 s dù Worker đúng (curl trả 401 trong 3 ms). Phải cho access-fake chạy **tiến trình
riêng**. Gate: api 19 file/87 test, `pnpm test:api-db` 3 file/22 test, root 486/486, lint 217 file.

**M4 Task 4 xong 01/09/2026.** `GET /v1/places/{id}` thêm nhánh POI `status='pending'`: chỉ hiện
cho tenant đã gửi edit `kind=create` (spec 6.5), truy vấn thẳng không cache vì phụ thuộc tenant;
nhánh này chỉ chạy khi nhánh cache trả 404 và `cachedJson` không cache lỗi < 500 nên cache không
bị đầu độc. `apps/api/test-db/edits.itest.mjs` (6 test, DB thật): internal sửa hours →
`auto_approved` và thấy ngay qua API; tenant free tạo POI → `pending`, chỉ tenant tạo thấy, không
lộ qua `/v1/search`, duyệt bằng `apply_poi_edit` → `active`; free sửa name → `pending`; đồng thuận
2 end-user → phiếu thứ hai `auto_approved` kéo phiếu đầu thành `auto:consensus`; 21 edit/ngày →
429; POI closed thì `update` → 400 còn `reopen` → `active`. Hai điều khác plan: khoá seed
`mlv_live_edit0…` trong plan thiếu 1 ký tự (CHECK đòi đúng 24 sau prefix) và test scope 403 trong
itest bị bỏ vì KV cache auth 5 phút làm nó không dứt khoát (đã phủ ở tầng workers).
Gate: `pnpm test:api-db` 18/18, api 79/79, root 486/486, typecheck sạch, lint 212 file.

**M4 Task 3 xong 01/09/2026.** `POST /v1/edits` (`apps/api/src/routes/edits.ts`):
`requireAuth('edits:write')` — `requireAuth` giờ nhận tham số scope, mặc định `places:read` nên
6 route M3 không đổi; kiểm POI đích tồn tại/đúng trạng thái, `category` phải có thật, đếm giới
hạn 20/ngày/end-user + 500/ngày/key bằng SQL theo ngày VN, đếm phiếu trùng 30 ngày, INSERT
`poi_edit`, `stage_poi_create` cho `kind=create`, và gọi `apply_poi_edit` ngay khi
`decideStatus` ra `auto_approved` (reviewer `auto:internal`/`auto:consensus`/`auto:rule`).
Khoá seed nội bộ được cấp `edits:write` (kèm UPDATE cho hàng cũ vì INSERT có DO NOTHING).
**Một lỗi thật chỉ smoke test bắt được:** `JSON.stringify(changes)` + cast `::jsonb` khiến
porsager stringify lần nữa → DB nhận jsonb *string*, `apply_poi_edit` vỡ ở `jsonb_object_keys`
(503). Phải dùng `sql.json(changes)` cho cả INSERT lẫn so sánh phiếu trùng; `ValidatedEdit.changes`
đổi sang kiểu JSON-safe `EditChanges`. Đã smoke test thật qua `wrangler dev` + dev DB: update
hours → `auto_approved` và POI đổi ngay; create → POI `active`, `created_by=user`, anchor `user`
confidence 0,95; POI lạ 404; category lạ 400. API test 18 file/79 test.

**M4 Task 2 xong 01/09/2026.** `apps/api/src/edits/`: `hash.ts` (`endUserHash` =
sha256(tenant+token), `ipHash` = sha256(ip+ngày VN) — không lưu token/IP thô), `ulid.ts` (ULID
Crockford cho POI người dùng tạo), `rules.ts` (`decideStatus` + hằng số 20/ngày/end-user,
500/ngày/key, `AUTO_UPDATE_FIELDS=[hours,contact]`, quality ≥ 60, đồng thuận 2 người),
`validate.ts` (whitelist `changes`, bbox VN, `hours` chuỗi → `{osm}`, dẫn xuất `*_norm` bằng
`normalizeVi` để hàm SQL 0006 áp dụng được thuần SQL). Thêm `vnDayStartUtc` vào `quota.ts`.
API test **17 file / 73 test** (trước 15/59), root 486/486, typecheck 12/12, lint sạch.
Task 2 khớp plan hoàn toàn, không có quyết định phát sinh.

**M4 Task 1 xong 01/09/2026.** `db/migrations/0006_edits.sql`: cột `api_key` + `new_poi_id`
cho `poi_edit`, 3 index đếm theo ngày, và 3 hàm `SECURITY DEFINER` owner `pipeline` —
`stage_poi_create` (tạo POI `pending` cho `kind='create'`), `apply_poi_edit` (cập nhật `poi`
theo `changes`, khoá trường vào `locked_fields`, tạo `address_anchor` `source='user'`
confidence 0,95, duyệt kèm phiếu trùng với reviewer `auto:consensus`), `reject_poi_edit`.
User `api` **không** có UPDATE/INSERT trên `poi` — chỉ EXECUTE 3 hàm (spec mục 9).
Ba điều khác plan đã xử lý và ghi ở cuối Task 1 trong plan: (1) `poi_edit.tenant_id` có FK
tới `tenant` nên test phải seed tenant trước; (2) `scripts/lib/db-permissions.mjs` phải giữ
owner/grant của 3 hàm, nếu không thì sau `db:restore` hàm rơi về superuser; (3)
`db/schema.dbtest.mjs` hardcode 4 lần `--down`, sửa thành 5.

**M3 Task 12 xong 01/09/2026 — M3 nghiệm thu ĐẠT.** Kết quả đầy đủ ở mục 8. Perf
production có ba lần cache-hit liên tiếp p95 177/192/168 ms từ máy dev tại Việt Nam;
fixture API DB, production Places API, quota 429 local và React demo production đều đạt.
Lưu ý thật: cold/cache warm-up từng tạo p95 2,5–3,2 giây; lần cuối vẫn có một cold miss
3.317 ms nhưng p95 168 ms. Theo dõi p99/cold miss ở M4, không xem đây là số p95 ổn định
cho traffic hoàn toàn lạnh.

**M3 Task 11 xong 01/09/2026.** Thêm quota KV cho cả 6 Places route, chặn ở 2× quota,
bỏ qua hoàn toàn tenant `internal`; Analytics Engine ghi tenant/key/path/status/ms và là
binding optional. TDD RED→GREEN; API 15 file/59 test, typecheck và Biome sạch. Nghiệm
runtime local với tenant free quota 25: 50 request đầu trả 200, request thứ 51 trả 429
`quota_exceeded`, `Retry-After: 3600`. Production vẫn để `QUOTA_ENABLED="0"`.

**M3 Task 9–10 xong 01/09/2026.** Task 9 thêm custom element
`<mapslibvn-autocomplete>` có debounce 200 ms, ARIA combobox/listbox/status, điều hướng bàn
phím, chống response cũ và playground/E2E thật. Sửa luôn lỗi runtime Hyperdrive trả mảng
Postgres dạng chuỗi (kể cả KV cache), nên auth origin production hoạt động đúng. Build web:
ESM 4,07 kB gzip, UMD 298,69 kB gzip; E2E playground 3/3. Task 10 thêm
`@mapslibvn/react` (`MapsLibVNMap`, `Marker`, `useMap`, `usePlaces`), 5 test hook và demo docs
responsive. Đã kiểm trên browser desktop/mobile: tìm được 10 Highlands, chọn kết quả tạo đúng
1 marker và fly-to; mobile 390×844 không tràn ngang. Local: typecheck 12/12 package, root
480/480 test, API 54/54, lint 194 file. Remote tại `ece8d1e`: CI `33463393201`, Deploy Docs
`33463393179`, Deploy API `33463393248`, API DB test `33463393195` — tất cả success.

**M3 Task 1 xong 31/08/2026** — `db/seed/tenant_internal.sql` + `scripts/db-seed-tenant.mjs` +
script gốc `pnpm db:seed-tenant`. Chạy 2 lần đều `api_key active: 2` (idempotent qua
`ON CONFLICT DO NOTHING`). DB dev hiện có 2 khoá tenant `internal`:
`mlv_live_demo00000000000000000000` (kind `web`, 4 origin: `http://localhost`,
`http://127.0.0.1`, `https://mapslibvn-docs.pages.dev`, `https://*.mapslibvn-docs.pages.dev`)
và `mlv_live_server000000000000000000` (kind `server`, không kiểm origin — dùng cho curl/test).
Cả hai `scopes={places:read}`, `active=t`, `revoked_at=NULL`. **Chưa seed lên DB máy chủ**
(cần mở tunnel `cloudflared access tcp` rồi chạy với `DATABASE_URL` qua tunnel — làm ở Task 12).

**Đã xong 31/08:** 5 Actions secret cho workflow `Data update` (`HF_TOKEN`,
`DB_TUNNEL_HOSTNAME`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`,
`PIPELINE_DATABASE_URL`) đã đặt — repo có 13 secret. Giá trị trong `.env` có dấu ngoặc bao,
phải bóc trước khi `gh secret set` nếu đặt lại. Workflow `Data update --dry-run` từ Actions
xanh 2/2 lần (run `33364362147` 62 giây, run `33364404492` 41 giây): image GHCR pull được,
state R2 đọc được, dò đúng OSM `c256eec…` · Overture `2026-08-19.0` · FSQ `2026-08-11` —
FSQ là dataset gated nên **`HF_TOKEN` trên Actions đã được chứng minh dùng được**.

**Chưa xác nhận (không chặn M3):** `DB_TUNNEL_HOSTNAME`, `CF_ACCESS_CLIENT_ID`,
`CF_ACCESS_CLIENT_SECRET`, `PIPELINE_DATABASE_URL` chỉ mới *có mặt*, chưa chạy thật.
`--dry-run` dừng ở `update-plan` (`missingLiveEnv` trả `[]` khi dry-run, và `LIVE_ENV`
không chứa 4 biến này); Tunnel chỉ mở ngay trước nhánh POI trong `data-update.mjs`. Muốn
kiểm đường `cloudflared access tcp` từ runner GitHub tới Postgres máy nội bộ thì phải chạy
`--poi` thật trên Actions (60–180 phút, mà quota private Free chỉ 2.000 phút/tháng). Cron
máy nội bộ vẫn chạy thứ Hai 02:00 VN nên đường Actions chỉ là dự phòng.

**Lưu ý vận hành máy dev:** đĩa đã đầy 97 % ngày 27/08 (`~/.cache/uv` 124 GB + JSONL Overture không nén);
đã dọn còn 44 GiB trống. Trước các bước nặng (Task 7 gộp, Task 10 `data:update`), kiểm `df -h /`.

**Việc tay vận hành:** nên chốt hẳn việc không ngủ máy: `caffeinate` đang giữ máy thức nhưng cài đặt gốc
vẫn là `sleep 1` phút — `sudo pmset -a sleep 0 disksleep 0`.

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

## 3. Quyết định phát sinh

| Ngày | Quyết định | Lý do | Commit |
|---|---|---|---|
| 2026-09-04 | Display priority không dùng `quality_score` làm tín hiệu chính: thứ tự là `category.rank` → `popularity` → `quality_score` → MD5/ID; tile dùng lưới Web Mercator giữ chỗ từ `minzoom` tới z16 | Quality chủ yếu đo độ đầy đủ dữ liệu, không đồng nghĩa địa điểm quan trọng. Giữ chỗ xuyên zoom bảo đảm POI đã xuất hiện không biến mất khi zoom và loại phụ thuộc biên cursor/tile | (commit này) |
| 2026-09-04 | C4: `ip_hash`/`end_user_hash` băm kèm secret `IP_HASH_PEPPER`; thiếu secret thì `POST /v1/edits` trả **503 `server_misconfigured`** chứ không tự hạ xuống băm không pepper. Dev/test dùng giá trị không bí mật trong `wrangler.toml` và `vitest.config.ts`; production dùng `wrangler secret put` (đã đặt 04/09). Harness dbtest phải truyền `--var IP_HASH_PEPPER` | Không có pepper thì dải IPv4 chỉ ~4 tỉ giá trị — ai lấy được bảng `poi_edit` là dò ngược ra IP; mặc định im lặng sẽ khiến sự cố cấu hình không bao giờ bị phát hiện | (commit này) |
| 2026-09-03 | M6 chốt 8 quyết định khi viết plan, đã áp dụng nguyên: (1) `tsup.config.ts` với `noExternal: ['@mapslibvn/core']` — external `react`, `react/jsx-runtime`, `react-native`, wrapper; (2) test component RN chạy jsdom bằng `@testing-library/react` với `vi.mock` hai module native trong `src/test/` (không `react-test-renderer`, không Jest preset RN); (3) vitest root include thêm `packages/*/src/**/*.test.tsx`; (4) `resolveKey` nhận tham số thứ ba `{envName, hint}` để `example-rn` dùng lại thay vì copy; (5) app thử tạo bằng `create-expo-app --template blank-typescript`, không ghim tay RN/React; (6) `npm install ./vendor/*.tgz` chạy lại **mỗi lần** `example:rn` để npm không giữ tarball cũ trùng tên; (7) `<Marker>` mặc định View tròn 22 pt, `anchor` `center`; (8) `onLoad` gọi một lần mỗi lần tạo map, guard bằng `useRef`. Kèm: style JSON tải về phải cast `as StyleSpecification` trong `use-style.ts` vì `res.json()` trả `unknown` | Gói RN phải cài được khi core chưa lên npm; React 19 + New Architecture loại bỏ hạ tầng test RN cũ; app thử phải nằm ngoài workspace để chứng minh tarball tự chứa | (commit này) |
| 2026-09-03 | Spec gốc mục 8.1 sửa một dòng: wrapper RN không có `addProtocol`, `pmtiles://` do MapLibre Native (Android ≥ 11.8 / iOS ≥ 6.10, wrapper 11.3.8 kèm Android 13.2 / iOS 6.26) đọc trực tiếp; trỏ về spec M6 riêng. Spec M6 chốt: không biến thể style mobile, không tiles fallback; app Expo thử độc lập ngoài workspace cài bằng tarball (cách A); `PoiFeature` + hàm biến đổi style thuần chuyển vào core; gói RN đóng gói core, không kéo web | Xác minh 03/09 bằng docs MapLibre và changelog wrapper; monorepo React 18 không tương thích peer React 19 của wrapper nên gói và app thử phải tách | (commit này) |
| 2026-09-01 | M4: ghi `poi` qua 3 hàm SQL `SECURITY DEFINER` owner `pipeline`, `api` chỉ EXECUTE | Giữ đúng spec 9 "Worker chỉ đọc + ghi `poi_edit`" ở tầng GRANT thay vì tin vào code Worker | (commit này) |
| 2026-09-01 | M4: `db-permissions.mjs` giữ owner/grant của 3 hàm 0006 | `pg_restore --no-owner --no-privileges` làm hàm rơi về superuser → Worker sẽ ghi `poi` với quyền superuser | (commit này) |
| 2026-09-01 | M4: `apps/admin` là Vite+React SPA do Worker phục vụ tại `/admin` (không phải Next.js trên Pages như spec 3.1) | Cùng origin với `/v1/admin/*` nên chỉ cần một Access application, JWT tự chảy, không CORS credentials, không thêm Pages project | (commit này) |
| 2026-09-01 | M4: xác thực admin bằng verify JWT `Cf-Access-Jwt-Assertion` (RS256, JWKS cache KV 1 giờ) | Không tin header do proxy chèn mà kiểm chữ ký + `aud` + `exp`; giả lập được trong itest/E2E bằng JWKS server riêng | (commit này) |
| 2026-09-01 | M4: mọi jsonb gửi từ Worker phải qua `sql.json()`, không `JSON.stringify` + `::jsonb` | porsager stringify lần nữa khi thấy cast → ghi jsonb *string*, hàm SQL vỡ ở `jsonb_object_keys`; tầng test workers không có DB nên không bắt được | (commit này) |
| 2026-09-01 | M4: `poi_edit` thêm cột `api_key` + `new_poi_id`; giới hạn edit đếm bằng SQL, không KV | `api_key` cần cho hạn 500/ngày/key và audit; `new_poi_id` vì `poi_id` có FK nên chỉ gán được sau khi stage POI. Đếm SQL chính xác và không tốn write KV (Workers Free 1.000 ghi/ngày) | (commit này) |
| 2026-09-01 | M4: `kind=create` stage POI `pending` ngay; chỉ tenant tạo đọc được bằng place ID và không cache | Đúng vòng đời spec, không lộ đóng góp chưa duyệt qua search/cache cho tenant khác | (commit này) |
| 2026-09-01 | M4: Worker dẫn xuất các trường `*_norm` bằng `normalizeVi` ngay trong `changes` | Hàm SQL áp dụng edit không cần tự triển khai chuẩn hoá tiếng Việt; jsonb đủ thông tin và so đồng thuận ổn định | (commit này) |
| 2026-09-01 | M4: Access giả lập dùng RSA/JWKS ở tiến trình riêng, khoá test nằm trong `.cache/` gitignored | `spawnSync` của test harness chặn event loop nếu JWKS cùng tiến trình; cặp khoá ổn định tránh lệch KV cert cache | (commit này) |
| 2026-09-01 | M4: đồng thuận đếm end-user riêng biệt trên phiếu pending giống hệt trong 30 ngày; apply kéo các phiếu trùng cùng duyệt | Ngăn một người tự nhân phiếu và bảo đảm toàn bộ consensus có audit status/reviewer nhất quán | (commit này) |
| 2026-09-01 | M4: POI user mặc định quality 60, popularity 0,2; `report` chỉ tạo phiếu | 60 là ngưỡng POI hiện ở tiles z12–14; report không được tự thay đổi dữ liệu bản đồ | (commit này) |
| 2026-09-01 | M4: Admin UI mỏng không có unit test riêng; API có workers test và luồng UI có Playwright E2E | Root vitest loại `apps/**`; E2E kiểm được JWT, click và state DB/API thật nên có giá trị hơn unit test UI trùng lặp | (commit này) |
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
| 2026-08-29 | OSM raw hiện dùng level 6 cho đơn vị cấp xã/đặc khu sau sắp xếp; map sang semantic level 8, nhưng chỉ nhận L6/L8 có point-on-surface nằm trong một L4 thuộc danh sách 34 tỉnh hiện hành | Raw có `L4=39, L6=3.322, L8=565`. Kết quả sau review là L4=33, L8=3.255; loại thêm 64 relation ngoài retained province. OSM thiếu riêng Khánh Hòa, không tạo geometry giả để ép đủ 34 | (M2 T8 review) |
| 2026-08-29 | Parser tên hẻm nhận thêm chuỗi `/`, khoảng `-`, mã chữ-số (`111K1`, `02/K01`), `+`, dấu phẩy/chấm và lỗi thiếu khoảng trắng | Regex spec hẹp làm 109 street cluster toàn VN vẫn mang tên hẻm số; RED từ mẫu OSM thật rồi mở rộng, final còn 0 | (M2 T8) |
| 2026-08-29 | Anchor dựng graph cạnh bằng geometry GiST prefilter + geography exact ≤30 m, lấy connected component và lặp trên median đến khi exact duplicate = 0 | Review phát hiện DBSCAN 0,0003°/30,5 m có thể gộp cặp >30 m. Regression 30,1 m giữ tách, 29,9 m gộp và OSM thắng source priority; national thành 923.541 anchor | (M2 T8 review) |
| 2026-08-29 | `osm_road_raw` + `osm_admin_raw` dựng `_new`, swap cả hai trong một transaction; anchor raw/edge/merge/new luôn cleanup trong `finally`. Alley dùng prefilter + geography exact ≤300/15 m | Fault-injection giữ nguyên hai raw table/bảng anchor published khi lỗi và staging=0; boundary regressions 299/301 m và 14,9/15,1 m xanh | (M2 T8 review) |
| 2026-08-29 | Style bỏ toàn bộ lớp POI của base OSM Liberty (`source-layer=poi` của `openmaptiles`) và dùng một lớp `poi` riêng từ `poi-YYYYMMDD.pmtiles` | Hai bộ icon chồng nhau ở cùng vị trí; lớp riêng mới có `q`/`grp`/`cat` để lọc theo mật độ 5.8 và bắt sự kiện `poiClick` | (M2 T9) |
| 2026-08-29 | Worker bỏ hẳn `sources.poi` + lớp `poi` khi `manifest.poi` null, thay vì điền chuỗi rỗng | `pmtiles://…/tiles/.pmtiles` làm MapLibre tải file không tồn tại và báo lỗi ở mọi phiên trước khi có bản POI đầu tiên | (M2 T9) |
| 2026-08-29 | `export-tiles.mjs` không dùng `--extend-zooms-if-still-dropping` | Cờ này có thể đẩy maxzoom vượt 16, làm `inspect`/`smoke --set poi` lệch với spec 5.8 | (M2 T9) |
| 2026-08-29 | `.dockerignore` thêm `**/.env` (trước chỉ có `.env` ở gốc) | Pattern gốc chỉ khớp `/.env`; `infra/server/.env` chứa mật khẩu superuser/api/pipeline sẽ bị nướng vào layer image ở mọi lần `pnpm image:build` chạy sau `server:setup` | (M2 T1) |
| 2026-08-29 | Lệnh restore-smoke dựng URL từ `POSTGRES_*` của container thay vì `$DATABASE_URL` | Container `backup` không export `DATABASE_URL` (backup.mjs tự dựng qua `databaseUrlFromEnv`); lệnh trong plan rơi về socket và báo `.s.PGSQL.5432: No such file or directory`. Recipe đúng đã ghi vào `infra/server/README.md` để Task 10 `db-restore.mjs` dùng lại | (M2 T1) |
| 2026-08-29 | `server-setup.mjs` gán `pipelineImage` có giá trị mặc định thay vì dùng thẳng `env.PIPELINE_IMAGE` | `parseEnv` trả `Record<string, string>` nhưng tsconfig bật `noUncheckedIndexedAccess` → `string \| undefined`, `pnpm typecheck` đỏ ở `spawnSync` | (M2 T1) |
| 2026-08-30 | Hyperdrive tạo bằng `wrangler hyperdrive create`, **không điền port** | Luồng private-database qua Tunnel yêu cầu `omit the port` (tài liệu Cloudflare); tunnel đã tự route tới `postgres:5432` qua published application route. Plan ghi port 5432 — sai | (M2 T1) |
| 2026-08-30 | Lệnh wrangler cho Hyperdrive phải chạy từ `apps/api`, không từ gốc repo | Wrangler 4 đọc `.env` của thư mục hiện tại; ở gốc repo nó nhặt `CLOUDFLARE_API_TOKEN` (token deploy, không có quyền Hyperdrive) và ghi đè OAuth → `Authentication error [code: 10000]` | (M2 T1) |
| 2026-08-30 | Access application phải tắt hết identity provider và đặt Session Duration “expires immediately” | Tài liệu Cloudflare nêu, plan bỏ sót; để IdP bật thì Access đòi đăng nhập người dùng thay vì chấp nhận service token và Hyperdrive không qua được cửa | (M2 T1) |
| 2026-08-30 | Test tầng `apps/api` trỏ binding Hyperdrive vào cổng đóng và chỉ kiểm nhánh lỗi 503 của `/healthz/db` | Bản đầu kiểm happy-path qua `localConnectionString` → xanh trên máy dev nhưng đỏ trên runner Deploy API (không có Postgres), chặn luôn bước `wrangler deploy`. Tầng api phải không cần DB — đó là lý do `dbtest` là workflow riêng. Đường đi thật tới Postgres nghiệm thu bằng `wrangler dev --remote` | (M2 T1) |
| 2026-08-31 | `detectSources` không phụ thuộc Geofabrik HEAD; tải OSM dùng GET có retry + checksum và có thể nhận PBF local | Geofabrik HEAD trả 502 trong lần chạy live dù GET/checksum vẫn tốt; không được biến lỗi CDN nhất thời thành rebuild thất bại | (M2 T10) |
| 2026-08-31 | `pnpm test:db` luôn reset DB cô lập `mapslibvn_task8_test`; hook 300 giây | Bộ test trước đây có thể sửa DB dev đã restore và conflate fixture vượt hook 120 giây | (M2 T10) |
| 2026-08-31 | Restore portable xong phải reconcile owner/grant `api`/`pipeline` | Backup dùng `--no-owner --no-privileges`; chỉ chạy migration pending không khôi phục ACL của schema đã đủ migration | (M2 T10) |
| 2026-08-31 | Partial run lưu `pending.tiles`/`pending.poi`; Tunnel chỉ mở trong nhánh POI, nhận service token qua env và luôn cleanup | `--poi` khi OSM đổi trước đây có thể cập nhật source state rồi làm lần sau bỏ sót tiles; secret trên argv lộ qua process list; dry-run không cần DB | (M2 T10 review) |
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
- 2026-08-31 · **M2 nghiệm thu ĐẠT** (bảng chi tiết ở mục 7) · `30f0274`: 1.515.983 POI
  `active` / tổng 1.522.416; `poi-20260830.pmtiles` 244,6 MiB đã vào manifest production,
  click POI trên playground hiện tên/loại/nhóm; `/healthz/db` trả `{"ok":true,"user":"api"}`
  qua Hyperdrive → Access → Tunnel → Postgres TLS trên máy nội bộ; `pnpm db:restore --latest`
  phục hồi từ R2 đạt (1.522.416 POI, owner/grant đúng); báo cáo gộp 3,3 % đa nguồn,
  19,6 % combined other, 923.567 anchor, "Nguyễn Lâm" 174. Remote CI xanh cả 3 job:
  `test` + `image` https://github.com/dotienphong/maps-library-vietnam/actions/runs/33358342667
  và `dbtest` 24 phút 37 giây
  https://github.com/dotienphong/maps-library-vietnam/actions/runs/33358342671
- 2026-09-03 · **M6 XONG** (bảng 7/7 ở mục 11) · 16/16 task: gói `@mapslibvn/react-native`
  (`<MapsLibVNMap>`, `<Marker>`, `useMap`, `usePlaces`, attribution không tắt được, dist tự chứa
  core), `@mapslibvn/core` thêm `headers` / `PoiFeature` / `localizeStyle` / `hidePoiLayer`,
  app Expo thử `examples/embed-rn` + `pnpm example:rn`, khoá `mobile` với `X-Bundle-Id`,
  trang docs `/react-native/`. Chạy thật iOS 26.1 + Android Pixel 7, 8 ảnh trong
  `docs/evidence/m6/`, 0 request `/v1/tiles/` (tiles đi thẳng R2 qua `pmtiles://`)

- 2026-09-04 · checklist **C4 XONG** + hồ sơ **B3** · pepper bí mật cho `ip_hash`/`end_user_hash`
  (secret `IP_HASH_PEPPER` đã đặt trên `mapslibvn-api-production`), `docs/legal/b3-ra-soat-nhan-hieu.md`
  (MapLibre không có chính sách nhãn hiệu công khai; tên npm `@mapslibvn/*` còn trống; còn lại là
  tra WIPO/Cục SHTT và gửi thư `team@maplibre.org`). Sửa kèm: `THIRD_PARTY_NOTICES.md` trước đó
  chưa nhắc `@mapslibvn/react-native` lẫn peer `@maplibre/maplibre-react-native` (MIT) — đã bổ sung
  cùng dòng miễn trừ liên kết với MapLibre. Job `API tests (Places, real DB)` đỏ một lượt
  (`c2679fb`): `edits.itest.mjs` tự lặp lại công thức `sha256(tenant:token)` để chèn sẵn 20 hàng
  `poi_edit` nên kiểm hạn mức 20 edit/ngày nhận 200 thay vì 429 — sửa ở `2f2b942` bằng cách cho
  `scripts/api-db-test.mjs` giữ một hằng pepper duy nhất và truyền vào cả `wrangler dev` lẫn tiến
  trình vitest. Sau đó CI, Deploy API, API tests và DB tests đều xanh
- 2026-09-05 · Tìm mờ T0–T8 · `word_similarity` (`<%`) thay `%` ở autocomplete/search/geocode,
  ba loại truy vấn song song, migration 0007 đặt ngưỡng 0,5 cấp database · `fee9daf` ·
  đã phát hành `d5ba3f9`; p95 2156→808 ms. Hit@3 tụt 38→35 nên `fcbe06e` giữ lại toán tử `%`;
  `1597bcb` sửa `server:update` bỏ qua pull image local, nhờ đó migration 0007 đã áp lên production;
  `79ba24f` chỉ bật nhánh `%` cho truy vấn ≤12 ký tự vì ở 1,5 triệu POI nó tốn 1355 ms với truy vấn dài.
  Cuối cùng: p95 lạnh 1782–2055 ms (baseline 2,1–2,8 s), hit@3 37/40

- 2026-09-07 · Alias T8.5 · **đo lại chi phí nhánh `area`, cổng p95 của 8.6 ĐẠT** ·
  [hồ sơ](evidence/admin-alias/8-5-benchmark-area-cost.md) · phép đo 8.5 lúc 11:27 cùng ngày bị bỏ vì
  ba khiếm khuyết: hai cohort chạy tuần tự nên rơi vào hai colo khác nhau, p95 bị cache lạnh chi
  phối, và chỉ 80 request/cohort. Công cụ mới `measurePairedCohorts` đo **xen kẽ trên cùng query**,
  tách theo `x-mlv-cache` và theo colo. Khi nhìn số liệu lần chạy đầu thì lộ **khiếm khuyết thứ tư
  do chính tôi gây ra**: cohort đi trước mỗi cặp gánh chi phí khởi động worker/Hyperdrive (cold p50
  684/530 trong khi warm p50 bằng nhau 96/96), đã thêm luân phiên thứ tự cohort và đo lại từ đầu.
  Bộ query cũ 40 truy vấn POI gần như không chạm nhánh `area` nên thêm `perf-area-queries.txt`
  (15 huyện cũ + 9 tỉnh cũ + 10 địa chỉ cũ) đúng như plan 8.5 yêu cầu. Kết quả: warm p95 **+2/−2/−38 ms**;
  cold p95 phía Worker (`$workers.wallTimeMs`, 164 so với 159 mẫu, 100% cache miss) **−163 ms**.
  Chi phí thật của `area` là **+93 ms ở cold p50** (581 so với 488), do nhánh alias leo lên bậc 2
  `word_similarity` khi tiền tố rỗng — đúng lớp vấn đề mục 6.5 đã cảnh báo. Đề xuất chờ PHONG: dùng
  lại `isAdminOnlyQuery` để bỏ hẳn nhánh area khi truy vấn không mang dạng hành chính

- 2026-09-07 · Alias T8.3/8.4/8.7 · **cổng độ phủ chạy lần đầu trên dữ liệu production, và một lỗi
  mất alias đã sửa** · [hồ sơ](evidence/admin-alias/8-3-8-4-coverage-production.md) · trước đó cổng
  chỉ chạy trên DB đo `mapslibvn_alias_scale` lúc 03:03Z, **trước** khi publish 03:40Z, nên số 8.3/8.4
  trong plan là của báo cáo QA pipeline chứ không của `verify-admin-alias`. Chạy đúng trên production:
  84 failure. **Lỗi thật: 8 vùng cũ đất liền mất sạch alias.** `admin-overlay.mjs` bỏ mọi khoá có nhiều
  hơn một chủ, mà bốn cặp chỉ khác nhau ở dấu (Đông Thạnh/Đông Thành, Sa Pa/Sa Pả, Phú Thành/Phú Thạnh,
  Lộc Thạnh/Lộc Thành) trùng `name_norm` **kể cả ở khoá đầy đủ nhất** nên cả hai phía mất hết đường tra
  — trái quyết định #3 của plan. Overlay tính đúng cả 8 (`targets: 1`, `rawCoverage: 1`); cổng QA
  pipeline không thấy vì kiểm `unmatched` trong bộ nhớ chứ không kiểm bảng đã ghi. Bản sửa giữ khoá đầy
  đủ nhất, vẫn bỏ khoá ngắn nhập nhằng, dedupe theo PK ba cột, thêm report `ambiguousPrimaryKept` để
  công bố đánh đổi mất provenance. Đo trên DB staging dựng từ production (4 bảng khớp từng dòng): cổng
  **84 → 79**, `missing_mainland_l8` **10 → 5**, alias 37.246 → 37.251, Lộc Thạnh→846 và Lộc Thành→848
  giờ có hai dòng riêng. **Sửa lại một chẩn đoán cũ:** 10/12 ca alias trượt KHÔNG phải fixture sai —
  snapshot không có xã cũ nào của Huyện Than Uyên, và `hn-01` là ngưỡng sliver 0,05 loại đúng hai đích
  nghị quyết có nêu (Hoàn Kiếm 0,029, Ba Đình 0,008). Độ lệch nguồn cực không đều: **Sơn La chỉ có 1
  xã cũ** trong snapshot, Bắc Giang 2, Vĩnh Phúc 2. Chưa publish lên production (thuộc 9.2)

- 2026-09-07 · Hạ tầng · **build lại image pipeline từ HEAD; `.dockerignore` thiếu manifest mà
  `admin.mjs` cần** · image `mapslibvn/pipeline:local` đang chạy là bản **tiền-alias**: không có
  `admin-overlay.mjs`, thiếu `db/migrations/0008_admin_old.sql` và `scripts/verify-admin-alias.mjs`.
  `admin.mjs` trong image đó đánh lại ID `admin_area` bằng `row_number()` rồi
  `publishNew(['admin_area','admin_alias'])`, tức sẽ **thay 37.246 alias bằng ~33 dòng seed** và
  đánh lại đúng những ID mà `admin_alias.admin_area_id` trỏ vào — đúng điều quyết định #1 của plan
  alias cảnh báo. Cron `data:update` kế tiếp `2026-09-13T19:00Z` (thứ Hai 14/09 02:00 VN), lần 02:00
  ngày 07/09 đã chạy trước khi publish nên chưa thiệt hại. Build lại từ HEAD **phát hiện thêm một
  lỗi đóng gói**: `.dockerignore` loại cả `pipelines/poi/fixtures`, mà `admin.mjs` ở HEAD đọc
  `pipelines/poi/fixtures/admin-old-source.json` **không có điều kiện** ngay đầu advisory lock — nên
  image build từ HEAD vẫn chết ENOENT ở bước admin. Rà cả hai thư mục fixture bị loại thì đúng một
  file được đọc lúc chạy thật (manifest 1,4 KB, URL + checksum), nên thêm ngoại lệ
  `!pipelines/poi/fixtures/admin-old-source.json`; 14 MB PBF/parquet test vẫn nằm ngoài image.
  Nghiệm thu image mới: smoke đủ 11 công cụ, có `ambiguousPrimaryKept` (bản sửa alias), có manifest
  đúng md5 `1f0fdd19`, `admin-overlay`/`admin-old-source` import được trong container, **không có
  `.env`** nào bị nướng vào. `pipeline` + `backup` đã force-recreate sang image mới; production
  không đổi (`admin_area` 3.353 / `admin_area_old` 4.972 / `admin_alias` 37.246, autocomplete 200)

- 2026-09-07 · Alias T8.3/8.4 · **số liệu cho ba quyết định còn treo** ·
  [hồ sơ](evidence/admin-alias/8-3-decision-prep.md) · chạy chỉ đọc trên production, overlap tái tạo
  bằng đúng SQL của `admin-overlay.mjs` (26.972 cạnh). (A) 60 `raw_coverage_gap`: phép đo "ngoài hợp
  L4" **vô dụng** vì L4 hiện hành cũng bao lãnh hải (Cô Tô gap 0,961 mà "ngoài đất" = 0); đo lại bằng
  mật độ POI trong phần không phủ → **42 vùng ≤ 0,5 POI/km², 13 vịnh có cầu tàu, 5 ca Cát Bà/Tam
  Giang ≤ 2,3 POI/km²**, không vùng nào là đất hở. L4 Ninh Thuận gap 0,572 vì Khánh Hòa hiện hành
  được dựng từ hợp xã nên không có lãnh hải. (B) sliver: 11.064/12.022 cạnh bị bỏ có `raw_share`
  < 0,001; theo vùng p90 = 0,46 %, chỉ 11 vùng bỏ ≥ 5 % — evaluator cảnh báo khi `> 0` nên 1.970 cảnh
  báo phần lớn là nhiễu, đề xuất ≥ 0,01 (≤ 209 vùng). (C) mô phỏng ngưỡng 0,05→0,005: 337 vùng đổi tập
  đích, ca tách 282→569, 22 vùng ≥ 4 đích, mà `hn-01` **vẫn đỏ** vì Văn Miếu–Quốc Tử Giám 0,130 ở lại
  ở mọi ngưỡng; đề xuất giữ 0,05. Phép đo đầu treo 6 phút vì làm L4 Ninh Thuận trước và
  `ST_Difference` với hợp `vn_boundary` — cấu trúc lại: TEMP + `ST_Subdivide`, timeout 120 s/vùng,
  L4 sau cùng → 60/60 trong 5 s. Không đổi code/gate; chờ PHONG

- 2026-09-07 · Alias T8.3/8.4 · **PHONG duyệt A+B+C, đã cài và publish — cổng 84 → 24 failure** ·
  [hồ sơ mục F](evidence/admin-alias/8-3-decision-prep.md) · (A) overlay đo mật độ POI ở phần không
  phủ và phần được phủ, **chỉ cho vùng thiếu phủ** (không tốn truy vấn cho 4.900 vùng), `ST_Subdivide`
  cho phần trống nhiều đảo; evaluator chuyển sang cảnh báo `coastal_gap_accepted` khi ≤ 0,5 POI/km²
  hoặc < 10 % mật độ phần phủ. **Bảng `poi` rỗng thì không trả số nào** và cổng giữ nguyên failure —
  mật độ 0 khi chưa có POI sẽ chấp nhận mọi gap. (B) cảnh báo `discarded_sliver` từ 0,01. (C) giữ
  ngưỡng 0,05, không đổi gì. Thêm `--accept-qa` cho `admin-old.mjs` (`a4a8146`) vì `admin.mjs` có mà
  nó không, nên đường "chỉ thay old+alias" không publish được trên dữ liệu thật. Publish production
  bằng `admin-old.mjs --accept-qa`, **không chạm `admin_area`**: alias 37.246 → **37.251**,
  `unmatched=2 overlap=0 seed_miss=0`, publish 1.809 ms. Cổng chạy lại: **84 → 24 failure**, cảnh báo
  **1.970 → 286** (`discarded_sliver` 229, `coastal_gap_accepted` 55). Xác nhận trên production API:
  "Lộc Thạnh" và "Lộc Thành" trước trả **rỗng**, giờ trả đúng hai xã khác nhau; Đông Thạnh, Sa Pả,
  Phú Thạnh cũng ra kết quả. **Hai dự đoán của tôi lệch, đã sửa trong hồ sơ:** đoán còn 19 failure
  (thực tế **24** — luật máy chấp nhận 55/60 gap, 5 ca Cát Bà/Tam Giang giữ đỏ vì Gia Luận và Việt
  Hải có mật độ phần trống **cao hơn** phần phủ, có thể là rừng chưa thuộc xã nào chứ không phải
  biển, nên câu "không vùng nào là đất bị hở" của tôi là quá mạnh); và đoán cảnh báo ≤ 209 (thực tế
  229). 24 failure còn lại: 21 cùng gốc nguồn dữ liệu cấp xã cũ, 5 cần nguồn ranh giới Cát Bà/Tam
  Giang, **0 lỗi code**

- 2026-09-07 · **Task 8 ĐÓNG — cổng độ phủ alias 0 failure trên production** ·
  [hồ sơ](evidence/admin-alias/8-3-8-4-coverage-production.md) · PHONG duyệt cách 2: đóng trong phạm
  vi snapshot **đã chứng minh** thay vì để cổng đỏ vô thời hạn vì nguồn thiếu. Hai phần: (1) sửa
  khoảng L8 trong spec mục 11 **10.000–10.700 → 4.200–4.300** kèm lý do — khoảng gốc là số đơn vị
  **pháp lý** cấp xã, không phải số relation; snapshot Geofabrik 250101 chỉ có 4.215 relation
  `admin_level=8` và các xã thiếu **không có trong PBF** (Huyện Than Uyên chỉ có relation cấp 6).
  (2) khai báo 23 chỗ thiếu còn lại trong `scripts/fixtures/admin-alias-known-gaps.json`, **mỗi mục
  một lý do và bằng chứng đã đo**; cổng hạ đúng những mục đó xuống cảnh báo `known_gap_declared`.
  Ba chốt chống lạm dụng, có test: phạm vi che của từng nhóm nằm ở `KNOWN_GAP_KINDS` **trong code**
  nên sửa file dữ liệu không nới được (khai báo sai nhóm không che loại failure khác của cùng id);
  ca **không** khai báo vẫn đỏ; khai báo đã hết lỗi thì bị nhắc dọn bằng `stale_known_gap`. Kết quả
  trên production: **0 failure, 309 warning, exit 0** — `discarded_sliver` 229, `coastal_gap_accepted`
  55, `known_gap_declared` 23 (`outOfSnapshotScope` 10, `coverageGapNeedsSource` 5,
  `provenanceCollapsedByPk` 3, `boundaryVintageMismatch` 3, `offshoreNoTarget` 2),
  `distinct_differs_from_relations` 2, **`stale_known_gap` 0**. Cả ngày 07/09 cổng đi
  **84 → 79 → 24 → 0**, trong đó chỉ 84→79 là sửa lỗi code, còn lại là quyết định có bằng chứng.
  Việc còn lại là **nguồn ranh giới cấp xã cũ** (4.215/≈10.000) và ranh giới Cát Bà/Tam Giang —
  hạng mục riêng, không thuộc Task 8

- 2026-09-07 · Alias T9.4/9.5 · **nghiệm thu production và thử cập nhật lần hai; kèm một sự cố
  production tìm được khi đang smoke** · [hồ sơ](evidence/admin-alias/9-4-9-5-nghiem-thu-production.md) ·
  **Sự cố:** smoke area trả 0 item ở mọi truy vấn → không phải dữ liệu mà `autocomplete`/`search`/
  `nearby`/`reverse` đều 503, `geocode` và `/healthz/db` vẫn 200. Log CI job "API tests (Places, real
  DB)" cho nguyên nhân: `PostgresError: malformed array literal: "osm,overture,fsq"` —
  `poiSourceFilter` bind mảng JS rồi cast `::text[]`, bản `postgres/cf` trong Workers nối mảng thành
  chuỗi còn bản Node serialize đúng, nên lỗi **không hiện ở unit test không DB**. `geocode` sống vì
  đã dùng `textArray`. Sửa ở `2728347`, `test:api-db` **7 đỏ → 33 xanh**, deploy 16:01:47 (+07), cả 4
  endpoint về 200. **Lỗ hổng quy trình:** `deploy-api.yml` chỉ `on: push` và **không `needs:`** bộ
  test DB thật — trên cả `178d086` và `0585eb1`, API tests đỏ ~10 giây TRƯỚC khi Deploy API chạy mà
  deploy vẫn thành công. Đề xuất PHONG: cho Deploy API phụ thuộc job đó. · **9.4:** đạt coverage
  0 failure, 60 ca 48/60, geocode 9/10, API role đọc old table, export ODbL `admin_alias` **37.251**
  kèm sha256, playground dùng SDK mới; smoke `Quận 10`/`Bình Dương`/`Thủ Dầu Một` và loại trừ area
  đúng. **Giữ mở vì một ca thật:** tên hiện hành **kèm tiền tố đơn vị** làm khớp chính xác tụt hạng —
  `Phường Diên Hồng` hạng 2, `Phường Bàn Cờ` **không có trong 10**, bỏ tiền tố thì đúng hạng 1; nghi
  token `phuong` làm `word_similarity` cao giả. · **9.5 XONG:** ba trạng thái trên staging cho cùng
  checksum `84f4cedbe29495c9` — nền, sau `admin-old.mjs`, sau `admin.mjs`. Tức standalone idempotent
  **và cập nhật thường không làm mất alias** dù `admin.mjs` đánh lại toàn bộ ID `admin_area`; **rủi ro
  cron thứ Hai 14/09 không còn**. Checksum khoá theo tên đích + tên tỉnh, không theo `admin_area.id`.
  Ghi lại lỗi phép đo của tôi: checksum đầu đổi giữa hai lần chạy chỉ vì `ORDER BY` theo tên không
  phải thứ tự toàn phần (hai vùng cùng tên "Xã Đại Đồng"); `diff` cho đúng 2 dòng cùng nội dung khác
  vị trí — tin checksum mà không truy diff thì đã kết luận sai rằng pipeline không idempotent

- 2026-09-07 · Alias T9.3/9.4 · **đóng 9.4: sửa lỗi recall nhánh area; và một lỗi thứ tự build chặn CI** ·
  [hồ sơ](evidence/admin-alias/9-4-9-5-nghiem-thu-production.md) · **9.4:** smoke "tên hiện hành" lộ
  lỗi thật — `q="Phường Bàn Cờ"` trả về danh sách **không có** Phường Bàn Cờ (top Cầu Ông Lãnh 0,59)
  còn `q="Bàn Cờ"` trả đúng 0,801. Là **recall**, không phải xếp hạng: `admin_area.name_norm` lưu tên
  **không có tiền tố đơn vị**, nhưng nhánh current khớp bằng `queryCore`, mà `nameCore` chỉ bỏ filler
  POI — `NAME_FILLERS` có `'quan'` (quán ăn) nhưng **không có** `'phuong'`/`'xa'`/`'thi tran'`. Đo
  trực tiếp: `nameCore('Phường Bàn Cờ')` = `'phuong ban co'`, còn `nameCore('Quận 10')` = `'10'` (bỏ
  được chỉ vì trùng filler POI). Nên bậc 1 chạy `LIKE 'phuong ban co%'` → không khớp gì; bậc 2 fuzzy
  cũng bị pha loãng dưới ngưỡng 0,5 với tên ngắn. `Phường Sài Gòn`/`Xã Chợ Vàm` thoát được chỉ vì tên
  dài hơn — đó là lý do lỗi trông như "không đều". Sửa (`bde2d35`): nhánh current dùng tên đơn vị
  `parseAddress` đã tách sẵn, chỉ `ward`/`district` vì `province` bị canonicalize (`Bình Dương` →
  `Thành phố Hồ Chí Minh`); nhánh alias giữ `queryNorm` vì `alias_norm` **có** tiền tố. Production sau
  deploy: `Phường Bàn Cờ` **0,801 hạng 1**, `Phường Diên Hồng` **0,744 hạng 1**, có/không tiền tố cùng
  score; smoke area **5/5**; **hit@3 fuzzy 37/40 = baseline**. · **9.3:** `CI` đỏ ở `bde2d35` dù local
  xanh — `scripts/lib/poi-profile.mjs` → `pipelines/.../poi-filter.mjs` → `@mapslibvn/core`, mà
  `tsc -p tsconfig.scripts.json` chạy **trước** `turbo run typecheck` nên không có `packages/core/dist`.
  Local xanh chỉ vì dist đã build sẵn; tái hiện đúng lỗi CI bằng `rm -rf packages/core/dist &&
  pnpm typecheck`. Sửa (`44da644`): `pnpm typecheck` build core trước, đúng cách `pnpm test` vẫn làm

- 2026-09-07 · Alias T9.3 · **đóng 9.3 — cả 5 workflow xanh trên cây hiện tại** ·
  [hồ sơ mục 3b](evidence/admin-alias/9-4-9-5-nghiem-thu-production.md) · `CI` `9bccce2` success
  ([34107792243](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34107792243)) ·
  `Deploy API` `bde2d35` success
  ([34106026388](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34106026388)) ·
  `API tests (Places, real DB)` `bde2d35` success
  ([34106026398](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34106026398)) ·
  `Deploy Docs` `834db37` success
  ([34105145022](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34105145022)) ·
  `DB tests` `9bccce2` success **10 file / 62 test**
  ([34108066281](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34108066281)).
  Bảng trải nhiều SHA vì **mọi workflow đều lọc path**: commit chỉ-tài-liệu chỉ kích hoạt `CI`.
  `DB tests` bị cancelled suốt ngày do `concurrency: cancel-in-progress` cộng với push nối tiếp, và
  run xanh gần nhất (`0585eb1`) **trước** khi có `pipelines/poi/src/lib/poi-filter.mjs` — tức chưa
  kiểm cây pipeline hiện tại, nên đã `workflow_dispatch` một run trên `main` thay vì nhận run cũ.
  **Sửa lại phát biểu trước:** `deploy-api.yml` **có** gate trên `pnpm --filter @mapslibvn/api test`;
  cái nó **không** chờ là workflow riêng `apitest.yml` (DB thật) — và chính bộ DB thật mới bắt được
  `malformed array literal`. Đề xuất PHONG: cho Deploy API phụ thuộc `apitest.yml`

- 2026-09-07 · **HẠNG MỤC 1 (alias hành chính cũ–mới) NGHIỆM THU HOÀN TẤT — Task 0–9 đóng** ·
  hồ sơ: [8.3/8.4](evidence/admin-alias/8-3-8-4-coverage-production.md) ·
  [quyết định A/B/C](evidence/admin-alias/8-3-decision-prep.md) ·
  [8.5 benchmark](evidence/admin-alias/8-5-benchmark-area-cost.md) ·
  [9.4/9.5](evidence/admin-alias/9-4-9-5-nghiem-thu-production.md)

  **Phạm vi đóng — đọc trước mọi con số:** cổng xanh **trong phạm vi snapshot Geofabrik 250101 đã
  chứng minh** (4.215 relation `admin_level=8` cũ, **không phải** ~10.000 đơn vị pháp lý). 23 chỗ
  thiếu do nguồn được khai báo **có bằng chứng từng ca** trong
  `scripts/fixtures/admin-alias-known-gaps.json`; ca nào **không** khai báo vẫn chặn phát hành, và
  khai báo hết lỗi thì bị nhắc dọn (`stale_known_gap` hiện **0**).

  | Bằng chứng 9.7 | Giá trị |
  |---|---|
  | Cổng độ phủ production | **ok=true, 0 failure, 309 warning, exit 0** |
  | Counts thực | `admin_area` 3.353 (L4=34, L8=3.319) · `admin_area_old` 4.972 (L4 **63**, L6 **694**, L8 **4.215**) · `admin_alias` **37.251** |
  | Khoảng spec đã sửa | L4 [63,63] · L6 [690,710] · L8 **[4.200,4.300]** (gốc 10.000–10.700, lý do ở spec mục 11) |
  | Coverage exceptions | `known_gap_declared` **23** = outOfSnapshotScope 10, coverageGapNeedsSource 5, provenanceCollapsedByPk 3, boundaryVintageMismatch 3, offshoreNoTarget 2 · `coastal_gap_accepted` 55 · `discarded_sliver` 229 · `distinct_differs_from_relations` 2 · `stale_known_gap` **0** |
  | Checksum nguồn | `vietnam-250101.osm.pbf` md5 `1f0fdd199d7194e515a9c4b48b3e5835`, sha256 `01cc05f4…a566aad`, 306.547.939 B |
  | Fixture pass | alias cases **48/60**, ca tách **4/6** (12 ca còn lại khai báo có bằng chứng) |
  | Precision geocode | **9/10** đạt `rooftop\|alley\|interpolated`, không cặp nào kém địa chỉ mới, đều trong `expectedBbox` |
  | p50/p95/p99 — warm client | fuzzy POI: default 77/89/99 ms so với legacy 76/87/213 → **Δp95 +2 ms**; bộ area: 67/71/75 so với 67/73/92 → **Δp95 −2 ms** |
  | p50/p95/p99 — cold phía Worker | default 581/1.756/2.958 ms (n=164) so với legacy 488/1.919/2.950 (n=159) → **Δp95 −163 ms**; chi phí thật của `area` là **+93 ms cold p50** |
  | hit@3 fuzzy | **37/40 = baseline** (miss: `higland`, `cho rya`, `sieu thi co op`) |
  | Workflow | `CI` `9bccce2` ✅ [34107792243](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34107792243) · `Deploy API` `bde2d35` ✅ [34106026388](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34106026388) · `API tests (DB thật)` `bde2d35` ✅ [34106026398](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34106026398) · `Deploy Docs` `834db37` ✅ [34105145022](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34105145022) · `DB tests` `9bccce2` ✅ 10 file/62 test [34108066281](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34108066281) |
  | Artifact rollback | R2 `mapslibvn-20260907-0518.dump.zst` và `mapslibvn-20260907-1020.dump.zst`; restore + quyền `api` với bảng old đã thử trên `mapslibvn_restore_test`; Worker bản trước còn nguyên |
  | Cập nhật lần hai | `admin-old.mjs` và `admin.mjs` cùng cho checksum mapping `84f4cedbe29495c9` → không mất alias |

  **Cổng đi trong ngày: 84 → 79 → 24 → 0.** Chỉ bước 84→79 là sửa lỗi code (8 vùng cũ đất liền mất
  sạch alias do bộ lọc khoá nhập nhằng); ba bước sau là quyết định có bằng chứng (A/B/C, rồi khai báo
  chỗ thiếu). Commit chính: `149bb1f` (A+B), `a4a8146` (`--accept-qa` cho admin-old), `178d086`
  (publish production), `0585eb1` (đóng 8.3/8.4), `2728347` (sửa sự cố 503), `bde2d35` (recall nhánh
  area), `44da644` (thứ tự build), `9bccce2`/`9119f99` (hồ sơ).

  **Ba việc chuyển ra ngoài hạng mục 1, đã có hồ sơ:** (1) **nguồn ranh giới cấp xã cũ** — snapshot
  chỉ có 4.215/≈10.000, lệch cực không đều (Sơn La 1, Bắc Giang 2); (2) **ranh giới hiện hành Cát
  Bà–Cát Hải và đầm phá Tam Giang** cho 5 vùng chưa chứng minh được là nước; (3) **cho `Deploy API`
  phụ thuộc `apitest.yml`** — hôm nay Deploy API thành công dù bộ DB thật đỏ ~10 giây trước, và chính
  bộ đó bắt được `malformed array literal`. Phát hành npm để sau theo quyết định PHONG.

  **Điểm tiếp theo: viết plan hạng mục 3** — không tự implement phonetic, `viKey`, tsvector,
  `matched_alt` hay migration 0009.

- 2026-09-07 · Hạ tầng CI · **Deploy API giờ bị chặn bởi bộ test DB thật** (`f9f5fdb`) ·
  [hồ sơ](evidence/admin-alias/9-4-9-5-nghiem-thu-production.md) · vá đúng lỗ hổng đã để sự cố 503
  lên production hôm nay: Deploy API thành công trên `178d086` và `0585eb1` dù
  "API tests (Places, real DB)" đỏ ~10 giây trước. `needs` chỉ hoạt động giữa các job **cùng một
  workflow**, nên biến `apitest.yml` thành workflow gọi lại được (`workflow_call`) và Deploy API thêm
  job `apitest: uses: ./.github/workflows/apitest.yml` với `deploy: needs: apitest`. Chọn cách này
  thay `workflow_run` vì `workflow_run` phải tự xử lý checkout SHA và không chạy khi apitest không
  được trigger. **Hai bẫy đã xử lý:** (1) path hai workflow trùng ở `apps/api`/`apps/admin`/
  `packages/core` — giữ nguyên thì mỗi lần chạm `apps/api` chạy bộ test 15 phút **hai lần**, mà repo
  private chỉ có 2.000 phút Actions/tháng; đã cắt path trùng khỏi trigger `push` của apitest, giữ
  đúng phần deploy-api không bao (`db/migrations`, `scripts/api-db-test.mjs`, `scripts/lib`, chính
  file workflow). (2) `concurrency` của apitest có `cancel-in-progress` — dùng chung group thì một
  `workflow_dispatch` apitest giữa lúc deploy sẽ **huỷ luôn job cổng**; đã thêm `github.workflow`
  (workflow cấp cao nhất) vào group. **Nghiệm thu bằng run thật:** apitest độc lập trên `f9f5fdb`
  xanh (không vỡ đường cũ); `Deploy API` lúc khởi động chỉ có job `apitest`, job `deploy` chưa tồn
  tại; thứ tự thật `apitest` success **12:05:04** → `deploy` bắt đầu **12:06:42**, run success
  ([34119938354](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34119938354)); sau
  deploy production đủ 5 endpoint 200 và area `Phường Bàn Cờ` 0,801 hạng 1. Hệ quả: push chỉ chạm
  `packages/style/**` hay `pnpm-lock.yaml` từ nay cũng kéo theo bộ DB thật — đúng ý, vì cả hai đều
  vào bản Worker được deploy
- 2026-09-08 · Hạng mục 3 · **Nhận diện cách viết địa phương — code xong, chờ nghiệm thu production**
  · plan `docs/superpowers/plans/2026-09-07-cach-viet-dia-phuong.md`, Task 0–15 · migration `0009`
  thêm `name_key`/`name_alt_norm`/`name_tsv` (`poi`, `street`), `name_key` (`admin_area`,
  `admin_area_old`), `alias_key` (`admin_alias`) — đã áp lên production 07/09 (88 giây) và lên DB
  dev 08/09. Core có `viKey` (khoá ngữ âm, bảng luật là dữ liệu), `applyToponymAlias` (11 địa danh,
  **mọi dòng có nguồn OSM kiểm được**), `foldTelex`/`looksLikeTelex`, và `searchKeys`/`filterNameAlt`
  là **một định nghĩa duy nhất** mà pipeline, backfill và test đều gọi. API chạy ba bậc, bậc sau chỉ
  chạy khi bậc trước chưa đủ `limit`; `matched_alt` trả tên cũ còn dấu; bậc 3b telex nằm sau cờ
  `AUTOCOMPLETE_TELEX`, **mặc định tắt**, chờ số liệu `stage_hit`. SDK 0.4.0, **chưa publish npm**
  theo quyết định PHONG. Bằng chứng NULL-safe của spec mục 8 là bộ `test:api-db` 42/42 trên Postgres
  thật: trước Task 10–12 đúng 4 ca đỏ, sau đó xanh, 36 ca cũ không đổi. **Chưa có số production** —
  chờ Task 16 (deploy, backfill, chạy lại pipeline đường, đối chiếu tiêu chí 11.6)
- 2026-09-08 · Hạng mục 3 · **Phát hành production xong; tiêu chí 11.6 KHÔNG ĐẠT, đã đo rõ nguyên
  nhân** (`eb5cc76`, `52d8507`) · [hồ sơ](evidence/search-keys/16-nghiem-thu-production.md) ·
  backfill 1.522.417 POI (252 giây, chạy lần hai đúng 0 dòng), pipeline đường dựng lại 61.234 tuyến
  / 58.597 hẻm, DB 5.471 → 5.927 MB. **Đạt:** bộ 40 truy vấn mờ 38/40 (baseline 37/40, không hồi
  quy); 5/5 endpoint 200 khi cột dẫn xuất còn NULL — bằng chứng production cho khẳng định của spec
  mục 8; ba bậc đều dùng chỉ số 0009, không Seq Scan; `matched_alt` chạy thật (`co thanh ve` →
  Đường Bế Văn Đàn hạng 1). **Không đạt:** bộ 20 biến thể vẫn **3/20**, y hệt baseline. Ba nguyên
  nhân đã đo tách bạch: (a) với 1,52 triệu POI, bậc 1 luôn trả đúng `limit` nên `planStages` trả
  rỗng và **bậc 2/3 không bao giờ chạy** — trên DB dev 79.775 POI thì chúng có chạy và `kontum` →
  Kon Tum, `bin than` → Bình Thạnh đều đúng, tức cơ chế đúng còn điều kiện kích hoạt sai cỡ; (b)
  ngay trong bậc 1, `LIMIT 20` bị bão hoà bởi các dòng hoà `sim` nên dòng của nhánh alias bị cắt
  trước khi xếp hạng (`tan son nhut` đưa Tân Sơn Nhất lên hạng 4, không vào top 3); (c) `cong ly`
  là thiếu **dữ liệu**: OSM Việt Nam không gắn `old_name=Công Lý` cho Nam Kỳ Khởi Nghĩa. Sửa (a) và
  (b) là **sửa spec mục 5.4**, không phải sửa lỗi, nên để PHONG quyết. Hai lỗi lộ ra khi chạy thật
  đã vá trong `52d8507`: `edit-lock.dbtest.mjs` dựng tay `poi_work_record` thiếu cột mới (CI đỏ, máy
  dev không thấy vì bộ dbtest local không gồm file đó), và role `pipeline` thiếu `SELECT` trên
  `schema_migrations` làm cổng migration của backfill ném `permission denied`
- 2026-09-08 · Hạng mục 3 · **Đổi spec mục 5.4: ba bậc chạy song song** (`89d7fca`, PHONG duyệt
  "cách 2") · [hồ sơ](evidence/search-keys/16-nghiem-thu-production.md) · `planStages` quyết định
  theo dữ kiện có sẵn thay vì theo số kết quả bậc 1; `collectCandidates` phát mọi truy vấn của mọi
  bậc trước khi chờ. **Bộ 20 biến thể 3/20 → 6/20; tiêu chí 11.6 từ 1/5 lên 2/5** (`kontum` →
  Kon Tum hạng 3, `bin than` → Bình Thạnh hạng 1, `hoian` — cả ba đều do bậc 3). Không hồi quy bộ
  mờ (38/40) và **không tốn thêm thời gian đo được**: p95 lạnh bộ mờ 1.742 → 1.715 ms, vì các bậc
  song song nên phần thêm là max() chứ không phải tổng; p99 ấm bộ biến thể còn giảm 1.096 → 265 ms.
  Chi phí từng bậc đã đo TRƯỚC khi sửa, không đoán: bậc 2 từ 0 đến 4 ms khi có ≥ 2 token, bậc 3 từ
  1 đến 483 ms tuỳ độ phổ biến khoá; giữ điều kiện ≥ 2 token cho bậc 2 vì một token tốn 378–780 ms.
  Còn hai ca spec trượt, nay **chỉ** do bão hoà `LIMIT 20` ở bậc 1 (`tan son nhut` thua hạng 3 đúng
  0,003 điểm; `qui nhon` không có dòng "Quy Nhơn" nào lọt) và do OSM thiếu dữ liệu (`cong ly`)
- 2026-09-08 · Hạng mục 3 · **Chấm điểm dòng khớp alias bằng dạng chuẩn — biến thể 6/20 → 9/20,
  tiêu chí 11.6 lên 4/5** (`a76761a`) · [hồ sơ](evidence/search-keys/16-nghiem-thu-production.md) ·
  lỗi thật: nhánh `qAlias` TÌM theo dạng chuẩn nhưng `sim`/`prefix` vẫn tính theo chuỗi người dùng
  gõ, mà `ORDER BY sim DESC … LIMIT 20` dùng chính `sim` đó, nên dòng đúng vừa xếp thấp vừa bị cắt
  khỏi tập ứng viên. Đo trước khi sửa: "Sân bay quốc tế Tân Sơn Nhất" 0,769 với `tan son nhut`
  nhưng 1,000 với `tan son nhat`; POI "Quy Nhơn" cách near 0–1 km 0,636 với `qui nhon` nhưng 1,000
  với `quy nhon` — chênh 0,127 và 0,200 điểm, thừa sức lật ca `tan son nhut` vốn thua hạng 3 đúng
  0,003. Vì `ORDER BY` dùng chính biểu thức vừa sửa nên **không cần** thêm truy vấn UNION tách suất
  như phương án ban đầu tôi nêu, đỡ một vòng SQL cho mọi request. Nay `qui nhon` → Quy Nhơn Quán
  hạng 1, `tan son nhut` → cả top 3 đều dạng chuẩn. **Còn trượt `cong ly`** vì OSM không gắn
  `old_name` — không nhét vào `toponym_alias.json` được, từ điển đó thay chuỗi ở mọi vị trí nên sẽ
  phá hỏng việc tìm "Phở Công Lý". Trong 11 ca còn trượt của bộ 20 có **4 ca API trả đúng địa
  phương nhưng tên POI viết theo cách người dùng gõ** (`dac lac`→Đắc Lắc, `bac can`→Bắc Cạn,
  `saigon`→Saigon, `mi tho`→Bánh Mì Thổ) mà fixture đòi chuỗi đích phải nằm trong tên trả về — đây
  là câu hỏi về tiêu chí chứ không phải về mã, và tôi không sửa bộ mẫu để làm đẹp con số
- 2026-09-08 · Hạng mục 3 · **Fixture nhận nhiều cách viết — biến thể 9/20 → 15/20** (`6de84f9`,
  PHONG duyệt "trả đúng địa phương là đạt") ·
  [hồ sơ](evidence/search-keys/16-nghiem-thu-production.md) · định dạng fixture mở rộng thành
  `q|đích1;đích2`, trúng khi **bất kỳ** đích nào nằm trong top 3. Sáu dòng được thêm cách viết
  (`dac lac`, `bac can`, `saigon` do PHONG nêu; `bmt`, `plei ku`, `li thuong kiet` cùng nguyên tắc),
  **mỗi cách viết liệt kê tường minh** và **đã kiểm vị trí trên production** trước khi thêm: hạng 1
  của `bmt` ở tỉnh Đắk Lắk, của `plei ku` ở Gia Lai, của `li thuong kiet` đúng đường ở HCM. Cố ý
  **không** so bằng khoá ngữ âm — làm thế thì "Bánh Mì Thổ Nhĩ Kỳ" sẽ tính là trúng cho `mi tho`.
  Ba ca cuối cũng đã phân tích xong với **ba nguyên nhân khác nhau**: `bmt` là viết tắt (khoá ngữ âm
  không nối viết tắt với tên đầy đủ); `plei ku` là lỗ hổng thật của bảng luật (`k+u → c` là luật đầu
  từ, nên `plei ku` → `pleicu` mà `pleiku` → `pleiku`); `li thuong kiet` có khoá đúng nhưng 620 POI
  tên chứa "Lý Thường Kiệt" bị `STAGE_PENALTY` đẩy xuống dưới dòng bậc 1 khớp trực tiếp "Lí Thường
  Kiệt"
- 2026-09-08 · Hạng mục 3 · **ĐÓNG hạng mục 3 — bộ mẫu 19 dòng, 15/19 và 15/15 trên phần khả thi** ·
  [hồ sơ](evidence/search-keys/16-nghiem-thu-production.md) · vòng này **không đổi hành vi API**:
  chỉ bỏ `mi tho` khỏi bộ mẫu, thêm fixture đo A/B cho cờ telex, và ghi hai khiếm khuyết đã đo vào
  tài liệu. Bốn ca trượt còn lại **trùng khít** bốn ca tên đường cũ mà PHONG quyết bỏ qua, nên tiêu
  chí đóng bước 7 đổi từ con số "≥ 18/20" sang **"mọi ca trượt đều có nguyên nhân đo được và có
  quyết định của PHONG"** — với 4 ca trần cứng thì 18/20 là bất khả thi về **dữ liệu**, không phải
  nợ mã; con số 18/20 không bị sửa lại cho khớp và bốn ca vẫn giữ trong bộ mẫu để nếu sau này có
  nguồn thì con số tự phản ánh. **Cờ `AUTOCOMPLETE_TELEX` vẫn TẮT** theo quyết định của PHONG,
  nhưng đã đo thẳng thứ mà plan định suy từ phân bố `stage_hit` và ghi thành fixture
  `scripts/fixtures/telex-queries.txt`: 5 trong 14 chuỗi telex thật đang trả **0 item**
  (`ddoongf khowir`, `ddaf laatj`, `ddaf nawngx`, `chowj beenf thanhf`, `ddieenj bieenj`) và
  `foldTelex` gập đúng cả năm. Đáng ghi cho lần quyết định sau: cờ này **không có đường hồi quy**
  vì `telexFallback` bỏ qua ngay khi `have > 0`, tức bậc 3b chỉ chạy đúng lúc API đang rỗng; và
  điều kiện `have === 0` của spec 5.6 **đúng cỡ** — khác với điều kiện của bậc 2/3 đã phải sửa —
  vì chuỗi telex chứa `dd`/`aa`/`ee` thì trigram không khớp gì cả. **Hai khiếm khuyết đo được, chưa
  sửa, cả hai đòi sửa spec:** (1) `viKey` nối cả tên thành một cục nên `word_similarity` mất ranh
  giới từ và bậc 3 chỉ cứu được tên **ngắn** — đối chứng là `my tho` gõ ĐÚNG chính tả cũng chỉ đưa
  `area Phường Mỹ Tho` lên hạng 10, và hạng đó do `withAreaSlot` nhét vào suất cuối chứ không do
  điểm; sửa gốc phải migration + backfill lại 1,52 triệu POI (đã ghi ở JSDoc `viKey`); (2)
  `foldTelex` không gập chữ `w` trơ (`traanf hwng ddaoj` → `tran hwng dao`) và không với tới dấu
  telex đứng trước phụ âm cuối (`beexn thanhf` → `bexn thanh`). Không hồi quy: bộ mờ 40 vẫn
  **38/40**, p95 lạnh 1.630 ms (lần trước 1.751 ms)

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
  admin relation raw → `admin_area` 3.288 (L4=33, L8=3.255; OSM thiếu Khánh Hòa), 33
  alias distinct; 61.031 street; 58.388 alley, 52.408 (89,76 %) có parent+entrance và 0
  entrance xa đường mẹ >1 m; 923.541 anchor, Nguyễn Lâm 174, exact duplicate ≤30 m = 0.
  Task 7 bất biến: 1.897.933 records / 1.522.371 POI / 1.583.562 links. TDD pure 5/5,
  geocode fixture 7/7 async child trên DB `mapslibvn_task8_test`, gồm fault cleanup + exact
  boundary/source regressions; staging national=0; disk volume final 349 GiB trống, host 21 GiB trống ·
  (commit hiện tại)
- 2026-08-29 · M2 T9 · `export-tiles.mjs` (poi active → GeoJSONSeq → tippecanoe `-Z10 -z16
  -r1 --drop-densest-as-needed` + bộ lọc mật độ 5.8) chạy thật trên kho national:
  **1.515.938 POI → 244,6 MB** (dưới mục tiêu 300 MB), `inspect` `zoom: [10, 16]`,
  `layers: ["poi"]`, 192.467 tile; QA chủ quyền `--skip-islands` đạt. Giải mã tile z10/815/481
  (TP.HCM) chỉ có 5 nhóm công cộng q ≥ 7 — bộ lọc đúng. Style: lớp `poi` chèn ngay trước
  `sovereignty-label` (light 102 layers, dark 49), 13 icon nhóm đều có trong sprite
  osm-liberty; Worker bỏ nguồn/lớp `poi` khi manifest chưa có bản POI. `smoke.mjs --set poi`
  (maxZoom 16, z12–16, cho phép tile trống, ngưỡng ≥ 15/20); playground hiện tên · loại (nhóm)
  khi bấm POI. lint sạch, typecheck 10/10, **450/450 test** (438 root + 12 api), E2E 2/2 ·
  (commit hiện tại)
- 2026-08-29 · M2 T1 (Step 1–8, **Step 9–10 chờ PHONG**) · máy chủ nội bộ chạy thật trên máy
  dev với `PIPELINE_IMAGE=mapslibvn/pipeline:local`: `pnpm server:setup` sinh
  `infra/server/.env` (3 mật khẩu 32 ký tự, `PG_SHARED_BUFFERS` = 25 % RAM), chứng chỉ tự ký
  10 năm trong volume `pgcerts`, `docker compose up -d` 3 dịch vụ, áp dụng **5 migration**
  (0001–0005), đồng bộ role, `ssl = on`. Chạy lại **idempotent 8 giây** (`.env` giữ nguyên,
  chứng chỉ giữ nguyên, 0 migration). Kiểm chứng: `api|t` + `pipeline|t`; kết nối
  `sslmode=require` → `ssl = t`; `sslmode=disable` → `FATAL: pg_hba.conf rejects connection …
  no encryption` (TLS bắt buộc thật, không chỉ trên README). `backup --once` →
  `mapslibvn-20260829-2142.dump.zst` lên `r2:mapslibvn-tiles/backups/daily`; restore vào DB
  mới `restore_smoke` **không một lỗi nào**, `schema_migrations` = 5 = số migration up trong
  repo. Log daemon đúng lịch: backup `2026-08-29T20:00:00Z` (03:00 VN), cron
  `2026-08-30T19:00:00Z` (thứ Hai 02:00 VN). Image rebuild có `backup.mjs`/`cron.mjs`, không
  chứa `infra/server/.env`. lint sạch, typecheck 10/10, **462/462 test** (450 root + 12 api) ·
  `7af8c31`
- 2026-08-30 · M2 T1 Step 9–11 · **Task 1 ĐÓNG.** Tunnel `mapslibvn-db` HEALTHY (4 kết nối
  quic tới sin21/sin18/sin14). Kiểm hai chiều từ máy dev qua `cloudflared access tcp`: có
  service token → `current_user = api`, `ssl = t`; bỏ service token → Access đóng kết nối.
  Hyperdrive `71d7a62b89e9462e91bb0094af1f750f` tạo bằng `wrangler hyperdrive create`
  (host `maps-db.ai-solutions.io.vn`, user `api`, **không port**). Worker: `postgres@3.4.5`,
  `src/db.ts`, `Env.DB`, route `/healthz/db`, binding `DB` trong `wrangler.toml` (dev +
  production). **Nghiệm thu: `wrangler dev --remote` → `/healthz/db` trả
  `{"ok":true,"user":"api","version":"PostgreSQL 16.4"}`** — Worker → Hyperdrive → Access →
  Tunnel → máy nội bộ thông suốt. lint sạch, typecheck 10/10, **463/463 test**
  (450 root + 13 api) · (commit hiện tại)
- 2026-08-31 · M2 T10 · dò release 3 nguồn + kế hoạch/state R2; `data:update` đủ nhánh
  `--tiles`/`--poi`/`--force`; workflow Tunnel/HF; restore nguyên tử + reconcile quyền;
  fixture full-pipeline và DB test cô lập. Live national hoàn tất theo thứ tự pipeline qua
  các lần resume có kiểm soát sau lỗi mạng: 1.897.986 record → 402.242 cặp → 1.522.416 POI
  (1.515.983 active), 1.583.616 link; 3,3 % đa nguồn; 923.567 anchor; Nguyễn Lâm 174.
  `poi-20260830.pmtiles` 244,623 MiB đã QA/upload/smoke và active trong manifest; dry-run
  ngay sau live trả `tiles:false, poi:false`. Đến 09:55 ngày 31/08, Geofabrik đổi OSM
  `b0b8… → c256…`; dry-run đúng khi lên kế hoạch `tiles:true, poi:true` cho cron kế tiếp.
  Restore backup mới nhất trả đúng 1.522.416 POI và owner/grant; DB test **32/32** trong
  595 giây; unit/API **480/480**, E2E docs **2/2**,
  lint/typecheck/build/image smoke sạch. Production playground z14 render 653 POI và click
  thật hiện `Museum of Ho Chi Minh City · museum (culture_tourism)`. Sau merge vào `main`,
  remote CI cần 3 bản sửa (build `@mapslibvn/style` trước fixture QA, giữ pending work khi
  chạy partial, nới `DBTEST_CHILD_TIMEOUT_MS` 840 giây + `timeout-minutes: 45`) rồi xanh cả
  3 job trên `30f0274`. Còn 5 Actions secret là việc tay của PHONG (mục 2) · `30f0274`
- 2026-09-01 · M3 T9 · `<mapslibvn-autocomplete>` + playground/E2E; sửa normalization mảng
  Hyperdrive/KV trong auth; browser và E2E 3/3 xanh · `3aed3ab`, `9c61812`
- 2026-09-01 · M3 T10 · `@mapslibvn/react` + demo docs responsive; 5 test hook, desktop/mobile
  browser xanh; CI + Deploy Docs + Deploy API + API DB test remote đều xanh · `ece8d1e`
- 2026-09-01 · M3 T11 · quota KV 2× + Analytics Engine cho 6 Places route; local request
  51 trả 429 đúng; production giữ quota off · `6eb4ade`
- 2026-09-01 · M3 T12 · production fixture/p95/React demo đạt; khôi phục server Postgres
  bị bind mount vào worktree tạm; M3 đóng · (commit hiện tại)
- 2026-09-01 · M3 hậu nghiệm thu · playground tự chọn Worker production khi mở URL không
  có `?api=`; localhost và query override vẫn giữ; thêm unit regression + E2E URL ngắn · (commit này)
- 2026-09-03 · M6 T10 · `<Marker>` bọc `Marker` native (wrapper bắt buộc có children nên khi
  không truyền thì dựng ghim tròn 22 pt viền trắng màu `#3FB1CE`), `anchor` mặc định `center`,
  gọi `useMap()` để ném lỗi nếu đặt ngoài map. 3 test; gate: lint 262 file, vitest 56 file /
  566 test · (commit này)
- 2026-09-03 · M6 T9 · `<MapsLibVNMap>` bọc `Map` + `Camera` của wrapper: mặc định
  `[106.7, 10.776]` zoom 12 như SDK web, `logo={false}` nhưng `attribution` native vẫn bật
  cộng dòng MapsLibVN chồng lên (bấm mở hộp thoại native). `onPoiClick` đi qua
  `queryRenderedFeatures(point, {layers:['poi']})` → `toPoiFeature`; không query khi
  `poiLayer=false` hoặc không có handler. `onLoad` chỉ gọi một lần cho mỗi `mapKey`
  (`apiKey|apiBase|style|lang|poiLayer`) nhờ ref `loadedFor`. `bundleId` → `X-Bundle-Id`.
  `useMap()` ngoài map ném lỗi tiếng Việt. 9 test, gói 25 test · (commit này)
- 2026-09-03 · M6 T8 · `useResolvedStyle`: mặc định (`lang=vi`, POI bật) trả thẳng URL style cho
  native — không fetch; chỉ khi đổi ngôn ngữ hoặc ẩn POI mới tải JSON rồi biến đổi thuần bằng
  `localizeStyle`/`hidePoiLayer` của core. Lỗi HTTP → `Không tải được style (HTTP n)`. 6 test.
  `StyleSpecification` khớp `StyleLike` nên **không** cần cast dự phòng mà plan nêu · (commit này)
- 2026-09-03 · M6 T7 · mock `react-native` (View/Text/Pressable → phần tử DOM) và mock wrapper
  (`Map`/`Camera`/`Marker` + ref giả) trong `src/test/`; `Attribution` bắt buộc, dạng gọn là
  `© MapsLibVN · © OpenStreetMap contributors`, bấm gọi `showAttribution` native. **Khác plan:**
  vitest root không bật `globals` nên RTL không tự dọn DOM — test component phải tự
  `afterEach(cleanup)`, nếu không `getByTestId` báo "found multiple elements". Gói 10 test · (commit này)
- 2026-09-03 · M6 T6 · `MapHandle`/`MapContext` (`native` + `camera` là ref của wrapper, `places`
  là client core, `flyTo`/`fitBounds`/`getBounds`); `usePlaces` + test copy nguyên từ
  `@mapslibvn/react` — không sửa dòng nào vì `MapHandle.places` giữ đúng tên. 5 test xanh với
  React 19 của gói · (commit này)
- 2026-09-03 · M6 T5 · `toPoiFeature` ánh xạ feature lớp `poi` (`id/name/cat/grp` → `PoiFeature`),
  trả `null` khi không phải Point; thiếu `properties` thì lấy `feature.id`. 3 test · (commit này)
- 2026-09-03 · M6 T4 · khung `packages/react-native`: `package.json` (peer React ≥ 19.1 / RN ≥ 0.80 /
  wrapper ^11.3, devDeps React 19 riêng nên **root vẫn React 18.3.1**), `tsconfig.json`
  (`jsx: react-jsx`, `lib` có DOM cho test jsdom), `tsup.config.ts` `noExternal: ['@mapslibvn/core']`.
  `SDK_PACKAGES` lên 4 gói → notices 8 bản sao (`notices-sync.mjs` in số gói từ hằng thay vì
  chuỗi "3 gói" cứng). Vitest include thêm `*.test.tsx`. Gate: lint 247 file, typecheck 14 task,
  vitest 50 file / 538 test · (commit này)
- 2026-09-03 · M6 T3 · `packages/core/src/style-transform.ts`: `Lang`, `nameExpression`,
  `isNameLabelLayer`, `localizeStyle`, `hidePoiLayer` — biến đổi style JSON thuần cho RN
  (wrapper không đổi được layout property của lớp có sẵn). `language.ts` của web rút còn
  `applyLanguage` dùng `isNameLabelLayer` từ core. Core 336 test, web 8/8; core 6,96 kB gzip,
  web 3,97 kB · (commit này)
- 2026-09-03 · M6 T2 · `PoiFeature` chuyển vào `packages/core/src/types.ts`, `map.ts` của web
  import rồi re-export nên `index.ts`/`umd.ts` và `@mapslibvn/react` không phải đổi dòng nào.
  Web typecheck + 8/8 test xanh; lint 243 file, typecheck 13 task xanh · (commit này)
- 2026-09-03 · M6 T1 · `ClientOptions.headers` gộp vào cả `get` và `post` qua `baseHeaders()`;
  `X-Api-Key` đặt sau nên header tuỳ chọn không giả mạo được khoá. 2 test mới (client 5/5);
  core build 6,58 kB gzip (budget 8) · (commit này)
- 2026-09-03 · M6 T0 · kiểm trạng thái trước M6: git sạch trên `main`, `pnpm check:git` OK;
  CI remote `471bd92` xanh; gate local xanh (lint 243 file, typecheck 13 task cache hit,
  vitest root 49 file / 529 test, API 19 file / 87 test); công cụ mobile đủ — Xcode 26.6
  (6 simulator iOS 26.0), Android SDK có AVD `Pixel_7`, Node v22.23.2 · (commit này)
- 2026-09-03 · **M6 spec** · brainstorming với PHONG rồi viết
  `docs/superpowers/specs/2026-09-03-react-native-sdk-design.md` (gói `@mapslibvn/react-native`,
  app Expo thử `examples/embed-rn` + `pnpm example:rn`, trang docs, khoá `mobile`); sửa spec gốc 8.1
  (pmtiles do native đọc), roadmap 0.4 thêm hàng 7; DEVLOG mục 1 dọn văn bản cũ · (commit này)
- 2026-09-03 · M5 hậu nghiệm thu · `pnpm example:embed --key mlv_live_…` mở trang thử bằng một lệnh:
  máy chủ tĩnh Node (không phụ thuộc python), chặn thoát thư mục, tự mở trình duyệt theo hệ điều
  hành; khoá lấy từ `--key` hoặc `MAPSLIBVN_DEMO_KEY`, **không** nằm trong repo. 7 test cho
  `scripts/lib/example-serve.mjs`; kiểm thật: trang 200, `/../.env` trả 404 · (commit này)
- 2026-09-03 · **M5 T9 XONG — M5 NGHIỆM THU, SPEC BẢN 2 HOÀN TẤT** · trang thử độc lập `examples/embed-web/index.html` (khoá lấy từ query
  string nên không nằm trong repo); seed tenant `…000002` lên **production** và cấp khoá `web`
  đuôi `…x6YN` cho origin `http://localhost:5500` bằng `pnpm key:issue` chạy trong container.
  Kiểm production: trang 200, SDK UMD/CSS 200, `/v1/styles/light.json` 200, autocomplete trả POI
  thật, tiles `vn-20260827` 206 với Range, origin lạ 403 `origin_not_allowed`. Sau ~2 phút khoá mới
  xuất hiện trong báo cáo tuần (5 request, đúng tên tenant). `docs/legal/checklist-phap-ly.md`
  đã viết (A 10 mục có bằng chứng, B 6 việc luật sư, C 5 việc kỹ thuật) — **chỉ còn chờ PHONG ký**.
  Bảng nghiệm thu đầy đủ ở mục 10 · (commit này)
- 2026-09-03 · **M5 T8 XONG** · PHONG tạo 2 token trên dashboard (`mapslibvn-report`:
  Account Analytics Read + Email Sending Edit; token pipeline: Workers KV Edit + Workers R2 Edit)
  và xác nhận **đã nhận** thư báo cáo gửi 02/09. Kiểm đường tự động **trong container `pipeline`**:
  (1) `weekly-report.mjs --dry-run --this-week` đọc Analytics bằng `CF_REPORT_API_TOKEN` → 11 nhóm,
  788 request; nhãn tenant/key giờ **đúng tên** (`Free thử nghiệm`, `free test 429`) vì container
  đọc DB production, khác lần chạy trên máy dev trước đó chỉ có UUID thô;
  (2) gửi thật không cờ `--dry-run` → `delivered`, message_id
  `<nl32fdOc4f4oXiH0TOqMF52BMErpY8iUQlvz@ai-solutions.io.vn>` — lần này **qua token trong
  `infra/server/.env`**, không qua OAuth, tức đúng đường mà cron sẽ đi;
  (3) `manifest.mjs get` đọc được KV bằng token pipeline mới (`vn-20260827` / `poi-20260830`) →
  sự cố tiềm ẩn "data:update lỗi ở bước manifest" đã được vá.
  Cron in `[cron] data:update kế tiếp 2026-09-06T19:00:00.000Z (thứ Hai 02:00 VN)`;
  báo cáo tuần sẽ tự chạy lúc 08:00 cùng ngày. Thêm `scripts/report-setup-check.sh` để lần sau
  kiểm lại bằng một lệnh · (commit này)
- 2026-09-03 · M5 T8 (tiếp) · thử tạo token `mapslibvn-report` giúp PHONG: **không làm được** —
  `GET/POST /accounts/{id}/tokens`, `/user/tokens` và `/user/tokens/permission_groups` đều trả
  `9109 Unauthorized to access requested resource` với **cả** token deploy **và** phiên OAuth MCP.
  Cloudflare cố ý không cho app OAuth hay API token tự sinh token mới; chỉ dashboard (hoặc Global
  API Key) làm được. Đã chuẩn bị sẵn phần còn lại: `infra/server/.env` thêm `CF_REPORT_API_TOKEN=`
  (để trống, có hướng dẫn), `REPORT_EMAIL_TO`, `REPORT_EMAIL_FROM`; build lại image local
  `mapslibvn/pipeline:local` (máy chủ tạm dùng image **local**, không kéo GHCR — `PIPELINE_IMAGE`
  trỏ `mapslibvn/pipeline:local`) và tạo lại **chỉ** container `pipeline` — cố ý không chạy
  `pnpm server:update` vì nó `pull` + `up -d` cả `postgres`, có thể làm production DB khởi động lại.
  Log máy chủ giờ in `[cron] data:update kế tiếp 2026-09-06T19:00:00.000Z (thứ Hai 02:00 VN)`;
  ba dịch vụ kia không bị chạm, `/healthz/db` vẫn `ok:true`. Dry-run trong container dừng đúng chỗ:
  `Thiếu biến môi trường CF_REPORT_API_TOKEN`.
  **Sự cố tiềm ẩn phát hiện nhân đây (không thuộc M5):** `CLOUDFLARE_API_TOKEN` trong
  `infra/server/.env` **đang rỗng**, mà `pipelines/tiles/src/manifest.mjs` gọi
  `requireEnv('CLOUDFLARE_API_TOKEN')` → job `data:update` của cron trên máy chủ sẽ **lỗi ở bước
  publish manifest KV**. Các biến R2/rclone/HF đều có nên backup và ingest không ảnh hưởng.
  Cần token pipeline riêng (Workers KV Edit + Workers R2 Edit) đúng như ghi chú trong chính file .env · (commit này)
- 2026-09-02 · M5 T8 · **báo cáo tuần đầu đã gửi thật**: `from maps-report@ai-solutions.io.vn` →
  `dotienphong1993@gmail.com`, Cloudflare trả `delivered` với `message_id`
  `<QV81M62SZJyjPir0uM6Zpt1W9sqvxtsKcJqO@ai-solutions.io.vn>`; nội dung là báo cáo tuần đang chạy
  (788 request, 19 lỗi 5xx, 3 bảng). Gửi qua **phiên OAuth MCP của PHONG**, không qua token trong `.env`.
  Phát hiện khi khảo sát tài khoản: zone `ai-solutions.io.vn` **đã bật Email Routing từ 18/06/2026**
  (MX + DKIM `cf2024-1._domainkey` + SPF `include:_spf.mx.cloudflare.net`), và
  `dotienphong1993@gmail.com` là destination đã xác minh — nên bước "Add domain" trong plan
  **không cần làm lại**; `/email/sending/suppressions` đọc được nên account có Email Sending.
  **Mâu thuẫn cần PHONG xác nhận:** lệnh gửi trả `delivered`, nhưng
  `GET /email/sending/messages/<id>` trả `10401 email.message.error.sending_not_enabled`.
  Có thể tra cứu thông điệp cần entitlement riêng, hoặc thư đi bằng đường Email Routing.
  → **Việc tay còn lại của Task 8:** kiểm hộp thư xác nhận đã nhận, rồi tạo token
  `mapslibvn-report` (Account Analytics: Read + Email Sending: Edit) và điền 3 biến vào
  `infra/server/.env` + `pnpm server:update` để cron thứ Hai 08:00 gửi tự động. Token deploy
  hiện tại **không** có quyền Email Sending (đã thử: `10000 Authentication error`).
  Cron đã kiểm chạy local: in `data:update kế tiếp 2026-09-06T19:00:00.000Z (thứ Hai 02:00 VN)` · (commit này)
- 2026-09-02 · M5 T7 · `scripts/weekly-report.mjs` (Analytics SQL API → nhãn tenant/key từ DB →
  email qua Cloudflare Email Sending REST API) + `cron.mjs` chạy **2 job** qua `nextJob` mới
  (`data:update` 02:00, `report:weekly` 08:00 thứ Hai VN, khoá file riêng từng job) +
  `.env.example` và `infra/server/README.md` bước 6 hướng dẫn bật Email Sending và token 2 quyền.
  **Chạy thật `--dry-run` trên dữ liệu production:** 11 nhóm, 788 request, 19 lỗi 5xx, p95 9.096 ms;
  bảng theo tenant/key/endpoint hiện đúng nhãn từ DB.
  Hai điều chỉnh phát sinh khi thấy báo cáo thật: (1) thêm cờ `--this-week` vì tuần trước
  (24–30/08) chưa có traffic nên báo cáo rỗng — Task 8 cần xem ngay được; (2) `summarize` gộp
  thêm `/v1/admin/edits/:id/{approve,reject}` vì mỗi id trước đó thành một dòng riêng.
  Lưu ý khi chạy trên máy dev: nhãn tenant lấy từ **DB dev** nên tenant chỉ có trên production
  (ví dụ `…0000bb` free test) hiện dưới dạng UUID thô; chạy trong container `pipeline` thì đúng tên.
  root 521 test, api 87, lint 240 file · (commit này)
- 2026-09-02 · M5 T6 · `scripts/lib/weekly-report.mjs`: `weekRange` (tuần trước trọn vẹn theo giờ VN),
  `analyticsSql`, `maskKey`, `summarize` (gộp theo tenant/key/path, gộp `/v1/places/:id`, top 15),
  `renderText` + `renderHtml` (3 bảng, escape HTML). 13 test, xanh ngay lần đầu.
  **Đã thử câu SQL trên Analytics Engine thật trước khi cố định vào test** (token deploy đủ quyền):
  `quantileWeighted(0.95)(double2, _sample_interval)` chạy, còn `quantile(...)` trả
  `unknown function call: QUANTILE`; `sumIf` + `toDateTime` chạy. Câu truy vấn gộp đầy đủ trả 11 nhóm.
  Phát hiện quan trọng: **SUM/sumIf trả chuỗi** (UInt64) còn `quantileWeighted` trả số, nên
  `summarize` phải `Number()` mọi ô — đã có test riêng cho dữ liệu dạng chuỗi · (commit này)
- 2026-09-02 · M5 T5 · `pnpm export:odbl` xuất 5 bảng dẫn xuất OSM (`src_osm_place`, `admin_area`,
  `admin_alias`, `street`, `alley`) thành CSV gzip geometry WKT + `manifest.json` (số dòng,
  SHA-256, release OSM) + `README.md` ghi ODbL 1.0 và attribution + file `LATEST`.
  Chạy thật trên fixture: 9.667 + 21 + 3 + 1.094 + 2.177 dòng; SHA-256 trong manifest khớp
  `shasum -a 256` độc lập. dbtest 1/1, scripts/lib 78/78.
  **Hai bẫy stream đã gỡ (ghi để không lặp lại):** (1) `gzip.on('data')` để băm làm stream sang
  flowing mode, tranh dữ liệu với `pipeline` → thay bằng `Transform` nằm trong chuỗi;
  (2) sau `copy … to stdout` qua porsager, **kết nối không dùng lại được** (driver có lỗi
  "You cannot execute queries during copy", thực tế là treo im lặng) → truy vấn siêu dữ liệu
  làm trước trên kết nối chung, rồi mỗi COPY một kết nối riêng đóng ngay sau đó · (commit này)
- 2026-09-02 · M5 T4 · `db/seed/tenant_nhung_thu.sql` (tenant `…000002`, plan internal, **không**
  seed khoá) + `pnpm key:issue` sinh khoá ngẫu nhiên bằng rejection sampling (bỏ byte ≥ 248 để
  62 ký tự đều xác suất), validate `--kind`, `--origins`, in khoá đúng một lần. Kiểm thật trên
  DB dev: cấp khoá `web` origin `http://localhost` → autocomplete 200; origin lạ → 403
  `origin_not_allowed`; POST `/v1/edits` → 403 `scope` vì khoá chỉ có `places:read`. Khoá thử
  đã xoá khỏi DB dev. scripts/lib 73/73, typecheck sạch · (commit này)
- 2026-09-02 · M5 T3 · ba trang docs còn thiếu: `giay-phep` (MIT + 4 nguồn dữ liệu + ODbL Collective
  Database + chủ quyền), `do-chinh-xac` (bảng 5 mức `precision`, cách dùng đúng, giới hạn đã biết),
  `tu-host` (kiến trúc, máy dev 2 thứ, máy chủ 24/7, tiles, deploy, giám sát). Sidebar tách nhóm
  Hướng dẫn/Pháp lý đủ 7 mục; `bat-dau.md` đổi URL giả `*.example.com` sang endpoint thật và thêm
  ghi chú domain tạm; thêm card độ chính xác ở trang chủ. `docs.spec.ts` kiểm 8 trang + mọi link
  nội bộ. Docs build 10 trang, astro check 0 lỗi, E2E 11/11.
  Đã đối chiếu mã trước khi viết: `geocode()` của core nhận **chuỗi** và trả `{items}` với
  `matched`/`display_name` (không phải `{results}`/`address` như bản nháp), confidence đúng
  0,9/0,95/0,7/0,6/0,4/0,2 trong `geocode.ts`, reverse trả `≈ a–b` · (commit này)
- 2026-09-02 · M5 T2 · `docs/legal/dieu-khoan-tenant.md` (10 mục: khoá API, ghi nguồn, cấm cào,
  dữ liệu cá nhân theo Nghị định 13/2023, ODbL, giới hạn trách nhiệm) + `copy-legal.mjs` sinh
  hai trang docs `dieu-khoan` và `thong-bao-ben-thu-ba` lúc prebuild từ file canonical, có
  gitignore để không lệch nguồn; sidebar tách nhóm Hướng dẫn / Pháp lý; `deploy-docs.yml` thêm
  `docs/legal/**` và `THIRD_PARTY_NOTICES.md` vào paths để đổi văn bản là deploy lại.
  Trước khi viết đã đối chiếu lược đồ thật: `end_user_hash = sha256(tenant_id + token do app cấp)`,
  `ip_hash = sha256(IP + ngày VN)` — điều khoản mục 5 ghi đúng theo mã, kèm câu trung thực rằng
  mã băm IP chỉ chống liên kết chéo ngày, không nhằm chống dò ngược (muối là ngày, không phải
  bí mật — xem việc theo dõi ở mục 2). Docs build 7 trang, astro check 0 lỗi, lint 229 file · (commit này)
- 2026-09-02 · M5 T1 · `LICENSE` MIT ở gốc repo + `THIRD_PARTY_NOTICES.md` (5 mục, nguyên văn
  BSD-3 của maplibre-gl 5.24.0 / pmtiles 4.5.0 / osm-liberty / dark-matter, MIT của React 18.3.1,
  ghi chú OFL 1.1 cho Noto Sans và CC0 cho Maki); `scripts/notices-sync.mjs` đồng bộ 6 file vào
  `packages/{core,web,react}` + `files` trong 3 package.json + bước CI `notices-sync --check`.
  Kiểm `pnpm pack` gói core: tarball có `package/LICENSE` và `package/THIRD_PARTY_NOTICES.md`.
  Phát hiện: gói npm `pmtiles` không kèm file giấy phép (chỉ field trong package.json) nên lấy
  nguyên văn từ repo gốc; **Temaki trong spec 3.2 thực tế không dùng** — chỉ có Maki qua sprite
  osm-liberty, notices ghi theo thực tế. lint 228 file, typecheck sạch, scripts/lib 68/68 · (commit này)
- 2026-09-02 · M5 T0 · kiểm trạng thái trước M5: CI remote xanh, docs 200, Analytics Engine có
  dữ liệu thật (760 request `/v1/autocomplete` 7 ngày). `/healthz/db` 503 vì Docker Desktop trên
  máy dev đang tắt (máy dev = máy chủ tạm) — việc tay, không phải lỗi mã · `1a51c44`
- 2026-09-02 · M4 T11 · cấu hình custom domain + Cloudflare Access production bằng MCP;
  thêm vars Access và đổi playground production API (`5cbf1a0`); toàn bộ local gates xanh
  (lint 225 file, typecheck, root 490, API 87, API DB 22, admin E2E 3, DB 41 trong image).
  Áp dụng migration 0006 + seed production; edit #1 auto-approved; edit #2 được PHONG duyệt
  qua Admin thành POI active, reviewer đúng email; 5 workflow remote xanh · (commit này)
- 2026-09-01 · M4 T10 · `suggestEdit` + types Edit trong core (9 phương thức, 6,54 kB gzip) +
  trang docs "Đóng góp & sửa POI"; core 327 test, root 490/490 · (commit này)
- 2026-09-01 · M4 T9 · `publish.mjs` tôn trọng `locked_fields` (11 cột + nhánh status) và
  `anchors.mjs` giữ mốc `source='user'`; `edit-lock.dbtest.mjs` 3/3, test:db 38 passed · (commit này)
- 2026-09-01 · M4 T7+T8 · `apps/admin` SPA React + `[assets]` trong wrangler.toml + E2E Playwright
  với Access giả lập (3/3); sửa lỗi cwd của access-fake và gracefulShutdown webServer · (commit này)
- 2026-09-01 · M4 T5+T6 · `access.ts` (verify Access JWT RS256, JWKS cache KV) + `routes/admin.ts`
  (list/approve/reject) + `access-fake.mjs` tiến trình riêng + `admin.itest.mjs`; api 87/87,
  api-db 22/22 · (commit này)
- 2026-09-01 · M4 T4 · POI pending cho tenant tạo trong `routes/places.ts` + `edits.itest.mjs`
  (6 test DB thật) + seed itest M4; api-db 18/18, api 79/79, root 486/486 · (commit này)
- 2026-09-01 · M4 T3 · `POST /v1/edits` + `requireAuth(scope)` + seed `edits:write`; sửa lỗi
  double-encode jsonb (phải dùng `sql.json`) phát hiện bằng smoke test wrangler dev; api 79/79,
  root 486/486, lint 211 file sạch · (commit này)
- 2026-09-01 · M4 T2 · `edits/{hash,ulid,rules,validate}.ts` + `vnDayStartUtc`; 14 test mới,
  api 73/73, root 486/486, typecheck 12/12, lint 209 file sạch · (commit này)
- 2026-09-01 · M4 T1 · migration `0006_edits.sql` (cột `api_key`/`new_poi_id`, 3 index, 3 hàm
  SECURITY DEFINER owner `pipeline`); `db/apply-edit.dbtest.mjs` 6/6; `db-permissions.mjs` giữ
  owner/grant hàm sau restore; sửa `schema.dbtest.mjs` down 4→5. Local: 486 root + 59 api +
  12 dbtest `db/`, typecheck 12/12, lint sạch · (commit này)
- 2026-09-01 · M4 plan · viết + tự review plan cấp bước `2026-09-01-m4-dong-gop.md`
  (11 task: migration 0006 SECURITY DEFINER, POST /v1/edits, admin SPA sau Access,
  Access giả lập cho test, pipeline tôn trọng locked_fields, suggestEdit + docs) · (commit này)

## 7. Nghiệm thu M2 (spec mục 13, hàng M2) — **ĐẠT 31/08/2026**

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | Worker → Hyperdrive → Access → Tunnel → Postgres TLS | **ĐẠT:** `/healthz/db` trả `ok:true`, user `api`, PostgreSQL 16.4 sau khi recreate server |
| 2 | Pipeline POI national + cron máy nội bộ | **ĐẠT theo chuỗi resumable:** mọi stage live hoàn tất; không ghi duration one-shot vì có lỗi mạng và resume. Cron kế tiếp `2026-09-06T19:00:00Z` (02:00 thứ Hai VN) |
| 3 | POI active ≥ 1,5 triệu | **ĐẠT:** 1.515.983 / tổng 1.522.416 |
| 4 | PMTiles/playground/click POI | **ĐẠT:** 244,623 MiB; z14 có 653 feature; click hiện tên/loại/nhóm |
| 5 | Báo cáo gộp/geocode | **ĐẠT:** multi-source 50.868 (3,3 %), combined other 297.823 (19,6 %), 923.567 anchor, Nguyễn Lâm 174 |
| 6 | Backup/restore | **ĐẠT:** restore mới nhất vào DB tạm rồi rename; 1.522.416 POI; owner/grant đúng |
| 7 | Test/CI | **ĐẠT:** local lint, typecheck, build, 480 unit/API, 32 DB, 2 E2E, image smoke. Remote CI xanh cả 3 job trên `30f0274` — `test` + `image` (run `33358342667`, 2 phút 11 giây), `dbtest` (run `33358342671`, 24 phút 37 giây) |
| 8 | Việc tay còn lại | Alias phường/xã 2025 + relation level 4 Khánh Hòa (M2 T8); nghiệm thu `pnpm run setup` trên Windows (từ M1); bật lại QA `requireIslands` cho Hoàng Sa khi chốt nguồn extract OSM (từ M1); 5 Actions secret cho workflow `Data update` **đã thêm 31/08** (repo 13 secret), `--dry-run` từ Actions xanh 2/2 và `HF_TOKEN` đã chứng minh dùng được; 4 biến DB/Tunnel mới chỉ có mặt, chỉ một lần `--poi` thật trên Actions mới kiểm được — không chặn nghiệm thu vì cron máy nội bộ vẫn chạy. Production còn warning glyph Unicode hiếm (MapLibre fallback vẫn render) |

## 8. Nghiệm thu M3 — Places API — **ĐẠT 01/09/2026**

### Quyết định thiết kế đã áp dụng

1. Cache autocomplete dùng lưới 0,05° thay H3 res 6 để tránh thêm `h3-js` nặng.
2. Hai fixture bắt buộc dùng seed tổng hợp trong workflow API DB riêng.
3. Auth chỉ áp cho 6 Places route; các route style/tile/attribution cũ không đổi.
4. Bốn API key seed tuân CHECK 24 ký tự sau prefix và tách demo/server/itest/free-test.
5. `suggestEdit` để M4; client M3 có 6 Places method cộng 2 method map có sẵn.
6. Quota chỉ đếm khi `QUOTA_ENABLED=1`, bỏ qua hoàn toàn tenant `internal`.
7. Web component nhận `near` qua attribute hoặc property `.map`, không dùng registry toàn cục.
8. Analytics Engine là binding optional trong code; deploy production hiện có binding thật.

### Bằng chứng nghiệm thu

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | Hai fixture bắt buộc | **ĐẠT:** API DB workflow `33478585218` xanh trên `6eb4ade`; fixture trường Linh Xuân đứng đầu và `88/9 Nguyễn Lâm` đạt `interpolated` trong bán kính yêu cầu |
| 2 | Production Places API | **ĐẠT:** `highlands&near=10.776,106.700` trả 10 POI thật; `88/9 Nguyễn Lâm` trả `interpolated` tại `10.7624337,106.6622200`; `/healthz/db` trả user `api`, PostgreSQL 16.4 |
| 3 | p95 autocomplete từ Việt Nam | **ĐẠT trên cache-hit production:** ba lần liên tiếp `p50/p95 = 93/177 ms` (SIN), `107/192 ms` (HKG), `95/168 ms` (SIN), n=100/lần. Tool ghi 5 sample chậm nhất cùng cache/colo và fail ngay nếu HTTP lỗi |
| 4 | Quota tenant free | **ĐẠT local runtime:** quota 25, 50 request đầu HTTP 200; request 51 HTTP 429 `quota_exceeded`, `Retry-After: 3600`. Production cố ý giữ `QUOTA_ENABLED=0` đến khi có tenant free thật |
| 5 | Analytics Engine | **ĐẠT:** unit contract ghi tenant/key/path/status/ms; Wrangler local nhận dataset; Deploy API production `33478585196` xanh với binding `mapslibvn_api` |
| 6 | React demo production | **ĐẠT:** browser thật gọi autocomplete HTTP 200/10 items, chọn Highlands tạo đúng 1 marker và status `Đã chọn Highlands`. Ảnh: [React demo production](evidence/m3-react-demo-production.png) |
| 7 | Local gates | **ĐẠT:** lint 200 file; typecheck 12/12 task; root 42 file/482 test (gồm perf tool 2 test); API 15 file/59 test |
| 8 | Remote gates trên Task 11 | **ĐẠT:** CI `33478585207`, Deploy API `33478585196`, API DB `33478585218` đều xanh; DB tests `33478585185` chạy riêng |

### Sự cố và việc theo dõi

- Production Postgres từng dừng sau Docker restart vì container cũ bind ba file config vào
  worktree tạm `/private/tmp/mapslibvn-m2-task10` đã bị xoá. Recreate **riêng** service
  `postgres` từ checkout hiện tại giữ nguyên named volume `mapslibvn-server_pgdata`; health,
  1,5 triệu POI và đường Worker → Hyperdrive → Tunnel đã hoạt động lại. Khi dựng server từ
  worktree tạm, phải recreate compose từ checkout bền trước khi xoá worktree.
- Các lần đo ngay sau khôi phục DB/cache lạnh có p95 2,5–3,2 giây; lần nghiệm thu cuối vẫn
  có một cold miss 3.317 ms nhưng p95 168 ms. M3 đạt mục tiêu p95 cho hành vi client cache-hit;
  theo dõi p99/cold miss và cân nhắc Meilisearch theo spec 8.3 nếu traffic thật vẫn chậm.
- Browser console còn 404 glyph Unicode hiếm và WebGL readback warning; MapLibre fallback
  vẫn render. Đây là hạn chế production đã biết từ M2, không phát sinh từ React demo.

## 9. Nghiệm thu M4 — Đóng góp — **ĐẠT 02/09/2026**

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | Auto-approve sửa giờ POI quality ≥ 60 | **ĐẠT production:** edit #1 trên POI `0DJ9X0A4SGHJ2A3P2690PEPX98` (quality 87) trả `auto_approved`; `GET /v1/places/{id}` đọc ngay `hours.osm = Mo-Su 07:00-22:00`, status `active` |
| 2 | Tenant ngoài internal tạo pending → Admin duyệt → active | **ĐẠT production:** tenant free tạo edit #2 / POI `01M1GMZ90J65C1V4SHB00D5BJ7`; scope tạm đã thu hồi về `places:read`; PHONG duyệt qua trang Admin, DB ghi reviewer `dotienphong1993@gmail.com`, API trả POI `active`, `created_by=user` |
| 3 | Pipeline giữ edit và POI người dùng | **ĐẠT bằng DB test + chờ cron thật:** `edit-lock.dbtest.mjs` phủ 11 `locked_fields`, nhánh status, POI/anchor user; full DB gate 41/41 trong pipeline image. Edit production sẽ được kiểm lại sau cron/data update kế tiếp; chưa tới lịch nên không chặn nghiệm thu theo plan |
| 4 | Admin chỉ qua Cloudflare Access | **ĐẠT production:** `api.ai-solutions.io.vn/admin/` + `/v1/admin` nằm trong một Access app, session 24 giờ, allow email PHONG; curl không cookie bị 302 ở edge, còn phiên đăng nhập thật duyệt được và Worker ghi reviewer từ JWT |

Local gate cuối: lint 225 file; typecheck sạch; root 44 file/490 test; API 19 file/87 test;
API DB 3 file/22 test; Admin E2E 3/3; DB 7 file/41 test. Remote trên `5cbf1a0`:
[CI run 33603090334](https://github.com/dotienphong/maps-library-vietnam/actions/runs/33603090334),
[Deploy API 33603090311](https://github.com/dotienphong/maps-library-vietnam/actions/runs/33603090311),
[Deploy Docs 33603090312](https://github.com/dotienphong/maps-library-vietnam/actions/runs/33603090312),
[API DB 33603090321](https://github.com/dotienphong/maps-library-vietnam/actions/runs/33603090321),
[DB tests 33603090297](https://github.com/dotienphong/maps-library-vietnam/actions/runs/33603090297) — tất cả xanh.

Sự cố nghiệm thu: production DB mới ở `0005` nên POST đầu tiên trả 503 request
`f446105f-f7d6-46bc-a254-043cccdb587f`; kiểm schema xác nhận thiếu cột/hàm M4. Chạy
`0006_edits.sql` bằng DB owner (không mở rộng quyền lâu dài của role `pipeline`) rồi kiểm lại
ba hàm đều chỉ cấp EXECUTE cho `api`; smoke sau đó đạt. Lần pipeline production kế tiếp vẫn
cần ghi thêm bằng chứng edit #1/#2 còn nguyên vào DEVLOG.

## 10. Nghiệm thu M5 — Phát hành nội bộ — **ĐẠT 03/09/2026**

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | Ứng dụng nhúng độc lập dùng được bằng khoá riêng | **ĐẠT production.** Trang thử `examples/embed-web/index.html` chạy ở origin riêng `http://localhost:5500` (không thuộc docs, không thuộc dự án nào khác). Tenant `…000002` "Ứng dụng nhúng thử nghiệm (nội bộ)" seed lên production; khoá `web` đuôi `…x6YN` cấp bằng `pnpm key:issue`, `allowed_origins = {http://localhost:5500}`. Trang trả 200, SDK UMD + CSS từ docs 200, `/v1/styles/light.json` 200, autocomplete trả POI thật, tiles `vn-20260827` trả 206 với Range. Origin lạ → 403 `origin_not_allowed` (request `50c35e72-83ae-43cb-bae1-35bfb8e59345`) |
| 2 | Báo cáo sử dụng tuần đầu nhận được | **ĐẠT.** Thư 02/09 PHONG xác nhận đã nhận. 03/09 gửi lại **qua đúng đường tự động** (token trong `infra/server/.env`, chạy trong container `pipeline`): `delivered`, message_id `<nl32fdOc4f4oXiH0TOqMF52BMErpY8iUQlvz@ai-solutions.io.vn>`. Báo cáo hiện đủ 4 tenant kèm tên, và khoá `mlv_live_6UU1…x6YN` của tenant mới xuất hiện với 5 request |
| 3 | Docs đủ trang, link không vỡ | **ĐẠT.** 7 trang sống trên `mapslibvn-docs.pages.dev`: `bat-dau`, `tu-host`, `giay-phep`, `do-chinh-xac`, `dong-gop`, `dieu-khoan`, `thong-bao-ben-thu-ba`. `docs.spec.ts` kiểm 8 trang tải được và mọi link nội bộ, E2E 11/11 |
| 4 | `pnpm export:odbl` | **ĐẠT.** 5 bảng CSV gzip + `manifest.json` (số dòng, SHA-256, release OSM) + `README.md` ghi ODbL 1.0. SHA-256 khớp `shasum` độc lập; dbtest xanh trên CI |
| 5 | Checklist pháp lý ký bởi PHONG | **ĐẠT.** PHONG duyệt 03/09/2026 (ghi trong file, không phải chữ ký tay); 10 hạng mục mục A đã đối chiếu lại với mã trước khi đánh dấu, 6 việc mục B để trống vì chưa làm. `docs/legal/checklist-phap-ly.md` đã viết: mục A 10 hạng mục đã làm kèm bằng chứng, mục B 6 việc tay cần luật sư trước khi thương mại hoá, mục C 5 việc kỹ thuật còn treo |

Lịch tự động đã bật: container `pipeline` chạy image có cron 2 job — `data:update` thứ Hai 02:00 và
`report:weekly` thứ Hai 08:00 giờ VN. Kiểm lại bằng một lệnh: `sh scripts/report-setup-check.sh`.


## 11. Nghiệm thu M6 — `@mapslibvn/react-native` — **ĐẠT 03/09/2026**

Chạy thật 03/09/2026: iOS 26.1 simulator (iPhone 17 Pro) và Android emulator Pixel 7, app Expo
`examples/embed-rn` cài SDK **từ tarball bằng `npm`** (không qua workspace), khoá `mobile`
`mlv_live_hj7P…7z1U` (tenant `…000002`, label "embed-rn thử độc lập", scopes `places:read`).
Thao tác tự động bằng Maestro 2.8.0 + `adb input tap`; ảnh trong `docs/evidence/m6/`.

| # | Tiêu chí (spec M6 mục 7) | Kết quả |
|---|---|---|
| 1 | iOS + Android chạy trọn, tiles thẳng từ R2, theme, lang=en giữ nhãn chủ quyền | **ĐẠT** — `ios-light-vi.png`, `ios-dark-en.png`, `android-light-vi.png`. Ở `ios-dark-en.png` (theme tối + `lang=en`) nhãn thường đã sang tiếng Anh ("NHA TRANG", "…CHÍ MINH CITY") nhưng **"Quần đảo Hoàng Sa (Việt Nam)" / "Quần đảo Trường Sa (Việt Nam)" vẫn tiếng Việt**. Observability 13:20–15:55 UTC: `/v1/autocomplete` 80, `/v1/styles/light.json` 6, `/v1/styles/dark.json` 2, `/v1/admin/edits` 1 — **0 request `/v1/tiles/`**, tiles đi thẳng R2/CDN qua `pmtiles://` |
| 2 | "highlands" gợi ý ≤ 1 s, chọn → flyTo + marker | **ĐẠT** — `ios-search-marker.png`, `android-search-marker.png`: 5 gợi ý hiện ngay khi gõ xong, chọn một dòng → camera bay tới zoom 16, ghim đỏ đúng vị trí |
| 3 | Bấm POI → tên/loại | **ĐẠT** — iOS `ios-poi-alert.png`: "Green Bio - Nông Nghiệp Chất Lượng Cao / convenience · shopping"; Android `android-poi-alert.png`: "Bãi giữ xe máy / parking_motorcycle · transport" |
| 4 | Attribution hiện, mở hộp thoại native, không tắt được | **ĐẠT** — `ios-attribution-dialog.png`: dòng ghi nguồn luôn hiện góc dưới trái (đủ OSM · OpenMapTiles · Overture · Foursquare), bấm vào mở hộp thoại native "MapLibre Native iOS". `MapsLibVNMapProps` không có prop nào tắt được attribution (chỉ `compactAttribution` đổi 1 hay 2 dòng) |
| 5 | Analytics có khoá mobile; log có X-Bundle-Id | **ĐẠT** — `pnpm report:weekly --dry-run --this-week`: khoá `mlv_live_hj7P…7z1U` **37 request**, đúng tenant `…000002`. Observability: **35 dòng** `bundle-id 00000000-0000-4000-8000-000000000002 vn.mapslibvn.demo` |
| 6 | CI xanh 4 gói | **ĐẠT** — gate cuối Task 15: lint 267 file, `notices-sync --check` khớp cho cả 4 gói SDK, typecheck 14 task, vitest root 57 file / 579 test, API 19 file / 87 test. CI remote `b3890d7` xanh 2 phút 54 giây (run 33771296442) và Deploy Docs xanh 1 phút 27 giây (run 33771296508) |
| 7 | Trang docs react-native | **ĐẠT** — `apps/docs/src/content/docs/react-native.md` (6 mục: yêu cầu, cài đặt, dùng, khác với web, khoá `mobile`, giới hạn), có trong sidebar "Hướng dẫn" + link từ `bat-dau.md` mục 2b và Card trang chủ; link check `docs.spec.ts` **9/9 trang**; sống tại https://mapslibvn-docs.pages.dev/react-native/ |

**Bốn lỗi thật chỉ lộ ra khi chạy máy thật (plan không lường), đã sửa trong Task 14:**

1. `usePlaces` trong `App.tsx` không có client — `<Search>` là anh em của `<MapsLibVNMap>` nên
   nằm **ngoài** `MapContext.Provider`, `useContext(MapContext)` trả `null` và ô tìm kiếm luôn
   in "Không có gợi ý". Sửa: truyền `client={map?.places}` (chính là lý do `UsePlacesOptions.client`
   tồn tại). Bài học: mọi hook `usePlaces` đặt ngoài `<MapsLibVNMap>` đều phải truyền `client`.
2. `pnpm example:rn --android` chết ở Gradle với `SDK location not found` — máy dev không hề có
   `ANDROID_HOME` (Android Studio không thêm biến này vào shell). Sửa: `defaultAndroidSdk()` +
   `androidEnv()` trong `scripts/lib/example-rn.mjs` tự dò `~/Library/Android/sdk`.
3. Ngay sau đó Gradle chết ở `:expo-modules-core:configureCMakeDebug[arm64-v8a]` — JDK mặc định
   của máy là **26**, quá mới cho AGP. Sửa: `androidStudioJdk()` tự dùng JBR 21 kèm Android Studio
   khi `JAVA_HOME` chưa đặt. Sau hai sửa này `BUILD SUCCESSFUL in 56s`.
4. `SafeAreaView` của `react-native` đã deprecated ở RN 0.86 (toast LogBox che màn hình mỗi lần
   mở app). Thay bằng `View` — layout vốn đã tự định vị tuyệt đối nên không đổi giao diện.

**Ghi chú kỹ thuật (không phải lỗi):**
- Hộp thoại attribution native chỉ liệt kê "© OpenMapTiles" và "© OpenStreetMap Contributors":
  MapLibre Native chỉ đưa vào hộp thoại các nguồn có liên kết, còn `attribution` của source `poi`
  ("Places: Overture Maps Foundation…, Foursquare OS Places…") là văn bản thuần nên bị bỏ qua.
  Nghĩa vụ ghi nguồn vẫn đủ nhờ dòng `Attribution` luôn hiện của SDK — đây chính là lý do dòng đó
  bắt buộc và không tắt được.
- Ở zoom 12 lớp `poi` chỉ vẽ biểu tượng, không vẽ chữ (`text-field` của style là
  `["step", ["zoom"], "", 13, ["get","name"]]`) — đúng thiết kế, không phải thiếu font.
- `onPoiClick` dùng `queryRenderedFeatures` tại **đúng một điểm**, không có bán kính bao dung:
  chạm lệch ~10 px là trượt. Với ngón tay thật nên cân nhắc truy vấn theo khung nhỏ quanh điểm —
  ghi lại làm việc cần xem xét, chưa sửa trong M6.
