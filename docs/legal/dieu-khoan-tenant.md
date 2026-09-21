# Điều khoản sử dụng MapsLibVN dành cho tenant

*Bản 1.1 — 21/09/2026. Áp dụng cho mọi ứng dụng nhúng MapsLibVN, kể cả tenant đang dùng thử và tenant trả phí. Chưa được luật sư rà soát; xem `docs/legal/checklist-phap-ly.md`.*

## 1. Định nghĩa

- **MapsLibVN**: nền tảng bản đồ (tiles, Places API, Routing API, SDK web/React/React Native) do Đỗ Tiến Phong vận hành. MapsLibVN là thư viện độc lập, không gắn với bất kỳ ứng dụng cụ thể nào.
- **Tenant**: tổ chức hoặc cá nhân được cấp khoá API (`mlv_live_…`) để nhúng MapsLibVN vào ứng dụng của mình.
- **Người dùng cuối**: người sử dụng ứng dụng của tenant.
- **Dữ liệu nền**: dữ liệu bản đồ và địa điểm MapsLibVN cung cấp qua tiles và API, gồm dữ liệu OpenStreetMap (ODbL), Foursquare OS Places (Apache-2.0) và dữ liệu do người dùng đóng góp.

## 2. Khoá API

1. Khoá `web` gắn với danh sách origin (`allowed_origins`, hỗ trợ wildcard subdomain); khoá `server` là bí mật, chỉ dùng phía máy chủ; khoá `mobile` gắn bundle id.
2. Tenant chịu trách nhiệm cho mọi request mang khoá của mình. Khoá bị lộ phải báo để thu hồi và cấp lại.
3. MapsLibVN có thể tạm ngưng khoá khi phát hiện vi phạm mục 4 hoặc tải bất thường gây ảnh hưởng tenant khác; sẽ thông báo qua email đăng ký.
4. Tenant tự đăng ký ở cổng khách hàng (`https://api.ai-solutions.io.vn/console/`); mỗi tổ chức giữ tối đa 10 khoá đang hoạt động. Mọi khoá của một tổ chức tiêu chung một hạn mức — cấp thêm khoá không cấp thêm lượt.
5. **Hạn mức đang có hiệu lực.** Bản dùng thử 30 ngày và các gói trả phí đều bị chặn theo hạn mức của gói; vượt trả `429 quota_exceeded`, hết quyền dùng trả `403 subscription_expired`. Con số từng gói ở `GET /v1/catalog` và trang REST API của tài liệu.
6. **Thanh toán.** Gói mua theo kỳ 1, 3, 6 hoặc 12 tháng, giá nhân đơn theo số tháng, thanh toán qua PayOS; hạn mức mở khi thanh toán được xác nhận. Lượt mua thêm bán theo khối 1.000, tách riêng Places và Chỉ đường, **hết hạn cùng kỳ đã mua và không chuyển sang kỳ sau**, chỉ dùng được khi thuê bao trả phí còn hoạt động. Lượt trong gói được tiêu trước lượt mua thêm.
7. **Chưa cam kết SLA.** MapsLibVN chưa cam kết mức sẵn sàng hay thời gian khắc phục; tenant chịu rủi ro gián đoạn. Thay đổi giá hoặc hạn mức của gói được báo trước ít nhất 30 ngày qua email đăng ký và áp dụng từ kỳ kế tiếp, không hồi tố kỳ đã thanh toán.

## 3. Ghi nguồn (attribution)

1. Tenant **phải giữ nguyên** chuỗi ghi nguồn do SDK hiển thị hoặc do `GET /v1/attribution` trả về, gồm ít nhất: `© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Foursquare OS Places (Apache-2.0)`.
2. Không được che, thu nhỏ đến mức không đọc được, hoặc gỡ điều khiển attribution của SDK. Chế độ `compact` được phép.
3. Khi hiển thị kết quả API ngoài bản đồ (danh sách, chi tiết địa điểm), tenant phải kèm dòng ghi nguồn dạng văn bản ở cùng màn hình.
4. Yêu cầu ghi nguồn OpenMapTiles đến từ giấy phép thiết kế của style nền (CC-BY 4.0), không phải lựa chọn của MapsLibVN — xem `THIRD_PARTY_NOTICES.md` mục 2.

## 4. Hành vi bị cấm

1. **Cào hoặc xuất hàng loạt** dữ liệu nền: gọi API có hệ thống để tái tạo kho địa điểm, tải toàn bộ tiles để lưu ngoài, hoặc lưu kết quả API quá 24 giờ ngoài mục đích cache hiển thị.
2. Bán lại, cấp phép lại hoặc cung cấp API/tiles MapsLibVN cho bên thứ ba như một dịch vụ độc lập.
3. Dùng dữ liệu nền để xây dựng cơ sở dữ liệu địa điểm cạnh tranh hoặc để huấn luyện mô hình mà không có thoả thuận riêng.
4. Chỉnh sửa hoặc che khuất các yếu tố thể hiện chủ quyền lãnh thổ Việt Nam trên bản đồ.
5. Vượt qua cơ chế kiểm origin, quota hoặc giả mạo header định danh.

Nếu tenant cần dữ liệu OSM dẫn xuất theo ODbL, hãy yêu cầu bản xuất chính thức (mục 6) thay vì cào API.

## 5. Dữ liệu cá nhân và vị trí (Nghị định 13/2023/NĐ-CP)

1. MapsLibVN **không nhận** dữ liệu định danh người dùng cuối. Khi gửi đóng góp (`POST /v1/edits`), SDK chỉ gửi một token do chính ứng dụng của tenant cấp; MapsLibVN lưu `end_user_hash = sha256(tenant_id + token)` chứ không lưu token. Tenant không được dùng số điện thoại, email hay số giấy tờ làm token này.
2. Để chống spam, MapsLibVN lưu `ip_hash = sha256(IP + ngày theo giờ Việt Nam)`: **địa chỉ IP thô không được lưu**, và vì muối xoay theo ngày nên không liên kết được hoạt động của cùng một IP giữa các ngày. Lưu ý kỹ thuật trung thực: mã băm này chống liên kết chéo ngày, không nhằm mục đích chống dò ngược.
3. **Tenant là bên kiểm soát dữ liệu** đối với người dùng cuối của mình: tenant chịu trách nhiệm xin và ghi nhận sự đồng ý khi truy cập vị trí thiết bị, thông báo mục đích xử lý, và đáp ứng quyền của chủ thể dữ liệu theo Nghị định 13/2023.
4. Tenant không được truyền vào API các trường chứa dữ liệu cá nhân nhạy cảm ngoài các trường công khai của địa điểm (`name`, `phone` của cơ sở kinh doanh, `website`, `hours`).
5. Log request của MapsLibVN (Cloudflare Workers Logs) giữ tối đa 30 ngày và chỉ dùng để chẩn đoán lỗi. Vì tham số nằm trong URL, log này có **toạ độ mà ứng dụng gửi lên** — `near`, `lat`/`lng` của tìm kiếm và reverse geocode, `from`/`to`/`via` của chỉ đường — kèm định danh khoá API của tenant, không kèm định danh người dùng cuối. MapsLibVN không trích xuất, không ghép các toạ độ này thành hành trình hay hồ sơ người dùng, không chuyển cho bên thứ ba. Số liệu tổng hợp (Analytics Engine) chỉ có đường dẫn endpoint, không có tham số. Tenant có nghĩa vụ nêu việc này trong thông báo xử lý dữ liệu với người dùng cuối của mình (điểm 3).

## 6. Dữ liệu người dùng đóng góp và ODbL

1. Đóng góp gửi qua `POST /v1/edits` được cấp cho MapsLibVN quyền sử dụng, sửa đổi, phân phối không giới hạn thời gian; tenant bảo đảm người dùng cuối đã đồng ý điều này trong điều khoản của ứng dụng.
2. Dữ liệu OSM và các bảng dẫn xuất thuần OSM (đường, hẻm, ranh giới hành chính) là Derivative Database của OpenStreetMap theo ODbL 1.0; MapsLibVN cung cấp bản xuất (`pnpm export:odbl`) khi có yêu cầu qua email ở mục 10. Bản đồ và kết quả API là Produced Work theo ODbL, chỉ yêu cầu ghi nguồn.

## 7. Độ chính xác và giới hạn trách nhiệm

1. Dữ liệu nền được tổng hợp từ nguồn mở và đóng góp cộng đồng; MapsLibVN **không bảo đảm** tính chính xác, đầy đủ hay cập nhật. Mỗi kết quả geocode kèm `precision` và `confidence` — tenant phải dùng chúng khi ra quyết định (xem trang "Độ chính xác geocode").
2. Không dùng MapsLibVN cho mục đích mà sai lệch vị trí có thể gây thiệt hại về người hoặc tài sản (điều hướng khẩn cấp, hàng không, hàng hải) nếu không có nguồn xác minh độc lập.
3. Trong mọi trường hợp, trách nhiệm của MapsLibVN đối với tenant không vượt quá số tiền tenant đã trả cho MapsLibVN trong 12 tháng gần nhất; với tenant chỉ dùng bản dùng thử, con số đó là 0 đồng.

## 8. Thay đổi dịch vụ

MapsLibVN có thể thay đổi API, style, domain hoặc điều khoản này; thay đổi không tương thích ngược sẽ được báo trước ít nhất 30 ngày qua email đăng ký và trang docs. Domain tiles/API hiện tại (`tiles.ai-solutions.io.vn`, `api.ai-solutions.io.vn`) là **tạm thời** và sẽ đổi khi MapsLibVN có tên miền riêng; việc đổi này cũng theo thời hạn báo trước 30 ngày.

## 9. Chấm dứt

Tenant có thể ngừng sử dụng bất kỳ lúc nào. MapsLibVN thu hồi khoá khi tenant vi phạm mục 3–5 và không khắc phục trong 7 ngày sau thông báo, hoặc ngay lập tức nếu vi phạm gây hại cho hệ thống hoặc bên thứ ba.

## 10. Liên hệ

Email: dotienphong1993@gmail.com — ghi tiêu đề `[MapsLibVN]`. Yêu cầu bản xuất ODbL, báo lộ khoá, báo sai dữ liệu chủ quyền: gửi cùng địa chỉ này.
