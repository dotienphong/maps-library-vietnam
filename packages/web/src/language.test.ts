import { describe, expect, it, vi } from 'vitest';
import { applyLanguage, nameExpression } from './language';

describe('nameExpression', () => {
  it('vi → coalesce name:vi, name; en → coalesce name:en, name', () => {
    expect(nameExpression('vi')).toEqual(['coalesce', ['get', 'name:vi'], ['get', 'name']]);
    expect(nameExpression('en')).toEqual(['coalesce', ['get', 'name:en'], ['get', 'name']]);
  });
});

describe('applyLanguage', () => {
  it('chỉ đổi symbol layer có text-field tham chiếu name', () => {
    const setLayoutProperty = vi.fn();
    const gl = {
      getStyle: () => ({
        layers: [
          {
            id: 'city',
            type: 'symbol',
            layout: { 'text-field': ['coalesce', ['get', 'name:vi'], ['get', 'name']] },
          },
          { id: 'hn', type: 'symbol', layout: { 'text-field': '{housenumber}' } },
          { id: 'sovereignty-label', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
          { id: 'water', type: 'fill' },
        ],
      }),
      setLayoutProperty,
    };
    applyLanguage(gl, 'en');
    expect(setLayoutProperty).toHaveBeenCalledTimes(1);
    expect(setLayoutProperty).toHaveBeenCalledWith('city', 'text-field', nameExpression('en'));
  });
});
