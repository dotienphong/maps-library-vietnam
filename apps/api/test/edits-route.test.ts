import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthInfo } from '../src/auth';
import { seedKey as seedHashedKey } from './helpers/seed-key';

// Khoá giả nạp thẳng vào KV cache của auth — tầng test này không có Postgres.
const KEY = 'mlv_live_test00000000000000000000';
const seedKey = (overrides: Partial<AuthInfo> = {}) =>
  seedHashedKey(KEY, { scopes: ['places:read', 'edits:write'], ...overrides });
const post = (body: unknown, headers: Record<string, string> = { 'X-Api-Key': KEY }) =>
  SELF.fetch('https://api/v1/edits', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('POST /v1/edits — auth + validation (không DB)', () => {
  beforeAll(() => seedKey());

  it('thiếu key → 401 missing_key', async () => {
    const response = await post({ kind: 'close', poi_id: 'x', end_user_token: 'u' }, {});
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_key');
  });

  it('key không có scope edits:write → 403 scope', async () => {
    await seedKey({ scopes: ['places:read'] });
    const response = await post({ kind: 'close', poi_id: 'x', end_user_token: 'u' });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('scope');
    await seedKey();
  });

  it('body không phải JSON → 400 invalid_request', async () => {
    const response = await SELF.fetch('https://api/v1/edits', {
      method: 'POST',
      headers: { 'X-Api-Key': KEY },
      body: 'not-json',
    });
    expect(response.status).toBe(400);
    expect(await code(response)).toBe('invalid_request');
  });

  it('kind lạ / thiếu end_user_token → 400 trước khi chạm DB', async () => {
    expect((await post({ kind: 'delete', poi_id: 'x', end_user_token: 'u' })).status).toBe(400);
    expect((await post({ kind: 'close', poi_id: 'x' })).status).toBe(400);
  });

  it('body hợp lệ + DB đóng → 503 upstream_unavailable (đã qua validate)', async () => {
    const response = await post({
      kind: 'update',
      poi_id: '01ABC',
      end_user_token: 'u',
      changes: { hours: 'Mo-Su 08:00-21:00' },
    });
    expect(response.status).toBe(503);
    expect(await code(response)).toBe('upstream_unavailable');
  });

  it('khoá web có edits:write nhưng request không mang Origin/Referer → 403 origin_required', async () => {
    // Khoá web nằm trong HTML của khách nên coi như công khai; với quyền GHI phải chứng minh
    // request đến từ trang được phép, không cho gọi từ curl/server lạ (audit 09/09/2026).
    await seedKey({ kind: 'web', allowedOrigins: ['https://app.test'] });
    const response = await post({ kind: 'close', poi_id: 'x', end_user_token: 'u' });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('origin_required');
    await seedKey();
  });

  it('khoá web có edits:write + Origin hợp lệ → qua auth, chết ở DB đóng = 503', async () => {
    await seedKey({ kind: 'web', allowedOrigins: ['https://app.test'] });
    const response = await post(
      { kind: 'close', poi_id: 'x', end_user_token: 'u' },
      { 'X-Api-Key': KEY, Origin: 'https://app.test' },
    );
    expect(response.status).toBe(503);
    await seedKey();
  });

  it('route places cũ vẫn giữ scope places:read', async () => {
    await seedKey({ scopes: ['edits:write'] });
    const response = await SELF.fetch('https://api/v1/autocomplete?q=highlands', {
      headers: { 'X-Api-Key': KEY },
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('scope');
    await seedKey();
  });
});
