import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('POST /csp-report', () => {
  it('nhận báo cáo CSP và trả 204 không kèm dữ liệu', async () => {
    const res = await SELF.fetch('https://api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'inline' },
      }),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('thân không phải JSON vẫn trả 204, không bao giờ lỗi', async () => {
    const res = await SELF.fetch('https://api/csp-report', { method: 'POST', body: 'x' });
    expect(res.status).toBe(204);
  });
});
