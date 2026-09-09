import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedKey, sha256Hex } from './helpers/seed-key';

const KEY = 'mlv_live_hash00000000000000000000';
const call = (headers: Record<string, string>) =>
  SELF.fetch('https://api/v1/autocomplete?q=highlands', { headers });
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('auth tra khoá theo sha256 — DB và KV không giữ khoá plaintext (audit 09/09/2026)', () => {
  it('entry KV dưới apikey:<sha256(key)> được nhận: scope sai → 403 chứng tỏ đã tìm thấy', async () => {
    await seedKey(KEY, { scopes: ['edits:write'] });
    const response = await call({ 'X-Api-Key': KEY });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('scope');
  });

  it('entry KV theo khoá plaintext (sơ đồ cũ) KHÔNG còn được nhận → rơi xuống DB đóng = 503', async () => {
    const other = 'mlv_live_plain0000000000000000000';
    await env.META.put(
      `apikey:${other}`,
      JSON.stringify({
        keyHash: await sha256Hex(other),
        keyPrefix: other.slice(0, 17),
        tenantId: 't',
        plan: 'internal',
        kind: 'server',
        scopes: ['edits:write'],
        allowedOrigins: [],
        quotaPlacesPerDay: null,
      }),
    );
    const response = await call({ 'X-Api-Key': other });
    expect(response.status).toBe(503);
  });

  it('khoá chỉ nhận qua header X-Api-Key, không nhận ?key= trên URL (lọt log/Referer)', async () => {
    await seedKey(KEY, { scopes: ['edits:write'] });
    const response = await SELF.fetch(`https://api/v1/autocomplete?q=highlands&key=${KEY}`);
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_key');
  });
});
