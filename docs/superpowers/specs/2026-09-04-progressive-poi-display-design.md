# Spec — Hiển thị POI tăng dần theo mức zoom

Ngày: 04/09/2026. Trạng thái: PHONG đã duyệt tài liệu; implementation plan:
`docs/superpowers/plans/2026-09-04-progressive-poi-display.md`.

## 1. Vấn đề

Lớp `poi` hiện dùng `quality_score` đã bucket thành `q` để quyết định POI nào có mặt ở từng zoom
và để ưu tiên collision. Cách này làm lẫn hai khái niệm:

- `quality_score`: bản ghi đầy đủ và đáng tin đến đâu;
- độ nổi bật khi vẽ bản đồ: địa điểm có đáng chiếm chỗ trên màn hình ở zoom hiện tại không.

Pipeline hiện cho mọi POI active vào z15–16. Bản production gần nhất có hơn 1,5 triệu POI active,
nên ở đô thị dày đặc bản đồ gần như phủ kín icon dù `icon-allow-overlap=false`. Taxonomy đã có
`category.rank` (1 là hiện sớm nhất), và bảng `poi` đã có `popularity`, nhưng hai tín hiệu này chưa
được đưa vào vector tile.

## 2. Mục tiêu và ngoài phạm vi

### Mục tiêu

1. Bản đồ mặc định sạch, ưu tiên địa danh quan trọng và tăng chi tiết đều khi zoom vào.
2. Cùng một dữ liệu đầu vào luôn chọn cùng POI; pan qua biên tile không làm thứ tự ưu tiên thay đổi.
3. Giữ nguyên `poiClick`, `PoiFeature`, `poiLayer` và source-layer công khai `poi` trên Web/React/
   React Native.
4. POI không được vẽ mặc định vẫn tìm được qua Places API và có thể được ứng dụng ghim bằng marker.
5. Không thêm migration hay cột DB: toàn bộ dữ liệu hiển thị là dẫn xuất từ `category.rank`,
   `poi.popularity`, `poi.quality_score` và `poi.id` trong lúc build tile.
6. Giữ archive POI tối đa 300 MiB và maxzoom 16.

### Ngoài phạm vi

- Không làm cluster bubble kiểu “128 địa điểm”.
- Không cá nhân hoá theo người dùng, thời gian, lịch sử tìm kiếm hoặc quảng cáo.
- Không đổi thuật toán Places API, taxonomy, conflation, geocode hoặc điểm `popularity` hiện có.
- Không hứa hiển thị mọi POI trên bản đồ nền, kể cả ở z16. Search/nearby là đường tìm đầy đủ.
- Không chạy national build hoặc publish production trong cùng task implementation đầu tiên; việc đó
  là một cổng nghiệm thu riêng vì mất nhiều thời gian và thay manifest thật.

## 3. Các phương án đã cân nhắc

### A. Chỉ siết style

Tăng minzoom, dời nhãn và tăng collision padding. Nhanh nhưng vẫn dùng `q` sai vai trò, tile vẫn
mang quá nhiều ứng viên và kết quả phụ thuộc mạnh vào thứ tự nguồn. Không chọn làm giải pháp cuối.

### B. Cluster bubble

Gộp POI thành số đếm. Hợp với dashboard dữ liệu nhưng không hợp bản đồ nền/điều hướng và che mất
loại địa điểm. Không chọn.

### C. Progressive POI bằng priority + lưới toàn cục

Tính priority ổn định, chọn tối đa một POI trong mỗi ô Web Mercator theo zoom, gắn minzoom riêng
cho feature rồi để MapLibre xử lý collision cuối cùng. Chọn phương án này vì kiểm soát được mật độ
từ nguồn, không phụ thuộc biên tile và dùng được chung cho Web lẫn Native.

## 4. Contract vector tile

Source và source-layer giữ tên `poi`. Mỗi feature được giữ lại có các property:

| Property | Kiểu | Ý nghĩa |
|---|---:|---|
| `id` | string | ID POI hiện tại |
| `name` | string | tên hiển thị |
| `cat` | string | mã category |
| `grp` | string | mã nhóm |
| `q` | integer 0–9 | bucket `quality_score`, giữ tương thích/QA |
| `r` | integer 1–5 | `category.rank`; thiếu/sai thì dùng 5 |
| `d` | integer | display priority toàn phần; số thấp được ưu tiên |

`popularity` không xuất thô để tránh phình tile và không vô tình biến nó thành API công khai.

### 4.1 Công thức priority

```text
q = clamp(floor(coalesce(quality_score, 0) / 10), 0, 9)
p = clamp(floor(coalesce(popularity, 0) * 2), 0, 9)
base = (r - 1) * 100 + (9 - p) * 10 + (9 - q)
tie = first12Bits(md5(utf8(id)))
d = base * 4096 + tie
```

Thứ tự do đó là category rank trước, popularity sau, quality cuối; 12 bit đầu của MD5 ID chỉ phá
hoà một cách ổn định. Đây không phải cách dùng MD5 cho bảo mật. PostgreSQL `md5(text)` quyết định
thứ tự cursor, còn Node `createHash('md5')` tạo cùng giá trị cho property `d`; fixture phải khoá hai
phía vào cùng vector. Không dùng `Math.random`, `localeCompare` hay hash phụ thuộc tiến trình.

### 4.2 Zoom sớm nhất theo category

| `r` | Zoom sớm nhất được xét |
|---:|---:|
| 1 | 10 |
| 2 | 12 |
| 3 | 13 |
| 4 | 14 |
| 5 | 15 |

Đây là zoom sớm nhất được **xét**, không bảo đảm feature được chọn; spatial thinning có thể dời nó
lên zoom cao hơn hoặc loại khỏi archive.

## 5. Spatial thinning xác định

Exporter dẫn xuất `r`, `p`, `q`, `tie` ngay trong SELECT và đọc POI active theo thứ tự toàn phần:

```text
derived r ASC,
derived p DESC,
derived q DESC,
derived tie ASC,
poi.id ASC
```

Với mỗi feature, chuyển lon/lat sang pixel Web Mercator toàn cục tại từng zoom, rồi lấy key:

```text
cellX = floor(globalPixelX / cellPx[zoom])
cellY = floor(globalPixelY / cellPx[zoom])
key = zoom + ":" + cellX + ":" + cellY
```

`lat` được clamp vào biên Web Mercator ±85,05112878°. Kích thước ô:

| Zoom | `cellPx` | Mục đích |
|---:|---:|---|
| 10 | 160 | chỉ địa danh lớn, rất thưa |
| 11 | 160 | giữ ổn định khi bắt đầu zoom thành phố |
| 12 | 144 | thêm rank 2 |
| 13 | 128 | thêm rank 3 |
| 14 | 112 | cấp khu phố |
| 15 | 96 | địa điểm địa phương |
| 16 | 80 | chi tiết tối đa của archive |

Mỗi ô nhận tối đa một feature. Feature được xét từ zoom sớm nhất theo `r` đến z16. Với một zoom ứng
viên `z`, selector kiểm tra **tất cả** ô của feature từ `z..16`; chỉ khi toàn bộ còn trống, `z` mới
trở thành `tippecanoe.minzoom` và selector giữ chỗ trong toàn bộ các ô đó. Nếu chuỗi này chưa trống,
selector thử `z+1`. Nếu không có chuỗi ô trống nào đến z16, feature không vào archive. Quy tắc này
bảo đảm feature đã xuất hiện không biến mất khi zoom vào và quota một feature/ô không bị phá ở zoom
cao. Lưới dùng toạ độ toàn cục, không reset theo tile, nên không tạo dải dày ở biên.

Exporter phải streaming theo priority và chỉ giữ các `Set` cell key trong bộ nhớ; không nạp toàn bộ
POI thành object. GeoJSONSeq dùng extension top-level:

```json
{"type":"Feature","tippecanoe":{"minzoom":13},"properties":{"id":"…","name":"…","cat":"museum","grp":"culture_tourism","q":8,"r":1,"d":1234},"geometry":{"type":"Point","coordinates":[106.7,10.77]}}
```

Tippecanoe vẫn chạy `-Z10 -z16 -r1 --drop-densest-as-needed` như lưới an toàn kích thước tile,
nhưng bỏ feature-filter cũ dựa trên `q`. Minzoom trên từng feature là nguồn chân lý về zoom.

## 6. Style và hành vi SDK

Style sinh ba layer cùng source/source-layer `poi`, đặt trước `sovereignty-label`:

1. `poi` — icon của mọi feature được chọn; giữ nguyên ID để `poiClick` trên Web/Native không đổi.
   Dùng `symbol-sort-key` ưu tiên `d` (fallback sang `9-q` cho archive cũ),
   `icon-allow-overlap:false`, `icon-padding:8` và không chứa `text-field`.
2. `poi-label-major` — text cho `r <= 2`, minzoom 12, `text-padding:4`, sort theo `d`.
3. `poi-label-local` — text cho `r >= 3`, minzoom 16, `text-padding:4`, sort theo `d`.

Tách layer và dùng padding hằng số vì data-driven `icon-padding` chưa có hỗ trợ đồng đều trên
MapLibre Native. Nhãn vẫn dùng `Noto Sans Regular`, theme light/dark giữ màu và halo hiện tại.

Các thay đổi tương thích bắt buộc:

- `hidePoiLayer()` phải ẩn cả ba layer; `poiLayer:false` không được để sót nhãn.
- Web và React Native tiếp tục query chỉ layer `poi`, nên một lần bấm chỉ phát một `poiClick`.
- `localizeStyle()` tiếp tục đổi `text-field` của hai layer nhãn sang `name:vi`/`name:en` khi có;
  tile hiện chỉ có `name`, vì vậy fallback vẫn là tên hiện tại.
- Khi manifest không có POI, Worker tiếp tục bỏ source `poi` và mọi layer có `source:'poi'`.
- Không thêm field vào `PoiFeature` hay response Places API.
- Mọi filter theo rank phải dùng `coalesce(r, 5)`. Nhờ hai fallback này, style mới vẫn render được
  archive cũ khi rollback manifest; archive cũ trở lại mật độ cũ nhưng không làm bản đồ trắng.

## 7. Lỗi và tính an toàn

- Rank ngoài 1–5 hoặc null: dùng 5; popularity không hữu hạn/null: dùng 0; quality null: dùng 0.
- Toạ độ không hữu hạn hoặc ngoài lon hợp lệ: bỏ feature, tăng bộ đếm cảnh báo; nếu có bất kỳ bản
  ghi active bị bỏ vì toạ độ sai thì exporter kết thúc mã lỗi khác 0 sau khi ghi báo cáo, không
  publish archive bán phần.
- Nếu bước chọn mật độ hoặc Tippecanoe lỗi, `data:update` giữ manifest hiện tại; không fallback sang
  “hiện tất cả”.
- Các bộ đếm phải được log: active đọc, feature được giữ, feature bị thinning, số theo minzoom,
  rank fallback và toạ độ lỗi.
- Giữ kiểm tra archive ≤300 MiB và không dùng `--extend-zooms-if-still-dropping`.

## 8. Kiểm thử và nghiệm thu

### Unit/contract

- Priority: clamp, thứ tự rank/popularity/quality, hash ổn định và tie-break bằng ID.
- Web Mercator cell: tâm, biên, lat clamp, hai điểm cùng/khác ô.
- Selector: một POI mỗi ô, feature quan trọng thắng, feature có thể xuất hiện ở zoom sau, kết quả
  không đổi khi chia input thành các chunk của cursor.
- `featureLine`: đủ `q/r/d`, đúng top-level `tippecanoe.minzoom`.
- Style: ba layer đúng thứ tự/filter/minzoom/padding; `poi` giữ ID; style-spec hợp lệ.
- Core/Web/Native: ẩn POI ẩn cả ba layer, đổi ngôn ngữ không hỏng filter, click vẫn query `poi`.
- API style: manifest có POI trả ba layer; manifest thiếu POI không trả source/layer nào.

### Fixture tile

Build fixture có cụm POI cạnh nhau với nhiều rank/popularity/quality, decode z10–16 và xác nhận:

- không ô nào vượt một feature theo lưới thiết kế;
- POI rank cao hơn thắng khi cùng ô;
- minzoom tăng đúng và feature được giữ ở mọi zoom sau minzoom;
- feature bị ẩn vẫn có trong DB/search fixture;
- archive vẫn có layer `poi`, maxzoom 16 và các property mới.

### Visual/browser

Chụp cùng viewport 1000×800 tại TP.HCM, Hà Nội, Đà Nẵng và một vùng nông thôn ở z10, z12, z14,
z15, z16 cho cả light/dark. Nghiệm thu khi:

- không có icon/nhãn overlap;
- feature đã có ở zoom thấp vẫn có trong tile ở mọi zoom cao; visual smoke không có hiện tượng POI
  quan trọng biến mất có hệ thống do feature mới tranh collision;
- địa danh rank 1–2 thắng địa điểm địa phương khi cạnh nhau;
- nhãn địa phương chỉ xuất hiện từ z16;
- pan qua biên tile không tạo dải icon hoặc thay POI ưu tiên bất thường;
- `poiClick`, `poiLayer=false`, vi/en và playground hoạt động trên Web; smoke tương đương chạy trên
  React Native fixture/style transform.

Số POI hiển thị là chỉ số quan sát, không phải golden tuyệt đối vì collision còn phụ thuộc nhãn nền.
Ghi số trước/sau cho từng viewport vào DEVLOG để tuning sau có baseline.

## 9. Triển khai theo lớp và rollback

Implementation plan phải tách ít nhất ba commit độc lập:

1. Priority + selector + fixture tests trong pipeline, chưa đổi style production.
2. Contract tile/style/core/Web/Native tests và tài liệu.
3. Build fixture + visual acceptance; sau khi PHONG duyệt ảnh mới chạy national build/publish.

Rollback production chỉ cần đưa manifest về archive POI trước đó vì style có fallback cho tile thiếu
`r/d`. Tuy vậy, deployment API/style và manifest POI mới vẫn phải được phát hành cùng một release
window để tránh giai đoạn tạm thời quay lại mật độ cũ. Trước khi đổi manifest, production style phải
được smoke với archive mới trên URL staging hoặc local override. Không xoá archive cũ khỏi R2.

## 10. Tài liệu cần cập nhật khi triển khai

- `docs/DEVLOG.md`: quyết định, số lượng trước/sau, dung lượng và bằng chứng visual.
- `docs/superpowers/plans/2026-08-27-m2-kho-poi-may-chu.md`: không sửa checkbox lịch sử; chỉ thêm
  ghi chú liên kết sang spec mới nếu cần giải thích spec 5.8 đã được thay thế.
- `pipelines/poi/README.md`: contract `q/r/d`, minzoom và log thinning.
- Trang `/tinh-nang/`, `/ban-do-web/`, `/react-native/`: mô tả nhãn tăng dần theo zoom, không ghi
  cứng behavior cũ “nhãn POI từ zoom 13”.

## 11. Tham chiếu kỹ thuật

- MapLibre Style Spec, symbol priority/collision/padding:
  <https://maplibre.org/maplibre-style-spec/layers/>
- Tippecanoe GeoJSON extension `tippecanoe.minzoom`:
  <https://github.com/felt/tippecanoe/blob/main/README.md#geojson-extension>
