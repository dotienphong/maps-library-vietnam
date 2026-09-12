import type { GeoFix } from '@mapslibvn/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playbackSource } from './playback-source';

describe('playbackSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const fixes: GeoFix[] = [0, 1000, 3000].map((dt) => ({
    lng: 106.7,
    lat: 10.77,
    timestamp: 1_700_000_000_000 + dt,
  }));

  it('phát theo chênh timestamp chia rate; unsubscribe dừng', () => {
    const onFix = vi.fn();
    const stop = playbackSource(fixes, { rate: 2 }).subscribe(onFix);
    vi.advanceTimersByTime(0);
    expect(onFix).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(499);
    expect(onFix).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onFix).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(5000);
    expect(onFix).toHaveBeenCalledTimes(2);
  });

  it('rate 0 → phát tất cả trong một tick', () => {
    const onFix = vi.fn();
    playbackSource(fixes, { rate: 0 }).subscribe(onFix);
    expect(onFix).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(onFix).toHaveBeenCalledTimes(3);
  });
});
