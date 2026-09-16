// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapPlan } from './edit-map';
import { createMapOnto, type MaplibreLike, resetProtocolForTests } from './map-runtime';

/** Ghi lại thứ tự lời gọi để khẳng định được "đăng ký giao thức TRƯỚC khi tạo Map". */
function fakeMaplibre(order: string[]) {
  const handlers: Record<string, (payload?: unknown) => void> = {};
  const map = {
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      handlers[event] = handler;
      if (event === 'styledata') handler();
    }),
    isStyleLoaded: vi.fn(() => true),
    addSource: vi.fn(() => order.push('addSource')),
    addLayer: vi.fn(() => order.push('addLayer')),
    fitBounds: vi.fn(() => order.push('fitBounds')),
  };
  const marker = {
    setLngLat: vi.fn(() => marker),
    setPopup: vi.fn(() => marker),
    addTo: vi.fn(() => marker),
  };
  const popup = { setText: vi.fn(() => popup) };

  // Hàm mũi tên KHÔNG dùng được với `new` — bản giả của Map/Marker/Popup phải là function thường.
  const maplibre = {
    addProtocol: vi.fn(() => order.push('addProtocol')),
    Map: vi.fn(function FakeMap() {
      order.push('Map');
      return map;
    }),
    Marker: vi.fn(function FakeMarker() {
      order.push('Marker');
      return marker;
    }),
    Popup: vi.fn(function FakePopup() {
      return popup;
    }),
  } as unknown as MaplibreLike;

  return { maplibre, map, marker, handlers };
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
  resetProtocolForTests();
  document.documentElement.classList.remove('dark');
});

describe('createMapOnto', () => {
  it('đăng ký giao thức pmtiles TRƯỚC khi tạo Map', () => {
    const order: string[] = [];
    const { maplibre } = fakeMaplibre(order);
    createMapOnto(maplibre, document.createElement('div'), SO_SANH);
    expect(order[0]).toBe('addProtocol');
    expect(order).toContain('Map');
    expect(order.indexOf('addProtocol')).toBeLessThan(order.indexOf('Map'));
  });

  it('đăng ký đúng tên giao thức mà style dùng', () => {
    const order: string[] = [];
    const { maplibre } = fakeMaplibre(order);
    createMapOnto(maplibre, document.createElement('div'), SO_SANH);
    expect(maplibre.addProtocol).toHaveBeenCalledWith('pmtiles', expect.any(Function));
  });

  it('chỉ đăng ký một lần dù dựng bản đồ nhiều lần', () => {
    const order: string[] = [];
    const { maplibre } = fakeMaplibre(order);
    createMapOnto(maplibre, document.createElement('div'), SO_SANH);
    createMapOnto(maplibre, document.createElement('div'), MOT_CHOT);
    expect(maplibre.addProtocol).toHaveBeenCalledOnce();
  });

  it('nền sáng dùng style light, nền tối dùng style dark', () => {
    const order: string[] = [];
    const { maplibre } = fakeMaplibre(order);
    createMapOnto(maplibre, document.createElement('div'), SO_SANH);
    expect(vi.mocked(maplibre.Map).mock.calls[0]?.[0]).toMatchObject({
      style: '/v1/styles/light.json',
    });

    resetProtocolForTests();
    document.documentElement.classList.add('dark');
    const second = fakeMaplibre([]);
    createMapOnto(second.maplibre, document.createElement('div'), SO_SANH);
    expect(vi.mocked(second.maplibre.Map).mock.calls[0]?.[0]).toMatchObject({
      style: '/v1/styles/dark.json',
    });
  });

  it('so-sanh: hai chốt, một đường nối và canh khung cho cả hai cùng lọt', () => {
    const order: string[] = [];
    const { maplibre, map } = fakeMaplibre(order);
    createMapOnto(maplibre, document.createElement('div'), SO_SANH);
    expect(maplibre.Marker).toHaveBeenCalledTimes(2);
    expect(map.addSource).toHaveBeenCalledOnce();
    expect(map.addLayer).toHaveBeenCalledOnce();
    expect(map.fitBounds).toHaveBeenCalledOnce();
  });

  it('mot-chot: một chốt chính cộng mỗi POI lân cận một chốt, không vẽ đường nối', () => {
    const order: string[] = [];
    const { maplibre, map } = fakeMaplibre(order);
    createMapOnto(maplibre, document.createElement('div'), MOT_CHOT);
    expect(maplibre.Marker).toHaveBeenCalledTimes(2); // 1 lân cận + 1 chính
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it('nhánh không vẽ thì không đụng tới maplibre', () => {
    const order: string[] = [];
    const { maplibre } = fakeMaplibre(order);
    createMapOnto(maplibre, document.createElement('div'), { mode: 'khong-ve' });
    expect(maplibre.Map).not.toHaveBeenCalled();
    expect(maplibre.addProtocol).not.toHaveBeenCalled();
  });

  it('bản đồ báo lỗi thì gọi onError kèm nội dung lỗi, không im lặng', () => {
    const order: string[] = [];
    const { maplibre, handlers } = fakeMaplibre(order);
    const onError = vi.fn();
    createMapOnto(maplibre, document.createElement('div'), SO_SANH, onError);

    handlers.error?.({ error: new Error('Bad response code: 404') });
    expect(onError).toHaveBeenCalledWith('Bad response code: 404');
  });

  it('lỗi không có thông điệp vẫn báo ra một câu đọc được', () => {
    const order: string[] = [];
    const { maplibre, handlers } = fakeMaplibre(order);
    const onError = vi.fn();
    createMapOnto(maplibre, document.createElement('div'), SO_SANH, onError);

    handlers.error?.({});
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/./));
  });
});
