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

**JS luôn mới, nhưng cấu hình native thì không tự động** (phát hiện 14/09/2026): `npx expo
run:<platform>` chỉ prebuild khi `ios/`/`android/` **chưa tồn tại** — hai thư mục này không bị xoá
giữa các lần chạy, nên nếu bạn sửa `app.json`/plugin mà quên `npx expo prebuild --clean`, JS vẫn
mới nhất nhưng app cài lên máy vẫn mang quyền/plugin/cấu hình native CŨ, không báo lỗi gì. Từ
14/09/2026 `pnpm release:*` tự kiểm bằng `@expo/fingerprint` (chính cơ chế Expo dùng cho EAS Build
local cache) và **chặn sớm** nếu cấu hình đã đổi kể từ lần release gần nhất, kèm đúng lệnh khắc
phục ngay trong thông điệp lỗi.

Bị chặn thì làm theo đúng thứ tự:

```bash
# 1. Nếu app.json/plugin vừa đổi mà chưa tái tạo thư mục native:
cd examples/embed-rn && npx expo prebuild --clean

# 2. Rồi release lại như bình thường (từ gốc repo)
pnpm release:ios        # hoặc pnpm release:android
```

Nếu **đã** `prebuild --clean` rồi mà vẫn bị chặn (máy chưa từng ghi mốc — ví dụ máy mới, hoặc lần
đầu bật cờ này trên một máy đã có sẵn `ios/`/`android/` từ trước), thêm `--accept-native` vào
**đúng một lần** chạy tiếp theo để xác nhận thư mục hiện tại là mốc tin cậy mới — build vẫn chạy đủ
như thường, chỉ bỏ qua cổng kiểm lần này:

```bash
pnpm release:ios --accept-native
pnpm release:android --accept-native
```

Từ lần sau, cổng kiểm hoạt động bình thường không cần cờ này nữa — chỉ dùng lại khi bị chặn sau khi
đã prebuild đúng cách.

### iOS: hồ sơ ký hết hạn mỗi 7 ngày (đã tự xử lý từ 20/09/2026)

Hồ sơ ký (provisioning profile) cấp bởi **Apple ID cá nhân** (free personal team) sống đúng **7
ngày**. Hết hạn thì Xcode dọn nó đi và `pnpm release:ios` chết với:

```
❌ No profiles for 'vn.mapslibvn.demo' were found: Xcode couldn't find any iOS App Development
   provisioning profiles matching 'vn.mapslibvn.demo'. Automatic signing is disabled and unable to
   generate a profile. To enable automatic signing, pass -allowProvisioningUpdates to xcodebuild.
```

Đừng đi tìm lỗi ở chứng chỉ: **chứng chỉ vẫn còn, chỉ hồ sơ mất**. Chứng chỉ `Apple Development`
sống 1 năm, hồ sơ mới là thứ hết hạn hằng tuần. Kiểm bằng:

```bash
security find-identity -v -p codesigning          # chứng chỉ — thường vẫn "1 valid identities"
ls ~/Library/Developer/Xcode/UserData/"Provisioning Profiles"/   # hồ sơ — thường RỖNG
```

Thư mục hồ sơ của Xcode 16+ là đường dẫn trên; `~/Library/MobileDevice/Provisioning Profiles` là
chỗ cũ, nhìn vào đó dễ kết luận nhầm là "vẫn còn hồ sơ".

Expo CLI **không tự chữa được**: nó chỉ truyền `-allowProvisioningUpdates` khi `project.pbxproj`
chưa có `DEVELOPMENT_TEAM`, mà chính nó ghi trường đó vào từ lần build đầu tiên
(`@expo/cli` → `run/ios/codeSigning/configureCodeSigning.js` + `run/ios/XcodeBuild.js`); `expo
run:ios` cũng không có cờ nào chuyển tiếp tham số xuống `xcodebuild`.

Từ 20/09/2026 `pnpm release:ios` tự kiểm hồ sơ trước khi gọi Expo, và tự chạy một lượt `xcodebuild
… -allowProvisioningUpdates -allowProvisioningDeviceRegistration` để xin hồ sơ mới khi hồ sơ thiếu
hoặc còn dưới 24 giờ. Không cần làm gì bằng tay — chỉ mất thêm vài phút ở đúng lượt xin hồ sơ, các
lượt release khác không chậm đi.

Hai trường hợp vẫn cần tay:

- **Phiên đăng nhập Apple ID trong Xcode hết hạn** → lượt xin hồ sơ thất bại. Mở Xcode → Settings →
  Accounts, đăng nhập lại (cần mật khẩu + 2FA), rồi chạy lại lệnh release.
- **iPhone từ chối MỞ app** (`FBSOpenApplicationErrorDomain error 3`, "profile has not been
  explicitly trusted by the user") — app đã cài xong trên máy, chỉ lần mở bị chặn: Cài đặt → Cài
  đặt chung → VPN & Quản lý thiết bị → chọn `Apple Development: …` → **Tin cậy**. Cái được tin cậy
  là **chứng chỉ**, nên chỉ phải làm một lần cho mỗi chứng chỉ, không phải mỗi tuần.

## La bàn và con quay hồi chuyển

Chấm xanh có nón hướng hiện trước khi dẫn đường (nguồn `expoLocationSource({ background: false })` +
`expoHeadingSource()`); nút **La bàn** bật bản đồ xoay theo hướng nhìn, nút **Về tôi** hiện sau khi kéo
bản đồ. Trong dẫn đường, puck xoay theo máy khi đứng yên; dòng chẩn đoán ghi `hướng 123° high fused`.
Cần `expo-sensors` (đã trong `package.json`) và plugin trong `app.json` → **prebuild lại** sau khi kéo
code mới: `npx expo prebuild --clean`. Simulator/emulator không có la bàn thật: Android emulator dùng
Extended controls → Virtual sensors → Rotation để xoay; iOS simulator không có hướng (nón không hiện).
