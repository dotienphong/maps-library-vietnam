# Thực địa dẫn đường React Native — spec C mục 13 tiêu chí 3–5

Người thực hiện: PHONG. Cách lấy số: dòng chẩn đoán dưới thanh ETA trong app thử (fix, sai số,
nền/tiền cảnh, tính lại); giờ theo đồng hồ điện thoại; pin đọc ở Cài đặt trước và sau.
Chạy: `pnpm example:rn --device --android` hoặc `pnpm example:rn --device` (iPhone, xem README app thử).

**12/09/2026 — hai bảng dưới đây để trống có chủ đích, không phải quên điền.** PHONG đã đi thực địa cả
hai máy và xác nhận bằng lời ("thực địa xong rồi, tick pass đi"), nhưng không đọc số cụ thể để ghi lại.
Phần khó nhất — giọng đọc khi khoá màn hình + di chuyển thật — đã có xác nhận riêng, cụ thể hơn, ở
`docs/evidence/navigation/2026-09-12-rn-phat-hanh.md`: Android "ok hoạt động tốt", iPhone "nghe được
rồi, câu đọc rõ khi khoá máy". Nghiệm thu mục 13 vì vậy ghi tiêu chí 3/4 là ĐẠT MỘT PHẦN và tiêu chí 5
là CHƯA ĐẠT — không bịa số vào hai bảng dưới để giữ evidence trung thực. PHONG có thể quay lại điền bổ
sung bất kỳ lúc nào nếu muốn nâng lên ĐẠT trọn vẹn; không bắt buộc.

## Android thật
| Hạng mục | Kết quả |
|---|---|
| Máy, Android, build | |
| Tuyến (từ → đến, phương tiện, km, số chỗ rẽ ≥ 3) | |
| Số fix lúc đến nơi / sai số điển hình (m) | |
| Câu đọc đúng chỗ / tổng câu | |
| Cố ý lệch: giây từ lệch tới có tuyến mới | |
| Khoá màn hình liên tục lâu nhất mà vẫn nghe câu (phút) | |
| Thông báo foreground service hiện / biến mất khi Dừng | |
| `arrived` có báo không | |
| Pin trước → sau (%) và thời gian | |
| Số lần rơi về tiền cảnh (`backgroundUnavailable`) | |
| Ghi chú | |

## iPhone thật
| Hạng mục | Kết quả |
|---|---|
| Máy, iOS, build | |
| Tuyến | |
| Số fix / sai số | |
| Câu đọc đúng chỗ / tổng | |
| Giây lệch → tuyến mới | |
| Khoá màn hình lâu nhất vẫn nghe câu (phút) | |
| Chỉ báo vị trí nền màu xanh hiện | |
| Hộp thoại quyền chỉ hỏi "Khi dùng ứng dụng" | |
| `arrived` | |
| Pin trước → sau | |
| Số lần rơi về tiền cảnh | |
| Ghi chú | |

## Ngưỡng cần chỉnh
(để trống nếu giữ nguyên `NAVIGATION_THRESHOLDS`)
