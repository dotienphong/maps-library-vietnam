import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** @typedef {{ command: string, args: string[], cwd?: string }} ReleaseCommand */

// IMPORTANT: Khi thêm SDK npm mới (Kotlin, Swift hoặc ngôn ngữ khác), thêm thư mục vào đây
// theo dependency order để `pnpm sdk:publish` luôn phát hành toàn bộ SDK.
export const SDK_PACKAGE_DIRS = [
  'packages/core',
  'packages/web',
  'packages/react',
  'packages/react-native',
];

// @mapslibvn/style là package dùng nội bộ hiện chưa nằm trong đợt phát hành SDK npm.
export const NON_SDK_PACKAGE_DIRS = ['packages/style'];

/** @param {string} [rootDir] */
export function discoverPublicPackageDirs(rootDir = process.cwd()) {
  const packagesDir = resolve(rootDir, 'packages');
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`)
    .filter((dir) => {
      const manifest = JSON.parse(readFileSync(resolve(rootDir, dir, 'package.json'), 'utf8'));
      return manifest.private !== true;
    })
    .sort();
}

/** @param {string[]} publicPackageDirs */
export function validateSdkCoverage(publicPackageDirs) {
  const classified = new Set([...SDK_PACKAGE_DIRS, ...NON_SDK_PACKAGE_DIRS]);
  const unclassified = publicPackageDirs.filter((dir) => !classified.has(dir));
  if (unclassified.length > 0) {
    throw new Error(
      `Package public chưa được phân loại: ${unclassified.join(', ')}. Thêm SDK mới vào SDK_PACKAGE_DIRS.`,
    );
  }
  const unavailable = SDK_PACKAGE_DIRS.filter((dir) => !publicPackageDirs.includes(dir));
  if (unavailable.length > 0) {
    throw new Error(`SDK không còn là package public: ${unavailable.join(', ')}`);
  }
}

/**
 * Mỗi subpath dạng object trong `exports` phải có điều kiện `default`.
 *
 * Thiếu nó thì `require('@mapslibvn/core')` trả `ERR_PACKAGE_PATH_NOT_EXPORTED` — kể cả trên Node
 * 22 có `require(esm)` — nên host CommonJS, Jest mặc định và các bundler cũ không nạp được gói.
 * `default` là nhánh cuối cùng mọi resolver đều hiểu, và vì bản build là ESM nên nó trỏ đúng file
 * `import` đang trỏ. Kiểm ở đây để `pnpm sdk:publish` không phát hành lại gói hỏng resolve.
 *
 * @param {string} name tên package, chỉ dùng cho thông báo
 * @param {Record<string, unknown> | undefined} exportsField
 * @returns {string[]}
 */
export function exportsProblemsFor(name, exportsField) {
  if (!exportsField) return [`${name} không khai báo "exports"`];
  /** @type {string[]} */
  const problems = [];
  for (const [subpath, value] of Object.entries(exportsField)) {
    // Subpath dạng chuỗi ("./umd": "./dist/x.umd.js") không có điều kiện nào để thiếu.
    if (typeof value !== 'object' || value === null) continue;
    if (!('default' in value)) problems.push(`${name} "${subpath}" thiếu điều kiện "default"`);
  }
  return problems;
}

/** @param {string} [rootDir] */
export function sdkExportsProblems(rootDir = process.cwd()) {
  return SDK_PACKAGE_DIRS.flatMap((dir) => {
    const manifest = JSON.parse(readFileSync(resolve(rootDir, dir, 'package.json'), 'utf8'));
    return exportsProblemsFor(manifest.name, manifest.exports);
  });
}

/** @param {string} [rootDir] */
export function readSdkPackages(rootDir = process.cwd()) {
  return SDK_PACKAGE_DIRS.map((dir) => {
    const manifest = JSON.parse(readFileSync(resolve(rootDir, dir, 'package.json'), 'utf8'));
    return { dir, name: manifest.name, version: manifest.version, private: manifest.private };
  });
}

/**
 * Gói + version đã có trên npm chưa? `true` có, `false` chưa, **`null` không biết** (registry lỗi,
 * mất mạng) — người gọi phải phân biệt "chưa lên" với "không hỏi được", vì chặn phát hành chỉ vì một
 * sự cố mạng còn tệ hơn.
 *
 * Vì sao cần: `pnpm sdk:publish` publish tuần tự core → web → react → react-native, nhưng KHÔNG kiểm
 * gói trước đã lên thật chưa. Ngày 22/09/2026 hai gói đầu thất bại (mã 2FA hết hạn giữa chừng) còn hai
 * gói sau vẫn lên, và `@mapslibvn/react@0.13.0` nằm trên npm với `dependencies` trỏ
 * `@mapslibvn/core@0.13.0` không tồn tại — ai `npm install` gói đó đều gặp `ETARGET`.
 *
 * "Đã lên" nghĩa là **cài được**: metadata có version VÀ tarball tải được. Từ 23/09/2026 npm xử lý
 * publish bất đồng bộ — lần 0.14.1 metadata có version sau ~2 phút mà tarball còn 404 thêm ~7 phút,
 * `npm install` lúc đó lỗi E404. Mọi lượt hỏi xin `no-cache` vì bản CDN của registry có thể cũ hơn.
 *
 * @param {string} name @param {string} version
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<boolean | null>}
 */
export async function daLenRegistry(name, version, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const headers = { 'cache-control': 'no-cache' };
  const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}`;
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 404) return false;
    if (!response.ok) return null;
    const body = /** @type {{ versions?: Record<string, { dist?: { tarball?: string } }> }} */ (
      await response.json()
    );
    if (!Object.hasOwn(body.versions ?? {}, version)) return false;

    const tarball =
      body.versions?.[version]?.dist?.tarball ??
      `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`;
    const tai = await fetchImpl(tarball, {
      method: 'HEAD',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (tai.status === 404) return false;
    return tai.ok ? true : null;
  } catch {
    return null;
  }
}

/**
 * Chờ tới khi mọi gói cài được từ registry, hỏi lại mỗi `intervalMs`, tối đa `timeoutMs`.
 *
 * Không chờ thì bước tự kiểm sau publish báo "CHƯA lên npm" giả (23/09/2026: cả bốn gói 0.14.1 đã
 * publish đúng mà script báo lỗi) — người phát hành dễ chạy lại lệnh publish và ăn EPUBLISHCONFLICT.
 * Gói đã xác nhận không bị hỏi lại. `null` (không hỏi được) vẫn tiếp tục chờ vì mạng có thể hồi.
 *
 * @param {string[]} names @param {string} version
 * @param {{
 *   kiem?: (name: string, version: string) => Promise<boolean | null>,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   timeoutMs?: number,
 *   intervalMs?: number,
 *   onProgress?: (p: { sanSang: number, tong: number, daChoMs: number }) => void,
 * }} [options]
 * @returns {Promise<{ thieu: string[], khongRo: string[] }>}
 */
export async function choLenRegistry(names, version, options = {}) {
  const kiem = options.kiem ?? daLenRegistry;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const intervalMs = options.intervalMs ?? 30_000;

  const batDau = now();
  let conLai = [...names];
  /** @type {Map<string, boolean | null>} */
  const ketQua = new Map();
  for (;;) {
    for (const name of conLai) ketQua.set(name, await kiem(name, version));
    conLai = conLai.filter((name) => ketQua.get(name) !== true);
    const daChoMs = now() - batDau;
    if (conLai.length === 0 || daChoMs >= timeoutMs) break;
    options.onProgress?.({ sanSang: names.length - conLai.length, tong: names.length, daChoMs });
    await sleep(intervalMs);
  }
  return {
    thieu: conLai.filter((name) => ketQua.get(name) === false),
    khongRo: conLai.filter((name) => ketQua.get(name) === null),
  };
}

/**
 * @param {{ dir: string, name: string, version: string }[]} packages
 * @param {{ dryRun: boolean, noGitChecks?: boolean }} options
 * @returns {ReleaseCommand[]}
 */
export function createSdkPublishCommands(packages, { dryRun, noGitChecks = false }) {
  return packages.map(({ dir }) => {
    const args = ['publish', '--access', 'public', '--publish-branch', 'main'];
    if (noGitChecks) args.push('--no-git-checks');
    if (dryRun) args.push('--dry-run');
    return { command: 'pnpm', args, cwd: dir };
  });
}

/**
 * @param {{ dir: string, name: string, version: string }[]} packages
 * @param {{ dryRun: boolean }} options
 * @returns {ReleaseCommand[]}
 */
export function createSdkReleaseCommands(packages, options) {
  /** @type {ReleaseCommand[]} */
  const gates = ['lint', 'typecheck', 'test', 'build'].map((script) => ({
    command: 'pnpm',
    args: [script],
  }));
  if (options.dryRun) {
    return [...gates, ...createSdkPublishCommands(packages, { dryRun: true, noGitChecks: true })];
  }
  return [
    ...gates,
    ...createSdkPublishCommands(packages, { dryRun: true }),
    ...createSdkPublishCommands(packages, { dryRun: false }),
  ];
}

/** @param {string[]} argv */
export function parseSdkPublishArgs(argv) {
  const unknown = argv.filter((arg) => arg !== '--dry-run');
  if (unknown.length > 0) throw new Error(`Cờ không hỗ trợ: ${unknown.join(', ')}`);
  return { dryRun: argv.includes('--dry-run') };
}

/**
 * @param {{ name: string, version: string, private?: boolean }[]} packages
 * @returns {string}
 */
export function validateSdkPackages(packages) {
  const first = packages[0];
  if (!first) throw new Error('Không có SDK nào để publish');
  if (packages.some(({ name, version }) => !name || !version)) {
    throw new Error('Mọi SDK phải có name và version');
  }
  if (packages.some(({ private: isPrivate }) => isPrivate === true)) {
    throw new Error('SDK trong danh sách publish không được đặt private=true');
  }
  const versions = new Set(packages.map(({ version }) => version));
  if (versions.size !== 1) throw new Error('Mọi SDK phải dùng cùng version trước khi publish');
  return first.version;
}
