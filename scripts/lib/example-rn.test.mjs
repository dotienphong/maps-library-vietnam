import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API,
  EXAMPLE_RN_DIR,
  KEY_ENV_NAME_RN,
  TARBALL,
  androidEnv,
  androidStudioJdk,
  defaultAndroidSdk,
  envFileContent,
  expoRunArgs,
  packedTarballName,
  parseArgs,
} from './example-rn.mjs';

describe('parseArgs', () => {
  it('mặc định ios trên macOS, android nơi khác; cờ --android/--ios ghi đè', () => {
    expect(parseArgs([], 'darwin')).toEqual({ platform: 'ios', packOnly: false, device: false });
    expect(parseArgs([], 'linux')).toEqual({ platform: 'android', packOnly: false, device: false });
    expect(parseArgs(['--android'], 'darwin').platform).toBe('android');
    expect(parseArgs(['--ios'], 'linux').platform).toBe('ios');
  });

  it('--pack-only chỉ build/pack/cài; --device chạy máy thật', () => {
    expect(parseArgs(['--pack-only'], 'darwin')).toEqual({
      platform: 'ios',
      packOnly: true,
      device: false,
    });
    expect(parseArgs(['--device', '--android'], 'darwin')).toEqual({
      platform: 'android',
      packOnly: false,
      device: true,
    });
  });

  it('cờ lạ → lỗi', () => {
    expect(() => parseArgs(['--web'], 'darwin')).toThrow(/--web/);
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

  it('expoRunArgs', () => {
    expect(expoRunArgs('ios')).toEqual(['expo', 'run:ios']);
    expect(expoRunArgs('android')).toEqual(['expo', 'run:android']);
    expect(expoRunArgs('ios', true)).toEqual(['expo', 'run:ios', '--device']);
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
