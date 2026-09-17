import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('cổng vào của Nhật ký kiểm toán', () => {
  it('thiếu JWT Access → 401, không rò một dòng nhật ký nào', async () => {
    // Nhật ký chứa email người trực và `target` là id edit/tenant/key_hash. Để nó ra ngoài cổng
    // Access là biếu không bản đồ ai đang vận hành hệ thống và đụng vào cái gì.
    const response = await SELF.fetch('https://api/v1/admin/audit');
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('tham số hỏng vẫn bị cổng Access chặn TRƯỚC, không lộ thông điệp kiểm tham số', async () => {
    const response = await SELF.fetch('https://api/v1/admin/audit?from=hom-qua');
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });
});
