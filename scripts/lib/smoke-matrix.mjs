// Phần thuần (test được) của scripts/smoke-matrix.mjs — spec 22/09/2026 mục 6.1.
export const DEFAULT_BASE = 'https://api.ai-solutions.io.vn';

/**
 * 29 điểm nội thành TP.HCM trên đường công cộng ([lat, lng]). KHÔNG dùng toạ độ sân bay
 * 10.8188,106.6520: nó bám vào "VĐ. bảo vệ sân bay" trong khu bay (bài học 11/09/2026) — điểm sân bay
 * ở đây là Trường Sơn trước nhà ga. Nếu một điểm cho ô null trong bài A/B, thay điểm đó, không nới trần.
 * @type {readonly (readonly [number, number])[]}
 */
export const HCM_POINTS = [
  [10.7798, 106.699], // Nhà thờ Đức Bà
  [10.7725, 106.698], // Chợ Bến Thành
  [10.7769, 106.7032], // Nhà hát TP
  [10.7716, 106.7043], // Bitexco
  [10.777, 106.6953], // Dinh Độc Lập
  [10.7826, 106.6958], // Hồ Con Rùa
  [10.7889, 106.6906], // Chợ Tân Định
  [10.7877, 106.6947], // Công viên Lê Văn Tám
  [10.7877, 106.7052], // Thảo Cầm Viên
  [10.7686, 106.7069], // Bến Nhà Rồng
  [10.8039, 106.6963], // Chợ Bà Chiểu
  [10.8153, 106.6633], // Trường Sơn, trước ga Tân Sơn Nhất
  [10.757, 106.671], // Chợ An Đông
  [10.7724, 106.658], // ĐH Bách Khoa
  [10.795, 106.7218], // Landmark 81
  [10.796, 106.662], // Chợ Phạm Văn Hai
  [10.8148, 106.7111], // Bến xe Miền Đông cũ
  [10.812, 106.678], // Công viên Gia Định
  [10.792, 106.704], // Chợ Thị Nghè
  [10.799, 106.728], // Cầu Sài Gòn
  [10.781, 106.672], // Chợ Hoà Hưng
  [10.793, 106.653], // Ngã tư Bảy Hiền
  [10.762, 106.669], // Chợ Nguyễn Tri Phương
  [10.7497, 106.6511], // Chợ Bình Tây
  [10.7602, 106.6821], // Chợ Hoà Bình
  [10.7663, 106.6913], // Công viên 23/9
  [10.7745, 106.6866], // Bệnh viện Từ Dũ
  [10.7864, 106.6813], // Chợ Vườn Chuối
  [10.7708, 106.6939], // Chợ Thái Bình
];

/** @typedef {{ sources: (readonly [number, number])[], targets: (readonly [number, number])[], mode: 'motorbike' | 'car' | 'walk' }} BaiMaTran */
/** @typedef {{ from: readonly [number, number], stops: (readonly [number, number])[], to: readonly [number, number], mode: 'motorbike' | 'car' | 'walk' }} BaiToiUu */

/** Bài A 10×10 xe máy, B 25×4 ô tô, C TSP 12 điểm, D năm ma trận 10×10 dịch nhau (không trùng URL). */
export function planBai() {
  const P = HCM_POINTS;
  /** @type {BaiMaTran} */
  const A = { sources: P.slice(0, 10), targets: P.slice(10, 20), mode: 'motorbike' };
  /** @type {BaiMaTran} */
  const B = { sources: P.slice(0, 25), targets: P.slice(25, 29), mode: 'car' };
  const from = P[0];
  const to = P[11];
  if (!from || !to) throw new Error('HCM_POINTS thiếu điểm');
  /** @type {BaiToiUu} */
  const C = { from, stops: P.slice(1, 11), to, mode: 'motorbike' };
  /** @type {BaiMaTran[]} */
  const D = Array.from({ length: 5 }, (_, i) => ({
    sources: P.slice(i, i + 10),
    targets: P.slice(10 + i, 20 + i),
    mode: 'motorbike',
  }));
  return { A, B, C, D };
}

/** @param {readonly (readonly [number, number])[]} points */
export const joinPoints = (points) => points.map(([lat, lng]) => `${lat},${lng}`).join(';');

/**
 * Dịch vĩ độ ĐIỂM ĐẦU 0,0001° × k (~11 m) để mỗi lượt có khoá cache khác — đo Valhalla, không đo cache.
 * @param {readonly (readonly [number, number])[]} points @param {number} k
 * @returns {(readonly [number, number])[]}
 */
export function jitter(points, k) {
  return points.map(([lat, lng], i) =>
    i === 0 ? [Number((lat + 0.0001 * k).toFixed(4)), lng] : [lat, lng],
  );
}

/** @param {string} root @param {BaiMaTran} bai */
export function matrixUrl(root, { sources, targets, mode }) {
  return `${root}/v1/matrix?sources=${joinPoints(sources)}&targets=${joinPoints(targets)}&mode=${mode}`;
}

/** @param {string} root @param {BaiToiUu} bai */
export function optimizedUrl(root, { from, stops, to, mode }) {
  return `${root}/v1/optimized-route?from=${joinPoints([from])}&stops=${joinPoints(stops)}&to=${joinPoints([to])}&mode=${mode}`;
}

/** @param {string} root @param {readonly [number, number]} from @param {readonly [number, number]} to */
export function directionsUrl(root, from, to) {
  return `${root}/v1/directions?from=${joinPoints([from])}&to=${joinPoints([to])}&mode=motorbike`;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Bảng phải đúng cỡ, mọi ô số nguyên dương (điểm tốt trong nội thành không được null).
 * @param {unknown} body @param {number} rows @param {number} cols @returns {string[]}
 */
export function matrixIssues(body, rows, cols) {
  if (!isRecord(body)) return ['body không phải object'];
  /** @type {string[]} */
  const issues = [];
  for (const name of ['durations_s', 'distances_m']) {
    const table = body[name];
    if (!Array.isArray(table) || table.length !== rows) {
      issues.push(`${name} có ${Array.isArray(table) ? table.length : 0} hàng, cần ${rows}`);
      continue;
    }
    for (const [i, row] of table.entries()) {
      if (!Array.isArray(row) || row.length !== cols) {
        issues.push(`${name}[${i}] có ${Array.isArray(row) ? row.length : 0} ô, cần ${cols}`);
        continue;
      }
      for (const [j, cell] of row.entries()) {
        if (!(Number.isInteger(cell) && cell > 0)) {
          issues.push(`${name}[${i}][${j}] = ${String(cell)}`);
        }
      }
    }
  }
  return issues;
}

/**
 * `order` là hoán vị đủ của 0…stops−1; legs = stops + 1; waypoints = stops + 2.
 * @param {unknown} body @param {number} stops @returns {string[]}
 */
export function optimizedIssues(body, stops) {
  if (!isRecord(body)) return ['body không phải object'];
  /** @type {string[]} */
  const issues = [];
  const order = Array.isArray(body.order) ? body.order : [];
  const sorted = [...order].sort((a, b) => Number(a) - Number(b));
  const expected = Array.from({ length: stops }, (_, i) => i);
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
    issues.push(`order không phải hoán vị của 0…${stops - 1}`);
  }
  const route = Array.isArray(body.routes) ? body.routes[0] : undefined;
  const legs = isRecord(route) && Array.isArray(route.legs) ? route.legs.length : 0;
  if (legs !== stops + 1) issues.push(`legs = ${legs}, cần ${stops + 1}`);
  const waypoints = Array.isArray(body.waypoints) ? body.waypoints.length : 0;
  if (waypoints !== stops + 2) issues.push(`waypoints = ${waypoints}, cần ${stops + 2}`);
  return issues;
}

/** @param {string} value @param {string} name @param {number} min @param {number} max @param {boolean} integer */
function boundedNumber(value, name, min, max, integer) {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    (integer && !Number.isInteger(parsed)) ||
    parsed < min ||
    parsed > max
  ) {
    throw new Error(`${name} phải ${integer ? 'là số nguyên ' : ''}từ ${min} đến ${max}`);
  }
  return parsed;
}

/** @param {string[]} argv */
export function parseMatrixSmokeArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  let confirmProduction = false;
  for (const value of argv) {
    if (value === '--confirm-production') {
      if (confirmProduction) throw new Error('--confirm-production không được lặp');
      confirmProduction = true;
      continue;
    }
    const match = /^--(base|requests|p95-max|interval-ms|rounds|ratio-max)=(.+)$/.exec(value);
    if (!match) throw new Error(`Cờ không hợp lệ hoặc thiếu giá trị: ${value}`);
    const name = match[1];
    const raw = match[2];
    if (!name || raw === undefined) throw new Error(`Cờ không hợp lệ: ${value}`);
    if (values[name] !== undefined) throw new Error(`--${name} không được lặp`);
    values[name] = raw;
  }
  return {
    base: values.base ?? DEFAULT_BASE,
    confirmProduction,
    requests: boundedNumber(values.requests ?? '5', '--requests', 1, 50, true),
    intervalMs: boundedNumber(values['interval-ms'] ?? '3500', '--interval-ms', 0, 60_000, true),
    p95Max:
      values['p95-max'] === undefined
        ? null
        : boundedNumber(values['p95-max'], '--p95-max', 1, 120_000, false),
    rounds: boundedNumber(values.rounds ?? '0', '--rounds', 0, 10, true),
    ratioMax: boundedNumber(values['ratio-max'] ?? '2', '--ratio-max', 1, 10, false),
  };
}
