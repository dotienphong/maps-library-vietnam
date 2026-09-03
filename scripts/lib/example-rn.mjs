// Hàm thuần cho `pnpm example:rn` (scripts/example-rn.mjs) — app Expo thử độc lập cài SDK bằng tarball.
export const EXAMPLE_RN_DIR = 'examples/embed-rn';
export const KEY_ENV_NAME_RN = 'KEY_EXAMPLE_RN';
export const TARBALL = 'mapslibvn-react-native.tgz';
export const DEFAULT_API = 'https://api.ai-solutions.io.vn';
export const RN_PACKAGE_DIR = 'packages/react-native';

/**
 * @param {string[]} argv
 * @param {string} platform process.platform
 * @returns {{ platform: 'ios' | 'android', packOnly: boolean }}
 */
export function parseArgs(argv, platform) {
  /** @type {'ios' | 'android'} */
  let target = platform === 'darwin' ? 'ios' : 'android';
  let packOnly = false;
  for (const a of argv) {
    if (a === '--ios') target = 'ios';
    else if (a === '--android') target = 'android';
    else if (a === '--pack-only') packOnly = true;
    else if (a === '--key')
      break; // phần còn lại do resolveKey đọc
    else
      throw new Error(
        `Không hiểu tham số ${a}. Dùng: --ios | --android | --pack-only | --key mlv_live_…`,
      );
  }
  return { platform: target, packOnly };
}

/** Tên file `pnpm pack` sinh: bỏ `@`, đổi `/` thành `-`. @param {string} name @param {string} version */
export function packedTarballName(name, version) {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

/** @param {string} key @param {string} api */
export function envFileContent(key, api) {
  return `EXPO_PUBLIC_MAPSLIBVN_KEY=${key}\nEXPO_PUBLIC_MAPSLIBVN_API=${api}\n`;
}

/** @param {'ios' | 'android'} platform */
export function expoRunArgs(platform) {
  return ['expo', `run:${platform}`];
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
