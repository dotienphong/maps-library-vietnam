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
