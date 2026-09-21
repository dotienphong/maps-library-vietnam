---
title: Tìm kiếm & autocomplete
description: Web component <mapslibvn-autocomplete> và bốn phương thức tìm kiếm của client Places — autocomplete, search, nearby, getPlace — dùng cái nào khi nào.
---

MapsLibVN có hai đường để tìm địa điểm: một web component gắn vào là chạy, và client
`@mapslibvn/core` để tự dựng giao diện. Trang này đi hết cả hai.

## 1. Web component `<mapslibvn-autocomplete>`

Bản UMD tự gọi `defineAutocomplete()` khi nạp, nên chỉ cần đặt thẻ vào HTML:

```html
<link rel="stylesheet" href="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.css" />
<script src="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.umd.js"></script>

<mapslibvn-autocomplete
  id="ac"
  api-key="mlv_live_…"
  api-base="https://api.ai-solutions.io.vn"
  placeholder="Tìm quán cà phê…"
></mapslibvn-autocomplete>

<script>
  const map = MapsLibVN.createMap({
    container: 'map',
    apiKey: 'mlv_live_…',
    apiBase: 'https://api.ai-solutions.io.vn',
  });
  const ac = document.getElementById('ac');
  ac.map = map; // dùng cùng Places client/poiSources và lấy tâm bản đồ làm `near`
  ac.addEventListener('select', (event) => {
    const item = event.detail;
    map.flyTo([item.lng, item.lat], 16);
    map.addMarker({ lng: item.lng, lat: item.lat, popupHtml: item.name });
  });
</script>
```

Dùng bản ESM thì phải tự đăng ký một lần:

```ts
import { defineAutocomplete } from '@mapslibvn/web';
defineAutocomplete();
```

`defineAutocomplete()` bỏ qua nếu tên `mapslibvn-autocomplete` đã được đăng ký, nên gọi nhiều lần
vẫn an toàn.

## 2. Thuộc tính, sự kiện

| Thuộc tính HTML | Bắt buộc | Ý nghĩa |
|---|---|---|
| `api-key` | có | Khoá `mlv_live_…` |
| `api-base` | có | Gốc API |
| `placeholder` | không | Mặc định `Tìm địa điểm…` |
| `near` | không | Chuỗi `"lat,lng"` — **vĩ độ trước**, khác thứ tự `center` của bản đồ |
| `sources` | không | Nguồn POI cho chế độ standalone. Khi đã gán `.map`, component dùng `map.places` nên tự kế thừa `poiSources` của map |

Đổi `api-key` hoặc `api-base` lúc chạy sẽ tạo lại client và huỷ truy vấn đang chờ. Nếu thiếu một
trong hai, component thông báo "Thiếu cấu hình API." và không gọi mạng.

| Thuộc tính JS | Ý nghĩa |
|---|---|
| `.map` | Gán đối tượng trả về từ `createMap`. Component dùng `map.places` để bản đồ và autocomplete có cùng `poiSources`; `near` lấy từ `map.gl.getCenter()` ở **mỗi lần truy vấn**. Cấu hình của map được ưu tiên hơn `api-key`, `api-base`, `sources` và `near` trên element |

Đổi hoặc gỡ `.map` sẽ huỷ kết quả truy vấn đang chờ. Khi `.map = null`, component quay lại client
standalone lấy từ các thuộc tính HTML.

| Sự kiện | `detail` |
|---|---|
| `select` | `AutocompleteItem` — `{ type, id?, name, secondary, lat, lng, precision?, score, bbox? }`. `bubbles: true`, `composed: true` nên bắt được ở phần tử cha |

Khi chọn, component tự điền `item.name` vào ô nhập và đóng danh sách.

## 3. Hành vi gõ và bàn phím

- **Ít nhất 2 ký tự** sau khi cắt khoảng trắng thì mới gọi API; ngắn hơn thì danh sách được xoá.
- **Debounce 300 ms** kể từ lần gõ cuối.
- **Đệm 20 truy vấn gần nhất trong phiên.** Gõ thêm một dấu cách (chuỗi gửi đi không đổi) hoặc gõ
  lùi về chuỗi vừa hỏi xong thì gợi ý hiện ra ngay và **không tốn lượt Places**. Đệm nằm trong bộ
  nhớ của trang, mất khi tải lại.
- Mỗi truy vấn mang số thứ tự riêng; kết quả về muộn của truy vấn cũ bị bỏ qua, không ghi đè kết quả
  mới.
- Component gọi `autocomplete(q, { near })` với thiết lập mặc định của API: tối đa 10 gợi ý và
  **cả bốn** `types` (`poi`, `street`, `address`, `area`). Muốn khác thì tự dựng giao diện bằng
  client ở mục 5, ví dụ `types: ['poi', 'street', 'address']` để trở về bộ loại trước khi có `area`.
- Mỗi gợi ý có một ký hiệu phân biệt loại ở đầu dòng; vùng hành chính (`area`) dùng ký hiệu khác POI.

| Phím | Tác dụng |
|---|---|
| `ArrowDown` / `ArrowUp` | Di chuyển trong danh sách, chạy vòng từ cuối về đầu |
| `Enter` | Chọn mục đang được đánh dấu. Không có mục nào đánh dấu thì không làm gì |
| `Escape` | Đóng danh sách và huỷ truy vấn đang chờ |

Rời ô nhập (`blur`) thì danh sách đóng sau 150 ms — đủ để cú bấm chuột vào một gợi ý kịp chạy.

### Chọn một vùng hành chính

Gợi ý `type: 'area'` mang thêm `bbox`, nên hãy khớp khung nhìn theo cả vùng thay vì bay tới một
điểm. Vùng không có `id`, vì vậy **không** gọi `getPlace()` cho nó.

```html
<mapslibvn-autocomplete id="ac" api-key="mlv_live_…" api-base="https://api.ai-solutions.io.vn">
</mapslibvn-autocomplete>
<script type="module">
  document.getElementById('ac').addEventListener('select', (event) => {
    const item = event.detail;
    if (item.type === 'area' && item.bbox) map.fitBounds(item.bbox);
    else map.flyTo([item.lng, item.lat], 16);
  });
</script>
```

`bbox` theo thứ tự `[minLng, minLat, maxLng, maxLat]` — đúng thứ tự `MapsLibVNMap.fitBounds()` nhận.

Về khả năng tiếp cận: ô nhập là `role="combobox"` với `aria-autocomplete="list"`, `aria-expanded`,
`aria-controls` và `aria-activedescendant`; danh sách là `role="listbox"` chứa các `role="option"`
có `aria-selected`; một vùng `role="status" aria-live="polite"` đọc "Đang tìm…", "Có N kết quả.",
"Không tìm thấy kết quả." hoặc "Đã chọn …".

Component dựng trong **shadow DOM** mở, nên CSS bên ngoài không chạm vào bên trong được. Kích thước
và vị trí chỉnh trên chính thẻ `<mapslibvn-autocomplete>` (thẻ này là `display: block`).

## 4. Tạo client Places

Nếu đã có bản đồ, dùng luôn `map.places` — đã mang sẵn khoá và gốc API. Nếu không:

```ts
import { createClient } from '@mapslibvn/core';

const client = createClient({
  apiKey: 'mlv_live_…',
  baseUrl: 'https://api.ai-solutions.io.vn',
});
```

`createClient` còn nhận `fetch` (tiêm bản `fetch` riêng cho test hoặc môi trường không có global),
`headers` (header thêm cho mọi request, ví dụ `X-Bundle-Id` cho khoá `mobile`; không ghi đè được
`X-Api-Key`) và `poiSources` (mặc định cả hai nguồn) — tập nguồn POI áp cho `autocomplete`, `search`,
`nearby`, `reverse` và `styleUrl`; `getPlace` và `geocode` không lọc theo nguồn.

Ba profile là mặc định cả hai (`all`), `['osm']` và `['fsq']`:

```ts
createClient({ apiKey, baseUrl, poiSources: ['osm'] });
createClient({ apiKey, baseUrl, poiSources: ['fsq'] });
```

POI người dùng luôn có trong mọi profile. Nếu archive riêng chưa phát hành, URL style vẫn trả được
archive `all` với `x-poi-profile: all;fallback`; các Places list route vẫn lọc theo nguồn đã yêu cầu.

## 5. `autocomplete` — gợi ý khi đang gõ

```ts
const { items } = await client.autocomplete('highlands', {
  near: [10.776, 106.7], // [lat, lng]
  limit: 5,              // 1–10, mặc định 10
  types: ['poi', 'address'],
});
```

Trả `{ items: AutocompleteItem[] }`, đã sắp xếp giảm dần theo `score`.

| Trường | Ý nghĩa |
|---|---|
| `type` | `'poi'` một địa điểm, `'street'` một tuyến đường, `'address'` một mốc số nhà, `'area'` một đơn vị hành chính |
| `id` | Chỉ có với `type: 'poi'`; truyền vào `getPlace(id)` để lấy chi tiết. `area` **không có** `id` |
| `name` | Dòng chính hiển thị |
| `secondary` | Dòng phụ — với POI là đường, phường, tỉnh ghép lại; với `area` là tên vùng cũ hoặc danh sách vùng mới |
| `lat`, `lng` | Toạ độ |
| `precision` | Với `type: 'address'` là `'rooftop'`; với `type: 'area'` là `'province'`, `'district'` hoặc `'ward'` |
| `bbox` | Chỉ có với `type: 'area'` — `[minLng, minLat, maxLng, maxLat]`, truyền thẳng vào `map.fitBounds()` |
| `matched_alt` | Chỉ có khi kết quả khớp qua **tên thay thế** (tên cũ, tên khác trên OSM): tên đó, còn dấu. Gõ `cong ly` ra "Nam Kỳ Khởi Nghĩa" kèm `matched_alt: "Công Lý"` |
| `score` | Điểm xếp hạng tổng hợp (độ giống tên, khoảng cách tới `near`, độ phổ biến, loại). Xấp xỉ 0–1, **chỉ dùng để so sánh trong cùng một lượt gợi ý**, không phải xác suất |

`q` phải từ 2 ký tự, nếu không API trả `400 invalid_request`. Kết quả được cache 10 phút theo truy
vấn đã chuẩn hoá và ô lưới của `near`, nên hai người gõ giống nhau ở cùng khu vực dùng chung kết
quả.

Khớp tên **chịu lỗi gõ nhẹ và đảo từ**: `higland`, `coffee highlands` hay `cho ray benh vien` vẫn
trả đúng địa điểm, vì API so truy vấn với **từng đoạn từ** của tên chứ không so cả chuỗi. Nhờ vậy
một từ nằm giữa tên rất dài cũng tìm được: gõ `skincode` ra "Showroom Skincode - Swiss Derma
Center". Truy vấn 2–3 ký tự khớp rất nhiều tên, nên thứ tự lúc đó chủ yếu do khoảng cách tới `near`
và độ phổ biến quyết định.

### Cách viết địa phương và tên cũ

Người Việt viết một địa danh theo nhiều cách, và nhiều tuyến đường vẫn được gọi bằng tên cũ. API
xử lý việc này theo **ba bậc**. Từ 08/09/2026 cả ba bậc chạy **song song** trong cùng một lượt —
mọi truy vấn được phát đi trước khi chờ cái nào, nên phần cộng vào độ trễ là bậc chậm nhất chứ
không phải tổng ba bậc.

| Bạn gõ | Ra | Nhờ đâu |
|---|---|---|
| `qui nhon` | Quy Nhơn | Từ điển biến thể địa danh, áp thẳng lên truy vấn ở **bậc 1** |
| `cong ly` | Nam Kỳ Khởi Nghĩa, kèm `matched_alt: "Công Lý"` | Tên thay thế của tuyến đường lấy từ OSM (**bậc 1**) |
| `nghia khoi bac` | Bậc Hai Khởi Nghĩa | **Bậc 2**: mọi từ khớp tiền tố, không kể thứ tự |
| `bin than`, `kontum` | Bình Thạnh, Kon Tum | **Bậc 3**: khoá ngữ âm, gộp các cách phát âm và cách viết dính/tách từ |

Khoá ngữ âm gộp những khác biệt thường gặp: `ch`/`tr`, `x`/`s`, `d`/`gi`/`r`, `ph`→`f`, `i`/`y`, và
âm cuối `-ng`/`-n`, `-t`/`-c`. Nó gộp được dính/tách từ trong **cùng một tên** (`nha trang` ↔
`nhatrang`), nhưng không phải mọi cách viết dính đều gộp.

Bậc 2 chỉ có dữ kiện để chạy khi truy vấn từ **hai token** trở lên; bậc 3 chạy khi truy vấn tạo
được khoá ngữ âm. Điểm của kết quả bậc sau bị trừ **0,05 mỗi bậc**, nên khi bậc 1 đã có kết quả
tương đương thì kết quả đó vẫn đứng trước — bậc sau chỉ nổi lên khi bậc trước không có gì tương
đương.

Phiên bản trước 08/09/2026 chỉ chạy bậc sau khi bậc trước trả **thiếu** `limit`. Đo trên dữ liệu
thật cho thấy bậc 1 luôn lấp đủ 10 suất nên bậc 2 và 3 gần như không bao giờ chạy; vì vậy điều
kiện đó đã bị bỏ. Nếu ứng dụng của bạn từng dựa vào việc "gõ sai thì không ra gì", hãy đọc lại
`score` thay vì số lượng kết quả.

## 6. `search` — tìm theo tên, loại hoặc vùng

```ts
const { items, total } = await client.search('bún bò', {
  category: 'restaurant',
  near: [10.776, 106.7],
  radius: 2000,   // 1–50 000, mặc định 5 000
  limit: 20,      // 1–50, mặc định 20
  offset: 0,      // 0–500
});
```

Cần **ít nhất một** trong `q`, `category`, `near`, `bbox`, nếu không API trả `400 invalid_request`.
Muốn lọc thuần theo loại thì truyền chuỗi rỗng cho `q`:

```ts
const { items } = await client.search('', { category: 'pharmacy', near: [10.776, 106.7] });
```

Lọc theo khung nhìn thay vì bán kính:

```ts
const b = map.gl.getBounds();
const { items } = await client.search('', {
  category: 'cafe',
  bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
});
```

Thứ tự sắp xếp: có `q` thì theo độ giống tên; không có `q` nhưng có `near` thì theo khoảng cách
tăng dần; không có cả hai thì theo `updated_at` mới nhất. `total` là tổng số bản ghi khớp trước khi
cắt theo `limit`, dùng để phân trang bằng `offset`.

## 7. `nearby` — POI quanh một điểm

```ts
const { items } = await client.nearby({
  lat: 10.776,
  lng: 106.7,
  radius: 500,      // 1–5 000, mặc định 500
  category: 'atm',
  limit: 20,        // 1–100, mặc định 20
});
```

`lat` và `lng` bắt buộc. Kết quả luôn sắp xếp theo khoảng cách tăng dần. Trả `{ items }`, **không**
có `total`.

## 8. `getPlace` — chi tiết một POI

```ts
const place = await client.getPlace(poiId);
console.log(place.name, place.address.text, place.hours, place.contact);
console.log(place.sources);      // [{ source, source_id, role }]
console.log(place.attribution);  // { text, html }
```

Chỉ POI có `status` là `active` hoặc `closed` thì ai cũng xem được; POI `pending` do đóng góp tạo ra
chỉ hiện với chính tenant đã tạo. Không tìm thấy thì ném `MapsLibVNError` với `status: 404` và
`code: 'not_found'`. Phản hồi được cache 1 giờ.

## 9. Dùng cái nào khi nào

| Tình huống | Dùng |
|---|---|
| Ô tìm kiếm gợi ý theo từng ký tự | `<mapslibvn-autocomplete>`, hoặc `autocomplete()` nếu cần tuỳ biến giao diện |
| Người dùng gõ xong và bấm "Tìm", cần danh sách dài, phân trang | `search()` |
| "Quán cà phê quanh đây", "ATM gần nhất" | `nearby()` |
| Đã có `id` POI (từ `poiClick` hoặc từ `autocomplete`) và cần giờ mở cửa, liên hệ, nguồn dữ liệu | `getPlace()` |
| Có chuỗi địa chỉ đầy đủ, cần toạ độ kèm mức tin cậy | `geocode()` — xem [Độ chính xác geocode](/do-chinh-xac/) |
| Có toạ độ, cần địa chỉ | `reverse()` |

Điểm khác nhau đáng nhớ: `autocomplete` tìm cả POI, đường và mốc số nhà và tối ưu cho độ trễ (cache
10 phút, tối đa 10 kết quả); `search` chỉ tìm POI nhưng lọc và phân trang được; `nearby` không nhận
từ khoá, chỉ nhận vị trí và loại.

## 10. Bắt lỗi

Mọi phương thức ném `MapsLibVNError` khi API trả mã lỗi:

```ts
import { MapsLibVNError } from '@mapslibvn/core';

try {
  const { items } = await client.search('bún bò', { near: [10.776, 106.7] });
} catch (err) {
  if (err instanceof MapsLibVNError) {
    console.error(err.status, err.code, err.message, err.requestId);
    if (err.code === 'quota_exceeded') thongBao('Đã hết lượt hôm nay.');
  }
}
```

Các mã hay gặp: `invalid_request` (400), `missing_key` và `invalid_key` (401),
`origin_not_allowed` (403), `not_found` (404), `quota_exceeded` (429),
`upstream_unavailable` (503). Bảng đầy đủ ở [REST API](/api/).

Các ví dụ trên dùng endpoint nội bộ hiện tại `api.ai-solutions.io.vn` và SDK phục vụ từ
`mapslibvn-docs.pages.dev` — cả hai là **tạm thời** trong giai đoạn nội bộ.

Đọc thêm: [Bản đồ web](/ban-do-web/), [React](/react/), [REST API](/api/),
[SDK JavaScript](/sdk/).
