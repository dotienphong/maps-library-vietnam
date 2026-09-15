#!/usr/bin/env node
// Mở app Expo thử độc lập bằng một lệnh (nghiệm thu M6, spec M6 mục 5.3):
//   pnpm example:rn            (iOS trên macOS, Android nơi khác; khoá từ KEY_EXAMPLE_RN trong .env)
//   pnpm example:rn --android
//   pnpm example:rn --pack-only        (chỉ build + pack + cài, không chạy)
//   pnpm example:rn --device           (máy thật đang cắm USB; iOS cần ký bằng Apple ID trong Xcode)
//   pnpm example:rn --android --key mlv_live_…   (ghi đè tạm; --key phải đứng CUỐI)
//   pnpm release:ios / pnpm release:android      (bản Release lên máy thật — xem dưới)
// Các bước: build core + react-native → pnpm pack vào examples/embed-rn/vendor → ghi .env của app
// → npm install tarball → npx expo run:<platform>. Khoá KHÔNG nằm trong repo. Ctrl+C để dừng.
//
// `--release` (dùng qua `pnpm release:ios [--device-name "<tên>"]` / `pnpm release:android […]`):
// build cấu hình Release (iOS: `--configuration Release`; Android: `--variant release`) kèm
// `--no-bundler` — JS đã đóng gói sẵn vào app lúc build nên cài xong CHẠY ĐỘC LẬP, rút dây/tắt
// Metro/laptop vẫn hoạt động bình thường (yêu cầu PHONG 13/09/2026, xem README mục "Build Release").
// Luôn cần máy thật + tên rõ ràng: iOS ghép nối nhiều máy thì Expo CLI hỏi chọn tương tác và TREO
// trong môi trường không phím, nên script tự liệt kê máy đang có mặt và chỉ chạy tiếp khi đúng một
// máy (hoặc đã truyền `--device-name`).
// `--release` LUÔN xoá bundle JS Gradle đã cache (Android) và gỡ cài bản cũ trên máy (chỉ Android)
// trước khi build/cài (quyết định PHONG 13/09/2026 — "release phải luôn là code mới nhất"). Sự cố
// thật cùng ngày: Gradle báo `createBundleReleaseJsAndAssets UP-TO-DATE` và đóng gói bundle từ 01:17
// vào APK dù SDK trong node_modules đã đổi lúc 07:06 — task đó không theo dõi node_modules (xem
// `staleBundleDirs`). iOS không gỡ cài: xoá app làm iPhone quên tin developer Apple ID cá nhân, phải
// Trust lại bằng tay mỗi lần (xem `uninstallCommand`). Không lỗi nếu thư mục cache chưa tồn tại.
//
// Cái trên chỉ đảm bảo JS luôn mới — KHÔNG đảm bảo cấu hình NATIVE (`app.json`, config plugin,
// native dependency) luôn mới. `npx expo run:<platform>` (`ensureNativeProjectAsync` trong
// `@expo/cli`) chỉ prebuild khi `ios/`/`android/` CHƯA tồn tại; còn thư mục là dùng nguyên bản cũ,
// im lặng bỏ qua mọi thay đổi app.json kể từ lần prebuild trước (README có ghi "phải prebuild lại
// sau khi đổi plugin" nhưng chỉ dựa trí nhớ, phát hiện 14/09/2026 khi rà lại toàn bộ script này).
// `--release` giờ CHẶN sớm nếu hash `@expo/fingerprint` của thư mục native lệch với lần build gần
// nhất (xem `lib/native-fingerprint.mjs`) — báo lỗi kèm đúng lệnh khắc phục thay vì âm thầm cài
// app dùng quyền/plugin cũ.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import 'dotenv/config';
import {
  androidDeviceArg,
  androidEnv,
  androidStudioJdk,
  availableIosDevices,
  DEFAULT_API,
  defaultAndroidSdk,
  EXAMPLE_RN_DIR,
  envFileContent,
  expoRunArgs,
  KEY_ENV_NAME_RN,
  packedTarballName,
  parseAdbDevices,
  parseArgs,
  parseDevicectlDevices,
  pickSingleDevice,
  RN_PACKAGE_DIR,
  staleBundleDirs,
  TARBALL,
  uninstallCommand,
} from './lib/example-rn.mjs';
import { resolveKey } from './lib/example-serve.mjs';
import {
  assertNativeFingerprintFresh,
  recordNativeFingerprint,
} from './lib/native-fingerprint.mjs';
import { capture, run } from './lib/run.mjs';

const argv = process.argv.slice(2);
const { platform, packOnly, device, release, deviceName, acceptNative } = parseArgs(
  argv,
  process.platform,
);
const key = resolveKey(argv, process.env, { envName: KEY_ENV_NAME_RN, hint: 'pnpm example:rn' });
const api = process.env.EXAMPLE_RN_API ?? DEFAULT_API;

const appDir = resolve(EXAMPLE_RN_DIR);
if (!existsSync(join(appDir, 'package.json'))) {
  throw new Error(`Không thấy ${EXAMPLE_RN_DIR}/package.json — chạy từ gốc repo`);
}

/**
 * Serial Android thật (khác `resolvedDeviceName`, đã dịch sang model cho Expo CLI) — `adb -s` cho
 * `uninstallCommand` phải nhắm bằng serial, không phải model. Rỗng trên iOS (không dùng tới).
 * @type {string | undefined}
 */
let androidSerial;

/**
 * Tên/UDID (iOS) hoặc model (Android) máy thật để truyền cho `expo run:<platform> --device` —
 * bắt buộc khi `--release`, không rơi vào hỏi chọn tương tác của Expo CLI. Android: `--device`
 * của Expo CLI so khớp theo model chứ không theo serial, nên serial do người dùng chỉ định qua
 * `--device-name` (hoặc tự chọn được khi chỉ có đúng một máy) luôn phải dịch sang model bằng
 * `androidDeviceArg` trước khi chuyển tiếp (xem chú thích trong `lib/example-rn.mjs`).
 */
function resolveDeviceName() {
  if (platform === 'ios') {
    if (deviceName) return deviceName;
    const devices = availableIosDevices(
      parseDevicectlDevices(capture('xcrun', ['devicectl', 'list', 'devices'])),
    );
    return pickSingleDevice(
      devices.map((d) => d.name),
      'iOS',
    );
  }
  const devices = parseAdbDevices(capture('adb', ['devices', '-l']));
  const serial =
    deviceName ??
    pickSingleDevice(
      devices.map((d) => d.serial),
      'Android',
    );
  androidSerial = serial;
  return androidDeviceArg(devices, serial);
}
const resolvedDeviceName = release ? resolveDeviceName() : undefined;
if (release) console.log(`  Máy: ${resolvedDeviceName}`);

console.log('▶ 1/5 build @mapslibvn/core + @mapslibvn/react-native');
run('pnpm', ['--filter', '@mapslibvn/core', '--filter', '@mapslibvn/react-native', 'build']);

console.log('▶ 2/5 pnpm pack → vendor/');
const vendor = join(appDir, 'vendor');
mkdirSync(vendor, { recursive: true });
// `pnpm pack` không nhận `--filter` (pnpm hiểu thành `--recursive`) → chạy trong thư mục gói.
//
// Tên file pnpm pack sinh ra (packedTarballName) chỉ phụ thuộc tên+version gói — GIỐNG NHAU ở mọi
// lần chạy, và TARBALL (tên đích cuối) cũng là hằng số dùng chung. Pack thẳng vào `vendor/` khiến
// hai lệnh release chạy gần nhau (vd `release:ios` và `release:android` cùng lúc, hoặc test lại
// nhanh hai lần) tranh nhau đúng hai tên file đó: bên chạy sau ENOENT khi renameSync vì bên kia đã
// "cướp" mất file nguồn bằng chính renameSync của nó (rename là MOVE, không phải copy — sự cố thật
// 14/09/2026). Pack vào thư mục tạm RIÊNG cho mỗi lần chạy rồi mới chuyển vào tên dùng chung: chỉ
// còn bước cuối (rename vào TARBALL) là dùng chung, và đó là move từ một nguồn riêng nên không còn
// ENOENT (tối đa "ai xong sau ghi đè", không phải crash).
const packTmp = mkdtempSync(join(vendor, '.tmp-pack-'));
run('pnpm', ['pack', '--pack-destination', packTmp], { cwd: resolve(RN_PACKAGE_DIR) });
const pkg = JSON.parse(readFileSync(join(RN_PACKAGE_DIR, 'package.json'), 'utf8'));
renameSync(join(packTmp, packedTarballName(pkg.name, pkg.version)), join(vendor, TARBALL));
rmSync(packTmp, { recursive: true, force: true });

console.log('▶ 3/5 ghi examples/embed-rn/.env (không commit)');
writeFileSync(join(appDir, '.env'), envFileContent(key, api));

console.log('▶ 4/5 npm install tarball (cài lại mỗi lần để không dính bản cũ)');
run('npm', ['install', '--no-audit', '--no-fund', `./vendor/${TARBALL}`], { cwd: appDir });

if (packOnly) {
  console.log('✓ --pack-only: xong. Chạy tay: cd examples/embed-rn && npx expo run:ios');
} else {
  if (release) {
    // `release` true → resolveDeviceName() đã chạy và trả string thật; TS không tự narrow qua biến
    // ngoài scope nên guard tường minh ở đây (không nên xảy ra ở runtime).
    if (!resolvedDeviceName) throw new Error('resolvedDeviceName rỗng dù release=true');
    // Chặn TRƯỚC khi đụng máy: thư mục ios/android có thể đã lệch app.json/plugin (xem chú thích
    // đầu file) mà expo run:<platform> không tự phát hiện được.
    if (acceptNative) {
      console.log(
        '▶ --accept-native: bỏ qua kiểm fingerprint lần này, ghi lại mốc mới sau khi build xong',
      );
    } else {
      console.log('▶ kiểm thư mục native còn khớp app.json/plugin không (@expo/fingerprint)');
      await assertNativeFingerprintFresh(appDir, platform);
    }
    const uninstall = uninstallCommand(platform, androidSerial ?? resolvedDeviceName);
    if (uninstall) {
      console.log('▶ gỡ bản cũ trên máy (Android: Release luôn cài sạch, không dính app-data cũ)');
      capture(uninstall.cmd, uninstall.args); // không lỗi nếu app chưa từng cài trên máy
    }
    const stale = staleBundleDirs(platform, appDir);
    if (stale.length > 0) {
      console.log(
        '▶ xoá bundle JS Gradle đã cache (task bundle bỏ qua node_modules → phải ép chạy lại)',
      );
      for (const dir of stale) rmSync(dir, { recursive: true, force: true });
    }
  }
  const runArgs = expoRunArgs(platform, device, release, resolvedDeviceName);
  console.log(`▶ 5/5 npx ${runArgs.join(' ')} (lần đầu prebuild + CocoaPods/Gradle, vài phút)`);
  /** @type {Record<string, string>} */
  let extraEnv = {};
  if (platform === 'android') {
    const sdk = defaultAndroidSdk(process.platform, homedir());
    const jdk = androidStudioJdk(process.platform);
    extraEnv = existsSync(jdk) ? androidEnv(process.env, sdk, jdk) : androidEnv(process.env, sdk);
    if (extraEnv.ANDROID_HOME && !existsSync(sdk)) {
      throw new Error(
        `Không thấy SDK Android ở ${sdk}. Cài Android Studio hoặc đặt ANDROID_HOME trỏ tới SDK.`,
      );
    }
    if (extraEnv.ANDROID_HOME) console.log(`  ANDROID_HOME chưa đặt → dùng ${sdk}`);
    if (extraEnv.JAVA_HOME) console.log('  JAVA_HOME chưa đặt → dùng JDK của Android Studio');
  }
  run('npx', runArgs, { cwd: appDir, env: { ...process.env, ...extraEnv } });
  if (release) {
    // Build vừa thành công → thư mục native (dù mới prebuild hay dùng lại) khớp app.json hiện tại.
    // Ghi mốc để lần release kế tiếp so sánh.
    await recordNativeFingerprint(appDir, platform);
    console.log(
      `✓ Đã cài bản Release lên "${resolvedDeviceName}". Rút dây/tắt Metro: app vẫn chạy độc lập.`,
    );
  }
}
