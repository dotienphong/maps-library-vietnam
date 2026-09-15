import { beforeAll, describe, expect, it, vi } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import { syntheticTwoLegRoute } from '../../tests/helpers/synthetic-route';
import type { DirectionsResponse } from '../types';
import { createNavigator } from './navigator';
import { simulateFixes } from './simulate';
import type { Announcement, GeoFix, NavigationStatus } from './types';

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0];
if (!route) throw new Error('fixture thiếu routes[0]');

/**
 * Dịch kinh độ ~89 m về đông cho mọi fix từ chỉ số `from` — mô phỏng lệch tuyến. Dùng kinh độ
 * (không phải vĩ độ) vì tuyến Quận 1 ngoằn ngoèo (turn_right/turn_left xen kẽ theo hướng bắc–nam):
 * một dịch chuyển bắc/nam có thể tình cờ trùng một đoạn khác của CHÍNH tuyến đó, khiến khoảng cách
 * vuông góc rớt xuống dưới ngưỡng và lệch tuyến bị huỷ giữa chừng (đã kiểm bằng sweep thực nghiệm
 * trên fixture — mọi biên độ dịch bắc/nam đều có điểm chạm; dịch đông giữ khoảng cách ổn định).
 */
const shiftFrom = (fixes: GeoFix[], from: number, dLng = 0.0008): GeoFix[] =>
  fixes.map((f, i) => (i >= from ? { ...f, lng: f.lng + dLng } : f));

function record(nav: ReturnType<typeof createNavigator>) {
  const statuses: NavigationStatus[] = [];
  const steps: number[] = [];
  const announcements: Announcement[] = [];
  const offRoute = vi.fn();
  const arrive = vi.fn();
  const waypoint = vi.fn();
  const progress = vi.fn();
  nav.on('status', (e) => statuses.push(e.status));
  nav.on('step', (e) => steps.push(e.stepIndex));
  nav.on('announce', (a) => announcements.push(a));
  nav.on('offRoute', offRoute);
  nav.on('arrive', arrive);
  nav.on('waypoint', waypoint);
  nav.on('progress', progress);
  return { statuses, steps, announcements, offRoute, arrive, waypoint, progress };
}

describe('createNavigator — đi đúng tuyến Quận 1 (xe máy)', () => {
  const nav = createNavigator({ response, reroute: 'manual' });
  const r = record(nav);
  const fixes = simulateFixes(route);
  // Phải nằm trong beforeAll, KHÔNG ở thân describe: từ vitest 5, call của `vi.fn()` ghi trong pha
  // collection bị xoá trước khi test chạy, nên `r.arrive` đếm 0 dù navigator đã chạy đúng (mảng
  // `statuses`/`steps` thì vẫn giữ, nên triệu chứng rất dễ đọc nhầm).
  beforeAll(() => {
    for (const f of fixes) nav.update(f);
  });

  it('idle → navigating → arrived; step đổi 5 lần; arrive một lần; progress mỗi fix tới khi đến', () => {
    expect(r.statuses).toEqual(['navigating', 'arrived']);
    expect(nav.status).toBe('arrived');
    expect(r.steps).toEqual([1, 2, 3, 4, 5]);
    expect(r.arrive).toHaveBeenCalledTimes(1);
    expect(r.arrive.mock.calls[0]?.[0]).toMatchObject({ waypoint: response.waypoints[1] });
    expect(r.progress.mock.calls.length).toBeGreaterThan(fixes.length * 0.9);
    expect(r.progress.mock.calls.length).toBeLessThan(fixes.length);
    expect(r.offRoute).not.toHaveBeenCalled();
    expect(r.waypoint).not.toHaveBeenCalled();
  });

  it('lịch đọc đúng thứ tự spec B 4.5 cho 6 step (step 0 và 4 ngắn nên không post/approach)', () => {
    expect(r.announcements.map((a) => a.kind)).toEqual([
      'depart',
      'pre',
      'post',
      'approach',
      'pre',
      'post',
      'approach',
      'pre',
      'post',
      'approach',
      'pre',
      'arrive',
    ]);
    for (const a of r.announcements.filter((x) => x.kind === 'approach')) {
      expect(a.text).toMatch(/^Trong \d+ mét nữa, [a-zđ]/u);
      expect(a.priority).toBe(2);
    }
    expect(r.announcements.at(-1)?.text).toBe('Điểm đến ở bên trái.');
    expect(r.announcements[0]?.text).toBe(route.legs[0]?.steps[0]?.verbal_pre);
  });

  it('progress cuối: remaining_m ≤ arrive_m, distanceToStep 0, bearing trong [0,360), snapped gần fix', () => {
    const p = nav.progress;
    expect(p?.status).toBe('arrived');
    expect(p?.remaining_m ?? 99).toBeLessThanOrEqual(25);
    expect(p?.distanceToStep_m).toBe(0);
    expect(p?.bearing ?? -1).toBeGreaterThanOrEqual(0);
    expect(p?.bearing ?? 999).toBeLessThan(360);
    expect(p?.offRoute_m ?? 99).toBeLessThan(1);
  });

  it('sau arrived, update() bị bỏ qua', () => {
    const before = r.progress.mock.calls.length;
    nav.update({ ...(fixes[0] as GeoFix), timestamp: Date.now() + 1e9 });
    expect(r.progress.mock.calls.length).toBe(before);
  });
});

describe('createNavigator — lọc fix, stop, setRoute', () => {
  it('bỏ fix accuracy quá ngưỡng và fix có timestamp không tăng', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const [f0, f1] = simulateFixes(route) as [GeoFix, GeoFix];
    nav.update({ ...f0, accuracy_m: 150 });
    expect(r.progress).not.toHaveBeenCalled();
    expect(nav.status).toBe('idle');
    nav.update(f0);
    nav.update({ ...f1, timestamp: f0.timestamp });
    expect(r.progress).toHaveBeenCalledTimes(1);
    nav.update(f1);
    expect(r.progress).toHaveBeenCalledTimes(2);
  });

  it("'auto' không có provider → ném ngay khi tạo", () => {
    expect(() => createNavigator({ response })).toThrowError(/provider/);
  });

  it('stop() → stopped, fix sau bị bỏ', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(route);
    nav.update(fixes[0] as GeoFix);
    nav.stop();
    nav.update(fixes[1] as GeoFix);
    expect(nav.status).toBe('stopped');
    expect(r.statuses).toEqual(['navigating', 'stopped']);
    expect(r.progress).toHaveBeenCalledTimes(1);
  });

  it('setRoute() reset: fix kế bám toàn tuyến, lịch đọc reset, progress cũ bị xoá', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(route);
    for (const f of fixes.slice(0, 30)) nav.update(f);
    expect(r.announcements.filter((a) => a.kind === 'depart')).toHaveLength(1);
    const postsBefore = r.announcements.filter((a) => a.kind === 'post' && a.stepIndex === 1);
    expect(postsBefore).toHaveLength(1);
    nav.setRoute(response);
    expect(nav.progress).toBeNull();
    nav.update(fixes[30] as GeoFix);
    // Fix 30 nằm giữa step 1 (không phải depart) → lịch đọc đã reset nên 'post' của step 1 đọc lại.
    expect(r.announcements.filter((a) => a.kind === 'post' && a.stepIndex === 1)).toHaveLength(2);
    expect(r.announcements.filter((a) => a.kind === 'depart')).toHaveLength(1);
    expect(nav.progress?.stepIndex).toBe(1);
  });
});

describe('createNavigator — lệch tuyến (reroute manual)', () => {
  it('3 fix liên tiếp ngoài ngưỡng và ≥ 5 s → off_route một lần; progress vẫn phát', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = shiftFrom(simulateFixes(route), 20);
    const offAt: number[] = [];
    fixes.forEach((f, i) => {
      nav.update(f);
      if (r.offRoute.mock.calls.length === 1 && offAt.length === 0) offAt.push(i);
    });
    expect(r.offRoute).toHaveBeenCalledTimes(1);
    // fix 20, 21, 22 = 3 fix; 5 s kể từ fix 20 → fix 25
    expect(offAt).toEqual([25]);
    const off = r.offRoute.mock.calls[0]?.[0] as { distance_m: number } | undefined;
    expect(off).toMatchObject({ distance_m: expect.any(Number) });
    expect(off?.distance_m).toBeGreaterThan(60);
    expect(nav.status).toBe('off_route');
    expect(r.progress.mock.calls.length).toBe(fixes.length);
    expect(r.arrive).not.toHaveBeenCalled();
  });

  it('lệch 2 fix rồi quay lại → không off_route', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(route).map((f, i) =>
      i === 20 || i === 21 ? { ...f, lat: f.lat + 0.0008 } : f,
    );
    for (const f of fixes) nav.update(f);
    expect(r.offRoute).not.toHaveBeenCalled();
    expect(nav.status).toBe('arrived');
  });

  it('quay lại trong ngưỡng sau khi đã off_route → navigating', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(route).map((f, i) =>
      i >= 20 && i < 40 ? { ...f, lat: f.lat + 0.0008 } : f,
    );
    for (const f of fixes) nav.update(f);
    expect(r.offRoute).toHaveBeenCalledTimes(1);
    expect(r.statuses).toEqual(['navigating', 'off_route', 'navigating', 'arrived']);
  });

  it('ngưỡng hiệu dụng theo accuracy: lệch 60 m với accuracy 50 m (ngưỡng 75) không tính là lệch', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(route, { accuracy_m: 50 }).map((f, i) =>
      i >= 20 ? { ...f, lat: f.lat + 0.00054 } : f,
    );
    for (const f of fixes) nav.update(f);
    expect(r.offRoute).not.toHaveBeenCalled();
  });

  it('chạy ngược trên chính tuyến → off_route (khoảng cách vuông góc vẫn 0)', () => {
    const nav = createNavigator({ response, reroute: 'manual' });
    const r = record(nav);
    const forward = simulateFixes(route).slice(0, 41);
    const t0 = forward.at(-1)?.timestamp ?? 0;
    const backward = forward
      .slice(0, 40)
      .reverse()
      .map((f, i) => ({ ...f, timestamp: t0 + (i + 1) * 1000 }));
    for (const f of [...forward, ...backward]) nav.update(f);
    expect(r.offRoute).toHaveBeenCalledTimes(1);
    expect(nav.status).toBe('off_route');
    expect(r.arrive).not.toHaveBeenCalled();
  });

  it('ghi đè ngưỡng: offRouteFixes 1, offRouteSeconds 0 → lệch ngay fix đầu ngoài ngưỡng', () => {
    const nav = createNavigator({
      response,
      reroute: 'manual',
      thresholds: { offRouteFixes: 1, offRouteSeconds: 0 },
    });
    const r = record(nav);
    for (const f of shiftFrom(simulateFixes(route), 20).slice(0, 21)) nav.update(f);
    expect(r.offRoute).toHaveBeenCalledTimes(1);
  });
});

describe('createNavigator — tuyến hai leg', () => {
  it('qua via → waypoint đúng một lần, legIndex 1, đọc khởi hành leg 2, rồi arrive', () => {
    const twoLeg = syntheticTwoLegRoute();
    const nav = createNavigator({ response: twoLeg, reroute: 'manual' });
    const r = record(nav);
    const fixes = simulateFixes(twoLeg.routes[0] as NonNullable<(typeof twoLeg.routes)[0]>, {
      speed_mps: 5,
    });
    for (const f of fixes) nav.update(f);
    expect(r.waypoint).toHaveBeenCalledTimes(1);
    expect(r.waypoint.mock.calls[0]?.[0]).toMatchObject({
      legIndex: 1,
      waypoint: twoLeg.waypoints[1],
    });
    expect(r.announcements.filter((a) => a.kind === 'depart')).toHaveLength(2);
    expect(r.announcements.filter((a) => a.kind === 'arrive')).toHaveLength(2);
    expect(r.arrive).toHaveBeenCalledTimes(1);
    expect(nav.status).toBe('arrived');
  });
});
