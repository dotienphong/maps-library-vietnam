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

/**
 * Tách `Server-Timing: reserve;dur=210, prepare;dur=198` thành `{reserve: 210, prepare: 198}`.
 * Đây là thứ cho biết 677 ms chi phí quota nằm ở vòng gọi nào — không có nó thì chỉ đoán.
 * @param {string | null} header
 */
export function parseServerTiming(header) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const part of (header ?? '').split(',')) {
    const match = /^\s*([A-Za-z0-9_-]+)\s*;\s*dur=([0-9.]+)/.exec(part);
    if (match?.[1] && match[2] !== undefined) out[match[1]] = Number(match[2]);
  }
  return out;
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
          timing: parseServerTiming(response.headers.get('server-timing')),
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
        return { ms: performance.now() - t0, status: 0, cache: 'none', timing: {} };
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
    /** Mẫu thô đã sắp xếp, để nhiều wave gộp lại thành một phân phối đủ dày. */
    times,
    /** Thời gian từng vòng gọi Durable Object, gom theo tên. */
    timings: samples.reduce(
      (acc, sample) => {
        for (const [name, ms] of Object.entries(sample.timing ?? {})) {
          acc[name] ??= [];
          acc[name]?.push(ms);
        }
        return acc;
      },
      /** @type {Record<string, number[]>} */ ({}),
    ),
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
 * Trên ngưỡng này thì origin đã xếp hàng, và hàng giây chờ Postgres nuốt trọn vài chục mili-giây
 * chi phí quota cần đo. Đo ở đó ra số nhưng số đó không nói về quota.
 */
const SATURATED_P95_MS = 2_000;
/** Cache nội bộ được ghi trong `waitUntil`, tức SAU khi response đã trả. Chờ nó lắng. */
const WARMUP_SETTLE_MS = 1_500;
/** Nghỉ giữa các wave gộp mẫu: đủ để không dồn thành một burst, đủ ngắn để điều kiện không đổi. */
const REPEAT_GAP_MS = 2_000;

/**
 * Gộp nhiều wave của CÙNG một nhánh thành một phân phối. Ở mức đồng thời thấp — mức duy nhất
 * đo được chi phí quota vì origin chưa xếp hàng — một wave chỉ cho vài mẫu, và p95 của 5 mẫu
 * chính là mẫu chậm nhất. Gộp mẫu là cách lấy percentile có nghĩa mà không phải tăng tải.
 * @param {any[]} waves
 */
function pool(waves) {
  const times = waves.flatMap((wave) => wave.times).sort((a, b) => a - b);
  /** @type {Record<string, number[]>} */
  const timings = {};
  for (const wave of waves) {
    for (const [name, list] of Object.entries(wave.timings ?? {})) {
      timings[name] ??= [];
      timings[name]?.push(.../** @type {number[]} */ (list));
    }
  }
  const sum = (/** @type {string} */ field) =>
    waves.reduce((total, wave) => total + wave[field], 0);
  return {
    users: waves[0]?.users ?? 0,
    waves: waves.length,
    requests: sum('requests'),
    ok: sum('ok'),
    rateLimited: sum('rateLimited'),
    errors: sum('errors'),
    timeouts: sum('timeouts'),
    serverErrors: sum('serverErrors'),
    clientErrors: sum('clientErrors'),
    cacheHits: sum('cacheHits'),
    acked: sum('acked'),
    rps: Math.round((sum('rps') / Math.max(1, waves.length)) * 10) / 10,
    p50: Math.round(percentile(times, 50)),
    p95: Math.round(percentile(times, 95)),
    p99: Math.round(percentile(times, 99)),
    timings: Object.fromEntries(
      Object.entries(timings).map(([name, list]) => {
        const sorted = [...list].sort((a, b) => a - b);
        return [
          name,
          {
            samples: sorted.length,
            p50: Math.round(percentile(sorted, 50)),
            p95: Math.round(percentile(sorted, 95)),
          },
        ];
      }),
    ),
  };
}

/**
 * A/B: mỗi nhánh một khoá, chạy lần lượt, nghỉ hết cửa sổ burst ở giữa. Chênh lệch p50/p95/p99 so
 * với nhánh đầu là chi phí quota thương mại cộng thêm.
 *
 * Ba quyết định đều rút ra từ một lượt đo HỎNG trên production ngày 15/09/2026:
 *
 * 1. **Mỗi nhánh một dải URL riêng**, không dùng chung. Dùng chung thì nhánh chạy sau hưởng cache
 *    do nhánh trước làm nóng — lượt đo hỏng cho `cacheHits` 2 với 19 và "chi phí quota" âm
 *    1.184 ms. Hai dải khác ô lưới nhưng cùng hình dạng truy vấn, nên vẫn là cùng một workload.
 * 2. **Chế độ warm mồi TẤT CẢ các nhánh rồi mới đo nhánh nào**, và chờ cache lắng. Mồi ngay trước
 *    lượt đo của từng nhánh vẫn để nhánh đầu gánh phần nạp cache cho cả wave đồng thời.
 * 3. **Cảnh báo khi số đo không dùng được**: origin bão hoà, hoặc có timeout làm p99 chạm trần
 *    client. Im lặng trả về một con số trông hợp lý là cách tệ nhất.
 *
 * Chạy lần lượt chứ không song song cũng là có chủ ý: hai nhánh chạy cùng lúc sẽ tranh chính
 * origin đang đo.
 * @param {string} base
 * @param {{label: string, key: string}[]} arms
 * @param {number} users
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, group?: 'places'|'directions',
 *   cache?: 'cold'|'warm', cooldownMs?: number, saturatedP95Ms?: number, repeat?: number,
 *   sleepImpl?: (ms: number) => Promise<void> }} [options]
 */
export async function runComparison(base, arms, users, options = {}) {
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const saturatedP95Ms = options.saturatedP95Ms ?? SATURATED_P95_MS;
  const repeat = Math.max(1, options.repeat ?? 1);
  // Trần burst là 60/phút cho mỗi cặp khoá+IP. Vượt nó thì lượt đo biến thành lượt đo 429.
  if (users * repeat > 50) {
    throw new Error(
      `users × repeat = ${users * repeat} vượt ngân sách burst an toàn (50). Hạ --levels hoặc --repeat.`,
    );
  }
  const sleepImpl =
    options.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  /**
   * @param {number} index nhánh
   * @param {number} round wave thứ mấy trong `repeat`
   *
   * Cold phải đổi dải URL theo TỪNG wave: lặp lại đúng bộ URL đó thì từ wave thứ hai trở đi là
   * đo cache chứ không còn đo đường DB — lượt đo 15/09 cho `cacheHits` 25/30 ở chế độ cold vì
   * lỗi này. Warm thì ngược lại, phải giữ nguyên dải để mọi wave cùng trúng một entry.
   */
  const armOptions = (index, round) => ({
    ...options,
    seed: options.cache === 'warm' ? index + 1 : (index + 1) * 97 + round,
  });

  if (options.cache === 'warm') {
    for (const [index, arm] of arms.entries()) {
      await runLevel(base, arm.key, 1, armOptions(index, 0));
    }
    await sleepImpl(WARMUP_SETTLE_MS);
  }

  const measured = [];
  for (const [index, arm] of arms.entries()) {
    if (index > 0 && cooldownMs > 0) await sleepImpl(cooldownMs);
    /** @type {any[]} */
    const waves = [];
    for (let round = 0; round < repeat; round += 1) {
      if (round > 0) await sleepImpl(REPEAT_GAP_MS);
      waves.push(await runLevel(base, arm.key, users, armOptions(index, round)));
    }
    measured.push({ label: arm.label, ...pool(waves) });
  }
  const baseline = measured[0];

  /** @type {string[]} */
  const warnings = [];
  if ((baseline?.p95 ?? 0) > saturatedP95Ms) {
    warnings.push(
      `Origin đã bão hoà (nhánh nền p95 ${baseline?.p95} ms > ${saturatedP95Ms} ms). Chênh lệch dưới đây phần lớn là nhiễu xếp hàng, KHÔNG phải chi phí quota. Hạ --levels rồi đo lại.`,
    );
  }
  const timedOut = measured.filter((arm) => arm.timeouts > 0);
  if (timedOut.length > 0) {
    warnings.push(
      `${timedOut.map((arm) => arm.label).join(', ')} có timeout: p99 chạm trần timeout của client, không phải độ trễ thật. Bỏ cột p99 của lượt này.`,
    );
  }
  const spread = measured.map((arm) => arm.cacheHits);
  const totalRequests = baseline?.requests ?? users;
  if (Math.max(...spread) - Math.min(...spread) > Math.max(1, Math.round(totalRequests * 0.2))) {
    warnings.push(
      `cacheHits lệch nhau nhiều giữa các nhánh (${spread.join(' vs ')}): hai nhánh không gặp cùng điều kiện cache, chênh lệch không so sánh được.`,
    );
  }

  return {
    arms: measured,
    overhead: measured.slice(1).map((arm) => ({
      label: arm.label,
      against: baseline?.label ?? '',
      p50: arm.p50 - (baseline?.p50 ?? 0),
      p95: arm.p95 - (baseline?.p95 ?? 0),
      p99: arm.p99 - (baseline?.p99 ?? 0),
    })),
    warnings,
    usable: warnings.length === 0,
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
    const repeat = Number(arg('repeat') ?? 1);
    if (mode === 'ab') {
      const ab = await runComparison(base, arms, users, { group, cache, cooldownMs, repeat });
      // Bỏ `timings` khỏi bảng chính: nó được in riêng ở dưới, nhét vào đây thì bảng không đọc nổi.
      console.table(ab.arms.map(({ timings, ...row }) => row));
      console.table(ab.overhead);
      for (const arm of ab.arms) {
        const rows = Object.entries(arm.timings ?? {});
        if (rows.length === 0) continue;
        console.log(`Thời gian từng vòng gọi Durable Object — nhánh ${arm.label}:`);
        console.table(Object.fromEntries(rows));
      }
      if (ab.usable) {
        console.log(
          'Chênh lệch trên là chi phí quota thương mại cộng thêm. Burst limit còn hoạt động hay không phải nghiệm thu riêng bằng `pnpm smoke:rate-limit`.',
        );
        return;
      }
      // Thoát khác 0: lượt đo này KHÔNG được chép vào evidence.
      for (const warning of ab.warnings) console.error(`⚠ ${warning}`);
      console.error('✗ Lượt đo không dùng được. Đừng ghi các con số trên vào evidence.');
      process.exitCode = 1;
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
