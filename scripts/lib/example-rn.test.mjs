import { describe, expect, it } from 'vitest';
import {
  androidDeviceArg,
  androidEnv,
  androidStudioJdk,
  availableIosDevices,
  BUNDLE_ID,
  DEFAULT_API,
  defaultAndroidSdk,
  EXAMPLE_RN_DIR,
  envFileContent,
  expoRunArgs,
  findIosDevice,
  KEY_ENV_NAME_RN,
  packedTarballName,
  parseAdbDevices,
  parseArgs,
  parseDevicectlDevices,
  pickSingleDevice,
  staleBundleDirs,
  TARBALL,
  uninstallCommand,
} from './example-rn.mjs';

describe('parseArgs', () => {
  it('mặc định ios trên macOS, android nơi khác; cờ --android/--ios ghi đè', () => {
    expect(parseArgs([], 'darwin')).toEqual({
      platform: 'ios',
      packOnly: false,
      device: false,
      release: false,
    });
    expect(parseArgs([], 'linux')).toEqual({
      platform: 'android',
      packOnly: false,
      device: false,
      release: false,
    });
    expect(parseArgs(['--android'], 'darwin').platform).toBe('android');
    expect(parseArgs(['--ios'], 'linux').platform).toBe('ios');
  });

  it('--pack-only chỉ build/pack/cài; --device chạy máy thật', () => {
    expect(parseArgs(['--pack-only'], 'darwin')).toEqual({
      platform: 'ios',
      packOnly: true,
      device: false,
      release: false,
    });
    expect(parseArgs(['--device', '--android'], 'darwin')).toEqual({
      platform: 'android',
      packOnly: false,
      device: true,
      release: false,
    });
  });

  it('--release kéo theo device=true; --device-name đọc giá trị đứng sau', () => {
    expect(parseArgs(['--ios', '--release'], 'darwin')).toEqual({
      platform: 'ios',
      packOnly: false,
      device: true,
      release: true,
    });
    expect(parseArgs(['--android', '--release', '--device-name', 'Pixel 7'], 'darwin')).toEqual({
      platform: 'android',
      packOnly: false,
      device: true,
      release: true,
      deviceName: 'Pixel 7',
    });
  });

  it('bỏ qua dấu `--` đứng đơn lẻ (pnpm release:ios -- --device-name … chuyển tiếp cả dấu này)', () => {
    expect(parseArgs(['--', '--release', '--device-name', 'Pixel 7'], 'darwin')).toEqual({
      platform: 'ios',
      packOnly: false,
      device: true,
      release: true,
      deviceName: 'Pixel 7',
    });
  });

  it('cờ lạ → lỗi', () => {
    expect(() => parseArgs(['--web'], 'darwin')).toThrow(/--web/);
  });

  /**
   * Sau `npx expo prebuild --clean`, `assertNativeFingerprintFresh` (lib/native-fingerprint.mjs)
   * vẫn chặn vì mốc cũ chưa được cập nhật — mà mốc chỉ cập nhật sau một lần release THÀNH CÔNG,
   * và lần release đó lại bị chính cổng kiểm chặn ngay từ đầu (kẹt vòng, phát hiện 14/09/2026 khi
   * người dùng thật gặp phải). `--accept-native` là lối thoát tường minh: bỏ qua đúng một lần kiểm
   * này, KHÔNG bỏ qua gì khác (build/uninstall/bundle vẫn chạy đủ như thường).
   */
  it('--accept-native bỏ qua cổng kiểm fingerprint đúng một lần', () => {
    expect(parseArgs(['--ios', '--release', '--accept-native'], 'darwin')).toEqual({
      platform: 'ios',
      packOnly: false,
      device: true,
      release: true,
      acceptNative: true,
    });
    // Mặc định false — không xuất hiện trong object (khớp quy ước deviceName ở trên).
    expect(parseArgs(['--ios', '--release'], 'darwin')).not.toHaveProperty('acceptNative');
  });
});

describe('hằng số và chuỗi sinh', () => {
  it('đường dẫn, tên biến, tarball, API mặc định', () => {
    expect(EXAMPLE_RN_DIR).toBe('examples/embed-rn');
    expect(KEY_ENV_NAME_RN).toBe('KEY_EXAMPLE_RN');
    expect(TARBALL).toBe('mapslibvn-react-native.tgz');
    expect(DEFAULT_API).toBe('https://api.ai-solutions.io.vn');
  });

  it('packedTarballName theo quy ước pnpm pack (bỏ @, / → -)', () => {
    expect(packedTarballName('@mapslibvn/react-native', '0.1.0')).toBe(
      'mapslibvn-react-native-0.1.0.tgz',
    );
  });

  it('envFileContent ghi hai biến EXPO_PUBLIC_*', () => {
    expect(envFileContent('mlv_live_x', 'https://api.test')).toBe(
      'EXPO_PUBLIC_MAPSLIBVN_KEY=mlv_live_x\nEXPO_PUBLIC_MAPSLIBVN_API=https://api.test\n',
    );
  });

  it('expoRunArgs: mặc định, --device trần, và --release (kèm --no-bundler) cho từng nền tảng', () => {
    expect(expoRunArgs('ios')).toEqual(['expo', 'run:ios']);
    expect(expoRunArgs('android')).toEqual(['expo', 'run:android']);
    expect(expoRunArgs('ios', true)).toEqual(['expo', 'run:ios', '--device']);
    expect(expoRunArgs('ios', true, true, 'iPhone của Phong')).toEqual([
      'expo',
      'run:ios',
      '--device',
      'iPhone của Phong',
      '--configuration',
      'Release',
      '--no-bundler',
    ]);
    expect(expoRunArgs('android', true, true, 'emulator-5554')).toEqual([
      'expo',
      'run:android',
      '--device',
      'emulator-5554',
      '--variant',
      'release',
      '--no-bundler',
    ]);
  });
});

describe('chọn thiết bị thật cho --release', () => {
  // Định dạng thật của `xcrun devicectl list devices` (xác nhận thực địa 13/09/2026).
  const devicectlOutput = [
    'Name               Hostname                            Identifier                             State                Model                         ',
    '----------------   ---------------------------------   ------------------------------------   ------------------   ------------------------------',
    'TranTran💕          TranTran.coredevice.local           59749ACD-033F-5DE4-B0AF-B3AC7C1939E5   available (paired)   iPhone 14 Pro Max (iPhone15,3)',
    'iPhone của Phong   iPhone-cua-Phong.coredevice.local   600EE67B-0B24-5249-BDFC-DAA46353D9AC   available (paired)   iPhone 14 Plus (iPhone14,8)',
  ].join('\n');

  it('parseDevicectlDevices tách đúng cột dù tên có emoji/khoảng trắng đơn', () => {
    const devices = parseDevicectlDevices(devicectlOutput);
    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual({
      name: 'TranTran💕',
      hostname: 'TranTran.coredevice.local',
      identifier: '59749ACD-033F-5DE4-B0AF-B3AC7C1939E5',
      state: 'available (paired)',
      model: 'iPhone 14 Pro Max (iPhone15,3)',
    });
    expect(devices[1]?.name).toBe('iPhone của Phong');
    expect(devices[1]?.model).toBe('iPhone 14 Plus (iPhone14,8)');
  });

  it('availableIosDevices chỉ giữ máy "available"; bỏ máy ghép nối nhưng vắng mặt', () => {
    const devices = parseDevicectlDevices(devicectlOutput);
    expect(availableIosDevices(devices).map((d) => d.name)).toEqual([
      'TranTran💕',
      'iPhone của Phong',
    ]);
    const oneAbsent = devicectlOutput.replace('available (paired)', 'unavailable (paired)  ');
    expect(availableIosDevices(parseDevicectlDevices(oneAbsent)).map((d) => d.name)).toEqual([
      'iPhone của Phong',
    ]);
  });

  // Định dạng thật của `adb devices -l` (xác nhận thực địa 13/09/2026 trên máy MI_9 — Expo CLI
  // (`expo run:android --device <tên>`) chỉ khớp theo `model:`, KHÔNG khớp theo serial cột đầu).
  const adbDevicesLOutput = [
    'List of devices attached',
    'bab02fbc               device usb:1048576X product:cepheus model:MI_9 device:cepheus transport_id:12',
    'FA8251A00719           unauthorized usb:338690048X transport_id:5',
    'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:6',
    '',
  ].join('\n');

  it('parseAdbDevices lấy {serial, model} từ `adb devices -l`; bỏ dòng tiêu đề, unauthorized, emulator ảo', () => {
    expect(parseAdbDevices(adbDevicesLOutput)).toEqual([{ serial: 'bab02fbc', model: 'MI_9' }]);
  });

  it('pickSingleDevice: đúng một máy → trả tên; 0 hoặc ≥2 → lỗi liệt kê tên để dùng --device-name', () => {
    expect(pickSingleDevice(['iPhone của Phong'], 'iOS')).toBe('iPhone của Phong');
    expect(() => pickSingleDevice([], 'iOS')).toThrow(/Không thấy thiết bị iOS/);
    expect(() => pickSingleDevice(['A', 'B'], 'Android')).toThrow(/--device-name/);
    expect(() => pickSingleDevice(['A', 'B'], 'Android')).toThrow(/"A", "B"/);
  });

  describe('androidDeviceArg — dịch serial (--device-name) sang model để khớp `expo run:android --device`', () => {
    const devices = [
      { serial: 'bab02fbc', model: 'MI_9' },
      { serial: 'HT99AB123', model: 'Pixel_7' },
    ];

    it('trả về model của đúng serial được chỉ định', () => {
      expect(androidDeviceArg(devices, 'bab02fbc')).toBe('MI_9');
      expect(androidDeviceArg(devices, 'HT99AB123')).toBe('Pixel_7');
    });

    it('serial không có trong danh sách đang cắm → lỗi rõ ràng thay vì âm thầm chuyển tiếp', () => {
      expect(() => androidDeviceArg(devices, 'khong-ton-tai')).toThrow(/khong-ton-tai/);
    });
  });
});

describe('SDK Android', () => {
  it('defaultAndroidSdk theo hệ điều hành', () => {
    expect(defaultAndroidSdk('darwin', '/Users/x')).toBe('/Users/x/Library/Android/sdk');
    expect(defaultAndroidSdk('linux', '/home/x')).toBe('/home/x/Android/Sdk');
    expect(defaultAndroidSdk('win32', 'C:\\Users\\x')).toBe(
      'C:\\Users\\x\\AppData\\Local\\Android\\Sdk',
    );
  });

  it('androidEnv chỉ bù ANDROID_HOME khi env chưa có biến nào', () => {
    expect(androidEnv({}, '/sdk')).toEqual({ ANDROID_HOME: '/sdk' });
    expect(androidEnv({ ANDROID_HOME: '/co-san' }, '/sdk')).toEqual({});
    expect(androidEnv({ ANDROID_SDK_ROOT: '/co-san' }, '/sdk')).toEqual({});
  });

  it('androidStudioJdk theo hệ điều hành', () => {
    expect(androidStudioJdk('darwin')).toBe(
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    );
    expect(androidStudioJdk('linux')).toBe('/opt/android-studio/jbr');
    expect(androidStudioJdk('win32')).toBe('C:\\Program Files\\Android\\Android Studio\\jbr');
  });

  it('androidEnv bù JAVA_HOME khi có JDK và env chưa đặt', () => {
    expect(androidEnv({}, '/sdk', '/jbr')).toEqual({ ANDROID_HOME: '/sdk', JAVA_HOME: '/jbr' });
    expect(androidEnv({ JAVA_HOME: '/co-san' }, '/sdk', '/jbr')).toEqual({ ANDROID_HOME: '/sdk' });
  });
});

describe('uninstallCommand — gỡ bản cũ trước khi cài Release', () => {
  // Cài đè (install lại) giữ nguyên app-data, gồm cache ambient của MapLibre Native (style/tile đã
  // tải, độc lập APK/IPA) — release sẽ tiếp tục hiện dữ liệu cache cũ dù bundle JS mới đã đúng. Gỡ
  // hẳn trước khi cài là cách duy nhất chắc chắn sạch (quyết định PHONG 13/09/2026).
  it('android: adb uninstall theo serial', () => {
    expect(uninstallCommand('android', 'bab02fbc')).toEqual({
      cmd: 'adb',
      args: ['-s', 'bab02fbc', 'uninstall', BUNDLE_ID],
    });
  });

  it('ios: KHÔNG gỡ (null) — xoá app cuối của Apple ID cá nhân làm iPhone quên tin developer, lần cài kế bị từ chối mở (gặp thật 13/09/2026)', () => {
    expect(uninstallCommand('ios', 'iPhone của Phong')).toBeNull();
  });
});

describe('staleBundleDirs — output của task bundle Gradle phải xoá trước khi build Release', () => {
  // Sự cố thật 13/09/2026: react-native-gradle-plugin loại `**/node_modules/**` khỏi input của
  // createBundleReleaseJsAndAssets, nên cài SDK mới bằng npm install không làm task chạy lại →
  // APK đóng gói bundle JS cũ (mtime 01:17, trước commit gỡ Overture) dù build "thành công".
  it('android: hai thư mục output (assets + res) của biến thể release', () => {
    expect(staleBundleDirs('android', '/repo/examples/embed-rn')).toEqual([
      '/repo/examples/embed-rn/android/app/build/generated/assets/react/release',
      '/repo/examples/embed-rn/android/app/build/generated/res/react/release',
    ]);
  });

  it('ios: không có cache tương đương (script phase Xcode chạy mỗi lần) → rỗng', () => {
    expect(staleBundleDirs('ios', '/repo/examples/embed-rn')).toEqual([]);
  });
});

describe('findIosDevice', () => {
  const devices = [
    { name: 'iPhone của Phong', identifier: '600EE67B-0B24-5249-BDFC-DAA46353D9AC' },
    { name: 'TranTran💕', identifier: '59749ACD-033F-5DE4-B0AF-B3AC7C1939E5' },
  ];

  // Lượt hâm nóng hồ sơ ký (xem lib/ios-provisioning.mjs) gọi thẳng `xcodebuild -destination
  // id=<…>`, mà `--device-name` người dùng gõ lại là TÊN máy — phải tra ngược ra identifier.
  it('tra theo tên → trả identifier để truyền cho xcodebuild', () => {
    expect(findIosDevice(devices, 'iPhone của Phong').identifier).toBe(
      '600EE67B-0B24-5249-BDFC-DAA46353D9AC',
    );
  });

  it('tra theo identifier cũng được — `expo run:ios --device` nhận cả UDID, không chỉ tên', () => {
    expect(findIosDevice(devices, '59749ACD-033F-5DE4-B0AF-B3AC7C1939E5').name).toBe('TranTran💕');
  });

  it('gõ sai tên → lỗi liệt kê tên đang có, không để rơi xuống lỗi khó hiểu của xcodebuild', () => {
    expect(() => findIosDevice(devices, 'iPhone cua Phong')).toThrow(/iPhone cua Phong/);
    expect(() => findIosDevice(devices, 'iPhone cua Phong')).toThrow(/"iPhone của Phong"/);
  });
});
