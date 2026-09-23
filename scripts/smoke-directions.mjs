#!/usr/bin/env node
// Smoke chỉ đường trên production (spec dẫn đường A mục 7.4): bốn tuyến chuẩn, N lượt mỗi tuyến, p95.
//   pnpm smoke:directions -- --confirm-production [--requests=5] [--p95-max=1500] [--interval-ms=3500] [--base=https://…]
// /v1/directions có burst 20 request/phút/khoá+IP nên smoke tự cách 3,5 s giữa các lượt (~17/phút):
// 20 lượt × 4 tuyến ≈ 4,7 phút. Không hạ interval khi chạy production, nếu không sẽ tự gây 429.
// Mỗi phản hồi 2xx được ACK receipt ngay (scripts/lib/receipt-ack.mjs) — gọi REST trần làm sổ quota
// khoá cả tenant 24 giờ. Khoá đọc từ MAPSLIBVN_API_KEY hoặc KEY_EXAMPLE_EMBED (.env). Lần đầu chạy --requests=20 để lấy p95 ghi
// evidence, sau đó chốt --p95-max theo số đo (không đoán).
// Ngưỡng p95 production đo 2026-09-11: --p95-max=800 (p95 lớn nhất 483 ms của lien-tinh-o-to × 1,5,
// làm tròn lên trăm; bốn tuyến đo được 400/375/483/347 ms với 20 lượt mỗi tuyến).
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { ackReceipt, receiptFrom } from './lib/receipt-ack.mjs';

const DEFAULT_BASE = 'https://api.ai-solutions.io.vn';
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

/** @type {readonly { name: string, mode: 'motorbike' | 'car' | 'walk', from: string, to: string }[]} */
export const SMOKE_ROUTES = [
  // Nhà thờ Đức Bà → ga Tân Sơn Nhất, điểm đích trên Trường Sơn (~7,5 km).
  // KHÔNG dùng toạ độ sân bay 10.8188,106.6520: nó snap vào "VĐ. bảo vệ sân bay" trong khu bay,
  // không nối mạng đường công cộng nên auto/motor_scooter đều trả 442 no_route (chỉ pedestrian đi được).
  { name: 'noi-thanh-hcm', mode: 'motorbike', from: '10.7798,106.6990', to: '10.8153,106.6633' },
  // TP.HCM → Vũng Tàu (~100 km): xe máy KHÔNG được lên cao tốc → flags.highway phải false
  { name: 'lien-tinh-xe-may', mode: 'motorbike', from: '10.7725,106.6980', to: '10.3460,107.0843' },
  // TP.HCM → Cần Thơ (~170 km) ô tô
  { name: 'lien-tinh-o-to', mode: 'car', from: '10.7725,106.6980', to: '10.0341,105.7841' },
  // Hồ Gươm → Lăng Bác (~2,5 km) đi bộ
  { name: 'di-bo-ha-noi', mode: 'walk', from: '21.0285,105.8542', to: '21.0369,105.8348' },
];

/** @param {number[]} values @param {number} p */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

/**
 * @typedef {{ name: string, mode: string, ok: number, failed: number, highway: boolean | null,
 *   vietnamese: boolean, distance_m: number | null, p95_ms: number | null, codes: string[],
 *   violations: string[] }} RouteSummary
 * @param {string} base @param {string} key @param {number} requests
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, intervalMs?: number }} [options]
 * @returns {Promise<RouteSummary[]>}
 */
export async function runDirectionsSmoke(base, key, requests, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 3_500;
  const root = base.replace(/\/+$/, '');
  let sent = 0;
  /** @type {RouteSummary[]} */
  const summary = [];
  for (const route of SMOKE_ROUTES) {
    const url = `${root}/v1/directions?from=${route.from}&to=${route.to}&mode=${route.mode}`;
    /** @type {number[]} */
    const durations = [];
    /** @type {RouteSummary} */
    const row = {
      name: route.name,
      mode: route.mode,
      ok: 0,
      failed: 0,
      highway: null,
      vietnamese: false,
      distance_m: null,
      p95_ms: null,
      codes: [],
      violations: [],
    };
    for (let i = 0; i < requests; i++) {
      // Cách đều mọi lượt (kể cả giữa hai tuyến và sau lượt lỗi) để không tự vướng burst limiter.
      if (sent > 0 && intervalMs > 0)
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      sent += 1;
      const t0 = performance.now();
      const signal = AbortSignal.timeout(timeoutMs);
      /** @type {Response} */
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { 'X-Api-Key': key },
          redirect: 'error',
          signal,
        });
      } catch (error) {
        row.failed += 1;
        row.codes.push(requestErrorCode(error, signal));
        continue;
      }
      // ACK NGAY, trước cả khi đọc body: tenant thương mại phát một receipt cho mỗi 2xx, và ba receipt
      // treo trong 24 giờ là khoá CẢ tenant với `ack_required` — playground trên trang tài liệu chết
      // theo (sự cố 22/09/2026). Đo `ms` đã xong ở trên nên vòng ACK không lọt vào p95.
      if (!(await ackReceipt(root, key, receiptFrom(response)))) {
        row.failed += 1;
        row.codes.push('ack_failed');
      }
      if (response.status !== 200) {
        row.failed += 1;
        row.codes.push(await responseErrorCode(response));
        durations.push(performance.now() - t0);
        continue;
      }
      /** @type {unknown} */
      let body;
      try {
        body = await response.json();
      } catch {
        row.failed += 1;
        row.codes.push('invalid_json');
        durations.push(performance.now() - t0);
        continue;
      }
      recordRouteSample(row, body, route.mode);
      durations.push(performance.now() - t0);
    }
    row.p95_ms = percentile(durations, 95);
    row.codes = [...new Set(row.codes)];
    summary.push(row);
  }
  return summary;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {RouteSummary} row @param {unknown} body @param {string} expectedMode */
function recordRouteSample(row, body, expectedMode) {
  const routes = isRecord(body) && Array.isArray(body.routes) ? body.routes : [];
  const route = routes[0];
  /** @type {string[]} */
  const issues = [];
  if (!isRecord(route)) {
    issues.push('routes[0] không hợp lệ');
  } else {
    if (route.mode !== expectedMode)
      issues.push(`mode=${String(route.mode)} (cần ${expectedMode})`);
    if (
      typeof route.distance_m !== 'number' ||
      !Number.isFinite(route.distance_m) ||
      route.distance_m <= 0
    )
      issues.push('distance_m phải hữu hạn và dương');
    else row.distance_m = route.distance_m;
    if (
      typeof route.duration_s !== 'number' ||
      !Number.isFinite(route.duration_s) ||
      route.duration_s <= 0
    )
      issues.push('duration_s phải hữu hạn và dương');

    const flags = isRecord(route.flags) ? route.flags : null;
    if (flags && typeof flags.highway === 'boolean') {
      if (flags.highway) row.highway = true;
      else if (row.highway === null) row.highway = false;
      if (expectedMode === 'motorbike' && flags.highway) issues.push('xe máy bị dẫn lên cao tốc');
    }
    if (
      !flags ||
      typeof flags.toll !== 'boolean' ||
      typeof flags.highway !== 'boolean' ||
      typeof flags.ferry !== 'boolean'
    ) {
      issues.push('flags.toll/highway/ferry phải là boolean');
    }

    if (!Array.isArray(route.legs) || route.legs.length === 0) {
      issues.push('legs phải không rỗng');
    } else {
      /** @type {string[]} */
      const instructions = [];
      for (const leg of route.legs) {
        if (!isRecord(leg) || !Array.isArray(leg.steps) || leg.steps.length === 0) {
          issues.push('legs[].steps phải không rỗng');
          continue;
        }
        for (const step of leg.steps) {
          if (!isRecord(step) || typeof step.instruction !== 'string' || !step.instruction.trim()) {
            issues.push('steps[].instruction phải không rỗng');
          } else {
            instructions.push(step.instruction);
          }
        }
      }
      if (instructions.length === 0) {
        issues.push('không có instruction');
      } else if (instructions.some((instruction) => VI.test(instruction))) {
        row.vietnamese = true;
      } else {
        issues.push('không có câu chỉ dẫn tiếng Việt có dấu');
      }
    }
  }

  if (issues.length > 0) {
    row.failed += 1;
    row.codes.push('invalid_route');
    row.violations.push(...issues);
  } else {
    row.ok += 1;
  }
}

/** @param {Response} response */
async function responseErrorCode(response) {
  try {
    const body = await response.json();
    if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string') {
      return body.error.code;
    }
  } catch {
    // The HTTP status remains a useful diagnostic when the error body is not JSON.
  }
  return String(response.status);
}

/** @param {unknown} error @param {AbortSignal} signal */
function requestErrorCode(error, signal) {
  if (signal.aborted) return 'timeout';
  if (error instanceof Error && error.name) return `request_${error.name.toLowerCase()}`;
  return 'request_failed';
}

/** @param {RouteSummary[]} summary @param {number | null} p95Max */
export function validateDirectionsSmoke(summary, p95Max) {
  for (const row of summary) {
    if (row.failed > 0)
      throw new Error(
        `${row.name}: ${row.failed} lượt lỗi (${row.codes.join(',')}) ${row.violations.join('; ')}`,
      );
    if (row.mode === 'motorbike' && row.highway)
      throw new Error(
        `${row.name}: xe máy bị dẫn lên cao tốc (flags.highway=true) — chỉnh costing_options.motor_scooter.use_highways`,
      );
    if (!row.vietnamese) throw new Error(`${row.name}: không có câu chỉ dẫn tiếng Việt có dấu`);
    if (p95Max !== null && row.p95_ms !== null && row.p95_ms > p95Max)
      throw new Error(`${row.name}: p95 ${row.p95_ms} ms vượt ngưỡng ${p95Max} ms`);
  }
}

/** @param {string} base @param {string[]} argv */
export function assertDirectionsTarget(base, argv) {
  let target;
  try {
    target = new URL(base);
  } catch {
    throw new Error('--base phải là URL hợp lệ');
  }
  const hostname = target.hostname.toLowerCase().replace(/\.+$/, '');
  const loopback =
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (!loopback && target.protocol !== 'https:') throw new Error('Target remote phải dùng HTTPS');
  if (!loopback && !argv.includes('--confirm-production'))
    throw new Error('Target remote cần cờ --confirm-production');
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
export function parseDirectionsArgs(argv) {
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
    const match = /^--(base|requests|p95-max|interval-ms)=(.+)$/.exec(value);
    if (!match) throw new Error(`Cờ không hợp lệ hoặc thiếu giá trị: ${value}`);
    const name = match[1];
    const raw = match[2];
    if (!name || raw === undefined) throw new Error(`Cờ không hợp lệ: ${value}`);
    if (values[name] !== undefined) throw new Error(`--${name} không được lặp`);
    values[name] = raw;
  }
  const requests = boundedNumber(values.requests ?? '5', '--requests', 1, 50, true);
  const p95Max =
    values['p95-max'] === undefined
      ? null
      : boundedNumber(values['p95-max'], '--p95-max', 1, 120_000, false);
  const intervalMs = boundedNumber(
    values['interval-ms'] ?? '3500',
    '--interval-ms',
    0,
    60_000,
    true,
  );
  return {
    base: values.base ?? DEFAULT_BASE,
    confirmProduction,
    requests,
    p95Max,
    intervalMs,
  };
}

/** @param {number} requests @param {number} intervalMs */
export function estimateDirectionsDurationMs(requests, intervalMs) {
  return Math.max(0, SMOKE_ROUTES.length * requests - 1) * intervalMs;
}

async function main() {
  const args = parseDirectionsArgs(process.argv.slice(2));
  assertDirectionsTarget(args.base, args.confirmProduction ? ['--confirm-production'] : []);
  const key = process.env.MAPSLIBVN_API_KEY ?? process.env.KEY_EXAMPLE_EMBED;
  if (!key) throw new Error('Thiếu MAPSLIBVN_API_KEY hoặc KEY_EXAMPLE_EMBED trong môi trường');
  console.log(
    `${SMOKE_ROUTES.length * args.requests} lượt, cách ${args.intervalMs} ms — ước ${Math.ceil(estimateDirectionsDurationMs(args.requests, args.intervalMs) / 60_000)} phút`,
  );
  const summary = await runDirectionsSmoke(args.base, key, args.requests, {
    intervalMs: args.intervalMs,
  });
  console.table(summary.map(({ codes, ...row }) => ({ ...row, codes: codes.join(',') })));
  validateDirectionsSmoke(summary, args.p95Max);
  console.log(`✓ smoke directions ${args.base} — ${args.requests} lượt/tuyến`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
