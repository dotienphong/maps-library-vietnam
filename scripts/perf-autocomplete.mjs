#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const QUERIES = [
  'highlands',
  'pho co',
  'cafe',
  'truong tieu hoc',
  'nguyen hue',
  'ben thanh',
  'circle k',
  'pharmacity',
  'bun bo',
  'coop mart',
];

// Registry nguồn POI (POI_SOURCE_PROFILES trong @mapslibvn/core) chỉ còn hai profile riêng để so
// cohort; `osm,fsq` là profile `all` nên không nhận ở đây. Không import core: script chạy trước build.
const POI_SOURCE_ORDER = ['osm', 'fsq'];
const PAIRED_SOURCE_PROFILES = new Set(['osm', 'fsq']);

/** @param {string} raw */
function normalizePairedSources(raw) {
  const requested = new Set(
    raw
      .split(',')
      .map((source) => source.trim())
      .filter(Boolean),
  );
  const invalid = [...requested].filter((source) => !POI_SOURCE_ORDER.includes(source));
  const normalized = POI_SOURCE_ORDER.filter((source) => requested.has(source)).join(',');
  if (invalid.length > 0 || !PAIRED_SOURCE_PROFILES.has(normalized)) {
    throw new Error(`sources không hợp lệ: ${raw}`);
  }
  return normalized;
}

/** Bỏ dấu + lowercase để so đích (không import @mapslibvn/core: script chạy trước khi build). */
const fold = (/** @type {string} */ s) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/**
 * Đọc fixture `q|đích` (dòng `#` và rỗng bị bỏ). Nhiều cách viết được chấp nhận thì ngăn bằng `;`
 * — dòng trúng khi **bất kỳ** cách viết nào nằm trong top 3.
 *
 * Danh sách nhiều đích có từ 08/09/2026 (PHONG duyệt): với một số địa danh, API trả **đúng địa
 * phương** nhưng tên POI viết theo cách người dùng gõ (`Đắc Lắc`, `Bắc Cạn`, `Saigon`) chứ không
 * viết dạng chuẩn. Mỗi cách viết thêm phải được liệt kê **tường minh** cho từng dòng, không suy
 * bằng luật — nếu so bằng khoá ngữ âm thì "Bánh Mì Thổ Nhĩ Kỳ" sẽ tính là trúng cho `mi tho`,
 * mà đó là tiệm kebab chứ không phải Mỹ Tho.
 *
 * @param {string} text
 * @returns {{ q: string, expect: string[] }[]}
 */
export function parseQueryFixture(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [q, expect = ''] = line.split('|').map((part) => part.trim());
      if (!q) throw new Error(`Dòng fixture thiếu q: "${line}"`);
      return {
        q,
        expect: expect
          .split(';')
          .map((part) => part.trim())
          .filter(Boolean),
      };
    });
}

/**
 * Đo autocomplete từ máy hiện tại; fetch/clock có thể thay bằng test double.
 * @param {string} base
 * @param {string} key
 * @param {{ count?: number, fetchImpl?: typeof fetch, now?: () => number,
 *   queries?: { q: string, expect: string | string[] }[], near?: string, types?: string }} [options]
 */
export async function measureAutocomplete(
  base,
  key,
  {
    count = 100,
    fetchImpl = fetch,
    now = () => performance.now(),
    queries = QUERIES.map((q) => ({ q, expect: '' })),
    near = '10.776,106.700',
    // Bỏ trống = dùng types mặc định của API. Truyền 'poi,street,address' để so với bộ loại
    // trước khi có `area`, tách chi phí của area khỏi hồi quy không liên quan (plan 8.5).
    types = '',
  } = {},
) {
  if (!Number.isInteger(count) || count < 1) throw new Error('count phải là số nguyên dương');
  if (queries.length === 0) throw new Error('Không có query để đo');
  const normalizedBase = base.replace(/\/+$/, '');
  const samples = [];
  let hit = 0;
  let judged = 0;
  /** @type {string[]} */
  const misses = [];
  for (let i = 0; i < count; i++) {
    const entry = queries[i % queries.length];
    if (entry === undefined) throw new Error('Không có query để đo');
    const t0 = now();
    const typesParam = types ? `&types=${encodeURIComponent(types)}` : '';
    const res = await fetchImpl(
      `${normalizedBase}/v1/autocomplete?q=${encodeURIComponent(entry.q)}&near=${near}${typesParam}`,
      { headers: { 'X-Api-Key': key } },
    );
    const body = await res.text();
    const elapsed = now() - t0;
    if (!res.ok) throw new Error(`lần ${i + 1}: HTTP ${res.status}`);
    const expects = Array.isArray(entry.expect) ? entry.expect : entry.expect ? [entry.expect] : [];
    if (expects.length > 0 && i < queries.length) {
      judged++;
      /** @type {{ items?: { name: string }[] }} */
      const json = JSON.parse(body);
      const top3 = (json.items ?? []).slice(0, 3).map((item) => fold(item.name));
      if (top3.some((name) => expects.some((want) => name.includes(fold(want))))) hit++;
      else misses.push(entry.q);
    }
    samples.push({
      index: i + 1,
      query: entry.q,
      ms: elapsed,
      cache: res.headers.get('x-mlv-cache') ?? 'miss',
      colo: res.headers.get('cf-ray')?.split('-').at(-1) ?? '',
    });
  }
  const stats = summarize(samples);
  const slowest = samples
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .map(({ index, query, ms, cache, colo }) => ({
      index,
      query,
      ms: Math.round(ms),
      cache,
      colo,
    }));
  return {
    ...stats,
    slowest,
    ...(judged ? { hit3: { hit, total: judged, misses } } : {}),
  };
}

/**
 * Tóm tắt percentile cho một nhóm sample.
 * @param {{ ms: number }[]} group
 */
function summarize(group) {
  const times = group.map(({ ms }) => ms).sort((a, b) => a - b);
  /** @param {number} p */
  const pct = (p) => {
    const value = times[Math.ceil((p / 100) * times.length) - 1];
    if (value === undefined) throw new Error('Không có sample để tính percentile');
    return Math.round(value);
  };
  return { n: times.length, p50: pct(50), p95: pct(95), p99: pct(99) };
}

/**
 * Gom sample theo một khoá rồi tóm tắt từng nhóm.
 * @param {{ ms: number, cache: string, colo: string }[]} samples
 * @param {(sample: { ms: number, cache: string, colo: string }) => string} keyOf
 * @returns {Record<string, { n: number, p50: number, p95: number, p99: number }>}
 */
function summarizeBy(samples, keyOf) {
  /** @type {Map<string, { ms: number, cache: string, colo: string }[]>} */
  const groups = new Map();
  for (const sample of samples) {
    const key = keyOf(sample);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(sample);
    else groups.set(key, [sample]);
  }
  /** @type {Record<string, { n: number, p50: number, p95: number, p99: number }>} */
  const out = {};
  for (const [key, group] of groups) out[key] = summarize(group);
  return out;
}

/**
 * Đo nhiều cohort `types` **xen kẽ trên cùng một query**: cả hai cohort đi liền nhau nên gặp
 * cùng điều kiện mạng và cùng phân bố colo. Kết quả tách theo trạng thái cache và theo colo,
 * vì lần đo 07/09 chạy tuần tự đã rơi vào hai colo khác nhau và p95 bị cache lạnh chi phối
 * (plan 8.5). Cache key của API có `typeKey` nên hai cohort không dùng chung entry.
 *
 * @param {string} base
 * @param {string} key
 * @param {{ cohorts: { label: string, types?: string, sources?: string }[],
 *   queries: { q: string, expect: string | string[] }[], rounds?: number,
 *   fetchImpl?: typeof fetch, now?: () => number, near?: string }} options
 */
export async function measurePairedCohorts(
  base,
  key,
  {
    cohorts,
    queries,
    rounds = 1,
    fetchImpl = fetch,
    now = () => performance.now(),
    near = '10.776,106.700',
  },
) {
  if (cohorts.length === 0) throw new Error('Không có cohort để đo');
  if (queries.length === 0) throw new Error('Không có query để đo');
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('rounds phải là số nguyên dương');
  const normalizedBase = base.replace(/\/+$/, '');
  /** @type {Map<string, { query: string, ms: number, cache: string, colo: string }[]>} */
  const byLabel = new Map(cohorts.map(({ label }) => [label, []]));

  let pairIndex = 0;
  for (let round = 0; round < rounds; round++) {
    for (const entry of queries) {
      // Đảo thứ tự mỗi cặp: request đầu tiên của một cặp cold phải trả chi phí khởi động
      // worker/Hyperdrive, nếu luôn là cùng một cohort thì sai lệch đó cộng dồn vào nó.
      const order = pairIndex++ % 2 === 0 ? cohorts : [...cohorts].reverse();
      for (const cohort of order) {
        const typesParam = cohort.types ? `&types=${encodeURIComponent(cohort.types)}` : '';
        const sourcesParam = cohort.sources ? `&sources=${encodeURIComponent(cohort.sources)}` : '';
        const t0 = now();
        const res = await fetchImpl(
          `${normalizedBase}/v1/autocomplete?q=${encodeURIComponent(entry.q)}&near=${near}${typesParam}${sourcesParam}`,
          { headers: { 'X-Api-Key': key } },
        );
        await res.text();
        const ms = now() - t0;
        if (!res.ok) {
          throw new Error(`${cohort.label} vòng ${round + 1} "${entry.q}": HTTP ${res.status}`);
        }
        const bucket = byLabel.get(cohort.label);
        if (!bucket) throw new Error(`Cohort trùng nhãn: ${cohort.label}`);
        bucket.push({
          query: entry.q,
          ms,
          cache: res.headers.get('x-mlv-cache') ?? 'miss',
          colo: res.headers.get('cf-ray')?.split('-').at(-1) ?? '',
        });
      }
    }
  }

  return {
    cohorts: cohorts.map(({ label, types, sources }) => {
      const samples = byLabel.get(label);
      if (!samples) throw new Error(`Thiếu sample cho cohort ${label}`);
      return {
        label,
        ...(types === undefined ? {} : { types }),
        ...(sources === undefined ? {} : { sources }),
        ...summarize(samples),
        byCache: summarizeBy(samples, ({ cache }) => cache),
        byColo: summarizeBy(samples, ({ colo }) => colo),
      };
    }),
  };
}

/**
 * Tách đối số CLI. Cờ có giá trị chỉ "tiêu thụ" ô kế tiếp khi cờ thực sự có mặt — indexOf trả
 * -1 thì -1+1=0 sẽ ăn mất base-url ở vị trí 0.
 * @param {string[]} args
 */
export function parseCliArgs(args) {
  /** @type {Set<number>} */
  const consumed = new Set();
  /** @param {string} flag */
  const flagValue = (flag) => {
    const at = args.indexOf(flag);
    if (at < 0) return undefined;
    consumed.add(at);
    consumed.add(at + 1);
    return args[at + 1];
  };
  /** @param {string} flag */
  const hasFlag = (flag) => {
    const at = args.indexOf(flag);
    if (at < 0) return false;
    consumed.add(at);
    return true;
  };
  /** @param {string} flag @param {string} fallback */
  const optionalFlagValue = (flag, fallback) => {
    const at = args.indexOf(flag);
    if (at < 0) return undefined;
    consumed.add(at);
    const value = args[at + 1];
    if (value === undefined || value.startsWith('--')) return fallback;
    consumed.add(at + 1);
    return value;
  };

  const queriesFile = flagValue('--queries');
  const types = flagValue('--types');
  const roundsArg = flagValue('--rounds');
  const near = flagValue('--near');
  const paired = hasFlag('--paired');
  const pairedSourcesArg = optionalFlagValue('--paired-sources', 'osm');
  const pairedSources =
    pairedSourcesArg === undefined ? undefined : normalizePairedSources(pairedSourcesArg);
  const [base, key] = args.filter((_, i) => !consumed.has(i));
  const rounds = roundsArg === undefined ? undefined : Number(roundsArg);
  return {
    base,
    key,
    queriesFile,
    types,
    near,
    paired,
    pairedSources,
    ...(rounds === undefined ? {} : { rounds }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const {
    base,
    key,
    queriesFile,
    types: typesArg,
    near,
    paired,
    pairedSources,
    rounds,
  } = parseCliArgs(process.argv.slice(2));
  if (!base || !key) {
    console.error(
      'Cách dùng: node scripts/perf-autocomplete.mjs <base-url> <api-key> [--queries scripts/fixtures/fuzzy-queries.txt] [--types poi,street,address] [--paired | --paired-sources [osm|fsq] [--rounds N]] [--near lat,lng]',
    );
    process.exitCode = 1;
  } else {
    try {
      const queries = queriesFile
        ? parseQueryFixture(readFileSync(queriesFile, 'utf8'))
        : undefined;
      if (paired || pairedSources !== undefined) {
        // Cohort mặc định (có `area`) so với bộ loại trước khi có `area`, xen kẽ từng query.
        const result = await measurePairedCohorts(base, key, {
          cohorts: pairedSources
            ? [
                { label: pairedSources, sources: pairedSources },
                { label: 'all', sources: 'all' },
              ]
            : [
                { label: 'default', types: '' },
                { label: 'legacy', types: 'poi,street,address' },
              ],
          ...(queries ? { queries } : { queries: QUERIES.map((q) => ({ q, expect: '' })) }),
          ...(rounds ? { rounds } : {}),
          ...(near ? { near } : {}),
        });
        for (const cohort of result.cohorts) {
          console.log(
            `[${cohort.label}] n=${cohort.n} p50=${cohort.p50}ms p95=${cohort.p95}ms p99=${cohort.p99}ms`,
          );
          for (const [state, stats] of Object.entries(cohort.byCache)) {
            console.log(
              `  cache=${state}: n=${stats.n} p50=${stats.p50}ms p95=${stats.p95}ms p99=${stats.p99}ms`,
            );
          }
          for (const [colo, stats] of Object.entries(cohort.byColo)) {
            console.log(
              `  colo=${colo}: n=${stats.n} p50=${stats.p50}ms p95=${stats.p95}ms p99=${stats.p99}ms`,
            );
          }
        }
        console.log(JSON.stringify(result));
      } else {
        const result = await measureAutocomplete(base, key, {
          ...(queries ? { queries, count: queries.length * 2 } : {}),
          ...(typesArg ? { types: typesArg } : {}),
        });
        console.log(`n=${result.n} p50=${result.p50}ms p95=${result.p95}ms p99=${result.p99}ms`);
        if (result.hit3) {
          console.log(
            `hit@3=${result.hit3.hit}/${result.hit3.total}${result.hit3.misses.length ? ` miss: ${result.hit3.misses.join(', ')}` : ''}`,
          );
        }
        console.log(
          `slowest=${result.slowest
            .map(
              ({ index, query, ms, cache, colo }) =>
                `#${index} ${query}:${ms}ms cache=${cache}${colo ? ` colo=${colo}` : ''}`,
            )
            .join(', ')}`,
        );
        console.log(
          'Lưu ý: từ vòng lặp thứ 2 các query trùng sẽ hit cache 10 phút — giống hành vi client thật.',
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
