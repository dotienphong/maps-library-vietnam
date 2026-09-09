import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedKey } from './helpers/seed-key';

const KEY = 'mlv_live_test00000000000000000000';
beforeAll(() => seedKey(KEY));
const fetchApi = (path: string) =>
  SELF.fetch(`https://api${path}`, { headers: { 'X-Api-Key': KEY } });
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('validation search/nearby/places (không DB)', () => {
  it('search không có q lẫn category/bbox/near → 400', async () => {
    const response = await fetchApi('/v1/search');
    expect(response.status).toBe(400);
    expect(await code(response)).toBe('invalid_request');
  });

  it('search q không có ký tự tra cứu hoặc bbox sai → 400', async () => {
    for (const path of ['/v1/search?q=!!!', '/v1/search?bbox=106,11,105,10']) {
      const response = await fetchApi(path);
      expect(response.status).toBe(400);
      expect(await code(response)).toBe('invalid_request');
    }
  });

  it('search radius/limit vượt trần bị kẹp — qua validate rồi chết ở DB → 503', async () => {
    const response = await fetchApi('/v1/search?q=pho&near=10.77,106.70&radius=999999&limit=999');
    expect(response.status).toBe(503);
  });

  it('nearby thiếu/rỗng lat,lng → 400; đủ → 503 (DB đóng)', async () => {
    expect((await fetchApi('/v1/nearby')).status).toBe(400);
    expect((await fetchApi('/v1/nearby?lat=&lng=')).status).toBe(400);
    expect((await fetchApi('/v1/nearby?lat=10.77&lng=106.70')).status).toBe(503);
  });

  it('sources lạ → 400 ở search và nearby; sources hợp lệ đi tới DB → 503', async () => {
    expect((await fetchApi('/v1/search?q=pho&sources=banana')).status).toBe(400);
    expect((await fetchApi('/v1/nearby?lat=10.77&lng=106.70&sources=banana')).status).toBe(400);
    expect((await fetchApi('/v1/search?q=pho&sources=all')).status).toBe(503);
    expect((await fetchApi('/v1/nearby?lat=10.77&lng=106.70&sources=osm,fsq')).status).toBe(503);
  });

  it('places/{id} không auth → 401; có auth + DB đóng → 503', async () => {
    const anonymous = await SELF.fetch('https://api/v1/places/abc');
    expect(anonymous.status).toBe(401);
    expect((await fetchApi('/v1/places/abc')).status).toBe(503);
  });
});
