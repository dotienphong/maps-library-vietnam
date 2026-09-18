import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { phanTram } from '../src/routes/admin-quota-summary';

describe('phanTram', () => {
  it('lấy nhóm dùng nhiều hơn trong hai nhóm', () => {
    expect(phanTram({ used: 10, limit: 100 }, { used: 80, limit: 100 })).toBe(80);
  });

  it('hạn mức 0 KHÔNG phải 100% và cũng không phải NaN', () => {
    // Tenant `internal` cố ý không đếm lượt, và một khoá có thể có hạn mức 0. Chia cho 0 ra
    // Infinity, và ô số liệu trên trang chủ sẽ hiện đúng chữ đó.
    expect(phanTram({ used: 0, limit: 0 }, { used: 0, limit: 0 })).toBe(0);
  });

  it('vượt hạn mức thì cắt ở 100, không hiện 340%', () => {
    expect(phanTram({ used: 340, limit: 100 }, { used: 0, limit: 100 })).toBe(100);
  });

  it('làm tròn về số nguyên', () => {
    expect(phanTram({ used: 1, limit: 3 }, { used: 0, limit: 3 })).toBe(33);
  });
});

describe('GET /v1/admin/quota-summary — cổng vào', () => {
  it('thiếu JWT Access → không bao giờ là 200', async () => {
    // Mức tiêu thụ của khách là dữ liệu kinh doanh: nó nói khách nào đang dùng bao nhiêu.
    const response = await SELF.fetch('https://api/v1/admin/quota-summary');
    expect(response.status).not.toBe(200);
    expect([401, 403]).toContain(response.status);
  });
});
