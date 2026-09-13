import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthInfo } from '../src/auth';
import { autocompleteCacheUrl } from '../src/routes/autocomplete';
import { seedKey as seedHashedKey } from './helpers/seed-key';

// Khoá giả nạp thẳng vào KV cache của auth — tầng test này không có Postgres.
const KEY = 'mlv_live_test00000000000000000000';
const seedKey = (overrides: Partial<AuthInfo> = {}) => seedHashedKey(KEY, overrides);
const url = (query: string) => `https://api/v1/autocomplete?${query}`;
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('GET /v1/autocomplete — auth + validation (không DB)', () => {
  beforeAll(() => seedKey());

  it('thiếu key → 401 missing_key', async () => {
    const response = await SELF.fetch(url('q=highlands'));
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_key');
  });

  it('key lạ (không có trong KV) + DB đóng → 503 upstream_unavailable', async () => {
    // Phải ĐÚNG dạng `mlv_live_` + 24 ký tự, nếu không `isApiKeyFormat` chặn ở 401 trước khi tới
    // DB và test mất ý nghĩa (khoá cũ ở đây chỉ có 23 ký tự).
    const response = await SELF.fetch(url('q=highlands'), {
      headers: { 'X-Api-Key': 'mlv_live_unknown00000000000000000' },
    });
    expect(response.status).toBe(503);
    expect(await code(response)).toBe('upstream_unavailable');
  });

  it('key web sai Origin → 403 origin_not_allowed', async () => {
    await seedKey({ kind: 'web', allowedOrigins: ['https://docs.example.com'] });
    const response = await SELF.fetch(url('q=highlands'), {
      headers: { 'X-Api-Key': KEY, Origin: 'https://evil.test' },
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('origin_not_allowed');
    await seedKey();
  });

  it('thiếu scope → 403 scope', async () => {
    await seedKey({ scopes: ['edits:write'] });
    const response = await SELF.fetch(url('q=highlands'), { headers: { 'X-Api-Key': KEY } });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('scope');
    await seedKey();
  });

  it('q < 2 ký tự → 400; near hỏng → 400; types lạ → 400', async () => {
    for (const query of [
      'q=a',
      'q=highlands&near=xx',
      'q=highlands&types=banana',
      'q=highlands&sources=banana',
    ]) {
      const response = await SELF.fetch(url(query), { headers: { 'X-Api-Key': KEY } });
      expect(response.status).toBe(400);
      expect(await code(response)).toBe('invalid_request');
    }
  });

  it('request hợp lệ + DB đóng → 503 (đi hết auth/validate, chết ở DB)', async () => {
    const response = await SELF.fetch(url('q=highlands&near=10.77,106.70'), {
      headers: { 'X-Api-Key': KEY },
    });
    expect(response.status).toBe(503);
    expect(await code(response)).toBe('upstream_unavailable');
  });

  it('cache key có version shape nguồn và khoá sources', () => {
    const url = autocompleteCacheUrl({
      queryNorm: 'quan 10',
      grid: '-',
      typeKey: 'area',
      sourceKey: 'osm_fsq',
      limit: 10,
    });
    // Đổi khi hình dạng item đổi: alt1 thêm trường matched_alt, cache cũ phải bị bỏ.
    expect(url).toContain('?v=alt1&');
    expect(url).toContain('&s=osm_fsq&');
  });
});
