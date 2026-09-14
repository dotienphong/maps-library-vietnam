// Hàm thuần cho `pnpm compat:matrix` (scripts/compat-matrix.mjs). Không spawn, không đọc file.

/**
 * @typedef {{ react: string, reactNative: string, expo: string, newArch: boolean }} Combo
 */

/**
 * Các ô có ý nghĩa thương mại, không phải tích Descartes đầy đủ:
 * - ô hiện tại của app thử (mốc so sánh)
 * - ô thấp nhất mà `@maplibre/maplibre-react-native@11` khai báo chịu được
 * - ô React 18 và ô RN 0.79: hai câu hỏi mà món C1 cần trả lời
 * - kiến trúc mới bật và tắt trên ô hiện tại
 * @type {Combo[]}
 */
export const RN_MATRIX = [
  { react: '19.2.3', reactNative: '0.86.3', expo: '57.0.0', newArch: true },
  { react: '19.2.3', reactNative: '0.86.3', expo: '57.0.0', newArch: false },
  { react: '19.1.0', reactNative: '0.80.0', expo: '54.0.0', newArch: true },
  { react: '19.1.0', reactNative: '0.79.0', expo: '53.0.0', newArch: true },
  { react: '18.3.1', reactNative: '0.79.0', expo: '53.0.0', newArch: false },
];

/**
 * Id ổn định, chỉ chữ thường/số/dấu chấm/gạch — dùng làm tên thư mục app thử.
 * @param {Combo} c
 */
export function comboId(c) {
  return `react${c.react}-rn${c.reactNative}-expo${c.expo}-${c.newArch ? 'newarch' : 'oldarch'}`;
}

/**
 * `package.json` cho app thử của một ô. Ghim chính xác (không `^`, không `~`) để ô đo đúng
 * phiên bản mình khai báo.
 * @param {Combo} c
 * @param {string} tarballPath đường dẫn tarball tương đối thư mục app
 */
export function appPackageJson(c, tarballPath) {
  return {
    name: `compat-${comboId(c)}`,
    version: '1.0.0',
    main: 'index.ts',
    private: true,
    dependencies: {
      '@maplibre/maplibre-react-native': '11.3.8',
      '@mapslibvn/react-native': `file:${tarballPath}`,
      expo: c.expo,
      react: c.react,
      'react-native': c.reactNative,
    },
  };
}

/**
 * Phân loại lỗi để bảng đọc được mà không phải mở log.
 * @param {string} output stdout + stderr gộp
 * @returns {'peer' | 'metro' | 'build' | 'khác'}
 */
export function classifyFailure(output) {
  if (/ERESOLVE|peer dep/i.test(output)) return 'peer';
  if (/BUILD FAILED|Build failed|CompileError|ld: error/i.test(output)) return 'build';
  if (/Unable to resolve module|Metro/i.test(output)) return 'metro';
  return 'khác';
}

/**
 * @param {{ combo: Combo, ok: boolean, failure: string | null }[]} results
 */
export function formatMatrixTable(results) {
  const head = '| React | React Native | Expo | Kiến trúc | Kết quả |\n|---|---|---|---|---|';
  const rows = results.map((r) => {
    const arch = r.combo.newArch ? 'mới' : 'cũ';
    const verdict = r.ok ? 'ĐẠT' : `HỎNG (${r.failure ?? 'khác'})`;
    return `| ${r.combo.react} | ${r.combo.reactNative} | ${r.combo.expo} | ${arch} | ${verdict} |`;
  });
  return [head, ...rows].join('\n');
}
