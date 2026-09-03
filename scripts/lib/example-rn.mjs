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
