import type { GeoFix, HeadingFix } from '@mapslibvn/core';
import { describe, expect, it, vi } from 'vitest';
import { createUserLocationStore } from './store';

const fix: GeoFix = { lng: 106.7, lat: 10.78, accuracy_m: 12, timestamp: 1 };
const heading: HeadingFix = { heading: 90, accuracy: 'high', timestamp: 1, source: 'fused' };

describe('createUserLocationStore', () => {
  it('setFix → 1 feature; setHeading → hasHeading; clear → rỗng; listener gọi mỗi lần đổi', () => {
    const store = createUserLocationStore();
    const onChange = vi.fn();
    store.subscribe(onChange);
    expect(store.getSnapshot().features.features).toEqual([]);
    store.setFix(fix);
    expect(store.getSnapshot().fix).toEqual(fix);
    expect(store.getSnapshot().features.features).toHaveLength(1);
    store.setHeading(heading);
    expect(store.getSnapshot().features.features[0]?.properties.hasHeading).toBe(true);
    store.setHeading(null);
    expect(store.getSnapshot().features.features[0]?.properties.hasHeading).toBe(false);
    store.clear();
    expect(store.getSnapshot().fix).toBeNull();
    expect(store.getSnapshot().heading).toBeNull();
    expect(store.getSnapshot().features.features).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('heading trước fix chưa sinh feature; clear khi đã rỗng không báo; snapshot ổn định; unsubscribe', () => {
    const store = createUserLocationStore();
    const onChange = vi.fn();
    const off = store.subscribe(onChange);
    store.setHeading(heading);
    expect(store.getSnapshot().features.features).toEqual([]);
    const a = store.getSnapshot();
    expect(store.getSnapshot()).toBe(a);
    store.clear();
    store.clear();
    expect(onChange).toHaveBeenCalledTimes(2);
    off();
    store.setFix(fix);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
