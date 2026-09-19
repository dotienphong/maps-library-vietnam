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

describe('cổng chống CSRF phải chặn MỌI phương thức ghi, không riêng POST', () => {
  // Bản đầu chỉ kiểm POST. Đủ an toàn chừng nào chưa có route nào dùng phương thức khác — nhưng
  // PATCH /v1/console/tenant và DELETE /v1/admin/tenants/:id đã phá vỡ giả định đó.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    it(`${method} cross-site → 403 cross_site_request`, async () => {
      const response = await SELF.fetch('https://api/v1/admin/tenants/x', {
        method,
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      });
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'cross_site_request',
      );
    });
  }

  it('GET cross-site KHÔNG bị chặn ở cổng này — nó không đổi gì', async () => {
    const response = await SELF.fetch('https://api/v1/admin/tenants', {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    // Rơi vào cổng xác thực chứ không phải cổng CSRF.
    expect(response.status).toBe(401);
  });

  it('PATCH cross-site vào cổng khách hàng cũng bị chặn', async () => {
    const response = await SELF.fetch('https://api/v1/console/tenant', {
      method: 'PATCH',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'cross_site_request',
    );
  });
});
