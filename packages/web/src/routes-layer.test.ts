import type { DirectionsResponse, FleetPlanResponse } from '@mapslibvn/core';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import fleetFixture from '../../core/tests/fixtures/fleet-plan-q1.json';
import {
  createRoutesLayer,
  FLEET_SOURCE_ID,
  ROUTE_LAYER_IDS,
  ROUTE_SOURCE_ID,
} from './routes-layer';

const response = fixture as unknown as DirectionsResponse;
const withAlt: DirectionsResponse = {
  ...response,
  routes: [
    response.routes[0],
    { ...response.routes[0], distance_m: 1 },
  ] as DirectionsResponse['routes'],
};

function fakeGl(symbolFirst = true) {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const setData = vi.fn();
  const sources = new Set<string>();
  const layers: { id: string; before?: string }[] = [];
  const gl = {
    isStyleLoaded: vi.fn(() => true),
    getStyle: vi.fn(() => ({
      layers: symbolFirst
        ? [
            { id: 'water', type: 'fill' },
            { id: 'road-label', type: 'symbol' },
            { id: 'poi', type: 'symbol' },
          ]
        : [{ id: 'water', type: 'fill' }],
    })),
    getSource: vi.fn((id: string) => (sources.has(id) ? { setData } : undefined)),
    addSource: vi.fn((id: string) => sources.add(id)),
    addLayer: vi.fn((layer: { id: string }, before?: string) =>
      layers.push(before === undefined ? { id: layer.id } : { id: layer.id, before }),
    ),
    on: vi.fn((ev: string, a: unknown, b?: unknown) => {
      const key = typeof a === 'string' ? `${ev}:${a}` : ev;
      const fn = (typeof a === 'string' ? b : a) as (e: unknown) => void;
      handlers[key] ??= [];
      handlers[key].push(fn);
    }),
    once: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] ??= [];
      handlers[ev].push(fn);
    }),
  };
  const markers: { options: { color?: string }; lngLat?: unknown; removed: boolean }[] = [];
  class Marker {
    entry: { options: { color?: string }; lngLat?: unknown; removed: boolean };
    constructor(options: { color?: string }) {
      this.entry = { options, removed: false };
      markers.push(this.entry);
    }
    setLngLat = vi.fn((lngLat: unknown) => {
      this.entry.lngLat = lngLat;
      return this;
    });
    addTo = vi.fn(() => this);
    remove = vi.fn(() => {
      this.entry.removed = true;
    });
  }
  return {
    gl,
    ml: { Marker },
    setData,
    layers,
    markers,
    resetSources: () => sources.clear(),
    fire: (key: string, e?: unknown) => {
      for (const fn of handlers[key] ?? []) fn(e);
    },
  };
}

const lastData = (setData: ReturnType<typeof vi.fn>) =>
  setData.mock.calls.at(-1)?.[0] as {
    features: {
      properties: { kind: string; index: number };
      geometry: { coordinates: number[][] };
    }[];
  };

describe('createRoutesLayer', () => {
  it('show: một source, bốn layer chèn trước symbol đầu tiên, feature active, marker đích', () => {
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    routes.show(response);
    expect(f.gl.addSource).toHaveBeenCalledWith(
      ROUTE_SOURCE_ID,
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(f.layers.map((l) => l.id)).toEqual([
      ROUTE_LAYER_IDS.alt,
      ROUTE_LAYER_IDS.casing,
      ROUTE_LAYER_IDS.line,
      ROUTE_LAYER_IDS.traveled,
    ]);
    expect(f.layers.every((l) => l.before === 'road-label')).toBe(true);
    const data = lastData(f.setData);
    expect(data.features.map((x) => x.properties.kind)).toEqual(['active']);
    expect(data.features[0]?.geometry.coordinates.length).toBeGreaterThan(30);
    // Marker cho đích (waypoint cuối) màu đỏ, không có marker cho điểm đi
    expect(f.markers).toHaveLength(1);
    expect(f.markers[0]?.options.color).toBe('#d92d20');
    expect(f.markers[0]?.lngLat).toEqual(response.waypoints[1]?.snapped);
  });

  it('style không có symbol → chèn trên cùng (before undefined); show lần hai không thêm source/layer lại', () => {
    const f = fakeGl(false);
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    routes.show(response);
    routes.show(response);
    expect(f.layers).toHaveLength(4);
    expect(f.layers[0]?.before).toBeUndefined();
    expect(f.gl.addSource).toHaveBeenCalledTimes(1);
  });

  it('tuyến thay thế là alt; setActive đổi vai; bấm alt → onRouteClick(index)', () => {
    const f = fakeGl();
    const onRouteClick = vi.fn();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, onRouteClick);
    routes.show(withAlt, { active: 0 });
    let data = lastData(f.setData);
    // `alt` luôn đứng trước phần sống trong collection; thứ tự vẽ do layer quyết, không do thứ tự này.
    expect(data.features.map((x) => [x.properties.kind, x.properties.index])).toEqual([
      ['alt', 1],
      ['active', 0],
    ]);
    routes.setActive(1);
    data = lastData(f.setData);
    expect(data.features.map((x) => [x.properties.kind, x.properties.index])).toEqual([
      ['alt', 0],
      ['active', 1],
    ]);
    f.fire(`click:${ROUTE_LAYER_IDS.alt}`, {
      features: [{ properties: { kind: 'alt', index: 0 } }],
    });
    expect(onRouteClick).toHaveBeenCalledWith(0);
  });

  it('setProgress chia traveled/active tại điểm bám; clear gỡ marker và xoá dữ liệu', () => {
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    routes.show(response);
    routes.setProgress(5, [106.6985, 10.7791]);
    const data = lastData(f.setData);
    expect(data.features.map((x) => x.properties.kind)).toEqual(['traveled', 'active']);
    expect(data.features[0]?.geometry.coordinates).toHaveLength(7); // 6 đỉnh + điểm bám
    expect(data.features[0]?.geometry.coordinates.at(-1)).toEqual([106.6985, 10.7791]);
    expect(data.features[1]?.geometry.coordinates[0]).toEqual([106.6985, 10.7791]);
    routes.clear();
    expect(lastData(f.setData).features).toEqual([]);
    expect(f.markers.every((m) => m.removed)).toBe(true);
  });

  it('style chưa phân giải xong → hoãn tới style.load; đổi style về sau → dựng lại source/layer', () => {
    // Điều kiện hoãn là maplibre THẬT SỰ từ chối (`Style is not done loading.`), không phải
    // `isStyleLoaded()` — hàm đó còn đòi tile và ảnh tải xong nên nó false cả lúc thêm layer đang
    // hoàn toàn hợp lệ, và hoãn theo nó là hoãn vĩnh viễn.
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    f.gl.addSource.mockImplementationOnce(() => {
      throw new Error('Style is not done loading.');
    });

    routes.show(response);
    expect(f.gl.getSource(ROUTE_SOURCE_ID)).toBeUndefined();
    f.fire('style.load');
    expect(f.gl.addSource).toHaveBeenCalledTimes(2);

    // Đổi style: style mới không còn source → dựng lại
    f.resetSources();
    f.fire('style.load');
    expect(f.gl.addSource).toHaveBeenCalledTimes(3);
  });
});

describe('vẽ tuyến khi bắt đầu dẫn đường', () => {
  it('tile còn đang tải vẫn phải vẽ — `isStyleLoaded()` KHÔNG phải câu hỏi đúng', () => {
    // `Style.loaded()` của maplibre 6.9.1 còn đòi mọi tile và ảnh tải xong; còn `addSource` chỉ đòi
    // style đã phân giải (`_checkLoaded` chỉ xem `_loaded`). Bấm dẫn đường lúc bản đồ đang kéo/phóng
    // là `isStyleLoaded()` false trong khi `style.load` đã bắn từ lâu và không bao giờ bắn lại —
    // tuyến không bao giờ được vẽ. Đúng hình dạng "lúc được lúc không" PHONG báo 17/09/2026.
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    f.gl.isStyleLoaded.mockReturnValue(false);

    routes.show(response);

    expect(f.gl.addSource).toHaveBeenCalledWith(
      ROUTE_SOURCE_ID,
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(lastData(f.setData).features.map((x) => x.properties.kind)).toEqual(['active']);
  });

  it('định vị về sau vẫn vẽ được dù lượt show đầu rơi vào lúc style chưa phân giải', () => {
    // Đường này im lặng theo đúng nghĩa đen: `setData()` dùng `source?.setData(...)`, nên khi
    // chưa có source thì mỗi lần định vị trôi qua không để lại dấu vết nào.
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    f.gl.addSource.mockImplementationOnce(() => {
      throw new Error('Style is not done loading.');
    });

    expect(() => routes.show(response)).not.toThrow();
    f.fire('style.load');
    routes.setProgress(3, [106.7, 10.77]);

    expect(f.gl.addSource).toHaveBeenCalledTimes(2);
    const kinds = lastData(f.setData).features.map((x) => x.properties.kind);
    expect(kinds).toContain('traveled');
    expect(kinds).toContain('active');
  });
});

describe('không im lặng khi không có chỗ vẽ', () => {
  it('có tuyến mà thiếu source → cảnh báo đúng một lần, không phải mỗi lần định vị', () => {
    const f = fakeGl();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    f.gl.addSource.mockImplementation(() => {
      throw new Error('Style is not done loading.');
    });

    routes.show(response);
    routes.setProgress(1, [106.7, 10.77]);
    routes.setProgress(2, [106.71, 10.78]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('tuyến sẽ không hiện');
    warn.mockRestore();
  });

  it('chưa có tuyến thì im lặng — clear() lúc chưa vẽ gì là chuyện bình thường', () => {
    const f = fakeGl();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());

    routes.clear();
    routes.setActive(1);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

const plan = fleetFixture as unknown as FleetPlanResponse;
type FleetProps = { kind: string; index: number; color: string; opacity: number };
const fleetData = (setData: ReturnType<typeof vi.fn>) =>
  setData.mock.calls.at(-1)?.[0] as { features: { properties: FleetProps }[] };

describe('showFleet', () => {
  it('source riêng + hai layer data-driven trước symbol; mỗi xe một feature fleet; marker màu xe tại từng đơn', () => {
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    routes.showFleet(plan);
    expect(f.gl.addSource).toHaveBeenCalledWith(
      FLEET_SOURCE_ID,
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(f.layers.map((l) => l.id)).toEqual([
      ROUTE_LAYER_IDS.fleetCasing,
      ROUTE_LAYER_IDS.fleetLine,
    ]);
    expect(f.layers.every((l) => l.before === 'road-label')).toBe(true);
    const data = fleetData(f.setData);
    expect(
      data.features.map((x) => [x.properties.kind, x.properties.index, x.properties.opacity]),
    ).toEqual([
      ['fleet', 0, 1],
      ['fleet', 1, 1],
    ]);
    expect(data.features[0]?.properties.color).toBe('#0072b2');
    expect(data.features[1]?.properties.color).toBe('#d55e00');
    const soDon = plan.vehicles.reduce((sum, v) => sum + v.jobs.length, 0);
    expect(f.markers).toHaveLength(soDon);
    expect(f.markers[0]?.options.color).toBe('#0072b2');
    expect(f.markers[0]?.lngLat).toEqual(plan.vehicles[0]?.waypoints[1]?.snapped);
  });

  it('setActive mờ xe khác; bấm tuyến → onRouteClick(index xe); markers:false; show() xoá đội xe và ngược lại; clear xoá cả hai', () => {
    const f = fakeGl();
    const onRouteClick = vi.fn();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, onRouteClick);
    routes.showFleet(plan, { markers: false, colors: ['#111111', '#222222'] });
    expect(f.markers).toHaveLength(0);
    routes.setActive(1);
    let data = fleetData(f.setData);
    expect(data.features.map((x) => x.properties.opacity)).toEqual([0.35, 1]);
    expect(data.features[1]?.properties.color).toBe('#222222');
    f.fire(`click:${ROUTE_LAYER_IDS.fleetLine}`, {
      features: [{ properties: { kind: 'fleet', index: 1 } }],
    });
    expect(onRouteClick).toHaveBeenCalledWith(1);
    // setProgress không có nghĩa ở chế độ đội xe: không đổi dữ liệu.
    const truoc = f.setData.mock.calls.length;
    routes.setProgress(3, [106.7, 10.77]);
    expect(f.setData.mock.calls.length).toBe(truoc);
    // Chuyển sang tuyến thường: source đội xe được xoá rỗng trước khi vẽ tuyến.
    const lanGoi = f.setData.mock.calls.length;
    routes.show(response);
    const sauShow = f.setData.mock.calls.slice(lanGoi).map((c) => c[0] as { features: unknown[] });
    expect(sauShow[0]?.features).toEqual([]);
    routes.showFleet(plan);
    routes.clear();
    data = fleetData(f.setData);
    expect(data.features).toEqual([]);
    expect(f.markers.every((m) => m.removed)).toBe(true);
  });

  it('style chưa phân giải → hoãn tới style.load rồi dựng lại source đội xe', () => {
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    f.gl.addSource.mockImplementationOnce(() => {
      throw new Error('Style is not done loading.');
    });
    routes.showFleet(plan);
    expect(f.gl.getSource(FLEET_SOURCE_ID)).toBeUndefined();
    f.fire('style.load');
    expect(f.gl.getSource(FLEET_SOURCE_ID)).toBeDefined();
    expect(fleetData(f.setData).features).toHaveLength(2);
  });
});
