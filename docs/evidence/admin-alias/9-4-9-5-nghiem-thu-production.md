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
| Smoke area | 5/5 đạt sau khi sửa lỗi recall ở mục 2 |

### Smoke area (types mặc định, `near=10.776,106.700`)

| Truy vấn | Kết quả |
|---|---|
| `Quận 10` | ✓ area: **Quận 10** → Phường An Đông, Phường Bàn Cờ, Phường Chợ Quán, … |
| `Bình Dương` | ✓ area: **Phường Bình Dương** → Thành phố Hồ Chí Minh |
| `Thủ Dầu Một` | ✓ area: **Phường Thủ Dầu Một** → Thành phố Hồ Chí Minh |
| `types=poi,street,address` | ✓ `area=0` — loại trừ area hoạt động đúng |
| `Phường Diên Hồng` (tên hiện hành) | ✓ sau bản sửa `bde2d35` — trước đó tụt hạng, xem mục 2 |

## 2. Lỗi tìm được ở 9.4: tiền tố đơn vị làm mất hẳn tên hiện hành khỏi ứng viên

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

### Truy đến gốc: đây là RECALL, không phải xếp hạng

`q="Phường Bàn Cờ"` trả về danh sách **hoàn toàn không có** Phường Bàn Cờ (top Phường Cầu Ông Lãnh
score 0,59); `q="Bàn Cờ"` trả đúng nó, score **0,801**, là kết quả duy nhất. Tức vùng đúng không vào
nổi danh sách ứng viên.

`admin_area.name_norm` lưu tên **không có tiền tố đơn vị** (`ban co`), nhưng nhánh current khớp bằng
`queryCore`, mà `nameCore` chỉ bỏ **filler POI**: `NAME_FILLERS` có `'quan'` (quán ăn) nhưng **không
có** `'phuong'`, `'xa'`, `'thi tran'`. Đo trực tiếp:

| Truy vấn | `normalizeVi` | `nameCore` |
|---|---|---|
| `Phường Bàn Cờ` | `phuong ban co` | `phuong ban co` ← tiền tố còn nguyên |
| `Quận 10` | `quan 10` | `10` ← bỏ được, do trùng filler POI |
| `Xã Chợ Vàm` | `xa cho vam` | `xa cho vam` |

Nên bậc 1 chạy `name_norm LIKE 'phuong ban co%'` → không khớp gì. Bậc 2 fuzzy cũng không cứu được tên
ngắn: `word_similarity('phuong ban co','ban co')` bị pha loãng dưới ngưỡng 0,5. `Phường Sài Gòn` và
`Xã Chợ Vàm` thoát được chỉ vì tên dài/đặc trưng hơn nên fuzzy vẫn vượt ngưỡng — đó là lý do lỗi trông
như "không đều".

### Bản sửa

`parseAddress` **đã tách sẵn tên đúng**: `ward: 'Bàn Cờ'`, `'Diên Hồng'`, `'Chợ Vàm'`, `district: '10'`.
Nhánh current giờ dùng nó cho cả tiền tố, so khớp và tính điểm. Chỉ lấy `ward`/`district` — `province`
bị canonicalize (`Bình Dương` → `Thành phố Hồ Chí Minh`) nên lấy nó sẽ đổi hành vi các truy vấn tỉnh
cũ đang đúng. Truy vấn POI có `ward`/`district` rỗng nên vẫn dùng `queryCore` như trước. Nhánh alias
giữ nguyên `queryNorm` vì `admin_alias.alias_norm` **có** chứa tiền tố.

Sửa ở `bde2d35`, deploy xong 16:27:48 (+07). Đo lại trên production, `types=area`:

| Truy vấn | Trước | Sau |
|---|---|---|
| `Phường Bàn Cờ` | **không có trong 10** | **0,801 Phường Bàn Cờ** |
| `Bàn Cờ` | 0,801 Phường Bàn Cờ | 0,801 Phường Bàn Cờ |
| `Phường Diên Hồng` | hạng 2 (top An Khánh) | **0,744 Phường Diên Hồng** |
| `Diên Hồng` | 0,744 | 0,744 |
| `Phường Sài Gòn` | 0,861 | 0,861 |
| `Xã Chợ Vàm` | 0,635 | 0,635 |

Có và không có tiền tố giờ cho **cùng một kết quả và cùng score**. Không hồi quy: smoke `Quận 10` /
`Bình Dương` / `Thủ Dầu Một` vẫn đúng, `types=poi,street,address` vẫn cho `area=0`, và **hit@3 fuzzy
37/40 = baseline** (miss vẫn đúng ba ca cũ: `higland`, `cho rya`, `sieu thi co op`).

Test khoá lại: hai nhánh phải dùng hai khoá khác nhau, và ca POI không đổi hành vi.

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

## 3b. Task 9.3 — workflow thật theo SHA

Mọi workflow đều **lọc path**, nên một commit chỉ-tài-liệu chỉ kích hoạt `CI`; các workflow khác giữ
kết quả của SHA cuối cùng chạm đúng path của chúng. Đó là lý do bảng dưới trải trên nhiều SHA — không
suy ra từ local build:

| Workflow | Trigger paths | SHA | Kết luận | Run |
|---|---|---|---|---|
| `CI` | không lọc | `9bccce2` | **success** | [34107792243](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34107792243) |
| `Deploy API` | `apps/api/**`, `apps/admin/**`, `packages/core/**`, `packages/style/**`, `pnpm-lock.yaml` | `bde2d35` | **success** | [34106026388](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34106026388) |
| `API tests (Places, real DB)` | `apps/api/**`, `apps/admin/**`, `packages/core/**`, `db/migrations/**`, `scripts/ap…` | `bde2d35` | **success** | [34106026398](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34106026398) |
| `Deploy Docs` | `apps/docs/**`, `packages/web/**`, `packages/core/**`, `packages/react/**`, … | `834db37` | **success** | [34105145022](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34105145022) |
| `DB tests` | `db/**`, `pipelines/poi/**`, `scripts/**`, `packages/core/**`, `vitest.db.config.ts` | `9bccce2` | **success** — 10 file / **62 test** | [34108066281](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34108066281) |

`DB tests` liên tục bị **cancelled** trong ngày vì `concurrency: cancel-in-progress` và tôi push nối
tiếp; run xanh gần nhất là `0585eb1`
([34101480379](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34101480379)), nhưng SHA
đó **trước** khi `pipelines/poi/src/lib/poi-filter.mjs` xuất hiện — tức chưa kiểm cây pipeline hiện
tại. Đã `workflow_dispatch` một run trên `main` (`9bccce2`) để có bằng chứng đúng cây: **success, 10 file / 62 test**.

**Cả 5 workflow đều có run xanh trên cây hiện tại.**

### Hai lỗi chặn CI trong ngày, đều **không** thuộc Task 8/9

1. **5 test `styleUrl`** ở `packages/web` + `packages/react-native` — việc `sources` thêm
   `&sources=osm,overture,fsq` vào `styleUrl` mà chưa cập nhật kỳ vọng. Phiên đó sửa ở `37e4870`.
2. **Thứ tự build**: `scripts/lib/poi-profile.mjs` → `pipelines/.../poi-filter.mjs` →
   `@mapslibvn/core`. `tsconfig.scripts.json` include `scripts/**/*.mjs` nên `tsc` kéo `poi-filter.mjs`
   vào program, mà bước `tsc -p tsconfig.scripts.json` chạy **trước** `turbo run typecheck` nên không
   được hưởng `dependsOn: ["^build"]` và không có `packages/core/dist`. Local xanh **chỉ vì** dist đã
   build sẵn từ trước; tái hiện đúng lỗi CI bằng `rm -rf packages/core/dist && pnpm typecheck`. Sửa ở
   `44da644`: thêm `pnpm --filter @mapslibvn/core build &&` vào đầu script `typecheck`, đúng cách
   script `test` vẫn làm.

### Đã vá: Deploy API giờ chặn bởi bộ test DB thật (`f9f5fdb`)

`needs` chỉ hoạt động giữa các job **trong cùng một workflow**, nên không thể `needs` sang
`apitest.yml`. Cách làm: biến `apitest.yml` thành workflow **gọi lại được** (`workflow_call`), và
`Deploy API` thêm job `apitest: uses: ./.github/workflows/apitest.yml` với `deploy: needs: apitest`.
Chọn cách này thay vì `workflow_run` vì `workflow_run` phải tự xử lý checkout đúng SHA và điều kiện
`conclusion` cross-workflow, lại không chạy khi apitest không được trigger (ví dụ push chỉ chạm
`packages/style/**`).

Hai cái bẫy đã xử lý:

1. **Chạy hai lần.** Path của apitest và deploy-api trùng nhau ở `apps/api/**`, `apps/admin/**`,
   `packages/core/**`. Nếu giữ nguyên, mỗi lần chạm `apps/api` sẽ chạy bộ test hai lần — repo private
   chỉ có **2.000 phút Actions/tháng**. Đã cắt các path trùng khỏi trigger `push` của apitest, giữ lại
   đúng phần deploy-api **không** bao: `db/migrations/**`, `scripts/api-db-test.mjs`, `scripts/lib/**`,
   `.github/workflows/apitest.yml`.
2. **Tự huỷ cổng.** `concurrency` của apitest có `cancel-in-progress: true`. Nếu group dùng chung thì
   một `workflow_dispatch` apitest giữa lúc deploy sẽ **huỷ luôn job cổng** của deploy. Đã thêm
   `github.workflow` vào group — đó là workflow **cấp cao nhất**, nên lần chạy do `Deploy API` gọi có
   group khác lần chạy độc lập.

Hệ quả cần biết: từ nay push chỉ chạm `packages/style/**` hoặc `pnpm-lock.yaml` cũng kéo theo bộ DB
thật (trước thì không) — đúng ý, vì cả hai đều vào bản Worker được deploy.

**Đã nghiệm thu bằng run thật, không chỉ đọc YAML:**

| Kiểm | Kết quả |
|---|---|
| `API tests (Places, real DB)` chạy **độc lập** trên `f9f5fdb` | ✅ success — chuyển `workflow_call` không vỡ đường cũ ([34119721603](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34119721603)) |
| `CI` trên `f9f5fdb` | ✅ success |
| `Deploy API` khi mới khởi động | graph **chỉ có** job `apitest / apitest`; job `deploy` **chưa tồn tại** vì đang bị `needs` giữ |
| Thứ tự thật trong run | `apitest / apitest` success **12:05:04** → `deploy` mới bắt đầu **12:06:42** ([34119938354](https://github.com/dotienphong/maps-library-vietnam/actions/runs/34119938354)) |
| Production sau lần deploy có cổng | `/healthz/db` ok · autocomplete/search/nearby/reverse/geocode **200** · area `Phường Bàn Cờ` **0,801 hạng 1** |

Trước bản vá, `deploy` chạy song song bất kể test; giờ nó không xuất hiện trong graph cho tới khi
`apitest` xanh. Lần deploy dùng để nghiệm thu là redeploy đúng code đang live nên production không đổi.

### Sửa lại một điều tôi nói sai ở mục 0

`deploy-api.yml` **có** gate trên test: nó chạy `pnpm --filter @mapslibvn/api test` như một step. Cái
nó **không** gate là bộ **DB thật** — đó là workflow riêng `apitest.yml`. Nên phát biểu đúng là: Deploy
API chạy API unit test nhưng **không chờ** `API tests (Places, real DB)`, và chính bộ DB thật mới là
bộ bắt được lỗi `malformed array literal`. Đề xuất cho PHONG vẫn giữ nguyên: cho Deploy API phụ thuộc
workflow đó.

## 4. Còn lại của Task 9

- **9.2** phần publish data: **xong** (37.251 alias lên production). SDK/docs npm chưa phát hành —
  giai đoạn nội bộ.
- **9.3**: 5 test `styleUrl` đã được phiên `sources` sửa ở `37e4870`. Còn một lỗi thứ tự build:
  `scripts/lib/poi-profile.mjs` → `pipelines/.../poi-filter.mjs` → `@mapslibvn/core`, mà
  `tsc -p tsconfig.scripts.json` chạy **trước** `turbo run typecheck` nên không được hưởng
  `dependsOn: ["^build"]` và không có `packages/core/dist`. Local xanh chỉ vì dist đã build sẵn; tái
  hiện được bằng `rm -rf packages/core/dist && pnpm typecheck`. Sửa ở `44da644`: `pnpm typecheck`
  build core trước, đúng cách `pnpm test` vẫn làm.
- **9.4**: **đóng** — lỗi recall đã sửa ở `bde2d35`, đo lại trên production đạt 5/5.
- **9.6**: artifact rollback sẵn, chưa cần dùng.
- **9.7**: chưa tick.
