// Hàm thuần cho `pnpm example:rn` (scripts/example-rn.mjs) — app Expo thử độc lập cài SDK bằng tarball.
export const EXAMPLE_RN_DIR = 'examples/embed-rn';
export const KEY_ENV_NAME_RN = 'KEY_EXAMPLE_RN';
export const TARBALL = 'mapslibvn-react-native.tgz';
export const DEFAULT_API = 'https://api.ai-solutions.io.vn';
export const RN_PACKAGE_DIR = 'packages/react-native';
/** `package` (Android) và `bundleIdentifier` (iOS) trong examples/embed-rn/app.json — phải khớp tay. */
export const BUNDLE_ID = 'vn.mapslibvn.demo';

/**
 * @param {string[]} argv
 * @param {string} platform process.platform
 * @returns {{ platform: 'ios' | 'android', packOnly: boolean, device: boolean, release: boolean, deviceName?: string, acceptNative?: boolean }}
 */
export function parseArgs(argv, platform) {
  /** @type {'ios' | 'android'} */
  let target = platform === 'darwin' ? 'ios' : 'android';
  let packOnly = false;
  let device = false;
  let release = false;
  let acceptNative = false;
  /** @type {string | undefined} */
  let deviceName;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue; // `pnpm release:ios -- --device-name …` chuyển tiếp cả dấu `--`
    if (a === '--ios') target = 'ios';
    else if (a === '--android') target = 'android';
    else if (a === '--pack-only') packOnly = true;
    else if (a === '--device') device = true;
    else if (a === '--release') {
      // Release luôn cài lên máy thật (không simulator/emulator) nên kéo theo --device.
      device = true;
      release = true;
    } else if (a === '--device-name') {
      deviceName = argv[i + 1];
      i += 1;
    } else if (a === '--accept-native') {
      // Thoát vòng luẩn quẩn: sau `npx expo prebuild --clean`, mốc fingerprint cũ chưa cập nhật
      // (chỉ cập nhật sau một lần release THÀNH CÔNG) nên `assertNativeFingerprintFresh` vẫn chặn
      // dù thư mục native đã đúng. Cờ này bỏ qua ĐÚNG một lần kiểm đó, không bỏ qua gì khác.
      acceptNative = true;
    } else if (a === '--key')
      break; // phần còn lại do resolveKey đọc
    else
      throw new Error(
        `Không hiểu tham số ${a}. Dùng: --ios | --android | --device | --release | --device-name <tên> | --accept-native | --pack-only | --key mlv_live_…`,
      );
  }
  return {
    platform: target,
    packOnly,
    device,
    release,
    ...(deviceName !== undefined ? { deviceName } : {}),
    ...(acceptNative ? { acceptNative } : {}),
  };
}

/** Tên file `pnpm pack` sinh: bỏ `@`, đổi `/` thành `-`. @param {string} name @param {string} version */
export function packedTarballName(name, version) {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

/** @param {string} key @param {string} api */
export function envFileContent(key, api) {
  return `EXPO_PUBLIC_MAPSLIBVN_KEY=${key}\nEXPO_PUBLIC_MAPSLIBVN_API=${api}\n`;
}

/**
 * @param {'ios' | 'android'} platform
 * @param {boolean} [device] chạy trên máy thật đang cắm (bare `--device` — Expo CLI hỏi chọn nếu
 *   nhiều máy ghép nối, chỉ dùng khi chắc chắn có đúng một máy)
 * @param {boolean} [release] `--configuration Release` (iOS) / `--variant release` (Android), kèm
 *   `--no-bundler` — bản cài xong chạy độc lập, không cần Metro giữ kết nối với laptop
 * @param {string} [deviceName] tên/UDID (iOS) hoặc model (Android — xem `androidDeviceArg`, KHÔNG
 *   phải serial) — ghi đè `device` trần để không rơi vào hỏi chọn tương tác khi có nhiều máy
 */
export function expoRunArgs(platform, device = false, release = false, deviceName = undefined) {
  const args = ['expo', `run:${platform}`];
  if (deviceName) args.push('--device', deviceName);
  else if (device) args.push('--device');
  if (release) {
    args.push(...(platform === 'ios' ? ['--configuration', 'Release'] : ['--variant', 'release']));
    args.push('--no-bundler');
  }
  return args;
}

/**
 * Gỡ cài bản cũ trước khi cài Release mới — chỉ Android (quyết định PHONG 13/09/2026): cài đè giữ
 * nguyên app-data (gồm cache ambient MapLibre Native), gỡ hẳn thì chắc chắn sạch; `adb uninstall`
 * không lỗi nếu app chưa từng cài, caller dùng `capture()` để bỏ qua trường hợp đó.
 *
 * iOS trả `null` — KHÔNG gỡ: app ký bằng Apple ID cá nhân, xoá app cuối cùng của developer đó khiến
 * iPhone quên "tin developer" và lần cài kế bị từ chối mở (`FBSOpenApplicationErrorDomain 3`:
 * "profile has not been explicitly trusted by the user", gặp thật 13/09/2026) → phải vào Cài đặt →
 * Cài đặt chung → VPN & Quản lý thiết bị → Tin cậy sau MỖI lần release. Bundle JS nằm trong `.app`
 * nên cài đè đã luôn là code mới; cache style/tile của MapLibre theo HTTP max-age 1 giờ, tự hết.
 * @param {'ios' | 'android'} platform
 * @param {string} deviceIdentifier serial Android (từ `parseAdbDevices`)
 * @returns {{ cmd: string, args: string[] } | null}
 */
export function uninstallCommand(platform, deviceIdentifier) {
  if (platform !== 'android') return null;
  return { cmd: 'adb', args: ['-s', deviceIdentifier, 'uninstall', BUNDLE_ID] };
}

/**
 * Output của task Gradle `createBundleReleaseJsAndAssets` (react-native-gradle-plugin) phải xoá
 * trước khi build Release. Task này loại mọi đường dẫn `node_modules` khỏi input (glob exclude trong
 * BundleHermesCTask.kt), nên
 * cài SDK mới bằng `npm install` KHÔNG làm nó chạy lại → APK đóng gói bundle JS cũ dù Gradle báo
 * BUILD SUCCESSFUL (sự cố 13/09/2026: bundle mtime 01:17 vẫn được dùng sau khi SDK đổi lúc 07:06).
 * Xoá output → Gradle thấy thiếu → bundle lại từ node_modules hiện tại. iOS: script phase
 * "Bundle React Native code and images" của Xcode chạy mỗi build, không có cache tương đương.
 * Dùng `/` thay `path.join` để đường dẫn ổn định trên mọi hệ điều hành (fs Node nhận `/` trên Windows).
 * @param {'ios' | 'android'} platform
 * @param {string} appDir thư mục app Expo (examples/embed-rn)
 * @returns {string[]}
 */
export function staleBundleDirs(platform, appDir) {
  if (platform !== 'android') return [];
  const generated = `${appDir}/android/app/build/generated`;
  return [`${generated}/assets/react/release`, `${generated}/res/react/release`];
}

/**
 * Phân tích bảng văn bản của `xcrun devicectl list devices` thành danh sách thiết bị. Cột phân
 * cách bằng ≥ 2 khoảng trắng (tên máy/model có thể chứa một khoảng trắng đơn, ví dụ "iPhone của
 * Phong"), nên tách theo cụm khoảng trắng thay vì cắt cột cố định — bền hơn với độ rộng cột thay
 * đổi (ví dụ tên có emoji).
 * @param {string} output
 * @returns {{ name: string, hostname: string, identifier: string, state: string, model: string }[]}
 */
export function parseDevicectlDevices(output) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line && !/^-+(\s+-+)*$/.test(line))
    .map((line) => line.split(/ {2,}/).map((s) => s.trim()))
    .filter((parts) => parts.length >= 4 && parts[0] !== 'Name')
    .map((parts) => ({
      name: parts[0] ?? '',
      hostname: parts[1] ?? '',
      identifier: parts[2] ?? '',
      state: parts[3] ?? '',
      model: parts[4] ?? '',
    }));
}

/**
 * Thiết bị iOS đã ghép nối VÀ đang có mặt (đủ điều kiện cài app) — bỏ máy đã ghép nối nhưng hiện
 * không cắm/không cùng mạng.
 * @param {ReturnType<typeof parseDevicectlDevices>} devices
 */
export function availableIosDevices(devices) {
  return devices.filter((d) => d.state.startsWith('available'));
}

/**
 * Phân tích `adb devices -l` thành danh sách {serial, model} thật đang cắm (bỏ dòng tiêu đề,
 * thiết bị `unauthorized`/`offline`, và emulator ảo — release chỉ nhắm máy thật). Cần cột `-l`
 * (không phải `adb devices` trơn) vì `expo run:android --device <tên>` so khớp thiết bị theo
 * `model:` — KHÔNG so theo serial (xem `androidDeviceArg`).
 * @param {string} output
 * @returns {{ serial: string, model: string }[]}
 */
export function parseAdbDevices(output) {
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[1] === 'device' && !(parts[0] ?? '').startsWith('emulator-'))
    .map((parts) => ({
      serial: parts[0] ?? '',
      model: (parts.find((p) => p.startsWith('model:')) ?? '').replace('model:', ''),
    }))
    .filter((d) => d.serial);
}

/**
 * `expo run:android --device <tên>` so khớp thiết bị Android theo **model** (cột `model:` của
 * `adb devices -l`), không theo serial — truyền thẳng serial (như iOS UDID) sẽ luôn báo "Could not
 * find device with name". Hàm này dịch serial người dùng chỉ định qua `--device-name` (hoặc serial
 * duy nhất tự chọn được) sang đúng model để chuyển tiếp xuống Expo CLI.
 * @param {{ serial: string, model: string }[]} devices
 * @param {string} serial
 * @returns {string}
 */
export function androidDeviceArg(devices, serial) {
  const device = devices.find((d) => d.serial === serial);
  if (!device) {
    throw new Error(`Không thấy máy Android serial "${serial}" trong danh sách đang cắm.`);
  }
  return device.model;
}

/**
 * Chọn đúng một thiết bị khi không truyền `--device-name`. 0 hoặc ≥ 2 thiết bị → lỗi liệt kê tên,
 * để không bao giờ rơi vào hỏi chọn tương tác của Expo CLI (treo trong môi trường không phím).
 * @param {string[]} names
 * @param {string} kind ghi trong thông báo lỗi, ví dụ 'iOS' hoặc 'Android'
 */
export function pickSingleDevice(names, kind) {
  if (names.length === 1) {
    const name = names[0];
    if (name === undefined) throw new Error('Không có tên thiết bị.');
    return name;
  }
  if (names.length === 0) {
    throw new Error(
      `Không thấy thiết bị ${kind} thật nào đang cắm/ghép nối và có mặt. Cắm máy rồi thử lại.`,
    );
  }
  throw new Error(
    `Có ${names.length} thiết bị ${kind}: ${names.map((n) => `"${n}"`).join(', ')}. Chỉ định rõ bằng --device-name "<tên>".`,
  );
}

/**
 * Tra máy iOS theo thứ người dùng gõ ở `--device-name` — chấp nhận cả TÊN lẫn identifier, vì
 * `expo run:ios --device` nhận cả hai. Cần identifier (không chỉ tên) cho lượt hâm nóng hồ sơ ký:
 * `xcodebuild -destination id=<…>` chỉ nhận identifier (xem `lib/ios-provisioning.mjs`).
 * @param {{ name: string, identifier: string }[]} devices máy đang có mặt (availableIosDevices)
 * @param {string} wanted tên hoặc identifier
 * @returns {{ name: string, identifier: string }}
 */
export function findIosDevice(devices, wanted) {
  const device = devices.find((d) => d.name === wanted || d.identifier === wanted);
  if (!device) {
    throw new Error(
      `Không thấy máy iOS "${wanted}" trong số đang có mặt: ${
        devices.map((d) => `"${d.name}"`).join(', ') || '(không có máy nào)'
      }. Kiểm tra lại dấu tiếng Việt trong tên, hoặc cắm máy rồi thử lại.`,
    );
  }
  return device;
}

/**
 * Thư mục SDK Android mặc định của mỗi hệ điều hành — dùng khi `ANDROID_HOME` chưa đặt.
 * @param {string} platform process.platform
 * @param {string} home thư mục người dùng
 */
export function defaultAndroidSdk(platform, home) {
  if (platform === 'darwin') return `${home}/Library/Android/sdk`;
  if (platform === 'win32') return `${home}\\AppData\\Local\\Android\\Sdk`;
  return `${home}/Android/Sdk`;
}

/**
 * JDK kèm theo Android Studio — AGP/Gradle chưa chạy được trên JDK mới nhất (JDK 26 làm
 * `configureCMakeDebug` của expo-modules-core chết), nên đây là bản Java "đúng" cho build Android.
 * @param {string} platform process.platform
 */
export function androidStudioJdk(platform) {
  if (platform === 'darwin') return '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
  if (platform === 'win32') return 'C:\\Program Files\\Android\\Android Studio\\jbr';
  return '/opt/android-studio/jbr';
}

/**
 * Biến môi trường bù cho `expo run:android`: Gradle đòi `ANDROID_HOME` (hoặc `sdk.dir`) và một
 * JDK được AGP hỗ trợ, mà Android Studio không thêm biến nào vào shell. Đã có biến thì tôn
 * trọng, không ghi đè.
 * @param {Record<string, string | undefined>} env
 * @param {string} sdkDir
 * @param {string} [jdkDir] bỏ trống nếu không tìm thấy JDK của Android Studio
 */
export function androidEnv(env, sdkDir, jdkDir) {
  /** @type {Record<string, string>} */
  const extra = {};
  if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) extra.ANDROID_HOME = sdkDir;
  if (!env.JAVA_HOME && jdkDir) extra.JAVA_HOME = jdkDir;
  return extra;
}
