#!/usr/bin/env node
// Smoke chỉ đường trên production (spec dẫn đường A mục 7.4): bốn tuyến chuẩn, N lượt mỗi tuyến, p95.
//   pnpm smoke:directions -- --confirm-production [--requests=5] [--p95-max=1500] [--interval-ms=3500] [--base=https://…]
// /v1/directions có burst 20 request/phút/khoá+IP nên smoke tự cách 3,5 s giữa các lượt (~17/phút):
// 20 lượt × 4 tuyến ≈ 4,7 phút. Không hạ interval khi chạy production, nếu không sẽ tự gây 429.
// Khoá đọc từ MAPSLIBVN_API_KEY hoặc KEY_EXAMPLE_EMBED (.env). Lần đầu chạy --requests=20 để lấy p95 ghi
// evidence, sau đó chốt --p95-max theo số đo (không đoán).
import 'dotenv/config';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE = 'https://api.ai-solutions.io.vn';
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

/** @type {readonly { name: string, mode: 'motorbike' | 'car' | 'walk', from: string, to: string }[]} */
export const SMOKE_ROUTES = [
  // Nhà thờ Đức Bà → Sân bay Tân Sơn Nhất (~8 km)
  { name: 'noi-thanh-hcm', mode: 'motorbike', from: '10.7798,106.6990', to: '10.8188,106.6520' },
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
 *   vietnamese: boolean, distance_m: number | null, p95_ms: number | null, codes: string[] }} RouteSummary
 * @typedef {{ routes?: { distance_m?: number, flags?: { highway?: boolean }, legs?: { steps?: { instruction: string }[] }[] }[] }} DirectionsBody
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
    };
    for (let i = 0; i < requests; i++) {
      // Cách đều mọi lượt (kể cả giữa hai tuyến và sau lượt lỗi) để không tự vướng burst limiter.
      if (sent > 0 && intervalMs > 0)
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      sent += 1;
      const t0 = Date.now();
      try {
        const response = await fetchImpl(url, {
          headers: { 'X-Api-Key': key },
          signal: AbortSignal.timeout(timeoutMs),
        });
        durations.push(Date.now() - t0);
        if (response.status !== 200) {
          row.failed += 1;
          try {
            row.codes.push(String((await response.json())?.error?.code ?? response.status));
          } catch {
            row.codes.push(String(response.status));
          }
          continue;
        }
        /** @type {DirectionsBody} */
        const body = await response.json();
        const first = body?.routes?.[0];
        row.ok += 1;
        row.distance_m = first?.distance_m ?? null;
        row.highway = first?.flags?.highway ?? null;
        row.vietnamese = Boolean(
          first?.legs?.some((leg) => leg.steps?.some((s) => VI.test(s.instruction))),
        );
      } catch {
        row.failed += 1;
        row.codes.push('timeout');
      }
    }
    row.p95_ms = percentile(durations, 95);
    row.codes = [...new Set(row.codes)];
    summary.push(row);
  }
  return summary;
}

/** @param {RouteSummary[]} summary @param {number | null} p95Max */
export function validateDirectionsSmoke(summary, p95Max) {
  for (const row of summary) {
    if (row.failed > 0)
      throw new Error(`${row.name}: ${row.failed} lượt lỗi (${row.codes.join(',')})`);
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
  if (
    new URL(base).hostname === new URL(DEFAULT_BASE).hostname &&
    !argv.includes('--confirm-production')
  ) {
    throw new Error('Production cần cờ --confirm-production');
  }
}

/** @param {string} name */
function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const base = arg('base') ?? DEFAULT_BASE;
  const key = process.env.MAPSLIBVN_API_KEY ?? process.env.KEY_EXAMPLE_EMBED;
  if (!key) throw new Error('Thiếu MAPSLIBVN_API_KEY hoặc KEY_EXAMPLE_EMBED trong môi trường');
  assertDirectionsTarget(base, process.argv);
  const requests = Number(arg('requests') ?? 5);
  if (!Number.isInteger(requests) || requests < 1 || requests > 50)
    throw new Error('--requests từ 1 đến 50');
  const p95Raw = arg('p95-max');
  const p95Max = p95Raw === undefined ? null : Number(p95Raw);
  if (p95Max !== null && !(p95Max > 0)) throw new Error('--p95-max phải là số dương (ms)');
  const intervalMs = Number(arg('interval-ms') ?? 3500);
  if (!Number.isInteger(intervalMs) || intervalMs < 0)
    throw new Error('--interval-ms phải là số nguyên ≥ 0');
  console.log(
    `${SMOKE_ROUTES.length * requests} lượt, cách ${intervalMs} ms — ước ${Math.ceil((SMOKE_ROUTES.length * requests * intervalMs) / 60_000)} phút`,
  );
  const summary = await runDirectionsSmoke(base, key, requests, { intervalMs });
  console.table(summary.map(({ codes, ...row }) => ({ ...row, codes: codes.join(',') })));
  validateDirectionsSmoke(summary, p95Max);
  console.log(`✓ smoke directions ${base} — ${requests} lượt/tuyến`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
