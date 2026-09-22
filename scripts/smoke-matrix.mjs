#!/usr/bin/env node
// Smoke ma trận và tối ưu thứ tự trên production (spec 22/09/2026 mục 6.1): bài A 10×10, B 25×4, C TSP
// 12 điểm, mỗi bài N lượt cách 3,5 s, in p95; --rounds=K chạy thêm bài D: K vòng, mỗi vòng đo 5 lượt
// directions lúc rảnh → bắn 5 ma trận 10×10 SONG SONG + 5 directions xen kẽ → nghỉ hết phút.
//   pnpm smoke:matrix -- --confirm-production [--requests=20] [--rounds=3] [--p95-max=3000] [--ratio-max=2] [--busy-max=2000]
// Nhịp: `/v1/matrix` và `/v1/optimized-route` có MATRIX_RATE_LIMITER 6 request/phút/khoá, nên A–C
// cách 10 s (~6/phút). Mỗi vòng D bắn đúng 5 ma trận (≤ 6) rồi nghỉ tới đủ 60 s; giữa C và D nghỉ 60 s.
// Gặp 429 là smoke sai nhịp — sửa smoke, không sửa trần.
// Mỗi lượt A–C dịch điểm đầu 0,0001° × k để không trúng cache (khoá cache làm tròn 4 chữ số).
// Mỗi phản hồi 2xx được ACK receipt NGAY (scripts/lib/receipt-ack.mjs): gọi REST trần làm sổ quota
// khoá cả tenant 24 giờ, kể cả playground của trang tài liệu. Khoá đọc từ MAPSLIBVN_API_KEY (khoá `server`). Lần đầu chạy --requests=20 --rounds=3 để lấy số ghi
// evidence docs/evidence/routing/, rồi chốt --p95-max theo số đo (không đoán).
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getAndAck } from './lib/receipt-ack.mjs';
import {
  directionsUrl,
  jitter,
  matrixIssues,
  matrixUrl,
  optimizedIssues,
  optimizedUrl,
  parseMatrixSmokeArgs,
  planBai,
} from './lib/smoke-matrix.mjs';
import { assertDirectionsTarget, percentile } from './smoke-directions.mjs';

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gọi endpoint rồi ACK receipt ngay. KHÔNG được gọi REST trần: tenant thương mại phát receipt cho mỗi
 * 2xx và ba receipt treo là khoá cả tenant 24 giờ (sự cố 22/09/2026 — playground tài liệu chết theo).
 * @param {string} url @param {string} key @param {string} root
 * @returns {Promise<{ ms: number, status: number, body: unknown, code: string | null, ackFailed: boolean }>}
 */
const timedGet = (url, key, root) => getAndAck(url, root, key);

/**
 * @typedef {{ name: string, ok: number, failed: number, p95_ms: number | null, ack_loi: number, codes: string, violations: string }} Row
 * @param {string} name @param {(k: number) => string} urlAt @param {(body: unknown) => string[]} check
 * @param {{ key: string, root: string, requests: number, intervalMs: number, sent: { n: number } }} ctx
 * @returns {Promise<Row>}
 */
async function runBai(name, urlAt, check, ctx) {
  /** @type {number[]} */
  const durations = [];
  /** @type {Set<string>} */
  const codes = new Set();
  /** @type {string[]} */
  const violations = [];
  let ok = 0;
  let failed = 0;
  let ackFailed = 0;
  for (let k = 0; k < ctx.requests; k++) {
    if (ctx.sent.n > 0 && ctx.intervalMs > 0) await sleep(ctx.intervalMs);
    ctx.sent.n += 1;
    const r = await timedGet(urlAt(k), ctx.key, ctx.root);
    durations.push(r.ms);
    if (r.ackFailed) ackFailed += 1;
    if (r.status !== 200) {
      failed += 1;
      codes.add(r.code ?? String(r.status));
      continue;
    }
    const issues = check(r.body);
    if (issues.length > 0) {
      failed += 1;
      codes.add('invalid_body');
      violations.push(...issues.slice(0, 3));
    } else ok += 1;
  }
  const p95 = percentile(durations, 95);
  return {
    name,
    ok,
    failed,
    p95_ms: p95 === null ? null : Math.round(p95),
    ack_loi: ackFailed,
    codes: [...codes].join(','),
    violations: [...new Set(violations)].join('; '),
  };
}

/**
 * Một vòng bài D. Tổng 15 request theo khoá+IP, rồi nghỉ tới đủ 60 s.
 * @param {string} root @param {string} key
 * @param {import('./lib/smoke-matrix.mjs').BaiMaTran[]} matrices @param {number} round
 */
async function runRound(root, key, matrices, round) {
  const started = Date.now();
  const bai = planBai();
  const from = bai.C.from;
  const to = bai.C.to;
  /** @param {number} offset */
  const sampleDirections = async (offset) => {
    /** @type {number[]} */
    const ms = [];
    for (let i = 0; i < 5; i++) {
      // Mỗi lượt một điểm đến khác để không trúng cache; xen kẽ cách 1 s.
      const target = bai.C.stops[(i + offset) % bai.C.stops.length] ?? to;
      const r = await timedGet(directionsUrl(root, from, target), key, root);
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
  const matrixRuns = matrices.map((m) =>
    timedGet(matrixUrl(root, { ...m, sources: jitter(m.sources, round + 1) }), key, root),
  );
  const busy = await sampleDirections(5);
  const matrixResults = await Promise.all(matrixRuns);
  const matrixFailed = matrixResults.filter((r) => r.status !== 200);
  if (matrixFailed.length > 0) {
    throw new Error(
      `vòng ${round}: ${matrixFailed.length} ma trận lỗi (${matrixFailed.map((r) => r.code ?? r.status).join(',')})`,
    );
  }
  const idleP95 = percentile(idle, 95) ?? 0;
  const busyP95 = percentile(busy, 95) ?? 0;
  const row = {
    round,
    idle_p95_ms: Math.round(idleP95),
    busy_p95_ms: Math.round(busyP95),
    ratio: Number((busyP95 / Math.max(1, idleP95)).toFixed(2)),
    matrix_p95_ms: Math.round(
      percentile(
        matrixResults.map((r) => r.ms),
        95,
      ) ?? 0,
    ),
  };
  const elapsed = Date.now() - started;
  if (elapsed < 60_000) await sleep(60_000 - elapsed);
  return row;
}

async function main() {
  const args = parseMatrixSmokeArgs(process.argv.slice(2));
  assertDirectionsTarget(args.base, args.confirmProduction ? ['--confirm-production'] : []);
  const key = process.env.MAPSLIBVN_API_KEY;
  if (!key) throw new Error('Thiếu MAPSLIBVN_API_KEY (khoá server) trong môi trường');
  const root = args.base.replace(/\/+$/, '');
  const bai = planBai();
  const ctx = { key, root, requests: args.requests, intervalMs: args.intervalMs, sent: { n: 0 } };
  console.log(
    `A–C: ${3 * args.requests} lượt cách ${args.intervalMs} ms; D: ${args.rounds} vòng × ~60 s`,
  );
  const rows = [
    await runBai(
      'A ma tran 10x10 motorbike',
      (k) => matrixUrl(root, { ...bai.A, sources: jitter(bai.A.sources, k) }),
      (b) => matrixIssues(b, 10, 10),
      ctx,
    ),
    await runBai(
      'B ma tran 25x4 car',
      (k) => matrixUrl(root, { ...bai.B, sources: jitter(bai.B.sources, k) }),
      (b) => matrixIssues(b, 25, 4),
      ctx,
    ),
    await runBai(
      'C TSP 12 diem motorbike',
      (k) => optimizedUrl(root, { ...bai.C, from: jitter([bai.C.from], k)[0] ?? bai.C.from }),
      (b) => optimizedIssues(b, 10),
      ctx,
    ),
  ];
  console.table(rows);
  for (const row of rows) {
    if (row.failed > 0) {
      throw new Error(`${row.name}: ${row.failed} lượt lỗi (${row.codes}) ${row.violations}`);
    }
    if (row.ack_loi > 0) {
      throw new Error(
        `${row.name}: ${row.ack_loi} receipt KHÔNG xác nhận được — dừng ngay, ba receipt treo là khoá cả tenant 24 giờ`,
      );
    }
    if (args.p95Max !== null && row.p95_ms !== null && row.p95_ms > args.p95Max) {
      throw new Error(`${row.name}: p95 ${row.p95_ms} ms vượt ${args.p95Max} ms`);
    }
  }
  if (args.rounds > 0) {
    console.log('nghỉ 60 s trước bài D để bộ đếm burst sạch…');
    await sleep(60_000);
    /** @type {Awaited<ReturnType<typeof runRound>>[]} */
    const dRows = [];
    for (let round = 1; round <= args.rounds; round++) {
      dRows.push(await runRound(root, key, bai.D, round));
    }
    console.table(dRows);
    const worst = Math.max(...dRows.map((r) => r.ratio));
    const busyWorst = Math.max(...dRows.map((r) => r.busy_p95_ms));
    // HAI điều kiện. Tỷ lệ một mình có thể được thoả bằng cách làm baseline tệ đi (đã xảy ra 22/09).
    if (busyWorst > args.busyMax) {
      throw new Error(
        `bài D: p95 directions lúc bận ${busyWorst} ms, vượt ngưỡng tuyệt đối ${args.busyMax} ms`,
      );
    }
    if (worst > args.ratioMax) {
      throw new Error(
        `bài D: p95 directions lúc bận gấp ${worst} lần lúc rảnh, vượt ${args.ratioMax}`,
      );
    }
  }
  console.log(`✓ smoke matrix ${args.base}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
