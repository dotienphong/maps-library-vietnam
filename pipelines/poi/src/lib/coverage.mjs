// Độ phủ POI theo tỉnh × nhóm × nguồn cho report.mjs (plan 2026-09-26, Task 5). Tỉnh là
// admin_province (tỉnh hiện hành suy từ toạ độ); POI chưa có tỉnh gom vào "(không rõ)".

const UNKNOWN = '(không rõ)';

/**
 * @typedef {{ total: number, bySource: Record<string, number>, byGroup: Record<string, number> }} ProvinceCoverage
 * @param {{ province: string | null, group_code: string, source: string, n: number }[]} rows
 * @returns {Record<string, ProvinceCoverage>} khoá theo tổng POI giảm dần
 */
export function nestCoverage(rows) {
  /** @type {Map<string, ProvinceCoverage>} */
  const by = new Map();
  for (const r of rows) {
    const key = r.province ?? UNKNOWN;
    const cur = by.get(key) ?? { total: 0, bySource: {}, byGroup: {} };
    cur.total += r.n;
    cur.bySource[r.source] = (cur.bySource[r.source] ?? 0) + r.n;
    cur.byGroup[r.group_code] = (cur.byGroup[r.group_code] ?? 0) + r.n;
    by.set(key, cur);
  }
  return Object.fromEntries([...by].sort((a, b) => b[1].total - a[1].total));
}
