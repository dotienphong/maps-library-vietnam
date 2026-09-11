import { describe, expect, it, vi } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import { syntheticTwoLegRoute } from '../../tests/helpers/synthetic-route';
import type { DirectionsOptions } from '../client';
import type { DirectionsResponse, Route } from '../types';
import { createNavigator } from './navigator';
import { simulateFixes } from './simulate';
import type { GeoFix, RouteProvider } from './types';

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Dịch kinh độ (xem ghi chú trong navigator.test.ts) — giữ khoảng cách lệch ổn định trên fixture thật. */
const shiftFrom = (fixes: GeoFix[], from: number, dLng = 0.0008): GeoFix[] =>
  fixes.map((f, i) => (i >= from ? { ...f, lng: f.lng + dLng } : f));

/** Cho từng fix vào navigator và chờ microtask sau mỗi fix để promise của provider chạy. */
async function feed(nav: ReturnType<typeof createNavigator>, fixes: GeoFix[]) {
  for (const f of fixes) {
    nav.update(f);
    await flush();
  }
}

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createNavigator — reroute auto', () => {
  it('lệch xác nhận → gọi provider đúng tham số → rerouting → reroute → navigating, lịch đọc reset', async () => {
    const directions = vi.fn(async (_o: DirectionsOptions) => response);
    const provider: RouteProvider = { directions };
    const nav = createNavigator({ response, provider });
    const events: string[] = [];
    nav.on('status', (e) => events.push(`status:${e.status}`));
    nav.on('offRoute', () => events.push('offRoute'));
    nav.on('reroute', (e) => events.push(`reroute:${e.reason}`));
    nav.on('announce', (a) => events.push(`announce:${a.kind}`));

    const fixes = shiftFrom(simulateFixes(route), 20);
    // Chỉ tới fix 25 (fix xác nhận lệch): reroute chạy xong ngay trong flush() của vòng lặp, nên
    // dừng ở đây để fix "sạch" bên dưới thật sự là fix ĐẦU TIÊN sau khi setRoute() reset tracking.
    await feed(nav, fixes.slice(0, 26));

    expect(directions).toHaveBeenCalledTimes(1);
    const fix25 = fixes[25] as GeoFix;
    const dest = response.waypoints[1]?.location ?? [0, 0];
    expect(directions.mock.calls[0]?.[0]).toEqual({
      from: [fix25.lat, fix25.lng],
      to: [dest[1], dest[0]],
      mode: 'motorbike',
      lang: 'vi',
      alternatives: false,
    });
    const i = events.indexOf('offRoute');
    expect(events.slice(i, i + 4)).toEqual([
      'offRoute',
      'status:rerouting',
      'reroute:off_route',
      'status:navigating',
    ]);
    // Tuyến mới (cùng fixture): lịch đọc reset. Fix 26 vẫn lệch 89 m nên kiểm bằng một fix đúng tuyến
    // ở giữa step 1 → 'post' của step 1 đọc lại (đã đọc một lần lúc vào step 1 ở fix ~18).
    const postsBefore = events.filter((e) => e === 'announce:post').length;
    nav.update({ ...(simulateFixes(route)[26] as GeoFix), timestamp: fix25.timestamp + 2000 });
    expect(events.filter((e) => e === 'announce:post').length).toBe(postsBefore + 1);
    expect(nav.status).toBe('navigating');
  });

  it('cooldown 15 s giữa hai lần gọi; request giữ via chưa qua', async () => {
    const twoLeg = syntheticTwoLegRoute();
    const directions = vi.fn(async (_o: DirectionsOptions) => twoLeg);
    const nav = createNavigator({ response: twoLeg, provider: { directions } });
    const base = simulateFixes(twoLeg.routes[0] as Route, { speed_mps: 5 });
    // Lệch từ fix 5 (leg 0, chưa qua via ở ~222 m) và giữ lệch tới hết → tính lại nhiều lần.
    const fixes = shiftFrom(base, 5);
    await feed(nav, fixes.slice(0, 40));

    expect(directions.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(directions.mock.calls[0]?.[0].via).toEqual([[10.772, 106.7]]);
    const fixOf = (from: [number, number]): GeoFix =>
      fixes.find((f) => f.lat === from[0] && f.lng === from[1]) as GeoFix;
    const c0 = fixOf(directions.mock.calls[0]?.[0].from as [number, number]);
    const c1 = fixOf(directions.mock.calls[1]?.[0].from as [number, number]);
    // Lần 1 sau khi lệch đủ 3 fix và 5 s (walk: fix 5 → fix 10); lần 2 cách lần 1 ≥ 15 s.
    expect(c0.timestamp).toBeGreaterThanOrEqual((fixes[5] as GeoFix).timestamp + 5000);
    expect(c1.timestamp - c0.timestamp).toBeGreaterThanOrEqual(15_000);
  });

  it('provider lỗi 3 lần → rerouteFailed final, không gọi lần 4 tự động; reroute() tay vẫn gọi', async () => {
    const directions = vi.fn(async (_o: DirectionsOptions): Promise<DirectionsResponse> => {
      throw new Error('503');
    });
    const nav = createNavigator({ response, provider: { directions } });
    const failed: { attempts: number; final: boolean }[] = [];
    nav.on('rerouteFailed', (e) => failed.push({ attempts: e.attempts, final: e.final }));
    const fixes = shiftFrom(simulateFixes(route), 20);
    await feed(nav, fixes.slice(0, 120));

    expect(directions).toHaveBeenCalledTimes(3);
    expect(failed).toEqual([
      { attempts: 1, final: false },
      { attempts: 2, final: false },
      { attempts: 3, final: true },
    ]);
    expect(nav.status).toBe('off_route');

    await nav.reroute();
    expect(directions).toHaveBeenCalledTimes(4);
    expect(failed.at(-1)).toEqual({ attempts: 4, final: true });
  });

  it('kết quả về sau khi người dùng đã quay lại tuyến → bị bỏ, tuyến không đổi', async () => {
    const d = deferred<DirectionsResponse>();
    const directions = vi.fn((_o: DirectionsOptions) => d.promise);
    const nav = createNavigator({ response, provider: { directions } });
    const reroute = vi.fn();
    nav.on('reroute', reroute);
    const clean = simulateFixes(route);
    const fixes = shiftFrom(clean, 20);
    await feed(nav, fixes.slice(0, 26));
    expect(nav.status).toBe('rerouting');
    expect(directions).toHaveBeenCalledTimes(1);

    await feed(nav, clean.slice(26, 30));
    expect(nav.status).toBe('navigating');

    const other: DirectionsResponse = {
      ...response,
      routes: [{ ...route, distance_m: 1 }],
    };
    d.resolve(other);
    await flush();
    expect(reroute).not.toHaveBeenCalled();
    expect(nav.progress?.route.distance_m).toBe(route.distance_m);
  });

  it("reroute 'manual': không gọi provider khi lệch; reroute() gọi và phát reroute:manual", async () => {
    const directions = vi.fn(async (_o: DirectionsOptions) => response);
    const nav = createNavigator({ response, provider: { directions }, reroute: 'manual' });
    const reroute = vi.fn();
    nav.on('reroute', reroute);
    await feed(nav, shiftFrom(simulateFixes(route), 20).slice(0, 40));
    expect(nav.status).toBe('off_route');
    expect(directions).not.toHaveBeenCalled();
    await nav.reroute();
    expect(directions).toHaveBeenCalledTimes(1);
    expect(reroute).toHaveBeenCalledWith({ reason: 'manual', response });
    expect(nav.status).toBe('navigating');
  });

  it('reroute() tay trong lúc đang đúng tuyến không bị fix kế tiếp huỷ', async () => {
    const d = deferred<DirectionsResponse>();
    const directions = vi.fn((_o: DirectionsOptions) => d.promise);
    const nav = createNavigator({ response, provider: { directions } });
    const reroute = vi.fn();
    nav.on('reroute', reroute);
    const clean = simulateFixes(route);
    await feed(nav, clean.slice(0, 10));
    const pending = nav.reroute();
    expect(nav.status).toBe('rerouting');
    await feed(nav, clean.slice(10, 13));
    expect(nav.status).toBe('rerouting');
    d.resolve(response);
    await pending;
    expect(reroute).toHaveBeenCalledWith({ reason: 'manual', response });
    expect(nav.status).toBe('navigating');
  });

  it('reroute() khi chưa có vị trí → ném; sau stop() → không làm gì', async () => {
    const directions = vi.fn(async (_o: DirectionsOptions) => response);
    const nav = createNavigator({ response, provider: { directions } });
    await expect(nav.reroute()).rejects.toThrow(/vị trí/);
    nav.update(simulateFixes(route)[0] as GeoFix);
    nav.stop();
    await nav.reroute();
    expect(directions).not.toHaveBeenCalled();
  });
});
