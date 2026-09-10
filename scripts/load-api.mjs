#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const DEFAULT_LEVELS = [10, 25, 50, 100];
const QUERIES = ['highlands', 'cafe', 'nguyen hue', 'pharmacity', 'ben thanh'];

/** @param {number[]} sorted @param {number} p */
const percentile = (sorted, p) =>
  sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

/**
 * Một wave: mỗi virtual user gửi đúng một request cùng lúc.
 * @param {string} base @param {string} key @param {number} users
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function runLevel(base, key, users, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const started = performance.now();
  const samples = await Promise.all(
    Array.from({ length: users }, async (_, index) => {
      const q = QUERIES[index % QUERIES.length] ?? 'cafe';
      // Mỗi VU dùng một ô cache 0,05° khác nhau để đo đường DB thay vì vô tình benchmark cache-hit.
      const cell = users * 101 + index;
      const near = `${8 + (cell % 100) * 0.1},${102 + (Math.floor(cell / 100) % 70) * 0.1}`;
      const t0 = performance.now();
      try {
        const response = await fetchImpl(
          `${base.replace(/\/+$/, '')}/v1/autocomplete?q=${encodeURIComponent(q)}&near=${near}`,
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
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function runRamp(base, key, levels = DEFAULT_LEVELS, options = {}) {
  const results = [];
  for (const users of levels) {
    const level = await runLevel(base, key, users, options);
    results.push(level);
    if (level.errors > 0) return { levels: results, stopped: true };
  }
  return { levels: results, stopped: false };
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
  const levels = (arg('levels') ?? DEFAULT_LEVELS.join(',')).split(',').map(Number);
  if (levels.some((value) => !Number.isInteger(value) || value < 1 || value > 100)) {
    throw new Error('Mỗi level phải là số nguyên 1–100');
  }
  const result = await runRamp(base, key, levels);
  console.table(result.levels);
  if (result.stopped) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
