# Thực địa dẫn đường React Native — spec C mục 13 tiêu chí 3–5

Người thực hiện: PHONG. Cách lấy số: dòng chẩn đoán dưới thanh ETA trong app thử (fix, sai số,
nền/tiền cảnh, tính lại); giờ theo đồng hồ điện thoại; pin đọc ở Cài đặt trước và sau.
Chạy: `pnpm example:rn --device --android` hoặc `pnpm example:rn --device` (iPhone, xem README app thử).

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
