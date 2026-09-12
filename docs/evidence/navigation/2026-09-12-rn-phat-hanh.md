# Phát hành spec C — SDK React Native dẫn đường (Task 16 + Task 19)

Ngày: 2026-09-12. Plan: `docs/superpowers/plans/2026-09-12-dan-duong-react-native.md`.

## Kiểm sớm trên máy (Task 16)

Thao tác tự động bằng Maestro 2.8.0 (flow: tìm "cho ben thanh" → chọn "Chợ Bến Thành" → chip Xe máy
→ Giả lập → chờ "Đã đến nơi"). Emulator không có GPS nên app thử dùng dự phòng gốc Quận 1
(`FALLBACK_ORIGIN`, thêm ở commit `9b35694`).

| Hạng mục | Máy | Kết quả |
|---|---|---|
| Puck data URI hiện (rủi ro 2) | Android emulator Pixel 7 (API 34, x86_64) | **Đạt** — mũi tên xanh viền trắng hiện tại điểm bám, xoay theo hướng đi; `2026-09-12-rn-android-emu-gia-lap.png` |
| Tuyến + tuyến thay thế + marker đích | Android emulator | **Đạt** — tuyến chính xanh có viền, tuyến thay thế xám, thẻ hiện "● 3 phút · 1,0 km ○ 3 phút · 1,1 km"; `…-tuyen.png` |
| Giả lập chạy tới `arrived`, banner đổi câu, phần đã đi mờ, camera pitch 45 bám hướng | Android emulator | **Đạt** — 126 fix, sai số 8 m, 0 lần tính lại; `…-den-noi.png` |
| Puck data URI + giả lập | iOS simulator iPhone 17 Pro (iOS 26, `expo run:ios`) | **Đạt** — mũi tên xanh viền trắng hiện, xoay đúng hướng; `2026-09-12-rn-ios-sim-gia-lap.png` |
| Tuyến + tuyến thay thế + marker đích | iOS simulator | **Đạt** — banner "Rẽ phải vào Lê Thánh Tôn." đúng câu, khoảng cách; `…-ios-sim-tuyen.png` |
| Giả lập chạy tới `arrived` | iOS simulator | **Đạt** — 126 fix, sai số 8 m, dòng chẩn đoán "giọng có"; `…-ios-sim-den-noi.png` |
| TTS iOS khi khoá máy (rủi ro 1) | iPhone thật | Chưa kiểm — cần máy thật, khoá màn hình không giả lập được trên simulator (Task 16 bước 3 — PHONG cắm máy) |
| Foreground service Android (thông báo, dừng khi Dừng) | Android thật (Xiaomi Mi 9) | **Đạt** — thông báo "Đang dẫn đường" hiện đúng lúc dẫn đường, xác nhận trên máy thật của PHONG; biến mất khi Dừng chưa kiểm riêng biệt bằng ảnh chụp |

Lỗi app thử phát hiện và sửa ngay (không phải lỗi SDK): bàn phím che thẻ điều khiển sau khi chọn
gợi ý; `getCurrentPositionAsync` treo trên emulator; vị trí mặc định emulator ở Mỹ → tuyến lỗi.

**Ghi chú công cụ (không phải lỗi SDK):** trên iOS, `Pressable` bọc hai `<Text>` (tên + phụ) bị iOS
gộp thành MỘT nhãn accessibility `"Chợ Bến Thành, Công trường Quách Thị Trang"` (Android giữ hai nhãn
riêng); khớp regex thay vì chuỗi chính xác cho khâu thử tự động, không ảnh hưởng người dùng thật.

**Cả hai nền tảng đã dừng sau khi kiểm sớm** (simulator, emulator, Metro) để nhường bộ nhớ; Task 16
bước 3–4 (máy thật) và Task 20 (thực địa) là việc riêng của PHONG, build lại bằng
`pnpm example:rn --device`.

## Cổng local (GitHub Actions vẫn khoá vì thanh toán)

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | xanh, 436 file |
| `pnpm typecheck` | xanh, 14/14 task (core build + scripts + turbo) |
| `pnpm test` | gốc **116 file / 1228 test** xanh (3 skip có sẵn từ trước); apps/api **34 file / 253 test** xanh |
| `node scripts/notices-sync.mjs --check` | ✓ notices trong 4 gói SDK khớp gốc |
| `pnpm --filter @mapslibvn/docs build` + `playwright test docs.spec.ts` | build có `/dan-duong-react-native/`; link check **21/21** trang xanh |
| `pnpm example:rn --pack-only` + `npx tsc --noEmit` trong app thử | tarball 0.5.0 cài vào app; typecheck app sạch với `dist/index.d.ts` + `dist/expo/index.d.ts` |

Test mới của spec C: core `route-features` 6, style `first-symbol-layer` 2, RN 73 (session 8,
playback 2, puck 1, store 2, layers 3, map-navigation 7, hook 3, expo 17, cũ 30), scripts 11.

## Kích cỡ

| | 0.4.0 | 0.5.0 |
|---|---|---|
| tarball `@mapslibvn/react-native` | không đo lại | 42 267 byte |
| `dist/index.js` (gộp core) | — | 68,17 kB |
| `dist/expo/index.js` | — | 8,28 kB |
| core `dist/index.js` gzip | 16,91 kB | **17,34 kB** (trần 20 kB; +0,43 kB cho `routeFeatures` + `FIRST_SYMBOL_LAYER_ID`) |

Kiểm dist: `dist/index.js` 0 lần nhắc `expo-`; `dist/expo/index.js` import đúng 5 gói expo;
`dist/expo/index.d.ts` không có dòng import từ `expo-*` (chỉ nhắc trong comment doc).

## Hai lỗi thật chỉ lộ ra khi chạy máy thật (Task 16 bước 3, iPhone của PHONG)

Simulator không khoá được màn hình nên không phát hiện được hai lỗi này lúc kiểm sớm; chỉ lộ ra khi
PHONG cắm iPhone 14 Plus thật, bấm Giả lập rồi khoá màn hình: **giọng đọc im lặng hoàn toàn**.

1. **`expoAudioSession()` thiếu bước kích hoạt AVAudioSession.** Đọc mã nguồn expo-audio 57.0.5 xác
   nhận `setAudioModeAsync` (Swift `AudioModule.setAudioMode`) chỉ gọi `session.setCategory(...)`,
   KHÔNG gọi `AVAudioSession.setActive`; việc kích hoạt nằm ở hàm JS riêng `setIsAudioActiveAsync`.
   Sửa: `activate()` gọi thêm `Audio.setIsAudioActiveAsync(true)` ngay sau `setAudioModeAsync`;
   `deactivate()` gọi `setIsAudioActiveAsync(false)` trước khi trả mode.
2. **Chỉ kích hoạt phiên vẫn chưa đủ.** Giữa hai câu chỉ dẫn (vài chục giây không có tiếng phát ra
   thật), iOS coi app không còn dùng "audio" background mode chính đáng và thu hồi quyền chạy nền.
   Sửa đúng dự phòng (a) đã ghi sẵn trong spec mục 11: phát một vòng lặp WAV **im lặng tuyệt đối**
   (1 giây, 8000 Hz mono 16-bit toàn mẫu 0, sinh bởi `packages/react-native/scripts/gen-silence.mjs`
   → `src/expo/silence-audio.ts`, nhúng base64 giống cách làm với ảnh puck) liên tục suốt lúc dẫn
   đường, để phiên luôn "đang phát" thật sự.
3. **Lỗi thứ ba, ở app thử chứ không phải SDK:** nút "Giả lập" tạo phiên tạm chỉ truyền `speech` và
   `keepAwake`, quên truyền `audio: expoAudioSession()` — nên bản vá SDK lần đầu không có tác dụng gì
   khi kiểm bằng Giả lập. Sửa `App.tsx` thêm `audio: expoAudioSession()` vào phiên giả lập.

**Đã sửa cả ba, build lại, cài lại lên iPhone 14 Plus của PHONG (build lần 4), PHONG xác nhận trực
tiếp: "nghe được rồi, câu đọc rõ khi khoá máy".** Rủi ro 1 của spec C mục 11 — ĐÃ GIẢI QUYẾT.

Test mới: `packages/react-native/src/expo/device.test.ts` (4 test, kiểm thứ tự mode→active→phát vòng
lặp, không tạo player thứ hai khi activate lặp lại, dọn dẹp khi deactivate). `pnpm test` gốc vẫn xanh
sau khi thêm (116 file → không đổi số file, +1 test → 1229 gốc).

## Hai lỗi thật trên Android (Task 16 bước 3–4, Xiaomi Mi 9 của PHONG)

Máy thật thứ hai lộ ra hai lỗi mà simulator/emulator không lộ được: một lỗi crash tiến trình, một lỗi
im lặng giọng đọc — cùng dạng "chỉ lộ khi khoá màn hình/chạy nền thật" như trên iPhone nhưng nguyên
nhân hoàn toàn khác nhau giữa hai hệ điều hành.

1. **App crash ngay khi có vị trí nền đầu tiên.** `expo-task-manager` lên lịch job định vị bằng
   `JobScheduler.setPersisted(true)` **không điều kiện** (đọc mã nguồn `TaskManagerUtils.java`,
   `createJobInfo`, hardcode — không có cờ tắt). Thiếu quyền `RECEIVE_BOOT_COMPLETED`, Android ném
   `IllegalArgumentException` ngay trong `TaskBroadcastReceiver.onReceive` — luồng chính, không bắt
   được bằng try/catch phía JS vì xảy ra trong callback hệ thống. Sau vài lần crash liên tiếp Android
   còn khoá hẳn việc mở lại app ("Process … has crashed too many times: killing!"). Không plugin Expo
   nào tự thêm quyền này (xác nhận đọc mã nguồn `expo-location` và `expo-task-manager` 57.0.15).
   Sửa: thêm `android.permissions: ["RECEIVE_BOOT_COMPLETED"]` vào `app.json`, `expo prebuild --clean
   --platform android`, `adb uninstall` (xoá trạng thái khoá crash-loop) rồi cài lại — xác nhận bằng
   ảnh chụp màn hình, app mở bình thường, không crash.
2. **Giọng đọc im lặng hoàn toàn khi khoá màn hình.** Foreground service ĐỊNH VỊ vẫn còn nguyên
   (`serviceTypes` giữ cờ location suốt lúc khoá máy, logcat xác nhận), nhưng JS/TTS đứng yên hoàn
   toàn — khác cơ chế với iOS. Hai phần:
   - (a) `player.play()` một mình không khiến Android công nhận đây là phiên media "đang phát" chính
     thức. Đọc mã nguồn native `expo-audio` (`AudioControlsService.kt extends MediaSessionService`)
     xác nhận cần gọi thêm `player.setActiveForLockScreen(true, …)` để có `MediaSessionService` —
     dịch vụ nền RIÊNG cho media, độc lập với dịch vụ nền định vị. Sau khi vá, logcat xác nhận
     `serviceTypes` cộng thêm cờ media (`10` = `8` định vị + `2` media).
   - (b) Đối chiếu logcat chi tiết theo từng giây trong đúng khung khoá màn hình cho thấy: khi dịch
     vụ media hoạt động ĐƠN ĐỘC (không kèm dịch vụ định vị, `serviceTypes=2`), hoàn toàn không có
     dòng "headless task" nào chạy suốt lúc khoá — chỉ track âm thanh gốc (native, không cần JS) tự
     đếm giờ đều. Kết luận: dịch vụ media chỉ giữ tiến trình sống + luồng âm thanh gốc chạy, **không
     đánh thức luồng JS chính**; chỉ dịch vụ nền ĐỊNH VỊ (`startLocationUpdatesAsync` qua
     `JobScheduler` của expo-task-manager) có cơ chế đó. Hệ quả: phiên **Giả lập** (`playbackSource`,
     `setTimeout` JS thuần, không đi qua vị trí thật) sẽ luôn câm khi khoá màn hình Android bất kể vá
     gì thêm — chấp nhận là giới hạn của công cụ mô phỏng/demo, không sửa. Phiên **Bắt đầu** (GPS thật
     qua `expoLocationSource`) cần có **di chuyển thật** để tạo tiến độ tuyến mới — đứng yên một chỗ
     không sinh câu thông báo mới dù cơ chế nền chạy đúng, dễ nhầm là bug.

**Đã sửa (2)(a), build lại, cài lại lên Xiaomi Mi 9 của PHONG, PHONG bấm Bắt đầu, khoá màn hình và
di chuyển thật, xác nhận trực tiếp: "ok hoạt động tốt".** Rủi ro giọng đọc im khi khoá màn hình Android
của spec C mục 11 — ĐÃ GIẢI QUYẾT. `device.test.ts` mở rộng thêm assertion cho `setActiveForLockScreen`
(vẫn 4 test, không thêm file).
