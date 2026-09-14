import type { DirectionsResponse } from '@mapslibvn/core';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import { createRoutesStore } from './routes-store';

const response = fixture as unknown as DirectionsResponse;
const kinds = (store: ReturnType<typeof createRoutesStore>) => {
  const snap = store.getSnapshot();
  return [...snap.altFeatures.features, ...snap.liveFeatures.features].map(
    (f) => f.properties.kind,
  );
};

describe('createRoutesStore', () => {
  it('show → active; setProgress → traveled/active/puck; setPuck(false) bỏ puck; setActive reset progress', () => {
    const store = createRoutesStore();
    const onChange = vi.fn();
    store.subscribe(onChange);
    expect(kinds(store)).toEqual([]);
    store.show(response);
    expect(kinds(store)).toEqual(['active']);
    store.setProgress({ shapeIndex: 5, snapped: [106.6985, 10.7791], bearing: 90 });
    expect(kinds(store)).toEqual(['traveled', 'active', 'puck']);
    store.setPuck(false);
    expect(kinds(store)).toEqual(['traveled', 'active']);
    store.setPuck(false); // không đổi → không báo
    store.setActive(0);
    expect(store.getSnapshot().progress).toBeNull();
    expect(kinds(store)).toEqual(['active']);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('setProgress giữ nguyên tham chiếu altFeatures; show/setActive mới dựng lại (B1)', () => {
    const store = createRoutesStore();
    store.show(response);
    const alt = store.getSnapshot().altFeatures;
    const live = store.getSnapshot().liveFeatures;
    store.setProgress({ shapeIndex: 5, snapped: [106.6985, 10.7791], bearing: 90 });
    // Đây là điều kiện để MLRN không đẩy lại tuyến thay thế qua cầu native mỗi lần định vị.
    expect(store.getSnapshot().altFeatures).toBe(alt);
    expect(store.getSnapshot().liveFeatures).not.toBe(live);
    store.setActive(1); // đổi tuyến đang chọn: tuyến vừa rời vai active nay là alt → phải dựng lại
    expect(store.getSnapshot().altFeatures).not.toBe(alt);
    expect(kinds(store)).toEqual(['alt']);
  });

  it('không sao chép toạ độ tuyến: feature dùng chung mảng với bản giải mã', () => {
    const store = createRoutesStore();
    store.show(response);
    const first = store.getSnapshot().liveFeatures.features[0];
    if (!first || first.geometry.type !== 'LineString') throw new Error('không phải LineString');
    const before = first.geometry.coordinates;
    store.setProgress(null);
    const after = store.getSnapshot().liveFeatures.features[0];
    if (!after || after.geometry.type !== 'LineString') throw new Error('không phải LineString');
    expect(after.geometry.coordinates).toBe(before);
  });

  it('clear xoá response và features; snapshot ổn định khi không đổi; unsubscribe ngừng báo', () => {
    const store = createRoutesStore();
    const onChange = vi.fn();
    const off = store.subscribe(onChange);
    store.show(response, { active: 0 });
    const a = store.getSnapshot();
    expect(store.getSnapshot()).toBe(a);
    store.clear();
    expect(store.getSnapshot().response).toBeNull();
    expect(kinds(store)).toEqual([]);
    off();
    store.show(response);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
