# Task 9.4 / 9.5 — nghiệm thu trên production và thử cập nhật lần hai (07/09/2026)

## 0. Chặn giữa đường: 4 endpoint production 503

Khi bắt đầu 9.4, smoke area trả **0 item ở mọi truy vấn**. Truy ra không phải dữ liệu alias mà là
sự cố: `autocomplete`, `search`, `nearby`, `reverse` đều 503 `upstream_unavailable`, còn `geocode` và
`/healthz/db` vẫn 200.

Nguyên nhân lấy từ log CI job "API tests (Places, real DB)":

```
PostgresError: malformed array literal: "osm,overture,fsq"
```

`poiSourceFilter` bind mảng JS rồi cast `::text[]`. Bản **`postgres/cf`** dùng trong Workers nối mảng
thành chuỗi; bản **`postgres` cho Node** serialize đúng — nên lỗi **không hiện ở unit test không DB**,
chỉ hiện ở `test:api-db` và trên production. `geocode` sống vì nó đã dùng helper `textArray`
(`ARRAY(SELECT json_array_elements_text(...))`), `admin-scope` cũng vậy; `poiSourceFilter` là chỗ duy
nhất bind mảng trực tiếp và nó được dùng ở **đúng 4 route bị chết**.

Đã sửa ở `2728347` (export `textArray` và dùng lại, kèm itest chạy thật `sources=` trên cả 4 route):
`test:api-db` **7 failed → 33 passed**. Deploy API thành công 16:01:47 (+07), cả 4 endpoint về 200.

**Lỗ hổng quy trình để lỗi này lên production:**

| SHA | Deploy API | API tests (DB thật) |
|---|---|---|
| `178d086` | ✅ 08:24:15 UTC | ❌ **failure** 08:24:05 UTC |
| `0585eb1` | ✅ 08:37:37 UTC | ❌ **failure** 08:37:31 UTC |

`deploy-api.yml` chỉ có `on: push: branches: [main]`, **không `needs:`** bộ test DB thật. Test đỏ 10
giây trước mà deploy vẫn chạy. Bộ test đã bắt đúng lỗi — chỉ là không có gì chặn deploy. **Đề xuất
cho PHONG: cho Deploy API phụ thuộc job API tests.**

## 1. Task 9.4 — nghiệm thu trên production

| Hạng mục | Kết quả |
|---|---|
| Chạy lại coverage | **0 failure / 309 warning / exit 0** (mục F hồ sơ 8.3) |
| ≥60 ca fixture | 48/60 đạt, 12 ca khai báo có bằng chứng |
| 10 cặp geocode | 9/10 chính xác cao (8.6) |
| Benchmark cùng cách đo | warm p95 +2/−2/−38 ms; cold p95 phía Worker −163 ms (8.5) |
| API role đọc old table | ✓ `api` có SELECT trên `admin_area`, `admin_area_old`, `admin_alias`, `poi`, `street`, `category`; `/healthz/db` trả `user: api`, `schema_migration: 0008` |
| Export ODbL có old+alias mới | ✓ `admin_area` 3.353 · `admin_area_old` 4.972 · **`admin_alias` 37.251** (gồm +5 dòng bản sửa), manifest có sha256 từng bảng |
| Playground tải SDK mới | ✓ `/sdk/mapslibvn.umd.js` (1,09 MB) có `"area"`, 7× `poiSources`, 3× `sources=` |
| Smoke area | 4/5 đạt — **1 ca lộ vấn đề thật, xem mục 2** |

### Smoke area (types mặc định, `near=10.776,106.700`)

| Truy vấn | Kết quả |
|---|---|
| `Quận 10` | ✓ area: **Quận 10** → Phường An Đông, Phường Bàn Cờ, Phường Chợ Quán, … |
| `Bình Dương` | ✓ area: **Phường Bình Dương** → Thành phố Hồ Chí Minh |
| `Thủ Dầu Một` | ✓ area: **Phường Thủ Dầu Một** → Thành phố Hồ Chí Minh |
| `types=poi,street,address` | ✓ `area=0` — loại trừ area hoạt động đúng |
| `Phường Diên Hồng` (tên hiện hành) | ✗ xem dưới |

## 2. Phát hiện của 9.4: tiền tố đơn vị trong truy vấn làm tụt tên hiện hành

`types=area`, cùng `near`:

| Truy vấn | Top 1 | Vị trí kết quả đúng |
|---|---|---|
| `Diên Hồng` | Phường Diên Hồng | **1** ✓ |
| `Phường Diên Hồng` | Phường An Khánh | **2** |
| `Sài Gòn` / `Phường Sài Gòn` | Phường Sài Gòn | 1 ✓ |
| `Xã Chợ Vàm` | Xã Chợ Vàm | 1 ✓ |
| `Phường Bàn Cờ` | Phường Cầu Ông Lãnh | **không có trong 10** |

`Phường Diên Hồng` và `Phường Bàn Cờ` đều là **tên phường hiện hành có thật** (Diên Hồng có 2 vùng:
id 1224 TP.HCM và 1985 Gia Lai; Bàn Cờ nằm trong danh sách đích của Quận 10 cũ). Bỏ tiền tố đi thì
đúng ngay hạng 1. Nghi vấn: token dùng chung `phuong` làm `word_similarity` cao giả, đẩy vùng không
liên quan lên trên khớp tên chính xác. Không đều — `Phường Sài Gòn` và `Xã Chợ Vàm` vẫn đúng.

**Chưa sửa.** Đây là vấn đề xếp hạng/recall của nhánh area, cần điều tra riêng: không phải lỗi dữ
liệu alias (dữ liệu có đủ), không phải hồi quy của việc hôm nay (`withAreaSlot` và bậc hoá từ Task
6.5/7). Giữ 9.4 mở với đúng hai ca cụ thể theo luật plan "nếu trượt, giữ task mở với case cụ thể".

## 3. Task 9.5 — cập nhật dữ liệu lần hai trên staging

Staging `mapslibvn_t95_stage` dựng từ production, khớp từng bảng: `admin_area` 3.353,
`admin_area_old` 4.972, `admin_alias` 37.251, `vn_boundary` 45, `osm_admin_raw` 9.106,
`osm_admin_old_raw` 4.985.

Checksum mapping theo **(relation ID vùng cũ → tên đích + tên tỉnh của đích, share, source)**, sắp
trong JS. **Không** dùng `admin_area.id` vì `admin.mjs` đánh lại ID bằng `row_number()` — đúng yêu
cầu 9.5 "không so raw current IDs".

| Lần chạy | alias | old | area | orphan | distinct_alias | mapped | checksum |
|---|---:|---:|---:|---:|---:|---:|---|
| A — trạng thái nền | 37.251 | 4.972 | 3.353 | 15 | 19.254 | 37.236 | `84f4cedbe29495c9` |
| B — sau `admin-old.mjs` | 37.251 | 4.972 | 3.353 | 15 | 19.254 | 37.236 | **`84f4cedbe29495c9`** |
| C — sau `admin.mjs` | 37.251 | 4.972 | 3.353 | 15 | 19.254 | 37.236 | **`84f4cedbe29495c9`** |

- **`admin-old.mjs` chạy lẻ idempotent** — A = B.
- **Cập nhật dữ liệu thường (`admin.mjs`, đúng đường cron `data:update`) KHÔNG làm mất alias** — C = A,
  kể cả khi nó đánh lại toàn bộ ID `admin_area` (`L4=34, L8=3319`, publish 2.533 ms). Đây là phép thử
  trực tiếp cho rủi ro cron thứ Hai 14/09 đã ghi trong DEVLOG: **rủi ro đó không còn**.
- Chốt an toàn của quyết định A chạy đúng trong lần chạy thật: staging không copy `poi` nên overlay in
  `⚠ bảng poi rỗng — bỏ phép đo mật độ POI cho vùng thiếu phủ, cổng giữ nguyên failure` và **không**
  gắn số đo nào — tức không tự chấp nhận gap khi thiếu bằng chứng.

### Một lỗi trong phép đo của tôi, đã sửa

Checksum đầu tiên đổi giữa hai lần chạy (`4e68600f…` → `a9dfb186…`) trong khi mọi số đếm y nguyên.
`diff` cho thấy **chỉ 2 dòng, cùng nội dung, khác vị trí**:
`7130633|thi xa thuan thanh|6|Xã Đại Đồng|0.0001|overlay`. Có **hai vùng hiện hành cùng tên "Xã Đại
Đồng"**, mà tôi `ORDER BY` theo tên nên hai dòng đó hoà và thứ tự tuỳ ý — không phải thứ tự toàn
phần. Đã thêm tên tỉnh của đích vào khoá và sắp trong JS; sau đó checksum ổn định qua 3 lần chạy.
Nếu không truy `diff` mà tin ngay checksum thì đã kết luận sai rằng pipeline không idempotent.

## 4. Còn lại của Task 9

- **9.2** phần publish data: **xong** (37.251 alias lên production). SDK/docs npm chưa phát hành —
  giai đoạn nội bộ.
- **9.3**: chờ CI xanh. 5 test `styleUrl` ở `packages/web` + `packages/react-native` còn đỏ do việc
  `sources` (kỳ vọng chưa cập nhật cho `&sources=...`).
- **9.4**: mở với hai ca `Phường Diên Hồng` / `Phường Bàn Cờ` ở mục 2.
- **9.6**: artifact rollback sẵn, chưa cần dùng.
- **9.7**: chưa tick.
