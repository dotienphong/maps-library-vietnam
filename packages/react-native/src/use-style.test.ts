// @vitest-environment jsdom
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { createClient, type MapsLibVNClient, nameExpression } from '@mapslibvn/core';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearStyleCache,
  needsTransform,
  styleUrlFor,
  transformStyle,
  useResolvedStyle,
} from './use-style';

// Cache style sống theo tiến trình → phải xoá giữa các test, nếu không test sau ăn JSON của test trước.
beforeEach(clearStyleCache);

const places: MapsLibVNClient = createClient({ apiKey: 'mlv_live_k', baseUrl: 'https://api.test' });

// Cast vì kiểu expression của style-spec là union tuple hẹp; runtime chỉ cần shape này.
const styleJson = {
  version: 8,
  sources: {},
  layers: [
    { id: 'city', type: 'symbol', source: 's', layout: { 'text-field': ['get', 'name'] } },
    { id: 'poi', type: 'symbol', source: 'poi', layout: { 'icon-image': 'marker' } },
    {
      id: 'poi-label-major',
      type: 'symbol',
      source: 'poi',
      layout: { 'text-field': ['get', 'name'] },
    },
    {
      id: 'poi-label-local',
      type: 'symbol',
      source: 'poi',
      layout: { 'text-field': ['get', 'name'] },
    },
  ],
} as unknown as StyleSpecification;

describe('styleUrlFor / needsTransform / transformStyle', () => {
  it('theme → styleUrl của core; chuỗi khác → giữ nguyên', () => {
    expect(styleUrlFor(places, 'dark')).toBe(
      'https://api.test/v1/styles/dark.json?key=mlv_live_k&sources=osm%2Cfsq',
    );
    expect(styleUrlFor(places, 'https://x.test/s.json')).toBe('https://x.test/s.json');
  });

  it('chỉ cần biến đổi khi lang khác vi hoặc ẩn POI', () => {
    expect(needsTransform({ lang: 'vi', poiLayer: true })).toBe(false);
    expect(needsTransform({ lang: 'en', poiLayer: true })).toBe(true);
    expect(needsTransform({ lang: 'vi', poiLayer: false })).toBe(true);
  });

  it('transformStyle áp cả ngôn ngữ và ẩn POI', () => {
    const out = transformStyle(styleJson, { lang: 'en', poiLayer: false });
    expect(out.layers[0]?.layout).toEqual({ 'text-field': nameExpression('en') });
    const layers = out.layers as unknown as {
      source?: string;
      layout?: Record<string, unknown>;
    }[];
    const poiLayers = layers.filter((layer) => layer.source === 'poi');
    expect(poiLayers).toHaveLength(3);
    for (const layer of poiLayers) expect(layer.layout?.visibility).toBe('none');
    expect(poiLayers[1]?.layout?.['text-field']).toEqual(nameExpression('en'));
    expect(poiLayers[2]?.layout?.['text-field']).toEqual(nameExpression('en'));
  });
});

describe('useResolvedStyle', () => {
  it('mặc định trả URL ngay, không fetch', () => {
    const doFetch = vi.fn();
    const { result } = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'vi', poiLayer: true }, doFetch as never),
    );
    expect(result.current).toEqual({
      status: 'ready',
      mapStyle: 'https://api.test/v1/styles/light.json?key=mlv_live_k&sources=osm%2Cfsq',
    });
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('lang=en: loading → fetch URL → ready với object đã biến đổi', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify(styleJson), { status: 200 }));
    const { result } = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'en', poiLayer: true }, doFetch as never),
    );
    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(doFetch).toHaveBeenCalledWith(
      'https://api.test/v1/styles/light.json?key=mlv_live_k&sources=osm%2Cfsq',
    );
    const ready = result.current as { status: 'ready'; mapStyle: StyleSpecification };
    expect(ready.mapStyle.layers[0]?.layout).toEqual({ 'text-field': nameExpression('en') });
  });

  it('fetch lỗi → error có thông điệp tiếng Việt', async () => {
    const doFetch = vi.fn(async () => new Response('x', { status: 500 }));
    const { result } = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'vi', poiLayer: false }, doFetch as never),
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect((result.current as { error: Error }).error.message).toMatch(/Không tải được style/);
  });
});

describe('useResolvedStyle — cache style JSON (A1)', () => {
  it('mount lần hai cùng URL: ready ngay, không loading, không fetch lại', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify(styleJson), { status: 200 }));
    const first = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'en', poiLayer: true }, doFetch as never),
    );
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(doFetch).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'en', poiLayer: true }, doFetch as never),
    );
    // Không qua trạng thái loading một nhịp nào — đây mới là thứ cắt được thời gian mở màn hình.
    expect(second.result.current.status).toBe('ready');
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('cache theo JSON thô: đổi lang dùng lại JSON cũ, biến đổi lại, vẫn không fetch', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify(styleJson), { status: 200 }));
    const en = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'en', poiLayer: true }, doFetch as never),
    );
    await waitFor(() => expect(en.result.current.status).toBe('ready'));
    en.unmount();

    const vi2 = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'vi', poiLayer: false }, doFetch as never),
    );
    expect(vi2.result.current.status).toBe('ready');
    expect(doFetch).toHaveBeenCalledTimes(1);
    const ready = vi2.result.current as { status: 'ready'; mapStyle: StyleSpecification };
    // Biến đổi áp theo tuỳ chọn MỚI chứ không trả lại kết quả đã biến đổi của lần trước.
    expect(ready.mapStyle).toEqual(transformStyle(styleJson, { lang: 'vi', poiLayer: false }));
  });

  it('clearStyleCache() buộc tải lại', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify(styleJson), { status: 200 }));
    const a = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'en', poiLayer: true }, doFetch as never),
    );
    await waitFor(() => expect(a.result.current.status).toBe('ready'));
    a.unmount();
    clearStyleCache();

    const b = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'en', poiLayer: true }, doFetch as never),
    );
    expect(b.result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(b.result.current.status).toBe('ready'));
    expect(doFetch).toHaveBeenCalledTimes(2);
  });
});

describe('useResolvedStyle — style đóng gói sẵn (A2)', () => {
  it('có styleJson: ready ngay bằng chính object đó, không fetch', () => {
    const doFetch = vi.fn();
    const { result } = renderHook(() =>
      useResolvedStyle(
        places,
        { style: 'light', lang: 'vi', poiLayer: true, styleJson },
        doFetch as never,
      ),
    );
    expect(result.current).toEqual({ status: 'ready', mapStyle: styleJson });
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('styleJson vẫn được áp lang/poiLayer như style tải từ server', () => {
    const doFetch = vi.fn();
    const { result } = renderHook(() =>
      useResolvedStyle(
        places,
        { style: 'light', lang: 'en', poiLayer: false, styleJson },
        doFetch as never,
      ),
    );
    const ready = result.current as { status: 'ready'; mapStyle: StyleSpecification };
    expect(ready.mapStyle.layers[0]?.layout).toEqual({ 'text-field': nameExpression('en') });
    const poi = (
      ready.mapStyle.layers as unknown as { source?: string; layout?: { visibility?: string } }[]
    ).filter((l) => l.source === 'poi');
    for (const l of poi) expect(l.layout?.visibility).toBe('none');
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('styleJson không ghi vào cache dùng chung theo URL', async () => {
    const packaged = renderHook(() =>
      useResolvedStyle(
        places,
        { style: 'light', lang: 'en', poiLayer: true, styleJson },
        vi.fn() as never,
      ),
    );
    expect(packaged.result.current.status).toBe('ready');
    packaged.unmount();

    const doFetch = vi.fn(async () => new Response(JSON.stringify(styleJson), { status: 200 }));
    const fromServer = renderHook(() =>
      useResolvedStyle(places, { style: 'light', lang: 'en', poiLayer: true }, doFetch as never),
    );
    expect(fromServer.result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(fromServer.result.current.status).toBe('ready'));
    expect(doFetch).toHaveBeenCalledTimes(1);
  });
});
