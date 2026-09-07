# Cổng 6.5 — EXPLAIN ANALYZE BUFFERS cho autocomplete `area` ở quy mô toàn quốc

Ngày đo: 06/09/2026. Bước 6.5 của [plan alias hành chính cũ–mới](../../superpowers/plans/2026-09-05-alias-hanh-chinh-cu-moi.md).

## 1. Đo ở đâu

DB `mapslibvn_alias_scale` — database dùng-một-lần, tạo trên **chính instance Postgres của máy chủ
nội bộ** (`mapslibvn-server-postgres-1`, postgis/postgis:16-3.4), nên dùng chung phần cứng và
`postgresql.conf`: `shared_buffers=6GB`, `work_mem=32MB`, `max_parallel_workers_per_gather=2`.

Không đo trên DB `mapslibvn` đang phục vụ API: chỉ có một Hyperdrive `71d7a62b…` cho cả default lẫn
`[env.production]` trong `apps/api/wrangler.toml`, nên DB đó là dữ liệu production. Alias toàn quốc
chưa qua cổng độ phủ Task 8 thì không được đưa lên đó.

Vùng hiện hành được copy nguyên trạng từ DB thật (`pg_dump --data-only -t admin_area`), vùng cũ và
alias dựng bằng `pipelines/poi/src/geocode/admin-old.mjs` chạy trên snapshot đã pin
`vietnam-250101.osm.pbf` (md5 khớp `admin-old-source.json`).

## 2. Bộ dữ liệu đo — và tình trạng QA

| Bảng | Số dòng |
|---|---|
| `admin_area` (hiện hành) | 3.288 (L4 33, L8 3.255) |
| `admin_area_old` | 4.900 (L4 62, L6 686, L8 4.152) |
| `admin_alias` | **36.456** (overlay 36.423, seed 33) |

**Cổng QA của pipeline ĐỎ** — `invalid=0, unmatched=72, overlap=0, seed_miss=1`. Pipeline đã từ chối
publish đúng như Task 4.5 yêu cầu; số liệu dưới đây lấy từ một lần dựng riêng cho việc đo, không
phải một bản phát hành. Nguyên nhân đỏ:

- **70/72 vùng unmatched thuộc Ninh Thuận** (1 L4 + 7 L6 + 62 L8). Gốc rễ: `admin_area` hiện hành
  **thiếu hẳn Khánh Hòa** — chỉ có 33/34 tỉnh, không có cả `Khánh Hòa`, `Ninh Thuận` lẫn `Phú Yên`.
  Vùng cũ Ninh Thuận vì thế không chồng lấn vùng hiện hành nào.
- 10 vùng unmatched còn lại là L8 rải rác ở Lào Cai, Vĩnh Long, Bình Phước, An Giang, Quảng Ninh
  (2 mỗi tỉnh) — gồm ca đảo như `Xã Thanh Lân` (Cô Tô).
- `seed_miss=1`: dòng seed `ninh thuan` → `Khánh Hòa` không tìm được đích, cùng một nguyên nhân.

Ngoài ra: 2.029 khóa bị loại vì mơ hồ toàn quốc, 122 vùng có `rawCoverage < 0.95`, 889 ca tách.

**Ba giới hạn của bộ số liệu này** (đọc kỹ trước khi trích dẫn):

1. L8 cũ chỉ có **4.152** relation, trong khi spec Task 8.3 kỳ vọng 10.000–10.700 đơn vị. Snapshot
   OSM 01/2025 chưa vẽ đủ ranh giới phường/xã. Bảng alias thật khi đủ độ phủ sẽ **lớn hơn đáng kể**,
   nên mọi con số thời gian dưới đây là **cận dưới**.
2. Không có alias `source=osm_tag`: bảng raw `osm_admin_raw` không tồn tại (xem mục 5, lỗi 1). Việc
   này không ảnh hưởng phép đo vì câu truy vấn lọc `source IN ('overlay','seed')`, nhưng làm bảng
   nhỏ hơn thực tế.
3. Đo không có `near` (không truyền toạ độ), đúng nhánh mặc định của `/v1/autocomplete` khi client
   không gửi vị trí.

## 3. Cách đo

`docs/evidence/admin-alias/6-5-explain-gen.mjs` sinh SQL bám đúng `apps/api/src/area-candidates.ts`.
Tham số `queryNorm`/`queryCore`/`prefixPattern`/`aliasLevel` tính bằng chính `normalizeVi`,
`nameCore`, `parseAddress` của `@mapslibvn/core`, giống hệt `routes/autocomplete.ts`.

Dùng `PREPARE` + `EXECUTE` để giữ bind parameter như `postgres.js`, **không inline literal** (inline
làm planner ước lượng khác đường chạy thật). Mỗi phép chạy hai lần, lấy lần thứ hai để loại chi phí
đọc đĩa lần đầu — toàn bộ số liệu dưới đây có `read=0`, tức cache đã ấm hoàn toàn.

**Không dùng `SET enable_seqscan=off`** hay bất kỳ tinh chỉnh planner nào.

Bốn nhánh đo riêng: `full` (cả câu), `current` (CTE `current_hits`), `alias` (CTE `alias_edges`),
`grouping` (`alias_edges` + `alias_grouped`).

Kết quả thô đầy đủ: [`6-5-explain-raw.txt`](6-5-explain-raw.txt).

## 4. Kết quả

Thời gian là `Execution Time` lần chạy ấm; `rows` là số dòng nút trên cùng trả ra; `hit` là
`Buffers: shared hit` lớn nhất trong cây.

| Query | Dạng | Nhánh | rows | buffers hit | Planning | **Execution** |
|---|---|---|---:|---:|---:|---:|
| `Quận 10` | có cấp (L6) | full | 20 | 13.389 | 1,653 ms | **81,915 ms** |
| | | current | 0 | 5 | 0,262 ms | 0,011 ms |
| | | alias | 7.700 | 1.563 | 0,588 ms | 61,335 ms |
| | | grouping | 359 | 7.491 | 0,679 ms | 74,987 ms |
| `qu` | prefix 2 ký tự | full | 20 | 16.545 | 1,576 ms | **116,935 ms** |
| | | current | 168 | 147 | 0,364 ms | 0,828 ms |
| | | alias | 11.664 | 1.572 | 0,708 ms | 79,214 ms |
| | | grouping | 1.802 | 9.609 | 0,714 ms | 107,041 ms |
| `Phường Nguyễn An Ninh, Thành phố Vũng Tàu, Bà Rịa Vũng Tàu` | alias dài (L8) | full | 20 | 1.266 | 3,006 ms | **13,773 ms** |
| | | current | 0 | 87 | 1,182 ms | 0,492 ms |
| | | alias | 77 | 435 | 1,686 ms | 12,124 ms |
| | | grouping | 41 | 534 | 2,164 ms | 12,832 ms |
| `Tân Thành` | trùng tên (15 phường hiện hành cùng tên) | full | 20 | 15.734 | 1,607 ms | **100,931 ms** |
| | | current | 224 | 202 | 0,421 ms | 1,444 ms |
| | | alias | 6.383 | 1.566 | 0,680 ms | 70,286 ms |
| | | grouping | 1.575 | 8.904 | 0,825 ms | 87,106 ms |

### Index thực sự được dùng

Planner chọn index ở mọi nhánh lọc tên — không có seq scan nào trên `admin_alias`:

- Nhánh alias: `Bitmap Heap Scan on admin_alias` qua `BitmapOr` của
  **`admin_alias_trgm_idx`** (`alias_norm %> $2`) và **`admin_alias_prefix_idx`**
  (`alias_norm ~~ $4`). Với query 2 ký tự, cả hai nhánh BitmapOr đều rơi vào `admin_alias_trgm_idx`.
- Nhánh current: `Bitmap Heap Scan on admin_area` qua **`admin_area_name_trgm_idx`** +
  **`admin_area_name_prefix_idx`**; khi có `aliasLevel` thì chuyển sang
  **`admin_area_level_idx`** (`Quận 10` → `Index Scan`, 0,011 ms).
- Join `admin_area` để lấy tên đích: `Seq Scan on admin_area` + Hash Join. Đây là lựa chọn **đúng**
  của planner — bảng chỉ 3.288 dòng, quét tuần tự rẻ hơn index.
- `admin_area_old` luôn vào bằng `admin_area_old_pkey`.

## 5. Phát hiện

### Rủi ro 1 — nhánh alias không co giãn theo query ngắn (quan trọng nhất)

Index chạy rất nhanh (`Bitmap Index Scan` 0,5–0,6 ms) nhưng **trả về quá nhiều dòng**:

- `qu` (2 ký tự) khớp **11.664/36.456 dòng — 32% cả bảng**. Riêng `Bitmap Heap Scan` recheck hết
  chỗ đó mất 39,9 ms, hash join lên 78,8 ms.
- `Quận 10` khớp 7.700 dòng **dù đã lọc `level=6`**: `word_similarity('quan 10', alias_norm)` khớp
  **mọi** alias chứa từ `quan`, mà L6 cũ có 686 quận/huyện, mỗi vùng lại sinh vài khóa.

Gốc rễ: toán tử `<%` (`word_similarity`) rất kém chọn lọc với các từ hành chính phổ biến trong tiếng
Việt — `quan`, `phuong`, `xa`, `huyen`, `thanh pho`. Nhánh POI đã có `useSimilarityBranch()` chặn
**query dài**, nhưng nhánh alias **không có chặn cho query ngắn**.

Hệ quả với cổng Task 8.6 (`p95 autocomplete ≤ baseline + 50 ms`): riêng nhánh area đã tốn 82–117 ms
cho query ngắn thông dụng, trên bộ dữ liệu mới chỉ có 40% số phường cũ. Khi đủ độ phủ, bảng alias
nhiều khả năng gấp ~2 lần và thời gian tăng theo. **Nên coi cổng 8.6 là có nguy cơ trượt** và xử lý
selectivity trước khi đo benchmark phát hành.

### Lỗi 2 — `admin-old.mjs` chạy độc lập hỏng khi thiếu `osm_admin_raw`

`admin-overlay.mjs:163` join thẳng `osm_admin_raw` để lấy alias `source=osm_tag`. Bảng raw này chỉ do
`replaceRawTables()` của nhánh ingest OSM hiện hành tạo ra, và **DB production hiện không có nó**
(cả `osm_admin_raw` lẫn `osm_road_raw` đều không tồn tại). Chạy `admin-old.mjs` standalone trên
production sẽ chết ngay với `42P01 relation "osm_admin_raw" does not exist`.

Mâu thuẫn với Task 4.6 ("entry `admin-old.mjs` dùng current đã published") và ảnh hưởng trực tiếp
thứ tự phát hành ở Task 9.2. Cần chốt hướng xử lý: hoặc guard bằng `to_regclass` rồi ghi lý do bỏ
osm_tag vào report (không được bỏ lặng lẽ, theo Task 3.3), hoặc báo lỗi rõ ràng yêu cầu chạy đủ
pipeline current trước. Đây là quyết định thuộc Task 4, chưa sửa trong bước này.

### Chặn dữ liệu 3 — thiếu Khánh Hòa trong vùng hiện hành

`admin_area` production có 33/34 tỉnh. Chừng nào chưa nạp được Khánh Hòa thì cổng QA alias còn đỏ,
tức **không thể phát hành alias toàn quốc**, bất kể code đã xong. Đây đúng là mục còn treo trong
`admin-old-source.json` (`issues[1]`, `resolution: null`).

## 6. Sau khi sửa selectivity — đo lại cùng bộ dữ liệu

Bản sửa: `areaCandidates` chia bậc. **Bậc 1 chỉ dùng tiền tố**; chỉ khi bậc 1 **không có kết quả
nào** mới leo lên bậc 2 có `<%`. Lý do không leo lên khi bậc 1 *ít* kết quả: `quan 10` có đúng 18
dòng tiền tố, leo lên sẽ trả 11.072 dòng sim thấp — vừa chậm vừa vô ích. `<%` vẫn giữ vì là thứ duy
nhất cứu lỗi gõ (`quna 10`: 0 hit tiền tố, 12 hit fuzzy).

Đo lại bằng `6-5-explain-gen.mjs --tier1` trên đúng DB và dữ liệu ở mục 2:

| Query | full bậc 2 (cũ) | full bậc 1 (mới) | Cải thiện |
|---|---:|---:|---:|
| `Quận 10` | 81,915 ms | **0,269 ms** | 304× |
| `Tân Thành` | 100,931 ms | **1,032 ms** | 98× |
| `Phường Nguyễn An Ninh, …` | 13,773 ms | **0,120 ms** | 115× |
| `qu` | 116,935 ms | **41,926 ms** | 2,8× |

Số dòng ứng viên nhánh alias giảm tương ứng: `Quận 10` 7.700 → 18, `Tân Thành` 6.383 → 10,
alias dài 77 → 1, `qu` 11.664 → 7.552.

**Trường hợp xấu nhất còn lại là `qu` (41,9 ms).** Không phải do fuzzy mà vì **7.552 alias thật sự
bắt đầu bằng "qu"** — mọi khóa `quan …` toàn quốc. Grouping chiếm 37,3 ms trong số đó. Đề xuất chưa
làm: bỏ hẳn nhánh alias khi `queryNorm` ngắn hơn 3 ký tự (nhánh current vẫn trả lời, 0,27 ms), vì
tiền tố 2 ký tự không định danh được vùng lịch sử và 7.552 ứng viên rồi cũng bị cắt còn 20. Đây là
đánh đổi tính năng nên chờ PHONG quyết. Lưu ý con số này sẽ tăng khi độ phủ L8 đủ.

## 7. Hai lỗi ở mục 5 — đã sửa

- **Lỗi 2 (`osm_admin_raw`)**: `admin-overlay.mjs` kiểm `to_regclass('osm_admin_raw')` trước khi
  join. Thiếu bảng thì bỏ nguồn `osm_tag`, in cảnh báo và ghi `report.osmTagSource = {available:
  false, reason}` — không nổ 42P01 và không bỏ lặng lẽ. DB test khoá cả hai nhánh
  (`pipelines/poi/tests/admin-old.dbtest.mjs`).
- **Rủi ro 1 (selectivity)**: đã sửa, xem mục 6.

**Chặn dữ liệu 3 (Khánh Hòa) vẫn mở — đã xác định rõ nguyên nhân:** OSM **không có** relation
`admin_level=4` cho Khánh Hòa, cả ở snapshot 01/2025 (62/63 tỉnh cũ, không tỉnh nào tên chứa "Kh")
lẫn ở OSM hiện tại (Overpass truy vấn `[admin_level=4][name="Khánh Hòa"]` trả về rỗng). Vì
`admin.mjs` chỉ nhận L6/L8 có point-on-surface nằm trong một L4 thuộc danh sách 34 tỉnh, toàn bộ
phường của vùng này bị loại — đúng "64 relation ngoài retained province" mà M2 T8 đã ghi. Không có
geometry ODbL nào trong tay để dựng, kể cả cách hợp Khánh Hòa cũ + Ninh Thuận cũ (vì bản thân
Khánh Hòa cũ cũng vắng). Ba đường ra, đều cần PHONG quyết vì liên quan nguồn/giấy phép:
đóng góp hoặc chờ OSM upstream; mua/xin nguồn ranh giới có giấy phép tương thích ODbL; hoặc dựng
ranh giới tỉnh bằng **hợp các phường thuộc tỉnh** (đúng định nghĩa pháp lý, dữ liệu ODbL) — cách
này cần sửa `admin.mjs` để bootstrap L4 từ L6/L8 khi thiếu relation cha, và cần biết OSM hiện có đủ
phường Khánh Hòa hay không (chưa kiểm được: Overpass hết thời gian chờ ở truy vấn theo bbox).

## 8. Task 8.3/8.4 — đã chạy trên bộ toàn quốc, cổng đỏ vì ba nguyên nhân độc lập

Chạy `scripts/verify-admin-alias.mjs --mode coverage` trên đúng DB ở mục 1. Tóm tắt:
[`8-3-8-4-coverage-summary.json`](8-3-8-4-coverage-summary.json) (artifact đầy đủ 1,3 MB với 4.900
dòng coverage không commit, theo Task 8).

| Nhóm failure | Số |
|---|---:|
| `missing_mainland_l8` | 72 |
| `raw_coverage_gap` (raw coverage < 0,95) | 122 |
| `fixture_district_mismatch` | **11** |
| `count_out_of_range` | 3 |
| `target_missing` / `split_target_missing` / `unexpected_target` | 11 / 1 / 3 |

Ca alias: **47/60 đạt**, ca tách **4/6**. Cảnh báo: 1.901 sliver bị bỏ, 2 cấp có số đơn vị distinct
khác số relation.

### Nguyên nhân 1 — độ phủ L8 của snapshot

L4 62 (spec 63), L6 686 (spec 690–710), L8 **4.152** (spec 10.000–10.700). 72 vùng cũ không có
alias, trong đó **62 là Ninh Thuận** (hệ quả của việc thiếu Khánh Hòa, mục 7) và 10 vùng rải rác ở
Lào Cai, Vĩnh Long, Bình Phước, An Giang, Quảng Ninh — gồm ca đảo như `Xã Thanh Lân`,
`Thị trấn Cô Tô`. **Không** tự xếp chúng là "ngoài đất liền": Task 8.3 cấm suy điều đó chỉ vì không
khớp, nên chúng nằm trong `missing_mainland_l8` cho tới khi có bằng chứng nguồn.

### Nguyên nhân 2 — ground truth trong fixture Task 0 sai

Đây là phát hiện mới của lần chạy này, và nó làm mọi con số nghiệm thu trước đó vô nghĩa. Fixture
`packages/core/tests/fixtures/admin-alias-2025.jsonl` gán sai huyện cho **11 ca**, theo kiểu điền
hàng loạt: mọi ca Đà Nẵng ghi "Quận Hải Châu", mọi ca Cần Thơ ghi "Ninh Kiều".

| Ca | Phường | Fixture ghi | Snapshot ODbL |
|---|---|---|---|
| `hn-10` | Quán Thánh | Hoàn Kiếm | **Ba Đình** |
| `dn-01` | Hòa Liên | Hải Châu | **Hòa Vang** |
| `dn-07` | Xuân Hà | Hải Châu | **Thanh Khê** |
| `dn-08` | Hòa An | Hải Châu | **Cẩm Lệ** |
| `dn-09` | Phước Mỹ | Hải Châu | **Sơn Trà** |
| `dn-10` | Thọ Quang | Hải Châu | **Sơn Trà** |
| `ct-01` | Bùi Hữu Nghĩa | Ninh Kiều | **Bình Thủy** |
| `ct-09` | Trà An | Ninh Kiều | **Bình Thủy** |

`admin-alias-fixtures.test.mjs` không bắt được vì nó chỉ assert `expectedKeys.length > 0`, **không**
đối chiếu với `adminAliasKeys()` của core hay với snapshot. Nay `evaluateCoverage` có failure
`fixture_district_mismatch` để lớp lỗi này không còn lọt.

Kèm theo, `expectedKeys` viết tay cũng đã lệch khỏi dạng canonical của core: fixture ghi
`phuong da kao quan 1 thanh pho ho chi minh` còn core sinh `phuong da kao quan 1 ho chi minh`
(tỉnh bỏ "thanh pho"). Vì vậy CLI **tra theo đơn vị cũ** (tên/huyện/tỉnh) chứ không theo chuỗi khóa;
so theo khóa thì 5/6 ca tách bị báo rỗng dù dữ liệu hoàn toàn đúng — `Phường Đa Kao` thật sự có đủ
hai đích `Phường Sài Gòn` và `Phường Tân Định`.

### Nguyên nhân 3 — 122 vùng có raw coverage dưới 0,95

Cần điều tra riêng theo geometry; chưa quy được về hai nguyên nhân trên.

**Kết luận:** 8.3 và 8.4 đã **chạy xong và có bằng chứng**, nhưng **không đạt**. Ba nguyên nhân trên
phải xử lý xong mới đo được 8.6, và nguyên nhân 2 cần biên soạn lại fixture từ nghị quyết gốc —
việc đọc văn bản pháp lý, không phải việc code.

## 9. Dựng lại cả hai phía toàn quốc (07/09/2026) — cổng gần xanh

Sau khi có `bootstrapMissingProvince()`, dựng lại **cả hai phía** trên bộ toàn quốc: tải extract
OSM hiện hành (`vietnam-latest.osm.pbf`, md5 `72d7b298f4dbae54283a2ee8506bd17f` đối chiếu độc lập
với Geofabrik), vá chủ quyền (193 object), trích `osm_admin_raw` 9.105 ranh giới
(L4=39, L6=3.322, L8=565 — khớp đúng ghi chú M2 T8), rồi chạy current + old + alias.

Bootstrap chạy ở **cả hai** phía: current dựng L4 Khánh Hòa từ **64** đơn vị con mồ côi, old dựng
từ **8**. Kết quả publish vào DB đo: `admin_area` 3.353 (L4 **34**, L8 3.319), `admin_area_old`
4.972, `admin_alias` **37.246**.

| Chỉ số | Trước bootstrap | Sau |
|---|---:|---:|
| Cổng QA pipeline | `unmatched=72, seed_miss=1` | **`unmatched=2, seed_miss=0`** |
| Tổng failure evaluator | 223 | **84** |
| `count_out_of_range` | 3 | **1** (chỉ còn L8) |
| `missing_mainland_l8` | 72 | **10** |
| `raw_coverage_gap` | 122 | **60** |
| `fixture_district_mismatch` | 10 | **0** |
| L4 / L6 cũ | 62 / 686 | **63 / 694** (đúng spec) |
| Ca alias | 47/60 | **48/60** |

### Bốn nhóm còn lại, đã phân giải hết nguyên nhân

1. **L8 cũ 4.215 so với spec 10.000–10.700** — snapshot OSM 01/2025 chưa vẽ đủ ranh giới phường/xã.
   Đây là độ phủ **upstream**, code không sửa được; cần snapshot mới hơn hoặc nguồn khác.
2. **10 `missing_mainland_l8`** — tách sạch làm hai: **8 ca do `normalizeVi` gộp dấu** nên hai
   phường khác tên lại trùng khóa và cùng bị loại vì mơ hồ (`Xã Đông Thành`/`Xã Đông Thạnh`,
   `Xã Lộc Thành`/`Xã Lộc Thạnh`, `Xã Phú Thành`/`Xã Phú Thạnh`, `Phường Sa Pa`/`Phường Sa Pả` —
   mỗi cặp còn **cùng huyện** nên khóa có huyện cũng không cứu được); và **2 ca đảo**
   (`Xã Thanh Lân`, `Thị trấn Cô Tô`) có polygon gần như toàn biển nên mọi chồng lấn rơi dưới
   ngưỡng sliver 0,05.
3. **60 `raw_coverage_gap`** — chính là nhóm ven biển ở mục 8: mẫu số gồm lãnh hải.
4. **Ca alias 48/60** — 12 ca còn lại cần đối chiếu nghị quyết từng ca như đã làm cho Đà Nẵng và
   Cần Thơ ở mục 8.

**Chưa publish lên production.** Trạng thái này ở DB đo dùng-một-lần; phát hành phải theo Task 9.2
(backup → staging QA → publish data → API → SDK) và cần cổng xanh hoặc ngoại lệ có quyết định QA.

## 10. Publish lên production và nghiệm thu 8.5/8.6 (07/09/2026)

Đã publish dữ liệu alias lên production theo thứ tự 9.2: backup
`mapslibvn-20260907-1020.dump.zst` lên R2 → `osm-roads.mjs` (9.105 ranh giới, 216.301 đường) →
`admin.mjs --accept-qa "<lý do>"`. Kết quả: `admin_area` **3.353 (L4=34**, trước 33), `admin_area_old`
4.972, `admin_alias` **37.246** (trước 33), publish trong **2.496 ms**.

Cổng QA còn `unmatched=2` (hai vùng đảo Thanh Lân, Cô Tô); publish bằng cờ tường minh và lý do được
ghi vào `report.acceptedQa`, không lách gate.

### Smoke production

`Quận 10` trả vùng kèm danh sách phường đích (trước rỗng); `Bình Dương` trả `Thành phố Hồ Chí Minh`
với tên cũ ở dòng phụ. `Thủ Dầu Một` lúc đầu vẫn rỗng — nó là thành phố cấp huyện cũ nhưng nằm
trong alias tỉnh của `provinces.json` nên `parseAddress` canonicalize thành tỉnh và `aliasLevel`
khoá cấp 4, trong khi alias `thu dau mot` chỉ có ở level 6. Đã sửa: tỉnh suy ra từ alias thì không
khoá cấp.

### 8.6 — nghiệm thu 10 cặp địa chỉ trên production

| Chỉ tiêu 8.6 | Yêu cầu | Đo được |
|---|---|---|
| Chính xác cao (`rooftop`/`alley`/`interpolated`) | ≥ 8/10 | **9/10** ✓ |
| Không cặp nào kém hơn địa chỉ mới | — | ✓ (`hcm-address-10` cũ `rooftop` còn **tốt hơn** mới `ward`) |
| Nằm trong `expectedBbox` | — | ✓ (không có failure `outside_expected_bbox`) |
| hit@3 fuzzy | ≥ baseline 37/40 | **37/40** ✓ |

Tám cặp cho `rooftop` ở cả hai cách viết. Ca duy nhất trượt là `hcm-address-04`
(`1 Nguyễn Tất Thành, Phường 12, Quận 4`): old ward "Phường 12" của **Quận 4 không có trong
snapshot** (snapshot có Phường 12 ở quận 10, 3, 5, 6, Bình Thạnh, Gò Vấp, Tân Bình) — lại là lỗ
hổng độ phủ upstream, không phải hồi quy precision.

### 8.5 — chi phí của `area`, và tại sao chưa kết luận được cổng p95

| Cohort | p50 | p95 | p99 | hit@3 | colo |
|---|---:|---:|---:|---|---|
| default (có `area`) | 81 ms | 1.873 ms | 3.160 ms | 37/40 | HKG |
| `types=poi,street,address` | 88 ms | 1.627 ms | 2.929 ms | 37/40 | SIN |

Chênh p95 là +246 ms, **vượt ngưỡng +50 ms** của 8.6. Nhưng **chưa kết luận cổng này** vì phép đo
không đủ sạch: hai cohort rơi vào **hai colo khác nhau** (HKG so với SIN), p95 bị chi phối hoàn toàn
bởi các ca cache lạnh qua internet công cộng, và mỗi cohort chỉ 80 request thay vì ≥100 như 8.5 yêu
cầu. Tín hiệu đáng tin là p50: **81 so với 88 ms**, tức `area` không thêm chi phí đo được ở nhánh
ấm. Muốn chốt cổng p95 phải đo từ điểm quan sát ổn định (cùng colo, cùng chế độ cache) với ≥100
request mỗi cohort — không tự chọn lại bộ mẫu theo 8.6.

## 11. Phải đo lại khi nào

Số liệu ở đây đủ để trả lời câu hỏi index/row count/time của bước 6.5, nhưng **không thay thế**
benchmark phát hành. Task 8.5/8.6 vẫn phải đo lại trên bộ dữ liệu đã qua cổng độ phủ, cùng DB
snapshot/location/concurrency, và so với baseline 40 fuzzy query hiện có.
