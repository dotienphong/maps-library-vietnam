// Phần thuần (test được) của scripts/smoke-matrix.mjs — spec 22/09/2026 mục 6.1.
export const DEFAULT_BASE = 'https://api.ai-solutions.io.vn';

/**
 * 29 điểm nội thành TP.HCM ([lat, lng]). Mỗi điểm phải nối được bằng CẢ BA mode — đã kiểm trên
 * production 22/09/2026 bằng hai ma trận 1×25 và 1×4 cho từng mode. Ba cái bẫy đã gặp, đều là điểm
 * "nổi tiếng" nhưng bám vào lối nội bộ không thuộc mạng đường công cộng:
 *   - sân bay 10.8188,106.6520 → "VĐ. bảo vệ sân bay" trong khu bay (11/09), dùng Trường Sơn thay;
 *   - Landmark 81 10.795,106.7218 → trong khu Vinhomes, null với MỌI mode;
 *   - điểm giữa chợ Hoà Hưng null riêng với `car`, điểm giữa Thảo Cầm Viên null riêng với `walk`.
 * Ô null trong bài A/B nghĩa là một điểm hỏng: thay điểm đó rồi kiểm lại ba mode, KHÔNG nới trần.
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
  [10.788, 106.7047], // Cổng Thảo Cầm Viên trên Nguyễn Bỉnh Khiêm (điểm giữa vườn thú không đi bộ tới được)
  [10.7686, 106.7069], // Bến Nhà Rồng
  [10.8039, 106.6963], // Chợ Bà Chiểu
  [10.8153, 106.6633], // Trường Sơn, trước ga Tân Sơn Nhất
  [10.757, 106.671], // Chợ An Đông
  [10.7724, 106.658], // ĐH Bách Khoa
  [10.801, 106.7118], // Ngã tư Hàng Xanh (thay Landmark 81: điểm đó nằm trong khu Vinhomes,
  // không nối mạng đường công cộng nên mọi ô ma trận tới nó là null — đo production 22/09/2026)
  [10.796, 106.662], // Chợ Phạm Văn Hai
  [10.8148, 106.7111], // Bến xe Miền Đông cũ
  [10.812, 106.678], // Công viên Gia Định
  [10.792, 106.704], // Chợ Thị Nghè
  [10.799, 106.728], // Cầu Sài Gòn
  [10.7838, 106.6739], // Cách Mạng Tháng 8 gần chợ Hoà Hưng (điểm trong chợ ô tô không vào được)
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

/**
 * Cỡ bài bám đúng trần đang chạy (50 cặp; 10 điểm dừng — nâng lại 23/09/2026): A 10×5 xe máy,
 * B 25×2 ô tô, C TSP 12 điểm (from + 10 stops + to), D năm ma trận 10×5 dịch nhau để không trùng URL.
 * Đổi `MATRIX_MAX_PAIRS` / `OPTIMIZED_MAX_STOPS` bên Worker thì sửa cả đây, nếu không smoke đo một
 * cỡ mà production cho phép một cỡ khác.
 */
export function planBai() {
  const P = HCM_POINTS;
  /** @type {BaiMaTran} */
  const A = { sources: P.slice(0, 10), targets: P.slice(10, 15), mode: 'motorbike' };
  /** @type {BaiMaTran} */
  const B = { sources: P.slice(0, 25), targets: P.slice(25, 27), mode: 'car' };
  const from = P[0];
  const to = P[11];
  if (!from || !to) throw new Error('HCM_POINTS thiếu điểm');
  /** @type {BaiToiUu} */
  const C = { from, stops: P.slice(1, 11), to, mode: 'motorbike' };
  /** @type {BaiMaTran[]} */
  const D = Array.from({ length: 5 }, (_, i) => ({
    sources: P.slice(i, i + 10),
    targets: P.slice(15 + i, 20 + i),
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
    // pnpm 10 chuyển nguyên `--` của `pnpm smoke:… -- --cờ` vào argv thay vì nuốt nó.
    if (value === '--') continue;
    if (value === '--confirm-production') {
      if (confirmProduction) throw new Error('--confirm-production không được lặp');
      confirmProduction = true;
      continue;
    }
    const match = /^--(base|requests|p95-max|interval-ms|rounds|ratio-max|busy-max)=(.+)$/.exec(
      value,
    );
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
    // 10 s/lượt: `MATRIX_RATE_LIMITER` cho 6 request/phút/khoá (spec mục 6.3). Nhịp 3,5 s của
    // smoke:directions sẽ tự gây 429 ở đây — chính phép đo phải sống trong luật mình đặt ra.
    intervalMs: boundedNumber(values['interval-ms'] ?? '10000', '--interval-ms', 0, 60_000, true),
    p95Max:
      values['p95-max'] === undefined
        ? null
        : boundedNumber(values['p95-max'], '--p95-max', 1, 120_000, false),
    rounds: boundedNumber(values.rounds ?? '0', '--rounds', 0, 10, true),
    ratioMax: boundedNumber(values['ratio-max'] ?? '2', '--ratio-max', 1, 10, false),
    // Ngưỡng TUYỆT ĐỐI cho directions lúc bận. Chỉ có tỷ lệ là không đủ: 22/09/2026 đặt
    // VALHALLA_THREADS=2 làm baseline xấu đi nên tỷ lệ tụt 5,3× → 1,4× trong khi busy_p95 không đổi.
    busyMax: boundedNumber(values['busy-max'] ?? '2000', '--busy-max', 1, 120_000, false),
  };
}
