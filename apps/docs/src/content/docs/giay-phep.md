---
title: "Giấy phép dữ liệu và chuỗi ghi nguồn"
description: "SDK MapsLibVN theo giấy phép MIT, dữ liệu mở từ OpenStreetMap (ODbL) và Foursquare OS Places (Apache-2.0), chuỗi ghi nguồn bắt buộc và cách áp dụng ODbL."
---

## 1. Mã nguồn SDK — MIT

`@mapslibvn/core`, `@mapslibvn/web`, `@mapslibvn/react` và `@mapslibvn/react-native` phát hành theo giấy phép **MIT**. Bạn được dùng thương mại, sửa, phân phối lại; chỉ cần giữ thông báo bản quyền. Mỗi gói kèm `LICENSE` và `THIRD_PARTY_NOTICES.md` — xem [Thông báo bên thứ ba](/thong-bao-ben-thu-ba/) để biết nguyên văn giấy phép của từng thành phần.

Phần máy chủ (Worker API, pipeline dữ liệu, hạ tầng) không được phân phối.

## 2. Dữ liệu — ba nguồn, ba giấy phép

| Nguồn | Dùng cho | Giấy phép | Nghĩa vụ của bạn |
|---|---|---|---|
| OpenStreetMap contributors | tiles nền, đường, hẻm, ranh giới, một phần POI | ODbL 1.0 | giữ ghi nguồn `© OpenStreetMap contributors` |
| OpenMapTiles | lược đồ lớp tiles và thiết kế style | BSD-3-Clause + CC-BY 4.0 | giữ ghi nguồn `© OpenMapTiles` |
| Foursquare OS Places | địa điểm (POI) | Apache-2.0 | giữ ghi nguồn |

Dữ liệu do người dùng cuối đóng góp qua [Đóng góp & sửa POI](/dong-gop/) là dữ liệu riêng của MapsLibVN.

## 3. Chuỗi ghi nguồn bắt buộc

SDK luôn hiển thị điều khiển attribution. Có tuỳ chọn `compact` nhưng **không có tuỳ chọn tắt** — yêu cầu này đến từ giấy phép của dữ liệu và của style nền, không phải lựa chọn của MapsLibVN.

```
© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Foursquare OS Places (Apache-2.0)
```

File style của MapsLibVN mang chuỗi này ở từng nguồn tiles, nên bản đồ có ghi nguồn cả khi ai đó nạp thẳng file style vào MapLibre mà không qua SDK, lẫn khi bạn ẩn lớp POI. Nếu bạn dùng style riêng, SDK tự thêm chuỗi này vào điều khiển attribution.

Nếu bạn hiển thị kết quả API ngoài bản đồ (danh sách, trang chi tiết địa điểm), hãy lấy chuỗi này từ API và kèm ở cùng màn hình:

```js
import { createClient } from '@mapslibvn/core';

const client = createClient({
  apiKey: 'mlv_live_…',
  baseUrl: 'https://api.ai-solutions.io.vn',
});
const { text, html, links } = await client.attribution();
```

Endpoint tương ứng là `GET /v1/attribution`, cache 24 giờ.

## 4. ODbL — cách MapsLibVN áp dụng

- Dữ liệu OSM nằm trong bảng riêng. Các bảng đường, hẻm và ranh giới hành chính dẫn xuất thuần từ OSM là **Derivative Database** theo ODbL. MapsLibVN cung cấp bản xuất (CSV kèm hình học WKT và manifest) khi có yêu cầu — liên hệ theo [Điều khoản tenant](/dieu-khoan/) mục 10.
- Bản ghi địa điểm của MapsLibVN chép trường từ **đúng một** nguồn chính và chỉ liên kết các nguồn khác bằng ID (mô hình Collective Database), không trộn trường giữa các nguồn.
- Bản đồ hiển thị và kết quả API là **Produced Work**: chỉ yêu cầu ghi nguồn, không yêu cầu chia sẻ lại dữ liệu của bạn.

## 5. Phông, icon và style nền

Phông Noto Sans theo SIL Open Font License 1.1, icon Maki theo CC0 1.0, style sáng dẫn xuất từ osm-liberty và style tối dẫn xuất từ dark-matter (cả hai BSD-3-Clause cho mã, CC-BY cho thiết kế). Tất cả đều phục vụ từ hạ tầng của MapsLibVN, không gọi CDN bên thứ ba.

## 6. Pháp luật Việt Nam

- Bản đồ thể hiện đầy đủ chủ quyền Việt Nam với Hoàng Sa và Trường Sa ở mọi mức zoom. Đây là yêu cầu kỹ thuật bắt buộc của pipeline tiles và là điều kiện sử dụng, xem [Điều khoản tenant](/dieu-khoan/) mục 4.
- MapsLibVN đã có gói trả phí (xem [Khoá API](/khoa-api/) mục 0). Hồ sơ giấy phép hoạt động đo đạc và bản đồ theo Điều 51 Luật Đo đạc và bản đồ 2018 đang trong quá trình rà soát với luật sư; trang này sẽ ghi số giấy phép khi có.
- Về dữ liệu cá nhân theo Nghị định 13/2023: MapsLibVN không nhận dữ liệu định danh người dùng cuối; nghĩa vụ xin phép truy cập vị trí thuộc ứng dụng nhúng. Chi tiết ở [Điều khoản tenant](/dieu-khoan/) mục 5.
