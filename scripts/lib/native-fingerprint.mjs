import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * `npx expo run:<platform>` (gọi `ensureNativeProjectAsync` trong `@expo/cli`) chỉ prebuild khi
 * thư mục `ios`/`android` CHƯA tồn tại — còn thư mục là dùng nguyên bản cũ, không đồng bộ lại với
 * `app.json`/config plugin/native dependency. `staleBundleDirs` và `uninstallCommand` (xem
 * `example-rn.mjs`) chỉ đảm bảo bundle JS luôn mới; cấu hình NATIVE có thể lệch âm thầm nếu ai đó
 * sửa `app.json` (thêm quyền, đổi plugin) mà quên chạy `npx expo prebuild --clean` — README của
 * app ví dụ có ghi bước này nhưng chỉ dựa vào trí nhớ người vận hành, không có lưới an toàn.
 *
 * Module này thêm lưới an toàn bằng chính cơ chế Expo dùng cho EAS Build local cache:
 * `@expo/fingerprint` (dependency chính thức của gói `expo`, không phải nested tình cờ) tính một
 * hash bao trùm mọi input ảnh hưởng tới thư mục native — app.json, config plugin, native
 * dependency — bỏ qua các thư mục build tạm (`android/build`, `ios/Pods`, …). So hash của lần
 * build gần nhất (lưu trong `.native-fingerprint.<platform>.json`, gitignore) với hash hiện tại;
 * lệch hoặc chưa từng ghi thì CHẶN thay vì âm thầm dùng thư mục có thể đã cũ.
 */

/** @param {string} appDir @param {'ios'|'android'} platform */
export function fingerprintStatePath(appDir, platform) {
  return join(appDir, `.native-fingerprint.${platform}.json`);
}

/** @param {string} path @returns {string | null} */
export function readStoredFingerprint(path) {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return typeof data.hash === 'string' ? data.hash : null;
  } catch {
    return null;
  }
}

/** @param {string} path @param {string} hash */
export function writeStoredFingerprint(path, hash) {
  writeFileSync(
    path,
    `${JSON.stringify({ hash, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

/**
 * Quyết định thuần — không đọc/ghi gì, dễ test không cần chạm `@expo/fingerprint` (chậm, cần I/O
 * thật trên toàn bộ project).
 * @param {{ nativeDirExists: boolean, storedHash: string | null, currentHash: string }} input
 * @returns {{ block: boolean, reason?: string }}
 */
export function nativeDriftDecision({ nativeDirExists, storedHash, currentHash }) {
  if (!nativeDirExists) return { block: false };
  if (storedHash === null) {
    return {
      block: true,
      reason:
        'chưa từng ghi nhận fingerprint cho thư mục native đang có sẵn — không biết nó có khớp cấu hình hiện tại hay không',
    };
  }
  if (storedHash !== currentHash) {
    return {
      block: true,
      reason: 'cấu hình (app.json, plugin, native dependency) đã đổi kể từ lần build gần nhất',
    };
  }
  return { block: false };
}

/**
 * Hash native hiện tại của project qua `@expo/fingerprint` — dependency của chính gói `expo`
 * (`expo/package.json` khai `@expo/fingerprint` trong `dependencies`), nên luôn có sẵn trong
 * `node_modules` của app ví dụ mà không cần thêm devDependency riêng. Đây đúng cơ chế Expo dùng
 * cho EAS Build local cache để quyết định một bản native build còn dùng lại được hay phải build
 * lại — cùng bài toán với việc ta cần quyết định "thư mục native đã lệch config chưa".
 * @param {string} appDir
 * @param {'ios'|'android'} platform
 * @returns {Promise<string>}
 */
export async function computeNativeFingerprint(appDir, platform) {
  const req = createRequire(join(appDir, 'package.json'));
  // `@expo/fingerprint` không phải dependency của repo gốc (chỉ có trong node_modules của app ví
  // dụ, kéo theo bởi `expo`) và chỉ resolve được lúc chạy bên trong appDir; đặt tên biến khác
  // `require` để tsc không cố tình tự phân giải specifier này lúc kiểm kiểu (sẽ báo "Cannot find
  // module" vì đúng là gốc repo không có module này).
  const { createProjectHashAsync } = req('@expo/fingerprint');
  return createProjectHashAsync(appDir, { platforms: [platform], silent: true });
}

/**
 * Chặn build nếu thư mục native có thể đã lệch config. Ghi kèm hash MỚI sau khi chặn (không chỉ
 * lúc thành công): nếu chính lần chặn này khiến người vận hành prebuild lại rồi build tiếp, lần
 * kiểm sau phải so với hash của app.json HIỆN TẠI chứ không phải hash rỗng lặp lại lỗi cũ.
 * @param {string} appDir
 * @param {'ios'|'android'} platform
 * @returns {Promise<void>} ném lỗi nếu chặn
 */
export async function assertNativeFingerprintFresh(appDir, platform) {
  const nativeDirExists = existsSync(join(appDir, platform));
  const path = fingerprintStatePath(appDir, platform);
  const storedHash = readStoredFingerprint(path);
  const currentHash = await computeNativeFingerprint(appDir, platform);
  const decision = nativeDriftDecision({ nativeDirExists, storedHash, currentHash });
  if (decision.block) {
    throw new Error(nativeDriftMessage(platform, /** @type {string} */ (decision.reason)));
  }
}

/**
 * Ghi lại fingerprint sau một lần build+cài THÀNH CÔNG — làm mốc so sánh cho lần sau.
 * @param {string} appDir
 * @param {'ios'|'android'} platform
 */
export async function recordNativeFingerprint(appDir, platform) {
  const hash = await computeNativeFingerprint(appDir, platform);
  writeStoredFingerprint(fingerprintStatePath(appDir, platform), hash);
}

/** @param {'ios'|'android'} platform @param {string} reason */
export function nativeDriftMessage(platform, reason) {
  return `Thư mục "${platform}/" có thể đã LỆCH với app.json/plugin/native dependency: ${reason}.
  1. Nếu CHƯA prebuild lại: chạy \`npx expo prebuild --clean\` trong examples/embed-rn rồi thử lại
     lệnh release như cũ — không xoá code JS, chỉ tái tạo thư mục native từ cấu hình hiện tại.
  2. Nếu ĐÃ prebuild lại rồi mà vẫn thấy lỗi này (mốc cũ chưa từng ghi nhận bản mới): thêm cờ
     \`--accept-native\` vào ĐÚNG một lần chạy tiếp theo, ví dụ
     \`pnpm release:${platform} --accept-native\` — build vẫn chạy đủ như thường, chỉ bỏ qua cổng
     kiểm lần này rồi ghi lại mốc mới khi xong.`;
}
