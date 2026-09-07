# Task 8.3/8.4 — cổng độ phủ trên dữ liệu production và một lỗi mất alias (07/09/2026)

Số liệu: [`8-3-8-4-coverage-production.json`](8-3-8-4-coverage-production.json). Thay thế
[`8-3-8-4-coverage-summary.json`](8-3-8-4-coverage-summary.json) (chạy 03:03Z trên DB đo dùng-một-lần
`mapslibvn_alias_scale`, **trước** khi publish lúc 03:40Z).

## 1. Trước đó cổng chưa từng chạy trên dữ liệu đã publish

| Artifact | Thời điểm | Nguồn |
|---|---|---|
| `8-3-8-4-coverage-summary.json` | 03:03Z | `mapslibvn_alias_scale` — DB đo dùng-một-lần, **trước publish** |
| publish lên production | 03:40Z | `admin.mjs --accept-qa`, alias 33 → 37.246 |
| `out/admin-alias/report.json` trên máy dev | 03:23Z | `oldCount` 10 — chạy nhỏ, không phải toàn quốc |

Các con số 8.3/8.4 trong plan đến từ báo cáo QA của pipeline lúc publish, không từ
`verify-admin-alias --mode coverage`. Lần này chạy cổng đúng trên production (06:40Z) rồi trên một
DB staging dựng lại từ production để đo bản sửa.

## 2. Lỗi thật: 8 vùng cũ đất liền mất sạch alias

Cổng production trả `missing_mainland_l8` = 10. Hai ca là đảo (PHONG đã duyệt), **tám ca còn lại là
lỗi**, và chúng đi thành bốn cặp chỉ khác nhau ở dấu:

| Cặp | `name_norm` | huyện/tỉnh | đích overlay |
|---|---|---|---|
| Xã Đông Thạnh / Xã Đông Thành | `dong thanh` | Bình Minh, Vĩnh Long | **cùng** 206 Phường Đông Thành |
| Phường Sa Pa / Phường Sa Pả | `sa pa` | Sa Pa, Lào Cai | **cùng** 2269 Phường Sa Pa |
| Xã Phú Thành / Xã Phú Thạnh | `phu thanh` | Phú Tân, An Giang | **cùng** 402 Xã Chợ Vàm |
| Xã Lộc Thạnh / Xã Lộc Thành | `loc thanh` | Lộc Ninh, Bình Phước | **khác**: 846 và 848 |

Overlay tính đúng cả 8 (`targets: 1`, `rawCoverage: 1`), `unmatched` của pipeline chỉ có 2 ca đảo —
nhưng `admin_alias` có **0 dòng** cho cả 8. Cổng QA của pipeline không thấy vì nó kiểm `unmatched`
trong bộ nhớ, không kiểm bảng đã ghi.

**Nguyên nhân** — `admin-overlay.mjs` dòng 175 (trước sửa):

```js
const aliases = provisional.filter((row) => keyOwners.get(`${row.level}:${row.key}`)?.size === 1);
```

Khoá nào có nhiều hơn một chủ thì bị bỏ. Với bốn cặp trên, `name_norm` trùng khít **kể cả ở khoá đầy
đủ nhất** (`xa loc thanh huyen loc ninh binh phuoc`), nên mọi khoá của cả hai chủ đều bị bỏ và không
vùng nào còn đường tra. Trái đúng ràng buộc plan tự đặt ở quyết định #3: *"khác vùng nhưng cùng
khóa/đích được giải quyết bằng khóa có tỉnh, **không gộp mất provenance `old_area_id`**"*.

**Bản sửa** giữ nguyên ý định của #3 và chỉ đổi phạm vi: khoá **ngắn** nhập nhằng vẫn bị bỏ ("Phường
Trùng" trần không được tự chọn một trong hai tỉnh), nhưng khoá **đầy đủ nhất** thì không được bỏ — bỏ
nó là vùng cũ mất hết đường tra. PK ba cột `(alias_norm, level, admin_area_id)` tự lo trường hợp
trùng đích, nên dedupe trước COPY và chọn `old_area_id` nhỏ nhất cho kết quả xác định được.

Thêm trường report `ambiguousPrimaryKept` để đánh đổi này không xảy ra lặng lẽ — `rowsKept` nhỏ hơn
số chủ nghĩa là PK đã ăn provenance của vùng cũ còn lại:

```json
[{"key":"8:xa loc thanh huyen loc ninh binh phuoc","owners":["15924741","15963937"],"rowsKept":2},
 {"key":"8:phuong sa pa thi xa sa pa lao cai","owners":["12540572","12822519"],"rowsKept":1},
 {"key":"8:xa dong thanh thi xa binh minh vinh long","owners":["10113776","10113777"],"rowsKept":1},
 {"key":"8:xa phu thanh huyen phu tan an giang","owners":["14675895","14675896"],"rowsKept":1}]
```

Test khoá lại lớp lỗi: `admin-old.dbtest.mjs` thêm hai cặp trùng `name_norm` — một cặp khác đích
(phải giữ cả hai dòng), một cặp trùng đích (PK chỉ cho một dòng) — cùng khẳng định khoá ngắn vẫn bị bỏ.

## 3. Kết quả cổng: 84 → 79 failure

| Loại | production (trước) | staging (sau sửa) |
|---|---:|---:|
| `raw_coverage_gap` | 60 | 60 |
| `target_missing` | 10 | 10 |
| `missing_mainland_l8` | **10** | **5** |
| `unexpected_target` | 2 | 2 |
| `count_out_of_range` | 1 | 1 |
| `split_target_missing` | 1 | 1 |
| **tổng** | **84** | **79** |

`alias` 37.246 → **37.251** (+5: cặp Lộc được 2 dòng, ba cặp trùng đích mỗi cặp 1 dòng). `L4` 63,
`L6` 694, `L8` 4.215 không đổi; `unmatched` 2, `overlap` 0, `seed_miss` 0.

Năm `missing_mainland_l8` còn lại: **3 ca** là PK ba cột ăn provenance (Đông Thành, Sa Pả, Phú Thạnh)
và **2 ca đảo** PHONG đã duyệt. Ba ca kia chỉ hết nếu `old_area_id` vào PK, tức migration 0009 —
plan **cấm** trong phạm vi này ("Không làm … migration 0009 trong plan này"), nên đây là quyết định
spec cho PHONG, không phải việc code.

## 4. 12 ca alias trượt: **10/12 KHÔNG phải fixture sai**

48/60 đạt, ca tách 4/6. Nhưng phân rã lại thì kết luận trong plan ("phải biên soạn lại fixture từ
nghị quyết gốc mới đo lại được") **không đúng cho phần lớn**:

| Ca | Nguyên nhân đã kiểm | Biên soạn lại fixture có cứu được? |
|---|---|---|
| `lc-01`…`lc-10` (10 ca) | Snapshot **không có xã cũ nào** của Huyện Than Uyên. Raw chỉ có duy nhất relation `Than Uyên` cấp 6; `admin_area_old` Lai Châu có L8=43 nhưng không xã nào của Than Uyên. Các xã đích mới (Mường Kim, Khoen On, Than Uyên, Mường Than, Pắc Ta) đều có trong `admin_area` | **Không** — thiếu dữ liệu nguồn |
| `hn-01` | Overlay đúng hình học: Cửa Nam 0,833 · Văn Miếu–Quốc Tử Giám 0,130 · **Hoàn Kiếm 0,029** · **Ba Đình 0,008**. Hai đích nghị quyết có nêu bị **ngưỡng sliver 0,05 loại**; Văn Miếu 13% thì nghị quyết không nêu | **Không** — ngưỡng 0,05 so với thực tế pháp lý |
| `ct-01` | Bình Thủy 0,623 · Cái Khế 0,302 đúng nghị quyết, thêm **Thới An Đông 0,075** vượt ngưỡng nên được giữ dù nghị quyết không nêu — lệch niên đại ranh giới giữa snapshot 01/2025 và ranh giới hiện hành | **Không** — lệch niên đại nguồn |

`fixture_district_mismatch` đã về **0** từ commit `d1bc08c`, nên lớp lỗi "fixture ghi sai huyện" đã
đóng. Phần còn lại là ba lớp khác, và **không lớp nào** được giải bằng cách đọc lại nghị quyết.

Riêng `hn-01` đáng chú ý: ngưỡng `share ≥ 0,05` tồn tại để chặn nhiễu hình học, nhưng ở đây nó loại
đúng hai đích **có thật về pháp lý**. Hạ ngưỡng là đổi tham số plan đã chốt ("`share ≥ 0,05` giữ lại
ở overlay L8") nên cần quyết định spec, không tự sửa.

## 5. `count_out_of_range` — độ lệch nguồn cực kỳ không đều

L8 cũ 4.215 so với spec 10.000–10.700. Không phải thiếu đều mà lệch theo tỉnh:

| Tỉnh | số L8 cũ trong snapshot |
|---|---:|
| Sơn La | **1** |
| Bắc Giang | 2 |
| Vĩnh Phúc | 2 |
| Hà Nam | 2 |
| Điện Biên | 3 |
| Kon Tum | 4 |

Đây là cùng một gốc với 10 ca `lc-*`: snapshot Geofabrik 01/2025 chỉ chứa một phần nhỏ relation cấp
xã. Cần đổi nguồn hoặc sửa spec có dẫn chứng — quyết định của PHONG, plan cấm padding bằng duplicate
relation.

## 6. Còn lại chờ quyết định, không phải việc code

1. **`count_out_of_range`** — đổi nguồn hay sửa khoảng spec kèm dẫn chứng.
2. **`raw_coverage_gap` 60** — nhóm ven biển, mẫu số gồm lãnh hải (phân tích ở mục 8 hồ sơ 6.5). Cần
   quyết định QA có nguồn trước release.
3. **1.970 cảnh báo `discarded_sliver`** — cần quyết định QA có nguồn trước release.
4. **3 ca `missing_mainland_l8`** — PK ba cột; muốn hết thì phải đưa `old_area_id` vào PK
   (migration 0009, plan cấm ở phạm vi này).
5. **Ngưỡng sliver 0,05** — `hn-01` chứng minh nó loại được đích pháp lý thật.

## 7. Production vẫn còn khoảng thiếu

Bản sửa đã nghiệm thu trên staging, **chưa publish lên production**. Production hiện vẫn thiếu alias
của 8 vùng cũ đất liền, trong đó Lộc Thạnh và Lộc Thành tra tên ra rỗng. Publish thuộc Task 9.2
(backup → staging QA → publish data → API → SDK).

## 8. Cách chạy lại

```
# Dựng staging từ production (4 bảng), trong container pipeline
psql "$SU/postgres" -c "CREATE DATABASE mapslibvn_alias_stage TEMPLATE template0"
DATABASE_URL=$SU/mapslibvn_alias_stage node scripts/db-migrate.mjs
pg_dump "$SU/mapslibvn" --data-only --table=admin_area | psql "$SU/mapslibvn_alias_stage"
for T in vn_boundary osm_admin_raw osm_admin_old_raw; do   # pipeline tạo lúc chạy → dump kèm schema
  pg_dump "$SU/mapslibvn" --table=$T | psql "$SU/mapslibvn_alias_stage"; done

# Dựng lại old+alias rồi chạy cổng
MAPSLIBVN_OUT=/app/out-stage DATABASE_URL=$SU/mapslibvn_alias_stage node rebuild.mjs
MAPSLIBVN_OUT=/app/out-stage DATABASE_URL=$SU/mapslibvn_alias_stage \
  node scripts/verify-admin-alias.mjs --mode coverage --out out-stage/admin-alias
```

Image `mapslibvn/pipeline:local` cũ hơn Task 8: thiếu `db/migrations/0008_admin_old.sql` và
`scripts/verify-admin-alias.mjs`, phải `docker cp` vào trước khi chạy.
