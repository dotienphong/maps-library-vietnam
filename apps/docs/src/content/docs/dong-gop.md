---
title: Đóng góp & sửa POI
description: Gửi sửa giờ mở cửa, thêm địa điểm mới qua POST /v1/edits và SDK suggestEdit.
---

Người dùng cuối của app nhúng có thể sửa thông tin địa điểm hoặc thêm địa điểm mới.
Khoá API phải có scope `edits:write`.

## Gửi một sửa đổi

```js
import { createClient } from '@mapslibvn/core';

const client = createClient({
  apiKey: 'mlv_live_…',
  baseUrl: 'https://api.mapslibvn.example',
});

// end_user_token: chuỗi BẤT KỲ ổn định theo người dùng của app bạn (id nội bộ, uuid lưu
// localStorage…). Server chỉ lưu bản băm cùng tenant — MapsLibVN không nhận dữ liệu định danh.
const result = await client.suggestEdit({
  poi_id: '01H…',
  kind: 'update',
  changes: { hours: 'Mo-Su 07:00-22:00' },
  end_user_token: 'user-12345',
});
// result.status: 'auto_approved' (áp dụng ngay) hoặc 'pending' (chờ quản trị duyệt)
```

## Thêm địa điểm mới

```js
const created = await client.suggestEdit({
  kind: 'create',
  changes: {
    name: 'Bánh Mì Cô Ba',
    lat: 10.7735,
    lng: 106.699,
    category: 'restaurant',
    housenumber: '12',
    street: 'Lê Lợi',
  },
  end_user_token: 'user-12345',
});
// created.poi_id: id POI mới — trạng thái pending, CHỈ tenant của bạn thấy qua
// GET /v1/places/{id} cho tới khi được duyệt; chưa xuất hiện trong /v1/search.
```

## Các loại đóng góp

| `kind` | Ý nghĩa | Cần gì thêm |
|---|---|---|
| `update` | Sửa thông tin POI đã có | `poi_id` + ít nhất một trường trong `changes` |
| `create` | Thêm địa điểm mới | `changes.name` và `changes.lat`/`lng` |
| `close` | Báo địa điểm đã đóng cửa | `poi_id` |
| `reopen` | Báo địa điểm mở lại | `poi_id` (POI đang ở trạng thái đóng) |
| `report` | Báo sai/trùng, không tự sửa | `poi_id` + `note` nêu lý do |

Trường được phép sửa trong `changes`: `name`, `lat`/`lng`, `category`, `housenumber`, `street`,
`ward`, `province`, `address_text`, `contact` (`phone[]`, `website[]`, `facebook`) và `hours`
(chuỗi opening_hours OSM hoặc `{ osm: '…' }`). Trường lạ bị bỏ qua; toạ độ ngoài Việt Nam bị từ chối.

## Luật duyệt

| Trường hợp | Kết quả |
|---|---|
| Chỉ đổi `hours`/`contact` trên POI chất lượng tốt (`quality_score` ≥ 60) | Tự duyệt, thấy ngay |
| Từ 2 người dùng khác nhau gửi cùng một thay đổi trong 30 ngày | Tự duyệt |
| Còn lại (tạo mới, đổi tên hoặc vị trí, đóng cửa, báo lỗi) | Chờ quản trị duyệt |

Thay đổi đã được duyệt sẽ **khoá** trường tương ứng: các lần cập nhật dữ liệu tự động sau đó
không ghi đè lên nữa. Địa chỉ có số nhà còn tạo thêm một mốc geocoding riêng, giúp tìm đúng
vị trí cho các lần tra cứu sau.

## Giới hạn và lỗi

Mỗi `end_user_token` gửi tối đa 20 đóng góp một ngày, mỗi khoá API tối đa 500 — vượt thì trả
`429 quota_exceeded`. Các lỗi khác theo chuẩn chung của API: `400 invalid_request` (body sai),
`401` (thiếu/sai khoá), `403 scope` (khoá không có `edits:write`), `404 not_found` (không có POI).

```js
import { MapsLibVNError } from '@mapslibvn/core';

try {
  await client.suggestEdit({ poi_id, kind: 'close', end_user_token: token });
} catch (err) {
  if (err instanceof MapsLibVNError && err.code === 'quota_exceeded') {
    // báo người dùng thử lại ngày mai
  }
}
```
