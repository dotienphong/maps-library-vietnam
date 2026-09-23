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

Endpoint này là **tạm thời** và sẽ đổi khi MapsLibVN có tên miền riêng.

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
| `missing_key` | 401 | không có header `X-Api-Key` |
| `invalid_key` | 401 | khoá không tồn tại, đã tắt hoặc đã thu hồi |
| `scope` | 403 | khoá không có scope mà endpoint yêu cầu |
| `origin_not_allowed` | 403 | khoá `web` và `Origin`/`Referer` không nằm trong `allowed_origins` |
| `not_found` | 404 | không có route, không có POI, không có theme hoặc bộ tiles |
| `no_route` | 404 | `GET /v1/directions` và `/v1/optimized-route`: không có đường giữa các điểm, hoặc điểm quá xa mạng đường / vùng không kết nối. `/v1/matrix`: chỉ khi một điểm không bám được vào đường nào — cặp không nối được trả `null` trong bảng, không lỗi. `POST /v1/fleet-plan`: một điểm không tới được hoặc nằm ở vùng đường không nối với các điểm còn lại — lỗi cho cả request, thông điệp gọi tên đơn hoặc xe khi xác định được |
| `rate_limit_exceeded` | 429 | vượt burst/phút của Places hoặc Chỉ đường |
| `quota_exceeded` | 429 | hết hạn mức Places/Chỉ đường; `details` có `group`, `reason` (`daily`/`period`/`trial_total`), `resetAt` khi thật sự có mốc cấp lại, và `actions` |
| `subscription_expired` | 403 | hết **quyền** dùng chứ không phải hết lượt: trial hết hạn, thuê bao hết hạn, bị tạm dừng, hoặc chưa được cấp quyền. Không gợi ý mua thêm lượt |
| `ack_required` | 429 | còn quá nhiều receipt chưa xác nhận; hãy ACK receipt cũ. Cửa sổ tự mở, **không** phải hết quota |
| `concurrency_limit` | 429 | quá nhiều request đồng thời của cùng tenant — nghẽn tạm thời, kèm `retry-after` ngắn. Hạn mức vẫn còn nguyên |
| `quota_unavailable` | 503 | sổ quota không truy cập được, hoặc quota thương mại đang tạm đóng để bảo trì |
| `quota_ack_pending` | client SDK | SDK chưa xác nhận được receipt trước nên tạm không gửi request tính lượt mới |
| `upstream_unavailable` | 503 | không truy vấn được cơ sở dữ liệu, không tra được khoá, chưa có phiên bản tiles, dịch vụ chỉ đường không phản hồi (kể cả lúc build lại graph) hoặc lỗi không xác định |
| `server_misconfigured` | 503 | máy chủ thiếu cấu hình bắt buộc; hiện chỉ xảy ra ở `POST /v1/edits` khi chưa đặt secret băm |

Header `retry-after` chỉ có khi máy chủ biết thời gian thử lại hợp lệ. Burst/phút trả **60** giây và `upstream_unavailable` trả **30** giây. Quota thương mại không dùng giá trị 3600 chung; ứng dụng đọc `error.details.resetAt` khi trường này có mặt.

`details.actions` nói rõ việc nên làm, đừng suy từ mã lỗi: `upgrade` (nâng gói), `buy_more` (mua thêm lượt), `renew` (gia hạn/khôi phục thuê bao), `wait` (chờ rồi thử lại). Chỉ hết hạn mức thật mới có `buy_more` — nghẽn tạm thời và thiếu ACK thì không, vì mua thêm lượt không giải quyết được.

Route quản trị `/v1/admin/*` dùng thêm hai mã `missing_access_jwt` và `invalid_access_jwt` (401) — xem mục 6.

:::caution[Thay đổi hành vi: `HEAD` trên chín API dữ liệu trả 405]
Chín endpoint dữ liệu (sáu API Places, `/v1/directions`, `/v1/matrix` và `/v1/optimized-route`) nay trả **`405` kèm `Allow: GET`** cho
`HEAD`, thay vì chạy như `GET` rồi trả 200 không body như trước. Lý do: `HEAD` vẫn chạy trọn truy
vấn ở máy chủ nhưng không trả dữ liệu gì cho người gọi — vừa tốn tài nguyên vừa bị tính vào hạn
mức. Nếu bạn đang dùng `HEAD` để kiểm tra dịch vụ sống, hãy đổi sang `GET /healthz`
(hoặc `/healthz/db`, `/healthz/routing`) — các endpoint đó không cần khoá và không tính lượt.
Phản hồi 405 này **không có body** — đúng chuẩn HTTP cho `HEAD` — nên nó không mang `error.code`
như các lỗi khác; hãy nhận biết bằng status và header `Allow`.
`OPTIONS` vẫn kết thúc ở CORS như cũ. Các route tiles/styles/metadata không đổi.
:::

## 3. Quota và cache

Tenant cũ dùng quota KV theo ngày cho tới khi quản trị viên chuyển `quota_mode` sang `commercial`.
Tenant thương mại dùng sổ quota chính xác theo tenant: Free có tổng 2.000 Places + 200 tuyến trong
30 ngày và trần 200 + 20 mỗi ngày; các gói trả phí dùng kỳ thuê bao và credit mua thêm. Một phản hồi
2xx, kể cả kết quả rỗng hoặc lấy từ cache, chỉ được cộng lượt sau khi client xác nhận receipt. Lỗi
4xx/5xx không cộng lượt. Burst limit vẫn kiểm mọi request.

Sáu endpoint đọc dữ liệu địa điểm (`/v1/autocomplete`, `/v1/search`, `/v1/nearby`, `/v1/places/{id}`, `/v1/geocode`, `/v1/reverse`) tính vào quota này. `POST /v1/edits` có giới hạn riêng theo ngày (mục 5), không tính vào quota Places.

**Quota Chỉ đường.** `GET /v1/directions` có quota **riêng**, cũng theo ngày Việt Nam và cũng chặn ở 2× hạn mức: plan `free` mặc định **2.000** lượt/ngày, khoá có thể được đặt hạn riêng (`quota_directions_per_day`). Tenant `internal` không bị đếm theo ngày. Burst **20 request/phút** cho mỗi cặp khoá + IP (riêng, không dùng chung 60 của Places). Ngoài ra khoá `web` và `mobile` — kể cả của tenant `internal`, vì khoá loại này nằm công khai trong trang/app — chịu **trần 100 request/phút cho cả khoá** (mọi IP cộng lại); khoá `server` không chịu trần này. Vượt trả `429 rate_limit_exceeded` với `retry-after: 60`.

`GET /v1/matrix` và `GET /v1/optimized-route` tính vào **cùng quota Chỉ đường** và tính **một lượt mỗi request bất kể cỡ**: một ma trận 10 × 5 (50 cặp) hay một lần tối ưu 10 điểm dừng đều là một lượt. Bù lại cỡ mỗi request có trần (tối đa 50 cặp, tối đa 10 điểm dừng — xem từng endpoint ở mục 4), **và hai endpoint này có nhịp riêng 6 request/phút cho mỗi khoá** (mọi IP cộng lại, áp cho cả khoá `server`) vì chúng nặng hơn hẳn một lượt chỉ đường trên engine. Ngoài ra vẫn chịu burst 20 request/phút/khoá + IP và trần 100 request/phút của khoá `web`/`mobile` dùng chung với `/v1/directions`. Vượt nhịp riêng trả `429 rate_limit_exceeded` với `retry-after: 60`.

`POST /v1/fleet-plan` (chia đơn cho đội xe) cũng tính vào **cùng quota Chỉ đường**, **một lượt mỗi request** bất kể số xe và số đơn, và có **nhịp riêng 2 request/phút cho mỗi khoá** (mọi IP cộng lại, áp cho cả khoá `server`): một request cỡ tối đa là một ma trận tới 1.600 cặp cộng năm tuyến trên cùng engine. Body sai (400) không tốn lượt.

### Hai lớp giới hạn khác nhau

Đừng gộp hai thứ này làm một — chúng chặn vì lý do khác nhau và cách xử lý cũng khác:

| | Burst limit (edge) | Quota thương mại (tenant) |
|---|---|---|
| Đếm theo | cặp khoá + IP, từng điểm Cloudflare | **tenant** — mọi khoá cộng chung |
| Cửa sổ | mỗi phút | ngày giờ VN (trial) và kỳ thuê bao |
| Tính cả request lỗi? | **có** | không, chỉ 2xx đã ACK |
| Mã lỗi | `rate_limit_exceeded` (429) | `quota_exceeded` (429), `subscription_expired` (403) |
| Cách xử lý | chờ `retry-after: 60` rồi thử lại | giảm nhịp gọi, mua thêm hoặc nâng gói |

Đổi khoá **không** làm mới hạn mức thương mại: hai khoá của cùng một tenant tiêu chung một sổ, và
thu hồi rồi cấp lại khoá cũng không reset. Bộ đếm burst thì ngược lại — nó là lớp chống spam chạy
bất đồng bộ theo từng điểm Cloudflare, không phải số liệu tính cước.

### Hạn mức theo gói

| Gói | Places mỗi kỳ | Chỉ đường mỗi kỳ | Trần ngày (giờ VN) |
|---|---:|---:|---|
| Dùng thử 30 ngày | 2.000 **tổng** | 200 **tổng** | 200 Places + 20 tuyến |
| Starter | 30.000 | 3.000 | không có trần ngày riêng |
| Professional | 100.000 | 10.000 | không có trần ngày riêng |
| Business | 400.000 | 40.000 | không có trần ngày riêng |

Hai nhóm **độc lập**: hết Places không chặn Chỉ đường và ngược lại.

Kỳ thuê bao chạy theo ngày kích hoạt chứ không theo đầu tháng lịch, và giữ nguyên mốc gốc khi
tháng thiếu ngày — kích hoạt 31/01 thì kỳ sau kết thúc ngày cuối tháng 02, rồi trở lại 31/03.

### Cái gì reset, cái gì không

- **Trần ngày của bản dùng thử** reset lúc 00:00 giờ VN. Đây là trường hợp duy nhất có
  `details.resetAt` chắc chắn.
- **Tổng 2.000/200 của bản dùng thử** không reset. Hết là hết, kể cả khi chưa qua 30 ngày.
- **Hết 30 ngày dùng thử** chặn ngay cả khi vẫn còn lượt, và trả `403 subscription_expired`.
- **Hạn mức kỳ trả phí** chỉ mở lại khi kỳ tiếp theo được cấp sau xác nhận thanh toán — máy chủ
  **không hứa** mốc reset nên `resetAt` sẽ vắng mặt. Đừng tự suy ra ngày reset rồi chờ.

### Lượt mua thêm

Mua theo khối tròn 1.000 lượt, tách riêng cho từng nhóm: mua thêm Places không mở lại Chỉ đường.
Lượt trong gói được dùng **trước**, hết mới tới lượt mua thêm; trong số lượt mua thêm thì khối nào
hết hạn sớm hơn sẽ đi trước. Lượt mua thêm hết hạn **cùng kỳ đã mua**, không chuyển sang kỳ sau, và
chỉ dùng được khi thuê bao trả phí còn hoạt động.

Đăng ký, chọn gói, gia hạn và mua thêm lượt làm ở [cổng khách hàng](https://api.ai-solutions.io.vn/console/):
đặt đơn `plan` (gói + kỳ 1/3/6/12 tháng) hoặc `addon` (số khối 1.000 lượt của một nhóm), thanh toán
qua PayOS, hạn mức mở ngay khi thanh toán được xác nhận. Đơn `addon` chỉ đặt được khi thuê bao trả
phí còn hoạt động. Bảng giá và danh sách kỳ đọc bằng máy ở `GET /v1/catalog` (mục 6).

### Ví dụ lỗi hạn mức

Hết trần ngày của bản dùng thử — có mốc reset, nên ứng dụng chờ được:

```json
{
  "error": {
    "code": "quota_exceeded",
    "message": "Hết hạn mức trong ngày (places)",
    "request_id": "0f0a…",
    "details": {
      "group": "places",
      "reason": "daily",
      "resetAt": "2026-09-16T17:00:00.000Z",
      "actions": ["wait", "upgrade"]
    }
  }
}
```

Hết hạn mức của kỳ trả phí — **không** có `resetAt`, vì chưa có gì bảo đảm kỳ sau:

```json
{
  "error": {
    "code": "quota_exceeded",
    "message": "Hết hạn mức của kỳ (directions)",
    "request_id": "7c21…",
    "details": {
      "group": "directions",
      "reason": "period",
      "resetAt": null,
      "actions": ["upgrade", "buy_more"]
    }
  }
}
```

Hết **quyền** chứ không phải hết lượt — mua thêm lượt không giải quyết được nên không có `buy_more`:

```json
{
  "error": {
    "code": "subscription_expired",
    "message": "Bản dùng thử đã hết hạn (places)",
    "request_id": "b5de…",
    "details": {
      "group": "places",
      "reason": "trial_expired",
      "resetAt": null,
      "actions": ["upgrade"]
    }
  }
}
```

`reason` là trường đáng tin để phân nhánh; đừng đoán từ `message`. Các giá trị hiện có:
`daily`, `period`, `trial_total`, `trial_expired`, `subscription_expired`, `no_entitlement`,
`suspended`, `ack_required`, `concurrency_limit`, `maintenance`.

### Xác nhận receipt khi gọi REST trực tiếp

Phản hồi 2xx của tenant thương mại có bốn header được CORS expose:
`X-MapsLibVN-Receipt-Id`, `X-MapsLibVN-Receipt-Token`, `X-MapsLibVN-Receipt-Expires-At`
(ISO UTC) và `X-MapsLibVN-Receipt-Version`. Quá `Expires-At` thì receipt tự hết hiệu lực và
**không bị tính lượt** — client nên bỏ nó đi thay vì ACK, vì ACK muộn chỉ nhận 409.
Sau khi nhận và đọc xong response, lưu receipt bền vững rồi ACK bằng chính API key đã gọi dữ liệu:

```bash
curl -X POST -H "X-Api-Key: mlv_live_…" -H "Content-Type: application/json" \
  -d '{"token":"TOKEN_TRONG_HEADER"}' \
  "https://api.ai-solutions.io.vn/v1/quota/receipts/RECEIPT_ID/ack"
```

ACK lặp lại là an toàn và không cộng lượt lần hai. Token sai trả 403; receipt đã đóng hoặc hết hạn
trả 409. Không ghi token vào log và không cache response chứa receipt. Bốn SDK MapsLibVN tự thực
hiện quy trình này.

**Cache.** Một số phản hồi được cache ở biên Cloudflare:

| Endpoint | Tươi trong | Còn dùng được khi lỗi |
|---|---|---|
| `/v1/autocomplete` | 10 phút | 1 giờ |
| `/v1/places/{id}` | 1 giờ | 2 giờ |
| `/v1/directions` | 60 giây | 5 phút |
| `/v1/matrix` | 60 giây | 5 phút |
| `/v1/optimized-route` | 60 giây | 5 phút |
| `/v1/fleet-plan` | 60 giây | 5 phút |
| `/v1/attribution` | 24 giờ | — |
| `/v1/styles/{theme}.json` | 1 giờ | — |
| `/v1/tiles/{set}.json` | 1 giờ | — |
| tile `.pbf` | 1 ngày | thêm 7 ngày `stale-while-revalidate` |

Với `/v1/autocomplete`, `/v1/places/{id}`, `/v1/directions`, `/v1/matrix`, `/v1/optimized-route` và `/v1/fleet-plan`, phản hồi lấy từ cache có header `x-mlv-cache`: `hit` là bản còn tươi, `stale` là bản cũ được trả vì truy vấn mới thất bại. Lỗi 4xx không bao giờ được cache. Các endpoint còn lại truy vấn trực tiếp, không cache.

Khoá cache của `/v1/autocomplete` gồm truy vấn đã chuẩn hoá (bỏ dấu, viết tắt đã bung), ô lưới của `near`, danh sách `types` và `limit` — nên hai truy vấn khác nhau về cách viết dấu vẫn dùng chung một bản cache. Khoá cache của bốn endpoint dẫn đường làm tròn toạ độ 4 chữ số (~11 m) với ma trận, tối ưu thứ tự và đội xe, 5 chữ số với directions. Khoá của đội xe là mã băm của cả body đã chuẩn hoá (mốc giờ đổi sang giây), nên chỉ đổi thứ tự trường JSON vẫn trúng cache.

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
| `sources` | danh sách ngăn bằng dấu phẩy | không | `all` | `osm`, `fsq`; `all` = cả hai. Lọc POI theo **nguồn chính**; POI người dùng không bị loại vì nguồn |

`sources` chỉ ảnh hưởng kết quả `poi`; `street`, `address` và `area` không có nguồn.

`near` không lọc theo bán kính, chỉ dùng để cộng điểm cho kết quả ở gần. Kết quả loại `address` chỉ xuất hiện khi câu truy vấn phân tích được thành số nhà kèm tên đường.

`secondary` của kết quả `poi` là `đường, phường/xã, tỉnh/thành` theo **đơn vị hành chính hiện hành (2025)** suy từ toạ độ POI qua ranh giới OSM, không phải địa chỉ nguyên văn của nguồn — nhờ vậy hai quán cùng con đường luôn hiện cùng một hệ tên phường, và POI mà nguồn không ghi địa chỉ vẫn có dòng phụ. Địa chỉ gốc của nguồn (có thể là quận/phường cũ) vẫn nằm ở `address.text` của `GET /v1/places/{id}`. POI người dùng vừa tạo, chưa qua lần chạy pipeline hằng tuần, tạm dùng phường/tỉnh do người tạo nhập.

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
| `sources` | danh sách ngăn bằng dấu phẩy | không | `all` | `osm`, `fsq`; `all` = cả hai. Lọc POI theo **nguồn chính**; POI người dùng không bị loại vì nguồn |

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
| `sources` | danh sách ngăn bằng dấu phẩy | không | `all` | `osm`, `fsq`; `all` = cả hai. Lọc POI theo **nguồn chính**; POI người dùng không bị loại vì nguồn |

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
    { "source": "fsq", "source_id": "4b0588c0f964a520e7cd22e3", "role": "primary" },
    { "source": "osm", "source_id": "n4276546245", "role": "secondary" }
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
| `sources` | danh sách ngăn bằng dấu phẩy | không | `all` | `osm`, `fsq`; `all` = cả hai. Lọc POI theo **nguồn chính**; POI người dùng không bị loại vì nguồn |

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
| `via` | `lat,lng;lat,lng…` | không | — | tối đa 10 điểm dừng, theo thứ tự |
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
              "verbal_alert": "Đi về hướng nam trên Đồng Khởi.",
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
- `verbal_alert` (câu rẽ ngắn để đọc lúc còn xa), `verbal_pre` (đọc ngay trước điểm rẽ), `verbal_post` (đọc sau khi rẽ) dành cho giọng nói; có thể `null`. Câu không kèm khoảng cách — SDK ghép "Trong 200 mét nữa, …" theo vị trí thật (xem [Dẫn đường](/dan-duong/)).
- Câu tiếng Việt (`lang=vi`) đã qua bảng sửa cụm từ của MapsLibVN (ví dụ "Điểm đến ở bên trái." thay cho bản dịch máy "Điểm đến của bạn nằm ở trái."); `lang=en` trả nguyên văn engine.
- `waypoints[].snapped` là điểm trên tuyến gần điểm bạn gửi; `name` hiện luôn `null`.
- `engine` là thông tin chẩn đoán (`graph` = ngày build dữ liệu đường), **không phải hợp đồng ổn định**.
- Toạ độ `from`/`to`/`via` nằm trong URL nên có trong log request của Cloudflare Workers (giữ tối đa 30 ngày, chỉ để chẩn đoán; xem [Điều khoản tenant](/dieu-khoan/) mục 5). Tenant là bên kiểm soát dữ liệu vị trí của người dùng cuối.
- Không có đường → `404 no_route`. Dịch vụ đang build lại dữ liệu (thứ Hai ~02:00 giờ VN, vài chục phút) → `503 upstream_unavailable` với `retry-after: 30`; bản cache còn trong 5 phút vẫn được trả.

### GET /v1/matrix

Bảng thời gian và quãng đường từ N điểm đi tới M điểm đến — để chọn tài xế gần nhất, kho gần nhất, cửa hàng gần nhất. Không có hình tuyến, không có bước rẽ. Tính bởi Valhalla trên dữ liệu đường OpenStreetMap, cùng graph với `/v1/directions`. Cần scope `places:read`, tính **một lượt quota Chỉ đường** bất kể cỡ (mục 3).

Thử không cần code: [Playground → Đội xe](/playground#doi-xe) có cả ma trận lẫn tối ưu thứ tự trên cùng một danh sách điểm.

| Tham số | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `sources` | `lat,lng;lat,lng…` | có | — | 1–25 điểm đi, vĩ độ trước |
| `targets` | `lat,lng;lat,lng…` | có | — | 1–25 điểm đến |
| `mode` | `motorbike` \| `car` \| `walk` | không | `motorbike` | |

Trần mỗi request: `sources × targets ≤ 50` cặp (ví dụ 10 × 5, 25 × 2, 1 × 50). Mọi điểm trong Việt Nam. Khoảng cách đường chim bay lớn nhất giữa bất kỳ điểm đi và điểm đến: xe máy 200 km, ô tô 400 km, đi bộ 50 km. Vượt bất kỳ trần nào → `400 invalid_request` nói rõ trần và phần tử vi phạm, **không tính lượt**.

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/matrix?sources=10.7798,106.6990;10.7725,106.6980&targets=10.7769,106.7032;10.7716,106.7043"
```

```json
{
  "mode": "motorbike",
  "sources": [[106.699, 10.7798], [106.698, 10.7725]],
  "targets": [[106.7032, 10.7769], [106.7043, 10.7716]],
  "durations_s": [[163, 253], [288, 199]],
  "distances_m": [[868, 1351], [1504, 1218]],
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "valhalla", "graph": "2026-09-17" }
}
```

Điểm cần chú ý:

- `durations_s[i][j]` và `distances_m[i][j]` là từ `sources[i]` tới `targets[j]`, số nguyên (giây, mét).
- Cặp **không nối được** (đảo, vùng đường tách rời) → `null` ở cả hai bảng; request vẫn `200`. Chỉ khi một điểm không bám được vào đường nào (giữa biển, giữa rừng) mới trả `404 no_route`.
- `sources`/`targets` trong response là toạ độ bạn gửi, đổi sang **`[lng, lat]`** (GeoJSON) như mọi response dẫn đường; tham số vào vẫn `lat,lng`.
- Cùng một điểm có thể xuất hiện ở cả hai bên; ô đó là `0`.
- Toạ độ nằm trong URL nên có trong log request của Cloudflare Workers (giữ tối đa 30 ngày, chỉ để chẩn đoán; xem [Điều khoản tenant](/dieu-khoan/) mục 5).
- Dịch vụ đang build lại dữ liệu (thứ Hai ~02:00 giờ VN) → `503 upstream_unavailable` với `retry-after: 30`; bản cache còn trong 5 phút vẫn được trả.

### GET /v1/optimized-route

Sắp thứ tự ghé tối ưu cho **một** chuyến nhiều điểm dừng — shipper nhận 8 đơn buổi sáng, hỏi đi theo thứ tự nào cho ngắn nhất. Điểm xuất phát và điểm kết thúc cố định, các điểm dừng được sắp lại. Response là đúng schema của `/v1/directions` cộng mảng `order`, nên vẽ và dẫn đường bằng cùng mã. Cần scope `places:read`, tính **một lượt quota Chỉ đường** bất kể số điểm.

| Tham số | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `from` | `lat,lng` | có | — | điểm xuất phát, luôn đứng đầu |
| `stops` | `lat,lng;lat,lng…` | có | — | 1–10 điểm cần ghé, thứ tự tuỳ ý |
| `to` | `lat,lng` | không | — | điểm kết thúc, luôn đứng cuối; **bỏ trống = quay về `from`** |
| `mode` | `motorbike` \| `car` \| `walk` | không | `motorbike` | |
| `lang` | `vi` \| `en` | không | `vi` | ngôn ngữ câu chỉ dẫn |

Mọi điểm trong Việt Nam; mỗi điểm dừng và `to` cách `from` không quá: xe máy 200 km, ô tô 400 km, đi bộ 50 km (đường chim bay). Không có `alternatives`.

```bash
curl -H "X-Api-Key: mlv_live_…" \
  "https://api.ai-solutions.io.vn/v1/optimized-route?from=10.7798,106.6990&stops=10.7716,106.7043;10.7769,106.7032&to=10.7725,106.6980"
```

```json
{
  "order": [1, 0],
  "routes": [{ "mode": "motorbike", "distance_m": 2604, "duration_s": 470, "legs": ["…3 leg…"], "…": "…" }],
  "waypoints": [
    { "location": [106.699, 10.7798], "snapped": [106.699, 10.7798], "name": null },
    { "location": [106.7032, 10.7769], "snapped": [106.7032, 10.7769], "name": null },
    { "location": [106.7043, 10.7716], "snapped": [106.7043, 10.7716], "name": null },
    { "location": [106.698, 10.7725], "snapped": [106.6981, 10.7725], "name": null }
  ],
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "valhalla", "graph": "2026-09-17" }
}
```

Điểm cần chú ý:

- `order[k]` là **chỉ số vào mảng `stops` bạn gửi** của điểm ghé thứ k. Ví dụ trên: đi `from` → `stops[1]` → `stops[0]` → `to`. `waypoints` và `routes[0].legs` đã xếp theo thứ tự đó; `routes[0].legs.length = stops + 1`.
- Response là `DirectionsResponse` đầy đủ (`geometry` polyline6, `steps` với câu tiếng Việt) — xem `GET /v1/directions` ở trên; đưa thẳng vào `map.routes.show()` hoặc `navigation.start()`.
- Không hỗ trợ kết thúc ở điểm bất kỳ (open-end), sức chứa, khung giờ khách hẹn hay nhiều xe — xem "Những thứ chưa có" trên website.
- Một điểm dừng không tới được → `404 no_route` cho cả chuyến.
- `stops` một điểm vẫn hợp lệ (`order: [0]`) để ứng dụng không phải rẽ nhánh theo số đơn.
- Cần nhiều hơn 50 cặp hay 10 điểm dừng thì chia thành nhiều request, nhớ nhịp 6 request/phút. Nhiều xe hay hơn 10 đơn thì dùng `POST /v1/fleet-plan` ngay dưới.

### POST /v1/fleet-plan

Chia đơn cho **đội xe**: gửi K xe và N đơn, nhận đơn nào giao xe nào, thứ tự ghé, giờ đến ước tính, đơn không xếp được, và **tuyến đầy đủ của từng xe** dạng `DirectionsResponse`. Bộ giải nhận sức chứa, khối lượng, thời gian dừng, khung giờ khách hẹn, giờ làm của xe và kết thúc mở. Cần scope `places:read`, body JSON, tính **một lượt quota Chỉ đường**, nhịp **2 request/phút/khoá**. Hướng dẫn kèm ví dụ ở [Giao hàng & đội xe](/doi-xe/) mục 3; thử không cần code ở [Playground → Đội xe](/playground#doi-xe).

| Trường | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `mode` | `motorbike` \| `car` \| `walk` | không | `motorbike` | một phương tiện cho cả đội |
| `lang` | `vi` \| `en` | không | `vi` | ngôn ngữ câu chỉ dẫn |
| `vehicles[]` | 1–5 phần tử | có | — | |
| `vehicles[].id` | chuỗi 1–64 ký tự | có | — | duy nhất trong `vehicles` |
| `vehicles[].start` | `[lat, lng]` | có | — | |
| `vehicles[].end` | `[lat, lng]` \| `"open"` | không | = `start` | `"open"` = kết thúc ở đơn cuối |
| `vehicles[].capacity` | số nguyên 0–1.000.000 | không | — | tất cả xe có hoặc không xe nào |
| `vehicles[].max_jobs` | số nguyên 1–10 | không | 10 | |
| `vehicles[].time_window` | `[ISO, ISO]` | không | — | giờ làm, ISO 8601 kèm múi giờ; có khung giờ ở bất kỳ đâu thì mọi xe phải có |
| `jobs[]` | 1–30 phần tử | có | — | không quá tổng `max_jobs` của các xe |
| `jobs[].id` | chuỗi 1–64 ký tự | có | — | duy nhất trong `jobs` |
| `jobs[].location` | `[lat, lng]` | có | — | |
| `jobs[].demand` | số nguyên 0–1.000.000 | không | 0 | `> 0` chỉ khi các xe có `capacity` |
| `jobs[].service_s` | số nguyên 0–7.200 | không | 0 | giây dừng tại điểm |
| `jobs[].priority` | số nguyên 0–100 | không | 0 | đơn ưu tiên được xếp trước khi không đủ chỗ |
| `jobs[].time_windows` | 1–3 `[ISO, ISO]` | không | — | mỗi khung tối đa 24 giờ; mọi mốc trong request nằm trong 48 giờ |

Mọi điểm trong Việt Nam; cặp điểm xa nhất không quá 200 km xe máy, 400 km ô tô, 50 km đi bộ (đường chim bay). Body tối đa 64 KB. Trường lạ bị bỏ qua.

```bash
curl -X POST -H "X-Api-Key: mlv_live_…" -H "content-type: application/json" \
  https://api.ai-solutions.io.vn/v1/fleet-plan \
  -d '{"vehicles":[{"id":"xe-1","start":[10.7725,106.698]},{"id":"xe-2","start":[10.7725,106.698],"end":"open"}],
       "jobs":[{"id":"don-1","location":[10.7826,106.6958],"service_s":120},{"id":"don-2","location":[10.7686,106.7069]}]}'
```

```json
{
  "mode": "motorbike",
  "vehicles": [
    {
      "vehicle": "xe-1",
      "jobs": ["don-2", "don-1"],
      "stops": [
        { "job": "don-2", "arrival_s": 300, "waiting_s": 0, "service_s": 0 },
        { "job": "don-1", "arrival_s": 700, "waiting_s": 0, "service_s": 120 }
      ],
      "load": 0,
      "finish_s": 1000,
      "routes": [{ "mode": "motorbike", "distance_m": 6120, "duration_s": 1380, "legs": ["…3 leg…"], "…": "…" }],
      "waypoints": ["…4 waypoint…"],
      "attribution": "© OpenStreetMap contributors"
    },
    { "vehicle": "xe-2", "jobs": [], "stops": [], "load": 0, "finish_s": 0, "routes": [], "waypoints": [], "attribution": "© OpenStreetMap contributors" }
  ],
  "unassigned": [],
  "summary": { "vehicles_used": 1, "jobs_assigned": 2, "jobs_unassigned": 0, "distance_m": 6120, "duration_s": 1380, "service_s": 120, "waiting_s": 0 },
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "vroom+valhalla", "graph": "2026-09-17" }
}
```

Điểm cần chú ý:

- `vehicles` theo đúng thứ tự bạn gửi, kể cả xe không được giao đơn (`jobs: []`, `routes: []`). Mỗi xe có đơn là một `DirectionsResponse` đầy đủ: `routes[0].legs.length` bằng số đơn, cộng 1 nếu xe về `end`; `waypoints` là start, các đơn theo thứ tự ghé, rồi end.
- **Chế độ thời gian.** Không có khung giờ thì chỉ có `arrival_s` và `finish_s` (giây kể từ lúc rời start). Mọi xe có `time_window` thì thêm `departure_at`, `stops[].arrival_at`, `finish_at` ISO 8601 theo múi giờ của `time_window[0]` của xe đó. Có khung giờ mà một xe thiếu `time_window` thì trả 400.
- `stops` lấy từ lịch của bộ giải (tính trên ma trận); `routes[0]` lấy từ chỉ đường. Lệch vài phần trăm là bình thường.
- `unassigned` là đơn không xếp được: hết `max_jobs`, quá `capacity` hoặc khung giờ không thoả. Không kèm lý do.
- Một điểm không tới được trả `404 no_route` cho cả request. Quá nhịp trả `429` với `retry-after: 60`. Bộ giải không phản hồi trả `503 upstream_unavailable`.

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
  "text": "© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Foursquare OS Places (Apache-2.0)",
  "html": "<a href=\"https://mapslibvn-site.pages.dev/\" target=\"_blank\" rel=\"noopener\">© MapsLibVN</a> · …",
  "links": [
    { "text": "© MapsLibVN", "href": "https://mapslibvn-site.pages.dev/" },
    { "text": "© OpenStreetMap contributors", "href": "https://www.openstreetmap.org/copyright", "license": "ODbL" }
  ]
}
```

Dùng chuỗi này khi bạn hiển thị kết quả API ngoài bản đồ. Nghĩa vụ chi tiết ở [Giấy phép & ghi nguồn](/giay-phep/).

### GET /v1/catalog

Bảng giá công khai: đúng những con số cổng khách hàng và website đang dùng. **Không cần khoá API.**
Cache 1 giờ.

```bash
curl "https://api.ai-solutions.io.vn/v1/catalog"
```

```json
{
  "currency": "VND",
  "usdReferenceRate": 26000,
  "periodMonths": [1, 3, 6, 12],
  "tiers": [
    { "tier": "trial", "priceVnd": 0, "places": 2000, "directions": 200,
      "dailyPlaces": 200, "dailyDirections": 20, "onlineSupport": false },
    { "tier": "starter", "priceVnd": 650000, "places": 30000, "directions": 3000,
      "dailyPlaces": null, "dailyDirections": null, "onlineSupport": false }
  ],
  "addOns": [
    { "group": "places", "units": 1000, "priceVnd": 26000 },
    { "group": "directions", "units": 1000, "priceVnd": 78000 }
  ]
}
```

`priceVnd` là giá **một tháng** của gói; kỳ nhiều tháng nhân đơn, không chiết khấu. `priceCents` đi
kèm mỗi dòng là quy đổi USD **tham chiếu** theo `usdReferenceRate`, không phải đồng tiền thu.
`dailyPlaces`/`dailyDirections` là trần ngày, `null` nghĩa là gói đó không có trần ngày riêng.

Hãy đọc endpoint này thay vì chép cứng con số: giá và hạn mức đổi bằng một lần phát hành máy chủ.

### GET /v1/styles/{theme}.json

Style MapLibre của MapsLibVN, đã điền sẵn URL bộ tiles hiện hành.

| Tham số | Kiểu | Bắt buộc | Mặc định | Khoảng |
|---|---|---|---|---|
| `theme` | chuỗi trong đường dẫn | có | — | `light` hoặc `dark` |
| `sources` | chuỗi truy vấn | không | `all` | `osm,fsq` (`all`), `osm` hoặc `fsq`; tổ hợp khác trả `400 invalid_request` |

Tên khác trả `404 not_found`. Cache 1 giờ. Route này **không kiểm khoá API**, nhưng SDK vẫn gắn `?key=` vào URL style để hành vi không đổi khi việc kiểm được bật về sau — đừng dựa vào việc endpoint hiện đang mở.

Header `x-poi-profile` cho biết archive đang phục vụ: `all`, `osm` hoặc `fsq`. Nếu archive của profile
hợp lệ chưa phát hành, header là `all;fallback` và API tạm dùng archive đầy đủ thay vì trả lỗi. POI do người dùng đóng góp luôn được giữ trong mọi profile.

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
  /** Phường/xã HIỆN HÀNH (2025) suy từ toạ độ POI qua ranh giới OSM; POI người dùng chưa qua pipeline: giá trị người tạo nhập. */
  ward?: string;
  /** Tỉnh/thành hiện hành, cùng cách suy như `ward`. */
  province?: string;
  /** Địa chỉ nguyên văn của nguồn (có thể theo quận/phường cũ). */
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
  source: 'osm' | 'fsq';
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
  verbal_alert: string | null;
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

interface MatrixResponse {
  mode: TravelMode;
  sources: [number, number][];        // [lng, lat], theo thứ tự bạn gửi
  targets: [number, number][];
  durations_s: (number | null)[][];   // [i][j]: giây từ sources[i] tới targets[j]; null = không nối được
  distances_m: (number | null)[][];   // mét; null cùng ô với durations_s
  attribution: string;
  engine?: { name: string; graph: string | null };
}

interface OptimizedRouteResponse extends DirectionsResponse {
  order: number[];                    // chỉ số vào `stops` theo thứ tự nên đi
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
- `MatrixResponse.durations_s` và `distances_m` là mảng hai chiều `[source][target]`; `null` là không nối được, không phải lỗi.

## 8. Đọc thêm

- [SDK JavaScript](/sdk/) — gọi các endpoint này bằng client có kiểu sẵn.
- [Khoá API](/khoa-api/) — ba loại khoá, cách xin khoá và cách xử lý khi lộ khoá.
- [Độ chính xác geocode](/do-chinh-xac/) — ý nghĩa `precision` và `confidence`.
- [Đóng góp & sửa POI](/dong-gop/) — hướng dẫn dùng `POST /v1/edits`.
- [Giấy phép & ghi nguồn](/giay-phep/) — nghĩa vụ khi hiển thị dữ liệu.
