---
title: Độ chính xác geocode cho địa chỉ Việt Nam
description: Trả về một toạ độ trần là nói dối người dùng. Bài này giải thích vì sao địa chỉ Việt Nam khó, và cách đo chất lượng geocode của bất kỳ nhà cung cấp nào.
publishedAt: '2026-09-18'
tags: ['geocode', 'chất lượng dữ liệu', 'địa chỉ']
daDuyet: true
---

Chuyển một dòng địa chỉ thành cặp toạ độ nghe như bài toán đã giải xong. Với địa chỉ Việt Nam thì
chưa, và điều nguy hiểm không nằm ở chỗ sai, mà ở chỗ cái sai trông y hệt cái đúng.

Một hệ thống trả về toạ độ chính xác tới mái nhà và một hệ thống rơi về tâm phường đều trả cùng một
cặp số. Ứng dụng cắm ghim lên bản đồ như nhau. Tài xế đi theo như nhau. Chỉ khác là một bên tới
đúng cửa, còn bên kia dừng cách đó tám trăm mét.

## Vì sao địa chỉ Việt Nam khó

**Hẻm nhiều cấp.** Một địa chỉ như "123/45/6 Lê Văn Sỹ" mô tả một đường đi chứ không phải một điểm
trên mặt đường chính. Muốn định vị đúng, hệ thống phải hiểu cấu trúc hẻm, mà dữ liệu mở thường chỉ
phủ tới mức hẻm lớn.

**Tên trùng.** Mỗi quận đều có một đường mang tên danh nhân quen thuộc. Thiếu thông tin quận hoặc
phường, một câu tìm có thể khớp hàng trăm điểm nằm rải khắp thành phố.

**Tên hành chính cũ và mới cùng lưu hành.** Sau đợt sắp xếp đơn vị hành chính năm 2025, nhiều
phường xã đổi tên hoặc sáp nhập. Người dùng vẫn gõ tên cũ vì đó là tên trên giấy tờ và trong trí
nhớ, trong khi dữ liệu có thể chỉ mang tên mới. Hệ thống không tra được cả hai sẽ trả về rỗng cho
những địa chỉ hoàn toàn có thật.

**Cách gõ.** Người dùng gõ không dấu, viết tắt, hoặc gõ nhầm khi quên bật bộ gõ. Một hệ thống chỉ
khớp chính xác chuỗi sẽ trượt phần lớn các trường hợp đó.

## Một toạ độ trần là nói dối

Cách xử lý trung thực là trả kèm thông tin về chính độ tin cậy của kết quả. Hai trường là đủ.

**Mức chính xác** nói toạ độ này ở cấp nào: tới tận số nhà, tới đoạn đường, hay chỉ tới được
phường. Đây là thông tin khách quan về thứ đã tra được.

**Độ tin cậy** nói hệ thống chắc chắn tới đâu rằng đây là địa chỉ người dùng muốn. Một câu tìm mơ
hồ khớp nhiều nơi thì độ tin cậy thấp dù mức chính xác cao.

Có hai trường này, ứng dụng làm được việc mà trước đó không làm được: vẽ vòng tròn sai số thay vì
cắm ghim khi mức chính xác chỉ tới phường, hỏi lại người dùng khi độ tin cậy thấp, và từ chối tự
động gán toạ độ cho đơn hàng khi kết quả không đủ tin.

Quan trọng không kém: khi không tra được, hệ thống phải nói không tra được, thay vì rơi về tâm quận
rồi trả về như một kết quả bình thường. Một lỗi im lặng tốn kém hơn nhiều so với một lỗi báo rõ.

## Cách tự đo, dùng được với mọi nhà cung cấp

Đừng tin số liệu chất lượng do nhà cung cấp tự công bố, kể cả của chúng tôi. Cách duy nhất có ý
nghĩa là đo trên chính dữ liệu của bạn. Quy trình dưới đây làm trong một buổi.

**Lấy mẫu từ dữ liệu thật.** Rút khoảng hai trăm địa chỉ từ đơn hàng thật, không phải từ danh sách
đẹp. Phải có cả địa chỉ hẻm sâu, địa chỉ viết tắt, địa chỉ dùng tên phường cũ, và vài địa chỉ gõ
sai chính tả.

**Dựng đáp án.** Với mỗi địa chỉ, xác định toạ độ đúng bằng cách tra tay. Đây là phần tốn thời gian
nhất và không có cách đi tắt.

**Đo ba con số.** Tỷ lệ trả về kết quả nào đó, tỷ lệ kết quả nằm trong bán kính chấp nhận được so
với đáp án, và tỷ lệ hệ thống nói "không biết" khi lẽ ra phải biết.

**Xem cả chỗ sai.** Con số thứ ba mới là con số quan trọng nhất, và nó thường bị bỏ qua: tỷ lệ hệ
thống trả về một kết quả trông hợp lý nhưng sai. Đây là loại lỗi đắt nhất, vì không ai phát hiện
cho tới khi tài xế gọi điện.

Chạy cùng bộ mẫu đó qua hai ba nhà cung cấp rồi so. Kết quả thường khác hẳn con số quảng cáo, và
khác theo từng vùng: một hệ thống mạnh ở trung tâm thành phố có thể yếu hẳn ở ngoại thành.

## Điều nên đòi hỏi

Khi chọn nhà cung cấp geocode, hãy đòi ba điều: kết quả có kèm mức chính xác và độ tin cậy, hệ
thống dám trả về rỗng thay vì đoán bừa, và tài liệu nói rõ các trường đó nghĩa là gì.

Nhà cung cấp nào chỉ trả về một cặp toạ độ trần, không kèm gì khác, thực chất đang chuyển toàn bộ
rủi ro sang cho bạn mà không nói.
