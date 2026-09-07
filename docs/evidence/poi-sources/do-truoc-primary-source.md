# Đo trước — phân bố `primary_source` trên production

Ngày đo: 07/09/2026. Nguồn: `state/reports/poi-report-20260831.json` trên R2 (do `report.mjs`
sinh ra ở lần `data:update --poi` gần nhất, 31/08/2026; `bySource` đếm mọi `status`).
Đây là bản POI đang phục vụ production — chưa có lần publish POI nào sau 31/08.

| primary_source | n | % |
|---|---:|---:|
| overture | 1.174.282 | 77,1 % |
| fsq | 241.809 | 15,9 % |
| osm | 106.325 | **7,0 %** |

Tổng `bySource`: 1.522.416. POI active: 1.515.983; closed: 6.433.
Tỷ lệ POI có từ hai nguồn trở lên (`multiSourcePct`): **3,3 %**.

## Kết luận cổng

Cổng của plan là **OSM ≥ 40 %**. Thực đo **7,0 %** → **KHÔNG ĐẠT**, lệch xa ngưỡng.

Mặc định `sources=['osm']` sẽ làm bản đồ và Places API chỉ còn khoảng **106 nghìn POI thay vì
1,52 triệu (mất ~93 %)**. Không phải "thưa hơn" mà là gần như trống ở phần lớn lãnh thổ. Theo
spec mục 9 nghiệm thu 1, dừng plan và báo PHONG; không tự đổi mặc định.

## Quan sát thêm cần chú ý

`multiSourcePct` chỉ 3,3 % nghĩa là conflation hầu như **không** ghép được POI OSM với bản sinh đôi
của nó ở Overture/FSQ. Hai cách đọc, cả hai đều làm lung lay tiền đề "nguồn chính phản ánh chất
lượng":

1. OSM Việt Nam thật sự chỉ có ~106 nghìn POI trong bộ lọc tag hiện tại, còn Overture (gồm dữ liệu
   Meta/Microsoft) dày hơn một bậc — khi đó "chỉ OSM" là mất dữ liệu, không phải lọc rác.
2. Hoặc ngưỡng ghép của `conflate.mjs` quá chặt nên cùng một địa điểm bị tính hai lần ở hai nguồn —
   khi đó `primary_source` không nói được nguồn nào tốt hơn.

Cần phân định trước khi quyết định mặc định.
