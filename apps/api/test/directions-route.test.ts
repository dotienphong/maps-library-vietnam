import { SELF, env, fetchMock } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';
import { parseDirectionsParams } from '../src/routing/params';
import { valhallaBody } from '../src/routing/valhalla';
import fixture from './fixtures/valhalla/two-legs.json';
import { seedKey, sha256Hex } from './helpers/seed-key';

const KEY = 'mlv_live_route0000000000000000000';
const FREE_KEY = 'mlv_live_routefree000000000000000';
const origin = () => fetchMock.get('https://routing.test');
const mockRoute = (status: number, body: object | string) =>
  origin().intercept({ path: '/route', method: 'POST' }).reply(status, body);
const mockStatus = () =>
  origin()
    .intercept({ path: '/status', method: 'GET' })
    .reply(200, { version: '3.8.3', tileset_last_modified: 1789430400 })
    .persist();
const call = (query: string, key = KEY) =>
  SELF.fetch(`https://api/v1/directions?${query}`, { headers: { 'X-Api-Key': key } });
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
// Mỗi test một cặp toạ độ khác nhau để không trúng cache của test trước.
const q = (suffix: number, extra = '') =>
  `from=10.779${suffix},106.6990&to=10.7725,106.6980${extra}`;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(async () => {
  await seedKey(KEY);
  mockStatus();
});

describe('GET /v1/directions', () => {
  it('không khoá → 401; thiếu to → 400; mode lạ → 400; ngoài VN → 400; walk 130 km → 400', async () => {
    expect((await SELF.fetch('https://api/v1/directions?from=10,106&to=11,107')).status).toBe(401);
    expect((await call('from=10.77,106.70')).status).toBe(400);
    expect((await call('from=10.77,106.70&to=10.78,106.71&mode=bike')).status).toBe(400);
    expect((await call('from=10.77,106.70&to=13.75,100.50')).status).toBe(400);
    expect((await call('from=10.77,106.70&to=10.0341,105.7841&mode=walk')).status).toBe(400);
  });

  it('tuyến hợp lệ → 200 theo schema MapsLibVN, engine.graph từ /status', async () => {
    mockRoute(200, fixture);
    const res = await call(q(1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      routes: { distance_m: number; legs: unknown[] }[];
      waypoints: unknown[];
      engine: { name: string; graph: string | null };
    };
    expect(body.routes[0]?.distance_m).toBe(820);
    expect(body.routes[0]?.legs).toHaveLength(2);
    expect(body.waypoints).toHaveLength(3);
    expect(body.engine).toEqual({ name: 'valhalla', graph: '2026-09-15' });
  });

  it('body gửi Valhalla: costing motor_scooter mặc định, không alternates khi có via', async () => {
    // `fetchMock` của Miniflare match POST method/path nhưng không dispatch theo body predicate cho
    // native Worker fetch (predicate làm request treo). Kiểm tra body tại cùng builder mà route gọi.
    const params = parseDirectionsParams({
      from: '10.7792,106.6990',
      to: '10.7725,106.6980',
      via: '10.776,106.698',
      alternatives: '1',
    });
    const sent = valhallaBody(params, 'route-test');
    expect(sent.costing).toBe('motor_scooter');
    expect(sent.alternates).toBeUndefined();
    expect(sent.locations).toHaveLength(3);
  });

  it('Valhalla 400+442 → 404 no_route (không cache); 500 → 503 có retry-after 30', async () => {
    mockRoute(400, { error_code: 442, error: 'No path could be found for input' });
    const notFound = await call(q(3));
    expect(notFound.status).toBe(404);
    expect(await code(notFound)).toBe('no_route');

    mockRoute(500, 'boom');
    const down = await call(q(4));
    expect(down.status).toBe(503);
    expect(await code(down)).toBe('upstream_unavailable');
    expect(down.headers.get('retry-after')).toBe('30');
  });

  it('cache: request giống nhau trong 60 s được trả từ cache (x-mlv-cache=hit)', async () => {
    // cache.put chạy trong waitUntil nên có thể chưa xong khi request đầu trả về: cho phép Valhalla
    // được gọi lại (persist) và chờ tới khi thấy bản cache, tối đa ~1 s.
    mockRoute(200, fixture).persist();
    const first = await call(q(5));
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      const again = await call(q(5));
      expect(again.status).toBe(200);
      hit = again.headers.get('x-mlv-cache') === 'hit';
      await again.arrayBuffer();
      if (!hit) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(hit).toBe(true);
  });

  it('quota nhóm directions: đếm riêng, 2× hạn → 429; counter places không ảnh hưởng', async () => {
    await seedKey(FREE_KEY, {
      tenantId: '00000000-0000-4000-8000-0000000000bb',
      plan: 'free',
      quotaDirectionsPerDay: 5,
    });
    const hash = await sha256Hex(FREE_KEY);
    await env.META.put(`quota:${hash}:${vnDay()}:places`, '999999');
    mockRoute(200, fixture);
    const allowed = await call(q(6), FREE_KEY);
    expect(allowed.status).toBe(200);
    await allowed.arrayBuffer();
    await env.META.put(`quota:${hash}:${vnDay()}:directions`, '10');
    const blocked = await call(q(7), FREE_KEY);
    expect(blocked.status).toBe(429);
    expect(await code(blocked)).toBe('quota_exceeded');
  });
});

describe('GET /healthz/routing', () => {
  it('Valhalla trả lời → ok + graph_built_at ISO; không cần khoá', async () => {
    const res = await SELF.fetch('https://api/healthz/routing');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      version: '3.8.3',
      graph_built_at: '2026-09-15T00:00:00.000Z',
    });
  });
});
