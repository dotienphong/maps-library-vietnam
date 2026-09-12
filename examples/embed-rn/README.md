# App Expo thử độc lập

Dự án Expo **ngoài pnpm workspace**, không thuộc docs và không thuộc dự án nào khác, để chứng minh
`@mapslibvn/react-native` cài được như người ngoài (từ tarball, vì chưa publish npm — checklist B3)
và chạy trên iOS/Android bằng khoá `mobile` (nghiệm thu M6).

```bash
pnpm example:rn            # macOS: iOS simulator; nơi khác: Android
pnpm example:rn --android
pnpm example:rn --pack-only   # chỉ build + pack + cài
```

Khoá đọc từ `KEY_EXAMPLE_RN` trong `.env` gốc repo (cấp: xem `.env.example`); script ghi vào
`examples/embed-rn/.env` (gitignore) dưới `EXPO_PUBLIC_MAPSLIBVN_KEY`. Không chạy trên Expo Go
(cần native module) — `expo run:*` tự prebuild `ios/`/`android/` (gitignore).

Yêu cầu máy: Xcode + simulator, hoặc Android Studio + một AVD API ≥ 23; `npx expo doctor` xanh.

## Dẫn đường (spec C)

App có màn dẫn đường đủ luồng (điểm đến → phương tiện → Bắt đầu / Giả lập). Định vị nền cần plugin
trong `app.json` (đã có) và **prebuild lại** sau khi đổi plugin: `npx expo prebuild --clean` trong
thư mục này (xoá `ios/`, `android/` rồi sinh lại — đều gitignore).

Máy thật: `pnpm example:rn --device --android` (bật USB debugging) hoặc `pnpm example:rn --device`
(iPhone: mở `ios/MapsLibVNDemo.xcworkspace` một lần, Signing & Capabilities → Team = Apple ID cá
nhân; trên máy: Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị → tin cậy nhà phát triển).

## Build bản Release (máy thật, chạy độc lập)

`pnpm example:rn --device` build bản **Debug**: JS được Metro phục vụ trực tiếp từ laptop, rút dây
hoặc tắt Metro là app đứng im/lỗi. Để đi thử ngoài đường (dẫn đường, la bàn, GPS nền) mà không vướng
dây/laptop, build bản **Release** — JS đóng gói sẵn vào app lúc build, cài xong chạy độc lập hoàn toàn:

```bash
pnpm release:ios        # iOS: --configuration Release, kèm --no-bundler
pnpm release:android    # Android: --variant release, kèm --no-bundler
```

Cả hai luôn cài lên **máy thật** (không simulator/emulator — la bàn/GPS thật không giả lập được).
Script tự dò máy đang cắm/ghép nối qua `xcrun devicectl list devices` (iOS) / `adb devices -l`
(Android). Nếu có nhiều hơn một máy, lệnh dừng lại và yêu cầu chỉ rõ:

```bash
pnpm release:ios -- --device-name "iPhone của Phong"
pnpm release:android -- --device-name bab02fbc    # serial, lấy bằng `adb devices`
```

Android: `--device-name` nhận **serial** (dễ lấy bằng `adb devices`); script tự dịch sang model bên
trong vì Expo CLI chỉ so khớp thiết bị theo model, không theo serial. Nếu cắm cùng lúc ≥ 2 máy
**trùng model**, Expo CLI có thể chọn nhầm máy trong số đó (hạn chế của chính Expo CLI, script không
sửa được) — nên tránh cắm 2 máy cùng dòng cùng lúc khi release.

Yêu cầu như build Debug máy thật ở trên (iOS: mở `.xcworkspace` một lần, chọn Team ký; Android: bật
USB debugging). Vì JS đã đóng gói sẵn, **sửa code JS xong phải chạy lại `pnpm release:*`** để cài bản
mới — không có live reload như Debug. Build đầu tiên (hoặc sau khi đổi native plugin) vẫn phải
prebuild + CocoaPods/Gradle nên mất vài phút; các lần sau nhanh hơn.

## La bàn và con quay hồi chuyển

Chấm xanh có nón hướng hiện trước khi dẫn đường (nguồn `expoLocationSource({ background: false })` +
`expoHeadingSource()`); nút **La bàn** bật bản đồ xoay theo hướng nhìn, nút **Về tôi** hiện sau khi kéo
bản đồ. Trong dẫn đường, puck xoay theo máy khi đứng yên; dòng chẩn đoán ghi `hướng 123° high fused`.
Cần `expo-sensors` (đã trong `package.json`) và plugin trong `app.json` → **prebuild lại** sau khi kéo
code mới: `npx expo prebuild --clean`. Simulator/emulator không có la bàn thật: Android emulator dùng
Extended controls → Virtual sensors → Rotation để xoay; iOS simulator không có hướng (nón không hiện).
