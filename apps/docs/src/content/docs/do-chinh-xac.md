---
title: Độ chính xác geocode
description: Ý nghĩa của precision và confidence trong kết quả /v1/geocode và /v1/reverse, và cách dùng đúng trong ứng dụng.
---

Mọi kết quả geocode của MapsLibVN kèm hai trường: `precision` (mức phân giải) và `confidence` (độ tin, từ 0 đến 1). Ứng dụng **phải** đọc hai trường này trước khi dùng toạ độ. Đây là nguyên tắc "trung thực về độ chính xác" của MapsLibVN: thà nói rõ kết quả chỉ tới mức đường, còn hơn ghim sai một điểm trông như chính xác.

## 1. Thang phân giải

API thử lần lượt từ mức chi tiết nhất và dừng ở mức đầu tiên có kết quả:

| `precision` | Khi nào | Vị trí trả về | `confidence` |
|---|---|---|---|
| `rooftop` | có mốc địa chỉ cùng số nhà (kể cả chuỗi hẻm như `88/9`) và cùng đường | toạ độ mốc | 0,9 · **0,95** nếu mốc do người dùng đóng góp |
| `alley` | biết hẻm nhưng không có mốc số nhà trong hẻm | điểm trên hẻm, cách cửa hẻm khoảng 6 m mỗi căn, tối đa hết chiều dài hẻm | 0,7 |
| `interpolated` | có mốc số nhỏ hơn và mốc số lớn hơn trên cùng đường, cùng chẵn hoặc cùng lẻ, cách nhau không quá 400 m | nội suy tuyến tính theo hình đường | 0,6 |
| `street` | chỉ khớp tên đường, trong phường hoặc tỉnh đã nêu, hoặc gần điểm `near` | điểm giữa tuyến đường | 0,4 |
| `ward` / `province` | chỉ khớp phường/xã hoặc tỉnh/thành | tâm đơn vị hành chính | 0,2 |
| `district` | chỉ khớp một **quận/huyện trước sắp xếp 2025** (cấp huyện đã bỏ, nên đây luôn là vùng lịch sử) | tâm vùng cũ, nhãn kèm `(trước 07/2025)` | 0,2 |

Khi tên đường trùng ở nhiều nơi, chẳng hạn có năm đường mang tên "Nguyễn Lâm", API ưu tiên theo phường hoặc tỉnh xuất hiện trong câu, rồi theo điểm `near`, rồi trả nhiều kết quả tối đa bằng `limit`.

### Địa chỉ viết theo đơn vị hành chính cũ

Gửi địa chỉ theo cách viết **trước sắp xếp 2025** vẫn ra đúng vị trí: API phân giải tên cũ sang đơn
vị hiện hành trước khi chạy thang phân giải ở trên. Khi điều đó xảy ra, kết quả có thêm
`matched.former` ghi lại tên cũ đã dùng để khớp:

```json
{
  "precision": "rooftop",
  "confidence": 0.9,
  "matched": {
    "housenumber": "37", "street": "Phan Chu Trinh",
    "ward": "Phường Sài Gòn", "province": "Thành phố Hồ Chí Minh",
    "former": { "ward": "Phường Bến Thành", "district": "Quận 1" }
  }
}
```

`display_name` luôn dùng **tên hiện hành**; `former` chỉ để giải thích vì sao khớp. Sự có mặt của
`former` **không** làm đổi `precision` hay `confidence` — hai trường đó vẫn do nguồn khớp quyết định.

## 2. Ví dụ

```bash
curl -G "https://api.ai-solutions.io.vn/v1/geocode" \
  -H "X-Api-Key: mlv_live_…" \
  --data-urlencode "q=88/9 Nguyễn Lâm, Phường 6, Quận 10"
```

```json
{
  "items": [
    {
      "lat": 10.7712,
      "lng": 106.6698,
      "precision": "alley",
      "confidence": 0.7,
      "matched": {
        "housenumber": "88/9",
        "street": "Nguyễn Lâm",
        "ward": "Phường 6",
        "province": "Thành phố Hồ Chí Minh"
      },
      "display_name": "88/9 Nguyễn Lâm, Phường 6, Thành phố Hồ Chí Minh"
    }
  ]
}
```

Dùng SDK:

```js
import { createClient } from '@mapslibvn/core';

const client = createClient({ apiKey: 'mlv_live_…', baseUrl: 'https://api.ai-solutions.io.vn' });
const { items } = await client.geocode('88/9 Nguyễn Lâm, Phường 6, Quận 10');
const [best] = items;
if (best?.precision === 'rooftop') ghimChinhXac(best);
else hienVongTronUocLuong(best);
```

## 3. Dùng đúng trong ứng dụng

- **Ghim marker như một điểm chính xác** chỉ khi `precision` là `rooftop`. Với `alley` và `interpolated`, hãy vẽ vòng tròn ước lượng bán kính khoảng 30 đến 80 m, hoặc ghi rõ dấu "≈".
- **Không tự động điều hướng hay giao hàng** dựa trên kết quả có `confidence` dưới 0,6. Hãy hỏi lại người dùng, hoặc cho họ kéo marker để xác nhận.
- **`street`, `ward` và `province`** chỉ nên dùng để căn khung nhìn bản đồ, không dùng làm toạ độ điểm đến.
- **Kết quả `reverse`** trả số nhà ước lượng dạng "≈ 86–90" khi có hai mốc cùng đường ở hai phía, hoặc "≈ 88" khi chỉ có một mốc. Nếu không có mốc nào, kết quả mô tả theo địa điểm gần nhất, ví dụ "gần Chợ Bến Thành".
- Người dùng cuối có thể sửa vị trí sai qua [Đóng góp & sửa POI](/dong-gop/). Mốc địa chỉ do người dùng xác nhận được ưu tiên và nâng `confidence` lên 0,95 ở các lần geocode sau.

## 4. Giới hạn đã biết

- Tên phường và xã sau sắp xếp hành chính năm 2025 được ánh xạ từ tên cũ bằng bảng alias suy ra từ chồng lớp ranh giới OSM trước và sau sắp xếp. Bảng này **chưa đầy đủ toàn quốc**: OSM còn thiếu ranh giới cấp tỉnh của Khánh Hòa và một phần ranh giới phường/xã, nên câu địa chỉ dùng tên cũ ở những vùng đó có thể rơi xuống mức `province`. Phần đã kiểm chứng: phân giải tên cũ chạy trước cả thang `rooftop → alley → interpolated → street`, giữ đúng phạm vi phường/tỉnh, và ghi tên cũ đã dùng vào `matched.former`.
- Số nhà không theo quy luật chẵn lẻ, thường thấy ở khu đô thị mới hoặc nơi còn song song số cũ và số mới, làm mức `interpolated` lệch. Hãy coi `confidence` 0,6 là "cần xác minh".
- Dữ liệu ngoài đô thị lớn thưa hơn Thành phố Hồ Chí Minh và Hà Nội, nên tỷ lệ đạt mức `rooftop` thấp hơn.
