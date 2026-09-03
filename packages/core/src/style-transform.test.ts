import { describe, expect, it } from 'vitest';
import { hidePoiLayer, isNameLabelLayer, localizeStyle, nameExpression } from './style-transform';

type Layer = { id: string; type: string; layout?: Record<string, unknown> };

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
  it('đặt visibility none cho lớp poi, giữ layout còn lại, không đột biến', () => {
    const before = JSON.stringify(style);
    const out = hidePoiLayer(style);
    expect(out.layers[4]?.layout).toEqual({
      'text-field': ['get', 'name'],
      'icon-image': 'x',
      visibility: 'none',
    });
    expect(out.layers[0]).toEqual(style.layers[0]);
    expect(JSON.stringify(style)).toBe(before);
  });

  it('style không có lớp poi thì trả bản sao tương đương', () => {
    const noPoi = { ...style, layers: style.layers.slice(0, 4) };
    expect(hidePoiLayer(noPoi)).toEqual(noPoi);
  });
});
