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

/** Bỏ dấu + lowercase để so đích (không import @mapslibvn/core: script chạy trước khi build). */
const fold = (/** @type {string} */ s) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/**
 * Đọc fixture "q|đích" (dòng # và rỗng bị bỏ).
 * @param {string} text
 * @returns {{ q: string, expect: string }[]}
 */
export function parseQueryFixture(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [q, expect = ''] = line.split('|').map((part) => part.trim());
      if (!q) throw new Error(`Dòng fixture thiếu q: "${line}"`);
      return { q, expect };
    });
}

/**
 * Đo autocomplete từ máy hiện tại; fetch/clock có thể thay bằng test double.
 * @param {string} base
 * @param {string} key
 * @param {{ count?: number, fetchImpl?: typeof fetch, now?: () => number,
 *   queries?: { q: string, expect: string }[], near?: string }} [options]
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
    const res = await fetchImpl(
      `${normalizedBase}/v1/autocomplete?q=${encodeURIComponent(entry.q)}&near=${near}`,
      { headers: { 'X-Api-Key': key } },
    );
    const body = await res.text();
    const elapsed = now() - t0;
    if (!res.ok) throw new Error(`lần ${i + 1}: HTTP ${res.status}`);
    if (entry.expect && i < queries.length) {
      judged++;
      /** @type {{ items?: { name: string }[] }} */
      const json = JSON.parse(body);
      const top3 = (json.items ?? []).slice(0, 3).map((item) => fold(item.name));
      if (top3.some((name) => name.includes(fold(entry.expect)))) hit++;
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
  const times = samples.map(({ ms }) => ms);
  times.sort((a, b) => a - b);
  /** @param {number} p */
  const pct = (p) => {
    const value = times[Math.ceil((p / 100) * times.length) - 1];
    if (value === undefined) throw new Error('Không có sample để tính percentile');
    return Math.round(value);
  };
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
    n: times.length,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    slowest,
    ...(judged ? { hit3: { hit, total: judged, misses } } : {}),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const queriesIndex = args.indexOf('--queries');
  const queriesFile = queriesIndex >= 0 ? args[queriesIndex + 1] : undefined;
  const positional = args.filter((_, i) => i !== queriesIndex && i !== queriesIndex + 1);
  const [base, key] = positional;
  if (!base || !key) {
    console.error(
      'Cách dùng: node scripts/perf-autocomplete.mjs <base-url> <api-key> [--queries scripts/fixtures/fuzzy-queries.txt]',
    );
    process.exitCode = 1;
  } else {
    try {
      const queries = queriesFile
        ? parseQueryFixture(readFileSync(queriesFile, 'utf8'))
        : undefined;
      const result = await measureAutocomplete(base, key, {
        ...(queries ? { queries, count: queries.length * 2 } : {}),
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
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
