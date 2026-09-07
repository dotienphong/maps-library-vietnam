# Task 16 — nghiệm thu hạng mục 3 trên production (08/09/2026)

> **Cập nhật 08/09 sau khi PHONG duyệt "cách 2".** Đã đổi spec mục 5.4: ba bậc chạy **song song**
> thay vì "bậc sau chỉ khi bậc trước thiếu" (`89d7fca`). Kết quả đo lại ở mục **"Sau cách 2"** cuối
> file. Tóm tắt: bộ 20 biến thể **3/20 → 6/20**; tiêu chí 11.6 **1/5 → 2/5**; không hồi quy bộ mờ
> (38/40); **không tốn thêm thời gian đo được**. Hai ca spec còn trượt do nguyên nhân (b) và (c) ở
> dưới, chưa động tới.
>
> **Cập nhật lần hai (`a76761a`).** Đã sửa nốt việc chấm điểm dòng khớp alias: bộ 20 biến thể
> **6/20 → 9/20**, tiêu chí 11.6 **2/5 → 4/5**. Xem mục **"Sau sửa chấm điểm alias"** cuối file.

SHA phát hành: `eb5cc76` (+ `52d8507` sửa hai lỗi lộ ra khi chạy thật).
Production: `https://api.ai-solutions.io.vn`, DB máy chủ nội bộ qua Hyperdrive.

## Kết luận ngắn

| Tiêu chí spec | Kết quả |
|---|---|
| 11.3 — bộ 40 truy vấn mờ ≥ 36/40, không hồi quy | **ĐẠT** — 38/40 (baseline 37/40) |
| 11.4 — p95 nhánh 3 bậc ≤ 600 ms | **ĐẠT** phía warm; xem mục đo |
| 11.7 — CI 4 gói, api test không cần Postgres, ODbL có cột mới | **ĐẠT** |
| 8 — cột dẫn xuất NULL không gây 5xx | **ĐẠT** — đo trên production khi cột còn NULL |
| **11.6 — `qui nhon`, `kontum`, `dak lak`, `tan son nhut`, `cong ly` top-3** | **KHÔNG ĐẠT — 1/5.** Nguyên nhân đã đo, ghi ở mục "Vì sao 11.6 trượt" |

Bộ 20 truy vấn cách viết địa phương: **hit@3 = 3/20**, y hệt baseline. Kế hoạch đặt mốc ≥ 18/20.

## Việc đã làm trên production

| Bước | Kết quả |
|---|---|
| Migration 0009 | Đã áp 07/09 (88 giây). `/healthz/db` → `"schema_migration":"0009_search_keys.sql"` |
| Deploy API | [run 34163248668](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34163248668) success, qua cổng `apitest` |
| Backfill | poi **1.522.417** (252 s), street 61.154, admin_area 3.353, admin_area_old 4.972, admin_alias 37.251. Chạy lần hai: **0 dòng** cả 5 bảng |
| Pipeline đường | `osm_road_raw` 216.301 tuyến có tên; `street` 61.234, `alley` 58.597 |
| Kích cỡ DB | 5.471 MB → **5.927 MB** (+456 MB) |
| Image pipeline | Build lại từ HEAD, `image:smoke` đủ công cụ, không có `.env` trong image, `force-recreate`; cron `data:update` kế tiếp 2026-09-13T19:00Z |

## Workflow trên `eb5cc76`

| Workflow | Kết quả | Run |
|---|---|---|
| CI | success | [34163248412](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34163248412) |
| API tests (Places, real DB) | success | [34163248467](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34163248467) |
| Deploy API | success | [34163248668](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34163248668) |
| Deploy Docs | success | [34163248478](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34163248478) |
| DB tests | **failure** → sửa ở `52d8507` | [34163248549](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34163248549) |

`DB tests` sau khi sửa: **success** trên `52d8507`
([run 34167785870](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34167785870)).
`CI` cũng xanh trên `52d8507` và `2758486`.

`DB tests` đỏ 1/10 file: `edit-lock.dbtest.mjs` tự dựng `poi_work_record` bằng DDL riêng nên thiếu
`name_key`. Tôi bỏ sót vì bộ dbtest chạy local không gồm file đó. Đã sửa và đổi `INSERT` sang liệt
kê cột tường minh để lỗi cùng loại không tái diễn.

## NULL-safe (spec mục 8) — đo trên production khi cột còn NULL

Ngay sau `Deploy API` và **trước** backfill, cả 5 endpoint trả 200:
`/v1/autocomplete`, `/v1/search`, `/v1/nearby`, `/v1/geocode`, `/v1/reverse`.
`autocomplete?q=qui nhon` trả 10 item (nhánh bậc 1 vẫn chạy); `q=cong ly&types=street` **chưa** có
Nam Kỳ Khởi Nghĩa — đúng, vì `street.name_alt` khi đó còn rỗng.

## Cơ chế chạy đúng trên dữ liệu thật

- **`matched_alt`**: `q=co thanh ve&types=street` → **Đường Bế Văn Đàn**, hạng 1,
  `matched_alt="Đường Cơ Thánh Vệ"`. Đây là tên thay thế OSM thật, không phải fixture.
- 1.820/61.234 tuyến có `name_alt` (từ 8.071 way thô có tag).
- **EXPLAIN trên production** (poi 1,52 triệu dòng):

| Bậc | Kế hoạch | Thời gian |
|---|---|---:|
| 1 — `q <% name_alt_norm` | Bitmap Index Scan `poi_name_alt_norm_trgm_idx` | 4,6 ms |
| 2 — `name_tsv @@ to_tsquery` | Bitmap Index Scan `poi_name_tsv_idx` | 2,6 ms |
| 3 — `q <% name_key` + ORDER BY sim | Bitmap Index Scan `poi_name_key_trgm_idx` | 205,9 ms |

Không bậc nào Seq Scan trên `poi`. (Một lần thăm dò đầu ra Seq Scan là do truy vấn thử của tôi
thiếu `ORDER BY` nên planner chọn tắt theo `LIMIT`; hình dạng thật của API thì dùng chỉ số.)

## Đo độ trễ

Client-side (từ máy dev qua Internet công cộng tới colo SIN):

| Bộ | p50 | p95 | p99 | hit@3 |
|---|---:|---:|---:|---:|
| 40 truy vấn mờ — baseline 07/09 | 230 | 1.621 | 2.044 | 37/40 |
| 40 truy vấn mờ — sau phát hành | 155 | 1.742 | 3.120 | **38/40** |
| 20 biến thể — baseline 07/09 | 172 | 1.812 | 2.675 | 3/20 |
| 20 biến thể — sau phát hành (vòng ấm) | 75 | 87 | 1.096 | 3/20 |

Nhánh chạy **hết 3 bậc** (10 truy vấn cố tình rỗng ở bậc 1), 3 vòng:

| Vòng | p50 | p95 | max |
|---|---:|---:|---:|
| 1 (cache lạnh, chạy thật cả 3 bậc) | 1.147 | 1.568 | 3.141 |
| 2 (ấm) | 355 | 369 | 402 |
| 3 (ấm) | 348 | 393 | 422 |

Vòng 1 gồm cả chặng Internet và lần nối Hyperdrive lạnh; so cùng loại số thì **p95 lạnh của nhánh
3 bậc (1.568 ms) vẫn thấp hơn p95 lạnh của nhánh bậc-1 ở baseline (1.812 ms)** — bậc 2/3 không làm
chậm thêm. Số phía Worker (`$workers.wallTimeMs`) trong cửa sổ đo có n quá nhỏ sau lọc cache
(n=9) nên không dùng để kết luận; đây là hạn chế của lấy mẫu Observability ở lưu lượng thấp, đã
gặp ở 8.5.

## Vì sao 11.6 trượt — ba nguyên nhân, đã đo riêng từng cái

**(a) Bậc 2 và bậc 3 gần như không bao giờ chạy trên production.** Spec mục 5.4 viết "chỉ khi bậc 1
trả < `limit`", và plan cài đúng như vậy. Nhưng với 1,52 triệu POI, bậc 1 trả **đúng 10 = limit**
cho mọi truy vấn thường:

```
q=kontum    → 10 item, đều chứa "Kontum" viết dính
q=qui nhon  → 10 item, đều viết "Qui Nhon"
q=bin than  → 10 item
```

`planStages` do đó trả mảng rỗng. `viKey('kontum') = viKey('kon tum') = 'contum'`, tức bậc 3 **thừa
sức** khớp, nhưng nó không được gọi. Trên DB dev (79.775 POI) bậc 1 thưa hơn nên bậc 3 có chạy và
`kontum` → Kon Tum, `bin than` → Bình Thạnh đều đúng. Nói cách khác: cơ chế đúng, điều kiện kích
hoạt sai cỡ.

**(b) Ngay trong bậc 1, `LIMIT 20` của SQL bị bão hoà bởi các dòng hoà `sim`.** Với `q=qui nhon`,
nhánh `qAlias` có thêm `'quy nhon' <% name_norm`, nhưng hàng nghìn dòng viết đúng "Qui Nhon" đạt
`sim` 1,0/0,875 và chiếm hết 20 suất trước khi tới các dòng "Quy Nhơn". Không dòng "Quy Nhơn" nào
lọt vào 10 kết quả cuối. Với `q=tan son nhut` thì nhánh alias **có** tác dụng — "Sân bay quốc tế
Tân Sơn Nhất" lên hạng **4** — nhưng vẫn bị ba dòng viết "Tân Sơn Nhứt" (tên thật của chúng) đẩy ra
khỏi top 3.

**(c) `cong ly` là vấn đề DỮ LIỆU, không phải mã.** OSM Việt Nam **không** gắn `old_name=Công Lý`
cho Nam Kỳ Khởi Nghĩa:

```
osm_way_id 175587247  Nam Kỳ Khởi Nghĩa  name_alt=null
osm_way_id  35113311  Nam Kỳ Khởi Nghĩa  name_alt=null
osm_way_id  51559914  Nam Kỳ Khởi Nghĩa  name_alt=['Trương Vĩnh Ký']
```

Cơ chế đã chứng minh chạy được (ca `co thanh ve` ở trên, và bộ `test:api-db` với dữ liệu seed), chỉ
là nguồn không có dữ kiện. Ba ca còn lại cùng nhóm (`duong cong ly`, `hien vuong`,
`truong minh giang`) cùng lý do.

## Việc còn mở — thuộc quyết định của PHONG

1. **Điều kiện kích hoạt bậc 2/3.** Hiện là "bậc 1 trả < limit". Đề xuất đổi sang một điều kiện có
   nghĩa ở quy mô production, ví dụ "bậc 1 không có dòng nào đạt `sim` ≥ ngưỡng" hoặc "luôn chạy bậc
   2/3 song song rồi gộp, dựa vào `STAGE_PENALTY` để xếp hạng". Cách thứ hai đắt hơn (đo được:
   bậc 2 2,6 ms, bậc 3 206 ms trên chỉ số) nhưng là cách duy nhất làm 11.6 khả thi. **Đây là sửa
   spec, không phải sửa lỗi**, nên tôi không tự làm.
2. **Bão hoà `LIMIT 20` trong bậc 1.** Cần tách suất cho nhánh alias (ví dụ UNION hai truy vấn có
   LIMIT riêng) thay vì để chúng cạnh tranh trong cùng một `ORDER BY`.
3. **Tên đường cũ**: cần nguồn ngoài OSM (hoặc đóng góp qua `poi_edit`) cho Công Lý, Hiền Vương,
   Trương Minh Giảng. Cùng loại việc với "nguồn ranh giới xã cũ" của hạng mục 1.
4. **`stage_hit`**: đã ghi vào Analytics Engine (chiều `double3`: -1 route khác, -2 trúng cache,
   0 chạy mà rỗng, 1–3 bậc trúng). Lấy phân bố sau 24 giờ để quyết bật cờ `AUTOCOMPLETE_TELEX`.

## Rollback

- Backup R2 trước migration: dump 07/09 (`mapslibvn-20260907-*.dump.zst`).
- `0009_search_keys.down.sql` **chỉ** dùng SAU khi đã rollback Worker về bản trước — down xoá cột mà
  API hiện hành đang tham chiếu, chạy trước sẽ làm 503.


---

# Sau "cách 2" — ba bậc chạy song song (`89d7fca`, 08/09/2026)

PHONG duyệt đổi spec mục 5.4. `planStages` nay quyết định theo **dữ kiện có sẵn** (truy vấn có ≥ 2
token thì có bậc 2; có khoá ngữ âm thì có bậc 3), không theo số kết quả của bậc 1 nữa.
`collectCandidates` phát mọi truy vấn của mọi bậc **trước khi chờ** bất cứ cái nào.

## Kết quả đo lại trên production

| Phép đo | Trước cách 2 | Sau cách 2 |
|---|---:|---:|
| Bộ 20 biến thể — hit@3 | 3/20 | **6/20** |
| Tiêu chí 11.6 (5 ca spec) | 1/5 (`dak lak`) | **2/5** (`dak lak`, `kontum`) |
| Bộ 40 truy vấn mờ — hit@3 | 38/40 | **38/40** (không hồi quy) |
| Bộ 40 mờ — p95 lạnh | 1.742 ms | **1.715 ms** |
| Bộ 20 biến thể — p95 ấm | 87 ms | 118 ms |
| Bộ 20 biến thể — p99 ấm | 1.096 ms | **265 ms** |
| `pnpm test:api-db` | 42/42 | 42/42 |

**Chi phí bằng 0 trong sai số.** So cùng loại số (p95 lạnh bộ mờ) giữa hai bản của cùng ngày:
1.742 → 1.715 ms. Đúng như dự tính khi thiết kế: các bậc chạy song song nên phần thêm vào thời gian
tường là max() chứ không phải tổng, và bậc 1 vốn đã là bậc chậm nhất khi cache lạnh.

## Ba ca đổi từ trượt sang trúng — đều là bậc 3 làm việc

Với `near=10.776,106.700` (đúng như bộ đo dùng):

| Truy vấn | Kết quả | Bậc |
|---|---|---|
| `kontum` | **Kon Tum** hạng 3 (score 0,751) | 3 — `viKey('kontum') === viKey('kon tum') === 'contum'` |
| `bin than` | **Bình Thạnh** hạng 1 (score 0,840) | 3 — âm cuối `-nh`→`-n` |
| `hoian` | trúng | 3 — dính/tách từ |

## Hai ca spec còn trượt — nguyên nhân (b), không phải (a)

Nguyên nhân (a) đã hết: bậc 3 chạy và cho kết quả đúng. Còn lại là bão hoà trong bậc 1:

- **`tan son nhut`**: "Sân bay quốc tế Tân Sơn Nhất" ở hạng **4**, score 0,816 — thua hạng 3
  (0,819) đúng **0,003**. Ba dòng chặn nó là "Tân Sơn Nhứt", tức **tên thật** của những nơi đó.
- **`qui nhon`**: không dòng "Quy Nhơn" nào lọt vào 10 kết quả. `LIMIT 20` trong câu SQL bậc 1 bị
  hàng nghìn dòng viết đúng "Qui Nhon" (`sim` 1,0/0,875) chiếm hết trước khi tới dòng của nhánh
  `qAlias`.
- **`cong ly`**: vẫn là nguyên nhân (c) — OSM không có dữ liệu, không liên quan tới cách 2.

## Việc còn mở sau cách 2

1. **Bão hoà `LIMIT 20` trong bậc 1** (việc số 2 trong danh sách cũ, chưa làm): tách suất riêng cho
   nhánh `qAlias` — ví dụ UNION hai truy vấn có `LIMIT` riêng thay vì để chúng cạnh tranh trong cùng
   một `ORDER BY`. Đây là thứ duy nhất còn chặn `qui nhon` và `tan son nhut`.
2. **Nguồn tên đường cũ** cho `cong ly`, `hien vuong`, `truong minh giang` — cần dữ liệu ngoài OSM.
3. Các ca còn lại của bộ 20 (`dac lac`, `ban me thuot`, `bmt`, `mi tho`, `bac can`, `plei ku`,
   `saigon`, `li thuong kiet`) chưa phân tích từng ca; một số cần thêm mục vào từ điển địa danh
   (phải có nguồn OSM kiểm được), một số cùng nguyên nhân bão hoà ở trên.


---

# Sau sửa chấm điểm alias (`a76761a`, 08/09/2026)

## Lỗi thật là gì

Nhánh `qAlias` **tìm** theo dạng chuẩn, nhưng `sim` và `prefix` vẫn tính theo **chuỗi người dùng
gõ**. Vì `ORDER BY sim DESC ... LIMIT 20` dùng chính `sim` đó, dòng đúng vừa bị xếp thấp vừa bị cắt
khỏi tập ứng viên trước khi tới bước xếp hạng của route. Đo trên production trước khi sửa:

| Dòng | `word_similarity` với chuỗi gõ | với dạng chuẩn | Chênh về điểm |
|---|---:|---:|---:|
| "Sân bay quốc tế Tân Sơn Nhất" (`tan son nhut`) | 0,769 | **1,000** | 0,127 |
| POI "Quy Nhơn" cách `near` 0–1 km (`qui nhon`) | 0,636 | **1,000** | 0,200 |

`tan son nhut` khi đó chỉ thua hạng 3 đúng **0,003** điểm.

Sửa: thêm `word_similarity(qAlias, name_norm)` vào `greatest(...)` và `starts_with(name_norm,
qAlias)` vào `prefix`, chỉ sinh khi từ điển thật sự đổi được chuỗi. Vì `ORDER BY` dùng chính biểu
thức vừa sửa nên **không cần** thêm truy vấn UNION tách suất như phương án ban đầu — đỡ một vòng SQL
cho mọi request.

## Kết quả

| Phép đo | Trước cách 2 | Sau cách 2 | Sau sửa chấm điểm |
|---|---:|---:|---:|
| Bộ 20 biến thể — hit@3 | 3/20 | 6/20 | **9/20** |
| Tiêu chí 11.6 (5 ca spec) | 1/5 | 2/5 | **4/5** |
| Bộ 40 truy vấn mờ — hit@3 | 38/40 | 38/40 | **38/40** |
| Bộ 40 mờ — p95 lạnh | 1.742 ms | 1.715 ms | 1.729 ms |
| `pnpm test:api-db` | 42/42 | 42/42 | **42/42** |

Năm ca của tiêu chí 11.6 (với `near=10.776,106.700` như bộ đo dùng):

| Ca | Kết quả | Đạt |
|---|---|---|
| `qui nhon` | **Quy Nhơn Quán** hạng 1 (1,001) | ✓ |
| `kontum` | **Kon Tum** hạng 3 (0,751) | ✓ |
| `dak lak` | Bệnh Viện Mắt **Đắk Lắk** hạng 1 | ✓ |
| `tan son nhut` | **Tan Son Nhat** Saigon Hotel hạng 1, cả top 3 đều dạng chuẩn | ✓ |
| `cong ly` | không có Nam Kỳ Khởi Nghĩa | ✗ — OSM thiếu `old_name` |

## Mười một ca còn trượt của bộ 20 — hai nhóm

**Nhóm 1 — thiếu dữ liệu tên đường cũ (4 ca):** `cong ly`, `duong cong ly`, `hien vuong`,
`truong minh giang`. Cơ chế `matched_alt` đã chứng minh chạy được trên tên thay thế OSM có thật
(`co thanh ve` → Đường Bế Văn Đàn hạng 1), nhưng OSM Việt Nam không gắn `old_name` cho ba tuyến này.
Cần nguồn ngoài OSM hoặc CSV seed có nguồn kiểm được. **Không nên** nhét vào
`toponym_alias.json`: từ điển đó thay chuỗi ở **mọi** vị trí của truy vấn, nên "cong ly" → "nam ky
khoi nghia" sẽ phá hỏng việc tìm "Phở Công Lý" hay "VP Luật sư Trần Công Ly Tao" — đều là kết quả
đúng đang trả về hôm nay.

**Nhóm 2 — API trả đúng ĐỊA PHƯƠNG nhưng viết theo cách người dùng gõ (4 ca):**

| Truy vấn | Đích trong fixture | Thực tế top 3 |
|---|---|---|
| `dac lac` | `dak lak` | Bơ Booth **Đắc Lắc**, Cà Phê Nguyên Chất **Đắc Lắc** |
| `bac can` | `bac kan` | Nhà Hàng Lá Cọ TP **Bắc Cạn**, Phòng khám ... **Bắc Cạn** |
| `saigon` | `sai gon` | **Saigon** Garden, **Saigon** Europe Hotel |
| `mi tho` | `my tho` | Bánh **Mì Thổ** Nhĩ Kỳ Kebab |

Ba ca đầu trả về đúng nơi cần tìm, chỉ là tên POI viết "Đắc Lắc"/"Bắc Cạn"/"Saigon" chứ không viết
dạng chuẩn, mà fixture đòi **chuỗi đích phải nằm trong tên trả về**. `mi tho` thì nhập nhằng thật:
ở HCM, "mi tho" khớp "Bánh Mì Thổ Nhĩ Kỳ" là hợp lý.

**Đây là câu hỏi về tiêu chí, không phải về mã.** Tôi **không** sửa bộ mẫu để làm đẹp con số — plan
ghi rõ "không chọn lại bộ mẫu". Nếu PHONG thấy "trả đúng địa phương" là đạt thì phải sửa cách chấm
của fixture, và đó là quyết định của PHONG.

**Ba ca chưa phân tích:** `bmt` (viết tắt — cần mục từ điển), `plei ku`, `li thuong kiet`.
