import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedKey } from './helpers/seed-key';

const KEY = 'mlv_live_test00000000000000000000';
beforeAll(() => seedKey(KEY));

const fetchApi = (path: string, authenticated = true) =>
  SELF.fetch(`https://api${path}`, authenticated ? { headers: { 'X-Api-Key': KEY } } : undefined);
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('validation geocode/reverse (không DB)', () => {
  it('reverse: sources lạ → 400; hợp lệ → 503 (DB đóng)', async () => {
    expect((await fetchApi('/v1/reverse?lat=10.77&lng=106.70&sources=banana')).status).toBe(400);
    expect((await fetchApi('/v1/reverse?lat=10.77&lng=106.70&sources=osm')).status).toBe(503);
  });

  it('cả hai route yêu cầu API key', async () => {
    expect((await fetchApi('/v1/geocode?q=Nguyen%20Lam', false)).status).toBe(401);
    expect((await fetchApi('/v1/reverse?lat=10.77&lng=106.7', false)).status).toBe(401);
  });

  it('geocode từ chối q thiếu, quá ngắn hoặc không có ký tự tra cứu', async () => {
    for (const path of ['/v1/geocode', '/v1/geocode?q=a', '/v1/geocode?q=!!!']) {
      const response = await fetchApi(path);
      expect(response.status).toBe(400);
      expect(await code(response)).toBe('invalid_request');
    }
  });

  it('geocode validate near; request hợp lệ đi tới DB rồi trả 503 khi DB đóng', async () => {
    expect((await fetchApi('/v1/geocode?q=Nguyen%20Lam&near=91,106')).status).toBe(400);
    expect((await fetchApi('/v1/geocode?q=Nguyen%20Lam&near=10.77,106.7')).status).toBe(503);
  });

  it('reverse từ chối lat/lng thiếu, rỗng hoặc ngoài biên', async () => {
    for (const path of [
      '/v1/reverse',
      '/v1/reverse?lat=&lng=',
      '/v1/reverse?lat=91&lng=106',
      '/v1/reverse?lat=10&lng=181',
    ]) {
      const response = await fetchApi(path);
      expect(response.status).toBe(400);
      expect(await code(response)).toBe('invalid_request');
    }
  });

  it('reverse hợp lệ đi tới DB rồi trả 503 khi DB đóng', async () => {
    expect((await fetchApi('/v1/reverse?lat=10.77&lng=106.7')).status).toBe(503);
  });
});
