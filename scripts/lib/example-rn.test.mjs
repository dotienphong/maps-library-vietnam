import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API,
  EXAMPLE_RN_DIR,
  KEY_ENV_NAME_RN,
  TARBALL,
  envFileContent,
  expoRunArgs,
  packedTarballName,
  parseArgs,
} from './example-rn.mjs';

describe('parseArgs', () => {
  it('mặc định ios trên macOS, android nơi khác; cờ --android/--ios ghi đè', () => {
    expect(parseArgs([], 'darwin')).toEqual({ platform: 'ios', packOnly: false });
    expect(parseArgs([], 'linux')).toEqual({ platform: 'android', packOnly: false });
    expect(parseArgs(['--android'], 'darwin').platform).toBe('android');
    expect(parseArgs(['--ios'], 'linux').platform).toBe('ios');
  });

  it('--pack-only chỉ build/pack/cài', () => {
    expect(parseArgs(['--pack-only'], 'darwin')).toEqual({ platform: 'ios', packOnly: true });
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
  });
});
