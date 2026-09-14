// @vitest-environment jsdom
import type { DirectionsResponse, Route } from '@mapslibvn/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import type { MapHandle } from './context';
import { MapsLibVNMap, type MapsLibVNMapProps } from './map';
import { ROUTE_ALT_SOURCE_ID, ROUTE_LAYER_IDS, ROUTE_SOURCE_ID } from './navigation/route-layers';
import { MISSING_SOURCE_MESSAGE, type SessionPositionSource } from './navigation/session';
import { fakeSession, progressAt } from './test/fake-session';
import { cameraRefMock, getLastMapProps, getSourceProps, resetMocks } from './test/mlrn-mock';
import { setAppState } from './test/react-native-mock';

vi.mock('react-native', () => import('./test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('./test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;
const base = { apiKey: 'mlv_live_k', apiBase: 'https://api.test' };

const kinds = () =>
  (
    JSON.parse(screen.getByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`).dataset.geojson ?? '{}') as {
      features: { properties: { kind: string } }[];
    }
  ).features.map((f) => f.properties.kind);
const layerBefore = (id: string) =>
  (
    JSON.parse(screen.getByTestId(`mlrn-layer-${id}`).dataset.layer ?? '{}') as {
      beforeId?: string;
    }
  ).beforeId;
type MapProps = {
  onDidFinishLoadingStyle: () => void;
  onRegionWillChange: (e: { nativeEvent: { userInteraction: boolean } }) => void;
};
const mapProps = () => getLastMapProps() as unknown as MapProps;
/** Render map với props thêm, ép onLoad để lấy MapHandle. */
function mount(props: Omit<MapsLibVNMapProps, 'apiKey' | 'apiBase'> = {}) {
  const got: { handle: MapHandle | null } = { handle: null };
  const r = render(
    <MapsLibVNMap
      {...base}
      {...props}
      onLoad={(h) => {
        got.handle = h;
      }}
    />,
  );
  act(() => mapProps().onDidFinishLoadingStyle());
  if (!got.handle) throw new Error('onLoad chưa gọi');
  return { ...r, handle: got.handle };
}

afterEach(() => {
  cleanup();
  resetMocks();
  setAppState('active');
});

describe('MapsLibVNMap + navigation', () => {
  it('gắn phiên có tuyến → vẽ ngay dưới lớp symbol của theme; progress → traveled/puck + easeTo theo mode', () => {
    const s = fakeSession({ response });
    render(<MapsLibVNMap {...base} navigation={s.session} />);
    expect(kinds()).toEqual(['active']);
    expect(layerBefore(ROUTE_LAYER_IDS.line)).toBe('road_one_way_arrow');
    act(() => s.progress(progressAt(route, 5)));
    expect(kinds()).toEqual(['traveled', 'active', 'puck']);
    expect(cameraRefMock.easeTo).toHaveBeenLastCalledWith({
      center: [106.6985, 10.7791],
      bearing: 45,
      zoom: 16.5,
      pitch: 45,
      duration: 500,
      easing: 'linear',
    });
    act(() => s.progress(progressAt(route, 6, 1_700_000_000_000 + 2500)));
    expect(cameraRefMock.easeTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ duration: 1000 }),
    );
    act(() => s.route(response, 0));
    expect(kinds()).toEqual(['active']); // route mới → progress reset
  });

  it('beforeId: dark → water_name; URL style → không; routeBeforeLayerId ghi đè ("poi" hoặc null)', () => {
    const s = fakeSession({ response });
    const { rerender } = render(<MapsLibVNMap {...base} style="dark" navigation={s.session} />);
    expect(layerBefore(ROUTE_LAYER_IDS.line)).toBe('water_name');
    rerender(<MapsLibVNMap {...base} style="https://x.test/style.json" navigation={s.session} />);
    expect(layerBefore(ROUTE_LAYER_IDS.line)).toBeUndefined();
    rerender(<MapsLibVNMap {...base} routeBeforeLayerId="poi" navigation={s.session} />);
    expect(layerBefore(ROUTE_LAYER_IDS.line)).toBe('poi');
    rerender(<MapsLibVNMap {...base} routeBeforeLayerId={null} navigation={s.session} />);
    expect(layerBefore(ROUTE_LAYER_IDS.line)).toBeUndefined();
  });

  it('kéo tay → tắt bám + followChange(false), progress không easeTo; recenter → bật lại và easeTo ngay', () => {
    const s = fakeSession({ response });
    const { handle } = mount({ navigation: s.session });
    const follow = vi.fn();
    handle.navigation.on('followChange', follow);
    act(() => mapProps().onRegionWillChange({ nativeEvent: { userInteraction: true } }));
    expect(follow).toHaveBeenCalledWith(false);
    expect(handle.navigation.following).toBe(false);
    act(() => s.progress(progressAt(route, 5)));
    expect(cameraRefMock.easeTo).not.toHaveBeenCalled();
    act(() => mapProps().onRegionWillChange({ nativeEvent: { userInteraction: false } })); // animation của chính SDK
    expect(follow).toHaveBeenCalledTimes(1);
    act(() => handle.navigation.recenter());
    expect(follow).toHaveBeenLastCalledWith(true);
    expect(cameraRefMock.easeTo).toHaveBeenCalledTimes(1);
  });

  it('đổi prop navigation → gỡ listener phiên cũ, gắn phiên mới; bỏ prop → xoá tuyến; unmount không stop phiên', () => {
    const a = fakeSession({ response });
    const b = fakeSession({ response, state: progressAt(route, 8) });
    const { rerender, unmount } = render(<MapsLibVNMap {...base} navigation={a.session} />);
    expect(a.handlerCount('progress')).toBe(1);
    rerender(<MapsLibVNMap {...base} navigation={b.session} />);
    expect(a.handlerCount('progress')).toBe(0);
    expect(kinds()).toEqual(['traveled', 'active', 'puck']); // gắn muộn: vẽ từ state sẵn có
    expect(cameraRefMock.easeTo).toHaveBeenCalledTimes(1);
    rerender(<MapsLibVNMap {...base} />);
    expect(screen.queryByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`)).toBeNull();
    expect(b.handlerCount('progress')).toBe(0);
    rerender(<MapsLibVNMap {...base} navigation={b.session} />);
    unmount();
    expect(b.session.stop).not.toHaveBeenCalled();
    expect(b.handlerCount('progress')).toBe(0);
  });

  it('AppState background → progress không easeTo (tuyến vẫn cập nhật); về active → easeTo một lần từ state', () => {
    const s = fakeSession({ response });
    render(<MapsLibVNMap {...base} navigation={s.session} />);
    act(() => setAppState('background'));
    act(() => s.progress(progressAt(route, 5)));
    expect(kinds()).toEqual(['traveled', 'active', 'puck']);
    expect(cameraRefMock.easeTo).not.toHaveBeenCalled();
    act(() => setAppState('active'));
    expect(cameraRefMock.easeTo).toHaveBeenCalledTimes(1);
  });

  it('routes.show/clear không cần phiên; onRouteClick từ source; puck={false}; follow={false}', () => {
    const onRouteClick = vi.fn();
    const { handle, rerender } = mount({ onRouteClick, puck: false, follow: false });
    act(() => handle.routes.show(response));
    expect(kinds()).toEqual(['active']);
    getSourceProps(ROUTE_ALT_SOURCE_ID)?.onPress?.({
      nativeEvent: { features: [{ properties: { kind: 'alt', index: 1 } }] },
    });
    expect(onRouteClick).toHaveBeenCalledWith(1);
    const s = fakeSession({ response });
    rerender(
      <MapsLibVNMap
        {...base}
        onRouteClick={onRouteClick}
        puck={false}
        follow={false}
        navigation={s.session}
      />,
    );
    act(() => s.progress(progressAt(route, 5)));
    expect(kinds()).toEqual(['traveled', 'active']);
    expect(screen.queryByTestId(`mlrn-layer-${ROUTE_LAYER_IDS.puck}`)).toBeNull();
    expect(cameraRefMock.easeTo).not.toHaveBeenCalled();
    act(() => handle.navigation.recenter());
    expect(cameraRefMock.easeTo).not.toHaveBeenCalled();
    act(() => handle.routes.clear());
    expect(screen.queryByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`)).toBeNull();
  });

  it('phiên mặc định: thiếu source → start reject; có sessionOptions.source → start vẽ tuyến và status navigating', async () => {
    const first = mount();
    expect(first.handle.navigation.status).toBe('idle');
    await expect(first.handle.navigation.start({ response })).rejects.toThrow(
      MISSING_SOURCE_MESSAGE,
    );
    cleanup();
    resetMocks();
    const source: SessionPositionSource = { subscribe: () => () => {} };
    const { handle } = mount({ sessionOptions: { source } });
    await act(() => handle.navigation.start({ response }));
    expect(kinds()).toEqual(['active']);
    expect(handle.navigation.status).toBe('navigating');
    expect(handle.navigation.session.response).toBe(response);
  });
});
