# Baseline hiệu năng RN — 14/09/2026

Số đo cho giai đoạn 1 của spec `2026-09-14-hieu-nang-tuong-thich-rn-design.md`. Tách rõ "máy đo
được" và "CHỜ PHONG" đúng như thiết kế — không có số nào ở mục CHỜ PHONG được đo hộ hay suy luận.

## Kích thước (`pnpm perf:size`, sau `pnpm build`)

| File | Thô | Gzip |
|---|---|---|
| `packages/core/dist/index.js` | 57,6 kB | 17,8 kB |
| `packages/web/dist/index.js` | 26,9 kB | 8,4 kB |
| `packages/web/dist/mapslibvn.umd.js` | 1078,1 kB | 295,9 kB |
| `packages/web/dist/mapslibvn.css` | 81,1 kB | 10,3 kB |
| `packages/react/dist/index.js` | 5,3 kB | 1,7 kB |
| `packages/react-native/dist/index.js` (+ chunk dùng chung) | 89,5 kB | 27,1 kB |
| `packages/react-native/dist/expo/index.js` (+ chunk dùng chung) | 78,6 kB | 18,0 kB |
| Bundle Metro Android của `examples/embed-rn` (`expo export:embed --dev false`) | 1109,9 kB | 280,1 kB |

Hai dòng `react-native` đã cộng cả chunk dùng chung do tsup tách ra giữa 2 entry (xem Task 1 —
`packages/react-native/.size-limit.json` dùng cùng cách cộng). Dòng bundle Metro là **toàn bộ
app thử** (SDK + Expo + React Native runtime + demo code), không phải riêng SDK — chưa đo được
kích thước APK Release (build Android Release tốn nhiều tài nguyên, máy đang tải cao lúc đo hôm
nay — xem mục "Ghi chú môi trường" bên dưới; để dành cho lần đo có máy rảnh hơn hoặc PHONG tự
chạy `pnpm release:android` rồi đo file `.apk`).

## Thời gian mở màn hình bản đồ + frame giật (`pnpm perf:rn`)

**Nơi đo:** `emulator-5554` · Pixel 7 (`sdk_gphone16k_arm64`) · Android 17 · bản dựng **Debug**
(`EXPO_PUBLIC_MLV_PERF=1`, Metro dev server, không phải bản Release đóng gói sẵn).

| Số đo | Giá trị |
|---|---|
| Thời gian mở màn hình bản đồ (p50) | 196 ms |
| Thời gian mở màn hình bản đồ (p95) | 248 ms |
| Số lần đo | 10/10 (không lượt nào quá hạn/lỗi) |
| Commit React mỗi fix GPS | 1,01 |

Chạy đầy đủ, thành công, 14/09/2026 khoảng 13:25 giờ VN — ngay sau khi sửa lỗi tường lửa macOS
chặn Metro↔emulator (xem `docs/superpowers/plans/.../` lịch sử Task 6 và bộ nhớ dự án
`tuong-lua-macos-chan-metro-emulator.md`). `commitsPerFix = 1,01` khớp với 128 fix GPS mô phỏng
và 129 commit React (128 + 1 commit do `setSession()` gọi lúc bắt đầu phiên) — số hợp lý cho một
bản đồ chỉ vẽ lại đúng vị trí chấm xanh mỗi fix, gần như không có công việc React thừa.

### Tổng frame khi kéo bản đồ / Frame giật — KHÔNG đo được bằng `dumpsys gfxinfo`

**Đây là phát hiện quan trọng nhất của Task 6, không phải một con số thiếu.** MapLibre Native
(qua `@maplibre/maplibre-react-native`) vẽ bản đồ vào một `SurfaceView` riêng
(`org.maplibre.android.maps.renderer.surfaceview.MapLibreSurfaceView`, xác nhận trong
`MLRNMapView.kt`). Nội dung `SurfaceView` được `SurfaceFlinger` ghép lớp trực tiếp, **không đi
qua pipeline HWUI** mà `dumpsys gfxinfo <package>` đo — đây là hành vi Android đã biết, cùng lý
do lệnh này vô dụng với trình phát video, camera preview, và game dùng `SurfaceView`.

Đã tự kiểm chứng bằng thí nghiệm thật: pan bản đồ 10 lần liên tiếp, chụp màn hình sau mỗi lần —
**9/10 lần cho ra trạng thái hình ảnh khác nhau** (bản đồ di chuyển thấy rõ), nhưng
`Total frames rendered` chỉ đếm được **6**. Không thể vẽ 9 trạng thái khác nhau trong 6 frame —
chứng minh gfxinfo đang mù với chính nội dung cần đo, không phải bản đồ đứng yên.

| Số đo | Giá trị |
|---|---|
| Tổng frame khi kéo bản đồ (`dumpsys gfxinfo`) | **Không đo được** — xem giải thích trên |
| Frame giật (`dumpsys gfxinfo`) | **Không đo được** — xem giải thích trên |

**Công cụ thay thế khả thi** (chưa cài, đánh giá trong lúc review Task 6):
- `dumpsys SurfaceFlinger --latency '<tên layer>'` — đã thử tay, lấy được bộ ba
  `desiredPresentTime/actualPresentTime/frameReadyTime` theo đúng layer `SurfaceView` của map;
  khả thi ngay nhưng buffer chỉ xoay vòng 128 frame và tên layer đổi theo mỗi lần mở app.
- `dumpsys SurfaceFlinger --timestats` — histogram jank theo layer, bền hơn `--latency`.
- Perfetto Frame Timeline (Android 12+) — đường chính thống hiện đại nhất, nặng nhất để dựng.
- Callback FPS riêng của MapLibre — **không có sẵn**: `@maplibre/maplibre-react-native` không
  expose `onFpsChanged`/tương đương trong cả `src` lẫn `android/src`; muốn dùng phải patch native.

Việc chọn công cụ thay thế (nếu cần) là quyết định để dành cho giai đoạn sau, không thuộc phạm
vi giai đoạn 1.

## Ghi chú môi trường — tải hệ thống cao ảnh hưởng độ ổn định phép đo hôm nay

Trong lúc làm việc, máy dev này (máy cá nhân của PHONG, không phải máy chủ production) có lúc
đạt **load average 22–31** — rất cao, do 2 phiên Claude Code khác của PHONG chạy song song cộng
các ứng dụng nền (Chrome, Microsoft Teams, Docker Desktop, Microsoft Defender). Dưới tải đó, một
lần chạy `pnpm perf:rn` sau đã gặp ANR thật (`Input dispatching timed out`) và tiến trình app bị
hệ thống chủ động kill vì khởi động quá chậm (`Killing ... start timeout`) — không phải lỗi
trong `scripts/perf-rn.mjs`/`perf-screen.tsx`, đã xác nhận bằng cách gọi thẳng API `directions`
(khoá vẫn sống, HTTP 200) và đọc log hệ thống (`ActivityManager: Killing ... excessive cpu`
xảy ra đồng thời cho các tiến trình khác không liên quan).

Bảng số ở trên lấy từ lần chạy **thành công, đầy đủ 10/10 lượt**, trước khi tải hệ thống lên quá
cao. Số liệu là thật, nhưng nên đo lại trên máy rảnh (hoặc máy thật, xem mục CHỜ PHONG) trước khi
dùng để so sánh nghiêm ngặt qua các lần phát hành sau — môi trường đo hôm nay không lý tưởng.

## Hạng mục cần máy thật

| Hạng mục | Trạng thái |
|---|---|
| FPS Android trên Mi 9 (Release) | CHỜ PHONG |
| Quan sát iOS trên iPhone 14 Plus (Release) | CHỜ PHONG |
| Kích thước APK Release | CHỜ PHONG (hoặc lần đo sau khi máy rảnh hơn) |

**Lưu ý cho PHONG khi đo trên Mi 9:** cột "Tổng frame"/"Frame giật" của `pnpm perf:rn --release`
nhiều khả năng cũng ra `—` (không đo được) vì cùng lý do gfxinfo mù với `SurfaceView` — đây
không phải lỗi, đánh giá độ mượt trên máy thật nên dựa vào quan sát trực tiếp (mắt nhìn khi kéo
bản đồ) chứ không chỉ tin con số CLI in ra.
