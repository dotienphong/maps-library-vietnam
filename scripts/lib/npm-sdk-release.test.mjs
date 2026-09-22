import { describe, expect, it, vi } from 'vitest';
import {
  createSdkPublishCommands,
  createSdkReleaseCommands,
  daLenRegistry,
  discoverPublicPackageDirs,
  exportsProblemsFor,
  parseSdkPublishArgs,
  sdkExportsProblems,
  validateSdkCoverage,
  validateSdkPackages,
} from './npm-sdk-release.mjs';

const manifests = [
  { dir: 'packages/core', name: '@mapslibvn/core', version: '0.4.0' },
  { dir: 'packages/web', name: '@mapslibvn/web', version: '0.4.0' },
  { dir: 'packages/react', name: '@mapslibvn/react', version: '0.4.0' },
  { dir: 'packages/react-native', name: '@mapslibvn/react-native', version: '0.4.0' },
];

describe('npm SDK release', () => {
  it('publish bốn SDK theo dependency order và luôn dùng public access trên main', () => {
    expect(createSdkPublishCommands(manifests, { dryRun: false })).toEqual([
      {
        command: 'pnpm',
        args: ['publish', '--access', 'public', '--publish-branch', 'main'],
        cwd: 'packages/core',
      },
      {
        command: 'pnpm',
        args: ['publish', '--access', 'public', '--publish-branch', 'main'],
        cwd: 'packages/web',
      },
      {
        command: 'pnpm',
        args: ['publish', '--access', 'public', '--publish-branch', 'main'],
        cwd: 'packages/react',
      },
      {
        command: 'pnpm',
        args: ['publish', '--access', 'public', '--publish-branch', 'main'],
        cwd: 'packages/react-native',
      },
    ]);
  });

  it('dry-run truyền cờ tới cả bốn lệnh publish', () => {
    const commands = createSdkPublishCommands(manifests, { dryRun: true });

    expect(commands).toHaveLength(4);
    expect(commands.every(({ args }) => args.at(-1) === '--dry-run')).toBe(true);
  });

  it('release thật chạy đủ gate và dry-run mọi SDK trước lần publish đầu tiên', () => {
    const commands = createSdkReleaseCommands(manifests, { dryRun: false });

    expect(commands.slice(0, 4)).toEqual([
      { command: 'pnpm', args: ['lint'] },
      { command: 'pnpm', args: ['typecheck'] },
      { command: 'pnpm', args: ['test'] },
      { command: 'pnpm', args: ['build'] },
    ]);
    expect(commands).toHaveLength(12);
    expect(commands.slice(4).map(({ cwd }) => cwd)).toEqual([
      'packages/core',
      'packages/web',
      'packages/react',
      'packages/react-native',
      'packages/core',
      'packages/web',
      'packages/react',
      'packages/react-native',
    ]);
    expect(commands.slice(4, 8).every(({ args }) => args.at(-1) === '--dry-run')).toBe(true);
    expect(commands.slice(8).every(({ args }) => !args.includes('--dry-run'))).toBe(true);
  });

  it('dry-run tổng cho phép kiểm tra tarball khi working tree đang có thay đổi', () => {
    const commands = createSdkReleaseCommands(manifests, { dryRun: true });

    expect(commands).toHaveLength(8);
    expect(commands.slice(4).map(({ cwd }) => cwd)).toEqual(manifests.map(({ dir }) => dir));
    expect(commands.slice(4).every(({ args }) => args.includes('--dry-run'))).toBe(true);
    expect(commands.slice(4).every(({ args }) => args.includes('--no-git-checks'))).toBe(true);
  });

  it('chặn release khi có package public mới chưa được thêm vào lệnh tổng', () => {
    expect(() =>
      validateSdkCoverage([
        'packages/core',
        'packages/web',
        'packages/react',
        'packages/react-native',
        'packages/style',
        'packages/kotlin',
      ]),
    ).toThrow(/packages\/kotlin.*SDK_PACKAGE_DIRS/);
  });

  it('mọi package public hiện tại đều được phân loại là SDK hoặc ngoại lệ', () => {
    expect(() => validateSdkCoverage(discoverPublicPackageDirs())).not.toThrow();
  });

  it('chặn release nếu bốn SDK không dùng cùng một version', () => {
    expect(() =>
      validateSdkPackages([
        ...manifests.slice(0, 3),
        {
          dir: 'packages/react-native',
          name: '@mapslibvn/react-native',
          version: '0.5.0',
        },
      ]),
    ).toThrow(/cùng version/);
  });

  it('trả về version chung sau khi validate thành công', () => {
    expect(validateSdkPackages(manifests)).toBe('0.4.0');
  });

  it('chỉ nhận cờ --dry-run để tránh bỏ qua nhầm cơ chế an toàn', () => {
    expect(parseSdkPublishArgs([])).toEqual({ dryRun: false });
    expect(parseSdkPublishArgs(['--dry-run'])).toEqual({ dryRun: true });
    expect(() => parseSdkPublishArgs(['--force'])).toThrow(/--force/);
  });

  it('mọi subpath exports của bốn SDK đều có điều kiện "default"', () => {
    expect(sdkExportsProblems()).toEqual([]);
  });

  it('phát hiện subpath thiếu "default"', () => {
    expect(
      exportsProblemsFor('@mapslibvn/x', {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      }),
    ).toEqual(['@mapslibvn/x "." thiếu điều kiện "default"']);
    expect(
      exportsProblemsFor('@mapslibvn/x', {
        '.': { types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js' },
        './umd': './dist/x.umd.js',
      }),
    ).toEqual([]);
  });
});

describe('daLenRegistry', () => {
  /** @param {Record<string, unknown>} body @param {number} [status] */
  const fetchGia = (body, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('đúng version trong registry → true', async () => {
    const fetchImpl = fetchGia({ versions: { '0.12.1': {}, '0.13.0': {} } });
    expect(await daLenRegistry('@mapslibvn/core', '0.13.0', { fetchImpl })).toBe(true);
  });

  it('chưa có version đó → false (gói phụ thuộc chưa lên, không được publish gói sau)', async () => {
    const fetchImpl = fetchGia({ versions: { '0.12.1': {} } });
    expect(await daLenRegistry('@mapslibvn/core', '0.13.0', { fetchImpl })).toBe(false);
  });

  it('404 (gói mới hoàn toàn) → false, không ném', async () => {
    expect(await daLenRegistry('@mapslibvn/moi', '0.1.0', { fetchImpl: fetchGia({}, 404) })).toBe(
      false,
    );
  });

  it('registry lỗi hoặc mất mạng → null: KHÔNG chặn publish vì một sự cố mạng', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await daLenRegistry('@mapslibvn/core', '0.13.0', { fetchImpl: boom })).toBeNull();
    expect(
      await daLenRegistry('@mapslibvn/core', '0.13.0', { fetchImpl: fetchGia({}, 500) }),
    ).toBeNull();
  });
});
