#!/usr/bin/env node
// Mở app Expo thử độc lập bằng một lệnh (nghiệm thu M6, spec M6 mục 5.3):
//   pnpm example:rn            (iOS trên macOS, Android nơi khác; khoá từ KEY_EXAMPLE_RN trong .env)
//   pnpm example:rn --android
//   pnpm example:rn --pack-only        (chỉ build + pack + cài, không chạy)
//   pnpm example:rn --device           (máy thật đang cắm USB; iOS cần ký bằng Apple ID trong Xcode)
//   pnpm example:rn --android --key mlv_live_…   (ghi đè tạm; --key phải đứng CUỐI)
// Các bước: build core + react-native → pnpm pack vào examples/embed-rn/vendor → ghi .env của app
// → npm install tarball → npx expo run:<platform>. Khoá KHÔNG nằm trong repo. Ctrl+C để dừng.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import 'dotenv/config';
import {
  DEFAULT_API,
  EXAMPLE_RN_DIR,
  KEY_ENV_NAME_RN,
  RN_PACKAGE_DIR,
  TARBALL,
  androidEnv,
  androidStudioJdk,
  defaultAndroidSdk,
  envFileContent,
  expoRunArgs,
  packedTarballName,
  parseArgs,
} from './lib/example-rn.mjs';
import { resolveKey } from './lib/example-serve.mjs';
import { run } from './lib/run.mjs';

const argv = process.argv.slice(2);
const { platform, packOnly, device } = parseArgs(argv, process.platform);
const key = resolveKey(argv, process.env, { envName: KEY_ENV_NAME_RN, hint: 'pnpm example:rn' });
const api = process.env.EXAMPLE_RN_API ?? DEFAULT_API;

const appDir = resolve(EXAMPLE_RN_DIR);
if (!existsSync(join(appDir, 'package.json'))) {
  throw new Error(`Không thấy ${EXAMPLE_RN_DIR}/package.json — chạy từ gốc repo`);
}

console.log('▶ 1/5 build @mapslibvn/core + @mapslibvn/react-native');
run('pnpm', ['--filter', '@mapslibvn/core', '--filter', '@mapslibvn/react-native', 'build']);

console.log('▶ 2/5 pnpm pack → vendor/');
const vendor = join(appDir, 'vendor');
mkdirSync(vendor, { recursive: true });
// `pnpm pack` không nhận `--filter` (pnpm hiểu thành `--recursive`) → chạy trong thư mục gói.
run('pnpm', ['pack', '--pack-destination', vendor], { cwd: resolve(RN_PACKAGE_DIR) });
const pkg = JSON.parse(readFileSync(join(RN_PACKAGE_DIR, 'package.json'), 'utf8'));
renameSync(join(vendor, packedTarballName(pkg.name, pkg.version)), join(vendor, TARBALL));

console.log('▶ 3/5 ghi examples/embed-rn/.env (không commit)');
writeFileSync(join(appDir, '.env'), envFileContent(key, api));

console.log('▶ 4/5 npm install tarball (cài lại mỗi lần để không dính bản cũ)');
run('npm', ['install', '--no-audit', '--no-fund', `./vendor/${TARBALL}`], { cwd: appDir });

if (packOnly) {
  console.log('✓ --pack-only: xong. Chạy tay: cd examples/embed-rn && npx expo run:ios');
} else {
  console.log(
    `▶ 5/5 npx expo run:${platform}${device ? ' --device' : ''} (lần đầu prebuild + CocoaPods/Gradle, vài phút)`,
  );
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
  run('npx', expoRunArgs(platform, device), { cwd: appDir, env: { ...process.env, ...extraEnv } });
}
