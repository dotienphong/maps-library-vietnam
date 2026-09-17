# Kết luận: số lượt Places của autocomplete theo mức debounce

Ngày: 15/09/2026. Đo theo `docs/superpowers/specs/2026-09-15-do-luot-autocomplete-design.md`
và `docs/superpowers/plans/2026-09-15-do-luot-autocomplete.md`.

> **Đo lại 17/09/2026 — bảng và kết luận bên dưới đã cập nhật theo lần đo này.**
> Ba thay đổi trong SDK 0.12.0 khiến số cũ hết hiệu lực:
> 1. `usePlaces` và `<mapslibvn-autocomplete>` đệm gợi ý trong phiên (20 truy vấn), nên gõ thêm dấu
>    cách và gõ lùi về chuỗi vừa hỏi xong không tốn lượt nữa.
> 2. Debounce mặc định 200 ms → **300 ms** (PHONG chốt 17/09/2026).
> 3. `core` 0.11.0 không huỷ request ở lớp mạng nữa, nên "một lời gọi = một lượt tính tiền" giờ
>    đúng tuyệt đối chứ không còn là xấp xỉ — xem mục 2.
>
> Số cũ để đối chiếu (ngày 15/09): 200 ms **238** lượt, 300 ms **149**, 500 ms **62**, 800 ms **22**.
> Đi từ mặc định cũ (200 ms, 238 lượt) sang mặc định mới (300 ms, 116 lượt) là **giảm 51%**.

## 1. Câu trả lời

- Ở debounce **300 ms** (mặc định hiện tại, đổi ngày 17/09), 14 kịch bản gõ tìm kiếm tiếng Việt
  thật tốn tổng cộng **116 lượt Places** — trung bình **8,3 lượt cho một lần tìm**.
- Ở **200 ms** (mặc định cũ) là **185 lượt**, trung bình 13,2. Nâng lên **500 ms** còn **58 lượt**
  — giảm **69%** so với 200 ms; **800 ms** còn **21 lượt** — giảm **89%**.
- Trong số các lượt ở 200 ms, **92%** là cho một chuỗi dở dang rồi bị bỏ đi ngay khi ký tự tiếp
  theo tới; chỉ **14/185** lượt (8%) khớp đúng chuỗi mà người dùng thật sự dừng lại. Ở 800 ms tỷ lệ
  dở dang còn **33%**.
- Số lượt khớp đích luôn đúng bằng **14** ở mọi mức: mỗi kịch bản hỏi chuỗi đích đúng một lần.
  Trước khi có đệm, con số này là 15 — một kịch bản (`fix-ben-thanh`) đi qua chuỗi đích hai lần và
  bị tính tiền hai lần.

Ba con số trên đo trên `@mapslibvn/react`; theo mục 4 dưới đây, `@mapslibvn/react-native` và
`@mapslibvn/web` cho ra đúng cùng kết quả.

## 2. Cách đo

Một lượt = một lời gọi `client.autocomplete()`. `get()` trong `packages/core/src/client.ts` có
nhận `signal`, nhưng từ 0.11.0 nó **cố ý không** chuyển signal xuống `fetch`: lệnh huỷ không đuổi
kịp máy chủ — nó đã phục vụ xong và đã phát receipt — nên huỷ ở lớp mạng chỉ làm mất header receipt
và khoá tenant bằng 429 `ack_required`. "Huỷ request cũ" vì vậy chỉ là bỏ qua kết quả ở phía
client; request vẫn tới máy chủ và vẫn được ACK. **Mỗi lời gọi trong phép đo này tương ứng đúng một
lượt máy chủ tính tiền thật** — từ 0.11.0 đây là đẳng thức chính xác, không còn là xấp xỉ.

14 trace gõ phím ghi từ điện thoại thật (iPhone 14, Gboard tiếng Việt, PHONG gõ — xem
`2026-09-15-traces.json`), phát lại bằng đồng hồ giả của vitest qua **mã thật** của cả ba gói
(`packages/{react,react-native,web}/src/debounce-trace.test.ts`), client giả không chạm mạng.
"Dở dang" = lượt không khớp chuỗi cuối cùng mà người dùng thực sự gõ tới.

## 3. Bảng số theo gói

<!-- Dán nguyên từ `pnpm debounce:report`, không sửa tay. -->

### @mapslibvn/react

| Kịch bản | 200 ms | 300 ms | 500 ms | 800 ms |
|---|---:|---:|---:|---:|
| `poi-ben-thanh` | 13 (12 dở dang) | 9 (8 dở dang) | 6 (5 dở dang) | 3 (2 dở dang) |
| `poi-highlands` | 13 (12 dở dang) | 8 (7 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `poi-cho-ray` | 16 (15 dở dang) | 5 (4 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) |
| `addr-nguyen-hue` | 18 (17 dở dang) | 13 (12 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `addr-le-loi` | 10 (9 dở dang) | 8 (7 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `cat-ca-phe` | 6 (5 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) | 1 (0 dở dang) |
| `cat-cay-xang` | 15 (14 dở dang) | 7 (6 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `route-from-bach-khoa` | 17 (16 dở dang) | 11 (10 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `route-to-tan-son-nhat` | 17 (16 dở dang) | 10 (9 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-ben-thanh` | 13 (12 dở dang) | 7 (6 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) |
| `fix-highlands` | 9 (8 dở dang) | 7 (6 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-nguyen-hue` | 11 (10 dở dang) | 9 (8 dở dang) | 5 (4 dở dang) | 1 (0 dở dang) |
| `fix-ca-phe` | 9 (8 dở dang) | 8 (7 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `fix-tan-son-nhat` | 18 (17 dở dang) | 11 (10 dở dang) | 7 (6 dở dang) | 2 (1 dở dang) |
| **Tổng 14 kịch bản** | **185** | **116** | **58** | **21** |

Giảm so với 200 ms — 200 ms: 0%, 300 ms: 37%, 500 ms: 69%, 800 ms: 89%.

### @mapslibvn/react-native

| Kịch bản | 200 ms | 300 ms | 500 ms | 800 ms |
|---|---:|---:|---:|---:|
| `poi-ben-thanh` | 13 (12 dở dang) | 9 (8 dở dang) | 6 (5 dở dang) | 3 (2 dở dang) |
| `poi-highlands` | 13 (12 dở dang) | 8 (7 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `poi-cho-ray` | 16 (15 dở dang) | 5 (4 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) |
| `addr-nguyen-hue` | 18 (17 dở dang) | 13 (12 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `addr-le-loi` | 10 (9 dở dang) | 8 (7 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `cat-ca-phe` | 6 (5 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) | 1 (0 dở dang) |
| `cat-cay-xang` | 15 (14 dở dang) | 7 (6 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `route-from-bach-khoa` | 17 (16 dở dang) | 11 (10 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `route-to-tan-son-nhat` | 17 (16 dở dang) | 10 (9 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-ben-thanh` | 13 (12 dở dang) | 7 (6 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) |
| `fix-highlands` | 9 (8 dở dang) | 7 (6 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-nguyen-hue` | 11 (10 dở dang) | 9 (8 dở dang) | 5 (4 dở dang) | 1 (0 dở dang) |
| `fix-ca-phe` | 9 (8 dở dang) | 8 (7 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `fix-tan-son-nhat` | 18 (17 dở dang) | 11 (10 dở dang) | 7 (6 dở dang) | 2 (1 dở dang) |
| **Tổng 14 kịch bản** | **185** | **116** | **58** | **21** |

Giảm so với 200 ms — 200 ms: 0%, 300 ms: 37%, 500 ms: 69%, 800 ms: 89%.

### @mapslibvn/web

| Kịch bản | 200 ms | 300 ms | 500 ms | 800 ms |
|---|---:|---:|---:|---:|
| `poi-ben-thanh` | 13 (12 dở dang) | 9 (8 dở dang) | 6 (5 dở dang) | 3 (2 dở dang) |
| `poi-highlands` | 13 (12 dở dang) | 8 (7 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `poi-cho-ray` | 16 (15 dở dang) | 5 (4 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) |
| `addr-nguyen-hue` | 18 (17 dở dang) | 13 (12 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `addr-le-loi` | 10 (9 dở dang) | 8 (7 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `cat-ca-phe` | 6 (5 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) | 1 (0 dở dang) |
| `cat-cay-xang` | 15 (14 dở dang) | 7 (6 dở dang) | 3 (2 dở dang) | 1 (0 dở dang) |
| `route-from-bach-khoa` | 17 (16 dở dang) | 11 (10 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `route-to-tan-son-nhat` | 17 (16 dở dang) | 10 (9 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-ben-thanh` | 13 (12 dở dang) | 7 (6 dở dang) | 3 (2 dở dang) | 2 (1 dở dang) |
| `fix-highlands` | 9 (8 dở dang) | 7 (6 dở dang) | 5 (4 dở dang) | 2 (1 dở dang) |
| `fix-nguyen-hue` | 11 (10 dở dang) | 9 (8 dở dang) | 5 (4 dở dang) | 1 (0 dở dang) |
| `fix-ca-phe` | 9 (8 dở dang) | 8 (7 dở dang) | 4 (3 dở dang) | 1 (0 dở dang) |
| `fix-tan-son-nhat` | 18 (17 dở dang) | 11 (10 dở dang) | 7 (6 dở dang) | 2 (1 dở dang) |
| **Tổng 14 kịch bản** | **185** | **116** | **58** | **21** |

Giảm so với 200 ms — 200 ms: 0%, 300 ms: 37%, 500 ms: 69%, 800 ms: 89%.

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
