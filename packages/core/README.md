# @mapslibvn/core

Client TypeScript không phụ thuộc giao diện cho Places API MapsLibVN, kèm kiểu dữ liệu, chuẩn hóa
tiếng Việt và chuỗi ghi nguồn dùng chung.

## Cài đặt

```bash
npm install @mapslibvn/core
```

Yêu cầu Node.js 22+ khi chạy phía máy chủ. Trình duyệt hiện đại có sẵn `fetch` cũng dùng được.

## Ví dụ

```ts
import { createClient } from '@mapslibvn/core';

const places = createClient({
  apiKey: 'mlv_live_…',
  baseUrl: 'https://api.ai-solutions.io.vn',
});

const { items } = await places.autocomplete('cho ben thanh', {
  near: [106.7, 10.776],
  limit: 5,
});
```

API gồm autocomplete, search, nearby, geocode, reverse geocode, chi tiết địa điểm, style URL và
gửi đề xuất chỉnh sửa. Không đưa khóa bí mật vào mã nguồn hoặc commit; khóa trình duyệt phải giới
hạn đúng origin.

Tài liệu: <https://mapslibvn-docs.pages.dev/sdk/>

Giấy phép mã nguồn: MIT. Khi hiển thị dữ liệu bản đồ, phải giữ attribution theo tài liệu và
`THIRD_PARTY_NOTICES.md`.
