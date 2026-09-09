import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;
const post = (headers: Record<string, string>) =>
  SELF.fetch('https://api/v1/admin/edits/1/approve', { method: 'POST', headers });

describe('chống CSRF cho POST /v1/admin/* (audit 09/09/2026)', () => {
  it('Sec-Fetch-Site: cross-site → 403 cross_site_request, chặn trước cả bước kiểm JWT', async () => {
    const response = await post({ 'Sec-Fetch-Site': 'cross-site' });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('cross_site_request');
  });

  it('Origin khác origin của request → 403 cross_site_request', async () => {
    const response = await post({ Origin: 'https://evil.test' });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('cross_site_request');
  });

  it('same-origin (Sec-Fetch-Site + Origin khớp) nhưng thiếu JWT → vẫn 401 missing_access_jwt', async () => {
    const response = await post({ 'Sec-Fetch-Site': 'same-origin', Origin: 'https://api' });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('GET danh sách không bị chặn bởi kiểm CSRF (chỉ POST) — thiếu JWT → 401', async () => {
    const response = await SELF.fetch('https://api/v1/admin/edits', {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(response.status).toBe(401);
  });
});
