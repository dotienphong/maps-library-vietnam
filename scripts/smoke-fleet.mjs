#!/usr/bin/env node
// Smoke chia đơn đội xe trên production (spec 2026-09-23 mục 8): bài E (5 xe, 28 đơn) và E2 (2 xe,
// 8 đơn có sức chứa/khung giờ/dừng), N lượt cách 30 s (FLEET_RATE_LIMITER 2/phút); --rounds=K chạy
// bài F: K vòng, mỗi vòng 5 directions lúc rảnh → bắn 2 bài E SONG SONG + 5 directions xen kẽ →
// nghỉ hết phút.
//   pnpm smoke:fleet -- --confirm-production [--requests=5] [--rounds=3] [--p95-max=8000] [--p95-max-e2=5000] [--ratio-max=2] [--busy-max=2000]
// Mỗi phản hồi 2xx được ACK receipt NGAY (scripts/lib/receipt-ack.mjs) — REST trần khoá cả tenant 24
// giờ. Khoá đọc từ MAPSLIBVN_API_KEY (khoá `server`). Gặp 429 là smoke sai nhịp — sửa smoke, không
// sửa trần. Ghi rõ máy chủ đang chạy production vào evidence: trần là số đo trên MỘT máy.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getAndAck, postAndAck } from './lib/receipt-ack.mjs';
import {
  fleetBodyFor,
  fleetIssues,
  parseFleetSmokeArgs,
  planBaiFleet,
} from './lib/smoke-fleet.mjs';
import { directionsUrl } from './lib/smoke-matrix.mjs';
import { assertDirectionsTarget, percentile } from './smoke-directions.mjs';

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
const todayVn = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/**
 * @typedef {{ name: string, ok: number, failed: number, p95_ms: number | null, ack_loi: number, codes: string, violations: string }} Row
 * @param {import('./lib/smoke-fleet.mjs').BaiFleet} bai
 * @param {{ key: string, root: string, requests: number, intervalMs: number, sent: { n: number } }} ctx
 * @returns {Promise<Row>}
 */
async function runBai(bai, ctx) {
  /** @type {number[]} */
  const durations = [];
  /** @type {Set<string>} */
  const codes = new Set();
  /** @type {string[]} */
  const violations = [];
  let ok = 0;
  let failed = 0;
  let ackFailed = 0;
  const kiem = {
    vehicles: bai.vehicles,
    jobs: bai.jobs.length,
    capacity: bai.capacity,
    roundTrip: bai.roundTrip,
  };
  for (let k = 0; k < ctx.requests; k++) {
    if (ctx.sent.n > 0 && ctx.intervalMs > 0) await sleep(ctx.intervalMs);
    ctx.sent.n += 1;
    const r = await postAndAck(
      `${ctx.root}/v1/fleet-plan`,
      ctx.root,
      ctx.key,
      fleetBodyFor(bai, k, todayVn()),
    );
    durations.push(r.ms);
    if (r.ackFailed) ackFailed += 1;
    if (r.status !== 200) {
      failed += 1;
      codes.add(r.code ?? String(r.status));
      continue;
    }
    const issues = fleetIssues(r.body, kiem);
    if (issues.length > 0) {
      failed += 1;
      codes.add('invalid_body');
      violations.push(...issues.slice(0, 3));
    } else ok += 1;
  }
  const p95 = percentile(durations, 95);
  return {
    name: bai.name,
    ok,
    failed,
    p95_ms: p95 === null ? null : Math.round(p95),
    ack_loi: ackFailed,
    codes: [...codes].join(','),
    violations: [...new Set(violations)].join('; '),
  };
}

/**
 * Một vòng bài F: 5 directions rảnh → 2 bài E song song + 5 directions xen kẽ → nghỉ tới đủ 60 s.
 * Tổng 12 request/phút/khoá, dưới burst 20 và đúng nhịp 2 đội xe/phút.
 * @param {string} root @param {string} key @param {import('./lib/smoke-fleet.mjs').BaiFleet} E
 * @param {number} round
 */
async function runRound(root, key, E, round) {
  const started = Date.now();
  const from = E.depot;
  /** @param {number} offset */
  const sampleDirections = async (offset) => {
    /** @type {number[]} */
    const ms = [];
    for (let i = 0; i < 5; i++) {
      const target = E.jobs[(i + offset) % E.jobs.length];
      if (!target) throw new Error('bài E thiếu đơn');
      const r = await getAndAck(directionsUrl(root, from, target), root, key);
      if (r.status !== 200) {
        throw new Error(
          `vòng ${round}: directions ${r.status} ${r.code ?? ''} — dừng, không đo tiếp`,
        );
      }
      ms.push(r.ms);
      await sleep(1_000);
    }
    return ms;
  };
  const idle = await sampleDirections(0);
  const fleetRuns = [1, 2].map((j) =>
    postAndAck(`${root}/v1/fleet-plan`, root, key, fleetBodyFor(E, 100 * round + j, todayVn())),
  );
  const busy = await sampleDirections(5);
  const fleetResults = await Promise.all(fleetRuns);
  const fleetFailed = fleetResults.filter((r) => r.status !== 200);
  if (fleetFailed.length > 0) {
    throw new Error(
      `vòng ${round}: ${fleetFailed.length} request đội xe lỗi (${fleetFailed.map((r) => r.code ?? r.status).join(',')})`,
    );
  }
  const idleP95 = percentile(idle, 95) ?? 0;
  const busyP95 = percentile(busy, 95) ?? 0;
  const row = {
    round,
    idle_p95_ms: Math.round(idleP95),
    busy_p95_ms: Math.round(busyP95),
    ratio: Number((busyP95 / Math.max(1, idleP95)).toFixed(2)),
    fleet_p95_ms: Math.round(
      percentile(
        fleetResults.map((r) => r.ms),
        95,
      ) ?? 0,
    ),
  };
  const elapsed = Date.now() - started;
  if (elapsed < 60_000) await sleep(60_000 - elapsed);
  return row;
}

async function main() {
  const args = parseFleetSmokeArgs(process.argv.slice(2));
  assertDirectionsTarget(args.base, args.confirmProduction ? ['--confirm-production'] : []);
  const key = process.env.MAPSLIBVN_API_KEY;
  if (!key) throw new Error('Thiếu MAPSLIBVN_API_KEY (khoá server) trong môi trường');
  const root = args.base.replace(/\/+$/, '');
  const { E, E2 } = planBaiFleet();
  const ctx = { key, root, requests: args.requests, intervalMs: args.intervalMs, sent: { n: 0 } };
  console.log(
    `E, E2: ${2 * args.requests} lượt cách ${args.intervalMs} ms; F: ${args.rounds} vòng × ~60 s`,
  );
  const rows = [await runBai(E, ctx), await runBai(E2, ctx)];
  console.table(rows);
  for (const [i, row] of rows.entries()) {
    if (row.failed > 0) {
      throw new Error(`${row.name}: ${row.failed} lượt lỗi (${row.codes}) ${row.violations}`);
    }
    if (row.ack_loi > 0) {
      throw new Error(
        `${row.name}: ${row.ack_loi} receipt KHÔNG xác nhận được — dừng ngay, ba receipt treo là khoá cả tenant 24 giờ`,
      );
    }
    const max = i === 0 ? args.p95Max : args.p95MaxE2;
    if (max !== null && row.p95_ms !== null && row.p95_ms > max) {
      throw new Error(`${row.name}: p95 ${row.p95_ms} ms vượt ${max} ms`);
    }
  }
  if (args.rounds > 0) {
    console.log('nghỉ 60 s trước bài F để bộ đếm nhịp sạch…');
    await sleep(60_000);
    /** @type {Awaited<ReturnType<typeof runRound>>[]} */
    const fRows = [];
    for (let round = 1; round <= args.rounds; round++) {
      fRows.push(await runRound(root, key, E, round));
    }
    console.table(fRows);
    const worst = Math.max(...fRows.map((r) => r.ratio));
    const busyWorst = Math.max(...fRows.map((r) => r.busy_p95_ms));
    // HAI điều kiện. Tỷ lệ một mình có thể được thoả bằng cách làm baseline tệ đi (đã xảy ra 22/09).
    if (busyWorst > args.busyMax) {
      throw new Error(
        `bài F: p95 directions lúc bận ${busyWorst} ms, vượt ngưỡng tuyệt đối ${args.busyMax} ms`,
      );
    }
    if (worst > args.ratioMax) {
      throw new Error(
        `bài F: p95 directions lúc bận gấp ${worst} lần lúc rảnh, vượt ${args.ratioMax}`,
      );
    }
  }
  console.log(`✓ smoke fleet ${args.base}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
