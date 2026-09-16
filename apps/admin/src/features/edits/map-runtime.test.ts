// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapPlan } from './edit-map';
import { createMapOnto, type MapDeps } from './map-runtime';

/**
 * Bản giả của `createMap` trong @mapslibvn/web. Tiêm được vì SDK nhận `deps.maplibre`; nhờ vậy
 * kiểm được toàn bộ phần dựng bản đồ mà không cần WebGL.
 */
function fakeSdk() {
  const gl = {
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'styledata') handler();
    }),
    isStyleLoaded: vi.fn(() => true),
    addSource: vi.fn(),
    addLayer: vi.fn(),
  };
  const map = {
    gl,
    addMarker: vi.fn(),
    fitBounds: vi.fn(),
    remove: vi.fn(),
  };
  const createMap = vi.fn(() => map);
  const deps = {
    createMap: createMap as unknown as MapDeps['createMap'],
    maplibre: {} as MapDeps['maplibre'],
  };
  return { deps, createMap, map, gl };
}

const SO_SANH: MapPlan = {
  mode: 'so-sanh',
  before: { lat: 10.7721, lng: 106.7012 },
  after: { lat: 10.7748, lng: 106.7031 },
  distanceM: 340,
};

const MOT_CHOT: MapPlan = {
  mode: 'mot-chot',
  point: { lat: 10.78, lng: 106.7 },
  nearby: [
    { id: 'p2', name: 'Quán khác', category: null, lat: 10.7801, lng: 106.7002, distance_m: 40 },
  ],
};

beforeEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('createMapOnto', () => {
  it('dựng bản đồ qua SDK chứ không tự gọi maplibre — SDK lo giao thức pmtiles và style', () => {
    const { deps, createMap } = fakeSdk();
    createMapOnto(deps, document.createElement('div'), SO_SANH);
    expect(createMap).toHaveBeenCalledOnce();
    const [opts, injected] = createMap.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(opts.style).toBe('light');
    expect(injected.maplibre).toBe(deps.maplibre);
  });

  it('nền tối thì yêu cầu style tối', () => {
    document.documentElement.classList.add('dark');
    const { deps, createMap } = fakeSdk();
    createMapOnto(deps, document.createElement('div'), SO_SANH);
    expect((createMap.mock.calls[0] as unknown as [{ style: string }])[0].style).toBe('dark');
  });

  it('gọi API cùng origin và không nhúng khoá thật vào bundle', () => {
    const { deps, createMap } = fakeSdk();
    createMapOnto(deps, document.createElement('div'), SO_SANH);
    const opts = (createMap.mock.calls[0] as unknown as [Record<string, string>])[0];
    expect(opts.apiBase).toBe(location.origin);
    expect(opts.apiKey).not.toMatch(/^mlv_live_/);
  });

  it('so-sanh: hai chốt và canh khung cho cả hai cùng lọt', () => {
    const { deps, map } = fakeSdk();
    createMapOnto(deps, document.createElement('div'), SO_SANH);
    expect(map.addMarker).toHaveBeenCalledTimes(2);
    expect(map.fitBounds).toHaveBeenCalledOnce();
  });

  it('mot-chot: một chốt chính cộng mỗi POI lân cận một chốt, không canh khung', () => {
    const { deps, map } = fakeSdk();
    createMapOnto(deps, document.createElement('div'), MOT_CHOT);
    expect(map.addMarker).toHaveBeenCalledTimes(2);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it('so-sanh: vẽ đường nối khi style đã tải xong', () => {
    const { deps, gl } = fakeSdk();
    createMapOnto(deps, document.createElement('div'), SO_SANH);
    expect(gl.addSource).toHaveBeenCalledOnce();
    expect(gl.addLayer).toHaveBeenCalledOnce();
  });

  it('mot-chot: không vẽ đường nối', () => {
    const { deps, gl } = fakeSdk();
    createMapOnto(deps, document.createElement('div'), MOT_CHOT);
    expect(gl.addLayer).not.toHaveBeenCalled();
  });

  it('nhánh không vẽ thì không đụng tới SDK', () => {
    const { deps, createMap } = fakeSdk();
    createMapOnto(deps, document.createElement('div'), { mode: 'khong-ve' });
    expect(createMap).not.toHaveBeenCalled();
  });

  it('bản đồ báo lỗi thì gọi onError kèm nội dung, không im lặng', () => {
    const { deps, gl } = fakeSdk();
    const onError = vi.fn();
    createMapOnto(deps, document.createElement('div'), SO_SANH, onError);

    const errorHandler = gl.on.mock.calls.find((call) => call[0] === 'error')?.[1] as
      | ((payload: unknown) => void)
      | undefined;
    errorHandler?.({ error: new Error('Bad response code: 404') });
    expect(onError).toHaveBeenCalledWith('Bad response code: 404');
  });
});
