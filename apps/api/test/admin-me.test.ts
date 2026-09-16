import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /v1/admin/me', () => {
  it('thiếu JWT Access → 401 missing_access_jwt', async () => {
    const response = await SELF.fetch('https://api/v1/admin/me');
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('missing_access_jwt');
  });
});
