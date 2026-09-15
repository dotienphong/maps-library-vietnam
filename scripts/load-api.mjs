#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const DEFAULT_LEVELS = { places: [10, 25, 50, 100], directions: [4, 8, 16, 32] };
const QUERIES = ['highlands', 'cafe', 'nguyen hue', 'pharmacity', 'ben thanh'];
/**
 * Ngưỡng p95 để DỪNG ramp. Trần in-flight là câu hỏi về độ trễ chấp nhận được, không phải về
 * "có lỗi hay không": một wave 0 lỗi mà p95 9 giây vẫn là dịch vụ hỏng dưới góc nhìn người gõ phím.
 */
const DEFAULT_MAX_P95_MS = 5_000;
/** Burst theo key+IP trong wrangler.toml; nghỉ hết cửa sổ giữa các mức để 429 không làm bẩn số đo. */
const DEFAULT_COOLDOWN_MS = 65_000;

/** @param {number} users @param {number} index @param {'places'|'directions'} group */
function targetPath(users, index, group) {
  const cell = users * 101 + index;
  if (group === 'directions') {
    const offset = (cell % 500) * 0.00002;
    const to = `${(10.79 + offset).toFixed(5)},106.68000`;
    return `/v1/directions?from=10.7769,106.7009&to=${to}&mode=motorbike`;
  }
  const q = QUERIES[index % QUERIES.length] ?? 'cafe';
  // Mỗi VU dùng một ô cache 0,05° khác nhau để đo đường DB thay vì vô tình benchmark cache-hit.
  const near = `${8 + (cell % 100) * 0.1},${102 + (Math.floor(cell / 100) % 70) * 0.1}`;
  return `/v1/autocomplete?q=${encodeURIComponent(q)}&near=${near}`;
}

/** @param {number[]} sorted @param {number} p */
const percentile = (sorted, p) =>
  sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

/**
 * Một wave: mỗi virtual user gửi đúng một request cùng lúc.
 * @param {string} base @param {string} key @param {number} users
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, group?: 'places'|'directions' }} [options]
 */
export async function runLevel(base, key, users, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const group = options.group ?? 'places';
  const started = performance.now();
  const samples = await Promise.all(
    Array.from({ length: users }, async (_, index) => {
      const t0 = performance.now();
      try {
        const response = await fetchImpl(
          `${base.replace(/\/+$/, '')}${targetPath(users, index, group)}`,
          { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(timeoutMs) },
        );
        await response.arrayBuffer();
        return {
          ms: performance.now() - t0,
          status: response.status,
          cache: response.headers.get('x-mlv-cache') ?? 'none',
        };
      } catch {
        return { ms: performance.now() - t0, status: 0, cache: 'none' };
      }
    }),
  );
  const elapsedMs = Math.max(1, performance.now() - started);
  const times = samples.map(({ ms }) => ms).sort((a, b) => a - b);
  const rateLimited = samples.filter(({ status }) => status === 429).length;
  const timeouts = samples.filter(({ status }) => status === 0).length;
  const serverErrors = samples.filter(({ status }) => status >= 500).length;
  const clientErrors = samples.filter(
    ({ status }) => status >= 400 && status < 500 && status !== 429,
  ).length;
  const errors = timeouts + serverErrors + clientErrors;
  return {
    users,
    requests: samples.length,
    ok: samples.filter(({ status }) => status >= 200 && status < 400).length,
    rateLimited,
    errors,
    timeouts,
    serverErrors,
    clientErrors,
    cacheHits: samples.filter(({ cache }) => cache === 'hit').length,
    rps: Math.round((samples.length / elapsedMs) * 1000 * 10) / 10,
    p50: Math.round(percentile(times, 50)),
    p95: Math.round(percentile(times, 95)),
    p99: Math.round(percentile(times, 99)),
  };
}

/**
 * @param {string} base @param {string} key @param {number[]} [levels]
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, group?: 'places'|'directions',
 *   maxP95Ms?: number, cooldownMs?: number, sleepImpl?: (ms: number) => Promise<void> }} [options]
 */
export async function runRamp(base, key, levels, options = {}) {
  const group = options.group ?? 'places';
  const steps = levels ?? DEFAULT_LEVELS[group];
  const maxP95Ms = options.maxP95Ms ?? DEFAULT_MAX_P95_MS;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const sleepImpl =
    options.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const results = [];
  for (const [index, users] of steps.entries()) {
    if (index > 0 && cooldownMs > 0) await sleepImpl(cooldownMs);
    const level = await runLevel(base, key, users, options);
    results.push(level);
    // Ba lý do dừng, KHÔNG chỉ lỗi hạ tầng: 429 làm số đo mất nghĩa, còn p95 vượt ngưỡng nghĩa là
    // đã qua mức phục vụ được dù server vẫn trả 200.
    if (level.errors > 0) return { levels: results, stopped: true, stopReason: 'errors' };
    if (level.rateLimited > 0)
      return { levels: results, stopped: true, stopReason: 'rate_limited' };
    if (level.p95 > maxP95Ms) return { levels: results, stopped: true, stopReason: 'latency' };
  }
  return { levels: results, stopped: false, stopReason: null };
}

/** @param {string} name */
function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const base = arg('base') ?? process.env.API_BASE ?? 'http://localhost:8787';
  const key = process.env.MAPSLIBVN_API_KEY;
  if (!key) throw new Error('Thiếu MAPSLIBVN_API_KEY trong môi trường; không truyền khoá trên CLI');
  if (
    new URL(base).hostname === 'api.ai-solutions.io.vn' &&
    !process.argv.includes('--confirm-production')
  ) {
    throw new Error('Production cần cờ --confirm-production');
  }
  const group = arg('group') === 'directions' ? 'directions' : 'places';
  const levelsArg = arg('levels');
  const levels = levelsArg ? levelsArg.split(',').map(Number) : DEFAULT_LEVELS[group];
  if (levels.some((value) => !Number.isInteger(value) || value < 1 || value > 1000)) {
    throw new Error('Mỗi level phải là số nguyên 1–1000');
  }
  const maxP95Ms = Number(arg('max-p95') ?? DEFAULT_MAX_P95_MS);
  const cooldownMs = Number(arg('cooldown') ?? DEFAULT_COOLDOWN_MS);
  const result = await runRamp(base, key, levels, { group, maxP95Ms, cooldownMs });
  console.table(result.levels);
  const last = result.levels.at(-1);
  const highest = result.levels.at(-2)?.users ?? 'không có mức nào đạt';
  console.log(
    result.stopped
      ? `DỪNG ở mức ${last?.users} vì ${result.stopReason} (p95 ${last?.p95} ms, ngưỡng ${maxP95Ms} ms). Mức phục vụ được cao nhất: ${highest}.`
      : `Hết ramp, chưa chạm ngưỡng nào. Mức cao nhất đã thử: ${last?.users} (p95 ${last?.p95} ms). Đây là mức đã thử, KHÔNG phải trần của hệ thống.`,
  );
  if (result.stopped) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
