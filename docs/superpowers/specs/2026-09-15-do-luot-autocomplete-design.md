# Đặc tả phép đo số lượt Places của autocomplete

Ngày: 15/09/2026. PHONG duyệt thiết kế trong phiên brainstorm cùng ngày.
Bối cảnh: đang làm quota thương mại (`docs/superpowers/specs/2026-09-15-quota-thue-bao-design.md`),
cần biết một phiên gõ tìm kiếm thật tốn bao nhiêu lượt Places trước khi chốt hạn mức và trước khi
sửa cơ chế debounce.

Phạm vi tài liệu này là **đo**, không phải sửa. Kết luận của phép đo mới là căn cứ cho các thay đổi
sau đó (`AbortController`, IME, giá trị debounce mặc định).

## 1. Mục tiêu

Trả lời được ba câu, bằng số đo chứ không bằng suy đoán:

1. Một phiên gõ tìm kiếm tiếng Việt thật hiện tốn bao nhiêu lượt Places ở debounce 200 ms?
2. Nâng lên 300 / 500 / 800 ms thì còn bao nhiêu?
3. Trong số đó, bao nhiêu lượt là cho chuỗi dở dang rồi bị bỏ đi?

Thành công = có bảng số cho từng tổ hợp (kịch bản × gói × mức debounce), kèm giới hạn ghi rõ,
và một tệp test giữ cho các con số đó không lặng lẽ đổi về sau.

## 2. Hiện trạng đã kiểm tra

- `packages/react/src/use-places.ts:52` — debounce 200 ms, chỉnh được qua `debounceMs`; ngưỡng ≥ 2 ký tự ở `:30`.
- `packages/react-native/src/use-places.ts:52` — mã giống hệt bản react.
- `packages/web/src/autocomplete-element.ts:131` — debounce 200 ms **hard-code**; `observedAttributes` (`:57`) không có `debounce`.
- `packages/core/src/client.ts:99-111` — `get()` không nhận `signal`. Việc "huỷ request cũ" ở cả ba
  bản chỉ là bỏ qua kết quả (cờ `cancelled`, bộ đếm `#seq`); request vẫn tới máy chủ và **vẫn bị
  tính một lượt**. Vì vậy trong phép đo này, một lời gọi `client.autocomplete` = một lượt tính tiền.
- Không nơi nào trong repo xử lý `compositionstart`/`compositionend`/`isComposing`.
- Ba nơi trên là toàn bộ chỗ gọi `client.autocomplete`; không có đường vòng nào bỏ qua debounce.
- Gốc repo đã có `react`, `jsdom`, `@testing-library/react`; `vitest.config.ts` đã nạp
  `scripts/**/*.test.mjs`. Một tệp vitest duy nhất phát lại được cả ba bản.

## 3. Nguồn dữ liệu gõ phím

Ghi lại từ người gõ thật rồi phát lại, **không** tự sinh khoảng ngừng theo mô hình giả định.
Lý do: kết luận về debounce phụ thuộc hoàn toàn vào phân phối khoảng ngừng giữa các phím; tự đặt
con số đó ra rồi đo lại chính nó thì không chứng minh được gì.

Môi trường ghi: **điện thoại thật, bàn phím tiếng Việt của hệ** (Gboard hoặc bàn phím iOS). Đây là
trường hợp người dùng SDK thật nhất và cũng là nơi gõ chậm nhất, nên debounce ảnh hưởng mạnh nhất.

## 4. Máy ghi trace

Một trang web nhỏ xuất bản dạng Artifact, mở bằng link trên điện thoại. Chọn cách này thay vì chạy
server local trên máy Mac vì repo đã từng dính tường lửa macOS chặn điện thoại vào máy, và vì không
phải bê JSON từ điện thoại về bằng tay.

Trang gồm một ô nhập, danh sách kịch bản cần gõ, và nút chuyển kịch bản.

**Trang không gọi API Places.** Ghi trace mà gọi API thì độ trễ mạng sẽ làm lệch nhịp gõ, và tốn
quota thật một cách vô nghĩa.

Mỗi lần nội dung ô đổi, ghi một mốc `{ t, value }` với `t` tính bằng mili giây từ lúc bắt đầu kịch
bản. Ghi kèm cả mốc `compositionstart` / `compositionend`. Phép đo này không dùng tới chúng, nhưng
nếu sau này sửa phần IME mà trace không có thì phải bắt người gõ lại từ đầu toàn bộ.

Trace lưu vào kho riêng của trang; sau đó đọc về và chốt thành tệp cố định trong repo.

### Bộ kịch bản (14)

| Nhóm | Chuỗi |
|---|---|
| Tên địa điểm (3) | `Chợ Bến Thành`, `Highlands Coffee`, `Bệnh viện Chợ Rẫy` |
| Địa chỉ (2) | `123 Nguyễn Huệ`, `45 Lê Lợi Quận 1` |
| Loại địa điểm (2) | `quán cà phê`, `cây xăng gần đây` |
| Tính tuyến (2) | điểm đi `Đại học Bách Khoa`, điểm đến `Sân bay Tân Sơn Nhất` — hai ô liên tiếp trong cùng một phiên |
| Gõ sai rồi xoá lùi sửa (5) | `Chợ Bến Thành`, `Highlands Coffee`, `123 Nguyễn Huệ`, `quán cà phê`, `Sân bay Tân Sơn Nhất` — gõ sai giữa chừng rồi backspace sửa lại cho đúng |

## 5. Bộ phát lại — `scripts/debounce-measure.test.mjs`

Phát lại từng trace bằng đồng hồ giả của vitest, `client` thay bằng bản đếm, **không có mạng**.
Đơn vị đếm: một lời gọi `client.autocomplete` = một lượt.

Nạp trực tiếp mã thật của cả ba gói, không dựng lại logic debounce trong test. Test nào dựng lại
logic rồi đo chính bản dựng lại đó thì không nói lên điều gì về thứ đang chạy.

| Bản | Mức debounce đo |
|---|---|
| `@mapslibvn/react` | 200 / 300 / 500 / 800 ms |
| `@mapslibvn/react-native` | 200 / 300 / 500 / 800 ms |
| `@mapslibvn/web` | 200 / 300 / 500 / 800 ms |

Mỗi lượt được phân loại thêm: **khớp chuỗi cuối cùng** hay **chuỗi dở dang rồi bị bỏ**. Phân loại này
suy ra được từ trace nên không tốn công đo thêm, và chính nó là phần lãng phí.

Tệp chạy trong `pnpm test` và đối chiếu với bảng số đã chốt ngay trong chính tệp test, theo đúng
cách `scripts/admin-alias-fixtures.test.mjs` ghim hash và kích thước. Về sau ai sửa debounce làm
số lượt đổi thì test đỏ ngay.

## 6. Thay đổi SDK trong phạm vi bước này

Đúng **một** thay đổi: mở attribute `debounce` cho `<mapslibvn-autocomplete>`.

Hiện `200` là số literal trong `#onInput`, không đo được mức nào khác. Cách thay thế — bẻ
`setTimeout` trong lúc test để nhân giãn độ trễ — bị loại: nó đo một đồng hồ đã bị sửa chứ không đo
thứ đang chạy, và chỉ cần ai đó đổi `200` thành `250` là phép đo lặng lẽ sai mà không ai biết.

Thêm `'debounce'` vào `observedAttributes`, đọc giá trị, **mặc định giữ nguyên 200 ms** nên hành vi
hiện tại không đổi. Giá trị không hợp lệ thì rơi về mặc định. Việc này vốn đã nằm trong danh sách
khoảng trống cần vá, và người dùng web thuần cũng được lợi như hai gói kia.

Ngoài chỗ đó, bước này **không** đụng tới: `AbortController` / `signal` trong core, xử lý IME, và
giá trị debounce mặc định của bất kỳ gói nào.

## 7. Kết quả xuất ra

Theo khuôn `docs/evidence/capacity/`. Thư mục `docs/evidence/autocomplete-debounce/`:

- `2026-09-15-traces.json` — trace thô, kèm thiết bị, bàn phím và người gõ.
- `2026-09-15-counts-react.json`, `-react-native.json`, `-web.json` — bảng số lượt theo
  (kịch bản × mức debounce), kèm phân loại dở dang. Tách ba tệp vì mỗi gói có một tệp phát lại
  riêng chạy độc lập; gộp một tệp thì ba tệp test chạy song song sẽ ghi đè lẫn nhau.
- `2026-09-15-do-luot-autocomplete.md` — kết luận và giới hạn.

## 8. Giới hạn, ghi thẳng vào kết luận

1. Trace ghi từ trình duyệt trên điện thoại, **không phải** `TextInput` của React Native. Với cùng
   thao tác ngón tay, hai bên có thể phát ra chuỗi đổi giá trị khác nhau khi bàn phím đang ghép chữ.
   Chưa có bằng chứng chúng giống nhau.
2. Mỗi kịch bản một người gõ một lượt. Đủ để thấy hình dạng, không đủ để làm thống kê.
3. Không đo độ trễ cảm nhận, theo quyết định của PHONG. Độ trễ thêm vào đúng bằng chênh lệch
   debounce (200 → 500 là +300 ms) nên suy ra được, không cần đo.
4. Không đo trên mạng thật, nên không phản ánh trường hợp máy chủ trả chậm hơn cả debounce.

## 9. Ngoài phạm vi

Thêm `signal` vào `get()` của core và nối `AbortController` vào ba nơi gọi; bỏ qua sự kiện khi IME
đang ghép chữ; đổi giá trị debounce mặc định. Cả ba chờ kết quả đo rồi mới quyết, mỗi việc một
vòng spec/plan riêng.
