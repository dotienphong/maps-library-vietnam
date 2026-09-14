// Hàm thuần cho `pnpm perf:size` (scripts/perf-size.mjs). Không đọc file, không spawn.

/**
 * kB một chữ số thập phân, dấu phẩy kiểu Việt.
 * @param {number} bytes
 */
export function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1).replace('.', ',')} kB`;
}

/**
 * @param {{ name: string, bytes: number, gzipBytes: number }[]} rows
 */
export function formatSizeTable(rows) {
  const head = '| File | Thô | Gzip |\n|---|---|---|';
  const body = rows.map((r) => `| ${r.name} | ${formatKb(r.bytes)} | ${formatKb(r.gzipBytes)} |`);
  return [head, ...body].join('\n');
}
