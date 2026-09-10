#!/usr/bin/env node
import 'dotenv/config';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE = 'https://api.ai-solutions.io.vn';
const DEFAULT_REQUESTS = 75;
const SMOKE_PATH = '/v1/autocomplete?q=highlands&near=10.776,106.700';

/**
 * Warm cache một lần rồi gửi tuần tự để tránh biến smoke chống burst thành load test DB lạnh.
 * @param {string} base
 * @param {string} key
 * @param {number} requests
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function runRateLimitSmoke(base, key, requests = DEFAULT_REQUESTS, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const url = `${base.replace(/\/+$/, '')}${SMOKE_PATH}`;
  const request = () =>
    fetchImpl(url, {
      headers: { 'X-Api-Key': key },
      signal: AbortSignal.timeout(timeoutMs),
    });

  const warm = await request();
  await warm.arrayBuffer();
  if (warm.status < 200 || warm.status >= 400) {
    throw new Error(`Warm cache thất bại với HTTP ${warm.status}; đợi hết cửa sổ rồi chạy lại`);
  }

  const samples = [];
  for (let index = 0; index < requests; index++) {
    try {
      const response = await request();
      let code = '';
      if (response.status === 429) {
        try {
          const body = await response.json();
          code = body?.error?.code ?? '';
        } catch {
          code = 'invalid_json';
        }
      } else {
        await response.arrayBuffer();
      }
      samples.push({
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
        code,
      });
    } catch {
      samples.push({ status: 0, retryAfter: null, code: '' });
    }
  }

  const first429 = samples.findIndex(({ status }) => status === 429);
  return {
    requests,
    allowed: samples.filter(({ status }) => status >= 200 && status < 400).length,
    rateLimited: samples.filter(({ status }) => status === 429).length,
    unexpected: samples.filter(
      ({ status }) => status === 0 || status >= 500 || (status >= 400 && status !== 429),
    ).length,
    first429: first429 === -1 ? null : first429 + 1,
    retryAfter: [...new Set(samples.flatMap(({ retryAfter }) => (retryAfter ? [retryAfter] : [])))],
    codes: [...new Set(samples.flatMap(({ code }) => (code ? [code] : [])))],
  };
}

/** @param {Awaited<ReturnType<typeof runRateLimitSmoke>>} summary */
export function validateRateLimitSmoke(summary) {
  if (summary.unexpected > 0) {
    throw new Error(`Có ${summary.unexpected} response timeout/4xx/5xx bất ngờ`);
  }
  if (summary.allowed === 0) {
    throw new Error('Không có request nào được cho qua; có thể counter cũ chưa hết cửa sổ');
  }
  if (summary.rateLimited === 0) {
    throw new Error('Burst gate thất bại: không quan sát được HTTP 429');
  }
  if (
    summary.codes.length !== 1 ||
    summary.codes[0] !== 'rate_limit_exceeded' ||
    summary.retryAfter.length !== 1 ||
    summary.retryAfter[0] !== '60'
  ) {
    throw new Error(
      `429 sai contract: codes=${summary.codes.join(',')}; Retry-After=${summary.retryAfter.join(',')}`,
    );
  }
}

/** @param {string} base @param {string[]} argv */
export function assertRateLimitTarget(base, argv) {
  if (
    new URL(base).hostname === new URL(DEFAULT_BASE).hostname &&
    !argv.includes('--confirm-production')
  ) {
    throw new Error('Production cần cờ --confirm-production');
  }
}

/** @param {string} name */
function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const base = arg('base') ?? DEFAULT_BASE;
  const key = process.env.MAPSLIBVN_API_KEY ?? process.env.KEY_EXAMPLE_EMBED;
  if (!key) {
    throw new Error('Thiếu MAPSLIBVN_API_KEY hoặc KEY_EXAMPLE_EMBED trong môi trường');
  }
  assertRateLimitTarget(base, process.argv);
  const requests = Number(arg('requests') ?? DEFAULT_REQUESTS);
  if (!Number.isInteger(requests) || requests < 1 || requests > 100) {
    throw new Error('--requests phải là số nguyên từ 1 đến 100');
  }

  const summary = await runRateLimitSmoke(base, key, requests);
  console.table(summary);
  validateRateLimitSmoke(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
