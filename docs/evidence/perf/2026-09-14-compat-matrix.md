# Ma trận tương thích RN — 14/09/2026

Kết luận món C1 (spec `2026-09-14-hieu-nang-tuong-thich-rn-design.md` mục 4b): **peerDependencies
của `@mapslibvn/react-native` GIỮ NGUYÊN** (`react >= 19.1.0`, `react-native >= 0.80.0`). Không
nới được — nhưng không phải vì mã của thư viện.

## Kết luận, và vì sao ma trận `pnpm compat:matrix` không dùng để chốt việc này được

Kế hoạch ban đầu định dùng bảng ĐẠT/HỎNG của `pnpm compat:matrix` (cài thử 5 tổ hợp phiên bản)
để trả lời câu hỏi. Chạy thật cho kết quả **5/5 ĐẠT**, kể cả tổ hợp thấp nhất
(`react18.3.1-rn0.79.0-expo53.0.0-oldarch`) — xem bảng ở dưới. Nhưng kết quả này **không trả lời
được câu hỏi**, phát hiện được lúc review Task 8:

`pnpm compat:matrix` (mặc định) cài bằng `npm install --legacy-peer-deps` — cờ này bảo npm **bỏ
qua toàn bộ kiểm tra peer dependency**, không riêng gì tổ hợp đang xét. Bằng chứng: **cả 5 tổ
hợp**, kể cả tổ hợp mới nhất (`react 19.2.3 / rn 0.86.3 / expo 57.0.0`, đáng lẽ khai đủ mọi peer),
đều **thiếu đúng 5 gói `expo-*` bắt buộc** (`expo-audio`, `expo-location`, `expo-sensors`,
`expo-speech`, `expo-task-manager`). Nghĩa là "cài được" ở đây gần như là hằng đúng — không đổi
theo tổ hợp phiên bản đang thử, nên không đo được biến cần đo. Đây là hạn chế của bản
`pnpm compat:matrix` hiện tại, không phải của mã `@mapslibvn/react-native`.

## Câu trả lời thật — sàn peer của chính maplibre, không phải của mã mình

`@maplibre/maplibre-react-native` là peer **bắt buộc** của `@mapslibvn/react-native`
(`peerDependencies: "@maplibre/maplibre-react-native": "^11.3.0"`). Tự kiểm bằng
`npm view '@maplibre/maplibre-react-native@>=11.0.0 <12.0.0' peerDependencies --json`:

| Khoảng bản 11.x đã kiểm | Số bản | `react` | `react-native` |
|---|---|---|---|
| 11.0.0 → 11.3.10 (toàn bộ 20 bản ổn định của dòng 11.x) | 20/20 | `>=19.1.0` | `>=0.80.0` |

**Không một bản 11.x nào, từ bản đầu tiên, từng hỗ trợ React 18 hoặc React Native 0.79.** Sàn
này có từ `11.0.0`, không phải mới siết gần đây — không có "bản cũ hơn còn rộng" để hạ xuống
trong cùng dòng major.

Đối chiếu với chính mã nguồn `@mapslibvn/react-native` (`packages/react-native/src`, đã tự
`grep`): **không dùng bất kỳ API nào riêng của React 19** trong mã phát hành — không có `use()`,
`useActionState`, `useOptimistic`, `useFormStatus`, không có `forwardRef`/ref-as-prop kiểu React
19 (chỗ duy nhất xuất hiện là `src/test/mlrn-mock.tsx`, một file mock chỉ dùng cho test, không
đóng gói vào SDK phát hành). Toàn bộ hook dùng là `useSyncExternalStore`, `useEffect`, `useMemo`,
`useRef`, `useContext`, `useCallback`, `useState` — đều an toàn từ React 18.

**Kết luận:** sàn thật của thư viện là do `@maplibre/maplibre-react-native` áp đặt, không phải
do mã `@mapslibvn/react-native`. Nếu sau này maplibre hạ sàn, hoặc dự án đổi/thêm một nền bản đồ
khác hỗ trợ React 18 rộng hơn, `@mapslibvn/react-native` **không cần sửa một dòng mã nào** để
theo kịp — chỉ cần nới `peerDependencies`. Đây là một phát hiện có giá trị, không phải một câu
trả lời "không xong việc".

Hai hướng nếu PHONG muốn hỗ trợ React 18/RN 0.79 thật sự trong tương lai (chưa làm, để quyết
định sau, ngoài phạm vi giai đoạn 1):

1. Chờ/yêu cầu `@maplibre/maplibre-react-native` hạ sàn ở một bản 11.x sau này.
2. Hỗ trợ song song `@maplibre/maplibre-react-native@10` — peer rộng hơn nhiều
   (`react >= 16.6.1`, `react-native >= 0.59.9`) nhưng **API khác hẳn v11** (tên component, cách
   khai báo layer đều đổi) — việc lớn, đã ghi rõ trong spec mục 4b là ngoài phạm vi.

Ràng buộc thứ hai, độc lập, cũng cần biết: các peer `expo-*` mà `@mapslibvn/react-native` khai
(`expo-sensors >=15.0.0` v.v.) là gói đời Expo SDK 54 — dùng trong app Expo 53 sẽ vỡ lúc chạy
(module native không tương thích) dù không cờ cài đặt nào bắt được việc đó.

## Bảng chạy thật `pnpm compat:matrix` (mặc định, không `--build`)

**Nơi chạy:** máy dev, `npm install --no-audit --no-fund --legacy-peer-deps` cho từng tổ hợp,
tarball đóng gói tươi từ `@mapslibvn/react-native@0.7.1` lúc chạy.

> **Đọc bảng này cẩn thận:** cột "Kết quả" chỉ có nghĩa **"`npm install` giải được cây phụ thuộc
> khi đã bảo npm bỏ qua toàn bộ xung đột peer"** — KHÔNG có nghĩa "mã chạy được", càng không có
> nghĩa "tổ hợp phiên bản này được hỗ trợ chính thức". Xem phần kết luận ở trên để biết câu trả
> lời thật cho C1.

| React | React Native | Expo | Kiến trúc | Kết quả (chỉ cài đặt, `--legacy-peer-deps`) |
|---|---|---|---|---|
| 19.2.3 | 0.86.3 | 57.0.0 | mới | ĐẠT |
| 19.2.3 | 0.86.3 | 57.0.0 | cũ | ĐẠT |
| 19.1.0 | 0.80.0 | 54.0.0 | mới | ĐẠT |
| 19.1.0 | 0.79.0 | 53.0.0 | mới | ĐẠT |
| 18.3.1 | 0.79.0 | 53.0.0 | cũ | ĐẠT |

5/5 ô "ĐẠT" theo nghĩa hẹp ở trên. Không chạy `--build` (tốn tài nguyên, và theo phân tích ở trên
kết quả build cũng sẽ hỏng ngay ở bước Metro vì thiếu các gói `expo-*` chưa được khai trong app
thử tự sinh — không phải vì phiên bản React/RN).

## Việc để lại cho lần sau (không chặn đóng giai đoạn 1)

Nếu muốn `pnpm compat:matrix` tự nó đo đúng và dùng lại được cho các quyết định tương tự sau
này, ba hướng đã được đề xuất lúc review, tăng dần chi phí:

1. Đổi nhãn cột (`Cài (--legacy-peer-deps)` thay vì `Kết quả`) — rẻ, chỉ sửa cách hiển thị.
2. Chế độ mặc định bỏ `--legacy-peer-deps` (để ERESOLVE thật sự chặn khi có), thêm cờ riêng
   `--ignore-peers` chỉ dùng khi cố ý muốn ép cài; thêm đủ 6 peer `expo-*` vào
   `appPackageJson` để không hỏng vì lý do không liên quan.
3. Ngay cả `--build` (chạy `expo prebuild`) cũng chưa đủ: lệnh đó chỉ sinh thư mục `android/` từ
   cấu hình, **không typecheck, không bundle JS thật** — muốn biết chắc mã có chạy được cần thêm
   `expo export` (bundle thật) hoặc chạy bộ test của SDK với React/RN đã ghim đúng phiên bản.

Không làm trong giai đoạn 1 vì câu hỏi C1 đã có câu trả lời chắc chắn hơn (bảng sàn peer ở trên)
mà không cần đầu tư thêm.
