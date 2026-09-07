# Biên soạn `toponym_alias.json`

Từ điển biến thể địa danh — spec 05/09 mục 6.1. Dạng chuẩn → biến thể, tất cả đã normalizeVi.
LUẬT BIÊN SOẠN, test packages/core/tests/toponym.test.ts khoá lại:
  1. Mỗi mục phải có `source` kiểm được: osm:<type>/<id> <tag> hoặc wikipedia:vi:<trang>.
     Mọi dòng dưới đây lấy từ Overpass ngày 07/09/2026 (tag alt_name / old_name thật trên OSM).
  2. Biến thể phải KHÁC dạng chuẩn sau normalizeVi — cặp chỉ khác dấu (Vũng Tàu/Vũng Tầu)
     đã trùng nhau nên không đưa vào.
  3. Chỉ đưa vào biến thể mà `viKey` KHÔNG gộp được; phần còn lại đã có bậc 3 lo. Đo ngày
     07/09: viKey tự gộp 17/33 cặp ứng viên của spec (qui nhon, bac can, kontum, mi tho,
     saigon, hanoi, danang, dalat, sapa, cholon, cantho, xoc trang, hoian, li son, ki anh…).
     Ngoại lệ được phép: `qui nhon` và `daklak` — viKey gộp được nhưng chúng nằm trong tiêu chí
     nghiệm thu 11.6 nên cần khớp ngay ở BẬC 1, và cả hai có nguồn OSM chắc chắn.

ĐÃ CÂN NHẮC RỒI BỎ:
  - `sai gon` → `ho chi minh` (osm:relation/1973756 alt_name): đây là đổi TÊN, không phải cách
    viết. parseAddress đã canonicalize tỉnh qua provinces.json; đưa vào đây sẽ làm POI tên
    'Sài Gòn' mang khoá của 'ho chi minh'.
  - `phan rang` → `phan rang thap cham` (osm:node/369486933 alt_name): tên RÚT GỌN, không phải
    cách viết khác. Đưa vào sẽ làm 'Cafe Phan Rang' mang khoá của thành phố.
  - `poulo condore islands` → `con dao` (osm:relation/3612628 old_name): tên thực dân tiếng Anh,
    gần như không ai gõ; tốn kích cỡ bundle mà không có giá trị tra cứu.
  - `dac lac`, `dak lac`, `dac lak`, `dac nong`, `plei ku`, `play cu`, `nhatrang`, `haiphong`,
    `soctrang`, `rachgia`: KHÔNG tìm được nguồn OSM. Không đoán. Bốn ca dính từ cuối là giới hạn
    đã biết của viKey (luật đầu từ không áp giữa từ) — ghi ở JSDoc của viKey; Task 16 đo xem có
    cần bổ sung kèm nguồn hay không.
