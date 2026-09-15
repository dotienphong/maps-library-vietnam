import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedKey } from './helpers/seed-key';

const KEY = 'mlv_live_msgtest00000000000000000';

const message = async (path: string) => {
  const response = await SELF.fetch(`https://api${path}`, { headers: { 'X-Api-Key': KEY } });
  const body = (await response.json()) as { error: { code: string; message: string } };
  return { status: response.status, code: body.error.code, message: body.error.message };
};

/**
 * Preflight của quota chạy TRƯỚC handler và áp cho MỌI tenant kể cả legacy, nên nó không được
 * đổi thông điệp lỗi công khai. Các chuỗi dưới đây là hợp đồng đã công bố trong docs/api.md.
 */
describe('hợp đồng thông điệp lỗi 400 không đổi khi thêm preflight quota', () => {
  const cases: [string, string, string][] = [
    ['/v1/autocomplete?q=a', 'autocomplete q quá ngắn', 'q phải có ít nhất 2 ký tự'],
    [
      '/v1/autocomplete?q=%3F%3F',
      'autocomplete q không tra cứu được',
      'q không có ký tự tra cứu được',
    ],
    ['/v1/search', 'search thiếu bộ lọc', 'Cần ít nhất một trong q, category, near, bbox'],
    ['/v1/search?q=%3F%3F', 'search q không tra cứu được', 'q không có ký tự tra cứu được'],
    ['/v1/nearby', 'nearby thiếu toạ độ', 'lat, lng bắt buộc và phải hợp lệ'],
    ['/v1/geocode?q=a', 'geocode q quá ngắn', 'q phải có ít nhất 2 ký tự tra cứu được'],
    ['/v1/reverse', 'reverse thiếu toạ độ', 'lat, lng bắt buộc và phải hợp lệ'],
  ];

  for (const [path, label, expected] of cases) {
    it(label, async () => {
      await seedKey(KEY, { plan: 'free' });
      const result = await message(path);
      expect([result.status, result.code]).toEqual([400, 'invalid_request']);
      expect(result.message).toBe(expected);
    });
  }
});
