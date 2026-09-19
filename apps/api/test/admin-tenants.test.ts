import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

const UUID = '11111111-1111-4111-8111-111111111111';

describe('cổng vào của nhóm route tenant', () => {
  it('GET danh sách thiếu JWT Access → 401', async () => {
    const response = await SELF.fetch('https://api/v1/admin/tenants');
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('GET chi tiết thiếu JWT Access → 401', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/tenants/${UUID}`);
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('POST cấp khoá từ trang lạ → 403 cross_site_request, chặn TRƯỚC cả bước kiểm JWT', async () => {
    // Cấp khoá là thao tác tạo bí mật mới. Nếu CSRF lọt, một trang bất kỳ có thể mượn cookie
    // Access của người đang đăng nhập để tự cấp khoá cho mình.
    const response = await SELF.fetch(`https://api/v1/admin/tenants/${UUID}/keys`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('cross_site_request');
  });

  it('POST same-origin nhưng thiếu JWT → 401', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/tenants/${UUID}/keys`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://api' },
    });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });
});

describe('cổng vào của DELETE tenant', () => {
  it('DELETE từ trang lạ → 403 cross_site_request, chặn TRƯỚC cả bước kiểm JWT', async () => {
    // Xoá tenant là thao tác không lùi lại được. Nếu CSRF lọt, một trang bất kỳ có thể mượn
    // cookie Access của người đang đăng nhập để xoá sạch một tổ chức.
    const response = await SELF.fetch(`https://api/v1/admin/tenants/${UUID}`, {
      method: 'DELETE',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('cross_site_request');
  });

  it('DELETE same-origin nhưng thiếu JWT → 401', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/tenants/${UUID}`, {
      method: 'DELETE',
      headers: { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://api' },
    });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });
});
