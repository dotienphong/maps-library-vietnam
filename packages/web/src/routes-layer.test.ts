import type { DirectionsResponse } from '@mapslibvn/core';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import { ROUTE_LAYER_IDS, ROUTE_SOURCE_ID, createRoutesLayer } from './routes-layer';

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
    expect(data.features.map((x) => [x.properties.kind, x.properties.index])).toEqual([
      ['active', 0],
      ['alt', 1],
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

  it('style chưa load → chờ style.load rồi mới thêm; style.load về sau (đổi style) → thêm lại source/layer', () => {
    const f = fakeGl();
    f.gl.isStyleLoaded.mockReturnValueOnce(false);
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    routes.show(response);
    expect(f.gl.addSource).not.toHaveBeenCalled();
    f.fire('style.load');
    expect(f.gl.addSource).toHaveBeenCalledTimes(1);
    // Đổi style: style mới không còn source → thêm lại
    f.resetSources();
    f.fire('style.load');
    expect(f.gl.addSource).toHaveBeenCalledTimes(2);
  });
});
