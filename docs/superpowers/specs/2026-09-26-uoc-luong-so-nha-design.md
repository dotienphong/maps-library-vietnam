# Đặc tả: ước lượng vị trí số nhà khi không có mốc — theo từng tuyến, ngoại suy một phía, chọn đúng đường

Ngày: 26/09/2026. PHONG duyệt thiết kế trong phiên brainstorm cùng ngày. Đây là **dự án con 1/3**
của hướng "học theo cách Waze tìm số nhà" (thứ tự PHONG chốt: 1 thuật toán → 2 ghim xác nhận trong
SDK + nhật ký tìm hụt → 3 API xác nhận giao hàng). Dự án con 2 và 3 có spec riêng.

Bằng chứng nền (ngoài repo, thư mục nghiên cứu `software_business/waze_re/`):
`MAP_DATA_ANALYSIS.md` mục 7 (Waze tìm số nhà ở VN bằng Google Places, tile không có số nhà),
bench `geocode_bench/bench.test.mjs` và bản thử nghiệm `geocode_bench/proto/` (`lib.mjs`,
`proto.test.mjs`, `results.json`) chạy trên DB dev nạp fixture Quận 1.

## 1. Mục tiêu và phạm vi

Khi địa chỉ có số nhà mà **không có mốc trùng số** (`address_anchor`), trả về vị trí ước lượng gần
đúng hơn và nói thật mức chính xác. Hiện có ba lỗ: chỉ nội suy khi có mốc hai phía cách nhau
≤ 400 m, không phân biệt các đường trùng tên, và khi rơi xuống mức đường thì chọn tuyến tuỳ ý.

Trong phạm vi:
- `apps/api/src/house-number.ts` (mới) — module thuần TypeScript, không truy cập DB.
- `apps/api/src/geocode.ts` — thay bước 3, thêm bước 3b, sửa bước 4, thêm nhánh "chỉ có số hẻm".
- `packages/core/src/types.ts` — `GeocodePrecision` thêm `'extrapolated'`; 4 gói SDK lên 0.16.0.
- Docs: `apps/docs/src/content/docs/do-chinh-xac.md`, `api.md`, `sdk.md`, Playground
  (`apps/docs/public/playground-lib.js`), spec gốc `2026-08-26-mapslibvn-maps-sdk-design.md` mục 6.3.
- Bench trong repo: `scripts/geocode-bench.mjs` + kết quả trong `docs/evidence/so-nha/`.

Ngoài phạm vi: migration, bảng mới, sửa pipeline; `/v1/reverse`; `/v1/autocomplete` (loại
`address` vẫn chỉ trả mốc `rooftop`); vùng đánh số lại theo quận; đặt điểm lệch sang đúng bên đường
(đo không cải thiện — mục 3); chuẩn hoá tên đường của mốc FSQ (mục 9); publish npm (PHONG làm tay).

## 2. Hiện trạng đã kiểm tra

- `apps/api/src/geocode.ts:57` — bước 1–3 chỉ chạy khi `parsed.housenumber` có giá trị.
  `parseAddress('Hẻm 150 Nguyễn Trãi')` trả `alleyChain: ['150']`, `alleyKeyword: 'hem'`, **không**
  có `housenumber`, nên truy vấn này rơi thẳng xuống bước đường (`precision: 'street'`).
- `apps/api/src/geocode.ts:179-282` (`stepInterpolate`) — lấy `lo`/`hi` trên **toàn bộ** mốc cùng
  `street_norm` trong phạm vi, không tách theo tuyến vật lý. `:232` bỏ khi hai mốc cách nhau > 400 m.
  Chỉ chiếu lên tuyến khi `ST_LineMerge` ra một `LINESTRING` (`:248`) nằm trong 100 m quanh `lo`;
  fixture có 529/1.094 dòng `street` (48%) là nhiều nhánh nên phần lớn nội suy thành đường thẳng
  giữa hai mốc.
- `apps/api/src/geocode.ts:285-352` (`stepStreet`) — không có `near` thì `ORDER BY id` (`:327`):
  "1 Đường Huỳnh Mẫn Đạt" (xoá mốc của nó) trả tuyến cùng tên cách 5,4 km.
- `pipelines/poi/src/geocode/streets.mjs:16-25` — `street` là cụm theo `name_norm` + `province_norm`
  + `ST_ClusterDBSCAN(eps 0.001)`; `pipelines/poi/src/geocode/anchors.mjs:177-185` chép mốc
  `source='user'` sang bảng mới ở mỗi lần build.
- Hợp đồng công khai: `packages/core/src/types.ts:44-51` (`GeocodePrecision`), SDK 0.15.1 **đã có
  trên npm**; `apps/docs/src/content/docs/do-chinh-xac.md:12-19` (thang), `:86-87` (hướng dẫn dùng);
  `api.md:998-1005`; tiền lệ thêm giá trị enum: `'district'` ở 0.2.0, ghi chú nâng cấp
  `sdk.md:120-128`; `apps/docs/public/playground-lib.js:37` (`PRECISION_RADIUS`); spec gốc
  `2026-08-26-mapslibvn-maps-sdk-design.md:426` và `:609` ("nội suy chỉ khi có mốc hai phía ≤ 400 m").
- Số liệu fixture Quận 1 (DB dev, 16.921 mốc, nguồn osm + fsq):
  - 597/892 tên đường không có mốc nào (64% chiều dài đường); đường có mốc: trung vị 22 mốc/km.
  - 6.469 mốc (38%, trong đó 6.121 FSQ) không nằm trong 150 m của tuyến cùng tên: 5.079 có tên
    đường không có trong `street` (kiểu "ho chi minh city", "le thanh ton st"), 1.390 ở xa.
  - Mốc lệch tim đường: trung vị 11,9 m (p25 5,4 m, p75 32,2 m).
  - Quy ước lẻ trái / chẵn phải (theo chiều số tăng): mốc OSM 89,2% / 89,8% (41/46 đoạn đúng cả
    hai); FSQ nhiễu hơn, 66,9% / 62,9%.
  - Độ dốc số mét mỗi số nhà (Theil–Sen, 417 nhóm cùng tuyến + nhánh + chẵn/lẻ có ≥ 4 mốc):
    trung vị 3,22 m/số (p25 2,26, p75 5,34; 7 nhóm > 25 m/số).

## 3. Quyết định đã chốt khi duyệt

1. **Mức mới `extrapolated`** (confidence 0,5) đứng giữa `interpolated` và `street`. Thay đổi chỉ
   thêm: JS chạy như cũ, chỉ `switch` vét cạn trong TypeScript phải thêm nhánh (như `'district'`).
   API trả giá trị mới ngay khi deploy, kể cả với client dùng SDK cũ.
2. **Tính lúc truy vấn trong API** (không bảng dải số nhà tính sẵn): mốc mới — sửa của người dùng
   hôm nay, ghim xác nhận ở dự án con 2 và 3 — cải thiện ước lượng cho nhà lân cận ngay, không chờ
   lần build dữ liệu kế tiếp.
3. **Điểm trả về nằm trên tim đường** như hiện nay. Bản thử nghiệm đặt điểm lệch sang đúng bên đường
   theo độ lệch của mốc cho trung vị 27–28 m, bằng cách đặt trên tim đường: sai số dọc tuyến chiếm
   phần lớn. Bên trái/phải chỉ dùng để suy chiều đánh số (mục 4.3 bước 4).
4. **Làm thẳng trên `main`** (quyết định của PHONG), hỏi trước khi push — mục 8.

## 4. Thiết kế

### 4.1 Thang geocode sau khi sửa

| Bước | Điều kiện | Vị trí | `precision` | `confidence` |
|---|---|---|---|---|
| 1 | có mốc cùng số nhà + cùng đường | toạ độ mốc | `rooftop` | 0,9 (0,95 mốc user) — giữ nguyên |
| 2 | có `alley` số = `alleyChain[0]` | như hiện nay | `alley` | 0,7 — giữ nguyên |
| 2′ | **chỉ có số hẻm** ("Hẻm 150 X") và có dòng `alley` | điểm đầu hẻm (`entrance`, không có thì đầu tuyến hẻm) | `alley` | 0,7 |
| 3 | trên cùng một tuyến có mốc cùng chẵn/lẻ kẹp hai phía, cách nhau ≤ 800 m; không tuyến nào có thì kẹp trên toàn bộ mốc cùng tên như hiện nay | nội suy theo vị trí dọc tuyến, điểm trên tim đường | `interpolated` | 0,6 |
| 3b | chỉ có mốc ở một phía trên tuyến | ngoại suy theo độ dốc học từ mốc (4.3) | `extrapolated` | 0,5 |
| 4 | khớp tên đường | tuyến giữ nhiều mốc nhất của tên đó, điểm gần trọng tâm các mốc; không có mốc thì như hiện nay | `street` | 0,4 |
| 5 | vùng hành chính | giữ nguyên | `ward`/`district`/`province` | 0,2 |

Địa chỉ trong hẻm ("150/12 X") khi bước 2 không có dòng `alley`: bước 3–3b dùng **số hẻm** (150)
như số nhà mặt đường để ước lượng điểm đầu hẻm — đúng hành vi hiện nay (`parseInt('150/12')`), chỉ
thêm khả năng ngoại suy. "Hẻm 150 X" không có dòng `alley` cũng đi đường này.

### 4.2 Module `apps/api/src/house-number.ts`

Thuần TypeScript, không import DB, chạy được trong Workers và vitest. Giao diện:

```ts
export interface StreetLine {
  id: number;
  parts: [number, number][][];      // [lng, lat], mỗi phần tử là một nhánh sau ST_LineMerge
}
export interface HouseAnchor {
  hn: number;                        // số nhà nguyên (INTEGER_HOUSE_NUMBER_PATTERN)
  lat: number;
  lng: number;
  wardNorm: string | null;
  provinceNorm: string | null;
}
export interface HouseEstimate {
  lat: number;
  lng: number;
  method: 'interpolated' | 'extrapolated';
  streetId: number | null;           // null = kẹp trên toàn bộ mốc (mốc không gán được vào tuyến)
  wardNorm: string | null;           // của `lo` (nội suy) hoặc `a*` (ngoại suy), mục 4.3
  provinceNorm: string | null;
}
export function estimateHouse(input: {
  number: number;
  streets: StreetLine[];
  anchors: HouseAnchor[];
  near: { lat: number; lng: number } | null;
  limit: number;
}): HouseEstimate[];
export function streetEvidence(input: {
  streets: StreetLine[];
  anchors: HouseAnchor[];
}): { streetId: number | null; lat: number; lng: number } | null;
```

Hình học tính trong mặt phẳng mét cục bộ (equirectangular quanh trọng tâm của từng tuyến), đủ chính
xác ở quy mô vài km. Hằng số đặt tên và export để test:

| Hằng số | Giá trị | Nguồn |
|---|---|---|
| `ASSIGN_MAX_M` | 150 | mốc cách tuyến cùng tên xa hơn thì không gán |
| `BRACKET_GAP_M` | 800 | nới từ 400; bản thử nghiệm tăng tỉ lệ nội suy mà không tăng p90 |
| `EXTRAP_K` | 4 | số mốc gần nhất theo số dùng tính độ dốc |
| `EXTRAP_CAP_M` | 300 | tốt hơn 150 và 500 trên cả ba tập đo |
| `MAX_SLOPE_M` | 25 | độ dốc lớn hơn coi là dữ liệu lỗi |
| `PRIOR_SLOPE_M` | 3,2 | trung vị đo trên fixture (mục 2) |
| `FETCH_ANCHORS` | 200 | trần số mốc mỗi truy vấn |

### 4.3 Thuật toán

Với số cần tìm `n`, chẵn/lẻ `p = n mod 2`:

1. **Gán mốc vào tuyến.** Mỗi mốc chiếu lên mọi nhánh của mọi tuyến cùng tên; nhận nhánh gần nhất nếu
   khoảng cách ≤ `ASSIGN_MAX_M`, được `(tuyến, nhánh, m, bên)` với `m` là mét dọc nhánh, `bên` là dấu
   tích có hướng (trái/phải theo chiều vẽ nhánh). Mốc không gán được vẫn giữ cho bước 2b.
2. **Nội suy (`interpolated`).**
   a. Trong từng tuyến: `lo` = mốc cùng `p` có số lớn nhất < `n`, `hi` = nhỏ nhất > `n`; loại cặp
   cách nhau (đường chim bay) > `BRACKET_GAP_M`. Mỗi tuyến tối đa một cặp; giữa các tuyến ưu tiên
   theo thứ tự ở bước 5. Cùng nhánh: điểm = vị trí `m_lo + t·(m_hi − m_lo)` trên nhánh, `t` =
   `(n − lo)/(hi − lo)`. Khác nhánh: nội suy thẳng giữa hai mốc.
   b. Không tuyến nào có cặp: kẹp trên toàn bộ mốc cùng tên (kể cả mốc chưa gán được) như hiện
   nay, ngưỡng `BRACKET_GAP_M`, nội suy thẳng giữa hai mốc; `streetId: null`.
3. **Ngoại suy (`extrapolated`)** khi bước 2 không ra kết quả cho tuyến đó:
   - `a*` = mốc cùng `p` đã gán có `|hn − n|` nhỏ nhất (hoà thì lấy mốc gần tuyến hơn).
   - Độ dốc `s` (m/số, có dấu) = Theil–Sen trên tối đa `EXTRAP_K` mốc cùng `p`, cùng tuyến, cùng
     nhánh với `a*`, gần `n` nhất theo số (≥ 2 số khác nhau). Thiếu thì dùng mốc khác chẵn/lẻ cùng
     nhánh.
   - Vẫn thiếu thì `s = ±PRIOR_SLOPE_M`, dấu theo quy ước **lẻ trái, chẵn phải** khi đi theo chiều
     số tăng: mốc `a*` lẻ nằm bên trái chiều vẽ ⇒ số tăng theo chiều vẽ, v.v.
   - Bỏ nếu `|s| > MAX_SLOPE_M` hoặc `|(n − hn*)·s| > EXTRAP_CAP_M`. Điểm = vị trí
     `m* + (n − hn*)·s` trên nhánh của `a*`, kẹp trong `[0, chiều dài nhánh]`.
4. **Không có kết quả điểm:** `streetEvidence` — tuyến có nhiều mốc đã gán nhất (hoà: id nhỏ hơn),
   điểm trên tuyến gần trọng tâm các mốc của nó; không mốc nào gán được mà có mốc cùng tên ⇒ mốc
   medoid (gần trung vị toạ độ nhất), `streetId: null`; không có mốc ⇒ `null`, `geocode.ts` gọi
   `stepStreet` như hiện nay. Kết quả mang `precision: 'street'`, `confidence: 0.4`, `bbox` là hộp
   bao của **cả** dòng `street` (lấy trong cùng truy vấn ở 4.4, không phải phần đã cắt); medoid thì
   không có `bbox`.
5. **Nhiều kết quả.** Mỗi tuyến tối đa một kết quả; kết quả kẹp toàn cục (2b) chỉ có khi không tuyến
   nào có kết quả nội suy. Tổng ≤ `limit`. Thứ tự khi **không** có `near`: nội suy theo tuyến
   (khoảng số `hi − lo` hẹp trước, hoà thì khoảng cách hai mốc ngắn trước), rồi kẹp toàn cục, rồi
   ngoại suy (`|n − hn*|` nhỏ trước), hoà thì id tuyến nhỏ trước — phần tử đầu trùng lựa chọn của
   biến thể đã đo trong bản thử nghiệm. Khi **có** `near`: khoảng cách tới `near` tăng dần, hoà thì
   theo thứ tự trên.

### 4.4 Truy vấn DB

Một truy vấn cho bước 3/3b/4 (thay 1–2 truy vấn của `stepInterpolate` hiện nay), cùng bộ lọc phạm
vi hành chính (`wardNorms`, `provinceNorm`, `oldArea`) như các bước khác:
- `address_anchor` cùng `street_norm` trong phạm vi, `alley_chain = '{}'`, `housenumber` khớp
  `INTEGER_HOUSE_NUMBER_PATTERN` (ép `::int` sau khi lọc, như `stepInterpolate` hiện nay), xếp theo
  `|số − n|` tăng dần, `LIMIT FETCH_ANCHORS`.
- `street` cùng `name_norm` trong phạm vi: `id`, hộp bao của cả dòng, và `ST_AsGeoJSON` của
  `ST_LineMerge(geom)` cắt bằng `ST_ClipByBox2D` quanh hộp bao của các mốc lấy được, nới 500 m;
  tuyến không giao hộp bao đó bị bỏ (mốc cách tuyến ≤ 150 m luôn nằm trong hộp đã nới).

Không có mốc nào ⇒ không cần hình học; đi thẳng `stepStreet`. Tổng số lượt gọi DB của một geocode
**không tăng** so với hiện nay.

### 4.5 Kết quả trả về

`GeocodeItem` giữ nguyên cấu trúc. `matched` và `display_name` dựng như bước 3 hiện nay (số nhà,
đường, phường theo `currentWardName`, tỉnh, `former`). Với "Hẻm 150 X": `matched` không có
`housenumber`; `display_name` = `"<Hẻm|Ngõ|Ngách|Kiệt> 150 <tên đường>, <phường>, <tỉnh>"` theo
`alleyKeyword`.

### 4.6 Hợp đồng công khai và docs

- `packages/core/src/types.ts`: thêm `| 'extrapolated'` sau `'interpolated'`. `@mapslibvn/core`,
  `web`, `react`, `react-native` lên 0.16.0.
- `do-chinh-xac.md`: thêm dòng `extrapolated` vào bảng mục 1; sửa dòng `interpolated` (cùng tuyến,
  ≤ 800 m) và `street` (ưu tiên tuyến có mốc); mục 3 — `extrapolated` vẽ vòng khoảng 150 m, luôn cho
  người dùng xác nhận; mục 4 — giới hạn của ngoại suy (mục 10 dưới đây).
- `api.md`: union `GeocodePrecision` và ghi chú "thêm giá trị mới".
- `sdk.md`: mục "Nâng từ 0.15.x lên 0.16.0" theo mẫu 0.2.0.
- Playground: `PRECISION_RADIUS.extrapolated = 150`, test đi kèm.
- Spec gốc mục 6.3: sửa dòng 3, thêm dòng 3b, sửa dòng rủi ro `:609`, trỏ về spec này.

## 5. Ca biên và xử lý lỗi

- Số nhà có chữ hoặc dải: "12A" định vị như 12, "47-57" như 47 (`parseInt`), giống hiện nay. Mốc chỉ
  dùng làm điểm tựa khi số là số nguyên thuần.
- Hai mốc cùng số khác vị trí (gộp 30 m ở pipeline vẫn còn sót): Theil–Sen bỏ qua cặp cùng số; nội
  suy lấy mốc thứ tự đầu.
- Tuyến một điểm hoặc nhánh dài 0: không chiếu được ⇒ coi như mốc không gán.
- Độ dốc âm/dương đều hợp lệ (chiều vẽ nhánh tuỳ OSM). `s = 0` (mốc cùng vị trí) ⇒ điểm = mốc.
- `limit` > số tuyến: trả ít hơn, không lặp tuyến.
- Lỗi DB: như hiện nay (`503 upstream_unavailable`). Module thuần không ném lỗi với đầu vào rỗng —
  trả mảng rỗng / `null`.

## 6. Kiểm thử

- **Unit** `apps/api/test/house-number.test.ts` (vitest, không DB), đường tổng hợp trong toạ độ
  thật quanh Quận 1: nội suy cùng nhánh; khác nhánh; ngưỡng 800 m (799/801); ngoại suy Theil–Sen;
  độ dốc từ mốc khác chẵn/lẻ; độ dốc tiên nghiệm cả hai chiều vẽ nhánh; chặn 300 m (299/301) và
  25 m/số; kẹp đầu nhánh; kẹp toàn cục khi mốc không gán được; `streetEvidence` (nhiều mốc nhất,
  medoid, không mốc); thứ tự nhiều tuyến có/không có `near`.
- **Unit** `apps/api/test/geocode.test.ts`: câu SQL mới có bộ lọc phạm vi, `LIMIT`, không truy vấn
  hình học khi không có mốc; nhánh "Hẻm N X"; các test cũ giữ xanh.
- **DB integration** `apps/api/test-db/setup.sql` + `places.itest.mjs`: thêm fixture một ca
  `extrapolated`, hai tuyến trùng tên (không truyền `near`, kết quả đầu là tuyến có mốc), "Hẻm N X"
  ra `alley`; giữ xanh "88/9 Nguyễn Lâm" (`interpolated`, ≤ 60 m) và mọi test hiện có.
- **Bench** `scripts/geocode-bench.mjs` (chạy tay trên DB dev, không chạy trong CI): gọi `geocode()`
  thật, tái lập đúng cách lấy mẫu của `waze_re/geocode_bench/proto/proto.test.mjs` để số "trước" ở
  mục 7 so được:
  - mốc đánh giá (đọc `ORDER BY id`): nguồn `osm`, `alley_chain = '{}'`, số bắt đầu bằng chữ số,
    tên đường có trong `street`; truy vấn = `"<số> <name của dòng street id nhỏ nhất cùng
    name_norm>"`, không `near`;
  - xoá 1 mốc: 300 mốc xáo bằng `mulberry32(42)`, xoá mọi mốc cùng đường + cùng số;
  - giữ 20% / 5%: trên đường có ≥ 10 mốc, giữ mỗi nhóm (đường + số) với xác suất 0,2 / 0,05
    (`mulberry32(20)` / `mulberry32(5)`, duyệt nhóm theo thứ tự khoá), đánh giá 300 mốc của các nhóm
    bị xoá (`mulberry32(1020)` / `mulberry32(1005)`);
  - thêm bộ 60 truy vấn có mốc (có dấu, không dấu) và bộ truy vấn khó của `bench.test.mjs`.

  Mọi lệnh xoá nằm trong transaction rồi `ROLLBACK`. Ghi JSON + bảng markdown vào
  `docs/evidence/so-nha/` — một bản trước khi sửa, một bản sau.

## 7. Tiêu chí nghiệm thu

Bench trên DB dev, không `near`, so với bản trước khi sửa chạy cùng script:

| Tập | Trước (thử nghiệm đo) | Phải đạt |
|---|---|---|
| Xoá 1 mốc | trung vị 50 m, p90 464 m, 26 ca > 500 m | trung vị ≤ 35 m, p90 ≤ 200 m, ≤ 15 ca > 500 m |
| Giữ 20% | trung vị 114 m, p90 1.608 m | trung vị ≤ 65 m, p90 ≤ 550 m |
| Giữ 5% | trung vị 249 m, p90 2.744 m | trung vị ≤ 125 m, p90 ≤ 950 m |

Và:
1. 60/60 truy vấn có mốc (có dấu và không dấu) vẫn `rooftop`, lệch 0 m.
2. "Hẻm 150 Nguyễn Trãi" không trả `street`.
3. p95 thời gian `geocode()` trên tập xoá 1 mốc ≤ 25 ms trên DB dev.
4. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:api-db` xanh.

## 8. Phát hành

1. Làm và commit thẳng trên `main` trong checkout chung. Trên máy có phiên khác cũng commit vào
   `main`: chỉ `git add` đúng file của việc này, xem `git status` trước mỗi commit.
2. Trước khi push: liệt kê `git log origin/main..main` cho PHONG. Push `main` chạm `apps/api/**`
   hoặc `packages/core/**` tự deploy API production (`deploy-api.yml`, có cổng `apitest`); chạm
   `apps/docs/**` hoặc `packages/{core,web,react}/**` tự deploy docs (`deploy-docs.yml`). Commit của
   phiên khác nằm trong danh sách thì PHONG quyết định đẩy chung hay chờ. Không dùng `gh` (đang đăng
   nhập tài khoản công ty).
3. Sau deploy: smoke `/v1/geocode` trên production — một địa chỉ có mốc (`rooftop`), "Hẻm 150 Nguyễn
   Trãi", một số nhà nằm ngoài dải mốc.
4. Nâng 4 gói SDK lên 0.16.0; publish npm do PHONG làm.
5. DEVLOG: mục ngày 26/09 và dòng quyết định (ngưỡng 800 m, `extrapolated`, bỏ lệch bên đường).

## 9. Ngoài phạm vi — đề xuất làm sau

- **Chuẩn hoá tên đường của mốc FSQ trong pipeline** (bỏ "st", "street", tên thành phố bị nhận nhầm
  là đường): thêm khoảng 6.000 mốc dùng được trên riêng fixture Quận 1. Là code pipeline nên mỗi lần
  `data:update` hoặc dựng máy mới đều tự áp lại. Spec nhỏ riêng.
- `/v1/reverse` dùng cùng mô hình ("≈ 86–90").
- Vùng đánh số lại theo quận (Trường Chinh), cần dữ liệu quận cũ đầy đủ hơn fixture.
- Dự án con 2 phải lưu ghim xác nhận trong DB có backup hằng ngày và sống qua `data:update` (như mốc
  `source='user'`); máy chủ thay thế phải dựng bằng `server:restore`, không chỉ `server:setup`.

## 10. Rủi ro và giới hạn đã biết

- **Ngoại suy kém chắc hơn nội suy nhiều:** trong bản thử nghiệm, trung vị 58–78 m nhưng p90
  530–750 m; khi số cần tìm cách mốc ≤ 5 số thì trung vị 26–53 m, p90 khoảng 130 m. Sai số lớn đến từ
  chọn nhầm mốc hoặc tuyến, không phải từ khoảng ngoại suy. Docs phải nói rõ `extrapolated` là điểm
  gợi ý để người dùng xác nhận.
- **Đường trùng tên trong cùng tỉnh** (Phạm Viết Chánh ở Bình Thạnh và Quận 1): không có `near` hay
  phường thì không phân biệt được — trả nhiều kết quả (mục 4.3 bước 5) để app cho người dùng chọn.
- **Đánh số lại theo quận** (Trường Chinh): ngoại suy có thể lệch vài km; chặn 300 m hạn chế một
  phần, phần còn lại để việc sau.
- Số liệu mục 7 đo trên fixture Quận 1 — nơi dữ liệu dày nhất nước; truy vấn có phường hoặc `near`
  (thường gặp thực tế) chưa được đo.
- `PRIOR_SLOPE_M` và tỉ lệ quy ước lẻ trái/chẵn phải đo trên Quận 1; đô thị khác có thể khác. Cần đo
  lại khi có DB production đủ dữ liệu toàn quốc.
