// @vitest-environment jsdom
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { type MapsLibVNClient, createClient, nameExpression } from '@mapslibvn/core';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { needsTransform, styleUrlFor, transformStyle, useResolvedStyle } from './use-style';

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
