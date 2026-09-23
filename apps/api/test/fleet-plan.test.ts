import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';
import routeFixture from './fixtures/valhalla/optimized-two-stops.json';
import vroomFixture from './fixtures/vroom/two-vehicles.json';
import { fetchMock } from './helpers/fetch-mock';
import { seedKey } from './helpers/seed-key';

const KEY = 'mlv_live_fleet0000000000000000000';
const FREE_KEY = 'mlv_live_fleetfree000000000000000';
const DEPOT = [10.7725, 106.698];
/** Mỗi test đổi `tag` vào id đơn đầu để không trúng cache của test trước (khoá cache băm cả id). */
const body = (tag: string, patch: Record<string, unknown> = {}) => ({
  vehicles: [
    { id: 'xe-1', start: DEPOT },
    { id: 'xe-2', start: DEPOT, end: 'open' },
  ],
  jobs: [
    { id: `don-1-${tag}`, location: [10.7826, 106.6958], service_s: 120 },
    { id: 'don-2', location: [10.7686, 106.7069], service_s: 120 },
    { id: 'don-3', location: [10.777, 106.6953] },
  ],
  ...patch,
});
const mockVroom = (status: number, reply: object | string) =>
  fetchMock.get('https://fleet.test').intercept({ path: '/', method: 'POST' }).reply(status, reply);
const mockRoute = () =>
  fetchMock
    .get('https://routing.test')
    .intercept({ path: '/route', method: 'POST' })
    .reply(200, routeFixture);
const mockStatus = () =>
  fetchMock
    .get('https://routing.test')
    .intercept({ path: '/status', method: 'GET' })
    .reply(200, { version: '3.8.3', tileset_last_modified: 1789430400 })
    .persist();
const post = (payload: unknown, key = KEY) =>
  SELF.fetch('https://api/v1/fleet-plan', {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
const loi = async (r: Response) =>
  ((await r.json()) as { error: { code: string; message: string } }).error;

/** Nghiệm VROOM tí hon cho /healthz/fleet: 1 xe, 2 đơn Hà Nội. */
const TI_HON = {
  code: 0,
  summary: { cost: 900, routes: 1, unassigned: 0, service: 0, duration: 900, waiting_time: 0 },
  unassigned: [] as { id: number }[],
  routes: [
    {
      vehicle: 0,
      cost: 900,
      service: 0,
      duration: 900,
      waiting_time: 0,
      steps: [
        { type: 'start', arrival: 0, duration: 0 },
        { type: 'job', id: 0, arrival: 400, duration: 400 },
        { type: 'job', id: 1, arrival: 700, duration: 700 },
        { type: 'end', arrival: 900, duration: 900 },
      ],
    },
  ],
};

interface Plan {
  vehicles: {
    vehicle: string;
    jobs: string[];
    routes: { legs: unknown[] }[];
    waypoints: unknown[];
    stops: unknown[];
  }[];
  unassigned: { id: string }[];
  summary: { vehicles_used: number; jobs_assigned: number; jobs_unassigned: number };
  engine: { name: string; graph: string | null };
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(async () => {
  // Ca cache hit dùng interceptor persist; xoá để ca sau (upstream chết) không nhận nhầm 200.
  fetchMock.reset();
  await seedKey(KEY);
});

describe('POST /v1/fleet-plan', () => {
  it('không khoá → 401; body sai → 400 mà KHÔNG gọi VROOM', async () => {
    const khongKhoa = await SELF.fetch('https://api/v1/fleet-plan', {
      method: 'POST',
      body: JSON.stringify(body('a')),
    });
    expect(khongKhoa.status).toBe(401);
    expect((await loi(await post('{không phải json'))).message).toMatch(/JSON/);
    expect((await post(body('b', { vehicles: [] }))).status).toBe(400);
    expect(
      (await post(body('c', { jobs: [{ id: 'hn', location: [21.0285, 105.8542] }] }))).status,
    ).toBe(400);
    const to = await post(body('d', { pad: 'x'.repeat(70_000) }));
    expect(to.status).toBe(400);
    expect((await loi(to)).message).toMatch(/64 KB/);
  });

  it('hợp lệ → 200: xe-1 là DirectionsResponse + jobs/stops, xe-2 rỗi, unassigned theo id, engine vroom+valhalla; gọi lại → cache hit', async () => {
    mockVroom(200, vroomFixture).persist();
    fetchMock
      .get('https://routing.test')
      .intercept({ path: '/route', method: 'POST' })
      .reply(200, routeFixture)
      .persist();
    mockStatus();
    const res = await post(body('e'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-mlv-cache')).toBeNull();
    const plan = (await res.json()) as Plan;
    expect(plan.vehicles).toHaveLength(2);
    expect(plan.vehicles[0]?.vehicle).toBe('xe-1');
    expect(plan.vehicles[0]?.jobs).toEqual(['don-2', 'don-1-e']);
    expect(plan.vehicles[0]?.routes[0]?.legs).toHaveLength(3);
    expect(plan.vehicles[0]?.waypoints).toHaveLength(4);
    expect(plan.vehicles[0]?.stops).toHaveLength(2);
    expect(plan.vehicles[1]).toMatchObject({ vehicle: 'xe-2', jobs: [], routes: [] });
    expect(plan.unassigned).toEqual([{ id: 'don-3' }]);
    expect(plan.summary).toMatchObject({ vehicles_used: 1, jobs_assigned: 2, jobs_unassigned: 1 });
    expect(plan.engine).toEqual({ name: 'vroom+valhalla', graph: '2026-09-15' });
    // cache.put chạy trong waitUntil: thăm dò tới khi thấy hit.
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      const lai = await post(body('e'));
      hit = lai.headers.get('x-mlv-cache') === 'hit';
      await lai.arrayBuffer();
      if (!hit) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(hit).toBe(true);
  });

  it('VROOM báo Unfound route → 404 no_route gọi tên đơn', async () => {
    mockVroom(500, {
      code: 3,
      error: 'Unfound route(s) from location [106.706900,10.768600]',
    });
    const res = await post(body('f'));
    expect(res.status).toBe(404);
    const err = await loi(res);
    expect(err.code).toBe('no_route');
    expect(err.message).toMatch(/đơn don-2/);
  });

  it('VROOM không phản hồi → 503; VROOM ok nhưng /route lỗi → 503', async () => {
    const chet = await post(body('g'));
    expect(chet.status).toBe(503);
    expect((await loi(chet)).code).toBe('upstream_unavailable');
    mockVroom(200, vroomFixture);
    mockStatus();
    const route = await post(body('h'));
    expect(route.status).toBe(503);
  });

  it('khoá free: 400 không tốn lượt, 200 tốn một lượt', async () => {
    const hash = await seedKey(FREE_KEY, {
      tenantId: '00000000-0000-4000-8000-0000000000ef',
      plan: 'free',
      quotaDirectionsPerDay: 5,
    });
    const kvKey = `quota:${hash}:${vnDay()}:directions`;
    expect((await post(body('i', { vehicles: [] }), FREE_KEY)).status).toBe(400);
    expect(await env.META.get(kvKey)).toBeNull();
    mockVroom(200, vroomFixture);
    mockRoute();
    mockStatus();
    const ok = await post(body('j'), FREE_KEY);
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();
    let count = '0';
    for (let i = 0; i < 20 && count === '0'; i++) {
      count = (await env.META.get(kvKey)) ?? '0';
      if (count === '0') await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(count).toBe('1');
  });
});

describe('GET /healthz/fleet', () => {
  it('VROOM xếp đủ 2 đơn thử → ok; VROOM chết → 503', async () => {
    mockVroom(200, TI_HON);
    const ok = await SELF.fetch('https://api/healthz/fleet');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, jobs_assigned: 2 });
    const chet = await SELF.fetch('https://api/healthz/fleet');
    expect(chet.status).toBe(503);
  });

  it('VROOM trả nhưng bỏ một đơn → 503 nêu số xếp được', async () => {
    const route = TI_HON.routes[0];
    if (!route) throw new Error('thiếu route');
    mockVroom(200, {
      ...TI_HON,
      unassigned: [{ id: 1 }],
      routes: [{ ...route, steps: route.steps.filter((s) => !(s.type === 'job' && s.id === 1)) }],
    });
    const res = await SELF.fetch('https://api/healthz/fleet');
    expect(res.status).toBe(503);
    expect((await loi(res)).message).toMatch(/1\/2/);
  });

  it('graph không phủ Hà Nội (VROOM báo vùng không nối) → vẫn 503, không phải 404', async () => {
    mockVroom(500, {
      code: 3,
      error:
        'Valhalla matrix error (Locations are in unconnected regions. Go check/edit the map at osm.org).',
    });
    const res = await SELF.fetch('https://api/healthz/fleet');
    expect(res.status).toBe(503);
    expect((await loi(res)).message).toMatch(/không nối/);
  });
});
