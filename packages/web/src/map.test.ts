import { attributionHtml } from '@mapslibvn/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMap } from './map';
import { resetProtocolForTests } from './protocol';

function fakeMaplibre() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  // biome-ignore lint/suspicious/noShadowRestrictedNames: tên phải khớp API maplibregl.Map
  class Map {
    options: Record<string, unknown>;
    addControl = vi.fn();
    fitBounds = vi.fn();
    flyTo = vi.fn();
    remove = vi.fn();
    getLayer = vi.fn(() => ({ id: 'poi' }));
    getStyle = vi.fn(() => ({ layers: [] }));
    setLayoutProperty = vi.fn();
    getSource = vi.fn(() => undefined);
    isStyleLoaded = vi.fn(() => true);
    off = vi.fn();
    easeTo = vi.fn();
    queryRenderedFeatures = vi.fn(() => [
      {
        properties: { id: 'p1', name: 'Cafe Cây Bồ Đề', cat: 'cafe', grp: 'food_drink' },
        geometry: { type: 'Point', coordinates: [106.6631, 10.7652] },
      },
    ]);
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
    on(ev: string, fn: (e: unknown) => void) {
      handlers[ev] ??= [];
      handlers[ev].push(fn);
      return this;
    }
    once(ev: string, fn: (e: unknown) => void) {
      return this.on(ev, fn);
    }
  }
  class Marker {
    setLngLat = vi.fn(() => this);
    setPopup = vi.fn(() => this);
    addTo = vi.fn(() => this);
    remove = vi.fn();
  }
  class Popup {
    setHTML = vi.fn(() => this);
    setText = vi.fn(() => this);
  }
  class AttributionControl {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }
  return {
    ml: { Map, Marker, Popup, AttributionControl, addProtocol: vi.fn() },
    fire: (ev: string, e?: unknown) => {
      for (const fn of handlers[ev] ?? []) fn(e);
    },
  };
}

const base = { container: {} as HTMLElement, apiKey: 'mlv_live_t', apiBase: 'https://api.test' };

beforeEach(() => resetProtocolForTests());

describe('createMap', () => {
  it('đăng ký pmtiles một lần, dùng style URL từ core, tắt attribution mặc định rồi ép bật control riêng', () => {
    const { ml } = fakeMaplibre();
    const m1 = createMap(base, { maplibre: ml as never });
    createMap({ ...base, style: 'dark' }, { maplibre: ml as never });
    expect(ml.addProtocol).toHaveBeenCalledTimes(1);
    expect(ml.addProtocol.mock.calls[0]?.[0]).toBe('pmtiles');
    const opts = (m1.gl as unknown as { options: Record<string, unknown> }).options;
    expect(opts.style).toBe(
      'https://api.test/v1/styles/light.json?key=mlv_live_t&sources=osm%2Cfsq',
    );
    expect(opts.attributionControl).toBe(false);
    const ctl = (m1.gl.addControl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      options: Record<string, unknown>;
    };
    // Control luôn có (không tắt được), nhưng theme của MapsLibVN KHÔNG nhận chuỗi riêng của SDK:
    // style do API phục vụ đã mang chuỗi đầy đủ ở source `openmaptiles`. Thêm chuỗi của SDK thì chỉ
    // cần SDK khác phiên bản với API (0.14.0 trỏ repo, API 0.14.1 trỏ website) là MapLibre hiện hai
    // lần, vì nó chỉ gộp chuỗi trùng khít (sự cố 23/09/2026).
    expect('customAttribution' in ctl.options).toBe(false);
  });

  it('theme tối cũng để style tự khai ghi nguồn', () => {
    const { ml } = fakeMaplibre();
    const m = createMap({ ...base, style: 'dark' }, { maplibre: ml as never });
    const ctl = (m.gl.addControl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      options: Record<string, unknown>;
    };
    expect('customAttribution' in ctl.options).toBe(false);
  });

  it('style URL tuỳ biến cũng nhận chuỗi ghi nguồn đầy đủ', () => {
    const { ml } = fakeMaplibre();
    const m = createMap({ ...base, style: 'https://x/style.json' }, { maplibre: ml as never });
    const ctl = (m.gl.addControl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      options: { customAttribution: string };
    };
    // Không biết style lạ có ghi nguồn hay không, nên phải thêm đủ.
    expect(ctl.options.customAttribution).toBe(attributionHtml());
  });

  it('poiSources đi vào style URL và client Places; giá trị lạ → ném lỗi sớm', () => {
    const { ml } = fakeMaplibre();
    const m = createMap({ ...base, poiSources: ['osm'] }, { maplibre: ml as never });
    expect((m.gl as unknown as { options: Record<string, unknown> }).options.style).toBe(
      'https://api.test/v1/styles/light.json?key=mlv_live_t&sources=osm',
    );
    expect(m.places.styleUrl('dark')).toContain('sources=osm');
    // Mọi tổ hợp hợp lệ của osm/fsq đều có profile; chỉ giá trị ngoài POI_SOURCES mới bị chặn.
    expect(() =>
      createMap({ ...base, poiSources: ['overture' as never] }, { maplibre: ml as never }),
    ).toThrowError(/poiSources "overture".*osm,fsq/);
  });

  it('profile Foursquare đi vào map style và client Places', () => {
    const { ml } = fakeMaplibre();
    const m = createMap({ ...base, poiSources: ['fsq'] }, { maplibre: ml as never });
    expect((m.gl as unknown as { options: Record<string, unknown> }).options.style).toMatch(
      /sources=fsq$/,
    );
    expect(m.places.styleUrl('dark')).toMatch(/sources=fsq$/);
  });

  it('profile OSM + Foursquare đi vào map style và client Places', () => {
    const { ml } = fakeMaplibre();
    const m = createMap({ ...base, poiSources: ['fsq', 'osm'] }, { maplibre: ml as never });
    expect((m.gl as unknown as { options: Record<string, unknown> }).options.style).toContain(
      'sources=osm%2Cfsq',
    );
    expect(m.places.styleUrl('dark')).toContain('sources=osm%2Cfsq');
  });

  it('style là URL tuỳ biến thì giữ nguyên', () => {
    const { ml } = fakeMaplibre();
    const m = createMap({ ...base, style: 'https://x/style.json' }, { maplibre: ml as never });
    expect((m.gl as unknown as { options: Record<string, unknown> }).options.style).toBe(
      'https://x/style.json',
    );
  });

  it('addMarker đặt toạ độ, popup và thêm vào map', () => {
    const { ml } = fakeMaplibre();
    const m = createMap(base, { maplibre: ml as never });
    const marker = m.addMarker({ lng: 106.7, lat: 10.77, popupHtml: '<b>Hi</b>' }) as unknown as {
      setLngLat: ReturnType<typeof vi.fn>;
      setPopup: ReturnType<typeof vi.fn>;
      addTo: ReturnType<typeof vi.fn>;
    };
    expect(marker.setLngLat).toHaveBeenCalledWith([106.7, 10.77]);
    expect(marker.setPopup).toHaveBeenCalled();
    expect(marker.addTo).toHaveBeenCalledWith(m.gl);
  });

  it('addMarker với popupText dùng setText, không bao giờ parse HTML', () => {
    const { ml } = fakeMaplibre();
    const m = createMap(base, { maplibre: ml as never });
    const marker = m.addMarker({
      lng: 106.7,
      lat: 10.77,
      popupText: '<b>Tên POI</b>',
    }) as unknown as {
      setPopup: ReturnType<typeof vi.fn>;
    };
    const popup = marker.setPopup.mock.calls[0]?.[0] as {
      setText: ReturnType<typeof vi.fn>;
      setHTML: ReturnType<typeof vi.fn>;
    };
    expect(popup.setText).toHaveBeenCalledWith('<b>Tên POI</b>');
    expect(popup.setHTML).not.toHaveBeenCalled();
  });

  it('poiClick nhận feature từ lớp poi khi click', () => {
    const { ml, fire } = fakeMaplibre();
    const m = createMap(base, { maplibre: ml as never });
    const handler = vi.fn();
    m.on('poiClick', handler);
    fire('click', { point: { x: 1, y: 2 } });
    expect(handler).toHaveBeenCalledWith({
      id: 'p1',
      name: 'Cafe Cây Bồ Đề',
      category: 'cafe',
      group: 'food_drink',
      lngLat: [106.6631, 10.7652],
    });
  });

  it('lang=en áp dụng sau khi style load', () => {
    const { ml, fire } = fakeMaplibre();
    const m = createMap({ ...base, lang: 'en' }, { maplibre: ml as never });
    (m.gl.getStyle as ReturnType<typeof vi.fn>).mockReturnValue({
      layers: [{ id: 'city', type: 'symbol', layout: { 'text-field': ['get', 'name'] } }],
    });
    fire('load');
    expect(m.gl.setLayoutProperty).toHaveBeenCalledWith('city', 'text-field', [
      'coalesce',
      ['get', 'name:en'],
      ['get', 'name'],
    ]);
  });

  it('poiLayer=false ẩn mọi layer source poi sau khi style load', () => {
    const { ml, fire } = fakeMaplibre();
    const m = createMap({ ...base, poiLayer: false }, { maplibre: ml as never });
    (m.gl.getStyle as ReturnType<typeof vi.fn>).mockReturnValue({
      layers: [
        { id: 'poi', type: 'symbol', source: 'poi' },
        { id: 'poi-label-major', type: 'symbol', source: 'poi' },
        { id: 'poi-label-local', type: 'symbol', source: 'poi' },
        { id: 'city', type: 'symbol', source: 'vn' },
      ],
    });
    fire('load');
    expect(m.gl.setLayoutProperty).toHaveBeenCalledTimes(3);
    for (const id of ['poi', 'poi-label-major', 'poi-label-local']) {
      expect(m.gl.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'none');
    }
  });

  it('places là client core với cùng key', () => {
    const { ml } = fakeMaplibre();
    const m = createMap(base, { maplibre: ml as never });
    expect(m.places.styleUrl('light')).toContain('key=mlv_live_t');
  });

  it('có routes và navigation; remove() dừng dẫn đường, xoá tuyến rồi gl.remove()', () => {
    const { ml } = fakeMaplibre();
    const m = createMap(base, { maplibre: ml as never });
    expect(typeof m.routes.show).toBe('function');
    expect(m.navigation.status).toBe('idle');
    m.remove();
    expect(m.gl.remove).toHaveBeenCalledTimes(1);
  });
});
