# Kết luận: số lượt Places của autocomplete theo mức debounce

Ngày: 15/09/2026. Đo theo `docs/superpowers/specs/2026-09-15-do-luot-autocomplete-design.md`
và `docs/superpowers/plans/2026-09-15-do-luot-autocomplete.md`.

## 1. Câu trả lời

- Ở debounce **200 ms** (mặc định hiện tại), 14 kịch bản gõ tìm kiếm tiếng Việt thật tốn tổng cộng
  **238 lượt Places** — trung bình **17 lượt cho một lần tìm** (dao động 7–24 tuỳ độ dài chuỗi).
- Nâng lên **500 ms** còn **62 lượt** — giảm **74%** so với 200 ms. Nâng lên **800 ms** còn
  **22 lượt** — giảm **91%**.
- Trong số các lượt ở 200 ms, **94%** là cho một chuỗi dở dang rồi bị bỏ đi ngay khi ký tự tiếp theo
  tới; chỉ **15/238** lượt (6%) là request khớp đúng chuỗi mà người dùng thật sự dừng lại. Ở 800 ms
  tỷ lệ dở dang giảm còn **32%**.

Ba con số trên đo trên `@mapslibvn/react`; theo mục 4 dưới đây, `@mapslibvn/react-native` và
`@mapslibvn/web` cho ra đúng cùng kết quả.

## 2. Cách đo

Một lượt = một lời gọi `client.autocomplete()`. Vì `get()` trong `packages/core/src/client.ts`
chưa nhận `signal` (xem mục 3 của spec), "huỷ request cũ" hiện chỉ là bỏ qua kết quả ở phía client —
request vẫn tới máy chủ. Vì vậy **mỗi lời gọi trong phép đo này tương ứng đúng một lượt máy chủ sẽ
tính tiền thật**, không chỉ là số lần state đổi.

14 trace gõ phím ghi từ điện thoại thật (iPhone 14, Gboard tiếng Việt, PHONG gõ — xem
`2026-09-15-traces.json`), phát lại bằng đồng hồ giả của vitest qua **mã thật** của cả ba gói
(`packages/{react,react-native,web}/src/debounce-trace.test.ts`), client giả không chạm mạng.
"Dở dang" = lượt không khớp chuỗi cuối cùng mà người dùng thực sự gõ tới.

## 3. Bảng số theo gói

<!-- Dán nguyên từ `pnpm debounce:report`, không sửa tay. -->

### @mapslibvn/react

| Kịch bản | 200 ms | 300 ms | 500 ms | 800 ms |
|---|---:|---:|---:|---:|
| `poi-ben-thanh` | 15 (14 dở dang) | 11 (10 dở dang) | 7 (6 dở dang) | 3 (2 dở dang) |
| `poi-highlands` | 14 (13 dở dang) | 9 (8 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `poi-cho-ray` | 19 (18 dở dang) | 8 (7 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) |
| `addr-nguyen-hue` | 21 (20 dở dang) | 14 (13 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `addr-le-loi` | 14 (13 dở dang) | 10 (9 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `cat-ca-phe` | 7 (6 dở dang) | 4 (3 dở dang) | 2 (1 dở dang) | 1 (0 dở dang) |
| `cat-cay-xang` | 21 (20 dở dang) | 9 (8 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `route-from-bach-khoa` | 21 (20 dở dang) | 14 (13 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `route-to-tan-son-nhat` | 20 (19 dở dang) | 12 (11 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-ben-thanh` | 18 (16 dở dang) | 10 (8 dở dang) | 5 (3 dở dang) | 3 (1 dở dang) |
| `fix-highlands` | 11 (10 dở dang) | 9 (8 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-nguyen-hue` | 15 (14 dở dang) | 13 (12 dở dang) | 5 (4 dở dang) | 1 (0 dở dang) |
| `fix-ca-phe` | 18 (17 dở dang) | 11 (10 dở dang) | 5 (4 dở dang) | 1 (0 dở dang) |
| `fix-tan-son-nhat` | 24 (23 dở dang) | 15 (14 dở dang) | 7 (6 dở dang) | 2 (1 dở dang) |
| **Tổng 14 kịch bản** | **238** | **149** | **62** | **22** |

Giảm so với 200 ms — 200 ms: 0%, 300 ms: 37%, 500 ms: 74%, 800 ms: 91%.

### @mapslibvn/react-native

| Kịch bản | 200 ms | 300 ms | 500 ms | 800 ms |
|---|---:|---:|---:|---:|
| `poi-ben-thanh` | 15 (14 dở dang) | 11 (10 dở dang) | 7 (6 dở dang) | 3 (2 dở dang) |
| `poi-highlands` | 14 (13 dở dang) | 9 (8 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `poi-cho-ray` | 19 (18 dở dang) | 8 (7 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) |
| `addr-nguyen-hue` | 21 (20 dở dang) | 14 (13 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `addr-le-loi` | 14 (13 dở dang) | 10 (9 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `cat-ca-phe` | 7 (6 dở dang) | 4 (3 dở dang) | 2 (1 dở dang) | 1 (0 dở dang) |
| `cat-cay-xang` | 21 (20 dở dang) | 9 (8 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `route-from-bach-khoa` | 21 (20 dở dang) | 14 (13 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `route-to-tan-son-nhat` | 20 (19 dở dang) | 12 (11 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-ben-thanh` | 18 (16 dở dang) | 10 (8 dở dang) | 5 (3 dở dang) | 3 (1 dở dang) |
| `fix-highlands` | 11 (10 dở dang) | 9 (8 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-nguyen-hue` | 15 (14 dở dang) | 13 (12 dở dang) | 5 (4 dở dang) | 1 (0 dở dang) |
| `fix-ca-phe` | 18 (17 dở dang) | 11 (10 dở dang) | 5 (4 dở dang) | 1 (0 dở dang) |
| `fix-tan-son-nhat` | 24 (23 dở dang) | 15 (14 dở dang) | 7 (6 dở dang) | 2 (1 dở dang) |
| **Tổng 14 kịch bản** | **238** | **149** | **62** | **22** |

Giảm so với 200 ms — 200 ms: 0%, 300 ms: 37%, 500 ms: 74%, 800 ms: 91%.

### @mapslibvn/web

| Kịch bản | 200 ms | 300 ms | 500 ms | 800 ms |
|---|---:|---:|---:|---:|
| `poi-ben-thanh` | 15 (14 dở dang) | 11 (10 dở dang) | 7 (6 dở dang) | 3 (2 dở dang) |
| `poi-highlands` | 14 (13 dở dang) | 9 (8 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `poi-cho-ray` | 19 (18 dở dang) | 8 (7 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) |
| `addr-nguyen-hue` | 21 (20 dở dang) | 14 (13 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `addr-le-loi` | 14 (13 dở dang) | 10 (9 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `cat-ca-phe` | 7 (6 dở dang) | 4 (3 dở dang) | 2 (1 dở dang) | 1 (0 dở dang) |
| `cat-cay-xang` | 21 (20 dở dang) | 9 (8 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `route-from-bach-khoa` | 21 (20 dở dang) | 14 (13 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `route-to-tan-son-nhat` | 20 (19 dở dang) | 12 (11 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-ben-thanh` | 18 (16 dở dang) | 10 (8 dở dang) | 5 (3 dở dang) | 3 (1 dở dang) |
| `fix-highlands` | 11 (10 dở dang) | 9 (8 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-nguyen-hue` | 15 (14 dở dang) | 13 (12 dở dang) | 5 (4 dở dang) | 1 (0 dở dang) |
| `fix-ca-phe` | 18 (17 dở dang) | 11 (10 dở dang) | 5 (4 dở dang) | 1 (0 dở dang) |
| `fix-tan-son-nhat` | 24 (23 dở dang) | 15 (14 dở dang) | 7 (6 dở dang) | 2 (1 dở dang) |
| **Tổng 14 kịch bản** | **238** | **149** | **62** | **22** |

Giảm so với 200 ms — 200 ms: 0%, 300 ms: 37%, 500 ms: 74%, 800 ms: 91%.

## 4. Ba bản có khớp nhau ở 200 ms không

Có. Cả ba bảng ở mục 3 giống nhau tuyệt đối, từng kịch bản, ở cả 4 mức debounce — vì
`packages/react-native/src/use-places.ts` hiện là bản chép nguyên của
`packages/react/src/use-places.ts` (xác nhận bằng `diff`, không khác một ký tự). Bài
`ở 200 ms, web ra đúng cùng số lượt với react và react-native` trong
`packages/web/src/debounce-trace.test.ts` đối chiếu máy này với cả hai gói kia trên cả 14 kịch bản
và xanh. Vì khớp ở 200 ms — mức duy nhất mà cả ba bên đo được trước khi Task 1 mở attribute
`debounce` cho web — nên bảng 300/500/800 ms của react ở trên áp dụng được cho web mà không cần tự
đo lại từng mức, **miễn là** ba bản còn giống hệt nhau; đây là một điều kiện, không phải sự thật cố
định — cần chạy lại phép đo này nếu một trong ba bản đổi cách debounce.

## 5. Phát hiện thêm: một lỗi gõ thật không được sửa

Kịch bản `poi-highlands` gõ ra `"Hightlands Coffee"` (thừa chữ `t`) và người gõ không sửa lại —
khác với `fix-highlands` (cùng đích nhưng có sửa). Đây là dữ liệu thật, giữ nguyên không "làm đẹp"
lại; không ảnh hưởng tới cách đếm lượt (đếm theo chuỗi thật sự gõ tới, không theo tên địa điểm dự
định), nhưng là lời nhắc rằng bộ 14 trace này phản ánh gõ thật, kể cả phần không hoàn hảo của nó.

Một phát hiện khác, cũng từ dữ liệu thật: `fix-ben-thanh` ở 200 ms gửi đúng chuỗi đích
`"Chợ Bến Thành"` **hai lần**, không phải một — người gõ vô tình đi qua đúng chuỗi đó, dừng đủ lâu
để một lượt tự bắn, rồi tiếp tục sửa và quay lại đúng chuỗi đó ở cuối. Giả định ban đầu của phép đo
("chuỗi cuối luôn gửi đúng một lần") vì vậy được sửa thành "gửi **ít nhất** một lần" — xem commit
`test(react): đếm lượt Places...` và bình luận trong `debounce-trace.test.ts`.

## 6. Giới hạn

1. Trace ghi từ trình duyệt trên điện thoại, **không phải** `TextInput` của React Native. Với cùng
   thao tác ngón tay, hai bên có thể phát ra chuỗi đổi giá trị khác nhau khi bàn phím đang ghép chữ.
   Chưa có bằng chứng chúng giống nhau.
2. Mỗi kịch bản một người gõ một lượt. Đủ để thấy hình dạng, không đủ để làm thống kê.
3. Không đo độ trễ cảm nhận, theo quyết định của PHONG. Độ trễ thêm vào đúng bằng chênh lệch
   debounce (200 → 500 là +300 ms) nên suy ra được, không cần đo.
4. Không đo trên mạng thật, nên không phản ánh trường hợp máy chủ trả chậm hơn cả debounce.

Thêm một giới hạn phát sinh trong lúc đo: bàn phím dùng để ghi (Gboard tiếng Việt trên iPhone 14)
không phát `compositionstart`/`compositionend` cho tiếng Việt Latin trong phiên này — chỉ có sự
kiện `input`. Mốc composition vẫn được ghi vào trace (rỗng), sẵn cho lần đo IME sau này; phép đo
này không dùng tới chúng.

## 7. Chưa kết luận điều gì

Số đo ở trên **không** tự động chọn debounce mặc định mới cho SDK. Việc đó cần cân với độ trễ cảm
nhận thêm vào (300 ms ở mức 500 ms) và là quyết định riêng của PHONG, nằm ngoài phạm vi phép đo này.

Ba việc sau chờ PHONG đọc kết luận rồi mới quyết, mỗi việc một vòng spec/plan riêng:

1. Thêm `signal` vào `get()` của core rồi nối `AbortController` vào ba nơi gọi — đây mới là thứ thật
   sự cắt lượt tính tiền, vì hiện tại "huỷ request cũ" không huỷ gì ở phía máy chủ. Đáng chú ý nhất:
   ở 200 ms, 94% lượt là dở dang — nếu huỷ được ở phía mạng thay vì chỉ ở phía client, phần lớn số
   238 lượt kia có thể không bao giờ tới máy chủ.
2. Bỏ qua sự kiện khi bàn phím đang ghép chữ (IME). Trace đã ghi sẵn mốc composition nên không phải
   bắt ai gõ lại — nhưng trong phiên ghi này, bàn phím Gboard tiếng Việt không phát ra mốc đó, nên
   việc sửa IME có thể cần trace từ một bàn phím/thiết bị khác để kiểm chứng.
3. Đổi giá trị debounce mặc định của cả ba gói.
