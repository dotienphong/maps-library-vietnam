import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

/**
 * Nhóm billing nằm NGOÀI app `admin` (nó mount ở index.ts trước), nên cổng chống CSRF khai trong
 * app đó không chạy cho nhóm này: đo ngày 16/09/2026 thấy POST cross-site trả 401 chứ không 403,
 * tức lớp duy nhất còn lại là cookie Access — thứ mà chính CSRF lợi dụng. Pha 3 đưa lệnh cấp gói
 * và cộng credit lên trình duyệt nên khoảng hở này phải đóng.
 */
describe('chống CSRF cho POST /v1/admin/billing/*', () => {
  it('Sec-Fetch-Site: cross-site → 403 cross_site_request, chặn TRƯỚC cả bước kiểm JWT', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/billing/${TENANT}/commands`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('cross_site_request');
  });

  it('Origin lạ → 403 cross_site_request', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/billing/${TENANT}/mode`, {
      method: 'POST',
      headers: { Origin: 'https://evil.test' },
      body: '{"mode":"legacy"}',
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('cross_site_request');
  });

  it('same-origin nhưng thiếu JWT → vẫn 401: cổng CSRF không thay thế Access', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/billing/${TENANT}/commands`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://api' },
      body: '{}',
    });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('GET không bị cổng CSRF chặn (chỉ POST) — thiếu JWT → 401', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/billing/${TENANT}/usage`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(response.status).toBe(401);
  });

  it('công cụ dòng lệnh không gửi Origin/Sec-Fetch-Site vẫn qua cổng (quota-audit.mjs)', async () => {
    // pnpm audit:quota gọi các route backup từ Node, không có hai header đó. Cổng chỉ chặn khi
    // trình duyệt TỰ KHAI là cross-site; vắng mặt không bị coi là vi phạm.
    const response = await SELF.fetch(`https://api/v1/admin/billing/${TENANT}/backup/journal`);
    expect(response.status).toBe(401); // dừng ở Access, không phải ở CSRF
  });
});
