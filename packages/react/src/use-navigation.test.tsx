// @vitest-environment jsdom
import { createMap } from '@mapslibvn/web';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapsLibVNMap } from './map';
import { useNavigation } from './use-navigation';

vi.mock('maplibre-gl', () => ({}));
vi.mock('@mapslibvn/web', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mapslibvn/web')>()),
  createMap: vi.fn(),
}));

function fakeNavigation() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  let status = 'idle';
  let state: unknown = null;
  const nav = {
    start: vi.fn(),
    stop: vi.fn(),
    recenter: vi.fn(),
    reroute: vi.fn(async () => {}),
    on: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] ??= [];
      handlers[ev].push(fn);
    }),
    off: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn);
    }),
    get status() {
      return status;
    },
    get state() {
      return state;
    },
    get following() {
      return true;
    },
  };
  return {
    nav,
    setStatus: (s: string) => {
      status = s;
      for (const fn of handlers.status ?? []) fn({ status: s, previous: 'idle' });
    },
    setProgress: (p: unknown) => {
      state = p;
      for (const fn of handlers.progress ?? []) fn(p);
    },
    handlerCount: (ev: string) => (handlers[ev] ?? []).length,
  };
}

const wrapperFor = (): ((props: { children: ReactNode }) => ReactElement) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MapsLibVNMap apiKey="k" apiBase="https://api.test">
        {children}
      </MapsLibVNMap>
    );
  };

describe('useNavigation', () => {
  const fake = fakeNavigation();
  beforeEach(() => {
    vi.mocked(createMap).mockImplementation(
      () => ({ on: vi.fn(), remove: vi.fn(), navigation: fake.nav }) as never,
    );
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('trả status/progress hiện hành và cập nhật khi sự kiện phát; unmount gỡ listener', async () => {
    const { result, unmount } = renderHook(() => useNavigation(), { wrapper: wrapperFor() });
    await act(async () => {});
    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBeNull();
    act(() => fake.setStatus('navigating'));
    expect(result.current.status).toBe('navigating');
    act(() => fake.setProgress({ stepIndex: 2, remaining_m: 500 }));
    expect(result.current.progress).toMatchObject({ stepIndex: 2 });
    expect(fake.handlerCount('progress')).toBe(1);
    unmount();
    expect(fake.handlerCount('progress')).toBe(0);
    expect(fake.handlerCount('status')).toBe(0);
  });

  it('start/stop/recenter/reroute là của map.navigation', async () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: wrapperFor() });
    await act(async () => {});
    result.current.start({ response: { routes: [], waypoints: [], attribution: '' } });
    result.current.stop();
    result.current.recenter();
    await result.current.reroute();
    expect(fake.nav.start).toHaveBeenCalledTimes(1);
    expect(fake.nav.stop).toHaveBeenCalledTimes(1);
    expect(fake.nav.recenter).toHaveBeenCalledTimes(1);
    expect(fake.nav.reroute).toHaveBeenCalledTimes(1);
  });

  it('ngoài <MapsLibVNMap> → ném như useMap', () => {
    expect(() => render(<Probe />)).toThrowError(/useMap phải được gọi bên trong/);
  });
});

function Probe() {
  useNavigation();
  return null;
}
