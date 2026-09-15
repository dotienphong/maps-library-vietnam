#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { formatSizeTable } from './lib/perf-size.mjs';

/** Các file SDK đo mỗi lần. Đường dẫn tương đối gốc repo. */
const TARGETS = [
  'packages/core/dist/index.js',
  'packages/web/dist/index.js',
  'packages/web/dist/mapslibvn.umd.js',
  'packages/web/dist/mapslibvn.css',
  'packages/react/dist/index.js',
  'packages/react-native/dist/index.js',
  'packages/react-native/dist/expo/index.js',
];

const RN_DIST_ROOT = 'packages/react-native/dist';

/**
 * tsup tách code dùng chung giữa 2 entry của react-native ra chunk riêng (cùng lý do Task 1 phải
 * đo size-limit theo mảng path, xem packages/react-native/.size-limit.json). Không hardcode tên
 * chunk vì hash đổi mỗi lần nội dung đổi — luôn dò lại bằng readdirSync.
 * An toàn (không throw) khi RN_DIST_ROOT chưa tồn tại CHỈ VÌ `main()` đã kiểm đủ file trong
 * TARGETS trước khi gọi `measure()` — nếu gọi thẳng hàm này (hoặc `measure()`) mà bỏ qua bước
 * kiểm đó, readdirSync sẽ throw ENOENT. Đừng phá thứ tự "kiểm rồi mới đo" khi sửa sau này.
 * @param {string} entryPath
 * @returns {string[]} đường dẫn các file chunk dùng chung, rỗng nếu path không thuộc react-native
 */
function siblingChunks(entryPath) {
  if (!entryPath.startsWith(`${RN_DIST_ROOT}/`)) return [];
  return readdirSync(RN_DIST_ROOT)
    .filter((f) => /^chunk-.*\.js$/.test(f))
    .map((f) => join(RN_DIST_ROOT, f));
}

/**
 * gzip TỪNG file rồi cộng (không phải gzip phần nối chuỗi) — khớp cách cộng dồn mảng path của
 * gói size-limit/file, không khớp con số tuyệt đối: mức nén (gzipSync mặc định level 6,
 * size-limit dùng level 9) và đơn vị kB (formatKb ở đây chia 1024, size-limit chia 1000) cố ý
 * khác nhau, nên số lệch ~2% so với size-limit là bình thường, không phải bug.
 * @param {string} path
 * @returns {{ name: string, bytes: number, gzipBytes: number }}
 */
function measure(path) {
  const chunks = siblingChunks(path);
  const files = [path, ...chunks];
  const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
  const gzipBytes = files.reduce((sum, f) => sum + gzipSync(readFileSync(f)).length, 0);
  const name = chunks.length > 0 ? `${path} (+ chunk dùng chung)` : path;
  return { name, bytes, gzipBytes };
}

/**
 * Bundle Metro của app thử và APK Release nếu đã dựng. Cả hai đều tuỳ chọn: máy chưa dựng app
 * thì bỏ qua, không coi là lỗi — người chạy chỉ muốn xem kích thước SDK là chuyện thường.
 * Lưu ý: cột gzip của dòng APK gần như vô nghĩa — APK vốn đã là file zip (đã nén), gzip nén lại
 * lên trên gần như không co thêm được bao nhiêu; cột đó chỉ có giá trị tham khảo cho dòng bundle.
 * @returns {{ name: string, bytes: number, gzipBytes: number }[]}
 */
function appArtifacts() {
  /** @type {{ name: string, bytes: number, gzipBytes: number }[]} */
  const rows = [];
  const bundle = 'work/perf/embed-rn.android.bundle';
  const apk = 'examples/embed-rn/android/app/build/outputs/apk/release/app-release.apk';
  for (const path of [bundle, apk]) {
    try {
      statSync(path);
      rows.push(measure(path));
    } catch {
      // chưa dựng — bỏ qua
    }
  }
  return rows;
}

/** Điểm vào CLI: kiểm tra đủ file dist rồi in bảng kích thước ra stdout. */
function main() {
  const missing = TARGETS.filter((p) => {
    try {
      statSync(p);
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    console.error(`Thiếu file dist — chạy \`pnpm build\` trước:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  console.log(formatSizeTable([...TARGETS.map(measure), ...appArtifacts()]));
}

main();
