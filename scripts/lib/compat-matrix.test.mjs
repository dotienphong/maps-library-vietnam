import { describe, expect, it } from 'vitest';
import {
  RN_MATRIX,
  appPackageJson,
  classifyFailure,
  comboId,
  formatMatrixTable,
} from './compat-matrix.mjs';

describe('RN_MATRIX', () => {
  it('có ô React 18 và ô RN 0.79 — hai ô C1 cần trả lời', () => {
    expect(RN_MATRIX.some((c) => c.react.startsWith('18.'))).toBe(true);
    expect(RN_MATRIX.some((c) => c.reactNative.startsWith('0.79'))).toBe(true);
  });

  it('mỗi ô có đủ bốn trường', () => {
    for (const c of RN_MATRIX) {
      expect(typeof c.react).toBe('string');
      expect(typeof c.reactNative).toBe('string');
      expect(typeof c.expo).toBe('string');
      expect(typeof c.newArch).toBe('boolean');
    }
  });
});

describe('comboId', () => {
  it('id ổn định, dùng được làm tên thư mục', () => {
    const id = comboId({ react: '18.3.1', reactNative: '0.79.0', expo: '53.0.0', newArch: false });
    expect(id).toBe('react18.3.1-rn0.79.0-expo53.0.0-oldarch');
    expect(id).not.toMatch(/[^a-z0-9.-]/);
  });

  it('phân biệt kiến trúc mới và cũ', () => {
    const on = comboId({ react: '19.2.3', reactNative: '0.86.3', expo: '57.0.0', newArch: true });
    expect(on.endsWith('-newarch')).toBe(true);
  });
});

describe('appPackageJson', () => {
  it('ghim đúng phiên bản của ô và trỏ SDK vào tarball', () => {
    const pkg = appPackageJson(
      { react: '18.3.1', reactNative: '0.79.0', expo: '53.0.0', newArch: false },
      'vendor/mapslibvn-react-native.tgz',
    );
    expect(pkg.dependencies.react).toBe('18.3.1');
    expect(pkg.dependencies['react-native']).toBe('0.79.0');
    expect(pkg.dependencies.expo).toBe('53.0.0');
    expect(pkg.dependencies['@mapslibvn/react-native']).toBe(
      'file:vendor/mapslibvn-react-native.tgz',
    );
    expect(pkg.private).toBe(true);
  });
});

describe('classifyFailure', () => {
  it('nhận ra xung đột peer dependency', () => {
    expect(classifyFailure('npm error ERESOLVE unable to resolve dependency tree')).toBe('peer');
  });

  it('nhận ra lỗi Metro', () => {
    expect(classifyFailure('error: Unable to resolve module ./foo from bar')).toBe('metro');
  });

  it('nhận ra lỗi build native', () => {
    expect(classifyFailure('FAILURE: Build failed with an exception.')).toBe('build');
  });

  it('ưu tiên build hơn metro khi cả hai có mặt', () => {
    const gradleLog = `> Task :app:createBundleReleaseJsAndAssets
node_modules/metro/src/lib/x.js

FAILURE: Build failed with an exception.
> Compilation error`;
    expect(classifyFailure(gradleLog)).toBe('build');
  });

  it('không khớp gì thì trả khác', () => {
    expect(classifyFailure('cái gì đó lạ')).toBe('khác');
  });
});

describe('formatMatrixTable', () => {
  it('đánh dấu ĐẠT và HỎNG kèm loại lỗi', () => {
    const md = formatMatrixTable([
      {
        combo: { react: '19.2.3', reactNative: '0.86.3', expo: '57.0.0', newArch: true },
        ok: true,
        failure: null,
      },
      {
        combo: { react: '18.3.1', reactNative: '0.79.0', expo: '53.0.0', newArch: false },
        ok: false,
        failure: 'peer',
      },
    ]);
    expect(md).toContain('ĐẠT');
    expect(md).toContain('HỎNG');
    expect(md).toContain('peer');
  });
});
