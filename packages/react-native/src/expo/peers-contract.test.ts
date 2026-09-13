import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `src/expo/modules.ts` là chỗ DUY NHẤT import Expo, và nó import TĨNH. Vì vậy mỗi gói ở đó là
 * bắt buộc trên thực tế đối với app chủ nào dùng `@mapslibvn/react-native/expo`: thiếu một gói là
 * Metro không resolve được, tức là vỡ lúc đóng gói chứ không phải mất một tính năng.
 *
 * Bẫy đã dính 13/09/2026: `expo-keep-awake` được import ở đây nhưng KHÔNG có trong lệnh cài của
 * README lẫn app ví dụ. App ví dụ vẫn chạy vì `expo` kéo theo một bản lồng trong node_modules của
 * nó — một chỗ dựa mong manh mà app chủ không nhất thiết có. Test này khoá cả ba danh sách lại với
 * nhau để lần sau thêm gói Expo mới không thể quên.
 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const importedExpoModules = (): string[] => {
  const source = read('./modules.ts');
  return [...source.matchAll(/from '(expo-[a-z-]+)'/g)].map((m) => m[1] as string).sort();
};

describe('hợp đồng peer dependency của entry /expo', () => {
  const imported = importedExpoModules();

  it('modules.ts thật sự import các gói Expo (test không tự vô hiệu)', () => {
    expect(imported.length).toBeGreaterThanOrEqual(6);
  });

  it('mọi gói được import đều khai là peerDependency', () => {
    const manifest = JSON.parse(read('../../package.json'));
    const peers = Object.keys(manifest.peerDependencies ?? {});
    expect(imported.filter((name) => !peers.includes(name))).toEqual([]);
  });

  it('lệnh cài trong README liệt kê đủ mọi gói được import', () => {
    const readme = read('../../README.md');
    const installLines = readme.split('\n').filter((line) => line.includes('expo install expo-'));
    expect(installLines.length).toBeGreaterThan(0);
    for (const line of installLines) {
      expect(imported.filter((name) => !line.includes(name))).toEqual([]);
    }
  });

  it('app ví dụ embed-rn khai đủ mọi gói được import', () => {
    const manifest = JSON.parse(read('../../../../examples/embed-rn/package.json'));
    const deps = Object.keys(manifest.dependencies ?? {});
    expect(imported.filter((name) => !deps.includes(name))).toEqual([]);
  });
});
