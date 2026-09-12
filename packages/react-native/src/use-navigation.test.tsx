// @vitest-environment jsdom
import type { DirectionsResponse, Route } from '@mapslibvn/core';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import { MapsLibVNMap } from './map';
import { fakeSession, progressAt } from './test/fake-session';
import { getLastMapProps, resetMocks } from './test/mlrn-mock';
import { useNavigation } from './use-navigation';

vi.mock('react-native', () => import('./test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('./test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;

afterEach(() => {
  cleanup();
  resetMocks();
});

describe('useNavigation', () => {
  it('trong map, không tham số: đọc từ useMap().navigation, re-render theo status/progress/followChange; unmount gỡ listener', () => {
    const s = fakeSession({ response });
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <MapsLibVNMap apiKey="k" apiBase="https://api.test" navigation={s.session}>
        {children}
      </MapsLibVNMap>
    );
    const { result, unmount } = renderHook(() => useNavigation(), { wrapper });
    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBeNull();
    expect(result.current.following).toBe(true);
    act(() => s.progress(progressAt(route, 5)));
    expect(result.current.progress?.shapeIndex).toBe(5);
    expect(result.current.status).toBe('navigating');
    const props = getLastMapProps() as unknown as {
      onRegionWillChange: (e: { nativeEvent: { userInteraction: boolean } }) => void;
    };
    act(() => props.onRegionWillChange({ nativeEvent: { userInteraction: true } }));
    expect(result.current.following).toBe(false);
    act(() => result.current.recenter());
    expect(result.current.following).toBe(true);
    result.current.start({ response });
    expect(s.session.start).toHaveBeenCalledWith({ response });
    unmount();
    // binding của map đã dispose: listener trên phiên về 0
    expect(s.handlerCount('progress')).toBe(0);
  });

  it('có session: dùng được ngoài map; following=false, recenter no-op; start/stop/reroute uỷ quyền', async () => {
    const s = fakeSession({ response });
    const { result } = renderHook(() => useNavigation(s.session));
    expect(result.current.following).toBe(false);
    act(() => s.progress(progressAt(route, 3)));
    expect(result.current.progress?.shapeIndex).toBe(3);
    act(() => result.current.recenter());
    await result.current.stop();
    await result.current.reroute();
    expect(s.session.stop).toHaveBeenCalledTimes(1);
    expect(s.session.reroute).toHaveBeenCalledTimes(1);
  });

  it('ngoài map và không session → ném lỗi rõ', () => {
    expect(() => render(<Probe />)).toThrowError(/useNavigation phải được gọi bên trong/);
  });
});

function Probe() {
  useNavigation();
  return null;
}
