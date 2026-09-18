---
title: Khoá API
description: Ba loại khoá web/mobile/server, cách kiểm origin, scope, quota, khoá demo và cách xin khoá MapsLibVN.
---

Mọi endpoint `/v1/*` đọc dữ liệu Places đều cần khoá API. Khoá có dạng `mlv_live_…`, gắn với một
tenant và một plan. Trang này nói khoá hoạt động thế nào và làm sao có khoá.

## 0. Lấy khoá trong năm phút

Tự đăng ký ở [cổng khách hàng](https://api.ai-solutions.io.vn/console/): nhập email, nhận mã sáu
số, đặt tên tổ chức, và khoá đầu tiên hiện ra ngay. Bản dùng thử gồm 2.000 lượt Places cùng 200
lượt tính tuyến trong 30 ngày, không cần thẻ thanh toán.

Ba điều cần nhớ:

- **Khoá dạng rõ chỉ hiện đúng một lần.** Máy chủ chỉ lưu `sha256(khoá)`, nên mất là phải cấp
  khoá mới — kể cả chúng tôi cũng không đọc lại được.
- **Cấp thêm khoá không cấp thêm hạn mức.** Mọi khoá của cùng một tổ chức trừ vào cùng một hạn
  mức; cấp nhiều khoá là để tách môi trường và thu hồi riêng khi một khoá bị lộ.
- **Mỗi tổ chức tối đa 10 khoá đang hoạt động.** Khoá đã thu hồi không tính vào con số này.

Khoá tự cấp có scope `places:read`. Cần thêm `edits:write` để người dùng cuối gửi đóng góp thì
liên hệ, vì quyền đó ghi vào dữ liệu bản đồ dùng chung.

## 1. Cách truyền khoá

Một cách duy nhất — header:

```bash
curl -H "X-Api-Key: mlv_live_…" "https://api.ai-solutions.io.vn/v1/search?q=cà+phê"
```

Máy chủ chỉ đọc header `X-Api-Key`; từ 09/09/2026 **không** còn nhận `?key=` trên URL của route có
kiểm khoá (khoá trên URL lọt vào log, `Referer`, cache). Thiếu header trả `401 missing_key`. Khoá sai
hoặc đã thu hồi trả `401 invalid_key`. Phía máy chủ chỉ lưu `sha256(khoá)`: khoá gốc được in đúng
một lần khi cấp, mất là phải cấp lại.

SDK tự làm việc này: `createClient({ apiKey, baseUrl })` gắn header `X-Api-Key` vào mọi request, còn
URL style bản đồ thì gắn `?key=` vì MapLibre tải style bằng `fetch` riêng.

Hai endpoint **không** cần khoá: `GET /v1/attribution` và `GET /healthz`. Route
`GET /v1/styles/{light|dark}.json` cũng không kiểm khoá, nhưng SDK vẫn gắn `?key=` để thống nhất.

## 2. Ba loại khoá

| `kind` | Dùng cho | Máy chủ kiểm gì | Có phải bí mật không |
|---|---|---|---|
| `web` | trang web, SPA | `Origin` hoặc `Referer` phải khớp `allowed_origins` | Không — khoá lộ ra trong mã trang là bình thường |
| `mobile` | app iOS/Android | không kiểm origin; `X-Bundle-Id` được **ghi log**, chưa dùng để chặn | Không, nhưng nên giữ trong cấu hình build |
| `server` | backend của bạn, script, cron | không kiểm origin | **Có** — không được để lộ ra client |

Khoá `web` không phải bí mật, hàng rào là `allowed_origins` cộng với quota. Khoá `server` thì ngược
lại: ai có nó là gọi được, nên chỉ để ở phía máy chủ.

## 3. Kiểm origin cho khoá `web`

Máy chủ lấy header `Origin`, không có thì lấy `Referer`, rồi so với từng mẫu trong
`allowed_origins`:

- So **protocol + hostname**. Port bị bỏ qua hoàn toàn: `http://localhost` khớp cả
  `http://localhost:5500` lẫn `http://localhost:4321`.
- Khác protocol là không khớp: `https://vidu.vn` không khớp `http://vidu.vn`.
- Wildcard subdomain `https://*.vidu.vn` khớp `https://app.vidu.vn`, `https://a.b.vidu.vn` và khớp
  **cả** `https://vidu.vn`.
- `allowed_origins` rỗng nghĩa là không giới hạn origin.
- Request **đọc** không có `Origin` lẫn `Referer` thì cho qua (chủ ý giai đoạn MVP: `curl` và gọi
  từ máy chủ vẫn chạy được). Request **ghi** (`POST /v1/edits`, scope `edits:write`) thì bắt buộc
  có `Origin`/`Referer` hợp lệ, thiếu trả `403 origin_required` — khoá web nằm trong HTML nên ai
  cũng lấy được, không thể cho gửi edit từ máy lạ.

Không khớp thì trả `403 origin_not_allowed`. Trên trình duyệt lỗi này hiện ra dưới dạng bản đồ
trắng và một dòng đỏ trong console — xem [Cài đặt](/cai-dat/) mục 5.

Khoá `mobile` không có `allowed_origins`. App gửi `bundleId`, SDK React Native chuyển thành header
`X-Bundle-Id`; máy chủ ghi vào log theo tenant để đối chiếu, chưa từ chối request nào vì lý do này.

## 4. Scope

| Scope | Cho phép |
|---|---|
| `places:read` | `/v1/autocomplete`, `/v1/search`, `/v1/nearby`, `/v1/places/{id}`, `/v1/geocode`, `/v1/reverse` |
| `edits:write` | `POST /v1/edits` — gửi đóng góp, xem [Đóng góp & sửa POI](/dong-gop/) |

Khoá thiếu scope cần thiết trả `403` với code `scope` và message nêu rõ scope còn thiếu. Scope mặc
định khi cấp khoá là `places:read`; muốn cho người dùng cuối sửa POI thì xin thêm `edits:write`.

## 5. Quota

Quota thương mại tính chung theo **tenant**, không tách riêng từng key. Free dùng thử có tổng
2.000 Places + 200 tuyến trong 30 ngày, đồng thời tối đa 200 + 20 mỗi ngày. Starter,
Professional và Business dùng hạn mức theo kỳ thuê bao. Chỉ response 2xx đã được client xác nhận
mới cộng lượt; lỗi 4xx/5xx không cộng. SDK tự xác nhận, còn người gọi REST trực tiếp phải ACK receipt
theo [REST API](/api/#xác-nhận-receipt-khi-gọi-rest-trực-tiếp).

| Giới hạn | Giá trị | Áp cho |
|---|---|---|
| Burst Places | 60 lượt / phút / điểm Cloudflare | mỗi cặp khoá + IP, gộp 6 endpoint `places:read` |
| Burst Chỉ đường | 20 lượt / phút / điểm Cloudflare | mỗi cặp khoá + IP, riêng `GET /v1/directions` |
| Trần theo khoá Chỉ đường | 100 lượt / phút / điểm Cloudflare | mọi IP cộng lại; chỉ khoá `web` và `mobile` (kể cả tenant internal), khoá `server` không chịu |
| Lượt gọi Places | 20.000 / ngày (plan `free`) | mỗi khoá, gộp cả 6 endpoint `places:read` |
| Đóng góp theo người dùng cuối | 20 / ngày | mỗi `end_user_token` |
| Đóng góp theo khoá | 500 / ngày | mỗi khoá API |

Bốn điều cần biết:

- Burst limit chạy tại edge theo hash của cặp khoá + IP, kể cả tenant `internal`; vượt ngưỡng trả
  `429 rate_limit_exceeded` với `retry-after: 60`. Bộ đếm theo từng điểm Cloudflare và cập nhật bất
  đồng bộ, nên đây là lớp chống spam chứ không phải số liệu tính cước chính xác; IP thô không được
  đưa vào counter key.
- **Ngày tính theo giờ Việt Nam** (UTC+7, không có giờ mùa hè). Bộ đếm về 0 lúc 00:00 giờ VN.
- Dòng 20.000/ngày trong bảng là cơ chế legacy cho tenant chưa chuyển đổi. Tenant thương mại dùng
  Durable Object theo tenant và chặn đúng hạn mức còn lại của kỳ/ngày.
- Tenant nội bộ (plan `internal`) không bị quota ngày, kể cả khoá demo; burst limit vẫn áp dụng.

Người vận hành có thể nghiệm thu burst limit bằng một URL autocomplete đã warm cache, không biến
smoke test thành load test DB lạnh:

```bash
pnpm smoke:rate-limit --confirm-production
```

Lệnh tự đọc `KEY_EXAMPLE_EMBED` từ `.env`; có thể override bằng biến môi trường
`MAPSLIBVN_API_KEY`. Lệnh fail nếu không thấy `429`, nếu có timeout/4xx/5xx bất ngờ, hoặc nếu
response không đúng `rate_limit_exceeded` + `Retry-After: 60`. Do bộ đếm permissive/bất đồng bộ,
request 61 có thể còn được cho qua; tiêu chí là quan sát được 429 trong 75 request, không phải dùng
số thứ tự bị chặn để tính cước.

Vượt hạn mức trả `429 quota_exceeded`; `error.details` cho biết nhóm `places` hoặc `directions`, lý
do, thời điểm reset khi xác định được và lựa chọn nâng gói/mua thêm. Giới hạn đóng góp cũng trả
`quota_exceeded` nhưng theo bộ đếm riêng của `/v1/edits`.

Hạn mức từng gói, quy tắc reset, lượt mua thêm và ví dụ JSON của từng lỗi nằm ở
[REST API mục 3](/api/#3-quota-và-cache). Ba điều hay bị hiểu nhầm:

- **Hết lượt và hết quyền là hai chuyện.** Hết lượt trả `429 quota_exceeded` và có thể mua thêm;
  hết hạn dùng thử, hết hạn thuê bao hoặc bị tạm dừng trả `403 subscription_expired` — mua thêm
  lượt không mở lại được, phải gia hạn.
- **Cấp thêm khoá không cấp thêm hạn mức.** Mọi khoá của một tenant tiêu chung một sổ; thu hồi rồi
  cấp lại khoá cũng không reset bộ đếm.
- **Chỉ tổng dùng thử theo ngày mới có mốc reset chắc chắn.** Hạn mức của kỳ trả phí không kèm
  `resetAt`, vì kỳ sau chỉ được cấp sau khi xác nhận thanh toán.

## 6. Khoá demo

Để thử nhanh, không cần xin gì: mở [playground](/playground.html) — ô **Khoá API** để trống là
trang tự dùng khoá demo. Cần chuỗi khoá để dán vào mã của bạn thì lấy ngay trong ô đó.

Khoá demo không in ở đây vì nó được xoay định kỳ; một trang tài liệu chép cứng chuỗi khoá sẽ chỉ
đúng cho tới lần xoay kế tiếp.

Đây là khoá `kind=web` của tenant nội bộ, **chỉ đọc** (`places:read`; từ 09/09/2026 không còn
`edits:write` — thử đóng góp thì xin khoá riêng ở mục 7), `allowed_origins`:

| Origin cho phép | Ghi chú |
|---|---|
| `http://localhost` | mọi port — `:5500`, `:4321`, `:3000`… |
| `http://127.0.0.1` | mọi port |
| `https://mapslibvn-docs.pages.dev` | trang tài liệu này |
| `https://*.mapslibvn-docs.pages.dev` | bản preview của Cloudflare Pages |

Nghĩa là khoá demo chạy được trên máy bạn và trên trang này, **không** chạy trên tên miền thật của
bạn. Muốn nhúng vào trang thật thì xin khoá riêng ở mục 7. Xem
[Nhúng thử trang của bạn](/nhung-thu/) để dùng khoá demo trong 2 phút.

Đừng dùng khoá demo cho sản phẩm: nó dùng chung, có thể bị đổi hoặc thu hồi bất cứ lúc nào, và
`https` trên tên miền của bạn sẽ bị chặn ngay.

## 7. Xin khoá riêng

Gửi email tới **dotienphong1993@gmail.com**, tiêu đề bắt đầu bằng `[MapsLibVN]` (theo
[Điều khoản tenant](/dieu-khoan/) mục 10). Trong thư ghi:

1. **Loại khoá**: `web`, `mobile` hay `server`.
2. **Origin** đầy đủ nếu là khoá `web` — kèm protocol, ví dụ `https://vidu.vn` và
   `https://*.vidu.vn`. Nêu cả origin môi trường staging nếu cần.
3. **Bundle id / application id** nếu là khoá `mobile`.
4. **Mục đích và quy mô ước tính** — để chọn hạn mức.
5. **Có cần `edits:write`** hay không.

MapsLibVN đang ở giai đoạn nội bộ, chưa thu phí. Điều kiện sử dụng nằm trong
[Điều khoản tenant](/dieu-khoan/).

## 8. Khi lộ khoá

- Khoá `web` lộ ra HTML là **bình thường theo thiết kế** — không cần làm gì, trừ khi
  `allowed_origins` của bạn quá rộng (ví dụ để rỗng). Khi đó hãy xin thu hẹp lại.
- Khoá `server` hoặc `mobile` lộ ra chỗ công khai (repo public, log, ảnh chụp màn hình): báo ngay
  theo địa chỉ ở mục 7, ghi rõ "báo lộ khoá". Khoá bị thu hồi sẽ trả `401 invalid_key`.
- Sau khi thu hồi, kết quả tra khoá còn nằm trong bộ nhớ đệm của máy chủ tối đa **5 phút** rồi mới
  hết hiệu lực hoàn toàn.
- Đừng nhúng khoá `server` vào ứng dụng client. Nếu cần gọi từ trình duyệt, hãy dùng khoá `web` có
  origin hẹp.

Đọc thêm: [Cài đặt](/cai-dat/) để nhúng SDK, [Nhúng thử trang của bạn](/nhung-thu/) để chạy thử với
khoá demo, [Đóng góp & sửa POI](/dong-gop/) cho scope `edits:write`.
