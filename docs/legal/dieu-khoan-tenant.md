# Điều khoản sử dụng MapsLibVN dành cho tenant

*Bản nội bộ 1.0 — 02/09/2026. Áp dụng cho các ứng dụng nhúng MapsLibVN trong giai đoạn nội bộ. Chưa được luật sư rà soát; xem `docs/legal/checklist-phap-ly.md`.*

## 1. Định nghĩa

- **MapsLibVN**: nền tảng bản đồ (tiles, Places API, SDK web/React) do Đỗ Tiến Phong vận hành. MapsLibVN là thư viện độc lập, không gắn với bất kỳ ứng dụng cụ thể nào.
- **Tenant**: tổ chức hoặc cá nhân được cấp khoá API (`mlv_live_…`) để nhúng MapsLibVN vào ứng dụng của mình.
- **Người dùng cuối**: người sử dụng ứng dụng của tenant.
- **Dữ liệu nền**: dữ liệu bản đồ và địa điểm MapsLibVN cung cấp qua tiles và API, gồm dữ liệu OpenStreetMap (ODbL), Overture Maps (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0) và dữ liệu do người dùng đóng góp.

## 2. Khoá API

1. Khoá `web` gắn với danh sách origin (`allowed_origins`, hỗ trợ wildcard subdomain); khoá `server` là bí mật, chỉ dùng phía máy chủ; khoá `mobile` gắn bundle id.
2. Tenant chịu trách nhiệm cho mọi request mang khoá của mình. Khoá bị lộ phải báo để thu hồi và cấp lại.
3. MapsLibVN có thể tạm ngưng khoá khi phát hiện vi phạm mục 4 hoặc tải bất thường gây ảnh hưởng tenant khác; sẽ thông báo qua email đăng ký.
4. Giai đoạn nội bộ: không thu phí, không cam kết SLA. Hạn mức (quota) có thể được áp dụng khi chuyển sang giai đoạn thương mại và sẽ được báo trước 30 ngày.

## 3. Ghi nguồn (attribution)

1. Tenant **phải giữ nguyên** chuỗi ghi nguồn do SDK hiển thị hoặc do `GET /v1/attribution` trả về, gồm ít nhất: `© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Places: Overture Maps Foundation (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0)`.
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
5. Log request của MapsLibVN giữ tối đa 30 ngày; số liệu tổng hợp (Analytics Engine) không chứa định danh người dùng cuối.

## 6. Dữ liệu người dùng đóng góp và ODbL

1. Đóng góp gửi qua `POST /v1/edits` được cấp cho MapsLibVN quyền sử dụng, sửa đổi, phân phối không giới hạn thời gian; tenant bảo đảm người dùng cuối đã đồng ý điều này trong điều khoản của ứng dụng.
2. Dữ liệu OSM và các bảng dẫn xuất thuần OSM (đường, hẻm, ranh giới hành chính) là Derivative Database của OpenStreetMap theo ODbL 1.0; MapsLibVN cung cấp bản xuất (`pnpm export:odbl`) khi có yêu cầu qua email ở mục 10. Bản đồ và kết quả API là Produced Work theo ODbL, chỉ yêu cầu ghi nguồn.

## 7. Độ chính xác và giới hạn trách nhiệm

1. Dữ liệu nền được tổng hợp từ nguồn mở và đóng góp cộng đồng; MapsLibVN **không bảo đảm** tính chính xác, đầy đủ hay cập nhật. Mỗi kết quả geocode kèm `precision` và `confidence` — tenant phải dùng chúng khi ra quyết định (xem trang "Độ chính xác geocode").
2. Không dùng MapsLibVN cho mục đích mà sai lệch vị trí có thể gây thiệt hại về người hoặc tài sản (điều hướng khẩn cấp, hàng không, hàng hải) nếu không có nguồn xác minh độc lập.
3. Trong mọi trường hợp, trách nhiệm của MapsLibVN đối với tenant không vượt quá số tiền tenant đã trả trong 12 tháng gần nhất (giai đoạn nội bộ: 0 đ).

## 8. Thay đổi dịch vụ

MapsLibVN có thể thay đổi API, style, domain hoặc điều khoản này; thay đổi không tương thích ngược sẽ được báo trước ít nhất 30 ngày qua email đăng ký và trang docs. Domain tiles/API hiện tại (`tiles.ai-solutions.io.vn`, `api.ai-solutions.io.vn`) là tạm thời trong giai đoạn nội bộ.

## 9. Chấm dứt

Tenant có thể ngừng sử dụng bất kỳ lúc nào. MapsLibVN thu hồi khoá khi tenant vi phạm mục 3–5 và không khắc phục trong 7 ngày sau thông báo, hoặc ngay lập tức nếu vi phạm gây hại cho hệ thống hoặc bên thứ ba.

## 10. Liên hệ

Email: dotienphong1993@gmail.com — ghi tiêu đề `[MapsLibVN]`. Yêu cầu bản xuất ODbL, báo lộ khoá, báo sai dữ liệu chủ quyền: gửi cùng địa chỉ này.
