import { describe, expect, it } from 'vitest';
import {
  hidePoiLayer,
  isNameLabelLayer,
  isPoiStyleLayer,
  localizeStyle,
  nameExpression,
} from './style-transform';

type Layer = { id: string; type: string; source?: string; layout?: Record<string, unknown> };

const city: Layer = {
  id: 'city',
  type: 'symbol',
  layout: { 'text-field': ['coalesce', ['get', 'name:vi'], ['get', 'name']], 'text-size': 12 },
};
const hn: Layer = { id: 'hn', type: 'symbol', layout: { 'text-field': '{housenumber}' } };
const sov: Layer = {
  id: 'sovereignty-label',
  type: 'symbol',
  layout: { 'text-field': ['get', 'name'] },
};
const water: Layer = { id: 'water', type: 'fill' };
const poi: Layer = {
  id: 'poi',
  type: 'symbol',
  layout: { 'text-field': ['get', 'name'], 'icon-image': 'x' },
};

const style = { version: 8, sources: {}, layers: [city, hn, sov, water, poi] };

describe('nameExpression', () => {
  it('vi → coalesce name:vi, name; en → coalesce name:en, name', () => {
    expect(nameExpression('vi')).toEqual(['coalesce', ['get', 'name:vi'], ['get', 'name']]);
    expect(nameExpression('en')).toEqual(['coalesce', ['get', 'name:en'], ['get', 'name']]);
  });
});

describe('isNameLabelLayer', () => {
  it('chỉ symbol có text-field tham chiếu name, trừ lớp chủ quyền', () => {
    expect(isNameLabelLayer(city)).toBe(true);
    expect(isNameLabelLayer(hn)).toBe(false);
    expect(isNameLabelLayer(sov)).toBe(false);
    expect(isNameLabelLayer(water)).toBe(false);
    expect(isNameLabelLayer(poi)).toBe(true);
  });
});

describe('localizeStyle', () => {
  it('en: đổi text-field của city và poi, giữ text-size, không đụng hn/sovereignty/water', () => {
    const out = localizeStyle(style, 'en');
    expect(out.layers[0]?.layout).toEqual({
      'text-field': nameExpression('en'),
      'text-size': 12,
    });
    expect(out.layers[1]).toEqual(style.layers[1]);
    expect(out.layers[2]).toEqual(style.layers[2]);
    expect(out.layers[3]).toEqual(style.layers[3]);
    expect(out.layers[4]?.layout?.['text-field']).toEqual(nameExpression('en'));
  });

  it('vi: trả đúng object đầu vào', () => {
    expect(localizeStyle(style, 'vi')).toBe(style);
  });

  it('không đột biến đầu vào', () => {
    const before = JSON.stringify(style);
    localizeStyle(style, 'en');
    expect(JSON.stringify(style)).toBe(before);
  });
});

describe('hidePoiLayer', () => {
  it('ẩn mọi layer source poi, giữ layer khác và không đột biến', () => {
    const poiLayers: Layer[] = [
      { id: 'poi', type: 'symbol', source: 'poi', layout: {} },
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
    ];
    const input = { layers: [...poiLayers, { id: 'city', type: 'symbol', source: 'vn' }] };
    const before = JSON.stringify(input);
    const out = hidePoiLayer(input);
    expect(out.layers.slice(0, 3).map((layer) => layer.layout?.visibility)).toEqual([
      'none',
      'none',
      'none',
    ]);
    expect(out.layers[3]?.id).toBe('city');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('style không có lớp poi thì trả bản sao tương đương', () => {
    const noPoi = { ...style, layers: style.layers.slice(0, 4) };
    expect(hidePoiLayer(noPoi)).toEqual(noPoi);
  });
});

describe('isPoiStyleLayer', () => {
  it('nhận diện ID tương thích cũ hoặc source poi', () => {
    expect(isPoiStyleLayer({ id: 'poi', type: 'symbol' })).toBe(true);
    expect(isPoiStyleLayer({ id: 'poi-label-major', type: 'symbol', source: 'poi' })).toBe(true);
    expect(isPoiStyleLayer({ id: 'city', type: 'symbol', source: 'vn' })).toBe(false);
  });
});
