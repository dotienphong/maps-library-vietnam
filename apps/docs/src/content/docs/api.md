---
title: REST API
description: Tham chiếu Places API và Routing API của MapsLibVN — xác thực, mã lỗi, quota, cache và từng endpoint kèm tham số, ví dụ curl và phản hồi.
---

Trang này là tham chiếu đầy đủ của REST API. Mọi tham số, giới hạn và mã lỗi ở đây lấy từ mã nguồn Worker. Nếu bạn dùng SDK JavaScript thì không cần gọi HTTP trực tiếp — xem [SDK JavaScript](/sdk/).

## 1. Gốc API và xác thực

Gốc API trong giai đoạn nội bộ:

```
https://api.ai-solutions.io.vn
```

Endpoint này là **tạm thời** và sẽ đổi khi MapsLibVN có tên miền riêng. Nếu bạn tự host, hãy thay bằng tên miền của mình, xem [Tự host](/tu-host/).

Khoá API chỉ truyền qua header `X-Api-Key`. Từ 09/09/2026 máy chủ **không** còn đọc `?key=` trên URL của các route `/v1/*` có kiểm khoá — khoá trên URL lọt vào log CDN, `Referer` và cache trung gian. (`?key=` trên URL style vẫn vô hại vì `/v1/styles/*` không kiểm khoá.)

```bash
curl -H "X-Api-Key: mlv_live_…" "https://api.ai-solutions.io.vn/v1/autocomplete?q=ben%20thanh"
```

### Ba loại khoá

| `kind` | Kiểm gì | Dùng cho |
|---|---|---|
| `web` | so `Origin`, không có thì so `Referer`, với danh sách `allowed_origins` của khoá; request **ghi** (`edits:write`) bắt buộc phải có `Origin`/`Referer` | trang web trong trình duyệt |
| `mobile` | không kiểm origin; header `X-Bundle-Id` nếu có chỉ được ghi log theo tenant | app iOS/Android |
| `server` | không kiểm origin — khoá là **bí mật**, chỉ đặt ở phía máy chủ của bạn | backend, script, cron |

Cách so origin của khoá `web` (hàm `originAllowed`):

- So **protocol và hostname**, **bỏ qua port**. Vậy `http://localhost` trong danh sách khớp cả `http://localhost:5500` và `http://localhost:8080`, nhưng không khớp `https://localhost`.
- Mẫu `https://*.example.vn` khớp mọi subdomain **và** khớp cả `https://example.vn`.
- Danh sách `allowed_origins` rỗng nghĩa là cho phép mọi origin.
- Giá trị `Origin`/`Referer` không phân tích được thành URL thì bị coi là không khớp.
- **Không có cả `Origin` lẫn `Referer`** thì request được cho qua. Đây là chủ ý của giai đoạn nội bộ: khoá `web` vốn không phải bí mật vì luôn nằm trong mã trang, nên `curl` và request từ máy chủ vẫn gọi được. Đừng dựa vào việc kiểm origin như một lớp bảo mật.

Origin sai trả `403 origin_not_allowed`.

### Scope

Khoá mang danh sách scope. Mọi endpoint đọc dữ liệu địa điểm cần `places:read`; `POST /v1/edits` cần `edits:write`. Thiếu scope trả `403 scope`.

Thông tin khoá được cache trong KV **300 giây**, nên thu hồi khoá hoặc đổi `allowed_origins` có thể mất tới 5 phút mới có hiệu lực.

### CORS

Worker trả `access-control-allow-origin: *` cho mọi route, cho phép method `GET`, `HEAD`, `POST`, `OPTIONS` và header `X-Api-Key`, `Range`, `Content-Type`. Việc giới hạn theo origin nằm ở tầng khoá API, không ở CORS.

## 2. Định dạng lỗi và `retry-after`

Mọi lỗi trả JSON cùng một hình dạng:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "q phải có ít nhất 2 ký tự",
    "request_id": "3fa6654b-17dc-4a9f-953d-41723b5529e5"
  }
}
```

`message` là tiếng Việt, dành cho lập trình viên đọc log — đừng hiển thị thẳng cho người dùng cuối. `request_id` là UUID sinh riêng cho từng phản hồi lỗi; hãy kèm nó khi báo lỗi.

| `code` | HTTP | Khi nào |
|---|---|---|
| `invalid_request` | 400 | tham số thiếu, sai kiểu hoặc sai định dạng; body `POST /v1/edits` không hợp lệ |
| `missing_key` | 401 | không có `X-Api-Key` và không có `?key=` |
| `invalid_key` | 401 | khoá không tồn tại, đã tắt hoặc đã thu hồi |
| `scope` | 403 | khoá không có scope mà endpoint yêu cầu |
| `origin_not_allowed` | 403 | khoá `web` và `Origin`/`Referer` không nằm trong `allowed_origins` |
| `not_found` | 404 | không có route, không có POI, không có theme hoặc bộ tiles |
| `no_route` | 404 | `GET /v1/directions`: không có đường giữa các điểm, hoặc điểm quá xa mạng đường / vùng không kết nối |
| `rate_limit_exceeded` | 429 | vượt burst/phút của Places hoặc Chỉ đường |
| `quota_exceeded` | 429 | vượt quota Places theo ngày, hoặc vượt giới hạn đóng góp theo ngày |
| `upstream_unavailable` | 503 | không truy vấn được cơ sở dữ liệu, không tra được khoá, chưa có phiên bản tiles, dịch vụ chỉ đường không phản hồi (kể cả lúc build lại graph) hoặc lỗi không xác định |
| `server_misconfigured` | 503 | máy chủ thiếu cấu hình bắt buộc; hiện chỉ xảy ra ở `POST /v1/edits` khi chưa đặt secret băm |

Header `retry-after` phân biệt theo loại giới hạn: `quota_exceeded` (quota ngày) trả **3600** giây; `rate_limit_exceeded` (burst/phút) trả **60** giây; `upstream_unavailable` trả **30** giây. Các mã 4xx khác không có `retry-after` vì thử lại ngay cũng vô ích.

Route quản trị `/v1/admin/*` dùng thêm hai mã `missing_access_jwt` và `invalid_access_jwt` (401) — xem mục 6.

## 3. Quota và cache

**Quota Places.** Tính theo ngày giờ Việt Nam (UTC+7, mốc 00:00). Plan `free` mặc định **20.000** lượt/ngày, khoá có thể được đặt hạn riêng. Bộ đếm nằm trong KV nên là **đếm xấp xỉ**: request được chặn khi bộ đếm đạt **2×** hạn mức, để việc đếm trễ không chặn oan. Tenant plan `internal` không bị đếm. Vượt hạn trả `429 quota_exceeded`.

Sáu endpoint đọc dữ liệu địa điểm (`/v1/autocomplete`, `/v1/search`, `/v1/nearby`, `/v1/places/{id}`, `/v1/geocode`, `/v1/reverse`) tính vào quota này. `POST /v1/edits` có giới hạn riêng theo ngày (mục 5), không tính vào quota Places.

**Quota Chỉ đường.** `GET /v1/directions` có quota **riêng**, cũng theo ngày Việt Nam và cũng chặn ở 2× hạn mức: plan `free` mặc định **2.000** lượt/ngày, khoá có thể được đặt hạn riêng (`quota_directions_per_day`). Tenant `internal` không bị đếm theo ngày. Burst **20 request/phút** cho mỗi cặp khoá + IP (riêng, không dùng chung 60 của Places). Ngoài ra khoá `web` và `mobile` — kể cả của tenant `internal`, vì khoá loại này nằm công khai trong trang/app — chịu **trần 100 request/phút cho cả khoá** (mọi IP cộng lại); khoá `server` không chịu trần này. Vượt trả `429 rate_limit_exceeded` với `retry-after: 60`.

**Cache.** Một số phản hồi được cache ở biên Cloudflare:

| Endpoint | Tươi trong | Còn dùng được khi lỗi |
|---|---|---|
| `/v1/autocomplete` | 10 phút | 1 giờ |
| `/v1/places/{id}` | 1 giờ | 2 giờ |
| `/v1/directions` | 60 giây | 5 phút |
| `/v1/attribution` | 24 giờ | — |
| `/v1/styles/{theme}.json` | 1 giờ | — |
| `/v1/tiles/{set}.json` | 1 giờ | — |
| tile `.pbf` | 1 ngày | thêm 7 ngày `stale-while-revalidate` |

Với `/v1/autocomplete`, `/v1/places/{id}` và `/v1/directions`, phản hồi lấy từ cache có header `x-mlv-cache`: `hit` là bản còn tươi, `stale` là bản cũ được trả vì truy vấn mới thất bại. Lỗi 4xx không bao giờ được cache. Các endpoint còn lại truy vấn trực tiếp, không cache.

Khoá cache của `/v1/autocomplete` gồm truy vấn đã chuẩn hoá (bỏ dấu, viết tắt đã bung), ô lưới của `near`, danh sách `types` và `limit` — nên hai truy vấn khác nhau về cách viết dấu vẫn dùng chung một bản cache.

## 4. Endpoint dữ liệu địa điểm

Cả sáu endpoint trong mục này cần scope `places:read` và tính vào quota Places.

Quy ước chung về tham số số: giá trị **ngoài khoảng bị kẹp về biên gần nhất** (ví dụ `limit=999` ở `/v1/autocomplete` thành `10`), còn giá trị không phải số nguyên trả `400 invalid_request`. Tham số dạng `lat,lng` phải đúng thứ tự **vĩ độ trước, kinh độ sau**.

Mọi phản hồi ví dụ dưới đây là **minh hoạ**, lấy hình dạng thật từ API với vùng trung tâm Thành phố Hồ Chí Minh và được rút gọn; giá trị cụ thể đổi theo dữ liệu hiện hành.

### GET /v1/autocomplete

Gợi ý khi người dùng đang gõ. Trộn ba loại kết quả: POI, tên đường và mốc địa chỉ.

| Tham số | Kiểu | Bắt buộc | Mặc định | Khoảng |
|---|---|---|---|---|
| `q` | chuỗi | có | — | ít nhất 2 ký tự sau khi bỏ khoảng trắng đầu cuối, và phải còn ký tự tra cứu được sau chuẩn hoá |
| `near` | `"lat,lng"` | không | — | `lat` trong ±90, `lng` trong ±180 |
| `limit` | số nguyên | không | `10` | 1–10 |
| `types` | danh sách ngăn bằng dấu phẩy | không | cả ba loại | `poi`, `street`, `address` |
| `sources` | danh sách ngăn bằng dấu phẩy | không | `all` | `osm`, `overture`, `fsq`; `all` = cả ba. Lọc POI theo **nguồn chính**; POI người dùng không bị loại vì nguồn |

`sources` chỉ ảnh hưởng kết quả `poi`; `street`, `address` và `area` không có nguồn.

`near` không lọc theo bán kính, chỉ dùng để cộng điểm cho kết quả ở gần. Kết quả loại `address` chỉ xuất hiện khi câu truy vấn phân tích được thành số nhà kèm tên đường.

Cách khớp tên (từ 05/09/2026): tiền tố (`name_norm LIKE 'q%'`) **hoặc** `word_similarity(q, name_norm)` của pg_trgm vượt ngưỡng 0,5 — tức là so truy vấn với từng đoạn từ liên tục trong tên, không so cả chuỗi. Nhờ đó lỗi gõ 1–2 ký tự, truy vấn ngắn hơn tên và đảo thứ tự từ vẫn khớp. `GET /v1/search` và bước khớp đường của `GET /v1/geocode` dùng cùng cách khớp này.

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/autocomplete?q=ben%20thanh&near=10.7725,106.6981&limit=3"
```

```json
{
  "items": [
    { "type": "poi", "id": "0KZ4N108T2EXHA5SZ8N2G7TAS1", "name": "Ga Bến Thành",
      "secondary": "Phan Chu Trinh", "lat": 10.7728476, "lng": 106.6978283, "score": 0.871 }
  ]
}
```

Ba loại còn lại có hình dạng hơi khác: kết quả `street` không có `id`; `address` không có `id` nhưng có thêm `precision`; `area` không có `id`, có `precision` (`province` / `district` / `ward`) và có thêm `bbox`.

```json
{ "type": "street", "name": "Đường Lê Lợi", "secondary": "bac ninh",
  "lat": 21.3564026, "lng": 106.2543289, "score": 0.64 }
{ "type": "street", "name": "Nam Kỳ Khởi Nghĩa", "secondary": "ho chi minh",
  "lat": 10.7785, "lng": 106.6925, "score": 0.62, "matched_alt": "Công Lý" }
{ "type": "address", "name": "37 Phan Chu Trinh", "secondary": "ben thanh, ho chi minh",
  "lat": 10.77248266, "lng": 106.69723188, "precision": "rooftop", "score": 0.725 }
```

```json
{ "type": "area", "id": null, "name": "Quận 10",
  "secondary": "Diên Hồng, Hòa Hưng, Vườn Lài, …", "lat": 10.77, "lng": 106.67,
  "precision": "district", "score": 0.6, "bbox": [106.65, 10.75, 106.68, 10.79] }
```

`matched_alt` (tuỳ chọn, mọi loại) chỉ xuất hiện khi kết quả khớp qua **tên thay thế** — tên cũ hoặc
tên khác của cùng đối tượng, lấy từ `old_name`/`alt_name` của OSM. Nó giữ nguyên dấu và nên hiển thị
để người dùng hiểu vì sao dòng đó khớp.

`secondary` của `street` và `address` là chuỗi đã chuẩn hoá (không dấu) vì lấy từ cột dùng để so khớp — hãy hiển thị nó như thông tin phụ, đừng dùng làm nhãn chính.

**Xếp hạng:** vùng hành chính không có điểm độ phổ biến nên thường xếp dưới POI. Khi truy vấn là
thuần tên hành chính — có phường/quận/tỉnh mà **không** có số nhà hay tên đường — thì một suất
trong `limit` được dành cho vùng có điểm cao nhất, đặt ở cuối danh sách. Số lượng kết quả không
đổi, và điểm của các loại khác giữ nguyên.

**Loại `area` bật sẵn trong `types` mặc định.** Nó trả cả đơn vị hành chính hiện hành và đơn vị
**trước sắp xếp 2025**. Một đơn vị cũ bị **tách** thành nhiều đơn vị mới chỉ trả về **một** gợi ý,
mang `bbox` của vùng cũ, `secondary` liệt kê tối đa ba tên đích rồi `…`; đơn vị chỉ **đổi tên** trả
vùng hiện hành với tên cũ ở `secondary`. Muốn giữ đúng bộ loại trước đây thì gửi
`types=poi,street,address`.

### GET /v1/search

Tìm POI theo tên, theo loại, theo bán kính quanh một điểm hoặc theo khung nhìn. Chỉ trả POI trạng thái `active`.

| Tham số | Kiểu | Bắt buộc | Mặc định | Khoảng |
|---|---|---|---|---|
| `q` | chuỗi | — | — | phải còn ký tự tra cứu được sau chuẩn hoá nếu có gửi |
| `category` | chuỗi | — | — | một trong 164 mã loại, khớp chính xác |
| `near` | `"lat,lng"` | — | — | `lat` trong ±90, `lng` trong ±180 |
| `bbox` | `"minLng,minLat,maxLng,maxLat"` | — | — | biên hợp lệ và `min` phải nhỏ hơn `max` ở cả hai trục |
| `radius` | số nguyên, mét | không | `5000` | 1–50000 (chỉ có tác dụng khi có `near`) |
| `limit` | số nguyên | không | `20` | 1–50 |
| `offset` | số nguyên | không | `0` | 0–500 |
| `sources` | danh sách ngăn bằng dấu phẩy | không | `all` | `osm`, `overture`, `fsq`; `all` = cả ba. Lọc POI theo **nguồn chính**; POI người dùng không bị loại vì nguồn |

Phải có **ít nhất một** trong `q`, `category`, `near`, `bbox`; thiếu cả bốn trả `400 invalid_request`. Bốn tham số này kết hợp theo kiểu "và": gửi cả `q` và `category` sẽ lọc theo cả hai.

Thứ tự sắp xếp phụ thuộc tham số bạn gửi: có `q` thì theo độ giống tên giảm dần; không có `q` mà có `near` thì theo khoảng cách tăng dần; còn lại theo thời điểm cập nhật mới nhất.

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/search?q=ca%20phe&near=10.7725,106.6981&radius=800&limit=2"
```

```json
{
  "items": [
    {
      "id": "5GCKJJJSX7KPMXMVTA2H89YNCT",
      "name": "B cà Phê",
      "category": { "code": "cafe", "group": "food_drink", "name_vi": "Quán cà phê", "name_en": "Cafe" },
      "lat": 10.76725,
      "lng": 106.69349,
      "address": { "housenumber": "74", "street": "Bùi Viện", "text": "74 Đường Bùi Viện, Quận 1" },
      "contact": { "phone": [], "website": ["http://instagram.com/bcoffeesaigon74/"], "facebook": null },
      "hours": null,
      "quality_score": 51,
      "status": "active",
      "updated_at": "2026-08-30T16:17:52.491Z"
    }
  ],
  "total": 124
}
```

`total` là tổng số bản ghi khớp điều kiện, dùng để phân trang cùng `offset`. Khi không có kết quả nào, `total` là `0`.

### GET /v1/nearby

Danh sách POI quanh một điểm, sắp xếp theo khoảng cách tăng dần. Khác `/v1/search` ở chỗ `lat` và `lng` là hai tham số riêng và bắt buộc.

| Tham số | Kiểu | Bắt buộc | Mặc định | Khoảng |
|---|---|---|---|---|
| `lat` | số | có | — | ±90 |
| `lng` | số | có | — | ±180 |
| `radius` | số nguyên, mét | không | `500` | 1–5000 |
| `limit` | số nguyên | không | `20` | 1–100 |
| `category` | chuỗi | không | — | một mã loại, khớp chính xác |
| `sources` | danh sách ngăn bằng dấu phẩy | không | `all` | `osm`, `overture`, `fsq`; `all` = cả ba. Lọc POI theo **nguồn chính**; POI người dùng không bị loại vì nguồn |

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/nearby?lat=10.7725&lng=106.6981&radius=300&limit=2&category=cafe"
```

```json
{
  "items": [
    {
      "id": "7WFXK16XM2CATJ5VB5FD9WF44A",
      "name": "Loan Tea & Coffee",
      "category": { "code": "cafe", "group": "food_drink", "name_vi": "Quán cà phê", "name_en": "Cafe" },
      "lat": 10.77225149,
      "lng": 106.69820569,
      "address": { "street": "Chợ Đ. Lê Lai", "text": "Chợ Đ. Lê Lai, Quận 1" },
      "contact": { "phone": ["+84983562503"], "website": ["https://m.me/92NamKy"], "facebook": null },
      "hours": null,
      "quality_score": 50,
      "status": "active",
      "updated_at": "2026-08-30T16:17:52.491Z"
    }
  ]
}
```

Phản hồi không có `total`. Không tìm thấy gì thì `items` là mảng rỗng, không phải lỗi 404.

### GET /v1/places/{id}

Không nhận `sources`: tra theo id luôn trả POI dù nguồn nào, để POI đã bấm trên bản đồ hay đã ghim bằng marker luôn mở được. Trường `sources` trong phản hồi cho biết nguồn nào đóng góp bản ghi.

Chi tiết một POI, kèm danh sách nguồn và chuỗi ghi nguồn.

| Tham số | Kiểu | Bắt buộc | Mặc định | Khoảng |
|---|---|---|---|---|
| `id` | chuỗi trong đường dẫn | có | — | id POI, dạng ULID 26 ký tự |

POI trạng thái `active` và `closed` đều trả về — hãy đọc trường `status` trước khi hiển thị, vì một địa điểm đã đóng cửa vẫn còn bản ghi. POI trạng thái `pending` (địa điểm mới do đóng góp tạo ra, chưa duyệt) **chỉ tenant đã gửi đóng góp đó** thấy được, và nhánh này không được cache. Id không tồn tại trả `404 not_found`.

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/places/0KZ4N108T2EXHA5SZ8N2G7TAS1"
```

```json
{
  "id": "0KZ4N108T2EXHA5SZ8N2G7TAS1",
  "name": "Ga Bến Thành",
  "category": { "code": "other", "group": "other", "name_vi": "Địa điểm khác", "name_en": "Other place" },
  "lat": 10.7728476,
  "lng": 106.6978283,
  "address": { "housenumber": "37", "street": "Phan Chu Trinh", "text": "Chợ Bến Thành, 37 Đường Phan Chu Trinh, Quận 1" },
  "contact": { "phone": [], "website": [], "facebook": "https://www.facebook.com/102752505496014" },
  "hours": null,
  "quality_score": 64,
  "status": "active",
  "updated_at": "2026-08-30T16:17:52.491Z",
  "sources": [
    { "source": "overture", "source_id": "7a87b865-c8b5-4c03-befd-9a7edb6be1d3", "role": "primary" },
    { "source": "fsq", "source_id": "54e583b3498eb9818cab94c3", "role": "secondary" }
  ],
  "attribution": { "text": "© MapsLibVN · © OpenStreetMap contributors (ODbL) · …", "html": "<a href=\"…\">© MapsLibVN</a> · …" }
}
```

Mỗi bản ghi chép trường từ **đúng một** nguồn chính (`role: "primary"`) và chỉ liên kết các nguồn khác bằng id (`role: "secondary"`) — lý do ở [Giấy phép & ghi nguồn](/giay-phep/) mục 4.

### GET /v1/geocode

Địa chỉ dạng chữ thành toạ độ. Mỗi kết quả kèm `precision` và `confidence`; ứng dụng **phải** đọc hai trường này trước khi ghim marker — bảng ý nghĩa đầy đủ ở [Độ chính xác geocode](/do-chinh-xac/).

| Tham số | Kiểu | Bắt buộc | Mặc định | Khoảng |
|---|---|---|---|---|
| `q` | chuỗi | có | — | ít nhất 2 ký tự và phải còn ký tự tra cứu được sau chuẩn hoá |
| `near` | `"lat,lng"` | không | — | `lat` trong ±90, `lng` trong ±180 |
| `limit` | số nguyên | không | `5` | 1–5 |

`near` dùng để chọn đúng nơi khi một tên đường trùng ở nhiều tỉnh.

```bash
curl -H "X-Api-Key: mlv_live_…" -G "https://api.ai-solutions.io.vn/v1/geocode" \
  --data-urlencode "q=37 Phan Chu Trinh, Bến Thành, Thành phố Hồ Chí Minh" \
  --data-urlencode "limit=1"
```

```json
{
  "items": [
    {
      "lat": 10.7712095,
      "lng": 106.69321,
      "precision": "rooftop",
      "confidence": 0.9,
      "matched": { "housenumber": "37", "street": "Phan Chu Trinh", "ward": "ben thanh", "province": "ho chi minh" },
      "display_name": "37 Phan Chu Trinh, ben thanh, ho chi minh"
    }
  ]
}
```

Trường `bbox` chỉ có ở mức `ward` và `province`, khi kết quả là một đơn vị hành chính chứ không phải một điểm — dùng nó để căn khung nhìn thay vì ghim marker:

```json
{
  "lat": 10.77153245,
  "lng": 106.694209,
  "precision": "ward",
  "confidence": 0.2,
  "matched": { "ward": "Phường Bến Thành" },
  "display_name": "Phường Bến Thành",
  "bbox": [106.6844859, 10.763427, 106.7027803, 10.77958]
}
```

Không tra được gì thì `items` là mảng rỗng, không phải lỗi 404. Với địa chỉ ngoài đô thị lớn, tỷ lệ rơi xuống mức `street` hoặc `ward` cao hơn — lý do ở [Độ chính xác geocode](/do-chinh-xac/) mục 4.

### GET /v1/reverse

Toạ độ thành địa chỉ, kèm POI gần nhất.

| Tham số | Kiểu | Bắt buộc | Mặc định | Khoảng |
|---|---|---|---|---|
| `lat` | số | có | — | ±90 |
| `lng` | số | có | — | ±180 |
| `sources` | danh sách ngăn bằng dấu phẩy | không | `all` | `osm`, `overture`, `fsq`; `all` = cả ba. Lọc POI theo **nguồn chính**; POI người dùng không bị loại vì nguồn |

Bán kính tìm kiếm cố định, không cấu hình được:

- **Đường**: 150 m. Lấy tuyến gần nhất.
- **Mốc số nhà**: 300 m, chỉ trên đúng tuyến đường vừa tìm được và chỉ lấy số nhà nguyên. Có hai mốc thì trả khoảng `≈ 13–20`, một mốc thì trả `≈ 13`.
- **POI gần nhất**: 100 m, chỉ POI `active` và thuộc `sources`.

Phường và tỉnh lấy theo ranh giới hành chính chứa điểm đó, không theo bán kính. Nếu không có đường nào trong 150 m nhưng có POI trong 100 m, `display_name` mô tả theo địa điểm, ví dụ "gần Chợ Bến Thành".

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/reverse?lat=10.7725&lng=106.6981"
```

```json
{
  "address": {
    "approx_housenumber": "≈ 13–20",
    "street": "Phan Bội Châu",
    "ward": "Phường Bến Thành",
    "province": "Thành phố Hồ Chí Minh",
    "display_name": "≈ 13–20 Phan Bội Châu, Phường Bến Thành, Thành phố Hồ Chí Minh"
  },
  "nearest_poi": {
    "id": "7WFXK16XM2CATJ5VB5FD9WF44A",
    "name": "Loan Tea & Coffee",
    "category": { "code": "cafe", "group": "food_drink", "name_vi": "Quán cà phê", "name_en": "Cafe" },
    "lat": 10.77225149,
    "lng": 106.69820569,
    "address": { "street": "Chợ Đ. Lê Lai", "text": "Chợ Đ. Lê Lai, Quận 1" },
    "contact": { "phone": ["+84983562503"], "website": [], "facebook": null },
    "hours": null,
    "quality_score": 50,
    "status": "active",
    "updated_at": "2026-08-30T16:17:52.491Z"
  }
}
```

Không có POI nào trong 100 m thì `nearest_poi` là `null`. Số nhà luôn là **ước lượng** — dấu `≈` nằm ngay trong chuỗi để bạn không hiển thị nó như số nhà chính xác.

### GET /v1/directions

Tuyến đường giữa hai điểm (có thể qua điểm dừng) cho xe máy, ô tô hoặc đi bộ, kèm bước rẽ tiếng Việt. Tính bởi Valhalla trên dữ liệu đường OpenStreetMap; **chưa** có giao thông trực tiếp, chưa tránh phí/cao tốc theo yêu cầu. Endpoint này cần scope `places:read` nhưng tính vào **quota Chỉ đường** (mục 3), không tính vào quota Places.

| Tham số | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `from` | `lat,lng` | có | — | vĩ độ trước |
| `to` | `lat,lng` | có | — | |
| `via` | `lat,lng;lat,lng…` | không | — | tối đa 5 điểm dừng, theo thứ tự |
| `mode` | `motorbike` \| `car` \| `walk` | không | `motorbike` | xe máy không đi cao tốc |
| `lang` | `vi` \| `en` | không | `vi` | ngôn ngữ câu chỉ dẫn |
| `alternatives` | `0` \| `1` | không | `0` | `1` xin thêm tối đa một tuyến thay thế; **bị bỏ qua khi có `via`** |

Mọi điểm phải nằm trong Việt Nam (vĩ độ 8–24, kinh độ 102–110). Tổng đường chim bay giữa các điểm liên tiếp tối đa: xe máy 500 km, ô tô 2.000 km, đi bộ 50 km — vượt trả `400 invalid_request` ghi rõ giới hạn.

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/directions?from=10.7798,106.6990&to=10.7725,106.6980&mode=motorbike"
```

```json
{
  "routes": [
    {
      "mode": "motorbike",
      "distance_m": 1240,
      "duration_s": 210,
      "bbox": [106.6975, 10.7725, 106.699, 10.7798],
      "geometry": "oh}pSonkojEnoBf^~{Bf^v|Af^~{Bod@",
      "legs": [
        {
          "distance_m": 1240,
          "duration_s": 210,
          "shape_offset": 0,
          "steps": [
            {
              "kind": "depart",
              "instruction": "Đi về hướng nam trên Đồng Khởi.",
              "verbal_pre": "Đi về hướng nam trên Đồng Khởi trong 200 mét.",
              "verbal_post": "Đi tiếp 200 mét.",
              "street_names": ["Đồng Khởi"],
              "distance_m": 200,
              "duration_s": 30,
              "shape_begin": 0,
              "shape_end": 1,
              "location": [106.699, 10.7798],
              "roundabout_exit": null
            },
            { "kind": "turn_left", "instruction": "Rẽ trái vào Lê Lợi.", "…": "…" },
            { "kind": "arrive", "instruction": "Bạn đã đến điểm dừng.", "…": "…" }
          ]
        }
      ],
      "flags": { "toll": false, "highway": false, "ferry": false }
    }
  ],
  "waypoints": [
    { "location": [106.699, 10.7798], "snapped": [106.699, 10.7798], "name": null },
    { "location": [106.698, 10.7725], "snapped": [106.6981, 10.7725], "name": null }
  ],
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "valhalla", "graph": "2026-09-15" }
}
```

Điểm cần chú ý:

- **Toạ độ trong response theo thứ tự `[lng, lat]`** (GeoJSON), kể cả `location`/`snapped` — khác tham số vào `lat,lng`.
- `geometry` là polyline mã hoá **precision 6** của **cả tuyến**; giải mã bằng `decodePolyline6` trong `@mapslibvn/core` ra `[lng, lat][]`. `steps[].shape_begin/shape_end` và `legs[].shape_offset` là chỉ số vào polyline đó.
- `kind` là tập cố định: `depart`, `arrive`, `continue`, `slight_right`, `slight_left`, `turn_right`, `turn_left`, `sharp_right`, `sharp_left`, `uturn_right`, `uturn_left`, `ramp_straight`, `ramp_right`, `ramp_left`, `exit_right`, `exit_left`, `keep_right`, `keep_left`, `merge`, `merge_right`, `merge_left`, `roundabout_enter`, `roundabout_exit`, `ferry_enter`, `ferry_exit`, `elevator`, `steps`, `escalator`, `building_enter`, `building_exit`, `other`. `roundabout_exit` chỉ khác `null` khi `kind = roundabout_enter`.
- `verbal_pre`/`verbal_post` dành cho đọc bằng giọng nói; có thể `null`.
- `waypoints[].snapped` là điểm trên tuyến gần điểm bạn gửi; `name` hiện luôn `null`.
- `engine` là thông tin chẩn đoán (`graph` = ngày build dữ liệu đường), **không phải hợp đồng ổn định**.
- Toạ độ `from`/`to`/`via` nằm trong URL nên có trong log request của Cloudflare Workers (giữ tối đa 30 ngày, chỉ để chẩn đoán; xem [Điều khoản tenant](/dieu-khoan/) mục 5). Tenant là bên kiểm soát dữ liệu vị trí của người dùng cuối.
- Không có đường → `404 no_route`. Dịch vụ đang build lại dữ liệu (thứ Hai ~02:00 giờ VN, vài chục phút) → `503 upstream_unavailable` với `retry-after: 30`; bản cache còn trong 5 phút vẫn được trả.

## 5. Endpoint ghi

### POST /v1/edits

Gửi một đóng góp: sửa thông tin POI, thêm địa điểm mới, báo đóng cửa, báo mở lại hoặc báo sai. Cần scope **`edits:write`**. Hướng dẫn dùng, bảng loại đóng góp và luật duyệt ở [Đóng góp & sửa POI](/dong-gop/); mục này chỉ nêu phần tham chiếu.

Body là JSON theo kiểu `SuggestEditRequest` (mục 7). Các giới hạn được kiểm ở phía máy chủ:

| Trường | Giới hạn |
|---|---|
| `kind` | một trong `create`, `update`, `close`, `reopen`, `report` |
| `end_user_token` | bắt buộc, chuỗi 1–128 ký tự |
| `poi_id` | tối đa 40 ký tự; bắt buộc với mọi `kind` trừ `create`, và `create` thì không được gửi |
| `changes` | chỉ nhận với `create` và `update`; `close`, `reopen`, `report` gửi kèm sẽ bị từ chối |
| trường chữ trong `changes` | mỗi trường tối đa 500 ký tự |
| `changes.lat` và `changes.lng` | phải đi cùng nhau; vĩ độ 7,8–23,6 và kinh độ 101,8–117,4 (phạm vi Việt Nam kể cả đảo) |
| `changes.contact.phone` và `.website` | mảng tối đa 5 chuỗi, mỗi chuỗi tối đa 200 ký tự |
| `changes.contact.facebook` | tối đa 200 ký tự |
| `changes.hours` | chuỗi opening_hours OSM tối đa 200 ký tự, hoặc `{ "osm": "…" }` |
| `photo_url` | tối đa 512 ký tự và phải bắt đầu bằng `https://` |
| `note` | tối đa 500 ký tự; bắt buộc với `kind: "report"` |

Trường lạ trong `changes` bị bỏ qua. `create` cần `changes.name` và `changes.lat`/`lng`; `update` cần ít nhất một trường.

Giới hạn số lượng, tính theo ngày giờ Việt Nam: **20** đóng góp mỗi `end_user_token`, **500** mỗi khoá API. Vượt trả `429 quota_exceeded`.

Mã lỗi riêng của endpoint này: `400 invalid_request` (body không phải JSON, sai kiểu, `category` không tồn tại, POI không ở trạng thái phù hợp với `kind`), `404 not_found` (không có POI đích), `403 scope` (khoá thiếu `edits:write`), `429 quota_exceeded`, `503 server_misconfigured` (máy chủ chưa đặt secret băm định danh).

```bash
curl -X POST "https://api.ai-solutions.io.vn/v1/edits" \
  -H "X-Api-Key: mlv_live_…" -H "Content-Type: application/json" \
  -d '{"poi_id":"0KZ4N108T2EXHA5SZ8N2G7TAS1","kind":"update","changes":{"hours":"Mo-Su 07:00-22:00"},"end_user_token":"user-12345"}'
```

```json
{ "edit_id": 4821, "status": "pending", "poi_id": "0KZ4N108T2EXHA5SZ8N2G7TAS1" }
```

`status` là `auto_approved` khi đóng góp được áp dụng ngay, `pending` khi chờ quản trị duyệt. Với `kind: "create"`, `poi_id` là id POI mới — POI này ở trạng thái `pending` và chỉ tenant của bạn thấy qua `GET /v1/places/{id}`.

## 6. Endpoint hạ tầng

### GET /v1/attribution

Chuỗi ghi nguồn bắt buộc. **Không cần khoá API.** Cache 24 giờ.

```bash
curl "https://api.ai-solutions.io.vn/v1/attribution"
```

```json
{
  "text": "© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Places: Overture Maps Foundation (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0)",
  "html": "<a href=\"https://github.com/dotienphong/maps-library-vietnam\" target=\"_blank\" rel=\"noopener\">© MapsLibVN</a> · …",
  "links": [
    { "text": "© MapsLibVN", "href": "https://github.com/dotienphong/maps-library-vietnam" },
    { "text": "© OpenStreetMap contributors", "href": "https://www.openstreetmap.org/copyright", "license": "ODbL" }
  ]
}
```

Dùng chuỗi này khi bạn hiển thị kết quả API ngoài bản đồ. Nghĩa vụ chi tiết ở [Giấy phép & ghi nguồn](/giay-phep/).

### GET /v1/styles/{theme}.json

Style MapLibre của MapsLibVN, đã điền sẵn URL bộ tiles hiện hành.

| Tham số | Kiểu | Bắt buộc | Mặc định | Khoảng |
|---|---|---|---|---|
| `theme` | chuỗi trong đường dẫn | có | — | `light` hoặc `dark` |
| `sources` | chuỗi truy vấn | không | `all` | `osm,overture,fsq` (`all`), `osm`, `osm,fsq`, `overture,fsq`, `overture` hoặc `fsq`; tổ hợp khác trả `400 invalid_request` |

Tên khác trả `404 not_found`. Cache 1 giờ. Route này **không kiểm khoá API**, nhưng SDK vẫn gắn `?key=` vào URL style để hành vi không đổi khi việc kiểm được bật về sau — đừng dựa vào việc endpoint hiện đang mở.

Header `x-poi-profile` cho biết archive đang phục vụ: `all`, `osm`, `osm-fsq`, `overture-fsq`,
`overture` hoặc `fsq`. Nếu archive của profile hợp lệ chưa phát hành, header là `all;fallback` và API tạm dùng
archive đầy đủ thay vì trả lỗi. POI do người dùng đóng góp luôn được giữ trong mọi profile.

Khi bộ tiles POI chưa phát hành, nguồn và lớp `poi` bị lược khỏi style để MapLibre không tải một file rỗng.

```bash
curl "https://api.ai-solutions.io.vn/v1/styles/light.json"
```

### GET /v1/tiles/{set}.json và tile `.pbf`

TileJSON và tile vector, đọc trực tiếp từ archive PMTiles trên R2 bằng HTTP Range. `set` là `vn`
(bản đồ nền) hoặc một release POI mà manifest hiện hành trỏ tới. Ứng dụng nên lấy URL POI qua style
thay vì tự ghép tên release; tên khác hoặc bộ chưa phát hành trả `404 not_found`.

```
GET /v1/tiles/vn.json
GET /v1/tiles/vn/{z}/{x}/{y}.pbf
```

Không cần khoá API. TileJSON cache 1 giờ. Tile cache 1 ngày kèm `stale-while-revalidate` 7 ngày và `etag` theo phiên bản bộ tiles. Ô không có dữ liệu, hoặc `z` ngoài khoảng zoom của archive, trả **204** với body rỗng — đây là hành vi bình thường, không phải lỗi. Tile được trả nguyên byte gzip trong archive kèm `content-encoding: gzip`.

Bạn thường không gọi hai endpoint này trực tiếp: URL của chúng đã nằm trong style ở trên và MapLibre tự tải.

### GET /healthz

Kiểm tra Worker còn sống. Không cần khoá API.

```bash
curl "https://api.ai-solutions.io.vn/healthz"
```

```json
{ "ok": true, "environment": "production" }
```

Có thêm `GET /healthz/db` kiểm cả kết nối cơ sở dữ liệu, trả `{ ok, user, version }` khi nối được và `503 upstream_unavailable` khi không.
Tương tự, `GET /healthz/routing` kiểm dịch vụ chỉ đường: trả `{ ok, version, graph_built_at, ms }` (ISO thời điểm build graph) hoặc `503 upstream_unavailable`.

### Route quản trị

`/v1/admin/*` là **nội bộ**: mọi request phải đi qua Cloudflare Access và mang JWT do Access chèn, thiếu hoặc sai thì trả `401 missing_access_jwt` / `401 invalid_access_jwt`. Nhóm route này dùng cho việc duyệt đóng góp, không dành cho tenant và không được mô tả ở đây.

Ngoài ra `/r2/*` chỉ tồn tại ở môi trường phát triển để đọc R2 cục bộ; trên production nó trả `404 not_found`.

## 7. Kiểu dữ liệu

Nguyên văn từ `packages/core/src/types.ts` — dùng chung giữa Worker và SDK, nên tên trường trong JSON đúng như ở đây.

```ts
interface PlaceCategory {
  code: string;
  group: string;
  name_vi: string;
  name_en: string;
}

interface PlaceAddress {
  housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
  text?: string;
}

interface Place {
  id: string;
  name: string;
  category: PlaceCategory | null;
  lat: number;
  lng: number;
  address: PlaceAddress;
  contact?: Record<string, unknown> | null;
  hours?: unknown;
  quality_score: number | null;
  status: 'active' | 'closed' | 'pending' | 'rejected';
  updated_at: string;
}

interface PlaceSource {
  source: 'osm' | 'overture' | 'fsq';
  source_id: string;
  role: 'primary' | 'secondary';
}

interface PlaceDetails extends Place {
  sources: PlaceSource[];
  attribution: { text: string; html: string };
}

type GeocodePrecision =
  | 'rooftop'
  | 'alley'
  | 'interpolated'
  | 'street'
  | 'ward'
  | 'district'
  | 'province';

type AutocompleteType = 'poi' | 'street' | 'address' | 'area';

interface AutocompleteItem {
  type: AutocompleteType;
  id?: string;
  name: string;
  secondary: string;
  lat: number;
  lng: number;
  precision?: GeocodePrecision;
  score: number;
  bbox?: [number, number, number, number];
}

interface GeocodeMatched {
  housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
  former?: { ward?: string; district?: string; province?: string };
}

interface GeocodeItem {
  lat: number;
  lng: number;
  precision: GeocodePrecision;
  confidence: number;
  matched: GeocodeMatched;
  display_name: string;
  bbox?: [number, number, number, number];
}

interface ReverseAddress {
  approx_housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
  display_name: string;
}

interface ReverseResponse {
  address: ReverseAddress;
  nearest_poi: Place | null;
}

type EditKind = 'create' | 'update' | 'close' | 'reopen' | 'report';

interface EditChanges {
  name?: string;
  lat?: number;
  lng?: number;
  category?: string;
  housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
  address_text?: string;
  contact?: { phone?: string[]; website?: string[]; facebook?: string };
  /** Chuỗi opening_hours OSM hoặc {osm: chuỗi}. */
  hours?: string | { osm: string };
}

interface SuggestEditRequest {
  /** Bắt buộc trừ kind='create'. */
  poi_id?: string;
  kind: EditKind;
  changes?: EditChanges;
  photo_url?: string;
  note?: string;
  /** Chuỗi ổn định theo người dùng cuối do app nhúng cấp — server chỉ lưu bản băm. */
  end_user_token: string;
}

interface SuggestEditResponse {
  edit_id: number;
  status: 'pending' | 'auto_approved';
  /** POI đích; với kind='create' là id POI mới (pending cho tới khi được duyệt). */
  poi_id: string | null;
}

/** POI đọc từ tile lớp `poi` khi người dùng bấm. */
interface PoiFeature {
  id: string;
  name: string;
  category: string;
  group: string;
  lngLat: [number, number];
}

type TravelMode = 'motorbike' | 'car' | 'walk';
type DirectionsLang = 'vi' | 'en';

type ManeuverKind =
  | 'depart' | 'arrive' | 'continue' | 'slight_right' | 'slight_left'
  | 'turn_right' | 'turn_left' | 'sharp_right' | 'sharp_left'
  | 'uturn_right' | 'uturn_left' | 'ramp_straight' | 'ramp_right' | 'ramp_left'
  | 'exit_right' | 'exit_left' | 'keep_right' | 'keep_left' | 'merge'
  | 'merge_right' | 'merge_left' | 'roundabout_enter' | 'roundabout_exit'
  | 'ferry_enter' | 'ferry_exit' | 'elevator' | 'steps' | 'escalator'
  | 'building_enter' | 'building_exit' | 'other';

interface RouteStep {
  kind: ManeuverKind;
  instruction: string;
  verbal_pre: string | null;
  verbal_post: string | null;
  street_names: string[];
  distance_m: number;
  duration_s: number;
  shape_begin: number;
  shape_end: number;
  location: [number, number];
  roundabout_exit: number | null;
}

interface RouteLeg {
  distance_m: number;
  duration_s: number;
  shape_offset: number;
  steps: RouteStep[];
}

interface Route {
  mode: TravelMode;
  distance_m: number;
  duration_s: number;
  bbox: [number, number, number, number];
  geometry: string;
  legs: RouteLeg[];
  flags: { toll: boolean; highway: boolean; ferry: boolean };
}

interface Waypoint {
  location: [number, number];
  snapped: [number, number];
  name: string | null;
}

interface DirectionsResponse {
  routes: Route[];
  waypoints: Waypoint[];
  attribution: string;
  engine?: { name: string; graph: string | null };
}
```

Vài điểm dễ sai:

- `AutocompleteItem.id` chỉ có với `type: "poi"`; kết quả `street`, `address` và `area` không có id nên không gọi được `/v1/places/{id}`.
- `AutocompleteItem.precision` có với `type: "address"` (luôn `"rooftop"`) và với `type: "area"` (`"province"` / `"district"` / `"ward"`).
- `AutocompleteItem.bbox` chỉ có với `type: "area"`, theo thứ tự `[minLng, minLat, maxLng, maxLat]`.
- `AutocompleteType` và `GeocodePrecision` đều **thêm giá trị mới** (`area`, `district`). Nếu code của bạn `switch` vét cạn hai kiểu này thì phải bổ sung nhánh; không trường nào bị xoá.
- `PoiFeature.category` và `.group` là **mã** dạng chuỗi, khác `Place.category` là một object có tên tiếng Việt và tiếng Anh.
- `PoiFeature.lngLat` theo thứ tự **kinh độ trước** (chuẩn GeoJSON), còn tham số `near` của API theo thứ tự **vĩ độ trước**.
- `contact` và `hours` có thể là `null`. `hours` không có kiểu chặt vì giữ nguyên chuỗi opening_hours của nguồn.
- `Route.geometry` là polyline6 (không phải GeoJSON); mọi toạ độ trong `Route`/`Waypoint` là `[lng, lat]`.

## 8. Đọc thêm

- [SDK JavaScript](/sdk/) — gọi các endpoint này bằng client có kiểu sẵn.
- [Khoá API](/khoa-api/) — ba loại khoá, cách xin khoá và cách xử lý khi lộ khoá.
- [Độ chính xác geocode](/do-chinh-xac/) — ý nghĩa `precision` và `confidence`.
- [Đóng góp & sửa POI](/dong-gop/) — hướng dẫn dùng `POST /v1/edits`.
- [Giấy phép & ghi nguồn](/giay-phep/) — nghĩa vụ khi hiển thị dữ liệu.
