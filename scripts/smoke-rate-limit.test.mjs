import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertRateLimitTarget,
  runRateLimitSmoke,
  validateRateLimitSmoke,
} from './smoke-rate-limit.mjs';

/** @param {number} status @param {BodyInit | null} [body] @param {HeadersInit} [headers] */
const response = (status, body = '{}', headers = {}) => new Response(body, { status, headers });

describe('rate-limit production smoke', () => {
  it('tự nạp API key từ .env trước khi kiểm tra target production', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mapslibvn-rate-limit-'));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name !== 'MAPSLIBVN_API_KEY' && name !== 'KEY_EXAMPLE_EMBED',
      ),
    );
    writeFileSync(join(cwd, '.env'), 'KEY_EXAMPLE_EMBED=test-key\n');

    try {
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./smoke-rate-limit.mjs', import.meta.url))],
        { cwd, env, encoding: 'utf8' },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Production cần cờ --confirm-production');
      expect(result.stderr).not.toContain('Thiếu MAPSLIBVN_API_KEY');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('chấp nhận overshoot nhỏ nhưng bắt buộc thấy 429 đúng contract', async () => {
    const replies = [
      response(200), // warm cache trước khi đo
      response(200),
      response(200),
      response(429, JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), {
        'retry-after': '60',
      }),
    ];
    const summary = await runRateLimitSmoke('https://api.test', 'secret', 3, {
      fetchImpl: async () => replies.shift() ?? response(500),
    });

    expect(summary).toEqual({
      requests: 3,
      allowed: 2,
      rateLimited: 1,
      unexpected: 0,
      first429: 3,
      retryAfter: ['60'],
      codes: ['rate_limit_exceeded'],
    });
    expect(() => validateRateLimitSmoke(summary)).not.toThrow();
  });

  it('fail nếu không quan sát được 429', () => {
    expect(() =>
      validateRateLimitSmoke({
        requests: 75,
        allowed: 75,
        rateLimited: 0,
        unexpected: 0,
        first429: null,
        retryAfter: [],
        codes: [],
      }),
    ).toThrow('không quan sát được HTTP 429');
  });

  it('fail nếu 429 sai error code hoặc Retry-After', () => {
    expect(() =>
      validateRateLimitSmoke({
        requests: 75,
        allowed: 60,
        rateLimited: 15,
        unexpected: 0,
        first429: 61,
        retryAfter: ['30'],
        codes: ['quota_exceeded'],
      }),
    ).toThrow('429 sai contract');
  });

  it('bắt buộc xác nhận rõ khi nhắm production', () => {
    expect(() => assertRateLimitTarget('https://api.ai-solutions.io.vn', [])).toThrow(
      'Production cần cờ --confirm-production',
    );
    expect(() =>
      assertRateLimitTarget('https://api.ai-solutions.io.vn', ['--confirm-production']),
    ).not.toThrow();
    expect(() => assertRateLimitTarget('http://localhost:8787', [])).not.toThrow();
  });
});
