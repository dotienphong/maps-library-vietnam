---
title: Tính năng
description: MapsLibVN có gì — bản đồ nền Việt Nam, lớp POI 164 loại, Places API, geocode trung thực về độ chính xác, đóng góp cộng đồng và SDK cho web, React, React Native.
---

MapsLibVN là thư viện bản đồ và Places cho Việt Nam: tiles nền, lớp địa điểm, REST API và SDK,
dựng lại được toàn bộ từ mã nguồn. Trang này liệt kê những gì thư viện làm được hôm nay và những
gì chưa.

## 1. Bản đồ nền Việt Nam

Tiles ở định dạng **PMTiles** đặt trên Cloudflare R2. Trình duyệt đọc thẳng từ R2 bằng HTTP Range,
không đi qua máy chủ API — SDK tự đăng ký protocol `pmtiles://` trước khi tạo bản đồ.

- Hai theme: `light` và `dark`, phục vụ qua `GET /v1/styles/light.json` và `dark.json`.
- Nhãn hai ngôn ngữ: `lang: 'vi'` (mặc định) hoặc `'en'`. Biểu thức nhãn là
  `['coalesce', ['get', 'name:en'], ['get', 'name']]`, nên nơi nào chưa có tên tiếng Anh vẫn hiện
  tên tiếng Việt.
- **Nhãn chủ quyền luôn tiếng Việt.** Lớp `sovereignty-label` được `applyLanguage` bỏ qua, nên
  "Quần đảo Hoàng Sa (Việt Nam)" và "Quần đảo Trường Sa (Việt Nam)" không bao giờ đổi sang ngôn ngữ
  khác. Hai nhãn này hiển thị từ zoom 4 trở lên, tức là ngay khi cả nước nằm trong khung hình.
- Chủ quyền được bảo vệ ở ba tầng: vá dữ liệu OSM trước khi build, lớp nhãn riêng trong style, và
  bước QA trong pipeline chặn phát hành nếu tiles hoặc style không đạt.

## 2. Lớp POI — 164 loại trong 13 nhóm

Biểu tượng POI xuất hiện tăng dần từ zoom 10 theo độ quan trọng và mật độ. Nhãn địa danh lớn xuất
hiện từ zoom 12; nhãn địa điểm địa phương từ zoom 16. POI không hiện trên nền vẫn tìm được qua
Search/Nearby. Biểu tượng chọn theo nhóm.

| Nhóm | Số mã | Ví dụ mã |
|---|---|---|
| `food_drink` | 14 | `restaurant` Nhà hàng, `cafe` Quán cà phê, `fast_food` Đồ ăn nhanh |
| `shopping` | 24 | `supermarket` Siêu thị, `convenience` Cửa hàng tiện lợi, `mall` Trung tâm thương mại |
| `services` | 21 | `hair_salon` Tiệm tóc, `beauty_salon` Thẩm mỹ, làm đẹp, `spa` Spa, massage |
| `health` | 11 | `hospital` Bệnh viện, `clinic` Phòng khám, `pharmacy` Nhà thuốc |
| `education` | 13 | `kindergarten` Trường mầm non, `primary_school` Trường tiểu học, `secondary_school` Trường THCS |
| `finance` | 6 | `bank` Ngân hàng, `atm` ATM, `money_exchange` Đổi tiền |
| `lodging` | 8 | `hotel` Khách sạn, `motel` Nhà nghỉ, `hostel` Hostel |
| `entertainment_sport` | 16 | `cinema` Rạp chiếu phim, `karaoke` Karaoke, `nightclub` Vũ trường, club |
| `culture_tourism` | 15 | `museum` Bảo tàng, `art_gallery` Phòng tranh, `theatre` Nhà hát |
| `transport` | 13 | `bus_stop` Trạm xe buýt, `bus_station` Bến xe, `train_station` Ga tàu |
| `public_admin` | 13 | `town_hall` UBND, trụ sở chính quyền, `police` Công an, `fire_station` Trạm cứu hoả |
| `religion_community` | 9 | `pagoda` Chùa, `church` Nhà thờ, `temple` Đền, miếu, đình |
| `other` | 1 | `other` Địa điểm khác |

Mã `code` dùng trực tiếp làm tham số `category` của `/v1/search` và `/v1/nearby`.

Mặc định bản đồ và Places API dùng **cả hai nguồn** (`all`). Ba profile là `all` (`osm,fsq`), `osm`
và `fsq`. Trong SDK, các profile riêng dùng `poiSources: ['osm']`, `['fsq']`; REST dùng
`sources=osm`, `sources=fsq`. Lớp POI cho từng tập nguồn được build thành archive riêng nên mật độ
hiển thị luôn đúng, không có lỗ trống. Nếu archive hợp lệ chưa có, style fallback về `all` và báo
`x-poi-profile: all;fallback`. POI người dùng luôn được giữ; `GET /v1/places/{id}` không lọc theo
profile.

Dữ liệu POI gộp từ hai nguồn mở: OpenStreetMap (ODbL) và Foursquare OS Places (Apache-2.0). Mỗi POI
có **một nguồn chính** (`primary`) quyết định toạ độ
và tên; các nguồn khác gắn vai trò `secondary` và hiện trong trường `sources` của
`GET /v1/places/{id}`.

## 3. Places API

Chín endpoint: tám đọc, một ghi. Xác thực bằng header `X-Api-Key` — từ 09/09/2026 máy chủ không còn nhận khoá trên URL.

| Endpoint | Làm gì | Tham số chính |
|---|---|---|
| `GET /v1/autocomplete` | gợi ý khi đang gõ | `q` từ 2 ký tự; `near` "lat,lng"; `limit` 1–10 (mặc định 10); `types` `poi,street,address` |
| `GET /v1/search` | tìm POI theo tên, loại hoặc vùng | cần ít nhất một trong `q`, `category`, `near`, `bbox`; `radius` 1–50 000 (5 000); `limit` 1–50 (20); `offset` 0–500 |
| `GET /v1/nearby` | POI quanh một điểm | `lat`, `lng` bắt buộc; `radius` 1–5 000 (500); `limit` 1–100 (20); `category` |
| `GET /v1/places/{id}` | chi tiết một POI | trả thêm `sources` và `attribution` |
| `GET /v1/geocode` | địa chỉ chữ → toạ độ | `q` từ 2 ký tự; `near`; `limit` 1–5 (5) |
| `GET /v1/reverse` | toạ độ → địa chỉ | `lat`, `lng` |
| `GET /v1/directions` | tuyến đường, bước rẽ tiếng Việt | `from`, `to` "lat,lng" bắt buộc; `via` tối đa 5 điểm; `mode` `motorbike`/`car`/`walk`; tính vào quota **Chỉ đường** riêng |
| `GET /v1/attribution` | chuỗi ghi nguồn chuẩn | không cần khoá |
| `POST /v1/edits` | gửi đóng góp, sửa POI | cần scope `edits:write` |

Ngoài ra có `GET /v1/styles/{light|dark}.json` cho style bản đồ, `GET /v1/catalog` cho bảng giá
đọc bằng máy, và `GET /healthz` (kèm `/healthz/db`, `/healthz/routing`) để kiểm tra dịch vụ — cả ba
đều không cần khoá. Chi tiết đầy đủ ở [REST API](/api/).

## 4. Geocode trung thực về độ chính xác

`/v1/geocode` không chỉ trả toạ độ. Mỗi kết quả kèm `precision` — một trong `rooftop`, `alley`,
`interpolated`, `street`, `ward`, `province` — và `confidence` từ 0 đến 1. Ứng dụng đọc hai trường
này để quyết định ghim marker chính xác hay chỉ vẽ vùng ước lượng.

`/v1/reverse` tìm theo bán kính cố định: đường trong 150 m, mốc số nhà trong 300 m, POI gần nhất
trong 100 m; số nhà trả về dạng ước lượng ("≈ 86–90"). Xem
[Độ chính xác geocode](/do-chinh-xac/).

## 5. Chỉ đường

`GET /v1/directions` trả tuyến cho **xe máy** (không lên cao tốc), **ô tô** và **đi bộ** giữa hai điểm
trong Việt Nam, tối đa 5 điểm dừng, kèm bước rẽ tiếng Việt (hoặc tiếng Anh) có câu đọc bằng giọng nói.
Engine là Valhalla tự host trên dữ liệu đường OpenStreetMap, cập nhật cùng kỳ với tiles nền. Kết quả
theo schema riêng của MapsLibVN (`Route`, `RouteStep`), không lộ định dạng engine. Chưa có giao thông
trực tiếp, chưa tránh phí/cao tốc theo yêu cầu; SDK web dẫn đường từng bước trên thiết bị: bám GPS vào
tuyến, đọc câu tiếng Việt đúng lúc bằng giọng nói, tự tính lại khi lệch, báo đến nơi — xem
[Dẫn đường](/dan-duong/). SDK React Native dẫn đường cả khi khoá máy, phiên độc lập với màn hình bản đồ —
[Dẫn đường trên React Native](/dan-duong-react-native/). Trên React Native còn có la bàn + con quay hồi
chuyển: puck xoay theo điện thoại khi đứng yên, chấm xanh có nón hướng, `useHeading()` cho UI riêng.
Chi tiết REST API ở [REST API](/api/) mục 4.

## 6. Đóng góp và duyệt

Người dùng cuối gửi được đề xuất sửa qua `POST /v1/edits` với `kind` là `create`, `update`,
`close`, `reopen` hoặc `report`. Mỗi `end_user_token` gửi tối đa 20 đóng góp một ngày, mỗi khoá API
tối đa 500. Trường do người dùng sửa được khoá lại (`locked_fields`) nên pipeline dữ liệu không ghi
đè ở lần chạy sau; địa chỉ có số nhà còn tạo thêm mốc geocoding mới. Xem
[Đóng góp & sửa POI](/dong-gop/).

## 7. Ghi nguồn bắt buộc

SDK luôn gắn `AttributionControl`, và file style cũng khai đúng chuỗi đó ngay trong từng nguồn
tiles, nên bản đồ có ghi nguồn kể cả khi nạp thẳng vào MapLibre không qua SDK. MapLibre gộp hai
chuỗi trùng nhau nên người xem chỉ thấy một lần. Có tuỳ chọn
`compactAttribution` để hiển thị gọn, **không có tuỳ chọn tắt** — đây là nghĩa vụ giấy phép của
ODbL và Apache-2.0, không phải lựa chọn giao diện. Xem
[Giấy phép & ghi nguồn](/giay-phep/).

## 8. SDK — bốn gói

| Gói | Dùng cho | Xuất chính |
|---|---|---|
| `@mapslibvn/core` | mọi môi trường có `fetch` | `createClient`, `MapsLibVNError`, `attributionText/Html`, các kiểu dữ liệu |
| `@mapslibvn/web` | trang web, HTML thuần | `createMap`, `applyLanguage`, `MapsLibVNAutocomplete`, `defineAutocomplete` |
| `@mapslibvn/react` | React trên web | `<MapsLibVNMap>`, `useMap`, `<Marker>`, `usePlaces` |
| `@mapslibvn/react-native` | app iOS và Android | xem [React Native](/react-native/) |

Bản **UMD** của `@mapslibvn/web` (`mapslibvn.umd.js` + `mapslibvn.css`) đóng gói sẵn `maplibre-gl`
và `pmtiles`, tạo global `MapsLibVN` và tự đăng ký web component `<mapslibvn-autocomplete>` — nhúng
bằng đúng một thẻ `<script>`, không cần bước build.

## 9. Kiến trúc tóm tắt

| Thành phần | Chạy ở đâu | Chi phí |
|---|---|---|
| Tiles PMTiles nền Việt Nam và lớp POI | Cloudflare R2 kèm custom domain, client đọc thẳng bằng HTTP Range | 0 đồng egress |
| Places API, styles, trang duyệt đóng góp | Cloudflare Worker chạy Hono | gói Workers Free đủ cho nội bộ |
| Postgres 16 kèm PostGIS | máy nội bộ chạy 24/7 trong Docker, nối ra qua Cloudflare Tunnel rồi Access rồi Hyperdrive | tiền điện và máy |
| Engine chỉ đường Valhalla | container `valhalla` trên cùng máy chủ, không mở cổng; Worker gọi qua Cloudflare Tunnel | tiền điện và máy |
| Pipeline dữ liệu OSM, Foursquare | container `pipeline` trên máy chủ, cron thứ Hai 02:00 | — |
| Tài liệu | Cloudflare Pages | 0 đồng |

Vì tiles không chạm Worker, lượt tải bản đồ không tính vào hạn mức request của Worker. Chi tiết ở
[Tự host](/tu-host/).

## 10. Trạng thái và giới hạn hiện tại

- **Bốn gói `@mapslibvn/*` đã public trên npm** dưới dist-tag `latest`. Bản UMD
  vẫn dùng được cho ứng dụng không có bundler. Xem [Cài đặt](/cai-dat/).
- Endpoint `https://api.ai-solutions.io.vn` và `https://mapslibvn-docs.pages.dev` là **tạm thời**
  trong giai đoạn nội bộ, sẽ đổi khi MapsLibVN có tên miền riêng.
- Dữ liệu ngoài các đô thị lớn thưa hơn Thành phố Hồ Chí Minh và Hà Nội, nên tỷ lệ geocode đạt mức
  `rooftop` thấp hơn ở những nơi đó.
- Bảng alias tên phường, xã sau sắp xếp hành chính năm 2025 **chưa đầy đủ toàn quốc** — OSM còn
  thiếu ranh giới cấp tỉnh của Khánh Hòa và một phần ranh giới phường/xã; câu địa chỉ dùng tên cũ ở
  những vùng đó có thể rơi xuống mức `province`.
- Gợi ý loại `area` xếp **dưới POI** trong cùng một lượt vì điểm của vùng hành chính không có
  thành phần độ phổ biến. Bù lại, khi truy vấn là **thuần tên hành chính** (có phường/quận/tỉnh mà
  không có số nhà hay tên đường, ví dụ "Quận 10") thì một suất trong danh sách luôn được dành cho
  vùng. Truy vấn có tên đường hoặc số nhà thì không dành suất — lúc đó bạn đang tìm địa chỉ. Muốn
  chỉ lấy vùng thì gọi `/v1/autocomplete` với `types=area`.
- **Chỉ đường** dựa trên dữ liệu đường một chiều và cấm rẽ của OSM Việt Nam, còn thiếu ở nhiều nơi; tuyến nội thành có thể kém ứng dụng thương mại. ETA theo cấp đường, không có giao thông trực tiếp.
- **Chưa có tiles offline.** MapLibre Native đọc được PMTiles qua `file://` nên có thể bổ sung sau.
- Khoá API tự cấp được ở [cổng khách hàng](https://api.ai-solutions.io.vn/console/) (bản dùng thử
  30 ngày, không cần thẻ); khoá `mobile`, khoá `server` và scope `edits:write` vẫn xin qua email —
  xem [Khoá API](/khoa-api/).
- **Mã máy chủ chưa mở.** Bốn gói SDK là MIT trên npm, nhưng Worker API, pipeline và hạ tầng nằm
  trong repo private; liên hệ theo [Điều khoản tenant](/dieu-khoan/) mục 10 để xin quyền.
- **Chưa cam kết SLA.** Xem [Điều khoản tenant](/dieu-khoan/) mục 2.

Đọc thêm: [Cài đặt](/cai-dat/), [Bản đồ web](/ban-do-web/),
[Tìm kiếm & autocomplete](/tim-kiem/), [REST API](/api/), [SDK JavaScript](/sdk/).
