import assert from 'node:assert/strict';

const base = 'https://api.ai-solutions.io.vn';
const key = process.env.MAPSLIBVN_API_KEY;
if (!key) throw new Error('Missing MAPSLIBVN_API_KEY');

const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
const places = Array.from({ length: 10 }, (_, index) =>
  `${base}/v1/autocomplete?${new URLSearchParams({ q: ['cafe', 'highlands', 'ben thanh'][index % 3], near: `${(10.70 + index * .008).toFixed(4)},106.7000` })}`,
);
const directions = Array.from({ length: 4 }, (_, index) =>
  `${base}/v1/directions?${new URLSearchParams({ from: '10.7769,106.7009', to: `${(10.79 + index * .001).toFixed(4)},106.6800`, mode: 'motorbike' })}`,
);

async function request(group, url) {
  const started = performance.now();
  try {
    const response = await fetch(url, { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer();
    return { group, status: response.status, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { group, status: 0, ms: Math.round(performance.now() - started), error: error instanceof Error ? error.name : String(error) };
  }
}

const started = performance.now();
const samples = await Promise.all([
  ...places.map((url) => request('places', url)),
  ...directions.map((url) => request('directions', url)),
]);
assert.equal(samples.filter(({ status }) => status === 200).length, samples.length);
const health = await Promise.all(['/healthz', '/healthz/db', '/healthz/routing'].map(async (path) => {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5_000) });
  await response.arrayBuffer();
  return { path, status: response.status };
}));
assert.ok(health.every(({ status }) => status === 200));

console.log(JSON.stringify({
  at: new Date().toISOString(),
  concurrency: samples.length,
  mix: { places: places.length, directions: directions.length },
  elapsedMs: Math.round(performance.now() - started),
  p95Ms: percentile(samples.map(({ ms }) => ms), .95),
  p99Ms: percentile(samples.map(({ ms }) => ms), .99),
  statuses: samples.reduce((counts, { status }) => ({ ...counts, [status]: (counts[status] ?? 0) + 1 }), {}),
  byGroup: Object.fromEntries(['places', 'directions'].map((group) => {
    const groupSamples = samples.filter((sample) => sample.group === group);
    return [group, { count: groupSamples.length, p95Ms: percentile(groupSamples.map(({ ms }) => ms), .95) }];
  })),
  health,
}));
