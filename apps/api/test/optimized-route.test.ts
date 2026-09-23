import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';
import fixture from './fixtures/valhalla/optimized-two-stops.json';
import { fetchMock } from './helpers/fetch-mock';
import { seedKey, sha256Hex } from './helpers/seed-key';

const KEY = 'mlv_live_optimized000000000000000';
const FREE_KEY = 'mlv_live_optimizedfree00000000000';
const origin = () => fetchMock.get('https://routing.test');
const mockOptimized = (status: number, body: object | string) =>
  origin().intercept({ path: '/optimized_route', method: 'POST' }).reply(status, body);
const mockStatus = () =>
  origin()
    .intercept({ path: '/status', method: 'GET' })
    .reply(200, { version: '3.8.3', tileset_last_modified: 1789430400 })
    .persist();
const call = (query: string, key = KEY, init: RequestInit = {}) =>
  SELF.fetch(`https://api/v1/optimized-route?${query}`, { ...init, headers: { 'X-Api-Key': key } });
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
// Mỗi test một from khác ở chữ số thứ 4 để không trúng cache của test trước.
const q = (suffix: number, extra = '') =>
  `from=10.77${suffix}8,106.6990&stops=10.7716,106.7043;10.7769,106.7032&to=10.7725,106.6980${extra}`;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(async () => {
  await seedKey(KEY);
});

describe('GET /v1/optimized-route', () => {
  it('không khoá → 401; thiếu stops, 11 stops, mode lạ, ngoài VN, chim bay → 400 mà KHÔNG gọi Valhalla', async () => {
    expect(
      (await SELF.fetch('https://api/v1/optimized-route?from=10,106&stops=11,107')).status,
    ).toBe(401);
    expect((await call('from=10.77,106.70')).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => `10.77,106.${600 + i}`).join(';');
    expect((await call(`from=10.77,106.70&stops=${eleven}`)).status).toBe(400);
    expect((await call('from=10.77,106.70&stops=10.78,106.71&mode=bike')).status).toBe(400);
    expect((await call('from=10.77,106.70&stops=13.75,100.50')).status).toBe(400);
    expect((await call('from=10.7798,106.6990&stops=21.0285,105.8542')).status).toBe(400);
  });

  it('hợp lệ → 200: DirectionsResponse + order [1, 0], 3 leg, 4 waypoint, engine.graph', async () => {
    mockOptimized(200, fixture);
    mockStatus();
    const res = await call(q(1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      order: number[];
      routes: { legs: unknown[] }[];
      waypoints: unknown[];
      engine: { name: string; graph: string | null };
    };
    expect(body.order).toEqual([1, 0]);
    expect(body.routes).toHaveLength(1);
    expect(body.routes[0]?.legs).toHaveLength(3);
    expect(body.waypoints).toHaveLength(4);
    expect(body.engine).toEqual({ name: 'valhalla', graph: '2026-09-15' });
  });

  it('bỏ to → body gửi Valhalla có from ở cuối (kiểm qua fixture 3 điểm) và vẫn 200', async () => {
    const roundTrip = {
      ...fixture,
      trip: {
        ...fixture.trip,
        locations: [
          { type: 'break', lat: 10.7728, lon: 106.699, original_index: 0 },
          { type: 'break', lat: 10.7716, lon: 106.7043, original_index: 1 },
          { type: 'break', lat: 10.7728, lon: 106.699, original_index: 2 },
        ],
        legs: [fixture.trip.legs[0], fixture.trip.legs[1]],
      },
    };
    mockOptimized(200, roundTrip);
    mockStatus();
    const res = await call('from=10.7728,106.6990&stops=10.7716,106.7043');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: number[]; waypoints: { location: number[] }[] };
    expect(body.order).toEqual([0]);
    expect(body.waypoints[2]?.location).toEqual([106.699, 10.7728]);
  });

  it('Valhalla 400+442 → 404 no_route; 500 → 503 retry-after 30; order không hợp lệ → 503', async () => {
    mockStatus();
    mockOptimized(400, { error_code: 442, error: 'No path could be found for input' });
    const notFound = await call(q(2));
    expect(notFound.status).toBe(404);
    expect(await code(notFound)).toBe('no_route');

    mockOptimized(500, 'boom');
    const down = await call(q(3));
    expect(down.status).toBe(503);
    expect(down.headers.get('retry-after')).toBe('30');

    mockOptimized(200, {
      ...fixture,
      trip: {
        ...fixture.trip,
        locations: fixture.trip.locations.map((l) => ({ ...l, original_index: 0 })),
      },
    });
    const broken = await call(q(4));
    expect(broken.status).toBe(503);
    expect(await code(broken)).toBe('upstream_unavailable');
  });

  it('HEAD → 405 Allow: GET; cache hit trong 60 s', async () => {
    const head = await call(q(5), KEY, { method: 'HEAD' });
    expect(head.status).toBe(405);
    expect(head.headers.get('allow')).toBe('GET');

    mockOptimized(200, fixture).persist();
    mockStatus();
    const first = await call(q(6));
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      const again = await call(q(6));
      hit = again.headers.get('x-mlv-cache') === 'hit';
      await again.arrayBuffer();
      if (!hit) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(hit).toBe(true);
  });

  it('quota nhóm directions: cộng 1 khi 200, vượt 2× → 429', async () => {
    await seedKey(FREE_KEY, {
      tenantId: '00000000-0000-4000-8000-0000000000dd',
      plan: 'free',
      quotaDirectionsPerDay: 5,
    });
    const hash = await sha256Hex(FREE_KEY);
    const key = `quota:${hash}:${vnDay()}:directions`;
    mockOptimized(200, fixture);
    mockStatus();
    const allowed = await call(q(7), FREE_KEY);
    expect(allowed.status).toBe(200);
    await allowed.arrayBuffer();
    let count = '0';
    for (let i = 0; i < 20 && count === '0'; i++) {
      count = (await env.META.get(key)) ?? '0';
      if (count === '0') await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(count).toBe('1');
    await env.META.put(key, '10');
    const blocked = await call(q(8), FREE_KEY);
    expect(blocked.status).toBe(429);
    expect(await code(blocked)).toBe('quota_exceeded');
  });
});
