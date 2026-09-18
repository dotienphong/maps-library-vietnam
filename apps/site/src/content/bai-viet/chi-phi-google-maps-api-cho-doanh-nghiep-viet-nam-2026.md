---
title: Chi phí Google Maps API cho doanh nghiệp Việt Nam
description: Google tính tiền theo từng loại yêu cầu chứ không theo lần mở bản đồ. Bài này bóc tách ba khoản hay làm hoá đơn phình và bốn cách giảm chi phí ngay.
publishedAt: '2026-09-18'
tags: ['chi phí', 'Google Maps', 'so sánh']
daDuyet: false
---

Hoá đơn Google Maps Platform hay gây bất ngờ không phải vì đơn giá cao, mà vì cách tính khác với
hình dung của phần lớn đội kỹ thuật. Người ta thường nghĩ "một lần mở bản đồ là một lượt". Thực tế
mỗi thao tác của người dùng có thể sinh ra vài yêu cầu tính tiền khác nhau, mỗi loại một đơn giá.

Bài này bóc tách chỗ tiền thật sự đi đâu, rồi đưa ra bốn cách giảm chi phí mà không phải đổi nhà
cung cấp. Phần cuối mới nói tới lúc nào việc đổi là hợp lý.

## Tiền đi đâu

Google chia sản phẩm bản đồ thành nhiều loại yêu cầu riêng biệt, mỗi loại có hạn mức miễn phí và
bậc giá riêng. Ba loại dưới đây chiếm phần lớn hoá đơn của các ứng dụng Việt Nam.

**Gợi ý địa chỉ khi đang gõ.** Đây là khoản dễ phình nhất. Mỗi lần ký tự thay đổi mà ứng dụng gọi
lên máy chủ là một yêu cầu tính tiền. Một người dùng gõ "Nguyễn Huệ" có thể sinh ra chín yêu cầu
nếu ứng dụng gọi sau mỗi phím. Google có cơ chế gom các yêu cầu của cùng một lần tìm thành một
phiên, tính tiền một lần, nhưng ứng dụng phải chủ động dùng cơ chế đó. Nhiều đội không biết và trả
tiền theo từng ký tự suốt nhiều tháng.

**Chuyển địa chỉ thành toạ độ.** Mỗi lần gọi là một lượt. Vấn đề thường nằm ở chỗ ứng dụng gọi lại
cho cùng một địa chỉ đã tra trước đó, ví dụ mỗi lần mở lại màn hình đơn hàng.

**Tính tuyến đường.** Đắt hơn hai loại trên, và cũng hay bị gọi lặp khi màn hình được vẽ lại.

Ngoài ra còn lượt tải bản đồ nền, chi tiết địa điểm, ma trận khoảng cách. Mỗi loại một dòng riêng
trong hoá đơn.

## Hạn mức miễn phí hết nhanh hơn bạn tưởng

Hạn mức miễn phí được tính theo từng loại yêu cầu, không phải một túi chung. Nghĩa là bạn có thể
còn dư rất nhiều ở loại này trong khi đã vượt ở loại khác và bắt đầu bị tính tiền. Với một ứng dụng
giao hàng cỡ vừa, phần gợi ý địa chỉ thường là loại vượt đầu tiên, vì mỗi đơn hàng đều đi qua một
ô tìm địa chỉ.

Một cách ước lượng nhanh: lấy số đơn hàng hoặc số lượt tìm kiếm mỗi tháng, nhân với số yêu cầu
trung bình mỗi lượt, rồi so với hạn mức của đúng loại đó. Nếu ứng dụng chưa gom yêu cầu thành
phiên, con số nhân sẽ là số ký tự trung bình người dùng gõ, chứ không phải một.

## Ba mức dùng thật

Bảng dưới đây so chi phí một tháng cho cùng một khối lượng gọi API, đối chiếu ngày 14/09/2026.
Giả định: 80% là gợi ý địa chỉ tính theo từng yêu cầu, 20% là chuyển địa chỉ thành toạ độ, tuyến
đường là loại cơ bản hai điểm. Đã trừ hạn mức miễn phí theo từng loại và áp bậc giá.

| Khối lượng mỗi tháng | MapsLibVN | Google |
|---|---|---|
| 30.000 địa điểm + 3.000 tuyến | 650.000đ | 1.030.120đ |
| 100.000 địa điểm + 10.000 tuyến | 2.600.000đ | 6.450.600đ |
| 400.000 địa điểm + 40.000 tuyến | 10.400.000đ | 32.606.600đ |

Con số này chỉ đúng cho ba khối lượng đó với đúng giả định đó. Workload của bạn khác thì phải tính
lại; đừng lấy tỷ lệ phần trăm ở đây áp cho trường hợp của mình. Bảng đầy đủ kèm cột VIETMAP và ba
đường dẫn nguồn nằm ở [trang bảng giá](/bang-gia/#so-sanh).

## Bốn cách giảm mà không đổi nhà cung cấp

Trước khi nghĩ tới việc chuyển nhà cung cấp, bốn việc dưới đây thường cắt được phần lớn chi phí và
làm trong vài ngày.

**Gom yêu cầu gợi ý thành phiên.** Đây là thay đổi cho hiệu quả cao nhất trên mỗi giờ công. Thay vì
tính tiền từng ký tự, cả lần tìm tính một lượt. Cần truyền đúng mã phiên từ lúc bắt đầu gõ tới lúc
người dùng chọn một kết quả.

**Chờ người dùng gõ xong.** Đừng gọi sau mỗi phím. Chờ khoảng 300 mili giây kể từ lần gõ cuối rồi
mới gọi. Riêng việc này thường cắt được khoảng một nửa số yêu cầu, và người dùng không cảm thấy
chậm hơn. Có một cái bẫy đáng nhắc: nếu bạn bỏ khoảng trắng ra khỏi điều kiện so sánh để "gọi ít
hơn", số yêu cầu lại tăng lên, vì mỗi lần người dùng gõ dấu cách sẽ tạo ra một chuỗi mới không
khớp bộ đệm.

**Nhớ kết quả đã tra.** Một địa chỉ đã chuyển thành toạ độ thì lưu lại. Địa chỉ giao hàng của một
khách quen không cần tra lại mỗi lần đặt đơn. Hãy đọc kỹ điều khoản của nhà cung cấp về thời gian
được phép lưu trước khi làm.

**Chỉ gọi khi thật cần.** Nhiều màn hình gọi tính tuyến chỉ để hiện một con số ước lượng mà người
dùng không nhìn. Rà lại xem yêu cầu nào đang phục vụ một thứ thực sự hiển thị.

## Khi nào đổi nhà cung cấp là hợp lý

Sau khi làm xong bốn việc trên mà chi phí vẫn là khoản đáng kể, lúc đó mới đáng cân nhắc đổi. Việc
đổi hợp lý khi phần lớn người dùng của bạn ở Việt Nam, và khi sản phẩm không dựa vào những thứ chỉ
Google có: ảnh đường phố, ảnh vệ tinh, dữ liệu giao thông thời gian thực, hay chi tiết hàng quán
cập nhật liên tục.

Ngược lại, nếu bạn phục vụ nhiều quốc gia hoặc cần một trong số đó, ở lại là quyết định đúng dù
hoá đơn cao hơn. Chi tiết từng chỗ hơn kém nằm ở
[bản so sánh với Google](/so-sanh/google-maps-api/), trong đó có cả mục nói rõ Google hơn ở đâu.

Cách ít rủi ro nhất là chạy song song: đưa một phần lưu lượng sang nhà cung cấp mới, so kết quả
trên chính bộ địa chỉ của bạn trong vài tuần, rồi mới quyết định.
