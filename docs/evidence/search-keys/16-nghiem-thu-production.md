# Task 16 — nghiệm thu hạng mục 3 trên production (08/09/2026)

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
