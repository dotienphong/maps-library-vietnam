---
title: Tự dựng bản đồ Việt Nam từ dữ liệu mở
description: Một hệ bản đồ gồm bốn mảnh rời nhau, và chỉ một trong số đó cần máy chủ. Bài này nói rõ cần gì, tốn gì, và khi nào tự dựng là quyết định sai.
publishedAt: '2026-09-18'
tags: ['dữ liệu mở', 'tự host', 'hạ tầng']
daDuyet: true
---

"Tự dựng bản đồ" nghe như một dự án nhiều tháng. Thực ra phần khó không nằm ở chỗ dựng, mà ở chỗ
nuôi nó sống sau khi dựng xong. Bài này tách hệ bản đồ thành bốn mảnh rời nhau để bạn thấy mảnh
nào dễ, mảnh nào tốn, rồi nói thẳng khi nào tự dựng là quyết định sai.

## Bốn mảnh của một hệ bản đồ

Một ứng dụng có bản đồ thường cần bốn thứ, và chúng độc lập với nhau hơn người ta tưởng.

**Nền bản đồ.** Là phần hình ảnh đường sá, sông ngòi, ranh giới mà người dùng nhìn thấy. Dựng từ
dữ liệu OpenStreetMap bằng công cụ mã mở, cho ra một tập ô vuông nhiều mức phóng.

**Lớp địa điểm.** Quán ăn, bệnh viện, trường học. Gộp từ OpenStreetMap và các bộ dữ liệu địa điểm
mở khác, mỗi địa điểm cần chọn một nguồn chính để quyết định tên và toạ độ.

**Tìm kiếm và chuyển địa chỉ thành toạ độ.** Phần này cần một cơ sở dữ liệu có đánh chỉ mục văn
bản, và là chỗ tốn công nhất nếu bạn muốn nó hiểu cách người Việt gõ.

**Dẫn đường.** Cần một bộ máy tính tuyến riêng, nạp sẵn đồ thị mạng đường.

Điểm quan trọng: bốn mảnh này không bắt buộc phải cùng một nhà. Nhiều đội tự dựng nền bản đồ để
cắt chi phí lượt tải, nhưng vẫn mua dịch vụ tìm kiếm.

## Nền bản đồ không cần máy chủ

Đây là chỗ khiến việc tự dựng rẻ hơn hẳn so với vài năm trước. Toàn bộ ô bản đồ của Việt Nam gói
được vào một tệp duy nhất, đặt trên kho lưu trữ tĩnh có mạng phân phối. Trình duyệt tải đúng phần
nó cần bằng cách xin một đoạn byte trong tệp đó, không cần một máy chủ nào đứng ra cắt ô và trả về.

Nghĩa là mảnh tốn tiền nhất ngày xưa, cụm máy chủ phục vụ ô bản đồ, nay biến mất. Bạn chỉ trả tiền
lưu trữ và băng thông.

## Nghĩa vụ giấy phép phải làm đúng

Đây là phần hay bị bỏ qua và là phần duy nhất có thể gây rắc rối pháp lý.

Dữ liệu OpenStreetMap phát hành theo giấy phép ODbL. Điều khoản cốt lõi: bạn dùng thoải mái kể cả
cho mục đích thương mại, nhưng phải ghi nguồn, và nếu bạn tạo ra một cơ sở dữ liệu phái sinh rồi
phân phối nó thì phải chia sẻ lại theo cùng giấy phép. Kết quả mà API trả về cho người dùng cuối
thường được xem là sản phẩm tạo ra, chỉ cần ghi nguồn.

Dữ liệu địa điểm của Foursquare OS phát hành theo Apache-2.0, dễ thở hơn, nhưng vẫn phải giữ thông
báo giấy phép.

Cách làm an toàn là tách bảng: giữ dữ liệu gốc của từng nguồn ở bảng riêng, còn bảng địa điểm của
bạn chỉ liên kết tới chúng bằng mã định danh. Và đừng để phần ghi nguồn thành thứ tắt được trong
giao diện.

## Chi phí thật nằm ở chỗ nuôi

Dựng lần đầu là việc hữu hạn. Ba khoản dưới đây mới là khoản lặp lại mãi mãi.

**Cập nhật dữ liệu.** Dữ liệu mở thay đổi hằng ngày. Bạn cần một quy trình chạy định kỳ: tải bản
mới, dựng lại, kiểm chất lượng, rồi chuyển sang bản mới mà không làm gián đoạn người dùng. Bước
kiểm chất lượng là bước dễ bị cắt nhất và cũng là bước cứu bạn khi dữ liệu thượng nguồn hỏng.

**Vận hành.** Máy chủ cơ sở dữ liệu và bộ máy tính tuyến cần theo dõi, sao lưu, và có người xử lý
khi hai giờ sáng nó chết.

**Chất lượng tìm kiếm.** Đây là khoản vô hình và lớn nhất. Làm tìm kiếm chạy được thì nhanh. Làm nó
hiểu chữ không dấu, viết tắt, tên đơn vị hành chính cũ lẫn mới sau đợt sắp xếp năm 2025, và kiểu gõ
khi người dùng quên bật bộ gõ tiếng Việt, là công việc nhiều tháng và không bao giờ xong hẳn.

## Khi nào tự dựng là sai

Tự dựng hợp lý khi bạn có người trực hệ thống, khi khối lượng đủ lớn để phần tiết kiệm bù được
công vận hành, hoặc khi có ràng buộc buộc dữ liệu phải nằm trên hạ tầng của bạn.

Tự dựng là sai khi đội của bạn nhỏ và đang cần ra mắt sản phẩm. Bạn sẽ dành hai tháng cho một thứ
không phải sản phẩm của mình, rồi phát hiện phần tìm kiếm mới là phần khó, trong khi đối thủ đã ra
mắt.

Có một lối đi ở giữa mà ít người nghĩ tới: dùng dịch vụ để ra mắt nhanh, nhưng chọn dịch vụ dựng
trên dữ liệu mở và có mã nguồn công khai. Khi nào cần, bạn mang đúng dữ liệu đó về tự dựng, không
phải làm lại từ đầu và không bị khoá vào một nhà cung cấp.

Hướng dẫn tự dựng chi tiết nằm trong tài liệu kỹ thuật, ở mục tự host.
