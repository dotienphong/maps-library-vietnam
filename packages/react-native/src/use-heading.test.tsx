// @vitest-environment jsdom
import type { HeadingFix, HeadingSource } from '@mapslibvn/core';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from './test/fake-session';
import { useHeading } from './use-heading';

afterEach(cleanup);
const fix = (heading: number): HeadingFix => ({
  heading,
  accuracy: 'high',
  timestamp: 1_700_000_000_000,
  source: 'compass',
});

describe('useHeading', () => {
  it('HeadingSource: đăng ký khi mount, cập nhật khi có mẫu, huỷ khi unmount', () => {
    let push: ((h: HeadingFix) => void) | null = null;
    const off = vi.fn();
    const source: HeadingSource = {
      subscribe: vi.fn((cb: (h: HeadingFix) => void) => {
        push = cb;
        return off;
      }),
    };
    const { result, unmount } = renderHook(() => useHeading(source));
    expect(result.current).toBeNull();
    expect(source.subscribe).toHaveBeenCalledTimes(1);
    act(() => push?.(fix(90)));
    expect(result.current?.heading).toBe(90);
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('NavigationSession: đọc sự kiện heading; stop (status) cũng re-render về null; unmount gỡ listener', () => {
    const s = fakeSession();
    const { result, unmount } = renderHook(() => useHeading(s.session));
    expect(result.current).toBeNull();
    act(() => s.heading(fix(180)));
    expect(result.current?.heading).toBe(180);
    act(() => {
      s.heading(null);
      s.status('idle');
    });
    expect(result.current).toBeNull();
    unmount();
    expect(s.handlerCount('heading')).toBe(0);
    expect(s.handlerCount('status')).toBe(0);
  });
});
