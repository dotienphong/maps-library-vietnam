// Phần thuần (test được) của scripts/smoke-fleet.mjs — spec 2026-09-23 mục 8.
import { DEFAULT_BASE, HCM_POINTS } from './smoke-matrix.mjs';

/**
 * @typedef {{ name: string, vehicles: number, depot: readonly [number, number],
 *   jobs: (readonly [number, number])[], mode: 'motorbike' | 'car' | 'walk',
 *   capacity: number | null, serviceS: number, shift: [string, string] | null,
 *   windowJobs: number[], roundTrip: boolean }} BaiFleet
 */

/**
 * E: cỡ gần tối đa — 5 xe cùng kho Chợ Bến Thành (HCM_POINTS[1]), 28 đơn là 28 điểm còn lại (bộ
 * điểm đã kiểm nối được ba mode). E2: có ràng buộc — 2 xe, 8 đơn, sức chứa 5 / khối lượng 1, dừng
 * 300 s, ca 08:00–12:00, đơn 0 và 3 có khung giờ 09:00–11:00. Đổi trần bên Worker
 * (`FLEET_MAX_*` trong apps/api/src/routing/fleet.ts) thì sửa cả đây.
 */
export function planBaiFleet() {
  const depot = HCM_POINTS[1];
  if (!depot) throw new Error('HCM_POINTS thiếu kho');
  const rest = HCM_POINTS.filter((_, i) => i !== 1);
  /** @type {BaiFleet} */
  const E = {
    name: `E doi xe 5 xe ${rest.length} don motorbike`,
    vehicles: 5,
    depot,
    jobs: rest,
    mode: 'motorbike',
    capacity: null,
    serviceS: 0,
    shift: null,
    windowJobs: [],
    roundTrip: true,
  };
  /** @type {BaiFleet} */
  const E2 = {
    name: 'E2 doi xe 2 xe 8 don rang buoc',
    vehicles: 2,
    depot,
    jobs: rest.slice(1, 9),
    mode: 'motorbike',
    capacity: 5,
    serviceS: 300,
    shift: ['08:00', '12:00'],
    windowJobs: [0, 3],
    roundTrip: true,
  };
  return { E, E2 };
}

/**
 * Body `POST /v1/fleet-plan`; kho dịch 0,0001° × k để mỗi lượt có khoá cache khác.
 * @param {BaiFleet} bai @param {number} k @param {string} today YYYY-MM-DD giờ VN
 * @returns {{ mode: string, vehicles: Record<string, unknown>[], jobs: Record<string, unknown>[] }}
 */
export function fleetBodyFor(bai, k, today) {
  const [lat, lng] = bai.depot;
  /** @type {[number, number]} */
  const depot = [Number((lat + 0.0001 * k).toFixed(4)), lng];
  const iso = (/** @type {string} */ hhmm) => `${today}T${hhmm}:00+07:00`;
  const vehicles = Array.from({ length: bai.vehicles }, (_, i) => {
    /** @type {Record<string, unknown>} */
    const v = { id: `xe-${i + 1}`, start: depot };
    if (!bai.roundTrip) v.end = 'open';
    if (bai.capacity !== null) v.capacity = bai.capacity;
    if (bai.shift) v.time_window = [iso(bai.shift[0]), iso(bai.shift[1])];
    return v;
  });
  const jobs = bai.jobs.map((location, i) => {
    /** @type {Record<string, unknown>} */
    const j = { id: `don-${i + 1}`, location };
    if (bai.capacity !== null) j.demand = 1;
    if (bai.serviceS > 0) j.service_s = bai.serviceS;
    if (bai.windowJobs.includes(i)) j.time_windows = [[iso('09:00'), iso('11:00')]];
    return j;
  });
  return { mode: bai.mode, vehicles, jobs };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Đủ xe; tổng đơn xếp + unassigned = số đơn; mỗi xe có đơn: legs = đơn (+1 nếu về kho), waypoints
 * = legs + 1, stops = đơn, arrival_s tăng dần, load ≤ sức chứa.
 * @param {unknown} body
 * @param {{ vehicles: number, jobs: number, capacity: number | null, roundTrip: boolean }} bai
 * @returns {string[]}
 */
export function fleetIssues(body, bai) {
  if (!isRecord(body)) return ['body không phải object'];
  /** @type {string[]} */
  const issues = [];
  const vehicles = Array.isArray(body.vehicles) ? body.vehicles : [];
  if (vehicles.length !== bai.vehicles) {
    issues.push(`vehicles = ${vehicles.length}, cần ${bai.vehicles}`);
  }
  const unassigned = Array.isArray(body.unassigned) ? body.unassigned.length : 0;
  let assigned = 0;
  for (const v of vehicles) {
    if (!isRecord(v)) {
      issues.push('vehicle không phải object');
      continue;
    }
    const jobs = Array.isArray(v.jobs) ? v.jobs.length : 0;
    assigned += jobs;
    const id = String(v.vehicle);
    if (jobs === 0) continue;
    const route = Array.isArray(v.routes) ? v.routes[0] : undefined;
    const legs = isRecord(route) && Array.isArray(route.legs) ? route.legs.length : 0;
    const canLegs = jobs + (bai.roundTrip ? 1 : 0);
    if (legs !== canLegs) issues.push(`${id}: legs = ${legs}, cần ${canLegs}`);
    const waypoints = Array.isArray(v.waypoints) ? v.waypoints.length : 0;
    if (waypoints !== canLegs + 1)
      issues.push(`${id}: waypoints = ${waypoints}, cần ${canLegs + 1}`);
    const stops = Array.isArray(v.stops) ? v.stops : [];
    if (stops.length !== jobs) issues.push(`${id}: stops = ${stops.length}, cần ${jobs}`);
    const arrivals = stops.map((s) =>
      isRecord(s) && typeof s.arrival_s === 'number' ? s.arrival_s : Number.NaN,
    );
    if (arrivals.some((a, i) => i > 0 && !(a >= (arrivals[i - 1] ?? 0)))) {
      issues.push(`${id}: arrival_s không tăng dần`);
    }
    if (bai.capacity !== null && typeof v.load === 'number' && v.load > bai.capacity) {
      issues.push(`${id}: load ${v.load} vượt sức chứa ${bai.capacity}`);
    }
  }
  if (assigned + unassigned !== bai.jobs) {
    issues.push(`đơn xếp + unassigned = ${assigned + unassigned}, cần ${bai.jobs}`);
  }
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
export function parseFleetSmokeArgs(argv) {
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
    const match =
      /^--(base|requests|interval-ms|p95-max|p95-max-e2|rounds|ratio-max|busy-max)=(.+)$/.exec(
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
    requests: boundedNumber(values.requests ?? '5', '--requests', 1, 30, true),
    // 30 s/lượt: FLEET_RATE_LIMITER 2 request/phút/khoá — phép đo phải sống trong luật mình đặt.
    intervalMs: boundedNumber(values['interval-ms'] ?? '30000', '--interval-ms', 0, 120_000, true),
    p95Max:
      values['p95-max'] === undefined
        ? null
        : boundedNumber(values['p95-max'], '--p95-max', 1, 120_000, false),
    p95MaxE2:
      values['p95-max-e2'] === undefined
        ? null
        : boundedNumber(values['p95-max-e2'], '--p95-max-e2', 1, 120_000, false),
    rounds: boundedNumber(values.rounds ?? '0', '--rounds', 0, 10, true),
    ratioMax: boundedNumber(values['ratio-max'] ?? '2', '--ratio-max', 1, 10, false),
    // Ngưỡng TUYỆT ĐỐI cho directions lúc bận — tỷ lệ một mình có thể được thoả bằng cách làm
    // baseline tệ đi (bài học 22/09/2026).
    busyMax: boundedNumber(values['busy-max'] ?? '2000', '--busy-max', 1, 120_000, false),
  };
}
