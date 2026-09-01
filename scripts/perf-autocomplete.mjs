#!/usr/bin/env node
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

/**
 * Đo autocomplete từ máy hiện tại; fetch/clock có thể thay bằng test double.
 * @param {string} base
 * @param {string} key
 * @param {{ count?: number, fetchImpl?: typeof fetch, now?: () => number }} [options]
 */
export async function measureAutocomplete(
  base,
  key,
  { count = 100, fetchImpl = fetch, now = () => performance.now() } = {},
) {
  if (!Number.isInteger(count) || count < 1) throw new Error('count phải là số nguyên dương');
  const normalizedBase = base.replace(/\/+$/, '');
  const samples = [];
  for (let i = 0; i < count; i++) {
    const q = QUERIES[i % QUERIES.length];
    if (q === undefined) throw new Error('Không có query để đo');
    const t0 = now();
    const res = await fetchImpl(
      `${normalizedBase}/v1/autocomplete?q=${encodeURIComponent(q)}&near=10.776,106.700`,
      { headers: { 'X-Api-Key': key } },
    );
    await res.arrayBuffer();
    const elapsed = now() - t0;
    if (!res.ok) throw new Error(`lần ${i + 1}: HTTP ${res.status}`);
    samples.push({
      index: i + 1,
      query: q,
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
  return { n: times.length, p50: pct(50), p95: pct(95), p99: pct(99), slowest };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [base, key] = process.argv.slice(2);
  if (!base || !key) {
    console.error('Cách dùng: node scripts/perf-autocomplete.mjs <base-url> <api-key>');
    process.exitCode = 1;
  } else {
    try {
      const result = await measureAutocomplete(base, key);
      console.log(`n=${result.n} p50=${result.p50}ms p95=${result.p95}ms p99=${result.p99}ms`);
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
