---
title: Khoá API
description: Ba loại khoá web/mobile/server, cách kiểm origin, scope, quota, khoá demo và cách xin khoá MapsLibVN.
---

Mọi endpoint `/v1/*` đọc dữ liệu Places đều cần khoá API. Khoá có dạng `mlv_live_…`, gắn với một
tenant và một plan. Trang này nói khoá hoạt động thế nào và làm sao có khoá.

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

| Giới hạn | Giá trị | Áp cho |
|---|---|---|
| Lượt gọi Places | 20.000 / ngày (plan `free`) | mỗi khoá, gộp cả 6 endpoint `places:read` |
| Đóng góp theo người dùng cuối | 20 / ngày | mỗi `end_user_token` |
| Đóng góp theo khoá | 500 / ngày | mỗi khoá API |

Ba điều cần biết:

- **Ngày tính theo giờ Việt Nam** (UTC+7, không có giờ mùa hè). Bộ đếm về 0 lúc 00:00 giờ VN.
- Bộ đếm lượt Places là **đếm xấp xỉ** (ghi bất đồng bộ vào KV), nên máy chủ chỉ trả `429` khi vượt
  **2 lần** hạn mức — để không chặn nhầm vì đếm trễ. Đừng dựa vào đó: hãy coi 20.000 là mức thật.
- Tenant nội bộ (plan `internal`) không bị đếm, kể cả khoá demo.

Vượt hạn mức trả `429 quota_exceeded` kèm header `retry-after: 3600`. Giới hạn đóng góp cũng trả
`429 quota_exceeded` nhưng theo bộ đếm riêng của `/v1/edits`.

## 6. Khoá demo

Để thử nhanh, không cần xin gì:

```
mlv_live_demo00000000000000000000
```

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
