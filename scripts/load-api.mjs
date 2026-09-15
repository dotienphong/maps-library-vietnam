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

/**
 * @param {number} users @param {number} index @param {'places'|'directions'} group
 * @param {'cold'|'warm'} [cache] `cold`: mỗi VU một ô `near` riêng để đo đường DB. `warm`: mọi VU
 *   dùng CÙNG một URL, nên sau lượt mồi là đo đường cache.
 * @param {number} [seed] Tách dải ô cho từng tenant khi chạy nhiều tenant cùng lúc.
 */
function targetPath(users, index, group, cache = 'cold', seed = 0) {
  // Ở chế độ warm mọi VU phải ra ĐÚNG một URL, nên cả ô `near` lẫn truy vấn đều phải cố định —
  // chỉ ghim ô mà để truy vấn chạy theo VU thì vẫn ra nhiều khoá cache khác nhau.
  const slot = cache === 'warm' ? 0 : index;
  const cell = (cache === 'warm' ? 7 : users * 101 + index) + seed * 9_973;
  if (group === 'directions') {
    const offset = (cell % 500) * 0.00002;
    const to = `${(10.79 + offset).toFixed(5)},106.68000`;
    return `/v1/directions?from=10.7769,106.7009&to=${to}&mode=motorbike`;
  }
  const q = QUERIES[slot % QUERIES.length] ?? 'cafe';
  // Mỗi VU dùng một ô cache 0,05° khác nhau để đo đường DB thay vì vô tình benchmark cache-hit.
  const near = `${8 + (cell % 100) * 0.1},${102 + (Math.floor(cell / 100) % 70) * 0.1}`;
  return `/v1/autocomplete?q=${encodeURIComponent(q)}&near=${near}`;
}

/**
 * Xác nhận một receipt của tenant thương mại. Lỗi ở đây KHÔNG làm hỏng phép đo — nó chỉ khiến
 * lượt đó không được tính tiền — nên chỉ đếm, không ném.
 * @param {typeof fetch} fetchImpl @param {string} base @param {string} key
 * @param {string} receiptId @param {string} token @param {number} timeoutMs
 */
function acknowledge(fetchImpl, base, key, receiptId, token, timeoutMs) {
  return fetchImpl(
    `${base.replace(/\/+$/, '')}/v1/quota/receipts/${encodeURIComponent(receiptId)}/ack`,
    {
      method: 'POST',
      headers: { 'X-Api-Key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  ).then((response) => {
    if (!response.ok) throw new Error(`ack ${response.status}`);
    return response.arrayBuffer();
  });
}

/** @param {number[]} sorted @param {number} p */
const percentile = (sorted, p) =>
  sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

/**
 * Một wave: mỗi virtual user gửi đúng một request cùng lúc.
 * @param {string} base @param {string} key @param {number} users
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, group?: 'places'|'directions',
 *   cache?: 'cold'|'warm', seed?: number }} [options]
 */
export async function runLevel(base, key, users, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const group = options.group ?? 'places';
  const cache = options.cache ?? 'cold';
  const seed = options.seed ?? 0;
  /** @type {Promise<unknown>[]} */
  const acks = [];
  const started = performance.now();
  const samples = await Promise.all(
    Array.from({ length: users }, async (_, index) => {
      const t0 = performance.now();
      try {
        const response = await fetchImpl(
          `${base.replace(/\/+$/, '')}${targetPath(users, index, group, cache, seed)}`,
          { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(timeoutMs) },
        );
        await response.arrayBuffer();
        const sample = {
          ms: performance.now() - t0,
          status: response.status,
          cache: response.headers.get('x-mlv-cache') ?? 'none',
        };
        // Tenant thương mại: KHÔNG ACK là bộ đo tự phá phép đo của chính nó. Mỗi 2xx bỏ quên
        // thành một `missed_ack`, và ba cái trong 24 giờ khoá tenant bằng `ack_required` —
        // sau đúng ba request đầu, phần còn lại của ramp chỉ đo được lỗi 429.
        // ACK gửi SAU khi đã chốt `ms`, đúng như SDK làm: trả dữ liệu trước, xác nhận sau.
        const receiptId = response.headers.get('x-mapslibvn-receipt-id');
        const token = response.headers.get('x-mapslibvn-receipt-token');
        if (receiptId && token) {
          acks.push(acknowledge(fetchImpl, base, key, receiptId, token, timeoutMs));
        }
        return sample;
      } catch {
        return { ms: performance.now() - t0, status: 0, cache: 'none' };
      }
    }),
  );
  const elapsedMs = Math.max(1, performance.now() - started);
  // Chờ ACK xong rồi mới trả kết quả, nhưng sau khi đã chốt `elapsedMs`: ACK không được tính
  // vào độ trễ lẫn RPS, vì khách không phải chờ nó để có dữ liệu.
  const acked = (await Promise.allSettled(acks)).filter((r) => r.status === 'fulfilled').length;
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
    acked,
    rps: Math.round((samples.length / elapsedMs) * 1000 * 10) / 10,
    p50: Math.round(percentile(times, 50)),
    p95: Math.round(percentile(times, 95)),
    p99: Math.round(percentile(times, 99)),
  };
}

/**
 * @param {string} base @param {string} key @param {number[]} [levels]
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, group?: 'places'|'directions',
 *   cache?: 'cold'|'warm', maxP95Ms?: number, cooldownMs?: number,
 *   sleepImpl?: (ms: number) => Promise<void> }} [options]
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

/**
 * A/B trên CÙNG bộ URL: mỗi nhánh một khoá, chạy lần lượt, nghỉ hết cửa sổ burst ở giữa. Chênh
 * lệch p50/p95/p99 so với nhánh đầu là chi phí quota thương mại cộng thêm.
 *
 * Chạy lần lượt chứ không song song là có chủ ý: hai nhánh chạy cùng lúc sẽ tranh chính origin
 * đang đo, và phần chênh lệch đo được sẽ lẫn cả tải do nhánh kia gây ra.
 * @param {string} base
 * @param {{label: string, key: string}[]} arms
 * @param {number} users
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, group?: 'places'|'directions',
 *   cache?: 'cold'|'warm', cooldownMs?: number, sleepImpl?: (ms: number) => Promise<void> }} [options]
 */
export async function runComparison(base, arms, users, options = {}) {
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const sleepImpl =
    options.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const measured = [];
  for (const [index, arm] of arms.entries()) {
    if (index > 0 && cooldownMs > 0) await sleepImpl(cooldownMs);
    // Ở chế độ warm phải mồi trước, nếu không nhánh đầu tiên gánh toàn bộ chi phí nạp cache và
    // "chi phí quota" đo được sẽ mang dấu âm.
    if (options.cache === 'warm') await runLevel(base, arm.key, 1, options);
    measured.push({ label: arm.label, ...(await runLevel(base, arm.key, users, options)) });
  }
  const baseline = measured[0];
  return {
    arms: measured,
    overhead: measured.slice(1).map((arm) => ({
      label: arm.label,
      against: baseline?.label ?? '',
      p50: arm.p50 - (baseline?.p50 ?? 0),
      p95: arm.p95 - (baseline?.p95 ?? 0),
      p99: arm.p99 - (baseline?.p99 ?? 0),
    })),
  };
}

/**
 * Nhiều tenant cùng lúc, mỗi tenant một dải URL riêng. Trả số đo TỪNG tenant: gộp thành một p95
 * chung sẽ giấu mất chuyện một tenant đang bị tenant khác làm chậm.
 * @param {string} base
 * @param {{label: string, key: string}[]} arms
 * @param {number} users
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, group?: 'places'|'directions',
 *   cache?: 'cold'|'warm' }} [options]
 */
export async function runMixed(base, arms, users, options = {}) {
  const levels = await Promise.all(
    arms.map(async (arm, index) => ({
      label: arm.label,
      ...(await runLevel(base, arm.key, users, { ...options, seed: index + 1 })),
    })),
  );
  return {
    arms: levels,
    totalRequests: levels.reduce((total, level) => total + level.requests, 0),
    worstP95: Math.max(...levels.map((level) => level.p95)),
  };
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
  const cache = arg('cache') === 'warm' ? 'warm' : 'cold';
  const mode = arg('mode') ?? 'ramp';

  if (mode === 'ab' || mode === 'mixed') {
    // Khoá thứ hai cũng đọc từ môi trường, không nhận trên CLI: argv nằm trong `ps` và shell history.
    const keyB = process.env.MAPSLIBVN_API_KEY_B;
    if (!keyB) {
      throw new Error(
        `Chế độ ${mode} cần MAPSLIBVN_API_KEY_B (khoá của tenant nhánh hai) trong môi trường`,
      );
    }
    const arms = [
      { label: arg('label-a') ?? 'legacy', key },
      { label: arg('label-b') ?? 'commercial', key: keyB },
    ];
    const users = levels[0] ?? 10;
    if (mode === 'ab') {
      const ab = await runComparison(base, arms, users, { group, cache, cooldownMs });
      console.table(ab.arms);
      console.table(ab.overhead);
      console.log(
        'Chênh lệch trên là chi phí quota thương mại cộng thêm ở CÙNG bộ URL. Burst limit còn ' +
          'hoạt động hay không phải nghiệm thu riêng bằng `pnpm smoke:rate-limit`.',
      );
      return;
    }
    const mixed = await runMixed(base, arms, users, { group, cache });
    console.table(mixed.arms);
    console.log(
      `Tổng ${mixed.totalRequests} request đồng thời, p95 tệ nhất ${mixed.worstP95} ms. Đây là số của từng tenant, không gộp lại thành một con số chung.`,
    );
    return;
  }

  const result = await runRamp(base, key, levels, { group, maxP95Ms, cooldownMs, cache });
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
